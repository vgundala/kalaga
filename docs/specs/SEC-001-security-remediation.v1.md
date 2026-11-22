# SEC-001 — Security Remediation

| Field | Value |
|-------|-------|
| **ID** | SEC-001 |
| **Version** | v1 |
| **Status** | `done` (CERT-001 pass-with-waivers) |
| **Date** | 2026-11-21 |
| **Supersedes** | Informal `docs/SECURITY_REMEDIATION_SPEC.md` (moved here) |
| **Owner** | Technical lead |
| **Depends on** | ARCH-001 v1 |
| **Build priority** | 1 (first handoff) |

---

## 1. Intent

Harden Kalaga against the security audit while preserving seamless cross-agent handoff.

1. **Trust propagates; it does not invent.** First explicit grant for a project path is recorded once; later handoffs to trust-capable CLIs reuse it. Cold start without a grant does not pass vendor trust-skip flags.
2. **Handoff state cannot silently escalate.** `.kala/state.yaml` is untrusted when building the next agent’s prompt. Writes never follow a symlink to an unrelated file.
3. **Limit detection is honest.** Empty session stores are not limit hits. Store-less recover requires an explicit user assumption.
4. **Process and path hygiene stay aligned with ARCH-001.** Absolute or once-resolved binaries, safer Claude project lookup, atomic state writes, bounded store reads, config copy-on-load.

Success: every requirement ID below is `met` or explicitly `waived` in a CERT record; manual verification checklist complete.

---

## 2. In / out of scope

**In:** Trust grants, prompt sanitize, state I/O, limit honesty, binary resolve, Claude dir helper, bounded reads, config mutation fix, dead-code cleanup that clarifies threat model, README security notes.

**Out:** New agents, smart routing, live-ask, npm dependencies, encrypting state, multi-user hardening, config-driven argv/`limitPatterns`, vendor trust-DB sync, full binary hash pinning.

---

## 3. Approach

### 3.1 Trust (product-critical)

Audit finding of “always `--trust`” is reframed:

| Approach | Verdict |
|----------|---------|
| Remove `--trust` entirely | Rejected — breaks seamless handoff after user already trusted the folder |
| Always pass `--trust` | Rejected — invents trust on cold start in hostile clones |
| **Kalaga path grant + conditional `trustFlags`** | **Chosen** — one explicit grant (Option A prompt), then propagate |

Grant store: `~/.kala/trust.yaml` (under `$KALA_HOME`). Key = `fs.realpathSync(repoDir)`. TTL default 30 days.

**Option A (required in v1):** Before cold launch of a trust-capable agent, stderr prompt `Trust this directory for Kalaga handoffs? [y/N]`. `y` → record grant + pass flags; otherwise launch without flags.

### 3.2 Other choices

| Topic | Choice | Rejected |
|-------|--------|----------|
| Prompt injection | Sanitize + caps; keep short inject | Full rich prompt by default |
| Symlink state | Refuse write | Silent follow; auto `--force` |
| Empty store on `run` | No hit | Synthetic `no-store` hit |
| agy `recover` | `--assume-limit` or `[y/N]` | Silent trust |
| Claude path key | Shared helper + disambiguation / document vendor limit | Naive dash-escape only |
| Config | Shallow copy agents; ceilings + `trust_ttl_days` only | In-place mutate `AGENTS`; config-defined binaries |

### 3.3 Implementation order (builder sequence)

1. L1–L2, M1  
2. S1–S4  
3. T1–T10  
4. P1–P5  
5. B1–B4, C1–C3, R1–R3  
6. U1–U3 + README  

Keep `kala status` / `kala run` usable after each step.

---

## 4. Requirements

### 4.1 Trust grant store and launch wiring

**Outcome:** `trustFlags` only when a valid grant exists (or mid-prompt Option A just recorded one).

| ID | Requirement |
|----|-------------|
| T1 | `~/.kala/trust.yaml` (or json) with grants `{ path, granted_at, expires_at }[]`; `path` = realpath. |
| T2 | `hasTrustGrant(repoDir): boolean` — realpath; ignore/prune expired. |
| T3 | `recordTrustGrant(repoDir): void` — upsert with configured TTL (default 30d). |
| T4 | `runAgent` takes trust intent; append `trustFlags` only when trust should apply. |
| T5 | Remove unconditional `trustFlags` on every launch. |
| T6 | Option A cold-start prompt for trust-capable agents (see §3.1). |
| T7 | In-process handoff: if grant exists, pass trust; else run T6 once before taker launch. |
| T8 | `kala trust status` and `kala trust revoke` (optional `--all`). |
| T9 | Optional `trust_ttl_days` in `~/.kala/config.yaml`. |
| T10 | README documents path-scoped, explicit first grant. |

**Acceptance:** No grant → no `--trust` on cursor cold start until `y`. After grant → handoff/switch passes `--trust`. Other realpath → prompt again. Expired → absent.

---

### 4.2 Handoff prompt / untrusted state

| ID | Requirement |
|----|-------------|
| P1 | Single prompt API; remove or merge duplicate `handoffPrompt` / `injectPrompt`. |
| P2 | Sanitize: strip ASCII controls except `\n` `\t`; caps — `next_step` ≤ 500, `goal` ≤ 1000, `notes` ≤ 2000; truncate with `…`. |
| P3 | Default inject = pointer + next step only; rich inject only if config `inject_rich_prompt: true`. |
| P4 | On recover after limit match, print truncated `next_step` on stderr before picker (non-blocking). |
| P5 | README: state is instruction surface; suggest gitignoring `.kala/`; no secrets in state. |

**Acceptance:** Control chars removed; oversize truncated; `sanitizeHandoffField(s, max)` unit-testable.

---

### 4.3 Safe state I/O

| ID | Requirement |
|----|-------------|
| S1 | If state path is symlink (`lstat`), refuse write with clear error (default). No silent follow. |
| S2 | Write temp in same dir then `renameSync` onto final name. |
| S3 | `.kala` must be a real directory, not a symlink, before write. |
| S4 | Create state file mode `0o600` when the platform supports it. |

**Acceptance:** Symlink target unchanged after refused write; rename-replace leaves no torn final as sole copy.

---

### 4.4 Honest limit detection

| ID | Requirement |
|----|-------------|
| L1 | Remove synthetic `no-store` hit in `doRun`. Empty tail → no picker. |
| L2 | Store-less `kala recover`: require `--assume-limit` or interactive `[y/N]`. |
| L3 | On signature match, persist a short limit note (≤ 200 chars) into state (`notes` or dedicated field) — fix no-op `negative_constraints` spread. |
| L4 | `limitPatterns` stay code-owned; no user regex from config. |

**Acceptance:** Clean `kala run agy` → no picker. Signature in Claude tail → picker. Bare agy recover without assume/confirm → no launch.

---

### 4.5 Binary resolution

| ID | Requirement |
|----|-------------|
| B1 | `resolveExecutable(cmd)` → absolute executable or null. |
| B2 | Resolve at load/first use; grok stays absolute. |
| B3 | Spawn resolved path; fail clearly if missing. |
| B4 | README: trust resolved binary at launch; no re-hash. |

**Acceptance:** Successful spawn argv[0] is absolute when resolution succeeded.

---

### 4.6 Claude project-dir encoding

| ID | Requirement |
|----|-------------|
| C1 | Replace naive-only dash-escape with collision-aware strategy aligned to Claude’s on-disk layout. |
| C2 | If dash-escape is required by vendor layout: disambiguate via session cwd metadata when present; else document residual risk. |
| C3 | One shared `claudeProjectDir(repoDir)` used by ledger + launch. |

**Acceptance:** Distinct realpaths do not silently share the wrong jsonl when metadata can distinguish; else README notes vendor limitation.

---

### 4.7 Bound store reads

| ID | Requirement |
|----|-------------|
| R1 | Claude usage: capped/tail read (e.g. `USAGE_MAX_BYTES` ≤ 8 MiB), not unbounded `readFileSync`. |
| R2 | Cursor walk: bounded or early-stop; optional mtime-validated cache under `~/.kala/`. |
| R3 | Grok remains single-row query. |

**Acceptance:** Huge jsonl does not OOM `kala status`.

---

### 4.8 Config mutation

| ID | Requirement |
|----|-------------|
| M1 | `loadAgents()` returns shallow copies; never mutate module `AGENTS` in place. |
| M2 | Config: ceilings + `trust_ttl_days` (+ optional `inject_rich_prompt`). Ignore command-override-looking keys. |
| M3 | `$KALA_HOME` for config + trust; documented. |

---

### 4.9 Cleanup

| ID | Requirement |
|----|-------------|
| U1 | Delete or use `OutputRing`; consolidate prompt helpers. |
| U2 | L3 wired through `refreshState`. |
| U3 | Document install `chmod 755` / user-local only. |

---

## 5. Touch map

| Path | Change |
|------|--------|
| `src/config.ts` | Copy-on-load; TTL parse; resolveExecutable |
| `src/launch.ts` | Conditional trust; absolute bin; Claude helper; bounds |
| `src/ledger.ts` | Bounded Claude read; Claude helper |
| `src/state/state.ts` | Symlink refuse; atomic write; 0600 |
| `src/index.ts` | Trust UX; L1–L2; trust subcommands; single inject |
| `src/trap.ts` | Minimal; support L3 note if needed |
| `README.md` | Trust, gitignore, residuals |
| **New** `src/trust.ts` | Grant CRUD |
| **New** `src/prompt.ts` | Optional; sanitize + inject |

**Constraint:** No new npm dependencies (ARCH-001 A6).

---

## 6. Threat model (post-fix)

| Threat | Mitigation |
|--------|------------|
| Untrusted repo auto-trusted | T1–T7 |
| State → prompt injection | P1–P5 |
| Symlink overwrite | S1–S3 |
| Accidental second-agent spend | L1–L2 |
| PATH confusion | B1–B3 |
| Claude path collision | C1–C3 |
| Config redefines binary | M2 |
| Shell injection | Keep ARCH A4; no regression |

**Accepted residual:** full `process.env` to children; agent can still edit state (sanitize limits blast radius); hostile PATH at first resolve.

---

## 7. Verification

### Manual (required for certify)

- [ ] Cold cursor, no grant: no `--trust` until `y`  
- [ ] After grant: handoff/switch to cursor includes `--trust`  
- [ ] Symlink state path → write refused  
- [ ] `kala run agy` clean exit → no picker  
- [ ] Limit phrase in Claude tail → picker  
- [ ] Control-char / oversized `next_step` → sanitized inject  
- [ ] `loadAgents` twice does not permanently corrupt builtin ceilings  

### Automated (preferred)

Pure tests for sanitize, trust TTL, Claude helper, atomic/symlink state — fixtures under `testdata/`, no network.

### Certify artifact

Builder sets SEC-001 status to `certify` in INDEX and opens CERT-001 (or next free CERT id) referencing **SEC-001 v1** exactly.

---

## 8. Deferred

| Item | Why |
|------|-----|
| Binary hash pinning | UX; B1–B3 enough |
| Vendor trust DB sync | No stable API |
| Encrypt state | Wrong layer |
| Multi-user host hardening | Single-user tool |
| Config `limitPatterns` / argv | Attack surface |
| Live-ask | Product FEAT, not this SEC |

---

## 9. Done when

- CERT record verdict `pass` or `pass-with-waivers` against **this file (v1)**  
- INDEX marks SEC-001 v1 `done`  
- No unconditional `--trust` on cold-start path  
- README trust section matches §3.1  

---

## 10. Handoff blurb (paste to builder)

> Implement **SEC-001 v1** under **ARCH-001 v1**. Follow §3.3 order. Requirement IDs T/P/S/L/B/C/R/M/U are the acceptance surface. Trust = Option A path grants, not always-on `--trust`. No new dependencies. When finished, mark INDEX `certify` and request TL certification against SEC-001 v1 — do not bump the version yourself; request v2 if blocked.
