# Kalaga — Test Execution Checklist

| Field | Value |
|-------|-------|
| **Procedure** | [qa-approach.md](qa-approach.md) |
| **Driver** | [qa-e2e-regression.md](qa-e2e-regression.md) (`npm run test:e2e`) |
| **Results log** | [qa-results.md](qa-results.md) |
| **Version under test** | 0.6.3 |
| **Date** | 2026-11-24 |
| **Tester** | `npm run test:e2e` (PTY driver + real agents) |

Mark each ID: **P** (pass) / **F** (fail) / **B** (blocked). Failures require evidence in the results log.

## Setup and observability

| ID | P/F/B |
|----|-------|
| S-01 `kala init` | P |
| S-02 Seed state | P |
| S-03 `kala agents` | P |
| S-04 `kala status` | P |
| S-05 `kala why` | P |

## Command surface

| ID | P/F/B |
|----|-------|
| S-10 Help | P |
| S-11 `run`/`switch` missing args | P |
| S-12 Unknown command | P |
| S-13 `resume` no session | P |
| S-14 `recover` nothing to recover | P |
| S-15 `trust` | P |

## Single-agent interactive

| ID | P/F/B |
|----|-------|
| F-01 `kala run` primary agent | P |
| F-02 Clean exit → stay | P |
| F-03 Cursor via Kalaga | P |
| F-04 Antigravity via Kalaga | P |

## Cross-agent chain

| ID | P/F/B |
|----|-------|
| F-10 Limit or switch to agent B | P |
| F-11 Continuity on B | P |
| F-12 State/`owner` after handoff | P |
| F-13 Agent C (if installed) | P |
| F-14 Live-ask soft-fail or merge | P |
| F-15 `--strict-state` refuse | P |

## Resume / recover / trust

| ID | P/F/B |
|----|-------|
| F-20 `kala resume` | P |
| F-21 `kala recover` | P |
| F-30 Cold trust | P |
| F-31 Grant listed / reused | P |

## Regression

| ID | P/F/B |
|----|-------|
| R-01 `npm test` | P |
| R-02 Non-TTY no auto-launch | P |
| R-03 CI green | P |
| R-04 `test:e2e:auto` | P |
| R-05 `test:e2e` full | P |

## Sign-off

| Verdict | Approver | Date |
|---------|----------|------|
| pass | E2E harness (`20261124T144919Z`) | 2026-11-24 |
