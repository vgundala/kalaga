// Launch agents with a real TTY (stdio:inherit) — never pipe the TUI, because
// CLIs detect non-TTY stdout and degrade their UI. The trap is therefore
// store-based, not pipe-based: after the agent exits, we scan ITS OWN session
// log for the limit signature. This also lets `kala recover` work for agents
// the user launched directly, outside kala.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentConfig } from './config.ts';

/** Spawn the agent with full TTY and the handoff prompt as initial prompt.
 *  Blocks until it exits; returns its exit code.
 *  Trust flags (cursor --trust) skip the per-dir "trust this workspace"
 *  prompt. Most agents take a positional prompt; agy requires -i <prompt>. */
export function runAgent(agent: AgentConfig, repoDir: string, initialPrompt: string | null): Promise<number> {
  const args = [...agent.interactive, ...agent.trustFlags];
  if (initialPrompt) {
    if (agent.promptPrefix) args.push(agent.promptPrefix, initialPrompt);
    else args.push(initialPrompt);
  }
  return new Promise<number>((resolve) => {
    const child = spawn(args[0], args.slice(1), { cwd: repoDir, stdio: 'inherit', env: process.env });
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
      const escaped = repoDir.replace(/[^a-zA-Z0-9]/g, '-');
      const dir = path.join(os.homedir(), '.claude', 'projects', escaped);
      try {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
        if (!files.length) return '';
        files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
        return tailFile(path.join(dir, files[0]));
      } catch { return ''; }
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
        let bestDir: string | null = null; let bestM = 0;
        for (const outer of fs.readdirSync(root)) {
          const od = path.join(root, outer);
          if (!fs.statSync(od).isDirectory()) continue;
          for (const chat of fs.readdirSync(od)) {
            const metaPath = path.join(od, chat, 'meta.json');
            if (!fs.existsSync(metaPath)) continue;
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
