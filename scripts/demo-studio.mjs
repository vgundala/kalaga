#!/usr/bin/env node
// Kalaga End-to-End Demo Studio (Blurred Privacy + Neural Male Voiceover + Deterministic Video Hook)
// Zero npm dependencies.
//
// Usage:
//   node scripts/demo-studio.mjs                     # start Web Stage on http://127.0.0.1:4310
//   node scripts/demo-studio.mjs --port 4400         # custom port
//   node scripts/demo-studio.mjs --cli               # replay directly in current terminal (120x40+)

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';

// Local capture archive from a live multi-CLI build. Pass --capture or set KALA_DEMO_CAPTURE.
const DEFAULT_CAPTURE = process.env.KALA_DEMO_CAPTURE || '';

// Exact byte-length replacements so PTY column geometry & ANSI box borders never shift by 1 byte,
// while ensuring real emails, home paths, session IDs, and CLI account/tier strings never appear.
const EXACT_BYTE_SWAPS = [
  ['gundala@gmail.com', 'account@email.com'],
  ['/home/vinay', '/home/user0'],
  ['gundala', 'account'],
  ['vinay', 'user0'],
  ['(Google AI Pro)', '(CLI Plan Tier)'],
  ['You are currently not signed in.', 'CLI account session check active'],
  ['Signing in...', 'Auth check...'],
  ['[Click here to Upgrade]', '[CLI Account Plan Info]'],
  ['Upgrade for more usage.', 'Account plan telemetry.'],
  ['f09f192c-842f-4c61-8119-c1e1502090cb', '00000000-0000-4000-8000-000000000001'],
  ['01a20f1b-2c82-7242-a891-34fe425d231e', '00000000-0000-4000-8000-000000000002'],
];

for (const [from, to] of EXACT_BYTE_SWAPS) {
  if (Buffer.byteLength(from) !== Buffer.byteLength(to)) {
    throw new Error(`Byte swap length mismatch: ${from} vs ${to}`);
  }
}

function scrubBuffer(buf) {
  let out = Buffer.from(buf);
  for (const [from, to] of EXACT_BYTE_SWAPS) {
    const needle = Buffer.from(from, 'utf8');
    const repl = Buffer.from(to, 'utf8');
    let idx = 0;
    while ((idx = out.indexOf(needle, idx)) !== -1) {
      repl.copy(out, idx);
      idx += repl.length;
    }
  }
  return out;
}

function scrubText(text) {
  return scrubBuffer(Buffer.from(text, 'utf8')).toString('utf8');
}

const CHAPTERS = [
  {
    id: '01-agy-m1',
    num: 1,
    badge: 'kala run agy',
    agent: 'Antigravity (Gemini 4 Neon)',
    title: 'Seed & Milestone 1: SQLite Double-Entry Core',
    beforeDir: '01-agy-m1-before',
    afterDir: '01-agy-m1-after',
    ptyDir: '01-agy-m1',
    realSec: 149,
    voiceover:
      "Every builder hits the moment where one coding agent stalls or burns through its window. Kalaga turns separate AI CLIs into one unstoppable relay team. Watch us build LedgerLite. It's a real four-milestone Node 24 accounting system built from scratch. One command, kala run agy, trusts the workspace and hands Antigravity the mission. It builds the four-table SQLite core and double-entry engine and logs every contract into state.yaml for the next teammate.",
    highlight: 'Trust grant saved · package.json, src/db.js, src/ledger.js built · state.yaml updated',
  },
  {
    id: '02-cursor-m2',
    num: 2,
    badge: 'kala switch cursor',
    agent: 'Cursor Agent',
    title: 'Switch #1: Invoicing Lifecycle & RFC-4180 CSV',
    beforeDir: '02-cursor-m2-before',
    afterDir: '02-cursor-m2-after',
    ptyDir: '02-cursor-m2',
    realSec: 280,
    voiceover:
      'Now mid-build we pass the baton to a second vendor with kala switch cursor. Zero copy-paste and zero context lost. Kalaga injects the handoff from Antigravity and Cursor picks up at full stride. It reads the ledger schema, builds the invoice lifecycle and RFC-4180 CSV exporter, and saves its live session ID on exit.',
    highlight: 'Kalaga handoff from agy · src/invoices.js + src/export.js built · Cursor session ID captured',
  },
  {
    id: '03-grok-m3',
    num: 3,
    badge: 'kala switch grok',
    agent: 'Grok Build 1.0.92 (Grok 4.7)',
    title: 'Switch #2: Live-Ask Resume + Mid-Turn Cut',
    beforeDir: '03-grok-m3-before',
    afterDir: '03-grok-m3-after',
    ptyDir: '03-grok-m3',
    realSec: 301,
    voiceover:
      'Watch the top of the terminal as we fire kala switch grok. Kalaga wakes Cursor back up for seven seconds, merges a fresh handoff summary, and launches Grok 4.7. Then right in the middle of deep reasoning we cut Grok off cold before a single file hits disk. In a normal workflow, that crash costs you twenty minutes of reconstruction.',
    highlight: 'live-ask (cursor) merged in ~7s · Grok interrupted before writing Milestone 3',
  },
  {
    id: '04-agy-m4',
    num: 4,
    badge: 'kala switch agy',
    agent: 'Antigravity (Recovery)',
    title: 'Switch #3: Automatic Self-Healing After Interruption',
    beforeDir: '04-agy-m4-before',
    afterDir: '04-agy-m4-after',
    ptyDir: '04-agy-m4',
    realSec: 317,
    voiceover:
      'With Kalaga, nothing falls through the cracks. Because Milestone 3 never landed on disk, state.yaml holds the line automatically. We run kala switch agy and Antigravity steps right back in. It inspects the repo, spots the missing HTTP server and CLI, builds and verifies every route, and advances the baton to Milestone 4.',
    highlight: 'Zero manual state edits · Milestone 3 recovered · src/server.js + bin/ledgerlite verified',
  },
  {
    id: '05-grok-m4',
    num: 5,
    badge: 'kala switch grok',
    agent: 'Grok Build 1.0.92 (Grok 4.7)',
    title: 'Switch #4: 509-Line Adversarial Test Suite & Docs',
    beforeDir: '05-grok-m4-before',
    afterDir: '05-grok-m4-after',
    ptyDir: '05-grok-m4',
    realSec: 332,
    voiceover:
      'Now we bring Grok back to finish strong on Milestone 4. Reading code authored by both Antigravity and Cursor, Grok writes 509 lines of adversarial tests across the ledger, CSV exports, the CLI, and the HTTP server. Seven out of seven tests pass on the very first run and state.yaml flips to COMPLETED.',
    highlight: 'tests/ledgerlite.test.js (509 lines) + README.md · 7/7 passing · status: COMPLETED',
  },
  {
    id: '06-agy-verify',
    num: 6,
    badge: 'kala switch agy',
    agent: 'Antigravity (Final Audit)',
    title: 'Full Circle: Return to First CLI & Token Ledger',
    beforeDir: '06-agy-verify-before',
    afterDir: '07-final',
    ptyDir: '06-agy-verify',
    realSec: 54,
    appendFinale: true,
    voiceover:
      'One final kala switch agy brings us full circle to where we began. Antigravity sees the mission is complete, honors every guardrail, runs the full test suite in one second, and signs off clean. Down in the ledger, Kalaga tracks real token headroom across every tool. Seventeen hundred lines of working software, built across three rival CLIs and six live switches, as one continuous flow. Switch agents whenever you choose, and ship without losing your stride.',
    highlight: 'Returned to agy · 7/7 tests green in 1.0s · 0 backslash drift · accurate headroom ranking',
  },
];

function parseArgs(argv) {
  const out = { capture: DEFAULT_CAPTURE, port: 4310, cli: false, step: false, speed: 1.0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cli') out.cli = true;
    else if (a === '--step') out.step = true;
    else if (a === '--port' && argv[i + 1]) out.port = Number(argv[++i]);
    else if (a === '--capture' && argv[i + 1]) out.capture = path.resolve(argv[++i]);
    else if (a === '--speed' && argv[i + 1]) out.speed = Math.max(0.2, Number(argv[++i]) || 1.0);
  }
  return out;
}

function readSafe(p, fallback = '') {
  try { return scrubText(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function findMarkerEnd(buf) {
  for (const needle of ['Kalaga session context', 'Kalaga handoff from']) {
    const idx = buf.indexOf(Buffer.from(needle));
    if (idx >= 0) return Math.min(buf.length, idx + 2200);
  }
  return Math.min(buf.length, 4096);
}

function buildFinaleAnsi(capDir) {
  const testOut = readSafe(path.join(capDir, 'FINAL-NPM-TEST.txt')).trim();
  const statusOut = readSafe(path.join(capDir, '08-final-status.txt'), readSafe(path.join(capDir, '07-final', 'kala-status.txt'))).trim();
  const whyOut = readSafe(path.join(capDir, '08-final-why.txt'), readSafe(path.join(capDir, '07-final', 'kala-why.txt'))).trim();
  const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
  return Buffer.from(
    '\r\n\x1b[1;36m$ npm test\x1b[0m\r\n' +
    crlf(testOut) +
    '\r\n\r\n\x1b[1;36m$ kala status\x1b[0m\r\n' +
    crlf(statusOut) +
    '\r\n\r\n\x1b[1;36m$ kala why\x1b[0m\r\n' +
    crlf(whyOut) +
    '\r\n',
    'utf8'
  );
}

function loadManifest(capDir) {
  const finaleBuf = buildFinaleAnsi(capDir);
  let audioMeta = [];
  try {
    audioMeta = JSON.parse(fs.readFileSync(path.join(capDir, 'demo-audio', 'audio-manifest.json'), 'utf8'));
  } catch { /* optional */ }
  return CHAPTERS.map((ch, idx) => {
    const rawPty = scrubBuffer(fs.readFileSync(path.join(capDir, ch.ptyDir, 'pty.log')));
    const ptyBuf = ch.appendFinale ? Buffer.concat([rawPty, finaleBuf]) : rawPty;
    const seamEnd = findMarkerEnd(rawPty);
    const tailStart = Math.max(seamEnd, rawPty.length - 3200);
    const beforeState = readSafe(path.join(capDir, ch.beforeDir, 'state.yaml'));
    const afterState = readSafe(path.join(capDir, ch.afterDir, 'state.yaml'));
    const beforeTree = readSafe(path.join(capDir, ch.beforeDir, 'tree.txt')).trim().split('\n').filter(Boolean);
    const afterTree = readSafe(path.join(capDir, ch.afterDir, 'tree.txt')).trim().split('\n').filter(Boolean);
    const statusBefore = readSafe(path.join(capDir, ch.beforeDir, 'kala-status.txt'));
    const whyBefore = readSafe(path.join(capDir, ch.beforeDir, 'kala-why.txt'));
    const statusAfter = ch.appendFinale
      ? readSafe(path.join(capDir, '08-final-status.txt'), readSafe(path.join(capDir, ch.afterDir, 'kala-status.txt')))
      : readSafe(path.join(capDir, ch.afterDir, 'kala-status.txt'));
    const whyAfter = ch.appendFinale
      ? readSafe(path.join(capDir, '08-final-why.txt'), readSafe(path.join(capDir, ch.afterDir, 'kala-why.txt')))
      : readSafe(path.join(capDir, ch.afterDir, 'kala-why.txt'));
    const mp3File = path.join(capDir, 'demo-audio', `vo-${idx}.mp3`);
    const wavFile = path.join(capDir, 'demo-audio', `vo-${idx}.wav`);
    const durationMs = audioMeta[idx]?.durationMs ?? 22000;
    const frames12fps = audioMeta[idx]?.frames12fps ?? Math.round((durationMs / 1000) * 12);
    return {
      index: idx,
      ...ch,
      durationMs,
      frames12fps,
      hasAudio: fs.existsSync(mp3File),
      ptyBytes: ptyBuf.length,
      seamEnd,
      tailStart,
      rawLength: rawPty.length,
      beforeState,
      afterState,
      beforeTree,
      afterTree,
      statusBefore,
      whyBefore,
      statusAfter,
      whyAfter,
      _buf: ptyBuf,
      _mp3: mp3File,
      _wav: wavFile,
    };
  });
}

// ---------- CLI replay mode ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function streamSlice(buf, start, end, durationMs) {
  if (end <= start) return;
  const steps = Math.max(1, Math.round(durationMs / 25));
  const stepBytes = Math.ceil((end - start) / steps);
  for (let pos = start; pos < end; pos += stepBytes) {
    process.stdout.write(buf.subarray(pos, Math.min(end, pos + stepBytes)));
    await sleep(durationMs / steps);
  }
}

async function waitEnter(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  await new Promise((resolve) => rl.question(promptText, () => { rl.close(); resolve(); }));
}

async function runCliPlayer(chapters, opts) {
  const k = 1 / opts.speed;
  for (const ch of chapters) {
    process.stdout.write('\x1b[?1049l\x1b[2J\x1b[H');
    process.stdout.write(
      `\x1b[1;30;46m CHAPTER ${ch.num}/6 \x1b[0m \x1b[1m${ch.badge}\x1b[0m — ${ch.title} \x1b[2m(real run: ${ch.realSec}s)\x1b[0m\r\n` +
      `\x1b[33mVoiceover:\x1b[0m ${ch.voiceover}\r\n\r\n`
    );
    await sleep(1600 * k);
    await streamSlice(ch._buf, 0, ch.seamEnd, 3200 * k);
    await sleep(1500 * k);
    await streamSlice(ch._buf, ch.seamEnd, ch.tailStart, 8500 * k);
    await streamSlice(ch._buf, ch.tailStart, ch.rawLength, 2200 * k);
    if (ch._buf.length > ch.rawLength) {
      process.stdout.write('\x1b[?1049l\r\n');
      await streamSlice(ch._buf, ch.rawLength, ch._buf.length, 3500 * k);
    }
    if (opts.step && ch.num < chapters.length) {
      await waitEnter(`\r\n\x1b[1;32m[Chapter ${ch.num} complete — press Enter for Chapter ${ch.num + 1}]\x1b[0m `);
    } else {
      await sleep(2400 * k);
    }
  }
  process.stdout.write('\x1b[?1049l\r\n\x1b[1;32mDemo replay complete.\x1b[0m\r\n');
}

// ---------- Web Stage HTML ----------
const STAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Kalaga — Multi-CLI Live Build Demo (LedgerLite)</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css" />
<style>
  :root {
    --bg: #0b0e14;
    --panel: #111621;
    --panel-2: #161d2b;
    --border: #232c3d;
    --text: #e6edf3;
    --muted: #8b98ad;
    --accent: #38bdf8;
    --green: #34d399;
    --amber: #fbbf24;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #05070b;
    color: var(--text);
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    width: 100vw;
    height: 100vh;
    display: flex;
    justify-content: center;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
  #stage-root {
    width: 100%;
    max-width: 2560px;
    height: 100vh;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    padding: 8px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-shrink: 0;
    min-width: 0;
  }
  footer {
    display: none;
  }
  body.clean header .chrome-controls {
    display: none;
  }
  body.video #btn-audio,
  body.video #btn-play,
  body.video #btn-mode,
  body.video #btn-speed,
  body.video #btn-tp,
  body.video #btn-clean,
  body.video #keys-hint {
    display: none;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .pill {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
    padding: 4px 9px;
    border-radius: 6px;
    background: rgba(56, 189, 248, 0.14);
    color: var(--accent);
    border: 1px solid rgba(56, 189, 248, 0.35);
    font-weight: 700;
    white-space: nowrap;
  }
  .chapter-title {
    font-size: 15.5px;
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chapter-sub {
    font-size: 12px;
    color: var(--muted);
  }
  .chapters-nav {
    display: flex;
    gap: 5px;
    flex-wrap: nowrap;
  }
  button {
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 5px 9px;
    font-size: 12px;
    cursor: pointer;
    font-weight: 600;
    white-space: nowrap;
  }
  button:hover { border-color: var(--accent); }
  button.active {
    background: rgba(56, 189, 248, 0.18);
    border-color: var(--accent);
    color: var(--accent);
  }
  main {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1.04fr) minmax(0, 0.96fr);
    gap: 12px;
    padding: 10px 14px;
    min-height: 0;
    min-width: 0;
  }
  .pane {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  .pane-head {
    padding: 9px 14px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13.5px;
    font-weight: 500;
    color: var(--muted);
    background: rgba(255, 255, 255, 0.015);
  }
  .dots { display: flex; gap: 6px; align-items: center; }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .dot.r { background: #ef4444; }
  .dot.y { background: #f59e0b; }
  .dot.g { background: #10b981; }
  #term-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #090c10;
    padding: 10px 12px;
    overflow: hidden;
  }
  #term-stage {
    position: relative;
    display: inline-block;
  }
  #blur-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 20;
    overflow: hidden;
  }
  .term-blur {
    position: absolute;
    background: #090c10;
    border-radius: 3px;
    overflow: hidden;
    display: flex;
    align-items: center;
    padding: 0 2px;
  }
  .term-blur span {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: var(--term-font, 15.5px);
    line-height: 1;
    color: #9fb0c7;
    filter: blur(5px);
    user-select: none;
    white-space: pre;
  }
  .inline-blur {
    display: inline-block;
    filter: blur(5px);
    user-select: none;
    color: #9fb0c7;
  }
  .inspector {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    overflow-y: auto;
    flex: 1;
    min-width: 0;
  }
  .top-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .bottom-ledger-grid {
    display: grid;
    grid-template-columns: 1.15fr 0.85fr;
    gap: 10px;
  }
  .card {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 11px;
    min-width: 0;
  }
  .card.flash {
    border-color: var(--green);
    box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.25);
    transition: border-color 0.4s ease;
  }
  .card h3 {
    margin: 0 0 4px 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    display: flex;
    justify-content: space-between;
  }
  pre {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1.32;
    white-space: pre-wrap;
    word-break: break-word;
    color: #eef2f7;
  }
  .files-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .file-chip {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11.5px;
    font-weight: 500;
    padding: 2px 7px;
    border-radius: 5px;
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--border);
    color: var(--text);
  }
  .file-chip.new {
    border-color: rgba(52, 211, 153, 0.6);
    background: rgba(52, 211, 153, 0.12);
    color: var(--green);
  }
  .vo-box {
    flex: 1;
    font-size: 16px;
    line-height: 1.45;
    color: #f8fafc;
  }
  .vo-label {
    font-size: 12.5px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--amber);
    margin-right: 10px;
  }
  .beat-tag {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    font-weight: 600;
    color: var(--green);
  }
  .progress-bar {
    height: 3px;
    background: #1b2230;
    width: 100%;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--green));
    width: 0%;
    transition: width 0.08s linear;
  }
  #sound-gate {
    position: fixed;
    bottom: 64px;
    right: 24px;
    z-index: 50;
    background: rgba(14, 165, 233, 0.95);
    color: #041019;
    font-weight: 700;
    padding: 10px 16px;
    border-radius: 8px;
    cursor: pointer;
    box-shadow: 0 8px 24px rgba(0,0,0,0.45);
    display: none;
  }
  /* Teleprompter pop-out view */
  body.teleprompter main, body.teleprompter .progress-bar { display: none; }
  body.teleprompter { overflow: auto; padding: 24px; gap: 18px; }
  .tp-card {
    background: var(--panel);
    border: 2px solid var(--accent);
    border-radius: 12px;
    padding: 24px;
  }
  .tp-vo {
    font-size: 26px;
    line-height: 1.5;
    font-weight: 500;
    color: #ffffff;
    margin: 14px 0;
  }
  .tp-meta {
    font-size: 14px;
    color: var(--amber);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
</head>
<body>
<div id="stage-root">
<header>
  <div class="brand">
    <span class="pill" id="cmd-pill">kala run agy</span>
    <div>
      <div class="chapter-title" id="ch-title">Loading LedgerLite capture…</div>
      <div class="chapter-sub" id="ch-sub"></div>
    </div>
  </div>
  <div class="chrome-controls" style="display:flex;align-items:center;gap:8px;">
    <div class="chapters-nav" id="ch-nav"></div>
    <button id="btn-audio" class="active">Voiceover: ON</button>
    <button id="btn-play">Pause (Space)</button>
    <button id="btn-mode" title="Toggle Auto-play vs Hold at each seam">Mode: Auto</button>
    <button id="btn-speed">Speed: 1x</button>
    <button id="btn-tp" title="Open synced voiceover teleprompter in separate window (T)">Pop-out Script (T)</button>
    <button id="btn-clean" title="Hide controls for clean screen recording (C)">Record Mode (C)</button>
  </div>
</header>
<div class="progress-bar"><div class="progress-fill" id="prog"></div></div>
<main>
  <section class="pane">
    <div class="pane-head">
      <div class="dots">
        <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
        <span style="margin-left:8px;font-family:monospace;" id="term-caption">ledgerlite — 120×40 PTY</span>
      </div>
      <span class="beat-tag" id="beat-tag">Beat 1 · Seam</span>
    </div>
    <div id="term-wrap">
      <div id="term-stage">
        <div id="terminal"></div>
        <div id="blur-layer"></div>
      </div>
    </div>
  </section>
  <aside class="pane">
    <div class="pane-head">
      <span>Live Handoff State (<code style="color:var(--accent)">.kala/state.yaml</code>)</span>
      <span id="state-phase-tag" style="font-family:monospace;color:var(--amber)">before switch</span>
    </div>
    <div class="inspector">
      <div class="top-cards">
        <div class="card" id="card-highlight">
          <h3><span>Seam Telemetry</span><span id="real-dur"></span></h3>
          <div id="seam-highlight" style="font-size:14px;color:var(--green);font-weight:600;line-height:1.4;"></div>
        </div>
        <div class="card" id="card-files">
          <h3><span>Project Files</span><span id="file-count"></span></h3>
          <div class="files-grid" id="files-grid"></div>
        </div>
      </div>
      <div class="card" id="card-state">
        <h3><span>.kala/state.yaml</span><span>0 backslash drift</span></h3>
        <pre id="state-yaml"></pre>
      </div>
      <div class="card" id="card-ledger">
        <h3><span>kala status / kala why</span><span>rolling window</span></h3>
        <div class="bottom-ledger-grid">
          <pre id="ledger-status-text"></pre>
          <pre id="ledger-why-text"></pre>
        </div>
      </div>
    </div>
  </aside>
</main>
<footer>
  <div class="vo-box">
    <span class="vo-label">Voiceover</span>
    <span id="vo-text"></span>
  </div>
  <div id="keys-hint" style="font-size:11px;color:var(--muted);white-space:nowrap;">
    Keys: <b>Space</b> Play/Pause · <b>1-6</b> Chapter · <b>M</b> Auto/Hold · <b>C</b> Clean Record
  </div>
</footer>
</div>
<div id="sound-gate">Click to unmute inspirational voiceover</div>

<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script>
(async function () {
  const params = new URLSearchParams(location.search);
  const isTeleprompter = params.get('teleprompter') === '1';
  const isRenderMode = params.get('render') === '1';
  if (params.get('clean') === '1') document.body.classList.add('clean');
  if (params.get('video') === '1') document.body.classList.add('video');

  const bus = new BroadcastChannel('kalaga-demo');
  const chapters = await fetch('/api/manifest').then((r) => r.json());

  // Patterns blurred everywhere on screen (emails, /home/*, CLI account/plan banners, session UUIDs)
  const BLUR_PATTERNS = [
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g,
    /\\/home\\/[A-Za-z0-9_.-]+(?:\\/[A-Za-z0-9_.-]+)*/g,
    /\\(CLI Plan Tier\\)/g,
    /CLI account session check active/g,
    /Auth check\\.\\.\\./g,
    /\\[CLI Account Plan Info\\]/g,
    /Account plan telemetry\\./g,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  ];

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderBlurredPre(el, rawText) {
    const intervals = [];
    for (const rx of BLUR_PATTERNS) {
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(rawText)) !== null) {
        intervals.push([m.index, m.index + m[0].length]);
      }
    }
    if (!intervals.length) { el.textContent = rawText; return; }
    intervals.sort((a, b) => a[0] - b[0]);
    const merged = [intervals[0]];
    for (let i = 1; i < intervals.length; i++) {
      const prev = merged[merged.length - 1];
      if (intervals[i][0] <= prev[1]) prev[1] = Math.max(prev[1], intervals[i][1]);
      else merged.push(intervals[i]);
    }
    let html = '';
    let pos = 0;
    for (const [s, e] of merged) {
      html += escapeHtml(rawText.slice(pos, s));
      html += '<span class="inline-blur">' + escapeHtml(rawText.slice(s, e)) + '</span>';
      pos = e;
    }
    html += escapeHtml(rawText.slice(pos));
    el.innerHTML = html;
  }

  if (isTeleprompter) {
    document.body.classList.add('teleprompter');
    document.body.innerHTML = \`
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h2 style="margin:0;font-size:18px;">Kalaga Demo — Voiceover Teleprompter (Synced)</h2>
        <div style="display:flex;gap:8px;">
          <button onclick="window._cmd('prev')">← Prev</button>
          <button onclick="window._cmd('toggle')" id="tp-play">Play / Pause (Space)</button>
          <button onclick="window._cmd('next')">Next →</button>
          <button onclick="window._cmd('mode')" id="tp-mode">Toggle Auto/Hold</button>
        </div>
      </div>
      <div class="tp-card">
        <div class="tp-meta" id="tp-meta">Chapter 1/6</div>
        <div class="tp-vo" id="tp-vo"></div>
        <div style="font-size:14px;color:#34d399;" id="tp-hi"></div>
      </div>
      <div id="tp-upcoming" style="color:#8b98ad;font-size:15px;padding:0 8px;"></div>
    \`;
    window._cmd = (type) => bus.postMessage({ cmd: type });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); window._cmd('toggle'); }
      if (e.code === 'ArrowRight') window._cmd('next');
      if (e.code === 'ArrowLeft') window._cmd('prev');
    });
    function renderTp(idx, beat, paused, holdMode) {
      const ch = chapters[idx] || chapters[0];
      const next = chapters[idx + 1];
      document.getElementById('tp-meta').textContent =
        \`CHAPTER \${ch.num}/6 · \${ch.badge} · \${ch.agent} · [\${beat}] \${paused ? '(PAUSED)' : '(PLAYING)'} · Mode: \${holdMode ? 'Hold at seam' : 'Auto'}\`;
      document.getElementById('tp-vo').textContent = ch.voiceover;
      document.getElementById('tp-hi').textContent = 'On screen: ' + ch.highlight;
      document.getElementById('tp-upcoming').textContent = next
        ? \`Next up (Ch \${next.num} — \${next.badge}): \${next.voiceover}\`
        : 'Final chapter — concludes on npm test (7/7) + kala status + kala why.';
    }
    renderTp(0, 'Ready', false, false);
    bus.onmessage = (ev) => {
      if (ev.data && typeof ev.data.idx === 'number') {
        renderTp(ev.data.idx, ev.data.beat, ev.data.paused, ev.data.holdMode);
      }
    };
    return;
  }

  function computeTermFont() {
    const availW = Math.min(window.innerWidth, 2560) * 0.50 - 36;
    const availH = window.innerHeight - 130;
    const byW = availW / (120 * 0.605);
    const byH = availH / (40 * 1.16);
    return Math.max(10, Math.min(16, Math.floor(Math.min(byW, byH) * 2) / 2));
  }

  const initialFont = computeTermFont();
  document.documentElement.style.setProperty('--term-font', initialFont + 'px');

  const term = new window.Terminal({
    cols: 120,
    rows: 40,
    fontSize: initialFont,
    fontWeight: '500',
    lineHeight: 1.06,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    theme: {
      background: '#090c10',
      foreground: '#eef2f7',
      cursor: '#38bdf8',
    },
    convertEol: false,
    scrollback: 1500,
  });
  term.open(document.getElementById('terminal'));

  const blurLayer = document.getElementById('blur-layer');
  function updateTermBlurs() {
    const screenEl = document.querySelector('#terminal .xterm-screen');
    if (!screenEl) return;
    const cellW = screenEl.clientWidth / term.cols;
    const cellH = screenEl.clientHeight / term.rows;
    const offX = screenEl.offsetLeft;
    const offY = screenEl.offsetTop;
    const active = term.buffer.active;
    const frag = document.createDocumentFragment();
    for (let r = 0; r < term.rows; r++) {
      const line = active.getLine(active.viewportY + r);
      if (!line) continue;
      const str = line.translateToString(false);
      for (const rx of BLUR_PATTERNS) {
        rx.lastIndex = 0;
        let m;
        while ((m = rx.exec(str)) !== null) {
          const box = document.createElement('div');
          box.className = 'term-blur';
          box.style.left = (offX + m.index * cellW - 2).toFixed(1) + 'px';
          box.style.top = (offY + r * cellH - 1).toFixed(1) + 'px';
          box.style.width = (m[0].length * cellW + 4).toFixed(1) + 'px';
          box.style.height = (cellH + 2).toFixed(1) + 'px';
          const sp = document.createElement('span');
          sp.textContent = m[0];
          box.appendChild(sp);
          frag.appendChild(box);
        }
      }
    }
    blurLayer.replaceChildren(frag);
  }

  let curIdx = 0;
  let paused = false;
  let holdMode = false;
  let audioEnabled = true;
  let speed = 1.0;
  let runToken = 0;
  const audioEl = new Audio();
  audioEl.preload = 'auto';

  const nav = document.getElementById('ch-nav');
  chapters.forEach((ch, idx) => {
    const b = document.createElement('button');
    b.textContent = \`\${ch.num}. \${ch.badge.replace('kala ', '')}\`;
    b.onclick = () => playChapter(idx);
    nav.appendChild(b);
  });

  function syncBroadcast(beat) {
    document.getElementById('beat-tag').textContent = beat;
    bus.postMessage({ idx: curIdx, beat, paused, holdMode });
  }

  window.addEventListener('resize', () => {
    const nf = computeTermFont();
    if (term.options.fontSize !== nf) {
      document.documentElement.style.setProperty('--term-font', nf + 'px');
      term.options.fontSize = nf;
    }
    updateTermBlurs();
  });

  function compactYamlForStage(raw) {
    // Collapse multi-line modified_files list to inline flow list and cap ultra-long
    // duplicate prose lines so all YAML sections + kala status/why fit with zero scroll cutoff.
    const lines = raw.split('\\n').filter((ln) => !ln.startsWith('#'));
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.trim() === 'modified_files:') {
        const items = [];
        while (i + 1 < lines.length && /^\\s+-\\s+/.test(lines[i + 1])) {
          items.push(lines[++i].replace(/^\\s+-\\s+/, '').trim());
        }
        out.push(\`modified_files: [\${items.join(', ')}]\`);
        continue;
      }
      const cap = ln.trimStart().startsWith('notes:') ? 155 : 132;
      out.push(ln.length > cap ? ln.slice(0, cap - 2).replace(/\\s+\\S*$/, '') + '…"' : ln);
    }
    return out.join('\\n').trim();
  }

  function renderInspector(ch, phase, animate = true) {
    const isAfter = phase === 'after';
    document.getElementById('state-phase-tag').textContent = isAfter ? 'after handoff' : 'before switch';
    document.getElementById('state-phase-tag').style.color = isAfter ? '#34d399' : '#fbbf24';
    document.getElementById('seam-highlight').textContent = ch.highlight;
    document.getElementById('real-dur').textContent = \`real build: \${ch.realSec}s\`;
    renderBlurredPre(document.getElementById('state-yaml'), compactYamlForStage(isAfter ? ch.afterState : ch.beforeState));
    renderBlurredPre(document.getElementById('ledger-status-text'), (isAfter ? ch.statusAfter : ch.statusBefore).trim());
    renderBlurredPre(document.getElementById('ledger-why-text'), (isAfter ? ch.whyAfter : (ch.whyBefore || '')).trim());

    const prevSet = new Set(ch.beforeTree);
    const files = isAfter ? ch.afterTree : ch.beforeTree;
    document.getElementById('file-count').textContent = \`\${files.length} files\`;
    const grid = document.getElementById('files-grid');
    grid.innerHTML = '';
    for (const f of files) {
      const span = document.createElement('span');
      const clean = f.replace(/^\\.\\//, '');
      span.className = 'file-chip' + (isAfter && !prevSet.has(f) ? ' new' : '');
      span.textContent = (isAfter && !prevSet.has(f) ? '+ ' : '') + clean;
      grid.appendChild(span);
    }
    if (isAfter && animate) {
      for (const id of ['card-files', 'card-state', 'card-ledger']) {
        const el = document.getElementById(id);
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 900);
      }
    }
  }

  function setChapterHeader(idx) {
    const ch = chapters[idx];
    [...nav.children].forEach((b, i) => b.classList.toggle('active', i === idx));
    document.getElementById('cmd-pill').textContent = ch.badge;
    document.getElementById('ch-title').textContent = \`Chapter \${ch.num}/6 — \${ch.title}\`;
    document.getElementById('ch-sub').textContent = ch.agent;
    document.getElementById('vo-text').textContent = ch.voiceover;
  }

  // Compute exact byte offset + beat label + inspector phase for any timestamp tMs within a chapter
  function timelineAt(ch, tMs) {
    const D = ch.durationMs;
    const hasFin = ch.ptyBytes > ch.rawLength;
    const tSeamWrite = 3600;
    const tSeamHold = 5400;
    const tExitStart = hasFin ? D - 6200 : D - 3600;
    const tExitDone = hasFin ? D - 4000 : D - 1400;
    const tFinDone = D - 800;

    if (tMs <= tSeamWrite) {
      const p = Math.max(0, tMs / tSeamWrite);
      return { byte: Math.round(ch.seamEnd * p), phase: 'before', beat: 'Beat 1 · Kalaga Seam & Inject', finaleBreak: false };
    }
    if (tMs <= tSeamHold) {
      return { byte: ch.seamEnd, phase: 'before', beat: 'Beat 1 · Handoff Prompt Ready', finaleBreak: false };
    }
    if (tMs <= tExitStart) {
      const p = (tMs - tSeamHold) / Math.max(1, tExitStart - tSeamHold);
      return {
        byte: ch.seamEnd + Math.round((ch.tailStart - ch.seamEnd) * p),
        phase: 'before',
        beat: 'Beat 2 · Agent Building (Fast-Forward)',
        finaleBreak: false,
      };
    }
    if (tMs <= tExitDone) {
      const p = (tMs - tExitStart) / Math.max(1, tExitDone - tExitStart);
      return {
        byte: ch.tailStart + Math.round((ch.rawLength - ch.tailStart) * p),
        phase: p > 0.85 ? 'after' : 'before',
        beat: 'Beat 3 · Clean Exit & State Update',
        finaleBreak: false,
      };
    }
    if (hasFin) {
      const p = Math.min(1, (tMs - tExitDone) / Math.max(1, tFinDone - tExitDone));
      return {
        byte: ch.rawLength + Math.round((ch.ptyBytes - ch.rawLength) * p),
        phase: 'after',
        beat: 'Finale · npm test + kala status + kala why',
        finaleBreak: true,
      };
    }
    return { byte: ch.rawLength, phase: 'after', beat: 'Handoff Ready → Next CLI', finaleBreak: false };
  }

  // Deterministic frame-accurate stepping hook for MP4 video export (?render=1)
  if (isRenderMode) {
    let rState = { idx: -1, buf: null, written: 0, phase: '', brokeFinale: false };
    const writeAsync = (data) => new Promise((res) => term.write(data, res));
    window.__renderReady = true;
    window.__chapters = chapters;
    window.__renderFrame = async function (idx, tMs) {
      const ch = chapters[idx];
      if (rState.idx !== idx) {
        rState = { idx, buf: null, written: 0, phase: 'before', brokeFinale: false };
        setChapterHeader(idx);
        renderInspector(ch, 'before', false);
        await writeAsync('\\x1b[?1049l\\x1b[2J\\x1b[H');
        rState.buf = new Uint8Array(await fetch(\`/api/pty/\${idx}\`).then((r) => r.arrayBuffer()));
      }
      const step = timelineAt(ch, tMs);
      if (step.finaleBreak && !rState.brokeFinale) {
        if (rState.written < ch.rawLength) {
          await writeAsync(rState.buf.subarray(rState.written, ch.rawLength));
          rState.written = ch.rawLength;
        }
        await writeAsync('\\x1b[?1049l\\r\\n');
        rState.brokeFinale = true;
      }
      if (step.byte > rState.written) {
        await writeAsync(rState.buf.subarray(rState.written, step.byte));
        rState.written = step.byte;
      }
      if (step.phase !== rState.phase) {
        renderInspector(ch, step.phase, false);
        rState.phase = step.phase;
      }
      document.getElementById('beat-tag').textContent = step.beat;
      document.getElementById('prog').style.width = \`\${Math.min(100, (tMs / ch.durationMs) * 100).toFixed(1)}%\`;
      updateTermBlurs();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return true;
    };
    await window.__renderFrame(0, 0);
    return;
  }

  const gate = document.getElementById('sound-gate');
  gate.onclick = () => {
    gate.style.display = 'none';
    if (audioEnabled) {
      audioEl.play().catch(() => {});
    }
  };

  async function playChapter(idx) {
    curIdx = idx;
    const token = ++runToken;
    const ch = chapters[idx];
    setChapterHeader(idx);
    renderInspector(ch, 'before', true);
    document.getElementById('prog').style.width = '0%';
    term.write('\\x1b[?1049l\\x1b[2J\\x1b[H', updateTermBlurs);

    const buf = new Uint8Array(await fetch(\`/api/pty/\${idx}\`).then((r) => r.arrayBuffer()));
    if (token !== runToken) return;

    audioEl.pause();
    let usingAudioClock = false;
    if (audioEnabled && ch.hasAudio) {
      audioEl.src = \`/api/audio/\${idx}\`;
      audioEl.playbackRate = speed;
      try {
        await audioEl.play();
        usingAudioClock = true;
        gate.style.display = 'none';
      } catch {
        gate.style.display = 'block';
      }
    }

    let written = 0;
    let curPhase = 'before';
    let brokeFinale = false;
    let wallElapsed = 0;
    let lastTick = performance.now();

    while (token === runToken) {
      if (paused) {
        if (!audioEl.paused) audioEl.pause();
        await new Promise((r) => setTimeout(r, 50));
        lastTick = performance.now();
        continue;
      }
      if (audioEnabled && ch.hasAudio && audioEl.paused && usingAudioClock && audioEl.currentTime < ch.durationMs / 1000 - 0.15) {
        audioEl.play().catch(() => {});
      }
      const now = performance.now();
      wallElapsed += (now - lastTick) * speed;
      lastTick = now;
      const tMs = (usingAudioClock && !audioEl.paused) ? audioEl.currentTime * 1000 : wallElapsed;
      const step = timelineAt(ch, tMs);

      if (step.finaleBreak && !brokeFinale) {
        if (written < ch.rawLength) {
          term.write(buf.subarray(written, ch.rawLength));
          written = ch.rawLength;
        }
        term.write('\\x1b[?1049l\\r\\n');
        brokeFinale = true;
      }
      if (step.byte > written) {
        term.write(buf.subarray(written, step.byte), updateTermBlurs);
        written = step.byte;
      } else {
        updateTermBlurs();
      }
      if (step.phase !== curPhase) {
        renderInspector(ch, step.phase, true);
        curPhase = step.phase;
      }
      syncBroadcast(step.beat);
      document.getElementById('prog').style.width = \`\${Math.min(100, (tMs / ch.durationMs) * 100).toFixed(1)}%\`;

      if (usingAudioClock) {
        if (audioEl.ended) break;
      } else if (tMs >= ch.durationMs) {
        break;
      }
      await new Promise((r) => setTimeout(r, 33));
    }

    if (token !== runToken) return;
    if (idx < chapters.length - 1) {
      if (holdMode) {
        paused = true;
        updateButtons();
        syncBroadcast('Holding at Seam — Space for Next CLI');
        while (paused && token === runToken) await new Promise((r) => setTimeout(r, 60));
        if (token !== runToken) return;
      }
      playChapter(idx + 1);
    } else {
      syncBroadcast('Build Complete · 7/7 Tests Passing');
    }
  }

  function updateButtons() {
    document.getElementById('btn-play').textContent = paused ? 'Resume (Space)' : 'Pause (Space)';
    document.getElementById('btn-mode').textContent = holdMode ? 'Mode: Hold' : 'Mode: Auto';
    document.getElementById('btn-speed').textContent = \`Speed: \${speed}x\`;
    const ab = document.getElementById('btn-audio');
    ab.textContent = audioEnabled ? 'Voiceover: ON' : 'Voiceover: Muted';
    ab.classList.toggle('active', audioEnabled);
  }

  function togglePlay() {
    paused = !paused;
    if (paused) audioEl.pause();
    else if (audioEnabled) audioEl.play().catch(() => {});
    updateButtons();
    syncBroadcast(paused ? 'Paused' : 'Playing');
  }

  document.getElementById('btn-play').onclick = togglePlay;
  document.getElementById('btn-audio').onclick = () => {
    audioEnabled = !audioEnabled;
    if (!audioEnabled) audioEl.pause();
    else if (!paused) audioEl.play().catch(() => {});
    updateButtons();
  };
  document.getElementById('btn-mode').onclick = () => {
    holdMode = !holdMode;
    updateButtons();
    syncBroadcast(holdMode ? 'Hold Mode' : 'Auto Mode');
  };
  document.getElementById('btn-speed').onclick = () => {
    const speeds = [0.85, 1, 1.25, 1.5];
    speed = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
    audioEl.playbackRate = speed;
    updateButtons();
  };
  document.getElementById('btn-clean').onclick = () => document.body.classList.toggle('clean');
  document.getElementById('btn-tp').onclick = () => {
    window.open('/?teleprompter=1', 'kalaga-teleprompter', 'width=760,height=460');
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key >= '1' && e.key <= '6') playChapter(Number(e.key) - 1);
    else if (e.code === 'ArrowRight' && curIdx < chapters.length - 1) playChapter(curIdx + 1);
    else if (e.code === 'ArrowLeft' && curIdx > 0) playChapter(curIdx - 1);
    else if (e.key === 'c' || e.key === 'C') document.body.classList.toggle('clean');
    else if (e.key === 'm' || e.key === 'M') document.getElementById('btn-mode').click();
    else if (e.key === 't' || e.key === 'T') document.getElementById('btn-tp').click();
  });

  bus.onmessage = (ev) => {
    const cmd = ev.data?.cmd;
    if (cmd === 'toggle') togglePlay();
    else if (cmd === 'next' && curIdx < chapters.length - 1) playChapter(curIdx + 1);
    else if (cmd === 'prev' && curIdx > 0) playChapter(curIdx - 1);
    else if (cmd === 'mode') document.getElementById('btn-mode').click();
  };

  playChapter(0);
})();
</script>
</body>
</html>
`;

// ---------- Entrypoint ----------
const opts = parseArgs(process.argv.slice(2));
if (!opts.capture) {
  console.error('Pass --capture <dir> or set KALA_DEMO_CAPTURE to a live-build .handoff-capture archive.');
  process.exit(2);
}
if (!fs.existsSync(opts.capture)) {
  console.error(`Capture directory not found: ${opts.capture}`);
  process.exit(1);
}
const chapters = loadManifest(opts.capture);

if (opts.cli) {
  await runCliPlayer(chapters, opts);
  process.exit(0);
}

const publicManifest = chapters.map(({ _buf, _mp3, _wav, ...rest }) => rest);
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  if (url.pathname === '/api/manifest') {
    const body = JSON.stringify(publicManifest);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
    return;
  }
  const ptyMatch = url.pathname.match(/^\/api\/pty\/(\d+)$/);
  if (ptyMatch) {
    const ch = chapters[Number(ptyMatch[1])];
    if (!ch) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(ch._buf);
    return;
  }
  const audioMatch = url.pathname.match(/^\/api\/audio\/(\d+)$/);
  if (audioMatch) {
    const ch = chapters[Number(audioMatch[1])];
    if (!ch || !fs.existsSync(ch._mp3)) { res.writeHead(404); res.end('not found'); return; }
    const mp3 = fs.readFileSync(ch._mp3);
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': mp3.length,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    res.end(mp3);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(STAGE_HTML);
});

server.listen(opts.port, '127.0.0.1', () => {
  console.log(`Kalaga Demo Studio listening on http://127.0.0.1:${opts.port}`);
  console.log(`Voiceover Teleprompter URL:     http://127.0.0.1:${opts.port}/?teleprompter=1`);
  console.log(`Terminal-only ANSI replay:      node scripts/demo-studio.mjs --cli`);
});
