/*
  One frame on the canvas. A drawn frame is its HTML in a sandboxed iframe with no origin (scripts
  and forms only, as the Design surface's withShim gives a design), with the frame agent inlined
  first and a <base> at the design's folder so its pictures and styles load. A live frame is the
  running page through the engine's proxy, which puts the same agent in. Each is drawn at its own
  size and scaled with the canvas's transform, never clipped round or blurred, and stays mounted:
  its document loads again only when the engine says the file changed (a new `rev`), not after
  an edit made here, which the frame already shows.
*/
import { memo, useEffect, useMemo, useRef } from "react";
import type { DesignFrame } from "@contracts";
import { COMPUTED } from "@contracts";
import agent from "../../../../contracts/src/frame-agent.js?raw";
import { attach, detach, reloading } from "./bridge";
import { useLiveSrc } from "./Live";
import { agentRedraw, getDesign, onDesignSwitch, useDesign } from "./store";

// The computed properties come from contracts (COMPUTED) with the agent, so the two can't drift.
const scriptOf = (settle?: Settle) =>
  `<script data-liner-agent>window.__linerComputed=${JSON.stringify(COMPUTED)};${settle ? `window.__linerSettle=${JSON.stringify(settle).replace(/</g, "\\u003c")};` : ""}${agent}</script>`;

/** The frame's document as the iframe gets it: the agent first in its head, and the base its paths are read from. With `settle`, the agent shows an agent's change arriving (frame-agent.js settle). */
export function srcDocOf(html: string, base?: string, settle?: Settle) {
  const baseTag = base ? `<base data-liner-base href="${base.replace(/\/?$/, "/")}frames/">` : "";
  const head = `${baseTag}${scriptOf(settle)}`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

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
  // Read when the frame must load again, not on every edit.
  const doc = useMemo(() => {
    if (frame.kind !== "drawn" || !has) return undefined;
    const html = getDesign().html[frame.id] ?? "";
    const heard = agentRedraw(frame.id, rev);
    const plan = heard ? planOf(heard.before, html) : undefined;
    if (plan?.mode === "mark") marks.set(markKey(frame.id), { ids: plan.ids, lead: heard!.lead, at: Date.now() });
    else marks.delete(markKey(frame.id));
    return srcDocOf(html, base, plan && plan.mode !== "mark" && !stillMotion() ? plan : undefined);
  }, [rev, has, base, frame.kind, frame.id]);
  useEffect(() => {
    const f = el.current;
    if (!f) return;
    attach(frame.id, f);
    return () => detach(frame.id, f);
  }, [frame.id]);
  useEffect(() => reloading(frame.id), [doc, frame.url]);
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
