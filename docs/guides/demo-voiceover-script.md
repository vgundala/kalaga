# End-to-End Demo & Voiceover Script (`LedgerLite`)

## Demo Setup (2-Window Recording)

1. From the Kalaga repo root, point the studio at a live-build capture archive and start it:
   ```bash
   export KALA_DEMO_CAPTURE=/path/to/.handoff-capture/<stamp>
   node scripts/demo-studio.mjs
   ```
2. Open `http://127.0.0.1:4310` in Chrome or Firefox for your screen-recorded window.
3. Press **`T`** (or open `http://127.0.0.1:4310/?teleprompter=1`) and drag the **Voiceover Teleprompter** window to a second monitor or outside your capture region. It syncs live over `BroadcastChannel` and lets you pause, resume, or step chapters without moving your cursor onto the recorded stage.
4. Press **`M`** to switch to **Hold Mode** while recording voiceover so each chapter stops cleanly at the handoff seam until you press **`Space`**.
5. Press **`C`** on the main stage to hide all buttons and chrome during capture.

Prefer recording a raw terminal window with zero browser UI? Run:
```bash
node scripts/demo-studio.mjs --cli --step
```
in a `120x40` (or larger) terminal.

---

## Timed Voiceover Script (~2m 15s)

### Cold Open (0:00 - 0:12, hold on Chapter 1 start)
> "Most developers pay for two or three coding CLIs, and every time one hits a rate limit or gets stuck, switching tools means re-explaining your entire repo from scratch. Here is Kalaga building a 1,700-line SQLite double-entry accounting system across Antigravity, Cursor, and Grok with zero manual state edits."

### Chapter 1 — `kala run agy` (0:12 - 0:34)
- **On screen:** Workspace trust prompt (`[y/N] y`), `Kalaga session context` inject inside Antigravity, `src/db.js` + `src/ledger.js` created, `.kala/state.yaml` flips to Milestone 2.
- **Voiceover:**
  > "We start LedgerLite with `kala run agy`. Kalaga records workspace trust once and hands Antigravity the initial goal from `.kala/state.yaml`. Antigravity builds the four-table SQLite schema and double-entry posting engine, verifies balances, and writes the exact module exports back into `state.yaml` for the next agent."

### Chapter 2 — `kala switch cursor` (0:34 - 0:56)
- **On screen:** `Kalaga handoff from agy` lands inside Cursor Agent; right-hand file list lights up `+ src/invoices.js` and `+ src/export.js`; `sessions.cursor.id` appears in `state.yaml`.
- **Voiceover:**
  > "Mid-build, we switch vendors with `kala switch cursor`. No copy-paste, no prompt surgery. Cursor reads `.kala/state.yaml` and `src/ledger.js`, builds the invoice state machine and RFC-4180 CSV exporter, and Kalaga captures Cursor's session ID on exit."

### Chapter 3 — `kala switch grok` (0:56 - 1:18)
- **On screen:** Top of terminal prints `kalaga: asking cursor for handoff summary (up to 15s)...` then `kalaga: live-ask (cursor) merged`; Grok Build 1.0.92 launches; turn cuts off before Milestone 3 files exist.
- **Voiceover:**
  > "Watch the top of the terminal on `kala switch grok`. Because Cursor left a fresh session ID, Kalaga resumes Cursor headlessly for seven seconds, merges a structured YAML summary, and launches Grok. Then we cut Grok off mid-thought before it writes a single file, the same thing that happens when a session drops or hits a hard quota wall."

### Chapter 4 — `kala switch agy` Recovery (1:18 - 1:40)
- **On screen:** Antigravity receives `Kalaga handoff from grok`, sees Milestone 3 still queued in `next_step`, writes `+ src/server.js` and `+ bin/ledgerlite`, advances `next_step` to Milestone 4.
- **Voiceover:**
  > "Because Milestone 3 never landed on disk, `state.yaml` still holds Milestone 3 as `next_step`. Switching back to `agy` recovers automatically: Antigravity inspects the repo, sees the HTTP server and CLI are still missing, builds and tests both, and advances the baton to Milestone 4."

### Chapter 5 — `kala switch grok` Test Suite (1:40 - 2:00)
- **On screen:** Grok writes `+ tests/ledgerlite.test.js` (509 lines) and `+ README.md`, runs `npm test` (`7/7` pass), flips `status: COMPLETED`.
- **Voiceover:**
  > "Now we hand Milestone 4 back to Grok. Grok reads modules authored by both Antigravity and Cursor, writes 509 lines of adversarial double-entry, CSV, CLI, and HTTP tests plus the README, gets seven out of seven green on the first run, and marks `state.yaml` `COMPLETED`."

### Chapter 6 — `kala switch agy` Finale (2:00 - 2:18)
- **On screen:** Full circle back to `agy`; `agy` respects `negative_constraints`, runs `npm test` (`7/7` in `1.0s`), exits cleanly; terminal prints `kala status` and `kala why` (`grok 182k/250k`, `cursor 7.5k/250k`, `agy owns handoff`).
- **Voiceover:**
  > "One final `kala switch agy` brings us full circle to where we began. Antigravity sees the mission is complete, honors every guardrail, runs the full test suite in one second, and signs off clean. Down in the ledger, Kalaga tracks real token headroom across every tool. Seventeen hundred lines of working software, built across three rival CLIs and six live switches, as one continuous flow. Switch agents whenever you choose, and ship without losing your stride."
