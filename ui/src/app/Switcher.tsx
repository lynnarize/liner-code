/*
  The session's two rows of controls (line and dot, board Main, 2026-11-27).

  The chat's top row ends in three toggles, each an icon button lit while what it stands for is up: the session details card
  (Session.tsx), the bottom panel with the shells, and the right panel. The panel's toggle stands in the panel's own head once
  the panel is open, so the top row shows it only while the panel is hidden.

  The panel's head row (Panel.tsx draws it) names the surfaces that are open as tabs, each with its icon, its name and a count
  where there is one, the one showing filled; then +, the menu of every surface with its key, a tick on the open ones, the
  session's shells and what listens. At its right end: fill the window, and hide the panel. Pressing a tab shows it; a tab
  closes from its own ×, which puts that surface away. Every surface is reachable from + and by its key (Session.tsx).
*/
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { LocalServer, Thread } from "@contracts";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { plural } from "./model";
import { appIcon, appsFor } from "./Addon";
import { usePins } from "./TopBar";
import { shortcutOf } from "./keymap";
import { runScript, SURFACES, surfaceOf, type Tab } from "./Surfaces";
import { closeTab, hideDock, openTab, type DockState } from "./dock";
import { fadeOf, moreRows, scrollToShow, shortTabs } from "./surface-row";
import { MenuFoot, PanelHead, Pop, Row, Sep, SubMenu } from "./ui";
import * as os from "./os";

const keys = (id: string) => os.keys(shortcutOf(id) ?? []) || undefined;
/** "Show the panel (⇧⌘D)": a button's tooltip with its key, when it has one. */
const tip = (words: string, id?: string) => (id && keys(id) ? `${words} (${keys(id)})` : words);

/**
  The three toggles at the top row's right end. `details` is the session details card, or, with the panel open, the Session
  surface in it (there is no room for the card then); `panel` is shown only while the panel is hidden.
*/
export function TopToggles({ details, below, onBelow, panel }: {
  details: { on: boolean; onToggle: () => void };
  below: boolean;
  onBelow: () => void;
  panel: { open: boolean; onShow: () => void };
}) {
  return (
    <div className="lc-sw" role="toolbar" aria-label="Session details, the terminal and the panel">
      <button type="button" className="lc-sw-b l-focus" aria-pressed={details.on} aria-label={details.on ? "Hide session details" : "Show session details"} title={tip(details.on ? "Hide session details" : "Show session details", "surface.session")} onClick={details.onToggle}>
        <I.list size={16} />
      </button>
      <button type="button" className="lc-sw-b l-focus" aria-pressed={below} aria-label={below ? "Hide the terminal" : "Show the terminal"} title={tip(below ? "Hide the terminal" : "Show the terminal", "surface.terminal")} onClick={onBelow}>
        <I.panelBottom size={16} />
      </button>
      {!panel.open && (
        <button type="button" className="lc-sw-b l-focus" aria-pressed={false} aria-label="Show the panel" title="Show the panel" onClick={panel.onShow}>
          <I.panel size={16} />
        </button>
      )}
    </div>
  );
}

/** A tab's icon: a built-in surface's own, an add-on's, or the app mark for a run or a preview. */
function iconOf(t: Tab, addons: { id: string; panel?: { icon?: Parameters<typeof appIcon>[0] } }[]): (p: { size?: number }) => ReactNode {
  const s = surfaceOf(t);
  if (s) return s.icon;
  if (t.startsWith("app:")) return appIcon(addons.find((a) => a.id === t.slice(4))?.panel?.icon);
  return I.app;
}

/**
  The panel's head row: a tab for each surface the panel holds (`tabs`, in the order they were opened), +, then fill the window
  and hide the panel. `counts` are the numbers a tab carries ("Changes 3").
*/
export function PanelTabs({ thread, dock, onDock, nameOf, counts, below, onBelow, onMake }: {
  thread: Thread;
  dock: DockState;
  onDock: (d: DockState) => void;
  nameOf: (t: Tab) => string;
  counts: Partial<Record<string, number>>;
  below: boolean;
  onBelow: (on: boolean) => void;
  /** New add-on: asks the agent for one in the composer. */
  onMake: () => void;
}) {
  const addons = useEngine((s) => s.addons);
  const shown = dock.panes[dock.at]?.tab;
  const tabs = [...new Set(dock.panes.flatMap((p) => p.tabs))];
  /*
    Too many tabs for the room left of +, Fill and Hide (which never move): first the tabs drop their names to their icons,
    from the far end inwards, the open one keeping its name; past that the row scrolls, with a fade at each end that has
    more, and the open tab is scrolled whole into view whenever it changes.
  */
  const list = useRef<HTMLDivElement>(null);
  const full = useRef<Record<string, number>>({});
  const [short, setShort] = useState<Set<string>>(() => new Set());
  const [fade, setFade] = useState<ReturnType<typeof fadeOf>>(undefined);
  const key = tabs.join("|");
  const fit = () => {
    const el = list.current;
    if (!el) return;
    // Each tab's own button, with its name: the × that comes and goes under the pointer is left out, so pointing never refits the row.
    for (const tab of el.querySelectorAll<HTMLElement>(":scope > .lc-ptab:not([data-short])")) full.current[tab.dataset.tab!] = tab.querySelector<HTMLElement>(".lc-ptab-b")?.offsetWidth ?? 0;
    // The room is the head row's, less its padding, its gaps and the controls that never move: the list itself is only as
    // wide as its tabs, so its own width can't say how much room a tab could take back.
    const row = el.parentElement!;
    const cs = getComputedStyle(row);
    const others = [...row.children].filter((c) => c !== el && !c.classList.contains("lc-grow")) as HTMLElement[];
    const room = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - others.reduce((n, c) => n + c.offsetWidth, 0) - parseFloat(cs.columnGap || "0") * others.length - 1;
    const next = shortTabs(tabs, shown, full.current, room);
    setShort((was) => ([...was].sort().join() === [...next].sort().join() ? was : next));
    setFade(fadeOf(el.scrollLeft, el.scrollWidth, el.clientWidth));
  };
  useLayoutEffect(fit);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  }, [key, shown]);
  useLayoutEffect(() => {
    const el = list.current;
    const tab = el?.querySelector<HTMLElement>(":scope > .lc-ptab[data-on]");
    if (!el || !tab) return;
    el.scrollLeft = scrollToShow(tab.offsetLeft, tab.offsetWidth, el.scrollLeft, el.clientWidth);
    setFade(fadeOf(el.scrollLeft, el.scrollWidth, el.clientWidth));
  }, [shown, key, short]);
  return (
    <div className="lc-ptabs">
      <div ref={list} className="lc-ptabs-list" role="tablist" aria-label="Open surfaces" data-fade={fade} onScroll={(e) => setFade(fadeOf(e.currentTarget.scrollLeft, e.currentTarget.scrollWidth, e.currentTarget.clientWidth))}>
        {tabs.map((t) => {
          const Icon = iconOf(t, addons);
          const name = nameOf(t);
          const n = counts[t];
          const on = t === shown;
          const iconOnly = short.has(t) && !on;
          return (
            <span key={t} className="lc-ptab" data-tab={t} data-on={on || undefined} data-short={iconOnly || undefined}>
              <button type="button" role="tab" className="lc-ptab-b l-focus" aria-selected={on} aria-label={iconOnly ? (n ? `${name}, ${n}` : name) : undefined} title={surfaceOf(t) ? tip(name, `surface.${t}`) : name} onClick={() => onDock(openTab(dock, t))}>
                <Icon size={14} />
                {!iconOnly && <span className="lc-ptab-n">{name}</span>}
                {n && !iconOnly ? <span className="lc-ptab-ct l-num">{n}</span> : null}
              </button>
              <button type="button" className="lc-ptab-x l-focus" aria-label={`Close ${name}`} title={`Close ${name}`} onClick={() => onDock(closeTab(dock, t))}>
                <I.close size={12} />
              </button>
            </span>
          );
        })}
      </div>
      {/* +, Fill the window and Hide the panel stay where they are, outside the tabs' scrolling row. */}
      <SurfaceMenu thread={thread} dock={dock} onDock={onDock} below={below} onBelow={onBelow} onMake={onMake} />
      <span className="lc-grow" />
      <button type="button" className="lc-sw-b l-focus" aria-pressed={dock.full} aria-label={dock.full ? "Back beside the chat" : "Fill the window"} title={dock.full ? "Back beside the chat" : "Fill the window"} onClick={() => onDock({ ...dock, full: !dock.full })}>
        {dock.full ? <I.shrink size={16} /> : <I.expand size={16} />}
      </button>
      <button type="button" className="lc-sw-b l-focus" aria-pressed aria-label="Hide the panel" title="Hide the panel" onClick={() => onDock(hideDock(dock))}>
        <I.panel size={16} />
      </button>
    </div>
  );
}

/** The surfaces + lists, in the board's order (Menus, "Open a surface"); the Terminal is in the shells' part, Linked pull requests inside Pull request. */
const MENU_ORDER = ["session", "changes", "files", "browser", "agents", "pr", "design", "side", "device", "routines"];

/**
  +: every surface of the panel, with its key, a tick on the open ones; Your apps to the side; the session's shells, live,
  and New terminal; then a grey line saying what listens.
*/
function SurfaceMenu({ thread, dock, onDock, below, onBelow, onMake }: { thread: Thread; dock: DockState; onDock: (d: DockState) => void; below: boolean; onBelow: (on: boolean) => void; onMake: () => void }) {
  const addons = useEngine((s) => s.addons);
  const pins = usePins();
  const apps = appsFor(addons, thread.projectId);
  const rows = moreRows(dock, apps, pins);
  const open = new Set(dock.panes.flatMap((p) => p.tabs));
  const list = MENU_ORDER.map((id) => SURFACES.find((s) => s.id === id)).filter((s) => s !== undefined);
  return (
    <Pop label="Open a surface" menu align="start" width={280} triggerClass="lc-ptab-plus" triggerAttrs={{ title: "Open a surface" }} trigger={<I.plus size={16} />}>
      {(close) => (
        <>
          <PanelHead>{thread.title}</PanelHead>
          <Sep />
          {list.map((s) => (
            <Row key={s.id} title={s.label} icon={<s.icon size={14} />} on={open.has(s.id) || undefined} end={keys(`surface.${s.id}`)} onPick={() => (close(), onDock(openTab(dock, s.id)))} />
          ))}
          <SubMenu title="Your apps" icon={<I.app size={14} />} value={rows.appOn ? <I.check size={14} className="lc-row-on" /> : apps.length || undefined} label="Your apps" width={250}>
            {() => (
              <>
                {rows.apps.map((a) => {
                  const Icon = appIcon(addons.find((x) => x.id === a.id)?.panel?.icon);
                  return <Row key={a.id} title={a.name} icon={<Icon size={14} />} on={open.has(a.tab) || undefined} onPick={() => (close(), onDock(openTab(dock, a.tab)))} />;
                })}
                {rows.apps.length > 0 && <Sep />}
                <Row title="New add-on" icon={<I.plus size={14} />} onPick={() => (close(), onMake())} />
              </>
            )}
          </SubMenu>
          <Sep />
          <Shells thread={thread} below={below} onBelow={onBelow} close={close} />
        </>
      )}
    </Pop>
  );
}

/** The menu's shells part: how many the session has, live; Show or hide the terminal; New terminal; what listens, at the foot. */
function Shells({ thread, below, onBelow, close }: { thread: Thread; below: boolean; onBelow: (on: boolean) => void; close: () => void }) {
  const [shells, setShells] = useState<number | null>(null);
  const [servers, setServers] = useState<LocalServer[] | null>(null);
  useEffect(() => {
    let live = true;
    void rpc("term.list", { threadId: thread.id }).then((l) => live && setShells(l.length), () => live && setShells(0));
    void rpc("ports.list", { threadId: thread.id }).then((l) => live && setServers(l.filter((s) => s.owner !== null)), () => live && setServers([]));
    return () => {
      live = false;
    };
  }, [thread.id]);
  const ports = (servers ?? []).map((s) => s.port);
  return (
    <>
      <PanelHead end={shells ? <span className="lc-ptab-live">{plural(shells, "shell")}</span> : undefined}>Terminals</PanelHead>
      <Row title={below ? "Hide the terminal" : "Show the terminal"} icon={<I.terminal size={14} />} end={keys("surface.terminal")} onPick={() => (close(), onBelow(!below))} />
      <Row title="New terminal" icon={<I.plus size={14} />} onPick={() => (close(), runScript(thread.id, { name: "Shell", command: "" }), onBelow(true))} />
      {servers !== null && (
        <>
          <Sep />
          <MenuFoot>{ports.length === 0 ? "Nothing of this session's listens yet" : `${plural(ports.length, "server")} ${ports.length === 1 ? "listens" : "listen"} on ${ports.join(", ")}`}</MenuFoot>
        </>
      )}
    </>
  );
}
