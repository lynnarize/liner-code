/*
  Where a session lives and what to do with it, from one button in its bar: the Mac and the
  folder it works in, opening that folder in your editor, a new project script, its branch,
  committing and pushing, and its changes. Rows are the app's menu rows (ui.tsx Row); one with a ›
  opens its list in the menu's place, with the way back on top. Commit opens Changes with its
  commit form open.
*/
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { isSwarm, type LocalServer, type Project, type RpcResult, type SessionInfo, type Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "./bridge";
import { type Then } from "./Commit";
import { askCommit } from "./commit-ask";
import { rpc, useEngine, useItemsWhere, useSwarm } from "./engine";
import { I, StateMark, StepMark } from "./icons";
import { crewRows, isCrewItem, showAgent, useCrew } from "./Crew";
import { asksYou } from "./session-state";
import { countUnder, foldOf, hasAgents, setFold, shownRows, swarmRows, type RowState } from "./agent-rows";
import { duration, plural } from "./model";
import { agentsWorked } from "./session-pop";
import { runScript } from "./Surfaces";
import { prEnd } from "./surface-row";
import { CardContext, CardSetup } from "./DetailsParts";
import { BackRow, Lines, MenuFoot, PanelHead, Pop, Row, Sep } from "./ui";
import * as os from "./os";

type More = "mac" | "editor" | "script" | "branch" | "commit" | null;
type Editor = RpcResult<"apps.editors">[number];

const tilde = os.tilde;
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const saved = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const keep = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private window: remembered until it closes
  }
};
const THEN: { id: Then; title: string; note: string }[] = [
  { id: "push", title: "Commit and push", note: "To its branch on GitHub" },
  { id: "pr", title: "Commit and open a pull request", note: "The pull request card, in the chat" },
  { id: "commit", title: "Commit", note: `Only here, on ${os.here}` },
];
/** What follows a commit, as the value at the end of "After committing". */
const THEN_WORD: Record<Then, string> = { push: "Push", pr: "Open a pull request", commit: "Nothing" };

/**
  The session's menu, opened from its title (Claude Code's title menu, TasteCode's chat menu): the
  session's own actions first (its details in the Session surface, rename, pin, open beside), then where it works: the machine and folder, your editor, project scripts, the branch,
  and committing what changed.
*/
export function EnvMenu({ thread, project, files, lines, onChanges, onRename, actions }: { thread: Thread; project: Project; files: number; lines: { added: number; removed: number }; onChanges: () => void; onRename: () => void; actions?: (close: () => void) => ReactNode }) {
  // The session's title is the button, with a small chevron, as in Claude Code. A double-click still renames it.
  return (
    <Pop
      label={`${thread.title}: the session's menu, its details, to rename it, pin it, or change where it works`}
      align="start"
      width={340}
      className="lc-tt-pop"
      triggerClass="lc-tt"
      trigger={
        <>
          <span className="lc-title" key={thread.title} onDoubleClick={onRename}>
            {thread.title}
          </span>
          <I.caret size={16} />
        </>
      }
    >
      {(close) => (
        <>
          <EnvPanel thread={thread} project={project} files={files} lines={lines} onChanges={onChanges} close={close} actions={actions} />
        </>
      )}
    </Pop>
  );
}

/**
  `only`: one of the lists alone, as the session details card opens it from its row (Session.tsx DetailsCard): its way back
  closes it, as there is no menu behind it. `look`: the card's Look again, at the foot of the Mac's list (where it runs is
  what it reads again, with the pull request).
*/
function EnvPanel({ thread, project, files, lines, onChanges, close, actions, only, look }: { thread: Thread; project: Project; files: number; lines: { added: number; removed: number }; onChanges: () => void; close: () => void; actions?: (close: () => void) => ReactNode; only?: Exclude<More, null>; look?: { looking: boolean; onLook: () => void } }) {
  const [more, setMore] = useState<More>(only ?? null);
  const [editors, setEditors] = useState<Editor[] | null>(null);
  const [git, setGit] = useState<RpcResult<"git.branches"> | null>(null);
  const [status, setStatus] = useState<RpcResult<"git.status"> | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [then, setThen] = useState<Then>(() => (saved("lc:commit-then") as Then) ?? "push");
  const [script, setScript] = useState({ name: "", command: "" });
  const [newBranch, setNewBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const cwd = thread.worktree?.path ?? project.path;
  const branch = thread.worktree?.branch ?? project.branch;
  const running = thread.status === "running";
  // A list opens in the menu's place, with the way back on top (ui.tsx BackRow); Escape comes back first, onto the row that opened it.
  const box = useRef<HTMLDivElement>(null);
  const focusIn = (sel: string) => requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true }));
  const go = (m: More) => (setMore(m), focusIn("input:not(:disabled), button[data-on], button:not([data-back]):not(:disabled)"));
  const back = () => {
    if (only) return close();
    const was = more;
    setMore(null);
    focusIn(`[data-opens="${was}"]`);
  };

  useEffect(() => {
    void rpc("apps.editors", {})
      .then(setEditors)
      .catch(() => setEditors([]));
    if (project.git) {
      void rpc("git.branches", { projectId: project.id }).then(setGit).catch(() => {});
      void rpc("git.status", { projectId: project.id, threadId: thread.id }).then(setStatus).catch(() => {});
    }
  }, [project.id, thread.id]);

  const syncBranch = async (rebase = false) => {
    setSyncing(true);
    try {
      const r = await rpc("git.sync", { projectId: project.id, threadId: thread.id, rebase });
      setStatus((prev) => ({ branch: r.branch, ahead: r.ahead, behind: r.behind, changes: prev?.changes ?? [] }));
      toast.success(r.pulled ? `Pulled ${r.branch ?? "branch"}` : "Up to date with origin");
    } catch (e) {
      fail(e);
    } finally {
      setSyncing(false);
    }
  };

  const editor = editors?.find((e) => e.id === saved("lc:editor")) ?? editors?.find((e) => e.kind === "editor") ?? editors?.[0];
  const openIn = (app?: Editor) => {
    close();
    if (!app) return bridge.openIn(cwd, "editor");
    keep("lc:editor", app.id);
    void rpc("apps.open", { path: cwd, app: app.id }).catch(fail);
  };

  const addScript = async (name: string, command: string) => {
    if (!name.trim() || !command.trim()) return;
    try {
      await rpc("project.update", { id: project.id, scripts: [...(project.scripts ?? []), { id: `s${Date.now().toString(36)}`, name: name.trim(), command: command.trim() }] });
      toast.success(`Added ${name.trim()}`, { description: "Run it from the play button in the bar." });
      setScript({ name: "", command: "" });
      back();
    } catch (e) {
      fail(e);
    }
  };
  const fromPackage = (git?.npmScripts ?? []).filter((n) => !(project.scripts ?? []).some((x) => x.command === `npm run ${n}`)).slice(0, 4);

  const switchTo = async (name: string, create = false) => {
    setBusy(true);
    try {
      const r = await rpc("git.switch", { threadId: thread.id, branch: name, create });
      toast.success(create ? `Made ${r.branch} and switched to it` : `Switched to ${r.branch}`);
      close();
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };

  // With files to commit, Changes opens with its commit form open, as one place to commit (commit-ask.ts); with
  // nothing to commit, the row does the step after: a push, or the pull request card.
  const commitRow = () => {
    if (files > 0) return (close(), askCommit(thread.id, then), onChanges());
    if (then === "commit") return;
    close();
    if (then === "pr") return void rpc("thread.send", { id: thread.id, text: "create pr" }).catch(fail);
    void rpc("git.push", { threadId: thread.id })
      .then((p) => toast.success(`Pushed ${p.branch} to ${p.remote}`))
      .catch(fail);
  };
  const how = THEN.find((x) => x.id === then)!;
  const commitTitle = files > 0 ? how.title : then === "pr" ? "Open a pull request" : then === "push" ? "Push" : "Commit";

  const scripts = (project.scripts ?? []).length;
  const ahead = status && (status.ahead > 0 || status.behind > 0) ? `↑${status.ahead} ↓${status.behind}` : undefined;
  const scriptReady = Boolean(script.name.trim() && script.command.trim());

  return (
    <div ref={box} className="lc-envp" onKeyDown={(e) => more && e.key === "Escape" && !e.defaultPrevented && (e.preventDefault(), back())}>
      {more === "mac" ? (
        <>
          <BackRow name="This Mac" rove={false} onBack={back} />
          <Row title={`Show in ${os.fileManager}`} icon={<I.folder size={14} />} onPick={() => (close(), bridge.openIn(cwd, "finder"))} />
          <Row title="Copy the path" icon={<I.copy size={14} />} onPick={() => (void navigator.clipboard?.writeText(cwd), toast("Copied the path"), close())} />
          <Row title="Open it in Terminal" icon={<I.terminal size={14} />} onPick={() => (close(), bridge.openIn(cwd, "terminal"))} />
          {look && <Row title="Look again" note="Reads where it runs, its context and its pull request again" icon={<I.refresh size={14} />} disabled={look.looking} onPick={() => (close(), look.onLook())} />}
          <MenuFoot>
            <span className="lc-mono">{tilde(cwd)}</span>
            {thread.worktree && <span className="lc-envp-why">A worktree of its own, so other sessions never edit these files.</span>}
          </MenuFoot>
        </>
      ) : more === "editor" ? (
        <>
          <BackRow name="Editor" rove={false} onBack={back} />
          {(editors ?? []).map((e) => (
            <Row key={e.id} title={e.name} icon={<I.edit size={14} />} end={e.kind === "terminal" ? "Terminal" : undefined} on={e.id === editor?.id} onPick={() => openIn(e)} />
          ))}
        </>
      ) : more === "script" ? (
        <>
          <BackRow name="Add project script" rove={false} onBack={back} />
          <form
            className="lc-env-form"
            onSubmit={(e) => {
              e.preventDefault();
              void addScript(script.name, script.command);
            }}
          >
            <input className="lc-input" value={script.name} onChange={(e) => setScript((x) => ({ ...x, name: e.target.value }))} placeholder="Name, like Dev server" aria-label="Script name" />
            <input className="lc-input lc-mono" value={script.command} onChange={(e) => setScript((x) => ({ ...x, command: e.target.value }))} placeholder="npm run dev" aria-label="Command" />
            {/* Enter in either field adds it; the row under them does the same. */}
            <button type="submit" hidden disabled={!scriptReady} />
          </form>
          <Row title="Add it" icon={<I.plus size={14} />} disabled={!scriptReady} onPick={() => void addScript(script.name, script.command)} />
          {fromPackage.length > 0 && (
            <>
              <Sep />
              <PanelHead>From package.json</PanelHead>
              {fromPackage.map((n) => (
                <Row key={n} title={<span className="lc-mono">npm run {n}</span>} icon={<I.plus size={14} />} onPick={() => void addScript(n, `npm run ${n}`)} />
              ))}
            </>
          )}
        </>
      ) : more === "branch" ? (
        <>
          <BackRow name="Branch" rove={false} onBack={back} />
          <Row title={status && status.behind > 0 ? `Fetch and pull (${status.behind} behind)` : "Fetch from origin"} icon={<I.refresh size={14} />} end={ahead} disabled={syncing || running} onPick={() => void syncBranch(false)} />
          {!thread.worktree &&
            (git?.branches ?? [])
              .filter((b) => !git?.worktrees.some((w) => w.branch === b.name))
              .slice(0, 8)
              .map((b) => <Row key={b.name} title={<span className="lc-mono">{b.name}</span>} icon={<I.branch size={14} />} on={b.name === branch} disabled={busy || running || b.name === branch} onPick={() => void switchTo(b.name)} />)}
          <Sep />
          <form
            className="lc-env-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (newBranch.trim()) void switchTo(newBranch.trim(), true);
            }}
          >
            <input className="lc-input lc-mono" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="new-branch-name" aria-label="New branch from here" disabled={running} />
            <button type="submit" hidden disabled={!newBranch.trim() || busy || running} />
          </form>
          <Row title={thread.worktree ? "New branch from here" : "New branch"} icon={<I.plus size={14} />} disabled={!newBranch.trim() || busy || running} onPick={() => void switchTo(newBranch.trim(), true)} />
          {running && <MenuFoot>Branch actions wait until the turn finishes.</MenuFoot>}
        </>
      ) : more === "commit" ? (
        <>
          <BackRow name="After committing" rove={false} onBack={back} />
          {THEN.map((x) => (
            <Row
              key={x.id}
              title={x.title}
              note={x.note}
              icon={<I.push size={14} />}
              on={x.id === then}
              onPick={() => {
                setThen(x.id);
                keep("lc:commit-then", x.id);
                back();
              }}
            />
          ))}
        </>
      ) : (
        <>
          {actions?.(close)}
          {/* Where it runs, in the Session card's words; its folder's path in the row's tooltip and at the foot of its list. */}
          <Row title="This Mac" note={tilde(cwd)} icon={<I.laptop size={14} />} end={thread.worktree ? "its own worktree" : "the checkout"} opens="mac" onPick={() => go("mac")} />
          <Row title={editor ? `Open in ${editor.name}` : "Open in your editor"} icon={<I.edit size={14} />} onPick={() => openIn(editor)} />
          {editors && editors.length > 1 && <Row title="Editor" icon={<I.code size={14} />} end={editor?.name} opens="editor" onPick={() => go("editor")} />}
          <Row title="Add project script" icon={<I.plus size={14} />} end={scripts ? plural(scripts, "script") : undefined} opens="script" onPick={() => go("script")} />
          <Sep />
          {project.git && <Row title={<span className="lc-mono">{branch ?? "No branch"}</span>} icon={<I.branch size={14} />} end={ahead} opens="branch" onPick={() => go("branch")} />}
          {project.git && <Row title={commitTitle} note={files > 0 ? "Opens Changes with the commit's message" : undefined} icon={<I.push size={14} />} end={files > 0 ? plural(files, "file") : "Nothing to commit"} disabled={running || (files === 0 && then === "commit")} onPick={commitRow} />}
          {project.git && <Row title="After committing" icon={<I.sliders size={14} />} end={THEN_WORD[then]} opens="commit" onPick={() => go("commit")} />}
          <Row title={files > 0 ? `${plural(files, "file")} changed` : lines.added || lines.removed ? "Changes" : "No changes yet"} icon={<I.changes size={14} />} end={lines.added || lines.removed ? <Lines {...lines} /> : undefined} chevron={Boolean(lines.added || lines.removed)} disabled={!lines.added && !lines.removed} onPick={() => (close(), onChanges())} />
        </>
      )}
    </div>
  );
}

/**
  The session details card (line and dot, board Details, 2026-11-27): it floats under the top row's right end from its first
  toggle (Session.tsx), whether or not the panel is open, and since the Session surface went from the panel (the owner,
  2026-11-27: "session as 1 in pop up rather than 2") it is the one place for everything about a session. Rows 30 high, as
  lean as a menu's, each doing what its row in the title's menu does, or opening the surface that shows more: where it runs,
  with the folder a press away and the Mac's own list to the side (Look again at its foot); your editor; the project's
  scripts (each runs in a shell of its own) and what of the session's listens, with its port; Add a project script. Then the
  branch, Commit, Changes and the pull request; then Context with its Compact and its bar of dots, unfolding in place
  (DetailsParts.tsx); then Setup, a menu of six to the side; then the agents, while it has any. It says no money: what the
  session costs is Usage's to say.
*/
export function DetailsCard({ thread, project, files, lines, onChanges, onPr, onAgents, onTerminal }: { thread: Thread; project: Project; files: number; lines: { added: number; removed: number }; onChanges: () => void; onPr: () => void; onAgents: () => void; onTerminal: () => void }) {
  const [editors, setEditors] = useState<Editor[] | null>(null);
  const [servers, setServers] = useState<LocalServer[]>([]);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [looking, setLooking] = useState(false);
  const cwd = thread.worktree?.path ?? project.path;
  const branch = thread.worktree?.branch ?? project.branch;
  const running = thread.status === "running";
  useEffect(() => {
    void rpc("apps.editors", {}).then(setEditors, () => setEditors([]));
  }, []);
  // Only the latest ask is shown: one sent as a turn started can answer after the one sent as it ended.
  const asked = useRef(0);
  /*
    What listens and how full the context is: asked when the card shows, and again as a turn starts or ends. Only what this
    session started is listed: a server another session, a terminal or another tool runs in the same folder isn't this
    session's. Look again (the Mac's list) asks once more, and asks GitHub how the pull request stands too, as the Session
    surface's did; between, the engine's own watch keeps the pull request's row current.
  */
  const look = (again = false) => {
    const n = ++asked.current;
    if (again) setLooking(true);
    void rpc("ports.list", { threadId: thread.id }).then((l) => n === asked.current && setServers(l.filter((x) => x.owner === "session")), () => {});
    const reads: Promise<unknown>[] = [rpc("thread.info", { id: thread.id }).then((i) => n === asked.current && setInfo(i), () => {})];
    if (again && thread.pr) reads.push(rpc("pr.status", { threadId: thread.id }).catch(() => {}));
    if (again) void Promise.all(reads).finally(() => n === asked.current && setLooking(false));
  };
  useEffect(() => look(), [thread.id, thread.turns, running]);
  const editor = editors?.find((e) => e.id === saved("lc:editor")) ?? editors?.find((e) => e.kind === "editor") ?? editors?.[0];
  const openIn = (app?: Editor) => {
    if (!app) return bridge.openIn(cwd, "editor");
    keep("lc:editor", app.id);
    void rpc("apps.open", { path: cwd, app: app.id }).catch(fail);
  };
  const then = (saved("lc:commit-then") as Then | null) ?? "push";
  // Commit as the title's menu commits: with files, Changes opens with its commit form; with none, the step after it.
  const commit = () => {
    if (files > 0) return (askCommit(thread.id, then), onChanges());
    if (then === "pr") return void rpc("thread.send", { id: thread.id, text: "create pr" }).catch(fail);
    if (then === "push")
      void rpc("git.push", { threadId: thread.id })
        .then((p) => toast.success(`Pushed ${p.branch} to ${p.remote}`))
        .catch(fail);
  };
  const panel = (more: Exclude<More, null>, label: string) => (
    <Pop label={label} menu align="end" width={300} triggerClass="lc-dr-end l-focus" triggerAttrs={{ title: label }} trigger={<I.chevD size={14} />}>
      {(close) => <EnvPanel thread={thread} project={project} files={files} lines={lines} onChanges={onChanges} close={close} only={more} look={more === "mac" ? { looking, onLook: () => look(true) } : undefined} />}
    </Pop>
  );
  const pr = thread.pr && prEnd(thread.pr);
  return (
    <div className="lc-dcard" role="group" aria-label="Session details">
      <div className="lc-dr">
        <button type="button" className="lc-dr-main l-focus" title={tilde(cwd)} onClick={() => bridge.openIn(cwd, "finder")}>
          <I.laptop size={14} />
          <span className="lc-dr-t">{os.here[0].toUpperCase() + os.here.slice(1)}</span>
          <em>{thread.worktree ? "in a worktree" : "in the checkout"}</em>
        </button>
        <button type="button" className="lc-dr-end l-focus" aria-label={`Show the folder in ${os.fileManager}`} title={`Show the folder in ${os.fileManager}`} onClick={() => bridge.openIn(cwd, "finder")}>
          <I.folder size={14} />
        </button>
        {panel("mac", "Where it runs")}
      </div>
      <div className="lc-dr">
        <button type="button" className="lc-dr-main l-focus" onClick={() => openIn(editor)}>
          <I.edit size={14} />
          <span className="lc-dr-t">{editor ? `Open in ${editor.name}` : "Open in your editor"}</span>
        </button>
        {editors && editors.length > 1 && panel("editor", "Pick your editor")}
      </div>
      {(project.scripts ?? []).map((x) => (
        <div key={x.id} className="lc-dr">
          <button type="button" className="lc-dr-main l-focus" title={x.command} onClick={() => (runScript(thread.id, x), onTerminal())}>
            <I.play size={14} />
            <span className="lc-dr-t lc-mono">{x.name}</span>
          </button>
        </div>
      ))}
      {servers.map((x) => (
        <div key={x.port} className="lc-dr">
          <span className="lc-dr-main" title={x.url}>
            <I.server size={14} />
            <span className="lc-dr-t lc-mono">{x.process}</span>
            <span className="lc-dr-v">
              <i className="lc-dr-dot" aria-hidden />
              <span className="l-num">{x.port}</span>
            </span>
          </span>
        </div>
      ))}
      <div className="lc-dr" data-quiet>
        <Pop label="Add a project script" menu align="end" width={300} triggerClass="lc-dr-main lc-dr-add l-focus" trigger={<><I.plus size={14} /><span className="lc-dr-t">Add a project script</span></>}>
          {(close) => <EnvPanel thread={thread} project={project} files={files} lines={lines} onChanges={onChanges} close={close} only="script" />}
        </Pop>
      </div>
      {project.git && (
        <>
          <span className="lc-dr-sep" role="separator" />
          <div className="lc-dr">
            <span className="lc-dr-main">
              <I.branch size={14} />
              <span className="lc-dr-t lc-mono">{branch ?? "No branch"}</span>
            </span>
            {panel("branch", "Branch")}
          </div>
          <div className="lc-dr">
            <button type="button" className="lc-dr-main l-focus" disabled={running || (files === 0 && then === "commit")} title={running ? "Once the turn ends" : undefined} onClick={commit}>
              <I.commit size={14} />
              <span className="lc-dr-t">{files > 0 ? "Commit" : then === "pr" ? "Open a pull request" : then === "push" ? "Push" : "Commit"}</span>
              {files > 0 && <em>{plural(files, "file")}</em>}
            </button>
            {panel("commit", "After committing")}
          </div>
        </>
      )}
      <div className="lc-dr">
        <button type="button" className="lc-dr-main l-focus" disabled={!files && !lines.added && !lines.removed} onClick={onChanges}>
          <I.changes size={14} />
          <span className="lc-dr-t">Changes</span>
          <em>{files > 0 || lines.added || lines.removed ? "Not committed" : "None yet"}</em>
          {(lines.added > 0 || lines.removed > 0) && (
            <span className="lc-dr-v">
              <Lines {...lines} />
            </span>
          )}
        </button>
      </div>
      {/* The pull request, as the panel's start page says it (surface-row.ts prEnd): its number in grey, its state in its colour. */}
      {thread.pr && pr && (
        <div className="lc-dr">
          <button type="button" className="lc-dr-main l-focus" title={thread.pr.checks?.failed ? `${plural(thread.pr.checks.failed, "check")} failed` : undefined} onClick={onPr}>
            <I.pr size={14} />
            <span className="lc-dr-t">Pull request</span>
            <em className="l-num">#{thread.pr.number}</em>
            <span className="lc-dr-v" data-tone={pr.tone}>
              {pr.word}
            </span>
          </button>
        </div>
      )}
      <span className="lc-dr-sep" role="separator" />
      <CardContext thread={thread} info={info} />
      <span className="lc-dr-sep" role="separator" />
      <CardSetup thread={thread} />
      <CardAgents thread={thread} onAgents={onAgents} />
    </div>
  );
}

/** A row's state mark: the moving 3x3 at work (the one sign of that agent's work in view), a green tick, amber, red, or a quiet ring. */
const ROW_MARK: Record<RowState, ReactNode> = {
  working: <StepMark state="working" live size={12} label="Working" />,
  done: <StepMark state="done" tone="ok" size={12} label="Finished" />,
  waits: <StateMark state="needs" size={12} label="Waits for you" />,
  failed: <StateMark state="problem" size={12} label="Ran into a problem" />,
  idle: <StepMark state="skipped" size={12} label="Stopped, or not started" />,
};

/**
  The card's agents (the owner's ask after Antigravity's overview card, in line and dot): only while the session has agents
  at all (agent-rows.ts hasAgents, as the Session surface's row asks); a rule, a grey label with the mode and how many, which
  opens the Agents surface; then the tree as the Agents surface and the agents popup build it (Crew.tsx crewRows, teamTree),
  in compact 28px rows on a guide line, folding, eight at most. It reads what the app already holds: no ask of its own.
*/
function CardAgents({ thread, onAgents }: { thread: Thread; onAgents: () => void }) {
  const providers = useEngine((s) => s.providers);
  const crew = useCrew(thread);
  const items = useItemsWhere(thread.id, isCrewItem);
  const swarmOn = isSwarm(thread);
  const swarm = useSwarm(thread.id, swarmOn);
  const [, refold] = useState(0);
  const { count: worked, seconds } = agentsWorked(items);
  if (!hasAgents({ sidekick: thread.sidekick, swarm: swarmOn, atWork: thread.agentsAtWork, worked })) return null;
  const asking = thread.status === "waiting" && asksYou(thread);
  const roots = swarmOn && swarm ? swarmRows(swarm.members, swarm.mode === "swarm", Boolean(swarm.paused)) : crew ? crewRows(crew, providers, asking) : [];
  const { rows, more } = shownRows(roots, (n) => foldOf(thread.id, n));
  const mode = swarmOn ? ((swarm?.mode ?? thread.swarm?.mode) === "swarm" ? "Swarm" : "Teamwork") : thread.sidekick ? "Fusion" : "Subagents";
  // How many agents: a team's members under its coordinator, or the agents the models sent (their parts are not counted).
  const count = swarmOn ? roots.reduce((n, r) => n + countUnder(r), 0) : Math.max(worked, roots.reduce((n, r) => n + countUnder(r), 0));
  const open = (item?: string) => (item ? showAgent(thread.id, item) : onAgents());
  return (
    <>
      <span className="lc-dr-sep" role="separator" />
      <div className="lc-dr" data-head>
        {/* How long they worked, which the Session surface's "N agents worked" row said, is in its tip. */}
        <button type="button" className="lc-dr-main lc-da-head l-focus" title={worked > 0 && duration(seconds) ? `${plural(worked, "agent")} worked for ${duration(seconds)}. Open the Agents surface` : "Open the Agents surface"} onClick={onAgents}>
          {thread.sidekick && !swarmOn ? <I.mark size={14} /> : <I.agents size={14} />}
          <span className="lc-dr-t">{mode}</span>
          {count > 0 && <span className="lc-da-n l-num">{count}</span>}
          <span className="lc-dr-v">
            <I.chevR size={14} />
          </span>
        </button>
      </div>
      {rows.map(({ node, depth, count: under, open: unfolded, folds }) => (
        <div key={node.key} className="lc-da" style={{ "--lc-da-d": depth } as CSSProperties}>
          <button type="button" className="lc-da-main l-focus" title={node.now ? `${node.name}: ${node.now}` : node.name} onClick={() => open(node.item)}>
            {ROW_MARK[node.state]}
            <span className="lc-da-t">{node.name}</span>
            {node.role && <span className="lc-da-role">{node.role}</span>}
            {!under && node.now && <span className="lc-da-now">{node.now}</span>}
          </button>
          {folds ? (
            <button type="button" className="lc-da-fold l-focus" aria-expanded={unfolded} aria-label={`${unfolded ? "Fold" : "Unfold"} ${plural(under, "agent")} under ${node.name}`} onClick={() => (setFold(thread.id, node.key, !unfolded), refold((n) => n + 1))}>
              <span className="l-num">{under}</span>
              <I.chevD size={12} />
            </button>
          ) : under > 0 ? (
            <span className="lc-da-fold" data-still>
              <span className="l-num">{under}</span>
            </span>
          ) : null}
        </div>
      ))}
      {more > 0 && (
        <div className="lc-da">
          <button type="button" className="lc-da-main lc-da-more l-focus" onClick={onAgents}>
            {more} more
          </button>
        </div>
      )}
    </>
  );
}
