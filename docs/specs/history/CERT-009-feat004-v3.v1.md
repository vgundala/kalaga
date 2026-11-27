# CERT-009 — Certification of FEAT-004 v3

| Field | Value |
|-------|-------|
| **ID** | CERT-009 |
| **Version** | v1 |
| **Status** | `final` |
| **Date** | 2026-11-27 |
| **Certifier** | Technical lead |
| **Builder** | Delivery turn (`fa26aa5`) |
| **Spec under test** | FEAT-004 v3 → [`FEAT-004-continuous-checkpointing.v3.md`](../FEAT-004-continuous-checkpointing.v3.md) |
| **Also constrained by** | ARCH-001 v1; SEC-001 v1; FEAT-003 v1; FEAT-004 v2 (done, CERT-008) |
| **Tree** | `kalaga` (repo root) @ **0.8.0** |

---

## 1. Verdict

**Final verdict: `pass`**

All `FEAT-004 v3` requirements (`K22`–`K27`) are `met`. Cross-vendor overlap suppression and `tool_use_id` deduplication prevent double-counting when `claude`, `agy`, `cursor`, and `grok` hooks coexist in the same repository. No waivers.

---

## 2. Requirement matrix

| ID | Result | Evidence |
|----|--------|----------|
| K22 | met | `SUPPORTED_HOOK_AGENTS = ['claude', 'agy', 'cursor', 'grok']`; `defaultInstallAgents` filters by `isInstalled`; `uninstallHooks` targets all four; `hooksStatus` & CLI `hooks status` report all four with per-agent error isolation |
| K23 | met | `installCursorHooks` non-destructively merges `.cursor/hooks.json` (`version: 1`, `hooks.postToolUse`, `hooks.stop`), warns if unignored, refuses symlinks, aborts on malformed JSON |
| K24 | met | `installGrokHooks` writes/merges `.grok/hooks/kalaga-checkpoint.json` using `command` + `args` (`node` wrapper on `win32`), unlinks empty Kalaga file on uninstall, warns if unignored + prints `/hooks-trust` note, refuses symlinks, aborts on malformed JSON |
| K25 | met | `findRepoRoot` resolves `cwd` → `workspaceRoot` → `workspace_roots[0]` → `workspacePaths[0]` → `fallbackCwd`; `isSelfEdit` detects Cursor/Grok `.kala/state.yaml` & `kala state` edits; vendor outputs verified (`additional_context` / `followup_message` / `loop_count` for Cursor; `PostToolUse` `additionalContext` / `Stop` `block` filtering non-`end_turn` teardown fires & `subagentType` for Grok) |
| K26 | met | `isForeignOverlap()` suppresses compat `--agent claude` with `cursor_version` when `.cursor/hooks.json` has Kalaga and `--agent claude`/`cursor` with `GROK_HOOK_EVENT` when `.grok/hooks/kalaga-checkpoint.json` has Kalaga; `lastToolUseId` dedups identical `tool_use_id` / `toolUseId` |
| K27 | met | Unit tests `K22`–`K27` in `tests/run.ts` and `H-04` / `H-05` in `scripts/qa-e2e-regression.sh` verified across Docker Node `v22.23.5` and local Node `v24.14.0`, plus live `cursor-agent` and `grok` hook runs |

---

## 3. Verification

### Dual-Runtime Automated (`v22.23.5` Docker & `v24.14.0` Local)

- `npm run build` → 18 files emitted to `dist/` (clean).
- `npm test` → **97 passed, 0 failed** (including `K22`–`K27`).
- `npm run test:e2e:auto` → **Pass=21, Fail=0, Blocked=14** (covering `H-01`–`H-05`; `F-*` gated by `--auto-only`).

### Live Real-Agent Verification (all 4 hooks installed together)

| Agent | Result | Evidence |
|-------|--------|----------|
| `cursor-agent -p --trust --force` (`v2026.11.22`) | **Pass** | Executed `PostToolUse`, updated `.kala/state.yaml`, reset `.hook-state.json` (`editsSinceCheckpoint: 0`, zero double-counting), zero `.kala/hook-errors.log` |
| `grok -p` (`v1.0.92`, `GROK_FOLDER_TRUST=0`) | **Pass on mid-turn hooks & dedup; `-p` Stop timeout residual** | Fired `.grok/hooks/kalaga-checkpoint.json`, suppressed overlapping `.claude/settings.local.json` (`editsSinceCheckpoint: 1`), nudged and updated `app.txt` + `.kala/state.yaml`, zero errors (`grok -p` hit `90s` `timeout` `rc=124` on the `Stop` continuation turn) |

---

## 4. Waivers & Residuals

- **Waivers:** None.
- **Residuals:**
  - Headless print mode (`-p`) on `agy` and `grok` can remain open past turn completion waiting on a `Stop` continuation round (interactive sessions and mid-turn `PostToolUse` checkpoints work normally).
  - Grok ignores repo hooks outside trusted folders (`/hooks-trust` in Grok) and inside shared temporary directories such as `/tmp`.

---

## 5. ARCH-001 Compliance

- **Zero dependencies (A4):** Node stdlib only; `src/hook.ts` imports remain restricted to `node:*` + `./config.ts` (`K1` passes).
- **Fail-open contract:** Missing/symlinked vendor hook files cleanly fall back without crashing `_hook`.
