/*
  /compact on every tool, as the 0.3.3 real-tool run found it: OpenCode 2's server compacts on its own route and says so,
  reports the context it holds so Compact and "N% of context" show, an empty session has nothing to compact whatever the
  tool, and Liner Code's own compaction doesn't hand /compact on as a question left open. The OpenCode server is a small
  local stand-in speaking its V2 HTTP and SSE as 2.4.2 does (events as the real one sent them).
  Run with `node --test engine/test/compact-every-tool.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { OpenCodeDaemon, OpenCodeServerSession } from "../src/providers/opencode-server.ts";
import type { OpenOptions, Provider, ProviderSession, TurnSink } from "../src/providers/types.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

type Json = Record<string, unknown>;

/** OpenCode 2.4.2's server, as far as a turn and a compaction go. */
async function openCodeServer(password = "pw") {
  const asked: { method: string; path: string }[] = [];
  const clients = new Set<ServerResponse>();
  let n = 1;
  const emit = (type: string, data: Json) => {
    for (const res of clients) res.write(`data: ${JSON.stringify({ id: `evt_${n++}`, type, data })}\n\n`);
  };
  const json = (res: ServerResponse, body: unknown) => (res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify(body)));
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`) return void (res.writeHead(401), res.end());
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/api/event") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ id: `evt_${n++}`, type: "server.connected", data: {} })}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    req.resume();
    req.on("end", () => {
      asked.push({ method: req.method ?? "GET", path });
      if (path === "/api/info") return json(res, { version: "2.4.2" });
      if (path === "/api/model") return json(res, { data: [{ id: "fake-model", providerID: "fake", name: "Fake", enabled: true, limit: { context: 200000, output: 8000 } }] });
      if (req.method === "POST" && path === "/api/session") return json(res, { data: { id: "ses_1", permissions: [] } });
      const sid = /^\/api\/session\/([^/]+)\/(prompt|compact)$/.exec(path);
      if (req.method === "POST" && sid?.[2] === "prompt") {
        json(res, { data: { id: "msg_p" } });
        setTimeout(() => {
          emit("session.execution.started", { sessionID: "ses_1" });
          emit("session.step.started", { sessionID: "ses_1", agent: "build", model: { id: "fake-model", providerID: "fake" }, assistantMessageID: "m1" });
          emit("session.text.delta", { sessionID: "ses_1", assistantMessageID: "m1", delta: "DONE" });
          emit("session.step.ended", { sessionID: "ses_1", assistantMessageID: "m1", finish: "stop", tokens: { input: 22170, output: 20, reasoning: 0, cache: { read: 1000, write: 0 } }, cost: 0 });
          emit("session.usage.updated", { sessionID: "ses_1", cost: 0, tokens: { input: 22170, output: 20, reasoning: 0, cache: { read: 1000, write: 0 } } });
          emit("session.execution.succeeded", { sessionID: "ses_1" });
        }, 10);
        return;
      }
      if (req.method === "POST" && sid?.[2] === "compact") {
        json(res, { data: { id: "msg_c", sessionID: "ses_1", type: "compaction", payload: {}, delivery: "steer" } });
        setTimeout(() => {
          emit("session.inbox.enqueued", { sessionID: "ses_1", inboxID: "msg_c", item: { type: "compaction", payload: {}, delivery: "steer" } });
          emit("session.execution.started", { sessionID: "ses_1" });
          emit("session.compaction.started", { sessionID: "ses_1", reason: "manual", inputID: "msg_c" });
          emit("session.compaction.delta", { sessionID: "ses_1", text: "## Objective\n- the summary" });
          emit("session.usage.updated", { sessionID: "ses_1", cost: 0, tokens: { input: 45054, output: 40, reasoning: 0, cache: { read: 1000, write: 0 } } });
          emit("session.compaction.ended", { sessionID: "ses_1", reason: "manual", model: { id: "fake-model", providerID: "fake" }, text: "## Objective\n- the summary", tokens: { input: 22884, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0 });
          emit("session.execution.succeeded", { sessionID: "ses_1" });
        }, 10);
        return;
      }
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    password,
    asked,
    close: () => {
      for (const res of clients) res.end();
      return new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

function recorder() {
  const notices: { text: string; key?: string }[] = [];
  const usages: Json[] = [];
  const sink = {
    text: () => {}, reasoning: () => {}, tool: () => {}, plan: () => {},
    approve: async () => ({ allow: true }), ask: async () => null, propose: async () => ({ approve: true }),
    usage: (u: Json) => void usages.push(u), session: () => {}, notice: (text: string, key?: string) => void notices.push({ text, key }), error: (m: string) => void notices.push({ text: `ERR:${m}` }), limited: () => {},
  } as unknown as TurnSink;
  return { sink, notices, usages };
}

async function openCodeSession() {
  const mock = await openCodeServer();
  const daemon = await OpenCodeDaemon.connect(mock.url, mock.password);
  const cwd = mkdtempSync(join(tmpdir(), "lc-oc-compact-"));
  const s = new OpenCodeServerSession({ cwd, model: "fake/fake-model", effort: "default", access: "edits", soul: "", guard: true, env: { ...process.env } } as OpenOptions, async () => daemon);
  s.reconcileMs = 0;
  const done = async () => {
    s.close();
    daemon.shutdown();
    await mock.close();
  };
  return { mock, s, done };
}

test("OpenCode's own server compacts on /compact, and the timeline says it did, with what it summed up", async () => {
  const { mock, s, done } = await openCodeSession();
  try {
    // The runtime asks before the turn: false sent /compact to Liner Code's own compaction, and OpenCode's route was never used.
    assert.equal(s.canCompact?.(), true, "OpenCode's server was taken for a tool without its own /compact");
    await s.turn("hi", recorder().sink, new AbortController().signal);
    const r = recorder();
    await s.turn("/compact", r.sink, new AbortController().signal);
    assert.ok(mock.asked.some((a) => a.method === "POST" && a.path === "/api/session/ses_1/compact"), "its compact route wasn't asked");
    assert.equal(mock.asked.filter((a) => a.path === "/api/session/ses_1/prompt").length, 1, "/compact went to the model as words");
    assert.equal(r.notices.at(-1)?.text, "OpenCode compacted the conversation (23k tokens before).");
    // The line it started with is the one the end replaces.
    assert.equal(r.notices[0]?.key, r.notices.at(-1)?.key);
    assert.ok(r.notices.at(-1)?.key);
  } finally {
    await done();
  }
});

test("A turn on OpenCode's server says the context it holds and its model's window, so Compact and N% of context show", async () => {
  const { s, done } = await openCodeSession();
  try {
    const r = recorder();
    await s.turn("hi", r.sink, new AbortController().signal);
    for (let i = 0; i < 100 && !r.usages.some((u) => u.contextWindow); i++) await new Promise((ok) => setTimeout(ok, 10));
    assert.ok(r.usages.some((u) => u.contextTokens === 23190), `no context in use was reported: ${JSON.stringify(r.usages)}`);
    assert.ok(r.usages.some((u) => u.contextWindow === 200000), "the model's context window from OpenCode's list wasn't reported");
  } finally {
    await done();
  }
});

/* The runtime, with a stand-in tool. */

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id === "codex" ? "Codex CLI" : id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });

function standIn(id: "claude" | "codex", canCompact?: () => boolean) {
  const texts: string[] = [];
  const p: Provider = {
    id,
    detect: async () => info(id, []),
    open: () =>
      ({
        close: () => {},
        ...(canCompact ? { canCompact } : {}),
        turn: async (text: string, sink: TurnSink) => {
          texts.push(text);
          sink.session(`${id}-session`);
          sink.text("an answer");
        },
      }) as unknown as ProviderSession,
  };
  const saved = providers[id];
  providers[id] = p;
  return { texts, restore: () => (providers[id] = saved) };
}

function runtimeWith(agent: string) {
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-compact-home-")));
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-compact-dir-")), git: false, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Work", agent, status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() } as Thread);
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = [info("claude", ["claude-opus-5-5"]), info("codex", ["gpt-6"])];
  return { store, runtime };
}

test("A /compact in a session where nothing was said yet says there's nothing to compact, whatever the tool, and the tool isn't asked", async () => {
  // Claude Code compacts on its own (it ended with no word at all), Codex too (it compacted its own instructions), and a tool without one.
  for (const [id, canCompact] of [["claude", undefined], ["codex", () => true], ["codex", () => false]] as const) {
    const tool = standIn(id, canCompact);
    const { store, runtime } = runtimeWith(id === "claude" ? "@claude:claude-opus-5-5" : "@codex:gpt-6");
    try {
      await runtime.send("t", "/compact");
      assert.deepEqual(tool.texts, [], `${id} was asked to compact an empty session`);
      const said = store.timeline("t").filter((x) => x.kind === "notice").map((x) => (x.kind === "notice" ? x.text : ""));
      assert.deepEqual(said, ["Nothing to compact yet."], `${id}: ${JSON.stringify(said)}`);
      // A second /compact is no conversation either.
      await runtime.send("t", "/compact");
      assert.deepEqual(tool.texts, []);
    } finally {
      tool.restore();
      await runtime.shutdown();
    }
  }
});

test("Liner Code's own compaction leaves /compact out of the note the next session starts from", async () => {
  const tool = standIn("codex", () => false);
  const { store, runtime } = runtimeWith("@codex:gpt-6");
  try {
    await runtime.send("t", "explain the tide tables");
    await runtime.send("t", "/compact");
    const said = store.timeline("t").filter((x) => x.kind === "notice").map((x) => (x.kind === "notice" ? x.text : ""));
    assert.equal(said.at(-1), "Compacted in Liner Code: your next message starts a fresh Codex CLI session with a summary of the conversation so far.");
    await runtime.send("t", "carry on");
    const note = tool.texts.at(-1) ?? "";
    assert.match(note, /explain the tide tables/, "the next session wasn't told the conversation");
    assert.doesNotMatch(note, /\/compact/, "the note hands /compact on as something asked");
  } finally {
    tool.restore();
    await runtime.shutdown();
  }
});

test("The session details say an OpenCode session compacts, on its server or over ACP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-info-oc-compact-"));
  const env = { PATH: "/usr/bin:/bin", HOME: dir } as NodeJS.ProcessEnv;
  const store = new Store(join(dir, "home"));
  store.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  store.putThread({ id: "oc", projectId: "p", title: "New session", agent: "@opencode:fake/fake-model", status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() } as Thread);
  const runtime = new Runtime(store, env);
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [], put: () => undefined, remove: () => undefined }, terms: {}, logs: {}, proxies: {} } as never);
  try {
    const got = (await api.call("thread.info", { id: "oc" } as never)) as { provider: string; compact: boolean };
    assert.equal(got.provider, "opencode");
    assert.equal(got.compact, true);
  } finally {
    api.updates.stop();
    await runtime.shutdown();
  }
});
