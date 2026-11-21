# Kalaga docs

| Doc | Role |
|-----|------|
| [`SPEC_PROCESS.md`](SPEC_PROCESS.md) | How specs are versioned, built, and certified |
| [`specs/INDEX.md`](specs/INDEX.md) | Catalog + build queue |
| [`specs/`](specs/) | Locked architecture, security, ops specs + CERT template |

**Operating model:** Technical lead writes versioned specs → builder implements a locked version → technical lead certifies against that exact version. Implementation chat is not the source of truth; the locked file is.
