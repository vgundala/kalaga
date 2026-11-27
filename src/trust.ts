// SEC-001 T1–T3: path-scoped trust grants for handoff launches.
//
// A grant means: "the user explicitly said it's fine to launch a
// trust-capable agent in this exact directory". It is recorded once
// (Option A prompt at cold start) and reused by later handoffs, so a
// hostile clone of a project never gets silent --trust on a cold start.
//
// Store: $KALA_HOME/trust.yaml — one grant per realpath:
//   grants:
//     - path: /real/path
//       granted_at: "2026-11-21T17:00:00.000Z"
//       expires_at: "2026-12-21T17:00:00.000Z"
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ensureKalagaHome, kalagaHome } from './config.ts';
import { parseYamlScalar } from './util/yaml.ts';

export interface TrustGrant {
  path: string;         // fs.realpathSync of the repo dir
  granted_at: string;   // ISO
  expires_at: string;   // ISO
}

const DEFAULT_TTL_DAYS = 30;

function trustFile(): string {
  return path.join(kalagaHome(), 'trust.yaml');
}

/** TTL in days from config (M2/T9), default 30. */
export function trustTtlDays(): number {
  try {
    const raw = fs.readFileSync(path.join(kalagaHome(), 'config.yaml'), 'utf8');
    const m = raw.match(/^trust_ttl_days:\s*(\d+)/m);
    if (m) return parseInt(m[1], 10);
  } catch { /* no config */ }
  return DEFAULT_TTL_DAYS;
}

function readGrants(): TrustGrant[] {
  const f = trustFile();
  try {
    const st = fs.lstatSync(f);
    if (st.isSymbolicLink()) throw new Error(`refusing to read trust: ${f} is a symlink`);
    if (!st.isFile()) return [];
    const raw = fs.readFileSync(f, 'utf8');
    const grants: TrustGrant[] = [];
    let cur: Partial<TrustGrant> | null = null;
    for (const line of raw.split('\n')) {
      const item = line.match(/^\s*-\s*path:\s*(.+)$/);
      if (item) {
        if (cur) pushGrant(grants, cur);
        cur = { path: parseYamlScalar(item[1]) };
        continue;
      }
      const kv = line.match(/^\s{2,8}(granted_at|expires_at):\s*(.+)$/);
      if (kv && cur) {
        (cur as Record<string, string>)[kv[1]] = parseYamlScalar(kv[2]);
        continue;
      }
    }
    if (cur) pushGrant(grants, cur);
    return grants;
  } catch (e) {
    if (e instanceof Error && /symlink/.test(e.message)) throw e;
    return [];
  }
}

function pushGrant(grants: TrustGrant[], g: Partial<TrustGrant>): void {
  if (g.path && g.granted_at && g.expires_at) grants.push({ path: g.path, granted_at: g.granted_at, expires_at: g.expires_at });
}

function writeGrants(grants: TrustGrant[]): void {
  const dir = ensureKalagaHome();
  const f = trustFile();
  try {
    if (fs.lstatSync(f).isSymbolicLink()) throw new Error(`refusing to write trust: ${f} is a symlink`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  let out = '# kalaga trust grants — path-scoped, explicit first grant.\n';
  out += 'grants:\n';
  for (const g of grants) {
    out += `  - path: ${JSON.stringify(g.path)}\n`;
    out += `    granted_at: ${JSON.stringify(g.granted_at)}\n`;
    out += `    expires_at: ${JSON.stringify(g.expires_at)}\n`;
  }
  const tmp = path.join(dir, `.trust.yaml.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, out, { mode: 0o600, flag: 'wx' });
  try { fs.renameSync(tmp, f); }
  catch (e) { try { fs.unlinkSync(tmp); } catch { /* already gone */ } throw e; }
}

function isExpired(g: TrustGrant): boolean {
  return Date.now() > Date.parse(g.expires_at);
}

/** T2: valid (non-expired) grant for this exact realpath? */
export function hasTrustGrant(repoDir: string): boolean {
  let real: string;
  try { real = fs.realpathSync(repoDir); } catch { return false; }
  return readGrants().some((g) => g.path === real && !isExpired(g));
}

/** T3 + O6 (W1): record/refresh a grant for this realpath with the
 *  configured TTL. Prunes expired grants on the way back to disk so the
 *  store doesn't accumulate dead entries; `trust status` still shows
 *  expiries from the pre-write read. */
export function recordTrustGrant(repoDir: string): void {
  let real: string;
  try { real = fs.realpathSync(repoDir); } catch { throw new Error(`cannot resolve path for trust grant: ${repoDir}`); }
  const now = new Date();
  const expires = new Date(now.getTime() + trustTtlDays() * 86_400_000);
  const grants = readGrants().filter((g) => g.path !== real && !isExpired(g));
  grants.push({ path: real, granted_at: now.toISOString(), expires_at: expires.toISOString() });
  writeGrants(grants);
}

/** T8: `kala trust status` — list grants, mark expired. */
export function trustStatus(): TrustGrant[] {
  return readGrants().map((g) => ({ ...g, expires_at: isExpired(g) ? g.expires_at + ' (EXPIRED)' : g.expires_at }));
}

/** T8 + O6 (W1): `kala trust revoke [path]` or `--all`. Prunes expired
 *  grants on the write path, same as record. */
export function revokeTrust(target: string | null, all: boolean): void {
  let grants = readGrants().filter((g) => !isExpired(g));
  if (all) grants = [];
  else if (target) {
    let real: string;
    try { real = fs.realpathSync(target); } catch { real = target; }
    grants = grants.filter((g) => g.path !== real);
  } else {
    // no arg, no --all: revoke grants for the current dir
    let real: string;
    try { real = fs.realpathSync(process.cwd()); } catch { throw new Error('cannot resolve cwd for revoke'); }
    grants = grants.filter((g) => g.path !== real);
  }
  writeGrants(grants);
}

/** T6: Option A cold-start prompt. Returns true if the user granted.
 *  Non-TTY stdin (pipes/tests) → no prompt, no grant (safe default).
 *  Separate from the agent picker — answers y/n (one key on a TTY). */
export async function promptTrustGrant(repoDir: string): Promise<boolean> {
  if (hasTrustGrant(repoDir)) return true;
  if (!process.stdin.isTTY) return false;
  process.stderr.write(
    `Kalaga path trust (separate from the picker) — allow --trust flags in this directory? [y/N] `,
  );
  const { readSingleKeyOrLine } = await import('./util/ttyask.ts');
  const ans = await readSingleKeyOrLine();
  if (ans.trim().toLowerCase() === 'y') {
    recordTrustGrant(repoDir);
    process.stderr.write(`  trust recorded for ${fs.realpathSync(repoDir)} (TTL ${trustTtlDays()}d)\n`);
    return true;
  }
  process.stderr.write(`  skipped — launching without vendor --trust flags\n`);
  return false;
}
