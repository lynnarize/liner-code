/*
  The prompt check at the composer (engine/src/precheck.ts): one quiet row in the tray's head with what the check says of the
  draft, its one action as a small button, and a close mark. After Devin's ("This draft looks like several independent tasks"
  with "Split into child sessions", "This task looks unrelated to the current session" with "Start new session").

  The rules that read only the words run as you type, a moment after you stop, and never hold the send. The one that may ask
  the quick model runs when you press Send, holds it for three seconds at most, and then offers "Start a new session" and
  "Send here"; Send pressed again always sends. A suggestion you close doesn't come back for that draft. Never in a side chat,
  a routine's run, Workshop or a design's composer, nor while an ask waits on you (the engine says nothing there either).
*/
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Precheck, Project, SessionMode, Thread } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { rpc, useEngine } from "./engine";
import { I, StateMark } from "./icons";
import type { Outgoing, RunSettings } from "./Composer";
import { DraftMemory } from "./precheck-state";
import "./precheck.css";

/** Opens a session, as the app's own lc:open-session does (Addon.tsx openSession), without bringing the add-on code along. */
const openSession = (id: string) => window.dispatchEvent(new CustomEvent("lc:open-session", { detail: { id } }));

/** How the composer sends for an action: the fast model for this message, somewhere else instead (`said`: the box's own words, before skills were named), or past the check. */
export type SendHow = { once?: string; to?: (m: Outgoing, said: string) => Promise<void>; checked?: boolean };

type Env = {
  variant: "home" | "session";
  project: Project;
  thread?: Thread;
  settings: RunSettings;
  mode?: SessionMode;
  /** Nothing to check here: Workshop, a design's composer, a comparison being set up, a queued message being edited. */
  off: boolean;
  busy?: boolean;
  /** Files attached: a split would leave them behind, so it isn't offered; nor in a folder without Git, where it can't make worktrees. */
  files: number;
  text: string;
  /** The composer's own send, with how (SendHow); `keep`, words put back in the box after it emptied (a split's unmade tasks). */
  send: (how: SendHow) => void;
  keep: (text: string) => void;
};

/** How long after the last key the words are read. */
const QUIET_MS = 450;
/** The engine gives the model three seconds; this is that, and the way there and back. */
const HOLD_MS = 3600;

/** The draft as one key: a draft is the same while its words are, whatever the spaces round them. */
const keyOf = (text: string) => text.trim();

export function usePrecheck(env: Env) {
  const { variant, project, thread, settings, off, busy, files, text } = env;
  const on = useEngine((s) => s.settings.precheck !== false);
  const worktrees = useEngine((s) => s.settings.worktrees);
  const [found, setFound] = useState<Precheck | null>(null);
  const [holding, setHolding] = useState(false);
  // What's closed on this draft, and the words the Send check read (precheck-state.ts).
  const memory = useRef(new DraftMemory()).current;
  // The Send check under way, and whether a second Send went past it.
  const pending = useRef<{ draft: string; passed: boolean } | null>(null);
  const draft = keyOf(text);
  const envRef = useRef(env);
  envRef.current = env;

  memory.see(draft);
  const live = on && !off && !thread?.sideOf && !thread?.routine && thread?.mode !== "creator" && !thread?.design && project.kind !== "design";

  // The words' rules, a moment after you stop typing. What they find is for these words only: what was found for other words
  // goes as they change, and a look that fails leaves nothing up, so a banner never speaks for words it didn't read.
  useEffect(() => {
    // Send's own finding stays while the words are the ones it read.
    const stale = () => setFound((f) => (f?.kind === "unrelated" && memory.readNow(draft) ? f : null));
    stale();
    if (!live || !draft || draft.startsWith("/") || (variant === "session" && busy)) return;
    let gone = false;
    const t = setTimeout(() => {
      const ask = thread ? rpc("precheck.draft", { text: draft, threadId: thread.id }) : rpc("precheck.draft", { text: draft, projectId: project.id });
      void ask.then(
        (p) => {
          if (gone) return;
          setFound((f) => (f?.kind === "unrelated" && memory.readNow(draft) ? f : p && !(p.kind === "split" && (files > 0 || !project.git)) ? memory.shown(p) : null));
        },
        () => {
          if (!gone) stale();
        },
      );
    }, QUIET_MS);
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [draft, live, busy, files, thread?.id, project.id, project.git, variant]);

  /**
    On Send: true lets it go. A session's message with nothing running is read by the Send check first (the model may be
    asked); it holds the send for HOLD_MS at most. Send pressed again while it reads, or once it has spoken, sends.
  */
  const beforeSend = async (): Promise<boolean> => {
    if (!live || variant !== "session" || !thread || busy || !draft || draft.startsWith("/")) return true;
    if (pending.current) {
      pending.current.passed = true;
      setHolding(false);
      return true;
    }
    if (memory.passes(draft)) return true;
    const mine = { draft, passed: false };
    pending.current = mine;
    setHolding(true);
    let p: Precheck | null = null;
    try {
      p = await Promise.race([rpc("precheck.send", { threadId: thread.id, text: draft }).catch(() => null), new Promise<null>((ok) => setTimeout(() => ok(null), HOLD_MS))]);
    } finally {
      if (pending.current === mine) pending.current = null;
      setHolding(false);
    }
    memory.read(draft);
    // Sent already by a second Send; or the words changed while it read.
    if (mine.passed || keyOf(envRef.current.text) !== draft) return false;
    if (!p || p.kind !== "unrelated") return true;
    setFound(p);
    return false;
  };

  /** The draft went (sent, split, moved): the next one starts clean. */
  const reset = () => {
    setFound(null);
    memory.reset();
  };

  const close = () => {
    if (found) memory.close(found.kind);
    setFound(null);
  };

  /** Says what went wrong and passes it on, so the composer puts the draft back (it says nothing itself once the draft is handed over). */
  const told = (e: unknown): never => {
    toast.error(e instanceof Error ? e.message : String(e));
    throw e;
  };

  /** "Start a new session": one like this one (its tool, model, effort, access, mode), with the draft as its first message. */
  const elsewhere = async (m: Outgoing) => {
    if (!thread) return;
    let t: Thread;
    try {
      t = await rpc("thread.create", { projectId: project.id, agent: thread.agent, sidekick: thread.sidekick, model: thread.model, effort: thread.effort, access: thread.access, review: thread.review, mode: thread.mode, ...(thread.sidekick && thread.tuning ? { tuning: thread.tuning } : {}), worktree: Boolean(worktrees && project.git) });
      await rpc("thread.send", { id: t.id, text: m.text, files: m.files });
    } catch (e) {
      return told(e);
    }
    openSession(t.id);
  };

  /** "Split into N sessions": one session per task, each in a worktree of its own from the same commit (engine: precheck.split), the tasks read from the box's words as they are now. */
  const split = async (text: string) => {
    let r: { made: Thread[]; left: string[]; why?: string };
    try {
      r = await rpc("precheck.split", { projectId: project.id, threadId: variant === "session" ? thread?.id : undefined, text, agent: settings.agent, sidekick: settings.sidekick, model: settings.model, effort: settings.effort, access: settings.access, mode: env.mode ?? thread?.mode, ...(settings.sidekick && settings.tuning ? { tuning: settings.tuning } : {}), review: settings.review });
    } catch (e) {
      return told(e);
    }
    const { made, left, why } = r;
    const first = made[0];
    // Some didn't start: the box keeps only those tasks, so sending again doesn't start the others twice.
    if (left.length) {
      env.keep(left.map((t, i) => `${i + 1}. ${t}`).join("\n"));
      const started = [...(variant === "session" ? ["this session"] : []), ...made.map((t) => `“${t.title}”`)];
      toast.error(`${left.length === 1 ? "1 task" : `${left.length} tasks`} didn't start`, { description: `${started.length ? `Started: ${started.join(", ")}. ` : ""}${why ?? ""} The rest is back in the box.`, duration: 8000 });
      return;
    }
    toast(variant === "session" ? `Started ${made.length === 1 ? "1 more session" : `${made.length} more sessions`}` : `Started ${made.length} sessions`, { description: variant === "session" ? "This session takes the first task. Each other task has a worktree of its own." : "Each task has a worktree of its own.", ...(first ? { action: { label: "Open", onClick: () => openSession(first.id) } } : {}), duration: 6000 });
  };

  const act = () => {
    const p = found;
    if (!p) return;
    reset();
    if (p.kind === "heavy" && p.model) env.send({ once: p.model, checked: true });
    else if (p.kind === "unrelated") env.send({ to: elsewhere, checked: true });
    else if (p.kind === "split" && p.tasks) env.send({ to: (_m, said) => split(said), checked: true });
  };

  const row: ReactNode = holding ? (
    <div className="lc-trow lc-pcheck" role="status">
      {/* A tray row for something that runs leads with the Working mark, as the cards' rows do. */}
      <StateMark state="working" size={14} />
      <span className="lc-trow-t">Reading whether this belongs here</span>
      <span className="lc-grow" />
      <span className="lc-pcheck-key">Send again to send now</span>
    </div>
  ) : found ? (
    <div className="lc-pcheck-box" role="status" aria-live="polite">
      <div className="lc-trow lc-pcheck">
        <I.sparkle size={16} />
        <span className="lc-trow-t">{found.caption}</span>
        <span className="lc-grow" />
        {/* The one action in ink and last, as the tray's Commit is; Send here quiet before it. */}
        {found.kind === "unrelated" && (
          <button type="button" className="lc-btn lc-trow-commit l-focus" data-kind="ghost" onClick={() => (reset(), env.send({ checked: true }))}>
            Send here
          </button>
        )}
        <button type="button" className="lc-btn lc-trow-commit l-focus" data-kind="ink" onClick={act}>
          {found.action}
        </button>
        <button type="button" className="lc-ib l-focus" aria-label="Dismiss" title="Dismiss" onClick={close}>
          <I.close size={14} />
        </button>
      </div>
      {found.kind === "split" && found.tasks && (
        <ol className="lc-pcheck-tasks" aria-label="The sessions it would start">
          {found.tasks.map((t, i) => (
            <li key={i} title={t}>
              {t}
            </li>
          ))}
        </ol>
      )}
    </div>
  ) : null;

  return { row, beforeSend, reset };
}
