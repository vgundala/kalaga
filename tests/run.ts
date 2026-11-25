// OPS-001 O5 — durable, dependency-free test suite.
// Run: `npm test` or `node tests/run.ts`. No network; fixtures live in a
// throwaway dir under os.tmpdir(), removed on exit. Never touches the real
// ~/.claude or ~/.kala (HOME + KALA_HOME are redirected for the run).
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
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
await test('picker: Claude row + note show folder-trust caveat', async () => {
  const chunks: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, enc?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void) => {
    chunks.push(String(chunk));
    if (typeof enc === 'function') enc(null);
    else if (typeof cb === 'function') cb(null);
    return true;
  }) as typeof process.stderr.write;
  try {
    const p = picker.pick(
      [
        { agent: 'cursor', reason: 'unused this window', score: 2 },
        { agent: 'claude', reason: 'unused this window', score: 1 },
      ],
      [
        { agent: 'cursor', installed: true, tokens: 0, exact: false, ceiling: 100, remaining: 100, lastUsed: null, sessionHint: null },
        { agent: 'claude', installed: true, tokens: 0, exact: true, ceiling: 100, remaining: 100, lastUsed: null, sessionHint: null },
      ],
      null,
    );
    process.stdin.push('q\n');
    await p;
    const out = chunks.join('');
    assert.match(out, /Claude folder trust is Claude's, not Kalaga's/);
    assert.match(out, /trust this folder\?/);
    const cursorLine = out.split('\n').find((l) => l.includes('[1] cursor'));
    assert.ok(cursorLine && !cursorLine.includes('Claude folder trust'));
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
    sessionId: '01a20f1b-2c82-7242-a891-34fe425d231e',
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

console.log(`\n${fail ? `\x1b[31m${fail} failed\x1b[0m, ` : ''}${pass} passed`);
fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
