/*
  The tools' own answer to "would closing it now end or lose anything?" (ProviderSession.settled), which the idle close
  (Runtime.idleCheck) asks before it closes a session: Claude Code's against a stand-in for the SDK's query(), as
  drivers.test.ts uses, and the Codex app server's against a fake app server, as audit-codex-acp.test.ts uses. Run with
  `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { claude, sdk } from "../src/providers/claude.ts";
import { CodexServerSession } from "../src/providers/codex-server.ts";
import type { OpenOptions, ProviderSession, TurnSink } from "../src/providers/types.ts";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 300 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}

type Stand = { sent: SDKUserMessage[]; emit: (m: unknown) => void; options: Record<string, unknown>; closed: number };
/** Stands in for the SDK's query(), as drivers.test.ts does. */
function standIn() {
  const made: Stand[] = [];
  const saved = sdk.query;
  sdk.query = (({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Record<string, unknown> }) => {
    const out: unknown[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    const s: Stand = { sent: [], emit: (m) => (out.push(m), wake?.()), options, closed: 0 };
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
      stopTask: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      return: async () => ((ended = true), s.closed++, wake?.(), { done: true, value: undefined }),
    };
  }) as unknown as typeof sdk.query;
  return { made, restore: () => (sdk.query = saved) };
}
const sink = (): TurnSink => ({ text: () => {}, reasoning: () => {}, tool: () => {}, plan: () => {}, approve: async () => ({ allow: true }), ask: async () => null, propose: async () => ({ approve: true }), usage: () => {}, session: () => {}, notice: () => {}, error: () => {}, limited: () => {} }) as TurnSink;
const opts = (extra: Partial<OpenOptions> = {}): OpenOptions => ({ cwd: tmpdir(), model: "claude-opus-5-5", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: "" }, ...extra });
const init = { type: "system", subtype: "init", session_id: "s-1", uuid: "i", tools: [], mcp_servers: [], model: "m", permissionMode: "default", slash_commands: [], apiKeySource: "user", cwd: "/tmp", output_style: "default" };
const result = (mine?: string) => ({ type: "result", subtype: "success", is_error: false, result: "", num_turns: 1, duration_ms: 1, duration_api_ms: 1, stop_reason: null, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: {}, permission_denials: [], uuid: "r", session_id: "s-1", ...(mine ? { user_message_uuids: [mine] } : {}) });
const toolUse = (name: string) => ({ type: "assistant", parent_tool_use_id: null, uuid: `a-${name}`, session_id: "s-1", message: { id: `m-${name}`, model: "m", role: "assistant", content: [{ type: "tool_use", id: `tu-${name}`, name, input: {} }], usage: { input_tokens: 1, output_tokens: 1 } } });
const bg = (id: string) => ({ type: "system", subtype: "task_started", task_id: id, tool_use_id: `tu-${id}`, description: "npm run dev", task_type: "local_bash", is_backgrounded: true, uuid: "x", session_id: "s-1" });
const note = (id: string) => ({ type: "system", subtype: "task_notification", task_id: id, status: "failed", output_file: "", summary: "npm run dev failed", uuid: "y", session_id: "s-1" });

/** One turn of `s` on stand-in `n`: init, whatever `during` emits, then its result. */
async function turn(made: Stand[], s: ProviderSession, n: number, during: unknown[] = [], o: { stop?: boolean } = {}) {
  const stop = new AbortController();
  const before = made[n]?.sent.length ?? 0;
  const going = s.turn("go", sink(), stop.signal);
  await until(() => (made[n]?.sent.length ?? 0) > before, "the message went");
  const mine = made[n].sent.at(-1)!.uuid!;
  made[n].emit(init);
  for (const m of during) made[n].emit(m);
  await tick(20);
  if (o.stop) {
    stop.abort();
    await going;
    return mine;
  }
  made[n].emit(result(mine));
  await going;
  return mine;
}

test("claude: settled between plain turns, and not before its session id is saved", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    assert.equal(await s.settled!(), false, "nothing to resume yet");
    await turn(made, s, 0);
    assert.equal(await s.settled!(), true);
    s.close();
  } finally {
    restore();
  }
});

test("claude: not settled with a task on the roster, nor with its notification held for the next turn, until a turn has taken it", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    await turn(made, s, 0, [bg("dev")]);
    assert.equal(await s.settled!(), false, "a background shell runs");
    // It ends with no turn running: Claude Code says so, and the word waits for the next turn.
    made[0].emit(note("dev"));
    await tick(20);
    assert.equal(await s.settled!(), false, "closing now would lose \"npm run dev failed\"");
    await turn(made, s, 0);
    assert.equal(await s.settled!(), true, "the next turn took it");
    s.close();
  } finally {
    restore();
  }
});

test("claude: not settled while a stopped turn still runs in Claude Code (draining)", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    await turn(made, s, 0);
    await turn(made, s, 0, [], { stop: true });
    assert.equal(await s.settled!(), false, "Claude Code is still on the turn you stopped");
    made[0].emit(result());
    await tick(20);
    assert.equal(await s.settled!(), true, "its result came");
    s.close();
  } finally {
    restore();
  }
});

test("claude: not settled once a plan you approved put it at Auto, which the thread doesn't hold", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts({ access: "read" }));
    const going = s.turn("plan it", sink(), new AbortController().signal);
    await until(() => made[0]?.sent.length === 1, "the message went");
    made[0].emit(init);
    await tick(10);
    const ask = made[0].options.canUseTool as (n: string, i: Record<string, unknown>, o: Record<string, unknown>) => Promise<{ behavior: string }>;
    assert.equal((await ask("ExitPlanMode", { plan: "1. Do it" }, { signal: new AbortController().signal, toolUseID: "p" })).behavior, "allow");
    made[0].emit(result(made[0].sent[0].uuid));
    await going;
    assert.equal(await s.settled!(), false, "reopened, it would plan again");
    s.close();
  } finally {
    restore();
  }
});

test("claude: never settled once it has set something to wake it or watch (ScheduleWakeup, CronCreate, Monitor)", async () => {
  for (const name of ["ScheduleWakeup", "CronCreate", "Monitor"]) {
    const { made, restore } = standIn();
    try {
      const s = claude.open(opts());
      await turn(made, s, 0, [toolUse(name)]);
      assert.equal(await s.settled!(), false, name);
      await turn(made, s, 0);
      assert.equal(await s.settled!(), false, `${name}, still after another turn`);
      s.close();
    } finally {
      restore();
    }
  }
});

test("claude: close waits for the query's own end, and is bounded", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    await turn(made, s, 0);
    const t0 = Date.now();
    await s.close();
    assert.equal(made[0].closed, 1);
    assert.ok(Date.now() - t0 < 1000);
  } finally {
    restore();
  }
});

/* ------------------------------------------- Codex app server ------------------------------------------- */

function codex(on: string) {
  const dir = mkdtempSync(join(tmpdir(), "lc-settled-"));
  const file = join(dir, "codex");
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
    fs.appendFileSync(process.env.FAKE_LOG, line + "\\n");
    const bg = fs.existsSync(process.env.FAKE_BG) ? fs.readFileSync(process.env.FAKE_BG, "utf8") : "none";
    ${on}
    if (m.method === "initialize") send({ id: m.id, result: {} });
    else if (m.method === "thread/start") send({ id: m.id, result: { thread: { id: "root" } } });
    else if (m.method === "thread/backgroundTerminals/list") {
      if (bg === "one") send({ id: m.id, result: { data: [{ itemId: "c0", processId: "7" }], nextCursor: null } });
      else if (bg === "error") send({ id: m.id, error: { code: -32603, message: "no" } });
      else if (bg === "silent") {}
      else send({ id: m.id, result: { data: [], nextCursor: null } });
    }
    else if (m.method === "turn/start") { send({ id: m.id, result: { turn: { id: "turn-1" } } }); setTimeout(() => send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } }), 10); }
    else if (m.id !== undefined && m.method) send({ id: m.id, result: {} });
  }
});
`, { mode: 0o755 });
  const log = join(dir, "log.jsonl");
  const flag = join(dir, "bg");
  writeFileSync(log, "");
  const s = new CodexServerSession({ cwd: dir, model: "default", effort: "medium", access: "edits", soul: "", guard: true, env: { ...process.env, LINER_BIN_CODEX: file, FAKE_LOG: log, FAKE_BG: flag } });
  return { s, set: (v: string) => writeFileSync(flag, v), read: () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { method?: string }) };
}

test("codex: settled between plain turns; not with a command running, with background terminals listed, or when the list errs or doesn't come", async () => {
  const { s, set, read } = codex("");
  try {
    assert.equal(await s.settled!(), false, "no thread yet");
    await s.turn("hi", sink(), new AbortController().signal);
    assert.equal(await s.settled!(), true);
    set("one");
    assert.equal(await s.settled!(), false, "a dev server an earlier turn left");
    set("error");
    assert.equal(await s.settled!(), false, "a list that errs can't tell");
    set("silent");
    s.listWait = 100;
    assert.equal(await s.settled!(), false, "nor one that doesn't come");
    const pending = (s as unknown as { server: { pending: Map<unknown, unknown> } }).server.pending;
    assert.equal(pending.size, 0, "the late request is forgotten");
    set("none");
    assert.equal(await s.settled!(), true);
    assert.ok(read().some((m) => m.method === "thread/backgroundTerminals/list"));
  } finally {
    await s.close();
  }
});

test("codex: not settled while a command it started still runs; its close waits for the process to be gone", async () => {
  const { s } = codex(`if (m.method === "turn/start") { send({ id: m.id, result: { turn: { id: "turn-1" } } }); send({ method: "item/started", params: { threadId: "root", turnId: "turn-1", item: { type: "commandExecution", id: "c1", processId: "5", command: "sleep 300" } } }); send({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn-1", status: "completed" } } }); continue; }`);
  try {
    await s.turn("start it", sink(), new AbortController().signal);
    assert.equal(await s.settled!(), false, "a command runs");
  } finally {
    const child = (s as unknown as { server: { child: { pid: number } | null } }).server.child;
    const pid = child?.pid;
    await s.close();
    assert.ok(pid);
    assert.throws(() => process.kill(pid!, 0), "the app server is gone once close settles");
  }
});
