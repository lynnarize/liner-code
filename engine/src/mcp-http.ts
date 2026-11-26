/*
  Liner MCP's app listener: a door of its own for apps, separate from the engine's (server.ts), on 127.0.0.1. It answers
  only these, and nothing of the app's own (/rpc, /events, /surface, /outside, the UI) is reachable through it:
  - POST/DELETE /mcp   MCP's Streamable HTTP (2025-06-18): a JSON-RPC message in, a JSON answer or an SSE stream out, with
                       Mcp-Session-Id. Every call carries `Authorization: Bearer <key or access token>` (mcp-apps.ts).
  - GET  /.well-known/oauth-protected-resource/mcp, /.well-known/oauth-authorization-server
  - POST /register, GET /authorize, POST /token   OAuth 2.1 for apps that sign in themselves (mcp-oauth.ts)
  A tunnel (tunnel.ts) points here and only here. A request is answered only when its Host is this listener's own address
  or the tunnel's public host, and an Origin, when one is sent, only when it's one of those: a web page that points a name of
  its own at 127.0.0.1 (DNS rebinding) is turned away. The engine's own server takes no public host at all.

  LinerMcp below ties it together for the engine: the apps, the gate, OAuth, the tunnel and Tell an app, started and stopped
  as Settings › Liner MCP says, and what Settings and the app's cards read.
*/
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { Access } from "../../contracts/src/index.ts";
import { MCP_KIND_NAMES, MCP_LEVELS, type McpAppKind, type McpLevel, type McpNewKey, type McpStatus } from "../../contracts/src/mcp.ts";
import type { McpResult } from "./agent-tools.ts";
import { McpApps, McpGate } from "./mcp-apps.ts";
import { McpOAuth, authorizationServer, protectedResource, urlsOf, type Reply } from "./mcp-oauth.ts";
import { SERVER_INSTRUCTIONS, toolDef, toolsFor } from "./mcp-tools.ts";
import { Tunnel, defaultDeps, ownAddress, type TunnelDeps } from "./tunnel.ts";
import { Webhook, webhookOk } from "./mcp-webhook.ts";
import type { Outside } from "./outside-tools.ts";
import type { Store } from "./store.ts";
import { VERSION } from "./version.ts";

/** The port apps are told, kept the same across launches so an address you forward yourself keeps working. */
export const MCP_PORT = 7318;
/** How long liner_wait holds a call that came over the internet: proxies between give up on a quiet call near a minute. */
export const WAIT_MAX_HTTP = 55;
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
/** Open MCP sessions an app may hold at once: the oldest goes past it. */
const SESSIONS_PER_APP = 20;
const MAX_BODY = 1024 * 1024;

/** `close` resolves once the port is let go, so turning it off and on again gets the same port back. */
type Listener = { port: number; close: () => Promise<void>; endApp: (appId: string) => void };
export type HttpOptions = {
  port: number;
  apps: McpApps;
  gate: McpGate;
  oauth: McpOAuth;
  /** The tunnel's (or your own address's) public host while it's up: the one name besides this listener's own it answers to. */
  publicHost: () => string | null;
  log?: (line: string) => void;
};

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => void res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers }).end(JSON.stringify(body));
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function readBody(req: IncomingMessage, cap: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > cap) throw new Error("too large");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, r: Reply) {
  if (r.html !== undefined) return void res.writeHead(r.status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...r.headers }).end(r.html);
  if (r.json !== undefined) return json(res, r.status, r.json, { pragma: "no-cache", ...r.headers });
  res.writeHead(r.status, { "cache-control": "no-store", ...r.headers }).end();
}

export function startMcpHttp(o: HttpOptions): Promise<Listener> {
  /** Open MCP sessions, each one app's, with the calls at work in it (ended when the app is revoked). */
  const sessions = new Map<string, { appId: string; at: number; work: Set<{ abort: () => void }> }>();
  let port = o.port;

  /** Only this listener's own address, or the public host while a tunnel is up. Never anything else. */
  const hostOk = (host: string | undefined) => {
    const h = String(host ?? "").toLowerCase();
    if (h === `127.0.0.1:${port}` || h === `localhost:${port}`) return true;
    const pub = o.publicHost();
    return Boolean(pub && (h === pub || h === `${pub}:443`));
  };
  const originOk = (origin: string | undefined) => {
    if (origin === undefined) return true;
    const pub = o.publicHost();
    return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}` || Boolean(pub && origin === `https://${pub}`);
  };
  /** Where this request came in, for the addresses OAuth hands out: the public https one through the tunnel, else this Mac's. */
  const originOf = (req: IncomingMessage) => {
    const h = String(req.headers.host ?? "").toLowerCase();
    const pub = o.publicHost();
    const fwd = String(req.headers["x-forwarded-host"] ?? "").toLowerCase();
    if (pub && (h === pub || h === `${pub}:443` || fwd === pub)) return `https://${pub}`;
    return `http://${h}`;
  };

  const unauthorized = (req: IncomingMessage, res: ServerResponse, given: boolean) =>
    json(res, 401, rpcError(null, -32001, "Liner Code needs a key or a sign-in for this. Add the app in Liner Code › Settings › Liner MCP."), { "www-authenticate": `Bearer resource_metadata="${originOf(req)}/.well-known/oauth-protected-resource/mcp"${given ? ', error="invalid_token"' : ""}` });

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (!hostOk(req.headers.host)) return void res.writeHead(403).end("Forbidden");
    if (!originOk(req.headers.origin)) return void res.writeHead(403).end("Forbidden");
    const url = URL.parse(req.url ?? "/", "http://localhost");
    if (!url) return void res.writeHead(400).end("Bad request");
    const path = url.pathname;
    const urls = urlsOf(originOf(req));
    if (path === "/.well-known/oauth-protected-resource/mcp" && req.method === "GET") return json(res, 200, protectedResource(urls));
    if (path === "/.well-known/oauth-authorization-server" && req.method === "GET") return json(res, 200, authorizationServer(urls));
    if (path === "/register" && req.method === "POST") {
      let meta: unknown;
      try {
        meta = JSON.parse(await readBody(req, 64 * 1024));
      } catch {
        return json(res, 400, { error: "invalid_client_metadata", error_description: "Send the client's metadata as JSON." });
      }
      return send(res, o.oauth.register(meta));
    }
    // Their limits are mcp-oauth.ts's, counting only what each takes in (a card made, a registration).
    if (path === "/authorize" && req.method === "GET") return send(res, o.oauth.authorize(url.searchParams, urls));
    if (path === "/token" && req.method === "POST") {
      let form: URLSearchParams;
      try {
        const raw = await readBody(req, 64 * 1024);
        form = String(req.headers["content-type"] ?? "").includes("application/json") ? new URLSearchParams(Object.entries(JSON.parse(raw) as Record<string, unknown>).map(([k, v]): [string, string] => [k, String(v)])) : new URLSearchParams(raw);
      } catch {
        return json(res, 400, { error: "invalid_request", error_description: "Send the request as a form." });
      }
      return send(res, o.oauth.token(form));
    }
    if (path !== "/mcp") return void res.writeHead(404).end("Not found");

    // The key first: nothing of the call is read before it has shown one of ours.
    const auth = String(req.headers.authorization ?? "");
    const bearer = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] ?? "";
    const app = o.apps.verify(bearer);
    if (!app) return unauthorized(req, res, Boolean(bearer));
    const version = req.headers["mcp-protocol-version"];
    if (typeof version === "string" && !PROTOCOLS.includes(version)) return json(res, 400, rpcError(null, -32600, `Liner Code speaks MCP ${PROTOCOLS[0]}.`));
    const sid = String(req.headers["mcp-session-id"] ?? "");
    if (req.method === "DELETE") {
      const s = sessions.get(sid);
      if (s && s.appId === app.id) sessions.delete(sid);
      return void res.writeHead(204).end();
    }
    // No stream of the server's own to offer: what an app is told comes in the answer to its call.
    if (req.method === "GET") return void res.writeHead(405, { allow: "POST, DELETE" }).end();
    if (req.method !== "POST") return void res.writeHead(405, { allow: "POST, DELETE" }).end();

    let msg: { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(await readBody(req, MAX_BODY));
    } catch {
      return json(res, 400, rpcError(null, -32700, "That isn't JSON."));
    }
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return json(res, 400, rpcError(null, -32600, "Send one JSON-RPC message at a time."));
    if (msg.method === "initialize") {
      const id = randomUUID();
      const mine = [...sessions].filter(([, s]) => s.appId === app.id).sort((a, b) => a[1].at - b[1].at);
      while (mine.length >= SESSIONS_PER_APP) sessions.delete(mine.shift()![0]);
      sessions.set(id, { appId: app.id, at: Date.now(), work: new Set() });
      const asked = String(msg.params?.protocolVersion ?? "");
      return json(res, 200, { jsonrpc: "2.0", id: msg.id ?? null, result: { protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: {} }, serverInfo: { name: "liner-code", title: "Liner Code", version: VERSION }, instructions: SERVER_INSTRUCTIONS } }, { "mcp-session-id": id });
    }
    const session = sessions.get(sid);
    if (!sid) return json(res, 400, rpcError(msg.id, -32600, "Start with initialize: there's no Mcp-Session-Id."));
    if (!session || session.appId !== app.id) return json(res, 404, rpcError(msg.id, -32001, "That session ended. Initialize again."));
    // A notification or a response: taken, nothing to say back.
    if (msg.id === undefined || msg.method === undefined) return void res.writeHead(202).end();
    if (msg.method === "ping") return json(res, 200, { jsonrpc: "2.0", id: msg.id, result: {} });
    if (msg.method === "tools/list") return json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { tools: toolsFor(o.gate.levelOf(app)) } });
    if (msg.method !== "tools/call") return json(res, 200, rpcError(msg.id, -32601, `No method ${String(msg.method).slice(0, 60)}`));

    const name = String(msg.params?.name ?? "");
    const args = (msg.params?.arguments && typeof msg.params.arguments === "object" ? msg.params.arguments : {}) as Record<string, unknown>;
    const gone = new AbortController();
    const entry = { abort: () => (gone.abort(), res.destroy()) };
    session.work.add(entry);
    res.on("close", () => (session.work.delete(entry), res.writableEnded || gone.abort()));
    // A call that may wait (on the session, or on your Allow) answers as a stream, with a comment every 15 seconds so
    // nothing between gives up on it; the rest answer plainly.
    const def = toolDef(name);
    const slow = Boolean(def && (name === "liner_wait" || def.asks)) && String(req.headers.accept ?? "").includes("text/event-stream");
    let beat: NodeJS.Timeout | undefined;
    if (slow) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no", "mcp-session-id": sid });
      res.flushHeaders();
      beat = setInterval(() => res.write(": still working\n\n"), 15_000);
    }
    let result: McpResult;
    try {
      result = await o.gate.call(app, name, args, { gone: gone.signal, waitMax: WAIT_MAX_HTTP });
    } finally {
      clearInterval(beat);
    }
    if (res.destroyed) return;
    const body = { jsonrpc: "2.0", id: msg.id, result };
    if (slow) return void res.end(`event: message\ndata: ${JSON.stringify(body)}\n\n`);
    json(res, 200, body, { "mcp-session-id": sid });
  };

  const server = createServer((req, res) => {
    void handle(req, res).catch((e) => {
      (o.log ?? ((l: string) => console.error(l)))(`[mcp] listener: ${e instanceof Error ? e.message : String(e)}`);
      if (!res.headersSent) res.writeHead(e instanceof Error && e.message === "too large" ? 413 : 500);
      res.end();
    });
  });
  // Slow clients don't hold the door open: headers within 20 seconds, and an idle connection goes after a minute.
  server.headersTimeout = 20_000;
  server.requestTimeout = 0;
  server.keepAliveTimeout = 60_000;

  return new Promise((resolve, reject) => {
    server.once("listening", () => {
      const a = server.address();
      port = typeof a === "object" && a ? a.port : o.port;
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            for (const s of sessions.values()) for (const w of s.work) w.abort();
            sessions.clear();
            server.close(() => done());
            server.closeAllConnections?.();
          }),
        endApp: (appId) => {
          for (const [id, s] of sessions)
            if (s.appId === appId) {
              for (const w of s.work) w.abort();
              sessions.delete(id);
            }
        },
      });
    });
    // The usual port taken (another copy, or something else): any free one, and Settings shows which.
    server.once("error", (e: NodeJS.ErrnoException) => {
      if (e.code !== "EADDRINUSE" || !o.port) return reject(e);
      // The free port it falls back to can fail too: that's said, not thrown past everyone.
      server.once("error", reject);
      server.listen(0, "127.0.0.1");
    });
    server.listen(o.port, "127.0.0.1");
  });
}

export type LinerMcpOptions = {
  store: Store;
  outside: Outside;
  env: NodeJS.ProcessEnv;
  /** The terminal command that adds the stdio server (api.ts outside.info). */
  command?: () => Promise<string>;
  runsOn?: (threadId: string) => string;
  runsOnRef?: (threadId: string) => string | undefined;
  /** The Tell an app secret, from the keychain. */
  secret?: () => string | undefined;
  tunnelDeps?: TunnelDeps;
  port?: number;
  log?: (line: string) => void;
};

/** Liner MCP for the engine: what main.ts starts and api.ts asks. */
export class LinerMcp {
  readonly apps: McpApps;
  readonly gate: McpGate;
  readonly oauth: McpOAuth;
  readonly tunnel: Tunnel;
  readonly webhook: Webhook;
  private o: LinerMcpOptions;
  private listener: Listener | null = null;
  /** The applies asked for, one after another: two at once would each open a listener of their own. */
  private applying: Promise<void> = Promise.resolve();
  /** Set by stop (the engine quitting): a listener still opening then is closed, not kept. */
  private stopped = false;
  /** What the tunnel was last started with, so a settings save that changes nothing of it leaves it running. */
  private tunnelFor = "";

  constructor(o: LinerMcpOptions) {
    this.o = o;
    const { store, outside } = o;
    this.apps = new McpApps(store.home);
    this.oauth = new McpOAuth(this.apps);
    this.gate = new McpGate({
      apps: this.apps,
      runner: outside,
      defaultAccess: () => store.settings.defaultAccess as Access,
      stdioLevel: () => outside.stdioLevel,
      runsOn: o.runsOn,
      runsOnRef: o.runsOnRef,
      onAsks: () => this.emit(),
      trustStdio: () => {
        store.setSettings({ mcpStdioLevel: "trusted" });
        outside.relevel();
      },
      log: o.log,
    });
    this.oauth.onChange = () => this.emit();
    // An app added, revoked or just heard from: Settings reads the list again.
    this.apps.onChange = () => this.emit();
    this.apps.onGone = (id) => {
      this.listener?.endApp(id);
      this.gate.dropApp(id);
    };
    this.tunnel = new Tunnel(o.tunnelDeps ?? defaultDeps(o.env));
    this.tunnel.onChange = () => this.emit();
    this.webhook = new Webhook({ url: () => store.settings.mcpWebhook, secret: () => o.secret?.(), log: o.log });
    store.on((e) => this.webhook.hear(e));
  }

  private emit() {
    this.o.store.emit({ type: "mcp", asks: this.gate.list(), signIns: this.oauth.list() });
  }

  get on() {
    return this.o.store.settings.outside === true;
  }
  get port() {
    return this.listener?.port ?? 0;
  }

  /**
    As Settings say: the listener up while apps are let in, and the tunnel you picked up with it; both down when they aren't.
    Applies run one after another, each reading the settings as they are when its turn comes, so the latest wins. Switched
    off, a tunnel still starting is stopped at once rather than after its turn.
  */
  apply(): Promise<void> {
    if (!this.on) {
      this.tunnelFor = "";
      void this.tunnel.stop().catch(() => {});
    }
    const turn = this.applying.then(() => this.applyNow());
    // A listener that failed to start is tried again on the next apply, not waited on for good.
    this.applying = turn.catch(() => {});
    return turn;
  }

  private async applyNow() {
    // What terminal agents may do is in outside.json too, for the stdio server's list: kept as the setting says.
    this.o.outside.relevel();
    if (!this.on || this.stopped) {
      this.tunnelFor = "";
      await this.tunnel.stop();
      const l = this.listener;
      this.listener = null;
      // Let go of before anything listens again, so off and on keeps the same port.
      await l?.close();
      return;
    }
    if (!this.listener) {
      const l = await startMcpHttp({ port: this.o.port ?? MCP_PORT, apps: this.apps, gate: this.gate, oauth: this.oauth, publicHost: () => this.tunnel.host, log: this.o.log });
      if (this.stopped) return l.close();
      this.listener = l;
    }
    // Switched off while the listener opened: the apply that did it comes next and closes it; no tunnel starts before.
    if (!this.on) return;
    const s = this.o.store.settings;
    const want = `${s.mcpReach ?? "off"}\n${s.mcpReach === "own" ? (s.mcpOwnUrl ?? "") : ""}\n${this.port}`;
    if (want !== this.tunnelFor) {
      this.tunnelFor = want;
      await this.tunnel.start(s.mcpReach ?? "off", this.port, s.mcpOwnUrl);
    }
  }

  /** Tries the tunnel again (it went down, or you installed the tool since). */
  async retry() {
    this.tunnelFor = "";
    await this.apply();
  }

  async stop() {
    this.stopped = true;
    this.apps.flush();
    await this.tunnel.stop();
    const l = this.listener;
    this.listener = null;
    await l?.close();
  }

  /** A terminal agent's call over stdio: refused when you revoked it by name, else through the same gate. */
  callStdio(client: string | undefined, tool: string, args: Record<string, unknown>, gone?: AbortSignal): Promise<McpResult> {
    const app = this.apps.stdio(client ?? "");
    if (app.blocked) return Promise.resolve({ content: [{ type: "text", text: "Liner Code turned this app away. It can be let in again in Settings › Liner MCP." }], isError: true });
    return this.gate.call(app, tool, args, { gone, waitMax: 240 });
  }

  async status(): Promise<McpStatus> {
    const s = this.o.store.settings;
    const local = this.port ? `http://127.0.0.1:${this.port}/mcp` : "";
    return {
      on: this.on,
      port: this.port,
      localUrl: local,
      command: (await this.o.command?.().catch(() => "")) ?? "",
      reach: s.mcpReach ?? "off",
      ...(this.tunnel.now.url ? { publicUrl: this.tunnel.now.url } : {}),
      tunnel: { state: this.tunnel.now.state, ...(this.tunnel.now.note ? { note: this.tunnel.now.note } : {}), found: await this.tunnel.found() },
      stdioLevel: this.o.outside.stdioLevel,
      ...(s.mcpWebhook ? { webhook: { url: s.mcpWebhook, hasSecret: Boolean(this.o.secret?.()) } } : {}),
      apps: this.apps.list(),
    };
  }

  /** Add an app: a key for it, shown once, and the address to give it (the public one when there is one). */
  addApp(p: { kind: McpAppKind; level: McpLevel; name?: string }): McpNewKey {
    if (!Object.hasOwn(MCP_KIND_NAMES, p.kind) || p.kind === "terminal") throw new Error("That isn't an app Liner can add with a key.");
    if (!MCP_LEVELS.includes(p.level)) throw new Error("That isn't a level.");
    // With apps kept out there's no address to give it, and a key made then would be one nobody can use yet.
    if (!this.on || !this.port) throw new Error("Let apps outside Liner Code in first, in Settings › Liner MCP. Then add the app.");
    // Two of the same kind are told apart: Another app, Another app 2… unless you named it.
    const { app, key } = this.apps.create({ name: p.name?.trim() || this.apps.freeName(MCP_KIND_NAMES[p.kind]), kind: p.kind, level: p.level });
    return { app, key, url: this.tunnel.now.url ?? `http://127.0.0.1:${this.port}/mcp` };
  }

  setLevel(id: string, level: McpLevel) {
    if (!MCP_LEVELS.includes(level)) throw new Error("That isn't a level.");
    return this.apps.setLevel(id, level);
  }

  /** The cards' state for an app window that has just opened. */
  cards() {
    return { asks: this.gate.list(), signIns: this.oauth.list() };
  }
}

/** Settings › Liner MCP keys, checked before they're saved: a way that's known, an https address, a level. */
export function checkMcpPatch(patch: Record<string, unknown>) {
  if (patch.mcpReach !== undefined && !["off", "tailscale", "cloudflare", "own"].includes(String(patch.mcpReach))) throw new Error("That isn't a way in from the internet.");
  if (patch.mcpOwnUrl !== undefined && patch.mcpOwnUrl !== "" && !ownAddress(String(patch.mcpOwnUrl))) throw new Error("Your own address must be an https address, like https://liner.example.com.");
  if (patch.mcpStdioLevel !== undefined && !MCP_LEVELS.includes(patch.mcpStdioLevel as McpLevel)) throw new Error("That isn't a level.");
  if (patch.mcpWebhook !== undefined && patch.mcpWebhook !== "" && !webhookOk(patch.mcpWebhook)) throw new Error("Tell an app needs an https address on the internet, not one on this computer or a private network.");
  if (patch.mcpOwnUrl === "") patch.mcpOwnUrl = undefined;
  if (patch.mcpWebhook === "") patch.mcpWebhook = undefined;
}
