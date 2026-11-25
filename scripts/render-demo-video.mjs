#!/usr/bin/env node
// Deterministic 1080p MP4 exporter for Kalaga Demo Studio (zero npm dependencies).
// Uses Node 24 built-in WebSocket + headless Chrome CDP + ffmpeg to render frame-exact
// blurred terminal & state visuals muxed with the Kokoro neural male voiceover track.
//
// Usage:
//   node scripts/render-demo-video.mjs --preview /tmp/preview   # dump Ch1 + Ch2 + Ch3 PNGs
//   node scripts/render-demo-video.mjs --out ./kalaga-demo.mp4
// Requires demo-studio running, plus KALA_DEMO_CAPTURE (or CAP_AUDIO_DIR) for the voiceover track.

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STUDIO_URL = process.env.STUDIO_URL || 'http://127.0.0.1:4310/?render=1&video=1';
const CAP_AUDIO_DIR = process.env.CAP_AUDIO_DIR
  || (process.env.KALA_DEMO_CAPTURE ? path.join(process.env.KALA_DEMO_CAPTURE, 'demo-audio') : '');
const FPS = 12;

function parseArgs(argv) {
  const out = {
    preview: '',
    out: path.resolve('kalaga-demo-16x9.mp4'),
    width: 1920,
    height: 1080,
    dpr: 4 / 3, // 1920x1080 logical @ 4/3 DPR = native 2560x1440 QHD vector rasterization!
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--preview' && argv[i + 1]) out.preview = argv[++i];
    else if (argv[i] === '--out' && argv[i + 1]) out.out = path.resolve(argv[++i]);
    else if (argv[i] === '--width' && argv[i + 1]) out.width = Number(argv[++i]);
    else if (argv[i] === '--height' && argv[i + 1]) out.height = Number(argv[++i]);
    else if (argv[i] === '--dpr' && argv[i + 1]) out.dpr = Number(argv[++i]);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome(debugPort, userDir, width, height) {
  const proc = spawn(
    'google-chrome',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json());
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return { proc, wsUrl: page.webSocketDebuggerUrl };
    } catch { /* wait */ }
    await sleep(150);
  }
  proc.kill('SIGKILL');
  throw new Error('Timed out waiting for headless Chrome DevTools endpoint');
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('open', () => {
      resolve({
        call(method, params = {}) {
          const id = ++seq;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() { ws.close(); },
      });
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
  });
}

async function evalJs(cdp, expression) {
  const res = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) {
    throw new Error(`JS error: ${res.exceptionDetails.text}`);
  }
  return res.result?.value;
}

const args = parseArgs(process.argv.slice(2));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kalaga-video-'));
const debugPort = 9340 + Math.floor(Math.random() * 400);

const { proc: chrome, wsUrl } = await launchChrome(debugPort, path.join(tmpDir, 'profile'), args.width, args.height);
const cdp = await connectCdp(wsUrl);

try {
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: args.width,
    height: args.height,
    deviceScaleFactor: args.dpr,
    mobile: false,
  });
  await cdp.call('Page.navigate', { url: STUDIO_URL });

  for (let i = 0; i < 60; i++) {
    const ok = await evalJs(cdp, 'Boolean(window.__renderReady)').catch(() => false);
    if (ok) break;
    await sleep(150);
  }
  const chapters = await evalJs(cdp, 'window.__chapters.map(c => ({ num: c.num, durationMs: c.durationMs, frames12fps: c.frames12fps }))');

  if (args.preview) {
    fs.mkdirSync(args.preview, { recursive: true });
    for (const [idx, tMs, name] of [
      [0, 4200, 'ch1-agy-blurred.png'],
      [1, 2000, 'ch2-cursor-blurred.png'],
      [2, 4200, 'ch3-grok-blurred.png'],
      [5, 31000, 'ch6-finale.png'],
    ]) {
      await evalJs(cdp, `window.__renderFrame(${idx}, ${tMs})`);
      const shot = await cdp.call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(args.preview, name), Buffer.from(shot.data, 'base64'));
      console.log('Saved preview:', path.join(args.preview, name));
    }
  } else {
    if (!CAP_AUDIO_DIR || !fs.existsSync(CAP_AUDIO_DIR)) {
      throw new Error('Set CAP_AUDIO_DIR or KALA_DEMO_CAPTURE to a capture archive that contains demo-audio/.');
    }
    // Concatenate chapter WAVs in exact order so audio and frame counts match 1:1
    const concatList = path.join(tmpDir, 'wavs.txt');
    fs.writeFileSync(
      concatList,
      chapters.map((_, i) => `file '${path.join(CAP_AUDIO_DIR, `vo-${i}.wav`)}'`).join('\n') + '\n'
    );
    const fullWav = path.join(tmpDir, 'full-voiceover.wav');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', fullWav]);

    const ff = spawn(
      'ffmpeg',
      [
        '-y',
        '-loglevel', 'error',
        '-f', 'image2pipe',
        '-vcodec', 'png',
        '-framerate', String(FPS),
        '-i', '-',
        '-i', fullWav,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'fast',
        '-tune', 'stillimage',
        '-crf', '15',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        args.out,
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] }
    );

    let totalFrames = 0;
    for (let idx = 0; idx < chapters.length; idx++) {
      const durMs = chapters[idx].durationMs;
      const frames = chapters[idx].frames12fps || Math.max(1, Math.round((durMs / 1000) * FPS));
      console.log(`Rendering Chapter ${idx + 1}/6 (${(durMs / 1000).toFixed(2)}s, ${frames} frames)...`);
      for (let f = 0; f < frames; f++) {
        const tMs = Math.min(durMs, (f / FPS) * 1000);
        await evalJs(cdp, `window.__renderFrame(${idx}, ${tMs.toFixed(1)})`);
        const shot = await cdp.call('Page.captureScreenshot', { format: 'png' });
        const buf = Buffer.from(shot.data, 'base64');
        if (!ff.stdin.write(buf)) {
          await new Promise((r) => ff.stdin.once('drain', r));
        }
        totalFrames++;
      }
    }
    ff.stdin.end();
    await new Promise((res, rej) => {
      ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`))));
    });
    console.log(`Rendered ${totalFrames} frames -> ${args.out}`);
  }
} finally {
  cdp.close();
  chrome.kill('SIGKILL');
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
