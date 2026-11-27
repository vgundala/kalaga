# How Kalaga Helps When You Use More Than One AI Coding CLI

You already write software with AI coding tools in the terminal: Claude Code, Cursor’s agent CLI, Grok, Antigravity (`agy`), and possibly others. Many people keep more than one subscription so work does not stop when a single product hits its usage limit. The difficult part is the switch: you leave one tool, open another, and re-explain the goal, what already shipped, and what to do next.

Kalaga (`kala`) is a small local command that sits in front of those CLIs. The name is Telugu for a mix or blending: it mixes capacity across the tools you already pay for. It watches for a limit, keeps a shared project handoff file up to date, and lets you continue on another installed agent with one keypress.

## Who this is for

- You use AI coding CLIs for real project work
- You have (or want) more than one vendor subscription
- You are tired of losing context every time a session or quota window ends
- You want to stay in control of which tool runs next

Kalaga does not replace your CLIs. It does not create a new cloud account. It runs on your machine and launches the tools you already installed.

## What problem it solves

Without a harness, a typical day looks like this:

1. You work in Claude (or agy, or Cursor) until the tool stops you with a usage or session limit.
2. You open another CLI.
3. You paste a long chat summary, or hope the new agent reconstructs intent from the repo alone.
4. The new agent invents a different plan, redoes finished work, or misses constraints you already learned the hard way.

Kalaga shortens that gap. When an agent exits after a limit, Kalaga detects the limit from that tool’s own local session data (when available), refreshes a handoff file in your project, and shows a short menu of agents that still have headroom. You pick one. The next CLI starts with a pointer to the handoff file and the next step.

## What Kalaga can do for you

| Capability | What you get |
|------------|----------------|
| **One entry point** | `kala` / `kala run <agent>` instead of remembering four launch habits |
| **Limit-aware handoff** | After a quota or session wall, a picker offers another installed CLI |
| **Shared handoff state** | `.kala/state.yaml` in the project: goal, what is done, next step, constraints, notes |
| **Live-ask at the seam** | Before handing off, Kalaga can ask the finishing agent (in a short non-interactive call) to update that file |
| **Resume the same conversation** | `kala resume` reopens a captured session id when the vendor supports it |
| **Trust that propagates** | After you trust a folder once for Kalaga handoffs, later CLIs that support a trust-skip flag can reuse that grant |
| **Honest status** | `kala status` shows local headroom estimates (exact where the vendor exposes usage; estimate otherwise) |

## What it does not do

- It does not pick the “smartest” model for your task. You choose the next agent.
- It does not merge two vendors’ chat histories into one native transcript. Cross-tool continuity is the handoff file plus a short inject prompt; same-tool continuity is resume-by-id.
- It does not bill or manage your subscriptions. Limits stay with each vendor.
- It is not a multi-agent swarm or parallel supervisor. One interactive agent at a time, with you confirming the handoff.

## A simple day with Kalaga

1. In your project: `kala init` (once) so `.kala/state.yaml` exists.
2. Start work: `kala run claude` (or bare `kala` to pick from installed tools).
3. When Claude hits a limit, Kalaga shows a “continue on” list.
4. You press `1` for agy or Cursor. That agent opens with instructions to read `.kala/state.yaml`.
5. If you later want the same Claude thread after the window resets: `kala resume claude` (when a session id was captured).

You can also switch on purpose without waiting for a limit: `kala switch cursor`.

## Getting started

**Prerequisites:** Node.js 22.18+ (LTS 22 / 24 / 26), and at least one of `agy` / `cursor-agent` / `grok` / `claude` on your `PATH`.

```sh
# After cloning this repository
chmod 755 bin/kala
ln -sf "$(pwd)/bin/kala" ~/.local/bin/kala   # Linux / macOS
cd your-project
kala init
kala status
kala run claude
```

On Windows, use `node bin\kala …` or `bin\kala.cmd`. See the main [README](../../README.md) for platform notes.

## Related reading

- Main project README: commands, security, handoff fields
- Security & trust: [`../../SECURITY.md`](../../SECURITY.md)
- Technical paper: [`../papers/kalaga-multi-cli-handoff.md`](../papers/kalaga-multi-cli-handoff.md)
