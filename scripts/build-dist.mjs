// Zero-dependency compile: src/**/*.ts -> dist/**/*.js via Node's
// type stripper. Relative .ts specifiers become .js so the published
// package runs as plain JavaScript (no type-stripping inside node_modules).
import { stripTypeScriptTypes } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const outDir = path.join(root, 'dist');

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function rewriteSpecifiers(code) {
  const rel = String.raw`(\.\.?\/[^'"]+?)\.ts`;
  return code
    .replace(new RegExp(`(from\\s+['"])${rel}(['"])`, 'g'), '$1$2.js$3')
    .replace(new RegExp(`(import\\(\\s*['"])${rel}(['"]\\s*\\))`, 'g'), '$1$2.js$3');
}

fs.rmSync(outDir, { recursive: true, force: true });
const files = walk(srcDir);
for (const file of files) {
  const rel = path.relative(srcDir, file);
  const dest = path.join(outDir, rel.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const source = rewriteSpecifiers(fs.readFileSync(file, 'utf8'));
  const js = stripTypeScriptTypes(source, { mode: 'strip' });
  fs.writeFileSync(dest, js);
}
console.error(`kalaga: built ${files.length} files -> dist/`);
