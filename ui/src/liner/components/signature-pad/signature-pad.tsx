/*
  Liner · Signature pad
  Ink that behaves like a pen: lines thin out when you move fast and swell when you slow
  down, and every stroke is smoothed through midpoints. Strokes are kept as points, so the
  signature redraws crisply at any size, in either theme, and undo is exact.
*/
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { cx } from "../../lib/hooks";
import { feedback } from "../../lib/feedback";
import "./signature-pad.css";

type Pt = { x: number; y: number; w: number };
export type SignaturePadProps = {
  /** Called after each stroke with a PNG, or null once cleared. */
  onChange?: (png: string | null) => void;
  label?: string;
  /** Thickest line, in px. */
  weight?: number;
  height?: number;
  className?: string;
};

export function SignaturePad({ onChange, label = "Sign here", weight = 3.4, height = 180, className }: SignaturePadProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Pt[][]>([]);
  const live = useRef<{ pts: Pt[]; t: number; v: number } | null>(null);
  const [count, setCount] = useState(0);

  const ctx = () => canvas.current?.getContext("2d") ?? null;
  const ink = () => (canvas.current ? getComputedStyle(canvas.current).color : "#000");

  /** One stroke as quadratic curves between midpoints, each segment at its own width. */
  const paint = (c: CanvasRenderingContext2D, pts: Pt[]) => {
    c.fillStyle = c.strokeStyle = ink();
    c.lineCap = c.lineJoin = "round";
    if (pts.length === 1) {
      c.beginPath();
      c.arc(pts[0].x, pts[0].y, pts[0].w / 2, 0, Math.PI * 2);
      c.fill();
      return;
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const p = pts[i - 2] ?? a;
      const m1 = { x: (p.x + a.x) / 2, y: (p.y + a.y) / 2 };
      const m2 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      c.beginPath();
      c.lineWidth = (a.w + b.w) / 2;
      c.moveTo(m1.x, m1.y);
      c.quadraticCurveTo(a.x, a.y, m2.x, m2.y);
      c.stroke();
    }
  };

  const redraw = () => {
    const el = canvas.current;
    const c = ctx();
    if (!el || !c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    strokes.current.forEach((s) => paint(c, s));
  };

  useEffect(() => {
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas.current!);
    // Ink follows the theme: redraw when it changes.
    const mo = new MutationObserver(redraw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  const emit = () => {
    setCount(strokes.current.length);
    if (!onChange) return;
    onChange(strokes.current.length ? canvas.current!.toDataURL("image/png") : null);
  };

  const point = (e: PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div className={cx("l-sign l-frame", className)} data-empty={count === 0 || undefined}>
      <div className="l-sign__card l-frame-card" style={{ height }}>
        <canvas
          ref={canvas}
          className="l-sign__canvas"
          role="img"
          aria-label={count ? "Signature" : label}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = point(e);
            const w = e.pointerType === "pen" && e.pressure ? weight * (0.4 + e.pressure) : weight * 0.8;
            live.current = { pts: [{ ...p, w }], t: performance.now(), v: 0 };
            strokes.current.push(live.current.pts);
            redraw();
          }}
          onPointerMove={(e) => {
            const s = live.current;
            if (!s) return;
            const p = point(e);
            const last = s.pts[s.pts.length - 1];
            const d = Math.hypot(p.x - last.x, p.y - last.y);
            if (d < 1.5) return;
            const now = performance.now();
            // Speed, smoothed: fast strokes thin out, slow ones swell.
            const v = d / Math.max(1, now - s.t);
            s.v = s.v * 0.7 + v * 0.3;
            s.t = now;
            const target = e.pointerType === "pen" && e.pressure ? weight * (0.35 + e.pressure * 0.9) : Math.max(weight * 0.35, weight - s.v * weight * 0.55);
            const w = last.w + (target - last.w) * 0.35;
            s.pts.push({ ...p, w });
            const c = ctx();
            if (c) paint(c, s.pts.slice(-3));
          }}
          onPointerUp={() => {
            if (!live.current) return;
            live.current = null;
            redraw();
            emit();
          }}
          onPointerCancel={() => {
            live.current = null;
          }}
        />
        <div className="l-sign__line" aria-hidden>
          <span>×</span>
          <i />
        </div>
        <span className="l-sign__hint" aria-hidden>
          {label}
        </span>
      </div>
      <div className="l-frame-strip l-sign__strip">
        <span className="l-sign__status" key={count ? "s" : "e"}>
          {count ? "Signed" : "Draw with a finger, pen or mouse"}
        </span>
        <span className="l-sign__tools">
          <button
            type="button"
            className="l-sign__btn"
            disabled={!count}
            onClick={() => {
              strokes.current.pop();
              redraw();
              emit();
              feedback.play("tick");
            }}
          >
            Undo
          </button>
          <button
            type="button"
            className="l-sign__btn"
            disabled={!count}
            onClick={() => {
              strokes.current = [];
              redraw();
              emit();
              feedback.play("tap");
            }}
          >
            Clear
          </button>
        </span>
      </div>
    </div>
  );
}
