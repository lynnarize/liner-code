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
import { query, type Options, type PermissionMode, type Query, type SDKMessage, type SDKUserMessage, type SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Access, ModelInfo, ProviderInfo, ToolKind } from "../../../contracts/src/index.ts";
import { run, versionOf, which } from "../exec.ts";
import { VERSION } from "../version.ts";
import { linerTitle } from "../agent-tools.ts";
import { commandRisk, isDestructive, ruleFor } from "../risk.ts";
import { subagentName } from "../review.ts";
import { effortOf, skillsIn, ULTRACODE, ULTRATHINK } from "./models.ts";
import type { OpenOptions, Provider, ProviderSession, TurnSink } from "./types.ts";

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

const MODE: Record<Access, PermissionMode> = { read: "plan", ask: "default", edits: "acceptEdits", auto: "auto", full: "acceptEdits" };
/** A lead reads and plans; these stay with the coder. */
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
  if (name === "TodoWrite") return "think";
  return "other";
}

/** A plan's name: its first heading or first line. */
function planTitle(plan: string) {
  const line = plan.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "The plan";
  return line.length > 70 ? `${line.slice(0, 68)}…` : line;
}

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
    default:
      if (name.startsWith("mcp__liner__")) return { title: linerTitle(name.slice(12), input) };
      return { title: name.startsWith("mcp__") ? name.split("__").slice(1).join(" · ") : name };
  }
}

/** A queue the SDK reads the prompt from: each push is one message you sent. */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private done = false;
  push(text: string, priority?: "next") {
    this.queue.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, ...(priority ? { priority } : {}) });
    this.wake?.();
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
  /** Claude Code's slash commands and skills, as it last listed them. */
  commands: SlashCommand[] = [];

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
      permissionMode: o.planning ? "default" : MODE[this.access],
      disallowedTools: o.planning ? LEAD_DENIED : undefined,
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
      canUseTool: async (name, input, { signal }) => {
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
          const answer = await sink.propose(title, plan, signal).catch(() => ({ approve: false, note: undefined }));
          if (!answer.approve) return { behavior: "deny", message: answer.note ? `Change the plan: ${answer.note}` : "The user didn't approve the plan. Ask what to change." };
          this.access = "edits";
          void this.q?.setPermissionMode(MODE.edits).catch(() => {});
          return { behavior: "allow", updatedInput: input };
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
    this.q = query({ prompt: this.inbox, options });
    void this.pump(this.q);
  }

  private async pump(q: Query) {
    try {
      for await (const m of q) this.onMessage(m);
      this.fail?.(new Error("Claude Code stopped."));
    } catch (e) {
      this.fail?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      this.q = null;
    }
  }

  private onMessage(m: SDKMessage) {
    const sink = this.sink;
    if (!sink) return;
    if (m.type === "system" && m.subtype === "init") {
      sink.session(m.session_id);
      return;
    }
    // The plan ran out: Claude Code says so with a rejected rate limit, and when it resets.
    if (m.type === "rate_limit_event") {
      const info = m.rate_limit_info;
      if (info.status === "rejected") {
        this.limited = true;
        const until = info.resetsAt ? (info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt) : undefined;
        sink.limited(`Your Claude plan's ${limitName(info.rateLimitType)} is used up.`, until);
      }
      return;
    }
    if (m.type === "system" && m.subtype === "commands_changed") {
      this.commands = m.commands;
      return;
    }
    if (m.type === "stream_event") {
      if (m.parent_tool_use_id) return; // a subagent's stream: its tool call row carries it
      const ev = m.event;
      if (ev.type === "message_start") this.blocks.clear();
      if (ev.type === "content_block_start") {
        const b = ev.content_block;
        const key = `${m.uuid}:${ev.index}`;
        if (b.type === "text") this.blocks.set(ev.index, { kind: "text", key });
        else if (b.type === "thinking") this.blocks.set(ev.index, { kind: "thinking", key });
      } else if (ev.type === "content_block_delta") {
        const blk = this.blocks.get(ev.index);
        if (!blk) return;
        if (ev.delta.type === "text_delta") sink.text(ev.delta.text, blk.key);
        else if (ev.delta.type === "thinking_delta") sink.reasoning(ev.delta.thinking, blk.key);
      }
      return;
    }
    if (m.type === "assistant") {
      if (m.parent_tool_use_id) return; // a subagent's own calls stay inside its Task row
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
      for (const b of content) {
        if (typeof b !== "object" || b.type !== "tool_result") continue;
        const call = this.tools.get(b.tool_use_id);
        if (!call) continue;
        const out = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n") : "";
        const { title, path } = titleOf(call.name, call.input, this.o.cwd);
        sink.tool({ key: b.tool_use_id, tool: call.name, toolKind: kindOf(call.name), title, path, output: out.slice(0, 20000), status: b.is_error ? "failed" : "done" });
      }
      return;
    }
    if (m.type === "result") {
      const models = Object.values(m.modelUsage ?? {});
      const window = models.reduce((w, u) => Math.max(w, u.contextWindow ?? 0), 0);
      sink.usage({
        inputTokens: models.reduce((s, u) => s + u.inputTokens + u.cacheCreationInputTokens, 0),
        outputTokens: models.reduce((s, u) => s + u.outputTokens, 0),
        cacheReadTokens: models.reduce((s, u) => s + u.cacheReadInputTokens, 0),
        costUsd: m.total_cost_usd,
        contextTokens: m.usage ? m.usage.input_tokens + (m.usage.cache_read_input_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0) : undefined,
        contextWindow: window || undefined,
      }, true);
      const said = m.subtype !== "success" ? m.errors?.join("\n") || "Claude Code stopped with an error." : m.is_error ? m.result || "Claude Code stopped with an error." : "";
      // A limit was already said, with its reset time; the result's own words would repeat it.
      if (said && !this.limited) {
        if (/usage limit|rate limit|limit reached|hit your limit/i.test(said)) sink.limited(said);
        else sink.error(said);
      }
      this.limited = false;
      this.finish?.();
    }
  }

  async turn(text: string, sink: TurnSink, signal: AbortSignal) {
    this.sink = sink;
    this.signal = signal;
    if (!this.q) this.start();
    const done = new Promise<void>((resolve, reject) => {
      this.finish = resolve;
      this.fail = reject;
    });
    const stop = () => {
      void this.q?.interrupt().catch(() => {});
      // An interrupt ends with a result message; if it never comes, let go after a moment.
      setTimeout(() => this.finish?.(), 4000);
    };
    signal.addEventListener("abort", stop, { once: true });
    // Ultrathink is a word Claude Code reads in the prompt, so every turn carries it.
    this.inbox.push(this.o.effort === "ultrathink" ? `${text}\n\nultrathink` : text);
    try {
      await done;
    } finally {
      signal.removeEventListener("abort", stop);
      this.sink = null;
      this.signal = null;
      this.finish = this.fail = null;
    }
  }

  steer(text: string) {
    if (!this.q || !this.sink) return false;
    this.inbox.push(text, "next");
    return true;
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

  close() {
    this.inbox.end();
    this.q?.return?.(undefined);
    this.q = null;
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
    const windows = Object.entries(u.rate_limits).flatMap(([k, w]) => (w && w.utilization !== null ? [{ label: names[k] ?? k.replace(/_/g, " "), usedPercent: w.utilization, resetsAt: w.resets_at ? Date.parse(w.resets_at) : undefined }] : []));
    return { plan: u.subscription_type ?? undefined, windows };
  },
  open: (o) => new ClaudeSession(o),
};
