/*
  The composer. One card, the same on Home and in a session: you write in it, and the run's
  settings sit on its lower edge as plain text buttons. Round it, the tray (Devin's): a tinted
  holder that is there only when it has a row to carry. In a session its head says what waits on
  you (files to commit, agents at work); on Home its foot says where the session runs. What's
  queued sits above it.

  - Who works on this: a pair (the lead, with a sidekick it hands work to), the best model alone,
    the fast one alone, or any model a tool runs, or one of your agents. Picking the pair shows
    who leads and who's its sidekick, each changeable for this session.
  - Effort and access open glass menus; access is Auto, Manual or Reviewer decides, with Full access last.
  - @ finds a file in the project; files come from the clip, a paste or a drop.
  - While an agent works, Enter queues the message for when the turn ends; ⌘Enter steers the
    running turn instead. Your pick becomes what Enter does. A queued message can be sent now
    (⌘⇧Enter for the first), or edited where it waits.
  - A paste of 32 KiB or more comes as a text file. Drafts outlast a restart.
*/
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as KeyEvent, type ReactNode, type RefObject } from "react";
import type { Access, CommandInfo, SkillInfo, Effort, Project, ProviderInfo, QueuedMessage, RpcResult, Thread } from "@contracts";
import { castOf, costOf, familyOf, pairCostOf, shortlistOf, splitModel } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { is } from "./keymap";
import { mirror } from "./mdMirror";
import { isPrompt, rpc, useEngine, useItems, useItemsWhere } from "./engine";
import { I, ModelMark, type MarkKind } from "./icons";
import { ACCESS_LEVELS, accessOf, ago, agentOf, compact, designPart, isModelAgent, markOf, modelLabel, pairReady, plural, providerLabel, shortName, since, wayOf, whoOf, type Way } from "./model";
import { onComposerInsert } from "./Find";
import { EffortPick, ModelPicker } from "./Models";
import { CostMini, costScale, PairCost } from "./PairCost";
import { SideKeys } from "./TopBar";
import { ContextMeter, Disc, LimitMeter, PanelHead, Pop, Row, Sep } from "./ui";
import * as os from "./os";
import { drawingOf, setFace } from "./face";
import type { DockAsk } from "./Ask";

/**
  Who works on a session and how. `agent` is the lead (a model, "@<provider>:<model>", or one of
  your agents); `sidekick`, set, makes it a pair: the model the lead hands work to. `review` is the
  session's own word on the Reviewer, unset following Settings.
*/
export type RunSettings = { agent: string; sidekick?: string; model?: string; effort: Effort; access: Access; review?: boolean };
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
  /** Home: text a new task starts with (Create your add-on), put in the box and not sent; `at` tells one ask from the next. */
  seed?: { text: string; at: number };
  /** Home: more models given the same ask, to compare and keep one ("@provider:model"). */
  compare?: string[];
  onCompare?: (refs: string[]) => void;
  /** Home: how the session works (its mode), at the strip's right end, under the box's edge. */
  stripEnd?: ReactNode;
  /** Home: the other ways to start, which aren't settings of this task: a quiet line under the strip. */
  stripUnder?: ReactNode;
  /** Home: the box's text as it changes, so an add-on ask can switch the task's mode. */
  onText?: (text: string) => void;
  /**
    A session: the tray's head, rows over the card (what's waiting to commit, who the work waits
    on). A row that renders nothing leaves the head empty, and with nothing in it the tray isn't
    drawn (app.css reads that with :has, so a row coming or going needs no word from here).
  */
  top?: ReactNode;
  /**
    A session: the ask at the composer (Ask.tsx), which `top` shows. While it's up the box is
    where you tell the agent what to do instead, and Enter and Esc answer it as askKey says.
  */
  ask?: DockAsk;
  /**
    Liner Design's dock (design/Dock.tsx) passes these. `chips`: what's selected on the canvas, in
    the input row before the text. `whoName`: the who chip's words in place of the model's (G's
    "Pair + pictures"). `trayEnd`: more chips after the choices (E's skills). `canvas`: this
    composer is the canvas's own, so it doesn't offer "Watch on the canvas".
  */
  chips?: ReactNode;
  /** Home's strip: what stands at its left in place of where it runs (Design Home's lean chip). */
  stripStart?: ReactNode;
  whoName?: ReactNode;
  trayEnd?: ReactNode;
  canvas?: boolean;
  /** More rows for the `/` list, first (Liner Design's skills): picking one runs `onPick` and takes the typed `/…` away. */
  slashRows?: SlashRow[];
};
export type SlashRow = { name: string; hint?: string; note?: string; tag?: string; onPick: () => void };

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

type Choice = { key: string; insert: string; label: string; kind: "@" | "/" | "$"; hint?: string; note?: string; path?: string; liner?: boolean; tag?: string; pick?: () => void };
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
  const tilde = os.tilde;
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

/** Words written to a session elsewhere (its tile on the Wall), put after its draft for its composer to find when it opens. */
export function addToDraft(key: string, text: string) {
  const was = draftOf(key);
  keepDraft(key, was.trim() ? `${was.trimEnd()}\n\n${text}` : text);
}

/** Files waiting to go, by draft, while the app runs: a File can't be stored, but it lasts a move to another session and back. */
const draftFiles = new Map<string, File[]>();
const MAX_FILES = 10;

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
/** The model picker's tab for your agents (no tool has this id). */
const AGENTS_TAB = "@agents";
/** The tools whose models the picker lists: ready, with models, the Demo apart (it has a row of its own). */
const toolsOf = (providers: ProviderInfo[]) => providers.filter((p) => p.available && p.adapter && p.models.length && p.id !== "demo");

const toBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

export function Composer({ variant, project, thread, settings, onSettings, onSend, onStop, onNewAgent, busy, placeholder, worktree, onWorktree, base, onBase, inWorktree, onInWorktree, autoFocus, seed, compare = [], onCompare, stripEnd, stripUnder, onText, top, chips, stripStart, whoName, trayEnd, canvas, slashRows, ask }: Props) {
  // Kept with the project it was read for: on Home another project's worktrees and branches never show (or get picked) for this one.
  const [gitOf, setGitOf] = useState<{ projectId: string; git: Awaited<ReturnType<typeof branchesFor>> } | null>(null);
  const git = gitOf?.projectId === project.id ? gitOf.git : null;
  const loadGit = () => {
    const projectId = project.id;
    void branchesFor(projectId).then((g) => setGitOf({ projectId, git: g }), () => {});
  };
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const draftKey = thread?.id ?? "home";
  const [text, setText] = useState(() => draftOf(draftKey));
  // A queued message being edited: it keeps its place in the queue, and the draft it pushed aside comes back after.
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [files, setFiles] = useState<File[]>(() => draftFiles.get(draftKey) ?? []);
  const [mode, setMode] = useState<"queue" | "steer">(() => (localStorage.getItem("lc:enter") as "steer") ?? "queue");
  const [mention, setMention] = useState<{ start: number; query: string; kind: "@" | "/" | "$" } | null>(null);
  const [found, setFound] = useState<Choice[]>([]);
  const [tools, setTools] = useState<{ commands: CommandInfo[]; skills: SkillInfo[] } | null>(null);
  const [hl, setHl] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  // Markdown styled as you type: the mirror behind the field draws the same text with its look.
  const mirrorRef = useRef<HTMLDivElement>(null);
  const md = useMemo(() => mirror(text), [text]);
  const clip = useRef<HTMLInputElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  useTrayFit(tray);

  // The lead: who you talk to, whose model the effort is for.
  const coder = agentOf(settings.agent, agents, providers);
  const model = settings.model ?? coder.model;
  const shownModel = model;
  const lev = accessOf(settings.access);
  // Claude Code through another maker's API: its Auto can't run there, so it runs as Edits on its own (engine: claude.ts modeOf).
  const noAuto = model ? providers.find((p) => p.id === splitModel(model).provider)?.supports.auto === false : false;
  // The plan windows of the tools this runs on (who you talk to first), when they report any.
  const limits = useEngine((s) => s.limits);
  const planOf = useMemo(
    () =>
      [...new Set([shownModel, model])].flatMap((ref) => {
        const { provider, model: id } = splitModel(ref);
        return limits.filter((l) => l.provider === provider && l.windows.length && (!l.models || id.startsWith(l.models)));
      }).filter((l, i, all) => all.findIndex((x) => x.provider === l.provider) === i),
    [limits, shownModel, model],
  );
  const queue = thread?.queue ?? [];
  const usage = thread?.usage;
  // Past the window can't be: that's a total an older version saved, not how full the context is.
  const ctx = usage?.contextTokens && usage.contextWindow && usage.contextTokens <= usage.contextWindow ? usage.contextTokens / usage.contextWindow : undefined;

  const recall = useRef(-1);
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
  // Quitting doesn't wait for that moment (T3 Code: composerDraftStore.ts).
  useEffect(() => {
    window.addEventListener("beforeunload", flushDraft);
    return () => window.removeEventListener("beforeunload", flushDraft);
  }, []);
  useEffect(() => {
    if (files.length) draftFiles.set(draftKey, files);
    else draftFiles.delete(draftKey);
  }, [files, draftKey]);
  useEffect(() => {
    try {
      localStorage.setItem("lc:enter", mode);
    } catch {
      // Shut storage: Enter does this for as long as the window is open.
    }
  }, [mode]);

  // The ask at the composer reads the box through this: its words are the reason a no carries.
  // Words that were there before the ask came are a draft of yours, not a reason: they stay put.
  const arrivedWith = useRef<{ id: string; text: string } | null>(null);
  if (ask && arrivedWith.current?.id !== ask.it.id) arrivedWith.current = { id: ask.it.id, text };
  // Every change to the box (a key, a paste, a message sent out of it) holds Enter back from the ask for a moment.
  const changedAt = useRef(0);
  const askNow = useRef(ask);
  askNow.current = ask;
  useEffect(() => {
    changedAt.current = Date.now();
    if (askNow.current) askNow.current.typedAt.current = changedAt.current;
  }, [text]);
  if (ask) {
    ask.typedAt.current = Math.max(ask.typedAt.current, changedAt.current);
    ask.box.current = {
      text: () => text,
      take: () => {
        const t = text.trim();
        if (!t || text === arrivedWith.current?.text) return undefined;
        setText("");
        setMention(null);
        return t;
      },
      focus: () => field.current?.focus(),
    };
  }

  // The field grows with what you write, up to eight lines, then scrolls. It measures again when
  // its width changes, or a height taken while the column was narrow (the placeholder wrapping)
  // would stay after it widens.
  const fit = (glide = true) => {
    const el = field.current;
    if (!el) return;
    // Measured with the height's transition off: with it on, the height set to measure only starts
    // a transition, the old height is still what lays out, and the field never shrinks.
    const was = el.style.height;
    el.style.transition = "none";
    el.style.height = "0px";
    const next = `${Math.min(el.scrollHeight, LINE * MAX_LINES + 20)}px`;
    if (glide) {
      el.style.height = was;
      void el.offsetHeight;
      el.style.transition = "";
      el.style.height = next;
      return;
    }
    // A new width (the sidebar or the panel on its way) refits every frame: the field takes its
    // height in that frame, as the text in it does, rather than starting a glide each time.
    el.style.height = next;
    void el.offsetHeight;
    el.style.transition = "";
  };
  useLayoutEffect(fit, [text]);
  // The field has already scrolled to the caret; the mirror keeps its line in the same frame, not after the scroll event.
  useLayoutEffect(() => {
    if (mirrorRef.current && field.current) mirrorRef.current.scrollTop = field.current.scrollTop;
  }, [text]);
  useEffect(() => {
    const el = field.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit(false);
    });
    ro.observe(el);
    // The font arriving changes how the placeholder wraps too. Already here, the field was measured with it.
    if (document.fonts && document.fonts.status !== "loaded") void document.fonts.ready.then(() => fit(false));
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus, thread?.id]);

  // What / and $ offer: the tool's own commands and skills, asked once per tool and folder.
  const who = settings.agent;
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
    if (!mention) {
      setFound([]);
      return;
    }
    // Rows from another kind of mention (files under a new / or $) never carry over.
    setFound((f) => (f[0] && f[0].kind !== mention.kind ? [] : f));
    let live = true;
    const q = mention.query.toLowerCase();
    const rank = (name: string) => (name.toLowerCase().startsWith(q) ? 0 : 1);
    if (mention.kind === "@")
      void rpc("fs.files", { projectId: project.id, threadId: thread?.id, query: mention.query, limit: 8 }).then((r) => {
        if (!live) return;
        setFound(r.map((f) => ({ key: f.path, insert: `@${f.path}`, label: f.path, kind: "@" })));
        setHl(0);
      }, () => live && setFound([]));
    else if (tools || (mention.kind === "/" && slashRows?.length)) {
      const extra = mention.kind === "/" ? (slashRows ?? []).filter((r) => `${r.name} ${r.note ?? ""}`.toLowerCase().includes(q)).map((r): Choice => ({ key: `+${r.name}`, insert: "", label: `/${r.name}`, hint: r.hint, note: r.note, kind: "/", tag: r.tag, pick: r.onPick })) : [];
      const list = !tools ? extra :
        mention.kind === "/"
          ? [...extra, ...tools.commands.filter((c) => `${c.name} ${c.description}`.toLowerCase().includes(q)).sort((a, b) => rank(a.name) - rank(b.name)).map((c): Choice => ({ key: c.name, insert: `/${c.name}`, label: `/${c.name}`, hint: c.hint, note: c.description, kind: "/", liner: c.source === "liner" }))]
          : tools.skills.filter((x) => `${x.name} ${x.description}`.toLowerCase().includes(q)).sort((a, b) => rank(a.name) - rank(b.name)).map((x): Choice => ({ key: x.name, insert: `$${x.name}`, label: `$${x.name}`, note: x.description, kind: "$", path: x.path }));
      setFound(list.slice(0, 12));
      setHl(0);
    }
    return () => {
      live = false;
    };
  }, [mention, project.id, thread?.id, tools, slashRows]);

  // The row under ↑ and ↓ stays in view in a list that scrolls (a short window).
  useEffect(() => {
    const box = list.current;
    const row = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!box || !row) return;
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
  }, [hl, found]);

  const onType = (v: string, caret: number) => {
    setText(v);
    // Changed by hand, it's yours: ↑ on the first line no longer swaps it for an older message.
    recall.current = -1;
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
    if (c.pick) {
      setText(`${text.slice(0, mention.start)}${text.slice(end)}`.trimStart());
      setMention(null);
      c.pick();
      return void requestAnimationFrame(() => field.current?.focus());
    }
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
        // Edited, it is your own words now: what Liner wrote for you to read of it no longer says it.
        setQueue(queue.map((x) => (x.id === edit.id ? { ...x, text: t, shown: undefined } : x)));
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
      const from = document.activeElement;
      const payload = { text: t || "Here are the files.", files: await Promise.all(files.map(async (f) => ({ name: f.name, data: await toBase64(f) }))), mode: how };
      setText(edit?.draft ?? "");
      setFiles([]);
      setMention(null);
      handed = true;
      // The button pressed goes as the turn starts, and the keys would go with it.
      if (variant === "session" && (document.activeElement === from || document.activeElement === document.body)) field.current?.focus();
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
    // Read now: the file picker's list empties as its field is cleared, before an update waiting its turn runs.
    const added = Array.from(list ?? []);
    if (!added.length) return;
    if (files.length + added.length > MAX_FILES) toast(`A message takes ${MAX_FILES} files at most`, { description: `${plural(files.length + added.length - MAX_FILES, "file")} left out.` });
    setFiles((f) => [...f, ...added].slice(0, MAX_FILES));
  };

  const setQueue = (q: QueuedMessage[]) => {
    if (thread) void rpc("thread.queue", { id: thread.id, queue: q }).catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  };

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
      .then(() => rpc("thread.send", { id: thread.id, text: words, mode: "steer", ...(q.shown && words === q.text ? { shown: q.shown } : {}) }))
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

  // ⌘⇧Enter sends the first queued message now, wherever the focus is in the session; beside another, only in the side you're in.
  const keys = useContext(SideKeys);
  const live = useRef({ queue, sendNow, keys });
  live.current = { queue, sendNow, keys };
  useEffect(() => {
    if (!thread) return;
    const onKey = (e: KeyboardEvent) => {
      if (!live.current.keys) return;
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

  useEffect(() => onText?.(text), [text]);

  // Text a new task starts with: an empty box takes it, else it follows what's there as a paragraph of
  // its own (DeepSeek Harness's whenDraftExists "append"), once. It isn't sent: the caret waits at its end.
  const caretToEnd = useRef(false);
  useEffect(() => {
    if (!seed) return;
    caretToEnd.current = true;
    setText((cur) => (!cur.trim() ? seed.text : cur.includes(seed.text) ? cur : `${cur.trimEnd()}\n\n${seed.text}`));
  }, [seed?.at]);
  useEffect(() => {
    const el = field.current;
    if (!caretToEnd.current || !el) return;
    caretToEnd.current = false;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [text, seed?.at]);

  // Text sent here from elsewhere (a quote, a terminal excerpt) lands at the caret.
  useEffect(() => {
    if (!thread) return;
    return onComposerInsert(thread.id, (add) => {
      // Asked here, once: an update function can run twice, and by then focus may have moved.
      const box = field.current;
      const caret = box && document.activeElement === box ? box.selectionStart : null;
      let end = -1;
      setText((cur) => {
        const before = cur.slice(0, caret ?? cur.length);
        const lead = before && !before.endsWith("\n") ? "\n\n" : "";
        end = before.length + lead.length + add.length;
        return `${before}${lead}${add}${cur.slice(caret ?? cur.length)}`;
      });
      requestAnimationFrame(() => {
        const el = field.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(end < 0 ? el.value.length : end, end < 0 ? el.value.length : end);
      });
    });
  }, [thread?.id]);

  // ↑ in an empty composer brings back what you sent here, newest first; ↓ comes forward.
  // Only your messages: a reply streaming in doesn't redraw the composer.
  const items = useItemsWhere(thread?.id, isPrompt);
  const sent = items.flatMap((x) => (x.kind === "user" && !x.steer ? [x.text] : []));
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
      toast("Stashed the draft", { description: `${os.mod}S on an empty composer brings it back.` });
      return;
    }
    if (list.length === 1) {
      setText(list[0].text);
      localStorage.setItem(stashKey, "[]");
    } else if (list.length > 1) setStashOpen(true);
    else toast("Nothing stashed", { description: `${os.mod}S keeps a draft for later.` });
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

  // Who works, as the chip names them: a pair's two marks and "Opus 5.5 + Sol", else the one model or agent.
  const whoNow = whoOf(settings, agents, providers);
  const whoChip = (
    <>
      {whoNow.agent ? (
        <Disc agent={whoNow.agent} size={22} />
      ) : (
        <span className="lc-who-marks" data-two={whoNow.marks.length > 1 || undefined}>
          {whoNow.marks.map((k, i) => (
            <span key={`${k}${i}`} className="lc-who-tile">
              <ModelMark kind={k} size={12} />
            </span>
          ))}
        </span>
      )}
      <span className="lc-chip-name" title={whoNow.full !== whoNow.name ? whoNow.full : undefined}>
        {whoName ?? whoNow.name}
      </span>
      {whoNow.agent && settings.sidekick && (
        <span className="lc-way-marks">
          <ModelMark kind={markOf(settings.sidekick)} size={11} />
        </span>
      )}
      {compare.length > 0 && <span className="lc-chip-more">· {compare.length + 1} models</span>}
      <I.chevD size={11} />
    </>
  );
  // A pair shows its Lead and Sidekick beside the rows, so the panel is wider then.
  const pairShown = Boolean(settings.sidekick) && settings.agent !== "demo";

  // The levels the coder's model takes; Claude Code's Ultracode and Ultrathink sit after them.
  // On Home they open downward, off the heading, and scroll in what room there is rather than flip.
  // Both trays hold their choices in one light bar, each drawn small beside its word.
  const effortPick = <EffortPick modelRef={model} value={settings.effort} onChange={(effort) => onSettings({ effort })} side={variant === "home" ? "bottom" : "top"} keep={variant === "home"} triggerClass="lc-seg-b lc-effort" hideEmpty />;
  // Permissions as a short list (Claude Code's own): Auto, Manual and Reviewer decides, each a
  // number away while it's open, and Full access last, a row of its own that you enable.
  const LevelIcon = ACCESS_ICONS[settings.access] ?? I.ahead;
  const picks = ACCESS_LEVELS.filter((l) => l.id !== "full");
  const full = ACCESS_LEVELS.find((l) => l.id === "full")!;
  const accessPick = (
    <Pop
      label={`Permissions: ${lev.label}. Change them`}
      side={variant === "home" ? "bottom" : "top"}
      keep={variant === "home"}
      align="end"
      width={340}
      triggerClass="lc-seg-b lc-access"
      trigger={
        <>
          <LevelIcon size={14} />
          <span className="lc-ctl-label">{lev.short}</span>
          <I.chevD size={11} />
        </>
      }
    >
      {(close) => {
        const pick = (access: Access) => (onSettings({ access }), close());
        return (
          <div
            className="lc-perm"
            role="radiogroup"
            aria-label="Permissions"
            onKeyDown={(e) => {
              const l = picks[Number(e.key) - 1];
              if (!l || e.metaKey || e.ctrlKey || e.altKey) return;
              e.preventDefault();
              pick(l.id);
            }}
          >
            <div className="lc-perm-h">Permissions</div>
            {picks.map((l, i) => (
              <button key={l.id} type="button" role="radio" aria-checked={settings.access === l.id} className="lc-perm-r l-focus" onClick={() => pick(l.id)}>
                <span className="lc-perm-t">
                  <b>{l.label}</b>
                  <small>{l.id === "auto" && noAuto ? "With this model Liner Code decides what's routine itself, by simple rules: the safety check Auto relies on only runs on Anthropic's own models." : l.note}</small>
                </span>
                {settings.access === l.id && <I.check size={16} />}
                <kbd className="lc-perm-k">{i + 1}</kbd>
              </button>
            ))}
            <button type="button" role="radio" aria-checked={settings.access === "full"} className="lc-perm-r lc-perm-full l-focus" title={full.note} onClick={() => pick("full")}>
              <span className="lc-perm-t">
                <b>{full.label}</b>
              </span>
              {settings.access === "full" ? <I.check size={16} /> : <span className="lc-perm-on">Enable</span>}
            </button>
          </div>
        );
      }}
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
              <span className="lc-note-long">{mode === "queue" ? `Enter queues · ${os.mod}Enter steers` : "Enter steers"}</span>
              <span className="lc-note-short">{mode === "queue" ? "Enter queues" : "Enter steers"}</span>
            </>
          }
        >
          {(close) => (
            <>
              <Row title="Queue it" note="Sent when this turn ends. You can still edit it." on={mode === "queue"} end={<kbd className="lc-kbd">Enter</kbd>} onPick={() => (setMode("queue"), close())} />
              <Row title="Steer now" note="Read at its next step, without stopping." on={mode === "steer"} end={<kbd className="lc-kbd">{os.keys("mod+enter", " ")}</kbd>} onPick={() => (setMode("steer"), close())} />
              <div className="lc-pop-foot">Your pick becomes what Enter does. {os.mod}{os.shift}Enter sends the first queued message now.</div>
            </>
          )}
        </Pop>
        <button type="button" className="lc-stop l-focus" aria-label="Stop" title="Stop (Esc)" onClick={() => (onStop?.(), field.current?.focus())}>
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
    <button type="button" className="lc-ctl-attach l-focus" aria-label="Attach files" title="Attach files" onClick={() => clip.current?.click()}>
      <I.attach size={16} />
    </button>
  );

  // What waits for the next turn. Liner Design's composer (canvas) keeps it inside its tray, over the box, with the tray's grey behind it.
  const queued = queue.length > 0 && (
    <div className="lc-queued">
      <div className="lc-queued-h">Queued for the next turn · {queue.length}</div>
      {queue.map((q, i) => (
        <div key={q.id} className="lc-queued-row" data-editing={editing?.id === q.id || undefined}>
          <span className="lc-queued-handle" aria-hidden>
            <I.drag size={13} />
          </span>
          {/* A line Liner wrote for you: the whole of what the agent will be told is its tooltip (a fold has no room in the row). */}
          <span className="lc-queued-t" title={q.shown ? q.text : undefined}>{q.shown?.text || designPart(q.text).said}</span>
          {editing?.id === q.id && <span className="lc-queued-tag">Editing</span>}
          <button
            type="button"
            className="lc-queued-now l-focus"
            title={`${busy ? "Steer it into this turn now" : "Send it now"}${i === 0 ? ` (${os.mod}${os.shift}Enter)` : ""}`}
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
      // Moving over its own parts is no leaving.
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDrag(false)}
      onDrop={(e) => {
        setDrag(false);
        // Words dragged in are the field's to take.
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }}
    >
      {!canvas && queued}

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

      <div className="lc-tray" data-variant={variant}>
        {variant === "session" && (
          <div className="lc-tray-head">
            {top}
            {/* An agent drawing on a design file of this session's folder: the canvas is a press away. */}
            {thread && !canvas && <WatchCanvas thread={thread} />}
          </div>
        )}
        {canvas && queued}
        <div className="lc-card">
          {files.length > 0 && (
            <div className="lc-files">
              {files.map((f, i) => (
                <span key={`${f.name}${i}`} className="lc-file-chip" data-image={thumbs[i] ? true : undefined}>
                  {thumbs[i] ? <img src={thumbs[i]!} alt="" className="lc-file-thumb" /> : <I.file size={13} />}
                  <span className="lc-file-n" title={f.name}>{f.name}</span>
                  <span>{f.size < 1024 ? `${f.size} B` : `${Math.round(f.size / 1024)} KB`}</span>
                  <button type="button" className="l-focus" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                    <I.close size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {chips && <div className="lc-chips">{chips}</div>}
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
            placeholder={ask ? (ask.mode === "back" ? `Tell ${ask.who} what to do instead` : `Or tell ${ask.who} what to do instead`) : placeholder}
            aria-label="Message"
            onChange={(e) => {
              // The first key into an empty box while an ask is up starts sending it back: what you write is what to do instead.
              if (ask?.mode === "choose" && !text && e.target.value) ask.setMode("back");
              onType(e.target.value, e.target.selectionStart);
              setStashOpen(false);
            }}
            // A list open on a word you've left is no use: it goes when the caret leaves the word, or the field.
            onSelect={(e) => mention && e.currentTarget.selectionEnd !== mention.start + 1 + mention.query.length && setMention(null)}
            onBlur={() => (setStashOpen(false), setMention(null))}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                addFiles(e.clipboardData.files);
                return;
              }
              // A big paste (a log, a file's worth) comes as a text file instead, to keep the message
              // readable; the toast puts it in the message after all if that's what you meant.
              const plain = e.clipboardData.getData("text/plain");
              if (!plain || bytesOf(plain) < PASTE_AS_FILE || files.length >= MAX_FILES) return;
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
              // Enter, Tab, Escape and the arrows belong to the input method while it composes (T3 Code: ComposerPromptEditorTiptap.tsx).
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
              // An ask at the composer takes Enter and Esc as askKey says (ask-text.ts); else they do what they do below.
              if (ask?.onKey(e)) return;
              if (is(e.nativeEvent, "stash")) {
                e.preventDefault();
                stash();
                return;
              }
              // ↑ recalls only when the caret is on the first line, so editing a long draft still moves up.
              // ⌥↑/⌥↓ pass through to the session's prompt navigation.
              if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.altKey && !mention && sent.length && (!text || recall.current >= 0) && !(e.key === "ArrowUp" && !text && queue.length)) {
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
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(busy && (e.metaKey || e.ctrlKey) ? "steer" : busy ? mode : "queue");
              } else if (e.key === "Escape" && busy) {
                // Taken: a session opened from the Wall goes back to it on an Escape nothing here used (App.tsx).
                e.preventDefault();
                onStop?.();
              } else if (e.key === "ArrowUp" && !e.altKey && !text && queue.length) {
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
                <button key={x.at} type="button" role="option" aria-selected={false} className="lc-mention-row l-focus" onMouseDown={(e) => (e.preventDefault(), unstash(i))}>
                  <I.edit size={12} />
                  <span className="lc-mention-d lc-stash-t">{x.text.split("\n")[0]}</span>
                  <span className="lc-quiet">{ago(x.at)}</span>
                </button>
              ))}
            </div>
          )}
          {mention && (found.length > 0 || (mention.kind !== "@" && !tools)) && (
            <div ref={list} className="lc-mention l-glass" role="listbox" aria-label={mention.kind === "@" ? "Files" : mention.kind === "/" ? "Commands" : "Skills"} onMouseDown={(e) => e.preventDefault()}>
              {mention.kind !== "@" && !tools && <span className="l-shimmer lc-mention-wait">Asking the tool for its {mention.kind === "/" ? "commands" : "skills"}</span>}
              {found.map((f, i) => (
                <button key={f.key} type="button" role="option" aria-selected={i === hl} className="lc-mention-row l-focus" data-kind={f.kind} onMouseEnter={() => setHl(i)} onMouseDown={(e) => (e.preventDefault(), pickFile(f))}>
                  {f.kind === "@" ? <I.file size={13} /> : f.kind === "/" ? <span className="lc-mention-k">/</span> : <I.sparkle size={13} />}
                  <span className="lc-mono lc-mention-n">
                    {f.label}
                    {f.hint && <span className="lc-quiet"> {f.hint}</span>}
                  </span>
                  {f.note && <span className="lc-mention-d">{f.note}</span>}
                  {(f.tag || f.liner) && <span className="lc-mp-def">{f.tag ?? "Liner Code"}</span>}
                </button>
              ))}
              {mention.kind !== "@" && tools && found.length === 0 && <span className="lc-quiet lc-mention-wait">No {mention.kind === "/" ? "command" : "skill"} matches that.</span>}
            </div>
          )}
          {/* The controls sit in a tray of their own inside the text box, the same on Home and in a session: attach, then the choices, then Send. */}
          <div className="lc-card-row" ref={tray}>
            {attach}
            <span className="lc-seg">
              <Pop label={`Who works on this: ${whoNow.full}. Change it`} side={variant === "home" ? "bottom" : "top"} width={pairShown ? 620 : 320} keep={variant === "home"} triggerClass="lc-seg-b lc-who" trigger={whoChip}>
                {(close) => <WhoPanel project={project} settings={settings} onSettings={onSettings} compare={compare} onCompare={onCompare} onNewAgent={onNewAgent} close={close} />}
              </Pop>
              {effortPick && <span className="lc-seg-div" aria-hidden />}
              {effortPick}
              {variant === "session" && ctx !== undefined && usage?.contextTokens && usage.contextWindow && (
                <>
                  <span className="lc-seg-div" aria-hidden />
                  <ContextMeter used={usage.contextTokens} max={usage.contextWindow} running={busy} onCompact={canCompact ? compactNow : undefined} limits={planOf} />
                </>
              )}
              {/* The plan's windows join the context ring's pop; with no ring (Home) they keep a meter of their own. */}
              {planOf.length > 0 && !(variant === "session" && ctx !== undefined && usage?.contextTokens && usage.contextWindow) && (
                <>
                  <span className="lc-seg-div" aria-hidden />
                  <LimitMeter tools={planOf} />
                </>
              )}
              <span className="lc-seg-div" aria-hidden />
              {accessPick}
            </span>
            {trayEnd}
            <span className="lc-grow" />
            {editing ? (
              <span className="lc-tray-note">Editing a queued message · Enter saves · Esc leaves it</span>
            ) : (
              variant === "session" && !busy && queue.length > 0 && <span className="lc-tray-note">{plural(queue.length, "message")} waiting</span>
            )}
            {sendButton}
          </div>
          <input ref={clip} type="file" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
        </div>

        {/*
          Home's strip, the tray's foot, holds only how this task runs: where on the left (the branch
          gives way first), the mode at the right edge, both inside the tray. Starting another way is
          the line under the tray.
        */}
        {variant === "home" && (
          <div className="lc-strip">
            {stripStart ?? (<>
            {project.git ? (
              <Pop
                label="Where it runs"
                width={300}
                triggerClass="lc-pb"
                trigger={
                  <>
                    <I.folder size={13} />
                    <span className="lc-strip-cap">{compare.length ? `${compare.length + 1} new worktrees` : inWorktree ? `The ${inWorktree.branch ?? "other"} worktree` : worktree ? "A new worktree" : "This checkout"}</span>
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
                <span className="lc-strip-cap">{os.tilde(project.path)}</span>
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
                    <span className="lc-mono lc-strip-cap">{base ?? project.branch ?? "HEAD"}</span>
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
                  <span className="lc-mono lc-strip-cap">{inWorktree?.branch ?? project.branch}</span>
                </span>
              )
            )}
            </>)}
            <span className="lc-grow" />
            {stripEnd}
          </div>
        )}
      </div>
      {variant === "home" && stripUnder && <div className="lc-strip-under">{stripUnder}</div>}
    </div>
  );
}

/** Two rings overlapping: a pair. */
const PairIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <circle cx="9" cy="12" r="5" />
    <circle cx="15" cy="12" r="5" />
  </svg>
);

/**
  The arrow keys walk a column's rows (Home and End to its ends), as Tab does; from the search
  field only down leaves it. A list that takes the arrows itself (the model list) has used them first.
*/
function rove(e: KeyEvent<HTMLElement>) {
  if (e.defaultPrevented || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  if (e.target instanceof HTMLInputElement && e.key !== "ArrowDown") return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-rove]:not(:disabled)")];
  if (!rows.length) return;
  const i = rows.indexOf(document.activeElement as HTMLElement);
  const to = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : i < 0 ? 0 : (i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
  rows[to]?.focus();
  e.preventDefault();
}

/**
  The tools sit two to a row, so there the arrows move as it looks: left and right along a row, up
  and down a row at a time, and past the grid's top or bottom to the rows round it.
*/
function roveGrid(e: KeyEvent<HTMLElement>, cols = 2) {
  if (e.defaultPrevented || !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const tiles = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-rove]:not(:disabled)")];
  const i = tiles.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const along = e.key === "ArrowLeft" || e.key === "ArrowRight";
  const to = i + (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? cols : -cols);
  const row = (n: number) => Math.floor(n / cols);
  let next: HTMLElement | undefined = along ? (row(to) === row(i) ? tiles[to] : undefined) : tiles[to];
  if (!next && !along) {
    // Down from the row above a last row that's one short lands on its last tile; else out of the grid.
    const all = [...(e.currentTarget.closest(".lc-team-col")?.querySelectorAll<HTMLElement>("[data-rove]:not(:disabled)") ?? [])];
    if (e.key === "ArrowDown" && row(tiles.length - 1) > row(i)) next = tiles[tiles.length - 1];
    else if (e.key === "ArrowDown") next = all[all.indexOf(tiles[tiles.length - 1]) + 1] ?? all[0];
    else next = all[all.indexOf(tiles[0]) - 1] ?? all[all.length - 1];
  }
  if (!next) return;
  next.focus();
  e.preventDefault();
}

type PanelProps = { project: Project; settings: RunSettings; onSettings: (patch: Partial<RunSettings>) => void; compare: string[]; onCompare?: (refs: string[]) => void; onNewAgent?: () => void; close: () => void };

/*
  Who works on this: a search on top; Pair, Best and Fast, each on one line, filled in from what's
  ready (your picks first); then every tool, your agents, and the Demo when it's shown, two to a
  row. It's kept short so it fits the room it opens into without scrolling. Picking Pair shows its
  Lead and Sidekick beside the rows, with what the pair is likely to cost as a place on a bar. Each
  opens in the column's own place: the best few that are ready first, then every model. A choice
  there is this session's own and leaves Settings as they are. A tool's tile opens the model list on that tool.
*/
function WhoPanel({ project, settings, onSettings, compare, onCompare, onNewAgent, close }: PanelProps) {
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const picks = useEngine((s) => s.settings.picks);
  const showDemo = useEngine((s) => s.settings.showDemo === true) && agents.some((a) => a.id === "demo");
  const pair = useMemo(() => castOf(providers, { picks }), [providers, picks]);
  const two = pairReady(pair);
  const way: Way | "demo" = settings.agent === "demo" ? "demo" : wayOf(settings, pair);
  const tools = useMemo(() => toolsOf(providers), [providers]);
  const yours = agents.filter((a) => a.id !== "demo");
  const [query, setQuery] = useState("");
  // What the column shows: the rows (""), a tool's models (its id), or your agents.
  const [view, setView] = useState("");
  // The Pair column: its Lead and Sidekick (""), or one of them being picked, from the short list or (`full`) from every model.
  const [open, setOpen] = useState<"" | "lead" | "side">("");
  const [full, setFull] = useState(false);
  const find = useRef<HTMLInputElement>(null);
  const col = useRef<HTMLDivElement>(null);
  const pairCol = useRef<HTMLDivElement>(null);
  const leadBtn = useRef<HTMLButtonElement>(null);
  const sideBtn = useRef<HTMLButtonElement>(null);
  /** Across the two columns by the arrows: Right from the Pair row to the Lead, Left from Lead or Sidekick back to it. */
  const across = (e: KeyEvent<HTMLElement>) => {
    if (e.defaultPrevented || !(e.target instanceof HTMLButtonElement)) return;
    const to = e.key === "ArrowRight" && e.target.dataset.way === "pair" ? leadBtn.current : e.key === "ArrowLeft" && e.target.classList.contains("lc-who-pick") ? col.current?.querySelector<HTMLElement>("[data-way='pair']") : null;
    if (!to) return;
    e.preventDefault();
    to.focus();
  };
  const label = (ref: string) => modelLabel(ref, providers);
  // A list or a view that goes takes the focus it had back to what opened it, not to the page.
  const refocus = (el: () => HTMLElement | null | undefined) => requestAnimationFrame(() => el()?.focus({ preventScroll: true }));
  const shut = () => (setOpen(""), setFull(false), refocus(() => (open === "side" ? sideBtn : leadBtn).current));
  const pickFrom = (which: "lead" | "side") => (setOpen(which), setFull(false), refocus(() => pairCol.current?.querySelector<HTMLElement>(".lc-who-opt[data-on], .lc-who-opt")));
  /** Back from every model to the short list, on the row that led there. */
  const fewer = () => (setFull(false), refocus(() => pairCol.current?.querySelector<HTMLElement>("[data-all]")));
  const leave = () => (setView(""), refocus(() => col.current?.querySelector<HTMLElement>(`[data-view="${view}"]`) ?? find.current));
  const enter = (id: string) => (setView(id), id === AGENTS_TAB && refocus(() => col.current?.querySelector<HTMLElement>(".lc-who-opt[data-on], .lc-who-opt")));
  /** Escape closes the innermost first: an open Lead or Sidekick list, then a tool's models, and only then the panel (Pop). */
  const escape = (e: KeyEvent<HTMLElement>, out: () => void) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    out();
  };

  // The pair: this session's own when it is one, else the one Pair would start.
  const own = way === "pair";
  const lead = own ? settings.agent : pair ? `@${pair.lead}` : undefined;
  const side = own ? settings.sidekick : pair?.sidekick;
  const leadWho = lead ? agentOf(lead, agents, providers) : undefined;
  const leadName = !lead || !leadWho ? "" : isModelAgent(lead) ? label(lead.slice(1)) : leadWho.name;
  const leadShort = lead && isModelAgent(lead) ? shortName(leadName) : leadName;

  /**
    One model or agent, from the lists: no sidekick, and the panel closes. Shift-click adds a model to
    compare instead: a comparison gives each model the ask alone, so a pair's lead goes on without its sidekick.
  */
  const pickOne = (ref: string, how: { shiftKey: boolean }) => {
    const id = `@${ref}`;
    if (how.shiftKey && onCompare) {
      if (settings.sidekick) onSettings({ sidekick: undefined });
      if (settings.agent === id) return;
      onCompare(compare.includes(id) ? compare.filter((x) => x !== id) : [...compare, id].slice(0, 3));
      return;
    }
    onSettings({ agent: id, sidekick: undefined, model: undefined });
    onCompare?.(compare.filter((x) => x !== id));
    close();
  };
  const pickAgent = (id: string, sidekick?: string) => {
    onSettings({ agent: id, sidekick, model: undefined });
    close();
  };
  const pickWay = (w: "pair" | "best" | "fast") => {
    if (!pair) return;
    // Picking Pair keeps the panel open on its Lead and Sidekick; a pair already picked stays as it is.
    if (w === "pair") return void (way !== "pair" && onSettings({ agent: `@${pair.lead}`, sidekick: pair.sidekick, model: undefined }));
    onSettings({ agent: `@${w === "best" ? pair.lead : pair.sidekick}`, sidekick: undefined, model: undefined });
    close();
  };
  // A pair is two models: the lead's sidekick can't be the lead's own model.
  const leadModel = leadWho?.model;
  const pickLead = (id: string) => {
    if (agentOf(id, agents, providers).model === side) return toast("The lead and its sidekick are two different models", { description: "Pick another sidekick first, or another lead." });
    onSettings({ agent: id, model: undefined });
    shut();
  };
  const pickSide = (ref: string) => {
    if (ref === leadModel) return toast("The lead and its sidekick are two different models", { description: `${leadName} leads: pick another model to work for it.` });
    onSettings({ sidekick: ref });
    shut();
  };

  // `note` is what the row shows beside its name; `say` the fuller words a screen reader gets.
  const rows: { id: "pair" | "best" | "fast"; title: string; icon: ReactNode; note: string; say?: string; marks: MarkKind[]; off: boolean }[] = [
    {
      id: "pair",
      title: "Pair",
      icon: <PairIcon size={14} />,
      note: own || two ? `${leadShort} + ${shortName(label(side!))}` : pair ? "Needs two different models ready" : "No model is ready yet",
      say: own || two ? `${leadShort} leads, ${shortName(label(side!))} works` : undefined,
      marks: own || two ? [markOf(leadModel ?? ""), markOf(side!)] : [],
      off: !two && !own,
    },
    { id: "best", title: "Best", icon: <I.star size={14} />, note: pair ? label(pair.lead) : "No model is ready yet", say: pair ? `${label(pair.lead)} alone` : undefined, marks: pair ? [markOf(pair.lead)] : [], off: !pair },
    { id: "fast", title: "Fast", icon: <I.bolt size={14} />, note: !pair ? "No model is ready yet" : two ? label(pair.sidekick) : "Same model as Best", say: two && pair ? `${label(pair.sidekick)} alone` : !pair ? undefined : "The same model as Best, with one ready", marks: two && pair ? [markOf(pair.sidekick)] : [], off: !two },
  ];
  // The best few ready for each part, your own pick first when it isn't one of them; never the other part's model.
  const leadPick = lead && isModelAgent(lead) ? lead.slice(1) : undefined;
  const fewLead = useMemo(() => [...new Set([...(leadPick ? [leadPick] : []), ...shortlistOf(providers, "frontier", { except: side ? [side] : [] })])].slice(0, 5), [providers, leadPick, side]);
  const fewSide = useMemo(() => [...new Set([...(side ? [side] : []), ...shortlistOf(providers, "quicker", { except: leadModel ? [leadModel] : [] })])].slice(0, 5), [providers, side, leadModel]);
  const scale = costScale(providers, leadModel ? costOf(leadModel) : undefined, side ? costOf(side) : undefined);
  const modelRow = (ref: string, on: boolean, onPick: () => void, cost?: number) => (
    <button key={ref} type="button" className="lc-who-opt l-focus" data-rove data-on={on || undefined} aria-pressed={on} onClick={onPick}>
      <ModelMark kind={markOf(ref)} size={13} />
      <span className="lc-who-opt-t">{label(ref)}</span>
      <span className="lc-who-opt-n">{providerLabel(ref, providers)}</span>
      <CostMini at={cost === undefined ? undefined : scale(cost)} />
    </button>
  );
  const back = (
    <button type="button" className="lc-who-back l-focus" data-rove aria-label="Back to all models" onClick={leave}>
      <I.chevL size={12} />
      All models
    </button>
  );
  const compareLine = onCompare && (
    <p className="lc-who-note lc-who-foot">
      {compare.length ? `Sending to ${compare.length + 1}: each gets its own session and worktree from ${project.branch ?? "main"}. When they finish, compare and keep one.` : settings.sidekick ? "Shift-click more models to give them the same ask, side by side: each works alone, without the sidekick." : "Shift-click more models to give them the same ask, side by side."}
    </p>
  );
  const oneValue = isModelAgent(settings.agent) && !settings.sidekick ? settings.agent.slice(1) : undefined;
  const agentRow = (a: (typeof agents)[number], on: boolean, onPick: () => void) => (
    <button key={a.id} type="button" className="lc-who-opt l-focus" data-rove data-on={on || undefined} aria-pressed={on} onClick={onPick}>
      <Disc agent={a} size={16} />
      <span className="lc-who-opt-t">{a.name}</span>
      <span className="lc-who-opt-n">{label(a.model)}</span>
    </button>
  );

  let main: ReactNode;
  if (view === AGENTS_TAB)
    main = (
      <>
        {back}
        <div className="lc-who-scroll">
          <div className="lc-team-lab">Your agents</div>
          {yours.map((a) => agentRow(a, !settings.sidekick && settings.agent === a.id, () => pickAgent(a.id)))}
          {onNewAgent && (
            <button type="button" className="lc-who-opt l-focus" data-rove onClick={() => (close(), onNewAgent())}>
              <I.plus size={13} />
              <span className="lc-who-opt-t">New agent</span>
            </button>
          )}
        </div>
      </>
    );
  else if (view) {
    // The account a tool is signed in with shows here, beside the way back, now that its tile has room for its name only.
    const account = tools.find((p) => p.id === view)?.account;
    main = (
      <>
        <div className="lc-who-top">
          {back}
          {account && (
            <span className="lc-who-acct" title={account}>
              {account}
            </span>
          )}
        </div>
        <ModelPicker value={oneValue} also={compare.map((c) => c.slice(1))} tab={view} autoFocus height={330} onPick={pickOne} />
        {compareLine}
      </>
    );
  }
  else
    main = (
      <>
        <label className="lc-mp-find lc-who-find">
          <I.search size={13} />
          <input ref={find} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && query && (e.preventDefault(), setQuery(""))} placeholder="Find a model" aria-label="Find a model" spellCheck={false} />
        </label>
        {query.trim() ? (
          <>
            <ModelPicker value={oneValue} also={compare.map((c) => c.slice(1))} query={query} keysFrom={find} height={330} onPick={pickOne} />
            {compareLine}
          </>
        ) : (
          <>
            {rows.map((r) => {
              const on = way === r.id;
              return (
                <button key={r.id} type="button" className="lc-who-row l-focus" data-rove data-way={r.id} data-on={on || undefined} aria-pressed={on} aria-label={`${r.title}, ${r.say ?? r.note}`} disabled={r.off} onClick={() => pickWay(r.id)}>
                  <span className="lc-who-i">{r.icon}</span>
                  <span className="lc-who-row-t">
                    <b>{r.title}</b>
                    <span>{r.note}</span>
                  </span>
                  <span className="lc-way-marks">
                    {r.marks.map((k, i) => (
                      <ModelMark key={`${k}${i}`} kind={k} size={12} />
                    ))}
                  </span>
                  <span className="lc-who-chev">{r.id === "pair" && !r.off && <I.chevR size={13} />}</span>
                </button>
              );
            })}
            {/* The search and the three rows stay put; the tools under them are short enough to fit, and scroll only when the room the panel opened into is very short. */}
            <div className="lc-who-scroll">
              <div className="lc-team-lab">All models</div>
              {tools.length === 0 && <p className="lc-who-note">No tool is signed in yet. Settings › Models connects one.</p>}
              <div className="lc-who-tools" onKeyDown={roveGrid}>
                {tools.map((p) => (
                  <button key={p.id} type="button" className="lc-who-tool l-focus" data-rove data-view={p.id} data-on={(oneValue && oneValue.startsWith(`${p.id}:`)) || undefined} title={p.account ? `${p.label} · ${p.account}` : undefined} aria-label={`${p.label}${p.account ? `, ${p.account}` : ""}: its models`} onClick={() => enter(p.id)}>
                    <span className="lc-who-i">
                      <ModelMark kind={markOf(`${p.id}:`)} size={13} />
                    </span>
                    <span className="lc-who-tool-t">{p.label}</span>
                    <I.chevR size={13} />
                  </button>
                ))}
                {(yours.length > 0 || onNewAgent) && (
                  <button type="button" className="lc-who-tool l-focus" data-rove data-view={AGENTS_TAB} data-on={(!settings.sidekick && yours.some((a) => a.id === settings.agent)) || undefined} onClick={() => enter(AGENTS_TAB)}>
                    <span className="lc-who-i">
                      <I.agents size={13} />
                    </span>
                    <span className="lc-who-tool-t">Your agents</span>
                    <I.chevR size={13} />
                  </button>
                )}
                {showDemo && (
                  <button type="button" className="lc-who-tool l-focus" data-rove data-on={way === "demo" || undefined} aria-pressed={way === "demo"} title="A scripted pair, no account" onClick={() => pickAgent("demo", "demo:demo")}>
                    <span className="lc-who-i">
                      <ModelMark kind="demo" size={13} />
                    </span>
                    <span className="lc-who-tool-t">Demo run</span>
                    <span />
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </>
    );

  return (
    <div className="lc-team lc-who-panel" data-pair={way === "pair" || undefined}>
      <div className="lc-team-cols">
        <div ref={col} className="lc-team-col" role="group" aria-label="Who works on this" onKeyDown={(e) => (rove(e), across(e), view && escape(e, leave))}>
          {main}
        </div>
        {way === "pair" && lead && side && (
          <div ref={pairCol} className="lc-team-col lc-who-pair" data-full={(open && full) || undefined} role="group" aria-label={open === "lead" ? "Lead" : open === "side" ? "Sidekick" : "Pair"} onKeyDown={(e) => (rove(e), across(e), open && escape(e, full ? fewer : shut))}>
            {!open ? (
              <>
                <div className="lc-who-h">Pair</div>
                <p className="lc-who-note lc-who-lede">The lead plans, decides and reviews. The sidekick does the work the lead hands it.</p>
                <div className="lc-who-part">
                  <span>Lead</span>
                  <button ref={leadBtn} type="button" className="lc-who-pick l-focus" data-rove aria-label={`Lead: ${leadName}. Change it`} onClick={() => pickFrom("lead")}>
                    {isModelAgent(lead) ? <ModelMark kind={markOf(leadModel ?? "")} size={12} /> : leadWho && <Disc agent={leadWho} size={16} />}
                    <span>{leadName}</span>
                    <I.chevR size={12} />
                  </button>
                </div>
                <div className="lc-who-part">
                  <span>Sidekick</span>
                  <button ref={sideBtn} type="button" className="lc-who-pick l-focus" data-rove aria-label={`Sidekick: ${label(side)}. Change it`} onClick={() => pickFrom("side")}>
                    <ModelMark kind={markOf(side)} size={12} />
                    <span>{label(side)}</span>
                    <I.chevR size={12} />
                  </button>
                </div>
                {leadModel && <PairCost lead={leadModel} sidekick={side} names={{ lead: leadName, sidekick: label(side) }} />}
              </>
            ) : (
              <>
                {/* In the column's own place, so nothing grows under the buttons and scrolls: the few best ready, then every model. */}
                <button type="button" className="lc-who-back l-focus" data-rove aria-label={full ? `Back to the short list for the ${open === "lead" ? "lead" : "sidekick"}` : "Back to the pair"} onClick={full ? fewer : shut}>
                  <I.chevL size={12} />
                  {full ? (open === "lead" ? "Lead" : "Sidekick") : "Pair"}
                </button>
                {full ? (
                  open === "lead" ? (
                    <ModelPicker
                      value={leadPick}
                      autoFocus
                      height={300}
                      extra={yours.length ? { id: AGENTS_TAB, label: "Your agents", icon: <I.agents size={15} />, open: !isModelAgent(lead), body: yours.map((a) => agentRow(a, settings.agent === a.id, () => pickLead(a.id))) } : undefined}
                      onPick={(ref) => pickLead(`@${ref}`)}
                    />
                  ) : (
                    <ModelPicker value={side} autoFocus height={300} onPick={pickSide} />
                  )
                ) : (
                  <>
                    <div className="lc-team-lab">{open === "lead" ? "Lead" : "Sidekick"}, from what's ready</div>
                    {open === "lead" && !isModelAgent(lead) && leadWho && agentRow(leadWho, true, shut)}
                    {open === "lead" ? fewLead.map((r) => modelRow(r, r === leadPick, () => pickLead(`@${r}`), pairCostOf(r, side)?.total)) : fewSide.map((r) => modelRow(r, r === side, () => pickSide(r), leadModel ? pairCostOf(leadModel, r)?.total : undefined))}
                    <div className="lc-who-sep" />
                    <button type="button" className="lc-who-opt l-focus" data-rove data-all onClick={() => setFull(true)}>
                      <span className="lc-who-opt-t">{open === "lead" && yours.length ? "All models and your agents" : "All models"}</span>
                      <I.chevR size={13} />
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** "Watch on the canvas": while the running turn draws on a design file of this session's folder (face.ts says when). */
function WatchCanvas({ thread }: { thread: Thread }) {
  const items = useItems(thread.id);
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const now = thread.status === "running" ? drawingOf(items) : undefined;
  if (!now) return null;
  return (
    <div className="lc-trow ld-watch" role="status">
      <span className="ld-pd" data-lead aria-hidden />
      <span className="lc-trow-t">
        <b>{agentOf(thread.agent, agents, providers).name}</b> is drawing{now.frame ? ` ${now.frame}` : " on the canvas"}
      </span>
      <span className="lc-grow" />
      <button type="button" className="lc-trow-lk l-focus" onClick={() => setFace("design")}>
        Watch on the canvas
      </button>
    </div>
  );
}

export const Hints = ({ children }: { children?: ReactNode }) => <div className="lc-hints">{children}</div>;

/** Each access level's icon, in the permissions picker and on its chip. */
const ACCESS_ICONS: Record<Access, (p: { size?: number }) => ReactNode> = { read: I.eye, ask: I.lock, edits: I.edit, auto: I.ahead, review: I.shield, full: I.shieldOff };
