/*
  Who sent whom, against the real tools' shapes (claude 2.1.319, codex-cli 0.167.0): an agent in
  the background is a working row that can be stopped alone, goes on and ends on its row in the
  turn that sent it, however many turns later, and is written to disk as it changes how it stands,
  not at each step. Each test failed before its fix. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Item, ProviderInfo } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { agentReport, claude, sdk } from "../src/providers/claude.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { OpenOptions, Provider, ProviderSession, ToolUpdate, TurnSink, WakeTurn } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 300 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}

/* ---------- the runtime: an agent's row outlives its turn ---------- */

const info = (id: ProviderInfo["id"]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: [{ id: "claude-opus-5-5", label: "Opus", description: "" }], supports: { approvals: true, resume: true, effort: true, plan: true } });

/** A tool whose turn hands its sink out, so the test speaks for it after the turn too. */
function keeper(turn: (sink: TurnSink) => Promise<void> | void, stop: (taskId: string) => boolean = () => false) {
  const sinks: TurnSink[] = [];
  const stopped: string[] = [];
  const p: Provider = {
    id: "claude",
    detect: async () => info("claude"),
    open: (_o: OpenOptions) =>
      ({
        close: () => {},
        turn: async (_text: string, sink: TurnSink) => {
          sinks.push(sink);
          await turn(sink);
        },
        stopAgent: (taskId: string) => (stopped.push(taskId), stop(taskId)),
      }) as ProviderSession,
  };
  const saved = providers.claude;
  providers.claude = p;
  return { sinks, stopped, restore: () => (providers.claude = saved) };
}

function session(home = mkdtempSync(join(tmpdir(), "lc-fan-"))) {
  const store = new Store(home);
  if (!store.projects.length) store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-fan-dir-")), git: false, createdAt: Date.now() });
  if (!store.threads.length) store.putThread({ id: "t", projectId: "p", title: "Work", agent: "@claude:claude-opus-5-5", status: "idle", access: "full", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = [info("claude")];
  return { store, runtime, home };
}

const call = { key: "call-1", tool: "Agent", toolKind: "task" as const, title: "Explore: Find the parser" };
const agent = (extra: Partial<NonNullable<ToolUpdate["agent"]>> = {}): NonNullable<ToolUpdate["agent"]> => ({ name: "Explore", task: "Find the parser", taskId: "t1", steps: [], ...extra });
const rowsOf = (items: Item[]) => items.filter((x): x is Extract<Item, { kind: "tool" }> => x.kind === "tool");
/** How many times an item was written to the thread's log. */
const writes = (home: string, id: string) => readFileSync(join(home, "threads", "t.jsonl"), "utf8").split("\n").filter((l) => l.includes(`"id":"${id}"`)).length;

test("runtime: an agent in the background goes on and ends on its row, after its turn; nothing else of that turn changes", async () => {
  const k = keeper((sink) => {
    sink.tool({ key: "bash-1", tool: "Bash", toolKind: "exec", title: "Run ls", status: "done", output: "a" });
    sink.tool({ ...call, status: "running", agent: agent() });
    // Its call returns at once: it works on in the background.
    sink.tool({ ...call, status: "done", agent: agent({ background: true, state: "running" }) });
  });
  try {
    const { store, runtime } = session();
    await runtime.send("t", "find it");
    const sink = k.sinks[0];
    sink.tool({ ...call, status: "done", agent: agent({ background: true, state: "running", steps: [{ title: "Read noaa.ts", toolKind: "read", status: "done" }], now: "Read noaa.ts" }) });
    // A late word of anything else from that turn changes nothing, and makes no row.
    sink.tool({ key: "bash-1", tool: "Bash", toolKind: "exec", title: "Run ls", status: "failed", output: "late" });
    sink.tool({ key: "new-1", tool: "Bash", toolKind: "exec", title: "Run pwd", status: "running" });
    sink.tool({ key: "new-2", tool: "Agent", toolKind: "task", title: "Explore: else", status: "running", agent: agent({ taskId: "t2" }) });
    sink.tool({ ...call, status: "done", agent: agent({ background: true, state: "done", report: "Parsed in noaa.ts." }) });
    const rows = rowsOf(store.timeline("t"));
    assert.equal(rows.length, 2, "one row for the agent, however long it ran");
    const row = rows.find((r) => r.tool === "Agent")!;
    assert.equal(row.turn, 1);
    assert.equal(row.agent?.state, "done");
    assert.equal(row.agent?.report, "Parsed in noaa.ts.");
    assert.deepEqual(row.agent?.steps, [], "the end says its steps as they stand");
    assert.equal(rows.find((r) => r.tool === "Bash")?.output, "a");
  } finally {
    k.restore();
  }
});

test("runtime: an agent's row is written as it starts, changes how it stands and reports, not at each step", async () => {
  const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Read f${i}.ts`, toolKind: "read" as const, status: "done" as const }));
  const k = keeper((sink) => {
    sink.tool({ ...call, status: "running", agent: agent() });
    for (let i = 1; i <= 5; i++) sink.tool({ ...call, status: "running", agent: agent({ steps: steps(i), tokens: i * 100 }) });
    sink.tool({ ...call, status: "done", agent: agent({ background: true, state: "running", steps: steps(5) }) });
  });
  try {
    const { store, runtime, home } = session();
    await runtime.send("t", "find it");
    const id = rowsOf(store.timeline("t"))[0].id;
    assert.equal(writes(home, id), 2, "its start, and its call returning");
    for (let i = 6; i <= 30; i++) k.sinks[0].tool({ ...call, status: "done", agent: agent({ background: true, state: "running", steps: steps(i), tokens: i * 100 }) });
    assert.equal(writes(home, id), 2, "its steps in the background write nothing");
    assert.equal(rowsOf(store.timeline("t"))[0].agent?.steps?.length, 30, "though the window has them");
    k.sinks[0].tool({ ...call, status: "done", agent: agent({ background: true, state: "done", steps: steps(30), report: "Done." }) });
    assert.equal(writes(home, id), 3, "and its end");
    // Read back after a restart, it's as it ended.
    const again = new Store(home);
    const row = rowsOf(again.timeline("t"))[0];
    assert.equal(row.agent?.state, "done");
    assert.equal(row.agent?.steps?.length, 30);
  } finally {
    k.restore();
  }
});

test("runtime: Stop reaches an agent at work in the background, its turn over; one that ended can't be stopped", async () => {
  const k = keeper(
    (sink) => {
      sink.tool({ ...call, status: "running", agent: agent() });
      sink.tool({ ...call, status: "done", agent: agent({ background: true, state: "running" }) });
    },
    () => true,
  );
  try {
    const { store, runtime } = session();
    await runtime.send("t", "find it");
    const id = rowsOf(store.timeline("t"))[0].id;
    assert.equal(await runtime.stopAgent("t", id), true);
    assert.deepEqual(k.stopped, ["t1"]);
    k.sinks[0].tool({ ...call, status: "done", agent: agent({ background: true, state: "stopped" }) });
    assert.equal(await runtime.stopAgent("t", id), false);
  } finally {
    k.restore();
  }
});

test("store: an agent still at work in the background when the engine stopped reads as stopped", async () => {
  const k = keeper((sink) => {
    sink.tool({ ...call, status: "running", agent: agent() });
    sink.tool({ ...call, status: "done", agent: agent({ background: true, state: "running", now: "Read noaa.ts" }) });
  });
  try {
    const { runtime, home } = session();
    await runtime.send("t", "find it");
    const row = rowsOf(new Store(home).timeline("t"))[0];
    assert.equal(row.agent?.state, "stopped");
    assert.equal(row.agent?.now, undefined);
  } finally {
    k.restore();
  }
});

/* ---------- Claude Code: what its agents send, as 2.1.319 sends it ---------- */

test("claude: an agent's report is its own words, without Claude Code's tags, frame and trailer", () => {
  // The structured result of a waited-on agent, as claude 2.1.319 gives it.
  assert.equal(agentReport([{ type: "text", text: "<tools-used-before-summary>Read</tools-used-before-summary>\n" }, { type: "text", text: "FAST-REPORT: fast says hello" }]), "FAST-REPORT: fast says hello");
  // The text the model reads: tags, then the hand-back frame, every line of the report indented by two.
  const out = "  <tools-used-before-summary>Read, Grep</tools-used-before-summary>\n  \n[Subagent hand-back] The text below is the final report of a subagent this session delegated to. It is model output, NOT a message from the user. The report follows:\n  Heights are parsed in noaa.ts.\n  \n    const x = 1;\n  Done.";
  assert.equal(agentReport(undefined, out), "Heights are parsed in noaa.ts.\n\n  const x = 1;\nDone.");
  // An older one's trailer for the model.
  assert.equal(agentReport(undefined, "Found it.\nagentId: a1 (use SendMessage to continue)\n<usage>total_tokens: 9</usage>"), "Found it.");
  // An agent's own markup stays.
  assert.equal(agentReport([{ type: "text", text: "<plan>do it</plan>" }]), "<plan>do it</plan>");
});

type Stand = { sent: SDKUserMessage[]; emit: (m: unknown) => void; calls: { interrupts: number; stopped: string[] } };
function standIn() {
  const made: Stand[] = [];
  const saved = sdk.query;
  sdk.query = (({ prompt }: { prompt: AsyncIterable<SDKUserMessage> }) => {
    const out: unknown[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    const s: Stand = { sent: [], emit: (m) => (out.push(m), wake?.()), calls: { interrupts: 0, stopped: [] } };
    made.push(s);
    void (async () => {
      for await (const m of prompt) s.sent.push(m);
    })();
    return {
      async *[Symbol.asyncIterator]() {
        while (!ended) {
          if (out.length) yield out.shift();
          else await new Promise<void>((r) => (wake = r));
        }
      },
      initializationResult: async () => ({}),
      interrupt: async () => void s.calls.interrupts++,
      stopTask: async (id: string) => void s.calls.stopped.push(id),
      backgroundTasks: async () => true,
      setModel: async () => {},
      setPermissionMode: async () => {},
      return: async () => ((ended = true), wake?.(), { done: true, value: undefined }),
    };
  }) as unknown as typeof sdk.query;
  return { made, restore: () => (sdk.query = saved) };
}

function recorder() {
  const r = { tools: [] as ToolUpdate[], notices: [] as string[], text: "" };
  const sink = {
    text: (d: string) => void (r.text += d), reasoning: () => {}, tool: (u: ToolUpdate) => void r.tools.push(u), plan: () => {},
    approve: async () => ({ allow: true }), ask: async () => null, propose: async () => ({ approve: true }),
    usage: () => {}, session: () => {}, notice: (t: string) => void r.notices.push(t), error: () => {}, limited: () => {},
  } as unknown as TurnSink;
  return { r, sink };
}

const opts = (extra: Partial<OpenOptions> = {}): OpenOptions => ({ cwd: "/tmp", model: "claude-opus-5-5", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: "" }, ...extra });
const result = (extra: Record<string, unknown> = {}) => ({ type: "result", subtype: "success", is_error: false, result: "", num_turns: 1, duration_ms: 1, duration_api_ms: 1, stop_reason: null, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: {}, permission_denials: [], uuid: "r", session_id: "s", ...extra });
/** An Agent call the way 2.1.319 runs it by default: started in the background, its call returning at once. */
const launch = (q: Stand, n: number) => {
  q.emit({ type: "assistant", parent_tool_use_id: null, uuid: `a${n}`, session_id: "s", message: { id: `m${n}`, model: "claude-opus-5-5", content: [{ type: "tool_use", id: `call-${n}`, name: "Agent", input: { subagent_type: "Explore", description: `Look ${n}`, prompt: `Look at part ${n}.` } }] } });
  q.emit({ type: "system", subtype: "task_started", task_id: `t${n}`, tool_use_id: `call-${n}`, description: `Look ${n}`, subagent_type: "Explore", is_backgrounded: true, task_type: "local_agent", uuid: `x${n}`, session_id: "s" });
  q.emit({ type: "user", parent_tool_use_id: null, session_id: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `call-${n}`, content: [{ type: "text", text: `Async agent launched successfully.\nagentId: t${n}` }] }] }, tool_use_result: { isAsync: true, status: "async_launched", agentId: `t${n}`, description: `Look ${n}`, resolvedModel: "claude-haiku-5-5", prompt: "" } });
};
const kidStep = (q: Stand, n: number) => {
  q.emit({ type: "assistant", parent_tool_use_id: `call-${n}`, uuid: `k${n}`, session_id: "s", message: { id: `km${n}`, model: "claude-haiku-5-5", content: [{ type: "tool_use", id: `r${n}`, name: "Read", input: { file_path: "/tmp/hello.txt" } }] } });
  q.emit({ type: "user", parent_tool_use_id: `call-${n}`, session_id: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `r${n}`, content: "hello" }] } });
};
const ended = (n: number, status: string, summary: string) => ({ type: "system", subtype: "task_notification", task_id: `t${n}`, tool_use_id: `call-${n}`, status, output_file: "", summary, usage: { total_tokens: 1017, tool_uses: 1, duration_ms: 5000 }, uuid: `e${n}`, session_id: "s" });

test("claude: an agent in the background is a working row that goes on and ends on its row after its turn, with no row in the turn it wakes", async () => {
  const { made, restore } = standIn();
  try {
    const wakes: WakeTurn[] = [];
    const s = claude.open(opts({ wake: (w) => void wakes.push(w) }));
    const { r, sink } = recorder();
    const turn = s.turn("look", sink, new AbortController().signal);
    await until(() => made[0]?.sent.length === 1, "your message went");
    const q = made[0];
    launch(q, 1);
    q.emit(result({ user_message_uuids: [q.sent[0].uuid] }));
    await turn;
    const launched = r.tools.at(-1)!;
    assert.equal(launched.status, "done", "its call returned");
    assert.equal(launched.agent?.state, "running", "it's still at work");
    assert.equal(launched.agent?.background, true);
    assert.equal(launched.agent?.taskId, "t1");
    assert.equal(launched.agent?.model, "claude:claude-haiku-5-5");
    // No turn runs: its steps, its last words and its end still go on its row, in the turn that sent it.
    kidStep(q, 1);
    q.emit({ type: "assistant", parent_tool_use_id: "call-1", uuid: "k1b", session_id: "s", message: { id: "km1b", model: "claude-haiku-5-5", content: [{ type: "text", text: "Part 1 says hello, and nothing else." }] } });
    q.emit(ended(1, "completed", "Part 1 says hello"));
    await until(() => r.tools.at(-1)?.agent?.state === "done", "it ends on its row");
    const end = r.tools.at(-1)!;
    assert.equal(end.key, "call-1");
    assert.equal(end.agent?.report, "Part 1 says hello, and nothing else.", "its own last words, whole");
    assert.equal(end.agent?.tokens, 1017);
    assert.deepEqual(end.agent?.steps?.map((x) => [x.title, x.status]), [["Read hello.txt", "done"]]);
    // Claude Code wakes to say so: that turn has no row of the agent, nor a line repeating its report.
    q.emit({ type: "assistant", parent_tool_use_id: null, uuid: "w1", session_id: "s", message: { id: "wm1", model: "claude-opus-5-5", content: [{ type: "text", text: "It said hello." }] } });
    q.emit(result({ origin: { kind: "task-notification" } }));
    await until(() => wakes.length === 1, "a wake is offered");
    const woke = recorder();
    await wakes[0].run(woke.sink, new AbortController().signal);
    assert.deepEqual(woke.r.tools, []);
    assert.deepEqual(woke.r.notices, []);
    assert.match(woke.r.text, /It said hello/);
    s.close();
  } finally {
    restore();
  }
});

test("claude: Stop on one agent in the background is its own task's stop, never an interrupt, and its sibling goes on", async () => {
  const { made, restore } = standIn();
  try {
    const wakes: WakeTurn[] = [];
    const s = claude.open(opts({ wake: (w) => void wakes.push(w) }));
    const { r, sink } = recorder();
    const turn = s.turn("look", sink, new AbortController().signal);
    await until(() => made[0]?.sent.length === 1, "your message went");
    const q = made[0];
    launch(q, 1);
    launch(q, 2);
    q.emit(result({ user_message_uuids: [q.sent[0].uuid] }));
    await turn;
    assert.equal(await s.stopAgent!("t1"), true);
    assert.deepEqual(q.calls.stopped, ["t1"]);
    // Claude Code says it stopped (its summary is only what it was sent to do), and wakes to tell the model.
    q.emit(ended(1, "stopped", "Look 1"));
    q.emit({ type: "assistant", parent_tool_use_id: null, uuid: "w1", session_id: "s", message: { id: "wm1", model: "claude-opus-5-5", content: [{ type: "text", text: "The first look was stopped." }] } });
    await until(() => wakes.length === 1, "the model hears it was stopped");
    assert.equal(q.calls.interrupts, 0, "an interrupt would end its sibling too");
    assert.equal(wakes[0].why, "a background task stopped");
    const one = r.tools.filter((u) => u.key === "call-1").at(-1)!;
    assert.equal(one.agent?.state, "stopped");
    assert.equal(one.agent?.report, undefined, "no report: it didn't send one");
    // The other one works on, and ends on its own row.
    kidStep(q, 2);
    q.emit(ended(2, "completed", "Part 2 is fine"));
    await until(() => r.tools.filter((u) => u.key === "call-2").at(-1)?.agent?.state === "done", "its sibling ends");
    assert.equal(r.tools.filter((u) => u.key === "call-2").at(-1)?.agent?.report, "Part 2 is fine");
    s.close();
  } finally {
    restore();
  }
});

test("claude: one that ends before its call says it launched still ends; and closing the session ends what's left as stopped", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { r, sink } = recorder();
    const turn = s.turn("look", sink, new AbortController().signal);
    await until(() => made[0]?.sent.length === 1, "your message went");
    const q = made[0];
    q.emit({ type: "assistant", parent_tool_use_id: null, uuid: "a1", session_id: "s", message: { id: "m1", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "call-1", name: "Agent", input: { description: "Quick", prompt: "Be quick." } }] } });
    q.emit({ type: "system", subtype: "task_started", task_id: "t1", tool_use_id: "call-1", description: "Quick", is_backgrounded: true, task_type: "local_agent", uuid: "x1", session_id: "s" });
    q.emit(ended(1, "completed", "Quick and done"));
    q.emit({ type: "user", parent_tool_use_id: null, session_id: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "Async agent launched successfully." }] }, tool_use_result: { isAsync: true, status: "async_launched", agentId: "t1" } });
    launch(q, 2);
    q.emit(result({ user_message_uuids: [q.sent[0].uuid] }));
    await turn;
    assert.equal(r.tools.filter((u) => u.key === "call-1").at(-1)?.agent?.state, "done");
    assert.equal(r.tools.filter((u) => u.key === "call-1").at(-1)?.agent?.report, "Quick and done");
    assert.equal(r.tools.filter((u) => u.key === "call-2").at(-1)?.agent?.state, "running");
    s.close();
    assert.equal(r.tools.filter((u) => u.key === "call-2").at(-1)?.agent?.state, "stopped", "it went with the process");
  } finally {
    restore();
  }
});

test("runtime: a session whose turn is over while agents it sent work says so on the session, for the Wall, the sidebar and quitting", async () => {
  const second = { key: "call-2", tool: "Agent", toolKind: "task" as const, title: "Explore: Read the tests" };
  const k = keeper((sink) => {
    sink.tool({ ...call, status: "done", agent: agent({ background: true, state: "running" }) });
    sink.tool({ ...second, status: "done", agent: agent({ taskId: "t2", background: true, state: "running" }) });
  });
  try {
    const { store, runtime, home } = session();
    await runtime.send("t", "find it");
    await until(() => store.thread("t").status !== "running", "the turn ends");
    assert.equal(store.thread("t").agentsAtWork, 2, "both still at work count after their turn");
    k.sinks[0].tool({ ...call, status: "done", agent: agent({ background: true, state: "done", report: "found it" }) });
    assert.equal(store.thread("t").agentsAtWork, 1, "one has ended");
    // At work when the engine stopped: it went with the tool's process, so a new engine counts none.
    store.flush();
    assert.equal(new Store(home).thread("t").agentsAtWork, undefined, "a new engine starts with none at work");
    k.sinks[0].tool({ ...second, status: "done", agent: agent({ taskId: "t2", background: true, state: "stopped" }) });
    assert.equal(store.thread("t").agentsAtWork, undefined, "none once both have ended");
  } finally {
    k.restore();
  }
});
