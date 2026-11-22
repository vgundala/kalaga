# Kalaga — Spec Index

Process: [`../SPEC_PROCESS.md`](../SPEC_PROCESS.md)

| ID | Version | Title | Status | Certify |
|----|---------|-------|--------|---------|
| ARCH-001 | [v1](ARCH-001-product-architecture.v1.md) | Product architecture baseline | `locked` | — |
| SEC-001 | [v1](SEC-001-security-remediation.v1.md) | Security remediation (trust propagate, state, limits, hygiene) | `certify` | [CERT-001](CERT-001-sec001-v1.v1.md) (pending TL) |
| OPS-001 | [v1](OPS-001-share-readiness.v1.md) | Share / v0.2 readiness bar | `draft` | — |

## Active build queue (priority)

1. **SEC-001 v1** — first build handoff  
2. **OPS-001 v1** — lock after SEC-001 certify; then packaging/docs for others  

ARCH-001 is reference: builders must not violate it unless a later ARCH version supersedes it.

## Status legend

`draft` · `locked` · `in-build` · `certify` · `done` · `superseded`
