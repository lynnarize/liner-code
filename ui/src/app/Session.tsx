/*
  An open session: its name, who works on it and on which branch, the timeline, and the
  composer. The panel beside it holds the diff or the agents; Review full width lets the diff
  take the whole paper.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, ProjectScript, Thread } from "@contracts";
import { useStickToBottom } from "@liner/pro/agents/agents";
import { toast } from "@liner/components/toast/toast";
import { loadItems, rpc, useEngine, useItems } from "./engine";
import { Composer, type RunSettings } from "./Composer";
import { EnvMenu } from "./Env";
import { Rail } from "./Rail";
import { I } from "./icons";
import { agentOf, checkpointsOf, isModelAgent, markOf, modelLabel, sumLines } from "./model";
import { Panel } from "./Panel";
import { FindBar, toComposer } from "./Find";
import { onBrowserWanted } from "./agentBrowser";
import { glyphs, is, matches } from "./keymap";
import { keepPanel, keptPanel, openTab, runScript, SURFACES, type PanelState, type Tab } from "./Surfaces";
import { Timeline } from "./Timeline";
import { Badge, Disc, Kbd, Lines, ModelTag, PanelHead, Pop, Row, Sep } from "./ui";

type Props = {
  thread: Thread;
  sidebar: boolean;
  onSidebar: () => void;
  onNewAgent: () => void;
  onOpenSession: (id: string, tab?: Tab) => void;
  onRoutine: (id?: string) => void;
};

export function Session({ thread, sidebar, onSidebar, onNewAgent, onOpenSession, onRoutine }: Props) {
  const items = useItems(thread.id);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const project = useEngine((s) => s.projects.find((p) => p.id === thread.projectId));
  const [panel, setPanelState] = useState<PanelState>(() => keptPanel(thread.id));
  const setPanel = (p: PanelState | ((p: PanelState) => PanelState)) =>
    setPanelState((prev) => {
      const next = typeof p === "function" ? p(prev) : p;
      keepPanel(thread.id, next);
      return next;
    });
  const [focus, setFocus] = useState<{ id: string; path?: string } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const { ref: scroller, contentRef, away, jump, stick, follow } = useStickToBottom();
  // The composer floats over the conversation; the text keeps room under it to scroll clear.
  const threadRef = useRef<HTMLElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const d = dock.current;
    if (!d) return;
    const ro = new ResizeObserver(() => threadRef.current?.style.setProperty("--lc-dock-h", `${d.offsetHeight}px`));
    ro.observe(d);
    return () => ro.disconnect();
  }, []);

  // Opening a session loads its timeline; what was there already renders without animating.
  useEffect(() => {
    seen.current = null;
    setFocus(null);
    void loadItems(thread.id);
    stick();
  }, [thread.id]);
  if (seen.current === null && items.length) seen.current = new Set(items.map((x) => x.id));
  useEffect(() => {
    if (thread.unread) void rpc("thread.update", { id: thread.id, unread: false });
  }, [thread.id, thread.unread]);

  const lead = thread.lead ? agentOf(thread.lead, agents, providers) : undefined;
  const coder = agentOf(thread.agent, agents, providers);
  const model = thread.model ?? coder.model;
  const settings: RunSettings = { agent: thread.agent, lead: thread.lead, setup: thread.setup?.id, model: thread.model, effort: thread.effort ?? coder.effort, access: thread.access, helpers: thread.helpers };
  const open = checkpointsOf(items).filter((c) => !c.reverted && !c.committed);
  const lines = sumLines(open.flatMap((c) => c.files));
  const openFiles = new Set(open.flatMap((c) => c.files.map((f) => f.path))).size;
  const branch = thread.worktree?.branch ?? project?.branch;
  const busy = thread.status === "running";
  const subagents = items.filter((x) => x.kind === "tool" && x.toolKind === "task").length;

  const review = (id: string, path?: string) => {
    setFocus({ id, path });
    setPanel((p) => openTab(p, "changes"));
  };
  const toggle = (tab: Tab) => setPanel((p) => (p.open && p.tab === tab && !p.picking ? { ...p, open: false, wide: false } : openTab(p, tab)));
  // ⌘F finds in the thread (Review has its own, over the diff).
  const [finding, setFinding] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!is(e, "find")) return;
      if (panel.open && panel.wide && panel.tab === "changes") return;
      e.preventDefault();
      setFinding(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel.open, panel.wide, panel.tab]);

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
      setPanel((p) => openTab(p, "terminal"));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [thread.id, JSON.stringify(project?.scripts ?? [])]);

  // An agent that wants the Browser brings it up beside the session.
  useEffect(() => onBrowserWanted(thread.id, () => setPanel((p) => (p.open && p.tab === "browser" ? p : openTab(p, "browser")))), [thread.id]);

  // A key opens a surface (⌘⇧ and its letter, unless you changed it), while the session is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = SURFACES.find((x) => is(e, `surface.${x.id}`));
      if (!s) return;
      e.preventDefault();
      setPanel((p) => openTab(p, s.id));
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
    }
  };
  const update = (patch: Partial<RunSettings>) => {
    const p: Parameters<typeof rpc<"thread.update">>[1] = { id: thread.id };
    if ("agent" in patch) p.agent = patch.agent;
    if ("lead" in patch) p.lead = patch.lead ?? null;
    if ("model" in patch) p.model = patch.model;
    if ("effort" in patch) p.effort = patch.effort;
    if ("access" in patch) p.access = patch.access;
    if ("helpers" in patch) p.helpers = patch.helpers ?? [];
    if ("setup" in patch) p.setup = patch.setup ?? null;
    void rpc("thread.update", p).catch((e) => toast.error(String(e?.message ?? e)));
  };

  const placeholder = lead ? `Ask ${lead.name} for changes, or point at a file with @` : `Ask ${coder.name} for changes, or point at a file with @`;
  const empty = useMemo(() => items.length === 0, [items.length]);

  return (
    <div className="lc-session" data-panel={panel.open || undefined} data-wide={(panel.open && panel.wide) || undefined} data-dock={panel.open && !panel.wide && panel.dock === "bottom" ? "bottom" : undefined}>
      <header className="lc-top" data-drag>
        {!sidebar && (
          <button type="button" className="lc-tb l-focus" aria-label="Show the sidebar" title="Show the sidebar (⌘\)" onClick={onSidebar}>
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
        <button type="button" className="lc-chain l-focus" aria-label="Who works on this session" onClick={() => toggle("agents")}>
          {lead && (
            <>
              <Disc agent={lead} size={20} lead />
              {lead.name}
              <I.chevR size={11} />
            </>
          )}
          <Disc agent={coder} size={20} />
          {isModelAgent(thread.agent) && !thread.model ? (
            <ModelTag kind={markOf(model)} label={coder.name} />
          ) : (
            <>
              {coder.name}
              <ModelTag kind={markOf(model)} label={modelLabel(model, providers)} />
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
        {project && <EnvMenu thread={thread} project={project} files={openFiles} lines={lines} onChanges={() => setPanel((p) => openTab(p, "changes"))} />}
        {project && <ScriptsPick project={project} onRun={(x) => (runScript(thread.id, x), setPanel((p) => openTab(p, "terminal")))} />}
        <button type="button" className="lc-tb lc-tb-changes l-focus" aria-label={`Changes, ${open.length ? "to review" : "none open"}`} aria-pressed={panel.open && panel.tab === "changes" && !panel.picking} onClick={() => toggle("changes")}>
          <I.changes size={16} />
          Changes
          <Lines {...lines} />
        </button>
      </header>

      <div className="lc-body">
        <section ref={threadRef} className="lc-thread" aria-label="Session">
          <div className="lc-stage">
            <div ref={scroller} className="lc-scroll">
              <div ref={contentRef} className="lc-scroll-in">
                {empty ? (
                  <div className="lc-fresh">
                    <Disc agent={lead ?? coder} size={34} lead={Boolean(lead) || undefined} />
                    <b>{lead ? `${lead.name} plans, then ${coder.name} builds` : `A new session with ${coder.name}`}</b>
                    <span>Say what you need below. Anything that needs you will wait here as a card.</span>
                  </div>
                ) : (
                  <Timeline threadId={thread.id} items={items} seen={seen.current ?? new Set()} onReview={review} reviewing={panel.open && panel.tab === "changes" && !panel.picking ? focus : null} onGrow={follow} />
                )}
              </div>
            </div>
            <Rail thread={thread} panel={panel} onPanel={setPanel} onTab={toggle} files={openFiles} branch={branch} />
          </div>
          {finding && <FindBar root={contentRef} onClose={() => setFinding(false)} />}
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
          <div ref={dock} className="lc-dock">
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
        {panel.open && <Panel thread={thread} items={items} state={panel} onState={setPanel} focus={focus} onFocus={setFocus} agentName={(lead ?? coder).name} onOpenSession={onOpenSession} onRoutine={onRoutine} />}
      </div>
    </div>
  );
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
