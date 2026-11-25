# Kalaga — System Test Procedure (Real Agents)

| Field | Value |
|-------|-------|
| **Document type** | System / acceptance test procedure |
| **Product** | Kalaga (`kala`) |
| **Scope** | End-to-end behavior with installed vendor CLIs |
| **Out of scope** | Unit/component tests (`npm test`, CI). Those do not satisfy this procedure. |
| **Related** | [qa-e2e-regression.md](qa-e2e-regression.md) (repeatable driver), [qa-checklist.md](qa-checklist.md), [qa-results.md](qa-results.md) |

---

## 1. Purpose

Verify that Kalaga correctly launches, detects exit/limit conditions, maintains handoff state, and continues work across **real** installed agents (Antigravity/`agy`, Cursor Agent, Claude Code; Grok when present).

**Repeatable execution:** run `npm run test:e2e` (full) or `npm run test:e2e:auto` (S/R + F-15). Operator how-to: [qa-e2e-regression.md](qa-e2e-regression.md). The driver asserts Kalaga-side contracts (state, exit codes, refuse/stay); it does not golden-compare vendor prose.

## 2. Pass / fail rules

| Result | Definition |
|--------|------------|
| **Pass** | Observed behavior matches Expected result for the test ID |
| **Fail** | Deviation from Expected result; record evidence and open investigation |
| **Blocked** | Prerequisite missing (CLI not installed, not authenticated, no TTY); state reason |

Release acceptance requires: all applicable **S-** and **F-** tests Pass or Blocked with justification; zero open **Fail** without disposition.

## 3. Environment

| Requirement | Detail |
|-------------|--------|
| Runtime | Node.js ≥ 24 |
| Terminal | Interactive TTY |
| Project under test | Throwaway git repository |
| Isolation (optional) | `KALA_HOME` set to a dedicated directory |
| Agents | Minimum two of `agy`, `cursor-agent`, `claude` on `PATH` and authenticated; three preferred for S-CHAIN |

Record OS, Node version, agent versions/paths, and `kala` version (`package.json`) in the results file.

## 4. Preconditions

1. Working tree is a git repository.  
2. `kala init` has been run, or will be run as test S-01.  
3. Handoff state is seeded before chain tests (S-02) unless the test explicitly starts from blank state.  
4. Tester can interact with vendor trust / login prompts.

Seed commands (S-02):

```text
kala state goal "QA: multi-CLI handoff verification"
kala state next "confirm handoff continuity on next agent"
kala state done "seeded handoff state"
kala state note "system test seed"
```

---

## 5. Test cases

### 5.1 Setup and observability

| ID | Procedure | Expected result |
|----|-----------|-----------------|
| S-01 | `kala init` | `.kala/state.yaml` created; exit 0 |
| S-02 | Execute seed commands in §4 | Fields updated; `kala state` / `kala status` reflect them |
| S-03 | `kala agents` | Lists known keys; installed agents detectable |
| S-04 | `kala status` | Per-agent headroom; handoff summary; exact/est. labeled honestly |
| S-05 | `kala why` | Ranked taker list; exit 0 |

### 5.2 Command surface (non-interactive errors)

| ID | Procedure | Expected result |
|----|-----------|-----------------|
| S-10 | `kala help` / `kala --help` / `kala -h` | Usage text; exit 0 |
| S-11 | `kala run` and `kala switch` with no agent | Usage error; non-zero exit |
| S-12 | Unknown subcommand | Usage; exit 2 |
| S-13 | `kala resume` / `kala resume <agent>` with no captured session | Clear error; no hang |
| S-14 | `kala recover` with no recoverable limit | Clear message; exit 0 |
| S-15 | `kala trust` / `kala trust revoke --all` | List / clear grants; exit 0 |

### 5.3 Single-agent interactive

| ID | Procedure | Expected result |
|----|-----------|-----------------|
| F-01 | `kala run claude` (or first available agent) | Interactive session in the test repo |
| F-02 | Clean exit from agent (`/exit` or equivalent) | Clean-tier menu; Enter returns to shell without launching another agent |
| F-03 | `kala run cursor-agent` path via `kala run cursor` | Session starts; Cursor trust UX completed if prompted |
| F-04 | `kala run agy` | Session starts |

### 5.4 Cross-agent chain (acceptance path)

Execute when ≥2 agents are available. Preferred order: **claude → cursor → agy**.

| ID | Procedure | Expected result |
|----|-----------|-----------------|
| F-10 | From seeded state, run agent A until usage/session **limit**, or use `kala switch <B>` if limit cannot be reached | Limit: picker shown; selection launches B. Switch: B launches with handoff inject |
| F-11 | On agent B, confirm continuity | Agent continues seeded/updated goal; does not treat the task as a blank new project |
| F-12 | `kala status` / `kala state` after handoff | `owner` = B; `goal` / `done` / `next_step` consistent with work |
| F-13 | Hand off or switch to agent C (third CLI if installed) | C launches; continuity holds |
| F-14 | Live-ask at limit or switch (observe stderr) | Merge or soft-fail (“nothing usable”); handoff still proceeds |
| F-15 | `kala switch <X> --strict-state` with intentionally thin state | Refuse switch; X not launched |

### 5.5 Resume and recover

| ID | Procedure | Expected result |
|----|-----------|-----------------|
| F-20 | After `kala run` that captured a session id, `kala resume <agent>` | Same vendor conversation reopened when artifact exists and is fresh |
| F-21 | After a limit hit **outside** Kalaga, `kala recover` in the same repo | Limit/suspect handling; continuation picker or documented message |

### 5.6 Trust

| ID | Procedure | Expected result |
|----|-----------|-----------------|
| F-30 | Cold launch of Cursor via Kalaga in a directory without a Kalaga trust grant | Trust prompt (Kalaga and/or vendor) as designed; no invented silent `--trust` without grant where Kalaga controls the flag |
| F-31 | `kala trust` after affirmative grant | Grant listed for realpath; subsequent handoff reuses within TTL |

### 5.7 Regression guards

| ID | Procedure | Expected result |
|----|-----------|-----------------|
| R-01 | `npm test` in repository root | All checks pass |
| R-02 | `kala </dev/null` (non-TTY) | No auto-launch of an agent |
| R-03 | CI workflow `test` on default branch | Green, when remote is configured |
| R-04 | `npm run test:e2e:auto` | All S-* / R-01–R-03 / F-15 Pass |
| R-05 | `npm run test:e2e` on a workstation with ≥2 authenticated agents | All applicable F-* Pass or Blocked with disposition; zero Fail |

---

## 6. Evidence to capture

For each Fail or Blocked ID, record in [qa-results.md](qa-results.md):

- Test ID  
- Command(s)  
- Agent(s)  
- Exit code  
- Relevant stderr / UI observation  
- Disposition: defect / environment / vendor / deferred  

## 7. Exception handling

1. Log the failure under §6.  
2. Classify: **Kalaga defect** vs **environment** (PATH, auth) vs **vendor** (TTY, quota API, product bug).  
3. Kalaga defects block release until fixed or formally waived with owner sign-off.  
4. Environment/vendor Blocked items must list remediation (install CLI, re-auth, retry on TTY).

## 8. Sign-off

| Role | Name | Date | Verdict |
|------|------|------|---------|
| Tester | | | |
| Approver | | | pass / pass-with-waivers / fail |
