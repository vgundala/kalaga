// Git facts for the handoff state. Best-effort: if we're not in a git repo,
// return nulls and let the state degrade gracefully.
import { execFileSync } from 'node:child_process';

function git(repoDir: string, args: string[]): string | null {
  try {
    // Trailing newlines only. Leading spaces are porcelain status columns
    // (" M path"), and trim() would eat column 0.
    const out = execFileSync('git', ['-C', repoDir, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).replace(/[\r\n]+$/, '');
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** Branch name. 0-commit repos still have a symbolic HEAD. Detached HEAD
 *  is `detached@<short-sha>`. */
export function currentBranch(repoDir: string): string | null {
  const sym = git(repoDir, ['symbolic-ref', '--short', 'HEAD']);
  if (sym) return sym;
  const sha = git(repoDir, ['rev-parse', '--short', 'HEAD']);
  if (sha && sha !== 'HEAD') return `detached@${sha}`;
  return null;
}

/** Parse `git status --porcelain=v1 -z`. Rename/copy entries are two
 *  NUL-separated paths; the first is the destination. */
export function parsePorcelainZ(raw: string): string[] {
  const files: string[] = [];
  const parts = raw.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry || entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const pathName = entry.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') {
      if (pathName) files.push(pathName);
      i++; // original path follows
    } else if (pathName) {
      files.push(pathName);
    }
  }
  return files;
}

export function modifiedFiles(repoDir: string): string[] {
  const raw = git(repoDir, ['status', '--porcelain=v1', '-z']);
  if (!raw) return [];
  return parsePorcelainZ(raw);
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
