/*
  The session's surfaces, in one row at the top right of its header, always there and never
  moving (Claude Code's own): Changes, with how many files wait to be committed and pushed; Side
  chat, Terminal, Browser, Files, Design and Pull request; the apps you pinned; ⋯ for every other
  surface and all your apps, each with a pin, and Make one…; and the dock's own button. Each
  surface's button brings it up in the dock, or puts the dock away when it's already up there; the
  one on screen sits on a tile, and one open behind another tab carries a dot.
  It takes the place of the tray that floated at the thread's right edge and lay down at the foot
  of the open panel.
*/
import { useSyncExternalStore, type ReactNode } from "react";
import type { Thread } from "@contracts";
import { Tooltip } from "@liner/components/tooltip/tooltip";
import { appIcon, appsFor } from "./Addon";
import { behind, onScreen, openTab, toggleDock, toggleTab, type DockState } from "./dock";
import { useEngine } from "./engine";
import { toComposer } from "./Find";
import { I } from "./icons";
import { shortcutOf } from "./keymap";
import { plural } from "./model";
import * as os from "./os";
import { SURFACES, type SurfaceId, type Tab } from "./Surfaces";
import { Lines, PanelHead, Pop, Sep } from "./ui";

/** Always in the row; the rest of the surfaces are in its ⋯. */
const SHOWN: SurfaceId[] = ["side", "terminal", "browser", "files", "design", "pr"];
const MORE: SurfaceId[] = ["device", "changes", "session", "agents", "linked", "routines"];

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

const keysOf = (id: string) => os.keys(shortcutOf(`surface.${id}`) ?? []) || undefined;

function Btn({ label, keys, on, dot, onClick, children }: { label: string; keys?: string; on: boolean; dot: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label} shortcut={keys}>
      <button type="button" className="lc-tb lc-sbar-b l-focus" aria-label={dot ? `${label}, open in the dock` : label} aria-pressed={on} data-behind={dot || undefined} onClick={onClick}>
        {children}
      </button>
    </Tooltip>
  );
}

export function TopBar({ thread, dock, onDock, files, lines }: { thread: Thread; dock: DockState; onDock: (f: (d: DockState) => DockState) => void; files: number; lines: { added: number; removed: number } }) {
  const addons = useEngine((s) => s.addons);
  const pins = usePins();
  const apps = appsFor(addons, thread.projectId);
  const mine = apps.filter((a) => pins.includes(a.id));
  const toggle = (t: Tab) => onDock((d) => toggleTab(d, t));
  const changes = onScreen(dock, "changes");
  return (
    <>
      <button
        type="button"
        className="lc-tb lc-tb-changes l-focus"
        aria-label={`Changes${files ? `, ${plural(files, "file")} waiting to commit and push` : ""}`}
        aria-pressed={changes}
        data-behind={behind(dock, "changes") || undefined}
        title={files ? `${plural(files, "file")} waiting to commit and push` : "The session's changes"}
        onClick={() => toggle("changes")}
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
      <span className="lc-sbar-sep" aria-hidden />
      <div className="lc-sbar" role="toolbar" aria-label="Surfaces">
        {SHOWN.map((id) => {
          const s = SURFACES.find((x) => x.id === id)!;
          return (
            <Btn key={id} label={s.label} keys={keysOf(id)} on={onScreen(dock, id)} dot={behind(dock, id)} onClick={() => toggle(id)}>
              <s.icon size={16} />
            </Btn>
          );
        })}
        {mine.map((a) => {
          const Icon = appIcon(a.panel?.icon);
          return (
            <Btn key={a.id} label={a.name} on={onScreen(dock, `app:${a.id}`)} dot={behind(dock, `app:${a.id}`)} onClick={() => toggle(`app:${a.id}`)}>
              <Icon size={16} />
            </Btn>
          );
        })}
        <Pop label="More surfaces and your apps" align="end" width={290} triggerClass="lc-tb lc-sbar-b" trigger={<I.more size={16} />}>
          {(close) => (
            <div className="lc-sbar-menu">
              <PanelHead>More surfaces</PanelHead>
              {MORE.map((id) => {
                const s = SURFACES.find((x) => x.id === id)!;
                const keys = keysOf(id);
                return (
                  <button key={id} type="button" className="lc-row l-focus" aria-pressed={onScreen(dock, id)} onClick={() => (close(), onDock((d) => openTab(d, id)))}>
                    <span className="lc-row-tick">
                      <s.icon size={14} />
                    </span>
                    <span className="lc-row-t">
                      <b>{s.label}</b>
                    </span>
                    {keys && <span className="lc-row-end lc-quiet">{keys}</span>}
                  </button>
                );
              })}
              <Sep />
              <PanelHead>Your apps</PanelHead>
              {apps.length === 0 && <p className="lc-quiet lc-pop-note">None yet. Ask for one, and it shows here.</p>}
              {apps.map((a) => {
                const Icon = appIcon(a.panel?.icon);
                const on = pins.includes(a.id);
                return (
                  <span key={a.id} className="lc-sbar-app">
                    <button type="button" className="lc-row l-focus" onClick={() => (close(), onDock((d) => openTab(d, `app:${a.id}`)))}>
                      <span className="lc-row-tick">
                        <Icon size={14} />
                      </span>
                      <span className="lc-row-t">
                        <b>{a.name}</b>
                      </span>
                    </button>
                    <button type="button" className="lc-ib l-focus lc-sbar-pin" aria-label={`${on ? "Unpin" : "Pin"} ${a.name} ${on ? "from" : "to"} the bar`} aria-pressed={on} title={on ? "Unpin from the bar" : "Pin to the bar"} onClick={() => pin(a.id, !on)}>
                      <I.pin size={13} />
                    </button>
                  </span>
                );
              })}
              <Sep />
              <button type="button" className="lc-row l-focus" onClick={() => (close(), toComposer(thread.id, "Make me a panel that "))}>
                <span className="lc-row-tick">
                  <I.plus size={14} />
                </span>
                <span className="lc-row-t">
                  <b>Make one…</b>
                  <small>Say what you'd like</small>
                </span>
              </button>
            </div>
          )}
        </Pop>
      </div>
      <span className="lc-sbar-sep" aria-hidden />
      <Tooltip content={dock.open ? "Hide the dock" : "Show the dock"}>
        <button type="button" className="lc-tb lc-sbar-b l-focus" aria-label={dock.open ? "Hide the dock" : "Show the dock"} aria-pressed={dock.open} onClick={() => onDock(toggleDock)}>
          <I.dock size={16} />
        </button>
      </Tooltip>
    </>
  );
}
