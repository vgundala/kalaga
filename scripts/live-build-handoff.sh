#!/usr/bin/env bash
# Live multi-CLI build with capture at every Kalaga seam.
# Builds a real daylog CLI under playground/daylog while switching agents.
set -euo pipefail

KALA_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KALA_BIN="${KALA_BIN:-$KALA_REPO/bin/kala}"
PTY="$KALA_REPO/tests/e2e/pty_drive.py"
PROJECT="${DAYLOG_ROOT:-$(mktemp -d -t kala-daylog-XXXXXX)}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CAP="$PROJECT/.handoff-capture/$STAMP"
export KALA_HOME="${KALA_HOME:-$CAP/kala-home}"

mkdir -p "$PROJECT" "$CAP" "$KALA_HOME"
cd "$PROJECT"

if [[ ! -d .git ]]; then
  git init -q
  git -c user.email=daylog@local -c user.name=Daylog commit --allow-empty -qm "chore: empty tree"
fi

snapshot() {
  local phase="$1" note="$2"
  local dir="$CAP/$phase"
  mkdir -p "$dir"
  {
    echo "# Phase $phase — $note"
    echo "time_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "pwd: $PROJECT"
  } > "$dir/NOTE.txt"

  if [[ -f .kala/state.yaml ]]; then
    cp .kala/state.yaml "$dir/state.yaml"
  else
    echo "(no state yet)" > "$dir/state.yaml"
  fi

  node "$KALA_BIN" status >"$dir/kala-status.txt" 2>&1 || true
  node "$KALA_BIN" why >"$dir/kala-why.txt" 2>&1 || true
  git status --short >"$dir/git-status.txt" 2>&1 || true
  git diff HEAD >"$dir/git-diff.txt" 2>&1 || true
  git ls-files >"$dir/git-files.txt" 2>&1 || true
  find . -type f \
    ! -path './.git/*' ! -path './.handoff-capture/*' ! -path './.kala/*' \
    | sort >"$dir/tree.txt" 2>/dev/null || true

  # Copy current source artifacts
  mkdir -p "$dir/files"
  for f in package.json bin/daylog src/index.js src/daylog.js README.md test.sh; do
    [[ -f "$f" ]] && cp "$f" "$dir/files/$(echo "$f" | tr '/' '_')" || true
  done
  echo "  captured → $dir"
}

run_phase() {
  local phase="$1" agent_cmd="$2" wait_args="$3" note="$4" timeout="${5:-180}"
  echo
  echo "======== $phase: $note ========"
  mkdir -p "$CAP/$phase"
  snapshot "${phase}-before" "before: $note"

  set +e
  # shellcheck disable=SC2086
  python3 "$PTY" \
    --kala "$KALA_BIN" \
    --cwd "$PROJECT" \
    --timeout "$timeout" \
    --log "$CAP/$phase/pty.log" \
    $wait_args \
    -- $agent_cmd \
    >"$CAP/$phase/pty.stdout" 2>"$CAP/$phase/pty.stderr"
  local ec=$?
  set -e
  echo "$ec" >"$CAP/$phase/pty.exit"
  mkdir -p "$CAP/$phase"

  # Plain-text strip of pty log (last 8k chars worth of signal)
  python3 - <<PY
import re, pathlib
raw = pathlib.Path("$CAP/$phase/pty.log").read_bytes() if pathlib.Path("$CAP/$phase/pty.log").exists() else b""
plain = re.sub(r"\x1b\[[0-9;?<=>!]*[A-Za-z]|\x1b\].*?(?:\x07|\x1b\\\\)|\x1b.", " ", raw.decode("utf-8", "replace"))
plain = re.sub(r"[ \t]+", " ", plain)
pathlib.Path("$CAP/$phase/pty.plain.txt").write_text(plain[-12000:])
# Extract handoff inject if present
idx = plain.lower().find("kalaga handoff")
if idx >= 0:
    pathlib.Path("$CAP/$phase/inject-seen.txt").write_text(plain[idx:idx+1200])
PY

  snapshot "${phase}-after" "after: $note (pty exit $ec)"
  echo "  pty exit=$ec"
}

# --- Seed the real build goal ---
node "$KALA_BIN" init 2>/dev/null || true
node "$KALA_BIN" state goal "Build daylog: a tiny Node CLI that appends dated one-line notes to .daylog and lists them"
node "$KALA_BIN" state next "Scaffold package.json (name daylog, bin daylog→./bin/daylog), empty bin/daylog stub that prints usage, and a one-paragraph README. Stop when those three files exist."
node "$KALA_BIN" state done "repo initialized for live multi-CLI handoff build"
node "$KALA_BIN" state note "Product: local daylog CLI. Stack: Node, zero deps. Commands to land eventually: daylog add \"text\", daylog list. Capture dir: $CAP"

snapshot "00-seed" "seeded goal/next for scaffold"

# Phase 1 — agy scaffolds
run_phase "01-agy-scaffold" "run agy" \
  "--min-work-secs 30 --wait-path package.json --wait-path bin/daylog --wait-path README.md" \
  "agy scaffolds package.json + bin/daylog + README" \
  220

# Point next agent at implementation
node "$KALA_BIN" state next "Implement daylog: bin/daylog should support \`add <text>\` (append ISO date + text to ./.daylog) and \`list\` (print file). Keep zero deps. Update README with usage. Prove with one add then list. Stop when .daylog exists."
node "$KALA_BIN" state done "scaffold landed (or attempted) by agy"

# Phase 2 — switch to cursor (captures live-ask + inject during switch)
run_phase "02-cursor-implement" "switch cursor" \
  "--min-work-secs 45 --wait-path bin/daylog" \
  "switch → cursor implements add/list" \
  260

# Prefer a content signal: if .daylog missing, still advance — next agent picks up
node "$KALA_BIN" state next "Add clear --help usage, reject empty add, and a tiny test.sh that runs add+list and greps the note. chmod +x test.sh. Stop when test.sh exists."
node "$KALA_BIN" state done "add/list implementation pass on cursor (or in progress)"

# Phase 3 — switch to claude
run_phase "03-claude-polish" "switch claude" \
  "--min-work-secs 40 --wait-path test.sh" \
  "switch → claude adds help + test.sh" \
  260

node "$KALA_BIN" state next "Run ./test.sh, fix any failures, confirm package.json bin field points at bin/daylog, write CHANGELOG.md for 0.1.0. Stop when CHANGELOG.md exists."
node "$KALA_BIN" state done "help/test pass on claude (or in progress)"

# Phase 4 — back to agy
run_phase "04-agy-return" "switch agy" \
  "--min-work-secs 40 --wait-path CHANGELOG.md" \
  "switch back → agy verifies + CHANGELOG" \
  260

# Final capture + smoke
snapshot "05-final" "final tree after full handoff loop"
{
  echo "=== daylog smoke (if bin exists) ==="
  if [[ -x bin/daylog ]]; then
    node bin/daylog add "handoff-capture $STAMP" 2>&1 || ./bin/daylog add "handoff-capture $STAMP" 2>&1 || true
    node bin/daylog list 2>&1 || ./bin/daylog list 2>&1 || true
  elif [[ -f bin/daylog ]]; then
    chmod +x bin/daylog || true
    node bin/daylog list 2>&1 || true
  else
    echo "bin/daylog missing"
  fi
  echo
  echo "=== capture index ==="
  find "$CAP" -type f | sort
} | tee "$CAP/SUMMARY.txt"

echo
echo "LIVE BUILD CAPTURE: $CAP"
echo "Read SUMMARY.txt and each phase-*/ NOTE.txt state.yaml git-diff.txt inject-seen.txt"
