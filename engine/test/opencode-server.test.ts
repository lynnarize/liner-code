/*
  Shared OpenCode V2 HTTP/SSE daemon (`opencode serve`): session pooling, streaming text/reasoning/
  tools/usage, native in-process subagents via `parentID` lineage, per-child stop and steer,
  permission enforcement on both parent and child sessions (Read only, .env, outside-project,
  guardDestructive), per-session Liner MCP isolation, forms, and automatic ACP fallback.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Access } from "../../contracts/src/index.ts";
import { NoV2Server, OpenCodeDaemon, OpenCodeServerSession, opencodeSessionRules, parseModelRef } from "../src/providers/opencode-server.ts";
import type { ApprovalRequest, OpenOptions, ProviderSession, ToolUpdate, TurnSink } from "../src/providers/types.ts";

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string, ms = 3000) {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await tick();
  assert.ok(ok(), what);
}

type MockReq = { method: string; path: string; body?: Record<string, unknown> };

/** A minimal in-process OpenCode V2 HTTP + SSE server for deterministic unit testing. */
async function mockOpenCodeServer(password = "pw-secret") {
  const requests: MockReq[] = [];
  const sseClients = new Set<ServerResponse>();
  let nextId = 1;
  const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  const state: {
    active?: Record<string, { type: "running" }>;
    pendingPerms: Record<string, unknown>[];
    pendingForms: Record<string, unknown>[];
    jobs: Record<string, unknown>[];
    inbox: Record<string, { id: string }[]>;
    sessions: Record<string, Record<string, unknown>>;
  } = {
    pendingPerms: [],
    pendingForms: [],
    jobs: [],
    inbox: {},
    sessions: {},
  };

  const emit = (type: string, data: Record<string, unknown>) => {
    const line = `data: ${JSON.stringify({ id: `evt_${nextId++}`, type, data })}\n\n`;
    for (const res of sseClients) res.write(line);
  };

  const dropSse = () => {
    for (const res of [...sseClients]) res.destroy();
    sseClients.clear();
  };

  let onPrompt: ((sid: string, body: Record<string, unknown>) => void) | undefined;

  const readJson = (req: IncomingMessage) =>
    new Promise<Record<string, unknown> | undefined>((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try {
          resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined);
        } catch {
          resolve(undefined);
        }
      });
    });

  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== authHeader) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    if (req.method === "GET" && path === "/api/event") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(`data: ${JSON.stringify({ id: `evt_${nextId++}`, type: "server.connected", data: {} })}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }
    const body = await readJson(req);
    requests.push({ method: req.method ?? "GET", path, ...(body !== undefined ? { body } : {}) });

    if (req.method === "GET" && path === "/api/info") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ version: "2.3.2", pid: process.pid }));
      return;
    }
    if (req.method === "GET" && path === "/api/permission/request") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: state.pendingPerms }));
      return;
    }
    if (req.method === "GET" && path === "/api/form") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: state.pendingForms }));
      return;
    }
    if (req.method === "GET" && path === "/api/session/active") {
      if (state.active === undefined) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: state.active }));
      return;
    }
    if (req.method === "GET" && path === "/api/experimental/job") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: state.jobs }));
      return;
    }
    const inboxMatch = /^\/api\/session\/([^/]+)\/inbox$/.exec(path);
    if (req.method === "GET" && inboxMatch) {
      const sid = decodeURIComponent(inboxMatch[1]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: state.inbox[sid] ?? [] }));
      return;
    }
    const sesMatch = /^\/api\/session\/([^/]+)$/.exec(path);
    if (req.method === "GET" && sesMatch && state.sessions[decodeURIComponent(sesMatch[1])]) {
      const sid = decodeURIComponent(sesMatch[1]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: state.sessions[sid] }));
      return;
    }
    if (req.method === "POST" && path === "/api/session") {
      const id = `ses_${nextId++}`;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { id, permissions: body?.permissions ?? [] } }));
      return;
    }
    const promptMatch = /^\/api\/session\/([^/]+)\/prompt$/.exec(path);
    if (req.method === "POST" && promptMatch) {
      const sid = decodeURIComponent(promptMatch[1]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { id: `msg_${nextId++}` } }));
      onPrompt?.(sid, body ?? {});
      return;
    }
    res.writeHead(204);
    res.end();
  });

  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    password,
    requests,
    state,
    sseClients,
    emit,
    dropSse,
    setOnPrompt: (fn: (sid: string, body: Record<string, unknown>) => void) => void (onPrompt = fn),
    close: () => {
      for (const res of sseClients) res.end();
      sseClients.clear();
      return new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

function recorder(approve?: (req: ApprovalRequest) => Promise<{ allow: boolean; reason?: string }>) {
  const texts: string[] = [];
  const reasons: string[] = [];
  const tools: ToolUpdate[] = [];
  const asks: ApprovalRequest[] = [];
  const notices: string[] = [];
  const usages: Record<string, number>[] = [];
  let sessionId = "";
  const sink: TurnSink = {
    text: (d) => texts.push(d),
    reasoning: (d) => reasons.push(d),
    tool: (u) => tools.push(u),
    plan: () => {},
    approve: async (req) => {
      asks.push(req);
      return approve ? approve(req) : { allow: true };
    },
    ask: async (qs) => Object.fromEntries(qs.map((q) => [q.question, "Yes"])),
    propose: async () => ({ approve: true }),
    usage: (u) => usages.push(u as Record<string, number>),
    session: (id) => (sessionId = id),
    notice: (m) => notices.push(m),
    error: (m) => notices.push(`ERR:${m}`),
    limited: (m) => notices.push(`LIM:${m}`),
  };
  return { sink, texts, reasons, tools, asks, notices, usages, sessionId: () => sessionId };
}

const baseOpts = (cwd: string, extra: Partial<OpenOptions> = {}): OpenOptions => ({
  cwd,
  model: "opencode-go/deepseek-v4.1-flash",
  effort: "high",
  access: "auto",
  soul: "Be concise.",
  guard: true,
  env: { ...process.env },
  ...extra,
});

test("opencode-server: parseModelRef and opencodeSessionRules allow native subagents while isolating per-session Liner MCP servers", () => {
  assert.deepEqual(parseModelRef("opencode-go/deepseek-v4.1-flash", "high"), { providerID: "opencode-go", id: "deepseek-v4.1-flash", variant: "high" });
  assert.equal(parseModelRef("default", "high"), undefined);

  const rules = opencodeSessionRules({}, "liner_a1b2c3d4");
  // Denies other sessions' liner_* before allowing only this session's server tools.
  const denyOthers = rules.findIndex((r) => r.action === "liner_*" && r.effect === "deny");
  const allowMine = rules.findIndex((r) => r.action === "liner_a1b2c3d4_browser_open" && r.effect === "allow");
  assert.ok(denyOthers >= 0 && allowMine > denyOthers);
  assert.equal(rules.findLast((r) => r.action === "subagent*")?.effect, "allow");
  assert.equal(rules.findLast((r) => r.action === "task*")?.effect, "allow");
  assert.equal(rules.findLast((r) => r.action === "execute*")?.effect, "deny");

  // Sidekicks, side chats, and security scans never get native subagents.
  assert.equal(opencodeSessionRules({ sidekick: true }).findLast((r) => r.action === "subagent*")?.effect, "deny");
  assert.equal(opencodeSessionRules({ side: true }).findLast((r) => r.action === "subagent*")?.effect, "deny");
  assert.equal(opencodeSessionRules({ scan: true }).findLast((r) => r.action === "subagent*")?.effect, "deny");
  assert.equal(opencodeSessionRules({ scan: true }).findLast((r) => r.action === "webfetch")?.effect, "deny");
});

test("opencode-server: streams text, reasoning, tools, usage, and native in-process subagents with per-child stop and steer on one shared daemon", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-oc-srv-"));
  writeFileSync(join(dir, "app.ts"), "export const x = 1;\n");
  const mock = await mockOpenCodeServer();
  const daemon = await OpenCodeDaemon.connect(mock.url, mock.password);
  try {
    const s1 = new OpenCodeServerSession(baseOpts(dir, { mcp: { command: "node", args: ["mcp.ts"], env: {} } }), async () => daemon);
    const s2 = new OpenCodeServerSession(baseOpts(dir), async () => daemon);
    const rec = recorder();

    mock.setOnPrompt((sid, body) => {
      if (body.delivery === "steer") return;
      queueMicrotask(async () => {
        mock.emit("session.reasoning.delta", { sessionID: sid, assistantMessageID: "m1", ordinal: 0, delta: "Planning..." });
        mock.emit("session.tool.input.started", { sessionID: sid, assistantMessageID: "m1", id: "tc1", name: "read" });
        mock.emit("session.tool.called", { sessionID: sid, assistantMessageID: "m1", id: "tc1", input: { filePath: join(dir, "app.ts") }, executed: false });
        mock.emit("session.tool.success", { sessionID: sid, assistantMessageID: "m1", id: "tc1", content: [{ type: "text", text: "export const x = 1;" }], executed: true });

        // Spawn two native in-process child subagents under sid.
        mock.emit("session.created", { sessionID: "kid_1", parentID: sid, title: "Audit CSS", agent: "explore", model: { providerID: "opencode-go", id: "deepseek-v4.1-flash" } });
        mock.emit("session.created", { sessionID: "kid_2", parentID: sid, title: "Audit routes", agent: "explore" });
        mock.emit("session.tool.input.started", { sessionID: "kid_1", assistantMessageID: "km1", id: "kt1", name: "grep" });
        mock.emit("session.tool.success", { sessionID: "kid_1", assistantMessageID: "km1", id: "kt1", content: [{ type: "text", text: "found" }], executed: true });
        mock.emit("session.usage.updated", { sessionID: "kid_1", cost: 0.001, tokens: { input: 40, output: 15, reasoning: 0, cache: { read: 0, write: 0 } } });
        mock.emit("session.text.delta", { sessionID: "kid_1", assistantMessageID: "km1", ordinal: 0, delta: "CSS looks clean." });
        mock.emit("session.execution.succeeded", { sessionID: "kid_1" });

        // Wait until the test steers and stops kid_2.
        await until(() => mock.requests.some((r) => r.path === "/api/session/kid_2/interrupt"), "kid_2 interrupted");

        mock.emit("session.text.delta", { sessionID: sid, assistantMessageID: "m1", ordinal: 0, delta: "All done." });
        mock.emit("session.usage.updated", { sessionID: sid, cost: 0.012, tokens: { input: 200, output: 50, reasoning: 10, cache: { read: 30, write: 0 } } });
        mock.emit("session.execution.succeeded", { sessionID: sid });
      });
    });

    const ac = new AbortController();
    const run = s1.turn("Audit the app", rec.sink, ac.signal);
    await until(() => rec.tools.some((t) => t.agent?.taskId === "kid_2"), "kid_2 row created");
    assert.equal(await s1.steerAgent("kid_2", "Focus on auth routes"), true);
    assert.equal(await s1.stopAgent("kid_2"), true);
    await run;

    assert.equal(rec.texts.join(""), "All done.");
    assert.equal(rec.reasons.join(""), "Planning...");
    assert.equal(rec.usages.at(-1)?.inputTokens, 200);
    assert.equal(rec.usages.at(-1)?.cacheReadTokens, 30);

    const kid1End = rec.tools.findLast((t) => t.agent?.taskId === "kid_1");
    assert.equal(kid1End?.agent?.state, "done");
    assert.equal(kid1End?.agent?.tools, 1);
    assert.equal(kid1End?.agent?.tokens, 55);
    assert.equal(kid1End?.agent?.report, "CSS looks clean.");

    const kid2End = rec.tools.findLast((t) => t.agent?.taskId === "kid_2");
    assert.equal(kid2End?.agent?.state, "stopped");
    assert.ok(mock.requests.some((r) => r.path === "/api/session/kid_2/prompt" && r.body?.delivery === "steer"));

    // Per-session Liner MCP server was registered and gets deleted on close, while daemon stays alive for s2.
    const mcpPut = mock.requests.find((r) => r.method === "PUT" && r.path.startsWith("/api/experimental/mcp/liner_"));
    assert.ok(mcpPut, "registered per-session Liner MCP server");
    s1.close();
    await until(() => mock.requests.some((r) => r.method === "DELETE" && r.path === mcpPut.path), "unregistered MCP server on close");
    assert.equal(daemon.alive, true, "shared daemon stays alive for other sessions");
    s2.close();
  } finally {
    daemon.shutdown();
    await mock.close();
  }
});

test("opencode-server: routes child subagent permissions through Liner Code's access levels, .env guard, and Read only refusal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-oc-perm-"));
  writeFileSync(join(dir, "safe.ts"), "ok\n");
  writeFileSync(join(dir, ".env"), "SECRET=1\n");
  const mock = await mockOpenCodeServer();
  const daemon = await OpenCodeDaemon.connect(mock.url, mock.password);

  const runWithAccess = async (access: Access, allowCard: boolean) => {
    mock.requests.length = 0;
    const s = new OpenCodeServerSession(baseOpts(dir, { access }), async () => daemon);
    const rec = recorder(async () => ({ allow: allowCard, reason: allowCard ? undefined : "Denied by user" }));
    mock.setOnPrompt((sid) => {
      queueMicrotask(async () => {
        mock.emit("session.created", { sessionID: "child_p", parentID: sid, title: "Worker", agent: "explore" });
        // 1. Safe in-project read from child -> auto-allowed with no card.
        mock.emit("permission.asked", { id: "p_read", sessionID: "child_p", action: "read", resources: [join(dir, "safe.ts")] });
        // 2. .env secret read from child -> asks (or refused in Read only).
        mock.emit("permission.asked", { id: "p_env", sessionID: "child_p", action: "read", resources: [join(dir, ".env")] });
        // 3. Edit from child -> refused outright in Read only, allowed in Auto.
        mock.emit("permission.asked", { id: "p_edit", sessionID: "child_p", action: "edit", resources: [join(dir, "safe.ts")] });
        // 4. Destructive rm -rf from child -> always asks even in Full when guard is on.
        mock.emit("permission.asked", { id: "p_rm", sessionID: "child_p", action: "bash", resources: ["rm -rf /"], metadata: { command: "rm -rf /" } });

        await until(() => mock.requests.filter((r) => r.path.endsWith("/reply")).length >= 4, "all 4 permission replies sent");
        mock.emit("session.execution.succeeded", { sessionID: "child_p" });
        mock.emit("session.execution.succeeded", { sessionID: sid });
      });
    });
    await s.turn("go", rec.sink, new AbortController().signal);
    const replies = Object.fromEntries(
      mock.requests
        .filter((r) => r.path.startsWith("/api/session/child_p/permission/") && r.path.endsWith("/reply"))
        .map((r) => [r.path.split("/")[5], r.body?.decision]),
    );
    s.close();
    return { replies, asks: rec.asks };
  };

  try {
    // In Read only: safe read allowed, .env / edit / rm -rf all rejected outright with zero cards.
    const ro = await runWithAccess("read", true);
    assert.equal(ro.replies.p_read, "once");
    assert.equal(ro.replies.p_env, "reject");
    assert.equal(ro.replies.p_edit, "reject");
    assert.equal(ro.replies.p_rm, "reject");
    assert.equal(ro.asks.length, 0, "Read only refuses without popping cards");

    // In Auto: safe read & scoped edit auto-allowed; .env and rm -rf surface approval cards labeled with the subagent.
    const auto = await runWithAccess("auto", false);
    assert.equal(auto.replies.p_read, "once");
    assert.equal(auto.replies.p_edit, "once");
    assert.equal(auto.replies.p_env, "reject");
    assert.equal(auto.replies.p_rm, "reject");
    assert.equal(auto.asks.length, 2);
    assert.ok(auto.asks.every((a) => a.title.startsWith("Explore:") && a.risk === "high"));
  } finally {
    daemon.shutdown();
    await mock.close();
  }
});

test("opencode-server: falls back cleanly to ACP when the binary does not speak V2 HTTP API", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-oc-fb-"));
  let fallbackUsed = false;
  const fallbackSession: ProviderSession = {
    close() {},
    turn: async (_t, sink) => {
      fallbackUsed = true;
      sink.text("from acp fallback");
    },
  };
  const s = new OpenCodeServerSession(
    baseOpts(dir),
    async () => {
      throw new NoV2Server("older opencode");
    },
    () => fallbackSession,
  );
  const rec = recorder();
  await s.turn("hi", rec.sink, new AbortController().signal);
  assert.equal(fallbackUsed, true);
  assert.equal(rec.texts.join(""), "from acp fallback");
  s.close();
});

test("opencode-server: holds turn open across slow background subagents, handles child permissions after parent goes idle, and captures parent wake synthesis", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-oc-bg-"));
  writeFileSync(join(dir, "hello.txt"), "hi\n");
  const mock = await mockOpenCodeServer();
  const daemon = await OpenCodeDaemon.connect(mock.url, mock.password);
  try {
    const s = new OpenCodeServerSession(baseOpts(dir, { access: "auto" }), async () => daemon);
    s.settleMs = 80;
    const rec = recorder();
    mock.setOnPrompt((sid) => {
      queueMicrotask(async () => {
        // Parent spawns background child and immediately finishes its first execution while child is still working.
        mock.emit("session.created", { sessionID: "bg_kid", parentID: sid, title: "Slow reader", agent: "explore" });
        mock.emit("session.text.delta", { sessionID: sid, assistantMessageID: "m1", ordinal: 0, delta: "Launched subagent. " });
        mock.emit("session.execution.succeeded", { sessionID: sid });

        // Child runs AFTER parent went idle, asks permission to read hello.txt, finishes, then wakes parent.
        await tick(60);
        mock.emit("permission.asked", { id: "p_bg_read", sessionID: "bg_kid", action: "read", resources: [join(dir, "hello.txt")] });
        await until(() => mock.requests.some((r) => r.path === "/api/session/bg_kid/permission/p_bg_read/reply"), "child permission replied even after parent went idle");
        mock.emit("session.text.delta", { sessionID: "bg_kid", assistantMessageID: "cm1", ordinal: 0, delta: "Found hi." });
        mock.emit("session.execution.succeeded", { sessionID: "bg_kid" });

        // OpenCode wakes parent with <subagent> inbox message.
        await tick(20);
        mock.emit("session.inbox.enqueued", { sessionID: sid, inboxID: "inb_1" });
        mock.emit("session.execution.started", { sessionID: sid });
        mock.emit("session.text.delta", { sessionID: sid, assistantMessageID: "m2", ordinal: 0, delta: "Synthesis: Found hi." });
        mock.emit("session.execution.succeeded", { sessionID: sid });
      });
    });

    await s.turn("Check hello.txt in background", rec.sink, new AbortController().signal);
    assert.equal(rec.texts.join(""), "Launched subagent. Synthesis: Found hi.");
    const kidRow = rec.tools.findLast((t) => t.agent?.taskId === "bg_kid");
    assert.equal(kidRow?.agent?.state, "done");
    assert.equal(kidRow?.agent?.report, "Found hi.");
    s.close();
  } finally {
    daemon.shutdown();
    await mock.close();
  }
});

test("opencode-server: reconciles missed child permission and missed child completion after an SSE drop so turns never hang", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-oc-rec-"));
  writeFileSync(join(dir, "readme.md"), "hello\n");
  const mock = await mockOpenCodeServer();
  const daemon = await OpenCodeDaemon.connect(mock.url, mock.password);
  try {
    const s = new OpenCodeServerSession(baseOpts(dir, { access: "auto" }), async () => daemon);
    s.settleMs = 40;
    s.reconcileMs = 80;
    const rec = recorder();

    mock.setOnPrompt((sid) => {
      mock.state.active = { [sid]: { type: "running" }, kid_drop: { type: "running" } };
      mock.state.sessions["kid_drop"] = { id: "kid_drop", parentID: sid, title: "Drop worker", agent: "explore" };
      queueMicrotask(async () => {
        mock.emit("session.created", { sessionID: "kid_drop", parentID: sid, title: "Drop worker", agent: "explore" });
        mock.emit("session.execution.succeeded", { sessionID: sid });
        delete mock.state.active![sid];

        // Drop the SSE stream before the child's permission request and completion are sent.
        mock.dropSse();
        mock.state.pendingPerms.push({ id: "p_missed", sessionID: "kid_drop", action: "read", resources: [join(dir, "readme.md")] });

        // Once reconciliation answers the missed permission, the child completes silently (no SSE event).
        await until(() => mock.requests.some((r) => r.path === "/api/session/kid_drop/permission/p_missed/reply" && r.body?.decision === "once"), "reconcile replied to missed child permission");
        mock.state.pendingPerms.length = 0;
        await tick(90);
        delete mock.state.active!["kid_drop"];
      });
    });

    await s.turn("Survive SSE drop", rec.sink, new AbortController().signal);
    const kidEnd = rec.tools.findLast((t) => t.agent?.taskId === "kid_drop");
    assert.equal(kidEnd?.agent?.state, "done");
    s.close();
  } finally {
    daemon.shutdown();
    await mock.close();
  }
});

test("opencode-server: interrupts late parent wake-up and rejects stray child permissions after Stop or close instead of leaking zombies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-oc-stop-"));
  const mock = await mockOpenCodeServer();
  const daemon = await OpenCodeDaemon.connect(mock.url, mock.password);
  try {
    const s = new OpenCodeServerSession(baseOpts(dir, { access: "auto" }), async () => daemon);
    s.settleMs = 40;
    const rec = recorder();
    let rootSid = "";

    mock.setOnPrompt((sid) => {
      rootSid = sid;
      mock.state.inbox[sid] = [{ id: "inb_stale" }];
      queueMicrotask(() => {
        mock.emit("session.created", { sessionID: "kid_stop", parentID: sid, title: "Auditor", agent: "explore" });
      });
    });

    const ac = new AbortController();
    const run = s.turn("Audit", rec.sink, ac.signal);
    await until(() => rec.tools.some((t) => t.agent?.taskId === "kid_stop"), "child started");
    ac.abort();
    await run;

    // Simulate OpenCode waking the root after child cancellation and spawning a zombie child that asks permission.
    mock.emit("session.execution.started", { sessionID: rootSid });
    mock.emit("session.created", { sessionID: "kid_zombie", parentID: rootSid, title: "Zombie", agent: "explore" });
    mock.emit("permission.asked", { id: "p_zombie", sessionID: "kid_zombie", action: "read", resources: [join(dir, "x.ts")] });

    await until(() => mock.requests.some((r) => r.method === "DELETE" && r.path === `/api/session/${rootSid}/inbox/inb_stale`), "drained root inbox on stop");
    await until(() => mock.requests.some((r) => r.path === "/api/session/kid_zombie/interrupt"), "interrupted zombie child");
    await until(() => mock.requests.some((r) => r.path === "/api/session/kid_zombie/permission/p_zombie/reply" && r.body?.decision === "reject"), "rejected zombie permission");
    s.close();
  } finally {
    daemon.shutdown();
    await mock.close();
  }
});

test("opencode-server: holds turn open across settle window when OpenCode still reports a queued inbox item waiting to wake the parent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-oc-inb-"));
  const mock = await mockOpenCodeServer();
  const daemon = await OpenCodeDaemon.connect(mock.url, mock.password);
  try {
    const s = new OpenCodeServerSession(baseOpts(dir, { access: "auto" }), async () => daemon);
    s.settleMs = 40;
    s.reconcileMs = 0;
    const rec = recorder();

    mock.setOnPrompt((sid) => {
      mock.state.active = { [sid]: { type: "running" } };
      queueMicrotask(async () => {
        mock.emit("session.created", { sessionID: "kid_slow_inb", parentID: sid, title: "Worker", agent: "explore" });
        mock.emit("session.execution.succeeded", { sessionID: sid });
        delete mock.state.active![sid];

        // Child finishes and leaves a queued <subagent> inbox item that takes longer than settleMs (40ms) to wake root.
        mock.state.inbox[sid] = [{ id: "inb_wake" }];
        mock.emit("session.execution.succeeded", { sessionID: "kid_slow_inb" });
        await tick(120);
        mock.state.inbox[sid] = [];
        mock.state.active![sid] = { type: "running" };
        mock.emit("session.execution.started", { sessionID: sid });
        mock.emit("session.text.delta", { sessionID: sid, assistantMessageID: "m_final", ordinal: 0, delta: "Final report." });
        delete mock.state.active![sid];
        mock.emit("session.execution.succeeded", { sessionID: sid });
      });
    });

    await s.turn("Run with slow inbox wake", rec.sink, new AbortController().signal);
    assert.equal(rec.texts.join(""), "Final report.");
    s.close();
  } finally {
    daemon.shutdown();
    await mock.close();
  }
});
