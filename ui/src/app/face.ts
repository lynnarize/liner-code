/*
  The little of Liner Design that Liner Code itself needs, so nothing else of it loads for someone
  who never opens it: which face the window shows (Code or Design, kept per window), and whether
  the turn running now is drawing on a design file (for "Watch on the canvas" in the composer).
  Everything else, the canvas and its store included, loads with the Design face (design/).
*/
import { useSyncExternalStore } from "react";
import type { Item } from "@contracts";
import "./face.css";

export type Face = "code" | "design";
const KEY = "liner.face";
/** Whether this window already had a face (a reload) rather than starting fresh: Settings' "Liner opens in" applies only to a fresh start. */
let kept = false;
let face: Face = (() => {
  try {
    const was = sessionStorage.getItem(KEY);
    kept = was !== null;
    return was === "design" ? "design" : "code";
  } catch {
    return "code";
  }
})();
export const faceKept = () => kept;
const listeners = new Set<() => void>();

export const getFace = () => face;
export function setFace(next: Face) {
  try {
    sessionStorage.setItem(KEY, next);
  } catch {
    // a window without storage keeps the face until it closes
  }
  if (face === next) return;
  face = next;
  for (const l of listeners) l();
}
export const toggleFace = () => setFace(face === "design" ? "code" : "design");
export const subscribeFace = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const useFace = () => useSyncExternalStore(subscribeFace, getFace);

/*
  The Design face's tabs: Home, then one per open design (a design file of a project, a design on
  its own included), and which one shows. Kept here, beside the face, so App can say which design
  a session belongs to without loading Liner Design. Remembered for the window across restarts
  (the app has one window, so its own place in localStorage). A tab holds no state of the design
  itself: closing one deletes nothing and stops nothing; a tab whose design went away (deleted,
  moved into a project elsewhere) is let go quietly by whoever finds it gone.
*/
/** `fresh`: the design file as New design made it (session.ts sigOf), for a design opened untouched; kept until it's found touched. */
export type DesignTab = { projectId: string; file: string; title?: string; threadId?: string; fresh?: string };
export type Tabs = { list: DesignTab[]; at: string };
export const HOME_TAB = "home";
export const tabKey = (t: { projectId: string; file: string }) => `${t.projectId}/${t.file}`;
const TABS_KEY = "liner.design-tabs";
let tabs: Tabs = (() => {
  try {
    const t = JSON.parse(localStorage.getItem(TABS_KEY) || "") as Tabs;
    const list = Array.isArray(t.list) ? t.list.filter((x) => x && typeof x.projectId === "string" && typeof x.file === "string") : [];
    return { list, at: list.some((x) => tabKey(x) === t.at) ? t.at : HOME_TAB };
  } catch {
    return { list: [], at: HOME_TAB };
  }
})();
const tabFns = new Set<() => void>();
/** The design tab shown last (Home in between doesn't count), for opening another design in its place. */
let lastDesign: string | undefined = tabs.at !== HOME_TAB ? tabs.at : undefined;
function putTabs(next: Tabs) {
  tabs = next;
  if (next.at !== HOME_TAB) lastDesign = next.at;
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(next));
  } catch {
    // a window without storage keeps its tabs until it closes
  }
  for (const l of tabFns) l();
}
/*
  Another page on the same storage (a second window, if the app ever has two) wrote its tabs: what
  it changed (tabs it opened, tabs it closed) is merged into this page's, never written over them;
  which tab shows stays this page's own.
*/
const listOf = (v: string | null): DesignTab[] => {
  try {
    const l = (JSON.parse(v ?? "") as Tabs).list;
    return Array.isArray(l) ? l.filter((t) => t && typeof t.projectId === "string" && typeof t.file === "string") : [];
  } catch {
    return [];
  }
};
if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key !== TABS_KEY || e.newValue === null) return;
    const was = new Set(listOf(e.oldValue).map(tabKey));
    const now = listOf(e.newValue);
    const nowKeys = new Set(now.map(tabKey));
    const mine = new Set(tabs.list.map(tabKey));
    const opened = now.filter((t) => !was.has(tabKey(t)) && !mine.has(tabKey(t)));
    const closed = new Set([...was].filter((k) => !nowKeys.has(k) && k !== tabs.at));
    if (!opened.length && ![...closed].some((k) => mine.has(k))) return;
    putTabs({ list: [...tabs.list.filter((t) => !closed.has(tabKey(t))), ...opened], at: tabs.at });
  });
export const getTabs = () => tabs;
export const subscribeTabs = (fn: () => void) => {
  tabFns.add(fn);
  return () => void tabFns.delete(fn);
};
export const useTabs = () => useSyncExternalStore(subscribeTabs, getTabs);
/** The design tab shown last, still open: the one showing, or the one shown before Home. */
export const lastDesignTab = () => tabs.list.find((t) => tabKey(t) === (tabs.at !== HOME_TAB ? tabs.at : lastDesign));
/** The design tab showing, if one is (not Home). */
export const currentTab = () => tabs.list.find((t) => tabKey(t) === tabs.at);
/** Opens a design in its tab (the one it has, else a new one at the end) and shows it unless `show` is false. */
export function openTab(t: DesignTab, show = true) {
  const k = tabKey(t);
  const had = tabs.list.find((x) => tabKey(x) === k);
  const merged = { ...had, ...Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined)) } as DesignTab;
  const list = had ? tabs.list.map((x) => (tabKey(x) === k ? merged : x)) : [...tabs.list, merged];
  putTabs({ list, at: show ? k : tabs.at });
}
export const showTab = (key: string) => key !== tabs.at && putTabs({ ...tabs, at: key === HOME_TAB || tabs.list.some((x) => tabKey(x) === key) ? key : HOME_TAB });
/** Closes a tab: nothing is deleted or stopped. The one showing hands over to its right-hand neighbour, else its left, else Home. */
export function closeTab(key: string) {
  const i = tabs.list.findIndex((x) => tabKey(x) === key);
  if (i < 0) return;
  const list = tabs.list.filter((_, j) => j !== i);
  const next = tabs.at !== key ? tabs.at : list[i] ? tabKey(list[i]) : list[i - 1] ? tabKey(list[i - 1]) : HOME_TAB;
  putTabs({ list, at: next });
}
/** A tab's title or session, as they become known. */
export function patchTab(key: string, patch: Partial<Pick<DesignTab, "title" | "threadId" | "fresh">>) {
  const had = tabs.list.find((x) => tabKey(x) === key);
  if (!had || Object.entries(patch).every(([k, v]) => had[k as keyof DesignTab] === v)) return;
  putTabs({ ...tabs, list: tabs.list.map((x) => (x === had ? { ...x, ...patch } : x)) });
}
/** A design that moved (Build in a project): its tab stays where it was, now naming where it is. */
export function moveTab(key: string, to: DesignTab) {
  const had = tabs.list.find((x) => tabKey(x) === key);
  if (!had) return;
  const k = tabKey(to);
  const list = tabs.list.filter((x) => x === had || tabKey(x) !== k).map((x) => (x === had ? { ...had, ...to } : x));
  putTabs({ list, at: tabs.at === key ? k : tabs.at });
}

type Tool = Extract<Item, { kind: "tool" }>;
/** A tool call that draws on a design file: Liner's design tools by any tool's name for them. */
export const CANVAS_TOOL = /^(?:mcp__liner__|liner\.|liner_)?design_(frame|node|picture|built)\b/;
const framePath = (p?: string) => (p && /\.liner\/designs\/[^/]+\/frames\/[^/]+\.html$/.test(p.replace(/\\/g, "/")) ? p.replace(/\\/g, "/") : undefined);
const nameIn = (input?: string, key = "name") => {
  try {
    const v = (JSON.parse(input ?? "") as Record<string, unknown>)[key];
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
};

/** What the agent is drawing in the turn that runs now, if it's drawing: the call, and the frame it names. */
export function drawingOf(items: Item[]): { tool: Tool; frame?: string } | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "user" || it.kind === "checkpoint") return undefined;
    if (it.kind !== "tool" || it.status !== "running") continue;
    if (CANVAS_TOOL.test(it.tool)) return { tool: it, frame: nameIn(it.input) ?? nameIn(it.input, "frame") };
    const p = framePath(it.path);
    if (p && (it.toolKind === "edit" || it.toolKind === "write")) return { tool: it, frame: p.split("/").pop()!.replace(/\.html$/, "") };
  }
  return undefined;
}
