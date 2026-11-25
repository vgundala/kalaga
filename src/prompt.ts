// SEC-001 P1–P3: the single handoff-prompt API.
//
// `.kala/state.yaml` is an untrusted instruction surface — any agent (or a
// hostile repo) can write it. Every field is sanitized before it enters the
// receiving agent's prompt: ASCII controls stripped (except \n \t), length
// capped, truncated with ….
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { kalagaHome } from './config.ts';
import type { HandoffState } from './state/state.ts';

export const FIELD_MAX = {
  goal: 1000, next_step: 500, notes: 2000,
  // FEAT-003 H2: list-item caps (done: 12 items × 300; negatives: 20 × 200).
  doneItem: 300, doneItems: 12, negItem: 200, negItems: 20,
  // Rich inject only: path strings from git / YAML — same control strip + cap.
  pathItem: 260, pathItems: 40,
} as const;

/** FEAT-003 H2: cap a list of untrusted items — trim each to `item` chars,
 *  drop beyond `count` (keep the newest = tail). Reuses sanitizeHandoffField
 *  for control stripping. Pure. */
export function sanitizeHandoffList(items: string[], count: number, item: number): string[] {
  const tail = items.slice(-count);
  return tail.map((it) => sanitizeHandoffField(it, item));
}

/** FEAT-003 H4: fixed standing orders — not user-controlled, appended to
 *  handoff / non-fresh launches and to the first-run stderr notice. */
export const STANDING_ORDERS = [
  'Maintain .kala/state.yaml as you work. Before you stop or hit a limit, update:',
  'goal, done (bullets of what landed), next_step (one action), notes, and',
  'negative_constraints (failures not to repeat). The next agent will only see',
  'that file plus a short inject.',
].join(' ');

/** Strip terminal escapes, C0/C1 controls (keep \n \t), bidi overrides, and DEL.
 *  Cap length and truncate with …. Pure, unit-testable.
 *  ANSI is removed before C0 so ESC does not leave a `[31m` fragment. */
export function sanitizeHandoffField(s: string, max: number): string {
  const clean = s
    .replace(/\x1b\[[0-9;?<=>!]*[A-Za-z]/g, '')
    .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b./g, '')
    .replace(/[\u0080-\u009f]/g, '')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

/** M2/P3: rich inject only if config has `inject_rich_prompt: true`. */
export function injectRichPrompt(): boolean {
  try {
    const p = path.join(kalagaHome(), 'config.yaml');
    const m = readFileSync(p, 'utf8').match(/^inject_rich_prompt:\s*(true|false)\s*$/m);
    return m?.[1] === 'true';
  } catch { return false; }
}

/** FEAT-003 H3/H4 — amends SEC-001 P3: the default handoff inject is now
 *  PROTOCOL mode (pointer + goal + done + next + avoid + standing orders),
 *  still sanitized + capped. `rich` (config inject_rich_prompt: true) adds
 *  notes + modified files on top. Resume launches stay inject-free (FEAT-002). */
export function handoffInject(s: HandoffState, rich = false, fromOwner?: string | null): string {
  const st: HandoffState = {
    ...s,
    goal: sanitizeHandoffField(s.goal, FIELD_MAX.goal),
    next_step: sanitizeHandoffField(s.next_step, FIELD_MAX.next_step),
    notes: sanitizeHandoffField(s.notes, FIELD_MAX.notes),
    done: sanitizeHandoffList(s.done, FIELD_MAX.doneItems, FIELD_MAX.doneItem),
    negative_constraints: sanitizeHandoffList(s.negative_constraints, FIELD_MAX.negItems, FIELD_MAX.negItem),
    modified_files: sanitizeHandoffList(s.modified_files, FIELD_MAX.pathItems, FIELD_MAX.pathItem),
  };
  // fromOwner omitted: keep the historical "from <owner>" line so 1- and
  // 2-arg callers stay stable. When the caller passes the previous owner,
  // name them only if they are not the agent about to start.
  let base: string;
  if (fromOwner === undefined) {
    const from = sanitizeHandoffField(st.owner ?? 'another agent', 80);
    base = `Kalaga handoff from ${from}. Read .kala/state.yaml in the project root before doing anything.`;
  } else if (fromOwner && fromOwner !== s.owner) {
    const from = sanitizeHandoffField(fromOwner, 80);
    base = `Kalaga handoff from ${from}. Read .kala/state.yaml in the project root before doing anything.`;
  } else {
    base = 'Kalaga session context. Read .kala/state.yaml in the project root before doing anything.';
  }
  const lines = [
    base,
    `Goal: ${st.goal}`,
    st.done.length ? st.done.map((d) => `Done: ${d}`).join('\n') : '',
    `Next step: ${st.next_step}`,
    st.negative_constraints.length ? `Avoid: ${st.negative_constraints.join(' | ')}` : '',
    rich && st.modified_files.length ? `Modified files: ${st.modified_files.join(', ')}` : '',
    rich && st.notes ? `Context: ${st.notes}` : '',
    STANDING_ORDERS,
  ].filter(Boolean);
  return lines.join('\n');
}

/** P4: one-line continuation hint for stderr before the picker. */
export function nextStepHint(s: HandoffState): string {
  return `next step: ${sanitizeHandoffField(s.next_step, 160)}`;
}
