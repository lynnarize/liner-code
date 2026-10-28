/*
  Liner · Pagination
  Pages with the current one held by a pill that glides between numbers. Far pages fold
  into ellipses, so the row keeps its width. The compact form is just “3 of 12” with arrows.
*/
import { useRef, useState } from "react";
import { cx, useIsoLayoutEffect } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./pagination.css";

export type PaginationProps = {
  count: number;
  page?: number;
  defaultPage?: number;
  onPageChange?: (page: number) => void;
  /** Pages shown on each side of the current one. */
  siblings?: number;
  variant?: "full" | "compact";
  className?: string;
};

/** 1 … 4 5 6 … 12, keeping the row the same length wherever you are. */
export function pageRange(page: number, count: number, siblings = 1): (number | "gap")[] {
  const slots = siblings * 2 + 5;
  if (count <= slots) return Array.from({ length: count }, (_, i) => i + 1);
  const left = Math.max(page - siblings, 2);
  const right = Math.min(page + siblings, count - 1);
  const showL = left > 3;
  const showR = right < count - 2;
  if (!showL) return [...Array.from({ length: slots - 2 }, (_, i) => i + 1), "gap", count];
  if (!showR) return [1, "gap", ...Array.from({ length: slots - 2 }, (_, i) => count - (slots - 3) + i)];
  return [1, "gap", ...Array.from({ length: right - left + 1 }, (_, i) => left + i), "gap", count];
}

const Arrow = ({ d }: { d: string }) => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function Pagination({ count, page, defaultPage = 1, onPageChange, siblings = 1, variant = "full", className }: PaginationProps) {
  const controlled = page !== undefined;
  const [inner, setInner] = useState(defaultPage);
  const current = controlled ? page : inner;
  const row = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const go = (p: number) => {
    const next = Math.min(count, Math.max(1, p));
    if (next === current) return;
    if (!controlled) setInner(next);
    onPageChange?.(next);
    feedback.play("tick", next % 8);
  };
  useIsoLayoutEffect(() => {
    const el = row.current?.querySelector<HTMLElement>("[aria-current=page]");
    if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
  }, [current, count, variant]);

  const prev = (
    <button type="button" className="l-pages__arrow" aria-label="Previous page" disabled={current <= 1} onClick={() => go(current - 1)}>
      <Arrow d="M9.75 4.5 6.25 8l3.5 3.5" />
    </button>
  );
  const next = (
    <button type="button" className="l-pages__arrow" aria-label="Next page" disabled={current >= count} onClick={() => go(current + 1)}>
      <Arrow d="M6.25 4.5 9.75 8l-3.5 3.5" />
    </button>
  );

  if (variant === "compact")
    return (
      <nav className={cx("l-pages", className)} data-variant="compact" aria-label="Pagination">
        {prev}
        <span className="l-pages__status" aria-live="polite">
          <b key={current}>{current}</b> of {count}
        </span>
        {next}
      </nav>
    );

  return (
    <nav className={cx("l-pages", className)} aria-label="Pagination">
      {prev}
      <div ref={row} className="l-pages__row">
        {pill && <span className="l-pages__pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} aria-hidden />}
        {pageRange(current, count, siblings).map((p, i) =>
          p === "gap" ? (
            <span key={`g${i}`} className="l-pages__gap" aria-hidden>
              …
            </span>
          ) : (
            <button key={p} type="button" className="l-pages__num" aria-label={`Page ${p}`} aria-current={p === current ? "page" : undefined} onClick={() => go(p)}>
              {p}
            </button>
          ),
        )}
      </div>
      {next}
    </nav>
  );
}
