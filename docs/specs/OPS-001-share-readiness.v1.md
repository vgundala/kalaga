# OPS-001 — Share / v0.2 Readiness

| Field | Value |
|-------|-------|
| **ID** | OPS-001 |
| **Version** | v1 |
| **Status** | `draft` |
| **Date** | 2026-11-21 |
| **Supersedes** | — |
| **Owner** | Technical lead |
| **Depends on** | ARCH-001 v1; SEC-001 v1 `done` (satisfied — CERT-001) |
| **Build priority** | 2 (after SEC-001 certify) |

---

## 1. Intent

Define the bar for giving Kalaga to others as a **v0.2 local tool** (friends / early adopters who already use these CLIs) — not a general consumer product.

After OPS-001: a new user can install from the repo, understand trust and residual risk, and run the core loop without reading the source.

---

## 2. In / out of scope

**In:** LICENSE, README install/threat model, `.gitignore` guidance, minimal test runner for pure functions from SEC-001, version string, changelog stub.

**Out:** Homebrew/npm publish automation, telemetry, GUI, multi-user installers, support SLA.

---

## 3. Approach

Ship as a **git clone + symlink** tool with an honest README. Add only enough tests to lock SEC-001 pure helpers. Do not add a bundler.

Lock this spec only after SEC-001 certify passes.

---

## 4. Requirements (draft — not locked for build)

| ID | Requirement |
|----|-------------|
| O1 | `LICENSE` file (recommend MIT unless product owner chooses otherwise). |
| O2 | README: install, Node ≥ 24, trust model summary, residual risks, `.kala/` gitignore snippet. |
| O3 | `package.json` `version` ≥ `0.2.0` when this ships; `engines.node` unchanged. |
| O4 | Automated tests for SEC-001 pure helpers (sanitize, trust TTL, symlink refuse) runnable via a documented command — stdlib or one **devDependency** test runner only if product owner approves (requires ARCH note or OPS lock that allows it). |
| O5 | `CHANGELOG.md` with 0.2.0 entry citing SEC-001. |
| O6 | INDEX + CERT show SEC-001 `done` before calling the release shareable. |

**Acceptance:** Stranger clone → follow README → `kala status` works; trust section present; tests green.

---

## 5. Deferred

- npm registry publish  
- Signed releases  
- Windows support matrix  

---

