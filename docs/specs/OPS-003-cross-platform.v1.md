# OPS-003 — Cross-platform (Windows / macOS verify + PATH fixes)

| Field | Value |
|-------|-------|
| **ID** | OPS-003 |
| **Version** | v1 |
| **Status** | `done` (CERT-006 pass-with-waivers) |
| **Date** | 2026-11-22 |
| **Supersedes** | — |
| **Owner** | Technical lead |
| **Depends on** | ARCH-001 v1; FEAT-003 v1 (done) |
| **Build priority** | 1 (ahead of OPS-002 CI) |
| **Blocks** | OPS-002 v1 (CI stays locked but **queued after** this certify) |

---

## 1. Intent

Kalaga must run on **Linux, macOS, and Windows** for users who already run
agy / cursor / grok / claude via Git Bash and/or PowerShell.

Vendor CLIs already work on Windows in those shells. This OPS fixes Kalaga’s
Unix-biased process/PATH assumptions, documents install per OS, and records a
smoke checklist. It does **not** add installers or CI matrices.

**Success:** `kala status`, `kala run` / handoff, and `kala resume` (when a
session exists) work on Windows (Git Bash **and** PowerShell) and macOS with
Node ≥ 24, without requiring WSL.

---

## 2. In / out of scope

**In:**

- Use `path.delimiter` (not hardcoded `:`) for PATH walks
- Windows-friendly “is this runnable?” check (`PATHEXT`, `.cmd` / `.exe` / `.ps1`)
- Docs: install / run on Linux, macOS, Windows (Git Bash + PowerShell)
- Smoke checklist executed (or waived with evidence) on at least one Windows
  and one macOS environment — or Linux + Windows if Mac unavailable (document)
- Patch bump **0.5.2** + CHANGELOG citing OPS-003
- Tests for PATH splitting / resolve helper on mocked delimiters where pure

**Out:**

- Homebrew / scoop / chocolatey / `.msi` packaging  
- GitHub Actions OS matrix (that can extend OPS-002 later)  
- WSL-only as the Windows story (WSL may work today; native Git Bash/PS is the bar)  
- Rewriting vendor CLIs  
- Changing handoff/live-ask/resume product behavior  

---

## 3. Approach

### 3.1 Known Unix biases to fix

| Spot | Issue | Fix |
|------|-------|-----|
| `resolveExecutable` / PATH walk | `PATH.split(':')` | `PATH.split(path.delimiter)` |
| Executable bit `mode & 0o111` | Unreliable on Windows | On win32: exist + (extension in `PATHEXT` **or** no extension and `fs.stat` is file); keep Unix mode check elsewhere |
| `bin/kala` shebang | Fine in Git Bash; awkward in PowerShell | Document `node path\to\bin\kala …` and optional `npm link` / `.cmd` shim **if cheap**; do not require chmod |
| Docs `ln -s` / `chmod 755` | Unix-only | Per-OS install section |

### 3.2 Install targets (document all three)

| OS | Primary install |
|----|-----------------|
| Linux | `ln -s …/bin/kala ~/.local/bin/kala` (existing) |
| macOS | same, or `npm link` from repo |
| Windows Git Bash | symlink or alias to `bin/kala`, or `node $(pwd)/bin/kala` |
| Windows PowerShell | `node .\bin\kala …` on PATH via function/alias, or small `kala.cmd` next to bin that calls `node "%~dp0kala" %*` |

Builder picks the smallest PowerShell story that works; document it.

### 3.3 Smoke checklist (manual)

On each target OS/shell claimed:

1. `node -v` ≥ 24  
2. `kala status` (or `node bin/kala status`) exits 0  
3. `kala agents` lists roster; installed detection matches reality for at least one CLI  
4. `kala init` writes `.kala/state.yaml`  
5. One launch path: `kala run <installed-agent>` then clean exit (or stub) without crash  
6. If feasible: capture → `kala resume` or handoff picker appears without throw  

Failures that are “vendor CLI missing” are OK; failures that are PATH/spawn/path.sep bugs are not.

### 3.4 Priority vs OPS-002

OPS-002 (CI) remains locked but **must not be built before OPS-003 is `done`**,
unless PO explicitly reprioritizes. Reason: platform correctness before
automating Linux-only green checks.

---

## 4. Requirements

| ID | Requirement |
|----|-------------|
| P1 | Replace hardcoded `:` PATH splits with `path.delimiter` everywhere PATH is walked. |
| P2 | `resolveExecutable` / `isInstalled` behave correctly on win32 for `.cmd`/`.exe` and PATHEXT; Unix keeps executable-bit check. |
| P3 | No hardcoded `/` path assumptions beyond `path.join` / `path.posix` where already intentional for vendor layouts under homedir. |
| P4 | README: Linux / macOS / Windows (Git Bash + PowerShell) install + run. |
| P5 | Smoke checklist §3.3 recorded in CERT evidence (pass per shell, or waiver with reason). |
| P6 | Automated test: PATH parse uses delimiter (mock `process.env.PATH` + platform if needed). |
| P7 | Version **0.5.2** + CHANGELOG OPS-003. |
| P8 | No new runtime dependencies; ARCH A4/A6 held. |

---

## 5. Touch map

| Path | Change |
|------|--------|
| `src/config.ts` | PATH delimiter + win32 resolve rules |
| `README.md` | Multi-OS install |
| `tests/run.ts` | P6 |
| `package.json` / `CHANGELOG.md` | 0.5.2 |
| Optional `bin/kala.cmd` | Only if needed for PowerShell ergonomics |

---

## 6. Verification

- Local Linux: `npm test` green after PATH changes (no regression)  
- Windows Git Bash + PowerShell: smoke §3.3  
- macOS: smoke §3.3 (or waiver: “no Mac available — code review only”)  

### Certify

INDEX → `certify`; CERT references **OPS-003 v1**.

---

## 7. Deferred

| Item | Why |
|------|-----|
| CI matrix ubuntu/windows/macos | Extend OPS-002 after this lands |
| Native installers | Separate OPS |
| agy-on-Windows quirks | Vendor; fix only if smoke fails |

---

## 8. Done when

- P1–P8 met or waived with evidence  
- CERT pass  
- OPS-002 unblocked to build  

---

