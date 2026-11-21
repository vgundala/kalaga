# Kalaga — Spec Process

## Roles

| Role | Owns | Does not |
|------|------|----------|
| **Technical lead (spec author)** | Requirements, approach, versioned specs, certification against those specs | Implementation commits (unless explicitly asked) |
| **Builder** | Code, tests, README updates called out in a locked spec | Changing locked requirement IDs without a new spec version |
| **Product owner (you)** | Priority, accept/reject certify verdicts, scope cuts | Writing implementation detail into chat instead of routing through a spec |

## Loop

1. **Specify** — TL writes or revises a versioned spec under `docs/specs/`. Status → `locked` when ready for handoff.
2. **Build** — Builder implements only against the locked version cited in the handoff note.
3. **Certify** — TL reviews the diff against that exact version, fills a certify record, verdict `pass` / `pass-with-waivers` / `fail`.
4. **Amend** — Gaps found in certify or mid-build become a new version (`vN+1`), never silent edits to a locked file.

## Versioning

- **File name:** `{ID}-{slug}.v{N}.md`  
  Example: `SEC-001-security-remediation.v1.md`
- **ID prefix:** `ARCH` architecture · `SEC` security · `FEAT` feature · `OPS` release/ops · `CERT` certification records
- **N** starts at 1. Breaking or additive requirement changes bump N. Typo-only fixes may patch in place **only while status is `draft`**.
- **Supersession:** Header of `vN` lists `Supersedes: …v{N-1}`; old file stays for audit trail. Index marks old version `superseded`.

## Spec status

| Status | Meaning |
|--------|---------|
| `draft` | TL still shaping; not for build |
| `locked` | Frozen for a build handoff |
| `in-build` | Builder assigned; cite version in PR/commit messages |
| `certify` | Implementation claimed done; awaiting TL review |
| `done` | Certify passed (or passed with recorded waivers) |
| `superseded` | Replaced by a newer version |

## Spec shape (required sections)

Every buildable spec includes:

1. **Header** — ID, version, status, date, supersedes, owner  
2. **Intent** — plain-English outcomes  
3. **In / out of scope**  
4. **Approach** — chosen design and rejected alternatives (short)  
5. **Requirements** — stable IDs (`T1`, `L2`, …) with acceptance checks  
6. **Touch map** — modules expected to change  
7. **Verification** — how builder and certifier prove done  
8. **Deferred** — explicit non-goals for this version  
9. **Handoff blurb** — one paragraph the builder can paste as their brief  

Certification records use `CERT-NNN-*.v1.md` and reference the exact spec file + version.

## Index

Canonical catalog: [`specs/INDEX.md`](specs/INDEX.md). Update it on every new version or status change.

## Builder rules (handoff contract)

- Implement requirement IDs; do not invent parallel behavior outside the spec.
- If blocked or ambiguous, stop and request a `vN+1` (or a waiver line in the certify record) — do not guess product intent.
- Cite the spec in the PR/commit body: `Implements SEC-001 v1 (T1–T10, L1–L2)`.
- No new runtime dependencies unless the locked spec allows them.

## Certify rules (TL contract)

- Diff against the locked version only; ignore wishlist items in chat history.
- Verdict table: each requirement ID → `met` / `partial` / `missing` / `waived` (waiver needs one-line reason).
- `fail` if any non-waived High security requirement is missing.
- After `done`, further work needs a new FEAT/SEC spec — do not reopen the closed version.
