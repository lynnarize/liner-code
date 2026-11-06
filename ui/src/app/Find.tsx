/*
  Find, in a thread or a diff: ⌘F opens it, Enter and ⇧Enter step through the matches, Escape
  closes it. Matches are painted with the CSS Custom Highlight API, so the page's own text is
  never rewritten; the current one scrolls into view.
*/
import { useEffect, useRef, useState, type RefObject } from "react";
import { prefersReducedMotion } from "@liner/lib/spring";
import { I } from "./icons";
import "./models.css";

type Highlights = { set(name: string, h: unknown): void; delete(name: string): void };
const registry = () => (globalThis.CSS as unknown as { highlights?: Highlights } | undefined)?.highlights;
const Highlight = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

/** Lower case, each letter kept in its place: "İ" lowers to two, which moved every match after it, or past its text. */
function fold(s: string) {
  const low = s.toLowerCase();
  return low.length === s.length ? low : Array.from(s, (c) => (c.toLowerCase().length === c.length ? c.toLowerCase() : c)).join("");
}

function rangesIn(root: HTMLElement, query: string) {
  const out: Range[] = [];
  const q = fold(query);
  if (!q) return out;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    // Nor what's folded away (a trail's steps, a thought), which a match would scroll to and not show.
    acceptNode: (n) => (n.parentElement?.closest("button, .lc-find, script, style, [hidden], [inert], :not([data-open], [data-open] > .lc-fcard) > .lc-fold") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = fold(n.textContent ?? "");
    for (let i = text.indexOf(q); i >= 0 && out.length < 2000; i = text.indexOf(q, i + q.length)) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + q.length);
      out.push(r);
    }
  }
  return out;
}

export function FindBar({ root, onClose, label = "Find in this session", onQuery, onMove, asked }: { root: RefObject<HTMLElement | null>; onClose: () => void; label?: string; onQuery?: (q: string) => void; /** The current match is about to be scrolled to. */ onMove?: () => void; asked?: number }) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const [count, setCount] = useState(0);
  // Each new set of matches, and each step, even onto the match you're on.
  const [pass, setPass] = useState(0);
  const ranges = useRef<Range[]>([]);
  // Whether the next match shown scrolls to it: a thread that grows mustn't move you.
  const go = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  // Into the field when it opens, and again each time ⌘F asks while it's open (`asked` counts them).
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, [asked]);
  // Closed, the keys go back where they were, unless you've gone somewhere else meanwhile.
  const before = useRef(document.activeElement);
  useEffect(() => {
    const was = before.current;
    return () => {
      registry()?.delete("lc-find");
      registry()?.delete("lc-find-on");
      if (document.activeElement === document.body && was instanceof HTMLElement && was.isConnected) was.focus({ preventScroll: true });
    };
  }, []);
  // Matches again as you type, and as the thread grows.
  useEffect(() => {
    onQuery?.(query);
    const run = () => {
      const el = root.current;
      ranges.current = el ? rangesIn(el, query.trim()) : [];
      const n = ranges.current.length;
      setCount(n);
      setAt((a) => Math.min(a, Math.max(0, n - 1)));
      setPass((p) => p + 1);
      const reg = registry();
      if (reg && Highlight) reg.set("lc-find", new Highlight(...ranges.current));
    };
    const t = window.setTimeout(() => ((go.current = true), run()), 60);
    // At most four times a second: a streaming reply changes the page every frame.
    let later = 0;
    const grown = new MutationObserver(() => {
      if (later || !query.trim()) return;
      later = window.setTimeout(() => ((later = 0), run()), 250);
    });
    if (root.current) grown.observe(root.current, { childList: true, characterData: true, subtree: true });
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(later);
      grown.disconnect();
    };
  }, [query]);
  useEffect(() => {
    const r = ranges.current[at];
    const reg = registry();
    if (reg && Highlight) {
      if (r) reg.set("lc-find-on", new Highlight(r));
      else reg.delete("lc-find-on");
    }
    const asked = go.current;
    go.current = false;
    if (!r || !asked) return;
    onMove?.();
    r.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [at, pass]);
  useEffect(() => setAt(0), [query]);
  const step = (d: number) => {
    if (!count) return;
    go.current = true;
    setAt((a) => (a + d + count) % count);
    setPass((p) => p + 1);
  };
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
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
