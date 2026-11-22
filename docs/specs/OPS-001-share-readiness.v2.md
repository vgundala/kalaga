# OPS-001 — Share Readiness

| Field | Value |
|-------|-------|
| **ID** | OPS-001 |
| **Version** | v2 |
| **Status** | `locked` |
| **Date** | 2026-11-22 |
| **Supersedes** | OPS-001 v1 (draft, framed as "v0.2 share bar") |
| **Owner** | Technical lead |
| **Depends on** | ARCH-001 v1; SEC-001 v1 `done` (CERT-001, pass-with-waivers) |
| **Build priority** | 1 (current handoff) |

---

## 1. Intent

Make Kalaga shareable as a **v0.3.1 local tool** (friends / early adopters who
already use these CLIs) — not a general consumer product.

v1 of this spec is stale: the package is at **0.3.0**, FEAT-001 is in `certify`,
and CERT-001 carries **four open waivers (W1–W4)** that nothing has cleared.
This version refreshes the bar and folds the waivers into buildable
requirements so "shareable" also means "no known-open audit findings".

After OPS-001 v2: a new user can clone, follow the README, run the core loop,
trust the security notes, and re-run the test suite with one command.

---

## 2. In / out of scope

**In:** LICENSE, CHANGELOG, README completeness (incl. `$KALA_HOME`), durable
stdlib-only test suite on `npm test`, closure of CERT-001 waivers W1–W4,
version bump to 0.3.1, INDEX consistency.

**Out:** npm registry publish, homebrew, signed releases, Windows matrix,
telemetry, GUI, devDependency test frameworks (zero-dep bar per ARCH A6),
re-certification of FEAT-001 (that is TL's pending sign-off, tracked separately).

---

## 3. Approach

Ship as **git clone + symlink** with an honest README and a zero-dependency
test entry point (`node tests/run.ts`, exposed as `npm test`). Waiver closures
are surgical one-spot fixes; no refactors.

| Topic | Choice | Rejected |
|-------|--------|----------|
| Test runner | stdlib `assert` + tiny `tests/run.ts` harness | vitest/mocha (new dep, A6) |
| W1 expired grants | prune at write path; `trust status` still shows expired (marked) | prune at read (status would lose them) |
| W2 hint timing | move `nextStepHint` above `pick()` in `offerHandoff` | restructure offerHandoff |
| W3 cursor walk | share one scan cap constant between ledger + trap | per-site magic numbers |
| Waiver closure vehicle | this OPS spec (not SEC-001 v2) | reopening a `done` spec |

---

## 4. Requirements

| ID | Requirement |
|----|-------------|
| O1 | `LICENSE` file — MIT, holder "Kalaga contributors". |
| O2 | README completeness: install, Node ≥ 24, trust model, residual risks, `.kala/` gitignore, tiered post-exit loop (already present — verify), and **`$KALA_HOME` documented** (clears W4). |
| O3 | `package.json` version `0.3.1`; `engines.node` `>=24` unchanged; **no `dependencies` added**. |
| O4 | `CHANGELOG.md` with entries for 0.1.0, 0.2.0 (SEC-001), 0.3.0 (FEAT-001), 0.3.1 (this spec). |
| O5 | Durable test suite: `tests/run.ts` runnable via `npm test` (and bare `node tests/run.ts`), stdlib-only, covering at minimum: `sanitizeHandoffField`, `handoffInject` default vs rich, `classifyExit` truth table, `claudeProjectDir`/`claudeSessionFiles` disambiguation, `loadAgents` copy-on-load, `resolveExecutable`, `scanChunk` honesty, symlink/atomic/0600 state, trust record/expiry/revoke. Fixtures under the runner's tmp dir; no network. |
| O6 | **W1 (T2):** expired grants are pruned when the grant store is written (record/revoke paths); `trust status` continues to list expired grants marked `(EXPIRED)`. |
| O7 | **W2 (P4):** `nextStepHint` is printed **before** `pick()` in `offerHandoff`. |
| O8 | **W3 (R2):** the cursor walk in `lastSessionText` (src/launch.ts) is bounded by the same cap constant used by the ledger (exported, shared). |
| O9 | INDEX consistency: SEC-001 `done`, FEAT-001 `certify`, OPS-001 v1 `superseded`, OPS-001 v2 status tracks build (`in-build` → `certify`). |

**Acceptance:** stranger clone → README → `kala status` works; `npm test`
green; no known-open audit findings (W1–W4 cleared or explicitly re-waived
in CERT-003).

---

## 5. Deferred

npm publish, signed releases, Windows matrix, CI (a `node tests/run.ts` is
the bar; CI wiring later), test coverage of live vendor CLIs.

---

## 6. Handoff blurb (paste to builder)

> Implement **OPS-001 v2** under ARCH-001 v1. Close W1–W4 exactly as
> specified in §4 (O6–O8 + README line), land `tests/run.ts` on `npm test`,
> add LICENSE (MIT) + CHANGELOG, bump 0.3.1, keep the tree dependency-free.
> Do not touch FEAT-001/SEC-001 code beyond O7's one-line move. When
> finished, mark INDEX `certify` and open CERT-003 referencing
> **OPS-001 v2** — noting which waivers are now cleared so the TL can close
> them in CERT-001's follow-up column.
