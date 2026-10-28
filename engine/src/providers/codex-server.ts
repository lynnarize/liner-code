/*
  Codex through `codex app-server`: one long-lived process per session speaking JSON-RPC over
  stdio. Unlike `codex exec`, it can stop and ask: commands and edits come back as approval
  cards, Codex's own questions as question cards, and a message written mid-turn steers the
  running turn. Access maps onto Codex's sandbox and approval policy:
  - read:  read-only sandbox, never asks (a lead planning, or a session that only reads)
  - ask:   read-only sandbox, asks to do anything more (every edit and write comes to you)
  - edits: workspace-write sandbox, asks before commands it doesn't trust
  - auto:  workspace-write sandbox, Codex decides when to ask
  - full:  full access; Codex still asks when it judges a step risky
*/
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Access, PlanEntry, Question } from "../../../contracts/src/index.ts";
import { jsonLines, spawn, which } from "../exec.ts";
import { commandRisk, ruleFor } from "../risk.ts";
import { linerTitle } from "../agent-tools.ts";
import type { OpenOptions, ProviderSession, TurnSink } from "./types.ts";

type Json = Record<string, unknown>;
type Msg = { id?: number | string; method?: string; params?: Json; result?: Json; error?: { code?: number; message: string } };

const POLICY: Record<Access, { sandbox: string; approval: string }> = {
  read: { sandbox: "read-only", approval: "never" },
  ask: { sandbox: "read-only", approval: "on-request" },
  edits: { sandbox: "workspace-write", approval: "untrusted" },
  auto: { sandbox: "workspace-write", approval: "on-request" },
  full: { sandbox: "danger-full-access", approval: "on-request" },
};
const sandboxPolicy = (s: string, cwd: string) => (s === "read-only" ? { type: "readOnly", networkAccess: false } : s === "workspace-write" ? { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } : { type: "dangerFullAccess" });
const short = (s: unknown, n = 80) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Codex wraps commands in a login shell: `/bin/zsh -lc "npm test"` reads as `npm test`. */
export const unwrap = (cmd: string) => {
  const m = /^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(cmd.trim());
  return m ? m[2].replace(/\\(["'\\])/g, "$1") : cmd;
};

/** A Codex failure is a usage limit when Codex says so, by code or in words. */
export const isLimit = (e: { codexErrorInfo?: unknown; message?: string }) => e.codexErrorInfo === "usageLimitExceeded" || /usage limit|rate limit|hit your limit/i.test(e.message ?? "");

/** A short-lived app-server for one question (limits, skills), closed after. */
export async function codexAsk<T>(env: NodeJS.ProcessEnv, cwd: string, method: string, params: Json, timeout = 20000): Promise<T> {
  const c = new CodexServer(env, cwd);
  try {
    await c.ready();
    return (await Promise.race([c.request(method, params), new Promise<never>((_, no) => setTimeout(() => no(new Error("Codex didn't answer in time.")), timeout))])) as T;
  } finally {
    c.close();
  }
}

/** The process and its JSON-RPC plumbing. */
class CodexServer {
  child: ChildProcessWithoutNullStreams | null = null;
  private seq = 1;
  private pending = new Map<number | string, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  private booting: Promise<void> | null = null;
  private stderr = "";
  onNotify: (method: string, params: Json) => void = () => {};
  onExit: (message: string) => void = () => {};
  onRequest: (method: string, params: Json) => Promise<Json> = async () => {
    throw new Error("Not handled");
  };
  private env: NodeJS.ProcessEnv;
  private cwd: string;
  constructor(env: NodeJS.ProcessEnv, cwd: string) {
    this.env = env;
    this.cwd = cwd;
  }

  ready() {
    if (this.booting) return this.booting;
    const bin = which("codex", this.env);
    if (!bin) return Promise.reject(new Error("Codex isn't installed."));
    const child = spawn(bin, ["app-server"], { cwd: this.cwd, env: this.env, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => (this.stderr = (this.stderr + d).slice(-4000)));
    jsonLines(child.stdout, (v) => void this.onMessage(v as Msg));
    child.on("close", (code) => {
      const err = new Error(this.stderr.trim().split("\n").slice(-3).join("\n") || `Codex's app server exited with ${code}.`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      if (this.child === child) this.onExit(err.message);
      this.child = null;
      this.booting = null;
    });
    this.booting = (async () => {
      await this.request("initialize", { clientInfo: { name: "liner-code", title: "Liner Code", version: "0.1.0" }, capabilities: { experimentalApi: true, requestAttestation: false } });
      this.notify("initialized", {});
    })();
    return this.booting;
  }

  private write(m: Json) {
    this.child?.stdin.write(`${JSON.stringify(m)}\n`);
  }
  request(method: string, params: Json): Promise<Json> {
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }
  notify(method: string, params: Json) {
    this.write({ method, params });
  }

  private async onMessage(m: Msg) {
    if (m.id !== undefined && !m.method) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message));
      else p.resolve((m.result ?? {}) as Json);
      return;
    }
    if (!m.method) return;
    if (m.id === undefined) return this.onNotify(m.method, m.params ?? {});
    try {
      this.write({ id: m.id, result: await this.onRequest(m.method, m.params ?? {}) });
    } catch (e) {
      this.write({ id: m.id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
    }
  }

  close() {
    const c = this.child;
    this.child = null;
    c?.kill();
  }
}

export class CodexServerSession implements ProviderSession {
  private server: CodexServer;
  private thread: string | undefined;
  private opened = false;
  private turnId: string | null = null;
  private sink: TurnSink | null = null;
  private signal: AbortSignal | null = null;
  private done: (() => void) | null = null;
  private streamed = new Set<string>();
  private changes = new Map<string, string[]>();
  private o: OpenOptions;

  constructor(o: OpenOptions) {
    this.o = o;
    this.thread = o.resume;
    this.server = new CodexServer(o.env, o.cwd);
    this.server.onNotify = (method, params) => this.onNotify(method, params);
    this.server.onRequest = (method, params) => this.onRequest(method, params);
    this.server.onExit = (message) => {
      this.opened = false;
      if (this.sink) this.sink.error(message);
      this.done?.();
    };
  }

  private async open() {
    await this.server.ready();
    if (this.opened) return;
    const p = POLICY[this.o.planning ? "read" : this.o.access];
    // Liner Code's own tools, as config overrides the way `codex -c` takes them.
    const mcp = this.o.mcp ? { "mcp_servers.liner.command": this.o.mcp.command, "mcp_servers.liner.args": this.o.mcp.args, "mcp_servers.liner.env": this.o.mcp.env } : null;
    const common = { cwd: this.o.cwd, approvalPolicy: p.approval, sandbox: p.sandbox, model: this.o.model && this.o.model !== "default" ? this.o.model : null, developerInstructions: this.o.soul || null, config: mcp };
    let r: Json | null = null;
    if (this.thread) r = await this.server.request("thread/resume", { threadId: this.thread, ...common }).catch(() => null);
    if (!r) r = await this.server.request("thread/start", common);
    this.thread = String((r.thread as Json).id);
    this.sink?.session(this.thread);
    this.opened = true;
  }

  async turn(text: string, sink: TurnSink, signal: AbortSignal) {
    this.sink = sink;
    this.signal = signal;
    this.streamed.clear();
    await this.open();
    if (!this.thread) throw new Error("Codex didn't start a thread.");
    sink.session(this.thread);
    const p = POLICY[this.o.planning ? "read" : this.o.access];
    const effort = this.o.effort && !/^ultra(code|think)$/.test(this.o.effort) ? this.o.effort : null;
    const finished = new Promise<void>((resolve) => {
      this.done = resolve;
    });
    const r = await this.server.request("turn/start", {
      threadId: this.thread,
      input: [{ type: "text", text, text_elements: [] }],
      cwd: this.o.cwd,
      approvalPolicy: p.approval,
      sandboxPolicy: sandboxPolicy(p.sandbox, this.o.cwd),
      model: this.o.model && this.o.model !== "default" ? this.o.model : null,
      effort,
    });
    this.turnId = String((r.turn as Json | undefined)?.id ?? "");
    const stop = () => {
      if (this.thread && this.turnId) void this.server.request("turn/interrupt", { threadId: this.thread, turnId: this.turnId }).catch(() => {});
      this.done?.();
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      await finished;
    } finally {
      signal.removeEventListener("abort", stop);
      this.turnId = null;
      this.sink = null;
      this.done = null;
    }
  }

  steer(text: string) {
    if (!this.thread || !this.turnId) return false;
    void this.server.request("turn/steer", { threadId: this.thread, input: [{ type: "text", text, text_elements: [] }], expectedTurnId: this.turnId }).catch(() => this.sink?.notice("Codex couldn't take that mid-turn; it goes next."));
    return true;
  }

  async update(o: Pick<OpenOptions, "model" | "effort" | "access">) {
    // Model, effort and access go with each turn, so they change in place.
    Object.assign(this.o, o);
    return true;
  }

  close() {
    this.server.close();
  }

  private onNotify(method: string, p: Json) {
    const sink = this.sink;
    if (!sink) return;
    const item = p.item as Json | undefined;
    switch (method) {
      case "item/agentMessage/delta":
        this.streamed.add(String(p.itemId));
        sink.text(String(p.delta ?? ""), String(p.itemId));
        return;
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
        this.streamed.add(String(p.itemId));
        sink.reasoning(String(p.delta ?? ""), String(p.itemId));
        return;
      case "item/started":
      case "item/completed":
        if (item) this.onItem(item, method === "item/completed");
        return;
      case "turn/plan/updated": {
        const steps = (p.plan as { step: string; status: string }[] | undefined) ?? [];
        sink.plan(steps.map((s): PlanEntry => ({ title: s.step, status: s.status === "completed" ? "completed" : s.status === "inProgress" ? "in_progress" : "pending" })));
        return;
      }
      case "thread/tokenUsage/updated": {
        const u = p.tokenUsage as { total?: Json; last?: Json; modelContextWindow?: number | null } | undefined;
        const t = (u?.total ?? {}) as { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number };
        const last = (u?.last ?? {}) as { inputTokens?: number };
        sink.usage({ inputTokens: (t.inputTokens ?? 0) - (t.cachedInputTokens ?? 0), cacheReadTokens: t.cachedInputTokens ?? 0, outputTokens: t.outputTokens ?? 0, contextTokens: last.inputTokens, contextWindow: u?.modelContextWindow ?? undefined }, true);
        return;
      }
      case "error": {
        const e = (p.error ?? {}) as { message?: string; codexErrorInfo?: unknown };
        if (p.willRetry) return sink.notice(`${e.message ?? "Codex hit a problem"}; it's trying again.`);
        if (isLimit(e)) sink.limited(e.message ?? "Codex hit its usage limit.");
        else sink.error(e.message ?? "Codex stopped with an error.");
        return;
      }
      case "turn/completed": {
        const turn = p.turn as { status?: string; error?: { message?: string; codexErrorInfo?: unknown } | null } | undefined;
        if (turn?.status === "failed" && turn.error) {
          if (isLimit(turn.error)) sink.limited(turn.error.message ?? "Codex hit its usage limit.");
          else sink.error(turn.error.message ?? "Codex stopped with an error.");
        }
        this.done?.();
        return;
      }
    }
  }

  private onItem(it: Json, done: boolean) {
    const sink = this.sink!;
    const id = String(it.id);
    const cwd = `${this.o.cwd}/`;
    switch (it.type) {
      case "agentMessage":
        if (done && !this.streamed.has(id) && it.text) sink.text(String(it.text), id);
        return;
      case "reasoning": {
        const summary = ((it.summary as string[] | undefined) ?? []).join("\n");
        if (done && !this.streamed.has(id) && summary) sink.reasoning(summary, id);
        return;
      }
      case "commandExecution": {
        const status = String(it.status);
        const failed = status === "failed" || status === "declined" || (done && typeof it.exitCode === "number" && it.exitCode !== 0);
        sink.tool({ key: id, tool: "shell", toolKind: "exec", title: `Run ${short(unwrap(String(it.command ?? "")), 60)}`, input: unwrap(String(it.command ?? "")), output: (it.aggregatedOutput as string | null) ?? undefined, status: !done ? "running" : failed ? "failed" : "done" });
        return;
      }
      case "fileChange": {
        const paths = ((it.changes as { path: string }[] | undefined) ?? []).map((c) => c.path.replace(cwd, ""));
        this.changes.set(id, paths);
        sink.tool({ key: id, tool: "apply_patch", toolKind: "edit", title: `Edit ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ` and ${paths.length - 3} more` : ""}`, path: paths[0], status: !done ? "running" : it.status === "failed" || it.status === "declined" ? "failed" : "done" });
        return;
      }
      case "mcpToolCall": {
        const result = it.result as { content?: { type?: string; text?: string }[] } | null | undefined;
        const said = (result?.content ?? []).map((c) => (c.type === "text" ? c.text : c.type === "image" ? "(an image)" : "")).filter(Boolean).join("\n");
        const output = (it.error as { message?: string } | null | undefined)?.message ?? (said || undefined);
        sink.tool({ key: id, tool: `${it.server}.${it.tool}`, toolKind: "other", title: it.server === "liner" ? linerTitle(String(it.tool), it.arguments) : `${it.server} · ${it.tool}`, output: output?.slice(0, 20000), status: !done ? "running" : it.status === "failed" ? "failed" : "done" });
        return;
      }
      case "webSearch":
        sink.tool({ key: id, tool: "web_search", toolKind: "web", title: `Search the web for ${short(it.query, 50)}`, status: done ? "done" : "running" });
        return;
      case "contextCompaction":
        if (done) sink.notice("Codex compacted the conversation to make room.");
        return;
    }
  }

  /** Codex asks: a command, an edit, or a question. Each becomes a card and waits for you. */
  private async onRequest(method: string, p: Json): Promise<Json> {
    const sink = this.sink;
    const signal = this.signal;
    if (!sink || !signal) return method.includes("Approval") || method.includes("requestApproval") ? { decision: "decline" } : {};
    if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") {
      const command = unwrap(Array.isArray(p.command) ? (p.command as string[]).join(" ") : String(p.command ?? ""));
      const fields = [{ label: "Command", value: command }];
      if (p.cwd) fields.push({ label: "Runs in", value: String(p.cwd) });
      if (p.reason) fields.push({ label: "Why", value: String(p.reason) });
      const a = await sink.approve({ tool: "shell", title: `Run ${short(command, 60)}`, description: (p.reason as string | undefined) ?? undefined, risk: commandRisk(command), fields, rule: ruleFor(command) }, signal);
      return method === "execCommandApproval" ? { decision: a.allow ? "approved" : "denied" } : { decision: a.allow ? "accept" : "decline" };
    }
    if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
      const paths = this.changes.get(String(p.itemId)) ?? Object.keys((p.fileChanges as Json | undefined) ?? {});
      const a = await sink.approve({ tool: "apply_patch", title: `Edit ${paths.slice(0, 3).join(", ") || "files"}`, description: (p.reason as string | undefined) ?? undefined, risk: "medium", fields: paths.map((x) => ({ label: "File", value: x })).concat(p.grantRoot ? [{ label: "Write access to", value: String(p.grantRoot) }] : []), rule: "Edit" }, signal);
      return method === "applyPatchApproval" ? { decision: a.allow ? "approved" : "denied" } : { decision: a.allow ? "accept" : "decline" };
    }
    if (method === "item/tool/requestUserInput") {
      const qs = (p.questions as { id: string; header: string; question: string; options: { label: string; description: string }[] | null }[] | undefined) ?? [];
      const questions: Question[] = qs.map((q) => ({ question: q.question, header: q.header, options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description })) }));
      const answers = await sink.ask(questions, signal);
      return { answers: Object.fromEntries(qs.map((q) => [q.id, { answers: answers?.[q.question] ? [answers[q.question]] : [] }])) };
    }
    if (method === "item/permissions/requestApproval") return { decision: "decline" };
    if (method === "mcpServer/elicitation/request") {
      const meta = (p._meta ?? {}) as { codex_approval_kind?: string; tool_params_display?: { display_name?: string; name: string; value: unknown }[] };
      // Liner Code's own tools only reach this session's Browser, the Simulator and its timeline.
      if (p.serverName === "liner") return { action: "accept", content: {}, _meta: null };
      // Another server's tool call asks like any other step; anything else it wants filled in, Liner Code can't show yet.
      if (meta.codex_approval_kind !== "mcp_tool_call") return { action: "decline", content: null, _meta: null };
      const fields = (meta.tool_params_display ?? []).slice(0, 4).map((x) => ({ label: x.display_name || x.name, value: short(typeof x.value === "string" ? x.value : JSON.stringify(x.value), 200) }));
      const a = await sink.approve({ tool: String(p.serverName), title: String(p.message ?? "Use a tool"), risk: "medium", fields, rule: `${p.serverName}` }, signal);
      return { action: a.allow ? "accept" : "decline", content: a.allow ? {} : null, _meta: null };
    }
    throw new Error(`Liner Code doesn't answer ${method} yet.`);
  }
}
