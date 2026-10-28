/*
  Liner · Bottom sheet
  A sheet that rises from the bottom and rests at detents, like a phone's. Drag the grabber
  to move between them: the sheet follows your finger, and on release a spring carries the
  flick to the nearest detent, or below the lowest one to close.
*/
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx, useSpring } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { rubber, springs } from "../../lib/spring";
import { useModal } from "../dialog/use-modal";
import "../dialog/dialog.css";
import "./bottom-sheet.css";

export type BottomSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children?: ReactNode;
  /** Resting heights as fractions of the viewport, lowest first. */
  detents?: number[];
  className?: string;
};

export function BottomSheet({ open, onOpenChange, title, children, detents = [0.45, 0.9], className }: BottomSheetProps) {
  const id = useId();
  const modal = useModal(open, onOpenChange, 0);
  const sheet = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const drag = useRef<{ y: number; start: number; t: number; lastY: number; lastT: number } | null>(null);
  const vh = () => window.innerHeight;
  const max = () => Math.max(...detents) * vh();
  // y is how far the sheet sits below its tallest detent, in px.
  const y = useSpring(0, springs.smooth, (v) => {
    if (sheet.current) sheet.current.style.transform = `translateY(${v}px)`;
  });
  const yFor = (i: number) => max() - detents[i] * vh();

  useEffect(() => {
    if (!open) return;
    setAt(0);
    y.jump(max());
    requestAnimationFrame(() => y.set(yFor(0), { config: springs.morph }));
  }, [open]);

  const close = () => {
    y.set(max() + 40, { config: springs.smooth, onRest: () => onOpenChange(false) });
  };

  const settle = (pos: number, velocity: number) => {
    // Where the flick would carry it, then the nearest detent to that.
    const projected = pos + velocity * 0.18;
    if (projected > yFor(0) + (max() - yFor(0)) * 0.5 + 40) return close();
    let best = 0;
    detents.forEach((_, i) => {
      if (Math.abs(yFor(i) - projected) < Math.abs(yFor(best) - projected)) best = i;
    });
    if (best !== at) feedback.play("tick", best * 4);
    setAt(best);
    y.set(yFor(best), { velocity, config: springs.morph });
  };

  return (
    <dialog
      {...modal}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onPointerDown={(e) => e.target === e.currentTarget && close()}
      className={cx("l-sheet", className)}
      aria-labelledby={`${id}-t`}
    >
      <div ref={sheet} className="l-sheet__frame l-frame l-frame-float" style={{ height: `${Math.max(...detents) * 100}dvh` }}>
        <div
          className="l-sheet__grab"
          role="slider"
          tabIndex={0}
          aria-label="Sheet height"
          aria-valuemin={0}
          aria-valuemax={detents.length - 1}
          aria-valuenow={at}
          aria-valuetext={`${Math.round(detents[at] * 100)}% of the screen`}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && at < detents.length - 1) settle(yFor(at + 1), 0);
            else if (e.key === "ArrowDown") at > 0 ? settle(yFor(at - 1), 0) : close();
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const now = performance.now();
            drag.current = { y: e.clientY, start: y.value, t: now, lastY: e.clientY, lastT: now };
            y.stop();
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            let next = d.start + (e.clientY - d.y);
            // Above the tallest detent the sheet resists.
            if (next < 0) next = rubber(next, vh() * 0.4);
            y.jump(next);
            d.lastT = performance.now();
            d.lastY = e.clientY;
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (!d) return;
            const dt = Math.max(16, performance.now() - d.t);
            settle(y.value, ((e.clientY - d.y) / dt) * 1000);
          }}
        >
          <span aria-hidden />
        </div>
        <div className="l-frame-card l-sheet__card">
          <h2 id={`${id}-t`} className="l-sheet__title">
            {title}
          </h2>
          <div className="l-sheet__body">{children}</div>
        </div>
      </div>
    </dialog>
  );
}
