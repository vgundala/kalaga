// Live-ask: at a chosen handoff seam, ask an agent that still has a live
// session for a structured state update via headless print mode.
//
// Contract: the child gets a fixed prompt asking for a YAML fragment ONLY
// (no markdown fences). We pipe stdout (never TTY-inherit), cap the run at
// LIVE_ASK_TIMEOUT_MS, then parse + sanitize + mergeState(..., 'live-ask').
// Any failure (no binary, timeout, non-zero exit, unparseable) is soft: we
// warn on stderr and keep the existing state.
//
// A live-ask spends a little of that agent's remaining quota. It runs only
// when we still have a fresh session id (switch), never against an agent
// that just died on a limit.
import { spawn } from 'node:child_process';
import { resolveExecutable, resolveSpawnTarget } from './config.ts';
import type { AgentConfig } from './config.ts';
import { mergeState } from './state/state.ts';
import { sanitizeHandoffField, FIELD_MAX, sanitizeHandoffList } from './prompt.ts';
import { resumeArgv } from './launch.ts';
import { consumeIndentedBlock, isYamlBlockIndicator, parseYamlInlineList, parseYamlScalar, renderYamlBlock } from './util/yaml.ts';

export const LIVE_ASK_TIMEOUT_MS = 15_000;
const LIVE_ASK_MAX_STDOUT = 64 * 1024;

export const LIVE_ASK_PROMPT = [
  'Update the Kalaga handoff. Reply with ONLY a YAML block (no markdown fences)',
  'containing keys: goal, done (list of short bullets), next_step, notes,',
  'negative_constraints (list). Summarize what was accomplished and the single',
  'next action. Do not invent files you did not touch.',
].join(' ');

export interface LiveAskPatch {
  goal?: string;
  next_step?: string;
  notes?: string;
  done?: string[];
  negative_constraints?: string[];
}

/** Headless argv for a one-shot prompt (resolved binary is prepended by the
 *  caller). When `sessionId` is set, resume flags (and trust flags) come
 *  before `headless`. Two-arg calls stay resume-free. */
export function liveAskArgv(agent: AgentConfig, prompt: string, sessionId?: string, trust = false): string[] {
  const head: string[] = [];
  if (sessionId) {
    head.push(...resumeArgv(agent, sessionId));
    if (trust && agent.trustFlags.length) head.push(...agent.trustFlags);
  }
  return [...head, ...agent.headless, prompt];
}

/** Spawn the agent in print mode with piped stdio and a hard timeout.
 *  Non-zero exits and timeouts resolve to ''. Stdout is capped at 64 KiB. */
export function runLiveAsk(
  agent: AgentConfig,
  repoDir: string,
  prompt = LIVE_ASK_PROMPT,
  timeoutMs = LIVE_ASK_TIMEOUT_MS,
  sessionId?: string,
  trust = false,
): Promise<string> {
  const resolved = resolveExecutable(agent.interactive[0]);
  if (!resolved) return Promise.resolve('');
  let argv: string[];
  try { argv = liveAskArgv(agent, prompt, sessionId, trust); }
  catch { return Promise.resolve(''); }
  const target = resolveSpawnTarget(resolved, argv);
  return new Promise((resolve) => {
    let settled = false;
    const done = (out: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
      resolve(out);
    };
    const child = spawn(target.file, target.args, {
      cwd: repoDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: false,
    });
    let out = '';
    child.stdout?.on('data', (d: Buffer) => {
      if (out.length >= LIVE_ASK_MAX_STDOUT) return;
      out += d.toString('utf8');
      if (out.length > LIVE_ASK_MAX_STDOUT) out = out.slice(0, LIVE_ASK_MAX_STDOUT);
    });
    const timer = setTimeout(() => done(''), timeoutMs);
    child.on('error', () => done(''));
    child.on('close', (code) => done(code === 0 ? out : ''));
  });
}

const LIST_KEYS = new Set(['done', 'negative_constraints']);

/** Tolerant parser for the YAML subset a vendor CLI is asked to emit.
 *  Accepts an optional ``` fence, scalars, `|`/`>` blocks, inline `[...]`
 *  lists, and `- ` items. Unknown keys ignored. Empty lists are omitted. */
export function parseLiveAskYaml(raw: string): LiveAskPatch {
  const patch: LiveAskPatch = {};
  let curKey: 'done' | 'negative_constraints' | null = null;
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('```')) continue;
    const li = t.match(/^-\s*(.*)$/);
    if (li && curKey) {
      const v = parseYamlScalar(li[1]).trim();
      if (v && v !== '[]') (patch[curKey] ??= []).push(v);
      continue;
    }
    const kv = t.match(/^(goal|next_step|notes|done|negative_constraints):\s*(.*)$/);
    if (!kv) { curKey = null; continue; }
    const key = kv[1] as 'goal' | 'next_step' | 'notes' | 'done' | 'negative_constraints';
    const rest = kv[2].trim();
    const block = isYamlBlockIndicator(rest);
    if (block) {
      const consumed = consumeIndentedBlock(lines, i + 1);
      const text = renderYamlBlock(consumed.lines, block.style, block.strip).trim();
      i = consumed.next - 1;
      curKey = null;
      if (LIST_KEYS.has(key)) {
        const items = text.split('\n').map((s) => s.replace(/^-\s*/, '').trim()).filter(Boolean);
        if (items.length) patch[key as 'done' | 'negative_constraints'] = items;
      } else if (text) {
        patch[key as 'goal' | 'next_step' | 'notes'] = text;
      }
      continue;
    }
    if (LIST_KEYS.has(key)) {
      const inline = parseYamlInlineList(rest);
      if (inline) {
        const items = inline.map((s) => s.trim()).filter((s) => s.length > 0 && s !== '[]');
        if (items.length) patch[key as 'done' | 'negative_constraints'] = items;
        curKey = null;
        continue;
      }
      curKey = key as 'done' | 'negative_constraints';
      const v = parseYamlScalar(rest).trim();
      if (v && v !== '[]') patch[curKey] = [v];
      continue;
    }
    curKey = null;
    const v = parseYamlScalar(rest).trim();
    if (v) patch[key] = v;
  }
  return patch;
}

/** Ask `agent` and merge whatever parses into state as `_source: 'live-ask'`.
 *  Fail soft on any error. `sessionId` resumes that session; `trust` adds
 *  the agent's trust flags when the repo already has a grant. */
export async function liveAskAndMerge(
  agent: AgentConfig,
  repoDir: string,
  timeoutMs = LIVE_ASK_TIMEOUT_MS,
  sessionId?: string,
  trust = false,
): Promise<void> {
  const secs = Math.max(1, Math.round(timeoutMs / 1000));
  console.error(`kalaga: asking ${agent.key} for handoff summary (up to ${secs}s)...`);
  let raw = '';
  try {
    raw = await runLiveAsk(agent, repoDir, LIVE_ASK_PROMPT, timeoutMs, sessionId, trust);
  } catch { /* fail soft */ }
  const patch = sanitizeLiveAskPatch(parseLiveAskYaml(raw));
  if (!Object.keys(patch).length) {
    console.error(`  kalaga: live-ask (${agent.key}) returned nothing usable — using existing state`);
    return;
  }
  if (patch.done?.length) patch.done = patch.done.slice(-FIELD_MAX.doneItems);
  mergeState(repoDir, patch, 'live-ask');
  console.error(`  kalaga: live-ask (${agent.key}) merged`);
}

/** Apply the field caps to a parsed patch before it touches state. */
function sanitizeLiveAskPatch(patch: LiveAskPatch): LiveAskPatch {
  const out: LiveAskPatch = {};
  if (patch.goal) out.goal = sanitizeHandoffField(patch.goal, FIELD_MAX.goal);
  if (patch.next_step) out.next_step = sanitizeHandoffField(patch.next_step, FIELD_MAX.next_step);
  if (patch.notes) out.notes = sanitizeHandoffField(patch.notes, FIELD_MAX.notes);
  if (patch.done?.length) out.done = sanitizeHandoffList(patch.done, FIELD_MAX.doneItems, FIELD_MAX.doneItem);
  if (patch.negative_constraints?.length) out.negative_constraints = sanitizeHandoffList(patch.negative_constraints, FIELD_MAX.negItems, FIELD_MAX.negItem);
  return out;
}
