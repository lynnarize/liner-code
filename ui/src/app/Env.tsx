/*
  Where a session lives and what to do with it, from one button in its bar: the Mac and the
  folder it works in, opening that folder in your editor, a new project script, its branch,
  committing and pushing, and its changes. Rows are the app's menu rows (ui.tsx Row); one with a ›
  opens its list in the menu's place, with the way back on top. Commit opens Changes with its
  commit form open.
*/
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Project, RpcResult, Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "./bridge";
import { type Then } from "./Commit";
import { askCommit } from "./commit-ask";
import { rpc } from "./engine";
import { I } from "./icons";
import { plural } from "./model";
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

function EnvPanel({ thread, project, files, lines, onChanges, close, actions }: { thread: Thread; project: Project; files: number; lines: { added: number; removed: number }; onChanges: () => void; close: () => void; actions?: (close: () => void) => ReactNode }) {
  const [more, setMore] = useState<More>(null);
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
          {/* Where it runs, in the Session popup's words; its folder's path in the row's tooltip and at the foot of its list. */}
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
