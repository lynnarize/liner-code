/*
  Runs turns. For each message it opens (or reuses) the session's provider connection,
  snapshots the project, turns the provider's stream into timeline items, holds approvals,
  questions and plans until you answer, and closes the turn with a checkpoint of what changed.

  A message goes to the session's one writer, its lead (`Thread.agent`): a side chat answers, a
  pull request ask opens the PR card, and everything else is one turn (dispatch). In a pair the
  lead may hand briefs to its sidekick inside that turn, through Liner Code's `sidekick` tool
  (delegate, runBrief); the lead waits on each, so one model writes at a time. When the turn
  changed files and the Reviewer is on, the Reviewer (another maker's model) reads the change and
  may send it back to the lead to fix, a set number of rounds, before it's yours (reviewNow).

  Messages you write while a turn runs wait in the queue and go as one message when it ends; a
  steer reaches the agent at its next step instead. A change whose check the queue went ahead of
  is read with the next check (Thread.reviewSince).
*/
import type { Access, AgentRun, AgentStep, ApprovalGrant, ApprovalWhy, Effort, FileChange, Finding, Item, PlanEntry, PrTestResult, ProviderId, ProviderInfo, Question, QueuedMessage, Risk, ShownChip, UserShown, Settings, GrantKind, Thread, TurnPart, Usage } from "../../contracts/src/index.ts";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { ACCESS_NAMES, agentState, castOf, nearestEffort, rank, emptyUsage, ENDPOINT_TOOL, endpointKey, familyOf, frontierClass, isPair, picturesOf, plainWay, reviewerOf, reviewOn, PR_TEST_TOOL, smallChange, splitModel, VOUCHER } from "../../contracts/src/index.ts";
import { capture, changes, isRepo, PATCH } from "./checkpoints.ts";
import { killTree, run, shellOf, spawn, THREAD_ENV } from "./exec.ts";
import { testCommand, testSummary } from "./prflow.ts";
import { claudeTeam, fixPrompt, parseFindings, parseStep, quickOf, reviewPrompt, stepPrompt } from "./review.ts";
import { antigravity, cursor, grok, hermes, opencode } from "./providers/acp.ts";
import { effortOf } from "./providers/models.ts";
import { accountProvider, addedProvider } from "./providers/added.ts";
import { claude } from "./providers/claude.ts";
import { codex } from "./providers/codex.ts";
import { demo } from "./providers/demo.ts";
import { endpointProvider } from "./providers/endpoint.ts";
import { askEndpoint, PLAIN_SOUL } from "./providers/plain.ts";
import { LINER_WAIT_SEC, ResumeFailed, type ApprovalRequest, type Provider, type ProviderSession, type TurnSink, type ToolUpdate, type WakeTurn } from "./providers/types.ts";
import { attachNote } from "./providers/attachments.ts";
import type { AgentTools } from "./agent-tools.ts";
import { fingerprint, type Addons, type Connection } from "./addons.ts";
import { briefOf } from "./agents.ts";
import { modeNote } from "./creator.ts";
import { designNote, type DesignMark } from "./lean.ts";
import { memoryNote, titleFrom } from "./memory.ts";
import { commandRisk, judge, leavesMac, namesSecret, outwardOf, readsOnly, riskOf, routine, ruleFor, ruleParts, skillOffer } from "./risk.ts";
import { uid, type Store } from "./store.ts";
import { BRIEF_MIN_MS, BRIEF_WIND_MS, briefCap, briefPrompt, isSidekickTool, leadRules, NOBODY, SIDEKICK_MS, sidekickResult, sidekickRules, sidekickTitle, taskOf, type BriefOutcome } from "./sidekick.ts";

export const providers: Record<ProviderId, Provider> = { claude, codex, hermes, opencode, cursor, grok, antigravity, demo };

/**
  Your other accounts, the agents you added and your API endpoints, as tools beside the known
  ones. Run whenever they change. `keys` is the engine's, read when an endpoint's session opens.
*/
export function syncProviders(s: Settings, keys?: Map<string, string>) {
  for (const id of Object.keys(providers) as ProviderId[]) if (id.includes(".")) delete providers[id];
  for (const a of s.accounts ?? []) if (a.provider !== "demo" && providers[a.provider]) providers[`${a.provider}.${a.id}`] = accountProvider(providers[a.provider], a);
  for (const a of s.addedAgents ?? []) providers[`acp.${a.id}`] = addedProvider(a);
  for (const e of s.endpoints ?? []) {
    const tool = ENDPOINT_TOOL[e.protocol];
    if (providers[tool]) providers[`${tool}.${e.id}`] = endpointProvider(providers[tool], e, () => keys?.get(endpointKey(e.id)));
  }
  // A redeemed voucher's model: an endpoint of its own that Settings doesn't list.
  const tool = ENDPOINT_TOOL[VOUCHER.protocol];
  if (s.voucher && providers[tool]) providers[`${tool}.${VOUCHER.id}`] = endpointProvider(providers[tool], VOUCHER, () => keys?.get(endpointKey(VOUCHER.id)));
}

/**
  links: a fingerprint of the connections the session was given, so a change reaches it. kit: which
  of Liner Code's tools and words it was given for its part in a pair (the lead's `sidekick`, or
  none of it), so a session whose sidekick changed is opened again, resuming, by its next turn.
*/
type Live = { session: ProviderSession; provider: ProviderId; key: string; links: string; kit: string };
/** Who a live session is in a thread. */
const liveKeyOf = (threadId: string, agentId: string) => `${threadId}:${agentId}`;
/**
  heard: when its tool last said anything (text, a step, tokens). quiet: the watchdog said so already.
  agentId: who works it. liner: install cards its agent asked for through Liner Code's tools, which
  expire with the turn like the tool's own requests. ends: what waits on the turn (a brief the lead called).
  winding: those briefs' own ends, which the turn waits for once it has stopped them (BRIEF_WIND_MS at most).
*/
type Turn = { abort: AbortController; started: number; session?: ProviderSession; turn: number; heard?: number; quiet?: boolean; agentId?: string; liner?: Set<string>; ends?: Set<() => void>; winding?: Set<Promise<void>>; marker?: string };
/**
  A "don't ask again this session": `rule` a command's rules (ruleParts) or a tool's name (`tool`), `skill` a skill's
  folder in full. `label` is what the card offered and what forgetting it names.
*/
type Grant = { kind: GrantKind; label: string; parts: string[]; tool?: boolean };
/** A sidekick's brief at work in a thread: how to stop it, its session (for a steer), and the row it shows on. */
/** by: who stopped it, when it was stopped: you from its row, the cap, or Liner Code when it tried to send an agent of its own. */
type Brief = { abort: AbortController; row: string; taskId: string; session?: ProviderSession; by?: "row" | "cap" | "agent" | "replaced" };
/** An answer to a request; `scope` is where an add-on goes, from its install card. */
type Answer = { allow: boolean; reason?: string; scope?: "all" | "project"; level?: boolean };
/** How long a turn may say nothing before the watchdog says so: longer while one of its commands runs (a build, the tests). */
export const QUIET_MS = 4 * 60_000;
export const QUIET_STEP_MS = 12 * 60_000;
/** What the agent is told of a message about lines in its change. */
const aboutLines = (a: NonNullable<QueuedMessage["anchor"]>, text: string) => `About ${a.file}:${a.line}${a.endLine && a.endLine !== a.line ? `-${a.endLine}` : ""} in your last change:\n\n${text}`;

/**
  show: put your message on the timeline. prompt: what the agent is sent, when it differs from what shows. note: a line under your message.
  files: your attachments, saved on disk. wake: a turn the tool began by itself, run on the session that began it instead of sending a message.
  part: a turn that carries on yours (a fix the Reviewer sent back), shown as part of it. why: why it went, said when you ask.
  review: false when nothing it changes goes to the Reviewer (a side chat, a goal's turns, a fix, which its round reads).
*/
type TurnOptions = { design?: DesignMark; show?: boolean; /** What the person reads of the message (UserShown), kept on its item only. */ shown?: UserShown; anchor?: { file: string; line: number; endLine?: number }; review?: boolean; prompt?: string; note?: string; files?: string[]; wake?: { session: ProviderSession; w: WakeTurn }; part?: TurnPart; why?: string };
/**
  How a turn ended, from runTurn: done, stopped (by you, or by the spending cap), error, waiting
  (something asks you), limited (out of usage); and whether it left a checkpoint.
*/
export type TurnEnd = { turn: number; status: "done" | "stopped" | "error" | "waiting" | "limited"; changed: boolean };
/** What's sent on your behalf to carry a turn on (after a restart, or when a usage window reopens). */
const CONTINUE = "Continue where you left off.";
/** The notice a turn that carries on after a restart starts with; counted, so a turn that brings the engine down can't loop. */
const CARRIED = "Liner Code stopped while this turn ran, so it carries on where it left off.";
const GAVE_UP = "Liner Code stopped mid-turn again";
/** How many times the Reviewer sends work back before it's yours. */
const ROUNDS = 2;
/** A command that reaches outside this Mac (a push, a merge or a post, a send, a copy to another machine): risk.ts reads it, with why. */
export { leavesMac };
/** How long a tool counts as out of usage when it doesn't say when that ends. */
const LIMIT_UNKNOWN_MS = 3_600_000;
/** How long after a window reopened a session still carries on by itself (T3 Code: UsageLimitRecoveryWorker.ts): one left a week wakes on a stale job. */
const LIMIT_STALE_MS = 24 * 3_600_000;
/** The tools that only edit files in the project, by the name each provider asks with (Claude Code's, Codex's apply_patch, ACP's "edit" kind). */
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit", "apply_patch", "edit"]);
/**
  What Read only forbids of what a tool asks to do, by the ask itself: a command that changes things (one that only reads is
  allowed), a file edit (Claude Code's Edit and Write, Codex's apply_patch, an ACP agent's edit, delete or move), and more access
  for Codex's sandbox. Other asks (a connection's tool, a fetch) aren't the level's to refuse: they still come as a card.
*/
export function readForbids(req: Pick<ApprovalRequest, "tool" | "rule" | "fields">) {
  const command = req.fields.find((f) => f.label === "Command")?.value;
  if (command !== undefined) return !readsOnly(command);
  return EDIT_TOOLS.has(req.tool) || req.rule === "Edit" || ["delete", "move", "execute", "shell", "permissions"].includes(req.tool);
}
/** What the model hears when Read only refused its step outright. */
const READ_REFUSED = (command: boolean) => `This session is Read only, so Liner Code refused this ${command ? "command" : "change"} without asking anyone. Don't try to change files or run commands that change anything; read, and say what you would change instead.`;
type Waiter<T> = { resolve: (v: T) => void; reject: (e: Error) => void };
/** A compaction: a command to the session the tool has, so nothing can go in front of it. */
const COMPACT = /^\/compact\s*$/;
/**
  A /goal or /reviewer that waited in the queue: Liner Code's own commands, which go as they would
  have, not as words to the agent (T3 Code: SteeringCompletion.integration.test.ts promotes a queued goal).
*/
function commandOf(q: Pick<QueuedMessage, "text" | "files" | "anchor">) {
  if (q.files?.length || q.anchor) return null;
  const text = q.text.trim();
  if (/^\/reviewer$/.test(text)) return { reviewer: true as const };
  // Joined with the next message it would be neither: it goes alone, as a turn of its own (below).
  if (/^\/compact$/.test(text)) return { compact: true as const };
  const goal = /^\/goal\s+([\s\S]+)$/.exec(text)?.[1];
  return goal && !/^(stop|clear|off)$/i.test(goal) ? { goal } : null;
}

/**
  How long a one-off read (quiet) may take before it's given up, unless its caller says otherwise. The Reviewer's
  read is the longest there is: a diff of up to 60,000 characters (about 15,000 tokens), and files it opens to
  check it, by a model that may be slow and free. A few minutes covers that; ten leave room for a slow one twice
  over, and still end a read whose model never answers before the session looks stuck for good.
*/
export const READ_MS = 10 * 60_000;
/** How long the Reviewer may take over one read: the longest a quiet read gets. */
export const REVIEW_MS = READ_MS;
/** "10 minutes", "1 minute", "30 seconds". */
export const spanOf = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} minute${Math.round(ms / 60_000) === 1 ? "" : "s"}` : `${Math.max(1, Math.round(ms / 1000))} second${Math.max(1, Math.round(ms / 1000)) === 1 ? "" : "s"}`);
/** A quiet read that ran out of time: its model never answered. */
export class QuietTimeout extends Error {
  readonly ms: number;
  constructor(ms: number) {
    super(`The model didn't answer in ${spanOf(ms)}. Try again in a moment.`);
    this.ms = ms;
  }
}

export class Runtime {
  private live = new Map<string, Live>();
  private turns = new Map<string, Turn>();
  private watchdog: NodeJS.Timeout;
  private approvals = new Map<string, Waiter<Answer>>();
  /** The access level each open card of a tool's was asked at. */
  private cardLevel = new Map<string, Access>();
  private questions = new Map<string, Waiter<Record<string, string> | null>>();
  private proposals = new Map<string, Waiter<{ approve: boolean; note?: string; plan?: string }>>();
  /** "Don't ask again … this session", per thread. */
  private grants = new Map<string, Grant[]>();
  /** "Don't ask again this turn": the turn it was given in, per thread. Cleared as that turn ends, however it ends. */
  private turnGrants = new Map<string, number>();
  /** Notices that describe a setting, said once a session (TurnSink.notice's `once`), per thread. */
  private toldOnce = new Map<string, { setting: string; told: Set<string> }>();
  /** The PR card's test runs, one per thread, and how to stop each. */
  private prTests = new Map<string, Promise<PrTestResult>>();
  private prStops = new Map<string, AbortController>();
  /**
    Work in flight for a thread (a turn, what follows it, a review), counted so it can nest. While
    it lasts, a message waits in the queue rather than starting a second turn beside it, and the
    queue goes when it ends (T3 Code queues behind a blocking run the same way).
  */
  private busy = new Map<string, number>();
  /** Threads you stopped while work was in flight: nothing more starts, and the queue waits for you. */
  private halted = new Set<string>();
  /** Threads whose turn Liner Code stopped, not you: for a lower access level it couldn't hold the turn to (accessChanged), or a tool it no longer runs on (retool). */
  private levelStops = new Set<string>();
  /** Threads whose queue Stop kept for you: an edit of it doesn't send it, your next message does. */
  private kept = new Set<string>();
  /** Threads you sent a message to after Stop, as the stopped turn wound down: that's your next message, and the queue goes when it has. */
  private released = new Set<string>();
  /**
    The design mark of a message sent from Liner Design (thread.send's `design`) that waits in the queue, by the queued message's
    id: it goes with that message when the message becomes a turn, and nowhere else (a command or a removed message drops it).
    Kept in memory only, on purpose: a message still queued when the engine restarts goes without its note, and the agent reads
    the design through design_files and design_selection instead. Accepted for now.
  */
  private queuedDesign = new Map<string, DesignMark>();
  /**
    Queued messages with a line for the person (shown) that the app just took out of a thread's queue, by thread and then
    by id, the last 20 a thread: put back in that thread's queue, they keep it. One that went (Send now, as a steer or a
    message) is forgotten here when it goes, so putting it back after can't bring its line.
  */
  private leftQueue = new Map<string, Map<string, QueuedMessage>>();
  /** Threads a routine is working in right now, with nobody watching. */
  private unattended = new Set<string>();
  private quitting = false;
  /** When each tool that ran out of usage has it again: a limit is the account's, whichever session met it. */
  private limitedUntil = new Map<string, number>();
  /** Keys you added, by provider; handed to the tools that use them, never written to disk. */
  keys = new Map<string, string>();
  /** What's installed, kept up to date by the API, for choosing a Reviewer. */
  providerInfo: ProviderInfo[] = [];
  /** Your add-ons: the connections each session's tool gets beside Liner Code's own server. */
  addons?: Addons;
  /** Puts a session's worktree back when it's gone: the API's, which knows how. */
  worktreeBack?: (threadId: string) => Promise<void>;
  private store: Store;
  private env: NodeJS.ProcessEnv;

  private tools?: AgentTools;
  /** The running totals each open session last reported (Codex reports totals, not each step). */
  private totals = new WeakMap<ProviderSession, Partial<Usage>>();
  /** A turn a tool began by itself while the thread was busy: it runs when the thread is free, before your queue. */
  private wakes = new Map<string, { agentId: string; session: ProviderSession; w: WakeTurn }>();
  /** Work that ended well in a thread, and who did it, told once everything that follows it (a check, a fix) is done too. */
  private finished = new Map<string, string>();
  /** Queued messages that went: an edit of the queue made from a copy from before can't bring them back. */
  private drained = new Set<string>();
  /** Limits already carried on from when their window reopened, by thread and reset time, so each goes once. */
  private reopened = new Set<string>();
  /** The lead's `sidekick` calls its tool showed as rows this turn, by thread, for the briefs to take on (sidekickRow). */
  private sideRows = new Map<string, { id: string; input?: string; taken?: boolean }[]>();
  /** The brief a sidekick works now, by thread. */
  private briefs = new Map<string, Brief>();
  /** The briefs of a thread in line, one after another: the last one's end. */
  private briefLine = new Map<string, Promise<void>>();
  /** Every brief from its call to its end, waiting in line or at work, by its row's taskId: Stop on a waiting one's row cancels it alone. */
  private lined = new Map<string, { threadId: string; stop: AbortController }>();
  /** How long one brief may run (SIDEKICK_MS), here so a test can shorten it. */
  sidekickMs = SIDEKICK_MS;
  /** The least time a brief is started with (BRIEF_MIN_MS), here so a test can shorten it. */
  briefMinMs = BRIEF_MIN_MS;
  /** How long a lead's tool waits on a call to Liner Code's tools unless it says less (LINER_WAIT_SEC), here so a test can shorten it. */
  linerWaitMs = LINER_WAIT_SEC * 1000;
  /** How long a turn waits for the briefs it stopped to wind down (BRIEF_WIND_MS), here so a test can shorten it. */
  briefWindMs = BRIEF_WIND_MS;
  /** How long the Reviewer may take over one read (REVIEW_MS), here so a test can shorten it. */
  reviewMs = REVIEW_MS;

  constructor(store: Store, env: NodeJS.ProcessEnv, tools?: AgentTools) {
    this.store = store;
    this.env = env;
    this.tools = tools;
    // A queue found on starting up is held, as one Stop kept: a thread that doesn't carry on doesn't send it on an edit.
    for (const t of store.threads) if (t.queue?.length) this.kept.add(t.id);
    if (tools) tools.turnOf = (threadId) => this.turns.get(threadId)?.turn ?? this.store.thread(threadId).turns;
    this.watchdog = setInterval(() => {
      this.watchQuiet();
      this.resumeLimited();
    }, 30_000);
    this.watchdog.unref?.();
    if (tools)
      tools.cwdOf = (threadId) => {
        const t = this.store.threads.find((x) => x.id === threadId);
        return t ? (t.worktree?.path ?? this.store.project(t.projectId).path) : null;
      };
  }

  isRunning(threadId: string) {
    return this.turns.has(threadId) || this.busy.has(threadId);
  }

  /** A routine's work step in this thread, from start to end: it runs with nobody watching. */
  async unattendedTurn<T>(threadId: string, work: () => Promise<T>) {
    this.unattended.add(threadId);
    try {
      return await work();
    } finally {
      this.unattended.delete(threadId);
    }
  }

  /** Holds a thread while `work` runs; when the last hold ends, what you queued meanwhile goes. */
  private async hold<T>(threadId: string, work: () => Promise<T>): Promise<T> {
    const n = this.busy.get(threadId) ?? 0;
    // A new piece of work after a stop starts afresh.
    if (!n) {
      this.halted.delete(threadId);
      this.kept.delete(threadId);
      this.released.delete(threadId);
    }
    this.busy.set(threadId, n + 1);
    try {
      return await work();
    } finally {
      const left = (this.busy.get(threadId) ?? 1) - 1;
      if (left > 0) this.busy.set(threadId, left);
      else {
        this.busy.delete(threadId);
        this.tellDone(threadId);
        if (!this.halted.delete(threadId)) this.drain(threadId);
        // You pressed Stop: a turn the tool began by itself meanwhile stops too, like the rest of the work.
        // What you sent after it releases the queue (T3 Code: SteeringCompletion.integration.test.ts, a plain send behind the stopped queue).
        else {
          this.dropWake(threadId);
          if (this.released.delete(threadId)) this.drain(threadId);
          else this.kept.add(threadId);
        }
      }
    }
  }

  /**
    Work that rewrites a thread or takes it away (a rewind, an undo, a delete), held from start to end
    (T3 Code: CheckpointRollbackService.ts, under threadCommands.withLock). As after Stop, no turn,
    review or wake starts meanwhile. A message sent meanwhile waits in the queue and goes when this
    ends; a queue that was here already stays held for your next message.
  */
  exclusive<T>(threadId: string, work: () => Promise<T>): Promise<T> {
    return this.hold(threadId, () => {
      this.halted.add(threadId);
      return work();
    });
  }

  /** "Done", once for all the work a message set off, when it ended done (not waiting on you, stopped or failed). */
  private tellDone(threadId: string) {
    const who = this.finished.get(threadId);
    this.finished.delete(threadId);
    const t = this.store.threads.find((x) => x.id === threadId);
    if (who && t && t.status === "done" && !this.halted.has(threadId)) this.store.emit({ type: "notify", threadId, kind: "done", title: `${who} is done`, body: t.title });
  }

  /** What you wrote while it worked goes next, as one message, unless something waits on you. */
  private drain(threadId: string) {
    // A turn the tool began by itself goes first: it happened before what you queued.
    const waking = this.wakes.get(threadId);
    this.wakes.delete(threadId);
    if (waking?.w.pending()) {
      void this.hold(threadId, () => this.wakeNow(threadId, waking)).catch(() => {});
      return;
    }
    const t = this.store.threads.find((x) => x.id === threadId);
    const queued = t?.queue ?? [];
    if (!t || !queued.length || t.status === "limited" || t.archived) return;
    if (this.store.timeline(threadId).some((x) => x.turn > (t.sideFrom ?? 0) && (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking")) return;
    // A command goes on its own, in its place: what came before it first, what came after once it's done.
    const at = queued.findIndex((q) => commandOf(q));
    const going = at > 0 ? queued.slice(0, at) : at === 0 ? queued.slice(0, 1) : queued;
    this.store.patchThread(threadId, { queue: queued.slice(going.length) });
    for (const q of going) this.drained.add(q.id);
    // The newest design mark among what goes: it rides with them only if they become a turn (a command drops it).
    const design = going.map((q) => this.queuedDesign.get(q.id)).filter(Boolean).at(-1);
    for (const q of going) this.queuedDesign.delete(q.id);
    const command = at === 0 ? commandOf(queued[0]) : null;
    if (command && !command.compact) {
      void (command.goal ? this.startGoal(threadId, command.goal) : this.review(threadId, t.turns, 1)).catch(() => {});
      return;
    }
    const files = going.flatMap((q) => q.files ?? []);
    // On its own it goes as it would have; joined with others, a message about lines says so in words.
    const only = going.length === 1 ? going[0] : undefined;
    const text = only ? only.text : going.map((q) => (q.anchor ? aboutLines(q.anchor, q.text) : q.text)).join("\n\n");
    // What the person reads goes with a message that goes on its own; joined with others, the words are what was said.
    void this.send(threadId, text, "queue", only?.anchor, files.length ? files : undefined, design, only?.shown).catch(() => {});
  }

  private enqueue(threadId: string, text: string, files?: string[], anchor?: TurnOptions["anchor"], design?: DesignMark, shown?: UserShown) {
    const t = this.store.thread(threadId);
    const id = uid("q");
    if (design) this.queuedDesign.set(id, design);
    this.store.patchThread(threadId, { queue: [...(t.queue ?? []), { id, text, at: Date.now(), ...(files?.length ? { files } : {}), ...(anchor ? { anchor } : {}), ...(shown ? { shown } : {}) }] });
  }

  /** A message that didn't start waits in the queue, where you can edit, send or drop it, like one Stop kept. */
  keepQueued(threadId: string, text: string, files?: string[], anchor?: TurnOptions["anchor"], shown?: UserShown) {
    this.enqueue(threadId, text, files, anchor, undefined, shown);
    this.kept.add(threadId);
  }

  /**
    You edited, reordered or took out queued messages. The list comes from the app's copy, which may be
    from before the queue went: what already went stays gone, and what's left goes now if nothing runs
    (T3 Code: useQueuedRunEdit.ts edits one queued message by its id instead of the whole list).
  */
  setQueue(threadId: string, queue: QueuedMessage[]) {
    // What the person reads of a queued message is only ever the engine's own, kept with the text it was stored with: the
    // app's copy can't bring one in, and a text changed in the app is the person's own words now, so its line goes.
    const was = new Map((this.store.thread(threadId).queue ?? []).map((q) => [q.id, q]));
    // One the app took out and puts back (a Send now that failed): its line comes back from what the engine kept of it.
    const left = this.leftQueue.get(threadId) ?? new Map<string, QueuedMessage>();
    for (const [id, q] of left) if (!was.has(id)) was.set(id, q);
    const t = this.store.patchThread(threadId, {
      queue: queue
        .filter((q) => !this.drained.has(q.id))
        .map(({ shown: _, ...q }) => {
          const old = was.get(q.id);
          return { ...q, ...(old?.shown && old.text === q.text ? { shown: old.shown } : {}) };
        }),
    });
    // What this edit took out, kept a short while for a put-back; what is in the queue again is no longer "taken out".
    const now = new Set((t.queue ?? []).map((q) => q.id));
    for (const id of now) left.delete(id);
    for (const [id, q] of was) if (!now.has(id) && q.shown && !this.drained.has(id)) left.set(id, q);
    while (left.size > 20) left.delete(left.keys().next().value!);
    if (left.size) this.leftQueue.set(threadId, left);
    else this.leftQueue.delete(threadId);
    // One Stop kept for you waits on, edited: taking a message out of it doesn't send the rest.
    if (t.queue?.length && !this.isRunning(threadId) && !this.kept.has(threadId)) this.drain(threadId);
    return this.store.thread(threadId);
  }

  /**
    The tool began a turn by itself (T3 Code: ClaudeAdapterV2.ts, its wake turns): it runs as a turn
    of its own, now if the thread is free, else when the work in flight ends. After you pressed Stop
    it stops too, unseen, as your queue waits.
  */
  private wake(threadId: string, agentId: string, w: WakeTurn) {
    const session = this.live.get(liveKeyOf(threadId, agentId))?.session;
    const t = this.store.threads.find((x) => x.id === threadId);
    if (!session || !t || t.archived || this.halted.has(threadId)) return w.cancel();
    if (this.isRunning(threadId)) {
      this.wakes.get(threadId)?.w.cancel();
      this.wakes.set(threadId, { agentId, session, w });
      return;
    }
    void this.hold(threadId, () => this.wakeNow(threadId, { agentId, session, w })).catch(() => {});
  }
  private async wakeNow(threadId: string, k: { agentId: string; session: ProviderSession; w: WakeTurn }) {
    if (!k.w.pending() || this.halted.has(threadId)) return;
    const name = this.resolve(this.store.thread(threadId), k.agentId).agent.name;
    await this.turnNow(threadId, "", k.agentId, { show: false, review: false, wake: { session: k.session, w: k.w }, note: `${name} carries on by itself${k.w.why ? `: ${k.w.why}` : ", with no message from you"}.` });
  }
  private dropWake(threadId: string) {
    this.wakes.get(threadId)?.w.cancel();
    this.wakes.delete(threadId);
  }

  /** Said when a turn runs at another effort than the one picked: the model doesn't take it, and this is the nearest it has. */
  private effortNote(t: Thread, agentId = t.agent) {
    const r = this.resolve(t, agentId);
    const asked = (agentId === t.agent ? t.effort : undefined) ?? this.store.agent(agentId).effort;
    if (!asked || r.effort === asked) return "";
    const word = (id: string) => effortOf(id).label;
    return `${this.labelOf(`${r.provider}:${r.model}`)} has no ${word(asked)} effort, so this turn runs at ${word(r.effort)}, the nearest it has.`;
  }

  /** What an agent runs on in a thread: the thread's own model if set, else the agent's. */
  resolve(t: Thread, agentId = t.agent) {
    const agent = this.store.agent(agentId);
    const own = agentId === t.agent ? t.model : undefined;
    const { provider, model } = splitModel(own ?? agent.model);
    const asked: Effort = (agentId === t.agent ? t.effort : undefined) ?? agent.effort;
    // A level this model doesn't take (picked for another model) becomes the nearest it has (the turn says so, effortNote).
    const info = this.providerInfo.find((p) => p.id === provider)?.models.find((m) => m.id === model);
    const effort = info?.efforts?.length ? nearestEffort(asked, info.efforts, info.defaultEffort) : asked;
    // A bare model goes by its label ("Sonnet 5.5"), in what the timeline and notifications say.
    const named = agent.id.startsWith("@") || !this.store.agents.some((a) => a.id === agent.id) ? { ...agent, name: this.labelOf(`${provider}:${model}`) } : agent;
    return { agent: named, provider, model, effort, access: t.access };
  }

  /** What the open session says about itself for the Session surface: what fills its context. */
  async inspect(threadId: string) {
    const t = this.store.thread(threadId);
    const session = this.live.get(`${t.id}:${t.agent}`)?.session;
    const context = (await session?.context?.().catch(() => null)) ?? null;
    return { ...this.resolve(t), live: Boolean(session), context };
  }

  envFor(provider: ProviderId) {
    const env = { ...this.env };
    if (provider === "claude" && this.store.settings.claudeBilling === "key" && this.keys.get("anthropic")) env.ANTHROPIC_API_KEY = this.keys.get("anthropic");
    if (provider === "codex" && this.keys.get("openai")) env.OPENAI_API_KEY = this.keys.get("openai");
    return env;
  }

  /**
    The provider session for an agent in a thread. `fresh`: it starts a conversation of its own, knowing nothing yet.
    `sidekick`: it's the pair's sidekick (agentId "@<its ref>"), in a session of its own even when it's the lead's model too.
  */
  private async session(t: Thread, agentId: string, cwd: string, sidekick = false): Promise<{ session: ProviderSession; fresh: boolean; switched: boolean }> {
    // A sidekick is its bare model, never the thread's own settings, which are the lead's.
    const r = sidekick ? this.resolve({ ...t, agent: "" }, agentId) : this.resolve(t, agentId);
    const access: Access = r.access;
    // A Claude Code writer (an agent or a bare model) brings its subagents. A side chat or a sidekick brings none.
    const team = familyOf(r.provider) === "claude" && !t.sideOf && !sidekick ? claudeTeam(r.agent, r.model) : { model: r.model, agents: {} };
    const liveKey = sidekick ? `${liveKeyOf(t.id, agentId)}#sidekick` : liveKeyOf(t.id, agentId);
    const key = `${r.provider}|${team.model}|${r.effort}|${access}|${Object.keys(team.agents).join(",")}`;
    const connections = this.connectionsOf(t);
    const links = fingerprint(connections);
    // The lead of a pair gets the sidekick tool and its words; the sidekick gets its own words and no such tool.
    const pair = !sidekick && agentId === t.agent && this.pairOf(t);
    // An endpoint's model that takes pictures or not is declared to OpenCode when it opens: a change in Settings reopens it (resuming).
    const kit = `${sidekick ? "sidekick" : pair ? `pair:${t.sidekick}` : ""}${picturesOf(r.provider, r.model, this.store.settings) ? "" : "|text"}`;
    // A session of this thread's still being ended (another tool took over, it broke): nothing of it opens beside that.
    await this.closing.get(t.id);
    let cur = this.live.get(liveKey);
    // Each session this one replaces ends by the one close (ending), checked gone before the new one starts.
    if (cur && cur.kit !== kit) {
      this.live.delete(liveKey);
      await this.ending(t.id, [cur.session]);
      cur = undefined;
    }
    // Connections changed since it opened: taken in place where the tool can, else it reopens below and resumes.
    if (cur && cur.links !== links) {
      if (await cur.session.connect?.(connections).catch(() => false)) cur.links = links;
      else {
        this.live.delete(liveKey);
        await this.ending(t.id, [cur.session]);
        cur = undefined;
      }
    }
    if (cur && cur.key === key) return { session: cur.session, fresh: false, switched: false };
    if (cur && cur.provider === r.provider && cur.session.update) {
      // Same provider, new settings: change them in place where the provider can.
      // One the tool refuses (auto mode isn't on this account) reopens below with the new settings, instead of failing your turn.
      if (await cur.session.update({ model: team.model, effort: r.effort, access }).catch(() => false)) {
        // What it couldn't apply yet stays out of the key, so the next turn asks again.
        if (!cur.session.owes?.()) cur.key = key;
        return { session: cur.session, fresh: false, switched: false };
      }
    }
    if (cur) {
      this.live.delete(liveKey);
      await this.ending(t.id, [cur.session]);
    }
    // A model whose tool is gone (an account or an endpoint you removed) doesn't quietly become the Demo.
    const p = providers[r.provider];
    if (!p) throw new Error(toolGone(this.labelOf(`${r.provider}:${r.model}`), "Pick another model for this session."));
    const forking = !sidekick && this.realFork(t) && agentId === t.agent;
    // A provider session id is kept as "<provider>:<id>" per part (the lead, the sidekick), so it only resumes into the one that made it.
    const saved = (sidekick ? t.sessions?.[agentId] : savedSession(t, agentId)) ?? "";
    // A tool that lets a server of the person's own take `liner`'s place (Antigravity) gets Liner Code's under a name of its own,
    // made new by the session each time the tool's process starts (acp.ts AcpSession.server) and told to the model in the
    // conversation then: what's written here once names it liner_<tag>.
    const family = familyOf(r.provider);
    const n = linerName(family);
    const resume = saved.startsWith(`${r.provider}:`) ? saved.slice(r.provider.length + 1) : undefined;
    const session = p.open({
      cwd,
      model: team.model,
      subagents: team.agents,
      effort: r.effort,
      access,
      soul: [
        t.sideOf
          ? [briefOf(r.agent, cwd), SIDE_RULES].filter(Boolean).join("\n\n")
          : sidekick
            ? [briefOf(r.agent, cwd), sidekickRules(this.nameOf(t, t.agent))].filter(Boolean).join("\n\n")
            : briefOf(r.agent, cwd),
        this.tools ? toolsNote(n, family) : "",
        pair ? leadRules(this.labelOf(t.sidekick!), frontierClass(t.sidekick!), n) : "",
        // A session's mode (Workshop, a custom one) is the lead's way of working, not the sidekick's.
        sidekick ? "" : modeNote(t, this.store.agents, cwd, n, Boolean(this.tools)),
        memoryNote(this.store.home, t.projectId),
      ]
        .filter(Boolean)
        .join("\n\n"),
      side: Boolean(t.sideOf),
      ...(sidekick ? { sidekick: true } : {}),
      ...(this.store.projects.find((p) => p.id === t.projectId)?.kind === "design" && !t.worktree ? { designOnItsOwn: true } : {}),
      resume: forking ? t.forkSession!.slice(t.forkSession!.indexOf(":") + 1) : resume,
      fork: forking,
      guard: this.store.settings.guardDestructive,
      // Where its attachments are saved, its session's too for a side chat: those from before a restart read without asking.
      dirs: [t.id, ...(t.sideOf ? [t.sideOf] : [])].map((id) => join(this.store.home, "attachments", id)).filter((d) => existsSync(d)),
      // Tagged with the session, so a dev server the agent starts shows in this session's Browser.
      env: { ...this.envFor(r.provider), [THREAD_ENV]: t.id },
      // The session's Browser and Device, and pages shown in it, as tools.
      mcp: this.tools?.serverFor(t.id, { pair, sidekick }) ?? undefined,
      connections,
      // A turn it begins by itself (a background task finished) shows as a turn of its own. A sidekick's has no one to go to.
      wake: (w) => (!sidekick && this.live.get(liveKey)?.session === session ? this.wake(t.id, agentId, w) : w.cancel()),
    });
    this.live.set(liveKey, { session, provider: r.provider, key, links, kit });
    // A saved session from another tool can't carry over: the new one gets the conversation as text.
    return { session, fresh: !resume && !forking, switched: Boolean(saved) && !saved.startsWith(`${r.provider}:`) };
  }

  /** The connections a thread's tool gets: your add-ons for its project. A side chat gets them too; it only reads. */
  private connectionsOf(t: Thread): Connection[] {
    return this.addons?.connections(t.projectId, this.keys) ?? [];
  }

  /**
    Your add-ons changed: each open session gets its connections now where its tool takes them in
    place (Claude Code), and is reopened otherwise: at once when it's idle, for its next turn when it's
    working. Says, for each thread, whether they're there now or from its next turn: for the session
    working its turn, when there is one.
  */
  async relink(): Promise<Map<string, "now" | "next">> {
    const out = new Map<string, "now" | "next">();
    for (const [key, l] of [...this.live]) {
      const threadId = key.slice(0, key.indexOf(":"));
      const t = this.store.threads.find((x) => x.id === threadId);
      if (!t) continue;
      const connections = this.connectionsOf(t);
      const links = fingerprint(connections);
      let now = l.links === links;
      if (!now && (await l.session.connect?.(connections).catch(() => false))) {
        l.links = links;
        now = true;
      }
      // Reopened for the next turn, resuming where it was; one working now is left to finish.
      if (!now && !this.turns.has(threadId)) {
        this.live.delete(key);
        void this.ending(threadId, [l.session]);
      }
      if (this.turns.get(threadId)?.session === l.session || !out.has(threadId)) out.set(threadId, now ? "now" : "next");
    }
    return out;
  }

  /** A thread that may only read: Read only, or a side chat. Its agent can't add add-ons. */
  readOnly(threadId: string) {
    const t = this.store.thread(threadId);
    return t.access === "read" || Boolean(t.sideOf);
  }

  /** Whether the model a thread's lead (or its sidekick) runs on takes pictures: an API endpoint's as Settings says or its name suggests, any other yes. */
  seesPictures(threadId: string, sidekick = false) {
    const t = this.store.thread(threadId);
    const { provider, model } = sidekick && t.sidekick ? splitModel(t.sidekick) : this.resolve(t);
    return picturesOf(provider, model, this.store.settings);
  }

  /** Nobody is there to answer a card for this thread: a routine's step. */
  unwatched(threadId: string) {
    return this.unattended.has(threadId);
  }

  /** The tool a thread's turn runs on now (or would next), by its label and family ("Claude Code", "claude"). */
  toolOf(threadId: string) {
    const t = this.store.thread(threadId);
    const { provider } = this.resolve(t, this.turns.get(threadId)?.agentId ?? t.agent);
    return { label: this.providerInfo.find((p) => p.id === provider)?.label ?? provider, family: familyOf(provider) };
  }

  /** Who works a thread's turn now, or last did, by name ("Opus 5.5"). */
  whoIs(threadId: string) {
    const t = this.store.thread(threadId);
    return this.nameOf(t, this.turns.get(threadId)?.agentId ?? t.turnBy ?? t.agent);
  }

  /**
    A request an agent makes through Liner Code's own tools (an add-on's install card): on the
    timeline like its tool's requests, held until you answer, and expired when its turn ends or stops.
  */
  askLiner(threadId: string, ask: { tool: string; title: string; description?: string; risk: Risk; fields: { label: string; value: string }[]; addon?: Extract<Item, { kind: "approval" }>["addon"] }): { id: string; answer: Promise<Answer> } {
    const store = this.store;
    const t = store.thread(threadId);
    const turn = this.turns.get(threadId);
    const id = uid("it");
    store.putItem(threadId, { kind: "approval", id, turn: turn?.turn ?? t.turns, at: Date.now(), ...ask, state: "asking" });
    this.clock(threadId);
    const was = t.status;
    store.patchThread(threadId, { status: "waiting" });
    store.emit({ type: "notify", threadId, kind: "waiting", title: `${this.whoIs(threadId)} needs you`, body: ask.title });
    const answer = new Promise<Answer>((resolve) => {
      const gone = () => {
        if (!this.approvals.delete(id)) return;
        const it = store.item(threadId, id);
        if (it.kind === "approval" && it.state === "asking") store.putItem(threadId, { ...it, state: "expired" });
        resolve({ allow: false, reason: "The turn ended before the person answered." });
      };
      this.approvals.set(id, { resolve, reject: gone });
      if (!turn) return;
      (turn.liner ??= new Set()).add(id);
      if (turn.abort.signal.aborted) gone();
      else turn.abort.signal.addEventListener("abort", gone, { once: true });
    });
    return {
      id,
      answer: answer.finally(() => {
        this.settleWaiting(threadId);
        // Asked with no turn running (a tool's late call): nothing else takes the session out of Needs you.
        const now = store.threads.find((x) => x.id === threadId);
        if (now?.status === "waiting" && !this.isRunning(threadId) && !store.timeline(threadId).some((x) => (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking")) store.patchThread(threadId, { status: was === "waiting" || was === "running" ? "done" : was });
      }),
    };
  }

  /** Only Claude Code can branch a session in place, on the same account; other forks get the conversation as text. */
  private realFork(t: Thread) {
    const { provider } = this.resolve(t);
    return familyOf(provider) === "claude" && Boolean(t.forkSession?.startsWith(`${provider}:`));
  }

  /** You sent a message. While a turn runs it waits in the queue, or steers the running turn. */
  async send(threadId: string, text: string, mode: "queue" | "steer" = "queue", anchor?: TurnOptions["anchor"], files?: string[], design?: DesignMark, shown?: UserShown) {
    const store = this.store;
    const running = this.turns.get(threadId);
    // A message taken out of the queue goes now (Send now): what was kept for putting it back goes with it.
    const left = this.leftQueue.get(threadId);
    if (left) for (const [id, q] of left) if (q.text === text) left.delete(id);
    // From Liner Design: the message carries its mark to the turn it becomes (a steer, at once), and only there.
    if (!design?.file) design = undefined;
    if (running || this.busy.has(threadId)) {
      // A steer the tool couldn't take (its request failed, or the turn ended first) isn't lost: it goes
      // next, from the queue (T3 Code: SteeringCompletion.integration.test.ts).
      // After Stop nothing is left of that turn to read a steer: it goes next, like any message. So does a command, which is no word to the agent.
      if (mode === "steer" && !this.halted.has(threadId) && !commandOf({ text, files, anchor }) && running?.session?.steer && (await running.session.steer([this.designOf(threadId, design), anchor ? aboutLines(anchor, text) : text, attachNote(files ?? [])].filter(Boolean).join("\n\n"), files))) {
        store.putItem(threadId, { kind: "user", id: uid("it"), turn: running.turn, at: Date.now(), text, steer: true, ...(anchor ? { anchor } : {}), ...(files?.length ? { files } : {}), ...(shown ? { shown } : {}) });
        return;
      }
      this.enqueue(threadId, text, files, anchor, design, shown);
      // Sent after Stop: it isn't one more for Stop to keep, it's your next message.
      if (this.halted.has(threadId)) this.released.add(threadId);
      // The turn ended while the steer was tried: nothing in flight will send the queue now.
      if (!this.isRunning(threadId)) this.drain(threadId);
      return;
    }
    return this.hold(threadId, () => this.dispatch(threadId, text, anchor, files, design, shown));
  }

  /** The "## Design" note of a message sent from Liner Design; "" for any other. A note that can't be read is left out, never the message. */
  private designOf(threadId: string, mark: DesignMark | undefined, cwd?: string) {
    if (!mark) return "";
    try {
      const t = this.store.thread(threadId);
      return designNote(cwd ?? t.worktree?.path ?? this.store.project(t.projectId).path, mark, this.env);
    } catch (e) {
      console.error("[engine] design note", e);
      return "";
    }
  }

  /** A message to a thread with nothing in flight: a side chat answers it, a pull request ask opens the PR card, and anything else is one turn of the session's lead. */
  private async dispatch(threadId: string, text: string, anchor?: TurnOptions["anchor"], files?: string[], design?: DesignMark, shown?: UserShown) {
    const store = this.store;
    const t = store.thread(threadId);
    this.settleAsks(threadId);
    // Past its spending cap: your message is the go-ahead for another cap's worth.
    const cap = store.settings.capUsd ?? 0;
    if (cap > 0 && t.usage.costUsd >= (t.spendLimit ?? cap)) {
      store.patchThread(threadId, { spendLimit: t.usage.costUsd + cap });
      store.putItem(threadId, { kind: "notice", id: uid("it"), turn: t.turns, at: Date.now(), text: `Going on: another $${cap} for this session before it stops again.` });
    }
    // A side chat only answers: no pull request, nothing for the Reviewer, and no design note (it changes nothing).
    if (t.sideOf) return void (await this.turn(threadId, text, t.agent, { review: false, files, ...(shown ? { shown } : {}) }));
    if (!anchor && !files?.length && isPrAsk(text)) return this.openPr(threadId, text, shown);
    await this.turn(threadId, text, t.agent, { anchor, review: !anchor, files, ...(design ? { design } : {}), ...(shown ? { shown } : {}) });
  }

  /** "codex:gpt-6-luna" as its tool calls it ("GPT-6 Luna"), for the lines reviews and the timeline write. */
  labelOf(ref: string) {
    const { provider, model } = splitModel(ref);
    return this.providerInfo.find((p) => p.id === provider)?.models.find((m) => m.id === model)?.label ?? reviewerLabel(ref);
  }

  /** "Create PR": no agent turn, the PR card itself opens the pull request in the chat. */
  private openPr(threadId: string, text: string, shown?: UserShown) {
    const store = this.store;
    const t = store.thread(threadId);
    const turn = t.turns + 1;
    const title = t.title === "New session" || t.title === "New thread" ? titleFrom(shown?.text || text) : t.title;
    store.patchThread(threadId, { turns: turn, title, archived: false, done: false, snoozedUntil: undefined });
    store.putItem(threadId, { kind: "user", id: uid("it"), turn, at: Date.now(), text, ...(shown ? { shown } : {}) });
    store.putItem(threadId, { kind: "pr", id: uid("it"), turn, at: Date.now(), ...(this.resolve(t).provider === "demo" ? { demo: true } : {}) });
  }

  /**
    The PR card's tests on this Mac, before anything is pushed. They run in the card's turn as a
    command with its output, and ask first unless the session works by itself (Auto, Full, a
    routine) or you said not to ask again. Asking again while they run waits for the same run.
  */
  prTest(threadId: string, itemId: string): Promise<PrTestResult> {
    const going = this.prTests.get(threadId);
    if (going) return going;
    const stop = new AbortController();
    const p = this.runPrTest(threadId, itemId, stop.signal).finally(() => {
      this.prTests.delete(threadId);
      this.prStops.delete(threadId);
    });
    this.prTests.set(threadId, p);
    this.prStops.set(threadId, stop);
    return p;
  }

  private async runPrTest(threadId: string, itemId: string, signal: AbortSignal): Promise<PrTestResult> {
    const store = this.store;
    const t = store.thread(threadId);
    const turn = store.item(threadId, itemId).turn;
    const project = store.project(t.projectId);
    const cwd = t.worktree?.path ?? project.path;
    const command = testCommand(cwd, project.scripts);
    if (!command) return { state: "skipped", summary: "No tests found" };

    const rule = ruleFor(command);
    const risk = commandRisk(command);
    if (!(t.access === "auto" || t.access === "review" || t.access === "full" || this.unattended.has(threadId) || (rule && risk !== "high" && this.ruleAllows(threadId, command)))) {
      const id = uid("it");
      // Why: the level asks (it isn't one that runs them by itself), and what can't be undone first when it's that.
      const why = [...(riskOf(command).risk === "high" ? [riskOf(command).why!] : []), { kind: "level" as const, text: `${ACCESS_NAMES[t.access]} asks before running the project's tests` }];
      const grants: ApprovalGrant[] = rule && risk !== "high" ? [{ kind: "rule", label: rule }] : [];
      store.putItem(threadId, { kind: "approval", id, turn, at: Date.now(), tool: PR_TEST_TOOL, title: `Run ${command}`, description: "Runs the project's tests on this Mac before the pull request goes up.", risk, fields: [{ label: "Command", value: command }, { label: "Where", value: cwd }], ...(grants.length ? { rule } : {}), why, grants, state: "asking" });
      this.clock(threadId);
      const was = t.status;
      store.patchThread(threadId, { status: "waiting" });
      store.emit({ type: "notify", threadId, kind: "waiting", title: `${this.resolve(t).agent.name} needs you`, body: `Run ${command}` });
      const { allow } = await new Promise<{ allow: boolean }>((resolve) => {
        this.approvals.set(id, { resolve, reject: () => resolve({ allow: false }) });
        signal.addEventListener(
          "abort",
          () => {
            if (!this.approvals.delete(id)) return;
            const it = store.item(threadId, id);
            if (it.kind === "approval" && it.state === "asking") store.putItem(threadId, { ...it, state: "expired" });
            resolve({ allow: false });
          },
          { once: true },
        );
      });
      // Back to how it was, unless a turn started meanwhile or something else waits on you.
      const asking = store.timeline(threadId).some((x) => (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking");
      if (store.thread(threadId).status === "waiting" && !this.turns.has(threadId) && !asking) store.patchThread(threadId, { status: was === "waiting" || was === "running" ? "done" : was });
      if (!allow) return { state: "skipped", command, summary: signal.aborted ? "Stopped" : "You said no" };
    }

    const id = uid("it");
    const started = Date.now();
    let out = "";
    const put = (status: "running" | "done" | "failed") =>
      store.putItem(threadId, { kind: "tool", id, turn, at: started, tool: PR_TEST_TOOL, toolKind: "exec", title: `Run ${command}`, input: command, output: tailOf(out), status, seconds: status === "running" ? undefined : (Date.now() - started) / 1000 }, status !== "running");
    put("running");
    // Plain output, and test runners that finish instead of watching.
    const env: NodeJS.ProcessEnv = { ...this.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" };
    const sh = shellOf(command, env);
    const child = spawn(sh.cmd, sh.args, { cwd, env, detached: true, windowsVerbatimArguments: sh.verbatim, stdio: ["ignore", "pipe", "pipe"] });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const take = (d: Buffer) => {
      out += d.toString("utf8");
      if (out.length > 400000) out = out.slice(-200000);
      timer ??= setTimeout(() => ((timer = undefined), put("running")), 250);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    // Its process group, and after a moment by force: a runner that ignores being asked would hold the card at running for good.
    const kill = () => killTree(child);
    signal.addEventListener("abort", kill, { once: true });
    const limit = setTimeout(() => ((out += "\nStopped after 10 minutes."), kill()), 600000);
    const code = await new Promise<number>((resolve) => {
      child.on("error", (e) => ((out += e.message), resolve(1)));
      child.on("close", (c) => resolve(c ?? 1));
    });
    clearTimeout(limit);
    clearTimeout(timer);
    const ok = code === 0 && !signal.aborted;
    put(ok ? "done" : "failed");
    return { state: ok ? "passed" : "failed", command, summary: signal.aborted ? "Stopped" : testSummary(clean(out), ok), seconds: (Date.now() - started) / 1000 };
  }

  /**
    /goal: the coder works toward it turn after turn, by itself, until it says the goal is met,
    you stop it, it needs you, or it has had `max` turns.
  */
  async startGoal(threadId: string, text: string, max = 12) {
    this.store.patchThread(threadId, { goal: { text, status: "active", turns: 0, max } });
    this.settleAsks(threadId);
    await this.goalTurn(threadId, text, true);
  }
  private async goalTurn(threadId: string, text: string, first: boolean) {
    const t = this.store.thread(threadId);
    if (t.goal?.status !== "active") return;
    this.store.patchThread(threadId, { goal: { ...t.goal, turns: t.goal.turns + 1 } });
    const ask = first
      ? `${text}\n\n(This is a goal: work toward it now and keep going across turns. Check it's really met, by running what proves it. When it is, end your reply with the line GOAL MET. If you can't get there, say why and end with GOAL BLOCKED.)`
      : `Keep going toward the goal: ${text}\n\n(When it's met and checked, end with GOAL MET. If you're stuck, say why and end with GOAL BLOCKED.)`;
    await this.turn(threadId, first ? `/goal ${text}` : ask, t.agent, { show: first, prompt: first ? ask : undefined, review: false });
  }
  /** After a turn: a goal that isn't met yet gets another turn. */
  private async afterGoal(threadId: string, turn: number, stopped: boolean, held: boolean) {
    const store = this.store;
    const t = store.thread(threadId);
    const g = t.goal;
    if (g?.status !== "active") return false;
    const said = store.timeline(threadId).filter((x) => x.turn === turn && x.kind === "text").map((x) => (x.kind === "text" ? x.text : "")).join("\n");
    const note = (text: string) => store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text });
    if (/GOAL MET\s*$/m.test(said)) {
      store.patchThread(threadId, { goal: { ...g, status: "met" } });
      note(`Goal met in ${g.turns} ${g.turns === 1 ? "turn" : "turns"}: ${g.text}`);
      return false;
    }
    if (stopped || held || /GOAL BLOCKED\s*$/m.test(said)) {
      store.patchThread(threadId, { goal: { ...g, status: "stopped" } });
      note(stopped ? "The goal stopped with the turn." : held ? "The goal waits for you." : "The goal is blocked; see why above.");
      return false;
    }
    if (g.turns >= g.max) {
      store.patchThread(threadId, { goal: { ...g, status: "stopped" } });
      note(`Stopped after ${g.max} turns without meeting the goal. Send /goal again to keep going.`);
      return false;
    }
    // What you wrote while it worked goes first (when the hold ends); the goal goes on after it.
    if ((t.queue ?? []).length) {
      note("The goal goes on after your message.");
      return false;
    }
    void this.goalTurn(threadId, g.text, false);
    return true;
  }

  /**
    One turn by one agent, and how it ended (null: it didn't start, since you pressed Stop, or the
    session is gone). One that would start after you pressed Stop (a fix round) doesn't.
  */
  private turn(threadId: string, text: string, agentId: string, o: TurnOptions = {}): Promise<TurnEnd | null> {
    return this.hold(threadId, () => (this.halted.has(threadId) ? Promise.resolve(null) : this.turnNow(threadId, text, agentId, o)));
  }
  private async turnNow(threadId: string, text: string, agentId: string, o: TurnOptions = {}): Promise<TurnEnd | null> {
    try {
      return await this.runTurn(threadId, text, agentId, o);
    } catch (e) {
      // A save that fails anywhere around the turn (a full disk) can't leave it looking at work for good,
      // or with every message after it queued behind a turn nobody is running.
      this.turns.delete(threadId);
      this.turnGrants.delete(threadId);
      if (!this.store.threads.some((x) => x.id === threadId)) return null;
      const t = this.store.patchThread(threadId, { status: "error" });
      this.store.emit({ type: "notify", threadId, kind: "error", title: "This turn couldn't be saved", body: e instanceof Error ? e.message : String(e) });
      return { turn: t.turns, status: "error", changed: false };
    }
  }
  private async runTurn(threadId: string, text: string, agentId: string, o: TurnOptions = {}): Promise<TurnEnd | null> {
    const show = o.show ?? true;
    const store = this.store;
    let t = store.thread(threadId);
    const project = store.project(t.projectId);
    const cwd = t.worktree?.path ?? project.path;
    const turn = t.turns + 1;
    const abort = new AbortController();
    const live: Turn = { abort, started: Date.now(), turn, agentId };
    this.turns.set(threadId, live);
    // A session named by its first message is named by what the person read of it, not by the words Liner wrote for the agent.
    const title = t.title === "New session" || t.title === "New thread" ? titleFrom(o.shown?.text || text) : t.title;
    t = store.patchThread(threadId, { status: "running", turns: turn, title, archived: false, done: false, snoozedUntil: undefined, turnBy: agentId });
    const r = this.resolve(t, agentId);
    const marker: Item = { kind: "turn", id: uid("it"), turn, at: Date.now(), agent: agentId, model: `${r.provider}:${r.model}`, status: "running", ...(o.part ? { part: o.part } : {}), ...(o.why ? { why: o.why } : {}) };
    if (show) store.putItem(threadId, { kind: "user", id: uid("it"), turn, at: Date.now(), text, ...(o.anchor ? { anchor: o.anchor } : {}), ...(o.files?.length ? { files: o.files } : {}), ...(o.shown ? { shown: o.shown } : {}) });
    if (o.note) store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: o.note });
    store.putItem(threadId, marker);
    live.marker = marker.id;

    let prompt = o.prompt ? o.prompt : o.anchor ? aboutLines(o.anchor, text) : text;
    // Sent from Liner Design: where the design is, its frames, the lean and what's selected, before the words. A side chat and a fix round don't take it.
    const designed = o.design && show && !o.wake && !o.prompt && !t.sideOf && !COMPACT.test(text) ? this.designOf(threadId, o.design, cwd) : "";
    if (designed) prompt = `${designed}\n\n${prompt}`;
    // Your attachments are named only in what the agent is sent; the timeline shows them as files.
    if (o.files?.length) prompt = `${prompt}\n\n${attachNote(o.files)}`;

    // A side chat shares its session's folder and changes nothing, so it takes no snapshot: what
    // the session edits meanwhile would read as the side chat's change.
    const git = !t.sideOf && (await isRepo(cwd));
    const from = git ? await capture(cwd, `${threadId}/${turn}-before`) : null;
    // Said, not hidden: a turn with no snapshot can't be shown as a diff or taken back.
    const unsnapped = "Couldn't snapshot this turn, so its changes can't be shown or undone.";
    if (git && !from) store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: unsnapped });
    const sink = this.sink(threadId, turn, abort.signal, agentId);
    let failed = false;
    let ran = false;
    try {
      // The tool would fail to start with its own words, naming neither the folder nor what's wrong with it.
      if (!existsSync(cwd)) throw new Error(`This session's folder isn't there any more: ${cwd}`);
      // A turn the tool began by itself runs on the session that began it, as it is.
      const { session, fresh, switched } = o.wake ? { session: o.wake.session, fresh: false, switched: false } : await this.session(t, agentId, cwd);
      live.session = session;
      // The level the tool really thinks at is its to say again (TurnSink.effortNow): a session just opened hasn't yet.
      if (fresh && agentId === t.agent && store.thread(threadId).effortNow !== undefined) store.patchThread(threadId, { effortNow: undefined });
      const fit = this.effortNote(t, agentId);
      if (fit) store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: fit });
      // Stopped while the snapshot was taken or the tool was opening: the turn never starts.
      if (abort.signal.aborted) {
        // The tool's own turn stops too, or it goes on by itself with nobody running it.
        o.wake?.w.cancel();
        // It heard nothing, so it isn't told next turn unless it's opened again.
        if (fresh) this.drop(liveKeyOf(threadId, agentId));
        throw new Error("stopped");
      }
      // A session that starts knowing nothing (another tool took over, a fork that can't branch in
      // place, a rewind) gets the conversation so far, so the work carries on where it was.
      const earlier = store.timeline(threadId).filter((x) => x.turn < turn);
      // A compaction goes to the tool as it is: put after anything, it's only words to the model (T3 Code rejects or defers it).
      const compact = COMPACT.test(text);
      let blank = false;
      if (fresh && r.provider !== "demo" && earlier.some((x) => x.kind === "user" || x.kind === "text")) {
        if (compact) {
          // A session that knows nothing has nothing to compact, and has to be told the conversation next turn.
          this.drop(liveKeyOf(threadId, agentId));
          store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: "Nothing to compact yet: this session starts again from the conversation so far on your next message." });
          blank = true;
        } else prompt = `${handoff(earlier, switched ? "switch" : t.forkSession !== undefined ? "fork" : "restart")}\n\n${prompt}`;
        // Said when you moved the session to another tool.
        if (switched && show && !blank) store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: `${this.providerInfo.find((p) => p.id === r.provider)?.label ?? r.provider} takes over here, with the conversation so far.` });
      }
      // What the Reviewer said about the last change that no model has heard (notes on a change it
      // passed, findings left after its last round) comes before your message, once, so "fix the
      // notes" means something to it.
      if (show && !o.wake && !compact && r.provider !== "demo") {
        const word = reviewerWord(earlier, (ref) => this.labelOf(ref));
        if (word) {
          prompt = `${word.text}\n\n${prompt}`;
          for (const it of word.reviews) store.putItem(threadId, { ...it, heard: true });
        }
      }
      const go = (p: string) => (o.wake ? o.wake.w.run(sink.api, abort.signal) : session.turn(p, sink.api, abort.signal, o.files));
      ran = !blank;
      try {
        if (ran) await go(prompt);
      } catch (e) {
        // The session it was to resume is gone: the tool opened a new one, which gets the conversation so far
        // (T3 Code: ProviderTurnStartService.ts, its fallback when a resume fails).
        if (!(e instanceof ResumeFailed) || abort.signal.aborted) throw e;
        const tool = this.providerInfo.find((p) => p.id === r.provider)?.label ?? r.provider;
        store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: `${tool} couldn't pick up its own session any more, so it starts a new one with the conversation so far.` });
        const talk = earlier.some((x) => x.kind === "user" || x.kind === "text");
        await go(talk ? `${handoff(earlier, t.forkSession !== undefined ? "fork" : "restart")}\n\n${prompt}` : prompt);
      }
    } catch (e) {
      if (!abort.signal.aborted) {
        failed = true;
        sink.api.error(e instanceof Error ? e.message : String(e));
        // A session that broke is opened fresh next time.
        this.drop(liveKeyOf(threadId, agentId));
      }
    } finally {
      // A save that fails here (a full disk) can't leave the turn running for good, with every message after it queued.
      try {
        sink.end();
      } catch (e) {
        failed = true;
        store.patchThread(threadId, { status: "error" });
        store.emit({ type: "notify", threadId, kind: "error", title: "This turn couldn't be saved", body: e instanceof Error ? e.message : String(e) });
      }
      // An install card its agent stopped waiting on (the turn ended) expires like the tool's own requests.
      for (const id of live.liner ?? []) this.approvals.get(id)?.reject(new Error("The turn ended."));
      // What waits on the turn (a sidekick's brief the lead called) ends with it, and the turn waits for it to have
      // really ended (its tool cancelled, its after snapshot taken, its use logged), so the turn's own snapshot has its
      // last edits for the Reviewer and its use counts while the turn is held. One that never answers is let go.
      for (const end of live.ends ?? []) end();
      if (live.winding?.size) {
        let cap: NodeJS.Timeout | undefined;
        await Promise.race([Promise.allSettled([...live.winding]), new Promise((r) => (cap = setTimeout(r, this.briefWindMs)))]);
        clearTimeout(cap);
      }
      this.sideRows.delete(threadId);
      this.turns.delete(threadId);
      // "Don't ask again this turn" ends with the turn, however it ended (done, stopped, failed).
      this.turnGrants.delete(threadId);
    }
    // The session was deleted while the turn wound down: nothing of it is written back.
    if (!store.threads.some((x) => x.id === threadId)) return null;
    // Its tool changed while the turn was opening it (the session it opened is the old tool's): that one ends now too.
    if (store.thread(threadId).agent !== t.agent || store.thread(threadId).model !== t.model || store.thread(threadId).sidekick !== t.sidekick) void this.retool(threadId).catch(() => {});
    // When Claude's prompt cache for this thread likely runs out: an hour after its last turn on a plan,
    // five minutes with an API key. Past it a long thread is read again at full price (T3 Code: IdleCompaction.ts).
    if (ran && familyOf(r.provider) === "claude") store.patchThread(threadId, { cacheUntil: Date.now() + (r.provider === "claude" && store.settings.claudeBilling === "key" && this.keys.get("anthropic") ? 5 : 60) * 60_000 });

    const stopped = abort.signal.aborted;
    if (stopped && !this.levelStops.delete(threadId)) store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: "You stopped this turn." });
    const seconds = (Date.now() - live.started) / 1000;
    let changed = false;
    if (git && from) {
      const to = await capture(cwd, `${threadId}/${turn}-after`);
      // Only what the turn wrote: a pull or checkout it ran brings files it didn't.
      const files = to ? await changes(cwd, from, to, { turn: true }) : [];
      if (!to) store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: unsnapped });
      if (to && files.length) {
        store.putItem(threadId, { kind: "checkpoint", id: uid("it"), turn, at: Date.now(), files, from, to, seconds });
        changed = true;
      }
    }
    const errored = failed || sink.errored();
    // The turn's clock leaves out the time it waited on you: what was settled, and a wait still open as it ended.
    const kept = store.timeline(threadId).find((x) => x.id === marker.id);
    const m = kept?.kind === "turn" ? kept : marker;
    const waited = (m.waited ?? 0) + (m.waitingSince ? Math.max(0, Date.now() - m.waitingSince) : 0);
    const { waitingSince: _open, ...settled } = m;
    store.putItem(threadId, { ...settled, status: stopped ? "stopped" : errored ? "error" : "done", seconds: Math.max(0, seconds - waited / 1000), ...(waited ? { waited } : {}) });

    t = store.thread(threadId);
    this.logUsage(t, agentId, sink.spent(), seconds);
    // A side chat starts with a copy of its session's timeline; only its own turns can wait on you.
    const asking = store.timeline(threadId).some((x) => x.turn > (t.sideFrom ?? 0) && (x.kind === "proposal" || x.kind === "question" || x.kind === "approval") && x.state === "asking");
    const limited = sink.limited();
    t = store.patchThread(threadId, { status: limited ? "limited" : errored ? "error" : asking ? "waiting" : "done", limit: limited ?? undefined, forkSession: undefined, toReview: this.toReview(threadId), unread: true });
    this.countAgents(threadId);
    // You're looking at a side chat when you ask in it, so it doesn't notify.
    if (!stopped && !t.sideOf) {
      const who = this.resolve(t, agentId).agent.name;
      const kind = errored || limited ? "error" : asking ? "waiting" : "done";
      // Done is told once the work this message set off has all ended (tellDone), so a check or a fix after it doesn't make it twice.
      if (kind === "done") this.finished.set(threadId, this.nameOf(t, t.agent));
      else store.emit({ type: "notify", threadId, kind, title: limited ? `${who} hit its usage limit` : errored ? `${who} ran into a problem` : asking ? `${who} needs you` : `${who} is done`, body: limited?.until ? `${t.title}. It resets ${new Date(limited.until).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}.` : t.title });
    }
    const end: TurnEnd = { turn, status: stopped ? "stopped" : limited ? "limited" : errored ? "error" : asking ? "waiting" : "done", changed };
    // Carrying on by itself, when you said so in Settings and another tool is ready.
    if (limited) {
      const lim = store.timeline(threadId).findLast((x) => x.kind === "limit" && x.turn === turn);
      if (!stopped && store.settings.onLimit === "carry" && lim?.kind === "limit" && lim.fallback) void this.carryOn(threadId, lim.fallback).catch(() => {});
      return end;
    }
    const lead = agentId === store.thread(threadId).agent;
    // A goal that isn't met yet takes the next turn itself.
    if (lead && (await this.afterGoal(threadId, turn, stopped || this.halted.has(threadId), errored || asking))) return end;
    // The lead's change goes to the Reviewer before it's yours; so does one a skipped check left
    // unread (Thread.reviewSince), even when this turn changed nothing, or it would wait for a turn that does.
    const unread = Boolean(store.thread(threadId).reviewSince);
    if (o.review === false || end.status !== "done" || !(changed || unread) || !lead) return end;
    // What you wrote while it worked goes next (when the hold ends), and this change is read with the next check.
    if ((store.thread(threadId).queue ?? []).length) {
      const now = store.thread(threadId);
      if (from && !now.reviewSince && this.reviewerFor(now)) store.patchThread(threadId, { reviewSince: from });
      return end;
    }
    await this.review(threadId, turn, 1);
    return end;
  }

  /**
    The Reviewer: another maker's model reads the lead's change against fixed criteria. A blocking
    finding goes back to the lead to fix, up to ROUNDS times (or your own number); after that it's
    yours. Round 1 reads from where the unread change starts (`since`, else Thread.reviewSince when a
    check was skipped, else the turn's own snapshot); a fix round reads the fix.
  */
  review(threadId: string, turn: number, round: number, since?: string): Promise<void> {
    return this.hold(threadId, () => (this.halted.has(threadId) ? Promise.resolve() : this.reviewNow(threadId, turn, round, since)));
  }
  private async reviewNow(threadId: string, turn: number, round: number, since?: string): Promise<void> {
    const store = this.store;
    const t = store.thread(threadId);
    const ref = this.reviewerFor(t);
    if (!ref) return;
    const change = await this.changeOf(threadId, turn, { since: round === 1 ? (since ?? t.reviewSince) : since, small: round === 1 && !store.settings.reviewSmall });
    if (!change) return;
    // Stopped while the diff was read: no turn was there for Stop to abort, so the read doesn't start.
    if (this.halted.has(threadId)) return;
    // What a skipped check left unread is read now, or let through as small: either way it's had its check.
    const settled = () => void (round === 1 && store.thread(threadId).reviewSince && store.patchThread(threadId, { reviewSince: undefined }));
    // A few lines, or only docs, go through without a word (the change itself is on the timeline).
    if (change.small) return settled();
    const read = await this.read(threadId, { ref, turn: change.turn, round, prompt: reviewPrompt(this.askOf(threadId), change.diff, round) });
    // A Reviewer that never answered didn't read it: the change stays unread from where it starts, so the next check
    // reads it (as one a queued message went ahead of), rather than it counting as read.
    if (read === "late") return void store.patchThread(threadId, { reviewSince: store.thread(threadId).reviewSince ?? change.from });
    settled();
    if (!read) return;
    const blocking = read.findings.filter((f) => f.severity === "blocking");
    // A fail with nothing marked blocking counts what it did say.
    const count = blocking.length || read.findings.length;
    const n = count ? `${count} ${count === 1 ? "finding" : "findings"}` : "Problems";
    if (read.status === "passed") {
      store.patchThread(threadId, { status: "done", verdict: { state: "verified", note: read.summary, round } });
      return;
    }
    const rounds = Math.min(3, Math.max(1, store.settings.reviewRounds ?? ROUNDS));
    if (round >= rounds) {
      const note = `${n} still blocking after ${rounds === 1 ? "one round" : `${rounds} rounds`}`;
      const now = store.patchThread(threadId, { status: "waiting", verdict: { state: "blocked", note, round } });
      store.emit({ type: "notify", threadId, kind: "waiting", title: "The Reviewer needs you", body: `${now.title}: ${note}` });
      return;
    }
    // Its findings go back to the lead to fix now: heard.
    store.patchThread(threadId, { verdict: { state: "blocked", note: read.summary, round } });
    store.putItem(threadId, { ...read, heard: true });
    const fix = await this.turn(threadId, fixPrompt(reviewerLabel(ref), read.findings, read.summary), t.agent, { show: false, review: false, part: "fix", why: `${this.labelOf(ref)} found ${n.toLowerCase()} to fix.` });
    if (fix?.status !== "done") return;
    // A fix that changed no file leaves the very diff that was blocked: reading it again costs a full read to
    // say the same. It's yours now, as after the last round.
    if (!fix.changed) {
      const note = `${n} still blocking: the fix changed nothing`;
      const now = store.patchThread(threadId, { status: "waiting", verdict: { state: "blocked", note, round } });
      store.emit({ type: "notify", threadId, kind: "waiting", title: "The Reviewer needs you", body: `${now.title}: ${note}` });
      return;
    }
    await this.review(threadId, fix.turn, round + 1);
  }

  /**
    A turn's change, for a reader: the last checkpoint up to `turn` that wasn't undone, as a diff cut
    to size, from `since` when the unread change starts earlier. With `small`, a change of a few
    lines or only docs says so instead (smallChange). Null when there's no change to read.
  */
  private async changeOf(threadId: string, turn: number, o: { since?: string; small?: boolean } = {}): Promise<{ turn: number; diff: string; from: string; small?: boolean } | null> {
    const store = this.store;
    const t = store.thread(threadId);
    const cp = store.timeline(threadId).findLast((x) => x.kind === "checkpoint" && x.turn <= turn && !x.reverted);
    if (cp?.kind !== "checkpoint" || !cp.from || !cp.to) return null;
    const cwd = t.worktree?.path ?? store.project(t.projectId).path;
    const from = o.since ?? cp.from;
    if (o.small && smallChange((await run("git", ["diff", "--relative", "--numstat", from, cp.to], { cwd, timeout: 60000 })).stdout)) return { turn: cp.turn, diff: "", from, small: true };
    const diff = (await run("git", ["diff", "--relative", ...PATCH, "-U3", from, cp.to], { cwd, timeout: 60000 })).stdout;
    return { turn: cp.turn, diff: cut(diff), from };
  }

  /**
    One read by a reader, in the turn's place: its review item and the "checking" verdict while it
    reads, a pseudo-turn Stop can abort, the read (quiet) and its verdict (parseFindings). A read
    that's stopped, fails or gives no verdict ends as an error on its item and leaves the session
    done with no verdict; null then, or "late" when the Reviewer didn't answer within its time (reviewMs).
    Otherwise the item as it ended, passed or blocked.
  */
  private async read(threadId: string, o: { ref: string; turn: number; round: number; prompt: string }): Promise<Extract<Item, { kind: "review" }> | "late" | null> {
    const store = this.store;
    const t = store.thread(threadId);
    const cwd = t.worktree?.path ?? store.project(t.projectId).path;
    const started = Date.now();
    const base: Extract<Item, { kind: "review" }> = { kind: "review", id: uid("it"), turn: o.turn, at: started, reviewer: o.ref, round: o.round, status: "running", findings: [] };
    store.putItem(threadId, base);
    store.patchThread(threadId, { status: "running", verdict: { state: "checking", round: o.round } });
    const abort = new AbortController();
    this.turns.set(threadId, { abort, started, turn: store.thread(threadId).turns });
    let found: ReturnType<typeof parseFindings> = null;
    let failed = "";
    let late = false;
    try {
      found = parseFindings(await this.quiet(threadId, o.ref, cwd, o.prompt, abort.signal, "reviewer", this.reviewMs));
      if (!found) failed = "The Reviewer didn't give a verdict.";
    } catch (e) {
      late = e instanceof QuietTimeout;
      failed = late ? `The Reviewer didn't answer in ${spanOf(this.reviewMs)}, so this change wasn't read.` : e instanceof Error ? e.message : String(e);
    } finally {
      this.turns.delete(threadId);
    }
    const seconds = (Date.now() - started) / 1000;
    // Stopped, even with a verdict in hand: no fix round follows it, so nothing may be left at "running".
    if (!found || abort.signal.aborted) {
      store.putItem(threadId, { ...base, status: "error", summary: abort.signal.aborted ? "You stopped the review." : failed, seconds });
      store.patchThread(threadId, { status: "done", verdict: undefined });
      return late && !abort.signal.aborted ? "late" : null;
    }
    const passed = found.verdict === "pass" && !found.findings.some((f) => f.severity === "blocking");
    return store.putItem(threadId, { ...base, status: passed ? "passed" : "blocked", findings: found.findings, summary: found.summary, seconds }) as Extract<Item, { kind: "review" }>;
  }

  /**
    Reviewer decides, for one step: the Reviewer's quickest model reads it with the ask and says
    ALLOW or ASK. Null when there's no Reviewer, or it gave no call within 40 seconds; you decide then.
  */
  private async stepCall(threadId: string, req: { title: string; fields: { label: string; value: string }[]; risk: Risk }, signal: AbortSignal) {
    const t = this.store.thread(threadId);
    const reviewer = this.reviewerFor(t, true);
    if (!reviewer) return null;
    const model = quickOf(reviewer, this.providerInfo);
    const ask = this.store.timeline(threadId).findLast((x) => x.kind === "user");
    const cwd = t.worktree?.path ?? this.store.project(t.projectId).path;
    const out = await this.quiet(threadId, model, cwd, stepPrompt(ask?.kind === "user" ? ask.text : "", req, cwd), AbortSignal.any([signal, AbortSignal.timeout(40_000)]), "reviewer").catch(() => "");
    const call = parseStep(out);
    return call && { ...call, model };
  }

  /**
    Who reads a turn's change: your pick, else the best reader of another maker than those who wrote
    it, the lead and a pair's sidekick (reviewerOf), never one of them; nobody when the Reviewer is off
    for the session (reviewOn). `always`: the Reviewer deciding single steps (Reviewer decides access),
    which needs one even then.
  */
  reviewerFor(t: Thread, always = false): string | null {
    if (!always && !reviewOn(t, this.store.settings)) return null;
    const r = this.resolve(t);
    return reviewerOf([`${r.provider}:${r.model}`, ...(isPair(t) ? [t.sidekick!] : [])], this.providerInfo, this.store.settings.picks);
  }

  /** Who an id is, as you'd say it: one of your agents by name, a model by its label ("GPT-6-Luna"). */
  nameOf(t: Thread, id: string) {
    if (!id.startsWith("@") && this.store.agents.some((a) => a.id === id)) return this.store.agent(id).name;
    const r = this.resolve(t, id);
    return this.labelOf(`${r.provider}:${r.model}`);
  }

  /**
    The model that writes the small things (commit messages, pull request text): Claude Code's
    quickest model when it's ready, else the session's own.
  */
  writerFor(t: Thread) {
    const claude = this.providerInfo.find((p) => p.id === "claude" && p.available);
    const quick = claude?.models.find((m) => /haiku/i.test(m.id) && !m.legacy);
    if (quick) return `claude:${quick.id}`;
    const r = this.resolve(t);
    return `${r.provider}:${r.model}`;
  }

  /** A one-off read by another model, outside the session's own conversation; its usage is logged under `as`. */
  async quiet(threadId: string, ref: string, cwd: string, prompt: string, signal: AbortSignal, as = "reviewer", limitMs = READ_MS): Promise<string> {
    const { provider, model } = splitModel(ref);
    // A model whose tool is gone (an account or an endpoint you removed) doesn't quietly become the Demo.
    const p = providers[provider];
    if (!p) throw new Error(toolGone(this.labelOf(ref), "Pick another Reviewer in Settings, or another model for this session."));
    const session = p.open({ cwd, model, effort: "medium", access: "read", soul: "", guard: true, ephemeral: true, env: this.envFor(provider) });
    let text = "";
    // Its own tokens and cost, apart from the thread's, so reads side by side don't count each other's.
    const own = emptyUsage();
    // A read in place of a turn (a review) is the tool at work: the watchdog hears it, not the lead's silence.
    const heard = () => {
      const live = this.turns.get(threadId);
      if (live) Object.assign(live, { heard: Date.now(), quiet: false });
    };
    const sink: TurnSink = {
      text: (d) => void ((text += d), heard()),
      reasoning: heard,
      tool: heard,
      heard,
      plan: () => {},
      approve: async () => ({ allow: false, reason: "Reviewers only read." }),
      ask: async () => null,
      propose: async () => ({ approve: false }),
      usage: (u, total) => {
        const t = this.store.thread(threadId);
        const cur = { ...emptyUsage(), ...t.usage };
        for (const k of ["inputTokens", "outputTokens", "cacheReadTokens", "costUsd"] as const) {
          if (u[k] === undefined) continue;
          const add = total ? (u[k] as number) - own[k] : (u[k] as number);
          own[k] += add;
          cur[k] += add;
        }
        this.store.patchThread(threadId, { usage: cur });
        this.holdToCap(threadId);
      },
      session: () => {},
      notice: () => {},
      error: (m) => void (text += `\n${m}`),
      limited: (m) => void (text += `\n${m}`),
    };
    const started = Date.now();
    // A model that never answers can't hold a read for good: at the limit it's given up, as Stop gives it up, even when
    // its tool doesn't hear the abort (closing the session below ends what's left of it).
    const late = new AbortController();
    const timer = setTimeout(() => late.abort(), limitMs);
    const both = AbortSignal.any([signal, late.signal]);
    const gaveUp = new Promise<never>((_, no) => (both.aborted ? no(new Error("stopped")) : both.addEventListener("abort", () => no(new Error("stopped")), { once: true })));
    gaveUp.catch(() => {});
    try {
      const turn = session.turn(prompt, sink, both);
      turn.catch(() => {});
      await Promise.race([turn, gaveUp]);
    } catch (e) {
      if (late.signal.aborted && !signal.aborted) throw new QuietTimeout(limitMs);
      throw e;
    } finally {
      clearTimeout(timer);
      session.close();
      const t = this.store.thread(threadId);
      this.store.logUsage({ at: Date.now(), threadId, projectId: t.projectId, agent: as, provider, model, inputTokens: own.inputTokens, outputTokens: own.outputTokens, cacheReadTokens: own.cacheReadTokens, costUsd: own.costUsd, seconds: (Date.now() - started) / 1000 });
    }
    return text;
  }

  /**
    Just a model, for an app (access.ai): its prompt in, text out, with no tools, files or agent.
    An endpoint's model is asked straight over HTTP; Claude Code's with everything of its own off,
    in an empty folder. Any other can't be asked this way (plainWay), and says so. Its use is
    logged under the app (`as`, "addon:<id>"), with no session.
  */
  async plain(ref: string, o: { prompt: string; system?: string; signal: AbortSignal; onText?: (t: string) => void; as: string }): Promise<string> {
    const { provider, model } = splitModel(ref);
    const way = plainWay(provider, this.store.settings);
    const name = this.labelOf(ref);
    if (!way || !providers[provider]) throw new Error(`${name} can't answer an app: it runs through a tool that brings tools of its own. Pick a Claude Code model or one of your API endpoints'.`);
    const ready = this.providerInfo.find((p) => p.id === provider);
    if (ready && !ready.available) throw new Error(`${name} isn't ready on this Mac right now. Pick another model.`);
    const system = [PLAIN_SOUL, o.system?.trim()].filter(Boolean).join("\n\n");
    const started = Date.now();
    const own = emptyUsage();
    const log = () => this.store.logUsage({ at: Date.now(), threadId: "", projectId: "", agent: o.as, provider, model, inputTokens: own.inputTokens, outputTokens: own.outputTokens, cacheReadTokens: own.cacheReadTokens, costUsd: own.costUsd, seconds: (Date.now() - started) / 1000 });
    if (way.kind === "http") {
      try {
        const r = await askEndpoint(way.endpoint, this.keys.get(endpointKey(way.endpoint.id)), model, { system, prompt: o.prompt, signal: o.signal, onText: o.onText });
        own.inputTokens = r.inputTokens;
        own.outputTokens = r.outputTokens;
        return r.text;
      } finally {
        log();
      }
    }
    // An empty folder of its own: nothing to read even if a tool turned up.
    const cwd = join(this.store.home, "addons", ".ask");
    mkdirSync(cwd, { recursive: true });
    const session = providers[provider].open({ cwd, model, effort: "low", access: "read", soul: system, guard: true, ephemeral: true, plain: true, env: this.envFor(provider) });
    let text = "";
    let failed = "";
    const sink: TurnSink = {
      text: (d) => {
        text += d;
        o.onText?.(d);
      },
      reasoning: () => {},
      tool: () => {},
      plan: () => {},
      approve: async () => ({ allow: false, reason: "You have no tools here: answer from what you were given." }),
      ask: async () => null,
      propose: async () => ({ approve: false }),
      usage: (u, total) => {
        for (const k of ["inputTokens", "outputTokens", "cacheReadTokens", "costUsd"] as const) if (u[k] !== undefined) own[k] = total ? (u[k] as number) : own[k] + (u[k] as number);
      },
      session: () => {},
      notice: () => {},
      error: (m) => void (failed = m),
      limited: (m) => void (failed = m),
    };
    try {
      // A prompt that starts with "/" would run one of Claude Code's commands (/context answers
      // with what it knows of this Mac): a zero-width space ahead of it keeps it just words.
      await session.turn(/^\s*\//.test(o.prompt) ? `\u200b${o.prompt}` : o.prompt, sink, o.signal);
    } finally {
      session.close();
      log();
    }
    if (o.signal.aborted) throw new Error("Stopped.");
    if (!text.trim() && failed) throw new Error(failed);
    return text;
  }

  /**
    A turn's own use, as its sink added it up. Not the thread's totals before and after: a Reviewer
    deciding a step mid-turn adds to those too, and is logged on its own already (quiet).
  */
  private logUsage(t: Thread, agentId: string, spent: Usage, seconds: number) {
    const r = this.resolve(t, agentId);
    this.store.logUsage({ at: Date.now(), threadId: t.id, projectId: t.projectId, agent: agentId, provider: r.provider, model: r.model, inputTokens: spent.inputTokens, outputTokens: spent.outputTokens, cacheReadTokens: spent.cacheReadTokens, costUsd: spent.costUsd, seconds });
  }

  /** Files from finished turns that are neither committed nor undone. */
  toReview(threadId: string) {
    const pending = new Set<string>();
    for (const it of this.store.timeline(threadId)) if (it.kind === "checkpoint" && !it.reverted && !it.committed) for (const f of it.files) pending.add(f.path);
    return pending.size;
  }

  /** The agents a session sent that still work, kept on the session (agentsAtWork) as one starts or ends, and at a turn's end. */
  private countAgents(threadId: string) {
    const t = this.store.threads.find((x) => x.id === threadId);
    if (!t) return;
    const n = this.store.timeline(threadId).filter((x) => x.kind === "tool" && x.agent && agentState(x) === "running").length;
    if ((t.agentsAtWork ?? 0) !== n) this.store.patchThread(threadId, { agentsAtWork: n || undefined });
  }

  /**
    A thread's access level changed. A turn under way is held to it at once: each live session of the thread takes it now
    (Liner Code's own answers read it from then on, and the tool's mode follows). One that can't be held to a lower level
    part-way, or has no way to take one, has its turn stopped with a line saying why; the next turn starts at the new level.
    A higher level never stops a turn.
  */
  async accessChanged(threadId: string, was: Access) {
    const t = this.store.thread(threadId);
    const now = t.access;
    if (now === was || !this.turns.get(threadId)) return;
    for (const [key, l] of [...this.live]) {
      if (key.slice(0, key.indexOf(":")) !== threadId) continue;
      const took = l.session.setAccess ? await l.session.setAccess(now).catch(() => false) : rank(now) >= rank(was);
      if (took === true || !this.turns.get(threadId)) continue;
      // The level that stopped it, and only what happened: by the time the tool answered, the level may have moved on again.
      const level = ACCESS_WORDS[now];
      const why = typeof took === "string" ? `: ${took}` : "";
      // Nothing about the next turn: the level may change again before it (a quick drop and raise), and that turn says its own.
      this.store.putItem(threadId, { kind: "notice", id: uid("it"), turn: t.turns, at: Date.now(), text: `Access went down to ${level} during this turn, which ${this.providerInfo.find((p) => p.id === l.provider)?.label ?? l.provider} can't be held to part-way${why}, so Liner Code stopped the turn.` });
      // Liner Code stopped it, not you: the turn doesn't say you did.
      this.levelStops.add(threadId);
      this.stop(threadId);
      return;
    }
  }

  stop(threadId: string) {
    // Nothing asked between Stop and the turn's end goes ahead on "don't ask again this turn".
    this.turnGrants.delete(threadId);
    if (this.busy.has(threadId)) this.halted.add(threadId);
    this.turns.get(threadId)?.abort.abort();
    this.prStops.get(threadId)?.abort();
  }

  /**
    Stops one agent a model sent off, from its row; the turn goes on without it (the model is told
    it was stopped). Asks the session at work, then any of the thread's, since one in the
    background outlives its turn.
  */
  async stopAgent(threadId: string, itemId: string) {
    const it = this.store.item(threadId, itemId);
    if (it.kind !== "tool" || !it.agent?.taskId || agentState(it) !== "running") return false;
    // The sidekick, from its row: it alone stops, and the lead hears how far it got.
    const brief = this.briefs.get(threadId);
    if (brief?.taskId === it.agent.taskId) {
      brief.by ??= "row";
      brief.abort.abort();
      return true;
    }
    // One waiting in line behind it: it's cancelled alone, and never starts.
    const waiting = this.lined.get(it.agent.taskId);
    if (waiting?.threadId === threadId) {
      waiting.stop.abort();
      return true;
    }
    const sessions = new Set([this.turns.get(threadId)?.session, ...[...this.live].filter(([k]) => k.startsWith(`${threadId}:`)).map(([, l]) => l.session)]);
    for (const s of sessions) if (s?.stopAgent && (await s.stopAgent(it.agent.taskId))) return true;
    return false;
  }

  /** A word for one agent at work, from its row, where its tool takes one (AgentRun.steerable). */
  async steerAgent(threadId: string, itemId: string, text: string) {
    const it = this.store.item(threadId, itemId);
    if (it.kind !== "tool" || !it.agent?.taskId || !it.agent.steerable || agentState(it) !== "running" || !text.trim()) return false;
    // A word for the sidekick goes to its own session, where its tool takes one.
    const brief = this.briefs.get(threadId);
    if (brief?.taskId === it.agent.taskId) return Boolean(await brief.session?.steer?.(text.trim()));
    const sessions = new Set([this.turns.get(threadId)?.session, ...[...this.live].filter(([k]) => k.startsWith(`${threadId}:`)).map(([, l]) => l.session)]);
    for (const s of sessions) if (s?.steerAgent && (await s.steerAgent(it.agent.taskId, text.trim()))) return true;
    return false;
  }

  /** A pair: a session with a sidekick, and Liner Code's tools to hand it work through. Never a side chat, which only reads. */
  pairOf(t: Thread) {
    return isPair(t) && Boolean(this.tools);
  }

  /**
    The lead's `sidekick` call (agent-tools.ts): the brief runs as one turn of the sidekick's own
    session (runBrief), one brief at a time in a thread, and the lead reads back how it went
    (sidekickResult). Only in the lead's own running turn, which waits on the call: Stop stops the
    brief too, waiting or at work, and so does the turn ending, since nothing would read it then, and
    so does `gone`: the lead's tool cancelling the call (it gave up on it), or its MCP server going away.
  */
  async delegate(threadId: string, args: Record<string, unknown>, gone?: AbortSignal): Promise<{ text: string; isError?: boolean }> {
    const t = this.store.threads.find((x) => x.id === threadId);
    if (!t || !this.pairOf(t)) return { text: "This session has no sidekick, so there's no one to hand this to. Do it yourself.", isError: true };
    const lead = this.turns.get(threadId);
    if (!lead || lead.agentId !== t.agent || lead.abort.signal.aborted) return { text: "The sidekick only takes a brief while you work a turn of this session, and none is running now.", isError: true };
    const brief = String(args.brief ?? "").trim();
    if (!brief) return { text: "Write the brief: the goal, the constraints and how to tell it's done.", isError: true };
    const doneWhen = String(args.done_when ?? "").trim() || undefined;
    // The lead's tool gives up on this call after its wait: Liner Code's (LINER_WAIT_SEC), which it sets in Claude Code, Codex
    // and OpenCode, or less where it can't (Hermes takes its limit from your config, which stays yours). The brief ends in time
    // for the answer to reach it, counted from now, since the call's wait has begun, in line or not: one that waited behind
    // others gets what's left of it, so the lead never gives up on a brief that then goes on writing beside it.
    const { provider } = this.resolve(t);
    const wait = providers[provider]?.toolWait?.(this.envFor(provider));
    const by = Date.now() + briefCap(wait && wait > 0 ? wait : this.linerWaitMs, Infinity);
    const row = await this.sidekickRow(threadId, lead, brief);
    const stop = new AbortController();
    this.lined.set(row.taskId, { threadId, stop });
    const end = () => stop.abort();
    lead.abort.signal.addEventListener("abort", end, { once: true });
    if (gone?.aborted) stop.abort();
    else gone?.addEventListener("abort", end, { once: true });
    (lead.ends ??= new Set()).add(end);
    // Its own end, for the lead's turn to wait on once it has stopped it.
    let wound = () => {};
    const winding = new Promise<void>((r) => (wound = r));
    (lead.winding ??= new Set()).add(winding);
    // One brief at a time: this one goes when those before it have ended (T3 Code queues a thread's
    // runs behind the one at work: apps/server/src/orchestration-v2/, its per-thread command queue).
    const waits = this.briefLine.has(threadId);
    const before = this.briefLine.get(threadId) ?? Promise.resolve();
    let release = () => {};
    const mine = new Promise<void>((r) => (release = r));
    const line = before.then(() => mine);
    this.briefLine.set(threadId, line);
    // Waiting in line ends when the time this call has left gets too short for a brief (BRIEF_MIN_MS): then none starts.
    let late: NodeJS.Timeout | undefined;
    try {
      if (waits) row.paint({ state: "running", now: "Waiting for the brief before this one" }, true);
      if (!stop.signal.aborted) await Promise.race([before, new Promise((r) => stop.signal.addEventListener("abort", r, { once: true })), new Promise((r) => (late = setTimeout(r, Math.max(0, by - this.briefMinMs - Date.now()))))]);
      // The sidekick may have been taken off the session while this brief waited (runBrief runs the one it has now).
      const now = this.store.threads.find((x) => x.id === threadId);
      if (!now?.sidekick || !this.pairOf(now)) {
        row.paint({ name: "Sidekick", task: taskOf(brief), brief, state: "stopped", now: undefined, report: "This session has no sidekick now.", files: [] }, true, "failed");
        return { text: "This session has no sidekick now (it was taken off while this brief waited), so nothing was done. Do it yourself.", isError: true };
      }
      const left = by - Date.now();
      if (left < this.briefMinMs && !stop.signal.aborted) {
        row.paint({ name: "Sidekick", task: taskOf(brief), brief, model: now.sidekick, state: "stopped", now: undefined, report: "No time was left for it.", files: [] }, true, "failed");
        return { text: "Your tool gives up on a call to Liner Code's tools sooner than this brief could run (or the briefs before it used that time up), so the sidekick didn't start on it: nothing was done. Do it yourself, or call it again with a smaller brief.", isError: true };
      }
      // The usual cap, or the time this call has left when that's less: the lead is then told the cap that held.
      const capMs = left < this.sidekickMs ? left : undefined;
      const out = await this.runBrief(threadId, lead.turn, row, { brief, doneWhen, fresh: args.fresh === true, ...(capMs === undefined ? {} : { capMs }) }, stop.signal);
      return { text: sidekickResult(out), isError: out.how === "failed" };
    } finally {
      clearTimeout(late);
      gone?.removeEventListener("abort", end);
      lead.abort.signal.removeEventListener("abort", end);
      lead.ends?.delete(end);
      lead.winding?.delete(winding);
      wound();
      this.lined.delete(row.taskId);
      release();
      if (this.briefLine.get(threadId) === line) this.briefLine.delete(threadId);
    }
  }

  /**
    The row a brief shows on: the one the lead's tool made for its call, which the sink saw begin in
    this turn (the one with this brief when there are two). A tool that shows no such row within a
    few seconds gets one of Liner Code's own, which the brief ends itself.
  */
  private async sidekickRow(threadId: string, lead: Turn, brief: string) {
    const store = this.store;
    let id: string | undefined;
    for (const end = Date.now() + 3000; !id; ) {
      // Not one whose call already ended (a call refused before it): its row says so.
      const ended = (id: string) => store.timeline(threadId).some((x) => x.id === id && x.kind === "tool" && x.status !== "running");
      const free = (this.sideRows.get(threadId) ?? []).filter((r) => !r.taken && !ended(r.id));
      const r = free.find((x) => x.input === brief) ?? free.find((x) => !x.input) ?? free[0];
      if (r) {
        r.taken = true;
        id = r.id;
      } else if (Date.now() > end || lead.abort.signal.aborted) break;
      else await new Promise((ok) => setTimeout(ok, 50));
    }
    const own = !id;
    const rowId = id ?? uid("it");
    const taskId = `sidekick:${rowId}`;
    const started = Date.now();
    if (own) store.putItem(threadId, { kind: "tool", id: rowId, turn: lead.turn, at: started, tool: "liner.sidekick", toolKind: "task", title: sidekickTitle(brief), input: brief, status: "running", agent: { name: "Sidekick", task: taskOf(brief), brief, taskId } });
    /** Puts what it does on the row; `end` ends a row of Liner Code's own, which no tool will. */
    const paint = (a: Partial<AgentRun>, save: boolean, end?: "done" | "failed") => {
      const it = store.timeline(threadId).find((x) => x.id === rowId);
      // Its row is gone (the turn was rewound): nothing to show it on.
      if (it?.kind !== "tool") return;
      const next: Extract<Item, { kind: "tool" }> = { ...it, toolKind: "task", agent: { ...it.agent, name: "Sidekick", ...a, taskId }, ...(own && end ? { status: end, seconds: (Date.now() - started) / 1000 } : {}) };
      store.putItem(threadId, next, save);
      if (agentState(it) !== agentState(next)) this.countAgents(threadId);
    };
    return { id: rowId, taskId, paint };
  }

  /**
    One brief, as one turn of the sidekick's own session in the session's folder, which it keeps
    from brief to brief (and across a restart) in Thread.sessions under "@<its ref>". It works under
    the session's access, with no agents of its own; its requests are the same cards as the lead's,
    its questions get NOBODY, its use counts in the session's (so the spending cap stops it) and is
    logged as "sidekick", the watchdog hears it, and it's stopped at the cap. Its change is measured
    from snapshots before and after. It needs no turn of the lead's, only `stop`: what the lead reads
    of it is the caller's (delegate).
  */
  private async runBrief(threadId: string, turn: number, row: { id: string; taskId: string; paint: (a: Partial<AgentRun>, save: boolean, end?: "done" | "failed") => void }, b: { brief: string; doneWhen?: string; fresh: boolean; capMs?: number }, stop: AbortSignal): Promise<BriefOutcome> {
    const store = this.store;
    const t = store.thread(threadId);
    const ref = t.sidekick!;
    const agentId = `@${ref}`;
    const liveKey = `${liveKeyOf(threadId, agentId)}#sidekick`;
    const { provider, model } = splitModel(ref);
    const who = this.labelOf(ref);
    const cwd = t.worktree?.path ?? store.project(t.projectId).path;
    const started = Date.now();
    // Stopped while it waited in line: it never starts, and the brief at work (if any) stays the one at work.
    if (stop.aborted) {
      row.paint({ name: "Sidekick", task: taskOf(b.brief), brief: b.brief, model: ref, state: "stopped", now: undefined, report: "Stopped before it started.", files: [] }, true, "failed");
      return { how: "stopped", who, seconds: 0, report: "", files: [], unstarted: true };
    }
    const abort = new AbortController();
    const brief: Brief = { abort, row: row.id, taskId: row.taskId };
    const onStop = () => abort.abort();
    if (stop.aborted) abort.abort();
    else stop.addEventListener("abort", onStop, { once: true });
    // Its cap: delegate's, when the lead's tool waits less than the usual one on a call.
    const cap = setTimeout(() => ((brief.by ??= "cap"), abort.abort()), b.capMs ?? this.sidekickMs);
    this.briefs.set(threadId, brief);
    const run: AgentRun = { name: "Sidekick", task: taskOf(b.brief), brief: b.brief, model: ref, steps: [], tools: 0, tokens: 0, state: "running", now: "Starting" };
    row.paint(run, true);
    const steps: AgentStep[] = [];
    const keys = new Map<string, number>();
    /** What it said, in stretches between its steps: the last is its report. */
    const said: string[] = [""];
    const spent = emptyUsage();
    let problem: string | undefined;
    let limited: string | undefined;
    let from: string | null = null;
    let git = false;
    /** What it changed, measured; null when the folder couldn't be snapshotted. */
    let files: FileChange[] | null | undefined;
    /** Whether its turn was sent: one stopped before that did nothing at all. */
    let began = false;
    /** The agent it tried to send of its own, by its task, which stopped the brief. */
    let sentAgent: string | undefined;
    // Its approvals go through the lead's rules and cards (the same access, the same "don't ask again").
    const cards = this.sink(threadId, turn, abort.signal, agentId);
    let session: ProviderSession | undefined;
    const heard = () => {
      const live = this.turns.get(threadId);
      if (live) Object.assign(live, { heard: Date.now(), quiet: false });
    };
    const show = (save = false) => row.paint({ ...run, steps: steps.slice(-40) }, save);
    const sink: TurnSink = {
      text: (d) => {
        heard();
        if (!said[said.length - 1] && d.trim() && steps.length) {
          run.now = "Writing its report";
          show();
        }
        said[said.length - 1] += d;
      },
      reasoning: () => heard(),
      tool: (u) => {
        heard();
        // A sidekick sends no agents of its own. Claude Code's and Codex's can't, and OpenCode's subagents are off, so this
        // only fires where a tool gives no way to switch it off for one process: Hermes always offers delegate_task, and
        // turning it off would mean writing your Hermes config. The first sign of one stops the brief, and with its turn
        // the whole tree (Hermes halts its children with it); what it did so far is measured and the lead is told why.
        if (u.agent) {
          if (brief.by || abort.signal.aborted) return;
          brief.by = "agent";
          sentAgent = u.agent.task || u.agent.name;
          steps.push({ title: `Stopped: it tried to send an agent of its own (${sentAgent})`, toolKind: "task", status: "failed" });
          run.now = undefined;
          show(true);
          abort.abort();
          return;
        }
        const step: AgentStep = { title: u.title || u.tool, toolKind: u.toolKind, status: u.status === "stopped" ? "failed" : u.status, ...(u.path ? { path: u.path } : {}) };
        const at = keys.get(u.key);
        if (at === undefined) {
          keys.set(u.key, steps.length);
          steps.push(step);
          run.tools = (run.tools ?? 0) + 1;
          if (said[said.length - 1].trim()) said.push("");
        } else steps[at] = step;
        if (u.status === "running") run.now = step.title;
        show();
      },
      plan: () => heard(),
      approve: (req, sig) => cards.api.approve(req, sig),
      // Nobody can answer it: each question gets the same words, and it carries on.
      ask: async (questions) => {
        heard();
        for (const q of questions) steps.push({ title: `Asked: ${q.question.slice(0, 80)} (nobody could answer)`, toolKind: "think", status: "done" });
        show();
        return Object.fromEntries(questions.map((q) => [q.question, NOBODY]));
      },
      propose: async () => ({ approve: false, note: "Nobody approves plans in a brief: carry the brief out as it was written." }),
      usage: (u, total) => {
        heard();
        const now = store.thread(threadId);
        const cur = { ...emptyUsage(), ...now.usage };
        // Running totals add what's new since its last report, as the lead's sink does.
        const seen = (total && session && this.totals.get(session)) || {};
        for (const k of ["inputTokens", "outputTokens", "cacheReadTokens", "costUsd"] as const) {
          if (u[k] === undefined) continue;
          const add = total ? Math.max(0, (u[k] as number) - (seen[k] ?? 0)) : (u[k] as number);
          cur[k] += add;
          spent[k] += add;
        }
        if (total && session) this.totals.set(session, { ...seen, ...u });
        // Its context is its own, not the lead's: the session's context stays the lead's.
        store.patchThread(threadId, { usage: cur });
        run.tokens = spent.inputTokens + spent.outputTokens;
        show();
        this.holdToCap(threadId);
      },
      session: (id) => {
        const now = store.thread(threadId);
        const saved = `${provider}:${id}`;
        if (now.sessions?.[agentId] !== saved) store.patchThread(threadId, { sessions: { ...now.sessions, [agentId]: saved } });
      },
      notice: () => heard(),
      heard,
      error: (m) => void (problem = m),
      window: (w) => store.onWindow?.(provider, w),
      limited: (m, until) => {
        limited = m;
        this.limitedUntil.set(provider, until ?? Date.now() + LIMIT_UNKNOWN_MS);
      },
    };
    try {
      if (abort.signal.aborted) throw new Error("stopped");
      // A model whose tool is gone doesn't quietly become another.
      if (!providers[provider]) throw new Error(toolGone(this.labelOf(ref), "Pick another sidekick for this session."));
      if (!existsSync(cwd)) throw new Error(`this session's folder isn't there any more: ${cwd}`);
      if (b.fresh) {
        this.drop(liveKey);
        const { [agentId]: _, ...rest } = store.thread(threadId).sessions ?? {};
        store.patchThread(threadId, { sessions: Object.keys(rest).length ? rest : undefined });
      }
      git = await isRepo(cwd);
      const tag = `${threadId}/${turn}-${uid("sk")}`;
      from = git ? await capture(cwd, `${tag}-before`) : null;
      ({ session } = await this.session(store.thread(threadId), agentId, cwd, true));
      brief.session = session;
      run.steerable = Boolean(session.steer);
      if (abort.signal.aborted) throw new Error("stopped");
      const prompt = briefPrompt(b.brief, b.doneWhen);
      began = true;
      try {
        await session.turn(prompt, sink, abort.signal);
      } catch (e) {
        // Its session from before is gone: the tool opened a new one, and the brief is all it needs.
        if (!(e instanceof ResumeFailed) || abort.signal.aborted) throw e;
        await session.turn(prompt, sink, abort.signal);
      }
      if (git && from) {
        const to = await capture(cwd, `${tag}-after`);
        files = to ? await changes(cwd, from, to, { turn: true }) : null;
      }
    } catch (e) {
      if (!abort.signal.aborted) {
        problem = e instanceof Error ? e.message : String(e);
        // A session that broke is opened afresh for the next brief.
        this.drop(liveKey);
      }
    } finally {
      clearTimeout(cap);
      stop.removeEventListener("abort", onStop);
      if (this.briefs.get(threadId) === brief) this.briefs.delete(threadId);
      // A card it was waiting on expires with it.
      cards.end();
    }
    const unstarted = !began && abort.signal.aborted;
    // Stopped or failed before its after snapshot: what it changed so far is measured now.
    if (unstarted) files = [];
    else if (files === undefined && git && from) {
      const to = await capture(cwd, `${threadId}/${turn}-${uid("sk")}-after`).catch(() => null);
      files = to ? await changes(cwd, from, to, { turn: true }).catch(() => null) : null;
    }
    const seconds = (Date.now() - started) / 1000;
    const how: BriefOutcome["how"] = brief.by === "cap" ? "capped" : brief.by === "agent" ? "agent" : brief.by === "replaced" ? "replaced" : abort.signal.aborted ? "stopped" : limited ? "limited" : problem ? "failed" : "done";
    const report = said.filter((x) => x.trim()).at(-1)?.trim() ?? "";
    store.logUsage({ at: Date.now(), threadId, projectId: t.projectId, agent: "sidekick", provider, model, inputTokens: spent.inputTokens, outputTokens: spent.outputTokens, cacheReadTokens: spent.cacheReadTokens, costUsd: spent.costUsd, seconds });
    for (const s of steps) if (s.status === "running") s.status = how === "done" ? "done" : "failed";
    const state = how === "done" ? "done" : how === "failed" || how === "limited" ? "failed" : "stopped";
    row.paint({ ...run, steps: steps.slice(-40), state, now: undefined, report: unstarted ? "Stopped before it started." : report || (how === "failed" ? problem : how === "agent" ? "Stopped: a sidekick may not send agents of its own." : limited) || undefined, files: files ?? undefined }, true, how === "done" ? "done" : "failed");
    return { how, who, seconds, report, files: files ?? null, problem: how === "limited" ? limited : problem, ...(b.capMs === undefined ? {} : { capMs: b.capMs }), ...(unstarted ? { unstarted: true } : {}), ...(sentAgent ? { agent: sentAgent } : {}) };
  }

  /**
    The spending cap (Settings › General): a session, or a routine run's, that has spent its cap
    stops where it is and says so; your next message lets it go on for another cap's worth.
  */
  private holdToCap(threadId: string) {
    const cap = this.store.settings.capUsd ?? 0;
    const t = this.store.thread(threadId);
    const turn = this.turns.get(threadId);
    if (!cap || !turn || turn.abort.signal.aborted || t.usage.costUsd < (t.spendLimit ?? cap)) return;
    this.store.putItem(threadId, { kind: "notice", id: uid("it"), turn: t.turns, at: Date.now(), text: `Stopped: this session has spent $${t.usage.costUsd.toFixed(2)}, past its $${(t.spendLimit ?? cap).toFixed(2)} cap. Send a message to go on.` });
    this.store.emit({ type: "notify", threadId, kind: "waiting", title: "A session reached its spending cap", body: `${t.title}: $${t.usage.costUsd.toFixed(2)} spent` });
    this.stop(threadId);
  }

  /** `grant`: what "don't ask again" you chose with a yes (`always` is the rule's, as older windows send it). */
  answer(threadId: string, itemId: string, allow: boolean, reason?: string, always?: boolean, scope?: "all" | "project", grant?: GrantKind | "turn") {
    const item = this.store.item(threadId, itemId);
    if (item.kind !== "approval") throw new Error("That isn't a request.");
    const waiter = this.approvals.get(itemId);
    if (!waiter) {
      if (item.state === "asking") this.store.putItem(threadId, { ...item, state: "expired" });
      throw new Error("The agent stopped waiting for this answer.");
    }
    this.approvals.delete(itemId);
    // Judged by the level as it is now: a card asked at Ask and allowed once the session went to Read only is refused, as Read
    // only would have refused it outright (readForbids), with one line saying so.
    const t = this.store.thread(threadId);
    const opened = this.cardLevel.get(itemId);
    if (allow && opened && opened !== "read" && t.access === "read" && !t.sideOf && readForbids(item)) {
      const why = READ_REFUSED(item.fields.some((f) => f.label === "Command"));
      this.store.putItem(threadId, { ...item, state: "denied", reason: "The session went to Read only.", answeredAt: Date.now() });
      this.store.putItem(threadId, { kind: "notice", id: uid("it"), turn: item.turn, at: Date.now(), text: `Access went to Read only while “${item.title}” waited for you, so Liner Code refused it.` });
      this.settleWaiting(threadId);
      return waiter.resolve({ allow: false, reason: why, level: true });
    }
    const chosen = grant ?? (always ? "rule" : undefined);
    // Said on the item only when it was really taken, so a step that later ran with no card traces back to this yes.
    const granted = allow && chosen ? this.grant(threadId, item, chosen) : undefined;
    this.store.putItem(threadId, { ...item, state: allow ? "approved" : "denied", reason, answeredAt: Date.now(), ...(granted ? { granted } : {}), ...(item.addon && scope ? { addon: { ...item.addon, scope } } : {}) });
    this.settleWaiting(threadId);
    waiter.resolve({ allow, reason, scope });
  }

  answerQuestion(threadId: string, itemId: string, answers?: Record<string, string>) {
    const item = this.store.item(threadId, itemId);
    if (item.kind !== "question") throw new Error("That isn't a question.");
    // A double click, or a second window: it's been answered.
    if (item.state === "answered" || item.state === "skipped") return;
    const waiter = this.questions.get(itemId);
    this.questions.delete(itemId);
    this.store.putItem(threadId, { ...item, state: answers ? "answered" : "skipped", answers, answeredAt: Date.now() });
    this.settleWaiting(threadId);
    if (waiter) waiter.resolve(answers ?? null);
    // Asked after its turn ended (an agent that can't wait): the answer goes as your next message.
    else if (answers) void this.send(threadId, Object.entries(answers).map(([q, a]) => `${q}\n${a}`).join("\n\n"));
    // Skipped: nothing waits on you any more, so the session isn't left in Needs you.
    else if (!this.isRunning(threadId) && !this.store.timeline(threadId).some((x) => (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking")) {
      if (this.store.thread(threadId).status === "waiting") this.store.patchThread(threadId, { status: "done" });
      // What you queued waited on this question.
      if (!this.kept.has(threadId)) this.drain(threadId);
    }
  }

  answerProposal(threadId: string, itemId: string, approve: boolean, note?: string, edited?: string) {
    const original = this.store.item(threadId, itemId);
    if (original.kind !== "proposal") throw new Error("That isn't a plan.");
    if (original.state !== "asking") throw new Error("That plan was already answered.");
    // A plan is a tool's own, proposed inside its turn (Claude Code's plan mode): it waits there for you.
    const waiter = this.proposals.get(itemId);
    if (!waiter) {
      this.store.putItem(threadId, { ...original, state: "expired" });
      throw new Error("The agent stopped waiting for this plan. Ask for it again.");
    }
    this.proposals.delete(itemId);
    // You may have edited the steps before approving: the plan that runs is yours.
    const item = edited?.trim() ? { ...original, plan: edited.trim() } : original;
    this.store.putItem(threadId, { ...item, state: approve ? "approved" : "changed", note, answeredAt: Date.now() });
    // It carries on in its turn, now on Auto.
    if (approve) this.store.patchThread(threadId, { access: "auto" });
    this.settleWaiting(threadId);
    waiter.resolve({ approve, note, plan: approve && edited?.trim() ? edited.trim() : undefined });
  }

  /**
    Takes on what "don't ask again" you chose with a yes, only as the card offered it: what's offered is worked out again
    from the ask (its command, its folder) and has to say the same, so a grant is never wider than its label. None for
    what can't be undone, nor in a routine's step, whatever it's sent.
  */
  private grant(threadId: string, item: Extract<Item, { kind: "approval" }>, kind: GrantKind | "turn"): { kind: GrantKind | "turn"; label?: string } | undefined {
    if (item.risk === "high" || this.unattended.has(threadId) || item.addon) return;
    if (kind === "turn") {
      // Only where the card said it could be (`turnGrant`), for the turn the ask came in, while it runs.
      const live = this.turns.get(threadId);
      if (!item.turnGrant || !this.turnLevel(threadId) || !live || live.abort.signal.aborted || item.turn !== live.turn || item.tool === "permissions") return;
      this.turnGrants.set(threadId, live.turn);
      return { kind };
    }
    // Cards from before grants offer their rule alone.
    const offered = (item.grants ?? (item.rule ? [{ kind: "rule" as const, label: item.rule }] : [])).find((g) => g.kind === kind);
    if (!offered) return;
    const command = item.fields.find((f) => f.label === "Command")?.value;
    const t = this.store.thread(threadId);
    const cwd = t.worktree?.path ?? this.store.project(t.projectId).path;
    let next: Grant | undefined;
    if (kind === "rule") {
      if (command === undefined) next = { kind, label: offered.label, parts: [offered.label], tool: true };
      else {
        const parts = ruleParts(command);
        if (parts && parts.join(", ") === offered.label) next = { kind, label: offered.label, parts };
      }
    } else if (kind === "skill") {
      const skill = command !== undefined ? skillOffer(command, cwd) : undefined;
      if (skill && skill.label === offered.label) next = { kind, label: offered.label, parts: [skill.folder] };
    }
    if (!next) return;
    const all = (this.grants.get(threadId) ?? []).filter((g) => !(g.kind === next.kind && g.label === next.label));
    this.grants.set(threadId, [...all, next]);
    return { kind: next.kind, label: next.label };
  }

  /** What this session no longer asks about (approval.rules): its grants, and whether this turn goes ahead without asking. */
  grantsOf(threadId: string): { grants: ApprovalGrant[]; turn: boolean } {
    const live = this.turns.get(threadId);
    return { grants: (this.grants.get(threadId) ?? []).map(({ kind, label }) => ({ kind, label })), turn: Boolean(live && this.turnGrants.get(threadId) === live.turn) };
  }

  /** Takes a grant back (approval.forget); `turn` ends the turn's. */
  forget(threadId: string, kind: GrantKind | "turn", label: string) {
    if (kind === "turn") return void this.turnGrants.delete(threadId);
    this.grants.set(threadId, (this.grants.get(threadId) ?? []).filter((g) => !(g.kind === kind && g.label === label)));
  }

  /**
    Whether a command, or a tool by its rule, was allowed for the session: a command when every rule it needs was
    granted (ruleParts), a tool by its own name only, so a program named like a tool (`Edit`) never rides on it.
  */
  private ruleAllows(threadId: string, command: string | undefined, rule?: string) {
    const rules = (this.grants.get(threadId) ?? []).filter((g) => g.kind === "rule");
    if (command === undefined) return Boolean(rule && rules.some((g) => g.tool && g.parts[0] === rule));
    const needs = ruleParts(command);
    const granted = new Set(rules.filter((g) => !g.tool).flatMap((g) => g.parts));
    return Boolean(needs?.length && needs.every((r) => granted.has(r)));
  }

  /**
    Auto's own rule, the one function both Auto and "don't ask again this turn" go by. Auto passes the tool's own `unjudged`.
    The turn's grant passes true for every tool: it applies only at the levels below Auto (Manual, Edits on its own; see
    turnLevel), where it uses Liner Code's own Auto rule for a tool with no check of its own, whatever the tool is. At Auto
    and above it is neither offered nor taken nor applied, so a step a judging tool (Claude Code's own Auto, Codex) hands
    over at Auto can't go ahead on it. A tool's own edit goes ahead; a command when it only reads, or when nothing of the tool's
    own judged it (`unjudged`) and Liner Code's reading would run it: rated low, inside the project or a skill's script you
    allowed, none of the asks a low rating says too little about, no .env name, sending nothing out (risk.ts, routine,
    leavesMac). Never what can't be undone.
  */
  private autoLets(req: ApprovalRequest, command: string | undefined, cwd: string, skills: string[], unjudged: boolean) {
    if (req.risk === "high") return false;
    if (command === undefined) return EDIT_TOOLS.has(req.tool);
    if (namesSecret(command)) return false;
    return readsOnly(command) || (unjudged && routine(command, cwd, process.platform, { inside: skills }) && !leavesMac(command));
  }

  /**
    What "don't ask again this turn" lets go ahead (see approve): what Auto's rule would run for a tool with no safety check of
    its own (autoLets), narrowed in two places, never widened: a read-only command must also pass Auto's place check (routine),
    and an edit must name files, all in the project.
  */
  private turnCovers(req: ApprovalRequest, command: string | undefined, cwd: string, skills: string[]) {
    if (!this.autoLets(req, command, cwd, skills, true)) return false;
    // A read too only where Auto's place check passes: Auto lets any read-only command a tool hands over go ahead, which at
    // Manual is just the read outside the project the tool asked about (`cat ~/.ssh/id_rsa`). Never wider than Auto.
    if (command !== undefined) return routine(command, cwd, process.platform, { inside: skills }) && !leavesMac(command);
    const files = req.fields.filter((f) => f.label === "File").map((f) => resolve(cwd, f.value));
    const root = resolve(cwd);
    return files.length > 0 && files.every((f) => f === root || f.startsWith(root + sep));
  }

  /** The levels "don't ask again this turn" is for, as the session stands now: below Auto (Manual, Edits on its own). */
  private turnLevel(threadId: string) {
    const access = this.store.thread(threadId).access;
    return access === "ask" || access === "edits";
  }

  /** The skill folders you let Auto reach this session. */
  private reach(threadId: string) {
    return { skills: (this.grants.get(threadId) ?? []).filter((g) => g.kind === "skill").flatMap((g) => g.parts) };
  }

  /**
    What you asked in a session, for the Reviewer: your messages and the plans you approved, the
    last six, earliest first, with the one this change answers marked. With only the first ask, a
    later one ("add a Reset button") read as work nobody asked for.
  */
  private askOf(threadId: string) {
    const asks = this.store.timeline(threadId).flatMap((x) => (x.kind === "user" && !x.text.startsWith("/") ? [x.text.trim()] : x.kind === "proposal" && x.state === "approved" ? [`(a plan you approved) ${x.title}`] : [])).slice(-6);
    if (asks.length < 2) return asks[0] ?? this.store.thread(threadId).title;
    return asks.map((a, i) => `${i === asks.length - 1 ? "The latest ask, which this change is for" : `An earlier ask (${i + 1} of ${asks.length})`}:\n${a.slice(0, 1500)}`).join("\n\n");
  }

  /** Back to running once nothing in a running turn waits on you. */
  private settleWaiting(threadId: string) {
    this.clock(threadId);
    const still = this.store.timeline(threadId).some((x) => (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking");
    if (!still && this.turns.has(threadId)) this.store.patchThread(threadId, { status: "running" });
  }

  /**
    The running turn's clock stops while something waits on you (an ask, a question, a plan) and goes on when nothing
    does: its marker holds when the wait began (`waitingSince`) and what it waited in all (`waited`), which its
    `seconds` leave out. Called as each opens and as each is answered or expires.
  */
  private clock(threadId: string) {
    const live = this.turns.get(threadId);
    if (!live?.marker || !this.store.threads.some((x) => x.id === threadId)) return;
    const timeline = this.store.timeline(threadId);
    const m = timeline.find((x) => x.id === live.marker);
    if (m?.kind !== "turn" || m.status !== "running") return;
    const from = this.store.thread(threadId).sideFrom ?? 0;
    // What this turn itself waits on: an ask left open from an earlier one (the PR card's test run) doesn't stop its clock.
    const open = timeline.some((x) => x.turn === live.turn && x.turn > from && (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking");
    if (open && !m.waitingSince) this.store.putItem(threadId, { ...m, waitingSince: Date.now() }, false);
    else if (!open && m.waitingSince) {
      const { waitingSince, ...rest } = m;
      this.store.putItem(threadId, { ...rest, waited: (m.waited ?? 0) + Math.max(0, Date.now() - waitingSince) });
    }
  }

  /** You moved on with a new message: a question or a plan left open from an earlier turn is settled, so it doesn't hold this turn in Needs you. */
  private settleAsks(threadId: string) {
    const from = this.store.thread(threadId).sideFrom ?? 0;
    for (const x of this.store.timeline(threadId))
      if (x.turn > from && (x.kind === "question" || x.kind === "proposal") && x.state === "asking") this.store.putItem(threadId, { ...x, state: x.kind === "question" ? "skipped" : "expired" } as Item);
  }

  /** Resolves once nothing is in flight in a thread (a stopped turn has wound down), or after `ms`. `own`: holds of the caller's, which don't count. */
  async idle(threadId: string, ms = 10_000, own = 0) {
    const working = () => this.turns.has(threadId) || (this.busy.get(threadId) ?? 0) > own;
    for (const end = Date.now() + ms; working() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 50));
  }

  /** Closes a live session and forgets it, so its next turn opens it again (once this one has ended: ending). */
  private drop(key: string) {
    const l = this.live.get(key);
    this.live.delete(key);
    if (l) void this.ending(key.slice(0, key.indexOf(":")), [l.session]);
  }

  /**
    `cause`: what put the thread away while a turn worked ("You kept another take of this comparison"), said in one line with what
    was ended, and the turn isn't said to have been stopped by you. A delete needs none: the thread is gone.
  */
  closeThread(threadId: string, cause?: string) {
    const turn = this.turns.get(threadId);
    if (turn && cause && !turn.abort.signal.aborted) {
      const l = [...this.live.values()].find((x) => x.session === turn.session);
      const tool = l ? this.providerInfo.find((p) => p.id === l.provider)?.label ?? l.provider : "its tool";
      this.store.putItem(threadId, { kind: "notice", id: uid("it"), turn: turn.turn, at: Date.now(), text: `${cause}, so Liner Code stopped this turn and ended ${tool} and what it started.` });
      this.levelStops.add(threadId);
    }
    this.stop(threadId);
    const sessions: ProviderSession[] = [];
    for (const [key, l] of this.live) {
      if (!key.startsWith(`${threadId}:`)) continue;
      sessions.push(l.session);
      this.live.delete(key);
    }
    this.grants.delete(threadId);
    this.turnGrants.delete(threadId);
    this.toldOnce.delete(threadId);
    return this.ending(threadId, sessions);
  }

  /** The closes under way in each thread: none of its sessions opens until they're done (session). */
  private closing = new Map<string, Promise<void>>();
  /**
    The one way a thread's session ends, whatever replaces it: its close (ProviderSession.close), which ends its tool and
    everything marked as its own and checks they're gone (acp.ts close), kept in `closing` until then, so the thread's next
    session waits for it rather than starting beside what's still ending. Resolves when they're all gone.
  */
  private ending(threadId: string, sessions: ProviderSession[]) {
    if (!sessions.length) return this.closing.get(threadId) ?? Promise.resolve();
    const done = Promise.allSettled([this.closing.get(threadId), ...sessions.map((s) => s.close())]).then(() => undefined);
    this.closing.set(threadId, done);
    void done.then(() => this.closing.get(threadId) === done && this.closing.delete(threadId));
    return done;
  }

  /**
    A thread's settings changed: its tool or its model (to another tool's), its account, its pair's lead or sidekick, an agent of
    yours it runs as (agents.save), or the model it carries on with when one ran out (carryOn). Each live session of the thread
    they no longer name ends by the one close (ending) at once, rather than staying up beside the next one: a turn at work on it
    (the lead's, or a sidekick's brief) is stopped first, and the timeline says so in one line; the session it opens next waits
    for the close (session). One on the same tool that only goes under another name (a bare model's id changed) moves to that
    name, as it is, and takes the change in place as its next turn opens. (T3 Code: orchestration-v2/ProviderSwitchService.ts plans
    which provider sessions a new selection releases; there they go as the next message starts, here as the setting changes.)
  */
  async retool(threadId: string) {
    const t = this.store.threads.find((x) => x.id === threadId);
    if (!t) return;
    const lead = this.resolve(t);
    const leadKey = liveKeyOf(threadId, t.agent);
    const sideRef = this.pairOf(t) ? t.sidekick : undefined;
    const sideKey = sideRef ? `${liveKeyOf(threadId, `@${sideRef}`)}#sidekick` : undefined;
    const stale: { key: string; l: Live; side: boolean }[] = [];
    for (const [key, l] of this.live) {
      if (!key.startsWith(`${threadId}:`)) continue;
      const side = key.endsWith("#sidekick");
      if (side ? key === sideKey && l.provider === splitModel(sideRef!).provider : key === leadKey && l.provider === lead.provider) continue;
      // The lead on the same tool under its new name: moved, not ended.
      if (!side && l.provider === lead.provider && !this.live.has(leadKey) && !stale.some((x) => !x.side && x.l.provider === lead.provider)) {
        this.live.delete(key);
        this.live.set(leadKey, l);
        continue;
      }
      stale.push({ key, l, side });
    }
    if (!stale.length) return;
    for (const { key } of stale) this.live.delete(key);
    const label = (provider: string) => this.providerInfo.find((p) => p.id === provider)?.label ?? provider;
    // As the picker shows it: the tool, and its model unless that's the tool's own default ("Claude Code, Sonnet 5.5").
    const picked = (provider: string, model: string) => {
      const m = this.providerInfo.find((p) => p.id === provider)?.models.find((x) => x.id === model);
      return model === "default" || !model ? label(provider) : `${label(provider)}, ${m?.label ?? model}`;
    };
    const turn = this.turns.get(threadId);
    // A turn of the lead's on a tool it no longer runs on (or one still opening it), or a sidekick's brief on one it no longer is.
    const leadStale = stale.find((x) => !x.side);
    const leadBusy = turn && leadStale && (turn.session === leadStale.l.session || (!turn.session && turn.agentId !== t.agent));
    const brief = this.briefs.get(threadId);
    const sideBusy = brief && stale.some((x) => x.side && x.l.session === brief.session);
    if (leadBusy) {
      this.store.putItem(threadId, { kind: "notice", id: uid("it"), turn: turn.turn, at: Date.now(), text: `This session moved to ${picked(lead.provider, lead.model)} while ${label(leadStale.l.provider)} worked, so Liner Code stopped its turn and ended ${label(leadStale.l.provider)} and what it started.` });
      // Liner Code stopped it, not you: the turn doesn't say you did.
      this.levelStops.add(threadId);
      this.stop(threadId);
    } else if (sideBusy) {
      this.store.putItem(threadId, { kind: "notice", id: uid("it"), turn: t.turns, at: Date.now(), text: `The sidekick changed while ${label(stale.find((x) => x.side)!.l.provider)} worked on a brief, so Liner Code stopped the brief and ended it.` });
      brief.by ??= "replaced";
      brief.abort.abort();
    }
    // Stopped first: the turn winds down (its tool cancels, what it left running is ended and named), then the close.
    if (leadBusy) for (const end = Date.now() + 5000; this.turns.get(threadId) === turn && Date.now() < end; ) await new Promise((r) => setTimeout(r, 25));
    await this.ending(threadId, stale.map((x) => x.l.session));
  }

  /** retool for every thread with a live session: an agent's settings, which many sessions may run as, changed. */
  retoolAll() {
    const ids = new Set([...this.live.keys()].map((k) => k.slice(0, k.indexOf(":"))));
    return Promise.all([...ids].map((id) => this.retool(id))).then(() => undefined);
  }

  /** How many running turns are on a tool ("claude", "codex"…), its other accounts included. */
  working(family: string) {
    const threads = new Set<string>();
    for (const [key, l] of this.live) {
      const threadId = key.slice(0, key.indexOf(":"));
      if (familyOf(l.provider) === family && this.turns.has(threadId)) threads.add(threadId);
    }
    return threads.size;
  }

  /** Closes a tool's sessions that aren't in a turn, so the next turn starts the updated tool; they resume where they were. */
  restartIdle(family: string) {
    for (const [key, l] of this.live) {
      if (familyOf(l.provider) !== family || this.turns.has(key.slice(0, key.indexOf(":")))) continue;
      this.live.delete(key);
      void this.ending(key.slice(0, key.indexOf(":")), [l.session]);
    }
  }

  /**
    Who carries on when `provider` runs out of usage (Hermes Agent's fallbacks): another account of
    the same tool first, on the same model when it has it, since it's the same work on another
    quota; else the sidekick a pair would get from the other families' ready tools.
  */
  fallbackFor(provider: ProviderId, model: string): string | undefined {
    const now = Date.now();
    // Not a tool that's out of usage too: two of them would hand a session back and forth with no end.
    const ready = this.providerInfo.filter((p) => p.available && p.adapter && p.id !== "demo" && p.id !== provider && p.models.length && (this.limitedUntil.get(p.id) ?? 0) <= now);
    const twin = ready.find((p) => familyOf(p.id) === familyOf(provider));
    if (twin) return `${twin.id}:${twin.models.some((m) => m.id === model) ? model : (twin.models.find((m) => m.isDefault) ?? twin.models[0]).id}`;
    return castOf(ready.filter((p) => familyOf(p.id) !== familyOf(provider)))?.sidekick;
  }

  /** A limited session carries on with another tool's model: the conversation goes over with it, then it continues where it stopped. */
  async carryOn(threadId: string, model?: string) {
    const t = this.store.thread(threadId);
    const items = this.store.timeline(threadId);
    const limit = items.findLast((x) => x.kind === "limit");
    const to = model ?? (limit?.kind === "limit" ? limit.fallback : undefined);
    if (!to) throw new Error("No other tool is ready to carry on with.");
    const from = this.resolve(t);
    // The lead's model changes; on another model the limit no longer holds the session, so the message below can go
    // (straight away, or when the limited turn's hold ends). Its context window goes too, as when you change the
    // model (thread.update): the next model reports its own.
    this.store.patchThread(threadId, { model: to, usage: { ...t.usage, contextWindow: undefined }, ...(t.status === "limited" ? { status: "idle" as const, limit: undefined } : {}) });
    this.store.putItem(threadId, { kind: "notice", id: uid("it"), turn: t.turns, at: Date.now(), text: `${this.labelOf(`${from.provider}:${from.model}`)} is out of usage, so ${this.labelOf(to)} carries on with the conversation so far.` });
    // The tool that ran out ends now, by the one close, not at the next turn's opening.
    await this.retool(threadId);
    await this.send(threadId, CONTINUE);
  }

  /**
    A session out of usage carries on by itself once its window reopens, when you turned that on
    in Settings and the tool said when (T3 Code: UsageLimitRecoveryWorker.ts). Each limit goes once,
    a minute after the reset so the first request doesn't beat the window, and a limit that was said
    after its own reset time can't start a loop.
  */
  resumeLimited(now = Date.now()) {
    if (!this.store.settings.resumeAtReset) return;
    for (const t of this.store.threads) {
      const until = t.limit?.until;
      if (t.status !== "limited" || !until || now < until + 60_000 || now - until > LIMIT_STALE_MS || t.archived || t.sideOf || (t.snoozedUntil ?? 0) > now || this.isRunning(t.id)) continue;
      const key = `${t.id}:${until}`;
      if (this.reopened.has(key)) continue;
      this.reopened.add(key);
      const said = this.store.timeline(t.id).findLast((x) => x.kind === "limit");
      if (said && said.at >= until) continue;
      const tool = this.providerInfo.find((p) => p.id === t.limit?.provider)?.label ?? t.limit?.provider ?? "The tool";
      this.store.patchThread(t.id, { status: "idle", limit: undefined });
      this.store.putItem(t.id, { kind: "notice", id: uid("it"), turn: t.turns, at: now, text: `${tool}'s usage window reopened, so this session carries on by itself.` });
      // The lead carries on, as with a message from you.
      void this.hold(t.id, async () => {
        await this.worktreeBack?.(t.id).catch(() => {});
        await this.dispatch(t.id, CONTINUE);
      }).catch(() => {});
    }
  }

  /**
    After Liner Code quit or crashed mid-turn, the sessions it stopped carry on by themselves
    (T3 Code: RestartContinuation.ts), unless Settings turns that off. A turn you stopped says so on
    the timeline, and one that was waiting on you lost its question: neither goes on. At most three
    times in five minutes a session, so a turn that brings the engine down doesn't loop. Run once,
    when the engine has started.
  */
  continueAfterRestart(now = Date.now()) {
    const on = this.store.settings.continueAfterRestart !== false;
    const went: string[] = [];
    for (const t of this.store.threads) {
      // The store leaves a thread that was working idle and unread; one with a question open stays in Needs you.
      if ((t.status !== "idle" && t.status !== "waiting") || !t.unread || t.sideOf || this.isRunning(t.id)) continue;
      const items = this.store.timeline(t.id);
      const last = items.findLast((x) => x.kind === "turn");
      if (last?.kind !== "turn" || last.status !== "stopped" || last.turn !== t.turns) continue;
      const of = items.filter((x) => x.turn === last.turn);
      const yours = of.some((x) => x.kind === "notice" && x.text === "You stopped this turn.");
      // Cut off before its "after" snapshot, so its changes have no checkpoint yet: taken before anything else runs.
      const cut = yours || of.some((x) => x.kind === "checkpoint") ? null : this.checkpointCut(t.id, last.turn).catch(() => {});
      if (!on || t.status !== "idle" || t.archived || t.routine || (t.snoozedUntil ?? 0) > now) continue;
      if (yours || of.some((x) => (x.kind === "notice" && x.text.startsWith(GAVE_UP)) || ((x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "expired"))) continue;
      const note = (text: string) => this.store.putItem(t.id, { kind: "notice", id: uid("it"), turn: last.turn, at: now, text });
      if (items.filter((x) => x.kind === "notice" && x.text === CARRIED && now - x.at < 5 * 60_000).length >= 3) {
        note(`${GAVE_UP}: it carried on three times in five minutes, so it waits for you now.`);
        continue;
      }
      note(CARRIED);
      // What it had running didn't survive the restart, and won't report back (T3 Code: RestartBackgroundNote.ts).
      const prompt = `${CONTINUE}\n\n(Liner Code restarted while you worked, so any command or background task you had running was stopped before it finished. It won't report back on its own: run again what you still need, and wait for its result.)`;
      void this.hold(t.id, async () => {
        await cut;
        // One that can't come back fails its turn, which names the folder.
        await this.worktreeBack?.(t.id).catch(() => {});
        await this.turn(t.id, CONTINUE, t.agent, { prompt });
      }).catch(() => {});
      went.push(t.id);
    }
    return went;
  }

  /**
    A turn the engine stopped in never took its "after" snapshot, so what it changed had no diff and
    no undo, and the turn after it would snapshot those changes as already there. They're read now,
    from the "before" it did take. What you changed while it was closed comes along: it can't be told apart.
  */
  private async checkpointCut(threadId: string, turn: number) {
    const t = this.store.thread(threadId);
    const cwd = t.worktree?.path ?? this.store.project(t.projectId).path;
    if (!existsSync(cwd) || !(await isRepo(cwd))) return;
    const before = await run("git", ["rev-parse", "--verify", "-q", `refs/liner/${threadId}/${turn}-before^{commit}`], { cwd });
    const from = before.stdout.trim();
    if (before.code !== 0 || !from) return;
    const to = await capture(cwd, `${threadId}/${turn}-after`);
    const files = to ? await changes(cwd, from, to, { turn: true }) : [];
    if (!to || !files.length) return;
    this.store.putItem(threadId, { kind: "checkpoint", id: uid("it"), turn, at: Date.now(), files, from, to });
    this.store.patchThread(threadId, { toReview: this.toReview(threadId) });
  }

  /**
    Turns that have gone quiet: nothing from their tool for a while, and nothing waiting on you
    (Hermes Agent's stream watchdog). A hung tool otherwise looks busy forever. Said once on the
    timeline and as a notification; any word from the tool clears it, so it can be said again.
  */
  watchQuiet(now = Date.now()) {
    for (const [threadId, live] of this.turns) {
      const t = this.store.threads.find((x) => x.id === threadId);
      if (!t || t.status !== "running" || live.quiet) continue;
      const stepping = this.store.timeline(threadId).some((x) => x.kind === "tool" && x.turn === live.turn && x.status === "running");
      const since = now - (live.heard ?? live.started);
      if (since < (stepping ? QUIET_STEP_MS : QUIET_MS)) continue;
      live.quiet = true;
      const who = this.resolve(t).agent.name;
      const minutes = Math.round(since / 60_000);
      this.store.putItem(threadId, { kind: "notice", id: uid("it"), turn: live.turn, at: now, text: `No word from ${who} for ${minutes} minutes${stepping ? " while a step runs" : ""}. It may be stuck: stop it from the composer, or keep waiting.` });
      this.store.emit({ type: "notify", threadId, kind: "error", title: `${who} has gone quiet`, body: `${t.title}: nothing for ${minutes} minutes.` });
    }
  }

  /** Stops everything; settles once every live session's tool, and what it started, has ended (the engine waits on it as it quits). */
  shutdown(): Promise<void> {
    this.quitting = true;
    clearInterval(this.watchdog);
    for (const id of this.turns.keys()) this.stop(id);
    // A pull request's test suite runs outside any turn, in a process group of its own.
    for (const s of this.prStops.values()) s.abort();
    const closing = [...this.live.values()].map((l) => l.session.close());
    // And the closes already under way (a session another tool took over from).
    return Promise.allSettled([...closing, ...this.closing.values()]).then(() => undefined);
  }

  /** The sink a provider writes one turn into, and what it built. */
  private sink(threadId: string, turn: number, signal: AbortSignal, agentId: string) {
    const store = this.store;
    const blocks = new Map<string, string>(); // provider block → item id
    const tools = new Map<string, { id: string; started: number }>();
    let streaming: string[] = [];
    let plan: string | null = null;
    let errored = false;
    let limit: { message: string; until?: number; provider: string } | null = null;
    /** What this turn's own tool used, apart from anything else counted in the thread meanwhile. */
    const spent = emptyUsage();
    let lastKind: "text" | "reasoning" | null = null;
    let lastBlock = "";
    /** What this turn asked you that may still be waiting, and whether the turn has ended. */
    const pending = new Set<string>();
    let over = false;
    /** Keyed notices (see TurnSink.notice) → their items. */
    const notices = new Map<string, string>();
    /** Read only's refusal has been said on the timeline this turn. */
    let readSaid = false;
    const reasonStart = new Map<string, number>();

    const settle = () => {
      for (const id of streaming) {
        const it = store.timeline(threadId).find((x) => x.id === id);
        if (it && (it.kind === "text" || it.kind === "reasoning")) {
          const seconds = it.kind === "reasoning" ? (Date.now() - (reasonStart.get(id) ?? Date.now())) / 1000 : undefined;
          store.putItem(threadId, { ...it, streaming: false, ...(seconds !== undefined ? { seconds } : {}) });
        }
      }
      streaming = [];
    };
    const flow = (kind: "text" | "reasoning", delta: string, block = "") => {
      if (!delta) return;
      // A new block, or a switch between thinking and answering, starts a new item.
      const key = `${kind}:${block || (lastKind === kind ? lastBlock : uid("b"))}`;
      let id = blocks.get(key);
      if (!id) {
        settle();
        id = uid("it");
        blocks.set(key, id);
        if (kind === "reasoning") reasonStart.set(id, Date.now());
        store.putItem(threadId, kind === "text" ? { kind: "text", id, turn, at: Date.now(), text: "", streaming: true } : { kind: "reasoning", id, turn, at: Date.now(), text: "", streaming: true }, false);
        streaming.push(id);
      } else if (!streaming.includes(id)) {
        // It goes on after being settled (a notice came between): it streams again, so what's added is saved too.
        const it = store.timeline(threadId).find((x) => x.id === id);
        if (it?.kind === "text" || it?.kind === "reasoning") store.putItem(threadId, { ...it, streaming: true }, false);
        streaming.push(id);
      }
      lastKind = kind;
      lastBlock = key.slice(kind.length + 1);
      store.appendText(threadId, id, delta);
    };
    /** Holds the turn until you answer, or until it is stopped. */
    const wait = <T,>(map: Map<string, Waiter<T>>, id: string, sig: AbortSignal) =>
      new Promise<T>((resolve, reject) => {
        map.set(id, { resolve, reject });
        const gone = () => {
          if (!map.has(id)) return;
          map.delete(id);
          const it = store.timeline(threadId).find((x) => x.id === id);
          // Quitting isn't Stop: a question outlives its turn, and your answer goes as your next message (answerQuestion).
          const keep = this.quitting && it?.kind === "question";
          if (it && "state" in it && it.state === "asking" && !keep) store.putItem(threadId, { ...it, state: "expired" } as Item);
          this.clock(threadId);
          reject(new Error("stopped"));
        };
        // A signal that's already aborted never fires again: settle it now.
        if (sig.aborted || signal.aborted) return gone();
        pending.add(id);
        sig.addEventListener("abort", gone, { once: true });
        signal.addEventListener("abort", gone, { once: true });
      });
    const needsYou = (title: string) => {
      this.clock(threadId);
      const t = store.patchThread(threadId, { status: "waiting" });
      store.emit({ type: "notify", threadId, kind: "waiting", title: `${this.resolve(t, agentId).agent.name} needs you`, body: title });
    };

    // Any word from the tool: the watchdog starts counting again.
    const heard = () => {
      const live = this.turns.get(threadId);
      if (live) Object.assign(live, { heard: Date.now(), quiet: false });
    };
    const api: TurnSink = {
      // Once the turn has ended, a late word from the tool (a timer it left running) changes nothing.
      text: (d, b) => void (!over && (heard(), flow("text", d, b))),
      reasoning: (d, b) => void (!over && (heard(), flow("reasoning", d, b))),
      tool: (u: ToolUpdate) => {
        let rec = tools.get(u.key);
        // Once the turn has ended, a late word from the tool changes nothing, except on the row of an agent it
        // sent off: one in the background outlives its turn, and goes on and ends on its row, where it started.
        if (over && !(u.agent && rec && store.threads.some((t) => t.id === threadId))) return;
        if (!over) {
          heard();
          settle();
          lastKind = null;
        }
        if (!rec) {
          rec = { id: uid("it"), started: Date.now() };
          tools.set(u.key, rec);
        }
        const prev = store.timeline(threadId).find((x) => x.id === rec!.id);
        const base = prev?.kind === "tool" ? prev : undefined;
        // Its row is gone (the turn was rewound): nothing to go on.
        if (over && !base) return;
        // An agent's row keeps what it knew (its brief, its model) when a later word leaves it out; the agent that sent it is named by its row.
        let agent = base?.agent;
        if (u.agent) {
          const { parentKey, ...said } = u.agent;
          const parent = parentKey ? tools.get(parentKey)?.id : undefined;
          agent = { ...base?.agent, ...said, ...(parent ? { parent } : {}) };
        }
        // The lead handing its sidekick a brief: an agent's row from the start, which the brief takes on (delegate) and fills.
        const side = isSidekickTool(u.tool);
        if (side && !base) {
          const brief = briefIn(u.input);
          agent = { name: "Sidekick", ...(brief ? { task: taskOf(brief), brief } : {}), ...(store.thread(threadId).sidekick ? { model: store.thread(threadId).sidekick } : {}) };
          this.sideRows.set(threadId, [...(this.sideRows.get(threadId) ?? []), { id: rec.id, input: brief }]);
        }
        const item: Extract<Item, { kind: "tool" }> = {
          kind: "tool",
          id: rec.id,
          turn,
          at: base?.at ?? Date.now(),
          tool: u.tool,
          toolKind: side ? "task" : u.toolKind,
          title: u.title || base?.title || u.tool,
          input: u.input ?? base?.input,
          output: u.output ?? base?.output,
          path: u.path ?? base?.path,
          // A call still running when you pressed Stop was stopped, however its tool words its end after that (Claude Code's
          // interrupted command comes back failed, OpenCode's done): the same on every tool.
          status: signal.aborted && base?.status === "running" && u.status !== "running" ? "stopped" : u.status,
          seconds: u.status === "running" ? undefined : (Date.now() - rec.started) / 1000,
          ...(agent ? { agent } : {}),
        };
        // Saved when it starts and when it ends; what it prints meanwhile only goes to the window. An agent's row
        // is saved as it changes how it stands (its call returns, it ends, in the background after its call too),
        // is named or reports: not at each of its steps, which may go on long after its call is done.
        const save = !base || (agent ? base.status !== item.status || agentState(base) !== agentState(item) || base.title !== item.title || base.agent?.report !== agent.report : u.status !== "running");
        store.putItem(threadId, item, save);
        if (agent && (base ? agentState(base) : undefined) !== agentState(item)) this.countAgents(threadId);
      },
      plan: (entries: PlanEntry[]) => {
        heard();
        // What's said after it is a new paragraph, with no block id to say so (T3 Code: AcpAdapterV2.test.ts, plan boundaries).
        lastKind = null;
        plan ??= uid("it");
        const prev = store.timeline(threadId).find((x) => x.id === plan);
        store.putItem(threadId, { kind: "plan", id: plan, turn, at: prev?.at ?? Date.now(), entries });
      },
      approve: (req, sig) => {
        // Too late to ask: a card now would hold the session with nothing left to answer it.
        if (over) return Promise.resolve({ allow: false, reason: "The turn has ended." });
        const now = store.thread(threadId);
        const command = req.fields.find((f) => f.label === "Command")?.value;
        // Read only means it, here as in the tool: in a side chat or Read only, what writes never goes
        // ahead by itself, whatever the access or an earlier "don't ask again". It comes to you.
        const writes = command !== undefined ? !readsOnly(command) : EDIT_TOOLS.has(req.tool) || req.rule === "Edit";
        // Read only refuses what it forbids outright, on every tool, with no card (readForbids): the tool's own edit, a command
        // that changes things, more access. One sentence for the model, one quiet line on the timeline a turn. A side chat isn't
        // changed by this: what it asks still comes to you.
        if (now.access === "read" && !now.sideOf && readForbids(req)) {
          if (!readSaid) store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: `This session is Read only, so Liner Code refused “${req.title}” without asking.` });
          readSaid = true;
          return Promise.resolve({ allow: false, level: true, reason: READ_REFUSED(command !== undefined) });
        }
        const held = writes && (now.access === "read" || Boolean(now.sideOf));
        // A command that names a .env file: what it prints goes to the model (risk.ts, namesSecret). Neither a rule nor
        // Auto lets one through as a plain read, and neither does "don't ask again this turn".
        const secret = command !== undefined && namesSecret(command);
        // Allowed for the rest of the session already. Not what can't be undone (a rule from `rm a.txt` is `rm`, and `rm -rf ~` is `rm` too),
        // nor in a routine's step, whose limits are its own whatever you said in its session. A command only when every
        // rule it needs was granted (risk.ts, ruleParts), so nothing chained after an allowed command rides on it.
        if (!held && req.risk !== "high" && !this.unattended.has(threadId) && req.rule && !secret && this.ruleAllows(threadId, command, req.rule)) return Promise.resolve({ allow: true });
        // Nobody's there to ask.
        if (held && this.unattended.has(threadId)) return Promise.resolve({ allow: false, reason: "This turn only reads. Leave the change for the person." });
        // A routine runs with nobody watching: it may do what can be undone, never what can't, and
        // nothing that leaves this Mac (a push, a merge, a post): the routine's gate does that, or you do.
        if (this.unattended.has(threadId)) {
          return Promise.resolve(req.risk === "high" || leavesMac(command ?? "") ? { allow: false, reason: "Routines don't run commands that can't be undone or that reach outside this Mac. Leave it for the person." } : { allow: true });
        }
        const cwd = now.worktree?.path ?? store.project(now.projectId).path;
        // The skill folders you let Auto reach this session (the skill grants).
        const reach = this.reach(threadId);
        // "Don't ask again this turn": until it ends, an ask goes ahead only when Auto's own rule would run it (autoLets,
        // the same function Auto's path calls below, with the same skill folders), for a tool with no safety check of its
        // own; an edit only with every file it names in the project. Everything else still asks, and Read only's holds came
        // first. Add-on cards and questions and plans don't come this way.
        const forTurn = this.turnGrants.get(threadId) === turn && this.turns.get(threadId)?.turn === turn && !signal.aborted && !sig.aborted;
        // Only below Auto, as the level stands at this ask: raised mid-turn it stops mattering, lowered again it applies again.
        if (forTurn && this.turnLevel(threadId) && !held && req.risk !== "high" && this.turnCovers(req, command, cwd, reach.skills)) return Promise.resolve({ allow: true });
        const toolId = req.key ? tools.get(req.key)?.id : undefined;
        const access = now.access;
        // Auto: the tool's own auto mode lets through what it can; of what it hands over, reading and editing go ahead.
        // A tool with no such mode hands over every command, so a routine one goes ahead too: rated low, inside its
        // folder (or a skill's you allowed), sending nothing out (risk.ts, routine, leavesMac). The rest still comes to you.
        if (!held && access === "auto" && this.autoLets(req, command, cwd, reach.skills, Boolean(req.unjudged))) return Promise.resolve({ allow: true });
        /**
          Why it comes to you, most important first, each from the check that decided it: what can't be undone (risk.ts's
          table), what the tool said of its ask (outside the project, a host Codex asks to reach), then what made this level ask. A check that
          can't name its reason gives none.
        */
        const whyOf = (): ApprovalWhy[] => {
          const why: ApprovalWhy[] = [];
          const rated = command !== undefined ? riskOf(command) : undefined;
          if (req.risk === "high" && rated?.risk === "high" && rated.why) why.push(rated.why);
          why.push(...(req.why ?? []));
          const level = (text: string) => why.push({ kind: "level", text });
          if (held) level(`${now.sideOf ? "A side chat" : ACCESS_NAMES.read} asks before anything that changes files`);
          else if (access === "ask" || access === "edits") {
            if (command !== undefined) level(`${ACCESS_NAMES[access]} asks before running commands`);
            else if (access === "ask" && EDIT_TOOLS.has(req.tool)) level(`${ACCESS_NAMES.ask} asks before every edit`);
          } else if (access === "auto" && req.risk !== "high") {
            if (command === undefined) {
              if (!EDIT_TOOLS.has(req.tool)) level(`${ACCESS_NAMES.auto} asks before tools other than reading and editing`);
            } else if (secret) level(`${ACCESS_NAMES.auto} leaves a command that names a .env file to you`);
            else if (req.unjudged) {
              const j = judge(command, cwd, { inside: reach.skills });
              if (!j.ok && j.why) why.push(j.why);
              else if (j.ok) {
                const out = outwardOf(command);
                if (out) why.push(out);
              }
            }
          }
          return why.filter((w, i) => why.findIndex((x) => x.kind === w.kind && x.text === w.text) === i);
        };
        /**
          What "don't ask again this session" can be offered for, each exactly what it allows. Nothing for what can't be
          undone. A rule only when it's the one the command reads as (ruleFor), so what's granted is what the label says;
          a skill only at Auto, for a tool nothing of its own judged (that's what Auto's rule lets through).
        */
        const grantsOf = (): ApprovalGrant[] => {
          if (req.risk === "high") return [];
          const grants: ApprovalGrant[] = [];
          if (req.rule && !secret && (command === undefined || ruleFor(command) === req.rule)) grants.push({ kind: "rule", label: req.rule });
          if (access === "auto" && req.unjudged && command !== undefined && !secret) {
            const skill = skillOffer(command, cwd);
            if (skill) grants.push({ kind: "skill", label: skill.label });
          }
          return grants;
        };
        const ask = (note?: string) => {
          // Stopped while the Reviewer read the step, or the turn ended: nothing to ask about.
          if (sig.aborted || signal.aborted || over) return Promise.resolve({ allow: false });
          settle();
          const id = uid("it");
          const grants = grantsOf();
          const rule = grants.find((g) => g.kind === "rule")?.label;
          // Whether "this turn" can be offered: the turn's grant would have let this very ask go (the same check as above,
          // at the same level and holds), so the card offers exactly what it will do.
          const turnGrant = this.turns.get(threadId)?.turn === turn && this.turnLevel(threadId) && !held && req.risk !== "high" && !this.unattended.has(threadId) && this.turnCovers(req, command, cwd, reach.skills);
          store.putItem(threadId, { kind: "approval", id, turn, at: Date.now(), tool: req.tool, title: req.title, description: [note, req.description].filter(Boolean).join("\n\n") || undefined, risk: req.risk, fields: req.fields, ...(rule ? { rule } : {}), ...(req.says ? { says: req.says } : {}), why: whyOf(), grants, turnGrant, state: "asking", toolId });
          // The level it was asked at: an answer is judged by the level when it's given (answer).
          this.cardLevel.set(id, store.thread(threadId).access);
          needsYou(req.title);
          return wait(this.approvals, id, sig).finally(() => this.cardLevel.delete(id));
        };
        // Reviewer decides: reading goes ahead, what can't be undone comes to you, the Reviewer calls the rest.
        if (!held && access === "review" && req.risk !== "high") {
          // One that names a .env file is the Reviewer's to read like any other step.
          if (command !== undefined && readsOnly(command) && !secret) return Promise.resolve({ allow: true });
          return this.stepCall(threadId, req, AbortSignal.any([sig, signal])).then((call) => {
            // Its word is no good once you've stopped the turn it was for.
            if (sig.aborted || signal.aborted || over) return { allow: false };
            if (!call?.allow) return ask(call ? `${this.labelOf(call.model)}, reviewing: ${call.reason}` : undefined);
            settle();
            store.putItem(threadId, { kind: "approval", id: uid("it"), turn, at: Date.now(), tool: req.tool, title: req.title, risk: req.risk, fields: req.fields, rule: req.rule, ...(req.says ? { says: req.says } : {}), state: "approved", reason: call.reason, toolId, reviewer: call.model, answeredAt: Date.now() });
            return { allow: true };
          });
        }
        return ask(secret && access === "auto" ? "This names a .env file, which often holds keys, and what the command prints goes to the model. So Auto leaves it to you." : undefined);
      },
      ask: (questions: Question[], sig, o) => {
        // Nobody answers after the turn, nor an optional question in a routine's step: the agent carries on with its own best guess.
        if (over || (o?.optional && this.unattended.has(threadId))) return Promise.resolve(null);
        settle();
        const id = uid("it");
        store.putItem(threadId, { kind: "question", id, turn, at: Date.now(), questions, state: "asking" });
        needsYou(questions[0]?.question ?? "A question");
        return wait(this.questions, id, sig);
      },
      // A plan the tool proposes inside its turn (Claude Code's plan mode) waits there for your answer.
      propose: (title, text, sig) => {
        if (over) return Promise.resolve({ approve: false });
        settle();
        const id = uid("it");
        store.putItem(threadId, { kind: "proposal", id, turn, at: Date.now(), title, plan: text, state: "asking" });
        needsYou(title);
        return wait(this.proposals, id, sig);
      },
      usage: (u: Partial<Usage>, total) => {
        heard();
        const t = store.thread(threadId);
        const cur = { ...emptyUsage(), ...t.usage };
        // A session's running totals add what's new since its last report, so what other models
        // used in the thread (the Reviewer, the sidekick, an earlier tool) stays counted.
        const session = this.turns.get(threadId)?.session;
        const seen = (total && session && this.totals.get(session)) || {};
        const add = (k: "inputTokens" | "outputTokens" | "cacheReadTokens" | "costUsd") => {
          if (u[k] === undefined) return;
          const add = total ? Math.max(0, (u[k] as number) - (seen[k] ?? 0)) : (u[k] as number);
          cur[k] += add;
          spent[k] += add;
        };
        add("inputTokens");
        add("outputTokens");
        add("cacheReadTokens");
        add("costUsd");
        if (total && session) this.totals.set(session, { ...seen, ...u });
        if (u.contextTokens !== undefined) cur.contextTokens = u.contextTokens;
        if (u.contextWindow !== undefined) cur.contextWindow = u.contextWindow;
        store.patchThread(threadId, { usage: cur });
        this.holdToCap(threadId);
      },
      session: (id) => {
        const t = store.thread(threadId);
        const ref = `${this.resolve(t, agentId).provider}:${id}`;
        if (savedSession(t, agentId) === ref) return;
        if (agentId === t.agent) store.patchThread(threadId, { providerSession: ref });
        else store.patchThread(threadId, { sessions: { ...t.sessions, [agentId]: ref } });
      },
      notice: (text, key, o) => {
        // Said once a session: a setting's note the tool would repeat each turn it starts. Said again once the model or
        // its thinking level changed since, so a switch that fails again after switching back is told.
        if (o?.once) {
          const r = this.resolve(store.thread(threadId), agentId);
          const setting = `${r.provider}:${r.model}|${r.effort}`;
          const was = this.toldOnce.get(threadId);
          const told = was?.setting === setting ? was.told : new Set<string>();
          if (told.has(text)) return;
          this.toldOnce.set(threadId, { setting, told: told.add(text) });
        }
        settle();
        // A keyed notice says the same thing again as it changes (a retry's count): one line, kept up to date.
        const id = (key && notices.get(key)) || uid("it");
        if (key) notices.set(key, id);
        const prev = store.timeline(threadId).find((x) => x.id === id);
        store.putItem(threadId, { kind: "notice", id, turn, at: prev?.at ?? Date.now(), text, ...(o?.stop ? { stop: true } : {}) });
      },
      heard: () => void (!over && heard()),
      effortNow: (level) => {
        // The lead's alone: it's the thread's model.
        if (agentId !== store.thread(threadId).agent || store.thread(threadId).effortNow === level) return;
        store.patchThread(threadId, { effortNow: level });
      },
      error: (message) => {
        settle();
        errored = true;
        store.putItem(threadId, { kind: "error", id: uid("it"), turn, at: Date.now(), message });
      },
      window: (w) => store.onWindow?.(this.resolve(store.thread(threadId), agentId).provider, w),
      limited: (message, until) => {
        settle();
        const r = this.resolve(store.thread(threadId), agentId);
        // A limit first said with no reset time takes one a later report gives: without it, it could never carry on at reset.
        if (limit) {
          const said = store.timeline(threadId).findLast((x) => x.kind === "limit" && x.turn === turn);
          if (limit.until || !until || said?.kind !== "limit") return;
          limit.until = until;
          this.limitedUntil.set(r.provider, until);
          store.putItem(threadId, { ...said, until });
          return;
        }
        limit = { message, until, provider: r.provider };
        this.limitedUntil.set(r.provider, until ?? Date.now() + LIMIT_UNKNOWN_MS);
        store.putItem(threadId, { kind: "limit", id: uid("it"), turn, at: Date.now(), message, until, provider: r.provider, fallback: this.fallbackFor(r.provider, r.model) });
      },
    };
    return {
      api,
      errored: () => errored,
      spent: () => spent,
      limited: () => limit,
      end: () => {
        settle();
        over = true;
        // A call with no result at the end didn't finish: stopped, or the tool broke off.
        for (const [, rec] of tools) {
          const it = store.timeline(threadId).find((x) => x.id === rec.id);
          if (it?.kind === "tool" && it.status === "running") store.putItem(threadId, { ...it, status: signal.aborted ? "stopped" : errored ? "failed" : "done", seconds: (Date.now() - rec.started) / 1000 });
        }
        // A request or plan the turn can no longer act on (the tool's process ended) expires, so it doesn't hold the session in Needs you.
        for (const id of pending) {
          const waiter = this.approvals.get(id) ?? this.proposals.get(id);
          if (!waiter) continue;
          this.approvals.delete(id);
          this.proposals.delete(id);
          const it = store.timeline(threadId).find((x) => x.id === id);
          if (it && "state" in it && it.state === "asking") store.putItem(threadId, { ...it, state: "expired" } as Item);
          waiter.reject(new Error("The turn ended."));
        }
        // A question still means something after its turn: the card stays, its waiter goes, so your
        // answer goes as your next message (answerQuestion) instead of to a tool that stopped listening
        // (T3 Code: RuntimeRequestService.ts, which answers a request only while its live session holds it).
        for (const id of pending) {
          const waiter = this.questions.get(id);
          if (!waiter) continue;
          this.questions.delete(id);
          waiter.reject(new Error("The turn ended."));
        }
      },
    };
  }
}

/**
  Liner Code's tools by the names a tool offers them: Claude Code calls an MCP tool
  mcp__<server>__<tool>, OpenCode <server>_<tool>, and Codex lists them under the server's own
  name. A model told one name and offered another can call the one it was told (GPT-OSS did,
  through an API endpoint), so it's told the one it's offered. Hermes offers a server handed over
  ACP as mcp__editor_liner_<8 hex>__<tool>, the tag new each session, so the tag stays a placeholder.
  Antigravity (1.5.6) offers a server handed over ACP as mcp_<server>_<tool>, each with its schema, up front: Liner Code's is
  handed over as liner_<tag> there, the tag new each time agy starts (acp.ts namesNote says the current one), so the tag stays a
  placeholder here too, unless `server` names one.
*/
/** An access level as the app names it. */
const ACCESS_WORDS: Record<Access, string> = { read: "Read only", ask: "Ask", edits: "Edits", auto: "Auto", review: "Reviewer decides", full: "Full access" };

export const linerName = (family: string, server = "liner") => (tool: string) => (family === "claude" ? `mcp__liner__${tool}` : family === "opencode" ? `liner_${tool}` : family === "hermes" ? `mcp__editor_liner_<tag>__${tool}` : family === "antigravity" ? `mcp_${server === "liner" ? "liner_<tag>" : server}_${tool}` : tool);

/**
  What every agent is told when Liner Code's tools come with it. Without it, a tool with a
  computer-use plugin of its own (Codex, say) reached for that to check a page, outside the app.
*/
export function toolsNote(n: (tool: string) => string, family?: string, server = "liner") {
  return [
    `Liner Code runs this session. Its own tools (the \`${family === "antigravity" && server === "liner" ? "liner_<tag>" : server}\` MCP server) reach what the person sees beside this chat:`,
    // Antigravity gets them under a tag made new each time it starts, said in the conversation (acp.ts namesNote).
    ...(family === "antigravity" && n("x").includes("<tag>") ? ["(<tag> is a short code Liner Code makes new each time the agent starts; the conversation names the current one, and only that one is Liner Code's.)"] : []),
    // Hermes keeps them in its catalog of tools loaded on demand, under a tag of its own.
    ...(family !== "antigravity" && n("x").includes("<tag>") ? ["(<tag> is a short code that changes from session to session. When one isn't in your tool list, find it with tool_search and call it through tool_call.)"] : []),
    // Liner's server asks Codex for them up front (codexMcp, omit_tools_from); a Codex too old for that keeps them behind its tool search.
    ...(family === "codex" ? ["(If these aren't in your tool list, find them with tool_search, searching \"liner design browser\", and call them from what it returns.)"] : []),
    `- ${n("browser_open")} opens a page of what you build in their Browser: a dev server on this Mac (localhost:5173, or just a port) or an HTML file in this folder (index.html), which needs no server. ${["browser_read", "browser_click", "browser_type", "browser_press"].map(n).join(", ")} and ${n("browser_screenshot")} then use that page, and report its console errors. On a canvas (a game), click a point with x and y, or press keys.`,
    `- ${n("server_start")} runs a dev server named in .claude/launch.json (the file Claude Code reads; write it first when it's missing) and opens it in their Browser. Use it rather than starting a dev server from your shell: Liner Code stops it when nobody needs it and starts it again when they come back. ${n("server_logs")} reads what it printed, ${n("server_stop")} stops it.`,
    `- ${n("show_page")} shows them a chart or a table in the chat.`,
    `- ${n("design_show")} shows a screen, page or prototype you design in their Design surface, version by version: write it as one HTML file under .liner/designs/ and call it with the path (or pass the page as html). They comment on parts of it there, and ask for it to be built.`,
    `- ${["design_files", "design_frame", "design_tree", "design_node", "design_selection", "design_shot"].map(n).join(", ")} work on Liner Design's canvas: the design files of this folder (.liner/designs/<file>/), each frame one HTML file there that you may also edit with your own tools. ${n("design_built")} records a frame you built as a file of the project; ${n("design_picture")} asks for an AI picture (one a model generates from words) when the person set up AI pictures; without them, leave a labelled empty box.`,
    `- ${n("memory_add")} saves a fact about this project that later sessions start with; ${n("sessions_search")} looks through earlier sessions here.`,
    "Check web pages you build or change with these tools, not with any other browser or computer-use tool, and open the page again after each edit.",
  ].join("\n");
}

/** What a side chat is told on top of its soul: the session goes on without it, and it only reads. */
const SIDE_RULES = [
  "This is a side chat beside a Liner Code session. The user is asking you about that session on the side while it carries on: what was done, why, how the code works, what to try next.",
  "Answer directly. Read files and search the project as you need, but don't edit anything or plan changes to make: nothing said here goes back into the session.",
].join("\n");

/** Terminal output as text: no colours, and a line redrawn in place (\r) keeps only its last state. */
export const clean = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r\n/g, "\n").replace(/^[^\n]*\r(?=[^\n])/gm, "");
/** The end of a run's output, which is where test runners say how it went. */
const tailOf = (s: string) => clean(s).split("\n").slice(-400).join("\n").slice(-24000);
/** A diff short enough for a reader's prompt. */
const cut = (diff: string) => (diff.length > 60000 ? `${diff.slice(0, 60000)}\n… (the rest of the diff is cut off)` : diff);

/** A message that only asks for a pull request: "create pr", "open a pull request", "/pr". */
export function isPrAsk(text: string) {
  return /^(?:\/pr|(?:please\s+)?(?:create|open|make|raise|submit)\s+(?:a\s+|the\s+)?(?:pr|pull\s+request))[\s.!]*$/i.test(text.trim());
}

/**
  What the person reads of a message, as thread.send may carry it (UserShown), checked: a line of text and up to 8 chips of
  the known kinds, each cut to a sane length. Anything else is dropped, never the message.

  Where `shown` may go, and nowhere else: the user item and the queued message that hold it; the app's timeline and queue
  row; the session's title and a commit's subject (labels the person reads, named after what they asked); the export (for
  the person, beside the text); and the person's own session search in the app (sessions.search, `person`). It never goes
  to an agent or an outside tool: prompts, handoffs, the reviewer, steers, agent-side session search (sessions_search),
  outside-tools readouts and the Desk all read `text`, which is what the agent was told. A short line Liner wrote for the
  person would read to another agent as something the person said that was never said to the agent. The one label made
  from it that agents also see, the session's name, reaches them as memory.ts titleForAgents gives it: from `text`. One
  place hands the person's name on as it is: add-on panels (panels.ts session.info and sessions.list), which are drawn for
  the person; a panel that passes that name to ai.ask passes what the person reads.
*/
const SHOWN_KINDS = new Set(["check", "frame", "layer", "compare", "build"]);
export function shownOf(x: unknown): UserShown | undefined {
  if (!x || typeof x !== "object") return undefined;
  const o = x as { text?: unknown; chips?: unknown };
  if (typeof o.text !== "string") return undefined;
  const chips = (Array.isArray(o.chips) ? (o.chips as { kind?: unknown; label?: unknown }[]) : [])
    .filter((c) => Boolean(c) && typeof c === "object" && SHOWN_KINDS.has(c.kind as string) && typeof c.label === "string" && Boolean(c.label.trim()))
    .slice(0, 8)
    .map((c) => ({ kind: c.kind as ShownChip["kind"], label: (c.label as string).trim().slice(0, 80) }));
  const text = o.text.trim().slice(0, 2000);
  if (!text && !chips.length) return undefined;
  return { text, ...(chips.length ? { chips } : {}) };
}

// The first words of a first message, as a session's name: memory.ts has it, beside the name agents read.
export { titleFrom };

/**
  The conversation so far, for a session that starts fresh. What you asked stays whole and the
  newest work comes first in the budget: older answers shrink, then drop, before your requests do.
*/
export function handoff(items: Item[], why: "switch" | "fork" | "restart" = "switch", budget = 24000) {
  const turns = new Map<number, string[]>();
  const add = (turn: number, line: string) => turns.set(turn, [...(turns.get(turn) ?? []), line]);
  /** What each turn asked, whole, however many lines it runs to. */
  const asked = new Map<number, string[]>();
  for (const it of items) {
    if (it.kind === "user") {
      add(it.turn, `You were asked: ${it.text}`);
      asked.set(it.turn, [...(asked.get(it.turn) ?? []), `You were asked: ${it.text}`]);
    } else if (it.kind === "text" && it.text.trim()) add(it.turn, `You answered: ${it.text.length > 2400 ? `${it.text.slice(0, 2400)}…` : it.text}`);
    else if (it.kind === "proposal" && it.state === "approved") add(it.turn, `The plan that was approved: ${it.title}\n${it.plan}`);
    else if (it.kind === "checkpoint" && it.files.length) add(it.turn, `Files changed${it.reverted ? " (since undone)" : it.committed ? ` (committed ${it.committed})` : ""}: ${it.files.map((f) => f.path).join(", ")}`);
    else if (it.kind === "tool" && (it.toolKind === "exec" || it.toolKind === "edit" || it.toolKind === "write")) add(it.turn, `(${it.title}${it.status === "failed" ? ", failed" : ""})`);
  }
  const blocks = [...turns.entries()].sort((a, b) => a[0] - b[0]).map(([turn, lines]) => ({ whole: lines.join("\n"), asks: (asked.get(turn) ?? []).join("\n") }));
  // Newest first into the budget; an older turn that doesn't fit keeps only what you asked.
  const kept: string[] = [];
  let used = 0;
  let dropped = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const { whole, asks } = blocks[i];
    let b = whole;
    if (used + b.length > budget) b = asks;
    // The newest turn always goes, cut to half the budget if it must be, so one huge paste leaves room for the work before it.
    if (!kept.length && (!b || b.length > budget)) b = `${(b || whole).slice(0, budget >> 1)}\n(cut here: it was too long to carry over)`;
    if (!b || used + b.length > budget) {
      dropped = i + 1;
      break;
    }
    kept.unshift(b);
    used += b.length;
  }
  const lead = why === "switch" ? "You're taking over this conversation from another model. Here it is so far" : why === "fork" ? "This is a copy of a conversation, continuing from here. Here it is so far" : "This conversation started before this session. Here it is so far";
  return `${lead}; carry on from where it left off.\n\n<earlier>\n${dropped ? `(${dropped} older ${dropped === 1 ? "turn" : "turns"} left out)\n\n` : ""}${kept.join("\n\n")}\n</earlier>`;
}

/**
  What the Reviewer said about the last change that no model has heard yet: its checks that passed
  with notes, or still found problems after the last round. Findings sent back to be fixed were
  heard then. Null when there's nothing to say; else the words and the checks they're from.
*/
export function reviewerWord(items: Item[], label: (ref: string) => string) {
  const change = items.findLast((x) => x.kind === "checkpoint" && !x.reverted);
  const reviews = items.filter((x): x is Extract<Item, { kind: "review" }> => x.kind === "review" && x.turn === change?.turn && !x.heard && (x.status === "passed" || x.status === "blocked") && x.findings.length > 0);
  if (!reviews.length) return null;
  const text = reviews
    .map((r) => {
      const blocking = r.findings.filter((f) => f.severity === "blocking");
      const lines = [...blocking, ...r.findings.filter((f) => f.severity !== "blocking")].map((f) => `- ${f.severity === "blocking" ? "" : "(a note) "}${f.file}${f.line ? `:${f.line}${f.endLine && f.endLine !== f.line ? `-${f.endLine}` : ""}` : ""}: ${f.note}`);
      const how = r.status === "passed" ? "passed it, with these notes" : `didn't pass it, and these are still there${r.round > 1 ? ` after ${r.round} rounds` : ""}`;
      return `The Reviewer (${label(r.reviewer)}) read the last change and ${how}${r.summary ? ` (${r.summary.trim()})` : ""}:\n${lines.join("\n")}`;
    })
    .join("\n\n");
  return { text, reviews };
}

/** The brief in a sidekick call's input, as its tool showed it (JSON, or nothing yet). */
function briefIn(input?: string) {
  try {
    const b = (JSON.parse(input ?? "") as { brief?: unknown })?.brief;
    return typeof b === "string" && b.trim() ? b.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** The provider session a part of a thread resumes: the lead's, or another's by who it is (the sidekick's, "@<its ref>"). */
function savedSession(t: Thread, agentId: string) {
  return agentId === t.agent ? t.providerSession : t.sessions?.[agentId];
}

/** What a turn or a read that needs a tool that's gone says: the model, and what to do. */
const toolGone = (model: string, todo: string) => `${model} runs on a tool that isn't here any more (an account or an API endpoint that was removed). ${todo}`;

/** "codex:gpt-5.6-luna" → "GPT-5.6-Luna", for the lines the Reviewer writes. */
function reviewerLabel(ref: string) {
  const { model } = splitModel(ref);
  return model.replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/^(.)/, (c) => c.toUpperCase()).replace(/^Gpt/, "GPT");
}

export type { Finding };
