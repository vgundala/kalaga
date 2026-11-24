# Contributing to Kalaga

Thank you for improving Kalaga. The project is intentionally small: a zero-dependency Node harness that must stay auditable for people who run it from source or point agents at the tree.

Maintenance is **best-effort** (no SLA). Bug reports are welcome. Feature ideas are fine as issues; if you need something sooner, fork and build it — pull requests that contribute improvements back are appreciated.

## Before you change code

1. Read [SECURITY.md](SECURITY.md).
2. For behavioral or security-sensitive changes, skim [ARCH-001](docs/specs/ARCH-001-product-architecture.v1.md) and [SEC-001](docs/specs/SEC-001-security-remediation.v1.md) so you do not violate product invariants.
3. Do not add runtime `dependencies` or `devDependencies` without a clear architecture reason (Kalaga is zero-dep by design).

You do **not** need to follow the internal spec → CERT workflow to send a PR. That process is optional for maintainers ([docs/SPEC_PROCESS.md](docs/SPEC_PROCESS.md); historical certs in [docs/specs/history/](docs/specs/history/)).

## Development

```sh
# Node ≥ 24
npm test
node bin/kala status
```

No install step is required. There is no lockfile by design.

## Hard rules (do not regress)

- Spawn agents and git with **argv arrays only** — never `shell: true`.
- Pass vendor trust-skip flags **only** when a Kalaga path grant exists.
- Sanitize every field that becomes prompt inject text; allowlist every value that becomes a resume session id.
- Refuse symlinked `.kala` / `state.yaml` on write; keep atomic `0600` writes.
- Keep interactive launches on `stdio: 'inherit'`; do not pipe the live TUI for limit detection.
- User confirms interactive takers (picker) — no silent auto-handoff.

## Pull requests

- Keep diffs surgical; match existing style.
- Add or extend cases in `tests/run.ts` for security-sensitive behavior.
- Update `CHANGELOG.md` under an Unreleased or version section when user-visible.
- Run `npm test` and ensure it stays green.

## Conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
