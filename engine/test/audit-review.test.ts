/*
  The small fixes a review of the audit left, one test each, and each failed on the code before its
  fix. The tools are stand-ins: Claude Code's SDK, Node scripts speaking ACP or Codex's app server,
  and a local model endpoint. Nothing real runs. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Endpoint, Item, ProviderInfo, Question, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { acpProvider } from "../src/providers/acp.ts";
import { claude, sdk } from "../src/providers/claude.ts";
import { CodexServerSession } from "../src/providers/codex-server.ts";
import { askEndpoint } from "../src/providers/plain.ts";
import { Outside } from "../src/outside-tools.ts";
import { parseFindings } from "../src/review.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { ApprovalRequest, OpenOptions, Provider, ProviderSession, TurnSink, WakeTurn } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 300 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}
/** Within `ms`, or says it hung. */
const settled = (p: Promise<unknown>, ms = 4000) => Promise.race([p.then(() => "ok", (e: Error) => `rejected: ${e.message}`), tick(ms).then(() => "hung")]);
const live = () => new AbortController().signal;

function recorder() {
  const r = { approvals: [] as ApprovalRequest[], asked: [] as Question[][], notices: [] as { text: string; key?: string }[] };
  const sink = {
    text: () => {}, reasoning: () => {}, tool: () => {}, plan: () => {}, usage: () => {}, session: () => {}, error: () => {}, limited: () => {},
    approve: async (q: ApprovalRequest) => (r.approvals.push(q), { allow: true }), ask: async (q: Question[]) => (r.asked.push(q), null), propose: async () => ({ approve: true }),
    notice: (text: string, key?: string) => void r.notices.push({ text, key }),
  } as unknown as TurnSink;
  return { r, sink };
}

/* Claude Code's SDK, stood in for as audit-claude-mcp.test.ts does. */

type Stand = { sent: SDKUserMessage[]; emit: (m: unknown) => void; options: Record<string, unknown> };
function standIn(over: Record<string, unknown> = {}) {
  const made: Stand[] = [];
  const saved = sdk.query;
  sdk.query = (({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Record<string, unknown> }) => {
    const out: unknown[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    const s: Stand = { sent: [], emit: (m) => (out.push(m), wake?.()), options };
    made.push(s);
    void (async () => {
      for await (const m of prompt) s.sent.push(m);
    })();
    return {
      async *[Symbol.asyncIterator]() {
        while (!ended || out.length) {
          if (out.length) yield out.shift();
          else await new Promise<void>((r) => (wake = r));
        }
      },
      initializationResult: async () => ({}),
      interrupt: async () => {},
      setModel: async () => {},
      setPermissionMode: async () => {},
      applyFlagSettings: async () => {},
      setMcpServers: async () => ({ added: [], removed: [], errors: {} }),
      return: async () => ((ended = true), wake?.(), { done: true, value: undefined }),
      ...over,
    };
  }) as unknown as typeof sdk.query;
  return { made, restore: () => (sdk.query = saved) };
}

const claudeOpts = (extra: Partial<OpenOptions> = {}): OpenOptions => ({ cwd: "/tmp", model: "claude-opus-5-5", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: "" }, ...extra });
const result = (extra: Record<string, unknown> = {}) => ({ type: "result", subtype: "success", is_error: false, result: "", num_turns: 1, duration_ms: 1, duration_api_ms: 1, stop_reason: null, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: {}, permission_denials: [], uuid: "r", session_id: "s", ...extra });
const started = (id: string, extra: Record<string, unknown> = {}) => ({ type: "system", subtype: "task_started", task_id: id, tool_use_id: `tu-${id}`, description: "work", task_type: "local_agent", uuid: "x", session_id: "s", ...extra });
type Ask = (name: string, input: Record<string, unknown>, o: Record<string, unknown>) => Promise<{ behavior: string; message?: string }>;
const askOf = (s: Stand) => s.options.canUseTool as Ask;
const askOptions = (extra: Record<string, unknown> = {}) => ({ signal: live(), toolUseID: "t1", ...extra });
const elicit = (s: Stand) => s.options.onElicitation as (q: Record<string, unknown>, o: { signal: AbortSignal }) => Promise<{ action: string; content?: unknown }>;
/** Your n-th message reached Claude Code, and it answers. */
async function answers(made: Stand[], n: number) {
  await until(() => made[0]?.sent.length === n, `message ${n} went`);
  made[0].emit(result({ user_message_uuids: [made[0].sent[n - 1].uuid] }));
}

/* The turn loop, as in audit-runtime.test.ts: a session, with a fake tool or Claude Code's own driver on the stand-in. */

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const ready = [info("claude", ["claude-opus-5-5"])];

function session(extra: Partial<Thread> = {}) {
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-audit-")));
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-audit-dir-")), git: false, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Work", agent: "forge", status: "idle", access: "ask", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = ready;
  return { store, runtime };
}
function fake(work: (text: string, sink: TurnSink, signal: AbortSignal) => Promise<void> | void) {
  const texts: string[] = [];
  const saved = providers.claude;
  const open = () => ({
    close: () => {},
    turn: async (text, sink, signal) => {
      texts.push(text);
      await work(text, sink, signal);
    },
  }) as ProviderSession;
  providers.claude = { id: "claude", detect: async () => info("claude", []), open } as Provider;
  return { texts, restore: () => (providers.claude = saved) };
}
/** The turn loop on Claude Code's real driver, which only ever meets the stand-in. */
function driven(over: Record<string, unknown> = {}) {
  const { made, restore } = standIn(over);
  const saved = providers.claude;
  providers.claude = { ...claude, open: (o) => claude.open({ ...o, env: { PATH: "" } }) };
  return { made, restore: () => (restore(), (providers.claude = saved)) };
}
const asking = (items: Item[]) => items.filter((x) => x.kind === "question" && x.state === "asking");

/* ACP agents and Codex's app server, small Node scripts as in audit-codex-acp.test.ts. */

function script(name: string, on: string, head = "") {
  const dir = mkdtempSync(join(tmpdir(), "lc-audit-"));
  const file = join(dir, name);
  writeFileSync(file, `#!/usr/bin/env node
const fs = require("fs");
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const seen = (word) => fs.readFileSync(process.env.FAKE_LOG, "utf8").split("\\n").filter((l) => l.includes(word)).length;
${head}
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    fs.appendFileSync(process.env.FAKE_LOG, line + "\\n");
    ${on}
  }
});
`, { mode: 0o755 });
  const log = join(dir, "log.jsonl");
  writeFileSync(log, "");
  const read = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { file, log, read };
}
const toolOpts = (extra: Partial<OpenOptions> = {}) => ({ cwd: mkdtempSync(join(tmpdir(), "lc-audit-cwd-")), model: "default", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: "" }, ...extra }) as OpenOptions;
const acpAgent = (first = "", newResult = `{ sessionId: "s-1" }`) => `
${first}
if (m.method === "initialize") send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
else if (m.method === "session/new") send({ id: m.id, result: ${newResult} });
else if (m.method === "session/prompt") send({ id: m.id, result: { stopReason: "end_turn" } });
else if (m.id !== undefined && m.method) send({ id: m.id, result: {} });`;
function acp(on: string, extra: Partial<OpenOptions> = {}, head = "") {
  const fake = script("agent", on, head);
  const p = acpProvider("acp.fake" as ProviderInfo["id"], { label: "Fake", cmd: [fake.file], login: "" });
  const s = p.open(toolOpts({ ...extra, env: { ...process.env, FAKE_LOG: fake.log, ...extra.env } }));
  return { fake, s };
}
const MODES = `{ sessionId: "s-1", modes: { currentModeId: "build", availableModes: [{ id: "build" }, { id: "plan" }] } }`;
const codexServer = (first = "") => `
${first}
if (m.method === "initialize") send({ id: m.id, result: {} });
else if (m.method === "thread/start") send({ id: m.id, result: { thread: { id: "root" } } });
else if (m.method === "turn/start") { send({ id: m.id, result: { turn: { id: "turn-1" } } }); setTimeout(() => send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } }), 10); }
else if (m.id !== undefined && m.method) send({ id: m.id, result: {} });`;

/* ------------------------------------------ Claude Code ------------------------------------------ */

test("liner's tools go without a card from a server handed over at run time, or one that doesn't say; from any other source they ask", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(claudeOpts({ mcp: { command: "node", args: ["mcp.ts"], env: {} } }));
    const { r, sink } = recorder();
    const turn = s.turn("go", sink, live());
    await until(() => made[0]?.sent.length === 1, "your message went");
    const ask = askOf(made[0]);
    for (const mcpServer of [{ name: "liner", source: "dynamic" }, { name: "liner" }, undefined]) {
      assert.equal((await ask("mcp__liner__memory_add", {}, askOptions({ mcpServer }))).behavior, "allow");
      assert.equal(r.approvals.length, 0, `no card for ${JSON.stringify(mcpServer)}`);
    }
    for (const source of ["agent", "enterprise", "claudeai", "a-source-from-next-year"]) {
      const before = r.approvals.length;
      await ask("mcp__liner__memory_add", {}, askOptions({ mcpServer: { name: "liner", source } }));
      assert.equal(r.approvals.length, before + 1, `${source} asks`);
    }
    made[0].emit(result({ user_message_uuids: [made[0].sent[0].uuid] }));
    await turn;
    s.close();
  } finally {
    restore();
  }
});

test("routines: a server's form is declined at once with nobody there, while the agent's own question still waits for you", async () => {
  const { made, restore } = driven();
  try {
    const { store, runtime } = session({ routine: { id: "r", run: "run" } });
    const run = runtime.unattendedTurn("t", () => runtime.send("t", "routine"));
    await until(() => made[0]?.sent.length === 1, "the step runs");
    const form = elicit(made[0])({ serverName: "deploy", message: "Which?", mode: "form", requestedSchema: { type: "object", properties: { env: { type: "string", enum: ["a", "b"] } } } }, { signal: live() });
    assert.equal(await settled(form, 500), "ok", "it doesn't sit on the routine");
    assert.deepEqual(await form, { action: "decline" });
    assert.equal(asking(store.timeline("t")).length, 0, "and no card was left open");
    const asked = askOf(made[0])("AskUserQuestion", { questions: [{ question: "Which one?", header: "Pick", options: [{ label: "a" }, { label: "b" }] }] }, askOptions());
    await until(() => asking(store.timeline("t")).length === 1, "the question is put to you");
    assert.equal(await settled(asked, 100), "hung", "it waits, as it did");
    runtime.answerQuestion("t", asking(store.timeline("t"))[0].id, { "Which one?": "a" });
    assert.equal((await asked).behavior, "allow");
    await answers(made, 1);
    await run;
  } finally {
    restore();
  }
});

test("effort: refused while work runs in the background, it's said on the next turn and tried again on the one after", async () => {
  let refuse = true;
  const tried: Record<string, unknown>[] = [];
  const { made, restore } = driven({
    applyFlagSettings: async (f: Record<string, unknown>) => {
      tried.push(f);
      if (refuse) throw new Error("no such control request");
    },
  });
  try {
    const { store, runtime } = session({ effort: "medium" });
    const first = runtime.send("t", "first");
    await until(() => made[0]?.sent.length === 1, "the turn runs");
    made[0].emit(started("dev", { is_backgrounded: true, task_type: "local_bash" }));
    await answers(made, 1);
    await first;
    store.patchThread("t", { effort: "high" });
    const second = runtime.send("t", "second");
    await answers(made, 2);
    await second;
    assert.equal(made.length, 1, "the dev server stays up");
    assert.equal(tried.length, 1);
    assert.ok(store.timeline("t").some((x) => x.kind === "notice" && /kept its effort/.test(x.text)), "it says so");
    refuse = false;
    const third = runtime.send("t", "third");
    await answers(made, 3);
    await third;
    assert.equal(tried.length, 2, "the next turn tries again");
    assert.equal(tried[1].effortLevel, "high");
    const fourth = runtime.send("t", "fourth");
    await answers(made, 4);
    await fourth;
    assert.equal(tried.length, 2, "and once it took, that's the end of it");
  } finally {
    restore();
  }
});

/* ------------------------------------------- The queue ------------------------------------------- */

test("queue: a /compact that waited goes alone, and the message after it goes as the next turn", async () => {
  let release = () => {};
  const { texts: sent, restore } = fake(async (text) => {
    if (text === "first") await new Promise<void>((r) => (release = r));
  });
  try {
    const { store, runtime } = session();
    const first = runtime.send("t", "first");
    await until(() => sent.length === 1, "the turn runs");
    await runtime.send("t", "/compact");
    await runtime.send("t", "and carry on");
    assert.equal(store.thread("t").queue?.length, 2);
    release();
    await first;
    await until(() => sent.length >= 2 && !runtime.isRunning("t") && !store.thread("t").queue?.length, "the queue empties");
    assert.equal(sent[1], "/compact", "the tool sees the command, not words");
    assert.equal(sent.length, 3);
    assert.match(sent[2], /and carry on/);
    assert.doesNotMatch(sent[2], /\/compact/);
  } finally {
    restore();
  }
});

/* ---------------------------------------------- ACP ---------------------------------------------- */

test("acp: an agent that dies leaving a child outside its group on the pipes fails the turn", async () => {
  const { s, fake } = acp(acpAgent(`if (m.method === "session/prompt") {
    const kid = require("child_process").spawn("sleep", ["20"], { stdio: "inherit", detached: true });
    fs.writeFileSync(process.env.FAKE_LOG + ".pid", String(kid.pid));
    process.exit(7);
  }`));
  const end = await settled(s.turn("hi", recorder().sink, live()), 2500);
  s.close();
  try {
    process.kill(Number(readFileSync(`${fake.log}.pid`, "utf8")), "SIGKILL");
  } catch {
    // Gone already.
  }
  assert.match(end, /^rejected/);
});

test("acp: a switch still on its way isn't sent again or waited for; one that failed goes again before the prompt", async () => {
  const { fake, s } = acp(
    acpAgent(`if (m.method === "session/set_mode" && m.params.modeId === "build") { held.push(m.id); continue; }
    if (m.method === "session/set_mode" && seen('"modeId":"plan"') === 2) { send({ id: m.id, error: { code: -1, message: "busy" } }); continue; }
    if (m.method === "session/prompt") for (const id of held.splice(0)) send({ id, result: {} });`, MODES),
    { access: "read" },
    "const held = [];",
  );
  await s.turn("one", recorder().sink, live());
  await s.update!({ model: "default", effort: "medium", access: "edits" });
  const end = await settled(s.turn("two", recorder().sink, live()), 2000);
  const after = fake.read().filter((m) => m.method === "session/set_mode").map((m) => m.params.modeId);
  await s.update!({ model: "default", effort: "medium", access: "read" });
  await until(() => fake.read().filter((m) => m.method === "session/set_mode").length === after.length + 1, "it tries to go in");
  await tick(30);
  await s.turn("three", recorder().sink, live());
  s.close();
  assert.equal(end, "ok", "the prompt didn't wait on the switch");
  assert.deepEqual(after, ["plan", "build"], "and it went once");
  assert.deepEqual(fake.read().filter((m) => m.method === "session/set_mode" || m.method === "session/prompt").map((m) => m.params.modeId ?? "prompt"), ["plan", "prompt", "build", "prompt", "plan", "plan", "prompt"]);
});

/* --------------------------------------------- Codex --------------------------------------------- */

const SPAWN = `send({ method: "item/completed", params: { threadId: "root", turnId: "turn-1", item: { type: "collabAgentToolCall", id: "spawn-kid", tool: "spawnAgent", senderThreadId: "root", receiverThreadIds: ["kid"], prompt: "check the kid tests", status: "completed", agentsStates: {} } } });`;
const KID_ENDS = `
  send({ method: "item/completed", params: { threadId: "kid", turnId: "t-kid", item: { type: "agentMessage", id: "w-kid", text: "kid found 2 failures" } } });
  send({ method: "turn/completed", params: { threadId: "kid", turn: { id: "t-kid", status: "completed" } } });`;

test("codex: a subagent's wake waiting when the session closes is gone with it, and opens nothing", async () => {
  const wakes: WakeTurn[] = [];
  const fake = script("codex", codexServer(`if (m.method === "turn/start" && seen("turn/start") === 1) {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    send({ method: "turn/started", params: { threadId: "kid", turn: { id: "t-kid" } } });
    ${SPAWN}
    send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } });
    setTimeout(() => { ${KID_ENDS} }, 30);
    continue;
  }`));
  const s = new CodexServerSession(toolOpts({ wake: (w) => void wakes.push(w), env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log } }));
  await s.turn("work", recorder().sink, live());
  await until(() => wakes.length === 1, "the parent is woken");
  assert.equal(wakes[0].pending(), true);
  s.close();
  assert.equal(wakes[0].pending(), false);
  await wakes[0].run(recorder().sink, live());
  assert.equal(fake.read().filter((m) => m.method === "initialize").length, 1, "no new app server for it");
  assert.equal(fake.read().filter((m) => m.method === "turn/start").length, 1);
});

/* ----------------------------------------- The Reviewer's word ----------------------------------------- */

test("review: passed, approved and ok read as a pass; blocked and needs changes don't, and a blocking finding never does", () => {
  const verdict = (word: string, findings = "[]") => parseFindings(`<findings>{"verdict":"${word}","summary":"x","findings":${findings}}</findings>`)?.verdict;
  for (const word of ["pass", "passed", "Passed", "approved", "APPROVED", "ok", "OK "]) assert.equal(verdict(word), "pass", word);
  for (const word of ["fail", "blocked", "needs changes", "ok but needs changes", "not ok"]) assert.equal(verdict(word), "fail", word);
  assert.equal(verdict("passed", `[{"file":"a.ts","severity":"blocking","note":"leaks a key"}]`), "fail");
  assert.equal(verdict("ok", `[{"file":"a.ts","severity":"note","note":"a nit"}]`), "pass");
});

/* ---------------------------------------- A plain model call ---------------------------------------- */

test("plain: a stream labelled application/json is read as the stream it is, and real JSON still reads", async () => {
  const chunk = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
  const bodies = [chunk("hel") + chunk("lo") + "data: [DONE]\n\n", JSON.stringify({ choices: [{ message: { content: "hello" } }] })];
  for (const body of bodies) {
    const server = createServer((_, res) => res.writeHead(200, { "content-type": "application/json" }).end(body));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const a = server.address();
    const endpoint: Endpoint = { id: "e", label: "Fake API", url: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`, protocol: "chat", models: ["m"] };
    const seen: string[] = [];
    const r = await askEndpoint(endpoint, "k", "m", { system: "", prompt: "hi", signal: live(), onText: (t) => void seen.push(t) });
    server.close();
    assert.equal(r.text, "hello");
    assert.equal(seen.join(""), "hello");
  }
});

/* ----------------------------------------- From outside Liner ----------------------------------------- */

test("liner_wait: a message that never starts stops counting as work after two minutes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const thread = { id: "t", projectId: "p", title: "Work", agent: "a", status: "done", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 } as Thread;
  const store = { home: tmpdir(), projects: [], threads: [thread], settings: {}, timeline: () => [] } as unknown as Store;
  const outside = new Outside(store, { call: async () => null });
  await outside.call("liner_send", { session: "t", message: "this waits in a queue for good" });
  let ended = false;
  const wait = outside.call("liner_wait", { session: "t", seconds: 240 }).then(() => void (ended = true));
  let seconds = 0;
  for (; seconds < 240 && !ended; seconds++) {
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(1000);
  }
  await new Promise((r) => setImmediate(r));
  assert.ok(ended, "it let go");
  assert.ok(seconds >= 119 && seconds <= 122, `after ${seconds}s`);
  await wait;
});
