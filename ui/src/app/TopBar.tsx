/*
  The right end of the session's header, since the one-row header (Devin Desktop's, measured in
  docs/research/devin-desktop.md): Run a script, the bottom panel's toggle, and the right panel's
  while it's shut. The surfaces themselves are the panel's tabs, in its own row on the same line
  (Panel.tsx), with a + for the ones that aren't open. Every surface also has its key (⌘⇧ and a
  letter), which shows it and puts the panel away when it's up, and ⌘K finds them all; the apps you
  pin keep a tab at the start of the panel's row.
*/
import { createContext, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Tooltip } from "@liner/components/tooltip/tooltip";
import { I } from "./icons";
import { shortcutOf } from "./keymap";
import * as os from "./os";
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

/*
  The steps a bar takes when what it holds doesn't fit its column (the panel beside it, or another
  session): what it holds comes and goes (the Wall's way back, the crew, the apps' tabs), which a
  width can't know. So it measures, as T3 Code's header measures its breadcrumb
  (chat/ChatHeader.tsx: on a resize, and again once fonts load): with nothing squeezed but the
  title, a step at a time in this order until what it holds ends inside it. The way back's count
  and arrows go first, then the crew down to its faces, the mode chip, the crew (the panel's + has
  Agents), the way back to its arrow, and last the room between them all. `data-give` on the bar
  names the steps taken. (Before the one-row header the panels' buttons gave way here too; they are
  the panel's tabs now, Panel.tsx, and the Wall's button went to the sidebar and ⌘⇧O.)
*/
const GIVE = ["count", "faces", "mode", "crew", "back", "tight"];
function useGiveWay(row: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const top = row.current?.closest<HTMLElement>(".lc-top");
    if (!top) return;
    // Laid out from the left, the last of what it holds ends past the bar's edge when it doesn't fit;
    // a tip under a button (an absolute box) doesn't count, as it would with the bar's scrollWidth.
    const fits = () => {
      const last = [...top.children].findLast((c) => c.checkVisibility() && !/absolute|fixed/.test(getComputedStyle(c).position));
      return !last || last.getBoundingClientRect().right <= top.getBoundingClientRect().right - parseFloat(getComputedStyle(top).paddingRight) + 0.5;
    };
    // Each step only narrows it, so from the steps it took last it walks back while it still fits, or on until it does.
    let n = 0;
    const take = (k: number) => ((n = k), (top.dataset.give = GIVE.slice(0, k).join(" ")));
    const fit = () => {
      top.dataset.measure = "";
      take(n);
      if (fits()) {
        while (n > 0) {
          take(n - 1);
          if (!fits()) {
            take(n + 1);
            break;
          }
        }
      } else while (n < GIVE.length && (take(n + 1), !fits()));
      delete top.dataset.measure;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(top);
    // What it holds changes while the bar's own size doesn't: a chip comes, a title, a tab picked (its words bolder). A tip showing isn't one.
    const mo = new MutationObserver((records) => records.some((r) => r.type !== "childList" || [...r.addedNodes, ...r.removedNodes].some((x) => !(x instanceof Element && x.classList.contains("l-tip")))) && fit());
    mo.observe(top, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "aria-selected", "hidden"] });
    document.fonts.addEventListener("loadingdone", fit);
    return () => {
      ro.disconnect();
      mo.disconnect();
      document.fonts.removeEventListener("loadingdone", fit);
    };
  }, []);
}

/*
  The right end of the session's header (Devin Desktop's, docs/research/devin-desktop.md): Run a
  script, the bottom panel's toggle (the Terminal), and, only while the right panel is shut, the
  button that shows it. Open, the panel's own row ends with the button that hides it (Panel.tsx),
  in the same place on screen, so the toggle never moves.
*/
export function TopBar({ panel, onPanel, below, onBelow, run }: { panel: boolean; onPanel: () => void; below: boolean; onBelow: () => void; run?: ReactNode }) {
  const keys = (id: string) => os.keys(shortcutOf(id) ?? []) || undefined;
  const row = useRef<HTMLDivElement>(null);
  useGiveWay(row);
  return (
    <div ref={row} className="lc-sbar" role="toolbar" aria-label="Session tools">
      {run}
      <Tooltip content={below ? "Hide the Terminal" : "Terminal, the bottom panel"} shortcut={keys("surface.terminal")}>
        <button type="button" className="lc-tb lc-sbar-b l-focus" aria-label="Terminal" aria-pressed={below} onClick={onBelow}>
          <I.panelBottom size={16} />
        </button>
      </Tooltip>
      {!panel && (
        <Tooltip content="Show the panel">
          <button type="button" className="lc-tb lc-sbar-b l-focus" data-panel-toggle aria-label="Show the panel" aria-pressed={false} onClick={onPanel}>
            <I.dock size={16} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

/** Opens a tab in a session's right panel by its id, as the strip's pinned apps and ⌘K do. */
export type OpenTab = (tab: Tab) => void;
