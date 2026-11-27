# Kalaga 0.6.3 - Technical GTM Audit Findings

| Field | Value |
|-------|-------|
| **Scope** | Packaging, state protocol, handoff runtime, security boundaries, CLI UX, documentation |
| **Version audited** | `0.6.3` (plus uncommitted E2E worktree changes) |
| **Date** | 2026-11-24 |
| **Evidence** | Static audit of `bin/`, `src/`, `tests/`, `docs/` + 4-step live handoff capture (`daylog/.handoff-capture/20261124T180050Z`) |
| **Release verdict** | **No-go at audit time.** Cleared in tree: P0-1..P0-4, P1-1..P1-7, P2-1..P2-4, P3-1..P3-2 |

---

## Resolution

Fixed in this tree. The sections below record the original audit findings and fix targets.

| ID | Status |
|----|--------|
| P0-1 | Fixed. `scripts/build-dist.mjs` emits `dist/`; `prepack` builds; `bin/kala` prefers `dist/index.js`. |
| P0-2 | Fixed. Quoted scalars, block scalars, and flow lists round-trip. Empty `goal` keeps the file. |
| P0-3 | Fixed. Live-ask is 15s, resumes a fresh session on switch, and is skipped after a limit exit. |
| P0-4 | Fixed. `__pycache__/`, `*.py[cod]`, and `dist/` are ignored. The live-build script defaults to a temp directory. |
| P1-1 | Fixed. Handoff prompts name the previous owner. |
| P1-2 | Fixed. Porcelain `-z` keeps leading spaces; detached and empty repos have a branch label. |
| P1-3 | Fixed. `grok` resolves from `PATH` first. Windows `.cmd` shims spawn Node with `shell: false`. |
| P1-4 | Fixed. Limit phrases are specific. Clean exits ignore long prose unless the phrase is an explicit vendor limit. |
| P1-5 | Fixed. Status output is sanitized. `KALA_HOME=""` falls back to `~/.kala`. Symlinks are refused. Writes are atomic `0600`. |
| P1-6 | Fixed. `--version` does not launch. Flags parse in any position. Empty `kala state` prints. Picker typos stay. |
| P1-7 | Fixed. A taker clears `BLOCKED` and runs the post-exit flow, capped at 8 hops. |
| P2-1 | Fixed. Session hint does not spawn `grok usage`. An explicit total is not added to input + output. |
| P2-2 | Fixed. Claude usage is a 5-hour window. Cursor chats are 24 hours. Labels are `[logged]` and `[est.]`. |
| P2-3 | Fixed. `kala init` needs `--force` to overwrite. `kala` does not write state before a confirmed pick. A clean exit ranks other agents first. |
| P2-4 | Fixed. README, help, the E2E guide, and the architecture spec match the behavior above. |
| P3-1 | Fixed. Public docs and CLI text drop internal ticket shorthand. The remediation stub is removed. The superseded share-readiness spec lives under `docs/specs/history/`. |
| P3-2 | Fixed. Shebang is `#!/usr/bin/env node`. A new Claude folder tells you to press Down, then Enter. |

---

## 1. Why Existing QA Passed (Test Coverage Gaps)

Both `npm test` (46 unit checks) and `npm run test:e2e` (30/30 system checks) passed while P0 and P1 defects remained in the tree. Six structural gaps in the test suite allowed those defects through:

1. **Source-tree execution instead of packaged install:** Every test ran `node <repo>/bin/kala` directly from the checkout. Neither CI nor E2E ran `npm pack` + `npm install -g <tarball>`, so Node 24's refusal to strip TypeScript types inside `node_modules/` (P0-1) never executed.
2. **Unquoted seed strings and single-pass YAML checks:** The E2E harness seeded plain ASCII strings without embedded quotes, newlines, YAML block scalars (`|`, `>`), or flow arrays (`[...]`), and `qa-e2e-regression.sh` asserted only `goal == *"QA E2E regression"*` and `owner == <agent>`. The \(2^N\) backslash doubling in `notes` (P0-2) appeared only when `daylog`'s seed note included `"text"` across multiple handoff saves.
3. **Permissive fail-soft assertion on `liveAsk`:** Test F-14 accepted `"returned nothing usable"` as a passing outcome ("fail-soft by contract") under a 120-second PTY timeout. That masked the 45-second silent hang caused by missing `--trust` and missing `--resume` flags (P0-3).
4. **State-only handoff check instead of prompt-text check:** F-10..F-13 checked `owner` in `.kala/state.yaml` after `kala switch`, without asserting the `from` agent name inside the injected prompt. Launching `cursor` after `agy` set `owner: cursor` and passed F-10 even though the prompt said `"Kalaga handoff from cursor"` (P1-1).
5. **Single-hop interactive sessions:** Each E2E test exited after one agent session. No test simulated a second quota hit after a picker handoff or `kala switch` (P1-7), nor ran `kala status` against adversarial terminal escape sequences (P1-5).
6. **Isolated helper unit tests over subprocess CLI tests:** `tests/run.ts` imported internal TypeScript modules directly rather than invoking `bin/kala` with `--version`, `kala state goal` (empty arg), out-of-order flags, or unstaged leading-space `git status --porcelain` lines (P1-2, P1-6).

---

## 2. P0 Blockers

### P0-1. `[Packaging]` `npm install -g` and `npx` fail with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`
- **Location:** `package.json:7-18`, `bin/kala:1-3`
- **Mechanism:** `package.json` ships raw `.ts` files (`"files": ["bin/", "src/", ...]`) and `bin/kala` imports `../src/index.ts`. Node 24 throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` whenever a `.ts` module resolves inside `node_modules/`. Global installs, local installs, and `npx` fail before `main()` runs.
- **Fix target:** Add a zero-dependency build/`prepack` script using Node 24's built-in `module.stripTypeScriptTypes()` to emit `.js` files into `dist/` (rewriting `.ts` import specifiers to `.js`). Point `bin/kala` at `../dist/index.js` when built (or ship `dist/` in `package.json` `files`). Add a packaging test that runs `npm pack`, extracts or installs under a temp `node_modules/` path, and asserts `kala --version` and `kala status` exit `0`.

### P0-2. `[Technical]` Exponential \(2^N\) backslash growth and dropped YAML constructs in state round-tripping
- **Location:** `src/util/yaml.ts:5-7`, `src/state/state.ts:89, 110-145`, `src/liveask.ts:73-105`
- **Mechanism:** `yaml.ts` serializes strings containing quotes, spaces, or colons via `JSON.stringify()`, while `loadState()` strips only outer quotes with `.replace(/^"|"$/g, '')` instead of `JSON.parse()`. Every `loadState` -> `saveState` cycle doubles backslashes (`\"` -> `\\\"` -> `\\\\\\\"`, reaching 1,022 backslashes in 4 `daylog` handoffs) and corrupts `\n` into literal `\n`. Agents editing `.kala/state.yaml` directly also lose data on YAML block scalars (`|` / `>`), single-quoted strings (`'...'`), flow arrays (`done: ["a", "b"]`), and empty `goal: ""` (`if (!s.goal) return null` resets the entire file).
- **Fix target:** Decode double-quoted YAML scalars via `JSON.parse()` (falling back safely on hand-edited invalid escapes), unescape single-quoted YAML scalars (`''` -> `'`), parse indented `|` / `>` block scalars and inline `[...]` arrays in both `state.ts` and `liveask.ts`, and preserve state when `goal` is empty if valid schema keys exist. Add a 10-cycle round-trip unit test with quotes, backslashes, colons, newlines, block scalars, and flow arrays.

### P0-3. `[Technical / UX]` `liveAsk` runs stateless headless calls without `--resume` or `--trust`, hanging 45s on handoff
- **Location:** `src/liveask.ts:19, 38-67, 108-123`, `src/index.ts:126, 323`
- **Mechanism:**
  1. `liveAskArgv` spawns `<agent> -p` with no session ID, starting a blank conversation with no memory of the completed work.
  2. `runLiveAsk` never passes `agent.trustFlags` even when `hasTrustGrant(repoDir)` is true, and prints no progress message before blocking with `stdin: 'ignore'`. In `daylog` phase `02 -> 03`, `cursor-agent -p` hung silently for 45.0s waiting on trust before `SIGKILL`.
  3. `offerHandoff` runs `liveAskAndMerge` on an agent that just exited due to an exhausted quota (`index.ts:126`).
  4. `liveask.ts:65` evaluates `code === 0 ? out : out` (dead ternary, parsing stdout on error exits), and `parseLiveAskYaml` turns `done: []` into `["[]"]`.
- **Fix target:** Skip `liveAsk` on `limit` exits. On `switch`, run `liveAsk` only when a fresh captured session ID exists for the previous owner; pass `resumeArgv(agent, sid)` and `trustFlags` (when `hasTrustGrant(repoDir)` is true); print a stderr notice (`kalaga: asking <agent> for handoff summary...`); reduce default timeout to 15s; discard output on non-zero exit codes; cap stdout buffer at 64 KiB; fix `[]` and block scalar parsing in `parseLiveAskYaml`.

### P0-4. `[Packaging]` Dirty git worktree: untracked CI dependency, `.pyc` artifacts, and hardcoded local path
- **Location:** `.github/workflows/test.yml:22-23`, `.gitignore`, `scripts/live-build-handoff.sh:9`
- **Mechanism:** `.github/workflows/test.yml` invokes `npm run test:e2e:auto` (`scripts/qa-e2e-regression.sh`), which is untracked. `.gitignore` lacks `__pycache__/` and `*.py[cod]`, and `scripts/live-build-handoff.sh` hardcodes `/home/<user>/Code/playground/daylog`.
- **Fix target:** Add `__pycache__/` and `*.py[cod]` to `.gitignore`, remove `tests/e2e/__pycache__/`, default `DAYLOG_ROOT` in `scripts/live-build-handoff.sh` to `$(mktemp -d -t kala-daylog-XXXXXX)`, and ensure all scripts referenced by `package.json` and CI are tracked cleanly.

---

## 3. P1 High Severity

### P1-1. `[Technical / UX]` Handoff prompt attributes the handoff to the receiving agent instead of the previous owner
- **Location:** `src/index.ts:152-155, 230-234, 267-271, 334-337`, `src/prompt.ts:60-72`
- **Mechanism:** Launch paths call `mergeState(repoDir, { owner: next.key })` before building `handoffInject(st)`. `handoffInject` reads `st.owner`, emitting `"Kalaga handoff from cursor"` when launching `cursor`.
- **Fix target:** Capture `const fromOwner = prevState?.owner ?? deadKey ?? null` prior to updating `owner`, and pass `fromOwner` into `handoffInject(st, rich, fromOwner)` (omitting `"from ..."` or saying `"prior session"` when `fromOwner` is null or equal to `next.key` on initial run).

### P1-2. `[Technical]` `modifiedFiles()` strips character 0 from unstaged modified paths
- **Location:** `src/state/git.ts:6-26`
- **Mechanism:** `git()` calls `.trim()` on full `git status --porcelain` output. When line 1 is an unstaged modification (`" M .github/workflows/test.yml"`), `.trim()` removes the leading space and `line.slice(3)` slices `"M ."` to `"github/workflows/test.yml"`. Renames (`R  a -> b`), quoted paths, 0-commit repos, and detached `HEAD` are also mishandled.
- **Fix target:** Trim only trailing newlines (`replace(/[\r\n]+$/, '')`) in `git()`, parse `git status --porcelain=v1 -z` NUL-delimited entries (taking the destination path on `R`/`C` statuses), fall back to `git symbolic-ref --short HEAD` on 0-commit repos, and format detached `HEAD` with `rev-parse --short HEAD`.

### P1-3. `[Technical / Packaging]` Windows `.cmd` shim `EINVAL` on spawn and hardcoded `~/.grok/bin/grok`
- **Location:** `src/config.ts:31, 64, 141-199`, `src/launch.ts:24-41, 102-116`, `src/ledger.ts:71`
- **Mechanism:** Node 20.12+ throws `EINVAL` when `spawn` targets `.cmd`/`.bat` shims on `win32` without `shell: true` (CVE-2024-27980). Separately, `grok` hardcodes `~/.grok/bin/grok` instead of checking `PATH` first, and `ledger.ts:71` invokes `grok` without `resolveExecutable`.
- **Fix target:** Check `'grok'` on `PATH` first with fallback to `~/.grok/bin/grok`, and use `resolveExecutable` in `ledger.ts`. On `win32`, when a resolved executable ends with `.cmd`/`.bat`, parse npm's shim target JS entrypoint and spawn `process.execPath` with `[scriptPath, ...args]` (`shell: false`).

### P1-4. `[Technical / UX]` Raw session-store substring scan causes false-positive limit hits on clean exits
- **Location:** `src/config.ts:42-88`, `src/trap.ts:19-49`, `src/index.ts:94-112, 202-209`
- **Mechanism:** `lastSessionText` scans the raw last 4,000 chars of JSONL/SQLite/meta files (including tool-read source code and user prompts) and classifies any regex match as `'limit'` even when `exitCode === 0`. Single-word patterns (`'quota'`, `'insufficient'`, `'credits'`) match normal engineering text, setting `status: 'BLOCKED'` and copying raw JSONL prefixes into `negative_constraints`.
- **Fix target:** Replace bare single-word patterns with vendor-specific quota phrases (`usage limit`, `quota exceeded`, `out of credits`, `insufficient credits`, `spending limit`, `rate limit exceeded`, `session limit`, `too many requests`). For Claude JSONL, extract assistant/error message text rather than raw JSON envelopes; extract a centered snippet around the match instead of columns `0..200`; when `exitCode === 0`, only trigger `'limit'` on explicit assistant/system error lines rather than user/tool input records.

### P1-5. `[Security]` `SECURITY.md` implementation gaps (`kala status` ANSI output, unvalidated `grok` sid, `KALA_HOME=""`, symlink/atomic checks)
- **Location:** `src/index.ts:43, 54-58`, `src/ledger.ts:71`, `src/config.ts:101-103`, `src/trust.ts:26-32, 75-85, 102-110`, `src/state/state.ts:106-110, 180-191`, `src/prompt.ts:42-52`
- **Mechanism:**
  1. `printStatus()` writes `branch`, `state.status`, `state.updated`, `state.goal`, `state.done[0]`, and `state.next_step` to stdout unsanitized, allowing ANSI/OSC terminal escape injection from cloned `.kala/state.yaml`. `sanitizeHandoffField` also leaves C1 (`\u0080-\u009f`) and Unicode bidi controls (`\u202a-\u202e`, `\u2066-\u2069`).
  2. `ledger.ts:71` passes `sid` from SQLite to `execFileSync(..., ['usage', sid])` without `isValidSessionId(sid)`.
  3. `KALA_HOME=""` uses `??`, resolving `trust.yaml` to `./trust.yaml` in `process.cwd()` and `/config.yaml` at filesystem root; `kalagaHome` is duplicated across 3 files.
  4. `loadState` omits `lstatSync` symlink checks; `saveState` writes predictable `.state.yaml.<pid>.tmp` without `flag: 'wx'`; `trust.ts` writes `trust.yaml` non-atomically without symlink checks or `0700` dir permissions.
- **Fix target:** Sanitize all dynamic fields in `printStatus()` and strip C1 + bidi controls in `sanitizeHandoffField`; guard `ledger.ts:71` with `isValidSessionId(sid)`; centralize `kalagaHome()` in `src/config.ts` using `.trim() || default`; enforce `lstatSync` symlink refusal on `loadState` and `trust.yaml`, `0o700` on `kalagaHome()`, and random `.tmp` + `{ mode: 0o600, flag: 'wx' }` atomic rename on both `state.yaml` and `trust.yaml`.

### P1-6. `[UX / Technical]` CLI argument and picker traps (`--version` launches agent, `kala state goal` wipes state, picker typos auto-launch)
- **Location:** `src/index.ts:366-380, 426-459`, `src/picker.ts:27-42, 66-81`
- **Mechanism:**
  1. `index.ts:454` routes any leading `--*` flag (`kala --version`) into `doStart()`, creating `.kala/state.yaml` and opening the launcher.
  2. `kala state goal` with no value writes `goal: ""`, causing subsequent `loadState` to drop the state file.
  3. Flags placed before agent keys (`kala switch --strict-state cursor`) fail with `unknown agent '--strict-state'`.
  4. In limit mode on a TTY, `interpretPickAnswer` returns index `0` (auto-launching the top agent) when the user types `n`, `no`, `exit`, or an out-of-range digit (`9`), and `Ctrl+D` on `readline` exits without resolving.
- **Fix target:** Add `-v` / `--version`; restrict bare-start flags to `--assume-limit` and `--strict-state` (unknown flags print help and exit `2`); separate flags from positional arguments in `main()`; make `kala state <subcmd>` with no text print that field (or usage error without mutating state); map `n`/`no`/`exit` and out-of-range inputs in `interpretPickAnswer` to `'stay'` (or re-prompt on invalid digits) and handle `rl.once('close')` EOF as `'stay'`.

### P1-7. `[UX / Technical]` Handoff takers skip post-exit session capture, leave `status: BLOCKED`, and drop trapping after one hop
- **Location:** `src/index.ts:107, 152-156, 230-235, 334-340`
- **Mechanism:** Takers launched via `offerHandoff`, clean-exit handoff, or `doSwitch` do not run `afterExit`, and picker-launched takers do not even call `captureFor` or `refreshState(null)`. `status: 'BLOCKED'` set at limit time is never cleared to `'IN_PROGRESS'` when a taker starts. If the taker also hits a limit, Kalaga exits straight to the shell without trapping.
- **Fix target:** Reset `status: 'IN_PROGRESS'` when launching an active agent session (unless already `COMPLETED` and resuming/inspecting). Run `afterExit` (bounded by a max hop counter, e.g. `MAX_HANDOFF_HOPS = 8`, always gated by interactive `pick`) after `doSwitch` and picker-launched takers so session IDs, modified files, and subsequent limits are captured consistently.

---

## 4. P2 Medium Severity

### P2-1. `[Technical]` `grokUsage` double-counts total tokens and runs a 10s sync subprocess inside `sessionHintFor`
- **Location:** `src/ledger.ts:58-85, 136-139`
- **Fix target:** Split `grokSessionHint(repoDir)` (SQLite lookup only) from `grokUsage(repoDir)` so `sessionHintFor` never spawns `grok usage`. In `grokUsage`, parse an explicit `total` token line first and sum `input` + `output` only when no total line is present.

### P2-2. `[UX]` Ledger ignores quota-window age and labels `250k - tokens` as `[exact]`
- **Location:** `src/ledger.ts:25-56, 90-116`, `src/index.ts:45-51`
- **Fix target:** Filter Claude JSONL turn usage to entries within a rolling 5-hour window (using entry `timestamp` when present, falling back to file `mtimeMs`) and Cursor chat directories to recent `mtimeMs` (24 hours). Display honest labels (`est. window` / `logged` rather than claiming `250k - tokens` is an exact vendor quota balance), and note in docs/help that `agy` session IDs are not auto-captured from disk.

### P2-3. `[UX]` Cold-start and clean-exit friction (`kala init` overwrite, premature state write, self-ranked clean exit, `DONE` status)
- **Location:** `src/index.ts:219, 239, 259-272, 382-390`, `src/state/state.ts:128`
- **Fix target:** Guard `kala init` against overwriting an existing `.kala/state.yaml` unless `--force` is passed; defer `saveState` in `doStart()` until after `pick()` confirms an agent; exclude the just-exited agent (or omit its `+250` owner bonus) in the clean-exit `"hand off, or stay?"` shortlist; pass `STANDING_ORDERS` on cold `kala run` when state exists on disk; normalize `status: 'DONE'` -> `'COMPLETED'` (and unknown strings -> `'IN_PROGRESS'`) in `loadState`.

### P2-4. `[GTM / Docs]` Duplicate `README.md` pitch section, missing `--help` entries, and stale path/config docs
- **Location:** `README.md:11-25, 80-95`, `src/index.ts:406-423`, `docs/guides/qa-e2e-regression.md:49`, `docs/specs/ARCH-001-product-architecture.v1.md:89, 108`
- **Fix target:** Merge duplicate `### Why this exists` and `## Why it exists` in `README.md`; document bare `kala`, `kala state`, `--strict-state`, `--force`, and `--version` in both `printHelp()` and `README.md`; update `.e2e-runs/<UTC>/` path in `qa-e2e-regression.md`; update `ARCH-001` to reflect fixed builtin ceilings and `resume`.

---

## 5. P3 Polish

### P3-1. `[GTM / Docs]` Internal delivery/waiver codes in public docs and dead spec redirect stub
- **Location:** `README.md:158, 175`, `SECURITY.md:35`, `CONTRIBUTING.md:10-13`, `CHANGELOG.md`, `docs/SECURITY_REMEDIATION_SPEC.md`, `docs/specs/OPS-001-share-readiness.v1.md`, `src/index.ts:296`
- **Fix target:** Replace internal ticket/waiver shorthand in `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, and user-facing `src/index.ts` messages with plain English; remove redirect stub `docs/SECURITY_REMEDIATION_SPEC.md` and move superseded `OPS-001-share-readiness.v1.md` to `docs/specs/history/`.

### P3-2. `[Packaging / UX]` Portable `bin/kala` shebang and actionable Claude cold-folder trust guidance
- **Location:** `bin/kala:1`, `src/launch.ts:19-25`
- **Fix target:** Change `bin/kala` shebang from `#!/usr/bin/env -S node --no-warnings` to `#!/usr/bin/env node`. In `noteClaudeFolderTrust`, check whether `claudeProjectDir(repoDir)` already exists; when missing, warn specifically that Claude defaults to `'No, exit'` on new folders and requires pressing Down then Enter to trust.
