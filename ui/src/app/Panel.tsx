/*
  The right dock beside the session: a full-height column of the paper, one pane, its strip of tabs
  over the surface that's up (dock.ts has the rules; DeepSeek Harness's ui-dockkit and
  ui-sidebar-right were the model). The strip is the panel's header, on the session header's line
  (one top row, as Devin Desktop draws it: docs/research/devin-desktop.md). A chip drags to another
  place in the strip. The + is a menu of what isn't open; the right edge's lit icon hides the panel
  and its menu has the full canvas (Session.tsx), so the strip carries neither. In the full
  canvas Changes takes the whole width, under the same strip (the right edge is the way back). (0.2.1 had a second pane; dock.ts's readDock folds a
  layout it kept into the one.)
  Every surface you open is mounted once and kept while it's open, so moving its tab never
  reloads a page or restarts a shell.
  Changes is the diff, kept by turn (Review.tsx, the same in the panel and the full canvas): the
  turn picker sits in the diff's strip, the file you pressed in the thread scrolls into view, and
  the foot says how many files you've looked at, with Undo for the turn and Commit for everything
  that's left.
  Agents says who worked in this session, on what, and how much of the budget they used.
*/
import { memo, Suspense, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ROUTINES_ON, type Item, type Thread } from "@contracts";
import { Tooltip } from "@liner/components/tooltip/tooltip";
import { Boundary } from "./Boundary";
import { closeOthers, closeTab, GUIDE, moveTab, openTab, paneOf, pickTab, type DockState } from "./dock";
import { useEngine, useItemsWhere } from "./engine";
import { I } from "./icons";
import { plural } from "./model";
import { ContextMenu, PanelHead, Pop, Row, Sep } from "./ui";
import { AddonView, appIcon, appsFor, isPanelAsk } from "./Addon";
import { AgentsSurface } from "./Crew";
import { pin, usePins } from "./TopBar";
import { shortcutOf } from "./keymap";
import * as os from "./os";
import { BrowserSurface } from "./Browser";
import { DesignSurface } from "./Design";
import { toComposer } from "./Find";
import { LinkedSurface, PrSurface } from "./Pr";
import { SideChat } from "./SideChat";
import { Guide, SURFACES, surfaceOf, type SurfaceId, type Tab } from "./Surfaces";
import { entering } from "./look";
import { early, lazyAgain } from "./early";
import "./dock.css";
// The terminal brings xterm.js; it loads the first time you open one.
const TerminalSurface = lazyAgain(() => import("./Terminal").then((m) => m.TerminalSurface));
const SessionSurface = lazyAgain(() => import("./SessionInfo").then((m) => m.SessionSurface));
/*
  Surfaces opened now and then, kept out of the start: they load once the dock is up and the app is
  idle, so the first open has nothing to wait for (early.ts, as App's screens do). Changes (Review,
  with its diff and line questions), the Device (it needs Xcode) and Files (a link hands its file over through reveal.ts) are
  the ones only this panel reads; the others (Browser, the PR, add-on views) are read by the
  timeline or App too, so they're in the start anyway. Routines are switched off (contracts, ROUTINES_ON): a run's tab kept from before still opens.
*/
const ReviewView = early(() => import("./Review").then((m) => m.Review));
const DeviceView = early(() => import("./Device").then((m) => m.DeviceSurface));
const FilesView = early(() => import("./Files").then((m) => m.FilesSurface));
const Review = ReviewView.View;
const DeviceSurface = DeviceView.View;
const FilesSurface = FilesView.View;
const RoutinesList = lazyAgain(() => import("./Routines").then((m) => m.RoutinesList));
const RunDetail = lazyAgain(() => import("./Routines").then((m) => m.RunDetail));
let preloaded = false;
/** The rarer surfaces, fetched once the first dock is up and the app has a moment. */
function preload() {
  if (preloaded) return;
  preloaded = true;
  const go = () => void Promise.all([ReviewView.fetch(), DeviceView.fetch(), FilesView.fetch()]).catch(() => (preloaded = false));
  window.setTimeout(() => (typeof requestIdleCallback === "function" ? requestIdleCallback(go, { timeout: 4000 }) : go()), 1500);
}
/** A surface's wait while its code arrives: the panel's own quiet line. */
const waitFor = (what: string) => (
  <div className="lc-diff-wait">
    <span className="l-shimmer">{what}</span>
  </div>
);

/*
  The two surfaces that read the whole timeline, a reply's words too (the session's context, a
  design's live frames), each subscribe on their own, so the dock itself doesn't redraw with every
  frame of a reply. Out of sight, one keeps the timeline as it was when it went: a hidden tab costs
  nothing while a reply streams, and catches up as it comes back.
*/
function useItemsShown(threadId: string, visible: boolean) {
  const kept = useRef<Item[] | null>(null);
  const items = useEngine((s) => (visible || !kept.current ? (s.items[threadId] ?? NO_ITEMS) : kept.current));
  kept.current = items;
  return items;
}
const NO_ITEMS: Item[] = [];
const SessionTab = memo(function SessionTab({ thread, visible, onShowChange }: { thread: Thread; visible: boolean; onShowChange: (path: string) => void }) {
  const items = useItemsShown(thread.id, visible);
  return (
    <Suspense fallback={null}>
      <SessionSurface thread={thread} items={items} visible={visible} onShowChange={onShowChange} />
    </Suspense>
  );
});
const DesignTab = memo(function DesignTab({ thread, agentName, visible }: { thread: Thread; agentName: string; visible: boolean }) {
  const items = useItemsShown(thread.id, visible);
  return <DesignSurface thread={thread} items={items} agentName={agentName} visible={visible} />;
});

/** A chip on its way between panes. */
const DRAG = "application/x-liner-tab";

export function Panel({
  thread,
  dock,
  onDock,
  focus,
  onFocus,
  agentName,
  onOpenSession,
  onRoutine,
  leaving,
  files = 0,
  lead,
}: {
  thread: Thread;
  dock: DockState;
  onDock: (d: DockState) => void;
  focus: { id: string; path?: string } | null;
  onFocus: (f: { id: string; path?: string } | null) => void;
  agentName: string;
  onOpenSession: (id: string, tab?: Tab) => void;
  onRoutine: (id?: string) => void;
  /** Shut, and on its way out: it stays as it was while its column closes, and takes no clicks. */
  leaving?: boolean;
  /** The files waiting to be committed, said quietly on the Changes tab. */
  files?: number;
  /** What starts the session's header (the sidebar's button), for when the panel's row is the paper's header. */
  lead?: ReactNode;
}) {
  const runs = useEngine((s) => s.runs);
  const addons = useEngine((s) => s.addons);
  // Panel reads no timeline of its own but the add-on asks a preview tab names: a reply's words don't redraw the dock.
  const asks = useItemsWhere(thread.id, isPanelAsk) as Extract<Item, { kind: "approval" }>[];
  useEffect(preload, []);
  /** A tab's name and icon: a surface's, a run's, an add-on's, or a preview's. */
  const meta = (t: Tab) => {
    if (t === GUIDE) return { label: "New tab", icon: I.guide };
    if (t.startsWith("run:")) {
      const r = runs.find((x) => x.id === t.slice(4));
      return { label: r?.subject ? `Run on #${r.subject.number}` : "A run", icon: I.routines };
    }
    if (t.startsWith("app:")) {
      const a = addons.find((x) => x.id === t.slice(4));
      return { label: a?.name ?? "An add-on", icon: appIcon(a?.panel?.icon), app: true };
    }
    if (t.startsWith("preview:")) {
      const a = asks.find((x) => x.id === t.slice(8))?.addon;
      return { label: a?.name ?? "A preview", icon: appIcon(a?.kind === "panel" ? a.icon : undefined), preview: true };
    }
    const s = surfaceOf(t);
    return { label: s?.label ?? t, short: t === "linked" ? "Linked" : undefined, icon: s?.icon ?? I.routines };
  };
  // Only surfaces you've opened mount; once mounted they stay while they're open in either pane.
  const shown = dock.panes.map((p) => p.tab);
  const all = [...new Set(dock.panes.flatMap((p) => p.tabs))].filter((t) => t !== GUIDE);
  const [mounted, setMounted] = useState<Set<Tab>>(() => new Set(shown));
  useEffect(() => {
    setMounted((m) => (shown.every((t) => m.has(t)) ? m : new Set([...m, ...shown])));
  }, [shown.join()]);
  useEffect(() => setMounted((m) => new Set([...m].filter((t) => all.includes(t)))), [all.join()]);
  const [dragging, setDragging] = useState<Tab | null>(null);
  const [drop, setDrop] = useState<{ pane: number } | null>(null);
  // A tab you change to, or the panel you open, shows what it holds as it is at Quick motion (look.ts,
  // entering); the panel itself still slides in. Each tab's box stays mounted, so the ones that were
  // showing are known by their element. A tab opened for the first time gets its box a render later,
  // once it is in mounted, so that change is watched too.
  const box = useRef<HTMLElement>(null);
  const showing = useRef(new WeakSet<Element>());
  const tabsShown = dock.panes.map((p) => p.tab).join("\n");
  useLayoutEffect(() => {
    const now = new WeakSet<Element>();
    for (const el of box.current?.querySelectorAll(":scope > .lc-surface:not([hidden])") ?? []) {
      now.add(el);
      if (!showing.current.has(el)) entering(el);
    }
    showing.current = now;
  }, [tabsShown, mounted]);
  const open = (t: Tab, pane?: number) => onDock(openTab(dock, t, pane));
  const wideReview = dock.full && dock.panes.length === 1 && dock.panes[0].tab === "changes";
  const make = () => toComposer(thread.id, "Make me a panel that ");
  // The same function each render, so the memoised Session tab doesn't redraw for a new one.
  const showChangeNow = useRef((_path: string) => {});
  showChangeNow.current = (path) => (onFocus({ id: "all", path }), open("changes"));
  const [showChange] = useState(() => (path: string) => showChangeNow.current(path));

  const body = (t: Tab, visible: boolean) => {
    if (t === "changes")
      return (
        <Suspense fallback={waitFor("Reading the changes")}>
          <Review thread={thread} focus={focus} onFocus={onFocus} wide={wideReview} visible={visible} />
        </Suspense>
      );
    if (t === "agents") return <AgentsSurface thread={thread} />;
    if (t === "session") return <SessionTab thread={thread} visible={visible} onShowChange={showChange} />;
    if (t === "terminal")
      return (
        <Suspense fallback={<div className="lc-diff-wait"><span className="l-shimmer">Opening a terminal</span></div>}>
          <TerminalSurface thread={thread} visible={visible} />
        </Suspense>
      );
    if (t === "side") return <SideChat thread={thread} visible={visible} />;
    if (t === "browser") return <BrowserSurface thread={thread} agentName={agentName} hidden={!visible} />;
    if (t === "design") return <DesignTab thread={thread} agentName={agentName} visible={visible} />;
    if (t === "files")
      return (
        <Suspense fallback={waitFor("Reading the folder")}>
          <FilesSurface thread={thread} onShowChanges={(id, path) => (onFocus({ id, path }), open("changes"))} />
        </Suspense>
      );
    if (t === "pr") return <PrSurface thread={thread} agentName={agentName} visible={visible} />;
    if (t === "linked") return <LinkedSurface thread={thread} agentName={agentName} onOpenSession={(id) => onOpenSession(id)} />;
    if (t === "device")
      return (
        <Suspense fallback={waitFor("Looking for simulators")}>
          <DeviceSurface thread={thread} agentName={agentName} visible={visible} />
        </Suspense>
      );
    if (t === "routines")
      return (
        <Suspense fallback={null}>
          <RoutinesList projectId={thread.projectId} compact onNew={() => onRoutine()} onEdit={(id) => onRoutine(id)} onRun={(r) => open(`run:${r.id}`)} />
        </Suspense>
      );
    if (t.startsWith("run:"))
      return (
        <Suspense fallback={null}>
          <RunDetail runId={t.slice(4)} onOpenSession={(id) => (id === thread.id ? undefined : onOpenSession(id, t))} />
        </Suspense>
      );
    if (t.startsWith("app:")) return <AddonView addon={t.slice(4)} thread={thread} agentName={agentName} visible={visible} />;
    if (t.startsWith("preview:")) {
      const a = asks.find((x) => x.id === t.slice(8))?.addon;
      return <AddonView addon={a?.id ?? ""} preview={t.slice(8)} thread={thread} agentName={agentName} visible={visible} />;
    }
    return null;
  };

  const dropOn = (e: DragEvent, pane: number, index?: number) => {
    const t = e.dataTransfer.getData(DRAG) || dragging;
    setDrop(null);
    setDragging(null);
    if (!t) return;
    e.preventDefault();
    onDock(moveTab(dock, t, pane, index));
  };
  const allow = (e: DragEvent) => {
    if (!dragging && !e.dataTransfer.types.includes(DRAG)) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    return true;
  };

  return (
    <aside
      ref={box}
      className="lc-panel lc-dockpanes"
      aria-label="Dock"
      data-tab={dock.panes[0]?.tab}
      style={{ "--panes": dock.panes.length } as CSSProperties}
      data-wide-review={wideReview || undefined}
      data-leaving={leaving || undefined}
      data-dragging={dragging ? true : undefined}
      inert={leaving || undefined}
    >
      {/* The strip stays the header over the full-width Changes too; the way back is the right edge's, or Changes' own menu. */}
      {dock.panes.map((_, i) => (
        <Strip
          key={i}
          i={i}
          dock={dock}
          onDock={onDock}
          meta={meta}
          dropping={drop?.pane === i}
          onDragTab={(t) => setDragging(t)}
          onDragEnd={() => (setDragging(null), setDrop(null))}
          onDragOver={(e) => allow(e) && setDrop({ pane: i })}
          onDrop={(e, index) => dropOn(e, i, index)}
          style={{ gridColumn: i + 1 }}
          label={`Pane ${i + 1}`}
          projectId={thread.projectId}
          files={files}
          lead={i === 0 ? lead : undefined}
          add={<AddMenu dock={dock} onDock={onDock} pane={i} projectId={thread.projectId} agentName={agentName} onMake={make} />}
        />
      ))}
      {dock.panes.map((p, i) =>
        p.tab === GUIDE ? (
          <div key={`guide:${i}`} className="lc-surface" role="tabpanel" aria-label="New tab" data-pane={i} style={{ gridColumn: i + 1, gridRow: 2 }}>
            <Guide thread={thread} agentName={agentName} panes={dock.panes.length} onOpen={(t) => open(t, i)} onMake={make} />
          </div>
        ) : null,
      )}
      {all.map((t) => {
        if (!mounted.has(t)) return null;
        const i = dock.panes.findIndex((p) => p.tabs.includes(t));
        const visible = i >= 0 && dock.panes[i].tab === t;
        return (
          <div key={t} className="lc-surface" hidden={!visible} role="tabpanel" aria-label={meta(t).label} data-pane={Math.max(0, i)} style={{ gridColumn: Math.max(0, i) + 1, gridRow: 2 }} onPointerDown={() => i !== dock.at && onDock({ ...dock, at: i })}>
            {/* One surface that breaks says so in its own tab; the others and the session go on. */}
            <Boundary label={meta(t).label} quiet>
              {body(t, visible && dock.open)}
            </Boundary>
          </div>
        );
      })}
      {/* While a chip is dragged, each pane's body takes the drop (a page or a terminal under it would swallow it). */}
      {dragging &&
        dock.panes.map((_, i) => (
          <div key={`drop:${i}`} className="lc-dropzone" style={{ gridColumn: i + 1, gridRow: 2 }} data-on={drop?.pane === i || undefined}>
            <div
              className="lc-dropzone-l"
              onDragOver={(e) => allow(e) && setDrop({ pane: i })}
              onDragLeave={() => setDrop(null)}
              onDrop={(e) => dropOn(e, i)}
            />
            <div
              className="lc-dropzone-r"
              onDragOver={(e) => allow(e) && setDrop({ pane: i })}
              onDragLeave={() => setDrop(null)}
              onDrop={(e) => dropOn(e, i)}
            />
          </div>
        ))}
    </aside>
  );
}

/**
  One pane's strip, which is the panel's header (TasteCode v0.5), on the session header's line: the
  apps you pinned first, as icons, then every tab with its name (Changes with its count of files to
  commit, quiet), and the + menu of what isn't open. Hiding the panel and the full canvas are the
  right edge's (Session.tsx), so the strip has no button of its own for either.
*/
function Strip({ i, dock, onDock, meta, dropping, onDragTab, onDragEnd, onDragOver, onDrop, style, label, projectId, files, lead, add }: {
  i: number;
  dock: DockState;
  onDock: (d: DockState) => void;
  meta: (t: Tab) => { label: string; short?: string; icon: (p: { size?: number }) => React.ReactNode; preview?: boolean };
  dropping: boolean;
  onDragTab: (t: Tab) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent, index?: number) => void;
  style: CSSProperties;
  label: string;
  projectId: string;
  files: number;
  lead?: ReactNode;
  add: ReactNode;
}) {
  const p = dock.panes[i];
  const pins = usePins();
  const addons = useEngine((s) => s.addons);
  const pinnedApps = i === 0 ? appsFor(addons, projectId).filter((a) => pins.includes(a.id) && !dock.panes.some((x) => x.tabs.includes(`app:${a.id}`))) : [];
  const row = useRef<HTMLDivElement>(null);
  const [plate, setPlate] = useState<{ x: number; w: number; moved: boolean } | null>(null);
  /** How many tabs are down to their icons, counted from the row's start; the open one keeps its name. */
  const [icons, setIcons] = useState(0);
  const [menu, setMenu] = useState<{ t: Tab; x: number; y: number } | null>(null);
  /** Too many even as icons, the row scrolls: it fades out at an end with tabs beyond it, so a tab cut
      at the edge reads as more to come (surfaces.css). Set on the element, not in state: it follows
      every scroll. */
  const edges = () => {
    const el = row.current;
    if (!el) return;
    el.toggleAttribute("data-fade-l", el.scrollLeft > 1);
    el.toggleAttribute("data-fade-r", el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };
  /** A tab scrolled clear of the fades, whole: the open one as the row is measured, the focused one as the keyboard reaches it (under a fade its ring and icon were faded out). */
  const clear = (tab: HTMLElement) => {
    const el = row.current;
    if (!el) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < el.scrollLeft + 16) el.scrollLeft = left - 16;
    else if (right > el.scrollLeft + el.clientWidth - 16) el.scrollLeft = right - el.clientWidth + 16;
  };
  // One white plate glides to the tab that's up (Liner's rule: one highlight moves between targets).
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const place = () => {
      const tab = el.querySelector<HTMLElement>(".lc-stab[data-on]");
      setPlate((was) => (tab ? { x: tab.offsetLeft, w: tab.offsetWidth, moved: Boolean(was) } : null));
      /*
        Names wherever they fit: as few tabs as it takes go down to their icons, from the row's start,
        and the open one never does. All or none dropped every name for want of a few pixels and left
        the rest of a wide row empty (the owner's screenshot, 2026-11-10); a tab is a whole name or a
        whole icon, never "C" or "Se...". Every width comes from the names themselves, the same in
        either state, so a measure never flips what it measured and the row can't flicker at the edge.
      */
      const strip = el.parentElement;
      if (strip) {
        // The strip's spacer holds what's spare: that's the room, so it isn't counted as taken; nor is
        // what the CSS hides (the session header's start, beside the thread), nor the strip's padding.
        const cs = getComputedStyle(strip);
        const gap = parseFloat(cs.columnGap) || 0;
        const shown = [...strip.children].filter((c) => c === el || c.classList.contains("lc-grow") || c.checkVisibility());
        const room = strip.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - gap * (shown.length - 1) - shown.reduce((n, c) => (c === el || c.classList.contains("lc-grow") ? n : n + c.getBoundingClientRect().width), 0);
        const rowGap = parseFloat(getComputedStyle(el).columnGap) || 0;
        const tabs = [...el.querySelectorAll<HTMLElement>(".lc-stab")].map((t) => {
          const name = t.querySelector<HTMLElement>(".lc-stab-b > span");
          const tag = t.querySelector<HTMLElement>(".lc-stab-tag, .lc-stab-n");
          // surfaces.css: a named tab is 8 + icon 14 + 6 + its name (+ 6 and its tag) + 9; one down to its icon is 8 + 14 + 8 (+ 5 and its count).
          return { on: t.hasAttribute("data-on"), named: Math.min(180, 37 + (name?.scrollWidth ?? 0) + (tag ? tag.offsetWidth + 6 : 0)), icon: 30 + (tag ? tag.offsetWidth + 5 : 0) };
        });
        let need = tabs.reduce((n, t) => n + t.named, 0) + rowGap * Math.max(0, tabs.length - 1);
        let k = 0;
        for (const t of tabs) {
          if (need <= room) break;
          k++;
          if (!t.on) need -= t.named - t.icon;
        }
        setIcons(k);
      }
      // Too many even as icons, the row scrolls: the open tab stays in view, clear of the fades.
      if (tab) clear(tab);
      edges();
    };
    place();
    // Measured again whenever the room or a name can have changed: the strip, each tab, each button
    // beside them (a pinned app, the sidebar's button), a name's text (an add-on's arrives later), and
    // the fonts. A tab down to its icon keeps its size when its name changes, so its size alone can't say.
    const ro = new ResizeObserver(place);
    for (const t of el.querySelectorAll(".lc-stab")) ro.observe(t);
    const strip = el.parentElement;
    if (strip) {
      ro.observe(strip);
      for (const c of strip.children) if (c !== el) ro.observe(c);
    }
    const mo = new MutationObserver(place);
    mo.observe(el, { subtree: true, characterData: true, childList: true });
    document.fonts?.addEventListener("loadingdone", place);
    return () => {
      ro.disconnect();
      mo.disconnect();
      document.fonts?.removeEventListener("loadingdone", place);
    };
  }, [p.tab, p.tabs.join(), files > 0, Boolean(lead), dock.full, pinnedApps.length]);
  // Manual activation, as WAI-ARIA tabs: the arrows, Home and End move between chips; Enter or Space picks one.
  const onKey = (e: ReactKeyboardEvent) => {
    const chips = [...(row.current?.querySelectorAll<HTMLButtonElement>(".lc-stab-b") ?? [])];
    const k = chips.indexOf(document.activeElement as HTMLButtonElement);
    if (k < 0) return;
    const to = e.key === "ArrowRight" ? (k + 1) % chips.length : e.key === "ArrowLeft" ? (k - 1 + chips.length) % chips.length : e.key === "Home" ? 0 : e.key === "End" ? chips.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    chips[to].focus();
  };
  const onFocus = (e: ReactFocusEvent<HTMLElement>) => {
    const tab = e.target.closest<HTMLElement>(".lc-stab");
    if (tab) clear(tab);
  };
  return (
    <div className="lc-panel-top lc-stabs" role="presentation" style={style} data-pane={i} data-drag data-drop={dropping || undefined} onDragOver={onDragOver} onDrop={(e) => onDrop(e)}>
      {lead}
      {pinnedApps.map((a) => {
        const Icon = appIcon(a.panel?.icon);
        return (
          <Tooltip key={a.id} content={`${a.name} · pinned`}>
            <button type="button" className="lc-stab-pin l-focus" aria-label={`${a.name}, pinned`} onClick={() => onDock(openTab(dock, `app:${a.id}`, i))}>
              <Icon size={14} />
            </button>
          </Tooltip>
        );
      })}
      <div ref={row} className="lc-stabs-row" role="tablist" aria-label={label} data-plate={plate ? "" : undefined} onKeyDown={onKey} onScroll={edges} onFocus={onFocus}>
        {plate && <span className="lc-stab-plate" data-moved={plate.moved || undefined} style={{ transform: `translateX(${plate.x}px)`, width: plate.w }} aria-hidden />}
        {p.tabs.map((t, k) => {
          const m = meta(t);
          const Icon = m.icon;
          const on = p.tab === t;
          const count = t === "changes" && files > 0 ? files : 0;
          const name = count ? `${m.label}, ${plural(count, "file")} to commit` : m.label;
          // The guide standing as the dock's only tab has no close (DeepSeek's sole-tab rule).
          const closable = !(t === GUIDE && dock.panes.length === 1 && p.tabs.length === 1);
          return (
            <span
              key={t}
              className="lc-stab"
              data-on={on || undefined}
              data-icon={(!on && k < icons) || undefined}
              data-preview={m.preview || undefined}
              onDragOver={onDragOver}
              onDrop={(e) => {
                e.stopPropagation();
                onDrop(e, k);
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                aria-label={name}
                className="lc-stab-b l-focus"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG, t);
                  e.dataTransfer.effectAllowed = "move";
                  onDragTab(t);
                }}
                onDragEnd={onDragEnd}
                onClick={() => onDock(pickTab(dock, i, t))}
                // A tab down to its icon has no close of its own: a middle click closes it, as in a browser.
                onAuxClick={(e) => closable && e.button === 1 && (e.preventDefault(), onDock(closeTab(dock, t)))}
                onContextMenu={(e) => (e.preventDefault(), setMenu({ t, x: e.clientX, y: e.clientY }))}
                title={on ? name : `${name} · middle-click to close`}
              >
                <Icon size={14} />
                <span>{m.short ?? m.label}</span>
                {m.preview && <small className="lc-stab-tag">Preview</small>}
                {count > 0 && (
                  <small className="lc-stab-n l-num" aria-hidden>
                    {count > 99 ? "99+" : count}
                  </small>
                )}
              </button>
              {closable && (
                <button type="button" className="lc-stab-x l-focus" tabIndex={on ? 0 : -1} aria-label={`Close ${m.label}`} onClick={() => onDock(closeTab(dock, t))}>
                  <I.close size={12} />
                </button>
              )}
            </span>
          );
        })}
      </div>
      {add}
      <span className="lc-grow" data-drag />
      {/* No button of its own hides the panel or takes the full canvas: the right edge's lit icon hides it, and its full-canvas switch is the way back (Session.tsx). */}
      <ContextMenu at={menu} label={menu ? `${meta(menu.t).label}, its tab` : "A tab"} onClose={() => setMenu(null)}>
        {(close) =>
          menu && (
            <>
              {menu.t.startsWith("app:") && (
                <Row
                  title={pins.includes(menu.t.slice(4)) ? "Unpin from the panel" : "Pin to the panel"}
                  note={pins.includes(menu.t.slice(4)) ? undefined : "Its tab stays at the strip's start"}
                  icon={<I.pin size={16} />}
                  onPick={() => (close(), pin(menu.t.slice(4), !pins.includes(menu.t.slice(4))))}
                />
              )}
              {menu.t.startsWith("app:") && <Sep />}
              <Row title="Close" icon={<I.close size={16} />} onPick={() => (close(), onDock(closeTab(dock, menu.t)))} />
              <Row title="Close the others" icon={<I.close size={16} />} disabled={p.tabs.length < 2} onPick={() => (close(), onDock(closeOthers(dock, menu.t)))} />
            </>
          )
        }
      </ContextMenu>
    </div>
  );
}

/** The + menu's order: what the session's header used to offer first, then the rest as the guide lists them. */
const ADD_ORDER: SurfaceId[] = ["session", "terminal", "agents", "design", ...SURFACES.map((s) => s.id).filter((id) => !["session", "terminal", "agents", "design"].includes(id))];

/*
  The strip's +: a menu of what can open here and isn't open (Devin Desktop's, in the app's own
  menu): the surfaces, with their keys (the Terminal opens the bottom panel, as the guide's did:
  Session.tsx, fromPanel), the routine runs that wait for you, your apps, a new one made by the
  agent, and the guide itself, which says what each holds right now. Together that's everything the
  header's ··· and the guide offered before the one-row header.
*/
function AddMenu({ dock, onDock, pane, projectId, agentName, onMake }: { dock: DockState; onDock: (d: DockState) => void; pane: number; projectId: string; agentName: string; onMake: () => void }) {
  const addons = useEngine((s) => s.addons);
  const runs = useEngine((s) => s.runs);
  const shut = (t: Tab) => paneOf(dock, t) < 0;
  const keys = (id: string) => os.keys(shortcutOf(id) ?? []) || undefined;
  const surfaces = ADD_ORDER.filter((id) => id === "terminal" || shut(id)).map((id) => surfaceOf(id)!);
  // Routines switched off (contracts, ROUTINES_ON): no runs offered here.
  const waiting = ROUTINES_ON ? runs.filter((r) => r.status === "handed" && !r.test && shut(`run:${r.id}`)).slice(0, 5) : [];
  const apps = appsFor(addons, projectId).filter((a) => shut(`app:${a.id}`));
  const open = (t: Tab) => onDock(openTab(dock, t, pane));
  return (
    <Pop label="Open a surface" align="start" width={300} menu triggerClass="lc-tb lc-sbar-b" trigger={<I.plus size={16} />}>
      {(close) => (
        <>
          {surfaces.map((s) => (
            <Row key={s.id} title={s.label} note={s.id === "terminal" ? "In the bottom panel" : undefined} icon={<s.icon size={16} />} end={keys(`surface.${s.id}`)} onPick={() => (close(), open(s.id))} />
          ))}
          {waiting.length > 0 && (
            <>
              <Sep />
              <PanelHead>Routine runs that wait for you</PanelHead>
              {waiting.map((r) => (
                <Row key={r.id} title={r.subject ? `Run on #${r.subject.number}` : "A run"} note={r.subject?.title ?? r.cause} icon={<I.routines size={16} />} onPick={() => (close(), open(`run:${r.id}`))} />
              ))}
            </>
          )}
          <Sep />
          <PanelHead>Your apps</PanelHead>
          {apps.map((a) => {
            const Icon = appIcon(a.panel?.icon);
            return <Row key={a.id} title={a.name} icon={<Icon size={16} />} onPick={() => (close(), open(`app:${a.id}`))} />;
          })}
          <Row title="New add-on" note={`Say what you'd like, and ${agentName} makes it`} icon={<I.plus size={16} />} onPick={() => (close(), onMake())} />
          {shut(GUIDE) && (
            <>
              <Sep />
              <Row title="Every surface" note="What each holds right now, and its key" icon={<I.guide size={16} />} onPick={() => (close(), open(GUIDE))} />
            </>
          )}
        </>
      )}
    </Pop>
  );
}


