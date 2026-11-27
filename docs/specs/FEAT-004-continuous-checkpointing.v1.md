# FEAT-004 — Continuous Checkpointing via Agent Lifecycle Hooks

| Field | Value |
|-------|-------|
| **ID** | FEAT-004 |
| **Version** | v1 |
| **Status** | `certify` |
| **Date** | 2026-11-26 |
| **Supersedes** | — |
| **Owner** | Technical lead |
| **Depends on** | ARCH-001 v1; SEC-001 v1 (done); FEAT-003 v1 (done) |
| **Build priority** | Next (post-0.7.0) |
| **Dependencies** | Node.js ≥ 24 stdlib only (no external packages, no network calls) |

---

## 1. Intent

Exit-time `live-ask` (`FEAT-003`) enriches `.kala/state.yaml` on a voluntary
`kala switch`, but **cannot run** when an agent hits a hard usage or
time-window limit (e.g. `agy` exhausting a 5-hour pool or `claude` hitting its
rolling cap) because the dying CLI has no quota left. Meanwhile, start-of-session
standing orders (`STANDING_ORDERS`) decay in long sessions after dozens of tool
calls. Only the running agent holds accurate working memory (`done`,
`next_step`, `negative_constraints`).

**Outcome:** `.kala/state.yaml` stays warm continuously while an agent is alive
via lightweight, periodic checkpoint nudges triggered by native agent lifecycle
hooks (`kala _hook`). When a sudden quota limit hits, the taking agent already
has current state without needing a post-mortem LLM call.

---

## 2. In / out of scope

**In (v1 / Phase 1):**

- Unified internal hook runner: `kala _hook --agent <key> --event <name>`
  (fast-path dispatch, hidden from `--help`)
- User management CLI: `kala hooks install [--agents claude,agy]`,
  `kala hooks status`, `kala hooks uninstall`
- Verified Phase 1 vendors:
  - **Claude Code (`claude`)** via `.claude/settings.local.json`
  - **Antigravity (`agy`)** via `.agents/hooks.json` (with fail-safe missing-binary
    shell guard and `.gitignore` warning)
- Staleness and cooldown tracking in `.kala/.hook-state.json`
- Optional `hooks:` settings block in `~/.kala/config.yaml` (read via
  `os.homedir()`, with `$KALA_HOME` override)
- Bounded, sanitized error logging in `.kala/hook-errors.log`
- Updates to `SECURITY.md`, `README.md`, `CHANGELOG.md`
- Tests: unit tests (`npm test`), automated stdin/stdout pipe tests
  (`npm run test:e2e:auto`), and real-agent E2E (`npm run test:e2e`)

**Out:**

- Replacing exit-time `live-ask` for voluntary `kala switch`
- Running a second LLM inside `kala _hook` to summarize transcripts
- Modifying vendor-global hook configs by default (project-scoped install first)
- Mutating VCS-tracked `.claude/settings.json`
- Unverified vendor hook schemas (`cursor`, `grok` deferred to `v2` after
  real-agent E2E verification)

---

## 3. Approach

### 3.1 Problem → design

| Failure | Fix |
|---------|-----|
| Hard limit hit leaves `.kala/state.yaml` stale | Native `PostToolUse` / `PreInvocation` / `Stop` hooks nudge the live model when state lags |
| Model forgets standing orders mid-session | Deterministic <250-char nudge injected only when stale (`editsSinceCheckpoint` or age) |
| Vendor hook schemas diverge (`claude` vs `agy`) | One `kala _hook` evaluator with thin per-vendor config/output adapters |
| Fail-closed `agy` bricks repo if `kala` is moved/deleted | Command wrapper checks binary existence and falls back to `{}` + exit `0` |
| `agy` runs hooks in `.agents/`, not repo root | Resolve project dir from stdin `cwd` / `workspacePaths[0]`, then walk up to `.kala/state.yaml` |
| Synchronous hooks slow down every tool call | Top-of-entry fast path into `src/hook.ts` without importing `ledger`/`picker`/`launch`/`liveask` |
| Tracked config pollution with local paths | Claude writes `.claude/settings.local.json`; `agy` install warns if `.agents/hooks.json` is unignored |

### 3.2 Fast-path dispatch & repo-root resolution

1. **Fast-path dispatch:** `src/index.ts` (or `bin/kala`) checks
   `process.argv[2] === '_hook'` before importing `ledger.ts`, `picker.ts`,
   `launch.ts`, or `liveask.ts`, delegating straight to a minimal `src/hook.ts`
   module so synchronous hook invocations stay fast.
2. **Value-flag parsing:** Update the CLI parser in `src/index.ts` so
   `_hook --agent <key> --event <name>` and `hooks install --agents <list>`
   accept value flags cleanly while preserving exit `2` for unknown flags on
   user commands.
3. **Repo-root resolution:** Never assume `process.cwd()` is the repo root
   (`agy` sets hook process CWD to `.agents/`). Read stdin JSON (up to 64 KB)
   and pick the starting directory in order:
   1. `payload.cwd` (if non-empty string)
   2. `payload.workspacePaths[0]` (if non-empty array of strings)
   3. `process.cwd()`
   Walk upward from that directory (stopping at `.git` root or filesystem root)
   looking for `.kala/state.yaml`. If no `.kala/state.yaml` exists, emit the
   vendor no-op JSON (`{}`) and exit `0` silently.

### 3.3 Verified vendor hook matrix & I/O contracts

| Agent | Project config path | Events wired | Stdin / path quirks | Stdout nudge payload | Failure posture |
|-------|---------------------|--------------|---------------------|----------------------|-----------------|
| `claude` | `.claude/settings.local.json` | `PostToolUse` (`Edit\|Write\|MultiEdit\|Bash`), `Stop` | Sends `hook_event_name`, `stop_hook_active`, tool fields in stdin JSON. Never touch tracked `.claude/settings.json`. | `PostToolUse`: `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"..."}}` <br> `Stop`: `{"decision":"block","reason":"..."}` | Fail-open (exit `0` + `{}`) |
| `agy` | `.agents/hooks.json` | `PostToolUse` (grouped: `edit_file\|write_file\|run_command`), `PreInvocation` (flat), `Stop` (flat) | Top-level named key `"kalaga-checkpoint"`. CWD is `.agents/`. Sanitized env (read config via `os.homedir()`). `PostToolUse` expects `{}` only. | `PostToolUse`: always `{}` (counter update only) <br> `PreInvocation`: `{"injectSteps":[{"systemMessage":{"systemMessage":"..."}}]}` <br> `Stop`: `{"decision":"continue","reason":"..."}` | Fail-closed in `agy` → always exit `0` + `{}`; shell guard skips missing `kala` |

**Vendor-specific loop & termination guards:**

- **Claude `Stop`:** Inspect `payload.stop_hook_active`. If `true`, emit `{}` and
  exit `0` immediately so a stubborn model cannot loop indefinitely.
- **Antigravity (`agy`) `Stop`:** Inspect `payload.continuationActive` and
  `payload.terminationReason`. Only emit `{"decision":"continue","reason":"..."}`
  when `continuationActive !== true` **and**
  `terminationReason === "NO_TOOL_CALL"`. Never force continuation on
  `USER_CANCELED`, `ERROR`, `MAX_INVOCATIONS`, `MAX_FORCED_INVOCATIONS`, or
  `MAX_TOKEN_BUDGET_EXCEEDED`.
- **Antigravity (`agy`) missing-binary guard:** Wrap the installed command string
  with a shell-quoted existence check so moving, renaming, or uninstalling
  `kalaga` never bricks `agy`:

  ```sh
  [ -x '/abs/path/to/kala' ] && '/abs/path/to/kala' _hook --agent agy --event PostToolUse || printf '{}'
  ```

  *(Unix shell wrapper for v1; Windows `cmd /c` equivalent deferred.)*

### 3.4 Staleness, reset & cooldown policy (`.kala/.hook-state.json`)

`.kala/.hook-state.json` lives inside `.kala/` (gitignored alongside `state.yaml`):

```json
{
  "editsSinceCheckpoint": 4,
  "lastNudgeAt": "2026-11-26T19:10:00.000Z",
  "lastStateMtimeMs": 1795720000000,
  "lastStateSize": 482
}
```

**Evaluation order on each hook call:**

1. **Self-edit skip:** If the `PostToolUse` tool payload targets `.kala/state.yaml`
   (e.g., `tool_input.file_path`, `toolCall.args.TargetFile`/`Path`, or a `Bash`/
   `run_command` invocation running `kala state`), do not increment
   `editsSinceCheckpoint`.
2. **Reset check:** `stat(.kala/state.yaml)`. If
   `st.mtimeMs > lastStateMtimeMs || st.size !== lastStateSize` (size guards
   against 1-second coarse mtime filesystems), set:
   - `editsSinceCheckpoint = 0`
   - `lastNudgeAt = null` *(clearing cooldown whenever a checkpoint lands)*
   - `lastStateMtimeMs = st.mtimeMs`
   - `lastStateSize = st.size`
   Persist `.hook-state.json` atomically (`0600`) and emit `{}`.
3. **Counter update (`PostToolUse`):** If not skipped by step 1, increment
   `editsSinceCheckpoint += 1` and persist.
4. **Mid-turn nudge (`claude` `PostToolUse` / `agy` `PreInvocation`):**
   Fire if:
   - `(editsSinceCheckpoint >= edit_threshold || (lastStateMtimeMs > 0 && now - lastStateMtimeMs >= max_age_minutes * 60_000))`
   - **AND** `(lastNudgeAt === null || now - Date.parse(lastNudgeAt) >= cooldown_minutes * 60_000)`
   On fire, update `lastNudgeAt = new Date(now).toISOString()` and persist.
5. **End-of-turn nudge (`Stop`):**
   Fire if `editsSinceCheckpoint >= 1` and the vendor re-entry/termination guard
   passes (§3.3). **`Stop` is gated by the vendor re-entry flag rather than
   `PostToolUse`'s `cooldown_minutes`**, so an earlier mid-turn nudge (or a
   reset followed by 1–2 edits) never suppresses the final end-of-turn prompt.
6. **Concurrency tolerance:** Parallel tool calls can invoke `kala _hook`
   concurrently. Write `.hook-state.json` via `0600` temp+rename and treat
   transient `ENOENT`/`EEXIST` races as non-fatal (fail-open to `{}`).

### 3.5 Nudge payload

Keep the injected instruction short, fixed, deterministic, and **under 250
characters**, with zero untrusted stdin or repo text interpolated (other than the
bounded integer `editsSinceCheckpoint`):

```text
[kalaga] .kala/state.yaml is stale (5 edits since last update). Before continuing, update done, next_step, and negative_constraints in .kala/state.yaml so handoff state stays current.
```

### 3.6 CLI surface & non-destructive JSON merge

```text
kala hooks install [--agents claude,agy]   Install/merge hook configs in current repo
kala hooks status                          Show installed hooks + last checkpoint age
kala hooks uninstall                       Remove Kalaga entries cleanly (preserve user hooks)
kala _hook --agent <key> --event <name>    Internal stdin/stdout hook runner (hidden from --help)
```

- **Target selection:** `--agents` defaults to installed Phase 1 agents
  (`claude`, `agy`). Passing an unsupported or unknown key exits non-zero with a
  clear message.
- **Absolute binary resolution:** `kala hooks install` resolves the real
  absolute path to `bin/kala` (via `fs.realpathSync`), shell-quotes it safely,
  and checks executability.
- **Non-destructive atomic merge:**
  - Read existing `.claude/settings.local.json` or `.agents/hooks.json` if
    present. If the file exists and contains invalid JSON, **abort with a clear
    stderr error** rather than overwriting user config.
  - For `.claude/settings.local.json`, tag Kalaga hook handler groups/entries or
    match on `_hook --agent claude` command prefix so unrelated `PostToolUse` /
    `Stop` hooks stay intact.
  - For `.agents/hooks.json`, manage only the top-level `"kalaga-checkpoint"`
    key, preserving all sibling named hooks.
  - Check `.gitignore` / `git check-ignore` for `.agents/hooks.json` when
    installing `agy` hooks; if unignored in a git repo, print a one-line warning
    suggesting `.gitignore` or `.git/info/exclude` so machine-local paths are not
    committed accidentally.
- **Clean uninstall:** `kala hooks uninstall` removes only Kalaga-managed entries,
  preserving all unrelated keys/hooks and writing back atomically (`0600` /
  existing mode).

### 3.7 Configuration (`~/.kala/config.yaml`)

Optional `hooks:` block (all fields optional; defaults shown):

```yaml
hooks:
  enabled: true
  edit_threshold: 5
  max_age_minutes: 10
  cooldown_minutes: 3
  timeout_seconds: 5
```

Because `agy` sanitizes environment variables in hook subshells, `kala _hook`
reads `os.homedir()/.kala/config.yaml` directly when `KALA_HOME` is unset (and
honors `$KALA_HOME` when present). Parse with a minimal scoped reader (no new
dependencies). When `hooks.enabled` is `false`, `kala _hook` immediately exits
`0` with `{}`.

### 3.8 Security & reliability constraints

- **Symlink refusal:** `.kala/.hook-state.json`, `.kala/hook-errors.log`,
  `.claude/settings.local.json` (and `.claude/`), and `.agents/hooks.json` (and
  `.agents/`) must refuse symlink reads/writes, matching `SEC-001` `state.ts`
  rules.
- **Bounded stdin & deadline:** Cap stdin reading at **64 KB** (stop reading /
  truncate cleanly without crashing) and enforce a **2-second internal deadline**
  so `kala _hook` always exits well within the 5-second vendor hook timeout.
- **Zero crash surface:** Wrap `kala _hook` in a top-level `try/catch`; on any
  exception, malformed JSON, missing file, or read-only filesystem, log a short
  sanitized message, emit `{}` on stdout, and exit `0`.
- **Sanitized, bounded error log:** Append internal errors to
  `.kala/hook-errors.log` (`0600`), capped/truncated at 32 KB. **Never** write
  raw stdin payloads, tool arguments, file contents, or shell commands into the
  log (they may contain secrets or tokens).
- **Safe command quoting:** Quote resolved `bin/kala` paths safely when writing
  hook commands (supporting spaces in paths without enabling untrusted shell
  expansion).
- **Security model update:** Amend `SECURITY.md` to document that `kala hooks
  install` / `uninstall` performs opt-in, non-destructive, reversible edits to
  `.claude/settings.local.json` and `.agents/hooks.json`.

### 3.9 Rejected alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Write to `.claude/settings.json` | VCS-tracked team file; embedding local paths dirties git and breaks teammates |
| Modify global `~/.claude/settings.json` / `~/.gemini/config/hooks.json` by default | Violates project-scoped opt-in posture; surprises unrelated repos |
| Spawn a second LLM inside `kala _hook` | Slow, spends extra quota, fragile inside sync tool loops |
| Emit `systemMessage` / `decision` from `agy` `PostToolUse` | Unsupported in Antigravity's `PostToolUse` contract (expects `{}` only) |
| Share `PostToolUse` cooldown with `Stop` | Suppresses end-of-turn checkpointing after a mid-turn nudge or recent edit |

---

## 4. Requirements

| ID | Requirement |
|----|-------------|
| K1 | `kala _hook --agent <key> --event <name>` dispatches via a fast path before loading `ledger`/`picker`/`launch`/`liveask`. Hidden from `--help`. |
| K2 | `kala _hook` resolves project root from stdin `cwd` → `workspacePaths[0]` → `process.cwd()`, walking up to `.kala/state.yaml`. Missing `state.yaml` exits `0` with `{}`. |
| K3 | `claude` hooks install into `.claude/settings.local.json` (`PostToolUse` matcher `Edit\|Write\|MultiEdit\|Bash`, and `Stop`) and never touch `.claude/settings.json`. |
| K4 | `claude` `PostToolUse` emits `hookSpecificOutput.additionalContext` when due; `claude` `Stop` checks `stop_hook_active !== true` and emits `{"decision":"block","reason":"..."}`. |
| K5 | `agy` hooks install under `"kalaga-checkpoint"` in `.agents/hooks.json` using `PostToolUse` (grouped, `edit_file\|write_file\|run_command`), `PreInvocation` (flat), and `Stop` (flat). |
| K6 | `agy` installed commands wrap the shell-quoted resolved `bin/kala` path with an existence check falling back to `printf '{}'` so missing `kala` never fails closed. |
| K7 | `agy` `PostToolUse` always emits `{}`; `agy` `PreInvocation` emits `injectSteps[].systemMessage.systemMessage`; `agy` `Stop` emits `{"decision":"continue","reason":"..."}` only when `continuationActive !== true && terminationReason === "NO_TOOL_CALL"`. |
| K8 | `.kala/.hook-state.json` tracks `editsSinceCheckpoint`, `lastNudgeAt`, `lastStateMtimeMs`, and `lastStateSize` with atomic `0600` writes tolerant of concurrent tool calls. |
| K9 | Self-edits targeting `.kala/state.yaml` or `kala state` do not increment `editsSinceCheckpoint`. |
| K10 | When `.kala/state.yaml` `mtimeMs` increases or `size` changes, `editsSinceCheckpoint` resets to `0`, `lastNudgeAt` clears to `null`, and the hook exits `0` with `{}`. |
| K11 | Mid-turn nudges require `(editsSinceCheckpoint >= edit_threshold \|\| age >= max_age_minutes)` and cooldown elapsed; `Stop` nudges require `editsSinceCheckpoint >= 1` (gated by vendor re-entry flags, not `PostToolUse` cooldown). |
| K12 | Nudge text uses a fixed deterministic template strictly `< 250` chars with no untrusted stdin/repo strings interpolated. |
| K13 | `kala hooks install [--agents ...]` performs non-destructive atomic JSON merge (aborts on malformed JSON), warns if `.agents/hooks.json` is not gitignored, and supports `status` + `uninstall`. |
| K14 | `src/index.ts` CLI parser accepts value flags (`--agent`, `--event`, `--agents`) cleanly while preserving exit `2` for unknown flags on other commands. |
| K15 | Optional `hooks:` config in `os.homedir()/.kala/config.yaml` (or `$KALA_HOME`) supports `enabled`, `edit_threshold`, `max_age_minutes`, `cooldown_minutes`, and `timeout_seconds`. `enabled: false` no-ops cleanly. |
| K16 | All `.hook-state.json`, `hook-errors.log`, and vendor config reads/writes refuse symlinks; `_hook` caps stdin at 64 KB, enforces a 2s deadline, logs only sanitized bounded errors (≤32 KB), and never exits non-zero. |
| K17 | Update `SECURITY.md`, `README.md`, and `CHANGELOG.md` for `kala hooks` and opt-in vendor config edits. |
| K18 | Tests in `tests/run.ts` + `scripts/qa-e2e-regression.sh` cover staleness/reset/cooldown, self-edit skip, non-destructive install/uninstall, fail-safe malformed/symlink/ROFS handling, and mock `PostToolUse`/`PreInvocation`/`Stop` pipes. |

---

## 5. Touch map

| Path | Change |
|------|--------|
| `src/hook.ts` | **New** — fast-path `kala _hook` evaluator, stdin/deadline guard, `.hook-state.json`, vendor formatters, sanitized error logger |
| `src/hooks.ts` | **New** — `kala hooks install\|status\|uninstall`, path resolution, atomic non-destructive JSON merge, `.gitignore` check |
| `src/index.ts` | Fast-path `_hook` dispatch at entry; `hooks` subcommand; value-flag CLI parsing |
| `src/config.ts` | Hook config defaults/reader (`~/.kala/config.yaml` `hooks:` block) |
| `tests/run.ts` | Unit + component tests for `hook.ts` and `hooks.ts` (K1–K16) |
| `scripts/qa-e2e-regression.sh` | `--auto-only` pipe tests for `kala _hook` (`claude` + `agy`); `--full` real-agent hook verification |
| `SECURITY.md` | Document opt-in, reversible vendor hook config writes |
| `README.md` / `CHANGELOG.md` | Document `kala hooks install\|status\|uninstall` and `hooks:` config |

---

## 6. Verification

### Automated (`npm test`)

- Counter increments on `PostToolUse`, skips self-edits to `.kala/state.yaml`, resets `editsSinceCheckpoint` + clears `lastNudgeAt` when `state.yaml` `mtimeMs` or `size` changes.
- Cooldown suppresses back-to-back mid-turn nudges, while `Stop` fires on `editsSinceCheckpoint >= 1` unless `stop_hook_active` (`claude`) or `continuationActive` / non-`NO_TOOL_CALL` (`agy`) is set.
- `kala hooks install` / `uninstall` preserves existing unrelated hooks in `.claude/settings.local.json` and `.agents/hooks.json`, aborts cleanly on malformed JSON, and rejects symlinks.
- Malformed stdin, >64 KB stdin, missing `.kala/state.yaml`, symlinked `.hook-state.json`, and read-only `.kala/` all exit `0` with `{}` and never log raw stdin payloads.

### Automated E2E (`npm run test:e2e:auto`)

- Pipe mock `PostToolUse` and `Stop` JSON payloads into `kala _hook --agent claude --event ...` and `PostToolUse`, `PreInvocation`, and `Stop` into `kala _hook --agent agy --event ...`; assert exact stdout JSON schema and exit code `0`.

### Real-agent E2E (`npm run test:e2e`)

- Run `claude` and `agy` in a test repo with `kala hooks install`, make edits beyond `edit_threshold` without mentioning `.kala/state.yaml`, and verify the model observes the hook nudge and updates `.kala/state.yaml` before ending its turn.

### Certify

`docs/specs/INDEX.md` → `certify` after build; certify record references **FEAT-004 v1**.

---

## 7. Deferred

| Item | Why |
|------|-----|
| Cursor CLI (`cursor-agent`) hook wiring | Verify whether CLI uses `.cursor/hooks.json` or `.claude/settings.local.json` and exact stdout schema in real-agent E2E first (`v2`) |
| Grok (`grok`) hook wiring (`.grok/hooks/kalaga.json`) | Passive `PostToolUse` stdout may be ignored; verify `Stop`/`StopFailure` empirically (`v2`) |
| Global hook install (`--global`) | Risk of surprising unrelated repos; keep project-scoped for v1 |
| Windows `cmd /c` missing-binary guard | Unix shell fallback covers Linux/macOS v1; add Windows `if exist` wrapper alongside Windows E2E |
| Companion `agy` exit-classification fix | Separate bug fix (`src/launch.ts` / `src/index.ts`), recommended alongside FEAT-004 so `agy` 5-hour limit hits trigger the handoff picker |

---

## 8. Done when

- `FEAT-004` status is `locked`, implemented, and certified against `v1`
- `npm test` and `npm run test:e2e:auto` pass with K1–K18 coverage
- Real-agent E2E confirms both `claude` and `agy` fire `kala _hook` and update `.kala/state.yaml` on nudge without bricking sessions when `kala` is absent or `.kala/` is read-only
- `SECURITY.md`, `README.md`, and `CHANGELOG.md` updated
