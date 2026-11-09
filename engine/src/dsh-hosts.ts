/*
  Ported DeepSeek Harness plugins' Node halves, from the engine's side: one process each
  (dsh-host.ts), started when its frame first opens, stopped when it's turned off, removed or
  replaced, and when Liner Code quits. None of it runs in the engine.

  Its frame reaches it at /dsh/<token>/ on the engine's own address: a token made for this run,
  which only that frame's document is given, and which reaches that plugin and nothing else. The
  engine passes each request on to the process's 127.0.0.1 port with the run's secret, and answers
  the package's pictures (plugins/<package>/assets/…) from its kept files itself, as DSH's /plugins
  route does. The frame's origin is opaque, so these answers say any origin may read them: the
  token is what's guarded.

  On a Mac the process runs under a sandbox (sandbox-exec): it reads what you can, but not your
  keys (.ssh, .aws, keychains and the like) nor Liner Code's own state beyond its add-on; it writes
  only in DeepSeek Harness's folder of Liner Code's (DSH_HOME, ~/.liner-code/dsh), the temporary
  folders, and Documents, Downloads, Desktop, Pictures, Movies and Music. It gets your PATH and
  home, never the engine's keys or token, and none of the environment's API keys.

  Its model calls are an app's: the model you picked for it (Settings.addonModels), asked as just a
  model through the engine (api.ts, aiFor), with the same limits, streamed back to it.

  The tools it gives an agent reach yours as an MCP server: each agent tool starts dsh-mcp.ts, a
  small stdio server of Liner Code's, which brings the agent's calls to /dsh/<agent token>/mcp on
  the engine (a token of its own, never a frame's), and the engine to the plugin's process over
  IPC, starting it if it isn't running. Only the tools its card named are offered or run, and only
  while its add-on is on.
*/
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, openSync, closeSync, realpathSync, statSync, writeSync, ftruncateSync, fstatSync } from "node:fs";
import { request, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir, tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DshFrame, DshTool, PanelManifest } from "../../contracts/src/index.ts";
import { DSH_TOKEN } from "../../contracts/src/index.ts";
import type { Addons, Connection } from "./addons.ts";

/** A tool as MCP lists it. */
type McpTool = { name: string; description: string; inputSchema: unknown };
/** What a call comes back as, for the agent: MCP's CallToolResult. */
type CallResult = { content: { type: string; [k: string]: unknown }[]; isError?: boolean };
type Run = { id: string; version: number; child: ChildProcess; secret: string; ready: Promise<number>; port?: number; error?: string; log: number; tools: McpTool[]; instructions: string; calls: Map<string, (r: CallResult) => void> };
/** A ported plugin with a program, as its manifest has it: a page's or a connection's. */
type Dsh = { id: string; name: string; dsh: { package: string; host?: string; config?: Record<string, unknown>; tools?: DshTool[] } };
type Ask = (addon: string, name: string, o: { prompt: string; system?: string; call: string; onText: (t: string) => void }) => Promise<{ text: string }>;

/** A call of a plugin's, named for it: a name it chose can't be another app's. */
const callOf = (id: string, call: string) => `dsh:${id}:${call.slice(0, 80)}`;
const PICTURES: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif" };
const LOG_MAX = 1_000_000;
const START_WAIT = 25_000;
/** The calls an agent may have running in one plugin at once, and the most a call's arguments may weigh. */
const CALLS_MAX = 16;
const BODY_MAX = 4_000_000;

/** SBPL's quoting for a path. */
const q = (p: string) => `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/**
  The sandbox a plugin's process runs under on a Mac: everything as you, but no reading your keys,
  your agents' sign-ins or Liner Code's state; writes only where it keeps its own and where you keep
  documents, and even there nothing that makes code run later (a repository's .git or .claude, a
  package.json, a .command); and none of the programs that would start something outside it (open,
  osascript, launchctl, security). A sandbox narrows what a program does, not who wrote it: the
  card asks you to trust where it's from.
*/
export function sandboxProfile(o: { home: string; linerHome: string; dshHome: string; addonDir: string; tmp: string }) {
  const h = (p: string) => join(o.home, p);
  // A folder that's a link (dotfiles kept elsewhere) is ruled by where it leads, and by its own name.
  const both = (p: string) => [...new Set([p, real(p)])];
  const writable = [o.dshHome, "/private/tmp", "/private/var/folders", o.tmp, "/dev", ...["Documents", "Downloads", "Desktop", "Pictures", "Movies", "Music"].map(h)].flatMap(both);
  const secret = [
    ...[".ssh", ".aws", ".gnupg", ".kube", ".docker", ".config", ".azure", ".netrc", ".npmrc", ".pypirc", ".git-credentials", ".gitconfig", ".claude", ".claude.json", ".codex", ".cursor", ".gemini", ".hermes", ".local/share", ".zsh_history", ".bash_history", ".zshrc", ".bashrc", ".profile", ".zprofile", ".env"].map(h),
    ...["Keychains", "Cookies", "Mail", "Messages", "Safari", "Application Support/Google", "Application Support/Firefox", "Application Support/Arc", "Application Support/BraveSoftware", "Application Support/Claude", "Application Support/Liner Code", "Application Support/Code/User"].map((p) => h(`Library/${p}`)),
    o.linerHome,
  ].flatMap(both);
  return [
    "(version 1)",
    "(allow default)",
    '(deny file-write* (subpath "/"))',
    `(allow file-write* ${writable.map((p) => `(subpath ${q(p)})`).join(" ")})`,
    // Later rules of the same operation win: these hold inside the folders above too.
    '(deny file-write* (regex #"/\\.(git|hg|svn|claude|liner|codex|cursor|vscode|idea|husky|github|direnv)(/|$)") (regex #"/(package\\.json|[Mm]akefile|\\.envrc|\\.npmrc|\\.yarnrc(\\.yml)?|Gemfile|Dockerfile)$") (regex #"\\.(command|tool|terminal|app|workflow|scpt|plist|sh|zsh|bash)(/|$)"))',
    // What's in them, not that they're there: Node looks up each folder on a path as it loads a file.
    `(deny file-read-data ${secret.map((p) => `(subpath ${q(p)})`).join(" ")})`,
    // The same operation as the rule above, or it doesn't take its place.
    `(allow file-read-data ${[o.addonDir, o.dshHome].flatMap(both).map((p) => `(subpath ${q(p)})`).join(" ")})`,
    '(deny process-exec (literal "/usr/bin/open") (literal "/usr/bin/osascript") (literal "/bin/launchctl") (literal "/usr/bin/security") (literal "/usr/bin/sudo") (literal "/usr/sbin/installer"))',
  ].join("\n");
}

/** What the sandbox lets its program do, in words, for the card: null where there's none (not a Mac). */
export const sandboxWords = (platform = process.platform) =>
  platform === "darwin" && existsSync("/usr/bin/sandbox-exec") ? "Runs as you, in a process of its own. A sandbox keeps it from your keys, your sign-ins, Liner Code's state and other apps, and lets it write only in its own folder and your Documents, Downloads, Desktop, Pictures, Movies and Music." : null;

export class DshHosts {
  private addons: Addons;
  private env: NodeJS.ProcessEnv;
  private linerHome: string;
  private runs = new Map<string, Run>();
  /** This run's tokens, both ways: one per add-on, made when its frame first asks. */
  private tokens = new Map<string, string>();
  private ids = new Map<string, string>();
  /** Calls its process is waiting on, to stop when it asks or goes. */
  private asking = new Map<string, { id: string }>();
  /** This run's tokens for your agents' tool calls, one per add-on: never a frame's, nor given to one. */
  private agentTokens = new Map<string, string>();
  private agentIds = new Map<string, string>();
  /** The engine's own address (http://127.0.0.1:<port>), where an agent's MCP server brings its calls; set once it listens. */
  url?: string;
  /** The model an app asks: answered by api.ts (aiFor), set once the API is made. */
  ask?: Ask;
  cancel?: (call: string) => void;
  modelOf?: (addon: string) => string | null;
  /** Off for a test: no sandbox. */
  sandbox = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");
  readonly dshHome: string;

  constructor(addons: Addons, env: NodeJS.ProcessEnv, linerHome: string) {
    this.addons = addons;
    this.env = env;
    this.linerHome = linerHome;
    this.dshHome = join(linerHome, "dsh");
    // The tools a ported plugin gives your agents reach them as a connection of its own.
    addons.dshTools = (id, name) => this.connection(id, name);
  }

  /**
    What an agent tool starts for a plugin's tools: Liner Code's MCP server on stdio (dsh-mcp.ts),
    told where to bring its calls by its environment, never its command line. None before the
    engine listens.
  */
  connection(id: string, name: string): Connection | null {
    if (!this.url) return null;
    let token = this.agentTokens.get(id);
    if (!token) {
      token = randomBytes(16).toString("hex");
      this.agentTokens.set(id, token);
      this.agentIds.set(token, id);
    }
    // Under the Electron shell process.execPath is the app itself, which is a Node only when told so.
    const electron: Record<string, string> = process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};
    return { name: id, stdio: { command: process.execPath, args: [fileURLToPath(new URL("./dsh-mcp.ts", import.meta.url))], env: { ...electron, LINER_DSH_URL: `${this.url}/dsh/${token}/mcp`, LINER_DSH_NAME: name } } };
  }

  /** A model picked or changed: each process hears it, for its currentSelection(). */
  models() {
    for (const r of this.runs.values()) r.child.connected && r.child.send({ t: "model", model: this.modelOf?.(r.id) ?? null });
  }

  /** The add-ons changed: a process whose add-on is off, removed or on another version stops. */
  changed() {
    for (const r of [...this.runs.values()]) {
      const m = this.addons.dshOf(r.id);
      if (!m?.dsh.host || this.addons.get(r.id)?.version !== r.version) this.stop(r.id);
    }
  }

  /** What a ported plugin's frame needs to start: its token's path, and its Node half up (or why not). */
  async frame(m: PanelManifest, version: number): Promise<DshFrame> {
    const dsh = m.dsh!;
    let token = this.tokens.get(m.id);
    if (!token) {
      token = randomBytes(16).toString("hex");
      this.tokens.set(m.id, token);
      this.ids.set(token, m.id);
    }
    const out: DshFrame = { package: dsh.package, slot: dsh.slot, ...(dsh.config ? { config: dsh.config } : {}), base: `/dsh/${token}/` };
    if (!dsh.host) return out;
    try {
      await this.start({ id: m.id, name: m.name, dsh }, version);
    } catch (e) {
      out.error = e instanceof Error ? e.message : String(e);
    }
    return out;
  }

  private start(m: Dsh, version: number): Promise<number> {
    const have = this.runs.get(m.id);
    if (have && have.version === version && !have.error && have.child.exitCode === null) return have.ready;
    if (have) this.stop(m.id);
    const dir = this.addons.packageDir(m.id, version);
    if (!dir) return Promise.reject(new Error("Its package isn't kept: add it again."));
    mkdirSync(this.dshHome, { recursive: true });
    const addonDir = join(this.addons.dir, m.id);
    const logFile = join(addonDir, "host.log");
    const log = openSync(logFile, "a");
    if (fstatSync(log).size > LOG_MAX) ftruncateSync(log, 0);
    const script = fileURLToPath(new URL("./dsh-host.ts", import.meta.url));
    const node = process.execPath;
    const e = this.env;
    // Your PATH and home, DSH's folder, and nothing else of the engine's: no keys, no token.
    const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries({ PATH: e.PATH, HOME: e.HOME ?? homedir(), USER: e.USER, LOGNAME: e.LOGNAME, SHELL: e.SHELL, LANG: e.LANG ?? "en_US.UTF-8", LC_ALL: e.LC_ALL, TMPDIR: e.TMPDIR, TZ: e.TZ, SystemRoot: e.SystemRoot, APPDATA: e.APPDATA, LOCALAPPDATA: e.LOCALAPPDATA, USERPROFILE: e.USERPROFILE, DSH_HOME: this.dshHome, NODE_NO_WARNINGS: "1", ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) }).filter(([, v]) => v !== undefined));
    const args = ["--disable-warning=ExperimentalWarning", script];
    const sandboxed = this.sandbox ? ["-p", sandboxProfile({ home: env.HOME!, linerHome: this.linerHome, dshHome: this.dshHome, addonDir, tmp: tmpdir() }), node, ...args] : null;
    // A process group of its own, so what it starts goes when it does.
    const child = spawn(sandboxed ? "/usr/bin/sandbox-exec" : node, sandboxed ?? args, { cwd: dir, env, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true, detached: process.platform !== "win32" });
    const write = (b: Buffer) => {
      try {
        writeSync(log, b);
      } catch {
        // A full disk: its log goes, it doesn't.
      }
    };
    child.stdout?.on("data", write);
    child.stderr?.on("data", write);
    const secret = randomBytes(24).toString("hex");
    let settle: { ok: (p: number) => void; no: (e: Error) => void } | undefined;
    const ready = new Promise<number>((ok, no) => (settle = { ok, no }));
    // Waited on by its frame and by the proxy: a failure is said where it's asked for.
    ready.catch(() => {});
    const run: Run = { id: m.id, version, child, secret, ready, log, tools: [], instructions: "", calls: new Map() };
    this.runs.set(m.id, run);
    const timer = setTimeout(() => {
      run.error = "Its program took too long to start.";
      settle?.no(new Error(run.error));
      child.kill();
    }, START_WAIT);
    child.on("message", (raw: unknown) => {
      const msg = raw as { t?: string; port?: number; error?: string; call?: string; prompt?: string; system?: string; tools?: unknown; instructions?: unknown; content?: unknown; isError?: unknown };
      // What it offers your agents: only the tools its card named, however its program lists them.
      const offers = () => {
        const named = new Set((m.dsh.tools ?? []).map((t) => t.name));
        if (Array.isArray(msg.tools)) run.tools = (msg.tools as McpTool[]).filter((t) => t && typeof t.name === "string" && named.has(t.name)).map((t) => ({ name: t.name, description: String(t.description ?? "").slice(0, 4000), inputSchema: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object" } }));
        if (typeof msg.instructions === "string") run.instructions = msg.instructions.slice(0, 8000);
      };
      if (msg.t === "ready" && typeof msg.port === "number") {
        clearTimeout(timer);
        run.port = msg.port;
        offers();
        settle?.ok(msg.port);
      } else if (msg.t === "tools") offers();
      else if (msg.t === "result" && typeof msg.call === "string") {
        const done = run.calls.get(msg.call);
        run.calls.delete(msg.call);
        done?.({ content: Array.isArray(msg.content) ? (msg.content as CallResult["content"]) : [{ type: "text", text: "(no output)" }], ...(msg.isError === true ? { isError: true } : {}) });
      } else if (msg.t === "failed") {
        clearTimeout(timer);
        run.error = String(msg.error ?? "It stopped as it started.");
        settle?.no(new Error(run.error));
        child.kill();
      } else if (msg.t === "ask" && typeof msg.call === "string") void this.answer(run, m, msg.call, String(msg.prompt ?? ""), msg.system);
      // Its own calls only: each is named for it, so it can't stop another app's.
      else if (msg.t === "cancel" && typeof msg.call === "string" && this.asking.get(callOf(run.id, msg.call))?.id === run.id) this.cancel?.(callOf(run.id, msg.call));
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      run.error = `Its program couldn't start: ${err.message}`;
      settle?.no(new Error(run.error));
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (!run.error && run.port === undefined) run.error = `Its program stopped as it started (${signal ?? `exit ${code}`}). Its log: ${logFile}`;
      settle?.no(new Error(run.error ?? "Its program stopped."));
      for (const [call, a] of this.asking) if (a.id === run.id) this.cancel?.(call), this.asking.delete(call);
      for (const done of run.calls.values()) done({ content: [{ type: "text", text: `${m.name}'s program stopped before it answered. Its log: ${logFile}` }], isError: true });
      run.calls.clear();
      try {
        closeSync(log);
      } catch {
        // Closed already.
      }
      if (this.runs.get(run.id) === run) this.runs.delete(run.id);
    });
    child.send({ t: "start", dir, entry: m.dsh.host!, config: m.dsh.config ?? {}, name: m.name, secret, model: this.modelOf?.(m.id) ?? null, tools: (m.dsh.tools ?? []).map((t) => t.name) });
    return ready;
  }

  private async answer(run: Run, m: Dsh, call: string, prompt: string, system?: string) {
    const back = (x: Record<string, unknown>) => run.child.connected && run.child.send(x);
    if (!this.ask) return back({ t: "fail", call, error: "Models aren't available here." });
    const key = callOf(run.id, call);
    if (this.asking.has(key)) return back({ t: "fail", call, error: "That call is already being answered." });
    this.asking.set(key, { id: run.id });
    try {
      await this.ask(run.id, m.name, { prompt, system, call: key, onText: (text) => back({ t: "text", call, text }) });
      back({ t: "done", call });
    } catch (e) {
      back({ t: "fail", call, error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.asking.delete(key);
    }
  }

  stop(id: string) {
    const r = this.runs.get(id);
    if (!r) return;
    this.runs.delete(id);
    r.error ??= "It was stopped.";
    try {
      r.child.disconnect();
    } catch {
      // Gone already.
    }
    // Its group: what it started too. Its own stop is held to two seconds (dsh-host.ts), and this backs it.
    const kill = (sig: NodeJS.Signals) => {
      try {
        if (r.child.pid && process.platform !== "win32") process.kill(-r.child.pid, sig);
        else r.child.kill(sig);
      } catch {
        // Gone already.
      }
    };
    kill("SIGTERM");
    const t = setTimeout(() => kill("SIGKILL"), 3000);
    t.unref();
  }

  stopAll() {
    for (const id of [...this.runs.keys()]) this.stop(id);
  }

  /**
    A request from a frame for /dsh/<token>/<rest>: its package's pictures, or its Node half. False
    when the token isn't one of this run's (the caller answers 404).
  */
  serve(token: string, rest: string, search: string, req: IncomingMessage, res: ServerResponse): boolean {
    if (!DSH_TOKEN.test(token)) return false;
    const agent = this.agentIds.get(token);
    if (agent) return void this.mcp(agent, rest, req, res), true;
    const id = this.ids.get(token);
    if (!id) return false;
    const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS", "access-control-allow-headers": String(req.headers["access-control-request-headers"] ?? "content-type"), "access-control-max-age": "600", vary: "origin" };
    if (req.method === "OPTIONS") return void res.writeHead(204, cors).end(), true;
    const m = this.addons.panel(id);
    const version = this.addons.get(id)?.version;
    if (!m?.dsh || version === undefined) return void res.writeHead(404, cors).end(), true;
    // Its package's pictures, as DSH serves them: plugins/<package>/assets/<path>.
    const own = `plugins/${m.dsh.package}/assets/`;
    if (rest.startsWith(own)) {
      const dir = this.addons.packageDir(id, version);
      let path: string;
      try {
        path = decodeURIComponent(rest.slice(own.length));
      } catch {
        return void res.writeHead(400, cors).end(), true;
      }
      const file = dir ? resolve(dir, "assets", path) : "";
      const rel = dir ? relative(join(dir, "assets"), file) : "..";
      const type = PICTURES[extname(file).toLowerCase()];
      if (!type || !rel || rel.startsWith("..") || isAbsolute(rel) || !existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404, cors).end(), true;
      res.writeHead(200, { ...cors, "content-type": type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", ...(type === "image/svg+xml" ? { "content-security-policy": "script-src 'none'" } : {}) });
      createReadStream(file).pipe(res);
      return true;
    }
    if (!m.dsh.host) return void res.writeHead(404, cors).end(), true;
    void this.start({ id: m.id, name: m.name, dsh: m.dsh }, version).then(
      (port) => {
        const run = this.runs.get(id);
        if (!run) return void res.writeHead(503, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ error: `${m.name}'s program stopped.` }));
        const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: `127.0.0.1:${port}`, "x-liner-dsh": run.secret };
        delete headers.origin;
        delete headers.referer;
        delete headers["x-liner-token"];
        const up = request({ host: "127.0.0.1", port, method: req.method, path: `/${rest}${search}`, headers }, (r) => {
          // Its answer, but nothing that would act on the app's own origin: no cookies, no clearing its storage.
          const back: Record<string, string | string[] | undefined> = { ...r.headers, ...cors };
          for (const h of ["set-cookie", "clear-site-data", "service-worker-allowed", "refresh", "link"]) delete back[h];
          res.writeHead(r.statusCode ?? 502, back);
          r.on("error", () => res.destroy());
          r.on("aborted", () => res.destroy());
          r.pipe(res);
        });
        up.on("error", (e) => {
          if (res.headersSent) return void res.destroy();
          res.writeHead(502, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ error: `${m.name}'s program didn't answer: ${e.message}` }));
        });
        // The frame gone: its request to the program goes too.
        res.on("close", () => !res.writableFinished && up.destroy());
        req.pipe(up);
      },
      (e: unknown) => {
        res.writeHead(503, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      },
    );
    return true;
  }

  /**
    An agent's MCP server (dsh-mcp.ts) asking for a plugin's tools, or calling one: { op: "list" }
    or { op: "call", name, arguments }. Its program starts if it isn't running. A call's answer is
    held open with a space every 20 seconds, so a long one isn't given up on, and the agent's going
    stops it.
  */
  private async mcp(id: string, rest: string, req: IncomingMessage, res: ServerResponse) {
    const json = (status: number, body: unknown) => void res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
    if (rest !== "mcp" || req.method !== "POST") return json(404, { error: "Not found" });
    const m = this.addons.dshOf(id);
    const version = this.addons.get(id)?.version;
    // While its add-on is on and gives tools: off, removed or replaced by one that doesn't, it reaches nothing.
    if (!m?.dsh.host || !m.dsh.tools?.length || version === undefined) return json(404, { error: "That add-on is off in Liner Code, or gives your agents no tools now." });
    let body: { op?: unknown; name?: unknown; arguments?: unknown };
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > BODY_MAX) throw new Error("too large");
        chunks.push(c as Buffer);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as typeof body;
    } catch {
      return json(400, { error: "That isn't a call Liner Code reads." });
    }
    let run: Run | undefined;
    try {
      await this.start(m, version);
      run = this.runs.get(id);
    } catch (e) {
      return json(503, { error: `${m.name}'s program didn't start: ${e instanceof Error ? e.message : String(e)}` });
    }
    if (!run) return json(503, { error: `${m.name}'s program stopped.` });
    if (body.op === "list") return json(200, { tools: run.tools, ...(run.instructions ? { instructions: run.instructions } : {}) });
    if (body.op !== "call" || typeof body.name !== "string") return json(400, { error: "That isn't a call Liner Code reads." });
    const name = body.name;
    const said = (text: string): CallResult => ({ content: [{ type: "text", text }], isError: true });
    if (!run.tools.some((t) => t.name === name)) return json(200, said(`${m.name} gives your agents no tool called ${name.slice(0, 80)}.`));
    if (run.calls.size >= CALLS_MAX) return json(200, said(`${m.name} is already running ${CALLS_MAX} calls: try again when one is done.`));
    const r = run;
    const call = randomBytes(8).toString("hex");
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    const beat = setInterval(() => res.write(" "), 20_000);
    r.calls.set(call, (result) => {
      clearInterval(beat);
      res.end(JSON.stringify(result));
    });
    res.on("close", () => {
      clearInterval(beat);
      // The agent went (its call called off, or itself gone): the program stops that call.
      if (r.calls.delete(call) && r.child.connected) r.child.send({ t: "abort", call });
    });
    if (r.child.connected) r.child.send({ t: "call", call, name, args: body.arguments && typeof body.arguments === "object" ? body.arguments : {} });
    else r.calls.get(call)?.(said(`${m.name}'s program stopped.`)), r.calls.delete(call);
  }
}
