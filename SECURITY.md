# Security & trust model

Kalaga is a local harness that spawns AI coding CLIs you already installed.
There is **no network client, no telemetry, and no runtime npm dependencies**.
What you run is what is in this tree (`bin/kala` → `src/`).

This document is the authoritative trust contract for operators and reviewers.
The project does not claim absolute security. The bar it holds is: **auditable
source, argv-only spawns, no invented trust, sanitized inject, allowlisted
resume ids, and documented residuals.**

## What Kalaga guarantees (in this tree)

| Guarantee | How |
|-----------|-----|
| No shell string exec for agents/git | `spawn` / `execFileSync` with argv arrays only |
| No silent `--trust` | Path grant in `~/.kala/trust.yaml` after explicit `y` |
| No symlink state overwrite | Refuse symlinked `.kala` / `state.yaml`; atomic `0600` write |
| Inject is sanitized | Controls stripped; field/list caps; rich `modified_files` sanitized |
| Resume ids cannot be CLI flags | Allowlist on capture, YAML load, and `kala resume` |
| Limit detection is honest | Empty store ≠ limit; store-less recover needs confirmation |
| Supply chain surface | Zero `dependencies` in `package.json` |

Verify locally: `npm test` (stdlib suite; no network).

## What Kalaga does **not** guarantee

These are accepted residuals — product choices or vendor limits, not forgotten bugs:

1. **Dual channel.** Sanitized **inject** ≠ safe **on-disk** `.kala/state.yaml`. Standing orders tell the next agent to read that file. In an untrusted repo, assume the file can steer the agent beyond the inject.
2. **Child environment.** Interactive and live-ask children inherit full `process.env` (API keys, tokens already in your shell).
3. **PATH at first resolve.** The first successful lookup of `claude` / `agy` / etc. is cached as an absolute path for that process. A hostile `PATH` before first use can bind the wrong binary; Kalaga does not hash-pin binaries.
4. **Vendor stores.** Session tails and sqlite reads are local and bounded; Kalaga does not log stores wholesale. Those directories may still hold secrets belonging to the vendor CLIs.
5. **Windows PATH/`PATHEXT`.** Cross-platform PATH fixes are specified (OPS-003) but not the trust bar for a Linux-first source drop. Do not treat Windows as verified until that ships.
6. **Live-ask.** A headless call to the finishing agent can spend remaining quota and merges only sanitized YAML keys; junk/timeout fails soft.

## Threat notes for people who fork or point agents at this repo

- Prefer reading `src/` and `tests/run.ts` over trusting marketing copy.
- Do not commit `.kala/` (gitignored). Do not put secrets in handoff state.
- If you add agents or change argv construction, keep: no `shell: true`, conditional trust flags only, sanitize anything that becomes prompt text, allowlist anything that becomes a resume id.
- Report issues that expand spawn surface, invent trust, or weaken sanitize/allowlist.

## Reporting

Open a GitHub issue (or contact the maintainer, Vinay Gundala / Infoverse Data
LLC) with a minimal repro. Prefer private disclosure for anything that would
let a hostile repo escalate into unexpected vendor CLI flags or unconditional
trust.
