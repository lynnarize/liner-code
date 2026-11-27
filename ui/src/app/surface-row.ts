/*
  The panel's + menu's rows and apps, as plain data so it is tested on its own (engine/test/panels.test.ts,
  engine/test/lean-menus.test.ts); Switcher.tsx draws it. The session header's row of surface icons, which this file once
  described, went with line and dot (2026-11-27): the panel's head row names its surfaces as tabs, and + lists them.
*/
import type { Item, Project, Thread } from "../../../contracts/src/index.ts";
import type { DockState } from "./dock.ts";

/** The surfaces + knows, in the board's order (Menus, "Open a surface"); the Terminal is in its shells' part, Linked pull requests inside Pull request. */
export const MENU_ORDER = ["session", "changes", "files", "browser", "agents", "pr", "design", "side", "device", "routines"];
/** The four surfaces + always lists first: every session has something in each. */
export const ALWAYS = ["session", "changes", "files", "browser"];

/** What the session has now, for which surfaces + lists before More (SurfaceMenu reads each from what the app holds). */
export type SurfaceNow = {
  /** It works with agents now or did (agent-rows.ts hasAgents). */
  agents: boolean;
  /** It has a pull request, or its project has the GitHub remote one needs (canPr). */
  pr: boolean;
  /** It has a Liner Design canvas, or drew or showed a design (hasCanvas). */
  canvas: boolean;
  /** A simulator is running for the Device surface to show. */
  device: boolean;
  /** The surfaces open as tabs in the panel now. */
  open: readonly string[];
};

/**
  Capy's lean "open a tab" menu (the owner, 2026-11-27): + lists the four surfaces every session has, then only those that
  hold something now (Agents with agents, Pull request with one or a remote to open one on, Design with a canvas, Device with
  a simulator up), and any surface open as a tab, ticked, so it can be put away from here. The rest go under More (`more`),
  each with its key, so nothing + reached before is more than two presses away. Side chat has a row of its own under the
  list (New side chat), so it is listed only while it is open. `ids` are the surfaces there are (Routines only while on).
*/
export function surfaceRows(ids: readonly string[], now: SurfaceNow): { top: string[]; more: string[] } {
  const want: Record<string, boolean> = { agents: now.agents, pr: now.pr, design: now.canvas, device: now.device };
  const known = MENU_ORDER.filter((id) => ids.includes(id));
  const top = known.filter((id) => ALWAYS.includes(id) || now.open.includes(id) || want[id] === true);
  const more = known.filter((id) => !top.includes(id) && id !== "side");
  return { top, more };
}

/**
  Whether the Pull request surface has something to show without asking GitHub: the session's pull request, or a project with
  a GitHub remote, where its branch can have one (the surface says "This project has no GitHub remote" otherwise, Pr.tsx GhNote).
*/
export const canPr = (thread: Pick<Thread, "pr">, project: Pick<Project, "git" | "remote"> | undefined) => Boolean(thread.pr) || Boolean(project?.git && project.remote);

/** A design tool's call, by any of the names the tools give Liner's MCP tools (DesignMini.tsx reads which design it named). */
export const DESIGN_TOOL = /^(?:mcp__liner__|liner\.|liner_)?design_(frame|node|picture|built)\b/;
/** What says a session has a canvas for the Design surface: a design it showed, a design tool it called, a design file it wrote. */
export const isCanvasItem = (it: Item) =>
  it.kind === "design" || (it.kind === "tool" && (DESIGN_TOOL.test(it.tool) || ((it.toolKind === "edit" || it.toolKind === "write") && /(^|\/)\.liner\/designs\/[^/]+\//.test(it.path ?? ""))));
/** The Design surface shows something: the session was begun from a design, or one of its items is a canvas's (isCanvasItem). */
export const hasCanvas = (thread: Pick<Thread, "design">, canvasItems: readonly Item[]) => Boolean(thread.design?.file) || canvasItems.length > 0;

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
