// The ledger: per-agent "how much of the current usage window is spent".
// Two accuracy tiers, reported honestly:
//   exact  — claude (jsonl usage fields), grok (native `grok usage` / sqlite)
//   estimate — cursor only (no public token store → heuristics); agy tokens
//              stay 0, but session ids come from ~/.gemini/antigravity-cli
// The bottom bar and the picker both read this. Nothing here is authoritative
// over the vendor's real quota; it's our best local proxy for "how much is left".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadAgents, AGENT_ORDER, isInstalled, resolveExecutable, claudeSessionFiles, claudeProjectDir, tailBytes, USAGE_MAX_BYTES, CURSOR_META_SCAN_CAP } from './config.ts';
import type { AgentKey, AgentConfig } from './config.ts';
import { isValidSessionId } from './util/sessionid.ts';

const CLAUDE_WINDOW_MS = 5 * 60 * 60 * 1000;
const GROK_WINDOW_MS = 5 * 60 * 60 * 1000;
const CURSOR_WINDOW_MS = 24 * 60 * 60 * 1000;

function inWindow(ts: number, windowMs: number, now = Date.now()): boolean {
  return Number.isFinite(ts) && ts <= now + 60_000 && now - ts <= windowMs;
}

/** Normalize Unix seconds (< 1e11), Unix ms, or ISO string to epoch ms. */
export function normalizeEpochMs(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw < 1e11 ? Math.round(raw * 1000) : Math.round(raw);
  }
  if (typeof raw === 'string' && raw.trim()) {
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum > 0) {
      return asNum < 1e11 ? Math.round(asNum * 1000) : Math.round(asNum);
    }
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export interface AgentUsage {
  agent: AgentKey;
  installed: boolean;      // CLI found on this machine
  tokens: number;          // spent in the window we track
  exact: boolean;
  ceiling: number;
  remaining: number;       // ceiling - tokens (floored at 0)
  lastUsed: number | null; // ms epoch, null = never seen
  sessionHint: string | null; // e.g. jsonl name / session id, for debugging
}

// ---------- claude: exact from ~/.claude/projects/<cwd-escaped>/*.jsonl ----------
function claudeUsage(repoDir: string): { tokens: number; lastUsed: number | null; sessionHint: string | null } {
  const files = claudeSessionFiles(repoDir); // C3 shared helper + C2 disambig
  if (!files.length) return { tokens: 0, lastUsed: null, sessionHint: null };
  const newestFile = files[0]; // newest-first
  const full = path.join(claudeProjectDir(repoDir), newestFile);
  let tokens = 0;
  let fileMtime = 0;
  try { fileMtime = fs.statSync(full).mtimeMs; } catch { /* */ }
  // Bounded tail read. Count only turns inside the rolling 5-hour window
  // (entry timestamp when it parses, otherwise the file mtime).
  const lines = tailBytes(full, USAGE_MAX_BYTES).split('\n');
  for (const line of lines) {
    if (!line.includes('"usage"')) continue;
    try {
      const j = JSON.parse(line);
      let ts = Number.NaN;
      if (typeof j.timestamp === 'string' || typeof j.timestamp === 'number') ts = Date.parse(String(j.timestamp));
      if (Number.isNaN(ts)) ts = fileMtime;
      if (!inWindow(ts, CLAUDE_WINDOW_MS)) continue;
      const u = j.message?.usage ?? j.usage;
      if (u && typeof u === 'object') {
        // Fresh work only: new input + output + cache writes.
        // cache_read is re-reading the same context — counting it inflates
        // the number by orders of magnitude (e.g. 17M for a 170k session).
        tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
          + (u.cache_creation_input_tokens ?? 0);
      }
    } catch { /* skip bad line */ }
  }
  return { tokens, lastUsed: fileMtime || null, sessionHint: newestFile };
}

// ---------- grok: sqlite session id, then optional `grok usage <sid>` ----------
export async function grokSessionHint(repoDir: string): Promise<{ sid: string | null; lastUsed: number | null }> {
  const dbPath = path.join(os.homedir(), '.grok', 'sessions', 'session_search.sqlite');
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare(
      "select session_id, updated_at from session_docs where cwd = ? order by updated_at desc limit 1"
    ).get(repoDir) as { session_id?: unknown; updated_at?: unknown } | undefined;
    db.close();
    if (!row?.session_id) return { sid: null, lastUsed: null };
    const mtime = normalizeEpochMs(row.updated_at) ?? Date.now();
    return { sid: String(row.session_id), lastUsed: mtime };
  } catch {
    return { sid: null, lastUsed: null };
  }
}

function grokBucketFreshTokens(u: Record<string, unknown>): number {
  const cached = typeof u.cachedReadTokens === 'number' ? u.cachedReadTokens : 0;
  if (typeof u.totalTokens === 'number') return Math.max(0, u.totalTokens - cached);
  const input = typeof u.inputTokens === 'number' ? u.inputTokens : 0;
  const output = typeof u.outputTokens === 'number' ? u.outputTokens : 0;
  const cacheCreate = typeof u.cacheCreationTokens === 'number' ? u.cacheCreationTokens : 0;
  return Math.max(0, input - cached) + output + cacheCreate;
}

/** Parse `grok usage <sid>` output (JSON in Grok Build >=1.0, or text fallback).
 *  Excludes cachedReadTokens so multi-call turns match Claude's fresh-token accounting. */
export function parseGrokTokenTotal(out: string, now?: number): number {
  const trimmed = out.trim();
  if (trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed) as {
        updatedAt?: unknown;
        session?: Record<string, unknown>;
        turns?: Array<Record<string, unknown>>;
      };
      if (Array.isArray(j.turns) && j.turns.length > 0) {
        let sum = 0;
        for (const t of j.turns) {
          if (!t || typeof t !== 'object') continue;
          if (now !== undefined) {
            const ts = normalizeEpochMs(t.endedAt ?? j.updatedAt);
            if (ts !== null && !inWindow(ts, GROK_WINDOW_MS, now)) continue;
          }
          sum += grokBucketFreshTokens(t);
        }
        return sum;
      }
      if (j.session && typeof j.session === 'object') {
        if (now !== undefined) {
          const ts = normalizeEpochMs(j.updatedAt);
          if (ts !== null && !inWindow(ts, GROK_WINDOW_MS, now)) return 0;
        }
        return grokBucketFreshTokens(j.session);
      }
    } catch { /* fall through to text parser */ }
  }
  const lines = out.split(/\r?\n/);
  let total: number | null = null;
  let parts = 0;
  let sawPart = false;
  for (const line of lines) {
    if (!/tokens?/i.test(line)) continue;
    const num = line.match(/(\d[\d,]*)/);
    if (!num) continue;
    const v = parseInt(num[1].replace(/,/g, ''), 10);
    if (Number.isNaN(v)) continue;
    if (/\btotal\b/i.test(line)) { total = v; continue; }
    if (/\b(?:input|output)\b/i.test(line)) { sawPart = true; parts += v; }
  }
  if (total !== null) return total;
  if (sawPart) return parts;
  let sum = 0;
  const nums = out.match(/(\d[\d,]*)\s*tokens?/gi) ?? [];
  for (const n of nums) {
    const v = parseInt(n.replace(/[^\d]/g, ''), 10);
    if (!Number.isNaN(v)) sum += v;
  }
  return sum;
}

async function grokUsage(repoDir: string): Promise<{ tokens: number; lastUsed: number | null; sessionHint: string | null }> {
  const hint = await grokSessionHint(repoDir);
  if (!hint.sid || !isValidSessionId(hint.sid)) {
    return { tokens: 0, lastUsed: hint.lastUsed, sessionHint: null };
  }
  if (hint.lastUsed !== null && !inWindow(hint.lastUsed, GROK_WINDOW_MS)) {
    return { tokens: 0, lastUsed: hint.lastUsed, sessionHint: hint.sid };
  }
  let tokens = 0;
  const bin = resolveExecutable('grok');
  if (bin) {
    try {
      const out = execFileSync(bin, ['usage', hint.sid], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000,
      });
      tokens = parseGrokTokenTotal(out, Date.now());
    } catch { /* grok usage failed → 0, still mark as seen */ }
  }
  return { tokens, lastUsed: hint.lastUsed, sessionHint: hint.sid };
}

// ---------- cursor: estimate from ~/.cursor/chats/**/meta.json (cwd match) ----------
// R2/O8: bounded walk — CURSOR_META_SCAN_CAP (config.ts, shared with the trap)
// caps meta.json files inspected so a machine with thousands of chats doesn't
// make `kala status` slow. Token figures are coarse heuristics only ([est.]).
function cursorUsage(repoDir: string): { tokens: number; lastUsed: number | null; sessionHint: string | null } {
  const root = path.join(os.homedir(), '.cursor', 'chats');
  let best: { tokens: number; mtime: number; hint: string } | null = null;
  let scanned = 0;
  try {
    for (const outer of fs.readdirSync(root)) {
      if (scanned >= CURSOR_META_SCAN_CAP) break;
      const od = path.join(root, outer);
      if (!fs.statSync(od).isDirectory()) continue;
      for (const chat of fs.readdirSync(od)) {
        if (scanned >= CURSOR_META_SCAN_CAP) break;
        const metaPath = path.join(od, chat, 'meta.json');
        if (!fs.existsSync(metaPath)) continue;
        scanned++;
        let meta: { cwd?: string; updatedAtMs?: number; hasConversation?: boolean };
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { continue; }
        if (meta.cwd !== repoDir || !meta.hasConversation) continue;
        const chatDir = path.join(od, chat);
        let dirMtime = 0;
        try { dirMtime = fs.statSync(chatDir).mtimeMs; } catch { dirMtime = meta.updatedAtMs ?? 0; }
        if (!inWindow(dirMtime, CURSOR_WINDOW_MS)) continue;
        // No token store exposed: estimate ~2.5k tokens per conversation file present.
        let files = 0;
        try { files = fs.readdirSync(chatDir).length; } catch { /* */ }
        const mtime = meta.updatedAtMs ?? dirMtime;
        if (!best || mtime > best.mtime) best = { tokens: files * 2500, mtime, hint: chat };
      }
    }
  } catch { /* no chats dir */ }
  return best ? { tokens: best.tokens, lastUsed: best.mtime, sessionHint: best.hint } : { tokens: 0, lastUsed: null, sessionHint: null };
}

/** Antigravity CLI (agy) session root under ~/.gemini/antigravity-cli. */
export function agyCliRoot(home = os.homedir()): string {
  return path.join(home, '.gemini', 'antigravity-cli');
}

export function agyConversationDbPath(sessionId: string, home = os.homedir()): string {
  return path.join(agyCliRoot(home), 'conversations', `${sessionId}.db`);
}

/**
 * Resolve agy's conversation id for a repo cwd.
 * Signature (verified Antigravity CLI):
 *   ~/.gemini/antigravity-cli/cache/last_conversations.json  { absCwd: uuid }
 *   ~/.gemini/antigravity-cli/conversations/<uuid>.db        must exist
 * Optional: conversation_metadata.json last_modified_time → lastUsed.
 * Never reads oauth / keyring files. Returns null when any check fails.
 */
export function resolveAgySession(
  repoDir: string,
  home = os.homedir(),
): { sid: string; lastUsed: number | null } | null {
  const lastPath = path.join(agyCliRoot(home), 'cache', 'last_conversations.json');
  let map: Record<string, unknown>;
  try {
    map = JSON.parse(fs.readFileSync(lastPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
  const raw = map[repoDir];
  if (typeof raw !== 'string' || !isValidSessionId(raw)) return null;
  const dbPath = agyConversationDbPath(raw, home);
  try {
    if (!fs.statSync(dbPath).isFile()) return null;
  } catch {
    return null;
  }
  let lastUsed: number | null = null;
  try {
    lastUsed = fs.statSync(dbPath).mtimeMs;
  } catch { /* */ }
  const metaPath = path.join(agyCliRoot(home), 'cache', 'conversation_metadata.json');
  try {
    const metaRoot = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
      conversations?: Record<string, { last_modified_time?: string }>;
    };
    const ts = metaRoot.conversations?.[raw]?.last_modified_time;
    const parsed = ts ? Date.parse(ts) : Number.NaN;
    if (!Number.isNaN(parsed)) lastUsed = parsed;
  } catch { /* mtime fallback already set */ }
  return { sid: raw, lastUsed };
}

/** agy: session id for resume/live-ask; tokens stay 0 (no public usage store). */
export function agySessionHint(repoDir: string, home = os.homedir()): { sid: string | null; lastUsed: number | null } {
  const hit = resolveAgySession(repoDir, home);
  return hit ? { sid: hit.sid, lastUsed: hit.lastUsed } : { sid: null, lastUsed: null };
}

function agyUsage(repoDir: string): { tokens: number; lastUsed: number | null; sessionHint: string | null } {
  const hint = agySessionHint(repoDir);
  return {
    tokens: 0,
    lastUsed: hint.lastUsed,
    sessionHint: hint.sid && isValidSessionId(hint.sid) ? hint.sid : null,
  };
}

const TAILERS: Record<AgentKey, (repoDir: string) => Promise<{ tokens: number; lastUsed: number | null; sessionHint: string | null }> | { tokens: number; lastUsed: number | null; sessionHint: string | null }> = {
  claude: claudeUsage,
  grok: grokUsage,
  cursor: cursorUsage,
  agy: agyUsage,
};

export function exactFor(agent: AgentConfig): boolean {
  return agent.store.kind === 'jsonl' || agent.store.kind === 'sqlite';
}

/** FEAT-002: the captured session token for one agent (ledger discovery),
 *  or null when nothing is known. */
export async function sessionHintFor(agent: AgentConfig, repoDir: string): Promise<string | null> {
  // SQLite / index lookups only — never spawn vendor usage CLIs just for an id.
  if (agent.key === 'grok') {
    const hint = await grokSessionHint(repoDir);
    return hint.sid && isValidSessionId(hint.sid) ? hint.sid : null;
  }
  if (agent.key === 'agy') {
    const hint = agySessionHint(repoDir);
    return hint.sid && isValidSessionId(hint.sid) ? hint.sid : null;
  }
  const u = await TAILERS[agent.key](repoDir);
  return u.sessionHint;
}

export async function readLedger(repoDir: string): Promise<AgentUsage[]> {
  const agents = loadAgents();
  const results = await Promise.all(AGENT_ORDER.map(async (key) => {
    const cfg = agents[key];
    const u = await TAILERS[key](repoDir);
    const tokens = u.tokens;
    const remaining = Math.max(0, cfg.ceiling - tokens);
    return {
      agent: key,
      installed: isInstalled(cfg),
      tokens,
      exact: exactFor(cfg),
      ceiling: cfg.ceiling,
      remaining,
      lastUsed: u.lastUsed,
      sessionHint: u.sessionHint,
    };
  }));
  return results;
}
