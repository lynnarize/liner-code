/*
  The engine's front door, on 127.0.0.1 only:
  - GET  /events   a stream of EngineEvents (newline-delimited JSON), starting with a snapshot
  - POST /rpc      { method, params } → { ok, result } or { ok: false, error }
  - POST /surface  { tool, args } from an agent's Liner Code tools (mcp.ts), with that session's
                   own key (x-liner-surface), which reaches its surfaces and nothing else
  - POST /outside  { tool, args } from an agent outside Liner Code (outside.ts), with the key in
                   outside.json (x-liner-outside), only while that's on in Settings
  - ANY  /dsh/<token>/…  a ported DeepSeek Harness plugin's own program and pictures, for its
                   frame alone: the token, made for this run, stands in for the app's (dsh-hosts.ts)
  - POST /promo/v1/chat/completions, GET /promo/v1/models  the promo's model, for OpenCode, with a
                   key made for this run: sent on to Liner Code's site with the voucher (promo.ts)
  - GET  /*        the built app, when there is one
  Every other request carries the token the shell made (x-liner-token), so other apps and web
  pages on this machine can't drive your agents.
*/
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { PANEL_FRAME, checkConnections, panelFrame, rpcErrorCode, type EngineEvent, type Snapshot } from "../../contracts/src/index.ts";
import type { Store } from "./store.ts";
import { PROMO_PATH } from "./promo.ts";

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".ico": "image/x-icon" };

type Api = { call(method: string, params: unknown): Promise<unknown>; ready: Promise<unknown> };
type Hooks = (id: string, key: string, body: unknown, headers: Record<string, string>) => boolean;
/** `gone`: the caller let go of the call before its answer (its tool cancelled it, or its MCP server went away). */
/** `client`: the name a terminal agent gave the stdio server (outside.ts), for Liner MCP's list of apps. */
type Surface = (key: string, tool: string, args: Record<string, unknown>, gone?: AbortSignal, client?: string) => Promise<unknown> | null;
type Outside = Surface;
/** A panel being checked out of sight (agent-tools.ts): its page, its bridge's calls, its report, and word once it has settled. */
type Check = { page(token: string): string | null; call(token: string, body: Record<string, unknown>): Promise<unknown>; report(token: string, body: unknown): void; settle(token: string): Promise<void> };
/** A ported plugin's request: true when it was its to answer. */
type Dsh = (token: string, rest: string, search: string, req: IncomingMessage, res: ServerResponse) => boolean;
/** The promo's relay (promo.ts): `rest` is what follows /promo/v1. */
type Promo = (rest: string, req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** How long the stream gathers lines before one write to each app: a token streamed is an event, and twenty sessions streaming are a thousand a second. */
export const BATCH_MS = 16;
/** What may wait unread for one app before it's let go: one that stopped reading (a frozen window) reconnects to a fresh snapshot instead of filling the engine's memory. */
export const BEHIND_BYTES = 4 * 1024 * 1024;

/** `alone`: the last app's event stream closed, so no window is open to let go of what it watched (a reload never says off). */
export function startServer(o: { store: Store; api: Api; snapshot: () => Promise<Snapshot>; token: string; port: number; ui?: string; hooks?: Hooks; surface?: Surface; outside?: Outside; /** Whether a key is one of ours, asked before a call's body is read: a caller without one isn't worth 64 MB of reading. Unset: the call itself says. */ knows?: { surface(key: string): boolean; outside(key: string): boolean }; check?: Check; dsh?: Dsh; promo?: Promo; alone?: () => void }) {
  const { store, api, token } = o;
  const clients = new Set<ServerResponse>();
  /** Clients whose snapshot is being taken: what's sent meanwhile waits, numbered, until it's written. */
  const waiting = new Map<ServerResponse, { seq: number; line: string }[]>();
  /** Lines for each app since the last write, each whole and numbered as it was made, sent together every BATCH_MS. Gathered, never merged. */
  const out = new Map<ServerResponse, string[]>();
  let batch: NodeJS.Timeout | undefined;
  const flush = () => {
    clearTimeout(batch);
    batch = undefined;
    for (const [res, lines] of out) {
      out.delete(res);
      if (res.destroyed) continue;
      // An app that has stopped reading: let go, so it comes back to a snapshot rather than the engine holding all it missed.
      if (res.writableLength > BEHIND_BYTES) {
        res.destroy();
        continue;
      }
      res.write(lines.join(""));
    }
  };
  store.on((e: EngineEvent) => {
    const line = `${JSON.stringify({ ...e, seq: store.seq })}\n`;
    for (const res of clients) {
      const held = waiting.get(res);
      if (held) held.push({ seq: store.seq, line });
      else {
        const lines = out.get(res);
        if (lines) lines.push(line);
        else out.set(res, [line]);
        batch ??= setTimeout(flush, BATCH_MS);
      }
    }
  });

  const authed = (req: IncomingMessage) => {
    const got = Buffer.from(String(req.headers["x-liner-token"] ?? ""));
    const want = Buffer.from(token);
    return got.length === want.length && timingSafeEqual(got, want);
  };

  /**
    A request for this server itself. A web page that points a name of its own at 127.0.0.1 (DNS rebinding) sends that name
    as its Host, and would be read as the app's own origin: only this address is answered, as the Browser's proxy does
    (proxy.ts addressed).
  */
  const addressed = (host?: string) => {
    const a = server.address();
    const port = typeof a === "object" && a ? a.port : -1;
    return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  };

  const body = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 64 * 1024 * 1024) throw new Error("That's too large to send.");
      chunks.push(c as Buffer);
    }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  };

  const server = createServer((req, res) => {
    // Whatever goes wrong below, the caller gets an answer: left alone, it would wait for good.
    void handle(req, res).catch((e) => {
      console.error("[server]", e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = URL.parse(req.url ?? "/", "http://localhost");
    // "//" and the like aren't addresses at all.
    if (!url) return void res.writeHead(400).end("Bad request");
    if (!addressed(req.headers.host)) return void res.writeHead(403).end("Forbidden");
    if (url.pathname === "/events" || url.pathname === "/rpc") {
      if (!authed(req)) {
        res.writeHead(401).end("Unauthorized");
        return;
      }
      if (url.pathname === "/events") {
        res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-accel-buffering": "no" });
        // Listening before the snapshot is taken, so nothing sent while it's taken is lost; what it already holds isn't sent twice.
        clients.add(res);
        waiting.set(res, []);
        // Dropped on close from the start: an app that leaves while the snapshot is taken (a reload while the tools are found) isn't kept.
        let beat: NodeJS.Timeout | undefined;
        const drop = () => {
          clearInterval(beat);
          const was = clients.delete(res);
          waiting.delete(res);
          out.delete(res);
          // Once, as the last one goes: with two windows, one reloading keeps its count until both have closed.
          if (was && clients.size === 0) o.alone?.();
        };
        res.on("close", drop);
        let snapshot: Snapshot;
        try {
          snapshot = await o.snapshot();
        } catch {
          drop();
          return void res.end();
        }
        if (res.destroyed) return drop();
        res.write(`${JSON.stringify({ type: "hello", snapshot })}\n`);
        for (const x of waiting.get(res) ?? []) if (x.seq > (snapshot.seq ?? 0)) res.write(x.line);
        waiting.delete(res);
        // A heartbeat keeps the stream open and lets the app notice a dead engine.
        beat = setInterval(() => res.write("\n"), 15000);
        return;
      }
      try {
        const { method, params } = await body(req);
        const result = await api.call(String(method), params);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, result: result ?? null }));
      } catch (e) {
        const code = rpcErrorCode(e);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e), ...(code ? { code } : {}) }));
      }
      return;
    }
    if ((url.pathname === "/surface" || url.pathname === "/outside") && req.method === "POST") {
      const outside = url.pathname === "/outside";
      const take = outside ? o.outside : o.surface;
      if (!take) return void res.writeHead(404).end();
      const key = String(req.headers[outside ? "x-liner-outside" : "x-liner-surface"] ?? "");
      // The key first: any page in a browser can post here, and its body is read only once it has shown a key of ours.
      if (o.knows && !(outside ? o.knows.outside(key) : o.knows.surface(key))) return void res.writeHead(401).end("Unauthorized");
      try {
        const { tool, args, client } = (await body(req)) as { tool?: string; args?: Record<string, unknown>; client?: unknown };
        const gone = new AbortController();
        res.on("close", () => res.writableEnded || gone.abort());
        const work = take(key, String(tool ?? ""), args ?? {}, gone.signal, typeof client === "string" ? client : undefined);
        if (!work) return void res.writeHead(401).end("Unauthorized");
        // A call can wait on you (an add-on's install card) for minutes: the answer starts at once and a
        // space goes every 20 seconds, which JSON reads past, so the caller's fetch doesn't give up on it.
        res.writeHead(200, { "content-type": "application/json" });
        res.flushHeaders();
        const beat = setInterval(() => res.write(" "), 20_000);
        const done = (b: unknown) => (clearInterval(beat), res.end(JSON.stringify(b)));
        await work.then(
          (result) => done({ ok: true, result }),
          (e: unknown) => done({ ok: false, error: e instanceof Error ? e.message : String(e) }),
        );
      } catch (e) {
        if (!res.headersSent) res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    // A routine's webhook: its own secret in the URL stands in for the app's token.
    // A panel drawn for its agent to look at (addon_check): the token is its own, made for that one
    // check. The page is its own host, so it reaches itself, and its srcdoc frame inherits the allowlist.
    const check = /^\/addon-check\/([a-f0-9]{36})(?:\/(call|report|settle))?$/.exec(url.pathname);
    if (check && o.check) {
      const [, tok, part] = check;
      try {
        if (!part && req.method === "GET") {
          const page = o.check.page(tok);
          if (!page) return void res.writeHead(404).end();
          return void res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src data:; connect-src 'self'; frame-src 'self' about:; child-src about:", "connection-allowlist": checkConnections(`http://${req.headers.host}`) }).end(page);
        }
        if (part === "settle" && req.method === "GET") {
          await o.check.settle(tok);
          return void res.writeHead(200, { "content-type": "image/gif", "cache-control": "no-store" }).end(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
        }
        if (part === "call" && req.method === "POST") {
          const r = await o.check.call(tok, (await body(req)) as Record<string, unknown>);
          return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(r));
        }
        if (part === "report" && req.method === "POST") {
          o.check.report(tok, await body(req));
          return void res.writeHead(204).end();
        }
      } catch (e) {
        return void res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      }
      return void res.writeHead(405).end();
    }
    const hook = /^\/hooks\/r\/([\w-]+)$/.exec(url.pathname);
    if (hook && req.method === "POST" && o.hooks) {
      let payload: unknown = {};
      try {
        payload = await body(req);
      } catch {
        // not JSON: the routine gets an empty body
      }
      const ok = o.hooks(hook[1], url.searchParams.get("key") ?? "", payload, Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])));
      res.writeHead(ok ? 200 : 404, { "content-type": "application/json" }).end(JSON.stringify({ ok }));
      return;
    }
    // The promo's model, for OpenCode: its key, this run's, is checked before anything is read (promo.ts).
    if (o.promo && (url.pathname === PROMO_PATH || url.pathname.startsWith(`${PROMO_PATH}/`))) return o.promo(url.pathname.slice(PROMO_PATH.length), req, res);
    // A ported DeepSeek Harness plugin's frame reaching its own program or pictures, by its token.
    const dsh = /^\/dsh\/([a-f0-9]{32})\/(.*)$/.exec(url.pathname);
    if (dsh && o.dsh) {
      if (o.dsh(dsh[1], dsh[2], url.search, req, res)) return;
      return void res.writeHead(404).end("Not found");
    }
    // The empty frame a panel is written into: it's asked for by the page, so without the token.
    if (url.pathname === PANEL_FRAME && req.method === "GET") {
      const frame = panelFrame(url.searchParams.get("network"), `http://${req.headers.host}`, url.searchParams.get("dsh"));
      if (!frame) return void res.writeHead(400).end("Bad request");
      return void res.writeHead(200, frame.headers).end(frame.html);
    }
    if (url.pathname === "/health") {
      res.writeHead(200).end("ok");
      return;
    }
    // The app itself.
    if (o.ui && existsSync(o.ui)) {
      let path: string;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        // A broken %-escape: answered, not left hanging.
        return void res.writeHead(400).end("Bad request");
      }
      const rel = normalize(path).replace(/^(\.\.[/\\])+/, "");
      let file = join(o.ui, rel);
      if (!file.startsWith(o.ui) || !existsSync(file) || statSync(file).isDirectory()) file = join(o.ui, "index.html");
      const type = TYPES[extname(file)] ?? "application/octet-stream";
      const cache = file.includes(`${join(o.ui, "assets")}`) ? "public, max-age=31536000, immutable" : "no-cache";
      res.writeHead(200, { "content-type": type, "cache-control": cache }).end(readFileSync(file));
      return;
    }
    res.writeHead(404).end("Not found");
  };

  return new Promise<{ port: number; close: () => void; windows: () => number }>((resolve, reject) => {
    server.once("listening", () => {
      const addr = server.address();
      resolve({
        port: typeof addr === "object" && addr ? addr.port : o.port,
        // How many apps are reading the events now: Scan new PRs only looks while one is (security-watch.ts).
        windows: () => clients.size,
        close: () => {
          flush();
          for (const c of clients) c.end();
          server.close();
        },
      });
    });
    // The port asked for is taken (another copy, or something else on it): any free one will do.
    server.once("error", (e: NodeJS.ErrnoException) => (e.code === "EADDRINUSE" && o.port ? server.listen(0, "127.0.0.1") : reject(e)));
    server.listen(o.port, "127.0.0.1");
  });
}
