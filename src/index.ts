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
import { loadAgents, agentFor } from './config.ts';
import { readLedger } from './ledger.ts';
import { loadState, mergeState, blankState, saveState } from './state/state.ts';
import type { HandoffState } from './state/state.ts';
import { currentBranch, modifiedFiles, gitSummary } from './state/git.ts';
import { rankTakers, isFresh } from './router.ts';
import { pick } from './picker.ts';
import { runAgent, lastSessionText } from './launch.ts';
import { scanChunk } from './trap.ts';

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

/** Refresh the warm state from git facts + the agent's own session tail. */
async function refreshState(deadKey: string | null): Promise<HandoffState> {
  let text = '';
  if (deadKey) {
    const cfg = agentFor(deadKey);
    text = await lastSessionText(cfg, repoDir);
    const hit = scanChunk(text.slice(-4000), cfg, null);
    if (hit) console.error(`  💀 ${deadKey} — limit hit (matched "${hit.matched}")`);
  }
  const cur = loadState(repoDir) ?? blankState(repoDir, currentBranch(repoDir));
  return mergeState(repoDir, {
    modified_files: modifiedFiles(repoDir),
    branch: currentBranch(repoDir),
    status: deadKey ? 'BLOCKED' : cur.status,
    notes: cur.notes || gitSummary(repoDir),
    // capture the limit line into the state so the next agent knows why we're here
    ...(deadKey && text ? { negative_constraints: [...cur.negative_constraints] } : {}),
  }, 'tailer');
}

async function offerHandoff(deadKey: string | null): Promise<void> {
  const state = await refreshState(deadKey);
  const ledger = await readLedger(repoDir);
  const recs = rankTakers(ledger, deadKey, state.owner ?? null);
  if (!recs.length) { console.error('kalaga: no agents to take over.'); return; }
  const choice = await pick(recs, ledger, deadKey ?? 'none');
  if (choice.wait) {
    console.error(`kalaga: staying put — will reset; rerun kala run ${deadKey} later.`);
    return;
  }
  const next = agentFor(choice.agent);
  const st = mergeState(repoDir, { owner: next.key }, 'tailer');
  console.error(`kalaga → handing off to ${next.key}`);
  await runAgent(next, repoDir, injectPrompt(st));
}

/** What we hand the receiving agent: a pointer to the state file plus the
 *  next step. Kept short — the file is the source of truth. */
function injectPrompt(s: HandoffState): string {
  return [
    `Kalaga handoff from ${s.owner ?? 'another agent'}. Read .kala/state.yaml in the project root before doing anything.`,
    `Next step: ${s.next_step}`,
  ].join(' ');
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
  console.error(`kalaga → starting ${next.key}`);
  await runAgent(next, repoDir, fresh ? null : injectPrompt(st));
}

async function doRun(agentKey: string): Promise<void> {
  const agent = agentFor(agentKey);
  const pre = await refreshState(null);
  mergeState(repoDir, { owner: agent.key });
  const fresh = loadState(repoDir);
  await runAgent(agent, repoDir, fresh?.goal.startsWith('not captured') ? null : injectPrompt(fresh!));
  // Agent exited. Offer the handoff if it hit a limit (detected from its log,
  // or trusted for agents with no readable store — the user runs this knowing
  // the agent just stopped).
  const tail = (await lastSessionText(agent, repoDir)).slice(-4000);
  const hit = tail ? scanChunk(tail, agent, null) : { agent: agent.key, matched: 'no-store', line: '', exitCode: null };
  if (hit) {
    await offerHandoff(agent.key);
  } else {
    // exited cleanly — still record final facts
    await refreshState(null);
  }
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
    // No readable store for this agent (e.g. agy) — trust that recover is
    // only run after a limit hit.
    console.error(`  💀 ${dead} — no session log to scan (trusting limit hit)`);
  }
  await offerHandoff(dead);
}

async function doSwitch(agentKey: string): Promise<void> {
  const agent = agentFor(agentKey);
  await refreshState(null);
  const owned = mergeState(repoDir, { owner: agent.key });
  await runAgent(agent, repoDir, injectPrompt(owned));
}

function doState(sub: string | null, text: string): void {
  const s = loadState(repoDir) ?? blankState(repoDir, currentBranch(repoDir));
  if (!sub) { console.log(JSON.stringify(s, null, 2)); return; }
  switch (sub) {
    case 'goal': mergeState(repoDir, { goal: text }, 'manual'); break;
    case 'next': mergeState(repoDir, { next_step: text }, 'manual'); break;
    case 'note': mergeState(repoDir, { notes: text }, 'manual'); break;
    case 'neg': mergeState(repoDir, { negative_constraints: [...s.negative_constraints, text] }, 'manual'); break;
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

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'status': await printStatus(); break;
    case 'why': await printWhy(rest[0] ?? null); break;
    case 'run': if (!rest[0]) throw new Error('usage: kala run <agent>'); await doRun(rest[0]); break;
    case 'recover': await doRecover(); break;
    case 'switch': if (!rest[0]) throw new Error('usage: kala switch <agent>'); await doSwitch(rest[0]); break;
    case 'state': doState(rest[0] ?? null, rest.slice(1).join(' ')); break;
    case 'init': doInit(); break;
    case 'agents': {
      const ledger = await readLedger(repoDir);
      console.log(ledger.map((u) => `${u.agent}${u.installed ? '' : ' (not installed)'}`).join(' '));
      break;
    }
    case undefined:
    case '':
      await doStart();
      break;
    default:
      console.log(`kalaga — seamless handoff across agy / cursor / grok / claude
  kala status               headroom per agent + handoff state
  kala run <agent>          work in <agent>; on limit hit → pick a taker
  kala recover              after a limit hit (even outside kala)
  kala switch <agent>       hand off to <agent> now
  kala why [deadAgent]      show the taker ranking (dry run)
  kala state goal|next|note|neg <text>
  kala init | kala agents`);
  }
}

main().catch((e) => { console.error(`kalaga: ${e.message}`); process.exit(1); });
