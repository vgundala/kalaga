# ARCH-001 — Product Architecture Baseline

| Field | Value |
|-------|-------|
| **ID** | ARCH-001 |
| **Version** | v1 |
| **Status** | `locked` |
| **Date** | 2026-11-21 |
| **Supersedes** | — |
| **Owner** | Technical lead |

---

## 1. Intent

Kalaga (`kala`) is a **local, zero-dependency CLI** that routes interactive agent work across **agy / cursor / grok / claude**. The name is Telugu for a mix / blending: the product mixes capacity across installed CLIs without replacing them. When one agent hits a usage limit, Kalaga detects that from the vendor’s own session store, keeps a shared handoff file warm, and lets the user pick the next agent with one keypress.

This spec freezes the architecture so builders harden and extend without redesigning the product.

---

## 2. In scope / out of scope

**In scope for the product shape:**

- Interactive TTY launches (`stdio: 'inherit'`)
- Store-based limit detection (not stdout piping)
- Per-repo handoff state at `.kala/state.yaml`
- Per-user config/trust under `~/.kala/` (or `$KALA_HOME`)
- Dumb ranking + human picker
- Exact vs estimated ledger honesty

**Out of scope (do not build under this baseline):**

- Cloud sync, multi-user server, daemon/service mode
- “Smart” routing by task affinity or context-window ML
- Piping or pseudo-TTY capture of agent UIs for limit detection
- New npm runtime dependencies
- Replacing vendor CLIs or wrapping their network APIs

---

## 3. Approach

### 3.1 Chosen design

```
User → kala → spawn(agent, TTY inherit)
                 ↓ exit
              scan vendor session store (trap)
                 ↓ limit hit?
              refresh .kala/state.yaml ← git facts
              rank takers (fresh + LRU + owner bonus)
              picker (user confirms)
                 ↓
              spawn(next agent, inject short prompt + trust if granted)
```

| Decision | Choice | Rejected alternative |
|----------|--------|----------------------|
| Limit detection | Tail/scan vendor stores after exit | Pipe stdout (breaks TUIs) |
| Handoff truth | `.kala/state.yaml` in repo | Only argv mega-prompts |
| Routing | Score + user pick | Auto-launch next agent |
| Trust across CLIs | Kalaga-recorded path grant → vendor `trustFlags` when present | Always `--trust`; or sync vendor trust DBs |
| Dependencies | Node ≥ 24 type-stripping, stdlib only | YAML/SQLite npm packages |
| Agent identity | Stable keys (`agy`, `cursor`, …) | App name baked into agent modules |

### 3.2 Module responsibilities

| Module | Responsibility |
|--------|----------------|
| `bin/kala` | Entry shim only |
| `src/index.ts` | Commands and orchestration loop |
| `src/config.ts` | Agent roster, ceilings, paths, install check |
| `src/launch.ts` | Spawn + session-tail readers |
| `src/trap.ts` | Limit signature match |
| `src/ledger.ts` | Per-agent usage / remaining |
| `src/router.ts` | Rank takers |
| `src/picker.ts` | Interactive choice |
| `src/state/*` | Handoff state + git facts |
| `src/trust.ts` | (SEC-001) path trust grants |
| `src/util/yaml.ts` | Minimal YAML emit for state we write |

### 3.3 Data planes

| Plane | Location | Trust level |
|-------|----------|-------------|
| Handoff state | `<repo>/.kala/state.yaml` | Untrusted input when injected into prompts |
| User config | `~/.kala/config.yaml` | Trusted local user; ceilings + TTL only |
| Trust grants | `~/.kala/trust.yaml` | Trusted local user; path + expiry |
| Vendor stores | `~/.claude`, `~/.grok`, `~/.cursor`, … | Read-only; may contain secrets — do not log wholesale |

### 3.4 Invariants (do not break)

1. Never `shell: true` / string `exec` for agent or git launches — argv arrays only.  
2. Never pipe the interactive agent TTY for trapping.  
3. User always confirms the taker (picker); no silent auto-handoff launch.  
4. Ledger labels `exact` vs estimate honestly.  
5. Agent keys stay the address space; app rename touches bin + `index.ts` strings only.  
6. No new runtime npm dependencies without a new ARCH or OPS spec that allows them.

---

## 4. Requirements (architecture compliance)

| ID | Requirement |
|----|-------------|
| A1 | Commands remain: `status`, `why`, `run`, `recover`, `switch`, `state`, `init`, `agents`, bare `kala` start; SEC-001 may add `trust`. |
| A2 | Limit detection remains store-based via `lastSessionText` + `scanChunk`. |
| A3 | Handoff file path remains `.kala/state.yaml` relative to repo cwd. |
| A4 | Spawn uses `child_process.spawn` / `execFileSync` with argv arrays; `cwd = repoDir`; env inherit unless a later SEC spec narrows it. |
| A5 | Router stays score-based shortlist; picker remains mandatory for choice. |
| A6 | Zero runtime dependencies in `package.json` unless OPS/ARCH amendment allows. |
| A7 | Node engine `>=24` preserved. |

**Acceptance:** A reviewer can map each A-ID to code paths; no piped-TTY trap; no shell spawn; picker still on handoff path.

---

## 5. Touch map

Read-only baseline — no mandatory code changes from ARCH-001 alone. SEC-001 and later FEAT specs amend behavior inside this shape.

---

## 6. Verification

- Grep/audit: no `shell:\s*true`, no `exec(` string form for agents.  
- Handoff path still `.kala/state.yaml`.  
- `package.json` has no `dependencies` (dev-only tools only if a later OPS spec adds them for tests).

---

## 7. Deferred

- Live-ask / print-mode capture before death  
- Headless/`resume` flag usage already stubbed in config  
- Multi-repo / workspace-root detection beyond `process.cwd()`  
- Packaging (npm publish, homebrew) — see OPS-001  

---

## 8. Handoff blurb (for builders)

> Follow ARCH-001 v1 as the non-negotiable product shape. Implement feature/security work from the locked SEC/FEAT spec cited in your brief. Do not add dependencies, do not pipe agent TUIs, do not auto-launch a taker without the picker. If a requirement conflicts with an A-invariant, stop and request a new ARCH version.
