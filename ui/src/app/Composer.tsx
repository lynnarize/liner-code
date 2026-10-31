/*
  The composer. A glass frame around a white card: what's queued sits on the glass above, you
  write in the card, and the run's settings sit on the glass below. On Home the strip says where
  the session runs instead.

  - Who works on this: talk to the lead (it plans, then hands off) or straight to a coder, or
    to a model on its own, or Routed: the engine picks per message, at the level you choose.
  - Effort and access open glass menus; access has five levels, from Read only to Full access.
  - @ finds a file in the project; files come from the clip, a paste or a drop.
  - While an agent works, Enter queues the message for when the turn ends; ⌘Enter steers the
    running turn instead. Your pick becomes what Enter does. A queued message can be sent now
    (⌘⇧Enter for the first), or edited where it waits.
  - A paste of 32 KiB or more comes as a text file. Drafts outlast a restart.
*/
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Access, CommandInfo, SkillInfo, Effort, Project, QueuedMessage, RouteLevel, RpcResult, Thread } from "@contracts";
import { castOf, familyOf, ROUTE_LEVELS, splitModel } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { is } from "./keymap";
import { mirror } from "./mdMirror";
import { isPrompt, rpc, useEngine, useItemsWhere } from "./engine";
import { I, ModelMark } from "./icons";
import { ACCESS_LEVELS, accessOf, ago, agentOf, compact, isModelAgent, markOf, modelLabel, plural, setupLine, setupsOf, since } from "./model";
import { onComposerInsert } from "./Find";
import { EffortPick, ModelPicker } from "./Models";
import { ContextMeter, Disc, PanelHead, Pop, Row, Sep } from "./ui";

export type RunSettings = { agent: string; lead?: string; model?: string; effort: Effort; access: Access; helpers?: string[]; setup?: string; route?: RouteLevel };
export type Outgoing = { text: string; files: { name: string; data: string }[]; mode: "queue" | "steer" };

type Props = {
  variant: "home" | "session";
  project: Project;
  thread?: Thread;
  settings: RunSettings;
  onSettings: (patch: Partial<RunSettings>) => void;
  onSend: (m: Outgoing) => void | Promise<void>;
  onStop?: () => void;
  onNewAgent?: () => void;
  busy?: boolean;
  placeholder?: string;
  /** Home's strip: run in this checkout, a new worktree (from `base`), or an existing worktree. */
  worktree?: boolean;
  onWorktree?: (on: boolean) => void;
  base?: string;
  onBase?: (branch: string | undefined) => void;
  inWorktree?: { path: string; branch?: string };
  onInWorktree?: (w: { path: string; branch?: string } | undefined) => void;
  autoFocus?: boolean;
  /** Home: more models given the same ask, to compare and keep one ("@provider:model"). */
  compare?: string[];
  onCompare?: (refs: string[]) => void;
  /** Home: what else starts from here, at the far end of the strip under the box. */
  stripEnd?: ReactNode;
};

/*
  What gives way, in order, when the tray's controls don't fit on one line: the queue-or-steer
  note shortens, then keeps only its key; access, effort and who keep only their icons; last, the
  row wraps. Each is tried until nothing spills, so a long name or a narrow window costs words,
  never an overlap (T3 Code's composer measures its controls the same way). It refits when the
  tray resizes, a control changes, or a font arrives.
*/
const GIVE = ["short", "note", "access", "effort", "who", "wrap"];
function useTrayFit(tray: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const row = tray.current;
    if (!row) return;
    const fit = () => {
      let n = 0;
      row.dataset.give = "";
      while (n < GIVE.length && row.scrollWidth > row.clientWidth) row.dataset.give = GIVE.slice(0, ++n).join(" ");
    };
    const sizes = new ResizeObserver(fit);
    const watch = () => {
      sizes.disconnect();
      for (const el of [row, ...row.children]) sizes.observe(el);
      fit();
    };
    watch();
    const changes = new MutationObserver(watch);
    changes.observe(row, { childList: true, subtree: true, characterData: true });
    document.fonts.addEventListener("loadingdone", fit);
    return () => (sizes.disconnect(), changes.disconnect(), document.fonts.removeEventListener("loadingdone", fit));
  }, [tray]);
}

type Choice = { key: string; insert: string; label: string; kind: "@" | "/" | "$"; hint?: string; note?: string; path?: string; liner?: boolean };
const commandCache = new Map<string, Promise<{ commands: CommandInfo[]; skills: SkillInfo[] }>>();
const commandsFor = (projectId: string, agent: string, threadId?: string) => {
  const key = `${projectId}|${agent}`;
  if (!commandCache.has(key)) commandCache.set(key, rpc("agent.commands", { projectId, agent, threadId }).catch(() => ({ commands: [], skills: [] })));
  return commandCache.get(key)!;
};

const gitCache = new Map<string, Promise<RpcResult<"git.branches">>>();
const branchesFor = (projectId: string) => {
  if (!gitCache.has(projectId)) gitCache.set(projectId, rpc("git.branches", { projectId }).finally(() => setTimeout(() => gitCache.delete(projectId), 30000)));
  return gitCache.get(projectId)!;
};

/** Where a new session works: this checkout, a new worktree, or one that's already there. */
function WhereRows({ project, git, onOpen, worktree, inWorktree, onPick }: { project: Project; git: RpcResult<"git.branches"> | null; onOpen: () => void; worktree: boolean; inWorktree?: { path: string }; onPick: (worktree: boolean, existing?: { path: string; branch?: string }) => void }) {
  useEffect(onOpen, []);
  const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
  return (
    <>
      <PanelHead>Where it runs</PanelHead>
      <Row title="This checkout" note={tilde(project.path)} on={!worktree && !inWorktree} onPick={() => onPick(false)} />
      <Row title="A new worktree" note="Its own branch and folder, so sessions never edit the same files" on={worktree && !inWorktree} onPick={() => onPick(true)} />
      {git && git.worktrees.length > 0 && (
        <>
          <Sep />
          <PanelHead>Or carry on in a worktree</PanelHead>
          {git.worktrees.slice(0, 8).map((w) => (
            <Row key={w.path} title={w.branch ?? "Detached"} note={`${tilde(w.path)}${w.threadId ? " · has a session" : ""}`} on={inWorktree?.path === w.path} icon={<I.branch size={12} />} onPick={() => onPick(false, { path: w.path, branch: w.branch })} />
          ))}
        </>
      )}
    </>
  );
}
function BaseRows({ git, onOpen, current, onPick }: { git: RpcResult<"git.branches"> | null; onOpen: () => void; current?: string; onPick: (b: string | undefined) => void }) {
  useEffect(onOpen, []);
  if (!git) return <p className="l-shimmer lc-pop-note">Reading the branches</p>;
  return (
    <>
      <PanelHead>Start the worktree from</PanelHead>
      {git.branches.slice(0, 14).map((b) => (
        <Row key={b.name} title={<span className="lc-mono">{b.name}</span>} note={[b.name === git.current ? "this checkout" : "", b.name === git.base ? "the default branch" : "", b.lastCommitAt ? since(b.lastCommitAt) : ""].filter(Boolean).join(" · ")} on={b.name === current} onPick={() => onPick(b.name === git.current ? undefined : b.name)} />
      ))}
    </>
  );
}

const LINE = 22;
const MAX_LINES = 8;

/*
  Drafts last: one per session and one for Home, in localStorage, so a restart finds them. A sent
  draft goes, and only the 50 newest are kept (T3 Code: composerDraftStore.ts). Storage can be
  full or shut (a private window): then a draft lasts as long as the composer.
*/
const DRAFTS = "lc:drafts:v1";
const MAX_DRAFTS = 50;
type Drafts = Record<string, { text: string; at: number }>;
function readDrafts(): Drafts {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFTS) || "{}") as unknown;
    return v && typeof v === "object" ? (v as Drafts) : {};
  } catch {
    return {};
  }
}
const draftOf = (key: string) => readDrafts()[key]?.text ?? "";
function keepDraft(key: string, text: string) {
  try {
    const all = readDrafts();
    if ((all[key]?.text ?? "") === text) return;
    if (text.trim()) all[key] = { text, at: Date.now() };
    else delete all[key];
    const newest = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_DRAFTS);
    localStorage.setItem(DRAFTS, JSON.stringify(Object.fromEntries(newest)));
  } catch {
    // Full or shut: the draft stays in the field.
  }
}

/** A paste this big (in bytes, as T3 Code counts it: chat/useComposerAttachmentIntake.ts) comes as a text file. */
const PASTE_AS_FILE = 32 * 1024;
const bytesOf = (s: string) => (s.length * 3 < PASTE_AS_FILE ? s.length : new TextEncoder().encode(s).byteLength);
/** pasted-143205.txt, by the time of the paste; a second in the same second gets -2. */
function pastedName(taken: string[]) {
  const d = new Date();
  const stamp = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join("");
  for (let i = 1; ; i++) {
    const name = `pasted-${stamp}${i > 1 ? `-${i}` : ""}.txt`;
    if (!taken.includes(name)) return name;
  }
}

/** A long thread past its cache: the next message is read again at full price, so the composer offers to compact. */
const COLD_TOKENS = 200_000;

const toBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

export function Composer({ variant, project, thread, settings, onSettings, onSend, onStop, onNewAgent, busy, placeholder, worktree, onWorktree, base, onBase, inWorktree, onInWorktree, autoFocus, compare = [], onCompare, stripEnd }: Props) {
  const [git, setGit] = useState<Awaited<ReturnType<typeof branchesFor>> | null>(null);
  const loadGit = () => void branchesFor(project.id).then(setGit);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const draftKey = thread?.id ?? "home";
  const [text, setText] = useState(() => draftOf(draftKey));
  // A queued message being edited: it keeps its place in the queue, and the draft it pushed aside comes back after.
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<"queue" | "steer">(() => (localStorage.getItem("lc:enter") as "steer") ?? "queue");
  const [mention, setMention] = useState<{ start: number; query: string; kind: "@" | "/" | "$" } | null>(null);
  const [found, setFound] = useState<Choice[]>([]);
  const [tools, setTools] = useState<{ commands: CommandInfo[]; skills: SkillInfo[] } | null>(null);
  const [hl, setHl] = useState(0);
  const [drag, setDrag] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  // Markdown styled as you type: the mirror behind the field draws the same text with its look.
  const mirrorRef = useRef<HTMLDivElement>(null);
  const md = useMemo(() => mirror(text), [text]);
  const clip = useRef<HTMLInputElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  useTrayFit(tray);

  const talkTo = agentOf(settings.lead ?? settings.agent, agents, providers);
  const coder = agentOf(settings.agent, agents, providers);
  const model = settings.model ?? coder.model;
  const shownModel = settings.lead ? talkTo.model : model;
  const lev = accessOf(settings.access);
  const queue = thread?.queue ?? [];
  const usage = thread?.usage;
  // Past the window can't be: that's a total an older version saved, not how full the context is.
  const ctx = usage?.contextTokens && usage.contextWindow && usage.contextTokens <= usage.contextWindow ? usage.contextTokens / usage.contextWindow : undefined;

  // The draft is kept per session (and Home's), a moment after you stop typing and when you leave.
  // While a queued message is edited, the draft kept is the one it pushed aside.
  const pendingDraft = useRef<{ key: string; text: string } | null>(null);
  const flushDraft = () => {
    const p = pendingDraft.current;
    pendingDraft.current = null;
    if (p) keepDraft(p.key, p.text);
  };
  useEffect(() => {
    pendingDraft.current = { key: draftKey, text: editing ? editing.draft : text };
    const t = setTimeout(flushDraft, 300);
    return () => clearTimeout(t);
  }, [text, draftKey, editing]);
  useEffect(() => flushDraft, [draftKey]);
  useEffect(() => {
    try {
      localStorage.setItem("lc:enter", mode);
    } catch {
      // Shut storage: Enter does this for as long as the window is open.
    }
  }, [mode]);

  // The field grows with what you write, up to eight lines, then scrolls. It measures again when
  // its width changes, or a height taken while the column was narrow (the placeholder wrapping)
  // would stay after it widens.
  const fit = () => {
    const el = field.current;
    if (!el) return;
    // Measured with the height's transition off: with it on, the height set to measure only starts
    // a transition, the old height is still what lays out, and the field never shrinks.
    const was = el.style.height;
    el.style.transition = "none";
    el.style.height = "0px";
    const next = `${Math.min(el.scrollHeight, LINE * MAX_LINES + 20)}px`;
    el.style.height = was;
    void el.offsetHeight;
    el.style.transition = "";
    el.style.height = next;
  };
  useLayoutEffect(fit, [text]);
  useEffect(() => {
    const el = field.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    ro.observe(el);
    // The font arriving changes how the placeholder wraps too.
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus, thread?.id]);

  // What / and $ offer: the tool's own commands and skills, asked once per tool and folder.
  const who = settings.lead ?? settings.agent;
  useEffect(() => {
    if (mention?.kind !== "/" && mention?.kind !== "$") return;
    if (tools) return;
    let live = true;
    void commandsFor(project.id, who, thread?.id).then((r) => live && setTools(r));
    return () => {
      live = false;
    };
  }, [mention?.kind, project.id, who]);
  useEffect(() => setTools(null), [project.id, who]);

  // @ looks up files as you type; / and $ filter the tool's commands and skills.
  useEffect(() => {
    if (!mention) return;
    let live = true;
    const q = mention.query.toLowerCase();
    const rank = (name: string) => (name.toLowerCase().startsWith(q) ? 0 : 1);
    if (mention.kind === "@")
      void rpc("fs.files", { projectId: project.id, query: mention.query, limit: 8 }).then((r) => {
        if (!live) return;
        setFound(r.map((f) => ({ key: f.path, insert: `@${f.path}`, label: f.path, kind: "@" })));
        setHl(0);
      });
    else if (tools) {
      const list =
        mention.kind === "/"
          ? tools.commands.filter((c) => `${c.name} ${c.description}`.toLowerCase().includes(q)).sort((a, b) => rank(a.name) - rank(b.name)).map((c): Choice => ({ key: c.name, insert: `/${c.name}`, label: `/${c.name}`, hint: c.hint, note: c.description, kind: "/", liner: c.source === "liner" }))
          : tools.skills.filter((x) => `${x.name} ${x.description}`.toLowerCase().includes(q)).sort((a, b) => rank(a.name) - rank(b.name)).map((x): Choice => ({ key: x.name, insert: `$${x.name}`, label: `$${x.name}`, note: x.description, kind: "$", path: x.path }));
      setFound(list.slice(0, 12));
      setHl(0);
    }
    return () => {
      live = false;
    };
  }, [mention, project.id, tools]);

  const onType = (v: string, caret: number) => {
    setText(v);
    const before = v.slice(0, caret);
    // A command only at the very start; a file or a skill anywhere after a space.
    const slash = /^\/([\w:.-]*)$/.exec(before);
    const at = /(^|\s)([@$])([\w./:-]*)$/.exec(before);
    setMention(slash ? { start: 0, query: slash[1], kind: "/" } : at ? { start: caret - at[3].length - 1, query: at[3], kind: at[2] as "@" | "$" } : null);
  };
  const skillsUsed = useRef(new Map<string, string | undefined>());
  const pickFile = (c: Choice) => {
    if (!mention) return;
    const end = mention.start + 1 + mention.query.length;
    const next = `${text.slice(0, mention.start)}${c.insert} ${text.slice(end)}`;
    if (c.kind === "$") skillsUsed.current.set(c.key, c.path);
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const el = field.current;
      if (!el) return;
      const at = mention.start + c.insert.length + 1;
      el.focus();
      el.setSelectionRange(at, at);
    });
  };

  // One send at a time: a second Enter while the files are read, or while the first is on its way, does nothing.
  const sending = useRef(false);
  const send = async (how = mode) => {
    let t = text.trim();
    if ((!t && !files.length) || sending.current) return;
    // An edited queued message goes back in its place (T3 Code: chat/useQueuedRunEdit.ts). If the
    // turn ended and took it meanwhile, or files came along (a queued message holds only text), it
    // goes as a new message instead.
    const edit = editing;
    if (edit) {
      setEditing(null);
      const still = queue.some((x) => x.id === edit.id);
      if (still && !files.length) {
        setQueue(queue.map((x) => (x.id === edit.id ? { ...x, text: t } : x)));
        setText(edit.draft);
        setMention(null);
        return;
      }
      if (still) setQueue(queue.filter((x) => x.id !== edit.id));
    }
    sending.current = true;
    // What was written, put back if the send fails, so nothing is lost.
    const draft = { text, files, skills: new Map(skillsUsed.current) };
    let handed = false;
    try {
      // $skill in the text: the tool is told to use it, by name (and where it lives, when known).
      const used = [...skillsUsed.current].filter(([name]) => t.includes(`$${name}`));
      if (used.length) t = `${t}\n\n${used.map(([name, path]) => `Use the ${name} skill${path ? ` (${path})` : ""}.`).join("\n")}`;
      skillsUsed.current.clear();
      const payload = { text: t || "Here are the files.", files: await Promise.all(files.map(async (f) => ({ name: f.name, data: await toBase64(f) }))), mode: how };
      setText(edit?.draft ?? "");
      setFiles([]);
      setMention(null);
      handed = true;
      await onSend(payload);
    } catch (e) {
      // The draft comes back to try again, unless you've started a new one. Whoever sent it has said what went wrong.
      setText((cur) => (cur.trim() ? cur : draft.text));
      setFiles((cur) => (cur.length ? cur : draft.files));
      skillsUsed.current = draft.skills;
      if (!handed) toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      sending.current = false;
    }
  };

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    setFiles((f) => [...f, ...Array.from(list)].slice(0, 10));
  };

  const setQueue = (q: QueuedMessage[]) => thread && void rpc("thread.queue", { id: thread.id, queue: q });

  /** Edit a queued message in the field; it stays queued, in its place, until you save it. */
  const editQueued = (q: QueuedMessage) => {
    setEditing((e) => ({ id: q.id, draft: e ? e.draft : text }));
    setText(q.text);
    setMention(null);
    requestAnimationFrame(() => {
      const el = field.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };
  const stopEditing = () => {
    if (!editing) return;
    setText(editing.draft);
    setEditing(null);
  };

  /*
    Send now: out of the queue and into the running turn, read at its next step; with no turn
    running it starts one. A tool that can't take it mid-turn queues it again, at the end; it goes
    back where it was (T3 Code: chat/QueuedRunsControl.tsx).
  */
  const steered = useRef<{ text: string; at: number; until: number } | null>(null);
  const sendNow = (q: QueuedMessage) => {
    if (!thread) return;
    const at = queue.findIndex((x) => x.id === q.id);
    if (at < 0) return;
    // The one being edited goes as it reads now.
    const words = editing?.id === q.id ? text.trim() || q.text : q.text;
    if (editing?.id === q.id) stopEditing();
    const before = queue;
    steered.current = { text: words, at, until: Date.now() + 5000 };
    void rpc("thread.queue", { id: thread.id, queue: queue.filter((x) => x.id !== q.id) })
      .then(() => rpc("thread.send", { id: thread.id, text: words, mode: "steer" }))
      .catch((e) => {
        steered.current = null;
        void rpc("thread.queue", { id: thread.id, queue: before }).catch(() => {});
        toast.error(e instanceof Error ? e.message : String(e));
      });
  };
  useEffect(() => {
    const s = steered.current;
    if (!s || !thread) return;
    if (Date.now() > s.until) return void (steered.current = null);
    const last = queue.length - 1;
    if (last < 0 || !queue[last].text.startsWith(s.text)) return;
    steered.current = null;
    if (s.at < last) setQueue([...queue.slice(0, s.at), queue[last], ...queue.slice(s.at, last)]);
  }, [thread?.queue]);

  // ⌘⇧Enter sends the first queued message now, wherever the focus is in the session.
  const live = useRef({ queue, sendNow });
  live.current = { queue, sendNow };
  useEffect(() => {
    if (!thread) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !e.shiftKey || !(e.metaKey || e.ctrlKey) || e.altKey || e.isComposing) return;
      const first = live.current.queue[0];
      if (!first) return;
      e.preventDefault();
      live.current.sendNow(first);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [thread?.id]);

  // Compact: the tool sums up what came before (as the Session surface's Compact does). Claude Code and Codex take it.
  const canCompact = Boolean(thread) && ["claude", "codex"].includes(familyOf(splitModel(model).provider));
  const compactNow = () => {
    if (!thread) return;
    rpc("thread.send", { id: thread.id, text: "/compact" }).then(
      () => toast("Compacting the conversation", { description: "The tool sums up what came before, so the context has room again." }),
      (e: Error) => toast.error(e.message),
    );
  };
  // Past the cache's end, the next message re-reads the whole thread at full price. It shows once
  // the time comes, without waiting for anything else to change.
  const [, tick] = useState(0);
  const [coldSeen, setColdSeen] = useState<number | undefined>(undefined);
  const cacheUntil = thread?.cacheUntil;
  useEffect(() => {
    if (!cacheUntil || cacheUntil <= Date.now()) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.min(cacheUntil - Date.now() + 500, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [cacheUntil]);
  const cold = variant === "session" && !busy && canCompact && cacheUntil !== undefined && coldSeen !== cacheUntil && Date.now() > cacheUntil && (usage?.contextTokens ?? 0) > COLD_TOKENS;

  // Text sent here from elsewhere (a quote, a terminal excerpt) lands at the caret.
  useEffect(() => {
    if (!thread) return;
    return onComposerInsert(thread.id, (add) => {
      setText((cur) => {
        const el = field.current;
        const at = el && document.activeElement === el ? el.selectionStart : cur.length;
        const before = cur.slice(0, at);
        const lead = before && !before.endsWith("\n") ? "\n\n" : "";
        return `${before}${lead}${add}${cur.slice(at)}`;
      });
      requestAnimationFrame(() => {
        const el = field.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    });
  }, [thread?.id]);

  // ↑ in an empty composer brings back what you sent here, newest first; ↓ comes forward.
  // Only your messages: a reply streaming in doesn't redraw the composer.
  const items = useItemsWhere(thread?.id, isPrompt);
  const sent = items.flatMap((x) => (x.kind === "user" && !x.steer ? [x.text] : []));
  const recall = useRef(-1);
  useEffect(() => {
    recall.current = -1;
  }, [thread?.id, sent.length]);

  // ⌘S keeps the draft for later; on an empty composer it brings one back.
  const stashKey = `lc:stash:${project.id}`;
  const readStash = (): { text: string; at: number }[] => {
    try {
      return JSON.parse(localStorage.getItem(stashKey) || "[]") as { text: string; at: number }[];
    } catch {
      return [];
    }
  };
  const [stashOpen, setStashOpen] = useState(false);
  const stash = () => {
    const list = readStash();
    if (text.trim()) {
      localStorage.setItem(stashKey, JSON.stringify([{ text, at: Date.now() }, ...list].slice(0, 20)));
      setText("");
      toast("Stashed the draft", { description: "⌘S on an empty composer brings it back." });
      return;
    }
    if (list.length === 1) {
      setText(list[0].text);
      localStorage.setItem(stashKey, "[]");
    } else if (list.length > 1) setStashOpen(true);
    else toast("Nothing stashed", { description: "⌘S keeps a draft for later." });
  };
  const unstash = (i: number) => {
    const list = readStash();
    setText(list[i]?.text ?? "");
    localStorage.setItem(stashKey, JSON.stringify(list.filter((_, k) => k !== i)));
    setStashOpen(false);
    requestAnimationFrame(() => field.current?.focus());
  };

  // Images show as thumbnails before they go.
  const thumbs = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => thumbs.forEach((u) => u && URL.revokeObjectURL(u)), [thumbs]);

  const engineSettings = useEngine((s) => s.settings);
  const setups = useMemo(() => setupsOf(engineSettings, agents), [engineSettings, agents]);
  const setup = settings.setup ? setups.find((x) => x.id === settings.setup) : undefined;
  // Routed: who'd do what, from the models that are ready (and your own picks in Settings).
  const cast = useMemo(() => castOf(providers, engineSettings.route?.cast), [providers, engineSettings.route?.cast]);
  const routed = settings.route;
  // The Demo stays out of the list until it's shown (six taps on your name in the sidebar).
  const showDemo = engineSettings.showDemo === true;
  const leadAgents = agents.filter((a) => /lead/i.test(a.role) && a.id !== "demo");
  const mainCoder = agents.find((a) => a.specialty === "coder" && a.id !== "demo") ?? agents.find((a) => a.id !== "demo" && !/lead/i.test(a.role));
  // A session started straight with one agent before setups: it keeps a row of its own while it runs that way.
  const loner = !setup && !settings.lead && !isModelAgent(settings.agent) && settings.agent !== "demo";
  /** The makers of everyone in a way, as small marks. */
  const marksOf = (ids: string[]) => [...new Set(ids.map((id) => markOf(agentOf(id, agents, providers).model)))].map((k) => <ModelMark key={k} kind={k} size={11} />);

  const whoChip = routed ? (
    <>
      <span className="lc-way-chip-i">
        <I.branchIf size={12} />
      </span>
      <span className="lc-chip-name">Routed · {ROUTE_LEVELS.find((l) => l.id === routed)?.label}</span>
      {cast && <span className="lc-way-marks">{marksOf([`@${cast.everyday}`, `@${cast.strong}`])}</span>}
      <I.chevD size={11} />
    </>
  ) : setup || settings.lead ? (
      <>
        <span className="lc-way-chip-i">{setup ? <I.flow size={12} /> : <I.agents size={12} />}</span>
        <span className="lc-chip-name">{setup ? setup.name : "Lead and coder"}</span>
        <span className="lc-way-marks">{marksOf(setup ? [...(setup.lead ? [setup.lead] : []), ...setup.stages.map((st) => st.who)] : [settings.lead!, settings.agent])}</span>
        <I.chevD size={11} />
      </>
    ) : (
      <>
        <Disc agent={talkTo} size={22} />
        <span className="lc-chip-name" title={isModelAgent(settings.agent) || settings.agent === "demo" ? undefined : modelLabel(shownModel, providers)}>
          {isModelAgent(settings.agent) ? modelLabel(model, providers) : settings.agent === "demo" ? "Demo run" : coder.name}
        </span>
        {compare.length > 0 && <span className="lc-chip-more">· {compare.length + 1} models</span>}
        <I.chevD size={11} />
      </>
    );
  const helpers = settings.helpers ?? [];
  const helperPool = agents.filter((a) => a.id !== "demo" && a.id !== settings.lead && a.id !== settings.agent && !/lead/i.test(a.role));

  // Who the lead can bring in, how to compare, and a new agent: under the agents, in the room the
  // model list leaves there, so the panel is only as tall as its taller column.
  const teamExtras = (close: () => void) => (
    <>
      {routed && cast && (
        <div className="lc-team-help">
          <div className="lc-team-lab">How far it goes</div>
          <div className="lc-team-chips">
            {ROUTE_LEVELS.map((l) => (
              <button key={l.id} type="button" className="lc-mchip l-focus" data-on={routed === l.id || undefined} aria-pressed={routed === l.id} title={l.note} onClick={() => onSettings({ route: l.id })}>
                {l.label}
              </button>
            ))}
          </div>
          <p className="lc-quiet lc-team-note">
            {ROUTE_LEVELS.find((l) => l.id === routed)?.note}. {modelLabel(cast.everyday, providers)} does most of it, {modelLabel(cast.strong, providers)} the hard parts and repairs, {modelLabel(cast.judge, providers)} judges. Settings › Agentic features picks them.
          </p>
        </div>
      )}
      {settings.lead && !setup && helperPool.length > 0 && (
        <div className="lc-team-help">
          <div className="lc-team-lab">{talkTo.name} can bring in</div>
          <div className="lc-team-chips">
            {helperPool.map((a) => {
              const on = helpers.includes(a.id);
              return (
                <button key={a.id} type="button" className="lc-mchip l-focus" data-on={on || undefined} aria-pressed={on} title={a.role} onClick={() => onSettings({ helpers: on ? helpers.filter((x) => x !== a.id) : [...helpers, a.id] })}>
                  <Disc agent={a} size={16} />
                  {a.name}
                  <span className="lc-quiet">{modelLabel(a.model, providers)}</span>
                </button>
              );
            })}
          </div>
          <p className="lc-quiet lc-team-note">Steps in {talkTo.name}'s plan can go to them; {coder.name} still builds the rest.</p>
        </div>
      )}
      {onCompare && (
        <p className="lc-quiet lc-team-note lc-team-cmp">
          {compare.length ? `Sending to ${compare.length + 1}: each gets its own session and worktree from ${project.branch ?? "main"}. When they finish, compare and keep one.` : "Shift-click more models to give them the same ask, side by side."}
        </p>
      )}
      <div className="lc-team-foot">
        <button
          type="button"
          className="lc-link l-focus"
          onClick={() => {
            close();
            window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: "agentic" }));
          }}
        >
          <I.flow size={13} />
          Set up a way of working
        </button>
        {onNewAgent && (
          <button
            type="button"
            className="lc-link l-focus"
            onClick={() => {
              close();
              onNewAgent();
            }}
          >
            <I.plus size={13} />
            New agent
          </button>
        )}
      </div>
    </>
  );

  const teamPanel = (close: () => void) => (
    <div className="lc-team">
      <PanelHead end={project.name}>Who works on this</PanelHead>
      {/* Two columns side by side, as tall as the taller one, so the panel opens where it's asked. */}
      <div className="lc-team-cols">
        {agents.some((a) => a.id !== "demo") && (
          <div className="lc-team-col">
            <div className="lc-team-lab">How it works</div>
            {/* The ways by what they do, with who's in them underneath: a lead with its coder, your setups, the demo. */}
            {leadAgents.map((l) => (
              <WayRow
                key={l.id}
                on={!setup && settings.lead === l.id}
                icon={<I.agents size={13} />}
                title={leadAgents.length > 1 ? `Lead and coder, with ${l.name}` : "Lead and coder"}
                note={`${l.name} plans, ${(mainCoder ?? coder).name} builds`}
                marks={marksOf([l.id, (mainCoder ?? coder).id])}
                onPick={() => {
                  onSettings({ setup: undefined, route: undefined, lead: l.id, agent: mainCoder?.id ?? settings.agent, model: undefined });
                  close();
                }}
              />
            ))}
            {setups.map((x) => (
              <WayRow
                key={x.id}
                on={!routed && settings.setup === x.id}
                icon={<I.flow size={13} />}
                title={x.name}
                note={setupLine(x, agents, providers)}
                marks={marksOf([...(x.lead ? [x.lead] : []), ...x.stages.map((st) => st.who)])}
                onPick={() => {
                  onSettings({ setup: x.id, route: undefined, agent: x.stages[0].who, lead: x.lead ?? undefined, helpers: x.crew, model: undefined });
                  close();
                }}
              />
            ))}
            {cast && (
              <WayRow
                on={Boolean(routed)}
                icon={<I.branchIf size={13} />}
                title="Routed"
                note={`picked per message: ${modelLabel(cast.everyday, providers)} alone, checked, or ${modelLabel(cast.strong, providers)} with critics`}
                marks={marksOf([`@${cast.everyday}`, `@${cast.strong}`, `@${cast.judge}`, ...cast.critics.map((c) => `@${c}`)])}
                onPick={() => {
                  onSettings({ route: routed ?? engineSettings.route?.level ?? "high", setup: undefined, lead: undefined, helpers: undefined, agent: `@${cast.everyday}`, model: undefined });
                  close();
                }}
              />
            )}
            {loner && <WayRow on icon={<I.edit size={13} />} title={`Straight to ${coder.name}`} note="an agent on its own, from before setups" marks={marksOf([coder.id])} onPick={close} />}
            {showDemo && agents.some((a) => a.id === "demo") && (
              <WayRow
                on={!setup && !routed && !settings.lead && settings.agent === "demo"}
                icon={<I.sparkle size={13} />}
                title="Demo run"
                note="a scripted run, no account"
                onPick={() => {
                  onSettings({ setup: undefined, route: undefined, lead: undefined, agent: "demo", model: undefined });
                  close();
                }}
              />
            )}
            <div className="lc-team-extras">{teamExtras(close)}</div>
          </div>
        )}
        <div className="lc-team-col">
          <div className="lc-team-lab">Or just a model</div>
          {/* The models each tool said it runs: a rail of tools, a search, ⌘1 to ⌘9. */}
          <ModelPicker
            value={isModelAgent(settings.agent) && !settings.lead && !settings.setup && !routed ? settings.agent.slice(1) : undefined}
            also={compare.map((c) => c.slice(1))}
            autoFocus={false}
            height={330}
            onPick={(ref, how) => {
              const id = `@${ref}`;
              const on = isModelAgent(settings.agent) && !settings.lead && !settings.setup && !routed && settings.agent === id;
              // Shift-click gives the same ask to this model too, to compare and keep one.
              if (how.shiftKey && onCompare) {
                if (on) return;
                onCompare(compare.includes(id) ? compare.filter((x) => x !== id) : [...compare, id].slice(0, 3));
                return;
              }
              onSettings({ setup: undefined, route: undefined, lead: undefined, agent: id, model: undefined });
              onCompare?.(compare.filter((x) => x !== id));
              close();
            }}
          />
        </div>
      </div>
      {!agents.some((a) => a.id !== "demo") && teamExtras(close)}
    </div>
  );

  // The levels the coder's model takes; Claude Code's Ultracode and Ultrathink sit after them.
  // On Home they open downward, off the heading, and scroll in what room there is rather than flip.
  // Both trays hold their choices in one light bar, each drawn small beside its word.
  const effortPick = <EffortPick modelRef={model} value={settings.effort} onChange={(effort) => onSettings({ effort })} side={variant === "home" ? "bottom" : "top"} keep={variant === "home"} triggerClass="lc-seg-b lc-effort" hideEmpty />;
  const accessPick = (
    <Pop
      label={`Access: ${lev.label}. Change it`}
      side={variant === "home" ? "bottom" : "top"}
      keep={variant === "home"}
      align="end"
      width={320}
      triggerClass="lc-seg-b lc-access"
      trigger={
        <>
          <I.lock size={14} />
          <span className="lc-ctl-label">{lev.short}</span>
          <I.chevD size={11} />
        </>
      }
    >
      {(close) => (
        <>
          <PanelHead>What {settings.lead ? coder.name : isModelAgent(settings.agent) ? "it" : coder.name} may do in this session</PanelHead>
          {ACCESS_LEVELS.map((l) => (
            <Row key={l.id} title={l.label} note={l.note} on={settings.access === l.id} onPick={() => (onSettings({ access: l.id }), close())} />
          ))}
          <div className="lc-pop-foot">Read only also makes the agent plan first: you approve before anything changes.</div>
        </>
      )}
    </Pop>
  );

  const ready = Boolean(text.trim() || files.length);
  const sendButton = editing ? (
    <button type="button" className="lc-send l-focus" aria-label="Save the queued message" title="Save it in its place (Enter)" data-ready={ready || undefined} disabled={!ready} onClick={() => void send()}>
      <I.check size={16} />
    </button>
  ) :
    busy && variant === "session" ? (
      <>
        <Pop
          label="Queue or steer"
          side="top"
          align="end"
          width={300}
          triggerClass="lc-tray-note"
          trigger={
            <>
              <I.keyboard size={14} />
              <span className="lc-note-long">{mode === "queue" ? "Enter queues · ⌘Enter steers" : "Enter steers"}</span>
              <span className="lc-note-short">{mode === "queue" ? "Enter queues" : "Enter steers"}</span>
            </>
          }
        >
          {(close) => (
            <>
              <Row title="Queue it" note="Sent when this turn ends. You can still edit it." on={mode === "queue"} end={<kbd className="lc-kbd">Enter</kbd>} onPick={() => (setMode("queue"), close())} />
              <Row title="Steer now" note="Read at its next step, without stopping." on={mode === "steer"} end={<kbd className="lc-kbd">⌘ Enter</kbd>} onPick={() => (setMode("steer"), close())} />
              <div className="lc-pop-foot">Your pick becomes what Enter does. ⌘⇧Enter sends the first queued message now.</div>
            </>
          )}
        </Pop>
        <button type="button" className="lc-stop l-focus" aria-label="Stop" title="Stop (Esc)" onClick={onStop}>
          <I.stop />
        </button>
        <button type="button" className="lc-send l-focus" aria-label={mode === "queue" ? "Queue it" : "Steer now"} title={mode === "queue" ? "Queue it (Enter)" : "Steer now (Enter)"} data-ready={ready || undefined} disabled={!ready} onClick={() => void send()}>
          <I.send size={16} />
        </button>
      </>
    ) : compare.length > 0 ? (
      <button type="button" className="lc-send lc-send-n l-focus" aria-label={`Send to ${compare.length + 1} models`} data-ready={ready || undefined} onClick={() => void send()}>
        Send to {compare.length + 1}
      </button>
    ) : (
      <button type="button" className="lc-send l-focus" aria-label="Send" title="Send (Enter)" data-ready={ready || undefined} onClick={() => void send()}>
        <I.send size={16} />
      </button>
    );
  const attach = (
    <button type="button" className="lc-ctl-round l-focus" aria-label="Attach files" title="Attach files" onClick={() => clip.current?.click()}>
      <I.attach size={16} />
    </button>
  );

  return (
    <div
      className="lc-composer"
      data-variant={variant}
      data-drag={drag || undefined}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      {queue.length > 0 && (
        <div className="lc-queued">
          <div className="lc-queued-h">Queued for the next turn · {queue.length}</div>
          {queue.map((q, i) => (
            <div key={q.id} className="lc-queued-row" data-editing={editing?.id === q.id || undefined}>
              <span className="lc-queued-handle" aria-hidden>
                <I.drag size={13} />
              </span>
              <span className="lc-queued-t">{q.text}</span>
              {editing?.id === q.id && <span className="lc-queued-tag">Editing</span>}
              <button
                type="button"
                className="lc-queued-now l-focus"
                title={`${busy ? "Steer it into this turn now" : "Send it now"}${i === 0 ? " (⌘⇧Enter)" : ""}`}
                onClick={() => sendNow(q)}
              >
                Send now
              </button>
              {i > 0 && (
                <button type="button" className="lc-ib l-focus" aria-label="Move up" onClick={() => setQueue([...queue.slice(0, i - 1), q, queue[i - 1], ...queue.slice(i + 1)])}>
                  <I.chevU size={12} />
                </button>
              )}
              <button type="button" className="lc-ib l-focus" aria-label="Edit" aria-pressed={editing?.id === q.id} title="Edit it in place" onClick={() => (editing?.id === q.id ? stopEditing() : editQueued(q))}>
                <I.edit size={12} />
              </button>
              <button
                type="button"
                className="lc-ib l-focus"
                aria-label="Remove"
                onClick={() => {
                  if (editing?.id === q.id) stopEditing();
                  setQueue(queue.filter((x) => x.id !== q.id));
                }}
              >
                <I.close size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {cold && (
        <div className="lc-cold" role="status">
          <I.clock size={13} />
          <span className="lc-cold-t">The cache has expired: this message re-reads {compact(usage?.contextTokens ?? 0)} tokens. Compact first?</span>
          <button type="button" className="lc-btn" data-kind="plain" data-size="sm" onClick={compactNow}>
            Compact
          </button>
          <button type="button" className="lc-ib l-focus" aria-label="Not now" title="Not now" onClick={() => setColdSeen(cacheUntil)}>
            <I.close size={12} />
          </button>
        </div>
      )}

      <div className="lc-card">
        {files.length > 0 && (
          <div className="lc-files">
            {files.map((f, i) => (
              <span key={`${f.name}${i}`} className="lc-file-chip" data-image={thumbs[i] ? true : undefined}>
                {thumbs[i] ? <img src={thumbs[i]!} alt="" className="lc-file-thumb" /> : <I.file size={13} />}
                {f.name}
                <span>{f.size < 1024 ? `${f.size} B` : `${Math.round(f.size / 1024)} KB`}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                  <I.close size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="lc-field-box">
        <div ref={mirrorRef} className="lc-field lc-field-md" aria-hidden>
          {md}
        </div>
        <textarea
          ref={field}
          className="lc-field"
          data-md=""
          onScroll={(e) => mirrorRef.current && (mirrorRef.current.scrollTop = e.currentTarget.scrollTop)}
          rows={variant === "home" ? 3 : 1}
          value={text}
          placeholder={placeholder}
          aria-label="Message"
          onChange={(e) => {
            onType(e.target.value, e.target.selectionStart);
            setStashOpen(false);
          }}
          onBlur={() => setStashOpen(false)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
              return;
            }
            // A big paste (a log, a file's worth) comes as a text file instead, to keep the message
            // readable; the toast puts it in the message after all if that's what you meant.
            const plain = e.clipboardData.getData("text/plain");
            if (!plain || bytesOf(plain) < PASTE_AS_FILE || files.length >= 10) return;
            e.preventDefault();
            const el = e.currentTarget;
            const at = { start: el.selectionStart, end: el.selectionEnd };
            const file = new File([plain], pastedName(files.map((f) => f.name)), { type: "text/plain" });
            addFiles([file]);
            toast(`Pasted as ${file.name}`, {
              description: `${Math.round(file.size / 1024)} KB of text, sent as a file`,
              action: {
                label: "Put it in the message",
                onClick: () => {
                  setFiles((list) => list.filter((f) => f !== file));
                  setText((cur) => `${cur.slice(0, Math.min(at.start, cur.length))}${plain}${cur.slice(Math.min(at.end, cur.length))}`);
                },
              },
            });
          }}
          onKeyDown={(e) => {
            if (mention && found.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setHl((h) => (h + (e.key === "ArrowDown" ? 1 : found.length - 1)) % found.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickFile(found[hl]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMention(null);
                return;
              }
            }
            // A list still showing (commands on their way, nothing matching, stashed drafts) closes first; Escape stops the turn only after.
            if (e.key === "Escape" && ((mention && mention.kind !== "@") || stashOpen)) {
              e.preventDefault();
              setMention(null);
              setStashOpen(false);
              return;
            }
            // Escape leaves a queued message as it was, and brings back the draft it pushed aside.
            if (e.key === "Escape" && editing) {
              e.preventDefault();
              stopEditing();
              return;
            }
            if (is(e.nativeEvent, "stash")) {
              e.preventDefault();
              stash();
              return;
            }
            // ↑ recalls only when the caret is on the first line, so editing a long draft still moves up.
            if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !mention && sent.length && (!text || recall.current >= 0) && !(e.key === "ArrowUp" && !text && queue.length)) {
              const el = e.currentTarget;
              const firstLine = !el.value.slice(0, el.selectionStart).includes("\n");
              if (e.key === "ArrowUp" && firstLine && recall.current < sent.length - 1) {
                e.preventDefault();
                recall.current += 1;
                setText(sent[sent.length - 1 - recall.current]);
                return;
              }
              if (e.key === "ArrowDown" && recall.current >= 0) {
                e.preventDefault();
                recall.current -= 1;
                setText(recall.current >= 0 ? sent[sent.length - 1 - recall.current] : "");
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(busy && (e.metaKey || e.ctrlKey) ? "steer" : busy ? mode : "queue");
            } else if (e.key === "Escape" && busy) onStop?.();
            else if (e.key === "ArrowUp" && !text && queue.length) {
              // The last queued message, to edit where it is.
              e.preventDefault();
              editQueued(queue[queue.length - 1]);
            }
          }}
        />
        </div>
        {stashOpen && (
          <div className="lc-mention l-glass" role="listbox" aria-label="Stashed drafts">
            <span className="lc-quiet lc-mention-wait">Stashed drafts</span>
            {readStash().map((x, i) => (
              <button key={x.at} type="button" role="option" aria-selected={false} className="lc-mention-row" onMouseDown={(e) => (e.preventDefault(), unstash(i))}>
                <I.edit size={12} />
                <span className="lc-mention-d lc-stash-t">{x.text.split("\n")[0]}</span>
                <span className="lc-quiet">{ago(x.at)}</span>
              </button>
            ))}
          </div>
        )}
        {mention && (found.length > 0 || (mention.kind !== "@" && !tools)) && (
          <div className="lc-mention l-glass" role="listbox" aria-label={mention.kind === "@" ? "Files" : mention.kind === "/" ? "Commands" : "Skills"}>
            {mention.kind !== "@" && !tools && <span className="l-shimmer lc-mention-wait">Asking the tool for its {mention.kind === "/" ? "commands" : "skills"}</span>}
            {found.map((f, i) => (
              <button key={f.key} type="button" role="option" aria-selected={i === hl} className="lc-mention-row" data-kind={f.kind} onMouseEnter={() => setHl(i)} onMouseDown={(e) => (e.preventDefault(), pickFile(f))}>
                {f.kind === "@" ? <I.file size={13} /> : f.kind === "/" ? <span className="lc-mention-k">/</span> : <I.sparkle size={13} />}
                <span className="lc-mono lc-mention-n">
                  {f.label}
                  {f.hint && <span className="lc-quiet"> {f.hint}</span>}
                </span>
                {f.note && <span className="lc-mention-d">{f.note}</span>}
                {f.liner && <span className="lc-mp-def">Liner Code</span>}
              </button>
            ))}
            {mention.kind !== "@" && tools && found.length === 0 && <span className="lc-quiet lc-mention-wait">No {mention.kind === "/" ? "command" : "skill"} matches that.</span>}
          </div>
        )}
        {/* The controls sit in a tray of their own inside the text box: solid ink in a lit pill. */}
        <div className="lc-card-row" ref={tray}>
          {variant === "session" && attach}
          <span className="lc-seg">
            <Pop label="Who works on this" side={variant === "home" ? "bottom" : "top"} width={640} keep={variant === "home"} triggerClass="lc-seg-b lc-who" trigger={whoChip}>
              {teamPanel}
            </Pop>
            {effortPick && <span className="lc-seg-div" aria-hidden />}
            {effortPick}
            {variant === "session" && ctx !== undefined && usage?.contextTokens && usage.contextWindow && (
              <>
                <span className="lc-seg-div" aria-hidden />
                <ContextMeter used={usage.contextTokens} max={usage.contextWindow} running={busy} onCompact={canCompact ? compactNow : undefined} />
              </>
            )}
            <span className="lc-seg-div" aria-hidden />
            {accessPick}
          </span>
          <span className="lc-grow" />
          {editing ? (
            <span className="lc-tray-note">Editing a queued message · Enter saves · Esc leaves it</span>
          ) : (
            variant === "session" && !busy && queue.length > 0 && <span className="lc-tray-note">{plural(queue.length, "message")} waiting</span>
          )}
          {variant === "home" && attach}
          {sendButton}
        </div>
        <input ref={clip} type="file" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
      </div>

      {variant === "home" ? (
        <div className="lc-strip">
          {project.git ? (
            <Pop
              label="Where it runs"
              width={300}
              triggerClass="lc-pb"
              trigger={
                <>
                  <I.folder size={13} />
                  {compare.length ? `${compare.length + 1} new worktrees` : inWorktree ? `The ${inWorktree.branch ?? "other"} worktree` : worktree ? "A new worktree" : "This checkout"}
                  <I.chevD size={11} />
                </>
              }
            >
              {(close) => (
                <WhereRows
                  project={project}
                  git={git}
                  onOpen={loadGit}
                  worktree={Boolean(worktree)}
                  inWorktree={inWorktree}
                  onPick={(w, existing) => {
                    onWorktree?.(w);
                    onInWorktree?.(existing);
                    close();
                  }}
                />
              )}
            </Pop>
          ) : (
            <span className="lc-strip-note">
              <I.folder size={13} />
              {project.path.replace(/^\/Users\/[^/]+/, "~")}
            </span>
          )}
          {worktree && !inWorktree && project.git && !compare.length ? (
            // A new worktree starts from a branch you pick: this one by default.
            <Pop
              label="The branch it starts from"
              width={300}
              triggerClass="lc-pb"
              trigger={
                <>
                  from <I.branch size={13} />
                  <span className="lc-mono">{base ?? project.branch ?? "HEAD"}</span>
                  <I.chevD size={11} />
                </>
              }
            >
              {(close) => <BaseRows git={git} onOpen={loadGit} current={base ?? project.branch} onPick={(b) => (onBase?.(b), close())} />}
            </Pop>
          ) : (
            (inWorktree?.branch ?? project.branch) && (
              <span className="lc-strip-note">
                on <I.branch size={13} />
                <span className="lc-mono">{inWorktree?.branch ?? project.branch}</span>
              </span>
            )
          )}
          <span className="lc-grow" />
          {stripEnd}
        </div>
      ) : null}
    </div>
  );
}

/** A way of working in the panel: what it does, who's in it underneath, and their makers' marks. */
function WayRow({ on, icon, title, note, marks, onPick }: { on: boolean; icon: ReactNode; title: string; note: string; marks?: ReactNode; onPick: () => void }) {
  return (
    <button type="button" className="lc-agent-row lc-way-row l-focus" data-on={on || undefined} aria-pressed={on} onClick={onPick}>
      <span className="lc-radio" data-on={on || undefined} />
      <span className="lc-way-i">{icon}</span>
      <span className="lc-agent-row-t">
        <b>{title}</b>
        <span>{note}</span>
      </span>
      {marks && <span className="lc-way-marks">{marks}</span>}
    </button>
  );
}

export const Hints = ({ children }: { children?: ReactNode }) => <div className="lc-hints">{children}</div>;
