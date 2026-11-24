# Kalaga

**Local handoff across AI coding CLIs.** Use all your subscriptions efficiently.

Kalaga (`kala`) sits in front of the agent tools you already use—Antigravity (`agy`), Cursor Agent, Grok, and Claude Code. When one hits a usage or session limit, it refreshes a shared project handoff file and lets you continue on another installed agent with a single keypress.

*Kalaga* (Telugu): a mix / blending — capacity across CLIs without replacing them. The shell command is `kala`.

No cloud account. No runtime dependencies. No build step. Clone the source, put `kala` on your `PATH`, and run.

### Why this exists

I already held the AI subscriptions — some strong, some still improving — and kept looking for a way to combine them so tokens did not sit idle when one product hit a wall. Now that coding models and CLI agents are largely on par with each other, the missing piece was continuity across tools. Unpredictable Google AI Pro / Antigravity limits made that gap impossible to ignore. Kalaga is the handoff layer that grew out of that: finish the work on the next agent without re-explaining the job.

| | |
|---|---|
| **License** | MIT |
| **Runtime** | Node.js ≥ 24 |
| **Agents** | Antigravity (`agy`) · Cursor (`cursor-agent`) · Grok · Claude Code |
| **Install** | Source symlink / `node bin/kala` (no published binary required) |

## Why it exists

Many developers keep more than one AI coding subscription so work does not stop when a single product’s quota window ends. Switching tools by hand usually means re-explaining the goal, what already shipped, and what to avoid. Kalaga keeps that contract in the repo (`.kala/state.yaml`), detects limits from each vendor’s local session store (without piping the interactive TUI), and asks you which agent should take over.

## Requirements

- [Node.js](https://nodejs.org/) **24 or newer** (native TypeScript execution; no compile step)
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
kala init                          Create .kala/state.yaml from git facts
kala status                        Headroom estimates + handoff summary
kala run <agent>                   Interactive session; post-exit handoff tiers
kala recover                       Trap after a limit when the agent was launched outside kala
kala switch <agent>                Hand off now
kala resume [agent]                Reopen a captured session by id (default: owner)
kala why [deadAgent]               Dry-run taker ranking
kala state goal|next|note|neg|done <text>
kala trust                         List trust grants
kala trust revoke <path|--all>
kala agents                        List known agent keys
```

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

**Live-ask:** on limit handoff or `kala switch`, Kalaga may ask the finishing agent once (headless, 45s timeout) for a YAML state update. Failures are soft; existing state is kept.

**Same-agent continuity:** `kala resume` reopens a captured session id when the vendor supports it (no inject—the conversation already has context).

Add `.kala/` to `.gitignore`. Never store secrets in handoff state.

## Configuration

Per-user files live under `~/.kala/` (`config.yaml`, `trust.yaml`). Override with `$KALA_HOME`.

```yaml
# ~/.kala/config.yaml (optional)
ceilings:
  agy: 1000000
  cursor: 250000
  grok: 250000
  claude: 250000
inject_rich_prompt: false
trust_ttl_days: 30
```

Limit-detection signatures and binary names are defined in `src/config.ts`.

## Security

See **[SECURITY.md](SECURITY.md)** for the trust model, guarantees, and residual risks.

Summary: trust flags are never invented; inject fields and resume session ids are constrained; state writes refuse symlinks; there is no network client and no runtime npm dependencies. Agents inherit your environment and may read on-disk `.kala/state.yaml` beyond the sanitized inject—treat that file as untrusted in hostile repos.

## Testing and CI

```sh
npm test          # node tests/run.ts — stdlib only, no install, no network
```

GitHub Actions (`.github/workflows/test.yml`) runs the same suite on Node 24 for pushes and pull requests to `main`.

## Documentation

| Document | Audience |
|----------|----------|
| [guides/what-is-kalaga.md](docs/guides/what-is-kalaga.md) | Multi-subscription users |
| [SECURITY.md](SECURITY.md) | Trust & threat residuals |
| [papers/kalaga-multi-cli-handoff.md](docs/papers/kalaga-multi-cli-handoff.md) | Design + competitive landscape |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to change the tree safely |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [docs/specs/INDEX.md](docs/specs/INDEX.md) | Design specs (ARCH / SEC / FEAT / OPS) |
| [docs/](docs/) | Docs hub (public vs historical) |

Internal build/certify records (optional): [docs/specs/history/](docs/specs/history/).

## Design principles

- **Interactive TTY first** — never pipe the live agent UI for limit detection
- **Human confirms the taker** — no silent auto-handoff of interactive sessions
- **Zero runtime dependencies** — Node standard library only
- **Honest headroom** — label exact vs estimated usage clearly

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
