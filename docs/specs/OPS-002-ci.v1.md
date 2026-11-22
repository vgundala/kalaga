# OPS-002 — CI for `npm test`

| Field | Value |
|-------|-------|
| **ID** | OPS-002 |
| **Version** | v1 |
| **Status** | `draft` |
| **Date** | 2026-11-22 |
| **Supersedes** | — |
| **Owner** | Technical lead |
| **Depends on** | OPS-001 v2 (done) |
| **Build priority** | 2 (after FEAT-002) |

---

## 1. Intent

Run the existing zero-dep suite (`npm test` → `node tests/run.ts`) on every
push/PR so shareable trees stay green without relying on a local re-run.

---

## 2. In / out of scope

**In:** One CI workflow (GitHub Actions **or** the host’s actual forge — match
wherever the repo lives), Node ≥ 24, `npm test` only.

**Out:** Matrix of every OS, live vendor CLI tests, publishing, coverage gates,
dependency audit bots.

---

## 3. Approach

Single job, ubuntu-latest (or equivalent), checkout → setup-node 24 → `npm test`.
No `npm install` if there are still zero dependencies; if that changes, pin
lockfile first under a separate OPS.

---

## 4. Requirements (draft — not locked)

| ID | Requirement |
|----|-------------|
| C1 | Workflow file in-repo; triggers on push to default branch + PRs. |
| C2 | Uses Node 24 (or `engines` from package.json). |
| C3 | Runs `npm test`; fails the job on non-zero. |
| C4 | No secrets required. |
| C5 | README badge optional. |

---

## 5. Deferred

Windows/macOS matrix; caching; required status checks policy (repo admin).

---

## 6. Note

**Do not lock or build** until FEAT-002 is `done` (or PO reprioritizes). This
draft exists so CI stays visible on the backlog without blocking resume work.
