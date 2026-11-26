/*
  The right panel beside the session: a flush column of the paper, one hairline down its left edge
  (the resize grip is on it), showing one surface at a time (dock.ts has the rules; SPEC rule 2, board
  Main, 2026-11-25). There is no strip of tabs: the session header's icon row picks the surface
  (Switcher.tsx), and each surface's own head (Pane.tsx PaneHead), on the session header's row, says
  its name and carries Full canvas and Close. In the full canvas the panel takes the paper under the
  session header, which stays in view with its icon row.
  Every surface you open is mounted once and kept while the panel holds it, so going to another
  never reloads a page or restarts a shell.
  Changes is the diff, kept by turn (Review.tsx, the same in the panel and the full canvas).
  Agents says who worked in this session, on what, and how much of the budget they used.
*/
import { memo, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Item, type Thread } from "@contracts";
import { Boundary } from "./Boundary";
import { closeTab, hideDock, openTab, toggleFull, type DockState } from "./dock";
import { useEngine, useItemsWhere } from "./engine";
import { AddonView, isPanelAsk } from "./Addon";
import { AgentsSurface } from "./Crew";
import { BrowserSurface } from "./Browser";
import { DesignSurface } from "./Design";
import { PrSurface } from "./Pr";
import { SideChat } from "./SideChat";
import { surfaceOf, type Tab } from "./Surfaces";
import { PaneFrame } from "./Pane";
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
/** The Session card's inside (Switcher.tsx, from Session.tsx): what it reads of the timeline, as the surfaces here read theirs. */
export const SessionTab = memo(function SessionTab({ thread, visible, onShowChange }: { thread: Thread; visible: boolean; onShowChange: (path: string) => void }) {
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
}) {
  const runs = useEngine((s) => s.runs);
  const addons = useEngine((s) => s.addons);
  // Panel reads no timeline of its own but the add-on asks a preview names: a reply's words don't redraw the panel.
  const asks = useItemsWhere(thread.id, isPanelAsk) as Extract<Item, { kind: "approval" }>[];
  useEffect(preload, []);
  /** A surface's name, for its head: a built-in one's, a run's, an add-on's, or a preview's. */
  const nameOf = (t: Tab) => {
    if (t.startsWith("run:")) {
      const r = runs.find((x) => x.id === t.slice(4));
      return r?.subject ? `Run on #${r.subject.number}` : "A run";
    }
    if (t.startsWith("app:")) return addons.find((x) => x.id === t.slice(4))?.name ?? "An add-on";
    if (t.startsWith("preview:")) return asks.find((x) => x.id === t.slice(8))?.addon?.name ?? "A preview";
    return surfaceOf(t)?.label ?? t;
  };
  // Only surfaces you've opened mount; once mounted they stay while the panel holds them.
  const shown = dock.panes[dock.at]?.tab;
  const all = [...new Set(dock.panes.flatMap((p) => p.tabs))];
  const [mounted, setMounted] = useState<Set<Tab>>(() => new Set(shown ? [shown] : []));
  useEffect(() => {
    setMounted((m) => (!shown || m.has(shown) ? m : new Set([...m, shown])));
  }, [shown]);
  useEffect(() => setMounted((m) => new Set([...m].filter((t) => all.includes(t)))), [all.join()]);
  // A surface you go to, or the panel you open, shows what it holds as it is at Quick motion (look.ts,
  // entering); the panel itself still fades in (200ms). Each surface's box stays mounted, so the ones that were
  // showing are known by their element. One opened for the first time gets its box a render later,
  // once it is in mounted, so that change is watched too.
  const box = useRef<HTMLElement>(null);
  const showing = useRef(new WeakSet<Element>());
  useLayoutEffect(() => {
    const now = new WeakSet<Element>();
    for (const el of box.current?.querySelectorAll(":scope > .lc-surface:not([hidden])") ?? []) {
      now.add(el);
      if (!showing.current.has(el)) entering(el);
    }
    showing.current = now;
  }, [shown, mounted]);
  const open = (t: Tab) => onDock(openTab(dock, t));
  const wideReview = dock.full && shown === "changes";
  // The same function each render, so a memoised surface doesn't redraw for a new one.
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
    // Session is a popup now (Switcher.tsx); a layout that still held it is put right before it gets here (dock.ts dropPopups).
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
    // Linked pull requests went into Pull request's picker (pr-pick.ts): its key opens that, and a layout kept with it comes back as Pull request (Session.tsx).
    if (t === "pr") return <PrSurface thread={thread} agentName={agentName} visible={visible} onOpenSession={(id) => onOpenSession(id)} />;
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

  return (
    <aside ref={box} className="lc-panel" aria-label="Panel" data-tab={shown} data-wide-review={wideReview || undefined} data-leaving={leaving || undefined} inert={leaving || undefined}>
      {all.map((t) => {
        if (!mounted.has(t)) return null;
        const visible = t === shown;
        return (
          <div key={t} className="lc-surface" hidden={!visible} role="region" aria-label={nameOf(t)}>
            {/* The frame is outside the boundary: a surface that breaks says so in its own place, and its head still closes the panel. */}
            {/* Close puts the surface away as well as the panel (its lit icon only hides the panel), so a page, a Device or an add-on doesn't stay open unseen; its icon or its card opens it again. */}
            <PaneFrame name={nameOf(t)} full={dock.full} onFull={() => onDock(toggleFull(dock))} onClose={() => onDock(hideDock(closeTab(dock, t)))}>
              <Boundary label={nameOf(t)} quiet>
                {body(t, visible && dock.open)}
              </Boundary>
            </PaneFrame>
          </div>
        );
      })}
    </aside>
  );
}
