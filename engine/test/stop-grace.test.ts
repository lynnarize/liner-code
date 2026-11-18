/*
  Stop's give-up, as a real-tool run before 0.2.9 found it (each tool's processes frozen with SIGSTOP during a model stream, then
  Stop): Claude Code that never answers the interrupt is ended at its own wait, with all below it, and the next message resumes
  in a new process; Codex's turn ends only once Codex answers the interrupt, so one that never does is closed by the runtime's
  grace and resumed; an ACP agent's close ends what left its process group; the notice names the tool, not an endpoint; a
  finished Codex command keeps the tail of its output only. Stand-ins and small Node scripts play the tools. Run with
  `node --test test/stop-grace.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderInfo } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { RUN_ENV } from "../src/exec.ts";
import { acpProvider } from "../src/providers/acp.ts";
import { claude, sdk, waits } from "../src/providers/claude.ts";
import { CodexServerSession } from "../src/providers/codex-server.ts";
import type { OpenOptions, Provider, TurnSink } from "../src/providers/types.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";
import { noLeaks } from "./leaks.ts";

noLeaks();

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string, ms = 5000) {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await tick(20);
  assert.ok(ok(), what);
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const opts = (extra: Partial<OpenOptions> = {}) => ({ cwd: tmpdir(), model: "default", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: process.env.PATH ?? "" }, ...extra }) as OpenOptions;
function recorder() {
  const r = { text: "", notices: [] as string[], errors: [] as string[], sessions: [] as string[], tools: [] as { key: string; status?: string; output?: string }[] };
  const sink = {
    text: (d: string) => void (r.text += d), reasoning: () => {}, tool: (u: { key: string; status?: string; output?: string }) => void r.tools.push(u), plan: () => {},
    approve: async () => ({ allow: true }), ask: async () => null, propose: async () => ({ approve: true }),
    usage: () => {}, session: (id: string) => void r.sessions.push(id), notice: (m: string) => void r.notices.push(m), error: (m: string) => void r.errors.push(m), limited: () => {},
  } as unknown as TurnSink;
  return { r, sink };
}
/** A Node script at `name` that reads JSON lines and runs `on` for each (`m`), logging each to FAKE_LOG. */
function script(name: string, on: string) {
  const dir = mkdtempSync(join(tmpdir(), "lc-grace-"));
  const file = join(dir, name);
  writeFileSync(file, `#!/usr/bin/env node
const fs = require("fs");
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ pid: process.pid, ...m }) + "\\n");
    ${on}
  }
});
`, { mode: 0o755 });
  const log = join(dir, "log.jsonl");
  writeFileSync(log, "");
  const read = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { pid: number; method?: string; id?: number; params?: Record<string, unknown> });
  return { file, log, dir, read };
}

// ————— 1. Claude Code that never answers the interrupt —————

type Stand = { sent: SDKUserMessage[]; options: Record<string, unknown>; returned: boolean; pids: number[] };
/**
  The SDK's query() replaced: each query is a stand-in Claude Code with a real process (and a process of its own below it, in a
  group of its own), said to the session as the SDK says it spawned one. `answers`: whether its interrupt is answered.
*/
function standIn(answers: (n: number) => boolean) {
  const made: Stand[] = [];
  const saved = sdk.query;
  sdk.query = (({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Record<string, unknown> }) => {
    const n = made.length;
    const out: unknown[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    const emit = (m: unknown) => (out.push(m), wake?.());
    const s: Stand = { sent: [], options, returned: false, pids: [] };
    made.push(s);
    // Its process, with one below it that left its group: both carry its environment, as Claude Code's would.
    const kid = `const c = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: true }); console.log(c.pid); setInterval(() => {}, 1000)`;
    const proc = spawn(process.execPath, ["-e", kid], { env: options.env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "ignore"] });
    s.pids.push(proc.pid!);
    proc.stdout.setEncoding("utf8");
    proc.stdout.once("data", (d: string) => s.pids.push(Number(d.trim())));
    (options.onProcessSpawned as ((pid: number) => void) | undefined)?.(proc.pid!);
    void (async () => {
      for await (const m of prompt) {
        s.sent.push(m);
        emit({ type: "system", subtype: "init", session_id: "sess-1", uuid: `i${n}` });
        // The first hangs mid-answer; the next answers.
        if (n > 0) {
          emit({ type: "stream_event", parent_tool_use_id: null, uuid: "a", session_id: "sess-1", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
          emit({ type: "stream_event", parent_tool_use_id: null, uuid: "a", session_id: "sess-1", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Back." } } });
          emit({ type: "result", subtype: "success", is_error: false, result: "", num_turns: 1, duration_ms: 1, duration_api_ms: 1, stop_reason: null, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: {}, permission_denials: [], uuid: "r", session_id: "sess-1", user_message_uuids: [m.uuid] });
        }
      }
    })();
    return {
      async *[Symbol.asyncIterator]() {
        while (!ended) {
          if (out.length) yield out.shift();
          else await new Promise<void>((r) => (wake = r));
        }
      },
      initializationResult: async () => ({}),
      interrupt: () => (answers(n) ? Promise.resolve() : new Promise<void>(() => {})),
      stopTask: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      return: async () => {
        s.returned = true;
        ended = true;
        wake?.();
        // The SDK's own close ends a process that reads its input; this one never would.
        return { done: true, value: undefined };
      },
    };
  }) as unknown as typeof sdk.query;
  return {
    made,
    restore: () => {
      sdk.query = saved;
      for (const s of made) for (const pid of s.pids) if (alive(pid)) process.kill(pid, "SIGKILL");
    },
  };
}

test("claude: Stop that Claude Code never answers ends its process and what is below it, says so, and the next message resumes in a new one", async () => {
  const stand = standIn((n) => n > 0);
  const was = waits.stop;
  waits.stop = 150;
  try {
    const s = claude.open(opts());
    const { r, sink } = recorder();
    const ac = new AbortController();
    const first = s.turn("the stopped one", sink, ac.signal);
    await until(() => stand.made[0]?.sent.length === 1 && stand.made[0].pids.length === 2 && r.sessions.length === 1, "the message went, and its process runs");
    const [pid, kid] = stand.made[0].pids;
    // Frozen: it hears nothing, a SIGTERM included, until it's continued.
    process.kill(pid, "SIGSTOP");
    process.kill(kid, "SIGSTOP");
    const at = Date.now();
    ac.abort();
    await first;
    assert.ok(Date.now() - at < 1500, `the turn ended ${Date.now() - at} ms after Stop`);
    assert.deepEqual(r.notices, ["Claude Code hadn't stopped 1 second after Stop, so Liner Code ended it. It picks up again on your next message."]);
    // A message sent meanwhile waits for the old process to be gone, then goes to a new one, which resumes the session.
    const next = recorder();
    await s.turn("again", next.sink, new AbortController().signal);
    assert.equal(alive(pid), false, "the frozen process is gone");
    assert.equal(alive(kid), false, "and what it started, though it left its group");
    assert.equal(stand.made[0].returned, true, "the SDK's query is let go");
    assert.equal(stand.made.length, 2, "a new process");
    assert.equal(stand.made[1].options.resume, "sess-1", "on the same session");
    assert.notEqual((stand.made[1].options.env as Record<string, string>)[RUN_ENV], (stand.made[0].options.env as Record<string, string>)[RUN_ENV], "each process with its own marker");
    assert.deepEqual(stand.made[0].sent.length, 1, "nothing more went to the old one");
    assert.equal(stand.made[1].sent.length, 1, "and the stopped message never goes again");
    assert.match(JSON.stringify(stand.made[1].sent[0].message.content), /again/);
    assert.equal(next.r.text, "Back.");
    await s.close();
  } finally {
    waits.stop = was;
    stand.restore();
  }
});

test("claude: Stop that Claude Code answers but doesn't end in time keeps its process, as before", async () => {
  const stand = standIn(() => true);
  const was = waits.stop;
  waits.stop = 100;
  try {
    const s = claude.open(opts());
    const { r, sink } = recorder();
    const ac = new AbortController();
    const first = s.turn("go", sink, ac.signal);
    await until(() => stand.made[0]?.sent.length === 1 && r.sessions.length === 1, "the message went");
    ac.abort();
    await first;
    assert.deepEqual(r.notices, [], "nothing to say");
    assert.equal(stand.made[0].returned, false, "its process is kept");
    await s.close();
  } finally {
    waits.stop = was;
    stand.restore();
  }
});

// ————— 2. Codex: the turn ends once Codex answers the interrupt —————

/** A Codex app server: the first thread's turn runs until it's interrupted; FAKE_FREEZE: it freezes (SIGSTOP) as it's asked. A thread resumed answers at once. */
const CODEX = `
switch (m.method) {
  case "initialize": send({ id: m.id, result: {} }); break;
  case "thread/start": send({ id: m.id, result: { thread: { id: "t-1" } } }); break;
  case "thread/resume": global.resumed = true; send({ id: m.id, result: { thread: { id: m.params.threadId } } }); break;
  case "turn/start":
    send({ id: m.id, result: { turn: { id: "turn-" + process.pid } } });
    if (global.resumed) setTimeout(() => { send({ method: "item/agentMessage/delta", params: { threadId: "t-1", turnId: "turn-" + process.pid, itemId: "a", delta: "Back." } }); send({ method: "turn/completed", params: { threadId: "t-1", turn: { id: "turn-" + process.pid, status: "completed" } } }); }, 20);
    break;
  case "turn/interrupt":
    if (process.env.FAKE_FREEZE) process.kill(process.pid, "SIGSTOP");
    send({ id: m.id, result: {} });
    send({ method: "turn/completed", params: { threadId: "t-1", turn: { id: m.params.turnId, status: "interrupted" } } });
    break;
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`;

test("codex: Stop ends the turn as soon as Codex answers the interrupt", async () => {
  const fake = script("codex", CODEX);
  const s = new CodexServerSession(opts({ env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log } }));
  const { sink } = recorder();
  const ac = new AbortController();
  const turn = s.turn("go", sink, ac.signal);
  await until(() => fake.read().some((m) => m.method === "turn/start"), "the turn started");
  await tick(50);
  const at = Date.now();
  ac.abort();
  await turn;
  assert.ok(Date.now() - at < 1000, `ended ${Date.now() - at} ms after Stop`);
  assert.ok(fake.read().some((m) => m.method === "turn/interrupt"));
  await s.close();
});

test("codex: a frozen app server keeps the turn until the runtime's grace closes it; the notice names Codex, and the next message resumes the thread in a new one", async () => {
  const fake = script("codex", CODEX);
  const saved = providers.codex;
  const codexHere: Provider = { id: "codex", detect: saved.detect, open: (o) => new CodexServerSession({ ...o, env: { ...o.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log, FAKE_FREEZE: "1" } }) };
  providers.codex = codexHere;
  const home = mkdtempSync(join(tmpdir(), "lc-grace-home-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-grace-dir-")), git: false, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Work", agent: "@codex:gpt-6-luna", status: "idle", access: "full", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
  const runtime = new Runtime(store, process.env);
  // Its detected name is "Codex CLI"; the notice says the tool's own.
  runtime.providerInfo = [{ id: "codex", label: "Codex CLI", available: true, adapter: true, login: "", models: [{ id: "gpt-6-luna", label: "gpt-6-luna", description: "" }], supports: { approvals: true, resume: true, effort: true, plan: true } } as ProviderInfo];
  runtime.doingMs = 0;
  runtime.stopGraceMs = 300;
  try {
    const first = runtime.send("t", "go");
    await until(() => fake.read().some((m) => m.method === "turn/start"), "the turn started");
    const pid = fake.read().find((m) => m.method === "turn/start")!.pid;
    await tick(50);
    runtime.stop("t");
    await first;
    await until(() => store.thread("t").status !== "running", "the turn ended");
    const notices = store.timeline("t").flatMap((x) => (x.kind === "notice" ? [x.text] : []));
    assert.ok(notices.includes("Codex hadn't stopped 1 second after Stop, so Liner Code ended it. It picks up again on your next message."), notices.join(" | "));
    await until(() => !alive(pid), "the frozen app server is gone");
    await runtime.send("t", "again");
    await until(() => store.thread("t").status === "done", "the next message ran");
    const resumed = fake.read().find((m) => m.method === "thread/resume");
    assert.ok(resumed && resumed.pid !== pid, "in a new process");
    assert.equal(resumed?.params?.threadId, "t-1", "on the same thread");
    assert.ok(store.timeline("t").some((x) => x.kind === "text" && /Back\./.test(x.text)), "which answered");
  } finally {
    providers.codex = saved;
    await runtime.shutdown();
  }
});

test("codex: a finished command keeps only the end of a long output, as while it ran", async () => {
  const long = "x".repeat(30000) + "y".repeat(20000);
  const fake = script("codex", `
switch (m.method) {
  case "initialize": send({ id: m.id, result: {} }); break;
  case "thread/start": send({ id: m.id, result: { thread: { id: "t-1" } } }); break;
  case "turn/start": {
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    const at = { threadId: "t-1", turnId: "turn-1" };
    send({ method: "item/completed", params: { ...at, item: { id: "c1", type: "commandExecution", command: "make", status: "completed", exitCode: 0, aggregatedOutput: ${JSON.stringify(long)} } } });
    send({ method: "turn/completed", params: { threadId: "t-1", turn: { id: "turn-1", status: "completed" } } });
    break;
  }
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`);
  const s = new CodexServerSession(opts({ env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log } }));
  const { r, sink } = recorder();
  await s.turn("go", sink, new AbortController().signal);
  await s.close();
  const row = r.tools.filter((u) => u.key === "c1").at(-1);
  assert.equal(row?.status, "done");
  assert.equal(row?.output, long.slice(-20000));
});

// ————— 3. An ACP agent's close ends what left its group —————

test("acp: a close ends the agent's process and what it started in a group of its own, frozen ones too", async () => {
  const fake = script("agent", `
switch (m.method) {
  case "initialize": send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } }); break;
  case "session/new": send({ id: m.id, result: { sessionId: "s1" } }); break;
  case "session/prompt": {
    // As opencode acp starts opencode serve: a process of its own group.
    const c = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: true });
    fs.writeFileSync(process.env.FAKE_PIDS, JSON.stringify([process.pid, c.pid]));
    send({ id: m.id, result: { stopReason: "end_turn" } });
    break;
  }
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`);
  const pids = join(fake.dir, "pids.json");
  const s = acpProvider("acp.fake", { label: "Fake", cmd: [fake.file], login: "" }).open(opts({ env: { ...process.env, FAKE_LOG: fake.log, FAKE_PIDS: pids } }));
  let both: number[] = [];
  try {
    await s.turn("go", recorder().sink, new AbortController().signal);
    both = JSON.parse(readFileSync(pids, "utf8")) as number[];
    for (const pid of both) process.kill(pid, "SIGSTOP");
    await s.close();
    await until(() => both.every((pid) => !alive(pid)), "the agent and what it started are gone");
  } finally {
    for (const pid of both) if (alive(pid)) process.kill(pid, "SIGKILL");
  }
});

// ————— 4. The notice names the tool —————

test("Stop's notice names the tool an API endpoint runs on, not the endpoint", async () => {
  const id = "opencode.fake-chat" as ProviderInfo["id"];
  let started = false;
  const hang: Provider = { id, detect: async () => ({}) as ProviderInfo, open: () => ({ close: () => {}, turn: () => ((started = true), new Promise<void>(() => {})) }) };
  const saved = providers[id];
  providers[id] = hang;
  const home = mkdtempSync(join(tmpdir(), "lc-grace-home-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-grace-dir-")), git: false, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Work", agent: `@${id}:fakemodel`, status: "idle", access: "full", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = [{ id, label: "FakeChat", available: true, adapter: true, login: "", models: [{ id: "fakemodel", label: "fakemodel", description: "" }], supports: { approvals: true, resume: true, effort: true, plan: true } } as ProviderInfo];
  runtime.doingMs = 0;
  runtime.stopGraceMs = 50;
  try {
    const first = runtime.send("t", "go");
    await until(() => started, "the tool's turn runs");
    runtime.stop("t");
    await first;
    await until(() => store.thread("t").status !== "running", "the turn ended");
    const notices = store.timeline("t").flatMap((x) => (x.kind === "notice" ? [x.text] : []));
    assert.ok(notices.some((t) => t.startsWith("OpenCode hadn't stopped")), notices.join(" | "));
    assert.ok(!notices.some((t) => t.includes("FakeChat")));
  } finally {
    if (saved) providers[id] = saved;
    else delete providers[id];
  }
});
