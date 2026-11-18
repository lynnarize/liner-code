/*
  The providers' polish round (2026-11-18 audit, engine-providers.md): an ACP agent reads what it was handed, a line that
  can't be handled neither vanishes nor hangs a turn, and the smaller fixes after them. The agents are small Node scripts
  speaking ACP or Codex's app server, as in providers.test.ts. Run with `node --test test/polish-providers.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { acpProvider, exportSpans, opencodeTurnUsage, setOpencodeExportMax, setOpencodeUsageMs, OPENCODE_EXPORT_MAX, OPENCODE_USAGE_MS } from "../src/providers/acp.ts";
import { CodexServerSession } from "../src/providers/codex-server.ts";
import { jsonLines } from "../src/exec.ts";
import { detectOnce, endpointProvider } from "../src/providers/endpoint.ts";
import { codex, execMcp } from "../src/providers/codex.ts";
import { codexEffort, codexModel, editTitle } from "../src/providers/codex-server.ts";
import { claude, sdk } from "../src/providers/claude.ts";
import { setSwitchMs, SWITCH_MS, COMMANDS_AGAIN_MS, setCommandsAgainMs } from "../src/providers/acp.ts";
import { LINER_WAIT_SEC } from "../src/providers/types.ts";
import type { Provider } from "../src/providers/types.ts";
import type { OpenOptions, TurnSink } from "../src/providers/types.ts";
import { noLeaks } from "./leaks.ts";

noLeaks();

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 300 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}
const opts = (extra: Partial<OpenOptions> = {}) => ({ cwd: "/tmp", model: "default", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: "" }, ...extra }) as OpenOptions;
function recorder() {
  const r = { text: "", errors: [] as string[], notices: [] as string[], sessions: [] as string[] };
  const sink = {
    text: (d: string) => void (r.text += d), reasoning: () => {}, tool: () => {}, plan: () => {},
    approve: async () => ({ allow: true }), ask: async () => null, propose: async () => ({ approve: true }),
    usage: () => {}, session: (id: string) => void r.sessions.push(id), notice: (m: string) => void r.notices.push(m), error: (m: string) => void r.errors.push(m), limited: () => {},
  } as unknown as TurnSink;
  return { r, sink };
}
function script(name: string, on: string) {
  const dir = mkdtempSync(join(tmpdir(), "lc-polish-"));
  const file = join(dir, name);
  writeFileSync(file, `#!/usr/bin/env node
const fs = require("fs");
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const mode = process.env.FAKE_MODE || "";
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

/** An agent that sends the client its requests one by one as its prompt starts, and ends the turn on the last reply. */
const ACP_ASKS = `
switch (m.method) {
  case "initialize": send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } }); break;
  case "session/new": send({ id: m.id, result: { sessionId: "s-new" } }); break;
  case "session/prompt":
    global.prompt = m.id;
    global.asks = [].concat(JSON.parse(process.env.FAKE_ASK));
    global.next = 0;
    send({ jsonrpc: "2.0", id: 900, ...global.asks[0] });
    break;
  default:
    if (m.id >= 900) {
      global.next++;
      if (global.next < global.asks.length) send({ jsonrpc: "2.0", id: 900 + global.next, ...global.asks[global.next] });
      else send({ id: global.prompt, result: { stopReason: "end_turn" } });
    } else if (m.id !== undefined) send({ id: m.id, result: {} });
}`;
type Reply = { id: number; result?: { content?: unknown }; error?: { message: string } };
type Ask = { method: string; params: Record<string, unknown> };
async function acpAsk(ask: Ask, extra: Partial<OpenOptions>) {
  const fake = script("agent", ACP_ASKS);
  const p = acpProvider("acp.fake", { label: "Fake", cmd: [fake.file], login: "" });
  const s = p.open(opts({ ...extra, env: { ...process.env, FAKE_LOG: fake.log, FAKE_ASK: JSON.stringify([ask]) } }));
  await s.turn("go", recorder().sink, new AbortController().signal);
  s.close();
  return (fake.read().filter((m) => m.id >= 900 && !m.method) as Reply[])[0];
}

// B8 (#4): what an ACP agent was handed (your attachments, a long output it saved) it may read through its own file call.
test("acp: an agent reads what it was handed at every level, and nothing leads out of it", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lc-polish-root-")));
  const handed = realpathSync(mkdtempSync(join(tmpdir(), "lc-polish-handed-")));
  const away = realpathSync(mkdtempSync(join(tmpdir(), "lc-polish-away-")));
  writeFileSync(join(handed, "shot.txt"), "attached");
  writeFileSync(join(away, "secret.txt"), "secret");
  symlinkSync(away, join(handed, "out"));
  mkdirSync(join(handed, "sub"));
  const read = (path: string, access: OpenOptions["access"] = "read") => acpAsk({ method: "fs/read_text_file", params: { path } }, { cwd: root, access, dirs: [handed] });

  for (const access of ["read", "ask", "edits", "full"] as const) assert.equal((await read(join(handed, "shot.txt"), access)).result?.content, "attached", `at ${access}`);
  assert.match((await read(join(handed, "out", "secret.txt"))).error?.message ?? "", /outside the project/, "a link in the handed folder doesn't lead out");
  assert.match((await read(`${handed}/sub/../../${basenameOf(away)}/secret.txt`)).error?.message ?? "", /outside the project/, "nor does ..");
  assert.match((await read(join(away, "secret.txt"), "full")).error?.message ?? "", /outside the project/, "another outside read stays refused, at Full too");
  const write = await acpAsk({ method: "fs/write_text_file", params: { path: join(handed, "new.txt"), content: "x" } }, { cwd: root, access: "full", dirs: [handed] });
  assert.match(write.error?.message ?? "", /outside the project/, "a write there is still refused");
  assert.throws(() => readFileSync(join(handed, "new.txt")));
});
const basenameOf = (p: string) => p.split("/").pop() ?? p;

// B13 (#6): a throw while handling a line is said, not taken for a raw line, and the lines after it still come.
test("jsonLines: a handler that throws is logged, not taken for a line that isn't JSON", async () => {
  const stream = new PassThrough();
  const got: unknown[] = [];
  const raw: string[] = [];
  const logged: unknown[] = [];
  const error = console.error;
  console.error = (...a: unknown[]) => void logged.push(a);
  try {
    jsonLines(stream, (v) => {
      if ((v as { boom?: boolean }).boom) throw new Error("sink failed");
      got.push(v);
    }, (l) => raw.push(l));
    stream.write('{"boom":true}\n{"n":1}\nnot json\n');
    await tick();
  } finally {
    console.error = error;
  }
  assert.deepEqual(got, [{ n: 1 }]);
  assert.deepEqual(raw, ["not json"]);
  assert.equal(logged.length, 1);
});

const CODEX = `
switch (m.method) {
  case "initialize": send({ id: m.id, result: {} }); break;
  case "thread/start": send({ id: m.id, result: { thread: { id: "t-1" } } }); break;
  case "turn/start": send({ id: m.id, result: { turn: { id: "turn-1" } } }); setTimeout(() => send({ method: "turn/completed", params: { threadId: "t-1", turn: { id: "turn-1", status: "failed", error: { message: "The model broke." } } } }), 20); break;
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`;

test("codex: a turn whose end throws as it's handled ends as failed, with the reason, rather than hanging", async () => {
  const fake = script("codex", CODEX);
  const s = new CodexServerSession(opts({ env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log } }));
  const { sink } = recorder();
  sink.error = () => {
    throw new Error("The disk is full.");
  };
  const r = await Promise.race([s.turn("hi", sink, new AbortController().signal).then(() => "ended", (e: Error) => `failed: ${e.message}`), tick(3000).then(() => "hung")]);
  await s.close();
  assert.equal(r, "failed: The disk is full.");
});

// C9 (#1): OpenCode's count per turn parses only the turn's messages, gives up on a session too long, and holds no stopped turn.
/** An OpenCode that speaks ACP, and whose `export` prints FAKE_OUT (or never ends, with FAKE_SLOW). */
function opencode() {
  const dir = mkdtempSync(join(tmpdir(), "lc-polish-oc-"));
  const file = join(dir, "opencode");
  writeFileSync(file, `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2);
if (a[0] === "export") {
  if (process.env.FAKE_SLOW) { setTimeout(() => {}, 60_000); return; }
  // As OpenCode's store would be: a prompt is in the export only once it reached the agent. FAKE_AFTER prompts are waited for (the agent
  // below notes each in FAKE_PROMPTS), so the export can't hold a turn whose prompt hasn't gone yet, however slow the machine.
  if (process.env.FAKE_AFTER) {
    const want = Number(process.env.FAKE_AFTER);
    const look = () => ((fs.existsSync(process.env.FAKE_PROMPTS) ? fs.readFileSync(process.env.FAKE_PROMPTS, "utf8").length : 0) >= want ? process.stdout.write(fs.readFileSync(process.env.FAKE_OUT, "utf8")) : setTimeout(look, 20));
    return look();
  }
  process.stdout.write(fs.readFileSync(process.env.FAKE_OUT, "utf8"));
  return;
}
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
let buf = "", prompt;
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.method === "initialize") send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } });
    else if (m.method === "session/new") send({ id: m.id, result: { sessionId: "s1" } });
    else if (m.method === "session/prompt") { prompt = m.id; if (process.env.FAKE_PROMPTS) fs.appendFileSync(process.env.FAKE_PROMPTS, "p"); send({ method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "bash", kind: "execute", status: "in_progress" } } }); }
    else if (m.method === "session/cancel") send({ id: prompt, result: { stopReason: "cancelled", usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } } });
    else if (m.id !== undefined) send({ id: m.id, result: {} });
  }
});
`, { mode: 0o755 });
  const out = join(dir, "export.json");
  return { file, out };
}
const step = (input: number, output: number) => ({ info: { role: "assistant", time: { created: 0 }, tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } } }, parts: [{ type: "text", text: "a } ] { [ \\\" brace" }] });

test("opencode: an export's info and messages are found without parsing them, and one cut off isn't read", () => {
  const doc = { info: { id: "s1", title: "x { [" }, messages: [{ info: { role: "user" } }, step(1, 2)] };
  for (const text of [JSON.stringify(doc), JSON.stringify(doc, null, 2), `Exporting\n${JSON.stringify(doc)}`]) {
    const at = text.indexOf("{");
    const spans = exportSpans(text, at);
    assert.ok(spans?.info && spans.messages);
    assert.deepEqual(JSON.parse(text.slice(...spans.info)), doc.info);
    assert.deepEqual(spans.messages.map((m) => JSON.parse(text.slice(...m))), doc.messages);
  }
  const whole = JSON.stringify(doc);
  assert.equal(exportSpans(whole.slice(0, -5), 0), null, "cut off");
  assert.equal(exportSpans(JSON.stringify({ info: { id: "s1" } }), 0)?.messages, undefined, "no messages");
});

test("opencode: only the turn's own messages are parsed, the session before them isn't", async () => {
  const { file, out } = opencode();
  const since = Date.now();
  // An earlier turn's message JSON can't parse (NaN): read whole, the count was lost; the turn's own are all that's read.
  const before = `{ "info": { "role": "assistant", "time": { "created": 1000 }, "tokens": { "input": NaN } } }`;
  const turn = [{ info: { role: "user", time: { created: since } } }, step(100, 10), step(200, 20)].map((m) => JSON.stringify(m)).join(",");
  const earlier = JSON.stringify({ info: { role: "assistant", time: { created: 1500 }, tokens: { input: 9000, output: 900 } } });
  writeFileSync(out, `{"info":{"id":"s1"},"messages":[${before},{"info":{"role":"user","time":{"created":1000}}},${earlier},${turn}]}`);
  assert.deepEqual(await opencodeTurnUsage([file, "acp"], "s1", since, { cwd: tmpdir(), env: { ...process.env, FAKE_OUT: out } }), { inputTokens: 300, outputTokens: 30, cacheReadTokens: 0 });
});

// Round 2 (#4): a stopped turn's count, read after the turn was handed back, stops at the next prompt.
test("opencode: a turn's count stops at the next prompt once one has gone, and keeps a user message OpenCode made inside the turn", async () => {
  const { file, out } = opencode();
  const since = Date.now();
  const next = since + 5000;
  const user = (created: number) => ({ info: { role: "user", time: { created } } });
  const msgs = [user(since), step(100, 10), user(since + 2000), step(1, 1), user(next), step(200, 20), step(400, 40)];
  writeFileSync(out, JSON.stringify({ info: { id: "s1" }, messages: msgs }));
  const read = (o: { next?: () => number | undefined } = {}) => opencodeTurnUsage([file, "acp"], "s1", since, { cwd: tmpdir(), env: { ...process.env, FAKE_OUT: out }, ...o });
  assert.deepEqual(await read({ next: () => next }), { inputTokens: 101, outputTokens: 11, cacheReadTokens: 0 }, "the next prompt's steps are its own; the one inside the turn isn't a prompt");
  assert.deepEqual(await read({ next: () => undefined }), { inputTokens: 701, outputTokens: 71, cacheReadTokens: 0 }, "no next prompt yet: nothing is cut");
  assert.deepEqual(await read(), { inputTokens: 701, outputTokens: 71, cacheReadTokens: 0 });
});

// The real-tool check: OpenCode 2 ends a short turn in under a second, so a second of slack before a turn's prompt took in the turn before.
test("opencode: three turns back to back, within 300 ms of each other: each turn counts its own messages only", async () => {
  const { file, out } = opencode();
  const t0 = Date.now();
  const user = (created: number) => ({ info: { role: "user", time: { created } } });
  const at = (m: ReturnType<typeof step>, created: number) => ({ ...m, info: { ...m.info, time: { created } } });
  const msgs = [user(t0), at(step(100, 10), t0 + 50), user(t0 + 250), at(step(20, 2), t0 + 300), at(step(1, 1), t0 + 350), user(t0 + 500), at(step(4000, 400), t0 + 550)];
  writeFileSync(out, JSON.stringify({ info: { id: "s1" }, messages: msgs }));
  // Each turn's `since` is taken just before its prompt goes, so a hair before OpenCode stamps it; each read as that turn's end would, the next not yet sent.
  const read = (since: number, next?: number) => opencodeTurnUsage([file, "acp"], "s1", since, { cwd: tmpdir(), env: { ...process.env, FAKE_OUT: out }, next: () => next });
  assert.deepEqual(await read(t0 - 5, t0 + 245), { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0 });
  assert.deepEqual(await read(t0 + 245, t0 + 495), { inputTokens: 21, outputTokens: 3, cacheReadTokens: 0 }, "not the turn 250 ms before");
  assert.deepEqual(await read(t0 + 495), { inputTokens: 4000, outputTokens: 400, cacheReadTokens: 0 }, "nor the two before it");
  // A prompt a clock stamped a little before `since`: the nearest one before it, not the first in the second's slack.
  assert.deepEqual(await read(t0 + 510), { inputTokens: 4000, outputTokens: 400, cacheReadTokens: 0 });
});

test("opencode: Stop, then the next message at once: the stopped turn's late count leaves the next turn's steps out", async () => {
  const { file, out } = opencode();
  const now = Date.now();
  // Each prompt stamped after its turn began (the fake can't know when): the stopped one's, then the next one's.
  const msgs = [{ info: { role: "user", time: { created: now + 30_000 } } }, step(100, 10), { info: { role: "user", time: { created: now + 60_000 } } }, step(200, 20)];
  writeFileSync(out, JSON.stringify({ info: { id: "s1" }, messages: msgs }));
  const ms = OPENCODE_USAGE_MS;
  setOpencodeUsageMs(10_000);
  // The stopped turn's export answers only once the next prompt has reached the agent: the case the bound is for. (A fixed delay
  // let a slow machine read the export before the next turn began, from a fake store that already held that turn's prompt.)
  const s = acpProvider("opencode", { label: "OpenCode", cmd: [file, "acp"], login: "" }).open(opts({ env: { ...process.env, FAKE_OUT: out, FAKE_AFTER: "2", FAKE_PROMPTS: `${out}.prompts` } }));
  const turn = () => {
    const { sink } = recorder();
    const used: unknown[] = [];
    sink.usage = (u) => void used.push(u);
    const ac = new AbortController();
    sink.tool = () => ac.abort();
    return { done: s.turn("go", sink, ac.signal), used };
  };
  try {
    const one = turn();
    await one.done;
    assert.deepEqual(one.used, [], "not yet: the export is still being read");
    const two = turn();
    await two.done;
    await until(() => one.used.length > 0, "the stopped turn's count follows");
    assert.deepEqual(one.used, [{ inputTokens: 100, outputTokens: 10, cacheReadTokens: 0 }]);
    await until(() => two.used.length > 0, "the next one's too");
  } finally {
    setOpencodeUsageMs(ms);
    s.close();
  }
});

test("opencode: a session too long to read each turn falls back to the prompt result, with the line in the log", async () => {
  const { file, out } = opencode();
  const since = Date.now();
  writeFileSync(out, JSON.stringify({ info: { id: "s1" }, messages: [{ info: { role: "user", time: { created: since } } }, ...Array.from({ length: 200 }, () => step(1, 1))] }));
  const max = OPENCODE_EXPORT_MAX;
  setOpencodeExportMax(4096);
  const was = console.error;
  const said: string[] = [];
  console.error = (...a: unknown[]) => void said.push(a.join(" "));
  try {
    assert.equal(await opencodeTurnUsage([file, "acp"], "s1", since, { cwd: tmpdir(), env: { ...process.env, FAKE_OUT: out } }), null);
  } finally {
    console.error = was;
    setOpencodeExportMax(max);
  }
  assert.equal(said.length, 1);
  assert.match(said[0], /^\[opencode\] couldn't read .*over 0 MB/);
});

test("opencode: Stop ends the turn at once, and its count follows", async () => {
  const { file, out } = opencode();
  writeFileSync(out, "{}");
  const ms = OPENCODE_USAGE_MS;
  setOpencodeUsageMs(1500);
  const s = acpProvider("opencode", { label: "OpenCode", cmd: [file, "acp"], login: "" }).open(opts({ env: { ...process.env, FAKE_OUT: out, FAKE_SLOW: "1" } }));
  const { sink } = recorder();
  const used: unknown[] = [];
  sink.usage = (u) => void used.push(u);
  const ac = new AbortController();
  sink.tool = () => ac.abort();
  const was = console.error;
  console.error = () => {};
  try {
    const at = Date.now();
    await s.turn("go", sink, ac.signal);
    assert.ok(Date.now() - at < 1200, `ended ${Date.now() - at} ms after it began`);
    assert.deepEqual(used, [], "not yet");
    await until(() => used.length > 0, "its count follows");
    assert.deepEqual(used, [{ inputTokens: 7, outputTokens: 3, cacheReadTokens: 0 }], "OpenCode's store didn't answer in time: the prompt result stands");
  } finally {
    console.error = was;
    setOpencodeUsageMs(ms);
    s.close();
  }
});

// C11 (#3): the composer's commands come from what the tool's sessions said; a throwaway session only while nothing has been.
const ACP_COMMANDS = `
switch (m.method) {
  case "initialize": send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } }); break;
  case "session/new":
    send({ id: m.id, result: { sessionId: "s-" + Date.now() } });
    send({ method: "session/update", params: { sessionId: "s", update: { sessionUpdate: "available_commands_update", availableCommands: mode === "none" ? [] : [{ name: "c-" + require("path").basename(m.params.cwd), description: "" }] } } });
    break;
  case "session/prompt": setTimeout(() => send({ id: m.id, result: { stopReason: "end_turn" } }), 30); break;
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`;

test("acp: listing commands opens one throwaway session per folder a run, none once a session there has said them, and never offers one folder's in another", async () => {
  const fake = script("agent", ACP_COMMANDS);
  const env = { ...process.env, FAKE_LOG: fake.log };
  const a = realpathSync(mkdtempSync(join(tmpdir(), "lc-polish-a-")));
  const b = realpathSync(mkdtempSync(join(tmpdir(), "lc-polish-b-")));
  const c = realpathSync(mkdtempSync(join(tmpdir(), "lc-polish-c-")));
  const opened = () => fake.read().filter((m) => m.method === "session/new").length;
  const p = acpProvider("acp.cmds1", { label: "Fake", cmd: [fake.file], login: "" });

  const names = async (cwd: string) => (await p.commands!(env, cwd)).commands.map((c) => c.name);
  assert.deepEqual(await names(a), [`c-${basenameOf(a)}`], "nothing said yet: asked of one throwaway session");
  assert.equal(opened(), 1);
  assert.deepEqual(await names(a), [`c-${basenameOf(a)}`]);
  assert.equal(opened(), 1, "the same folder isn't asked again");
  assert.deepEqual(await names(b), [`c-${basenameOf(b)}`], "another folder gets its own, never a's");
  assert.equal(opened(), 2);
  assert.deepEqual(await names(b), [`c-${basenameOf(b)}`]);
  assert.equal(opened(), 2, "b asked once too");

  // A live session in c says c's own: that's what c offers from now on, with no throwaway opened for it.
  const s = p.open(opts({ cwd: c, env }));
  await s.turn("hi", recorder().sink, new AbortController().signal);
  s.close();
  assert.equal(opened(), 3, "the live session");
  assert.deepEqual(await names(c), [`c-${basenameOf(c)}`]);
  assert.deepEqual(await names(a), [`c-${basenameOf(a)}`], "each folder its own");
  assert.equal(opened(), 3);

  // A tool whose session spoke in a: another folder still asks its own, and gets b's, not a's.
  const q = acpProvider("acp.cmds2", { label: "Fake", cmd: [fake.file], login: "" });
  const t = q.open(opts({ cwd: a, env }));
  await t.turn("hi", recorder().sink, new AbortController().signal);
  t.close();
  const before = opened();
  assert.deepEqual((await q.commands!(env, a)).commands.map((c) => c.name), [`c-${basenameOf(a)}`]);
  assert.equal(opened(), before, "a's session said them");
  assert.deepEqual((await q.commands!(env, b)).commands.map((c) => c.name), [`c-${basenameOf(b)}`]);
  assert.equal(opened(), before + 1);
});

test("acp: a throwaway ask for commands that said none is asked again after the pause, not before and not never", async () => {
  const fake = script("agent", ACP_COMMANDS);
  const env = { ...process.env, FAKE_LOG: fake.log, FAKE_MODE: "none" };
  const a = realpathSync(mkdtempSync(join(tmpdir(), "lc-polish-a-")));
  const opened = () => fake.read().filter((m) => m.method === "session/new").length;
  const p = acpProvider("acp.cmds3", { label: "Fake", cmd: [fake.file], login: "" });
  const was = COMMANDS_AGAIN_MS;
  try {
    assert.deepEqual((await p.commands!(env, a)).commands, []);
    assert.equal(opened(), 1);
    assert.deepEqual((await p.commands!(env, a)).commands, []);
    assert.equal(opened(), 1, "within the pause: not asked again");
    setCommandsAgainMs(0);
    const back = { ...env, FAKE_MODE: "" };
    assert.deepEqual((await p.commands!(back, a)).commands.map((c) => c.name), [`c-${basenameOf(a)}`], "after the pause: asked again");
    assert.equal(opened(), 2);
    assert.deepEqual((await p.commands!(back, a)).commands.map((c) => c.name), [`c-${basenameOf(a)}`]);
    assert.equal(opened(), 2, "a list that said some is kept for the run");
  } finally {
    setCommandsAgainMs(was);
  }
});

// C10 (#2): an endpoint shares its base tool's detect rather than running it again, while one is under way.
test("endpoint: endpoints through one tool share one detect of it in a round, and the next round asks again", async () => {
  let runs = 0;
  const base = { id: "codex", detect: async () => (runs++, await tick(30), { id: "codex", label: "Codex CLI", available: true, adapter: true, login: "", models: [], supports: { approvals: true, resume: true, effort: true, plan: true } }), open: () => { throw new Error("no"); } } as unknown as Provider;
  const one = endpointProvider(base, { id: "one", label: "One", url: "https://one.example/v1", protocol: "responses", models: ["m1"] } as never, () => "k");
  const two = endpointProvider(base, { id: "two", label: "Two", url: "https://two.example/v1", protocol: "responses", models: ["m2"] } as never, () => "k");
  const env = { PATH: "" };
  const [b, x, y] = await Promise.all([detectOnce(base, env), one.detect(env), two.detect(env)]);
  assert.equal(runs, 1, "one detect for the tool and both its endpoints");
  assert.equal(b.available, true);
  assert.deepEqual([x.id, x.available, x.models.map((m) => m.id)], ["codex.one", true, ["m1"]]);
  assert.deepEqual([y.id, y.models.map((m) => m.id)], ["codex.two", ["m2"]]);
  await one.detect(env);
  assert.equal(runs, 2, "a later look asks afresh");
  await Promise.all([one.detect(env), one.detect({ PATH: "" })]);
  assert.equal(runs, 4, "another environment is another detect");
});

// B18 (#7): an image goes to Codex's app server and to an ACP agent labelled by what its bytes are, as it does to Claude Code.
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const JPEG = Buffer.from("ffd8ffe000104a46494600010100", "hex");
function pictures() {
  const dir = mkdtempSync(join(tmpdir(), "lc-polish-pics-"));
  const files = { png: join(dir, "a.png"), jpegAsPng: join(dir, "b.png"), page: join(dir, "c.png"), text: join(dir, "d.txt") };
  writeFileSync(files.png, PNG);
  writeFileSync(files.jpegAsPng, JPEG);
  writeFileSync(files.page, "<html>not a picture</html>");
  writeFileSync(files.text, PNG);
  return files;
}

test("codex: images go to the app server as their bytes say, and a file that isn't one goes by its path alone", async () => {
  const fake = script("codex", `
switch (m.method) {
  case "initialize": send({ id: m.id, result: {} }); break;
  case "thread/start": send({ id: m.id, result: { thread: { id: "t-1" } } }); break;
  case "turn/start": send({ id: m.id, result: { turn: { id: "turn-1" } } }); setTimeout(() => send({ method: "turn/completed", params: { threadId: "t-1", turn: { id: "turn-1", status: "completed" } } }), 10); break;
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`);
  const f = pictures();
  const s = new CodexServerSession(opts({ env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log } }));
  await s.turn("look", recorder().sink, new AbortController().signal, [f.png, f.jpegAsPng, f.page, f.text]);
  await s.close();
  const input = fake.read().find((m) => m.method === "turn/start").params.input as { type: string; url?: string }[];
  assert.deepEqual(input.filter((x) => x.type === "image").map((x) => x.url!.slice(0, x.url!.indexOf(";"))), ["data:image/png", "data:image/jpeg"]);
});

test("acp: images go to an agent that takes them as their bytes say, and a file that isn't one goes by its path alone", async () => {
  const fake = script("agent", `
switch (m.method) {
  case "initialize": send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: true } } } }); break;
  case "session/new": send({ id: m.id, result: { sessionId: "s-new" } }); break;
  case "session/prompt": send({ id: m.id, result: { stopReason: "end_turn" } }); break;
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`);
  const f = pictures();
  const s = acpProvider("acp.pics", { label: "Fake", cmd: [fake.file], login: "" }).open(opts({ env: { ...process.env, FAKE_LOG: fake.log } }));
  await s.turn("look", recorder().sink, new AbortController().signal, [f.png, f.jpegAsPng, f.page, f.text]);
  s.close();
  const prompt = fake.read().find((m) => m.method === "session/prompt").params.prompt as { type: string; mimeType?: string }[];
  assert.deepEqual(prompt.filter((x) => x.type === "image").map((x) => x.mimeType), ["image/png", "image/jpeg"]);
});

// B19 (#12): on `codex exec`, a sidekick sends no agents of its own, as on the app server; only a scan turns web search off.
test("codex exec: a sidekick runs with its own agents off, and keeps web search; a scan turns both off", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-polish-exec-"));
  const file = join(dir, "codex");
  const log = join(dir, "args");
  writeFileSync(file, `#!/usr/bin/env node
require("fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));
process.stdin.resume();
process.stdin.on("end", () => process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "t" }) + "\\n"));
`, { mode: 0o755 });
  const args = async (extra: Partial<OpenOptions>) => {
    const s = codex.open(opts({ ...extra, env: { ...process.env, LINER_BIN_CODEX: file } }));
    await s.turn("hi", recorder().sink, new AbortController().signal);
    s.close();
    return (JSON.parse(readFileSync(log, "utf8")) as string[]).join(" ");
  };
  const side = await args({ sidekick: true } as Partial<OpenOptions>);
  assert.match(side, /agents\.enabled=false/);
  assert.match(side, /features\.multi_agent=false/);
  assert.doesNotMatch(side, /web_search/);
  const scan = await args({ scan: true } as Partial<OpenOptions>);
  assert.match(scan, /agents\.enabled=false.*web_search="disabled"/);
  assert.doesNotMatch(await args({}), /agents\.enabled|web_search/);
});

// F3 (#10, #9): one source for Codex's titles, effort and model, and for the liner server's keys on `codex exec`.
test("codex: exec and the app server say a step one way, and exec's server keys come from codexMcp", () => {
  assert.equal(editTitle(["a", "b", "c", "d"]), "Edit a, b, c and 1 more", "an agent's own steps too, which said two names and \"2 more\"");
  assert.equal(editTitle(["a"]), "Edit a");
  assert.deepEqual([codexEffort("high"), codexEffort("ultrathink"), codexEffort("ultracode"), codexEffort(undefined)], ["high", null, null, null]);
  assert.deepEqual([codexModel("gpt-6"), codexModel("default"), codexModel(undefined)], ["gpt-6", null, null]);
  const mcp = { command: "/bin/liner", args: ["mcp", "--x"], env: { A: "1" } };
  assert.deepEqual(execMcp({ mcp } as never), ["-c", `mcp_servers.liner.command="/bin/liner"`, "-c", `mcp_servers.liner.args=["mcp","--x"]`, "-c", `mcp_servers.liner.env={ A = "1" }`, "-c", `mcp_servers.liner.tool_timeout_sec=${LINER_WAIT_SEC}`, "-c", `mcp_servers.liner.default_tools_approval_mode="approve"`, "-c", `mcp_servers.liner.omit_tools_from=["deferred"]`], "as it was written out by hand");
  assert.deepEqual(execMcp({}), []);
});

// G12 (#13): a scan on an ACP agent that can't be kept off the web or from its own agents says so, once a session.
test("acp: a scan on an agent that can't be kept off the web says so, once a session", async () => {
  const fake = script("agent", `
switch (m.method) {
  case "initialize": send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } }); break;
  case "session/new": send({ id: m.id, result: { sessionId: "s-new" } }); break;
  case "session/prompt": send({ id: m.id, result: { stopReason: "end_turn" } }); break;
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`);
  const notes = async (cmd: string[], scan: boolean) => {
    const s = acpProvider("acp.scan", { label: "Fake", cmd, login: "" }).open(opts({ scan, access: "read", env: { ...process.env, FAKE_LOG: fake.log } }));
    const said: { text: string; once?: boolean }[] = [];
    const { sink } = recorder();
    sink.notice = (text: string, _k?: string, o?: { once?: boolean }) => void said.push({ text, once: o?.once });
    await s.turn("look", sink, new AbortController().signal);
    s.close();
    return said.filter((n) => /scan/.test(n.text));
  };
  const said = await notes([fake.file], true);
  assert.equal(said.length, 1);
  assert.match(said[0].text, /can't be kept off the web or from sending agents of its own, so this scan runs with them\.$/);
  assert.equal(said[0].once, true, "the runtime says it once a session");
  assert.deepEqual(await notes([fake.file], false), [], "not a scan");
});

// #15: a chatty command's output isn't copied again on every delta, and its row still shows the last 20,000 characters.
test("codex: a running command's row shows the tail of its output", async () => {
  const fake = script("codex", `
switch (m.method) {
  case "initialize": send({ id: m.id, result: {} }); break;
  case "thread/start": send({ id: m.id, result: { thread: { id: "t-1" } } }); break;
  case "turn/start": {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    const at = { threadId: "t-1", turnId: "turn-1" };
    send({ method: "item/started", params: { ...at, item: { id: "c1", type: "commandExecution", command: "make", status: "inProgress" } } });
    for (let i = 0; i < 3000; i++) send({ method: "item/commandExecution/outputDelta", params: { ...at, itemId: "c1", delta: String(i % 10).repeat(20) } });
    setTimeout(() => send({ method: "turn/completed", params: { threadId: "t-1", turn: { id: "turn-1", status: "completed" } } }), 600);
    break;
  }
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`);
  const s = new CodexServerSession(opts({ env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log } }));
  const { sink } = recorder();
  const shown: string[] = [];
  sink.tool = (u: { output?: string }) => void (u.output !== undefined && shown.push(u.output));
  await s.turn("go", sink, new AbortController().signal);
  await s.close();
  const all = Array.from({ length: 3000 }, (_, i) => String(i % 10).repeat(20)).join("");
  assert.ok(shown.length >= 1);
  assert.equal(shown.at(-1), all.slice(-20000));
});

// #16: Claude Code's commands are asked through the same stand-in a session is, and its wait is cleared.
test("claude: listing commands goes through sdk.query, with the project's settings, and closes what it opened", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-polish-claude-"));
  const bin = join(dir, "claude");
  writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
  const saved = sdk.query;
  let options: Record<string, unknown> = {};
  sdk.query = (({ options: o }: { options: Record<string, unknown> }) => ((options = o), { supportedCommands: async () => [{ name: "review", description: "Review it", argumentHint: "" }] })) as unknown as typeof sdk.query;
  try {
    const r = await claude.commands!({ PATH: "", LINER_BIN_CLAUDE: bin, CLAUDE_CONFIG_DIR: dir }, dir);
    assert.deepEqual(r.commands.map((c) => c.name), ["review"]);
  } finally {
    sdk.query = saved;
  }
  assert.deepEqual(options.settingSources, ["user", "project", "local"]);
  assert.equal(options.cwd, dir);
  assert.equal((options.abortController as AbortController).signal.aborted, true, "the stand-in Claude Code is let go");
});

// #18: a mode switch the agent never answers doesn't hold the next turn before it starts: the session reopens.
test("acp: a level change whose mode switch never lands reopens the session rather than waiting for good", async () => {
  const fake = script("agent", `
switch (m.method) {
  case "initialize": send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } }); break;
  case "session/new": send({ id: m.id, result: { sessionId: "s-new", modes: { currentModeId: "build", availableModes: [{ id: "build" }, { id: "plan" }] } } }); break;
  case "session/set_mode": break;
  case "session/prompt": send({ id: m.id, result: { stopReason: "end_turn" } }); break;
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`);
  const ms = SWITCH_MS;
  setSwitchMs(200);
  const s = acpProvider("acp.stall", { label: "Stall", cmd: [fake.file], login: "", modes: { read: "plan", edits: "build" } }).open(opts({ env: { ...process.env, FAKE_LOG: fake.log } }));
  try {
    await s.turn("hi", recorder().sink, new AbortController().signal);
    const at = Date.now();
    const r = await Promise.race([s.update!({ model: "default", effort: "medium", access: "read" }), tick(3000).then(() => "hung")]);
    assert.equal(r, false, "reopened at the new level");
    assert.ok(Date.now() - at < 1500);
    assert.equal(await s.setAccess!("edits"), true, "already in its mode for Edits");
    const mid = await Promise.race([s.setAccess!("read"), tick(3000).then(() => "hung")]);
    assert.match(String(mid), /didn't switch to this level's mode in time/);
  } finally {
    setSwitchMs(ms);
    s.close();
  }
});
