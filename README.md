# Kalaga

**Local handoff across AI coding CLIs.** Use all your subscriptions efficiently.

Kalaga (`kala`) sits in front of the agent tools you already use—Antigravity (`agy`), Cursor Agent, Grok, and Claude Code. When one hits a usage or session limit, it refreshes a shared project handoff file and lets you continue on another installed agent with a single keypress.

*Kalaga* (Telugu): a mix / blending — capacity across CLIs without replacing them. The shell command is `kala`.

No cloud account. No runtime dependencies. A git checkout runs as-is. `npm pack` builds plain JavaScript into `dist/` so an install does not ask Node to strip TypeScript inside `node_modules`.

## Why it exists

I already held the AI subscriptions, some strong and some still improving, and kept looking for a way to combine them so tokens did not sit idle when one product hit a wall. Coding CLIs are close enough now that the missing piece is continuity. Unpredictable Google AI Pro / Antigravity limits made that gap hard to ignore.

Kalaga is the handoff layer that came out of that. Switching tools by hand means re-explaining the goal, what already shipped, and what to avoid. Kalaga keeps that contract in the repo (`.kala/state.yaml`), detects limits from each vendor’s local session store (without piping the interactive TUI), and asks which agent should take over.

| | |
|---|---|
| **License** | MIT |
| **Runtime** | Node.js ≥ 24 |
| **Agents** | Antigravity (`agy`) · Cursor (`cursor-agent`) · Grok · Claude Code |
| **Install** | Source symlink / `node bin/kala`, or `npm install` from a packed tarball |

## Requirements

- [Node.js](https://nodejs.org/) **24 or newer** (git checkouts run TypeScript directly; packed installs use `dist/`)
- At least one supported agent CLI on your `PATH`, authenticated as usual for that product
- A git working tree for the project you are handing off (recommended)

## Install

### Linux / macOS

```sh
git clone https://github.com/vgundala/kalaga.git
cd kalaga
chmod 755 bin/kala
ln -sf "$(pwd)/bin/kala" ~/.local/bin/kala   # ensure ~/.local/bin is on PATH
kala --help
```

### Windows (PowerShell)

```powershell
git clone https://github.com/vgundala/kalaga.git
cd kalaga
# Option A — call Node directly
node .\bin\kala status
# Option B — add a user alias, or put bin\ on PATH and use bin\kala.cmd
.\bin\kala.cmd status
```

### Windows (Git Bash)

Same as Linux: symlink or alias `bin/kala`, or run `node bin/kala …`.

### Verify

```sh
node -v          # ≥ v24
npm test         # zero-dependency suite; no network
kala status      # or: node bin/kala status
```

## Quick start

```sh
cd your-project
kala init
kala status
kala run claude          # or: agy | cursor | grok
# On a limit hit → pick the next agent from the menu
# After that vendor’s window resets:
kala resume claude
```

## Commands

```text
kala                               Pick an installed agent and start
kala init [--force]                Create .kala/state.yaml (no overwrite unless --force)
kala status                        Headroom + handoff summary
kala run <agent>                   Interactive session; post-exit handoff
kala recover                       Trap after a limit when the agent was launched outside kala
kala switch <agent>                Hand off now
kala resume [agent]                Reopen a captured session by id (default: owner)
kala why [deadAgent]               Dry-run taker ranking
kala state                         Print the handoff state as JSON
kala state goal|next|note|neg|done [text]
                                   Set that field, or print it when text is omitted
kala hooks install [--agents claude,agy]
                                   Install/merge checkpoint hooks in this repo
kala hooks status                  Show installed hooks + last checkpoint age
kala hooks uninstall               Remove Kalaga hooks (keep user hooks)
kala trust                         List trust grants
kala trust revoke <path|--all>
kala agents                        List known agent keys
kala --version                     Print the version (-v works too)
```

`--assume-limit`, `--strict-state`, and `--force` may appear before or after the command. `--strict-state` makes `kala switch` refuse while the handoff file is too thin to continue. `--force` lets `kala init` replace an existing `.kala/state.yaml`.

### Post-exit behavior

| Evidence | Behavior |
|----------|----------|
| Limit signature in the vendor session store | Limit menu — Enter selects the recommended taker |
| No session store + non-zero exit | Confirm assume-limit (`y` / `N`), or pass `--assume-limit` |
| Clean exit | Stay by default — type a number to hand off |

`q` or `e` returns to the shell without launching another agent.

`--assume-limit` is honored on a TTY by itself. **Off-TTY** (scripts, CI,
piped stdin) it is ignored unless `KALA_ASSUME_LIMIT=1` is also set — so a
flag left in a wrapper script or a copied command cannot silently pre-approve
a limit assumption nobody saw.

## Handoff protocol

`.kala/state.yaml` is the contract between agents. Kalaga instructs every launched agent to keep it current before stopping.

| Field | Purpose |
|-------|---------|
| `goal` | Why the work exists |
| `done` | What already landed (≤12 × 300 chars) |
| `next_step` | One concrete next action |
| `negative_constraints` | Failures not to repeat |
| `notes` | Short situational summary |
| `modified_files` | Git porcelain (maintained by Kalaga) |
| `sessions` | Captured vendor session ids for `kala resume` |

**Cross-agent launches** receive a sanitized protocol inject (goal, done, next, avoid, standing orders). Optional `inject_rich_prompt: true` in `~/.kala/config.yaml` adds notes and modified files (also sanitized).

**Live-ask:** `kala switch` may ask the previous agent for a YAML update when Kalaga still has a fresh session id for that agent (headless, 15 second timeout). The call resumes that session and passes the vendor trust flag when this directory already has a Kalaga grant. A limit exit does not ask the agent that just ran out. If the ask fails, the existing state stays.

**Continuous checkpointing (`kala hooks`):** Run `kala hooks install` in a project to wire opt-in, non-destructive lifecycle hooks for the supported agents found on your `PATH` — Claude Code (`.claude/settings.local.json`) and/or Antigravity (`.agents/hooks.json`) — or pass `--agents claude,agy` explicitly. While you work, Kalaga tracks edits and checkpoint age in `.kala/.hook-state.json` and nudges the active agent to refresh `.kala/state.yaml` when stale (mid-turn and at `Stop`). Use `kala hooks status` to inspect installed hooks and checkpoint age, and `kala hooks uninstall` to remove only Kalaga entries cleanly.

**Same-agent continuity:** `kala resume` reopens a captured session id when the vendor supports it. The conversation already has context, so Kalaga does not inject a handoff prompt. Session ids are discovered from each vendor’s local store when a stable signature exists (Claude jsonl, Cursor chat meta, Grok sqlite, Antigravity `~/.gemini/antigravity-cli`).

**Headroom:** `kala status` labels Claude and Grok `[logged]` (usage recorded in the local store; Claude counts turns from the last 5 hours). Cursor is `[est.]`. agy shows no token spend (no public usage API); its conversation id is still captured for resume and live-ask when present. These are not the vendor’s remaining balance.

Add `.kala/` to `.gitignore`. Never store secrets in handoff state.

## Known vendor seams

Kalaga owns the handoff contract (`.kala/state.yaml`, switch, resume, ranking). Each CLI still owns login, folder trust, and session-store layout. Stores move; Kalaga discovers with a documented signature, validates the artifact, and fails soft with a stderr line when discovery misses.

| Seam | What you see | Kalaga’s stance |
|------|----------------|-----------------|
| **Claude folder trust** | Claude’s own “trust this folder?” (often defaults to No / exit) | Noted on stderr right before Claude launches. Kalaga’s `trust.yaml` does not cover this. |
| **Antigravity (agy) sessions** | Resume / live-ask after `agy` | Ids from `~/.gemini/antigravity-cli/cache/last_conversations.json` when `conversations/<uuid>.db` exists. No token ledger. |
| **Grok live-ask** | Large sessions may exceed the 15s ask | Headless ask uses low reasoning / one turn; on miss: keep existing `state.yaml`. |
| **Cursor headroom** | `[est.]` in `kala status` | Coarse heuristic only; not quota. |
| **Limit detection** | Limit menu after exit | Best-effort phrase match on local session tails. |
| **Vendor login / plan UI** | Sign-in or upgrade banners inside a TUI | Not automated. |

Verified against Antigravity CLI, Cursor Agent, Grok Build, and Claude Code as of 2026-11. Open an issue if a vendor moves its store.

## Configuration

Per-user files live under `~/.kala/` (`config.yaml`, `trust.yaml`). Override with `$KALA_HOME`.

```yaml
# ~/.kala/config.yaml (optional) — no token ceilings to tune
inject_rich_prompt: false
trust_ttl_days: 30
hooks:
  enabled: true
  edit_threshold: 5
  max_age_minutes: 10
  cooldown_minutes: 3
  timeout_seconds: 5
```

Headroom numbers in `kala status` use fixed builtin ceilings. Claude and Grok are labeled `[logged]`; Cursor is `[est.]`; agy tokens stay unset. Limit-detection phrases and binary names live in `src/config.ts`.

## Security

See **[SECURITY.md](SECURITY.md)** for the trust model, guarantees, and residual risks.

Summary: trust flags are never invented; inject fields and resume session ids are constrained; state writes refuse symlinks; there is no network client and no runtime npm dependencies. Agents inherit your environment and may read on-disk `.kala/state.yaml` beyond the sanitized inject—treat that file as untrusted in hostile repos.

**Claude folder trust:** Kalaga’s grant does not cover Claude Code. Before launching Claude, Kalaga prints a reminder on stderr. On a folder Claude has not accepted yet, Claude often defaults to “No, exit”—press Down, then Enter, to trust it. That prompt is Claude’s.

## Testing and CI

```sh
npm test              # unit/component (stdlib only)
npm run test:e2e:auto # S/R + F-15 — CI-safe, no agent TTY
npm run test:e2e      # full real-agent E2E (PTY; needs installed CLIs)
```

GitHub Actions (`.github/workflows/test.yml`) runs `npm test` and `npm run test:e2e:auto` on Node 24 for pushes and pull requests to `main`. Full real-agent proof: [qa-e2e-regression.md](docs/guides/qa-e2e-regression.md).

## Documentation

| Document | Audience |
|----------|----------|
| [guides/what-is-kalaga.md](docs/guides/what-is-kalaga.md) | Multi-subscription users |
| [guides/qa-approach.md](docs/guides/qa-approach.md) | System test procedure (real agents) |
| [guides/qa-e2e-regression.md](docs/guides/qa-e2e-regression.md) | Repeatable E2E regression how-to |
| [SECURITY.md](SECURITY.md) | Trust & threat residuals |
| [papers/kalaga-multi-cli-handoff.md](docs/papers/kalaga-multi-cli-handoff.md) | Design + competitive landscape |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to change the tree safely |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [docs/specs/INDEX.md](docs/specs/INDEX.md) | Design specs |
| [docs/](docs/) | Docs hub (public vs historical) |

Internal build/certify records (optional): [docs/specs/history/](docs/specs/history/).

## Design principles

- **Interactive TTY first** — never pipe the live agent UI for limit detection
- **Human confirms the taker** — no silent auto-handoff of interactive sessions
- **Zero runtime dependencies** — Node standard library only
- **Honest headroom** — label logged vs estimated usage clearly

## Support

Best-effort — there is no SLA.

- Found a bug? Open an issue and let us know.
- Want more features? Feel free to fork and build what you need.
- Contributions back via pull request are appreciated when you can share them.

The intended path is clone → run from source → adapt for your agents. See [CONTRIBUTING.md](CONTRIBUTING.md).

## About the name

**Kalaga** is Telugu for a mix or blending. The project mixes headroom across AI coding CLIs; it does not merge vendors into one product. **kala** is the command-line form of that name.

## License

[MIT](LICENSE) — Copyright © 2026 **Infoverse Data LLC**

Maintained by **Vinay Gundala** · Infoverse Data LLC
