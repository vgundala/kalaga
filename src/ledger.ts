// The ledger: per-agent "how much of the current usage window is spent".
// Two accuracy tiers, reported honestly:
//   exact  — claude (jsonl usage fields), grok (native `grok usage` / sqlite)
//   estimate — cursor, agy (no public token store → heuristics)
// The bottom bar and the picker both read this. Nothing here is authoritative
// over the vendor's real quota; it's our best local proxy for "how much is left".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadAgents, AGENT_ORDER, isInstalled } from './config.ts';
import type { AgentKey, AgentConfig } from './config.ts';

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
  const escaped = repoDir.replace(/[^a-zA-Z0-9]/g, '-');
  const dir = path.join(os.homedir(), '.claude', 'projects', escaped);
  let newest: number = 0;
  let newestFile: string | null = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const st = fs.statSync(path.join(dir, f));
      if (st.mtimeMs > newest) { newest = st.mtimeMs; newestFile = f; }
    }
  } catch { return { tokens: 0, lastUsed: null, sessionHint: null }; }
  if (!newestFile) return { tokens: 0, lastUsed: null, sessionHint: null };
  let tokens = 0;
  const lines = fs.readFileSync(path.join(dir, newestFile), 'utf8').split('\n');
  for (const line of lines) {
    if (!line.includes('"usage"')) continue;
    try {
      const j = JSON.parse(line);
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
  return { tokens, lastUsed: newest, sessionHint: newestFile };
}

// ---------- grok: exact via sqlite session id + `grok usage <sid>` ----------
async function grokUsage(repoDir: string): Promise<{ tokens: number; lastUsed: number | null; sessionHint: string | null }> {
  const dbPath = path.join(os.homedir(), '.grok', 'sessions', 'session_search.sqlite');
  let sid: string | null = null;
  let mtime: number | null = null;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare(
      "select session_id, updated_at from session_docs where cwd = ? order by updated_at desc limit 1"
    ).get(repoDir);
    db.close();
    if (row) { sid = row.session_id; mtime = typeof row.updated_at === 'number' ? row.updated_at : Date.now(); }
  } catch { /* sqlite unavailable or no row */ }
  if (!sid) return { tokens: 0, lastUsed: null, sessionHint: null };
  // Native usage: `grok usage <SID>` → scrape totals if present.
  let tokens = 0;
  try {
    const out = execFileSync(path.join(os.homedir(), '.grok', 'bin', 'grok'), ['usage', sid], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000,
    });
    // Best-effort: sum every "tokens" figure on its own line/field.
    const nums = out.match(/(\d[\d,]*)\s*(?:input|output|total)?\s*tokens?/gi);
    if (nums) {
      for (const n of nums) {
        const v = parseInt(n.replace(/[^\d]/g, ''), 10);
        if (!Number.isNaN(v)) tokens += v;
      }
    }
  } catch { /* grok usage failed → 0, still mark as seen */ }
  return { tokens, lastUsed: mtime, sessionHint: sid };
}

// ---------- cursor: estimate from ~/.cursor/chats/**/meta.json (cwd match) ----------
function cursorUsage(repoDir: string): { tokens: number; lastUsed: number | null; sessionHint: string | null } {
  const root = path.join(os.homedir(), '.cursor', 'chats');
  let best: { tokens: number; mtime: number; hint: string } | null = null;
  try {
    for (const outer of fs.readdirSync(root)) {
      const od = path.join(root, outer);
      if (!fs.statSync(od).isDirectory()) continue;
      for (const chat of fs.readdirSync(od)) {
        const metaPath = path.join(od, chat, 'meta.json');
        if (!fs.existsSync(metaPath)) continue;
        let meta: { cwd?: string; updatedAtMs?: number; hasConversation?: boolean };
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { continue; }
        if (meta.cwd !== repoDir || !meta.hasConversation) continue;
        // No token store exposed: estimate ~2.5k tokens per conversation file present.
        let files = 0;
        try { files = fs.readdirSync(path.join(od, chat)).length; } catch { /* */ }
        const mtime = meta.updatedAtMs ?? 0;
        if (!best || mtime > best.mtime) best = { tokens: files * 2500, mtime, hint: chat };
      }
    }
  } catch { /* no chats dir */ }
  return best ? { tokens: best.tokens, lastUsed: best.mtime, sessionHint: best.hint } : { tokens: 0, lastUsed: null, sessionHint: null };
}

// ---------- agy: no known public store → unknown (0, never used) ----------
function agyUsage(_repoDir: string): { tokens: number; lastUsed: number | null; sessionHint: string | null } {
  return { tokens: 0, lastUsed: null, sessionHint: null };
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
