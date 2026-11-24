# OPS-002 — CI for `npm test`

| Field | Value |
|-------|-------|
| **ID** | OPS-002 |
| **Version** | v1 |
| **Status** | `done` (CERT-007 pass-with-waivers) |
| **Date** | 2026-11-22 |
| **Supersedes** | draft of same file |
| **Owner** | Technical lead |
| **Depends on** | OPS-001 v2 (done); FEAT-003 v1 (done); **OPS-003 v1 `done`** |
| **Build priority** | 2 (after OPS-003 cross-platform) |

---

## 1. Intent

Run the existing zero-dependency suite on every push and pull request so a
broken tree is caught without a local `npm test`.

**Success:** a green CI check that executes `npm test` (`node tests/run.ts`)
on Node 24, with no secrets and no new runtime dependencies.

---

## 2. In / out of scope

**In:**

- One in-repo CI workflow (GitHub Actions — see §3.1)
- Node **24** matching `engines.node: ">=24"`
- `npm test` as the sole required job step after checkout / setup-node
- Short README note that CI runs the suite (badge optional)
- Patch version bump to **0.5.1** + CHANGELOG line

**Out:**

- OS matrix (Windows / macOS)
- Live vendor CLI / quota tests
- Coverage gates, lint-only jobs, Dependabot, CodeQL
- `npm publish` / release automation
- Required-status-check admin policy (repo settings — PO/admin)
- Adding a lockfile or any `dependencies` / `devDependencies`

---

## 3. Approach

### 3.1 Forge

`kalaga/` is its own git repo (`main`, currently **no remote**). Ship a
**GitHub Actions** workflow so the first push to GitHub works without a rewrite.

If the remote later lands on another forge, keep the **same job semantics**
(checkout → Node 24 → `npm test`) under that forge’s config; do not invent a
second parallel CI in this OPS.

### 3.2 Job shape

```
checkout
setup-node @ 24
npm test          # → node tests/run.ts
```

- **No `npm install` / `npm ci`.** `package.json` has zero `dependencies` and
  no lockfile. Installing would be noise and a footgun.
- Fail the job if `npm test` exits non-zero.
- Working directory = repository root (where `package.json` lives).

### 3.3 Triggers

- `push` to `main` (and `master` if ever renamed — include both or the actual
  default branch name)
- `pull_request` targeting `main`

### 3.4 Workflow file (required content)

Path: `.github/workflows/test.yml`

Minimum behavior (builder may use equivalent Actions syntax):

| Aspect | Requirement |
|--------|-------------|
| `runs-on` | `ubuntu-latest` |
| Node | `24` via `actions/setup-node` (or pin a current `24.x`) |
| Checkout | `actions/checkout` |
| Test | `run: npm test` |
| Permissions | least privilege — `contents: read` is enough |

Reference skeleton (normative intent, not sacred whitespace):

```yaml
name: test
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - run: npm test
```

### 3.5 Rejected alternatives

| Alternative | Why rejected |
|-------------|--------------|
| `npm install` “just in case” | Zero deps; violates ARCH A6 spirit and slows CI |
| Node 22 LTS | Below `engines.node` |
| Multi-OS matrix | Deferred; ubuntu is enough for this stdlib suite |
| Badge-only without a job | Not CI |

---

## 4. Requirements

| ID | Requirement |
|----|-------------|
| C1 | Add `.github/workflows/test.yml` (or equivalent path under `.github/workflows/`) implementing §3.4. |
| C2 | Triggers on push to default/`main` and on pull requests targeting it. |
| C3 | Job uses Node **24** and runs `npm test` with no install step. |
| C4 | Job fails when tests fail; no secrets / no `env` secrets blocks. |
| C5 | README: one short “CI” / Testing note that PRs run `npm test` on Node 24. Status badge optional. |
| C6 | `package.json` version **0.5.1**; CHANGELOG entry citing OPS-002. |
| C7 | Confirm suite still passes locally: `npm test` green before marking certify. |
| C8 | No new runtime or devDependencies; no lockfile added by this OPS. |

---

## 5. Touch map

| Path | Change |
|------|--------|
| `.github/workflows/test.yml` | **New** — CI workflow |
| `README.md` | Testing / CI note |
| `CHANGELOG.md` | 0.5.1 |
| `package.json` | `0.5.1` |

No `src/` changes expected.

---

## 6. Verification

### Local (builder)

- [ ] `npm test` → all pass  
- [ ] Workflow YAML validates mentally against §3.4 (Node 24, no install)  
- [ ] `package.json` has no `dependencies` / `devDependencies`

### After remote exists (certify / PO)

- [ ] Push or PR shows a `test` check  
- [ ] Check runs `npm test` and is green on a known-good commit  

If no remote yet at certify time: TL may **pass** on file review + local
`npm test`, with residual “first green run deferred until remote is connected.”

### Certify

INDEX → `certify`; next CERT references **OPS-002 v1**.

---

## 7. Deferred

| Item | Why |
|------|-----|
| Windows / macOS matrix | Suite is Node stdlib; ubuntu covers the contract |
| Action version pinning to SHAs | Nice hardening; not required for v1 |
| Required status checks | Repo admin setting |
| Caching | Nothing to cache without install |
| Coverage / lint job | Separate OPS if wanted |

---

## 8. Done when

- CERT pass (or pass-with-waivers only for “no remote yet”) against this file  
- Workflow present; version 0.5.1; README notes CI  
- Local `npm test` green  

---

