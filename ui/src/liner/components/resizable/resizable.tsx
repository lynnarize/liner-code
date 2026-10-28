/*
  Liner · Resizable panels
  Cards side by side (or stacked) with a handle between each pair. Drag the handle, or
  focus it and use the arrows. Panels keep their minimum; one that allows collapsing snaps
  shut when pulled below it, and double-clicking a handle puts the split back.
*/
import { Children, Fragment, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./resizable.css";

export type PanelSpec = { min?: number; collapsible?: boolean; label?: string };
export type ResizablePanelsProps = {
  children: ReactNode;
  /** Starting sizes in percent, one per panel. */
  defaultSizes: number[];
  panels?: PanelSpec[];
  direction?: "horizontal" | "vertical";
  onSizesChange?: (sizes: number[]) => void;
  /** Height of the group; vertical groups need one. */
  height?: number | string;
  className?: string;
};

export function ResizablePanels({ children, defaultSizes, panels = [], direction = "horizontal", onSizesChange, height = 320, className }: ResizablePanelsProps) {
  const kids = Children.toArray(children);
  const [sizes, setSizes] = useState(defaultSizes);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; start: number; sizes: number[]; total: number } | null>(null);
  const [held, setHeld] = useState<number | null>(null);
  const horizontal = direction === "horizontal";

  /** Move the split after panel i by d percent, honouring minimums and collapse. */
  const resize = (i: number, d: number, from = sizes) => {
    const a = panels[i] ?? {};
    const b = panels[i + 1] ?? {};
    const pair = from[i] + from[i + 1];
    let x = from[i] + d;
    const minA = a.min ?? 10;
    const minB = b.min ?? 10;
    // Below the minimum, a collapsible panel snaps shut; others just stop.
    if (x < minA) x = a.collapsible && x < minA / 2 ? 0 : minA;
    if (pair - x < minB) x = b.collapsible && pair - x < minB / 2 ? pair : pair - minB;
    const next = [...from];
    next[i] = x;
    next[i + 1] = pair - x;
    if ((x === 0 || x === pair) !== (from[i] === 0 || from[i] === pair)) feedback.play("pop", x === 0 ? 1 : 5);
    setSizes(next);
    onSizesChange?.(next);
  };

  const onKey = (i: number) => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    const back = horizontal ? "ArrowLeft" : "ArrowUp";
    const fwd = horizontal ? "ArrowRight" : "ArrowDown";
    if (e.key === back) resize(i, -step);
    else if (e.key === fwd) resize(i, step);
    else if (e.key === "Home") resize(i, -100);
    else if (e.key === "End") resize(i, 100);
    else if (e.key === "Enter") resize(i, defaultSizes[i] - sizes[i]);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={root}
      className={cx("l-panes l-frame", className)}
      data-direction={direction}
      data-dragging={held !== null || undefined}
      style={{ height, gridTemplateColumns: horizontal ? sizes.map((s, i) => `${s}fr${i < sizes.length - 1 ? " 12px" : ""}`).join(" ") : undefined, gridTemplateRows: horizontal ? undefined : sizes.map((s, i) => `${s}fr${i < sizes.length - 1 ? " 12px" : ""}`).join(" ") }}
    >
      {kids.map((child, i) => (
        <Fragment key={i}>
          <div className="l-panes__panel l-frame-card" data-collapsed={sizes[i] === 0 || undefined} aria-hidden={sizes[i] === 0 || undefined}>
            <div className="l-panes__inner">{child}</div>
          </div>
          {i < kids.length - 1 && (
            <div
              className="l-panes__handle"
              role="separator"
              tabIndex={0}
              aria-orientation={horizontal ? "vertical" : "horizontal"}
              aria-label={`Resize ${panels[i]?.label ?? `panel ${i + 1}`}`}
              aria-valuenow={Math.round(sizes[i])}
              aria-valuemin={0}
              aria-valuemax={100}
              data-held={held === i || undefined}
              onKeyDown={onKey(i)}
              onDoubleClick={() => resize(i, defaultSizes[i] - sizes[i])}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const r = root.current!.getBoundingClientRect();
                drag.current = { i, start: horizontal ? e.clientX : e.clientY, sizes, total: horizontal ? r.width : r.height };
                setHeld(i);
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                const sum = d.sizes.reduce((a, b) => a + b, 0);
                const px = (horizontal ? e.clientX : e.clientY) - d.start;
                resize(d.i, (px / d.total) * sum, d.sizes);
              }}
              onPointerUp={() => {
                drag.current = null;
                setHeld(null);
              }}
            >
              <span className="l-panes__grip" aria-hidden />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
