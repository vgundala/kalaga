#!/usr/bin/env node
// kala — one CLI across agy / cursor / grok / claude.
//
// Commands:
//   kala status              per-agent headroom + handoff state summary
//   kala why                 show the taker ranking the picker would show
//   kala run <agent>         launch the agent (full TTY); on a limit hit,
//                            refresh the handoff state and offer the picker,
//                            then launch the choice — that's the whole loop
//   kala recover             you're back at the shell after a limit hit (even
//                            if the agent was launched directly, not via kala)
//   kala switch <agent>      hand off to <agent> now
//   kala state [goal|next|note|neg <text>]   edit the handoff state by hand
//   kala init                create .kala/state.yaml from git facts
//
// Loose coupling: the app name appears in the bin shim + this file only.
// Agents are addressed by key everywhere else.
import path from 'node:path';
import process from 'node:process';
import { loadAgents, agentFor, isInstalled } from './config.ts';
import type { AgentConfig } from './config.ts';
import { readLedger } from './ledger.ts';
import { loadState, mergeState, blankState, saveState, captureSession, isThinState } from './state/state.ts';
import type { HandoffState } from './state/state.ts';
import { currentBranch, modifiedFiles, gitSummary } from './state/git.ts';
import { rankTakers, isFresh } from './router.ts';
import { pick } from './picker.ts';
import { runAgent, lastSessionText, normalizeSessionId, resumeAgent, sessionFresh } from './launch.ts';
import { sessionHintFor } from './ledger.ts';
import { scanChunk, classifyExit } from './trap.ts';
import { promptTrustGrant, trustStatus, revokeTrust } from './trust.ts';
import { handoffInject, nextStepHint, injectRichPrompt, STANDING_ORDERS, FIELD_MAX } from './prompt.ts';
import { liveAskAndMerge } from './liveask.ts';

const repoDir = process.cwd();

function fmt(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n); }

async function printStatus(): Promise<void> {
  const ledger = await readLedger(repoDir);
  const state = loadState(repoDir);
  const branch = currentBranch(repoDir);
  console.log(`kalaga · ${path.basename(repoDir)}${branch ? ` · ${branch}` : ''}`);
  console.log('');
  for (const u of ledger) {
    const warn = u.remaining <= 15000 && u.tokens > 0 ? ' ⚠' : '';
    const acc = u.exact ? 'exact' : 'est.';
    const owner = state?.owner === u.agent ? ' · owns handoff' : '';
    const fresh = isFresh(u) ? 'ok' : (u.tokens === 0 ? '?' : 'low');
    console.log(`  ${u.agent.padEnd(8)} ${fmt(u.tokens).padStart(8)}/${fmt(u.ceiling)}  ${fmt(u.remaining).padStart(7)} left  [${acc}] ${fresh}${warn}${owner}`);
  }
  if (state) {
    console.log('');
    console.log(`  handoff: ${state.status} · owner=${state.owner ?? '—'} · ${state.modified_files.length} files · updated ${state.updated.slice(0, 16).replace('T', ' ')}`);
    console.log(`  goal: ${state.goal.slice(0, 80)}${state.goal.length > 80 ? '…' : ''}`);
    const d0 = state.done?.[0] ? ` — ${state.done[0].slice(0, 60)}${state.done[0].length > 60 ? '…' : ''}` : '';
    console.log(`  done: ${state.done?.length ? `${state.done.length}${d0}` : '—'}`);
    console.log(`  next: ${state.next_step.slice(0, 80)}`);
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
    console.log(`  ${i === 0 ? '*' : ' '} [${i + 1}] ${r.agent.padEnd(8)} ${fmt(u.remaining).padStart(7)} left · ${r.reason}`);
  });
}

/** FEAT-002 R3/R4: persist the agent's current session id (if discoverable)
 *  into state. Never invents ids (R5); best-effort, never fatal. */
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
  // L3: on a signature match, persist a short limit note (≤200 chars) so the
  // next agent knows why we're here. Deduped so repeated refreshes don't
  // stack identical constraints.
  const limitNote = hit && deadKey ? `${deadKey} limit hit: ${hit.line}`.slice(0, 200) : null;
  if (deadKey) await captureFor(deadKey); // R4/W1: capture BEFORE returning (was dead code after return)
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

/** SEC-001 T4/T6/T7: resolve whether to pass trustFlags for this launch.
 *  Trust-capable agent (has trustFlags) with no grant → Option A prompt once.
 *  Agents with no trustFlags are never "trusted" (nothing to pass). */
async function resolveTrust(agent: AgentConfig): Promise<boolean> {
  if (!agent.trustFlags.length) return false;
  return promptTrustGrant(repoDir);
}

async function offerHandoff(deadKey: string | null): Promise<void> {
  await refreshState(deadKey);
  // H6: live-ask the dying agent for a structured state update BEFORE the
  // picker (fail soft — a failed ask just keeps the refreshed state).
  if (deadKey) await liveAskAndMerge(agentFor(deadKey), repoDir);
  const state = loadState(repoDir) ?? blankState(repoDir, null);
  const ledger = await readLedger(repoDir);
  const recs = rankTakers(ledger, deadKey, state.owner ?? null);
  if (!recs.length) { console.error('kalaga: no agents to take over.'); return; }
  // P4 (O7/W2): one-line continuation hint BEFORE the picker (non-blocking).
  console.error(`  ${nextStepHint(state)}`);
  const choice = await pick(recs, ledger, deadKey ?? 'none');
  if (choice.stay) { console.error('kalaga: staying put — nothing launched.'); return; }
  if (choice.wait) {
    // R13: wait row → one-line resume hint when a fresh session was captured.
    const st = loadState(repoDir);
    const rec = st?.sessions?.[deadKey!];
    if (rec?.id && (await sessionFresh(agentFor(deadKey!), repoDir, rec))) {
      console.error(`kalaga: when the window resets → kala resume ${deadKey}`);
    } else {
      console.error(`kalaga: staying put — will reset; rerun kala run ${deadKey} later.`);
    }
    return;
  }
  const next = agentFor(choice.agent);
  // H5: thin-state warn on a CROSS-agent launch (taker ≠ the dying/owner).
  if (choice.agent !== deadKey && choice.agent !== state.owner && isThinState(state)) {
    console.error('kalaga: handoff state looks thin — taker may drift. Run live-ask, or: kala state …');
  }
  const st = mergeState(repoDir, { owner: next.key }, 'tailer');
  const trust = await resolveTrust(next);
  console.error(`kalaga → handing off to ${next.key}`);
  await runAgent(next, repoDir, handoffInject(st, injectRichPrompt()), trust);
}

// P1: injectPrompt removed — handoffInject (src/prompt.ts) is the single,
// sanitizing prompt API.

// ---------- FEAT-001: evidence-tiered post-exit flow ----------

/** E3: one-line stderr notice of how the agent exited. */
function exitNotice(agentKey: string, exitCode: number, hit: ReturnType<typeof scanChunk>, hasTail: boolean): void {
  if (hit) console.error(`  kalaga: limit hit — ${agentKey} (matched "${hit.matched}")`);
  else if (!hasTail && exitCode !== 0) console.error(`  kalaga: ${agentKey} exited (code ${exitCode}) — no session log to scan`);
  else console.error(`  kalaga: ${agentKey} exited cleanly (code ${exitCode}).`);
}

/** `--assume-limit` gate. On a TTY the flag alone suffices (explicit, visible).
 *  Off-TTY (scripts/CI) the flag is ignored unless KALA_ASSUME_LIMIT=1 — so a
 *  flag left in a wrapper script or copied command can't silently pre-approve
 *  a limit assumption the user never saw. */
function assumeLimitFlagged(): boolean {
  if (!process.argv.includes('--assume-limit')) return false;
  if (process.stdin.isTTY) return true;
  return process.env.KALA_ASSUME_LIMIT === '1';
}

/** E6: suspect-tier confirm — same gate as SEC-001 L2 in doRecover. */
async function confirmAssumeLimit(deadKey: string, exitCode: number): Promise<boolean> {
  if (assumeLimitFlagged()) return true;
  if (!process.stdin.isTTY) return false;
  process.stderr.write(`  assume it hit its limit? [y/N] `);
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ans = await new Promise<string>((res) => rl.question('', (a) => { rl.close(); res(a); }));
  if (ans.trim().toLowerCase() === 'y') console.error(`  kalaga: limit hit assumed — ${deadKey} (code ${exitCode}, no store to verify)`);
  return ans.trim().toLowerCase() === 'y';
}

/** E1/E4: shared post-exit flow for bare `kala` and `kala run`. Classifies
 *  the exit (E2), notices it (E3), then:
 *   limit   → offerHandoff (BLOCKED + L3 note + limit picker)
 *   suspect → [y/N] (E6): y → offerHandoff, n → final facts + shell
 *   clean   → refreshState(null) + stay-default menu (E7): number = hand off,
 *             Enter/q = back to shell. No auto-launch on a non-limit exit (A5).
 *  E9: whatever this flow does is the last action of this invocation. */
async function afterExit(agentKey: string, exitCode: number): Promise<void> {
  await captureFor(agentKey); // R3: capture before classifying (never changes tiers)
  const cfg = agentFor(agentKey);
  const tail = (await lastSessionText(cfg, repoDir)).slice(-4000);
  const hit = tail ? scanChunk(tail, cfg, exitCode) : null;
  const tier = classifyExit({ hit, exitCode, hasTail: tail !== '' });
  exitNotice(agentKey, exitCode, hit, tail !== '');

  if (tier === 'limit') {
    await offerHandoff(agentKey);
    return;
  }
  if (tier === 'suspect') {
    if (await confirmAssumeLimit(agentKey, exitCode)) await offerHandoff(agentKey);
    else await refreshState(null);
    return;
  }
  // clean
  const st = await refreshState(null);
  const ledger = await readLedger(repoDir);
  const recs = rankTakers(ledger, null, st.owner ?? null);
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
  const st2 = mergeState(repoDir, { owner: next.key });
  console.error(`  ${nextStepHint(st2)}`);
  const trust = await resolveTrust(next);
  console.error(`kalaga → handing off to ${next.key}`);
  await runAgent(next, repoDir, handoffInject(st2, injectRichPrompt()), trust);
}

async function doStart(): Promise<void> {
  // Bare `kala`: discover what's installed here, pick, launch.
  await refreshState(null); // ensure .kala/state.yaml exists (git facts)
  const ledger = await readLedger(repoDir);
  const state = loadState(repoDir);
  const installed = ledger.filter((u) => u.installed);
  if (!installed.length) {
    console.error('kalaga: no agent CLIs found on this machine (looked for agy, cursor-agent, grok, claude on PATH)');
    return;
  }
  const recs = rankTakers(ledger, null, state?.owner ?? null);
  if (!recs.length) {
    console.error('kalaga: installed agents have no headroom — wait for a reset, or: kala why');
    return;
  }
  const choice = await pick(recs, ledger, null);
  const next = agentFor(choice.agent);
  const st = mergeState(repoDir, { owner: next.key });
  const fresh = st.goal.startsWith('not captured');
  const trust = await resolveTrust(next);
  console.error(`kalaga → starting ${next.key}`);
  if (fresh) console.error(`kalaga: ${STANDING_ORDERS} Set goal + next_step (kala state goal "…" / kala state next "…").`);
  const exitCode = await runAgent(next, repoDir, fresh ? null : handoffInject(st, injectRichPrompt()), trust);
  await afterExit(next.key, exitCode);
}

async function doRun(agentKey: string): Promise<void> {
  const agent = agentFor(agentKey);
  const pre = await refreshState(null);
  mergeState(repoDir, { owner: agent.key });
  const fresh = loadState(repoDir);
  const trust = await resolveTrust(agent);
  if (fresh?.goal.startsWith('not captured')) console.error(`kalaga: ${STANDING_ORDERS} Set goal + next_step (kala state goal "…" / kala state next "…").`);
  const exitCode = await runAgent(agent, repoDir, fresh?.goal.startsWith('not captured') ? null : handoffInject(fresh!, injectRichPrompt()), trust);
  // FEAT-001: tiered post-exit flow (SEC-001 L1 still holds — a clean exit
  // is never classified as a limit hit; it just gets a stay-default menu).
  await afterExit(agent.key, exitCode);
}

async function doRecover(): Promise<void> {
  // Figure out who died: prefer the state's owner; else the most-recently-used agent.
  const state = loadState(repoDir);
  const ledger = await readLedger(repoDir);
  let dead: string | null = null;
  // The handoff owner is the agent that was working — recover is run because
  // it stopped, so it's the dead one, even if its store says nothing (agy).
  if (state?.owner) dead = state.owner;
  if (!dead) {
    const withUsage = ledger.filter((u) => u.lastUsed).sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
    if (withUsage[0]) dead = withUsage[0].agent;
  }
  if (!dead) { console.error('kalaga: no recent agent session found here — nothing to recover.'); return; }
  const cfg = agentFor(dead);
  const tail = (await lastSessionText(cfg, repoDir)).slice(-4000);
  if (tail) {
    const hit = scanChunk(tail, cfg, null);
    if (!hit) {
      console.error(`kalaga: ${dead} has no limit signature in its recent log — recover only after a limit hit.`);
      console.error(`  (if it really did hit a limit, add the phrase to ${dead}.limitPatterns in src/config.ts)`);
      return;
    }
  } else {
    // SEC-001 L2: no readable store (e.g. agy) — never assume the limit
    // silently. Require --assume-limit or an explicit [y/N].
    const assume = assumeLimitFlagged();
    let ok = assume;
    if (!ok && process.stdin.isTTY) {
      process.stderr.write(`  no session log to scan for ${dead} — assume it hit its limit? [y/N] `);
      const { createInterface } = await import('node:readline');
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      ok = (await new Promise<string>((res) => rl.question('', (a) => { rl.close(); res(a); }))).trim().toLowerCase() === 'y';
    }
    if (!ok) { console.error('kalaga: not assuming a limit hit — rerun with --assume-limit or confirm.'); return; }
    console.error(`  kalaga: limit hit assumed — ${dead} (no store to verify)`);
  }
  await offerHandoff(dead);
}

async function doSwitch(agentKey: string): Promise<void> {
  const agent = agentFor(agentKey);
  const pre = await refreshState(null);
  // H7: live-ask the PREVIOUS owner (or most-recent session agent) before we
  // hand off — only if it's installed and distinct from the target.
  const prev = pre.owner ?? Object.keys(pre.sessions).sort((a, b) =>
    (pre.sessions[b]?.at ?? '').localeCompare(pre.sessions[a]?.at ?? ''))[0] ?? null;
  if (prev && prev !== agentKey && isInstalled(agentFor(prev))) {
    await liveAskAndMerge(agentFor(prev), repoDir);
  }
  // H5: thin-state warn (or --strict-state aborts) on a cross-agent switch.
  const after = loadState(repoDir) ?? pre;
  if (isThinState(after)) {
    if (process.argv.includes('--strict-state')) {
      console.error('kalaga: state is thin and --strict-state was set — refusing to switch. Enrich first: kala state …');
      return;
    }
    console.error('kalaga: handoff state looks thin — taker may drift. Run live-ask, or: kala state …');
  }
  const owned = mergeState(repoDir, { owner: agent.key });
  const trust = await resolveTrust(agent);
  const exitCode = await runAgent(agent, repoDir, handoffInject(owned, injectRichPrompt()), trust);
  await captureFor(agent.key); // §3.4(2): light capture-only refresh after switch
  void exitCode;
}

/** FEAT-002 R9/R10/R11/R12: kala resume [agent]. */
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
  mergeState(repoDir, { owner: agent.key });
  const trust = await resolveTrust(agent);
  const exitCode = await resumeAgent(agent, repoDir, rec.id, trust);
  await afterExit(agent.key, exitCode); // R11: same FEAT-001 flow as kala run
}

function doState(sub: string | null, text: string): void {
  const s = loadState(repoDir) ?? blankState(repoDir, currentBranch(repoDir));
  if (!sub) { console.log(JSON.stringify(s, null, 2)); return; }
  switch (sub) {
    case 'goal': mergeState(repoDir, { goal: text }, 'manual'); break;
    case 'next': mergeState(repoDir, { next_step: text }, 'manual'); break;
    case 'note': mergeState(repoDir, { notes: text }, 'manual'); break;
    case 'neg': mergeState(repoDir, { negative_constraints: [...s.negative_constraints, text] }, 'manual'); break;
    case 'done': { // H9: append one bullet; cap at 12 (drop oldest) per H2
      const next = [...s.done, text].slice(-FIELD_MAX.doneItems);
      mergeState(repoDir, { done: next }, 'manual'); break;
    }
    default: console.error(`unknown state subcommand: ${sub}`); process.exit(1);
  }
  console.error(`kalaga: state updated (${sub})`);
}

function doInit(): void {
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
    const all = args.includes('--all');
    revokeTrust(all ? null : (args[1] ?? null), all);
    console.error(all ? 'kalaga: all trust grants revoked' : `kalaga: trust revoked for ${args[1] ?? '(current dir)'}`);
    return;
  }
  // default: status
  const grants = trustStatus();
  if (!grants.length) { console.log('no trust grants — first cold launch of a trust-capable agent will ask'); return; }
  for (const g of grants) console.log(`${g.path}  (${g.granted_at.slice(0, 10)} → ${g.expires_at.slice(0, 10)})`);
}

function printHelp(): void {
  console.log(`kalaga — local handoff across agy / cursor / grok / claude

  kala init                 create .kala/state.yaml from git facts
  kala status               headroom per agent + handoff state
  kala run <agent>          interactive session; on limit hit → pick a taker
  kala recover              trap after a limit (even if launched outside kala)
  kala switch <agent>       hand off to <agent> now
  kala resume [agent]       reopen a captured session by id (default: owner)
  kala why [deadAgent]      dry-run taker ranking
  kala trust [status|revoke <path>|revoke --all]
  kala state goal|next|note|neg|done <text>
  kala agents               list known agent keys

  Flags (with bare start / recover): --assume-limit

  Requires Node ≥ 24. Docs: README.md · SECURITY.md`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'status': await printStatus(); break;
    case 'why': await printWhy(rest[0] ?? null); break;
    case 'run': if (!rest[0]) throw new Error('usage: kala run <agent>'); await doRun(rest[0]); break;
    case 'recover': await doRecover(); break;
    case 'switch': if (!rest[0]) throw new Error('usage: kala switch <agent>'); await doSwitch(rest[0]); break;
    case 'resume': await doResume(rest[0] ?? null); break;
    case 'state': doState(rest[0] ?? null, rest.slice(1).join(' ')); break;
    case 'trust': doTrust(rest); break;
    case 'init': doInit(); break;
    case 'agents': {
      const ledger = await readLedger(repoDir);
      console.log(ledger.map((u) => `${u.agent}${u.installed ? '' : ' (not installed)'}`).join(' '));
      break;
    }
    case 'help':
    case '-h':
    case '--help':
      printHelp();
      break;
    case undefined:
    case '':
      await doStart();
      break;
    default:
      // Leading operational flags (e.g. --assume-limit) = bare start.
      // Unknown flags still get help rather than a silent no-op.
      // --assume-limit / --strict-state (or any leading flag) = bare start.
      if (cmd.startsWith('--')) { await doStart(); break; }
      if (cmd.startsWith('-')) { printHelp(); process.exitCode = 2; break; }
      printHelp();
      process.exitCode = 2;
  }
}

main().catch((e) => { console.error(`kalaga: ${e.message}`); process.exit(1); });
