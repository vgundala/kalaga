# Kalaga — Design specs

Living requirement documents for architecture, security, features, and ops.
These describe **what the product must do**. They are useful for serious
forks and reviewers.

Certification records (pass / waive evidence) live under
[`history/`](history/) — optional audit trail, not user documentation.

| ID | Version | Title | Status |
|----|---------|-------|--------|
| ARCH-001 | [v1](ARCH-001-product-architecture.v1.md) | Product architecture baseline | `locked` |
| SEC-001 | [v1](SEC-001-security-remediation.v1.md) | Security remediation | `done` |
| OPS-001 | [v1](history/OPS-001-share-readiness.v1.md) | Share readiness (early framing) | `superseded` |
| OPS-001 | [v2](OPS-001-share-readiness.v2.md) | Share readiness | `done` |
| OPS-002 | [v1](OPS-002-ci.v1.md) | CI for `npm test` | `done` |
| OPS-003 | [v1](OPS-003-cross-platform.v1.md) | Cross-platform PATH | `done` |
| FEAT-001 | [v1](FEAT-001-post-exit-handoff.v1.md) | Evidence-tiered post-exit handoff | `done` |
| FEAT-002 | [v1](FEAT-002-session-capture-resume.v1.md) | Session capture + `kala resume` | `done` |
| FEAT-003 | [v1](FEAT-003-handoff-state-protocol.v1.md) | Handoff state protocol + live-ask | `done` |
| FEAT-004 | [v1](FEAT-004-continuous-checkpointing.v1.md) | Continuous checkpointing via agent lifecycle hooks | `superseded` |
| FEAT-004 | [v2](FEAT-004-continuous-checkpointing.v2.md) | Continuous checkpointing via agent lifecycle hooks (review fixes) | `done` |
| FEAT-004 | [v3](FEAT-004-continuous-checkpointing.v3.md) | Cursor and Grok hooks + cross-vendor deduplication | `certify` |

Certify evidence: [`history/README.md`](history/README.md).

## Backlog ideas (unspecced)

| Idea | Notes |
|------|-------|
| agy session discovery | Unlocks `kala resume agy` |
| Live-ask prompt polish | Only if live-ask often returns junk |
| CI OS matrix | Extend OPS-002 after Win/macOS smoke |
| npm / Homebrew | Optional distribution |

## Status legend

`draft` · `locked` · `in-build` · `certify` · `done` · `superseded`
