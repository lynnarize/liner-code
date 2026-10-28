/*
  Liner · Swipe actions
  Swipe a row to reveal its actions; swipe far enough and the first one runs. The same
  actions are always in the row's menu, so nothing is reachable only by gesture.
*/
import { useRef, useState, type ReactNode } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import { clamp, rubber } from "../../lib/spring";
import { useDismiss } from "../../lib/overlay";
import { MenuPanel } from "../menu/menu";
import "./swipe-actions.css";

export type SwipeAction = { id: string; label: string; icon?: ReactNode; tone?: "danger" | "accent" | "neutral"; onAction: () => void };

/** Rows of SwipeActions in one glass frame holding a white card, split by hairlines. */
export function SwipeList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("l-swipe-list l-frame", className)}>
      <div className="l-swipe-list__card l-frame-card">{children}</div>
    </div>
  );
}

export function SwipeActions({ actions, leading, children, label = "Row actions", className }: { actions: SwipeAction[]; leading?: SwipeAction; children: ReactNode; label?: string; className?: string }) {
  const W = 76;
  const max = actions.length * W;
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState(false);
  const [gone, setGone] = useState<"left" | "right" | null>(null);
  const [menu, setMenu] = useState(false);
  const start = useRef<{ x: number; y: number; from: number; axis: "x" | "y" | null } | null>(null);
  const menuWrap = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const armed = useRef(false);
  useDismiss(menu, () => setMenu(false), [menuWrap]);

  const run = (a: SwipeAction, dir: "left" | "right") => {
    setGone(dir);
    feedback.play(a.tone === "danger" ? "tap" : "success", a.tone === "danger" ? -3 : 2);
    window.setTimeout(() => {
      a.onAction();
      setGone(null);
      setX(0);
    }, 320);
  };

  return (
    <div className={cx("l-swipe", className)} data-gone={gone ?? undefined}>
      {leading && (
        <div className="l-swipe-lead" data-tone={leading.tone ?? "accent"} aria-hidden style={{ opacity: clamp(x / W, 0, 1) }}>
          {leading.icon}
          {leading.label}
        </div>
      )}
      <div className="l-swipe-acts" aria-hidden={x > -10}>
        {actions.map((a, i) => (
          <button
            key={a.id}
            type="button"
            tabIndex={-1}
            className="l-swipe-act"
            data-tone={a.tone ?? "neutral"}
            // Each action rides out from under the row at its own pace.
            style={{ width: i === 0 && x < -max ? -x - (actions.length - 1) * W : W, transform: `translateX(${Math.max(0, (x + max) * ((actions.length - i) / actions.length))}px)` }}
            onClick={() => run(a, "left")}
          >
            {a.icon}
            <span>{a.label}</span>
          </button>
        ))}
      </div>
      <div
        className="l-swipe-row"
        data-drag={drag || undefined}
        style={{ transform: gone ? undefined : `translateX(${x}px)` }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          start.current = { x: e.clientX, y: e.clientY, from: x, axis: null };
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (!s.axis) {
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
            s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
            if (s.axis === "x") e.currentTarget.setPointerCapture(e.pointerId);
          }
          if (s.axis !== "x") return;
          setDrag(true);
          let next = s.from + dx;
          // Past the actions the row resists; past the full-swipe line it arms.
          if (next < -max) next = -max - rubber(-max - next, 260, 0.6);
          if (next > 0) next = leading ? Math.min(next, W * 1.6) : rubber(next, 200, 0.35);
          const arm = next < -max - 60 || (leading ? next > W * 1.2 : false);
          if (arm !== armed.current) {
            armed.current = arm;
            feedback.play("tick", arm ? 6 : 0);
          }
          setX(next);
        }}
        onPointerUp={() => {
          const s = start.current;
          start.current = null;
          setDrag(false);
          if (!s || s.axis !== "x") return;
          if (armed.current) {
            armed.current = false;
            if (x < 0) return run(actions[0], "left");
            if (leading) return run(leading, "right");
          }
          setX(x < -max / 2 ? -max : 0);
        }}
      >
        {children}
        <span ref={menuWrap} className="l-swipe-more l-anchor">
          <button
            ref={moreBtn}
            type="button"
            className="l-swipe-more-btn l-focus"
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={menu}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setMenu((m) => !m)}
          >
            <svg viewBox="0 0 16 16" aria-hidden>
              <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
              <circle cx="8" cy="8" r="1.3" fill="currentColor" />
              <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
            </svg>
          </button>
          {menu && (
            <MenuPanel
              label={label}
              align="end"
              items={[...(leading ? [leading] : []), ...actions].map((a) => ({ id: a.id, label: a.label, icon: a.icon, danger: a.tone === "danger", onSelect: () => run(a, a === leading ? "right" : "left") }))}
              onClose={(refocus) => {
                setMenu(false);
                if (refocus) moreBtn.current?.focus({ preventScroll: true });
              }}
            />
          )}
        </span>
      </div>
    </div>
  );
}
