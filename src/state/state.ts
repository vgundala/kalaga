// The handoff state: one schema, written by Kalaga's tailers (warm, live) and
// optionally enriched by a live-ask of the agent at a chosen seam.
// Shape mirrors the user's .session_state.yaml protocol so any agent that
// already reads that file reads this one too.
import fs from 'node:fs';
import path from 'node:path';
import { stateFile } from '../config.ts';
import { toYaml } from '../util/yaml.ts';

export interface HandoffState {
  goal: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
  owner: string | null;          // agent key that last owned the work
  branch: string | null;
  updated: string;               // ISO timestamp
  modified_files: string[];
  negative_constraints: string[];
  next_step: string;
  notes: string;                 // rolling free-form "where things stand"
  // provenance, kept for debugging the handoff, not shown to agents
  _source?: 'tailer' | 'live-ask' | 'manual';
}

export function blankState(repoDir: string, branch: string | null): HandoffState {
  return {
    goal: 'not captured yet — tell the current agent its goal, or run: kala state goal "…"',
    status: 'IN_PROGRESS',
    owner: null,
    branch,
    updated: new Date().toISOString(),
    modified_files: [],
    negative_constraints: [],
    next_step: 'read the repo, then ask the user what to do',
    notes: '',
    _source: 'manual',
  };
}

/** Naive but robust YAML reader for the subset we write. Good enough for our
 *  own files; if the user hand-edits it into something fancy we fall back to
 *  blank state rather than crashing. */
export function loadState(repoDir: string): HandoffState | null {
  const f = stateFile(repoDir);
  let raw: string;
  try { raw = fs.readFileSync(f, 'utf8'); } catch { return null; }
  try {
    const top: Record<string, string> = {};
    const lists: Record<string, string[]> = { modified_files: [], negative_constraints: [] };
    let cur: string | null = null;
    for (const line of raw.split('\n')) {
      if (/^\s*#/.test(line) || !line.trim()) continue;
      const li = line.match(/^\s*-\s*(.*)$/);
      if (li && cur) { lists[cur].push(li[1].replace(/^"|"$/g, '')); continue; }
      const kv = line.match(/^([a-z_]+):\s*(.*)$/);
      if (!kv) { cur = null; continue; }
      cur = kv[1];
      const v = kv[2].replace(/^"|"$/g, '');
      if (lists[kv[1]]) { lists[kv[1]] = (v && v !== '[]') ? [v] : []; }
      else top[kv[1]] = v;
    }
    const orNull = (v: string | undefined) => (v && v !== 'null' ? v : null);
    const s: HandoffState = {
      goal: top.goal ?? '',
      status: (top.status as HandoffState['status']) ?? 'IN_PROGRESS',
      owner: orNull(top.owner),
      branch: orNull(top.branch),
      updated: top.updated ?? new Date().toISOString(),
      modified_files: lists.modified_files,
      negative_constraints: lists.negative_constraints,
      next_step: top.next_step ?? '',
      notes: top.notes ?? '',
    };
    if (!s.goal) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveState(repoDir: string, s: HandoffState): void {
  const f = stateFile(repoDir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const clean = { ...s };
  delete (clean as { _source?: string })._source;
  let out = `# kalaga handoff state — read this before acting.\n`;
  out += `# written by: ${s._source ?? 'kalaga'} at ${s.updated}\n`;
  out += toYaml({
    goal: s.goal,
    status: s.status,
    owner: s.owner,
    branch: s.branch,
    updated: s.updated,
    modified_files: s.modified_files,
    negative_constraints: s.negative_constraints,
    next_step: s.next_step,
    notes: s.notes,
  });
  fs.writeFileSync(f, out);
}

/** Merge a partial update into the current state (or a blank one), bumping
 *  `updated`. This is what tailers call as facts change. */
export function mergeState(repoDir: string, patch: Partial<HandoffState>, source: HandoffState['_source'] = 'tailer'): HandoffState {
  const cur = loadState(repoDir) ?? blankState(repoDir, null);
  const next: HandoffState = { ...cur, ...patch, updated: new Date().toISOString(), _source: source };
  if (patch.branch !== undefined) next.branch = patch.branch;
  if (!next.modified_files.length) next.modified_files = [];
  saveState(repoDir, next);
  return next;
}

/** The prompt we inject when launching the receiving agent. Plain text,
 *  works with --append-system-prompt or as an initial prompt. */
export function handoffPrompt(s: HandoffState): string {
  return [
    `Kalaga handoff — continue this work. Read ${'.kala/state.yaml'} in the project root before acting.`,
    `Goal: ${s.goal}`,
    `Last owned by: ${s.owner ?? 'unknown'}${s.branch ? ` on branch ${s.branch}` : ''}.`,
    s.modified_files.length ? `Modified files: ${s.modified_files.join(', ')}` : '',
    s.negative_constraints.length ? `DO NOT repeat (already failed): ${s.negative_constraints.join(' | ')}` : '',
    `Next step: ${s.next_step}`,
    s.notes ? `Context: ${s.notes}` : '',
  ].filter(Boolean).join('\n');
}
