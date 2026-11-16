/*
  Home: start a session, laid out as Devin's (docs/research/home-like-home.md, board B). The
  composer sits in the middle of the paper. On top of it, where a headline was, the project's
  name (press it to change it) and, at the right, This checkout or Worktree. Under the box one
  row says the rest of how it runs: the branch, the tool, and at the right edge the mode. Below
  that, Pick up: sessions that wait on you, work not committed, and sessions to carry on from
  Claude Code or Codex. Behind it, two scrolls down, the Desk: every open session on one line,
  and the case for each decision that waits on you. In the corner, what's new.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { ImportableSession, Project, SessionMode } from "@contracts";
import { startOf } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "./bridge";
import { Composer, type RunSettings } from "./Composer";
import { DeskPresence } from "./Desk";
import { DeskStage } from "./DeskStage";
import { rpc, useEngine } from "./engine";
import { I, ModelMark } from "./icons";
import { ago, bucketOf, codeProjects, pairEffortFor } from "./model";
import { Pop, Row, Sep } from "./ui";
import { ProjectChooser } from "./Projects";
import { ModePick } from "./Modes";
import { HomeUpdates } from "./Updates";
import * as os from "./os";

type Props = { projectId?: string; onProject: (id: string) => void; onStarted: (threadId: string) => void; onCompare: (compareId: string) => void; sidebar: boolean; onSidebar: () => void; onNewAgent: () => void; startMode?: SessionMode; startPrompt?: { text: string; at: number } };

export function Home({ projectId, onProject, onStarted, onCompare, sidebar, onSidebar, onNewAgent, startMode, startPrompt }: Props) {
  // A design on its own (Project.kind "design") is never a project Home starts a session in.
  const all = useEngine((s) => s.projects);
  const projects = useMemo(() => codeProjects(all), [all]);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const engineSettings = useEngine((s) => s.settings);
  const access = useEngine((s) => s.settings.defaultAccess);
  const worktrees = useEngine((s) => s.settings.worktrees);
  const project = projects.find((p) => p.id === projectId) ?? projects[0];

  // What's ready, as a key that changes only when a tool or its models come or go, so your picks here aren't reset by a refresh.
  const readyKey = providers.map((p) => `${p.id}:${p.available && p.adapter ? p.models.length : 0}`).join();
  // Who a new session starts with: the project's own agent, else a pair, the best model or the fast one, as Settings say.
  const initial = useMemo((): RunSettings => {
    // The sample project's Demo starts as a pair, so its scripted lead and sidekick can be seen.
    if (project?.agent === "demo") return { agent: "demo", sidekick: "demo:demo", effort: "low", access };
    // A project set to start with one of your agents (Settings › Projects): that agent, on its own.
    const own = agents.find((a) => a.id === project?.agent);
    if (own) return { agent: own.id, effort: own.effort, access };
    const firstModel = providers.find((p) => p.available && p.adapter && p.id !== "demo");
    const start = startOf(engineSettings, providers);
    // Starting as a pair, at a pair's effort (Settings, Medium unless set).
    if (start) return { ...start, effort: start.sidekick ? pairEffortFor(start.agent, providers, engineSettings.pairEffort) : "medium", access };
    return { agent: firstModel ? `@${firstModel.id}:${firstModel.models[0]?.id ?? "default"}` : "demo", effort: "medium", access };
  }, [project?.id, project?.agent, engineSettings.start, JSON.stringify(engineSettings.picks ?? {}), engineSettings.pairEffort, access, agents.length, readyKey]);
  const [settings, setSettings] = useState<RunSettings>(initial);
  // The session's mode, fixed once it starts: your default, unless you pick another here.
  const defaultMode = useEngine((s) => s.settings.defaultMode ?? "standard");
  const [sessionMode, setSessionMode] = useState<SessionMode>(startMode ?? defaultMode);
  // A custom mode whose agent you since removed starts as Standard.
  const mode_ = !sessionMode.startsWith("agent:") || agents.some((a) => `agent:${a.id}` === sessionMode) ? sessionMode : "standard";
  /*
    Workshop only when you ask for it: Create your add-on (Add-ons) opens Home in it, or you pick it
    here. What you type never switches the mode.
  */
  useEffect(() => setSessionMode(startMode ?? defaultMode), [startMode, defaultMode]);
  const pick = (m: SessionMode) => setSessionMode(m);
  const [worktree, setWorktree] = useState(worktrees);
  const [compare, setCompare] = useState<string[]>([]);
  // A comparison gives each model the ask alone: a sidekick set (Pair picked) drops the models picked to compare.
  useEffect(() => {
    if (settings.sidekick) setCompare([]);
  }, [settings.sidekick]);
  const [base, setBase] = useState<string | undefined>();
  const [inWorktree, setInWorktree] = useState<{ path: string; branch?: string } | undefined>();
  // A new default (a tool done detecting, a pick in Settings) replaces who's picked here, but not a comparison you're building in this project.
  const building = useRef({ project: project?.id, compare });
  useEffect(() => void (building.current.compare = compare));
  useEffect(() => {
    const same = building.current.project === project?.id;
    building.current.project = project?.id;
    if (!same || !building.current.compare.length) setSettings(initial);
  }, [initial]);
  useEffect(() => {
    setCompare([]);
    setBase(undefined);
    setInWorktree(undefined);
  }, [project?.id]);
  useEffect(() => setWorktree(worktrees), [worktrees, project?.id]);

  const add = async (path: string | null) => {
    if (!path) return;
    try {
      const p = await rpc("project.add", { path });
      onProject(p.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const scratch = async () => {
    try {
      const p = await rpc("project.scratch", {});
      onProject(p.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  /*
    The session you're writing here opens its tool ahead, as one you write in does (thread.warm): as you begin the draft, it's
    given the id it will have, and the engine opens what thread.create would make with what's picked (thread.warmNew); start()
    then makes it with that id, and its first turn takes the tool already up. A choice changed afterwards sends it again, same id,
    once per change, never per keystroke. Nothing is picked or sent where something has to be made first (a worktree, new or
    picked, or a comparison): then it's as before. Sent once a choice moves to one of those, so the engine closes what's open;
    and so it does when the draft is emptied by hand, or Home goes away (a session opened, another page) with it not started
    (thread.unwarmNew), once each.
  */
  const nextId = useRef<string | null>(null);
  const begun = useRef(false);
  const sentFor = useRef("");
  const plainHere = Boolean(project) && !(worktree && project?.git) && !inWorktree && !(compare.length && mode_ === "standard");
  const choices = { projectId: project?.id ?? "", mode: mode_, agent: settings.agent, sidekick: settings.sidekick, tuning: settings.tuning, review: settings.review, model: settings.model, effort: settings.effort, access: settings.access, worktree: Boolean(worktree && project?.git && !inWorktree), base: worktree ? base : undefined, inWorktree: inWorktree?.path, compare: Boolean(compare.length && mode_ === "standard") };
  const choicesKey = JSON.stringify(choices);
  const warmNew = () => {
    if (!project || !begun.current || sentFor.current === choicesKey) return;
    if (!nextId.current) {
      if (!plainHere) return;
      nextId.current = `th_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    }
    sentFor.current = choicesKey;
    void rpc("thread.warmNew", { id: nextId.current, ...choices }).catch(() => {});
  };
  useEffect(warmNew, [choicesKey, plainHere]);
  /** The draft went (emptied by hand, or Home left) with a session opened for it: that session closes, and the next draft gets an id of its own. */
  const unwarm = () => {
    const id = nextId.current;
    nextId.current = null;
    if (id && sentFor.current) void rpc("thread.unwarmNew", { id }).catch(() => {});
    sentFor.current = "";
  };
  useEffect(() => unwarm, []);

  // ⌘Enter starts the session without opening it: a toast offers it, and Home clears for the next
  // ask (T3 Code: web components/chat/backgroundThread.ts). The composer sends either way; the key
  // is read here, as it goes by, before the composer takes it.
  const background = useRef(false);
  const start = async (m: { text: string; files: { name: string; data: string }[] }) => {
    if (!project) return;
    const quietly = background.current;
    background.current = false;
    const asMode = mode_;
    // The id the draft's tool was opened under, if it was: this session's. The next ask gets an id of its own.
    const id = nextId.current ?? undefined;
    nextId.current = null;
    begun.current = false;
    sentFor.current = "";
    try {
      if (compare.length && asMode === "standard") {
        const made = await rpc("compare.start", { projectId: project.id, text: m.text, files: m.files, models: [settings.agent, ...compare], effort: settings.effort, access: settings.access });
        setCompare([]);
        if (made[0]?.compare) onCompare(made[0].compare.id);
        return;
      }
      const t = await rpc("thread.create", { ...(id ? { id } : {}), projectId: project.id, mode: asMode, agent: settings.agent, sidekick: settings.sidekick, ...(settings.sidekick && settings.tuning ? { tuning: settings.tuning } : {}), review: settings.review, model: settings.model, effort: settings.effort, access: settings.access, worktree: worktree && project.git && !inWorktree, base: worktree ? base : undefined, inWorktree: inWorktree?.path });
      await rpc("thread.send", { id: t.id, text: m.text, files: m.files });
      if (quietly) {
        setInWorktree(undefined);
        const ask = m.text.split("\n")[0].trim();
        toast("Started in the background", { description: ask.length > 72 ? `${ask.slice(0, 71)}…` : ask || "It's in the sidebar.", action: { label: "Open", onClick: () => onStarted(t.id) }, duration: 6000 });
      } else onStarted(t.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      // Thrown on, so the composer puts the ask back.
      throw e;
    }
  };

  // What a row in Pick up puts in the box (work not committed, to carry on), like a prompt handed to Home.
  const [handed, setHanded] = useState<{ text: string; at: number } | undefined>();
  const ask = (
    <div className="lc-home-in" data-mid={project ? "" : undefined}>
      {project ? (
        <>
          <div className="lc-home-top">
            <ProjectName project={project} projects={projects} onPick={onProject} onSample={() => void add("@sample")} onScratch={() => void scratch()} />
            <span className="lc-grow" />
            {project.git && !inWorktree && (
              <div className="lc-home-where" role="radiogroup" aria-label="Where it runs">
                <button type="button" role="radio" aria-checked={!worktree} className="l-focus" onClick={() => setWorktree(false)}>
                  This checkout
                </button>
                <button type="button" role="radio" aria-checked={worktree} className="l-focus" onClick={() => setWorktree(true)}>
                  Worktree
                </button>
              </div>
            )}
          </div>
          <div
            className="lc-home-compose"
            onKeyDownCapture={(e) => {
              if (e.key === "Enter" && !e.shiftKey) background.current = e.metaKey || e.ctrlKey;
            }}
            onPointerDownCapture={() => (background.current = false)}
          >
            <Composer
              variant="home"
              project={project}
              settings={settings}
              onSettings={(p) => setSettings((s) => ({ ...s, ...p }))}
              onSend={start}
              onDraft={(on) => {
                begun.current = on;
                if (on) warmNew();
                else unwarm();
              }}
              onNewAgent={onNewAgent}
              placeholder={mode_ === "creator" ? "Say what to add to Liner Code: a connection, a panel or an app" : "Ask for a change, paste an error, or drop in a screenshot"}
              worktree={worktree}
              onWorktree={setWorktree}
              base={base}
              onBase={setBase}
              inWorktree={inWorktree}
              onInWorktree={setInWorktree}
              // Comparing models starts Standard sessions, so it's offered only in Standard.
              compare={project.git && mode_ === "standard" ? compare : undefined}
              onCompare={project.git && mode_ === "standard" ? setCompare : undefined}
              autoFocus
              seed={handed && (!startPrompt || handed.at > startPrompt.at) ? handed : startPrompt}
              stripEnd={<ModePick value={mode_} onPick={pick} />}
            />
          </div>
          <PickUp
            project={project}
            onOpen={onStarted}
            onContinue={(n) => setHanded({ text: `Carry on the work that isn't committed here (${n} ${n === 1 ? "file" : "files"}): read what changed, then finish it.`, at: Date.now() })}
          />
        </>
      ) : (
        <div className="lc-noproj">
          <h2 className="lc-ask-h">Add a project to start</h2>
          <p className="lc-quiet">A project is a folder on {os.here}. Agents work inside it, and every turn is kept so you can undo it.</p>
          <div className="lc-noproj-acts">
            <button type="button" className="lc-btn" data-kind="primary" onClick={() => void bridge.pickFolder().then(add)}>
              <I.folder size={14} />
              Add a folder
            </button>
            {engineSettings.showDemo && (
              <button type="button" className="lc-btn" data-kind="plain" onClick={() => void add("@sample")}>
                Try the sample project
              </button>
            )}
            {/* "No project" when the paper is too narrow for the whole label on the row (app.css, .lc-noproj); the hidden one is display: none, so the shown words are its name. */}
            <button type="button" className="lc-btn" data-kind="ghost" onClick={() => void scratch()}>
              <span className="lc-noproj-long">Start without a project</span>
              <span className="lc-noproj-short">No project</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="lc-home">
      <header className="lc-top lc-top-home" data-drag>
        {!sidebar && (
          <button type="button" className="lc-tb l-focus" aria-label="Show the sidebar" onClick={onSidebar}>
            <I.sidebar size={16} />
          </button>
        )}
        {/* No breadcrumb: the headline names the project. The row stays, as the window's drag region. */}
        <span className="lc-grow" data-drag />
        <DeskPresence />
      </header>
      {project ? (
        <DeskStage project={project} settings={settings} worktree={worktree} onOpen={onStarted}>
          {ask}
          <HomeUpdates sidebar={sidebar} />
        </DeskStage>
      ) : (
        <>
          {ask}
          <HomeUpdates sidebar={sidebar} />
        </>
      )}
    </div>
  );
}

/** The project's name over the box: press it for your other projects, another folder or a scratch folder. */
function ProjectName({ project, projects, onPick, onSample, onScratch }: { project: Project; projects: Project[]; onPick: (id: string) => void; onSample: () => void; onScratch: () => void }) {
  const showDemo = useEngine((s) => s.settings.showDemo === true);
  return (
    <Pop
      label={`Project: ${project.name}. Change it`}
      width={420}
      triggerClass="lc-home-name"
      trigger={
        <>
          <span>{project.name}</span>
          <I.chevD size={14} />
        </>
      }
    >
      {(close) => (
        <ProjectChooser
          value={project.id}
          onPick={(p) => (onPick(p.id), close())}
          extra={
            <>
              <Sep />
              {project.name !== "Scratch" && <Row title="A scratch folder" note="Start without a project" icon={<I.folderPlus size={13} />} onPick={() => (close(), onScratch())} />}
              {showDemo && !projects.some((p) => p.agent === "demo") && <Row title="Try the sample project" note="The Demo agent, no account needed" icon={<I.sparkle size={13} />} onPick={() => (close(), onSample())} />}
            </>
          }
        />
      )}
    </Pop>
  );
}

/**
  Pick up: what is already yours to carry on. Sessions that wait on you (any project), this
  project's work that isn't committed, its sessions in Claude Code and Codex that aren't here yet,
  Nothing to pick up, nothing shown.
*/
function PickUp({ project, onOpen, onContinue }: { project: Project; onOpen: (threadId: string) => void; onContinue: (files: number) => void }) {
  const threads = useEngine((s) => s.threads);
  const all = useEngine((s) => s.projects);
  const waits = useMemo(
    () =>
      threads
        .filter((t) => !t.archived && t.turns > 0 && bucketOf(t) === "needs")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 2),
    [threads],
  );
  const [changed, setChanged] = useState(0);
  const [theirs, setTheirs] = useState<ImportableSession[]>([]);
  useEffect(() => {
    let live = true;
    setChanged(0);
    setTheirs([]);
    if (project.git) void rpc("git.status", { projectId: project.id }).then((g) => live && setChanged(g.changes.length), () => undefined);
    void rpc("sessions.importable", { projectId: project.id }).then((l) => live && setTheirs(l.slice(0, 2)), () => undefined);
    return () => {
      live = false;
    };
  }, [project.id, project.git]);
  const bring = (x: ImportableSession) =>
    void rpc("sessions.import", { projectId: project.id, tool: x.tool, id: x.id }).then(
      (t) => onOpen(t.id),
      (e: Error) => toast.error(e.message),
    );
  const word = (t: (typeof threads)[number]) => (t.status === "error" ? "Stopped" : t.status === "limited" ? "At its limit" : t.status === "waiting" ? "Waiting" : "New");
  if (!waits.length && !changed && !theirs.length) return <div className="lc-home-pickup" />;
  return (
    <section className="lc-home-pickup" aria-label="Pick up">
      <div className="lc-home-card-h">Pick up</div>
      {waits.map((t) => (
        <button key={t.id} type="button" className="lc-home-pick l-focus" onClick={() => onOpen(t.id)}>
          <span className="lc-home-waits">{word(t)}</span>
          <span className="lc-home-pick-t">{t.title}</span>
          <span className="lc-grow" />
          <small>{all.find((p) => p.id === t.projectId)?.name}</small>
        </button>
      ))}
      {changed > 0 && (
        <button type="button" className="lc-home-pick l-focus" onClick={() => onContinue(changed)}>
          <span className="lc-home-pick-t">Continue uncommitted work</span>
          <span className="lc-grow" />
          <small>
            {changed} {changed === 1 ? "file" : "files"} in {project.name}
          </small>
        </button>
      )}
      {theirs.map((x) => (
        <button key={`${x.tool}:${x.id}`} type="button" className="lc-home-pick l-focus" onClick={() => bring(x)}>
          <ModelMark kind={x.tool === "claude" ? "claudecode" : "codex"} size={14} />
          <span className="lc-home-pick-t">{x.title}</span>
          <span className="lc-grow" />
          <small>
            from {x.tool === "claude" ? "Claude Code" : "Codex"} · {ago(x.at)}
          </small>
        </button>
      ))}
    </section>
  );
}
