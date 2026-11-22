// Kalaga config: agent roster, ceilings, error signatures.
// Kept deliberately dumb: this is the only file you tune. Rename the app and
// nothing here cares — agents are addressed by key, never by app name.
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
  /** Flags to resume the most recent conversation for this dir. */
  resume: string[];
  /** Flags to skip the per-directory "trust this workspace" prompt. */
  trustFlags: string[];
  /** Per-usage-window ceiling in tokens, for the headroom/freshness estimate. */
  ceiling: number;
  /** Error signatures that mean "this agent is out of quota for now". */
  limitPatterns: string[];
  /** How the ledger finds this agent's session store. */
  store: { kind: 'jsonl' | 'sqlite' | 'meta'; dir?: string };
}

const GROC_HOME = path.join(os.homedir(), '.grok', 'bin', 'grok');

export const AGENTS: Record<AgentKey, AgentConfig> = {
  agy: {
    key: 'agy',
    interactive: ['agy'],
    promptPrefix: '-i',
    trustFlags: [],
    headless: ['-p', '--output-format', 'text'],
    resume: ['--continue'],
    ceiling: 250_000,
    limitPatterns: [
      'rate.?limit', 'usage limit', 'quota', 'too many requests',
      'usage reset', 'spending limit', 'insufficient', 'limit reached',
    ],
    store: { kind: 'meta' },
  },
  cursor: {
    key: 'cursor',
    interactive: ['cursor-agent'],
    promptPrefix: '',
    trustFlags: ['--trust'],
    headless: ['-p', '--output-format', 'text'],
    resume: ['--continue'],
    ceiling: 250_000,
    limitPatterns: [
      'rate.?limit', 'usage limit', 'quota', 'too many requests',
      'limit reached', 'spending limit', 'insufficient',
    ],
    store: { kind: 'meta' },
  },
  grok: {
    key: 'grok',
    interactive: [GROC_HOME],
    promptPrefix: '',
    trustFlags: [],
    headless: ['-p', '--output-format', 'plain'],
    resume: ['--continue'],
    ceiling: 250_000,
    limitPatterns: [
      'rate.?limit', 'usage limit', 'quota', 'too many requests',
      'limit reached', 'spending limit', 'insufficient', 'credits',
    ],
    store: { kind: 'sqlite' },
  },
  claude: {
    key: 'claude',
    interactive: ['claude'],
    promptPrefix: '',
    trustFlags: [],
    headless: ['-p', '--output-format', 'text'],
    resume: ['--continue'],
    ceiling: 250_000,
    limitPatterns: [
      'rate.?limit', 'usage limit', 'quota', 'too many requests',
      'limit reached', 'spending limit', 'insufficient', 'session limit',
    ],
    store: { kind: 'jsonl' },
  },
};

export const AGENT_ORDER: AgentKey[] = ['agy', 'cursor', 'grok', 'claude'];

// Tokens remaining before the bottom bar starts warning.
export const WARN_THRESHOLD = 15_000;

export interface KalagaConfig {
  agents: Record<string, Partial<AgentConfig> & { ceiling?: number }>;
}

export function kalagaHome(): string {
  return process.env.KALA_HOME ?? path.join(os.homedir(), '.kala');
}

export function stateFile(repoDir: string): string {
  return path.join(repoDir, '.kala', 'state.yaml');
}

export function configPath(): string {
  return path.join(kalagaHome(), 'config.yaml');
}

/**
 * Load ~/.kala/config.yaml (tiny: agent ceilings / overrides) and merge onto
 * the built-in AGENTS. Missing file = pure built-ins. No YAML parser needed:
 * we accept a flat `  agent: 123456` ceiling map under `ceilings:`.
 */
export function loadAgents(): Record<AgentKey, AgentConfig> {
  // SEC-001 M1: return copies — config overrides must never mutate AGENTS.
  const out = Object.fromEntries(
    AGENT_ORDER.map((k) => [k, { ...AGENTS[k], limitPatterns: [...AGENTS[k].limitPatterns], store: { ...AGENTS[k].store } }]),
  ) as Record<AgentKey, AgentConfig>;
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const m = raw.match(/^ceilings:\s*\n((?:\s{2}\w+:\s*\d+\s*\n?)+)/m);
    if (m) {
      for (const line of m[1].split('\n')) {
        const km = line.match(/^\s{2}(\w+):\s*(\d+)/);
        if (km && out[km[1] as AgentKey]) {
          out[km[1] as AgentKey].ceiling = parseInt(km[2], 10);
        }
      }
    }
  } catch { /* no config → built-ins */ }
  return out;
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

/** SEC-001 B1/B2: resolve a command to an absolute executable path once,
 *  or null. Absolute inputs are verified as-is; bare names walk PATH in
 *  order (first executable wins). Cached per-process so a PATH change mid-run
 *  can't swap the binary (B3: spawn always gets the resolved path). */
const resolvedCache = new Map<string, string | null>();
export function resolveExecutable(cmd: string): string | null {
  if (resolvedCache.has(cmd)) return resolvedCache.get(cmd) ?? null;
  let r: string | null = null;
  if (path.isAbsolute(cmd)) {
    try {
      const st = fs.statSync(cmd);
      if (st.isFile() && (st.mode & 0o111) !== 0) r = fs.realpathSync(cmd);
    } catch { r = null; }
  } else {
    for (const d of (process.env.PATH ?? '').split(':')) {
      const p = path.join(d, cmd);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && (st.mode & 0o111) !== 0) { r = fs.realpathSync(p); break; }
      } catch { /* keep looking */ }
    }
  }
  resolvedCache.set(cmd, r);
  return r;
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
