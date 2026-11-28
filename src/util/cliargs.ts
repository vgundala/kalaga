// Scoped CLI flag parsing with `state <field>` payload preservation and `--` end-of-flags.

export interface ParsedCliArgs {
  positionals: string[];
  flags: Set<string>;
  flagValues: Map<string, string>;
  action: 'run' | 'version' | 'help' | 'error';
}

const KNOWN_FLAGS = new Set(['--assume-limit', '--strict-state', '--force', '--all']);
const VALUE_FLAGS = new Set(['--agent', '--event', '--agents']);

/** Parse CLI argv tokens (excluding node and script) with scoped flag handling. */
export function parseCliArgs(raw: string[]): ParsedCliArgs {
  const positionals: string[] = [];
  const flags = new Set<string>();
  const flagValues = new Map<string, string>();
  let endOfFlags = false;

  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (endOfFlags) {
      positionals.push(a);
      continue;
    }
    if (a === '--') {
      endOfFlags = true;
      continue;
    }
    if (KNOWN_FLAGS.has(a)) {
      flags.add(a);
      continue;
    }
    if (a === '-v' || a === '--version') {
      return { positionals, flags, flagValues, action: 'version' };
    }
    if (a === '-h' || a === '--help') {
      return { positionals, flags, flagValues, action: 'help' };
    }
    const eqIdx = a.indexOf('=');
    const flagName = eqIdx > 0 ? a.slice(0, eqIdx) : a;
    if (VALUE_FLAGS.has(flagName)) {
      if (eqIdx > 0) {
        flagValues.set(flagName, a.slice(eqIdx + 1));
      } else {
        const next = raw[i + 1];
        if (next === undefined || next.startsWith('-')) {
          return { positionals, flags, flagValues, action: 'error' };
        }
        flagValues.set(flagName, next);
        i++;
      }
      continue;
    }
    if (a.startsWith('-')) {
      return { positionals, flags, flagValues, action: 'error' };
    }
    positionals.push(a);
    if (positionals[0] === 'state' && positionals.length === 2) {
      endOfFlags = true;
      if (raw[i + 1] === '--') {
        i++;
      }
    }
  }

  return { positionals, flags, flagValues, action: 'run' };
}
