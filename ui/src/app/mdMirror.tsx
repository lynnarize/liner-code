/*
  Markdown styled as you type. The composer stays a plain textarea (its caret, selection, IME and
  undo are the system's), with its text made transparent over a mirror that draws the same
  characters with Markdown's look. Nothing in the mirror may change a glyph's width, or the
  caret would drift from the text: bold is a stroke, italic is the face slanted, code is a wash
  behind the same letters, and the marks themselves (** ` # > -) go quiet.
*/
import type { ReactNode } from "react";

type Tok = { text: string; cls?: string };

/** Inline marks in one line: code, bold, italic, strike, links, mentions, skills. */
function inline(s: string): Tok[] {
  const out: Tok[] = [];
  const re =
    /(`+)([^`\n]+?)\1|(?<![\w*])(\*\*|__)(?=\S)(.+?\S)\3|(?<![\w*])(\*|_)(?=[^\s*_])([^*_\n]*?[^\s*_])\5(?![\w*])|(~~)(?=\S)(.+?\S)~~|(\[)([^\]\n]+)(\]\()([^)\s]+)(\))|(^|[\s(])(@[\w./-]+)|(^|\s)(\$[\w:.-]+)|(https?:\/\/[^\s)]+)/g;
  let at = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    if (m[1]) out.push({ text: m[1], cls: "mk" }, { text: m[2], cls: "code" }, { text: m[1], cls: "mk" });
    else if (m[3]) out.push({ text: m[3], cls: "mk" }, ...inline(m[4]).map((t) => ({ ...t, cls: `b ${t.cls ?? ""}`.trim() })), { text: m[3], cls: "mk" });
    else if (m[5]) out.push({ text: m[5], cls: "mk" }, ...inline(m[6]).map((t) => ({ ...t, cls: `i ${t.cls ?? ""}`.trim() })), { text: m[5], cls: "mk" });
    else if (m[7]) out.push({ text: "~~", cls: "mk" }, { text: m[8], cls: "s" }, { text: "~~", cls: "mk" });
    else if (m[9]) out.push({ text: "[", cls: "mk" }, { text: m[10], cls: "a" }, { text: "](", cls: "mk" }, { text: m[12], cls: "url" }, { text: ")", cls: "mk" });
    else if (m[15]) out.push(...(m[14] ? [{ text: m[14] }] : []), { text: m[15], cls: "at" });
    else if (m[17]) out.push(...(m[16] ? [{ text: m[16] }] : []), { text: m[17], cls: "at" });
    else if (m[18]) out.push({ text: m[18], cls: "url" });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

/** The whole draft, line by line: fences, headings, quotes and lists first, then inline marks. */
export function mirror(text: string): ReactNode {
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  let fence = false;
  lines.forEach((line, n) => {
    const toks: Tok[] = [];
    const isFence = /^\s*(```|~~~)/.test(line);
    if (isFence || fence) {
      toks.push({ text: line, cls: isFence ? "mk fence" : "cb" });
      if (isFence) fence = !fence;
    } else {
      let rest = line;
      const h = /^(#{1,6})(\s+)/.exec(rest);
      const q = /^(\s*>+)(\s?)/.exec(rest);
      const li = /^(\s*)([-*+]|\d{1,3}[.)])(\s+)/.exec(rest);
      const box = /^(\s*[-*+]\s+)(\[[ xX]\])(\s)/.exec(rest);
      // A slash command only counts as the message's first word.
      const cmd = n === 0 ? /^(\/[\w:.-]+)/.exec(rest) : null;
      let lineCls: string | undefined;
      if (h) {
        toks.push({ text: h[1] + h[2], cls: "mk" });
        rest = rest.slice(h[0].length);
        lineCls = "h";
      } else if (q) {
        toks.push({ text: q[1], cls: "mk q-mk" }, { text: q[2] });
        rest = rest.slice(q[0].length);
        lineCls = "q";
      } else if (box) {
        toks.push({ text: box[1], cls: "li" }, { text: box[2], cls: "mk" }, { text: box[3] });
        rest = rest.slice(box[0].length);
      } else if (li) {
        toks.push({ text: li[1] }, { text: li[2], cls: "li" }, { text: li[3] });
        rest = rest.slice(li[0].length);
      } else if (cmd) {
        toks.push({ text: cmd[1], cls: "at" });
        rest = rest.slice(cmd[0].length);
      }
      for (const t of inline(rest)) toks.push(lineCls ? { ...t, cls: `${lineCls} ${t.cls ?? ""}`.trim() } : t);
    }
    nodes.push(
      ...toks.map((t, i) => (t.cls ? <span key={`${n}.${i}`} className={t.cls.split(" ").map((c) => `md-${c}`).join(" ")}>{t.text}</span> : t.text)),
      n < lines.length - 1 ? "\n" : "",
    );
  });
  // A draft ending in a new line still has that last line's height.
  nodes.push("​");
  return nodes;
}
