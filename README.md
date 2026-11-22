# Kalaga (`kala`)

One CLI across **agy / cursor / grok / claude**. When your agent hits its
session/usage limit, Kalaga catches it, keeps your handoff state warm, and
offers to continue the work on a fresh agent — one keypress.

## Install

```sh
ln -s ~/Code/playground/kalaga/bin/kala ~/.local/bin/kala
chmod 755 bin/kala          # user-local only; not intended for system-wide install
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
kala resume [agent]       # reopen a captured session by id (default: owner)
kala why [deadAgent]      # show the taker ranking (dry run)
kala state goal|next|note|neg|done <text>  # edit the handoff state by hand
kala trust                # list trust grants
kala trust revoke <path>  # drop one grant (or: kala trust revoke --all)
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

### After any agent exits

Every agent launched via bare `kala` or `kala run` is followed by a
**tiered prompt** based on the evidence of *why* it stopped:

| Evidence | What kala does |
|----------|----------------|
| Limit signature in the session log | `💀 <agent> — limit hit` → picker (Enter = taker) |
| No session log + non-zero exit code | `assume it hit its limit? [y/N]` (or `kala --assume-limit`) |
| Clean exit (code 0 / no signature) | `hand off, or stay?` → **Enter stays**, number = hand off |

`q` (or `e`) always returns to your shell without launching. A clean exit
is never classified as a limit hit, and nothing is ever launched on a clean
exit unless you type a number — so a deliberate `/exit` costs one keypress.

### Resuming after a quota reset

Kala captures each agent's session id as it runs (Claude jsonl name, Grok
`session_id`, Cursor chat dir) and stores it in `.kala/state.yaml`. After a
limit hit, picking the `wait for reset` row prints:

```
kalaga: when the window resets → kala resume claude
```

`kala resume <agent>` (or bare `kala resume` for the current owner) reopens
the **same conversation** by id — full context, no token spend re-deriving
it. A session is usable for 7 days while its vendor artifact exists. `agy`
has no discoverable session store yet: `kala resume agy` tells you to run it
via kala first (nothing is invented).

## The handoff protocol (`.kala/state.yaml`)

State is the contract between agents. Every agent Kalaga launches is told
(standing orders) to **update the file before it stops or hits a limit**:

| Field | Meaning | Who writes it |
|-------|---------|---------------|
| `goal` | why this work exists | human / agent / live-ask |
| `done` | bullets of what already landed (≤12 × 300 chars) | agent / live-ask / `kala state done` |
| `next_step` | one concrete next action | agent / live-ask / human |
| `negative_constraints` | failures not to repeat (≤20 × 200 chars) | agent / limit note / human |
| `notes` | short "where things stand" | agent / git seed / live-ask |
| `modified_files` | git porcelain | Kalaga (tailer) |
| `sessions` | captured session ids (FEAT-002) | Kalaga (capture path) |

**Protocol inject.** Every cross-agent launch (handoff picker, clean-tier
handoff, `kala switch`) opens with: pointer to read `.kala/state.yaml`,
`Goal:`, `Done:` bullets, `Next step:`, `Avoid:`, and the standing orders —
all sanitized and length-capped. `inject_rich_prompt: true` in
`~/.kala/config.yaml` adds `Context:` (notes) + modified files. `kala
resume` deliberately injects nothing — the conversation already has context.

*Amends SEC-001 P3:* the handoff default is no longer "pointer + next step
only" — it is the protocol inject above. Security behavior (sanitize, caps,
no raw field leakage) is unchanged; only the coverage is broader.

**Live-ask.** At a limit handoff (and `kala switch`), before the picker
launches anything, Kalaga asks the dying agent one headless print-mode
question: "reply with ONLY a YAML block with keys goal, done, next_step,
notes, negative_constraints". It parses the answer, sanitizes it, and merges
it (`_source: live-ask`). Timeout 45s, piped stdio (never TTY), and it
**fails soft** — a timeout, error, or empty answer just keeps the existing
state and the handoff proceeds. Budget note: this spends a little of the
dying agent's remaining quota; that is intentional and the whole point.

**Thin-state warning.** Before a cross-agent launch, if `goal` is
uncaptured, `done` is empty with short notes, or `next_step` is the blank
default, Kalaga prints `kalaga: handoff state looks thin — taker may drift`
and continues. `kala switch <agent> --strict-state` aborts instead.

**Manual edits:** `kala state done "shipped X"` appends a bullet;
`kala status` shows the done count + first bullet.

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

`~/.kala/` holds all per-user state: `config.yaml`, `trust.yaml`. Override
the location with **`$KALA_HOME`** (e.g. `KALA_HOME=~/.config/kala kala
status`) — useful for testing or multi-account machines.

`config.yaml` (optional) — override token ceilings used for the
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

## Security

- **Trust propagates; it does not invent.** A cold launch of a trust-capable
  agent (cursor, `--trust`) asks once: `Trust this directory for Kalaga
  handoffs? [y/N]`. On `y` a grant for that exact directory (realpath) is
  recorded in `~/.kala/trust.yaml` and later handoffs reuse it. No grant →
  no trust-skip flag. A different path prompts again; an expired grant
  (default 30d, `trust_ttl_days:` in config) prompts again. Manage with
  `kala trust` / `kala trust revoke [path|--all]`.
- **Handoff state is an instruction surface.** `.kala/state.yaml` can be
  written by any agent (or a hostile repo), so every field — scalars and
  list items alike — is sanitized (ASCII controls stripped, length-capped:
  goal 1000, next_step 500, notes 2000, done 12×300, negatives 20×200)
  before it enters the receiving agent's prompt. The default handoff inject
  is the protocol inject (see above), still fully sanitized. **Gitignore
  `.kala/`** and never put secrets in the state.
- **State writes never follow symlinks.** `.kala` must be a real directory
  and `state.yaml` a real file; writes go to a temp file + atomic rename at
  mode `0600`.
- **Honest limit detection.** A clean exit (empty session tail) is not a
  limit hit — no picker. Recovering from a store-less agent (agy) requires
  `--assume-limit` or an explicit `y`.
- **Binaries are resolved once.** Each agent's binary is resolved to an
  absolute path before spawn; kala trusts that resolved binary at launch
  time (it does not re-hash it). Hostile `PATH` entries at first resolve are
  an accepted residual, as is passing `process.env` to children.
- **Claude project-dir lookup** uses one shared helper and disambiguates
  dash-escape collisions via per-session `cwd` metadata when present.
  Residual risk: two realpaths whose Claude sessions carry no `cwd` line
  cannot be told apart — a vendor layout limitation, not fixable here.

## Notes

- Token counts are local estimates of the vendor's usage window — claude and
  grok are exact, cursor/agy are inferred. The vendor's real quota is
  server-side and not fully exposed.
- Rename the app: touch `bin/kala`, `package.json`, and the strings in
  `src/index.ts`. Agents are addressed by key everywhere else.
