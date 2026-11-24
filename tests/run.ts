// OPS-001 O5 — durable, dependency-free test suite.
// Run: `npm test` or `node tests/run.ts`. No network; fixtures live in a
// throwaway dir under os.tmpdir(), removed on exit. Never touches the real
// ~/.claude or ~/.kala (HOME + KALA_HOME are redirected for the run).
import assert from 'node:assert';
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

console.log(`\n${fail ? `\x1b[31m${fail} failed\x1b[0m, ` : ''}${pass} passed`);
fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
