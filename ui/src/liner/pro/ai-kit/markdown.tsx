/*
  A deliberately small markdown for AI replies: paragraphs, - and 1. lists, ### headings,
  **bold**, `code`, ``` fences and [n] / [1,3] citations.

  It parses whatever slice has been revealed, tracking source offsets so each streamed
  chunk renders as a span keyed by where it starts. List markers and code fences never
  show before their first word, and an unclosed ** is simply bold until it closes.
*/
import { Fragment, type ReactNode } from "react";
import { CopyButton } from "../../components/copy-button/copy-button";

export type Run =
  | { kind: "text"; text: string; start: number }
  | { kind: "code"; text: string; start: number }
  | { kind: "cite"; ids: number[]; start: number }
  | { kind: "strong"; runs: Run[]; start: number };

export type Block =
  | { kind: "p"; runs: Run[]; start: number }
  | { kind: "h"; runs: Run[]; start: number }
  | { kind: "list"; ordered: boolean; items: { runs: Run[]; start: number }[]; start: number }
  | { kind: "code"; lang: string; code: string; codeStart: number; start: number };

/* ---------------- Parsing ---------------- */

function parseInline(text: string, base: number): Run[] {
  const out: Run[] = [];
  let i = 0;
  let buf = "";
  let bufStart = base;
  const flush = () => {
    if (buf) out.push({ kind: "text", text: buf, start: bufStart });
    buf = "";
  };
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      flush();
      const close = text.indexOf("**", i + 2);
      const inner = close < 0 ? text.slice(i + 2) : text.slice(i + 2, close);
      if (inner) out.push({ kind: "strong", runs: parseInline(inner, base + i + 2), start: base + i });
      i = close < 0 ? text.length : close + 2;
      bufStart = base + i;
      continue;
    }
    if (text[i] === "`") {
      flush();
      const close = text.indexOf("`", i + 1);
      const inner = close < 0 ? text.slice(i + 1) : text.slice(i + 1, close);
      if (inner) out.push({ kind: "code", text: inner, start: base + i + 1 });
      i = close < 0 ? text.length : close + 1;
      bufStart = base + i;
      continue;
    }
    const cite = /^\[(\d+(?:\s*,\s*\d+)*)\]/.exec(text.slice(i));
    if (cite) {
      flush();
      out.push({ kind: "cite", ids: cite[1].split(",").map((n) => Number(n.trim())), start: base + i });
      i += cite[0].length;
      bufStart = base + i;
      continue;
    }
    if (!buf) bufStart = base + i;
    buf += text[i];
    i++;
  }
  flush();
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines: { text: string; start: number }[] = [];
  let pos = 0;
  for (const line of src.split("\n")) {
    lines.push({ text: line, start: pos });
    pos += line.length + 1;
  }
  let para: { runs: Run[]; start: number } | null = null;
  let list: Extract<Block, { kind: "list" }> | null = null;
  const endPara = () => {
    if (para && para.runs.length) blocks.push({ kind: "p", ...para });
    para = null;
  };
  const endList = () => {
    if (list && list.items.length) blocks.push(list);
    list = null;
  };

  for (let li = 0; li < lines.length; li++) {
    const { text, start } = lines[li];
    const fence = /^```(\w*)\s*$/.exec(text);
    if (fence) {
      endPara();
      endList();
      const codeStart = start + text.length + 1;
      let j = li + 1;
      const body: string[] = [];
      while (j < lines.length && !/^```\s*$/.test(lines[j].text)) body.push(lines[j++].text);
      const code = body.join("\n");
      // A fence appears only once its first character of code does.
      if (code.trim()) blocks.push({ kind: "code", lang: fence[1] || "code", code, codeStart, start });
      li = j;
      continue;
    }
    if (!text.trim()) {
      endPara();
      endList();
      continue;
    }
    const h = /^#{1,4}\s+(.*)$/.exec(text);
    if (h) {
      endPara();
      endList();
      if (h[1]) blocks.push({ kind: "h", runs: parseInline(h[1], start + text.length - h[1].length), start });
      continue;
    }
    const item = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(text);
    if (item) {
      endPara();
      const ordered = /\d/.test(item[1]);
      if (list && list.ordered !== ordered) endList();
      if (!list) list = { kind: "list", ordered, items: [], start };
      // The marker waits for the item's first word.
      if (item[2].trim()) list.items.push({ runs: parseInline(item[2], start + text.length - item[2].length), start });
      continue;
    }
    endList();
    const runs = parseInline(text, start);
    if (para) para.runs.push({ kind: "text", text: " ", start: start - 1 }, ...runs);
    else para = { runs, start };
  }
  endPara();
  endList();
  return blocks;
}

/** Plain text for the clipboard: no markup, citations kept as [n], sources listed. */
export function toPlain(src: string, sources?: { title: string; href?: string; domain?: string }[]) {
  const body = src
    .replace(/```\w*\n?/g, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
  if (!sources?.length) return body;
  return `${body}\n\nSources\n${sources.map((s, i) => `[${i + 1}] ${s.title}${s.href ? ` ${s.href}` : s.domain ? ` (${s.domain})` : ""}`).join("\n")}`;
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
    if (r.kind === "text") return <Fragment key={`t${r.start}`}>{chunked(r.text, r.start, o)}</Fragment>;
    if (r.kind === "code") return <code key={`c${r.start}`}>{chunked(r.text, r.start, o)}</code>;
    if (r.kind === "strong") return <strong key={`s${r.start}`}>{renderRuns(r.runs, o, sentence)}</strong>;
    return <Fragment key={`k${r.start}`}>{o.renderCite?.(r.ids, r.start, sentence) ?? <sup>[{r.ids.join(",")}]</sup>}</Fragment>;
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

export function renderMarkdown(blocks: Block[], o: RenderOptions): ReactNode {
  return blocks.map((b) => {
    if (b.kind === "p") return <p key={`p${b.start}`}>{renderInline(b.runs, o)}</p>;
    if (b.kind === "h") return <h4 key={`h${b.start}`}>{renderInline(b.runs, o)}</h4>;
    if (b.kind === "list") {
      const Tag = b.ordered ? "ol" : "ul";
      return (
        <Tag key={`l${b.start}`}>
          {b.items.map((it) => (
            <li key={`i${it.start}`} className={o.chunks ? "l-chunk" : undefined}>
              {renderInline(it.runs, o)}
            </li>
          ))}
        </Tag>
      );
    }
    return (
      <div key={`f${b.start}`} className="l-md-code l-chunk">
        <div className="l-md-code-bar">
          <span>{b.lang}</span>
          <CopyButton value={b.code} size="sm" variant="ghost" label="Copy" />
        </div>
        <pre>
          <code>
            {chunked(b.code, b.codeStart, o)}
          </code>
        </pre>
      </div>
    );
  });
}
