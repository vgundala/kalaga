# FEAT-003 — Handoff State Protocol & Live-Ask Hardening

| Field | Value |
|-------|-------|
| **ID** | FEAT-003 |
| **Version** | v2 |
| **Status** | `done` |
| **Date** | 2026-11-27 |
| **Supersedes** | FEAT-003 v1 (live-ask seam only; state schema & protocol inject carry forward) |
| **Owner** | Technical lead |
| **Depends on** | FEAT-003 v1; FEAT-004 v3 |
| **Dependencies** | Node.js >= 22.18 stdlib only |

---

## 1. Intent

Agent lifecycle hooks (`FEAT-004`) are the primary continuous checkpoint writer for `.kala/state.yaml`. Headless `live-ask` (`FEAT-003`) is strictly a **read-only fallback** during `kala switch` when handoff state is stale, thin, or uncheckpointed.

In the v0.8.0 LedgerLite field run, three live-ask defects surfaced at switch boundaries:

- **Redundant invocation:** `kala switch` unconditionally ran `live-ask` even immediately after hooks had already written a fresh checkpoint, burning agent quota and latency.
- **Premature timeouts:** The `15s` cap (`LIVE_ASK_TIMEOUT_MS = 15_000`) frequently aborted healthy summaries before stdout flushed.
- **Direct state corruption:** Headless `cursor --trust` edited `.kala/state.yaml` directly on disk instead of replying on stdout, overwriting captured state and replacing Cursor's UUID `sessions.cursor.id` with `"milestone-2"`.

This spec hardens the live-ask seam so hooks stay primary, headless children cannot mutate workspace files, and any rogue on-disk write to `.kala/state.yaml` is reverted before stdout YAML merging.

## 2. In / out of scope

**In scope:**
- Hooks-first live-ask skip check in `kala switch` (`H12`).
- Read-only headless CLI flags across all 4 supported agents and explicit no-edit prompt wording (`H13`).
- On-disk `.kala/state.yaml` snapshot/restore guard preserving `sessions` and `notes` (`H14`).
- Timeout increase to `30s` (`H15`), `KALA_LIVE_ASK=1` env isolation contract (`H16`), and unit/regression tests (`H17`).

**Out of scope:**
- Changing hook cadence defaults — `DEFAULT_HOOK_CONFIG` (`5 / 10 / 3`) remains unchanged.
- Modifying `.kala/state.yaml` schema, merge precedence, or interactive handoff prompt injection (`FEAT-003 v1` carries forward).
- Non-switch CLI flows, new external dependencies, or network calls.

## 3. Requirements (H12–H17)

| ID | Title | Contract |
|----|-------|----------|
| **H12** | **Hooks-first skip** | Export `shouldSkipLiveAsk(repoDir: string, state: HandoffState \| null): { skip: boolean; reason?: string }` in `src/liveask.ts`. In `doSwitch` (`src/index.ts`), skip `live-ask` when `state` is non-null and `!isThinState(state)`, `loadHookState(repoDir)` exists with `editsSinceCheckpoint === 0`, and `.kala/state.yaml` (`lstatSync` regular non-symlink file) has `mtimeMs >= hookState.lastStateMtimeMs`. When skipped, log `kalaga: skipping live-ask — .kala/state.yaml already checkpointed by hooks` to stderr; otherwise run `live-ask` as fallback. |
| **H13** | **Read-only headless flags + stdout-only prompt** | Retain conditional `trustFlags` when a repo trust grant exists, and enforce read-only `headless` flags in `AGENTS` (`src/config.ts`, table below). Update `LIVE_ASK_PROMPT` (`src/liveask.ts`) to instruct: `"Do NOT edit or write any files (including .kala/state.yaml). Reply on stdout with ONLY a YAML block (no markdown fences)..."`. |
| **H14** | **On-disk state & `sessions` preservation guard** | In `liveAskAndMerge`, snapshot `beforeState = loadState(repoDir)` and `stateFile(repoDir)` stat (`mtimeMs`, `size`) before calling `runLiveAsk`. After `runLiveAsk`, if `stateFile` is a non-symlink regular file whose `mtimeMs` or `size` changed while `beforeState !== null`, restore `beforeState` via `saveState(repoDir, beforeState)` (preserving all captured `sessions` and `notes`) and log `kalaga: live-ask (${agent.key}) modified .kala/state.yaml directly — restored prior state` to stderr before merging any valid sanitized stdout YAML patch. |
| **H15** | **30s timeout** | Raise `LIVE_ASK_TIMEOUT_MS` from `15_000` to `30_000` in `src/liveask.ts`, and update the `README.md` live-ask timeout reference from `15s` to `30s`. |
| **H16** | **`KALA_LIVE_ASK=1` isolation** | `runLiveAsk` sets `KALA_LIVE_ASK: '1'` on the spawned child env without mutating parent `process.env`; interactive agent spawns strip `KALA_LIVE_ASK`; `runHookCli` and `evaluateHook` fast-exit with `{}` when `KALA_LIVE_ASK === '1'`. |
| **H17** | **Tests** | Update the existing `LIVE_ASK_TIMEOUT_MS` assertion to `30_000` and add tests in `tests/run.ts` covering `H12`–`H16`: fresh hook skip vs dirty/no-hook/thin-state fallback, read-only headless argv for all 4 agents, no-edit `LIVE_ASK_PROMPT`, `KALA_LIVE_ASK=1` isolation, and a rogue child modifying `.kala/state.yaml` restored with `sessions` intact. |

**Read-only `AGENTS.*.headless` flags (`H13`, `src/config.ts`):**

| Agent | `headless` argv |
|-------|-----------------|
| `cursor` | `['--mode', 'ask', '-p', '--output-format', 'text']` |
| `agy` | `['--mode', 'plan', '--effort', 'low', '--disable-slash-commands', '-p', '--output-format', 'text']` |
| `grok` | `['--permission-mode', 'plan', '--output-format', 'plain', '--reasoning-effort', 'low', '--max-turns', '1', '-p']` |
| `claude` | `['--disallowedTools', 'Edit,Write,MultiEdit,Bash', '-p', '--output-format', 'text']` |

## 4. Verification & Touch Map

| File | Scope of change |
|------|-----------------|
| `src/config.ts` | Update `AGENTS.{cursor,agy,grok,claude}.headless` to read-only flag lists (`H13`). |
| `src/liveask.ts` | Raise `LIVE_ASK_TIMEOUT_MS` to `30_000` (`H15`), update `LIVE_ASK_PROMPT` (`H13`), export `shouldSkipLiveAsk` (`H12`), add on-disk state snapshot/restore guard in `liveAskAndMerge` (`H14`), preserve `KALA_LIVE_ASK=1` child env (`H16`). |
| `src/index.ts` | Gate `liveAskAndMerge` in `doSwitch` with `shouldSkipLiveAsk` and emit stderr skip notice (`H12`). |
| `tests/run.ts` | Update `LIVE_ASK_TIMEOUT_MS` check and add `H12`–`H16` regression tests (`H17`). |
| `README.md` | Update live-ask timeout documentation from `15s` to `30s` (`H15`). |

**Pass criteria:**
- `npm test` passes with zero failures (including all `H12`–`H17` tests).
- `npm run test:e2e:auto` passes end-to-end.
- `<repo>/dist` is clean with no untracked build drift.
