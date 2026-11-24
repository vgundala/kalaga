// Interactive "continue on →" picker. Reads a single keypress from stdin,
// no dependencies. Shows a numbered shortlist.
//   limit tier (default): Enter = recommended pick
//   clean tier (stayDefault): Enter = stay / back to shell (FEAT-001 E7)
//   off-TTY / EOF: stay (never auto-launch from a closed pipe)
// `q` / `e` = stay, in every tier (E8).
import { createInterface } from 'node:readline';
import process from 'node:process';
import type { Recommendation } from './router.ts';
import type { AgentUsage } from './ledger.ts';

export interface PickResult {
  agent: string;      // chosen agent key (meaningless when stay)
  wait: boolean;      // true if the user chose to wait for a reset instead
  stay?: boolean;     // FEAT-001 E10: true = user declined, launch nothing
}

export interface PickOptions {
  /** FEAT-001 E7: Enter declines (stay) instead of taking the recommendation. */
  stayDefault?: boolean;
  /** Header line above the shortlist (defaults by mode). */
  header?: string;
  onKey?: (k: string) => void;
}

/** Pure answer decoder — unit-tested. Off-TTY empty/garbage → stay. */
export function interpretPickAnswer(
  raw: string,
  opts: { stayDefault?: boolean; hasDead: boolean; recCount: number; stdinIsTTY: boolean },
): 'stay' | 'wait' | number {
  const n = raw.trim().toLowerCase();
  if (n === 'q' || n === 'e') return 'stay';
  if (n === '') {
    if (!opts.stdinIsTTY || opts.stayDefault) return 'stay';
    return 0; // Enter = recommendation
  }
  if (n === '0' && opts.hasDead) return 'wait';
  const idx = parseInt(n, 10) - 1;
  if (Number.isInteger(idx) && idx >= 0 && idx < opts.recCount) return idx;
  if (!opts.stdinIsTTY || opts.stayDefault) return 'stay';
  return 0;
}

/** Render + prompt. Returns the user's choice. `dead` is the exhausted
 *  agent (offers a "wait for reset" row); null = start mode, no dead agent. */
export function pick(recs: Recommendation[], ledger: AgentUsage[], dead: string | null, opts: PickOptions = {}): Promise<PickResult> {
  const byKey = Object.fromEntries(ledger.map((u) => [u.agent, u]));
  const lines: string[] = [];
  lines.push(opts.header ?? (dead ? `  continue on →` : `  start with →`));
  recs.forEach((r, i) => {
    const u = byKey[r.agent];
    const star = i === 0 ? '*' : ' ';
    const head = u ? `${fmtRemain(u.remaining)} left` : 'unknown';
    lines.push(`  ${star} [${i + 1}] ${r.agent.padEnd(8)} ${head.padEnd(14)} ${r.reason}`);
  });
  if (dead) {
    lines.push(`      [0] ${dead.padEnd(8)} ${'wait for reset'.padEnd(14)} keep it pinned`);
  }
  lines.push(opts.stayDefault
    ? `  (Enter = stay / back to shell, number = hand off, q = stay)`
    : dead
      ? `  (Enter = * recommendation, number to override, 0 = wait, q = stay)`
      : `  (Enter = * recommendation, number to override, q = stay)`);
  process.stderr.write(lines.join('\n') + '\n');

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise<PickResult>((resolve) => {
    rl.question('', (ans) => {
      rl.close();
      opts.onKey?.(ans);
      const decoded = interpretPickAnswer(ans, {
        stayDefault: opts.stayDefault,
        hasDead: !!dead,
        recCount: recs.length,
        stdinIsTTY: !!process.stdin.isTTY,
      });
      if (decoded === 'stay') return resolve({ agent: recs[0].agent, wait: false, stay: true });
      if (decoded === 'wait') return resolve({ agent: dead!, wait: true });
      return resolve({ agent: recs[decoded].agent, wait: false });
    });
  });
}

function fmtRemain(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}
