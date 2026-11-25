// Tiny YAML emitter/parser for the state schema we actually use. No deps.
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

/** Decode one YAML scalar. Double quotes go through JSON.parse so \" \\ \\n \\t
 *  round-trip; single quotes unescape ''. Invalid escapes fall back to a
 *  single unescape pass (no backslash growth). */
export function parseYamlScalar(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch { /* hand-edited */ }
    return s.slice(1, -1).replace(/\\(["\\/bfnrt])/g, (_m, c: string) => {
      switch (c) {
        case 'n': return '\n';
        case 't': return '\t';
        case 'r': return '\r';
        case 'b': return '\b';
        case 'f': return '\f';
        case '"': return '"';
        case '\\': return '\\';
        case '/': return '/';
        default: return c;
      }
    });
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

/** Inline flow list (`[]`, `["a", "b"]`, `[a, b]`). Null when `raw` is not a list. */
export function parseYamlInlineList(raw: string): string[] | null {
  const s = raw.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return null;
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v.map((x) => (x === null || x === undefined ? '' : String(x)));
  } catch { /* single-quoted or bare items */ }
  const inner = s.slice(1, -1).trim();
  if (!inner) return [];
  const parts: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      if (quote === "'" && c === "'" && inner[i + 1] === "'") { cur += "''"; i++; continue; }
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === ',') { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.map((p) => parseYamlScalar(p));
}

/** `|` / `>` (optional chomp `-` or `+`, optional indent digit). */
export function isYamlBlockIndicator(raw: string): { style: '|' | '>'; strip: boolean } | null {
  const m = raw.trim().match(/^([|>])([+-])?[0-9]*\s*(?:#.*)?$/);
  if (!m) return null;
  return { style: m[1] as '|' | '>', strip: m[2] === '-' };
}

/** Indented block lines starting at `index`. Blank lines stay inside the block. */
export function consumeIndentedBlock(lines: string[], index: number): { lines: string[]; next: number } {
  const collected: string[] = [];
  let n = index;
  while (n < lines.length) {
    const ln = lines[n];
    if (ln.trim() === '') { collected.push(''); n++; continue; }
    if (!/^ /.test(ln)) break;
    collected.push(ln);
    n++;
  }
  return { lines: collected, next: n };
}

export function renderYamlBlock(lines: string[], style: '|' | '>', strip: boolean): string {
  let min = Infinity;
  for (const ln of lines) {
    if (!ln.trim()) continue;
    const n = ln.match(/^ */)?.[0].length ?? 0;
    if (n < min) min = n;
  }
  if (!Number.isFinite(min)) min = 0;
  const body = lines.map((ln) => (ln.trim() ? ln.slice(Math.min(min, ln.length)) : ''));
  let text: string;
  if (style === '|') text = body.join('\n');
  else {
    const paras: string[] = [];
    let buf: string[] = [];
    const flush = (): void => { if (buf.length) { paras.push(buf.join(' ')); buf = []; } };
    for (const ln of body) {
      if (!ln.trim()) flush();
      else buf.push(ln.trim());
    }
    flush();
    text = paras.join('\n');
  }
  return strip ? text.replace(/\n+$/, '') : text.replace(/\n$/, '');
}
