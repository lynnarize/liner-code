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
  - GET  /*        the built app, when there is one
  Every other request carries the token the shell made (x-liner-token), so other apps and web
  pages on this machine can't drive your agents.
*/
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { PANEL_FRAME, checkConnections, panelFrame, type EngineEvent, type Snapshot } from "../../contracts/src/index.ts";
import type { Store } from "./store.ts";

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".ico": "image/x-icon" };

type Api = { call(method: string, params: unknown): Promise<unknown>; ready: Promise<unknown> };
type Hooks = (id: string, key: string, body: unknown, headers: Record<string, string>) => boolean;
/** `gone`: the caller let go of the call before its answer (its tool cancelled it, or its MCP server went away). */
type Surface = (key: string, tool: string, args: Record<string, unknown>, gone?: AbortSignal) => Promise<unknown> | null;
type Outside = Surface;
/** A panel being checked out of sight (agent-tools.ts): its page, its bridge's calls, its report, and word once it has settled. */
type Check = { page(token: string): string | null; call(token: string, body: Record<string, unknown>): Promise<unknown>; report(token: string, body: unknown): void; settle(token: string): Promise<void> };
/** A ported plugin's request: true when it was its to answer. */
type Dsh = (token: string, rest: string, search: string, req: IncomingMessage, res: ServerResponse) => boolean;

export function startServer(o: { store: Store; api: Api; snapshot: () => Promise<Snapshot>; token: string; port: number; ui?: string; hooks?: Hooks; surface?: Surface; outside?: Outside; check?: Check; dsh?: Dsh }) {
  const { store, api, token } = o;
  const clients = new Set<ServerResponse>();
  /** Clients whose snapshot is being taken: what's sent meanwhile waits, numbered, until it's written. */
  const waiting = new Map<ServerResponse, { seq: number; line: string }[]>();
  store.on((e: EngineEvent) => {
    const line = `${JSON.stringify({ ...e, seq: store.seq })}\n`;
    for (const res of clients) {
      const held = waiting.get(res);
      if (held) held.push({ seq: store.seq, line });
      else res.write(line);
    }
  });

  const authed = (req: IncomingMessage) => {
    const got = Buffer.from(String(req.headers["x-liner-token"] ?? ""));
    const want = Buffer.from(token);
    return got.length === want.length && timingSafeEqual(got, want);
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
          clients.delete(res);
          waiting.delete(res);
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
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    if ((url.pathname === "/surface" || url.pathname === "/outside") && req.method === "POST") {
      const outside = url.pathname === "/outside";
      const take = outside ? o.outside : o.surface;
      if (!take) return void res.writeHead(404).end();
      try {
        const { tool, args } = (await body(req)) as { tool?: string; args?: Record<string, unknown> };
        const gone = new AbortController();
        res.on("close", () => res.writableEnded || gone.abort());
        const work = take(String(req.headers[outside ? "x-liner-outside" : "x-liner-surface"] ?? ""), String(tool ?? ""), args ?? {}, gone.signal);
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

  return new Promise<{ port: number; close: () => void }>((resolve, reject) => {
    server.once("listening", () => {
      const addr = server.address();
      resolve({
        port: typeof addr === "object" && addr ? addr.port : o.port,
        close: () => {
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
