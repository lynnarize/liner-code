/*
  What the session's header shares with the rest of the app, since the one-row header (Devin
  Desktop's, docs/research/devin-desktop.md) put the surfaces in the panel's own row (Panel.tsx):
  ⌘K's way into the open session's dock, whose side of Open beside has the keys, and the apps you
  pin to the panel's row.
*/
import { createContext, useSyncExternalStore } from "react";
import { type Tab } from "./Surfaces";


/*
  The open session's dock, reachable from outside it: ⌘K's "Open Browser" and the like go to the
  session on screen through here. Answers whether a session took it.
*/
const openers = new Map<string, (tab: Tab) => void>();
export function onOpenSurface(threadId: string, open: (tab: Tab) => void) {
  openers.set(threadId, open);
  return () => {
    if (openers.get(threadId) === open) openers.delete(threadId);
  };
}
export function openSurface(threadId: string, tab: Tab) {
  const open = openers.get(threadId);
  open?.(tab);
  return Boolean(open);
}

/*
  The open session's full canvas, reachable from a surface: Session registers it, Changes' menu
  calls it. The right edge's + has the same row, so every surface can get to it.
*/
const canvases = new Map<string, { toggle: () => void; full: () => boolean }>();
/** The open session's full canvas, reachable from a surface: Session registers it, Changes' menu calls it. */
export function onFullCanvas(threadId: string, f: { toggle: () => void; full: () => boolean }) {
  canvases.set(threadId, f);
  return () => {
    if (canvases.get(threadId) === f) canvases.delete(threadId);
  };
}
export function fullCanvas(threadId: string): { toggle: () => void; full: boolean } | undefined {
  const f = canvases.get(threadId);
  return f && { toggle: f.toggle, full: f.full() };
}

/*
  Whether the window's keys are this session's. Open beside shows two, and only the side you're in
  takes them: what a session holds that listens on the window (its composer, Review) asks here.
  Alone, or outside a session, it's always yes.
*/
export const SideKeys = createContext(true);

/* The apps you pinned to the row, the same in every session. */
const PINS = "lc:pinned-apps";
const pinWatch = new Set<() => void>();
let pinned: string[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(PINS) || "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
})();
export const usePins = () =>
  useSyncExternalStore(
    (f) => (pinWatch.add(f), () => void pinWatch.delete(f)),
    () => pinned,
  );
export function pin(id: string, on: boolean) {
  pinned = on ? [...new Set([...pinned, id])] : pinned.filter((x) => x !== id);
  try {
    localStorage.setItem(PINS, JSON.stringify(pinned));
  } catch {
    // storage is off: it lasts while the app is open
  }
  for (const f of pinWatch) f();
}
