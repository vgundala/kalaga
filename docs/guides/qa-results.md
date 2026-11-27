# Kalaga E2E Regression Results

| Field | Value |
|-------|-------|
| **Date (UTC)** | 20261127T065954Z |
| **Version** | 0.8.0 |
| **Mode** | full |
| **Run root** | `/tmp/kala-v080-e2e` |
| **KALA_HOME** | `/tmp/kala-v080-e2e/kala-home` |
| **Node** | v24.14.0 |
| **OS** | Linux 7.2.15-76070215-generic x86_64 |
| **Agents on PATH** | claude cursor agy grok (count=4) |
| **stdin TTY** | yes |

## Results

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
| R-01 | Pass | npm test ok (97 passed) |
| R-02 | Pass | non-TTY bare kala did not auto-launch |
| R-03 | Pass | workflow present (.github/workflows/test.yml); green checked on push |
| F-15 | Pass | strict-state refused; owner='' |
| H-01 | Pass | hooks install/status/uninstall ok |
| H-02 | Pass | claude _hook PostToolUse + Stop + stop_hook_active guard ok |
| H-03 | Pass | agy _hook PostToolUse + PreInvocation + Stop + guards ok |
| H-04 | Pass | cursor _hook PostToolUse + Stop + loop/overlap guards ok |
| H-05 | Pass | grok _hook PostToolUse + Stop + shutdown/overlap guards ok |
| F-01 | Pass | kala run agy under PTY; owner=agy |
| F-02 | Pass | returned to shell after stay (driver Enter); no second launch |
| F-03 | Pass | kala run cursor under PTY (ec=0 owner=cursor) |
| F-30 | Pass | Kalaga cold trust prompt observed |
| F-31 | Pass | grant listed after affirmative |
| F-04 | Pass | covered by F-01 (agy) |
| F-10 | Pass | owner advanced to claude (pty exit 2) |
| F-11 | Pass | goal continuity retained |
| F-12 | Pass | owner=claude goal retained |
| F-14 | Pass | switch seam completed (live-ask fail-soft by contract) |
| F-13 | Pass | third agent owner=cursor |
| F-20 | Pass | kala resume cursor (ec=0; Kalaga post-exit path observed) |
| F-21 | Pass | recover responded with documented message (no external limit in this run) |
| R-04 | Pass | auto subset executed inside full run |
| R-05 | Pass | full real-agent run zero Fail (Blocked=0) |

## Summary

| Pass | Fail | Blocked |
|------|------|---------|
| 35 | 0 | 0 |

**Verdict:** pass

Artifacts under `/tmp/kala-v080-e2e` (logs/, results.md, repo/, kala-home/).
