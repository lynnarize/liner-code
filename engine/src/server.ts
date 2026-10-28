/*
  The engine's front door, on 127.0.0.1 only:
  - GET  /events   a stream of EngineEvents (newline-delimited JSON), starting with a snapshot
  - POST /rpc      { method, params } → { ok, result } or { ok: false, error }
  - POST /surface  { tool, args } from an agent's Liner Code tools (mcp.ts), with that session's
                   own key (x-liner-surface), which reaches its surfaces and nothing else
  - GET  /*        the built app, when there is one
  Every other request carries the token the shell made (x-liner-token), so other apps and web
  pages on this machine can't drive your agents.
*/
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { EngineEvent, Snapshot } from "../../contracts/src/index.ts";
import type { Store } from "./store.ts";

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".ico": "image/x-icon" };

type Api = { call(method: string, params: unknown): Promise<unknown>; ready: Promise<unknown> };
type Hooks = (id: string, key: string, body: unknown, headers: Record<string, string>) => boolean;
type Surface = (key: string, tool: string, args: Record<string, unknown>) => Promise<unknown> | null;

export function startServer(o: { store: Store; api: Api; snapshot: () => Promise<Snapshot>; token: string; port: number; ui?: string; hooks?: Hooks; surface?: Surface }) {
  const { store, api, token } = o;
  const clients = new Set<ServerResponse>();
  store.on((e: EngineEvent) => {
    const line = `${JSON.stringify(e)}\n`;
    for (const res of clients) res.write(line);
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

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/events" || url.pathname === "/rpc") {
      if (!authed(req)) {
        res.writeHead(401).end("Unauthorized");
        return;
      }
      if (url.pathname === "/events") {
        res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-accel-buffering": "no" });
        res.write(`${JSON.stringify({ type: "hello", snapshot: await o.snapshot() })}\n`);
        clients.add(res);
        // A heartbeat keeps the stream open and lets the app notice a dead engine.
        const beat = setInterval(() => res.write("\n"), 15000);
        req.on("close", () => {
          clearInterval(beat);
          clients.delete(res);
        });
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
    if (url.pathname === "/surface" && req.method === "POST" && o.surface) {
      try {
        const { tool, args } = (await body(req)) as { tool?: string; args?: Record<string, unknown> };
        const work = o.surface(String(req.headers["x-liner-surface"] ?? ""), String(tool ?? ""), args ?? {});
        if (!work) return void res.writeHead(401).end("Unauthorized");
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, result: await work }));
      } catch (e) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    // A routine's webhook: its own secret in the URL stands in for the app's token.
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
    if (url.pathname === "/health") {
      res.writeHead(200).end("ok");
      return;
    }
    // The app itself.
    if (o.ui && existsSync(o.ui)) {
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
      let file = join(o.ui, rel);
      if (!file.startsWith(o.ui) || !existsSync(file) || statSync(file).isDirectory()) file = join(o.ui, "index.html");
      const type = TYPES[extname(file)] ?? "application/octet-stream";
      const cache = file.includes(`${join(o.ui, "assets")}`) ? "public, max-age=31536000, immutable" : "no-cache";
      res.writeHead(200, { "content-type": type, "cache-control": cache }).end(readFileSync(file));
      return;
    }
    res.writeHead(404).end("Not found");
  });

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
