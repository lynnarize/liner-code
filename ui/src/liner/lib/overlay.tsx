/*
  Liner overlay kit
  What every anchored surface shares: dismissal, placement, and a keyboard list with
  one gliding highlight. Menus, selects, pickers, popovers and tooltips all build on it.
  Panels are positioned inside a relative wrapper, so nothing portals or measures the page.
*/
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { feedback } from "./feedback";
import "./overlay.css";

/** Close on a pointer outside every ref, and on Escape (which hands focus back to `returnTo`). */
export function useDismiss(open: boolean, close: () => void, refs: RefObject<HTMLElement | null>[], returnTo?: RefObject<HTMLElement | null>) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (refs.some((r) => r.current?.contains(t))) return;
      closeRef.current();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      closeRef.current();
      returnTo?.current?.focus({ preventScroll: true });
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
    // Refs are stable; listening once per open is enough.
  }, [open]);
}

export type Side = "top" | "bottom";

/** Opens below unless there is clearly more room above. Measured once per open. */
export function useFlip(open: boolean, anchor: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, prefer: Side = "bottom"): Side {
  const [side, setSide] = useState<Side>(prefer);
  useLayoutEffect(() => {
    if (!open) return;
    const a = anchor.current?.getBoundingClientRect();
    // A display: contents wrapper has no box; measure what it holds.
    const p = panel.current;
    const h = p ? p.offsetHeight || (p.firstElementChild as HTMLElement | null)?.offsetHeight || 0 : 0;
    if (!a) return;
    // Room is measured inside the nearest box that clips (a card, a scroller), not just the window.
    let top = 0;
    let bottom = window.innerHeight;
    for (let el = anchor.current?.parentElement; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.overflowY !== "visible" || cs.overflowX !== "visible") {
        const r = el.getBoundingClientRect();
        top = Math.max(top, r.top);
        bottom = Math.min(bottom, r.bottom);
        break;
      }
    }
    // Keep the panel inside the window sideways: nudge it back in rather than letting it run off.
    const box = p && (p.offsetWidth ? p : (p.firstElementChild as HTMLElement | null));
    if (box) {
      box.style.marginLeft = "";
      // Width from layout, not the box: the panel is mid-way through a scale-in here.
      const left = box.getBoundingClientRect().left;
      const right = left + box.offsetWidth;
      const room = document.documentElement.clientWidth - 8;
      let dx = 0;
      if (right > room) dx = room - right;
      if (left + dx < 8) dx = 8 - left;
      if (dx) box.style.marginLeft = `${Math.round(dx)}px`;
    }
    const below = bottom - a.bottom;
    const above = a.top - top;
    setSide(prefer === "bottom" ? (below < h + 12 && above > below ? "top" : "bottom") : above < h + 12 && below > above ? "bottom" : "top");
  }, [open]);
  return side;
}

export type RovingOptions = {
  count: number;
  /** Rows that cannot take the highlight (separators, labels, disabled). */
  skip?: (index: number) => boolean;
  /** Text per row for type-ahead. */
  text?: (index: number) => string;
  onPick: (index: number) => void;
  onEscape?: () => void;
  onTab?: () => void;
  /** Left and right arrows, for a second axis like effort or a submenu. */
  onSide?: (dir: -1 | 1) => void;
  initial?: number;
  loop?: boolean;
};

/** Arrow keys, Home, End, type-ahead and Enter over a list, plus the highlight's position. */
export function useRoving({ count, skip, text, onPick, onEscape, onTab, onSide, initial = -1, loop = true }: RovingOptions) {
  // A callback ref, so a list that mounts later (a panel opening) still gets its highlight.
  const listEl = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState<HTMLDivElement | null>(null);
  const listRef = useCallback((el: HTMLDivElement | null) => {
    listEl.current = el;
    setMounted(el);
  }, []);
  const first = useCallback(() => {
    for (let i = 0; i < count; i++) if (!skip?.(i)) return i;
    return -1;
  }, [count, skip]);
  const [active, setActive] = useState(() => (initial >= 0 && !skip?.(initial) ? initial : first()));
  const [hl, setHl] = useState<{ y: number; h: number } | null>(null);
  const typed = useRef({ text: "", at: 0 });

  useLayoutEffect(() => {
    const row = listEl.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (row) {
      setHl({ y: row.offsetTop, h: row.offsetHeight });
      row.scrollIntoView?.({ block: "nearest" });
    } else setHl(null);
  }, [active, count, mounted]);

  const step = (from: number, dir: 1 | -1) => {
    for (let n = 1; n <= count; n++) {
      let i = from + dir * n;
      if (loop) i = (i + count) % count;
      else if (i < 0 || i >= count) return from;
      if (!skip?.(i)) return i;
    }
    return from;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => step(a < 0 ? (e.key === "ArrowDown" ? -1 : count) : a, e.key === "ArrowDown" ? 1 : -1));
      feedback.play("tick");
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? step(-1, 1) : step(count, -1));
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && onSide) {
      e.preventDefault();
      onSide(e.key === "ArrowLeft" ? -1 : 1);
    } else if (e.key === "Enter" || (e.key === " " && !typed.current.text)) {
      if (active < 0) return;
      e.preventDefault();
      onPick(active);
    } else if (e.key === "Escape") {
      if (!onEscape) return;
      e.preventDefault();
      e.stopPropagation();
      onEscape();
    } else if (e.key === "Tab") {
      onTab?.();
    } else if (text && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Type-ahead: letters typed within a breath build one query.
      const now = performance.now();
      const q = (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase();
      typed.current = { text: q, at: now };
      for (let n = 0; n < count; n++) {
        const i = (Math.max(0, active) + (q.length === 1 ? n + 1 : n)) % count;
        if (!skip?.(i) && text(i).toLowerCase().startsWith(q)) {
          setActive(i);
          break;
        }
      }
    }
  };

  return { listRef, active, setActive, hl, onKeyDown };
}

/** True once the pointer has rested on a target long enough to mean it (tooltips, hover cards). */
export function useIntent(delay = 450, closeDelay = 120) {
  const [open, setOpen] = useState(false);
  const t = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(t.current), []);
  const enter = (now = false) => {
    window.clearTimeout(t.current);
    if (now) setOpen(true);
    else t.current = window.setTimeout(() => setOpen(true), delay);
  };
  const leave = () => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setOpen(false), closeDelay);
  };
  return { open, setOpen, enter, leave };
}
