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
           guard is on and what your own Claude settings said to ask about, which still come back to you.
  AskUserQuestion and ExitPlanMode are caught in canUseTool and shown as cards: a plan from plan
  mode waits in its turn for your answer.

  A side chat doesn't run in plan mode, which makes every turn end in a plan or a question, even
  "hello": it runs in the default mode with the editing tools taken away, and answers directly.
*/
import { getSessionMessages, query, type ElicitationRequest, type ElicitationResult, type McpServerConfig, type Options, type PermissionMode, type Query, type SDKControlGetContextUsageResponse, type SDKMessage, type SDKPermissionRuleEntry, type SDKResultMessage, type SDKUserMessage, type SessionStore, type SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { stripVTControlCharacters } from "node:util";
import type { Access, ContextPart, ContextSource, ContextUse, LimitWindow, ModelInfo, PlanEntry, ProviderInfo, Question, ToolKind } from "../../../contracts/src/index.ts";
import { base64Size, imageKind, imageType, isPdf, pdfPages, readUpTo } from "./attachments.ts";
import { outside, run, sdkPath, versionOf, which } from "../exec.ts";
import { VERSION } from "../version.ts";
import { linerTitle } from "../agent-tools.ts";
import { commandRisk, isDestructive, ruleFor } from "../risk.ts";
import { subagentName } from "../review.ts";
import { effortOf, skillsIn, ULTRACODE, ULTRATHINK } from "./models.ts";
import { LINER_WAIT_SEC, ResumeFailed, type OpenOptions, type Provider, type ProviderSession, type ToolUpdate, type TurnSink } from "./types.ts";
import type { Connection } from "../addons.ts";

/** The SDK's query() and transcript reader, held here so tests can stand in a Claude Code of their own. */
export const sdk = { query, getSessionMessages };

/**
  How long, in milliseconds: a resumed Claude Code has to say it's up, the connections have to be
  handed over before a turn goes without them, a stopped turn has to say it ended, and Claude Code
  has to list your ask rules while a step waits on them.
*/
export const waits = { open: 90_000, link: 30_000, stop: 4_000, rules: 3_000 };

/** Only until Claude Code answers: the engine asks it for its real list as it starts. */
const FALLBACK: ModelInfo[] = [
  { id: "claude-opus-5-5", label: "Opus 5.5", description: "Best for everyday, complex tasks", isDefault: true },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", description: "Efficient for routine tasks" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", description: "Fastest for quick answers" },
].map((m) => ({ ...m, efforts: ["low", "medium", "high"].map((e) => effortOf(e)), defaultEffort: "medium" }));

const LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);
/** What the SDK takes for one of our effort names: ultracode is extra high plus workflows; ultrathink is a word in the prompt. */
const sdkEffort = (e: string) => (e === "ultracode" ? "xhigh" : LEVELS.has(e) ? (e as "low") : undefined);

/** Liner Code's own server and the connections you added, as Claude Code takes MCP servers. */
export function claudeMcp(o: Pick<OpenOptions, "mcp">, connections: Connection[] = []): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  // Its own wait, in ms: Claude Code waits on a call for good unless MCP_TOOL_TIMEOUT says otherwise, and a low one in your
  // shell would cut a sidekick's brief short. Progress notifications don't extend it.
  if (o.mcp) out.liner = { type: "stdio", command: o.mcp.command, args: o.mcp.args, env: o.mcp.env, timeout: LINER_WAIT_SEC * 1000 };
  // `liner` is ours, and its tools go without a card: a connection of that name is any other server.
  for (const c of connections) out[c.name === "liner" ? "liner-addon" : c.name] = c.http ? { type: "http", url: c.http.url, headers: c.http.headers } : { type: "stdio", command: c.stdio!.command, args: c.stdio!.args, env: c.stdio!.env };
  return out;
}

/**
  Is this Liner Code's own server? Ours is handed over at run time, so it's "dynamic"; an older CLI
  says nothing. Any other source is a config file, a plugin or an agent's own, whatever it's called,
  and the SDK says to treat one it doesn't know as configured ("key trust decisions on source").
*/
const handedOver = (source?: string) => !source || source === "dynamic";

const limitName = (t?: string) => (t === "five_hour" ? "5-hour limit" : t === "seven_day" ? "weekly limit" : t === "seven_day_opus" ? "weekly Opus limit" : t === "seven_day_sonnet" ? "weekly Sonnet limit" : t === "overage" ? "extra usage" : "usage limit");

type RateInfo = { status?: string; rateLimitType?: unknown; resetsAt?: unknown; utilization?: unknown; overageStatus?: string; isUsingOverage?: boolean; overageInUse?: boolean };
/** The plan's windows by Claude Code's names for them. */
const WINDOWS: Record<string, string> = { five_hour: "5-hour window", seven_day: "Weekly", seven_day_opus: "Weekly, Opus", seven_day_sonnet: "Weekly, Sonnet", seven_day_oauth_apps: "Weekly, apps" };
const windowKind = (k: string) => (k === "five_hour" ? { kind: "session" as const, minutes: 300 } : { kind: "weekly" as const, minutes: 10080 });
/** A window a turn's rate limit event reports (its utilization from 0 to 1), for the composer's limit bars (T3 Code reads them the same way). */
function windowOf(info: RateInfo | undefined): LimitWindow | null {
  const k = info?.rateLimitType;
  if (typeof info?.utilization !== "number" || typeof k !== "string" || !WINDOWS[k] || k === "seven_day_oauth_apps") return null;
  const at = typeof info.resetsAt === "number" && info.resetsAt > 0 ? (info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt) : undefined;
  return { label: WINDOWS[k], usedPercent: Math.max(0, Math.min(100, info.utilization * 100)), resetsAt: at, ...windowKind(k) };
}
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

/** When a gateway's 503 around a rate limit says it lifts, if this result is one (T3 Code: ClaudeAdapterV2.ts, gatewayCooldownResetAt). */
function gatewayCooldown(m: SDKResultMessage): number | undefined {
  if (m.subtype !== "success" || !m.is_error || m.terminal_reason !== "api_error" || m.api_error_status !== 503) return undefined;
  const c = /^API Error: 503 \[[^\]\r\n]+\] \[429\]: \{"type":"error","error":\{"type":"rate_limit_error",[^\r\n]*\} \(reset after (?:(\d+)h ?)?(?:(\d+)m ?)?(?:(\d+)s)?\)/.exec(m.result);
  const seconds = c ? Number(c[1] ?? 0) * 3600 + Number(c[2] ?? 0) * 60 + Number(c[3] ?? 0) : 0;
  return seconds > 0 ? Date.now() + seconds * 1000 : undefined;
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
      const owner = word(t, "owner");
      if (id && title && status) next.set(id, { title, status, ...(owner ? { owner } : {}) });
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
  // Who took it on: an agent's name, the way Claude Code's teams hand tasks out.
  const owner = word(input, "owner") ?? task.owner;
  return title === task.title && status === task.status && owner === task.owner ? undefined : new Map(tasks).set(id, { title, status, ...(owner ? { owner } : {}) });
}

/** Claude Code's folder for this session's account: its own CLAUDE_CONFIG_DIR, or the usual one. */
function configDir(env: NodeJS.ProcessEnv, cwd: string) {
  const config = env.CLAUDE_CONFIG_DIR?.trim();
  return config ? resolve(cwd, config) : join(homedir(), ".claude");
}

/**
  Where the SDK reads a session's transcript from. By itself it goes by the engine's own
  CLAUDE_CONFIG_DIR, which isn't an extra account's, and would find nothing: handed this it still
  makes the conversation out of the lines, and only where they come from is ours. Changing
  process.env for it would reach every session running (T3 Code starts a worker process with the
  session's env for this: claudeHistoryWorker.ts).
*/
function transcripts(env: NodeJS.ProcessEnv, cwd: string): SessionStore {
  return {
    append: async () => {},
    load: async ({ projectKey, sessionId }) => {
      const text = await readFile(join(configDir(env, cwd), "projects", projectKey, `${sessionId}.jsonl`), "utf8").catch(() => "");
      return text.split("\n").flatMap((line) => {
        try {
          return line.trim() ? [JSON.parse(line)] : [];
        } catch {
          // One half written: the rest still say.
          return [];
        }
      });
    },
  };
}

/**
  The task list Claude Code keeps on disk for a session, or undefined when there's none to read
  (T3 Code: ClaudeAdapterV2.ts, readClaudeTaskList). It outlives a restart, which ours doesn't.
*/
export function storedTasks(env: NodeJS.ProcessEnv, cwd: string, session: string): TaskList | undefined {
  const dir = join(configDir(env, cwd), "tasks", (env.CLAUDE_CODE_TASK_LIST_ID?.trim() || session).replace(/[^a-zA-Z0-9_-]/g, "-"));
  try {
    const out: TaskList = new Map();
    for (const name of readdirSync(dir).filter((n) => /^\d+\.json$/.test(n)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
      try {
        const t: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"));
        const id = word(t, "id");
        const title = word(t, "subject");
        const status = taskStatus(field(t, "status"));
        const owner = word(t, "owner");
        if (id && title && status && !field(field(t, "metadata"), "_internal")) out.set(id, { title, status, ...(owner ? { owner } : {}) });
      } catch {
        // One half written: the rest still say.
      }
    }
    return out;
  } catch {
    return undefined;
  }
}

/** Claude reads at most this much of images and documents in a conversation (T3 Code: ClaudeAdapterV2.ts, its attachment budget). */
const MAX_BYTES = 28 * 1024 * 1024;
const MAX_PAGES = 100;
type Content = Exclude<Extract<SDKUserMessage["message"], { role: "user" }>["content"], string>;

/**
  Your message with its images and PDFs as content blocks, so Claude sees them as they are
  (T3 Code: ClaudeAdapterV2.ts, makeClaudeUserMessageWithAttachments). They count against what a
  conversation may hold: a file past it, an image over 5 MB, or a PDF whose pages can't be counted
  goes by its path alone, which the text names either way. An image goes by what its bytes are: the
  API refuses one that isn't what it's labelled, on this turn and on every turn after.
*/
export function withFiles(text: string, files: string[], budget: { bytes: number; pages: number }): string | Content {
  const blocks: Content = [];
  for (const path of files) {
    const type = imageType(path);
    if (type) {
      const bytes = readUpTo(path, 5 * 1024 * 1024);
      const kind = bytes ? imageKind(bytes) : undefined;
      if (!bytes || !kind || budget.bytes + base64Size(bytes.length) > MAX_BYTES) continue;
      budget.bytes += base64Size(bytes.length);
      blocks.push({ type: "image", source: { type: "base64", media_type: kind as "image/png", data: bytes.toString("base64") } });
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

/** What a transcript's messages already hold of images and PDFs, as the budget above counts them. */
function heldFiles(messages: { message: unknown }[]) {
  const held = { bytes: 0, pages: 0 };
  for (const { message } of messages) {
    const content = field(message, "content");
    for (const b of Array.isArray(content) ? (content as unknown[]) : []) {
      const data = field(field(b, "source"), "data");
      const type = field(b, "type");
      if (typeof data !== "string" || (type !== "image" && type !== "document")) continue;
      held.bytes += data.length + 128;
      if (type === "document") held.pages += pdfPages(Buffer.from(data, "base64")) ?? 0;
    }
  }
  return held;
}

/**
  An MCP server's form as questions, with how to read each answer back. The card offers choices and
  no box to type in, so a form with a required field of any other kind can't be shown: null.
*/
function formOf(schema: unknown, server: string): { key: string; question: Question; value: (label: string) => unknown }[] | null {
  const properties = field(schema, "properties");
  const list = field(schema, "required");
  const required = Array.isArray(list) ? (list as unknown[]) : [];
  const out: { key: string; question: Question; value: (label: string) => unknown }[] = [];
  for (const [key, p] of Object.entries(typeof properties === "object" && properties !== null ? properties : {})) {
    const said = field(p, "enum");
    const titled = field(p, "oneOf");
    const pairs: [string, unknown][] | null =
      field(p, "type") === "boolean"
        ? [["Yes", true], ["No", false]]
        : Array.isArray(said)
          ? said.map((v) => [String(v), v])
          : Array.isArray(titled)
            ? titled.map((v) => [word(v, "title") ?? String(field(v, "const")), field(v, "const")])
            : null;
    if (!pairs) {
      if (required.includes(key)) return null;
      continue;
    }
    const byLabel = new Map(pairs);
    out.push({ key, question: { question: word(p, "title") ?? word(p, "description") ?? key, header: server, options: pairs.map(([label]) => ({ label })) }, value: (label) => byLabel.get(label) });
  }
  return out;
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
  const q = query({ prompt: idle(), options: { cwd: scratch, pathToClaudeCodeExecutable: sdkPath(path), env: { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: `liner-code/${VERSION}` }, settingSources: ["user"], abortController: abort } });
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
/**
  The permission mode for an access level. Auto needs Claude Code's safety check, which runs only with Anthropic's own models:
  through another maker's API (noAuto) every call would be refused, so Auto runs as Edits on its own there (acceptEdits,
  with Liner Code's own answers: a routine command goes ahead, the rest ask; risk.ts, routine). The session keeps its
  level; another model gets Auto again.
*/
export const modeOf = (access: Access, noAuto?: boolean): PermissionMode => (access === "auto" && noAuto ? "acceptEdits" : MODE[access]);
/** What Claude Code says when its Auto can't run here: in a notice, or as each refused call's result. */
const NO_AUTO = /Auto mode (?:can't|cannot|is unavailable|isn't available)/i;
/** A side chat reads and answers: editing, and plan mode's way in and out, stay with the session. */
const SIDE_DENIED = ["Edit", "MultiEdit", "Write", "NotebookEdit", "EnterPlanMode", "ExitPlanMode"];
/** Just a model, for an app (plain): every built-in that reaches this Mac, denied by rule as well as left out. */
const PLAIN_DENIED = ["Read", "Glob", "Grep", "LS", "Bash", "Edit", "MultiEdit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Task"];

/** A command near enough as a shell reads it: no quotes or escapes, one space between words. */
const plainCommand = (s: string) => s.replace(/["'\\]/g, "").replace(/\s+/g, " ").trim();

/**
  Does one of your ask rules name this command, anywhere in it? For what Claude Code leaves
  unmatched: a compound command where more than one part asks says only "subcommandResults", and it
  doesn't look inside `bash -c`. Looser than its own matching on purpose (a rule's words in an
  argument count too): a card too many beats a step you asked about going ahead.
*/
export function askRuleNames(rules: string[], tool: string, command: string) {
  const text = plainCommand(command);
  return rules.some((rule) => {
    if (rule === tool) return true;
    if (!rule.startsWith(`${tool}(`) || !rule.endsWith(")")) return false;
    // `npm test:*` and `npm test *` are the words alone, with or without more after; any other * is anything at all.
    const words = plainCommand(rule.slice(tool.length + 1, -1)).replace(/(?::| )\*$/, "").split("*").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`(?:^|[\\s;&|(\`/])${words}(?=$|[\\s;&|)\`])`).test(text);
  });
}

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
  [/^mcp__liner__(?:browser|server)_/, "Browser", "web"],
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
  // Inside the project it reads as git does ("src/a.ts", on Windows too); anywhere else, as given.
  const rel = (p: unknown) => {
    if (typeof p !== "string") return "";
    if (!isAbsolute(p)) return p;
    const r = relative(cwd, p);
    return r && !outside(r) ? r.split(sep).join("/") : p;
  };
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

type TaskEnd = Extract<SDKMessage, { type: "system"; subtype: "task_notification" }>;
type Run = { title: string; path?: string; agent: NonNullable<ToolUpdate["agent"]>; calls: string[]; status: "running" | "done" | "failed"; sink: TurnSink; text?: string; end?: TaskEnd };

/**
  What an agent sent back, without Claude Code's own wrapping around it: the structured result's
  text, or else the text the model reads. Claude Code 2.1.319 starts both with its own tags
  (<tools-used-before-summary>), frames the model's copy as a "[Subagent hand-back]" whose every
  line it indents by two, and ends it with the agent's id and a <usage> block.
*/
export function agentReport(content: unknown, out = "") {
  const structured = Array.isArray(content);
  // The model's copy ends with lines meant for the model alone: the agent's id, how to go on with it, its usage.
  let t = structured ? content.map((c) => word(c, "text") ?? "").join("\n") : out.replace(/\n*<usage>[\s\S]*?<\/usage>\s*$/, "").replace(/\n+agentId:[\s\S]*$/, "");
  // Its own tags around the report: kebab-case, as all of Claude Code's are, so an agent's own markup stays.
  for (let m; (m = /^\s*<([a-z]+(?:-[a-z]+)+)>[\s\S]*?<\/\1>/.exec(t)); ) t = t.slice(m[0].length);
  const frame = /\[Subagent hand-back\][\s\S]*?The report follows:[ \t]*\n?/.exec(t);
  if (frame) t = t.slice(frame.index + frame[0].length).split("\n").map((l) => (l.startsWith("  ") ? l.slice(2) : l)).join("\n");
  return t.trim();
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
  /**
    The agents this session sent off (its Agent and Task calls) that haven't ended, by call: their
    rows' title and what they say of the agent, kept up as it works. `steps` are its own calls, by
    their ids (`calls`). `sink` is the turn that sent it: its row is that turn's, and one in the
    background still ends there, whichever turn runs when it does. `text`: what it last said, its
    report once it ends; `end`: its task's end, when that came before its call returned.
  */
  private runs = new Map<string, Run>();
  /** Main-thread messages whose text came as a stream; one that didn't (Claude Code's non-streaming fallback) is shown whole from its assistant message. */
  private streamed = new Set<string>();
  private streamId: string | null = null;
  /** Whether this turn showed any answer text, so a result whose words never came another way still shows them. */
  private said = false;
  private access: Access;
  /** Auto runs as Edits on its own here: an API endpoint's said so when it opened, or Claude Code said its check can't run. */
  private noAuto: boolean;
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
  /** The model the main thread's answers come from: its context window is the conversation's, not a subagent's. */
  private mainModel: string | null = null;
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
  private tails = new Map<string, { timer?: NodeJS.Timeout; file?: string; offset: number; text: string; tries: number; decoder: StringDecoder }>();
  /** The notice an API retry or a compaction updates in place while it lasts. */
  private retryKey: string | null = null;
  private compactKey: string | null = null;
  /** Why the sign-in failed, said when the turn ends. */
  private authFailure: string | undefined;
  /** The connections being handed to Claude Code, waited on before a turn's message goes so their tools are there for it. */
  private linking: Promise<string[]> | null = null;
  /** The session a transcript was opened on, until what it holds of images and PDFs is counted. */
  private uncounted: string | undefined;
  /** Whether Claude Code's own record of the task list has been read, once per session. */
  private tasksRead = false;
  /** The message a compaction ended on: what's still reported about it is from before. */
  private stale: string | null = null;
  /** Folders your attachments were saved in, outside the project, where reading them would ask. */
  private attached = new Set<string>();
  /** Asks made while a turn Claude Code began waits to run: each gets that turn's sink, or null if it never does. */
  private holds = new Set<(sink: TurnSink | null) => void>();
  /** An effort update() couldn't apply: the next turn calls it again. */
  private owed = false;
  /** What the next turn says about that: nothing runs when update() does, so there's no turn to say it on then. */
  private owedNote: string | null = null;

  constructor(o: OpenOptions) {
    this.o = o;
    this.access = o.access;
    this.noAuto = Boolean(o.noAuto);
    this.path = which("claude", o.env);
    this.uncounted = o.resume;
    for (const dir of o.dirs ?? []) this.attached.add(dir);
  }

  private start() {
    const o = this.o;
    // Claude Code can't start in a folder that's gone, and the SDK takes that for a missing program ("does not match this system's libc").
    if (!existsSync(o.cwd)) throw new Error(`This session's folder isn't there any more: ${o.cwd}`);
    // Just a model, for an app: no built-in tools, no settings (and so no hooks, plugins or servers of yours), none of Liner's, its own short prompt.
    // Read denied too: with no tools at all, Claude Code still reads a file or lists a folder an @path in the prompt names.
    const plain: Partial<Options> = o.plain ? { tools: [], settingSources: [], settings: { permissions: { deny: PLAIN_DENIED } }, mcpServers: undefined, agents: undefined, permissionMode: "default", disallowedTools: ["mcp__*"], systemPrompt: o.soul, thinking: { type: "disabled" } } : {};
    const options: Options = {
      cwd: o.cwd,
      // T3 Code: ClaudeAdapterV2.ts hands its attachments folder over the same way.
      additionalDirectories: o.dirs?.length ? o.dirs : undefined,
      model: o.model || undefined,
      effort: sdkEffort(o.effort),
      // Ultracode: standing multi-agent workflows on top of extra high effort.
      settings: o.effort === "ultracode" ? { ultracode: true } : undefined,
      thinking: { type: "adaptive", display: "summarized" },
      permissionMode: o.side ? "default" : modeOf(this.access, this.noAuto),
      // A sidekick sends no agents of its own: the lead waits on it, and nobody would see theirs. Workflow runs a script of agents
      // (Claude Code 2.1.322 offers it beside Agent), so it goes too.
      disallowedTools: o.side ? SIDE_DENIED : o.sidekick ? ["Task", "Agent", "Workflow"] : undefined,
      includePartialMessages: true,
      agents: o.subagents && Object.keys(o.subagents).length ? o.subagents : undefined,
      resume: o.resume,
      forkSession: o.fork || undefined,
      // A one-off read leaves no transcript to turn up in Bring in.
      persistSession: o.ephemeral ? false : undefined,
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code", append: o.soul || undefined },
      env: { ...o.env, CLAUDE_AGENT_SDK_CLIENT_APP: `liner-code/${VERSION}` },
      permissionPrompts: "host",
      pathToClaudeCodeExecutable: sdkPath(this.path) ?? undefined,
      mcpServers: o.mcp ? claudeMcp(o) : undefined,
      canUseTool: async (name, input, ask) => {
        const { signal, toolUseID, decisionReason, suppressAlwaysAllowRule, mcpServer } = ask;
        const sink = this.sink ?? (await this.wakeSink(signal));
        if (!sink) return { behavior: "deny", message: "The turn has ended." };
        // Just a model has no tools; should one turn up all the same, it's never used.
        if (o.plain) return { behavior: "deny", message: "You have no tools here: answer from what you were given." };
        // Your own ask rule wants a person's answer, whatever would answer for you here (the SDK says so of
        // hosts that approve by themselves; T3 Code: ClaudeAdapterV2.ts, claudeApprovalPresentation).
        const forced = await this.ruleCaught(name, input, ask);
        // Liner Code's own tools are allowed here without a card. Most only reach this session's Browser, the Simulator, its timeline, or read Liner Design's canvas. Those that write (design_frame, design_node with html, design_built) only write inside .liner/designs/ of this folder, on a canvas the person is watching, with a copy kept each turn to go back to; the engine refuses them in a session that only reads (Read only, a side chat: plan mode and Codex's read-only sandbox are how those run), whatever the tool. design_picture, which spends money, asks on its own card.
        if (name.startsWith("mcp__liner__") && !forced && handedOver(mcpServer?.source)) return { behavior: "allow", updatedInput: input };
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
          this.access = "auto";
          void this.q?.setPermissionMode(modeOf("auto", this.noAuto)).catch(() => {});
          // The plan as you left it: you may have edited its steps before approving.
          return { behavior: "allow", updatedInput: { ...input, plan: answer.plan ?? input.plan } };
        }
        // What you attached is yours to read, though it's saved outside the project (T3 Code hands its folder over as an extra directory).
        if (name === "Read" && !forced && this.isAttached(input.file_path)) return { behavior: "allow", updatedInput: input };
        const command = typeof input.command === "string" ? input.command : "";
        // Full access acts, except where the guard says the step can't be undone.
        if (this.access === "full" && !forced && !(this.o.guard && isDestructive(command))) return { behavior: "allow", updatedInput: input };
        const kind = kindOf(name);
        const { title, path } = titleOf(name, input, o.cwd);
        const fields: { label: string; value: string }[] = [];
        if (command) fields.push({ label: "Command", value: command });
        if (path) fields.push({ label: "File", value: path });
        if (typeof input.url === "string") fields.push({ label: "URL", value: input.url });
        if (!fields.length) fields.push({ label: "Input", value: short(JSON.stringify(input), 240) });
        fields.push({ label: "Runs in", value: o.cwd });
        // Why Claude Code asks, which can carry its terminal's colours (T3 Code: ClaudeAdapterV2.ts, claudeApprovalPresentation).
        const reason = stripVTControlCharacters(decisionReason ?? "").trim();
        const answer = await sink.approve(
          {
            key: toolUseID,
            tool: name,
            // A command's own description reads as the ask ("Write the note and commit it"); the command is in its field.
            title: kind === "exec" ? (typeof input.description === "string" && input.description.trim() ? short(input.description.charAt(0).toUpperCase() + input.description.slice(1), 70) : `Run ${short(command, 60)}`) : title,
            description: [typeof input.description === "string" && kind !== "exec" ? input.description : "", reason].filter(Boolean).join("\n\n") || undefined,
            // High, so no Reviewer, Auto or routine answers for you; no rule, so no "don't ask again" does.
            risk: forced ? "high" : kind === "exec" ? commandRisk(command) : kind === "edit" || kind === "write" ? "low" : "medium",
            fields,
            rule: forced || suppressAlwaysAllowRule ? undefined : kind === "exec" ? ruleFor(command) : kind === "edit" || kind === "write" ? "Edit" : name,
            // Its Auto can't run here, so nothing has read this step: Liner Code lets a routine command through at Auto (risk.ts, routine).
            unjudged: Boolean(this.noAuto),
          },
          signal,
        );
        // Refused by the level with no card (Read only): its own sentence, as it is. (answer.level)
        return answer.allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: answer.level && answer.reason ? answer.reason : answer.reason ? `The user said no, and asks instead: ${answer.reason}` : "The user said no to this step." };
      },
      onElicitation: (request, { signal }) => this.elicit(request, signal),
      ...plain,
    };
    this.seen = o.resume ? null : { input: 0, output: 0, cache: 0, cost: 0 };
    this.q = sdk.query({ prompt: this.inbox, options });
    void this.pump(this.q);
    // The connections go over stdin rather than on the command line with `liner`, where any program
    // on this Mac could read their keys: the SDK writes `mcpServers` as --mcp-config (T3 Code:
    // ClaudeAdapterV2.ts hands its servers over with setMcpServers once query() returns, for the same reason).
    if (o.connections?.length && !o.plain) {
      this.linking = this.link(this.q);
      // A resume that fails first never reaches the turn that waits on this.
      this.linking.catch(() => {});
    }
  }

  /**
    Did your own ask rule catch this step? Claude Code says so with `matchedAskRule` when the tool
    made its own ask, and otherwise with a decision reason of type "rule", which the SDK passes on
    but leaves out of its types. Any other type can come with no rule of yours at all (a command it
    can't call safe, a path outside the project), and Full access would then ask about each of
    them, so none counts by itself: a command is read against your rules instead. When Claude Code
    can't list them, only a compound command comes to you, the one answer that can hide a rule.
  */
  private async ruleCaught(name: string, input: Record<string, unknown>, ask: { matchedAskRule?: unknown }) {
    const type = (ask as { decisionReasonType?: string }).decisionReasonType;
    // A hook of yours that says ask is a rule of yours too.
    if (ask.matchedAskRule !== undefined || type === "rule" || type === "hook") return true;
    if (typeof input.command !== "string") return false;
    const rules = await this.askRules();
    return rules ? askRuleNames(rules, name, input.command) : type === "subcommandResults";
  }

  /** Your ask rules as Claude Code holds them now, from every settings file; null when it can't say (one too old to, or that doesn't answer). */
  private async askRules(): Promise<string[] | null> {
    const q = this.q as unknown as { listPermissionRules?: () => Promise<{ state: { rules: SDKPermissionRuleEntry[] } }> } | null;
    let timer: NodeJS.Timeout | undefined;
    try {
      const listed = await Promise.race([q?.listPermissionRules?.(), new Promise<undefined>((r) => (timer = setTimeout(() => r(undefined), waits.rules)))]);
      return listed ? listed.state.rules.flatMap((r) => (r.behavior === "ask" && !r.notInEffect ? [r.rule] : [])) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
    A turn Claude Code began by itself can ask for a tool while the runtime is still setting that
    turn up, which takes a git snapshot: the ask waits for it, and shows on it (T3 Code:
    ClaudeAdapterV2.ts, its wake turns). No sink comes when nothing is about to run: a background
    subagent asking with no turn of yours open. The SDK hands an ask over ahead of the messages
    before it, so the words that begin the turn get a moment to arrive.
  */
  private async wakeSink(signal: AbortSignal): Promise<TurnSink | null> {
    if (!this.waking) await new Promise((r) => setTimeout(r, 50));
    if (this.sink || !this.waking || signal.aborted) return this.sink;
    return new Promise((done) => {
      const give = (sink: TurnSink | null) => {
        this.holds.delete(give);
        signal.removeEventListener("abort", drop);
        done(sink);
      };
      const drop = () => give(null);
      this.holds.add(give);
      signal.addEventListener("abort", drop, { once: true });
    });
  }
  private release(sink: TurnSink | null) {
    for (const give of [...this.holds]) give(sink);
  }

  /**
    An MCP server asks you something in the middle of a tool: choices come as a question card, a
    plain yes as an approval card that only you can answer (T3 Code: ClaudeAdapterV2.ts,
    onElicitationEffect). Anything else (a link to open, a box to fill in) is declined, as no
    handler would. Never null: the SDK reads that as answered elsewhere and leaves the server waiting.
  */
  private async elicit(request: ElicitationRequest, signal: AbortSignal): Promise<ElicitationResult> {
    const form = request.mode === "url" || this.o.plain ? null : formOf(request.requestedSchema, request.displayName ?? request.serverName);
    const sink = form ? (this.sink ?? (await this.wakeSink(signal))) : null;
    if (!form || !sink) return { action: "decline" };
    let content: Record<string, unknown> | null = null;
    if (form.length) {
      const answers = await sink.ask(form.map((f) => f.question), signal, { optional: true }).catch(() => null);
      if (answers) content = Object.fromEntries(form.map((f) => [f.key, f.value(answers[f.question.question] ?? "")]));
    } else {
      const answer = await sink.approve({ tool: `mcp__${request.serverName}`, title: request.message, description: request.description, risk: "high", fields: [{ label: "Asked by", value: request.displayName ?? request.serverName }] }, signal).catch(() => ({ allow: false }));
      if (answer.allow) content = {};
    }
    return signal.aborted ? { action: "cancel" } : content ? { action: "accept", content: content as NonNullable<ElicitationResult["content"]> } : { action: "decline" };
  }

  private isAttached(path: unknown) {
    if (typeof path !== "string" || !isAbsolute(path)) return false;
    return [...this.attached].some((dir) => {
      const r = relative(dir, path);
      return Boolean(r) && !outside(r);
    });
  }

  /** How a handover went: what didn't connect, or null when it's still going after a while, or you stopped. */
  private async handed(linking: Promise<string[]>, signal?: AbortSignal): Promise<string[] | null> {
    let timer: NodeJS.Timeout | undefined;
    let off = () => {};
    const waited = new Promise<null>((r) => {
      timer = setTimeout(() => r(null), waits.link);
      const stop = () => r(null);
      signal?.addEventListener("abort", stop, { once: true });
      off = () => signal?.removeEventListener("abort", stop);
    });
    try {
      return await Promise.race([linking, waited]);
    } finally {
      clearTimeout(timer);
      off();
    }
  }
  private stillLinking() {
    return `Still connecting ${(this.o.connections ?? []).map((c) => c.name).join(", ")}: their tools may not be there yet.`;
  }

  /** Hands Claude Code `liner` and the connections; what didn't connect, by name and why. */
  private async link(q: Query) {
    const r = await q.setMcpServers(claudeMcp(this.o, this.o.connections));
    return Object.entries(r.errors).map(([name, why]) => `${name}: ${why}`);
  }

  /**
    The connections changed: Claude Code takes them in place, mid-turn too, and their tools are
    there from its next step. One too old to (no setMcpServers) is reopened for the next turn.
  */
  async connect(connections: Connection[]) {
    this.o.connections = connections;
    const q = this.q;
    if (!q) return true;
    // A turn that starts meanwhile waits for it too.
    const linking = this.link(q);
    this.linking = linking;
    try {
      // Not for good: Claude Code can stall on this (T3 Code: ClaudeAgentSdkQueryRunner.test.ts). It may yet land, so the session stays.
      const errors = await this.handed(linking);
      if (!errors) this.sink?.notice(this.stillLinking());
      else if (errors.length) this.sink?.notice(`Didn't connect ${errors.join("; ")}`);
      return true;
    } catch {
      return false;
    } finally {
      if (this.linking === linking) this.linking = null;
    }
  }

  private async pump(q: Query) {
    try {
      for await (const m of q) if (!this.retired.has(q)) this.onMessage(m);
      if (!this.retired.has(q)) this.fail?.(new Error("Claude Code stopped."));
    } catch (e) {
      if (!this.retired.has(q)) this.fail?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (this.q === q) this.lost();
      for (const id of [...this.tails.keys()]) this.untail(id);
    }
  }

  /** The process is gone. So is what it ran, and the SDK's reader stays on its inbox, where it would take your next message to nobody. */
  private lost() {
    this.q = null;
    this.inbox.end();
    this.inbox = new Inbox();
    this.tasks.clear();
    this.endRuns("failed");
    this.hushed.clear();
    this.hushedNotes = 0;
    this.release(null);
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
    // isn't wanted: that turn stops too, unseen (T3 Code: BackgroundWorkStop.integration.test.ts). Not by an
    // interrupt while work you didn't stop still runs: with no turn running, that ends every agent in the
    // background too (claude 2.1.319). The turn is let run and dropped instead.
    if (notes.every((x) => this.hushed.has(x.task_id)) && (notes.length || this.hushedNotes > 0)) {
      if ([...this.tasks.keys()].every((id) => this.hushed.has(id))) void this.q?.interrupt().catch(() => {});
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
    const how = notes.every((x) => x.status === "stopped") ? "stopped" : "finished";
    offer({
      why: notes.length ? `${notes.length === 1 ? "a background task" : `${notes.length} background tasks`} ${how}` : undefined,
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
        this.release(null);
      },
    });
  }

  private onMessage(m: SDKMessage) {
    this.track(m);
    // An agent's own word goes on its row whether or not a turn runs.
    if (this.forAgent(m)) return;
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
      this.said = true;
      sink.text(m.content, m.uuid);
      return;
    }
    // How much of a plan window is used, and whether it ran out: Claude Code says so with a rejected rate limit, and when it resets.
    if (m.type === "rate_limit_event") {
      const w = windowOf(m.rate_limit_info);
      if (w) sink.window?.(w);
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
    if (m.type === "stream_event") {
      const ev = m.event;
      if (ev.type === "message_start") {
        this.retryKey = null;
        this.blocks.clear();
        this.streamId = ev.message.id;
        const u = ev.message.usage;
        if (u) {
          this.ctx = { id: ev.message.id, input: promptTokens(u), output: u.output_tokens ?? 0 };
          if (this.ctx.input > 0) sink.usage({ contextTokens: this.ctx.input + this.ctx.output });
        }
      } else if (ev.type === "message_delta" && this.ctx && this.ctx.id !== this.stale) {
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
        if ((ev.delta.type === "text_delta" || ev.delta.type === "thinking_delta") && this.streamId) this.streamed.add(this.streamId);
        if (ev.delta.type === "text_delta") {
          this.said = true;
          sink.text(ev.delta.text, blk.key);
        } else if (ev.delta.type === "thinking_delta") sink.reasoning(ev.delta.thinking, blk.key);
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
      if (m.message.model && m.message.model !== "<synthetic>") this.mainModel = m.message.model;
      // Claude Code's non-streaming fallback sends the answer whole, with no deltas (T3 Code: ClaudeAdapterV2.ts, emitAssistantTextArtifacts).
      if (m.message.model !== "<synthetic>" && !this.streamed.has(m.message.id))
        m.message.content.forEach((b, i) => {
          if (b.type === "text" && b.text) {
            this.said = true;
            sink.text(b.text, `${m.uuid}:${i}`);
          } else if (b.type === "thinking" && b.thinking) sink.reasoning(b.thinking, `${m.uuid}:t${i}`);
        });
      // Without a stream (or a stream that started with no counts), the message's own usage says it. Claude Code's
      // "<synthetic>" notices report none.
      const u = m.message.usage;
      if (u && m.message.model !== "<synthetic>" && m.message.id !== this.stale && (this.ctx?.id !== m.message.id || this.ctx.input <= 0) && promptTokens(u) > 0)
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
        sink.tool({ key: b.id, tool: b.name, toolKind: kindOf(b.name), title, path, input: JSON.stringify(input, null, 2), status: "running", agent: this.sentOff(sink, b.id, b.name, input, title, path) });
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
        if (b.is_error && NO_AUTO.test(out)) this.autoGone(sink);
        const { title, path } = titleOf(call.name, call.input, this.o.cwd);
        // An agent's call says what the agent sent back, or that it went on in the background.
        if (!this.returned(b.tool_use_id, results.length === 1 ? m.tool_use_result : undefined, out, Boolean(b.is_error)))
          sink.tool({ key: b.tool_use_id, tool: call.name, toolKind: kindOf(call.name), title, path, output: out.slice(0, 20000), status: b.is_error ? "failed" : "done" });
        // The task list changed: the plan shows it as it is now. A lone result carries its structured form.
        if (TASK_TOOLS.has(call.name) && !b.is_error) {
          const said = (results.length === 1 ? m.tool_use_result : undefined) ?? out;
          // The first since this session opened: a list from before a restart is on disk, unless this result is the list.
          const stored = this.tasksRead || (call.name === "TaskList" && Array.isArray(field(said, "tasks"))) ? undefined : storedTasks(this.o.env, this.o.cwd, m.session_id ?? this.o.resume ?? "");
          this.tasksRead = true;
          const next = applyTaskTool(stored ?? this.taskList, call.name, call.input, said) ?? (stored?.size ? stored : undefined);
          if (next) {
            this.taskList = next;
            sink.plan([...next.values()]);
          }
        }
        // Its input has served (title, task list); the entry stays so a late task_notification still knows the row.
        call.input = {};
      }
      return;
    }
    if (m.type === "result") {
      const models = Object.values(m.modelUsage ?? {});
      // The main thread's model says how big the conversation's window is; a subagent on a bigger one doesn't
      // (Synara: claudeTokenUsage.ts takes the largest of all, which a subagent can be).
      const main = this.mainModel ? m.modelUsage?.[this.mainModel] : undefined;
      const window = main?.contextWindow || models.reduce((w, u) => Math.max(w, u.contextWindow ?? 0), 0);
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
      // The first result of a resumed query: when the main model's totals are exactly this turn's own use, the
      // process counted from nothing (Synara: claudeResultUsage.ts, "a new/resumed process starts at zero"), and
      // the models' own costs are this turn's. A total Claude Code carried over from before would not match.
      const fresh =
        !base &&
        main !== undefined &&
        main.outputTokens === m.usage.output_tokens &&
        main.inputTokens + main.cacheCreationInputTokens === m.usage.input_tokens + (m.usage.cache_creation_input_tokens ?? 0) &&
        main.cacheReadInputTokens === (m.usage.cache_read_input_tokens ?? 0);
      sink.usage({
        ...(grew
          ? { inputTokens: now.input - base.input, outputTokens: now.output - base.output, cacheReadTokens: now.cache - base.cache, costUsd: now.cost - base.cost }
          : fresh
          ? { inputTokens: now.input, outputTokens: now.output, cacheReadTokens: now.cache, costUsd: models.reduce((c, u) => c + (u.costUSD ?? 0), 0) }
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
      // Claude Code calls a 403 a failed sign-in too, and signing in can't grant that (T3 Code: ClaudeAdapterV2.ts, permissionDenied).
      const denied = m.subtype === "success" && m.api_error_status === 403;
      const failed = this.signal?.aborted ? undefined : resultError(m, denied ? m.result : undefined);
      const said = failed && this.authFailure && !denied ? this.authFailure : failed;
      // A limit was already said, with its reset time; the result's own words would repeat it.
      if (said && !this.limited) {
        const cooldown = gatewayCooldown(m);
        if (cooldown) sink.limited("Claude's API rate limit was reached. Try again later.", cooldown);
        else if (/usage limit|rate limit|limit reached|hit your limit/i.test(said)) sink.limited(said);
        else sink.error(said);
      }
      // An answer no message carried (T3 Code: ClaudeAdapterV2.ts, its result fallbackText).
      if (!said && !this.said && m.subtype === "success" && m.result.trim()) {
        this.said = true;
        sink.text(m.result, m.uuid);
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
        // An agent's own row says how it went (forAgent), in the turn that sent it: no line here as well.
        const call = m.tool_use_id ? this.tools.get(m.tool_use_id) : undefined;
        if (call?.name === "Agent" || call?.name === "Task") return;
        // A command's own row says how it went; work left in the background has no row any more.
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
        // The request before it says nothing of the size now, and what's still reported of it is from before
        // (T3 Code: ClaudeAdapterV2.test.ts, "ignores stale snapshots after compaction").
        this.stale = this.ctx?.id ?? this.streamId ?? "";
        this.ctx = post && post > 0 ? { id: this.stale, input: post, output: 0 } : null;
        if (post && post > 0) sink.usage({ contextTokens: post });
        // What it compacted away no longer counts against the images and PDFs a conversation may hold.
        if (!m.compact_metadata.preserved_segment && !m.compact_metadata.preserved_messages) this.budget = { bytes: 0, pages: 0 };
        return;
      }
      case "informational":
        if (NO_AUTO.test(m.content) && this.autoGone(sink)) return;
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
    const t: { timer?: NodeJS.Timeout; file?: string; offset: number; text: string; tries: number; decoder: StringDecoder } = { offset: 0, text: "", tries: 0, decoder: new StringDecoder("utf8") };
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
        // Written over: read it again from the top (T3 Code: ClaudeTaskOutputTail.ts).
        if (size < t.offset) {
          t.offset = 0;
          t.decoder = new StringDecoder("utf8");
        }
        if (t.file && size > t.offset) {
          // Only the tail shows: a fast writer is skipped ahead of.
          const from = Math.max(t.offset, size - 256 * 1024);
          const skipped = from > t.offset;
          if (skipped) t.decoder = new StringDecoder("utf8");
          const buf = Buffer.alloc(size - from);
          const fd = openSync(t.file, "r");
          try {
            readSync(fd, buf, 0, buf.length, from);
          } finally {
            closeSync(fd);
          }
          t.offset = size;
          // Decoded as a stream, so a character cut between two reads stays whole.
          t.text = (t.text + (skipped ? "\n" : "") + t.decoder.write(buf)).slice(-20000);
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
    if (!this.q) this.start();
    // The connections' tools are there for this message; a server slow to start doesn't hold it past a while.
    const linking = this.linking;
    this.linking = null;
    if (linking) {
      const errors = await this.handed(linking.catch((e: Error) => [`connections: ${e.message}`]), signal);
      if (!errors && !signal.aborted) sink.notice(this.stillLinking());
      else if (errors?.length) sink.notice(`Didn't connect ${errors.join("; ")}`);
    }
    for (const f of files) this.attached.add(dirname(f));
    // A session opened on a transcript: what it holds counts against what Claude reads (T3 Code keeps this count with the session).
    if (this.uncounted && files.some((f) => imageType(f) || isPdf(f))) {
      const id = this.uncounted;
      this.uncounted = undefined;
      const held = await sdk.getSessionMessages(id, { dir: this.o.cwd, sessionStore: transcripts(this.o.env, this.o.cwd) }).then(heldFiles, () => null);
      if (held) this.budget = { bytes: Math.max(this.budget.bytes, held.bytes), pages: Math.max(this.budget.pages, held.pages) };
    }
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
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<"late">((r) => (timer = setTimeout(() => r("late"), waits.open)));
    try {
      if ((await Promise.race([q.initializationResult(), stopped, late])) === "late") throw new Error("Claude Code didn't start in time. Send your message again; if this keeps happening, check that claude runs in a terminal.");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!/no conversation found/i.test(message)) throw e;
      const lost = this.o.resume;
      this.retired.add(q);
      if (this.q === q) this.lost();
      this.idle = [];
      this.o.resume = undefined;
      this.o.fork = false;
      this.uncounted = undefined;
      throw new ResumeFailed(`Claude Code couldn't find its session ${lost ?? ""} any more.`);
    } finally {
      clearTimeout(timer);
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
    this.said = false;
    if (this.owedNote) sink.notice(this.owedNote, "effort");
    this.owedNote = null;
    // Not carried over from a turn that was stopped before its result: they'd hide this one's failure.
    this.limited = false;
    this.authFailure = undefined;
    // Only this turn's messages are waited on; a steer an earlier turn never answered isn't.
    this.sent = new Set();
    // Your turn takes in what Claude Code had to say about work you stopped.
    if (!woke) this.hushedNotes = 0;
    // A turn Claude Code began has nothing to send a new process.
    if (!this.q && !woke) this.start();
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
      }, waits.stop);
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
      this.release(sink);
      // Stopped before it began: nothing more is asked of Claude Code.
      if (!signal.aborted) begin();
      // The process that began this turn died before it ran: what it said is all there is.
      if (woke && !this.q) this.finish?.();
      await done;
    } finally {
      // Not left to end the next turn, should that start within the moment.
      clearTimeout(late);
      signal.removeEventListener("abort", stop);
      for (const id of [...this.tails.keys()]) this.untail(id);
      // An agent whose call never returned in its turn (stopped, or the turn broke off): one Claude Code still
      // runs goes on in the background, on its row, until it ends; any other is over with the turn.
      for (const [key, run] of [...this.runs]) {
        if (run.sink !== sink || run.status !== "running") continue;
        if (run.agent.taskId && this.tasks.has(run.agent.taskId)) {
          run.status = "done";
          this.agentSays(key, { background: true, state: "running" });
        } else this.runs.delete(key);
      }
      this.streamed.clear();
      this.streamId = null;
      this.sink = null;
      this.signal = null;
      this.woke = false;
      this.finish = this.fail = null;
    }
  }

  /**
    Stops one agent, by its run's id, in the background or not; the rest goes on, and the model that
    sent it reads that it was stopped (one in the background, in a turn Claude Code begins to say so).
    Claude Code's own stop for one task does it (T3 Code: ClaudeAdapterV2.ts, stopSubagent), and
    nothing else may: an interrupt with no turn running ends every agent in the background with it.
  */
  stopAgent(taskId: string) {
    const q = this.q;
    if (!q || !this.tasks.has(taskId)) return false;
    void q.stopTask(taskId).catch(() => {});
    return true;
  }

  /** An Agent or Task call: the agent it sends off, as its row starts in `sink`'s turn. Nothing for any other call. */
  private sentOff(sink: TurnSink, key: string, name: string, input: Record<string, unknown>, title: string, path?: string, parentKey?: string) {
    if (name !== "Agent" && name !== "Task") return undefined;
    const agent: NonNullable<ToolUpdate["agent"]> = {
      name: subagentName(String(input.subagent_type ?? "general-purpose")),
      ...(typeof input.description === "string" && input.description.trim() ? { task: short(input.description, 80) } : {}),
      ...(typeof input.prompt === "string" && input.prompt.trim() ? { brief: input.prompt.trim().slice(0, 4000) } : {}),
      ...(input.run_in_background === true ? { background: true } : {}),
      ...(parentKey ? { parentKey } : {}),
      steps: [],
    };
    this.runs.set(key, { title, path, agent, calls: [], status: "running", sink });
    return { ...agent };
  }

  /** What's new about an agent, on its row in the turn that sent it, its call as it stands (one in the background has returned already). */
  private agentSays(key: string, said: Partial<NonNullable<ToolUpdate["agent"]>>, output?: string) {
    const run = this.runs.get(key);
    const call = this.tools.get(key);
    if (!run || !call) return;
    Object.assign(run.agent, said);
    run.sink.tool({ key, tool: call.name, toolKind: "task", title: run.title, path: run.path, status: run.status, ...(output !== undefined ? { output } : {}), agent: { ...run.agent } });
  }

  /**
    An agent's own word, whether or not a turn runs: its messages (parent_tool_use_id) and its task's
    start, progress and end, each on the row its call made. Claude Code 2.1.319 sends an agent to the
    background unless told not to, and its work goes on after the turn that sent it: it shows on that
    turn's row as it comes, and ends there (T3 Code: ClaudeAdapterV2.test.ts, "streams a background
    subagent's work while the root turn is idle"). True when there's nothing more to do with it: a
    task's end still goes on, as it may wake a turn.
  */
  private forAgent(m: SDKMessage): boolean {
    if ((m.type === "stream_event" || m.type === "assistant" || m.type === "user") && m.parent_tool_use_id) {
      const run = this.runs.get(m.parent_tool_use_id);
      // Only this turn's agents keep its watchdog quiet: one left from an earlier turn isn't this turn at work.
      if (!run || run.sink === this.sink) this.sink?.heard?.();
      if (run && m.type !== "stream_event") this.agentSaid(m, m.parent_tool_use_id, run);
      return true;
    }
    if (m.type !== "system") return false;
    // A task's update names only the task.
    const key = word(m, "tool_use_id") ?? (m.subtype === "task_updated" ? this.tasks.get(m.task_id)?.toolUseId : undefined);
    const run = key ? this.runs.get(key) : undefined;
    if (!key || !run) return false;
    if (run.sink === this.sink) this.sink?.heard?.();
    if (m.subtype === "task_started") {
      // An id now, which is what stopping it alone stops; started in the background, its call returns at once.
      this.agentSays(key, { taskId: m.task_id, ...(m.is_backgrounded ? { background: true } : {}) });
      return true;
    }
    if (m.subtype === "task_updated" && m.patch.is_backgrounded === true) {
      // Moved to the background (a steer does that): its call returns, and it goes on.
      this.agentSays(key, { background: true });
      return true;
    }
    if (m.subtype === "task_progress") {
      // Its own counts, and its one-line word on what it's doing when it gives one.
      this.agentSays(key, { tokens: m.usage.total_tokens, tools: m.usage.tool_uses, ...(m.summary?.trim() ? { now: m.summary.trim() } : {}) });
      return true;
    }
    if (m.subtype !== "task_notification") return false;
    // Its call has returned (it works in the background): this is its end. One its call waits on ends with
    // the call's result, which comes after; stopped, it ended without failing its call.
    if (run.status !== "running") this.agentEnded(key, m);
    else {
      run.end = m;
      if (m.status === "stopped") this.agentSays(key, { state: "stopped" });
    }
    return false;
  }

  /**
    An agent in the background ended: how (its task's notification), what it sent back (its own last
    words, the notification's summary otherwise: a stopped one's summary is only what it was sent to
    do), and its totals. Nothing more comes about it: its row ends where it started, and it's let go.
  */
  private agentEnded(key: string, m: TaskEnd) {
    const run = this.runs.get(key);
    if (!run) return;
    const summary = agentReport(undefined, m.summary ?? "");
    const said = m.status === "completed" ? agentReport(undefined, run.text ?? "") || summary : m.status === "failed" && summary !== run.agent.task ? summary : "";
    const how = m.status === "completed" ? "done" : m.status === "failed" ? "failed" : "stopped";
    this.agentSays(key, {
      state: how,
      now: undefined,
      ...(said ? { report: said.slice(0, 8000) } : {}),
      ...(m.usage ? { tokens: m.usage.total_tokens, tools: m.usage.tool_uses } : {}),
      steps: (run.agent.steps ?? []).map((s) => (s.status === "running" ? { ...s, status: how === "failed" ? "failed" : "done" } : s)),
    });
    this.runs.delete(key);
  }

  /**
    A subagent's own message (parent_tool_use_id): its model, the calls it makes as steps of its
    row, an agent it sends off in turn (a row of its own, under this one), its steps' results, and
    what it says, which once it ends is its report.
  */
  private agentSaid(m: SDKMessage, key: string, run: Run) {
    if (m.type === "assistant") {
      const said: Partial<NonNullable<ToolUpdate["agent"]>> = {};
      if (m.message.model && m.message.model !== "<synthetic>") said.model = `${this.o.provider ?? "claude"}:${m.message.model}`;
      const text = m.message.content.flatMap((b) => (b.type === "text" && b.text.trim() ? [b.text.trim()] : [])).join("\n\n");
      if (text) run.text = text;
      const steps = [...(run.agent.steps ?? [])];
      for (const b of m.message.content) {
        if (b.type !== "tool_use") continue;
        const input = (b.input ?? {}) as Record<string, unknown>;
        const { title, path } = titleOf(b.name, input, this.o.cwd);
        steps.push({ title, toolKind: kindOf(b.name), status: "running", ...(path ? { path } : {}) });
        run.calls.push(b.id);
        said.now = title;
        said.tools = Math.max(run.agent.tools ?? 0, run.calls.length);
        if (b.name === "Agent" || b.name === "Task") {
          this.tools.set(b.id, { name: b.name, input });
          run.sink.tool({ key: b.id, tool: b.name, toolKind: "task", title, path, input: JSON.stringify(input, null, 2), status: "running", agent: this.sentOff(run.sink, b.id, b.name, input, title, path, key) });
        }
      }
      // The last 40, and the ids they go by with them.
      if (steps.length > 40) run.calls.splice(0, steps.length - 40);
      said.steps = steps.slice(-40);
      this.agentSays(key, said);
      return;
    }
    if (m.type !== "user" || !Array.isArray(m.message.content)) return;
    let changed = false;
    const steps = [...(run.agent.steps ?? [])];
    for (const b of m.message.content) {
      if (typeof b !== "object" || b.type !== "tool_result") continue;
      const i = run.calls.indexOf(b.tool_use_id);
      if (i >= 0 && steps[i]) {
        steps[i] = { ...steps[i], status: b.is_error ? "failed" : "done" };
        changed = true;
      }
      // An agent this one sent off has its answer.
      const out = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((c) => (c.type === "text" ? c.text : "")).join("\n") : "";
      this.returned(b.tool_use_id, undefined, out, Boolean(b.is_error));
    }
    if (changed) this.agentSays(key, { steps });
  }

  /**
    An agent's call returned, on its row: what it sent back, from the structured result where there
    is one, and its totals. Sent to the background, it only launched: it works on, a running agent
    whose call is done, and its end comes later (agentEnded). False when it wasn't an agent's call.
  */
  private returned(key: string, result: unknown, out: string, failed: boolean) {
    const run = this.runs.get(key);
    if (!run || !this.tools.has(key)) return false;
    run.status = failed ? "failed" : "done";
    const a = run.agent;
    const model = word(result, "resolvedModel");
    if (model) a.model = `${this.o.provider ?? "claude"}:${model}`;
    const status = word(result, "status");
    // A steer can move one its call waited on to the background, and then its call returns as well.
    const live = Boolean(a.taskId && this.tasks.has(a.taskId));
    if (!failed && (status === "async_launched" || status === "remote_launched" || (a.background && live))) {
      a.background = true;
      a.state = "running";
      this.agentSays(key, {}, out.slice(0, 20000));
      // Its end came first (a quick one): it's over already.
      if (run.end) this.agentEnded(key, run.end);
      return true;
    }
    // Stopped, its call's error is Claude Code's word that it was ("[Request interrupted by user for tool use]"), not a report.
    const report = failed && a.state === "stopped" ? "" : agentReport(field(result, "content"), out);
    if (report) a.report = report.slice(0, 8000);
    const tools = field(result, "totalToolUseCount");
    const tokens = field(result, "totalTokens");
    if (typeof tools === "number") a.tools = tools;
    if (typeof tokens === "number") a.tokens = tokens;
    // Its steps are over, whichever way they went.
    a.steps = (a.steps ?? []).map((s) => (s.status === "running" ? { ...s, status: failed ? "failed" : "done" } : s));
    a.now = undefined;
    if (a.state !== "stopped") delete a.state;
    this.agentSays(key, {}, out.slice(0, 20000));
    this.runs.delete(key);
    return true;
  }

  /** The process is gone, or closed: what its agents were still doing ends with it, on their rows. */
  private endRuns(how: "failed" | "stopped") {
    for (const [key, run] of [...this.runs]) {
      if (run.status === "running") run.status = how === "failed" ? "failed" : "done";
      const steps = (run.agent.steps ?? []).map((s) => (s.status === "running" ? { ...s, status: "failed" as const } : s));
      if ((run.agent.state ?? "running") === "running") this.agentSays(key, { state: how, now: undefined, steps });
    }
    this.runs.clear();
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
      for (const f of files) this.attached.add(dirname(f));
      this.sent.add(this.inbox.push(this.message(text, files), "now"));
      return true;
    };
    if (!agents.length) return send();
    const moved = Promise.allSettled(agents.map((id) => q.backgroundTasks(id)));
    let timer: NodeJS.Timeout | undefined;
    return Promise.race([moved, new Promise((r) => (timer = setTimeout(r, 5000)))]).then(() => (clearTimeout(timer), send()));
  }

  owes() {
    return this.owed;
  }

  /**
    Claude Code said its Auto can't run in this session (its safety check runs only with Anthropic, and this one goes
    elsewhere: someone's own ANTHROPIC_BASE_URL, say), so it refuses every call. The session goes on as Edits on its own,
    said once. False when it isn't at Auto, or already went.
  */
  private autoGone(sink: TurnSink) {
    if (this.access !== "auto" || this.noAuto) return false;
    this.noAuto = true;
    void this.q?.setPermissionMode(modeOf("auto", true)).catch(() => {});
    sink.notice("Auto can't run in this session: the safety check it relies on only runs with Anthropic's own models, and this one goes through another service. So Liner Code stands in for it: it edits files and runs routine commands by itself, and asks about the rest. Send again what was refused.");
    return true;
  }

  /** Mid-turn: Claude Code takes a new permission mode in place, its turn under way too (setPermissionMode); its refusal stops the turn. */
  async setAccess(access: Access) {
    if (access === this.access) return true;
    return this.update({ model: this.o.model, effort: this.o.effort, access }).catch(() => false);
  }

  async update(o: Pick<OpenOptions, "model" | "effort" | "access">) {
    const q = this.q;
    this.owed = false;
    if (!q) {
      Object.assign(this.o, o);
      this.access = o.access;
      return true;
    }
    try {
      if (o.effort !== this.o.effort) {
        // Both keys, or a new level on its own turns ultracode off (T3 Code: ClaudeAdapterV2.ts, claudeLiveSelectionFlagSettings).
        const level = sdkEffort(o.effort);
        const set = level ? await q.applyFlagSettings({ effortLevel: level, ultracode: o.effort === "ultracode" ? true : null }).then(() => true, () => false) : false;
        // It can't be changed in place (and a level can't be cleared in place): reopen with resume for that, unless
        // that would end what runs in the background, a dev server say (T3 Code: its ClaudeBackgroundWorkBlocksQueryReplacementError).
        if (!set && !this.tasks.size) return false;
        if (!set) {
          // Left as it was, so the next turn tries again, and you aren't shown a level it isn't on.
          o = { ...o, effort: this.o.effort };
          this.owed = true;
          this.owedNote = "Claude Code kept its effort for now: changing it would end what runs in the background.";
        }
      }
      if (o.model !== this.o.model) await q.setModel(o.model || undefined);
      if (o.access !== this.access) await q.setPermissionMode(modeOf(o.access, this.noAuto));
    } catch {
      // Claude Code refused (auto mode isn't there for this account or model, say). Reopened with it, the turn in hand goes on.
      return false;
    }
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
    this.tasks.clear();
    // What its agents were still doing goes with the process.
    this.endRuns("stopped");
    this.release(null);
    for (const id of [...this.tails.keys()]) this.untail(id);
    void this.signal;
  }
}

export const claude: Provider = {
  id: "claude",
  async detect(env): Promise<ProviderInfo> {
    const path = which("claude", env);
    const base = { id: "claude" as const, label: "Claude Code", adapter: true, login: "claude auth login", models: FALLBACK, modelsFrom: "builtin" as const, supports: { approvals: true, resume: true, effort: true, plan: true } };
    if (!path) return { ...base, available: false, detail: "Claude Code isn't installed.", install: "npm install -g @anthropic-ai/claude-code && claude auth login" };
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
    const q = query({ prompt: idle(), options: { cwd, pathToClaudeCodeExecutable: sdkPath(path), env: { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: `liner-code/${VERSION}` }, settingSources: ["user", "project", "local"], abortController: abort } });
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
    if (!u.rate_limits_available) return { plan: u.subscription_type ?? undefined, windows: [], detail: "No plan limits: this sign-in bills by the token." };
    // On a plan, Claude Code may not have fetched them yet: each turn's rate limit events fill them in.
    if (!u.rate_limits) return { plan: u.subscription_type ?? undefined, windows: [], detail: "Claude Code didn't say yet. They show after a turn on it." };
    // The call also returns keys that aren't windows (spend, breakdowns, codenamed experiments): only the
    // five-hour and weekly windows with a number are a plan's limits.
    const windows = Object.entries(u.rate_limits).flatMap(([k, w]) =>
      w && typeof w.utilization === "number" && /^(five_hour|seven_day)/.test(k)
        ? [{ label: WINDOWS[k] ?? k.replace(/_/g, " "), usedPercent: w.utilization, resetsAt: w.resets_at ? Date.parse(w.resets_at) : undefined, ...windowKind(k) }]
        : [],
    );
    return { plan: u.subscription_type ?? undefined, windows };
  },
  open: (o) => new ClaudeSession(o),
};
