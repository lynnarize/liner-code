/*
  An open session: its name, which opens its menu (its details, where it works, its branch, rename
  and pin), the crew chip only while two or more agents work, the Reviewer's word (its own menu:
  read each change or not, who reads), then the timeline and the composer, and at the paper's right
  edge the rail of surfaces (Rail, below). The header heads the thread's column only: the dock beside it
  is a full-height column of the paper, its tab row on the header's line (one top row, Panel.tsx),
  with a hairline from the paper's top to its bottom between them that is the resize grip. The full
  canvas gives the dock the whole paper (on the diff, that's the full-width Review).
*/
import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type RefObject, type ReactNode } from "react";
import { isPair, isSwarm, makerOf, reviewOn, type Item, type Project, type ProjectScript, type Thread } from "@contracts";
import { useStickToBottom } from "@liner/pro/agents/agents";
import { toast } from "@liner/components/toast/toast";
import { MarkdownLinks, type FileLink } from "@liner/pro/ai-kit/markdown";
import { prefersReducedMotion } from "@liner/lib/spring";
import { EngineAway, getState, isCheckpoint, isPrompt, loadItems, rpc, useEngine, useItemsWhere } from "./engine";
import { bridge } from "./bridge";
import { Composer, type RunSettings } from "./Composer";
import { AskDock, useDockAsk } from "./Ask";
import { EnvMenu } from "./Env";
import { ShipCard } from "./Ship";
import { I, ModelMark, N, StateMark } from "./icons";
import { agentOf, checkpointsOf, markOf, modelLabel, plural, sumLines, threadModel } from "./model";
import { ModelPicker } from "./Models";
import { myPicks, reviewerFor, savePick } from "./Agentic";
import { Panel } from "./Panel";
import { lazyAgain } from "./early";
import { Boundary } from "./Boundary";
import { FindBar, onComposerInsert, toComposer } from "./Find";
import { revealFile } from "./reveal";
import { onBrowserWanted } from "./agentBrowser";
import { glyphs, is, matches, shortcutOf } from "./keymap";
import { entering, readLook } from "./look";
import { keepDock, keptDock, PANE_MIN, PanelGrip, runScript, surfaceOf, SURFACES, TerminalGrip, useBelowHeight, usePanelWidth, type Tab } from "./Surfaces";
import { useSeen } from "./launch";
import { useReadWhileShown } from "./unread";
import { closeTab, closeWhere, GUIDE, openTab, paneOf, replaceTab, toggleFull, toggleTab, type DockState } from "./dock";
import { AddonView, appIcon, appsFor, isPanelAsk } from "./Addon";
import { onFullCanvas, onOpenSurface, SideKeys, usePins } from "./TopBar";
import { ModeChip } from "./Modes";
import { CrewChip, CrewStrip, LoneStop, pairOf } from "./Crew";
import { LiveLine, Timeline } from "./Timeline";
import { Disc, Kbd, Lines, NamedSwitch, PanelHead, Pop, Row, Sep, ShowSidebar } from "./ui";
import * as os from "./os";

type Props = {
  thread: Thread;
  sidebar: boolean;
  onSidebar: () => void;
  onNewAgent: () => void;
  onOpenSession: (id: string, tab?: Tab) => void;
  onRoutine: (id?: string) => void;
  /** Opens another session beside this one (TasteCode's Open beside). */
  onBeside?: () => void;
  /** Beside another session: its header closes this side, and it keys only while it has focus. */
  onCloseSide?: () => void;
  /** Whether the window's keys are this session's (false for the side you aren't in). */
  keys?: boolean;
  /**
    Opened from the Wall: the way back at the start of the header, where it is among the Wall's
    tiles (`at` of `of`, 0 when it's no longer among them) and the tiles either side. The composer
    waits for a click, so Esc goes back to the Wall; in the composer Esc is the composer's first
    (it stops a turn that's running, else lets go of the field), and the way back's hint says so
    while a turn runs (App.tsx).
  */
  wall?: { at: number; of: number; onBack: () => void; onPrev?: () => void; onNext?: () => void };
};

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
/** Before the timeline has loaded, nothing has been seen. */
const NONE_SEEN = new Set<string>();
/** Where Changes' own width is kept, and what the chat keeps beside it. */
const CHANGES_W = "lc:panel-w-changes";
const CHANGES_CHAT_MIN = 480;
/** How long a shut dock stays while its column closes (the body's shutting transition, app.css). */
const PANEL_EXIT_MS = 400;

/*
  Where you were in each session, while the app runs: opening one again puts you back there,
  and at the end only if you were at the end or its agent is working (T3 Code:
  useTimelinePositionRestore.ts, timelineScrollAnchoring.ts).
*/
const places = new Map<string, { top: number; atEnd: boolean; at?: { id: string; off: number } }>();
/** Which view of each session was up: Chat, or an app's tab beside it. */
const views = new Map<string, string>();
/** An app's tab up for a session that isn't on screen, for when it opens (the Add-ons page's Retry). */
export function showAppTab(threadId: string, addon: string) {
  views.set(threadId, addon);
}
/** Whether each session's bottom panel (its shells and runs) is up, while the app runs. */
const belows = new Map<string, boolean>();
/** The bottom panel up for a session that isn't on screen, for when it opens (⌘K's Open Terminal from Settings). */
export function showBelow(threadId: string) {
  belows.set(threadId, true);
}
const TerminalSurface = lazyAgain(() => import("./Terminal").then((m) => m.TerminalSurface));
/** The install previews that have come up by themselves once, while the app runs. */
const openedPreviews = new Set<string>();

/**
  The session reads only the parts of the timeline it shows (its checkpoints, your messages, its
  subagents, how many items there are), so a streaming reply redraws the timeline and not the
  composer, the header and the rest; the timeline and the panel read the whole of it themselves.
  Memoised: App hands it callbacks that keep one identity, so another session's news (its doing
  line, its status) redraws that session's row and not this one.
*/
export const Session = memo(function Session({ thread, sidebar, onSidebar, onNewAgent, onOpenSession, onRoutine, onBeside, onCloseSide, keys = true, wall }: Props) {
  // Beside another session only the side you're in takes the window's keys.
  const keysOn = useRef(keys);
  keysOn.current = keys;
  // On screen: its folder's launch.json servers stay up, and those stopped while you were away start again.
  useSeen(thread.id);
  const cps = useItemsWhere(thread.id, isCheckpoint);
  const prompts = useItemsWhere(thread.id, isPrompt);
  const count = useEngine((s) => s.items[thread.id]?.length ?? 0);
  // Not fetched yet: a session with history isn't shown as a new one meanwhile.
  const loaded = useEngine((s) => s.items[thread.id] !== undefined);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const project = useEngine((s) => s.projects.find((p) => p.id === thread.projectId));
  const [dock, setDockState] = useState<DockState>(() => keptDock(thread.id));
  const setDock = (d: DockState | ((d: DockState) => DockState)) =>
    setDockState((prev) => {
      const next = typeof d === "function" ? d(prev) : d;
      keepDock(thread.id, next);
      return next;
    });
  // Hidden, the dock stays a moment as it was while its column closes over it, then goes: taken
  // away in the frame it shut, the thread slid over an empty column.
  const [prevDock, setPrevDock] = useState(dock);
  const [leaving, setLeaving] = useState<DockState | null>(null);
  if (prevDock !== dock) {
    setPrevDock(dock);
    setLeaving(prevDock.open && !dock.open && !prefersReducedMotion() ? prevDock : null);
  }
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), PANEL_EXIT_MS);
    return () => clearTimeout(t);
  }, [leaving]);
  // The bottom panel (its shells and runs) is up or not on its own: the right panel stays open or hidden as you left it.
  const [below, setBelowState] = useState(() => belows.get(thread.id) ?? false);
  const setBelow = (v: boolean | ((b: boolean) => boolean)) =>
    setBelowState((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      belows.set(thread.id, next);
      return next;
    });
  /*
    A surface asked for (⌘K, an agent, a key): up in the right panel, but the Terminal comes up in
    the bottom panel and leaves the right panel be. T3 Code keeps its terminal drawer apart from the
    right panel the same way (chat/useChatTerminalActions.ts).
  */
  const bring = (tab: Tab) => (tab === "terminal" ? setBelow(true) : setDock((d) => openTab(d, tab)));
  // The right panel's + (its guide) opens the Terminal below too, with the right panel as it was.
  const fromPanel = (d: DockState) => (paneOf(d, "terminal") >= 0 && paneOf(dock, "terminal") < 0 ? setBelow(true) : setDock(d));
  const [focus, setFocus] = useState<{ id: string; path?: string } | null>(null);
  const [renaming, setRenaming] = useState(false);
  // In the composer's field: the way back from the Wall reads what Esc does there.
  const [writing, setWriting] = useState(false);
  // The panel's width, while you drag its edge and after.
  const body = useRef<HTMLDivElement>(null);
  const [panelW, setPanelW] = usePanelWidth();
  // Changes keeps a width of its own (CHANGES_W), from the body's width: half of it until you drag.
  const [changesW, setChangesW] = usePanelWidth(CHANGES_W);
  const [bodyW, setBodyW] = useState(0);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBodyW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [resizing, setResizing] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const { ref: scroller, contentRef, away, jump, stick, follow } = useStickToBottom();
  // The composer floats over the conversation; the text keeps room under it to scroll clear.
  const threadRef = useRef<HTMLElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const d = foot.current;
    if (!d) return;
    const ro = new ResizeObserver(() => threadRef.current?.style.setProperty("--lc-dock-h", `${d.offsetHeight}px`));
    ro.observe(d);
    return () => ro.disconnect();
  }, []);

  // Opening a session loads its timeline (one already here and kept up is shown as it is); what was there already renders without animating.
  // One that didn't come because the engine is away comes with the reconnect, which fetches it again; one it refused says why, with Try again.
  const [failed, setFailed] = useState<string | null>(null);
  const load = (again = false) => {
    setFailed(null);
    void loadItems(thread.id, again).catch((e: unknown) => !(e instanceof EngineAway) && setFailed(e instanceof Error ? e.message : String(e)));
  };
  useEffect(() => {
    seen.current = null;
    setFocus(null);
    load();
  }, [thread.id]);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const t = window.setTimeout(() => setSlow(true), 400);
    return () => clearTimeout(t);
  }, [loaded]);
  if (seen.current === null && count) seen.current = new Set((getState().items[thread.id] ?? []).map((x) => x.id));

  // Back where you were: once the timeline is there, before it paints. At the end (or working) it follows as before.
  const placed = useRef(false);
  const restoring = useRef<((block?: boolean) => number) | null>(null);
  useLayoutEffect(() => {
    if (placed.current || !count) return;
    placed.current = true;
    const el = scroller.current;
    const was = places.get(thread.id);
    if (!el || !was || was.atEnd || thread.status === "running") return stick();
    // From the block you were at: turns far from the view keep a guessed height until they're near
    // it (surfaces.css, content-visibility), so the same number of pixels lands somewhere else
    // (T3 Code: useTimelinePositionRestore.ts keeps a row and the offset within it too).
    // Deep in a long turn the place can lie past that turn's guess, where it stays undrawn: so the
    // block's own top comes first, which draws the turn, and the frames that follow go the rest of the way.
    const where = (block?: boolean) => {
      const t = was.at ? topOf(el, was.at.id) : null;
      return t === null ? was.top : block ? t : t - was.at!.off;
    };
    el.scrollTop = where(true);
    restoring.current = where;
  }, [count > 0]);
  // The stick-to-bottom hook starts listening in an effect of its own, which has run by now: it lets go here.
  useEffect(() => {
    const el = scroller.current;
    const where = restoring.current;
    if (!el || where === null) return;
    restoring.current = null;
    letGo(el);
    el.scrollTop = where(true);
    // Pictures, code and the turns coming in around it settle a frame later and can move it; it's set again until it holds, or you scroll.
    let n = 0;
    let frame = 0;
    const hold = () => {
      const top = where();
      if (Math.abs(el.scrollTop - top) > 1 && el.scrollHeight - el.clientHeight >= top) el.scrollTop = top;
      if (++n < 6) frame = requestAnimationFrame(hold);
    };
    frame = requestAnimationFrame(hold);
    const stop = () => cancelAnimationFrame(frame);
    el.addEventListener("wheel", stop, { once: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("wheel", stop);
    };
  }, [count > 0]);
  // Scrolling up by the keyboard (F6 puts it on the thread) or by dragging the scrollbar lets go too, not only the wheel.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (!keysOn.current) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "PageUp" || e.key === "ArrowUp" || e.key === "Home" || (e.key === " " && e.shiftKey && e.target === el)) letGo(el);
    };
    // A press on the scroller itself (its scrollbar) that then moves it up.
    let held = false;
    let top = 0;
    const onDown = (e: PointerEvent) => ((held = e.target === el), (top = el.scrollTop));
    const onUp = () => (held = false);
    const onScroll = () => {
      if (held && el.scrollTop < top - 1) (letGo(el), (held = false));
      top = el.scrollTop;
    };
    el.addEventListener("keydown", onKey, { capture: true });
    el.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("keydown", onKey, { capture: true });
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);
  // Remembered as you scroll, so it's there whenever the session closes.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const keep = () => {
      if (!placed.current) return;
      const atEnd = el.scrollHeight - el.clientHeight - el.scrollTop < 30;
      places.set(thread.id, { top: el.scrollTop, atEnd, at: atEnd ? undefined : blockAt(el) });
    };
    el.addEventListener("scroll", keep, { passive: true });
    return () => el.removeEventListener("scroll", keep);
  }, [thread.id]);
  // Read only once you're looking: in the background it stays in Needs you, like the notification says (unread.ts).
  useReadWhileShown(thread.id, thread.unread);

  const coder = agentOf(thread.agent, agents, providers);
  // A pair, by name ("Opus 5.5 + Sol"); null for one model.
  const pair = pairOf(thread, agents, providers);
  // The composer's settings: who leads, the sidekick of a pair, the model, effort and access (the
  // sidekick goes in by a spread, so this compiles before and after the composer's type has it).
  const settings: RunSettings = { agent: thread.agent, model: thread.model, effort: thread.effort ?? coder.effort, access: thread.access, ...(thread.sidekick ? { sidekick: thread.sidekick } : {}), ...(thread.tuning ? { tuning: thread.tuning } : {}) };
  const open = checkpointsOf(cps).filter((c) => !c.reverted && !c.committed);
  const lines = sumLines(open.flatMap((c) => c.files));
  const openFiles = new Set(open.flatMap((c) => c.files.map((f) => f.path))).size;
  const [wtChanges, setWtChanges] = useState(0);
  useEffect(() => {
    if (!project?.git || openFiles > 0) return void setWtChanges(0);
    let live = true;
    void rpc("git.status", { projectId: project.id, threadId: thread.id })
      .then((st) => live && setWtChanges(st.changes.length))
      .catch(() => live && setWtChanges(0));
    return () => {
      live = false;
    };
  }, [project?.id, project?.git, thread.id, thread.turns, openFiles]);
  const busy = thread.status === "running";

  // One identity for the session's life, so the timeline's turns don't redraw for a new one each time.
  const review = useCallback((id: string, path?: string) => {
    setFocus({ id, path });
    setDockState((prev) => {
      const next = openTab(prev, "changes");
      keepDock(thread.id, next);
      return next;
    });
  }, [thread.id]);

  // "Open it" on an app made from an offer: in the dock, or as a tab beside Chat (a page is App.tsx's).
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; place: string; threadId?: string }>).detail;
      if (d.threadId && d.threadId !== thread.id) return;
      if (d.place === "tab") setView(d.id);
      else if (d.place === "dock") setDock((x) => openTab(x, `app:${d.id}`));
    };
    window.addEventListener("lc:open-app", on);
    return () => window.removeEventListener("lc:open-app", on);
  }, [thread.id]);

  // ⌘K's "Open Browser" and the like reach this session's dock (its Terminal, the bottom panel).
  useEffect(() => onOpenSurface(thread.id, bring), [thread.id]);
  // The full canvas, for a surface's own menu (Changes') to give it the paper and take it back.
  const dockNow = useRef(dock);
  dockNow.current = dock;
  useEffect(() => onFullCanvas(thread.id, { toggle: () => setDock(toggleFull), full: () => dockNow.current.open && dockNow.current.full }), [thread.id]);
  // Something put in the composer from an app's tab ("Ask … to fix it", composer.put): back to Chat, where it is.
  useEffect(() => onComposerInsert(thread.id, () => setView("chat")), [thread.id]);

  // A panel an agent asks to add comes up in the dock as a preview; once added, a dock panel is
  // itself in the same place (a tab or a page has its own), and a no (or a turn that ended) takes
  // the preview away.
  const panelAsks = useItemsWhere(thread.id, isPanelAsk) as Extract<Item, { kind: "approval" }>[];
  const addons = useEngine((s) => s.addons);
  // Apps placed as a tab beside Chat (DeepSeek Harness's session tab): each mounts the first time
  // you pick it and keeps running while you're back on Chat.
  const tabApps = appsFor(addons, thread.projectId).filter((a) => a.panel?.place === "tab");
  const [view, setViewState] = useState(() => views.get(thread.id) ?? "chat");
  const [seenViews, setSeenViews] = useState(() => new Set([view]));
  const setView = (v: string) => {
    views.set(thread.id, v);
    setViewState(v);
    setSeenViews((s) => (s.has(v) ? s : new Set(s).add(v)));
  };
  useEffect(() => {
    if (view !== "chat" && !tabApps.some((a) => a.id === view)) setView("chat");
  }, [view, tabApps.map((a) => a.id).join()]);
  // Chat again, or an app's tab: what it holds shows as it is at Quick motion (look.ts, entering).
  useLayoutEffect(() => entering(threadRef.current), [view]);
  useEffect(() => {
    // Each preview comes up once by itself; closed, it stays closed (its card opens it again), even after you've been to another session.
    const fresh = panelAsks.filter((a) => a.state === "asking" && !openedPreviews.has(`preview:${a.id}`)).map((a) => `preview:${a.id}`);
    for (const t of fresh) openedPreviews.add(t);
    setDock((d) => {
      let next = d;
      for (const a of panelAsks) {
        const tab = `preview:${a.id}`;
        if (a.state === "asking") {
          if (fresh.includes(tab) && paneOf(next, tab) < 0) next = openTab(next, tab);
        } else if (paneOf(next, tab) >= 0) next = a.state === "approved" && a.addon?.kind === "panel" && a.addon.place === "dock" ? replaceTab(next, tab, `app:${a.addon.id}`) : closeTab(next, tab);
      }
      // An add-on you removed takes its tabs with it; one only off stays, to say so.
      next = closeWhere(next, (t) => t.startsWith("app:") && Boolean(addons.find((x) => x.id === t.slice(4))?.removed));
      return next === d ? d : next;
    });
  }, [panelAsks, addons]);

  // A path in an answer or a terminal ("src/a.ts:42") brings up this session's Files, which opens the
  // file at its line (Files.tsx); one that names no session goes to the side of Open beside you're
  // in. A web address opens in the browser you use.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ path?: unknown; line?: unknown; threadId?: unknown } | undefined>).detail;
      if (d?.threadId ? d.threadId !== thread.id : !keysOn.current) return;
      if (revealFile(thread.id, d)) setDock((x) => openTab(x, "files"));
    };
    window.addEventListener("lc:open-file", onOpen);
    return () => window.removeEventListener("lc:open-file", onOpen);
  }, [thread.id]);
  const links = useMemo(
    () => ({
      openExternal: (href: string) => bridge.openExternal(href),
      openFile: (f: FileLink) => window.dispatchEvent(new CustomEvent("lc:open-file", { detail: { path: f.path, line: f.line, threadId: thread.id } })),
    }),
    [thread.id],
  );
  // The Terminal lives in the bottom panel (bring and fromPanel send it there); a layout kept from
  // before, with it in the right panel, moves it down too.
  useEffect(() => {
    if (paneOf(dock, "terminal") < 0) return;
    setDock((d) => closeTab(d, "terminal"));
    setBelow(true);
  }, [dock]);
  // ⌘F finds in the thread (Review has its own, over the diff). It counts, so ⌘F with the bar open takes you back to its field.
  const [finding, setFinding] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!keysOn.current || e.defaultPrevented) return;
      if (!is(e, "find")) return;
      // Focus inside the side panel (Review) or bottom terminal keeps its own ⌘F find bar.
      if (e.target instanceof Element && e.target.closest(".lc-panel, .lc-below")) return;
      // The panel over the whole paper (Review has its own find), or the window too narrow for both,
      // or an app's tab: the chat isn't showing, and a bar opened over it couldn't be seen.
      if (view !== "chat" || (threadRef.current && getComputedStyle(threadRef.current).pointerEvents === "none")) return;
      e.preventDefault();
      setFinding((n) => n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dock, view]);

  // Select part of an answer and Cite puts it in the composer as a quote. Only an answer of this
  // session's: beside another, a selection over there is that one's to cite (T3 Code reads only its
  // own viewport's: chat/AssistantSelectionToolbar.tsx).
  const [cite, setCite] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const onUp = () =>
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? "";
        const node = sel?.anchorNode?.parentElement;
        if (!text || !sel?.rangeCount || !node?.closest(".lc-tl .lc-md") || !scroller.current?.contains(node)) return setCite(null);
        const r = sel.getRangeAt(0).getBoundingClientRect();
        // Kept in the window, for a selection that runs past its edge (T3 Code: chat/AssistantSelectionToolbar.tsx).
        setCite({ text, x: Math.min(Math.max(r.left + r.width / 2, 90), window.innerWidth - 90), y: Math.max(r.top, 48) });
      });
    // The button sits where the selection was; once the timeline moves or the selection goes, it's in the wrong place.
    // Only a scroll that moves the selection: a terminal or a panel printing beside it leaves it be.
    const onScroll = (e: Event) => {
      const at = window.getSelection()?.anchorNode;
      if (!at || (e.target instanceof Node && e.target.contains(at))) setCite(null);
    };
    const onSel = () => {
      if (window.getSelection()?.isCollapsed ?? true) setCite(null);
    };
    document.addEventListener("mouseup", onUp);
    // In capture, as the thread's own scroller's scroll doesn't bubble.
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("selectionchange", onSel);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("selectionchange", onSel);
    };
  }, []);

  // A project script with keys of its own runs from them, in a Terminal tab of its own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A dialog (⌘K, a confirm) has the keyboard: a script's keys wait, as ⌘1 to ⌘9 do (App.tsx).
      if (!keysOn.current || document.querySelector("dialog[open]")) return;
      const x = (project?.scripts ?? []).find((s) => s.key && matches(e, s.key));
      if (!x) return;
      // Ahead of everything else, so a script's keys beat a command on the same ones.
      e.preventDefault();
      e.stopPropagation();
      runScript(thread.id, x);
      setBelow(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [thread.id, JSON.stringify(project?.scripts ?? [])]);

  // An agent that wants the Browser brings it up beside the session.
  useEffect(() => onBrowserWanted(thread.id, () => setDock((d) => openTab(d, "browser"))), [thread.id]);

  // A design to look at (the timeline's Open) brings the Design surface up. One an agent just
  // showed does too, when designs open beside the chat and you let the panel come up on its own,
  // unless you're working in another surface (the diff, a terminal): then its card on the
  // timeline opens it when you want. Shown in the chat, it stays there.
  useEffect(() => {
    const onDesign = (e: Event) => {
      const d = (e as CustomEvent<{ threadId?: string; auto?: boolean }>).detail;
      if (d?.threadId !== thread.id) return;
      const look = readLook();
      if (d.auto && (look.designs === "chat" || !look.designsAuto)) return;
      setDock((k) => (d.auto && k.open && !k.panes.some((p) => ["session", "agents", "browser", "design", "guide"].includes(p.tab)) ? k : openTab(k, "design")));
    };
    window.addEventListener("lc:open-design", onDesign);
    return () => window.removeEventListener("lc:open-design", onDesign);
  }, [thread.id]);

  // A surface's key (⌘⇧ and its letter, unless you changed it) is its button in the bar, while the
  // session is open: up if it isn't showing, the panel away if it is (dock.ts, toggleTab, as T3 Code's
  // rightPanelStore.ts toggles). Beside another session it's the side you're in that takes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!keysOn.current) return;
      const s = SURFACES.find((x) => is(e, `surface.${x.id}`));
      if (!s) return;
      e.preventDefault();
      // The Terminal's key shows the bottom panel, and hides it when it's up, as its button's tip says.
      if (s.id === "terminal") setBelow((b) => !b);
      // Held down, a key repeats: one press is one change, not a panel that flickers.
      else if (!e.repeat) setDock((d) => toggleTab(d, s.id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const send = async (m: { text: string; files: { name: string; data: string }[]; mode: "queue" | "steer"; once?: string }) => {
    try {
      const tw = !thread.sideOf && !thread.security ? /^\/(teamwork|swarm)(?:\s+([\s\S]*))?$/i.exec(m.text.trim()) : null;
      if (tw) {
        const wantMode = tw[1].toLowerCase() === "swarm" ? "swarm" : "teamwork";
        if (!isSwarm(thread) || (thread.swarm?.mode ?? "teamwork") !== wantMode) await rpc("swarm.enable", { threadId: thread.id, enabled: true, mode: wantMode });
        setDock((d) => openTab(d, "agents"));
        const body = (tw[2] ?? "").trim();
        if (!body && !m.files.length) return;
        await rpc("thread.send", { id: thread.id, text: body, files: m.files, mode: m.mode, ...(m.once ? { once: m.once } : {}) });
        stick();
        return;
      }
      await rpc("thread.send", { id: thread.id, text: m.text, files: m.files, mode: m.mode, ...(m.once ? { once: m.once } : {}) });
      stick();
    } catch (e) {
      fail(e);
      // Thrown on, so the composer puts the message back.
      throw e;
    }
  };
  const update = (patch: Partial<RunSettings>) => {
    const p: Parameters<typeof rpc<"thread.update">>[1] = { id: thread.id };
    if ("agent" in patch) p.agent = patch.agent;
    // One model again is no sidekick (null), a pair its sidekick's model.
    if ("sidekick" in patch) p.sidekick = (patch as { sidekick?: string | null }).sidekick ?? null;
    // Picking who works clears the session's own model (one a usage limit moved it to): undefined would leave it.
    if ("model" in patch) p.model = patch.model ?? null;
    if ("effort" in patch) p.effort = patch.effort;
    if ("access" in patch) p.access = patch.access;
    // A pair's own ways: none left is automatic again (null).
    if ("tuning" in patch) p.tuning = patch.tuning ?? null;
    void rpc("thread.update", p).catch(fail);
  };

  // The dock beside the thread, rather than over the whole paper.
  const beside = dock.open && !dock.full;
  /*
    Beside the thread, Changes shows at its own width: the one you dragged it to, else half the body,
    never leaving the chat under CHANGES_CHAT_MIN. A window too narrow for that has the usual width.
    The grip, while Changes shows, moves and keeps Changes' width; while another surface shows, the usual one.
    Two panes show the panel 1.6 times the kept width (dock.css), so the kept width is worked out in those terms.
  */
  const paneK = dock.panes.length > 1 ? 1.6 : 1;
  const changesFit = bodyW > 0 ? Math.floor(Math.min(changesW ?? bodyW / 2 / paneK, (bodyW - CHANGES_CHAT_MIN) / paneK)) : 0;
  const changesOwn = beside && dock.panes[dock.at]?.tab === "changes" && changesFit >= PANE_MIN;
  const widthNow = changesOwn ? changesFit : panelW;
  /*
    Going between Changes and another surface with the panel open, the width changes at once, as a drag of the grip does
    (no glide of the thread across the paper). Set in the render that changes the width, so the attribute and the width
    land in one commit: set from an effect, a style read in between (the panel's strip measures its tabs) could start the
    glide first. It comes off two frames later.
  */
  const [shownOwn, setShownOwn] = useState({ own: changesOwn, beside });
  const [snap, setSnap] = useState(false);
  if (shownOwn.own !== changesOwn || shownOwn.beside !== beside) {
    setShownOwn({ own: changesOwn, beside });
    if (shownOwn.own !== changesOwn && shownOwn.beside && beside) setSnap(true);
  }
  useEffect(() => {
    if (!snap) return;
    let f = requestAnimationFrame(() => (f = requestAnimationFrame(() => setSnap(false))));
    return () => cancelAnimationFrame(f);
  }, [snap]);
  // A pair is spoken to through its lead, which hands its sidekick the work.
  const placeholder = `Ask ${pair?.lead ?? coder.name} for changes, or point at a file with @`;
  // An ask waiting on you sits at the composer, over the rest of the tray's head (Ask.tsx).
  const asking = useDockAsk(thread, pair?.lead ?? coder.name);
  const empty = loaded && count === 0;

  // ⌥↑ and ⌥↓ go to the prompt before or after the one you're reading (in the composer, only while it's empty).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!keysOn.current) return;
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      const t = e.target instanceof Element ? e.target : null;
      // The Terminal's field is always empty, and ⌥ and an arrow mean something to the shell.
      if (t?.closest("input, select, [contenteditable=''], [contenteditable='true'], .xterm") || (t instanceof HTMLTextAreaElement && t.value)) return;
      const el = scroller.current;
      if (!el || !prompts.length) return;
      e.preventDefault();
      // The nearest prompt that going to would move the view up, or down; past the last one is the latest answer.
      const tops = prompts.map((p) => (topOf(el, p.id) ?? 0) - PROMPT_PAD);
      const down = e.key === "ArrowDown";
      const below = el.scrollTop < el.scrollHeight - el.clientHeight - 2;
      const i = down ? (below ? tops.findIndex((t) => t > el.scrollTop + 2) : -1) : tops.findLastIndex((t) => t < el.scrollTop - 2);
      if (i >= 0) toPrompt(el, prompts[i].id);
      else if (down) jump();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prompts, jump]);

  const [belowH, setBelowH] = useBelowHeight();
  // When the session is too narrow for thread + panel side by side (<= 786px), opening the bottom terminal yields the side panel instead of letting .lc-thread + .lc-below collapse to 0px.
  useEffect(() => {
    if (!below || !dock.open) return;
    const w = body.current?.clientWidth ?? 0;
    if (w > 0 && w <= 786) setDock((d) => ({ ...d, open: false }));
  }, [below]);

  return (
    <MarkdownLinks.Provider value={links}>
    <SideKeys.Provider value={keys}>
    <div
      className="lc-session"
      data-panel={dock.open || undefined}
      data-wide={(dock.open && dock.full) || undefined}
      data-left-wide={leaving?.full || undefined}
      data-panes={dock.open && dock.panes.length > 1 ? 2 : undefined}
      data-beside={beside || undefined}
      data-resizing={resizing || undefined}
      data-snap={snap || undefined}
      style={widthNow ? ({ "--lc-panel-w": `${widthNow}px` } as CSSProperties) : undefined}
    >
      <div ref={body} className="lc-body">
        <section ref={threadRef} className="lc-thread" aria-label="Session" data-below={below || undefined} style={below && belowH ? ({ "--lc-below-h": `${belowH}px` } as CSSProperties) : undefined}>
          <header className="lc-top" data-drag>
            {!sidebar && (
              <ShowSidebar onShow={onSidebar} />
            )}
            {wall && (
              <div className="lc-wallback" role="group" aria-label="The Wall">
                <button type="button" className="lc-wallback-b l-focus" title={busy ? "Back to the Wall (Esc). In the composer, Esc stops the turn first" : "Back to the Wall (Esc)"} onClick={wall.onBack}>
                  <I.chevL size={14} />
                  The Wall
                  {/* Not while you write in the composer and a turn runs: there Esc stops it. */}
                  {!(writing && busy) && <Kbd>Esc</Kbd>}
                </button>
                {wall.at > 0 && (
                  <>
                    <span className="lc-wallback-n l-num">
                      {wall.at} of {wall.of}
                    </span>
                    <button type="button" className="lc-tb l-focus" aria-label="The tile before it on the Wall" title="The tile before it" disabled={!wall.onPrev} onClick={wall.onPrev}>
                      <I.chevU size={14} />
                    </button>
                    <button type="button" className="lc-tb l-focus" aria-label="The tile after it on the Wall" title="The tile after it" disabled={!wall.onNext} onClick={wall.onNext}>
                      <I.chevD size={14} />
                    </button>
                  </>
                )}
                <span className="lc-sbar-sep" aria-hidden />
              </div>
            )}
            {renaming ? (
              <input
                className="lc-title-edit"
                defaultValue={thread.title}
                aria-label="Session name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(false);
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== thread.title) void rpc("thread.update", { id: thread.id, title: v }).catch(fail);
                  setRenaming(false);
                }}
              />
            ) : project ? (
              // The title is the menu's button, as Claude Code's is: where it works, its branch, rename, pin.
              <>
                <h1 className="l-sr-only">{thread.title}</h1>
                <EnvMenu
                  thread={thread}
                  project={project}
                  files={openFiles}
                  lines={lines}
                  onRename={() => setRenaming(true)}
                  onChanges={() => setDock((d) => openTab(d, "changes"))}
                  actions={(close) => (
                    <>
                      {/* The Session surface, here since it left the right edge (and in its + menu). */}
                      <Row title="Session details" icon={<I.details size={16} />} onPick={() => (close(), setDock((d) => openTab(d, "session")))} />
                      {!thread.sideOf && !thread.security &&
                        (isSwarm(thread) ? (
                          <Row
                            title={(thread.swarm?.mode ?? "teamwork") === "swarm" ? "Swarm panel" : "Teamwork panel"}
                            icon={<I.agents size={16} />}
                            onPick={() => (close(), setDock((d) => openTab(d, "agents")))}
                          />
                        ) : (
                          <>
                            <Row
                              title="Start Teamwork"
                              icon={<I.agents size={16} />}
                              onPick={() => {
                                close();
                                void rpc("swarm.enable", { threadId: thread.id, enabled: true, mode: "teamwork" }).catch(fail);
                                setDock((d) => openTab(d, "agents"));
                              }}
                            />
                            <Row
                              title="Start Swarm"
                              icon={<I.agents size={16} />}
                              onPick={() => {
                                close();
                                void rpc("swarm.enable", { threadId: thread.id, enabled: true, mode: "swarm" }).catch(fail);
                                setDock((d) => openTab(d, "agents"));
                              }}
                            />
                          </>
                        ))}
                      <Row title="Rename" icon={<I.edit size={16} />} onPick={() => (close(), setRenaming(true))} />
                      <Row title={thread.pinned ? "Unpin" : "Pin"} icon={<I.pin size={16} />} onPick={() => (close(), void rpc("thread.update", { id: thread.id, pinned: !thread.pinned }).catch(fail))} />
                      {onBeside && <Row title="Open another session beside it" icon={<I.split size={16} />} onPick={() => (close(), onBeside())} />}
                      <Sep />
                    </>
                  )}
                />
              </>
            ) : (
              <h1 className="lc-title" key={thread.title} onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
                {thread.title}
              </h1>
            )}
            <ModeChip thread={thread} />
            <CrewChip thread={thread} />
            {tabApps.length > 0 && (
              <div className="lc-views" role="tablist" aria-label="Session views">
                {[{ id: "chat", name: "Chat", Icon: I.comment }, ...tabApps.map((a) => ({ id: a.id, name: a.name, Icon: appIcon(a.panel?.icon) }))].map((v) => (
                  <button key={v.id} type="button" role="tab" className="lc-view-b l-focus" aria-selected={view === v.id} onClick={() => setView(v.id)}>
                    <v.Icon size={14} />
                    <span>{v.name}</span>
                  </button>
                ))}
              </div>
            )}
            <span className="lc-grow" data-drag />
            <ReviewerSwitch thread={thread} />
            {onCloseSide && (
              <button type="button" className="lc-tb l-focus" aria-label="Close this side" title="Close this side" onClick={onCloseSide}>
                <I.close size={14} />
              </button>
            )}
          </header>
          <div className="lc-stage" hidden={view !== "chat"}>
            <div ref={scroller} className="lc-scroll">
              <div ref={contentRef} className="lc-scroll-in">
                {empty ? (
                  <div className="lc-fresh">
                    <Disc agent={coder} size={34} />
                    <b>A new session with {pair?.name ?? coder.name}</b>
                    <span>{pair ? `${pair.lead} leads and hands ${pair.side} the work it can spell out. ` : ""}Say what you need below. Anything that needs you will wait here as a card.</span>
                  </div>
                ) : !loaded && failed ? (
                  <div className="lc-tl-wait" role="alert">
                    <b>Couldn't open this session</b>
                    <span>{failed}</span>
                    <button type="button" className="lc-btn l-focus" data-kind="ghost" data-size="sm" onClick={() => load(true)}>
                      Try again
                    </button>
                  </div>
                ) : !loaded ? (
                  // Still coming: a word only after a moment, so a quick open shows nothing in between.
                  <div className="lc-tl-wait" role="status">
                    {slow && <span className="l-shimmer">Opening the session</span>}
                  </div>
                ) : (
                  <Timeline threadId={thread.id} docked seen={seen.current ?? NONE_SEEN} onReview={review} reviewing={dock.open && dock.panes.some((p) => p.tab === "changes") ? focus : null} onGrow={follow} />
                )}
                <ShipCard thread={thread} />
              </div>
            </div>
            <PromptMap prompts={prompts} scroller={scroller} />
          </div>
          <Announcer status={thread.status} turns={thread.turns} who={pair?.lead ?? coder.name} held={thread.held} />
          {finding > 0 && view === "chat" && <FindBar root={contentRef} asked={finding} onClose={() => setFinding(0)} onMove={() => scroller.current && letGo(scroller.current)} />}
          {cite && (
            <button
              type="button"
              className="lc-cite l-glass l-focus"
              style={{ left: cite.x, top: cite.y }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                toComposer(thread.id, `${cite.text.split("\n").map((l) => `> ${l}`).join("\n")}\n\n`);
                window.getSelection()?.removeAllRanges();
                setCite(null);
              }}
            >
              <I.comment size={12} />
              Cite in composer
            </button>
          )}
          {tabApps.map((a) =>
            seenViews.has(a.id) ? (
              <div key={a.id} className="lc-apptab" role="tabpanel" aria-label={a.name} hidden={view !== a.id}>
                <AddonView addon={a.id} thread={thread} agentName={pair?.lead ?? coder.name} visible={view === a.id} />
              </div>
            ) : null,
          )}
          <div ref={foot} className="lc-thread-foot" hidden={view !== "chat"}>
            {away && (
              <button type="button" className="lc-jump l-glass l-focus" onClick={jump}>
                <I.chevD size={14} />
                Latest
              </button>
            )}
            {/* A working turn's one live line, the last thing in the chat's column, over the tray and what heads it. */}
            {loaded && <LiveLine threadId={thread.id} end={<LoneStop thread={thread} />} />}
            {thread.goal?.status === "active" && (
              <div className="lc-goal" role="status">
                <span className="lc-goal-k">Goal</span>
                <span className="lc-goal-t" title={thread.goal.text}>
                  {thread.goal.text}
                </span>
                <span className="lc-quiet lc-goal-n">
                  turn {thread.goal.turns} of {thread.goal.max}
                </span>
                <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => void rpc("thread.send", { id: thread.id, text: "/goal stop" }).catch(fail)}>
                  Stop the goal
                </button>
              </div>
            )}
            {project && (
              <div className="lc-compose" onFocus={(e) => setWriting(e.target instanceof HTMLTextAreaElement)} onBlur={() => setWriting(false)}>
                <Composer
                  variant="session"
                  project={project}
                  thread={thread}
                  settings={settings}
                  onSettings={update}
                  onSend={send}
                  onStop={() => void rpc("thread.stop", { id: thread.id }).catch(fail)}
                  onNewAgent={onNewAgent}
                  busy={busy}
                  placeholder={busy ? `Write while it works: it goes when the turn ends` : placeholder}
                  autoFocus={!wall}
                  ask={asking ?? undefined}
                  // The tray's head: an ask waiting on you, then who the work waits on, over what's waiting
                  // to commit (the row that stays sits next to the card, so the one that comes and goes doesn't move it).
                  // While Changes is the surface showing, its own foot has Commit, so the row steps aside.
                  top={
                    <>
                      {asking && <AskDock dock={asking} />}
                      <CrewStrip thread={thread} />
                      {(openFiles > 0 || wtChanges > 0) && !(dock.open && dock.panes[dock.at]?.tab === "changes") && <ToCommit files={openFiles || wtChanges} lines={openFiles > 0 ? lines : { added: 0, removed: 0 }} onView={() => setDock((d) => openTab(d, "changes"))} />}
                    </>
                  }
                />
              </div>
            )}
          </div>
          {below && (
            <div ref={entering} className="lc-below" role="region" aria-label="Bottom panel">
              <TerminalGrip thread={threadRef} height={belowH} onHeight={setBelowH} onDrag={setResizing} />
              <Boundary label="Terminal" quiet>
                <Suspense fallback={null}>
                  <TerminalSurface thread={thread} visible below lead={project && <ScriptsPick project={project} onRun={(x) => (runScript(thread.id, x), setBelow(true))} />} />
                </Suspense>
              </Boundary>
            </div>
          )}
        </section>
        {beside && (changesOwn ? <PanelGrip key="changes" body={body} width={widthNow} onWidth={setChangesW} onDrag={setResizing} store={CHANGES_W} threadMin={CHANGES_CHAT_MIN} /> : <PanelGrip key="usual" body={body} width={panelW} onWidth={setPanelW} onDrag={setResizing} />)}
        {(dock.open || leaving) && (
          <SessionPanel
            thread={thread}
            dock={dock.open ? dock : leaving!}
            onDock={fromPanel}
            focus={focus}
            onFocus={setFocus}
            agentName={pair?.lead ?? coder.name}
            onOpenSession={onOpenSession}
            onRoutine={onRoutine}
            leaving={!dock.open}
            files={openFiles}
            lead={
              // Over the whole paper (the full canvas, or a session too narrow for both) the panel's row is
              // the paper's header, so what starts the session's header starts it too (dock.css shows it only then).
              (!sidebar || onCloseSide) && (
                <span className="lc-stabs-lead">
                  {!sidebar && (
                    <ShowSidebar onShow={onSidebar} />
                  )}
                  {onCloseSide && (
                    <button type="button" className="lc-tb l-focus" aria-label="Close this side" title="Close this side" onClick={onCloseSide}>
                      <I.close size={14} />
                    </button>
                  )}
                </span>
              )
            }
          />
        )}
      </div>
      <Rail thread={thread} dock={dock} below={below} changed={openFiles} onTab={(id) => setDock((d) => toggleTab(d, id))} onOpen={(id) => setDock((d) => openTab(d, id))} onBelow={() => setBelow(!below)} onAdd={() => setDock((d) => openTab(d, GUIDE))} onFull={() => setDock(toggleFull)} />
    </div>
    </SideKeys.Provider>
    </MarkdownLinks.Provider>
  );
});

/*
  The rail: the session's surfaces as a column of icons at the paper's right edge, centred top to
  bottom, there whether the panel is open or shut (0.2.7; they were a row of tabs over the panel).
  Four: Changes, Files, Browser and the Terminal, then a +. Pressing one shows it in the panel, and
  pressing the lit one puts the panel away, so there is no Show or Hide of its own. The Terminal's
  opens the bottom panel, where the shells live. The + is a menu of the rest (Session, Design,
  Agents, the other surfaces, your apps, Every surface, and while the panel is up the full canvas);
  a surface from it that's showing stands lit above the +, so there is always a lit icon to press
  to hide the panel. Changes' count is in its name only: the tray's head says what waits.
*/
type RailIcon = (p: { size?: number }) => ReactNode;
const RAIL: { id: Tab; label: string; icon: RailIcon }[] = [
  { id: "changes", label: "Changes", icon: N.changes },
  { id: "files", label: "Files", icon: N.folder },
  { id: "browser", label: "Browser", icon: N.globe },
  { id: "terminal", label: "Terminal", icon: N.terminal },
];
/** The + menu's surfaces: what the edge had before (Session, Design, Agents), then the rest the panel's + offers, in the guide's order. */
const RAIL_MORE: Tab[] = ["session", "design", "agents", ...SURFACES.map((s) => s.id).filter((id) => !["session", "design", "agents", ...RAIL.map((r) => r.id)].includes(id))];
/** The 20px icon a surface from the + shows with while it's up, so every icon on the edge has one weight; an app or a preview takes the app's, the guide the Wall's grid. */
const N_OF: Partial<Record<string, RailIcon>> = { session: N.session, design: N.design, agents: N.agents, side: N.comment, pr: N.pr, linked: N.link, device: N.device, routines: N.routines, [GUIDE]: N.wall };
function Rail({ thread, dock, below, changed, onTab, onOpen, onBelow, onAdd, onFull }: { thread: Thread; dock: DockState; below: boolean; changed: number; onTab: (id: Tab) => void; onOpen: (id: Tab) => void; onBelow: () => void; onAdd: () => void; onFull: () => void }) {
  const addons = useEngine((s) => s.addons);
  const pins = usePins();
  const up = (id: Tab) => (id === "terminal" ? below : dock.open && dock.panes.some((p) => p.tab === id));
  // Your apps for this project, the pinned ones first.
  const apps = appsFor(addons, thread.projectId).sort((a, b) => Number(pins.includes(b.id)) - Number(pins.includes(a.id)));
  // What the panel shows that isn't one of the four: lit above the +, its press hides the panel.
  const showing = dock.open ? dock.panes[dock.at]?.tab : undefined;
  const fifth = showing && !RAIL.some((r) => r.id === showing) ? showing : undefined;
  const fifthName = !fifth ? "" : fifth === GUIDE ? "Every surface" : fifth.startsWith("app:") ? (addons.find((a) => a.id === fifth.slice(4))?.name ?? "An app") : fifth.startsWith("preview:") ? "A preview" : (surfaceOf(fifth)?.label ?? "A surface");
  const FifthIcon: RailIcon = (fifth && N_OF[fifth]) || N.app;
  const keys = (id: string) => os.keys(shortcutOf(id) ?? []) || undefined;
  // Not a drag region: the window moves by the top bar. The rail runs the paper's height, and its gaps would move the window, or zoom it at a double click.
  return (
    <nav className="lc-rail" aria-label="Surfaces">
      {RAIL.map((x) => {
        const on = up(x.id);
        const name = x.id === "changes" && changed ? `Changes, ${plural(changed, "file")} to commit` : x.label;
        return (
          <button key={x.id} type="button" className="lc-ib lc-rail-b l-focus" aria-label={on && x.id !== "terminal" ? `${name}: showing. Press to hide the panel` : name} title={on ? (x.id === "terminal" ? "Hide the bottom panel" : "Hide the panel") : x.label} aria-pressed={on} onClick={() => (x.id === "terminal" ? onBelow() : onTab(x.id))}>
            <x.icon />
          </button>
        );
      })}
      {fifth && (
        <button type="button" className="lc-ib lc-rail-b l-focus" aria-label={`${fifthName}: showing. Press to hide the panel`} title="Hide the panel" aria-pressed onClick={() => onTab(fifth)}>
          <FifthIcon size={20} />
        </button>
      )}
      <Pop label="More surfaces: Session, Design, Agents and your apps" menu side="left" width={250} triggerClass="lc-ib lc-rail-b" trigger={<N.plus />}>
        {(close) => (
          <>
            {RAIL_MORE.map((id) => {
              const s = surfaceOf(id);
              if (!s) return null;
              return <Row key={id} title={s.label} icon={<s.icon size={16} />} on={up(id) || undefined} keepIcon end={keys(`surface.${id}`)} onPick={() => (close(), onOpen(id))} />;
            })}
            {apps.length > 0 && (
              <>
                <Sep />
                <PanelHead>Your apps</PanelHead>
                {apps.map((a) => {
                  const Icon = appIcon(a.panel?.icon);
                  return <Row key={a.id} title={a.name} icon={<Icon size={16} />} on={up(`app:${a.id}`) || undefined} keepIcon onPick={() => (close(), onOpen(`app:${a.id}`))} />;
                })}
              </>
            )}
            <Sep />
            <Row title="Every surface" note="What each holds right now, and its key" icon={<I.guide size={16} />} onPick={() => (close(), onAdd())} />
            {/* Every surface reaches the full canvas from here (Changes has it in its own menu too). */}
            {dock.open && <Row title={dock.full ? "Leave the full canvas" : "Open in the full canvas"} icon={dock.full ? <I.shrink size={14} /> : <I.expand size={14} />} onPick={() => (close(), onFull())} />}
          </>
        )}
      </Pop>
    </nav>
  );
}

/**
  What's waiting to commit, as a row of the composer tray's head, so it stays in sight with the
  panel closed (the rail's dot said it before). Its words open the Changes surface, and Commit, the
  one filled button, does too. The session leaves it out while Changes shows: Changes' foot commits.
*/
function ToCommit({ files, lines, onView }: { files: number; lines: { added: number; removed: number }; onView: () => void }) {
  return (
    <div className="lc-trow">
      <I.changes size={16} />
      <button type="button" className="lc-trow-t lc-trow-open l-focus" aria-label={`${plural(files, "file")} to commit. Open Changes`} onClick={onView}>
        {plural(files, "file")} to commit
      </button>
      <Lines {...lines} />
      <span className="lc-grow" />
      <button type="button" className="lc-btn lc-trow-commit l-focus" data-kind="ink" onClick={onView}>
        Commit
      </button>
    </div>
  );
}

/** The dock: each of its surfaces reads only the part of the timeline it shows (Panel.tsx), so a reply's words don't redraw it. */
function SessionPanel(props: ComponentProps<typeof Panel>) {
  return <Panel {...props} />;
}

/** useStickToBottom lets go when you scroll up; a scroll of nothing upward tells it so when the session moves you itself. */
const letGo = (el: HTMLElement) => el.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
/** Room above a prompt the session scrolls to. */
const PROMPT_PAD = 16;
/** Where a block of the timeline starts, in the scroller's own coordinates. */
function topOf(el: HTMLElement, id: string) {
  const b = el.querySelector<HTMLElement>(`[data-item="${CSS.escape(id)}"]`);
  return b ? b.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop : null;
}
/** The block at the top of the view, and how far above the view's top it starts. */
function blockAt(el: HTMLElement) {
  const blocks = el.querySelectorAll<HTMLElement>("[data-item]");
  const top = el.getBoundingClientRect().top;
  let lo = 0;
  let hi = blocks.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (blocks[m].getBoundingClientRect().bottom > top) hi = m;
    else lo = m + 1;
  }
  const b = blocks[lo];
  return b ? { id: b.dataset.item!, off: b.getBoundingClientRect().top - top } : undefined;
}
/**
  The prompt you're reading under: the last one that starts at the top of the view or above it,
  or, scrolled to the end where the last prompts can't reach the top, in its upper part. -1 above the first.
*/
function promptAt(el: HTMLElement, prompts: Item[]) {
  const end = el.scrollHeight - el.clientHeight - el.scrollTop < 4;
  const line = el.scrollTop + (end ? el.clientHeight * 0.6 : PROMPT_PAD + 24);
  const zero = el.getBoundingClientRect().top - el.scrollTop;
  let at = -1;
  prompts.forEach((p, i) => {
    const b = el.querySelector<HTMLElement>(`[data-item="${CSS.escape(p.id)}"]`);
    if (!b) return;
    // A turn far from the view skips its layout (surfaces.css, content-visibility), and measuring a
    // block inside it lays the turn out again, every frame of a scroll. The turn's own box answers
    // whenever the line is outside it; only the turn the line crosses, which is drawn, is measured inside.
    const turn = b.closest(".lc-turn")?.getBoundingClientRect();
    if (turn && turn.bottom - zero <= line) at = i;
    else if (!turn || turn.top - zero <= line) {
      if (b.getBoundingClientRect().top - zero <= line) at = i;
    }
  });
  return at;
}
function toPrompt(el: HTMLElement, id: string) {
  const t = topOf(el, id);
  if (t === null) return;
  letGo(el);
  el.scrollTo({ top: Math.max(0, t - PROMPT_PAD), behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

/*
  Your prompts as a column of ticks at the thread's left edge, one each, the one you're reading
  under drawn darker: point at one to read it, press it to go there (T3 Code: TimelineMinimap.tsx,
  timelineMinimapItems.ts). Fewer than three prompts need no map.
*/
function PromptMap({ prompts, scroller }: { prompts: Item[]; scroller: RefObject<HTMLDivElement | null> }) {
  const [at, setAt] = useState(-1);
  const [hover, setHover] = useState<number | null>(null);
  const many = prompts.length >= 3;
  useEffect(() => {
    const el = scroller.current;
    if (!el || !many) return;
    let frame = 0;
    const look = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setAt(promptAt(el, prompts)));
    };
    look();
    el.addEventListener("scroll", look, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", look);
    };
  }, [prompts, many]);
  if (!many) return null;
  const shown = hover !== null ? prompts[hover] : null;
  const text = shown?.kind === "user" ? shown.text.replace(/\s+/g, " ").trim() : "";
  return (
    <nav className="lc-pmap" aria-label="Your prompts" style={{ "--n": prompts.length } as CSSProperties} onMouseLeave={() => setHover(null)}>
      {prompts.map((p, i) => (
        <button
          key={p.id}
          type="button"
          className="lc-pmap-tick l-focus"
          data-at={i === at || undefined}
          data-near={hover !== null && Math.abs(i - hover) === 1 ? true : undefined}
          data-hover={i === hover || undefined}
          aria-label={`Prompt ${i + 1}: ${p.kind === "user" ? p.text.slice(0, 80) : ""}`}
          aria-current={i === at ? "location" : undefined}
          onMouseEnter={() => setHover(i)}
          onFocus={() => setHover(i)}
          onBlur={() => setHover(null)}
          onClick={() => scroller.current && toPrompt(scroller.current, p.id)}
        />
      ))}
      {shown && (
        <span className="lc-pmap-tip l-glass" style={{ "--i": hover } as CSSProperties} aria-hidden>
          <small className="l-num">Prompt {(hover ?? 0) + 1}</small>
          {text.length > 160 ? `${text.slice(0, 159)}…` : text || "A message with files"}
        </span>
      )}
    </nav>
  );
}

/*
  Says out loud, once, when the agent finishes, needs you or runs into a problem: a polite live
  region VoiceOver reads without moving you (T3 Code: ThreadActivityAnnouncer.tsx, useLiveRegion.ts).
  It's written straight to the page, so speaking redraws nothing, and cleared after a while so it
  isn't read again when focus comes back.
*/
function Announcer({ status, turns, who, held }: { status: Thread["status"]; turns: number; who: string; held?: Thread["held"] }) {
  const region = useRef<HTMLDivElement>(null);
  const was = useRef({ status, turns });
  const clear = useRef(0);
  useEffect(() => {
    const before = was.current;
    was.current = { status, turns };
    const el = region.current;
    if ((before.status === status && before.turns === turns) || !el) return;
    // A short turn can start and end between two looks (a window out of sight looks less often): a new turn that ended counts too.
    const ran = before.status === "running" || turns > before.turns;
    const text =
      status === "waiting" && held !== "review" ? `${who} needs you` : status === "error" ? `${who} ran into a problem` : status === "limited" ? `${who} hit its usage limit` : ran && (status === "idle" || status === "done") ? `${who} finished` : null;
    if (!text) return;
    window.clearTimeout(clear.current);
    // The same words twice count as new with a space after them.
    el.textContent = el.textContent === text ? `${text}\u00a0` : text;
    clear.current = window.setTimeout(() => (el.textContent = ""), 7000);
  }, [status, turns, who]);
  useEffect(() => () => window.clearTimeout(clear.current), []);
  // No role="status": a live region alone is read the same, without being taken for a status bar.
  return <div ref={region} className="l-sr-only" aria-live="polite" />;
}

/**
  The Reviewer in the bar: its last word on this session's changes (Reading, Passed, Blocked, the
  words a turn's last line uses) as quiet text in its colour, with the working mark while it reads
  and its shield after, else "Reviewer", or "Reviewer off" when it doesn't read here; it stays in
  sight either way. Pressed, its own menu: read each change or not, for this session
  (thread.update's review), who reads (your pick for every session, or Automatic), what it does,
  and the way to its settings. Its findings stay on each turn's last line.
*/
function ReviewerSwitch({ thread }: { thread: Thread }) {
  const settings = useEngine((s) => s.settings);
  const on = reviewOn(thread, settings);
  const v = thread.verdict;
  const state = v?.state === "checking" ? "checking" : !on ? "off" : v?.state;
  const word = state === "checking" ? "Reading" : state === "verified" ? "Passed" : state === "blocked" ? "Blocked" : state === "off" ? "Reviewer off" : "Reviewer";
  const tip = state === "checking" ? "The Reviewer is reading the changes" : state === "off" ? "The Reviewer doesn't read this session's changes" : v?.note && state ? v.note : "The Reviewer reads each change before it's yours";
  return (
    <Pop
      // Its name carries the word in sight (Verified, Reviewer off), which a bare "Reviewer" would hide.
      label={state === "off" ? "Reviewer off. Change it" : `Reviewer: ${word === "Reviewer" ? "on" : word.toLowerCase()}. Change it`}
      align="end"
      width={330}
      className="lc-rvw-pop"
      triggerClass="lc-verdict lc-rvw"
      triggerAttrs={{ "data-state": state, title: tip }}
      trigger={
        <>
          {/* Reading, the Reviewer is a thing at work: the state mark. Its verdict is a fact, in words beside its shield. */}
          {state === "checking" ? <StateMark state="working" size={14} /> : state !== "off" && <I.shield size={14} />}
          <span key={state ?? "on"}>{word}</span>
          <I.chevD size={12} />
        </>
      }
    >
      {() => <ReviewerMenu thread={thread} on={on} />}
    </Pop>
  );
}

function ReviewerMenu({ thread, on }: { thread: Thread; on: boolean }) {
  const settings = useEngine((s) => s.settings);
  const providers = useEngine((s) => s.providers);
  const agents = useEngine((s) => s.agents);
  const [choosing, setChoosing] = useState(false);
  const who = useRef<HTMLButtonElement>(null);
  const pickList = useRef<HTMLDivElement>(null);
  // The list opening takes the focus in, as the composer's Lead list does: to Automatic while it's the choice, else to the models' search.
  useEffect(() => {
    if (!choosing) return;
    const box = pickList.current;
    (mine ? box?.querySelector<HTMLElement>(".lc-mp-find input") : box?.querySelector<HTMLElement>(".lc-row"))?.focus({ preventScroll: true });
  }, [choosing]);
  // The list closing takes the focus it had back to Who reads (a pick unmounts the row that had it).
  const shut = () => (setChoosing(false), requestAnimationFrame(() => who.current?.focus({ preventScroll: true })));
  const picks = myPicks(settings);
  // The lead writes the change, and in a pair its sidekick too: the Reviewer is chosen against both, the lead first.
  const lead = threadModel(thread, agents, providers);
  const writers = lead ? [lead, ...(isPair(thread) ? [thread.sidekick!] : [])] : [];
  const now = writers.length ? reviewerFor(writers, providers, picks) : null;
  const auto = writers.length ? reviewerFor(writers, providers, picks, true) : null;
  const mine = picks.checker && now === picks.checker ? picks.checker : undefined;
  const label = (ref: string) => modelLabel(ref, providers);
  const pick = (ref: string | undefined) => (savePick(settings, "checker", ref), shut());
  return (
    <div className="lc-rvm">
      <PanelHead>Reviewer</PanelHead>
      <div className="lc-rvm-row">
        <span>Read each change</span>
        <NamedSwitch name="Read each change" checked={on} onCheckedChange={(review) => void rpc("thread.update", { id: thread.id, review }).catch(fail)} />
      </div>
      {on && (
        <div className="lc-rvm-row">
          <span className="lc-rvm-k" title="Sets the default Reviewer model used for all new and existing sessions">Default reviewer</span>
          <button ref={who} type="button" className="lc-rvm-who l-focus" aria-expanded={choosing} aria-label={`Default reviewer for new sessions: ${now ? (mine ? label(now) : `Automatic, ${label(now)}`) : "nobody ready"}. Change it`} onClick={() => setChoosing(!choosing)}>
            {now && <ModelMark kind={markOf(now)} size={12} />}
            <span>{now ? (mine ? label(now) : `Automatic: ${label(now)}`) : "Nobody ready"}</span>
            <I.chevD size={12} />
          </button>
        </div>
      )}
      {on && choosing && (
        // Escape closes this list first, then the menu (Pop).
        <div
          ref={pickList}
          className="lc-rvm-pick"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !e.defaultPrevented) (e.preventDefault(), shut());
          }}
        >
          {/* Automatic is a row over the short list, in the one panel, as the who panel has Fusion there. */}
          <ModelPicker value={mine} height={360} onPick={(ref) => pick(ref)} first={<Row title="Automatic" rove note={auto ? (lead && makerOf(auto) === makerOf(lead) ? `${label(auto)} now: nothing of another maker is ready` : `${label(auto)} now: another maker than the lead's`) : "Nobody else is ready"} end={auto ? label(auto) : "None ready"} on={!mine} onPick={() => pick(undefined)} />} />
        </div>
      )}
      <p className="lc-rvm-note">
        {on && !now
          ? "Nobody else is ready to read changes yet: sign in to another tool, or pick one here."
          : on
          ? `${now && lead && makerOf(now) === makerOf(lead) ? label(now) : "Another maker than the lead's"} reads each change before it's yours, and sends back what must be fixed.${settings.reviewSmall ? "" : " A few lines, or docs alone, go through."}`
          : "Changes are yours as they are."}
      </p>
      <div className="lc-rvm-foot">
        <button type="button" className="lc-rvm-link l-focus" onClick={() => window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "agentic" }))}>
          Reviewer settings
        </button>
      </div>
    </div>
  );
}

/** The project's scripts, each a press away; a new one can come straight from package.json. */
function ScriptsPick({ project, onRun }: { project: Project; onRun: (s: { name: string; command: string }) => void }) {
  const [npm, setNpm] = useState<string[] | null>(null);
  const scripts = project.scripts ?? [];
  const add = (name: string) => void rpc("project.update", { id: project.id, scripts: [...scripts, { id: `s${Date.now().toString(36)}`, name, command: `npm run ${name}` }] }).catch((e) => toast.error(String(e?.message ?? e)));
  return (
    <Pop
      label="Run a script"
      align="end"
      width={300}
      triggerClass="lc-ib lc-terms-run"
      trigger={
        <>
          <I.play size={12} />
          Run
        </>
      }
    >
      {(close) => (
        <ScriptsMenu
          scripts={scripts}
          npm={npm}
          onOpen={() => {
            // A statement, not `npm === null && …`: an effect's return is its clean-up, and `false` isn't one.
            if (npm === null) void rpc("git.branches", { projectId: project.id }).then((r) => setNpm(r.npmScripts)).catch(() => setNpm([]));
          }}
          onRun={(x) => (close(), onRun(x))}
          onAdd={add}
        />
      )}
    </Pop>
  );
}
function ScriptsMenu({ scripts, npm, onOpen, onRun, onAdd }: { scripts: ProjectScript[]; npm: string[] | null; onOpen: () => void; onRun: (s: ProjectScript) => void; onAdd: (name: string) => void }) {
  useEffect(onOpen, []);
  const fresh = (npm ?? []).filter((n) => !scripts.some((x) => x.command === `npm run ${n}`));
  return (
    <>
      <PanelHead>Run in the Terminal</PanelHead>
      {scripts.map((x) => (
        <Row key={x.id} title={x.name} note={x.command} icon={<I.play size={16} />} end={x.key ? <span className="lc-st-keys">{glyphs(x.key).map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span> : undefined} onPick={() => onRun(x)} />
      ))}
      {scripts.length === 0 && <p className="lc-quiet lc-pop-note">No scripts yet. Add one from package.json, or in Settings, Projects.</p>}
      {fresh.length > 0 && (
        <>
          <Sep />
          <PanelHead>From package.json</PanelHead>
          {fresh.slice(0, 6).map((n) => (
            <Row key={n} title={`npm run ${n}`} note="Add it as a script" icon={<I.plus size={16} />} onPick={() => onAdd(n)} />
          ))}
        </>
      )}
    </>
  );
}
