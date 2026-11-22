# CERT-003 — Certification of OPS-001 v2

| Field | Value |
|-------|-------|
| **ID** | CERT-003 |
| **Version** | v1 |
| **Certifies** | [`OPS-001-share-readiness.v2.md`](OPS-001-share-readiness.v2.md) (v2, locked) |
| **Built under** | ARCH-001 v1; SEC-001 v1 (done) |
| **Date** | 2026-11-22 |
| **Verdict** | `pass` — **pending TL sign-off** (builder-filled) |

---

## 1. Verdict table

| ID | Verdict | Note |
|----|---------|------|
| O1 | met | `LICENSE` — MIT, "Kalaga contributors" |
| O2 | met | README complete; **`$KALA_HOME` documented** (W4 cleared) |
| O3 | met | `version` 0.3.1, `engines.node >=24`, zero `dependencies` |
| O4 | met | `CHANGELOG.md` with 0.1.0 / 0.2.0 / 0.3.0 / 0.3.1 entries |
| O5 | met | `tests/run.ts` on `npm test` — 20 stdlib-only checks, all required helpers covered, isolated `$HOME`/`$KALA_HOME` under `os.tmpdir()`, no network |
| O6 (W1/T2) | met | expired grants pruned in `recordTrustGrant`/`revokeTrust` write paths; `trustStatus` still lists them marked `(EXPIRED)` (tested) |
| O7 (W2/P4) | met | `nextStepHint` printed before `pick()` in `offerHandoff`; duplicate pre-launch hint removed |
| O8 (W3/R2) | met | `lastSessionText` cursor walk bounded by shared `CURSOR_META_SCAN_CAP` (exported from config.ts, single source) |
| O9 | met | INDEX: SEC-001 done, FEAT-001 certify, OPS-001 v1 superseded, v2 tracking build |

## 2. Waiver closures (for CERT-001 follow-up column)

| Waiver | Status after this build |
|--------|------------------------|
| W1 / T2 | **cleared** — prune-on-write (record + revoke) |
| W2 / P4 | **cleared** — hint before picker |
| W3 / R2 | **cleared** — trap cursor walk capped, shared constant |
| W4 / M3 | **cleared** — `$KALA_HOME` in README |

No re-waivers requested.

## 3. Evidence

- **Automated:** `npm test` → 20/20 pass (sanitize, inject, classifyExit
  truth table, scanChunk honesty, claude dir + disambiguation, copy-on-load,
  binary resolve, symlink refuse, atomic/0600, trust record/prune/status/revoke).
- **Suite hygiene:** runs against a throwaway `$HOME`/`$KALA_HOME` in
  `os.tmpdir()`, removed on exit — never touches the user's real
  `~/.claude`, `~/.kala`, or `~/.cursor`.

## 4. Residuals

- Live vendor-CLI behaviors (real quota hits, TTY prompts) remain
  manual/live-only checks — not coverable by the stdlib suite.
- FEAT-001 v1 still awaits TL sign-off (CERT-002); this cert does not touch it.

## 5. Sign-off

- [x] Builder: all requirements `met`; INDEX moved to `certify`
- [ ] TL/PO: confirm verdict `pass` → INDEX `done`; optionally flip
  CERT-001 W1–W4 follow-ups to "cleared in OPS-001 v2 (CERT-003)"
