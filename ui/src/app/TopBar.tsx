/*
  The right end of the session's header, after TasteCode v0.5: Changes, with how many files wait to
  be committed and pushed, then the two panels' buttons, the one below (shells and runs) and the
  one on the right (every other surface and your apps). The surfaces open from the right panel's
  + and their keys (⌘⇧ and a letter), and ⌘K finds them all; the apps you pin keep a tab at the
  start of that panel's strip.
*/
import { createContext, useSyncExternalStore, type ReactNode } from "react";
import { Tooltip } from "@liner/components/tooltip/tooltip";
import { behind, onScreen, toggleDock, toggleTab, type DockState } from "./dock";
import { I } from "./icons";
import { shortcutOf } from "./keymap";
import { plural } from "./model";
import * as os from "./os";
import type { Tab } from "./Surfaces";
import { Lines } from "./ui";


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

export function TopBar({ dock, onDock, below, onBelow, files, lines, run }: { dock: DockState; onDock: (f: (d: DockState) => DockState) => void; below: boolean; onBelow: () => void; files: number; lines: { added: number; removed: number }; run?: ReactNode }) {
  const changes = onScreen(dock, "changes");
  const keys = (id: string) => os.keys(shortcutOf(id) ?? []) || undefined;
  return (
    <>
      <button
        type="button"
        className="lc-tb lc-tb-changes l-focus"
        aria-label={`Changes${files ? `, ${plural(files, "file")} waiting to commit and push` : ""}`}
        aria-pressed={changes}
        data-behind={behind(dock, "changes") || undefined}
        title={files ? `${plural(files, "file")} waiting to commit and push` : "The session's changes"}
        onClick={() => onDock((d) => toggleTab(d, "changes"))}
      >
        <I.changes size={16} />
        Changes
        <Lines {...lines} />
        {files > 0 && (
          <span key={files} className="lc-tb-count l-num" aria-hidden>
            {files > 99 ? "99+" : files}
          </span>
        )}
      </button>
      {run}
      <span className="lc-sbar-sep" aria-hidden />
      <div className="lc-sbar" role="toolbar" aria-label="Panels">
        <Tooltip content={below ? "Hide the bottom panel" : "Show the bottom panel: shells and runs"} shortcut={keys("surface.terminal")}>
          <button type="button" className="lc-tb lc-sbar-b l-focus" aria-label={below ? "Hide the bottom panel" : "Show the bottom panel"} aria-pressed={below} onClick={onBelow}>
            <I.panelBottom size={16} />
          </button>
        </Tooltip>
        <Tooltip content={dock.open ? "Hide the right panel" : "Show the right panel"}>
          <button type="button" className="lc-tb lc-sbar-b l-focus" aria-label={dock.open ? "Hide the right panel" : "Show the right panel"} aria-pressed={dock.open} onClick={() => onDock(toggleDock)}>
            <I.dock size={16} />
          </button>
        </Tooltip>
      </div>
    </>
  );
}

/** Opens a tab in a session's right panel by its id, as the strip's pinned apps and ⌘K do. */
export type OpenTab = (tab: Tab) => void;
