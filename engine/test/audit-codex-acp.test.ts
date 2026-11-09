/*
  Audit of the Codex and ACP adapters, the plain model call and the Browser proxy: each test failed
  before its fix. The agents are small Node scripts speaking ACP or Codex's app server, and the
  model endpoints small local servers. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, get, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acpProvider, delegatedTasks, delegateResults, setCancelMs } from "../src/providers/acp.ts";
import { CodexServer, CodexServerSession } from "../src/providers/codex-server.ts";
import { codex } from "../src/providers/codex.ts";
import { askEndpoint } from "../src/providers/plain.ts";
import { fromRegistry } from "../src/providers/added.ts";
import { Proxies } from "../src/proxy.ts";
import { takePlan } from "../src/runtime.ts";
import { ResumeFailed, type ApprovalRequest, type OpenOptions, type ToolUpdate, type TurnSink, type WakeTurn } from "../src/providers/types.ts";
import type { Endpoint, ProviderInfo } from "../../contracts/src/index.ts";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 400 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}
/** Within `ms`, or says it hung. */
const settled = (p: Promise<unknown>, ms = 4000) => Promise.race([p.then(() => "ok", (e: Error) => `rejected: ${e.message}`), tick(ms).then(() => "hung")]);
const gone = (pid: number) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

const opts = (extra: Partial<OpenOptions> = {}) => ({ cwd: mkdtempSync(join(tmpdir(), "lc-audit-cwd-")), model: "default", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: "" }, ...extra }) as OpenOptions;
const live = () => new AbortController().signal;

function recorder() {
  const r = { text: "", errors: [] as string[], notices: [] as { text: string; key?: string }[], tools: [] as ToolUpdate[], cards: [] as ApprovalRequest[], limited: [] as string[] };
  const sink = {
    text: (d: string) => void (r.text += d), reasoning: () => {}, tool: (u: ToolUpdate) => void r.tools.push(u), plan: () => {},
    approve: async (q: ApprovalRequest) => (r.cards.push(q), { allow: true }), ask: async () => null, propose: async () => ({ approve: true }),
    usage: () => {}, session: () => {}, notice: (text: string, key?: string) => void r.notices.push({ text, key }), error: (m: string) => void r.errors.push(m), limited: (m: string) => void r.limited.push(m),
  } as unknown as TurnSink;
  return { r, sink };
}

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

/** An ACP agent: `first` runs on each message before the plain answers, and `continue` ends it there. */
const acpAgent = (first = "", newResult = `{ sessionId: "s-1" }`) => `
${first}
if (m.method === "initialize") send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
else if (m.method === "session/new") send({ id: m.id, result: ${newResult} });
else if (m.method === "session/prompt") send({ id: m.id, result: { stopReason: "end_turn" } });
else if (m.id !== undefined && m.method) send({ id: m.id, result: {} });`;
function acp(on: string, extra: Partial<OpenOptions> = {}, head = "", login = "") {
  const fake = script("agent", on, head);
  const p = acpProvider("acp.fake" as ProviderInfo["id"], { label: "Fake", cmd: [fake.file], login });
  const s = p.open(opts({ ...extra, env: { ...process.env, FAKE_LOG: fake.log, ...extra.env } }));
  return { fake, s };
}

/** A Codex app server, the same way. */
const codexServer = (first = "") => `
${first}
if (m.method === "initialize") send({ id: m.id, result: {} });
else if (m.method === "thread/start") send({ id: m.id, result: { thread: { id: "root" } } });
else if (m.method === "thread/resume") send({ id: m.id, result: { thread: { id: m.params.threadId } } });
else if (m.method === "turn/start") { send({ id: m.id, result: { turn: { id: "turn-1" } } }); setTimeout(() => send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } }), 10); }
else if (m.id !== undefined && m.method) send({ id: m.id, result: {} });`;
function cx(on: string, extra: Partial<OpenOptions> = {}, head = "") {
  const fake = script("codex", on, head);
  const s = new CodexServerSession(opts({ ...extra, env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log, ...extra.env } }));
  return { fake, s };
}

/* ------------------------------------------- ACP ------------------------------------------- */

test("acp: Hermes's delegation words read as tasks, and its results as each task's outcome", () => {
  assert.deepEqual(delegatedTasks("Delegating 2 tasks\n\n1. Find where heights are parsed (researcher)\n2. Run the tests"), [{ goal: "Find where heights are parsed", role: "researcher" }, { goal: "Run the tests" }]);
  assert.deepEqual(delegatedTasks("Delegating task:\nWrite fixtures for spring tides"), [{ goal: "Write fixtures for spring tides" }]);
  assert.deepEqual(delegatedTasks("", "delegate_task: Write fixtures"), [{ goal: "Write fixtures" }]);
  const r = delegateResults("Delegation results: 2 tasks in 42s\n\n✅ Task 1: completed (gpt-5.5, role=researcher, 12s)\nHeights are parsed in noaa.ts.\nThe range goes in forecast.ts.\nTools: read_file, search_files (+3)\n\n✗ Task 2: failed (8s)\nError: npm isn't installed");
  assert.deepEqual(r, [
    { index: 0, status: "completed", model: "gpt-5.5", role: "researcher", seconds: 12, summary: "Heights are parsed in noaa.ts.\nThe range goes in forecast.ts.", tools: ["read_file", "search_files"] },
    { index: 1, status: "failed", seconds: 8, error: "npm isn't installed", tools: [] },
  ]);
  assert.equal(delegateResults("Dispatched 2 tasks to the background"), null);
});

test("acp: a delegate_task call is an agent row per task, from its first words to its results", async () => {
  const { s } = acp(acpAgent(`if (m.method === "session/prompt") {
    const up = (u) => send({ method: "session/update", params: { sessionId: "s-1", update: { toolCallId: "d1", title: "delegate_task: 2 tasks", kind: "execute", ...u } } });
    up({ sessionUpdate: "tool_call", status: "in_progress", content: [{ type: "content", content: { type: "text", text: "Delegating 2 tasks\\n\\n1. Find the parser (researcher)\\n2. Run the tests" } }] });
    setTimeout(() => {
      up({ sessionUpdate: "tool_call_update", status: "completed", content: [{ type: "content", content: { type: "text", text: "Delegation results: 2 tasks in 20s\\n\\n✅ Task 1: completed (gpt-5.5, role=researcher, 12s)\\nHeights are parsed in noaa.ts.\\nTools: read_file\\n\\n⚠ Task 2: interrupted (3s)" } }] });
      send({ id: m.id, result: { stopReason: "end_turn" } });
    }, 40);
    continue;
  }`));
  const { r, sink } = recorder();
  await s.turn("split it up", sink, live());
  s.close();
  assert.ok(!r.tools.some((u) => u.key === "d1"), "the call itself isn't a row: its tasks are");
  const one = r.tools.filter((u) => u.key === "d1#0");
  const two = r.tools.filter((u) => u.key === "d1#1");
  assert.equal(one[0].status, "running");
  assert.equal(one[0].toolKind, "task");
  assert.equal(one[0].agent?.name, "Researcher");
  assert.equal(one[0].agent?.task, "Find the parser");
  assert.equal(one.at(-1)?.status, "done");
  assert.equal(one.at(-1)?.agent?.report, "Heights are parsed in noaa.ts.");
  assert.equal(one.at(-1)?.agent?.model, "acp.fake:gpt-5.5");
  assert.deepEqual(one.at(-1)?.agent?.steps, [{ title: "read_file", toolKind: "other", status: "done" }]);
  assert.equal(two.at(-1)?.agent?.name, "Subagent");
  assert.equal(two.at(-1)?.agent?.state, "stopped");
});

test("acp: a session that failed to open starts again on the next turn, not on the same failure for good", async () => {
  const { fake, s } = acp(acpAgent(`if (m.method === "session/new" && seen("session/new") === 1) { send({ id: m.id, error: { code: -32603, message: "try later" } }); continue; }`));
  await assert.rejects(s.turn("hi", recorder().sink, live()), /try later/);
  await s.turn("again", recorder().sink, live());
  s.close();
  assert.equal(fake.read().filter((m) => m.method === "initialize").length, 2, "a process of its own for the second try");
  assert.equal(fake.read().filter((m) => m.method === "session/prompt").length, 1);
});

test("acp: a model the agent won't switch to is said on the turn", async () => {
  const { s } = acp(acpAgent(`if (m.method === "session/set_model") { send({ id: m.id, error: { code: -1, message: "no such model" } }); continue; }`, `{ sessionId: "s-1", models: { currentModelId: "a", availableModels: [] } }`), { model: "gone-model" });
  const { r, sink } = recorder();
  await s.turn("hi", sink, live());
  s.close();
  assert.ok(r.notices.some((n) => /didn't switch to gone-model/.test(n.text)), JSON.stringify(r.notices));
});

const MODES = `{ sessionId: "s-1", modes: { currentModeId: "build", availableModes: [{ id: "build" }, { id: "plan" }] } }`;

test("acp: a switch into Read only that failed is said and tried again before the next prompt", async () => {
  const { fake, s } = acp(acpAgent(`if (m.method === "session/set_mode" && seen("session/set_mode") <= 2) { send({ id: m.id, error: { code: -1, message: "busy" } }); continue; }`, MODES), { access: "read" });
  const first = recorder();
  await s.turn("one", first.sink, live());
  assert.ok(first.r.notices.some((n) => /read/i.test(n.text)), JSON.stringify(first.r.notices));
  await s.turn("two", recorder().sink, live());
  s.close();
  const sent = fake.read().map((m) => m.method).filter((x) => x === "session/set_mode" || x === "session/prompt");
  assert.deepEqual(sent, ["session/set_mode", "session/set_mode", "session/prompt", "session/set_mode", "session/prompt"]);
});

test("acp: a switch out of Read only that failed goes again before the next prompt", async () => {
  const { fake, s } = acp(acpAgent(`if (m.method === "session/set_mode" && seen("session/set_mode") === 2) { send({ id: m.id, error: { code: -1, message: "busy" } }); continue; }`, MODES), { access: "read" });
  await s.turn("one", recorder().sink, live());
  await s.update!({ model: "default", effort: "medium", access: "edits" });
  await until(() => fake.read().filter((m) => m.method === "session/set_mode").length === 2, "it tries to go back");
  await tick(30);
  await s.turn("two", recorder().sink, live());
  s.close();
  const modes = fake.read().filter((m) => m.method === "session/set_mode").map((m) => m.params.modeId);
  assert.deepEqual(modes, ["plan", "build", "build"]);
});

test("acp: Read only reaches an agent that offers its mode as a config option, groups and all", async () => {
  const session = `{ sessionId: "s-1", configOptions: [{ id: "agent-mode", category: "mode", type: "select", currentValue: "code", options: [{ group: "All", name: "All", options: [{ value: "code", name: "Code" }, { value: "architect", name: "Architect" }] }] }] }`;
  const { fake, s } = acp(acpAgent("", session), { access: "read" });
  await s.turn("one", recorder().sink, live());
  await s.update!({ model: "default", effort: "medium", access: "edits" });
  await tick(30);
  s.close();
  const sent = fake.read().filter((m) => m.method === "session/set_config_option").map((m) => [m.params.configId, m.params.value]);
  assert.deepEqual(sent, [["agent-mode", "architect"], ["agent-mode", "code"]]);
});

test("acp: a mode that only sounds like reading isn't taken for Read only", async () => {
  const skips = acp(acpAgent("", `{ sessionId: "s-1", modes: { currentModeId: "default", availableModes: [{ id: "default" }, { id: "dontAsk" }, { id: "task" }] } }`), { access: "read" });
  await skips.s.turn("one", recorder().sink, live());
  skips.s.close();
  assert.deepEqual(skips.fake.read().filter((m) => m.method === "session/set_mode"), [], "dontAsk skips every question: the opposite of Read only");
  const url = acp(acpAgent("", `{ sessionId: "s-1", modes: { currentModeId: "x#agent", availableModes: [{ id: "x#agent" }, { id: "x#dontAsk" }, { id: "https://agentclientprotocol.com/protocol/session-modes#plan" }] } }`), { access: "read" });
  await url.s.turn("one", recorder().sink, live());
  url.s.close();
  assert.deepEqual(url.fake.read().filter((m) => m.method === "session/set_mode").map((m) => m.params.modeId), ["https://agentclientprotocol.com/protocol/session-modes#plan"]);
});

test("acp: history replayed after session/load isn't shown as the next turn's words", async () => {
  const { s } = acp(acpAgent(`if (m.method === "session/load") {
    send({ id: m.id, result: {} });
    setTimeout(() => send({ method: "session/update", params: { sessionId: "s-old", _meta: { isReplay: true }, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "old words " } } } }), 40);
    continue;
  }
  if (m.method === "session/prompt") {
    setTimeout(() => { send({ method: "session/update", params: { sessionId: "s-old", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "new words" } } } }); send({ id: m.id, result: { stopReason: "end_turn" } }); }, 80);
    continue;
  }`), { resume: "s-old" });
  const { r, sink } = recorder();
  await s.turn("hi", sink, live());
  s.close();
  assert.equal(r.text, "new words");
});

test("acp: a long tool output comes as a bounded tail, a few times a second, and earlier turns' calls aren't kept", async () => {
  const { s } = acp(acpAgent(`if (m.method === "session/prompt" && seen("session/prompt") === 1) {
    const up = (status, text) => send({ method: "session/update", params: { update: { sessionUpdate: "tool_call_update", toolCallId: "c1", status, title: "build", kind: "execute", content: [{ type: "content", content: { type: "text", text } }] } } });
    for (let n = 1; n <= 300; n++) up("in_progress", "x".repeat(1000 * n) + "line " + n);
    up("completed", "y".repeat(100000) + "the end");
    setTimeout(() => send({ id: m.id, result: { stopReason: "end_turn" } }), 30);
    continue;
  }`));
  const { r, sink } = recorder();
  await s.turn("hi", sink, live());
  assert.ok(r.tools.length <= 5, `${r.tools.length} updates reached the app`);
  assert.ok(r.tools.every((u) => (u.output?.length ?? 0) <= 20100), "each is a tail");
  const last = r.tools.at(-1)!;
  assert.equal(last.status, "done");
  assert.ok(last.output?.endsWith("the end"));
  await s.turn("again", recorder().sink, live());
  s.close();
  assert.equal((s as unknown as { calls: Map<string, unknown> }).calls.size, 0);
});

test("acp: a running tool's last output still arrives when nothing follows it", async () => {
  const { s } = acp(acpAgent(`if (m.method === "session/prompt") {
    const up = (text) => send({ method: "session/update", params: { update: { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "in_progress", title: "build", kind: "execute", content: [{ type: "content", content: { type: "text", text } }] } } });
    up("one"); up("one two");
    setTimeout(() => send({ id: m.id, result: { stopReason: "end_turn" } }), 400);
    continue;
  }`));
  const { r, sink } = recorder();
  await s.turn("hi", sink, live());
  s.close();
  assert.equal(r.tools.at(-1)?.output, "one two");
});

test("acp: keys and home folders in an agent's stderr don't reach the timeline", async () => {
  const { s } = acp(`if (m.method === "initialize") { process.stderr.write("failed for " + process.env.HOME + "/x with Authorization: Bearer abc.def-123 and sk-abcdefghijklmnop and " + process.env.MY_API_TOKEN + "\\n"); process.exit(1); }`, { env: { HOME: "/Users/someone", MY_API_TOKEN: "plainsecretvalue" } as NodeJS.ProcessEnv });
  const said = await s.turn("hi", recorder().sink, live()).then(() => "", (e: Error) => e.message);
  s.close();
  assert.match(said, /failed for/);
  for (const secret of ["/Users/someone", "abc.def-123", "sk-abcdefghijklmnop", "plainsecretvalue"]) assert.ok(!said.includes(secret), `${secret} in: ${said}`);
});

/** One request of the agent's, answered in the turn; its reply comes back. */
async function acpAsk(ask: object, extra: Partial<OpenOptions> = {}) {
  const { fake, s } = acp(acpAgent(`if (m.method === "session/prompt") { global.p = m.id; send({ jsonrpc: "2.0", id: 900, ...${JSON.stringify(ask)} }); continue; }
  if (m.id === 900) { send({ id: global.p, result: { stopReason: "end_turn" } }); continue; }`), extra);
  await s.turn("hi", recorder().sink, live());
  s.close();
  return fake.read().find((m) => m.id === 900 && !m.method) as { result?: { outcome?: { outcome: string; optionId?: string } }; error?: { code: number } };
}

test("acp: a request it would allow with no option to allow it is cancelled, not a malformed yes", async () => {
  const reply = await acpAsk({ method: "session/request_permission", params: { toolCall: { toolCallId: "c1", kind: "execute", rawInput: { command: "ls" } }, options: [{ optionId: "no", kind: "reject_once" }] } }, { access: "full" });
  assert.deepEqual(reply.result?.outcome, { outcome: "cancelled" });
});

test("acp: a request Liner Code doesn't know is 'method not found'", async () => {
  const reply = await acpAsk({ method: "terminal/create", params: {} });
  assert.equal(reply.error?.code, -32601);
});

test("acp: auth_required says how to sign in", async () => {
  const { s } = acp(acpAgent(`if (m.method === "session/new") { send({ id: m.id, error: { code: -32000, message: "Authentication required" } }); continue; }`), {}, "", "fake login");
  await assert.rejects(s.turn("hi", recorder().sink, live()), /Authentication required.*fake login/);
  s.close();
});

test("acp: an image or a file in the agent's message leaves a mark instead of nothing", async () => {
  const { s } = acp(acpAgent(`if (m.method === "session/prompt") {
    const say = (content) => send({ method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content } } });
    say({ type: "text", text: "Here: " });
    say({ type: "image", mimeType: "image/png", data: "AAAA" });
    say({ type: "resource_link", name: "report.txt", uri: "file:///w/report.txt" });
    say({ type: "resource", resource: { text: "inline" } });
    send({ id: m.id, result: { stopReason: "end_turn" } });
    continue;
  }`));
  const { r, sink } = recorder();
  await s.turn("hi", sink, live());
  s.close();
  assert.match(r.text, /Here: .*image\/png/);
  assert.match(r.text, /report\.txt/);
  assert.match(r.text, /inline/);
});

test("acp: a stopped process's late words don't reach the next turn, and answers don't go to the new process", async () => {
  setCancelMs(60);
  try {
    const { fake, s } = acp(acpAgent(`if (m.method === "session/prompt" && seen("session/prompt") === 1) {
      process.on("SIGTERM", () => setInterval(() => { send({ method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "old " } } } }); send({ id: 777, method: "fs/read_text_file", params: { path: "nope" } }); }, 10));
      continue;
    }
    if (m.method === "session/prompt") { setTimeout(() => send({ id: m.id, result: { stopReason: "end_turn" } }), 200); continue; }`));
    const stop = new AbortController();
    const first = s.turn("one", recorder().sink, stop.signal);
    await until(() => fake.read().some((m) => m.method === "session/prompt"), "it starts");
    stop.abort();
    await first;
    const { r, sink } = recorder();
    await s.turn("two", sink, live());
    s.close();
    assert.equal(r.text, "");
    assert.deepEqual(fake.read().filter((m) => m.id === 777), []);
  } finally {
    setCancelMs(15_000);
  }
});

test("acp: an agent that dies leaving a child on its pipes fails the turn, and the child goes too", async () => {
  const { s, fake } = acp(acpAgent(`if (m.method === "session/prompt") {
    const kid = require("child_process").spawn("sleep", ["30"], { stdio: "inherit" });
    fs.writeFileSync(process.env.FAKE_LOG + ".pid", String(kid.pid));
    process.exit(7);
  }`));
  const end = await settled(s.turn("hi", recorder().sink, live()));
  s.close();
  assert.match(end, /^rejected/);
  const pid = Number(readFileSync(`${fake.log}.pid`, "utf8"));
  await until(() => gone(pid), "the child is gone");
});

test("acp: a project folder that's gone fails the turn and says so", async () => {
  const { s } = acp(acpAgent(), { cwd: join(tmpdir(), "lc-audit-no-such-folder") });
  assert.match(await settled(s.turn("hi", recorder().sink, live())), /^rejected: .*lc-audit-no-such-folder/);
  s.close();
});

test("acp: an agent that stops reading fails the turn", async () => {
  const { s } = acp(acpAgent(`if (m.method === "session/new") { process.stdin.destroy(); fs.closeSync(0); setTimeout(() => send({ id: m.id, result: { sessionId: "s-1" } }), 100); setTimeout(() => {}, 30000); continue; }`));
  const end = await settled(s.turn("hi", recorder().sink, live()));
  s.close();
  assert.match(end, /^rejected/);
});

/* ------------------------------------------ Codex ------------------------------------------ */

test("codex: an initialize answered with an error is tried again next turn, in a process of its own", async () => {
  const { fake, s } = cx(codexServer(`if (m.method === "initialize" && seen("initialize") === 1) { send({ id: m.id, error: { code: -1, message: "not yet" } }); continue; }`));
  await assert.rejects(s.turn("hi", recorder().sink, live()), /not yet/);
  await s.turn("again", recorder().sink, live());
  s.close();
  assert.equal(fake.read().filter((m) => m.method === "initialize").length, 2);
  assert.equal(fake.read().filter((m) => m.method === "turn/start").length, 1);
});

test("codex: a retry's notice is one line, and says so when Codex carries on", async () => {
  const { s } = cx(codexServer(`if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    const retry = (n) => send({ method: "error", params: { threadId: "root", turnId: "turn-1", willRetry: true, error: { message: "Reconnecting... " + n + "/5" } } });
    retry(1); retry(2);
    setTimeout(() => { send({ method: "item/agentMessage/delta", params: { threadId: "root", turnId: "turn-1", itemId: "a", delta: "back" } }); send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } }); }, 10);
    continue;
  }`));
  const { r, sink } = recorder();
  await s.turn("hi", sink, live());
  s.close();
  assert.equal(new Set(r.notices.map((n) => n.key)).size, 1, "one key, so one line");
  assert.ok(r.notices[0].key);
  assert.ok(!/trying again/.test(r.notices.at(-1)!.text), r.notices.at(-1)!.text);
});

test("codex: an image Codex makes gets a row", async () => {
  const { s } = cx(codexServer(`if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    const item = (method, status) => send({ method, params: { threadId: "root", turnId: "turn-1", item: { type: "imageGeneration", id: "img", status, revisedPrompt: "a tide chart", result: "", savedPath: "/w/tide.png" } } });
    item("item/started", "inProgress"); item("item/completed", "completed");
    send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } });
    continue;
  }`));
  const { r, sink } = recorder();
  await s.turn("hi", sink, live());
  s.close();
  assert.deepEqual(r.tools.map((t) => t.status), ["running", "done"]);
  assert.match(r.tools[1].output ?? "", /tide\.png/);
});

test("codex: an earlier turn's end landing while the next turn starts doesn't end it", async () => {
  const { s } = cx(codexServer(`if (m.method === "thread/compact/start") {
    send({ id: m.id, result: {} });
    send({ method: "thread/compacted", params: { threadId: "root", turnId: "compact-1" } });
    continue;
  }
  if (m.method === "turn/start") {
    // The compaction's own turn ends only now, before the new turn's start is answered.
    send({ method: "thread/compacted", params: { threadId: "root", turnId: "compact-1" } });
    send({ method: "turn/completed", params: { threadId: "root", turn: { id: "compact-1", status: "completed" } } });
    setTimeout(() => send({ id: m.id, result: { turn: { id: "turn-2" } } }), 10);
    setTimeout(() => send({ method: "item/agentMessage/delta", params: { threadId: "root", turnId: "turn-2", itemId: "a", delta: "the answer" } }), 30);
    setTimeout(() => send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-2", status: "completed" } } }), 40);
    continue;
  }`));
  await s.turn("/compact", recorder().sink, live());
  const { r, sink } = recorder();
  await s.turn("next", sink, live());
  s.close();
  assert.equal(r.text, "the answer");
});

test("codex: a turn that ends before its start is answered still ends", async () => {
  const { s } = cx(codexServer(`if (m.method === "turn/start") {
    send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "failed", error: { message: "it broke" } } } });
    setTimeout(() => send({ id: m.id, result: { turn: { id: "turn-1" } } }), 10);
    continue;
  }`));
  const { r, sink } = recorder();
  assert.equal(await settled(s.turn("hi", sink, live()), 1500), "ok");
  s.close();
  assert.deepEqual(r.errors, ["it broke"]);
});

test("codex: a turn that failed with no words for it still says so", async () => {
  const { s } = cx(codexServer(`if (m.method === "turn/start") { send({ id: m.id, result: { turn: { id: "turn-1" } } }); send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "failed", error: null } } }); continue; }`));
  const { r, sink } = recorder();
  await s.turn("hi", sink, live());
  s.close();
  assert.equal(r.errors.length, 1);
});

test("codex: Stop reaches a compaction running as a turn", async () => {
  const { fake, s } = cx(codexServer(`if (m.method === "thread/compact/start") {
    send({ id: m.id, result: {} });
    send({ method: "turn/started", params: { threadId: "root", turn: { id: "compact-1" } } });
    continue;
  }`));
  const stop = new AbortController();
  const turn = s.turn("/compact", recorder().sink, stop.signal);
  await until(() => fake.read().some((m) => m.method === "thread/compact/start"), "it compacts");
  await tick(30);
  stop.abort();
  await turn;
  await until(() => fake.read().some((m) => m.method === "turn/interrupt"), "the compaction is interrupted");
  s.close();
  assert.equal(fake.read().find((m) => m.method === "turn/interrupt")?.params.turnId, "compact-1");
});

test("codex: a /compact that fails with no turn of its own ends with the error", async () => {
  const { s } = cx(codexServer(`if (m.method === "thread/compact/start") {
    send({ id: m.id, result: {} });
    send({ method: "error", params: { threadId: "root", willRetry: false, error: { message: "context too big" } } });
    continue;
  }`));
  const { r, sink } = recorder();
  assert.equal(await settled(s.turn("/compact", sink, live()), 1500), "ok");
  s.close();
  assert.deepEqual(r.errors, ["context too big"]);
});

const KIDS = `if (m.method === "turn/start") {
  send({ id: m.id, result: { turn: { id: "turn-1" } } });
  send({ method: "turn/started", params: { threadId: "kid-1", turn: { id: "kid-turn-1" } } });
  send({ method: "item/started", params: { threadId: "root", turnId: "turn-1", item: { type: "commandExecution", id: "cmd-1", command: "npm run dev", processId: "41", status: "inProgress" } } });
  send({ method: "item/started", params: { threadId: "kid-1", turnId: "kid-turn-1", item: { type: "commandExecution", id: "cmd-2", command: "sleep 100", processId: "42", status: "inProgress" } } });
  continue;
}
if (m.method === "turn/interrupt" && m.params.turnId === "turn-1") {
  send({ id: m.id, result: {} });
  // Both start as the parent winds down, after Stop's first look.
  setTimeout(() => {
    send({ method: "turn/started", params: { threadId: "kid-2", turn: { id: "kid-turn-2" } } });
    send({ method: "item/started", params: { threadId: "root", turnId: "turn-1", item: { type: "commandExecution", id: "cmd-3", command: "make", processId: "43", status: "inProgress" } } });
  }, 10);
  continue;
}`;

test("codex: Stop reaches the subagents' turns and the commands running, also those that start after it", async () => {
  const { fake, s } = cx(codexServer(KIDS));
  const stop = new AbortController();
  const turn = s.turn("work", recorder().sink, stop.signal);
  await until(() => fake.read().some((m) => m.method === "turn/start"), "the turn starts");
  await tick(30);
  stop.abort();
  await turn;
  await until(() => fake.read().filter((m) => m.method === "turn/interrupt").length === 3, "each turn is interrupted");
  await until(() => fake.read().filter((m) => m.method === "thread/backgroundTerminals/terminate").length === 3, "each command is stopped");
  s.close();
  const sent = fake.read();
  assert.deepEqual(sent.filter((m) => m.method === "turn/interrupt").map((m) => [m.params.threadId, m.params.turnId]).sort(), [["kid-1", "kid-turn-1"], ["kid-2", "kid-turn-2"], ["root", "turn-1"]]);
  assert.deepEqual(sent.filter((m) => m.method === "thread/backgroundTerminals/terminate").map((m) => [m.params.threadId, m.params.processId]).sort(), [["kid-1", "42"], ["root", "41"], ["root", "43"]]);
});

/** Turn one leaves a command running, as a dev server does; turn two starts commands that went through a card, its own and a subagent's. */
const CARDED = `
const cmd = (threadId, turnId, id) => send({ method: "item/started", params: { threadId, turnId, item: { type: "commandExecution", id, command: "sleep", processId: null, status: "inProgress" } } });
if (m.method === "turn/start" && seen("turn/start") === 1) {
  send({ id: m.id, result: { turn: { id: "turn-0" } } });
  cmd("root", "turn-0", "server");
  send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-0", status: "completed" } } });
  continue;
}
if (m.method === "turn/start") {
  send({ id: m.id, result: { turn: { id: "turn-1" } } });
  send({ method: "turn/started", params: { threadId: "kid-1", turn: { id: "kid-turn-1" } } });
  cmd("root", "turn-1", "mine");
  cmd("kid-1", "kid-turn-1", "kids");
  continue;
}
if (m.method === "turn/interrupt") { send({ id: m.id, result: {} }); if (m.params.turnId === "turn-1") send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "interrupted" } } }); continue; }
if (m.method === "thread/backgroundTerminals/list") {
  const pages = { root: [{ data: [{ itemId: "server", processId: "7" }], nextCursor: "2" }, { data: [{ itemId: "mine", processId: "8" }], nextCursor: null }], "kid-1": [{ data: [{ itemId: "kids", processId: "9" }], nextCursor: null }] };
  send({ id: m.id, result: pages[m.params.threadId][m.params.cursor ? 1 : 0] });
  continue;
}`;

test("codex: Stop finds a command that went through a card on Codex's list, and leaves what an earlier turn left running", async () => {
  const { fake, s } = cx(codexServer(CARDED));
  await s.turn("start the server", recorder().sink, live());
  const stop = new AbortController();
  const turn = s.turn("work", recorder().sink, stop.signal);
  await until(() => fake.read().filter((m) => m.method === "turn/start").length === 2, "the turn starts");
  await tick(30);
  stop.abort();
  await turn;
  await until(() => fake.read().filter((m) => m.method === "thread/backgroundTerminals/terminate").length === 2, "each command is stopped");
  await tick(30);
  s.close();
  assert.deepEqual(fake.read().filter((m) => m.method === "thread/backgroundTerminals/terminate").map((m) => [m.params.threadId, m.params.processId]).sort(), [["kid-1", "9"], ["root", "8"]]);
});

test("codex: a command approved a moment before Stop is looked for again, and one never listed ends the search", async () => {
  const { fake, s } = cx(codexServer(`
if (m.method === "turn/start") {
  send({ id: m.id, result: { turn: { id: "turn-1" } } });
  for (const id of ["late", "never"]) send({ method: "item/started", params: { threadId: "root", turnId: "turn-1", item: { type: "commandExecution", id, command: "sleep", processId: null, status: "inProgress" } } });
  continue;
}
if (m.method === "thread/backgroundTerminals/list") { send({ id: m.id, result: { data: seen("backgroundTerminals/list") > 2 ? [{ itemId: "late", processId: "5" }] : [], nextCursor: null } }); continue; }`));
  const stop = new AbortController();
  const turn = s.turn("work", recorder().sink, stop.signal);
  await until(() => fake.read().some((m) => m.method === "turn/start"), "the turn starts");
  await tick(30);
  stop.abort();
  await turn;
  await until(() => fake.read().filter((m) => m.method === "thread/backgroundTerminals/terminate").length === 1, "the late one is stopped");
  assert.deepEqual(fake.read().filter((m) => m.method === "thread/backgroundTerminals/terminate").map((m) => m.params.processId), ["5"]);
  await tick(1400);
  s.close();
  assert.equal(fake.read().filter((m) => m.method === "thread/backgroundTerminals/list").length, 5, "twice for the one found, three times for the one never listed");
});

const SPAWN = (receiver: string) => `send({ method: "item/completed", params: { threadId: "root", turnId: "turn-1", item: { type: "collabAgentToolCall", id: "spawn-${receiver}", tool: "spawnAgent", senderThreadId: "root", receiverThreadIds: ["${receiver}"], prompt: "check the ${receiver} tests", status: "completed", agentsStates: {} } } });`;
const KID_ENDS = (kid: string, status = "completed") => `
  send({ method: "item/completed", params: { threadId: "${kid}", turnId: "t-${kid}", item: { type: "agentMessage", id: "w-${kid}", text: "${kid} found 2 failures" } } });
  send({ method: "turn/completed", params: { threadId: "${kid}", turn: { id: "t-${kid}", status: "${status}" } } });`;

test("codex: an agent it sends off gets a row: who it is, what it was asked, its own steps, tokens and report; it can be steered and stopped alone", async () => {
  const { fake, s } = cx(codexServer(`if (m.method === "turn/start" && seen("turn/start") === 1) {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    send({ method: "thread/started", params: { thread: { id: "kid", parentThreadId: "root", agentRole: "explorer", agentNickname: "Ada" } } });
    send({ method: "turn/started", params: { threadId: "kid", turn: { id: "t-kid" } } });
    ${SPAWN("kid")}
    send({ method: "item/started", params: { threadId: "kid", turnId: "t-kid", item: { type: "commandExecution", id: "c1", command: '/bin/zsh -lc "npm test"', status: "inProgress" } } });
    send({ method: "thread/tokenUsage/updated", params: { threadId: "kid", tokenUsage: { total: { totalTokens: 1800, inputTokens: 1500, outputTokens: 300 }, last: {} } } });
    setTimeout(() => {
      send({ method: "item/completed", params: { threadId: "kid", turnId: "t-kid", item: { type: "commandExecution", id: "c1", command: "npm test", status: "completed", exitCode: 0 } } });
      ${KID_ENDS("kid")}
      send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } });
    }, 300);
    continue;
  }`));
  const { r, sink } = recorder();
  const turn = s.turn("work", sink, live());
  await until(() => r.tools.some((u) => (u.agent?.tokens ?? 0) > 0), "its tokens");
  const live1 = r.tools.filter((u) => u.key === "spawn-kid").at(-1)!;
  assert.equal(live1.toolKind, "task");
  assert.equal(live1.status, "running");
  assert.equal(live1.agent?.name, "Explorer");
  assert.equal(live1.agent?.task, "check the kid tests");
  assert.equal(live1.agent?.taskId, "kid");
  assert.equal(live1.agent?.steerable, true);
  assert.deepEqual(live1.agent?.steps, [{ title: "Run npm test", toolKind: "exec", status: "running" }]);
  assert.equal(live1.agent?.tokens, 1800);
  // A word for it, and Stop, reach its own thread's turn.
  assert.equal(await s.steerAgent!("kid", "only src"), true);
  assert.equal(await s.stopAgent!("kid"), true);
  assert.equal(await s.stopAgent!("nobody"), false);
  await turn;
  s.close();
  const steer = fake.read().find((m) => m.method === "turn/steer");
  assert.equal(steer?.params.threadId, "kid");
  assert.equal(steer?.params.expectedTurnId, "t-kid");
  assert.equal(steer?.params.input[0].text, "only src");
  // Stop shuts its thread down, which Codex's wait_agent takes as its end; nothing of the parent's is interrupted.
  assert.ok(fake.read().some((m) => m.method === "thread/archive" && m.params.threadId === "kid"), "its thread alone was shut down");
  assert.ok(!fake.read().some((m) => m.method === "turn/interrupt" || (m.method === "thread/archive" && m.params.threadId !== "kid")));
  const end = r.tools.filter((u) => u.key === "spawn-kid").at(-1)!;
  assert.equal(end.status, "done");
  assert.equal(end.agent?.report, "kid found 2 failures");
  assert.equal(end.agent?.steps?.[0].status, "done");
  // Its steps are its row's, not the turn's.
  assert.ok(!r.tools.some((u) => u.key === "c1"));
});

test("codex: an agent still at work when the turn ends goes on in the background on its row, and ends there", async () => {
  const { s } = cx(codexServer(`if (m.method === "turn/start" && seen("turn/start") === 1) {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    send({ method: "turn/started", params: { threadId: "kid", turn: { id: "t-kid" } } });
    ${SPAWN("kid")}
    send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } });
    setTimeout(() => {
      send({ method: "item/started", params: { threadId: "kid", turnId: "t-kid", item: { type: "commandExecution", id: "c1", command: "npm test", status: "inProgress" } } });
      send({ method: "item/completed", params: { threadId: "kid", turnId: "t-kid", item: { type: "commandExecution", id: "c1", command: "npm test", status: "completed", exitCode: 0 } } });
      ${KID_ENDS("kid")}
    }, 50);
    continue;
  }`));
  const { r, sink } = recorder();
  await s.turn("work", sink, live());
  const parked = r.tools.filter((u) => u.key === "spawn-kid").at(-1)!;
  assert.equal(parked.status, "done", "the turn didn't wait for it");
  assert.equal(parked.agent?.background, true);
  assert.equal(parked.agent?.state, "running", "still at work: it can be stopped, and counts as working");
  assert.equal(await s.stopAgent!("nobody"), false);
  // Its later work and its end come to the same row, through the turn that sent it.
  await until(() => r.tools.filter((u) => u.key === "spawn-kid").at(-1)?.agent?.state === "done", "it ends on its row");
  s.close();
  const end = r.tools.filter((u) => u.key === "spawn-kid").at(-1)!;
  assert.equal(end.agent?.report, "kid found 2 failures");
  assert.deepEqual(end.agent?.steps, [{ title: "Run npm test", toolKind: "exec", status: "done" }]);
  assert.equal(new Set(r.tools.map((u) => u.key)).size, 1, "one agent, one row");
});

test("codex: an agent the model redirects (its turn interrupted by send_input) goes on to its report, not ended as stopped", async () => {
  const { s } = cx(codexServer(`if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    send({ method: "turn/started", params: { threadId: "kid", turn: { id: "t-kid-1" } } });
    ${SPAWN("kid")}
    send({ method: "turn/completed", params: { threadId: "kid", turn: { id: "t-kid-1", status: "interrupted" } } });
    send({ method: "turn/started", params: { threadId: "kid", turn: { id: "t-kid" } } });
    ${KID_ENDS("kid")}
    setTimeout(() => send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } }), 20);
    continue;
  }`));
  const { r, sink } = recorder();
  await s.turn("work", sink, live());
  s.close();
  const rows = r.tools.filter((u) => u.key === "spawn-kid");
  assert.ok(!rows.some((u) => u.agent?.state === "stopped"));
  assert.equal(rows.at(-1)?.status, "done");
  assert.equal(rows.at(-1)?.agent?.report, "kid found 2 failures");
});

test("codex: an agent the model redirected that finishes after the parent's turn still wakes it, once, and ends on its row", async () => {
  const wakes: WakeTurn[] = [];
  const { s } = cx(codexServer(`if (m.method === "turn/start" && seen("turn/start") === 1) {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    send({ method: "turn/started", params: { threadId: "kid", turn: { id: "t-kid-1" } } });
    ${SPAWN("kid")}
    send({ method: "turn/completed", params: { threadId: "kid", turn: { id: "t-kid-1", status: "interrupted" } } });
    send({ method: "turn/started", params: { threadId: "kid", turn: { id: "t-kid" } } });
    send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } });
    setTimeout(() => { ${KID_ENDS("kid")} }, 40);
    continue;
  }`), { wake: (w) => void wakes.push(w) });
  const { r, sink } = recorder();
  await s.turn("work", sink, live());
  await until(() => wakes.length === 1, "the parent is woken");
  await tick(40);
  s.close();
  assert.equal(wakes.length, 1);
  const end = r.tools.filter((u) => u.key === "spawn-kid").at(-1)!;
  assert.equal(end.agent?.state, "done");
  assert.equal(end.agent?.report, "kid found 2 failures");
});

test("codex: an agent's row is named from its thread, which Codex 0.167.0 only says when asked", async () => {
  const { fake, s } = cx(codexServer(`if (m.method === "thread/read") { send({ id: m.id, result: { thread: { id: m.params.threadId, agentNickname: "Planck", agentRole: null } } }); continue; }
  if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    ${SPAWN("kid")}
    setTimeout(() => { ${KID_ENDS("kid")} send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } }); }, 100);
    continue;
  }`));
  const { r, sink } = recorder();
  await s.turn("work", sink, live());
  s.close();
  const rows = r.tools.filter((u) => u.key === "spawn-kid");
  assert.equal(rows[0].agent?.name, "Subagent", "nothing named it yet");
  assert.equal(rows.at(-1)?.agent?.name, "Planck");
  assert.equal(rows.at(-1)?.title, "Planck: check the kid tests");
  assert.equal(fake.read().find((m) => m.method === "thread/read")?.params.threadId, "kid");
});

test("codex: a subagent that finishes after the parent's turn wakes it with what it found", async () => {
  const wakes: WakeTurn[] = [];
  const { fake, s } = cx(codexServer(`if (m.method === "turn/start" && seen("turn/start") === 1) {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    send({ method: "turn/started", params: { threadId: "kid", turn: { id: "t-kid" } } });
    ${SPAWN("kid")}
    send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } });
    setTimeout(() => { ${KID_ENDS("kid")} }, 30);
    continue;
  }`), { wake: (w) => void wakes.push(w) });
  await s.turn("work", recorder().sink, live());
  await until(() => wakes.length === 1, "the parent is woken");
  assert.equal(wakes[0].pending(), true);
  const { sink } = recorder();
  await wakes[0].run(sink, live());
  s.close();
  assert.equal(wakes[0].pending(), false);
  const said = fake.read().filter((m) => m.method === "turn/start")[1]?.params.input[0].text as string;
  assert.match(said, /kid found 2 failures/);
  assert.match(said, /check the kid tests/);
});

test("codex: a subagent finishing during a turn, after Stop, or stopped itself wakes nothing", async () => {
  const wakes: WakeTurn[] = [];
  const during = cx(codexServer(`if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    send({ method: "turn/started", params: { threadId: "kid", turn: { id: "t-kid" } } });
    ${SPAWN("kid")}
    ${KID_ENDS("kid")}
    setTimeout(() => send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } }), 20);
    continue;
  }`), { wake: (w) => void wakes.push(w) });
  await during.s.turn("work", recorder().sink, live());
  await tick(30);
  during.s.close();
  assert.equal(wakes.length, 0, "a running parent hears it from Codex");

  const stopped = cx(codexServer(`if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    send({ method: "turn/started", params: { threadId: "kid", turn: { id: "t-kid" } } });
    ${SPAWN("kid")}
    continue;
  }
  if (m.method === "turn/interrupt") { send({ id: m.id, result: {} }); setTimeout(() => { ${KID_ENDS("kid")} }, 10); continue; }`), { wake: (w) => void wakes.push(w) });
  const stop = new AbortController();
  const turn = stopped.s.turn("work", recorder().sink, stop.signal);
  await until(() => stopped.fake.read().some((m) => m.method === "turn/start"), "the turn starts");
  await tick(30);
  stop.abort();
  await turn;
  await tick(50);
  stopped.s.close();
  assert.equal(wakes.length, 0, "what you stopped doesn't speak up");
});

test("codex: only a direct child wakes the parent, and two that finish together are one turn", async () => {
  const wakes: WakeTurn[] = [];
  const { fake, s } = cx(codexServer(`if (m.method === "turn/start" && seen("turn/start") === 1) {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    ${SPAWN("a")}
    ${SPAWN("b")}
    send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } });
    setTimeout(() => { ${KID_ENDS("grandchild")} ${KID_ENDS("a")} ${KID_ENDS("b")} }, 30);
    continue;
  }`), { wake: (w) => void wakes.push(w) });
  await s.turn("work", recorder().sink, live());
  await until(() => wakes.length >= 1, "the parent is woken");
  await tick(30);
  assert.equal(wakes.length, 1);
  await wakes[0].run(recorder().sink, live());
  s.close();
  const said = fake.read().filter((m) => m.method === "turn/start")[1]?.params.input[0].text as string;
  assert.match(said, /a found 2/);
  assert.match(said, /b found 2/);
  assert.ok(!said.includes("grandchild"));
});

test("codex: a thread another Codex client is writing to is said as in use, not swapped for a new one", async () => {
  const { fake, s } = cx(codexServer(`if (m.method === "thread/resume") { send({ id: m.id, error: { code: -32600, message: "thread t-1 already has an active writer" } }); continue; }`), { resume: "t-1" });
  await assert.rejects(s.turn("hi", recorder().sink, live()), (e: Error) => !(e instanceof ResumeFailed) && /another Codex client/.test(e.message));
  s.close();
  assert.ok(!fake.read().some((m) => m.method === "thread/start"));
});

test("codex: a thread that resumes after a failed try isn't still called lost", async () => {
  const { s } = cx(codexServer(`if (m.method === "thread/resume" && seen("thread/resume") === 1) process.exit(1);`), { resume: "root" });
  await assert.rejects(s.turn("hi", recorder().sink, live()));
  await s.turn("again", recorder().sink, live());
  s.close();
});

/** Codex asks once in its turn; the card comes back. */
async function codexCard(ask: object, extra: Partial<OpenOptions> = {}, before = "") {
  const { s } = cx(codexServer(`if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    global.turn = m.id;
    ${before}
    send({ id: 900, ...${JSON.stringify(ask)} });
    continue;
  }
  if (m.id === 900) { send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } }); continue; }`), extra);
  const { r, sink } = recorder();
  await s.turn("hi", sink, live());
  s.close();
  return r.cards[0];
}
const startedPatch = (path: string, threadId = "root") => `send({ method: "item/started", params: { threadId: "${threadId}", turnId: "turn-1", item: { type: "fileChange", id: "p1", status: "inProgress", changes: [{ path: "${path}", kind: "update" }] } } });`;

test("codex: an edit outside the project, or one granting a folder outside it, is high and leaves no rule", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "lc-audit-cwd-"));
  const inside = await codexCard({ method: "item/fileChange/requestApproval", params: { itemId: "p1" } }, { cwd }, startedPatch(`${cwd}/a.ts`));
  assert.equal(inside.risk, "medium");
  assert.equal(inside.rule, "Edit");
  const outside = await codexCard({ method: "item/fileChange/requestApproval", params: { itemId: "p1" } }, { cwd }, startedPatch("/etc/hosts"));
  assert.equal(outside.risk, "high");
  assert.equal(outside.rule, undefined);
  assert.match(outside.description ?? "", /outside/);
  const grant = await codexCard({ method: "item/fileChange/requestApproval", params: { itemId: "p1", grantRoot: "/" } }, { cwd }, startedPatch(`${cwd}/a.ts`));
  assert.equal(grant.risk, "high");
  assert.equal(grant.rule, undefined);
  const legacy = await codexCard({ method: "applyPatchApproval", params: { fileChanges: { "/etc/hosts": {} } } }, { cwd });
  assert.equal(legacy.risk, "high");
});

test("codex: a planner's question can go unanswered, so a routine's turn never waits for good on one", async () => {
  const ask = { method: "item/tool/requestUserInput", params: { questions: [{ id: "q", header: "Pick", question: "Which?", options: [{ label: "A", description: "a" }] }] } };
  const { s } = cx(codexServer(`if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    send({ id: 900, ...${JSON.stringify(ask)} });
    continue;
  }
  if (m.id === 900) { send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } }); continue; }`));
  const { sink } = recorder();
  let said: { optional?: boolean } | undefined;
  sink.ask = async (_q, _s, o) => ((said = o), null);
  await s.turn("hi", sink, live());
  s.close();
  assert.deepEqual(said, { optional: true });
});

test("codex: an edit it doesn't name yet is yours to read, with no rule", async () => {
  const card = await codexCard({ method: "item/fileChange/requestApproval", params: { itemId: "early" } });
  assert.equal(card.risk, "high");
  assert.equal(card.rule, undefined);
  assert.match(card.description ?? "", /didn't say which files/);
});

test("codex: a subagent's edit shows its files", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "lc-audit-cwd-"));
  const card = await codexCard({ method: "item/fileChange/requestApproval", params: { threadId: "kid", itemId: "p1" } }, { cwd }, startedPatch(`${cwd}/kid.ts`, "kid"));
  assert.deepEqual(card.fields, [{ label: "File", value: "kid.ts" }]);
  assert.equal(card.risk, "medium");
});

test("codex: a request for the network names its host, and goes to you", async () => {
  const card = await codexCard({ method: "item/commandExecution/requestApproval", params: { itemId: "c1", command: null, networkApprovalContext: { host: "evil.example", protocol: "https" } } });
  assert.match(card.title, /evil\.example/);
  assert.ok(!card.fields.some((f) => f.label === "Command"), "there's no command to show");
  assert.ok(card.fields.some((f) => f.value.includes("evil.example")));
  assert.equal(card.risk, "high");
  assert.equal(card.rule, undefined);
});

test("codex: a command that asks for more access shows it, and Auto can't pass it as a read", async () => {
  const card = await codexCard({ method: "item/commandExecution/requestApproval", params: { itemId: "c1", command: "ls", additionalPermissions: { fileSystem: { write: ["/etc"] } } } });
  assert.ok(card.fields.some((f) => f.value.includes("/etc")), JSON.stringify(card.fields));
  assert.equal(card.risk, "high");
  assert.equal(card.rule, undefined);
});

test("codex: more access outside the project is high, so Auto and the Reviewer leave it to you", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "lc-audit-cwd-"));
  const out = await codexCard({ method: "item/permissions/requestApproval", params: { itemId: "c1", permissions: { fileSystem: { write: ["/etc"] } } } }, { cwd });
  assert.equal(out.risk, "high");
  const glob = await codexCard({ method: "item/permissions/requestApproval", params: { itemId: "c1", permissions: { fileSystem: { entries: [{ access: "write", path: { pattern: "/**" } }] } } } }, { cwd });
  assert.equal(glob.risk, "high");
  const inside = await codexCard({ method: "item/permissions/requestApproval", params: { itemId: "c1", permissions: { fileSystem: { write: [`${cwd}/out`] } } } }, { cwd });
  assert.equal(inside.risk, "medium");
});

test("codex: a path sent in the old lists and in entries shows once, and a path it denies doesn't read as access", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "lc-audit-cwd-"));
  const path = (x: string) => ({ path: { type: "path", path: `${cwd}/${x}` } });
  const card = await codexCard({ method: "item/permissions/requestApproval", params: { itemId: "c1", permissions: { fileSystem: { write: [`${cwd}/w`], read: [`${cwd}/r`], entries: [{ access: "write", ...path("w") }, { access: "read", ...path("r") }, { access: "deny", ...path(".env") }] } } } }, { cwd });
  assert.deepEqual(card.fields, [{ label: "Write access to", value: `${cwd}/w` }, { label: "Read access to", value: `${cwd}/r` }, { label: "No access to", value: `${cwd}/.env` }]);
  assert.equal(card.risk, "medium");
  const odd = await codexCard({ method: "item/permissions/requestApproval", params: { itemId: "c1", permissions: { fileSystem: { write: [`${cwd}/w`], entries: [{ access: "execute", ...path("x") }] } } } }, { cwd });
  assert.ok(odd.fields.some((f) => f.label === "Asked for" && f.value.includes("execute")), "what isn't known here still shows, as asked");
  assert.equal(odd.risk, "high");
});

test("codex: a server called liner asks like any other unless Liner Code gave the session its own", async () => {
  const ask = { method: "mcpServer/elicitation/request", params: { serverName: "liner", message: "Use it?", _meta: { codex_approval_kind: "mcp_tool_call" } } };
  assert.equal((await codexCard(ask))?.title, "Use it?");
  assert.equal(await codexCard(ask, { mcp: { command: "node", args: [], env: {} } }), undefined, "its own goes without a card");
});

test("codex: a planner's turn runs in plan mode, with Liner Code's words for it, on the model the thread opened with", async () => {
  const { fake, s } = cx(codexServer(`if (m.method === "thread/start") { send({ id: m.id, result: { thread: { id: "root" }, model: "gpt-9" } }); continue; }`), { planning: true, effort: "high" });
  await s.turn("plan it", recorder().sink, live());
  s.close();
  const { mode, settings } = fake.read().find((m) => m.method === "turn/start").params.collaborationMode;
  assert.equal(mode, "plan");
  assert.equal(settings.model, "gpt-9");
  assert.equal(settings.reasoning_effort, "high");
  assert.match(settings.developer_instructions, /request_user_input/);
  assert.doesNotMatch(settings.developer_instructions, /proposed_plan/, "null would bring Codex's own words, which end every turn in a plan of its kind");
  for (const extra of [{}, { access: "read" as const }]) {
    const other = cx(codexServer(), { model: "gpt-9", ...extra });
    await other.s.turn("build it", recorder().sink, live());
    other.s.close();
    assert.equal(other.fake.read().find((m) => m.method === "turn/start").params.collaborationMode, undefined, "only a planner's");
  }
  const named = cx(codexServer(), { planning: true, model: "gpt-8" });
  await named.s.turn("plan it", recorder().sink, live());
  named.s.close();
  assert.equal(named.fake.read().find((m) => m.method === "turn/start").params.collaborationMode.settings.model, "gpt-8", "the model you chose");
  const none = cx(codexServer(), { planning: true });
  await none.s.turn("plan it", recorder().sink, live());
  none.s.close();
  assert.equal(none.fake.read().find((m) => m.method === "turn/start").params.collaborationMode, undefined, "with no model to name, it isn't sent: Codex would refuse the turn");
});

test("codex: a plan that came out of the message as Codex's own plan item is handed over the way a planner's is", async () => {
  const { s } = cx(codexServer(`if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    send({ method: "item/started", params: { threadId: "root", turnId: "turn-1", item: { type: "plan", id: "p1", text: "" } } });
    send({ method: "item/plan/delta", params: { threadId: "root", turnId: "turn-1", itemId: "p1", delta: "# Paint it" } });
    send({ method: "item/completed", params: { threadId: "root", turnId: "turn-1", item: { type: "plan", id: "p1", text: "# Paint it\\n- Buy paint\\n" } } });
    send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } });
    continue;
  }`), { planning: true, model: "gpt-9" });
  const { r, sink } = recorder();
  await s.turn("plan it", sink, live());
  s.close();
  assert.deepEqual(takePlan(r.text), { title: undefined, plan: "# Paint it\n- Buy paint", before: "", after: "" });
});

test("codex: a stopped turn's late request is refused, not put to you in the next turn", async () => {
  const { fake, s } = cx(codexServer(`if (m.method === "turn/start" && seen("turn/start") === 1) { send({ id: m.id, result: { turn: { id: "turn-1" } } }); continue; }
  if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "turn-2" } } });
    send({ id: 900, method: "item/commandExecution/requestApproval", params: { threadId: "root", turnId: "turn-1", itemId: "c1", command: "rm -rf build" } });
    continue;
  }
  if (m.id === 900) { send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-2", status: "completed" } } }); continue; }`));
  const stop = new AbortController();
  const first = s.turn("one", recorder().sink, stop.signal);
  await until(() => fake.read().some((m) => m.method === "turn/start"), "it starts");
  await tick(20);
  stop.abort();
  await first;
  const { r, sink } = recorder();
  await s.turn("two", sink, live());
  s.close();
  assert.equal(r.cards.length, 0);
  assert.equal(fake.read().find((m) => m.id === 900 && !m.method)?.result?.decision, "decline");
});

test("codex: a closed session's turn ends, and it can be used again", async () => {
  const { fake, s } = cx(codexServer(`if (m.method === "turn/start" && seen("turn/start") === 1) { send({ id: m.id, result: { turn: { id: "turn-1" } } }); continue; }`));
  const turn = s.turn("one", recorder().sink, live());
  await until(() => fake.read().some((m) => m.method === "turn/start"), "it starts");
  await tick(20);
  s.close();
  assert.equal(await settled(turn, 1500), "ok");
  await s.turn("two", recorder().sink, live());
  s.close();
  assert.equal(fake.read().filter((m) => m.method === "thread/resume").length, 1);
});

test("codex: a process being closed can't talk over the one after it", async () => {
  const fake = script("codex", `
  if (m.method === "initialize") { send({ id: m.id, result: {} }); if (seen("initialize") === 1) { process.on("SIGTERM", () => {}); setInterval(() => { send({ method: "item/agentMessage/delta", params: { delta: "old" } }); send({ id: 777, method: "item/tool/requestUserInput", params: {} }); }, 10); setTimeout(() => process.exit(0), 300); } }`);
  const srv = new CodexServer({ ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log }, "/tmp");
  await srv.ready();
  srv.close();
  const heard: string[] = [];
  srv.onNotify = (m) => void heard.push(m);
  srv.onRequest = async (m) => (heard.push(m), {});
  await srv.ready();
  await tick(100);
  srv.close();
  assert.deepEqual(heard, []);
  assert.deepEqual(fake.read().filter((m) => m.id === 777), []);
});

test("codex: an app server that ignores being closed is ended", async () => {
  const { fake, s } = cx(codexServer(`if (m.method === "initialize") { process.on("SIGTERM", () => {}); fs.writeFileSync(process.env.FAKE_LOG + ".pid", String(process.pid)); }`));
  await s.turn("hi", recorder().sink, live());
  s.close();
  const pid = Number(readFileSync(`${fake.log}.pid`, "utf8"));
  await until(() => gone(pid), "it's gone");
});

test("codex: a project folder that's gone fails the turn and says so", async () => {
  const { s } = cx(codexServer(), { cwd: join(tmpdir(), "lc-audit-no-such-folder") });
  assert.match(await settled(s.turn("hi", recorder().sink, live())), /^rejected: .*lc-audit-no-such-folder/);
  s.close();
});

test("codex: an app server that dies leaving a child on its pipes fails the turn", async () => {
  const { s } = cx(codexServer(`if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    const kid = require("child_process").spawn("sleep", ["8"], { stdio: "inherit" });
    kid.unref();
    process.exit(7);
  }`));
  const { r, sink } = recorder();
  assert.equal(await settled(s.turn("hi", sink, live())), "ok");
  s.close();
  assert.equal(r.errors.length, 1);
});

test("codex: keys and home folders in the app server's stderr don't reach the timeline", async () => {
  const { s } = cx(`if (m.method === "initialize") { process.stderr.write("failed for " + process.env.HOME + "/x sk-abcdefghijklmnop\\n"); process.exit(1); }`, { env: { HOME: "/Users/someone" } as NodeJS.ProcessEnv });
  const said = await s.turn("hi", recorder().sink, live()).then(() => "", (e: Error) => e.message);
  s.close();
  assert.match(said, /failed for/);
  assert.ok(!said.includes("/Users/someone") && !said.includes("sk-abcdefghijklmnop"), said);
});

test("codex: a request Liner Code doesn't know is 'method not found'", async () => {
  const { fake, s } = cx(codexServer(`if (m.method === "turn/start") { send({ id: m.id, result: { turn: { id: "turn-1" } } }); send({ id: 900, method: "something/new", params: {} }); continue; }
  if (m.id === 900) { send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } }); continue; }`));
  await s.turn("hi", recorder().sink, live());
  s.close();
  assert.equal(fake.read().find((m) => m.id === 900 && !m.method)?.error?.code, -32601);
});

/** Codex through `codex exec`: `body` runs after it has read its prompt. */
function exec(body: string, extra: Partial<OpenOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lc-audit-exec-"));
  const file = join(dir, "codex");
  const log = join(dir, "args");
  writeFileSync(file, `#!/usr/bin/env node
require("fs").writeFileSync(${JSON.stringify(`${log}.pid`)}, String(process.pid));
require("fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
process.stdin.resume();
process.stdin.on("end", () => { ${body} });
`, { mode: 0o755 });
  const s = codex.open(opts({ ...extra, env: { ...process.env, LINER_BIN_CODEX: file } }));
  return { s, args: () => JSON.parse(readFileSync(log, "utf8")) as string[], log };
}

test("codex exec: a Codex that ignores Stop is ended, and the turn with it", async () => {
  const { s, log } = exec(`process.on("SIGINT", () => {}); setInterval(() => {}, 1000); send({ type: "thread.started", thread_id: "t" });`);
  const stop = new AbortController();
  const turn = s.turn("hi", recorder().sink, stop.signal);
  await until(() => existsSync(log), "it starts");
  await tick(100);
  stop.abort();
  assert.equal(await settled(turn, 6000), "ok");
  s.close();
});

test("codex exec: a Codex that ignores being closed is ended", async () => {
  const { s, log } = exec(`process.on("SIGINT", () => {}); setInterval(() => {}, 1000); send({ type: "thread.started", thread_id: "t" });`);
  const turn = s.turn("hi", recorder().sink, live()).catch(() => {});
  await until(() => existsSync(log), "it starts");
  await tick(100);
  const pid = Number(readFileSync(`${log}.pid`, "utf8"));
  s.close();
  await until(() => gone(pid), "it's gone");
  await turn;
});

test("codex exec: a turn stopped before it began starts nothing", async () => {
  const { s, log } = exec(`process.exit(0);`);
  const stop = new AbortController();
  stop.abort();
  await s.turn("hi", recorder().sink, stop.signal);
  await tick(150);
  s.close();
  assert.equal(existsSync(log), false);
});

test("codex exec: an image doesn't swallow the thread it resumes", async () => {
  const png = join(mkdtempSync(join(tmpdir(), "lc-img-")), "shot.png");
  writeFileSync(png, Buffer.from("89504e470d0a1a0a", "hex"));
  const { s, args } = exec(`process.exit(0);`, { resume: "t-9" });
  await s.turn("look", recorder().sink, live(), [png]);
  s.close();
  const a = args();
  const at = a.indexOf("-i");
  assert.ok(at >= 0);
  // `-i` takes every value after it, up to the next flag.
  assert.ok(a[at + 2].startsWith("-") && a[at + 2] !== "-", a.join(" "));
  assert.deepEqual(a.slice(-2), ["t-9", "-"]);
});

/* -------------------------------------- A plain model call -------------------------------------- */

const endpoint = (port: number, protocol: Endpoint["protocol"] = "chat", url?: string): Endpoint => ({ id: "e", label: "Fake API", url: url ?? `http://127.0.0.1:${port}`, protocol, models: ["m"] });
async function serve(handler: Parameters<typeof createServer>[1]) {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  return { server, port: typeof a === "object" && a ? a.port : 0 };
}
const chunk = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

test("plain: Stop mid-answer says Stopped, not a stream's own error", async () => {
  const { server, port } = await serve((_, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(chunk("hel"));
  });
  const stop = new AbortController();
  const ask = askEndpoint(endpoint(port), "k", "m", { system: "", prompt: "hi", signal: stop.signal, onText: () => stop.abort() });
  await assert.rejects(ask, /^Error: Stopped\.$/);
  server.closeAllConnections();
  server.close();
});

test("plain: a dropped stream names the endpoint, not the socket's words alone", async () => {
  const { server, port } = await serve((_, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(chunk("hel"));
    setTimeout(() => res.destroy(), 20);
  });
  await assert.rejects(askEndpoint(endpoint(port), "k", "m", { system: "", prompt: "hi", signal: live() }), /Fake API/);
  server.close();
});

test("plain: an endpoint that answers in one piece, ignoring the stream, is read", async () => {
  const bodies: Record<string, object> = {
    chat: { choices: [{ message: { content: "whole answer" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } },
    anthropic: { content: [{ type: "text", text: "whole answer" }], usage: { input_tokens: 3, output_tokens: 2 } },
    responses: { output: [{ type: "message", content: [{ type: "output_text", text: "whole answer" }] }], usage: { input_tokens: 3, output_tokens: 2 } },
  };
  for (const protocol of ["chat", "anthropic", "responses"] as const) {
    const { server, port } = await serve((_, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(bodies[protocol])));
    const seen: string[] = [];
    const r = await askEndpoint(endpoint(port, protocol), "k", "m", { system: "", prompt: "hi", signal: live(), onText: (t) => void seen.push(t) });
    server.close();
    assert.deepEqual([r.text, r.inputTokens, r.outputTokens, seen.join("")], ["whole answer", 3, 2, "whole answer"], protocol);
  }
});

test("plain: an error in a 200 JSON answer is an error, not an empty answer", async () => {
  const { server, port } = await serve((_, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "model is asleep" } })));
  await assert.rejects(askEndpoint(endpoint(port), "k", "m", { system: "", prompt: "hi", signal: live() }), /Fake API: model is asleep/);
  server.close();
});

test("plain: the key never comes back in what an endpoint says", async () => {
  const key = "my-very-secret-key";
  const { server, port } = await serve((req, res) => {
    if (req.url === "/chat/completions" && req.headers["x-step"] === undefined) res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: `Bad key ${key} here` } }));
  });
  await assert.rejects(askEndpoint(endpoint(port), key, "m", { system: "", prompt: "hi", signal: live() }), (e: Error) => !e.message.includes(key) && /400/.test(e.message));
  server.close();
  const mid = await serve((_, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ error: { message: `Bad key ${key} here` } })}\n\n`);
  });
  await assert.rejects(askEndpoint(endpoint(mid.port), key, "m", { system: "", prompt: "hi", signal: live() }), (e: Error) => !e.message.includes(key));
  mid.server.close();
});

test("plain: a connection left open after [DONE] is let go", async () => {
  let closed = false;
  const { server, port } = await serve((_, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`${chunk("hi")}data: [DONE]\n\n`);
    res.on("close", () => (closed = true));
  });
  await askEndpoint(endpoint(port), "k", "m", { system: "", prompt: "hi", signal: live() });
  await until(() => closed, "the connection closes");
  server.close();
});

test("plain: an answer that's over is over, even if the connection stays open", async () => {
  const anthropic = await serve((_, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } })}\n\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
  });
  assert.equal(await settled(askEndpoint(endpoint(anthropic.port, "anthropic"), "k", "m", { system: "", prompt: "hi", signal: live() }), 1500), "ok");
  anthropic.server.closeAllConnections();
  anthropic.server.close();
  const responses = await serve((_, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`);
  });
  assert.equal(await settled(askEndpoint(endpoint(responses.port, "responses"), "k", "m", { system: "", prompt: "hi", signal: live() }), 1500), "ok");
  responses.server.closeAllConnections();
  responses.server.close();
});

test("plain: an address that can't be used isn't repeated in the error", async () => {
  const bad = endpoint(0, "chat", "not a url at all/secret-path");
  await assert.rejects(askEndpoint(bad, "k", "m", { system: "", prompt: "hi", signal: live() }), (e: Error) => /Fake API/.test(e.message) && !e.message.includes("secret-path"));
});

/* ------------------------------------------ The proxy ------------------------------------------ */

const fetchRaw = (url: string) =>
  new Promise<{ status: number; body: string; ended: boolean }>((resolve) => {
    const req = get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, ended: true }));
      res.on("error", () => resolve({ status: res.statusCode ?? 0, body, ended: false }));
      res.on("close", () => resolve({ status: res.statusCode ?? 0, body, ended: false }));
    });
    req.on("error", () => resolve({ status: 0, body: "", ended: false }));
  });

test("proxy: a missing file's name can't write into the page", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-audit-folder-"));
  const p = new Proxies();
  const base = await p.files(dir);
  const r = await fetchRaw(`${base}/%3Cimg%20src=x%20onerror=alert(1)%3E`);
  p.closeAll();
  assert.equal(r.status, 404);
  assert.ok(!r.body.includes("<img"), r.body);
});

test("proxy: a file that can't be read answers, it doesn't hang", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-audit-folder-"));
  const page = join(dir, "index.html");
  const data = join(dir, "data.txt");
  writeFileSync(page, "<p>hi");
  writeFileSync(data, "hi");
  chmodSync(page, 0o000);
  chmodSync(data, 0o000);
  const p = new Proxies();
  const base = await p.files(dir);
  const a = await Promise.race([fetchRaw(`${base}/index.html`), tick(1500).then(() => null)]);
  const b = await Promise.race([fetchRaw(`${base}/data.txt`), tick(1500).then(() => null)]);
  p.closeAll();
  assert.ok(a, "the page answered");
  assert.ok(b, "the file answered");
  assert.notEqual(a!.status, 200);
});

test("proxy: a page that goes away lets go of the dev server's stream", async () => {
  let gone = false;
  const { server, port } = await serve((_, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: hi\n\n");
    res.on("close", () => (gone = true));
  });
  const p = new Proxies();
  const base = await p.url(port);
  await new Promise<void>((resolve) => {
    const req = get(`${base}/events`, (res) => {
      res.once("data", () => {
        req.destroy();
        resolve();
      });
    });
    req.on("error", () => {});
  });
  await until(() => gone, "the dev server's side closes");
  p.closeAll();
  server.close();
});

test("proxy: a dev server that dies mid-answer ends the page's request", async () => {
  const pages = await serve((_, res) => {
    res.writeHead(200, { "content-type": "text/html", "content-length": "1000" });
    res.write("<p>half");
    setTimeout(() => res.destroy(), 10);
  });
  const files = await serve((_, res) => {
    res.writeHead(200, { "content-type": "text/plain", "content-length": "1000" });
    res.write("half");
    setTimeout(() => res.destroy(), 10);
  });
  const p = new Proxies();
  const a = await Promise.race([fetchRaw(`${await p.url(pages.port)}/`), tick(1500).then(() => "hung" as const)]);
  const b = await Promise.race([fetchRaw(`${await p.url(files.port)}/x.txt`), tick(1500).then(() => "hung" as const)]);
  p.closeAll();
  pages.server.close();
  files.server.close();
  assert.notEqual(a, "hung");
  assert.notEqual(b, "hung");
});

test("proxy: two asks for one port open one server", async () => {
  const s: Server = createServer((_, res) => res.end("ok"));
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as { port: number }).port;
  const dir = mkdtempSync(join(tmpdir(), "lc-audit-folder-"));
  const p = new Proxies();
  const [a, b] = await Promise.all([p.url(port), p.url(port)]);
  const [c, d] = await Promise.all([p.files(dir), p.files(dir)]);
  p.closeAll();
  s.close();
  assert.equal(a, b);
  assert.equal(c, d);
});

/* ---------------------------------------- The ACP registry ---------------------------------------- */

test("registry: a version that climbs out of the agents folder deletes nothing", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-audit-home-"));
  const keep = join(home, "keep");
  mkdirSync(keep);
  writeFileSync(join(keep, "precious"), "x");
  const saved = globalThis.fetch;
  globalThis.fetch = (async () => new Response("archive")) as typeof fetch;
  try {
    const entry = { id: "x", name: "X", version: "../../keep", distribution: { binary: { [`${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "aarch64" : "x86_64"}`]: { archive: "https://example.com/a.tgz", cmd: "agent" } } } };
    await assert.rejects(fromRegistry(entry, home, [], process.env));
  } finally {
    globalThis.fetch = saved;
  }
  assert.ok(existsSync(join(keep, "precious")));
});
