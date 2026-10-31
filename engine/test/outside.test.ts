/*
  Liner Code for agents outside it: the key that lets its MCP server in only while it's on, what
  the tools answer, and the MCP server on stdio, as Claude Code or Codex would start it.
  Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { Outside } from "../src/outside-tools.ts";
import { Store } from "../src/store.ts";

const out = (r: { content: { type: string; text?: string }[]; isError?: boolean }) => (r.content[0] as { text: string }).text;

function rig() {
  const home = mkdtempSync(join(tmpdir(), "lc-out-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "Counter", path: "/work/counter", git: true, createdAt: 1 });
  const t: Thread = { id: "th_1", projectId: "p", title: "Reset button", agent: "forge", status: "waiting", access: "ask", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 2 };
  store.putThread(t);
  store.putItem("th_1", { kind: "user", id: "u", turn: 1, at: 1, text: "Add a Reset button." });
  store.putItem("th_1", { kind: "tool", id: "e", turn: 1, at: 2, tool: "Edit", toolKind: "edit", title: "Edit index.html", status: "done" });
  store.putItem("th_1", { kind: "approval", id: "a", turn: 1, at: 3, tool: "Bash", title: "Run npm test", risk: "low", fields: [], state: "asking" });
  const calls: [string, unknown][] = [];
  const api = { call: async (method: string, params: unknown) => (calls.push([method, params]), method === "thread.create" ? { id: "th_new" } : null) };
  const o = new Outside(store, api);
  o.url = "http://127.0.0.1:1";
  return { home, store, o, calls };
}

test("outside: the key file is there only while it's on, readable by you alone, and only its key gets in", () => {
  const { store, o } = rig();
  o.apply();
  assert.equal(existsSync(o.file), false, "off by default");
  store.setSettings({ outside: true });
  o.apply();
  const { url, key } = JSON.parse(readFileSync(o.file, "utf8")) as { url: string; key: string };
  assert.equal(url, "http://127.0.0.1:1/outside");
  assert.equal(statSync(o.file).mode & 0o777, 0o600);
  assert.equal(o.allows(key), true);
  // One character off, whatever the last one is.
  assert.equal(o.allows(`${key.slice(0, -1)}${key.endsWith("0") ? "1" : "0"}`), false);
  assert.equal(o.allows(""), false);
  store.setSettings({ outside: false });
  o.apply();
  assert.equal(existsSync(o.file), false);
  assert.equal(o.allows(key), false);
});

test("outside: projects, sessions, a session read with what waits on you, and starting one", async () => {
  const { o, calls } = rig();
  assert.equal(out(await o.call("liner_projects", {})), "p · Counter · /work/counter");
  assert.equal(out(await o.call("liner_sessions", { project: "Counter" })), "th_1 · Reset button · Counter · waiting");
  const read = out(await o.call("liner_read", { session: "th_1" }));
  assert.match(read, /^Reset button · waiting \(it asks the person something in Liner Code\)[\s\S]*The person: Add a Reset button\.\n- Edit index\.html\nWaiting on the person: Run npm test/);
  assert.match(out(await o.call("liner_start", { project: "/work/counter", message: "Write the tests", agent: "codex:gpt-6-luna" })), /^Started th_new in Counter/);
  assert.deepEqual(calls, [["thread.create", { projectId: "p", agent: "@codex:gpt-6-luna" }], ["thread.send", { id: "th_new", text: "Write the tests" }]]);
  const nope = await o.call("liner_read", { session: "th_x" });
  assert.equal(nope.isError, true);
  assert.match(out(nope), /No session "th_x"/);
});

test("outside: the MCP server on stdio lists its tools and passes a call to the engine with the key", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-out-mcp-"));
  const seen: { key?: string; tool?: string }[] = [];
  const server = createServer((req, res) => {
    // Other tests look for dev servers on this Mac's ports; only the MCP server's calls are ours.
    if (req.method !== "POST" || !req.url?.startsWith("/outside")) return void res.writeHead(404).end();
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const b = JSON.parse(body) as { tool: string };
      seen.push({ key: String(req.headers["x-liner-outside"]), tool: b.tool });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, result: { content: [{ type: "text", text: "p · Counter · /work/counter" }] } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  writeFileSync(join(home, "outside.json"), JSON.stringify({ url: `http://127.0.0.1:${port}/outside`, key: "k123" }));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../src/outside.ts", import.meta.url))], { env: { ...process.env, LINER_HOME: home } });
  const replies: Record<string, unknown>[] = [];
  let buf = "";
  child.stdout.on("data", (d: Buffer) => {
    buf += String(d);
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      replies.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  const ask = (id: number, method: string, params: unknown = {}) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  try {
    ask(1, "initialize", { protocolVersion: "2025-06-18" });
    ask(2, "tools/list");
    ask(3, "tools/call", { name: "liner_projects", arguments: {} });
    for (let i = 0; i < 200 && replies.length < 3; i++) await new Promise((r) => setTimeout(r, 20));
    const by = (id: number) => replies.find((r) => r.id === id) as { result: Record<string, unknown> };
    assert.equal((by(1).result.serverInfo as { name: string }).name, "liner-code");
    assert.deepEqual((by(2).result.tools as { name: string }[]).map((t) => t.name), ["liner_projects", "liner_sessions", "liner_read", "liner_start", "liner_send", "liner_wait"]);
    assert.equal(((by(3).result.content as { text: string }[])[0]).text, "p · Counter · /work/counter");
    assert.deepEqual(seen, [{ key: "k123", tool: "liner_projects" }]);
  } finally {
    child.kill();
    server.close();
  }
});
