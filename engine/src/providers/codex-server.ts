/*
  Codex through `codex app-server`: one long-lived process per session speaking JSON-RPC over
  stdio. Unlike `codex exec`, it can stop and ask: commands and edits come back as approval
  cards, Codex's own questions as question cards, and a message written mid-turn steers the
  running turn. Access maps onto Codex's sandbox and approval policy:
  - read:  read-only sandbox, never asks (a session that only reads)
  - ask:   read-only sandbox, asks to do anything more (every edit and write comes to you)
  - edits: workspace-write sandbox, asks before commands it doesn't trust
  - auto:  workspace-write sandbox, Codex decides when to ask
  - review: workspace-write sandbox; what Codex doesn't trust goes to the Reviewer, then to you
  - full:  full access; Codex still asks when it judges a step risky
*/
import { existsSync } from "node:fs";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Access, PlanEntry, Question } from "../../../contracts/src/index.ts";
import { rank } from "../../../contracts/src/index.ts";
import { closesOnExit, jsonLines, killTree, marking, spawn, THREAD_ENV, threadMark, which, withCodexPath } from "../exec.ts";
import { VERSION } from "../version.ts";
import { commandRisk, ruleFor } from "../risk.ts";
import { linerTitle } from "../agent-tools.ts";
import { inFolder } from "./acp.ts";
import { dataUrl, imageType } from "./attachments.ts";
import { LINER_WAIT_SEC, ResumeFailed, saysOf, scrub, type OpenOptions, type ProviderSession, type ToolUpdate, type TurnSink, type WakeTurn } from "./types.ts";
import type { Connection } from "../addons.ts";

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

/** An agent's name from what Codex says of its thread: its role ("explorer" is "Explorer"), else its nickname. */
const agentNameOf = (role: unknown, nickname: unknown) => (typeof role === "string" && role.trim() ? role.trim().replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase()) : typeof nickname === "string" && nickname.trim() ? nickname.trim() : "Subagent");
/**
  One agent row of Codex's (a spawnAgent call) that hasn't ended: its thread's own steps by item id,
  what it last said, and the turn that sent it (`sink`), where its row is: one still at work when that
  turn ends goes on in the background, on that row, until it ends.
*/
type CodexAgent = { key: string; title: string; status: "running" | "done" | "failed"; agent: NonNullable<ToolUpdate["agent"]>; calls: string[]; said: string; sink: TurnSink };

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

/** Codex holds a thread for one writer, across every client on this CODEX_HOME (T3 Code: CodexAdapterV2.ts, isCodexActiveWriterError). */
const IN_USE = /already has an active writer/i;
const IN_USE_TEXT = "This conversation is open in another Codex client, such as the Codex CLI or an IDE extension. Codex lets one client write to it at a time. Quit that client, then send your message again.";

/** How long a closed app server gets to end by itself. */
const KILL_AFTER_MS = 2000;
/** When to look for a stopped command on Codex's list of what's running: at once, then twice more. */
const LISTED_AFTER_MS = [0, 300, 1000];

/** A request Liner Code has no answer for: JSON-RPC's "method not found". */
class Unknown extends Error {}

/** What you sent, as Codex takes it: the text, and your images as data URLs (T3 Code: CodexAdapterV2.ts, resolveCodexAttachment). */
function input(text: string, files: string[] = []) {
  const images = files.filter((f) => imageType(f)).flatMap((f) => {
    const url = dataUrl(f);
    return url ? [{ type: "image", url }] : [];
  });
  // A lone surrogate (half an emoji, from a cut) makes Codex drop the whole line and never answer (T3 Code: CodexAdapterV2.ts).
  return [{ type: "text", text: text.toWellFormed(), text_elements: [] }, ...images];
}

/** A Codex failure is a usage limit when Codex says so, by code or in words. */
export const isLimit = (e: { codexErrorInfo?: unknown; message?: string }) => e.codexErrorInfo === "usageLimitExceeded" || /usage limit|rate limit|hit your limit/i.test(e.message ?? "");

/** A short-lived app-server for one question (limits, skills), closed after. */
export async function codexAsk<T>(env: NodeJS.ProcessEnv, cwd: string, method: string, params: Json, timeout = 20000): Promise<T> {
  const c = new CodexServer(env, cwd);
  try {
    // Its start counts against the time too: an app server that never answers would hold the ask (and the
    // engine's one ask for limits at a time) and its process for good.
    return (await Promise.race([c.ready().then(() => c.request(method, params)), new Promise<never>((_, no) => setTimeout(() => no(new Error("Codex didn't answer in time.")), timeout))])) as T;
  } finally {
    c.close();
  }
}

/**
  Liner Code's own server and the connections you added, as Codex's config takes MCP servers. They
  go with the thread (thread/start, thread/resume) over stdin, never on the app server's command line.
*/
export function codexMcp(o: Pick<OpenOptions, "mcp">, connections: Connection[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Its tools approved by themselves, and under a policy of never (Read only) Codex otherwise refuses every MCP call ("MCP tool
  // call requires approval, but approval policy is never"), the sidekick's too. Most only reach this session's surfaces; Liner
  // Design's that write only write inside .liner/designs/ of this folder, on a canvas the person watches, with a copy kept each
  // turn, and the engine refuses them in a session that only reads. design_picture asks on its own card (claude.ts canUseTool).
  // In the model's first tool list, not behind Codex's tool_search: Codex 0.159 and later defer every MCP tool for an OpenAI
  // model unless the server omits them from the "deferred" surface (an older Codex ignores the key and keeps deferring).
  if (o.mcp) Object.assign(out, { "mcp_servers.liner.command": o.mcp.command, "mcp_servers.liner.args": o.mcp.args, "mcp_servers.liner.env": o.mcp.env, "mcp_servers.liner.tool_timeout_sec": LINER_WAIT_SEC, "mcp_servers.liner.default_tools_approval_mode": "approve", "mcp_servers.liner.omit_tools_from": ["deferred"] });
  // `liner` is ours, and its tools go without a card: a connection of that name is any other server (as claudeMcp has it).
  for (const c of connections) {
    const at = `mcp_servers.${c.name === "liner" ? "liner-addon" : c.name}`;
    if (c.http) Object.assign(out, { [`${at}.url`]: c.http.url }, Object.keys(c.http.headers).length ? { [`${at}.http_headers`]: c.http.headers } : {});
    else if (c.stdio) Object.assign(out, { [`${at}.command`]: c.stdio.command, [`${at}.args`]: c.stdio.args, [`${at}.env`]: c.stdio.env });
  }
  return out;
}

/** The process and its JSON-RPC plumbing. */
/** A value as `codex -c` takes it, in TOML: a string, number, true or list is written as JSON is, a table inline. */
export const toml = (v: unknown): string =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{ ${Object.entries(v)
        .filter(([, x]) => x !== undefined)
        .map(([k, x]) => `${k} = ${toml(x)}`)
        .join(", ")} }`
    : JSON.stringify(v);

export class CodexServer {
  child: ChildProcessWithoutNullStreams | null = null;
  private seq = 1;
  /** Each request with the process it went to: one that ends fails only its own. */
  private pending = new Map<number | string, { resolve: (v: Json) => void; reject: (e: Error) => void; child: ChildProcessWithoutNullStreams }>();
  private booting: Promise<void> | null = null;
  private stderr = "";
  onNotify: (method: string, params: Json) => void = () => {};
  onExit: (message: string) => void = () => {};
  onRequest: (method: string, params: Json) => Promise<Json> = async () => {
    throw new Error("Not handled");
  };
  private env: NodeJS.ProcessEnv;
  private cwd: string;
  /** Settings the server itself starts with (an API endpoint's model provider): a thread can't change the server's provider. */
  private config: Record<string, unknown>;
  constructor(env: NodeJS.ProcessEnv, cwd: string, config: Record<string, unknown> = {}) {
    this.env = env;
    this.cwd = cwd;
    this.config = config;
  }

  ready() {
    if (this.booting) return this.booting;
    const bin = which("codex", this.env);
    if (!bin) return Promise.reject(new Error("Codex isn't installed."));
    const args = ["app-server", ...Object.entries(this.config).flatMap(([k, v]) => ["-c", `${k}=${toml(v)}`])];
    // Its session's marker, for the Browser to know a dev server Codex starts as the session's (surfaces.ts).
    const thread = this.env[THREAD_ENV];
    const { stdio, done } = marking(["pipe", "pipe", "pipe"], thread ? [threadMark(thread)] : []);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(bin, args, { cwd: this.cwd, env: withCodexPath(bin, this.env), stdio: stdio as ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
    } finally {
      done();
    }
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => (this.stderr = (this.stderr + d).slice(-4000)));
    // A process closed while it was still talking: what it says now is nobody's, and an answer to it would reach the next one.
    jsonLines(child.stdout, (v) => void (this.child === child && this.onMessage(v as Msg)));
    const said = () => scrub(this.stderr.trim().split("\n").slice(-3).join("\n"), this.env);
    const fail = (err: Error) => {
      for (const [id, p] of this.pending)
        if (p.child === child) {
          this.pending.delete(id);
          p.reject(err);
        }
    };
    // It didn't start (a project folder that's gone): without a listener this throws, and "close" never comes.
    let unstarted = "";
    child.on("error", (e) => (unstarted ||= existsSync(this.cwd) ? e.message : `${this.cwd} isn't there any more.`));
    child.stdin.on("error", (e) => fail(new Error(said() || `Codex's app server stopped reading: ${e.message}`)));
    closesOnExit(child);
    child.on("close", (code) => {
      const err = new Error(said() || unstarted || `Codex's app server exited with ${code}.`);
      fail(err);
      // A process closed earlier (Stop, an update) ending now leaves the one that replaced it alone.
      if (this.child !== child) return;
      this.onExit(err.message);
      this.child = null;
      this.booting = null;
    });
    this.booting = (async () => {
      await this.request("initialize", { clientInfo: { name: "liner-code", title: "Liner Code", version: VERSION }, capabilities: { experimentalApi: true, requestAttestation: false } });
      this.notify("initialized", {});
    })().catch((e) => {
      // Refused with the process up: the next ask starts again rather than standing on this for good (T3 Code: CodexAdapterV2.ts, a failed open is discarded).
      if (this.child === child) this.close();
      throw e;
    });
    return this.booting;
  }

  private write(m: Json) {
    this.child?.stdin.write(`${JSON.stringify(m)}\n`);
  }
  request(method: string, params: Json): Promise<Json> {
    const id = this.seq++;
    const child = this.child;
    // No process to ask, or one that's going: an answer would never come (Synara: codexAppServerManager.ts,
    // "a child that stopped draining stdin must never hold" the session).
    if (!child || !child.stdin.writable) return Promise.reject(new Error("Codex's app server isn't running."));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, child });
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
      this.write({ id: m.id, error: { code: e instanceof Unknown ? -32601 : -32603, message: e instanceof Error ? e.message : String(e) } });
    }
  }

  close() {
    const c = this.child;
    this.child = null;
    // Asked again after this, it starts a process of its own rather than standing on this one's start.
    this.booting = null;
    // On Windows, with the commands it started (they leave its job by themselves).
    if (c && process.platform === "win32") killTree(c);
    else if (c) {
      c.kill();
      // One that ignores it would stay for good, unseen.
      setTimeout(() => c.kill("SIGKILL"), KILL_AFTER_MS).unref();
    }
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
  /**
    Codex's running totals at its last report, by thread (a subagent's thread reports its own), to count
    each step from; none yet in this process (T3 Code: CodexAdapterV2.ts, usageStateForThread).
  */
  private counted = new Map<string, { input: number; cached: number; output: number }>();
  /** Turns you stopped: their late turn/completed ends nothing (T3 Code: CodexAdapterV2.ts, activeTurns). */
  private stale = new Set<string>();
  /** This turn's failure, said once when the turn ends (Codex sends it as an error, then again with the turn). */
  private failure: { message?: string; codexErrorInfo?: unknown } | null = null;
  /** The thread it was to resume and couldn't: said once, on a turn that goes on, so the runtime sends the conversation so far. */
  private lost: string | undefined;
  /** The thread opening, while it does. */
  private opening: Promise<void> | null = null;
  /** The turn's start is still waiting on Codex: if Codex exits now, that request fails with the same words, which are said once, by the throw. */
  private starting = false;
  /** While a turn/start is unanswered, the turns that ended: only its answer tells this turn's end from an earlier one's (T3 Code: CodexAdapterV2.test.ts, "rejects a previous run's native turn"). */
  private early: Map<string, Json> | null = null;
  /** A /compact is the turn: Codex may run it as a turn of its own, which it says with turn/started. */
  private compacting = false;
  /** A retry's line on the timeline, while Codex retries. */
  private retry: string | null = null;
  /** Subagents' turns running, by thread (each thread on this connection is this session's: it has its own process). */
  private others = new Map<string, string>();
  /** Commands running, by item, with the process Codex says stops each: none for one that went through a card (see processOf). */
  private running = new Map<string, { threadId: string; turnId: string; processId: string | null }>();
  /** You pressed Stop: what starts now is stopped too, and what ends now wakes nothing. Until your next turn. */
  private stopping = false;
  /** The subagents this thread started: the prompt each was given, and its last words. */
  private kids = new Map<string, { prompt: string; said: string }>();
  /** Their rows, by each agent's thread, until each ends: who it is, its steps and counts, kept up whether or not a turn of yours runs. */
  private agents = new Map<string, CodexAgent>();
  /** What Codex said of an agent's thread as it started, its name, when that came before its row. */
  private agentNames = new Map<string, string>();
  /** Agents you stopped alone, until they end: an interrupted turn of theirs is their end, where the model that sent one may only have redirected it. */
  private halted = new Set<string>();
  /** What's waiting to wake the parent, if anything is; a subagent finishing meanwhile joins it. */
  private waking: { pending: boolean; details: string[] } | null = null;
  private o: OpenOptions;

  constructor(o: OpenOptions) {
    this.o = o;
    this.thread = o.resume;
    this.server = new CodexServer(o.env, o.cwd, o.config);
    this.server.onNotify = (method, params) => this.onNotify(method, params);
    this.server.onRequest = (method, params) => this.onRequest(method, params);
    this.server.onExit = (message) => {
      this.opened = false;
      // Its agents went with it.
      this.endAgents("failed");
      // Said here for a turn under way; one still opening fails with the same words itself, which would say them twice.
      if (this.sink && this.done && !this.starting) this.sink.error(message);
      this.done?.();
    };
  }

  private async open() {
    await this.server.ready();
    if (this.opened) return;
    const p = POLICY[this.o.access];
    // Liner Code's own tools and your connections, as config overrides the way `codex -c` takes them.
    const mcp = codexMcp(this.o, this.o.connections);
    // An API endpoint's model provider, when this Codex runs one.
    // A sidekick sends no agents of its own. Both keys are booleans codex-cli 0.167.0 takes (its config load
    // rejects any other type for either): agents.enabled is the one OpenAI documents, features.multi_agent the feature flag.
    const alone = this.o.sidekick ? { "agents.enabled": false, "features.multi_agent": false } : {};
    const config = Object.keys(mcp).length || this.o.config || this.o.sidekick ? { ...mcp, ...alone, ...this.o.config } : null;
    const common = { cwd: this.o.cwd, approvalPolicy: p.approval, sandbox: p.sandbox, model: this.o.model && this.o.model !== "default" ? this.o.model : null, developerInstructions: this.o.soul || null, config };
    let r: Json | null = null;
    if (this.thread) {
      // Only the thread's settings: its turns are already on the timeline (T3 Code: CodexAdapterV2.ts, resumeThread).
      const threadId = this.thread;
      const resume = () => this.server.request("thread/resume", { threadId, excludeTurns: true, ...common });
      r = await resume().catch((e: Error) => {
        // Not lost, in use: a new thread would go on without what the other client is writing.
        if (IN_USE.test(e.message)) throw new Error(IN_USE_TEXT);
        // An archived thread resumes once it's unarchived.
        return /\bsession \S+ is archived\b|\bcodex unarchive\b/i.test(e.message) ? this.server.request("thread/unarchive", { threadId }).then(resume).catch(() => null) : null;
      });
      // Answered now, whatever an earlier try said.
      this.lost = r ? undefined : threadId;
    }
    if (!r) r = await this.server.request("thread/start", { ...common, ephemeral: this.o.ephemeral || null });
    this.thread = String((r.thread as Json).id);
    this.sink?.session(this.thread);
    this.opened = true;
  }

  async turn(text: string, sink: TurnSink, signal: AbortSignal, files: string[] = []) {
    this.sink = sink;
    this.signal = signal;
    this.streamed.clear();
    this.failure = null;
    this.stopping = false;
    const stop = () => {
      this.stopping = true;
      if (this.thread && this.turnId) {
        this.stale.add(this.turnId);
        void this.server.request("turn/interrupt", { threadId: this.thread, turnId: this.turnId }).catch(() => {});
      }
      // Stop reaches everything this turn set going: the subagents' turns and the commands running, its own
      // and theirs, which turn/interrupt leaves (T3 Code: CodexAdapterV2.ts interrupts the whole lineage and terminates tracked terminals).
      for (const [threadId, turnId] of this.others) void this.server.request("turn/interrupt", { threadId, turnId }).catch(() => {});
      for (const [item, c] of this.running) if (c.turnId === this.turnId || this.others.get(c.threadId) === c.turnId) void this.endCommand(item);
      this.done?.();
    };
    // Stop ends the turn while Codex is still starting or hasn't answered its start, which may never come (as acp.ts does).
    const aborted = new Promise<null>((r) => (signal.aborted ? r(null) : signal.addEventListener("abort", () => r(null), { once: true })));
    try {
      // One opening at a time: a turn sent after a Stop mid-open stands on it rather than starting a second thread.
      await Promise.race([(this.opening ??= this.open().finally(() => (this.opening = null))), aborted]);
      // Stopped while Codex was starting: nothing was asked of it yet.
      if (signal.aborted) return;
      if (!this.thread) throw new Error("Codex didn't start a thread.");
      sink.session(this.thread);
      // A thread Codex can't resume isn't swapped for a new one in silence: the runtime sends the new one the
      // conversation so far. Said here rather than as it opens, so a Stop while it started doesn't lose it.
      if (this.lost) {
        const lost = this.lost;
        this.lost = undefined;
        throw new ResumeFailed(`Codex couldn't resume its thread ${lost}.`);
      }
      const p = POLICY[this.o.access];
      const effort = this.o.effort && !/^ultra(code|think)$/.test(this.o.effort) ? this.o.effort : null;
      const finished = new Promise<void>((resolve) => {
        this.done = resolve;
      });
      this.starting = true;
      try {
        // `/compact` is the Codex CLI's own command, not words for the model: app-server compacts on request.
        if (text.trim() === "/compact") {
          this.compacting = true;
          if (!(await Promise.race([this.server.request("thread/compact/start", { threadId: this.thread }), aborted]))) return;
        } else {
          const model = this.o.model && this.o.model !== "default" ? this.o.model : null;
          this.early = new Map();
          const start = this.server.request("turn/start", {
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
          const r = await Promise.race([start, aborted]);
          // Stopped before Codex answered: a turn it starts after all is stopped as soon as it says which, and what it sends is dropped.
          if (!r) {
            this.stopping = true;
            const threadId = this.thread;
            void start.then((x) => {
              const turnId = String((x.turn as Json | undefined)?.id ?? "");
              this.stale.add(turnId);
              return this.server.request("turn/interrupt", { threadId, turnId });
            }).catch(() => {});
            return;
          }
          this.turnId = String((r.turn as Json | undefined)?.id ?? "");
          const ended = this.early.get(this.turnId);
          this.early = null;
          if (ended) this.onNotify("turn/completed", ended);
        }
      } finally {
        this.starting = false;
        this.early = null;
      }
      signal.addEventListener("abort", stop, { once: true });
      // Stopped while the turn was starting: the signal won't say so again.
      if (signal.aborted) stop();
      await finished;
    } finally {
      signal.removeEventListener("abort", stop);
      // Agents still at work go on past this turn, which didn't wait for them: in the background, on their rows, until they end.
      for (const [kid, a] of this.agents)
        if (a.sink === sink && a.status === "running") {
          a.status = "done";
          a.agent.background = true;
          a.agent.state = "running";
          this.agentSays(kid);
        }
      this.turnId = null;
      this.sink = null;
      this.signal = null;
      this.done = null;
      this.compacting = false;
      this.retry = null;
      // A command cut off mid-run never completes here: its pending output isn't left to mark the row running again.
      for (const out of this.outputs.values()) clearTimeout(out.timer);
      this.outputs.clear();
    }
  }

  /**
    Codex takes a thread's MCP servers as it starts or resumes. Its config/mcpServer/reload rebuilds
    from config.toml, which Liner Code never writes, and keeps what a thread started with as it was;
    and a thread/resume with new settings is ignored while the thread is loaded. So a thread under
    way gets new connections by being reopened for its next turn, resuming where it was (T3 Code
    sends its servers on thread/start and thread/resume the same way: CodexAdapterV2.ts). One not
    started yet just takes them; one still opening has already sent the old ones, so it's reopened too.
  */
  async connect(connections: Connection[]) {
    if (this.opened || this.opening) return false;
    this.o.connections = connections;
    return true;
  }

  /** True once Codex took it; false when it couldn't (the turn ended first, say), and the runtime sends it next. */
  steer(text: string, files: string[] = []) {
    if (!this.thread || !this.turnId) return false;
    return this.server.request("turn/steer", { threadId: this.thread, input: input(text, files), expectedTurnId: this.turnId }).then(
      () => true,
      () => false,
    );
  }

  /**
    Stops one agent, the rest going on (T3 Code interrupts the whole lineage only on Stop). Codex's
    wait_agent returns only for an agent that finished or was shut down: an interrupt alone left the
    parent waiting out its timeout (a minute) and never told. Archiving the agent's thread shuts it
    down as close_agent does: the parent's wait returns at once, saying "shutdown", and Codex tells it
    so (codex-cli 0.167.0). A Codex that can't archive one gets the interrupt.
  */
  stopAgent(taskId: string) {
    const turnId = this.others.get(taskId);
    const a = this.agents.get(taskId);
    if (!turnId && (a?.agent.state ?? a?.status) !== "running") return false;
    const interrupt = () => (turnId ? this.server.request("turn/interrupt", { threadId: taskId, turnId }) : undefined);
    this.halted.add(taskId);
    void this.server.request("thread/archive", { threadId: taskId }).catch(interrupt).catch(() => {});
    return true;
  }

  /** A word for one agent, steering its own thread's turn as a steer does yours. */
  steerAgent(taskId: string, text: string) {
    const turnId = this.others.get(taskId);
    if (!turnId) return false;
    return this.server.request("turn/steer", { threadId: taskId, input: input(text), expectedTurnId: turnId }).then(
      () => true,
      () => false,
    );
  }

  async update(o: Pick<OpenOptions, "model" | "effort" | "access">) {
    // Model, effort and access go with each turn, so they change in place.
    Object.assign(this.o, o);
    return true;
  }

  /**
    Mid-turn: the sandbox and approval policy went with the turn as it started (turn/start), so a turn under way can't be held
    to a lower level, and is stopped; a higher one is taken, Liner Code's own answers going by it from now on.
  */
  async setAccess(access: Access) {
    const lower = rank(access) < rank(this.o.access);
    this.o.access = access;
    return lower ? "Codex runs this turn in the sandbox it started with" : true;
  }

  close() {
    // What a subagent left for a wake goes with it: run later, it would open a server nothing closes.
    if (this.waking) this.waking.pending = false;
    // Its agents go with its process.
    this.endAgents("stopped");
    this.server.close();
    this.opened = false;
    // Its process is gone without a word: a turn under way ends here.
    this.done?.();
  }

  /** Stops a command Codex runs, as turn/interrupt doesn't (an older Codex doesn't know this, and the interrupt is all it gets). */
  private async endCommand(item: string) {
    const c = this.running.get(item);
    if (!c) return;
    this.running.delete(item);
    const processId = c.processId ?? (await this.processOf(c.threadId, item).catch(() => null));
    if (processId) await this.server.request("thread/backgroundTerminals/terminate", { threadId: c.threadId, processId }).catch(() => {});
  }

  /**
    The process of a command that went through a card: its item/started has none, as it hasn't
    started, and nothing says it later (T3 Code goes by that id alone: CodexAdapterV2.ts,
    trackRunningCommandItem). Codex's list of what's running goes by item, so a dev server an
    earlier turn left running stays. A command approved a moment before Stop can take a moment to
    be on the list.
  */
  private async processOf(threadId: string, item: string) {
    for (const wait of LISTED_AFTER_MS) {
      await new Promise((r) => setTimeout(r, wait));
      let cursor: string | null | undefined;
      do {
        const page = (await this.server.request("thread/backgroundTerminals/list", { threadId, ...(cursor ? { cursor } : {}) })) as { data?: { itemId?: string; processId?: string }[]; nextCursor?: string | null };
        const found = page.data?.find((t) => t.itemId === item);
        if (found?.processId) return found.processId;
        cursor = page.nextCursor;
      } while (cursor);
    }
    return null;
  }

  /** What's at work on this connection, which goes on whether or not a turn of yours runs (and whichever thread it's on). */
  private track(method: string, p: Json) {
    const threadId = typeof p.threadId === "string" ? p.threadId : undefined;
    const item = p.item as Json | undefined;
    const own = !threadId || threadId === this.thread;
    // An agent's thread starting: what it's called (its role, or the nickname Codex gave it). Codex 0.167.0 sends
    // none for an agent's thread: its row is named from thread/read instead (see collab).
    if (method === "thread/started") {
      const t = p.thread as Json | undefined;
      if (t?.parentThreadId && typeof t.id === "string") {
        if (this.agents.has(t.id)) this.named(t.id, t.agentRole, t.agentNickname);
        else this.agentNames.set(t.id, agentNameOf(t.agentRole, t.agentNickname));
      }
    }
    if (method === "turn/started") {
      const turnId = String((p.turn as Json | undefined)?.id ?? "");
      if (own) {
        // The /compact under way: Stop can reach it now, and its end says it's over.
        if (this.compacting) this.turnId ||= turnId;
      } else if (threadId) {
        this.others.set(threadId, turnId);
        if (this.stopping) void this.server.request("turn/interrupt", { threadId, turnId }).catch(() => {});
      }
    } else if (method === "item/started" && item?.type === "commandExecution") {
      this.running.set(String(item.id), { threadId: threadId ?? this.thread ?? "", turnId: String(p.turnId ?? ""), processId: typeof item.processId === "string" ? item.processId : null });
      if (this.stopping) void this.endCommand(String(item.id));
    } else if (method === "item/completed" && item?.type === "commandExecution") {
      this.running.delete(String(item.id));
    }
    // An approval for a subagent's edit comes through this session, so its files are needed here too.
    if ((method === "item/started" || method === "item/completed") && item?.type === "fileChange") this.changes.set(String(item.id), this.pathsOf(item));
    if (method === "item/completed" && item?.type === "collabAgentToolCall" && item.tool === "spawnAgent" && own)
      for (const kid of (item.receiverThreadIds as string[] | undefined) ?? []) if (!this.kids.has(kid)) this.kids.set(kid, { prompt: short(item.prompt, 200), said: "" });
    if (!threadId || own) return;
    const kid = this.kids.get(threadId);
    if (method === "item/completed" && kid && item?.type === "agentMessage" && item.text) kid.said = String(item.text);
    if (method === "turn/completed") {
      const turn = p.turn as { id?: string; status?: string } | undefined;
      if (this.others.get(threadId) === turn?.id) this.others.delete(threadId);
      if (kid && (turn?.status === "completed" || turn?.status === "failed")) this.kidEnded(kid, turn.status);
      // Its words have been told, or it was stopped: nothing more is kept of it. Interrupted by the model that sent it
      // (send_input with interrupt), it goes on in a turn that follows, whose end may still wake the parent.
      if (kid && (turn?.status !== "interrupted" || this.cut(threadId))) this.kids.delete(threadId);
    }
  }

  /**
    Codex tells a running parent what its subagent found by itself, and never wakes one that has
    finished, so the result would go unread: the parent gets it as a turn of its own (T3 Code:
    CodexAdapterV2.ts, only direct children wake an idle root turn). Not after Stop.
  */
  private kidEnded(kid: { prompt: string; said: string }, status: string) {
    const offer = this.o.wake;
    if (!offer || this.sink || this.stopping) return;
    const detail = `Subagent ${status}: ${kid.prompt || "a subagent"}${kid.said ? `\n\nResult:\n${kid.said}` : ""}`;
    if (this.waking?.pending) return void this.waking.details.push(detail);
    const w = { pending: true, details: [detail] };
    this.waking = w;
    const wake: WakeTurn = {
      why: "a subagent finished",
      pending: () => w.pending,
      run: (sink, signal) => {
        if (!w.pending) return Promise.resolve();
        w.pending = false;
        return this.turn(w.details.join("\n\n"), sink, signal);
      },
      cancel: () => void (w.pending = false),
    };
    offer(wake);
  }

  private onNotify(method: string, p: Json) {
    this.track(method, p);
    // A turn you stopped: its late items and deltas aren't the next turn's, and its end is forgotten even between turns
    // (T3 Code: CodexAdapterV2.ts, interruptingNativeTurns). Its tokens still count.
    if (method === "turn/completed" && this.stale.delete(String((p.turn as Json | undefined)?.id))) return;
    if (typeof p.turnId === "string" && this.stale.has(p.turnId) && method !== "thread/tokenUsage/updated") return;
    // Another thread on this connection (a subagent Codex started) is at work: it counts its tokens,
    // but its words, steps and turn ends aren't this turn's (T3 Code: CodexAdapterV2.ts keeps them apart by thread).
    const other = typeof p.threadId === "string" && Boolean(this.thread) && p.threadId !== this.thread;
    // What an agent does in its own thread goes on its row, whether or not a turn of yours runs.
    if (other) this.agentWork(method, p);
    const sink = this.sink;
    if (!sink) return;
    const item = p.item as Json | undefined;
    // Only this turn's agents keep its watchdog quiet: one left from an earlier turn isn't this turn at work.
    if (other && method !== "thread/tokenUsage/updated") return void ((this.agents.get(String(p.threadId))?.sink ?? sink) === sink && sink.heard?.());
    // Codex is back after retrying: its line stops saying it's trying (T3 Code: CodexAdapterV2.ts resolves the retry on the next activity).
    if (this.retry && (method === "item/started" || method === "item/agentMessage/delta" || method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta" || method === "turn/completed")) {
      const failed = method === "turn/completed" && (p.turn as Json | undefined)?.status !== "completed";
      if (!failed) sink.notice("Codex hit a problem and got past it.", this.retry);
      this.retry = null;
    }
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
        const key = String(p.threadId ?? this.thread ?? "");
        const base = this.counted.get(key);
        this.counted.set(key, now);
        const step =
          base && now.input >= base.input && now.cached >= base.cached && now.output >= base.output
            ? { input: now.input - base.input, cached: now.cached - base.cached, output: now.output - base.output }
            : { input: last.inputTokens ?? 0, cached: last.cachedInputTokens ?? 0, output: last.outputTokens ?? 0 };
        // A subagent's context is its own, not how full this conversation is.
        const context = other ? {} : { contextTokens: last.totalTokens ?? last.inputTokens, contextWindow: u?.modelContextWindow ?? undefined };
        sink.usage({ inputTokens: step.input - step.cached, cacheReadTokens: step.cached, outputTokens: step.output, ...context });
        return;
      }
      case "error": {
        const e = (p.error ?? {}) as { message?: string; codexErrorInfo?: unknown };
        if (p.willRetry) {
          // One line for a run of retries, counting up (as claude.ts does).
          this.retry ??= `retry-${this.turnId ?? ""}`;
          return sink.notice(`${e.message ?? "Codex hit a problem"}; it's trying again.`, this.retry);
        }
        // turn/completed brings the same error again: it's said there, once (as T3 Code does).
        this.failure = e;
        // A /compact with no turn of its own: nothing more will come.
        if (this.compacting && !this.turnId) {
          this.failure = null;
          sink.error(e.message ?? "Codex couldn't compact the conversation.");
          this.done?.();
        }
        return;
      }
      case "turn/completed": {
        const turn = p.turn as { id?: string; status?: string; error?: { message?: string; codexErrorInfo?: unknown } | null } | undefined;
        // A turn you stopped ending late, or one that isn't this one: the turn running now goes on.
        if (turn?.id && (this.stale.delete(turn.id) || (this.turnId && turn.id !== this.turnId))) return;
        // Which turn this is shows once Codex answers the start: kept until then.
        if (turn?.id && this.early) return void this.early.set(turn.id, p);
        const failed = turn?.status === "interrupted" ? null : ((turn?.status === "failed" ? turn.error : null) ?? this.failure);
        this.failure = null;
        if (failed) {
          if (isLimit(failed)) sink.limited(failed.message ?? "Codex hit its usage limit.");
          else sink.error(failed.message ?? "Codex stopped with an error.");
        } else if (turn?.status === "failed") sink.error("Codex stopped with an error.");
        this.done?.();
        return;
      }
      // A compaction asked for with /compact: done whether or not it ran as a turn of its own. One Codex
      // makes by itself mid-turn ends nothing, and its contextCompaction item says so (Synara:
      // codexAppServerManager.ts settles on it only when no turn is active).
      case "thread/compacted":
        if (!this.compacting || this.turnId) return;
        sink.notice("Codex compacted the conversation.");
        this.done?.();
        return;
    }
  }

  private onItem(it: Json, done: boolean) {
    const sink = this.sink!;
    const id = String(it.id);
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
        const paths = this.pathsOf(it);
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
      case "collabAgentToolCall":
        this.collab(it, sink);
        return;
      // Which model an agent runs on, once Codex has made it.
      case "subAgentActivity": {
        const a = this.agents.get(String(it.agentThreadId));
        if (a && typeof it.model === "string" && it.model) {
          a.agent.model = `${this.o.provider ?? "codex"}:${it.model}`;
          this.agentSays(String(it.agentThreadId));
        }
        return;
      }
      // A plan written the way Codex's plan mode has it comes out of the message and only here: it reads as what the model said.
      case "plan":
        if (done && it.text) sink.text(String(it.text).trim(), id);
        return;
      case "contextCompaction":
        if (done) sink.notice("Codex compacted the conversation to make room.");
        return;
      case "imageGeneration": {
        const failed = it.status === "failed" || Boolean(it.failure);
        sink.tool({ key: id, tool: "image_generation", toolKind: "other", title: "Make an image", input: (it.revisedPrompt as string | null | undefined) ?? undefined, output: (it.savedPath as string | null | undefined) ?? undefined, status: !done ? "running" : failed ? "failed" : "done" });
        return;
      }
    }
  }

  /**
    An agent call of Codex's (collabAgentToolCall). spawnAgent sends one off: a row for each new
    thread, in `sink`'s turn, under the agent that sent it when one did. The others (wait, sendInput,
    closeAgent…) say how those agents stand, which goes on their rows.
  */
  private collab(it: Json, sink: TurnSink) {
    const kids = ((it.receiverThreadIds as string[] | undefined) ?? []).filter((k) => typeof k === "string");
    if (it.tool === "spawnAgent") {
      const prompt = typeof it.prompt === "string" ? it.prompt.trim() : "";
      const parentKey = this.agents.get(String(it.senderThreadId))?.key;
      for (const kid of kids) {
        if (this.agents.has(kid)) continue;
        const name = this.agentNames.get(kid) ?? "Subagent";
        this.agentNames.delete(kid);
        const task = prompt ? short(prompt, 80) : undefined;
        this.agents.set(kid, {
          key: kids.length > 1 ? `${String(it.id)}:${kid}` : String(it.id),
          title: `${name}: ${task ?? "a task"}`,
          status: "running",
          agent: { name, task, brief: prompt ? prompt.slice(0, 4000) : undefined, model: typeof it.model === "string" && it.model ? `${this.o.provider ?? "codex"}:${it.model}` : undefined, taskId: kid, steerable: true, steps: [], ...(parentKey ? { parentKey } : {}) },
          calls: [],
          said: "",
          sink,
        });
        this.agentSays(kid);
        // Its name: Codex 0.167.0 tells only the model that sent it (the spawn's output), and says it of the agent's
        // thread, its nickname or role, when asked (T3 Code: CodexAdapterV2.ts reads a child's thread the same way).
        if (name === "Subagent")
          void this.server.request("thread/read", { threadId: kid, includeTurns: false }).then(
            (r) => {
              const t = r.thread as Json | undefined;
              if (t?.id === kid) this.named(kid, t.agentRole, t.agentNickname);
            },
            () => {},
          );
      }
    }
    // Where Codex says how they stand (a wait that returned, a close), what they said comes with it.
    const states = (it.agentsStates ?? {}) as Record<string, { status?: string; message?: string | null } | undefined>;
    for (const [kid, st] of Object.entries(states)) {
      const a = this.agents.get(kid);
      if (!a || !st) continue;
      if (st.message) a.said = st.message;
      const ended = st.status === "completed" ? "done" : st.status === "errored" || st.status === "notFound" ? "failed" : st.status === "shutdown" || (st.status === "interrupted" && this.cut(kid)) ? "stopped" : null;
      if (ended) this.agentEnded(kid, ended);
    }
  }

  /** An agent's name, as Codex says it of its thread: its row is named so. */
  private named(kid: string, role: unknown, nickname: unknown) {
    const a = this.agents.get(kid);
    const name = agentNameOf(role, nickname);
    if (!a || name === "Subagent" || a.agent.name === name) return;
    a.agent.name = name;
    a.title = `${name}: ${a.agent.task ?? "a task"}`;
    this.agentSays(kid);
  }

  /** An agent's own thread at work, on its row, whether or not a turn runs: its steps, its words, its tokens, its turn's end. */
  private agentWork(method: string, p: Json) {
    const kid = String(p.threadId);
    const a = this.agents.get(kid);
    if (!a) return;
    if (method === "item/started" || method === "item/completed") {
      const it = p.item as Json | undefined;
      if (!it) return;
      const done = method === "item/completed";
      // An agent it sends off in turn: a row of its own, under this one, in the same turn.
      if (it.type === "collabAgentToolCall") return this.collab(it, a.sink);
      if (it.type === "agentMessage") {
        if (done && it.text) {
          a.said = String(it.text);
          a.agent.now = short(String(it.text).split("\n").find((l) => l.trim()) ?? "", 120);
          this.agentSays(kid);
        }
        return;
      }
      const step = this.stepOf(it, done);
      if (!step) return;
      const id = String(it.id);
      const steps = [...(a.agent.steps ?? [])];
      const i = a.calls.indexOf(id);
      if (i >= 0) steps[i] = { ...steps[i], status: step.status };
      else {
        steps.push(step);
        a.calls.push(id);
        a.agent.tools = (a.agent.tools ?? 0) + 1;
        if (steps.length > 40) {
          steps.splice(0, steps.length - 40);
          a.calls.splice(0, a.calls.length - 40);
        }
      }
      a.agent.steps = steps;
      if (!done) a.agent.now = step.title;
      this.agentSays(kid);
    } else if (method === "thread/tokenUsage/updated") {
      const t = ((p.tokenUsage as Json | undefined)?.total ?? {}) as { totalTokens?: number; inputTokens?: number; outputTokens?: number };
      const tokens = t.totalTokens ?? (t.inputTokens ?? 0) + (t.outputTokens ?? 0);
      if (tokens > 0) {
        a.agent.tokens = tokens;
        this.agentSays(kid);
      }
    } else if (method === "turn/completed") {
      const status = (p.turn as { status?: string } | undefined)?.status;
      // Interrupted by the model that sent it (send_input with interrupt), it goes on with what it was sent, in a turn that follows.
      if (status === "interrupted" && !this.cut(kid)) return;
      this.agentEnded(kid, status === "failed" ? "failed" : status === "interrupted" ? "stopped" : "done");
    }
  }

  /** Whether an agent's interrupted turn was Stop's: yours alone (stopAgent), or the whole turn's. */
  private cut(kid: string) {
    return this.stopping || this.halted.has(kid);
  }

  /**
    An agent's work ended: what it last said is its report. Stopped, its call didn't fail; one in the
    background had its call done already, so it's the agent that ends. Nothing more comes about it:
    its row ends where it started, and it's let go.
  */
  private agentEnded(kid: string, how: "done" | "failed" | "stopped") {
    const a = this.agents.get(kid);
    if (!a || (a.agent.state ?? a.status) !== "running") return;
    if (a.agent.state === "running") a.agent.state = how;
    else {
      a.status = how === "failed" ? "failed" : "done";
      if (how === "stopped") a.agent.state = "stopped";
    }
    if (a.said.trim()) a.agent.report = a.said.trim().slice(0, 8000);
    a.agent.now = undefined;
    a.agent.steps = (a.agent.steps ?? []).map((x) => (x.status === "running" ? { ...x, status: how === "failed" ? "failed" : "done" } : x));
    this.agentSays(kid);
    this.agents.delete(kid);
    this.halted.delete(kid);
  }

  /** Its process is gone, or closed: its agents' rows end with it. */
  private endAgents(how: "failed" | "stopped") {
    for (const [kid, a] of [...this.agents]) {
      a.said = "";
      this.agentEnded(kid, how);
    }
    this.agents.clear();
    this.agentNames.clear();
    this.halted.clear();
  }

  /** An agent's row as it stands now, in the turn that sent it. */
  private agentSays(kid: string) {
    const a = this.agents.get(kid);
    if (!a) return;
    a.sink.tool({ key: a.key, tool: "spawn_agent", toolKind: "task", title: a.title, input: a.agent.brief, status: a.status, agent: { ...a.agent } });
  }

  /** An agent's own call as one of its steps, said the way its row would say it. */
  private stepOf(it: Json, done: boolean): { title: string; toolKind: "exec" | "edit" | "other" | "web"; status: "running" | "done" | "failed"; path?: string } | null {
    const failed = done && (it.status === "failed" || it.status === "declined" || (typeof it.exitCode === "number" && it.exitCode !== 0));
    const status = !done ? "running" : failed ? "failed" : "done";
    switch (it.type) {
      case "commandExecution":
        return { title: `Run ${short(unwrap(String(it.command ?? "")), 60)}`, toolKind: "exec", status };
      case "fileChange": {
        const paths = this.pathsOf(it);
        return { title: `Edit ${paths.slice(0, 2).join(", ")}${paths.length > 2 ? ` and ${paths.length - 2} more` : ""}`, toolKind: "edit", status, ...(paths[0] ? { path: paths[0] } : {}) };
      }
      case "mcpToolCall":
        return { title: it.server === "liner" ? linerTitle(String(it.tool), it.arguments) : `${it.server} · ${it.tool}`, toolKind: "other", status };
      case "webSearch":
        return { title: `Search the web for ${short(it.query, 50)}`, toolKind: "web", status };
      default:
        return null;
    }
  }

  /** A file change's paths, from the project's folder. */
  private pathsOf(it: Json) {
    return ((it.changes as { path: string }[] | undefined) ?? []).map((c) => c.path.replace(`${this.o.cwd}/`, ""));
  }

  /** Codex asks: a command, an edit, or a question. Each becomes a card and waits for you. */
  private async onRequest(method: string, p: Json): Promise<Json> {
    // A turn you stopped has nothing to ask, here or in the turn after it.
    const stopped = typeof p.turnId === "string" && this.stale.has(p.turnId);
    const sink = stopped ? null : this.sink;
    const signal = this.signal;
    // No turn to ask in (a subagent still at work after the turn ended): refused, in the shape each method takes.
    if (!sink || !signal) {
      if (method === "item/permissions/requestApproval") return { permissions: {}, scope: "turn" };
      if (method === "execCommandApproval" || method === "applyPatchApproval") return { decision: "abort" };
      if (method === "item/tool/requestUserInput") return { answers: {} };
      if (method === "mcpServer/elicitation/request") return { action: "decline", content: null, _meta: null };
      return method.includes("requestApproval") ? { decision: "decline" } : {};
    }
    if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") {
      const command = unwrap(Array.isArray(p.command) ? (p.command as string[]).join(" ") : String(p.command ?? ""));
      // What it asks beyond the command: a host to reach (with no command at all, for a managed network's
      // ask), or more access for this command. Allow grants it, so it's shown, it's yours to read, and no
      // rule or read-only command passes it along.
      const net = p.networkApprovalContext as { host?: string; protocol?: string } | null | undefined;
      const more = p.additionalPermissions ? JSON.stringify(p.additionalPermissions) : "";
      const fields = command ? [{ label: "Command", value: command }] : [];
      if (net) fields.push({ label: "Reach", value: `${net.host ?? "the network"}${net.protocol ? ` (${net.protocol})` : ""}` });
      if (more) fields.push({ label: "More access", value: short(more, 400) });
      if (p.cwd) fields.push({ label: "Runs in", value: String(p.cwd) });
      if (p.reason) fields.push({ label: "Why", value: String(p.reason) });
      const extra = Boolean(net || more);
      const title = command ? `Run ${short(command, 60)}` : net ? `Let Codex reach ${net.host ?? "the network"}` : "Run a command";
      // Why, from what it asks beyond the command: a host to reach, more access than its sandbox gives.
      const why = [...(net ? [{ kind: "network" as const, text: `it reaches ${net.host ?? "the network"}` }] : []), ...(more ? [{ kind: "outside" as const, text: "it asks for more access than its sandbox gives" }] : [])];
      const says = command ? saysOf(p.reason) : undefined;
      const a = await sink.approve({ key: p.itemId ? String(p.itemId) : undefined, tool: "shell", title, description: (p.reason as string | undefined) ?? undefined, risk: extra ? "high" : commandRisk(command), fields, rule: extra ? undefined : ruleFor(command), ...(says ? { says } : {}), ...(why.length ? { why } : {}) }, signal);
      return method === "execCommandApproval" ? { decision: a.allow ? "approved" : "denied" } : { decision: a.allow ? "accept" : "decline" };
    }
    if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
      const paths = this.changes.get(String(p.itemId)) ?? Object.keys((p.fileChanges as Json | undefined) ?? {});
      // An edit outside the project, a folder granted outside it, or an edit that names no file is yours each
      // time: high, so Auto and the Reviewer leave it to you, and no rule (as acp.ts does; T3 Code: provider-acp clientPolicy.ts).
      const stray = [...paths, ...(p.grantRoot ? [String(p.grantRoot)] : [])].find((x) => !inFolder(this.o.cwd, x));
      const loose = Boolean(stray) || !paths.length;
      const why = stray ? `${stray} is outside the project.` : !paths.length ? "Codex didn't say which files this changes." : undefined;
      const description = [why, p.reason as string | undefined].filter(Boolean).join("\n\n") || undefined;
      const because = stray ? [{ kind: "outside" as const, text: `it changes ${stray}, outside the project` }] : !paths.length ? [{ kind: "changes" as const, text: "Codex didn't say which files it changes" }] : [];
      const a = await sink.approve({ key: p.itemId ? String(p.itemId) : undefined, tool: "apply_patch", title: `Edit ${paths.slice(0, 3).join(", ") || "files"}`, description, risk: loose ? "high" : "medium", fields: paths.map((x) => ({ label: "File", value: x })).concat(p.grantRoot ? [{ label: "Write access to", value: String(p.grantRoot) }] : []), rule: loose ? undefined : "Edit", ...(because.length ? { why: because } : {}) }, signal);
      return method === "applyPatchApproval" ? { decision: a.allow ? "approved" : "denied" } : { decision: a.allow ? "accept" : "decline" };
    }
    if (method === "item/tool/requestUserInput") {
      const qs = (p.questions as { id: string; header: string; question: string; options: { label: string; description: string }[] | null }[] | undefined) ?? [];
      const questions: Question[] = qs.map((q) => ({ question: q.question, header: q.header, options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description })) }));
      // Optional: a routine has nobody to answer, and a question left waiting would hold it for good.
      const answers = await sink.ask(questions, signal, { optional: true });
      return { answers: Object.fromEntries(qs.map((q) => [q.id, { answers: answers?.[q.question] ? [answers[q.question]] : [] }])) };
    }
    if (method === "item/permissions/requestApproval") {
      // More access for the rest of the turn: granted as asked, or nothing (T3 Code: CodexAdapterV2.ts, permissionsResponseFromDecision).
      const want = (p.permissions ?? {}) as { network?: { enabled?: boolean | null } | null; fileSystem?: { read?: string[] | null; write?: string[] | null; entries?: { access?: string; path?: { path?: string; pattern?: string } }[] | null } | null };
      // Codex is moving from the read and write lists to `entries`, which also carry globs and special paths (T3 Code: CodexAdapterV2.ts).
      const named = (e: { path?: { path?: string; pattern?: string } }) => e.path?.path ?? e.path?.pattern ?? JSON.stringify(e.path);
      const entries = want.fileSystem?.entries ?? [];
      // Codex sends a path in both while it moves over: each shows once.
      const paths = (access: string, old?: string[] | null) => [...new Set([...(old ?? []), ...entries.filter((e) => e.access === access).map(named)])];
      const write = paths("write", want.fileSystem?.write);
      const read = paths("read", want.fileSystem?.read);
      const listed = [...(want.network?.enabled ? [{ label: "Network", value: "Access the network" }] : []), ...write.map((x) => ({ label: "Write access to", value: x })), ...read.map((x) => ({ label: "Read access to", value: x })), ...paths("deny").map((x) => ({ label: "No access to", value: x }))];
      const odd = entries.some((e) => e.access !== "write" && e.access !== "read" && e.access !== "deny");
      // Allow grants what was asked, so nothing asked for goes unseen, even in a shape not known here.
      const fields = listed.length && !odd ? listed : [...listed, { label: "Asked for", value: JSON.stringify(p.permissions ?? {}) }];
      // Writing outside the project is a step out of its sandbox: yours, not the Reviewer's. A glob or a special path can't be told to be inside.
      const wide = !listed.length || odd || write.some((x) => /[*?{[]/.test(x) || !inFolder(this.o.cwd, x));
      const a = await sink.approve({ key: p.itemId ? String(p.itemId) : undefined, tool: "permissions", title: "Grant Codex more access", description: (p.reason as string | undefined) ?? undefined, risk: wide ? "high" : "medium", fields, why: [{ kind: "outside", text: "it asks for more access than its sandbox gives" }] }, signal);
      return a.allow ? { permissions: p.permissions ?? {}, scope: "turn" } : { permissions: {}, scope: "turn" };
    }
    if (method === "mcpServer/elicitation/request") {
      const meta = (p._meta ?? {}) as { codex_approval_kind?: string; tool_params_display?: { display_name?: string; name: string; value: unknown }[] };
      // Liner Code's own tools only reach this session's Browser, the Simulator and its timeline.
      if (this.o.mcp && p.serverName === "liner") return { action: "accept", content: {}, _meta: null };
      // Another server's tool call asks like any other step; anything else it wants filled in, Liner Code can't show yet.
      if (meta.codex_approval_kind !== "mcp_tool_call") return { action: "decline", content: null, _meta: null };
      const fields = (meta.tool_params_display ?? []).slice(0, 4).map((x) => ({ label: x.display_name || x.name, value: short(typeof x.value === "string" ? x.value : JSON.stringify(x.value), 200) }));
      const a = await sink.approve({ tool: String(p.serverName), title: String(p.message ?? "Use a tool"), risk: "medium", fields, rule: `${p.serverName}` }, signal);
      return { action: a.allow ? "accept" : "decline", content: a.allow ? {} : null, _meta: null };
    }
    throw new Unknown(`Liner Code doesn't answer ${method} yet.`);
  }
}
