# CERT-006 — Certification of OPS-003 v1

| Field | Value |
|-------|-------|
| **ID** | CERT-006 |
| **Version** | v1 |
| **Status** | `final` |
| **Date** | 2026-11-24 |
| **Certifier** | Technical lead |
| **Spec under test** | OPS-003 v1 → [`OPS-003-cross-platform.v1.md`](../OPS-003-cross-platform.v1.md) |
| **Also constrained by** | ARCH-001 v1 |
| **Tree** | `kalaga` @ **0.6.0** |

---

## 1. Verdict

**Final verdict: `pass-with-waivers`**

Code and docs meet P1–P4, P6–P8. Manual smoke on Windows/macOS (P5) is
**waived**: no Windows/macOS host in this certify environment. Residual:
first green smoke deferred to maintainers with those machines.

---

## 2. Requirement matrix

| ID | Result | Evidence |
|----|--------|----------|
| P1 | met | `splitPathEnv` / `resolveExecutable` use `path.delimiter` |
| P2 | met | win32 PATHEXT / `isRunnablePath`; Unix mode bit retained |
| P3 | met | `path.join` for vendor layouts; no new hardcoded `/` PATH walks |
| P4 | met | README Linux / macOS / Windows (Git Bash + PowerShell) + `bin/kala.cmd` |
| P5 | waived | No Win/Mac available at certify; Linux `npm test` + status smoke OK |
| P6 | met | `tests/run.ts` OPS-003 delimiter case |
| P7 | met | Version folded into **0.6.0** (supersedes planned 0.5.2 bump) |
| P8 | met | No new dependencies |

---

## 3. Notes

OPS-002 is unblocked. Update INDEX: OPS-003 `done`.
