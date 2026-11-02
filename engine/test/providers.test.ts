/*
  Agent tools that stop, die or never answer: a turn fails or ends rather than hangs, Stop keeps a
  lost session to say next turn, and Read only reaches the agent's own mode. The agents are small
  Node scripts speaking ACP or Codex's app server. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acpProvider } from "../src/providers/acp.ts";
import { CodexServerSession, codexAsk } from "../src/providers/codex-server.ts";
import { ResumeFailed, type OpenOptions, type TurnSink } from "../src/providers/types.ts";
import { demo } from "../src/providers/demo.ts";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 300 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}
const opts = (extra: Partial<OpenOptions> = {}) => ({ cwd: "/tmp", model: "default", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: "" }, ...extra }) as OpenOptions;
function recorder() {
  const r = { text: "", errors: [] as string[], sessions: [] as string[] };
  const sink = {
    text: (d: string) => void (r.text += d), reasoning: () => {}, tool: () => {}, plan: () => {},
    approve: async () => ({ allow: true }), ask: async () => null, propose: async () => ({ approve: true }),
    usage: () => {}, session: (id: string) => void r.sessions.push(id), notice: () => {}, error: (m: string) => void r.errors.push(m), limited: () => {},
  } as unknown as TurnSink;
  return { r, sink };
}
function script(name: string, on: string) {
  const dir = mkdtempSync(join(tmpdir(), "lc-verify-"));
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

const ACP = `
switch (m.method) {
  case "initialize":
    if (mode === "mute") break;
    send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } }); break;
  case "session/load":
    if (mode === "crash") process.exit(3);
    if (mode === "slowlost") { setTimeout(() => send({ id: m.id, error: { code: -1, message: "session not found" } }), 300); break; }
    send({ id: m.id, error: { code: -1, message: "session not found" } }); break;
  case "session/new": send({ id: m.id, result: { sessionId: "s-new", modes: { currentModeId: "build", availableModes: [{ id: "build" }, { id: "plan" }] } } }); break;
  case "session/prompt": send({ id: m.id, result: { stopReason: "end_turn" } }); break;
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`;

test("acp: an agent that dies loading its session fails the turn, it doesn't hang", async () => {
  const fake = script("agent", ACP);
  const p = acpProvider("acp.fake", { label: "Fake", cmd: [fake.file], login: "" });
  const s = p.open(opts({ resume: "s-old", env: { ...process.env, FAKE_LOG: fake.log, FAKE_MODE: "crash" } }));
  const r = await Promise.race([s.turn("hi", recorder().sink, new AbortController().signal).then(() => "ok", (e: Error) => `rejected: ${e.message}`), tick(3000).then(() => "hung")]);
  s.close();
  assert.match(String(r), /^rejected/);
});

test("acp: Stop ends a turn whose agent never answers as it starts", async () => {
  const fake = script("agent", ACP);
  const p = acpProvider("acp.fake", { label: "Fake", cmd: [fake.file], login: "" });
  const s = p.open(opts({ env: { ...process.env, FAKE_LOG: fake.log, FAKE_MODE: "mute" } }));
  const stop = new AbortController();
  const turn = s.turn("hi", recorder().sink, stop.signal);
  await until(() => fake.read().some((m) => m.method === "initialize"), "it was asked to start");
  stop.abort();
  const r = await Promise.race([turn.then(() => "ok"), tick(2000).then(() => "hung")]);
  s.close();
  assert.equal(r, "ok");
});

test("acp: Stop while starting keeps a lost session to say next turn", async () => {
  const fake = script("agent", ACP);
  const p = acpProvider("acp.fake", { label: "Fake", cmd: [fake.file], login: "" });
  const s = p.open(opts({ resume: "s-old", env: { ...process.env, FAKE_LOG: fake.log, FAKE_MODE: "slowlost" } }));
  const stop = new AbortController();
  const turn = s.turn("hi", recorder().sink, stop.signal);
  await until(() => fake.read().some((m) => m.method === "session/load"), "it loads");
  stop.abort();
  await turn;
  await assert.rejects(s.turn("again", recorder().sink, new AbortController().signal), (e) => e instanceof ResumeFailed);
  await s.turn("again", recorder().sink, new AbortController().signal);
  s.close();
});

test("acp: Read only and back switches the agent's own mode", async () => {
  const fake = script("agent", ACP);
  const p = acpProvider("acp.fake", { label: "Fake", cmd: [fake.file], login: "" });
  const s = p.open(opts({ access: "read", env: { ...process.env, FAKE_LOG: fake.log } }));
  await s.turn("hi", recorder().sink, new AbortController().signal);
  assert.ok(await s.update!({ model: "default", effort: "medium", access: "edits" }));
  assert.ok(await s.update!({ model: "default", effort: "medium", access: "full" }));
  assert.ok(await s.update!({ model: "default", effort: "medium", access: "read" }));
  await tick(200);
  s.close();
  const modes = fake.read().filter((m) => m.method === "session/set_mode").map((m) => m.params.modeId);
  assert.deepEqual(modes, ["plan", "build", "plan"]);
});

const CODEX = `
switch (m.method) {
  case "initialize": if (mode !== "mute") send({ id: m.id, result: {} }); break;
  case "thread/resume": setTimeout(() => send({ id: m.id, error: { code: -1, message: "no rollout found for thread" } }), 300); break;
  case "thread/start": send({ id: m.id, result: { thread: { id: "new-thread" } } }); break;
  case "turn/start": send({ id: m.id, result: { turn: { id: "turn-1" } } }); setTimeout(() => send({ method: "turn/completed", params: { turn: { id: "turn-1", status: "completed" } } }), 10); break;
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`;

test("codex: Stop while starting keeps a lost thread to say next turn", async () => {
  const fake = script("codex", CODEX);
  const s = new CodexServerSession(opts({ resume: "t-1", env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log } }));
  const stop = new AbortController();
  const turn = s.turn("hi", recorder().sink, stop.signal);
  await until(() => fake.read().some((m) => m.method === "thread/resume"), "it resumes");
  stop.abort();
  await turn;
  await assert.rejects(s.turn("again", recorder().sink, new AbortController().signal), (e) => e instanceof ResumeFailed);
  await s.turn("again", recorder().sink, new AbortController().signal);
  s.close();
});

test("codex: an ask of an app server that never starts times out", async () => {
  const fake = script("codex", CODEX);
  const at = Date.now();
  await assert.rejects(codexAsk({ ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log, FAKE_MODE: "mute" }, "/tmp", "account/rateLimits/read", {}, 300), /in time/);
  assert.ok(Date.now() - at < 2000);
});

test("demo: Stop on the planner's question ends the turn then", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-demo-"));
  const s = demo.open(opts({ cwd: dir, planning: true }));
  const stop = new AbortController();
  const { r, sink } = recorder();
  sink.ask = (_q, sig) => new Promise((_, no) => { if (sig.aborted) no(new Error("stopped")); sig.addEventListener("abort", () => no(new Error("stopped"))); });
  const turn = s.turn("fix the tide time", sink, stop.signal);
  await tick(2500);
  stop.abort();
  const at = Date.now();
  await turn.catch(() => {});
  assert.ok(Date.now() - at < 500, `ended ${Date.now() - at}ms after Stop`);
  assert.ok(!r.text.includes("<plan"), "no plan written after Stop");
});

test("codex: an app server that dies as it opens fails the turn once, not twice", async () => {
  const fake = script("codex", `if (m.method === "initialize") { process.stderr.write("bad config\\n"); process.exit(1); }`);
  const s = new CodexServerSession(opts({ env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log } }));
  const { r, sink } = recorder();
  await assert.rejects(s.turn("hi", sink, new AbortController().signal), /bad config/);
  s.close();
  assert.deepEqual(r.errors, [], "the turn's own failure says it; the sink isn't told again");
});
