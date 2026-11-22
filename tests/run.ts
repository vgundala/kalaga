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

section('sanitize / inject (P2/P3)');
await test('strips C0 controls + DEL, keeps \\n \\t', () => {
  assert.strictEqual(sanitizeHandoffField('a\x00b\x08c\x07f\x09g\nh\x1fi\x7f', 100), 'abcf\tg\nhi');
});
await test('truncates with … at cap', () => {
  const out = sanitizeHandoffField('x'.repeat(600), 500);
  assert.strictEqual(out.length, 500); assert.ok(out.endsWith('…'));
});
await test('default inject hides goal (pointer + next only)', () => {
  const s = state.blankState('/tmp/x', null);
  s.goal = 'SECRET'; s.next_step = 'do it'; s.owner = 'claude';
  const inj = handoffInject(s, false);
  assert.ok(inj.includes('Read .kala/state.yaml') && inj.includes('do it') && !inj.includes('SECRET'));
});
await test('rich inject includes goal', () => {
  const s = state.blankState('/tmp/x', null); s.goal = 'SECRET';
  assert.ok(handoffInject(s, true).includes('SECRET'));
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

section('safe state I/O (S1–S4)');
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

console.log(`\n${fail ? `\x1b[31m${fail} failed\x1b[0m, ` : ''}${pass} passed`);
fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
