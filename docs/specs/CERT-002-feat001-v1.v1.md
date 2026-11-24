# CERT-002 — Certification of FEAT-001 v1

| Field | Value |
|-------|-------|
| **ID** | CERT-002 |
| **Version** | v1 |
| **Status** | `final` |
| **Date** | 2026-11-22 |
| **Certifier** | Technical lead |
| **Builder** | (prior agent build; package now `0.3.1`) |
| **Spec under test** | FEAT-001 v1 → [`FEAT-001-post-exit-handoff.v1.md`](FEAT-001-post-exit-handoff.v1.md) |
| **Also constrained by** | ARCH-001 v1; SEC-001 v1 (done) |
| **Tree** | `kalaga` (repo root) @ **0.3.1** |

---

## 1. Verdict

**Final verdict: `pass`**

All E1–E11 `met`. No waivers. SEC-001 L1 acceptance is amended as the locked FEAT spec allows (clean exit → stay-default menu; never classified as limit).

---

## 2. Requirement matrix

| ID | Result | Evidence |
|----|--------|----------|
| E1 | met | `doStart` / `doRun` capture `runAgent` exit → `afterExit` |
| E2 | met | `classifyExit` in `src/trap.ts`; truth table in `npm test` |
| E3 | met | `exitNotice`: limit / suspect(code) / clean(code) on stderr |
| E4 | met | `doSwitch` / `doRecover` have no `afterExit` |
| E5 | met | `limit` → `offerHandoff` (BLOCKED + L3 + picker) |
| E6 | met | suspect: `--assume-limit` or TTY `[y/N]`; else refresh + shell |
| E7 | met | clean: `refreshState(null)` + `stayDefault: true` picker |
| E8 | met | `q`/`e` → `stay: true` in `pick` (all modes) |
| E9 | met | post-exit handoff `runAgent` is terminal — no second `afterExit` |
| E10 | met | `PickOptions.stayDefault`, `PickResult.stay` |
| E11 | met | no auto-launch; Enter on clean = stay; Enter on limit = recommendation |

---

## 3. Verification

| Check | TL result |
|-------|-----------|
| `classifyExit` truth table | **Pass** via `npm test` (hit→limit; no-tail+nonzero→suspect; zero→clean; tail+no-hit+nonzero→clean) |
| Clean exit never → limit | **Pass** (same suite) |
| ARCH A5 (picker / no silent launch) | **Pass** (code review of `afterExit`) |
| README loop / tier table | **Pass** (present) |

Live vendor quota exhaustion not re-probed this session; covered by code path + suite.

---

## 4. Waivers

None.

---

## 5. ARCH compliance

| Check | Result |
|-------|--------|
| A2 store-based trap | met |
| A4 no shell spawn | met |
| A5 picker mandatory for launch | met |
| A6 no new runtime deps | met |

---

## 6. Certifier notes

Builder CERT draft matched the tree. Clean-tier `nextStepHint` still prints after the stay-default pick (only when a number hands off) — outside FEAT scope; OPS-001 O7 only required the move inside `offerHandoff`, which is done under CERT-003.

**Sign-off:** TL confirms **`pass`**. INDEX → FEAT-001 v1 `done`.
