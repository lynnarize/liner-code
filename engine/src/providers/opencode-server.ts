/*
  OpenCode through a shared `opencode serve` HTTP + SSE daemon (V2 `/api/*`), as T3 Code drives
  OpenCode 2. One daemon is pooled per binary + provider config so every session and every native
  subagent share a single process (~a few MB per worker instead of spawning a separate CLI process),
  with zero cold-start on subagents.

  Unlike `opencode acp`, where child sessions' permission requests are dropped, the daemon's
  `/api/event` SSE stream delivers `permission.asked`, `form.created`, tool calls, text and usage
  for both the parent session and every descendant subagent (`parentID`), so Liner Code enforces
  its access levels, `.env` and outside-project guards, and `guardDestructive` on every worker
  while letting OpenCode run native in-process subagents freely.

  Older OpenCode binaries that lack the V2 `/api/info` + `/api/session` HTTP API fall back to
  `opencode acp` cleanly on first open.
*/
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Access, AgentStep, Question, ToolKind } from "../../../contracts/src/index.ts";
import { linerTitle } from "../agent-tools.ts";
import { killTree, RUN_ENV, spawn, which } from "../exec.ts";
import { TOOLS } from "../liner-tools.ts";
import { commandRisk, isDestructive, readsOnly, ruleFor } from "../risk.ts";
import { commandWords, fromFolder, gitInside, inFolder, leaves, linerCall, plainOutput, secretFile } from "./acp.ts";
import { LINER_WAIT_SEC, ResumeFailed, type OpenOptions, type ProviderSession, type ToolUpdate, type TurnSink } from "./types.ts";

type Json = Record<string, unknown>;
type PermRule = { action: string; resource: string; effect: "allow" | "deny" | "ask" };
type ModelRef = { providerID: string; id: string; variant?: string };
type OpenCodeAgent = {
  id: string;
  key: string;
  title: string;
  status: "running" | "done" | "failed" | "stopped";
  createdAt: number;
  idleMisses: number;
  agent: NonNullable<ToolUpdate["agent"]>;
  steps: AgentStep[];
  stepAt: Map<string, number>;
  callNames: Map<string, string>;
  said: string;
  sink: TurnSink;
};

/** How long `opencode serve` has to print its listening address and answer `/api/info`. */
const START_MS = 25_000;
/** How long an idle daemon with zero registered sessions stays alive before shutting down. */
let daemonIdleMs = 60_000;
export const setDaemonIdleMs = (ms: number) => void (daemonIdleMs = ms);
/** Maximum characters kept per tool output or subagent report. */
const OUTPUT_MAX = 20_000;
const REPORT_MAX = 6_000;

/** OpenCode's read-only note/metadata tools that run without prompting. */
const OPENCODE_NOTES = ["list", "lsp", "question", "skill", "todowrite"];
/** OpenCode 2's built-in tools that mutate external state without asking; always denied. */
const OPENCODE_UNASKED = ["opencode?worktree_*", "opencode?worktree_create", "opencode?worktree_remove", "worktree_*", "opencode?session_move", "opencode?schedule_*", "opencode?artifact_*", "opencode?watch_*"];
/** OpenCode tools denied during a read-only security scan. */
const OPENCODE_SCAN_DENIED = ["webfetch", "websearch", "codesearch"];

const ACTION_KIND: Record<string, ToolKind> = {
  read: "read",
  glob: "search",
  grep: "search",
  list: "search",
  edit: "edit",
  write: "edit",
  patch: "edit",
  multiedit: "edit",
  delete: "edit",
  bash: "exec",
  shell: "exec",
  webfetch: "fetch",
  websearch: "web",
  codesearch: "search",
  task: "task",
  subagent: "task",
};

const COMPACT = /^\/compact\s*$/;
const opencodeOutputs = (env: NodeJS.ProcessEnv) => join(env.XDG_DATA_HOME || join(env.HOME || homedir(), ".local", "share"), "opencode", "tool-output");

/** Thrown when the installed `opencode` binary does not speak the V2 `/api/*` HTTP server API. */
export class NoV2Server extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoV2Server";
  }
}

/** Splits an OpenCode model id ("provider/model") + optional effort into a V2 `Model.Ref`. */
export function parseModelRef(model?: string, effort?: string): ModelRef | undefined {
  const m = (model ?? "").trim();
  if (!m || m === "default") return undefined;
  const slash = m.indexOf("/");
  if (slash <= 0 || slash === m.length - 1) return undefined;
  const variant = effort && effort !== "default" ? effort.trim() : undefined;
  return { providerID: m.slice(0, slash), id: m.slice(slash + 1), ...(variant ? { variant } : {}) };
}

/** Strips a redundant leading `cd "<cwd>" && ` prefix so narrow step rows show the actual command. */
export function stripLeadingCd(command: string, cwd: string): string {
  const m = command.trimStart().match(/^cd\s+(?:"([^"]+)"|'([^']+)'|((?:\\.|[^\s;&])+))\s*(?:&&|;)\s*([\s\S]+)$/);
  if (!m) return command;
  const rawDir = m[1] ?? m[2] ?? (m[3] ?? "").replace(/\\ /g, " ");
  const norm = (p: string) => p.replace(/\/+$/, "");
  return norm(rawDir) === norm(cwd) ? m[4].trimStart() : command;
}

/**
  Builds an OpenCode V2 `Permission.Ruleset` (last matching rule wins) for one session:
  - Everything defaults to `ask` so Liner Code's permission handler enforces the live access level.
  - Other sessions' Liner MCP servers (`liner_*`) are denied; only this session's `serverName` is allowed.
  - Code Mode (`execute*`) and unasked mutators (`OPENCODE_UNASKED`) are always denied.
  - Native in-process `subagent*` / `task*` are allowed on normal sessions (child permissions route
    back through the shared SSE stream) and denied on sidekicks, side chats, and sealed scans.
*/
export function opencodeSessionRules(o: Pick<OpenOptions, "sidekick" | "side" | "scan" | "sealed" | "swarm">, serverName?: string): PermRule[] {
  const rules: PermRule[] = [
    { action: "*", resource: "*", effect: "ask" },
    ...OPENCODE_NOTES.map((action): PermRule => ({ action, resource: "*", effect: "allow" })),
    // Isolate per-session Liner MCP servers on a shared daemon: deny every other session's `liner_*`, then allow ours.
    { action: "liner_*", resource: "*", effect: "deny" },
    ...(serverName ? TOOLS.map((t): PermRule => ({ action: `${serverName}_${t.name}`, resource: "*", effect: "allow" })) : []),
    { action: "execute*", resource: "*", effect: "deny" },
    ...OPENCODE_UNASKED.map((action): PermRule => ({ action, resource: "*", effect: "deny" })),
  ];
  if (o.scan) for (const action of OPENCODE_SCAN_DENIED) rules.push({ action, resource: "*", effect: "deny" });
  const subEffect: PermRule["effect"] = o.sidekick || o.side || o.scan || o.sealed || o.swarm ? "deny" : "allow";
  rules.push({ action: "task*", resource: "*", effect: subEffect });
  rules.push({ action: "subagent*", resource: "*", effect: subEffect });
  return rules;
}

/**
  Builds daemon-level `OPENCODE_CONFIG_CONTENT` preserving any endpoint provider config while enforcing
  ask-by-default permissions. Per-session rules (`opencodeSessionRules`) handle `liner_*` isolation
  and `task*`/`subagent*` gating — never put `"liner_*": "deny"` or `"subagent*": "allow"` here
  because OpenCode v2 config permissions override session permissions.
*/
export function daemonConfigContent(env: NodeJS.ProcessEnv): string {
  let base: Json = {};
  if (env.OPENCODE_CONFIG_CONTENT) {
    try {
      const parsed = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) base = parsed as Json;
    } catch {
      // Malformed env config falls back to base defaults.
    }
  }
  const permission: Json = {
    "*": "ask",
    ...Object.fromEntries(OPENCODE_NOTES.map((n) => [n, "allow"])),
    "execute*": "deny",
    ...Object.fromEntries(OPENCODE_UNASKED.map((n) => [n, "deny"])),
  };
  return JSON.stringify({ ...base, permission });
}

/** Stable pool key so sessions with the same OpenCode binary and provider/auth config share one daemon. */
function poolKeyFor(bin: string, env: NodeJS.ProcessEnv): string {
  const h = createHash("sha256");
  h.update(bin);
  for (const k of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "OPENCODE_CONFIG_CONTENT", "OPENCODE_AUTH_CONTENT", "OPENCODE_API_KEY", "LINER_ENDPOINT_KEY", "OPENCODE_DB"]) {
    h.update("\0");
    h.update(k);
    h.update("=");
    h.update(env[k] ?? "");
  }
  return h.digest("hex").slice(0, 24);
}

/** Extracts display text from OpenCode V2 `Tool.Content[]` blocks. */
function toolContentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => {
      if (!c || typeof c !== "object") return "";
      const o = c as Json;
      if (o.type === "text" && typeof o.text === "string") return o.text;
      if (typeof o.uri === "string") return `[file: ${o.uri}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function short(s: unknown, max = 80) {
  const line = String(s ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** One shared `opencode serve` process and its persistent `/api/event` SSE dispatcher. */
export class OpenCodeDaemon {
  readonly url: string;
  private auth: string;
  private child: ChildProcessWithoutNullStreams | null;
  private sessions = new Map<string, OpenCodeServerSession>();
  /** Child session id -> immediate parent session id (traced up to a registered root session). */
  private parents = new Map<string, string>();
  /** Unknown sessionIDs currently being probed via GET /api/session/:id to recover child lineage. */
  private probing = new Map<string, Promise<void>>();
  /** Recently stopped/closed session IDs (and their known descendants) whose late inbox wake-ups must be interrupted immediately. */
  private stopping = new Map<string, NodeJS.Timeout>();
  private sseAbort: AbortController | null = null;
  private sseGeneration = 0;
  private sseReady: Promise<void>;
  private markSseReady: (() => void) | null = null;
  private idleTimer: NodeJS.Timeout | undefined;
  private closed = false;
  private onDead?: () => void;

  private constructor(url: string, password: string, child: ChildProcessWithoutNullStreams | null, onDead?: () => void) {
    this.url = url.replace(/\/+$/, "");
    this.auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
    this.child = child;
    this.onDead = onDead;
    this.sseReady = new Promise<void>((resolve) => {
      this.markSseReady = resolve;
    });
    if (child) {
      child.once("exit", () => {
        if (this.closed) return;
        this.closed = true;
        this.markSseReady?.();
        this.markSseReady = null;
        this.sseAbort?.abort();
        for (const s of this.sessions.values()) s.onDaemonLost();
        this.sessions.clear();
        this.parents.clear();
        this.onDead?.();
      });
    }
    this.startSse();
  }

  /** Waits until the daemon's `/api/event` SSE stream is connected so early turn events are never missed. */
  async waitSse(timeoutMs = 5000): Promise<void> {
    if (!this.markSseReady) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.sseReady, new Promise<void>((r) => (timer = setTimeout(r, timeoutMs)))]);
    clearTimeout(timer);
  }

  /** Connects to an already-running OpenCode V2 HTTP server (used by tests and external servers). */
  static async connect(url: string, password: string): Promise<OpenCodeDaemon> {
    const clean = url.replace(/\/+$/, "");
    const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
    const r = await fetch(`${clean}/api/info`, { headers: { authorization: auth, accept: "application/json" }, signal: AbortSignal.timeout(5000), redirect: "error" }).catch((e) => {
      throw new NoV2Server(`OpenCode server didn't answer /api/info: ${e instanceof Error ? e.message : String(e)}`);
    });
    const info = r.ok ? await r.json().catch(() => null) : null;
    if (!info || typeof info !== "object" || !("version" in info)) throw new NoV2Server(`OpenCode server at ${clean} doesn't speak the V2 HTTP API (status ${r.status}).`);
    return new OpenCodeDaemon(clean, password, null);
  }

  /** Spawns a headless `opencode serve --port 0 --hostname 127.0.0.1` daemon and verifies its V2 `/api/info`. */
  static async spawn(bin: string, env: NodeJS.ProcessEnv, onDead?: () => void): Promise<OpenCodeDaemon> {
    const password = randomBytes(24).toString("hex");
    const mark = randomBytes(12).toString("hex");
    const childEnv: NodeJS.ProcessEnv = {
      ...env,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_CONFIG_CONTENT: daemonConfigContent(env),
      [RUN_ENV]: mark,
    };
    const child = spawn(bin, ["serve", "--port", "0", "--hostname", "127.0.0.1"], { env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let url = "";
    try {
      url = await new Promise<string>((resolveUrl, rejectUrl) => {
        const timer = setTimeout(() => rejectUrl(new NoV2Server(`opencode serve didn't start in ${Math.round(START_MS / 1000)}s: ${out.slice(-300)}`)), START_MS);
        const onData = (chunk: Buffer) => {
          out += chunk.toString("utf8");
          if (out.length > 16_000) out = out.slice(-16_000);
          const m = /https?:\/\/127\.0\.0\.1:\d+/.exec(out);
          if (m) {
            clearTimeout(timer);
            resolveUrl(m[0]);
          }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.once("error", (err) => (clearTimeout(timer), rejectUrl(new NoV2Server(`Couldn't start opencode serve: ${err.message}`))));
        child.once("exit", (code) => (clearTimeout(timer), rejectUrl(new NoV2Server(`opencode serve exited (${code ?? "signal"}): ${out.slice(-300)}`))));
      });
      const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
      const r = await fetch(`${url}/api/info`, { headers: { authorization: auth, accept: "application/json" }, signal: AbortSignal.timeout(5000), redirect: "error" });
      const bodyText = await r.text().catch(() => "");
      const info = (() => { try { return r.ok ? JSON.parse(bodyText) : null; } catch { return null; } })();
      if (!info || typeof info !== "object" || !("version" in info)) throw new NoV2Server(`opencode serve doesn't expose V2 /api/info (status ${r.status}, body: ${bodyText.slice(0, 120)}).`);
      return new OpenCodeDaemon(url, password, child, onDead);
    } catch (e) {
      killTree(child);
      throw e;
    }
  }

  get alive() {
    return !this.closed;
  }

  register(sessionID: string, session: OpenCodeServerSession) {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.clearStopping(sessionID);
    this.sessions.set(sessionID, session);
  }

  recordParent(childID: string, parentID: string) {
    if (childID && parentID && childID !== parentID) this.parents.set(childID, parentID);
  }

  /** Marks a session tree as stopping so late `<subagent state="cancelled">` wake-ups are interrupted instead of running orphaned. */
  markStopping(sessionID: string, children: Iterable<string> = []) {
    const mark = (id: string) => {
      if (!id) return;
      clearTimeout(this.stopping.get(id));
      const t = setTimeout(() => void this.stopping.delete(id), 30_000);
      t.unref?.();
      this.stopping.set(id, t);
    };
    mark(sessionID);
    for (const c of children) mark(c);
  }

  clearStopping(sessionID: string) {
    const t = this.stopping.get(sessionID);
    if (t) clearTimeout(t);
    this.stopping.delete(sessionID);
  }

  /** Returns true if `sessionID` or any ancestor in `parents` was recently stopped/closed by Liner Code. */
  isStopping(sessionID: string): boolean {
    let cur: string | undefined = sessionID;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (this.stopping.has(cur)) return true;
      seen.add(cur);
      cur = this.parents.get(cur);
    }
    return false;
  }

  unregister(sessionID: string) {
    this.sessions.delete(sessionID);
    for (const [kid] of this.parents) {
      if (this.rootOf(kid) === undefined && !this.isStopping(kid)) this.parents.delete(kid);
    }
    if (this.sessions.size === 0 && !this.closed && this.child && daemonIdleMs > 0) {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        if (this.sessions.size === 0) this.shutdown();
      }, daemonIdleMs);
      this.idleTimer.unref?.();
    }
  }

  /** Traces `sessionID` (or any nested `parentID` chain) to its owning root `OpenCodeServerSession`. */
  rootOf(sessionID: string): { session: OpenCodeServerSession; isChild: boolean; parentID?: string } | undefined {
    const direct = this.sessions.get(sessionID);
    if (direct) return { session: direct, isChild: false };
    let cur = sessionID;
    const seen = new Set<string>();
    while (this.parents.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const parent = this.parents.get(cur)!;
      const root = this.sessions.get(parent);
      if (root) return { session: root, isChild: true, parentID: this.parents.get(sessionID) };
      cur = parent;
    }
    return undefined;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; data?: T; text: string }> {
    if (this.closed) throw new Error("OpenCode server closed.");
    const r = await fetch(`${this.url}${path}`, {
      method,
      headers: {
        authorization: this.auth,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal,
      redirect: "error",
    });
    const text = r.status === 204 ? "" : await r.text().catch(() => "");
    let data: T | undefined;
    if (text && (text.startsWith("{") || text.startsWith("["))) {
      try {
        data = JSON.parse(text) as T;
      } catch {}
    }
    return { status: r.status, data, text };
  }

  private startSse() {
    const loop = async () => {
      let backoff = 250;
      while (!this.closed) {
        const ac = new AbortController();
        this.sseAbort = ac;
        try {
          const r = await fetch(`${this.url}/api/event`, { headers: { authorization: this.auth, accept: "text/event-stream" }, signal: ac.signal, redirect: "error" });
          if (!r.ok || !r.body) throw new Error(`SSE status ${r.status}`);
          backoff = 250;
          this.sseGeneration++;
          this.markSseReady?.();
          this.markSseReady = null;
          // After an SSE drop and reconnect, reconcile every live session so missed permissions or completions never hang a turn.
          if (this.sseGeneration > 1) {
            for (const s of this.sessions.values()) void s.reconcile(true);
          }
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          while (!this.closed) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let cut: number;
            while ((cut = buf.search(/\r?\n\r?\n/)) >= 0) {
              const block = buf.slice(0, cut);
              buf = buf.slice(cut).replace(/^\r?\n\r?\n/, "");
              const payload = block
                .split(/\r?\n/)
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice(5).replace(/^ /, ""))
                .join("\n");
              if (payload) this.dispatchRaw(payload);
            }
          }
        } catch {
          if (this.closed) break;
        }
        if (this.closed) break;
        await new Promise((ok) => setTimeout(ok, backoff));
        backoff = Math.min(2000, backoff * 2);
      }
    };
    void loop();
  }

  private dispatchRaw(raw: string) {
    let ev: { type?: string; data?: Json };
    try {
      ev = JSON.parse(raw) as { type?: string; data?: Json };
    } catch {
      return;
    }
    const type = ev?.type;
    const data = ev?.data;
    if (!type || !data || typeof data !== "object") return;
    // Record child session lineage immediately on session.created so every subsequent child event routes to its root.
    if (type === "session.created" && typeof data.sessionID === "string" && typeof data.parentID === "string") {
      this.parents.set(data.sessionID, data.parentID);
      if (this.isStopping(data.sessionID)) {
        this.markStopping(data.sessionID);
        void this.request("POST", `/api/session/${encodeURIComponent(data.sessionID)}/interrupt`).catch(() => {});
        return;
      }
      const found = this.rootOf(data.sessionID);
      if (found) found.session.onChildCreated(data.sessionID, data.parentID, data);
      return;
    }
    const sid = typeof data.sessionID === "string" ? data.sessionID : typeof (data.form as Json | undefined)?.sessionID === "string" ? String((data.form as Json).sessionID) : undefined;
    if (!sid) return;
    if (this.isStopping(sid)) {
      this.suppressStopped(sid, type, data);
      return;
    }
    const found = this.rootOf(sid);
    if (found) {
      found.session.onEvent(type, data, found.isChild ? sid : undefined);
      return;
    }
    // Recover child lineage if an event (like permission.asked) arrived before session.created or after SSE reconnect.
    if (this.sessions.size > 0 && (type === "permission.asked" || type === "form.created" || type.startsWith("session.execution.") || type.startsWith("session.tool.") || type === "session.status" || type === "session.idle")) {
      void this.probeAndReplay(sid, type, data);
    }
  }

  /** Stops any late inbox wake-up or stray permission on a session Liner Code already stopped or closed. */
  private suppressStopped(sid: string, type: string, data: Json) {
    if (type === "permission.asked") {
      const reqId = String(data.id ?? "");
      if (reqId) void this.request("POST", `/api/session/${encodeURIComponent(sid)}/permission/${encodeURIComponent(reqId)}/reply`, { decision: "reject", message: "The session was stopped." }).catch(() => {});
      void this.request("POST", `/api/session/${encodeURIComponent(sid)}/interrupt`).catch(() => {});
      return;
    }
    if (type === "session.execution.started" || type === "session.inbox.enqueued" || (type === "session.status" && (data.status as Json | undefined)?.type === "busy")) {
      void this.request("POST", `/api/session/${encodeURIComponent(sid)}/interrupt`).catch(() => {});
    }
  }

  private async probeAndReplay(sid: string, type: string, data: Json) {
    let p = this.probing.get(sid);
    if (!p) {
      p = this.request<{ data?: Json }>("GET", `/api/session/${encodeURIComponent(sid)}`, undefined, AbortSignal.timeout(5000))
        .then((r) => {
          const info = r.data?.data;
          if (info && typeof info.parentID === "string") {
            this.parents.set(sid, info.parentID);
            if (this.isStopping(sid)) {
              this.markStopping(sid);
              return;
            }
            const found = this.rootOf(sid);
            if (found) found.session.onChildCreated(sid, info.parentID, info);
          }
        })
        .catch(() => {})
        .finally(() => void this.probing.delete(sid));
      this.probing.set(sid, p);
    }
    await p;
    if (this.isStopping(sid)) {
      this.suppressStopped(sid, type, data);
      return;
    }
    const found = this.rootOf(sid);
    if (found) found.session.onEvent(type, data, found.isChild ? sid : undefined);
  }

  shutdown() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idleTimer);
    for (const t of this.stopping.values()) clearTimeout(t);
    this.stopping.clear();
    this.sseAbort?.abort();
    for (const s of this.sessions.values()) s.onDaemonLost();
    this.sessions.clear();
    this.parents.clear();
    if (this.child) killTree(this.child);
    this.onDead?.();
  }
}

/** Shared daemon pool keyed by `(binaryPath, envFingerprint)` so sessions and subagents share one process. */
const DAEMONS = new Map<string, Promise<OpenCodeDaemon>>();

/** Acquires (or spawns) the shared `OpenCodeDaemon` for `bin` and `env`. */
export function sharedOpenCodeDaemon(bin: string, env: NodeJS.ProcessEnv): Promise<OpenCodeDaemon> {
  const key = poolKeyFor(bin, env);
  const existing = DAEMONS.get(key);
  if (existing) {
    return existing.then((d) => (d.alive ? d : (DAEMONS.delete(key), sharedOpenCodeDaemon(bin, env))));
  }
  const starting = OpenCodeDaemon.spawn(bin, env, () => {
    if (DAEMONS.get(key) === starting) DAEMONS.delete(key);
  }).catch((e) => {
    if (DAEMONS.get(key) === starting) DAEMONS.delete(key);
    throw e;
  });
  DAEMONS.set(key, starting);
  return starting;
}

/** Shuts down every pooled `opencode serve` daemon (called on engine shutdown). */
export async function shutdownOpenCodeDaemons() {
  const all = [...DAEMONS.values()];
  DAEMONS.clear();
  for (const p of all) {
    const d = await p.catch(() => null);
    d?.shutdown();
  }
}

/**
  One OpenCode session hosted on a shared `OpenCodeDaemon`. Implements `ProviderSession` with
  native in-process subagent streaming, per-child `stopAgent`/`steerAgent`, live token/cost usage,
  and full Liner Code permission enforcement across parent and child sessions alike.
*/
export class OpenCodeServerSession implements ProviderSession {
  private o: OpenOptions;
  private access: Access;
  private model: string;
  private effort: string;
  private daemon: OpenCodeDaemon | null = null;
  private getDaemon: () => Promise<OpenCodeDaemon>;
  private fallbackOpen?: (o: OpenOptions) => ProviderSession;
  private fallback: ProviderSession | null = null;
  private sessionID: string | undefined;
  private serverName: string | undefined;
  private toldServer = false;
  private registeredMcps = new Set<string>();
  private sink: TurnSink | null = null;
  private signal: AbortSignal | null = null;
  private done: (() => void) | null = null;
  private fail: ((e: Error) => void) | null = null;
  private closed = false;
  private readRefused = false;
  /** Tool call metadata accumulated from `session.tool.input.started` + `called` + `progress`, by call id. */
  private calls = new Map<string, { name: string; input?: Json; output: string; started: number }>();
  /** Active/completed native child subagents spawned by this session (or nested children), by child sessionID. */
  private agents = new Map<string, OpenCodeAgent>();
  /** Pending permission/form replies in flight so a turn waits until they settle. */
  private pendingAsks = 0;
  /** Whether the root session is currently executing a step; false while waiting on background subagents. */
  private parentBusy = false;
  /** Short settle timer after root + children go idle so a `<subagent>` inbox wake lands in the same turn. */
  private settleTimer: NodeJS.Timeout | undefined;
  /** Periodic reconciliation timer while a turn is open so missed SSE events never hang a turn. */
  private reconcileTimer: NodeJS.Timeout | undefined;
  private reconciling = false;
  private rootIdleMisses = 0;
  private lastEventAt = 0;
  /** Permission and form request IDs already handled (deduplicates SSE + reconciliation polls). */
  private seenPerms = new Set<string>();
  private seenForms = new Set<string>();
  /** Settle window in ms after subagents finish (shortened in tests). */
  settleMs = 1500;
  /** Interval in ms between active-turn reconciliation checks (shortened in tests). */
  reconcileMs = 8_000;

  constructor(o: OpenOptions, getDaemon: () => Promise<OpenCodeDaemon>, fallbackOpen?: (o: OpenOptions) => ProviderSession) {
    this.o = o;
    this.access = o.access;
    this.model = o.model;
    this.effort = o.effort;
    this.getDaemon = getDaemon;
    this.fallbackOpen = fallbackOpen;
  }

  // No settled(): closing the last session on the shared `opencode serve` stops it a minute later (daemonIdleMs), and with it
  // whatever OpenCode started and left running (a dev server). It can't tell that apart, as its ACP driver can't, so the
  // runtime never closes it for idleness (Runtime.idleCheck).

  private async ensureReady(sink: TurnSink): Promise<OpenCodeDaemon | null> {
    if (this.fallback) return null;
    if (this.daemon?.alive && this.sessionID) return this.daemon;
    let d: OpenCodeDaemon;
    try {
      d = await this.getDaemon();
    } catch (e) {
      if (e instanceof NoV2Server && this.fallbackOpen) {
        this.fallback = this.fallbackOpen(this.o);
        return null;
      }
      throw e;
    }
    this.daemon = d;
    await d.waitSse();

    // OpenCode v2 scopes runtime MCP servers by `location[directory]`; without it, servers register on the daemon's cwd instead of the project folder.
    const locQuery = `location[directory]=${encodeURIComponent(this.o.cwd)}`;

    // Register per-session Liner MCP server under a tag scoped to this thread/worker + tool kit so sessions on the shared daemon never cross-talk and resumed sessions match their saved permissions.
    if (this.o.mcp && !this.serverName) {
      const tagSrc = `${this.o.mcp.env.LINER_SURFACE_KEY_FILE ?? ""}|${this.o.mcp.env.LINER_SWARM ?? ""}|${this.o.mcp.env.LINER_PAIR ?? ""}|${this.o.mcp.env.LINER_SUBAGENT ?? ""}`;
      const name = tagSrc.replace(/\|/g, "") ? `liner_${createHash("sha256").update(tagSrc).digest("hex").slice(0, 8)}` : `liner_${randomBytes(4).toString("hex")}`;
      const r = await d
        .request(
          "PUT",
          `/api/experimental/mcp/${encodeURIComponent(name)}?${locQuery}`,
          {
            config: {
              type: "local",
              command: [this.o.mcp.command, ...this.o.mcp.args],
              environment: this.o.mcp.env,
              timeout: { execution: LINER_WAIT_SEC * 1000 },
            },
          },
          AbortSignal.timeout(10_000),
        )
        .catch(() => null);
      if (r && r.status >= 200 && r.status < 300) {
        this.serverName = name;
        this.registeredMcps.add(name);
        // `PUT /api/experimental/mcp/:name` connects asynchronously ("pending" -> "connected"); wait briefly so tools are live before the first prompt.
        for (let i = 0; i < 20; i++) {
          const st = await d.request<{ data?: { name?: string; status?: { status?: string } }[] }>("GET", `/api/mcp?${locQuery}`, undefined, AbortSignal.timeout(3_000)).catch(() => null);
          if (!st || st.status !== 200 || !Array.isArray(st.data?.data)) break;
          const entry = st.data.data.find((x) => x.name === name);
          if (!entry || entry.status?.status === "connected" || entry.status?.status === "failed") break;
          await new Promise((res) => setTimeout(res, 150));
        }
      }
    }

    // Register user add-on connections (unless sealed or security scan).
    if (!this.o.sealed && !this.o.scan) {
      for (const c of this.o.connections ?? []) {
        const name = c.name === "liner" ? "liner-addon" : c.name;
        if (this.registeredMcps.has(name)) continue;
        const config = c.http
          ? { type: "remote", url: c.http.url, ...(c.http.headers ? { headers: c.http.headers } : {}) }
          : { type: "local", command: [c.stdio!.command, ...c.stdio!.args], ...(c.stdio!.env ? { environment: c.stdio!.env } : {}) };
        const r = await d.request("PUT", `/api/experimental/mcp/${encodeURIComponent(name)}?${locQuery}`, { config }, AbortSignal.timeout(10_000)).catch(() => null);
        if (r && r.status >= 200 && r.status < 300) this.registeredMcps.add(name);
      }
    }

    const rules = opencodeSessionRules(this.o, this.serverName);
    const modelRef = parseModelRef(this.model, this.effort);

    if (this.o.resume && this.o.fork) {
      const r = await d.request<{ data?: { id?: string } }>("POST", `/api/session/${encodeURIComponent(this.o.resume)}/fork`, {});
      if (r.status < 200 || r.status >= 300 || !r.data?.data?.id) {
        this.o = { ...this.o, resume: undefined, fork: undefined };
        throw new ResumeFailed(`OpenCode couldn't fork session ${this.o.resume} (${r.status}).`);
      }
      this.sessionID = r.data.data.id;
    } else if (this.o.resume) {
      const r = await d.request<{ data?: { id?: string; permissions?: PermRule[] } }>("GET", `/api/session/${encodeURIComponent(this.o.resume)}`);
      if (r.status === 404) {
        const old = this.o.resume;
        this.o = { ...this.o, resume: undefined, fork: undefined };
        throw new ResumeFailed(`OpenCode session ${old} is no longer on this server.`);
      }
      if (r.status < 200 || r.status >= 300 || !r.data?.data?.id) throw new Error(`OpenCode couldn't load session ${this.o.resume} (${r.status}).`);
      // If the resumed session's saved permission ruleset doesn't allow this Liner MCP server (or still allows native subagents during Swarm), open a fresh session with handoff so the tools are reachable.
      const savedPerms = r.data.data.permissions;
      if (Array.isArray(savedPerms) && savedPerms.length > 0) {
        const needAction = this.serverName ? `${this.serverName}_${this.o.swarm ? "swarm_manage" : "browser_open"}` : undefined;
        const hasServer = !needAction || savedPerms.some((p) => p.action === needAction && p.effect === "allow");
        const subRule = [...savedPerms].reverse().find((p) => p.action === "subagent*");
        const wantSub: PermRule["effect"] = this.o.sidekick || this.o.side || this.o.scan || this.o.sealed || this.o.swarm ? "deny" : "allow";
        if (!hasServer || (subRule && subRule.effect !== wantSub)) {
          this.o = { ...this.o, resume: undefined, fork: undefined };
          throw new ResumeFailed("OpenCode session permissions changed for Liner tools.");
        }
      }
      this.sessionID = r.data.data.id;
      if (modelRef) await d.request("POST", `/api/session/${encodeURIComponent(this.sessionID)}/model`, { model: modelRef }).catch(() => {});
    } else {
      const r = await d.request<{ data?: { id?: string } }>("POST", "/api/session", {
        location: { directory: this.o.cwd },
        ...(modelRef ? { model: modelRef } : {}),
        permissions: rules,
      });
      if (r.status < 200 || r.status >= 300 || !r.data?.data?.id) throw new Error(`OpenCode couldn't create session (${r.status}): ${r.text.slice(0, 200)}`);
      this.sessionID = r.data.data.id;
    }

    d.register(this.sessionID, this);
    sink.session(this.sessionID);

    // Attach soul + per-session Liner MCP tool naming note as a durable instruction entry.
    const serverNote = this.serverName
      ? `Liner Code's tools are on the MCP server ${this.serverName} now: call each as ${this.serverName}_<tool> (for example ${this.serverName}_swarm_manage, ${this.serverName}_swarm_post, ${this.serverName}_swarm_read, ${this.serverName}_browser_open).`
      : "";
    const instructions = [this.o.soul?.trim(), serverNote].filter(Boolean).join("\n\n");
    if (instructions) {
      await d.request("PUT", `/api/experimental/session/${encodeURIComponent(this.sessionID)}/instructions/entries/liner`, { value: instructions }).catch(() => {});
    }

    return d;
  }

  async turn(text: string, sink: TurnSink, signal: AbortSignal, attached?: string[]): Promise<void> {
    if (this.closed) throw new Error("This OpenCode session was closed.");
    const d = await this.ensureReady(sink);
    if (!d) return this.fallback!.turn(text, sink, signal, attached);
    const sid = this.sessionID!;
    d.clearStopping(sid);
    this.sink = sink;
    this.signal = signal;
    this.readRefused = false;
    this.parentBusy = true;
    this.rootIdleMisses = 0;
    this.lastEventAt = Date.now();
    clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
    clearInterval(this.reconcileTimer);
    this.reconcileTimer = undefined;
    this.calls.clear();

    const files = (attached ?? []).map((p) => ({ uri: pathToFileURL(resolve(this.o.cwd, p)).href }));
    const onAbort = () => {
      this.interruptTree(d, sid);
      this.finishTurn();
    };
    if (signal.aborted) return;
    signal.addEventListener("abort", onAbort, { once: true });

    if (this.reconcileMs > 0) {
      this.reconcileTimer = setInterval(() => void this.reconcile(false), this.reconcileMs);
      this.reconcileTimer.unref?.();
    }

    const promptText =
      this.o.swarm && this.serverName && !this.toldServer && !COMPACT.test(text)
        ? `(Liner Swarm MCP tools on this session are ${this.serverName}_swarm_manage, ${this.serverName}_swarm_post, and ${this.serverName}_swarm_read — call them by these exact names.)\n\n${text}`
        : text;
    if (this.o.swarm && this.serverName && !COMPACT.test(text)) this.toldServer = true;

    try {
      await new Promise<void>((resolveTurn, rejectTurn) => {
        this.done = resolveTurn;
        this.fail = rejectTurn;
        const send = COMPACT.test(text)
          ? d.request("POST", `/api/session/${encodeURIComponent(sid)}/compact`, {}, signal)
          : d.request("POST", `/api/session/${encodeURIComponent(sid)}/prompt`, { text: promptText, ...(files.length ? { files } : {}) }, signal);
        send.then(
          (r) => {
            if (r.status < 200 || r.status >= 300) {
              const msg = ((r.data as Json | undefined)?.message ?? (r.data as Json | undefined)?.error ?? r.text) || `OpenCode answered ${r.status}`;
              this.failTurn(new Error(String(msg).slice(0, 300)));
            }
          },
          (e) => {
            if (!signal.aborted) this.failTurn(e instanceof Error ? e : new Error(String(e)));
          },
        );
      });
    } finally {
      signal.removeEventListener("abort", onAbort);
      clearTimeout(this.settleTimer);
      this.settleTimer = undefined;
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = undefined;
      this.parentBusy = false;
      this.sink = null;
      this.signal = null;
      this.done = null;
      this.fail = null;
    }
  }

  async steer(text: string, attached?: string[]): Promise<boolean> {
    if (this.fallback) return Boolean(await this.fallback.steer?.(text, attached));
    if (!this.daemon?.alive || !this.sessionID || !text.trim()) return false;
    const files = (attached ?? []).map((p) => ({ uri: pathToFileURL(resolve(this.o.cwd, p)).href }));
    const r = await this.daemon.request("POST", `/api/session/${encodeURIComponent(this.sessionID)}/prompt`, { text: text.trim(), ...(files.length ? { files } : {}), delivery: "steer" }).catch(() => null);
    return Boolean(r && r.status >= 200 && r.status < 300);
  }

  async update(u: Pick<OpenOptions, "model" | "effort" | "access">): Promise<boolean> {
    if (this.fallback) return Boolean(await this.fallback.update?.(u));
    this.access = u.access;
    const modelChanged = u.model !== this.model || u.effort !== this.effort;
    this.model = u.model;
    this.effort = u.effort;
    if (modelChanged && this.daemon?.alive && this.sessionID) {
      const ref = parseModelRef(this.model, this.effort);
      if (ref) {
        const r = await this.daemon.request("POST", `/api/session/${encodeURIComponent(this.sessionID)}/model`, { model: ref }).catch(() => null);
        return Boolean(r && r.status >= 200 && r.status < 300);
      }
    }
    return true;
  }

  async stopAgent(taskId: string): Promise<boolean> {
    if (this.fallback) return Boolean(await this.fallback.stopAgent?.(taskId));
    const a = this.agents.get(taskId);
    if (!a || a.status !== "running" || !this.daemon?.alive) return false;
    const r = await this.daemon.request("POST", `/api/session/${encodeURIComponent(taskId)}/interrupt`).catch(() => null);
    if (r && r.status >= 200 && r.status < 300) {
      this.endAgent(a, "stopped");
      return true;
    }
    return false;
  }

  async steerAgent(taskId: string, text: string): Promise<boolean> {
    if (this.fallback) return Boolean(await this.fallback.steerAgent?.(taskId, text));
    const a = this.agents.get(taskId);
    if (!a || a.status !== "running" || !this.daemon?.alive || !text.trim()) return false;
    const r = await this.daemon.request("POST", `/api/session/${encodeURIComponent(taskId)}/prompt`, { text: text.trim(), delivery: "steer" }).catch(() => null);
    return Boolean(r && r.status >= 200 && r.status < 300);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.fallback) {
      this.fallback.close();
      return;
    }
    const d = this.daemon;
    const sid = this.sessionID;
    clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
    clearInterval(this.reconcileTimer);
    this.reconcileTimer = undefined;
    if (d?.alive && sid) {
      if (this.sink || this.hasRunningChildren()) this.interruptTree(d, sid);
      if (this.serverName) void d.request("DELETE", `/api/experimental/mcp/${encodeURIComponent(this.serverName)}?location[directory]=${encodeURIComponent(this.o.cwd)}`).catch(() => {});
      d.unregister(sid);
    }
    this.finishTurn();
  }

  /**
    Interrupts the root session and every running child, drains queued inbox items, and tombstones
    the session tree on the daemon so cancelling children cannot auto-wake the parent with
    `<subagent state="cancelled">` and spawn orphaned subagents after Liner Code stopped listening.
  */
  private interruptTree(d: OpenCodeDaemon, sid: string) {
    const kids = [...this.agents.keys()];
    d.markStopping(sid, kids);
    void d.request("POST", `/api/session/${encodeURIComponent(sid)}/interrupt`).catch(() => {});
    for (const a of this.agents.values()) {
      if (a.status === "running") {
        a.status = "stopped";
        a.agent.state = "stopped";
        a.agent.now = undefined;
        void d.request("POST", `/api/session/${encodeURIComponent(a.id)}/interrupt`).catch(() => {});
      }
    }
    void d
      .request<{ data?: { id?: string }[] }>("GET", `/api/session/${encodeURIComponent(sid)}/inbox`, undefined, AbortSignal.timeout(3000))
      .then((r) => {
        for (const item of Array.isArray(r.data?.data) ? r.data.data : []) {
          if (item?.id) void d.request("DELETE", `/api/session/${encodeURIComponent(sid)}/inbox/${encodeURIComponent(item.id)}`).catch(() => {});
        }
      })
      .catch(() => {});
  }

  /**
    Reconciles local turn state with OpenCode's HTTP endpoints (pending permissions, pending forms,
    active sessions, and running background jobs). Called on SSE reconnect and periodically during
    an open turn so a dropped or out-of-order SSE event can never leave a turn stuck forever.
  */
  async reconcile(afterReconnect = false): Promise<void> {
    if (this.reconciling || !this.sink || !this.daemon?.alive || !this.sessionID) return;
    this.reconciling = true;
    const d = this.daemon;
    const sid = this.sessionID;
    const dirQuery = `location[directory]=${encodeURIComponent(this.o.cwd)}`;
    const owns = async (targetID: string): Promise<string | undefined | null> => {
      if (targetID === sid) return undefined;
      let found = d.rootOf(targetID);
      if (!found) {
        const r = await d.request<{ data?: Json }>("GET", `/api/session/${encodeURIComponent(targetID)}`, undefined, AbortSignal.timeout(3000)).catch(() => null);
        const info = r?.data?.data;
        if (info && typeof info.parentID === "string") {
          d.recordParent(targetID, info.parentID);
          found = d.rootOf(targetID);
          if (found?.session === this) this.onChildCreated(targetID, info.parentID, info);
        }
      }
      return found?.session === this ? (found.isChild ? targetID : undefined) : null;
    };

    try {
      // 1. Recover any pending permission requests missed across an SSE drop or startup race.
      const perms = await d.request<{ data?: Json[] }>("GET", `/api/permission/request?${dirQuery}`, undefined, AbortSignal.timeout(4000)).catch(() => null);
      const permList = Array.isArray(perms?.data?.data) ? perms.data.data : [];
      for (const req of permList) {
        const reqId = String(req?.id ?? "");
        const target = String(req?.sessionID ?? "");
        if (!reqId || !target || this.seenPerms.has(reqId)) continue;
        const childID = await owns(target);
        if (childID === null) continue;
        void this.handlePermission(req, childID);
      }

      // 2. Recover any pending form prompts missed across an SSE drop.
      const forms = await d.request<{ data?: Json[] }>("GET", `/api/form?${dirQuery}`, undefined, AbortSignal.timeout(4000)).catch(() => null);
      const formList = Array.isArray(forms?.data?.data) ? forms.data.data : [];
      for (const form of formList) {
        const formId = String(form?.id ?? "");
        const target = String(form?.sessionID ?? "");
        if (!formId || !target || this.seenForms.has(formId)) continue;
        const childID = await owns(target);
        if (childID === null) continue;
        void this.handleForm({ form }, childID);
      }

      // 3. Reconcile active sessions and running background subagent jobs.
      const [activeRes, jobsRes] = await Promise.all([
        d.request<{ data?: Record<string, { type?: string }> }>("GET", "/api/session/active", undefined, AbortSignal.timeout(4000)).catch(() => null),
        d.request<{ data?: Json[] }>("GET", `/api/experimental/job?sessionID=${encodeURIComponent(sid)}&status=running&descendants=true`, undefined, AbortSignal.timeout(4000)).catch(() => null),
      ]);

      const runningJobKids = new Set<string>();
      const jobs = Array.isArray(jobsRes?.data?.data) ? jobsRes.data.data : [];
      for (const job of jobs) {
        const sub = (job?.subagent ?? job?.data ?? job) as Json | undefined;
        const childID = typeof sub?.childSessionID === "string" ? sub.childSessionID : typeof job?.targetID === "string" && String(job.targetID).startsWith("ses_") ? String(job.targetID) : undefined;
        const parentID = typeof sub?.parentSessionID === "string" ? sub.parentSessionID : typeof job?.sessionID === "string" ? String(job.sessionID) : sid;
        if (childID && childID !== sid) {
          runningJobKids.add(childID);
          if (!this.agents.has(childID)) {
            d.recordParent(childID, parentID);
            this.onChildCreated(childID, parentID, {
              agent: typeof sub?.agent === "string" ? sub.agent : "subagent",
              title: typeof job?.title === "string" ? job.title : typeof sub?.description === "string" ? sub.description : "a task",
            });
          }
        }
      }

      if (activeRes && activeRes.status === 200 && activeRes.data?.data && typeof activeRes.data.data === "object") {
        const active = activeRes.data.data;
        const now = Date.now();
        for (const a of this.agents.values()) {
          if (a.status !== "running") continue;
          if (a.id in active || runningJobKids.has(a.id)) {
            a.idleMisses = 0;
          } else if (now - a.createdAt > Math.min(3000, Math.max(50, this.reconcileMs))) {
            a.idleMisses++;
            if (afterReconnect || a.idleMisses >= 2) this.endAgent(a, "done");
          }
        }
        if (this.parentBusy && !this.hasRunningChildren() && this.pendingAsks === 0 && runningJobKids.size === 0) {
          if (sid in active) {
            this.rootIdleMisses = 0;
          } else if (afterReconnect || now - this.lastEventAt >= Math.max(200, this.reconcileMs)) {
            const inboxRes = await d.request<{ data?: unknown[] }>("GET", `/api/session/${encodeURIComponent(sid)}/inbox`, undefined, AbortSignal.timeout(3000)).catch(() => null);
            const inboxLen = Array.isArray(inboxRes?.data?.data) ? inboxRes.data.data.length : 0;
            if (inboxLen > 0) {
              this.rootIdleMisses = 0;
            } else {
              this.rootIdleMisses++;
              if (afterReconnect || this.rootIdleMisses >= 2) {
                this.parentBusy = false;
                this.maybeFinish();
              }
            }
          }
        } else if (!this.parentBusy && !this.hasRunningChildren() && this.pendingAsks === 0 && runningJobKids.size === 0 && !(sid in active) && !this.settleTimer) {
          this.maybeFinish();
        }
      }
    } finally {
      this.reconciling = false;
    }
  }

  onDaemonLost() {
    this.failTurn(new Error("OpenCode server exited unexpectedly."));
  }

  /** Called by `OpenCodeDaemon` when a child subagent session is created under this session (or under one of its children). */
  onChildCreated(childID: string, parentID: string, data: Json) {
    const sink = this.sink;
    if (!sink) {
      if (this.daemon?.alive) void this.daemon.request("POST", `/api/session/${encodeURIComponent(childID)}/interrupt`).catch(() => {});
      return;
    }
    if (this.agents.has(childID)) return;
    const parentAgent = this.agents.get(parentID);
    const agentName = typeof data.agent === "string" && data.agent ? data.agent.charAt(0).toUpperCase() + data.agent.slice(1) : "Subagent";
    const task = short(data.title || "a task", 80);
    const modelObj = data.model as { providerID?: string; id?: string } | undefined;
    const model = modelObj?.providerID && modelObj?.id ? `${this.o.provider ?? "opencode"}:${modelObj.providerID}/${modelObj.id}` : undefined;
    const a: OpenCodeAgent = {
      id: childID,
      key: `opencode:${childID}`,
      title: `${agentName}: ${task}`,
      status: "running",
      createdAt: Date.now(),
      idleMisses: 0,
      agent: {
        name: agentName,
        task,
        ...(model ? { model } : {}),
        taskId: childID,
        steerable: true,
        steps: [],
        tools: 0,
        tokens: 0,
        state: "running",
        now: "Starting",
        ...(parentAgent ? { parentKey: parentAgent.key } : {}),
      },
      steps: [],
      stepAt: new Map(),
      callNames: new Map(),
      said: "",
      sink,
    };
    this.agents.set(childID, a);
    clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
    this.paintAgent(a);
  }

  /** Handles one SSE V2 event for either the root session (`childID === undefined`) or a descendant subagent (`childID`). */
  onEvent(type: string, data: Json, childID?: string) {
    if (type === "permission.asked") {
      void this.handlePermission(data, childID);
      return;
    }
    if (type === "form.created") {
      void this.handleForm(data, childID);
      return;
    }

    const sink = this.sink;
    if (!sink) return;
    this.lastEventAt = Date.now();
    this.rootIdleMisses = 0;
    sink.heard?.();

    if (childID) {
      this.onChildEvent(childID, type, data);
      return;
    }

    // Root session events
    switch (type) {
      case "session.execution.started":
      case "session.inbox.enqueued": {
        this.parentBusy = true;
        clearTimeout(this.settleTimer);
        this.settleTimer = undefined;
        break;
      }
      case "session.status": {
        const st = data.status as { type?: string; attempt?: number; message?: string } | undefined;
        if (st?.type === "busy" || st?.type === "retry") {
          this.parentBusy = true;
          clearTimeout(this.settleTimer);
          this.settleTimer = undefined;
          if (st.type === "retry" && (st.attempt ?? 0) >= 2 && st.message) sink.notice(`OpenCode is retrying (attempt ${st.attempt}): ${short(st.message, 120)}`);
        } else if (st?.type === "idle") {
          this.parentBusy = false;
          this.maybeFinish();
        }
        break;
      }
      case "session.text.delta": {
        if (typeof data.delta === "string" && data.delta) sink.text(data.delta, typeof data.assistantMessageID === "string" ? data.assistantMessageID : undefined);
        break;
      }
      case "session.reasoning.delta": {
        if (typeof data.delta === "string" && data.delta) sink.reasoning(data.delta, typeof data.assistantMessageID === "string" ? data.assistantMessageID : undefined);
        break;
      }
      case "session.tool.input.started": {
        const id = String(data.id ?? "");
        const name = String(data.name ?? data.tool ?? "tool");
        if (!id) break;
        this.calls.set(id, { name, output: "", started: Date.now() });
        this.emitTool(id, "running");
        break;
      }
      case "session.tool.called": {
        const id = String(data.id ?? "");
        if (!id) break;
        const name = typeof data.name === "string" ? data.name : typeof data.tool === "string" ? data.tool : undefined;
        const rec = this.calls.get(id) ?? { name: name ?? "tool", output: "", started: Date.now() };
        if (name && rec.name === "tool") rec.name = name;
        if (data.input && typeof data.input === "object") rec.input = data.input as Json;
        this.calls.set(id, rec);
        this.emitTool(id, "running");
        break;
      }
      case "session.tool.progress": {
        const id = String(data.id ?? "");
        const rec = this.calls.get(id);
        if (!rec) break;
        const meta = data.metadata as Json | undefined;
        // Link OpenCode's native `subagent` tool call description/prompt to its spawned child row.
        if (typeof meta?.sessionID === "string") this.linkChildFromCall(meta.sessionID, rec);
        const out = typeof meta?.output === "string" ? plainOutput(meta.output) : "";
        if (out) rec.output = out.length > OUTPUT_MAX ? `…${out.slice(-OUTPUT_MAX)}` : out;
        this.emitTool(id, "running");
        break;
      }
      case "session.tool.success": {
        const id = String(data.id ?? "");
        const name = typeof data.name === "string" ? data.name : typeof data.tool === "string" ? data.tool : undefined;
        const rec = this.calls.get(id) ?? { name: name ?? "tool", output: "", started: Date.now() };
        if (name && rec.name === "tool") rec.name = name;
        const txt = plainOutput(toolContentText(data.content));
        if (txt) rec.output = txt.length > OUTPUT_MAX ? `…${txt.slice(-OUTPUT_MAX)}` : txt;
        // When OpenCode's native background subagent call returns "(sessionID: ses_...)", link its metadata to the child row instead of emitting a duplicate row.
        const sidMatch = /sessionID:\s*(ses_[a-zA-Z0-9_-]+)/.exec(txt);
        if (sidMatch) this.linkChildFromCall(sidMatch[1], rec);
        this.calls.set(id, rec);
        this.emitTool(id, "done");
        break;
      }
      case "session.tool.failed": {
        const id = String(data.id ?? "");
        const name = typeof data.name === "string" ? data.name : typeof data.tool === "string" ? data.tool : undefined;
        const rec = this.calls.get(id) ?? { name: name ?? "tool", output: "", started: Date.now() };
        if (name && rec.name === "tool") rec.name = name;
        const err = (data.error as Json | undefined)?.message;
        const txt = plainOutput(toolContentText(data.content) || String(err ?? ""));
        if (txt) rec.output = txt.length > OUTPUT_MAX ? `…${txt.slice(-OUTPUT_MAX)}` : txt;
        this.calls.set(id, rec);
        this.emitTool(id, "failed");
        break;
      }
      case "session.usage.updated": {
        const tok = data.tokens as { input?: number; output?: number; cache?: { read?: number } } | undefined;
        sink.usage(
          {
            inputTokens: Number(tok?.input ?? 0),
            outputTokens: Number(tok?.output ?? 0),
            cacheReadTokens: Number(tok?.cache?.read ?? 0),
            costUsd: Number(data.cost ?? 0),
          },
          true,
        );
        break;
      }
      case "session.execution.succeeded":
      case "session.idle": {
        this.parentBusy = false;
        this.maybeFinish();
        break;
      }
      case "session.execution.interrupted": {
        this.parentBusy = false;
        this.finishTurn();
        break;
      }
      case "session.execution.failed": {
        this.parentBusy = false;
        const err = data.error as { message?: string; status?: number; retryAfterMs?: number } | undefined;
        const msg = err?.message || "OpenCode stopped with an error.";
        if (err?.status === 429) sink.limited?.(msg, err.retryAfterMs ? Date.now() + err.retryAfterMs : undefined);
        else sink.error(msg);
        this.finishTurn();
        break;
      }
    }
  }

  private onChildEvent(childID: string, type: string, data: Json) {
    const a = this.agents.get(childID);
    if (!a) return;
    a.idleMisses = 0;
    switch (type) {
      case "session.status": {
        const st = data.status as { type?: string; attempt?: number } | undefined;
        if (st?.type === "retry") {
          a.agent.now = st.attempt && st.attempt > 1 ? `Retrying (attempt ${st.attempt})…` : "Retrying…";
          this.paintAgent(a);
        } else if (st?.type === "idle") {
          this.endAgent(a, "done");
        }
        break;
      }
      case "session.renamed": {
        if (typeof data.title === "string" && data.title.trim() && a.agent.task === "a task") {
          a.agent.task = short(data.title, 80);
          a.title = `${a.agent.name}: ${a.agent.task}`;
          this.paintAgent(a);
        }
        break;
      }
      case "session.text.delta": {
        if (typeof data.delta === "string") {
          a.said += data.delta;
          if (a.said.length > REPORT_MAX * 2) a.said = a.said.slice(-REPORT_MAX);
          a.agent.now = "Writing its report";
          this.paintAgent(a);
        }
        break;
      }
      case "session.tool.input.started":
      case "session.tool.called":
      case "session.tool.success":
      case "session.tool.failed": {
        const id = String(data.id ?? "");
        if (!id) break;
        if (type === "session.tool.input.started") a.callNames.set(id, String(data.name ?? "tool"));
        const name = a.callNames.get(id) ?? "tool";
        const input = data.input && typeof data.input === "object" ? (data.input as Json) : undefined;
        const title = input ? this.toolTitle(name, input) : name;
        const kind = ACTION_KIND[name.toLowerCase()] ?? "other";
        const status: AgentStep["status"] = type === "session.tool.success" ? "done" : type === "session.tool.failed" ? "failed" : "running";
        const idx = a.stepAt.get(id);
        if (idx === undefined) {
          a.stepAt.set(id, a.steps.length);
          a.steps.push({ title, toolKind: kind, status });
          a.agent.tools = (a.agent.tools ?? 0) + 1;
        } else {
          a.steps[idx] = { ...a.steps[idx], ...(input ? { title } : {}), status };
        }
        if (status === "running") a.agent.now = a.steps[a.stepAt.get(id)!].title;
        a.agent.steps = a.steps.slice(-40);
        this.paintAgent(a);
        break;
      }
      case "session.usage.updated": {
        const tok = data.tokens as { input?: number; output?: number; cache?: { read?: number } } | undefined;
        a.agent.tokens = Number(tok?.input ?? 0) + Number(tok?.output ?? 0);
        this.paintAgent(a);
        break;
      }
      case "session.execution.succeeded":
      case "session.idle": {
        this.endAgent(a, "done");
        break;
      }
      case "session.execution.interrupted": {
        this.endAgent(a, "stopped");
        break;
      }
      case "session.execution.failed": {
        const msg = (data.error as Json | undefined)?.message;
        if (typeof msg === "string" && msg && !a.said) a.said = msg;
        this.endAgent(a, "failed");
        break;
      }
    }
  }

  private hasRunningChildren() {
    for (const a of this.agents.values()) if (a.status === "running") return true;
    return false;
  }

  /** Ends the turn once the root session, all spawned background subagents, and pending asks have settled. */
  private maybeFinish() {
    if (!this.done || this.parentBusy || this.hasRunningChildren() || this.pendingAsks > 0) return;
    // Wait briefly so OpenCode's `<subagent>` inbox delivery can wake the parent inside the same turn.
    clearTimeout(this.settleTimer);
    if (this.agents.size === 0 || this.settleMs <= 0) {
      this.finishTurn();
      return;
    }
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      void this.confirmAndFinish();
    }, this.settleMs);
  }

  /** Confirms with the daemon before ending a subagent turn so a queued `<subagent>` inbox wake is never cut off. */
  private async confirmAndFinish() {
    if (!this.done || this.parentBusy || this.hasRunningChildren() || this.pendingAsks > 0) return;
    const d = this.daemon;
    const sid = this.sessionID;
    if (d?.alive && sid) {
      const [activeRes, inboxRes, jobsRes] = await Promise.all([
        d.request<{ data?: Record<string, unknown> }>("GET", "/api/session/active", undefined, AbortSignal.timeout(3000)).catch(() => null),
        d.request<{ data?: unknown[] }>("GET", `/api/session/${encodeURIComponent(sid)}/inbox`, undefined, AbortSignal.timeout(3000)).catch(() => null),
        d.request<{ data?: Json[] }>("GET", `/api/experimental/job?sessionID=${encodeURIComponent(sid)}&status=running&descendants=true`, undefined, AbortSignal.timeout(3000)).catch(() => null),
      ]);
      const active = activeRes?.status === 200 && activeRes.data?.data && typeof activeRes.data.data === "object" ? activeRes.data.data : null;
      const inbox = inboxRes?.status === 200 && Array.isArray(inboxRes.data?.data) ? inboxRes.data.data : [];
      const jobs = jobsRes?.status === 200 && Array.isArray(jobsRes.data?.data) ? jobsRes.data.data : [];
      if ((active && sid in active) || inbox.length > 0 || jobs.length > 0) {
        if (active && sid in active) this.parentBusy = true;
        if (jobs.length > 0) void this.reconcile(false);
        clearTimeout(this.settleTimer);
        this.settleTimer = setTimeout(() => {
          this.settleTimer = undefined;
          void this.confirmAndFinish();
        }, Math.max(150, Math.min(2000, this.settleMs)));
        return;
      }
    }
    if (!this.parentBusy && !this.hasRunningChildren() && this.pendingAsks === 0) this.finishTurn();
  }

  private endAgent(a: OpenCodeAgent, state: "done" | "failed" | "stopped") {
    if (a.status !== "running") return;
    a.status = state;
    for (const s of a.steps) if (s.status === "running") s.status = state === "done" ? "done" : "failed";
    a.agent.steps = a.steps.slice(-40);
    a.agent.state = state;
    a.agent.now = undefined;
    const report = a.said.trim();
    if (report) a.agent.report = report.length > REPORT_MAX ? `…${report.slice(-REPORT_MAX)}` : report;
    this.paintAgent(a);
    this.maybeFinish();
  }

  private paintAgent(a: OpenCodeAgent) {
    a.sink.tool({
      key: a.key,
      tool: "subagent",
      toolKind: "task",
      title: a.title,
      status: a.status,
      agent: { ...a.agent },
    });
  }

  private toolTitle(name: string, input?: Json): string {
    const mine = this.serverName ? linerCall(name, input, this.serverName) : undefined;
    if (mine) return linerTitle(mine.name, mine.input);
    const low = name.toLowerCase();
    if ((low === "bash" || low === "shell") && typeof input?.command === "string") return `Run ${short(stripLeadingCd(input.command, this.o.cwd), 60)}`;
    const file = input?.filePath ?? input?.file_path ?? input?.path;
    if (typeof file === "string" && file) {
      const rel = fromFolder(this.o.cwd, file);
      if (low === "read") return `Read ${rel}`;
      if (low === "edit" || low === "write" || low === "patch") return `Edit ${rel}`;
    }
    if ((low === "grep" || low === "glob") && typeof input?.pattern === "string") return `Search ${short(input.pattern, 50)}`;
    if ((low === "task" || low === "subagent") && typeof input?.description === "string") return `Subagent: ${short(input.description, 60)}`;
    return name;
  }

  private linkChildFromCall(sessionID: string, rec: { input?: Json }) {
    const kid = this.agents.get(sessionID);
    if (!kid || !rec.input) return;
    const desc = typeof rec.input.description === "string" ? short(rec.input.description, 80) : undefined;
    const brief = typeof rec.input.prompt === "string" ? rec.input.prompt.slice(0, 4000) : undefined;
    if (desc) {
      kid.agent.task = desc;
      kid.title = `${kid.agent.name}: ${desc}`;
    }
    if (brief) kid.agent.brief = brief;
    this.paintAgent(kid);
  }

  private emitTool(id: string, status: "running" | "done" | "failed") {
    const sink = this.sink;
    const rec = this.calls.get(id);
    if (!sink || !rec) return;
    const mine = this.serverName ? linerCall(rec.name, rec.input, this.serverName) : undefined;
    // OpenCode's native `task`/`subagent` calls (including background launcher variants like `subagent_create` or `opencode?subagent`)
    // spawn child sessions tracked by their own AgentRun rows; skip emitting a duplicate bare Subagent row before the real child rows.
    const low = rec.name.toLowerCase();
    const isNativeSub =
      !mine &&
      (low === "subagent" ||
        low === "task" ||
        low.startsWith("subagent_") ||
        low.startsWith("task_") ||
        /(?:^|[:/?])(?:subagent|task)(?:_[a-z0-9]+)?$/.test(low) ||
        /the subagent is working in the background\s*\(sessionid:/i.test(rec.output));
    if (isNativeSub) return;
    const kind: ToolKind = mine ? "other" : (ACTION_KIND[low] ?? "other");
    const file = rec.input?.filePath ?? rec.input?.file_path ?? rec.input?.path;
    sink.tool({
      key: id,
      tool: mine ? `liner.${mine.name}` : rec.name,
      toolKind: kind,
      title: this.toolTitle(rec.name, rec.input),
      path: typeof file === "string" ? fromFolder(this.o.cwd, file) : undefined,
      input: rec.input === undefined ? undefined : JSON.stringify(rec.input, null, 2),
      output: rec.output || undefined,
      status,
    });
  }

  /**
    Evaluates one `permission.asked` event from either the root session or any descendant subagent
    against Liner Code's access level, project containment, `.env` guard, `.git/` hook guard, and
    `guardDestructive`, then replies on the asking session's exact `sessionID`.
  */
  private async handlePermission(data: Json, childID?: string) {
    const d = this.daemon;
    const reqId = String(data.id ?? "");
    const targetSession = String(data.sessionID ?? this.sessionID ?? "");
    if (!d?.alive || !reqId || !targetSession || this.seenPerms.has(reqId)) return;
    this.seenPerms.add(reqId);
    if (this.seenPerms.size > 500) this.seenPerms.delete(this.seenPerms.values().next().value!);
    const reply = (decision: "once" | "reject", message?: string) =>
      d.request("POST", `/api/session/${encodeURIComponent(targetSession)}/permission/${encodeURIComponent(reqId)}/reply`, { decision, ...(message ? { message } : {}) }).catch(() => {});

    const action = String(data.action ?? "");
    const low = action.toLowerCase();
    const resources = Array.isArray(data.resources) ? data.resources.map(String) : [];
    const meta = (data.metadata && typeof data.metadata === "object" ? data.metadata : {}) as Json;
    const kind: ToolKind = ACTION_KIND[low] ?? "other";
    const command = low === "bash" || low === "shell" ? String(meta.command ?? resources[0] ?? "").trim() : "";
    const reader = kind === "exec" && Boolean(command) && readsOnly(command);
    const dirs = [...(this.o.dirs ?? []), opencodeOutputs(this.o.env)];
    const metaPath = typeof meta.path === "string" ? meta.path : typeof meta.filePath === "string" ? meta.filePath : undefined;
    const paths = kind === "exec" ? [] : [...resources.filter((r) => r && r !== "*"), ...(resources.length === 0 && metaPath ? [metaPath] : [])];
    const handed = (p: string) => kind !== "edit" && (kind !== "exec" || reader) && dirs.some((dir) => inFolder(dir, resolve(this.o.cwd, p)));
    const stray = paths.find((p) => !inFolder(this.o.cwd, p) && !handed(p));
    const gitDir = kind === "edit" && paths.some((p) => gitInside(this.o.cwd, p));
    const scoped = paths.length > 0 && !stray && !gitDir;
    const words = reader ? commandWords(command) : [];
    const beyond = words.find((w) => leaves(w, this.o.cwd, dirs));
    const extDir = low === "external_directory" ? (resources[0] || String(meta.parentDir ?? "")) : "";
    const extHanded = Boolean(extDir) && handed(extDir);
    const away = stray ?? beyond ?? (extDir && !extHanded ? extDir : undefined);
    const secret = [...paths, ...words].some((p) => secretFile(p) && !handed(p));
    const reads = (kind === "read" ? scoped : low === "external_directory" ? extHanded : (kind === "search" || reader) && !away) && !secret;
    const ownLiner = Boolean(this.serverName && action.startsWith(`${this.serverName}_`));

    // Read only refuses anything that edits, mutates, leaves the project, or uses Code Mode with no card.
    if (this.access === "read" && !reads && !ownLiner) {
      const what = kind === "edit" ? `change ${paths[0] ? fromFolder(this.o.cwd, paths[0]) : "files"}` : kind === "exec" ? `run ${command || "a command"}` : `use ${action}`;
      if (!this.readRefused) this.sink?.notice(`This session only reads, so OpenCode wasn't let ${what}.`);
      this.readRefused = true;
      await reply("reject", `This session is Read only: Liner Code refused your request to ${what}.`);
      return;
    }

    const free = this.access === "full" || reads || ownLiner || ((this.access === "edits" || this.access === "auto" || this.access === "review") && kind === "edit" && scoped);
    if (free && !(this.o.guard && isDestructive(command))) {
      await reply("once");
      return;
    }

    const sink = this.sink;
    const signal = this.signal;
    if (!sink || !signal || signal.aborted) {
      await reply("reject", "The turn has ended.");
      return;
    }

    const childLabel = childID ? this.agents.get(childID)?.agent.name ?? "Subagent" : undefined;
    const file = away ?? (gitDir ? paths.find((p) => gitInside(this.o.cwd, p)) : undefined) ?? paths[0];
    const fields = [command && { label: "Command", value: command }, file && { label: "File", value: fromFolder(this.o.cwd, file) }, { label: "Where", value: this.o.cwd }].filter(Boolean) as { label: string; value: string }[];
    const loose = Boolean(away) || (kind === "edit" && !scoped);
    const rule = loose || low === "execute" ? undefined : kind === "exec" ? ruleFor(command) : kind === "edit" ? "Edit" : kind !== "other" ? low : /^[\w.:-]+$/.test(action) ? `tool ${action}` : undefined;
    const risk = loose || low === "execute" || secret || gitDir ? "high" : kind === "exec" ? commandRisk(command) : kind === "edit" ? "medium" : "low";
    const baseTitle = kind === "exec" ? `Run ${short(stripLeadingCd(command, this.o.cwd), 70)}` : kind === "edit" && file ? `Edit ${fromFolder(this.o.cwd, file)}` : short(data.message || action, 70);
    const title = childLabel ? `${childLabel}: ${baseTitle}` : baseTitle;

    this.pendingAsks++;
    try {
      const ans = await sink.approve({ tool: kind === "edit" ? "edit" : low === "execute" ? "execute" : action, title, risk, fields, rule, unjudged: true }, signal);
      await reply(ans.allow ? "once" : "reject", ans.reason);
    } catch {
      await reply("reject", "Cancelled.");
    } finally {
      this.pendingAsks--;
      this.maybeFinish();
    }
  }

  /** Routes an OpenCode V2 `form.created` prompt to Liner Code's question card and posts the reply. */
  private async handleForm(data: Json, _childID?: string) {
    const d = this.daemon;
    const form = data.form as { id?: string; sessionID?: string; title?: string; fields?: { name?: string; label?: string; description?: string; options?: { value?: string; label?: string }[] }[] } | undefined;
    const formId = form?.id;
    const targetSession = form?.sessionID ?? this.sessionID;
    if (!d?.alive || !formId || !targetSession || this.seenForms.has(formId)) return;
    this.seenForms.add(formId);
    if (this.seenForms.size > 500) this.seenForms.delete(this.seenForms.values().next().value!);
    const sink = this.sink;
    const signal = this.signal;
    if (!sink || !signal || signal.aborted) return;
    const fields = Array.isArray(form?.fields) ? form.fields : [];
    const questions: Question[] = fields.map((f, i) => ({
      header: f.label || f.name || `Field ${i + 1}`,
      question: f.description || f.label || f.name || form?.title || "Answer",
      options: (f.options ?? []).map((o) => ({ label: o.label || o.value || "", description: "" })).filter((o) => o.label),
      multiSelect: false,
    }));
    this.pendingAsks++;
    try {
      const answers = questions.length ? await sink.ask(questions, signal).catch(() => null) : {};
      const answer: Record<string, unknown> = {};
      if (answers) {
        fields.forEach((f, i) => {
          const key = f.name || f.label || `field_${i}`;
          const val = answers[questions[i]?.question ?? ""];
          if (val !== undefined) answer[key] = val;
        });
      }
      await d.request("POST", `/api/session/${encodeURIComponent(targetSession)}/form/${encodeURIComponent(formId)}/reply`, { answer }).catch(() => {});
    } finally {
      this.pendingAsks--;
      this.maybeFinish();
    }
  }

  private finishTurn() {
    const fn = this.done;
    this.done = null;
    this.fail = null;
    fn?.();
  }

  private failTurn(e: Error) {
    const fn = this.fail;
    this.done = null;
    this.fail = null;
    fn?.(e);
  }
}

/**
  Opens an OpenCode session on the shared `opencode serve` V2 HTTP daemon, falling back to ACP
  automatically when `LINER_OPENCODE_ACP=1` is set or the installed binary lacks the V2 HTTP API.
*/
export function openOpenCodeServer(o: OpenOptions, fallbackOpen: (o: OpenOptions) => ProviderSession): ProviderSession {
  if (o.env.LINER_OPENCODE_ACP === "1") return fallbackOpen(o);
  return new OpenCodeServerSession(
    o,
    () => {
      const bin = which("opencode", o.env);
      if (!bin) throw new NoV2Server("opencode isn't installed.");
      return sharedOpenCodeDaemon(bin, o.env);
    },
    fallbackOpen,
  );
}
