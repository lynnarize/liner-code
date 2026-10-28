/*
  Liner · Drawer
  A side panel for detail or settings that keeps the page in view. It slides in from the
  edge as a glass frame around a white card, and you can push it back out with a flick.
*/
import { useId, useRef, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { useModal } from "../dialog/use-modal";
import "../dialog/dialog.css";
import "./drawer.css";

export type DrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  side?: "right" | "left";
  width?: number;
  className?: string;
};

export function Drawer({ open, onOpenChange, title, description, children, actions, side = "right", width = 400, className }: DrawerProps) {
  const id = useId();
  const modal = useModal(open, onOpenChange, 260);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; t: number; dx: number } | null>(null);
  const sign = side === "right" ? 1 : -1;

  return (
    <dialog {...modal} className={cx("l-drawer", className)} data-side={side} aria-labelledby={`${id}-t`} style={{ ["--w" as string]: `${width}px` }}>
      <div ref={panel} className="l-drawer__frame l-frame l-frame-float">
        <header
          className="l-frame-strip l-drawer__head"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, t: performance.now(), dx: 0 };
            panel.current!.style.transition = "none";
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            // Toward the edge follows the finger; away from it barely gives.
            const raw = (e.clientX - d.x) * sign;
            d.dx = raw > 0 ? raw : raw / 6;
            panel.current!.style.translate = `${d.dx * sign}px 0`;
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            const el = panel.current!;
            el.style.transition = "";
            el.style.translate = "";
            if (!d) return;
            const v = ((e.clientX - d.x) * sign) / Math.max(1, performance.now() - d.t);
            if (d.dx > width * 0.35 || v > 0.6) onOpenChange(false);
          }}
        >
          <div className="l-drawer__titles">
            <h2 id={`${id}-t`}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="l-dialog__x l-drawer__x" aria-label="Close" onClick={() => onOpenChange(false)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="m4.5 4.5 7 7m0-7-7 7" />
            </svg>
          </button>
        </header>
        <div className="l-frame-card l-drawer__card">{children}</div>
        {actions && <div className="l-frame-strip l-drawer__actions">{actions}</div>}
      </div>
    </dialog>
  );
}
