# Kalaga (`kala`)

One CLI across **agy / cursor / grok / claude**. When your agent hits its
session/usage limit, Kalaga catches it, keeps your handoff state warm, and
offers to continue the work on a fresh agent — one keypress.

## Install

```sh
ln -s ~/Code/playground/kalaga/bin/kala ~/.local/bin/kala
```

Requires Node ≥ 24 (native TypeScript type-stripping — no build step, no deps).

## Usage

```sh
kala init                 # create .kala/state.yaml from git facts
kala status               # headroom per agent + handoff state
kala run <agent>          # work in <agent>; on limit hit → pick a taker
kala recover              # after a limit hit (works even if the agent was
                          # launched directly, not via kala)
kala switch <agent>       # hand off to <agent> now
kala why [deadAgent]      # show the taker ranking (dry run)
kala state goal|next|note|neg <text>   # edit the handoff state by hand
kala agents               # list known agent keys
```

### The loop

1. `kala run claude` — launches claude with the handoff prompt.
2. claude dies with "usage limit reached" in its session log.
3. Kalaga detects it (per-agent signature match on the session store),
   refreshes `.kala/state.yaml` from git facts, and shows:

   ```
   💀 claude — limit hit
   continue on →
     * [1] agy      250k left   owns current handoff state
       [2] cursor   250k left   unused this window
       [0] claude   wait for reset
   ```

4. You press `1` (or Enter for the recommendation). The next agent opens
   with the state injected.

## How it works

- **`.kala/state.yaml`** — the single source of truth for handoff (goal,
  status, owner, branch, modified files, negative constraints, next step,
  notes). Same shape as the `.session_state.yaml` protocol, so agents that
  already read that file read this one too.
- **Ledger** — per-agent token count read from each CLI's own session store:
  claude (`~/.claude/projects/…/*.jsonl`, exact), grok
  (`~/.grok/sessions/session_search.sqlite` + `grok usage`, exact),
  cursor (`~/.cursor/chats/…/meta.json`, estimate), agy (unknown).
- **The trap** — never pipes the TUI (CLIs degrade their UI on non-TTY).
  Instead, after the agent exits, Kalaga scans the tail of the agent's own
  session log for its limit signatures. This is also why `kala recover`
  works for agents you launched directly.
- **The router** — deliberately dumb: rank fresh agents by (owns the handoff
  state) → (least recently used). No context-window or task-affinity logic.

## Config

`~/.kala/config.yaml` (optional) — override token ceilings used for the
headroom/freshness estimate:

```yaml
ceilings:
  agy: 1000000
  cursor: 250000
  grok: 250000
  claude: 250000
```

Limit-detection signatures and agent binaries live in `src/config.ts`
(`limitPatterns` per agent). If an agent's limit message isn't caught, add
its phrase there.

## Notes

- Token counts are local estimates of the vendor's usage window — claude and
  grok are exact, cursor/agy are inferred. The vendor's real quota is
  server-side and not fully exposed.
- Rename the app: touch `bin/kala`, `package.json`, and the strings in
  `src/index.ts`. Agents are addressed by key everywhere else.
