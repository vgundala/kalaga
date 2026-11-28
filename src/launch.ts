// Launch agents with a real TTY (stdio:inherit) — never pipe the TUI, because
// CLIs detect non-TTY stdout and degrade their UI. The trap is therefore
// store-based, not pipe-based: after the agent exits, we scan ITS OWN session
// log for the limit signature. This also lets `kala recover` work for agents
// the user launched directly, outside kala.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveExecutable, resolveSpawnTarget, claudeSessionFiles, claudeProjectDir, CURSOR_META_SCAN_CAP } from './config.ts';
import type { AgentConfig } from './config.ts';
import { isValidSessionId } from './util/sessionid.ts';

export { isValidSessionId };

/** Claude owns its own workspace-trust dialog. Kalaga's path grant does not
 *  suppress it (claude has no trustFlags). Warn before launch so a first-time
 *  "trust this folder?" prompt reads as expected, not a Kalaga bug. */
export function noteClaudeFolderTrust(agent: AgentConfig, repoDir: string = process.cwd()): void {
  if (agent.key !== 'claude') return;
  if (!fs.existsSync(claudeProjectDir(repoDir))) {
    console.error(
      "kalaga: Claude defaults to 'No, exit' on a new folder. Press Down, then Enter, to trust it — that's Claude's prompt, not Kalaga's.",
    );
    return;
  }
  console.error(
    "kalaga: Claude may ask you to trust this folder the first time — that's Claude's prompt, not Kalaga's. Choose Yes to continue.",
  );
}

function spawnAgent(resolved: string, args: string[], repoDir: string, key: string): Promise<number> {
  const target = resolveSpawnTarget(resolved, args);
  const env = { ...process.env };
  delete env.KALA_LIVE_ASK;
  return new Promise<number>((resolve) => {
    const child = spawn(target.file, target.args, {
      cwd: repoDir, stdio: 'inherit', env, shell: false,
    });
    child.on('error', (e) => { console.error(`kalaga: failed to start ${key}: ${e.message}`); resolve(127); });
    child.on('close', (code) => resolve(code ?? 0));
  });
}

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
  noteClaudeFolderTrust(agent, repoDir);
  const trustArgs = trust && agent.trustFlags.length ? agent.trustFlags : [];
  const args = [...trustArgs];
  if (initialPrompt) {
    if (agent.promptPrefix) args.push(agent.promptPrefix, initialPrompt);
    else args.push(initialPrompt);
  }
  return spawnAgent(resolved, args, repoDir, agent.key);
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
  if (agent.key === 'agy') {
    return fs.existsSync(path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversations', `${rec.id}.db`));
  }
  // grok (sqlite best-effort): time check + optional row
  try {
    if (agent.key === 'grok') {
      const { ignoreSqliteExperimentalWarning } = await import('./util/sqlitewarn.ts');
      ignoreSqliteExperimentalWarning();
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
  noteClaudeFolderTrust(agent, repoDir);
  const trustArgs = trust && agent.trustFlags.length ? agent.trustFlags : [];
  process.stderr.write(`kalaga → resume ${agent.key} (${id})\n`);
  return spawnAgent(resolved, [...trustArgs, ...resumeArgv(agent, id)], repoDir, agent.key);
}

// ---------- session-log tails: the raw text the trap scans after exit ----------
const TAIL_BYTES = 64 * 1024;

/** Read up to `maxBytes` from the end of `p`. When truncated (`start > 0`),
 *  drops any partial leading line so downstream JSONL/regex scanners never
 *  see mid-line fragments. Exported for testing. */
export function tailFile(p: string, maxBytes = TAIL_BYTES): string {
  try {
    const st = fs.statSync(p);
    if (st.size === 0 || maxBytes <= 0) return '';
    const start = Math.max(0, st.size - maxBytes);
    const readFrom = start > 0 ? start - 1 : 0;
    const len = st.size - readFrom;
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(len);
    try {
      fs.readSync(fd, buf, 0, len, readFrom);
    } finally {
      fs.closeSync(fd);
    }
    if (start === 0) return buf.toString('utf8');
    if (buf[0] === 0x0a) return buf.subarray(1).toString('utf8');
    const tail = buf.subarray(1);
    const nl = tail.indexOf(0x0a);
    return nl >= 0 ? tail.subarray(nl + 1).toString('utf8') : '';
  } catch { return ''; }
}

function tailStringLines(raw: string, maxChars = TAIL_BYTES): string {
  if (raw.length <= maxChars) return raw;
  const start = raw.length - maxChars;
  if (raw[start - 1] === '\n') return raw.slice(start);
  const nl = raw.indexOf('\n', start);
  return nl >= 0 ? raw.slice(nl + 1) : '';
}

/** Assistant text and error strings from a Claude JSONL tail. User prompts,
 *  tool_result payloads, and truncated/unparseable lines are discarded. */
export function claudePlainFromJsonl(raw: string): string {
  const parts: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); } catch { continue; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const j = parsed as Record<string, unknown>;
    const type = typeof j.type === 'string' ? j.type : '';
    if (type === 'user' || type === 'tool_result') continue;
    const msg = (j.message && typeof j.message === 'object') ? j.message as Record<string, unknown> : undefined;
    const role = typeof msg?.role === 'string' ? msg.role : '';
    if (role === 'user' || role === 'tool') continue;
    const interesting = type === 'assistant' || role === 'assistant' || type === 'error' || j.is_error === true || typeof j.error === 'string';
    if (!interesting) continue;
    const text = pullClaudeText(msg?.content ?? j.error ?? (j.is_error ? j.result : undefined));
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

function pullClaudeText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => {
      if (typeof c === 'string') return c;
      if (!c || typeof c !== 'object') return '';
      const o = c as Record<string, unknown>;
      if (o.type === 'tool_result' || o.type === 'tool_use') return '';
      if (typeof o.text === 'string') return o.text;
      if (typeof o.content === 'string') return o.content;
      return '';
    }).filter(Boolean).join('\n');
  }
  if (content && typeof content === 'object') {
    const o = content as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.message === 'string') return o.message;
  }
  return '';
}

/** Return recent raw text from `agent`'s session store for `repoDir`.
 *  Empty string = nothing to scan. */
export async function lastSessionText(agent: AgentConfig, repoDir: string): Promise<string> {
  switch (agent.key) {
    case 'claude': {
      const files = claudeSessionFiles(repoDir);
      if (!files.length) return '';
      return claudePlainFromJsonl(tailFile(path.join(claudeProjectDir(repoDir), files[0])));
    }
    case 'grok': {
      try {
        const { ignoreSqliteExperimentalWarning } = await import('./util/sqlitewarn.ts');
        ignoreSqliteExperimentalWarning();
        const { DatabaseSync } = await import('node:sqlite');
        const db = new DatabaseSync(path.join(os.homedir(), '.grok', 'sessions', 'session_search.sqlite'), { readOnly: true });
        const row = db.prepare('select content from session_docs where cwd = ? order by updated_at desc limit 1').get(repoDir);
        db.close();
        return row?.content ? tailStringLines(String(row.content)) : '';
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
    case 'agy': {
      // Conversation body is a binary trajectory DB. Use metadata Preview/Title
      // only — enough for a weak limit-phrase scan without opening oauth files.
      try {
        const lastPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'cache', 'last_conversations.json');
        const map = JSON.parse(fs.readFileSync(lastPath, 'utf8')) as Record<string, unknown>;
        const sid = map[repoDir];
        if (typeof sid !== 'string' || !isValidSessionId(sid)) return '';
        const metaPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'cache', 'conversation_metadata.json');
        const metaRoot = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
          conversations?: Record<string, { summary?: { Title?: string; Preview?: string } }>;
        };
        const s = metaRoot.conversations?.[sid]?.summary;
        const parts = [s?.Title, s?.Preview].filter((x): x is string => typeof x === 'string' && x.length > 0);
        return parts.join('\n');
      } catch { return ''; }
    }
  }
}
