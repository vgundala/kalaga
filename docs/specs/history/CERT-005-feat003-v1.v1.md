# CERT-005 — Certification of FEAT-003 v1

| Field | Value |
|-------|-------|
| **ID** | CERT-005 |
| **Version** | v1 |
| **Status** | `final` |
| **Date** | 2026-11-22 |
| **Certifier** | Technical lead |
| **Builder** | (prior agent build) |
| **Spec under test** | FEAT-003 v1 → [`FEAT-003-handoff-state-protocol.v1.md`](../FEAT-003-handoff-state-protocol.v1.md) |
| **Also constrained by** | ARCH-001 v1; SEC-001 v1; FEAT-001 v1; FEAT-002 v1 |
| **Tree** | `kalaga` (repo root) @ **0.5.0** |
| **Also closes** | CERT-004 **W1/R4** (`refreshState` capture before return) |

---

## 1. Verdict

**Final verdict: `pass`**

All H1–H13 `met`. CERT-004 W1 formally closed. No waivers.

---

## 2. Requirement matrix

| ID | Result | Evidence |
|----|--------|----------|
| H1 | met | `done: string[]`; YAML list; round-trip in suite |
| H2 | met | `sanitizeHandoffList` + caps 12×300 / 20×200 |
| H3 | met | Default `handoffInject` = protocol mode; resume inject-free |
| H4 | met | `STANDING_ORDERS` in inject; first-run stderr nudge |
| H5 | met | `isThinState`; warn on cross-agent; `--strict-state` abort |
| H6 | met | `liveAskAndMerge` before picker in `offerHandoff`; fail soft |
| H7 | met | `doSwitch` live-asks prior owner when distinct + installed |
| H8 | met | headless argv, piped stdio, 45s kill; no `shell: true` |
| H9 | met | `kala state done`; status `done: N — …` |
| H10 | met | README protocol section |
| H11 | met | Suite FEAT-003 block |
| H12 | met | `0.5.0` + CHANGELOG |
| H13 | met | README “Amends SEC-001 P3” |
| CERT-004 W1/R4 | met | `captureFor(deadKey)` **before** `return mergeState` in `refreshState` |

---

## 3. Verification

### Automated

`npm test` → **32/32 pass** (TL re-ran).

### Manual (TL, isolated `$KALA_HOME` + PATH stubs)

| Check | Result |
|-------|--------|
| Live-ask against stub `claude -p` updates `done` / `next_step` | **Pass** — merged goal `Ship FEAT-003…`, 2 done bullets, next `Certify CERT-005…` |
| Thin warn on blank state (live-ask fail-soft) | **Pass** — `handoff state looks thin` on `kala switch cursor` |
| `--strict-state` abort | **Pass** — `refusing to switch`; taker not launched |
| Taker inject cites `done` / keeps goal (no invented goal) | **Pass** — cursor stub argv contained `Goal: Ship FEAT-003…`, `Done: …`, `Avoid: Do not invent…` |
| Live-ask timeout fail-soft (bonus / §6) | **Pass** — 600ms timeout, state unchanged |
| `kala state done` + status (bonus / §6) | **Pass** — `done: 1 — shipped X` |

---

## 4. Waivers

None.

---

## 5. Residuals

- Live-ask quality depends on vendor print-mode compliance (fail soft).  
- `--strict-state` remains opt-in.  
- Timeout fixed at 45s (production); configurable later.

---

## 6. Certifier notes

Builder matrix matched the tree. Manual checks used stub CLIs (not live quota). Product continuity path (protocol inject + live-ask + thin warn) behaves as locked.

**Sign-off:** TL confirms **`pass`**. INDEX → FEAT-003 `done`. CERT-004 W1 closed.
