/*
  Liner MCP's app listener: only /mcp and the OAuth routes, only for its own address or the tunnel's public host, a key on
  every call, tools listed by level, sessions held to their app, and a revoked app's open call ended. And LinerMcp: the
  listener is there only while apps are let in, and a tunnel only when you picked one. Fakes only: no real tunnel.
  Run with `node --test engine/test/mcp-http.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Server as HttpServer, request } from "node:http";
import { Readable } from "node:stream";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { McpApps, McpGate } from "../src/mcp-apps.ts";
import { LinerMcp, startMcpHttp } from "../src/mcp-http.ts";
import { createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { McpOAuth } from "../src/mcp-oauth.ts";
import { Outside } from "../src/outside-tools.ts";
import { startServer } from "../src/server.ts";
import { Store } from "../src/store.ts";
import type { TunnelDeps } from "../src/tunnel.ts";

/** A raw request, so the Host header can be anything (fetch won't let a test set it). */
function hit(port: number, o: { method?: string; path: string; host?: string; headers?: Record<string, string>; body?: unknown }): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  return new Promise((resolve, reject) => {
    const data = o.body === undefined ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body);
    const req = request({ host: "127.0.0.1", port, agent: false, method: o.method ?? "GET", path: o.path, headers: { host: o.host ?? `127.0.0.1:${port}`, ...(data ? { "content-type": "application/json" } : {}), ...o.headers } }, (res) => {
      let text = "";
      res.on("data", (d) => (text += d));
      // A stream the listener cut off (a revoked app) ends with close, not end.
      res.on("close", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function base() {
  const home = mkdtempSync(join(tmpdir(), "lc-mcp-http-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "Foreshore", path: "/work/foreshore", git: true, createdAt: 1 });
  store.putThread({ id: "th_1", projectId: "p", title: "Tide chart", agent: "forge", status: "running", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 2 } as Thread);
  const outside = new Outside(store, { call: async () => null });
  return { home, store, outside };
}

async function rig(publicHost: string | null = null) {
  const { home, store, outside } = base();
  const apps = new McpApps(home);
  const gate = new McpGate({ apps, runner: outside, defaultAccess: () => "edits", stdioLevel: () => "trusted", log: () => {} });
  const oauth = new McpOAuth(apps);
  const l = await startMcpHttp({ port: 0, apps, gate, oauth, publicHost: () => publicHost });
  apps.onGone = (id) => (l.endApp(id), gate.dropApp(id));
  const read = apps.create({ name: "Muse", kind: "muse", level: "read" });
  const ask = apps.create({ name: "Grok Bot", kind: "grokbot", level: "ask" });
  const init = async (key: string, host?: string) => {
    const r = await hit(l.port, { method: "POST", path: "/mcp", host, headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream" }, body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } } });
    return { r, sid: String(r.headers["mcp-session-id"] ?? "") };
  };
  return { store, apps, gate, oauth, l, read, ask, init };
}

test("The app listener answers nothing of the engine's own: no /rpc, /events, /outside, /surface or app pages", async () => {
  const { l } = await rig();
  try {
    for (const path of ["/rpc", "/events", "/outside", "/surface", "/", "/index.html", "/health", "/hooks/r/x"]) {
      const r = await hit(l.port, { method: path === "/rpc" || path === "/outside" || path === "/surface" ? "POST" : "GET", path, body: path === "/rpc" ? { method: "state.get" } : undefined, headers: { "x-liner-token": "liner-dev" } });
      assert.equal(r.status, 404, path);
    }
  } finally {
    await l.close();
  }
});

test("A call with no key, or a wrong one, is refused before its body is read, and says where to sign in", async () => {
  const { l } = await rig();
  try {
    const r = await hit(l.port, { method: "POST", path: "/mcp", body: { jsonrpc: "2.0", id: 1, method: "initialize" } });
    assert.equal(r.status, 401);
    assert.match(String(r.headers["www-authenticate"]), new RegExp(`resource_metadata="http://127.0.0.1:${l.port}/.well-known/oauth-protected-resource/mcp"`));
    const bad = await hit(l.port, { method: "POST", path: "/mcp", headers: { authorization: "Bearer lc_nope" }, body: { jsonrpc: "2.0", id: 1, method: "initialize" } });
    assert.equal(bad.status, 401);
    assert.match(String(bad.headers["www-authenticate"]), /invalid_token/);
  } finally {
    await l.close();
  }
});

test("Another name for 127.0.0.1 (DNS rebinding) and a foreign Origin are turned away; the tunnel's host is let in", async () => {
  const { l, read, init } = await rig("liner.tail1234.ts.net");
  try {
    assert.equal((await hit(l.port, { path: "/.well-known/oauth-authorization-server", host: `evil.example:${l.port}` })).status, 403);
    assert.equal((await hit(l.port, { path: "/.well-known/oauth-authorization-server", headers: { origin: "https://evil.example" } })).status, 403);
    const meta = await hit(l.port, { path: "/.well-known/oauth-authorization-server", host: "liner.tail1234.ts.net" });
    assert.equal(meta.status, 200);
    assert.equal(JSON.parse(meta.text).authorization_endpoint, "https://liner.tail1234.ts.net/authorize");
    const { r } = await init(read.key, "liner.tail1234.ts.net");
    assert.equal(r.status, 200);
  } finally {
    await l.close();
  }
});

test("The engine's own server never takes the tunnel's public host", async () => {
  const { store } = base();
  const s = await startServer({ store, api: { call: async () => null, ready: Promise.resolve() }, snapshot: async () => ({}) as never, token: "t", port: 0 });
  try {
    const r = await hit(s.port, { path: "/health", host: "liner.tail1234.ts.net" });
    assert.equal(r.status, 403);
  } finally {
    s.close();
  }
});

test("An app's session lists only the tools its level allows, and its calls go through the gate", async () => {
  const { l, read, init } = await rig();
  try {
    const { r, sid } = await init(read.key);
    assert.equal(JSON.parse(r.text).result.serverInfo.name, "liner-code");
    assert.ok(sid);
    const h = { authorization: `Bearer ${read.key}`, "mcp-session-id": sid, accept: "application/json, text/event-stream" };
    assert.equal((await hit(l.port, { method: "POST", path: "/mcp", headers: h, body: { jsonrpc: "2.0", method: "notifications/initialized" } })).status, 202);
    const list = JSON.parse((await hit(l.port, { method: "POST", path: "/mcp", headers: h, body: { jsonrpc: "2.0", id: 2, method: "tools/list" } })).text);
    assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name), ["liner_projects", "liner_sessions", "liner_read", "liner_pull_requests", "liner_issues", "liner_findings"]);
    const call = JSON.parse((await hit(l.port, { method: "POST", path: "/mcp", headers: h, body: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "liner_projects", arguments: {} } } })).text);
    assert.match(call.result.content[0].text, /Foreshore/);
    // Called anyway, a tool above its level is refused by the gate.
    // A call that may wait answers as a stream; called anyway, a tool above its level is refused by the gate.
    const streamed = await hit(l.port, { method: "POST", path: "/mcp", headers: h, body: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "liner_start", arguments: { project: "p", message: "go" } } } });
    assert.match(String(streamed.headers["content-type"]), /text\/event-stream/);
    const start = JSON.parse(/^data: (.*)$/m.exec(streamed.text)![1]);
    assert.equal(start.id, 4);
    assert.equal(start.result.isError, true);
  } finally {
    await l.close();
  }
});

test("One app's session id is no use to another, and a batch or an unknown session is refused", async () => {
  const { l, read, ask, init } = await rig();
  try {
    const { sid } = await init(read.key);
    const other = await hit(l.port, { method: "POST", path: "/mcp", headers: { authorization: `Bearer ${ask.key}`, "mcp-session-id": sid }, body: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    assert.equal(other.status, 404);
    assert.equal((await hit(l.port, { method: "POST", path: "/mcp", headers: { authorization: `Bearer ${read.key}`, "mcp-session-id": sid }, body: [{ jsonrpc: "2.0", id: 2, method: "tools/list" }] })).status, 400);
    assert.equal((await hit(l.port, { method: "POST", path: "/mcp", headers: { authorization: `Bearer ${read.key}` }, body: { jsonrpc: "2.0", id: 2, method: "tools/list" } })).status, 400);
    assert.equal((await hit(l.port, { method: "GET", path: "/mcp", headers: { authorization: `Bearer ${read.key}` } })).status, 405);
  } finally {
    await l.close();
  }
});

test("Revoking an app ends the call it holds open, and its key stops working", async () => {
  const { l, apps, gate, ask, init } = await rig();
  try {
    const { sid } = await init(ask.key);
    const h = { authorization: `Bearer ${ask.key}`, "mcp-session-id": sid, accept: "application/json, text/event-stream" };
    const held = hit(l.port, { method: "POST", path: "/mcp", headers: h, body: { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "liner_send", arguments: { session: "th_1", message: "hi" } } } }).catch((e: Error) => ({ status: -1, text: e.message, headers: {} }));
    for (let i = 0; i < 100 && !gate.list().length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(gate.list().length, 1, "it waits on the card");
    apps.revoke(ask.app.id);
    const r = await held;
    assert.doesNotMatch(r.text, /"Sent/);
    assert.equal(gate.list().length, 0);
    assert.equal((await hit(l.port, { method: "POST", path: "/mcp", headers: h, body: { jsonrpc: "2.0", id: 6, method: "tools/list" } })).status, 401);
  } finally {
    await l.close();
  }
});

test("DELETE /mcp and session eviction abort in-flight work on the dropped session", async () => {
  const { l, gate, ask, init } = await rig();
  try {
    const { sid } = await init(ask.key);
    const h = { authorization: `Bearer ${ask.key}`, "mcp-session-id": sid, accept: "application/json, text/event-stream" };
    const held = hit(l.port, { method: "POST", path: "/mcp", headers: h, body: { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "liner_send", arguments: { session: "th_1", message: "hi" } } } }).catch((e: Error) => ({ status: -1, text: e.message, headers: {} }));
    for (let i = 0; i < 100 && !gate.list().length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(gate.list().length, 1);
    const del = await hit(l.port, { method: "DELETE", path: "/mcp", headers: h });
    assert.equal(del.status, 204);
    const r = await held;
    assert.doesNotMatch(r.text, /"Sent/);
    assert.equal(gate.list().length, 0);

    const first = await init(ask.key);
    const h2 = { authorization: `Bearer ${ask.key}`, "mcp-session-id": first.sid, accept: "application/json, text/event-stream" };
    const held2 = hit(l.port, { method: "POST", path: "/mcp", headers: h2, body: { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "liner_send", arguments: { session: "th_1", message: "hi again" } } } }).catch((e: Error) => ({ status: -1, text: e.message, headers: {} }));
    for (let i = 0; i < 100 && !gate.list().length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(gate.list().length, 1);
    for (let i = 0; i < 20; i++) assert.equal((await init(ask.key)).r.status, 200);
    const r2 = await held2;
    assert.doesNotMatch(r2.text, /"Sent/);
    assert.equal(gate.list().length, 0);
    assert.equal((await hit(l.port, { method: "POST", path: "/mcp", headers: h2, body: { jsonrpc: "2.0", id: 8, method: "tools/list" } })).status, 404);
  } finally {
    await l.close();
  }
});

test("in-process: DELETE /mcp and session eviction abort in-flight work on the dropped session", async (t) => {
  let srv: HttpServer | undefined;
  const origListen = HttpServer.prototype.listen;
  t.mock.method(HttpServer.prototype, "listen", function (this: HttpServer, ...args: unknown[]) {
    srv = this;
    return origListen.apply(this, args as never);
  });
  const { l, gate, ask } = await rig();
  try {
    assert.ok(srv);
    const dispatch = (o: { method?: string; path: string; headers?: Record<string, string>; body?: unknown }) =>
      new Promise<{ status: number; headers: Record<string, string>; text: string; closed: boolean }>((resolve) => {
        const raw = o.body === undefined ? [] : [Buffer.from(typeof o.body === "string" ? o.body : JSON.stringify(o.body))];
        const req = Object.assign(Readable.from(raw), {
          method: o.method ?? "GET",
          url: o.path,
          headers: { host: `127.0.0.1:${l.port}`, ...(o.body !== undefined ? { "content-type": "application/json" } : {}), ...o.headers },
        });
        const res = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
          chunks: string[];
          headersSent: boolean;
          writableEnded: boolean;
          destroyed: boolean;
          writeHead: (s: number, h?: Record<string, string>) => typeof res;
          flushHeaders: () => void;
          write: (c: string | Buffer) => boolean;
          end: (c?: string | Buffer) => typeof res;
          destroy: () => typeof res;
        };
        res.statusCode = 200;
        res.headers = {};
        res.chunks = [];
        res.headersSent = false;
        res.writableEnded = false;
        res.destroyed = false;
        const done = (closed: boolean) => resolve({ status: res.statusCode, headers: res.headers, text: res.chunks.join(""), closed });
        res.writeHead = (s, h = {}) => {
          res.statusCode = s;
          for (const [k, v] of Object.entries(h)) res.headers[k.toLowerCase()] = v;
          res.headersSent = true;
          return res;
        };
        res.flushHeaders = () => { res.headersSent = true; };
        res.write = (c) => { res.chunks.push(String(c)); return true; };
        res.end = (c) => {
          if (c !== undefined) res.chunks.push(String(c));
          res.writableEnded = true;
          res.emit("close");
          done(false);
          return res;
        };
        res.destroy = () => {
          if (!res.destroyed) {
            res.destroyed = true;
            res.emit("close");
            done(true);
          }
          return res;
        };
        srv!.emit("request", req as never, res as never);
      });
    const initLocal = async () => {
      const r = await dispatch({ method: "POST", path: "/mcp", headers: { authorization: `Bearer ${ask.key}`, accept: "application/json, text/event-stream" }, body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } } });
      return { r, sid: r.headers["mcp-session-id"] ?? "" };
    };
    const { sid } = await initLocal();
    const h = { authorization: `Bearer ${ask.key}`, "mcp-session-id": sid, accept: "application/json, text/event-stream" };
    const held = dispatch({ method: "POST", path: "/mcp", headers: h, body: { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "liner_send", arguments: { session: "th_1", message: "hi" } } } });
    for (let i = 0; i < 100 && !gate.list().length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(gate.list().length, 1);
    const del = await dispatch({ method: "DELETE", path: "/mcp", headers: h });
    assert.equal(del.status, 204);
    const r = await held;
    assert.equal(r.closed, true);
    assert.doesNotMatch(r.text, /"Sent/);
    assert.equal(gate.list().length, 0);

    const first = await initLocal();
    const h2 = { authorization: `Bearer ${ask.key}`, "mcp-session-id": first.sid, accept: "application/json, text/event-stream" };
    const held2 = dispatch({ method: "POST", path: "/mcp", headers: h2, body: { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "liner_send", arguments: { session: "th_1", message: "hi again" } } } });
    for (let i = 0; i < 100 && !gate.list().length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(gate.list().length, 1);
    for (let i = 0; i < 20; i++) assert.equal((await initLocal()).r.status, 200);
    const r2 = await held2;
    assert.equal(r2.closed, true);
    assert.doesNotMatch(r2.text, /"Sent/);
    assert.equal(gate.list().length, 0);
    assert.equal((await dispatch({ method: "POST", path: "/mcp", headers: h2, body: { jsonrpc: "2.0", id: 8, method: "tools/list" } })).status, 404);
  } finally {
    await l.close();
  }
});

test("The listener is there only while apps are let in, and the tunnel starts only when you picked one", async () => {
  const { store, outside } = base();
  const ran: string[] = [];
  const deps: TunnelDeps = {
    which: async (n) => (n === "tailscale" ? "/fake/tailscale" : null),
    run: async (_cmd, args) => {
      ran.push(args.join(" "));
      if (args[0] === "status") return { code: 0, stdout: JSON.stringify({ BackendState: "Running", Self: { DNSName: "liner.tail1234.ts.net." } }), stderr: "" };
      if (args[0] === "version") return { code: 0, stdout: "1.90.0\n", stderr: "" };
      return { code: 0, stdout: "{}", stderr: "" };
    },
    spawn: () => {
      throw new Error("no process in this test");
    },
  };
  const mcp = new LinerMcp({ store, outside, env: {}, tunnelDeps: deps, port: 0, log: () => {} });
  try {
    await mcp.apply();
    assert.equal(mcp.port, 0, "off: no listener");
    store.setSettings({ outside: true });
    await mcp.apply();
    assert.ok(mcp.port > 0);
    assert.equal(ran.length, 0, "no tunnel unless picked");
    assert.equal((await mcp.status()).publicUrl, undefined);
    store.setSettings({ mcpReach: "tailscale" });
    await mcp.apply();
    const s = await mcp.status();
    assert.equal(s.publicUrl, "https://liner.tail1234.ts.net/mcp");
    assert.ok(ran.includes(`funnel --bg ${mcp.port}`));
    const key = mcp.addApp({ kind: "grokbot", level: "ask" });
    assert.equal(key.url, "https://liner.tail1234.ts.net/mcp");
    assert.equal(mcp.addApp({ kind: "other", level: "read" }).app.name, "Another app");
    assert.equal(mcp.addApp({ kind: "other", level: "read" }).app.name, "Another app 2", "not a second Another app");
    store.setSettings({ outside: false });
    await mcp.apply();
    assert.equal(mcp.port, 0);
    assert.ok(ran.includes("funnel --https=443 off"), "taken down with the listener");
  } finally {
    await mcp.stop();
  }
});

test("Applies asked at once end as the latest says: no listener left open behind, no tunnel after off, never one on port 0", async (t) => {
  const { store, outside } = base();
  // Listeners opened and not closed, counted at the server itself.
  const listen = t.mock.method(HttpServer.prototype, "listen");
  const close = t.mock.method(HttpServer.prototype, "close");
  const open = () => listen.mock.callCount() - close.mock.callCount();
  const ran: string[] = [];
  const deps: TunnelDeps = {
    which: async (n) => (n === "tailscale" ? "/fake/tailscale" : null),
    run: async (_cmd, args) => {
      ran.push(args.join(" "));
      if (args[0] === "status") return { code: 0, stdout: JSON.stringify({ BackendState: "Running", Self: { DNSName: "liner.tail1234.ts.net." } }), stderr: "" };
      return { code: 0, stdout: "{}", stderr: "" };
    },
    spawn: () => {
      throw new Error("no process in this test");
    },
  };
  const mcp = new LinerMcp({ store, outside, env: {}, tunnelDeps: deps, port: 0, log: () => {} });
  try {
    store.setSettings({ outside: true, mcpReach: "tailscale" });
    const first = mcp.apply();
    store.setSettings({ outside: false });
    const second = mcp.apply();
    await Promise.all([first, second]);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(mcp.port, 0, "no listener");
    assert.equal(mcp.tunnel.now.state, "off");
    assert.equal(ran.includes("funnel --bg 0"), false, "no tunnel on port 0");
    const up = ran.lastIndexOf(ran.find((r) => r.startsWith("funnel --bg")) ?? "-");
    assert.ok(up === -1 || ran.indexOf("funnel --https=443 off", up) > up, `a Funnel Liner put up is taken down again: ${ran.join(", ")}`);
    // Off, then on again at once: the latest wins, with the listener and the tunnel up.
    store.setSettings({ outside: true });
    const a = mcp.apply();
    store.setSettings({ outside: false });
    const b = mcp.apply();
    store.setSettings({ outside: true });
    const c = mcp.apply();
    await Promise.all([a, b, c]);
    assert.ok(mcp.port > 0);
    assert.equal(mcp.tunnel.now.state, "up");
    assert.ok(ran.includes(`funnel --bg ${mcp.port}`));
    assert.equal(open(), 1, "one listener, not one for each apply");
  } finally {
    await mcp.stop();
  }
  assert.equal(open(), 0, "none left open after stop");
});

test("Add an app makes no key while apps are kept out, since there's no address to give it", async () => {
  const { store, outside } = base();
  const mcp = new LinerMcp({ store, outside, env: {}, port: 0, log: () => {}, tunnelDeps: { which: async () => null, run: async () => ({ code: 0, stdout: "", stderr: "" }), spawn: () => { throw new Error("no"); } } });
  try {
    await mcp.apply();
    assert.throws(() => mcp.addApp({ kind: "other", level: "read" }), /Let apps outside Liner Code in first/);
    assert.equal((await mcp.status()).apps.length, 0, "none was made");
    store.setSettings({ outside: true });
    await mcp.apply();
    assert.equal(mcp.addApp({ kind: "other", level: "read" }).url, `http://127.0.0.1:${mcp.port}/mcp`);
  } finally {
    await mcp.stop();
  }
});

/** A port free now, for a listener asked to take that one. */
const freePort = () => new Promise<number>((r) => { const s = createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });

test("A listener that failed to start is tried again, and off then on keeps the same port", async () => {
  const { store, outside } = base();
  const opts = { store, outside, env: {}, port: -1, log: () => {}, tunnelDeps: { which: async () => null, run: async () => ({ code: 0, stdout: "", stderr: "" }), spawn: () => { throw new Error("no"); } } };
  const mcp = new LinerMcp(opts);
  try {
    store.setSettings({ outside: true });
    await assert.rejects(mcp.apply());
    opts.port = await freePort();
    await mcp.apply();
    assert.equal(mcp.port, opts.port, "the failed start isn't waited on for good");
    const held = hit(mcp.port, { method: "POST", path: "/mcp", headers: { authorization: "Bearer lc_x" }, body: {} });
    await held;
    store.setSettings({ outside: false });
    await mcp.apply();
    store.setSettings({ outside: true });
    await mcp.apply();
    assert.equal(mcp.port, opts.port);
  } finally {
    await mcp.stop();
  }
});

test("Changing what terminal agents may do is written for the stdio server at once", async () => {
  const { store, outside } = base();
  outside.url = "http://127.0.0.1:1";
  const mcp = new LinerMcp({ store, outside, env: {}, port: 0, log: () => {}, tunnelDeps: { which: async () => null, run: async () => ({ code: 0, stdout: "", stderr: "" }), spawn: () => { throw new Error("no"); } } });
  try {
    store.setSettings({ outside: true });
    outside.apply();
    await mcp.apply();
    assert.equal(JSON.parse(readFileSync(outside.file, "utf8")).level, "trusted");
    store.setSettings({ mcpStdioLevel: "read" });
    await mcp.apply();
    assert.ok(existsSync(outside.file));
    assert.equal(JSON.parse(readFileSync(outside.file, "utf8")).level, "read");
  } finally {
    await mcp.stop();
  }
});

test("Refused sign-ins and registrations through the listener don't use up the limit for a real one", async () => {
  const { l, oauth } = await rig();
  try {
    for (let i = 0; i < 40; i++) assert.equal((await hit(l.port, { path: "/authorize?client_id=forged.sig" })).status, 400);
    for (let i = 0; i < 40; i++) assert.equal((await hit(l.port, { method: "POST", path: "/register", body: { client_name: "x", redirect_uris: ["http://evil.example/cb"] } })).status, 400);
    const reg = JSON.parse((await hit(l.port, { method: "POST", path: "/register", body: { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] } })).text) as { client_id: string };
    oauth.expect("claude");
    const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_challenge: "a".repeat(43), code_challenge_method: "S256" });
    assert.equal((await hit(l.port, { path: `/authorize?${q}` })).status, 302);
  } finally {
    await l.close();
  }
});

test("A request whose body never finishes coming is cut off, so nobody on the internet can hold the listener's connections open for good", async () => {
  const { home } = base();
  const apps = new McpApps(home);
  const gate = new McpGate({ apps, runner: new Outside(new Store(home), { call: async () => null }), defaultAccess: () => "edits", stdioLevel: () => "trusted", log: () => {} });
  const l = await startMcpHttp({ port: 0, apps, gate, oauth: new McpOAuth(apps), publicHost: () => null, requestMs: 300 });
  try {
    const { connect } = await import("node:net");
    const s = connect(l.port, "127.0.0.1");
    let said = "";
    s.on("data", (d) => (said += d));
    // No key is needed for /token: headers at once, then one byte of the thousand it says are coming, and nothing more.
    s.write(`POST /token HTTP/1.1\r\nHost: 127.0.0.1:${l.port}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 1000\r\n\r\ng`);
    const closed = await new Promise<boolean>((r) => {
      const t = setTimeout(() => r(false), 4000);
      s.once("close", () => (clearTimeout(t), r(true)));
    });
    s.destroy();
    assert.ok(closed, "the half-sent request is still held open");
    assert.match(said, /^HTTP\/1\.1 408/);
  } finally {
    await l.close();
  }
});
