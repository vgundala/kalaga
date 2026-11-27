# CERT-008 — Certification of FEAT-004 v2

| Field | Value |
|-------|-------|
| **ID** | CERT-008 |
| **Version** | v1 |
| **Status** | `final` |
| **Date** | 2026-11-26 |
| **Certifier** | Technical lead |
| **Builder** | `kalaga-dev` (`FEAT-004 v1` & `v2`), verified by `kalaga-qa` |
| **Spec under test** | FEAT-004 v2 → [`FEAT-004-continuous-checkpointing.v2.md`](../FEAT-004-continuous-checkpointing.v2.md) (carrying forward [`FEAT-004 v1`](../FEAT-004-continuous-checkpointing.v1.md) `K1`–`K18`) |
| **Also constrained by** | ARCH-001 v1; SEC-001 v1; FEAT-003 v1 |
| **Tree** | `kalaga` (repo root) @ **0.7.0** (`Unreleased`) |

---

## 1. Verdict

**Final verdict: `pass`**

All carried-forward `FEAT-004 v1` requirements (`K1`–`K9`, `K12`, `K14`, `K15`, `K17`, `K18`) and all `FEAT-004 v2` amendments/extensions (`K10-v2`, `K11-v2`, `K13-v2`, `K16-v2`, `K19`, `K20`, `K21`) are `met`. No waivers.

---

## 2. Requirement matrix

| ID | Result | Evidence |
|----|--------|----------|
| K1 | met | `bin/kala` fast-path `_hook` dispatch before loading `index`/`ledger`/`picker`/`launch`/`liveask`; hidden from `--help` |
| K2 | met | `src/hook.ts` resolves project root (`cwd` → `workspacePaths[0]` → `process.cwd()`), walks up to `.kala/state.yaml`; missing state emits `{}` exit `0` |
| K3 | met | `src/hooks.ts` wires `claude` into `.claude/settings.local.json` (`PostToolUse` matcher `Edit\|Write\|MultiEdit\|Bash`, and `Stop`); leaves `.claude/settings.json` untouched |
| K4 | met | `claude` `PostToolUse` emits `hookSpecificOutput.additionalContext`; `Stop` checks `stop_hook_active !== true` and emits `{"decision":"block","reason":"..."}` |
| K5 | met | `src/hooks.ts` wires `"kalaga-checkpoint"` into `.agents/hooks.json` (`PostToolUse` grouped, `PreInvocation` flat, `Stop` flat) |
| K6 | met | `agy` hook commands wrap shell-quoted `bin/kala` with existence guard falling back to `printf '{}'` |
| K7 | met | `agy` `PostToolUse` emits `{}`; `PreInvocation` emits `injectSteps[].systemMessage.systemMessage`; `Stop` emits `{"decision":"continue","reason":"..."}` when `continuationActive !== true && terminationReason === "NO_TOOL_CALL"` |
| K8 | met | `.kala/.hook-state.json` tracks `editsSinceCheckpoint`, `lastNudgeAt`, `lastStateMtimeMs`, `lastStateSize` via atomic `0600` writes |
| K9 | met | Self-edits targeting `.kala/state.yaml` or `kala state` skip `editsSinceCheckpoint` increment |
| K10-v2 | met | Amends `K10`: on `.kala/state.yaml` `mtimeMs`/`size` change, resets counter & cooldown and falls through to count non-self `PostToolUse` as `1`; unit-tested |
| K11-v2 | met | Amends `K11`: mid-turn `ageMet` requires `editsSinceCheckpoint >= 1`; `Stop` ignores `PostToolUse` cooldown and nudges when `editsSinceCheckpoint >= 1` |
| K12 | met | Fixed deterministic nudge templates `< 250` chars with zero untrusted stdin/repo string interpolation |
| K13-v2 | met | Amends `K13`: `install` defaults to installed Phase 1 CLIs (`isInstalled`) and errors clearly if none; `uninstall` targets all Phase 1 CLIs; atomic JSON merge + `.gitignore` warning + `status` |
| K14 | met | `src/index.ts` CLI parser handles `--agent`, `--event`, `--agents` while keeping exit `2` for unknown flags elsewhere |
| K15 | met | `loadHookConfig()` in `src/config.ts` reads `hooks:` in `$KALA_HOME/config.yaml` or `~/.kala/config.yaml`; `enabled: false` no-ops cleanly |
| K16-v2 | met | Amends `K16`: symlink refusal across `.hook-state.json`, `hook-errors.log`, vendor hook configs; 64 KB stdin cap; staggered `HOOK_STDIN_DEADLINE_MS = HOOK_DEADLINE_MS - 400` (`1600ms` inside `2000ms`); bounded `<= 32 KB` sanitized `hook-errors.log`; fail-open `{}` + exit `0` |
| K17 | met | `SECURITY.md`, `README.md`, and `CHANGELOG.md` updated |
| K18 | met | Unit tests in `tests/run.ts` + auto pipe tests in `scripts/qa-e2e-regression.sh` |
| K19 | met | `bin/kala` wraps `_hook` dynamic import & execution in `try/catch` emitting `{}\n` and exit `0` on failure |
| K20 | met | `hooksStatus()` isolates per-agent malformed JSON / symlink errors as `error (<reason>)` without hiding the other agent or checkpoint age |
| K21 | met | Regression tests in `tests/run.ts` verify `K10-v2`, `K11-v2`, `K13-v2`, `K16-v2`, `K19`, `K20` |

---

## 3. Verification

### Automated

- `npm run build` → builds 18 files into `dist/`, exit `0`.
- `npm test` → **95 passed, 0 failed**.
- `npm run test:e2e:auto` → **Pass=19, Fail=0, Blocked=14** (14 live/interactive TTY checks gated in `--auto-only` mode).

### Real-agent E2E & stress testing

| Check | Result |
|-------|--------|
| Full E2E suite (`npm run test:e2e`, `kalaga/.e2e-runs/20261126T233448Z/results.md`) | **Pass** — Pass=33, Fail=0, Blocked=0 |
| Live `claude -p` & `agy -p` FEAT-004 hook firing & `.kala/state.yaml` self-update | **Pass** — both CLIs fired hooks, updated `.kala/state.yaml` unprompted, reset `.hook-state.json`, 0 hook errors |
| 4-CLI LedgerLite stress run (`scripts/live-stress-ledgerlite.sh`: `agy -> claude -> simulated 5h limit -> kala recover cursor -> grok -> agy`) | **Pass on handoff/hooks** — `claude_permissions_preserved=True`, `claude_hooks_wired=True`, `agy_hooks_wired=True`, `hook_errors_log_present=False`, `recover_limit_hit_seen=True`, `skipped_live_ask_on_dead_claude=True`, `limit_constraint_recorded=True`, `grok_false_limit_cascade=False`; Milestones 1–3 built and `bin/ledgerlite` CLI smoke balanced (`270000` cents); Milestone 4 (`tests/ledgerlite.test.js`, `README.md`) was not generated within phase budget (`0` tests ran) |

---

## 4. Waivers

None.

---

## 5. ARCH-001 compliance

- **Zero runtime dependencies (A4):** `node` stdlib (`fs`, `path`, `os`, `child_process`) only.
- **Erasable TypeScript:** All source compiles cleanly via `stripTypeScriptTypes(..., { mode: 'strip' })` (`npm run build`).
- **Fail-open hook contract:** Missing/broken `dist/hook.js`, malformed stdin/config JSON, symlinked files, hanging stdin, and read-only repos all emit `{}` and exit `0`.

---

## 6. Certifier notes

`docs/specs/INDEX.md` updated: `FEAT-004 v1` → `superseded`, `FEAT-004 v2` → `done`.
