# Kalaga — Test Execution Log

| Field | Value |
|-------|-------|
| **Procedure** | [qa-approach.md](qa-approach.md) |
| **Driver** | [qa-e2e-regression.md](qa-e2e-regression.md) |
| **Checklist** | [qa-checklist.md](qa-checklist.md) |
| **Date (UTC)** | 20261124T144919Z |
| **Version** | 0.6.3 |
| **Tester** | `npm run test:e2e` (real agents under PTY) |
| **Verdict** | pass |

## Environment

| Item | Value |
|------|-------|
| OS | Linux 7.1.5-76070105-generic x86_64 |
| Node | v24.22.1 |
| Harness | `scripts/qa-e2e-regression.sh --full` |
| PTY driver | `tests/e2e/pty_drive.py` |
| `$KALA_HOME` | `.e2e-runs/20261124T144919Z/kala-home` |
| Repo under test | `.e2e-runs/20261124T144919Z/repo` |
| Agents on PATH | `agy`, `cursor-agent`, `claude`, `grok` |
| Interactive TTY | No (PTY allocated by driver) |

## Results (mapped to procedure IDs)

| ID | Result | Evidence |
|----|--------|----------|
| S-01 | Pass | init ok; mode=600 |
| S-02 | Pass | seeded goal/next/done/note |
| S-03 | Pass | agents: agy cursor grok claude |
| S-04 | Pass | status shows headroom + handoff |
| S-05 | Pass | why ranked takers |
| S-10 | Pass | help/--help/-h exit 0 |
| S-11 | Pass | run/switch missing args non-zero (1/1) |
| S-12 | Pass | unknown → exit 2 |
| S-13 | Pass | clear error, no hang |
| S-14 | Pass | clear recover message |
| S-15 | Pass | trust list + revoke --all |
| F-01 | Pass | `kala run agy` under PTY; owner=agy |
| F-02 | Pass | clean exit → stay; nothing launched |
| F-03 | Pass | `kala run cursor` under PTY; owner=cursor |
| F-04 | Pass | covered by F-01 (agy) |
| F-10 | Pass | switch agy→claude; owner=claude |
| F-11 | Pass | goal continuity retained |
| F-12 | Pass | owner=claude; goal retained |
| F-13 | Pass | third agent owner=cursor |
| F-14 | Pass | live-ask path observed (merge or soft-fail) |
| F-15 | Pass | `--strict-state` refused; owner unchanged |
| F-20 | Pass | `kala resume cursor`; Kalaga post-exit path observed |
| F-21 | Pass | recover documented message (no external limit in this run) |
| F-30 | Pass | Kalaga cold trust prompt observed |
| F-31 | Pass | grant listed after affirmative |
| R-01 | Pass | npm test — 45 passed |
| R-02 | Pass | non-TTY bare kala did not auto-launch |
| R-03 | Pass | workflow present (`.github/workflows/test.yml`) |
| R-04 | Pass | auto subset executed inside full run |
| R-05 | Pass | full real-agent run; zero Fail |

## Summary

| Pass | Fail | Blocked |
|------|------|---------|
| 30 | 0 | 0 |

## Defects

None opened from this execution.

## Sign-off

| Role | Name | Date | Verdict |
|------|------|------|---------|
| Tester | E2E harness | 2026-11-24 | pass |
| Approver | | | |

Artifacts: `.e2e-runs/20261124T144919Z/` (`results.md`, `logs/`, `repo/`, `kala-home/`).
