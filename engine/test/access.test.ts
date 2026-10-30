/*
  What an agent may do on its own, as the runtime decides it: Auto lets the tool's own auto mode
  through and reads and edits what it hands over; Reviewer decides asks the Reviewer (another
  family's quickest model) about each step and only brings you what it won't allow; every ask
  names the tool call it's for. And the session's dev servers stop when they should, never
  another app's. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Access, Item, ProviderId, ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { castOf, emptyUsage } from "../../contracts/src/index.ts";
import { parseStep, quickOf, stepPrompt } from "../src/review.ts";
import { readsOnly } from "../src/risk.ts";
import { providers, QUIET_MS, Runtime } from "../src/runtime.ts";
import type { OpenOptions, Provider } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";
import { run, THREAD_ENV } from "../src/exec.ts";
import { listeningPorts, stoppableGroup, stopServers } from "../src/surfaces.ts";

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const ready = [info("claude", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]), info("codex", ["gpt-6-sol", "gpt-6-luna-mini"])];

test("reads: a quoted path with spaces and a quoted pattern are arguments, not redirects", () => {
  assert.equal(readsOnly(`cd "/Users/x/Project/Liner Codes/Test" && sed -n '/<script>/,/<\\/script>/p' index.html`), true);
  assert.equal(readsOnly(`grep -n "a|b" src/app.ts`), true);
  assert.equal(readsOnly(`cat notes.txt > copy.txt`), false);
  assert.equal(readsOnly(`echo "$(rm -rf /)"`), false, "double quotes still run what's inside $( )");
  assert.equal(readsOnly(`sed -i '' 's/a/b/' x`), false);
});

test("reviewer decides: the call reads ALLOW or ASK, the Reviewer's quickest model makes it, the prompt carries the ask", () => {
  assert.deepEqual(parseStep("ALLOW: builds the project in its folder"), { allow: true, reason: "builds the project in its folder" });
  assert.deepEqual(parseStep("ASK — pushes to the remote"), { allow: false, reason: "pushes to the remote" });
  assert.equal(parseStep("I think it's fine"), null);
  assert.equal(quickOf("claude:claude-opus-5-5", ready), "claude:claude-haiku-5-5");
  assert.equal(quickOf("codex:gpt-6-sol", ready), "codex:gpt-6-luna-mini");
  assert.equal(quickOf("opencode:x", ready), "opencode:x");
  const p = stepPrompt("make the tests pass", { title: "Run npm test", fields: [{ label: "Command", value: "npm test" }], risk: "low" }, "/tmp/p");
  assert.match(p, /make the tests pass[\s\S]*Command: npm test[\s\S]*ALLOW or ASK/);
});

type Call = { model: string; read: boolean; text: string };

/** A coder that asks before running `command`, and readers (the Reviewer) that answer with `verdict`. */
function fakeTools(calls: Call[], command: string, verdict: (text: string) => string) {
  const make = (id: ProviderId): Provider => ({
    id,
    detect: async () => info(id, []),
    open: (o: OpenOptions) => ({
      turn: async (text, sink, signal) => {
        calls.push({ model: o.model, read: o.access === "read", text });
        if (o.access === "read") return sink.text(verdict(text));
        sink.tool({ key: "call-1", tool: "Bash", toolKind: "exec", title: `Run ${command}`, input: command, status: "running" });
        const a = await sink.approve({ key: "call-1", tool: "Bash", title: `Run ${command}`, risk: "low", fields: [{ label: "Command", value: command }], rule: command }, signal);
        sink.tool({ key: "call-1", tool: "Bash", toolKind: "exec", title: `Run ${command}`, status: a.allow ? "done" : "failed", output: a.allow ? "ok" : a.reason });
        sink.text(a.allow ? "Ran it." : "Didn't run it.");
      },
      update: async (u) => (Object.assign(o, u), true),
      close() {},
    }),
  });
  const saved = { claude: providers.claude, codex: providers.codex };
  providers.claude = make("claude");
  providers.codex = make("codex");
  return () => Object.assign(providers, saved);
}

function session(access: Access) {
  const home = mkdtempSync(join(tmpdir(), "lc-access-"));
  const dir = mkdtempSync(join(tmpdir(), "lc-access-dir-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  const t: Thread = { id: "t", projectId: "p", title: "New session", agent: "forge", status: "idle", access, turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() };
  store.putThread(t);
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = ready;
  return { store, runtime };
}

const asks = (items: Item[]) => items.filter((x): x is Extract<Item, { kind: "approval" }> => x.kind === "approval");
const callId = (items: Item[]) => items.find((x) => x.kind === "tool")?.id;

test("reviewer decides: a routine step goes ahead on the Reviewer's word, and the ask is kept on its tool call", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, "npm run build", (text) => (/You decide, for a person/.test(text) ? "ALLOW: builds the project" : "Fine."));
  try {
    const { store, runtime } = session("review");
    await runtime.send("t", "build it");
    // Forge is Claude, so the Reviewer is Codex, on its quickest model.
    assert.deepEqual(calls.map((c) => `${c.model}${c.read ? " reads" : " works"}`).slice(0, 2), ["claude-sonnet-5-5 works", "gpt-6-luna-mini reads"]);
    assert.match(calls[1].text, /build it[\s\S]*npm run build/);
    const items = store.timeline("t");
    const [a] = asks(items);
    assert.deepEqual([a.state, a.reviewer, a.reason, a.toolId], ["approved", "codex:gpt-6-luna-mini", "builds the project", callId(items)]);
    assert.equal(store.thread("t").status === "waiting", false);
  } finally {
    restore();
  }
});

test("reviewer decides: what the Reviewer won't allow comes to you with its reason; reading never asks it", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, "git push origin main", () => "ASK: pushes to the remote");
  try {
    const { store, runtime } = session("review");
    const sent = runtime.send("t", "ship it");
    let a: ReturnType<typeof asks>[number] | undefined;
    for (let i = 0; i < 100 && !a; i++) {
      await new Promise((r) => setTimeout(r, 20));
      a = asks(store.timeline("t")).find((x) => x.state === "asking");
    }
    assert.ok(a, "it asks you");
    assert.match(a.description ?? "", /reviewing: pushes to the remote/);
    assert.equal(a.toolId, callId(store.timeline("t")));
    runtime.answer("t", a.id, false);
    await sent;
    assert.equal(asks(store.timeline("t"))[0].state, "denied");
  } finally {
    restore();
  }
  const reads: Call[] = [];
  const restore2 = fakeTools(reads, `cd "/a b" && cat x.txt`, () => "ASK: never asked");
  try {
    const { store, runtime } = session("review");
    await runtime.send("t", "look");
    assert.equal(reads.filter((c) => c.read && /You decide/.test(c.text)).length, 0);
    assert.equal(asks(store.timeline("t")).length, 0);
  } finally {
    restore2();
  }
});

test("auto: what the tool's own auto mode hands over goes ahead when it only reads; anything else asks you", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, "ls -la", () => "");
  try {
    const { store, runtime } = session("auto");
    await runtime.send("t", "look");
    assert.equal(asks(store.timeline("t")).length, 0);
  } finally {
    restore();
  }
  const restore2 = fakeTools([], "npm install left-pad", () => "");
  try {
    const { store, runtime } = session("auto");
    const sent = runtime.send("t", "add it");
    let a: ReturnType<typeof asks>[number] | undefined;
    for (let i = 0; i < 100 && !a; i++) {
      await new Promise((r) => setTimeout(r, 20));
      a = asks(store.timeline("t"))[0];
    }
    assert.equal(a?.state, "asking");
    runtime.answer("t", a!.id, true);
    await sent;
    const items = store.timeline("t");
    assert.deepEqual([asks(items)[0].state, asks(items)[0].toolId], ["approved", callId(items)]);
  } finally {
    restore2();
  }
});

test("stopping: a group holding the engine, or something it started directly, is never signalled", () => {
  const table = new Map([
    [1, { ppid: 0, pgid: 1 }],
    [100, { ppid: 1, pgid: 100 }], // the app
    [200, { ppid: 100, pgid: 100 }], // the engine, in the app's group
    [300, { ppid: 200, pgid: 300 }], // an agent CLI the engine started
    [310, { ppid: 300, pgid: 300 }], // a dev server in the CLI's group
    [400, { ppid: 300, pgid: 400 }], // a shell job of its own
    [410, { ppid: 400, pgid: 400 }], // a dev server in that job
  ]);
  assert.equal(stoppableGroup(table, 410, 200), 400);
  assert.equal(stoppableGroup(table, 310, 200), null, "the agent's own group");
  assert.equal(stoppableGroup(table, 200, 200), null, "the engine's group");
});

/** A Node server on a free port, in a group of its own like a shell job, with `env`. */
function serve(cwd: string, env: Record<string, string>) {
  const child = spawn(process.execPath, ["-e", `const s=require("http").createServer((q,r)=>{r.writeHead(200,{"content-type":"text/html"});r.end("ok")});s.listen(0,"127.0.0.1",()=>console.log(s.address().port))`], { cwd, env: { ...process.env, ...env }, detached: true });
  return new Promise<{ port: number; pid: number; stop: () => void }>((resolve, reject) => {
    child.stdout.once("data", (d: Buffer) => resolve({ port: Number(String(d).trim()), pid: child.pid!, stop: () => child.kill() }));
    child.once("error", reject);
  });
}

test("stopping: the session's server stops, alone or as the session is archived; another app's stays up", async () => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "lc-stop-")));
  const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "lc-stop-else-")));
  const mine = { threadId: "th_stop", folders: [folder] };
  const [own, inFolder, other] = await Promise.all([serve(elsewhere, { [THREAD_ENV]: "th_stop" }), serve(folder, {}), serve(elsewhere, {})]);
  try {
    await assert.rejects(stopServers(process.env, mine, { port: other.port }), /isn't this session's/);
    // Archiving stops what the session started, not the project's own server.
    assert.deepEqual(await stopServers(process.env, mine, { only: "session" }), [own.port]);
    const after = (await listeningPorts(process.env, mine)).map((s) => s.port);
    assert.equal(after.includes(own.port), false);
    assert.ok(after.includes(inFolder.port) && after.includes(other.port));
    // Asked for by port, the project's server stops too.
    assert.deepEqual(await stopServers(process.env, mine, { port: inFolder.port }), [inFolder.port]);
    assert.equal((await listeningPorts(process.env, mine)).some((s) => s.port === inFolder.port), false);
    assert.ok((await run("ps", ["-p", String(other.pid)])).code === 0, "another app's server is still running");
  } finally {
    for (const s of [own, inFolder, other]) s.stop();
  }
});

test("reviewer: a later turn is read against every ask, the latest marked, not only the first", async () => {
  const calls: Call[] = [];
  const write = (id: ProviderId): Provider => ({
    id,
    detect: async () => info(id, []),
    open: (o: OpenOptions) => ({
      turn: async (text, sink) => {
        calls.push({ model: o.model, read: o.access === "read", text });
        if (o.access === "read") return sink.text(`<findings>{"verdict":"pass","summary":"fine","findings":[]}</findings>`);
        writeFileSync(join(o.cwd, `turn${calls.length}.html`), `<p>${text}</p>\n`);
        sink.text("Done.");
      },
      update: async (u) => (Object.assign(o, u), true),
      close() {},
    }),
  });
  const saved = { claude: providers.claude, codex: providers.codex };
  providers.claude = write("claude");
  providers.codex = write("codex");
  try {
    const home = mkdtempSync(join(tmpdir(), "lc-asks-"));
    const dir = mkdtempSync(join(tmpdir(), "lc-asks-repo-"));
    const git = (...args: string[]) => run("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "user.name=Test", "-c", "user.email=t@example.com", ...args], { cwd: dir });
    await git("init", "-q", "-b", "main");
    writeFileSync(join(dir, "README.md"), "# p\n");
    await git("add", "-A");
    await git("commit", "-q", "-m", "start");
    const store = new Store(home);
    store.setSettings({ reviewSmall: true });
    store.putProject({ id: "p", name: "p", path: dir, git: true, createdAt: Date.now() });
    store.putThread({ id: "t", projectId: "p", title: "New session", agent: "forge", status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
    const runtime = new Runtime(store, process.env);
    runtime.providerInfo = ready;
    await runtime.send("t", "make a basic counter page");
    await runtime.send("t", "add a Reset button");
    const reads = calls.filter((c) => c.read);
    assert.equal(reads.length, 2);
    assert.match(reads[0].text, /<ask>\nmake a basic counter page\n<\/ask>/);
    assert.match(reads[1].text, /An earlier ask \(1 of 2\):\nmake a basic counter page\n\nThe latest ask, which this change is for:\nadd a Reset button/);
  } finally {
    Object.assign(providers, saved);
  }
});

test("routed: your picks for each role win while their tool is ready; one that isn't falls back", () => {
  const auto = castOf(ready)!;
  const mine = castOf(ready, { everyday: "claude:claude-haiku-5-5", judge: "codex:gpt-6-sol", critics: ["claude:claude-sonnet-5-5", "claude:claude-sonnet-5-5"] })!;
  assert.deepEqual(mine, { everyday: "claude:claude-haiku-5-5", strong: auto.strong, judge: "codex:gpt-6-sol", critics: ["claude:claude-sonnet-5-5"] });
  assert.equal(castOf(ready, { everyday: "cursor:fast", critics: ["grok:x"] })!.everyday, auto.everyday, "Cursor isn't ready here");
  assert.deepEqual(castOf(ready, { critics: ["grok:x"] })!.critics, auto.critics);
});

test("limits: another account of the same tool carries on first, on the same model; else another family's everyday pick", () => {
  const runtime = new Runtime(new Store(mkdtempSync(join(tmpdir(), "lc-limit-"))), process.env);
  runtime.providerInfo = ready;
  assert.equal(runtime.fallbackFor("claude", "claude-sonnet-5-5"), "codex:gpt-6-luna-mini");
  runtime.providerInfo = [...ready, info("claude.work" as ProviderId, ["claude-opus-5-5", "claude-sonnet-5-5"])];
  assert.equal(runtime.fallbackFor("claude", "claude-sonnet-5-5"), "claude.work:claude-sonnet-5-5");
  runtime.providerInfo = [ready[0]];
  assert.equal(runtime.fallbackFor("claude", "claude-sonnet-5-5"), undefined, "nothing else is ready");
});

test("limits: a session that runs out carries on with the other tool, the conversation going with it, when you said so", async () => {
  const calls: Call[] = [];
  const make = (id: ProviderId): Provider => ({
    id,
    detect: async () => info(id, []),
    open: (o: OpenOptions) => ({
      turn: async (text, sink) => {
        calls.push({ model: o.model, read: o.access === "read", text });
        if (id === "claude") return sink.limited("You've hit your limit.", Date.now() + 3_600_000);
        sink.text("Carried on.");
      },
      update: async () => false,
      close() {},
    }),
  });
  const saved = { claude: providers.claude, codex: providers.codex };
  providers.claude = make("claude");
  providers.codex = make("codex");
  try {
    const { store, runtime } = session("edits");
    store.setSettings({ onLimit: "carry" });
    await runtime.send("t", "make the counter page");
    for (let i = 0; i < 100 && calls.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    for (let i = 0; i < 100 && store.thread("t").status === "running"; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(calls.map((c) => c.model), ["claude-sonnet-5-5", "gpt-6-luna-mini"]);
    assert.match(calls[1].text, /make the counter page[\s\S]*Continue where you left off\./, "the conversation goes over with it");
    const items = store.timeline("t");
    assert.equal(items.find((x) => x.kind === "limit")?.kind === "limit" && (items.find((x) => x.kind === "limit") as { fallback?: string }).fallback, "codex:gpt-6-luna-mini");
    assert.ok(items.some((x) => x.kind === "notice" && /out of usage, so .* carries on/.test(x.text)));
    assert.equal(store.thread("t").model, "codex:gpt-6-luna-mini");
  } finally {
    Object.assign(providers, saved);
  }
});

test("watchdog: a turn that says nothing for a while is flagged once, and not while it waits on you", async () => {
  let release = () => {};
  const make = (id: ProviderId): Provider => ({
    id,
    detect: async () => info(id, []),
    open: () => ({
      turn: async (_text, sink, signal) => {
        sink.text("Starting.");
        await new Promise<void>((r) => ((release = r), signal.addEventListener("abort", () => r(), { once: true })));
      },
      update: async () => false,
      close() {},
    }),
  });
  const saved = { claude: providers.claude, codex: providers.codex };
  providers.claude = make("claude");
  try {
    const { store, runtime } = session("edits");
    const sent = runtime.send("t", "build it");
    await new Promise((r) => setTimeout(r, 50));
    runtime.watchQuiet(Date.now() + QUIET_MS - 5_000);
    assert.equal(store.timeline("t").filter((x) => x.kind === "notice").length, 0, "not yet");
    runtime.watchQuiet(Date.now() + QUIET_MS + 60_000);
    runtime.watchQuiet(Date.now() + QUIET_MS + 120_000);
    const said = store.timeline("t").filter((x) => x.kind === "notice");
    assert.equal(said.length, 1, "once");
    assert.match(said[0].kind === "notice" ? said[0].text : "", /^No word from Forge for [45] minutes\. It may be stuck/);
    release();
    await sent;
  } finally {
    Object.assign(providers, saved);
  }
});
