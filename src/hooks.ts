// FEAT-004: `kala hooks install|status|uninstall` — opt-in, non-destructive
// project hook management for Claude Code (`.claude/settings.local.json`) and
// Antigravity (`.agents/hooks.json`).
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { agentFor, isInstalled, loadHookConfig } from './config.ts';
import type { HookConfig } from './config.ts';
import { loadHookState } from './hook.ts';

export type HookAgentKey = 'claude' | 'agy' | 'cursor' | 'grok';
export const SUPPORTED_HOOK_AGENTS: HookAgentKey[] = ['claude', 'agy', 'cursor', 'grok'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

function assertDirSafe(dir: string, label: string): fs.Stats | null {
  const st = lstatOrNull(dir);
  if (st) {
    if (st.isSymbolicLink()) throw new Error(`refusing to access ${label}: ${dir} is a symlink`);
    if (!st.isDirectory()) throw new Error(`refusing to access ${label}: ${dir} is not a directory`);
  }
  return st;
}

function assertFileSafe(file: string, label: string): fs.Stats | null {
  const st = lstatOrNull(file);
  if (st) {
    if (st.isSymbolicLink()) throw new Error(`refusing to access ${label}: ${file} is a symlink`);
    if (!st.isFile()) throw new Error(`refusing to access ${label}: ${file} is not a regular file`);
  }
  return st;
}

function assertAncestorsSafe(repoDir: string, targetFile: string, label: string): void {
  assertDirSafe(repoDir, label);
  const rel = path.relative(repoDir, targetFile);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`refusing to access ${label}: ${targetFile} escapes repo root`);
  }
  const dirRel = path.dirname(rel);
  if (dirRel && dirRel !== '.') {
    let cur = repoDir;
    for (const seg of dirRel.split(path.sep)) {
      cur = path.join(cur, seg);
      const st = lstatOrNull(cur);
      if (!st) break;
      if (st.isSymbolicLink()) throw new Error(`refusing to access ${label}: ${cur} is a symlink`);
      if (!st.isDirectory()) throw new Error(`refusing to access ${label}: ${cur} is not a directory`);
    }
  }
  assertFileSafe(targetFile, label);
}

function ensureSafeDirChain(repoDir: string, dir: string, label: string): void {
  const rel = path.relative(repoDir, dir);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`refusing to access ${label}: ${dir} escapes repo root`);
  }
  assertDirSafe(repoDir, label);
  if (!rel || rel === '.') return;
  let cur = repoDir;
  for (const seg of rel.split(path.sep)) {
    cur = path.join(cur, seg);
    const st = assertDirSafe(cur, label);
    if (!st) {
      fs.mkdirSync(cur, { mode: 0o700 });
      assertDirSafe(cur, label);
    }
  }
}

function readJsonObjectSafe(repoDir: string, file: string, label: string): { obj: Record<string, unknown>; mode: number | null; exists: boolean } {
  assertAncestorsSafe(repoDir, file, label);
  const st = lstatOrNull(file);
  if (!st) return { obj: {}, mode: null, exists: false };

  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) {
    throw new Error(`cannot parse ${label} (${file}): file is empty/invalid JSON — aborting without overwriting`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`cannot parse ${label} (${file}): ${(e as Error).message} — aborting without overwriting`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`cannot parse ${label} (${file}): top-level JSON value must be an object — aborting without overwriting`);
  }
  return { obj: parsed, mode: st.mode & 0o777, exists: true };
}

function atomicWriteJson(repoDir: string, file: string, obj: Record<string, unknown>, existingMode: number | null, label: string): void {
  const dir = path.dirname(file);
  assertAncestorsSafe(repoDir, file, label);
  ensureSafeDirChain(repoDir, dir, label);
  assertFileSafe(file, label);

  const mode = existingMode ?? 0o600;
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode, flag: 'wx' });
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

/** POSIX single-quote shell escaping (supports spaces and special chars safely). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Resolve the real absolute path to `bin/kala` and verify executability. */
export function resolveKalaBin(): string {
  const candidate = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'kala');
  let real: string;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    throw new Error(`cannot locate bin/kala at ${candidate}`);
  }
  const st = fs.statSync(real);
  if (!st.isFile()) throw new Error(`bin/kala is not a file: ${real}`);
  if (process.platform !== 'win32') {
    try {
      fs.accessSync(real, fs.constants.X_OK);
    } catch {
      throw new Error(`bin/kala is not executable: ${real} (run: chmod +x ${real})`);
    }
  }
  return real;
}

export function parseHookAgentsArg(raw?: string): HookAgentKey[] {
  if (raw === undefined) return [...SUPPORTED_HOOK_AGENTS];
  const parts = raw.split(',').map((s) => s.trim());
  if (!parts.length || parts.some((p) => !p)) {
    throw new Error(`invalid --agents list '${raw}' (supported: ${SUPPORTED_HOOK_AGENTS.join(', ')})`);
  }
  const out: HookAgentKey[] = [];
  for (const p of parts) {
    if (!SUPPORTED_HOOK_AGENTS.includes(p as HookAgentKey)) {
      throw new Error(`unsupported hook agent '${p}' (supported: ${SUPPORTED_HOOK_AGENTS.join(', ')})`);
    }
    const key = p as HookAgentKey;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

function claudeCommand(kalaBin: string, event: 'PostToolUse' | 'Stop'): string {
  return `${shellQuote(kalaBin)} _hook --agent claude --event ${event}`;
}

function cursorCommand(kalaBin: string, event: 'PostToolUse' | 'Stop'): string {
  return `${shellQuote(kalaBin)} _hook --agent cursor --event ${event}`;
}

function grokHookHandler(kalaBin: string, event: 'PostToolUse' | 'Stop', cfg: HookConfig): Record<string, unknown> {
  if (process.platform === 'win32') {
    return {
      type: 'command',
      command: process.execPath,
      args: [kalaBin, '_hook', '--agent', 'grok', '--event', event],
      timeout: cfg.timeout_seconds,
    };
  }
  return {
    type: 'command',
    command: kalaBin,
    args: ['_hook', '--agent', 'grok', '--event', event],
    timeout: cfg.timeout_seconds,
  };
}

function agyCommand(kalaBin: string, event: 'PostToolUse' | 'PreInvocation' | 'Stop'): string {
  const q = shellQuote(kalaBin);
  return `[ -x ${q} ] && ${q} _hook --agent agy --event ${event} || printf '{}'`;
}

function isKalagaHookEntry(entry: unknown, agentKey: HookAgentKey): boolean {
  if (!isPlainObject(entry)) return false;
  if (typeof entry.command === 'string' && entry.command.includes(`_hook --agent ${agentKey}`)) {
    return true;
  }
  if (Array.isArray(entry.args)) {
    const idx = entry.args.indexOf('_hook');
    if (idx >= 0 && entry.args[idx + 1] === '--agent' && entry.args[idx + 2] === agentKey) {
      return true;
    }
  }
  return false;
}

function isKalagaClaudeHook(entry: unknown): boolean {
  return isKalagaHookEntry(entry, 'claude');
}

function stripKalagaFromFlatList(list: unknown, agentKey: HookAgentKey): { next: unknown[]; removed: number } {
  if (!Array.isArray(list)) return { next: [], removed: 0 };
  const next = list.filter((entry) => !isKalagaHookEntry(entry, agentKey));
  return { next, removed: list.length - next.length };
}

function stripKalagaFromClaudeEventList(list: unknown): { next: unknown[]; removed: number } {
  if (!Array.isArray(list)) return { next: [], removed: 0 };
  const next: unknown[] = [];
  let removed = 0;
  for (const group of list) {
    if (isPlainObject(group) && Array.isArray(group.hooks)) {
      const kept = group.hooks.filter((h) => !isKalagaClaudeHook(h));
      const delta = group.hooks.length - kept.length;
      removed += delta;
      if (kept.length > 0) {
        next.push({ ...group, hooks: kept });
      } else if (delta === 0) {
        // Preserve empty non-Kalaga user groups untouched.
        next.push(group);
      }
    } else {
      next.push(group);
    }
  }
  return { next, removed };
}

function installClaudeHooks(repoDir: string, kalaBin: string, cfg: HookConfig): void {
  const file = path.join(repoDir, '.claude', 'settings.local.json');
  const { obj, mode } = readJsonObjectSafe(repoDir, file, '.claude/settings.local.json');

  let hooksObj: Record<string, unknown>;
  if (obj.hooks === undefined) {
    hooksObj = {};
  } else if (isPlainObject(obj.hooks)) {
    hooksObj = { ...obj.hooks };
  } else {
    throw new Error(`cannot merge .claude/settings.local.json: "hooks" must be an object`);
  }

  for (const ev of ['PostToolUse', 'Stop'] as const) {
    if (hooksObj[ev] !== undefined && !Array.isArray(hooksObj[ev])) {
      throw new Error(`cannot merge .claude/settings.local.json: "hooks.${ev}" must be an array`);
    }
  }

  const post = stripKalagaFromClaudeEventList(hooksObj.PostToolUse).next;
  post.push({
    matcher: 'Edit|Write|MultiEdit|Bash',
    hooks: [
      {
        type: 'command',
        command: claudeCommand(kalaBin, 'PostToolUse'),
        timeout: cfg.timeout_seconds,
      },
    ],
  });

  const stop = stripKalagaFromClaudeEventList(hooksObj.Stop).next;
  stop.push({
    hooks: [
      {
        type: 'command',
        command: claudeCommand(kalaBin, 'Stop'),
        timeout: cfg.timeout_seconds,
      },
    ],
  });

  hooksObj.PostToolUse = post;
  hooksObj.Stop = stop;
  const nextObj: Record<string, unknown> = { ...obj, hooks: hooksObj };
  atomicWriteJson(repoDir, file, nextObj, mode, '.claude/settings.local.json');
}

function uninstallClaudeHooks(repoDir: string): boolean {
  const file = path.join(repoDir, '.claude', 'settings.local.json');
  const { obj, mode, exists } = readJsonObjectSafe(repoDir, file, '.claude/settings.local.json');
  if (!exists) return false;
  if (!isPlainObject(obj.hooks)) return false;

  const hooksObj: Record<string, unknown> = { ...obj.hooks };
  let totalRemoved = 0;

  for (const ev of ['PostToolUse', 'Stop'] as const) {
    if (hooksObj[ev] === undefined) continue;
    const { next, removed } = stripKalagaFromClaudeEventList(hooksObj[ev]);
    if (removed > 0) {
      totalRemoved += removed;
      if (next.length > 0) hooksObj[ev] = next;
      else delete hooksObj[ev];
    }
  }

  if (totalRemoved === 0) return false;

  const nextObj: Record<string, unknown> = { ...obj };
  if (Object.keys(hooksObj).length > 0) nextObj.hooks = hooksObj;
  else delete nextObj.hooks;

  atomicWriteJson(repoDir, file, nextObj, mode, '.claude/settings.local.json');
  return true;
}

export function isGitRepo(repoDir: string): boolean {
  const res = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: repoDir,
    encoding: 'utf8',
  });
  return res.status === 0 && res.stdout.trim() === 'true';
}

export function isPathGitignored(repoDir: string, relPath: string): boolean {
  const res = spawnSync('git', ['check-ignore', '-q', relPath], {
    cwd: repoDir,
    encoding: 'utf8',
  });
  return res.status === 0;
}

function warnIfNotGitignored(repoDir: string, relPath: string): boolean {
  if (!isGitRepo(repoDir) || isPathGitignored(repoDir, relPath)) return false;
  console.error(`kalaga: warning — ${relPath} is not gitignored; add it to .gitignore or .git/info/exclude so machine-local paths are not committed.`);
  return true;
}

function installAgyHooks(repoDir: string, kalaBin: string, cfg: HookConfig): { gitignoreWarning: boolean } {
  const file = path.join(repoDir, '.agents', 'hooks.json');
  const { obj, mode } = readJsonObjectSafe(repoDir, file, '.agents/hooks.json');

  const nextObj: Record<string, unknown> = {
    ...obj,
    'kalaga-checkpoint': {
      PostToolUse: [
        {
          matcher: 'edit_file|write_file|run_command',
          hooks: [
            {
              type: 'command',
              command: agyCommand(kalaBin, 'PostToolUse'),
              timeout: cfg.timeout_seconds,
            },
          ],
        },
      ],
      PreInvocation: [
        {
          type: 'command',
          command: agyCommand(kalaBin, 'PreInvocation'),
          timeout: cfg.timeout_seconds,
        },
      ],
      Stop: [
        {
          type: 'command',
          command: agyCommand(kalaBin, 'Stop'),
          timeout: cfg.timeout_seconds,
        },
      ],
    },
  };

  atomicWriteJson(repoDir, file, nextObj, mode, '.agents/hooks.json');
  return { gitignoreWarning: warnIfNotGitignored(repoDir, '.agents/hooks.json') };
}

function installCursorHooks(repoDir: string, kalaBin: string, cfg: HookConfig): { gitignoreWarning: boolean } {
  const file = path.join(repoDir, '.cursor', 'hooks.json');
  const { obj, mode } = readJsonObjectSafe(repoDir, file, '.cursor/hooks.json');

  let hooksObj: Record<string, unknown>;
  if (obj.hooks === undefined) {
    hooksObj = {};
  } else if (isPlainObject(obj.hooks)) {
    hooksObj = { ...obj.hooks };
  } else {
    throw new Error('cannot merge .cursor/hooks.json: "hooks" must be an object');
  }

  for (const ev of ['postToolUse', 'stop'] as const) {
    if (hooksObj[ev] !== undefined && !Array.isArray(hooksObj[ev])) {
      throw new Error(`cannot merge .cursor/hooks.json: "hooks.${ev}" must be an array`);
    }
  }

  const post = stripKalagaFromFlatList(hooksObj.postToolUse, 'cursor').next;
  post.push({
    matcher: 'Write|Edit|Shell|StrReplace|Delete',
    command: cursorCommand(kalaBin, 'PostToolUse'),
    timeout: cfg.timeout_seconds,
  });

  const stop = stripKalagaFromFlatList(hooksObj.stop, 'cursor').next;
  stop.push({
    command: cursorCommand(kalaBin, 'Stop'),
    timeout: cfg.timeout_seconds,
  });

  hooksObj.postToolUse = post;
  hooksObj.stop = stop;
  const nextObj: Record<string, unknown> = {
    version: typeof obj.version === 'number' ? obj.version : 1,
    ...obj,
    hooks: hooksObj,
  };
  atomicWriteJson(repoDir, file, nextObj, mode, '.cursor/hooks.json');
  return { gitignoreWarning: warnIfNotGitignored(repoDir, '.cursor/hooks.json') };
}

function uninstallCursorHooks(repoDir: string): boolean {
  const file = path.join(repoDir, '.cursor', 'hooks.json');
  const { obj, mode, exists } = readJsonObjectSafe(repoDir, file, '.cursor/hooks.json');
  if (!exists || !isPlainObject(obj.hooks)) return false;

  const hooksObj: Record<string, unknown> = { ...obj.hooks };
  let totalRemoved = 0;
  for (const ev of ['postToolUse', 'stop'] as const) {
    if (hooksObj[ev] === undefined) continue;
    const { next, removed } = stripKalagaFromFlatList(hooksObj[ev], 'cursor');
    if (removed > 0) {
      totalRemoved += removed;
      if (next.length > 0) hooksObj[ev] = next;
      else delete hooksObj[ev];
    }
  }
  if (totalRemoved === 0) return false;

  const nextObj: Record<string, unknown> = { ...obj };
  if (Object.keys(hooksObj).length > 0) nextObj.hooks = hooksObj;
  else delete nextObj.hooks;

  atomicWriteJson(repoDir, file, nextObj, mode, '.cursor/hooks.json');
  return true;
}

const GROK_HOOK_REL = '.grok/hooks/kalaga-checkpoint.json';

function stripKalagaFromGroupedList(list: unknown, agentKey: HookAgentKey): { next: unknown[]; removed: number } {
  if (!Array.isArray(list)) return { next: [], removed: 0 };
  const next: unknown[] = [];
  let removed = 0;
  for (const group of list) {
    if (isPlainObject(group) && Array.isArray(group.hooks)) {
      const kept = group.hooks.filter((h) => !isKalagaHookEntry(h, agentKey));
      const delta = group.hooks.length - kept.length;
      removed += delta;
      if (kept.length > 0) next.push({ ...group, hooks: kept });
      else if (delta === 0) next.push(group);
    } else {
      next.push(group);
    }
  }
  return { next, removed };
}

function installGrokHooks(repoDir: string, kalaBin: string, cfg: HookConfig): { gitignoreWarning: boolean } {
  const file = path.join(repoDir, '.grok', 'hooks', 'kalaga-checkpoint.json');
  const { obj, mode } = readJsonObjectSafe(repoDir, file, GROK_HOOK_REL);

  let hooksObj: Record<string, unknown>;
  if (obj.hooks === undefined) {
    hooksObj = {};
  } else if (isPlainObject(obj.hooks)) {
    hooksObj = { ...obj.hooks };
  } else {
    throw new Error(`cannot merge ${GROK_HOOK_REL}: "hooks" must be an object`);
  }

  for (const ev of ['PostToolUse', 'Stop'] as const) {
    if (hooksObj[ev] !== undefined && !Array.isArray(hooksObj[ev])) {
      throw new Error(`cannot merge ${GROK_HOOK_REL}: "hooks.${ev}" must be an array`);
    }
  }

  const post = stripKalagaFromGroupedList(hooksObj.PostToolUse, 'grok').next;
  post.push({
    matcher: 'Edit|Write|MultiEdit|Bash|search_replace|write|run_terminal_command',
    hooks: [grokHookHandler(kalaBin, 'PostToolUse', cfg)],
  });

  const stop = stripKalagaFromGroupedList(hooksObj.Stop, 'grok').next;
  stop.push({
    hooks: [grokHookHandler(kalaBin, 'Stop', cfg)],
  });

  hooksObj.PostToolUse = post;
  hooksObj.Stop = stop;
  const nextObj: Record<string, unknown> = { ...obj, hooks: hooksObj };
  atomicWriteJson(repoDir, file, nextObj, mode, GROK_HOOK_REL);
  console.error('kalaga: note — Grok skips project hooks until this folder is trusted (/hooks-trust in Grok).');
  return { gitignoreWarning: warnIfNotGitignored(repoDir, GROK_HOOK_REL) };
}

function uninstallGrokHooks(repoDir: string): boolean {
  const file = path.join(repoDir, '.grok', 'hooks', 'kalaga-checkpoint.json');
  const { obj, mode, exists } = readJsonObjectSafe(repoDir, file, GROK_HOOK_REL);
  if (!exists || !isPlainObject(obj.hooks)) return false;

  const hooksObj: Record<string, unknown> = { ...obj.hooks };
  let totalRemoved = 0;
  for (const ev of ['PostToolUse', 'Stop'] as const) {
    if (hooksObj[ev] === undefined) continue;
    const { next, removed } = stripKalagaFromGroupedList(hooksObj[ev], 'grok');
    if (removed > 0) {
      totalRemoved += removed;
      if (next.length > 0) hooksObj[ev] = next;
      else delete hooksObj[ev];
    }
  }
  if (totalRemoved === 0) return false;

  const nextObj: Record<string, unknown> = { ...obj };
  if (Object.keys(hooksObj).length > 0) nextObj.hooks = hooksObj;
  else delete nextObj.hooks;

  if (Object.keys(nextObj).length === 0) {
    assertAncestorsSafe(repoDir, file, GROK_HOOK_REL);
    fs.unlinkSync(file);
  } else {
    atomicWriteJson(repoDir, file, nextObj, mode, GROK_HOOK_REL);
  }
  return true;
}

function uninstallAgyHooks(repoDir: string): boolean {
  const file = path.join(repoDir, '.agents', 'hooks.json');
  const { obj, mode, exists } = readJsonObjectSafe(repoDir, file, '.agents/hooks.json');
  if (!exists) return false;
  if (!Object.prototype.hasOwnProperty.call(obj, 'kalaga-checkpoint')) return false;

  const nextObj: Record<string, unknown> = { ...obj };
  delete nextObj['kalaga-checkpoint'];
  atomicWriteJson(repoDir, file, nextObj, mode, '.agents/hooks.json');
  return true;
}

export function defaultInstallAgents(): HookAgentKey[] {
  const installed = SUPPORTED_HOOK_AGENTS.filter((k) => isInstalled(agentFor(k)));
  if (installed.length === 0) {
    throw new Error(
      `no supported hook agents found on PATH (${SUPPORTED_HOOK_AGENTS.join(', ')}); pass --agents ${SUPPORTED_HOOK_AGENTS.join(',')} to install anyway`,
    );
  }
  return installed;
}

export function installHooks(
  repoDir: string,
  opts: { agents?: HookAgentKey[]; kalaBin?: string; config?: HookConfig } = {},
): { agents: HookAgentKey[]; kalaBin: string; agyGitignoreWarning: boolean; cursorGitignoreWarning: boolean; grokGitignoreWarning: boolean } {
  const agents = opts.agents ?? defaultInstallAgents();
  if (agents.length === 0) {
    throw new Error(`no hook agents specified (supported: ${SUPPORTED_HOOK_AGENTS.join(', ')})`);
  }
  const kalaBin = opts.kalaBin ?? resolveKalaBin();
  const cfg = opts.config ?? loadHookConfig();
  let agyGitignoreWarning = false;
  let cursorGitignoreWarning = false;
  let grokGitignoreWarning = false;

  for (const agent of agents) {
    if (agent === 'claude') {
      installClaudeHooks(repoDir, kalaBin, cfg);
    } else if (agent === 'agy') {
      if (installAgyHooks(repoDir, kalaBin, cfg).gitignoreWarning) agyGitignoreWarning = true;
    } else if (agent === 'cursor') {
      if (installCursorHooks(repoDir, kalaBin, cfg).gitignoreWarning) cursorGitignoreWarning = true;
    } else if (agent === 'grok') {
      if (installGrokHooks(repoDir, kalaBin, cfg).gitignoreWarning) grokGitignoreWarning = true;
    }
  }
  return { agents, kalaBin, agyGitignoreWarning, cursorGitignoreWarning, grokGitignoreWarning };
}

export function uninstallHooks(
  repoDir: string,
  opts: { agents?: HookAgentKey[] } = {},
): { removed: HookAgentKey[] } {
  const agents = opts.agents ?? [...SUPPORTED_HOOK_AGENTS];
  const removed: HookAgentKey[] = [];
  for (const agent of agents) {
    if (agent === 'claude') {
      if (uninstallClaudeHooks(repoDir)) removed.push('claude');
    } else if (agent === 'agy') {
      if (uninstallAgyHooks(repoDir)) removed.push('agy');
    } else if (agent === 'cursor') {
      if (uninstallCursorHooks(repoDir)) removed.push('cursor');
    } else if (agent === 'grok') {
      if (uninstallGrokHooks(repoDir)) removed.push('grok');
    }
  }
  return { removed };
}

export interface HooksStatusReport {
  claudeInstalled: boolean;
  claudeEvents: string[];
  claudeError: string | null;
  agyInstalled: boolean;
  agyError: string | null;
  cursorInstalled: boolean;
  cursorEvents: string[];
  cursorError: string | null;
  grokInstalled: boolean;
  grokEvents: string[];
  grokError: string | null;
  stateExists: boolean;
  stateAgeMs: number | null;
  editsSinceCheckpoint: number;
  lastNudgeAt: string | null;
  config: HookConfig;
}

function shortStatusError(err: unknown, label: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const cleaned = msg
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*—\s*aborting without overwriting$/, '')
    .trim();
  if (cleaned.endsWith('is a symlink')) return `${label} is a symlink`;
  if (cleaned.endsWith('is not a directory')) return `${path.dirname(label)} is not a directory`;
  if (cleaned.endsWith('is not a regular file')) return `${label} is not a regular file`;
  const colonIdx = cleaned.indexOf(': ');
  const concise = colonIdx >= 0 ? cleaned.slice(colonIdx + 2).trim() : cleaned;
  return (concise || cleaned || 'unknown error').slice(0, 120);
}

function countGroupedEvents(obj: Record<string, unknown>, agentKey: HookAgentKey, eventNames: readonly string[]): string[] {
  if (!isPlainObject(obj.hooks)) return [];
  const events: string[] = [];
  for (const ev of eventNames) {
    const list = obj.hooks[ev];
    if (!Array.isArray(list)) continue;
    const found = list.some(
      (g) => isPlainObject(g) && Array.isArray(g.hooks) && g.hooks.some((h) => isKalagaHookEntry(h, agentKey)),
    );
    if (found) events.push(ev);
  }
  return events;
}

function countCursorEvents(obj: Record<string, unknown>): string[] {
  if (!isPlainObject(obj.hooks)) return [];
  const events: string[] = [];
  for (const [ev, label] of [['postToolUse', 'PostToolUse'], ['stop', 'Stop']] as const) {
    const list = obj.hooks[ev];
    if (!Array.isArray(list)) continue;
    if (list.some((entry) => isKalagaHookEntry(entry, 'cursor'))) events.push(label);
  }
  return events;
}

export function hooksStatus(repoDir: string, nowMs = Date.now()): HooksStatusReport {
  const claudeFile = path.join(repoDir, '.claude', 'settings.local.json');
  let claudeEvents: string[] = [];
  let claudeError: string | null = null;
  try {
    const claudeParsed = readJsonObjectSafe(repoDir, claudeFile, '.claude/settings.local.json');
    claudeEvents = claudeParsed.exists ? countGroupedEvents(claudeParsed.obj, 'claude', ['PostToolUse', 'Stop']) : [];
  } catch (e) {
    claudeError = shortStatusError(e, '.claude/settings.local.json');
  }

  const agyFile = path.join(repoDir, '.agents', 'hooks.json');
  let agyInstalled = false;
  let agyError: string | null = null;
  try {
    const agyParsed = readJsonObjectSafe(repoDir, agyFile, '.agents/hooks.json');
    agyInstalled = agyParsed.exists && Object.prototype.hasOwnProperty.call(agyParsed.obj, 'kalaga-checkpoint');
  } catch (e) {
    agyError = shortStatusError(e, '.agents/hooks.json');
  }

  const cursorFile = path.join(repoDir, '.cursor', 'hooks.json');
  let cursorEvents: string[] = [];
  let cursorError: string | null = null;
  try {
    const cursorParsed = readJsonObjectSafe(repoDir, cursorFile, '.cursor/hooks.json');
    cursorEvents = cursorParsed.exists ? countCursorEvents(cursorParsed.obj) : [];
  } catch (e) {
    cursorError = shortStatusError(e, '.cursor/hooks.json');
  }

  const grokFile = path.join(repoDir, '.grok', 'hooks', 'kalaga-checkpoint.json');
  let grokEvents: string[] = [];
  let grokError: string | null = null;
  try {
    const grokParsed = readJsonObjectSafe(repoDir, grokFile, GROK_HOOK_REL);
    grokEvents = grokParsed.exists ? countGroupedEvents(grokParsed.obj, 'grok', ['PostToolUse', 'Stop']) : [];
  } catch (e) {
    grokError = shortStatusError(e, GROK_HOOK_REL);
  }

  const kalaDir = path.join(repoDir, '.kala');
  assertDirSafe(kalaDir, '.kala');
  const stateFile = path.join(kalaDir, 'state.yaml');
  const stateSt = assertFileSafe(stateFile, '.kala/state.yaml');
  const hookState = loadHookState(repoDir);

  return {
    claudeInstalled: claudeEvents.length > 0,
    claudeEvents,
    claudeError,
    agyInstalled,
    agyError,
    cursorInstalled: cursorEvents.length > 0,
    cursorEvents,
    cursorError,
    grokInstalled: grokEvents.length > 0,
    grokEvents,
    grokError,
    stateExists: Boolean(stateSt),
    stateAgeMs: stateSt ? Math.max(0, nowMs - stateSt.mtimeMs) : null,
    editsSinceCheckpoint: hookState?.editsSinceCheckpoint ?? 0,
    lastNudgeAt: hookState?.lastNudgeAt ?? null,
    config: loadHookConfig(),
  };
}

function formatAge(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function runHooksCli(sub: string | undefined, repoDir: string, flags: { agents?: string }): void {
  const mode = sub ?? 'status';
  if (mode === 'install') {
    const agents = flags.agents !== undefined ? parseHookAgentsArg(flags.agents) : undefined;
    const res = installHooks(repoDir, { agents });
    console.error(`kalaga: installed hooks for ${res.agents.join(', ')} (bin: ${res.kalaBin})`);
    return;
  }
  if (mode === 'uninstall') {
    const agents = parseHookAgentsArg(flags.agents);
    const res = uninstallHooks(repoDir, { agents });
    console.error(
      res.removed.length
        ? `kalaga: uninstalled hooks for ${res.removed.join(', ')}`
        : 'kalaga: no Kalaga hooks installed to remove',
    );
    return;
  }
  if (mode === 'status') {
    const st = hooksStatus(repoDir);
    const claudeDetail = st.claudeError
      ? `error (${st.claudeError})`
      : (st.claudeInstalled ? `installed (.claude/settings.local.json: ${st.claudeEvents.join(', ')})` : 'not installed');
    const agyDetail = st.agyError
      ? `error (${st.agyError})`
      : (st.agyInstalled ? 'installed (.agents/hooks.json: kalaga-checkpoint)' : 'not installed');
    const cursorDetail = st.cursorError
      ? `error (${st.cursorError})`
      : (st.cursorInstalled ? `installed (.cursor/hooks.json: ${st.cursorEvents.join(', ')})` : 'not installed');
    const grokDetail = st.grokError
      ? `error (${st.grokError})`
      : (st.grokInstalled ? `installed (${GROK_HOOK_REL}: ${st.grokEvents.join(', ')})` : 'not installed');
    console.log(`kalaga hooks · ${path.basename(repoDir)}`);
    console.log(`  claude: ${claudeDetail}`);
    console.log(`  agy:    ${agyDetail}`);
    console.log(`  cursor: ${cursorDetail}`);
    console.log(`  grok:   ${grokDetail}`);
    if (st.stateExists && st.stateAgeMs !== null) {
      console.log(`  checkpoint: ${formatAge(st.stateAgeMs)} · edits since checkpoint: ${st.editsSinceCheckpoint}${st.lastNudgeAt ? ` · last nudge: ${st.lastNudgeAt}` : ''}`);
    } else {
      console.log('  checkpoint: no .kala/state.yaml (run: kala init)');
    }
    console.log(
      `  config: enabled=${st.config.enabled} · threshold=${st.config.edit_threshold} · max_age=${st.config.max_age_minutes}m · cooldown=${st.config.cooldown_minutes}m · timeout=${st.config.timeout_seconds}s`,
    );
    return;
  }
  throw new Error(`unknown hooks subcommand '${mode}' (expected: install, status, uninstall)`);
}
