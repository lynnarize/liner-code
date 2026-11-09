/*
  The right end of the session's header, the way Claude Code draws its own: Run a script, then a
  row of icon buttons of one size that are the panels' tabs. Session, Changes, Browser and Files
  come up in the right panel and go away when pressed again (dock.ts, toggleTab); Terminal shows
  the bottom panel, with its shells and runs. Changes carries a small count of the files waiting to
  be committed and pushed. The ··· holds the other surfaces, your apps, and hiding the panel, and in
  a narrow bar the buttons that gave way to it (the Wall's too). Every surface also has its key (⌘⇧ and a letter),
  which does what its button does, and ⌘K finds them all; the apps you pin keep a tab at the start
  of the panel's strip.
*/
import { createContext, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Tooltip } from "@liner/components/tooltip/tooltip";
import { appIcon, appsFor } from "./Addon";
import { behind, onScreen, openTab, toggleDock, toggleTab, type DockState } from "./dock";
import { useEngine } from "./engine";
import { I } from "./icons";
import { shortcutOf } from "./keymap";
import { plural } from "./model";
import * as os from "./os";
import { SURFACES, surfaceOf, type SurfaceId, type Tab } from "./Surfaces";
import { PanelHead, Pop, Row, Sep } from "./ui";


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

/** The surfaces with a button of their own in the row; the rest are in its ···. */
const ROW: SurfaceId[] = ["session", "terminal", "changes", "browser", "files"];
/** The step of a narrowing bar at which each gives way to the ··· (dock.css, lc-bar). The Terminal stays. */
const GIVES_WAY: Partial<Record<SurfaceId, number>> = { files: 1, browser: 2, session: 3, changes: 4 };

/*
  The steps a bar takes past those its width takes (dock.css): what it holds comes and goes (the
  Wall's way back, the crew, the apps' tabs, the Wall's button), which a width can't know. So it
  measures, as T3 Code's header measures its breadcrumb (chat/ChatHeader.tsx: on a resize, and again
  once fonts load): with nothing squeezed but the title, a step at a time in this order until what
  it holds ends inside it. The Wall's button goes first (the sidebar and its key reach the Wall
  too), then the way back's count and arrows, then the crew down to its faces (chips give before
  buttons, app.css), then the row's buttons as the width's steps take them, then the crew (the ···
  has Agents), the way back to its arrow, and last the room between them all. `data-give` on the
  bar names the steps taken; the ··· asks what they hid.
*/
const GIVE = ["wall", "count", "faces", "1", "2", "3", "4", "crew", "back", "tight"];
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

export function TopBar({ dock, onDock, below, onBelow, files, lines, run, projectId }: { dock: DockState; onDock: (f: (d: DockState) => DockState) => void; below: boolean; onBelow: () => void; files: number; lines: { added: number; removed: number }; run?: ReactNode; projectId?: string }) {
  const addons = useEngine((s) => s.addons);
  const apps = appsFor(addons, projectId).filter((a) => a.panel?.place !== "tab");
  const keys = (id: string) => os.keys(shortcutOf(id) ?? []) || undefined;
  const changed = lines.added || lines.removed ? `+${lines.added} −${lines.removed}` : "";
  const waiting = files ? `${plural(files, "file")} waiting to commit and push` : "";
  const row = useRef<HTMLDivElement>(null);
  const wall = useRef<HTMLButtonElement>(null);
  useGiveWay(row);
  const openWall = () => window.dispatchEvent(new CustomEvent("lc:wall"));
  return (
    <>
      {run}
      <span className="lc-sbar-sep" aria-hidden />
      <div ref={row} className="lc-sbar" role="toolbar" aria-label="Panels">
        {ROW.map((id) => {
          const s = surfaceOf(id)!;
          if (id === "terminal")
            return (
              <Tooltip key={id} content={below ? "Hide the Terminal" : "Terminal"} shortcut={keys("surface.terminal")}>
                <button type="button" className="lc-tb lc-sbar-b l-focus" aria-label="Terminal" aria-pressed={below} onClick={onBelow}>
                  <s.icon size={16} />
                </button>
              </Tooltip>
            );
          const on = onScreen(dock, id);
          const tip = id === "changes" ? ["Changes", changed, waiting].filter(Boolean).join(" · ") : s.label;
          return (
            <Tooltip key={id} className={`lc-sbar-step${GIVES_WAY[id]}`} content={on ? `Hide ${s.label}` : tip} shortcut={keys(`surface.${id}`)}>
              <button
                type="button"
                className="lc-tb lc-sbar-b l-focus"
                data-surface={id}
                aria-label={id === "changes" && files ? `Changes, ${waiting}` : s.label}
                aria-pressed={on}
                data-behind={behind(dock, id) || undefined}
                onClick={() => onDock((d) => toggleTab(d, id))}
              >
                <s.icon size={16} />
                {id === "changes" && files > 0 && (
                  <span key={files} className="lc-tb-count l-num" aria-hidden>
                    {files > 99 ? "99+" : files}
                  </span>
                )}
              </button>
            </Tooltip>
          );
        })}
        <Pop label="More panels" align="end" width={260} menu triggerClass="lc-tb lc-sbar-b" trigger={<I.more size={16} />}>
          {(close) => (
            <>
              <PanelHead>Open in the panel</PanelHead>
              {/* The steps are the CSS's to take, so the buttons it hid say which. */}
              {ROW.filter((id) => row.current?.querySelector(`[data-surface="${id}"]`)?.checkVisibility() === false).map((id) => {
                const s = surfaceOf(id)!;
                return <Row key={id} title={onScreen(dock, id) ? `Hide ${s.label}` : s.label} note={id === "changes" ? waiting || undefined : undefined} icon={<s.icon size={14} />} end={keys(`surface.${id}`)} onPick={() => (close(), onDock((d) => toggleTab(d, id)))} />;
              })}
              {SURFACES.filter((s) => !ROW.includes(s.id)).map((s) => (
                <Row key={s.id} title={s.label} icon={<s.icon size={14} />} end={keys(`surface.${s.id}`)} onPick={() => (close(), onDock((d) => openTab(d, s.id)))} />
              ))}
              {apps.length > 0 && (
                <>
                  <Sep />
                  <PanelHead>Your apps</PanelHead>
                  {apps.map((a) => {
                    const Icon = appIcon(a.panel?.icon);
                    return <Row key={a.id} title={a.name} icon={<Icon size={14} />} onPick={() => (close(), onDock((d) => openTab(d, `app:${a.id}`)))} />;
                  })}
                </>
              )}
              <Sep />
              {wall.current?.checkVisibility() === false && <Row title="The Wall" note="Every session at once" icon={<I.wall size={14} />} end={keys("wall")} onPick={() => (close(), openWall())} />}
              <Row title={dock.open ? "Hide the panel" : "Show the panel"} icon={<I.dock size={14} />} onPick={() => (close(), onDock(toggleDock))} />
            </>
          )}
        </Pop>
      </div>
      {/* The Wall isn't one of the session's panels: it sits apart, after them, and gives way first. App.tsx hears the event. */}
      <span className="lc-sbar-sep lc-sbar-wall" aria-hidden />
      <Tooltip className="lc-sbar-wall" content="The Wall: every session at once" shortcut={keys("wall")}>
        <button ref={wall} type="button" className="lc-tb l-focus" aria-label="The Wall" onClick={openWall}>
          <I.wall size={16} />
        </button>
      </Tooltip>
    </>
  );
}

/** Opens a tab in a session's right panel by its id, as the strip's pinned apps and ⌘K do. */
export type OpenTab = (tab: Tab) => void;
