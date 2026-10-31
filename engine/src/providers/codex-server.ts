/*
  Codex through `codex app-server`: one long-lived process per session speaking JSON-RPC over
  stdio. Unlike `codex exec`, it can stop and ask: commands and edits come back as approval
  cards, Codex's own questions as question cards, and a message written mid-turn steers the
  running turn. Access maps onto Codex's sandbox and approval policy:
  - read:  read-only sandbox, never asks (a lead planning, or a session that only reads)
  - ask:   read-only sandbox, asks to do anything more (every edit and write comes to you)
  - edits: workspace-write sandbox, asks before commands it doesn't trust
  - auto:  workspace-write sandbox, Codex decides when to ask
  - review: workspace-write sandbox; what Codex doesn't trust goes to the Reviewer, then to you
  - full:  full access; Codex still asks when it judges a step risky
*/
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Access, PlanEntry, Question } from "../../../contracts/src/index.ts";
import { jsonLines, spawn, which, withCodexPath } from "../exec.ts";
import { VERSION } from "../version.ts";
import { commandRisk, ruleFor } from "../risk.ts";
import { linerTitle } from "../agent-tools.ts";
import { dataUrl, imageType } from "./attachments.ts";
import { ResumeFailed, type OpenOptions, type ProviderSession, type TurnSink } from "./types.ts";

type Json = Record<string, unknown>;
type Msg = { id?: number | string; method?: string; params?: Json; result?: Json; error?: { code?: number; message: string } };

const POLICY: Record<Access, { sandbox: string; approval: string }> = {
  read: { sandbox: "read-only", approval: "never" },
  ask: { sandbox: "read-only", approval: "on-request" },
  edits: { sandbox: "workspace-write", approval: "untrusted" },
  auto: { sandbox: "workspace-write", approval: "on-request" },
  review: { sandbox: "workspace-write", approval: "untrusted" },
  full: { sandbox: "danger-full-access", approval: "on-request" },
};
const sandboxPolicy = (s: string, cwd: string) => (s === "read-only" ? { type: "readOnly", networkAccess: false } : s === "workspace-write" ? { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } : { type: "dangerFullAccess" });
/**
  A failed command's output with how it ended, since Codex's output can leave out what the shell
  said ("command not found" for a tool that isn't installed), and the row then failed with no reason.
*/
export function withExit(out: string | undefined, code: unknown) {
  if (typeof code !== "number" || code === 0) return out;
  const why = code === 127 ? ": a command in it isn't installed here" : code === 126 ? ": a command in it can't run" : code > 128 ? `: stopped by signal ${code - 128}` : "";
  return `${out?.trimEnd() ? `${out.trimEnd()}\n` : ""}[exit ${code}${why}]`;
}

const short = (s: unknown, n = 80) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Codex wraps commands in a login shell: `/bin/zsh -lc "npm test"` reads as `npm test`. */
export const unwrap = (cmd: string) => {
  const m = /^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(cmd.trim());
  return m ? m[2].replace(/\\(["'\\])/g, "$1") : cmd;
};

/**
  Codex's models that reason, from its catalog (codex.ts fills it as it detects Codex): a turn on one
  asks for detailed reasoning summaries, which the catalog may default to none. Empty until then,
  when every turn asks, as T3 Code does.
*/
export const reasoning = new Set<string>();

/** What you sent, as Codex takes it: the text, and your images as data URLs (T3 Code: CodexAdapterV2.ts, resolveCodexAttachment). */
function input(text: string, files: string[] = []) {
  const images = files.filter((f) => imageType(f)).flatMap((f) => {
    const url = dataUrl(f);
    return url ? [{ type: "image", url }] : [];
  });
  return [{ type: "text", text, text_elements: [] }, ...images];
}

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
    const child = spawn(bin, ["app-server"], { cwd: this.cwd, env: withCodexPath(bin, this.env), stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
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
      await this.request("initialize", { clientInfo: { name: "liner-code", title: "Liner Code", version: VERSION }, capabilities: { experimentalApi: true, requestAttestation: false } });
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
  /** A running command's output so far, by item; it reaches the row a few times a second. */
  private outputs = new Map<string, { text: string; title: string; input: string; timer?: NodeJS.Timeout }>();
  private changes = new Map<string, string[]>();
  /** Codex's running totals at its last report, to count each step from; none yet in this process. */
  private counted: { input: number; cached: number; output: number } | null = null;
  /** This turn's failure, said once when the turn ends (Codex sends it as an error, then again with the turn). */
  private failure: { message?: string; codexErrorInfo?: unknown } | null = null;
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
    let lost: string | undefined;
    if (this.thread) {
      // Only the thread's settings: its turns are already on the timeline (T3 Code: CodexAdapterV2.ts, resumeThread).
      const threadId = this.thread;
      const resume = () => this.server.request("thread/resume", { threadId, excludeTurns: true, ...common });
      r = await resume().catch((e: Error) =>
        // An archived thread resumes once it's unarchived.
        /\bsession \S+ is archived\b|\bcodex unarchive\b/i.test(e.message) ? this.server.request("thread/unarchive", { threadId }).then(resume).catch(() => null) : null,
      );
      if (!r) lost = threadId;
    }
    if (!r) r = await this.server.request("thread/start", common);
    this.thread = String((r.thread as Json).id);
    this.sink?.session(this.thread);
    this.opened = true;
    // A thread Codex can't resume isn't swapped for a new one in silence: the runtime sends the new one the conversation so far.
    if (lost) throw new ResumeFailed(`Codex couldn't resume its thread ${lost}.`);
  }

  async turn(text: string, sink: TurnSink, signal: AbortSignal, files: string[] = []) {
    this.sink = sink;
    this.signal = signal;
    this.streamed.clear();
    this.failure = null;
    const stop = () => {
      if (this.thread && this.turnId) void this.server.request("turn/interrupt", { threadId: this.thread, turnId: this.turnId }).catch(() => {});
      this.done?.();
    };
    try {
      await this.open();
      if (!this.thread) throw new Error("Codex didn't start a thread.");
      sink.session(this.thread);
      // Stopped while Codex was starting: nothing was asked of it yet.
      if (signal.aborted) return;
      const p = POLICY[this.o.planning ? "read" : this.o.access];
      const effort = this.o.effort && !/^ultra(code|think)$/.test(this.o.effort) ? this.o.effort : null;
      const finished = new Promise<void>((resolve) => {
        this.done = resolve;
      });
      // `/compact` is the Codex CLI's own command, not words for the model: app-server compacts on request.
      if (text.trim() === "/compact") await this.server.request("thread/compact/start", { threadId: this.thread });
      else {
        const model = this.o.model && this.o.model !== "default" ? this.o.model : null;
        const r = await this.server.request("turn/start", {
          threadId: this.thread,
          input: input(text, files),
          // The catalog can default summaries to none; ask for them on every turn of a model that reasons (T3 Code: CodexAdapterV2.ts).
          ...(!model || !reasoning.size || reasoning.has(model) ? { summary: "detailed" } : {}),
          cwd: this.o.cwd,
          approvalPolicy: p.approval,
          sandboxPolicy: sandboxPolicy(p.sandbox, this.o.cwd),
          model: this.o.model && this.o.model !== "default" ? this.o.model : null,
          effort,
        });
        this.turnId = String((r.turn as Json | undefined)?.id ?? "");
      }
      signal.addEventListener("abort", stop, { once: true });
      // Stopped while the turn was starting: the signal won't say so again.
      if (signal.aborted) stop();
      await finished;
    } finally {
      signal.removeEventListener("abort", stop);
      this.turnId = null;
      this.sink = null;
      this.signal = null;
      this.done = null;
      // A command cut off mid-run never completes here: its pending output isn't left to mark the row running again.
      for (const out of this.outputs.values()) clearTimeout(out.timer);
      this.outputs.clear();
    }
  }

  /** True once Codex took it; false when it couldn't (the turn ended first, say), and the runtime sends it next. */
  steer(text: string, files: string[] = []) {
    if (!this.thread || !this.turnId) return false;
    return this.server.request("turn/steer", { threadId: this.thread, input: input(text, files), expectedTurnId: this.turnId }).then(
      () => true,
      () => false,
    );
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
      case "item/commandExecution/outputDelta": {
        const out = this.outputs.get(String(p.itemId));
        if (!out) return;
        out.text = (out.text + String(p.delta ?? "")).slice(-20000);
        out.timer ??= setTimeout(() => {
          out.timer = undefined;
          if (this.outputs.get(String(p.itemId)) === out && this.sink === sink) sink.tool({ key: String(p.itemId), tool: "shell", toolKind: "exec", title: out.title, input: out.input, output: out.text, status: "running" });
        }, 250);
        return;
      }
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
        // The last request's whole count is how full the context is (T3 Code reads it the same way).
        const last = (u?.last ?? {}) as { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; totalTokens?: number };
        // The totals are the thread's, from before this process too when it resumed one: a step is what they grew
        // by since the last report. With none to count from yet, or totals that went back, it's the newest
        // response's own use (as T3 Code counts it).
        const now = { input: t.inputTokens ?? 0, cached: t.cachedInputTokens ?? 0, output: t.outputTokens ?? 0 };
        const base = this.counted;
        this.counted = now;
        const step =
          base && now.input >= base.input && now.cached >= base.cached && now.output >= base.output
            ? { input: now.input - base.input, cached: now.cached - base.cached, output: now.output - base.output }
            : { input: last.inputTokens ?? 0, cached: last.cachedInputTokens ?? 0, output: last.outputTokens ?? 0 };
        sink.usage({ inputTokens: step.input - step.cached, cacheReadTokens: step.cached, outputTokens: step.output, contextTokens: last.totalTokens ?? last.inputTokens, contextWindow: u?.modelContextWindow ?? undefined });
        return;
      }
      case "error": {
        const e = (p.error ?? {}) as { message?: string; codexErrorInfo?: unknown };
        if (p.willRetry) return sink.notice(`${e.message ?? "Codex hit a problem"}; it's trying again.`);
        // turn/completed brings the same error again: it's said there, once (as T3 Code does).
        this.failure = e;
        return;
      }
      case "turn/completed": {
        const turn = p.turn as { status?: string; error?: { message?: string; codexErrorInfo?: unknown } | null } | undefined;
        const failed = turn?.status === "interrupted" ? null : ((turn?.status === "failed" ? turn.error : null) ?? this.failure);
        this.failure = null;
        if (failed) {
          if (isLimit(failed)) sink.limited(failed.message ?? "Codex hit its usage limit.");
          else sink.error(failed.message ?? "Codex stopped with an error.");
        }
        this.done?.();
        return;
      }
      // A compaction asked for with /compact: done whether or not it ran as a turn of its own.
      case "thread/compacted":
        sink.notice("Codex compacted the conversation.");
        this.done?.();
        return;
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
        const input = unwrap(String(it.command ?? ""));
        const title = `Run ${short(input, 60)}`;
        // Its output streams in while it runs (outputDelta); the finished item brings all of it.
        if (done) clearTimeout(this.outputs.get(id)?.timer), this.outputs.delete(id);
        else if (!this.outputs.has(id)) this.outputs.set(id, { text: "", title, input });
        const out = (it.aggregatedOutput as string | null) ?? undefined;
        sink.tool({ key: id, tool: "shell", toolKind: "exec", title, input, output: done && failed ? withExit(out, it.exitCode) : out, status: !done ? "running" : failed ? "failed" : "done" });
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
      const a = await sink.approve({ key: p.itemId ? String(p.itemId) : undefined, tool: "shell", title: `Run ${short(command, 60)}`, description: (p.reason as string | undefined) ?? undefined, risk: commandRisk(command), fields, rule: ruleFor(command) }, signal);
      return method === "execCommandApproval" ? { decision: a.allow ? "approved" : "denied" } : { decision: a.allow ? "accept" : "decline" };
    }
    if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
      const paths = this.changes.get(String(p.itemId)) ?? Object.keys((p.fileChanges as Json | undefined) ?? {});
      const a = await sink.approve({ key: p.itemId ? String(p.itemId) : undefined, tool: "apply_patch", title: `Edit ${paths.slice(0, 3).join(", ") || "files"}`, description: (p.reason as string | undefined) ?? undefined, risk: "medium", fields: paths.map((x) => ({ label: "File", value: x })).concat(p.grantRoot ? [{ label: "Write access to", value: String(p.grantRoot) }] : []), rule: "Edit" }, signal);
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
