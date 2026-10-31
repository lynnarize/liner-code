/*
  The drivers and what the runtime does with them: a turn Claude Code begins by itself when
  background work finishes shows as a turn of its own (and doesn't end yours early), Stop reaches
  that work, a steer goes in now after the subagents move to the background, a session that can't
  be resumed starts again with the conversation so far, a steer the tool couldn't take goes next,
  attachments go to the model, results that failed say why, and sessions carry on by themselves
  after a restart or when a limit resets. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKResultMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Item, PlanEntry, ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { applyTaskTool, claude, resultError, sdk, signedOut, withFiles, type TaskList } from "../src/providers/claude.ts";
import { pdfPages } from "../src/providers/attachments.ts";
import { ResumeFailed, type OpenOptions, type Provider, type ProviderSession, type TurnSink, type WakeTurn } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id === "claude" ? "Claude Code" : id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const ready = [info("claude", ["claude-opus-5-5"])];
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 300 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}

function session(extra: Partial<Thread> = {}, home = mkdtempSync(join(tmpdir(), "lc-drivers-"))) {
  const dir = mkdtempSync(join(tmpdir(), "lc-drivers-dir-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Work", agent: "forge", status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = ready;
  return { store, runtime, home };
}

type Fake = Partial<ProviderSession> & { turn: ProviderSession["turn"] };
/** Stands in for Claude Code: each open gets a session from `make`, which sees the options. */
function fakeClaude(make: (o: OpenOptions) => Fake) {
  const opened: OpenOptions[] = [];
  const p: Provider = {
    id: "claude",
    detect: async () => info("claude", []),
    open: (o) => {
      opened.push(o);
      return { close() {}, ...make(o) } as ProviderSession;
    },
  };
  const saved = providers.claude;
  providers.claude = p;
  return { opened, restore: () => (providers.claude = saved) };
}

const turnsOf = (items: Item[]) => items.filter((x): x is Extract<Item, { kind: "turn" }> => x.kind === "turn");

test("wake: a turn the tool begins by itself shows as a turn of its own, with a line saying why", async () => {
  const { opened, restore } = fakeClaude(() => ({ turn: async (_t, sink) => sink.text("Started the build in the background.") }));
  try {
    const { store, runtime } = session();
    await runtime.send("t", "build it");
    let ran = false;
    opened[0].wake!({
      why: "a background task finished",
      pending: () => !ran,
      cancel: () => {},
      run: async (sink) => {
        ran = true;
        sink.text("The build passed.");
      },
    });
    await until(() => !runtime.isRunning("t") && turnsOf(store.timeline("t")).length === 2, "the wake runs as turn 2");
    const items = store.timeline("t");
    assert.equal(turnsOf(items)[1].status, "done");
    assert.ok(items.some((x) => x.kind === "notice" && x.turn === 2 && /carries on by itself: a background task finished/.test(x.text)));
    assert.ok(items.some((x) => x.kind === "text" && x.turn === 2 && x.text === "The build passed."));
    assert.ok(!items.some((x) => x.kind === "user" && x.turn === 2), "no message of yours in it");
  } finally {
    restore();
  }
});

test("wake: one that comes while a turn runs waits for it, then goes before what you queued", async () => {
  let release = () => {};
  const texts: string[] = [];
  const { opened, restore } = fakeClaude(() => ({
    turn: async (text, _sink, signal) => {
      texts.push(text);
      if (texts.length === 1) await new Promise<void>((r) => ((release = r), signal.addEventListener("abort", () => r())));
    },
  }));
  try {
    const { store, runtime } = session();
    const first = runtime.send("t", "first");
    await until(() => texts.length === 1, "the first turn starts");
    await runtime.send("t", "later");
    let woke = 0;
    let pending = true;
    opened[0].wake!({ pending: () => pending, cancel: () => {}, run: async (sink) => ((pending = false), woke++, sink.text("about the task")) });
    await tick(30);
    assert.equal(woke, 0, "not beside the running turn");
    release();
    await first;
    await until(() => texts.length === 2 && !runtime.isRunning("t"), "the queue goes after the wake");
    assert.equal(woke, 1);
    const turns = turnsOf(store.timeline("t"));
    assert.equal(turns.length, 3);
    assert.ok(store.timeline("t").some((x) => x.kind === "text" && x.turn === 2 && x.text === "about the task"), "turn 2 is the wake");
    assert.ok(store.timeline("t").some((x) => x.kind === "user" && x.turn === 3 && x.text === "later"), "turn 3 is what you queued");
  } finally {
    restore();
  }
});

test("wake: after Stop, one that comes before the stopped work ends is stopped too, and your queue waits", async () => {
  let wake: OpenOptions["wake"];
  const { restore } = fakeClaude((o) => {
    wake = o.wake;
    return { turn: (_t, _s, signal) => new Promise<void>((r) => signal.addEventListener("abort", () => setTimeout(r, 20))) };
  });
  try {
    const { store, runtime } = session();
    const first = runtime.send("t", "first");
    await until(() => runtime.isRunning("t") && Boolean(wake), "the turn runs");
    await runtime.send("t", "later");
    runtime.stop("t");
    let cancelled = 0;
    let ran = 0;
    wake!({ pending: () => true, cancel: () => cancelled++, run: async () => void ran++ });
    await first;
    await tick(30);
    assert.equal(cancelled, 1);
    assert.equal(ran, 0);
    assert.equal(turnsOf(store.timeline("t")).length, 1);
    assert.equal(store.thread("t").queue?.length, 1, "what you queued is still yours");
  } finally {
    restore();
  }
});

test("resume: a session the tool can't find any more starts again with the conversation so far", async () => {
  const texts: string[] = [];
  const { restore } = fakeClaude((o) => {
    let lost = Boolean(o.resume);
    return {
      turn: async (text, sink) => {
        texts.push(text);
        if (lost) {
          lost = false;
          throw new ResumeFailed("gone");
        }
        sink.text("On it.");
      },
    };
  });
  try {
    const { store, runtime } = session({ providerSession: "claude:old", turns: 1 });
    store.putItem("t", { kind: "user", id: "u1", turn: 1, at: 1, text: "make a todo app" });
    store.putItem("t", { kind: "text", id: "a1", turn: 1, at: 2, text: "Made it.", streaming: false });
    await runtime.send("t", "add a delete button");
    assert.equal(texts.length, 2);
    assert.match(texts[1], /This conversation started before this session[\s\S]*make a todo app[\s\S]*add a delete button/);
    assert.ok(store.timeline("t").some((x) => x.kind === "notice" && /couldn't pick up its own session/.test(x.text)));
    assert.equal(turnsOf(store.timeline("t")).at(-1)?.status, "done");
  } finally {
    restore();
  }
});

test("steer: one the tool couldn't take goes next from the queue; one it took shows as a steer", async () => {
  let release = () => {};
  const texts: string[] = [];
  let take = false;
  const { restore } = fakeClaude(() => ({
    turn: async (text) => {
      texts.push(text);
      if (texts.length === 1) await new Promise<void>((r) => (release = r));
    },
    steer: async () => take,
  }));
  try {
    const { store, runtime } = session();
    const first = runtime.send("t", "first");
    await until(() => texts.length === 1, "the turn starts");
    await runtime.send("t", "lost steer", "steer");
    assert.deepEqual(store.thread("t").queue?.map((q) => q.text), ["lost steer"]);
    take = true;
    await runtime.send("t", "taken steer", "steer");
    assert.ok(store.timeline("t").some((x) => x.kind === "user" && x.steer && x.text === "taken steer"));
    release();
    await first;
    await until(() => texts.length === 2 && !runtime.isRunning("t"), "the failed steer goes next");
    assert.equal(texts[1], "lost steer");
  } finally {
    restore();
  }
});

test("attachments: the tool gets the saved files, the prompt names them, and your message shows them as files", async () => {
  const seen: { text: string; files?: string[] }[] = [];
  const { restore } = fakeClaude(() => ({ turn: async (text, _s, _sig, files) => void seen.push({ text, files }) }));
  try {
    const { store, runtime } = session();
    await runtime.send("t", "what's in this?", "queue", undefined, ["/tmp/a/shot.png"]);
    assert.deepEqual(seen[0].files, ["/tmp/a/shot.png"]);
    assert.match(seen[0].text, /what's in this\?\n\nI attached: \/tmp\/a\/shot\.png/);
    const you = store.timeline("t").find((x) => x.kind === "user");
    assert.ok(you?.kind === "user" && you.text === "what's in this?" && you.files?.[0] === "/tmp/a/shot.png");
  } finally {
    restore();
  }
});

test("prompt cache: a Claude turn says when its cache likely runs out, an hour on a plan and five minutes on a key", async () => {
  const { restore } = fakeClaude(() => ({ turn: async (_t, sink) => sink.text("ok") }));
  try {
    const { store, runtime } = session();
    await runtime.send("t", "hi");
    const hour = (store.thread("t").cacheUntil ?? 0) - Date.now();
    assert.ok(hour > 55 * 60_000 && hour <= 60 * 60_000, "an hour on a plan");
    store.setSettings({ claudeBilling: "key" });
    runtime.keys.set("anthropic", "sk-test");
    await runtime.send("t", "again");
    const five = (store.thread("t").cacheUntil ?? 0) - Date.now();
    assert.ok(five > 4 * 60_000 && five <= 5 * 60_000, "five minutes on a key");
  } finally {
    restore();
  }
});

test("notices: a keyed notice is one line kept up to date", async () => {
  const { restore } = fakeClaude(() => ({
    turn: async (_t, sink) => {
      sink.notice("Claude is overloaded, retrying (1 of 10)", "r");
      sink.notice("Claude is overloaded, retrying (2 of 10)", "r");
      sink.text("done");
    },
  }));
  try {
    const { store, runtime } = session();
    await runtime.send("t", "hi");
    const notes = store.timeline("t").filter((x) => x.kind === "notice");
    assert.deepEqual(notes.map((x) => x.kind === "notice" && x.text), ["Claude is overloaded, retrying (2 of 10)"]);
  } finally {
    restore();
  }
});

test("after a restart: a turn cut off mid-way carries on by itself, at most three times in five minutes", async () => {
  const texts: string[] = [];
  const { restore } = fakeClaude(() => ({ turn: async (text, sink) => void (texts.push(text), sink.text("carrying on")) }));
  try {
    const home = mkdtempSync(join(tmpdir(), "lc-drivers-"));
    const before = session({ status: "running", turns: 1, providerSession: "claude:s1" }, home);
    before.store.putItem("t", { kind: "user", id: "u1", turn: 1, at: 1, text: "build it" });
    before.store.putItem("t", { kind: "turn", id: "m1", turn: 1, at: 1, agent: "forge", model: "claude:claude-opus-5-5", status: "running" });
    before.store.flush();
    before.runtime.shutdown();
    // The engine starts again: the store reads the turn as stopped, and nobody stopped it.
    const store = new Store(home);
    const runtime = new Runtime(store, process.env);
    runtime.providerInfo = ready;
    assert.deepEqual(runtime.continueAfterRestart(), ["t"]);
    await until(() => texts.length === 1 && !runtime.isRunning("t"), "it carries on");
    assert.match(texts[0], /^Continue where you left off\./);
    assert.ok(store.timeline("t").some((x) => x.kind === "notice" && /carries on where it left off/.test(x.text)));
    assert.equal(turnsOf(store.timeline("t")).at(-1)?.status, "done");

    // A turn you stopped yourself stays stopped.
    store.putItem("t", { kind: "turn", id: "m3", turn: 3, at: Date.now(), agent: "forge", model: "claude:claude-opus-5-5", status: "stopped" });
    store.putItem("t", { kind: "notice", id: "n3", turn: 3, at: Date.now(), text: "You stopped this turn." });
    store.patchThread("t", { turns: 3, status: "idle", unread: true });
    assert.deepEqual(runtime.continueAfterRestart(), []);

    // Three times in five minutes already: it waits for you.
    for (const i of [1, 2]) store.putItem("t", { kind: "notice", id: `c${i}`, turn: 2, at: Date.now(), text: "Liner Code stopped while this turn ran, so it carries on where it left off." });
    store.putItem("t", { kind: "turn", id: "m4", turn: 4, at: Date.now(), agent: "forge", model: "claude:claude-opus-5-5", status: "stopped" });
    store.patchThread("t", { turns: 4, status: "idle", unread: true });
    assert.deepEqual(runtime.continueAfterRestart(), []);
    assert.ok(store.timeline("t").some((x) => x.kind === "notice" && x.turn === 4 && /three times in five minutes/.test(x.text)));

    // Turned off in Settings: nothing carries on.
    store.setSettings({ continueAfterRestart: false });
    assert.deepEqual(runtime.continueAfterRestart(), []);
  } finally {
    restore();
  }
});

test("limits: with the setting on, a limited session carries on once its window has reopened", async () => {
  const texts: string[] = [];
  const { restore } = fakeClaude(() => ({ turn: async (text) => void texts.push(text) }));
  try {
    const now = Date.now();
    const until0 = now - 2 * 60_000;
    const { store, runtime } = session({ status: "limited", turns: 1, limit: { message: "used up", until: until0, provider: "claude" } });
    store.putItem("t", { kind: "limit", id: "l1", turn: 1, at: until0 - 60 * 60_000, message: "used up", until: until0, provider: "claude" });
    runtime.resumeLimited(now);
    await tick(20);
    assert.equal(texts.length, 0, "off unless you turn it on");
    store.setSettings({ resumeAtReset: true });
    runtime.resumeLimited(now);
    await until(() => texts.length === 1 && !runtime.isRunning("t"), "it carries on");
    assert.equal(texts[0], "Continue where you left off.");
    assert.ok(store.timeline("t").some((x) => x.kind === "notice" && /usage window reopened/.test(x.text)));
    runtime.resumeLimited(now);
    await tick(20);
    assert.equal(texts.length, 1, "once per limit");
  } finally {
    restore();
  }
});

// ————— Claude Code's driver, against a stand-in for the SDK's query —————

type Stand = { sent: SDKUserMessage[]; emit: (m: unknown) => void; calls: { interrupts: number; stopped: string[]; backgrounded: string[] }; options: Record<string, unknown> };
/** Replaces the SDK's query(): each query is a stand-in Claude Code the test speaks for. `init` says how opening it goes. */
function standIn(init: (n: number) => Promise<unknown> = async () => ({})) {
  const made: Stand[] = [];
  const saved = sdk.query;
  sdk.query = (({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Record<string, unknown> }) => {
    const out: unknown[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    const s: Stand = { sent: [], emit: (m) => (out.push(m), wake?.()), calls: { interrupts: 0, stopped: [], backgrounded: [] }, options };
    made.push(s);
    const opening = init(made.length);
    opening.catch(() => {});
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
      initializationResult: () => opening,
      interrupt: async () => void s.calls.interrupts++,
      stopTask: async (id: string) => void s.calls.stopped.push(id),
      backgroundTasks: async (id: string) => (s.calls.backgrounded.push(id), true),
      setModel: async () => {},
      setPermissionMode: async () => {},
      return: async () => ((ended = true), wake?.(), { done: true, value: undefined }),
    };
  }) as unknown as typeof sdk.query;
  return { made, restore: () => (sdk.query = saved) };
}

/** A sink that writes down what it's told. */
function recorder() {
  const r = { text: "", notices: [] as { text: string; key?: string }[], plans: [] as PlanEntry[][], errors: [] as string[], limits: [] as { message: string; until?: number }[], heard: 0, sessions: [] as string[] };
  const sink: TurnSink = {
    text: (d) => void (r.text += d),
    reasoning: () => {},
    tool: () => {},
    plan: (e) => void r.plans.push(e),
    approve: async () => ({ allow: true }),
    ask: async () => null,
    propose: async () => ({ approve: true }),
    usage: () => {},
    session: (id) => void r.sessions.push(id),
    notice: (text, key) => void r.notices.push({ text, key }),
    error: (m) => void r.errors.push(m),
    limited: (message, until) => void r.limits.push({ message, until }),
    heard: () => void r.heard++,
  };
  return { r, sink };
}

const opts = (extra: Partial<OpenOptions> = {}): OpenOptions => ({ cwd: "/tmp", model: "claude-opus-5-5", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: "" }, ...extra });
const text = (uuid: string, t: string) => [
  { type: "stream_event", parent_tool_use_id: null, uuid, session_id: "s", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
  { type: "stream_event", parent_tool_use_id: null, uuid, session_id: "s", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } } },
];
const result = (extra: Record<string, unknown> = {}) => ({ type: "result", subtype: "success", is_error: false, result: "", num_turns: 1, duration_ms: 1, duration_api_ms: 1, stop_reason: null, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: {}, permission_denials: [], uuid: "r", session_id: "s", ...extra });

test("claude: a result from a turn Claude Code began itself doesn't end yours; your own result does", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { r, sink } = recorder();
    let over = false;
    const turn = s.turn("hello", sink, new AbortController().signal).then(() => (over = true));
    await until(() => made[0]?.sent.length === 1, "your message went");
    const mine = made[0].sent[0].uuid!;
    made[0].emit(result({ origin: { kind: "task-notification" }, num_turns: 2 }));
    await tick(20);
    assert.equal(over, false, "the background work's result isn't yours");
    for (const m of text("a1", "Hi!")) made[0].emit(m);
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    assert.equal(r.text, "Hi!");
    s.close();
  } finally {
    restore();
  }
});

test("claude: background work that finishes after the turn becomes a turn of its own", async () => {
  const { made, restore } = standIn();
  try {
    const wakes: WakeTurn[] = [];
    const s = claude.open(opts({ wake: (w) => void wakes.push(w) }));
    const { sink } = recorder();
    const turn = s.turn("run the tests in the background", sink, new AbortController().signal);
    await until(() => made[0]?.sent.length === 1, "your message went");
    made[0].emit({ type: "system", subtype: "task_started", task_id: "b1", tool_use_id: "tu1", description: "npm test", task_type: "local_bash", is_backgrounded: true, uuid: "x", session_id: "s" });
    made[0].emit(result({ user_message_uuids: [made[0].sent[0].uuid] }));
    await turn;
    // Later, with no turn running: the task finishes, and Claude Code answers about it.
    made[0].emit({ type: "system", subtype: "task_notification", task_id: "b1", status: "completed", output_file: "", summary: "npm test passed", uuid: "y", session_id: "s" });
    await tick(20);
    assert.equal(wakes.length, 0, "a notification alone isn't a turn yet");
    for (const m of text("w1", "All 12 tests pass.")) made[0].emit(m);
    await until(() => wakes.length === 1, "its first words offer a turn");
    assert.equal(wakes[0].why, "a background task finished");
    const { r, sink: sink2 } = recorder();
    const woke = wakes[0].run(sink2, new AbortController().signal);
    made[0].emit(result({ origin: { kind: "task-notification" } }));
    await woke;
    assert.equal(r.text, "All 12 tests pass.");
    assert.ok(r.notices.some((n) => n.text === "npm test passed"));
    assert.equal(wakes[0].pending(), false);
    s.close();
  } finally {
    restore();
  }
});

test("claude: Stop reaches background work, and Claude Code waking to report it stays unseen", async () => {
  const { made, restore } = standIn();
  try {
    const wakes: WakeTurn[] = [];
    const s = claude.open(opts({ wake: (w) => void wakes.push(w) }));
    const { sink } = recorder();
    const stop = new AbortController();
    const turn = s.turn("start the dev server", sink, stop.signal);
    await until(() => made[0]?.sent.length === 1, "your message went");
    made[0].emit({ type: "system", subtype: "task_started", task_id: "dev", tool_use_id: "tu1", description: "npm run dev", task_type: "local_bash", is_backgrounded: true, uuid: "x", session_id: "s" });
    await tick(10);
    stop.abort();
    await tick(10);
    assert.ok(made[0].calls.interrupts >= 1);
    assert.deepEqual(made[0].calls.stopped, ["dev"]);
    made[0].emit(result({ user_message_uuids: [made[0].sent[0].uuid], terminal_reason: "aborted_tools" }));
    await turn;
    made[0].emit({ type: "system", subtype: "task_notification", task_id: "dev", status: "stopped", output_file: "", summary: "stopped", uuid: "y", session_id: "s" });
    for (const m of text("w1", "The dev server stopped.")) made[0].emit(m);
    await tick(20);
    assert.equal(wakes.length, 0, "no turn about the work you stopped");
    s.close();
  } finally {
    restore();
  }
});

test("claude: a steer moves running subagents to the background, then goes in now", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { sink } = recorder();
    const turn = s.turn("review the repo", sink, new AbortController().signal);
    await until(() => made[0]?.sent.length === 1, "your message went");
    made[0].emit({ type: "system", subtype: "task_started", task_id: "a1", tool_use_id: "agent-call", description: "Explore", task_type: "local_agent", uuid: "x", session_id: "s" });
    await tick(10);
    assert.equal(await s.steer!("only the src folder"), true);
    assert.deepEqual(made[0].calls.backgrounded, ["agent-call"]);
    await until(() => made[0].sent.length === 2, "the steer went");
    const steer = made[0].sent[1];
    assert.equal(steer.priority, "now");
    // The steer cut the step short: the turn waits for the steer's own result.
    made[0].emit(result({ user_message_uuids: [made[0].sent[0].uuid], terminal_reason: "aborted_streaming" }));
    let over = false;
    void turn.then(() => (over = true));
    await tick(20);
    assert.equal(over, false);
    made[0].emit(result({ user_message_uuids: [steer.uuid] }));
    await turn;
    s.close();
  } finally {
    restore();
  }
});

test("claude: a session it can't resume says so before your message goes, and the next turn starts a new one", async () => {
  const { made, restore } = standIn(async (n) => {
    if (n === 1) throw new Error("Claude Code returned an error result: No conversation found with session ID: old");
    return {};
  });
  try {
    const s = claude.open(opts({ resume: "old" }));
    const { sink } = recorder();
    await assert.rejects(s.turn("hi", sink, new AbortController().signal), (e) => e instanceof ResumeFailed);
    assert.equal(made[0].sent.length, 0, "nothing was sent to the lost session");
    const turn = s.turn("hi again", sink, new AbortController().signal);
    await until(() => made[1]?.sent.length === 1, "a new session takes it");
    assert.equal(made[1].options.resume, undefined);
    made[1].emit(result({ user_message_uuids: [made[1].sent[0].uuid] }));
    await turn;
    s.close();
  } finally {
    restore();
  }
});

test("claude: task tools, retries, compaction and a blocked answer's limit reach the sink", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { r, sink } = recorder();
    const turn = s.turn("plan it", sink, new AbortController().signal);
    await until(() => made[0]?.sent.length === 1, "your message went");
    const q = made[0];
    q.emit({ type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, retry_delay_ms: 1, error_status: 529, error: "overloaded", uuid: "x", session_id: "s" });
    q.emit({ type: "system", subtype: "api_retry", attempt: 2, max_retries: 10, retry_delay_ms: 1, error_status: 529, error: "overloaded", uuid: "x", session_id: "s" });
    q.emit({ type: "assistant", parent_tool_use_id: null, uuid: "a", session_id: "s", message: { id: "m1", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "c1", name: "TaskCreate", input: { subject: "Write tests", description: "" } }] } });
    q.emit({ type: "user", parent_tool_use_id: null, session_id: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "Task #1 created successfully: Write tests" }] }, tool_use_result: { task: { id: "1", subject: "Write tests" } } });
    q.emit({ type: "assistant", parent_tool_use_id: null, uuid: "b", session_id: "s", message: { id: "m2", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "c2", name: "TaskUpdate", input: { taskId: "1", status: "in_progress" } }] } });
    q.emit({ type: "user", parent_tool_use_id: null, session_id: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "c2", content: "Updated task #1 status" }] }, tool_use_result: { success: true, taskId: "1", updatedFields: ["status"] } });
    q.emit({ type: "system", subtype: "status", status: "compacting", uuid: "x", session_id: "s" });
    q.emit({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 150000, post_tokens: 12000 }, uuid: "x", session_id: "s" });
    q.emit({ type: "assistant", parent_tool_use_id: null, uuid: "c", session_id: "s", error: "rate_limit", api_error_params: { rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1900000000 } }, message: { id: "m3", model: "<synthetic>", content: [{ type: "text", text: "limit" }] } });
    q.emit(result({ user_message_uuids: [q.sent[0].uuid], is_error: true, result: "You've hit your limit" }));
    await turn;
    const retries = r.notices.filter((n) => /overloaded/.test(n.text));
    assert.equal(retries.length, 2);
    assert.equal(retries[0].key, retries[1].key, "one line, counting up");
    assert.match(retries[1].text, /Claude is overloaded, retrying \(2 of 10\)/);
    assert.deepEqual(r.plans.at(-1), [{ title: "Write tests", status: "in_progress" }]);
    const compact = r.notices.filter((n) => /ompact/.test(n.text));
    assert.equal(compact[0].key, compact[1].key);
    assert.match(compact[1].text, /from 150k to 12k tokens/);
    assert.deepEqual(r.limits, [{ message: "Your Claude plan's 5-hour limit is used up.", until: 1900000000 * 1000 }]);
    assert.ok(r.heard > 0);
    s.close();
  } finally {
    restore();
  }
});

test("claude: a result that failed always says why", () => {
  const base = result() as unknown as SDKResultMessage;
  assert.equal(resultError(base), undefined);
  assert.match(resultError({ ...base, terminal_reason: "prompt_too_long" } as SDKResultMessage)!, /context window/);
  assert.match(resultError({ ...base, api_error_status: 529, is_error: true } as SDKResultMessage)!, /overloaded/);
  assert.equal(resultError({ ...base, terminal_reason: "aborted_streaming", is_error: true } as SDKResultMessage), undefined);
  assert.equal(resultError({ ...base, subtype: "error_during_execution", errors: ["[ede_diagnostic] x", "The tool broke."] } as unknown as SDKResultMessage), "The tool broke.");
  assert.match(resultError({ ...base, is_error: true, terminal_reason: "api_error", result: "API Error: 500 boom" } as SDKResultMessage)!, /API Error: 500 boom/);
  assert.match(signedOut("/Users/x/.claude-work"), /claude auth login with CLAUDE_CONFIG_DIR=\/Users\/x\/\.claude-work/);
  assert.doesNotMatch(signedOut(), /CLAUDE_CONFIG_DIR/);
});

test("claude: the task list follows its tools across turns", () => {
  let list: TaskList = new Map();
  list = applyTaskTool(list, "TaskCreate", { subject: "A" }, { task: { id: "1", subject: "A" } })!;
  list = applyTaskTool(list, "TaskCreate", { subject: "B" }, "Task #2 created successfully: B")!;
  list = applyTaskTool(list, "TaskUpdate", { taskId: "1", status: "completed" }, { success: true, taskId: "1" })!;
  assert.deepEqual([...list.values()], [{ title: "A", status: "completed" }, { title: "B", status: "pending" }]);
  assert.equal(applyTaskTool(list, "TaskUpdate", { taskId: "1", status: "completed" }, { success: true }), undefined, "no change");
  list = applyTaskTool(list, "TaskUpdate", { taskId: "2", status: "deleted" }, { success: true })!;
  assert.deepEqual([...list.keys()], ["1"]);
  list = applyTaskTool(list, "TaskList", {}, { tasks: [{ id: "7", subject: "C", status: "in_progress", blockedBy: [] }] })!;
  assert.deepEqual([...list.values()], [{ title: "C", status: "in_progress" }]);
});

test("claude: images and PDFs go as content blocks within what a conversation holds; others by their path", () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-attach-"));
  const png = join(dir, "shot.png");
  writeFileSync(png, Buffer.from("89504e470d0a1a0a", "hex"));
  const pdf = join(dir, "spec.pdf");
  writeFileSync(pdf, "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
  const txt = join(dir, "notes.txt");
  writeFileSync(txt, "hello");
  assert.equal(pdfPages(readFileSync(pdf)), 1);
  const budget = { bytes: 0, pages: 0 };
  const out = withFiles("look", [png, pdf, txt], budget);
  assert.ok(Array.isArray(out));
  assert.deepEqual(out.map((b) => b.type), ["image", "document", "text"]);
  assert.equal(budget.pages, 1);
  // A conversation that holds all it can: the files go by path, the text alone.
  assert.equal(withFiles("look", [png], { bytes: 28 * 1024 * 1024, pages: 0 }), "look");
});

// ————— Codex's app server and an ACP agent, as small scripts that speak their protocols —————

/** Writes an executable stand-in for an agent: `on` answers each JSON-RPC message, and every message is logged. */
function script(name: string, on: string) {
  const dir = mkdtempSync(join(tmpdir(), "lc-agent-"));
  const file = join(dir, name);
  writeFileSync(
    file,
    `#!/usr/bin/env node
const fs = require("fs");
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const mode = process.env.FAKE_MODE || "";
let n = 0, buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    fs.appendFileSync(process.env.FAKE_LOG, line + "\\n");
    n++;
    ${on}
  }
});
`,
    { mode: 0o755 },
  );
  const log = join(dir, "log.jsonl");
  writeFileSync(log, "");
  const read = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id?: number; method?: string; params?: Record<string, unknown> });
  return { file, log, read };
}

const CODEX = `
switch (m.method) {
  case "initialize": send({ id: m.id, result: {} }); break;
  case "thread/resume":
    if (mode === "archived" && !fs.readFileSync(process.env.FAKE_LOG, "utf8").includes("thread/unarchive")) send({ id: m.id, error: { code: -1, message: "session " + m.params.threadId + " is archived; run codex unarchive" } });
    else if (mode === "lost") send({ id: m.id, error: { code: -1, message: "no rollout found for thread" } });
    else send({ id: m.id, result: { thread: { id: m.params.threadId } } });
    break;
  case "thread/start": send({ id: m.id, result: { thread: { id: "new-thread" } } }); break;
  case "turn/start":
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    if (mode !== "hold") setTimeout(() => send({ method: "turn/completed", params: { turn: { status: "completed" } } }), 10);
    break;
  case "turn/steer": send({ id: m.id, error: { code: -1, message: "no active turn to steer" } }); break;
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`;

test("codex: an archived thread is unarchived and resumed; a lost one starts a new thread and says so", async () => {
  const { CodexServerSession } = await import("../src/providers/codex-server.ts");
  const fake = script("codex", CODEX);
  const env = (mode: string) => ({ ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log, FAKE_MODE: mode });
  const { sink } = recorder();

  const archived = new CodexServerSession(opts({ resume: "t-1", env: env("archived") }));
  await archived.turn("hi", sink, new AbortController().signal);
  archived.close();
  const sent = fake.read();
  assert.ok(sent.some((m) => m.method === "thread/unarchive" && m.params?.threadId === "t-1"));
  assert.ok(sent.filter((m) => m.method === "thread/resume").every((m) => m.params?.excludeTurns === true));
  assert.ok(!sent.some((m) => m.method === "thread/start"), "the archived thread itself goes on");

  writeFileSync(fake.log, "");
  const png = join(mkdtempSync(join(tmpdir(), "lc-img-")), "shot.png");
  writeFileSync(png, Buffer.from("89504e470d0a1a0a", "hex"));
  const lost = new CodexServerSession(opts({ resume: "t-2", model: "gpt-6-luna", env: env("lost") }));
  await assert.rejects(lost.turn("hi", sink, new AbortController().signal), (e) => e instanceof ResumeFailed);
  await lost.turn("hi again", sink, new AbortController().signal, [png]);
  lost.close();
  const start = fake.read().find((m) => m.method === "turn/start");
  assert.equal(start?.params?.threadId, "new-thread");
  assert.equal(start?.params?.summary, "detailed");
  const input = start?.params?.input as { type: string; url?: string }[];
  assert.equal(input[1].type, "image");
  assert.match(input[1].url ?? "", /^data:image\/png;base64,/);
});

test("codex: a steer Codex turns down says so, so the runtime can send it next", async () => {
  const { CodexServerSession } = await import("../src/providers/codex-server.ts");
  const fake = script("codex", CODEX);
  const s = new CodexServerSession(opts({ env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log, FAKE_MODE: "hold" } }));
  const { sink } = recorder();
  const stop = new AbortController();
  const turn = s.turn("work", sink, stop.signal);
  await until(() => fake.read().some((m) => m.method === "turn/start"), "the turn starts");
  await tick(20);
  assert.equal(await s.steer("and this"), false);
  stop.abort();
  await turn;
  s.close();
});

const ACP = `
switch (m.method) {
  case "initialize": send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } } }); break;
  case "session/load": send({ id: m.id, error: { code: -32002, message: "session not found" } }); break;
  case "session/new": send({ id: m.id, result: { sessionId: "s-new" } }); break;
  case "session/prompt": if (mode !== "hang") send({ id: m.id, result: { stopReason: "end_turn" } }); break;
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`;

test("acp: a session it can't load is said, not swapped in silence; images go when the agent takes them", async () => {
  const { acpProvider } = await import("../src/providers/acp.ts");
  const fake = script("agent", ACP);
  const p = acpProvider("acp.fake" as ProviderInfo["id"], { label: "Fake", cmd: [fake.file], login: "" });
  const s = p.open(opts({ resume: "s-old", env: { ...process.env, FAKE_LOG: fake.log } }));
  const { sink } = recorder();
  await assert.rejects(s.turn("hi", sink, new AbortController().signal), (e) => e instanceof ResumeFailed);
  const png = join(mkdtempSync(join(tmpdir(), "lc-img-")), "shot.png");
  writeFileSync(png, Buffer.from("89504e470d0a1a0a", "hex"));
  await s.turn("look at this", sink, new AbortController().signal, [png]);
  s.close();
  const prompt = fake.read().find((m) => m.method === "session/prompt");
  const blocks = prompt?.params?.prompt as { type: string; mimeType?: string }[];
  assert.deepEqual(blocks.map((b) => b.type), ["text", "image"]);
  assert.equal(blocks[1].mimeType, "image/png");
});

test("acp: Stop ends the turn when the agent doesn't finish cancelling, and its process is stopped", async () => {
  const { acpProvider, setCancelMs } = await import("../src/providers/acp.ts");
  const fake = script("agent", ACP);
  setCancelMs(100);
  try {
    const p = acpProvider("acp.fake" as ProviderInfo["id"], { label: "Fake", cmd: [fake.file], login: "" });
    const s = p.open(opts({ env: { ...process.env, FAKE_LOG: fake.log, FAKE_MODE: "hang" } }));
    const { sink } = recorder();
    const stop = new AbortController();
    const turn = s.turn("work", sink, stop.signal);
    await until(() => fake.read().some((m) => m.method === "session/prompt"), "the prompt went");
    const at = Date.now();
    stop.abort();
    await turn;
    assert.ok(Date.now() - at < 2000, "it didn't wait for the agent");
    assert.ok(fake.read().some((m) => m.method === "session/cancel"));
    s.close();
  } finally {
    setCancelMs(15_000);
  }
});
