# Live Multi-CLI Stress Build Report (`LedgerLite`)

## Purpose and Scope

Verify Kalaga (`kala`) on a multi-layer software build complex enough to expose state corruption, contract drift across vendor models, mid-turn interruptions, session-resume latency, and token-ledger drift.

Target application: **`LedgerLite`**, a zero-dependency Node 24 double-entry accounting package backed by `node:sqlite`, `node:http`, and `node:test`.

Capture archive: local `.handoff-capture/20261124T192923Z/` under the LedgerLite workspace used for the run.
Replay harness: `scripts/live-stress-ledgerlite.sh`

## Stress Constraints

1. **Single initial seed, zero harness state edits between switches.** `.kala/state.yaml` was initialized once at `00-seed`. Every transition afterward (`kala run agy` -> `kala switch cursor` -> `kala switch grok` -> `kala switch agy` -> `kala switch grok` -> `kala switch agy`) relied exclusively on Kalaga's `live-ask`, `.kala/state.yaml`, git porcelain tracking, and prompt injection.
2. **Tight cross-module invariants.** Four sequential milestones shared foreign-keyed SQLite tables, integer-cent double-entry invariants (`SUM(debit) === SUM(credit)` with `SAVEPOINT` rollback), snake_case row shapes vs camelCase HTTP inputs, exact error-code strings (`UNBALANCED_ENTRY`, `INVALID_INVOICE_STATE`, `INVOICE_NOT_FOUND`, `UNKNOWN_ACCOUNT`), and RFC-4180 CRLF CSV output.
3. **YAML escaping pressure.** Seeded `notes` included embedded quotes, colons, and backticks (`"Acme, \"Inc.\""`) to verify zero backslash growth across repeated save/load cycles.

## Built Artifact Summary

The three CLIs (`agy`, `cursor`, `grok`) produced 1,768 lines across 9 files with zero npm dependencies:

| File | Lines | Built by | Responsibility |
|------|------:|----------|----------------|
| `package.json` | 11 | `agy` (Hop 1) | ESM package config, `bin`, `npm test` script |
| `src/db.js` | 59 | `agy` (Hop 1) | `openLedger(dbPath)` with `accounts`, `entries`, `entry_lines`, `invoices` (`PRAGMA foreign_keys = ON`) |
| `src/ledger.js` | 270 | `agy` (Hop 1) | `createAccount`, `listAccounts`, `seedStandardCoa`, `postEntry` (`SAVEPOINT` atomicity), `trialBalance`, `accountRegister` |
| `src/invoices.js` | 253 | `cursor` (Hop 2) | `createInvoice`, `issueInvoice`, `payInvoice`, `listInvoices`, `agingReport` |
| `src/export.js` | 67 | `cursor` (Hop 2) | RFC-4180 `toCsv`, `exportTrialBalanceCsv`, `exportRegisterCsv` |
| `src/server.js` | 223 | `agy` (Hop 4) | `startServer(ledger, { port, host })` serving 9 JSON/CSV endpoints |
| `bin/ledgerlite` | 301 | `agy` (Hop 4) | Mode `0755` CLI (`init-coa`, `account`, `entry`, `invoice`, `balance`, `export`, `serve`) |
| `tests/ledgerlite.test.js` | 509 | `grok` (Hop 5) | 7 integration and adversarial tests across SQLite, CSV, CLI subprocess, and HTTP (`port: 0`) |
| `README.md` | 75 | `grok` (Hop 5) | Setup, chart of accounts, CLI commands, and HTTP API reference |

Final test execution (`FINAL-NPM-TEST.txt`): **7/7 passing** in `1007ms` (`0` contract fixes needed across files written by three distinct CLIs).

## Seam-by-Seam Capture Log

| Hop | Command | Duration | Backslashes in `state.yaml` | What happened at the Kalaga seam |
|-----|---------|---------:|----------------------------:|----------------------------------|
| `00-seed` | `kala init` + seed | — | `4` | Seeded `goal`, `next_step` (Milestone 1), `negative_constraints`, and quoted `notes`. |
| `01-agy-m1` | `kala run agy` | `149s` | `0` | Prompted `[y/N]` workspace trust -> saved grant in `trust.yaml`. Injected `Kalaga session context. Read .kala/state.yaml...`. `agy` built Milestone 1, verified via `node -e`, and updated `.kala/state.yaml` (`next_step` -> Milestone 2, detailed export signatures in `notes`). |
| `02-cursor-m2` | `kala switch cursor` | `280s` | `4` | Prompted `[y/N]` trust for `cursor`. No `agy` session store exists, so Kalaga skipped `live-ask` and injected `Kalaga handoff from agy...` (`--trust` passed to `cursor-agent`). `cursor` read `agy`'s schema, built Milestone 2 (`src/invoices.js`, `src/export.js`), verified via `node -e`, updated `.kala/state.yaml` (`next_step` -> Milestone 3), and Kalaga captured `sessions.cursor.id = 00000000-0000-4000-8000-000000000001`. |
| `03-grok-m3` | `kala switch grok` | `301s` | `4` | **Live-ask hit:** Kalaga resumed `cursor` (`--resume 00000000-... --trust -p`), printed `kalaga: asking cursor for handoff summary (up to 15s)...`, and merged the YAML summary in ~7s (`kalaga: live-ask (cursor) merged`). Injected `Kalaga handoff from cursor...` into `grok`. Harness hit its 300s cap while Grok 4.7 (high) was still reasoning about Node 24 extensionless ESM `bin/ledgerlite` behavior before writing Milestone 3 files. |
| `04-agy-m4` | `kala switch agy` | `317s` | `4` | **Interruption recovery:** Because Milestone 3 files were absent on disk and `.kala/state.yaml` still listed Milestone 3 as `next_step`, `agy` received `Kalaga handoff from grok...`, inspected the repo, built `src/server.js` and `bin/ledgerlite` (`0755`), verified both CLI and HTTP `fetch`, and advanced `next_step` to Milestone 4. |
| `05-grok-m4` | `kala switch grok` | `332s` | `0` | Injected `Kalaga handoff from agy...`. `grok` read all Milestone 1-3 modules written by `agy` and `cursor`, wrote `tests/ledgerlite.test.js` (509 lines, 7 tests) and `README.md` (75 lines), ran `npm test` (`7/7` green), and set `status: COMPLETED` in `.kala/state.yaml`. Kalaga captured `sessions.grok.id = 00000000-0000-4000-8000-000000000002`. |
| `06-agy-verify` | `kala switch agy` | `54s` | `0` | Returned to the starting CLI (`agy`) with `Kalaga handoff from grok...`. `agy` read `.kala/state.yaml` (`status: COMPLETED`), respected `negative_constraints` ("Do not reopen milestones 1-4"), ran `npm test` to confirm `7/7` passing, and exited cleanly with `owner: agy` and `status: COMPLETED`. |

## Bugs Exposed and Fixed During This Stress Run

The smaller `daylog` smoke test (~40 lines) did not generate large multi-turn Grok sessions or mid-build telemetry checks. Running `LedgerLite` (544,533 total Grok tokens across 11 model calls) exposed four real defects: three in Kalaga's Grok integration and one in the PTY QA driver.

### 1. `parseGrokTokenTotal` returned `0` on real `grok usage <sid>` JSON (`src/ledger.ts`)
- **Symptom:** `07-final/kala-status.txt` reported `grok 0/250k 250k left [logged] ok` right after Grok spent 544,533 total tokens (120,085 non-cached tokens) writing Milestone 4.
- **Root cause:** `grok usage <sid>` in Grok Build 1.0.92 outputs structured JSON (`{ updatedAt, session: { inputTokens, outputTokens, cachedReadTokens, totalTokens }, turns: [...] }`). `parseGrokTokenTotal` only matched prose lines with word-bounded `\btotal\b` or `(\d+)\s*tokens?`, missing camelCase JSON keys (`totalTokens`).
- **Fix:** Added JSON parsing in `parseGrokTokenTotal` that sums per-turn fresh tokens (`totalTokens - cachedReadTokens`) within the 5-hour rolling window, retaining the text parser as fallback.

### 2. `grokSessionHint` treated Unix epoch seconds as milliseconds (`src/ledger.ts`)
- **Symptom:** `07-final/kala-why.txt` reported `grok · used 20761d ago` (January 1970) and ranked `grok` ahead of `cursor`.
- **Root cause:** `~/.grok/sessions/session_search.sqlite` stores `session_docs.updated_at` in Unix seconds (`~1.795e9`), whereas `Date.now()` and `kala why` age formatting expect epoch milliseconds (`~1.795e12`).
- **Fix:** Added `normalizeEpochMs` (`< 1e11` multiplied by `1000`, plus numeric-string and ISO-8601 parsing) in `grokSessionHint` and `parseGrokTokenTotal`.
- **Post-fix verification on `ledgerlite`:** `kala status` reports `grok 181k/250k 69k left [logged] ok` and `kala why` ranks `grok` #4 (`69k left · used 2m ago`).

### 3. `live-ask (grok)` timed out at 15s when resuming a 500k+ token session (`src/config.ts`)
- **Symptom:** At the start of Hop 6 (`06-agy-verify/seam-events.txt`), `kalaga: asking grok for handoff summary (up to 15s)...` timed out and fell back cleanly (`returned nothing usable — using existing state`).
- **Root cause:** `AGENTS.grok.headless` ran `['-p', '--output-format', 'plain']`, which resumed Grok 4.7 at default `high` reasoning effort over a 517k-token context and exceeded `LIVE_ASK_TIMEOUT_MS` (`15_000ms`), and placed `-p` (`--single [<PROMPT>]`) before `--output-format` instead of adjacent to the prompt argument.
- **Fix:** Updated `AGENTS.grok.headless` to `['--output-format', 'plain', '--reasoning-effort', 'low', '--max-turns', '1', '-p']`.
- **Post-fix verification (`08-grok-fixes-verified.txt`):** Resuming the exact same 544k-token `ledgerlite` session (`00000000-0000-4000-8000-000000000002`) via `runLiveAsk` completed in **`5,359ms`** and parsed all five YAML keys (`goal`, `done`, `next_step`, `notes`, `negative_constraints`).

### 4. PTY harness OSC `7501` echo into Grok's prompt box (`tests/e2e/pty_drive.py`)
- **Symptom:** In Hop 3 (`03-grok-m3`), `pty_drive.py` answered `\x1b]7501;?` with `\x1b]7501;0\x07`; Grok's TUI echoed `7501;0` into its input field, turning `/quit` into `7501;0uit`.
- **Fix:** Removed the unnecessary `7501` OSC reply, sent `Ctrl+U` (`\x15`) before `/exit`, and added `Ctrl+Q` (`\x11`) to the fallback exit sequence. Hop 5 (`05-grok-m4`) exited cleanly with code `0`.
