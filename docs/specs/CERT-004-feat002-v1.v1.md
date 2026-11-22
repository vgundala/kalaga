# CERT-004 — Certification of FEAT-002 v1

| Field | Value |
|-------|-------|
| **ID** | CERT-004 |
| **Version** | v1 |
| **Status** | `final` |
| **Date** | 2026-11-22 |
| **Certifier** | Technical lead |
| **Builder** | (prior agent build) |
| **Spec under test** | FEAT-002 v1 → [`FEAT-002-session-capture-resume.v1.md`](FEAT-002-session-capture-resume.v1.md) |
| **Also constrained by** | ARCH-001 v1; SEC-001 v1; FEAT-001 v1 |
| **Tree** | `/home/vinay/Code/playground/kalaga` @ **0.4.0** |

---

## 1. Verdict

**Final verdict: `pass-with-waivers`**

Core capture + `kala resume` + wait-hint + tests + docs are met. One requirement
(**R4**) is only partially met due to unreachable code in `refreshState` (see §4).

---

## 2. Requirement matrix

| ID | Result | Evidence |
|----|--------|----------|
| R1 | met | `HandoffState.sessions`; nested YAML save/load; round-trip in `npm test` |
| R2 | met | `normalizeSessionId` strips `.jsonl` for claude only |
| R3 | met | `afterExit` → `captureFor` before classify |
| R4 | partial | Intended `captureFor` in `refreshState` sits **after** `return mergeState(...)` — dead code. Recover → `offerHandoff` → `refreshState(dead)` therefore does **not** capture. Main `kala run` path still captures via R3. |
| R5 | met | capture only when `sessionHint` non-null |
| R6 | met | `resumeByIdPrefix` replaces flat `resume` stub |
| R7 | met | claude `-r`, cursor `--resume`, grok `-r`, agy `--conversation` |
| R8 | met | `resumeAgent`: resolved bin + trust + prefix + id; no inject |
| R9 | met | `kala resume [agent]`; default owner |
| R10 | met | 7-day TTL + claude exists; cursor/grok best-effort; stale message clear |
| R11 | met | resume → `afterExit` |
| R12 | met | help + README |
| R13 | met | wait branch prints `kala resume <dead>` when fresh |
| R14 | met | inject tests — no session id |
| R15 | met | FEAT-002 cases in suite |
| R16 | met | `0.4.0` + CHANGELOG |

---

## 3. Verification

| Check | TL result |
|-------|-----------|
| `npm test` | **25/25 pass** (re-ran) |
| Version / CHANGELOG / README resume | **Pass** |
| R3 afterExit capture | **Pass** (code review) |
| R4 refreshState capture | **Fail path** — unreachable; waived |
| ARCH A4/A5/A6 | **Pass** |

Live vendor resume not re-probed this session; flags match FEAT-002 §3.2 (previously verified on-machine).

---

## 4. Waivers

| ID | Reason | Follow-up |
|----|--------|-----------|
| **W1 / R4** | `refreshState` returns before `await captureFor(deadKey)`, so R4’s refresh/recover capture never runs. `kala run` / bare `kala` still capture via `afterExit` (R3). `kala switch` has its own `captureFor`. | One-line fix: call `captureFor` **before** `return mergeState` (or after merge, before return). Land as FEAT-002 v1 patch / tiny follow-up before or with FEAT-003. |

---

## 5. Residuals

- agy: no discoverable id (expected)  
- Cursor freshness fail-open if walk inconclusive (spec-allowed)  
- Real `--resume` against live vendor sessions: builder stub-verified; not re-run by TL  

---

## 6. Certifier notes

Feature is shippable for the primary loop (run → capture → resume → wait hint).
Do **not** treat `kala recover` alone as guaranteeing a captured session until W1 is fixed.

**Sign-off:** TL confirms **`pass-with-waivers`**. INDEX → FEAT-002 v1 `done`.
