# Kalaga — Spec Index

Process: [`../SPEC_PROCESS.md`](../SPEC_PROCESS.md)

| ID | Version | Title | Status | Certify |
|----|---------|-------|--------|---------|
| ARCH-001 | [v1](ARCH-001-product-architecture.v1.md) | Product architecture baseline | `locked` | — |
| SEC-001 | [v1](SEC-001-security-remediation.v1.md) | Security remediation (trust propagate, state, limits, hygiene) | `done` | [CERT-001](CERT-001-sec001-v1.v1.md) — **pass-with-waivers** |
| OPS-001 | [v1](OPS-001-share-readiness.v1.md) | Share / v0.2 readiness bar | `draft` | — |
| FEAT-001 | [v1](FEAT-001-post-exit-handoff.v1.md) | Post-exit handoff: evidence-tiered exit prompt | `certify` | [CERT-002](CERT-002-feat001-v1.v1.md) (pending TL) |

## Active build queue (priority)

1. ~~SEC-001 v1~~ — **done** (CERT-001)  
2. **FEAT-001 v1** — in build  
3. **OPS-001 v1** — TL may lock next; fold CERT-001 waivers W2–W4 into README/test bar if desired  


ARCH-001 is reference: builders must not violate it unless a later ARCH version supersedes it.

## Status legend

`draft` · `locked` · `in-build` · `certify` · `done` · `superseded`
