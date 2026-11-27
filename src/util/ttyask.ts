// TTY: one keypress (no Enter). Pipe / non-TTY: one line (tests + scripts).
import { createInterface } from 'node:readline';
import process from 'node:process';

/** Drop any bytes already queued (e.g. the '\n' half of a prior key+\n split)
 *  so the next decision is not a phantom Enter. */
function drainStdin(): void {
  try {
    while (process.stdin.read() !== null) { /* discard */ }
  } catch { /* not readable yet */ }
}

/** Read a single decision from stdin. Restores cooked mode before resolving
 *  so a later child with stdio:'inherit' gets a normal terminal. */
export function readSingleKeyOrLine(): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
    return new Promise<string>((resolve) => {
      let settled = false;
      const done = (s: string): void => {
        if (settled) return;
        settled = true;
        resolve(s);
      };
      rl.once('close', () => done(''));
      rl.question('', (ans) => {
        done(ans);
        rl.close();
      });
    });
  }

  return new Promise<string>((resolve) => {
    const wasRaw = process.stdin.isRaw === true;
    let settled = false;
    const restore = (): void => {
      try { process.stdin.setRawMode(wasRaw); } catch { /* already closed */ }
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onClose);
      process.stdin.removeListener('close', onClose);
      process.stdin.removeListener('error', onClose);
      process.stdin.pause();
    };
    const finish = (value: string): void => {
      if (settled) return;
      settled = true;
      restore();
      resolve(value);
    };
    const onClose = (): void => finish('');
    const onData = (buf: Buffer | string): void => {
      const s = typeof buf === 'string' ? buf : buf.toString('utf8');
      // Ctrl+C — mirror default terminal behavior.
      if (s === '\u0003') {
        if (settled) return;
        settled = true;
        restore();
        process.stderr.write('\n');
        process.exit(130);
      }
      // Ignore incomplete / accidental escape sequences (arrows, etc.).
      if (s.startsWith('\x1b')) return;
      if (s.startsWith('\r') || s.startsWith('\n')) {
        process.stderr.write('\n');
        finish('');
        return;
      }
      const ch = s.charAt(0);
      process.stderr.write(`${ch}\n`);
      finish(ch);
    };
    drainStdin();
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
    process.stdin.once('end', onClose);
    process.stdin.once('close', onClose);
    process.stdin.once('error', onClose);
  });
}
