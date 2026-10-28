/*
  Liner · Reorderable list
  Drag a row by its handle and the others make room as you pass them; let go and it settles
  into its slot. From the keyboard: Space lifts, the arrows move, Space drops, Escape puts
  it back. Each move is announced.
*/
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { prefersReducedMotion } from "../../lib/spring";
import "./reorderable-list.css";

export type ReorderableListProps<T> = {
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  render: (item: T) => ReactNode;
  onReorder?: (items: T[]) => void;
  label: string;
  className?: string;
};

const move = <T,>(list: T[], from: number, to: number) => {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
};

export function ReorderableList<T>({ items: initial, getKey, getLabel, render, onReorder, label, className }: ReorderableListProps<T>) {
  const [items, setItems] = useState(initial);
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number } | null>(null);
  const [lifted, setLifted] = useState<{ key: string; start: T[] } | null>(null);
  const [say, setSay] = useState("");
  // For the frame a drop lands in, rows drop their drag offsets without transitioning.
  const [settling, setSettling] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const geo = useRef<{ y: number; tops: number[]; heights: number[]; gap: number } | null>(null);
  const before = useRef(new Map<string, number>());

  // After an order change, slide every row from where it was drawn to where it now sits.
  useLayoutEffect(() => {
    const was = before.current;
    if (!was.size || prefersReducedMotion()) return;
    list.current?.querySelectorAll<HTMLElement>("[data-key]").forEach((el) => {
      const top = was.get(el.dataset.key!);
      if (top === undefined) return;
      const d = top - el.getBoundingClientRect().top;
      if (Math.abs(d) > 0.5) el.animate([{ transform: `translateY(${d}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" });
    });
    before.current = new Map();
  }, [items]);

  const snapshot = () => {
    const m = new Map<string, number>();
    list.current?.querySelectorAll<HTMLElement>("[data-key]").forEach((el) => m.set(el.dataset.key!, el.getBoundingClientRect().top));
    before.current = m;
  };
  const commit = (next: T[]) => {
    snapshot();
    setItems(next);
    onReorder?.(next);
  };

  const shift = (i: number) => {
    if (!drag || !geo.current) return 0;
    const { from, to } = drag;
    const h = geo.current.heights[from] + geo.current.gap;
    if (from < to && i > from && i <= to) return -h;
    if (from > to && i >= to && i < from) return h;
    return 0;
  };

  return (
    <div className={cx("l-reorder l-frame", className)}>
      <ul ref={list} className="l-reorder__list l-frame-card" aria-label={label} data-dragging={drag ? "" : undefined} data-settling={settling || undefined}>
        {items.map((it, i) => {
          const k = getKey(it);
          const isDragged = drag?.from === i;
          const isLifted = lifted?.key === k;
          return (
            <li
              key={k}
              data-key={k}
              className="l-reorder__item"
              data-dragged={isDragged || undefined}
              data-lifted={isLifted || undefined}
              style={{ transform: isDragged ? `translateY(${drag!.dy}px)` : drag ? `translateY(${shift(i)}px)` : undefined }}
            >
              <button
                type="button"
                className="l-reorder__handle"
                aria-label={`Reorder ${getLabel(it)}`}
                aria-pressed={isLifted}
                aria-describedby="l-reorder-help"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const els = [...list.current!.querySelectorAll<HTMLElement>("[data-key]")];
                  const rects = els.map((el) => el.getBoundingClientRect());
                  geo.current = { y: e.clientY, tops: rects.map((r) => r.top), heights: rects.map((r) => r.height), gap: rects[1] ? rects[1].top - rects[0].bottom : 0 };
                  setDrag({ from: i, to: i, dy: 0 });
                  feedback.play("tap", 2);
                }}
                onPointerMove={(e) => {
                  const g = geo.current;
                  if (!drag || !g) return;
                  const dy = e.clientY - g.y;
                  const center = g.tops[drag.from] + g.heights[drag.from] / 2 + dy;
                  // Its new index is how many other rows' middles it has passed.
                  let to = 0;
                  g.tops.forEach((t, j) => {
                    if (j !== drag.from && center > t + g.heights[j] / 2) to++;
                  });
                  if (to !== drag.to) feedback.play("tick", to);
                  setDrag({ ...drag, to, dy });
                }}
                onPointerUp={() => {
                  if (!drag) return;
                  const next = move(items, drag.from, drag.to);
                  setSettling(true);
                  requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)));
                  setDrag(null);
                  if (drag.from !== drag.to) {
                    commit(next);
                    setSay(`${getLabel(it)} moved to position ${drag.to + 1} of ${items.length}`);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    if (isLifted) {
                      setLifted(null);
                      setSay(`${getLabel(it)} dropped at position ${i + 1}`);
                      onReorder?.(items);
                    } else {
                      setLifted({ key: k, start: items });
                      setSay(`${getLabel(it)} lifted. Use the arrow keys to move, Space to drop, Escape to cancel.`);
                    }
                  } else if (isLifted && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    const to = Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowUp" ? -1 : 1)));
                    if (to === i) return;
                    snapshot();
                    setItems(move(items, i, to));
                    setSay(`Position ${to + 1} of ${items.length}`);
                    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(k)}"] .l-reorder__handle`)?.focus());
                  } else if (isLifted && e.key === "Escape") {
                    e.preventDefault();
                    snapshot();
                    setItems(lifted!.start);
                    setLifted(null);
                    setSay("Move cancelled");
                  }
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden>
                  {[5, 8, 11].map((y) => (
                    <g key={y}>
                      <circle cx="6" cy={y} r="1.1" />
                      <circle cx="10" cy={y} r="1.1" />
                    </g>
                  ))}
                </svg>
              </button>
              <div className="l-reorder__body">{render(it)}</div>
            </li>
          );
        })}
      </ul>
      <span id="l-reorder-help" className="l-reorder__sr">
        Press Space to lift, arrow keys to move, Space to drop.
      </span>
      <span className="l-reorder__sr" aria-live="assertive">
        {say}
      </span>
    </div>
  );
}
