/*
  Where a menu opens, worked out apart from the page so it can be tested: Pop and ContextMenu (ui.tsx) measure, then ask here.
*/

/** The window's top row (44px): on the Mac its left end holds the red, yellow and green buttons, so nothing that opens is placed over it. */
export const TOP_ROW = 44;
/** How far a menu keeps from the window's other edges. */
export const EDGE = 10;
/** The room between a button and the menu it hangs. */
export const GAP = 4;

export type Box = { left: number; top: number; right: number; bottom: number };
export type MenuPlace = { top: number; left: number; side: "top" | "bottom"; max?: number };

/**
  A menu `w` wide and `h` tall in a window `vw` by `vh`. From a button (`under`, a row's ···) it hangs
  under the button with their right edges on one line; where that would run past the window's left
  edge it starts on the row's left edge (`row`) instead. From the pointer (a right-click at `at`) it
  starts there; from the keyboard (`at` under a row, with `row` and no `under`) it flips above the row,
  not over it. It opens below while it fits, else above (its foot at the button's or the row's top, or
  at the pointer); fitting neither, it takes the side with more room and scrolls inside. It never goes
  above the window's top row, nor past its other edges: a right-click inside the top row (a panel's
  tab) opens just under it.
*/
export function placeMenu(o: { at: { x: number; y: number }; under?: Box; row?: Box; w: number; h: number; vw: number; vh: number }): MenuPlace {
  const { at, under, row, w, h, vw, vh } = o;
  const hi = Math.max(EDGE, vw - w - EDGE);
  let left = under ? under.right - w : at.x;
  if (under && left < EDGE) left = row ? row.left : under.left;
  left = Math.min(Math.max(EDGE, left), hi);
  const below = Math.max(TOP_ROW, under ? under.bottom + GAP : at.y);
  const foot = under ? under.top - GAP : row ? row.top - GAP : at.y;
  const roomBelow = vh - EDGE - below;
  const roomAbove = foot - TOP_ROW;
  if (h <= roomBelow) return { top: Math.round(below), left: Math.round(left), side: "bottom" };
  if (h <= roomAbove) return { top: Math.round(foot - h), left: Math.round(left), side: "top" };
  if (roomBelow >= roomAbove) return { top: Math.round(below), left: Math.round(left), side: "bottom", max: Math.max(0, Math.floor(roomBelow)) };
  return { top: TOP_ROW, left: Math.round(left), side: "top", max: Math.max(0, Math.floor(roomAbove)) };
}

/**
  Which side of its trigger a panel `h` tall opens on, given the room `below` and `above` it (above stops at the top row),
  and how tall it may be there (`max`, none when it all fits). It takes `prefer` when it fits, else the other side when it
  fits there, else the side with more room, never taller than that room. One that `keep`s its side stays on `prefer` while
  that has fair room (`keepMin`), fitting itself to it. A `whole` panel (the model picker, whose cards have a height of
  their own) opens on `prefer` when it all fits there, else on the other side when it all fits there; and whatever `prefer` says it
  goes under its trigger first: whole when it fits, fitted to the room while that is at least WHOLE_MIN, and only then above
  (the owner's choice, after another app's picker). Either way it gets exactly the room there, so its cards can be drawn no
  taller (Pop sets that room as --lc-pop-room) and nothing lies outside the window.
*/
/** The least room under its chip the model picker still opens into: its pinned rows and three or so models. */
export const WHOLE_MIN = 220;
export function panelSide(o: { h: number; below: number; above: number; prefer: "top" | "bottom"; keep?: boolean; keepMin?: number; whole?: boolean }): { side: "top" | "bottom"; max?: number } {
  const { h, below, above, prefer } = o;
  const room = (s: "top" | "bottom") => (s === "bottom" ? below : above);
  const flip = prefer === "bottom" ? "top" : "bottom";
  // The model picker goes under its chip whenever there is fair room there, fitted to it, as the owner asked: only with
  // less than that does it go above, or to whichever side has more when neither has much.
  if (o.whole) {
    if (h <= below) return { side: "bottom" };
    if (below >= WHOLE_MIN) return { side: "bottom", max: Math.floor(below) };
    if (h <= above) return { side: "top" };
    return below >= above ? { side: "bottom", max: Math.max(0, Math.floor(below)) } : { side: "top", max: Math.max(0, Math.floor(above)) };
  }
  const fair = Boolean(o.keep) && room(prefer) >= Math.min(h, o.keepMin ?? 260);
  const side = h <= room(prefer) || (!o.whole && fair) ? prefer : h <= room(flip) ? flip : fair && !o.whole ? prefer : below >= above ? "bottom" : "top";
  if (h <= room(side)) return { side };
  return { side, max: o.whole ? Math.max(0, Math.floor(room(side))) : Math.max(120, Math.floor(room(side))) };
}

/**
  Where a panel `w` wide hung under or over its trigger `r` starts sideways: its right edge on the trigger's (`end`), its
  left on the trigger's (`start`) or centred on it, kept between `lo` and `hi` (the window's edges, or what it is kept within).
  Hung above or below, it never covers the trigger it opens from, whatever this gives. `out` is how far it hangs out past the
  edge it is aligned on: the model picker's side card past its chip's right edge, so that the list is the part over the chip.
*/
export function panelLeft(align: "start" | "end" | "center", r: { left: number; right: number; width: number }, w: number, lo: number, hi: number, out = 0): number {
  const left = align === "end" ? r.right + out - w : align === "center" ? r.left + r.width / 2 - w / 2 : r.left - out;
  return Math.max(lo, Math.min(left, hi - w));
}

/**
  Where a side menu `w` wide starts, beside the menu `m` it opened from in a window `vw` wide: to the menu's right
  while it fits there, as menus open in the direction a person reads; to its left when the right has no room (the
  switcher's ··· and the pinned Session card sit at the window's right edge); with room on neither side, inside the window's
  right edge. `leftward`: the menu it opens from is itself a side menu that went left (+'s More, at the panel's right), so
  this one keeps going left while it fits, away from the menus before it rather than back over them.
*/
export function sideMenuLeft(m: { left: number; right: number }, w: number, vw: number, leftward = false): number {
  if (leftward && m.left - GAP - w >= EDGE) return m.left - GAP - w;
  if (m.right + GAP + w <= vw - EDGE) return m.right + GAP;
  if (m.left - GAP - w >= EDGE) return m.left - GAP - w;
  return Math.max(EDGE, vw - EDGE - w);
}
