# FEAT-004 — Continuous Checkpointing via Agent Lifecycle Hooks

| Field | Value |
|-------|-------|
| **ID** | FEAT-004 |
| **Version** | v3 |
| **Status** | `certify` |
| **Date** | 2026-11-27 |
| **Supersedes** | `FEAT-004 v2` (`done`, `CERT-008`; Phase 1 `claude` + `agy` only) |
| **Owner** | Technical lead |
| **Depends on** | ARCH-001 v1; SEC-001 v1; FEAT-003 v1; FEAT-004 v2 implementation |
| **Build priority** | Current |
| **Dependencies** | Node.js ≥ 22.18 stdlib only (no external packages, no network calls) |

---

## 1. Intent

`FEAT-004 v2` delivered continuous checkpointing for `claude` and `agy` while deferring `cursor` and `grok` until their live hook contracts were verified. Live verification against `cursor-agent` (`v2026.11.22`) and `grok` (`v1.0.92`) established exact stdin/stdout contracts—and uncovered a cross-vendor compatibility overlap where `cursor-agent` loads `.claude/settings.local.json` and `grok` loads `.claude/settings.local.json` and sends `GROK_*` env vars to all hooks.

**Outcome:** Support all four agents (`claude`, `agy`, `cursor`, `grok`) in `kala hooks install|status|uninstall` and `kala _hook`, with deterministic cross-vendor deduplication so multiple installed hook configs never double-count edits or double-nudge.

---

## 2. In / out of scope

**In:**

- Extend `kala _hook` (`src/hook.ts`) and `kala hooks install|status|uninstall` (`src/hooks.ts`) to `cursor` and `grok` alongside `claude` and `agy`.
- Cross-vendor overlap suppression and `tool_use_id` deduplication in `src/hook.ts` (preserving minimal imports: Node stdlib + `./config.ts` only).
- CLI `--help`, `README.md`, `SECURITY.md`, `CHANGELOG.md`, `tests/run.ts`, and `H-04` / `H-05` in `scripts/qa-e2e-regression.sh`.

**Out:**

- Global (`--global`) hook installation.
- Modifying `.claude/settings.json` or vendor-global configs.

---

## 3. Verified `cursor` & `grok` Hook Contracts

### 3.1 Cursor (`cursor-agent` v2026.11.22)

- **Config file:** `.cursor/hooks.json` (`version: 1`, `hooks.postToolUse` array with `matcher: "Write|Edit|Shell|StrReplace|Delete"`, `hooks.stop` array).
- **Stdin root & fields (live-verified):** `workspace_roots: string[]` (snake_case), `cwd` (populated on `Shell` calls), `cursor_version`, `tool_name`, `tool_input`, `tool_use_id`, `stop_hook_active`, `loop_count`, `status`.
- **Output contracts (live-verified):**
  - `PostToolUse` (when threshold/age + cooldown met): `{"additional_context":"<nudge>"}` (verified in live `cursor-agent -p` that the model reads `additional_context`).
  - `Stop` (when `editsSinceCheckpoint >= 1` and `stop_hook_active !== true && status !== 'aborted' && !(typeof loop_count === 'number' && loop_count > 0)`): `{"followup_message":"<nudge>"}`.
- **Overlap behavior (live-verified):** `cursor-agent` also executes `.claude/settings.local.json` on the same `tool_use_id` (passing `cursor_version` in stdin).

### 3.2 Grok (`grok` 1.0.92)

- **Config file:** `.grok/hooks/kalaga-checkpoint.json` (`hooks.PostToolUse` matcher `Edit|Write|MultiEdit|Bash|search_replace|write|run_terminal_command`, `hooks.Stop`), invoking `bin/kala` directly via `command` + `args: ["_hook", "--agent", "grok", "--event", ...]` (or `node` wrapper on `win32`). Note: Grok refuses project hooks in untrusted folders (`GROK_FOLDER_TRUST=0` or `/hooks-trust`).
- **Stdin root & env (live-verified):** Env includes `GROK_HOOK_EVENT`; stdin includes `cwd`, `workspaceRoot`, `toolName` / `tool_name`, `toolInput` / `tool_input`, `toolUseId` / `tool_use_id`, `stopHookActive` / `stop_hook_active`, `reason`, `subagentType`.
- **Output contracts (verified against local Grok `10-hooks.md` + live probe):**
  - `PostToolUse` (when threshold/age + cooldown met): `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"<nudge>"}}`.
  - `Stop` (when `editsSinceCheckpoint >= 1`, `stopHookActive !== true && stop_hook_active !== true`, `!(typeof subagentType === 'string' && subagentType.length > 0)`, and `!(typeof reason === 'string' && reason !== 'end_turn')`): `{"decision":"block","reason":"<nudge>"}`. Session-end teardown fires (`reason: "shutdown"` or `"channel_closed"`) return `{}`.

---

## 4. Requirements (`FEAT-004 v3`)

| ID | Requirement |
|----|-------------|
| K22 | `SUPPORTED_HOOK_AGENTS` includes `claude`, `agy`, `cursor`, `grok`; `install` defaults to installed CLIs; `uninstall` targets all four; `hooks status` reports all four with per-agent error isolation. |
| K23 | `installCursorHooks` non-destructively merges `.cursor/hooks.json` (`version: 1`, `hooks.postToolUse`, `hooks.stop`), warns if not gitignored, refuses symlinks, and aborts on malformed JSON. |
| K24 | `installGrokHooks` non-destructively writes/updates `.grok/hooks/kalaga-checkpoint.json` (removing only its own file on `uninstall` if empty), warns if not gitignored, notes Grok folder-trust requirement, refuses symlinks, and aborts on malformed JSON. |
| K25 | `findRepoRoot` resolves `cwd` → `workspaceRoot` → `workspace_roots[0]` → `workspacePaths[0]` → `fallbackCwd`; `isSelfEdit` detects Cursor and Grok edits targeting `.kala/state.yaml` or `kala state`. |
| K26 | Cross-vendor overlap & dedup guard: `--agent claude` with `cursor_version` no-ops `{}` if `.cursor/hooks.json` has Kalaga's cursor hook; `--agent claude` / `cursor` with `GROK_HOOK_EVENT` no-ops `{}` if `.grok/hooks/kalaga-checkpoint.json` has Kalaga's grok hook; duplicate `PostToolUse` `tool_use_id` / `toolUseId` in `lastToolUseId` never double-increments `editsSinceCheckpoint`. |
| K27 | `tests/run.ts` and `scripts/qa-e2e-regression.sh` (`H-04`, `H-05`) cover `K22`–`K26`, verified on both Node 22 LTS and Node 24 plus live `cursor-agent` / `grok` runs. |
