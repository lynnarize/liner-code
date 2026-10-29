/*
  Committing what's left to review. The button opens the message, written by a quick model from
  the changes and what you asked for; change it, or commit as it is. Every file is in unless you
  untick some, which stay for a later commit. From a session's menu the commit can go on to a
  push, or to the PR card in the chat.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import type { Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine, useItems } from "./engine";
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

export function CommitForm({ thread, files, onDone, then = "commit" }: { thread: Thread; files: number; onDone: () => void; then?: Then }) {
  const providers = useEngine((s) => s.providers);
  const [message, setMessage] = useState("");
  const [writing, setWriting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [by, setBy] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // The files still to commit, each once with its lines from every turn; unticked ones wait.
  const items = useItems(thread.id);
  const open = useMemo(() => {
    const by = new Map<string, { path: string; added: number; removed: number }>();
    for (const f of checkpointsOf(items ?? []).filter((c) => !c.reverted && !c.committed).flatMap((c) => c.files)) {
      const had = by.get(f.path);
      by.set(f.path, { path: f.path, added: (had?.added ?? 0) + f.added, removed: (had?.removed ?? 0) + f.removed });
    }
    return [...by.values()];
  }, [items]);
  const [left, setLeft] = useState<Set<string>>(new Set());
  const chosen = open.filter((f) => !left.has(f.path));
  const count = open.length ? chosen.length : files;
  const write = () => {
    setWriting(true);
    void rpc("git.message", { threadId: thread.id })
      .then((r) => {
        setMessage(r.message);
        setBy(modelLabel(r.by, providers));
        setWriting(false);
        requestAnimationFrame(() => field.current?.focus());
      })
      .catch((e) => {
        setWriting(false);
        toast.error(e instanceof Error ? e.message : String(e));
      });
  };
  useEffect(write, []);
  const commit = async () => {
    // Commit and push plays out in the thread, as a card that grows from the chip and folds back.
    if (then === "push") {
      onDone();
      const lines = (open.length ? chosen : []).reduce((n, f) => ({ added: n.added + f.added, removed: n.removed + f.removed }), { added: 0, removed: 0 });
      await ship(thread, { message, paths: left.size ? chosen.map((f) => f.path) : undefined, files: count, ...lines });
      return;
    }
    setBusy(true);
    try {
      const r = await rpc("git.commit", { threadId: thread.id, message: message.trim() || undefined, paths: left.size ? chosen.map((f) => f.path) : undefined });
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
        <p className="l-shimmer lc-commit-wait">Writing the message from the changes</p>
      ) : (
        <textarea
          ref={field}
          className="lc-input lc-commit-m lc-mono"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
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
