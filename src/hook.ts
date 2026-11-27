// FEAT-004: minimal, fast-path hook runner (`kala _hook --agent <key> --event <name>`).
// Keep imports strictly limited to Node.js stdlib and `./config.ts` so hook
// invocations never load ledger, picker, launch, liveask, trust, or prompt.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadHookConfig } from './config.ts';
import type { HookConfig } from './config.ts';

export const MAX_STDIN_BYTES = 64 * 1024;
export const HOOK_DEADLINE_MS = 2000;
export const HOOK_STDIN_DEADLINE_MS = HOOK_DEADLINE_MS - 400;
export const HOOK_ERROR_LOG_MAX_BYTES = 32 * 1024;
export const HOOK_NUDGE_MAX_CHARS = 250;

export interface HookArgs {
  agent: string;
  event: string;
}

export interface HookState {
  editsSinceCheckpoint: number;
  lastNudgeAt: string | null;
  lastStateMtimeMs: number;
  lastStateSize: number;
  lastToolUseId?: string | null;
}

const VALID_HOOK_AGENTS = new Set(['claude', 'agy', 'cursor', 'grok']);

export interface HookEvalResult {
  shouldNudge: boolean;
  editsSinceCheckpoint: number;
  state: HookState;
}

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

function assertNotSymlink(p: string, what: string): fs.Stats | null {
  const st = lstatOrNull(p);
  if (st && st.isSymbolicLink()) {
    throw new Error(`refusing to ${what}: ${path.basename(p)} is a symlink`);
  }
  return st;
}

function hookStatePath(repoDir: string): string {
  return path.join(repoDir, '.kala', '.hook-state.json');
}

function hookErrorLogPath(repoDir: string): string {
  return path.join(repoDir, '.kala', 'hook-errors.log');
}

export function parseHookArgs(argv: string[]): HookArgs | null {
  let agent = '';
  let event = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--agent') {
      agent = argv[i + 1] ?? '';
      i++;
    } else if (a.startsWith('--agent=')) {
      agent = a.slice('--agent='.length);
    } else if (a === '--event') {
      event = argv[i + 1] ?? '';
      i++;
    } else if (a.startsWith('--event=')) {
      event = a.slice('--event='.length);
    }
  }
  if (!VALID_HOOK_AGENTS.has(agent) || !event) return null;
  return { agent, event };
}

/** Resolve project root from payload.cwd -> workspaceRoot -> workspace_roots[0] ->
 *  workspacePaths[0] -> fallbackCwd, walking up (stopping at .git root or
 *  filesystem root) for `.kala/state.yaml`. */
export function findRepoRoot(
  payload: Record<string, unknown>,
  fallbackCwd: string = process.cwd(),
): string | null {
  let start = '';
  if (typeof payload.cwd === 'string' && payload.cwd.trim()) {
    start = payload.cwd.trim();
  } else if (typeof payload.workspaceRoot === 'string' && payload.workspaceRoot.trim()) {
    start = payload.workspaceRoot.trim();
  } else if (
    Array.isArray(payload.workspace_roots) &&
    typeof payload.workspace_roots[0] === 'string' &&
    payload.workspace_roots[0].trim()
  ) {
    start = payload.workspace_roots[0].trim();
  } else if (
    Array.isArray(payload.workspacePaths) &&
    typeof payload.workspacePaths[0] === 'string' &&
    payload.workspacePaths[0].trim()
  ) {
    start = payload.workspacePaths[0].trim();
  } else {
    start = fallbackCwd;
  }

  let dir = path.resolve(start);
  while (true) {
    const kalaDir = path.join(dir, '.kala');
    const stateFile = path.join(kalaDir, 'state.yaml');
    try {
      const kst = lstatOrNull(kalaDir);
      if (kst && !kst.isSymbolicLink() && kst.isDirectory()) {
        const sst = lstatOrNull(stateFile);
        if (sst && !sst.isSymbolicLink() && sst.isFile()) {
          return dir;
        }
      }
    } catch { /* keep walking or fail safely */ }

    if (lstatOrNull(path.join(dir, '.git')) !== null) {
      return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function targetsStateFile(p: unknown): boolean {
  if (typeof p !== 'string' || !p.trim()) return false;
  const norm = p.trim().replace(/\\/g, '/');
  return /(?:^|\/)\.kala\/state\.yaml$/.test(norm);
}

function commandTouchesState(cmd: unknown): boolean {
  if (typeof cmd !== 'string' || !cmd.trim()) return false;
  return /\bkala\s+state\b/.test(cmd) || /(?:^|[\s"'=/\\><;|&`])\.kala[/\\]state\.yaml(?=$|[\s"'`;&|<>])/.test(cmd);
}

/** FEAT-004 K9/K25: skip counting PostToolUse edits targeting `.kala/state.yaml` or `kala state`. */
export function isSelfEdit(
  _agent: string,
  event: string,
  payload: Record<string, unknown>,
): boolean {
  if (event !== 'PostToolUse') return false;
  const toolInputs = [
    isPlainObject(payload.tool_input) ? payload.tool_input : null,
    isPlainObject(payload.toolInput) ? payload.toolInput : null,
  ];
  const toolCall = isPlainObject(payload.toolCall) ? payload.toolCall : null;
  const toolArgs = toolCall && isPlainObject(toolCall.args)
    ? toolCall.args
    : (isPlainObject(payload.args) ? payload.args : null);

  for (const ti of toolInputs) {
    if (!ti) continue;
    if (targetsStateFile(ti.file_path) || targetsStateFile(ti.path)) return true;
    if (commandTouchesState(ti.command)) return true;
  }
  if (toolArgs) {
    if (
      targetsStateFile(toolArgs.TargetFile) ||
      targetsStateFile(toolArgs.Path) ||
      targetsStateFile(toolArgs.path) ||
      targetsStateFile(toolArgs.file_path) ||
      targetsStateFile(toolArgs.CodeFile)
    ) {
      return true;
    }
    if (commandTouchesState(toolArgs.CommandLine) || commandTouchesState(toolArgs.command)) {
      return true;
    }
  }
  if (targetsStateFile(payload.file_path) || targetsStateFile(payload.path) || commandTouchesState(payload.command)) {
    return true;
  }
  return false;
}

function extractToolUseId(payload: Record<string, unknown>): string | null {
  for (const k of ['tool_use_id', 'toolUseId'] as const) {
    const v = payload[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 128);
  }
  return null;
}

function hasKalagaVendorHook(repoDir: string, vendor: 'cursor' | 'grok'): boolean {
  const relParts = vendor === 'cursor'
    ? ['.cursor', 'hooks.json']
    : ['.grok', 'hooks', 'kalaga-checkpoint.json'];
  let cur = repoDir;
  for (const seg of relParts.slice(0, -1)) {
    cur = path.join(cur, seg);
    const dst = lstatOrNull(cur);
    if (!dst || dst.isSymbolicLink() || !dst.isDirectory()) return false;
  }
  const file = path.join(repoDir, ...relParts);
  const fst = lstatOrNull(file);
  if (!fst || fst.isSymbolicLink() || !fst.isFile()) return false;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (vendor === 'cursor') return raw.includes('_hook --agent cursor');
    return raw.includes('_hook') && (raw.includes('"--agent",') || raw.includes('_hook --agent grok')) && raw.includes('"grok"');
  } catch {
    return false;
  }
}

function isForeignOverlap(
  agent: string,
  repoDir: string,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if ((agent === 'claude' || agent === 'cursor') && typeof env.GROK_HOOK_EVENT === 'string' && env.GROK_HOOK_EVENT.length > 0) {
    if (hasKalagaVendorHook(repoDir, 'grok')) return true;
  }
  if (agent === 'claude' && typeof payload.cursor_version === 'string' && payload.cursor_version.length > 0) {
    if (hasKalagaVendorHook(repoDir, 'cursor')) return true;
  }
  return false;
}

export function loadHookState(repoDir: string): HookState | null {
  const kalaDir = path.join(repoDir, '.kala');
  const dirSt = assertNotSymlink(kalaDir, 'read hook state');
  if (!dirSt || !dirSt.isDirectory()) return null;

  const file = hookStatePath(repoDir);
  const st = assertNotSymlink(file, 'read hook state');
  if (!st || !st.isFile()) return null;

  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return null;
    const edits = typeof parsed.editsSinceCheckpoint === 'number' && Number.isFinite(parsed.editsSinceCheckpoint) && parsed.editsSinceCheckpoint >= 0
      ? Math.floor(parsed.editsSinceCheckpoint)
      : 0;
    const lastNudgeAt = typeof parsed.lastNudgeAt === 'string' && parsed.lastNudgeAt.trim()
      ? parsed.lastNudgeAt
      : null;
    const lastStateMtimeMs = typeof parsed.lastStateMtimeMs === 'number' && Number.isFinite(parsed.lastStateMtimeMs) && parsed.lastStateMtimeMs >= 0
      ? parsed.lastStateMtimeMs
      : 0;
    const lastStateSize = typeof parsed.lastStateSize === 'number' && Number.isFinite(parsed.lastStateSize) && parsed.lastStateSize >= 0
      ? Math.floor(parsed.lastStateSize)
      : 0;
    const lastToolUseId = typeof parsed.lastToolUseId === 'string' && parsed.lastToolUseId.trim()
      ? parsed.lastToolUseId
      : null;
    return {
      editsSinceCheckpoint: edits,
      lastNudgeAt,
      lastStateMtimeMs,
      lastStateSize,
      lastToolUseId,
    };
  } catch {
    return null;
  }
}

export function saveHookState(repoDir: string, state: HookState): void {
  const dir = path.join(repoDir, '.kala');
  const dirSt = assertNotSymlink(dir, 'write hook state');
  if (!dirSt) {
    fs.mkdirSync(dir, { recursive: true });
    const created = assertNotSymlink(dir, 'write hook state');
    if (!created || !created.isDirectory()) {
      throw new Error('refusing to write hook state: .kala is not a directory');
    }
  } else if (!dirSt.isDirectory()) {
    throw new Error('refusing to write hook state: .kala is not a directory');
  }

  const file = hookStatePath(repoDir);
  assertNotSymlink(file, 'write hook state');

  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  const body = JSON.stringify(state, null, 2) + '\n';
  fs.writeFileSync(tmp, body, { mode: 0o600, flag: 'wx' });
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

export function buildNudgeText(editsSinceCheckpoint: number): string {
  const n = Number.isFinite(editsSinceCheckpoint)
    ? Math.max(0, Math.min(999_999, Math.floor(editsSinceCheckpoint)))
    : 0;
  const unit = n === 1 ? 'edit' : 'edits';
  return `[kalaga] .kala/state.yaml is stale (${n} ${unit} since last update). Before continuing, update done, next_step, and negative_constraints in .kala/state.yaml so handoff state stays current.`;
}

export function evaluateHook(opts: {
  agent: string;
  event: string;
  repoDir: string;
  payload: Record<string, unknown>;
  config?: HookConfig;
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
}): HookEvalResult {
  const config = opts.config ?? loadHookConfig();
  const nowMs = opts.nowMs ?? Date.now();
  const emptyState: HookState = {
    editsSinceCheckpoint: 0,
    lastNudgeAt: null,
    lastStateMtimeMs: 0,
    lastStateSize: 0,
    lastToolUseId: null,
  };

  if (!config.enabled) {
    return { shouldNudge: false, editsSinceCheckpoint: 0, state: emptyState };
  }

  if (isForeignOverlap(opts.agent, opts.repoDir, opts.payload, opts.env)) {
    return { shouldNudge: false, editsSinceCheckpoint: 0, state: emptyState };
  }

  const kalaDir = path.join(opts.repoDir, '.kala');
  const kalaSt = assertNotSymlink(kalaDir, 'read state');
  if (!kalaSt || !kalaSt.isDirectory()) {
    return { shouldNudge: false, editsSinceCheckpoint: 0, state: emptyState };
  }

  const stateFile = path.join(kalaDir, 'state.yaml');
  const st = assertNotSymlink(stateFile, 'read state');
  if (!st || !st.isFile()) {
    return { shouldNudge: false, editsSinceCheckpoint: 0, state: emptyState };
  }

  const loaded = loadHookState(opts.repoDir);
  let state: HookState;
  if (loaded === null) {
    state = {
      editsSinceCheckpoint: 0,
      lastNudgeAt: null,
      lastStateMtimeMs: st.mtimeMs,
      lastStateSize: st.size,
      lastToolUseId: null,
    };
  } else if (st.mtimeMs > loaded.lastStateMtimeMs || st.size !== loaded.lastStateSize) {
    // FEAT-004 K10-v2: state.yaml changed -> reset counter + clear cooldown.
    // Only early-return {} for non-PostToolUse or self-edits; non-self PostToolUse
    // falls through so this edit is counted (`1`) rather than dropped.
    state = {
      editsSinceCheckpoint: 0,
      lastNudgeAt: null,
      lastStateMtimeMs: st.mtimeMs,
      lastStateSize: st.size,
      lastToolUseId: null,
    };
    if (opts.event !== 'PostToolUse' || isSelfEdit(opts.agent, opts.event, opts.payload)) {
      saveHookState(opts.repoDir, state);
      return { shouldNudge: false, editsSinceCheckpoint: 0, state };
    }
  } else {
    state = { ...loaded };
  }

  if (opts.event === 'PostToolUse') {
    const toolUseId = extractToolUseId(opts.payload);
    const isDuplicateTool = toolUseId !== null && state.lastToolUseId === toolUseId;
    if (!isSelfEdit(opts.agent, opts.event, opts.payload) && !isDuplicateTool) {
      state.editsSinceCheckpoint += 1;
      if (toolUseId !== null) state.lastToolUseId = toolUseId;
      saveHookState(opts.repoDir, state);
    } else if (loaded === null) {
      saveHookState(opts.repoDir, state);
    }
  } else if (loaded === null) {
    saveHookState(opts.repoDir, state);
  }

  // agy PostToolUse is counter/reset only; always emits {}.
  if (opts.agent === 'agy' && opts.event === 'PostToolUse') {
    return { shouldNudge: false, editsSinceCheckpoint: state.editsSinceCheckpoint, state };
  }

  // Mid-turn nudges: claude/cursor/grok PostToolUse, agy PreInvocation.
  if (
    ((opts.agent === 'claude' || opts.agent === 'cursor' || opts.agent === 'grok') && opts.event === 'PostToolUse') ||
    (opts.agent === 'agy' && opts.event === 'PreInvocation')
  ) {
    const thresholdMet = state.editsSinceCheckpoint >= config.edit_threshold;
    const ageMet =
      state.editsSinceCheckpoint >= 1 &&
      state.lastStateMtimeMs > 0 &&
      (nowMs - state.lastStateMtimeMs) >= config.max_age_minutes * 60_000;
    const lastNudgeMs = state.lastNudgeAt === null ? null : Date.parse(state.lastNudgeAt);
    const cooldownElapsed = lastNudgeMs === null || Number.isNaN(lastNudgeMs) ||
      (nowMs - lastNudgeMs) >= config.cooldown_minutes * 60_000;

    if ((thresholdMet || ageMet) && cooldownElapsed) {
      state.lastNudgeAt = new Date(nowMs).toISOString();
      saveHookState(opts.repoDir, state);
      return { shouldNudge: true, editsSinceCheckpoint: state.editsSinceCheckpoint, state };
    }
    return { shouldNudge: false, editsSinceCheckpoint: state.editsSinceCheckpoint, state };
  }

  // End-of-turn Stop nudges (gated by vendor re-entry/termination guards, not cooldown).
  if (opts.event === 'Stop') {
    if (state.editsSinceCheckpoint < 1) {
      return { shouldNudge: false, editsSinceCheckpoint: state.editsSinceCheckpoint, state };
    }
    if (opts.agent === 'claude') {
      if (opts.payload.stop_hook_active === true) {
        return { shouldNudge: false, editsSinceCheckpoint: state.editsSinceCheckpoint, state };
      }
      return { shouldNudge: true, editsSinceCheckpoint: state.editsSinceCheckpoint, state };
    }
    if (opts.agent === 'cursor') {
      if (
        opts.payload.stop_hook_active === true ||
        opts.payload.status === 'aborted' ||
        (typeof opts.payload.loop_count === 'number' && opts.payload.loop_count > 0)
      ) {
        return { shouldNudge: false, editsSinceCheckpoint: state.editsSinceCheckpoint, state };
      }
      return { shouldNudge: true, editsSinceCheckpoint: state.editsSinceCheckpoint, state };
    }
    if (opts.agent === 'grok') {
      if (
        opts.payload.stopHookActive === true ||
        opts.payload.stop_hook_active === true ||
        (typeof opts.payload.subagentType === 'string' && opts.payload.subagentType.length > 0) ||
        (typeof opts.payload.reason === 'string' && opts.payload.reason !== 'end_turn')
      ) {
        return { shouldNudge: false, editsSinceCheckpoint: state.editsSinceCheckpoint, state };
      }
      return { shouldNudge: true, editsSinceCheckpoint: state.editsSinceCheckpoint, state };
    }
    if (opts.agent === 'agy') {
      if (
        opts.payload.continuationActive === true ||
        opts.payload.terminationReason !== 'NO_TOOL_CALL'
      ) {
        return { shouldNudge: false, editsSinceCheckpoint: state.editsSinceCheckpoint, state };
      }
      return { shouldNudge: true, editsSinceCheckpoint: state.editsSinceCheckpoint, state };
    }
  }

  return { shouldNudge: false, editsSinceCheckpoint: state.editsSinceCheckpoint, state };
}

export function formatVendorOutput(
  agent: string,
  event: string,
  result: { shouldNudge: boolean; editsSinceCheckpoint?: number; state?: HookState },
): Record<string, unknown> {
  if (!result.shouldNudge) return {};
  if (agent === 'agy' && event === 'PostToolUse') return {};

  const edits = result.editsSinceCheckpoint ?? result.state?.editsSinceCheckpoint ?? 0;
  const nudge = buildNudgeText(edits);

  if (agent === 'claude' || agent === 'grok') {
    if (event === 'PostToolUse') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: nudge,
        },
      };
    }
    if (event === 'Stop') {
      return {
        decision: 'block',
        reason: nudge,
      };
    }
    return {};
  }

  if (agent === 'cursor') {
    if (event === 'PostToolUse') {
      return {
        additional_context: nudge,
      };
    }
    if (event === 'Stop') {
      return {
        followup_message: nudge,
      };
    }
    return {};
  }

  if (agent === 'agy') {
    if (event === 'PreInvocation') {
      return {
        injectSteps: [
          {
            systemMessage: {
              systemMessage: nudge,
            },
          },
        ],
      };
    }
    if (event === 'Stop') {
      return {
        decision: 'continue',
        reason: nudge,
      };
    }
    return {};
  }

  return {};
}

function sanitizeErrorMessage(err: unknown): string {
  if (err instanceof SyntaxError) {
    return 'SyntaxError: malformed stdin JSON';
  }
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return raw
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || 'unknown hook error';
}

export function logHookError(repoDir: string, err: unknown): void {
  try {
    const kalaDir = path.join(repoDir, '.kala');
    const dirSt = lstatOrNull(kalaDir);
    if (!dirSt || dirSt.isSymbolicLink() || !dirSt.isDirectory()) return;

    const logFile = hookErrorLogPath(repoDir);
    const logSt = lstatOrNull(logFile);
    if (logSt && (logSt.isSymbolicLink() || !logSt.isFile())) return;

    const line = `${new Date().toISOString()} ${sanitizeErrorMessage(err)}\n`;
    const lineBytes = Buffer.byteLength(line, 'utf8');
    const existingSize = logSt ? logSt.size : 0;

    if (existingSize + lineBytes <= HOOK_ERROR_LOG_MAX_BYTES) {
      fs.appendFileSync(logFile, line, { mode: 0o600 });
      return;
    }

    // Keep trailing half of max capacity on line boundary + new line so log stays <= 32 KB.
    const keepBudget = Math.max(0, Math.floor(HOOK_ERROR_LOG_MAX_BYTES / 2) - lineBytes);
    let kept = '';
    if (keepBudget > 0 && logSt) {
      const fd = fs.openSync(logFile, 'r');
      try {
        const start = Math.max(0, existingSize - keepBudget);
        const buf = Buffer.alloc(existingSize - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        let tail = buf.toString('utf8');
        if (start > 0) {
          const nl = tail.indexOf('\n');
          tail = nl >= 0 ? tail.slice(nl + 1) : '';
        }
        kept = tail;
      } finally {
        fs.closeSync(fd);
      }
    }

    const tmp = path.join(
      kalaDir,
      `.hook-errors.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
    );
    fs.writeFileSync(tmp, kept + line, { mode: 0o600, flag: 'wx' });
    try {
      fs.renameSync(tmp, logFile);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw e;
    }
  } catch { /* never throw from error logger */ }
}

function readStdinBounded(
  maxBytes = MAX_STDIN_BYTES,
  deadlineMs = HOOK_STDIN_DEADLINE_MS,
): Promise<{ raw: string; truncated: boolean; timedOut: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    let truncated = false;
    let timedOut = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
      try { process.stdin.pause(); } catch { /* ignore */ }
      if (truncated || timedOut) {
        try { process.stdin.destroy(); } catch { /* ignore */ }
      }
      resolve({ raw: Buffer.concat(chunks).toString('utf8'), truncated, timedOut });
    };

    const onData = (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      const remaining = maxBytes - total;
      if (remaining <= 0) {
        truncated = true;
        finish();
        return;
      }
      if (buf.length > remaining) {
        chunks.push(buf.subarray(0, remaining));
        total += remaining;
        truncated = true;
        finish();
        return;
      }
      chunks.push(buf);
      total += buf.length;
    };

    const onEnd = () => finish();
    const onError = () => finish();

    const timer = setTimeout(() => {
      timedOut = true;
      finish();
    }, deadlineMs);
    timer.unref();

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
    process.stdin.resume();
  });
}

export async function runHookCli(argv: string[]): Promise<void> {
  let emitted = false;
  const emit = (obj: Record<string, unknown>): void => {
    if (emitted) return;
    emitted = true;
    process.stdout.write(JSON.stringify(obj) + '\n');
  };

  let repoDirForLog: string | null = null;
  const deadline = setTimeout(() => {
    if (repoDirForLog) logHookError(repoDirForLog, new Error('hook internal deadline exceeded'));
    emit({});
  }, HOOK_DEADLINE_MS);
  deadline.unref();

  try {
    const parsedArgs = parseHookArgs(argv);
    if (!parsedArgs) {
      emit({});
      return;
    }

    const config = loadHookConfig();
    if (!config.enabled) {
      emit({});
      return;
    }

    const { raw, truncated, timedOut } = await readStdinBounded(MAX_STDIN_BYTES, HOOK_STDIN_DEADLINE_MS);
    if (timedOut) {
      const fallbackRepo = findRepoRoot({});
      if (fallbackRepo) logHookError(fallbackRepo, new Error('stdin read deadline exceeded'));
      emit({});
      return;
    }
    if (truncated) {
      const fallbackRepo = findRepoRoot({});
      if (fallbackRepo) logHookError(fallbackRepo, new Error('stdin exceeded 64KB cap'));
      emit({});
      return;
    }

    let payload: Record<string, unknown> = {};
    const trimmed = raw.trim();
    if (trimmed) {
      try {
        const parsedJson: unknown = JSON.parse(trimmed);
        if (!isPlainObject(parsedJson)) {
          const fallbackRepo = findRepoRoot({});
          if (fallbackRepo) logHookError(fallbackRepo, new Error('stdin JSON root must be an object'));
          emit({});
          return;
        }
        payload = parsedJson;
      } catch (e) {
        const fallbackRepo = findRepoRoot({});
        if (fallbackRepo) logHookError(fallbackRepo, e);
        emit({});
        return;
      }
    }

    const repoDir = findRepoRoot(payload);
    if (!repoDir) {
      emit({});
      return;
    }
    repoDirForLog = repoDir;

    const result = evaluateHook({
      agent: parsedArgs.agent,
      event: parsedArgs.event,
      repoDir,
      payload,
      config,
    });
    const out = formatVendorOutput(parsedArgs.agent, parsedArgs.event, result);
    emit(out);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'ENOENT' && code !== 'EEXIST') {
      const target = repoDirForLog ?? findRepoRoot({});
      if (target) logHookError(target, e);
    }
    emit({});
  } finally {
    clearTimeout(deadline);
    process.exitCode = 0;
  }
}
