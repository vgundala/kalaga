# FEAT-001 — Post-exit handoff (evidence-tiered exit prompt)

| Field | Value |
|-------|-------|
| **ID** | FEAT-001 |
| **Version** | v1 |
| **Status** | `done` (CERT-002 pass) |
| **Date** | 2026-11-21 |
| **Supersedes** | — |
| **Owner** | Technical lead |
| **Depends on** | ARCH-001 v1, SEC-001 v1 (done) |
| **Build priority** | 1 (next handoff) |

---

## 1. Intent

Make the post-agent-exit path seamless for **every** launch mode, and honest about
*why* the agent stopped. Today: `kala run <agent>` scans the store after exit and
offers the picker on a limit hit only; bare `kala` returns to the shell silently,
discarding the child's exit code.

After this feature, whenever kala spawned the agent (bare `kala` or `kala run`),
kala classifies the exit by **evidence tier** and offers the right prompt:

| Evidence | Tier | Prompt |
|----------|------|--------|
| Limit signature in session tail | `limit` | limit picker (Enter = recommended taker) — unchanged |
| No readable store + non-zero exit code | `suspect` | `assume it hit its limit? [y/N]` → limit picker or shell |
| Zero exit code, or store present but no signature | `clean` | handoff menu with **Enter = stay / back to shell**; number = hand off |

**Key property: kala never auto-launches on a non-limit exit** (ARCH A5). On a
clean exit the *default key is "stay"*, so a deliberate `/exit` costs one
keypress and can never accidentally spend another agent's budget.

**Amends SEC-001 L1 acceptance** ("clean `kala run` → no picker"): a clean exit
now shows a *stay-default* menu instead of nothing. Limit-hit semantics are
unchanged — a clean exit is still never classified as a limit hit.

---

## 2. In / out of scope

**In:** exit-code capture in bare `kala` and `kala run`; tier classifier
(pure, testable); stay-default picker mode; `q`/`e` escape key; suspect-tier
`[y/N]` reusing the SEC-001 L2 pattern; one-line exit notice on stderr;
post-exit state refresh per tier; README loop section.

**Out:** loop-back (a handoff launch exits to the shell — no chained menus per
invocation), `kala switch` post-exit flow (one-shot by design), agy-specific
store discovery (exit code is the signal), `--no-handoff` flag, CERT W2–W4
fixes (OPS-001 territory).

---

## 3. Approach

| Topic | Choice | Rejected |
|-------|--------|----------|
| When to prompt | After **every** kala-spawned exit, tiered | Silent return (current bare `kala`) |
| Clean-exit default | Enter = **stay** (no launch) | Enter = taker (risks accidental spend) |
| Store-less non-zero exit | `suspect`: `[y/N]` (L2 pattern) | Auto-assume; auto-skip |
| Store present, no signature, non-zero | `clean` (crash ≠ limit), notice shows code | `suspect` (no evidence) |
| Escape key | `q` / `e` = stay in **all** menus | Number-only |
| Loop-back after handoff | None — handoff launch exits to shell | Chained menu loop |

Classification is a **pure function** over `{ hit, exitCode, hasTail }` — unit-testable,
no I/O. Picker gains one mode flag; no new module, no dependencies.

### 3.1 Menus

Limit (unchanged):
```
  💀 claude — limit hit (matched "usage limit")
  continue on →
    * [1] agy      250k left   owns current handoff state
      [2] cursor   250k left   unused this window
      [0] claude   wait for reset
  (Enter = * recommendation, number to override, 0 = wait)
```

Clean (new — stay-default):
```
  agy exited cleanly (code 0).
  hand off, or stay?
    * [1] claude   250k left   owns current handoff state
      [2] cursor   250k left   unused this window
  (Enter = stay / back to shell, number = hand off, q = stay)
```

Suspect (new):
```
  agy exited (code 1) — no session log to scan
  assume it hit its limit? [y/N]
```
`y` → limit menu; `n` → record final facts, back to shell.

---

## 4. Requirements

### 4.1 Exit capture and classification

| ID | Requirement |
|----|-------------|
| E1 | Bare `kala` (doStart) and `kala run` (doRun) capture the child exit code from `runAgent` and route it through one shared post-exit flow. |
| E2 | `classifyExit({ hit, exitCode, hasTail }) → 'limit' \| 'suspect' \| 'clean'` — pure, exported from `src/trap.ts`. Rules: hit → `limit`; no tail + non-zero code → `suspect`; everything else → `clean`. |
| E3 | One-line stderr notice before any menu: limit → `💀 <agent> — limit hit (matched "…")`; suspect → `<agent> exited (code N) — no session log to scan`; clean → `<agent> exited cleanly (code N).` |
| E4 | `kala switch` is unchanged (one-shot handoff, no post-exit menu). `kala recover` is unchanged (SEC-001 L2 already covers it). |

**Acceptance:** `/exit` in agy via bare `kala` → clean notice + stay-default menu.
agy exits non-zero → suspect confirm. claude with signature in tail → limit menu.

### 4.2 Tiered prompt behavior

| ID | Requirement |
|----|-------------|
| E5 | `limit` tier: existing `offerHandoff` path, unchanged (refreshState(dead) → BLOCKED + L3 note → picker, Enter = taker, `0` = wait). |
| E6 | `suspect` tier: `--assume-limit` (env/argv, as in L2) or TTY `[y/N]`; `y` → limit menu; `n` → refreshState(null), back to shell. Non-TTY without flag → back to shell. |
| E7 | `clean` tier: refreshState(null) (keep `IN_PROGRESS`, final git facts), then picker in **stay-default mode**: Enter = stay (no launch, exit to shell); number = hand off to that agent (owner update + inject + trust, as today); `q`/`e` = stay. |
| E8 | `q` / `e` returns to shell without launching, in **every** tier's menu. |
| E9 | A handoff launch made from the post-exit menu is the last launch of that
`kala` invocation: when *that* agent exits, kala returns to the shell (no
chained menus). |

**Acceptance:** Enter on a clean-exit menu launches nothing and returns exit 0.
`q` on a limit menu launches nothing.

### 4.3 Picker changes

| ID | Requirement |
|----|-------------|
| E10 | `pick` gains an options param `{ stayDefault?: boolean }`; `PickResult` gains `stay?: boolean` (true = user declined). `stayDefault` only affects the Enter behavior. |
| E11 | No auto-launch in any mode (ARCH A5): every launchable outcome is an explicit number (or Enter on a limit-tier menu, which is the pre-existing confirmed recommendation). |

---

## 5. Touch map

| Path | Change |
|------|--------|
| `src/trap.ts` | `classifyExit` (pure) |
| `src/picker.ts` | `stayDefault` option, `stay` result, `q`/`e` escape |
| `src/index.ts` | shared `afterExit(agentKey, exitCode)`; doStart/doRun route through it; suspect confirm reuses L2 prompt |
| `README.md` | "The loop" section: tiered exit behavior |
| `package.json` | 0.3.0 |

**Constraint:** no new dependencies (ARCH A6); argv-only spawn (A4); picker
mandatory for launch (A5).

---

## 6. Verification

### Automated (preferred)

Pure tests, fixtures in tmp, no network:
- `classifyExit` truth table (4 rows: hit / no-tail+nonzero / zero / tail-no-hit+nonzero)
- picker stay-default: piped stdin `""` → `stay: true`; piped `"2"` → taker
- picker `q` escape in limit mode → `stay: true`

### Manual (required for certify)

- [ ] agy via bare `kala`, `/exit` → clean notice, **Enter stays**, `1` hands off
- [ ] agy via `kala run agy`, non-zero exit → suspect `[y/N]`
- [ ] claude limit signature in tail → limit menu, Enter takes over
- [ ] `q` at any menu → shell, nothing launched

### Certify artifact

Builder sets FEAT-001 to `certify` in INDEX and opens the next free CERT record
referencing **FEAT-001 v1** exactly.

---

## 7. Deferred

| Item | Why |
|------|-----|
| Chained post-exit menus (loop until shell chosen) | One menu per invocation is enough; looping risks spend spirals |
| agy session-store discovery | Exit code + suspect prompt covers it; revisit if agy exposes a log |
| `--no-handoff` flag | Stay-default Enter already covers "just let me out" |
| Crash-tier (store present, non-zero, no signature → special menu) | Indistinguishable from clean for handoff purposes; code shown in notice |

---

## 8. Done when

- CERT record verdict `pass` / `pass-with-waivers` against **this file (v1)**
- INDEX marks FEAT-001 v1 `done`
- Clean exit never classified as limit hit; clean-exit Enter never launches
- README loop section matches §3.1

---

