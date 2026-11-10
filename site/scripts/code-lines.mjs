// Pulls real lines out of Liner Code's own source for the sea of code, with a token class per
// character (0 name, 1 keyword, 2 string, 3 comment, 4 punctuation or number).
// Run from site/: node scripts/code-lines.mjs   (writes src/data/code.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const files = [
  'engine/src/sidekick.ts',
  'contracts/src/index.ts',
  'engine/src/review.ts',
  'ui/src/app/Surfaces.tsx',
  'engine/src/runtime.ts',
];
const MAX = 132;
const KEYWORDS = new Set(('const let var function return export import from if else type interface await async new for of in ' +
  'while true false null undefined class extends private public readonly static switch case break continue default throw try catch ' +
  'finally typeof keyof as this void never string number boolean').split(' '));

function classes(line) {
  const out = new Array(line.length).fill(0);
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '/' && line[i + 1] === '/') { for (let j = i; j < line.length; j++) out[j] = 3; break; }
    if (c === '/' && line[i + 1] === '*') { const e = line.indexOf('*/', i + 2); const end = e < 0 ? line.length : e + 2; for (let j = i; j < end; j++) out[j] = 3; i = end; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === '\\' ? 2 : 1;
      for (let k = i; k <= Math.min(j, line.length - 1); k++) out[k] = 2;
      i = j + 1; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < line.length && /[\w$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      if (KEYWORDS.has(word)) for (let k = i; k < j; k++) out[k] = 1;
      i = j; continue;
    }
    if (/[0-9]/.test(c) || /[{}()[\];:.,=<>+\-*/%!?&|^~]/.test(c)) out[i] = 4;
    i++;
  }
  return out;
}

const lines = [];
for (const f of files) {
  const text = readFileSync(join(root, f), 'utf8')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/›/g, '>').replace(/[…]/g, '...').replace(/[–—]/g, '-');
  let inBlock = false;
  for (let raw of text.split('\n')) {
    const t = raw.trim();
    if (t.startsWith('/*')) inBlock = true;
    if (inBlock) { if (t.includes('*/')) inBlock = false; continue; }
    let line = raw.replace(/\t/g, '  ').replace(/^\s+/, (s) => ' '.repeat(Math.min(s.length, 4))).trimEnd();
    if (line.trim().length < 18) continue;
    if (/[^\x20-\x7e]/.test(line)) continue; // ASCII only: the glyph atlas holds 95 characters
    if (line.length > MAX) line = line.slice(0, MAX - 3).trimEnd() + ' ..';
    lines.push(line);
  }
}
// Keep the start of sidekick.ts in order (the first rings you read), then sample the rest evenly.
const head = lines.slice(0, 64);
const rest = lines.slice(64);
const step = Math.max(1, Math.floor(rest.length / 192));
const picked = [...head, ...rest.filter((_, i) => i % step === 0)].slice(0, 256);
const out = picked.map((t) => ({ t, c: classes(t).join('') }));
writeFileSync(join(root, 'site/src/data/code.json'), JSON.stringify(out));
console.log(`${out.length} lines, longest ${Math.max(...out.map((l) => l.t.length))}`);
