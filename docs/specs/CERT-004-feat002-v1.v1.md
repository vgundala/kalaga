# CERT-004 — Certification of FEAT-002 v1

| Field | Value |
|-------|-------|
| **ID** | CERT-004 |
| **Version** | v1 |
| **Certifies** | [`FEAT-002-session-capture-resume.v1.md`](FEAT-002-session-capture-resume.v1.md) (v1, locked) |
| **Built under** | ARCH-001 v1 + SEC-001 v1 + FEAT-001 v1 (all done) |
| **Date** | 2026-11-22 |
| **Verdict** | `pass` — **pending TL sign-off** (builder-filled) |

---

## 1. Verdict table

| ID | Verdict | Note |
|----|---------|------|
| R1 | met | `HandoffState.sessions: Record<agent, {id,at}>`; nested `sessions:` emitted by `toYaml`, parsed by `parseSessions` (round-trip tested) |
| R2 | met | `normalizeSessionId`: claude `.jsonl` stripped; other agents passthrough (tested) |
| R3 | met | `captureFor` at the top of `afterExit` (before classification — tiers untouched) |
| R4 | met | `refreshState(deadKey)` captures the dead agent when a hint exists |
| R5 | met | capture only when `sessionHint` non-null; agy stays null (tested: `resume agy` → clear error) |
| R6 | met | `resume: string[]` replaced by `resumeByIdPrefix: string[]` in `AgentConfig` |
| R7 | met | claude `-r`, cursor `--resume`, grok `-r`, agy `--conversation` (argv assembly tested) |
| R8 | met | `resumeAgent`: resolved binary + conditional trustFlags + resume prefix + id; **no** handoff inject |
| R9 | met | `kala resume [agent]` — default = state owner; per §3.5 case table |
| R10 | met | `sessionFresh`: ≤7 days AND claude jsonl exists / cursor dir best-effort / grok sqlite row best-effort (fail-open); stale tested |
| R11 | met | resume child exit → FEAT-001 `afterExit` |
| R12 | met | `kala resume` in help + README section |
| R13 | met | wait row prints `kala resume <dead>` when a fresh session exists (verified via limit menu) |
| R14 | met | session ids never in default or rich inject (tested) |
| R15 | met | `npm test` +5 FEAT-002 cases (25/25 total) |
| R16 | met | package 0.4.0; CHANGELOG entry citing FEAT-002 |

## 2. Evidence

- **Automated:** `npm test` → 25/25 pass, incl. normalize, resume argv for all
  four agents, freshness reject (>7d) + accept (artifact exists), state
  round-trip, id-exclusion from inject.
- **Manual (stub CLIs, isolated KALA_HOME):**
  - bare `kala` → claude → clean exit → `sessions.claude.id` present in
    `.kala/state.yaml`.
  - `kala resume claude` → stub argv proved `-r <uuid>`, then FEAT-001
    afterExit flow ran.
  - `kala resume agy` (no capture) → `no captured session for agy — run it
    via kala first`.
  - stale `at` (8d) → `captured session for claude is stale`.
  - limit menu → `0` wait → `kalaga: when the window resets → kala resume
    claude` (verified via `kala recover` limit path, which shares the
    `offerHandoff` wait branch).

## 3. Waivers

None.

## 4. Residuals / notes

- agy resume is capture-null until store discovery (spec §3.2 — expected).
- grok sqlite freshness check runs `grok usage`-style exec only in the
  ledger; the freshness row check is read-only sqlite, fail-open on error.
- Real vendor `--resume` behavior (claude/grok) not re-probed against live
  sessions this session — flags per spec §3.2 were TL-verified on this
  machine 2026-11-22.

## 5. Sign-off

- [x] Builder: all requirements `met`; INDEX moved to `certify`
- [ ] TL/PO: confirm verdict `pass` → INDEX `done`
