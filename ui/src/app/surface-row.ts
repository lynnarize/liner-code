/*
  What the session header's icon row says (SPEC rule 1, board Main, 2026-11-25), as plain data so it is
  tested on its own (engine/test/panels.test.ts). Switcher.tsx draws it.

  The row ends the session header, after the Reviewer: Session, Terminal, Changes, Browser, Files, then
  ···. The icon of the surface showing is lit and pressing it hides the panel (dock.ts toggleTab); the
  Terminal's is lit while the bottom panel is up; Session's while its popup is open. ··· is a menu of the
  rest: Pull request, Design, Side chat, Device, then Your apps to the side. While the surface showing is
  one that has no icon of its own (one of those, an app, Agents, Linked pull requests, a preview), ··· is
  lit, and that surface's row in its menu carries a tick.
*/
import type { DockState } from "./dock.ts";

/** The icons, in their order; Session and the Terminal open a popup and the bottom panel, the rest a surface in the panel. */
export const ICONS = ["session", "terminal", "changes", "browser", "files"] as const;
export type IconId = (typeof ICONS)[number];
/** The surfaces ··· lists before Your apps. */
export const MORE = ["pr", "design", "side", "device"] as const;

/** The surface the panel is showing, or none while it is hidden. */
export const shownOf = (d: DockState): string | undefined => (d.open ? d.panes[d.at]?.tab : undefined);

/** Whether an icon is lit: the surface it stands for is showing; the Terminal's while the bottom panel is up; Session's while its popup is open. */
export function iconLit(id: IconId, d: DockState, below: boolean, sessionOpen: boolean) {
  if (id === "terminal") return below;
  if (id === "session") return sessionOpen;
  return shownOf(d) === id;
}

/** Whether ··· is lit: the panel shows a surface that has no icon of its own. */
export function moreLit(d: DockState) {
  const t = shownOf(d);
  return t !== undefined && !(ICONS as readonly string[]).includes(t);
}

/**
  ···'s rows: the four surfaces, each ticked when it is the one showing, then your apps for this project
  (the ones you pinned first, the rest as they come), each ticked the same way. `apps` are the project's
  apps as Addon.tsx appsFor lists them.
*/
export function moreRows(d: DockState, apps: { id: string; name: string }[], pins: readonly string[]) {
  const t = shownOf(d);
  return {
    surfaces: MORE.map((id) => ({ id, on: t === id })),
    apps: [...apps].sort((a, b) => Number(pins.includes(b.id)) - Number(pins.includes(a.id))).map((a) => ({ id: a.id, name: a.name, tab: `app:${a.id}`, on: t === `app:${a.id}` })),
    // An app showing puts its tick on Your apps' own row too, so the tick is in sight before the side menu opens.
    appOn: t?.startsWith("app:") ?? false,
  };
}
