/*
  Runs turns. For each message it opens (or reuses) the session's provider connection,
  snapshots the project, turns the provider's stream into timeline items, holds approvals,
  questions and plans until you answer, and closes the turn with a checkpoint of what changed.

  A session with a lead talks to the lead (read only). It answers talk and questions itself;
  a request for a change ends in a plan you approve, and then the coder builds it. Messages you write while a turn runs wait in the queue and go as
  one message when it ends; a steer reaches the agent at its next step instead.

  A routed session (route.ts) picks for each message who writes and who reads: one model alone,
  a cascade (a quick model writes, a judge passes it or hands it to the strong model to repair),
  or a critique (the strong model writes, critics read it side by side, it revises once).
*/
import { spawn } from "node:child_process";
import type { Access, Effort, Finding, Item, PlanEntry, PrTestResult, ProviderId, ProviderInfo, Question, Risk, Settings, Thread, Usage } from "../../contracts/src/index.ts";
import { castOf, emptyUsage, familyOf, PR_TEST_TOOL, smallChange, splitModel } from "../../contracts/src/index.ts";
import { capture, changes, isRepo, PATCH } from "./checkpoints.ts";
import { run, THREAD_ENV } from "./exec.ts";
import { testCommand, testSummary } from "./prflow.ts";
import { answerPrompt, assignments, claudeTeam, critiquePrompt, fixPrompt, parseFindings, parseStep, quickOf, repairPrompt, reviewerFor, reviewPrompt, stepPrompt, takeOverPrompt } from "./review.ts";
import { decide, hintOf } from "./route.ts";
import { cursor, grok, hermes, opencode } from "./providers/acp.ts";
import { accountProvider, addedProvider } from "./providers/added.ts";
import { claude } from "./providers/claude.ts";
import { codex } from "./providers/codex.ts";
import { demo } from "./providers/demo.ts";
import { ResumeFailed, type Provider, type ProviderSession, type TurnSink, type ToolUpdate, type WakeTurn } from "./providers/types.ts";
import { attachNote } from "./providers/attachments.ts";
import type { AgentTools } from "./agent-tools.ts";
import { briefOf } from "./agents.ts";
import { memoryNote } from "./memory.ts";
import { commandRisk, readsOnly, ruleFor } from "./risk.ts";
import { uid, type Store } from "./store.ts";

export const providers: Record<ProviderId, Provider> = { claude, codex, hermes, opencode, cursor, grok, demo };

/** Your other accounts and the agents you added, as tools beside the known ones. Run whenever they change. */
export function syncProviders(s: Settings) {
  for (const id of Object.keys(providers) as ProviderId[]) if (id.includes(".")) delete providers[id];
  for (const a of s.accounts ?? []) if (a.provider !== "demo" && providers[a.provider]) providers[`${a.provider}.${a.id}`] = accountProvider(providers[a.provider], a);
  for (const a of s.addedAgents ?? []) providers[`acp.${a.id}`] = addedProvider(a);
}

type Live = { session: ProviderSession; provider: ProviderId; key: string };
/** heard: when its tool last said anything (text, a step, tokens). quiet: the watchdog said so already. */
type Turn = { abort: AbortController; started: number; session?: ProviderSession; turn: number; heard?: number; quiet?: boolean };
/** How long a turn may say nothing before the watchdog says so: longer while one of its commands runs (a build, the tests). */
export const QUIET_MS = 4 * 60_000;
export const QUIET_STEP_MS = 12 * 60_000;
/**
  show: put your message on the timeline. prompt: what the agent is sent, when it differs from what shows. note: a line under your message (what a route chose).
  files: your attachments, saved on disk. wake: a turn the tool began by itself, run on the session that began it instead of sending a message.
*/
type TurnOptions = { show?: boolean; anchor?: { file: string; line: number; endLine?: number }; review?: boolean; prompt?: string; note?: string; files?: string[]; wake?: { session: ProviderSession; w: WakeTurn } };
/** What's sent on your behalf to carry a turn on (after a restart, or when a usage window reopens). */
const CONTINUE = "Continue where you left off.";
/** The notice a turn that carries on after a restart starts with; counted, so a turn that brings the engine down can't loop. */
const CARRIED = "Liner Code stopped while this turn ran, so it carries on where it left off.";
const GAVE_UP = "Liner Code stopped mid-turn again";
/** A cascade's judge, and the strong model a change it won't pass goes to. */
type Cascade = { judge: string; strong: string };
/** How many times the Reviewer sends work back before it's yours. */
const ROUNDS = 2;
/** A command that reaches outside this Mac: a push, a merge or a post, a send, a copy to another machine. */
const OUTWARD = /\bgit\s+push\b|\bgh\s+(?:\w+\s+)?(?:merge|create|close|edit|comment|review|delete|reopen)\b|\bgh\s+api\b.*(?:-X|--method|-f\b|-F\b|--field|--input)|\b(?:curl|wget)\b.*(?:\s-d\b|--data|\s-F\b|--form|\s-T\b|--upload-file|-X\s*(?:POST|PUT|DELETE|PATCH)|--post-)|\b(?:ssh|scp|rsync|sftp|nc)\s/i;
type Waiter<T> = { resolve: (v: T) => void; reject: (e: Error) => void };

export class Runtime {
  private live = new Map<string, Live>();
  private turns = new Map<string, Turn>();
  private watchdog: NodeJS.Timeout;
  private approvals = new Map<string, Waiter<{ allow: boolean; reason?: string }>>();
  private questions = new Map<string, Waiter<Record<string, string> | null>>();
  private proposals = new Map<string, Waiter<{ approve: boolean; note?: string; plan?: string }>>();
  /** "Don't ask again for … this session", per thread. */
  private rules = new Map<string, Set<string>>();
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
  /** Threads a routine is working in right now, with nobody watching. */
  private unattended = new Set<string>();
  /** Keys you added, by provider; handed to the tools that use them, never written to disk. */
  keys = new Map<string, string>();
  /** What's installed, kept up to date by the API, for choosing a Reviewer. */
  providerInfo: ProviderInfo[] = [];
  private store: Store;
  private env: NodeJS.ProcessEnv;

  private tools?: AgentTools;
  /** The running totals each open session last reported (Codex reports totals, not each step). */
  private totals = new WeakMap<ProviderSession, Partial<Usage>>();
  /** A turn a tool began by itself while the thread was busy: it runs when the thread is free, before your queue. */
  private wakes = new Map<string, { agentId: string; planning: boolean; session: ProviderSession; w: WakeTurn }>();
  /** Limits already carried on from when their window reopened, by thread and reset time, so each goes once. */
  private reopened = new Set<string>();

  constructor(store: Store, env: NodeJS.ProcessEnv, tools?: AgentTools) {
    this.store = store;
    this.env = env;
    this.tools = tools;
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
    if (!n) this.halted.delete(threadId);
    this.busy.set(threadId, n + 1);
    try {
      return await work();
    } finally {
      const left = (this.busy.get(threadId) ?? 1) - 1;
      if (left > 0) this.busy.set(threadId, left);
      else {
        this.busy.delete(threadId);
        if (!this.halted.delete(threadId)) this.drain(threadId);
        // You pressed Stop: a turn the tool began by itself meanwhile stops too, like the rest of the work.
        else this.dropWake(threadId);
      }
    }
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
    this.store.patchThread(threadId, { queue: [] });
    const files = queued.flatMap((q) => q.files ?? []);
    void this.send(threadId, queued.map((q) => q.text).join("\n\n"), "queue", undefined, files.length ? files : undefined).catch(() => {});
  }

  /**
    The tool began a turn by itself (T3 Code: ClaudeAdapterV2.ts, its wake turns): it runs as a turn
    of its own, now if the thread is free, else when the work in flight ends. After you pressed Stop
    it stops too, unseen, as your queue waits.
  */
  private wake(threadId: string, agentId: string, planning: boolean, w: WakeTurn) {
    const session = this.live.get(`${threadId}:${agentId}`)?.session;
    const t = this.store.threads.find((x) => x.id === threadId);
    if (!session || !t || t.archived || this.halted.has(threadId)) return w.cancel();
    if (this.isRunning(threadId)) {
      this.wakes.get(threadId)?.w.cancel();
      this.wakes.set(threadId, { agentId, planning, session, w });
      return;
    }
    void this.hold(threadId, () => this.wakeNow(threadId, { agentId, planning, session, w })).catch(() => {});
  }
  private wakeNow(threadId: string, k: { agentId: string; planning: boolean; session: ProviderSession; w: WakeTurn }) {
    if (!k.w.pending() || this.halted.has(threadId)) return Promise.resolve();
    const name = this.resolve(this.store.thread(threadId), k.agentId).agent.name;
    return this.turnNow(threadId, "", k.agentId, k.planning, { show: false, review: false, wake: { session: k.session, w: k.w }, note: `${name} carries on by itself${k.w.why ? `: ${k.w.why}` : ", with no message from you"}.` });
  }
  private dropWake(threadId: string) {
    this.wakes.get(threadId)?.w.cancel();
    this.wakes.delete(threadId);
  }

  /** What an agent runs on in a thread: the thread's own model if set, else the agent's. A routed session's writer is the model its route put to work. */
  resolve(t: Thread, agentId = t.agent) {
    const root = agentId === t.agent ? t.route?.root : undefined;
    const agent = this.store.agent(root ? `@${root}` : agentId);
    const own = agentId === t.agent ? (root ?? t.model) : undefined;
    const { provider, model } = splitModel(own ?? agent.model);
    const asked: Effort = (agentId === t.agent ? t.effort : undefined) ?? agent.effort;
    // A level this model doesn't take (picked for another model) becomes the model's own default.
    const info = this.providerInfo.find((p) => p.id === provider)?.models.find((m) => m.id === model);
    const effort = info?.efforts?.length && !info.efforts.some((e) => e.id === asked) ? (info.defaultEffort ?? asked) : asked;
    return { agent, provider, model, effort, access: t.access };
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

  /** The provider session for an agent in a thread. `fresh`: it starts a conversation of its own, knowing nothing yet. */
  private async session(t: Thread, agentId: string, cwd: string, planning: boolean): Promise<{ session: ProviderSession; fresh: boolean; switched: boolean }> {
    const r = this.resolve(t, agentId);
    const access: Access = planning ? "read" : r.access;
    // A Claude Code agent (not a bare model) brings its subagents, and its run mode may change its model. A side chat brings none: it only answers.
    const team = familyOf(r.provider) === "claude" && !agentId.startsWith("@") && !planning && !t.sideOf && !t.model ? claudeTeam(r.agent, r.model) : { model: r.model, agents: {} };
    const liveKey = `${t.id}:${agentId}`;
    const key = `${r.provider}|${team.model}|${r.effort}|${access}|${planning}|${Object.keys(team.agents).join(",")}`;
    const cur = this.live.get(liveKey);
    if (cur && cur.key === key) return { session: cur.session, fresh: false, switched: false };
    if (cur && cur.provider === r.provider && cur.session.update && !planning) {
      // Same provider, new settings: change them in place where the provider can.
      if (await cur.session.update({ model: team.model, effort: r.effort, access })) {
        cur.key = key;
        return { session: cur.session, fresh: false, switched: false };
      }
    }
    cur?.session.close();
    this.live.delete(liveKey);
    const p = providers[r.provider] ?? demo;
    const forking = this.realFork(t) && agentId === t.agent;
    // A provider session id is kept as "<provider>:<id>" per agent, so it only resumes into the one that made it.
    const saved = (agentId === t.lead && agentId !== t.agent ? t.leadSession : t.providerSession) ?? "";
    const resume = saved.startsWith(`${r.provider}:`) ? saved.slice(r.provider.length + 1) : undefined;
    const session = p.open({
      cwd,
      model: team.model,
      subagents: team.agents,
      effort: r.effort,
      access,
      planning,
      soul: [
        planning ? [briefOf(r.agent, cwd), leadRules(this.resolve(t).agent.name, (t.helpers ?? []).map((h) => this.store.agent(h)).map((a) => `${a.name} (${a.role})`))].filter(Boolean).join("\n\n") : t.sideOf ? [briefOf(r.agent, cwd), SIDE_RULES].filter(Boolean).join("\n\n") : briefOf(r.agent, cwd),
        this.tools ? TOOLS_NOTE : "",
        memoryNote(this.store.home, t.projectId),
      ]
        .filter(Boolean)
        .join("\n\n"),
      side: Boolean(t.sideOf),
      resume: forking ? t.forkSession!.slice(t.forkSession!.indexOf(":") + 1) : resume,
      fork: forking,
      guard: this.store.settings.guardDestructive,
      // Tagged with the session, so a dev server the agent starts shows in this session's Browser.
      env: { ...this.envFor(r.provider), [THREAD_ENV]: t.id },
      // The session's Browser and Device, and pages shown in it, as tools.
      mcp: this.tools?.serverFor(t.id) ?? undefined,
      // A turn it begins by itself (a background task finished) shows as a turn of its own.
      wake: (w) => (this.live.get(liveKey)?.session === session ? this.wake(t.id, agentId, planning, w) : w.cancel()),
    });
    this.live.set(liveKey, { session, provider: r.provider, key });
    // A saved session from another tool can't carry over: the new one gets the conversation as text.
    return { session, fresh: !resume && !forking, switched: Boolean(saved) && !saved.startsWith(`${r.provider}:`) };
  }

  /** Only Claude Code can branch a session in place, on the same account; other forks get the conversation as text. */
  private realFork(t: Thread) {
    const { provider } = this.resolve(t);
    return familyOf(provider) === "claude" && Boolean(t.forkSession?.startsWith(`${provider}:`));
  }

  /** You sent a message. While a turn runs it waits in the queue, or steers the running turn. */
  async send(threadId: string, text: string, mode: "queue" | "steer" = "queue", anchor?: TurnOptions["anchor"], files?: string[]) {
    const store = this.store;
    const running = this.turns.get(threadId);
    if (running || this.busy.has(threadId)) {
      // A steer the tool couldn't take (its request failed, or the turn ended first) isn't lost: it goes
      // next, from the queue (T3 Code: SteeringCompletion.integration.test.ts).
      if (mode === "steer" && running?.session?.steer && (await running.session.steer([text, attachNote(files ?? [])].filter(Boolean).join("\n\n"), files))) {
        store.putItem(threadId, { kind: "user", id: uid("it"), turn: running.turn, at: Date.now(), text, steer: true, ...(files?.length ? { files } : {}) });
        return;
      }
      const t = store.thread(threadId);
      store.patchThread(threadId, { queue: [...(t.queue ?? []), { id: uid("q"), text, at: Date.now(), ...(files?.length ? { files } : {}) }] });
      // The turn ended while the steer was tried: nothing in flight will send the queue now.
      if (!this.isRunning(threadId)) this.drain(threadId);
      return;
    }
    return this.hold(threadId, () => this.dispatch(threadId, text, anchor, files));
  }

  /** A message to a thread with nothing in flight: to the lead, a route, a pull request or the agent. */
  private async dispatch(threadId: string, text: string, anchor?: TurnOptions["anchor"], files?: string[]) {
    const store = this.store;
    const t = store.thread(threadId);
    // Past its spending cap: your message is the go-ahead for another cap's worth.
    const cap = store.settings.capUsd ?? 0;
    if (cap > 0 && t.usage.costUsd >= (t.spendLimit ?? cap)) {
      store.patchThread(threadId, { spendLimit: t.usage.costUsd + cap });
      store.putItem(threadId, { kind: "notice", id: uid("it"), turn: t.turns, at: Date.now(), text: `Going on: another $${cap} for this session before it stops again.` });
    }
    // A side chat only answers: no pull request, route or lead, and nothing for the Reviewer.
    if (t.sideOf) return this.turn(threadId, text, t.agent, false, { review: false, files });
    if (!anchor && !files?.length && isPrAsk(text)) return this.openPr(threadId, text);
    if (!anchor && t.route) return this.routed(threadId, text, files);
    // With a lead, your message goes to the lead, who answers or plans; otherwise straight to the agent.
    // A question about lines in the diff goes to whoever wrote them.
    // A question about lines goes to whoever wrote last: a setup's last stage, else the session's agent.
    const who = anchor ? (t.stages?.length ? t.stages[t.stages.length - 1].who : t.agent) : (t.lead ?? t.agent);
    // Straight to a setup's first stage: it's told its part, and who takes the change on after it.
    const part = !anchor && !t.lead ? this.partOf(t, 0) : "";
    await this.turn(threadId, text, who, Boolean(t.lead) && !anchor, { anchor, review: !anchor, files, ...(part ? { prompt: `${text}\n\n${part}` } : {}) });
  }

  /**
    A routed session's message: the route says who writes it and who reads it after (route.ts).
    The writer works in the session's own conversation; judges and critics read on the side.
  */
  private async routed(threadId: string, text: string, files?: string[]) {
    const store = this.store;
    const route = store.thread(threadId).route!;
    const d = decide(text, route);
    // A follow-up that stays with the model working now carries on its job, repair and all.
    const escalated = d.reuse && route.last?.escalated ? { escalated: true } : {};
    store.patchThread(threadId, { route: { ...route, root: d.writer, last: { at: Date.now(), weight: d.weight, pattern: d.pattern, ...escalated } } });
    await this.turn(threadId, text, store.thread(threadId).agent, false, { review: false, files, note: hintOf(d, (ref) => this.labelOf(ref)) });
    const t = store.thread(threadId);
    const turn = t.turns;
    const changed = store.timeline(threadId).some((x) => x.kind === "checkpoint" && x.turn === turn);
    // Stopped, waiting on you, or your next message already started: nothing more to read.
    if (t.status === "done" && !this.turns.has(threadId)) {
      const cascade = d.pattern === "cascade" ? { judge: d.judge!, strong: d.repair! } : undefined;
      if (cascade && changed) await this.review(threadId, turn, 1, undefined, cascade);
      // A quick model that changed nothing may not have done it at all: the judge reads its answer instead.
      else if (cascade) await this.judgeAnswer(threadId, turn, text, cascade);
      else if (d.pattern === "critique" && changed) await this.critique(threadId, turn, d.critics);
    }
    // The cache's clock starts when the work ends.
    const now = store.thread(threadId).route;
    if (now?.last) store.patchThread(threadId, { route: { ...now, last: { ...now.last, at: Date.now() } } });
  }

  /**
    A cascade whose writer changed nothing: the judge reads what it said. An answer that does the
    ask (a question, a check) passes; one that should have changed something and didn't goes to
    the strong model to do, and the judge reads that change once.
  */
  private async judgeAnswer(threadId: string, turn: number, ask: string, cascade: Cascade) {
    const store = this.store;
    let t = store.thread(threadId);
    const answer = store.timeline(threadId).flatMap((x) => (x.turn === turn && x.kind === "text" ? [x.text] : [])).join("\n\n");
    const cwd = t.worktree?.path ?? store.project(t.projectId).path;
    const started = Date.now();
    const base: Extract<Item, { kind: "review" }> = { kind: "review", id: uid("it"), turn, at: started, reviewer: cascade.judge, round: 1, status: "running", findings: [] };
    store.putItem(threadId, base);
    t = store.patchThread(threadId, { status: "running", verdict: { state: "checking", round: 1 } });
    const abort = new AbortController();
    this.turns.set(threadId, { abort, started, turn: t.turns });
    let found: ReturnType<typeof parseFindings> = null;
    try {
      found = parseFindings(await this.quiet(threadId, cascade.judge, cwd, answerPrompt(ask, answer), abort.signal, "judge"));
    } catch {
      // Stopped, or the judge's tool failed: the answer stands as it is.
    } finally {
      this.turns.delete(threadId);
    }
    const seconds = (Date.now() - started) / 1000;
    if (!found || abort.signal.aborted) {
      store.putItem(threadId, { ...base, status: "error", summary: abort.signal.aborted ? "You stopped the judge." : "The judge didn't give a verdict.", seconds });
      store.patchThread(threadId, { status: "done", verdict: undefined });
      return;
    }
    store.putItem(threadId, { ...base, status: found.verdict === "pass" ? "passed" : "blocked", findings: found.findings, summary: found.summary, seconds });
    if (found.verdict === "pass") {
      store.patchThread(threadId, { status: "done", verdict: { state: "verified", note: found.summary, round: 1 } });
      return;
    }
    const writer = this.labelOf(t.route?.root ?? cascade.judge);
    store.patchThread(threadId, { verdict: { state: "blocked", note: found.summary, round: 1 }, ...(t.route ? { route: { ...t.route, root: cascade.strong, last: t.route.last ? { ...t.route.last, escalated: true } : undefined } } : {}) });
    store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: `The judge says ${writer} didn't get it done, so ${this.labelOf(cascade.strong)} takes it on.` });
    await this.turn(threadId, takeOverPrompt(this.labelOf(cascade.judge), writer, found.summary ?? "", found.findings), t.agent, false, { show: false, review: false });
    const after = store.thread(threadId);
    const changed = store.timeline(threadId).some((x) => x.kind === "checkpoint" && x.turn === after.turns);
    if (after.status === "done" && changed) await this.review(threadId, after.turns, 2, undefined, cascade);
    else if (after.status === "done") store.patchThread(threadId, { verdict: undefined });
  }

  /** "codex:gpt-6-luna" as its tool calls it ("GPT-6 Luna"), for the lines routes and reviews write. */
  labelOf(ref: string) {
    const { provider, model } = splitModel(ref);
    return this.providerInfo.find((p) => p.id === provider)?.models.find((m) => m.id === model)?.label ?? reviewerLabel(ref);
  }

  /** "Create PR": no agent turn, the PR card itself opens the pull request in the chat. */
  private openPr(threadId: string, text: string) {
    const store = this.store;
    const t = store.thread(threadId);
    const turn = t.turns + 1;
    const title = t.title === "New session" || t.title === "New thread" ? titleFrom(text) : t.title;
    store.patchThread(threadId, { turns: turn, title, archived: false, done: false, snoozedUntil: undefined });
    store.putItem(threadId, { kind: "user", id: uid("it"), turn, at: Date.now(), text });
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
    if (!(t.access === "auto" || t.access === "review" || t.access === "full" || this.unattended.has(threadId) || (rule && this.rules.get(threadId)?.has(rule)))) {
      const id = uid("it");
      store.putItem(threadId, { kind: "approval", id, turn, at: Date.now(), tool: PR_TEST_TOOL, title: `Run ${command}`, description: "Runs the project's tests on this Mac before the pull request goes up.", risk: commandRisk(command), fields: [{ label: "Command", value: command }, { label: "Where", value: cwd }], rule, state: "asking" });
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
    const child = spawn(env.SHELL || "/bin/zsh", ["-c", command], { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const take = (d: Buffer) => {
      out += d.toString("utf8");
      if (out.length > 400000) out = out.slice(-200000);
      timer ??= setTimeout(() => ((timer = undefined), put("running")), 250);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        // already gone
      }
    };
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
    await this.goalTurn(threadId, text, true);
  }
  private async goalTurn(threadId: string, text: string, first: boolean) {
    const t = this.store.thread(threadId);
    if (t.goal?.status !== "active") return;
    this.store.patchThread(threadId, { goal: { ...t.goal, turns: t.goal.turns + 1 } });
    const ask = first
      ? `${text}\n\n(This is a goal: work toward it now and keep going across turns. Check it's really met, by running what proves it. When it is, end your reply with the line GOAL MET. If you can't get there, say why and end with GOAL BLOCKED.)`
      : `Keep going toward the goal: ${text}\n\n(When it's met and checked, end with GOAL MET. If you're stuck, say why and end with GOAL BLOCKED.)`;
    await this.turn(threadId, first ? `/goal ${text}` : ask, t.agent, false, { show: first, prompt: first ? ask : undefined, review: false });
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
    void this.goalTurn(threadId, g.text, false);
    return true;
  }

  /** One turn by one agent. One that would start after you pressed Stop (a helper's part of a plan, a fix round) doesn't. */
  private turn(threadId: string, text: string, agentId: string, planning: boolean, o: TurnOptions = {}): Promise<void> {
    return this.hold(threadId, () => (this.halted.has(threadId) ? Promise.resolve() : this.turnNow(threadId, text, agentId, planning, o)));
  }
  private async turnNow(threadId: string, text: string, agentId: string, planning: boolean, o: TurnOptions = {}) {
    const show = o.show ?? true;
    const store = this.store;
    let t = store.thread(threadId);
    const project = store.project(t.projectId);
    const cwd = t.worktree?.path ?? project.path;
    const turn = t.turns + 1;
    const abort = new AbortController();
    const live: Turn = { abort, started: Date.now(), turn };
    this.turns.set(threadId, live);
    const before = { ...emptyUsage(), ...t.usage };
    const title = t.title === "New session" || t.title === "New thread" ? titleFrom(text) : t.title;
    t = store.patchThread(threadId, { status: "running", turns: turn, title, archived: false, done: false, snoozedUntil: undefined, turnBy: agentId });
    const r = this.resolve(t, agentId);
    const marker: Item = { kind: "turn", id: uid("it"), turn, at: Date.now(), agent: agentId, model: `${r.provider}:${r.model}`, planning, status: "running" };
    if (show) store.putItem(threadId, { kind: "user", id: uid("it"), turn, at: Date.now(), text, ...(o.anchor ? { anchor: o.anchor } : {}), ...(o.files?.length ? { files: o.files } : {}) });
    if (o.note) store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: o.note });
    store.putItem(threadId, marker);

    let prompt = o.prompt ? o.prompt : o.anchor ? `About ${o.anchor.file}:${o.anchor.line}${o.anchor.endLine && o.anchor.endLine !== o.anchor.line ? `-${o.anchor.endLine}` : ""} in your last change:\n\n${text}` : text;
    // Your attachments are named only in what the agent is sent; the timeline shows them as files.
    if (o.files?.length) prompt = `${prompt}\n\n${attachNote(o.files)}`;

    // A side chat shares its session's folder and changes nothing, so it takes no snapshot: what
    // the session edits meanwhile would read as the side chat's change.
    const git = !t.sideOf && (await isRepo(cwd));
    const from = git ? await capture(cwd, `${threadId}/${turn}-before`) : null;
    // Said, not hidden: a turn with no snapshot can't be shown as a diff or taken back.
    const unsnapped = "Couldn't snapshot this turn, so its changes can't be shown or undone.";
    if (git && !from) store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: unsnapped });
    const sink = this.sink(threadId, turn, abort.signal, agentId, planning);
    let failed = false;
    let ran = false;
    try {
      // A turn the tool began by itself runs on the session that began it, as it is.
      const { session, fresh, switched } = o.wake ? { session: o.wake.session, fresh: false, switched: false } : await this.session(t, agentId, cwd, planning);
      live.session = session;
      // Stopped while the snapshot was taken or the tool was opening: the turn never starts.
      if (abort.signal.aborted) throw new Error("stopped");
      // A session that starts knowing nothing (another tool took over, a fork that can't branch in
      // place, a rewind) gets the conversation so far, so the work carries on where it was.
      const earlier = store.timeline(threadId).filter((x) => x.turn < turn);
      if (fresh && r.provider !== "demo" && earlier.some((x) => x.kind === "user" || x.kind === "text")) {
        prompt = `${handoff(earlier, switched ? "switch" : t.forkSession !== undefined ? "fork" : "restart")}\n\n${prompt}`;
        if (switched && show) store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: `${this.providerInfo.find((p) => p.id === r.provider)?.label ?? r.provider} takes over here, with the conversation so far.` });
      }
      const go = (p: string) => (o.wake ? o.wake.w.run(sink.api, abort.signal) : session.turn(p, sink.api, abort.signal, o.files));
      ran = true;
      try {
        await go(prompt);
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
        const key = `${threadId}:${agentId}`;
        this.live.get(key)?.session.close();
        this.live.delete(key);
      }
    } finally {
      sink.end();
      this.turns.delete(threadId);
    }
    // When Claude's prompt cache for this thread likely runs out: an hour after its last turn on a plan,
    // five minutes with an API key. Past it a long thread is read again at full price (T3 Code: IdleCompaction.ts).
    if (ran && familyOf(r.provider) === "claude") store.patchThread(threadId, { cacheUntil: Date.now() + (r.provider === "claude" && store.settings.claudeBilling === "key" && this.keys.get("anthropic") ? 5 : 60) * 60_000 });

    const stopped = abort.signal.aborted;
    if (stopped) store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: "You stopped this turn." });
    const seconds = (Date.now() - live.started) / 1000;
    if (git && from) {
      const to = await capture(cwd, `${threadId}/${turn}-after`);
      // Only what the turn wrote: a pull or checkout it ran brings files it didn't.
      const files = to ? await changes(cwd, from, to, { turn: true }) : [];
      if (!to) store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: unsnapped });
      if (to && files.length) store.putItem(threadId, { kind: "checkpoint", id: uid("it"), turn, at: Date.now(), files, from, to, seconds });
    }
    const errored = failed || sink.errored();
    // A lead that only talked (a greeting, a question) just answered. One that wrapped a plan in
    // <plan> tags hands it over: the plan becomes a card to approve and leaves the text.
    if (planning && !stopped && !errored && !sink.proposed()) {
      for (const x of store.timeline(threadId)) {
        if (x.turn !== turn || x.kind !== "text") continue;
        const found = takePlan(x.text);
        if (!found) continue;
        store.putItem(threadId, { ...x, text: found.rest || `Here's the plan for ${this.resolve(t).agent.name}.` });
        store.putItem(threadId, { kind: "proposal", id: uid("it"), turn, at: Date.now(), title: found.title || planTitle(found.plan) || t.title, plan: found.plan, state: "asking" });
        break;
      }
    }
    store.putItem(threadId, { ...marker, status: stopped ? "stopped" : errored ? "error" : "done", seconds });

    t = store.thread(threadId);
    this.logUsage(t, agentId, before, seconds);
    // A side chat starts with a copy of its session's timeline; only its own turns can wait on you.
    const asking = store.timeline(threadId).some((x) => x.turn > (t.sideFrom ?? 0) && (x.kind === "proposal" || x.kind === "question" || x.kind === "approval") && x.state === "asking");
    const limited = sink.limited();
    t = store.patchThread(threadId, { status: limited ? "limited" : errored ? "error" : asking ? "waiting" : "done", limit: limited ?? undefined, forkSession: undefined, toReview: this.toReview(threadId), unread: true });
    // You're looking at a side chat when you ask in it, so it doesn't notify.
    if (!stopped && !t.sideOf) {
      const who = this.resolve(t, agentId).agent.name;
      const kind = errored || limited ? "error" : asking ? "waiting" : "done";
      store.emit({ type: "notify", threadId, kind, title: limited ? `${who} hit its usage limit` : errored ? `${who} ran into a problem` : asking ? `${who} needs you` : `${who} is done`, body: limited?.until ? `${t.title}. It resets ${new Date(limited.until).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}.` : t.title });
    }
    // Carrying on by itself, when you said so in Settings and another tool is ready.
    if (limited) {
      const lim = store.timeline(threadId).findLast((x) => x.kind === "limit" && x.turn === turn);
      if (!stopped && store.settings.onLimit === "carry" && lim?.kind === "limit" && lim.fallback) void this.carryOn(threadId, lim.fallback).catch(() => {});
      return;
    }
    // A goal that isn't met yet takes the next turn itself.
    if (agentId === store.thread(threadId).agent && (await this.afterGoal(threadId, turn, stopped, errored || asking))) return;
    // What you wrote while it worked goes next (when the hold ends), instead of the Reviewer.
    if ((store.thread(threadId).queue ?? []).length && !stopped && !asking) return;
    // A coder's change goes to the Reviewer before it's yours.
    const changed = store.timeline(threadId).some((x) => x.kind === "checkpoint" && x.turn === turn);
    if (o.review !== false && !planning && !stopped && !errored && !asking && changed && agentId === store.thread(threadId).agent) await this.afterWriting(threadId, turn);
  }

  /**
    The Reviewer: another model family reads this turn's change against fixed criteria. A
    blocking finding goes back to the coder, up to ROUNDS times (or your own number); after that it's yours.
    In a cascade it's the judge: a change it won't pass goes to the strong model to repair, and
    it reads the repair once more.
  */
  review(threadId: string, turn: number, round: number, since?: string, cascade?: Cascade): Promise<void> {
    return this.hold(threadId, () => (this.halted.has(threadId) ? Promise.resolve() : this.reviewNow(threadId, turn, round, since, cascade)));
  }
  private async reviewNow(threadId: string, turn: number, round: number, since?: string, cascade?: Cascade): Promise<void> {
    const store = this.store;
    let t = store.thread(threadId);
    // Fixes go back to whoever wrote last: a setup's last stage, or the session's agent.
    const fixer = t.stages?.length ? t.stages[t.stages.length - 1].who : t.agent;
    const agent = store.agent(fixer);
    // A setup says who checks; "auto" is another family than the last stage's model. A routed session's judge checks it.
    const ref = cascade ? cascade.judge : t.route ? t.route.cast.judge : t.checks ? (t.checks.by === "auto" ? reviewerFor({ ...agent, subagents: { ...agent.subagents, reviewer: "auto" } }, this.providerInfo) : t.checks.by) : reviewerFor(agent, this.providerInfo);
    if (!ref) return;
    const who = cascade ? "judge" : "Reviewer";
    const cp = [...store.timeline(threadId)].reverse().find((x) => x.kind === "checkpoint" && x.turn <= turn && !x.reverted);
    if (cp?.kind !== "checkpoint" || !cp.from || !cp.to) return;
    const cwd = t.worktree?.path ?? store.project(t.projectId).path;
    // A few lines, or only docs, aren't worth a second model's full read (unless you ask for it).
    // A fix for its own findings is always read again.
    if (round === 1 && !store.settings.reviewSmall) {
      const numstat = (await run("git", ["diff", "--relative", "--numstat", since ?? cp.from, cp.to], { cwd, timeout: 60000 })).stdout;
      if (smallChange(numstat)) {
        store.putItem(threadId, { kind: "notice", id: uid("it"), turn: cp.turn, at: Date.now(), text: `A small change, so the ${who} let it through. Settings › Agentic features has it read these too.` });
        return;
      }
    }
    // After several stages, the whole change from before the first one.
    const diff = (await run("git", ["diff", "--relative", ...PATCH, "-U3", since ?? cp.from, cp.to], { cwd, timeout: 60000 })).stdout;
    const ask = this.askOf(threadId);
    const id = uid("it");
    const started = Date.now();
    const base: Extract<Item, { kind: "review" }> = { kind: "review", id, turn: cp.turn, at: started, reviewer: ref, round, status: "running", findings: [] };
    store.putItem(threadId, base);
    t = store.patchThread(threadId, { status: "running", verdict: { state: "checking", round } });
    const abort = new AbortController();
    this.turns.set(threadId, { abort, started, turn: t.turns });
    let found: ReturnType<typeof parseFindings> = null;
    let failed = "";
    try {
      const out = await this.quiet(threadId, ref, cwd, reviewPrompt(ask, cut(diff), round, cascade ? "judge" : "reviewer"), abort.signal, cascade ? "judge" : "reviewer");
      found = parseFindings(out);
      if (!found) failed = `The ${who} didn't give a verdict.`;
    } catch (e) {
      failed = abort.signal.aborted ? "You stopped the review." : e instanceof Error ? e.message : String(e);
    } finally {
      this.turns.delete(threadId);
    }
    const seconds = (Date.now() - started) / 1000;
    if (!found) {
      store.putItem(threadId, { ...base, status: "error", summary: failed, seconds });
      store.patchThread(threadId, { status: "done", verdict: undefined });
      return;
    }
    const blocking = found.findings.filter((f) => f.severity === "blocking");
    const passed = found.verdict === "pass" && !blocking.length;
    store.putItem(threadId, { ...base, status: passed ? "passed" : "blocked", findings: found.findings, summary: found.summary, seconds });
    if (passed) {
      store.patchThread(threadId, { status: "done", verdict: { state: "verified", note: found.summary, round } });
      return;
    }
    // A cascade reads twice at most: the first change, then the strong model's repair.
    const rounds = cascade ? 2 : Math.min(3, Math.max(1, t.checks?.rounds ?? store.settings.reviewRounds ?? ROUNDS));
    if (round >= rounds) {
      const note = `${blocking.length} ${blocking.length === 1 ? "finding" : "findings"} still blocking after ${rounds === 1 ? "one round" : `${rounds} rounds`}`;
      t = store.patchThread(threadId, { status: "waiting", verdict: { state: "blocked", note, round } });
      store.emit({ type: "notify", threadId, kind: "waiting", title: `The ${who} needs you`, body: `${t.title}: ${note}` });
      return;
    }
    store.patchThread(threadId, { verdict: { state: "blocked", note: found.summary, round } });
    const n = `${blocking.length} ${blocking.length === 1 ? "finding" : "findings"}`;
    if (cascade && t.route) {
      // The strong model takes the session's conversation over to repair it, and keeps it while the job lasts.
      store.patchThread(threadId, { route: { ...t.route, root: cascade.strong, last: t.route.last ? { ...t.route.last, escalated: true } : undefined } });
      store.putItem(threadId, { kind: "notice", id: uid("it"), turn: cp.turn, at: Date.now(), text: `The judge didn't pass it: ${n} go to ${this.labelOf(cascade.strong)} to repair.` });
      await this.turn(threadId, repairPrompt(this.labelOf(ref), this.labelOf(t.route.root), found.findings), t.agent, false, { show: false, review: false });
    } else {
      store.putItem(threadId, { kind: "notice", id: uid("it"), turn: cp.turn, at: Date.now(), text: `The Reviewer sent ${n} back to ${agent.name}.` });
      await this.turn(threadId, fixPrompt(reviewerLabel(ref), blocking), fixer, false, { show: false, review: false });
    }
    const after = store.thread(threadId);
    if (after.status === "done") await this.review(threadId, after.turns, round + 1, since, cascade);
  }

  /**
    Critique: critics from other families read the change side by side, read only, and the writer
    gets everything they found at once to keep or revise its change, once. A change they all pass
    is done; the revision isn't read again.
  */
  private async critique(threadId: string, turn: number, critics: string[]) {
    const store = this.store;
    let t = store.thread(threadId);
    const cp = store.timeline(threadId).find((x) => x.kind === "checkpoint" && x.turn === turn);
    if (cp?.kind !== "checkpoint" || !cp.from || !cp.to || !critics.length) return;
    const cwd = t.worktree?.path ?? store.project(t.projectId).path;
    const diff = (await run("git", ["diff", "--relative", ...PATCH, "-U3", cp.from, cp.to], { cwd, timeout: 60000 })).stdout;
    const prompt = reviewPrompt(this.askOf(threadId), cut(diff), 1, "critic");
    const abort = new AbortController();
    this.turns.set(threadId, { abort, started: Date.now(), turn: t.turns });
    store.patchThread(threadId, { status: "running", verdict: { state: "checking", round: 1 } });
    const reads = await Promise.all(
      critics.map(async (ref) => {
        const started = Date.now();
        const base: Extract<Item, { kind: "review" }> = { kind: "review", id: uid("it"), turn, at: started, reviewer: ref, round: 1, status: "running", findings: [] };
        store.putItem(threadId, base);
        const done = (patch: Partial<typeof base>) => store.putItem(threadId, { ...base, ...patch, seconds: (Date.now() - started) / 1000 });
        try {
          const found = parseFindings(await this.quiet(threadId, ref, cwd, prompt, abort.signal, "critic"));
          done(found ? { status: found.verdict === "pass" ? "passed" : "blocked", findings: found.findings, summary: found.summary } : { status: "error", summary: "This critic didn't give a verdict." });
          return found;
        } catch (e) {
          done({ status: "error", summary: abort.signal.aborted ? "You stopped the critique." : e instanceof Error ? e.message : String(e) });
          return null;
        }
      }),
    );
    this.turns.delete(threadId);
    const got = reads.filter((r): r is NonNullable<typeof r> => Boolean(r));
    if (abort.signal.aborted || !got.length) {
      store.patchThread(threadId, { status: "done", verdict: undefined });
      return;
    }
    const findings = got.flatMap((r) => r.findings);
    if (got.every((r) => r.verdict === "pass")) {
      store.patchThread(threadId, { status: "done", verdict: { state: "verified", note: got.length > 1 ? `${got.length} critics passed it` : got[0].summary, round: 1 } });
      return;
    }
    t = store.patchThread(threadId, { verdict: undefined });
    const r = this.resolve(t);
    store.putItem(threadId, { kind: "notice", id: uid("it"), turn, at: Date.now(), text: `${findings.length} ${findings.length === 1 ? "finding goes" : "findings go"} back to ${this.labelOf(`${r.provider}:${r.model}`)}, to keep or revise once.` });
    await this.turn(threadId, critiquePrompt([...new Set(critics.map((c) => this.labelOf(c)))], findings), t.agent, false, { show: false, review: false });
  }

  /**
    Reviewer decides, for one step: the Reviewer's quickest model reads it with the ask and says
    ALLOW or ASK. Null when there's no Reviewer, or it gave no call within 40 seconds; you decide then.
  */
  private async stepCall(threadId: string, req: { title: string; fields: { label: string; value: string }[]; risk: Risk }, signal: AbortSignal) {
    const t = this.store.thread(threadId);
    const reviewer = reviewerFor(this.resolve(t).agent, this.providerInfo);
    if (!reviewer) return null;
    const model = quickOf(reviewer, this.providerInfo);
    const ask = this.store.timeline(threadId).findLast((x) => x.kind === "user");
    const cwd = t.worktree?.path ?? this.store.project(t.projectId).path;
    const out = await this.quiet(threadId, model, cwd, stepPrompt(ask?.kind === "user" ? ask.text : "", req, cwd), AbortSignal.any([signal, AbortSignal.timeout(40_000)]), "reviewer").catch(() => "");
    const call = parseStep(out);
    return call && { ...call, model };
  }

  /** Runs one read-only turn on any model without putting it on the timeline; returns what it wrote. */
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
  async quiet(threadId: string, ref: string, cwd: string, prompt: string, signal: AbortSignal, as = "reviewer"): Promise<string> {
    const { provider, model } = splitModel(ref);
    const p = providers[provider] ?? demo;
    const session = p.open({ cwd, model, effort: "medium", access: "read", soul: "", guard: true, env: this.envFor(provider) });
    let text = "";
    // Its own tokens and cost, apart from the thread's, so reads side by side don't count each other's.
    const own = emptyUsage();
    const sink: TurnSink = {
      text: (d) => void (text += d),
      reasoning: () => {},
      tool: () => {},
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
    try {
      await session.turn(prompt, sink, signal);
    } finally {
      session.close();
      const t = this.store.thread(threadId);
      this.store.logUsage({ at: Date.now(), threadId, projectId: t.projectId, agent: as, provider, model, inputTokens: own.inputTokens, outputTokens: own.outputTokens, cacheReadTokens: own.cacheReadTokens, costUsd: own.costUsd, seconds: (Date.now() - started) / 1000 });
    }
    return text;
  }

  private logUsage(t: Thread, agentId: string, before: Usage, seconds: number) {
    const r = this.resolve(t, agentId);
    const after = t.usage;
    const d = (k: "inputTokens" | "outputTokens" | "cacheReadTokens" | "costUsd") => Math.max(0, (after[k] ?? 0) - (before[k] ?? 0));
    this.store.logUsage({ at: Date.now(), threadId: t.id, projectId: t.projectId, agent: agentId, provider: r.provider, model: r.model, inputTokens: d("inputTokens"), outputTokens: d("outputTokens"), cacheReadTokens: d("cacheReadTokens"), costUsd: d("costUsd"), seconds });
  }

  /** Files from finished turns that are neither committed nor undone. */
  toReview(threadId: string) {
    const pending = new Set<string>();
    for (const it of this.store.timeline(threadId)) if (it.kind === "checkpoint" && !it.reverted && !it.committed) for (const f of it.files) pending.add(f.path);
    return pending.size;
  }

  stop(threadId: string) {
    if (this.busy.has(threadId)) this.halted.add(threadId);
    this.turns.get(threadId)?.abort.abort();
    this.prStops.get(threadId)?.abort();
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

  answer(threadId: string, itemId: string, allow: boolean, reason?: string, always?: boolean) {
    const item = this.store.item(threadId, itemId);
    if (item.kind !== "approval") throw new Error("That isn't a request.");
    const waiter = this.approvals.get(itemId);
    if (!waiter) {
      if (item.state === "asking") this.store.putItem(threadId, { ...item, state: "expired" });
      throw new Error("The agent stopped waiting for this answer.");
    }
    this.approvals.delete(itemId);
    if (allow && always && item.rule) this.rules.set(threadId, new Set([...(this.rules.get(threadId) ?? []), item.rule]));
    this.store.putItem(threadId, { ...item, state: allow ? "approved" : "denied", reason });
    this.settleWaiting(threadId);
    waiter.resolve({ allow, reason });
  }

  answerQuestion(threadId: string, itemId: string, answers?: Record<string, string>) {
    const item = this.store.item(threadId, itemId);
    if (item.kind !== "question") throw new Error("That isn't a question.");
    const waiter = this.questions.get(itemId);
    this.questions.delete(itemId);
    this.store.putItem(threadId, { ...item, state: answers ? "answered" : "skipped", answers });
    this.settleWaiting(threadId);
    if (waiter) waiter.resolve(answers ?? null);
    // Asked after its turn ended (an agent that can't wait): the answer goes as your next message.
    else if (answers) void this.send(threadId, Object.entries(answers).map(([q, a]) => `${q}\n${a}`).join("\n\n"));
  }

  answerProposal(threadId: string, itemId: string, approve: boolean, note?: string, edited?: string) {
    const original = this.store.item(threadId, itemId);
    if (original.kind !== "proposal") throw new Error("That isn't a plan.");
    if (original.state !== "asking") throw new Error("That plan was already answered.");
    // A lead's plan starts its own turn, which can't run beside another one.
    if (!this.proposals.has(itemId) && this.isRunning(threadId)) throw new Error("Wait for the turn to finish, then answer the plan.");
    // You may have edited the steps before approving: the plan that runs is yours.
    const item = edited?.trim() ? { ...original, plan: edited.trim() } : original;
    this.store.putItem(threadId, { ...item, state: approve ? "approved" : "changed", note });
    const waiter = this.proposals.get(itemId);
    this.proposals.delete(itemId);
    if (waiter) {
      // The agent waited in its turn (plan mode): it carries on, now allowed to edit.
      if (approve) this.store.patchThread(threadId, { access: "edits" });
      this.settleWaiting(threadId);
      waiter.resolve({ approve, note, plan: approve && edited?.trim() ? edited.trim() : undefined });
      return;
    }
    const t = this.store.thread(threadId);
    this.store.patchThread(threadId, { status: "idle" });
    if (approve) void this.build(threadId, item.plan);
    else if (note) void this.turn(threadId, note, t.lead ?? t.agent, Boolean(t.lead));
  }

  /**
    What you asked in a session, for a Reviewer, a judge or a critic: your messages and the plans
    you approved, the last six, earliest first, with the one this change answers marked. With only
    the first ask, a later one ("add a Reset button") read as work nobody asked for.
  */
  private askOf(threadId: string) {
    const asks = this.store.timeline(threadId).flatMap((x) => (x.kind === "user" && !x.text.startsWith("/") ? [x.text.trim()] : x.kind === "proposal" && x.state === "approved" ? [`(a plan you approved) ${x.title}`] : [])).slice(-6);
    if (asks.length < 2) return asks[0] ?? this.store.thread(threadId).title;
    return asks.map((a, i) => `${i === asks.length - 1 ? "The latest ask, which this change is for" : `An earlier ask (${i + 1} of ${asks.length})`}:\n${a.slice(0, 1500)}`).join("\n\n");
  }

  /** What a setup's stage is told about its part, and who takes its change on after it. Nothing for a lone writer with no job. */
  private partOf(t: Thread, i: number) {
    const stages = t.stages ?? [];
    const s = stages[i];
    if (!s || (stages.length < 2 && !s.job.trim())) return "";
    const next = stages[i + 1];
    const job = (x: string) => x.trim().replace(/[.\s]+$/, "");
    return [
      s.job.trim() ? `Your part in this team: ${job(s.job)}.` : "",
      next ? `After you, ${this.store.agent(next.who).name} takes your change on${next.job.trim() ? ` to ${job(next.job).charAt(0).toLowerCase()}${job(next.job).slice(1)}` : ""}, so do your part well and leave that to them.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  /**
    The writer's change, on through a setup's later stages (each takes it on with its own job,
    handed the ask and the change so far), then to the Reviewer, who reads the whole change from
    before the first stage. Anything that stops a stage (you, a limit, a question) stops the rest.
  */
  private async afterWriting(threadId: string, turn: number) {
    const store = this.store;
    const stages = store.thread(threadId).stages ?? [];
    const first = store.timeline(threadId).find((x) => x.kind === "checkpoint" && x.turn === turn);
    const from = first?.kind === "checkpoint" ? first.from : undefined;
    let last = turn;
    for (let i = 1; i < stages.length; i++) {
      if (store.thread(threadId).status !== "done") return;
      await this.turn(threadId, await this.handOff(threadId, i, from), stages[i].who, false, { show: false, review: false });
      last = store.thread(threadId).turns;
    }
    if (store.thread(threadId).status !== "done") return;
    await this.review(threadId, last, 1, stages.length > 1 ? from : undefined);
  }

  /** What the next stage is handed: your ask, the change so far, and its part. */
  private async handOff(threadId: string, i: number, from?: string) {
    const t = this.store.thread(threadId);
    const cwd = t.worktree?.path ?? this.store.project(t.projectId).path;
    const cps = this.store.timeline(threadId).filter((x) => x.kind === "checkpoint" && !x.reverted);
    const to = cps.length ? (cps[cps.length - 1] as Extract<Item, { kind: "checkpoint" }>).to : undefined;
    const diff = from && to ? (await run("git", ["diff", "--relative", ...PATCH, "-U3", from, to], { cwd, timeout: 60000 })).stdout : "";
    const prev = this.store.agent(t.stages![i - 1].who).name;
    return [
      `${prev} just made a change for this ask, and now it's yours to take on.`,
      `What the user asked for:\n<ask>\n${this.askOf(threadId).slice(0, 4000)}\n</ask>`,
      diff ? `The change so far (a unified diff):\n<diff>\n${diff.length > 40000 ? `${diff.slice(0, 40000)}\n… (the rest is cut off)` : diff}\n</diff>` : "",
      this.partOf(t, i) || "Your part: take the change on and make it better.",
      "Work on the files as they are now. Keep what works, and end by saying in a line or two what you changed.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /** A plan nobody is watching for (a cost test): approved as it stands, and built before this returns. */
  async approvePlan(threadId: string, itemId: string) {
    const item = this.store.item(threadId, itemId);
    if (item.kind !== "proposal" || item.state !== "asking") return;
    this.store.putItem(threadId, { ...item, state: "approved" });
    this.store.patchThread(threadId, { status: "idle" });
    await this.build(threadId, item.plan);
  }

  /** An approved plan: the coder builds its steps, then any helper the lead gave steps to does theirs, held as one piece of work. */
  private build(threadId: string, plan: string) {
    return this.hold(threadId, () => this.buildNow(threadId, plan));
  }
  private async buildNow(threadId: string, plan: string) {
    const t = this.store.thread(threadId);
    const helpers = (t.helpers ?? []).map((id) => this.store.agent(id)).filter((a) => a.id !== t.agent);
    const given = assignments(plan, helpers.map((a) => a.name));
    const part = this.partOf(t, 0);
    // The writer's change goes through the setup's stages and the Reviewer before the crew starts.
    await this.turn(threadId, `Here is the plan that was approved. Carry it out${given.size ? ", except the steps given to someone else" : ""}.${part ? ` ${part}` : ""}\n\n${plan}`, t.agent, false, { show: false });
    for (const a of helpers) {
      const steps = given.get(a.name);
      if (!steps?.length || this.store.thread(threadId).status !== "done") continue;
      await this.turn(threadId, `These steps of the approved plan are yours. Carry them out.\n\n${steps.join("\n")}\n\nThe whole plan, for context:\n${plan}`, a.id, false, { show: false, review: false });
    }
  }

  /** Back to running once nothing in a running turn waits on you. */
  private settleWaiting(threadId: string) {
    const still = this.store.timeline(threadId).some((x) => (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking");
    if (!still && this.turns.has(threadId)) this.store.patchThread(threadId, { status: "running" });
  }

  closeThread(threadId: string) {
    this.stop(threadId);
    for (const [key, l] of this.live) {
      if (!key.startsWith(`${threadId}:`)) continue;
      l.session.close();
      this.live.delete(key);
    }
    this.rules.delete(threadId);
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
      l.session.close();
      this.live.delete(key);
    }
  }

  /**
    Who carries on when `provider` runs out of usage (Hermes Agent's fallbacks): another account of
    the same tool first, on the same model when it has it, since it's the same work on another
    quota; else the everyday pick among the other families' ready tools.
  */
  fallbackFor(provider: ProviderId, model: string): string | undefined {
    const ready = this.providerInfo.filter((p) => p.available && p.adapter && p.id !== "demo" && p.id !== provider && p.models.length);
    const twin = ready.find((p) => familyOf(p.id) === familyOf(provider));
    if (twin) return `${twin.id}:${twin.models.some((m) => m.id === model) ? model : (twin.models.find((m) => m.isDefault) ?? twin.models[0]).id}`;
    return castOf(ready.filter((p) => familyOf(p.id) !== familyOf(provider)))?.everyday;
  }

  /** A limited session carries on with another tool's model: the conversation goes over with it, then it continues where it stopped. */
  async carryOn(threadId: string, model?: string) {
    const t = this.store.thread(threadId);
    const limit = this.store.timeline(threadId).findLast((x) => x.kind === "limit");
    const to = model ?? (limit?.kind === "limit" ? limit.fallback : undefined);
    if (!to) throw new Error("No other tool is ready to carry on with.");
    const from = this.resolve(t);
    // On another model the limit no longer holds the session, so the message below can go (straight away, or when the limited turn's hold ends).
    this.store.patchThread(threadId, { ...(t.route ? { route: { ...t.route, root: to } } : { model: to }), ...(t.status === "limited" ? { status: "idle" as const, limit: undefined } : {}) });
    this.store.putItem(threadId, { kind: "notice", id: uid("it"), turn: t.turns, at: Date.now(), text: `${this.labelOf(`${from.provider}:${from.model}`)} is out of usage, so ${this.labelOf(to)} carries on with the conversation so far.` });
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
      if (t.status !== "limited" || !until || now < until + 60_000 || t.archived || t.sideOf || (t.snoozedUntil ?? 0) > now || this.isRunning(t.id)) continue;
      const key = `${t.id}:${until}`;
      if (this.reopened.has(key)) continue;
      this.reopened.add(key);
      const said = this.store.timeline(t.id).findLast((x) => x.kind === "limit");
      if (said && said.at >= until) continue;
      const tool = this.providerInfo.find((p) => p.id === t.limit?.provider)?.label ?? t.limit?.provider ?? "The tool";
      this.store.patchThread(t.id, { status: "idle", limit: undefined });
      this.store.putItem(t.id, { kind: "notice", id: uid("it"), turn: t.turns, at: now, text: `${tool}'s usage window reopened, so this session carries on by itself.` });
      void this.send(t.id, CONTINUE).catch(() => {});
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
    if (this.store.settings.continueAfterRestart === false) return [];
    const went: string[] = [];
    for (const t of this.store.threads) {
      // The store leaves a thread that was working idle and unread.
      if (t.status !== "idle" || !t.unread || t.archived || t.sideOf || t.trial || t.routine || (t.snoozedUntil ?? 0) > now || this.isRunning(t.id)) continue;
      const items = this.store.timeline(t.id);
      const last = items.findLast((x) => x.kind === "turn");
      if (last?.kind !== "turn" || last.status !== "stopped" || last.turn !== t.turns) continue;
      const of = items.filter((x) => x.turn === last.turn);
      if (of.some((x) => (x.kind === "notice" && (x.text === "You stopped this turn." || x.text.startsWith(GAVE_UP))) || ((x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "expired"))) continue;
      const note = (text: string) => this.store.putItem(t.id, { kind: "notice", id: uid("it"), turn: last.turn, at: now, text });
      if (items.filter((x) => x.kind === "notice" && x.text === CARRIED && now - x.at < 5 * 60_000).length >= 3) {
        note(`${GAVE_UP}: it carried on three times in five minutes, so it waits for you now.`);
        continue;
      }
      note(CARRIED);
      const who = t.turnBy ?? t.agent;
      const planning = Boolean(t.lead) && who === t.lead && t.lead !== t.agent;
      // What it had running didn't survive the restart, and won't report back (T3 Code: RestartBackgroundNote.ts).
      const prompt = `${CONTINUE}\n\n(Liner Code restarted while you worked, so any command or background task you had running was stopped before it finished. It won't report back on its own: run again what you still need, and wait for its result.)`;
      void this.turn(t.id, CONTINUE, who, planning, { prompt, review: !planning }).catch(() => {});
      went.push(t.id);
    }
    return went;
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

  shutdown() {
    clearInterval(this.watchdog);
    for (const id of this.turns.keys()) this.stop(id);
    for (const l of this.live.values()) l.session.close();
  }

  /** The sink a provider writes one turn into, and what it built. */
  private sink(threadId: string, turn: number, signal: AbortSignal, agentId: string, planning: boolean) {
    const store = this.store;
    const blocks = new Map<string, string>(); // provider block → item id
    const tools = new Map<string, { id: string; started: number }>();
    let streaming: string[] = [];
    let plan: string | null = null;
    let errored = false;
    let limit: { message: string; until?: number; provider: string } | null = null;
    let proposed = false;
    let lastKind: "text" | "reasoning" | null = null;
    let lastBlock = "";
    /** What this turn asked you that may still be waiting, and whether the turn has ended. */
    const pending = new Set<string>();
    let over = false;
    /** Keyed notices (see TurnSink.notice) → their items. */
    const notices = new Map<string, string>();
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
          if (it && "state" in it && it.state === "asking") store.putItem(threadId, { ...it, state: "expired" } as Item);
          reject(new Error("stopped"));
        };
        // A signal that's already aborted never fires again: settle it now.
        if (sig.aborted || signal.aborted) return gone();
        pending.add(id);
        sig.addEventListener("abort", gone, { once: true });
        signal.addEventListener("abort", gone, { once: true });
      });
    const needsYou = (title: string) => {
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
        if (over) return;
        heard();
        settle();
        lastKind = null;
        let rec = tools.get(u.key);
        if (!rec) {
          rec = { id: uid("it"), started: Date.now() };
          tools.set(u.key, rec);
        }
        const prev = store.timeline(threadId).find((x) => x.id === rec!.id);
        const base = prev?.kind === "tool" ? prev : undefined;
        // Saved when it starts and when it ends; what it prints meanwhile only goes to the window.
        store.putItem(
          threadId,
          {
            kind: "tool",
            id: rec.id,
            turn,
            at: base?.at ?? Date.now(),
            tool: u.tool,
            toolKind: u.toolKind,
            title: u.title || base?.title || u.tool,
            input: u.input ?? base?.input,
            output: u.output ?? base?.output,
            path: u.path ?? base?.path,
            status: u.status,
            seconds: u.status === "running" ? undefined : (Date.now() - rec.started) / 1000,
          },
          !base || u.status !== "running",
        );
      },
      plan: (entries: PlanEntry[]) => {
        heard();
        plan ??= uid("it");
        const prev = store.timeline(threadId).find((x) => x.id === plan);
        store.putItem(threadId, { kind: "plan", id: plan, turn, at: prev?.at ?? Date.now(), entries });
      },
      approve: (req, sig) => {
        // Allowed for the rest of the session already.
        if (req.rule && this.rules.get(threadId)?.has(req.rule)) return Promise.resolve({ allow: true });
        // A routine runs with nobody watching: it may do what can be undone, never what can't, and
        // nothing that leaves this Mac (a push, a merge, a post): the routine's gate does that, or you do.
        if (this.unattended.has(threadId)) {
          const command = req.fields.find((f) => f.label === "Command")?.value ?? "";
          return Promise.resolve(req.risk === "high" || OUTWARD.test(command) ? { allow: false, reason: "Routines don't run commands that can't be undone or that reach outside this Mac. Leave it for the person." } : { allow: true });
        }
        // A cost test runs with nobody watching too, on a task that only needs edits: edits go ahead, and so does reading
        // (Codex reads files with commands), anything else is declined.
        if (store.thread(threadId).trial) {
          const command = req.fields.find((f) => f.label === "Command")?.value ?? req.title.replace(/^Run /, "");
          return Promise.resolve(/edit|write|patch|filechange|notebook/i.test(req.tool) || readsOnly(command) ? { allow: true } : { allow: false, reason: "This is a short cost test: read and edit the files without running anything." });
        }
        const toolId = req.key ? tools.get(req.key)?.id : undefined;
        const access = store.thread(threadId).access;
        const command = req.fields.find((f) => f.label === "Command")?.value;
        // Auto: the tool's own auto mode lets through what it can; of what it hands over, reading and editing go ahead.
        if (access === "auto" && req.risk !== "high" && (command === undefined ? /edit|write|patch/i.test(req.tool) : readsOnly(command))) return Promise.resolve({ allow: true });
        const ask = (note?: string) => {
          // Stopped while the Reviewer read the step: nothing to ask about.
          if (sig.aborted || signal.aborted) return Promise.resolve({ allow: false });
          settle();
          const id = uid("it");
          store.putItem(threadId, { kind: "approval", id, turn, at: Date.now(), tool: req.tool, title: req.title, description: [note, req.description].filter(Boolean).join("\n\n") || undefined, risk: req.risk, fields: req.fields, rule: req.rule, state: "asking", toolId });
          needsYou(req.title);
          return wait(this.approvals, id, sig);
        };
        // Reviewer decides: reading goes ahead, what can't be undone comes to you, the Reviewer calls the rest.
        if (access === "review" && req.risk !== "high") {
          if (command !== undefined && readsOnly(command)) return Promise.resolve({ allow: true });
          return this.stepCall(threadId, req, sig).then((call) => {
            if (!call?.allow) return ask(call ? `${this.labelOf(call.model)}, reviewing: ${call.reason}` : undefined);
            settle();
            store.putItem(threadId, { kind: "approval", id: uid("it"), turn, at: Date.now(), tool: req.tool, title: req.title, risk: req.risk, fields: req.fields, rule: req.rule, state: "approved", reason: call.reason, toolId, reviewer: call.model });
            return { allow: true };
          });
        }
        return ask();
      },
      ask: (questions: Question[], sig) => {
        // Nobody answers in a cost test: the agent carries on with its own best guess.
        if (store.thread(threadId).trial) return Promise.resolve(null);
        settle();
        const id = uid("it");
        store.putItem(threadId, { kind: "question", id, turn, at: Date.now(), questions, state: "asking" });
        needsYou(questions[0]?.question ?? "A question");
        return wait(this.questions, id, sig);
      },
      propose: (title, text, sig) => {
        if (store.thread(threadId).trial && !planning) return Promise.resolve({ approve: true });
        settle();
        proposed = true;
        const id = uid("it");
        store.putItem(threadId, { kind: "proposal", id, turn, at: Date.now(), title, plan: text, state: "asking" });
        // A lead's plan outlives its turn: the answer starts the coder, not this turn.
        if (planning) return new Promise(() => {});
        needsYou(title);
        return wait(this.proposals, id, sig);
      },
      usage: (u: Partial<Usage>, total) => {
        heard();
        const t = store.thread(threadId);
        const cur = { ...emptyUsage(), ...t.usage };
        // A session's running totals add what's new since its last report, so what other models
        // used in the thread (a judge, a repair, an earlier tool) stays counted.
        const session = this.turns.get(threadId)?.session;
        const seen = (total && session && this.totals.get(session)) || {};
        const add = (k: "inputTokens" | "outputTokens" | "cacheReadTokens" | "costUsd") => {
          if (u[k] === undefined) return;
          cur[k] += total ? Math.max(0, (u[k] as number) - (seen[k] ?? 0)) : (u[k] as number);
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
        if (agentId === t.lead && agentId !== t.agent) {
          if (t.leadSession !== ref) store.patchThread(threadId, { leadSession: ref });
        } else if (t.providerSession !== ref) store.patchThread(threadId, { providerSession: ref });
      },
      notice: (text, key) => {
        settle();
        // A keyed notice says the same thing again as it changes (a retry's count): one line, kept up to date.
        const id = (key && notices.get(key)) || uid("it");
        if (key) notices.set(key, id);
        const prev = store.timeline(threadId).find((x) => x.id === id);
        store.putItem(threadId, { kind: "notice", id, turn, at: prev?.at ?? Date.now(), text });
      },
      heard: () => void (!over && heard()),
      error: (message) => {
        settle();
        errored = true;
        store.putItem(threadId, { kind: "error", id: uid("it"), turn, at: Date.now(), message });
      },
      limited: (message, until) => {
        settle();
        if (limit) return;
        const r = this.resolve(store.thread(threadId), agentId);
        limit = { message, until, provider: r.provider };
        store.putItem(threadId, { kind: "limit", id: uid("it"), turn, at: Date.now(), message, until, provider: r.provider, fallback: this.fallbackFor(r.provider, r.model) });
      },
    };
    return {
      api,
      errored: () => errored,
      limited: () => limit,
      proposed: () => proposed,
      end: () => {
        settle();
        over = true;
        // A call with no result at the end didn't finish: stopped, or the tool broke off.
        for (const [, rec] of tools) {
          const it = store.timeline(threadId).find((x) => x.id === rec.id);
          if (it?.kind === "tool" && it.status === "running") store.putItem(threadId, { ...it, status: signal.aborted || errored ? "failed" : "done", seconds: (Date.now() - rec.started) / 1000 });
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
      },
    };
  }
}

/**
  What every agent is told when Liner Code's tools come with it. Without it, a tool with a
  computer-use plugin of its own (Codex, say) reached for that to check a page, outside the app.
*/
const TOOLS_NOTE = [
  "Liner Code runs this session. Its own tools (the `liner` MCP server) reach what the person sees beside this chat:",
  "- browser_open opens a page of what you build in their Browser: a dev server on this Mac (localhost:5173, or just a port) or an HTML file in this folder (index.html), which needs no server. browser_read, browser_click, browser_type, browser_press and browser_screenshot then use that page, and report its console errors. On a canvas (a game), click a point with x and y, or press keys.",
  "- show_page shows them a chart, a table or a mockup in the chat.",
  "- memory_add saves a fact about this project that later sessions start with; sessions_search looks through earlier sessions here.",
  "Check web pages you build or change with these tools, not with any other browser or computer-use tool, and open the page again after each edit.",
].join("\n");

/** What a side chat is told on top of its soul: the session goes on without it, and it only reads. */
const SIDE_RULES = [
  "This is a side chat beside a Liner Code session. The user is asking you about that session on the side while it carries on: what was done, why, how the code works, what to try next.",
  "Answer directly. Read files and search the project as you need, but don't edit anything or plan changes to make: nothing said here goes back into the session.",
].join("\n");

/**
  What a lead is told on top of its soul. Not every message is a task: it answers talk and
  questions itself, and only a request to change something ends in a plan for the coder.
*/
function leadRules(coder: string, helpers: string[] = []) {
  return [
    ...(helpers.length ? [`Besides ${coder}, you can give plan steps to: ${helpers.join(", ")}. End such a step with "— @Name"; steps without a name go to ${coder}.`] : []),
    `You are the lead in a Liner Code session, and ${coder} is the coder who builds what you plan. You can read the project and run read-only commands, but you never edit files yourself.`,
    "Not every message is a task. When the user says hello, chats, or asks a question, answer it directly and stop: no plan, no questions about what to plan.",
    `When the user asks for a change to the project, read what you need, then end your reply with the plan inside <plan title="a short name"> … </plan>: the steps, the files each one touches, and how to check it works. The user approves it, then ${coder} builds it. Write at most one plan per reply.`,
  ].join("\n");
}

/** A plan a lead handed over in <plan> tags, and the text around it. */
export function takePlan(text: string): { title?: string; plan: string; rest: string } | null {
  const m = /<plan\b([^>]*)>([\s\S]*?)(?:<\/plan>|$)/.exec(text);
  if (!m || !m[2].trim()) return null;
  const title = /title\s*=\s*"([^"]*)"/.exec(m[1])?.[1]?.trim();
  return { title: title || undefined, plan: m[2].trim(), rest: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim() };
}

/** A plan's name: its first heading or first line. */
function planTitle(plan: string) {
  const line = plan.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
  return line.length > 70 ? `${line.slice(0, 68)}…` : line;
}

/** The first words of a first message, as a session's name. */
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

export function titleFrom(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 44 ? `${t.slice(0, 42).trimEnd()}…` : t || "New session";
}

/** The conversation so far, as plain text for an agent that wasn't there. */
/**
  The conversation so far, for a session that starts fresh. What you asked stays whole and the
  newest work comes first in the budget: older answers shrink, then drop, before your requests do.
*/
export function handoff(items: Item[], why: "switch" | "fork" | "restart" = "switch", budget = 24000) {
  const turns = new Map<number, string[]>();
  const add = (turn: number, line: string) => turns.set(turn, [...(turns.get(turn) ?? []), line]);
  for (const it of items) {
    if (it.kind === "user") add(it.turn, `You were asked: ${it.text}`);
    else if (it.kind === "text" && it.text.trim()) add(it.turn, `You answered: ${it.text.length > 2400 ? `${it.text.slice(0, 2400)}…` : it.text}`);
    else if (it.kind === "proposal" && it.state === "approved") add(it.turn, `The plan that was approved: ${it.title}\n${it.plan}`);
    else if (it.kind === "checkpoint" && it.files.length) add(it.turn, `Files changed${it.reverted ? " (since undone)" : it.committed ? ` (committed ${it.committed})` : ""}: ${it.files.map((f) => f.path).join(", ")}`);
    else if (it.kind === "tool" && (it.toolKind === "exec" || it.toolKind === "edit" || it.toolKind === "write")) add(it.turn, `(${it.title}${it.status === "failed" ? ", failed" : ""})`);
  }
  const blocks = [...turns.entries()].sort((a, b) => a[0] - b[0]).map(([, lines]) => lines.join("\n"));
  // Newest first into the budget; an older turn that doesn't fit keeps only what you asked.
  const kept: string[] = [];
  let used = 0;
  let dropped = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    let b = blocks[i];
    if (used + b.length > budget) b = b.split("\n").filter((l) => l.startsWith("You were asked:")).join("\n");
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

/** "codex:gpt-5.6-luna" → "GPT-5.6-Luna", for the lines the Reviewer writes. */
function reviewerLabel(ref: string) {
  const { model } = splitModel(ref);
  return model.replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/^(.)/, (c) => c.toUpperCase()).replace(/^Gpt/, "GPT");
}

export type { Finding };
