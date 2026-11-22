# Kalaga — Spec Index

Process: [`../SPEC_PROCESS.md`](../SPEC_PROCESS.md)

| ID | Version | Title | Status | Certify |
|----|---------|-------|--------|---------|
| ARCH-001 | [v1](ARCH-001-product-architecture.v1.md) | Product architecture baseline | `locked` | — |
| SEC-001 | [v1](SEC-001-security-remediation.v1.md) | Security remediation | `done` | [CERT-001](CERT-001-sec001-v1.v1.md) (W1–W4 cleared in CERT-003) |
| OPS-001 | [v1](OPS-001-share-readiness.v1.md) | Share readiness (v0.2 framing) | `superseded` | — |
| OPS-001 | [v2](OPS-001-share-readiness.v2.md) | Share readiness: waivers, tests, LICENSE | `done` | [CERT-003](CERT-003-ops001-v2.v1.md) — pass |
| OPS-002 | [v1](OPS-002-ci.v1.md) | CI for `npm test` | `draft` | — |
| FEAT-001 | [v1](FEAT-001-post-exit-handoff.v1.md) | Evidence-tiered post-exit handoff | `done` | [CERT-002](CERT-002-feat001-v1.v1.md) — pass |
| FEAT-002 | [v1](FEAT-002-session-capture-resume.v1.md) | Session capture + `kala resume` | `done` | [CERT-004](CERT-004-feat002-v1.v1.md) — **pass-with-waivers** (R4) |
| FEAT-003 | [v1](FEAT-003-handoff-state-protocol.v1.md) | Handoff state protocol + live-ask seam | `certify` | [CERT-005](CERT-005-feat003-v1.v1.md) (pending TL) |

## Active build queue (priority)

1. ~~FEAT-002 v1~~ — **done** (CERT-004; W1/R4 fixed in the FEAT-003 build — closes with CERT-005 pass)  
2. **FEAT-003 v1** — **`certify`** (built @ 0.5.0; CERT-005 pending TL)  
3. **OPS-002 v1** — `draft` (CI)  

## Unspecced backlog (not yet drafted)

| Idea | Notes |
|------|-------|
| Chained post-exit menus | FEAT-001 deferred |
| Crash-tier menu | FEAT-001 deferred |
| agy on-disk conversation discovery | Richer agy resume |
| Binary hash pinning | SEC deferred |
| npm publish / Homebrew / Windows matrix | OPS deferred |

~~Live-ask~~ → FEAT-003  

ARCH-001 is reference: builders must not violate it unless a later ARCH version supersedes it.

## Status legend

`draft` · `locked` · `in-build` · `certify` · `done` · `superseded`
