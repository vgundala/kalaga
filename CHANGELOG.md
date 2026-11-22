# Changelog

## 0.4.0 — 2026-11-22

FEAT-002 v1 (session capture + resume):

- Captures each agent's session id as it runs (Claude jsonl name, Grok
  `session_id`, Cursor chat dir) into `.kala/state.yaml`
  (`sessions.<agent>.{id,at}`); never invents ids.
- `kala resume [agent]` reopens a captured conversation by id (claude/grok
  `-r`, cursor `--resume`, agy `--conversation` when known) — no handoff
  inject, full context preserved. Freshness gate: ≤7 days + vendor artifact
  exists where checkable.
- Limit-picker "wait for reset" row now prints `kala resume <dead>` when a
  fresh session was captured.
- Structured `resumeByIdPrefix` config replaces the misleading flat
  `--continue` stub.
- `npm test`: +5 cases (normalize, resume argv, freshness reject, state
  round-trip, id-not-in-inject).

## 0.3.1 — 2026-11-22

OPS-001 v2 (share readiness):

- Closed CERT-001 waivers: **W1** expired trust grants pruned on the write
  path (record/revoke) while `kala trust` still shows them marked;
  **W2** next-step hint now prints *before* the picker; **W3** the trap's
  cursor session walk is bounded by the shared `CURSOR_META_SCAN_CAP`;
  **W4** `$KALA_HOME` documented in README.
- Durable zero-dependency test suite: `npm test` / `node tests/run.ts`
  (20 checks: sanitize, inject, classifyExit, scanChunk, claude dir
  disambiguation, copy-on-load, binary resolve, symlink/atomic/0600 state,
  trust record/prune/revoke).
- LICENSE (MIT) + this CHANGELOG.

## 0.3.0 — 2026-11-21

FEAT-001 v1 (evidence-tiered post-exit handoff):

- Every agent launched via bare `kala` or `kala run` now flows through a
  shared post-exit path with the child's exit code.
- Exit classified as **limit** (signature in store) → limit picker;
  **suspect** (no store + non-zero exit) → `[y/N]` or `--assume-limit`;
  **clean** → stay-default menu (Enter = back to shell, number = hand off).
- `q`/`e` returns to the shell without launching in any tier.
- A clean exit is never a limit hit and never auto-launches.
- `kala --flag` now starts (e.g. `kala --assume-limit`).

## 0.2.0 — 2026-11-21

SEC-001 v1 (security remediation):

- Path-scoped trust grants (`~/.kala/trust.yaml`), Option A cold-start
  prompt, `--trust` only on a valid grant; `kala trust` status/revoke.
- Safe state I/O: refuse symlinked `.kala`/`state.yaml`, atomic temp+rename,
  mode 0600.
- Honest limit detection: empty tail ≠ limit hit; store-less recover needs
  `--assume-limit` or `[y/N]`; limit note persisted on match.
- Prompt sanitization (single `handoffInject` API, caps + control stripping,
  short inject by default).
- Binary resolution to absolute path before spawn; shared Claude
  project-dir helper with cwd disambiguation; bounded store reads;
  config copy-on-load.

## 0.1.0 — 2026-11-21

Baseline: store-based limit trap, per-repo handoff state
(`.kala/state.yaml`), dumb router + picker, per-agent ledger (exact vs
estimate), CLI discovery.
