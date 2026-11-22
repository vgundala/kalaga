# CERT-005 — Certification of FEAT-003 v1

| Field | Value |
|-------|-------|
| **ID** | CERT-005 |
| **Version** | v1 |
| **Date** | 2026-11-22 |
| **Verdict** | `pass` — **pending TL sign-off** (builder-filled) |
| **Spec under test** | FEAT-003 v1 → [`FEAT-003-handoff-state-protocol.v1.md`](FEAT-003-handoff-state-protocol.v1.md) |
| **Also constrained by** | ARCH-001 v1; SEC-001 v1; FEAT-001 v1; FEAT-002 v1 |
| **Tree** | `/home/vinay/Code/playground/kalaga` @ **0.5.0** |
| **Folded in** | CERT-004 **W1/R4** — `refreshState` `captureFor` dead code (one-line fix) |

---

## 1. Requirement matrix

| ID | Verdict | Evidence |
|----|---------|----------|
| H1 | met | `done: string[]` in `HandoffState`; blank `[]`; emitted as a YAML list by `toYaml` (same style as `modified_files`); read by `loadState`'s list parser. Round-trip tested (15 appends → 12 kept, oldest dropped). |
| H2 | met | `FIELD_MAX` extended (`doneItem: 300, doneItems: 12, negItem: 200, negItems: 20`); new `sanitizeHandoffList(items, count, item)` reuses `sanitizeHandoffField`; inject test asserts oldest 8 of 20 dropped and per-item cap (no 301-char run survives). |
| H3 | met | `handoffInject` is now protocol mode by default: pointer + `Goal:` + `Done:` bullets + `Next step:` + `Avoid:` + standing orders. All handoff call sites (`offerHandoff`, clean-tier, `doStart`/`doRun` non-fresh, `doSwitch`) already route through it. `resumeAgent` still passes no inject (FEAT-002 R8 unchanged; R14 test still green). |
| H4 | met | `STANDING_ORDERS` constant (verbatim §3.3 text) appended to every protocol inject; first-run (uncaptured) launches print it on stderr with a "set goal/next_step" nudge instead of an argv prompt (§3.3 preferred option — documented here). |
| H5 | met | `isThinState(s)` pure in `state.ts` (goal "not captured"/<8 chars; done empty AND notes <40; blank-default next_step). Warned on cross-agent launch in `offerHandoff` (picker) and clean-tier branch; `kala switch` warns or aborts under `--strict-state`. |
| H6 | met | `offerHandoff` now: `refreshState(dead)` → `liveAskAndMerge(agentFor(dead))` → picker. Merge is `_source: 'live-ask'`; failure/timeout/empty → stderr warn, existing state kept, handoff proceeds (fail soft). |
| H7 | met | `doSwitch` live-asks the previous owner (or most-recent captured session agent) when installed and distinct from the target; skips when no owner/sessions. |
| H8 | met | `runLiveAsk`: `spawn(resolved, [...headless, prompt])`, `stdio: ['ignore','pipe','ignore']` (never TTY, never `shell: true`), 45s `LIVE_ASK_TIMEOUT_MS` SIGKILL. `liveAskArgv` tested against config headless flags. |
| H9 | met | `kala state done <text>` appends (cap 12, drop oldest); `kala status` prints `done: <n> — <first bullet>`. |
| H10 | met | README: "The handoff protocol" section — field table, protocol inject description, live-ask note + budget honesty, thin-state warning + `--strict-state`, manual edits. |
| H11 | met | New tests: `isThinState` blank/rich, live-ask YAML fixture parse (fenced + lists + unknown-key rejection), `done` append+cap round-trip, protocol inject shape + caps, `liveAskArgv`. Suite **32/32** (was 25). |
| H12 | met | `package.json` 0.5.0; CHANGELOG 0.5.0 entry citing FEAT-003. |
| H13 | met | SEC-001 P3 amendment documented: README "Amends SEC-001 P3" note + Security section updated (sanitize/caps still hold; default handoff inject broadened from pointer+next to protocol mode). |
| W1/R4 (CERT-004) | met | `refreshState`: `if (deadKey) await captureFor(deadKey);` moved **before** `return mergeState(...)` — recover path now captures the dead agent's session. |

## 2. Verification

- **Automated:** `npm test` → **32/32 pass** (re-ran).
- **Smoke:** `node src/index.ts agents` and bare `kala` startup run clean (picker
  exits on EOF as expected in non-TTY); state round-trips with `done` present.
- **Manual (pending TL):** live-ask against a real/stub agent, thin-state
  warning on blank state, `--strict-state` abort, cross-agent taker citing
  `done` — see FEAT-003 §6 manual checklist.

## 3. Constraints

ARCH A4/A5/A6 held (no shell spawn, no auto-launch on clean exit, store-based
trap unchanged). No new runtime deps. SEC sanitize/symlink/atomic state I/O
untouched (S1–S4 tests still green).

## 4. Residuals

- Live-ask quality depends on vendor CLI print-mode compliance; a non-compliant
  answer simply fails soft. Vendor-specific prompt tuning is out of scope (v2).
- `--strict-state` is opt-in (spec-deferred default-on).
- Live-ask timeout fixed at 45s (configurable later, per spec).

**Sign-off:** pending — TL certifies against FEAT-003 v1; on pass, INDEX →
FEAT-003 `done` and CERT-004 W1 closes.
