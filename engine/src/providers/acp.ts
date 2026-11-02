/*
  Any agent that speaks the Agent Client Protocol (JSON-RPC over stdio): Hermes (`hermes acp`),
  OpenCode (`opencode acp`), Cursor (`cursor-agent acp`), Grok Build (`grok agent stdio`), and any
  agent you add from the ACP registry or as a command of your own. The engine is the client: it
  answers the agent's permission requests with the approval card, and reads and writes files for
  it inside the project.
*/
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { ProviderId, ProviderInfo, ToolKind } from "../../../contracts/src/index.ts";
import { jsonLines, killTree, spawn, versionOf, which } from "../exec.ts";
import { VERSION } from "../version.ts";
import { commandRisk, isDestructive, ruleFor } from "../risk.ts";
import { linerTitle } from "../agent-tools.ts";
import { acpCommands, acpModelRequest, acpModels } from "./models.ts";
import { imageType, readUpTo } from "./attachments.ts";
import { goKeys, goUsage, hermesGoKey } from "./opencode-go.ts";
import { ResumeFailed, type OpenOptions, type Provider, type ProviderSession, type TurnSink } from "./types.ts";

type Json = Record<string, unknown>;
type Msg = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Json; result?: Json; error?: { code: number; message: string } };
type ToolCall = { toolCallId: string; title?: string; kind?: string; status?: string; content?: Json[]; locations?: { path: string }[]; rawInput?: unknown; rawOutput?: unknown };

const KIND: Record<string, ToolKind> = { read: "read", edit: "edit", delete: "edit", move: "edit", search: "search", execute: "exec", think: "think", fetch: "fetch" };

class AcpSession implements ProviderSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private seq = 1;
  /** Each request with the process it went to: one that ends fails only its own, never the next one's. */
  private pending = new Map<number | string, { resolve: (v: Json) => void; reject: (e: Error) => void; child: ChildProcessWithoutNullStreams | null }>();
  private session: string | undefined;
  private booting: Promise<void> | null = null;
  /** The session it was to load and couldn't (or can't load any): said once, so the runtime sends the conversation so far. */
  private lost: string | undefined;
  /** The agent takes images in a prompt (its promptCapabilities say so). */
  private images = false;
  private sink: TurnSink | null = null;
  private signal: AbortSignal | null = null;
  private calls = new Map<string, ToolCall>();
  private canLoad = false;
  /** The session's cost as the agent last said it; unknown until it says, in a session loaded from before. */
  private spent: number | null = 0;
  /** The agent's own modes: its plan-like one Read only puts it in, and the one it works in otherwise. */
  private modes: { read?: string; work?: string } = {};
  private stderr = "";
  private o: OpenOptions;
  private cmd: string[];

  constructor(o: OpenOptions, cmd: string[]) {
    this.o = o;
    this.cmd = cmd;
  }

  private send(m: Omit<Msg, "jsonrpc">) {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  }
  private request(method: string, params: Json): Promise<Json> {
    const id = this.seq++;
    const child = this.child;
    // No process to ask (it ended while starting, or between turns): an answer would never come, and the
    // start or the turn waiting on it would hang for good (as codex-server.ts does).
    if (!child || !child.stdin.writable) return Promise.reject(new Error(this.stderr.trim().split("\n").slice(-3).join("\n") || `${this.cmd[0]} isn't running.`));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, child });
      this.send({ id, method, params });
    });
  }

  private boot() {
    const [bin, ...args] = this.cmd;
    const path = which(bin, this.o.env);
    if (!path) throw new Error(`${bin} isn't installed.`);
    // A process group of its own, so stopping it stops what it started too: an npx or uvx launcher's agent, its
    // commands (T3 Code: AcpSessionRuntime.ts spawns with ownDetachedProcessGroup).
    const child = spawn(path, args, { cwd: this.o.cwd, env: this.o.env, stdio: ["pipe", "pipe", "pipe"], detached: true }) as ChildProcessWithoutNullStreams;
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => (this.stderr = (this.stderr + d).slice(-4000)));
    jsonLines(child.stdout, (v) => void this.onMessage(v as Msg));
    child.on("close", (code) => {
      const err = new Error(this.stderr.trim().split("\n").slice(-3).join("\n") || `${bin} exited with ${code}.`);
      // A process stopped after Stop's wait can end once the next turn has started another: only what was
      // asked of this one fails (T3 Code: AcpSessionRuntime.ts keeps each process's requests its own).
      for (const [id, p] of this.pending)
        if (p.child === child) {
          this.pending.delete(id);
          p.reject(err);
        }
      if (this.child !== child && this.child) return;
      this.child = null;
      this.booting = null;
    });
    this.booting = (async () => {
      const init = await this.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
        clientInfo: { name: "liner-code", title: "Liner Code", version: VERSION },
      });
      const caps = init.agentCapabilities as Json | undefined;
      this.canLoad = Boolean(caps?.loadSession);
      this.images = Boolean((caps?.promptCapabilities as Json | undefined)?.image);
      let s: Json | null = null;
      if (this.o.resume && this.canLoad) {
        s = await this.request("session/load", { sessionId: this.o.resume, cwd: this.o.cwd, mcpServers: this.mcpServers() }).catch(() => null);
        if (s) {
          this.session = this.o.resume;
          this.spent = null;
          // A session it loads already holds its instructions, from the turn that first sent them.
          this.soulSent = true;
        }
      }
      if (!s) {
        // A session it can't load (or an agent that loads none) starts knowing nothing: the runtime is told,
        // not left to think it resumed (T3 Code: ProviderTurnStartService.ts, its resume fallback).
        if (this.o.resume) this.lost = this.o.resume;
        s = await this.request("session/new", { cwd: this.o.cwd, mcpServers: this.mcpServers() });
        this.session = String(s.sessionId);
        // Started again after its process ended, it loads this session rather than the one it opened with.
        this.o.resume = this.session;
        this.spent = 0;
      }
      // A loaded session gets the model and the mode too: a model you switched to reopens the session to
      // load it, on the model it had (T3 Code: provider-acp adapter.ts sets the model after start or load).
      // A model picked in Liner Code, through whichever way this agent takes one.
      const pick = acpModelRequest(s, this.session!, this.o.model);
      if (pick) await this.request(pick.method, pick.params).catch(() => this.sink?.notice(`${this.cmd[0]} didn't switch to ${this.o.model}; it runs on its own default.`));
      // Read only maps onto a plan-like mode where the agent offers one. The mode it works in otherwise is kept to
      // go back to, and a session loaded in the plan-like mode goes back to it (T3 Code: provider-acp adapter.ts,
      // nativeBuildConfigurationBySessionId).
      const modes = ((s.modes as Json | undefined)?.availableModes as { id: string }[] | undefined) ?? [];
      const now = (s.modes as Json | undefined)?.currentModeId;
      const read = modes.find((m) => /plan|read|ask/i.test(m.id))?.id;
      this.modes = { read, work: typeof now === "string" && now !== read ? now : modes.find((m) => m.id !== read)?.id };
      const want = this.o.access === "read" || this.o.planning ? read : read && now === read ? this.modes.work : undefined;
      if (want) await this.request("session/set_mode", { sessionId: this.session, modeId: want }).catch(() => {});
    })();
  }

  /** Liner Code's own tools, as the stdio MCP server ACP takes. */
  private mcpServers() {
    const m = this.o.mcp;
    return m ? [{ name: "liner", command: m.command, args: m.args, env: Object.entries(m.env).map(([name, value]) => ({ name, value })) }] : [];
  }

  private async onMessage(m: Msg) {
    // A reply to something we asked.
    if (m.id !== undefined && !m.method) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message));
      else p.resolve((m.result ?? {}) as Json);
      return;
    }
    const params = m.params ?? {};
    if (m.method === "session/update") return this.onUpdate(params.update as Json);
    if (m.id === undefined) return;
    // The agent asks us something.
    try {
      const result = await this.answer(m.method ?? "", params);
      this.send({ id: m.id, result });
    } catch (e) {
      this.send({ id: m.id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
    }
  }

  /** Requests from the agent: permission, and file access inside the project. */
  private async answer(method: string, p: Json): Promise<Json> {
    const inside = (path: unknown) => {
      const abs = resolve(this.o.cwd, String(path));
      const rel = relative(this.o.cwd, abs);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("That path is outside the project.");
      return abs;
    };
    if (method === "fs/read_text_file") {
      const text = await readFile(inside(p.path), "utf8");
      const line = typeof p.line === "number" ? p.line - 1 : 0;
      const limit = typeof p.limit === "number" ? p.limit : undefined;
      return { content: line || limit ? text.split("\n").slice(line, limit ? line + limit : undefined).join("\n") : text };
    }
    if (method === "fs/write_text_file") {
      if (this.o.access === "read") throw new Error("This thread is read only.");
      const abs = inside(p.path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, String(p.content ?? ""));
      return {};
    }
    if (method === "session/request_permission") {
      const call = { ...(this.calls.get(String((p.toolCall as ToolCall)?.toolCallId)) ?? {}), ...(p.toolCall as ToolCall) };
      const options = (p.options as { optionId: string; kind: string }[]) ?? [];
      const pick = (allow: boolean) => (options.find((o) => o.kind === (allow ? "allow_once" : "reject_once")) ?? options.find((o) => o.kind.startsWith(allow ? "allow" : "reject")))?.optionId;
      const command = commandOf(call);
      const kindNow = KIND[call.kind ?? ""] ?? "other";
      // Edits go ahead from Edits on its own up; Auto and Reviewer decides hand the rest to Liner Code.
      const free = this.o.access === "full" || ((this.o.access === "edits" || this.o.access === "auto" || this.o.access === "review") && kindNow === "edit");
      if (free && !(this.o.guard && isDestructive(command))) return { outcome: { outcome: "selected", optionId: pick(true) } };
      const sink = this.sink;
      const signal = this.signal;
      if (!sink || !signal) return { outcome: { outcome: "cancelled" } };
      const kind = KIND[call.kind ?? ""] ?? "other";
      const fields = [command && { label: "Command", value: command }, call.locations?.[0] && { label: "File", value: this.rel(call.locations[0].path) }, { label: "Where", value: this.o.cwd }].filter(Boolean) as { label: string; value: string }[];
      const rule = kind === "exec" ? ruleFor(command) : kind === "edit" ? "Edit" : call.kind;
      const a = await sink.approve({ key: call.toolCallId, tool: call.kind ?? "tool", title: call.title ?? "Use a tool", risk: kind === "exec" ? commandRisk(command) : "low", fields, rule }, signal).catch(() => ({ allow: false }));
      // Stopped while it asked: a request open when the prompt is cancelled is answered "cancelled", as ACP
      // asks, not as a no (T3 Code: provider-acp adapter.ts).
      if (signal.aborted) return { outcome: { outcome: "cancelled" } };
      const id = pick(a.allow);
      return id ? { outcome: { outcome: "selected", optionId: id } } : { outcome: { outcome: "cancelled" } };
    }
    throw new Error(`Liner Code doesn't handle ${method} yet.`);
  }

  private rel(p: string) {
    return p.startsWith(this.o.cwd + "/") ? p.slice(this.o.cwd.length + 1) : p;
  }

  private onUpdate(u: Json) {
    const sink = this.sink;
    if (!sink || !u) return;
    const kind = u.sessionUpdate;
    const text = (c: unknown) => ((c as Json)?.type === "text" ? String((c as Json).text ?? "") : "");
    // An agent that leaves out messageId (it's optional) gets a new paragraph after each tool call, not one for the whole turn.
    if (kind === "agent_message_chunk") sink.text(text(u.content), u.messageId ? String(u.messageId) : undefined);
    else if (kind === "agent_thought_chunk") sink.reasoning(text(u.content), u.messageId ? String(u.messageId) : undefined);
    else if (kind === "tool_call" || kind === "tool_call_update") {
      const prev = this.calls.get(String(u.toolCallId));
      const call: ToolCall = { ...prev, ...(u as ToolCall), content: (u.content as Json[] | undefined) ?? prev?.content };
      this.calls.set(call.toolCallId, call);
      const out = (call.content ?? [])
        .map((c) => (c.type === "content" ? text(c.content) : c.type === "diff" ? `Edited ${this.rel(String(c.path))}` : ""))
        .filter(Boolean)
        .join("\n");
      const status = call.status === "completed" ? "done" : call.status === "failed" ? "failed" : "running";
      const path = call.locations?.[0]?.path ?? ((call.content ?? []).find((c) => c.type === "diff")?.path as string | undefined);
      // Liner Code's own tools, under the name the agent gives them ("liner_design_show"): named and titled as every tool names them.
      const ours = /^(?:mcp__)?liner(?:__|[_.:])([a-z_]+)$/.exec(call.title ?? "")?.[1];
      sink.tool({
        key: call.toolCallId,
        tool: ours ? `liner.${ours}` : (call.kind ?? "tool"),
        toolKind: KIND[call.kind ?? ""] ?? "other",
        title: ours ? linerTitle(ours, call.rawInput) : (call.title ?? "Use a tool"),
        path: path ? this.rel(path) : undefined,
        input: call.rawInput === undefined ? undefined : JSON.stringify(call.rawInput, null, 2),
        output: out || (call.rawOutput === undefined ? undefined : JSON.stringify(call.rawOutput, null, 2).slice(0, 20000)),
        status,
      });
    } else if (kind === "plan") {
      const entries = (u.entries as { content: string; status: string }[]) ?? [];
      sink.plan(entries.map((e) => ({ title: e.content, status: e.status === "completed" ? "completed" : e.status === "in_progress" ? "in_progress" : "pending" })));
    } else if (kind === "usage_update") {
      // The cost is the session's so far, so a step's is what it grew by. A loaded session's first one holds
      // its earlier turns too: it only sets where counting starts.
      const cost = (u.cost as { amount?: number } | undefined)?.amount;
      const step = cost != null && this.spent != null && cost >= this.spent ? cost - this.spent : undefined;
      if (cost != null) this.spent = cost;
      sink.usage({ contextTokens: Number(u.used) || undefined, contextWindow: Number(u.size) || undefined, ...(step !== undefined ? { costUsd: step } : {}) });
    }
  }

  async turn(text: string, sink: TurnSink, signal: AbortSignal, files: string[] = []) {
    if (!this.child) this.boot();
    // Stop reaches an agent that's still starting too: one that never answers would hold the turn for good.
    const stopped = new Promise<void>((r) => (signal.aborted ? r() : signal.addEventListener("abort", () => r(), { once: true })));
    await Promise.race([this.booting, stopped]);
    // Stopped while the agent was starting: nothing was asked of it yet. A session it couldn't load is said
    // on the next turn instead, so that one still gets the conversation so far.
    if (signal.aborted) return;
    if (!this.session) throw new Error("The agent didn't open a session.");
    sink.session(this.session);
    if (this.lost) {
      const lost = this.lost;
      this.lost = undefined;
      // A new session knows nothing, so the soul goes again with the conversation so far.
      this.soulSent = false;
      throw new ResumeFailed(`${this.cmd[0]} couldn't load its session ${lost}.`);
    }
    this.sink = sink;
    this.signal = signal;
    // An agent that hasn't finished cancelling 15 seconds after Stop is stopped itself, and the turn
    // ends as stopped; the next turn starts it again on the same session (T3 Code: AcpSessionRuntime.ts, defaultCancelTimeout).
    let late: NodeJS.Timeout | undefined;
    let giveUp = () => {};
    const gaveUp = new Promise<null>((r) => (giveUp = () => r(null)));
    const cancel = () => {
      this.send({ method: "session/cancel", params: { sessionId: this.session } });
      late = setTimeout(() => {
        this.close();
        giveUp();
      }, CANCEL_MS);
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const said = this.o.soul && !this.soulSent ? `${this.o.soul}\n\n${text}` : text;
      this.soulSent = true;
      // Your images go as they are when the agent takes them; every file is named in the text either way.
      const images = this.images ? files.flatMap((f) => {
        const mimeType = imageType(f);
        const bytes = mimeType ? readUpTo(f, 20 * 1024 * 1024) : null;
        return mimeType && bytes ? [{ type: "image", mimeType, data: bytes.toString("base64") }] : [];
      }) : [];
      const r = await Promise.race([this.request("session/prompt", { sessionId: this.session, prompt: [{ type: "text", text: said }, ...images] }), gaveUp]);
      if (!r) return;
      const usage = r.usage as { inputTokens?: number; outputTokens?: number; cachedReadTokens?: number } | undefined;
      if (usage) sink.usage({ inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0, cacheReadTokens: usage.cachedReadTokens ?? 0 });
      if (r.stopReason === "refusal") sink.notice("The agent declined this one.");
      if (r.stopReason === "max_tokens") sink.notice("The agent ran out of room in this turn.");
    } finally {
      clearTimeout(late);
      signal.removeEventListener("abort", cancel);
      this.sink = null;
      this.signal = null;
    }
  }
  private soulSent = false;

  async update(o: Pick<OpenOptions, "model" | "effort" | "access">) {
    const reopen = o.model !== this.o.model;
    // Into Read only or out of it: the agent's own mode goes with it, or it would go on planning (or editing) as it was.
    const mode = this.o.planning || (o.access === "read") === (this.o.access === "read") ? undefined : o.access === "read" ? this.modes.read : this.modes.work;
    Object.assign(this.o, o);
    // Not waited on: it reaches the agent before the next prompt all the same, and one slow to answer doesn't hold that turn.
    if (mode && !reopen && this.child && this.session) void this.request("session/set_mode", { sessionId: this.session, modeId: mode }).catch(() => {});
    return !reopen;
  }

  close() {
    const child = this.child;
    this.child = null;
    if (!child) return;
    child.stdin.end();
    killTree(child);
  }
}

/** How long Stop waits for an ACP agent to finish cancelling before its process is stopped. */
export let CANCEL_MS = 15_000;
/** For tests: a shorter wait. */
export const setCancelMs = (ms: number) => void (CANCEL_MS = ms);

function commandOf(call: ToolCall) {
  const raw = call.rawInput as Json | undefined;
  if (raw && typeof raw.command === "string") return raw.command;
  if (raw && Array.isArray(raw.command)) return raw.command.join(" ");
  return call.kind === "execute" ? (call.title ?? "") : "";
}

type AcpSpec = { label: string; cmd: string[]; install?: string; login: string; env?: Record<string, string>; added?: ProviderInfo["added"]; detail?: string };

/** A tool that speaks ACP: found by its command, its models and commands asked of a throwaway session. */
export function acpProvider(id: ProviderId, spec: AcpSpec): Provider {
  const { label, cmd } = spec;
  const envOf = (env: NodeJS.ProcessEnv) => (spec.env ? { ...env, ...spec.env } : env);
  return {
    id,
    async detect(env) {
      const path = which(cmd[0], envOf(env));
      const base = { id, label, adapter: true, login: spec.login, models: [{ id: "default", label: `${label} default`, description: `The model ${label} is set up with` }], modelsFrom: "builtin" as const, added: spec.added, supports: { approvals: true, resume: true, effort: false, plan: true } };
      if (!path) return { ...base, available: false, detail: `${label} isn't installed.`, install: spec.install };
      // A package runner (npx, uvx) reports its own version, not the agent's.
      const runner = /^(npx|uvx|bunx|pnpx)$/.test(cmd[0]);
      return { ...base, available: true, version: runner ? undefined : await versionOf(path, envOf(env)), detail: spec.detail ?? "Talks over the Agent Client Protocol" };
    },
    models: (env, scratch) => acpModels(cmd, label, envOf(env), scratch),
    commands: async (env, cwd) => ({ commands: await acpCommands(cmd, envOf(env), cwd), skills: [] }),
    open: (o) => new AcpSession({ ...o, env: envOf(o.env) }, cmd),
  };
}

export const hermes: Provider = {
  ...acpProvider("hermes", { label: "Hermes", cmd: ["hermes", "acp"], install: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash", login: "hermes model" }),
  // OpenCode Go's windows, when Hermes has a Go key: they count for its opencode-go models only.
  async limits(env) {
    const key = hermesGoKey(env);
    const windows = key ? await goUsage([key]) : null;
    return windows && { plan: "OpenCode Go", windows, models: "opencode-go" };
  },
};
export const opencode: Provider = {
  ...acpProvider("opencode", { label: "OpenCode", cmd: ["opencode", "acp"], install: "npm install -g opencode-ai && opencode auth login", login: "opencode auth login" }),
  // OpenCode Go's windows, when it signed in with a Go key; Zen and the rest have none to show.
  async limits(env) {
    const keys = goKeys(env);
    const windows = keys.length ? await goUsage(keys) : null;
    return windows && { plan: "Go", windows, models: "opencode-go" };
  },
};
export const cursor = acpProvider("cursor", { label: "Cursor", cmd: ["cursor-agent", "acp"], install: "curl https://cursor.com/install -fsS | bash", login: "cursor-agent login" });
// Grok Build asks before each step the same way; Liner Code answers from the session's access.
export const grok = acpProvider("grok", { label: "Grok Build", cmd: ["grok", "agent", "stdio"], install: "npm install -g @xai-official/grok", login: "grok login" });
