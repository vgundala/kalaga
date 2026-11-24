// The handoff state: one schema, written by Kalaga's tailers (warm, live) and
// optionally enriched by a live-ask of the agent at a chosen seam.
// Shape mirrors the user's .session_state.yaml protocol so any agent that
// already reads that file reads this one too.
import fs from 'node:fs';
import path from 'node:path';
import { stateFile } from '../config.ts';
import { isValidSessionId } from '../util/sessionid.ts';
import { toYaml } from '../util/yaml.ts';

export interface SessionRecord {
  id: string;        // vendor-native resume token (Claude: uuid, no .jsonl)
  at: string;        // ISO when captured
}

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
  /** FEAT-003 H1: bullets of what already landed (code, specs, decisions). */
  done: string[];
  /** FEAT-002 R1: captured vendor session ids, per agent (last write wins). */
  sessions: Record<string, SessionRecord | undefined>;
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
    done: [],
    sessions: {},
    _source: 'manual',
  };
}

/** FEAT-003 H5: thin = not enough grounded context for a taker to continue
 *  without inventing a new direction. Pure. Thin when ANY of: goal blank /
 *  "not captured" / <8 chars; done empty AND notes <40 chars; next_step is
 *  the blank default. */
export function isThinState(s: HandoffState): boolean {
  if (s.goal.startsWith('not captured') || s.goal.trim().length < 8) return true;
  if (s.done.length === 0 && s.notes.trim().length < 40) return true;
  if (s.next_step.trim() === 'read the repo, then ask the user what to do') return true;
  return false;
}

/** FEAT-002 R1/R3: persist a captured session id for one agent. Last write
 *  wins; returns the updated state. Skips write when id fails the allowlist
 *  (launch.isValidSessionId — resume argv must never see flag-shaped tokens). */
export function captureSession(repoDir: string, agent: string, id: string): HandoffState {
  const cur = loadState(repoDir) ?? blankState(repoDir, null);
  if (!isValidSessionId(id)) return cur;
  const next: HandoffState = { ...cur, updated: new Date().toISOString(), _source: cur._source ?? 'tailer' };
  next.sessions = { ...cur.sessions, [agent]: { id, at: new Date().toISOString() } };
  saveState(repoDir, next);
  return next;
}

/** FEAT-002 R1: parse the nested `sessions:` map (one level under agents).
 *  Tolerant: bad lines are skipped, not fatal. */
function parseSessions(raw: string): Record<string, SessionRecord | undefined> {
  const out: Record<string, SessionRecord | undefined> = {};
  let inSessions = false;
  let agent: string | null = null;
  for (const line of raw.split('\n')) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    if (/^sessions:\s*$/.test(line)) { inSessions = true; agent = null; continue; }
    if (/^[a-z_]+:/i.test(line) && !line.startsWith(' ')) { inSessions = false; agent = null; continue; }
    if (!inSessions) continue;
    const am = line.match(/^  ([a-z]+):\s*$/);
    if (am) { agent = am[1]; out[agent] = undefined; continue; }
    const kv = agent && line.match(/^    (id|at):\s*(.+)$/);
    if (kv) {
      const val = kv[2].replace(/^"|"$/g, '');
      if (kv[1] === 'id' && !isValidSessionId(val)) {
        // Drop poisoned / flag-shaped ids — do not keep a partial record.
        delete out[agent];
        agent = null;
        continue;
      }
      out[agent] = { ...(out[agent] ?? { id: '', at: '' }), [kv[1]]: val };
    }
  }
  return out;
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
    const lists: Record<string, string[]> = { modified_files: [], negative_constraints: [], done: [] };
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
      done: lists.done,
      next_step: top.next_step ?? '',
      notes: top.notes ?? '',
      sessions: parseSessions(raw),
    };
    if (!s.goal) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveState(repoDir: string, s: HandoffState): void {
  // SEC-001 S1–S4: refuse symlinked state paths, require a real .kala dir,
  // write 0600, and replace atomically (temp + rename).
  const dir = path.dirname(stateFile(repoDir));
  const f = stateFile(repoDir);
  let st: fs.Stats;
  try {
    st = fs.lstatSync(dir);
  } catch {
    fs.mkdirSync(dir, { recursive: true });
    st = fs.lstatSync(dir);
  }
  if (st.isSymbolicLink()) throw new Error(`refusing to write state: ${dir} is a symlink`);
  if (!st.isDirectory()) throw new Error(`refusing to write state: ${dir} is not a directory`);
  try {
    if (fs.lstatSync(f).isSymbolicLink()) throw new Error(`refusing to write state: ${f} is a symlink`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const clean = { ...s };
  delete (clean as { _source?: string })._source;
  // FEAT-002 R1: emit sessions as a nested map (drop undefined entries).
  const sessions: Record<string, { id: string; at: string }> = {};
  for (const [k, v] of Object.entries(s.sessions ?? {})) if (v?.id && v?.at) sessions[k] = v;
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
    done: s.done,
    next_step: s.next_step,
    notes: s.notes,
    sessions,
  });
  const tmp = path.join(dir, `.${path.basename(f)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, out, { mode: 0o600 });
  fs.renameSync(tmp, f);
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

// P1: handoffPrompt removed — the single prompt API lives in src/prompt.ts
// (handoffInject), which sanitizes untrusted state fields.
