#!/usr/bin/env node
// kala — one CLI across agy / cursor / grok / claude.
//
// Commands:
//   kala                      pick an installed agent and start
//   kala status               per-agent headroom + handoff state summary
//   kala why                  show the taker ranking the picker would show
//   kala run <agent>          launch the agent (full TTY); on exit, classify
//                             and maybe hand off
//   kala recover              back at the shell after a limit hit
//   kala switch <agent>       hand off to <agent> now
//   kala resume [agent]       reopen a captured session
//   kala state [field [text]] edit the handoff state, or print a field
//   kala init [--force]       create .kala/state.yaml from git facts
//   kala --version            print the package version
//
// Loose coupling: the app name appears in the bin shim + this file only.
// Agents are addressed by key everywhere else.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { agentFor, isInstalled, resolveExecutable, stateFile } from './config.ts';
import type { AgentConfig } from './config.ts';
import { readLedger } from './ledger.ts';
import { loadState, mergeState, blankState, saveState, captureSession, isThinState } from './state/state.ts';
import type { HandoffState } from './state/state.ts';
import { currentBranch, modifiedFiles, gitSummary, resolveRepoDir } from './state/git.ts';
import { rankTakers, isFresh } from './router.ts';
import { pick } from './picker.ts';
import { runAgent, lastSessionText, normalizeSessionId, resumeAgent, sessionFresh } from './launch.ts';
import { sessionHintFor } from './ledger.ts';
import { scanChunk, classifyExit } from './trap.ts';
import { hasTrustGrant, promptTrustGrant, trustStatus, revokeTrust } from './trust.ts';
import { handoffInject, nextStepHint, injectRichPrompt, STANDING_ORDERS, FIELD_MAX, sanitizeHandoffField } from './prompt.ts';
import { liveAskAndMerge, shouldSkipLiveAsk } from './liveask.ts';
import { readSingleKeyOrLine } from './util/ttyask.ts';
import { parseCliArgs } from './util/cliargs.ts';

let repoDir = process.cwd();
let activeFlags = new Set<string>();
const MAX_HANDOFF_HOPS = 8;

function fmt(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n); }

function show(s: string, max: number): string {
  return sanitizeHandoffField(s, max);
}

function activeStatusPatch(s: HandoffState | null): Partial<HandoffState> {
  return s?.status === 'BLOCKED' ? { status: 'IN_PROGRESS' } : {};
}

interface LaunchResult { agent: string; exitCode: number }

async function printStatus(): Promise<void> {
  const ledger = await readLedger(repoDir);
  const state = loadState(repoDir);
  const branch = show(currentBranch(repoDir) ?? '', 200);
  console.log(`kalaga · ${show(path.basename(repoDir), 200)}${branch ? ` · ${branch}` : ''}`);
  console.log('');
  for (const u of ledger) {
    const warn = u.remaining <= 15000 && u.tokens > 0 ? ' ⚠' : '';
    const acc = u.exact ? 'logged' : 'est.';
    const owner = state?.owner === u.agent ? ' · owns handoff' : '';
    const fresh = isFresh(u) ? 'ok' : (u.tokens === 0 ? '?' : 'low');
    console.log(`  ${u.agent.padEnd(8)} ${fmt(u.tokens).padStart(8)}/${fmt(u.ceiling)}  ${fmt(u.remaining).padStart(7)} left  [${acc}] ${fresh}${warn}${owner}`);
  }
  if (state) {
    const status = show(state.status, 40);
    const updated = show(state.updated, 40).slice(0, 16).replace('T', ' ');
    const goal = show(state.goal, 1000);
    const done0 = state.done?.[0] ? show(state.done[0], 300) : '';
    const next = show(state.next_step, 500);
    console.log('');
    console.log(`  handoff: ${status} · owner=${state.owner ?? '—'} · ${state.modified_files.length} files · updated ${updated}`);
    console.log(`  goal: ${goal.slice(0, 80)}${goal.length > 80 ? '…' : ''}`);
    const d0 = done0 ? ` — ${done0.slice(0, 60)}${done0.length > 60 ? '…' : ''}` : '';
    console.log(`  done: ${state.done?.length ? `${state.done.length}${d0}` : '—'}`);
    console.log(`  next: ${next.slice(0, 80)}`);
  } else {
    console.log('');
    console.log('  no handoff state — run: kala init');
  }
}

async function printWhy(dead: string | null): Promise<void> {
  const ledger = await readLedger(repoDir);
  const state = loadState(repoDir);
  const recs = rankTakers(ledger, dead, state?.owner ?? null);
  console.log(`kalaga would rank takers (dead=${dead ?? 'none'}):`);
  recs.forEach((r, i) => {
    const u = ledger.find((x) => x.agent === r.agent)!;
    const caveat = r.agent === 'claude' ? ' · Claude folder trust is Claude\'s, not Kalaga\'s' : '';
    console.log(`  ${i === 0 ? '*' : ' '} [${i + 1}] ${r.agent.padEnd(8)} ${fmt(u.remaining).padStart(7)} left · ${r.reason}${caveat}`);
  });
}

/** Persist the agent's current session id (if discoverable) into state.
 *  Never invents ids; best-effort, never fatal. */
async function captureFor(agentKey: string): Promise<void> {
  try {
    const cfg = agentFor(agentKey);
    const hint = await sessionHintFor(cfg, repoDir);
    if (!hint) return;
    const id = normalizeSessionId(cfg, hint);
    if (id) captureSession(repoDir, agentKey, id);
  } catch { /* capture is best-effort */ }
}

/** Refresh the warm state from git facts + the agent's own session tail. */
async function refreshState(deadKey: string | null): Promise<HandoffState> {
  let text = '';
  let hit: ReturnType<typeof scanChunk> = null;
  if (deadKey) {
    const cfg = agentFor(deadKey);
    text = await lastSessionText(cfg, repoDir);
    hit = scanChunk(text.slice(-4000), cfg, null);
    if (hit) console.error(`  kalaga: limit hit — ${deadKey} (matched "${hit.matched}")`);
  }
  const cur = loadState(repoDir) ?? blankState(repoDir, currentBranch(repoDir));
  const limitNote = hit && deadKey ? `${deadKey} limit hit: ${hit.line}`.slice(0, 200) : null;
  if (deadKey) await captureFor(deadKey);
  return mergeState(repoDir, {
    modified_files: modifiedFiles(repoDir),
    branch: currentBranch(repoDir),
    status: deadKey ? 'BLOCKED' : cur.status,
    notes: cur.notes || gitSummary(repoDir),
    ...(limitNote && !cur.negative_constraints.includes(limitNote)
      ? { negative_constraints: [...cur.negative_constraints, limitNote] }
      : {}),
  }, 'tailer');
}

/** Resolve whether to pass trust flags for this launch.
 *  A trust-capable agent with no grant prompts once. Agents with no
 *  trust flags are never "trusted" (nothing to pass). */
async function resolveTrust(agent: AgentConfig): Promise<boolean> {
  if (!agent.trustFlags.length) return false;
  return promptTrustGrant(repoDir);
}

async function offerHandoff(deadKey: string | null): Promise<LaunchResult | null> {
  await refreshState(deadKey);
  // A limit exit means that agent is exhausted. Do not live-ask it.
  const state = loadState(repoDir) ?? blankState(repoDir, null);
  const ledger = await readLedger(repoDir);
  const recs = rankTakers(ledger, deadKey, state.owner ?? null);
  if (!recs.length) { console.error('kalaga: no agents to take over.'); return null; }
  console.error(`  ${nextStepHint(state)}`);
  const choice = await pick(recs, ledger, deadKey);
  if (choice.stay) { console.error('kalaga: staying put — nothing launched.'); return null; }
  if (choice.wait) {
    const st = loadState(repoDir);
    const rec = deadKey ? st?.sessions?.[deadKey] : undefined;
    if (deadKey && rec?.id && (await sessionFresh(agentFor(deadKey), repoDir, rec))) {
      console.error(`kalaga: when the window resets → kala resume ${deadKey}`);
    } else {
      console.error(`kalaga: staying put — will reset; rerun kala run ${deadKey} later.`);
    }
    return null;
  }
  const next = agentFor(choice.agent);
  if (choice.agent !== deadKey && choice.agent !== state.owner && isThinState(state)) {
    console.error('kalaga: handoff state looks thin — taker may drift. Run live-ask, or: kala state …');
  }
  const fromOwner = state.owner ?? deadKey ?? null;
  console.error(`kalaga: writing handoff state…`);
  const st = mergeState(repoDir, { owner: next.key, ...activeStatusPatch(state) }, 'tailer');
  const trust = await resolveTrust(next);
  console.error(`kalaga → launching ${next.key} now`);
  const exitCode = await runAgent(next, repoDir, handoffInject(st, injectRichPrompt(), fromOwner), trust);
  return { agent: next.key, exitCode };
}

/** One-line stderr notice of how the agent exited. */
function exitNotice(agentKey: string, exitCode: number, hit: ReturnType<typeof scanChunk>, hasTail: boolean): void {
  if (hit) console.error(`  kalaga: limit hit — ${agentKey} (matched "${hit.matched}")`);
  else if (!hasTail && exitCode !== 0) console.error(`  kalaga: ${agentKey} exited (code ${exitCode}) — no session log to scan`);
  else if (exitCode !== 0) console.error(`  kalaga: ${agentKey} exited (code ${exitCode}) — no limit signature in log.`);
  else console.error(`  kalaga: ${agentKey} exited cleanly (code 0).`);
}

/** `--assume-limit` gate. On a TTY the flag alone suffices. Off-TTY the flag
 *  is ignored unless KALA_ASSUME_LIMIT=1. */
function assumeLimitFlagged(): boolean {
  if (!activeFlags.has('--assume-limit')) return false;
  if (process.stdin.isTTY) return true;
  return process.env.KALA_ASSUME_LIMIT === '1';
}

async function confirmAssumeLimit(deadKey: string, exitCode: number): Promise<boolean> {
  if (assumeLimitFlagged()) return true;
  if (!process.stdin.isTTY) return false;
  process.stderr.write(`  assume it hit its limit? [y/N] `);
  const ans = await readSingleKeyOrLine();
  const ok = ans.trim().toLowerCase() === 'y';
  if (ok) console.error(`  kalaga: limit hit assumed — ${deadKey} (code ${exitCode}, no store to verify)`);
  return ok;
}

/** Shared post-exit flow. `hop` counts handoffs already taken so a loop of
 *  limit hits cannot recurse forever. At the cap we still capture the
 *  session and refresh git facts. */
async function afterExit(agentKey: string, exitCode: number, hop = 0): Promise<void> {
  await captureFor(agentKey);
  if (hop >= MAX_HANDOFF_HOPS) {
    await refreshState(null);
    console.error('kalaga: handoff hop limit reached — back to your shell.');
    return;
  }
  const cfg = agentFor(agentKey);
  const tail = (await lastSessionText(cfg, repoDir)).slice(-4000);
  const hit = tail ? scanChunk(tail, cfg, exitCode) : null;
  if (exitCode === 127 && !hit) {
    await refreshState(null);
    return;
  }
  const hasTail = tail !== '' && !(cfg.metadataOnlyStore && !hit) && !(assumeLimitFlagged() && !hit);
  const tier = classifyExit({ hit, exitCode, hasTail });
  exitNotice(agentKey, exitCode, hit, hasTail);

  if (tier === 'limit') {
    const launched = await offerHandoff(agentKey);
    if (launched) await afterExit(launched.agent, launched.exitCode, hop + 1);
    return;
  }
  if (tier === 'suspect') {
    if (await confirmAssumeLimit(agentKey, exitCode)) {
      const launched = await offerHandoff(agentKey);
      if (launched) await afterExit(launched.agent, launched.exitCode, hop + 1);
    } else await refreshState(null);
    return;
  }
  const st = await refreshState(null);
  const ledger = await readLedger(repoDir);
  // Prefer someone else. If this agent is the only one installed, fall back
  // to offering it again.
  let recs = rankTakers(ledger, agentKey, st.owner ?? null);
  if (!recs.length) recs = rankTakers(ledger, null, st.owner ?? null);
  if (!recs.length) { console.error('kalaga: nothing else to hand off to — back to your shell.'); return; }
  const choice = await pick(recs, ledger, null, {
    stayDefault: true,
    header: `  hand off, or stay?`,
  });
  if (choice.stay) { console.error('kalaga: staying put — nothing launched.'); return; }
  const next = agentFor(choice.agent);
  if (choice.agent !== st.owner && isThinState(st)) {
    console.error('kalaga: handoff state looks thin — taker may drift. Run live-ask, or: kala state …');
  }
  const fromOwner = st.owner;
  console.error(`kalaga: writing handoff state…`);
  const st2 = mergeState(repoDir, { owner: next.key, ...activeStatusPatch(st) });
  console.error(`  ${nextStepHint(st2)}`);
  const trust = await resolveTrust(next);
  console.error(`kalaga → launching ${next.key} now`);
  const code = await runAgent(next, repoDir, handoffInject(st2, injectRichPrompt(), fromOwner), trust);
  await afterExit(next.key, code, hop + 1);
}

async function doStart(): Promise<void> {
  // Do not create .kala/state.yaml until the user actually picks an agent.
  const ledger = await readLedger(repoDir);
  const existing = loadState(repoDir);
  const installed = ledger.filter((u) => u.installed);
  if (!installed.length) {
    console.error('kalaga: no agent CLIs found on this machine (looked for agy, cursor-agent, grok, claude on PATH)');
    return;
  }
  const recs = rankTakers(ledger, null, existing?.owner ?? null);
  if (!recs.length) {
    console.error('kalaga: installed agents have no headroom — wait for a reset, or: kala why');
    return;
  }
  const choice = await pick(recs, ledger, null);
  if (choice.stay) { console.error('kalaga: staying put — nothing launched.'); return; }
  const next = agentFor(choice.agent);
  const fromOwner = existing?.owner ?? null;
  console.error(`kalaga: refreshing handoff state…`);
  const pre = await refreshState(null);
  const st = mergeState(repoDir, {
    owner: next.key,
    ...activeStatusPatch(pre),
    modified_files: modifiedFiles(repoDir),
    branch: currentBranch(repoDir),
    notes: pre.notes || gitSummary(repoDir),
  });
  const fresh = st.goal.startsWith('not captured');
  const trust = await resolveTrust(next);
  console.error(`kalaga → launching ${next.key} now`);
  if (fresh) console.error(`kalaga: ${STANDING_ORDERS} Set goal + next_step (kala state goal "…" / kala state next "…").`);
  const prompt = fresh
    ? (existing ? `${STANDING_ORDERS} Set goal + next_step (kala state goal "…" / kala state next "…").` : null)
    : handoffInject(st, injectRichPrompt(), fromOwner);
  const exitCode = await runAgent(next, repoDir, prompt, trust);
  await afterExit(next.key, exitCode, 0);
}

async function doRun(agentKey: string): Promise<void> {
  const agent = agentFor(agentKey);
  if (!resolveExecutable(agent.interactive[0])) {
    console.error(`kalaga: ${agent.key} binary not found (looked for '${agent.interactive[0]}') — install it or check PATH`);
    process.exitCode = 1;
    return;
  }
  const existed = loadState(repoDir);
  const pre = await refreshState(null);
  const fromOwner = existed?.owner ?? null;
  const owned = mergeState(repoDir, { owner: agent.key, ...activeStatusPatch(pre) });
  const trust = await resolveTrust(agent);
  const cold = owned.goal.startsWith('not captured');
  if (cold) console.error(`kalaga: ${STANDING_ORDERS} Set goal + next_step (kala state goal "…" / kala state next "…").`);
  const prompt = cold
    ? (existed ? `${STANDING_ORDERS} Set goal + next_step (kala state goal "…" / kala state next "…").` : null)
    : handoffInject(owned, injectRichPrompt(), fromOwner);
  const exitCode = await runAgent(agent, repoDir, prompt, trust);
  await afterExit(agent.key, exitCode, 0);
}

async function doRecover(): Promise<void> {
  const state = loadState(repoDir);
  const ledger = await readLedger(repoDir);
  let dead: string | null = null;
  if (state?.owner) dead = state.owner;
  if (!dead) {
    const withUsage = ledger.filter((u) => u.lastUsed).sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
    if (withUsage[0]) dead = withUsage[0].agent;
  }
  if (!dead) { console.error('kalaga: no recent agent session found here — nothing to recover.'); return; }
  const cfg = agentFor(dead);
  const tail = (await lastSessionText(cfg, repoDir)).slice(-4000);
  const hit = tail ? scanChunk(tail, cfg, null) : null;
  if (hit) {
    // verified limit hit — proceed to offerHandoff
  } else if (assumeLimitFlagged()) {
    console.error(`  kalaga: limit hit assumed — ${dead} (--assume-limit)`);
  } else if (!tail || cfg.metadataOnlyStore) {
    let ok = false;
    if (process.stdin.isTTY) {
      process.stderr.write(`  no verifiable session log for ${dead} — assume it hit its limit? [y/N] `);
      ok = (await readSingleKeyOrLine()).trim().toLowerCase() === 'y';
    }
    if (!ok) { console.error('kalaga: not assuming a limit hit — rerun with --assume-limit or confirm.'); return; }
    console.error(`  kalaga: limit hit assumed — ${dead} (no verifiable log)`);
  } else {
    console.error(`kalaga: ${dead} has no limit signature in its recent log — recover only after a limit hit.`);
    console.error('  (if it really did hit a limit, rerun with: kala recover --assume-limit)');
    return;
  }
  const launched = await offerHandoff(dead);
  if (launched) await afterExit(launched.agent, launched.exitCode, 1);
}

async function doSwitch(agentKey: string): Promise<void> {
  const agent = agentFor(agentKey);
  const pre = await refreshState(null);
  const prev = pre.owner ?? Object.keys(pre.sessions).sort((a, b) =>
    (pre.sessions[b]?.at ?? '').localeCompare(pre.sessions[a]?.at ?? ''))[0] ?? null;
  const prevRec = prev ? pre.sessions[prev] : undefined;
  if (
    prev && prev !== agentKey && isInstalled(agentFor(prev)) &&
    prevRec?.id && await sessionFresh(agentFor(prev), repoDir, prevRec)
  ) {
    const skipCheck = shouldSkipLiveAsk(repoDir, pre);
    if (skipCheck.skip) {
      console.error('  kalaga: skipping live-ask — .kala/state.yaml already checkpointed by hooks');
    } else {
      await liveAskAndMerge(agentFor(prev), repoDir, undefined, prevRec.id, hasTrustGrant(repoDir));
    }
  }
  const after = loadState(repoDir) ?? pre;
  if (isThinState(after)) {
    if (activeFlags.has('--strict-state')) {
      console.error('kalaga: state is thin and --strict-state was set — refusing to switch. Enrich first: kala state …');
      return;
    }
    console.error('kalaga: handoff state looks thin — taker may drift. Run live-ask, or: kala state …');
  }
  if (!resolveExecutable(agent.interactive[0])) {
    console.error(`kalaga: ${agent.key} binary not found (looked for '${agent.interactive[0]}') — install it or check PATH`);
    process.exitCode = 1;
    return;
  }
  const fromOwner = pre.owner;
  const owned = mergeState(repoDir, { owner: agent.key, ...activeStatusPatch(after) });
  const trust = await resolveTrust(agent);
  const exitCode = await runAgent(agent, repoDir, handoffInject(owned, injectRichPrompt(), fromOwner), trust);
  await afterExit(agent.key, exitCode, 1);
}

async function doResume(agentKey: string | null): Promise<void> {
  const state = loadState(repoDir);
  const key = agentKey ?? state?.owner ?? null;
  if (!key) {
    console.error('kalaga: no agent given and no owner in handoff state — usage: kala resume <agent>');
    return;
  }
  const agent = agentFor(key);
  const rec = state?.sessions?.[key];
  if (!rec?.id) {
    console.error(`kalaga: no captured session for ${key} — run it via kala first (kala run ${key})`);
    return;
  }
  if (!(await sessionFresh(agent, repoDir, rec))) {
    console.error(`kalaga: captured session for ${key} is stale (>7 days or artifact gone) — start fresh: kala run ${key}`);
    return;
  }
  if (!resolveExecutable(agent.interactive[0])) {
    console.error(`kalaga: ${agent.key} binary not found (looked for '${agent.interactive[0]}') — install it or check PATH`);
    process.exitCode = 1;
    return;
  }
  mergeState(repoDir, { owner: agent.key, ...activeStatusPatch(state) });
  const trust = await resolveTrust(agent);
  const exitCode = await resumeAgent(agent, repoDir, rec.id, trust);
  await afterExit(agent.key, exitCode, 0);
}

function doState(sub: string | null, text: string): void {
  const s = loadState(repoDir) ?? blankState(repoDir, currentBranch(repoDir));
  if (!sub) { console.log(JSON.stringify(s, null, 2)); return; }
  const value = text.trim();
  if (!value && (sub === 'goal' || sub === 'next' || sub === 'note' || sub === 'done' || sub === 'neg')) {
    const cur = sub === 'goal' ? s.goal
      : sub === 'next' ? s.next_step
      : sub === 'note' ? s.notes
      : sub === 'done' ? s.done.join('\n')
      : s.negative_constraints.join('\n');
    console.log(cur);
    return;
  }
  switch (sub) {
    case 'goal': mergeState(repoDir, { goal: text }, 'manual'); break;
    case 'next': mergeState(repoDir, { next_step: text }, 'manual'); break;
    case 'note': mergeState(repoDir, { notes: text }, 'manual'); break;
    case 'neg': mergeState(repoDir, { negative_constraints: [...s.negative_constraints, text] }, 'manual'); break;
    case 'done': {
      const next = [...s.done, text].slice(-FIELD_MAX.doneItems);
      mergeState(repoDir, { done: next }, 'manual'); break;
    }
    default: console.error(`unknown state subcommand: ${sub}`); process.exit(1);
  }
  console.error(`kalaga: state updated (${sub})`);
}

function doInit(force: boolean): void {
  const f = stateFile(repoDir);
  if (!force && fs.existsSync(f)) {
    let linked = false;
    try { linked = fs.lstatSync(f).isSymbolicLink(); } catch { linked = false; }
    if (!linked) {
      console.error('kalaga: .kala/state.yaml already exists (pass --force to reset)');
      return;
    }
  }
  const branch = currentBranch(repoDir);
  const s = blankState(repoDir, branch);
  s.modified_files = modifiedFiles(repoDir);
  s.notes = gitSummary(repoDir);
  saveState(repoDir, s);
  console.error(`kalaga: .kala/state.yaml created (branch=${branch ?? '—'}, ${s.modified_files.length} files)`);
}

function doTrust(args: string[]): void {
  const sub = args[0];
  if (sub === 'revoke') {
    const all = activeFlags.has('--all');
    revokeTrust(all ? null : (args[1] ?? null), all);
    console.error(all ? 'kalaga: all trust grants revoked' : `kalaga: trust revoked for ${args[1] ?? '(current dir)'}`);
    return;
  }
  const grants = trustStatus();
  if (!grants.length) { console.log('no trust grants — first cold launch of a trust-capable agent will ask'); return; }
  for (const g of grants) console.log(`${g.path}  (${g.granted_at.slice(0, 10)} → ${g.expires_at.slice(0, 10)})`);
}

function printVersion(): void {
  const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
  console.log(pkg.version ?? '0.0.0');
}

function printHelp(): void {
  console.log(`kalaga — local handoff across agy / cursor / grok / claude

  kala                      pick an installed agent and start
  kala init [--force]       create .kala/state.yaml (no overwrite unless --force)
  kala status               headroom per agent + handoff state
  kala run <agent>          interactive session; on exit, offer a handoff
  kala recover              trap after a limit (even if launched outside kala)
  kala switch <agent>       hand off to <agent> now
  kala resume [agent]       reopen a captured session by id (default: owner)
  kala why [deadAgent]      dry-run taker ranking
  kala trust [status|revoke <path>|revoke --all]
  kala state                print the handoff state as JSON
  kala state goal|next|note|neg|done [text]
                            set that field, or print it when text is omitted
  kala hooks install [--agents claude,agy,cursor,grok]
                            install/merge checkpoint hooks in this repo
  kala hooks status         show installed hooks + last checkpoint age
  kala hooks uninstall      remove Kalaga hooks (preserve user hooks)
  kala agents               list known agent keys
  kala --version            print version

  Flags (before or after the command):
    -v, --version           print version
    --assume-limit          on a TTY, treat a store-less exit as a limit hit
    --strict-state          kala switch refuses while the handoff state is thin
    --force                 kala init replaces an existing state file
    --agents <list>         comma-separated hook agents (claude,agy,cursor,grok)

  Headroom for Claude and Grok is labeled [logged] (what the local store
  recorded). Cursor is [est.]. agy tokens stay unset; session ids come from
  ~/.gemini/antigravity-cli when present (resume / live-ask).

  Requires Node ≥ 22.18 (LTS 22 / 24 / 26). Docs: README.md · SECURITY.md`);
}

async function main(): Promise<void> {
  const raw = process.argv.slice(2);
  if (raw[0] === '_hook') {
    const { runHookCli } = await import('./hook.ts');
    await runHookCli(raw.slice(1));
    return;
  }
  const parsed = parseCliArgs(raw);
  if (parsed.action === 'version') { printVersion(); return; }
  if (parsed.action === 'help') { printHelp(); return; }
  if (parsed.action === 'error') {
    printHelp();
    process.exitCode = 2;
    return;
  }
  activeFlags = parsed.flags;
  const { positionals, flagValues } = parsed;
  repoDir = resolveRepoDir();
  const [cmd, ...rest] = positionals;
  if (cmd !== '_hook' && (flagValues.has('--agent') || flagValues.has('--event'))) {
    printHelp();
    process.exitCode = 2;
    return;
  }
  if (cmd !== 'hooks' && flagValues.has('--agents')) {
    printHelp();
    process.exitCode = 2;
    return;
  }
  switch (cmd) {
    case '_hook': {
      const { runHookCli } = await import('./hook.ts');
      const hookArgs: string[] = [];
      const ag = flagValues.get('--agent');
      const ev = flagValues.get('--event');
      if (ag !== undefined) hookArgs.push('--agent', ag);
      if (ev !== undefined) hookArgs.push('--event', ev);
      await runHookCli(hookArgs);
      break;
    }
    case 'hooks': {
      const { runHooksCli } = await import('./hooks.ts');
      runHooksCli(rest[0], repoDir, { agents: flagValues.get('--agents') });
      break;
    }
    case 'status': await printStatus(); break;
    case 'why': await printWhy(rest[0] ?? null); break;
    case 'run': if (!rest[0]) throw new Error('usage: kala run <agent>'); await doRun(rest[0]); break;
    case 'recover': await doRecover(); break;
    case 'switch': if (!rest[0]) throw new Error('usage: kala switch <agent>'); await doSwitch(rest[0]); break;
    case 'resume': await doResume(rest[0] ?? null); break;
    case 'state': doState(rest[0] ?? null, rest.slice(1).join(' ')); break;
    case 'trust': doTrust(rest); break;
    case 'init': doInit(activeFlags.has('--force')); break;
    case 'agents': {
      const ledger = await readLedger(repoDir);
      console.log(ledger.map((u) => `${u.agent}${u.installed ? '' : ' (not installed)'}`).join(' '));
      break;
    }
    case 'help':
      printHelp();
      break;
    case undefined:
      await doStart();
      break;
    default:
      printHelp();
      process.exitCode = 2;
  }
}

main().catch((e) => { console.error(`kalaga: ${e.message}`); process.exit(1); });
