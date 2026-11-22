// SEC-001 P1–P3: the single handoff-prompt API.
//
// `.kala/state.yaml` is an untrusted instruction surface — any agent (or a
// hostile repo) can write it. Every field is sanitized before it enters the
// receiving agent's prompt: ASCII controls stripped (except \n \t), length
// capped, truncated with ….
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import type { HandoffState } from './state/state.ts';

export const FIELD_MAX = { goal: 1000, next_step: 500, notes: 2000 } as const;

/** P2: strip C0 controls (keep \n \t) + DEL, cap length, truncate with ….
 *  Removes 0x00–0x08, 0x0B–0x1F (incl. CR), and 0x7F. Pure, unit-testable. */
export function sanitizeHandoffField(s: string, max: number): string {
  const clean = s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

/** M2/P3: rich inject only if config has `inject_rich_prompt: true`. */
export function injectRichPrompt(): boolean {
  try {
    const p = (process.env.KALA_HOME ?? path.join(homedir(), '.kala')) + '/config.yaml';
    const m = readFileSync(p, 'utf8').match(/^inject_rich_prompt:\s*(true|false)\s*$/m);
    return m?.[1] === 'true';
  } catch { return false; }
}

/** P3: default inject = pointer + next step only (short, low blast radius).
 *  Rich inject (goal/files/negatives/notes) only when `rich` (config
 *  inject_rich_prompt: true). */
export function handoffInject(s: HandoffState, rich = false): string {
  const st: HandoffState = {
    ...s,
    goal: sanitizeHandoffField(s.goal, FIELD_MAX.goal),
    next_step: sanitizeHandoffField(s.next_step, FIELD_MAX.next_step),
    notes: sanitizeHandoffField(s.notes, FIELD_MAX.notes),
  };
  const base = `Kalaga handoff from ${st.owner ?? 'another agent'}. Read .kala/state.yaml in the project root before doing anything.`;
  if (!rich) return `${base} Next step: ${st.next_step}`;
  return [
    base,
    `Goal: ${st.goal}`,
    st.modified_files.length ? `Modified files: ${st.modified_files.join(', ')}` : '',
    st.negative_constraints.length ? `DO NOT repeat (already failed): ${st.negative_constraints.join(' | ')}` : '',
    `Next step: ${st.next_step}`,
    st.notes ? `Context: ${st.notes}` : '',
  ].filter(Boolean).join('\n');
}

/** P4: one-line continuation hint for stderr before the picker. */
export function nextStepHint(s: HandoffState): string {
  return `next step: ${sanitizeHandoffField(s.next_step, 160)}`;
}
