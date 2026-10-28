/*
  Liner · Text morph
  One word becoming another. Letters the two share slide to their new places; letters that
  leave blur away where they stood, and new ones come into focus. Good for a button that
  changes its label, or a heading that cycles.
*/
import { useLayoutEffect, useRef, useState } from "react";
import { cx } from "../../lib/hooks";
import { prefersReducedMotion } from "../../lib/spring";
import "./text-morph.css";

type Ghost = { key: string; ch: string; x: number; y: number };

/** Key each character by its occurrence, so the second “o” in a word stays the second “o”. */
function keyed(text: string) {
  const seen = new Map<string, number>();
  return Array.from(text).map((ch) => {
    const n = (seen.get(ch) ?? 0) + 1;
    seen.set(ch, n);
    return { ch, key: `${ch}:${n}` };
  });
}

export function TextMorph({ children, className, as: Tag = "span" }: { children: string; className?: string; as?: "span" | "h1" | "h2" | "h3" | "p" }) {
  const root = useRef<HTMLElement>(null);
  const rects = useRef(new Map<string, { x: number; y: number }>());
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const prev = useRef(children);
  const chars = keyed(children);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const now = new Map<string, { x: number; y: number }>();
    el.querySelectorAll<HTMLElement>("[data-k]").forEach((s) => {
      const r = s.getBoundingClientRect();
      now.set(s.dataset.k!, { x: r.left - box.left, y: r.top - box.top });
    });
    if (prev.current !== children && !prefersReducedMotion()) {
      const old = rects.current;
      el.querySelectorAll<HTMLElement>("[data-k]").forEach((s) => {
        const was = old.get(s.dataset.k!);
        const is = now.get(s.dataset.k!)!;
        if (was) s.animate([{ transform: `translate(${was.x - is.x}px, ${was.y - is.y}px)` }, { transform: "none" }], { duration: 520, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" });
        else s.animate([{ opacity: 0, filter: "blur(6px)", transform: "scale(0.8)" }, { opacity: 1, filter: "blur(0)", transform: "none" }], { duration: 420, delay: 80, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" });
      });
      // Letters that left: draw them once more where they were, and let them blur away.
      const gone = [...old.entries()].filter(([k]) => !now.has(k)).map(([key, p]) => ({ key, ch: key.split(":")[0], ...p }));
      setGhosts(gone);
    }
    rects.current = now;
    prev.current = children;
  }, [children]);

  return (
    <Tag ref={root as never} className={cx("l-morphtext", className)} aria-label={children}>
      <span aria-hidden>
        {chars.map((c) => (
          <span key={c.key} data-k={c.key} className="l-morphtext__ch">
            {c.ch === " " ? " " : c.ch}
          </span>
        ))}
      </span>
      {ghosts.map((g) => (
        <span key={`g${g.key}${children}`} className="l-morphtext__ghost" style={{ left: g.x, top: g.y }} aria-hidden onAnimationEnd={() => setGhosts((x) => x.filter((y) => y !== g))}>
          {g.ch === " " ? " " : g.ch}
        </span>
      ))}
    </Tag>
  );
}
