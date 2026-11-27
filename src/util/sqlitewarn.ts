// node:sqlite still emits ExperimentalWarning. Suppress that one only —
// keep every other process warning visible (no blanket --no-warnings).
import process from 'node:process';

let installed = false;

export function ignoreSqliteExperimentalWarning(): void {
  if (installed) return;
  installed = true;
  const orig = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const msg = typeof warning === 'string' ? warning : (warning?.message ?? '');
    const isExperimental =
      args[0] === 'ExperimentalWarning' ||
      (typeof args[0] === 'object' && args[0] !== null && (args[0] as { type?: unknown }).type === 'ExperimentalWarning') ||
      (warning instanceof Error && warning.name === 'ExperimentalWarning');
    if (isExperimental && /SQLite/i.test(msg)) return;
    return Reflect.apply(orig, process, [warning, ...args] as Parameters<typeof orig>);
  }) as typeof process.emitWarning;
}
