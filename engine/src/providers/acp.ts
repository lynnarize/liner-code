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
import { jsonLines, spawn, versionOf, which } from "../exec.ts";
import { VERSION } from "../version.ts";
import { commandRisk, isDestructive, ruleFor } from "../risk.ts";
import { acpCommands, acpModelRequest, acpModels } from "./models.ts";
import type { OpenOptions, Provider, ProviderSession, TurnSink } from "./types.ts";

type Json = Record<string, unknown>;
type Msg = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Json; result?: Json; error?: { code: number; message: string } };
type ToolCall = { toolCallId: string; title?: string; kind?: string; status?: string; content?: Json[]; locations?: { path: string }[]; rawInput?: unknown; rawOutput?: unknown };

const KIND: Record<string, ToolKind> = { read: "read", edit: "edit", delete: "edit", move: "edit", search: "search", execute: "exec", think: "think", fetch: "fetch" };

class AcpSession implements ProviderSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private seq = 1;
  private pending = new Map<number | string, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  private session: string | undefined;
  private ready: Promise<void> | null = null;
  private sink: TurnSink | null = null;
  private signal: AbortSignal | null = null;
  private calls = new Map<string, ToolCall>();
  private canLoad = false;
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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }

  private boot() {
    const [bin, ...args] = this.cmd;
    const path = which(bin, this.o.env);
    if (!path) throw new Error(`${bin} isn't installed.`);
    const child = spawn(path, args, { cwd: this.o.cwd, env: this.o.env, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => (this.stderr = (this.stderr + d).slice(-4000)));
    jsonLines(child.stdout, (v) => void this.onMessage(v as Msg));
    child.on("close", (code) => {
      const err = new Error(this.stderr.trim().split("\n").slice(-3).join("\n") || `${bin} exited with ${code}.`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.child = null;
      this.ready = null;
    });
    this.ready = (async () => {
      const init = await this.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
        clientInfo: { name: "liner-code", title: "Liner Code", version: VERSION },
      });
      this.canLoad = Boolean((init.agentCapabilities as Json | undefined)?.loadSession);
      if (this.o.resume && this.canLoad) {
        try {
          await this.request("session/load", { sessionId: this.o.resume, cwd: this.o.cwd, mcpServers: this.mcpServers() });
          this.session = this.o.resume;
          return;
        } catch {
          // The agent forgot it; start fresh below.
        }
      }
      const s = await this.request("session/new", { cwd: this.o.cwd, mcpServers: this.mcpServers() });
      this.session = String(s.sessionId);
      // A model picked in Liner Code, through whichever way this agent takes one.
      const pick = acpModelRequest(s, this.session, this.o.model);
      if (pick) await this.request(pick.method, pick.params).catch(() => this.sink?.notice(`${this.cmd[0]} didn't switch to ${this.o.model}; it runs on its own default.`));
      // Read only maps onto a plan-like mode where the agent offers one.
      const modes = ((s.modes as Json | undefined)?.availableModes as { id: string }[] | undefined) ?? [];
      const want = this.o.access === "read" || this.o.planning ? modes.find((m) => /plan|read|ask/i.test(m.id)) : undefined;
      if (want) await this.request("session/set_mode", { sessionId: this.session, modeId: want.id }).catch(() => {});
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
      const free = this.o.access === "full" || (this.o.access === "edits" && kindNow === "edit");
      if (free && !(this.o.guard && isDestructive(command))) return { outcome: { outcome: "selected", optionId: pick(true) } };
      const sink = this.sink;
      if (!sink || !this.signal) return { outcome: { outcome: "cancelled" } };
      const kind = KIND[call.kind ?? ""] ?? "other";
      const fields = [command && { label: "Command", value: command }, call.locations?.[0] && { label: "File", value: this.rel(call.locations[0].path) }, { label: "Where", value: this.o.cwd }].filter(Boolean) as { label: string; value: string }[];
      const rule = kind === "exec" ? ruleFor(command) : kind === "edit" ? "Edit" : call.kind;
      const a = await sink.approve({ tool: call.kind ?? "tool", title: call.title ?? "Use a tool", risk: kind === "exec" ? commandRisk(command) : "low", fields, rule }, this.signal).catch(() => ({ allow: false }));
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
    if (kind === "agent_message_chunk") sink.text(text(u.content), String(u.messageId ?? "msg"));
    else if (kind === "agent_thought_chunk") sink.reasoning(text(u.content), String(u.messageId ?? "thought"));
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
      sink.tool({
        key: call.toolCallId,
        tool: call.kind ?? "tool",
        toolKind: KIND[call.kind ?? ""] ?? "other",
        title: call.title ?? "Use a tool",
        path: path ? this.rel(path) : undefined,
        input: call.rawInput === undefined ? undefined : JSON.stringify(call.rawInput, null, 2),
        output: out || (call.rawOutput === undefined ? undefined : JSON.stringify(call.rawOutput, null, 2).slice(0, 20000)),
        status,
      });
    } else if (kind === "plan") {
      const entries = (u.entries as { content: string; status: string }[]) ?? [];
      sink.plan(entries.map((e) => ({ title: e.content, status: e.status === "completed" ? "completed" : e.status === "in_progress" ? "in_progress" : "pending" })));
    } else if (kind === "usage_update") {
      const cost = u.cost as { amount?: number } | undefined;
      sink.usage({ contextTokens: Number(u.used) || undefined, contextWindow: Number(u.size) || undefined, ...(cost?.amount != null ? { costUsd: cost.amount } : {}) });
    }
  }

  async turn(text: string, sink: TurnSink, signal: AbortSignal) {
    if (!this.child) this.boot();
    await this.ready;
    if (!this.session) throw new Error("The agent didn't open a session.");
    sink.session(this.session);
    this.sink = sink;
    this.signal = signal;
    const cancel = () => this.send({ method: "session/cancel", params: { sessionId: this.session } });
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const prompt = this.o.soul && !this.soulSent ? `${this.o.soul}\n\n${text}` : text;
      this.soulSent = true;
      const r = await this.request("session/prompt", { sessionId: this.session, prompt: [{ type: "text", text: prompt }] });
      const usage = r.usage as { inputTokens?: number; outputTokens?: number; cachedReadTokens?: number } | undefined;
      if (usage) sink.usage({ inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0, cacheReadTokens: usage.cachedReadTokens ?? 0 });
      if (r.stopReason === "refusal") sink.notice("The agent declined this one.");
      if (r.stopReason === "max_tokens") sink.notice("The agent ran out of room in this turn.");
    } finally {
      signal.removeEventListener("abort", cancel);
      this.sink = null;
      this.signal = null;
    }
  }
  private soulSent = false;

  async update(o: Pick<OpenOptions, "model" | "effort" | "access">) {
    const reopen = o.model !== this.o.model;
    Object.assign(this.o, o);
    return !reopen;
  }

  close() {
    this.child?.stdin.end();
    this.child?.kill();
    this.child = null;
  }
}

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

export const hermes = acpProvider("hermes", { label: "Hermes", cmd: ["hermes", "acp"], install: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash", login: "hermes model" });
export const opencode = acpProvider("opencode", { label: "OpenCode", cmd: ["opencode", "acp"], install: "npm install -g opencode-ai, then opencode auth login", login: "opencode auth login" });
export const cursor = acpProvider("cursor", { label: "Cursor", cmd: ["cursor-agent", "acp"], install: "curl https://cursor.com/install -fsS | bash", login: "cursor-agent login" });
// Grok Build asks before each step the same way; Liner Code answers from the session's access.
export const grok = acpProvider("grok", { label: "Grok Build", cmd: ["grok", "agent", "stdio"], install: "npm install -g @xai-official/grok", login: "grok login" });
