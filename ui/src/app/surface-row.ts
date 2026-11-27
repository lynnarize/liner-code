/*
  The panel's + menu's rows and apps, as plain data so it is tested on its own (engine/test/panels.test.ts,
  engine/test/lean-menus.test.ts); Switcher.tsx draws it. The session header's row of surface icons, which this file once
  described, went with line and dot (2026-11-27): the panel's head row names its surfaces as tabs, and + lists them.
*/
import type { Item, Project, Thread } from "../../../contracts/src/index.ts";
import { isSwarm } from "../../../contracts/src/swarm.ts";
import type { DockState } from "./dock.ts";

/**
  The surfaces + knows, in the board's order (Menus, "Open a surface"); the Terminal is in its shells' part, Linked pull
  requests inside Pull request. Session is not one since 2026-11-27: the details card holds all it showed.
*/
export const MENU_ORDER = ["changes", "files", "browser", "agents", "pr", "design", "side", "device", "routines"];
/** The three surfaces + always lists first: every session has something in each. */
export const ALWAYS = ["changes", "files", "browser"];

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
  Capy's lean "open a tab" menu (the owner, 2026-11-27): + lists the three surfaces every session has, then only those that
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

/**
  What a press of a row does, in + and on the panel's start page alike: Switcher.tsx runPick carries it out, so the two
  never open a surface two ways. A surface comes up as a tab (or goes away when it is the one showing); New side chat opens
  the side chat; New terminal starts a shell in the bottom panel; New add-on asks the agent for one in the composer.
*/
export type RowPick = { kind: "surface"; tab: string } | { kind: "side" } | { kind: "terminal" } | { kind: "make" };
export const pickOf = (id: string): RowPick => (id === "side" ? { kind: "side" } : id === "terminal" ? { kind: "terminal" } : id === "make" ? { kind: "make" } : { kind: "surface", tab: id });

/** The start page's first group, in the board's order (Start.dc.html): what every session has. Session went into the details card (2026-11-27). */
export const START_HERE = ["changes", "files", "browser", "side", "terminal"] as const;
const START_TITLE: Record<(typeof START_HERE)[number], string> = { changes: "Changes", files: "Files", browser: "Browser", side: "New side chat", terminal: "New terminal" };
/** The surfaces "In this session" can list: the ones + lists only while the session has them (surfaceRows). */
export const SESSION_ONLY = ["agents", "pr", "design", "device"];

/** A row's right end: a live fact the app already holds, else the row's key. */
export type StartEnd =
  | { kind: "key"; keys: string }
  | { kind: "changes"; files: number; added: number; removed: number }
  | { kind: "server"; port: number }
  | { kind: "agents"; n: number; working: boolean }
  | { kind: "pr"; word: string; tone: "ok" | "bad" | "merged" | "dim" };
/**
  One row of the start page. `note` is the grey word after the name (the agents' mode, the pull request's number, an app's
  line); `fusion` draws the Fusion mark in place of the icon; `app` is an add-on app's id, icon and tile letters; `name` is
  what a screen reader says for the whole row, its one button.
*/
export type StartRow = { id: string; title: string; note?: string; end?: StartEnd; pick: RowPick; name: string; fusion?: boolean; quiet?: boolean; app?: { id: string; icon?: string; tile: string; hue: number } };

/** What the start page reads, all of it already in the app: the details card's and +'s sources, nothing asked for it alone. */
export type StartInput = {
  /** The surfaces there are (Surfaces.tsx SURFACES), and the session's names for them. */
  ids: readonly string[];
  labelOf: (id: string) => string;
  /** What + reads to list a surface (surfaceRows). */
  now: Omit<SurfaceNow, "open">;
  /** What is changed and not committed, as the commit tab and the details card's Changes row say it. */
  changes: { files: number; added: number; removed: number };
  /** What listens, as ports.list answers (the details card keeps owner "session"). */
  servers: readonly { port: number; owner: "session" | "project" | null }[];
  thread: Partial<Pick<Thread, "sidekick" | "swarm" | "sideOf" | "agentsAtWork" | "pr">>;
  /** Agents the session's tool sent (session-pop.ts agentsWorked's count). */
  worked: number;
  /** The person's apps for this project, in +'s order (moreRows). */
  apps: readonly { id: string; name: string; line?: string; icon?: string }[];
  /** A surface's key in words ("⇧⌘F"), when it has one. */
  keyOf: (id: string) => string | undefined;
};

/** A pull request's state as its row's end says it, in the board's words, with its colour. */
export function prEnd(pr: NonNullable<Thread["pr"]>): Extract<StartEnd, { kind: "pr" }> {
  const s = pr.state.toUpperCase();
  if (s === "MERGED") return { kind: "pr", word: "Merged", tone: "merged" };
  if (s === "CLOSED") return { kind: "pr", word: "Closed", tone: "dim" };
  const c = pr.checks?.state;
  if (c === "passed") return { kind: "pr", word: "Checks pass", tone: "ok" };
  if (c === "failed") return { kind: "pr", word: "Checks fail", tone: "bad" };
  if (c === "running") return { kind: "pr", word: "Checks running", tone: "dim" };
  return { kind: "pr", word: "Open", tone: "dim" };
}

/** An app with no icon of its own gets a tile: its name's first letter and the next word's (or its second letter). */
export function tileOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const a = words[0]?.[0] ?? "?";
  const b = words[1]?.[0] ?? words[0]?.[1] ?? "";
  return a.toUpperCase() + b.toLowerCase();
}
/** The tile's hue, the same for an app every time. */
const hueOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/** A row's end in words, for its accessible name. */
function endWords(e: StartEnd | undefined): string {
  if (!e || e.kind === "key") return "";
  if (e.kind === "changes") return `, ${e.files} ${e.files === 1 ? "file" : "files"}${e.added || e.removed ? `, ${e.added} lines added, ${e.removed} removed` : ""}`;
  if (e.kind === "server") return `, localhost:${e.port} listens`;
  if (e.kind === "agents") return `, ${e.n} ${e.working ? "working" : "worked"}`;
  return `, ${e.word}`;
}

/**
  The panel's start page, shown while the panel is open with nothing in it (the owner approved the board, 2026-11-27, after
  Kimi's empty right panel). Three groups: Start here, the five rows every session has, each ending in a live fact when the
  app already holds one (changed files and lines; a server this session started) or else its key; In this session, only the
  surfaces + lists for what the session has now (none, and the group is left out); Your apps, the person's add-on apps and
  always New add-on last. Each row's press is the same RowPick its row in + makes.
*/
export function startPage(x: StartInput): { here: StartRow[]; session: StartRow[]; apps: StartRow[] } {
  const key = (id: string): StartEnd | undefined => {
    const k = x.keyOf(id);
    return k ? { kind: "key", keys: k } : undefined;
  };
  const own = x.servers.find((s) => s.owner === "session");
  const here = START_HERE.filter((id) => id === "side" || id === "terminal" || x.ids.includes(id)).map((id): StartRow => {
    const end: StartEnd | undefined =
      id === "changes" && x.changes.files > 0 ? { kind: "changes", ...x.changes } : id === "browser" && own ? { kind: "server", port: own.port } : key(id);
    return { id, title: START_TITLE[id], end, pick: pickOf(id), name: START_TITLE[id] + endWords(end) };
  });
  const { top } = surfaceRows(x.ids, { ...x.now, open: [] });
  const t = x.thread;
  const swarm = isSwarm(t);
  const session = top.filter((id) => SESSION_ONLY.includes(id)).map((id): StartRow => {
    const title = x.labelOf(id);
    if (id === "agents") {
      const note = swarm ? (t.swarm?.mode === "swarm" ? "Swarm" : "Teamwork") : t.sidekick ? "Fusion" : "Subagents";
      const at = t.agentsAtWork ?? 0;
      const end: StartEnd | undefined = at > 0 ? { kind: "agents", n: at, working: true } : x.worked > 0 ? { kind: "agents", n: x.worked, working: false } : undefined;
      return { id, title, note, end, pick: pickOf(id), name: `${title}, ${note}${endWords(end)}`, fusion: Boolean(t.sidekick) && !swarm };
    }
    if (id === "pr" && t.pr) {
      const end = prEnd(t.pr);
      return { id, title, note: `#${t.pr.number}`, end, pick: pickOf(id), name: `${title} #${t.pr.number}${endWords(end)}` };
    }
    return { id, title, pick: pickOf(id), name: title };
  });
  const apps: StartRow[] = x.apps.map((a) => ({ id: `app:${a.id}`, title: a.name, note: a.line, pick: pickOf(`app:${a.id}`), name: a.line ? `${a.name}, ${a.line}` : a.name, app: { id: a.id, icon: a.icon, tile: tileOf(a.name), hue: hueOf(a.id) } }));
  apps.push({ id: "make", title: "New add-on", pick: pickOf("make"), name: "New add-on", quiet: true });
  return { here, session, apps };
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
