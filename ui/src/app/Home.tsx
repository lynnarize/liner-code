/*
  Home: start a session. One question, the project it's about, and the composer with who works
  on it, how hard they think and what they may do. Under it: this checkout or a new worktree,
  and the branch. Behind it, two scrolls down, the Desk: every open session on one line, and
  the case for each decision that waits on you. In the corner, what's new: Liner Code's own
  update and the agent tools'.
*/
import { useEffect, useMemo, useState } from "react";
import type { ImportableSession, Project } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "./bridge";
import { Composer, type RunSettings } from "./Composer";
import { DeskPresence } from "./Desk";
import { DeskStage } from "./DeskStage";
import { rpc, useEngine } from "./engine";
import { I } from "./icons";
import { ago, setupOf } from "./model";
import { PanelHead, Pop, Row, Sep, Kbd } from "./ui";
import { ProjectChooser } from "./Projects";
import { HomeUpdates } from "./Updates";

type Props = { projectId?: string; onProject: (id: string) => void; onStarted: (threadId: string) => void; onCompare: (compareId: string) => void; sidebar: boolean; onSidebar: () => void; onNewAgent: () => void };

export function Home({ projectId, onProject, onStarted, onCompare, sidebar, onSidebar, onNewAgent }: Props) {
  const projects = useEngine((s) => s.projects);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const workStyle = useEngine((s) => s.settings.workStyle);
  const engineSettings = useEngine((s) => s.settings);
  const access = useEngine((s) => s.settings.defaultAccess);
  const worktrees = useEngine((s) => s.settings.worktrees);
  const project = projects.find((p) => p.id === projectId) ?? projects[0];

  // Who a new session starts with: the project's agent, the team, or the first ready model.
  const initial = useMemo((): RunSettings => {
    if (project?.agent === "demo") return { agent: "demo", lead: workStyle === "lead" ? "demo" : undefined, effort: "low", access };
    const firstModel = providers.find((p) => p.available && p.adapter && p.id !== "demo");
    const lead = agents.find((a) => /lead/i.test(a.role));
    const coder = agents.find((a) => a.specialty === "coder" && a.id !== "demo") ?? agents.find((a) => a.id !== "demo");
    // A project set to start with one agent (Settings → Projects): a lead brings its coder along.
    const own = agents.find((a) => a.id === project?.agent);
    if (own && /lead/i.test(own.role) && coder) return { agent: coder.id, lead: own.id, effort: "medium", access };
    if (own) return { agent: own.id, effort: own.effort, access };
    if (workStyle === "lead" && lead && coder) return { agent: coder.id, lead: lead.id, effort: "medium", access };
    // One of your setups: the engine takes who works on it from the setup when the session starts.
    const mine = workStyle === "team" ? setupOf(engineSettings, agents) : undefined;
    if (mine) return { setup: mine.id, agent: mine.stages[0].who, lead: mine.lead ?? undefined, helpers: mine.crew.length ? mine.crew : undefined, effort: mine.lead ? "medium" : (agents.find((a) => a.id === mine.stages[0].who)?.effort ?? "medium"), access };
    return { agent: firstModel ? `@${firstModel.id}:${firstModel.models[0]?.id ?? "default"}` : (coder?.id ?? "demo"), effort: "medium", access };
  }, [project?.id, project?.agent, workStyle, engineSettings.setups, engineSettings.setup, access, agents.length, providers.length]);
  const [settings, setSettings] = useState<RunSettings>(initial);
  const [worktree, setWorktree] = useState(worktrees);
  const [compare, setCompare] = useState<string[]>([]);
  const [base, setBase] = useState<string | undefined>();
  const [inWorktree, setInWorktree] = useState<{ path: string; branch?: string } | undefined>();
  useEffect(() => setSettings(initial), [initial]);
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

  const start = async (m: { text: string; files: { name: string; data: string }[] }) => {
    if (!project) return;
    try {
      if (compare.length) {
        const made = await rpc("compare.start", { projectId: project.id, text: m.text, files: m.files, models: [settings.lead ?? settings.agent, ...compare], effort: settings.effort, access: settings.access });
        setCompare([]);
        if (made[0]?.compare) onCompare(made[0].compare.id);
        return;
      }
      const t = await rpc("thread.create", { projectId: project.id, agent: settings.agent, lead: settings.lead, setup: settings.setup, route: settings.route, model: settings.model, effort: settings.effort, access: settings.access, worktree: worktree && project.git && !inWorktree, base: worktree ? base : undefined, inWorktree: inWorktree?.path });
      if (settings.lead && !settings.setup && settings.helpers?.length) await rpc("thread.update", { id: t.id, helpers: settings.helpers });
      await rpc("thread.send", { id: t.id, text: m.text, files: m.files });
      onStarted(t.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const ask = (
    <div className="lc-home-in">
      {project ? (
        <>
          <h2 className="lc-ask-h">
            What should we build in{" "}
            <ProjectPick project={project} projects={projects} onPick={onProject} onSample={() => void add("@sample")} />?
          </h2>
          {project.name !== "Scratch" && (
            <div className="lc-home-or">
              or{" "}
              <button type="button" className="lc-link l-focus" onClick={() => void scratch()}>
                start without a project
              </button>
              , in a scratch folder, or <CarryOn project={project} onOpen={onStarted} />
            </div>
          )}
          <div className="lc-home-compose">
            <Composer
              variant="home"
              project={project}
              settings={settings}
              onSettings={(p) => setSettings((s) => ({ ...s, ...p }))}
              onSend={start}
              onNewAgent={onNewAgent}
              placeholder="Ask for a change, paste an error, or drop in a screenshot"
              worktree={worktree}
              onWorktree={setWorktree}
              base={base}
              onBase={setBase}
              inWorktree={inWorktree}
              onInWorktree={setInWorktree}
              compare={project.git ? compare : undefined}
              onCompare={project.git ? setCompare : undefined}
              autoFocus
            />
          </div>
          <div className="lc-hints">
            <span>
              <Kbd>@</Kbd> a file
            </span>
            <span>
              <Kbd>/</Kbd> a command
            </span>
            <span>
              <Kbd>$</Kbd> a skill
            </span>
            <span>
              <Kbd>⌘K</Kbd> everything else
            </span>
          </div>
        </>
      ) : (
        <div className="lc-noproj">
          <h2 className="lc-ask-h">Add a project to start</h2>
          <p className="lc-quiet">A project is a folder on this Mac. Agents work inside it, and every turn is kept so you can undo it.</p>
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
            <button type="button" className="lc-btn" data-kind="ghost" onClick={() => void scratch()}>
              Start without a project
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
        <span className="lc-crumb">
          <I.folder size={13} />
          {project?.name ?? "No project"}
          <span className="lc-quiet">/</span>
          <b>New session</b>
        </span>
        <span className="lc-grow" data-drag />
        <DeskPresence />
      </header>
      {project ? (
        <DeskStage project={project} settings={settings} worktree={worktree} onOpen={onStarted}>
          {ask}
          <HomeUpdates />
        </DeskStage>
      ) : (
        <>
          {ask}
          <HomeUpdates />
        </>
      )}
    </div>
  );
}

/** Past Claude Code and Codex sessions in this project's folder: one press brings it in to carry on here. */
function CarryOn({ project, onOpen }: { project: Project; onOpen: (threadId: string) => void }) {
  return (
    <Pop label="Carry on a session from Claude Code or Codex" align="center" width={440} triggerClass="lc-link l-focus" trigger={<>carry on one from Claude Code or Codex</>}>
      {(close) => <CarryOnList project={project} onOpen={(id) => (close(), onOpen(id))} />}
    </Pop>
  );
}

/** Looked for each time the list opens, since the tools keep adding sessions. */
function CarryOnList({ project, onOpen }: { project: Project; onOpen: (threadId: string) => void }) {
  const [list, setList] = useState<ImportableSession[] | null>(null);
  useEffect(() => void rpc("sessions.importable", { projectId: project.id }).then(setList, () => setList([])), [project.id]);
  const bring = (s: ImportableSession) =>
    void rpc("sessions.import", { projectId: project.id, tool: s.tool, id: s.id }).then(
      (t) => onOpen(t.id),
      (e: Error) => toast.error(e.message),
    );
  return (
    <>
      <PanelHead>Sessions in {project.name}</PanelHead>
      {list === null ? (
        <Row title="Looking" note="Claude Code's and Codex's own history for this folder" />
      ) : list.length ? (
        list.slice(0, 20).map((s) => <Row key={`${s.tool}:${s.id}`} title={s.title} note={`${s.tool === "claude" ? "Claude Code" : "Codex"} · ${ago(s.at)}`} onPick={() => bring(s)} />)
      ) : (
        <Row title="None here" note="Neither Claude Code nor Codex has a session in this folder that isn't here already." />
      )}
    </>
  );
}

function ProjectPick({ project, projects, onPick, onSample }: { project: Project; projects: Project[]; onPick: (id: string) => void; onSample: () => void }) {
  const showDemo = useEngine((s) => s.settings.showDemo === true);
  return (
    <Pop label={`Project: ${project.name}. Change it`} align="center" width={420} triggerClass="lc-proj" trigger={<span>{project.name}</span>}>
      {(close) => (
        <ProjectChooser
          value={project.id}
          onPick={(p) => (onPick(p.id), close())}
          extra={
            showDemo &&
            !projects.some((p) => p.agent === "demo") && (
              <>
                <Sep />
                <Row title="Try the sample project" note="The Demo agent, no account needed" icon={<I.sparkle size={13} />} onPick={() => (close(), onSample())} />
              </>
            )
          }
        />
      )}
    </Pop>
  );
}
