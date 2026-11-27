/*
  What the HTTP driver for OpenCode's shared server (providers/opencode-server.ts) owes each session beside the others on
  that server: an add-on another session in the folder registered stays out of a session that has it switched off (or is
  Lean, or sealed), it leaves the server with the last session that holds it, a switch back to the default model gives the
  session OpenCode's default model, and a turn on a signal already stopped opens nothing.
  Run with `node --test engine/test/opencode-server-addons.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeDaemon, OpenCodeServerSession } from "../src/providers/opencode-server.ts";
import type { OpenOptions, TurnSink } from "../src/providers/types.ts";

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string, ms = 3000) {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await tick();
  assert.ok(ok(), what);
}

type Req = { method: string; path: string; query: string; body?: Record<string, unknown> };
type Rule = { action: string; resource: string; effect: string };

/** A small OpenCode V2 server: SSE, sessions kept with their permissions and model, a default model, and prompts that end at once. */
async function mock(password = "pw") {
  const requests: Req[] = [];
  const clients = new Set<ServerResponse>();
  const sessions: Record<string, { id: string; permissions: Rule[]; model?: unknown }> = {};
  // A folder OpenCode hasn't loaded yet answers its default model with null for its first moments (seen on 2.4.2, about 150 ms).
  const cold = { left: 0 };
  let n = 1;
  const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  const emit = (type: string, data: Record<string, unknown>) => {
    for (const res of clients) res.write(`data: ${JSON.stringify({ id: `e${n++}`, type, data })}\n\n`);
  };
  const json = (res: ServerResponse, v: unknown) => (res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify(v)));
  const read = (req: IncomingMessage) => new Promise<Record<string, unknown> | undefined>((ok) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        ok(raw ? JSON.parse(raw) : undefined);
      } catch {
        ok(undefined);
      }
    });
  });
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== auth) return void (res.writeHead(401), res.end());
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    if (req.method === "GET" && path === "/api/event") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ type: "server.connected", data: {} })}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    const body = await read(req);
    requests.push({ method: req.method ?? "GET", path, query: decodeURIComponent(url.search), ...(body ? { body } : {}) });
    if (path === "/api/info") return json(res, { version: "2.4.2" });
    if (path === "/api/session/active") return json(res, { data: {} });
    if (path === "/api/permission/request" || path === "/api/form" || path === "/api/experimental/job" || path === "/api/mcp") return json(res, { data: [] });
    // As 2.4.2 answers it: the model a session with no model of its own uses, Model.Info's `id` being the Ref's.
    if (path === "/api/model/default" && cold.left > 0) return cold.left--, json(res, { location: { directory: url.searchParams.get("location[directory]") }, data: null });
    if (path === "/api/model/default") return json(res, { location: { directory: url.searchParams.get("location[directory]") }, data: { id: "big-pickle", modelID: "big-pickle-api", providerID: "opencode", name: "Big Pickle" } });
    if (req.method === "POST" && path === "/api/session") {
      const id = `ses_${n++}`;
      sessions[id] = { id, permissions: (body?.permissions as Rule[]) ?? [], ...(body?.model ? { model: body.model } : {}) };
      return json(res, { data: sessions[id] });
    }
    const one = /^\/api\/session\/([^/]+)$/.exec(path);
    if (one && req.method === "GET") {
      const s = sessions[decodeURIComponent(one[1])];
      if (!s) return void (res.writeHead(404), res.end());
      return json(res, { data: s });
    }
    if (one && req.method === "PATCH") {
      const s = sessions[decodeURIComponent(one[1])];
      if (s && body?.permissions) s.permissions = body.permissions as Rule[];
      return void (res.writeHead(204), res.end());
    }
    const model = /^\/api\/session\/([^/]+)\/model$/.exec(path);
    if (model) {
      const s = sessions[decodeURIComponent(model[1])];
      if (s) s.model = body?.model;
      return void (res.writeHead(204), res.end());
    }
    const prompt = /^\/api\/session\/([^/]+)\/prompt$/.exec(path);
    if (prompt) {
      json(res, { data: { id: `msg_${n++}` } });
      const sid = decodeURIComponent(prompt[1]);
      queueMicrotask(() => emit("session.execution.succeeded", { sessionID: sid }));
      return;
    }
    if (/\/inbox$/.test(path)) return json(res, { data: [] });
    res.writeHead(204);
    res.end();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    password,
    requests,
    sessions,
    cold,
    close: () => {
      for (const r of clients) r.destroy();
      server.closeAllConnections();
      return new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

function sink(): TurnSink {
  return {
    text: () => {},
    reasoning: () => {},
    tool: () => {},
    plan: () => {},
    approve: async () => ({ allow: true }),
    ask: async () => ({}),
    propose: async () => ({ approve: true }),
    usage: () => {},
    session: () => {},
    notice: () => {},
    error: () => {},
    limited: () => {},
  };
}

const foo = { name: "foo", stdio: { command: "node", args: ["foo-mcp.js"], env: {} } };
const opts = (cwd: string, extra: Partial<OpenOptions> = {}): OpenOptions => ({ cwd, model: "fake/model", effort: "", access: "full", soul: "", guard: true, env: { ...process.env }, ...extra });
/** The rule that decides an action: the last that fits it (OpenCode's rule order), with `*` at the end of a pattern as a wildcard. */
const decides = (rules: Rule[], action: string) => rules.findLast((r) => r.action === action || (r.action.endsWith("*") && action.startsWith(r.action.slice(0, -1))))?.effect;

async function withServer(work: (m: Awaited<ReturnType<typeof mock>>, d: OpenCodeDaemon, dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "lc-ocs-addons-"));
  const m = await mock();
  const d = await OpenCodeDaemon.connect(m.url, m.password);
  try {
    await work(m, d, dir);
  } finally {
    d.shutdown();
    await m.close();
  }
}

test("A session in the same folder with an add-on switched off is denied that add-on's tools, though another session put it on the shared OpenCode server", async () => {
  await withServer(async (m, d, dir) => {
    const a = new OpenCodeServerSession(opts(dir, { connections: [foo] }), async () => d);
    await a.turn("hi", sink(), new AbortController().signal);
    assert.ok(m.requests.some((r) => r.method === "PUT" && r.path === "/api/experimental/mcp/foo"), "A put foo on the server");
    for (const extra of [{ connections: [] }, {}, { sealed: true }] as Partial<OpenOptions>[]) {
      const b = new OpenCodeServerSession(opts(dir, extra), async () => d);
      await b.turn("hi", sink(), new AbortController().signal);
      const rules = Object.values(m.sessions).at(-1)!.permissions;
      assert.equal(decides(rules, "foo_search"), "deny", `B (${JSON.stringify(extra)}) can't call foo's tools`);
      assert.equal(decides(rules, "bash"), "ask", "the rest still comes to the level");
      b.close();
    }
    // A itself keeps them, at its level.
    assert.equal(decides(Object.values(m.sessions)[0].permissions, "foo_search"), "ask");
    a.close();
  });
});

test("A session opened before another in its folder put an add-on on the shared OpenCode server is denied that add-on's tools once it is there", async () => {
  await withServer(async (m, d, dir) => {
    const b = new OpenCodeServerSession(opts(dir, { connections: [] }), async () => d);
    await b.turn("hi", sink(), new AbortController().signal);
    const bid = Object.keys(m.sessions)[0];
    const a = new OpenCodeServerSession(opts(dir, { connections: [foo] }), async () => d);
    await a.turn("hi", sink(), new AbortController().signal);
    await until(() => decides(m.sessions[bid].permissions, "foo_search") === "deny", "B's rules were brought up to date with a deny of foo's tools");
    a.close();
    b.close();
  });
});

test("Closing the last session that holds an add-on takes it off the shared OpenCode server, and not while another session still holds it", async () => {
  await withServer(async (m, d, dir) => {
    const deletes = () => m.requests.filter((r) => r.method === "DELETE" && r.path === "/api/experimental/mcp/foo");
    const a = new OpenCodeServerSession(opts(dir, { connections: [foo] }), async () => d);
    const c = new OpenCodeServerSession(opts(dir, { connections: [foo] }), async () => d);
    const b = new OpenCodeServerSession(opts(dir, { connections: [] }), async () => d);
    for (const s of [a, c, b]) await s.turn("hi", sink(), new AbortController().signal);
    a.close();
    await tick(100);
    assert.equal(deletes().length, 0, "C still holds foo");
    c.close();
    await until(() => deletes().length === 1, "foo went with the last session holding it, though B is still open");
    assert.equal(deletes()[0].query, `?location[directory]=${dir}`);
    b.close();
  });
});

test("Switching an OpenCode session back to the default model gives it OpenCode's default model, not the one it had", async () => {
  await withServer(async (m, d, dir) => {
    const s = new OpenCodeServerSession(opts(dir, { model: "anthropic/claude-sonnet-5-5" }), async () => d);
    await s.turn("one", sink(), new AbortController().signal);
    const sid = Object.keys(m.sessions)[0];
    assert.deepEqual(m.sessions[sid].model, { providerID: "anthropic", id: "claude-sonnet-5-5" });
    assert.equal(await s.update({ model: "default", effort: "", access: "full" }), true);
    await s.turn("two", sink(), new AbortController().signal);
    assert.deepEqual(m.sessions[sid].model, { providerID: "opencode", id: "big-pickle" }, "the session is on OpenCode's default model now");
    s.close();
  });
});

test("Resuming an OpenCode session on the default model gives it OpenCode's default model, not the one it was on", async () => {
  await withServer(async (m, d, dir) => {
    const first = new OpenCodeServerSession(opts(dir, { model: "anthropic/claude-sonnet-5-5" }), async () => d);
    await first.turn("one", sink(), new AbortController().signal);
    const sid = Object.keys(m.sessions)[0];
    first.close();
    const again = new OpenCodeServerSession(opts(dir, { model: "default", resume: sid }), async () => d);
    await again.turn("two", sink(), new AbortController().signal);
    assert.deepEqual(m.sessions[sid].model, { providerID: "opencode", id: "big-pickle" });
    again.close();
  });
});

test("Back on the default model in a folder OpenCode is still loading, the session is given the default once it's there", async () => {
  await withServer(async (m, d, dir) => {
    const s = new OpenCodeServerSession(opts(dir, { model: "anthropic/claude-sonnet-5-5" }), async () => d);
    await s.turn("one", sink(), new AbortController().signal);
    const sid = Object.keys(m.sessions)[0];
    m.cold.left = 2;
    assert.equal(await s.update({ model: "default", effort: "", access: "full" }), true);
    assert.deepEqual(m.sessions[sid].model, { providerID: "opencode", id: "big-pickle" }, "a null answer while the folder loads is asked again, not taken as no default");
    s.close();
  });
});

test("A turn on a signal already stopped leaves the OpenCode session with no turn open and its root not busy", async () => {
  await withServer(async (m, d, dir) => {
    const s = new OpenCodeServerSession(opts(dir), async () => d);
    const ac = new AbortController();
    ac.abort();
    await s.turn("hi", sink(), ac.signal);
    const inner = s as unknown as { sink: unknown; signal: unknown; parentBusy: boolean };
    assert.equal(inner.sink, null);
    assert.equal(inner.signal, null);
    assert.equal(inner.parentBusy, false);
    assert.ok(!m.requests.some((r) => r.path.endsWith("/prompt")), "nothing was sent");
    s.close();
  });
});

test("A session's own add-on whose name begins with another session's add-on name keeps its tools while the other's are denied", async () => {
  const { opencodeSessionRules } = await import("../src/providers/opencode-server.ts");
  const rules = opencodeSessionRules({}, "liner_a1b2c3d4", {}, { others: ["foo", "my tools"], mine: ["foo_bar"] }) as Rule[];
  assert.equal(decides(rules, "foo_search"), "deny");
  assert.equal(decides(rules, "my_tools_list"), "deny", "a name with a space goes by OpenCode's name for its tools");
  assert.equal(decides(rules, "foo_bar_search"), "ask", "its own add-on comes to the level");
  assert.equal(decides(rules, "liner_a1b2c3d4_browser_open"), "allow");
  // Under your deny-all, your own add-on stays as shut as the rest.
  assert.equal(decides(opencodeSessionRules({}, undefined, { "*": "deny" }, { others: ["foo"], mine: ["foo_bar"] }) as Rule[], "foo_bar_search"), "deny");
});
