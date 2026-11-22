# CERT-003 — Certification of OPS-001 v2

| Field | Value |
|-------|-------|
| **ID** | CERT-003 |
| **Version** | v1 |
| **Status** | `final` |
| **Date** | 2026-11-22 |
| **Certifier** | Technical lead |
| **Builder** | (prior agent build) |
| **Spec under test** | OPS-001 v2 → [`OPS-001-share-readiness.v2.md`](OPS-001-share-readiness.v2.md) |
| **Also constrained by** | ARCH-001 v1; SEC-001 v1 (done) |
| **Tree** | `/home/vinay/Code/playground/kalaga` @ **0.3.1** |

---

## 1. Verdict

**Final verdict: `pass`**

All O1–O9 `met`. CERT-001 waivers W1–W4 are **cleared** by this build (see §2).

---

## 2. Requirement matrix

| ID | Result | Evidence |
|----|--------|----------|
| O1 | met | `LICENSE` — MIT, "Kalaga contributors" |
| O2 | met | README: install, Node ≥ 24, trust, residuals, `.kala/`, tiered loop, **`$KALA_HOME`** (W4) |
| O3 | met | `package.json` `0.3.1`, `engines.node >=24`, no `dependencies` |
| O4 | met | `CHANGELOG.md` — 0.1.0 / 0.2.0 / 0.3.0 / 0.3.1 |
| O5 | met | `npm test` → `tests/run.ts` — **20/20 pass** (TL re-ran) |
| O6 (W1/T2) | met | `recordTrustGrant` / `revokeTrust` filter `!isExpired` before write; `trustStatus` marks `(EXPIRED)` without pruning on read |
| O7 (W2/P4) | met | `offerHandoff`: `nextStepHint(state)` **before** `pick()` |
| O8 (W3/R2) | met | `launch.ts` + `ledger.ts` both use exported `CURSOR_META_SCAN_CAP` from `config.ts` |
| O9 | met | INDEX tracks SEC done, FEAT certify→done (this session), OPS v1 superseded, v2 done |

### Waiver closures (CERT-001 follow-up)

| Waiver | Status |
|--------|--------|
| W1 / T2 | **cleared** — prune-on-write |
| W2 / P4 | **cleared** — hint before picker in `offerHandoff` |
| W3 / R2 | **cleared** — shared cursor scan cap in trap walk |
| W4 / M3 | **cleared** — `$KALA_HOME` in README |

---

## 3. Verification

| Check | TL result |
|-------|-----------|
| `npm test` | **20/20 pass** |
| LICENSE / CHANGELOG / version | **Pass** (file review) |
| W1–W4 code paths | **Pass** (grep + trust/launch/index review) |
| ARCH A6 (no runtime deps) | **Pass** |

---

## 4. Waivers

None. No re-waivers.

---

## 5. Residuals

- Live vendor-CLI / real quota exhaustion remain manual.
- CI wiring deferred (stdlib `npm test` is the bar per OPS §5).
- FEAT-001 certified separately in CERT-002 (same session).

---

## 6. Certifier notes

Share bar for early adopters is met at **0.3.1**: clone + symlink, documented trust/`$KALA_HOME`, MIT, changelog, green zero-dep tests, no open CERT-001 audit waivers.

**Sign-off:** TL confirms **`pass`**. INDEX → OPS-001 v2 `done`. Update CERT-001 follow-ups to cleared.
