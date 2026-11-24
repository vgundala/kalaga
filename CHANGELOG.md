# Changelog

## 0.6.2 — 2026-11-24

Release package after verifying the 0.6.1 pre-release security audit.

- **Audit verdict:** four 0.6.1 findings remain correctly fixed (owner
  sanitize + allowlist; `--assume-limit` off-TTY gate; status `done?`
  defensive; leading `--flag` bare start). `npm test` — **38 passed**.
- **SECURITY.md** updated for owner allowlist and off-TTY assume-limit.
- **Docs:** CERT records → `docs/specs/history/`; handoff blurbs removed from
  living specs; README / CONTRIBUTING / docs hub demote internal process;
  etymology, support policy, and maintainer attribution from the 0.6.x polish
  pass included in this release tree.

## 0.6.1 — 2026-11-24

Pre-release security audit (source distribution). Four findings fixed:

- **Owner sanitization.** A poisoned `.kala/state.yaml` `owner` value could
  carry control/escape bytes into the handoff prompt. The owner is now
  sanitized before interpolation (prompt) and restricted to known agent keys
  on load (state) — anything else becomes `null`.
- **`--assume-limit` off-TTY.** The flag now only pre-approves a limit
  assumption on a TTY. Off-TTY (scripts/CI/piped stdin) it is ignored unless
  `KALA_ASSUME_LIMIT=1` is also set, so a flag left in a wrapper script or a
  copied command can't silently pre-approve what nobody saw.
- **Status `done` crash.** `kala status` crashed on state written by an older
  version (no `done:` key). Now defensive (`state.done?.`).
- **`--strict-state` at bare start.** `kala --strict-state` (and any leading
  `--flag`) now starts a bare run instead of falling through to help, matching
  how `--assume-limit` already behaved.

Tests: 38 (was 36). LICENSE copyright updated to Infoverse Data LLC (MIT).

## 0.6.0 — 2026-11-24

Production-grade open-source polish (source distribution; no binary packaging).

### Platform (OPS-003)

- `resolveExecutable` uses `path.delimiter` and Windows `PATHEXT` / `.cmd` /
  `.exe` rules; Unix keeps the executable-bit check.
- `bin/kala.cmd` for PowerShell-friendly launches.
- README install sections for Linux, macOS, Windows (Git Bash + PowerShell).

### CI (OPS-002)

- GitHub Actions workflow: Node 24, `npm test` only (no `npm install`).

### Security (from 0.5.1)

- Resume session-id allowlist; rich-inject path sanitize; `SECURITY.md`.

### Professional surface

- README rewrite; `CONTRIBUTING.md`; `CODE_OF_CONDUCT.md`; `.editorconfig`;
  `.gitattributes`; expanded `.gitignore`.
- CLI messages use a consistent `kalaga:` prefix (no emoji markers).
- User guide aligned with install story; package metadata (`license`,
  `files`, `keywords`, `engines`).
- Name etymology codified: *Kalaga* (Telugu) = mix / blending; `kala` = CLI
  form (README, guide, paper, ARCH-001, `package.json` description).
- README / CONTRIBUTING: best-effort support — report bugs, fork for
  features, PRs appreciated.
- Copyright holder: **Infoverse Data LLC** (MIT); author/maintainer:
  **Vinay Gundala** (LICENSE, README, `package.json`, paper).
- README motivation: combine subscriptions / efficient token use; Google AI
  Pro / Antigravity limits as the forcing function.
- Docs cleanup: CERT records → `docs/specs/history/`; handoff blurbs removed
  from living specs; README/CONTRIBUTING/docs hub demote internal process.

### Tests

- 36 checks including OPS-003 PATH delimiter coverage.

## 0.5.1 — 2026-11-24

Security hardening (source-trust pass before public clone):

- Resume session ids allowlisted (`[A-Za-z0-9][A-Za-z0-9._-]{0,127}`) on
  normalize/capture/YAML load/`kala resume` — blocks flag-shaped
  `sessions.*.id` values from becoming vendor argv.
- Rich inject sanitizes `modified_files` (controls + path caps).
- `SECURITY.md` + README: dual-channel handoff (sanitized inject vs
  on-disk state agents are told to read) and residual risks stated plainly.
- `npm test`: +3 security checks (id allowlist, poisoned load/capture,
  rich path sanitize).

## 0.5.0 — 2026-11-22

FEAT-003 v1 (handoff state protocol + seam enrichment):

- New `done: []` in `.kala/state.yaml` — shared bullets of what already
  landed, readable/writable by every CLI (agent, live-ask, or
  `kala state done <text>`). Capped at 12 items × 300 chars (drop oldest).
- Protocol inject is now the **default** for all handoff launches (amends
  SEC-001 P3 for handoffs only, still sanitized + capped): pointer +
  `Goal:` + `Done:` bullets + `Next step:` + `Avoid:` + standing orders.
  `inject_rich_prompt: true` adds `Context:` + modified files. Resume stays
  inject-free (FEAT-002).
- Standing orders: every launch is told to keep `.kala/state.yaml` current
  before stopping; first-run (uncaptured) launches print them on stderr with
  a "set goal/next_step" nudge.
- Live-ask: on a limit handoff or `kala switch`, Kalaga asks the dying agent
  (headless print mode, piped stdio, 45s timeout, never `shell: true`) for a
  YAML state update, sanitizes it, and merges it as `_source: live-ask`.
  Fail-soft — a failed/timeout ask just keeps the existing state.
- Thin-state warning before a cross-agent launch when goal/done/next look
  blank (`kalaga: handoff state looks thin — taker may drift`);
  `kala switch <agent> --strict-state` aborts instead.
- `kala status` shows the `done` count + first bullet.
- Fixed CERT-004 W1/R4: `refreshState` now captures the dead agent's session
  **before** returning (the old call was unreachable dead code), so
  `kala recover` → handoff captures a resumable session.
- `npm test`: 32 checks (was 25) — protocol inject shape, list caps,
  `isThinState`, live-ask YAML parser fixtures, `done` append + cap,
  live-ask argv.

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
