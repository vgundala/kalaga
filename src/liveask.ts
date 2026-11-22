// FEAT-003 H6/H7/H8 — live-ask: at a handoff seam, ask the DYING agent (or
// current owner) for a structured state update via headless print mode.
//
// Contract: the child gets a fixed prompt asking for a YAML fragment ONLY
// (no markdown fences). We pipe stdout (never TTY-inherit — that would block
// the handoff UX), cap the run at LIVE_ASK_TIMEOUT_MS, then parse + sanitize
// + mergeState(..., 'live-ask'). Any failure (no binary, timeout, non-zero
// exit, unparseable) is soft: we warn on stderr and keep the existing state.
//
// Budget honesty: a live-ask spends a little of the dying agent's remaining
// quota. Documented in README (FEAT-003 §3.6).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { resolveExecutable } from './config.ts';
import type { AgentConfig } from './config.ts';
import { mergeState } from './state/state.ts';
import { sanitizeHandoffField, FIELD_MAX, sanitizeHandoffList } from './prompt.ts';

export const LIVE_ASK_TIMEOUT_MS = 45_000;

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

/** H8: headless argv for a one-shot prompt (resolved binary + config
 *  `headless` flags + prompt). Never shell:true. */
export function liveAskArgv(agent: AgentConfig, prompt: string): string[] {
  return [...agent.headless, prompt];
}

/** H8: spawn the agent in print mode with piped stdio and a hard timeout.
 *  Returns the captured stdout (possibly empty). Never throws. */
export function runLiveAsk(agent: AgentConfig, repoDir: string, prompt = LIVE_ASK_PROMPT, timeoutMs = LIVE_ASK_TIMEOUT_MS): Promise<string> {
  const resolved = resolveExecutable(agent.interactive[0]);
  if (!resolved) return Promise.resolve('');
  return new Promise((resolve) => {
    let settled = false;
    const done = (out: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
      resolve(out);
    };
    const child = spawn(resolved, liveAskArgv(agent, prompt), {
      cwd: repoDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'], // never TTY-inherit (H8)
    });
    let out = '';
    child.stdout?.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    const timer = setTimeout(() => done(out), timeoutMs);
    child.on('error', () => done(out));
    child.on('close', (code) => done(code === 0 ? out : out)); // keep partial stdout
  });
}

/** H6: tolerant parser for the YAML subset a vendor CLI is asked to emit.
 *  Accepts an optional ``` fence, top-level scalars for goal/next_step/notes,
 *  and `- ` list items for done/negative_constraints. Unknown keys ignored.
 *  Empty/absent keys are omitted from the returned patch (merge keeps old). */
export function parseLiveAskYaml(raw: string): LiveAskPatch {
  const patch: LiveAskPatch = {};
  let curKey: 'done' | 'negative_constraints' | null = null;
  for (let line of raw.split('\n')) {
    line = line.replace(/\r$/, '');
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('```')) continue;
    const li = t.match(/^-\s*(.*)$/);
    if (li && curKey) {
      const v = li[1].replace(/^"|"$/g, '').trim();
      if (v) (patch[curKey] ??= []).push(v);
      continue;
    }
    const kv = t.match(/^(goal|next_step|notes|done|negative_constraints):\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const v = kv[2].replace(/^"|"$/g, '').trim();
      if (key === 'done' || key === 'negative_constraints') {
        curKey = key;
        patch[key] = v ? [v] : [];
        if (v) (patch[key] as string[]).length = 1;
        continue;
      }
      curKey = null;
      if (v) patch[key] = v;
      continue;
    }
    // any other non-list line ends list collection
    curKey = null;
  }
  return patch;
}

/** H6: ask `agent` and merge whatever parses into state as `_source:
 *  'live-ask'`. Fail soft on any error. Returns the merged state. */
export async function liveAskAndMerge(agent: AgentConfig, repoDir: string, timeoutMs = LIVE_ASK_TIMEOUT_MS): Promise<void> {
  let raw = '';
  try {
    raw = await runLiveAsk(agent, repoDir, LIVE_ASK_PROMPT, timeoutMs);
  } catch { /* fail soft */ }
  const patch = sanitizeLiveAskPatch(parseLiveAskYaml(raw));
  if (!Object.keys(patch).length) {
    console.error(`  kalaga: live-ask (${agent.key}) returned nothing usable — using existing state`);
    return;
  }
  // live-ask done list replaces ours, but we keep the cap: drop oldest first
  // so a verbose answer can't blow the field past FIELD_MAX.doneItems.
  if (patch.done?.length) patch.done = patch.done.slice(-FIELD_MAX.doneItems);
  mergeState(repoDir, patch, 'live-ask');
  console.error(`  kalaga: live-ask (${agent.key}) merged`);
}

/** Apply the H2 caps to a parsed patch before it touches state. */
function sanitizeLiveAskPatch(patch: LiveAskPatch): LiveAskPatch {
  const out: LiveAskPatch = {};
  if (patch.goal) out.goal = sanitizeHandoffField(patch.goal, FIELD_MAX.goal);
  if (patch.next_step) out.next_step = sanitizeHandoffField(patch.next_step, FIELD_MAX.next_step);
  if (patch.notes) out.notes = sanitizeHandoffField(patch.notes, FIELD_MAX.notes);
  if (patch.done?.length) out.done = sanitizeHandoffList(patch.done, FIELD_MAX.doneItems, FIELD_MAX.doneItem);
  if (patch.negative_constraints?.length) out.negative_constraints = sanitizeHandoffList(patch.negative_constraints, FIELD_MAX.negItems, FIELD_MAX.negItem);
  return out;
}
