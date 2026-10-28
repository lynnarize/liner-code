/*
  Liner · Expandable text
  Long text held to a few lines, with a soft fade where it is cut. More opens it to its full
  height in one smooth motion; Less brings it back. If the text fits, there is no button.
*/
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import "./expandable-text.css";

export type ExpandableTextProps = { children: ReactNode; lines?: number; className?: string };

export function ExpandableText({ children, lines = 3, className }: ExpandableTextProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [h, setH] = useState<{ min: number; max: number } | null>(null);
  useEffect(() => {
    const el = box.current!;
    const measure = () => {
      const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
      setH({ min: line * lines, max: el.scrollHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el.firstElementChild!);
    return () => ro.disconnect();
  }, [lines]);
  const fits = !!h && h.max <= h.min + 2;
  return (
    <div className={cx("l-xtext", className)} data-open={open || undefined} data-fits={fits || undefined}>
      <div ref={box} id={id} className="l-xtext__box" style={h && !fits ? { height: open ? h.max : h.min } : undefined}>
        <div>{children}</div>
      </div>
      {!fits && h && (
        <button type="button" className="l-xtext__more" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          <span key={String(open)}>{open ? "Less" : "More"}</span>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M5 6.5 8 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
