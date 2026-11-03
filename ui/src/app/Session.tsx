/*
  An open session: its name, who works on it and on which branch, its surfaces' row at the top
  right, the timeline, and the composer. The dock beside it holds the surfaces as tabs, in one or
  two panes; the full canvas gives it the whole paper (on the diff, that's the full-width Review).
*/
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type RefObject } from "react";
import type { Item, Project, ProjectScript, Thread } from "@contracts";
import { useStickToBottom } from "@liner/pro/agents/agents";
import { toast } from "@liner/components/toast/toast";
import { MarkdownLinks, type FileLink } from "@liner/pro/ai-kit/markdown";
import { prefersReducedMotion } from "@liner/lib/spring";
import { getState, isCheckpoint, isPrompt, isSubagent, loadItems, rpc, useEngine, useItems, useItemsWhere } from "./engine";
import { bridge } from "./bridge";
import { Composer, type RunSettings } from "./Composer";
import { EnvMenu } from "./Env";
import { ShipCard } from "./Ship";
import { I, ModelMark } from "./icons";
import { agentOf, checkpointsOf, isModelAgent, markOf, modeOf, modelLabel, sumLines } from "./model";
import { Panel } from "./Panel";
import { FindBar, toComposer } from "./Find";
import { onBrowserWanted } from "./agentBrowser";
import { glyphs, is, matches } from "./keymap";
import { readLook } from "./look";
import { keepDock, keptDock, PanelGrip, runScript, SURFACES, usePanelWidth, type Tab } from "./Surfaces";
import { closeTab, closeWhere, openTab, paneOf, replaceTab, toggleTab, type DockState } from "./dock";
import { isPanelAsk } from "./Addon";
import { onOpenSurface, TopBar } from "./TopBar";
import { Timeline } from "./Timeline";
import { Badge, Disc, Kbd, ModelTag, PanelHead, Pop, Row, Sep } from "./ui";
import * as os from "./os";

type Props = {
  thread: Thread;
  sidebar: boolean;
  onSidebar: () => void;
  onNewAgent: () => void;
  onOpenSession: (id: string, tab?: Tab) => void;
  onRoutine: (id?: string) => void;
};

/** Before the timeline has loaded, nothing has been seen. */
const NONE_SEEN = new Set<string>();
/** How long a shut dock stays while its column closes (the body's shutting transition, app.css). */
const PANEL_EXIT_MS = 400;

/*
  Where you were in each session, while the app runs: opening one again puts you back there,
  and at the end only if you were at the end or its agent is working (T3 Code:
  useTimelinePositionRestore.ts, timelineScrollAnchoring.ts).
*/
const places = new Map<string, { top: number; atEnd: boolean }>();

/**
  The session reads only the parts of the timeline it shows (its checkpoints, your messages, its
  subagents, how many items there are), so a streaming reply redraws the timeline and not the
  composer, the header and the rest; the timeline and the panel read the whole of it themselves.
*/
export function Session({ thread, sidebar, onSidebar, onNewAgent, onOpenSession, onRoutine }: Props) {
  const cps = useItemsWhere(thread.id, isCheckpoint);
  const prompts = useItemsWhere(thread.id, isPrompt);
  const tasks = useItemsWhere(thread.id, isSubagent);
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
  const [focus, setFocus] = useState<{ id: string; path?: string } | null>(null);
  const [renaming, setRenaming] = useState(false);
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
  const restoring = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (placed.current || !count) return;
    placed.current = true;
    const el = scroller.current;
    const was = places.get(thread.id);
    if (!el || !was || was.atEnd || thread.status === "running") return stick();
    el.scrollTop = was.top;
    restoring.current = was.top;
  }, [count > 0]);
  // The stick-to-bottom hook starts listening in an effect of its own, which has run by now: it lets go here.
  useEffect(() => {
    const el = scroller.current;
    const top = restoring.current;
    if (!el || top === null) return;
    restoring.current = null;
    letGo(el);
    el.scrollTop = top;
    // Pictures and code that settle a frame later can move it; it's set again until it holds, or you scroll.
    let n = 0;
    let frame = 0;
    const hold = () => {
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
  // Remembered as you scroll, so it's there whenever the session closes.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const keep = () => {
      if (!placed.current) return;
      places.set(thread.id, { top: el.scrollTop, atEnd: el.scrollHeight - el.clientHeight - el.scrollTop < 30 });
    };
    el.addEventListener("scroll", keep, { passive: true });
    return () => el.removeEventListener("scroll", keep);
  }, [thread.id]);
  useEffect(() => {
    if (thread.unread) void rpc("thread.update", { id: thread.id, unread: false });
  }, [thread.id, thread.unread]);

  const lead = thread.lead ? agentOf(thread.lead, agents, providers) : undefined;
  const coder = agentOf(thread.agent, agents, providers);
  const model = thread.model ?? coder.model;
  const settings: RunSettings = { agent: thread.agent, lead: thread.lead, route: thread.route?.level, dual: thread.dual, after: thread.after, model: thread.model, effort: thread.effort ?? coder.effort, access: thread.access };
  const open = checkpointsOf(cps).filter((c) => !c.reverted && !c.committed);
  const lines = sumLines(open.flatMap((c) => c.files));
  const openFiles = new Set(open.flatMap((c) => c.files.map((f) => f.path))).size;
  const branch = thread.worktree?.branch ?? project?.branch;
  const busy = thread.status === "running";
  const subagents = tasks.length;

  // One identity for the session's life, so the timeline's turns don't redraw for a new one each time.
  const review = useCallback((id: string, path?: string) => {
    setFocus({ id, path });
    setDockState((prev) => {
      const next = openTab(prev, "changes");
      keepDock(thread.id, next);
      return next;
    });
  }, [thread.id]);

  // ⌘K's "Open Browser" and the like reach this session's dock.
  useEffect(() => onOpenSurface(thread.id, (tab) => setDock((d) => openTab(d, tab))), [thread.id]);

  // A panel an agent asks to add comes up in the dock as a preview; once added it's the add-on
  // itself in the same place, and a no (or a turn that ended) takes the preview away.
  const panelAsks = useItemsWhere(thread.id, isPanelAsk) as Extract<Item, { kind: "approval" }>[];
  const addons = useEngine((s) => s.addons);
  const opened = useRef(new Set<string>());
  useEffect(() => {
    // Each preview comes up once by itself; closed, it stays closed (its card opens it again).
    const fresh = panelAsks.filter((a) => a.state === "asking" && !opened.current.has(`preview:${a.id}`)).map((a) => `preview:${a.id}`);
    for (const t of fresh) opened.current.add(t);
    setDock((d) => {
      let next = d;
      for (const a of panelAsks) {
        const tab = `preview:${a.id}`;
        if (a.state === "asking") {
          if (fresh.includes(tab) && paneOf(next, tab) < 0) next = openTab(next, tab);
        } else if (paneOf(next, tab) >= 0) next = a.state === "approved" && a.addon ? replaceTab(next, tab, `app:${a.addon.id}`) : closeTab(next, tab);
      }
      // An add-on you removed takes its tabs with it; one only off stays, to say so.
      next = closeWhere(next, (t) => t.startsWith("app:") && Boolean(addons.find((x) => x.id === t.slice(4))?.removed));
      return next === d ? d : next;
    });
  }, [panelAsks, addons]);

  // A path in an answer ("src/a.ts:42") brings up the Files surface, which takes the same event and
  // opens the file at its line (Files.tsx); a web address opens in the browser you use.
  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<{ path?: string }>).detail?.path) setDock((d) => openTab(d, "files"));
    };
    window.addEventListener("lc:open-file", onOpen);
    return () => window.removeEventListener("lc:open-file", onOpen);
  }, [thread.id]);
  const links = useMemo(
    () => ({
      openExternal: (href: string) => bridge.openExternal(href),
      openFile: (f: FileLink) => window.dispatchEvent(new CustomEvent("lc:open-file", { detail: { path: f.path, line: f.line } })),
    }),
    [],
  );
  const toggle = (tab: Tab) => setDock((d) => toggleTab(d, tab));
  // ⌘F finds in the thread (Review has its own, over the diff). It counts, so ⌘F with the bar open takes you back to its field.
  const [finding, setFinding] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!is(e, "find")) return;
      if (dock.open && dock.full && dock.panes.length === 1 && dock.panes[0].tab === "changes") return;
      e.preventDefault();
      setFinding((n) => n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dock]);

  // Select part of an answer and Cite puts it in the composer as a quote.
  const [cite, setCite] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const onUp = () =>
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? "";
        const node = sel?.anchorNode?.parentElement;
        if (!text || !sel?.rangeCount || !node?.closest(".lc-tl .lc-md")) return setCite(null);
        const r = sel.getRangeAt(0).getBoundingClientRect();
        setCite({ text, x: r.left + r.width / 2, y: r.top });
      });
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  // A project script with keys of its own runs from them, in a Terminal tab of its own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const x = (project?.scripts ?? []).find((s) => s.key && matches(e, s.key));
      if (!x) return;
      // Ahead of everything else, so a script's keys beat a command on the same ones.
      e.preventDefault();
      e.stopPropagation();
      runScript(thread.id, x);
      setDock((d) => openTab(d, "terminal"));
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

  // A key opens a surface (⌘⇧ and its letter, unless you changed it), while the session is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = SURFACES.find((x) => is(e, `surface.${x.id}`));
      if (!s) return;
      e.preventDefault();
      setDock((d) => openTab(d, s.id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const send = async (m: { text: string; files: { name: string; data: string }[]; mode: "queue" | "steer" }) => {
    try {
      await rpc("thread.send", { id: thread.id, text: m.text, files: m.files, mode: m.mode });
      stick();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
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
    void rpc("thread.update", p).catch((e) => toast.error(String(e?.message ?? e)));
  };

  // The dock beside the thread, rather than over the whole paper.
  const beside = dock.open && !dock.full;
  // Plan and Auto are one session to you, whoever works in it at the moment; Solo is the model (or agent) you picked.
  const way = modeOf(thread);
  const team = way === "auto" && thread.route ? [thread.route.cast.everyday, thread.route.cast.strong] : way === "plan" && lead ? [lead.model, model] : [];
  const wayName = way === "auto" ? "Auto" : "Plan, then build";
  const wayNote = way === "auto" && thread.route ? `${modelLabel(thread.route.cast.everyday, providers)} for most, ${modelLabel(thread.route.cast.strong, providers)} for hard jobs` : lead ? `${lead.name} plans the hard jobs, ${coder.name} builds` : "";
  const placeholder = way === "solo" ? `Ask ${coder.name} for changes, or point at a file with @` : "Ask for changes, or point at a file with @";
  const empty = loaded && count === 0;

  // ⌥↑ and ⌥↓ go to the prompt before or after the one you're reading (in the composer, only while it's empty).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
        {renaming ? (
          <input
            className="lc-title-edit"
            defaultValue={thread.title}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== thread.title) void rpc("thread.update", { id: thread.id, title: v });
              setRenaming(false);
            }}
          />
        ) : (
          <h1 className="lc-title" key={thread.title} onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
            {thread.title}
          </h1>
        )}
        <button type="button" className="lc-chain l-focus" aria-label="Who works on this session" title={wayNote || undefined} onClick={() => toggle("agents")}>
          {way !== "solo" ? (
            <>
              <span className="lc-chain-marks">
                {[...new Set(team)].map((m) => (
                  <ModelMark key={m} kind={markOf(m)} size={13} />
                ))}
              </span>
              {wayName}
            </>
          ) : (
            <>
              <Disc agent={coder} size={20} />
              {isModelAgent(thread.agent) && !thread.model ? (
                <ModelTag kind={markOf(model)} label={coder.name} />
              ) : (
                <>
                  {coder.name}
                  <ModelTag kind={markOf(model)} label={modelLabel(model, providers)} />
                </>
              )}
            </>
          )}
          {subagents > 0 && (
            <>
              <I.chevR size={11} />
              <span className="lc-quiet">
                {subagents} {subagents === 1 ? "subagent" : "subagents"}
              </span>
            </>
          )}
        </button>
        {branch && (
          <span className="lc-branch lc-mono" title={thread.worktree ? `Worktree at ${thread.worktree.path}` : project?.path}>
            <I.branch size={12} />
            {branch}
          </span>
        )}
        <span className="lc-grow" data-drag />
        {thread.verdict && <Verdict v={thread.verdict} />}
        {project && <EnvMenu thread={thread} project={project} files={openFiles} lines={lines} onChanges={() => setDock((d) => openTab(d, "changes"))} />}
        {project && <ScriptsPick project={project} onRun={(x) => (runScript(thread.id, x), setDock((d) => openTab(d, "terminal")))} />}
        <TopBar thread={thread} dock={dock} onDock={setDock} files={openFiles} lines={lines} />
      </header>
      <div ref={body} className="lc-body">
        <section ref={threadRef} className="lc-thread" aria-label="Session">
          <div className="lc-stage">
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
          {finding > 0 && <FindBar root={contentRef} asked={finding} onClose={() => setFinding(0)} />}
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
          <div ref={foot} className="lc-dock">
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
                <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" onClick={() => void rpc("thread.send", { id: thread.id, text: "/goal stop" })}>
                  Stop the goal
                </button>
              </div>
            )}
            {project && (
              <div className="lc-compose">
                <Composer
                  variant="session"
                  project={project}
                  thread={thread}
                  settings={settings}
                  onSettings={update}
                  onSend={send}
                  onStop={() => void rpc("thread.stop", { id: thread.id })}
                  onNewAgent={onNewAgent}
                  busy={busy}
                  placeholder={busy ? `Write while it works: it goes when the turn ends` : placeholder}
                  autoFocus
                />
              </div>
            )}
          </div>
        </section>
        {beside && <PanelGrip body={body} width={panelW} onWidth={setPanelW} onDrag={setResizing} />}
        {(dock.open || leaving) && <SessionPanel thread={thread} dock={dock.open ? dock : leaving!} onDock={setDock} focus={focus} onFocus={setFocus} agentName={(lead ?? coder).name} onOpenSession={onOpenSession} onRoutine={onRoutine} leaving={!dock.open} />}
      </div>
    </div>
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

/** The Reviewer's last word on this session's changes, in the bar. */
function Verdict({ v }: { v: NonNullable<Thread["verdict"]> }) {
  if (v.state === "checking")
    return (
      <span className="lc-verdict" title="The Reviewer is reading the changes">
        <span className="l-shimmer">Reviewing</span>
      </span>
    );
  return (
    <span className="lc-verdict" title={v.note}>
      <Badge tone={v.state === "verified" ? "ok" : "danger"}>{v.state === "verified" ? "Verified" : "Blocked"}</Badge>
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
      triggerClass="lc-tb"
      trigger={<I.play size={15} />}
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
