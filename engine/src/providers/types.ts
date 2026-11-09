/*
  What every provider adapter implements. An adapter turns one agent runtime's stream into the
  same few calls on a TurnSink, so the timeline, approvals and checkpoints work the same way for
  Claude Code, Codex, Hermes and OpenCode. A provider that can't do something (approvals in
  Codex exec, say) simply never calls that part of the sink.
*/
import type { Access, AgentRun, CommandInfo, ContextUse, Effort, LimitWindow, ModelInfo, SkillInfo, PlanEntry, ProviderInfo, Question, Risk, ToolKind, ToolLimits, Usage } from "../../../contracts/src/index.ts";
import { homedir } from "node:os";
import type { Connection } from "../addons.ts";

/**
  What a tool wrote to stderr, fit for the timeline, which is shown and saved: home folders become ~,
  and keys, tokens and sign-in links come out (T3 Code: provider-acp stderr.ts). A value `env` holds
  under a secret's name goes too, whatever it looks like.
*/
export function scrub(text: string, env: NodeJS.ProcessEnv = process.env) {
  let out = text.replaceAll("\0", "");
  for (const home of new Set([env.HOME, env.USERPROFILE, homedir()])) if (home && home.length > 1) out = out.split(home).join("~");
  for (const [name, value] of Object.entries(env)) if (value && value.length >= 8 && /(KEY|TOKEN|SECRET|PASSWORD)$/i.test(name)) out = out.split(value).join("[redacted]");
  return out
    .replace(/https?:\/\/[^\s]*\/pair#[^\s]*/gi, "[pairing-url]")
    .replace(/https?:\/\/accounts\.google\.com[^\s]*/gi, "[sign-in-url]")
    .replace(/\bBearer\s+[A-Za-z0-9._\-+=/]+/gi, "Bearer [redacted]")
    .replace(/\bAuthorization:\s*Basic\s+\S+/gi, "Authorization: Basic [redacted]")
    .replace(/\bx-api-key:\s*\S+/gi, "x-api-key: [redacted]")
    .replace(/\b(?:sk-[A-Za-z0-9][A-Za-z0-9_-]{7,}|ghp_[A-Za-z0-9]+|xox[a-zA-Z]-[A-Za-z0-9-]+)\b/g, "[redacted]");
}

export type ToolUpdate = {
  /** The provider's id for the call, so later updates find it. */
  key: string;
  tool: string;
  toolKind: ToolKind;
  title: string;
  input?: string;
  output?: string;
  status: "running" | "done" | "failed";
  path?: string;
  /**
    The agent a "task" call sent off, as it stands now (the whole of it each time). `parentKey`: the
    call of the agent that sent it, when an agent did; the runtime makes it that row's id.
  */
  agent?: Omit<AgentRun, "parent"> & { parentKey?: string };
};

export type ApprovalRequest = {
  /** The tool call it's for: the key its tool updates carry. */
  key?: string;
  tool: string;
  title: string;
  description?: string;
  risk: Risk;
  fields: { label: string; value: string }[];
  /** What "Don't ask again for … this session" would allow, like "pnpm test" or "Edit". */
  rule?: string;
};

export type TurnSink = {
  /** Streamed answer text. A new `block` starts a new paragraph item. */
  text(delta: string, block?: string): void;
  reasoning(delta: string, block?: string): void;
  tool(update: ToolUpdate): void;
  plan(entries: PlanEntry[]): void;
  /** Asks you; resolves with your answer. Rejects if the turn is stopped first. */
  approve(req: ApprovalRequest, signal: AbortSignal): Promise<{ allow: boolean; reason?: string }>;
  /** Asks you to pick between options; resolves with an answer per question, or null if you skipped. */
  /** `optional`: fine to go unanswered, so nobody being there (a routine) answers it with null rather than waiting. */
  ask(questions: Question[], signal: AbortSignal, o?: { optional?: boolean }): Promise<Record<string, string> | null>;
  /** Shows a plan to approve; resolves with your decision, and the plan as you edited it when you did. */
  propose(title: string, plan: string, signal: AbortSignal): Promise<{ approve: boolean; note?: string; plan?: string }>;
  /** Token use. `total` means the numbers are the session's running totals, not this turn's. */
  usage(u: Partial<Usage>, total?: boolean): void;
  /** The provider's own session id, kept for resume. */
  session(id: string): void;
  /** A line on the timeline. A later notice with the same `key` replaces it (a retry's count, a compaction that finished). */
  notice(text: string, key?: string): void;
  error(message: string): void;
  /** The tool's plan ran out of usage; `until` is when its window reopens, if it said. */
  limited(message: string, until?: number): void;
  /** One of the plan's windows, as the tool reported it mid-turn (Claude Code's rate limit events). */
  window?(w: LimitWindow): void;
  /** The tool is at work where nothing shows (a subagent's step, a retry): the watchdog starts counting again. */
  heard?(): void;
};

/**
  A turn the tool started by itself, with no message from you: work it left running in the
  background finished, and it answers about it (T3 Code: ClaudeAdapterV2.ts, its wake turns).
  The runtime runs it as a turn of its own on the timeline.
*/
export type WakeTurn = {
  /** What woke it, in a few words ("a background task finished"). */
  why?: string;
  /** False once a turn of yours took its messages in, so there's nothing left to run. */
  pending(): boolean;
  /** Writes the tool's own turn into `sink`; resolves when it ends. Stopping `signal` stops it. */
  run(sink: TurnSink, signal: AbortSignal): Promise<void>;
  /** Stops it without showing it: you pressed Stop before it began. */
  cancel(): void;
};

/**
  The session the tool was to resume is gone (Claude Code can't find its transcript, Codex its
  thread, an ACP agent its session). The tool has opened a new one that knows nothing, and the
  runtime sends the turn again with the conversation so far.
*/
export class ResumeFailed extends Error {}

export type OpenOptions = {
  /** The tool as the picker knows it, when it isn't the tool itself ("claude.api-deepseek": an endpoint through Claude Code): its agents' models are named under it. */
  provider?: string;
  cwd: string;
  model: string;
  effort: Effort;
  access: Access;
  soul: string;
  /** The provider session to continue, when this thread already has one. */
  resume?: string;
  /** Continue from `resume` in a new session of its own, leaving the original as it was. */
  fork?: boolean;
  /** Turn on the destructive-command guard even in Full access. */
  guard: boolean;
  /** A one-off read (a review, a judge, a commit message): the tool keeps no transcript of it. */
  ephemeral?: boolean;
  /**
    Just a model, for an app (access.ai): no tools of any kind, none of your settings, hooks or
    servers, and `soul` as its whole system prompt. Only a tool that can promise that takes it
    (Claude Code); the runtime asks no other (plainWay).
  */
  plain?: boolean;
  /** This turn is a lead's plan: read only, ending in a plan to approve rather than in edits. */
  planning?: boolean;
  /** A side chat beside a session: read only, and it answers rather than plans. */
  side?: boolean;
  /** Folders that exist outside `cwd` the tool may read as its own: where your attachments are saved. */
  dirs?: string[];
  /** Claude Code subagents this agent brings (Explorer, Test runner, Opus for hard parts). */
  subagents?: Record<string, { description: string; prompt: string; tools?: string[]; model?: string }>;
  /** PATH and friends, from the shell that launched the app. */
  env: NodeJS.ProcessEnv;
  /** Liner Code's own tools for this session (its Browser, the Simulator, pages), as an MCP server on stdio. */
  mcp?: { command: string; args: string[]; env: Record<string, string> };
  /** The connections you added (add-ons), beside `liner`, their keys filled in: never written to disk or a command line. */
  connections?: Connection[];
  /** Settings for the tool itself, the way Codex takes them with -c ("model_provider"): an API endpoint's, for one. */
  config?: Record<string, unknown>;
  /** The tool started a turn by itself; the runtime puts it on the timeline. */
  wake?: (w: WakeTurn) => void;
};

/** One live connection to an agent for one thread. Turns run one at a time. */
export interface ProviderSession {
  /**
    Runs one turn; resolves when the agent stops. `files` are your attachments, saved on disk and
    named in the text: images and PDFs also go to the model as they are where the tool takes them.
  */
  turn(text: string, sink: TurnSink, signal: AbortSignal, files?: string[]): Promise<void>;
  /** A message for the running turn, read at the agent's next step. False (or a promise of it) if it couldn't take it. */
  steer?(text: string, files?: string[]): boolean | Promise<boolean>;
  /** Stops one agent it sent off (`taskId`: its AgentRun's), the turn going on without it. False if it couldn't. */
  stopAgent?(taskId: string): boolean | Promise<boolean>;
  /** A word for one agent it sent off, read at that agent's next step. False if it couldn't take it. */
  steerAgent?(taskId: string, text: string): boolean | Promise<boolean>;
  /** Settings changed between turns. Return false to be reopened instead. */
  update?(o: Pick<OpenOptions, "model" | "effort" | "access">): Promise<boolean>;
  /** Something update() took and couldn't apply yet: the runtime calls it again next turn, rather than counting it as done. */
  owes?(): boolean;
  /**
    The connections changed: take them in now, even mid-turn, where the tool can. A session without
    this (or that answers false) is reopened for its next turn, resuming where it was.
  */
  connect?(connections: Connection[]): Promise<boolean>;
  /** What fills the context now, by the tool's own count; null when it can't say. */
  context?(): Promise<ContextUse | null>;
  close(): void;
}

export interface Provider {
  id: ProviderInfo["id"];
  detect(env: NodeJS.ProcessEnv): Promise<ProviderInfo>;
  /** The tool's slash commands and skills in this folder. */
  commands?(env: NodeJS.ProcessEnv, cwd: string): Promise<{ commands: CommandInfo[]; skills: SkillInfo[] }>;
  /** The signed-in plan's usage windows, when the tool can say. */
  limits?(env: NodeJS.ProcessEnv, scratch: string): Promise<Omit<ToolLimits, "provider" | "label" | "at"> | null>;
  /** Asks the tool which models it runs, in a scratch folder. Slower than detect; the engine caches it. */
  models?(env: NodeJS.ProcessEnv, scratch: string): Promise<ModelInfo[]>;
  open(o: OpenOptions): ProviderSession;
}
