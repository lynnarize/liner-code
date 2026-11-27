/*
  Home: start a session (board Home of "line and dot", 2026-11-27). In one column in the middle of the paper: the
  headline in the name's face, with no mark above it; a row of chips over the box (the project with its small tile,
  press it for your projects, the last used first; where it works, this checkout or a new worktree; and at the right
  end the branch, or the branch a new worktree starts from); the box; and under it Carry on, three cards of work to
  pick up (CarryOn.tsx), unless Settings turned it off. No row of tools sits under them. The tool is in the box's who panel
  and the mode in its + menu (a chip after the + while it isn't Standard). In the corner, what's new.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, RpcResult, SessionMode } from "@contracts";
import { carryOnOn, modeName, startOf } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "./bridge";
import { ChoiceChip, Composer, type PlusChoice, type RunSettings } from "./Composer";
import { getState, rpc, useEngine } from "./engine";
import { I } from "./icons";
import { listedProjects, pairEffortFor, since, startEffort } from "./model";
import { tileLetters } from "./letters";
import { PanelHead, Pop, Row, ShowSidebar } from "./ui";
import { ProjectQuickPick } from "./Projects";
import { ModeIcon, ModeRows } from "./Modes";
import { HomeUpdates } from "./Updates";
import { Sea } from "./Sea";
import { HomeCarry } from "./CarryOn";
import * as os from "./os";

type Props = { projectId?: string; onProject: (id: string) => void; onStarted: (threadId: string) => void; onCompare: (compareId: string) => void; sidebar: boolean; onSidebar: () => void; onNewAgent: () => void; startMode?: SessionMode; startPrompt?: { text: string; at: number } };

export function Home({ projectId, onProject, onStarted, onCompare, sidebar, onSidebar, onNewAgent, startMode, startPrompt }: Props) {
  // A design on its own (Project.kind "design") is never a project Home starts a session in.
  const all = useEngine((s) => s.projects);
  const projects = useMemo(() => listedProjects(all), [all]);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const engineSettings = useEngine((s) => s.settings);
  const access = useEngine((s) => s.settings.defaultAccess);
  const worktrees = useEngine((s) => s.settings.worktrees);
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  // Carry on's cards under the box, unless Settings turned them off ("Show Carry on on Home").
  const carryOn = useEngine((s) => carryOnOn(s.settings));
  // The ask a Carry on card writes into the box (the work not committed here), as the sidebar's panel does through App.
  const [carried, setCarried] = useState<{ text: string; at: number } | undefined>();
  const seed = carried && (!startPrompt || carried.at > startPrompt.at) ? carried : startPrompt;

  // What's ready, as a key that changes only when a tool or its models come or go, so your picks here aren't reset by a refresh.
  const readyKey = providers.map((p) => `${p.id}:${p.available && p.adapter ? p.models.length : 0}`).join();
  // Who a new session starts with: the project's own agent, else a pair, the best model or the fast one, as Settings say.
  const initial = useMemo((): RunSettings => {
    // The sample project's Demo starts as a pair, so its scripted lead and sidekick can be seen.
    if (project?.agent === "demo") return { agent: "demo", sidekick: "demo:demo", effort: startEffort("demo:demo", providers), access };
    // A project set to start with one of your agents (Settings › Projects): that agent, on its own.
    const own = agents.find((a) => a.id === project?.agent);
    if (own) return { agent: own.id, effort: own.effort, access };
    const firstModel = providers.find((p) => p.available && p.adapter && p.id !== "demo");
    const start = startOf(engineSettings, providers);
    // Starting as a pair, at a pair's effort (Settings' word when set, as near as the lead's model lists).
    // Alone, a model starts at its own default level as its tool reports it, else at the tool's own: never a word of the app's.
    if (start) return { ...start, effort: start.sidekick ? pairEffortFor(start.agent, providers, engineSettings.pairEffort) : startEffort(start.agent, providers), access };
    const first = firstModel ? `${firstModel.id}:${firstModel.models[0]?.id ?? "default"}` : undefined;
    return { agent: first ? `@${first}` : "demo", effort: startEffort(first ?? "demo:demo", providers), access };
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
  // The mode in the + menu, its name at the row's end; anything but Standard is a chip after the +, its cross putting Standard back.
  const modeChoice: PlusChoice = {
    key: "mode",
    label: "Mode",
    icon: <I.code size={16} />,
    value: modeName(mode_, agents),
    say: modeName(mode_, agents),
    body: (done) => <ModeRows value={mode_} onPick={pick} done={done} />,
    chip: mode_ !== "standard" ? <ChoiceChip icon={<ModeIcon mode={mode_} agents={agents} size={14} />} label={modeName(mode_, agents)} className={mode_ === "creator" ? "lc-mode-creator" : undefined} clear={{ label: "Back to Standard", onClear: () => pick("standard") }} /> : undefined,
  };
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
  /*
    A session made for an ask whose send was turned down (a file too big, a tool not ready): the composer
    puts the ask back, and sending it again goes to that session, while nothing is picked differently,
    rather than leaving one "Not started" session in the sidebar for each try.
  */
  const made = useRef<{ id: string; key: string } | null>(null);
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
      const left = made.current;
      made.current = null;
      const again = left && left.key === choicesKey ? getState().threads.find((x) => x.id === left.id && x.turns === 0 && !x.archived) : undefined;
      // The tool opened ahead for this draft isn't the one it goes to after all.
      if (again && id && id !== again.id) void rpc("thread.unwarmNew", { id }).catch(() => {});
      const tw = asMode === "standard" ? /^\/(teamwork|swarm)(?:\s+([\s\S]*))?$/i.exec(m.text.trim()) : null;
      const twMode = tw ? (tw[1].toLowerCase() === "swarm" ? "swarm" : "teamwork") : undefined;
      const sendText = tw ? (tw[2] ?? "").trim() : m.text;
      const t = again ?? await rpc("thread.create", { ...(id ? { id } : {}), projectId: project.id, mode: asMode, agent: settings.agent, sidekick: settings.sidekick, ...(tw ? { swarm: { enabled: true, mode: twMode } } : {}), ...(settings.sidekick && settings.tuning ? { tuning: settings.tuning } : {}), review: settings.review, model: settings.model, effort: settings.effort, access: settings.access, worktree: worktree && project.git && !inWorktree, base: worktree ? base : undefined, inWorktree: inWorktree?.path });
      if (tw && again && (!again.swarm?.enabled || (again.swarm.mode ?? "teamwork") !== twMode)) await rpc("swarm.enable", { threadId: t.id, enabled: true, mode: twMode });
      if (sendText || m.files.length) {
        try {
          await rpc("thread.send", { id: t.id, text: sendText, files: m.files });
        } catch (e) {
          made.current = { id: t.id, key: choicesKey };
          throw e;
        }
      }
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
    <div className="lc-home-in" data-mid={project ? "" : undefined}>
      {project ? (
        <>
          <div className="lc-home-head">
            {/* No mark above it (the owner's ruling): the headline alone, ink then grey. */}
            <h1 className="lc-home-h">
              What are we making? <span>Pick a folder, say it plainly.</span>
            </h1>
            <div className="lc-home-top">
              <ProjectName project={project} projects={projects} onPick={onProject} onSample={() => void add("@sample")} onScratch={() => void scratch()} />
              <WhereChip project={project} worktree={worktree} onWorktree={setWorktree} inWorktree={inWorktree} comparing={compare.length > 0 && mode_ === "standard"} />
              <span className="lc-grow" />
              <BranchChip project={project} worktree={worktree} base={base} onBase={setBase} inWorktree={inWorktree} comparing={compare.length > 0 && mode_ === "standard"} />
            </div>
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
              // Comparing models starts Standard sessions, so it's offered only in Standard.
              compare={project.git && mode_ === "standard" ? compare : undefined}
              onCompare={project.git && mode_ === "standard" ? setCompare : undefined}
              autoFocus
              seed={seed}
              choices={[modeChoice]}
              // The prompt check splits a draft of several tasks into sessions in this mode; Workshop isn't checked.
              mode={mode_}
              checkOff={mode_ === "creator"}
            />
          </div>
          <div className="lc-home-foot">{carryOn && <HomeCarry projectId={project.id} onOpen={onStarted} onCarryOn={(id, text) => (id !== project.id && onProject(id), setCarried({ text, at: Date.now() }))} />}</div>
        </>
      ) : (
        <div className="lc-noproj">
          <h2 className="lc-ask-h">Add a project to start</h2>
          <p className="lc-quiet">A project is a folder on {os.here}. Agents work inside it, and every turn is kept so you can undo it.</p>
          <div className="lc-noproj-acts">
            {/* The one action here is ink (white on dark), the others quiet beside it: Add a folder stays first, as it is what most come to do. */}
            <button type="button" className="lc-btn" data-kind="ink" onClick={() => void bridge.pickFolder().then(add)}>
              <I.folder size={14} />
              Add a folder
            </button>
            {engineSettings.showDemo && (
              <button type="button" className="lc-btn" data-kind="ghost" onClick={() => void add("@sample")}>
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
      {/* The sea behind it all (Sea.tsx), unless it's off in Settings, Appearance. */}
      <Sea />
      <header className="lc-top" data-drag>
        {!sidebar && (
          <ShowSidebar onShow={onSidebar} />
        )}
        {/* What this page is, as a session's row names its session; the rest of the row is the window's drag region. */}
        <b className="lc-home-crumb">New session</b>
        <span className="lc-grow" data-drag />
      </header>
      {ask}
      <HomeUpdates sidebar={sidebar} />
    </div>
  );
}


/** The project as the first chip over the box, its tile before its name: press it for your other projects, another folder or a scratch folder. */
function ProjectName({ project, projects, onPick, onSample, onScratch }: { project: Project; projects: Project[]; onPick: (id: string) => void; onSample: () => void; onScratch: () => void }) {
  const showDemo = useEngine((s) => s.settings.showDemo === true);
  return (
    <Pop
      label={`Project: ${project.name}. Change it`}
      width={260}
      triggerClass="lc-home-chip lc-home-name"
      trigger={
        <>
          <span className="lc-home-tile" aria-hidden>
            {tileLetters(project.name)}
          </span>
          <span className="lc-home-cap">{project.name}</span>
          <I.chevD size={12} />
        </>
      }
    >
      {(close) => (
        <ProjectQuickPick
          value={project.id}
          close={close}
          onPick={(p) => (onPick(p.id), close())}
          more={[
            ...(project.name !== "Scratch" ? [{ title: "A scratch folder", icon: <I.notes size={16} />, onPick: () => (close(), onScratch()) }] : []),
            ...(showDemo && !projects.some((p) => p.agent === "demo") ? [{ title: "Try the sample project", icon: <I.mark size={16} />, onPick: () => (close(), onSample()) }] : []),
          ]}
        />
      )}
    </Pop>
  );
}

const gitCache = new Map<string, Promise<RpcResult<"git.branches">>>();
const branchesFor = (projectId: string) => {
  if (!gitCache.has(projectId)) gitCache.set(projectId, rpc("git.branches", { projectId }).finally(() => setTimeout(() => gitCache.delete(projectId), 30000)));
  return gitCache.get(projectId)!;
};

/** The branches a new worktree can start from, the one picked ticked; this checkout's is the default (undefined). */
function BaseRows({ projectId, current, onPick }: { projectId: string; current?: string; onPick: (b: string | undefined) => void }) {
  // Kept with the project it was read for: another project's branches never show (or get picked) for this one.
  const [gitOf, setGitOf] = useState<{ projectId: string; git: RpcResult<"git.branches"> } | null>(null);
  useEffect(() => void branchesFor(projectId).then((git) => setGitOf({ projectId, git }), () => {}), [projectId]);
  const git = gitOf?.projectId === projectId ? gitOf.git : null;
  if (!git) return <p className="l-shimmer lc-pop-note">Reading the branches</p>;
  return (
    <>
      <PanelHead>Start the worktree from</PanelHead>
      {git.branches.slice(0, 14).map((b) => (
        <Row key={b.name} title={<span className="lc-mono">{b.name}</span>} note={[b.name === git.current ? "this checkout" : "", b.name === git.base ? "the default branch" : ""].filter(Boolean).join(" · ") || undefined} end={b.lastCommitAt ? since(b.lastCommitAt) : undefined} on={b.name === current} onPick={() => onPick(b.name === git.current ? undefined : b.name)} />
      ))}
    </>
  );
}

/**
  Where the session works, the second chip over the box: this Mac, in this checkout or in a new worktree. Its menu
  picks between the two. A project without git, or carrying on in a worktree, or comparing models (each gets a
  worktree of its own), says where it works with nothing to change.
*/
function WhereChip({ project, worktree, onWorktree, inWorktree, comparing }: { project: Project; worktree: boolean; onWorktree: (on: boolean) => void; inWorktree?: { path: string; branch?: string }; comparing: boolean }) {
  const fixed = !project.git ? os.Here : inWorktree ? `${os.Here} · this worktree` : comparing ? `${os.Here} · a worktree each` : undefined;
  if (fixed)
    return (
      <span className="lc-home-chip" data-still title={inWorktree ? "Carrying on in this worktree" : comparing ? "Each model works in a worktree of its own" : undefined}>
        <I.laptop size={14} />
        <span className="lc-home-cap">{fixed}</span>
      </span>
    );
  return (
    <Pop
      label={worktree ? "Where it works: a new worktree. Change it" : "Where it works: this checkout. Change it"}
      width={260}
      menu
      triggerClass="lc-home-chip"
      trigger={
        <>
          <I.laptop size={14} />
          <span className="lc-home-cap">
            {os.Here} · {worktree ? "new worktree" : "this checkout"}
          </span>
          <I.chevD size={12} />
        </>
      }
    >
      {(close) => (
        <>
          <Row title="This checkout" on={!worktree} onPick={() => (onWorktree(false), close())} />
          <Row title="A new worktree" on={worktree} onPick={() => (onWorktree(true), close())} />
        </>
      )}
    </Pop>
  );
}

/**
  The branch, at the right end of the row over the box: in this checkout, the branch it is on (said "directly" in grey
  on main or master, its tooltip saying how to keep apart); with a new worktree, the branch it starts from, which its
  menu picks. A project without git has no chip.
*/
function BranchChip({ project, worktree, base, onBase, inWorktree, comparing }: { project: Project; worktree: boolean; base?: string; onBase: (b: string | undefined) => void; inWorktree?: { path: string; branch?: string }; comparing: boolean }) {
  const branch = inWorktree?.branch ?? project.branch;
  if (!project.git) return null;
  if (!worktree || inWorktree || comparing) {
    const onDefault = !inWorktree && !comparing && (branch === "main" || branch === "master");
    return (
      <span className="lc-home-chip lc-home-branch" data-still title={onDefault ? `Editing directly on ${branch}: pick a new worktree to keep this apart` : comparing ? "Each model's worktree starts from this branch" : undefined}>
        <I.branch size={14} />
        <span className="lc-mono lc-home-cap">{branch ?? "HEAD"}</span>
        {onDefault && <span className="lc-home-direct">directly</span>}
      </span>
    );
  }
  const from = base ?? project.branch ?? "HEAD";
  return (
    <Pop
      label={`A new worktree from ${from}. Change the branch`}
      align="end"
      width={260}
      menu
      triggerClass="lc-home-chip lc-home-branch"
      trigger={
        <>
          <I.branch size={14} />
          <span className="lc-home-cap">
            from <span className="lc-mono">{from}</span>
          </span>
          <I.chevD size={12} />
        </>
      }
    >
      {(close) => <BaseRows projectId={project.id} current={base ?? project.branch} onPick={(b) => (onBase(b), close())} />}
    </Pop>
  );
}
