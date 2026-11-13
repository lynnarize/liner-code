/*
  Liner Design's frames as HTML: a small reader that keeps where every tag starts and ends in the
  file, so the engine can give each element its data-l id by adding one attribute and leaving every
  other byte as it was (an agent editing the file with its own tools sees no churned diff), and can
  read or replace one element by that id.

  It reads the way a browser's tokenizer does (tags, attributes in any quoting, comments with their
  empty forms <!--> and <!--->, doctype, raw text in style, textarea and title, and a script's text
  with its escaped states, so `<!-- <script> … </script> -->` inside a script stays script), and
  builds the tree with the browser's commonest implied ends (a p closed by a block, li by li, cells
  and rows by the next one, void elements and self-closing tags inside svg) and its scopes (an end
  tag a browser ignores, like </div> inside a td, is ignored). It isn't a full HTML5 tree builder:
  misnested inline tags aren't reparented, so an element whose end a browser would put elsewhere
  says so (`closedBy`), and replacing it is refused rather than leaving pieces behind.
*/
import { createHash, randomInt } from "node:crypto";

export type Attr = { name: string; value: string; start: number; end: number; vStart: number; vEnd: number };
/**
  An element and where it is in the file: its start tag from `start` to `openEnd`, its insides to
  `innerEnd`, and itself to `end`. `closedBy`: its own end tag ("self"), a start tag a browser also
  ends it at ("start"), an ancestor's end tag ("parent"), the end of the file ("eof"), or nothing
  to close ("void"); `closer`, the ancestor whose end tag it was.
*/
export type El = { tag: string; start: number; nameEnd: number; openEnd: number; innerEnd: number; end: number; attrs: Attr[]; children: Child[]; parent?: El; foreign: boolean; closedBy: "self" | "start" | "parent" | "eof" | "void"; closer?: string };
export type Txt = { text: string; start: number; end: number };
export type Child = El | Txt;
/** `loose`: what in the text a browser would mend or read past (a comment or tag never closed, an end tag with no start), in words. */
export type Doc = { root: El; html: string; loose: string[] };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "noembed", "noframes", "iframe", "plaintext"]);
const P_CLOSERS = new Set(["address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol", "p", "pre", "section", "table", "ul"]);
const SCOPE = new Set(["html", "body", "td", "th", "table", "button", "template", "caption", "marquee", "object", "applet", "svg", "math"]);
/** Where a browser stops looking for an end tag's element (its "has an element in scope"): past one of these, the end tag is ignored. */
const END_SCOPE = new Set(["html", "td", "th", "table", "caption", "marquee", "object", "applet", "template"]);
const TABLE_PARTS = new Set(["table", "tbody", "thead", "tfoot", "tr", "td", "th", "caption", "colgroup"]);
/** Elements a browser also ends at an ancestor's end tag (its implied end tags, and a table's cells and rows). */
/** A browser's formatting elements: an end tag of one, or one ended by another's end tag, gets reparented or carried on past where it ends here. */
const FORMATTING = new Set(["a", "b", "big", "code", "em", "font", "i", "nobr", "s", "small", "strike", "strong", "tt", "u"]);
/** Tags that never get an id: they draw nothing an editor would pick. */
const SKIP = new Set(["script", "style", "template", "noscript", "link", "meta", "base", "title", "head", "html", "br", "wbr", "source", "track", "param"]);
/** Elements whose insides are drawn as one thing: their children get no ids. */
const WHOLE = new Set(["svg", "math", "template", "noscript", "select", "picture", "video", "audio", "canvas", "iframe", "object"]);

export const isEl = (c: Child): c is El => "tag" in c;
const alpha = (c: string | undefined) => !!c && /[A-Za-z]/.test(c);
const space = (c: string | undefined) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";

/** Reads a document (or a fragment) into elements with their offsets. Never throws. */
export function parse(html: string): Doc {
  const n = html.length;
  const root: El = { tag: "#document", start: 0, nameEnd: 0, openEnd: 0, innerEnd: n, end: n, attrs: [], children: [], foreign: false, closedBy: "self" };
  const stack: El[] = [root];
  const loose: string[] = [];
  /** The start tag that last ended an element of each tag by itself (a <div> ending a <p>), to name the cause of a stray end tag. */
  const ended = new Map<string, string>();
  const top = () => stack[stack.length - 1];
  const close = (k: number, at: number, by: El["closedBy"], closer?: string) => {
    // Pops stack[k] and everything above it; the ones above end where this one was closed (implied ends).
    while (stack.length > k) {
      const el = stack.pop()!;
      if (el.end < 0) {
        el.end = el.innerEnd = at;
        el.closedBy = by;
        if (closer) el.closer = closer;
        if (by === "start" && closer) ended.set(el.tag, closer);
      }
    }
  };
  const find = (tag: string, stop: Set<string>) => {
    for (let k = stack.length - 1; k > 0; k--) {
      if (stack[k].tag === tag) return k;
      if (stop.has(stack[k].tag)) return -1;
    }
    return -1;
  };
  const closeIf = (tags: string[], stop: Set<string>, at: number, closer: string) => {
    for (let k = stack.length - 1; k > 0; k--) {
      if (tags.includes(stack[k].tag)) return close(k, at, "start", closer);
      if (stop.has(stack[k].tag)) return;
    }
  };
  const text = (start: number, end: number) => {
    if (end > start) top().children.push({ text: html.slice(start, end), start, end });
  };

  let i = 0;
  let from = 0;
  while (i < n) {
    if (html[i] !== "<") {
      i = html.indexOf("<", i);
      if (i < 0) i = n;
      continue;
    }
    if (html.startsWith("<!--", i)) {
      text(from, i);
      // <!--> and <!---> are whole (empty) comments; else up to the first --> or --!>.
      if (html.startsWith("<!-->", i)) i = from = i + 5;
      else if (html.startsWith("<!--->", i)) i = from = i + 6;
      else {
        const a = html.indexOf("-->", i + 4);
        const b = html.indexOf("--!>", i + 4);
        const e = a < 0 ? b : b < 0 ? a : Math.min(a, b);
        if (e < 0) loose.push("a comment that isn't closed");
        i = from = e < 0 ? n : e + (e === b ? 4 : 3);
      }
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      text(from, i);
      const e = html.indexOf(">", i + 2);
      if (e < 0) loose.push("a <! or <? that isn't closed");
      i = from = e < 0 ? n : e + 1;
      continue;
    }
    if (html[i + 1] === "/" && alpha(html[i + 2])) {
      text(from, i);
      let j = i + 2;
      while (j < n && !space(html[j]) && html[j] !== "/" && html[j] !== ">") j++;
      const tag = html.slice(i + 2, j).toLowerCase();
      const e = html.indexOf(">", j);
      const end = e < 0 ? n : e + 1;
      if (e < 0) loose.push(`an end tag </${tag} that isn't finished`);
      // Not past a scope a browser stops at (a </div> inside a td is ignored); a table's own parts look only within their table.
      const k = find(tag, TABLE_PARTS.has(tag) ? new Set(["html", "template"]) : new Set([...END_SCOPE].filter((x) => x !== tag)));
      if (k > 0) {
        close(k + 1, i, "parent", tag);
        stack[k].end = end;
        stack[k].innerEnd = i;
        stack[k].closedBy = "self";
        stack.length = k;
      } else {
        // Its element was ended already by a start tag a browser ends it at: name that, not the stray end tag.
        const by = ended.get(tag);
        loose.push(by ? `a <${by}> inside a <${tag}> (a browser ends the <${tag}> before the <${by}>, which leaves its </${tag}> over)` : `an end tag </${tag}> with no start`);
      }
      i = from = end;
      continue;
    }
    if (!alpha(html[i + 1])) {
      i++;
      continue;
    }
    // A start tag.
    let j = i + 1;
    while (j < n && !space(html[j]) && html[j] !== "/" && html[j] !== ">") j++;
    const tag = html.slice(i + 1, j).toLowerCase();
    const nameEnd = j;
    const attrs: Attr[] = [];
    let selfClosing = false;
    let done = false;
    while (j < n) {
      while (j < n && (space(html[j]) || html[j] === "/")) {
        if (html[j] === "/" && html[j + 1] === ">") selfClosing = true;
        j++;
      }
      if (j >= n) break;
      if (html[j] === ">") {
        done = true;
        j++;
        break;
      }
      selfClosing = false;
      const aStart = j;
      j++;
      while (j < n && !space(html[j]) && html[j] !== "/" && html[j] !== ">" && html[j] !== "=") j++;
      const name = html.slice(aStart, j).toLowerCase();
      let k = j;
      while (k < n && space(html[k])) k++;
      if (html[k] !== "=") {
        attrs.push({ name, value: "", start: aStart, end: j, vStart: -1, vEnd: -1 });
        continue;
      }
      k++;
      while (k < n && space(html[k])) k++;
      let vStart: number;
      let vEnd: number;
      if (html[k] === '"' || html[k] === "'") {
        const q = html[k];
        vStart = k + 1;
        const e = html.indexOf(q, vStart);
        vEnd = e < 0 ? n : e;
        j = e < 0 ? n : e + 1;
      } else {
        vStart = k;
        while (k < n && !space(html[k]) && html[k] !== ">") k++;
        vEnd = j = k;
      }
      attrs.push({ name, value: decode(html.slice(vStart, vEnd)), start: aStart, end: j, vStart, vEnd });
    }
    if (!done) {
      // A tag the file never finished: the rest is text.
      loose.push(`a <${tag}> tag that isn't finished`);
      i = n;
      break;
    }
    text(from, i);
    const openEnd = j;
    // The ends a browser implies before this tag.
    if (P_CLOSERS.has(tag)) closeIf(["p"], SCOPE, i, tag);
    if (/^h[1-6]$/.test(tag) && /^h[1-6]$/.test(top().tag)) close(stack.length - 1, i, "start", tag);
    if (tag === "li") closeIf(["li"], new Set([...SCOPE, "ul", "ol", "menu"]), i, tag);
    if (tag === "dt" || tag === "dd") closeIf(["dt", "dd"], new Set([...SCOPE, "dl"]), i, tag);
    if (tag === "option" && top().tag === "option") close(stack.length - 1, i, "start", tag);
    if (tag === "optgroup") closeIf(["option", "optgroup"], new Set(["select", ...SCOPE]), i, tag);
    if (tag === "tr") closeIf(["tr"], new Set(["table", "tbody", "thead", "tfoot", "html"]), i, tag);
    if (tag === "td" || tag === "th") closeIf(["td", "th"], new Set(["tr", "table", "html"]), i, tag);
    if (tag === "tbody" || tag === "thead" || tag === "tfoot") closeIf(["tbody", "thead", "tfoot"], new Set(["table", "html"]), i, tag);
    const parent = top();
    const foreign = parent.foreign || tag === "svg" || tag === "math";
    const el: El = { tag, start: i, nameEnd, openEnd, innerEnd: -1, end: -1, attrs, children: [], parent, foreign, closedBy: "self" };
    parent.children.push(el);
    i = from = openEnd;
    if (VOID.has(tag) || (selfClosing && foreign)) {
      el.end = el.innerEnd = openEnd;
      el.closedBy = "void";
      continue;
    }
    if (RAW.has(tag) && !foreign) {
      // Its insides are text up to its own end tag (a script's, past its escaped parts).
      const stop = tag === "plaintext" ? n : tag === "script" ? scriptEnd(html, openEnd) : rawEnd(html, openEnd, tag);
      if (stop > openEnd) el.children.push({ text: html.slice(openEnd, stop), start: openEnd, end: stop });
      el.innerEnd = stop;
      if (stop >= n) {
        el.end = n;
        el.closedBy = "eof";
        i = from = n;
        break;
      }
      const e = html.indexOf(">", stop);
      el.end = e < 0 ? n : e + 1;
      i = from = el.end;
      continue;
    }
    stack.push(el);
  }
  text(from, n);
  close(1, n, "eof");
  return { root, html, loose };
}

/** Is `</tag` followed by what ends a tag's name at i? */
const endTagAt = (html: string, i: number, tag: string) => html.startsWith("</", i) && html.slice(i + 2, i + 2 + tag.length).toLowerCase() === tag && /[\s/>]/.test(html[i + 2 + tag.length] ?? "");
const startTagAt = (html: string, i: number, tag: string) => html[i] === "<" && html.slice(i + 1, i + 1 + tag.length).toLowerCase() === tag && /[\s/>]/.test(html[i + 1 + tag.length] ?? "");

/** Where raw text (style, textarea, title…) ends: at its own end tag, else the end of the file. */
function rawEnd(html: string, from: number, tag: string) {
  for (let i = html.indexOf("</", from); i >= 0; i = html.indexOf("</", i + 2)) if (endTagAt(html, i, tag)) return i;
  return html.length;
}

/**
  Where a script's text ends, as the HTML spec's script data states read it: `<!--` starts an
  escaped part, where `<script` starts a double-escaped one that its own `</script` ends; `-->`
  ends either, and only a `</script` outside a double-escaped part ends the script.
*/
export function scriptEnd(html: string, from: number) {
  const n = html.length;
  let state: "data" | "escaped" | "double" = "data";
  for (let i = from; i < n; i++) {
    const c = html[i];
    if (state === "data") {
      if (c !== "<") continue;
      if (endTagAt(html, i, "script")) return i;
      if (html.startsWith("<!--", i)) {
        // <!--> and <!---> close at once.
        let j = i + 4;
        while (html[j] === "-") j++;
        if (html[j] === ">") i = j;
        else {
          state = "escaped";
          i = j - 1;
        }
      }
    } else if (state === "escaped") {
      if (c === "-" && html.startsWith("-->", i)) {
        state = "data";
        i += 2;
      } else if (c === "<") {
        if (endTagAt(html, i, "script")) return i;
        if (startTagAt(html, i, "script")) {
          state = "double";
          i += 7;
        }
      }
    } else if (c === "-" && html.startsWith("-->", i)) {
      state = "data";
      i += 2;
    } else if (c === "<" && endTagAt(html, i, "script")) {
      state = "escaped";
      i += 8;
    }
  }
  return n;
}

/** Can this element's source be swapped for another without leaving pieces? Not when a browser would end it somewhere else than this reader did. */
export function cleanEnd(el: El) {
  if (el.closedBy !== "parent" || el.closer === "body" || el.closer === "html") return true;
  // Ended by an ancestor's end tag: a browser does the same unless either one is a formatting element (b, i, a…), which it carries on or reparents.
  return !FORMATTING.has(el.tag) && !FORMATTING.has(el.closer ?? "");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", mdash: "—", ndash: "–", hellip: "…", copy: "©", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", times: "×" };
/** The text an attribute or a run of text says (the common named entities and every numbered one). */
export function decode(s: string) {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

export const attr = (el: El, name: string) => el.attrs.find((a) => a.name === name);
const each = function* (el: El): Generator<El> {
  for (const c of el.children)
    if (isEl(c)) {
      yield c;
      yield* each(c);
    }
};
/** Every element of the document, in the order they're written. */
export const elements = (doc: Doc) => [...each(doc.root)];

/** The element whose insides the editor works on: <body>, or for a fragment the document itself. */
export function contentRoot(doc: Doc): El {
  return elements(doc).find((e) => e.tag === "body") ?? doc.root;
}

/** The elements that carry an id: everything drawn inside <body> (body too), not inside svg and the like. */
export function addressable(doc: Doc): El[] {
  const top = contentRoot(doc);
  const out: El[] = [];
  const walk = (el: El) => {
    for (const c of el.children) {
      if (!isEl(c)) continue;
      // A page with <html> but no <body> tag: what's in <html> beside the head is its body.
      if (c.tag === "html") walk(c);
      if (SKIP.has(c.tag)) continue;
      out.push(c);
      if (!WHOLE.has(c.tag)) walk(c);
    }
  };
  if (top.tag === "body") out.push(top);
  walk(top);
  return out;
}

/** A good data-l id: short, no spaces or quotes. */
export const goodId = (v: string) => /^[A-Za-z0-9_-]{1,32}$/.test(v);

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const CHARS = `${LETTERS}0123456789`;
/** A short id that isn't one of these. */
export function freshId(taken: Set<string>, seed?: string) {
  let n = 0;
  for (let len = 4; ; len++)
    for (let tries = 0; tries < 40; tries++) {
      let id: string;
      if (seed === undefined) {
        id = LETTERS[randomInt(LETTERS.length)];
        while (id.length < len) id += CHARS[randomInt(CHARS.length)];
      } else {
        // From the page itself: the same page gets the same ids each time it's read, written or not.
        const h = createHash("sha1").update(`${seed}\0${taken.size}\0${n++}`).digest();
        id = LETTERS[h[0] % LETTERS.length];
        for (let k = 1; id.length < len; k++) id += CHARS[h[k] % CHARS.length];
      }
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
}

type Splice = { at: number; del: number; ins: string };
const splice = (html: string, edits: Splice[]) => {
  let out = html;
  for (const e of [...edits].sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.ins + out.slice(e.at + e.del);
  return out;
};

/**
  Gives every addressable element without a data-l id one, and a fresh one to an element whose id
  repeats an earlier one's (or isn't a good id). Nothing else in the file changes: an id goes in
  right after the tag's name, `<div data-l="k3x9" class="…">`. Stamping twice is stamping once.
*/
export function stamp(html: string): { html: string; added: number; ok: boolean } {
  const doc = parse(html);
  const seed = createHash("sha1").update(html).digest("hex");
  const all = elements(doc);
  const taken = new Set<string>();
  for (const el of all) {
    const a = attr(el, "data-l");
    if (a && goodId(a.value)) taken.add(a.value);
  }
  const seen = new Set<string>();
  const edits: (Splice & { id: string })[] = [];
  for (const el of addressable(doc)) {
    const a = attr(el, "data-l");
    if (a && goodId(a.value) && !seen.has(a.value)) {
      seen.add(a.value);
      continue;
    }
    const id = freshId(taken, seed);
    seen.add(id);
    if (!a) edits.push({ at: el.nameEnd, del: 0, ins: ` data-l="${id}"`, id });
    else if (a.vStart < 0) edits.push({ at: a.end, del: 0, ins: `="${id}"`, id });
    else {
      // Keep its quotes as written; an unquoted value gets quotes only when it must.
      const quoted = html[a.vStart - 1] === '"' || html[a.vStart - 1] === "'";
      edits.push({ at: a.vStart, del: a.vEnd - a.vStart, ins: quoted ? id : `"${id}"`, id });
    }
  }
  if (!edits.length) return { html, added: 0, ok: true };
  const out = splice(html, edits);
  return { html: out, added: edits.length, ok: stampGuard.undoes(html, out, edits) };
}

/**
  The guard on every stamp the engine writes: read the stamped page again, find each id it gave
  as an attribute of the element it was meant for, take it back out, and the page must be the
  one it started from, byte for byte. When it isn't, the stamps stay in memory and aren't written.
*/
function undoes(input: string, out: string, edits: { at: number; del: number; ins: string; id: string }[]) {
  const doc = parse(out);
  const found = new Map<string, Attr>();
  for (const el of addressable(doc)) {
    const a = attr(el, "data-l");
    if (a && edits.some((e) => e.id === a.value)) {
      if (found.has(a.value)) return false;
      found.set(a.value, a);
    }
  }
  const back: Splice[] = [];
  for (const e of edits) {
    const a = found.get(e.id);
    if (!a) return false;
    if (e.ins === ` data-l="${e.id}"`) {
      if (out.slice(a.start - 1, a.end) !== e.ins) return false;
      back.push({ at: a.start - 1, del: e.ins.length, ins: "" });
    } else if (e.ins === `="${e.id}"`) back.push({ at: a.end - e.ins.length, del: e.ins.length, ins: "" });
    else {
      const was = input.slice(e.at, e.at + e.del);
      const start = out[a.vStart - 1] === '"' && e.ins.startsWith('"') ? a.vStart - 1 : a.vStart;
      back.push({ at: start, del: e.ins.length, ins: was });
    }
  }
  return splice(out, back) === input;
}

/** The guard stamp() runs, as an object so a test can stand a failing one in (canvas.test.ts proves what happens when it says no). */
export const stampGuard = { undoes };

/** The element with this data-l id. */
export function byId(doc: Doc, id: string) {
  return addressable(doc).find((e) => attr(e, "data-l")?.value === id);
}

export const outer = (doc: Doc, el: El) => doc.html.slice(el.start, el.end);

/** Sets the first element of a piece of HTML to carry this id (in place of any it had). */
export function withId(piece: string, id: string) {
  const doc = parse(piece);
  const first = doc.root.children.find(isEl);
  if (!first) throw new Error("The new html has no element in it.");
  const a = attr(first, "data-l");
  if (!a) return splice(piece, [{ at: first.nameEnd, del: 0, ins: ` data-l="${id}"` }]);
  if (a.vStart < 0) return splice(piece, [{ at: a.end, del: 0, ins: `="${id}"` }]);
  const quoted = piece[a.vStart - 1] === '"' || piece[a.vStart - 1] === "'";
  return splice(piece, [{ at: a.vStart, del: a.vEnd - a.vStart, ins: quoted ? id : `"${id}"` }]);
}

/** Every element inside this one, and itself. */
const within = (el: El) => [el, ...each(el)];

/** Refuses an element whose source can't be swapped cleanly (cleanEnd), in a plain sentence. */
export function swappable(el: El, id: string) {
  if (!within(el).every(cleanEnd)) throw new Error(`The element ${id} is written with its tags crossed (like <b><i></b></i>), so a browser ends it elsewhere than its source does; changing it here could leave pieces behind. Nothing was changed: fix its tags in the file first.`);
}

/** Elements a browser closes by itself, so a piece may leave them open (`<li>One<li>Two`). */
const OPEN_OK = new Set(["p", "li", "dt", "dd", "option", "optgroup", "rb", "rp", "rt", "rtc", "tbody", "thead", "tfoot", "tr", "td", "th", "caption", "colgroup", "html", "head", "body"]);

/**
  Refuses a piece of HTML that would change the page beyond where it goes: a comment or tag never
  closed, an end tag with no start in the piece, a script or style that runs on, an element left
  open that a browser wouldn't close by itself. Read with the same rules as the frame.
*/
export function balanced(piece: string) {
  const doc = parse(piece);
  const no = (what: string) => new Error(`That html has ${what}, so it would change the page beyond its own place. Nothing was changed.`);
  if (doc.loose.length) throw no(doc.loose[0]);
  for (const el of elements(doc)) {
    if (el.closedBy !== "eof" && el.closedBy !== "parent") continue;
    if (RAW.has(el.tag)) throw no(`a <${el.tag}> that isn't closed`);
    if (!OPEN_OK.has(el.tag)) throw no(`a <${el.tag}> that isn't closed`);
  }
  return doc;
}

/** Elements whose start tag closes an open <p> (the HTML spec's list). */
const CLOSES_P = new Set([...P_CLOSERS, "center", "dir", "listing", "plaintext", "search", "summary", "xmp", "li", "dd", "dt"]);
/** HTML tags a browser breaks out of svg or math for (the spec's list). */
const BREAKOUT = new Set(["b", "big", "blockquote", "body", "br", "center", "code", "dd", "div", "dl", "dt", "em", "embed", "h1", "h2", "h3", "h4", "h5", "h6", "head", "hr", "i", "img", "li", "listing", "menu", "meta", "nobr", "ol", "p", "pre", "ruby", "s", "small", "span", "strong", "strike", "sub", "sup", "table", "tt", "u", "ul", "var"]);
/** What may sit directly inside a table's own parts and a select; anything else a browser moves out. */
const ALLOWED_IN: Record<string, Set<string>> = {
  table: new Set(["caption", "colgroup", "col", "thead", "tbody", "tfoot", "tr", "script", "template", "style"]),
  thead: new Set(["tr", "script", "template", "style"]),
  tbody: new Set(["tr", "script", "template", "style"]),
  tfoot: new Set(["tr", "script", "template", "style"]),
  tr: new Set(["td", "th", "script", "template", "style"]),
  colgroup: new Set(["col", "template"]),
  select: new Set(["option", "optgroup", "hr", "script", "template"]),
};
/** A table's parts, and the parents a browser keeps each one in; elsewhere it drops the tag. */
const TABLE_HOME: Record<string, Set<string>> = {
  td: new Set(["tr", "tbody", "thead", "tfoot", "table"]),
  th: new Set(["tr", "tbody", "thead", "tfoot", "table"]),
  tr: new Set(["tbody", "thead", "tfoot", "table"]),
  tbody: new Set(["table"]),
  thead: new Set(["table"]),
  tfoot: new Set(["table"]),
  caption: new Set(["table"]),
  colgroup: new Set(["table"]),
  col: new Set(["colgroup", "table"]),
};

/** In svg or math, outside the places that take HTML again (foreignObject, desc, title; math's text elements)? */
function inForeign(chain: string[]) {
  for (const t of chain) {
    if (t === "foreignobject" || t === "desc" || t === "title" || t === "mi" || t === "mo" || t === "mn" || t === "ms" || t === "mtext" || t === "annotation-xml") return false;
    if (t === "svg" || t === "math") return true;
  }
  return false;
}

/**
  Refuses a piece a browser would put somewhere else than where it's written, so the file and
  the page would disagree: an <html>, <head> or <body> tag; a block inside a <p>; a link inside a
  link, a button in a button, a form in a form; anything but a table's own parts directly inside
  them, or a table part outside one; anything but options in a select; HTML straight inside svg or
  math. Checked inside the piece and against the element it goes into (`into`: that element and
  those around it, nearest first). Only what the HTML spec says a browser moves: else it's allowed.
*/
export function placeable(pd: Doc, into: El | undefined, replacing?: string) {
  const no = (what: string) => new Error(`That html has ${what}, which a browser would put somewhere else than where it's written. Nothing was changed.`);
  const around: string[] = [];
  for (let p = into; p && p.tag !== "#document"; p = p.parent) around.push(p.tag);
  const walk = (el: El, chain: string[]) => {
    const t = el.tag;
    const parent = chain[0];
    const foreign = inForeign(chain);
    // Only the page's own one, swapped for itself.
    if ((t === "html" || t === "head" || t === "body") && !(chain === around && t === replacing)) throw no(`a <${t}> tag (a page has only one, and a browser merges any other into it)`);
    if (foreign) {
      if (BREAKOUT.has(t)) throw no(`a <${t}> straight inside <${chain.find((x) => x === "svg" || x === "math")}>`);
    } else {
      if (CLOSES_P.has(t)) {
        for (const a of chain) {
          if (a === "p") throw no(`a <${t}> inside a <p> (a browser ends the <p> before it)`);
          if (SCOPE.has(a)) break;
        }
      }
      if (t === "a" && chain.includes("a")) throw no("a link inside a link");
      if (t === "form" && chain.includes("form")) throw no("a form inside a form");
      if (t === "button") {
        for (const a of chain) {
          if (a === "button") throw no("a button inside a button");
          if (SCOPE.has(a) && a !== "button") break;
        }
      }
      if (parent && ALLOWED_IN[parent] && !ALLOWED_IN[parent].has(t)) throw no(`a <${t}> directly inside a <${parent}>`);
      if (TABLE_HOME[t] && !(parent && TABLE_HOME[t].has(parent))) throw no(`a <${t}> outside ${t === "col" ? "a table's columns" : "a table"}`);
    }
    for (const c of el.children) if (isEl(c)) walk(c, [t, ...chain]);
  };
  for (const c of pd.root.children) if (isEl(c)) walk(c, around);
}

/** Above this many pairs (children × children, 500 × 500) lining children up by content isn't tried: they're lined up by tag alone, in order. */
export const LINE_UP_CAP = 250_000;

/** An element's content as its own: tag and source with data-l ids and the whitespace between tags taken out. */
const signature = (html: string, el: El) => `${el.tag}\0${html.slice(el.start, el.end).replace(/\s+data-l(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/gi, "").replace(/>\s+</g, "><").trim()}`;

/** Pairs (i, j) of a and b, in order, where same(a[i], b[j]), as many as can be (a longest common subsequence); by position past the cap. */
function lineUp<T>(a: T[], b: T[], same: (x: T, y: T) => boolean): [number, number][] {
  const out: [number, number][] = [];
  if (!a.length || !b.length) return out;
  if (a.length * b.length > LINE_UP_CAP) {
    for (let k = 0; k < Math.min(a.length, b.length); k++) if (same(a[k], b[k])) out.push([k, k]);
    return out;
  }
  const L = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = same(a[i], b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (same(a[i], b[j]) && L[i][j] === L[i + 1][j + 1] + 1) out.push([i++, j++]);
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/** How alike two contents are, 0 to 1: shared pairs of letters, case aside (Dice). */
function alike(x: string, y: string) {
  const pairs = (t: string) => {
    const m = new Map<string, number>();
    const l = t.toLowerCase();
    for (let k = 0; k < l.length - 1; k++) m.set(l.slice(k, k + 2), (m.get(l.slice(k, k + 2)) ?? 0) + 1);
    return m;
  };
  const px = pairs(x);
  const py = pairs(y);
  let both = 0;
  for (const [k, c] of px) both += Math.min(c, py.get(k) ?? 0);
  const all = Math.max(1, x.length - 1 + (y.length - 1));
  return (2 * both) / all;
}

/**
  The second pass: children left between two content matches, lined up by tag in order, and among
  the ways to do that the one whose pairs are most alike (an edited child pairs with what it was,
  not with a new neighbour). By tag alone past the cap.
*/
function nearest(a: El[], b: El[], sa: string[], sb: string[]): [number, number][] {
  if (!a.length || !b.length) return [];
  if (a.length * b.length > LINE_UP_CAP) return lineUp(a, b, (p, q) => p.tag === q.tag);
  const score = (i: number, j: number) => (a[i].tag === b[j].tag ? 1 + alike(sa[i], sb[j]) : -1);
  const S = Array.from({ length: a.length + 1 }, () => new Float64Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) S[i][j] = Math.max(S[i + 1][j], S[i][j + 1], score(i, j) > 0 ? score(i, j) + S[i + 1][j + 1] : -Infinity);
  const out: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    const sc = score(i, j);
    if (sc > 0 && S[i][j] === sc + S[i + 1][j + 1]) out.push([i++, j++]);
    else if (S[i][j] === S[i + 1][j]) i++;
    else j++;
  }
  return out;
}

/**
  A new piece for an element (the Code tab's text, design_node's html) usually comes without ids:
  each of its elements takes the id of the element it stands in for, so a selection and Build's
  "what changed" follow it. The two trees are walked together from the root (whose id withId sets).
  Under a matched parent the children are lined up in two passes: first by content (tag and source,
  ids and whitespace between tags aside), so an unchanged child keeps its id wherever it moved
  within the run; then, between each two children matched so, the ones left on both sides by tag
  in order, so an edited child keeps its id too. A child lined up with an old one takes its id;
  what's left in the piece is new. One the piece names an id for keeps it, and no id it names is
  given to another; the page's stamp makes sure no id is twice.
*/
export function carryIds(piece: string, old: El, oldHtml: string) {
  const pd = parse(piece);
  const root = pd.root.children.find(isEl);
  if (!root) return piece;
  const stated = new Set(elements(pd).map((e) => attr(e, "data-l")?.value).filter((v): v is string => Boolean(v)));
  const edits: Splice[] = [];
  const kids = (e: El) => e.children.filter(isEl);
  const take = (o: El, n: El) => {
    const was = attr(o, "data-l")?.value;
    if (was && goodId(was) && !attr(n, "data-l") && !stated.has(was)) {
      stated.add(was);
      edits.push({ at: n.nameEnd, del: 0, ins: ` data-l="${was}"` });
    }
    walk(o, n);
  };
  const walk = (o: El, n: El) => {
    const a = kids(o);
    const b = kids(n);
    const sa = a.map((e) => signature(oldHtml, e));
    const sb = b.map((e) => signature(piece, e));
    const same = lineUp(sa, sb, (x, y) => x === y);
    const pairs: [number, number][] = [];
    // Between each two content matches (and before the first, after the last), what's left by tag, in order.
    let pi = 0;
    let pj = 0;
    for (const [i, j] of [...same, [a.length, b.length] as [number, number]]) {
      for (const [x, y] of nearest(a.slice(pi, i), b.slice(pj, j), sa.slice(pi, i), sb.slice(pj, j))) pairs.push([pi + x, pj + y]);
      if (i < a.length) pairs.push([i, j]);
      pi = i + 1;
      pj = j + 1;
    }
    for (const [i, j] of pairs) take(a[i], b[j]);
  };
  // The root keeps the op's id whatever its tag (withId), so its children are lined up under it.
  walk(old, root);
  return edits.length ? splice(piece, edits) : piece;
}

/** Replaces the element with this id by new outer HTML that keeps the id, then stamps what's new. */
export function replaceNode(html: string, id: string, next: string) {
  const doc = parse(html);
  const el = byId(doc, id);
  if (!el) throw new Error(`There's no element with data-l="${id}" in that frame. design_tree lists them.`);
  swappable(el, id);
  placeable(balanced(next.trim()), el.parent, el.tag);
  const piece = withId(carryIds(next.trim(), el, html), id);
  return stamp(html.slice(0, el.start) + piece + html.slice(el.end)).html;
}

export type Outline = { id: string; tag: string; name: string; kind: "stack" | "text" | "image" | "box"; text?: string; children: Outline[] };

const IMAGE = new Set(["img", "svg", "picture", "video", "canvas", "iframe", "object", "embed"]);

/** What an element is called in Layers: its data-name, aria-label, alt, id or first class, else its tag. */
export function nameOf(el: El) {
  const v = (n: string) => attr(el, n)?.value.trim();
  return v("data-name") || v("aria-label") || v("alt") || v("id") || v("class")?.split(/\s+/)[0] || el.tag;
}

const ownText = (el: El) =>
  el.children
    .filter((c): c is Txt => !isEl(c))
    .map((t) => decode(t.text))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

/** The frame's outline from its addressable elements (an element with no id yet is left out: stamp first). */
export function outline(html: string): Outline | null {
  const doc = parse(html);
  const ok = new Set(addressable(doc));
  const make = (el: El): Outline => {
    const kids = el.children.filter((c): c is El => isEl(c) && ok.has(c)).map(make);
    const words = ownText(el);
    const kind = IMAGE.has(el.tag) ? "image" : kids.length ? "stack" : words ? "text" : "box";
    return { id: attr(el, "data-l")?.value ?? "", tag: el.tag, name: nameOf(el), kind, ...(words ? { text: words.slice(0, 120) } : {}), children: kids };
  };
  const top = contentRoot(doc);
  if (top.tag === "body") return make(top);
  const outermost = (el: El) => {
    for (let p = el.parent; p; p = p.parent) if (ok.has(p)) return false;
    return true;
  };
  const kids = [...ok].filter(outermost).map(make);
  return { id: "", tag: "#document", name: "page", kind: "stack", children: kids };
}

// Changes to a frame's source (canvas.frame.apply): each one touches only its element's bytes.

const encAttr = (v: string, q: string) => v.replace(/&/g, "&amp;").replace(q === "'" ? /'/g : /"/g, q === "'" ? "&#39;" : "&quot;");
const encText = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const quoteOf = (html: string, a: Attr) => (a.vStart > 0 && (html[a.vStart - 1] === '"' || html[a.vStart - 1] === "'") ? html[a.vStart - 1] : "");

/** An attribute's raw text as the characters it says (entities read), each with where it is in the raw text. */
function chars(raw: string) {
  const out: { c: string; at: number }[] = [];
  for (let i = 0; i < raw.length; ) {
    if (raw[i] === "&") {
      const m = /^&(#x[0-9a-f]+|#\d+|[a-z]+);/i.exec(raw.slice(i, i + 12));
      const d = m ? decode(m[0]) : "";
      if (m && d !== m[0]) {
        out.push({ c: d, at: i });
        i += m[0].length;
        continue;
      }
    }
    out.push({ c: raw[i], at: i });
    i++;
  }
  return out;
}

/**
  Reads CSS declarations as CSS does: strings in either quote with their escapes, comments,
  url(…) unquoted, brackets. Gives where the top-level semicolons are (as indexes into cs), and
  whether it ends cleanly (no string, comment, url or bracket left open, no top-level { or }).
*/
function cssScan(cs: { c: string }[]) {
  const semis: number[] = [];
  let quote = "";
  let depth = 0;
  let comment = false;
  let url = false;
  let clean = true;
  for (let k = 0; k < cs.length; k++) {
    const c = cs[k].c;
    const next = cs[k + 1]?.c;
    if (comment) {
      if (c === "*" && next === "/") {
        comment = false;
        k++;
      }
    } else if (quote) {
      if (c === "\\") k++;
      else if (c === quote) quote = "";
    } else if (url) {
      if (c === "\\") k++;
      else if (c === ")") {
        url = false;
        depth--;
      }
    } else if (c === "\\") k++;
    else if (c === "/" && next === "*") {
      comment = true;
      k++;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") {
      depth++;
      const before = cs.slice(Math.max(0, k - 3), k).map((x) => x.c).join("").toLowerCase();
      const prev = cs[k - 4]?.c ?? "";
      let j = k + 1;
      while (cs[j] && /\s/.test(cs[j].c)) j++;
      if (before === "url" && !/[\w-]/.test(prev) && cs[j]?.c !== '"' && cs[j]?.c !== "'") url = true;
    } else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) semis.push(k);
    else if ((c === "{" || c === "}") && depth === 0) clean = false;
  }
  return { semis, clean: clean && !quote && !comment && !url && depth === 0 };
}

/** A style attribute's declarations as written (raw slices), split at the semicolons CSS splits at, each with its property's name. */
function decls(raw: string) {
  const cs = chars(raw);
  const { semis } = cssScan(cs);
  const cuts = [...semis.map((k) => cs[k].at), raw.length];
  const out: { raw: string; prop: string }[] = [];
  let from = 0;
  for (const cut of cuts) {
    const r = raw.slice(from, cut);
    const said = decode(r).replace(/\/\*[\s\S]*?\*\//g, "");
    const colon = said.indexOf(":");
    out.push({ raw: r, prop: colon < 0 ? "" : said.slice(0, colon).trim().toLowerCase() });
    from = cut + 1;
  }
  return out;
}

/** Splices that put an attribute at this value (null: take it away), keeping its quotes. */
function setAttr(html: string, el: El, name: string, value: string | null): Splice[] {
  const a = attr(el, name);
  if (value === null) {
    if (!a) return [];
    let s = a.start;
    while (s > el.nameEnd && space(html[s - 1])) s--;
    return [{ at: s, del: a.end - s, ins: "" }];
  }
  if (!a) {
    const last = el.attrs.at(-1);
    return [{ at: last ? last.end : el.nameEnd, del: 0, ins: ` ${name}="${encAttr(value, '"')}"` }];
  }
  if (a.vStart < 0) return [{ at: a.end, del: 0, ins: `="${encAttr(value, '"')}"` }];
  const q = quoteOf(html, a);
  if (q) return [{ at: a.vStart, del: a.vEnd - a.vStart, ins: encAttr(value, q) }];
  // Written without quotes: kept so while the new value can be.
  return [{ at: a.vStart, del: a.vEnd - a.vStart, ins: /^[^\s"'=<>`&]+$/.test(value) ? value : `"${encAttr(value, '"')}"` }];
}

/**
  Splices for a style op: the named properties changed in place, new ones added at the end, null
  ones taken out. Declarations nobody touched keep their bytes; a new value is encoded once, for
  the attribute's own quote (an unquoted attribute gets double quotes).
*/
function setStyle(html: string, el: El, style: Record<string, string | null>): Splice[] {
  const a = attr(el, "style");
  const written = a ? quoteOf(html, a) : "";
  const q = written || '"';
  const raw = a && a.vStart >= 0 ? html.slice(a.vStart, a.vEnd) : "";
  const list = decls(raw);
  // A trailing ; leaves an empty last piece: new ones go before it.
  const tail = list.length && !decode(list.at(-1)!.raw).trim() ? list.pop() : undefined;
  const asked = Object.entries(style ?? {});
  const names = asked.map(([k]) => k.trim().toLowerCase());
  if (new Set(names).size !== names.length) throw new Error("The same property is named twice in one change.");
  for (const [k, v] of asked) {
    const prop = k.trim().toLowerCase();
    if (!/^-{0,2}[a-z][a-z0-9-]*$/.test(prop)) throw new Error(`“${k.slice(0, 40)}” isn't a CSS property.`);
    if (v !== null) {
      const value = String(v).trim();
      const scan = cssScan([...value].map((c) => ({ c })));
      if (scan.semis.length || !scan.clean) throw new Error(`The value for ${prop} isn't one CSS value: a ; { or } outside quotes, or a quote, comment, url( or bracket left open.`);
    }
    const at = list.findIndex((d) => d.prop === prop);
    for (let i = list.length - 1; i > at; i--) if (list[i].prop === prop) list.splice(i, 1);
    if (v === null) {
      if (at >= 0) list.splice(at, 1);
      continue;
    }
    const text = encAttr(`${prop}: ${String(v).trim()}`, q);
    if (at >= 0) {
      const lead = /^\s*/.exec(list[at].raw)![0];
      const trail = /\s*$/.exec(list[at].raw)![0];
      list[at] = { raw: `${lead}${text}${trail}`, prop };
    } else list.push({ raw: list.length ? ` ${text}` : text, prop });
  }
  let next = [...list, ...(tail ? [tail] : [])].map((d) => d.raw).join(";");
  if (!/^\s/.test(raw)) next = next.replace(/^\s+/, "");
  if (!decode(next).replace(/;/g, "").trim()) return setAttr(html, el, "style", null);
  if (!a) {
    const last = el.attrs.at(-1);
    return [{ at: last ? last.end : el.nameEnd, del: 0, ins: ` style="${next}"` }];
  }
  if (a.vStart < 0) return [{ at: a.end, del: 0, ins: `="${next}"` }];
  return written ? [{ at: a.vStart, del: a.vEnd - a.vStart, ins: next }] : [{ at: a.vStart, del: a.vEnd - a.vStart, ins: `"${next}"` }];
}

const idOf = (el: El) => attr(el, "data-l")?.value;
/** The nearest element above this one with an id (its own, with self). */
function upWithId(el: El | undefined, ok: Set<El>) {
  for (let p = el; p; p = p.parent) if (ok.has(p) && idOf(p)) return p;
  return undefined;
}

type Op =
  | { id: string; style: Record<string, string | null> }
  | { id: string; text: string }
  | { id: string; inner: Part[] }
  | { id: string; attr: Record<string, string | null> }
  | { id: string; html: string }
  | { id: string; remove: true }
  | { id: string; move: { before?: string; into?: string } }
  | { into: string; insert: string; before?: string };
/** A run of a text edited in place (contracts' TextPart): words, a line break, or a mark of the source by id. */
type Part = string | { br: true } | { id: string; inner?: Part[] };

/**
  Applies a list of changes to a frame's source, in order, all or nothing: each touches only its
  element's bytes (a style op only its style attribute), so what's outside stays as it was. Returns
  the new source (stamped), the ops that put it back, byte for byte (the touched elements' earlier
  source, last first), and the ids of the elements it added. An id the page hasn't got refuses the
  whole list, and so does an html or insert piece that isn't balanced (balanced()).
*/
export function applyOps(source: string, ops: Op[]): { html: string; undo: Op[]; ids: string[] } {
  if (!Array.isArray(ops) || !ops.length) throw new Error("There are no changes to make.");
  const first = stamp(source);
  if (!first.ok) throw new Error("This frame's page can't take ids without changing something else, so nothing was changed. Edit its file instead.");
  let cur = first.html;
  const before = new Set(addressable(parse(cur)).map(idOf));
  const undo: Op[] = [];
  const need = (doc: Doc, id: unknown) => {
    const el = typeof id === "string" ? byId(doc, id) : undefined;
    if (!el) throw new Error(`There's no element with data-l="${String(id).slice(0, 40)}" in that frame, so nothing was changed.`);
    return el;
  };
  /**
    What puts this element back exactly: its own source, or when that piece couldn't stand alone
    (an element a browser ends at its parent's end, a stray end tag inside), the nearest element
    with an id around it whose source can.
  */
  const snap = (doc: Doc, ok: Set<El>, el: El | undefined): Op => {
    for (let p = upWithId(el, ok); p; p = upWithId(p.parent, ok)) {
      const piece = outer(doc, p);
      try {
        placeable(balanced(piece), p.parent, p.tag);
        return { id: idOf(p)!, html: piece };
      } catch {
        // not whole on its own: the one around it
      }
    }
    throw new Error("That change couldn't be undone exactly (no element with an id around it stands on its own), so nothing was changed.");
  };
  for (const op of ops) {
    const doc = parse(cur);
    const ok = new Set(addressable(doc));
    const o = op as Record<string, unknown>;
    if ("insert" in o) {
      const into = need(doc, o.into);
      if (into.closedBy === "void" || RAW.has(into.tag)) throw new Error(`${idOf(into)} can't hold other elements.`);
      swappable(into, idOf(into)!);
      placeable(balanced(String(o.insert ?? "")), into);
      let at = into.innerEnd;
      if (o.before !== undefined) {
        const b = need(doc, o.before);
        if (b.parent !== into) throw new Error(`${idOf(b)} isn't directly inside ${idOf(into)}.`);
        at = b.start;
      }
      undo.unshift(snap(doc, ok, into));
      cur = splice(cur, [{ at, del: 0, ins: String(o.insert ?? "") }]);
      continue;
    }
    const el = need(doc, o.id);
    const id = idOf(el)!;
    if ("style" in o) {
      undo.unshift(snap(doc, ok, el));
      cur = splice(cur, setStyle(cur, el, o.style as Record<string, string | null>));
    } else if ("attr" in o) {
      const edits: Splice[] = [];
      const seen = new Set<string>();
      for (const [k, v] of Object.entries((o.attr ?? {}) as Record<string, string | null>)) {
        const name = k.trim().toLowerCase();
        if (!/^[a-z_:][a-z0-9_.:-]*$/.test(name)) throw new Error(`“${k.slice(0, 40)}” isn't an attribute's name.`);
        if (seen.has(name)) throw new Error(`The attribute ${name} is named twice in one change (names don't care about case), so nothing was changed.`);
        seen.add(name);
        if (name === "data-l" || name === "style") throw new Error(name === "style" ? "Change style through a style op." : "An element's data-l id stays as it is.");
        edits.push(...setAttr(cur, el, name, v === null ? null : String(v)));
      }
      undo.unshift(snap(doc, ok, el));
      cur = splice(cur, edits);
    } else if ("text" in o) {
      if (el.closedBy === "void" || el.tag === "script" || el.tag === "style") throw new Error(`${id} holds no text.`);
      swappable(el, id);
      undo.unshift(snap(doc, ok, el));
      cur = splice(cur, [{ at: el.openEnd, del: el.innerEnd - el.openEnd, ins: encText(String(o.text ?? "")) }]);
    } else if ("inner" in o) {
      // A text with marks, edited in place: its words from the runs, each mark from this source by id (its bytes as they are
      // when its words weren't touched), so nothing a page's script drew, set or moved gets into the file.
      if (el.closedBy === "void" || RAW.has(el.tag)) throw new Error(`${id} holds no text.`);
      swappable(el, id);
      const inside = new Set(each(el));
      const used = new Set<El>();
      const bad = () => new Error(`The text for ${id} isn't one the canvas reads, so nothing was changed.`);
      const build = (parts: unknown, depth: number): string => {
        if (!Array.isArray(parts) || depth > 24) throw bad();
        return parts
          .map((p) => {
            if (typeof p === "string") return encText(p);
            if (!p || typeof p !== "object") throw bad();
            if ((p as { br?: unknown }).br === true) return "<br>";
            const pid = (p as { id?: unknown }).id;
            const m = typeof pid === "string" ? byId(doc, pid) : undefined;
            // A mark this element's source hasn't got (a page's script drew it) is left out: the script draws it again.
            if (!m || !inside.has(m) || within(m).some((x) => used.has(x))) return "";
            const kids = (p as { inner?: unknown }).inner;
            if (kids === undefined || m.closedBy === "void" || RAW.has(m.tag)) {
              for (const x of within(m)) used.add(x);
              return outer(doc, m);
            }
            used.add(m);
            return cur.slice(m.start, m.openEnd) + build(kids, depth + 1) + cur.slice(m.innerEnd, m.end);
          })
          .join("");
      };
      const next = build(o.inner, 0);
      placeable(balanced(next), el);
      undo.unshift(snap(doc, ok, el));
      cur = splice(cur, [{ at: el.openEnd, del: el.innerEnd - el.openEnd, ins: next }]);
    } else if ("html" in o) {
      swappable(el, id);
      const piece = String(o.html ?? "");
      if (!piece.trim()) throw new Error(`The new html for ${id} is empty.`);
      const pd = balanced(piece);
      placeable(pd, el.parent, el.tag);
      // One element and nothing else puts back as itself; more (two elements, text around it) as the element around it.
      const one = pd.root.children.length === 1 && isEl(pd.root.children[0]);
      undo.unshift(snap(doc, ok, one ? el : el.parent));
      cur = splice(cur, [{ at: el.start, del: el.end - el.start, ins: withId(carryIds(piece, el, cur), id) }]);
    } else if ("remove" in o) {
      swappable(el, id);
      if (!upWithId(el.parent, ok)) throw new Error(`${id} is at the page's top, with no element around it to keep its place.`);
      undo.unshift(snap(doc, ok, el.parent));
      cur = splice(cur, [{ at: el.start, del: el.end - el.start, ins: "" }]);
    } else if ("move" in o) {
      swappable(el, id);
      const m = (o.move ?? {}) as { before?: string; into?: string };
      let at: number;
      let holder: El;
      if (m.before !== undefined) {
        const b = need(doc, m.before);
        if (within(el).includes(b)) throw new Error(`${id} can't go inside itself.`);
        if (m.into !== undefined && b.parent !== need(doc, m.into)) throw new Error(`${m.before} isn't directly inside ${m.into}.`);
        at = b.start;
        holder = b.parent ?? doc.root;
      } else if (m.into !== undefined) {
        const t = need(doc, m.into);
        if (within(el).includes(t)) throw new Error(`${id} can't go inside itself.`);
        if (t.closedBy === "void" || RAW.has(t.tag)) throw new Error(`${m.into} can't hold other elements.`);
        swappable(t, m.into);
        at = t.innerEnd;
        holder = t;
      } else throw new Error("Say where it goes: move.before or move.into.");
      // The nearest element with an id that holds both places: its source puts it back.
      const from = new Set<El>();
      for (let p = upWithId(el.parent, ok); p; p = upWithId(p.parent, ok)) from.add(p);
      let both: El | undefined;
      for (let p = upWithId(holder, ok); p && !both; p = upWithId(p.parent, ok)) if (from.has(p)) both = p;
      if (!both) throw new Error(`${id} and where it goes have no element with an id around both, to keep their place.`);
      undo.unshift(snap(doc, ok, both));
      const piece = outer(doc, el);
      cur = splice(cur, [{ at: el.start, del: el.end - el.start, ins: "" }]);
      cur = splice(cur, [{ at: at > el.start ? at - piece.length : at, del: 0, ins: piece }]);
    } else throw new Error("That change isn't one the canvas knows: style, text, inner, attr, html, remove, move or insert.");
  }
  const done = stamp(cur);
  if (!done.ok) throw new Error("The ids for what's new couldn't be added without changing anything else, so nothing was changed.");
  const ids = addressable(parse(done.html))
    .map(idOf)
    .filter((x): x is string => Boolean(x) && !before.has(x));
  return { html: done.html, undo, ids };
}
