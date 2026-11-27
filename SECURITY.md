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
| Inject is sanitized | Controls stripped; field/list caps; rich `modified_files` sanitized; `owner` sanitized + allowlisted to known agent keys |
| Resume ids cannot be CLI flags | Allowlist on capture, YAML load, and `kala resume` |
| Limit detection is honest | Empty store ≠ limit; store-less recover needs confirmation |
| No silent `--assume-limit` off-TTY | Flag alone works on a TTY; scripts/CI need `KALA_ASSUME_LIMIT=1` as well |
| Opt-in, non-destructive hooks | `kala hooks install` / `uninstall` edits only `.claude/settings.local.json` (never `.claude/settings.json`) and `"kalaga-checkpoint"` in `.agents/hooks.json`; aborts on malformed JSON and refuses symlinks |
| Bounded, fail-open hook runner | `kala _hook` caps stdin at 64 KB, enforces a 2s deadline, refuses symlinks on `.hook-state.json` / `hook-errors.log`, logs only sanitized bounded errors (`≤32 KB`, never raw stdin), and always exits `0` with `{}` |
| Supply chain surface | Zero `dependencies` in `package.json` |

Verify locally: `npm test` (stdlib suite; no network).

## What Kalaga does **not** guarantee

These are accepted residuals — product choices or vendor limits, not forgotten bugs:

1. **Dual channel.** Sanitized **inject** ≠ safe **on-disk** `.kala/state.yaml`. Standing orders tell the next agent to read that file. In an untrusted repo, assume the file can steer the agent beyond the inject.
2. **Child environment.** Interactive and live-ask children inherit full `process.env` (API keys, tokens already in your shell).
3. **PATH at first resolve.** The first successful lookup of `claude` / `agy` / etc. is cached as an absolute path for that process. A hostile `PATH` before first use can bind the wrong binary; Kalaga does not hash-pin binaries.
4. **Vendor stores.** Session tails and sqlite reads are local and bounded; Kalaga does not log stores wholesale. Those directories may still hold secrets belonging to the vendor CLIs.
5. **Windows smoke.** PATH and `PATHEXT` resolution is implemented. Full interactive smoke on Windows or macOS may still be skipped on a given release. Check the changelog.
6. **Live-ask.** A headless call to the finishing agent can spend remaining quota and merges only sanitized YAML keys; junk/timeout fails soft.
7. **Vendor folder trust ≠ Kalaga grant.** A Kalaga path grant only gates Kalaga’s own `trustFlags` (e.g. Cursor `--trust`). Claude Code has no such flag; on a directory it has not accepted yet it still shows its own “trust this folder?” prompt. Kalaga prints a one-line caveat before launching Claude so that is expected.
8. **Opt-in project hook configs.** `kala hooks install` is explicit and reversible (`kala hooks uninstall`), writing machine-local `bin/kala` paths into `.claude/settings.local.json` and `.agents/hooks.json` (and warning when `.agents/hooks.json` is not gitignored). It never modifies `.claude/settings.json` or vendor-global configs.

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
