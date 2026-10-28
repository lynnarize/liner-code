/*
  What every provider adapter implements. An adapter turns one agent runtime's stream into the
  same few calls on a TurnSink, so the timeline, approvals and checkpoints work the same way for
  Claude Code, Codex, Hermes and OpenCode. A provider that can't do something (approvals in
  Codex exec, say) simply never calls that part of the sink.
*/
import type { Access, CommandInfo, ContextPart, Effort, ModelInfo, SkillInfo, PlanEntry, ProviderInfo, Question, Risk, ToolKind, ToolLimits, Usage } from "../../../contracts/src/index.ts";

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
};

export type ApprovalRequest = {
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
  ask(questions: Question[], signal: AbortSignal): Promise<Record<string, string> | null>;
  /** Shows a plan to approve; resolves with your decision. */
  propose(title: string, plan: string, signal: AbortSignal): Promise<{ approve: boolean; note?: string }>;
  /** Token use. `total` means the numbers are the session's running totals, not this turn's. */
  usage(u: Partial<Usage>, total?: boolean): void;
  /** The provider's own session id, kept for resume. */
  session(id: string): void;
  notice(text: string): void;
  error(message: string): void;
  /** The tool's plan ran out of usage; `until` is when its window reopens, if it said. */
  limited(message: string, until?: number): void;
};

export type OpenOptions = {
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
  /** This turn is a lead's plan: read only, ending in a plan to approve rather than in edits. */
  planning?: boolean;
  /** Claude Code subagents this agent brings (Explorer, Test runner, Opus for hard parts). */
  subagents?: Record<string, { description: string; prompt: string; tools?: string[]; model?: string }>;
  /** PATH and friends, from the shell that launched the app. */
  env: NodeJS.ProcessEnv;
  /** Liner Code's own tools for this session (its Browser, the Simulator, pages), as an MCP server on stdio. */
  mcp?: { command: string; args: string[]; env: Record<string, string> };
};

/** One live connection to an agent for one thread. Turns run one at a time. */
export interface ProviderSession {
  /** Runs one turn; resolves when the agent stops. */
  turn(text: string, sink: TurnSink, signal: AbortSignal): Promise<void>;
  /** A message for the running turn, read at the agent's next step. Return false if it can't. */
  steer?(text: string): boolean;
  /** Settings changed between turns. Return false to be reopened instead. */
  update?(o: Pick<OpenOptions, "model" | "effort" | "access">): Promise<boolean>;
  /** What fills the context now, by the tool's own count; null when it can't say. */
  context?(): Promise<{ used: number; max: number; parts: ContextPart[] } | null>;
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
