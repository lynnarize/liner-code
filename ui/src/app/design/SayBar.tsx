/*
  The say bar: under what's picked on the canvas, the two things to do with it in words. "Say what
  should change" puts the caret in the dock, with the pick already a chip there; "3 more like this"
  asks for three other ways of it (Ways, builder G: it listens for "ld:more-like-this", whose
  detail is the selection, and the button says nothing more until something listens).

  It stands centred under the pick, kept inside what of the canvas can be seen: clear of the rail on
  the left, the canvas's right edge, and the dock at the foot (above the pick when there's no room
  under it).
*/
import { useLayoutEffect, useRef, useState } from "react";
import { I } from "../icons";
import { getDesign, selectionOf } from "./store";

/** Who answers "3 more like this": set by Ways when it's built; until then the button sends the event only. */
export const sayBar: { more?: (sel: ReturnType<typeof selectionOf>) => void; /** Ways: a take is picked, and its keep bar stands here instead. */ hidden?: () => boolean } = {};

const GAP = 8;

/**
  Keeps a bar floating on the canvas inside what of it can be seen: clear of the rail on the left,
  inside the right edge, above the dock at the foot, and above its pick (`above`) when there's no
  room under it. `x` is the bar's centre, or its left edge with `from: "start"`. The bar's parent
  is a box the size of the canvas (the canvas itself, or its layer over the frames). Shared by the
  say bar and Ways' keep bar.
*/
export function useInCanvas(x: number, y: number, above?: number, from: "centre" | "start" = "centre") {
  const el = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const bar = el.current;
    // What it's placed against: the canvas, or its layer over the frames (both its size).
    const box = bar?.offsetParent as HTMLElement | null | undefined;
    const cv = bar?.closest(".ld-cv");
    if (!bar || !box || !cv) return;
    const place = () => {
      const c = box.getBoundingClientRect();
      const w = bar.offsetWidth;
      const h = bar.offsetHeight;
      const rail = cv.querySelector(".ld-rail")?.getBoundingClientRect();
      // The dock as it is now: its head row (what the agent draws, the checks, a take) comes and goes, and moves its top.
      const dock = cv.querySelector(".ld-dock-in")?.getBoundingClientRect() ?? cv.querySelector(".ld-dock")?.getBoundingClientRect();
      const minX = Math.max(GAP, rail ? rail.right - c.left + GAP : GAP);
      const maxX = Math.max(minX, c.width - w - GAP);
      const floor = (dock && dock.height ? dock.top - c.top : c.height) - GAP;
      let top = y;
      if (top + h > floor) top = above !== undefined && above - h >= GAP && above <= floor ? above - h : floor - h;
      const next = { left: Math.min(maxX, Math.max(minX, from === "centre" ? x - w / 2 : x)), top: Math.max(GAP, top) };
      setAt((was) => (was && was.left === next.left && was.top === next.top ? was : next));
    };
    place();
    // Again whenever the dock, the bar or the canvas changes size: measured once, the dock's top
    // could be read before its head row came, and the bar would sit half under it.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    const dockEl = cv.querySelector(".ld-dock-in") ?? cv.querySelector(".ld-dock");
    for (const e of [bar, box, dockEl]) if (e) ro?.observe(e);
    return () => ro?.disconnect();
  }, [x, y, above, from]);
  const style = { left: at?.left ?? x, top: at?.top ?? y, translate: at ? "none" : undefined, visibility: at ? undefined : ("hidden" as const) };
  return { ref: el, style };
}

export function SayBar({ x, y, above }: { x: number; y: number; above?: number }) {
  const { ref: el, style } = useInCanvas(x, y, above);
  const say = () => document.querySelector<HTMLTextAreaElement>(".ld-dock textarea")?.focus();
  const more = () => {
    const sel = selectionOf(getDesign());
    if (sayBar.more) sayBar.more(sel);
    else window.dispatchEvent(new CustomEvent("ld:more-like-this", { detail: sel }));
  };
  if (sayBar.hidden?.()) return null;
  return (
    <div ref={el} className="ld-say" data-ld-ui style={style} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="ld-say-b l-focus" onClick={say}>
        <I.sparkle size={14} />
        Say what should change
      </button>
      <span className="ld-say-v" aria-hidden />
      <button type="button" className="ld-say-b l-focus" data-strong onClick={more}>
        <I.copy size={14} />3 more like this
      </button>
    </div>
  );
}
