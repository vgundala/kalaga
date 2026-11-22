// The trap: watch an agent's output for a "limit reached" signature.
// Two capture modes, matching the design:
//   (a) warm-ledger — the state.yaml was already being kept live, so when the
//       agent dies we already have the handoff; nothing to scrape from a corpse.
//   (b) live-ask    — at a chosen seam, spend a little of the LIVE agent's
//       remaining budget (print mode) to get a proper summary before it dies.
// This module handles (a): pattern-match on streamed output + exit code.
import type { AgentConfig } from './config.ts';

export interface LimitHit {
  agent: string;
  matched: string;       // the signature that fired
  line: string;          // the offending line, for the user to see
  exitCode: number | null;
}

/** Returns the matched signature if `line` looks like a quota/limit failure
 *  for `agent`, else null. */
export function matchLimit(line: string, agent: AgentConfig): string | null {
  const lower = line.toLowerCase();
  for (const pat of agent.limitPatterns) {
    if (new RegExp(pat, 'i').test(lower)) return pat;
  }
  return null;
}

/** Scan a chunk of output; return the first LimitHit found, else null. */
export function scanChunk(chunk: string, agent: AgentConfig, exitCode: number | null = null): LimitHit | null {
  for (const line of chunk.split('\n')) {
    const m = matchLimit(line, agent);
    if (m) return { agent: agent.key, matched: m, line: line.trim().slice(0, 200), exitCode };
  }
  return null;
}
// U1: OutputRing removed — nothing consumed it (the trap is store-tail-based,
// not streamed, so there is no in-process ring to keep).

// ---------- FEAT-001: evidence-tiered exit classification ----------

export type ExitTier = 'limit' | 'suspect' | 'clean';

/** E2: classify an agent exit by evidence. Pure — unit-testable.
 *  limit   — a limit signature was found in the session tail (definite)
 *  suspect — no readable tail and a non-zero exit code (no way to verify)
 *  clean   — anything else (zero exit, or store present without signature) */
export function classifyExit(input: { hit: LimitHit | null; exitCode: number; hasTail: boolean }): ExitTier {
  if (input.hit) return 'limit';
  if (!input.hasTail && input.exitCode !== 0) return 'suspect';
  return 'clean';
}
