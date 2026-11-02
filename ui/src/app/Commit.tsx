/*
  Committing what's left to review. The button opens the message, written by a quick model from
  the changes and what you asked for; change it, or commit as it is. The message is kept, edits and
  all, until the changes move on: a new turn, an undo, or a commit writes a fresh one. Every file is in unless you
  untick some, which stay for a later commit. From a session's menu the commit can go on to a
  push, or to the PR card in the chat.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { isCheckpoint, rpc, useEngine, useItemsWhere } from "./engine";
import { checkpointsOf, modelLabel, plural } from "./model";
import { ship } from "./Ship";
import { Lines, Pop } from "./ui";

export function CommitButton({ thread, files, disabled }: { thread: Thread; files: number; disabled?: boolean }) {
  return (
    <Pop label={`Commit ${plural(files, "file")}`} side="top" align="end" width={420} triggerClass="lc-btn lc-commit-b" disabled={disabled} trigger={<>Commit {plural(files, "file")}</>}>
      {(close) => <CommitForm thread={thread} files={files} onDone={close} />}
    </Pop>
  );
}

export type Then = "commit" | "push" | "pr";

/** The last message per session, with the changes it was written for. */
type Saved = { key: string; message: string; by: string | null };
const SAVED = "lc:commit-messages";
const saved = (): Record<string, Saved> => {
  try {
    return JSON.parse(localStorage.getItem(SAVED) || "{}") as Record<string, Saved>;
  } catch {
    return {};
  }
};
const save = (threadId: string, s: Saved | null) => {
  const all = saved();
  if (s) all[threadId] = s;
  else delete all[threadId];
  try {
    localStorage.setItem(SAVED, JSON.stringify(all));
  } catch {
    // Full or blocked: it's written again next time.
  }
};

export function CommitForm({ thread, files, onDone, then = "commit" }: { thread: Thread; files: number; onDone: () => void; then?: Then }) {
  const providers = useEngine((s) => s.providers);
  // The files still to commit, each once with its lines from every turn; unticked ones wait.
  const items = useItemsWhere(thread.id, isCheckpoint);
  const { open, key } = useMemo(() => {
    const by = new Map<string, { path: string; added: number; removed: number }>();
    const waiting = checkpointsOf(items ?? []).filter((c) => !c.reverted && !c.committed);
    for (const f of waiting.flatMap((c) => c.files)) {
      const had = by.get(f.path);
      by.set(f.path, { path: f.path, added: (had?.added ?? 0) + f.added, removed: (had?.removed ?? 0) + f.removed });
    }
    // What the message was written for: each turn's snapshot, so any change to the files makes a new one.
    const key = items ? waiting.map((c) => `${c.id}:${c.to ?? ""}:${c.files.map((f) => `${f.path}+${f.added}-${f.removed}`).join(",")}`).join("|") || `files:${files}` : null;
    return { open: [...by.values()], key };
  }, [items, files]);
  const kept = key ? saved()[thread.id] : undefined;
  const fresh = kept && kept.key === key ? kept : undefined;
  const [message, setMessage] = useState(fresh?.message ?? "");
  const [writing, setWriting] = useState(!fresh);
  const [busy, setBusy] = useState(false);
  const [by, setBy] = useState<string | null>(fresh?.by ?? null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [left, setLeft] = useState<Set<string>>(new Set());
  const chosen = open.filter((f) => !left.has(f.path));
  const count = open.length ? chosen.length : files;
  const write = () => {
    if (!key) return;
    setWriting(true);
    void rpc("git.message", { threadId: thread.id })
      .then((r) => {
        const label = modelLabel(r.by, providers);
        setMessage(r.message);
        setBy(label);
        setWriting(false);
        save(thread.id, { key, message: r.message, by: label });
        requestAnimationFrame(() => field.current?.focus());
      })
      .catch((e) => {
        setWriting(false);
        toast.error(e instanceof Error ? e.message : String(e));
      });
  };
  // Written once the changes are known, and again only when they've moved on since.
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!key || asked.current === key) return;
    asked.current = key;
    const k = saved()[thread.id];
    if (k?.key === key) {
      setMessage(k.message);
      setBy(k.by);
      setWriting(false);
      requestAnimationFrame(() => field.current?.focus());
      return;
    }
    write();
  }, [key]);
  const edit = (m: string) => {
    setMessage(m);
    if (key) save(thread.id, { key, message: m, by });
  };
  const commit = async () => {
    // ⌘Enter asks too, so it holds to what the button does: no files picked is nothing to commit, not all of them.
    if (busy || writing || !message.trim() || count === 0) return;
    // Commit and push plays out in the thread, as a card that grows from the chip and folds back.
    if (then === "push") {
      onDone();
      save(thread.id, null);
      const lines = (open.length ? chosen : []).reduce((n, f) => ({ added: n.added + f.added, removed: n.removed + f.removed }), { added: 0, removed: 0 });
      await ship(thread, { message, paths: left.size ? chosen.map((f) => f.path) : undefined, files: count, ...lines });
      return;
    }
    setBusy(true);
    try {
      const r = await rpc("git.commit", { threadId: thread.id, message: message.trim() || undefined, paths: left.size ? chosen.map((f) => f.path) : undefined });
      save(thread.id, null);
      toast.success(`Committed ${plural(r.files, "file")}`, { description: `${r.sha} · ${message.split("\n")[0] || thread.title}` });
      onDone();
      // The PR card takes it from here, in the chat.
      if (then === "pr") await rpc("thread.send", { id: thread.id, text: "create pr" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <div className="lc-commit">
      <div className="lc-commit-h">
        <b>Commit {plural(count, "file")}</b>
        <span className="lc-quiet">{writing ? "" : by ? `Written by ${by}` : ""}</span>
      </div>
      {open.length > 0 && (
        <div className="lc-commit-files">
          {open.map((f) => (
            <label key={f.path} className="lc-commit-file" title={f.path}>
              <input
                type="checkbox"
                checked={!left.has(f.path)}
                onChange={(e) =>
                  setLeft((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.delete(f.path);
                    else n.add(f.path);
                    return n;
                  })
                }
              />
              <span className="lc-mono">{f.path}</span>
              <Lines added={f.added} removed={f.removed} />
            </label>
          ))}
        </div>
      )}
      {writing ? (
        <div className="lc-commit-wait" role="status">
          <i />
          <i />
          <i />
          <i />
          <i />
          <span>Writing the message from the changes</span>
        </div>
      ) : (
        <textarea
          ref={field}
          className="lc-input lc-commit-m lc-mono"
          value={message}
          onChange={(e) => edit(e.target.value)}
          placeholder="What these changes do"
          aria-label="Commit message"
          spellCheck={false}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && void commit()}
        />
      )}
      <div className="lc-commit-f">
        <button type="button" className="lc-btn" data-kind="ghost" data-size="sm" disabled={writing || busy} onClick={write}>
          Write it again
        </button>
        <span className="lc-grow" />
        <button type="button" className="lc-btn" data-kind="accent" data-size="sm" disabled={busy || writing || !message.trim() || count === 0} onClick={() => void commit()}>
          {busy ? "Committing" : then === "push" ? "Commit and push" : then === "pr" ? "Commit, then open PR" : "Commit"}
        </button>
      </div>
    </div>
  );
}
