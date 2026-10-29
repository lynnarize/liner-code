/*
  Small pieces the screens share: an anchored glass panel with rich rows, agent discs, the
  model chip, badges and the session's status mark.
*/
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "@liner/lib/overlay";
import { cx } from "@liner/lib/hooks";
import type { AgentProfile, Thread } from "@contracts";
import { Glyph, I, ModelMark, Rays, type MarkKind } from "./icons";
import { RollingNumber } from "@liner/components/rolling-number/rolling-number";

type Side = "top" | "bottom";
const EDGE = 10;
const GAP = 6;
type Place = { side: Side | "left"; top: number; left: number; max?: number; ready: boolean };

/** The least room a panel that keeps its side needs there, before it gives up and flips. */
const KEEP_MIN = 260;

/**
  Where a panel opens. Panels live in a layer above the whole window (a portal), so no sidebar,
  paper or scroller clips them. It takes the preferred side when it fits, else the side with more
  room, is never taller than that room (it scrolls inside), and stays inside the window sideways.
  One that `keep`s its side stays there while it has a fair room, and fits itself to it. One
  `beside` its trigger opens to its left, level with it, while there's room there.
*/
function usePlace(open: boolean, anchor: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, prefer: Side, align: "start" | "end" | "center", width: number, keep: boolean, beside = false) {
  const [at, setAt] = useState<Place>({ side: prefer, top: -9999, left: -9999, ready: false });
  useLayoutEffect(() => {
    if (!open) return setAt((a) => ({ ...a, ready: false }));
    const place = () => {
      const a = anchor.current;
      const p = panel.current;
      if (!a || !p) return;
      const r = a.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const below = vh - r.bottom - GAP - EDGE;
      const above = r.top - GAP - EDGE;
      // Its own height, not the one a room it was fitted to gave it: a panel that shrinks into its
      // room would otherwise read as fitting, open up again, and never settle.
      const fitted = p.style.maxHeight;
      p.style.maxHeight = "none";
      const h = p.scrollHeight;
      p.style.maxHeight = fitted;
      const flip: Side = prefer === "bottom" ? "top" : "bottom";
      const room = (s: Side) => (s === "bottom" ? below : above);
      const side: Side = (keep && room(prefer) >= Math.min(h, KEEP_MIN)) || h <= room(prefer) ? prefer : h <= room(flip) ? flip : below >= above ? "bottom" : "top";
      const max = h > room(side) ? Math.max(120, Math.floor(room(side))) : undefined;
      const tall = Math.min(h, max ?? h);
      const w = Math.min(width, vw - EDGE * 2);
      // Beside, to the left (the session tray's menus): level with the trigger's top, kept on screen.
      if (beside && r.left - GAP - w >= EDGE) {
        const fit = Math.min(h, vh - EDGE * 2);
        const top = Math.max(EDGE, Math.min(r.top, vh - EDGE - fit));
        setAt({ side: "left", top: Math.round(top), left: Math.round(r.left - GAP * 2 - w), max: h > fit ? fit : undefined, ready: true });
        return;
      }
      let left = align === "end" ? r.right - w : align === "center" ? r.left + r.width / 2 - w / 2 : r.left;
      left = Math.max(EDGE, Math.min(left, vw - EDGE - w));
      const top = side === "bottom" ? r.bottom + GAP : r.top - GAP - tall;
      setAt({ side, top: Math.round(top), left: Math.round(left), max, ready: true });
    };
    place();
    window.addEventListener("resize", place);
    // A scroller under the trigger moving it: the panel follows rather than floating off.
    window.addEventListener("scroll", place, true);
    // Content that arrives after it opens (a list still loading) gets room, or the other side.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => place());
    if (panel.current?.firstElementChild) ro?.observe(panel.current.firstElementChild);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  return at;
}

/** A trigger and a glass panel under (or over) it, in the layer above the window. The panel gets `close`. */
export function Pop({
  trigger,
  label,
  children,
  align = "start",
  side = "bottom",
  width = 300,
  className,
  triggerClass,
  disabled,
  keep = false,
}: {
  trigger: ReactNode;
  label: string;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end" | "center";
  /** "left" opens beside the trigger, as the session tray's menus do. */
  side?: "top" | "bottom" | "left";
  width?: number;
  className?: string;
  triggerClass?: string;
  disabled?: boolean;
  /** Stay on `side` while there's fair room, fitting to it, rather than flip to where it all fits. */
  keep?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const at = usePlace(open, btn, panel, side === "left" ? "bottom" : side, align, width, keep, side === "left");
  useDismiss(open, () => setOpen(false), [wrap, panel], btn);
  const close = () => {
    setOpen(false);
    btn.current?.focus({ preventScroll: true });
  };
  // Focus moves into the panel once it is placed, so the keyboard carries on inside it.
  useEffect(() => {
    if (!open || !at.ready) return;
    const first = panel.current?.querySelector<HTMLElement>("input, textarea, [data-on], button, [tabindex]:not([tabindex='-1'])");
    first?.focus({ preventScroll: true });
  }, [open, at.ready]);
  return (
    <div ref={wrap} className={cx("lc-pop", className)}>
      <button ref={btn} type="button" className={cx("lc-pick l-focus", triggerClass)} aria-haspopup="dialog" aria-expanded={open} aria-label={label} disabled={disabled} data-open={open || undefined} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="l-pop lc-pop-panel lc-layer"
            data-side={at.side}
            data-align={align}
            data-ready={at.ready || undefined}
            role="dialog"
            aria-label={label}
            // Placed here, not by Liner's anchored rules: those (bottom, translate) would fight the fixed layer.
            style={{ width: Math.min(width, document.documentElement.clientWidth - EDGE * 2), maxHeight: at.max, top: at.top, left: at.left, right: "auto", bottom: "auto", translate: "none" }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
          >
            {children(close)}
          </div>,
          // Inside a modal dialog the panel joins it in the top layer, or the dialog would cover it.
          wrap.current?.closest("dialog[open]") ?? document.body,
        )}
    </div>
  );
}

/** A menu at the pointer, for right-clicks: the same glass panel, kept inside the window. */
export function ContextMenu({ at, label, onClose, children, width = 240 }: { at: { x: number; y: number } | null; label: string; onClose: () => void; children: (close: () => void) => ReactNode; width?: number }) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; max?: number } | null>(null);
  useDismiss(Boolean(at), onClose, [panel]);
  useLayoutEffect(() => {
    if (!at || !panel.current) return setPos(null);
    const h = panel.current.scrollHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const top = at.y + h + EDGE > vh ? Math.max(EDGE, at.y - h) : at.y;
    setPos({ top, left: Math.max(EDGE, Math.min(at.x, vw - width - EDGE)), max: vh - EDGE * 2 });
  }, [at?.x, at?.y]);
  useEffect(() => {
    if (pos) panel.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [pos]);
  if (!at) return null;
  return createPortal(
    <div
      ref={panel}
      className="l-pop lc-pop-panel lc-layer"
      data-side="bottom"
      data-ready={pos ? true : undefined}
      role="menu"
      aria-label={label}
      style={{ width, top: pos?.top ?? -9999, left: pos?.left ?? -9999, maxHeight: pos?.max, right: "auto", bottom: "auto", translate: "none" }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const list = [...(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
          const i = list.indexOf(document.activeElement as HTMLElement);
          list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
          e.preventDefault();
        }
      }}
    >
      {children(onClose)}
    </div>,
    document.body,
  );
}

/** A row in a panel: a title, a note under it, and a check when it is the current one. */
export function Row({ title, note, on, icon, end, disabled, onPick }: { title: ReactNode; note?: ReactNode; on?: boolean; icon?: ReactNode; end?: ReactNode; disabled?: boolean; onPick?: () => void }) {
  return (
    <button type="button" className="lc-row l-focus" data-on={on || undefined} disabled={disabled} aria-pressed={on} onClick={onPick}>
      <span className="lc-row-tick">{on ? <I.check size={14} /> : icon}</span>
      <span className="lc-row-t">
        <b>{title}</b>
        {note && <small>{note}</small>}
      </span>
      {end && <span className="lc-row-end">{end}</span>}
    </button>
  );
}
export const PanelHead = ({ children, end }: { children: ReactNode; end?: ReactNode }) => (
  <div className="lc-pop-head">
    <span>{children}</span>
    {end && <span>{end}</span>}
  </div>
);
export const Sep = () => <span className="lc-sep" role="separator" />;

/** An agent's disc: leads are filled, the rest are outlined. */
export function Disc({ agent, size = 22, lead }: { agent: Pick<AgentProfile, "glyph" | "role" | "name">; size?: number; lead?: boolean }) {
  const filled = lead ?? /lead/i.test(agent.role);
  return (
    <span className="lc-disc" data-filled={filled || undefined} style={{ width: size, height: size }} aria-hidden>
      <Glyph glyph={agent.glyph} size={Math.round(size * 0.56)} />
    </span>
  );
}

/** A model's mark and name, quiet. */
export const ModelTag = ({ kind, label, size = 11 }: { kind: MarkKind; label: string; size?: number }) => (
  <span className="lc-model">
    <ModelMark kind={kind} size={size} />
    {label}
  </span>
);

export function Badge({ tone = "neutral", children, dot = true }: { tone?: "ok" | "warn" | "danger" | "neutral" | "accent"; children: ReactNode; dot?: boolean }) {
  return (
    <span className="lc-badge" data-tone={tone} data-dot={dot || undefined}>
      {children}
    </span>
  );
}

/** How a session stands: rays while it works, amber when it needs you, a ring before it starts, a check when done. */
export function StatusMark({ t, bucket }: { t: Thread; bucket: string }) {
  if (t.status === "running") return <span className="lc-mk" data-s="run" aria-label="Working"><Rays /></span>;
  if (bucket === "needs" && t.turns === 0) return <span className="lc-mk" data-s="new" aria-label="Not started"><i /></span>;
  if (t.status === "limited") return <span className="lc-mk" data-s="needs" aria-label="Limited"><I.clock size={11} /></span>;
  if (bucket === "needs") return <span className="lc-mk" data-s="needs" aria-label="Needs you"><i /></span>;
  if (t.turns === 0) return <span className="lc-mk" data-s="new" aria-label="Not started"><i /></span>;
  return <span className="lc-mk" data-s="done" aria-label="Done"><I.check size={11} /></span>;
}

/** +19 −7, in mono. */
export const Lines = ({ added, removed }: { added: number; removed: number }) => (
  <span className="lc-lines">
    {added > 0 && <span data-add>+{added}</span>}
    {removed > 0 && <span data-del>−{removed}</span>}
  </span>
);

/** A ring that fills with how much of the context window is used. */
export function ContextRing({ used, size = 14 }: { used: number; size?: number }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, used));
  return (
    <span className="lc-ring" data-warn={p > 0.8 || undefined} title={`${Math.round(p * 100)}% of the context used`}>
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
        <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
        <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={c} strokeDashoffset={c * (1 - p)} strokeLinecap="round" transform="rotate(-90 7 7)" />
      </svg>
      {Math.round(p * 100)}%
    </span>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="lc-kbd">{children}</kbd>;

/**
  A figure that rolls to its new value, digit by digit (Liner's rolling number), written the way
  the rest of Liner Code writes it: 152k, 1.2M, $0.31, 77%.
*/
export function Num({ value, as = "count" }: { value: number; as?: "count" | "compact" | "money" | "percent" }) {
  if (as === "money") return <RollingNumber value={value} format={{ style: "currency", currency: "USD", minimumFractionDigits: value >= 100 ? 0 : 2, maximumFractionDigits: value >= 100 ? 0 : 2 }} />;
  if (as === "percent") return <RollingNumber value={value} format={{ style: "percent", maximumFractionDigits: 0 }} />;
  if (as === "compact" && value >= 1e3) {
    const big = value >= 1e6;
    const n = big ? value / 1e6 : value / 1e3;
    return (
      <span className="lc-num">
        <RollingNumber value={n} format={{ maximumFractionDigits: big || n < 10 ? 1 : 0 }} />
        {big ? "M" : "k"}
      </span>
    );
  }
  return <RollingNumber value={value} />;
}
