/*
  The right dock beside the session: a full-height column of the paper, one pane, its strip of tabs
  over the surface that's up (dock.ts has the rules; DeepSeek Harness's ui-dockkit and
  ui-sidebar-right were the model). The strip is the panel's header, on the session header's line
  (one top row, as Devin Desktop draws it: docs/research/devin-desktop.md). A chip drags to another
  place in the strip. The + is a menu of what isn't open; the strip ends with the full-canvas switch
  and the button that hides the panel, where the session's header shows it when it's shut. The full
  canvas on Changes is the full-width Review, under the same strip (its shrink button is the way back). (0.2.1 had a second pane; dock.ts's readDock folds a
  layout it kept into the one.)
  Every surface you open is mounted once and kept while it's open, so moving its tab never
  reloads a page or restarts a shell.
  Changes is the diff, kept by turn: the turn picker sits in the diff's strip, the file you
  pressed in the thread scrolls into view, and the foot says how many files you've looked at,
  with Undo for the turn and Commit for everything that's left.
  Agents says who worked in this session, on what, and how much of the budget they used.
*/
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ROUTINES_ON, type FileDiff, type Item, type Thread } from "@contracts";
import { CodeDiff } from "@liner/pro/code-diff/code-diff";
import { prefersReducedMotion } from "@liner/lib/spring";
import { toast } from "@liner/components/toast/toast";
import { Tooltip } from "@liner/components/tooltip/tooltip";
import { Boundary } from "./Boundary";
import { CommitButton } from "./Commit";
import { closeOthers, closeTab, GUIDE, hideDock, moveTab, openTab, paneOf, pickTab, toggleFull, type DockState } from "./dock";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { checkpointsOf, plural } from "./model";
import { ContextMenu, PanelHead, Pop, Row, Sep } from "./ui";
import { AddonView, appIcon, appsFor, isPanelAsk } from "./Addon";
import { AgentsSurface } from "./Crew";
import { pin, usePins } from "./TopBar";
import { shortcutOf } from "./keymap";
import * as os from "./os";
import { BrowserSurface } from "./Browser";
import { DesignSurface } from "./Design";
import { DeviceSurface } from "./Device";
import { FilesSurface } from "./Files";
import { toComposer } from "./Find";
import { LinkedSurface, PrSurface } from "./Pr";
import { MoreFiles, Review, TurnPicker, Viewed } from "./Review";
import { RoutinesList, RunDetail } from "./Routines";
import { ship } from "./Ship";
import { SideChat } from "./SideChat";
import { Guide, SURFACES, surfaceOf, type SurfaceId, type Tab } from "./Surfaces";
import { undoTurn } from "./undo";
import { entering } from "./look";
import "./dock.css";
// The terminal brings xterm.js; it loads the first time you open one.
const TerminalSurface = lazy(() => import("./Terminal").then((m) => ({ default: m.TerminalSurface })));
const SessionSurface = lazy(() => import("./SessionInfo").then((m) => ({ default: m.SessionSurface })));

/** A chip on its way between panes. */
const DRAG = "application/x-liner-tab";
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

export function Panel({
  thread,
  items,
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
  items: Item[];
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
  const asks = useMemo(() => items.filter(isPanelAsk) as Extract<Item, { kind: "approval" }>[], [items]);
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

  const body = (t: Tab, visible: boolean) => {
    if (t === "changes") return wideReview ? <Review thread={thread} items={items} focus={focus} onFocus={onFocus} /> : <Changes thread={thread} items={items} focus={focus} onFocus={onFocus} />;
    if (t === "agents") return <AgentsSurface thread={thread} items={items} />;
    if (t === "session")
      return (
        <Suspense fallback={null}>
          <SessionSurface thread={thread} items={items} visible={visible} onShowChange={(path) => (onFocus({ id: "all", path }), open("changes"))} />
        </Suspense>
      );
    if (t === "terminal")
      return (
        <Suspense fallback={<div className="lc-diff-wait"><span className="l-shimmer">Opening a terminal</span></div>}>
          <TerminalSurface thread={thread} visible={visible} />
        </Suspense>
      );
    if (t === "side") return <SideChat thread={thread} visible={visible} />;
    if (t === "browser") return <BrowserSurface thread={thread} agentName={agentName} hidden={!visible} />;
    if (t === "design") return <DesignSurface thread={thread} items={items} agentName={agentName} visible={visible} />;
    if (t === "files") return <FilesSurface thread={thread} items={items} onShowChanges={(id, path) => (onFocus({ id, path }), open("changes"))} />;
    if (t === "pr") return <PrSurface thread={thread} agentName={agentName} visible={visible} />;
    if (t === "linked") return <LinkedSurface thread={thread} agentName={agentName} onOpenSession={(id) => onOpenSession(id)} />;
    if (t === "device") return <DeviceSurface thread={thread} agentName={agentName} visible={visible} />;
    if (t === "routines") return <RoutinesList projectId={thread.projectId} compact onNew={() => onRoutine()} onEdit={(id) => onRoutine(id)} onRun={(r) => open(`run:${r.id}`)} />;
    if (t.startsWith("run:")) return <RunDetail runId={t.slice(4)} onOpenSession={(id) => (id === thread.id ? undefined : onOpenSession(id, t))} />;
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
      style={{ "--panes": dock.panes.length } as CSSProperties}
      data-wide-review={wideReview || undefined}
      data-leaving={leaving || undefined}
      data-dragging={dragging ? true : undefined}
      inert={leaving || undefined}
    >
      {/* The strip stays the header over the full-width Review too, its shrink button the way back. */}
      {dock.panes.map((_, i) => (
        <Strip
          key={i}
          i={i}
          dock={dock}
          onDock={onDock}
          meta={meta}
          last={i === dock.panes.length - 1}
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
            <Guide thread={thread} items={items} agentName={agentName} panes={dock.panes.length} onOpen={(t) => open(t, i)} onMake={make} />
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
  commit, quiet), the + menu of what isn't open, and in the last pane the full canvas and the
  button that hides the panel, last, where the session's header has the one that shows it.
*/
function Strip({ i, dock, onDock, meta, last, dropping, onDragTab, onDragEnd, onDragOver, onDrop, style, label, projectId, files, lead, add }: {
  i: number;
  dock: DockState;
  onDock: (d: DockState) => void;
  meta: (t: Tab) => { label: string; short?: string; icon: (p: { size?: number }) => React.ReactNode; preview?: boolean };
  last: boolean;
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
                  <I.close size={10} />
                </button>
              )}
            </span>
          );
        })}
      </div>
      {add}
      <span className="lc-grow" data-drag />
      {last && (
        <>
          <Tooltip content={dock.full ? "Leave the full canvas" : "Open in the full canvas"}>
            <button type="button" className="lc-tb lc-sbar-b l-focus" aria-label={dock.full ? "Leave the full canvas" : "Open in the full canvas"} aria-pressed={dock.full} onClick={() => onDock(toggleFull(dock))}>
              {dock.full ? <I.shrink size={16} /> : <I.expand size={16} />}
            </button>
          </Tooltip>
          <Tooltip content="Hide the panel">
            <button type="button" className="lc-tb lc-sbar-b l-focus" data-panel-toggle aria-label="Hide the panel" aria-pressed onClick={() => onDock(hideDock(dock))}>
              <I.dock size={16} />
            </button>
          </Tooltip>
        </>
      )}
      <ContextMenu at={menu} label={menu ? `${meta(menu.t).label}, its tab` : "A tab"} onClose={() => setMenu(null)}>
        {(close) =>
          menu && (
            <>
              {menu.t.startsWith("app:") && (
                <Row
                  title={pins.includes(menu.t.slice(4)) ? "Unpin from the panel" : "Pin to the panel"}
                  note={pins.includes(menu.t.slice(4)) ? undefined : "Its tab stays at the strip's start"}
                  icon={<I.pin size={13} />}
                  onPick={() => (close(), pin(menu.t.slice(4), !pins.includes(menu.t.slice(4))))}
                />
              )}
              {menu.t.startsWith("app:") && <Sep />}
              <Row title="Close" icon={<I.close size={13} />} onPick={() => (close(), onDock(closeTab(dock, menu.t)))} />
              <Row title="Close the others" icon={<I.close size={13} />} disabled={p.tabs.length < 2} onPick={() => (close(), onDock(closeOthers(dock, menu.t)))} />
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
            <Row key={s.id} title={s.label} note={s.id === "terminal" ? "In the bottom panel" : undefined} icon={<s.icon size={14} />} end={keys(`surface.${s.id}`)} onPick={() => (close(), open(s.id))} />
          ))}
          {waiting.length > 0 && (
            <>
              <Sep />
              <PanelHead>Routine runs that wait for you</PanelHead>
              {waiting.map((r) => (
                <Row key={r.id} title={r.subject ? `Run on #${r.subject.number}` : "A run"} note={r.subject?.title ?? r.cause} icon={<I.routines size={14} />} onPick={() => (close(), open(`run:${r.id}`))} />
              ))}
            </>
          )}
          <Sep />
          <PanelHead>Your apps</PanelHead>
          {apps.map((a) => {
            const Icon = appIcon(a.panel?.icon);
            return <Row key={a.id} title={a.name} icon={<Icon size={14} />} onPick={() => (close(), open(`app:${a.id}`))} />;
          })}
          <Row title="New add-on" note={`Say what you'd like, and ${agentName} makes it`} icon={<I.plus size={14} />} onPick={() => (close(), onMake())} />
          {shut(GUIDE) && (
            <>
              <Sep />
              <Row title="Every surface" note="What each holds right now, and its key" icon={<I.guide size={14} />} onPick={() => (close(), open(GUIDE))} />
            </>
          )}
        </>
      )}
    </Pop>
  );
}

/** With nothing to commit, the diff's foot still pushes the branch or opens a pull request. */
function PushButton({ thread, branch }: { thread: Thread; branch?: string }) {
  return (
    <Pop label="Push or open a pull request" side="top" align="end" width={280} triggerClass="lc-btn" disabled={thread.status === "running"} trigger={<><I.push size={14} />Push</>}>
      {(close) => (
        <div className="lc-ship-menu">
          <PanelHead>Nothing to commit</PanelHead>
          <Row title={`Push ${branch ?? "this branch"}`} note="To its branch on GitHub" icon={<I.push size={13} />} onPick={() => (close(), void ship(thread, null))} />
          <Row title="Open a pull request" note="The PR card, in the chat" icon={<I.pr size={13} />} onPick={() => (close(), void rpc("thread.send", { id: thread.id, text: "create pr" }).catch(fail))} />
        </div>
      )}
    </Pop>
  );
}
function Changes({ thread, items, focus, onFocus }: { thread: Thread; items: Item[]; focus: { id: string; path?: string } | null; onFocus: (f: { id: string; path?: string } | null) => void }) {
  const branch = useEngine((s) => thread.worktree?.branch ?? s.projects.find((p) => p.id === thread.projectId)?.branch);
  const cps = useMemo(() => checkpointsOf(items), [items]);
  const pick = focus?.id && (focus.id === "all" || focus.id === "branch" || cps.some((c) => c.id === focus.id)) ? focus.id : (cps[cps.length - 1]?.id ?? null);
  const cp = cps.find((c) => c.id === pick);
  const [diff, setDiff] = useState<FileDiff[] | null>(null);
  const [total, setTotal] = useState(0);
  const [view, setView] = useState<"unified" | "split">(() => (localStorage.getItem("lc:view") as "split") ?? "unified");
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"undo" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => localStorage.setItem("lc:view", view), [view]);

  // The diff for the turn in the picker, fetched when it changes.
  const key = `${pick}:${cp?.reverted}:${cp?.committed}:${cps.length}`;
  useEffect(() => {
    if (!pick) return setDiff([]);
    let live = true;
    setDiff(null);
    void rpc("checkpoint.diff", { threadId: thread.id, itemId: pick })
      .then((d) => {
        if (!live) return;
        setDiff(d.files);
        setTotal(d.total);
      })
      .catch((e) => {
        if (!live) return;
        setDiff([]);
        setTotal(0);
        // An empty diff alone would read as a turn that changed nothing.
        fail(e);
      });
    return () => {
      live = false;
    };
  }, [thread.id, key]);

  // The file pressed in the thread scrolls into view and counts as looked at.
  useEffect(() => {
    if (!diff || !focus?.path) return;
    const i = diff.findIndex((f) => f.path === focus.path);
    const el = box.current?.querySelectorAll<HTMLElement>(".l-cdiff__file")[i];
    el?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    setViewed((v) => new Set(v).add(focus.path!));
  }, [diff, focus?.path]);

  const files = pick === "all" || pick === "branch" ? (diff ?? []).map((d) => ({ path: d.path, added: 0, removed: 0 })) : (cp?.files ?? []);
  // Looked at: this turn's files you've opened, not ones from another turn.
  const seen = files.filter((f) => viewed.has(f.path)).length;
  const open = cps.filter((c) => !c.reverted && !c.committed);
  const openFiles = new Set(open.flatMap((c) => c.files.map((f) => f.path))).size;

  const undo = async () => {
    if (!cp) return;
    setBusy("undo");
    try {
      await undoTurn(thread.id, cp);
    } finally {
      setBusy(null);
    }
  };

  if (!cps.length)
    return (
      <div className="lc-panel-empty">
        <I.changes size={20} />
        <b>No changes yet</b>
        <p>When a turn edits files, its changes land here, kept by turn, so you can review, undo or commit them.</p>
      </div>
    );

  const picker = <TurnPicker cps={cps} pick={pick ?? "all"} turns={thread.turns} onPick={(id) => onFocus({ id })} />;

  return (
    <div className="lc-changes-panel">
      <div ref={box} className="lc-diff">
        {diff === null ? (
          <div className="lc-diff-wait">
            <span className="l-shimmer">Reading the changes</span>
          </div>
        ) : (
          <CodeDiff files={diff} title={picker} view={view} onViewChange={setView} maxHeight={4000} />
        )}
      </div>
      {diff && total > diff.length && <MoreFiles n={total - diff.length} turn={Boolean(cp)} pick={pick} />}
      <div className="lc-panel-foot">
        <Viewed seen={seen} total={files.length} />
        <span className="lc-grow" />
        {cp && !cp.reverted && !cp.committed && (
          <button type="button" className="lc-btn" data-kind="ghost" disabled={busy !== null || thread.status === "running"} onClick={() => void undo()}>
            <I.undo size={14} />
            Undo turn {cp.turn}
          </button>
        )}
        {openFiles > 0 ? <CommitButton thread={thread} files={openFiles} disabled={busy !== null || thread.status === "running"} /> : <PushButton thread={thread} branch={branch} />}
      </div>
    </div>
  );
}

