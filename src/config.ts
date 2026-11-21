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
  const out = AGENTS;
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
  const cmd = agent.interactive[0];
  if (path.isAbsolute(cmd)) return fs.existsSync(cmd);
  const dirs = (process.env.PATH ?? '').split(':');
  return dirs.some((d) => {
    const p = path.join(d, cmd);
    try {
      const st = fs.statSync(p);
      return st.isFile() && (st.mode & 0o111) !== 0; // executable bit set
    } catch { return false; }
  });
}
