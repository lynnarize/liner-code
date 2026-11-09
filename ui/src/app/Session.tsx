/*
  An open session: its name, which opens its menu (where it works, its branch, rename and pin), the
  Reviewer's word and the panels' row at the top right, the timeline, and the composer. The dock beside it holds the surfaces as tabs, in one or
  two panes; the full canvas gives it the whole paper (on the diff, that's the full-width Review).
*/
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type RefObject } from "react";
import type { Item, Project, ProjectScript, Thread } from "@contracts";
import { useStickToBottom } from "@liner/pro/agents/agents";
import { toast } from "@liner/components/toast/toast";
import { MarkdownLinks, type FileLink } from "@liner/pro/ai-kit/markdown";
import { prefersReducedMotion } from "@liner/lib/spring";
import { getState, isCheckpoint, isPrompt, loadItems, rpc, useEngine, useItems, useItemsWhere } from "./engine";
import { bridge } from "./bridge";
import { Composer, type RunSettings } from "./Composer";
import { EnvMenu } from "./Env";
import { ShipCard } from "./Ship";
import { I } from "./icons";
import { agentOf, checkpointsOf, modeOf, modelLabel, sumLines } from "./model";
import { Panel } from "./Panel";
import { FindBar, onComposerInsert, toComposer } from "./Find";
import { revealFile } from "./Files";
import { onBrowserWanted } from "./agentBrowser";
import { glyphs, is, matches } from "./keymap";
import { readLook } from "./look";
import { keepDock, keptDock, PanelGrip, runScript, SURFACES, usePanelWidth, type Tab } from "./Surfaces";
import { useSeen } from "./launch";
import { closeTab, closeWhere, openTab, paneOf, replaceTab, toggleTab, type DockState } from "./dock";
import { AddonView, appIcon, appsFor, isPanelAsk } from "./Addon";
import { onOpenSurface, SideKeys, TopBar } from "./TopBar";
import { ModeChip } from "./Modes";
import { CrewChip, CrewStrip } from "./Crew";
import { Timeline } from "./Timeline";
import { Disc, Kbd, PanelHead, Pop, Row, Sep } from "./ui";
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
const TerminalSurface = lazy(() => import("./Terminal").then((m) => ({ default: m.TerminalSurface })));
/** The install previews that have come up by themselves once, while the app runs. */
const openedPreviews = new Set<string>();

/**
  The session reads only the parts of the timeline it shows (its checkpoints, your messages, its
  subagents, how many items there are), so a streaming reply redraws the timeline and not the
  composer, the header and the rest; the timeline and the panel read the whole of it themselves.
*/
export function Session({ thread, sidebar, onSidebar, onNewAgent, onOpenSession, onRoutine, onBeside, onCloseSide, keys = true, wall }: Props) {
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

  // Opening a session loads its timeline; what was there already renders without animating.
  useEffect(() => {
    seen.current = null;
    setFocus(null);
    // One that didn't come (the engine restarting) comes with the reconnect, which fetches it again.
    void loadItems(thread.id).catch(() => {});
  }, [thread.id]);
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
  // Read only once you're looking: in the background it stays in Needs you, like the notification says.
  useEffect(() => {
    const clear = () => {
      if (thread.unread && document.hasFocus()) void rpc("thread.update", { id: thread.id, unread: false });
    };
    clear();
    window.addEventListener("focus", clear);
    return () => window.removeEventListener("focus", clear);
  }, [thread.id, thread.unread]);

  const lead = thread.lead ? agentOf(thread.lead, agents, providers) : undefined;
  const coder = agentOf(thread.agent, agents, providers);
  const settings: RunSettings = { agent: thread.agent, lead: thread.lead, route: thread.route?.level, dual: thread.dual, after: thread.after, model: thread.model, effort: thread.effort ?? coder.effort, access: thread.access };
  const open = checkpointsOf(cps).filter((c) => !c.reverted && !c.committed);
  const lines = sumLines(open.flatMap((c) => c.files));
  const openFiles = new Set(open.flatMap((c) => c.files.map((f) => f.path))).size;
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
      if (!keysOn.current) return;
      if (!is(e, "find")) return;
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
      if (!keysOn.current) return;
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

  const send = async (m: { text: string; files: { name: string; data: string }[]; mode: "queue" | "steer" }) => {
    try {
      await rpc("thread.send", { id: thread.id, text: m.text, files: m.files, mode: m.mode });
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
    if ("lead" in patch) p.lead = patch.lead ?? null;
    if ("model" in patch) p.model = patch.model;
    if ("effort" in patch) p.effort = patch.effort;
    if ("access" in patch) p.access = patch.access;
    if ("route" in patch) p.route = patch.route ?? null;
    if ("dual" in patch) p.dual = patch.dual;
    if ("after" in patch) p.after = patch.after ?? null;
    void rpc("thread.update", p).catch(fail);
  };

  // The dock beside the thread, rather than over the whole paper.
  const beside = dock.open && !dock.full;
  // Plan and Auto are one session to you, whoever works in it at the moment; Solo is the model (or agent) you picked.
  const way = modeOf(thread);
  const wayName = way === "auto" ? "Auto" : "Plan, then build";
  const wayNote = way === "auto" && thread.route ? `${modelLabel(thread.route.cast.everyday, providers)} for most, ${modelLabel(thread.route.cast.strong, providers)} for hard jobs` : lead ? `${lead.name} plans the hard jobs, ${coder.name} builds` : "";
  const placeholder = way === "solo" ? `Ask ${coder.name} for changes, or point at a file with @` : "Ask for changes, or point at a file with @";
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

  return (
    <MarkdownLinks.Provider value={links}>
    <SideKeys.Provider value={keys}>
    <div
      className="lc-session"
      data-panel={dock.open || undefined}
      data-wide={(dock.open && dock.full) || undefined}
      data-panes={dock.open && dock.panes.length > 1 ? 2 : undefined}
      data-beside={beside || undefined}
      data-resizing={resizing || undefined}
      style={panelW ? ({ "--lc-panel-w": `${panelW}px` } as CSSProperties) : undefined}
    >
      <header className="lc-top" data-drag>
        {!sidebar && (
          <button type="button" className="lc-tb l-focus" aria-label="Show the sidebar" title={`Show the sidebar (${os.mod}\\)`} onClick={onSidebar}>
            <I.sidebar size={16} />
          </button>
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
                  <Row title="Rename" icon={<I.edit size={13} />} onPick={() => (close(), setRenaming(true))} />
                  <Row title={thread.pinned ? "Unpin" : "Pin"} icon={<I.pin size={13} />} onPick={() => (close(), void rpc("thread.update", { id: thread.id, pinned: !thread.pinned }).catch(fail))} />
                  {onBeside && <Row title="Open another session beside it" icon={<I.split size={13} />} onPick={() => (close(), onBeside())} />}
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
                <v.Icon size={13} />
                <span>{v.name}</span>
              </button>
            ))}
          </div>
        )}
        <span className="lc-grow" data-drag />
        {thread.verdict && <Verdict v={thread.verdict} />}
        {onCloseSide && (
          <button type="button" className="lc-tb l-focus" aria-label="Close this side" title="Close this side" onClick={onCloseSide}>
            <I.close size={14} />
          </button>
        )}
        <TopBar dock={dock} onDock={setDock} below={below} onBelow={() => setBelow(!below)} files={openFiles} lines={lines} projectId={thread.projectId} run={project && <ScriptsPick project={project} onRun={(x) => (runScript(thread.id, x), setBelow(true))} />} />
      </header>
      <div ref={body} className="lc-body">
        <section ref={threadRef} className="lc-thread" aria-label="Session" data-below={below || undefined}>
          <div className="lc-stage" hidden={view !== "chat"}>
            <div ref={scroller} className="lc-scroll">
              <div ref={contentRef} className="lc-scroll-in">
                {empty ? (
                  <div className="lc-fresh">
                    <Disc agent={lead ?? coder} size={34} lead={Boolean(lead) || undefined} />
                    <b>{way === "solo" ? `A new session with ${coder.name}` : `${wayName}: ${wayNote}`}</b>
                    <span>Say what you need below. Anything that needs you will wait here as a card.</span>
                  </div>
                ) : (
                  <Timeline threadId={thread.id} seen={seen.current ?? NONE_SEEN} onReview={review} reviewing={dock.open && dock.panes.some((p) => p.tab === "changes") ? focus : null} onGrow={follow} />
                )}
                <ShipCard thread={thread} />
              </div>
            </div>
            <PromptMap prompts={prompts} scroller={scroller} />
          </div>
          <Announcer status={thread.status} turns={thread.turns} who={(lead && thread.turnBy === lead.id ? lead : coder).name} />
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
                <AddonView addon={a.id} thread={thread} agentName={(lead ?? coder).name} visible={view === a.id} />
              </div>
            ) : null,
          )}
          <div ref={foot} className="lc-thread-foot" hidden={view !== "chat"}>
            {away && (
              <button type="button" className="lc-jump l-glass l-focus" onClick={jump}>
                <I.chevD size={13} />
                Latest
              </button>
            )}
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
                  top={<CrewStrip thread={thread} />}
                />
              </div>
            )}
          </div>
          {below && (
            <div className="lc-below" role="region" aria-label="Bottom panel">
              <Suspense fallback={null}>
                <TerminalSurface thread={thread} visible onHide={() => setBelow(false)} />
              </Suspense>
            </div>
          )}
        </section>
        {beside && <PanelGrip body={body} width={panelW} onWidth={setPanelW} onDrag={setResizing} />}
        {(dock.open || leaving) && <SessionPanel thread={thread} dock={dock.open ? dock : leaving!} onDock={fromPanel} focus={focus} onFocus={setFocus} agentName={(lead ?? coder).name} onOpenSession={onOpenSession} onRoutine={onRoutine} leaving={!dock.open} />}
      </div>
    </div>
    </SideKeys.Provider>
    </MarkdownLinks.Provider>
  );
}

/** The dock's surfaces read the whole timeline (a reply's words too), so the panel subscribes to it on its own. */
function SessionPanel(props: Omit<ComponentProps<typeof Panel>, "items">) {
  const items = useItems(props.thread.id);
  return <Panel {...props} items={items} />;
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
  let at = -1;
  prompts.forEach((p, i) => {
    const t = topOf(el, p.id);
    if (t !== null && t <= line) at = i;
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
function Announcer({ status, turns, who }: { status: Thread["status"]; turns: number; who: string }) {
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
      status === "waiting" ? `${who} needs you` : status === "error" ? `${who} ran into a problem` : status === "limited" ? `${who} hit its usage limit` : ran && (status === "idle" || status === "done") ? `${who} finished` : null;
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

/** The Reviewer's last word on this session's changes, in the bar: quiet text in its colour, no pill. */
function Verdict({ v }: { v: NonNullable<Thread["verdict"]> }) {
  if (v.state === "checking")
    return (
      <span className="lc-verdict" title="The Reviewer is reading the changes">
        <span className="l-shimmer">Reviewing</span>
      </span>
    );
  const ok = v.state === "verified";
  return (
    <span className="lc-verdict" data-state={v.state} title={v.note}>
      <span key={v.state}>
        {ok ? <I.verified size={14} /> : <I.alert size={14} />}
        {ok ? "Verified" : "Blocked"}
      </span>
    </span>
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
      triggerClass="lc-tb lc-sbar-b"
      trigger={<I.play size={16} />}
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
        <Row key={x.id} title={x.name} note={<span className="lc-mono">{x.command}</span>} icon={<I.play size={12} />} end={x.key ? <span className="lc-st-keys">{glyphs(x.key).map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span> : undefined} onPick={() => onRun(x)} />
      ))}
      {scripts.length === 0 && <p className="lc-quiet lc-pop-note">No scripts yet. Add one from package.json, or in Settings, Projects.</p>}
      {fresh.length > 0 && (
        <>
          <Sep />
          <PanelHead>From package.json</PanelHead>
          {fresh.slice(0, 6).map((n) => (
            <Row key={n} title={`npm run ${n}`} note="Add it as a script" icon={<I.plus size={12} />} onPick={() => onAdd(n)} />
          ))}
        </>
      )}
    </>
  );
}
