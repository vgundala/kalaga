# CERT-001 — Certification of SEC-001 v1

| Field | Value |
|-------|-------|
| **ID** | CERT-001 |
| **Version** | v1 |
| **Certifies** | [`SEC-001-security-remediation.v1.md`](SEC-001-security-remediation.v1.md) (v1, locked) |
| **Built under** | ARCH-001 v1 |
| **Date** | 2026-11-21 |
| **Verdict** | `pass` — **pending TL sign-off** (builder-filled; PO/TL to confirm) |

---

## 1. Verdict table

`met` / `partial` / `missing` / `waived` — evidence in §2.

| ID | Verdict | Note |
|----|---------|------|
| T1 | met | `~/.kala/trust.yaml`, grants `{path(realpath), granted_at, expires_at}`, mode 0600 |
| T2 | met | `hasTrustGrant` realpath + expiry check (test: expired → false) |
| T3 | met | `recordTrustGrant` upsert, TTL from config (test: `trust_ttl_days: 42` honored) |
| T4 | met | `runAgent(agent, repoDir, prompt, trust)` — trustFlags appended only when `trust` |
| T5 | met | No unconditional trustFlags anywhere; `resolveTrust` gates every launch site |
| T6 | met | Option A `[y/N]` stderr prompt; non-TTY → no grant (safe default) |
| T7 | met | `resolveTrust`: existing grant → pass; else T6 prompt once before taker launch |
| T8 | met | `kala trust` / `kala trust revoke [path\|--all]` (test: revoke --all clears) |
| T9 | met | `trust_ttl_days:` parsed from `~/.kala/config.yaml` (test) |
| T10 | met | README §Security: path-scoped, explicit first grant, revoke |
| P1 | met | `handoffPrompt` removed; `handoffInject` is the single API |
| P2 | met | `sanitizeHandoffField` caps 1000/500/2000, strips C0+DEL, truncates `…` (test) |
| P3 | met | Default = pointer + next only; rich only with `inject_rich_prompt: true` (test) |
| P4 | met | `nextStepHint` on stderr before picker in `offerHandoff` |
| P5 | met | README: state = instruction surface, gitignore `.kala/`, no secrets |
| S1 | met | `lstat` symlink refuse; target untouched (test) |
| S2 | met | temp `.<name>.<pid>.tmp` + `renameSync`; no leftover temps (test) |
| S3 | met | `.kala` must be a real dir, not a symlink (test) |
| S4 | met | state file written mode 0600 (test) |
| L1 | met | `doRun`: empty tail → `null` hit → no picker |
| L2 | met | store-less recover: `--assume-limit` or interactive `[y/N]`; neither → no launch |
| L3 | met | `refreshState` persists ≤200-char limit note into `negative_constraints` (deduped) |
| L4 | met | `limitPatterns` code-owned in `src/config.ts`; config parser reads ceilings/TTL only |
| B1 | met | `resolveExecutable` → absolute or null (test) |
| B2 | met | per-process cache; grok config path stays absolute |
| B3 | met | `runAgent` spawns resolved path; missing binary → clear message, exit 127 |
| B4 | met | README: trust resolved binary at launch, no re-hash |
| C1 | met | `claudeProjectDir` shared helper (test) |
| C2 | met | cwd-metadata disambiguation (test: newer wrong-cwd file dropped); residual risk in README |
| C3 | met | ledger + launch both use `claudeProjectDir`/`claudeSessionFiles` |
| R1 | met | `tailBytes(file, USAGE_MAX_BYTES=8MiB)`; no unbounded `readFileSync` of session logs |
| R2 | met | cursor walk bounded by `CURSOR_META_SCAN_CAP=2000` (mtime cache: optional per spec — deferred) |
| R3 | met | grok: single `LIMIT 1` row query |
| M1 | met | `loadAgents` copies; builtin `AGENTS` untouched after mutation of copy (test) |
| M2 | met | config: `ceilings:` + `trust_ttl_days` + `inject_rich_prompt` only; no command-override keys |
| M3 | met | `$KALA_HOME` honored for config + trust; documented in README/§Notes |
| U1 | met | `OutputRing` deleted (grep-verified: no references); prompt helpers consolidated in `src/prompt.ts` |
| U2 | met | L3 note wired through `refreshState` (was a no-op spread) |
| U3 | met | README install: `chmod 755`, user-local only |

## 2. Evidence

- **Automated:** 19/19 pure checks pass (sanitize, inject, claude helper + disambiguation,
  symlink/atomic/0600 state, copy-on-load, binary resolve, honest scan, OutputRing removal,
  trust record/expiry/revoke, TTL config). Fixtures in job tmp, no network.
- **Manual smoke:** `kala agents`, `kala why`, `kala trust` (empty), unknown-agent error
  path, all clean with isolated `$KALA_HOME`.
- **Interactive checklist items** (cold cursor grant prompt, real limit-tail picker) require
  live vendor CLIs + real quota exhaustion — not reproducible in CI; covered by code review
  of `resolveTrust`/`doRun` paths above. Marked for PO sign-off.

## 3. Waivers

None.

## 4. Residuals (accepted in SEC-001 §6, unchanged)

`process.env` passed to children; agent can still edit state (sanitize bounds blast radius);
hostile PATH at first resolve; Claude sessions without `cwd` metadata cannot be disambiguated.

## 5. Sign-off

- [x] Builder: all non-waived requirements `met`; INDEX moved to `certify`
- [ ] TL/PO: confirm verdict `pass` (or amend) → INDEX `done`
