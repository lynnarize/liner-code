/*
  The composer. One card, the same on Home, in a session, in Liner Design and in Liner Security: you
  write in it, and under what you write one row: the + on the left, then any start choice that
  differs from its default; on the right who works, the permissions and Send. One purpose, one
  control: a default stays out of sight. Round the card, the tray (Devin's): a tinted holder, on
  Home always, in a session only when its head has a row (files to commit, agents at work). What's
  queued sits above it.

  - The + menu: attach files, the `/`, `$` and `@` lists, then the face's own start choices
    (Home's mode, Liner Design's skills and size), each with its value at the row's end.
  - Who works on this, and how hard: one panel (WhoPanel) with a search over every tool, Fusion
    (a lead with a sidekick it hands work to), a few of the tool's models, all of them, your
    agents, the tool and the effort. Picking Fusion shows who leads and who's its sidekick.
  - Access is Auto, Manual or Reviewer decides, with Full access last.
  - @ finds a file in the project; files come from the + menu, a paste or a drop.
  - While an agent works, Enter queues the message for when the turn ends; ⌘Enter steers the
    running turn instead. Your pick becomes what Enter does. A queued message can be sent now
    (⌘⇧Enter for the first), or edited where it waits.
  - A paste of 32 KiB or more comes as a text file. Drafts outlast a restart.
*/
import { Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as KeyEvent, type ReactNode, type RefObject } from "react";
import type { Access, CommandInfo, SkillInfo, Effort, PairTuning, PairWays, Project, ProviderInfo, QueuedMessage, SessionMode, SidekickClass, Thread } from "@contracts";
import { castOf, costOf, familyOf, frontierClass, listedHere, openCodeHasGo, pairCostOf, picturesOf, shortlistOf, splitModel, waysOf } from "@contracts";
import { toast } from "@liner/components/toast/toast";
import { is } from "./keymap";
import { mirror } from "./mdMirror";
import { isPrompt, onStream, rpc, useEngine, useItemsWhere } from "./engine";
import { Glyph, I, ModelMark, StateMark } from "./icons";
import { tintPaint } from "./brands";
import { ACCESS_LEVELS, accessOf, ago, agentOf, compact, designPart, effortIn, effortsFor, isModelAgent, levelName, keepHandOver, markOf, modelLabel, pairEffortFor, pairReady, plural, providerLabel, shortName, wayOf, whoOf, type AccessLevel, type Way } from "./model";
import { onComposerInsert, toComposer } from "./Find";
import { loadDraftFiles, saveDraftFiles } from "./draftFiles";
import { EffortPart, FindField, ModelPicker, ModelSearch, tabOfRef, usePickerWide, type EffortHook, type OwnCard } from "./Models";
import { PICKER_NARROW, PICKER_WIDE, pickerOut } from "./picker";
import { CostMini, costScale, PairCost } from "./PairCost";
import { SideKeys } from "./TopBar";
import { BackRow, HoverNote, Kbd, MenuFoot, PanelHead, Pop, Row, Sep, SendButton } from "./ui";
import * as os from "./os";
import { drawingOf, setFace } from "./face";
import type { DockAsk } from "./Ask";
import { usePrecheck, type SendHow } from "./Precheck";
import { draftRead, draftSaves, wordRead } from "./kept";
import { commandIconOf, commandsAsk, stashKeyOf, steersHere } from "./composer-rules";

/**
  Who works on a session and how. `agent` is the lead (a model, "@<provider>:<model>", or one of
  your agents); `sidekick`, set, makes it a pair: the model the lead hands work to. `review` is the
  session's own word on the Reviewer, unset following Settings. `tuning` is a pair's own changes to
  how it works (contracts' tuning.ts); unset, or a key left out, is automatic. In a patch, `tuning`
  undefined clears the session's own.
*/
export type RunSettings = { agent: string; sidekick?: string; model?: string; effort: Effort; access: Access; review?: boolean; tuning?: PairTuning };
/** `once`: this message only, on another model of the session's tool (the prompt check's "Use <fast model>", Precheck.tsx). */
export type Outgoing = { text: string; files: { name: string; data: string }[]; mode: "queue" | "steer"; once?: string };

type Props = {
  variant: "home" | "session";
  project: Project;
  thread?: Thread;
  /** Where this box keeps its draft when it has no session: unset is Code's Home. */
  draftKey?: string;
  settings: RunSettings;
  onSettings: (patch: Partial<RunSettings>) => void;
  onSend: (m: Outgoing) => void | Promise<void>;
  onStop?: () => void;
  onNewAgent?: () => void;
  busy?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Home: text a new task starts with (Create your add-on), put in the box and not sent; `at` tells one ask from the next. */
  seed?: { text: string; at: number };
  /** Home: more models given the same ask, to compare and keep one ("@provider:model"). */
  compare?: string[];
  onCompare?: (refs: string[]) => void;
  /** A Home's start choices (Code's mode; Liner Design's skills, size, lean, pictures; the dock's pictures and skills), in the + menu and as chips after it. */
  choices?: PlusChoice[];
  /** Home: the box's text as it changes, so an add-on ask can switch the task's mode. */
  onText?: (text: string) => void;
  /**
    Home: you began a draft by hand (an empty box typed into: true), so the session it starts can open its tool ahead
    (thread.warmNew), or emptied it by hand (false), so that one closes. Only on those changes, never per keystroke.
  */
  onDraft?: (begun: boolean) => void;
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
    the input row before the text. `canvas`: this composer is the canvas's own, so it doesn't offer
    "Watch on the canvas".
  */
  chips?: ReactNode;
  canvas?: boolean;
  /** More rows for the `/` list, first (Liner Design's skills): picking one runs `onPick` and takes the typed `/…` away. */
  slashRows?: SlashRow[];
  /** Home: the mode the session would start in, for the prompt check's split (Precheck.tsx); `checkOff`, no prompt check here (Workshop). */
  mode?: SessionMode;
  checkOff?: boolean;
  /** The access level can't be changed here (a Liner Security scan stays at Read only): the chip shows it with a lock, and this tip says why. */
  accessLock?: string;
  /**
    A side chat's box (SideChat.tsx), beside the session's own: one model answers a quick question, so the who panel
    offers no Fusion and no pair; ⌘⇧Enter steers its queue only while it holds the focus; ⌘S keeps its drafts apart.
  */
  aside?: boolean;
};
export type SlashRow = { name: string; hint?: string; note?: string; tag?: string; onPick: () => void };
/**
  A start choice of a face, kept in the + menu as a row with its value at the end: the row opens
  `body` in the menu's own place (`done` closes the menu). `chip`, when the caller sets it, stands
  after the + in the box's row: a choice that differs from its default, or one to keep in sight.
*/
export type PlusChoice = { key: string; label: string; icon: ReactNode; value?: ReactNode; say?: string; body: (done: () => void) => ReactNode; chip?: ReactNode };

/** A choice after the +, as the box shows one that isn't the default: its icon, its name, and a cross that puts the default back. */
export function ChoiceChip({ icon, label, clear, className }: { icon?: ReactNode; label: ReactNode; clear?: { label: string; onClear: () => void }; className?: string }) {
  return (
    <span className={className ? `lc-plus-chip ${className}` : "lc-plus-chip"}>
      {icon}
      <span className="lc-chip-name">{label}</span>
      {clear && (
        <button type="button" className="l-focus" aria-label={clear.label} title={clear.label} onClick={clear.onClear}>
          <I.close size={12} />
        </button>
      )}
    </span>
  );
}

/**
  A box to write to an agent outside the message box (a line in Changes, an agent at work, a comment
  on the canvas, a picture, an add-on to make): the same field with the same round Send inside it,
  which is Stop while `stop` is given and nothing is written. Enter sends (Shift-Enter is a new line
  in a box of several lines); Escape runs `onEscape`. Nothing goes under it: Send is the one button.
  With `enter="line"` (a box whose Send costs money each press, a paid picture) Enter is a new line and
  only ⌘Enter (Ctrl+Enter off the Mac) sends, so a stray Enter spends nothing.
*/
export function SendBox({ value, onChange, onSend, placeholder, label = "Message", lines, autoFocus, stop, disabled, field, onEscape, className, enter = "send", sendOff }: { value: string; onChange: (v: string) => void; onSend: () => void; placeholder?: string; label?: string; lines?: number; autoFocus?: boolean; stop?: { onStop: () => void; title?: string }; disabled?: boolean; field?: RefObject<HTMLInputElement | HTMLTextAreaElement | null>; onEscape?: () => void; className?: string; enter?: "send" | "line"; sendOff?: boolean }) {
  const ready = Boolean(value.trim()) && !disabled && !sendOff;
  const keys = (e: KeyEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // Enter that picks an input method's word isn't a send (T3 Code: BranchPicker.tsx).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (enter === "line" && e.key === "Enter") {
      if (!(os.macKeys ? e.metaKey : e.ctrlKey)) return;
      e.preventDefault();
      if (ready) onSend();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (ready) onSend();
    } else if (e.key === "Escape" && onEscape) {
      e.preventDefault();
      onEscape();
    }
  };
  // One ref for either field: the caller only focuses it.
  const common = { ref: field as RefObject<never> | undefined, value, autoFocus, placeholder, "aria-label": label, disabled, onKeyDown: keys };
  return (
    <div className={className ? `lc-sbox ${className}` : "lc-sbox"}>
      {lines && lines > 1 ? <textarea {...common} rows={lines} onChange={(e) => onChange(e.target.value)} /> : <input {...common} onChange={(e) => onChange(e.target.value)} />}
      <SendButton ready={ready} disabled={!ready} stop={stop} label="Send" title={enter === "line" ? `Send (${os.mod}Enter)` : "Send (Enter)"} onSend={onSend} />
    </div>
  );
}

type PlusRow = { key: string; label: string; icon: ReactNode; kbd?: string; title?: string; disabled?: boolean; onPick: () => void };
/** The arrow keys walk a menu's buttons (Home and End to its ends), except inside a group that takes them itself (a segmented switch). */
function roveButtons(e: KeyEvent<HTMLElement>) {
  if (e.defaultPrevented || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  if (e.target instanceof HTMLElement && e.target.closest("[role='radiogroup'], [role='tablist'], input, textarea")) return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)")];
  if (!rows.length) return;
  const i = rows.indexOf(document.activeElement as HTMLElement);
  const to = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : i < 0 ? 0 : (i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
  rows[to]?.focus();
  e.preventDefault();
}

/**
  The + menu: what goes in the message (files, a command, a skill, a file of the project), then
  after a rule the face's start choices. A choice opens in the menu's place with a way back on top;
  Escape goes back first, then closes the menu, and focus returns to the row that opened it.
*/
function PlusMenu({ rows, choices, close }: { rows: PlusRow[]; choices: PlusChoice[]; close: () => void }) {
  const [open, setOpen] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const choice = choices.find((c) => c.key === open);
  const focus = (sel: string) => requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true }));
  const back = () => {
    const was = open;
    setOpen("");
    focus(`[data-opens="${was}"]`);
  };
  const go = (key: string) => {
    setOpen(key);
    focus("[data-on], button:not(:disabled):not([data-back])");
  };
  return (
    <div
      ref={box}
      className="lc-plus-menu"
      onKeyDown={(e) => {
        if (e.key === "Escape" && choice && !e.defaultPrevented) {
          e.preventDefault();
          return back();
        }
        roveButtons(e);
      }}
    >
      {choice ? (
        <>
          <BackRow name={choice.label} rove={false} onBack={back} />
          {choice.body(close)}
        </>
      ) : (
        <>
          {/* The app's menu rows (ui.tsx Row): the key that does the same, or a choice's value with its ›, at the right end in grey. */}
          {rows.map((r) => (
            <Row key={r.key} title={r.label} icon={r.icon} note={r.title} end={r.kbd && <Kbd>{r.kbd}</Kbd>} disabled={r.disabled} onPick={() => (close(), r.onPick())} />
          ))}
          {choices.length > 0 && <Sep />}
          {choices.map((c) => (
            <Row key={c.key} title={c.label} icon={c.icon} end={c.value} opens={c.key} label={`${c.label}${c.say ? `: ${c.say}` : ""}. Change it`} onPick={() => go(c.key)} />
          ))}
        </>
      )}
    </div>
  );
}

/*
  What gives way, in order, when the tray's controls don't fit on one line: the queue-or-steer
  note shortens, then keeps only its key; access keeps only its icon, who drops its effort and then
  its name; last, the row wraps. Each is tried until nothing spills, so a long name or a narrow window costs words,
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

/** A command row's icon, by its name (composer-rules.ts commandIconOf). */
function CommandIcon({ name }: { name: string }) {
  const Icon = (I as Record<string, (p: { size?: number }) => ReactNode>)[commandIconOf(name)] ?? I.slash;
  return <Icon size={14} />;
}

type Choice = { key: string; insert: string; label: string; kind: "@" | "/" | "$" | "#"; hint?: string; note?: string; path?: string; tag?: string; pick?: () => void };
const commandCache = new Map<string, Promise<{ commands: CommandInfo[]; skills: SkillInfo[] }>>();
const commandsFor = (projectId: string, agent: string, threadId: string | undefined, aside: boolean) => {
  const { key, ask } = commandsAsk(projectId, agent, threadId, aside);
  if (!commandCache.has(key)) commandCache.set(key, rpc("agent.commands", ask).catch(() => ({ commands: [], skills: [] })));
  return commandCache.get(key)!;
};

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

/** The boxes on screen now, by their draft key (a session's id, "home", "design-home"). */
const shownBoxes = new Set<string>();
/**
  Words put in a box from elsewhere, to send with its own Send (a lean from a site, a brand to start
  with): at the caret of the box when it's on screen, else after its draft, which it finds when it
  opens (a session just made, its dock not drawn yet).
*/
export function seedComposer(key: string, text: string) {
  if (shownBoxes.has(key)) toComposer(key, text);
  else addToDraft(key, text);
}

/** Files waiting to go, by draft: kept in memory, and in IndexedDB so a reload doesn't lose them (draftFiles.ts). */
const draftFiles = new Map<string, File[]>();
/** What a queued message carries while it's dragged to a new place: a type of its own, as text it would drop its id into the message box. */
const QUEUED_DRAG = "application/x-liner-queued";
const MAX_FILES = 10;

/**
  You started writing in a session: its tool opens now, so it's up by the time you send (thread.warm; the engine decides whether
  it can). Once per session until a turn has run there since, or WARM_AGAIN_MS have passed (the engine closes an unused one then).
  Not on opening a session or clicking through them: only a draft you begin by hand.
*/
const warmed = new Map<string, { at: number; turns: number }>();
const WARM_AGAIN_MS = 10 * 60_000;
function warmFor(t: Thread) {
  if (t.status === "running" || t.archived || t.sideOf) return;
  const w = warmed.get(t.id);
  if (w && w.turns === t.turns && Date.now() - w.at < WARM_AGAIN_MS) return;
  warmed.set(t.id, { at: Date.now(), turns: t.turns });
  void rpc("thread.warm", { id: t.id }).catch(() => {});
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
/** The who panel's list of your agents (no tool has this id). */
const AGENTS_TAB = "@agents";
/** The Demo has a row of its own in this panel (Demo run): the model lists in it leave it out, so it's never a lead, a sidekick or a model of its own. */
const notDemo = (p: ProviderInfo) => p.id !== "demo";
/**
  The tools whose models the picker lists: ready, with models to list, the Demo apart (it has a row
  of its own). A tool whose every model is left out (Hermes with only OpenCode Go's, while OpenCode
  has Go: listedHere, judged on `every` tool) isn't one.
*/
const toolsOf = (providers: ProviderInfo[], every: ProviderInfo[] = providers) => {
  const goHere = openCodeHasGo(every);
  return providers.filter((p) => p.available && p.adapter && p.id !== "demo" && p.models.some((m) => listedHere(p.id, m, goHere)));
};

const toBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

export function Composer({ variant, project, thread, draftKey: draftAt, settings, onSettings, onSend, onStop, onNewAgent, busy, placeholder, autoFocus, seed, compare = [], onCompare, choices = [], onText, onDraft, top, chips, canvas, slashRows, ask, mode: sessionMode, checkOff, accessLock, aside = false }: Props) {
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const draftKey = thread?.id ?? draftAt ?? "home";
  const [text, setText] = useState(() => draftOf(draftKey));
  // A queued message being edited: it keeps its place in the queue, and the draft it pushed aside comes back after.
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [files, setFiles] = useState<File[]>(() => draftFiles.get(draftKey) ?? []);
  // Read guarded: a window whose storage throws would otherwise fail here and take the whole session view with it.
  const [mode, setMode] = useState<"queue" | "steer">(() => wordRead(localStorage, "lc:enter", ["queue", "steer"], "queue") as "queue" | "steer");
  const [mention, setMention] = useState<{ start: number; query: string; kind: "@" | "/" | "$" | "#" } | null>(null);
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
  const lev = accessOf(settings.access);
  // Claude Code through another maker's API: its Auto can't run there, so it runs as Edits on its own (engine: claude.ts modeOf).
  const noAuto = model ? providers.find((p) => p.id === splitModel(model).provider)?.supports.auto === false : false;
  const queue = thread?.queue ?? [];
  const usage = thread?.usage;

  const recall = useRef(-1);
  /** A draft is being written by hand here (onDraft): set at its first change, cleared once it's emptied by hand or sent. */
  const drafting = useRef(false);
  // Emptied otherwise (sent, stashed): the next change by hand begins a new draft. A stash lets the draft's session go; a send
  // doesn't, since the send itself takes it (Home's start).
  useEffect(() => {
    if (text.trim() || !drafting.current) return;
    drafting.current = false;
    if (!sending.current) onDraft?.(false);
  }, [text]);
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
  // The key can change under a box that stays (a design's dock gets its session's id): words seeded for the new key are taken
  // into an empty box, caret at their end, and the empty text never goes over them.
  const keyWas = useRef(draftKey);
  useEffect(() => {
    if (keyWas.current === draftKey) return;
    keyWas.current = draftKey;
    const saved = draftOf(draftKey);
    if (text.trim() || editing || !saved) return;
    pendingDraft.current = { key: draftKey, text: saved };
    caretToEnd.current = true;
    setText(saved);
  }, [draftKey]);
  // Quitting doesn't wait for that moment (T3 Code: composerDraftStore.ts).
  useEffect(() => {
    window.addEventListener("beforeunload", flushDraft);
    return () => window.removeEventListener("beforeunload", flushDraft);
  }, []);
  // Hydrate persisted draft attachments from IndexedDB after a window reload.
  useEffect(() => {
    if (draftFiles.has(draftKey)) return void draftRead(draftKey);
    let live = true;
    void loadDraftFiles(draftKey).then((restored) => {
      draftRead(draftKey);
      // Kept in memory even when this box has gone meanwhile, so the next one to open the draft has them.
      if (restored.length && !draftFiles.has(draftKey)) draftFiles.set(draftKey, restored);
      if (!live || !restored.length) return;
      setFiles((cur) => (cur.length ? cur : restored));
    });
    return () => {
      live = false;
    };
  }, [draftKey]);
  useEffect(() => {
    if (files.length) {
      // Newest last, and at most MAX_DRAFTS drafts' files, as the drafts themselves are kept: a session left with files long ago lets them go.
      draftFiles.delete(draftKey);
      draftFiles.set(draftKey, files);
      for (const k of draftFiles.keys()) if (draftFiles.size > MAX_DRAFTS) draftFiles.delete(k);
    } else draftFiles.delete(draftKey);
    if (draftSaves(draftKey, files)) void saveDraftFiles(draftKey, files, MAX_DRAFTS);
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

  // Invalidate cached slash commands when providers refresh or the engine reconnects.
  const connected = useEngine((s) => s.connected);
  const appSettings = useEngine((s) => s.settings);
  const prevConnected = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnected.current) {
      commandCache.clear();
      setTools(null);
    }
    prevConnected.current = connected;
  }, [connected]);
  useEffect(() => {
    commandCache.clear();
    setTools(null);
  }, [providers]);
  // Invalidate slash-command cache immediately when an active ACP session pushes AvailableCommandsUpdate.
  useEffect(
    () =>
      onStream((e) => {
        if (e.type !== "commands") return;
        commandCache.clear();
        setTools(null);
      }),
    [],
  );
  // What / and $ offer: the tool's own commands and skills, asked once per tool, folder and thread (composer-rules.ts commandsAsk). Asked again once the list is let go, so a thread changing under an open / doesn't leave it asking.
  const who = settings.agent;
  useEffect(() => {
    if (mention?.kind !== "/" && mention?.kind !== "$") return;
    if (tools) return;
    let live = true;
    void commandsFor(project.id, who, thread?.id, aside).then((r) => live && setTools(r));
    return () => {
      live = false;
    };
  }, [mention?.kind, project.id, who, thread?.id, aside, !tools]);
  useEffect(() => setTools(null), [project.id, who, thread?.id, aside]);

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
    if (mention.kind === "#") {
      const t = window.setTimeout(
        () =>
          void rpc("git.prs", { projectId: project.id, query: mention.query }).then((prs) => {
            if (!live) return;
            setFound(prs.map((p) => ({ key: `pr-${p.number}`, insert: `#${p.number}`, label: `#${p.number}`, hint: p.branch || undefined, note: p.title, kind: "#" })));
            setHl(0);
          }, () => live && setFound([])),
        100,
      );
      return () => {
        live = false;
        clearTimeout(t);
      };
    }
    if (mention.kind === "@") {
      // Asked once you pause (80 ms), not on every key: the rows found last stay meanwhile. / and $ filter here, at once.
      const t = window.setTimeout(
        () =>
          void rpc("fs.files", { projectId: project.id, threadId: thread?.id, query: mention.query, limit: 8 }).then((r) => {
            if (!live) return;
            setFound(r.map((f) => ({ key: f.path, insert: `@${f.path}`, label: f.path, kind: "@" })));
            setHl(0);
          }, () => live && setFound([])),
        80,
      );
      return () => {
        live = false;
        clearTimeout(t);
      };
    }
    else if (tools || (mention.kind === "/" && slashRows?.length)) {
      const extra = mention.kind === "/" ? (slashRows ?? []).filter((r) => `${r.name} ${r.note ?? ""}`.toLowerCase().includes(q)).map((r): Choice => ({ key: `+${r.name}`, insert: "", label: `/${r.name}`, hint: r.hint, note: r.note, kind: "/", tag: r.tag, pick: r.onPick })) : [];
      const list = !tools ? extra :
        mention.kind === "/"
          ? [...extra, ...tools.commands.filter((c) => `${c.name} ${c.description}`.toLowerCase().includes(q)).sort((a, b) => rank(a.name) - rank(b.name)).map((c): Choice => ({ key: c.name, insert: `/${c.name}`, label: `/${c.name}`, hint: c.hint, note: c.description, kind: "/" }))]
          : tools.skills.filter((x) => `${x.name} ${x.description}`.toLowerCase().includes(q)).sort((a, b) => rank(a.name) - rank(b.name)).map((x): Choice => ({ key: x.name, insert: `$${x.name}`, label: `$${x.name}`, note: x.description, kind: "$", path: x.path }));
      // Every command, the list scrolling past its height as Antigravity's does; skills stay at the first twelve.
      setFound(list.slice(0, mention.kind === "/" ? 80 : 12));
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
    if (thread && !text.trim() && v.trim()) warmFor(thread);
    // Home: the first change by hand to a draft, one begun from empty or one kept from before (a restored draft), and its emptying.
    if (v.trim() && !drafting.current) {
      drafting.current = true;
      onDraft?.(true);
    } else if (!v.trim() && drafting.current) {
      drafting.current = false;
      onDraft?.(false);
    }
    setText(v);
    // Changed by hand, it's yours: ↑ on the first line no longer swaps it for an older message.
    recall.current = -1;
    const before = v.slice(0, caret);
    // A command only at the very start; a file, skill, or #PR anywhere after a space.
    const slash = /^\/([\w:.-]*)$/.exec(before);
    const at = /(^|\s)([@$#])([\w./:-]*)$/.exec(before);
    setMention(slash ? { start: 0, query: slash[1], kind: "/" } : at ? { start: caret - at[3].length - 1, query: at[3], kind: at[2] as "@" | "$" | "#" } : null);
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

  // The prompt check (Precheck.tsx): its row in the tray's head, and its say before a session's message goes.
  const check = usePrecheck({ variant, project, thread, settings, mode: sessionMode, off: Boolean(canvas || checkOff || editing || compare.length || ask), busy, files: files.length, text, send: (how) => void send(mode, how), keep: (t) => setText((cur) => (cur.trim() ? cur : t)) });

  // One send at a time: a second Enter while the files are read, or while the first is on its way, does nothing.
  const sending = useRef(false);
  // The box as it is now, for a send that waited on the check: what is in it after the wait is what goes.
  const box = useRef({ text, files });
  box.current = { text, files };
  const send = async (how = mode, way: SendHow = {}) => {
    if ((!text.trim() && !files.length) || sending.current) return;
    // OpenClaw-style `/steer <message>` forces mid-turn steering without switching the sticky mode.
    const steerCmd = /^\/steer\s+([\s\S]+)$/i.exec(text.trim());
    if (steerCmd) {
      how = "steer";
    }
    // Read by the check first unless one of its own actions sends it; Send pressed while it reads goes past it.
    if (!way.checked && !editing && !(await check.beforeSend())) return;
    // The check can hold the send for seconds: a file attached meanwhile goes with it, and only the files sent leave the box.
    const { text: said, files: sent } = box.current;
    let t = said.trim();
    const steerBody = /^\/steer\s+([\s\S]+)$/i.exec(t);
    if (steerBody) {
      how = "steer";
      t = steerBody[1].trim();
    }
    if ((!t && !sent.length) || sending.current) return;
    // An edited queued message goes back in its place (T3 Code: chat/useQueuedRunEdit.ts). If the
    // turn ended and took it meanwhile, or files came along (a queued message holds only text), it
    // goes as a new message instead.
    const edit = editing;
    if (edit) {
      setEditing(null);
      const still = queue.some((x) => x.id === edit.id);
      if (still && !sent.length) {
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
    const draft = { text: said, files: sent, skills: new Map(skillsUsed.current) };
    let handed = false;
    try {
      // $skill in the text: the tool is told to use it, by name (and where it lives, when known).
      const used = [...skillsUsed.current].filter(([name]) => t.includes(`$${name}`));
      if (used.length) t = `${t}\n\n${used.map(([name, path]) => `Use the ${name} skill${path ? ` (${path})` : ""}.`).join("\n")}`;
      skillsUsed.current.clear();
      const from = document.activeElement;
      const payload: Outgoing = { text: t || "Here are the files.", files: await Promise.all(sent.map(async (f) => ({ name: f.name, data: await toBase64(f) }))), mode: how, ...(way.once ? { once: way.once } : {}) };
      // Reading the files can take a moment: words written in the box meanwhile aren't what was sent, so they stay.
      setText((cur) => (cur === said ? (edit?.draft ?? "") : cur));
      setFiles((cur) => cur.filter((f) => !sent.includes(f)));
      setMention(null);
      check.reset();
      handed = true;
      // The button pressed goes as the turn starts, and the keys would go with it.
      if (variant === "session" && (document.activeElement === from || document.activeElement === document.body)) field.current?.focus();
      // The check's "Start a new session" and split send it somewhere else.
      await (way.to ? way.to(payload, said.trim()) : onSend(payload));
    } catch (e) {
      // The draft comes back to try again, unless you've started a new one. Whoever sent it has said what went wrong.
      setText((cur) => (cur.trim() ? cur : draft.text));
      setFiles((cur) => [...draft.files.filter((f) => !cur.includes(f)), ...cur].slice(0, MAX_FILES));
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
    const hasImages = added.some((f) => f.type.startsWith("image/") || /\.(?:png|jpe?g|gif|webp|avif|bmp)$/i.test(f.name));
    if (hasImages) {
      const ref = (settings.model || (settings.agent.startsWith("@") ? settings.agent.slice(1) : "")).trim();
      if (ref.includes(":")) {
        const { provider, model } = splitModel(ref);
        if (!picturesOf(provider, model, appSettings)) {
          toast("This model is marked text-only", { description: "Attached images may be ignored by this endpoint." });
        }
      }
    }
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
  // The messages whose Send-now is on its way: a held shortcut or a second press must not send one twice.
  const sendingNow = useRef(new Set<string>());
  const sendNow = (q: QueuedMessage) => {
    if (!thread) return;
    if (sendingNow.current.has(q.id)) return;
    const at = queue.findIndex((x) => x.id === q.id);
    if (at < 0) return;
    sendingNow.current.add(q.id);
    // The one being edited goes as it reads now.
    const words = editing?.id === q.id ? text.trim() || q.text : q.text;
    if (editing?.id === q.id) stopEditing();
    const before = queue;
    steered.current = { text: words, at, until: Date.now() + 5000 };
    void rpc("thread.queue", { id: thread.id, queue: queue.filter((x) => x.id !== q.id) })
      .then(() => rpc("thread.send", { id: thread.id, text: words, mode: "steer", ...(q.shown && words === q.text ? { shown: q.shown } : {}) }))
      .catch((e) => {
        sendingNow.current.delete(q.id);
        steered.current = null;
        void rpc("thread.queue", { id: thread.id, queue: before }).catch(() => {});
        toast.error(e instanceof Error ? e.message : String(e));
      });
  };
  useEffect(() => {
    // A send is in flight until its message leaves the queue; once gone, a later press may send it again.
    for (const id of [...sendingNow.current]) if (!queue.some((x) => x.id === id)) sendingNow.current.delete(id);
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
  const root = useRef<HTMLDivElement>(null);
  const live = useRef({ queue, sendNow, keys, aside });
  live.current = { queue, sendNow, keys, aside };
  useEffect(() => {
    if (!thread) return;
    const onKey = (e: KeyboardEvent) => {
      if (!live.current.keys) return;
      // A held key repeats, and each repeat would send the next queued message: only the first press sends.
      if (e.key !== "Enter" || !e.shiftKey || !(e.metaKey || e.ctrlKey) || e.altKey || e.isComposing || e.repeat) return;
      // The side chat's box hears the key too: only one box steers, the one with the focus, else the session's own (composer-rules.ts).
      const at = document.activeElement;
      const focus = at && root.current?.contains(at) ? "mine" : at?.closest(".lc-composer") ? "other" : "none";
      if (!steersHere(focus, live.current.aside)) return;
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

  // Text sent here from elsewhere (a quote, a terminal excerpt, words seeded for a box with no session) lands at the caret.
  useEffect(() => {
    shownBoxes.add(draftKey);
    const off = onComposerInsert(draftKey, (add) => {
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
    return () => {
      off();
      shownBoxes.delete(draftKey);
    };
  }, [draftKey]);

  // ↑ in an empty composer brings back what you sent here, newest first; ↓ comes forward.
  // Only your messages: a reply streaming in doesn't redraw the composer.
  const items = useItemsWhere(thread?.id, isPrompt);
  const sent = items.flatMap((x) => (x.kind === "user" && !x.steer ? [x.text] : []));
  useEffect(() => {
    recall.current = -1;
  }, [thread?.id, sent.length]);

  // ⌘S keeps the draft for later; on an empty composer it brings one back. A side chat keeps its own (composer-rules.ts).
  const stashKey = stashKeyOf(project.id, aside);
  const readStash = (): { text: string; at: number }[] => {
    try {
      return JSON.parse(localStorage.getItem(stashKey) || "[]") as { text: string; at: number }[];
    } catch {
      return [];
    }
  };
  const [stashOpen, setStashOpen] = useState(false);
  const [stashHl, setStashHl] = useState(0);
  const [dragQueueIdx, setDragQueueIdx] = useState<number | null>(null);
  const [overQueueIdx, setOverQueueIdx] = useState<number | null>(null);
  const stash = () => {
    const list = readStash();
    if (text.trim()) {
      try {
        localStorage.setItem(stashKey, JSON.stringify([{ text, at: Date.now() }, ...list].slice(0, 20)));
      } catch {
        return void toast.error("Couldn't stash it: storage is full", { description: "The draft stays in the composer." });
      }
      setText("");
      toast("Stashed the draft", { description: `${os.mod}S on an empty composer brings it back.` });
      return;
    }
    if (list.length === 1) {
      setText(list[0].text);
      try {
        localStorage.setItem(stashKey, "[]");
      } catch {
        // Storage full: it stays stashed too, which loses nothing.
      }
    } else if (list.length > 1) setStashOpen(true);
    else toast("Nothing stashed", { description: `${os.mod}S keeps a draft for later.` });
  };
  const unstash = (i: number) => {
    const list = readStash();
    setText(list[i]?.text ?? "");
    try {
      localStorage.setItem(stashKey, JSON.stringify(list.filter((_, k) => k !== i)));
    } catch {
      // Storage full: it stays stashed too, which loses nothing.
    }
    setStashOpen(false);
    requestAnimationFrame(() => field.current?.focus());
  };

  // Images show as thumbnails before they go.
  const thumbs = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => thumbs.forEach((u) => u && URL.revokeObjectURL(u)), [thumbs]);

  // Who works, as the chip names them: the lead's mark, bare (an agent's glyph, as bare), and "Fusion" for a pair, else
  // the one model or agent; then how hard, in the third ink, when the model takes effort levels (a pair's is its lead's).
  const whoNow = whoOf(settings, agents, providers);
  // The picker gains its side card where the window has room for it, and keeps it as the window is resized.
  const pickerWide = usePickerWide();
  const levels = effortsFor(model, providers);
  const effortShown = effortIn(levels.list, settings.effort, levels.fallback);
  const effortRow = levels.list.find((e) => e.id === effortShown);
  const effortLabel = effortRow && levelName(effortRow.label);
  const whoChip = (
    <>
      {whoNow.agent ? <Glyph glyph={whoNow.agent.glyph} size={14} /> : <ModelMark kind={whoNow.marks[0]} size={14} />}
      <span className="lc-chip-name" title={whoNow.full !== whoNow.name ? whoNow.full : undefined}>
        {settings.sidekick && settings.agent !== "demo" && !whoNow.agent ? "Fusion" : whoNow.name}
      </span>
      {whoNow.agent && settings.sidekick && (
        <span className="lc-way-marks">
          <ModelMark kind={markOf(settings.sidekick)} size={12} />
        </span>
      )}
      {effortLabel && <span className="lc-who-eff">· {effortLabel}</span>}
    </>
  );
  // Permissions as a short list (Claude Code's own): Auto, Manual and Reviewer decides, each a
  // number away while it's open, and Full access last, a row of its own that you enable.
  const LevelIcon = ACCESS_ICONS[settings.access] ?? I.ahead;
  const picks = ACCESS_LEVELS.filter((l) => l.id !== "full");
  const full = ACCESS_LEVELS.find((l) => l.id === "full")!;
  const accessPick = accessLock ? (
    // Held where it is (a scan stays at Read only): a chip that says so, with nothing to open.
    <span className="lc-seg-b lc-access" data-locked="" role="note" title={accessLock} aria-label={`Permissions: ${lev.label}. ${accessLock}`}>
      <I.lock size={16} />
      <span className="lc-ctl-label">{lev.short}</span>
    </span>
  ) : (
    <Pop
      label={`Permissions: ${lev.label}. Change them`}
      side={variant === "home" ? "bottom" : "top"}
      keep={variant === "home"}
      align="end"
      width={340}
      triggerClass="lc-seg-b lc-access"
      trigger={
        <>
          <LevelIcon size={16} />
          <span className="lc-ctl-label">{lev.short}</span>
        </>
      }
    >
      {(close) => <PermissionRows levels={picks} apart={full} value={settings.access} noteOf={(l) => (l.id === "auto" && noAuto ? "With this model Liner Code decides what's routine itself, by simple rules: the safety check Auto relies on only runs on Anthropic's own models." : l.note)} onPick={(access) => (onSettings({ access }), close())} />}
    </Pop>
  );

  const ready = Boolean(text.trim() || files.length);
  /*
    Send has two faces, Send and Stop (ui.tsx, SendButton): while a turn runs it is Stop until you
    write. Editing a queued message, or sending to several models, it stays Send; the row says so in
    words left of who works, and the button's name says what it does.
  */
  const turning = busy && variant === "session";
  const comparing = !editing && !turning && compare.length > 0;
  const sendSay = editing ? "Save it in its place" : comparing ? `Send to ${compare.length + 1} models` : "Send";
  const sendTitle = editing || comparing || !turning ? `${sendSay} (Enter)` : mode === "queue" ? "Send: it waits for this turn to end (Enter)" : "Send: read at the turn's next step (Enter)";
  const sendButton = <SendButton ready={ready} disabled={Boolean(editing) && !ready} stop={turning && !editing ? { title: "Stop (Esc)", onStop: () => (onStop?.(), field.current?.focus()) } : undefined} label={sendSay} title={sendTitle} onSend={() => void send()} />;
  // Primary Queue vs Steer segmented toggle while a turn is active, replacing a hidden-only menu.
  const steerNote = !editing && turning && (
    <span className="lc-seg" role="group" aria-label="Mid-turn delivery">
      <button
        type="button"
        className="lc-seg-b l-focus"
        aria-pressed={mode === "queue"}
        title={`Queue for next turn (Enter) · ${os.mod}Enter steers`}
        onClick={() => setMode("queue")}
      >
        Queue
      </button>
      <button
        type="button"
        className="lc-seg-b l-focus"
        aria-pressed={mode === "steer"}
        title="Steer active turn mid-flight (or type /steer <message>)"
        onClick={() => setMode("steer")}
      >
        Steer
      </button>
    </span>
  );
  /**
    What the + menu's `/`, `$` and `@` rows do: the key typed into the box as if pressed there, its
    list opening. A command only starts a message, so `/` waits for an empty box; `$` and `@` go at
    the end of what's written, after a space.
  */
  const typeKey = (k: "/" | "$" | "@") => {
    const next = k === "/" ? (text.startsWith("/") ? text : "/") : `${text}${text && !/\s$/.test(text) ? " " : ""}${k}`;
    onType(next, next.length);
    requestAnimationFrame(() => {
      const el = field.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
    });
  };
  const slashOff = Boolean(text.trim()) && !text.startsWith("/");
  const plusRows: PlusRow[] = [
    { key: "attach", label: "Attach files…", icon: <I.attach size={16} />, onPick: () => clip.current?.click() },
    { key: "/", label: "Commands", icon: <I.slash size={16} />, kbd: "/", disabled: slashOff, title: slashOff ? "Commands start a message: clear the box first" : undefined, onPick: () => typeKey("/") },
    { key: "$", label: "Skills", icon: <I.notes size={16} />, kbd: "$", onPick: () => typeKey("$") },
    { key: "@", label: "A file in the project", icon: <I.file size={16} />, kbd: "@", onPick: () => typeKey("@") },
  ];
  const plus = (
    <Pop label={`Add: files, commands, skills${choices.length ? `, ${choices.map((c) => c.label.toLowerCase()).join(", ")}` : ""}`} side={variant === "home" ? "bottom" : "top"} keep={variant === "home"} width={272} triggerClass="lc-plus-b" trigger={<I.plus size={16} />}>
      {(close) => <PlusMenu rows={plusRows} choices={choices} close={close} />}
    </Pop>
  );

  // What waits for the next turn. Liner Design's composer (canvas) keeps it inside its tray, over the box, with the tray's grey behind it.
  const queued = queue.length > 0 && (
    <div className="lc-queued">
      <div className="lc-queued-h">Queued for the next turn · {queue.length}</div>
      {queue.map((q, i) => (
        <div
          key={q.id}
          className="lc-queued-row"
          data-editing={editing?.id === q.id || undefined}
          data-over={overQueueIdx === i && dragQueueIdx !== null && dragQueueIdx !== i ? "" : undefined}
          draggable={queue.length > 1}
          onDragStart={(e) => {
            setDragQueueIdx(i);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData(QUEUED_DRAG, q.id);
          }}
          onDragOver={(e) => {
            if (dragQueueIdx === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (overQueueIdx !== i) setOverQueueIdx(i);
          }}
          onDragEnd={() => {
            setDragQueueIdx(null);
            setOverQueueIdx(null);
          }}
          onDrop={(e) => {
            if (dragQueueIdx === null) return;
            e.preventDefault();
            e.stopPropagation();
            if (dragQueueIdx !== i && dragQueueIdx >= 0 && dragQueueIdx < queue.length) {
              const next = [...queue];
              const [moved] = next.splice(dragQueueIdx, 1);
              next.splice(i, 0, moved);
              setQueue(next);
            }
            setDragQueueIdx(null);
            setOverQueueIdx(null);
          }}
        >
          <span className="lc-queued-handle" aria-hidden title={queue.length > 1 ? "Drag to reorder" : undefined}>
            <I.drag size={14} />
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
              <I.chevU size={14} />
            </button>
          )}
          {i < queue.length - 1 && (
            <button type="button" className="lc-ib l-focus" aria-label="Move down" onClick={() => setQueue([...queue.slice(0, i), queue[i + 1], q, ...queue.slice(i + 2)])}>
              <I.chevD size={14} />
            </button>
          )}
          <button type="button" className="lc-ib l-focus" aria-label="Edit" aria-pressed={editing?.id === q.id} title="Edit it in place" onClick={() => (editing?.id === q.id ? stopEditing() : editQueued(q))}>
            <I.edit size={14} />
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
            <I.close size={14} />
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div
      ref={root}
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
          <I.clock size={14} />
          <span className="lc-cold-t">The cache has expired: this message re-reads {compact(usage?.contextTokens ?? 0)} tokens</span>
          {/* The Session card's own words for the same act. */}
          <button type="button" className="lc-cold-go l-focus" onClick={compactNow}>
            Compact now
          </button>
          <button type="button" className="lc-ib l-focus" aria-label="Dismiss" title="Dismiss" onClick={() => setColdSeen(cacheUntil)}>
            <I.close size={14} />
          </button>
        </div>
      )}

      <div className="lc-tray" data-variant={variant}>
        {(variant === "session" || check.row) && (
          <div className="lc-tray-head">
            {top}
            {/* An agent drawing on a design file of this session's folder: the canvas is a press away. */}
            {thread && !canvas && <WatchCanvas thread={thread} />}
            {check.row}
          </div>
        )}
        {canvas && queued}
        <div className="lc-card">
          {files.length > 0 && (
            <div className="lc-files">
              {files.map((f, i) => (
                <span key={`${f.name}${i}`} className="lc-file-chip" data-image={thumbs[i] ? true : undefined}>
                  {thumbs[i] ? <img src={thumbs[i]!} alt="" className="lc-file-thumb" /> : <I.file size={14} />}
                  <span className="lc-file-n" title={f.name}>{f.name}</span>
                  <span>{f.size < 1024 ? `${f.size} B` : `${Math.round(f.size / 1024)} KB`}</span>
                  <button type="button" className="l-focus" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                    <I.close size={12} />
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
              if (stashOpen) {
                const stashed = readStash();
                if (stashed.length) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setStashHl((h) => (h + (e.key === "ArrowDown" ? 1 : stashed.length - 1)) % stashed.length);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    unstash(Math.min(stashHl, stashed.length - 1));
                    return;
                  }
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
              <PanelHead>Stashed drafts</PanelHead>
              {readStash().map((x, i) => (
                <button key={x.at} type="button" role="option" aria-selected={i === stashHl} className="lc-mention-row l-focus" onMouseEnter={() => setStashHl(i)} onMouseDown={(e) => (e.preventDefault(), unstash(i))}>
                  <I.edit size={14} />
                  <span className="lc-mention-d lc-stash-t">{x.text.split("\n")[0]}</span>
                  <span className="lc-quiet">{ago(x.at)}</span>
                </button>
              ))}
            </div>
          )}
          {mention && (found.length > 0 || (mention.kind !== "@" && mention.kind !== "#" && !tools)) && (
            <div ref={list} className="lc-mention l-glass" role="listbox" aria-label={mention.kind === "@" ? "Files" : mention.kind === "#" ? "Pull requests" : mention.kind === "/" ? "Commands" : "Skills"} onMouseDown={(e) => e.preventDefault()}>
              {/* How the list stands is its grey foot line, as a menu's is: still asking, or nothing matching. */}
              {mention.kind !== "@" && mention.kind !== "#" && !tools && (
                <MenuFoot>
                  <span className="l-shimmer">Asking the tool for its {mention.kind === "/" ? "commands" : "skills"}</span>
                </MenuFoot>
              )}
              {found.map((f, i) =>
                f.kind === "/" ? (
                  // A command as Antigravity's list has it: its icon, its name without the slash, what it does in grey; Liner Code's own read as the tools' do, no tag. A row that does something else when picked keeps its tag (a design skill's Load for this design).
                  <button key={f.key} type="button" role="option" aria-selected={i === hl} className="lc-mention-row l-focus" data-kind="/" title={f.hint ? `${f.label} ${f.hint}` : f.label} onMouseEnter={() => setHl(i)} onMouseDown={(e) => (e.preventDefault(), pickFile(f))}>
                    <CommandIcon name={f.label.slice(1)} />
                    <span className="lc-mention-n">{f.label.slice(1)}</span>
                    {f.note && <span className="lc-mention-d">{f.note}</span>}
                    {f.tag && <span className="lc-mp-def">{f.tag}</span>}
                  </button>
                ) : (
                  <button key={f.key} type="button" role="option" aria-selected={i === hl} className="lc-mention-row l-focus" data-kind={f.kind} onMouseEnter={() => setHl(i)} onMouseDown={(e) => (e.preventDefault(), pickFile(f))}>
                    {f.kind === "@" ? <I.file size={14} /> : f.kind === "$" ? <I.notes size={14} /> : f.kind === "#" ? <I.branch size={14} /> : null}
                    <span className="lc-mono lc-mention-n">
                      {f.label}
                      {f.hint && <span className="lc-quiet"> {f.hint}</span>}
                    </span>
                    {f.note && <span className="lc-mention-d">{f.note}</span>}
                    {f.tag && <span className="lc-mp-def">{f.tag}</span>}
                  </button>
                ),
              )}
              {mention.kind !== "@" && tools && found.length === 0 && <MenuFoot>No {mention.kind === "/" ? "command" : "skill"} matches that.</MenuFoot>}
            </div>
          )}
          {/*
            One row under what you write, the same on every face: the + and any choice that differs from its
            default on the left; a note, who works and how hard, the permissions and Send on the right, Send last.
          */}
          <div className="lc-card-row" ref={tray}>
            {plus}
            {choices.map((c) => c.chip && <Fragment key={c.key}>{c.chip}</Fragment>)}
            <span className="lc-grow" />
            {editing ? <span className="lc-tray-note" title="Enter saves it, Esc leaves it as it was">Editing a queued message</span> : comparing && <span className="lc-tray-note">Sending to {compare.length + 1} models</span>}
            {steerNote}
            <span className="lc-seg">
              <Pop label={`Who works on this, and how hard: ${whoNow.full}${effortLabel ? `, ${effortLabel}` : ""}. Change it`} side={variant === "home" ? "bottom" : "top"} align="end" width={pickerWide ? PICKER_WIDE : PICKER_NARROW} out={pickerOut("end", pickerWide)} bare keep={variant === "home"} triggerClass="lc-seg-b lc-who" trigger={whoChip}>
                {(close) => <WhoPanel project={project} settings={settings} onSettings={onSettings} compare={compare} onCompare={onCompare} onNewAgent={onNewAgent} close={close} solo={aside} side={pickerWide ? "card" : "line"} />}
              </Pop>
              {accessPick}
            </span>
            {sendButton}
          </div>
          <input ref={clip} type="file" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
        </div>
      </div>
    </div>
  );
}

/** `solo`: one model answers here (a side chat), so the panel offers no Fusion and nothing that makes a pair. */
type PanelProps = { project: Project; settings: RunSettings; onSettings: (patch: Partial<RunSettings>) => void; compare: string[]; onCompare?: (refs: string[]) => void; onNewAgent?: () => void; close: () => void; solo?: boolean; side: "card" | "line" };

/*
  How a pair works, as six lines a session can change for itself: four follow the sidekick's class
  (tuning.ts, CLASS_WAYS), two belong to the lead (handing over, and its effort, which is the
  session's own effort). Each choice has its one line of what it means to the lead.
*/
type TuneKey = keyof PairTuning;
type HowKey = TuneKey | "effort";
const HOW: { k: TuneKey; name: string; opts: { v: string | number; label: string; note: string }[] }[] = [
  {
    k: "brief",
    name: "Brief",
    opts: [
      { v: "exact", label: "Exact files and functions", note: "Names each file and function and what to leave alone. One task per brief." },
      { v: "scoped", label: "Goal, files and limits", note: "The goal, the files involved and the limits. The sidekick finds the lines." },
      { v: "open", label: "Goal and why", note: "What you want and why. The how is left to the sidekick, and it may push back." },
    ],
  },
  {
    k: "explore",
    name: "Exploration",
    opts: [
      { v: "none", label: "None", note: "The brief names every file. The sidekick does not go looking." },
      { v: "bounded", label: "A few searches", note: "It may run a few searches to find callers, inside the folders the brief names." },
      { v: "open", label: "Open", note: "It reads what it needs to and reports what it found." },
    ],
  },
  {
    k: "review",
    name: "Review",
    opts: [
      { v: "all", label: "Every changed file", note: "The lead reads every file the brief changed before it builds on it." },
      { v: "diff", label: "Diff, trusts its checks", note: "The lead reads the diff. A check the sidekick ran and reported is not run again." },
      { v: "risk", label: "Diff where it matters", note: "The lead reads the parts of the diff that carry risk and skims the rest." },
    ],
  },
  {
    k: "takeBack",
    name: "Take the work back after",
    opts: [
      { v: 1, label: "1 failure", note: "After one failed brief the lead does that piece itself." },
      { v: 2, label: "2 failures", note: "The lead sends one correction. After a second failure it does the piece itself." },
    ],
  },
  {
    k: "handOver",
    name: "Hands over",
    opts: [
      { v: "default", label: "By default", note: "Slow runs, edits across files and repeated changes go to the sidekick unless there is a reason not to." },
      { v: "asked", label: "When asked", note: "The lead keeps the work unless you ask it to use its sidekick." },
    ],
  },
];
const CLASS_TAG: Record<SidekickClass, string> = { small: "Small sidekick", mid: "Mid sidekick", frontier: "Frontier-class sidekick" };
/**
  The pair's ways in one sentence, the lead's short name first: how it briefs, how it reads what
  comes back and when it takes the work back, with a clause when it hands over only when asked.
*/
function howSaid(ways: PairWays, lead: string, side: string) {
  const brief = { exact: "writes exact briefs, one task each", scoped: "gives the goal, the files and the limits", open: "says what it wants and why" }[ways.brief];
  const review = { all: `reads every file ${side} changes`, diff: `reads the diff and trusts ${side}'s checks`, risk: "reads the diff where it matters" }[ways.review];
  const asked = ways.handOver === "asked" ? "hands work over only when you ask, " : "";
  return `${lead} ${asked}${brief}, ${review}, and takes the work back after ${ways.takeBack === 1 ? "one failure" : "two failures"}.`;
}
/** A model by name alone, for a sentence: "Opus 5.5" is Opus, "GPT-6.1 Sol" Sol, "DeepSeek V4.1 Flash" DeepSeek Flash. */
const nameAlone = (label: string) => label.split(" ").filter((w) => !/\d/.test(w)).join(" ") || label;

/*
  Who works on this, and how hard: the model picker (Models.tsx ModelPicker) with the session's own parts. Under Find,
  Fusion: a lead with the sidekick it hands work to, at its end the pair it would start for the rail's tool. At the middle
  card's foot, your agents (also the way to make one); on the rail, the Demo when it's on. The side card says how hard the
  model pointed at works, in the levels its tool lists for it: a press there sets the session's effort, or picks that
  model at that level. For Fusion the card holds the Lead, the Sidekick and how the pair works, each a list in the card's
  own place with its way back, and the lead's effort. A choice here is this session's own and leaves Settings as they are.
*/
function WhoPanel({ project, settings, onSettings, compare, onCompare, onNewAgent, close, solo = false, side: cardSide }: PanelProps) {
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  const picks = useEngine((s) => s.settings.picks);
  const showDemo = useEngine((s) => s.settings.showDemo === true) && agents.some((a) => a.id === "demo");
  const classes = useEngine((s) => s.settings.classes);
  const handOverSet = useEngine((s) => s.settings.handOver);
  const pairEffort = useEngine((s) => s.settings.pairEffort);
  // The model the session runs: its own when it has one (a usage limit moved it, or a named agent's override), else its agent's.
  const runs = settings.model ?? agentOf(settings.agent, agents, providers).model;
  const toolNow = settings.agent === "demo" ? "" : splitModel(runs).provider;
  const tools = useMemo(() => toolsOf(providers), [providers]);
  /** The pair a tool would start: its strongest model leading and its quickest helping; the Demo, or a tool that's gone, casts from them all. */
  const castFor = (tool: string) => {
    const own = providers.filter((p) => p.id === tool);
    return castOf(toolsOf(own, providers).length ? own : providers, { picks, every: providers });
  };
  const pairNow = useMemo(() => castFor(toolNow), [providers, toolNow, picks]);
  const way: Way | "demo" = settings.agent === "demo" ? "demo" : wayOf(settings, pairNow);
  const own = way === "pair";
  /*
    The tool the rail opens on: the one whose list holds the session's model (OpenCode's for one of Go's that Hermes runs),
    so its tick is in sight; else the session's tool, else (a tool that's gone) the first that's ready; the Demo's for the Demo.
  */
  const oneValue = isModelAgent(settings.agent) && !settings.sidekick ? settings.agent.slice(1) : undefined;
  const listedOn = tabOfRef(oneValue ?? runs, providers);
  const startTool = way === "demo" ? "demo" : (tools.find((p) => p.id === listedOn) ?? tools.find((p) => p.id === toolNow) ?? tools[0])?.id;
  const yours = agents.filter((a) => a.id !== "demo");
  /*
    Fusion's card in its own place: its Lead, Sidekick and how it works (""), or one of them being picked (`lead`, `side`,
    a search over every model in `pairQ`), or how the pair works as its lines ("lines"), or one line's choices (its key).
  */
  const [open, setOpen] = useState<"" | "lead" | "side" | "lines" | HowKey>("");
  const [pairQ, setPairQ] = useState("");
  const pairFind = useRef<HTMLInputElement>(null);
  const pairCol = useRef<HTMLDivElement>(null);
  const leadBtn = useRef<HTMLButtonElement>(null);
  const sideBtn = useRef<HTMLButtonElement>(null);
  const howBtn = useRef<HTMLButtonElement>(null);
  const picking = open === "lead" || open === "side";
  const line = open && open !== "lines" && !picking ? open : undefined;
  const label = (ref: string) => modelLabel(ref, providers);
  // A list that goes takes the focus it had back to what opened it, not to the page.
  const refocus = (el: () => HTMLElement | null | undefined) => requestAnimationFrame(() => el()?.focus({ preventScroll: true }));
  const shut = () => (setOpen(""), setPairQ(""), refocus(() => (open === "side" ? sideBtn : open === "lead" ? leadBtn : howBtn).current));
  /** The lines, on the one a list of choices was opened from (`from`), else the first. */
  const toLines = (from?: HowKey) => (setOpen("lines"), refocus(() => pairCol.current?.querySelector<HTMLElement>(from ? `[data-line="${from}"]` : ".lc-how-row")));
  const toLine = (k: HowKey) => (setOpen(k), refocus(() => pairCol.current?.querySelector<HTMLElement>(".lc-how-opt[data-on]") ?? pairCol.current?.querySelector<HTMLElement>(".lc-how-opt")));
  const pickFrom = (which: "lead" | "side") => (setOpen(which), setPairQ(""), refocus(() => pairFind.current));
  /** Escape closes the innermost first: a line's choices, the lines, the Lead or Sidekick list; only then the picker's. */
  const escape = (e: KeyEvent<HTMLElement>, out: () => void) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    out();
  };

  // The pair: this session's own when it is one, else the one Fusion would start.
  const lead = own ? settings.agent : pairNow ? `@${pairNow.lead}` : undefined;
  const side = own ? settings.sidekick : pairNow?.sidekick;
  const leadWho = lead ? agentOf(lead, agents, providers) : undefined;
  const leadName = !lead || !leadWho ? "" : isModelAgent(lead) ? label(lead.slice(1)) : leadWho.name;
  const leadShort = lead && isModelAgent(lead) ? shortName(leadName) : leadName;
  const leadModel = leadWho?.model;

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
  /** Whether the rail's tool's Fusion is this session's own pair. */
  const mineOn = (t: string) => own && (t === toolNow || (leadModel !== undefined && t === tabOfRef(leadModel, providers)));
  /*
    Fusion for the rail's tool: its pair, the panel kept open on it. Another tool's pair is another class: the session's own
    class lines go (its word on handing over stays), and a session that only now becomes a pair gets a pair's effort
    (Settings, Medium unless set, as near as the lead's model takes), or the level pressed on Fusion's card (`effort`).
  */
  const pickFusion = (t: string, effort?: string) => {
    if (solo) return;
    // "" is a pick too: the slider's own level pressed again, back to the tool's default.
    if (mineOn(t)) return effort !== undefined && onSettings({ effort });
    const cast = castFor(t);
    if (!cast || !pairReady(cast)) return;
    const was = Boolean(settings.sidekick);
    onSettings({ agent: `@${cast.lead}`, sidekick: cast.sidekick, model: undefined, tuning: was ? keepHandOver(settings.tuning) : undefined, ...(effort !== undefined ? { effort } : was ? {} : { effort: pairEffortFor(cast.lead, providers, pairEffort) }) });
  };
  const pickLead = (id: string) => {
    if (agentOf(id, agents, providers).model === side) return toast("The lead and its sidekick are two different models", { description: "Pick another sidekick first, or another lead." });
    onSettings({ agent: id, model: undefined });
    shut();
  };
  const pickSide = (ref: string) => {
    if (ref === leadModel) return toast("The lead and its sidekick are two different models", { description: `${leadName} leads: pick another model to work for it.` });
    // Another sidekick is another class: the session's own class lines go with the old one.
    onSettings(ref === side ? { sidekick: ref } : { sidekick: ref, tuning: keepHandOver(settings.tuning) });
    shut();
  };

  /*
    How this pair works: its ways resolved (the sidekick's class, Settings, then this session's own), and what each would
    be left automatic. The lead's effort is the session's effort, in the levels the lead's model takes, and its automatic
    one is a pair's (Settings, Medium unless set) as near as the lead's model takes.
  */
  const leadRuns = own ? (settings.model ?? leadModel) : leadModel;
  const sett = { classes, handOver: handOverSet };
  const ways = leadRuns && side ? waysOf(leadRuns, side, sett, own ? settings.tuning : undefined) : undefined;
  const auto = leadRuns && side ? waysOf(leadRuns, side, sett) : undefined;
  const efforts = leadRuns ? effortsFor(leadRuns, providers) : { list: [], fallback: undefined };
  const effortAuto = leadRuns ? pairEffortFor(leadRuns, providers, pairEffort) : undefined;
  const effortNow = own ? effortIn(efforts.list, settings.effort, efforts.fallback) : effortAuto;
  const effortOwn = own && efforts.list.length > 0 && effortNow !== effortAuto;
  const changed = (own ? (ways?.own.length ?? 0) : 0) + (effortOwn ? 1 : 0);
  const clsWord = ways ? { small: "a small sidekick", mid: "a mid sidekick", frontier: "a frontier-class sidekick" }[ways.cls] : "";
  /** What the automatic choice of a line is marked with. */
  const autoNote = (k: HowKey) => (k === "effort" ? "Automatic in Fusion" : k !== "handOver" ? `Automatic for ${clsWord}` : handOverSet ? "From Settings" : leadRuns && frontierClass(leadRuns.replace(/^@/, "")) ? "Automatic for a frontier-class lead" : "Automatic, said more firmly to this lead");
  const lineLabel = (k: HowKey) => (k === "effort" ? levelName(efforts.list.find((e) => e.id === effortNow)?.label ?? "") : (HOW.find((h) => h.k === k)?.opts.find((o) => o.v === ways?.[k])?.label ?? ""));
  const lineOwn = (k: HowKey) => (k === "effort" ? effortOwn : Boolean(own && ways?.own.includes(k)));
  /** A choice made on a line: kept as the session's own unless it is what automatic is anyway, then back on the lines. */
  const pickLine = (k: HowKey, v: string | number) => {
    if (k === "effort") onSettings({ effort: String(v) });
    else if (auto) {
      const next: Record<string, unknown> = { ...settings.tuning };
      if (v === auto[k]) delete next[k];
      else next[k] = v;
      onSettings({ tuning: Object.keys(next).length ? (next as PairTuning) : undefined });
    }
    toLines(k);
  };
  /** Back to automatic: the session's own lines go, and its effort is a pair's again. */
  const unTune = () => {
    onSettings({ tuning: undefined, ...(effortOwn && effortAuto ? { effort: effortAuto } : {}) });
    refocus(() => pairCol.current?.querySelector<HTMLElement>(".lc-how-row"));
  };

  // The best few ready for each part, your own pick first when it isn't one of them; never the other part's model.
  const leadPick = lead && isModelAgent(lead) ? lead.slice(1) : undefined;
  const fewLead = useMemo(() => [...new Set([...(leadPick ? [leadPick] : []), ...shortlistOf(providers, "frontier", { except: side ? [side] : [] })])].slice(0, 5), [providers, leadPick, side]);
  const fewSide = useMemo(() => [...new Set([...(side ? [side] : []), ...shortlistOf(providers, "quicker", { except: leadModel ? [leadModel] : [] })])].slice(0, 5), [providers, side, leadModel]);
  const scale = costScale(providers, leadModel ? costOf(leadModel) : undefined, side ? costOf(side) : undefined);
  const modelRow = (ref: string, on: boolean, onPick: () => void, cost?: number) => (
    <button key={ref} type="button" className="lc-who-opt l-focus" data-rove data-on={on || undefined} aria-pressed={on} onClick={onPick}>
      <ModelMark kind={markOf(ref)} size={14} />
      <span className="lc-who-opt-t">{label(ref)}</span>
      <span className="lc-who-opt-n">{providerLabel(ref, providers)}</span>
      <CostMini at={cost === undefined ? undefined : scale(cost)} />
      {/* Picked as the models list's row is: a plate and an ink tick at the end. */}
      <span className="lc-who-opt-on" aria-hidden>{on && <I.check size={14} />}</span>
    </button>
  );
  // A shift-click gives more models the same ask, side by side: said on the rows themselves, and while it's so, over the foot.
  const compareHint = onCompare ? (settings.sidekick ? "Shift-click more models to give them the same ask, side by side: each works alone, without the sidekick" : "Shift-click more models to give them the same ask, side by side") : undefined;
  const compareLine = onCompare && compare.length > 0 && <p className="lc-who-note">{`Sending to ${compare.length + 1}: each gets its own session and worktree from ${project.branch ?? "main"}. When they finish, compare and keep one.`}</p>;
  const agentRow = (a: (typeof agents)[number], on: boolean, onPick: () => void) => (
    <button key={a.id} type="button" className="lc-who-opt l-focus" data-rove data-on={on || undefined} aria-pressed={on} onClick={onPick}>
      <Glyph glyph={a.glyph} size={14} />
      <span className="lc-who-opt-t">{a.name}</span>
      <span className="lc-who-opt-n">{label(a.model)}</span>
      <span className="lc-who-opt-on" aria-hidden>{on && <I.check size={14} />}</span>
    </button>
  );

  /** The Fusion row pinned under Find, for the rail's tool `t`: who's in its pair at its end, or why it can't be picked. */
  const fusionRow = (t: string) => {
    const mine = mineOn(t);
    const cast = mine ? null : castFor(t);
    const two = mine || pairReady(cast);
    const note = mine ? `${leadShort} + ${shortName(label(side!))}` : cast && two ? `${shortName(label(cast.lead))} + ${shortName(label(cast.sidekick))}` : cast ? "Needs two different models ready" : "No model is ready yet";
    const say = mine ? `${leadShort} leads, ${shortName(label(side!))} works` : note;
    return (
      <button type="button" className="lc-who-row l-focus" data-rove data-way="pair" data-aim="fusion" data-on={mine || undefined} aria-pressed={mine} disabled={!two} title={two ? "The lead plans, decides and reviews; the sidekick does the work the lead hands it." : note} aria-label={`Fusion, ${say}`} onClick={() => pickFusion(t)}>
        <I.fusion size={14} />
        <span className="lc-who-row-t lc-pk-word">Fusion</span>
        {/* The pair cut with an ellipsis, whole in its tooltip; "Fusion" itself never gives way. */}
        <span className="lc-pk-pair" title={note}>
          {note}
        </span>
        {mine && <I.check size={14} className="lc-who-tick" />}
      </button>
    );
  };

  /** Fusion's card for the rail's tool `t`: the session's own pair, or the one it would start (a press there starts it). */
  const fusionCard = (t: string, inPlace: () => void): OwnCard => {
    const mine = mineOn(t);
    const cast = mine ? null : castFor(t);
    const pLead = mine ? lead : cast ? `@${cast.lead}` : undefined;
    const pSide = mine ? side : cast?.sidekick;
    const pLeadModel = pLead ? agentOf(pLead, agents, providers).model : undefined;
    const pLeadName = !pLead ? "" : isModelAgent(pLead) ? label(pLead.slice(1)) : agentOf(pLead, agents, providers).name;
    const pEfforts = pLeadModel ? effortsFor(pLeadModel, providers) : { list: [], fallback: undefined };
    const pEffortNow = mine ? effortNow : pLeadModel ? pairEffortFor(pLeadModel, providers, pairEffort) : undefined;
    const toolLabel = providers.find((p) => p.id === (pLeadModel ? splitModel(pLeadModel).provider : t))?.label ?? "the tool";
    // A list of the card's opens only on the session's own pair: on another, the press makes it the session's first.
    const openOn = (which: "lead" | "side" | "lines") => {
      if (!mine) pickFusion(t);
      if (which === "lines") toLines();
      else pickFrom(which);
    };
    const level = pEfforts.list.find((e) => e.id === pEffortNow);
    let body: ReactNode;
    if (mine && open === "lines" && ways)
      body = (
        <>
          <BackRow name="Fusion" label="Back to Fusion" onBack={shut} />
          <div className="lc-how-h">
            <span>How Fusion works here</span>
            <span className="lc-how-cls">{CLASS_TAG[ways.cls]}</span>
          </div>
          {[...HOW.map((h) => h.k), ...(efforts.list.length ? (["effort"] as const) : [])].map((k) => (
            <Fragment key={k}>
              {k === "handOver" && <div className="lc-how-sub">The lead</div>}
              <button type="button" className="lc-how-row l-focus" data-rove data-line={k} data-own={lineOwn(k) || undefined} aria-label={`${k === "effort" ? "The lead's effort" : HOW.find((h) => h.k === k)!.name}: ${lineLabel(k)}, ${lineOwn(k) ? "changed for this session" : "automatic"}. Change it`} onClick={() => toLine(k)}>
                <span className="lc-how-k">{k === "effort" ? "The lead's effort" : HOW.find((h) => h.k === k)!.name}</span>
                <span className="lc-how-v">{lineLabel(k)}</span>
                <I.chevR size={12} />
              </button>
            </Fragment>
          ))}
          {changed > 0 && (
            <button type="button" className="lc-how-reset l-focus" data-rove onClick={unTune}>
              Back to automatic
            </button>
          )}
          <p className="lc-who-note">Only this session changes. New sessions keep the class setting.</p>
        </>
      );
    else if (mine && line && ways)
      body = (
        <>
          <BackRow name="How Fusion works here" label="Back to how Fusion works here" onBack={() => toLines(line)} />
          <div className="lc-team-lab">{line === "effort" ? "The lead's effort" : HOW.find((h) => h.k === line)?.name}, for this session</div>
          {/* The lead's effort is the same part as on Fusion's card above it (the slider and the switches), not a list of its own. */}
          {line === "effort" && (
            <>
              <EffortPart list={efforts.list} fallback={efforts.fallback} value={settings.effort} label="The lead's effort" tool={providers.find((p) => leadRuns?.replace(/^@/, "").startsWith(`${p.id}:`))?.label} said={efforts.said} tint={leadRuns ? tintPaint(markOf(leadRuns.replace(/^@/, ""))) : undefined} onPick={(id) => pickLine("effort", id)} />
              {effortAuto && <p className="lc-who-note">{`${autoNote("effort")}: ${levelName(efforts.list.find((e) => e.id === effortAuto)?.label ?? effortAuto)}`}</p>}
            </>
          )}
          {line !== "effort" && (HOW.find((h) => h.k === line)?.opts ?? []).map((o) => {
            const on = o.v === ways[line];
            const isAuto = o.v === auto?.[line];
            return (
              <button key={String(o.v)} type="button" className="lc-how-opt l-focus" data-rove data-on={on || undefined} aria-pressed={on} onClick={() => pickLine(line, o.v)}>
                <b>
                  {o.label}
                  {isAuto && <small>{autoNote(line)}</small>}
                </b>
                {o.note && <span>{o.note}</span>}
              </button>
            );
          })}
          <p className="lc-who-note">Only this session changes. New sessions keep the class setting.</p>
        </>
      );
    else if (mine && picking)
      body = (
        <>
          {/* In the card's own place: a search over every model, else the few best ready, then your agents for a lead. */}
          <BackRow name="Fusion" label="Back to Fusion" onBack={shut} />
          <FindField value={pairQ} onChange={setPairQ} field={pairFind} label={open === "lead" ? "Find a lead" : "Find a sidekick"} />
          {pairQ.trim() ? (
            <ModelSearch query={pairQ} keysFrom={pairFind} only={notDemo} value={open === "lead" ? leadPick : side} height={300} onPick={(ref) => (open === "lead" ? pickLead(`@${ref}`) : pickSide(ref))} />
          ) : (
            <div className="lc-who-scroll">
              <div className="lc-team-lab">{open === "lead" ? "Lead" : "Sidekick"}, from what's ready</div>
              {open === "lead" && lead && !isModelAgent(lead) && leadWho && agentRow(leadWho, true, shut)}
              {open === "lead" ? fewLead.map((r) => modelRow(r, r === leadPick, () => pickLead(`@${r}`), (side ? pairCostOf(r, side)?.total : undefined))) : fewSide.map((r) => modelRow(r, r === side, () => pickSide(r), leadModel ? pairCostOf(leadModel, r)?.total : undefined))}
              {open === "lead" && yours.some((a) => a.id !== lead) && (
                <>
                  <div className="lc-team-lab">Your agents</div>
                  {yours.filter((a) => a.id !== lead).map((a) => agentRow(a, false, () => pickLead(a.id)))}
                </>
              )}
            </div>
          )}
        </>
      );
    else
      body = (
        <>
          <div className="lc-pk-sh">
            <I.fusion size={16} />
            <span>Fusion</span>
          </div>
          <p className="lc-pk-sd">The lead plans, decides and reviews. The sidekick does the work the lead hands it.</p>
          {pLead && pSide ? (
            <>
              <button ref={mine ? leadBtn : undefined} type="button" className="lc-who-row l-focus" data-rove aria-label={`Lead: ${pLeadName}. Change it`} onClick={() => openOn("lead")}>
                <span className="lc-pk-k">Lead</span>
                {isModelAgent(pLead) ? <ModelMark kind={markOf(pLeadModel ?? "")} size={14} /> : <Glyph glyph={agentOf(pLead, agents, providers).glyph} size={14} />}
                <span className="lc-who-row-t">{pLeadName}</span>
                <I.chevR size={14} />
              </button>
              <button ref={mine ? sideBtn : undefined} type="button" className="lc-who-row l-focus" data-rove aria-label={`Sidekick: ${label(pSide)}. Change it`} onClick={() => openOn("side")}>
                <span className="lc-pk-k">Sidekick</span>
                <ModelMark kind={markOf(pSide)} size={14} />
                <span className="lc-who-row-t">{label(pSide)}</span>
                <I.chevR size={14} />
              </button>
              {ways && (
                <HoverNote note={howSaid(ways, isModelAgent(pLead) ? nameAlone(pLeadName) : pLeadName, nameAlone(label(pSide)))}>
                  <button ref={mine ? howBtn : undefined} type="button" className="lc-who-row l-focus" data-rove data-own={changed > 0 || undefined} aria-label={`How Fusion works here: ${CLASS_TAG[ways.cls]}${changed ? `, ${changed} changed for this session` : ""}. Change it for this session`} onClick={() => openOn("lines")}>
                    <span className="lc-who-row-t">How it works</span>
                    <span className="lc-who-row-n">{changed > 0 ? `${CLASS_TAG[ways.cls]} · ${changed} changed` : CLASS_TAG[ways.cls]}</span>
                    <I.chevR size={14} />
                  </button>
                </HoverNote>
              )}
              {pLeadModel && <PairCost lead={pLeadModel} sidekick={pSide} names={{ lead: pLeadName, sidekick: label(pSide) }} />}
            </>
          ) : (
            <p className="lc-who-note">This tool needs two different models ready for a pair.</p>
          )}
          <div className="lc-pk-rule" />
          {/* The session's own pair holds the effort, so its stored word goes in; another tool's card shows the pair's level from Settings, which a press there picks. */}
          <EffortPart list={pEfforts.list} fallback={pEfforts.fallback} value={mine ? settings.effort : pEffortNow} held={mine} label="The lead's effort" tool={toolLabel} said={pEfforts.said} tint={pLeadModel ? tintPaint(markOf(pLeadModel)) : undefined} onPick={(id) => pickFusion(t, id)} />
        </>
      );
    return {
      label: "Fusion",
      body: (
        <div ref={pairCol} className="lc-pk-own" role="group" aria-label={open === "lead" ? "Lead" : open === "side" ? "Sidekick" : open === "lines" ? "How Fusion works here" : "Fusion"} onKeyDown={(e) => open && escape(e, picking ? shut : line ? () => toLines(line) : shut)}>
          {body}
        </div>
      ),
      line: (
        <>
          <I.fusion size={14} />
          <b className="lc-pk-line-t">Fusion</b>
          {pLead && pSide && <span className="lc-pk-price">{`${shortName(pLeadName)} + ${shortName(label(pSide))}`}</span>}
          <button type="button" className="lc-pk-chip l-focus" data-view="card" aria-label={level ? `The lead's effort: ${level.label}. Lead, sidekick and how it works` : "Lead, sidekick and how it works"} onClick={inPlace}>
            {level ? (
              <>
                <span>Effort</span>
                <b>{level.label}</b>
              </>
            ) : (
              <span>How it works</span>
            )}
            <I.chevD size={12} />
          </button>
        </>
      ),
    };
  };

  /*
    How hard a model works, in its tool's levels: the session's model takes the press as its effort; another is picked at that
    level. The stored word goes to every card, unresolved, so "" reads as the tool's own default; only the session's model
    holds it, so on another model's card the level carried over is one a press picks, never takes back.
  */
  const effort: EffortHook = {
    of: () => settings.effort,
    held: (ref) => ref === runs,
    pick: (ref, id) => {
      if (ref === runs) return onSettings({ effort: id });
      onSettings({ agent: `@${ref}`, sidekick: undefined, model: undefined, effort: id });
      onCompare?.(compare.filter((x) => x !== `@${ref}`));
      close();
    },
  };
  const agentsOn = !settings.sidekick && yours.some((a) => a.id === settings.agent);
  return (
    <ModelPicker
      value={oneValue}
      also={compare.map((c) => c.slice(1))}
      only={notDemo}
      startTool={startTool}
      hint={compareHint}
      note={compareLine}
      side={cardSide}
      effort={effort}
      fallback={own ? "fusion" : way === "demo" ? undefined : runs}
      onPick={pickOne}
      onSource={(ref) => onSettings({ agent: `@${ref}`, model: undefined })}
      // A side chat is one model answering a quick question: no Fusion there.
      first={solo ? undefined : fusionRow}
      card={(key, t, inPlace) => (key === "fusion" && !solo ? fusionCard(t, inPlace) : undefined)}
      places={[
        {
          id: AGENTS_TAB,
          label: "Your agents",
          icon: <I.agents size={14} />,
          on: agentsOn,
          note: yours.length === 0 ? "None yet" : undefined,
          body: (
            <>
              {yours.map((a) => agentRow(a, !settings.sidekick && settings.agent === a.id, () => pickAgent(a.id)))}
              {onNewAgent ? (
                <button type="button" className="lc-who-opt l-focus" data-rove onClick={() => (close(), onNewAgent())}>
                  <I.plus size={14} />
                  <span className="lc-who-opt-t">New agent</span>
                </button>
              ) : (
                yours.length === 0 && <p className="lc-who-note">None yet. Settings › Team makes one.</p>
              )}
            </>
          ),
        },
      ]}
      // A scripted Fusion run is a pair, so a side chat leaves it out.
      railExtras={
        showDemo && !solo
          ? [
              {
                id: "demo",
                label: "Demo run",
                mark: "demo",
                title: "A scripted Fusion run, no account",
                body: (
                  <button type="button" className="lc-who-row l-focus" data-rove data-on={way === "demo" || undefined} aria-pressed={way === "demo"} title="A scripted Fusion run, no account" onClick={() => pickAgent("demo", "demo:demo")}>
                    <ModelMark kind="demo" size={14} />
                    <span className="lc-who-row-t">Demo run</span>
                    {way === "demo" && <I.check size={16} className="lc-who-tick" />}
                  </button>
                ),
              },
            ]
          : []
      }
    />
  );
}

/** "Watch on the canvas": while the running turn draws on a design file of this session's folder (face.ts says when). */
function WatchCanvas({ thread }: { thread: Thread }) {
  // Read as a word (the frame's name, "" for none, null when it isn't drawing), so a streamed reply redraws nothing here.
  const running = thread.status === "running";
  const frame = useEngine((s) => {
    const d = running ? drawingOf(s.items[thread.id] ?? []) : undefined;
    return d ? (d.frame ?? "") : null;
  });
  const agents = useEngine((s) => s.agents);
  const providers = useEngine((s) => s.providers);
  if (frame === null) return null;
  return (
    <div className="lc-trow ld-watch" role="status">
      <StateMark state="working" />
      <span className="lc-trow-t">
        <b>{agentOf(thread.agent, agents, providers).name}</b> is drawing{frame ? ` ${frame}` : " on the canvas"}
      </span>
      <span className="lc-grow" />
      <button type="button" className="lc-trow-lk l-focus" onClick={() => setFace("design")}>
        Watch on the canvas
      </button>
    </div>
  );
}

/** Each access level's icon, in the permissions picker and on its chip. */
export const ACCESS_ICONS: Record<Access, (p: { size?: number }) => ReactNode> = { read: I.eye, ask: I.lock, edits: I.edit, auto: I.auto, review: I.shield, full: I.shieldOff };

/**
  Permissions as a short list, Claude Code's own, the same wherever a level is picked (the message
  box, a new agent, Settings): each level with its note, a number away while the list is open, and
  `apart` (Full access) last, a row of its own that you enable. `noteOf` changes a level's note
  where it reads otherwise (Auto on a model that isn't Anthropic's).
*/
export function PermissionRows({ levels, apart, value, noteOf = (l) => l.note, onPick }: { levels: AccessLevel[]; apart?: AccessLevel; value: Access; noteOf?: (l: AccessLevel) => string; onPick: (a: Access) => void }) {
  return (
    <div
      className="lc-perm"
      role="radiogroup"
      aria-label="Permissions"
      onKeyDown={(e) => {
        const l = levels[Number(e.key) - 1];
        if (!l || e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        onPick(l.id);
      }}
    >
      <PanelHead>Permissions</PanelHead>
      {levels.map((l, i) => (
        <button key={l.id} type="button" role="radio" aria-checked={value === l.id} className="lc-perm-r l-focus" onClick={() => onPick(l.id)}>
          <span className="lc-perm-t">
            <b>{l.label}</b>
            <small>{noteOf(l)}</small>
          </span>
          {value === l.id && <I.check size={14} />}
          <kbd className="lc-perm-k">{i + 1}</kbd>
        </button>
      ))}
      {apart && (
        <button type="button" role="radio" aria-checked={value === apart.id} className="lc-perm-r lc-perm-full l-focus" title={apart.note} onClick={() => onPick(apart.id)}>
          <span className="lc-perm-t">
            <b>{apart.label}</b>
          </span>
          {value === apart.id ? <I.check size={14} /> : <span className="lc-perm-on">Enable</span>}
        </button>
      )}
    </div>
  );
}
