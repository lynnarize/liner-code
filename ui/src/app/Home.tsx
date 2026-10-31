/*
  Home: start a session. One question, the project it's about, and the composer with who works
  on it, how hard they think and what they may do. Under it, one line: this checkout or a new
  worktree and the branch, and at its far end a scratch folder, a session to carry on from Claude
  Code or Codex, and what the box takes. Behind it, two scrolls down, the Desk: every open
  session on one line, and the case for each decision that waits on you. In the corner, what's
  new: Liner Code's own update and the agent tools'.
*/
import { useEffect, useMemo, useRef, useState } from "react";
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

  // ⌘Enter starts the session without opening it: a toast offers it, and Home clears for the next
  // ask (T3 Code: web components/chat/backgroundThread.ts). The composer sends either way; the key
  // is read here, as it goes by, before the composer takes it.
  const background = useRef(false);
  const start = async (m: { text: string; files: { name: string; data: string }[] }) => {
    if (!project) return;
    const quietly = background.current;
    background.current = false;
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

  const ask = (
    <div className="lc-home-in">
      {project ? (
        <>
          <h2 className="lc-ask-h">
            What should we build in{" "}
            <ProjectPick project={project} projects={projects} onPick={onProject} onSample={() => void add("@sample")} />?
          </h2>
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
              stripEnd={
                <>
                  {project.name !== "Scratch" && (
                    <button type="button" className="lc-pb l-focus" title="Start without a project, in a scratch folder" onClick={() => void scratch()}>
                      <I.folder size={13} />
                      <span className="lc-strip-word">Scratch folder</span>
                    </button>
                  )}
                  <CarryOn project={project} onOpen={onStarted} />
                  <Keys />
                </>
              }
            />
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
    <Pop
      label="Carry on a session from Claude Code or Codex"
      align="end"
      width={440}
      triggerClass="lc-pb"
      trigger={
        <>
          <I.rotate size={13} />
          <span className="lc-strip-word">Carry on a session</span>
        </>
      }
    >
      {(close) => <CarryOnList project={project} onOpen={(id) => (close(), onOpen(id))} />}
    </Pop>
  );
}

/** What the box takes, kept behind one key-shaped button instead of a row of hints under it. */
const KEYS = [
  ["@", "A file"],
  ["/", "A command"],
  ["$", "A skill"],
  ["⌘Enter", "Start it in the background"],
  ["⌘K", "Everything else"],
] as const;

function Keys() {
  return (
    <Pop label="What the box takes" align="end" width={280} triggerClass="lc-pb lc-pb-keys" trigger={<I.keyboard size={15} />}>
      {() => (
        <>
          <PanelHead>In the box</PanelHead>
          <dl className="lc-box-keys">
            {KEYS.map(([k, what]) => (
              <div key={k}>
                <dt>
                  <Kbd>{k}</Kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
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
