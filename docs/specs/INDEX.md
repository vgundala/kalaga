# Kalaga — Spec Index

Process: [`../SPEC_PROCESS.md`](../SPEC_PROCESS.md)

| ID | Version | Title | Status | Certify |
|----|---------|-------|--------|---------|
| ARCH-001 | [v1](ARCH-001-product-architecture.v1.md) | Product architecture baseline | `locked` | — |
| SEC-001 | [v1](SEC-001-security-remediation.v1.md) | Security remediation | `done` | [CERT-001](CERT-001-sec001-v1.v1.md) |
| OPS-001 | [v1](OPS-001-share-readiness.v1.md) | Share readiness (v0.2 framing) | `superseded` | — |
| OPS-001 | [v2](OPS-001-share-readiness.v2.md) | Share readiness: waivers, tests, LICENSE | `done` | [CERT-003](CERT-003-ops001-v2.v1.md) |
| OPS-002 | [v1](OPS-002-ci.v1.md) | CI for `npm test` | `done` | [CERT-007](CERT-007-ops002-v1.v1.md) |
| OPS-003 | [v1](OPS-003-cross-platform.v1.md) | Cross-platform PATH + Windows/macOS verify | `done` | [CERT-006](CERT-006-ops003-v1.v1.md) |
| FEAT-001 | [v1](FEAT-001-post-exit-handoff.v1.md) | Evidence-tiered post-exit handoff | `done` | [CERT-002](CERT-002-feat001-v1.v1.md) |
| FEAT-002 | [v1](FEAT-002-session-capture-resume.v1.md) | Session capture + `kala resume` | `done` | [CERT-004](CERT-004-feat002-v1.v1.md) |
| FEAT-003 | [v1](FEAT-003-handoff-state-protocol.v1.md) | Handoff state protocol + live-ask | `done` | [CERT-005](CERT-005-feat003-v1.v1.md) |

## Active build queue

*Empty.* Platform (OPS-003) and CI (OPS-002) certified at 0.6.0. Remaining
items are product backlog, not release blockers for a source-first drop.

## Unspecced backlog (priority guidance)

| Idea | Criticality |
|------|-------------|
| agy session discovery | Medium — unlocks `kala resume agy` |
| Live-ask vendor prompt polish | Low–medium — only if live-ask often returns junk |
| Chained post-exit menus | Low — convenience; spend-spiral risk |
| Crash-tier menu | Low — niche |
| npm publish / Homebrew | Low until you want registry distribution |
| CI OS matrix (Win/macOS) | Low — extend OPS-002 after maintainers smoke those hosts |

ARCH-001 is reference: builders must not violate it unless a later ARCH version supersedes it.

## Status legend

`draft` · `locked` · `in-build` · `certify` · `done` · `superseded`
