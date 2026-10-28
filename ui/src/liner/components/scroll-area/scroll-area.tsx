/*
  Liner · Scroll area
  Native scrolling with a quieter bar. The thumb is a thin line that shows while you scroll
  or hover and fades when you stop; it widens under the pointer and can be dragged. Edges
  fade where there is more to see.
*/
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import "./scroll-area.css";

export type ScrollAreaProps = {
  children: ReactNode;
  /** Max height before it scrolls (any CSS length). */
  height?: number | string;
  /** Fade the edges that have more content past them. */
  fade?: boolean;
  label?: string;
  className?: string;
};

export function ScrollArea({ children, height = 280, fade = true, label, className }: ScrollAreaProps) {
  const view = useRef<HTMLDivElement>(null);
  const [m, setM] = useState({ top: 0, size: 1, start: false, end: false, need: false });
  const [active, setActive] = useState(false);
  const idle = useRef<number | undefined>(undefined);
  const drag = useRef<{ y: number; top: number } | null>(null);

  const measure = () => {
    const el = view.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const size = clientHeight / scrollHeight;
    setM({ top: scrollHeight > clientHeight ? (scrollTop / (scrollHeight - clientHeight)) * (1 - size) : 0, size, start: scrollTop > 2, end: scrollTop + clientHeight < scrollHeight - 2, need: scrollHeight > clientHeight + 1 });
  };
  useEffect(() => {
    measure();
    const el = view.current!;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);

  const wake = () => {
    setActive(true);
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => !drag.current && setActive(false), 900);
  };

  return (
    <div
      className={cx("l-scroll", className)}
      data-active={active || undefined}
      data-fade-start={(fade && m.start) || undefined}
      data-fade-end={(fade && m.end) || undefined}
      style={{ ["--h" as string]: typeof height === "number" ? `${height}px` : height }}
    >
      <div
        ref={view}
        className="l-scroll__view"
        tabIndex={0}
        role={label ? "region" : undefined}
        aria-label={label}
        onScroll={() => {
          measure();
          wake();
        }}
      >
        <div className="l-scroll__content">{children}</div>
      </div>
      {m.need && (
        <div
          className="l-scroll__bar"
          aria-hidden
          onPointerEnter={() => setActive(true)}
          onPointerLeave={wake}
          onPointerDown={(e) => {
            const el = view.current!;
            const bar = e.currentTarget.getBoundingClientRect();
            const y = (e.clientY - bar.top) / bar.height;
            // Press on the track: jump there. Press on the thumb: hold it.
            if (y < m.top || y > m.top + m.size) el.scrollTo({ top: ((y - m.size / 2) / (1 - m.size)) * (el.scrollHeight - el.clientHeight), behavior: "smooth" });
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { y: e.clientY, top: el.scrollTop };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            const el = view.current!;
            if (!d) return;
            const bar = e.currentTarget.getBoundingClientRect();
            el.scrollTop = d.top + ((e.clientY - d.y) / (bar.height * (1 - m.size))) * (el.scrollHeight - el.clientHeight);
          }}
          onPointerUp={() => {
            drag.current = null;
            wake();
          }}
        >
          <span className="l-scroll__thumb" style={{ top: `${m.top * 100}%`, height: `${m.size * 100}%` }} />
        </div>
      )}
    </div>
  );
}
