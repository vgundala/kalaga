// Git facts for the handoff state. Best-effort: if we're not in a git repo,
// return nulls and let the state degrade gracefully.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

function git(repoDir: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export function currentBranch(repoDir: string): string | null {
  return git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

export function modifiedFiles(repoDir: string): string[] {
  const raw = git(repoDir, ['status', '--porcelain']);
  if (!raw) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

/** A one-line "where things stand" derived from git, used to seed the state
 *  when no agent has written anything yet. */
export function gitSummary(repoDir: string): string {
  const branch = currentBranch(repoDir);
  const files = modifiedFiles(repoDir);
  if (!branch && !files.length) return '';
  const parts: string[] = [];
  if (branch) parts.push(`branch ${branch}`);
  if (files.length) parts.push(`${files.length} uncommitted file${files.length > 1 ? 's' : ''}`);
  return parts.join(', ');
}
