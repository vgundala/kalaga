#!/usr/bin/env bash
# Kalaga real-world multi-CLI stress test: builds "ledgerlite" (a 4-layer
# SQLite double-entry bookkeeping, invoicing, CSV export, CLI & HTTP JSON API
# package) across 3 distinct vendor CLIs and back to the first:
#
#   Phase 1: kala run agy       (Milestone 1: SQLite schema + double-entry engine)
#   Phase 2: kala switch cursor (Milestone 2: Invoice lifecycle + aging + CSV)
#   Phase 3: kala switch grok   (Milestone 3: CLI + HTTP JSON API server)
#   Phase 4: kala switch agy    (Milestone 4: Return to agy — integration tests, cross-agent bug fixes, README)
#
# ZERO harness state edits after 00-seed: Kalaga's own state.yaml, live-ask,
# modified_files, and handoffInject must carry the architecture across all 4 hops.
set -euo pipefail

KALA_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KALA_BIN="${KALA_BIN:-$KALA_REPO/bin/kala}"
PTY="$KALA_REPO/tests/e2e/pty_drive.py"
PROJECT="${LEDGERLITE_ROOT:-$(mktemp -d -t kala-ledgerlite-XXXXXX)}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CAP="$PROJECT/.handoff-capture/$STAMP"
export KALA_HOME="${KALA_HOME:-$CAP/kala-home}"

# Ensure dist/ is built so bin/kala executes the packaged JS artifact.
(cd "$KALA_REPO" && npm run build >/dev/null)

mkdir -p "$PROJECT" "$CAP" "$KALA_HOME"
cd "$PROJECT"

if [[ ! -d .git ]]; then
  git init -q
fi

cat > .gitignore <<'EOF'
.kala/
.handoff-capture/
*.sqlite
*.sqlite-*
node_modules/
EOF

cat > SPEC.md <<'EOF'
# LedgerLite Specification

Zero-dependency local double-entry bookkeeping, invoicing, CSV export, CLI, and HTTP JSON API built strictly on Node >= 24 standard library (`node:sqlite`, `node:http`, `node:crypto`, `node:test`, `node:assert/strict`).

## Global Rule for Multi-Agent Handoff
Complete **ONLY** the single milestone currently requested in `.kala/state.yaml` (`next_step`). Before stopping, verify your new modules load/work with a quick `node -e` or CLI check, update `.kala/state.yaml` (`done` bullets + `next_step` set to the next milestone + `notes` if needed), and stop immediately so the next CLI agent takes the next milestone.

## Milestone 1 — SQLite Schema & Double-Entry Core (`package.json`, `src/db.js`, `src/ledger.js`)
1. `package.json`: `"name": "ledgerlite"`, `"version": "0.1.0"`, `"type": "module"`, `"bin": { "ledgerlite": "./bin/ledgerlite" }`, `"scripts": { "test": "node --test tests/*.test.js" }`. Zero dependencies.
2. `src/db.js`:
   - `openLedger(dbPath = ':memory:')` using `DatabaseSync` from `node:sqlite`, enabling `PRAGMA foreign_keys = ON`, creating tables if missing, and returning `{ db, close() }`:
     - `accounts`: `id INTEGER PRIMARY KEY`, `code TEXT UNIQUE NOT NULL`, `name TEXT NOT NULL`, `type TEXT NOT NULL CHECK(type IN ('asset','liability','equity','income','expense'))`, `currency TEXT NOT NULL DEFAULT 'USD'`, `created_at TEXT NOT NULL`
     - `entries`: `id INTEGER PRIMARY KEY`, `posted_at TEXT NOT NULL`, `memo TEXT NOT NULL`, `reference TEXT`
     - `entry_lines`: `id INTEGER PRIMARY KEY`, `entry_id INTEGER NOT NULL REFERENCES entries(id)`, `account_id INTEGER NOT NULL REFERENCES accounts(id)`, `direction TEXT NOT NULL CHECK(direction IN ('debit','credit'))`, `amount_cents INTEGER NOT NULL CHECK(amount_cents > 0)`
     - `invoices`: `id INTEGER PRIMARY KEY`, `number TEXT UNIQUE NOT NULL`, `customer TEXT NOT NULL`, `status TEXT NOT NULL CHECK(status IN ('draft','issued','paid'))`, `subtotal_cents INTEGER NOT NULL`, `tax_cents INTEGER NOT NULL DEFAULT 0`, `total_cents INTEGER NOT NULL`, `due_date TEXT NOT NULL`, `issued_entry_id INTEGER REFERENCES entries(id)`, `paid_entry_id INTEGER REFERENCES entries(id)`, `created_at TEXT NOT NULL`
3. `src/ledger.js`:
   - `createAccount(ledger, { code, name, type, currency = 'USD' })` -> returns created account row; `listAccounts(ledger)` -> ordered by `code`.
   - `seedStandardCoa(ledger)` -> idempotently creates `1000` Cash (`asset`), `1100` Accounts Receivable (`asset`), `2100` Sales Tax Payable (`liability`), `3000` Owner Equity (`equity`), `4000` Consulting Revenue (`income`), `5000` Operating Expense (`expense`).
   - `postEntry(ledger, { memo, reference = null, postedAt = new Date().toISOString(), lines })` where each line is `{ accountCode, direction, amountCents }`. Enforce inside `BEGIN`/`COMMIT`: `Array.isArray(lines) && lines.length >= 2`, every `amountCents` is a positive safe integer (`Number.isInteger(n) && n > 0`), and sum of `debit` cents equals sum of `credit` cents (otherwise throw `new Error('UNBALANCED_ENTRY')`). Returns `{ entryId, postedAt, memo, reference, totalCents }`.
   - `trialBalance(ledger)` -> returns `{ accounts: [{ code, name, type, debitCents, creditCents, netCents }], totalDebitCents, totalCreditCents, balanced }` where `netCents` is `debit - credit` for `asset`/`expense` and `credit - debit` for `liability`/`equity`/`income`.
   - `accountRegister(ledger, accountCode)` -> chronological lines for `accountCode` with `runningBalanceCents`.

## Milestone 2 — Invoice Lifecycle, Aging Report & RFC-4180 CSV (`src/invoices.js`, `src/export.js`)
1. `src/invoices.js` (building directly on `src/db.js` and `src/ledger.js`):
   - `createInvoice(ledger, { number, customer, subtotalCents, taxCents = 0, dueDate })` -> validates positive integer `subtotalCents` and non-negative integer `taxCents`, sets `total_cents = subtotalCents + taxCents`, `status = 'draft'`, returns invoice.
   - `issueInvoice(ledger, number, { arCode = '1100', revenueCode = '4000', taxCode = '2100', postedAt } = {})` -> requires `status === 'draft'`, posts balanced entry (debit AR `total_cents`, credit Revenue `subtotal_cents`, and if `tax_cents > 0` credit Tax `tax_cents`), sets `status = 'issued'` and `issued_entry_id`.
   - `payInvoice(ledger, number, { cashCode = '1000', arCode = '1100', postedAt } = {})` -> requires `status === 'issued'` (reject draft or already-paid), posts balanced entry (debit Cash `total_cents`, credit AR `total_cents`), sets `status = 'paid'` and `paid_entry_id`.
   - `listInvoices(ledger, { status } = {})` and `agingReport(ledger, asOfDate = new Date().toISOString().slice(0, 10))` -> groups unpaid `'issued'` invoices into `{ current, days_1_30, days_31_60, days_61_plus, totalOutstandingCents }` by days past `due_date`.
2. `src/export.js`:
   - `toCsv(rows, columns)` -> RFC-4180 CSV with header row; fields containing `,`, `"`, `\r`, or `\n` are wrapped in `"` with internal `"` doubled to `""`.
   - `exportTrialBalanceCsv(ledger)` and `exportRegisterCsv(ledger, accountCode)`.

## Milestone 3 — CLI & Local HTTP JSON API (`src/server.js`, `bin/ledgerlite`)
1. `src/server.js`:
   - `startServer(ledger, { port = 0, host = '127.0.0.1' } = {})` using `node:http`, resolving `{ server, host, port, url, close: () => Promise<void> }`.
   - Endpoints:
     - `GET /health` -> `200 { ok: true }`
     - `GET /accounts` -> `200 { accounts }`, `POST /accounts` -> `201`
     - `POST /entries` -> `201` on balanced entry, `400 { error }` on `UNBALANCED_ENTRY` or invalid input
     - `GET /trial-balance` -> `200` trial balance JSON
     - `GET /export/trial-balance.csv` -> `200` (`Content-Type: text/csv`)
     - `GET /invoices`, `POST /invoices` -> `201`, `POST /invoices/:number/issue` -> `200`, `POST /invoices/:number/pay` -> `200` (`400` on invalid state), `GET /reports/aging?asOf=YYYY-MM-DD` -> `200`
2. `bin/ledgerlite` (`#!/usr/bin/env node`, executable `0755`):
   - Global option `--db <path>` (default `./ledgerlite.sqlite`).
   - Commands: `init-coa`, `account add <code> <name> <type>`, `account list`, `entry post <memo> <leg1> <leg2> [...]` (where each leg is `code:debit:cents` or `code:credit:cents`), `invoice create <number> <customer> <subtotalCents> <taxCents> <dueDate>`, `invoice issue <number>`, `invoice pay <number>`, `invoice list`, `invoice aging [asOf]`, `balance`, `export trial-balance`, `export register <code>`, `serve [--port <n>]`, `--help`.

## Milestone 4 — Adversarial & Integration Test Suite + Bug Fixes + Docs (`tests/ledgerlite.test.js`, `README.md`)
1. `tests/ledgerlite.test.js` using `node:test` and `node:assert/strict`:
   - Double-entry invariants: balanced 2-leg and 3-leg entries succeed; unbalanced, 1-leg, float, zero, or negative amounts throw `UNBALANCED_ENTRY` / validation error and leave DB unchanged (atomic rollback).
   - Invoice lifecycle: `create` -> `issue` (with tax split) -> `pay`, verifying AR goes up on issue and back to `0` on pay while Cash + Revenue + Tax balance; paying a draft or paying twice fails; `agingReport` buckets `current`, `days_1_30`, `days_31_60`, `days_61_plus`.
   - CSV export: RFC-4180 escaping on account names / memos containing commas, `"double quotes"`, and newlines.
   - CLI subprocess test (`execFileSync('node', ['bin/ledgerlite', ...])` against a temp sqlite file): `init-coa`, `invoice create/issue/pay`, `balance`.
   - HTTP server test on `port: 0` using `fetch`: `GET /health`, `POST /accounts`, `POST /entries` (201 + 400 on unbalanced), invoice `create -> issue -> pay`, `GET /trial-balance`, `GET /export/trial-balance.csv`.
2. Fix any cross-agent contract mismatches across `src/` and `bin/` until `npm test` passes 100%.
3. Write a concise `README.md` covering setup, CLI examples, and HTTP endpoints, and set `.kala/state.yaml` `status: COMPLETED`.
EOF

git add .gitignore SPEC.md
git -c user.email=qa@kalaga.local -c user.name=KalagaQA commit -qm "chore: add LedgerLite 4-milestone spec"

snapshot() {
  local label="$1" note="$2"
  local dir="$CAP/$label"
  mkdir -p "$dir/files"
  {
    echo "# Snapshot: $label"
    echo "note: $note"
    echo "time_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    if [[ -f .kala/state.yaml ]]; then
      echo "state_backslashes: $(tr -cd '\\' < .kala/state.yaml | wc -c | tr -d ' ')"
      echo "state_bytes: $(wc -c < .kala/state.yaml | tr -d ' ')"
    fi
  } > "$dir/META.txt"

  [[ -f .kala/state.yaml ]] && cp .kala/state.yaml "$dir/state.yaml" || echo "(missing)" > "$dir/state.yaml"
  node "$KALA_BIN" status >"$dir/kala-status.txt" 2>&1 || true
  node "$KALA_BIN" why >"$dir/kala-why.txt" 2>&1 || true
  node "$KALA_BIN" trust >"$dir/kala-trust.txt" 2>&1 || true
  git status --short >"$dir/git-status.txt" 2>&1 || true
  git diff HEAD >"$dir/git-diff.txt" 2>&1 || true
  find . -maxdepth 3 -type f \
    ! -path './.git/*' ! -path './.handoff-capture/*' ! -path './.kala/*' \
    | sort >"$dir/tree.txt"

  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    rel="${f#./}"
    cp "$f" "$dir/files/$(echo "$rel" | tr '/' '__')" 2>/dev/null || true
  done < "$dir/tree.txt"
}

run_phase() {
  local phase="$1" kala_cmd="$2" wait_flags="$3" desc="$4" timeout="${5:-300}"
  echo
  echo "================================================================"
  echo "PHASE $phase — $desc"
  echo "command: kala $kala_cmd"
  echo "================================================================"
  mkdir -p "$CAP/$phase"
  snapshot "${phase}-before" "before $desc"

  local t0 t1 elapsed ec
  t0="$(date +%s)"
  set +e
  # shellcheck disable=SC2086
  python3 "$PTY" \
    --kala "$KALA_BIN" \
    --cwd "$PROJECT" \
    --timeout "$timeout" \
    --min-work-secs 20 \
    --idle-secs 6 \
    --log "$CAP/$phase/pty.log" \
    $wait_flags \
    -- $kala_cmd \
    >"$CAP/$phase/pty.stdout" 2>"$CAP/$phase/pty.stderr"
  ec=$?
  set -e
  t1="$(date +%s)"
  elapsed=$((t1 - t0))
  printf 'exit=%s\nelapsed_sec=%s\ncommand=kala %s\n' "$ec" "$elapsed" "$kala_cmd" >"$CAP/$phase/TIMING.txt"

  python3 - "$CAP/$phase" <<'PY'
import pathlib, re, sys
d = pathlib.Path(sys.argv[1])
raw = (d / "pty.log").read_bytes() if (d / "pty.log").exists() else b""
csi = re.compile(r"\x1b\[[0-9;?<=>!]*[A-Za-z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b.")
plain = re.sub(r"[ \t]+", " ", csi.sub(" ", raw.decode("utf-8", "replace")))
(d / "pty.plain.txt").write_text(plain)

# Capture every Kalaga seam notice + handoff inject block
seam_lines = []
for line in plain.splitlines():
    s = line.strip()
    if any(k in s.lower() for k in (
        "kalaga:", "kalaga →", "kalaga handoff", "kalaga session context",
        "trust this directory", "trust recorded", "hand off, or stay",
        "continue on", "staying put", "live-ask", "asking "
    )):
        seam_lines.append(s[:240])
(d / "seam-events.txt").write_text("\n".join(seam_lines) + "\n")

for marker in ("kalaga handoff from", "kalaga session context"):
    idx = plain.lower().find(marker)
    if idx >= 0:
        (d / "inject-seen.txt").write_text(plain[idx:idx + 1500])
        break
PY

  snapshot "${phase}-after" "after $desc (exit=$ec, ${elapsed}s)"
  echo "  -> finished $phase in ${elapsed}s (pty exit=$ec)"
  if [[ -f "$CAP/$phase/seam-events.txt" ]]; then
    echo "  -> seam events:"
    sed -n '1,12p' "$CAP/$phase/seam-events.txt" | sed 's/^/     /'
  fi
}

# ---------------- SEED ONCE (NO FURTHER HARNESS STATE EDITS!) ----------------
node "$KALA_BIN" init
node "$KALA_BIN" state goal "Build LedgerLite per SPEC.md across 4 milestones (SQLite double-entry ledger, invoicing + CSV, CLI + HTTP API, integration test suite)"
node "$KALA_BIN" state next "Complete ONLY Milestone 1 in SPEC.md: create package.json, src/db.js, and src/ledger.js; sanity-check with node -e; update .kala/state.yaml (done + next_step -> Milestone 2) and stop."
node "$KALA_BIN" state done "Committed SPEC.md with 4-milestone contract"
# Deliberately include quotes, colons, single quotes, and backticks to stress YAML round-tripping across 4 switches:
node "$KALA_BIN" state note "Read SPEC.md first. Integer cents only (no floats); quotes test: \"debit\" == \"credit\", 'single', key: value, \`node:sqlite\`. Complete ONLY the current milestone in next_step, update .kala/state.yaml, and stop."
node "$KALA_BIN" state neg "Do not add any npm dependencies; use Node >= 24 built-ins only"
node "$KALA_BIN" state neg "Do not implement future milestones early; stop after updating .kala/state.yaml for the next agent"

snapshot "00-seed" "initial seed (harness will NOT touch kala state again)"

# Phase 1: agy builds Milestone 1
run_phase "01-agy-m1" "run agy" \
  "--wait-path package.json --wait-path src/db.js --wait-path src/ledger.js" \
  "Milestone 1 on agy (SQLite schema + double-entry core)" \
  260

# Phase 2: switch to cursor for Milestone 2 (NO manual kala state edit!)
run_phase "02-cursor-m2" "switch cursor" \
  "--wait-path src/invoices.js --wait-path src/export.js" \
  "Switch agy -> cursor for Milestone 2 (invoices + aging + CSV)" \
  280

# Phase 3: switch to grok for Milestone 3 (triggers live-ask on cursor's captured session!)
run_phase "03-grok-m3" "switch grok" \
  "--wait-path src/server.js --wait-path bin/ledgerlite" \
  "Switch cursor -> grok for Milestone 3 (CLI + HTTP JSON API)" \
  450

# Phase 4: switch back to agy for Milestone 4 (triggers live-ask on grok's session; agy returns to test & reconcile all 3 agents' code!)
run_phase "04-agy-m4" "switch agy" \
  "--wait-path tests/ledgerlite.test.js --wait-path README.md" \
  "Switch grok -> agy (return to first CLI) for Milestone 4 (test suite + bug fixes + README)" \
  450

snapshot "05-final" "completed 4-milestone multi-CLI loop"

# ---------------- INDEPENDENT VERIFICATION OF BUILT APP ----------------
{
  echo "=== Final Verification of LedgerLite ($STAMP) ==="
  echo "project: $PROJECT"
  echo
  echo "--- npm test ---"
  npm test 2>&1 || true
  echo
  echo "--- CLI end-to-end smoke ---"
  SMOKE_DB="$CAP/smoke.sqlite"
  node bin/ledgerlite --db "$SMOKE_DB" init-coa 2>&1 || true
  node bin/ledgerlite --db "$SMOKE_DB" invoice create INV-100 "Acme, \"Inc.\"" 125000 10000 2026-10-01 2>&1 || true
  node bin/ledgerlite --db "$SMOKE_DB" invoice issue INV-100 2>&1 || true
  node bin/ledgerlite --db "$SMOKE_DB" invoice aging 2026-11-24 2>&1 || true
  node bin/ledgerlite --db "$SMOKE_DB" invoice pay INV-100 2>&1 || true
  node bin/ledgerlite --db "$SMOKE_DB" balance 2>&1 || true
  node bin/ledgerlite --db "$SMOKE_DB" export trial-balance 2>&1 || true
  echo
  echo "--- Backslash & owner audit across all snapshots ---"
  for snap in 00-seed 01-agy-m1-after 02-cursor-m2-after 03-grok-m3-after 04-agy-m4-after 05-final; do
    bs="$(grep '^state_backslashes:' "$CAP/$snap/META.txt" 2>/dev/null | cut -d' ' -f2 || echo '?')"
    own="$(grep '^owner:' "$CAP/$snap/state.yaml" 2>/dev/null | head -1 || echo 'owner: ?')"
    st="$(grep '^status:' "$CAP/$snap/state.yaml" 2>/dev/null | head -1 || echo 'status: ?')"
    printf '%-20s %-18s %-20s backslashes=%s\n' "$snap" "$own" "$st" "$bs"
  done
} | tee "$CAP/VERIFICATION.txt"

echo
echo "STRESS CAPTURE COMPLETE: $CAP"
