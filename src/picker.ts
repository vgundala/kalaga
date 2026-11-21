// Interactive "continue on →" picker. Reads a single keypress from stdin,
// no dependencies. Shows a numbered shortlist, Enter = recommended pick.
import { createInterface } from 'node:readline';
import process from 'node:process';
import type { Recommendation } from './router.ts';
import type { AgentUsage } from './ledger.ts';

export interface PickResult {
  agent: string;      // chosen agent key
  wait: boolean;      // true if the user chose to wait for a reset instead
}

/** Render + prompt. Returns the user's choice. `dead` is the exhausted
 *  agent (offers a "wait for reset" row); null = start mode, no dead agent. */
export function pick(recs: Recommendation[], ledger: AgentUsage[], dead: string | null, onKey?: (k: string) => void): Promise<PickResult> {
  const byKey = Object.fromEntries(ledger.map((u) => [u.agent, u]));
  const lines: string[] = [];
  lines.push(dead ? `  continue on →` : `  start with →`);
  recs.forEach((r, i) => {
    const u = byKey[r.agent];
    const star = i === 0 ? '*' : ' ';
    const head = u ? `${fmtRemain(u.remaining)} left` : 'unknown';
    lines.push(`  ${star} [${i + 1}] ${r.agent.padEnd(8)} ${head.padEnd(14)} ${r.reason}`);
  });
  if (dead) {
    lines.push(`      [0] ${dead.padEnd(8)} ${'wait for reset'.padEnd(14)} keep it pinned`);
    lines.push(`  (Enter = * recommendation, number to override, 0 = wait)`);
  } else {
    lines.push(`  (Enter = * recommendation, number to override)`);
  }
  process.stderr.write(lines.join('\n') + '\n');

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise<PickResult>((resolve) => {
    rl.question('', (ans) => {
      rl.close();
      const n = ans.trim();
      if (onKey) onKey(n);
      if (n === '') return resolve({ agent: recs[0].agent, wait: false });
      if (n === '0' && dead) return resolve({ agent: dead, wait: true });
      const idx = parseInt(n, 10) - 1;
      if (Number.isInteger(idx) && recs[idx]) return resolve({ agent: recs[idx].agent, wait: false });
      // fallback: recommendation
      resolve({ agent: recs[0].agent, wait: false });
    });
  });
}

function fmtRemain(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}
