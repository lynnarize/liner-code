/*
  Where a session lives and what to do with it, from one button in its bar: the Mac and the
  folder it works in, opening that folder in your editor, a new project script, its branch,
  committing and pushing, and its changes. A row with a chevron opens in place, one at a time,
  to pick from; the row itself does the usual thing.
*/
import { useEffect, useState, type ReactNode } from "react";
import type { Project, RpcResult, Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { bridge } from "./bridge";
import { CommitForm, type Then } from "./Commit";
import { rpc } from "./engine";
import { I } from "./icons";
import { plural } from "./model";
import { Lines, Pop, Sep } from "./ui";

type More = "mac" | "editor" | "script" | "branch" | "commit" | null;
type Editor = RpcResult<"apps.editors">[number];

const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
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
  { id: "push", title: "Commit & push", note: "To its branch on GitHub" },
  { id: "pr", title: "Commit & open a PR", note: "The PR card, in the chat" },
  { id: "commit", title: "Commit", note: "Only here, on this Mac" },
];

export function EnvMenu({ thread, project, files, lines, onChanges }: { thread: Thread; project: Project; files: number; lines: { added: number; removed: number }; onChanges: () => void }) {
  return (
    <Pop label="Where this session works" align="end" width={340} triggerClass="lc-tb" trigger={<I.laptop size={16} />}>
      {(close) => <EnvPanel thread={thread} project={project} files={files} lines={lines} onChanges={onChanges} close={close} />}
    </Pop>
  );
}

/** A row that does its thing, with an optional button beside it and a chevron that opens more under it. */
function Line({ icon, title, note, end, side, open, onPick, onMore, disabled, children }: { icon: ReactNode; title: ReactNode; note?: ReactNode; end?: ReactNode; side?: ReactNode; open?: boolean; onPick?: () => void; onMore?: () => void; disabled?: boolean; children?: ReactNode }) {
  return (
    <div className="lc-env" data-open={open || undefined}>
      <div className="lc-env-l">
        <button type="button" className="lc-row l-focus" disabled={disabled} onClick={onPick ?? onMore}>
          <span className="lc-row-tick">{icon}</span>
          <span className="lc-row-t">
            <b>{title}</b>
            {note && <small>{note}</small>}
          </span>
          {end && <span className="lc-row-end">{end}</span>}
        </button>
        {side}
        {onMore && (
          <button type="button" className="lc-env-b l-focus" aria-expanded={open} aria-label="More choices" title="More choices" onClick={onMore}>
            <I.chevD size={12} />
          </button>
        )}
      </div>
      {children !== undefined && (
        <div className="lc-fold" inert={!open || undefined}>
          <div>
            <div className="lc-env-in">{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A choice inside an opened row. */
const Pick = ({ title, note, on, icon, disabled, onPick }: { title: ReactNode; note?: ReactNode; on?: boolean; icon?: ReactNode; disabled?: boolean; onPick: () => void }) => (
  <button type="button" className="lc-env-p l-focus" data-on={on || undefined} disabled={disabled} onClick={onPick}>
    <span className="lc-env-pi">{on ? <I.check size={12} /> : icon}</span>
    <span>{title}</span>
    {note && <small>{note}</small>}
  </button>
);

function EnvPanel({ thread, project, files, lines, onChanges, close }: { thread: Thread; project: Project; files: number; lines: { added: number; removed: number }; onChanges: () => void; close: () => void }) {
  const [more, setMore] = useState<More>(null);
  const [editors, setEditors] = useState<Editor[] | null>(null);
  const [git, setGit] = useState<RpcResult<"git.branches"> | null>(null);
  const [then, setThen] = useState<Then>(() => (saved("lc:commit-then") as Then) ?? "push");
  const [committing, setCommitting] = useState(false);
  const [script, setScript] = useState({ name: "", command: "" });
  const [newBranch, setNewBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const cwd = thread.worktree?.path ?? project.path;
  const branch = thread.worktree?.branch ?? project.branch;
  const running = thread.status === "running";
  const toggle = (m: More) => setMore((x) => (x === m ? null : m));

  useEffect(() => {
    void rpc("apps.editors", {})
      .then(setEditors)
      .catch(() => setEditors([]));
    if (project.git) void rpc("git.branches", { projectId: project.id }).then(setGit).catch(() => {});
  }, [project.id]);

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
      setMore(null);
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

  // With nothing to commit, the row does the step after: a push, or the PR card.
  const commitRow = () => {
    if (files > 0) return (setCommitting(true), setMore("commit"));
    if (then === "commit") return;
    close();
    if (then === "pr") return void rpc("thread.send", { id: thread.id, text: "create pr" }).catch(fail);
    void rpc("git.push", { threadId: thread.id })
      .then((p) => toast.success(`Pushed ${p.branch} to ${p.remote}`))
      .catch(fail);
  };
  const how = THEN.find((x) => x.id === then)!;
  const commitTitle = files > 0 ? how.title : then === "pr" ? "Open a PR" : then === "push" ? "Push" : "Commit";

  return (
    <div className="lc-envp">
      <Line
        icon={<I.laptop size={14} />}
        title={window.__LINER__?.machine ?? "This Mac"}
        note={<span className="lc-mono">{tilde(cwd)}</span>}
        side={
          <button type="button" className="lc-env-b l-focus" aria-label="Show in Finder" title="Show in Finder" onClick={() => (close(), bridge.openIn(cwd, "finder"))}>
            <I.folder size={13} />
          </button>
        }
        open={more === "mac"}
        onMore={() => toggle("mac")}
      >
        <Pick title="Copy the path" icon={<I.copy size={12} />} onPick={() => (void navigator.clipboard?.writeText(cwd), toast("Copied the path"), close())} />
        <Pick title="Open it in Terminal" icon={<I.terminal size={12} />} onPick={() => (close(), bridge.openIn(cwd, "terminal"))} />
        {thread.worktree && <p className="lc-env-note">A worktree of its own, so other sessions never edit these files.</p>}
      </Line>

      <Line icon={<I.edit size={14} />} title={editor ? `Open in ${editor.name}` : "Open in your editor"} open={more === "editor"} onPick={() => openIn(editor)} onMore={editors?.length ? () => toggle("editor") : undefined}>
        {editors && editors.length > 0 && (
          <>
            {editors.map((e) => (
              <Pick key={e.id} title={e.name} note={e.kind === "terminal" ? "Terminal" : undefined} on={e.id === editor?.id} onPick={() => openIn(e)} />
            ))}
          </>
        )}
      </Line>

      <Line icon={<I.plus size={14} />} title="Add project script" note={(project.scripts ?? []).length ? `${plural(project.scripts!.length, "script")} so far` : "A command you run often, a press away"} open={more === "script"} onMore={() => toggle("script")}>
        <form
          className="lc-env-form"
          onSubmit={(e) => {
            e.preventDefault();
            void addScript(script.name, script.command);
          }}
        >
          <input className="lc-input" value={script.name} onChange={(e) => setScript((x) => ({ ...x, name: e.target.value }))} placeholder="Name, like Dev server" aria-label="Script name" />
          <input className="lc-input lc-mono" value={script.command} onChange={(e) => setScript((x) => ({ ...x, command: e.target.value }))} placeholder="npm run dev" aria-label="Command" />
          <button type="submit" className="lc-btn" data-kind="accent" data-size="sm" disabled={!script.name.trim() || !script.command.trim()}>
            Add
          </button>
        </form>
        {fromPackage.map((n) => (
          <Pick key={n} title={`npm run ${n}`} note="From package.json" icon={<I.plus size={12} />} onPick={() => void addScript(n, `npm run ${n}`)} />
        ))}
      </Line>

      <Sep />

      {project.git && (
        <Line icon={<I.branch size={14} />} title={<span className="lc-mono">{branch ?? "No branch"}</span>} note={thread.worktree ? "Its own worktree" : "This checkout"} open={more === "branch"} onMore={() => toggle("branch")}>
          {thread.worktree ? (
            <p className="lc-env-note">This session works in a worktree of its own, so its branch stays put. Start another session for another branch.</p>
          ) : (
            <>
              {(git?.branches ?? [])
                .filter((b) => !git?.worktrees.some((w) => w.branch === b.name))
                .slice(0, 8)
                .map((b) => (
                  <Pick key={b.name} title={<span className="lc-mono">{b.name}</span>} on={b.name === branch} disabled={busy || running || b.name === branch} onPick={() => void switchTo(b.name)} />
                ))}
              <form
                className="lc-env-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newBranch.trim()) void switchTo(newBranch.trim(), true);
                }}
              >
                <input className="lc-input lc-mono" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="new-branch-name" aria-label="New branch" disabled={running} />
                <button type="submit" className="lc-btn" data-kind="plain" data-size="sm" disabled={!newBranch.trim() || busy || running}>
                  New branch
                </button>
              </form>
              {running && <p className="lc-env-note">Switching waits until the turn finishes.</p>}
            </>
          )}
        </Line>
      )}

      {project.git && (
        <Line
          icon={<I.push size={14} />}
          title={commitTitle}
          note={files > 0 ? `${plural(files, "file")} to commit` : "Nothing to commit"}
          disabled={running || (files === 0 && then === "commit")}
          open={more === "commit"}
          onPick={commitRow}
          onMore={() => (setCommitting(false), toggle("commit"))}
        >
          {committing && files > 0 ? (
            <CommitForm thread={thread} files={files} then={then} onDone={close} />
          ) : (
            THEN.map((x) => (
              <Pick
                key={x.id}
                title={x.title}
                note={x.note}
                on={x.id === then}
                onPick={() => {
                  setThen(x.id);
                  keep("lc:commit-then", x.id);
                  setMore(null);
                }}
              />
            ))
          )}
        </Line>
      )}

      <Line icon={<I.changes size={14} />} title="Changes" end={lines.added || lines.removed ? <Lines {...lines} /> : <span className="lc-mono">+0 −0</span>} disabled={!lines.added && !lines.removed} onPick={() => (close(), onChanges())} />
    </div>
  );
}
