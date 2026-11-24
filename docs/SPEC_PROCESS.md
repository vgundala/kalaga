# Kalaga — Spec process (optional, maintainers)

This describes an **optional** internal workflow used while building Kalaga
with locked specs and certify records. **Contributors and users do not need
it.** Public entry points: [README](../README.md), [CONTRIBUTING](../CONTRIBUTING.md),
[SECURITY](../SECURITY.md).

Living requirements: [`specs/INDEX.md`](specs/INDEX.md).  
Historical certify records: [`specs/history/`](specs/history/).

## Roles (when using this workflow)

| Role | Owns | Does not |
|------|------|----------|
| **Technical lead (spec author)** | Requirements, approach, versioned specs, certification | Implementation commits (unless explicitly asked) |
| **Builder** | Code, tests, README updates called out in a locked spec | Changing locked requirement IDs without a new spec version |
| **Product owner** | Priority, accept/reject certify verdicts, scope cuts | Replacing locked specs with chat-only requirements |

## Loop

1. **Specify** — Write or revise a versioned spec under `docs/specs/`. Status → `locked` when ready to build.
2. **Build** — Implement only against that locked version.
3. **Certify** — Review the diff against that exact version; file a record under `docs/specs/history/`.
4. **Amend** — Gaps become a new version (`vN+1`), never silent edits to a locked file.

## Versioning

- **File name:** `{ID}-{slug}.v{N}.md`  
  Example: `SEC-001-security-remediation.v1.md`
- **ID prefix:** `ARCH` · `SEC` · `FEAT` · `OPS` (requirements) · `CERT` (history only)
- **N** starts at 1. Breaking or additive requirement changes bump N.
- **Supersession:** Header of `vN` lists `Supersedes: …v{N-1}`; index marks the old version `superseded`.

## Spec status

| Status | Meaning |
|--------|---------|
| `draft` | Still shaping; not for build |
| `locked` | Frozen for a build |
| `in-build` | Implementation in progress |
| `certify` | Claimed done; awaiting review |
| `done` | Certified (or certified with recorded waivers) |
| `superseded` | Replaced by a newer version |

## Spec shape

Buildable specs typically include: header, intent, in/out of scope, approach,
numbered requirements, touch map, verification, deferred. Prefer clear
requirement IDs over process paste blocks.

Certification records: `docs/specs/history/CERT-NNN-*.md`, referencing the
exact spec file + version.

## Builder rules

- Implement requirement IDs; do not invent parallel behavior outside the spec.
- If blocked, request a `vN+1` or a recorded waiver — do not guess product intent.
- No new runtime dependencies unless the locked spec allows them.

## Certify rules

- Diff against the locked version only.
- Each requirement ID → `met` / `partial` / `missing` / `waived` (waiver needs a one-line reason).
- `fail` if any non-waived High security requirement is missing.
- After `done`, further work needs a new FEAT/SEC/OPS version.
