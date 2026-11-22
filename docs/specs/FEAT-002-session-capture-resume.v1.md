# FEAT-002 — Session Capture + Resume

| Field | Value |
|-------|-------|
| **ID** | FEAT-002 |
| **Version** | v1 |
| **Status** | `locked` |
| **Date** | 2026-11-22 |
| **Supersedes** | — |
| **Owner** | Technical lead |
| **Depends on** | ARCH-001 v1; SEC-001 v1 (done); FEAT-001 v1 (done) |
| **Build priority** | 1 (next handoff) |

---

## 1. Intent

After an agent exits, Kalaga already *finds* that agent’s session identifier
(ledger `sessionHint`: Claude jsonl name, Grok `session_id`, Cursor chat dir).
It does not persist it. The picker’s “wait for reset” row therefore cannot
bring the user back into the **same** conversation after a quota window
refills — relaunch starts cold, re-reads `.kala/state.yaml`, and burns tokens
re-deriving context.

**Outcome:** Kalaga persists per-agent session IDs into the handoff state and
exposes an exact resume path:

```text
kala resume <agent>     # resume captured session by ID (when supported)
kala resume             # resume current owner’s captured session, if any
```

Capture is near-zero cost (reuse ledger discovery). Resume is exact (ID), not
ambiguous `--continue` “most recent in cwd.”

---

## 2. In / out of scope

**In:**

- Persist `{ agent → { id, at } }` into `.kala/state.yaml`
- Capture after every kala-spawned exit (and on `refreshState` / recover when a hint exists)
- `kala resume [agent]` using vendor resume-by-id flags (verified below)
- Clear / stale handling (missing id, unsupported agent, expired / gone session)
- Wire the limit-picker “wait for reset” row to print a one-line resume hint
- Replace the unused flat `resume: ['--continue']` stub with structured resume argv
- README + CHANGELOG; package bump to **0.4.0**
- Tests for id normalization, resume argv builder, stale rejection

**Out:**

- Chained post-exit menu loops (FEAT backlog)
- Live-ask / print-mode capture
- Syncing vendor trust DBs
- Resuming a *different* agent’s session as a handoff (cross-agent resume is not a thing — handoff still uses inject + new session)
- Auto-resume without a user command
- Discovering agy’s conversation ID from disk (unknown store — degrade)

---

## 3. Approach

### 3.1 Why this is sound

| Claim | Evidence |
|-------|----------|
| IDs already discovered | `AgentUsage.sessionHint` in `ledger.ts` (Claude file, Grok sid, Cursor chat) |
| Exact resume beats `--continue` | `--continue` = most recent in cwd; intervening sessions steal it |
| Safe in state file | Session IDs are vendor-local handles, not API keys; `.kala/` already gitignored |
| Cheap | Persist hint after exit; no new network; no new deps |

### 3.2 Vendor resume flags (verified 2026-11-22 on this machine)

| Agent | Capture source today | Resume by ID (verified) | Latest-only fallback |
|-------|----------------------|-------------------------|----------------------|
| **claude** | `~/.claude/projects/…/<uuid>.jsonl` → store **uuid** (strip `.jsonl`) | `claude -r <id>` / `claude --resume <id>` | `claude -c` / `--continue` |
| **cursor** | `~/.cursor/chats/…/<chatId>/` → store **chatId** | `cursor-agent --resume <chatId>` | `cursor-agent --continue` |
| **grok** | sqlite `session_id` → store as-is | `grok -r <id>` / `grok --resume <id>` | `grok -c` / `--continue` |
| **agy** | none (`sessionHint` always null) | `agy --conversation <id>` **when** an id exists | `agy -c` / `--continue` |

**agy:** flag exists (`--conversation`), but Kalaga cannot discover the id yet.
Capture stays null; `kala resume agy` errors with a clear “no captured session”
(or “resume-by-id unsupported until store discovery”) unless the user later
sets one via a documented escape hatch (optional: `kala state session agy <id>`
— include only if cheap; otherwise defer).

Do **not** use `--continue` for `kala resume` when an id is present. `--continue`
remains available only as an explicit future escape (`kala resume --latest`)
if needed — **deferred**; v1 is ID-only when possible.

### 3.3 State shape

Add to `HandoffState` (YAML under `.kala/state.yaml`):

```yaml
sessions:
  claude:
    id: "550e8400-e29b-41d4-a716-446655440000"
    at: "2026-11-22T12:00:00.000Z"
  cursor:
    id: "abc123chat"
    at: "2026-11-22T11:00:00.000Z"
```

Rules:

- Map keyed by agent key; one entry per agent (last write wins).
- `id` = vendor-native resume token after normalization (Claude: no `.jsonl` suffix).
- `at` = ISO timestamp when captured.
- Absent key = nothing to resume for that agent.
- Load/save via existing naive YAML helpers (extend reader for one-level nested map) **or** a dedicated mini-block parser — keep zero deps. If nested YAML proves fragile, store as flat keys `session_claude_id` / `session_claude_at` (acceptable fallback; document choice in PR).

### 3.4 Capture timing

On every path that already refreshes after an agent run:

1. After `runAgent` returns (inside `afterExit`, and after `doSwitch` exit if we add a light capture-only refresh — **minimum:** `afterExit` + `offerHandoff`/`refreshState(deadKey)` + successful `doRecover` path).
2. Read ledger (or call the same tailer helper) for that agent’s `sessionHint`.
3. If non-null, normalize and `mergeState` patch into `sessions[agent]`.

Capture must **not** change exit-tier classification or picker defaults (FEAT-001 unchanged).

### 3.5 Resume command

```text
kala resume [<agent>]
```

| Case | Behavior |
|------|----------|
| Agent omitted | Use `state.owner` if set and has a session entry; else error |
| Has fresh session | `resolveTrust` → spawn with resume-by-id argv (no handoff inject prompt — conversation already has context). Optional one-line stderr: `kalaga → resume <agent> (<id>…)` |
| No entry / empty id | Error: `kalaga: no captured session for <agent> — run it via kala first` |
| Stale (see R-fresh) | Error with hint to `kala run <agent>` |
| Unsupported / unknown flag | Should not happen for claude/cursor/grok; agy without id → error as above |

After resume child exits → same FEAT-001 `afterExit` flow as `kala run`.

### 3.6 Freshness (dumb rule)

A captured session is **usable** for resume if **all** hold:

1. `at` is within **7 days** (config optional later; hardcode 7 in v1), **and**
2. Vendor artifact still exists when checkable:
   - claude: `claudeProjectDir` + `<id>.jsonl` exists
   - cursor: chat dir under `~/.cursor/chats` still exists (best-effort walk or path if stored)
   - grok: sqlite row for `session_id` still present (best-effort; if check fails closed, allow resume and let vendor error)

If stale → refuse resume; leave the stale entry in state (or prune on next capture for that agent).

### 3.7 Picker “wait for reset”

When user chooses `[0] wait` on a limit menu for dead agent `D`, and
`sessions[D]` exists and is fresh, print:

```text
kalaga: when the window resets → kala resume D
```

No behavior change to wait itself (still no launch).

### 3.8 Rejected alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Only `--continue` | Ambiguous after any other session in the same cwd |
| Capture without resume command | Half-feature; IDs rot unused |
| Cross-agent “resume other CLI’s id” | Vendors don’t share session stores |
| Auto-resume on next `kala run` after limit | Surprising; user may want a different agent |

---

## 4. Requirements

### 4.1 Capture

| ID | Requirement |
|----|-------------|
| R1 | Extend handoff state with per-agent session records `{ id, at }` (nested `sessions:` or documented flat keys). |
| R2 | Normalize Claude hints: strip trailing `.jsonl`; store UUID/stem only. |
| R3 | After kala-spawned exits that flow through `afterExit`, if ledger `sessionHint` for that agent is non-null, persist R1 record. |
| R4 | `refreshState(deadKey)` / recover limit path also updates that agent’s session when a hint exists. |
| R5 | Capture never invents ids for agy when hint is null. |

### 4.2 Resume argv + config

| ID | Requirement |
|----|-------------|
| R6 | Replace unused `resume: string[]` stub with structured fields, e.g. `resumeByIdPrefix: string[]` (flags before the id) and optional `resumeLatest: string[]` (unused in v1 command, may remain for future). |
| R7 | Verified prefixes: claude `['-r']` or `['--resume']`; cursor `['--resume']`; grok `['-r']` or `['--resume']`; agy `['--conversation']`. |
| R8 | `runAgent` (or a sibling `resumeAgent`) spawns resolved binary + trustFlags (conditional) + resumeByIdPrefix + id — **no** initial handoff inject unless explicitly configured (default: none). |

### 4.3 `kala resume`

| ID | Requirement |
|----|-------------|
| R9 | Command `kala resume [agent]` as in §3.5. |
| R10 | Freshness gate §3.6; fail closed with a clear message. |
| R11 | On success, child exit goes through FEAT-001 `afterExit`. |
| R12 | Help / README document `kala resume` and the wait-hint. |

### 4.4 Wait-row hint

| ID | Requirement |
|----|-------------|
| R13 | Limit-picker wait (`choice.wait`) prints resume hint when a fresh session exists for the dead agent (§3.7). |

### 4.5 Hygiene

| ID | Requirement |
|----|-------------|
| R14 | Session ids never appear in the default short `handoffInject` prompt (pointer + next only). Rich inject may omit them too unless a future flag asks. |
| R15 | `npm test` gains cases: Claude id normalize; resume argv assembly; freshness reject when `at` too old; missing session error path (pure where possible). |
| R16 | `package.json` → `0.4.0`; CHANGELOG entry citing FEAT-002. |

---

## 5. Touch map

| Path | Change |
|------|--------|
| `src/state/state.ts` | `sessions` on `HandoffState`; load/save |
| `src/config.ts` | structured resume fields; drop misleading flat `--continue` stub meaning |
| `src/launch.ts` | resume spawn helper; optional existence checks |
| `src/ledger.ts` | maybe export a `sessionHintFor(agent, repoDir)` helper (avoid duplicating tailers) |
| `src/index.ts` | capture hooks; `kala resume`; wait-hint |
| `README.md` / `CHANGELOG.md` / `package.json` | docs + 0.4.0 |
| `tests/run.ts` | R15 cases |

**Constraint:** ARCH A4/A5/A6 — argv spawn, picker unchanged for handoff, no new deps.

---

## 6. Verification

### Automated

- Normalize `foo.jsonl` → `foo`
- `resumeArgv(agent, id)` matches R7
- Freshness: `at` = 8 days ago → not fresh
- State round-trip: save/load `sessions.claude.id`

### Manual

- [ ] `kala run claude` → exit → `state.yaml` has `sessions.claude.id`
- [ ] `kala resume claude` reopens that conversation (same id)
- [ ] Limit menu → `0` wait → prints `kala resume claude` when session present
- [ ] `kala resume agy` with no capture → clear error
- [ ] Stale/deleted jsonl → clear error

### Certify

Builder marks INDEX `certify`, opens next CERT referencing **FEAT-002 v1**.

---

## 7. Deferred

| Item | Why |
|------|-----|
| `kala resume --latest` (`--continue`) | Ambiguous; ID path is the point of this FEAT |
| `kala state session <agent> <id>` manual set | Nice escape; add only if builder finds it trivial |
| agy on-disk conversation discovery | No known public store |
| Claude `--resume /abs/path/to.jsonl` | ID form is enough; path form as future hardening |
| Cross-worktree session search | Vendor may already search; don’t reimplement |
| Config `session_ttl_days` | Hardcode 7 in v1 |

---

## 8. Done when

- CERT pass against this file
- Capture visible in state after a real `kala run`
- `kala resume` works for at least **claude** and one of **cursor|grok** on the builder’s machine
- Wait-row hint present
- Tests green; version 0.4.0

---

## 9. Handoff blurb (paste to builder)

> Implement **FEAT-002 v1** under ARCH-001 + SEC-001 + FEAT-001. Persist
> ledger `sessionHint` into `.kala/state.yaml` (`sessions.<agent>.{id,at}`),
> normalize Claude `.jsonl` names, add `kala resume [agent]` using verified
> flags (claude/grok `-r`/`--resume`, cursor `--resume`, agy
> `--conversation` when id known). Freshness = 7 days + artifact exists when
> checkable. No handoff inject on resume. Wait-for-reset prints
> `kala resume <dead>` when a fresh session exists. No new deps. Bump 0.4.0.
> Mark INDEX `certify` and open CERT when done.
