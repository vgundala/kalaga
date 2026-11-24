# Kalaga: Interactive Handoff Across Multi-Subscription AI Coding CLIs

**Working paper** · November 2026  
**Status:** Draft for publication / preprint  
**Author:** Vinay Gundala (Infoverse Data LLC)  
**Software:** Kalaga (`kala`) — local zero-dependency harness for interactive coding agents  
**Name:** *Kalaga* (Telugu): a mix / blending; `kala` is the CLI form  
**Copyright:** © 2026 Infoverse Data LLC · MIT License

---

## Abstract

Developers increasingly hold concurrent subscriptions to several AI coding command-line interfaces (CLIs)—Claude Code, Cursor Agent, Grok, Antigravity (`agy`), and others. When one vendor’s usage window ends mid-task, switching tools usually forces a manual re-briefing: paste a chat summary, hope the repository alone carries intent, or restart the plan. **Kalaga**—named from Telugu for a mix or blending—is a local, dependency-free Node.js harness that preserves *interactive* TTY sessions, detects usage limits from each vendor’s on-disk session store (without piping the agent UI), maintains a repo-local handoff contract (`.kala/state.yaml`), and offers a one-keypress picker for the next installed agent. Same-vendor continuity uses captured session identifiers and native resume where available; cross-vendor continuity uses a sanitized protocol inject plus an optional headless “live-ask” update from the finishing agent. This paper states the design constraints, architecture, security posture, and a competitive landscape of related handoff, resume, account-switch, and orchestration tools as of late 2026.

---

## 1. Introduction

AI coding CLIs are now primary development surfaces. Each product ships its own authentication, permission model, session store, and quota policy. Users who keep more than one subscription treat vendors as *capacity pools*: when Claude’s five-hour window is exhausted, Cursor or Antigravity may still have headroom. The engineering problem is not “call another API”; it is **preserving interactive flow and task intent across heterogeneous local agents** without breaking each tool’s TUI, trust prompts, or login.

Three continuity strategies appear in practice:

1. **Native resume** — reopen the same vendor session by id (full context, same product only).
2. **Human-authored handoff notes** — portable, low context cost, high authoring cost and drift risk.
3. **Automated cross-agent transfer** — transcript extraction, structured briefs, or orchestrated fallback.

Kalaga targets a fourth, deliberately narrow niche: **interactive, human-confirmed, limit-triggered handoff** with a **shared structured state file** as the cross-agent contract, store-based limit detection that leaves TUIs intact, and **same-tool resume** when the window resets. It does not aim to be a multi-agent supervisor, an account vault, or a universal transcript translator.

---

## 2. Problem statement

### 2.1 Failure modes after a quota wall

| Failure | Effect |
|---------|--------|
| Context loss | Next agent re-derives the plan, reopens closed questions, or rewrites finished work. |
| Constraint amnesia | Negative lessons (failed approaches) are not carried forward. |
| Trust friction | Each CLI re-prompts for directory trust; handoffs feel hostile. |
| False limit detection | Piping stdout / PTY capture breaks TUIs; empty logs look like “limits.” |
| Silent auto-switch | Work continues under a different product without the user’s assent. |

### 2.2 Design requirements

From the product architecture baseline (ARCH-001):

- **R1** Interactive launch with `stdio: 'inherit'` (no PTY/stdout trap of the live session).
- **R2** Limit evidence from vendor session stores after exit; honest classification of clean exits.
- **R3** Repo-local handoff state as the cross-agent source of truth.
- **R4** Human confirmation of every taker (picker); no silent auto-handoff.
- **R5** Zero runtime npm dependencies; Node ≥ 24 type-stripping.
- **R6** Trust flags passed only after an explicit path grant recorded by Kalaga.

---

## 3. System design

### 3.1 Control flow

```
User → kala → spawn(agent, TTY inherit)
                 ↓ exit
              scan vendor session store (trap)
                 ↓ limit hit?
              refresh .kala/state.yaml ← git facts (+ optional live-ask)
              rank takers (owner / freshness / LRU)
              picker (user confirms)
                 ↓
              spawn(next agent, sanitized protocol inject + trust if granted)
```

On clean exit, Kalaga offers hand off or stay (default: stay). On ambiguous evidence (no store), it asks or requires `--assume-limit`. `kala recover` applies the same trap to agents launched outside Kalaga.

### 3.2 Handoff protocol (`.kala/state.yaml`)

| Field | Role |
|-------|------|
| `goal` | Why the work exists |
| `done` | Bounded bullets of completed work |
| `next_step` | One concrete next action |
| `negative_constraints` | Failures not to repeat |
| `notes` | Short situational summary |
| `modified_files` | Git porcelain (maintained by Kalaga) |
| `sessions` | Captured vendor session ids for `kala resume` |

**Protocol inject.** Cross-agent launches receive a pointer to the state file plus sanitized Goal / Done / Next / Avoid (and optional notes + files). Fields are length-capped and control-stripped before injection; the file is treated as an **untrusted instruction surface**.

**Live-ask.** At limit handoff (and explicit switch), Kalaga may issue one headless print-mode question to the finishing agent requesting a YAML block for those keys. Timeout and empty answers fail soft; existing state is kept. This spends a small amount of remaining quota by design.

**Thin-state warning.** Cross-agent launch warns (or aborts under `--strict-state`) when goal/done/next look empty.

### 3.3 Session capture and resume (same vendor)

Kalaga records session identifiers from vendor artifacts (e.g. Claude jsonl naming, Grok `session_id`, Cursor chat directories) into `sessions`. After a limit, the “wait for reset” path points the user to `kala resume <agent>`, which reopens the **native** conversation when the vendor supports it. Cross-agent continuity remains the protocol file, not a merged transcript.

### 3.4 Limit trap and ledger

- **Trap:** post-exit tail scan for per-agent limit signatures in vendor stores—not live UI scrape.
- **Ledger:** headroom labeled `exact` where the vendor exposes usable counts (Claude, Grok paths), otherwise estimate; Antigravity may be unknown. Server-side quotas remain authoritative.

### 3.5 Trust propagation

Cold launch of a trust-capable agent prompts once: trust this directory for Kalaga handoffs? Affirmative answers write a realpath grant under `~/.kala/trust.yaml` (TTL configurable). Later handoffs pass vendor trust-skip flags only when a valid grant exists. No grant invents trust.

### 3.6 Security invariants (summary)

- Argv-array spawns only; no `shell: true` for agents/git.
- Atomic state writes (`0600`); refuse symlink `.kala` / `state.yaml`.
- Sanitize all injected fields; gitignore `.kala/`; no secrets in state.
- Resolved absolute binaries at launch; bounded store reads.

---

## 4. Related work and competitive analysis

A crowded late-2026 category addresses multi-CLI continuity. Tools differ on **what travels** (transcript vs structured brief vs account identity), **when switching happens** (user command vs quota trigger vs task routing), and **how interactive** the primary session remains.

### 4.1 Landscape map

| Tool | Primary job | Continuity mechanism | Limit / failover | Interactive TTY first? | Human confirms taker? |
|------|-------------|----------------------|------------------|------------------------|------------------------|
| **Kalaga** | Interactive multi-subscription handoff | `.kala/state.yaml` + protocol inject + live-ask; native resume by id | Post-exit store signatures → picker | Yes | Yes (required) |
| **catchup** | Session handoff / fork | Markdown transcript from local session logs; same-agent native fork where supported | User-driven `fork --into` | Launch target, not a limit harness | User chooses target |
| **wormhole** | Round-trip session move | Writes **native** sessions for Claude / Codex / OpenCode; appends foreign turns | User `switch` / experimental multi-login | Native resume | User chooses |
| **CLI Continues** | Any-to-any resume plugin | Parses 16 tools’ stores → structured context doc inject | User `continues resume … --in` | Destination launch | User chooses |
| **AgentDrive** | Capture + resume brief | Background sync of redacted transcript → compact brief | Claude→Gemini (Antigravity-era) resume commands | Per-tool plugins | User initiates resume |
| **cli-relay** | Task runner + auto fallback | Completion briefing + git check reminder | Stream events / rate_limit → next provider | Print/stream oriented | Automatic chain |
| **Relay** | Quota-aware orchestrator | HMAC-signed continuation contracts | Predictive handoff before exhaustion | Orchestrated | Policy-driven |
| **AgentBridge** | Uniform CLI / MCP / proxy API | Normalized events; `--fallback` chain | Rate-limit / quota → next | Library & non-interactive friendly | Configurable |
| **Climux** | Multiplexer + MCP | Sessions, routing patterns, worktrees | `fallbackOrder` on failure / rate limit | Task modes + sessions | Often automatic |
| **CAO** (AWS Labs) | Supervisor + workers | tmux sessions, local server, specialist agents | Orchestration, not quota-first | Parallel CLI workers | Supervisor tools |
| **Keyhop** | Account switching | OS keychain login swap per tool | Watches limits; switches **accounts** | Underlying tool unchanged | User / watched switch |

Sources: project READMEs and product pages for [catchup](https://github.com/wilbeibi/catchup), [wormhole](https://github.com/wormhole-cli/wormhole), [CLI Continues](https://plugandship.dev/p/cli-continues), [AgentDrive](https://agentdrive.sh/resume/claude-code-to-gemini-cli), [cli-relay](https://pypi.org/project/cli-relay/), [Relay](https://dbisina.github.io/relay/), [AgentBridge](https://github.com/rodolfonobrega/agentbridge), [Climux](https://github.com/veithly/climux), [CAO](https://github.com/awslabs/cli-agent-orchestrator/), [Keyhop](https://keyhop.app/). Feature claims reflect published docs as of November 2026 and may change.

### 4.2 Positioning

**Closest peers (continuity).** catchup, wormhole, CLI Continues, and AgentDrive all move *conversation-shaped* context between tools. wormhole goes furthest toward **native session fidelity** for a small set of CLIs. catchup and Continues emphasize **breadth** of parsers. Kalaga instead bets on a **short structured contract** plus optional live-ask, accepting less transcript fidelity in exchange for lower inject cost, explicit field caps, and a security model that treats handoff state as hostile input.

**Closest peers (quota failover).** cli-relay, Relay, AgentBridge, and Climux automate provider chains. Kalaga refuses silent auto-launch of the next interactive agent: the picker is an invariant. That is a product choice for users who want capacity pooling without ceding control of which subscription spends next.

**Orthogonal.** Keyhop solves **which login** is active for a given tool, not which tool continues the task. CAO solves **multi-agent supervision** (parallel specialists). Kalaga does neither.

### 4.3 Comparison dimensions (normative)

| Dimension | Kalaga stance | Tradeoff |
|-----------|---------------|----------|
| Transcript completeness | Prefer structured fields + caps | Less “what was said”; more “what to do next” |
| Auto-failover | No silent interactive switch | Extra keypress; safer for paid quotas |
| Limit detection | Store signatures after exit | Depends on vendor log layout; agy may need assume-limit |
| Dependency surface | Zero npm deps | Less parsing power than multi-format transcript tools |
| Agent coverage | agy / cursor / grok / claude | Narrower than Continues / catchup / AgentBridge |
| Trust | Explicit path grant propagation | One prompt; no invented `--trust` |

---

## 5. Threat model (abridged)

| Asset | Threat | Mitigation |
|-------|--------|------------|
| Prompt / agent instructions | Malicious or compromised `.kala/state.yaml` | Sanitize + length caps; thin inject; refuse symlink writes |
| Directory trust | Cold clone auto-trusted | Grant file; prompt; TTL; revoke commands |
| Secrets in vendor stores | Over-logging / wholesale dump | Read-only bounded tails; no wholesale log of stores |
| Process spawn | Shell injection | Argv arrays only |
| User intent | Auto-spend another subscription | Mandatory picker |

Residual risks include PATH resolution at first binary lookup, incomplete vendor `cwd` metadata for colliding Claude project dirs, and incomplete limit signatures when vendors change log phrasing.

---

## 6. Limitations and future work

1. **Cross-agent memory is not a merged transcript.** Agents that need full dialogue history should prefer same-tool `resume` or a transcript-oriented tool.
2. **Vendor layout fragility.** Trap patterns and session capture break when CLIs change on-disk formats; maintenance is ongoing.
3. **Headroom honesty.** Cursor/agy estimates and unknown windows must be labeled as such; server quotas win.
4. **Platform completeness.** Windows PATH / PATHEXT and CI packaging are operational tracks, not core algorithm.
5. **Out of scope by design:** model-quality routing, cloud sync, daemon mode, npm dependency growth without a new architecture decision.

---

## 7. Conclusion

Multi-subscription AI coding is now common; continuity across CLIs is still fragmented. Kalaga contributes a **minimal interactive harness**: store-based limit detection that preserves TUIs, a **repo-local handoff protocol** with sanitization and optional live-ask, **human-confirmed** taker selection, trust propagation without invented trust, and **native resume** when returning to the same vendor. Adjacent tools excel at transcript fidelity, predictive orchestration, account switching, or multi-agent supervision. Kalaga’s claim is narrower: keep the human in the loop at the subscription seam, and make the next interactive agent start from a bounded, auditable contract rather than a blank chat.

---

## Appendix A — Commands (operator surface)

| Command | Purpose |
|---------|---------|
| `kala init` | Create `.kala/state.yaml` from git facts |
| `kala status` | Headroom + handoff summary |
| `kala run <agent>` | Interactive session; post-exit tiers |
| `kala recover` | Trap after non-kalaga launch |
| `kala switch <agent>` | Immediate handoff |
| `kala resume [agent]` | Native session reopen |
| `kala why` | Dry-run taker ranking |
| `kala state …` | Manual field edits |
| `kala trust …` | List / revoke grants |

## Appendix B — Companion documents

- User-facing explainer: [`../guides/what-is-kalaga.md`](../guides/what-is-kalaga.md)
- Product architecture: [`../specs/ARCH-001-product-architecture.v1.md`](../specs/ARCH-001-product-architecture.v1.md)
- Security remediation: [`../specs/SEC-001-security-remediation.v1.md`](../specs/SEC-001-security-remediation.v1.md)
- Project README: [`../../README.md`](../../README.md)

## Appendix C — Suggested venue keywords

AI software engineering; coding agents; CLI tooling; usage quotas; session continuity; human-in-the-loop; prompt injection surfaces; local-first tooling.
