/*
  Claude Code, through the Claude Agent SDK. One query() stays open per thread with a streaming
  prompt, so follow-ups land in the same session and resume works after a restart. Approvals
  come through canUseTool; partial messages give the text and thinking as they are written.

  Access maps onto Claude Code's permission modes:
  - read:  plan (looks, changes nothing; ends with a plan to approve)
  - ask:   default (asks before edits and commands)
  - edits: acceptEdits (edits on its own, asks before commands)
  - auto:  auto (Claude Code's classifier approves routine steps and asks about the rest)
  - full:  acceptEdits, and every other call is allowed, except destructive commands while the
           guard is on, which still come back to you.
  AskUserQuestion and ExitPlanMode are caught in canUseTool and shown as cards.

  A lead doesn't run in plan mode: Claude Code's plan mode makes every turn end in a plan or a
  question, even "hello". It runs in the default mode with the editing tools taken away, answers
  talk directly, and wraps a plan in <plan> tags when you ask for a change (see the runtime).
*/
import { query, type Options, type PermissionMode, type Query, type SDKControlGetContextUsageResponse, type SDKMessage, type SDKResultMessage, type SDKUserMessage, type SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Access, ContextPart, ContextSource, ContextUse, ModelInfo, PlanEntry, ProviderInfo, ToolKind } from "../../../contracts/src/index.ts";
import { base64Size, imageType, isPdf, pdfPages, readUpTo } from "./attachments.ts";
import { run, versionOf, which } from "../exec.ts";
import { VERSION } from "../version.ts";
import { linerTitle } from "../agent-tools.ts";
import { commandRisk, isDestructive, ruleFor } from "../risk.ts";
import { subagentName } from "../review.ts";
import { effortOf, skillsIn, ULTRACODE, ULTRATHINK } from "./models.ts";
import { ResumeFailed, type OpenOptions, type Provider, type ProviderSession, type TurnSink } from "./types.ts";

/** The SDK's query(), held here so tests can stand in a Claude Code of their own. */
export const sdk = { query };

/** Only until Claude Code answers: the engine asks it for its real list as it starts. */
const FALLBACK: ModelInfo[] = [
  { id: "claude-opus-5-5", label: "Opus 5.5", description: "Best for everyday, complex tasks", isDefault: true },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", description: "Efficient for routine tasks" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", description: "Fastest for quick answers" },
].map((m) => ({ ...m, efforts: ["low", "medium", "high"].map((e) => effortOf(e)), defaultEffort: "medium" }));

const LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);
/** What the SDK takes for one of our effort names: ultracode is extra high plus workflows; ultrathink is a word in the prompt. */
const sdkEffort = (e: string) => (e === "ultracode" ? "xhigh" : LEVELS.has(e) ? (e as "low") : undefined);

const limitName = (t?: string) => (t === "five_hour" ? "5-hour limit" : t === "seven_day" ? "weekly limit" : t === "seven_day_opus" ? "weekly Opus limit" : t === "seven_day_sonnet" ? "weekly Sonnet limit" : t === "overage" ? "extra usage" : "usage limit");

type RateInfo = { status?: string; rateLimitType?: unknown; resetsAt?: unknown; overageStatus?: string; isUsingOverage?: boolean; overageInUse?: boolean };
/**
  A rejected rate limit that ends the work: its words and when the window reopens. With extra usage
  on, a rejected window carries on through it, so that isn't the end (as T3 Code reads it).
*/
function blocked(info: RateInfo | undefined): { message: string; until?: number } | null {
  if (info?.status !== "rejected") return null;
  if (info.overageStatus === "allowed" || info.overageStatus === "allowed_warning" || info.isUsingOverage === true || info.overageInUse === true) return null;
  const at = typeof info.resetsAt === "number" && info.resetsAt > 0 ? (info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt) : undefined;
  return { message: `Your Claude plan's ${limitName(typeof info.rateLimitType === "string" ? info.rateLimitType : undefined)} is used up.`, until: at };
}

const CONTEXT_FULL = "Claude stopped: the conversation no longer fits the model's context window. Run /compact, or start a new session.";

/** What a result's terminal reason says went wrong; nothing for one that ended as it should (T3 Code: ClaudeAdapterV2.ts, terminalResultError). */
export function terminalError(reason: string | undefined, hint?: string): string | undefined {
  switch (reason) {
    case "api_error":
      return hint ?? "Claude gave up after repeated API errors.";
    case "malformed_tool_use_exhausted":
      return "Claude gave up after repeated malformed tool calls.";
    case "budget_exhausted":
      return "Claude stopped: the turn's token budget ran out.";
    case "structured_output_retry_exhausted":
      return "Claude couldn't produce the structured answer it was asked for.";
    case "tool_deferred_unavailable":
      return "Claude couldn't carry on a tool call it had put off: the tool isn't there any more.";
    case "turn_setup_failed":
      return "Claude couldn't start the turn.";
    // A blocking limit is a full context too; only a rate limit's own words make it one.
    case "blocking_limit":
      return hint ?? CONTEXT_FULL;
    case "rapid_refill_breaker":
      return "Claude stopped: the context filled up again too quickly after compacting.";
    case "prompt_too_long":
      return CONTEXT_FULL;
    case "image_error":
      return "Claude stopped: an image in the conversation couldn't be read.";
    case "model_error":
      return "Claude stopped: the model returned an error.";
    default:
      return undefined;
  }
}

/**
  The words a result ends its turn with when it failed, or nothing when it went well (T3 Code:
  ClaudeAdapterV2.ts, providerFailureFromResult). Claude Code can report an API failure as a
  "success" with is_error, an HTTP status or a terminal reason, so a failure never ends as a blank done.
*/
export function resultError(m: SDKResultMessage, hint?: string): string | undefined {
  // Stopped mid-step (by you, or by a steer that cut in): not a failure.
  if (m.terminal_reason === "aborted_streaming" || m.terminal_reason === "aborted_tools") return undefined;
  // Claude Code's own diagnostics aren't for you.
  const listed = m.subtype === "success" ? undefined : m.errors.find((e) => typeof e === "string" && !e.startsWith("[ede_diagnostic]"));
  const status = m.subtype === "success" ? m.api_error_status : undefined;
  const apiError = m.subtype === "success" && m.terminal_reason === "api_error" && m.result.trim().startsWith("API Error:") ? m.result.trim().slice(0, 500) : undefined;
  const structured = status === 529 ? "Claude's API is overloaded (529). Try again shortly." : status === 429 ? "Claude's API rate limit was reached. Try again later." : terminalError(m.terminal_reason, hint ?? apiError);
  if (m.subtype !== "success") return listed ?? structured ?? (m.errors.join("\n") || "Claude Code stopped with an error.");
  if (!m.is_error && !structured) return undefined;
  return structured ?? hint ?? (m.result || "Claude Code stopped with an error.");
}

/** Said when Claude Code's sign-in stopped working, naming an account's own config folder (T3 Code: ClaudeHome.ts, claudeSignedOutMessage). */
export function signedOut(configDir?: string) {
  const dir = configDir?.trim();
  const tilde = dir && dir.startsWith(homedir()) ? `~${dir.slice(homedir().length)}` : dir;
  return `Claude Code couldn't sign in. Sign in to Claude Code again: run claude auth login${tilde ? ` with CLAUDE_CONFIG_DIR=${tilde}` : ""} in a terminal, then send your message again.`;
}

/** An API retry, in words ("Claude is overloaded, retrying (2 of 10)"). */
function retryText(error: string, attempt: number, max: number) {
  const why: Record<string, string> = { overloaded: "Claude is overloaded", rate_limit: "Claude hit a rate limit", server_error: "Claude's API had an error", authentication_failed: "Claude Code couldn't sign in", billing_error: "Claude's billing had a problem", unknown: "Claude's API didn't answer" };
  return `${why[error] ?? `Claude's API said ${error.replace(/_/g, " ")}`}, retrying (${attempt} of ${max})`;
}

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** Claude Code's task list (the TaskCreate, TaskUpdate and TaskList tools), by task id. */
export type TaskList = Map<string, PlanEntry>;
const field = (v: unknown, key: string): unknown => (typeof v === "object" && v !== null ? (v as Record<string, unknown>)[key] : undefined);
const word = (v: unknown, key: string) => {
  const f = field(v, key);
  return typeof f === "string" && f.trim() ? f.trim() : undefined;
};
const taskStatus = (v: unknown): PlanEntry["status"] | undefined => (v === "pending" || v === "in_progress" || v === "completed" ? v : undefined);

/**
  The task list after one of its tools ran, or undefined when it didn't change. Claude 5's tools
  edit one list per session, across turns, as TodoWrite rewrote it whole (T3 Code: ClaudeAdapterV2.ts,
  applyClaudeTaskTool). `result` is the tool's structured result, or its words from a subagent.
*/
export function applyTaskTool(tasks: TaskList, tool: string, input: unknown, result: unknown): TaskList | undefined {
  if (tool === "TaskList") {
    const listed = field(result, "tasks");
    if (!Array.isArray(listed)) return undefined;
    const next: TaskList = new Map();
    for (const t of listed) {
      const id = word(t, "id");
      const title = word(t, "subject");
      const status = taskStatus(field(t, "status"));
      if (id && title && status) next.set(id, { title, status });
    }
    return next.size || tasks.size ? next : undefined;
  }
  if (tool === "TaskCreate") {
    // A subagent's result is only words: "Task #3 created successfully: <subject>".
    const said = typeof result === "string" ? /^Task #(\S+) created successfully: (.+)$/s.exec(result) : null;
    const id = word(field(result, "task"), "id") ?? said?.[1];
    const title = word(field(result, "task"), "subject") ?? said?.[2]?.trim() ?? word(input, "subject");
    return id && title ? new Map(tasks).set(id, { title, status: "pending" }) : undefined;
  }
  if (tool !== "TaskUpdate" || field(result, "success") === false || (typeof result === "string" && !result.startsWith("Updated task #"))) return undefined;
  const id = word(input, "taskId") ?? word(result, "taskId");
  const task = id ? tasks.get(id) : undefined;
  if (!id || !task) return undefined;
  if (field(input, "status") === "deleted") {
    const next = new Map(tasks);
    next.delete(id);
    return next;
  }
  const title = word(input, "subject") ?? task.title;
  const status = taskStatus(field(input, "status")) ?? task.status;
  return title === task.title && status === task.status ? undefined : new Map(tasks).set(id, { title, status });
}

/** Claude reads at most this much of images and documents in a conversation (T3 Code: ClaudeAdapterV2.ts, its attachment budget). */
const MAX_BYTES = 28 * 1024 * 1024;
const MAX_PAGES = 100;
type Content = Exclude<Extract<SDKUserMessage["message"], { role: "user" }>["content"], string>;

/**
  Your message with its images and PDFs as content blocks, so Claude sees them as they are
  (T3 Code: ClaudeAdapterV2.ts, makeClaudeUserMessageWithAttachments). They count against what a
  conversation may hold: a file past it, an image over 5 MB, or a PDF whose pages can't be counted
  goes by its path alone, which the text names either way.
*/
export function withFiles(text: string, files: string[], budget: { bytes: number; pages: number }): string | Content {
  const blocks: Content = [];
  for (const path of files) {
    const type = imageType(path);
    if (type) {
      const bytes = readUpTo(path, 5 * 1024 * 1024);
      if (!bytes || budget.bytes + base64Size(bytes.length) > MAX_BYTES) continue;
      budget.bytes += base64Size(bytes.length);
      blocks.push({ type: "image", source: { type: "base64", media_type: type as "image/png", data: bytes.toString("base64") } });
    } else if (isPdf(path)) {
      const bytes = readUpTo(path, 20 * 1024 * 1024);
      const pages = bytes ? pdfPages(bytes) : null;
      if (!bytes || !pages || budget.pages + pages > MAX_PAGES || budget.bytes + base64Size(bytes.length) > MAX_BYTES) continue;
      budget.bytes += base64Size(bytes.length);
      budget.pages += pages;
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } });
    }
  }
  return blocks.length ? [...blocks, { type: "text", text }] : text;
}

/** Opens Claude Code with no prompt to ask it something (its models, its limits), then closes it. */
async function probe<T>(env: NodeJS.ProcessEnv, scratch: string, ask: (q: Query) => Promise<T>): Promise<T | null> {
  const path = which("claude", env);
  if (!path) return null;
  mkdirSync(scratch, { recursive: true });
  const abort = new AbortController();
  const idle = async function* (): AsyncGenerator<SDKUserMessage> {
    await new Promise((r) => abort.signal.addEventListener("abort", r));
  };
  const q = query({ prompt: idle(), options: { cwd: scratch, pathToClaudeCodeExecutable: path, env: { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: `liner-code/${VERSION}` }, settingSources: ["user"], abortController: abort } });
  try {
    return await Promise.race([ask(q), new Promise<never>((_, no) => setTimeout(() => no(new Error("Claude Code didn't answer in time.")), 30000))]);
  } finally {
    abort.abort();
  }
}

/** Claude Code's own model list: its current models by alias, then older ones it still runs. */
async function listModels(env: NodeJS.ProcessEnv, scratch: string): Promise<ModelInfo[]> {
  const list = await probe(env, scratch, (q) => q.supportedModels());
  if (!list) return [];
  {
    const chosen = list.find((m) => m.value === "default")?.resolvedModel;
    const current = new Set(list.filter((m) => !m.value.startsWith("claude-") && m.value !== "default").map((m) => m.resolvedModel ?? m.value));
    const out = new Map<string, ModelInfo>();
    for (const m of list) {
      if (m.value === "default") continue;
      const id = m.resolvedModel ?? m.value;
      if (out.has(id)) continue;
      const levels = m.supportsEffort === false ? [] : (m.supportedEffortLevels ?? []);
      const efforts = levels.map((e) => effortOf(e));
      if (levels.includes("xhigh")) efforts.push(ULTRACODE);
      if (m.supportsAdaptiveThinking !== false) efforts.push(ULTRATHINK);
      out.set(id, { id, label: m.displayName, description: m.description, efforts, defaultEffort: levels.includes("medium") ? "medium" : levels[0], legacy: !current.has(id) || undefined, isDefault: id === chosen || undefined });
    }
    return [...out.values()];
  }
}

/**
  Claude 5's task list. Claude Code uses these in place of TodoWrite unless CLAUDE_CODE_ENABLE_TODO_TOOLS
  turns TodoWrite back on (Claude Code 2.1.314 reads it so), so both map onto the plan.
*/
const TASK_TOOLS = new Set(["TaskCreate", "TaskUpdate", "TaskList", "TaskGet"]);

const MODE: Record<Access, PermissionMode> ={ read: "plan", ask: "default", edits: "acceptEdits", auto: "auto", review: "acceptEdits", full: "acceptEdits" };
/** A lead reads and plans, and a side chat reads and answers; these stay with the coder. */
const LEAD_DENIED = ["Edit", "MultiEdit", "Write", "NotebookEdit", "EnterPlanMode", "ExitPlanMode"];

/** What kind of thing a Claude Code tool does, for its icon and risk. */
function kindOf(name: string): ToolKind {
  if (name === "Bash" || name === "BashOutput" || name === "KillShell") return "exec";
  if (name === "Read" || name === "NotebookRead") return "read";
  if (name === "Edit" || name === "MultiEdit" || name === "NotebookEdit") return "edit";
  if (name === "Write") return "write";
  if (name === "Glob" || name === "Grep" || name === "LS") return "search";
  if (name === "WebFetch") return "fetch";
  if (name === "WebSearch") return "web";
  if (name === "Task" || name === "Agent") return "task";
  if (name === "TodoWrite" || TASK_TOOLS.has(name)) return "think";
  return "other";
}

/** A plan's name: its first heading or first line. */
function planTitle(plan: string) {
  const line = plan.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "The plan";
  return line.length > 70 ? `${line.slice(0, 68)}…` : line;
}

/** A tool's calls and results in the context, by what they brought in. */
const TOOL_SOURCES: [RegExp, string, ContextSource["group"]][] = [
  [/^(?:Read|NotebookRead|LS)$/, "Files read", "files"],
  [/^(?:Edit|MultiEdit|Write|NotebookEdit)$/, "Edits", "files"],
  [/^(?:Grep|Glob)$/, "Searches", "files"],
  [/^(?:Bash|BashOutput|KillShell|KillBash)$/, "Commands", "runs"],
  [/^WebFetch$/, "Web pages", "web"],
  [/^WebSearch$/, "Web searches", "web"],
  [/^mcp__liner__browser_/, "Browser", "web"],
  [/^(?:Task|Agent)$/, "Subagents", "tools"],
  [/^TodoWrite$/, "Plan", "tools"],
  [/^ToolSearch$/, "Tool search", "tools"],
];
const GROUPS: ContextSource["group"][] = ["setup", "project", "talk", "files", "runs", "web", "tools"];

/**
  What fills a Claude Code session's context, source by source: its own prompt and tools, the
  project's memory files, skills and agents, then the conversation: what you and it said, and what
  each kind of step brought in. In the order the bar draws them; zeros left out.
*/
export function contextSources(u: SDKControlGetContextUsageResponse): ContextSource[] {
  const out: ContextSource[] = [];
  const add = (s: ContextSource) => void (s.tokens > 0 && out.push(s));
  const cat = (id: string) => u.categories.find((c) => c.id === id && c.kind === "used")?.tokens ?? 0;
  const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

  add({ name: "System prompt", tokens: cat("system_prompt"), group: "setup" });
  add({ name: "Built-in tools", tokens: cat("system_tools"), group: "setup", detail: u.systemTools?.length ? `${u.systemTools.length} tools Claude Code always has` : undefined });
  // MCP tools in the window, server by server: all of them, or only those loaded when the rest wait outside it.
  const waiting = u.categories.some((c) => c.id === "mcp_tools_deferred" && c.tokens > 0);
  const servers = new Map<string, { tokens: number; n: number }>();
  for (const t of u.mcpTools ?? []) {
    if (waiting && !t.isLoaded) continue;
    const s = servers.get(t.serverName) ?? { tokens: 0, n: 0 };
    servers.set(t.serverName, { tokens: s.tokens + t.tokens, n: s.n + 1 });
  }
  if (servers.size && cat("mcp_tools") > 0) for (const [name, s] of servers) add({ name: `${name} tools`, tokens: s.tokens, group: "setup", detail: `${s.n} tools from the ${name} MCP server` });
  else add({ name: "MCP tools", tokens: cat("mcp_tools"), group: "setup" });
  add({ name: "MCP instructions", tokens: cat("mcp_instructions"), group: "setup", detail: u.mcpInstructions?.length ? u.mcpInstructions.map((m) => m.serverName).join(", ") : undefined });

  // The project's: memory files by name (with where they're from when two share one), skills, agents.
  const names = (u.memoryFiles ?? []).map((m) => m.path.split("/").pop() ?? m.path);
  for (const [i, m] of (u.memoryFiles ?? []).entries()) add({ name: names.filter((n) => n === names[i]).length > 1 ? `${names[i]} · ${m.type}` : names[i], tokens: m.tokens, group: "project", detail: `${m.type}: ${home(m.path)}` });
  add({ name: "Skills", tokens: cat("skills"), group: "project", detail: u.skills ? `${u.skills.includedSkills} skills, by name and description` : undefined });
  add({ name: "Agents", tokens: cat("custom_agents"), group: "project", detail: u.agents?.length ? u.agents.map((a) => a.agentType).join(", ") : undefined });

  // The conversation: what was said, and what each kind of step brought in. Its breakdown is an
  // estimate whose attachments count again what's listed above (the skills, MCP instructions), so
  // the parts fit inside the Messages total, and what's left is the context Claude Code adds.
  const b = u.messageBreakdown;
  const talk = cat("messages");
  if (!b) add({ name: "Conversation", tokens: talk, group: "talk" });
  else {
    const steps = new Map<string, ContextSource & { calls: number; results: number }>();
    for (const t of b.toolCallsByType) {
      // A tool of an MCP server goes with the rest of that server's.
      const server = /^mcp__(.+?)__/.exec(t.name)?.[1];
      const [, name, group] = TOOL_SOURCES.find(([re]) => re.test(t.name)) ?? [null, server ? `${server} tools` : t.name, "tools" as const];
      const s = steps.get(name) ?? { name, group, tokens: 0, calls: 0, results: 0 };
      steps.set(name, { ...s, tokens: s.tokens + t.callTokens + t.resultTokens, calls: s.calls + t.callTokens, results: s.results + t.resultTokens });
    }
    const said = b.userMessageTokens + b.assistantMessageTokens + [...steps.values()].reduce((n, s) => n + s.tokens, 0);
    const fit = said > talk && said > 0 ? talk / said : 1;
    add({ name: "Your messages", tokens: Math.round(b.userMessageTokens * fit), group: "talk" });
    add({ name: "Answers", tokens: Math.round(b.assistantMessageTokens * fit), group: "talk" });
    for (const s of steps.values()) add({ name: s.name, tokens: Math.round(s.tokens * fit), group: s.group, detail: `${k(s.results)} in results, ${k(s.calls)} in calls` });
    const kinds = [...b.attachmentsByType].sort((x, y) => y.tokens - x.tokens).slice(0, 4).map((a) => a.name.replace(/_/g, " "));
    add({ name: "Added context", tokens: Math.max(0, talk - Math.round(said * fit)), group: "talk", detail: `What Claude Code adds to the conversation${kinds.length ? `: ${kinds.join(", ")}` : ""}` });
  }
  return out.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || b.tokens - a.tokens);
}

/** What one request sent: its prompt, the cached part included. */
const promptTokens = (u: { input_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }) => (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);

const short = (s: unknown, n = 80) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** A tool call, in words. */
function titleOf(name: string, input: Record<string, unknown>, cwd: string): { title: string; path?: string } {
  const rel = (p: unknown) => (typeof p === "string" ? (p.startsWith(cwd + "/") ? p.slice(cwd.length + 1) : p) : "");
  switch (name) {
    case "Bash":
      return { title: short(input.description || input.command) };
    case "Read":
      return { title: `Read ${rel(input.file_path)}`, path: rel(input.file_path) };
    case "Edit":
    case "MultiEdit":
      return { title: `Edit ${rel(input.file_path)}`, path: rel(input.file_path) };
    case "Write":
      return { title: `Write ${rel(input.file_path)}`, path: rel(input.file_path) };
    case "Glob":
      return { title: `Find ${short(input.pattern, 50)}` };
    case "Grep":
      return { title: `Search for ${short(input.pattern, 50)}` };
    case "WebFetch":
      return { title: `Fetch ${short(input.url, 60)}` };
    case "WebSearch":
      return { title: `Search the web for ${short(input.query, 50)}` };
    case "Task":
    case "Agent":
      return { title: `${subagentName(String(input.subagent_type ?? "general-purpose"))}: ${short(input.description || "a task", 60)}` };
    case "TodoWrite":
      return { title: "Update the plan" };
    case "TaskCreate":
      return { title: `Add to the plan: ${short(input.subject, 60)}` };
    case "TaskUpdate":
      return { title: input.status === "completed" ? `Finish step ${short(input.taskId, 10)}` : input.status === "in_progress" ? `Start step ${short(input.taskId, 10)}` : `Update step ${short(input.taskId, 10)}` };
    case "TaskList":
    case "TaskGet":
      return { title: "Read the plan" };
    default:
      if (name.startsWith("mcp__liner__")) return { title: linerTitle(name.slice(12), input) };
      return { title: name.startsWith("mcp__") ? name.split("__").slice(1).join(" · ") : name };
  }
}

/** A queue the SDK reads the prompt from: each push is one message you sent, by an id Claude Code's results echo. */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private done = false;
  push(content: string | Content, priority?: "now" | "next") {
    const uuid = randomUUID();
    this.queue.push({ type: "user", message: { role: "user", content }, parent_tool_use_id: null, uuid, ...(priority ? { priority } : {}) });
    this.wake?.();
    return uuid;
  }
  end() {
    this.done = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    while (!this.done) {
      if (this.queue.length) {
        yield this.queue.shift()!;
        continue;
      }
      await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }
}

class ClaudeSession implements ProviderSession {
  private q: Query | null = null;
  private inbox = new Inbox();
  private sink: TurnSink | null = null;
  private signal: AbortSignal | null = null;
  private finish: (() => void) | null = null;
  private fail: ((e: Error) => void) | null = null;
  private blocks = new Map<number, { kind: "text" | "thinking" | "tool"; key: string }>();
  private tools = new Map<string, { name: string; input: Record<string, unknown> }>();
  private access: Access;
  private o: OpenOptions;
  private path: string | null;
  private limited = false;
  /**
    The context the last request of the main thread used: its prompt (cache included) and what it
    wrote. The result's usage adds up every request of the turn, so it can't say how full the
    context is (T3 Code reads the last message's usage the same way).
  */
  private ctx: { id: string; input: number; output: number } | null = null;
  /** This turn's messages (what you sent, and any steer) that no result has answered yet. */
  private sent = new Set<string>();
  /**
    The query's running totals at its last result, so each turn reports only its own use. Null when
    it resumed or forked a session: its first totals carry that transcript's earlier turns too.
  */
  private seen: { input: number; output: number; cache: number; cost: number } | null = null;
  /** Claude Code's slash commands and skills, as it last listed them. */
  commands: SlashCommand[] = [];
  /**
    Work Claude Code runs as a task (a subagent, a command), by task id, from its task_started until
    its task_notification: what it is, the tool call that started it, and whether it runs in the background.
  */
  private tasks = new Map<string, { description: string; toolUseId?: string; type?: string; background?: boolean }>();
  private ended = new Map<string, { description: string; toolUseId?: string; type?: string; background?: boolean }>();
  /** Queries left behind (one whose resume failed): what they still say goes nowhere. */
  private retired = new WeakSet<Query>();
  /** Tasks Stop ended: their notifications are expected, and wake nothing. */
  private hushed = new Set<string>();
  /** Notifications of those since the last turn of yours: what Claude Code would wake to tell about. */
  private hushedNotes = 0;
  /**
    What came while no turn ran: a background task's word, or the start of a turn Claude Code began
    by itself about it. Held for that turn once the runtime runs it, or for your next turn.
  */
  private idle: SDKMessage[] = [];
  /** A turn Claude Code began by itself, offered to the runtime and not run yet. */
  private waking: { pending: boolean } | null = null;
  /** The running turn is one Claude Code began by itself: no message of ours ends it. */
  private woke = false;
  /** A stopped turn we let go of before Claude Code said it ended: what's left of it is dropped. */
  private draining = false;
  /** Claude Code echoes our messages' ids on its results; once seen, a result that echoes none and came from elsewhere isn't ours. */
  private echoes = false;
  /** The images and PDFs this conversation holds so far, against what Claude reads in one. */
  private budget = { bytes: 0, pages: 0 };
  /** The task list (TaskCreate and friends), kept across turns. */
  private taskList: TaskList = new Map();
  /** A running command's output, read from the file Claude Code writes it to, by its tool call. */
  private tails = new Map<string, { timer?: NodeJS.Timeout; file?: string; offset: number; text: string; tries: number }>();
  /** The notice an API retry or a compaction updates in place while it lasts. */
  private retryKey: string | null = null;
  private compactKey: string | null = null;
  /** Why the sign-in failed, said when the turn ends. */
  private authFailure: string | undefined;

  constructor(o: OpenOptions) {
    this.o = o;
    this.access = o.access;
    this.path = which("claude", o.env);
  }

  private start() {
    const o = this.o;
    const options: Options = {
      cwd: o.cwd,
      model: o.model || undefined,
      effort: sdkEffort(o.effort),
      // Ultracode: standing multi-agent workflows on top of extra high effort.
      settings: o.effort === "ultracode" ? { ultracode: true } : undefined,
      thinking: { type: "adaptive", display: "summarized" },
      permissionMode: o.planning || o.side ? "default" : MODE[this.access],
      disallowedTools: o.planning || o.side ? LEAD_DENIED : undefined,
      includePartialMessages: true,
      agents: o.subagents && Object.keys(o.subagents).length ? o.subagents : undefined,
      resume: o.resume,
      forkSession: o.fork || undefined,
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code", append: o.soul || undefined },
      env: { ...o.env, CLAUDE_AGENT_SDK_CLIENT_APP: `liner-code/${VERSION}` },
      permissionPrompts: "host",
      pathToClaudeCodeExecutable: this.path ?? undefined,
      mcpServers: o.mcp ? { liner: { type: "stdio", command: o.mcp.command, args: o.mcp.args, env: o.mcp.env } } : undefined,
      canUseTool: async (name, input, { signal, toolUseID }) => {
        const sink = this.sink;
        if (!sink) return { behavior: "deny", message: "The turn has ended." };
        // Liner Code's own tools only reach this session's Browser, the Simulator and its timeline.
        if (name.startsWith("mcp__liner__")) return { behavior: "allow", updatedInput: input };
        // The agent asks you to choose: shown as a question card, answered in its input.
        if (name === "AskUserQuestion" && Array.isArray(input.questions)) {
          const questions = (input.questions as { question: string; header?: string; options?: { label: string; description?: string }[]; multiSelect?: boolean }[]).map((q) => ({
            question: q.question,
            header: q.header,
            multiSelect: q.multiSelect,
            options: (q.options ?? []).map((o, i) => ({ label: o.label, description: o.description, suggested: i === 0 && /recommend/i.test(o.label + (o.description ?? "")) })),
          }));
          const answers = await sink.ask(questions, signal).catch(() => null);
          if (!answers) return { behavior: "deny", message: "The user skipped these questions. Carry on with your best judgement and say what you assumed." };
          return { behavior: "allow", updatedInput: { ...input, answers } };
        }
        // A plan, at the end of plan mode: shown to approve.
        if (name === "ExitPlanMode") {
          const plan = String(input.plan ?? "");
          const title = planTitle(plan);
          const answer = await sink.propose(title, plan, signal).catch((): { approve: boolean; note?: string; plan?: string } => ({ approve: false }));
          if (!answer.approve) return { behavior: "deny", message: answer.note ? `Change the plan: ${answer.note}` : "The user didn't approve the plan. Ask what to change." };
          this.access = "edits";
          void this.q?.setPermissionMode(MODE.edits).catch(() => {});
          // The plan as you left it: you may have edited its steps before approving.
          return { behavior: "allow", updatedInput: { ...input, plan: answer.plan ?? input.plan } };
        }
        const command = typeof input.command === "string" ? input.command : "";
        // Full access acts, except where the guard says the step can't be undone.
        if (this.access === "full" && !(this.o.guard && isDestructive(command))) return { behavior: "allow", updatedInput: input };
        const kind = kindOf(name);
        const { title, path } = titleOf(name, input, o.cwd);
        const fields: { label: string; value: string }[] = [];
        if (command) fields.push({ label: "Command", value: command });
        if (path) fields.push({ label: "File", value: path });
        if (typeof input.url === "string") fields.push({ label: "URL", value: input.url });
        if (!fields.length) fields.push({ label: "Input", value: short(JSON.stringify(input), 240) });
        fields.push({ label: "Runs in", value: o.cwd });
        const answer = await sink.approve(
          {
            key: toolUseID,
            tool: name,
            // A command's own description reads as the ask ("Write the note and commit it"); the command is in its field.
            title: kind === "exec" ? (typeof input.description === "string" && input.description.trim() ? short(input.description.charAt(0).toUpperCase() + input.description.slice(1), 70) : `Run ${short(command, 60)}`) : title,
            description: typeof input.description === "string" && kind !== "exec" ? input.description : undefined,
            risk: kind === "exec" ? commandRisk(command) : kind === "edit" || kind === "write" ? "low" : "medium",
            fields,
            rule: kind === "exec" ? ruleFor(command) : kind === "edit" || kind === "write" ? "Edit" : name,
          },
          signal,
        );
        return answer.allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: answer.reason ? `The user said no, and asks instead: ${answer.reason}` : "The user said no to this step." };
      },
    };
    this.seen = o.resume ? null : { input: 0, output: 0, cache: 0, cost: 0 };
    this.q = sdk.query({ prompt: this.inbox, options });
    void this.pump(this.q);
  }

  private async pump(q: Query) {
    try {
      for await (const m of q) if (!this.retired.has(q)) this.onMessage(m);
      if (!this.retired.has(q)) this.fail?.(new Error("Claude Code stopped."));
    } catch (e) {
      if (!this.retired.has(q)) this.fail?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (this.q === q) this.q = null;
      for (const id of [...this.tails.keys()]) this.untail(id);
    }
  }

  /** Work Claude Code runs as a task, kept whether or not a turn runs, so Stop and a steer can reach it. */
  private track(m: SDKMessage) {
    if (m.type !== "system") return;
    if (m.subtype === "task_started") this.tasks.set(m.task_id, { description: m.description, toolUseId: m.tool_use_id, type: m.task_type, background: m.is_backgrounded });
    else if (m.subtype === "task_updated" && m.patch.is_backgrounded !== undefined) {
      const t = this.tasks.get(m.task_id);
      if (t) t.background = m.patch.is_backgrounded;
    } else if (m.subtype === "task_notification") {
      if (this.hushed.has(m.task_id)) this.hushedNotes++;
      const t = this.tasks.get(m.task_id);
      this.tasks.delete(m.task_id);
      // Kept a while after, so its notice can name it.
      if (t) this.ended.set(m.task_id, t);
      if (this.ended.size > 50) this.ended.delete(this.ended.keys().next().value!);
      if (t?.toolUseId) this.untail(t.toolUseId);
    } else if (m.subtype === "background_tasks_changed") {
      // The background roster; tasks it leaves out may still owe a notification, so they're kept.
      for (const x of m.tasks) this.tasks.set(x.task_id, { ...this.tasks.get(x.task_id), description: x.description, type: x.task_type, background: true });
    }
  }

  /**
    A message with no turn running. Claude Code starts a turn of its own when work it left in the
    background finishes; that turn's messages are held, and offered to the runtime as a turn once
    one shows it began: its first words, a step, or its result (T3 Code: ClaudeAdapterV2.ts,
    bufferWakeMessage). A background task's word alone waits for whichever turn comes next.
  */
  private whileIdle(m: SDKMessage) {
    if (m.type === "system" && m.subtype === "commands_changed") {
      this.commands = m.commands;
      return;
    }
    // The rest of a turn we let go of after Stop: nothing more of it shows, up to its result.
    if (this.draining) {
      if (m.type === "result") this.draining = false;
      return;
    }
    // An init alone doesn't count: opening a session to resume it may send one before any turn.
    const root = (m.type === "assistant" || m.type === "stream_event" || m.type === "user") && !m.parent_tool_use_id;
    const start = root || (m.type === "result" && m.num_turns > 0);
    const kept = start || m.type === "result" || m.type === "rate_limit_event" || (m.type === "system" && ["init", "task_notification", "api_retry", "status", "compact_boundary", "informational", "model_refusal_fallback", "model_refusal_no_fallback", "local_command_output"].includes(m.subtype));
    if (!kept) return;
    this.idle.push(m);
    if (!start || this.waking) return;
    const notes = this.idle.flatMap((x) => (x.type === "system" && x.subtype === "task_notification" ? [x] : []));
    // Claude Code answering about work you stopped (its notifications came in or after the stopped turn)
    // isn't wanted: that turn stops too, unseen (T3 Code: BackgroundWorkStop.integration.test.ts).
    if (notes.every((x) => this.hushed.has(x.task_id)) && (notes.length || this.hushedNotes > 0)) {
      void this.q?.interrupt().catch(() => {});
      this.idle = [];
      this.hushedNotes = 0;
      this.draining = m.type !== "result";
      return;
    }
    const offer = this.o.wake;
    // Nobody to show it to (a reviewer's one-off read): it stays for the next turn.
    if (!offer) return;
    const w = { pending: true };
    this.waking = w;
    offer({
      why: notes.length ? `${notes.length === 1 ? "a background task" : `${notes.length} background tasks`} finished` : undefined,
      pending: () => w.pending,
      run: (sink, signal) => {
        if (!w.pending) return Promise.resolve();
        return this.drive(sink, signal, true, () => {});
      },
      cancel: () => {
        if (!w.pending) return;
        w.pending = false;
        this.waking = null;
        const ended = this.idle.some((x) => x.type === "result");
        this.idle = [];
        this.draining = !ended;
        if (!ended) void this.q?.interrupt().catch(() => {});
      },
    });
  }

  private onMessage(m: SDKMessage) {
    this.track(m);
    const sink = this.sink;
    if (!sink) return this.whileIdle(m);
    if (m.type === "system" && m.subtype === "init") {
      sink.session(m.session_id);
      // A query started again (Claude Code stopped between turns) goes on from this session, not the one it opened with.
      this.o.resume = m.session_id;
      this.o.fork = false;
      return;
    }
    // What a local slash command (/usage, /context) prints: no model writes it, so it never streams.
    if (m.type === "system" && m.subtype === "local_command_output") {
      sink.text(m.content, m.uuid);
      return;
    }
    // The plan ran out: Claude Code says so with a rejected rate limit, and when it resets.
    if (m.type === "rate_limit_event") {
      const out = blocked(m.rate_limit_info);
      if (out) {
        this.limited = true;
        sink.limited(out.message, out.until);
      }
      return;
    }
    if (m.type === "system" && m.subtype === "commands_changed") {
      this.commands = m.commands;
      return;
    }
    if (m.type === "system") return this.onSystem(m, sink);
    // A subagent's own stream and steps stay inside its Task row; they still show it's at work.
    if ((m.type === "stream_event" || m.type === "assistant" || m.type === "user") && m.parent_tool_use_id) {
      sink.heard?.();
      return;
    }
    if (m.type === "stream_event") {
      const ev = m.event;
      if (ev.type === "message_start") {
        this.retryKey = null;
        this.blocks.clear();
        const u = ev.message.usage;
        if (u) {
          this.ctx = { id: ev.message.id, input: promptTokens(u), output: u.output_tokens ?? 0 };
          if (this.ctx.input > 0) sink.usage({ contextTokens: this.ctx.input + this.ctx.output });
        }
      } else if (ev.type === "message_delta" && this.ctx) {
        // Each delta carries the message's running count; fields it leaves out keep their start values.
        const u = ev.usage;
        if (u.input_tokens != null || u.cache_read_input_tokens != null || u.cache_creation_input_tokens != null) {
          const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          if (input > 0) this.ctx.input = input;
        }
        this.ctx.output = u.output_tokens ?? this.ctx.output;
      }
      if (ev.type === "content_block_start") {
        const b = ev.content_block;
        const key = `${m.uuid}:${ev.index}`;
        if (b.type === "text") this.blocks.set(ev.index, { kind: "text", key });
        else if (b.type === "thinking") this.blocks.set(ev.index, { kind: "thinking", key });
        // A plan is written into the call's input, which can take a while: the timeline says it's being written meanwhile.
        else if (b.type === "tool_use" && b.name === "ExitPlanMode") sink.tool({ key: b.id, tool: b.name, toolKind: kindOf(b.name), title: "Write the plan", status: "running" });
      } else if (ev.type === "content_block_delta") {
        const blk = this.blocks.get(ev.index);
        if (!blk) return;
        if (ev.delta.type === "text_delta") sink.text(ev.delta.text, blk.key);
        else if (ev.delta.type === "thinking_delta") sink.reasoning(ev.delta.thinking, blk.key);
      }
      return;
    }
    if (m.type === "assistant") {
      this.retryKey = null;
      // A blocked answer repeats the rate limit's details, its reset time among them, which a rate_limit_event
      // only says once (T3 Code: ClaudeAdapterV2.ts, isClaudeBlockedAssistantRateLimit).
      if (m.error === "rate_limit") {
        const out = blocked(field(field(m, "api_error_params"), "rate_limit_info") as RateInfo | undefined);
        if (out) {
          this.limited = true;
          sink.limited(out.message, out.until);
        }
      }
      if (m.error === "authentication_failed") this.authFailure = signedOut(this.o.env.CLAUDE_CONFIG_DIR);
      // Without a stream (or a stream that started with no counts), the message's own usage says it. Claude Code's
      // "<synthetic>" notices report none.
      const u = m.message.usage;
      if (u && m.message.model !== "<synthetic>" && (this.ctx?.id !== m.message.id || this.ctx.input <= 0) && promptTokens(u) > 0)
        this.ctx = { id: m.message.id, input: promptTokens(u), output: Math.max(u.output_tokens ?? 0, this.ctx?.id === m.message.id ? this.ctx.output : 0) };
      for (const b of m.message.content) {
        if (b.type !== "tool_use") continue;
        const input = (b.input ?? {}) as Record<string, unknown>;
        this.tools.set(b.id, { name: b.name, input });
        if (b.name === "TodoWrite" && Array.isArray(input.todos)) {
          sink.plan(
            (input.todos as { content?: string; status?: string }[]).map((t) => ({
              title: String(t.content ?? ""),
              status: t.status === "completed" ? "completed" : t.status === "in_progress" ? "in_progress" : "pending",
            })),
          );
        }
        const { title, path } = titleOf(b.name, input, this.o.cwd);
        sink.tool({ key: b.id, tool: b.name, toolKind: kindOf(b.name), title, path, input: JSON.stringify(input, null, 2), status: "running" });
      }
      return;
    }
    if (m.type === "user") {
      const content = m.message.content;
      if (!Array.isArray(content)) return;
      const results = content.filter((b) => typeof b === "object" && b.type === "tool_result");
      for (const b of results) {
        if (typeof b !== "object" || b.type !== "tool_result") continue;
        const call = this.tools.get(b.tool_use_id);
        if (!call) continue;
        // Its output is all here now: the file it was read from as it ran is done with.
        this.untail(b.tool_use_id);
        const out = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n") : "";
        const { title, path } = titleOf(call.name, call.input, this.o.cwd);
        sink.tool({ key: b.tool_use_id, tool: call.name, toolKind: kindOf(call.name), title, path, output: out.slice(0, 20000), status: b.is_error ? "failed" : "done" });
        // The task list changed: the plan shows it as it is now. A lone result carries its structured form.
        if (TASK_TOOLS.has(call.name) && !b.is_error) {
          const next = applyTaskTool(this.taskList, call.name, call.input, (results.length === 1 ? m.tool_use_result : undefined) ?? out);
          if (next) {
            this.taskList = next;
            sink.plan([...next.values()]);
          }
        }
      }
      return;
    }
    if (m.type === "result") {
      const models = Object.values(m.modelUsage ?? {});
      const window = models.reduce((w, u) => Math.max(w, u.contextWindow ?? 0), 0);
      // The query's totals (subagents included) less what its last result said is this turn's. A resumed
      // query's first totals also hold the transcript's earlier turns, and a /clear starts them over: then
      // the main thread's own use this turn is what there is to go on, without a cost.
      const now = {
        input: models.reduce((s, u) => s + u.inputTokens + u.cacheCreationInputTokens, 0),
        output: models.reduce((s, u) => s + u.outputTokens, 0),
        cache: models.reduce((s, u) => s + u.cacheReadInputTokens, 0),
        cost: m.total_cost_usd ?? 0,
      };
      const base = this.seen;
      this.seen = now;
      const grew = base && now.input >= base.input && now.output >= base.output && now.cache >= base.cache && now.cost >= base.cost;
      sink.usage({
        ...(grew
          ? { inputTokens: now.input - base.input, outputTokens: now.output - base.output, cacheReadTokens: now.cache - base.cache, costUsd: now.cost - base.cost }
          : { inputTokens: m.usage.input_tokens + (m.usage.cache_creation_input_tokens ?? 0), outputTokens: m.usage.output_tokens, cacheReadTokens: m.usage.cache_read_input_tokens ?? 0 }),
        contextTokens: this.ctx ? this.ctx.input + this.ctx.output : undefined,
        contextWindow: window || undefined,
      });
      // Which messages this result answers. One that answers none of this turn's is a late one (from a turn that
      // was stopped and let go of before Claude Code said it had ended), or the end of a turn Claude Code began by
      // itself about background work, which echoes none and says where it came from (T3 Code: ClaudeAdapterV2.ts,
      // isClaudeResultForOtherTurn). Neither ends your turn. In a turn Claude Code began itself, any result does.
      const echoed = m.user_message_uuids ?? (m.user_message_uuid ? [m.user_message_uuid] : []);
      const ours = echoed.some((id) => this.sent.has(id));
      if (ours) this.echoes = true;
      const other = echoed.length ? !ours : !this.sent.size || m.origin?.kind === "task-notification" || (this.echoes && m.origin !== undefined && m.origin.kind !== "human");
      if (other && !this.woke) return;
      for (const id of echoed) this.sent.delete(id);
      // A failure after the sign-in stopped working says what to do about it.
      const failed = this.signal?.aborted ? undefined : resultError(m);
      const said = failed && this.authFailure ? this.authFailure : failed;
      // A limit was already said, with its reset time; the result's own words would repeat it.
      if (said && !this.limited) {
        if (/usage limit|rate limit|limit reached|hit your limit/i.test(said)) sink.limited(said);
        else sink.error(said);
      }
      this.limited = false;
      this.authFailure = undefined;
      // A steer runs as a turn of its own after this one (sent after the last step, or one that cut in now and
      // cut this short), with its own result: the turn waits for that.
      const cut = m.terminal_reason === "aborted_streaming" || m.terminal_reason === "aborted_tools";
      if (this.sent.size && ((m.queued_turn_count ?? 0) > 0 || cut) && !this.signal?.aborted) return;
      this.finish?.();
    }
  }

  /** Claude Code's system messages in a turn: tasks, retries, compaction, notices. */
  private onSystem(m: Extract<SDKMessage, { type: "system" }>, sink: TurnSink) {
    switch (m.subtype) {
      case "task_started":
        // A command's output only comes with its result: read it as it's written instead.
        if (m.task_type === "local_bash" && m.is_backgrounded !== true && m.tool_use_id && this.tools.has(m.tool_use_id)) this.tail(m.task_id, m.tool_use_id, m.session_id);
        sink.heard?.();
        return;
      case "task_progress":
        sink.heard?.();
        return;
      case "task_notification": {
        sink.heard?.();
        // A subagent's or command's own row says how it went; work left in the background has no row any more.
        const t = this.tasks.get(m.task_id) ?? this.ended.get(m.task_id);
        const row = m.tool_use_id && this.tools.has(m.tool_use_id) && !t?.background;
        if (row || m.ambient || m.skip_transcript) return;
        const how = m.status === "completed" ? "finished" : m.status === "failed" ? "failed" : "was stopped";
        sink.notice(m.summary?.trim() || `A background task ${how}${t?.description ? `: ${t.description}` : ""}.`);
        return;
      }
      case "api_retry":
        // One line per run of retries, counting up; any word from the model ends the run.
        this.retryKey ??= randomUUID();
        sink.notice(retryText(m.error, m.attempt, m.max_retries), this.retryKey);
        sink.heard?.();
        return;
      case "status":
        if (m.status === "compacting") {
          this.compactKey ??= randomUUID();
          sink.notice("Compacting the conversation…", this.compactKey);
          sink.heard?.();
        } else if (m.compact_result === "failed" && this.compactKey) {
          sink.notice(`Compacting didn't work${m.compact_error ? `: ${m.compact_error}` : "."}`, this.compactKey);
          this.compactKey = null;
        }
        return;
      case "compact_boundary": {
        const { pre_tokens: pre, post_tokens: post } = m.compact_metadata;
        sink.notice(`Compacted the conversation${pre && post ? `, from ${k(pre)} to ${k(post)} tokens` : pre ? ` (${k(pre)} tokens before)` : ""}.`, this.compactKey ?? undefined);
        this.compactKey = null;
        if (post && post > 0) sink.usage({ contextTokens: post });
        // What it compacted away no longer counts against the images and PDFs a conversation may hold.
        if (!m.compact_metadata.preserved_segment && !m.compact_metadata.preserved_messages) this.budget = { bytes: 0, pages: 0 };
        return;
      }
      case "informational":
        if (m.level !== "info") sink.notice(m.content);
        return;
      case "model_refusal_fallback":
      case "model_refusal_no_fallback":
        sink.notice(m.content);
        return;
    }
  }

  /**
    Reads a running command's output from the file Claude Code writes it to, a few times a second:
    the SDK holds a command's output until its result (T3 Code: ClaudeTaskOutputTail.ts). The file's
    place is Claude Code's own and may move; then the row just waits for the result.
  */
  private tail(taskId: string, toolUseId: string, sessionId: string) {
    const uid = process.getuid?.();
    if (uid === undefined || this.tails.has(toolUseId)) return;
    const root = join(this.o.env.CLAUDE_CODE_TMPDIR?.trim() || "/tmp", `claude-${uid}`);
    const t: { timer?: NodeJS.Timeout; file?: string; offset: number; text: string; tries: number } = { offset: 0, text: "", tries: 0 };
    this.tails.set(toolUseId, t);
    const tick = () => {
      const call = this.tools.get(toolUseId);
      const sink = this.sink;
      if (!call || !sink || this.tails.get(toolUseId) !== t) return this.untail(toolUseId);
      try {
        if (!t.file) {
          for (const project of readdirSync(root)) {
            const file = join(root, project, sessionId, "tasks", `${taskId}.output`);
            if (existsSync(file)) t.file = file;
          }
          // Never written: give up after ten seconds.
          if (!t.file && ++t.tries >= 40) return this.untail(toolUseId);
        }
        const size = t.file ? statSync(t.file).size : 0;
        if (t.file && size > t.offset) {
          // Only the tail shows: a fast writer is skipped ahead of.
          const from = Math.max(t.offset, size - 256 * 1024);
          const buf = Buffer.alloc(size - from);
          const fd = openSync(t.file, "r");
          try {
            readSync(fd, buf, 0, buf.length, from);
          } finally {
            closeSync(fd);
          }
          t.offset = size;
          t.text = (t.text + buf.toString("utf8")).slice(-20000);
          const { title, path } = titleOf(call.name, call.input, this.o.cwd);
          sink.tool({ key: toolUseId, tool: call.name, toolKind: kindOf(call.name), title, path, output: t.text, status: "running" });
          sink.heard?.();
        }
      } catch {
        // Gone, or not there yet: try again next time.
      }
      t.timer = setTimeout(tick, 250);
    };
    t.timer = setTimeout(tick, 250);
  }
  private untail(toolUseId: string) {
    clearTimeout(this.tails.get(toolUseId)?.timer);
    this.tails.delete(toolUseId);
  }

  /** Your message as Claude Code reads it: its images and PDFs as they are, and ultrathink, which every turn carries. */
  private message(text: string, files: string[] = []) {
    return withFiles(this.o.effort === "ultrathink" ? `${text}\n\nultrathink` : text, files, this.budget);
  }

  async turn(text: string, sink: TurnSink, signal: AbortSignal, files: string[] = []) {
    if (!this.q && this.o.resume) await this.resume(signal);
    return this.drive(sink, signal, false, () => {
      this.sent = new Set([this.inbox.push(this.message(text, files))]);
    });
  }

  /**
    Opens Claude Code on the session it was to resume, before your message goes. One it can't find
    (its transcript is gone) ends the process at once, and every later message would fail the same
    way: this opens a new session instead and says so, so the runtime sends the conversation so far
    (T3 Code: ProviderTurnStartService.ts, its resume fallback).
  */
  private async resume(signal: AbortSignal) {
    this.start();
    const q = this.q!;
    const stopped = new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }));
    try {
      await Promise.race([q.initializationResult(), stopped]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!/no conversation found/i.test(message)) throw e;
      const lost = this.o.resume;
      this.retired.add(q);
      if (this.q === q) this.q = null;
      this.idle = [];
      this.o.resume = undefined;
      this.o.fork = false;
      this.inbox = new Inbox();
      throw new ResumeFailed(`Claude Code couldn't find its session ${lost ?? ""} any more.`);
    }
  }

  /**
    Runs one turn into `sink`: yours (`begin` sends your message), or one Claude Code began by
    itself (`woke`), whose messages so far were held. Anything held from while no turn ran comes
    first: it happened before this turn.
  */
  private async drive(sink: TurnSink, signal: AbortSignal, woke: boolean, begin: () => void) {
    this.sink = sink;
    this.signal = signal;
    this.woke = woke;
    this.draining = false;
    // Only this turn's messages are waited on; a steer an earlier turn never answered isn't.
    this.sent = new Set();
    // Your turn takes in what Claude Code had to say about work you stopped.
    if (!woke) this.hushedNotes = 0;
    if (!this.q) this.start();
    const done = new Promise<void>((resolve, reject) => {
      this.finish = resolve;
      this.fail = reject;
    });
    let late: NodeJS.Timeout | undefined;
    const stop = () => {
      void this.q?.interrupt().catch(() => {});
      // Stop reaches work it left running in the background too (T3 Code: BackgroundWorkStop.integration.test.ts).
      this.stopTasks();
      // An interrupt ends with a result message; if it never comes, let go after a moment, and drop what's left of it.
      late = setTimeout(() => {
        this.draining = true;
        this.finish?.();
      }, 4000);
    };
    signal.addEventListener("abort", stop, { once: true });
    // Stopped before it began: nothing of yours went, so nothing is waited for; a turn Claude Code began is interrupted.
    if (signal.aborted) {
      stop();
      if (!woke) this.finish?.();
    }
    // A turn Claude Code began by itself, offered and not run yet, is this turn's now.
    if (this.waking) this.waking.pending = false;
    this.waking = null;
    const held = this.idle;
    this.idle = [];
    try {
      for (const m of held) this.onMessage(m);
      // Stopped before it began: nothing more is asked of Claude Code.
      if (!signal.aborted) begin();
      await done;
    } finally {
      // Not left to end the next turn, should that start within the moment.
      clearTimeout(late);
      signal.removeEventListener("abort", stop);
      for (const id of [...this.tails.keys()]) this.untail(id);
      this.sink = null;
      this.signal = null;
      this.woke = false;
      this.finish = this.fail = null;
    }
  }

  /** Stops every task Claude Code still runs, in the background or not; their notifications then wake nothing. */
  private stopTasks() {
    const q = this.q;
    if (!q) return;
    for (const id of this.tasks.keys()) {
      this.hushed.add(id);
      void q.stopTask(id).catch(() => {});
    }
  }

  /**
    A steer goes in now, not after the step that's running (T3 Code: ClaudeAdapterV2.ts, steerTurn).
    Priority "now" cuts the model's current step short: a command still running in the foreground
    (a build, the tests) is stopped and Claude reads your message at once, where "next" waited for it,
    which could be many minutes. Running subagents are moved to the background first, waiting up to
    five seconds, so their work goes on and reports back instead of being lost. A turn that ended
    meanwhile takes no steer: the message goes as the next one instead.
  */
  steer(text: string, files: string[] = []): boolean | Promise<boolean> {
    const q = this.q;
    const sink = this.sink;
    if (!q || !sink) return false;
    const agents = [...this.tasks.values()].filter((t) => !t.background && t.toolUseId && t.type !== "local_bash").map((t) => t.toolUseId!);
    const send = () => {
      if (this.q !== q || this.sink !== sink) return false;
      this.sent.add(this.inbox.push(this.message(text, files), "now"));
      return true;
    };
    if (!agents.length) return send();
    const moved = Promise.allSettled(agents.map((id) => q.backgroundTasks(id)));
    let timer: NodeJS.Timeout | undefined;
    return Promise.race([moved, new Promise((r) => (timer = setTimeout(r, 5000)))]).then(() => (clearTimeout(timer), send()));
  }

  async update(o: Pick<OpenOptions, "model" | "effort" | "access">) {
    if (!this.q) {
      Object.assign(this.o, o);
      this.access = o.access;
      return true;
    }
    // Effort is fixed for a running query; reopen with resume for that.
    if (o.effort !== this.o.effort) return false;
    if (o.model !== this.o.model) await this.q.setModel(o.model || undefined);
    if (o.access !== this.access) await this.q.setPermissionMode(MODE[o.access]);
    Object.assign(this.o, o);
    this.access = o.access;
    return true;
  }

  /** Claude Code's own /context, from the last answer's usage and its estimates (no token-count calls), source by source. */
  async context(): Promise<ContextUse | null> {
    if (!this.q) return null;
    const u = await this.q.getContextUsage({ detail: "summary" });
    const parts = u.categories.filter((c) => c.tokens > 0).map((c): ContextPart => ({ name: c.name, tokens: c.tokens, kind: c.kind ?? (c.isDeferred ? "deferred" : "used") }));
    const deferred = parts.filter((p) => p.kind === "deferred").reduce((n, p) => n + p.tokens, 0);
    return { used: u.totalTokens, max: u.maxTokens, parts, sources: contextSources(u), compactAt: u.autoCompactThreshold, autoCompact: u.isAutoCompactEnabled, deferred: deferred || undefined };
  }

  close() {
    this.inbox.end();
    this.q?.return?.(undefined);
    this.q = null;
    // A turn Claude Code began by itself and nobody ran goes with the process.
    if (this.waking) this.waking.pending = false;
    this.waking = null;
    this.idle = [];
    for (const id of [...this.tails.keys()]) this.untail(id);
    void this.signal;
  }
}

export const claude: Provider = {
  id: "claude",
  async detect(env): Promise<ProviderInfo> {
    const path = which("claude", env);
    const base = { id: "claude" as const, label: "Claude Code", adapter: true, login: "claude auth login", models: FALLBACK, modelsFrom: "builtin" as const, supports: { approvals: true, resume: true, effort: true, plan: true } };
    if (!path) return { ...base, available: false, detail: "Claude Code isn't installed.", install: "npm install -g @anthropic-ai/claude-code, then claude auth login" };
    const [version, status] = await Promise.all([versionOf(path, env), run(path, ["auth", "status"], { env, timeout: 15000 })]);
    // Claude Code's own answer; Liner Code never sees the sign-in itself. An older claude has no `auth status`.
    let signedIn: boolean | undefined;
    try {
      signedIn = Boolean((JSON.parse(status.stdout) as { loggedIn?: boolean }).loggedIn) || Boolean(env.ANTHROPIC_API_KEY);
    } catch {}
    return { ...base, available: true, version, signedIn, detail: signedIn === false ? "Not signed in: run claude auth login, or add an Anthropic key" : "Uses your Claude Code sign-in" };
  },
  models: listModels,
  async commands(env, cwd) {
    const skills = skillsIn([join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "skills"), join(cwd, ".claude", "skills")]);
    const names = new Set(skills.map((x) => x.name));
    const path = which("claude", env);
    if (!path) return { commands: [], skills };
    const abort = new AbortController();
    const idle = async function* (): AsyncGenerator<SDKUserMessage> {
      await new Promise((r) => abort.signal.addEventListener("abort", r));
    };
    const q = query({ prompt: idle(), options: { cwd, pathToClaudeCodeExecutable: path, env: { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: `liner-code/${VERSION}` }, settingSources: ["user", "project", "local"], abortController: abort } });
    try {
      const list = await Promise.race([q.supportedCommands(), new Promise<never>((_, no) => setTimeout(() => no(new Error("Claude Code didn't list its commands in time.")), 30000))]);
      const commands = list.filter((c) => !names.has(c.name)).map((c) => ({ name: c.name, description: c.description, hint: c.argumentHint || undefined, source: "tool" as const }));
      // Plugin skills show as commands named "plugin:skill"; they're skills too.
      for (const c of list) if (c.name.includes(":") && !names.has(c.name) && /skill/i.test(c.description)) skills.push({ name: c.name, description: c.description });
      return { commands, skills };
    } finally {
      abort.abort();
    }
  },
  async limits(env, scratch) {
    type Win = { utilization: number | null; resets_at: string | null } | null | undefined;
    const u = await probe(env, scratch, (q) => (q as unknown as { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (o: { skipBehaviors: boolean }) => Promise<{ subscription_type: string | null; rate_limits_available: boolean; rate_limits: Record<string, Win> | null }> }).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?.({ skipBehaviors: true }) ?? Promise.resolve(null));
    if (!u) return null;
    if (!u.rate_limits_available || !u.rate_limits) return { plan: u.subscription_type ?? undefined, windows: [], detail: "No plan limits: this sign-in bills by the token." };
    const names: Record<string, string> = { five_hour: "5-hour window", seven_day: "Weekly", seven_day_opus: "Weekly, Opus", seven_day_sonnet: "Weekly, Sonnet", seven_day_oauth_apps: "Weekly, apps" };
    // The call also returns keys that aren't windows (spend, breakdowns, codenamed experiments): only the
    // five-hour and weekly windows with a number are a plan's limits.
    const windows = Object.entries(u.rate_limits).flatMap(([k, w]) => (w && typeof w.utilization === "number" && /^(five_hour|seven_day)/.test(k) ? [{ label: names[k] ?? k.replace(/_/g, " "), usedPercent: w.utilization, resetsAt: w.resets_at ? Date.parse(w.resets_at) : undefined }] : []));
    return { plan: u.subscription_type ?? undefined, windows };
  },
  open: (o) => new ClaudeSession(o),
};
