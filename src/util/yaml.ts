// Tiny YAML emitter for the state schema we actually use. No deps.
// Handles: strings, numbers, booleans, arrays of scalars, one level of nesting.
type V = string | number | boolean | null | V[] | { [k: string]: V };

function esc(s: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(s) && s.length ? s : JSON.stringify(s);
}

export function toYaml(obj: V): string {
  const lines: string[] = [];
  emit(obj, 0, lines);
  return lines.join('\n') + '\n';
}

function emit(v: V, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === 'object' && item !== null) {
        // not used by our schema; render inline
        out.push(`${pad}- ${JSON.stringify(item)}`);
      } else {
        out.push(`${pad}- ${esc(String(item))}`);
      }
    }
  } else if (typeof v === 'object' && v !== null) {
    for (const [k, val] of Object.entries(v)) {
      if (val === null || val === undefined || (Array.isArray(val) && val.length === 0)) {
        out.push(`${pad}${k}: ${Array.isArray(val) ? '[]' : 'null'}`);
      } else if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
        out.push(`${pad}${k}:`);
        emit(val, indent + 1, out);
      } else {
        out.push(`${pad}${k}: ${esc(String(val))}`);
      }
    }
  } else {
    out.push(`${pad}${esc(String(v))}`);
  }
}
