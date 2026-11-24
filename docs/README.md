# Kalaga docs

| Doc | Role |
|-----|------|
| [`../README.md`](../README.md) | Project overview, install, commands |
| [`../SECURITY.md`](../SECURITY.md) | Trust model, guarantees, residual risks |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | How to change the tree safely |
| [`guides/what-is-kalaga.md`](guides/what-is-kalaga.md) | User explainer — multi-CLI subscriptions |
| [`papers/kalaga-multi-cli-handoff.md`](papers/kalaga-multi-cli-handoff.md) | Technical paper draft + competitive analysis |
| [`SPEC_PROCESS.md`](SPEC_PROCESS.md) | How specs are versioned, built, and certified |
| [`specs/INDEX.md`](specs/INDEX.md) | Catalog + build queue |
| [`specs/`](specs/) | Architecture, security, ops, feature specs + CERT records |

**Operating model:** Technical lead writes versioned specs → builder implements a locked version → technical lead certifies against that exact version. Implementation chat is not the source of truth; the locked file is.
