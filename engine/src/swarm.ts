/*
  Liner-native Teamwork & Swarm orchestrator. Runs across every CLI and API provider Liner Code
  drives (Claude Code, Codex, OpenCode, Hermes, Cursor, Grok, custom ACP and API endpoints) with no
  dependency on any provider's own swarm.

  RAM stays bounded through three rules:
  1. Never block an MCP call waiting for another agent. A worker posts to the shared board and ends
     its turn; the engine wakes it on the next @mention.
  2. Cap active worker CLI processes (`maxActive`, default 2) and hibernate waiting workers after
     `hibernateSec` seconds (or immediately when another worker is queued), closing their process to
     0 MB RAM and resuming by session id (or a compact board-state digest when a provider can't resume
     or after a cross-provider model swap).
  3. Run stall detection as a deterministic engine timer (0 MB RAM, 0 tokens) instead of spawning an
     LLM monitor worker.
*/
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentStep, EngineEvent, FileChange, Item, ProviderId, Settings, SwarmConfig, SwarmMember, SwarmMode, SwarmPause, SwarmPlan, SwarmPost, SwarmPreset, SwarmSnapshot, SwarmWorkspace, Thread, Usage } from "../../contracts/src/index.ts";
import { SWARM_ROSTER_MAX, SWARM_SELF_TURNS_MAX, clampSwarmHibernate, clampSwarmMax, emptyUsage, familyOf, parseMentions, parseScreenshots, validWorkerName } from "../../contracts/src/index.ts";
import { writeAtomic } from "./atomic.ts";
import { capture, changes, isRepo } from "./checkpoints.ts";
import { run } from "./exec.ts";
import { SWARM_ENV } from "./liner-tools.ts";
import { NOBODY } from "./sidekick.ts";
import { portOffsetFor, removeWorktree, resolveWorktreePath, submodules } from "./worktrees.ts";
import { ResumeFailed, type ApprovalRequest, type ProviderSession, type TurnSink } from "./providers/types.ts";

/** Suffix put on a worker's Liner MCP key (`<threadId>#swarm:<name>`) so the engine knows which worker called. */
export const AS_SWARM = "#swarm:";
/** How many recent board posts are kept in memory per active swarm; full history lives in `board.jsonl`. */
const BOARD_MEM_MAX = 200;
/** Maximum characters kept per post or auto-posted summary so context and RAM stay light. */
const POST_MAX = 4000;
/** Default cap for one worker wake turn (10 minutes, matching SIDEKICK_MS). */
export const SWARM_TURN_MS = 10 * 60_000;
/** Default interval for the deterministic stall detector (90 seconds). */
export const SWARM_STALL_MS = 90_000;
/** Maximum stall nudges sent for the same unchanged board head before going quiet. */
const STALL_MAX_ALERTS = 3;

export { SWARM_ENV };

/** Matches Liner Code's swarm tools under whichever prefix each CLI gives the `liner` MCP server. */
export const isSwarmTool = (tool: string) => /^(?:mcp__liner__|liner[._]|mcp__editor_liner_[0-9a-f]{8}__)swarm_(?:manage|post|read)$/.test(tool);

/** Parses a surface key's target into `{ threadId, worker? }` when it belongs to a swarm worker. */
export function parseSwarmTarget(who: string): { threadId: string; worker?: string } {
  const i = who.indexOf(AS_SWARM);
  return i < 0 ? { threadId: who } : { threadId: who.slice(0, i), worker: who.slice(i + AS_SWARM.length) };
}

/** Picks a new Swarm/Teamwork worker's model: uses configured `swarmWorkerModel` if ready and signed in, otherwise inherits the session's main model. */
export function pickSwarmWorkerModel(leadRef: string, configured: string | undefined, ready: (ref: string) => boolean): string {
  const picked = configured?.trim();
  if (picked && picked !== "same" && ready(picked)) return picked;
  return leadRef;
}

/** Rough resident memory estimate (MB) for an active worker process by provider family. Hibernated workers are always 0. */
export function estimatedRssMb(provider: ProviderId): number {
  const fam = familyOf(provider);
  if (fam === "opencode") return 6; // shared `opencode serve` daemon multiplexes workers in one process
  if (fam === "codex") return 95;
  if (fam === "claude") return 130;
  if (fam === "demo") return 1;
  return 105;
}

/** System instructions handed to the Coordinator beside toolsNote: `teamwork` runs a 2-level delegation tree; `swarm` runs a peer-to-peer shared message board. */
export function swarmCoordinatorRules(n: (tool: string) => string = (t) => t, preset: SwarmPreset = "squad", maxActive = 2, mode: SwarmMode = "teamwork") {
  const hermesHint = n("swarm_manage").includes("<tag>")
    ? `Its names end in __swarm_manage, __swarm_post and __swarm_read after a short session tag. If they aren't in your tool list, find them with tool_search ("swarm") and call them through tool_call.`
    : "";
  if (mode === "swarm") {
    return [
      `You are the Coordinator of a Liner Code Swarm (peer-to-peer shared message board). NEVER use built-in Agent, Task, or subagent tools — ALL worker orchestration MUST go through ${n("swarm_manage")}, ${n("swarm_post")}, and ${n("swarm_read")}.`,
      hermesHint,
      "Follow this peer-to-peer Swarm workflow — NEVER implement, edit files, or run broad exploration solo when workers have not been spawned yet:",
      `1. Auto-spawn peers FIRST: Immediately decompose the request into 2–4 non-overlapping peer workers and add them directly with ${n("swarm_manage")}{action: "add", name: "<short-id>", role: "<Role>", workspace: "share" | "inherit", mode: "write" | "read", brief: "..."}. Use workspace: "share" for parallel writers (isolated git worktree) and "inherit" for readers/verifiers. You can check available cross-provider models with action: "models", spawn homogeneous copies with n: <count>, sharded slices with tasks: ["slice 1", ...], or branch context from an existing member with fork: "<member>".`,
      `2. Overview plan: Right after adding workers, call ${n("swarm_manage")}{action: "plan", plan: {goal: {title, line}, tasks, threads}} where threads are 1–6 groups by the outcome they deliver (never by agent) and every worker sits in one. Rewrite the plan only when workers or goals change; status and blockers come from the board.`,
      "3. Visual timeline (UI/visual tasks only): Tell workers taking screenshots to include `Screenshot: <absolute path> | <what changed, max 10 words>` on its own line in their post.",
      `4. Async peer board: Workers talk directly to each other via @mentions and #channels (and may spawn their own helpers). Once briefs are posted, END YOUR TURN immediately without writing code yourself — never poll. Liner Code hibernates idle members to 0 MB RAM (max ${maxActive} active ${maxActive === 1 ? "process" : "processes"} at once) and wakes you on @coordinator.`,
      `5. Landing & finish: Use ${n("swarm_manage")}{action: "model", name, model, reason} to hot-swap a stuck worker's model (never kill & re-add for quota/model swaps). Never kill a worker whose worktree holds work: only the person merges a worktree into their checkout (Land in the Agents panel), so name the workers ready to land in your answer to the person, then post "[done] <summary>" via ${n("swarm_post")}.`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  const isAudit = preset === "audit";
  return [
    `You are the Teamwork Coordinator of a Liner Code Teamwork session. NEVER use built-in Agent, Task, or subagent tools — ALL delegation MUST go through ${n("swarm_manage")}, ${n("swarm_post")}, and ${n("swarm_read")}.`,
    hermesHint,
    "Follow this clean hierarchical Teamwork workflow (do NOT run broad searches or edits directly yourself):",
    `1. Scope check: If the request is already clear, mark the optional interviewer skipped with ${n("swarm_manage")}{action: "skip", name: "interviewer", role: "Task Interviewer", reason: "Requirements are clear"}. Only spawn an interviewer if critical ambiguity blocks starting.`,
    `2. Orchestration: Spawn a Project Orchestrator with ${n("swarm_manage")}{action: "add", name: "orchestrator", role: "Project Orchestrator", can_delegate: true, workspace: "inherit", mode: "read", brief: "..."}. It will decompose the goal into 2–5 non-overlapping domain specialists (e.g. "Backend & Engine Explorer", "UI & Shell Explorer", "Security & Provider Auditor") under itself${isAudit ? " (read-only explorers first, then a scoped fixer if edits were requested)" : " (using workspace: \"share\" for parallel writers and \"inherit\" for read-only explorers/verifiers)"}.`,
    `3. Set the Overview plan with ${n("swarm_manage")}{action: "plan", plan: {goal: {title, line}, tasks, threads}} and END YOUR TURN immediately. Never poll or wait in a loop — Liner Code hibernates idle members to 0 MB RAM (max ${maxActive} active ${maxActive === 1 ? "process" : "processes"} at once) and wakes you automatically when @orchestrator posts to @coordinator.`,
    `4. Verification: Once @orchestrator reports its synthesized findings or completed branches, spawn an independent Victory Auditor with ${n("swarm_manage")}{action: "add", name: "auditor", role: "Victory Auditor", workspace: "inherit", mode: "read", brief: "..."} to independently verify accuracy, completeness, and rubric satisfaction then deliver the final answer to the person, naming any worktree branches ready for them to land (only the person merges them, from the Agents panel), and post "[done] <summary>" via ${n("swarm_post")}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Turn-level directive prepended when Swarm or Teamwork is active and 0 workers exist yet, ensuring the coordinator delegates instead of coding solo. */
export function swarmCoordinatorDirective(mode: SwarmMode, n: (tool: string) => string = (t) => t): string {
  if (mode === "swarm") {
    return `[Swarm Coordinator directive: Swarm mode is ON and 0 peer workers have been added yet. Do NOT edit files or implement this task solo. Your FIRST step on this turn MUST be calling ${n("swarm_manage")} with action: "add" to spawn 2–4 non-overlapping peer workers (workspace: "share" for parallel writers, "inherit" for readers/verifiers), then calling ${n("swarm_manage")} with action: "plan" to populate the Overview goal and outcome workstreams, then ENDING YOUR TURN immediately so Liner Code runs the workers and wakes you when they report back.]`;
  }
  return `[Teamwork Coordinator directive: Teamwork mode is ON and 0 subagents have been spawned yet. Do NOT run broad searches or edits solo. Your FIRST step on this turn MUST be marking the optional Task Interviewer skipped if requirements are clear (${n("swarm_manage")}{action: "skip", name: "interviewer", role: "Task Interviewer", reason: "Requirements are clear"}), spawning a Project Orchestrator (${n("swarm_manage")}{action: "add", name: "orchestrator", role: "Project Orchestrator", can_delegate: true, workspace: "inherit", mode: "read", brief: "..."}), setting the Overview plan, and ENDING YOUR TURN immediately so Liner Code runs the team and wakes you when @orchestrator reports back.]`;
}

/** System instructions handed to a worker: either a Teamwork orchestrator/specialist or a peer-to-peer Swarm worker. */
export function swarmWorkerRules(name: string, role: string, mode: "read" | "write", workspace: SwarmWorkspace, opts: { canDelegate?: boolean; parent?: string; swarmMode?: SwarmMode; n?: (tool: string) => string } = {}) {
  const n = opts.n ?? ((t: string) => t);
  const parent = opts.parent ?? "coordinator";
  const swarmMode = opts.swarmMode ?? "teamwork";
  const hermesHint = n("swarm_post").includes("<tag>")
    ? `If ${n("swarm_post")} isn't in your tool list, find it with tool_search ("swarm") and call it through tool_call.`
    : "";
  if (swarmMode === "swarm") {
    const canHelp = parent === "coordinator";
    return [
      `You are @${name} (${role}), a peer worker on a Liner Code Swarm shared message board${parent !== "coordinator" ? ` (helper added by @${parent})` : ""}. NEVER use built-in Agent, Task, or subagent tools.`,
      hermesHint,
      mode === "read"
        ? "You are strictly read-only: inspect files, search code, or run read-only verification checks, and never edit files."
        : workspace === "share"
          ? "You are working in your own isolated git worktree branch. Verify your changes with tests or typecheck before reporting."
          : "You share the session folder. Keep edits tightly scoped to your brief and verify before reporting.",
      `Coordinate peer-to-peer on the shared board via ${n("swarm_post")} (use @name to wake teammates or @${parent} directly; use #channels when relevant) and read updates with ${n("swarm_read")}.`,
      canHelp
        ? `You may also call ${n("swarm_manage")} to check status/models, spawn focused helpers of your own (action: "add" — they report back to @${name}), swap your own or your helpers' models, or kill helpers you added.`
        : `Report your concise, factual findings back to @${parent} using ${n("swarm_post")}. Do not spawn further helpers.`,
      "If you take a visual progress screenshot for UI work, put `Screenshot: <absolute path> | <what changed, max 10 words>` on its own line in your post.",
      "You cannot ask the person interactive questions directly. Post your update or handoff via swarm_post and END YOUR TURN immediately — never sleep or poll. Liner Code hibernates your process to 0 MB RAM while waiting and wakes you on the next @mention.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (opts.canDelegate) {
    return [
      `You are @${name} (${role}) in a Liner Code Teamwork session, reporting to @${parent}. NEVER use built-in Agent, Task, or subagent tools — use ONLY ${n("swarm_manage")}, ${n("swarm_post")}, and ${n("swarm_read")}.`,
      hermesHint,
      `Your job is to decompose your brief into 2–5 focused, non-overlapping specialist workers under yourself using ${n("swarm_manage")}{action: "add", name: "<short-id>", role: "<Descriptive Specialist Title>", workspace: "inherit" | "share", mode: "read" | "write", brief: "..."}.`,
      "Give every specialist a crisp descriptive role title (like 'Backend & Desktop Explorer', 'UI Code & Shell Explorer', 'Provider & Network Auditor') and a self-contained brief telling it to report back to @" + name + ".",
      `Once you have spawned your specialists, END YOUR TURN immediately — never poll or do their deep reading yourself. Liner Code hibernates you to 0 MB RAM while your specialists run and wakes you automatically as they post to @${name}.`,
      `After all of your specialists have reported back, synthesize their findings (or verify their worktree branches) into one structured, factual summary and post it to @${parent} via ${n("swarm_post")}, then end your turn.`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `You are @${name} (${role}), a specialist worker in a Liner Code Teamwork session reporting to @${parent}. Do only the work assigned to you, and NEVER spawn subagents of your own.`,
    hermesHint,
    mode === "read"
      ? "You are strictly read-only: inspect files, search code, or run read-only verification checks, and never edit files."
      : workspace === "share"
        ? "You are working in your own isolated git worktree branch. Verify your changes with tests or typecheck before reporting."
        : "You share the session folder. Keep edits tightly scoped to your brief and verify before reporting.",
    `Report your concise, factual findings (with exact file:line references) to @${parent} using ${n("swarm_post")} and check unread messages with ${n("swarm_read")}.`,
    "You cannot ask the person interactive questions directly. As soon as your piece is done, post your report via swarm_post and END YOUR TURN immediately — never sleep or poll. Liner Code hibernates your process to 0 MB RAM while waiting and wakes you on the next @mention.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Builds a worker's wake turn prompt: incremental when resuming a warm session, or a compact board-checkpoint digest when stateless/swapped. */
export function buildWakePrompt(member: SwarmMember, unread: SwarmPost[], opts: { stateless?: boolean; ownRecent?: SwarmPost[]; gitShort?: string; swappedReason?: string } = {}): string {
  const fmt = (p: SwarmPost) => `#${p.seq} [${p.channel}] @${p.from}${p.to.length ? ` -> ${p.to.map((x) => `@${x}`).join(" ")}` : ""}: ${p.text}`;
  const parts: string[] = [];
  if (opts.swappedReason) parts.push(`Note: Your model was switched (${opts.swappedReason}). Continue @${member.name}'s work from the board state below.`);
  if (opts.stateless) {
    parts.push(`Brief for @${member.name} (${member.role}):\n${member.brief}`);
    if (opts.ownRecent?.length) parts.push(`Your recent board posts:\n${opts.ownRecent.map(fmt).join("\n")}`);
    if (opts.gitShort) parts.push(`Current worktree status (${member.branch ?? member.workspace}):\n${opts.gitShort}`);
  }
  if (unread.length) parts.push(`New board messages since #${member.lastReadSeq}:\n${unread.map(fmt).join("\n")}`);
  else if (!opts.stateless) parts.push(`You were woken on the board. Continue your brief:\n${member.brief}`);
  parts.push(`When finished or waiting on someone, call swarm_post (e.g. addressing @coordinator or a teammate) and end your turn.`);
  return parts.join("\n\n");
}

type PersistedMember = SwarmMember & { sessionId?: string; swapped?: boolean; swapReason?: string; report?: string; steps?: AgentStep[]; tools?: number; turn?: number; createdAt?: number };
type PersistedSwarm = {
  threadId: string;
  mode?: SwarmMode;
  title?: string;
  active: boolean;
  maxActive: number;
  hibernateSec: number;
  stallMonitor: boolean;
  plan?: SwarmPlan;
  rootItemId?: string;
  rootTurn?: number;
  rootAt?: number;
  nextSeq: number;
  members: PersistedMember[];
  /** Turns the swarm started by itself since the person last did something: worker turns and coordinator wakes. */
  selfTurns?: number;
  /** Set while the team waits for the person (see SwarmPause). */
  paused?: SwarmPause;
  updatedAt: number;
};

type LiveWorker = {
  threadId: string;
  name: string;
  session: ProviderSession;
  provider: ProviderId;
  model: string;
  working: boolean;
  abort?: AbortController;
  hibernateTimer?: NodeJS.Timeout;
};

type SwarmRun = {
  data: PersistedSwarm;
  posts: SwarmPost[];
  queue: string[];
  /** Serialize writes when two writers share workspace "inherit". */
  inheritWriteBusy: boolean;
  stallState: { headSeq: number; alerts: number; pinged: Set<string>; lastAt: number };
  coordWakeQueued: boolean;
};

export type SwarmHost = {
  home: string;
  thread(id: string): Thread;
  projectPath(projectId: string): string;
  settings(): Settings;
  emit(event: EngineEvent): void;
  patchThread(id: string, patch: Partial<Thread>): Thread;
  resolveCoordinator(threadId: string): { provider: ProviderId; model: string; label: string; ref: string };
  resolveModel(modelRef: string): { provider: ProviderId; model: string; label: string; ref: string };
  defaultWorkerModel(threadId: string, role?: string): string;
  openWorkerSession(args: { threadId: string; member: SwarmMember; cwd: string; soul: string; resume?: string; portOffset?: number }): ProviderSession;
  isCoordinatorBusy(threadId: string): boolean;
  wakeCoordinator(threadId: string, text: string): Promise<void>;
  logUsage(rec: { at: number; threadId: string; projectId: string; agent: string; provider: ProviderId; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number; seconds: number }): void;
  approve(threadId: string, memberName: string, req: ApprovalRequest, signal: AbortSignal): Promise<{ allow: boolean; reason?: string; level?: boolean }>;
  /** Writes a native `task` item onto the thread's timeline so Fanout and AgentsSurface render the live Teamwork tree. */
  putItem?(threadId: string, item: Item): void;
  /** Current turn number for attaching Teamwork tree rows to the active turn. */
  turnOf?(threadId: string): number;
  /** Called before closing a worker's key/resources. */
  forgetWorkerKey?(threadId: string, worker: string): void;
  /** Resets the coordinator's provider session when enabling/disabling/switching Swarm mode so fresh MCP tools and permissions apply. */
  resetCoordinatorSession?(threadId: string): void;
  /** Lists available `<provider>:<model>` refs across configured CLIs and API endpoints for `swarm_manage{action: "models"}`. */
  listModels?(): { ref: string; label: string; provider: string }[];
};

/** What a worker that is owed a turn says while the team is paused. */
const pausedNow = (p: SwarmPause) => (p.reason === "limit" ? "Paused at the turn limit" : "Paused: Liner Code restarted");
/** How long a worker's turn may run, in words: minutes, or seconds when under a minute. */
const spanOf = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Number((ms / 1000).toFixed(2))} s`);

const git = (cwd: string, args: string[], timeout = 60_000) => run("git", args, { cwd, timeout, input: "", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
const clip = (s: string, max = POST_MAX) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export class SwarmManager {
  private host: SwarmHost;
  private runs = new Map<string, SwarmRun>();
  private live = new Map<string, LiveWorker>();
  private stallTimer?: NodeJS.Timeout;
  /** Configurable in tests to run fast stall/turn/hibernation checks. */
  turnMs = SWARM_TURN_MS;
  stallIntervalMs = SWARM_STALL_MS;
  /** Turns the swarm may start by itself before it pauses for the person; lowered in tests. */
  selfTurnsMax = SWARM_SELF_TURNS_MAX;
  /** After dispose (the engine shutting down) a turn that ends late writes nothing and starts nothing: what is on disk stays as the engine left it. */
  private disposed = false;

  constructor(host: SwarmHost) {
    this.host = host;
  }

  private dirOf(threadId: string) {
    return join(this.host.home, "swarms", threadId);
  }
  private stateFile(threadId: string) {
    return join(this.dirOf(threadId), "state.json");
  }
  private boardFile(threadId: string) {
    return join(this.dirOf(threadId), "board.jsonl");
  }
  private planFile(threadId: string) {
    return join(this.dirOf(threadId), "plan.json");
  }
  private liveKey(threadId: string, name: string) {
    return `${threadId}:${name}`;
  }

  private cwdOf(threadId: string) {
    const t = this.host.thread(threadId);
    return t.worktree?.path ?? this.host.projectPath(t.projectId);
  }

  /** Loads an existing swarm from disk if present; otherwise returns null. */
  private load(threadId: string): SwarmRun | null {
    const hit = this.runs.get(threadId);
    if (hit) return hit;
    const sf = this.stateFile(threadId);
    if (!existsSync(sf)) return null;
    try {
      const data = JSON.parse(readFileSync(sf, "utf8")) as PersistedSwarm;
      // Work found on starting up is held, never sent by itself (as the runtime holds a queue it finds): a team that was
      // mid-work pauses until the person carries on. A pause already on disk was told before, so it is not told again.
      const interrupted = data.active && !data.paused && data.members.some((m) => m.name !== "coordinator" && (m.state === "working" || m.state === "queued"));
      if (interrupted) data.paused = { reason: "restart", at: Date.now() };
      // After an engine restart, no worker process is alive in RAM: any working/queued worker becomes hibernated.
      for (const m of data.members) {
        if (m.state === "working" || m.state === "queued" || m.state === "waiting") {
          const owedWork = m.name !== "coordinator" && m.state !== "waiting" && Boolean(data.paused);
          m.state = "hibernated";
          m.rssMb = 0;
          m.now = owedWork ? pausedNow(data.paused!) : undefined;
        }
      }
      const posts: SwarmPost[] = [];
      const bf = this.boardFile(threadId);
      if (existsSync(bf)) {
        const lines = readFileSync(bf, "utf8").split("\n").filter(Boolean);
        for (const line of lines.slice(-BOARD_MEM_MAX)) {
          try {
            posts.push(JSON.parse(line) as SwarmPost);
          } catch {}
        }
      }
      const runState: SwarmRun = {
        data,
        posts,
        queue: [],
        inheritWriteBusy: false,
        stallState: { headSeq: data.nextSeq - 1, alerts: 0, pinged: new Set(), lastAt: 0 },
        coordWakeQueued: false,
      };
      this.runs.set(threadId, runState);
      if (interrupted) this.tellPaused(runState);
      if (data.active) this.ensureStallTimer();
      return runState;
    } catch {
      return null;
    }
  }

  /** Ensures a SwarmRun exists for an enabled thread, seeding the Coordinator roster entry. */
  private ensure(threadId: string): SwarmRun {
    const existing = this.load(threadId);
    if (existing) return existing;
    const t = this.host.thread(threadId);
    const s = this.host.settings();
    const cfg = t.swarm;
    const coord = this.host.resolveCoordinator(threadId);
    const now = Date.now();
    const data: PersistedSwarm = {
      threadId,
      mode: cfg?.mode ?? "teamwork",
      title: cfg?.title,
      active: Boolean(cfg?.enabled),
      maxActive: clampSwarmMax(cfg?.maxActive ?? s.swarmMaxActive),
      hibernateSec: clampSwarmHibernate(cfg?.hibernateSec ?? s.swarmHibernateSec),
      stallMonitor: cfg?.stallMonitor ?? s.swarmStallMonitor !== false,
      nextSeq: 1,
      members: [
        {
          name: "coordinator",
          role: "Coordinator",
          model: coord.ref,
          state: "waiting",
          workspace: "inherit",
          mode: "write",
          channels: ["main"],
          brief: "Leads the swarm, sets the plan, coordinates workers, and lands verified worktrees.",
          lastReadSeq: 0,
          tokens: 0,
          costUsd: 0,
          rssMb: 0,
        },
      ],
      updatedAt: now,
    };
    const r: SwarmRun = {
      data,
      posts: [],
      queue: [],
      inheritWriteBusy: false,
      stallState: { headSeq: 0, alerts: 0, pinged: new Set(), lastAt: 0 },
      coordWakeQueued: false,
    };
    this.runs.set(threadId, r);
    this.save(r);
    this.ensureStallTimer();
    return r;
  }

  private save(r: SwarmRun) {
    if (this.disposed) return;
    r.data.updatedAt = Date.now();
    mkdirSync(this.dirOf(r.data.threadId), { recursive: true });
    writeAtomic(this.stateFile(r.data.threadId), JSON.stringify(r.data, null, 2));
    if (r.data.plan) writeAtomic(this.planFile(r.data.threadId), JSON.stringify(r.data.plan, null, 2));
  }

  private appendBoard(threadId: string, post: SwarmPost) {
    if (this.disposed) return;
    mkdirSync(this.dirOf(threadId), { recursive: true });
    appendFileSync(this.boardFile(threadId), `${JSON.stringify(post)}\n`);
  }

  /** Builds a clean UI snapshot without internal session ids. */
  snapshot(threadId: string): SwarmSnapshot | null {
    const r = this.load(threadId);
    if (!r) {
      const t = this.host.thread(threadId);
      if (!t.swarm?.enabled) return null;
      return this.snapshotOf(this.ensure(threadId));
    }
    return this.snapshotOf(r);
  }

  private snapshotOf(r: SwarmRun): SwarmSnapshot {
    const workers = r.data.members.filter((m) => m.name !== "coordinator" && m.state !== "killed");
    let activeSlots = 0;
    let queuedCount = 0;
    let hibernatedCount = 0;
    let rssMb = 0;
    const sharedCounted = new Set<string>();
    const members: SwarmMember[] = r.data.members.map((m) => {
      const { sessionId: _s, swapped: _sw, swapReason: _sr, report: _rep, steps: _st, tools: _tl, turn: _tn, createdAt: _ca, ...pub } = m;
      const lw = this.live.get(this.liveKey(r.data.threadId, m.name));
      if (m.name !== "coordinator") {
        if (m.state === "working") activeSlots++;
        else if (m.state === "queued") queuedCount++;
        else if (m.state === "hibernated") hibernatedCount++;
      }
      if (lw && (m.state === "working" || m.state === "waiting")) {
        const fam = familyOf(lw.provider);
        if (fam === "opencode") {
          if (!sharedCounted.has(lw.provider)) {
            sharedCounted.add(lw.provider);
            rssMb += 65; // single shared opencode serve daemon
          }
          rssMb += 6;
        } else rssMb += estimatedRssMb(lw.provider);
      }
      return pub;
    });
    return {
      threadId: r.data.threadId,
      mode: r.data.mode ?? "teamwork",
      title: r.data.title,
      active: r.data.active && workers.some((w) => w.state !== "stopped"),
      maxActive: r.data.maxActive,
      hibernateSec: r.data.hibernateSec,
      stallMonitor: r.data.stallMonitor,
      plan: r.data.plan,
      members,
      posts: r.posts,
      activeSlots,
      queuedCount,
      hibernatedCount,
      rssMb,
      ...(r.data.paused ? { paused: r.data.paused } : {}),
      updatedAt: r.data.updatedAt,
    };
  }

  /** Keeps a native `task` timeline item for the Teamwork Coordinator root so Fanout and AgentsSurface render the nested hierarchy. */
  private syncRootItem(r: SwarmRun) {
    if (!this.host.putItem) return;
    const threadId = r.data.threadId;
    const turn = r.data.rootTurn ?? Math.max(1, this.host.turnOf?.(threadId) ?? this.host.thread(threadId).turns);
    r.data.rootTurn = turn;
    r.data.rootItemId ??= `sw_root_${threadId}_${turn}`;
    r.data.rootAt ??= Date.now();
    const coord = r.data.members.find((m) => m.name === "coordinator");
    if (coord) coord.itemId = r.data.rootItemId;
    const workers = r.data.members.filter((m) => m.name !== "coordinator" && m.state !== "killed");
    const working = coord?.state === "working" || workers.some((w) => w.state === "working" || w.state === "queued");
    const task = r.data.plan?.goal.title || r.data.title || this.host.thread(threadId).title;
    const status: "running" | "done" | "stopped" = working ? "running" : r.data.active ? "done" : "done";
    const now = working
      ? workers.some((w) => w.state === "working")
        ? `Coordinating ${workers.filter((w) => w.state === "working").length} active`
        : "Coordinating"
      : undefined;
    const rootLabel = (r.data.mode ?? "teamwork") === "swarm" ? "Swarm Coordinator" : "Teamwork Coordinator";
    this.host.putItem(threadId, {
      kind: "tool",
      id: r.data.rootItemId,
      turn,
      at: r.data.rootAt,
      tool: "liner.swarm",
      toolKind: "task",
      title: `${rootLabel}: ${task}`,
      status,
      seconds: working ? undefined : Math.max(1, (Date.now() - r.data.rootAt) / 1000),
      agent: {
        name: rootLabel,
        task,
        brief: r.data.plan?.goal.line || coord?.brief,
        model: coord?.model,
        taskId: "swarm:coordinator",
        state: working ? "running" : "done",
        ...(now ? { now } : {}),
        ...(workers.length ? { report: `${workers.filter((w) => w.state !== "skipped").length} teammates · ${r.posts.length} board posts` } : {}),
      },
    });
  }

  /** Mirrors a swarm worker onto the thread's timeline under its parent's `itemId`, matching Liner Code's native nested agent tree. */
  private syncMemberItem(r: SwarmRun, m: PersistedMember) {
    if (!this.host.putItem || m.name === "coordinator") return;
    this.syncRootItem(r);
    const threadId = r.data.threadId;
    const turn = m.turn ?? r.data.rootTurn ?? Math.max(1, this.host.turnOf?.(threadId) ?? this.host.thread(threadId).turns);
    m.turn = turn;
    m.itemId ??= `sw_${threadId}_${m.name}`;
    m.createdAt ??= Date.now();
    const parentMember = m.parent && m.parent !== "coordinator" ? r.data.members.find((x) => x.name === m.parent) : undefined;
    const parentId = parentMember?.itemId ?? r.data.rootItemId;
    const task = m.brief.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) ?? m.role;
    const shortTask = task.length > 80 ? `${task.slice(0, 78).trimEnd()}…` : task;
    // A hibernated or waiting worker that has finished its turn shows as done (✓) in the tree until woken again; skipped/stopped shows skipped (⊘).
    const isWorking = m.state === "working" || m.state === "queued";
    const isStopped = m.state === "skipped" || m.state === "stopped" || m.state === "killed";
    const status: "running" | "done" | "stopped" = isWorking ? "running" : isStopped ? "stopped" : "done";
    const agentSt: "running" | "done" | "stopped" = isWorking ? "running" : isStopped ? "stopped" : "done";
    this.host.putItem(threadId, {
      kind: "tool",
      id: m.itemId,
      turn,
      at: m.createdAt,
      tool: "liner.swarm",
      toolKind: "task",
      title: `${m.role}: ${shortTask}`,
      input: m.brief,
      status,
      seconds: isWorking ? undefined : m.startedAt ? Math.max(1, (Date.now() - m.startedAt) / 1000) : 0,
      agent: {
        name: m.role,
        task: shortTask,
        brief: m.brief,
        model: m.model,
        ...(parentId ? { parent: parentId } : {}),
        taskId: `swarm:${m.name}`,
        state: agentSt,
        ...(isWorking ? { now: m.now || (m.state === "queued" ? "Queued (0 MB RAM)" : "Starting") } : {}),
        ...(m.steps?.length ? { steps: m.steps.slice(-40) } : {}),
        ...(m.tools ? { tools: m.tools } : {}),
        ...(m.tokens ? { tokens: m.tokens } : {}),
        ...(m.report ? { report: m.report } : m.state === "skipped" ? { report: m.now || "Skipped (not needed)" } : {}),
        ...(m.files?.length ? { files: m.files } : {}),
      },
    });
  }

  private publish(r: SwarmRun) {
    this.save(r);
    if (r.data.members.some((m) => m.name !== "coordinator")) {
      this.syncRootItem(r);
      for (const m of r.data.members) if (m.name !== "coordinator") this.syncMemberItem(r, m);
    }
    const snap = this.snapshotOf(r);
    this.host.emit({ type: "swarm.changed", threadId: r.data.threadId, snapshot: snap });
    return snap;
  }

  /** Enables or disables Teamwork / Swarm mode on a thread. Disabling hibernates active workers cleanly. */
  enable(threadId: string, o: { enabled: boolean; mode?: SwarmMode; preset?: SwarmPreset; title?: string; maxActive?: number; hibernateSec?: number }): SwarmSnapshot | null {
    const t = this.host.thread(threadId);
    const s = this.host.settings();
    const wasEnabled = Boolean(t.swarm?.enabled);
    const wasMode: SwarmMode = t.swarm?.mode ?? "teamwork";
    if (!o.enabled) {
      const r = this.load(threadId);
      if (r) {
        r.data.active = false;
        this.stopAllWorkers(threadId, true);
        this.publish(r);
      }
      this.host.patchThread(threadId, { swarm: undefined });
      if (wasEnabled) this.host.resetCoordinatorSession?.(threadId);
      return null;
    }
    const swarmMode: SwarmMode = o.mode ?? t.swarm?.mode ?? "teamwork";
    const cfg: SwarmConfig = {
      enabled: true,
      mode: swarmMode,
      preset: o.preset ?? t.swarm?.preset ?? "squad",
      ...(o.title ? { title: o.title } : t.swarm?.title ? { title: t.swarm.title } : {}),
      maxActive: clampSwarmMax(o.maxActive ?? t.swarm?.maxActive ?? s.swarmMaxActive),
      hibernateSec: clampSwarmHibernate(o.hibernateSec ?? t.swarm?.hibernateSec ?? s.swarmHibernateSec),
      stallMonitor: t.swarm?.stallMonitor ?? s.swarmStallMonitor !== false,
    };
    this.host.patchThread(threadId, { swarm: cfg });
    if (!wasEnabled || wasMode !== swarmMode) this.host.resetCoordinatorSession?.(threadId);
    const r = this.ensure(threadId);
    r.data.mode = swarmMode;
    r.data.active = true;
    r.data.maxActive = cfg.maxActive!;
    r.data.hibernateSec = cfg.hibernateSec!;
    r.data.stallMonitor = cfg.stallMonitor!;
    if (cfg.title) r.data.title = cfg.title;
    const coord = r.data.members.find((m) => m.name === "coordinator");
    if (coord) coord.model = this.host.resolveCoordinator(threadId).ref;
    this.ensureStallTimer();
    return this.publish(r);
  }

  /** Updates live RAM pool / hibernation / stall monitor settings for an active swarm. */
  updateConfig(threadId: string, patch: { maxActive?: number; hibernateSec?: number; stallMonitor?: boolean; title?: string }): SwarmSnapshot {
    const r = this.ensure(threadId);
    if (patch.maxActive !== undefined) r.data.maxActive = clampSwarmMax(patch.maxActive);
    if (patch.hibernateSec !== undefined) r.data.hibernateSec = clampSwarmHibernate(patch.hibernateSec);
    if (patch.stallMonitor !== undefined) r.data.stallMonitor = patch.stallMonitor;
    if (patch.title !== undefined) r.data.title = patch.title.trim().slice(0, 80) || undefined;
    const t = this.host.thread(threadId);
    if (t.swarm?.enabled) {
      this.host.patchThread(threadId, {
        swarm: {
          ...t.swarm,
          maxActive: r.data.maxActive,
          hibernateSec: r.data.hibernateSec,
          stallMonitor: r.data.stallMonitor,
          ...(r.data.title ? { title: r.data.title } : {}),
        },
      });
    }
    this.ensureStallTimer();
    this.pumpQueue(threadId);
    return this.publish(r);
  }

  /** Marks the coordinator as working or waiting and updates its read cursor. */
  onCoordinatorTurn(threadId: string, state: "working" | "waiting", skipWake = false) {
    const r = this.load(threadId);
    if (!r) return;
    const coord = r.data.members.find((m) => m.name === "coordinator");
    if (!coord) return;
    coord.model = this.host.resolveCoordinator(threadId).ref;
    coord.state = state;
    if (state === "working") {
      coord.lastReadSeq = Math.max(coord.lastReadSeq, r.data.nextSeq - 1);
      r.coordWakeQueued = false;
    } else if (!skipWake) {
      // If workers posted to @coordinator while it was running, wake it now.
      const unreadForCoord = r.posts.filter((p) => p.seq > coord.lastReadSeq && p.from !== "coordinator" && (p.to.includes("coordinator") || p.to.includes("all")));
      if (unreadForCoord.length) this.scheduleCoordinatorWake(r);
    }
    this.publish(r);
  }

  /** Records an optional role (such as Task Interviewer) as skipped in the Teamwork tree without starting any process. */
  skipWorker(threadId: string, args: { name: string; role?: string; reason?: string; parent?: string }): { snapshot: SwarmSnapshot; member: SwarmMember } {
    const r = this.ensure(threadId);
    const name = validWorkerName(args.name);
    if (!name) throw new Error("Worker name must be 1–24 lowercase letters, digits, - or _.");
    const role = (args.role?.trim() || name).slice(0, 48);
    const reason = args.reason?.trim() || "Skipped (not needed)";
    const parent = args.parent && args.parent !== "coordinator" ? args.parent : "coordinator";
    const existing = r.data.members.find((m) => m.name === name);
    const member: PersistedMember = {
      name,
      role,
      parent,
      model: this.host.resolveCoordinator(threadId).ref,
      state: "skipped",
      workspace: "inherit",
      mode: "read",
      channels: ["main"],
      brief: reason,
      now: reason,
      report: reason,
      lastReadSeq: r.data.nextSeq - 1,
      tokens: 0,
      costUsd: 0,
      rssMb: 0,
    };
    if (existing) Object.assign(existing, member);
    else r.data.members.push(member);
    return { snapshot: this.publish(r), member };
  }

  /** Builds a compact context digest from an existing member so `fork` works universally across every CLI and API provider. */
  private forkContext(r: SwarmRun, forkFrom: string): string | undefined {
    const who = forkFrom.trim().toLowerCase().replace(/^@+/, "");
    if (!who) return undefined;
    const src = r.data.members.find((m) => m.name === who);
    if (!src) return undefined;
    const recent = r.posts.filter((p) => p.from === who || p.to.includes(who)).slice(-5);
    const lines = [`Forked context from @${src.name} (${src.role}):`];
    if (src.brief) lines.push(`Original brief: ${clip(src.brief, 500)}`);
    if (src.report) lines.push(`Latest report: ${clip(src.report, 800)}`);
    if (recent.length) {
      lines.push("Recent board context:");
      for (const p of recent) lines.push(`- #${p.seq} @${p.from}: ${clip(p.text, 300)}`);
    }
    return lines.join("\n");
  }

  /** Adds one worker (or a sharded/homogeneous batch when `tasks` or `n > 1` is set) to the roster. */
  async addWorkers(
    threadId: string,
    args: { name: string; role?: string; model?: string; workspace?: SwarmWorkspace; mode?: "read" | "write"; channels?: string[]; brief: string; parent?: string; canDelegate?: boolean; n?: number; tasks?: string[]; fork?: string },
  ): Promise<{ snapshot: SwarmSnapshot; members: SwarmMember[]; note?: string }> {
    const cleanTasks = (args.tasks ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 8);
    const count = cleanTasks.length > 0 ? cleanTasks.length : typeof args.n === "number" && args.n > 1 ? Math.min(8, Math.floor(args.n)) : 1;
    if (count === 1 && cleanTasks.length === 0) {
      const one = await this.addWorker(threadId, args);
      return { snapshot: one.snapshot, members: [one.member], note: one.note };
    }
    const members: SwarmMember[] = [];
    const notes: string[] = [];
    let snapshot = this.snapshot(threadId)!;
    for (let i = 0; i < count; i++) {
      const sliceName = `${args.name}-${i + 1}`;
      const sliceBrief = cleanTasks.length ? `${args.brief.trim()}\n\nAssigned slice: ${cleanTasks[i]}` : args.brief;
      const res = await this.addWorker(threadId, { ...args, name: sliceName, brief: sliceBrief });
      members.push(res.member);
      if (res.note) notes.push(res.note);
      snapshot = res.snapshot;
    }
    return { snapshot, members, note: notes[0] };
  }

  /** Adds a worker (or mid-level orchestrator) to the roster, creates its worktree if `share`, posts its brief, and enqueues its wake turn. */
  async addWorker(
    threadId: string,
    args: { name: string; role?: string; model?: string; workspace?: SwarmWorkspace; mode?: "read" | "write"; channels?: string[]; brief: string; parent?: string; canDelegate?: boolean; fork?: string },
  ): Promise<{ snapshot: SwarmSnapshot; member: SwarmMember; note?: string }> {
    const r = this.ensure(threadId);
    r.data.active = true;
    const name = validWorkerName(args.name);
    if (!name) throw new Error("Worker name must be 1–24 lowercase letters, digits, - or _, and cannot be reserved (all, coordinator, you, monitor, system).");
    const existing = r.data.members.find((m) => m.name === name);
    if (existing && existing.state !== "killed" && existing.state !== "skipped") throw new Error(`Worker @${name} is already on the roster.`);
    const rawBrief = args.brief.trim();
    if (!rawBrief) throw new Error("Give the worker a clear brief describing what it owns and what done looks like.");
    const forkDigest = args.fork ? this.forkContext(r, args.fork) : undefined;
    const brief = forkDigest ? `${forkDigest}\n\n${rawBrief}` : rawBrief;

    const isSwarmMode = (r.data.mode ?? "teamwork") === "swarm";
    const parentMember = args.parent && args.parent !== "coordinator" ? r.data.members.find((m) => m.name === args.parent && m.state !== "killed") : undefined;
    const parent = parentMember && (parentMember.canDelegate || (isSwarmMode && (parentMember.parent ?? "coordinator") === "coordinator")) ? parentMember.name : "coordinator";
    // Max depth 2: in teamwork only explicit orchestrators delegate; in swarm every direct peer of coordinator may add helpers under itself.
    const canDelegate = parent === "coordinator" && (Boolean(args.canDelegate) || isSwarmMode);
    const mode: "read" | "write" = args.mode ?? (args.workspace === "share" ? "write" : "read");
    const defaultWs = this.host.settings().swarmWorkspace ?? "share";
    let workspace: SwarmWorkspace = args.workspace ?? (mode === "write" ? defaultWs : "inherit");
    const role = (args.role?.trim() || (!isSwarmMode && canDelegate ? "Project Orchestrator" : mode === "read" ? "Explorer" : "Writer")).slice(0, 48);
    const modelRef = args.model?.trim() ? this.host.resolveModel(args.model.trim()).ref : this.host.defaultWorkerModel(threadId, role);
    const channels = [...new Set(["main", ...(args.channels ?? []).map((c) => c.trim().toLowerCase().replace(/^#/, "")).filter(Boolean)])];

    let branch: string | undefined;
    let worktreePath: string | undefined;
    let portOffset: number | undefined;
    let note: string | undefined;

    if (workspace === "share") {
      const repo = this.cwdOf(threadId);
      if (await isRepo(repo)) {
        const short = threadId.replace(/[^a-zA-Z0-9]/g, "").slice(-6) || "s";
        branch = `swarm/${short}-${name}`;
        const defaultRoot = this.host.settings().worktreeRoot || join(this.host.home, "worktrees");
        const wtPath = resolveWorktreePath(repo, `swarm-${short}-${name}`, defaultRoot, this.host.settings().worktreePlace);
        const hasBranch = (await git(repo, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`])).code === 0;
        if (!existsSync(wtPath)) {
          await git(repo, ["worktree", "prune"]);
          const created = await git(repo, hasBranch ? ["worktree", "add", "--", wtPath, branch] : ["worktree", "add", "-b", branch, "--", wtPath, "HEAD"], 120_000);
          if (created.code !== 0) {
            workspace = "inherit";
            branch = undefined;
            note = `Could not create worktree (${(created.stderr || created.stdout).trim()}); fell back to shared folder.`;
          } else {
            await submodules(wtPath).catch(() => null);
            worktreePath = wtPath;
            portOffset = portOffsetFor(`${threadId}:${name}`);
          }
        } else {
          worktreePath = wtPath;
          portOffset = portOffsetFor(`${threadId}:${name}`);
        }
      } else {
        workspace = "inherit";
        note = "Folder is not a git repository; running on shared folder with serialized writes.";
      }
    }

    const member: PersistedMember = {
      name,
      role,
      parent,
      ...(canDelegate ? { canDelegate: true } : {}),
      model: modelRef,
      state: "queued",
      workspace,
      mode,
      ...(branch ? { branch } : {}),
      ...(worktreePath ? { worktreePath } : {}),
      ...(portOffset ? { portOffset } : {}),
      channels,
      brief: clip(brief),
      now: "Queued for an active process slot",
      lastReadSeq: 0,
      tokens: 0,
      costUsd: 0,
      rssMb: 0,
      steps: [],
      tools: 0,
    };

    if (existing) Object.assign(existing, member);
    else r.data.members.push(member);

    this.post(threadId, {
      from: parent,
      to: [name],
      channel: channels.length > 1 ? channels[1] : "main",
      kind: "brief",
      text: `@${name} (${role}, ${workspace}${branch ? `:${branch}` : ""}): ${brief}${note ? `\n(${note})` : ""}`,
    });

    this.ensureStallTimer();
    return { snapshot: this.snapshotOf(r), member, note };
  }

  /** Appends a message to the board, persists it, and wakes mentioned members. */
  post(
    threadId: string,
    args: { from: string; text: string; to?: string[]; channel?: string; kind?: SwarmPost["kind"]; autoPosted?: boolean; files?: FileChange[] },
  ): { post: SwarmPost; snapshot: SwarmSnapshot } {
    const r = this.ensure(threadId);
    const text = clip(args.text.trim());
    if (!text) throw new Error("Board post text cannot be empty.");
    const channel = (args.channel?.trim().toLowerCase().replace(/^#/, "") || "main").slice(0, 32);
    const mentioned = parseMentions(text);
    const explicit = (args.to ?? []).map((x) => x.trim().toLowerCase().replace(/^@+/, "")).filter(Boolean);
    const to = [...new Set([...explicit, ...mentioned])];
    const screenshots = parseScreenshots(text);
    const post: SwarmPost = {
      seq: r.data.nextSeq++,
      at: Date.now(),
      from: args.from,
      to,
      channel,
      kind: args.kind ?? "post",
      text,
      ...(args.autoPosted ? { autoPosted: true } : {}),
      ...(args.files?.length ? { files: args.files } : {}),
      ...(screenshots.length ? { screenshots } : {}),
    };
    r.posts.push(post);
    if (r.posts.length > BOARD_MEM_MAX) r.posts.splice(0, r.posts.length - BOARD_MEM_MAX);
    this.appendBoard(threadId, post);

    // Update sender cursors.
    const sender = r.data.members.find((m) => m.name === args.from);
    if (sender) {
      sender.lastPostSeq = post.seq;
      sender.lastPostAt = post.at;
      sender.lastReadSeq = Math.max(sender.lastReadSeq, post.seq);
    }

    // Reset stall alert count whenever the board advances from a non-stall post.
    if (post.kind !== "stall") {
      r.stallState = { headSeq: post.seq, alerts: 0, pinged: new Set(), lastAt: 0 };
    }

    if (post.from === "coordinator" && /^\[done\]/i.test(post.text)) {
      r.data.active = false;
    }

    // Wake mentioned targets (never wake the sender of the post).
    const wakeTargets = new Set<string>();
    if (to.includes("all")) {
      for (const m of r.data.members) {
        if (m.state === "killed" || m.name === args.from) continue;
        if (channel === "main" || m.channels.includes(channel) || m.name === "coordinator") wakeTargets.add(m.name);
      }
    } else {
      for (const t of to) {
        if (t === args.from) continue;
        if (r.data.members.some((m) => m.name === t && m.state !== "killed")) wakeTargets.add(t);
      }
    }

    for (const target of wakeTargets) {
      if (target === "coordinator") this.scheduleCoordinatorWake(r);
      else this.enqueueWake(threadId, target);
    }

    const snap = this.publish(r);
    return { post, snapshot: snap };
  }

  /** Reads board posts since `since` visible to `reader` (plus optional roster status). */
  read(threadId: string, args: { reader?: string; since?: number; channel?: string; status?: boolean } = {}) {
    const r = this.ensure(threadId);
    const reader = args.reader;
    const member = reader ? r.data.members.find((m) => m.name === reader) : undefined;
    const since = Math.max(0, Math.floor(args.since ?? 0));
    const chFilter = args.channel?.trim().toLowerCase().replace(/^#/, "");
    const visible = r.posts.filter((p) => {
      if (p.seq <= since) return false;
      if (chFilter && p.channel !== chFilter) return false;
      if (!member || member.name === "coordinator") return true;
      return p.channel === "main" || member.channels.includes(p.channel) || p.to.includes(member.name);
    });
    if (member && visible.length) {
      member.lastReadSeq = Math.max(member.lastReadSeq, visible[visible.length - 1].seq);
      this.save(r);
    }
    const headSeq = r.data.nextSeq - 1;
    const lines: string[] = [];
    if (args.status) {
      lines.push(`Swarm status (${r.data.active ? "active" : "idle"}, active slots: ${this.activeWorkerCount(threadId)}/${r.data.maxActive}, head: #${headSeq}):`);
      for (const m of r.data.members) {
        const ws = m.workspace === "share" && m.branch ? `share:${m.branch}` : m.workspace;
        lines.push(`- @${m.name} (${m.role}, ${m.model}) · ${m.state} · ${ws} · read:#${m.lastReadSeq}${m.lastPostSeq ? ` · posted:#${m.lastPostSeq}` : ""}${m.now ? ` · ${m.now}` : ""}`);
      }
    }
    if (visible.length) {
      lines.push(`Board posts (${visible.length}, head #${headSeq}):`);
      for (const p of visible.slice(-40)) {
        lines.push(`#${p.seq} [${p.channel}] @${p.from}${p.to.length ? ` -> ${p.to.map((x) => `@${x}`).join(" ")}` : ""}: ${p.text}`);
      }
    } else if (!args.status) {
      lines.push(`No new board posts since #${since} (head is #${headSeq}).`);
    }
    return lines.join("\n");
  }

  /** Sets or updates the Overview plan (`plan.json`). */
  setPlan(threadId: string, plan: SwarmPlan): SwarmSnapshot {
    const r = this.ensure(threadId);
    r.data.plan = {
      goal: { title: String(plan.goal?.title ?? "").slice(0, 80), line: String(plan.goal?.line ?? "").slice(0, 140) },
      tasks: Object.fromEntries(Object.entries(plan.tasks ?? {}).map(([k, v]) => [k, String(v).slice(0, 100)])),
      threads: (plan.threads ?? []).slice(0, 6).map((th, i) => ({
        id: String(th.id || `t-${i + 1}`),
        title: String(th.title || "Workstream").slice(0, 60),
        goal: String(th.goal || "").slice(0, 140),
        tasks: Array.isArray(th.tasks) ? th.tasks.map(String) : [],
      })),
    };
    return this.publish(r);
  }

  /** Hot-swaps a worker's model (even across providers), preserving its brief & board context. */
  swapModel(threadId: string, name: string, modelRef: string, reason?: string): SwarmSnapshot {
    const r = this.ensure(threadId);
    const m = r.data.members.find((x) => x.name === name && x.state !== "killed");
    if (!m) throw new Error(`Worker @${name} was not found.`);
    if (m.name === "coordinator") throw new Error("Change the coordinator model from the session's model picker.");
    const resolved = this.host.resolveModel(modelRef);
    const was = m.model;
    this.closeLiveWorker(threadId, name, true);
    m.model = resolved.ref;
    m.sessionId = undefined; // force stateless board-checkpoint wake on the new provider/model
    m.swapped = true;
    m.swapReason = reason?.trim() || `switched from ${was} to ${resolved.label}`;
    m.state = "hibernated";
    m.rssMb = 0;
    this.post(threadId, {
      from: "system",
      to: [name],
      channel: "main",
      kind: "system",
      text: `Switched @${name} from ${was} to ${resolved.ref}${reason ? ` (${reason})` : ""}. Waking with board checkpoint.`,
    });
    return this.snapshotOf(r);
  }

  /** Manually wakes a hibernated or stopped worker. */
  wake(threadId: string, name: string, note?: string): SwarmSnapshot {
    const r = this.ensure(threadId);
    const m = r.data.members.find((x) => x.name === name && x.state !== "killed");
    if (!m) throw new Error(`Worker @${name} was not found.`);
    if (note?.trim()) {
      this.post(threadId, { from: "you", to: [name], channel: "main", kind: "user", text: `@${name} ${note.trim()}` });
      return this.snapshotOf(r);
    }
    if (name === "coordinator") this.scheduleCoordinatorWake(r);
    else this.enqueueWake(threadId, name);
    return this.publish(r);
  }

  /** Immediately hibernates one worker (or every non-working waiting worker when `name` is omitted) to free RAM. */
  hibernate(threadId: string, name?: string): SwarmSnapshot {
    const r = this.ensure(threadId);
    for (const m of r.data.members) {
      if (m.name === "coordinator" || m.state === "killed") continue;
      if (name && m.name !== name) continue;
      this.closeLiveWorker(threadId, m.name, false);
      if (m.state === "working" || m.state === "waiting" || m.state === "queued") {
        m.state = "hibernated";
        m.rssMb = 0;
        m.hibernatedAt = Date.now();
        m.now = "Hibernated (0 MB RAM)";
      }
    }
    if (name) r.queue = r.queue.filter((q) => q !== name);
    else r.queue = [];
    this.pumpQueue(threadId);
    return this.publish(r);
  }

  /** Stops a running worker's current turn without removing it from the roster. */
  stopWorker(threadId: string, name: string): SwarmSnapshot {
    const r = this.ensure(threadId);
    const m = r.data.members.find((x) => x.name === name);
    if (!m) throw new Error(`Worker @${name} was not found.`);
    r.queue = r.queue.filter((q) => q !== name);
    this.closeLiveWorker(threadId, name, true);
    if (m.state !== "killed") {
      m.state = "stopped";
      m.rssMb = 0;
      m.now = "Stopped";
    }
    this.pumpQueue(threadId);
    return this.publish(r);
  }

  /** Permanently ends a worker, closes its process, and removes its worktree if clean. */
  async killWorker(threadId: string, name: string): Promise<SwarmSnapshot> {
    const r = this.ensure(threadId);
    const m = r.data.members.find((x) => x.name === name);
    if (!m) throw new Error(`Worker @${name} was not found.`);
    if (m.name === "coordinator") throw new Error("Cannot kill the coordinator.");
    r.queue = r.queue.filter((q) => q !== name);
    this.closeLiveWorker(threadId, name, true);
    this.host.forgetWorkerKey?.(threadId, name);
    let keptNote = "";
    if (m.workspace === "share" && m.worktreePath) {
      const why = await removeWorktree(this.cwdOf(threadId), m.worktreePath).catch((e) => (e instanceof Error ? e.message : String(e)));
      if (why) keptNote = ` (kept worktree at ${m.worktreePath}: ${why})`;
      else m.worktreePath = undefined;
    }
    m.state = "killed";
    m.rssMb = 0;
    m.now = undefined;
    this.post(threadId, { from: "system", to: [], channel: "main", kind: "system", text: `Ended @${name}${keptNote}.` });
    this.pumpQueue(threadId);
    return this.publish(r);
  }

  /** Commits any uncommitted worktree changes onto the worker's branch, merges into the session checkout, and prunes the worktree. */
  async landWorker(threadId: string, name: string): Promise<{ snapshot: SwarmSnapshot; summary: string }> {
    const r = this.ensure(threadId);
    const m = r.data.members.find((x) => x.name === name);
    if (!m) throw new Error(`Worker @${name} was not found.`);
    if (m.workspace !== "share" || !m.branch || !m.worktreePath) {
      throw new Error(`@${name} is not running in an isolated worktree.`);
    }
    if (m.state === "working") throw new Error(`@${name} is still working. Wait for it to park or stop it before landing.`);
    // A merge rewrites the files the session's own turn may be editing right now.
    if (this.host.isCoordinatorBusy(threadId)) throw new Error("Wait for this session's turn to finish before landing a worktree into its checkout.");
    const repo = this.cwdOf(threadId);
    const wt = m.worktreePath;
    if (!existsSync(wt)) throw new Error(`Worktree for @${name} is no longer on disk (${wt}).`);

    // Stage and commit any remaining uncommitted edits inside the worker's own branch so nothing is lost on merge.
    const st = await git(wt, ["status", "--porcelain"]);
    if (st.code === 0 && st.stdout.trim()) {
      await git(wt, ["add", "-A"]);
      const commit = await git(wt, ["commit", "-m", `Swarm @${name}: ${m.role}`]);
      if (commit.code !== 0) throw new Error(`Could not commit @${name}'s worktree changes: ${(commit.stderr || commit.stdout).trim()}`);
    }

    const merged = await git(repo, ["merge", "--no-edit", m.branch]);
    if (merged.code !== 0) {
      await git(repo, ["merge", "--abort"]).catch(() => {});
      throw new Error(`Merge conflict landing ${m.branch} into the session checkout. Resolve or inspect ${wt} directly: ${(merged.stderr || merged.stdout).trim()}`);
    }

    m.landed = true;
    const pruned = await removeWorktree(repo, wt).catch(() => null);
    if (!pruned) m.worktreePath = undefined;
    const summary = `Landed ${m.branch} into the session checkout${pruned ? ` (worktree kept: ${pruned})` : " and pruned its worktree"}.`;
    this.post(threadId, { from: "system", to: ["coordinator"], channel: "main", kind: "system", text: `@coordinator ${summary}` });
    return { snapshot: this.publish(r), summary };
  }

  /** Stops all active workers on a thread and clears its wake queue. */
  stopAllWorkers(threadId: string, hibernate = false): SwarmSnapshot | null {
    const r = this.load(threadId);
    if (!r) return null;
    r.queue = [];
    for (const m of r.data.members) {
      if (m.name === "coordinator" || m.state === "killed") continue;
      this.closeLiveWorker(threadId, m.name, true);
      if (m.state === "working" || m.state === "queued" || m.state === "waiting") {
        m.state = hibernate ? "hibernated" : "stopped";
        m.rssMb = 0;
        m.now = hibernate ? "Hibernated (0 MB RAM)" : "Stopped";
      }
    }
    return this.publish(r);
  }

  /** Handles MCP calls coming from either the coordinator or a worker. */
  async handleTool(threadId: string, worker: string | undefined, tool: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
    try {
      const sender = worker ?? "coordinator";
      if (tool === "swarm_read") {
        const out = this.read(threadId, {
          reader: sender,
          since: typeof args.since === "number" ? args.since : undefined,
          channel: typeof args.channel === "string" ? args.channel : undefined,
          status: Boolean(args.status),
        });
        return { text: out };
      }
      if (tool === "swarm_post") {
        const msg = String(args.text ?? "").trim();
        if (!msg) return { text: "Give text for the board post.", isError: true };
        const to = Array.isArray(args.to) ? args.to.map(String) : undefined;
        const channel = typeof args.channel === "string" ? args.channel : undefined;
        const r = this.ensure(threadId);
        const me = r.data.members.find((x) => x.name === sender);
        if (me && sender !== "coordinator") me.report = msg;
        const { post } = this.post(threadId, { from: sender, text: msg, to, channel });
        return { text: `Posted #${post.seq} in #${post.channel}${post.to.length ? ` (notified ${post.to.map((x) => `@${x}`).join(", ")})` : ""}.` };
      }
      if (tool === "swarm_manage") {
        const r = this.ensure(threadId);
        const isSwarmMode = (r.data.mode ?? "teamwork") === "swarm";
        const caller = worker ? r.data.members.find((x) => x.name === worker) : undefined;
        const canManage = !worker || Boolean(caller?.canDelegate);
        if (!canManage) return { text: "Only the coordinator or a delegating member may call swarm_manage. Use swarm_post and swarm_read.", isError: true };
        const action = String(args.action ?? "").trim();
        if (action === "status") return { text: this.read(threadId, { reader: sender, status: true, since: Number.MAX_SAFE_INTEGER }) };
        if (action === "models") {
          const list = this.host.listModels?.() ?? [];
          if (!list.length) return { text: `Default model: ${this.host.resolveCoordinator(threadId).ref}. Omit model to inherit the coordinator's model.` };
          return { text: `Available models (omit model to inherit coordinator's ${this.host.resolveCoordinator(threadId).ref}):\n${list.map((m) => `- ${m.ref} (${m.label} · ${m.provider})`).join("\n")}` };
        }
        if (action === "title") {
          if (worker) return { text: "Only the coordinator can set the swarm title.", isError: true };
          const title = String(args.title ?? "").trim();
          this.updateConfig(threadId, { title });
          return { text: `Swarm titled “${title}”.` };
        }
        if (action === "plan") {
          if (worker) return { text: "Only the coordinator can update the Overview plan.", isError: true };
          const plan = args.plan as SwarmPlan | undefined;
          if (!plan?.goal?.title) return { text: "Pass plan: { goal: { title, line }, tasks, threads }.", isError: true };
          this.setPlan(threadId, plan);
          return { text: `Updated Swarm Overview plan: “${plan.goal.title}”.` };
        }
        if (action === "skip") {
          const name = String(args.name ?? "");
          const role = typeof args.role === "string" ? args.role : undefined;
          const reason = typeof args.reason === "string" ? args.reason : undefined;
          const { member } = this.skipWorker(threadId, { name, role, reason, parent: sender });
          return { text: `Recorded ${member.role} (@${member.name}) as skipped.` };
        }
        if (action === "add") {
          const name = String(args.name ?? "");
          const brief = String(args.brief ?? "");
          const role = typeof args.role === "string" ? args.role : undefined;
          const model = typeof args.model === "string" ? args.model : undefined;
          const workspace: SwarmWorkspace | undefined = args.workspace === "share" || args.workspace === "branch" ? "share" : args.workspace === "inherit" ? "inherit" : undefined;
          const mode = args.mode === "read" || args.mode === "write" ? args.mode : undefined;
          const channels = Array.isArray(args.channels) ? args.channels.map(String) : undefined;
          const n = typeof args.n === "number" ? args.n : undefined;
          const tasks = Array.isArray(args.tasks) ? args.tasks.map(String) : undefined;
          const fork = typeof args.fork === "string" ? args.fork : undefined;
          // Depth-2 limit: only Coordinator can create a delegating orchestrator/peer; helpers under a worker are leaf workers.
          const canDelegate = !worker && (Boolean(args.can_delegate) || isSwarmMode);
          const { members, note } = await this.addWorkers(threadId, { name, role, model, workspace, mode, channels, brief, parent: sender, canDelegate, n, tasks, fork });
          if (members.length === 1) {
            const m = members[0];
            return { text: `Added ${m.role} (@${m.name}, ${m.model}, ${m.workspace}${m.branch ? `:${m.branch}` : ""}) under @${m.parent ?? "coordinator"}. Brief posted and wake queued.${note ? ` ${note}` : ""}` };
          }
          return { text: `Added ${members.length} workers (${members.map((m) => `@${m.name}`).join(", ")}) under @${sender}. Briefs posted and wakes queued.${note ? ` ${note}` : ""}` };
        }
        if (action === "model") {
          const rawName = String(args.name ?? "").replace(/^@/, "");
          const name = rawName || (worker ?? "");
          const model = String(args.model ?? "");
          const reason = typeof args.reason === "string" ? args.reason : undefined;
          if (worker) {
            const target = r.data.members.find((x) => x.name === name);
            if (!target || (target.name !== worker && target.parent !== worker)) {
              return { text: `As @${worker}, you may only switch your own model or helpers you added.`, isError: true };
            }
          }
          this.swapModel(threadId, name, model, reason);
          return { text: `Switched @${name} to ${model} and queued a wake turn.` };
        }
        if (action === "land") {
          // Landing commits in the worker's worktree and merges into the person's checkout: agents never commit or merge on
          // their own (Settings › Safety), so only the person lands one, from the Agents panel (swarm.land).
          const name = String(args.name ?? "").replace(/^@/, "");
          return { text: `Only the person merges a worktree into their checkout. Tell them @${name} is ready to land (Agents panel › Worktrees › Land into checkout), and leave @${name} as it is until they have.`, isError: true };
        }
        if (action === "kill") {
          const name = String(args.name ?? "").replace(/^@/, "");
          if (worker) {
            const target = r.data.members.find((x) => x.name === name);
            if (!target || target.parent !== worker) return { text: `As @${worker}, you may only kill helpers you added.`, isError: true };
          }
          await this.killWorker(threadId, name);
          return { text: `Ended @${name}.` };
        }
        return { text: `Unknown swarm_manage action "${action}". Use add, skip, plan, status, model, land, title or kill.`, isError: true };
      }
      return { text: `Unknown swarm tool "${tool}".`, isError: true };
    } catch (e) {
      return { text: e instanceof Error ? e.message : String(e), isError: true };
    }
  }

  /** Number of workers currently executing a turn on this thread. */
  private activeWorkerCount(threadId: string) {
    let n = 0;
    for (const lw of this.live.values()) if (lw.threadId === threadId && lw.working) n++;
    return n;
  }

  /** Queues a worker to wake when a concurrency slot is available. */
  private enqueueWake(threadId: string, name: string) {
    const r = this.load(threadId);
    if (!r) return;
    const m = r.data.members.find((x) => x.name === name);
    if (!m || m.state === "killed" || m.name === "coordinator") return;
    if (m.state === "working") return; // already running; will see unread posts or be re-checked on end
    if (!r.queue.includes(name)) r.queue.push(name);
    m.state = "queued";
    m.now = "Waiting for an active process slot";
    this.pumpQueue(threadId);
  }

  /** Pumps queued workers into available active process slots, evicting idle waiting processes first to keep RAM capped. */
  private pumpQueue(threadId: string) {
    const r = this.load(threadId);
    if (!r || !r.data.active) return;
    while (r.queue.length > 0 && this.activeWorkerCount(threadId) < r.data.maxActive) {
      const nextIdx = r.queue.findIndex((name) => {
        const m = r.data.members.find((x) => x.name === name);
        if (!m || m.state === "killed") return false;
        // Serialize writers that share the session folder ("inherit") so they never race on the same files.
        if (m.mode === "write" && m.workspace === "inherit" && r.inheritWriteBusy) return false;
        return true;
      });
      if (nextIdx < 0) break;
      const [name] = r.queue.splice(nextIdx, 1);
      // Before opening a new worker process, immediately hibernate any idle waiting worker so total live processes never exceed maxActive.
      this.evictIdleProcesses(threadId, name, r.data.maxActive);
      void this.runWorkerTurn(threadId, name);
    }
  }

  private evictIdleProcesses(threadId: string, exceptName: string, cap: number) {
    const openForThread = [...this.live.values()].filter((lw) => lw.threadId === threadId);
    if (openForThread.length < cap) return;
    for (const lw of openForThread) {
      if (lw.working || lw.name === exceptName) continue;
      this.closeLiveWorker(threadId, lw.name, false);
      const r = this.load(threadId);
      const m = r?.data.members.find((x) => x.name === lw.name);
      if (m && m.state === "waiting") {
        m.state = "hibernated";
        m.rssMb = 0;
        m.hibernatedAt = Date.now();
        m.now = "Hibernated to free slot (0 MB)";
      }
    }
  }

  private closeLiveWorker(threadId: string, name: string, abortTurn: boolean) {
    const k = this.liveKey(threadId, name);
    const lw = this.live.get(k);
    if (!lw) return;
    if (lw.hibernateTimer) clearTimeout(lw.hibernateTimer);
    if (abortTurn) lw.abort?.abort();
    this.live.delete(k);
    try {
      void lw.session.close();
    } catch {}
  }

  /** Runs one wake turn for a worker, tracking measured worktree diffs, usage, auto-post fallback, and hibernation. */
  private async runWorkerTurn(threadId: string, name: string) {
    const r = this.load(threadId);
    if (!r) return;
    const m = r.data.members.find((x) => x.name === name);
    if (!m || m.state === "killed") return;
    const t = this.host.thread(threadId);
    const cwd = m.workspace === "share" && m.worktreePath && existsSync(m.worktreePath) ? m.worktreePath : this.cwdOf(threadId);
    const resolved = this.host.resolveModel(m.model);
    const isInheritWriter = m.mode === "write" && m.workspace === "inherit";
    if (isInheritWriter) r.inheritWriteBusy = true;

    const unread = r.posts.filter((p) => p.seq > m.lastReadSeq && (p.channel === "main" || m.channels.includes(p.channel) || p.to.includes(m.name)));
    const postSeqBefore = m.lastPostSeq ?? 0;
    const started = Date.now();
    const abort = new AbortController();
    const cap = setTimeout(() => abort.abort(), this.turnMs);
    cap.unref?.();

    const k = this.liveKey(threadId, name);
    let lw = this.live.get(k);
    let usedStateless = false;

    const openFresh = (resume?: string) => {
      const soul = swarmWorkerRules(m.name, m.role, m.mode, m.workspace, { canDelegate: m.canDelegate, parent: m.parent, swarmMode: r.data.mode ?? "teamwork" });
      const session = this.host.openWorkerSession({ threadId, member: m, cwd, soul, resume, portOffset: m.portOffset });
      const created: LiveWorker = { threadId, name, session, provider: resolved.provider, model: resolved.model, working: true, abort };
      this.live.set(k, created);
      return created;
    };

    if (lw) {
      if (lw.hibernateTimer) clearTimeout(lw.hibernateTimer);
      lw.hibernateTimer = undefined;
      lw.working = true;
      lw.abort = abort;
    } else {
      usedStateless = !m.sessionId || Boolean(m.swapped);
      lw = openFresh(m.swapped ? undefined : m.sessionId);
    }

    m.state = "working";
    m.startedAt = started;
    m.hibernatedAt = undefined;
    m.rssMb = estimatedRssMb(resolved.provider);
    m.now = "Working";
    this.publish(r);

    const spent: Usage = emptyUsage();
    let said = "";
    let problem: string | undefined;
    let fromSnap: string | null = null;
    const gitOk = m.mode === "write" && (await isRepo(cwd));
    if (gitOk) fromSnap = await capture(cwd, `swarm-${threadId}-${name}-${started}-before`).catch(() => null);

    const stepKeys = new Map<string, number>();
    m.steps ??= [];
    m.tools ??= 0;
    const makeSink = (): TurnSink => ({
      text: (d) => {
        said += d;
      },
      reasoning: () => {},
      tool: (u) => {
        const step: AgentStep = { title: u.title || u.tool, toolKind: u.toolKind, status: u.status === "stopped" ? "failed" : u.status, at: Date.now(), ...(u.path ? { path: u.path } : {}) };
        const idx = stepKeys.get(u.key);
        if (idx === undefined) {
          stepKeys.set(u.key, m.steps!.length);
          m.steps!.push(step);
          if (m.steps!.length > 40) m.steps = m.steps!.slice(-40);
          m.tools = (m.tools ?? 0) + 1;
        } else if (idx < m.steps!.length) {
          m.steps![idx] = step;
        }
        if (u.status === "running" && u.title) m.now = u.title;
        this.syncMemberItem(r, m);
        this.host.emit({ type: "swarm.changed", threadId, snapshot: this.snapshotOf(r) });
      },
      plan: () => {},
      approve: (req, sig) => this.host.approve(threadId, m.name, req, sig),
      ask: async (qs) => Object.fromEntries(qs.map((q) => [q.question, NOBODY])),
      propose: async () => ({ approve: false, note: "Swarm workers do not propose interactive plans: post to @coordinator via swarm_post." }),
      usage: (u, total) => {
        if (total) {
          spent.inputTokens = Math.max(spent.inputTokens, u.inputTokens ?? 0);
          spent.outputTokens = Math.max(spent.outputTokens, u.outputTokens ?? 0);
          spent.cacheReadTokens = Math.max(spent.cacheReadTokens, u.cacheReadTokens ?? 0);
          spent.costUsd = Math.max(spent.costUsd, u.costUsd ?? 0);
        } else {
          spent.inputTokens += u.inputTokens ?? 0;
          spent.outputTokens += u.outputTokens ?? 0;
          spent.cacheReadTokens += u.cacheReadTokens ?? 0;
          spent.costUsd += u.costUsd ?? 0;
        }
      },
      session: (id) => {
        m.sessionId = id;
      },
      notice: () => {},
      error: (msg) => {
        problem = msg;
      },
      limited: (msg) => {
        problem = `Usage limit: ${msg}`;
      },
    });

    const buildPrompt = async (stateless: boolean) => {
      let gitShort: string | undefined;
      if (stateless && m.workspace === "share" && existsSync(cwd)) {
        const st = await git(cwd, ["status", "--short"]).catch(() => ({ code: 1, stdout: "", stderr: "" }));
        if (st.code === 0 && st.stdout.trim()) gitShort = st.stdout.trim().slice(0, 1000);
      }
      const ownRecent = stateless ? r.posts.filter((p) => p.from === m.name).slice(-2) : undefined;
      return buildWakePrompt(m, unread, { stateless, ownRecent, gitShort, swappedReason: m.swapped ? m.swapReason : undefined });
    };

    try {
      const prompt = await buildPrompt(usedStateless);
      try {
        await lw.session.turn(prompt, makeSink(), abort.signal);
      } catch (e) {
        if (e instanceof ResumeFailed && !abort.signal.aborted) {
          // Provider lost its stored session: transparently recover using stateless board checkpoint.
          this.closeLiveWorker(threadId, name, false);
          m.sessionId = undefined;
          lw = openFresh(undefined);
          const fallbackPrompt = await buildPrompt(true);
          await lw.session.turn(fallbackPrompt, makeSink(), abort.signal);
        } else {
          throw e;
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) problem = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(cap);
      if (isInheritWriter) r.inheritWriteBusy = false;
    }

    // Measure diff for write workers.
    let measured: FileChange[] | undefined;
    if (gitOk && fromSnap) {
      const toSnap = await capture(cwd, `swarm-${threadId}-${name}-${started}-after`).catch(() => null);
      if (toSnap) measured = await changes(cwd, fromSnap, toSnap, { turn: true }).catch(() => undefined);
      if (measured?.length) m.files = measured;
    }

    const seconds = (Date.now() - started) / 1000;
    const tok = spent.inputTokens + spent.outputTokens + spent.cacheReadTokens;
    m.tokens += tok;
    m.costUsd += spent.costUsd;
    m.swapped = false;
    m.swapReason = undefined;
    if (unread.length) m.lastReadSeq = Math.max(m.lastReadSeq, unread[unread.length - 1].seq);
    if (tok > 0 || spent.costUsd > 0) {
      this.host.logUsage({
        at: Date.now(),
        threadId,
        projectId: t.projectId,
        agent: `swarm:${m.name}`,
        provider: resolved.provider,
        model: resolved.model,
        inputTokens: spent.inputTokens,
        outputTokens: spent.outputTokens,
        cacheReadTokens: spent.cacheReadTokens,
        costUsd: spent.costUsd,
        seconds,
      });
    }

    // Auto-post fallback: if a worker ended its turn without posting to the board, publish its summary to its parent (@orchestrator or @coordinator) so it never silently stalls.
    const stateNow = (): SwarmMember["state"] => m.state;
    const postedThisTurn = (m.lastPostSeq ?? 0) > postSeqBefore;
    const parentTarget = m.parent && m.parent !== "coordinator" && r.data.members.some((x) => x.name === m.parent && x.state !== "killed") ? m.parent : "coordinator";
    // An orchestrator that just spawned children this turn intentionally parks without reporting yet; leaf specialists always report back.
    const spawnedChildren = m.canDelegate && r.data.members.some((x) => x.parent === m.name && x.state !== "killed" && x.state !== "skipped");
    if (!postedThisTurn && !spawnedChildren && stateNow() !== "killed" && stateNow() !== "stopped" && this.host.settings().swarmAutoPost !== false) {
      const autoText = problem
        ? `@${parentTarget} Hit a problem while working: ${problem}`
        : said.trim()
          ? `@${parentTarget} ${clip(said.trim(), 1600)}`
          : "";
      if (autoText) {
        m.report = autoText;
        this.post(threadId, { from: m.name, to: [parentTarget], channel: "main", kind: "post", text: autoText, autoPosted: true, files: measured });
      }
    } else if (said.trim() && !m.report) {
      m.report = clip(said.trim(), 1600);
    }

    // Release active slot and schedule RAM-saving hibernation.
    const curLive = this.live.get(k);
    if (curLive) curLive.working = false;
    if (stateNow() === "working") {
      const shouldHibernateNow = r.data.hibernateSec <= 0 || r.queue.length > 0;
      if (shouldHibernateNow) {
        this.closeLiveWorker(threadId, name, false);
        m.state = "hibernated";
        m.rssMb = 0;
        m.hibernatedAt = Date.now();
        m.now = "Hibernated (0 MB RAM)";
      } else {
        m.state = "waiting";
        m.now = `Waiting · hibernates in ${r.data.hibernateSec}s`;
        if (curLive) {
          curLive.hibernateTimer = setTimeout(() => {
            if (curLive.working) return;
            this.closeLiveWorker(threadId, name, false);
            if (m.state === "waiting") {
              m.state = "hibernated";
              m.rssMb = 0;
              m.hibernatedAt = Date.now();
              m.now = "Hibernated (0 MB RAM)";
              this.publish(r);
            }
          }, r.data.hibernateSec * 1000);
          curLive.hibernateTimer.unref?.();
        }
      }
    }

    // If new mentions arrived for this worker while it was running, re-enqueue it.
    const headSeq = r.data.nextSeq - 1;
    const gotNewMention = r.posts.some((p) => p.seq > m.lastReadSeq && p.from !== m.name && (p.to.includes(m.name) || p.to.includes("all")));
    if (gotNewMention && stateNow() !== "killed" && stateNow() !== "stopped" && headSeq > m.lastReadSeq) {
      this.enqueueWake(threadId, m.name);
    }

    this.publish(r);
    this.pumpQueue(threadId);
  }

  /** Wakes the coordinator thread when idle with a compact digest of unread teammate posts. */
  private scheduleCoordinatorWake(r: SwarmRun) {
    if (!r.data.active || r.coordWakeQueued) return;
    if (this.host.isCoordinatorBusy(r.data.threadId)) return;
    const coord = r.data.members.find((m) => m.name === "coordinator");
    if (!coord) return;
    const unread = r.posts.filter((p) => p.seq > coord.lastReadSeq && p.from !== "coordinator");
    if (!unread.length) return;
    r.coordWakeQueued = true;
    const lines = unread.slice(-12).map((p) => `#${p.seq} [${p.channel}] @${p.from}: ${p.text}`);
    const digest = `[Swarm board update — ${unread.length} new ${unread.length === 1 ? "post" : "posts"}]\n${lines.join("\n")}\n\nReview the updates, coordinate next steps or land finished worktrees, or post "[done] <summary>" if the goal is complete.`;
    coord.lastReadSeq = unread[unread.length - 1].seq;
    this.save(r);
    void this.host.wakeCoordinator(r.data.threadId, digest).catch(() => {
      r.coordWakeQueued = false;
    });
  }

  /** Deterministic engine stall check (0 MB extra RAM, 0 LLM tokens). Exposed for unit tests. */
  checkStall(threadId: string): SwarmPost | null {
    const r = this.load(threadId);
    if (!r || !r.data.active || !r.data.stallMonitor) return null;
    if (this.host.isCoordinatorBusy(threadId)) return null;
    const liveWorkers = r.data.members.filter((m) => m.name !== "coordinator" && m.state !== "killed" && m.state !== "skipped");
    if (!liveWorkers.length) return null;
    if (liveWorkers.some((m) => m.state === "working" || m.state === "queued")) return null;
    const realPosts = r.posts.filter((p) => p.kind !== "stall");
    const lastReal = realPosts[realPosts.length - 1];
    if (!lastReal) return null;
    if (lastReal.from === "coordinator" && /^\[done\]/i.test(lastReal.text)) return null;

    if (r.stallState.headSeq === lastReal.seq && r.stallState.alerts >= STALL_MAX_ALERTS) return null;
    if (r.stallState.headSeq !== lastReal.seq) r.stallState = { headSeq: lastReal.seq, alerts: 0, pinged: new Set(), lastAt: 0 };

    // 1. Unanswered @mention to a waiting/hibernated worker (based on non-stall posts so re-pings escalate properly).
    for (const w of liveWorkers) {
      if (w.state === "stopped") continue;
      const mention = [...realPosts].reverse().find((p) => p.from !== w.name && (p.to.includes(w.name) || p.to.includes("all")));
      if (mention && mention.seq > (w.lastPostSeq ?? 0)) {
        r.stallState.alerts++;
        r.stallState.lastAt = Date.now();
        if (!r.stallState.pinged.has(w.name)) {
          r.stallState.pinged.add(w.name);
          return this.post(threadId, { from: "monitor", to: [w.name], channel: "main", kind: "stall", text: `@${w.name} [stall] #${mention.seq} is addressed to you and everyone is waiting.` }).post;
        }
        return this.post(threadId, { from: "monitor", to: ["coordinator"], channel: "main", kind: "stall", text: `@coordinator [stall] @${w.name} did not answer #${mention.seq} after a re-ping — consider swapping its model.` }).post;
      }
    }

    // 2. Unread results waiting for the coordinator.
    const coord = r.data.members.find((m) => m.name === "coordinator");
    if (coord && lastReal.seq > coord.lastReadSeq) {
      const unreadIds = realPosts.filter((p) => p.seq > coord.lastReadSeq && p.from !== "coordinator").map((p) => `#${p.seq}`);
      if (unreadIds.length) {
        r.stallState.alerts++;
        r.stallState.lastAt = Date.now();
        return this.post(threadId, { from: "monitor", to: ["coordinator"], channel: "main", kind: "stall", text: `@coordinator [stall] ${unreadIds.join(", ")} have unread updates while all members are parked.` }).post;
      }
    }
    return null;
  }

  private ensureStallTimer() {
    if (this.stallTimer) return;
    this.stallTimer = setInterval(() => {
      let anyActive = false;
      for (const [id, r] of this.runs) {
        if (!r.data.active) continue;
        anyActive = true;
        this.checkStall(id);
      }
      if (!anyActive && this.stallTimer) {
        clearInterval(this.stallTimer);
        this.stallTimer = undefined;
      }
    }, this.stallIntervalMs);
    this.stallTimer.unref?.();
  }

  /** Cleans up all active swarm processes and timers when the engine shuts down. */
  dispose() {
    if (this.stallTimer) {
      clearInterval(this.stallTimer);
      this.stallTimer = undefined;
    }
    for (const lw of [...this.live.values()]) {
      if (lw.hibernateTimer) clearTimeout(lw.hibernateTimer);
      lw.abort?.abort();
      try {
        void lw.session.close();
      } catch {}
    }
    this.live.clear();
  }

  /** Deletes persisted swarm files when a thread is permanently removed. */
  forgetThread(threadId: string) {
    this.stopAllWorkers(threadId, true);
    this.runs.delete(threadId);
    rmSync(this.dirOf(threadId), { recursive: true, force: true });
  }
}
