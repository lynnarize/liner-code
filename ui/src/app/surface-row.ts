/*
  The panel's + menu's apps, as plain data so it is tested on its own (engine/test/panels.test.ts); Switcher.tsx
  draws it. The session header's row of surface icons, which this file once described, went with line and dot
  (2026-11-27): the panel's head row names its surfaces as tabs, and + lists them all.
*/
import type { DockState } from "./dock.ts";

/** The surface the panel is showing, or none while it is hidden. */
export const shownOf = (d: DockState): string | undefined => (d.open ? d.panes[d.at]?.tab : undefined);

/**
  The rows of +'s Your apps: your apps for this project (the ones you pinned first, the rest as they come), each ticked
  when it is the one showing. `apps` are the project's apps as Addon.tsx appsFor lists them.
*/
export function moreRows(d: DockState, apps: { id: string; name: string }[], pins: readonly string[]) {
  const t = shownOf(d);
  return {
    apps: [...apps].sort((a, b) => Number(pins.includes(b.id)) - Number(pins.includes(a.id))).map((a) => ({ id: a.id, name: a.name, tab: `app:${a.id}`, on: t === `app:${a.id}` })),
    // An app showing puts its tick on Your apps' own row too, so the tick is in sight before the side menu opens.
    appOn: t?.startsWith("app:") ?? false,
  };
}

/** A tab with its name dropped: its icon in its 9px padding either side. */
export const ICON_TAB = 32;
/** The gap between tabs (dock.css .lc-ptabs-list). */
const TAB_GAP = 2;

/**
  Which tabs show their icon alone, so the row fits `room` before it scrolls at all: from the far end inwards, never
  the open one, until what is left fits. `full` is each tab's width with its name (measured while it showed it).
*/
export function shortTabs(tabs: readonly string[], open: string | undefined, full: Readonly<Record<string, number>>, room: number): Set<string> {
  const short = new Set<string>();
  let total = tabs.reduce((n, t) => n + (full[t] ?? ICON_TAB), 0) + TAB_GAP * Math.max(0, tabs.length - 1);
  for (let i = tabs.length - 1; i >= 0 && total > room; i--) {
    const t = tabs[i];
    if (t === open || full[t] === undefined) continue;
    short.add(t);
    total -= Math.max(0, full[t] - ICON_TAB);
  }
  return short;
}

/**
  Where the row of tabs scrolls to so a tab (at `left`, `width` wide, in the row's own coordinates) is all in view:
  where it is if it already is, else just far enough that it shows whole at the nearer edge.
*/
export function scrollToShow(left: number, width: number, scrollLeft: number, clientWidth: number) {
  if (left < scrollLeft) return Math.max(0, left);
  if (left + width > scrollLeft + clientWidth) return left + width - clientWidth;
  return scrollLeft;
}

/** Which end of a scrolled row has more of it out of sight, for its fade: neither, the start, the end, or both. */
export function fadeOf(scrollLeft: number, scrollWidth: number, clientWidth: number): "start" | "end" | "both" | undefined {
  const start = scrollLeft > 1;
  const end = scrollLeft + clientWidth < scrollWidth - 1;
  return start && end ? "both" : start ? "start" : end ? "end" : undefined;
}
