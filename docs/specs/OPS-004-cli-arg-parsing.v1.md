# OPS-004 — Scoped CLI Flag Parsing & `state` Payload Preservation

| Field | Value |
|-------|-------|
| **ID** | OPS-004 |
| **Version** | v1 |
| **Status** | `done` |
| **Date** | 2026-11-27 |
| **Owner** | Technical lead |
| **Depends on** | FEAT-003 v1; FEAT-004 v2 (K14) |
| **Dependencies** | Node.js ≥ 22.18 stdlib only |

---

## 1. Intent

`src/index.ts` scans all CLI arguments globally for flags (`KNOWN_FLAGS`, `VALUE_FLAGS`, `-v`/`--version`, `-h`/`--help`) and reads raw `process.argv.includes(...)` inside subcommands. Passing flag-like tokens in `kala state <field> <text>` (for example `kala state goal "fix --quiet"` or `kala state goal fix --force`) either fails with exit `2`, triggers `--version`/`--help`, or alters command behavior. Fix this with scoped flag parsing and standard `--` end-of-flags handling.

---

## 2. Scope

**In:** Pure `parseCliArgs(raw: string[])` helper, `state <field>` payload boundary, `--` end-of-flags, replacing raw `process.argv.includes`/`raw.includes` flag scans in `src/index.ts`, unit + CLI tests in `tests/run.ts`.

**Out:** Changes to `_hook` fast path (`raw[0] === '_hook'`), new CLI flags, or unrelated refactoring.

---

## 3. Requirements (`C1`–`C5`)

| ID | Requirement |
|----|-------------|
| `C1` | Export pure `parseCliArgs(raw: string[]): ParsedCliArgs` in `src/util/cliargs.ts` returning `{ positionals: string[]; flags: Set<string>; flagValues: Map<string, string>; action: 'run' \| 'version' \| 'help' \| 'error' }`. |
| `C2` | When `positionals[0] === 'state' && positionals.length === 2` (both `state` and `<field>` parsed), stop flag parsing for all remaining tokens (consuming at most one immediate leading `--` separator right after `<field>`). `kala state --help` still yields `action: 'help'`, whereas `kala state goal --help`, `kala state goal fix --quiet --force`, `kala state goal -- --quiet`, and `kala state goal fix -- crash` preserve payload tokens verbatim in `positionals` with `flags` empty. |
| `C3` | When `--` is encountered while flag parsing is active (on any command), stop flag parsing and push all subsequent tokens verbatim into `positionals` (e.g. `kala trust revoke -- --weird-dir`). |
| `C4` | Replace all raw `process.argv.includes(...)` / `raw.includes(...)` flag checks in `src/index.ts` (`--assume-limit`, `--strict-state`, `--all`, `--force`) with module/scoped `parsed.flags.has(...)`. Preserve `K14` (`VALUE_FLAGS`: `--agent`, `--event`, `--agents` validation, exit `2` on unknown flags before payload/`--`, and `raw[0] === '_hook'` bypass). |
| `C5` | Add unit tests for `parseCliArgs` and CLI subprocess tests via `runKala` in `tests/run.ts` covering `C1`–`C4`; `npm test` and `npm run test:e2e:auto` pass cleanly with `<repo>/dist` absent afterward. |

---

## 4. Touch Map & Done Criteria

- **Files:** `src/util/cliargs.ts` (new), `src/index.ts`, `tests/run.ts`.
- **Done when:** `C1`–`C5` are implemented cleanly, `npm test` and `npm run test:e2e:auto` pass with zero failures, and `docs/specs/INDEX.md` marks `OPS-004` `done`.
