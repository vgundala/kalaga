# CERT-002 — Certification of FEAT-001 v1

| Field | Value |
|-------|-------|
| **ID** | CERT-002 |
| **Version** | v1 |
| **Certifies** | [`FEAT-001-post-exit-handoff.v1.md`](FEAT-001-post-exit-handoff.v1.md) (v1, locked) |
| **Built under** | ARCH-001 v1 + SEC-001 v1 (done) |
| **Date** | 2026-11-21 |
| **Verdict** | `pass` — **pending TL sign-off** (builder-filled) |

---

## 1. Verdict table

| ID | Verdict | Note |
|----|---------|------|
| E1 | met | `doStart`/`doRun` both capture `runAgent` exit code → shared `afterExit` |
| E2 | met | `classifyExit` pure in `src/trap.ts`; 5-row truth table tested |
| E3 | met | `exitNotice`: limit / suspect(code) / clean(code) — one line, stderr |
| E4 | met | `doSwitch` and `doRecover` untouched |
| E5 | met | limit tier → `offerHandoff` unchanged (BLOCKED + L3 note + limit picker) |
| E6 | met | suspect: `--assume-limit` or TTY `[y/N]`; n → refreshState(null) + shell; non-TTY → shell |
| E7 | met | clean: refreshState(null) (IN_PROGRESS kept), stay-default menu; number = hand off |
| E8 | met | `q`/`e` → stay in every tier's menu (tested in both modes) |
| E9 | met | handoff launch from the menu is the last launch — no chained menus |
| E10 | met | `pick` opts `{ stayDefault?, header? }`; `PickResult.stay?`; Enter behavior per mode |
| E11 | met | no auto-launch in any mode; launch = explicit number (or Enter on limit tier = pre-existing recommendation) |

## 2. Evidence

- **Automated:** 10/10 pure checks pass — `classifyExit` truth table (5 rows),
  picker stay-default (Enter→stay, number→taker), limit-mode Enter→recommended,
  `q` escape in both modes. Stdin driven via PassThrough, no TTY needed.
- **Manual (stub CLIs, isolated KALA_HOME):** all three tiers exercised end-to-end
  through `bin/kala`: clean (Enter → nothing launched, exit 0), clean + number
  (handoff launches), `q` (stays), suspect without flag (no picker),
  suspect `--assume-limit` (limit picker), limit (planted claude jsonl with
  "usage limit" → 💀 + picker).
- **Amendment noted:** per spec §1, this amends SEC-001 L1's acceptance
  ("clean `kala run` → no picker") to a stay-default menu. Limit-hit
  semantics unchanged; clean exits still never classified as limit hits.

## 3. Waivers

None. (Interactive TTY variants of suspect/clean prompts verified with stub
CLIs + piped stdin; a real vendor quota exhaustion remains a live-only check.)

## 4. Residuals

- Bare `kala --flag` dispatch: any leading `--` arg now starts (needed for
  `kala --assume-limit`); unknown non-flag words still print usage.
- Chained post-exit menus still deferred (one menu per invocation, per §7).

## 5. Sign-off

- [x] Builder: all requirements `met`; INDEX moved to `certify`
- [ ] TL/PO: confirm verdict `pass` (or amend) → INDEX `done`
