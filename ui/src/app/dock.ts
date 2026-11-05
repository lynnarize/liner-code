/*
  The right dock's layout, as plain data: its panes, each a row of tabs with one on screen, and
  whether the dock shows and fills the paper. Every change is a function from one layout to the
  next, so the session, the top-right row and the guide all move it the same way, and the rules
  are tested on their own (engine/test/panels.test.ts).

  The rules are DeepSeek Harness's right sidebar (packages/client/ui-sidebar-right and its
  ui-dockkit, MIT): at most two panes; a pane is never left empty (one whose last tab goes merges
  away); a pane holds at most one New tab guide, and the guide gives way to what you open from
  it; closing the last tab hides the dock. Ours is a list rather than their split tree.
  Since 0.2.2 the panel holds one pane: nothing makes a second (split, and moveTab past the last
  pane, are kept for their tests), and readDock folds a two-pane layout 0.2.1 kept into one.
*/

/** A tab: a built-in surface, the New tab guide, one routine run, an add-on's panel (`app:<id>`), or one an agent asks to add (`preview:<item>`). */
export type DockTab = string;
export type Pane = { tabs: DockTab[]; tab: DockTab };
export type DockState = { open: boolean; full: boolean; panes: Pane[]; at: number };

export const GUIDE = "guide";
/** Two panes side by side at most. */
export const MAX_PANES = 2;

export const emptyDock = (): DockState => ({ open: false, full: false, panes: [], at: 0 });

/** Which pane holds a tab, or -1. */
export const paneOf = (d: DockState, tab: DockTab) => d.panes.findIndex((p) => p.tabs.includes(tab));
/** On screen: the dock shows and a pane has it up. */
export const onScreen = (d: DockState, tab: DockTab) => d.open && d.panes.some((p) => p.tab === tab);
/** Open in the dock, but not on screen: behind another tab, or in a hidden dock. */
export const behind = (d: DockState, tab: DockTab) => paneOf(d, tab) >= 0 && !onScreen(d, tab);

const at = (d: DockState, i: number) => Math.max(0, Math.min(i, d.panes.length - 1));
const clone = (d: DockState): DockState => ({ ...d, panes: d.panes.map((p) => ({ tabs: [...p.tabs], tab: p.tab })) });

/** Empty panes merge away; no panes is a hidden dock; the focused pane stays one that exists. */
function settle(d: DockState): DockState {
  const panes = d.panes.filter((p) => p.tabs.length).map((p) => ({ tabs: p.tabs, tab: p.tabs.includes(p.tab) ? p.tab : p.tabs[p.tabs.length - 1] }));
  if (!panes.length) return { open: false, full: false, panes: [], at: 0 };
  return { ...d, panes, at: Math.max(0, Math.min(d.at, panes.length - 1)) };
}

/** Shows the dock. One with nothing in it opens on the guide. */
export function showDock(d: DockState): DockState {
  if (d.panes.length) return { ...d, open: true };
  return { open: true, full: false, panes: [{ tabs: [GUIDE], tab: GUIDE }], at: 0 };
}
export const hideDock = (d: DockState): DockState => ({ ...d, open: false, full: false });
export const toggleDock = (d: DockState) => (d.open ? hideDock(d) : showDock(d));
export const toggleFull = (d: DockState): DockState => (d.open ? { ...d, full: !d.full } : { ...showDock(d), full: true });

/**
  Opens a tab and shows the dock. One open already comes up where it is; a new one goes in the
  pane asked for, else the focused one, in place of a guide that's up there.
*/
export function openTab(d0: DockState, tab: DockTab, pane?: number): DockState {
  const d = clone(showDock(d0));
  const where = paneOf(d, tab);
  if (where >= 0 && tab !== GUIDE) {
    d.panes[where].tab = tab;
    return { ...d, at: where };
  }
  const i = at(d, pane ?? d.at);
  const p = d.panes[i];
  if (tab === GUIDE) {
    if (!p.tabs.includes(GUIDE)) p.tabs.push(GUIDE);
    p.tab = GUIDE;
    return { ...d, at: i };
  }
  // The guide gives way to what you open while it's up.
  if (p.tab === GUIDE) p.tabs.splice(p.tabs.indexOf(GUIDE), 1, tab);
  else p.tabs.push(tab);
  p.tab = tab;
  return settle({ ...d, at: i });
}

/** A surface's button: up if it isn't on screen, and the dock away if it is. */
export const toggleTab = (d: DockState, tab: DockTab) => (onScreen(d, tab) ? hideDock(d) : openTab(d, tab));

export function pickTab(d0: DockState, i: number, tab: DockTab): DockState {
  const d = clone(d0);
  if (!d.panes[i]?.tabs.includes(tab)) return d0;
  d.panes[i].tab = tab;
  return { ...d, at: i };
}

/** Closes a tab wherever it is; the one before it comes up. The last tab hides the dock. */
export function closeTab(d0: DockState, tab: DockTab): DockState {
  const i = paneOf(d0, tab);
  if (i < 0) return d0;
  const d = clone(d0);
  const p = d.panes[i];
  const k = p.tabs.indexOf(tab);
  p.tabs.splice(k, 1);
  if (p.tab === tab) p.tab = p.tabs[Math.max(0, k - 1)] ?? "";
  return settle(d);
}

/** Closes every tab that matches, as when an add-on goes. */
export const closeWhere = (d: DockState, gone: (t: DockTab) => boolean) => d.panes.flatMap((p) => p.tabs).filter(gone).reduce(closeTab, d);

/** Every tab in the pane but this one. */
export function closeOthers(d0: DockState, tab: DockTab): DockState {
  const i = paneOf(d0, tab);
  if (i < 0) return d0;
  const d = clone(d0);
  d.panes[i] = { tabs: [tab], tab };
  return settle(d);
}

/**
  Moves a tab to another pane (before `index` there, else at its end), up there and focused. To a
  pane past the last makes a second pane, if there's room for one. A pane it leaves empty merges away.
*/
export function moveTab(d0: DockState, tab: DockTab, to: number, index?: number): DockState {
  const from = paneOf(d0, tab);
  if (from < 0 || to < 0) return d0;
  const d = clone(d0);
  if (to >= d.panes.length) {
    if (d.panes.length >= MAX_PANES || d.panes[from].tabs.length < 2) return d0;
    d.panes.push({ tabs: [], tab: "" });
    to = d.panes.length - 1;
  }
  const src = d.panes[from];
  const dst = d.panes[to];
  const k = src.tabs.indexOf(tab);
  src.tabs.splice(k, 1);
  if (src.tab === tab) src.tab = src.tabs[Math.max(0, k - 1)] ?? "";
  // A guide arriving where one is already merges into it.
  if (tab === GUIDE && from !== to && dst.tabs.includes(GUIDE)) {
    dst.tab = GUIDE;
    return settle({ ...d, at: to });
  }
  const place = index === undefined ? dst.tabs.length : Math.max(0, Math.min(index, dst.tabs.length));
  dst.tabs.splice(place, 0, tab);
  dst.tab = tab;
  return settle({ ...d, at: to });
}

/** Room for another pane: fewer than two. */
export const canSplit = (d: DockState) => d.panes.length > 0 && d.panes.length < MAX_PANES;

/** A second pane beside this one: the tab up here moves into it, or the guide opens there when it's the only tab. */
export function split(d0: DockState, i: number): DockState {
  if (!canSplit(d0)) return d0;
  const d = clone(d0);
  const p = d.panes[at(d, i)];
  if (p.tabs.length > 1 && p.tab !== GUIDE) return moveTab(d0, p.tab, d.panes.length);
  d.panes.push({ tabs: [GUIDE], tab: GUIDE });
  return { ...d, open: true, at: d.panes.length - 1 };
}

/** Swaps a preview's tab for its add-on's, in the same place, once you've added it. */
export function replaceTab(d0: DockState, from: DockTab, to: DockTab): DockState {
  const i = paneOf(d0, from);
  if (i < 0) return d0;
  if (paneOf(d0, to) >= 0) return closeTab(d0, from);
  const d = clone(d0);
  const p = d.panes[i];
  p.tabs[p.tabs.indexOf(from)] = to;
  if (p.tab === from) p.tab = to;
  return d;
}

/**
  A layout read back from storage, kept only if it still makes sense. Since 0.2.2 the panel shows
  one pane, so two side by side, as 0.2.1 kept them, come back as one: the left pane's tabs, then
  the right's, one guide at most, with the tab that was up in the pane you were in still up.
*/
export function readDock(raw: unknown): DockState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<DockState>;
  if (!Array.isArray(r.panes) || r.panes.length > MAX_PANES) return null;
  const seen = new Set<string>();
  const panes: Pane[] = [];
  for (const p of r.panes) {
    if (!p || !Array.isArray(p.tabs) || typeof p.tab !== "string") return null;
    const tabs = p.tabs.filter((t): t is string => typeof t === "string" && t.length > 0 && t.length < 200 && (t === GUIDE || !seen.has(t)));
    for (const t of tabs) if (t !== GUIDE) seen.add(t);
    if (tabs.length) panes.push({ tabs: [...new Set(tabs)], tab: tabs.includes(p.tab) ? p.tab : tabs[tabs.length - 1] });
  }
  const d = settle({ open: Boolean(r.open) && panes.length > 0, full: Boolean(r.full), panes, at: Number(r.at) || 0 });
  if (d.panes.length < 2) return d;
  return { ...d, panes: [{ tabs: [...new Set(d.panes.flatMap((p) => p.tabs))], tab: (d.panes[d.at] ?? d.panes[0]).tab }], at: 0 };
}
