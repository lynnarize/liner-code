/*
  The engine core's polish round (docs/audit-2026-11-18/engine-core.md): a brief's end keeps the lead's doing line, Stop gives a
  tool that never ends its turn a grace and then closes it, the PR card's test run ends with its script, the event stream
  batches its writes, and the smaller fixes beside them. Fake tools stand in for every model. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { getEventListeners } from "node:events";
import { ServerResponse } from "node:http";
import { connect } from "node:net";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { AgentTools } from "../src/agent-tools.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { OpenOptions, Provider, TurnSink } from "../src/providers/types.ts";
import { Store, TIMELINE_IDLE_MS, TIMELINES_KEPT } from "../src/store.ts";
import { Awake } from "../src/awake.ts";
import { addFrame, createFile, designCtx } from "../src/canvas.ts";
import { capture, forget } from "../src/checkpoints.ts";
import { searchSessions } from "../src/memory.ts";
import { BEHIND_BYTES, startServer } from "../src/server.ts";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string, ms = 3000) {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await tick();
  assert.ok(ok(), what);
}
const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });

type Script = (o: OpenOptions, text: string, sink: TurnSink, signal: AbortSignal) => Promise<void>;
/** A fake tool in `id`'s place: each session it opens runs `script`; how many were closed is counted. */
function fake(id: "claude" | "codex", script: Script) {
  const seen = { opened: 0, closed: 0 };
  const p: Provider = {
    id,
    detect: async () => info(id, []),
    open: (o) => {
      seen.opened++;
      return { close: () => void seen.closed++, turn: (text, sink, signal) => script(o, text, sink, signal) };
    },
  };
  const saved = providers[id];
  providers[id] = p;
  return { seen, restore: () => (providers[id] = saved) };
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "lc-pc-dir-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "one\n");
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a"], { cwd: dir });
  return dir;
}

function session(extra: Partial<Thread> = {}, o: { git?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), "lc-pc-"));
  const dir = o.git ? repo() : mkdtempSync(join(tmpdir(), "lc-pc-dir-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: Boolean(o.git), createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Work", agent: "@claude:claude-opus-5-5", status: "idle", access: "full", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  const tools = new AgentTools(store, process.env);
  tools.url = "http://127.0.0.1:9";
  const runtime = new Runtime(store, process.env, tools);
  tools.host = runtime;
  runtime.providerInfo = [info("claude", ["claude-opus-5-5"]), info("codex", ["gpt-6-luna"])];
  runtime.doingMs = 0;
  return { store, runtime, tools, home, dir };
}

test("a brief's end keeps the lead's doing line while the lead's call still runs; the lead's own end clears it", async () => {
  const side = fake("codex", async (_o, _t, sink) => {
    sink.tool({ key: "w", tool: "Read", toolKind: "read", title: "Read a.txt", path: "a.txt", status: "running" });
    sink.tool({ key: "w", tool: "Read", toolKind: "read", title: "Read a.txt", path: "a.txt", status: "done" });
    sink.text("Read it.");
  });
  let afterBrief: string | undefined = "unset";
  let afterSecond: string | undefined = "unset";
  const { store, runtime, tools } = session({ sidekick: "codex:gpt-6-luna" }, { git: true });
  const lead = fake("claude", async (o, _t, sink) => {
    const key = o.mcp!.env.LINER_SURFACE_KEY;
    sink.tool({ key: "k1", tool: "mcp__liner__sidekick", toolKind: "other", title: "Sidekick", input: JSON.stringify({ brief: "Read a.txt." }), status: "running" });
    await tools.call(tools.threadOf(key)!, "sidekick", { brief: "Read a.txt." });
    // The brief has ended; the lead's call hasn't said it's done yet.
    afterBrief = store.thread("t").doing?.text;
    // A second brief, on a call of its own: still said all through it.
    sink.tool({ key: "k2", tool: "mcp__liner__sidekick", toolKind: "other", title: "Sidekick", input: JSON.stringify({ brief: "Read a.txt again." }), status: "running" });
    await tools.call(tools.threadOf(key)!, "sidekick", { brief: "Read a.txt again." });
    afterSecond = store.thread("t").doing?.text;
    sink.tool({ key: "k2", tool: "mcp__liner__sidekick", toolKind: "other", title: "Sidekick", status: "done", output: "ok" });
    sink.tool({ key: "k1", tool: "mcp__liner__sidekick", toolKind: "other", title: "Sidekick", status: "done", output: "ok" });
  });
  try {
    await runtime.send("t", "look");
    assert.equal(afterBrief, "Working with its sidekick");
    assert.equal(afterSecond, "Working with its sidekick");
    assert.equal(store.thread("t").doing, undefined, "the lead's own end clears it");
  } finally {
    side.restore();
    lead.restore();
  }
});

test("Stop: a tool that never ends its turn is closed after the grace, the turn ends as stopped, and the next message resumes it", async () => {
  const resumed: (string | undefined)[] = [];
  let turns = 0;
  const tool = fake("claude", async (o, _t, sink) => {
    resumed.push(o.resume);
    sink.session("own-1");
    // The first turn never hears the abort; the second ends as asked.
    if (++turns === 1) return new Promise<void>(() => {});
    sink.text("Back.");
  });
  const { store, runtime } = session();
  runtime.stopGraceMs = 60;
  try {
    const first = runtime.send("t", "go");
    await until(() => store.timeline("t").some((x) => x.kind === "turn" && x.status === "running") && turns === 1, "the turn runs");
    runtime.stop("t");
    await first;
    await until(() => store.thread("t").status !== "running", "the turn ended");
    const marker = store.timeline("t").find((x) => x.kind === "turn");
    assert.equal(marker?.kind === "turn" && marker.status, "stopped");
    assert.equal(tool.seen.closed, 1, "its live session was closed");
    assert.ok(store.timeline("t").some((x) => x.kind === "notice" && /hadn't stopped/.test(x.text)), "the timeline says why");
    await runtime.send("t", "again");
    await until(() => store.thread("t").status === "done", "the next message ran");
    assert.equal(tool.seen.opened, 2, "a new session for the next message");
    assert.equal(resumed[1], "own-1", "which resumes the one it closed");
  } finally {
    tool.restore();
  }
});

test("Stop: a tool that winds down inside the grace keeps its session and ends as it ends", async () => {
  let started = false;
  const tool = fake("claude", async (_o, _t, sink, signal) => {
    started = true;
    sink.session("own-1");
    await new Promise<void>((ok) => signal.addEventListener("abort", () => setTimeout(ok, 40), { once: true }));
    sink.text("Stopped cleanly.");
  });
  const { store, runtime } = session();
  runtime.stopGraceMs = 1000;
  try {
    const first = runtime.send("t", "go");
    await until(() => started, "the tool's turn runs");
    runtime.stop("t");
    await first;
    await until(() => store.thread("t").status !== "running", "the turn ended");
    assert.equal(tool.seen.closed, 0, "nothing was closed");
    assert.ok(!store.timeline("t").some((x) => x.kind === "notice" && /hadn't stopped/.test(x.text)));
  } finally {
    tool.restore();
  }
});

test("pull requests: the test run ends when its script exits, though something it left in the background holds its output", async () => {
  const { store, runtime, dir } = session({ access: "full", turns: 1 });
  writeFileSync(join(dir, "stub.sh"), "#!/bin/sh\nsleep 4 &\necho ok\nexit 0\n", { mode: 0o755 });
  store.putProject({ ...store.project("p"), scripts: [{ id: "s", name: "Test", command: "sh ./stub.sh" }] as never });
  store.putItem("t", { kind: "pr", id: "card", turn: 1, at: 1 });
  const started = Date.now();
  const result = await Promise.race([runtime.prTest("t", "card"), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
  assert.ok(result, "it ended well before the background sleep did");
  assert.equal(result.state, "passed");
  assert.ok(Date.now() - started < 3000);
});

/** A server on a store of its own, with an empty snapshot at the store's number. */
async function stream() {
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-pc-events-")));
  const server = await startServer({ store, api: { call: async () => null, ready: Promise.resolve() }, snapshot: async () => ({ seq: store.seq }) as never, token: "t", port: 0 });
  const notice = (body: string) => store.emit({ type: "notify", threadId: "t", kind: "done", title: "x", body });
  return { store, server, notice };
}

test("events: what happens in one moment goes to an app in one write, every line whole and numbered, in order", async () => {
  const { server, notice } = await stream();
  const res = await fetch(`http://127.0.0.1:${server.port}/events`, { headers: { "x-liner-token": "t" } });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const lines: { type: string; seq?: number; body?: string }[] = [];
  let buf = "";
  const more = async () => {
    const { value } = await reader.read();
    buf += value ?? "";
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      if (buf.slice(0, i).trim()) lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  };
  const write = ServerResponse.prototype.write;
  let writes = 0;
  try {
    while (!lines.some((l) => l.type === "hello")) await more();
    ServerResponse.prototype.write = function (this: ServerResponse, ...args: never[]) {
      writes++;
      return (write as (...a: never[]) => boolean).apply(this, args);
    } as typeof write;
    for (let i = 0; i < 200; i++) notice(`n${i}`);
    while (!lines.some((l) => l.body === "n199")) await more();
    ServerResponse.prototype.write = write;
    assert.ok(writes <= 2, `${writes} writes for 200 events`);
    const got = lines.filter((l) => l.type === "notify");
    assert.deepEqual(got.map((l) => l.body), Array.from({ length: 200 }, (_, i) => `n${i}`), "each event its own line, none merged or lost");
    for (let i = 1; i < got.length; i++) assert.equal(got[i].seq, got[i - 1].seq! + 1, "numbered one by one");
  } finally {
    ServerResponse.prototype.write = write;
    await reader.cancel();
    server.close();
  }
});

test("events: an app that stops reading is let go once too much waits for it, so it comes back to a fresh snapshot", async () => {
  const { server, notice } = await stream();
  const sock = connect(server.port, "127.0.0.1");
  await new Promise((r) => sock.once("connect", r));
  let ended = false;
  sock.on("close", () => (ended = true));
  sock.on("error", () => {});
  sock.write("GET /events HTTP/1.1\r\nHost: x\r\nx-liner-token: t\r\n\r\n");
  await tick(50);
  // It reads nothing from here on.
  sock.pause();
  const big = "x".repeat(256 * 1024);
  try {
    for (let i = 0; i < Math.ceil((BEHIND_BYTES * 3) / big.length) && !ended; i++) {
      notice(big);
      await tick(20);
    }
    sock.resume();
    await until(() => ended, "the server let it go", 5000);
  } finally {
    sock.destroy();
    server.close();
  }
});

test("session search: an agent's search reads each thread's name once, however many of its lines match", () => {
  const { store } = session();
  for (let i = 0; i < 50; i++) store.putItem("t", { kind: "text", id: `x${i}`, turn: 1, at: i, text: `the tide table again ${i}`, streaming: false });
  const peek = store.peek.bind(store);
  let names = 0;
  store.peek = ((id: string, kinds: Parameters<Store["peek"]>[1]) => (kinds.length === 1 && kinds[0] === "user" && names++, peek(id, kinds))) as Store["peek"];
  const hits = searchSessions(store, "p", "tide table", { limit: 60 });
  assert.equal(hits.length, 50);
  assert.ok(hits.every((h) => h.title === "Work"));
  assert.equal(names, 1);
});

test("checkpoints: forgetting a thread with many snapshots drops all of them, and only its own", async () => {
  const dir = repo();
  for (let i = 0; i < 25; i++) await capture(dir, `gone/${i}-before`);
  await capture(dir, "kept/1-before");
  await forget(dir, "gone");
  assert.equal(execFileSync("git", ["for-each-ref", "--format=%(refname)", "refs/liner/"], { cwd: dir, encoding: "utf8" }), "refs/liner/kept/1-before\n");
  await forget(dir, "none-here");
});

test("awake: looks again when work can start or end, not at each token, and not at all once stopped", () => {
  const { store } = session();
  let looks = 0;
  const awake = new Awake(store, () => (looks++, false));
  awake.start();
  const at = looks;
  store.putItem("t", { kind: "text", id: "x", turn: 1, at: 1, text: "", streaming: true }, false);
  for (let i = 0; i < 20; i++) store.appendText("t", "x", "word ");
  if (process.platform === "darwin" || process.platform === "win32") {
    assert.equal(looks, at, "an item and its deltas change nothing");
    store.patchThread("t", { status: "running" });
    assert.equal(looks, at + 1, "a session's status does");
    awake.stop();
    store.patchThread("t", { status: "done" });
    assert.equal(looks, at + 1, "stopped, it looks no more");
  }
  awake.stop();
});

test("a session deleted while its turn winds down: late writes don't bring back its log or a timeline", () => {
  const { store, home } = session();
  store.putItem("t", { kind: "notice", id: "n1", turn: 1, at: 1, text: "kept" });
  store.removeThread("t");
  store.putItem("t", { kind: "tool", id: "x", turn: 1, at: 1, tool: "Bash", toolKind: "exec", title: "Run ls", status: "stopped" });
  store.appendText("t", "x", "more");
  assert.equal(existsSync(join(home, "threads", "t.jsonl")), false, "no log file again");
  assert.deepEqual(store.timeline("t"), []);
  // The same id put again (a test, an import) is a thread again.
  store.putThread({ id: "t", projectId: "p", title: "Again", agent: "forge", status: "idle", access: "full", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
  store.putItem("t", { kind: "notice", id: "n2", turn: 1, at: 1, text: "back" });
  assert.equal(store.timeline("t").length, 1);
});

test("timelines nobody has used in a while go from memory past the newest kept, never one at work, and read back the same", () => {
  const { store } = session();
  const n = TIMELINES_KEPT + 5;
  for (let i = 0; i < n; i++) {
    store.putThread({ id: `s${i}`, projectId: "p", title: `S${i}`, agent: "forge", status: "done", access: "full", turns: 1, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
    store.putItem(`s${i}`, { kind: "notice", id: `n${i}`, turn: 1, at: i, text: `said ${i}` });
  }
  // One still streaming, one asking, one held by a turn: none of them goes.
  store.putItem("s0", { kind: "text", id: "live", turn: 1, at: 1, text: "so far", streaming: true }, false);
  store.putItem("s1", { kind: "approval", id: "ask", turn: 1, at: 1, tool: "Bash", title: "Run it", risk: "low", fields: [], state: "asking" });
  const later = Date.now() + TIMELINE_IDLE_MS + 1;
  assert.equal(store.letGoTimelines(() => false, Date.now()), 0, "nothing unused long enough");
  const gone = store.letGoTimelines((id) => id === "s2", later);
  assert.equal(gone, n - TIMELINES_KEPT, "down to the newest kept");
  assert.equal(store.timeline("s0").find((x) => x.id === "live")?.kind, "text", "the streaming one stayed in memory");
  const ask = store.timeline("s1").find((x) => x.id === "ask");
  assert.equal(ask?.kind === "approval" && ask.state, "asking", "an open card isn't settled by a read again");
  for (let i = 3; i < n; i++) assert.equal(store.timeline(`s${i}`).find((x) => x.id === `n${i}`)?.kind, "notice", "a timeline let go reads back from its log");
});

test("state.json is written whole and plain, with the .bak of the save before", () => {
  const { store, home } = session();
  store.flush();
  store.patchThread("t", { title: "Renamed" });
  store.flush();
  const text = readFileSync(join(home, "state.json"), "utf8");
  assert.ok(!text.includes("\n  "), "not indented");
  assert.equal((JSON.parse(text) as { threads: Thread[] }).threads[0].title, "Renamed");
  assert.equal((JSON.parse(readFileSync(join(home, "state.json.bak"), "utf8")) as { threads: Thread[] }).threads[0].title, "Work");
});

test("cards: each one answered stops listening for Stop, so a turn of many cards doesn't pile up listeners", async () => {
  let most = 0;
  let after = -1;
  const tool = fake("claude", async (_o, _t, sink, signal) => {
    for (let i = 0; i < 15; i++) {
      const asked = sink.approve({ tool: "Bash", title: `Run step ${i}`, risk: "low", fields: [{ label: "Command", value: `touch f${i}` }] }, signal);
      most = Math.max(most, getEventListeners(signal, "abort").length);
      await asked;
    }
    after = getEventListeners(signal, "abort").length;
  });
  const { store, runtime } = session({ access: "ask" });
  try {
    const going = runtime.send("t", "go");
    for (let i = 0; i < 15; i++) {
      await until(() => store.timeline("t").some((x) => x.kind === "approval" && x.state === "asking"), `card ${i}`);
      const card = store.timeline("t").find((x) => x.kind === "approval" && x.state === "asking")!;
      runtime.answer("t", card.id, true);
      await tick(1);
    }
    await going;
    assert.ok(after >= 0, "the turn ran to its end");
    assert.ok(after <= most - 1, `${after} listeners left after 15 cards (at most ${most} while one waited)`);
    assert.ok(after < 5);
  } finally {
    tool.restore();
  }
});

test("a session deleted: its surface key reaches nothing any more; an archived one keeps it", () => {
  const { store, runtime, tools } = session();
  void runtime;
  const key = tools.serverFor("t")!.env.LINER_SURFACE_KEY;
  assert.equal(tools.threadOf(key), "t");
  store.patchThread("t", { archived: true });
  void runtime.closeThread("t");
  assert.equal(tools.threadOf(key), "t", "archived: it may come back");
  store.removeThread("t");
  store.emit({ type: "thread.removed", id: "t" });
  assert.equal(tools.threadOf(key), undefined);
});

test("the doing line names a frame from its design file read once a step, not on every update of a running step", async () => {
  const seen: (string | undefined)[] = [];
  const { store, runtime, dir } = session();
  const ctx = designCtx(store);
  createFile(ctx, dir, "Tides", undefined, "tides");
  const { frame } = addFrame(ctx, dir, "tides", { name: "Phone / Week", w: 390, h: 844 }, "<p>hi</p>");
  const rename = (name: string) => {
    const file = join(dir, ".liner", "designs", "tides", "design.json");
    const d = JSON.parse(readFileSync(file, "utf8")) as { frames: { id: string; name: string }[] };
    d.frames[0].name = name;
    writeFileSync(file, JSON.stringify(d));
  };
  const node = (key: string, status: "running" | "done") => ({ key, tool: "mcp__liner__design_node", toolKind: "other" as const, title: "design_node", input: JSON.stringify({ design: "tides", frame: frame.id, html: "<p>x</p>" }), status });
  const tool = fake("claude", async (_o, _t, sink) => {
    sink.tool(node("1", "running"));
    seen.push(store.thread("t").doing?.text);
    // Renamed while the step runs: its updates keep the name it was read with.
    rename("Phone / Month");
    sink.tool({ ...node("1", "running"), title: "design_node again" });
    seen.push(store.thread("t").doing?.text);
    sink.tool(node("1", "done"));
    // The next step reads it afresh.
    sink.tool(node("2", "running"));
    seen.push(store.thread("t").doing?.text);
    sink.tool(node("2", "done"));
  });
  try {
    await runtime.send("t", "draw");
    assert.deepEqual(seen, ["Changing Phone / Week", "Changing Phone / Week", "Changing Phone / Month"]);
  } finally {
    tool.restore();
  }
});

test("while the Reviewer reads a change, the doing line says so, and it's gone when the read ends", async () => {
  let during: string | undefined;
  const make = (id: "claude" | "codex"): Provider => ({
    id,
    detect: async () => info(id, []),
    open: (o) => ({
      close() {},
      turn: async (_text, sink) => {
        if (o.access === "read") {
          during = store.thread("t").doing?.text;
          return sink.text(`<findings>{"verdict":"pass","summary":"fine","findings":[]}</findings>`);
        }
        writeFileSync(join(o.cwd, "b.txt"), "two\n");
        sink.text("Done.");
      },
    }),
  });
  const saved = { claude: providers.claude, codex: providers.codex };
  providers.claude = make("claude");
  providers.codex = make("codex");
  const { store, runtime } = session({ agent: "@claude:claude-sonnet-5-5", access: "edits" }, { git: true });
  runtime.providerInfo = [info("claude", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]), info("codex", ["gpt-6-sol", "gpt-6-sol-pro", "gpt-6-luna"])];
  // A one-line change is read too.
  store.setSettings({ reviewSmall: true });
  try {
    await runtime.send("t", "add b");
    assert.ok(store.timeline("t").some((x) => x.kind === "review"), "the Reviewer read it");
    assert.equal(during, "The Reviewer is reading the changes");
    assert.equal(store.thread("t").doing, undefined);
  } finally {
    Object.assign(providers, saved);
  }
});

test("usage: a read whose tool reports running totals that go down adds nothing for the drop, as the lead's and a brief's do", async () => {
  const tool = fake("codex", async (_o, _t, sink) => {
    sink.usage({ inputTokens: 100, outputTokens: 10, costUsd: 0.1 }, true);
    // A reset: its totals start again lower.
    sink.usage({ inputTokens: 40, outputTokens: 4, costUsd: 0.04 }, true);
    sink.text("ok");
  });
  const { store, runtime, dir } = session();
  try {
    await runtime.quiet("t", "codex:gpt-6-luna", dir, "read", new AbortController().signal);
    const u = store.thread("t").usage;
    assert.deepEqual([u.inputTokens, u.outputTokens], [100, 10], "what it used stays counted; the drop takes nothing off");
    assert.ok(Math.abs(u.costUsd - 0.1) < 1e-9);
  } finally {
    tool.restore();
  }
});

test("usage.jsonl: read once, then only what was added; a line still being written waits, and a file replaced is read afresh", () => {
  const { store, home } = session();
  const rec = (at: number, model = "m") => ({ at, threadId: "t", projectId: "p", agent: "a", provider: "claude" as const, model, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, costUsd: 0.01, seconds: 1 });
  store.logUsage(rec(1));
  store.logUsage(rec(2));
  assert.deepEqual(store.usage(0).map((r) => r.at), [1, 2]);
  store.logUsage(rec(3, "é"));
  const file = join(home, "usage.jsonl");
  appendFileSync(file, JSON.stringify(rec(4)).slice(0, 20));
  assert.deepEqual(store.usage(0).map((r) => r.at), [1, 2, 3], "the half-written line isn't read yet");
  appendFileSync(file, `${JSON.stringify(rec(4)).slice(20)}\n`);
  assert.deepEqual(store.usage(0).map((r) => r.at), [1, 2, 3, 4]);
  assert.deepEqual(store.usage(3).map((r) => r.at), [3, 4]);
  assert.equal(store.usage(0)[2].model, "é");
  writeFileSync(file, `${JSON.stringify(rec(9))}\n`);
  assert.deepEqual(store.usage(0).map((r) => r.at), [9], "replaced by a shorter file");
});

test("usage: a count that comes after its turn ended is that turn's, not word from the next turn, and a deleted session takes none", async () => {
  let n = 0;
  let late: (() => void) | undefined;
  let second: () => void = () => {};
  const tool = fake("claude", async (_o, _t, sink, signal) => {
    if (++n === 1) {
      // Stopped: it ends at once, and says what it used a moment later.
      await new Promise<void>((ok) => signal.addEventListener("abort", () => ok(), { once: true }));
      late = () => sink.usage({ inputTokens: 50, outputTokens: 5, costUsd: 0.5 });
      return;
    }
    await new Promise<void>((ok) => (second = ok));
  });
  const { store, runtime } = session();
  const turns = (runtime as unknown as { turns: Map<string, { heard?: number; turn: number }> }).turns;
  try {
    const first = runtime.send("t", "one");
    await until(() => n === 1 && turns.has("t"), "the first turn runs");
    runtime.stop("t");
    await first;
    const next = runtime.send("t", "two");
    await until(() => n === 2 && turns.get("t")?.turn === 2, "the second turn runs");
    const heardBefore = turns.get("t")!.heard;
    late!();
    assert.equal(turns.get("t")!.heard, heardBefore, "the second turn's watchdog didn't hear it");
    assert.equal(store.thread("t").usage.inputTokens, 50, "the thread counts it");
    const marks = store.timeline("t").filter((x) => x.kind === "turn");
    assert.deepEqual(marks.map((m) => (m.kind === "turn" ? m.costUsd : null)), [0.5, undefined], "on the first turn's mark, not the second's");
    assert.deepEqual(store.usage(0).filter((r) => r.inputTokens === 50).length, 1, "logged once, as its own line");
    second();
    await next;
    // Round 2 (#3): the late line says whose it is, and Usage reads it as more of that turn, not a turn more.
    const rows = store.usage(0);
    assert.deepEqual(rows.map((r) => [r.turn, r.late ?? false]), [[1, false], [1, true], [2, false]]);
    const { createApi, foldLate } = await import("../src/api.ts");
    const folded = foldLate(rows);
    assert.deepEqual(folded.map((r) => [r.turn, r.inputTokens, r.outputTokens, r.costUsd]), [[1, 50, 5, 0.5], [2, 0, 0, 0]], "one turn with the summed tokens");
    assert.equal(rows[0].inputTokens, 0, "the records usage() shares aren't written into");
    const api = createApi(store, runtime, process.env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
    const sum = (await api.call("usage.summary", { days: 1 })) as { totals: { turns: number; tokens: number; perTurn: number }; byAgent: { turns: number }[]; days: { turns: number }[] };
    assert.equal(sum.totals.turns, 2, "two turns, not three");
    assert.equal(sum.totals.tokens, 55);
    assert.ok(Math.abs(sum.totals.perTurn - 0.25) < 1e-9);
    assert.deepEqual(sum.byAgent.map((a) => a.turns), [2]);
    assert.equal(sum.days.reduce((n, d) => n + d.turns, 0), 2);
    // Deleted meanwhile: a count still to come takes nothing and throws nothing.
    store.removeThread("t");
    late!();
  } finally {
    tool.restore();
  }
});
