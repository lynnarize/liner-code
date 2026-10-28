/*
  Liner · Card stack
  A deck you work through by flicking. The top card follows your finger and leans the way it
  goes; let go past the edge or with enough speed and it flies off, while the cards behind
  step up. Under the threshold it springs home. Buttons and arrow keys do the same.
*/
import { useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { Spring, springs } from "../../lib/spring";
import "./card-stack.css";

export type CardStackProps<T> = {
  items: T[];
  render: (item: T) => ReactNode;
  getKey: (item: T) => string;
  /** Called as a card leaves: left or right. */
  onSwipe?: (item: T, dir: "left" | "right") => void;
  /** Words for the two directions, shown as the card leans. */
  labels?: { left: string; right: string };
  /** Put swiped cards at the back instead of removing them. */
  loop?: boolean;
  className?: string;
};

export function CardStack<T>({ items, render, getKey, onSwipe, labels = { left: "Skip", right: "Keep" }, loop = true, className }: CardStackProps<T>) {
  const [order, setOrder] = useState(items);
  const top = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; t: number } | null>(null);
  const spring = useRef<Spring | null>(null);
  const [lean, setLean] = useState(0);

  const apply = (x: number, y = 0) => {
    const el = top.current;
    if (!el) return;
    el.style.transform = `translate(${x}px, ${y}px) rotate(${x / 18}deg)`;
    setLean(Math.max(-1, Math.min(1, x / 120)));
  };
  const fly = (dir: 1 | -1, velocity = 0) => {
    const item = order[0];
    const w = (top.current?.offsetWidth ?? 300) * 1.6;
    feedback.play(dir > 0 ? "pop" : "tap", dir > 0 ? 5 : 1);
    const s = new Spring(0, springs.smooth, (v) => apply(v));
    s.value = parseFloat(top.current?.style.transform.match(/translate\(([-\d.]+)px/)?.[1] ?? "0");
    s.set(dir * w, {
      velocity,
      config: { stiffness: 120, damping: 20 },
      onRest: () => {
        onSwipe?.(item, dir > 0 ? "right" : "left");
        setOrder((o) => (loop ? [...o.slice(1), o[0]] : o.slice(1)));
        setLean(0);
        if (top.current) top.current.style.transform = "";
      },
    });
  };

  if (!order.length)
    return (
      <div className={cx("l-stack", className)}>
        <div className="l-stack__empty">All done</div>
      </div>
    );

  return (
    <div className={cx("l-stack", className)} tabIndex={0} aria-label="Card stack" onKeyDown={(e) => (e.key === "ArrowRight" ? fly(1) : e.key === "ArrowLeft" ? fly(-1) : null)}>
      <div className="l-stack__deck">
        {order.slice(0, 3).map((item, i) => (
          <div
            key={getKey(item)}
            ref={i === 0 ? top : undefined}
            className="l-stack__card l-frame-solo"
            data-depth={i}
            aria-hidden={i > 0}
            onPointerDown={
              i === 0
                ? (e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    drag.current = { x: e.clientX, y: e.clientY, t: performance.now() };
                    spring.current?.stop();
                    e.currentTarget.dataset.held = "";
                  }
                : undefined
            }
            onPointerMove={
              i === 0
                ? (e) => {
                    const d = drag.current;
                    if (d) apply(e.clientX - d.x, (e.clientY - d.y) * 0.3);
                  }
                : undefined
            }
            onPointerUp={
              i === 0
                ? (e) => {
                    const d = drag.current;
                    drag.current = null;
                    delete e.currentTarget.dataset.held;
                    if (!d) return;
                    const dx = e.clientX - d.x;
                    const v = (dx / Math.max(16, performance.now() - d.t)) * 1000;
                    if (Math.abs(dx) > 110 || Math.abs(v) > 900) return fly(dx > 0 ? 1 : -1, v);
                    // Not far enough: spring home.
                    const s = new Spring(dx, springs.bouncy, (x) => apply(x));
                    spring.current = s;
                    s.set(0, { velocity: v });
                  }
                : undefined
            }
          >
            {i === 0 && (
              <>
                <span className="l-stack__tag" data-side="left" style={{ opacity: Math.max(0, -lean) }} aria-hidden>
                  {labels.left}
                </span>
                <span className="l-stack__tag" data-side="right" style={{ opacity: Math.max(0, lean) }} aria-hidden>
                  {labels.right}
                </span>
              </>
            )}
            {render(item)}
          </div>
        ))}
      </div>
      <div className="l-stack__actions">
        <button type="button" onClick={() => fly(-1)} aria-label={labels.left}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" onClick={() => fly(1)} aria-label={labels.right} data-primary="">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3.6 8.4 6.6 11.3 12.4 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
