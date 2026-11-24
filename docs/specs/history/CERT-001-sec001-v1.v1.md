# CERT-001 — Certification of SEC-001 v1

| Field | Value |
|-------|-------|
| **ID** | CERT-001 |
| **Version** | v1 |
| **Status** | `final` |
| **Date** | 2026-11-21 |
| **Certifier** | Technical lead |
| **Builder** | (prior agent build; package `0.2.0`) |
| **Spec under test** | SEC-001 v1 → [`SEC-001-security-remediation.v1.md`](../SEC-001-security-remediation.v1.md) |
| **Also constrained by** | ARCH-001 v1 |
| **Tree** | `kalaga` (repo root) @ package version **0.2.0** |

---

## 1. Verdict

**Final verdict: `pass-with-waivers`**

All High/product-critical IDs (trust gate, state I/O, prompt sanitize, honest limits, absolute spawn) are `met`. Four lower IDs are `partial` and waived below with follow-ups. No High ID is missing.

---

## 2. Requirement matrix

| ID | Result | Evidence | Notes |
|----|--------|----------|-------|
| T1 | met | `src/trust.ts` `trustFile` / `writeGrants` — `grants:` with path/granted_at/expires_at, mode 0600 | |
| T2 | partial | `hasTrustGrant` realpath + `!isExpired` | Expired ignored; **not** pruned (written back) on read — waiver W1 |
| T3 | met | `recordTrustGrant` upsert + `trustTtlDays()` | TL re-ran: grant then revoke |
| T4 | met | `runAgent(..., trust)`; flags only when `trust && trustFlags.length` | `launch.ts:20-28` |
| T5 | met | No unconditional trustFlags; all launch sites go through `resolveTrust` | `index.ts` start/run/switch/handoff |
| T6 | met | Option A `[y/N]`; non-TTY → false (no grant) | `promptTrustGrant` |
| T7 | met | `resolveTrust` → `promptTrustGrant` (returns true if grant exists, else prompts) | Same helper on handoff |
| T8 | met | `kala trust` (status) / `kala trust revoke` / `--all` | `doTrust` |
| T9 | met | `trust_ttl_days:` regex in `trustTtlDays` | |
| T10 | met | README §Security trust paragraph | |
| P1 | met | `handoffInject` only; `handoffPrompt` removed | `prompt.ts` / `state.ts` comment |
| P2 | met | `sanitizeHandoffField` caps 1000/500/2000, strips C0+DEL | TL re-ran sanitize cases |
| P3 | met | Default short inject; rich via `inject_rich_prompt: true` | |
| P4 | partial | `nextStepHint` printed in `offerHandoff` | **After** picker, not before — waiver W2 |
| P5 | met | README: instruction surface, gitignore `.kala/`, no secrets | |
| S1 | met | `lstat` symlink refuse on `.kala` and `state.yaml` | TL: target file unchanged |
| S2 | met | temp `.<basename>.<pid>.tmp` + `renameSync` | |
| S3 | met | `.kala` must be real directory | |
| S4 | met | write mode `0o600` | TL: mode bits 0600 |
| L1 | met | `doRun`: empty tail → `hit = null` → no picker | |
| L2 | met | `--assume-limit` or TTY `[y/N]`; else return | |
| L3 | met | limit note ≤200 into `negative_constraints`, deduped | `refreshState` |
| L4 | met | `limitPatterns` only in `AGENTS`; config has no pattern keys | |
| B1 | met | `resolveExecutable` | |
| B2 | met | per-process `resolvedCache`; grok absolute path preserved | |
| B3 | met | spawn resolved path; missing → message + 127 | |
| B4 | met | README: resolve once, no re-hash | |
| C1 | met | `claudeProjectDir` shared | |
| C2 | met | `claudeSessionFiles` cwd filter; residual in README | cwd sniffed from file **tail** — weaker if cwd only in head; residual already documented |
| C3 | met | ledger + launch use shared helpers | |
| R1 | met | `tailBytes(..., USAGE_MAX_BYTES)` in `claudeUsage` | |
| R2 | partial | ledger: `CURSOR_META_SCAN_CAP=2000` | `lastSessionText` cursor walk in `launch.ts` still uncapped — waiver W3 |
| R3 | met | grok `limit 1` | |
| M1 | met | `loadAgents` shallow copies; TL: mutate copy, builtin ceiling unchanged | |
| M2 | met | ceilings + TTL + inject_rich only | |
| M3 | partial | `$KALA_HOME` used in `config.ts` / `trust.ts` / `prompt.ts` | **Not documented in README** — waiver W4 |
| U1 | met | `OutputRing` gone (`trap.ts` comment); prompts in `prompt.ts` | |
| U2 | met | L3 wired in `refreshState` | |
| U3 | met | README install `chmod 755`, user-local | |

---

## 3. Verification checklist (SEC-001 §7)

| Item | TL result |
|------|-----------|
| Cold cursor, no grant → no `--trust` until `y` | **Code-path met** (`resolveTrust` / `runAgent` trust arg). Live cursor argv not re-probed in this certify session. |
| After grant → handoff/switch includes `--trust` | **Code-path met** |
| Symlink state → write refused | **Pass** (TL fixture) |
| `kala run agy` clean exit → no picker | **Code-path met** (L1) |
| Limit phrase in Claude tail → picker | **Code-path met** (`scanChunk` + `doRun`) |
| Control-char / oversized `next_step` → sanitized | **Pass** (TL fixture) |
| `loadAgents` twice does not corrupt builtins | **Pass** (TL fixture) |

Builder claimed 19 automated checks; **no `testdata/` or test script is checked into the tree.** TL re-ran an independent fixture script covering sanitize, M1, trust grant/revoke, S1/S2/S4, L1 scan, B1, C1 — all passed. Prefer landing a durable test command under OPS-001.

---

## 4. Waivers

| ID | Reason | Follow-up |
|----|--------|-----------|
| **W1 / T2** | Expired grants ignored (security intent). Prune-on-read writeback not implemented. | **Cleared** in OPS-001 v2 (CERT-003) — prune-on-write |
| **W2 / P4** | Hint is visible before taker **launch**, but after picker. Spec text required before picker. | **Cleared** in OPS-001 v2 (CERT-003) — hint before `pick()` in `offerHandoff` |
| **W3 / R2** | Ledger walk capped; trap/session cursor walk in `launch.ts` still unbounded. | **Cleared** in OPS-001 v2 (CERT-003) — shared `CURSOR_META_SCAN_CAP` |
| **W4 / M3** | `$KALA_HOME` honored in code; README never names the env var. | **Cleared** in OPS-001 v2 (CERT-003) — README documents `$KALA_HOME` |

Original certify verdict remains `pass-with-waivers` (historical). Open audit findings from that certify are now closed; see CERT-003.

---

## 5. ARCH-001 compliance

| Check | Result |
|-------|--------|
| A2 store-based trap (no piped TTY) | met |
| A4 argv spawn / `execFileSync` (no `shell: true`) | met |
| A5 picker still on handoff | met |
| A6 no runtime `dependencies` in package.json | met (`0.2.0`, engines `>=24`) |
| A1 + `trust` command added | met (SEC-001 allowed) |

---

## 6. Certifier notes

Build matches the locked approach: Option A trust grants, conditional `--trust`, honest empty-store handling, atomic/symlink-safe state, single sanitizing inject API, resolved binaries, shared Claude helper. Package version **0.2.0** is consistent with a post-SEC ship.

**Amendments recommended (do not reopen SEC-001 v1):** fold W2–W4 into OPS-001 lock or a tiny SEC-001 v2 if you want a clean `pass` with zero waivers before wide share.

**Sign-off:** TL confirms **`pass-with-waivers`**. INDEX → SEC-001 v1 `done`.
