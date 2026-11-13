/*
  One frame on the canvas. A drawn frame is its HTML in a sandboxed iframe with no origin (scripts
  and forms only, as the Design surface's withShim gives a design), with the frame agent inlined
  first and a <base> at the design's folder so its pictures and styles load. A live frame is the
  running page through the engine's proxy, which puts the same agent in. Each is drawn at its own
  size and scaled with the canvas's transform, never clipped round or blurred, and stays mounted:
  its document loads again only when the store says to (a new `rev`: the engine said the file
  changed, or a change it refused is to be taken off the screen), not after an edit made here,
  which the frame already shows. The `rev` is in the agent's tag, so a new one always loads the
  document again, even when the file's HTML is what it was.
*/
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import type { DesignFrame } from "@contracts";
import { COMPUTED } from "@contracts";
import agent from "../../../../contracts/src/frame-agent.js?raw";
import { attach, detach, reloading } from "./bridge";
import { useLiveSrc } from "./Live";
import { agentRedraw, getDesign, onDesignSwitch, useDesign } from "./store";

// The computed properties come from contracts (COMPUTED) with the agent, so the two can't drift.
// With `key`, the agent's text is wrapped in a function that gets it as __linerKey (frame-agent.js keyPort), never a global a script of the page could read.
const scriptOf = (settle?: Settle, rev?: number, key?: string) =>
  `<script data-liner-agent${rev !== undefined ? ` data-rev="${rev}"` : ""}>window.__linerComputed=${JSON.stringify(COMPUTED)};${settle ? `window.__linerSettle=${JSON.stringify(settle).replace(/</g, "\\u003c")};` : ""}${key ? `((__linerKey) => {\n${agent}\n})(${JSON.stringify(key)});` : agent}</script>`;

const WHITE = "\t\n\f\r ";
/**
  Where a start tag ends (one past its ">"), from just after its name, read as the browser's
  tokenizer reads it: quotes count only round an attribute's value, so a ">" inside one doesn't end
  the tag, and a quote in an attribute's name doesn't start one. -1 when it doesn't end.
*/
function tagEnd(s: string, j: number) {
  const white = (c: string) => WHITE.includes(c);
  for (;;) {
    while (j < s.length && (white(s[j]) || s[j] === "/")) j++;
    if (j >= s.length) return -1;
    if (s[j] === ">") return j + 1;
    // An attribute's name: its first character may be anything (even "="), the rest runs to white space, "/", ">" or "=".
    j++;
    while (j < s.length && !white(s[j]) && s[j] !== "/" && s[j] !== ">" && s[j] !== "=") j++;
    while (j < s.length && white(s[j])) j++;
    if (s[j] !== "=") continue;
    j++;
    while (j < s.length && white(s[j])) j++;
    const q = s[j];
    if (q === '"' || q === "'") {
      const e = s.indexOf(q, j + 1);
      if (e < 0) return -1;
      j = e + 1;
    } else if (q === ">") return j + 1;
    else while (j < s.length && !white(s[j]) && s[j] !== ">") j++;
  }
}

/**
  Where the agent goes so that it runs before every script of the page: after a leading doctype,
  <html> and <head>, each taken only where nothing but white space comes before it, else at the very
  start. Never by finding a "<head" further on, which may be a <header>, sit in a comment, or come
  after a script of the page. The engine's proxy has the same (engine/src/proxy.ts agentAt).
*/
export function agentAt(html: string) {
  let i = 0;
  let at = 0;
  const skip = () => {
    while (i < html.length && WHITE.includes(html[i])) i++;
  };
  skip();
  if (html.slice(i, i + 9).toLowerCase() === "<!doctype") {
    // A doctype ends at its first ">", quoted or not.
    const e = html.indexOf(">", i);
    if (e < 0) return 0;
    at = i = e + 1;
    skip();
  }
  for (const name of ["html", "head"]) {
    const c = html[i + name.length + 1];
    if (html.slice(i, i + name.length + 1).toLowerCase() !== `<${name}` || c === undefined || !`${WHITE}/>`.includes(c)) continue;
    const e = tagEnd(html, i + name.length + 1);
    if (e < 0) return at;
    at = i = e;
    skip();
  }
  return at;
}

/**
  The frame's document as the iframe gets it: the base its paths are read from and the agent, first
  of all (agentAt). With `settle`, the agent shows an agent's change arriving (frame-agent.js
  settle). With `rev`, the store's count of redraws, on the agent's tag (taken out with the agent
  whenever the page is serialised), so the same HTML drawn again is still a new document. With
  `key`, the key the agent sends its key port up with (bridge.ts keysFor).
*/
export function srcDocOf(html: string, base?: string, settle?: Settle, rev?: number, key?: string) {
  const baseTag = base ? `<base data-liner-base href="${base.replace(/\/?$/, "/")}frames/">` : "";
  const head = `${baseTag}${scriptOf(settle, rev, key)}`;
  // A piece of a page, with no doctype, <html>, <head> or <body> anywhere: a document of its own round it.
  if (!/<!doctype|<(html|head|body)[\s/>]/i.test(html)) return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
  const at = agentAt(html);
  return html.slice(0, at) + head + html.slice(at);
}

/** A drawn frame's key for one document: 16 random bytes, as hex. */
const keyOf = () => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

/*
  An agent's change, as it arrives. When a frame is drawn again because of an agent's change
  (store.ts agentRedraw), its HTML before and after are compared here, element by element: by data-l
  id, and, for an element whose id is new, by what it is (its tag, attributes and own words), since
  an agent that writes a page whole without the ids gets fresh ones for the same elements. Then:
  - nothing was there before, or nothing of it is left: the page fades in once ("whole"); so does a
    whole page written into an empty frame in one go (more than 40 new elements);
  - new elements: the outermost of them settle in, in document order ("settle"); more than 40 of
    them and the frame simply appears;
  - nothing new and at most 3 elements changed: Canvas.tsx points them out on its overlay ("mark").
  The person's own edits never get here (they're never an agent's redraw), nor does a frame opened,
  undone or brought back. With the system's Reduce motion, or Liner's Motion at Quick, nothing moves:
  a small change is still pointed out, without its fade.
*/
export type Settle = { mode: "settle"; ids: string[] } | { mode: "whole" };
type Plan = Settle | { mode: "mark"; ids: string[] } | undefined;
const SETTLE_MAX = 40;
const MARK_MAX = 3;

/** What an element is, apart from its id: its tag, its attributes in order of name, its own words. */
const sigOf = (el: Element) => {
  const attrs = [...el.attributes].filter((a) => a.name !== "data-l").map((a) => `${a.name}=${a.value}`).sort().join("\u0001");
  let own = "";
  for (const c of el.childNodes) if (c.nodeType === 3) own += c.nodeValue;
  return `${el.tagName}\u0002${attrs}\u0002${own.replace(/\s+/g, " ").trim()}`;
};

export function planOf(before: string | undefined, after: string): Plan {
  if (before === undefined) return undefined;
  let a: Document;
  let b: Document;
  try {
    const p = new DOMParser();
    a = p.parseFromString(before, "text/html");
    b = p.parseFromString(after, "text/html");
  } catch {
    return undefined;
  }
  const olds = [...a.body.querySelectorAll("[data-l]")];
  const news = [...b.body.querySelectorAll("[data-l]")];
  if (!news.length) return undefined;
  const oldById = new Map(olds.map((el) => [el.getAttribute("data-l")!, el]));
  const pool = new Map<string, number>();
  for (const el of olds) pool.set(sigOf(el), (pool.get(sigOf(el)) ?? 0) + 1);
  const take = (s: string) => {
    const n = pool.get(s) ?? 0;
    if (n > 0) pool.set(s, n - 1);
    return n > 0;
  };
  const fresh = new Set<Element>();
  const changed: string[] = [];
  const byWhat: Element[] = [];
  let kept = 0;
  for (const el of news) {
    const was = oldById.get(el.getAttribute("data-l")!);
    if (!was) {
      byWhat.push(el);
      continue;
    }
    kept++;
    const s = sigOf(was);
    take(s);
    if (sigOf(el) !== s) changed.push(el.getAttribute("data-l")!);
  }
  for (const el of byWhat) {
    if (take(sigOf(el))) kept++;
    else fresh.add(el);
  }
  if (olds.length ? !kept : fresh.size > SETTLE_MAX) return { mode: "whole" };
  const isTop = (el: Element) => {
    for (let p = el.parentElement; p && p !== b.body; p = p.parentElement) if (fresh.has(p)) return false;
    return true;
  };
  const top = news.filter((el) => fresh.has(el) && isTop(el));
  if (top.length) return top.length <= SETTLE_MAX ? { mode: "settle", ids: top.map((el) => el.getAttribute("data-l")!) } : undefined;
  if (changed.length && changed.length <= MARK_MAX) return { mode: "mark", ids: changed };
  return undefined;
}

/** No settling and no breathing: the system's Reduce motion, or Liner's Motion at Quick (look.ts). */
export const stillMotion = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "quick";
  } catch {
    return false;
  }
};

/** Small changes to point out once the frame is ready again, by design file and frame (Canvas.tsx takes them); one not taken in 4 s goes. */
const marks = new Map<string, { ids: string[]; lead: boolean; at: number }>();
const markKey = (frame: string) => `${getDesign().cwd ?? ""}\u0000${getDesign().file?.id ?? ""}\u0000${frame}`;
export function takeMarks(frame: string) {
  const now = Date.now();
  for (const [k, m] of marks) if (now - m.at > 4000) marks.delete(k);
  const key = markKey(frame);
  const m = marks.get(key);
  marks.delete(key);
  return m;
}
// Another design file, or none: its marks go with it.
onDesignSwitch(() => marks.clear());
/** For a probe: how many marks wait to be taken. */
export const heldMarks = () => marks.size;

export const Frame = memo(function Frame({ frame, editing, live }: { frame: DesignFrame; editing: boolean; live: boolean }) {
  const el = useRef<HTMLIFrameElement>(null);
  const rev = useDesign((s) => s.rev[frame.id] ?? 0);
  const has = useDesign((s) => s.html[frame.id] !== undefined);
  const base = useDesign((s) => s.base);
  // Read when the frame must load again, not on every edit. Each document gets a key of its own (srcDocOf).
  const made = useMemo(() => {
    if (frame.kind !== "drawn" || !has) return undefined;
    const html = getDesign().html[frame.id] ?? "";
    const heard = agentRedraw(frame.id, rev);
    const plan = heard ? planOf(heard.before, html) : undefined;
    if (plan?.mode === "mark") marks.set(markKey(frame.id), { ids: plan.ids, lead: heard!.lead, at: Date.now() });
    else marks.delete(markKey(frame.id));
    const key = keyOf();
    return { doc: srcDocOf(html, base, plan && plan.mode !== "mark" && !stillMotion() ? plan : undefined, rev, key), key };
  }, [rev, has, base, frame.kind, frame.id]);
  const doc = made?.doc;
  // Attached before the browser can run the document (a layout effect), so its first "ready" is heard.
  useLayoutEffect(() => {
    const f = el.current;
    if (!f) return;
    attach(frame.id, f);
    return () => detach(frame.id, f);
  }, [frame.id]);
  // In the same commit that hands the iframe its new document, before the browser runs anything
  // else, so the new document's "ready" can never arrive first and be taken for the old one's, and
  // the bridge knows the key the new document's agent sends its key port up with.
  useLayoutEffect(() => reloading(frame.id, made?.key), [doc, frame.url]);
  // A live frame is the page through the engine's proxy, with the frame agent (Live.tsx).
  const src = useLiveSrc(frame);
  return (
    <iframe
      ref={el}
      className="ld-iframe"
      title={frame.name}
      // No allow-same-origin for a drawn frame: it can't reach the app, its storage or its cookies.
      // A live frame keeps its own origin (the proxy's, never the app's), or its dev server's modules don't load.
      sandbox={frame.kind === "live" ? "allow-scripts allow-forms allow-same-origin" : "allow-scripts allow-forms"}
      srcDoc={doc}
      src={src}
      width={frame.w}
      height={frame.h}
      tabIndex={editing ? 0 : -1}
      data-live={live || undefined}
      style={{ width: frame.w, height: frame.h, pointerEvents: editing || live ? "auto" : "none" }}
    />
  );
});
