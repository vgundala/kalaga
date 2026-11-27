// OPS-001 O5 — durable, dependency-free test suite.
// Run: `npm test` or `node tests/run.ts`. No network; fixtures live in a
// throwaway dir under os.tmpdir(), removed on exit. Never touches the real
// ~/.claude or ~/.kala (HOME + KALA_HOME are redirected for the run).
import assert from 'node:assert';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kala-test-'));
const HOME = path.join(ROOT, 'home');
const KALA = path.join(ROOT, 'kala');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(KALA, { recursive: true });
process.env.HOME = HOME;
process.env.KALA_HOME = KALA;

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
const repoDir = path.join(ROOT, 'repo');
fs.mkdirSync(repoDir, { recursive: true });

let pass = 0, fail = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; console.error(`  \x1b[31m✗\x1b[0m ${name}\n      ${(e as Error).message}`); }
}
function section(h: string): void { console.log(`\n${h}`); }

// dynamic imports AFTER env redirect so os.homedir() sees the fake HOME
const { sanitizeHandoffField, handoffInject } = await import(`${SRC}/prompt.ts`);
const { classifyExit, scanChunk } = await import(`${SRC}/trap.ts`);
const cfg = await import(`${SRC}/config.ts`);
const state = await import(`${SRC}/state/state.ts`);
const trust = await import(`${SRC}/trust.ts`);
const launch = await import(`${SRC}/launch.ts`);
const liveask = await import(`${SRC}/liveask.ts`);
const picker = await import(`${SRC}/picker.ts`);
const yaml = await import(`${SRC}/util/yaml.ts`);
const gitmod = await import(`${SRC}/state/git.ts`);
const ledger = await import(`${SRC}/ledger.ts`);
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BIN = path.join(REPO, 'bin', 'kala');

section('sanitize / inject (P2/P3)');
await test('strips C0 controls + DEL, keeps \\n \\t', () => {
  assert.strictEqual(sanitizeHandoffField('a\x00b\x08c\x07f\x09g\nh\x1fi\x7f', 100), 'abcf\tg\nhi');
});
await test('truncates with … at cap', () => {
  const out = sanitizeHandoffField('x'.repeat(600), 500);
  assert.strictEqual(out.length, 500); assert.ok(out.endsWith('…'));
});
await test('FEAT-003: default inject is protocol mode (Goal/Done/Next + standing orders)', () => {
  const s = state.blankState('/tmp/x', null);
  s.goal = 'ship the CLI'; s.next_step = 'do it'; s.owner = 'claude';
  s.done = ['landed auth', 'landed tests'];
  const inj = handoffInject(s, false);
  assert.ok(inj.includes('Read .kala/state.yaml'), 'pointer');
  assert.ok(inj.includes('Goal: ship the CLI'), 'goal');
  assert.ok(inj.includes('Done: landed auth') && inj.includes('Done: landed tests'), 'done bullets');
  assert.ok(inj.includes('Next step: do it'), 'next');
  assert.ok(inj.includes('Maintain .kala/state.yaml'), 'standing orders');
});
await test('FEAT-003: protocol inject sanitizes + caps done list (12 × 300)', () => {
  const s = state.blankState('/tmp/x', null);
  s.done = Array.from({ length: 20 }, (_, i) => `item${i}:${'x'.repeat(400)}`);
  const inj = handoffInject(s, false);
  assert.ok(!inj.includes('item7:'), 'oldest 8 dropped (keep newest 12)');
  assert.ok(inj.includes('item8:'), 'newest-12 boundary kept');
  assert.ok(inj.includes('item19:'), 'newest kept');
  assert.ok(!inj.includes('x'.repeat(301)), 'per-item cap enforced');
});
await test('FEAT-003: rich inject adds modified files + context', () => {
  const s = state.blankState('/tmp/x', null);
  s.goal = 'SECRET'; s.modified_files = ['a.ts']; s.notes = 'where things stand';
  const inj = handoffInject(s, true);
  assert.ok(inj.includes('SECRET') && inj.includes('Modified files: a.ts') && inj.includes('Context: where things stand'));
});
await test('SEC: rich inject sanitizes modified_files (controls + caps)', () => {
  const s = state.blankState('/tmp/x', null);
  s.goal = 'g'; s.next_step = 'n';
  s.modified_files = ['ok.ts', 'bad\x00\x07path.ts', 'x'.repeat(400)];
  const inj = handoffInject(s, true);
  assert.ok(!inj.includes('\x00') && !inj.includes('\x07'));
  assert.ok(inj.includes('badpath.ts'));
  assert.ok(inj.includes('…'));
});
await test('AUDIT: handoff inject sanitizes owner (control chars stripped)', () => {
  const s = state.blankState('/tmp/x', null);
  s.owner = 'claude\x00\x1b[31mPOISON';
  const inj = handoffInject(s, false);
  assert.ok(!inj.includes('\x00') && !inj.includes('\x1b'), 'no control chars from owner');
  assert.ok(inj.includes('Kalaga handoff from claude'), 'owner still shown');
});

section('classifyExit / scanChunk (E2, L1)');
const hit = { matched: 'm', line: 'l', exitCode: null, agent: 'x' };
await test('hit → limit (even code 0)', () => assert.strictEqual(classifyExit({ hit, exitCode: 0, hasTail: true }), 'limit'));
await test('no tail + non-zero → suspect', () => assert.strictEqual(classifyExit({ hit: null, exitCode: 1, hasTail: false }), 'suspect'));
await test('no tail + zero → clean', () => assert.strictEqual(classifyExit({ hit: null, exitCode: 0, hasTail: false }), 'clean'));
await test('tail, no hit, non-zero → clean (crash ≠ limit)', () => assert.strictEqual(classifyExit({ hit: null, exitCode: 1, hasTail: true }), 'clean'));
await test('scanChunk: empty → null', () => assert.strictEqual(scanChunk('', cfg.AGENTS.claude, null), null));
await test('scanChunk: signature → hit', () => assert.ok(scanChunk('you have hit your usage limit', cfg.AGENTS.claude, null)?.matched));

section('claude project-dir helper (C1–C3)');
await test('claudeProjectDir escapes non-alnum → dash', () => {
  assert.strictEqual(cfg.claudeProjectDir('/a/b_c.d'), path.join(HOME, '.claude', 'projects', '-a-b-c-d'));
});
await test('claudeSessionFiles disambiguates by cwd metadata', () => {
  const repo = '/tmp/disambig-repo';
  const dir = cfg.claudeProjectDir(repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'good.jsonl'), JSON.stringify({ cwd: repo }) + '\n');
  fs.writeFileSync(path.join(dir, 'bad.jsonl'), JSON.stringify({ cwd: '/tmp/other' }) + '\n');
  fs.utimesSync(path.join(dir, 'bad.jsonl'), new Date(), new Date()); // newer but wrong cwd
  fs.utimesSync(path.join(dir, 'good.jsonl'), new Date(Date.now() - 1000), new Date(Date.now() - 1000));
  assert.deepStrictEqual(cfg.claudeSessionFiles(repo), ['good.jsonl']);
  fs.rmSync(dir, { recursive: true, force: true });
});

section('config copy-on-load + binary resolve (M1, B1)');
await test('loadAgents returns copies; builtins intact', () => {
  cfg.loadAgents().claude.ceiling = 999;
  assert.strictEqual(cfg.loadAgents().claude.ceiling, 250_000);
  assert.strictEqual(cfg.AGENTS.claude.ceiling, 250_000);
});
await test('resolveExecutable: absolute ok, missing → null, bare → absolute', () => {
  assert.ok(cfg.resolveExecutable('/usr/bin/env'));
  assert.strictEqual(cfg.resolveExecutable('/no/such/bin-xyz'), null);
  const n = cfg.resolveExecutable('node');
  assert.ok(n && path.isAbsolute(n));
});
await test('OPS-003 P1/P6: splitPathEnv uses path.delimiter', () => {
  const parts = cfg.splitPathEnv(['/a', '/b', '/c'].join(path.delimiter));
  assert.deepStrictEqual(parts, ['/a', '/b', '/c']);
  assert.deepStrictEqual(cfg.splitPathEnv(''), []);
});

section('safe state I/O (S1–S4)');
await test('AUDIT: loadState rejects non-agent owner (poisoned state)', () => {
  const r = path.join(ROOT, 'owner-repo');
  const s = state.blankState(r, null);
  s.owner = 'claude\x00rm -rf';
  state.saveState(r, s);
  assert.strictEqual(state.loadState(r)?.owner, null);
  const s2 = state.loadState(r);
  assert.strictEqual(s2?.owner, null);
  // a valid owner round-trips
  s.owner = 'cursor';
  state.saveState(r, s);
  assert.strictEqual(state.loadState(r)?.owner, 'cursor');
});
await test('symlinked state.yaml → refuse, target untouched', () => {
  const r = path.join(ROOT, 's1');
  fs.mkdirSync(path.join(r, '.kala'), { recursive: true });
  const target = path.join(ROOT, 'victim.yaml');
  fs.writeFileSync(target, 'ORIGINAL');
  fs.symlinkSync(target, path.join(r, '.kala', 'state.yaml'));
  assert.throws(() => state.saveState(r, state.blankState(r, null)), /symlink/);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), 'ORIGINAL');
});
await test('atomic write → 0600, no temp left', () => {
  const r = path.join(ROOT, 's2');
  state.saveState(r, state.blankState(r, 'main'));
  assert.strictEqual(fs.statSync(path.join(r, '.kala', 'state.yaml')).mode & 0o777, 0o600);
  assert.deepStrictEqual(fs.readdirSync(path.join(r, '.kala')).filter((f) => f.includes('.tmp')), []);
});

section('trust grants (T2/T3/T8 + W1 prune)');
await test('no grant → false; record → true; other path → false', () => {
  assert.strictEqual(trust.hasTrustGrant(repoDir), false);
  trust.recordTrustGrant(repoDir);
  assert.strictEqual(trust.hasTrustGrant(repoDir), true);
  assert.strictEqual(trust.hasTrustGrant(path.join(ROOT, 'else')), false);
});
await test('W1: record prunes an expired grant on write', () => {
  const f = path.join(KALA, 'trust.yaml');
  const other = path.join(ROOT, 'keepme'); fs.mkdirSync(other, { recursive: true });
  const dead = path.join(ROOT, 'expired'); fs.mkdirSync(dead, { recursive: true });
  trust.recordTrustGrant(other); // valid for `other`
  // inject an expired grant for `dead` directly into the store
  const real = fs.realpathSync(dead);
  fs.appendFileSync(f, `  - path: ${JSON.stringify(real)}\n    granted_at: "2020-01-01T00:00:00.000Z"\n    expires_at: "2020-01-02T00:00:00.000Z"\n`);
  trust.recordTrustGrant(repoDir); // write path should prune `dead`
  const raw = fs.readFileSync(f, 'utf8');
  assert.ok(!raw.includes(JSON.stringify(real)), 'expired grant was pruned');
  assert.ok(trust.hasTrustGrant(other), 'valid grant retained');
});
await test('trust status marks expired (does not prune on read)', () => {
  const f = path.join(KALA, 'trust.yaml');
  const dead = path.join(ROOT, 'expired2'); fs.mkdirSync(dead, { recursive: true });
  const real = fs.realpathSync(dead);
  fs.appendFileSync(f, `  - path: ${JSON.stringify(real)}\n    granted_at: "2020-01-01T00:00:00.000Z"\n    expires_at: "2020-01-02T00:00:00.000Z"\n`);
  const row = trust.trustStatus().find((g) => g.path === real);
  assert.ok(row && row.expires_at.includes('EXPIRED'));
});
await test('revoke --all clears', () => {
  trust.recordTrustGrant(repoDir);
  trust.revokeTrust(null, true);
  assert.strictEqual(trust.hasTrustGrant(repoDir), false);
});

section('session capture + resume (FEAT-002)');
await test('noteClaudeFolderTrust: stderr caveat for claude only', () => {
  const chunks: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { chunks.push(a.map(String).join(' ')); };
  try {
    launch.noteClaudeFolderTrust(cfg.AGENTS.agy);
    launch.noteClaudeFolderTrust(cfg.AGENTS.cursor);
    assert.strictEqual(chunks.length, 0, 'non-claude agents stay quiet');
    launch.noteClaudeFolderTrust(cfg.AGENTS.claude);
    assert.ok(chunks.length === 1 && /Claude's prompt, not Kalaga/i.test(chunks[0]));
  } finally { console.error = orig; }
});
await test('R2: normalizeSessionId strips claude .jsonl only', () => {
  assert.strictEqual(launch.normalizeSessionId(cfg.AGENTS.claude, 'abc-123.jsonl'), 'abc-123');
  assert.strictEqual(launch.normalizeSessionId(cfg.AGENTS.grok, 'sid-xyz'), 'sid-xyz');
});
await test('SEC: session id allowlist rejects flag-shaped / unsafe tokens', () => {
  assert.strictEqual(launch.isValidSessionId('--print'), false);
  assert.strictEqual(launch.isValidSessionId('-r'), false);
  assert.strictEqual(launch.isValidSessionId(''), false);
  assert.strictEqual(launch.isValidSessionId('a b'), false);
  assert.strictEqual(launch.isValidSessionId('ok-uuid.1_2'), true);
  assert.strictEqual(launch.normalizeSessionId(cfg.AGENTS.claude, '--evil.jsonl'), null);
  assert.throws(() => launch.resumeArgv(cfg.AGENTS.claude, '--print'), /invalid session id/);
});
await test('SEC: poisoned sessions.id dropped on load; capture skips bad ids', () => {
  const r = path.join(ROOT, 'poison-sess');
  fs.mkdirSync(path.join(r, '.kala'), { recursive: true });
  fs.writeFileSync(path.join(r, '.kala', 'state.yaml'), [
    'goal: "x"',
    'status: IN_PROGRESS',
    'owner: claude',
    'branch: null',
    'updated: "2026-01-01T00:00:00.000Z"',
    'modified_files: []',
    'negative_constraints: []',
    'next_step: "n"',
    'notes: ""',
    'done: []',
    'sessions:',
    '  claude:',
    '    id: --print',
    '    at: "2026-01-01T00:00:00.000Z"',
  ].join('\n'));
  const loaded = state.loadState(r);
  assert.ok(!loaded?.sessions?.claude);
  const before = state.blankState(r, null);
  state.saveState(r, before);
  const after = state.captureSession(r, 'claude', '--print');
  assert.ok(!after.sessions.claude);
});
await test('R6/R7: resumeArgv matches verified vendor prefixes', () => {
  assert.deepStrictEqual(launch.resumeArgv(cfg.AGENTS.claude, 'ID'), ['-r', 'ID']);
  assert.deepStrictEqual(launch.resumeArgv(cfg.AGENTS.cursor, 'ID'), ['--resume', 'ID']);
  assert.deepStrictEqual(launch.resumeArgv(cfg.AGENTS.grok, 'ID'), ['-r', 'ID']);
  assert.deepStrictEqual(launch.resumeArgv(cfg.AGENTS.agy, 'ID'), ['--conversation', 'ID']);
});
await test('R10: sessionFresh rejects at > 7 days', async () => {
  const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
  const recent = new Date(Date.now() - 3_600_000).toISOString();
  const repo = path.join(ROOT, 'fresh-repo');
  fs.mkdirSync(repo, { recursive: true });
  const dir = cfg.claudeProjectDir(repo);
  fs.mkdirSync(dir, { recursive: true });
  assert.strictEqual(await launch.sessionFresh(cfg.AGENTS.claude, repo, { id: 'x1', at: old }), false);
  fs.writeFileSync(path.join(dir, 'x2.jsonl'), '{}');
  assert.strictEqual(await launch.sessionFresh(cfg.AGENTS.claude, repo, { id: 'x2', at: recent }), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
await test('agy: resolveAgySession requires last_conversations map + conversations/<id>.db', async () => {
  const repo = path.join(ROOT, 'agy-repo');
  fs.mkdirSync(repo, { recursive: true });
  const sid = 'agy-sess-ok-1';
  const root = ledger.agyCliRoot(HOME);
  const cache = path.join(root, 'cache');
  const conv = path.join(root, 'conversations');
  fs.mkdirSync(cache, { recursive: true });
  fs.mkdirSync(conv, { recursive: true });
  assert.strictEqual(ledger.resolveAgySession(repo, HOME), null);
  fs.writeFileSync(path.join(cache, 'last_conversations.json'), JSON.stringify({ [repo]: sid }));
  assert.strictEqual(ledger.resolveAgySession(repo, HOME), null, 'map alone is not enough');
  fs.writeFileSync(path.join(conv, `${sid}.db`), 'sqlite-stub');
  const hit = ledger.resolveAgySession(repo, HOME);
  assert.ok(hit && hit.sid === sid);
  fs.writeFileSync(path.join(cache, 'conversation_metadata.json'), JSON.stringify({
    conversations: { [sid]: { last_modified_time: '2026-11-20T12:00:00.000Z', summary: { Title: 'Build', Preview: 'rate limit hit' } } },
  }));
  const withMeta = ledger.resolveAgySession(repo, HOME);
  assert.strictEqual(withMeta?.lastUsed, Date.parse('2026-11-20T12:00:00.000Z'));
  assert.strictEqual(await ledger.sessionHintFor(cfg.AGENTS.agy, repo), sid);
  const text = await launch.lastSessionText(cfg.AGENTS.agy, repo);
  assert.ok(text.includes('Build') && text.includes('rate limit hit'));
  fs.writeFileSync(path.join(cache, 'last_conversations.json'), JSON.stringify({ [repo]: '--evil' }));
  assert.strictEqual(ledger.resolveAgySession(repo, HOME), null);
});
await test('agy: sessionFresh requires conversations/<id>.db within TTL', async () => {
  const recent = new Date(Date.now() - 3_600_000).toISOString();
  const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
  const sid = 'agy-fresh-1';
  const db = path.join(HOME, '.gemini', 'antigravity-cli', 'conversations', `${sid}.db`);
  fs.mkdirSync(path.dirname(db), { recursive: true });
  fs.writeFileSync(db, 'x');
  assert.strictEqual(await launch.sessionFresh(cfg.AGENTS.agy, ROOT, { id: sid, at: recent }), true);
  assert.strictEqual(await launch.sessionFresh(cfg.AGENTS.agy, ROOT, { id: sid, at: old }), false);
  fs.unlinkSync(db);
  assert.strictEqual(await launch.sessionFresh(cfg.AGENTS.agy, ROOT, { id: sid, at: recent }), false);
});
await test('picker: no Claude folder-trust noise (launch owns that caveat)', async () => {
  const chunks: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, enc?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void) => {
    chunks.push(String(chunk));
    if (typeof enc === 'function') enc(null);
    else if (typeof cb === 'function') cb(null);
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = await picker.pick(
      [
        { agent: 'cursor', reason: 'unused this window', score: 2 },
        { agent: 'claude', reason: 'unused this window', score: 1 },
      ],
      [
        { agent: 'cursor', installed: true, tokens: 0, exact: false, ceiling: 100, remaining: 100, lastUsed: null, sessionHint: null },
        { agent: 'claude', installed: true, tokens: 0, exact: true, ceiling: 100, remaining: 100, lastUsed: null, sessionHint: null },
      ],
      null,
      { answer: 'q' },
    );
    assert.ok(result.stay);
    const out = chunks.join('');
    assert.doesNotMatch(out, /Claude folder trust/);
    assert.doesNotMatch(out, /trust this folder\?/);
    assert.match(out, /one key:/);
    assert.match(out, /\[1] cursor/);
    assert.match(out, /\[2] claude/);
  } finally {
    process.stderr.write = origWrite;
  }
});
await test('picker: number choice acks immediately (preparing)', async () => {
  const chunks: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, enc?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void) => {
    chunks.push(String(chunk));
    if (typeof enc === 'function') enc(null);
    else if (typeof cb === 'function') cb(null);
    return true;
  }) as typeof process.stderr.write;
  try {
    // opts.answer avoids flaky stdin.push on a real TTY.
    const result = await picker.pick(
      [
        { agent: 'cursor', reason: 'unused', score: 2 },
        { agent: 'claude', reason: 'unused', score: 1 },
      ],
      [
        { agent: 'cursor', installed: true, tokens: 0, exact: false, ceiling: 100, remaining: 100, lastUsed: null, sessionHint: null },
        { agent: 'claude', installed: true, tokens: 0, exact: true, ceiling: 100, remaining: 100, lastUsed: null, sessionHint: null },
      ],
      null,
      { answer: '2' },
    );
    assert.strictEqual(result.agent, 'claude');
    assert.ok(!result.stay);
    assert.match(chunks.join(''), /→ claude — preparing/);
  } finally {
    process.stderr.write = origWrite;
  }
});
await test('R1: sessions round-trip through save/load', () => {
  const r = path.join(ROOT, 'sess-repo');
  const s = state.blankState(r, null);
  s.sessions = { claude: { id: 'uuid-1', at: new Date().toISOString() } };
  state.saveState(r, s);
  const back = state.loadState(r);
  assert.strictEqual(back?.sessions.claude?.id, 'uuid-1');
});
await test('R14: session id never in default inject', () => {
  const s = state.blankState('/tmp/x', null);
  s.sessions = { claude: { id: 'SECRETID', at: new Date().toISOString() } };
  s.owner = 'claude';
  assert.ok(!handoffInject(s, false).includes('SECRETID'));
  assert.ok(!handoffInject(s, true).includes('SECRETID'));
});

section('FEAT-003: thin state / live-ask / done');
await test('H5: isThinState(blank) → true', () => {
  assert.strictEqual(state.isThinState(state.blankState('/tmp/x', null)), true);
});
await test('H5: isThinState(rich) → false', () => {
  const s = state.blankState('/tmp/x', null);
  s.goal = 'ship the kalaga CLI handoff';
  s.done = ['landed protocol inject'];
  s.next_step = 'run the test suite';
  assert.strictEqual(state.isThinState(s), false);
});
await test('H11: live-ask parser accepts a fixture YAML fragment', () => {
  const raw = [
    '```yaml',
    'goal: ship the kalaga CLI handoff',
    'done:',
    '  - landed protocol inject',
    '  - landed live-ask',
    'next_step: run the test suite',
    'notes: all green locally',
    'negative_constraints:',
    '  - do not pipe the TTY',
    '```',
  ].join('\n');
  const p = liveask.parseLiveAskYaml(raw);
  assert.strictEqual(p.goal, 'ship the kalaga CLI handoff');
  assert.deepStrictEqual(p.done, ['landed protocol inject', 'landed live-ask']);
  assert.strictEqual(p.next_step, 'run the test suite');
  assert.strictEqual(p.notes, 'all green locally');
  assert.deepStrictEqual(p.negative_constraints, ['do not pipe the TTY']);
});
await test('H11: live-ask parser ignores unknown keys + garbage', () => {
  const p = liveask.parseLiveAskYaml('apology: sorry\ngoal: just this\nsome random line\n');
  assert.strictEqual(p.goal, 'just this');
  assert.ok(!('notes' in p) && !('done' in p));
});
await test('H1/H9: done append + cap (12, drop oldest) round-trips', () => {
  const r = path.join(ROOT, 'done-repo');
  state.saveState(r, state.blankState(r, null));
  for (let i = 1; i <= 15; i++) {
    const s = state.loadState(r)!;
    state.saveState(r, { ...s, done: [...s.done, `bullet ${i}`].slice(-12), updated: new Date().toISOString() });
  }
  const back = state.loadState(r)!;
  assert.strictEqual(back.done.length, 12);
  assert.strictEqual(back.done[0], 'bullet 4');
  assert.strictEqual(back.done[11], 'bullet 15');
});
await test('H8: liveAskArgv uses headless flags, no TTY', () => {
  const argv = liveask.liveAskArgv(cfg.AGENTS.claude, 'PROMPT');
  assert.deepStrictEqual(argv.slice(0, -1), cfg.AGENTS.claude.headless);
  assert.strictEqual(argv[argv.length - 1], 'PROMPT');
});

section('picker interpretPickAnswer (EOF / off-TTY safety)');
const base = { hasDead: true, recCount: 3, stayDefault: false, stdinIsTTY: true };
await test('TTY Enter → recommendation index 0', () => {
  assert.strictEqual(picker.interpretPickAnswer('', base), 0);
});
await test('off-TTY empty → stay', () => {
  assert.strictEqual(picker.interpretPickAnswer('', { ...base, stdinIsTTY: false }), 'stay');
});
await test('stayDefault Enter → stay', () => {
  assert.strictEqual(picker.interpretPickAnswer('', { ...base, stayDefault: true }), 'stay');
});
await test('q / e → stay', () => {
  assert.strictEqual(picker.interpretPickAnswer('q', base), 'stay');
  assert.strictEqual(picker.interpretPickAnswer('e', base), 'stay');
});
await test('0 with dead → wait', () => {
  assert.strictEqual(picker.interpretPickAnswer('0', base), 'wait');
});
await test('off-TTY garbage → stay (not auto-pick)', () => {
  assert.strictEqual(picker.interpretPickAnswer('xyz', { ...base, stdinIsTTY: false }), 'stay');
});
await test('TTY number → index', () => {
  assert.strictEqual(picker.interpretPickAnswer('2', base), 1);
});
await test('n / no / exit / out-of-range stay (no auto-launch)', () => {
  for (const raw of ['n', 'no', 'exit', '9', 'xyz']) {
    assert.strictEqual(picker.interpretPickAnswer(raw, base), 'stay', raw);
  }
});

section('YAML round-trip (quotes, blocks, lists)');
await test('parseYamlScalar decodes JSON strings and single quotes', () => {
  assert.strictEqual(yaml.parseYamlScalar('"say \\"hi\\"\\nnext"'), 'say "hi"\nnext');
  assert.strictEqual(yaml.parseYamlScalar("'it''s fine'"), "it's fine");
  assert.strictEqual(yaml.parseYamlScalar('"bad \\q escape"'), 'bad \\q escape');
  assert.deepStrictEqual(yaml.parseYamlInlineList('[]'), []);
  assert.deepStrictEqual(yaml.parseYamlInlineList('["a", "b"]'), ['a', 'b']);
});
await test('10-cycle save/load keeps quotes, backslashes, newlines, lists', () => {
  const r = path.join(ROOT, 'yaml-cycle');
  const s = state.blankState(r, 'main');
  s.goal = 'say "hi": keep it';
  s.notes = 'path C:\\temp and "quotes"\nline2';
  s.next_step = 'do: this';
  s.done = ['a "b"', 'c:\\d'];
  s.negative_constraints = ["don't double"];
  state.saveState(r, s);
  for (let i = 0; i < 10; i++) state.saveState(r, state.loadState(r)!);
  const back = state.loadState(r)!;
  assert.strictEqual(back.goal, s.goal);
  assert.strictEqual(back.notes, s.notes);
  assert.strictEqual(back.next_step, s.next_step);
  assert.deepStrictEqual(back.done, s.done);
  assert.deepStrictEqual(back.negative_constraints, s.negative_constraints);
  const raw = fs.readFileSync(path.join(r, '.kala', 'state.yaml'), 'utf8');
  assert.ok(!raw.includes('\\\\\\\\'), 'backslashes did not grow');
});
await test('block scalars, flow lists, empty goal, DONE status', () => {
  const r = path.join(ROOT, 'yaml-block');
  fs.mkdirSync(path.join(r, '.kala'), { recursive: true });
  fs.writeFileSync(path.join(r, '.kala', 'state.yaml'), [
    'goal: ""',
    'status: DONE',
    'owner: claude',
    'branch: null',
    'updated: "2026-01-01T00:00:00.000Z"',
    'modified_files: []',
    'negative_constraints: []',
    'done: ["a", "b"]',
    "next_step: 'it''s fine'",
    'notes: |',
    '  hello "world"',
    '  second',
    'sessions: {}',
  ].join('\n'));
  const loaded = state.loadState(r);
  assert.ok(loaded, 'empty goal with schema keys is kept');
  assert.strictEqual(loaded!.goal, '');
  assert.strictEqual(loaded!.status, 'COMPLETED');
  assert.deepStrictEqual(loaded!.done, ['a', 'b']);
  assert.strictEqual(loaded!.next_step, "it's fine");
  assert.ok(loaded!.notes.includes('hello "world"'));
  assert.ok(loaded!.notes.includes('second'));
  fs.writeFileSync(path.join(r, '.kala', 'state.yaml'), 'status: WEIRD\ngoal: "kept"\n');
  assert.strictEqual(state.loadState(r)?.status, 'IN_PROGRESS');
});
await test('live-ask: done [] is empty; resume+trust argv; timeout 15s; bad exit dropped', async () => {
  const empty = liveask.parseLiveAskYaml('done: []\ngoal: keep\n');
  assert.ok(!empty.done || empty.done.length === 0);
  assert.strictEqual(empty.goal, 'keep');
  const flow = liveask.parseLiveAskYaml('done: ["a", "b"]\n');
  assert.deepStrictEqual(flow.done, ['a', 'b']);
  const block = liveask.parseLiveAskYaml('notes: |\n  line one\n  line two\n');
  assert.ok(block.notes?.includes('line one') && block.notes.includes('line two'));
  assert.strictEqual(liveask.LIVE_ASK_TIMEOUT_MS, 15_000);
  const argv = liveask.liveAskArgv(cfg.AGENTS.cursor, 'PROMPT', 'sid-1', true);
  assert.deepStrictEqual(argv.slice(0, 3), ['--resume', 'sid-1', '--trust']);
  assert.strictEqual(argv[argv.length - 1], 'PROMPT');
  const fail = path.join(ROOT, 'fail.sh');
  fs.writeFileSync(fail, '#!/bin/sh\necho BOOM\nexit 1\n');
  fs.chmodSync(fail, 0o755);
  const agent = { ...cfg.AGENTS.claude, interactive: [fail], headless: ['-p'], trustFlags: [], resumeByIdPrefix: ['-r'] };
  assert.strictEqual(await liveask.runLiveAsk(agent, repoDir, 'x', 5000), '');
});

section('git porcelain, handoff attribution, traps');
await test('porcelain keeps a leading-space unstaged path; rename takes destination', () => {
  assert.deepStrictEqual(gitmod.parsePorcelainZ(' M file.txt\0'), ['file.txt']);
  assert.deepStrictEqual(gitmod.parsePorcelainZ('?? new file.txt\0'), ['new file.txt']);
  assert.deepStrictEqual(gitmod.parsePorcelainZ('R  renamed.txt\0old.txt\0'), ['renamed.txt']);
  const r = path.join(ROOT, 'git-repo');
  fs.mkdirSync(r);
  const git = (args: string[]): void => { execFileSync('git', args, { cwd: r, stdio: 'ignore' }); };
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'user.name', 'T']);
  assert.strictEqual(gitmod.currentBranch(r), 'main');
  fs.writeFileSync(path.join(r, 'file.txt'), 'a\n');
  git(['add', 'file.txt']);
  git(['commit', '-m', 'init']);
  fs.writeFileSync(path.join(r, 'file.txt'), 'b\n');
  assert.ok(gitmod.modifiedFiles(r).includes('file.txt'), JSON.stringify(gitmod.modifiedFiles(r)));
  git(['add', 'file.txt']);
  git(['commit', '-m', 'edit']);
  git(['checkout', '--detach', 'HEAD']);
  const detached = gitmod.currentBranch(r);
  assert.ok(detached?.startsWith('detached@'), detached ?? '');
});
await test('handoffInject fromOwner names the previous agent, not the taker', () => {
  const s = state.blankState('/tmp/x', null);
  s.owner = 'cursor';
  s.goal = 'ship the handoff';
  s.next_step = 'continue';
  const fromAgy = handoffInject(s, false, 'agy');
  assert.ok(fromAgy.includes('Kalaga handoff from agy'));
  assert.ok(!fromAgy.includes('from cursor'));
  const same = handoffInject(s, false, 'cursor');
  assert.ok(same.startsWith('Kalaga session context.'));
  assert.ok(!same.includes('from cursor'));
  assert.ok(handoffInject(s, false, null).startsWith('Kalaga session context.'));
  assert.ok(handoffInject(s, false).includes('Kalaga handoff from cursor'));
});
await test('sanitize strips ANSI, C1, and bidi', () => {
  const out = sanitizeHandoffField('a\u202eb\u009bc\x1b[31mD\x1b]0;title\x07e', 100);
  assert.strictEqual(out, 'abcDe');
});
await test('clean exit ignores a long prose false positive; explicit phrase still hits', () => {
  const prose = `${'word '.repeat(80)} the quota for this design ${'word '.repeat(80)}`;
  assert.ok(prose.length > 600);
  assert.strictEqual(scanChunk(prose, cfg.AGENTS.claude, 0), null);
  const buried = `${'a'.repeat(400)} usage limit ${'b'.repeat(400)}`;
  const hit = scanChunk(buried, cfg.AGENTS.claude, 0);
  assert.ok(hit);
  assert.ok(hit!.line.length <= 200);
  assert.ok(hit!.line.includes('usage limit'));
});
await test('claude tail skips user/tool payloads', async () => {
  const repo = path.join(ROOT, 'claude-tail');
  fs.mkdirSync(repo);
  const dir = cfg.claudeProjectDir(repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's.jsonl'), [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'please ignore the usage limit in this prompt' } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'file read quota exceeded' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'all good, no limit here' }] } }),
  ].join('\n') + '\n');
  const text = await launch.lastSessionText(cfg.AGENTS.claude, repo);
  assert.ok(text.includes('all good'));
  assert.ok(!text.includes('usage limit'));
  assert.ok(!text.includes('quota exceeded'));
});
await test('grok token total is not summed on top of input and output', () => {
  const text = 'input tokens: 100\noutput tokens: 40\ntotal tokens: 140\n';
  assert.strictEqual(ledger.parseGrokTokenTotal(text), 140);
  assert.strictEqual(ledger.parseGrokTokenTotal('input tokens: 10\noutput tokens: 5\n'), 15);
});
await test('grok JSON usage deducts cachedReadTokens, honors 5h window, and normalizes epoch seconds', () => {
  const now = Date.parse('2026-11-24T20:00:00Z');
  const json = JSON.stringify({
    sessionId: '00000000-0000-4000-8000-000000000002',
    updatedAt: '2026-11-24T19:54:52.607107235+00:00',
    session: { inputTokens: 517508, outputTokens: 27025, cachedReadTokens: 424448, totalTokens: 544533 },
    turns: [
      { turnNumber: 1, endedAt: '2026-11-24T10:00:00Z', inputTokens: 50000, outputTokens: 2000, cachedReadTokens: 40000, totalTokens: 52000 },
      { turnNumber: 2, endedAt: '2026-11-24T19:54:52Z', inputTokens: 517508, outputTokens: 27025, cachedReadTokens: 424448, totalTokens: 544533 },
    ],
  });
  assert.strictEqual(ledger.parseGrokTokenTotal(json, now), 120085);
  assert.strictEqual(ledger.normalizeEpochMs(1_795_549_692), 1_795_549_692_000);
  assert.strictEqual(ledger.normalizeEpochMs(1_795_549_692_000), 1_795_549_692_000);
  const grokArgv = liveask.liveAskArgv(cfg.AGENTS.grok, 'SUMMARIZE', 'sid-1');
  assert.strictEqual(grokArgv.at(-2), '-p');
  assert.strictEqual(grokArgv.at(-1), 'SUMMARIZE');
  assert.ok(grokArgv.includes('--reasoning-effort'));
});
await test('Windows .cmd shim unwraps to node + script', () => {
  const dir = path.join(ROOT, 'shim');
  fs.mkdirSync(dir);
  const cmd = path.join(dir, 'kala.cmd');
  fs.writeFileSync(cmd, '@echo off\r\n"%~dp0%\\dist\\index.js" %*\r\n');
  const hit = cfg.resolveSpawnTarget(cmd, ['status'], 'win32');
  assert.strictEqual(hit.file, process.execPath);
  assert.ok(hit.args[0].replace(/\\/g, '/').endsWith('dist/index.js'), hit.args[0]);
  assert.deepStrictEqual(hit.args.slice(1), ['status']);
  const plain = cfg.resolveSpawnTarget('/usr/bin/claude', ['-p'], 'linux');
  assert.deepStrictEqual(plain, { file: '/usr/bin/claude', args: ['-p'] });
});
await test('noteClaudeFolderTrust: new folder says Down then Enter', () => {
  const chunks: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { chunks.push(a.map(String).join(' ')); };
  try {
    const missing = path.join(ROOT, 'no-claude');
    fs.mkdirSync(missing);
    launch.noteClaudeFolderTrust(cfg.AGENTS.claude, missing);
    assert.match(chunks[0], /No, exit/);
    assert.match(chunks[0], /Down/);
    fs.mkdirSync(cfg.claudeProjectDir(missing), { recursive: true });
    launch.noteClaudeFolderTrust(cfg.AGENTS.claude, missing);
    assert.match(chunks[1], /Choose Yes/);
  } finally { console.error = orig; }
});

section('KALA_HOME, symlinks, packaged CLI');
await test('KALA_HOME blank falls back to ~/.kala', () => {
  const prev = process.env.KALA_HOME;
  try {
    process.env.KALA_HOME = '';
    assert.strictEqual(cfg.kalagaHome(), path.join(os.homedir(), '.kala'));
    process.env.KALA_HOME = '   ';
    assert.strictEqual(cfg.kalagaHome(), path.join(os.homedir(), '.kala'));
    assert.ok(!cfg.configPath().startsWith('/config.yaml'));
  } finally {
    if (prev === undefined) delete process.env.KALA_HOME;
    else process.env.KALA_HOME = prev;
  }
});
await test('symlink state.yaml and trust.yaml are refused', () => {
  const r = path.join(ROOT, 'sym-load');
  fs.mkdirSync(path.join(r, '.kala'), { recursive: true });
  const victim = path.join(ROOT, 'secret-state.yaml');
  fs.writeFileSync(victim, 'goal: "pwned"\n');
  fs.symlinkSync(victim, path.join(r, '.kala', 'state.yaml'));
  assert.throws(() => state.loadState(r), /symlink/);
  assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'goal: "pwned"\n');

  const trustPath = path.join(KALA, 'trust.yaml');
  const backup = fs.existsSync(trustPath) ? fs.readFileSync(trustPath) : null;
  const trustVictim = path.join(ROOT, 'trust-victim.yaml');
  fs.writeFileSync(trustVictim, 'ORIGINAL');
  if (fs.existsSync(trustPath)) fs.unlinkSync(trustPath);
  fs.symlinkSync(trustVictim, trustPath);
  try {
    assert.throws(() => trust.recordTrustGrant(repoDir), /symlink/);
    assert.strictEqual(fs.readFileSync(trustVictim, 'utf8'), 'ORIGINAL');
  } finally {
    fs.unlinkSync(trustPath);
    if (backup) fs.writeFileSync(trustPath, backup, { mode: 0o600 });
  }
});

function runKala(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME, KALA_HOME: KALA },
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

await test('build dist and npm pack runs as plain JS', () => {
  execFileSync(process.execPath, ['scripts/build-dist.mjs'], { cwd: REPO, stdio: 'ignore' });
  const built = fs.readFileSync(path.join(REPO, 'dist', 'index.js'), 'utf8');
  assert.ok(!built.includes("from './config.ts'"));
  assert.ok(built.includes("from './config.js'") || built.includes('from "./config.js"'));
  const packDir = path.join(ROOT, 'pack');
  fs.mkdirSync(packDir);
  const listed = execFileSync('npm', ['pack', '--pack-destination', packDir], {
    cwd: REPO, encoding: 'utf8',
    env: { ...process.env, npm_config_cache: path.join(ROOT, 'npm-cache') },
  }).trim().split('\n').pop()!;
  const extract = path.join(ROOT, 'nm');
  fs.mkdirSync(path.join(extract, 'node_modules'), { recursive: true });
  execFileSync('tar', ['-xzf', path.join(packDir, listed), '-C', path.join(extract, 'node_modules')]);
  fs.renameSync(path.join(extract, 'node_modules', 'package'), path.join(extract, 'node_modules', 'kalaga'));
  const installed = path.join(extract, 'node_modules', 'kalaga');
  assert.ok(fs.existsSync(path.join(installed, 'dist', 'index.js')));
  assert.ok(!fs.existsSync(path.join(installed, 'src', 'index.ts')));
  const empty = path.join(ROOT, 'empty-ver');
  fs.mkdirSync(empty, { recursive: true });
  const ver = spawnSync(process.execPath, [path.join(installed, 'bin', 'kala'), '--version'], {
    cwd: empty, encoding: 'utf8',
    env: { ...process.env, HOME, KALA_HOME: KALA },
  });
  assert.strictEqual(ver.status, 0, ver.stderr);
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { version: string };
  assert.ok(ver.stdout.includes(pkg.version), ver.stdout);
  assert.ok(!fs.existsSync(path.join(empty, '.kala', 'state.yaml')));
  const st = spawnSync(process.execPath, [path.join(installed, 'bin', 'kala'), 'status'], {
    cwd: empty, encoding: 'utf8',
    env: { ...process.env, HOME, KALA_HOME: KALA },
  });
  assert.strictEqual(st.status, 0, st.stderr);
  assert.match(st.stdout, /kalaga/);
});
await test('--version and unknown flags do not launch or write state', () => {
  const cwd = path.join(ROOT, 'flag-repo');
  fs.mkdirSync(cwd);
  const ver = runKala(['--version'], cwd);
  assert.strictEqual(ver.status, 0, ver.stderr);
  assert.match(ver.stdout, /\d+\.\d+\.\d+/);
  assert.ok(!fs.existsSync(path.join(cwd, '.kala', 'state.yaml')));
  const bad = runKala(['--foo'], cwd);
  assert.strictEqual(bad.status, 2);
  assert.ok(!fs.existsSync(path.join(cwd, '.kala', 'state.yaml')));
  const dash = runKala(['-x'], cwd);
  assert.strictEqual(dash.status, 2);
});
await test('help: agy session ids from antigravity-cli (not "not captured")', () => {
  const cwd = path.join(ROOT, 'help-repo');
  fs.mkdirSync(cwd);
  const out = runKala(['help'], cwd);
  assert.strictEqual(out.status, 0, out.stderr);
  assert.match(out.stdout, /antigravity-cli/);
  assert.doesNotMatch(out.stdout, /agy session ids are not/i);
  assert.match(out.stdout, /agy tokens stay unset/i);
});
await test('empty kala state goal prints and does not wipe', () => {
  const cwd = path.join(ROOT, 'goal-keep');
  fs.mkdirSync(cwd);
  const s = state.blankState(cwd, null);
  s.goal = 'keep me please';
  s.next_step = 'stay';
  state.saveState(cwd, s);
  const before = fs.readFileSync(path.join(cwd, '.kala', 'state.yaml'), 'utf8');
  const out = runKala(['state', 'goal'], cwd);
  assert.strictEqual(out.status, 0, out.stderr);
  assert.ok(out.stdout.includes('keep me please'));
  assert.strictEqual(fs.readFileSync(path.join(cwd, '.kala', 'state.yaml'), 'utf8'), before);
});
await test('kala status strips ANSI, C1, and bidi from state fields', () => {
  const cwd = path.join(ROOT, 'ansi-repo');
  fs.mkdirSync(cwd);
  const s = state.blankState(cwd, null);
  s.goal = 'goal\u202eEVIL';
  s.next_step = 'next\u009b';
  s.done = ['did\x1b[31mRED\x1b]0;title\x07'];
  state.saveState(cwd, s);
  const out = runKala(['status'], cwd);
  assert.strictEqual(out.status, 0, out.stderr);
  assert.ok(!out.stdout.includes('\x1b'), 'no ESC in status');
  assert.ok(!out.stdout.includes('\u202e'));
  assert.ok(!out.stdout.includes('\u009b'));
  assert.match(out.stdout, /\[logged\]|\[est\.\]/);
});
await test('init refuses to clobber unless --force; switch --strict-state works before the agent', () => {
  const cwd = path.join(ROOT, 'init-force');
  fs.mkdirSync(cwd);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd });
  const first = runKala(['init'], cwd);
  assert.strictEqual(first.status, 0, first.stderr);
  const s = state.loadState(cwd)!;
  s.goal = 'do not clobber';
  state.saveState(cwd, s);
  const second = runKala(['init'], cwd);
  assert.strictEqual(second.status, 0, second.stderr);
  assert.match(second.stderr, /pass --force to reset/);
  assert.strictEqual(state.loadState(cwd)?.goal, 'do not clobber');
  const forced = runKala(['--force', 'init'], cwd);
  assert.strictEqual(forced.status, 0, forced.stderr);
  assert.ok(state.loadState(cwd)?.goal.startsWith('not captured'));
  const strict = runKala(['switch', '--strict-state', 'cursor'], cwd);
  assert.strictEqual(strict.status, 0, strict.stderr);
  assert.match(strict.stderr, /refusing to switch/);
  assert.notStrictEqual(state.loadState(cwd)?.owner, 'cursor');
});

section('FEAT-004: continuous checkpointing hooks (K1–K16)');
const hook = await import(`${SRC}/hook.ts`);
const hooks = await import(`${SRC}/hooks.ts`);

function runKalaInput(
  args: string[],
  cwd: string,
  stdinText: string,
  entry: string = BIN,
): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [entry, ...args], {
    cwd,
    input: stdinText,
    encoding: 'utf8',
    env: { ...process.env, HOME, KALA_HOME: KALA },
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

await test('K1: hook.ts has minimal imports; _hook hidden from --help; hooks shown', () => {
  const hookSrc = fs.readFileSync(path.join(SRC, 'hook.ts'), 'utf8');
  for (const forbidden of ['ledger', 'picker', 'launch', 'liveask', 'trust', 'prompt']) {
    assert.ok(!new RegExp(`from\\s+['"][^'"]*${forbidden}`).test(hookSrc), `hook.ts must not import ${forbidden}`);
  }
  const helpOut = runKala(['--help'], repoDir);
  assert.strictEqual(helpOut.status, 0);
  assert.ok(!helpOut.stdout.includes('_hook'), '_hook hidden from --help');
  assert.ok(helpOut.stdout.includes('hooks install'), 'hooks install shown in --help');
});

await test('K1: bin/kala _hook fast-path avoids importing ledger/picker/launch/liveask', () => {
  const hookRepo = path.join(ROOT, 'k1-fastpath');
  fs.mkdirSync(hookRepo, { recursive: true });
  state.saveState(hookRepo, state.blankState(hookRepo, 'main'));
  const probe = [
    "import { registerHooks } from 'node:module';",
    'const loaded = [];',
    'registerHooks({ load(url, ctx, next) { loaded.push(url); return next(url, ctx); } });',
    `process.argv = [process.execPath, ${JSON.stringify(BIN)}, '_hook', '--agent', 'agy', '--event', 'PostToolUse'];`,
    `await import(${JSON.stringify(new URL(`file://${BIN}`).href)});`,
    "console.error('LOADED:' + JSON.stringify(loaded));",
  ].join('\n');
  const probed = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: hookRepo,
    input: JSON.stringify({ cwd: hookRepo }),
    encoding: 'utf8',
    env: { ...process.env, HOME, KALA_HOME: KALA },
  });
  assert.strictEqual(probed.status, 0, probed.stderr);
  assert.deepStrictEqual(JSON.parse(probed.stdout.trim()), {});
  const loadedLine = (probed.stderr ?? '').split('\n').find((l) => l.startsWith('LOADED:'));
  assert.ok(loadedLine, `missing LOADED line in: ${probed.stderr}`);
  const loadedUrls = JSON.parse(loadedLine.slice('LOADED:'.length)) as string[];
  for (const heavy of ['ledger', 'picker', 'launch', 'liveask']) {
    assert.ok(!loadedUrls.some((u) => u.includes(heavy)), `fast-path must not load ${heavy}`);
  }

  // Also verify direct `node src/index.ts _hook ...` works cleanly
  const viaIndex = runKalaInput(['_hook', '--agent', 'claude', '--event', 'PostToolUse'], hookRepo, JSON.stringify({ cwd: hookRepo }), path.join(SRC, 'index.ts'));
  assert.strictEqual(viaIndex.status, 0);
  assert.deepStrictEqual(JSON.parse(viaIndex.stdout.trim()), {});
});

await test('K2: findRepoRoot resolves cwd -> workspacePaths[0] -> fallback and stops at .git', () => {
  const outer = path.join(ROOT, 'k2-outer');
  const inner = path.join(outer, 'subproj');
  const nested = path.join(inner, 'src', 'deep');
  fs.mkdirSync(nested, { recursive: true });
  // Outer has .kala/state.yaml, inner has .git WITHOUT .kala/state.yaml
  state.saveState(outer, state.blankState(outer, 'main'));
  fs.mkdirSync(path.join(inner, '.git'));
  assert.strictEqual(hook.findRepoRoot({ cwd: nested }), null, 'must stop at .git root');
  assert.strictEqual(hook.findRepoRoot({ workspacePaths: [nested] }), null);

  // When inner has .kala/state.yaml alongside .git, it resolves inner
  state.saveState(inner, state.blankState(inner, 'main'));
  assert.strictEqual(hook.findRepoRoot({ cwd: nested }), inner);
  assert.strictEqual(hook.findRepoRoot({ cwd: '', workspacePaths: [nested] }), inner);
  assert.strictEqual(hook.findRepoRoot({}, nested), inner);

  // Missing state.yaml -> exits 0 with {}
  const noState = path.join(ROOT, 'k2-nostate');
  fs.mkdirSync(noState, { recursive: true });
  const res = runKalaInput(['_hook', '--agent', 'claude', '--event', 'PostToolUse'], noState, JSON.stringify({ cwd: noState }));
  assert.strictEqual(res.status, 0);
  assert.deepStrictEqual(JSON.parse(res.stdout.trim()), {});
});

await test('K9: isSelfEdit skips .kala/state.yaml and kala state commands across vendors', () => {
  assert.strictEqual(hook.isSelfEdit('claude', 'PostToolUse', { tool_input: { file_path: '/repo/.kala/state.yaml' } }), true);
  assert.strictEqual(hook.isSelfEdit('claude', 'PostToolUse', { tool_input: { file_path: '.kala/state.yaml' } }), true);
  assert.strictEqual(hook.isSelfEdit('claude', 'PostToolUse', { tool_input: { command: 'kala state done "shipped"' } }), true);
  assert.strictEqual(hook.isSelfEdit('agy', 'PostToolUse', { toolCall: { args: { TargetFile: '/repo/.kala/state.yaml' } } }), true);
  assert.strictEqual(hook.isSelfEdit('agy', 'PostToolUse', { toolCall: { args: { Path: '.kala/state.yaml' } } }), true);
  assert.strictEqual(hook.isSelfEdit('agy', 'PostToolUse', { toolCall: { args: { CommandLine: 'kala state next "test"' } } }), true);
  assert.strictEqual(hook.isSelfEdit('claude', 'PostToolUse', { tool_input: { command: 'cat >.kala/state.yaml' } }), true);
  assert.strictEqual(hook.isSelfEdit('claude', 'PostToolUse', { tool_input: { command: 'cp .kala/state.yaml.bak /tmp/bak' } }), false);
  assert.strictEqual(hook.isSelfEdit('claude', 'PostToolUse', { tool_input: { file_path: '/repo/src/app.ts' } }), false);
  assert.strictEqual(hook.isSelfEdit('agy', 'PostToolUse', { toolCall: { args: { CommandLine: 'npm test' } } }), false);
  assert.strictEqual(hook.isSelfEdit('claude', 'Stop', { tool_input: { file_path: '.kala/state.yaml' } }), false);
});

await test('K8/K10/K11/K12: counter, self-edit skip, reset, cooldown, Stop bypass, template < 250', () => {
  const r = path.join(ROOT, 'k8-eval');
  fs.mkdirSync(r, { recursive: true });
  state.saveState(r, state.blankState(r, 'main'));
  const stFile = path.join(r, '.kala', 'state.yaml');
  const st0 = fs.statSync(stFile);
  const customCfg = { enabled: true, edit_threshold: 3, max_age_minutes: 10, cooldown_minutes: 5, timeout_seconds: 5 };
  let now = st0.mtimeMs + 1000;

  // Self-edit does not increment
  const selfRes = hook.evaluateHook({
    agent: 'claude',
    event: 'PostToolUse',
    repoDir: r,
    payload: { tool_input: { file_path: '.kala/state.yaml' } },
    config: customCfg,
    nowMs: now,
  });
  assert.strictEqual(selfRes.shouldNudge, false);
  assert.strictEqual(selfRes.state.editsSinceCheckpoint, 0);

  // 2 normal edits -> below threshold (3), no nudge
  for (let i = 1; i <= 2; i++) {
    now += 1000;
    const res = hook.evaluateHook({
      agent: 'claude',
      event: 'PostToolUse',
      repoDir: r,
      payload: { tool_input: { file_path: `src/f${i}.ts` } },
      config: customCfg,
      nowMs: now,
    });
    assert.strictEqual(res.shouldNudge, false);
    assert.strictEqual(res.state.editsSinceCheckpoint, i);
  }
  assert.strictEqual(fs.statSync(path.join(r, '.kala', '.hook-state.json')).mode & 0o777, 0o600);

  // 3rd edit hits threshold -> nudges, sets lastNudgeAt
  now += 1000;
  const r3 = hook.evaluateHook({
    agent: 'claude',
    event: 'PostToolUse',
    repoDir: r,
    payload: { tool_input: { file_path: 'src/f3.ts' } },
    config: customCfg,
    nowMs: now,
  });
  assert.strictEqual(r3.shouldNudge, true);
  assert.strictEqual(r3.state.editsSinceCheckpoint, 3);
  assert.ok(r3.state.lastNudgeAt !== null);

  const nudge = hook.buildNudgeText(r3.editsSinceCheckpoint);
  assert.ok(nudge.length < 250, `nudge length ${nudge.length} must be < 250`);
  assert.ok(nudge.includes('3 edits since last update'));

  // 4th edit within cooldown -> suppressed mid-turn
  now += 10_000;
  const r4 = hook.evaluateHook({
    agent: 'claude',
    event: 'PostToolUse',
    repoDir: r,
    payload: { tool_input: { file_path: 'src/f4.ts' } },
    config: customCfg,
    nowMs: now,
  });
  assert.strictEqual(r4.shouldNudge, false);
  assert.strictEqual(r4.state.editsSinceCheckpoint, 4);

  // Stop fires immediately even inside PostToolUse cooldown!
  const stopImmediate = hook.evaluateHook({
    agent: 'claude',
    event: 'Stop',
    repoDir: r,
    payload: { stop_hook_active: false },
    config: customCfg,
    nowMs: now,
  });
  assert.strictEqual(stopImmediate.shouldNudge, true);

  // Cooldown elapsed -> mid-turn nudges again
  now += 6 * 60_000;
  const r5 = hook.evaluateHook({
    agent: 'claude',
    event: 'PostToolUse',
    repoDir: r,
    payload: { tool_input: { file_path: 'src/f5.ts' } },
    config: customCfg,
    nowMs: now,
  });
  assert.strictEqual(r5.shouldNudge, true);

  // Reset when state.yaml size changes (even if mtime unchanged); non-self PostToolUse counts as 1 (K10-v2)
  const sameMtime = fs.statSync(stFile).mtime;
  fs.appendFileSync(stFile, '# checkpoint note\n');
  fs.utimesSync(stFile, sameMtime, sameMtime);
  const afterSize = hook.evaluateHook({
    agent: 'claude',
    event: 'PostToolUse',
    repoDir: r,
    payload: { tool_input: { file_path: 'src/f6.ts' } },
    config: customCfg,
    nowMs: now + 1000,
  });
  assert.strictEqual(afterSize.shouldNudge, false);
  assert.strictEqual(afterSize.state.editsSinceCheckpoint, 1);
  assert.strictEqual(afterSize.state.lastNudgeAt, null);

  // Age threshold triggers PreInvocation nudge when editsSinceCheckpoint >= 1 (K11-v2)
  const ageRes = hook.evaluateHook({
    agent: 'agy',
    event: 'PreInvocation',
    repoDir: r,
    payload: {},
    config: customCfg,
    nowMs: sameMtime.getTime() + 11 * 60_000,
  });
  assert.strictEqual(ageRes.shouldNudge, true);
});

await test('K4/K7: exact vendor output schemas & re-entry/termination guards', () => {
  const cPost = hook.formatVendorOutput('claude', 'PostToolUse', { shouldNudge: true, editsSinceCheckpoint: 5 });
  assert.strictEqual((cPost.hookSpecificOutput as { hookEventName: string }).hookEventName, 'PostToolUse');
  assert.ok(typeof (cPost.hookSpecificOutput as { additionalContext: string }).additionalContext === 'string');

  const cStop = hook.formatVendorOutput('claude', 'Stop', { shouldNudge: true, editsSinceCheckpoint: 2 });
  assert.strictEqual(cStop.decision, 'block');
  assert.ok(typeof cStop.reason === 'string');

  assert.deepStrictEqual(hook.formatVendorOutput('agy', 'PostToolUse', { shouldNudge: true, editsSinceCheckpoint: 5 }), {});
  const aPre = hook.formatVendorOutput('agy', 'PreInvocation', { shouldNudge: true, editsSinceCheckpoint: 5 });
  assert.ok(Array.isArray(aPre.injectSteps));
  assert.ok(typeof ((aPre.injectSteps as Array<{ systemMessage: { systemMessage: string } }>)[0].systemMessage.systemMessage) === 'string');

  const aStop = hook.formatVendorOutput('agy', 'Stop', { shouldNudge: true, editsSinceCheckpoint: 1 });
  assert.strictEqual(aStop.decision, 'continue');
  assert.ok(typeof aStop.reason === 'string');

  // Re-entry and termination guards
  const r = path.join(ROOT, 'k4-k7-guards');
  fs.mkdirSync(r, { recursive: true });
  state.saveState(r, state.blankState(r, 'main'));
  const st = fs.statSync(path.join(r, '.kala', 'state.yaml'));
  hook.saveHookState(r, { editsSinceCheckpoint: 2, lastNudgeAt: null, lastStateMtimeMs: st.mtimeMs, lastStateSize: st.size });

  assert.strictEqual(hook.evaluateHook({ agent: 'claude', event: 'Stop', repoDir: r, payload: { stop_hook_active: true } }).shouldNudge, false);
  assert.strictEqual(hook.evaluateHook({ agent: 'claude', event: 'Stop', repoDir: r, payload: { stop_hook_active: false } }).shouldNudge, true);

  assert.strictEqual(hook.evaluateHook({ agent: 'agy', event: 'PostToolUse', repoDir: r, payload: {} }).shouldNudge, false);
  assert.strictEqual(hook.evaluateHook({ agent: 'agy', event: 'Stop', repoDir: r, payload: { continuationActive: true, terminationReason: 'NO_TOOL_CALL' } }).shouldNudge, false);
  for (const badReason of ['USER_CANCELED', 'ERROR', 'MAX_INVOCATIONS', 'MAX_FORCED_INVOCATIONS', 'MAX_TOKEN_BUDGET_EXCEEDED']) {
    assert.strictEqual(
      hook.evaluateHook({ agent: 'agy', event: 'Stop', repoDir: r, payload: { continuationActive: false, terminationReason: badReason } }).shouldNudge,
      false,
      `agy Stop must not continue on ${badReason}`,
    );
  }
  assert.strictEqual(hook.evaluateHook({ agent: 'agy', event: 'Stop', repoDir: r, payload: { continuationActive: false, terminationReason: 'NO_TOOL_CALL' } }).shouldNudge, true);
});

await test('K8: concurrent saveHookState calls remain intact without leaving temp files', async () => {
  const r = path.join(ROOT, 'k8-race');
  fs.mkdirSync(path.join(r, '.kala'), { recursive: true });
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      Promise.resolve().then(() => {
        hook.saveHookState(r, { editsSinceCheckpoint: i + 1, lastNudgeAt: null, lastStateMtimeMs: 1000, lastStateSize: 100 });
      }),
    ),
  );
  const loaded = hook.loadHookState(r);
  assert.ok(loaded && loaded.editsSinceCheckpoint >= 1 && loaded.editsSinceCheckpoint <= 12);
  assert.deepStrictEqual(fs.readdirSync(path.join(r, '.kala')).filter((f) => f.includes('.tmp')), []);
});

await test('K3/K5/K6/K13: non-destructive hooks install/status/uninstall, gitignore warning, malformed abort', () => {
  const r = path.join(ROOT, 'k3-k13-repo');
  fs.mkdirSync(path.join(r, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(r, '.agents'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: r });
  state.saveState(r, state.blankState(r, 'main'));

  // Pre-seed user hooks + sibling keys + .claude/settings.json
  const trackedSettings = path.join(r, '.claude', 'settings.json');
  fs.writeFileSync(trackedSettings, JSON.stringify({ permissions: { allow: ['Bash(git:*)'] } }) + '\n');
  fs.writeFileSync(
    path.join(r, '.claude', 'settings.local.json'),
    JSON.stringify({
      customKey: 'keep-me',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }],
        PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'prettier --write' }] }],
      },
    }) + '\n',
  );
  fs.writeFileSync(
    path.join(r, '.agents', 'hooks.json'),
    JSON.stringify({ 'user-lint': { PostToolUse: [{ matcher: 'edit_file', hooks: [{ type: 'command', command: 'npm run lint' }] }] } }) + '\n',
  );

  // Install via CLI with explicit --agents claude,agy and gitignore warning
  const inst = runKala(['hooks', 'install', '--agents', 'claude,agy'], r);
  assert.strictEqual(inst.status, 0, inst.stderr);
  assert.match(inst.stderr, /not gitignored/);

  // .claude/settings.json untouched
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(trackedSettings, 'utf8')), { permissions: { allow: ['Bash(git:*)'] } });

  // .claude/settings.local.json merged cleanly
  const claudeLocal = JSON.parse(fs.readFileSync(path.join(r, '.claude', 'settings.local.json'), 'utf8'));
  assert.strictEqual(claudeLocal.customKey, 'keep-me');
  assert.strictEqual(claudeLocal.hooks.PreToolUse.length, 1);
  assert.strictEqual(claudeLocal.hooks.PostToolUse.length, 2);
  assert.strictEqual(claudeLocal.hooks.PostToolUse[1].matcher, 'Edit|Write|MultiEdit|Bash');
  assert.strictEqual(claudeLocal.hooks.Stop.length, 1);

  // .agents/hooks.json merged cleanly with missing-binary shell wrapper
  const agyHooks = JSON.parse(fs.readFileSync(path.join(r, '.agents', 'hooks.json'), 'utf8'));
  assert.ok(agyHooks['user-lint'], 'sibling hook preserved');
  const kc = agyHooks['kalaga-checkpoint'];
  assert.strictEqual(kc.PostToolUse[0].matcher, 'edit_file|write_file|run_command');
  assert.ok(kc.PostToolUse[0].hooks[0].command.includes("|| printf '{}'"));
  assert.ok(kc.PreInvocation[0].command.includes('[ -x '));
  assert.ok(kc.Stop[0].command.includes('_hook --agent agy --event Stop'));

  // Missing-binary guard returns {} and exit 0 when binary path does not exist
  const guardCmd = kc.Stop[0].command.replaceAll(fs.realpathSync(BIN), '/nonexistent/path/to/kala');
  const guardRes = spawnSync('/bin/sh', ['-c', guardCmd], { encoding: 'utf8' });
  assert.strictEqual(guardRes.status, 0);
  assert.strictEqual(guardRes.stdout.trim(), '{}');

  // shellQuote handles spaces and single quotes
  const quoted = hooks.shellQuote("/tmp/my 'kala'/bin/kala");
  const echoRes = spawnSync('/bin/sh', ['-c', `printf '%s' ${quoted}`], { encoding: 'utf8' });
  assert.strictEqual(echoRes.stdout, "/tmp/my 'kala'/bin/kala");

  // Gitignoring .agents/hooks.json suppresses the warning
  fs.writeFileSync(path.join(r, '.gitignore'), '.agents/hooks.json\n.claude/settings.local.json\n.kala/\n');
  const inst2 = runKala(['hooks', 'install', '--agents', 'agy'], r);
  assert.strictEqual(inst2.status, 0, inst2.stderr);
  assert.doesNotMatch(inst2.stderr, /not gitignored/);

  // Status shows both installed
  const statusOut = runKala(['hooks', 'status'], r);
  assert.strictEqual(statusOut.status, 0, statusOut.stderr);
  assert.match(statusOut.stdout, /claude: installed/);
  assert.match(statusOut.stdout, /agy:\s+installed/);
  assert.match(statusOut.stdout, /checkpoint:/);

  // Uninstall removes only Kalaga entries
  const uninst = runKala(['hooks', 'uninstall'], r);
  assert.strictEqual(uninst.status, 0, uninst.stderr);
  const afterClaude = JSON.parse(fs.readFileSync(path.join(r, '.claude', 'settings.local.json'), 'utf8'));
  assert.strictEqual(afterClaude.customKey, 'keep-me');
  assert.strictEqual(afterClaude.hooks.PostToolUse.length, 1);
  assert.strictEqual(afterClaude.hooks.PostToolUse[0].hooks[0].command, 'prettier --write');
  assert.strictEqual(afterClaude.hooks.Stop, undefined);

  const afterAgy = JSON.parse(fs.readFileSync(path.join(r, '.agents', 'hooks.json'), 'utf8'));
  assert.ok(afterAgy['user-lint']);
  assert.strictEqual(afterAgy['kalaga-checkpoint'], undefined);

  // Malformed JSON aborts cleanly without overwriting
  fs.writeFileSync(path.join(r, '.claude', 'settings.local.json'), '{bad json');
  const badJson = runKala(['hooks', 'install', '--agents', 'claude'], r);
  assert.notStrictEqual(badJson.status, 0);
  assert.match(badJson.stderr, /cannot parse/);
  assert.strictEqual(fs.readFileSync(path.join(r, '.claude', 'settings.local.json'), 'utf8'), '{bad json');

  // Unsupported --agents exits non-zero
  const badAgent = runKala(['hooks', 'install', '--agents', 'unknown'], r);
  assert.notStrictEqual(badAgent.status, 0);
  assert.match(badAgent.stderr, /unsupported hook agent/);
});

await test('K14: value flags parsed cleanly while preserving exit 2 for unknown flags', () => {
  const r = path.join(ROOT, 'k14-flags');
  fs.mkdirSync(r, { recursive: true });
  assert.strictEqual(runKala(['status', '--agent', 'claude'], r).status, 2);
  assert.strictEqual(runKala(['init', '--agents', 'claude'], r).status, 2);
  assert.strictEqual(runKala(['hooks', 'install', '--agents'], r).status, 2);
  assert.strictEqual(runKala(['hooks', 'install', '--bogus'], r).status, 2);
  const ok = runKala(['hooks', '--agents=claude', 'install'], r);
  assert.strictEqual(ok.status, 0, ok.stderr);
});

await test('K15: hooks config in KALA_HOME/config.yaml & enabled:false no-op', () => {
  const cfgPath = path.join(KALA, 'config.yaml');
  const hadCfg = fs.existsSync(cfgPath);
  const backup = hadCfg ? fs.readFileSync(cfgPath, 'utf8') : null;
  try {
    fs.writeFileSync(cfgPath, [
      'inject_rich_prompt: false',
      'hooks:',
      '  enabled: false',
      '  edit_threshold: 2',
      '  max_age_minutes: 4',
      '  cooldown_minutes: 1',
      '  timeout_seconds: 9',
      '',
    ].join('\n'));
    const loaded = cfg.loadHookConfig();
    assert.deepStrictEqual(loaded, {
      enabled: false,
      edit_threshold: 2,
      max_age_minutes: 4,
      cooldown_minutes: 1,
      timeout_seconds: 9,
    });

    const r = path.join(ROOT, 'k15-disabled');
    fs.mkdirSync(r, { recursive: true });
    state.saveState(r, state.blankState(r, 'main'));
    const res = runKalaInput(['_hook', '--agent', 'claude', '--event', 'PostToolUse'], r, JSON.stringify({ cwd: r }));
    assert.strictEqual(res.status, 0);
    assert.deepStrictEqual(JSON.parse(res.stdout.trim()), {});
    assert.strictEqual(fs.existsSync(path.join(r, '.kala', '.hook-state.json')), false, 'enabled:false does not write hook state');

    // Blank/empty numeric fields must keep defaults (never coerce "" -> 0 for cooldown_minutes)
    fs.writeFileSync(cfgPath, [
      'hooks:',
      '  cooldown_minutes:',
      '  edit_threshold: ""',
      '',
    ].join('\n'));
    assert.deepStrictEqual(cfg.loadHookConfig(), cfg.DEFAULT_HOOK_CONFIG);
  } finally {
    if (backup !== null) fs.writeFileSync(cfgPath, backup);
    else if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
  }
});

await test('K16: symlink refusal, 64KB cap, sanitized <=32KB error log, read-only .kala/ fail-open', () => {
  // 1. Symlinked .hook-state.json refused; target untouched; CLI still emits {} + exit 0
  const r = path.join(ROOT, 'k16-sym');
  fs.mkdirSync(r, { recursive: true });
  state.saveState(r, state.blankState(r, 'main'));
  const victim = path.join(ROOT, 'k16-victim.json');
  fs.writeFileSync(victim, 'UNTOUCHED');
  fs.symlinkSync(victim, path.join(r, '.kala', '.hook-state.json'));
  assert.throws(() => hook.loadHookState(r), /symlink/);
  const symRes = runKalaInput(['_hook', '--agent', 'claude', '--event', 'PostToolUse'], r, JSON.stringify({ cwd: r }));
  assert.strictEqual(symRes.status, 0);
  assert.deepStrictEqual(JSON.parse(symRes.stdout.trim()), {});
  assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'UNTOUCHED');

  // 2. Symlinked .claude/settings.local.json and .agents/hooks.json refused
  fs.mkdirSync(path.join(r, '.claude'), { recursive: true });
  fs.symlinkSync(victim, path.join(r, '.claude', 'settings.local.json'));
  assert.throws(() => hooks.installHooks(r, { agents: ['claude'] }), /symlink/);
  fs.mkdirSync(path.join(r, '.agents'), { recursive: true });
  fs.symlinkSync(victim, path.join(r, '.agents', 'hooks.json'));
  assert.throws(() => hooks.installHooks(r, { agents: ['agy'] }), /symlink/);
  assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'UNTOUCHED');

  // 3. Malformed stdin with secret never leaks secret into hook-errors.log
  const rErr = path.join(ROOT, 'k16-errlog');
  fs.mkdirSync(rErr, { recursive: true });
  state.saveState(rErr, state.blankState(rErr, 'main'));
  const badRes = runKalaInput(['_hook', '--agent', 'claude', '--event', 'PostToolUse'], rErr, '{"token":"SECRET_TOKEN_XYZ" bad');
  assert.strictEqual(badRes.status, 0);
  assert.deepStrictEqual(JSON.parse(badRes.stdout.trim()), {});
  const errLogPath = path.join(rErr, '.kala', 'hook-errors.log');
  assert.ok(fs.existsSync(errLogPath));
  assert.strictEqual(fs.statSync(errLogPath).mode & 0o777, 0o600);
  assert.ok(!fs.readFileSync(errLogPath, 'utf8').includes('SECRET_TOKEN_XYZ'));

  // 4. > 64 KB stdin handled cleanly
  const bigPayload = JSON.stringify({ cwd: rErr, pad: 'A'.repeat(70 * 1024) });
  const bigRes = runKalaInput(['_hook', '--agent', 'claude', '--event', 'PostToolUse'], rErr, bigPayload);
  assert.strictEqual(bigRes.status, 0);
  assert.deepStrictEqual(JSON.parse(bigRes.stdout.trim()), {});

  // 5. hook-errors.log bounded <= 32 KB
  for (let i = 0; i < 400; i++) {
    hook.logHookError(rErr, new Error(`err-${i}-${'x'.repeat(120)}`));
  }
  assert.ok(fs.statSync(errLogPath).size <= 32 * 1024, 'hook-errors.log capped at <= 32 KB');

  // 6. Read-only .kala/ fails open to {} + exit 0
  const rRo = path.join(ROOT, 'k16-ro');
  fs.mkdirSync(rRo, { recursive: true });
  state.saveState(rRo, state.blankState(rRo, 'main'));
  fs.chmodSync(path.join(rRo, '.kala'), 0o555);
  try {
    const roRes = runKalaInput(['_hook', '--agent', 'claude', '--event', 'PostToolUse'], rRo, JSON.stringify({ cwd: rRo }));
    assert.strictEqual(roRes.status, 0);
    assert.deepStrictEqual(JSON.parse(roRes.stdout.trim()), {});
  } finally {
    fs.chmodSync(path.join(rRo, '.kala'), 0o755);
  }
});

section('FEAT-004 v2: regression tests (K10-v2, K11-v2, K13-v2, K16-v2, K19, K20)');
await test('K10-v2: post-reset non-self PostToolUse counts edit (1); self/Stop/PreInvocation stays 0', () => {
  const r = path.join(ROOT, 'k10v2-repo');
  fs.mkdirSync(r, { recursive: true });
  state.saveState(r, state.blankState(r, 'main'));
  const stFile = path.join(r, '.kala', 'state.yaml');
  const customCfg = { enabled: true, edit_threshold: 5, max_age_minutes: 10, cooldown_minutes: 5, timeout_seconds: 5 };
  const t0 = fs.statSync(stFile).mtimeMs;

  // Seed prior edits + active cooldown
  hook.saveHookState(r, {
    editsSinceCheckpoint: 4,
    lastNudgeAt: new Date(t0).toISOString(),
    lastStateMtimeMs: t0,
    lastStateSize: fs.statSync(stFile).size,
  });

  // External state.yaml update (mtime + size increase), followed by a single non-self PostToolUse
  fs.appendFileSync(stFile, '# updated\n');
  const t1 = t0 + 5000;
  fs.utimesSync(stFile, new Date(t1), new Date(t1));

  const post = hook.evaluateHook({
    agent: 'claude',
    event: 'PostToolUse',
    repoDir: r,
    payload: { tool_input: { file_path: 'src/app.ts' } },
    config: customCfg,
    nowMs: t1 + 1000,
  });
  assert.strictEqual(post.shouldNudge, false);
  assert.strictEqual(post.editsSinceCheckpoint, 1);
  assert.strictEqual(post.state.editsSinceCheckpoint, 1);
  assert.strictEqual(post.state.lastNudgeAt, null);

  // Subsequent Stop must nudge for that 1 edit
  const stop = hook.evaluateHook({
    agent: 'claude',
    event: 'Stop',
    repoDir: r,
    payload: { stop_hook_active: false },
    config: customCfg,
    nowMs: t1 + 2000,
  });
  assert.strictEqual(stop.shouldNudge, true);
  assert.strictEqual(stop.editsSinceCheckpoint, 1);

  // If threshold === 1, non-self PostToolUse after reset also nudges immediately (cooldown was cleared)
  fs.appendFileSync(stFile, '# threshold 1\n');
  const t2 = t1 + 10_000;
  fs.utimesSync(stFile, new Date(t2), new Date(t2));
  const thresh1 = hook.evaluateHook({
    agent: 'claude',
    event: 'PostToolUse',
    repoDir: r,
    payload: { tool_input: { file_path: 'src/one.ts' } },
    config: { ...customCfg, edit_threshold: 1 },
    nowMs: t2 + 500,
  });
  assert.strictEqual(thresh1.shouldNudge, true);
  assert.strictEqual(thresh1.editsSinceCheckpoint, 1);

  // Self-edit PostToolUse after reset stays 0
  fs.appendFileSync(stFile, '# self\n');
  const t3 = t2 + 10_000;
  fs.utimesSync(stFile, new Date(t3), new Date(t3));
  const selfPost = hook.evaluateHook({
    agent: 'claude',
    event: 'PostToolUse',
    repoDir: r,
    payload: { tool_input: { file_path: '.kala/state.yaml' } },
    config: customCfg,
    nowMs: t3 + 500,
  });
  assert.strictEqual(selfPost.shouldNudge, false);
  assert.strictEqual(selfPost.editsSinceCheckpoint, 0);
  assert.strictEqual(selfPost.state.lastNudgeAt, null);

  // Non-PostToolUse (PreInvocation / Stop) after reset stays 0 and does not nudge
  fs.appendFileSync(stFile, '# pre\n');
  const t4 = t3 + 10_000;
  fs.utimesSync(stFile, new Date(t4), new Date(t4));
  const preReset = hook.evaluateHook({
    agent: 'agy',
    event: 'PreInvocation',
    repoDir: r,
    payload: {},
    config: customCfg,
    nowMs: t4 + 500,
  });
  assert.strictEqual(preReset.shouldNudge, false);
  assert.strictEqual(preReset.editsSinceCheckpoint, 0);

  fs.appendFileSync(stFile, '# stop\n');
  const t5 = t4 + 10_000;
  fs.utimesSync(stFile, new Date(t5), new Date(t5));
  const stopReset = hook.evaluateHook({
    agent: 'claude',
    event: 'Stop',
    repoDir: r,
    payload: { stop_hook_active: false },
    config: customCfg,
    nowMs: t5 + 500,
  });
  assert.strictEqual(stopReset.shouldNudge, false);
  assert.strictEqual(stopReset.editsSinceCheckpoint, 0);
});

await test('K11-v2: ageMet requires editsSinceCheckpoint >= 1 (zero-edit turns never nudge)', () => {
  const r = path.join(ROOT, 'k11v2-repo');
  fs.mkdirSync(r, { recursive: true });
  state.saveState(r, state.blankState(r, 'main'));
  const st = fs.statSync(path.join(r, '.kala', 'state.yaml'));
  const customCfg = { enabled: true, edit_threshold: 5, max_age_minutes: 10, cooldown_minutes: 3, timeout_seconds: 5 };

  hook.saveHookState(r, {
    editsSinceCheckpoint: 0,
    lastNudgeAt: null,
    lastStateMtimeMs: st.mtimeMs,
    lastStateSize: st.size,
  });

  // 20 minutes later, 0 edits -> must NOT nudge on agy PreInvocation or claude PostToolUse self-edit
  const futureMs = st.mtimeMs + 20 * 60_000;
  const agyZero = hook.evaluateHook({
    agent: 'agy',
    event: 'PreInvocation',
    repoDir: r,
    payload: {},
    config: customCfg,
    nowMs: futureMs,
  });
  assert.strictEqual(agyZero.shouldNudge, false);
  assert.strictEqual(agyZero.editsSinceCheckpoint, 0);

  const claudeSelfZero = hook.evaluateHook({
    agent: 'claude',
    event: 'PostToolUse',
    repoDir: r,
    payload: { tool_input: { file_path: '.kala/state.yaml' } },
    config: customCfg,
    nowMs: futureMs,
  });
  assert.strictEqual(claudeSelfZero.shouldNudge, false);
  assert.strictEqual(claudeSelfZero.editsSinceCheckpoint, 0);

  // With 1 edit and age >= max_age_minutes -> agy PreInvocation DOES nudge
  hook.evaluateHook({
    agent: 'agy',
    event: 'PostToolUse',
    repoDir: r,
    payload: { toolCall: { args: { TargetFile: 'src/x.ts' } } },
    config: customCfg,
    nowMs: futureMs,
  });
  const agyOne = hook.evaluateHook({
    agent: 'agy',
    event: 'PreInvocation',
    repoDir: r,
    payload: {},
    config: customCfg,
    nowMs: futureMs + 1000,
  });
  assert.strictEqual(agyOne.shouldNudge, true);
  assert.strictEqual(agyOne.editsSinceCheckpoint, 1);
});

await test('K13-v2: default hooks install filters by isInstalled(agentFor(k)); uninstall still targets all', () => {
  const mkBinDir = (name: string, cmds: string[]): string => {
    const dir = path.join(ROOT, `k13v2-bin-${name}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const c of cmds) {
      const p = path.join(dir, c);
      fs.writeFileSync(p, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    return dir;
  };
  const binClaudeOnly = mkBinDir('claude-only', ['claude']);
  const binAgyOnly = mkBinDir('agy-only', ['agy']);
  const binNone = mkBinDir('none', []);

  const runWithPath = (args: string[], cwd: string, pathEnv: string) =>
    spawnSync(process.execPath, [BIN, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, HOME, KALA_HOME: KALA, PATH: pathEnv },
    });

  // 1. Only claude on PATH
  const rClaude = path.join(ROOT, 'k13v2-repo-claude');
  fs.mkdirSync(rClaude, { recursive: true });
  state.saveState(rClaude, state.blankState(rClaude, 'main'));
  const resC = runWithPath(['hooks', 'install'], rClaude, binClaudeOnly);
  assert.strictEqual(resC.status, 0, resC.stderr);
  assert.ok(fs.existsSync(path.join(rClaude, '.claude', 'settings.local.json')));
  assert.strictEqual(fs.existsSync(path.join(rClaude, '.agents', 'hooks.json')), false);

  // 2. Only agy on PATH
  const rAgy = path.join(ROOT, 'k13v2-repo-agy');
  fs.mkdirSync(rAgy, { recursive: true });
  state.saveState(rAgy, state.blankState(rAgy, 'main'));
  const resA = runWithPath(['hooks', 'install'], rAgy, binAgyOnly);
  assert.strictEqual(resA.status, 0, resA.stderr);
  assert.strictEqual(fs.existsSync(path.join(rAgy, '.claude', 'settings.local.json')), false);
  assert.ok(fs.existsSync(path.join(rAgy, '.agents', 'hooks.json')));

  // 3. None on PATH -> install errors clearly suggesting --agents claude,agy,cursor,grok and writes nothing
  const rNone = path.join(ROOT, 'k13v2-repo-none');
  fs.mkdirSync(rNone, { recursive: true });
  state.saveState(rNone, state.blankState(rNone, 'main'));
  const resN = runWithPath(['hooks', 'install'], rNone, binNone);
  assert.notStrictEqual(resN.status, 0);
  assert.match(resN.stderr, /--agents claude,agy,cursor,grok/);
  assert.strictEqual(fs.existsSync(path.join(rNone, '.claude', 'settings.local.json')), false);
  assert.strictEqual(fs.existsSync(path.join(rNone, '.agents', 'hooks.json')), false);

  // Also test in-process installHooks() with clearResolvedCache()
  const prevPath = process.env.PATH;
  try {
    process.env.PATH = binClaudeOnly;
    cfg.clearResolvedCache();
    const rInProc = path.join(ROOT, 'k13v2-inproc');
    fs.mkdirSync(rInProc, { recursive: true });
    const instRes = hooks.installHooks(rInProc);
    assert.deepStrictEqual(instRes.agents, ['claude']);

    process.env.PATH = binNone;
    cfg.clearResolvedCache();
    assert.throws(() => hooks.installHooks(rInProc), /--agents claude,agy,cursor,grok/);
    assert.throws(() => hooks.installHooks(rInProc, { agents: [] }), /no hook agents specified/);
  } finally {
    process.env.PATH = prevPath;
    cfg.clearResolvedCache();
  }

  // Empty --agents value exits non-zero
  assert.notStrictEqual(runWithPath(['hooks', 'install', '--agents', ''], rNone, binClaudeOnly).status, 0);

  // 4. Uninstall without --agents removes BOTH even when neither CLI is on PATH
  const rBoth = path.join(ROOT, 'k13v2-repo-both');
  fs.mkdirSync(rBoth, { recursive: true });
  state.saveState(rBoth, state.blankState(rBoth, 'main'));
  const instBoth = runWithPath(['hooks', 'install', '--agents', 'claude,agy'], rBoth, binNone);
  assert.strictEqual(instBoth.status, 0, instBoth.stderr);
  const uninstNone = runWithPath(['hooks', 'uninstall'], rBoth, binNone);
  assert.strictEqual(uninstNone.status, 0, uninstNone.stderr);
  assert.match(uninstNone.stderr, /claude, agy/);
  const stAfter = hooks.hooksStatus(rBoth);
  assert.strictEqual(stAfter.claudeInstalled, false);
  assert.strictEqual(stAfter.agyInstalled, false);
});

await test('K16-v2: HOOK_STDIN_DEADLINE_MS < HOOK_DEADLINE_MS; hanging stdin logs and emits {} + exit 0', async () => {
  assert.strictEqual(hook.HOOK_STDIN_DEADLINE_MS, hook.HOOK_DEADLINE_MS - 400);
  assert.ok(hook.HOOK_STDIN_DEADLINE_MS < hook.HOOK_DEADLINE_MS);

  const r = path.join(ROOT, 'k16v2-hang');
  fs.mkdirSync(r, { recursive: true });
  state.saveState(r, state.blankState(r, 'main'));

  const res = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, '_hook', '--agent', 'claude', '--event', 'PostToolUse'], {
      cwd: r,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME, KALA_HOME: KALA },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    const guard = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error('K16-v2 hanging stdin test timed out past 4000ms'));
    }, 4000);
    child.on('close', (code) => {
      clearTimeout(guard);
      resolve({ code, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(guard);
      reject(err);
    });
    // Intentionally leave child.stdin open without writing/ending.
  });

  assert.strictEqual(res.code, 0, res.stderr);
  assert.deepStrictEqual(JSON.parse(res.stdout.trim()), {});
  const errLog = fs.readFileSync(path.join(r, '.kala', 'hook-errors.log'), 'utf8');
  assert.match(errLog, /stdin read deadline exceeded/);
});

await test('K19: bin/kala _hook fails open with {} + exit 0 when dist/hook.js is broken or missing', () => {
  const brokenPkg = path.join(ROOT, 'k19-broken');
  fs.mkdirSync(path.join(brokenPkg, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(brokenPkg, 'dist'), { recursive: true });
  fs.copyFileSync(BIN, path.join(brokenPkg, 'bin', 'kala'));
  fs.writeFileSync(path.join(brokenPkg, 'dist', 'hook.js'), 'export const broken = {{{;\n');

  const brokenRes = spawnSync(
    process.execPath,
    [path.join(brokenPkg, 'bin', 'kala'), '_hook', '--agent', 'agy', '--event', 'PreInvocation'],
    { cwd: ROOT, input: '{}', encoding: 'utf8', env: { ...process.env, HOME, KALA_HOME: KALA } },
  );
  assert.strictEqual(brokenRes.status, 0, brokenRes.stderr);
  assert.deepStrictEqual(JSON.parse(brokenRes.stdout.trim()), {});

  const missingPkg = path.join(ROOT, 'k19-missing');
  fs.mkdirSync(path.join(missingPkg, 'bin'), { recursive: true });
  fs.copyFileSync(BIN, path.join(missingPkg, 'bin', 'kala'));
  const missingRes = spawnSync(
    process.execPath,
    [path.join(missingPkg, 'bin', 'kala'), '_hook', '--agent', 'claude', '--event', 'Stop'],
    { cwd: ROOT, input: '{}', encoding: 'utf8', env: { ...process.env, HOME, KALA_HOME: KALA } },
  );
  assert.strictEqual(missingRes.status, 0, missingRes.stderr);
  assert.deepStrictEqual(JSON.parse(missingRes.stdout.trim()), {});
});

await test('K20: hooksStatus and CLI status isolate malformed JSON / symlinks per agent', () => {
  const r = path.join(ROOT, 'k20-status');
  fs.mkdirSync(r, { recursive: true });
  state.saveState(r, state.blankState(r, 'main'));
  hooks.installHooks(r, { agents: ['claude', 'agy'] });

  // Corrupt .agents/hooks.json while keeping .claude/settings.local.json valid
  fs.writeFileSync(path.join(r, '.agents', 'hooks.json'), '{bad json');

  const rep = hooks.hooksStatus(r);
  assert.strictEqual(rep.claudeInstalled, true);
  assert.deepStrictEqual(rep.claudeEvents, ['PostToolUse', 'Stop']);
  assert.strictEqual(rep.claudeError, null);
  assert.strictEqual(rep.agyInstalled, false);
  assert.ok(rep.agyError !== null && rep.agyError.length > 0);
  assert.strictEqual(rep.stateExists, true);

  const cli = runKala(['hooks', 'status'], r);
  assert.strictEqual(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /claude: installed \(\.claude\/settings\.local\.json: PostToolUse, Stop\)/);
  assert.match(cli.stdout, /agy:\s+error \(/);
  assert.match(cli.stdout, /checkpoint:/);
  assert.match(cli.stdout, /config:/);

  // install and uninstall must still hard-abort on malformed JSON
  assert.notStrictEqual(runKala(['hooks', 'install', '--agents', 'agy'], r).status, 0);
  assert.notStrictEqual(runKala(['hooks', 'uninstall', '--agents', 'agy'], r).status, 0);

  // Symlinked .claude/settings.local.json isolated while valid .agents/hooks.json reports installed
  const rSym = path.join(ROOT, 'k20-sym');
  fs.mkdirSync(rSym, { recursive: true });
  state.saveState(rSym, state.blankState(rSym, 'main'));
  hooks.installHooks(rSym, { agents: ['agy'] });
  fs.mkdirSync(path.join(rSym, '.claude'), { recursive: true });
  const target = path.join(ROOT, 'k20-target.json');
  fs.writeFileSync(target, '{}');
  fs.symlinkSync(target, path.join(rSym, '.claude', 'settings.local.json'));

  const repSym = hooks.hooksStatus(rSym);
  assert.strictEqual(repSym.claudeInstalled, false);
  assert.ok(repSym.claudeError && repSym.claudeError.includes('symlink'));
  assert.strictEqual(repSym.agyInstalled, true);
  assert.strictEqual(repSym.agyError, null);

  // Symlinked .agents/hooks.json isolated while valid .claude/settings.local.json reports installed
  const rAgySym = path.join(ROOT, 'k20-agy-sym');
  fs.mkdirSync(rAgySym, { recursive: true });
  state.saveState(rAgySym, state.blankState(rAgySym, 'main'));
  hooks.installHooks(rAgySym, { agents: ['claude'] });
  fs.mkdirSync(path.join(rAgySym, '.agents'), { recursive: true });
  fs.symlinkSync(target, path.join(rAgySym, '.agents', 'hooks.json'));

  const repAgySym = hooks.hooksStatus(rAgySym);
  assert.strictEqual(repAgySym.claudeInstalled, true);
  assert.strictEqual(repAgySym.claudeError, null);
  assert.strictEqual(repAgySym.agyInstalled, false);
  assert.ok(repAgySym.agyError && repAgySym.agyError.includes('symlink'));
});
await test('trap/inject: prior limit notes excluded from Avoid and echoed Kalaga lines ignored by scanChunk', () => {
  const s = state.blankState('/tmp/x', null);
  s.owner = 'claude';
  s.goal = 'build app';
  s.next_step = 'next step';
  s.negative_constraints = [
    'Do not add npm dependencies',
    'claude limit hit: You have reached your 5-hour session limit. Usage limit reached — resets in 3 hours.',
  ];
  const inj = handoffInject(s, false, 'claude');
  assert.ok(inj.includes('Avoid: Do not add npm dependencies'));
  assert.ok(!inj.includes('claude limit hit:'), 'prior limit note must not echo into prompt');
  assert.ok(!inj.includes('Usage limit reached'), 'raw vendor limit phrase must not echo into prompt');

  const echoed = [
    'Kalaga handoff from cursor. Read .kala/state.yaml in the project root before doing anything.',
    'Avoid: Do not add deps | claude limit hit: You have reached your 5-hour session limit. Usage limit reached',
    'claude limit hit: Usage limit reached',
    'Implemented server.js cleanly.',
  ].join('\n');
  assert.strictEqual(scanChunk(echoed, cfg.AGENTS.grok, 0), null);

  const realHit = `${echoed}\nYou have reached your 5-hour session limit. Usage limit reached.`;
  const parsed = scanChunk(realHit, cfg.AGENTS.grok, 0);
  assert.ok(parsed);
  assert.ok(parsed!.line.includes('Usage limit reached'));
});
await test('sqlitewarn suppresses only ExperimentalWarning mentioning SQLite', async () => {
  const { ignoreSqliteExperimentalWarning } = await import(`${SRC}/util/sqlitewarn.ts`);
  const seen: string[] = [];
  const origEmit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const msg = typeof warning === 'string' ? warning : warning.message;
    const kind = typeof args[0] === 'string' ? args[0] : (warning instanceof Error ? warning.name : '');
    seen.push(`${kind}:${msg}`);
  }) as typeof process.emitWarning;
  try {
    ignoreSqliteExperimentalWarning();
    process.emitWarning('SQLite is an experimental feature', 'ExperimentalWarning');
    process.emitWarning('SQLite legacy mode deprecated', 'DeprecationWarning');
    process.emitWarning('Other experimental feature', 'ExperimentalWarning');
    assert.deepStrictEqual(seen, [
      'DeprecationWarning:SQLite legacy mode deprecated',
      'ExperimentalWarning:Other experimental feature',
    ]);
  } finally {
    process.emitWarning = origEmit;
  }
});
await test('ttyask: non-TTY line/EOF and raw-mode \\r\\n + close handling', async () => {
  const { readSingleKeyOrLine } = await import(`${SRC}/util/ttyask.ts`);
  const { PassThrough } = await import('node:stream');
  const origStdin = Object.getOwnPropertyDescriptor(process, 'stdin')!;
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((_c: string | Uint8Array, enc?: BufferEncoding | ((e?: Error | null) => void), cb?: (e?: Error | null) => void) => {
    if (typeof enc === 'function') enc(null);
    else if (typeof cb === 'function') cb(null);
    return true;
  }) as typeof process.stderr.write;

  try {
    const pipe = new PassThrough();
    Object.defineProperty(process, 'stdin', { value: pipe, configurable: true });
    const pPipe = readSingleKeyOrLine();
    pipe.end('y\n');
    assert.strictEqual(await pPipe, 'y');

    const eofPipe = new PassThrough();
    Object.defineProperty(process, 'stdin', { value: eofPipe, configurable: true });
    const pEof = readSingleKeyOrLine();
    eofPipe.end();
    assert.strictEqual(await pEof, '');

    // Raw-mode TTY simulation for CRLF and abrupt close
    const rawCrlf = Object.assign(new PassThrough(), {
      isTTY: true,
      isRaw: false,
      setRawMode(v: boolean) { (this as { isRaw: boolean }).isRaw = v; },
    });
    Object.defineProperty(process, 'stdin', { value: rawCrlf, configurable: true });
    const pCrlf = readSingleKeyOrLine();
    rawCrlf.write('\r\n');
    assert.strictEqual(await pCrlf, '');
    assert.strictEqual(rawCrlf.isRaw, false);

    const rawClose = Object.assign(new PassThrough(), {
      isTTY: true,
      isRaw: false,
      setRawMode(v: boolean) { (this as { isRaw: boolean }).isRaw = v; },
    });
    Object.defineProperty(process, 'stdin', { value: rawClose, configurable: true });
    const pRawClose = readSingleKeyOrLine();
    rawClose.destroy();
    assert.strictEqual(await pRawClose, '');
    assert.strictEqual(rawClose.isRaw, false);
  } finally {
    Object.defineProperty(process, 'stdin', { ...origStdin, configurable: true });
    process.stderr.write = origStderrWrite;
  }
});
await test('trust: Windows backslash paths round-trip through trust.yaml', () => {
  const trustFile = path.join(KALA, 'trust.yaml');
  const backup = fs.existsSync(trustFile) ? fs.readFileSync(trustFile, 'utf8') : null;
  try {
    const winPath = 'C:\\Users\\user0\\repo\\proj';
    const future = new Date(Date.now() + 86_400_000).toISOString();
    fs.writeFileSync(
      trustFile,
      `grants:\n  - path: ${JSON.stringify(winPath)}\n    granted_at: "2026-11-26T00:00:00.000Z"\n    expires_at: ${JSON.stringify(future)}\n`,
      { mode: 0o600 },
    );
    const list = trust.trustStatus();
    assert.strictEqual(list[0].path, winPath);
  } finally {
    if (backup === null) fs.rmSync(trustFile, { force: true });
    else fs.writeFileSync(trustFile, backup, { mode: 0o600 });
  }
});
await test('liveask: ignores YAML null/~ and merges done + negative_constraints without clobbering', async () => {
  const nullParsed = liveask.parseLiveAskYaml('goal: null\ndone: null\nnegative_constraints: ~\nnext_step: keep going\nnotes: "null"\n');
  assert.strictEqual(nullParsed.goal, undefined);
  assert.strictEqual(nullParsed.done, undefined);
  assert.strictEqual(nullParsed.negative_constraints, undefined);
  assert.strictEqual(nullParsed.next_step, 'keep going');

  const r = path.join(ROOT, 'liveask-merge');
  fs.mkdirSync(r);
  const init = state.blankState(r, 'main');
  init.goal = 'ship feature';
  init.done = ['landed step 1'];
  init.negative_constraints = ['do not break auth'];
  state.saveState(r, init);

  const stub = path.join(ROOT, 'liveask-stub.sh');
  fs.writeFileSync(stub, '#!/bin/sh\necho "done:"\necho "  - landed step 1"\necho "  - landed step 2"\necho "negative_constraints: [do not break auth, no shell true]"\necho "next_step: run tests"\n');
  fs.chmodSync(stub, 0o755);
  const fakeAgent = { ...cfg.AGENTS.claude, interactive: [stub], headless: [], trustFlags: [], resumeByIdPrefix: ['-r'] };
  await liveask.liveAskAndMerge(fakeAgent, r, 5000);
  const after = state.loadState(r)!;
  assert.deepStrictEqual(after.done, ['landed step 1', 'landed step 2']);
  assert.deepStrictEqual(after.negative_constraints, ['do not break auth', 'no shell true']);
  assert.strictEqual(after.next_step, 'run tests');
});
await test('index: missing binary exits 1 without mutating owner; agy non-zero treated as suspect', () => {
  const r = path.join(ROOT, 'missing-bin-repo');
  fs.mkdirSync(r);
  const s = state.blankState(r, 'main');
  s.owner = 'agy';
  s.goal = 'ship something real';
  s.done = ['already did one thing'];
  s.next_step = 'finish thing';
  state.saveState(r, s);

  const res = spawnSync(process.execPath, [BIN, 'run', 'cursor'], {
    cwd: r,
    encoding: 'utf8',
    env: { ...process.env, HOME, KALA_HOME: KALA, PATH: path.dirname(process.execPath) },
  });
  assert.strictEqual(res.status, 1, res.stderr);
  assert.match(res.stderr, /binary not found/);
  assert.doesNotMatch(res.stderr, /assume it hit its limit/);
  assert.strictEqual(state.loadState(r)?.owner, 'agy');

  // Verify agy non-zero metadata-only exit classification logic matches suspect tier
  assert.strictEqual(classifyExit({ hit: null, exitCode: 1, hasTail: false }), 'suspect');
});

section('FEAT-004 v3: cursor + grok hooks & cross-vendor dedup (K22–K27)');
await test('K22–K24: install/status/uninstall for all 4 agents, non-destructive merge, symlink & malformed isolation', () => {
  const r = path.join(ROOT, 'k22-all4');
  fs.mkdirSync(path.join(r, '.cursor'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: r });
  state.saveState(r, state.blankState(r, 'main'));

  // Seed user Cursor hook entry and sibling property
  fs.writeFileSync(
    path.join(r, '.cursor', 'hooks.json'),
    JSON.stringify({
      version: 1,
      userNote: 'keep-cursor',
      hooks: {
        beforeShellExecution: [{ command: 'echo check-shell' }],
        postToolUse: [{ matcher: 'Read', command: 'echo user-read' }],
      },
    }) + '\n',
  );

  const inst = runKala(['hooks', 'install', '--agents', 'claude,agy,cursor,grok'], r);
  assert.strictEqual(inst.status, 0, inst.stderr);
  assert.match(inst.stderr, /\.agents\/hooks\.json is not gitignored/);
  assert.match(inst.stderr, /\.cursor\/hooks\.json is not gitignored/);
  assert.match(inst.stderr, /\.grok\/hooks\/kalaga-checkpoint\.json is not gitignored/);
  assert.match(inst.stderr, /\/hooks-trust in Grok/);

  const curJson = JSON.parse(fs.readFileSync(path.join(r, '.cursor', 'hooks.json'), 'utf8'));
  assert.strictEqual(curJson.userNote, 'keep-cursor');
  assert.strictEqual(curJson.hooks.beforeShellExecution.length, 1);
  assert.strictEqual(curJson.hooks.postToolUse.length, 2);
  assert.strictEqual(curJson.hooks.postToolUse[1].matcher, 'Write|Edit|Shell|StrReplace|Delete');
  assert.strictEqual(curJson.hooks.stop.length, 1);

  const grokJson = JSON.parse(fs.readFileSync(path.join(r, '.grok', 'hooks', 'kalaga-checkpoint.json'), 'utf8'));
  assert.strictEqual(grokJson.hooks.PostToolUse.length, 1);
  assert.strictEqual(grokJson.hooks.Stop.length, 1);
  assert.ok(grokJson.hooks.PostToolUse[0].hooks[0].args.includes('grok'));

  const stAll = runKala(['hooks', 'status'], r);
  assert.strictEqual(stAll.status, 0, stAll.stderr);
  assert.match(stAll.stdout, /claude: installed/);
  assert.match(stAll.stdout, /agy:\s+installed/);
  assert.match(stAll.stdout, /cursor: installed \(\.cursor\/hooks\.json: PostToolUse, Stop\)/);
  assert.match(stAll.stdout, /grok:\s+installed \(\.grok\/hooks\/kalaga-checkpoint\.json: PostToolUse, Stop\)/);

  // Corrupt .cursor/hooks.json -> status isolates error while claude/agy/grok keep reporting installed
  fs.writeFileSync(path.join(r, '.cursor', 'hooks.json'), '{bad');
  const repErr = hooks.hooksStatus(r);
  assert.strictEqual(repErr.cursorInstalled, false);
  assert.ok(repErr.cursorError && repErr.cursorError.length > 0);
  assert.strictEqual(repErr.claudeInstalled, true);
  assert.strictEqual(repErr.agyInstalled, true);
  assert.strictEqual(repErr.grokInstalled, true);
  assert.notStrictEqual(runKala(['hooks', 'install', '--agents', 'cursor'], r).status, 0);

  // Restore valid .cursor/hooks.json via write, then uninstall cursor + grok cleanly
  fs.writeFileSync(
    path.join(r, '.cursor', 'hooks.json'),
    JSON.stringify({ version: 1, hooks: { postToolUse: [{ matcher: 'Read', command: 'echo user-read' }] } }) + '\n',
  );
  hooks.installHooks(r, { agents: ['cursor'] });
  const uninst = runKala(['hooks', 'uninstall'], r);
  assert.strictEqual(uninst.status, 0, uninst.stderr);
  const afterCur = JSON.parse(fs.readFileSync(path.join(r, '.cursor', 'hooks.json'), 'utf8'));
  assert.strictEqual(afterCur.hooks.postToolUse.length, 1);
  assert.strictEqual(afterCur.hooks.postToolUse[0].command, 'echo user-read');
  assert.strictEqual(afterCur.hooks.stop, undefined);
  assert.strictEqual(fs.existsSync(path.join(r, '.grok', 'hooks', 'kalaga-checkpoint.json')), false, 'empty Kalaga grok file removed');

  // Symlinked .cursor/hooks.json & .grok/hooks/kalaga-checkpoint.json refused without touching target
  const rSym = path.join(ROOT, 'k23-sym');
  fs.mkdirSync(path.join(rSym, '.cursor'), { recursive: true });
  fs.mkdirSync(path.join(rSym, '.grok', 'hooks'), { recursive: true });
  const victim = path.join(ROOT, 'k23-victim.json');
  fs.writeFileSync(victim, 'UNTOUCHED');
  fs.symlinkSync(victim, path.join(rSym, '.cursor', 'hooks.json'));
  fs.symlinkSync(victim, path.join(rSym, '.grok', 'hooks', 'kalaga-checkpoint.json'));
  assert.throws(() => hooks.installHooks(rSym, { agents: ['cursor'] }), /symlink/);
  assert.throws(() => hooks.installHooks(rSym, { agents: ['grok'] }), /symlink/);
  assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'UNTOUCHED');
});

await test('K25/K26: workspace_roots/workspaceRoot resolution, schemas, overlap suppression & tool_use_id dedup', () => {
  const r = path.join(ROOT, 'k25-k26-repo');
  const sub = path.join(r, 'src');
  fs.mkdirSync(sub, { recursive: true });
  state.saveState(r, state.blankState(r, 'main'));

  assert.strictEqual(hook.findRepoRoot({ workspace_roots: [sub] }), r);
  assert.strictEqual(hook.findRepoRoot({ workspaceRoot: sub }), r);
  assert.strictEqual(hook.isSelfEdit('cursor', 'PostToolUse', { tool_input: { path: '.kala/state.yaml' } }), true);
  assert.strictEqual(hook.isSelfEdit('grok', 'PostToolUse', { toolInput: { file_path: `${r}/.kala/state.yaml` } }), true);
  assert.strictEqual(hook.isSelfEdit('grok', 'PostToolUse', { toolInput: { file_path: `${r}/src/app.ts` } }), false);

  const curPost = hook.formatVendorOutput('cursor', 'PostToolUse', { shouldNudge: true, editsSinceCheckpoint: 5 });
  assert.ok(typeof curPost.additional_context === 'string' && curPost.additional_context.includes('[kalaga]'));
  const curStop = hook.formatVendorOutput('cursor', 'Stop', { shouldNudge: true, editsSinceCheckpoint: 2 });
  assert.ok(typeof curStop.followup_message === 'string' && curStop.followup_message.includes('[kalaga]'));

  const grokPost = hook.formatVendorOutput('grok', 'PostToolUse', { shouldNudge: true, editsSinceCheckpoint: 5 }) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.strictEqual(grokPost.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.ok(grokPost.hookSpecificOutput.additionalContext.includes('[kalaga]'));
  const grokStop = hook.formatVendorOutput('grok', 'Stop', { shouldNudge: true, editsSinceCheckpoint: 1 });
  assert.strictEqual(grokStop.decision, 'block');

  // Re-entry and teardown Stop guards for Cursor & Grok
  const st = fs.statSync(path.join(r, '.kala', 'state.yaml'));
  hook.saveHookState(r, { editsSinceCheckpoint: 2, lastNudgeAt: null, lastStateMtimeMs: st.mtimeMs, lastStateSize: st.size, lastToolUseId: null });
  assert.strictEqual(hook.evaluateHook({ agent: 'cursor', event: 'Stop', repoDir: r, payload: { stop_hook_active: false, loop_count: 0 } }).shouldNudge, true);
  assert.strictEqual(hook.evaluateHook({ agent: 'cursor', event: 'Stop', repoDir: r, payload: { stop_hook_active: false, loop_count: 1 } }).shouldNudge, false);
  assert.strictEqual(hook.evaluateHook({ agent: 'cursor', event: 'Stop', repoDir: r, payload: { status: 'aborted' } }).shouldNudge, false);
  assert.strictEqual(hook.evaluateHook({ agent: 'grok', event: 'Stop', repoDir: r, payload: { reason: 'end_turn', stopHookActive: false } }).shouldNudge, true);
  assert.strictEqual(hook.evaluateHook({ agent: 'grok', event: 'Stop', repoDir: r, payload: { reason: 'shutdown', stopHookActive: false } }).shouldNudge, false);
  assert.strictEqual(hook.evaluateHook({ agent: 'grok', event: 'Stop', repoDir: r, payload: { reason: 'channel_closed', stopHookActive: false } }).shouldNudge, false);
  assert.strictEqual(hook.evaluateHook({ agent: 'grok', event: 'Stop', repoDir: r, payload: { reason: 'end_turn', stopHookActive: true } }).shouldNudge, false);
  assert.strictEqual(hook.evaluateHook({ agent: 'grok', event: 'Stop', repoDir: r, payload: { reason: 'end_turn', subagentType: 'explore' } }).shouldNudge, false);

  // Install claude, cursor, and grok hooks together and test overlap + tool_use_id dedup
  hooks.installHooks(r, { agents: ['claude', 'cursor', 'grok'] });
  const customCfg = { enabled: true, edit_threshold: 5, max_age_minutes: 10, cooldown_minutes: 3, timeout_seconds: 5 };
  hook.saveHookState(r, { editsSinceCheckpoint: 0, lastNudgeAt: null, lastStateMtimeMs: st.mtimeMs, lastStateSize: st.size, lastToolUseId: null });

  // 1) Cursor handles tool id "t-1"; compat Claude hook with cursor_version must no-op (no double count)
  const c1 = hook.evaluateHook({ agent: 'cursor', event: 'PostToolUse', repoDir: r, payload: { cursor_version: '2026.11.22', tool_use_id: 't-1', tool_input: { file_path: 'src/a.ts' } }, config: customCfg });
  assert.strictEqual(c1.editsSinceCheckpoint, 1);
  const cOverlap = hook.evaluateHook({ agent: 'claude', event: 'PostToolUse', repoDir: r, payload: { cursor_version: '2026.11.22', tool_use_id: 't-1', tool_input: { file_path: 'src/a.ts' } }, config: customCfg });
  assert.strictEqual(cOverlap.shouldNudge, false);
  assert.strictEqual(hook.loadHookState(r)?.editsSinceCheckpoint, 1);

  // 2) Grok handles tool id "g-1"; compat Claude/Cursor hook with GROK_HOOK_EVENT must no-op
  const g1 = hook.evaluateHook({ agent: 'grok', event: 'PostToolUse', repoDir: r, payload: { toolUseId: 'g-1', toolInput: { file_path: 'src/b.ts' } }, config: customCfg, env: { GROK_HOOK_EVENT: 'post_tool_use' } });
  assert.strictEqual(g1.editsSinceCheckpoint, 2);
  const gOverlap = hook.evaluateHook({ agent: 'claude', event: 'PostToolUse', repoDir: r, payload: { tool_use_id: 'g-1', tool_input: { file_path: 'src/b.ts' } }, config: customCfg, env: { GROK_HOOK_EVENT: 'post_tool_use' } });
  assert.strictEqual(gOverlap.shouldNudge, false);
  assert.strictEqual(hook.loadHookState(r)?.editsSinceCheckpoint, 2);

  // 3) Direct duplicate tool_use_id to same agent does not double-increment
  const gDup = hook.evaluateHook({ agent: 'grok', event: 'PostToolUse', repoDir: r, payload: { toolUseId: 'g-1', toolInput: { file_path: 'src/b.ts' } }, config: customCfg, env: { GROK_HOOK_EVENT: 'post_tool_use' } });
  assert.strictEqual(gDup.editsSinceCheckpoint, 2);
});

console.log(`\n${fail ? `\x1b[31m${fail} failed\x1b[0m, ` : ''}${pass} passed`);
fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
