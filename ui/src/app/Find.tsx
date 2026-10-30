/*
  Find, in a thread or a diff: ⌘F opens it, Enter and ⇧Enter step through the matches, Escape
  closes it. Matches are painted with the CSS Custom Highlight API, so the page's own text is
  never rewritten; the current one scrolls into view.
*/
import { useEffect, useRef, useState, type RefObject } from "react";
import { I } from "./icons";
import "./models.css";

type Highlights = { set(name: string, h: unknown): void; delete(name: string): void };
const registry = () => (globalThis.CSS as unknown as { highlights?: Highlights } | undefined)?.highlights;
const Highlight = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

function rangesIn(root: HTMLElement, query: string) {
  const out: Range[] = [];
  const q = query.toLowerCase();
  if (!q) return out;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("button, .lc-find, script, style, [hidden]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = (n.textContent ?? "").toLowerCase();
    for (let i = text.indexOf(q); i >= 0 && out.length < 2000; i = text.indexOf(q, i + q.length)) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + q.length);
      out.push(r);
    }
  }
  return out;
}

export function FindBar({ root, onClose, label = "Find in this session", onQuery, asked }: { root: RefObject<HTMLElement | null>; onClose: () => void; label?: string; onQuery?: (q: string) => void; asked?: number }) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const [count, setCount] = useState(0);
  const ranges = useRef<Range[]>([]);
  const field = useRef<HTMLInputElement>(null);
  // Into the field when it opens, and again each time ⌘F asks while it's open (`asked` counts them).
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, [asked]);
  useEffect(() => {
    return () => {
      registry()?.delete("lc-find");
      registry()?.delete("lc-find-on");
    };
  }, []);
  // Matches again as you type, and as the thread grows.
  useEffect(() => {
    onQuery?.(query);
    const run = () => {
      const el = root.current;
      ranges.current = el ? rangesIn(el, query.trim()) : [];
      setCount(ranges.current.length);
      const reg = registry();
      if (reg && Highlight) reg.set("lc-find", new Highlight(...ranges.current));
    };
    const t = window.setTimeout(run, 60);
    return () => window.clearTimeout(t);
  }, [query]);
  useEffect(() => {
    const r = ranges.current[at];
    const reg = registry();
    if (reg && Highlight) {
      if (r) reg.set("lc-find-on", new Highlight(r));
      else reg.delete("lc-find-on");
    }
    r?.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [at, count]);
  useEffect(() => setAt(0), [query]);
  const step = (d: number) => count && setAt((a) => (a + d + count) % count);
  return (
    <div className="lc-find l-glass" role="search" aria-label={label}>
      <I.search size={13} />
      <input
        ref={field}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={label}
        aria-label={label}
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.preventDefault(), step(e.shiftKey ? -1 : 1));
          if (e.key === "Escape") (e.preventDefault(), onClose());
        }}
      />
      <span className="lc-find-n lc-quiet">{query.trim() ? (count ? `${at + 1} of ${count}` : "None") : ""}</span>
      <button type="button" className="lc-ib l-focus" aria-label="Previous match" disabled={!count} onClick={() => step(-1)}>
        <I.chevU size={13} />
      </button>
      <button type="button" className="lc-ib l-focus" aria-label="Next match" disabled={!count} onClick={() => step(1)}>
        <I.chevD size={13} />
      </button>
      <button type="button" className="lc-ib l-focus" aria-label="Close find" onClick={onClose}>
        <I.close size={12} />
      </button>
    </div>
  );
}

/* Text sent to the composer from elsewhere: a quote from an answer, a terminal excerpt. */
const inserts = new Map<string, Set<(text: string) => void>>();
export function toComposer(threadId: string, text: string) {
  for (const fn of inserts.get(threadId) ?? []) fn(text);
}
export function onComposerInsert(threadId: string, fn: (text: string) => void) {
  const set = inserts.get(threadId) ?? new Set();
  set.add(fn);
  inserts.set(threadId, set);
  return () => void set.delete(fn);
}
