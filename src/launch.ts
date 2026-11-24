// Launch agents with a real TTY (stdio:inherit) — never pipe the TUI, because
// CLIs detect non-TTY stdout and degrade their UI. The trap is therefore
// store-based, not pipe-based: after the agent exits, we scan ITS OWN session
// log for the limit signature. This also lets `kala recover` work for agents
// the user launched directly, outside kala.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveExecutable, claudeSessionFiles, claudeProjectDir, tailBytes, CURSOR_META_SCAN_CAP } from './config.ts';
import type { AgentConfig } from './config.ts';
import { isValidSessionId } from './util/sessionid.ts';

export { isValidSessionId };

/** Spawn the agent with full TTY and the handoff prompt as initial prompt.
 *  Blocks until it exits; returns its exit code.
 *  SEC-001 T4/T5: trustFlags appended only when `trust` is true (a recorded
 *  path grant). Never unconditional.
 *  SEC-001 B3: argv[0] is the once-resolved absolute path; a missing binary
 *  fails clearly instead of a raw spawn error.
 *  Most agents take a positional prompt; agy requires -i <prompt>. */
export function runAgent(agent: AgentConfig, repoDir: string, initialPrompt: string | null, trust = false): Promise<number> {
  const resolved = resolveExecutable(agent.interactive[0]);
  if (!resolved) {
    return new Promise((resolve) => {
      console.error(`kalaga: ${agent.key} binary not found (looked for '${agent.interactive[0]}') — install it or check PATH`);
      resolve(127);
    });
  }
  const trustArgs = trust && agent.trustFlags.length ? agent.trustFlags : [];
  const argv = [resolved, ...trustArgs];
  if (initialPrompt) {
    if (agent.promptPrefix) argv.push(agent.promptPrefix, initialPrompt);
    else argv.push(initialPrompt);
  }
  return new Promise<number>((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { cwd: repoDir, stdio: 'inherit', env: process.env });
    child.on('error', (e) => { console.error(`kalaga: failed to start ${agent.key}: ${e.message}`); resolve(127); });
    child.on('close', (code) => resolve(code ?? 0));
  });
}

// ---------- FEAT-002: session capture + resume ----------

/** R2: vendor-native resume token. Claude jsonl names lose the suffix;
 *  other hints are already ids. Returns null if the result is not a safe id. */
export function normalizeSessionId(agent: AgentConfig, hint: string): string | null {
  const id = agent.key === 'claude' ? hint.replace(/\.jsonl$/, '') : hint;
  return isValidSessionId(id) ? id : null;
}

/** R6/R7: argv for resume-by-id (prefix flags + id), trustFlags applied by
 *  the caller via the `trust` arg to resumeAgent. Pure, testable.
 *  Caller must pass a validated id (see isValidSessionId). */
export function resumeArgv(agent: AgentConfig, id: string): string[] {
  if (!isValidSessionId(id)) throw new Error(`invalid session id for resume: ${JSON.stringify(id)}`);
  return [...agent.resumeByIdPrefix, id];
}

/** R10 freshness: captured within 7 days AND (where checkable) the vendor
 *  artifact still exists. grok/cursor checks are best-effort — if the check
 *  itself fails, allow (fail open) and let the vendor error. */
const SESSION_TTL_MS = 7 * 86_400_000;
export async function sessionFresh(agent: AgentConfig, repoDir: string, rec: { id: string; at: string }): Promise<boolean> {
  const t = Date.parse(rec.at);
  if (Number.isNaN(t) || Date.now() - t > SESSION_TTL_MS) return false;
  if (agent.key === 'claude') {
    return fs.existsSync(path.join(claudeProjectDir(repoDir), `${rec.id}.jsonl`));
  }
  if (agent.key === 'cursor') {
    // chat dir id: locate under ~/.cursor/chats (shallow, capped walk)
    const root = path.join(os.homedir(), '.cursor', 'chats');
    try {
      for (const outer of fs.readdirSync(root)) {
        const od = path.join(root, outer);
        if (!fs.statSync(od).isDirectory()) continue;
        if (fs.existsSync(path.join(od, rec.id))) return true;
      }
    } catch { /* fail open */ }
    return true; // artifact check inconclusive → let vendor decide
  }
  // grok (sqlite best-effort) and agy (no store): time check only
  try {
    if (agent.key === 'grok') {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(path.join(os.homedir(), '.grok', 'sessions', 'session_search.sqlite'), { readOnly: true });
      const row = db.prepare('select 1 from session_docs where session_id = ? limit 1').get(rec.id);
      db.close();
      return row !== undefined;
    }
  } catch { /* fail open */ }
  return true;
}

/** R8: spawn the resolved binary with trustFlags (conditional) + resume
 *  flags + id. No handoff inject — the conversation already has context. */
export async function resumeAgent(agent: AgentConfig, repoDir: string, id: string, trust = false): Promise<number> {
  if (!isValidSessionId(id)) {
    console.error(`kalaga: refusing resume — session id fails allowlist (flag-shaped or unsafe characters)`);
    return 2;
  }
  const resolved = resolveExecutable(agent.interactive[0]);
  if (!resolved) {
    console.error(`kalaga: ${agent.key} binary not found (looked for '${agent.interactive[0]}') — install it or check PATH`);
    return 127;
  }
  const trustArgs = trust && agent.trustFlags.length ? agent.trustFlags : [];
  const argv = [resolved, ...trustArgs, ...resumeArgv(agent, id)];
  process.stderr.write(`kalaga → resume ${agent.key} (${id})\n`);
  return new Promise<number>((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { cwd: repoDir, stdio: 'inherit', env: process.env });
    child.on('error', (e) => { console.error(`kalaga: failed to start ${agent.key}: ${e.message}`); resolve(127); });
    child.on('close', (code) => resolve(code ?? 0));
  });
}

// ---------- session-log tails: the raw text the trap scans after exit ----------
const TAIL_BYTES = 64 * 1024;

function tailFile(p: string): string {
  try {
    const st = fs.statSync(p);
    const start = Math.max(0, st.size - TAIL_BYTES);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}

/** Return recent raw text from `agent`'s session store for `repoDir`.
 *  Empty string = nothing to scan (agy has no known store). */
export async function lastSessionText(agent: AgentConfig, repoDir: string): Promise<string> {
  switch (agent.key) {
    case 'claude': {
      // C3: shared claudeProjectDir/claudeSessionFiles (same C2 disambig as the ledger).
      const files = claudeSessionFiles(repoDir);
      if (!files.length) return '';
      return tailFile(path.join(claudeProjectDir(repoDir), files[0]));
    }
    case 'grok': {
      try {
        const { DatabaseSync } = await import('node:sqlite');
        const db = new DatabaseSync(path.join(os.homedir(), '.grok', 'sessions', 'session_search.sqlite'), { readOnly: true });
        const row = db.prepare('select content from session_docs where cwd = ? order by updated_at desc limit 1').get(repoDir);
        db.close();
        return row?.content ? String(row.content).slice(-TAIL_BYTES) : '';
      } catch { return ''; }
    }
    case 'cursor': {
      const root = path.join(os.homedir(), '.cursor', 'chats');
      try {
        let bestDir: string | null = null; let bestM = 0; let scanned = 0;
        // O8 (W3): bounded by the shared CURSOR_META_SCAN_CAP, like the ledger.
        for (const outer of fs.readdirSync(root)) {
          if (scanned >= CURSOR_META_SCAN_CAP) break;
          const od = path.join(root, outer);
          if (!fs.statSync(od).isDirectory()) continue;
          for (const chat of fs.readdirSync(od)) {
            if (scanned >= CURSOR_META_SCAN_CAP) break;
            const metaPath = path.join(od, chat, 'meta.json');
            if (!fs.existsSync(metaPath)) continue;
            scanned++;
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
              if (meta.cwd !== repoDir || !meta.hasConversation) continue;
              const m = meta.updatedAtMs ?? 0;
              if (m > bestM) { bestM = m; bestDir = path.join(od, chat); }
            } catch { /* */ }
          }
        }
        if (!bestDir) return '';
        return fs.readdirSync(bestDir).filter((f) => f.endsWith('.json')).map((f) => tailFile(path.join(bestDir, f))).join('\n');
      } catch { return ''; }
    }
    case 'agy':
      return ''; // no known public store
  }
}
