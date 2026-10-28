/*
  Committing what's left to review. The button opens the message, written by a quick model from
  the changes and what you asked for; change it, or commit as it is. From a session's menu the
  commit can go on to a push, or to the PR card in the chat.
*/
import { useEffect, useRef, useState } from "react";
import type { Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "./engine";
import { modelLabel, plural } from "./model";
import { Pop } from "./ui";

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
    setBusy(true);
    try {
      const r = await rpc("git.commit", { threadId: thread.id, message: message.trim() || undefined });
      toast.success(`Committed ${plural(r.files, "file")}`, { description: `${r.sha} · ${message.split("\n")[0] || thread.title}` });
      onDone();
      if (then === "push") {
        const p = await rpc("git.push", { threadId: thread.id }).catch((e) => (toast.error(e instanceof Error ? e.message : String(e)), null));
        if (p) toast.success(`Pushed ${p.branch} to ${p.remote}`);
      }
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
        <b>Commit {plural(files, "file")}</b>
        <span className="lc-quiet">{writing ? "" : by ? `Written by ${by}` : ""}</span>
      </div>
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
        <button type="button" className="lc-btn" data-kind="accent" data-size="sm" disabled={busy || writing || !message.trim()} onClick={() => void commit()}>
          {busy ? "Committing" : then === "push" ? "Commit and push" : then === "pr" ? "Commit, then open PR" : "Commit"}
        </button>
      </div>
    </div>
  );
}
