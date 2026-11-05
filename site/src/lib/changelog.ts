// The changelog, read from the repository's CHANGELOG.md at build time and turned into HTML.
// It only needs what that file uses: ## and ### headings, paragraphs, "- " lists, **bold**,
// `code` and [links](url).
// Vite reads the file into the build itself (?raw), so it works wherever the pages are rendered,
// even in Cloudflare's runtime, which has no file system to read the repository from.
import text from '../../../CHANGELOG.md?raw';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s: string) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');

export type Release = { version: string; date: string; title: string; html: string };

export function releases(): Release[] {
  const out: Release[] = [];
  let cur: Release | null = null;
  let html: string[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  let item: string[] | null = null;
  const flushItem = () => { if (item && list) list.push(`<li>${inline(item.join(' '))}</li>`); item = null; };
  const flushList = () => { flushItem(); if (list) html.push(`<ul>${list.join('')}</ul>`); list = null; };
  const flushPara = () => { if (para.length) html.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const close = () => { flushPara(); flushList(); if (cur) { cur.html = html.join('\n'); out.push(cur); } html = []; };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const h2 = /^## (.+)$/.exec(line);
    if (h2) {
      close();
      const m = /^(\d+\.\d+\.\d+)\s*(\(([^)]+)\))?,?\s*(.*)$/.exec(h2[1]);
      cur = { version: m ? m[1] : h2[1], title: m?.[3] ?? '', date: m?.[4] ?? '', html: '' };
      continue;
    }
    if (!cur) continue;
    const h3 = /^### (.+)$/.exec(line);
    if (h3) { flushPara(); flushList(); html.push(`<h3>${inline(h3[1])}</h3>`); continue; }
    if (/^- /.test(line)) { flushPara(); if (!list) list = []; flushItem(); item = [line.slice(2)]; continue; }
    if (item && /^\s{2,}\S/.test(line)) { item.push(line.trim()); continue; }
    if (!line.trim()) { flushPara(); if (item) flushItem(); continue; }
    flushList();
    para.push(line.trim());
  }
  close();
  return out;
}
