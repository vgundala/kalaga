// The "router" — deliberately dumb per the design decision.
// No context-window logic, no tag affinity. When an agent hits its limit:
//   rank the FRESH agents by (has quota now) → (least recently used) → (owns the handoff state).
// The result is a shortlist with a recommended pick; the user always confirms.
import type { AgentUsage } from './ledger.ts';
import { WARN_THRESHOLD } from './config.ts';

export interface Recommendation {
  agent: AgentUsage['agent'];
  reason: string;
  score: number; // higher = better; only for ordering, not shown as a magic number
}

export function isFresh(u: AgentUsage): boolean {
  return u.remaining > WARN_THRESHOLD;
}

/** Rank agents that can take over (or start with). Uninstalled CLIs are
 *  never listed; the exhausted one is excluded. */
export function rankTakers(
  ledger: AgentUsage[],
  dead: string | null,
  stateOwner: string | null,
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const u of ledger) {
    if (u.agent === dead) continue;
    if (!u.installed) continue;
    if (!isFresh(u)) {
      // not fresh — still listable, heavily demoted
      recs.push({ agent: u.agent, reason: `low headroom (~${fmt(u.remaining)} left)`, score: -1000 + u.remaining });
      continue;
    }
    let score = 0;
    const bits: string[] = [];
    // least recently used wins (never used = most fresh)
    const age = u.lastUsed ? Date.now() - u.lastUsed : Infinity;
    score += Math.min(age / 3_600_000, 100); // up to +100 per hour since last use
    bits.push(u.lastUsed ? `used ${ago(u.lastUsed)} ago` : 'unused this window');
    // owns the current handoff state → lossless resume
    if (stateOwner && u.agent === stateOwner) {
      score += 250;
      bits.unshift('owns current handoff state');
    }
    recs.push({ agent: u.agent, reason: bits.join(', '), score });
  }
  return recs.sort((a, b) => b.score - a.score);
}

function fmt(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function ago(ms: number): string {
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
