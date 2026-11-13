/*
  One turn at a time in a session: what you send while work is in flight waits in the queue and
  goes when it ends; Stop keeps the queue for you; a request the tool can no longer act on doesn't
  hold the session in Needs you; a routine's own step runs unattended, and nothing it does leaves
  this Mac. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { OpenOptions, Provider, TurnSink } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";
import { createApi } from "../src/api.ts";

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const ready = [info("claude", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"])];
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

/** Claude Code, faked: each turn runs `work` and counts how many turns run at once. */
function fake(work: (text: string, sink: TurnSink, signal: AbortSignal) => Promise<void>) {
  const seen = { texts: [] as string[], now: 0, most: 0 };
  const make: Provider = {
    id: "claude",
    // Found with the models the sessions here run on, as the API's own look at the tools finds it.
    detect: async () => ready[0],
    open: (_o: OpenOptions) => ({
      turn: async (text, sink, signal) => {
        seen.texts.push(text);
        seen.most = Math.max(seen.most, ++seen.now);
        try {
          await work(text, sink, signal);
        } finally {
          seen.now--;
        }
      },
      close() {},
    }),
  };
  const saved = providers.claude;
  providers.claude = make;
  return { seen, restore: () => (providers.claude = saved) };
}

function session(extra: Partial<Thread> = {}) {
  const home = mkdtempSync(join(tmpdir(), "lc-turns-"));
  const dir = mkdtempSync(join(tmpdir(), "lc-turns-dir-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "New session", agent: "forge", status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = ready;
  return { store, runtime };
}

/** Waits until `ok` holds, or fails after about two seconds. */
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 200 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}

test("one at a time: a message sent while a turn works waits, then goes when it ends", async () => {
  const { seen, restore } = fake(async (_text, sink, signal) => {
    sink.text("working");
    for (let i = 0; i < 10 && !signal.aborted; i++) await tick();
  });
  try {
    const { store, runtime } = session();
    const first = runtime.send("t", "first");
    await until(() => seen.texts.length === 1, "the first turn starts");
    await runtime.send("t", "second");
    await runtime.send("t", "third");
    assert.equal(store.thread("t").queue?.length, 2, "both wait in the queue");
    await first;
    await until(() => seen.texts.length === 2 && !runtime.isRunning("t"), "the queue goes as one message when the turn ends");
    assert.equal(seen.most, 1, "never two turns at once");
    assert.match(seen.texts[1], /second\n\nthird/);
    assert.equal(store.thread("t").queue?.length ?? 0, 0);
  } finally {
    restore();
  }
});

test("one at a time: Stop keeps what you queued for you", async () => {
  const { seen, restore } = fake(async (_text, _sink, signal) => {
    while (!signal.aborted) await tick();
  });
  try {
    const { store, runtime } = session();
    const first = runtime.send("t", "first");
    await until(() => seen.texts.length === 1, "the turn starts");
    await runtime.send("t", "later");
    runtime.stop("t");
    await first;
    await tick(50);
    assert.equal(seen.texts.length, 1, "nothing more starts after Stop");
    assert.equal(store.thread("t").queue?.length, 1, "the queued message is still yours");
  } finally {
    restore();
  }
});

test("one at a time: after Stop, taking a message out of the queue doesn't send the rest; your next message does", async () => {
  const { seen, restore } = fake(async (_text, _sink, signal) => {
    while (!signal.aborted && seen.texts.length === 1) await tick();
  });
  try {
    const { store, runtime } = session();
    const first = runtime.send("t", "first");
    await until(() => seen.texts.length === 1, "the turn starts");
    await runtime.send("t", "A");
    await runtime.send("t", "B");
    runtime.stop("t");
    await first;
    runtime.setQueue("t", store.thread("t").queue!.filter((q) => q.text !== "B"));
    await tick(50);
    assert.deepEqual(seen.texts, ["first"], "nothing goes on an edit");
    assert.deepEqual(store.thread("t").queue?.map((q) => q.text), ["A"]);
    await runtime.send("t", "now this");
    await until(() => seen.texts.length === 3 && !runtime.isRunning("t"), "what's left goes after it");
    assert.deepEqual(seen.texts.slice(1), ["now this", "A"]);
  } finally {
    restore();
  }
});

test("a request the tool can't act on any more expires with its turn, and the session isn't left waiting", async () => {
  const { restore } = fake(async (_text, sink, signal) => {
    // The tool asks, then its process ends before you answer.
    void sink.approve({ key: "c1", tool: "Bash", title: "Run make", risk: "low", fields: [{ label: "Command", value: "make" }] }, signal).catch(() => {});
    await tick(20);
  });
  try {
    const { store, runtime } = session({ access: "ask" });
    await runtime.send("t", "build it");
    const ask = store.timeline("t").find((x) => x.kind === "approval");
    assert.equal(ask?.kind === "approval" && ask.state, "expired");
    assert.notEqual(store.thread("t").status, "waiting");
  } finally {
    restore();
  }
});

test("a question still open when its turn ends: your answer goes as your next message, not to the tool that stopped listening", async () => {
  const { seen, restore } = fake(async (text, sink, signal) => {
    if (text !== "build it") return;
    // The tool asks, then its turn ends before you answer (Codex gave up on the request).
    void sink.ask([{ question: "Which database?", options: [{ label: "SQLite" }, { label: "Postgres" }] }], signal).catch(() => {});
    await tick(20);
  });
  try {
    const { store, runtime } = session({ access: "ask" });
    await runtime.send("t", "build it");
    const q = store.timeline("t").find((x) => x.kind === "question");
    assert.equal(q?.kind === "question" && q.state, "asking", "the card stays, to be answered");
    runtime.answerQuestion("t", q!.id, { "Which database?": "SQLite" });
    await until(() => seen.texts.length === 2 && !runtime.isRunning("t"), "the answer goes as a turn");
    assert.match(seen.texts[1], /Which database\?\nSQLite/);
    assert.equal(store.thread("t").status, "done");
  } finally {
    restore();
  }
});

test("a question left from an ended turn, skipped: the session isn't left in Needs you", async () => {
  const { restore } = fake(async (_text, sink, signal) => {
    void sink.ask([{ question: "Which database?", options: [{ label: "SQLite" }] }], signal).catch(() => {});
    await tick(20);
  });
  try {
    const { store, runtime } = session({ access: "ask" });
    await runtime.send("t", "build it");
    assert.equal(store.thread("t").status, "waiting");
    const q = store.timeline("t").find((x) => x.kind === "question")!;
    runtime.answerQuestion("t", q.id);
    assert.equal(store.thread("t").status, "done");
  } finally {
    restore();
  }
});

test("a question left from an ended turn, and you send something else: it's put back, and the new turn ends done, not in Needs you", async () => {
  const { seen, restore } = fake(async (text, sink, signal) => {
    if (text !== "build it") return;
    void sink.ask([{ question: "Which database?", options: [{ label: "SQLite" }] }], signal).catch(() => {});
    await tick(20);
  });
  try {
    const { store, runtime } = session({ access: "ask" });
    await runtime.send("t", "build it");
    assert.equal(store.thread("t").status, "waiting");
    await runtime.send("t", "never mind, add a README");
    await until(() => seen.texts.length === 2 && !runtime.isRunning("t"), "the new message goes as a turn");
    const q = store.timeline("t").find((x) => x.kind === "question");
    assert.equal(q?.kind === "question" && q.state, "skipped");
    assert.equal(store.thread("t").status, "done");
  } finally {
    restore();
  }
});

test("routines: its own step runs unattended, never what leaves this Mac; afterwards the session asks again", async () => {
  const answers: Record<string, boolean> = {};
  const { restore } = fake(async (_text, sink, signal) => {
    for (const command of ["npm run build", "git push origin main", "curl -X POST https://example.com/hook"]) {
      const a = await sink.approve({ key: command, tool: "Bash", title: `Run ${command}`, risk: "medium", fields: [{ label: "Command", value: command }] }, signal).catch(() => ({ allow: false }));
      answers[command] = a.allow;
    }
  });
  try {
    const { store, runtime } = session({ access: "ask", routine: { id: "r", run: "run" } });
    await runtime.unattendedTurn("t", () => runtime.send("t", "do the routine's work"));
    assert.deepEqual(answers, { "npm run build": true, "git push origin main": false, "curl -X POST https://example.com/hook": false });
    // Your own message in that session later: the routine's trust is gone, so it asks.
    const yours = runtime.send("t", "now push it");
    await until(() => store.timeline("t").some((x) => x.kind === "approval" && x.state === "asking"), "it asks you");
    runtime.stop("t");
    await yours;
  } finally {
    restore();
  }
});

test("one writer: a question, a change and a hard job each go to the lead as one turn of its own, with no plan in between", async () => {
  const seen: { model: string; text: string }[] = [];
  const make: Provider = {
    id: "claude",
    detect: async () => info("claude", []),
    open: (o: OpenOptions) => ({
      turn: async (text, sink) => {
        seen.push({ model: o.model, text });
        sink.text("It resets the tide table.");
      },
      close() {},
    }),
  };
  const saved = providers.claude;
  providers.claude = make;
  try {
    const { store, runtime } = session({ agent: "@claude:claude-sonnet-5-5" });
    await runtime.send("t", "what does reset do?");
    await runtime.send("t", "add a reset button");
    await runtime.send("t", "refactor the settings architecture across every screen into one consistent theme system, with a migration for saved preferences and tests for each screen");
    await runtime.send("t", "plan it first: add a high-contrast mode");
    assert.deepEqual(seen.map((x) => x.model), ["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-sonnet-5-5", "claude-sonnet-5-5"]);
    // Each went as you wrote it: nobody else's words came first.
    assert.equal(seen[3].text, "plan it first: add a high-contrast mode");
    const items = store.timeline("t");
    assert.ok(!items.some((x) => x.kind === "proposal"), "no plan card unless the tool proposes one");
    assert.deepEqual(items.flatMap((x) => (x.kind === "turn" ? [x.part ?? "", x.agent] : [])), ["", "@claude:claude-sonnet-5-5", "", "@claude:claude-sonnet-5-5", "", "@claude:claude-sonnet-5-5", "", "@claude:claude-sonnet-5-5"]);
    assert.equal(store.thread("t").status, "done");
  } finally {
    providers.claude = saved;
  }
});

test("a plan the tool proposes in its turn waits there: approved, the turn goes on; one whose turn is gone can't be answered", async () => {
  const answers: { approve: boolean; plan?: string }[] = [];
  const { restore } = fake(async (_text, sink, signal) => {
    answers.push(await sink.propose("Theme system", "1. Add a theme store", signal));
    sink.text("Built it.");
  });
  try {
    const { store, runtime } = session();
    const working = runtime.send("t", "add a theme system");
    await until(() => store.timeline("t").some((x) => x.kind === "proposal" && x.state === "asking"), "the plan asks");
    assert.equal(store.thread("t").status, "waiting");
    const plan = store.timeline("t").find((x) => x.kind === "proposal")!;
    runtime.answerProposal("t", plan.id, true, undefined, "1. Add a theme store\n2. Test it");
    await working;
    assert.deepEqual(answers, [{ approve: true, note: undefined, plan: "1. Add a theme store\n2. Test it" }]);
    assert.equal(store.thread("t").status, "done");
    assert.equal(store.thread("t").access, "auto", "it carries on on Auto, as Claude Code's plan mode does");
    // A card left over with nobody waiting (its turn ended): answering it says so and it expires.
    store.putItem("t", { kind: "proposal", id: "old", turn: 1, at: 1, title: "Old", plan: "1. Old", state: "asking" });
    assert.throws(() => runtime.answerProposal("t", "old", true), /stopped waiting/);
    assert.equal((store.item("t", "old") as { state: string }).state, "expired");
  } finally {
    restore();
  }
});

test("after a restart: a question still asks and answering it works; a plan from before, a planner's included, and a step to allow expire", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-turns-"));
  const dir = mkdtempSync(join(tmpdir(), "lc-turns-dir-"));
  const before = new Store(home);
  before.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  for (const id of ["a", "b"]) before.putThread({ id, projectId: "p", title: "New session", agent: "forge", status: "waiting", access: "ask", turns: 1, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
  // a: a planner's plan from before pairs, waiting for your OK. b: a question and a step, from a turn the engine stopped in.
  before.putItem("a", { kind: "turn", id: "m", turn: 1, at: 1, agent: "forge", model: "claude:claude-opus-5-5", planning: true, status: "done" });
  before.putItem("a", { kind: "proposal", id: "x-plan", turn: 1, at: 1, title: "Theme system", plan: "1. Add a theme store", state: "asking" });
  before.putItem("b", { kind: "turn", id: "m", turn: 1, at: 1, agent: "forge", model: "claude:claude-sonnet-5-5", status: "running" });
  before.putItem("b", { kind: "question", id: "q", turn: 1, at: 1, questions: [{ question: "Which database?", options: [{ label: "SQLite" }] }], state: "asking" });
  before.putItem("b", { kind: "approval", id: "s", turn: 1, at: 1, tool: "Bash", title: "Run make", risk: "low", fields: [], state: "asking" });
  before.flush();

  const { seen, restore } = fake(async () => {});
  try {
    const store = new Store(home);
    const runtime = new Runtime(store, process.env);
    runtime.providerInfo = ready;
    const state = (t: string, id: string) => store.timeline(t).find((x) => x.id === id) as { state?: string };
    assert.deepEqual([state("a", "x-plan").state, state("b", "q").state, state("b", "s").state], ["expired", "asking", "expired"]);
    assert.deepEqual([store.thread("a").status, store.thread("b").status], ["idle", "waiting"], "only the question still needs you");
    assert.throws(() => runtime.answerProposal("a", "x-plan", true), /already answered/);
    runtime.answerQuestion("b", "q", { "Which database?": "SQLite" });
    await until(() => seen.texts.length === 1 && !runtime.isRunning("b"), "the answer goes");
    assert.ok(seen.texts.some((t) => /Which database\?\nSQLite/.test(t)));
  } finally {
    restore();
  }
});

test("one at a time: a queue edit made from a copy from before the queue went doesn't bring it back", async () => {
  const { seen, restore } = fake(async () => void (await tick(30)));
  try {
    const { store, runtime } = session();
    const first = runtime.send("t", "first");
    await until(() => runtime.isRunning("t"), "it works");
    void runtime.send("t", "second");
    const copy = store.thread("t").queue!;
    await first;
    await until(() => seen.texts.length === 2 && !runtime.isRunning("t"), "the queue went");
    // The app's edit of its copy (say, your message's words) lands after.
    runtime.setQueue("t", copy.map((q) => ({ ...q, text: "second, edited" })));
    await tick(60);
    assert.deepEqual(seen.texts, ["first", "second"], "nothing goes twice");
    assert.deepEqual(store.thread("t").queue, []);
  } finally {
    restore();
  }
});

test("quitting mid-answer keeps the answer so far; a review cut off by it isn't shown as still reading", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-turns-"));
  const before = new Store(home);
  before.putProject({ id: "p", name: "p", path: home, git: false, createdAt: Date.now() });
  before.putThread({ id: "t", projectId: "p", title: "x", agent: "forge", status: "running", verdict: { state: "checking", round: 1 }, access: "ask", turns: 1, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
  before.putItem("t", { kind: "text", id: "a", turn: 1, at: 1, text: "", streaming: true }, false);
  before.appendText("t", "a", "Half an answer");
  before.keepStreaming();
  before.flush();
  const after = new Store(home);
  const it = after.timeline("t").find((x) => x.id === "a");
  assert.equal(it?.kind === "text" && it.text, "Half an answer");
  assert.equal(after.thread("t").verdict, undefined);
});

test("a fork of a session at work starts from its last turn that ended; a side chat's copy shows nothing running or asking", async () => {
  let release = () => {};
  const { restore } = fake(async (text, sink, signal) => {
    if (text !== "two") return sink.text("First answer.");
    sink.text("Half of the second");
    void sink.approve({ key: "c", tool: "Bash", title: "Run make", risk: "low", fields: [{ label: "Command", value: "make" }] }, signal).catch(() => {});
    await new Promise<void>((r) => (release = r));
  });
  try {
    // On a model, not an agent that isn't there: the API's look at the tools, done at once with none to find, would point the
    // session at a stand-in after its first turn, and the second would go as a new session's (the conversation so far, then "two").
    const { store, runtime } = session({ access: "ask", agent: "@claude:claude-opus-5-5" });
    // The API looks for every tool as it starts (versions, models, logins): here none is on its PATH, and its home is the store's,
    // so the tools and settings of this Mac are never asked.
    const env = { PATH: "/usr/bin:/bin", HOME: store.home };
    const api = createApi(store, runtime, env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
    await runtime.send("t", "one");
    const working = runtime.send("t", "two");
    await until(() => store.timeline("t").some((x) => x.kind === "approval"), "the second turn asks");
    const fork = (await api.call("thread.create", { projectId: "p", forkOf: "t" })) as Thread;
    assert.equal(fork.turns, 1);
    assert.equal(fork.forkSession, "", "a session mid-turn isn't branched in place");
    assert.deepEqual(store.timeline(fork.id).map((x) => x.turn), store.timeline(fork.id).map(() => 1), "only the turn that ended");
    const side = (await api.call("thread.side", { id: "t" })) as Thread;
    const copy = store.timeline(side.id);
    assert.ok(!copy.some((x) => (x.kind === "text" && x.streaming) || (x.kind === "turn" && x.status === "running") || (x.kind === "approval" && x.state === "asking")));
    runtime.stop("t");
    release();
    await working;
  } finally {
    restore();
  }
});

test("watchdog: a read by another model in the turn's place counts as word from it, so a long review isn't called stuck", async () => {
  const { QUIET_MS } = await import("../src/runtime.ts");
  let runtime: Runtime | undefined;
  let t0 = 0;
  let notices: string[] = [];
  const { restore } = fake(async (text, sink, signal) => {
    if (text === "read it") return void (await tick(60), sink.text("<findings>{\"verdict\":\"pass\",\"findings\":[]}</findings>"));
    await runtime!.quiet("t", "claude:claude-haiku-5-5", "/tmp", "read it", signal);
    runtime!.watchQuiet(t0 + QUIET_MS + 20);
  });
  try {
    const s = session();
    runtime = s.runtime;
    t0 = Date.now();
    await runtime.send("t", "go");
    notices = s.store.timeline("t").flatMap((x) => (x.kind === "notice" ? [x.text] : []));
    assert.ok(!notices.some((n) => /No word from/.test(n)), notices.join("\n"));
  } finally {
    restore();
  }
});

test("a question you answer twice goes once", async () => {
  // The tool asked after its turn ended: the answer goes as your next message, once.
  const { seen, restore } = fake(async () => {});
  try {
    const { store, runtime } = session({ status: "waiting" });
    store.putItem("t", { kind: "question", id: "q", turn: 1, at: 1, questions: [{ question: "Which?", options: [] }], state: "asking" });
    runtime.answerQuestion("t", "q", { "Which?": "This one" });
    runtime.answerQuestion("t", "q", { "Which?": "This one" });
    await until(() => seen.texts.length > 0, "the answer went");
    await tick(50);
    assert.equal(seen.texts.length, 1);
  } finally {
    restore();
  }
});

test("quitting keeps an open question: it's still there after the restart, and your answer carries on", async () => {
  const { seen, restore } = fake(async (text, sink, signal) => {
    if (text === "ask me") await sink.ask([{ question: "Which?", options: [] }], signal).catch(() => null);
  });
  try {
    const { store, runtime } = session();
    void runtime.send("t", "ask me").catch(() => {});
    await until(() => store.timeline("t").some((x) => x.kind === "question"), "it asked");
    runtime.shutdown();
    store.flush();
    const again = new Store(store.home);
    const card = again.timeline("t").find((x) => x.kind === "question");
    assert.equal(card?.kind === "question" ? card.state : "", "asking");
    assert.equal(again.thread("t").status, "waiting");
    const next = new Runtime(again, process.env);
    next.providerInfo = ready;
    next.answerQuestion("t", card!.id, { "Which?": "This one" });
    await until(() => seen.texts.some((x) => /This one/.test(x)), "the answer went on");

    // Stop is different: the question ends with the turn.
    const s = session();
    void s.runtime.send("t", "ask me").catch(() => {});
    await until(() => s.store.timeline("t").some((x) => x.kind === "question"), "it asked");
    s.runtime.stop("t");
    await until(() => s.store.timeline("t").some((x) => x.kind === "question" && x.state === "expired"), "it expired");
  } finally {
    restore();
  }
});

test("a save that fails as a turn ends doesn't leave the session running for good", async () => {
  let calls = 0;
  const { restore } = fake(async (_text, sink) => {
    if (++calls === 1) sink.tool({ key: "c", tool: "Bash", toolKind: "exec", title: "Run it", status: "running" });
  });
  try {
    const { store, runtime } = session();
    const put = store.putItem.bind(store);
    store.putItem = ((id: string, item: Parameters<typeof put>[1], log?: boolean) => {
      if (item.kind === "tool" && item.status !== "running") throw new Error("ENOSPC: no space left on device");
      return put(id, item, log);
    }) as typeof store.putItem;
    await runtime.send("t", "first").catch(() => {});
    assert.equal(runtime.isRunning("t"), false, "the turn let go");
    assert.equal(store.thread("t").status, "error");
    store.putItem = put;
    await runtime.send("t", "second");
    assert.equal(calls, 2, "the next message runs, it doesn't queue for ever");
  } finally {
    restore();
  }
});

test("a message about a line keeps its line in the queue and as a steer", async () => {
  const anchor = { file: "src/a.ts", line: 12, endLine: 14 };
  let release = () => {};
  const steered: string[] = [];
  const { seen, restore } = fake(async (text) => {
    if (text === "first") await new Promise<void>((r) => (release = r));
  });
  const claude = providers.claude;
  const open = claude.open;
  claude.open = (o) => Object.assign(open(o), { steer: async (t: string) => (steered.push(t), steered.length === 1) });
  try {
    const { store, runtime } = session();
    void runtime.send("t", "first").catch(() => {});
    await until(() => seen.texts.length === 1, "it's working");
    await runtime.send("t", "steer this", "steer", anchor);
    assert.match(steered[0], /^About src\/a\.ts:12-14 in your last change:\n\nsteer this/);
    assert.deepEqual(store.timeline("t").find((x) => x.kind === "user" && x.steer), { ...store.timeline("t").find((x) => x.kind === "user" && x.steer), anchor });
    await runtime.send("t", "queue this", "queue", anchor);
    assert.deepEqual(store.thread("t").queue?.[0].anchor, anchor);
    release();
    await until(() => seen.texts.length === 2, "the queue went");
    assert.match(seen.texts[1], /^About src\/a\.ts:12-14 in your last change:\n\nqueue this/);

    // Joined with others, it keeps its line in words.
    const s = session();
    void s.runtime.send("t", "first").catch(() => {});
    await until(() => seen.texts.length === 3, "it's working");
    await s.runtime.send("t", "plain");
    await s.runtime.send("t", "about it", "queue", anchor);
    release();
    await until(() => seen.texts.length === 4, "the queue went");
    assert.match(seen.texts[3], /plain\n\nAbout src\/a\.ts:12-14 in your last change:\n\nabout it/);
  } finally {
    restore();
  }
});

