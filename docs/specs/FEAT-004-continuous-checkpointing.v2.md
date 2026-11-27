# FEAT-004 — Continuous Checkpointing via Agent Lifecycle Hooks

| Field | Value |
|-------|-------|
| **ID** | FEAT-004 |
| **Version** | v2 |
| **Status** | `done` (`CERT-008` pass) |
| **Date** | 2026-11-26 |
| **Supersedes** | `FEAT-004 v1` (`certify`; post-build review found 5 edge-case gaps) |
| **Owner** | Technical lead |
| **Depends on** | ARCH-001 v1; SEC-001 v1 (done); FEAT-003 v1 (done); FEAT-004 v1 implementation |
| **Build priority** | Next (pre-certify closure) |
| **Dependencies** | Node.js ≥ 24 stdlib only (no external packages, no network calls) |

---

## 1. Intent

`FEAT-004 v1` delivered continuous checkpointing (`src/hook.ts`, `src/hooks.ts`,
fast-path `bin/kala`, config, docs, and tests). Post-build code review
identified five concrete edge-case gaps across default agent selection,
post-reset edit accounting, zero-edit age nudges, deadline timer ordering, and
resilience when `dist/hook.js` or a vendor hook file is broken.

**Outcome:** Carry forward `FEAT-004 v1` (`K1`–`K18`) unchanged except for the
targeted closures specified below (`K10-v2`, `K11-v2`, `K13-v2`, `K16-v2`,
`K19`, `K20`, `K21`) so `FEAT-004` can be certified cleanly without leaving
known review findings open.

---

## 2. In / out of scope

**In:**

- Surgical fixes and regression tests for the five post-build review findings
  (`bin/kala`, `src/hook.ts`, `src/hooks.ts`, `tests/run.ts`)
- Rebuild `dist/` (`npm run build`) and update `docs/specs/INDEX.md`

**Out:**

- Adding new hook vendors (`cursor`, `grok` remain deferred to a future version)
- Global (`--global`) hook installation
- Refactors outside the five review findings
- Modifying unrelated pre-existing uncommitted files (`src/launch.ts`,
  `src/ledger.ts`, `src/picker.ts`, `src/trust.ts`, `src/util/sqlitewarn.ts`,
  `src/util/ttyask.ts`) or rewriting `FEAT-004 v1`

---

## 3. Approach

No architectural changes — five surgical closures on top of the `FEAT-004 v1`
implementation:

| Finding | Choice | Rejected |
|---------|--------|----------|
| `kala hooks install` installs files for uninstalled CLIs | Default `--agents` on `install` to `[claude, agy]` filtered by `isInstalled(agentFor(k))`; error clearly if none installed | Always writing both `.claude/` and `.agents/` configs |
| First `PostToolUse` edit after external `state.yaml` update is dropped | Reset `editsSinceCheckpoint = 0` and `lastNudgeAt = null` on `mtimeMs`/`size` change, then fall through to count non-self `PostToolUse` (`1`) | Early-returning `{}` and losing the first edit |
| `agy` `PreInvocation` nudges `"0 edits"` on read-only turns after idle gap | Gate `ageMet` on `state.editsSinceCheckpoint >= 1` | Nudging read-only sessions with `0` edits |
| Outer 2s deadline races with `readStdinBounded`'s identical 2s timer | Stagger `HOOK_STDIN_DEADLINE_MS = HOOK_DEADLINE_MS - 400` (`1600ms`) inside the `2000ms` outer deadline | Keeping identical `2000ms` timers |
| `bin/kala` `_hook` import error or malformed JSON crashing `hooks status` | Wrap `bin/kala` `_hook` dispatch in `try/catch` emitting `{}`; catch per-agent errors in `hooksStatus()` to show `error (<reason>)` | Letting `_hook` exit non-zero into fail-closed `agy` or aborting `status` |

### 3.1 Installed-agent default (`K13-v2`)

When `--agents` is omitted on `kala hooks install`, filter
`SUPPORTED_HOOK_AGENTS` (`['claude', 'agy']`) using `isInstalled(agentFor(k))`
from `src/config.ts`:

- If at least one Phase 1 agent is installed, install hooks only for the
  installed subset.
- If neither `claude` nor `agy` is found on `PATH` and `--agents` was omitted,
  exit non-zero with a clear message suggesting `--agents claude,agy` (never
  silently no-op or create unwanted config files).
- `kala hooks uninstall` without `--agents` continues targeting all supported
  Phase 1 agents (`claude`, `agy`) so hooks remain removable even after a vendor
  CLI is uninstalled.

### 3.2 Post-reset edit counting (`K10-v2`)

In `evaluateHook()` (`src/hook.ts`), when `st.mtimeMs > loaded.lastStateMtimeMs
|| st.size !== loaded.lastStateSize`:

1. Reset `state = { editsSinceCheckpoint: 0, lastNudgeAt: null, lastStateMtimeMs: st.mtimeMs, lastStateSize: st.size }`.
2. If `event !== 'PostToolUse'` or `isSelfEdit(agent, event, payload)` is `true`,
   save `state` and return `{ shouldNudge: false, editsSinceCheckpoint: 0, state }`.
3. Otherwise (`event === 'PostToolUse'` and **not** a self-edit), continue into
   the normal `PostToolUse` increment so `editsSinceCheckpoint` becomes `1` and
   is persisted (and evaluated for Claude `PostToolUse` if threshold is `1`). A
   single-edit turn following `kala run` or `kala state` will now still nudge at
   `Stop`.

### 3.3 Zero-edit guard on mid-turn `max_age_minutes` (`K11-v2`)

In `evaluateHook()`, require `state.editsSinceCheckpoint >= 1` alongside the
age comparison:

```ts
const ageMet =
  state.editsSinceCheckpoint >= 1 &&
  state.lastStateMtimeMs > 0 &&
  (nowMs - state.lastStateMtimeMs) >= config.max_age_minutes * 60_000;
```

Read-only turns (`editsSinceCheckpoint === 0`) never emit `"stale (0 edits since
last update)"`.

### 3.4 Staggered stdin vs outer deadline (`K16-v2`)

Define `HOOK_STDIN_DEADLINE_MS = HOOK_DEADLINE_MS - 400` (`1600ms` for
`HOOK_DEADLINE_MS = 2000ms`) and pass it to `readStdinBounded(...)`. Hanging
stdin cleanly triggers the `timedOut` path, destroys `process.stdin`, logs
`stdin read deadline exceeded` (when repo root is known), and emits `{}` within
`HOOK_DEADLINE_MS`.

### 3.5 Fail-safe `bin/kala` `_hook` import & resilient `hooks status` (`K19`, `K20`)

- **`bin/kala` (`K19`):** Wrap the `process.argv[2] === '_hook'` dynamic import
  and `runHookCli(...)` call in `try { ... } catch { process.stdout.write('{}\n'); process.exitCode = 0; }` so a missing or broken `dist/hook.js` never exits non-zero into fail-closed `agy`.
- **`hooksStatus()` (`K20`):** Wrap per-agent config inspection (`.claude/settings.local.json` and `.agents/hooks.json`) in its own `try/catch`. A malformed JSON or symlinked config reports `error (<reason>)` for that agent in `kala hooks status` while still displaying the other agent, `.kala/state.yaml` checkpoint age, and `hooks:` config. `install` and `uninstall` continue hard-aborting on malformed JSON or symlinks (`K13`, `K16`).

---

## 4. Requirements

Requirements `K1`–`K9`, `K12`, `K14`, `K15`, `K17`, and `K18` carry forward
verbatim from `FEAT-004 v1`. Requirements below amend or extend `v1`:

| ID | Requirement |
|----|-------------|
| K10-v2 | Amends `K10`: when `.kala/state.yaml` `mtimeMs` increases or `size` changes, reset `editsSinceCheckpoint = 0` and `lastNudgeAt = null`; if the triggering event is a non-self `PostToolUse`, fall through to count that edit (`1`) rather than dropping it. |
| K11-v2 | Amends `K11`: mid-turn `ageMet` requires `editsSinceCheckpoint >= 1` so read-only turns after an idle period never nudge with `0` edits. |
| K13-v2 | Amends `K13`: `kala hooks install` without `--agents` installs only for installed Phase 1 agents (`isInstalled(agentFor(k))`) and errors clearly if none are installed; `uninstall` without `--agents` still targets all Phase 1 agents (`claude`, `agy`). |
| K16-v2 | Amends `K16`: `readStdinBounded` uses `HOOK_STDIN_DEADLINE_MS = HOOK_DEADLINE_MS - 400` (`1600ms`) inside the `2000ms` outer deadline so hanging stdin logs and cleans up before the outer timer fires. |
| K19 | `bin/kala` wraps the `_hook` fast-path dynamic import and `runHookCli` in `try/catch`, emitting `{}\n` and exit `0` on import/runtime failure. |
| K20 | `kala hooks status` isolates per-agent JSON/symlink errors and prints `error (<reason>)` for the broken agent without hiding the other agent or checkpoint status. |
| K21 | Regression unit tests in `tests/run.ts` verify `K10-v2`, `K11-v2`, `K13-v2`, `K16-v2`, `K19`, and `K20`. |

---

## 5. Touch map

| Path | Change |
|------|--------|
| `bin/kala` | Wrap `_hook` fast-path import + execution in fail-open `try/catch` (`K19`) |
| `src/hook.ts` | Fall-through edit count after `mtimeMs`/`size` reset (`K10-v2`), `editsSinceCheckpoint >= 1` guard on `ageMet` (`K11-v2`), `HOOK_STDIN_DEADLINE_MS` (`K16-v2`) |
| `src/hooks.ts` | Default `install` agents via `isInstalled` (`K13-v2`); per-agent error isolation in `hooksStatus` (`K20`) |
| `tests/run.ts` | Regression tests for `K10-v2`, `K11-v2`, `K13-v2`, `K16-v2`, `K19`, `K20` (`K21`) |
| `docs/specs/INDEX.md` | Mark `FEAT-004 v1` `superseded`; track `FEAT-004 v2` |

---

## 6. Verification

### Automated (`npm test`, `npm run build`, `npm run test:e2e:auto`)

- `K10-v2`: touch/modify `.kala/state.yaml`, immediately fire non-self `PostToolUse` → `editsSinceCheckpoint === 1` and `lastNudgeAt === null`; subsequent `Stop` nudges. Self-edit `PostToolUse` or `PreInvocation`/`Stop` after reset keeps `editsSinceCheckpoint === 0`.
- `K11-v2`: `editsSinceCheckpoint === 0` with `lastStateMtimeMs` older than `max_age_minutes` → `agy` `PreInvocation` does not nudge (`shouldNudge === false`).
- `K13-v2`: with stubbed `PATH` containing only `claude` (or only `agy`, or neither), `kala hooks install` without `--agents` writes only the installed agent's config (or errors clearly when none installed), while `uninstall` without `--agents` removes both.
- `K16-v2`: `HOOK_STDIN_DEADLINE_MS < HOOK_DEADLINE_MS`; hanging stdin writes `stdin read deadline exceeded` to `.kala/hook-errors.log` and emits `{}` with exit `0`.
- `K19`: broken `dist/hook.js` invoked via `bin/kala _hook --agent agy --event PreInvocation` outputs `{}` and exits `0`.
- `K20`: malformed `.agents/hooks.json` still allows `hooksStatus()` / `kala hooks status` to report `claude` + `checkpoint` status alongside the `agy` error.
- `npm run build`, `npm test`, and `npm run test:e2e:auto` exit `0` with `Fail=0`.

### Real-agent E2E (`npm run test:e2e`)

Carry forward `FEAT-004 v1` real-agent verification (`claude` and `agy` end-to-end hook firing and `.kala/state.yaml` update).

### Certify

`docs/specs/INDEX.md` → `certify` after `v2` build + QA; certify record references **FEAT-004 v2**.

---

## 7. Deferred

Unchanged from `FEAT-004 v1` (`cursor`, `grok`, `--global`, Windows `cmd /c` fallback wrapper, companion `agy` exit-classification fix).

---

## 8. Done when

- `FEAT-004 v2` status is `locked`, implemented, QA-verified, and marked `certify`
- `npm run build`, `npm test`, and `npm run test:e2e:auto` pass with `K21` regression coverage
- Real-agent E2E confirms `claude` and `agy` hook continuity end-to-end
