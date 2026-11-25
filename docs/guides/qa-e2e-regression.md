# How To Run Kalaga Real-Agent E2E Regression

This guide is the **repeatable** system regression for Kalaga. It proves each
procedure ID in [qa-approach.md](qa-approach.md) against **installed vendor
CLIs** (not mocks), with fixed seeds and hard assertions on Kalaga-side
outcomes.

## What “repeatable” means here

| Stable (asserted) | Not asserted |
|-------------------|--------------|
| Exit codes, menus, refuse/stay paths | Vendor model prose |
| `.kala/state.yaml` fields (`goal`, `owner`, `done`, `next_step`) | Bit-identical TTY transcripts |
| stderr contracts (`refusing to switch`, `no captured session`, …) | Exact headroom numbers |
| Non-TTY: no auto-launch | Vendor trust chrome copy |

Same seed strings, same step order, same pass/fail rules every run.

## Prerequisites

- Node.js ≥ 24
- This repository checked out
- For **full** mode: at least two of `agy`, `cursor-agent`, `claude` on `PATH` and authenticated
- A machine that can allocate a PTY (normal terminal, or the harness’s PTY driver)

## Modes

| Mode | Command | Covers |
|------|---------|--------|
| Auto | `npm run test:e2e:auto` | S-01–S-15, R-01–R-03, F-15 (strict-state refuse). F-chain marked Blocked. |
| Full | `npm run test:e2e` | Auto **plus** PTY-driven `kala run` / `kala switch` / resume / trust against real agents |

Release acceptance: **full** mode with zero Fail (Blocked only with disposition).

## Steps

1. From the repository root, run auto mode first (always safe in CI):

   ```bash
   npm run test:e2e:auto
   ```

2. On a workstation with agents installed, run full mode:

   ```bash
   npm run test:e2e
   ```

3. Open the printed `results.md` under the run root (default `.e2e-runs/<UTC>/` in this repository).

4. Copy into the project log when the run is authoritative:

   ```bash
   KALA_E2E_UPDATE_DOCS=1 npm run test:e2e
   ```

   That overwrites [qa-results.md](qa-results.md).

5. Mark [qa-checklist.md](qa-checklist.md) from the results table (P / F / B).

## Expected results

- **Auto:** all S-* and R-* Pass; F-15 Pass; remaining F-* Blocked with reason `auto-only`.
- **Full:** each available agent path Pass; chain F-10–F-14 Pass when ≥2 agents exist; F-13 Blocked if fewer than three CLIs; F-20 Blocked if no session id was captured.

Artifacts per run:

| Path | Contents |
|------|----------|
| `results.md` | ID → Pass/Fail/Blocked + evidence |
| `logs/` | stderr captures + PTY transcripts |
| `repo/` | throwaway git project under test |
| `kala-home/` | isolated `KALA_HOME` (trust grants, etc.) |

## Troubleshooting

| Symptom | What to do |
|---------|------------|
| F-01 Fail, transcript stuck on “trust this folder” | Prefer `agy` first (trust defaults to Yes). Claude’s chooser often ignores raw PTY arrows — run that agent on a real terminal if needed |
| F-03 sticky /exit | Cursor confirms slash commands with a second Enter; driver sends `/exit` + Enter. Check `logs/F-03.pty.log` |
| F-10 Fail, owner unchanged | Check `logs/F-10.*` — a switch live-ask waits up to 15s, and only when a fresh session id exists |
| R-01 Fail | Fix unit failures first (`npm test`); E2E does not replace them |
| Want a fixed scratch dir | `KALA_E2E_ROOT=/tmp/kala-e2e-stable npm run test:e2e` |

## Related

- Procedure (test IDs): [qa-approach.md](qa-approach.md)
- Execution checklist: [qa-checklist.md](qa-checklist.md)
- Latest log: [qa-results.md](qa-results.md)
- Driver: `scripts/qa-e2e-regression.sh`
- PTY helper: `tests/e2e/pty_drive.py`
