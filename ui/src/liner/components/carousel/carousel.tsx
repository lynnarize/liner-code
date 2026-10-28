/*
  Liner · Carousel
  A row of slides on native scroll-snap, so trackpads, touch and momentum behave as the
  platform does. Arrows step a page at a time, a mouse can drag it, and a thin progress line
  shows where you are instead of a row of dots.
*/
import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./carousel.css";

export type CarouselProps = {
  children: ReactNode;
  label: string;
  /** Slide width (any CSS length). */
  slide?: string;
  gap?: number;
  className?: string;
};

export function Carousel({ children, label, slide = "min(78%, 300px)", gap = 12, className }: CarouselProps) {
  const track = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ at: 0, size: 1, start: true, end: false });
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const slides = Children.toArray(children);

  const measure = () => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setPos({ at: max > 0 ? el.scrollLeft / max : 0, size: el.clientWidth / el.scrollWidth, start: el.scrollLeft < 4, end: el.scrollLeft > max - 4 });
  };
  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track.current!);
    return () => ro.disconnect();
  }, []);

  const page = (dir: 1 | -1) => {
    const el = track.current!;
    const first = el.firstElementChild as HTMLElement | null;
    const step = first ? first.offsetWidth + gap : el.clientWidth;
    // Step by whole slides, as many as fit.
    const n = Math.max(1, Math.floor((el.clientWidth + gap) / step));
    el.scrollBy({ left: dir * n * step, behavior: "smooth" });
    feedback.play("tick", dir > 0 ? 5 : 2);
  };

  return (
    <section className={cx("l-carousel", className)} aria-roledescription="carousel" aria-label={label}>
      <div
        ref={track}
        className="l-carousel__track"
        style={{ ["--slide" as string]: slide, gap }}
        tabIndex={0}
        onScroll={measure}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            page(e.key === "ArrowRight" ? 1 : -1);
          }
        }}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse") return;
          drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (!d.moved && Math.abs(dx) > 4) {
            d.moved = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            e.currentTarget.dataset.dragging = "";
          }
          if (d.moved) e.currentTarget.scrollLeft = d.left - dx;
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          delete e.currentTarget.dataset.dragging;
          if (d?.moved) {
            // Let snapping pick the nearest slide after a drag.
            const el = e.currentTarget;
            const first = el.firstElementChild as HTMLElement | null;
            const step = first ? first.offsetWidth + gap : el.clientWidth;
            el.scrollTo({ left: Math.round(el.scrollLeft / step) * step, behavior: "smooth" });
          }
        }}
        onClickCapture={(e) => {
          // A drag is not a click on whatever it ended over.
          if (track.current?.hasAttribute("data-dragging")) e.stopPropagation();
        }}
      >
        {slides.map((s, i) => (
          <div key={i} className="l-carousel__slide" role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`}>
            {s}
          </div>
        ))}
      </div>
      <div className="l-carousel__bar">
        <span className="l-carousel__progress" aria-hidden>
          <i style={{ width: `${pos.size * 100}%`, left: `${pos.at * (1 - pos.size) * 100}%` }} />
        </span>
        <span className="l-carousel__nav">
          <button type="button" aria-label="Previous" disabled={pos.start} onClick={() => page(-1)}>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M9.75 4.5 6.25 8l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" aria-label="Next" disabled={pos.end} onClick={() => page(1)}>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M6.25 4.5 9.75 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </span>
      </div>
    </section>
  );
}
