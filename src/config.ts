// Kalaga config: agent roster, builtin headroom ceilings, error signatures.
// Ceilings are fixed estimates for status/ranking — not user-configurable.
// Rename the app and nothing here cares — agents are addressed by key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export type AgentKey = 'agy' | 'cursor' | 'grok' | 'claude';

export interface AgentConfig {
  key: AgentKey;
  /** Command to spawn the interactive TUI in the current dir. */
  interactive: string[];
  /** Flag that takes an initial prompt for the interactive TUI (agy uses -i). */
  promptPrefix: string;
  /** Flags to add for a non-interactive single prompt (headless). */
  headless: string[];
  /** FEAT-002 R6: flags that take a session id (before the id). */
  resumeByIdPrefix: string[];
  /** Flags to skip the per-directory "trust this workspace" prompt. */
  trustFlags: string[];
  /** Per-usage-window ceiling in tokens, for the headroom/freshness estimate. */
  ceiling: number;
  /** Error signatures that mean "this agent is out of quota for now". */
  limitPatterns: string[];
  /** How the ledger finds this agent's session store.
   *  jsonl/sqlite → exact token heads where available; meta → session discovery
   *  and/or estimates only (agy: Antigravity conversation id; cursor: chat meta). */
  store: { kind: 'jsonl' | 'sqlite' | 'meta'; dir?: string };
  /** True when the session text source only stores metadata (title/preview),
   *  not actual transcript/error logs (agy conversation_metadata.json). */
  metadataOnlyStore?: boolean;
}

/** Vendor limit phrases. Bare words like "quota" match ordinary prose. */
const LIMIT_PATTERNS = [
  'usage limit',
  '\\bhit your [\\w\\s-]{0,30}limit\\b',
  'quota exceeded',
  '\\bover (?:your |the )?(?:[a-z]+ )?quota\\b',
  'out of quota',
  'insufficient (?:credits|quota|balance|funds)',
  'out of credits',
  '\\brate[ -]?limit(?:ed| exceeded| reached)\\b',
  '\\brate_limit_(?:error|exceeded)\\b',
  'limit reached',
  'spending limit',
  'session limit',
  'too many requests',
  '\\b(?:usage|limit) resets? (?:at|in)\\b',
];

export const AGENTS: Record<AgentKey, AgentConfig> = {
  agy: {
    key: 'agy',
    interactive: ['agy'],
    promptPrefix: '-i',
    trustFlags: [],
    headless: ['--mode', 'plan', '--effort', 'low', '--disable-slash-commands', '-p', '--output-format', 'text'],
    resumeByIdPrefix: ['--conversation'],
    ceiling: 250_000,
    limitPatterns: [...LIMIT_PATTERNS],
    // Session ids: ~/.gemini/antigravity-cli/cache/last_conversations.json
    // + conversations/<uuid>.db (see ledger.agySessionHint). No public token store.
    store: { kind: 'meta', dir: '.gemini/antigravity-cli' },
    metadataOnlyStore: true,
  },
  cursor: {
    key: 'cursor',
    interactive: ['cursor-agent'],
    promptPrefix: '',
    trustFlags: ['--trust'],
    headless: ['--mode', 'ask', '-p', '--output-format', 'text'],
    resumeByIdPrefix: ['--resume'],
    ceiling: 250_000,
    limitPatterns: [...LIMIT_PATTERNS],
    store: { kind: 'meta' },
  },
  grok: {
    key: 'grok',
    interactive: ['grok'],
    promptPrefix: '',
    trustFlags: [],
    headless: ['--permission-mode', 'plan', '--output-format', 'plain', '--reasoning-effort', 'low', '--max-turns', '1', '-p'],
    resumeByIdPrefix: ['-r'],
    ceiling: 250_000,
    limitPatterns: [...LIMIT_PATTERNS],
    store: { kind: 'sqlite' },
  },
  claude: {
    key: 'claude',
    interactive: ['claude'],
    promptPrefix: '',
    trustFlags: [],
    headless: ['--disallowedTools', 'Edit,Write,MultiEdit,Bash', '-p', '--output-format', 'text'],
    resumeByIdPrefix: ['-r'],
    ceiling: 250_000,
    limitPatterns: [...LIMIT_PATTERNS],
    store: { kind: 'jsonl' },
  },
};

export const AGENT_ORDER: AgentKey[] = ['agy', 'cursor', 'grok', 'claude'];

// Tokens remaining before the bottom bar starts warning.
export const WARN_THRESHOLD = 15_000;

// OPS-001 O8 (W3/R2): max cursor meta.json files inspected per walk — shared
// by the ledger (usage) and the trap (session tail) so neither is unbounded.
export const CURSOR_META_SCAN_CAP = 2000;

export function kalagaHome(): string {
  const env = process.env.KALA_HOME?.trim();
  return env ? path.resolve(env) : path.join(os.homedir(), '.kala');
}

/** Create the per-user directory (0700). Refuses a symlinked home. */
export function ensureKalagaHome(): string {
  const dir = kalagaHome();
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error(`refusing to use kalaga home: ${dir} is a symlink`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function stateFile(repoDir: string): string {
  return path.join(repoDir, '.kala', 'state.yaml');
}

export function configPath(): string {
  return path.join(kalagaHome(), 'config.yaml');
}

export interface HookConfig {
  enabled: boolean;
  edit_threshold: number;
  max_age_minutes: number;
  cooldown_minutes: number;
  timeout_seconds: number;
}

export const DEFAULT_HOOK_CONFIG: HookConfig = {
  enabled: true,
  edit_threshold: 5,
  max_age_minutes: 10,
  cooldown_minutes: 3,
  timeout_seconds: 5,
};

function stripInlineComment(raw: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === quote && raw[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]))) return raw.slice(0, i).trim();
  }
  return raw.trim();
}

function unquoteScalar(raw: string): string {
  const s = stripInlineComment(raw);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** FEAT-004 K15: read optional `hooks:` block from `~/.kala/config.yaml` (or `$KALA_HOME`).
 *  Refuses symlinks; falls back cleanly to DEFAULT_HOOK_CONFIG on missing or invalid fields. */
export function loadHookConfig(): HookConfig {
  const out: HookConfig = { ...DEFAULT_HOOK_CONFIG };
  const home = kalagaHome();
  const cfgFile = path.join(home, 'config.yaml');
  try {
    if (fs.lstatSync(home).isSymbolicLink()) return out;
    const st = fs.lstatSync(cfgFile);
    if (st.isSymbolicLink() || !st.isFile()) return out;
    const raw = fs.readFileSync(cfgFile, 'utf8');
    let inHooks = false;
    for (const line of raw.split(/\r?\n/)) {
      if (/^\s*#/.test(line) || !line.trim()) continue;
      if (/^hooks:\s*(?:#.*)?$/.test(line)) { inHooks = true; continue; }
      if (/^\S/.test(line)) { inHooks = false; continue; }
      if (!inHooks) continue;
      const m = line.match(/^\s+([a-z_]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const val = unquoteScalar(m[2]);
      if (key === 'enabled') {
        if (val === 'true') out.enabled = true;
        else if (val === 'false') out.enabled = false;
        continue;
      }
      if (!val) continue;
      const n = Number(val);
      if (!Number.isFinite(n)) continue;
      if (key === 'edit_threshold' && n >= 1) out.edit_threshold = Math.floor(n);
      else if (key === 'max_age_minutes' && n > 0) out.max_age_minutes = n;
      else if (key === 'cooldown_minutes' && n >= 0) out.cooldown_minutes = n;
      else if (key === 'timeout_seconds' && n >= 1) out.timeout_seconds = Math.floor(n);
    }
  } catch { /* missing or unreadable config → defaults */ }
  return out;
}

/**
 * Built-in agent roster as shallow copies (SEC-001 M1). Token ceilings are
 * fixed builtins for headroom estimates — `~/.kala/config.yaml` does not
 * override them (only trust_ttl_days / inject_rich_prompt are read elsewhere).
 */
export function loadAgents(): Record<AgentKey, AgentConfig> {
  return Object.fromEntries(
    AGENT_ORDER.map((k) => [k, { ...AGENTS[k], limitPatterns: [...AGENTS[k].limitPatterns], store: { ...AGENTS[k].store } }]),
  ) as Record<AgentKey, AgentConfig>;
}

export function agentFor(key: string): AgentConfig {
  const a = loadAgents()[key as AgentKey];
  if (!a) throw new Error(`unknown agent '${key}' (known: ${AGENT_ORDER.join(', ')})`);
  return a;
}

/** Is this agent's CLI actually installed? Absolute paths → exists; bare
 *  names → PATH lookup. This is how kala discovers the roster on a machine
 *  where the user only has some of the four. */
export function isInstalled(agent: AgentConfig): boolean {
  return resolveExecutable(agent.interactive[0]) !== null;
}

/** OPS-003 P1: split PATH with the platform delimiter (':' Unix, ';' Windows). */
export function splitPathEnv(pathEnv: string = process.env.PATH ?? ''): string[] {
  return pathEnv.split(path.delimiter).filter(Boolean);
}

function winPathext(): string[] {
  const raw = process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM';
  return raw.split(';').filter(Boolean).map((e) => e.toLowerCase());
}

/** OPS-003 P2: is this path a runnable file on the current platform? */
function isRunnablePath(p: string): boolean {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    if (process.platform === 'win32') {
      const ext = path.extname(p).toLowerCase();
      return !ext || winPathext().includes(ext);
    }
    return (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function realIfRunnable(p: string): string | null {
  if (!isRunnablePath(p)) return null;
  try { return fs.realpathSync(p); } catch { return null; }
}

/** SEC-001 B1/B2 + OPS-003: resolve a command to an absolute executable once,
 *  or null. Absolute inputs are verified as-is; bare names walk PATH in
 *  order (first runnable wins). On Windows, PATHEXT candidates are tried.
 *  Cached per-process so a PATH change mid-run can't swap the binary. */
const resolvedCache = new Map<string, string | null>();
export function clearResolvedCache(): void {
  resolvedCache.clear();
}
export function resolveExecutable(cmd: string): string | null {
  if (resolvedCache.has(cmd)) return resolvedCache.get(cmd) ?? null;
  let r: string | null = null;
  if (path.isAbsolute(cmd)) {
    r = realIfRunnable(cmd);
    if (!r && process.platform === 'win32') {
      for (const ext of winPathext()) {
        r = realIfRunnable(cmd + ext);
        if (r) break;
      }
    }
  } else {
    for (const d of splitPathEnv()) {
      const base = path.join(d, cmd);
      r = realIfRunnable(base);
      if (r) break;
      if (process.platform === 'win32') {
        for (const ext of winPathext()) {
          r = realIfRunnable(base + ext);
          if (r) break;
        }
        if (r) break;
      }
    }
  }
  if (!r && cmd === 'grok') r = grokHomeFallback();
  resolvedCache.set(cmd, r);
  return r;
}

function grokHomeFallback(): string | null {
  const base = path.join(os.homedir(), '.grok', 'bin', 'grok');
  const direct = realIfRunnable(base);
  if (direct) return direct;
  if (process.platform === 'win32') {
    for (const ext of ['.exe', '.cmd', '.bat']) {
      const hit = realIfRunnable(base + ext);
      if (hit) return hit;
    }
  }
  return null;
}

/** On Windows, npm `.cmd` shims cannot be spawn()'d with shell:false
 *  (EINVAL / CVE-2024-27980). Unwrap the shim's `%~dp0%\\...js` target and
 *  run it with the current Node. Other platforms return the path unchanged. */
export function resolveSpawnTarget(resolvedPath: string, args: string[], platform = process.platform): { file: string; args: string[] } {
  if (platform !== 'win32') return { file: resolvedPath, args };
  const p = path.win32;
  const ext = p.extname(resolvedPath).toLowerCase();
  if (ext !== '.cmd' && ext !== '.bat') return { file: resolvedPath, args };
  let text = '';
  try { text = fs.readFileSync(resolvedPath, 'utf8'); } catch { return { file: resolvedPath, args }; }
  const m = text.match(/"%(?:~)?dp0%\\([^"]+\.js)"/i);
  if (!m) return { file: resolvedPath, args };
  const scriptPath = p.resolve(p.dirname(resolvedPath), m[1]);
  return { file: process.execPath, args: [scriptPath, ...args] };
}

/** SEC-001 C1–C3: the ONE place that maps a repo dir to Claude's on-disk
 *  project dir (~/.claude/projects/<escaped>). Escape = every non
 *  [a-zA-Z0-9] char → '-', matching Claude Code's layout. */
export function claudeProjectDir(repoDir: string): string {
  const escaped = repoDir.replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', escaped);
}

/** SEC-001 C2: list jsonl session files for a repo. When Claude's dash-escape
 *  collides (two distinct realpaths → same escaped name), prefer sessions
 *  whose own per-line `cwd` metadata matches `repoDir`. Returns newest-first. */
export function claudeSessionFiles(repoDir: string): string[] {
  const dir = claudeProjectDir(repoDir);
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    const stamped = files.map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }));
    // Collision disambiguation: if any file's first line carries a cwd that
    // does NOT match repoDir, it likely belongs to a colliding project — drop
    // it unless nothing matches.
    const cwdOf = (full: string): string | null => {
      try {
        const head = tailBytes(full, 64 * 1024);
        const m = head.match(/"cwd":"([^"]*)"/);
        return m ? m[1] : null;
      } catch { return null; }
    };
    const matching = stamped.filter(({ f }) => {
      const cwd = cwdOf(path.join(dir, f));
      return cwd === null || cwd === repoDir; // keep cwd-less or matching
    });
    const pool = matching.length ? matching : stamped;
    pool.sort((a, b) => b.mtime - a.mtime);
    return pool.map((x) => x.f);
  } catch { return []; }
}

/** SEC-001 R1: read only the trailing `maxBytes` of a file — never an
 *  unbounded readFileSync on a huge session log. */
export const USAGE_MAX_BYTES = 8 * 1024 * 1024;
export function tailBytes(file: string, maxBytes: number): string {
  const st = fs.statSync(file);
  const start = Math.max(0, st.size - maxBytes);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(st.size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return buf.toString('utf8');
}
