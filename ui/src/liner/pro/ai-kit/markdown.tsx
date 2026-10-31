/*
  A small markdown for AI replies: paragraphs, headings, lists (nested, numbered, tasks), quotes,
  rules, tables, ``` fences (highlighted), **bold**, *italic*, ~~struck~~, `code`, [links](…),
  bare web addresses, paths to files, and [n] / [1,3] citations.

  It parses whatever slice has been revealed, tracking source offsets so each streamed chunk
  renders as a span keyed by where it starts. List markers and code fences never show before
  their first word, a table's first row waits for the line under it, and an unclosed ** or `
  formats only while the text is still coming. createMarkdownParser keeps the blocks a reply has
  finished, so a streaming reply reads again only its last block (T3 Code's
  markdown-incremental.ts keeps its finished prefix the same way), and a finished block doesn't
  redraw while the next one streams.
*/
import { createContext, Fragment, memo, useContext, type ReactNode } from "react";
import { CopyButton } from "../../components/copy-button/copy-button";
import { tokenize, type Lang } from "../../components/code-block/tokenize";
import "../../components/code-block/code-block.css";

/** A place in a file a reply points at: "src/a.ts:42", "[the store](src/store.ts#L10)". */
export type FileLink = { path: string; line?: number };

export type Run =
  | { kind: "text"; text: string; start: number }
  | { kind: "code"; text: string; start: number; file?: FileLink }
  | { kind: "cite"; ids: number[]; start: number }
  | { kind: "strong" | "em" | "del"; runs: Run[]; start: number }
  /** No href yet: a link whose address is still streaming. */
  | { kind: "link"; href?: string; file?: FileLink; runs: Run[]; start: number };

export type ListItem = { runs: Run[]; start: number; task?: "open" | "done"; children: Block[] };
export type Cell = { runs: Run[]; start: number };
export type Align = "left" | "center" | "right" | undefined;

/** `end` is where a block's source ends, so a block knows which streamed chunks are its own. */
export type Block = (
  | { kind: "p"; runs: Run[] }
  | { kind: "h"; level: number; runs: Run[] }
  | { kind: "list"; ordered: boolean; first?: number; items: ListItem[] }
  | { kind: "code"; lang: string; code: string; codeStart: number }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "hr" }
  | { kind: "table"; align: Align[]; head: Cell[]; rows: { start: number; cells: Cell[] }[] }
) & { start: number; end: number };

/* ---------------- Paths ---------------- */

// After T3 Code's packages/shared/src/markdownLinks.ts: a path names a file when its last part
// has an extension, and a bare one only when it has a folder or a line in it.
const POSITION = /(?::(\d+)(?::\d+)?|#L(\d+)(?:C\d+)?(?:-L?\d+)?)$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const EXTENSION = /\.[A-Za-z0-9_-]{1,12}$/;
const VERSION = /\d\.\d[^.]*$/;
const HOSTNAME = /^(?:localhost|[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|dev|app|ai|co|gov|edu|sh|so|me|us|uk|de|fr|jp|xyz|info|biz))$/i;
const EXPLICIT = /^(?:\.{1,2}\/|~\/|\/)/;
const FILE_ROOTS = /^\/(?:Users|home|tmp|private|var|opt|etc|usr|Volumes|workspace|app|src)\//;
const BARE_NAMES = new Set(["Makefile", "Dockerfile", "LICENSE", "README", "Gemfile", "Procfile", "Rakefile", "Justfile", "CODEOWNERS"]);

function placeOf(raw: string): FileLink | null {
  let s = raw.trim().replace(/^<(.*)>$/, "$1");
  if (/^file:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      s = u.pathname + u.hash;
    } catch {
      return null;
    }
  }
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep it as it was written
  }
  if (!s || s.startsWith("#") || s.startsWith("//") || SCHEME.test(s)) return null;
  const m = POSITION.exec(s);
  const path = m ? s.slice(0, m.index) : s;
  const line = m ? Number(m[1] ?? m[2]) : 0;
  if (!path || path.endsWith("/")) return null;
  return line > 0 ? { path, line } : { path };
}

const looksLikeFile = (p: FileLink) => {
  const last = p.path.slice(p.path.lastIndexOf("/") + 1);
  if (BARE_NAMES.has(last)) return true;
  if (!EXTENSION.test(last) || VERSION.test(last)) return false;
  return !HOSTNAME.test(p.path.split("/")[0]);
};

/** A link's address, when it names a file rather than a page: "src/a.ts", "./b.md#L4", "file:///…". */
export function fileOfHref(href: string): FileLink | null {
  const p = placeOf(href);
  return p && (looksLikeFile(p) || (EXPLICIT.test(p.path) && FILE_ROOTS.test(p.path))) ? p : null;
}

/** Inline code that names a file: "src/app.ts", "app.ts:42"; not "npm run build", "example.com/a", "/api/users" or "v1.2.3". */
export function fileOfCode(code: string): FileLink | null {
  const s = code.trim();
  if (!s || /[\s`'"<>]/.test(s) || SCHEME.test(s)) return null;
  const p = placeOf(s);
  if (!p) return null;
  if (EXPLICIT.test(p.path)) return p.path.length > 2 && (looksLikeFile(p) || (p.line && FILE_ROOTS.test(p.path))) ? p : null;
  if (!p.line && !p.path.includes("/")) return null;
  return looksLikeFile(p) ? p : null;
}

/* ---------------- Parsing ---------------- */

type Line = { text: string; start: number };
/** `end` is the source's length; `partial` says more text may still come. */
/** inLink: inside a link's label, where nothing links again (an <a> can't hold another). */
type Ctx = { end: number; partial: boolean; inLink?: boolean };

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~>]/;
const CITE = /\[(\d+(?:\s*,\s*\d+)*)\](?!\()/y;
const AUTOLINK = /<((?:https?:\/\/|mailto:)[^\s<>]+)>/iy;
const URL_AT = /https?:\/\/[^\s<>"'`]+/iy;
// A path with a folder and a line in plain words: "src/app.ts:42", "./lib/a.py:10:3".
const PATH_AT = /(?:\.{1,2}\/|~\/|\/)?(?:[\w@.+-]+\/)+[\w@.+-]+\.[A-Za-z0-9]{1,12}(?::\d+(?::\d+)?|#L\d+)/y;
const count = (s: string, ch: string) => s.split(ch).length - 1;

/** Where the link that opens at `at` ends: its label, and its address once it has one. */
function linkAt(text: string, at: number, open: boolean) {
  let depth = 0;
  let close = -1;
  for (let j = at; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === "[") depth++;
    else if (text[j] === "]" && --depth === 0) {
      close = j;
      break;
    }
  }
  if (close < 0 || text[close + 1] !== "(") return null;
  const label = text.slice(at + 1, close);
  let parens = 0;
  for (let j = close + 2; j < text.length; j++) {
    if (text[j] === "(") parens++;
    else if (text[j] === ")" && parens-- === 0) {
      const dest = text.slice(close + 2, j).trim();
      // An address may carry a title after it ("url "Title""); the address is what counts.
      const href = /^<([^>]*)>/.exec(dest)?.[1] ?? dest.split(/\s+/)[0];
      return { label, href, end: j + 1 };
    }
  }
  // Its address is still being written: the label shows as a link, not the address letter by letter.
  return open ? { label, end: text.length } : null;
}

function parseInline(text: string, base: number, ctx: Ctx): Run[] {
  const out: Run[] = [];
  // Formatting left open waits for its close while the text is still coming; in finished text it's characters.
  const open = ctx.partial && base + text.length >= ctx.end;
  let i = 0;
  let buf = "";
  let bufStart = base;
  const flush = () => {
    if (buf) out.push({ kind: "text", text: buf, start: bufStart });
    buf = "";
  };
  const put = (r: Run | null, next: number) => {
    flush();
    if (r) out.push(r);
    i = next;
    bufStart = base + i;
  };
  const lit = (s: string) => {
    if (!buf) bufStart = base + i;
    buf += s;
    i += s.length;
  };
  while (i < text.length) {
    const c = text[i];
    // A backslash keeps the next mark a character.
    if (c === "\\" && ESCAPABLE.test(text[i + 1] ?? "")) {
      flush();
      i++;
      lit(text[i]);
      continue;
    }
    if (c === "`") {
      let n = 1;
      while (text[i + n] === "`") n++;
      let close = text.indexOf("`".repeat(n), i + n);
      while (close >= 0 && text[close + n] === "`") close = text.indexOf("`".repeat(n), close + n + 1);
      if (close < 0 && !open) {
        lit("`".repeat(n));
        continue;
      }
      let inner = close < 0 ? text.slice(i + n) : text.slice(i + n, close);
      let at = base + i + n;
      if (inner.length > 2 && inner.startsWith(" ") && inner.endsWith(" ")) {
        inner = inner.slice(1, -1);
        at++;
      }
      const file = close >= 0 && !ctx.inLink ? fileOfCode(inner) : null;
      put(inner ? { kind: "code", text: inner, start: at, ...(file ? { file } : {}) } : null, close < 0 ? text.length : close + n);
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === "**" || two === "~~" || (two === "__" && !/\w/.test(text[i - 1] ?? ""))) {
      const close = text.indexOf(two, i + 2);
      const inner = close < 0 ? text.slice(i + 2) : text.slice(i + 2, close);
      if ((close > i + 2 && !/^\s/.test(inner)) || (close < 0 && open)) {
        put(inner ? { kind: two === "~~" ? "del" : "strong", runs: parseInline(inner, base + i + 2, ctx), start: base + i } : null, close < 0 ? text.length : close + 2);
        continue;
      }
      lit(two);
      continue;
    }
    if ((c === "*" || c === "_") && text[i + 1] && !/\s/.test(text[i + 1]) && (c === "*" || !/\w/.test(text[i - 1] ?? ""))) {
      // Its close: the same mark after a character, and for _ not inside a word (snake_case stays).
      let close = -1;
      for (let j = text.indexOf(c, i + 1); j > 0; j = text.indexOf(c, j + 1)) {
        if (text[j + 1] === c) {
          j++;
          continue;
        }
        if (!/\s/.test(text[j - 1]) && (c === "*" || !/\w/.test(text[j + 1] ?? ""))) {
          close = j;
          break;
        }
      }
      if (close > i + 1 || (close < 0 && open)) {
        const inner = close < 0 ? text.slice(i + 1) : text.slice(i + 1, close);
        put({ kind: "em", runs: parseInline(inner, base + i + 1, ctx), start: base + i }, close < 0 ? text.length : close + 1);
        continue;
      }
      lit(c);
      continue;
    }
    if (c === "[") {
      CITE.lastIndex = i;
      const cite = CITE.exec(text);
      if (cite) {
        put({ kind: "cite", ids: cite[1].split(",").map((n) => Number(n.trim())), start: base + i }, i + cite[0].length);
        continue;
      }
      const link = ctx.inLink ? null : linkAt(text, i, open);
      if (link) {
        const file = link.href && !/^(?:https?:|mailto:)/i.test(link.href) ? fileOfHref(link.href) : null;
        put({ kind: "link", href: link.href, ...(file ? { file } : {}), runs: link.label ? parseInline(link.label, base + i + 1, { ...ctx, inLink: true }) : [], start: base + i }, link.end);
        continue;
      }
      lit(c);
      continue;
    }
    if (c === "<" && !ctx.inLink) {
      AUTOLINK.lastIndex = i;
      const m = AUTOLINK.exec(text);
      if (m) {
        put({ kind: "link", href: m[1], runs: [{ kind: "text", text: m[1], start: base + i + 1 }], start: base + i }, i + m[0].length);
        continue;
      }
    }
    const prev = text[i - 1] ?? " ";
    if ((c === "h" || c === "H") && !ctx.inLink && !/[\w/]/.test(prev)) {
      URL_AT.lastIndex = i;
      let url = URL_AT.exec(text)?.[0];
      // Punctuation at the end belongs to the sentence; a ")" too, unless it closes one in the address.
      while (url && (/[.,;:!?'"*_~]$/.test(url) || (url.endsWith(")") && count(url, "(") < count(url, ")")))) url = url.slice(0, -1);
      if (url && url.length > 10) {
        put({ kind: "link", href: url, runs: [{ kind: "text", text: url, start: base + i }], start: base + i }, i + url.length);
        continue;
      }
    }
    if (!ctx.inLink && !/[\w/.~@+-]/.test(prev) && /[\w./~]/.test(c)) {
      PATH_AT.lastIndex = i;
      const m = PATH_AT.exec(text)?.[0];
      const file = m && !/\w/.test(text[i + m.length] ?? "") ? fileOfCode(m) : null;
      if (m && file) {
        put({ kind: "link", file, runs: [{ kind: "text", text: m, start: base + i }], start: base + i }, i + m.length);
        continue;
      }
    }
    lit(c);
  }
  flush();
  return out;
}

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const QUOTE = /^ {0,3}>[ \t]?/;
const DELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-*:?\s*)*\|?\s*$/;
const TASK = /^\[([ xX])\](?:[ \t]+|$)/;
const width = (ws: string) => ws.replace(/\t/g, "    ").length;
const indentOf = (s: string) => width(/^\s*/.exec(s)![0]);
const ends = (l: Line) => l.start + l.text.length;

/** A table row's cells, with where each starts; a pipe inside `code` or after a backslash isn't a border. */
function cellsOf(line: Line) {
  const t = line.text;
  const cells: { text: string; start: number }[] = [];
  let i = 0;
  while (i < t.length && /\s/.test(t[i])) i++;
  if (t[i] === "|") i++;
  let from = i;
  let tick = false;
  for (; i <= t.length; i++) {
    const ch = t[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "`") tick = !tick;
    if (i === t.length || (ch === "|" && !tick)) {
      const raw = t.slice(from, i);
      cells.push({ text: raw.trim(), start: line.start + from + (raw.length - raw.trimStart().length) });
      from = i + 1;
    }
  }
  // A closing pipe leaves nothing after it.
  if (cells.length > 1 && !cells[cells.length - 1].text && /\|\s*$/.test(t)) cells.pop();
  return cells;
}

function parseTable(lines: Line[], li: number, ctx: Ctx): [Block, number] {
  const head = cellsOf(lines[li]);
  const align = cellsOf(lines[li + 1]).map((c): Align => {
    const l = c.text.startsWith(":");
    const r = c.text.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : undefined;
  });
  const rows: { start: number; cells: Cell[] }[] = [];
  let j = li + 2;
  for (; j < lines.length && lines[j].text.trim() && lines[j].text.includes("|"); j++) {
    const cells = cellsOf(lines[j]);
    rows.push({ start: lines[j].start, cells: head.map((_, k) => (cells[k] ? { runs: parseInline(cells[k].text, cells[k].start, ctx), start: cells[k].start } : { runs: [], start: ends(lines[j]) })) });
  }
  return [{ kind: "table", align: head.map((_, k) => align[k]), head: head.map((c) => ({ runs: parseInline(c.text, c.start, ctx), start: c.start })), rows, start: lines[li].start, end: ends(lines[j - 1]) }, j];
}

type ListBlock = Extract<Block, { kind: "list" }>;

/** A list from `li`, with the lists nested in its items; returns where it stopped. */
function parseList(lines: Line[], li: number, ctx: Ctx): [ListBlock, number] {
  const m0 = ITEM.exec(lines[li].text)!;
  const indent = width(m0[1]);
  const ordered = /\d/.test(m0[2]);
  const list: ListBlock = { kind: "list", ordered, first: ordered ? parseInt(m0[2], 10) : undefined, items: [], start: lines[li].start, end: ends(lines[li]) };
  let i = li;
  let afterBlank = false;
  while (i < lines.length) {
    const line = lines[i];
    const { text, start } = line;
    if (!text.trim()) {
      // A blank line: the list goes on when what follows is more of it (1. … 2. … with room between).
      let j = i + 1;
      while (j < lines.length && !lines[j].text.trim()) j++;
      const next = lines[j];
      if (!next) break;
      const nm = ITEM.exec(next.text);
      const goesOn = nm && !RULE.test(next.text) ? width(nm[1]) > indent || (width(nm[1]) === indent && /\d/.test(nm[2]) === ordered) : indentOf(next.text) > indent && list.items.length > 0;
      if (!goesOn) break;
      i = j;
      afterBlank = true;
      continue;
    }
    const m = RULE.test(text) ? null : ITEM.exec(text);
    if (m) {
      const w = width(m[1]);
      if (w < indent) break;
      if (w > indent + 1 && list.items.length) {
        const [sub, j] = parseList(lines, i, ctx);
        if (sub.items.length) list.items[list.items.length - 1].children.push(sub);
        list.end = sub.end;
        i = j;
        afterBlank = false;
        continue;
      }
      if (/\d/.test(m[2]) !== ordered) break;
      let body = text.slice(m[0].length);
      let at = start + m[0].length;
      const item: ListItem = { runs: [], start, children: [] };
      const task = TASK.exec(body);
      if (task) {
        item.task = task[1] === " " ? "open" : "done";
        body = body.slice(task[0].length);
        at += task[0].length;
      }
      item.runs = body ? parseInline(body, at, ctx) : [];
      list.items.push(item);
      list.end = ends(line);
      i++;
      afterBlank = false;
      continue;
    }
    // A line that isn't an item belongs to the item above: indented under it, or straight after its words.
    if (list.items.length && (indentOf(text) > indent || !afterBlank) && !FENCE.test(text) && !HEADING.test(text) && !QUOTE.test(text) && !RULE.test(text)) {
      const t = text.trimStart();
      list.items[list.items.length - 1].runs.push({ kind: "text", text: " ", start: start - 1 }, ...parseInline(t, start + text.length - t.length, ctx));
      list.end = ends(line);
      i++;
      continue;
    }
    break;
  }
  return [list, i];
}

function parseLines(lines: Line[], ctx: Ctx): Block[] {
  const blocks: Block[] = [];
  let para: { runs: Run[]; start: number; end: number } | null = null;
  const endPara = () => {
    if (para && para.runs.length) blocks.push({ kind: "p", ...para });
    para = null;
  };
  let li = 0;
  while (li < lines.length) {
    const line = lines[li];
    const { text, start } = line;
    if (!text.trim()) {
      endPara();
      li++;
      continue;
    }
    const fence = FENCE.exec(text);
    if (fence) {
      endPara();
      const [, lead, mark, lang] = fence;
      const closing = new RegExp(`^\\s*${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`);
      let j = li + 1;
      const body: string[] = [];
      // Code indented under a list item loses that indent.
      while (j < lines.length && !closing.test(lines[j].text)) body.push(lines[j++].text.replace(new RegExp(`^ {0,${width(lead)}}`), ""));
      const code = body.join("\n");
      // A fence appears only once its first character of code does.
      if (code.trim()) blocks.push({ kind: "code", lang, code, codeStart: start + text.length + 1, start, end: ends(lines[Math.min(j, lines.length - 1)]) });
      li = j + 1;
      continue;
    }
    if (RULE.test(text)) {
      endPara();
      blocks.push({ kind: "hr", start, end: ends(line) });
      li++;
      continue;
    }
    const h = HEADING.exec(text);
    if (h) {
      endPara();
      const words = text.slice(h[0].length).replace(/[ \t]+#+[ \t]*$/, "");
      if (words.trim()) blocks.push({ kind: "h", level: h[1].length, runs: parseInline(words, start + h[0].length, ctx), start, end: ends(line) });
      li++;
      continue;
    }
    if (QUOTE.test(text)) {
      endPara();
      const inner: Line[] = [];
      let j = li;
      for (; j < lines.length && QUOTE.test(lines[j].text); j++) {
        const q = QUOTE.exec(lines[j].text)![0].length;
        inner.push({ text: lines[j].text.slice(q), start: lines[j].start + q });
      }
      const sub = parseLines(inner, ctx);
      if (sub.length) blocks.push({ kind: "quote", blocks: sub, start, end: ends(lines[j - 1]) });
      li = j;
      continue;
    }
    if (text.includes("|")) {
      const next = lines[li + 1];
      if (next && next.text.includes("-") && DELIM.test(next.text) && (next.text.includes("|") || cellsOf(line).length > 1)) {
        endPara();
        const [table, j] = parseTable(lines, li, ctx);
        blocks.push(table);
        li = j;
        continue;
      }
      // A first row waits for the line under it, which says whether it starts a table.
      if (ctx.partial && li === lines.length - 1 && text.trimStart().startsWith("|")) {
        li++;
        continue;
      }
    }
    if (ITEM.test(text)) {
      endPara();
      const [list, j] = parseList(lines, li, ctx);
      if (list.items.length) blocks.push(list);
      li = j;
      continue;
    }
    const runs = parseInline(text, start, ctx);
    if (para) {
      para.runs.push({ kind: "text", text: " ", start: start - 1 }, ...runs);
      para.end = ends(line);
    } else para = { runs, start, end: ends(line) };
    li++;
  }
  endPara();
  return blocks;
}

function parseFrom(src: string, from: number, partial: boolean): Block[] {
  const lines: Line[] = [];
  let pos = from;
  for (const text of src.slice(from).split("\n")) {
    lines.push({ text, start: pos });
    pos += text.length + 1;
  }
  return parseLines(lines, { end: src.length, partial });
}

/** `partial`: the text may still grow, so formatting left open stays open. */
export function parseMarkdown(src: string, partial = false): Block[] {
  return parseFrom(src, 0, partial);
}

/**
  A parser for one streaming reply. Text only ever grows at its end, and growth can change only
  the last block (or a list just before it), so the blocks before those are kept (the same
  objects, which lets their view skip redrawing) and only the end is read again.
*/
export function createMarkdownParser() {
  let last: { src: string; partial: boolean; blocks: Block[] } | null = null;
  return (src: string, partial = false): Block[] => {
    if (last && last.src === src && last.partial === partial) return last.blocks;
    let n = last && src.startsWith(last.src) ? last.blocks.length - 1 : 0;
    // A list just before the last block can still take it in ("1. a", then "2" becoming "2. b"): it's read again too.
    if (n > 0 && last!.blocks[n - 1].kind === "list") n--;
    const keep = n > 0 ? last!.blocks.slice(0, n) : [];
    const from = n > 0 ? last!.blocks[n].start : 0;
    const blocks = [...keep, ...parseFrom(src, from, partial)];
    last = { src, partial, blocks };
    return blocks;
  };
}

/** Plain text for the clipboard: no markup, links as "text (address)", citations kept as [n], sources listed. */
export function toPlain(src: string, sources?: { title: string; href?: string; domain?: string }[]) {
  const body = src
    .replace(/```\w*\n?/g, "")
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, t: string, u: string) => (t === u ? u : `${t} (${u})`))
    .replace(/\*\*|~~|`/g, "")
    .replace(/^ {0,3}#{1,6}\s+/gm, "")
    .replace(/^ {0,3}>\s?/gm, "")
    .trim();
  if (!sources?.length) return body;
  return `${body}\n\nSources\n${sources.map((s, i) => `[${i + 1}] ${s.title}${s.href ? ` ${s.href}` : s.domain ? ` (${s.domain})` : ""}`).join("\n")}`;
}

/* ---------------- Links ---------------- */

export type MarkdownLinkHandlers = {
  /** Opens a web address; without it, a link opens as a browser would (a new window). */
  openExternal?: (href: string) => void;
  /** Opens a file a reply names; without it, paths stay words. */
  openFile?: (file: FileLink) => void;
};
/** What links in markdown do, for the app to say (MarkdownExternalLink and MarkdownFileLink in T3 Code). */
export const MarkdownLinks = createContext<MarkdownLinkHandlers>({});

function MdLink({ href, file, children }: { href?: string; file?: FileLink; children: ReactNode }) {
  const links = useContext(MarkdownLinks);
  if (file) {
    const open = links.openFile;
    if (!open) return <>{children}</>;
    const where = file.line ? `${file.path}, line ${file.line}` : file.path;
    return (
      <a className="l-md-link" data-file href={`#${file.path}`} title={`Open ${where}`} onClick={(e) => (e.preventDefault(), open(file))}>
        {children}
      </a>
    );
  }
  if (!href)
    return (
      <span className="l-md-link" data-pending>
        {children}
      </span>
    );
  // Only the web and mail: a javascript: address stays words.
  if (!/^(?:https?:|mailto:)/i.test(href)) return <>{children}</>;
  const open = links.openExternal;
  return (
    <a className="l-md-link" href={href} target="_blank" rel="noreferrer noopener" title={href} onClick={open ? (e) => (e.preventDefault(), open(href)) : undefined}>
      {children}
    </a>
  );
}

/* ---------------- Rendering ---------------- */

export type RenderOptions = {
  /** Chunk starts while streaming; null once settled (plain strings). */
  chunks: number[] | null;
  /** Wrap sentences so a citation can light the one it supports. */
  sentences?: boolean;
  litSentence?: number | null;
  litSources?: number[] | null;
  renderCite?: (ids: number[], key: number, sentence: number | null) => ReactNode;
};

/** Splits a text run at chunk starts; each piece keeps a stable key so it animates once. */
function chunked(text: string, start: number, o: RenderOptions, cls?: string): ReactNode {
  if (!o.chunks) return text;
  const end = start + text.length;
  const cuts = o.chunks.filter((c) => c > start && c < end);
  const points = [start, ...cuts, end];
  return points.slice(0, -1).map((p, i) => (
    <span key={p} className={cls ? `l-chunk ${cls}` : "l-chunk"}>
      {text.slice(p - start, points[i + 1] - start)}
    </span>
  ));
}

function renderRuns(runs: Run[], o: RenderOptions, sentence: number | null): ReactNode[] {
  return runs.map((r) => {
    switch (r.kind) {
      case "text":
        return <Fragment key={`t${r.start}`}>{chunked(r.text, r.start, o)}</Fragment>;
      case "code": {
        const code = <code key={`c${r.start}`}>{chunked(r.text, r.start, o)}</code>;
        return r.file ? (
          <MdLink key={`c${r.start}`} file={r.file}>
            {code}
          </MdLink>
        ) : (
          code
        );
      }
      case "strong":
        return <strong key={`s${r.start}`}>{renderRuns(r.runs, o, sentence)}</strong>;
      case "em":
        return <em key={`e${r.start}`}>{renderRuns(r.runs, o, sentence)}</em>;
      case "del":
        return <del key={`d${r.start}`}>{renderRuns(r.runs, o, sentence)}</del>;
      case "link":
        return (
          <MdLink key={`a${r.start}`} href={r.href} file={r.file}>
            {renderRuns(r.runs, o, sentence)}
          </MdLink>
        );
      case "cite":
        return <Fragment key={`k${r.start}`}>{o.renderCite?.(r.ids, r.start, sentence) ?? <sup>[{r.ids.join(",")}]</sup>}</Fragment>;
    }
  });
}

type Segment = { start: number; runs: Run[]; cites: number[] };

/** Groups runs into sentences. A citation right after a full stop belongs to that sentence. */
function toSentences(runs: Run[]): Segment[] {
  const segs: Segment[] = [];
  let cur: Segment = { start: runs[0]?.start ?? 0, runs: [], cites: [] };
  const close = () => {
    if (cur.runs.length) segs.push(cur);
  };
  const isBlank = (s: Segment) => s.runs.every((r) => r.kind === "text" && !r.text.trim());
  for (const r of runs) {
    if (r.kind === "cite") {
      const target = isBlank(cur) && segs.length ? segs[segs.length - 1] : cur;
      target.runs.push(r);
      target.cites.push(...r.ids);
      continue;
    }
    if (r.kind !== "text") {
      cur.runs.push(r);
      continue;
    }
    const re = /[.!?]["')\]]?\s+/g;
    let from = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(r.text))) {
      const cut = m.index + m[0].length;
      cur.runs.push({ kind: "text", text: r.text.slice(from, cut), start: r.start + from });
      close();
      cur = { start: r.start + cut, runs: [], cites: [] };
      from = cut;
    }
    if (from < r.text.length) cur.runs.push({ kind: "text", text: r.text.slice(from), start: r.start + from });
  }
  close();
  return segs;
}

function renderInline(runs: Run[], o: RenderOptions): ReactNode[] {
  if (!o.sentences) return renderRuns(runs, o, null);
  return toSentences(runs).map((s) => {
    const lit = (o.litSentence !== null && o.litSentence === s.start) || (!!o.litSources?.length && s.cites.some((c) => o.litSources!.includes(c)));
    return (
      <span key={`z${s.start}`} className="l-sent" data-lit={lit || undefined}>
        {renderRuns(s.runs, o, s.start)}
      </span>
    );
  });
}

/** Fence names, to the highlighter's languages (the one Files and Review use, through app/code.tsx). */
const LANGS: Record<string, Lang> = { ts: "ts", typescript: "ts", mts: "ts", cts: "ts", tsx: "tsx", jsx: "tsx", js: "js", javascript: "js", mjs: "js", cjs: "js", json: "json", jsonc: "json", json5: "json", css: "css", scss: "css", less: "css", bash: "bash", sh: "bash", shell: "bash", zsh: "bash", console: "bash", shellsession: "bash", html: "html", xml: "html", svg: "html", vue: "html", svelte: "html" };

/** Code in its colours. While it streams, each token is split at the chunks inside it, so new code still comes into focus. */
function highlighted(code: string, at: number, lang: Lang, o: RenderOptions): ReactNode[] {
  const out: ReactNode[] = [];
  let pos = at;
  tokenize(code, lang).forEach((line, n) => {
    if (n > 0) {
      out.push("\n");
      pos++;
    }
    for (const t of line) {
      const s = pos;
      pos += t.text.length;
      out.push(
        t.kind ? (
          <span key={s} className={`l-tok-${t.kind}`}>
            {chunked(t.text, s, o)}
          </span>
        ) : (
          <Fragment key={s}>{chunked(t.text, s, o)}</Fragment>
        ),
      );
    }
  });
  return out;
}

/** A fence: its language, a copy button, and the code in colour (T3 Code: MarkdownCodeBlock.tsx). */
function CodeBlock({ b, o }: { b: Extract<Block, { kind: "code" }>; o: RenderOptions }) {
  const lang = LANGS[b.lang.toLowerCase()];
  return (
    <div className="l-md-code l-chunk">
      <div className="l-md-code-bar">
        <span>{b.lang || "code"}</span>
        <CopyButton value={b.code} size="sm" variant="ghost" label="Copy" />
      </div>
      <pre>
        <code>{lang && b.code.length < 200_000 ? highlighted(b.code, b.codeStart, lang, o) : chunked(b.code, b.codeStart, o)}</code>
      </pre>
    </div>
  );
}

const keyOf = (b: Block) => `${b.kind}${b.start}`;

function renderBlock(b: Block, o: RenderOptions): ReactNode {
  switch (b.kind) {
    case "p":
      return <p>{renderInline(b.runs, o)}</p>;
    case "h":
      return b.level <= 2 ? <h3>{renderInline(b.runs, o)}</h3> : <h4>{renderInline(b.runs, o)}</h4>;
    case "hr":
      return <hr className={o.chunks ? "l-chunk" : undefined} />;
    case "quote":
      return (
        <blockquote>
          {b.blocks.map((x) => (
            <Fragment key={keyOf(x)}>{renderBlock(x, o)}</Fragment>
          ))}
        </blockquote>
      );
    case "code":
      return <CodeBlock b={b} o={o} />;
    case "table":
      // Its own width, up to the reply's; wider, it scrolls sideways (T3 Code's MarkdownTable).
      return (
        <div className="l-md-table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, k) => (
                  <th key={k} style={b.align[k] ? { textAlign: b.align[k] } : undefined}>
                    {renderInline(c.runs, o)}
                  </th>
                ))}
              </tr>
            </thead>
            {b.rows.length > 0 && (
              <tbody>
                {b.rows.map((r) => (
                  <tr key={r.start} className={o.chunks ? "l-chunk" : undefined}>
                    {r.cells.map((c, k) => (
                      <td key={k} style={b.align[k] ? { textAlign: b.align[k] } : undefined}>
                        {renderInline(c.runs, o)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      );
    case "list": {
      const Tag = b.ordered ? "ol" : "ul";
      return (
        <Tag start={b.ordered && b.first !== undefined && b.first !== 1 ? b.first : undefined}>
          {b.items.map((it) =>
            // The marker waits for the item's first word.
            it.runs.length || it.children.length ? (
              <li key={`i${it.start}`} className={o.chunks ? "l-chunk" : undefined} data-task={it.task}>
                {it.task && (
                  <span className="l-md-task" role="img" aria-label={it.task === "done" ? "Done" : "Not done"}>
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path d="m4.5 8.25 2.25 2.25 4.75-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
                {renderInline(it.runs, o)}
                {it.children.map((x) => (
                  <Fragment key={keyOf(x)}>{renderBlock(x, o)}</Fragment>
                ))}
              </li>
            ) : null,
          )}
        </Tag>
      );
    }
  }
}

/** How many chunk starts fall in [from, to): chunks only ever grow at the end, so the same count is the same chunks. */
function chunksIn(chunks: number[], from: number, to: number) {
  const at = (x: number) => {
    let lo = 0;
    let hi = chunks.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (chunks[m] < x) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  return at(to) - at(from);
}

/** A block redraws when it changed, its chunks did, or a citation lit something; a finished block sits still while the next streams. */
const MdBlock = memo(
  function MdBlock({ b, o }: { b: Block; o: RenderOptions }) {
    return <>{renderBlock(b, o)}</>;
  },
  (a, z) => {
    if (a.b !== z.b || a.o.sentences !== z.o.sentences) return false;
    if (a.o.sentences && (a.o.litSentence !== z.o.litSentence || String(a.o.litSources ?? "") !== String(z.o.litSources ?? ""))) return false;
    if (!a.o.chunks || !z.o.chunks) return a.o.chunks === z.o.chunks;
    return chunksIn(a.o.chunks, a.b.start, a.b.end + 1) === chunksIn(z.o.chunks, z.b.start, z.b.end + 1);
  },
);

export function renderMarkdown(blocks: Block[], o: RenderOptions): ReactNode {
  return blocks.map((b) => <MdBlock key={keyOf(b)} b={b} o={o} />);
}
