# FEAT-003 — Handoff State Protocol + Seam Enrichment

| Field | Value |
|-------|-------|
| **ID** | FEAT-003 |
| **Version** | v1 |
| **Status** | `done` (CERT-005 pass) |
| **Date** | 2026-11-22 |
| **Supersedes** | — |
| **Owner** | Technical lead |
| **Depends on** | ARCH-001 v1; SEC-001 v1 (done); FEAT-001 v1 (done); FEAT-002 v1 (`done` preferred — may build after CERT-004) |
| **Build priority** | 2 (after FEAT-002 certify) |

---

## 1. Intent

Cross-agent handoff (e.g. agy → cursor) currently injects a short pointer plus
`next_step`. If the dying agent never kept `.kala/state.yaml` current, the
taker invents a new direction.

**Outcome:** `.kala/state.yaml` is an explicit, tool-agnostic handoff protocol
that every CLI is instructed to maintain. At limit / switch seams, Kalaga
**asks the dying agent** (print mode) to emit a structured update before the
picker launches the next agent. The taker receives enough grounded context to
continue — not a blank slate.

FEAT-002 (resume) keeps *same-agent* memory. This FEAT keeps *cross-agent*
continuity.

---

## 2. In / out of scope

**In:**

- Schema: add `done` (what landed); tighten meaning of `goal` / `next_step` /
  `notes` / `negative_constraints`
- Standing orders in launch + handoff prompts (“update state before you stop”)
- Default handoff inject upgraded to a **protocol inject** (amends SEC-001 P3
  for handoff launches only — still sanitized + capped)
- Live-ask at limit-tier handoff and at `kala switch` (print-mode → parse →
  `mergeState`, `_source: 'live-ask'`)
- Thin-state warning before cross-agent launch
- `kala state done <text>` (append bullet)
- README protocol section; CHANGELOG; package **0.5.0**
- Tests: thin-state detector, protocol inject shape, live-ask parse/merge

**Out:**

- Model / context-window ranking (explicitly rejected)
- Scraping full vendor transcripts into state
- Chained post-exit loops
- Requiring live-ask success to hand off (fail soft)
- Encrypting state; committing `.kala/` to git

---

## 3. Approach

### 3.1 Problem → design

| Failure | Fix |
|---------|-----|
| File empty / stale | Live-ask at seam + standing orders while working |
| Taker ignores file | Protocol inject names fields + requires “read state first” |
| Only `next_step` in argv | Protocol inject includes goal + done + next + negatives (capped) |
| User can’t fix manually | `kala state done` / existing goal/next/note/neg |

### 3.2 Protocol schema (`.kala/state.yaml`)

| Field | Type | Meaning | Who writes |
|-------|------|---------|------------|
| `goal` | string | Why this work exists | human / agent / live-ask |
| `done` | string[] | Bullets of what already landed (code, specs, decisions) | agent / live-ask / `kala state done` |
| `next_step` | string | **One** concrete next action | agent / live-ask / human |
| `negative_constraints` | string[] | Do-not-repeat failures | agent / limit note / human |
| `notes` | string | Short “where things stand” | agent / git seed / live-ask |
| `modified_files` | string[] | Git porcelain (Kalaga) | tailer |
| `status` / `owner` / `branch` / `updated` | existing | unchanged | existing |
| `sessions` | map | FEAT-002 | capture path |

**Blank defaults:**

- `done: []`
- Keep existing blank `goal` / `next_step` strings so thin-state detection works.

**Sanitize caps (extend SEC-001 P2):**

| Field | Max |
|-------|-----|
| `goal` | 1000 (unchanged) |
| `next_step` | 500 (unchanged) |
| `notes` | 2000 (unchanged) |
| each `done[]` item | 300; max **12** items (drop oldest or refuse append with message — prefer drop oldest on live-ask merge) |
| each `negative_constraints[]` item | 200; max **20** (existing limit-note behavior stays) |

### 3.3 Standing orders (every interactive launch that gets an inject)

Append a short fixed block (not user-controlled) to handoff / non-fresh
launches:

```text
Maintain .kala/state.yaml as you work. Before you stop or hit a limit, update:
goal, done (bullets of what landed), next_step (one action), notes, and
negative_constraints (failures not to repeat). The next agent will only see
that file plus a short inject.
```

Fresh “not captured” first launches: still no full handoff inject, but print
the standing orders alone once on stderr **or** pass a minimal first-run
prompt containing only standing orders + “set goal/next_step” — builder
choice; document in PR. Prefer: stderr standing orders on first run so we
don’t burn a confusing argv prompt.

### 3.4 Protocol inject (amends SEC-001 P3 for handoff)

**Handoff launches** (`offerHandoff`, clean-tier number handoff, `kala switch`,
and any launch that currently uses `handoffInject`):

Default inject becomes **protocol mode** (always on for these paths):

1. Pointer: read `.kala/state.yaml` before acting  
2. `Goal:` (sanitized)  
3. `Done:` up to N bullets (sanitized)  
4. `Next step:`  
5. `Avoid:` negatives if any  
6. Standing orders one-liner (“update state before you stop”)

`inject_rich_prompt: true` may still add `notes` + `modified_files` (previous
rich behavior).

`inject_rich_prompt: false` / absent → protocol inject above (**not** the old
pointer+next-only). This is an intentional product amendment of SEC-001 P3 for
continuity; security caps/sanitize remain.

**Resume (FEAT-002):** still **no** handoff inject (conversation has context).
Standing orders via stderr optional only.

### 3.5 Thin-state warning

Before a **cross-agent** handoff launch (picker chose a different agent than
`dead` / owner, or `kala switch` to another key), if state is thin, print on
stderr and continue (do not block unless `--strict-state`):

Thin when **any** of:

- `goal` starts with `not captured` or length &lt; 8  
- `done` is empty **and** `notes` length &lt; 40  
- `next_step` is the blank default (`read the repo, then ask the user…`)

```text
kalaga: handoff state looks thin — taker may drift. Run live-ask, or: kala state …
```

Optional v1 flag: `kala switch <agent> --strict-state` aborts if thin after
live-ask attempt.

### 3.6 Live-ask (seam enrichment)

**When:**

1. Entering `offerHandoff(deadKey)` when `deadKey` is set (limit / suspect→y /
   recover) — **before** picker  
2. `kala switch <agent>` — before launch, ask **current owner** (or most recent
   session agent) if installed and distinct; if no owner, skip live-ask

**How:**

1. Resolve dead/owner agent binary + `headless` flags already in config  
2. Spawn **non-interactive** print-mode (stdio piped, not TTY inherit) with a
   fixed prompt asking for a **YAML fragment only** on stdout, e.g.:

   ```text
   Update the Kalaga handoff. Reply with ONLY a YAML block (no markdown fences)
   containing keys: goal, done (list of short bullets), next_step, notes,
   negative_constraints (list). Summarize what was accomplished and the single
   next action. Do not invent files you did not touch.
   ```

3. Timeout **45s** (configurable later); kill on timeout  
4. Parse YAML subset (reuse/extend naive parser); sanitize; `mergeState(..., 'live-ask')`  
5. On failure/timeout/empty: stderr warn `kalaga: live-ask failed — using existing state`; continue  

**Do not** use TTY inherit for live-ask (would block the handoff UX).  
**Do not** fail the handoff if live-ask fails.

Budget honesty: live-ask spends a little of the dying agent’s remaining
quota; acceptable and documented in README.

### 3.7 Manual edits

| Command | Effect |
|---------|--------|
| `kala state done <text>` | Append one bullet to `done` |
| existing goal/next/note/neg | unchanged |

`kala status` shows `done` count + first bullet truncated.

### 3.8 Rejected alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Scrape full session logs into `notes` | Secrets, noise, unbounded |
| Auto-pick “best” model by context size | Fake precision |
| Block all handoffs until state is rich | Friction; live-ask + warn is enough |
| Second file (e.g. `.kala/PROGRESS.md`) | Split brain; one protocol |

---

## 4. Requirements

| ID | Requirement |
|----|-------------|
| H1 | Add `done: string[]` to `HandoffState`; blank `[]`; load/save via YAML list (same style as `modified_files`). |
| H2 | Sanitize/caps per §3.2; `sanitizeHandoffField` reused; list helpers for `done`. |
| H3 | Protocol inject (§3.4) is the default for all handoffInject call sites used for cross-agent / switch handoff. Resume stays inject-free. |
| H4 | Standing orders included in protocol inject; first-run behavior per §3.3. |
| H5 | `isThinState(s): boolean` pure; warning on cross-agent handoff / switch (§3.5). |
| H6 | Live-ask before `offerHandoff` when `deadKey` set; merge on success; fail soft (§3.6). |
| H7 | Live-ask on `kala switch` when an owner/prior agent can be asked (§3.6). |
| H8 | Live-ask uses `headless` argv + piped stdio + timeout; never `shell: true`. |
| H9 | `kala state done <text>`; `kala status` surfaces done summary. |
| H10 | README: protocol field table, live-ask note, thin-state warning, “agents must update state”. |
| H11 | Tests: thin-state; protocol inject contains Goal/Done/Next; live-ask parser accepts a fixture YAML fragment; done append. |
| H12 | Version **0.5.0** + CHANGELOG citing FEAT-003. |
| H13 | Document SEC-001 P3 amendment: handoff default inject is protocol mode, still sanitized. |

---

## 5. Touch map

| Path | Change |
|------|--------|
| `src/state/state.ts` | `done`; load/save; maybe `isThinState` |
| `src/prompt.ts` | protocol inject; caps for `done`; standing orders string |
| `src/launch.ts` or **new** `src/liveask.ts` | print-mode ask + parse |
| `src/index.ts` | wire live-ask; thin warn; `state done`; status line |
| `src/config.ts` | headless already present — use it |
| `README.md` / `CHANGELOG.md` / `package.json` | docs + 0.5.0 |
| `tests/run.ts` | H11 |

**Constraint:** ARCH A4/A5/A6; no new runtime deps; SEC sanitize/symlink/atomic unchanged.

---

## 6. Verification

### Automated

- `isThinState(blankState)` → true  
- Protocol inject includes `Goal:` and `Done:` and `Next step:`  
- Parse fixture live-ask YAML → merge fields  
- `done` append + cap

### Manual

- [ ] Force thin state → switch/hand off → stderr thin warning  
- [ ] Live-ask against a stub/`claude -p` (or mocked) updates `done`/`next_step`  
- [ ] Live-ask timeout → handoff still proceeds  
- [ ] Cursor (or second agent) after handoff cites `done` / continues `next_step` without inventing a new goal  
- [ ] `kala state done "shipped X"` shows in status + file  

### Certify

INDEX → `certify`; next CERT references **FEAT-003 v1**.

---

## 7. Deferred

| Item | Why |
|------|-----|
| `--strict-state` default-on | Too sharp for v1; optional flag enough |
| Streaming live-ask / progress UI | Nice; not required |
| Agent-written file via tools instead of stdout YAML | Harder to constrain; stdout parse is enough |
| Auto live-ask on clean-exit handoff | User already chose; optional later |
| Embedding FEAT-002 session ids in inject | Out of scope; file has `sessions` |

---

## 8. Done when

- CERT pass against this file  
- Cross-agent handoff shows protocol inject + non-empty `done` after a successful live-ask in manual test  
- Thin warning observed on blank state  
- Tests green; version 0.5.0  

---

## 9. Handoff blurb (paste to builder)

> Implement **FEAT-003 v1** after FEAT-002 is `done` (or in parallel only if
> state `sessions` already landed). Add `done[]` to handoff state; protocol
> inject (goal/done/next/avoid + standing orders) as default for handoff
> launches; live-ask print-mode before limit handoff and switch (fail soft,
> 45s timeout, merge `_source: 'live-ask'`); thin-state warning; `kala state
> done`. Keep sanitize/caps. No new deps. Bump 0.5.0. Mark INDEX `certify`
> and open CERT when finished.
