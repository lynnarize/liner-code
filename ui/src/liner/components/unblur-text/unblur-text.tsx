import { createElement, useEffect, useRef, useState, type ElementType } from "react";
import { cx } from "../../lib/hooks";
import "./unblur-text.css";

export type UnblurTextProps = {
  text: string;
  /** Element to render, e.g. "h1" or "p". */
  as?: ElementType;
  /** Reveal word by word, or letter by letter for short labels. */
  by?: "word" | "char";
  /** Milliseconds between pieces. */
  stagger?: number;
  delay?: number;
  /** Wait until it scrolls into view. */
  inView?: boolean;
  id?: string;
  className?: string;
};

/** Text that comes into focus, piece by piece. Screen readers get the whole string at once. */
export function UnblurText({ text, as = "span", by = "word", stagger, delay = 0, inView = true, id, className }: UnblurTextProps) {
  const ref = useRef<HTMLElement>(null);
  const [on, setOn] = useState(!inView);
  useEffect(() => {
    if (!inView) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setOn(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  const step = stagger ?? (by === "word" ? 70 : 22);
  const parts = by === "word" ? text.split(/(\s+)/) : Array.from(text);
  let n = 0;
  return createElement(
    as,
    { ref, id, className: cx("l-unblur", className), "data-on": on || undefined, "aria-label": text },
    parts.map((p, i) =>
      /^\s+$/.test(p) ? (
        <span key={i} aria-hidden>
          {p}
        </span>
      ) : (
        <span key={i} aria-hidden className="l-unblur-piece" style={{ animationDelay: `${delay + n++ * step}ms` }}>
          {p}
        </span>
      ),
    ),
  );
}
