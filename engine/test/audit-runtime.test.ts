/*
  The turn loop, its log, its snapshots and its routines, each case from a defect found reading
  them, with fake agents and a fake gh. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { Item, ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { capture, diffFiles } from "../src/checkpoints.ts";
import { jsonLines, run } from "../src/exec.ts";
import { fixPrompt, parseFindings } from "../src/review.ts";
import { commandRisk, readsOnly, ruleFor } from "../src/risk.ts";
import { handoff, providers, Runtime } from "../src/runtime.ts";
import { Routines } from "../src/routines.ts";
import type { OpenOptions, Provider, ProviderSession, TurnSink } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const ready = [info("claude", ["claude-opus-5-5", "claude-sonnet-5-5"]), info("codex", ["gpt-6"])];
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 300 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}

type Fake = Partial<ProviderSession> & { turn?: ProviderSession["turn"] };
type Work = (text: string, sink: TurnSink, signal: AbortSignal) => Promise<void> | void;
/** Stands in for a tool: `make` gets each session's options, or `work` runs each turn. */
function fake(work: Work | { open: (o: OpenOptions) => Fake }, id: "claude" | "codex" = "claude") {
  const texts: string[] = [];
  const opened: OpenOptions[] = [];
  let closed = 0;
  const p: Provider = {
    id,
    detect: async () => info(id, []),
    open: (o) => {
      opened.push(o);
      const made = typeof work === "function" ? {} : work.open(o);
      return {
        close: () => void closed++,
        ...made,
        turn: async (text, sink, signal, files) => {
          texts.push(text);
          if (made.turn) return made.turn(text, sink, signal, files);
          if (typeof work === "function") await work(text, sink, signal);
        },
      } as ProviderSession;
    },
  };
  const saved = providers[id];
  providers[id] = p;
  return { texts, opened, closes: () => closed, restore: () => (providers[id] = saved) };
}

function session(extra: Partial<Thread> = {}, home = mkdtempSync(join(tmpdir(), "lc-audit-")), dir = mkdtempSync(join(tmpdir(), "lc-audit-dir-"))) {
  const store = new Store(home);
  if (!store.projects.length) store.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  if (!store.threads.length) store.putThread({ id: "t", projectId: "p", title: "Work", agent: "forge", status: "idle", access: "ask", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = ready;
  return { store, runtime, home, dir };
}

const who = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
const git = async (cwd: string, ...args: string[]) => {
  const r = await run("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: { ...process.env, ...who } });
  assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
async function repo() {
  const dir = mkdtempSync(join(tmpdir(), "lc-audit-repo-"));
  await git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.txt"), "one\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "start");
  return dir;
}
/** A change in the repository, as a turn's checkpoint a Reviewer can read. */
async function changed(store: Store, dir: string, turn = 1) {
  const from = (await capture(dir, `t/${turn}-before`))!;
  writeFileSync(join(dir, "a.txt"), `one\nline of turn ${turn}\n`);
  const to = (await capture(dir, `t/${turn}-after`))!;
  store.putItem("t", { kind: "checkpoint", id: `cp${turn}`, turn, at: Date.now(), files: [{ path: "a.txt", status: "modified", added: 1, removed: 0, rel: true }], from, to });
}
const texts = (items: Item[]) => items.flatMap((x) => (x.kind === "text" ? [x.text] : []));
const asks = (items: Item[]) => items.filter((x) => (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking");

/* The log. */

test("log: a line cut short by a crash doesn't swallow the first item written after it", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-audit-"));
  const a = new Store(home);
  a.putItem("t", { kind: "user", id: "u1", turn: 1, at: 1, text: "kept" });
  appendFileSync(join(home, "threads", "t.jsonl"), '{"kind":"text","id":"cut');
  const b = new Store(home);
  assert.deepEqual(b.timeline("t").map((x) => x.id), ["u1"]);
  b.putItem("t", { kind: "user", id: "u2", turn: 2, at: 2, text: "after the crash" });
  assert.deepEqual(new Store(home).timeline("t").map((x) => x.id), ["u1", "u2"], "the next line starts on a line of its own");
});

test("log: an answer that goes on after a notice is saved whole, not just up to the notice", async () => {
  const { restore } = fake(async (_t, sink) => {
    sink.text("first part, ", "b1");
    sink.notice("Retrying");
    sink.text("second part", "b1");
  });
  try {
    const { store, runtime, home } = session();
    await runtime.send("t", "go");
    assert.deepEqual(texts(store.timeline("t")), ["first part, second part"]);
    store.flush();
    assert.deepEqual(texts(new Store(home).timeline("t")), ["first part, second part"], "and after a restart");
  } finally {
    restore();
  }
});

/* Stop, the queue and steers. */

test("stop: a message you send after Stop, while the turn winds down, goes when it has; what Stop kept goes with it", async () => {
  let release = () => {};
  const { texts: sent, restore } = fake(async (text, _s, signal) => {
    if (text !== "first") return;
    while (!signal.aborted) await tick();
    // A tool can take seconds to let go of a stopped turn.
    await new Promise<void>((r) => (release = r));
  });
  try {
    const { store, runtime } = session();
    const first = runtime.send("t", "first");
    await until(() => sent.length === 1, "the turn runs");
    await runtime.send("t", "queued before");
    runtime.stop("t");
    await tick();
    await runtime.send("t", "after Stop");
    release();
    await first;
    await until(() => sent.length === 2 && !runtime.isRunning("t"), "it goes once the stop has settled");
    assert.match(sent[1], /queued before\n\nafter Stop/);
    assert.equal(store.thread("t").queue?.length ?? 0, 0);
  } finally {
    restore();
  }
});

test("stop: a steer sent after Stop doesn't go into the stopped turn, it goes next", async () => {
  let steered = 0;
  let release = () => {};
  const { texts: sent, restore } = fake({
    open: () => ({
      steer: () => (steered++, true),
      turn: async (text, _s, signal) => {
        if (text !== "first") return;
        while (!signal.aborted) await tick();
        await new Promise<void>((r) => (release = r));
      },
    }),
  });
  try {
    const { runtime } = session();
    const first = runtime.send("t", "first");
    await until(() => sent.length === 1, "the turn runs");
    runtime.stop("t");
    await runtime.send("t", "actually do this", "steer");
    assert.equal(steered, 0, "nothing is left of that turn to read it");
    await tick(30);
    release();
    await first;
    await until(() => sent.length === 2 && !runtime.isRunning("t"), "it goes as a turn of its own");
    assert.match(sent[1], /actually do this/);
  } finally {
    restore();
  }
});

test("queue: what waited on a question left open goes once you skip it", async () => {
  const { texts: sent, restore } = fake(async (text, sink, signal) => {
    if (text === "first") void sink.ask([{ question: "Which?", options: [{ label: "A" }] }], signal).catch(() => {});
  });
  try {
    const { store, runtime } = session();
    const first = runtime.send("t", "first");
    await runtime.send("t", "queued");
    await first;
    const q = asks(store.timeline("t"))[0];
    assert.equal(store.thread("t").queue?.length, 1, "it waits on the question");
    runtime.answerQuestion("t", q.id);
    await until(() => sent.length === 2 && !runtime.isRunning("t"), "it goes");
    assert.match(sent[1], /queued/);
  } finally {
    restore();
  }
});

test("queue: what waited on a tool's plan goes once you turn the plan down", async () => {
  const { texts: sent, restore } = fake(async (text, sink, signal) => {
    if (/Add/.test(text)) await sink.propose("Theme", "1. Do it", signal);
  });
  try {
    const { store, runtime } = session();
    const first = runtime.send("t", "Add a theme system with a store, migrations, a settings page, tests and docs across the whole app");
    await until(() => asks(store.timeline("t")).length === 1, "the plan asks");
    await runtime.send("t", "queued");
    const plan = asks(store.timeline("t"))[0];
    assert.equal(plan?.kind, "proposal");
    runtime.answerProposal("t", plan.id, false);
    await first;
    await until(() => sent.length === 2 && !runtime.isRunning("t"), "it goes");
    assert.match(sent[1], /queued/);
  } finally {
    restore();
  }
});

test("handoff: a session stopped before the tool took your message still gets the conversation next turn", async () => {
  const { texts: sent, opened, restore } = fake(async () => {});
  try {
    const { store, runtime } = session({ turns: 1, providerSession: "codex:old" });
    store.putItem("t", { kind: "user", id: "u", turn: 1, at: 1, text: "the earlier ask" });
    store.putItem("t", { kind: "text", id: "x", turn: 1, at: 1, text: "the earlier answer", streaming: false });
    // Another tool takes over, and you stop it as it opens.
    const stopped = runtime.send("t", "second");
    runtime.stop("t");
    await stopped;
    assert.equal(sent.length, 0, "the tool was sent nothing");
    await runtime.send("t", "third");
    assert.equal(sent.length, 1);
    assert.match(sent[0], /the earlier ask/, "the new tool isn't left blind");
    assert.ok(opened.length >= 1);
  } finally {
    restore();
  }
});

test("handoff: once the tool has its session, a failed turn isn't sent the conversation again (T3 Code doesn't redeliver either)", async () => {
  let turn = 0;
  const { texts: sent, restore } = fake(async (_t, sink) => {
    sink.session("new");
    if (++turn === 1) throw new Error("connection lost");
  });
  try {
    const { store, runtime } = session({ turns: 1, providerSession: "codex:old" });
    store.putItem("t", { kind: "user", id: "u", turn: 1, at: 1, text: "the earlier ask" });
    await runtime.send("t", "second");
    await runtime.send("t", "third");
    assert.equal(store.thread("t").providerSession, "claude:new");
    assert.match(sent[0], /the earlier ask/);
    assert.doesNotMatch(sent[1], /the earlier ask/);
  } finally {
    restore();
  }
});

test("handoff: an older request that's kept keeps all its lines", () => {
  const old: Item[] = [
    { kind: "user", id: "u1", turn: 1, at: 1, text: "line one\nline two\nline three" },
    { kind: "text", id: "x1", turn: 1, at: 1, text: "a".repeat(2000), streaming: false },
    { kind: "user", id: "u2", turn: 2, at: 2, text: "next" },
    { kind: "text", id: "x2", turn: 2, at: 2, text: "b".repeat(2000), streaming: false },
  ];
  const out = handoff(old, "switch", 2500);
  assert.match(out, /line one\nline two\nline three/);
});

test("session: a change the tool refuses reopens the session instead of failing your turn", async () => {
  let opens = 0;
  const { texts: sent, restore } = fake({
    open: () => {
      opens++;
      return { update: async () => Promise.reject(new Error("auto mode isn't available")) };
    },
  });
  try {
    const { store, runtime } = session();
    await runtime.send("t", "first");
    store.patchThread("t", { access: "auto" });
    await runtime.send("t", "second");
    assert.equal(sent.length, 2, "the turn went");
    assert.equal(opens, 2, "on a session opened with the new setting");
    assert.equal(store.thread("t").status, "done");
  } finally {
    restore();
  }
});

/* Approvals. */

test("approvals: a rule from a harmless command doesn't allow one that can't be undone", async () => {
  const seen: Record<string, boolean> = {};
  const { restore } = fake(async (_t, sink, signal) => {
    for (const command of ["rm notes.txt", "rm -rf ~/work"]) {
      const risk = commandRisk(command);
      const answer = sink.approve({ key: command, tool: "Bash", title: `Run ${command}`, risk, rule: ruleFor(command), fields: [{ label: "Command", value: command }] }, signal).catch(() => ({ allow: false }));
      seen[command] = (await answer).allow;
    }
  });
  try {
    const { store, runtime } = session();
    const go = runtime.send("t", "clean up");
    await until(() => asks(store.timeline("t")).length === 1, "the first asks");
    runtime.answer("t", asks(store.timeline("t"))[0].id, true, undefined, true);
    await until(() => seen["rm notes.txt"] === true, "allowed, for the session");
    await until(() => asks(store.timeline("t")).length === 1, "the second asks, rule or no rule");
    runtime.stop("t");
    await go;
    assert.equal(seen["rm -rf ~/work"], false);
  } finally {
    restore();
  }
});

test("approvals: a rule you gave in a routine's session doesn't let the routine reach outside this Mac", async () => {
  let pushed: boolean | undefined;
  const { restore } = fake(async (text, sink, signal) => {
    const answer = await sink.approve({ key: "p", tool: "Bash", title: "Push", risk: "medium", rule: "git push", fields: [{ label: "Command", value: "git push origin main" }] }, signal).catch(() => ({ allow: false }));
    if (text === "routine") pushed = answer.allow;
  });
  try {
    const { store, runtime } = session({ routine: { id: "r", run: "run" } });
    const yours = runtime.send("t", "you");
    await until(() => asks(store.timeline("t")).length === 1, "it asks you");
    runtime.answer("t", asks(store.timeline("t"))[0].id, true, undefined, true);
    await yours;
    await runtime.unattendedTurn("t", () => runtime.send("t", "routine"));
    assert.equal(pushed, false);
  } finally {
    restore();
  }
});

test("approvals: a routine can't push with git's own options in front, or an image", async () => {
  const pushed: boolean[] = [];
  const { restore } = fake(async (_t, sink, signal) => {
    for (const value of [`git -C "/tmp/a b" -c x=y push origin main`, "docker push me/app"]) pushed.push((await sink.approve({ key: value, tool: "Bash", title: "Push", risk: "medium", fields: [{ label: "Command", value }] }, signal)).allow);
  });
  try {
    const { runtime } = session();
    await runtime.unattendedTurn("t", () => runtime.send("t", "routine"));
    assert.deepEqual(pushed, [false, false]);
  } finally {
    restore();
  }
});

test("approvals: a request that arrives after its turn ended gets no card and holds nothing", async () => {
  let answer: { allow: boolean } | undefined;
  let question: unknown = "unset";
  const { restore } = fake(async (_t, sink, signal) => {
    setTimeout(() => {
      void sink.approve({ key: "late", tool: "Bash", title: "Run it", risk: "low", fields: [{ label: "Command", value: "make" }] }, signal).then((a) => (answer = a));
      void sink.ask([{ question: "Late?", options: [] }], signal).then((a) => (question = a));
    }, 20);
  });
  try {
    const { store, runtime } = session();
    await runtime.send("t", "go");
    await until(() => answer !== undefined && question !== "unset", "they're answered at once");
    assert.equal(answer!.allow, false);
    assert.equal(question, null);
    assert.equal(asks(store.timeline("t")).length, 0);
    assert.equal(store.thread("t").status, "done", "not left in Needs you");
  } finally {
    restore();
  }
});

test("approvals: Stop while the Reviewer reads a step: the step doesn't go ahead on its word", async () => {
  let answer: { allow: boolean } | undefined;
  const c = fake(async (_t, sink) => {
    // Claude Code's per-request signal, which isn't the turn's.
    answer = await sink.approve({ key: "s", tool: "Bash", title: "Run it", risk: "medium", fields: [{ label: "Command", value: "npm run build" }] }, new AbortController().signal);
  });
  let reading = false;
  let stopped = false;
  const r = fake(async (_t, sink, signal) => {
    reading = true;
    signal.addEventListener("abort", () => (stopped = true));
    await tick(60);
    sink.text("ALLOW: routine");
  }, "codex");
  try {
    const { store, runtime } = session({ access: "review" });
    const go = runtime.send("t", "build");
    await until(() => reading, "the Reviewer reads the step");
    runtime.stop("t");
    await tick();
    assert.equal(stopped, true, "and Stop reaches it");
    await go;
    assert.equal(answer!.allow, false);
    assert.ok(!store.timeline("t").some((x) => x.kind === "approval" && x.state === "approved"));
  } finally {
    c.restore();
    r.restore();
  }
});

/* The turn. */

test("turn: a turn stopped before it began a wake stops the tool's turn too", async () => {
  const { opened, restore } = fake(async () => {});
  try {
    const { runtime } = session();
    await runtime.send("t", "start");
    let cancelled = 0;
    let ran = 0;
    let pending = true;
    opened[0].wake!({
      pending: () => pending,
      cancel: () => ((pending = false), cancelled++),
      run: async () => void ran++,
    });
    assert.equal(runtime.isRunning("t"), true);
    runtime.stop("t");
    await until(() => !runtime.isRunning("t"), "it winds down");
    assert.equal(ran, 0);
    assert.equal(cancelled, 1, "left offered, the tool would go on by itself");
  } finally {
    restore();
  }
});

test("turn: a save that fails as a turn starts doesn't leave the session running for good", async () => {
  const { texts: sent, restore } = fake(async () => {});
  try {
    const { store, runtime } = session();
    const put = store.putItem.bind(store);
    store.putItem = ((id: string, item: Parameters<typeof put>[1], log?: boolean) => {
      if (item.kind === "turn" && item.status === "running") throw new Error("ENOSPC: no space left on device");
      return put(id, item, log);
    }) as typeof store.putItem;
    await runtime.send("t", "first").catch(() => {});
    assert.equal(runtime.isRunning("t"), false, "the turn let go");
    assert.equal(store.thread("t").status, "error");
    store.putItem = put;
    await runtime.send("t", "second");
    assert.match(sent.at(-1)!, /second$/, "the next message runs, it doesn't queue for ever");
    assert.equal(store.thread("t").status, "done");
  } finally {
    restore();
  }
});

test("turn: a save that fails after the tool finished doesn't leave the session looking at work", async () => {
  const { restore } = fake(async () => {});
  try {
    const { store, runtime } = session();
    const put = store.putItem.bind(store);
    store.putItem = ((id: string, item: Parameters<typeof put>[1], log?: boolean) => {
      if (item.kind === "turn" && item.status === "done") throw new Error("ENOSPC: no space left on device");
      return put(id, item, log);
    }) as typeof store.putItem;
    await runtime.send("t", "first").catch(() => {});
    store.putItem = put;
    assert.equal(runtime.isRunning("t"), false);
    assert.equal(store.thread("t").status, "error");
  } finally {
    restore();
  }
});

test("turn: a folder that's gone is named, and no tool opens in it", async () => {
  const { opened, restore } = fake(async () => {});
  try {
    const { store, runtime, dir } = session();
    rmSync(dir, { recursive: true });
    await runtime.send("t", "go");
    assert.equal(opened.length, 0);
    assert.equal(store.thread("t").status, "error");
    const error = store.timeline("t").find((x) => x.kind === "error");
    assert.ok(error?.kind === "error" && error.message.includes(dir), "the message says which folder");
  } finally {
    restore();
  }
});

test("goal: Stop between its turns stops the goal, it isn't left active", async () => {
  const { restore } = fake(async (_t, sink) => void sink.text("still working"));
  try {
    const dir = await repo();
    const { store, runtime } = session({}, undefined, dir);
    // Stop lands after the turn let go, while its last snapshot is taken.
    store.on((e) => {
      if (e.type === "item" && e.item.kind === "text" && !e.item.streaming && !store.thread("t").goal?.turns) return;
      if (e.type === "item" && e.item.kind === "text" && !e.item.streaming) setImmediate(() => runtime.stop("t"));
    });
    store.patchThread("t", { worktree: undefined });
    await runtime.startGoal("t", "all tests pass");
    await until(() => !runtime.isRunning("t"), "it stops");
    assert.equal(store.thread("t").goal?.status, "stopped");
    assert.equal(store.thread("t").goal?.turns, 1);
  } finally {
    restore();
  }
});

test("queue: a /goal sent while a turn runs starts a goal when it ends, with what came before it first", async () => {
  const { texts: sent, restore } = fake(async (text, sink) => {
    if (text === "first") await tick(30);
    sink.text("GOAL MET");
  });
  try {
    const { store, runtime } = session();
    const first = runtime.send("t", "first");
    await until(() => sent.length === 1, "the turn runs");
    await runtime.send("t", "/goal all tests pass");
    await runtime.send("t", "and then this");
    await first;
    await until(() => sent.length === 3 && !runtime.isRunning("t"), "the goal runs, then the message after it");
    assert.match(sent[1], /all tests pass[\s\S]*GOAL MET/, "as a goal, not as words");
    assert.match(sent[2], /and then this/);
    assert.equal(store.thread("t").goal?.status, "met");
  } finally {
    restore();
  }
});

test("queue: a /goal sent as a steer isn't words to the agent either", async () => {
  let steered = 0;
  const { texts: sent, restore } = fake({
    open: () => ({
      steer: () => (steered++, true),
      turn: async (text, sink) => {
        if (text === "first") await tick(40);
        sink.text("GOAL MET");
      },
    }),
  });
  try {
    const { store, runtime } = session();
    const first = runtime.send("t", "first");
    await until(() => sent.length === 1, "the turn runs");
    await tick(20);
    await runtime.send("t", "/goal all tests pass", "steer");
    await first;
    await until(() => sent.length === 2 && !runtime.isRunning("t"), "the goal runs");
    assert.equal(steered, 0);
    assert.equal(store.thread("t").goal?.status, "met");
  } finally {
    restore();
  }
});

test("queue: a /reviewer sent while a turn runs reads the change when it ends", async () => {
  const c = fake(async (text) => {
    if (text === "first") await tick(30);
  });
  const r = fake(async (_t, sink) => sink.text('<findings>{"verdict":"pass","summary":"Fine","findings":[]}</findings>'), "codex");
  try {
    const dir = await repo();
    const { store, runtime } = session({ turns: 1 }, undefined, dir);
    store.setSettings({ reviewSmall: true });
    await changed(store, dir);
    const first = runtime.send("t", "first");
    await until(() => c.texts.length === 1, "the turn runs");
    await runtime.send("t", "/reviewer");
    await first;
    await until(() => r.texts.length === 1 && !runtime.isRunning("t"), "the Reviewer reads it");
    assert.equal(c.texts.length, 1, "it isn't sent to the agent as words");
  } finally {
    c.restore();
    r.restore();
  }
});

test("compact: a /compact goes to the tool as it is, with nothing put in front of it", async () => {
  const { texts: sent, restore } = fake(async () => {});
  try {
    const { store, runtime } = session({ agent: "@claude:claude-sonnet-5-5" });
    await runtime.send("t", "explain this");
    // Another model spoke since: nothing of it goes in front of the command.
    store.putItem("t", { kind: "turn", id: "other", turn: 2, at: 1, agent: "@claude:claude-opus-5-5", model: "claude:claude-opus-5-5", status: "done" });
    store.putItem("t", { kind: "text", id: "said", turn: 2, at: 1, text: "another model spoke", streaming: false });
    store.patchThread("t", { turns: 2 });
    await runtime.send("t", "/compact");
    assert.equal(sent.at(-1), "/compact");
  } finally {
    restore();
  }
});

test("compact: in a session that knows nothing yet it's not sent as words, and the next message still gets the conversation", async () => {
  const { texts: sent, restore } = fake(async () => {});
  try {
    const { store, runtime } = session({ turns: 1, providerSession: "codex:old" });
    store.putItem("t", { kind: "user", id: "u", turn: 1, at: 1, text: "the earlier ask" });
    await runtime.send("t", "/compact");
    assert.equal(sent.length, 0, "the model isn't asked to answer it");
    assert.equal(store.thread("t").status, "done");
    assert.ok(store.timeline("t").some((x) => x.kind === "notice" && /Nothing to compact yet/.test(x.text)));
    await runtime.send("t", "carry on");
    assert.match(sent[0], /the earlier ask/);
  } finally {
    restore();
  }
});

/* The Reviewer. */

test("reviewer: Stop as the read ends, with a verdict in hand, doesn't leave the session running", async () => {
  const { restore } = fake(async () => {});
  let runtime!: Runtime;
  const r = fake(async (_t, sink) => {
    runtime.stop("t");
    sink.text('<findings>{"verdict":"fail","summary":"No","findings":[{"file":"a.txt","severity":"blocking","note":"wrong"}]}</findings>');
  }, "codex");
  try {
    const dir = await repo();
    const s = session({ turns: 1 }, undefined, dir);
    runtime = s.runtime;
    s.store.setSettings({ reviewSmall: true });
    await changed(s.store, dir);
    await runtime.review("t", 1, 1);
    assert.equal(runtime.isRunning("t"), false);
    assert.equal(s.store.thread("t").status, "done");
    const review = s.store.timeline("t").find((x) => x.kind === "review");
    assert.equal(review?.kind === "review" && review.status, "error");
  } finally {
    restore();
    r.restore();
  }
});

test("reviewer: a verdict that isn't a pass doesn't pass", () => {
  for (const verdict of ["blocked", "needs changes", "no", "reject"]) assert.equal(parseFindings(`<findings>{"verdict":"${verdict}","summary":"x","findings":[]}</findings>`)?.verdict, "fail", verdict);
  assert.equal(parseFindings('<findings>{"verdict":"Pass","findings":[]}</findings>')?.verdict, "pass");
  assert.equal(parseFindings('<findings>{"findings":[{"file":"a","severity":"note","note":"n"}]}</findings>')?.verdict, "pass", "no verdict and nothing blocking still passes");
});

test("reviewer: a fail with nothing marked blocking still tells the lead what's wrong", () => {
  const f = [{ file: "a.ts", line: 3, severity: "note" as const, note: "this drops the last row" }];
  assert.match(fixPrompt("GPT", f, "Rows go missing"), /a\.ts:3: this drops the last row/);
  assert.match(fixPrompt("GPT", [], "Rows go missing"), /Rows go missing/);
});

/* Restarts and limits. */

test("restart: a turn cut off by a crash still gets its checkpoint, so its changes can be seen and undone", async () => {
  const { texts: sent, restore } = fake(async () => {});
  try {
    const dir = await repo();
    const home = mkdtempSync(join(tmpdir(), "lc-audit-"));
    const a = session({ turns: 1, status: "running" }, home, dir);
    a.store.putItem("t", { kind: "user", id: "u", turn: 1, at: 1, text: "edit it" });
    a.store.putItem("t", { kind: "turn", id: "m", turn: 1, at: 1, agent: "forge", model: "claude:claude-opus-5-5", status: "running" });
    await capture(dir, "t/1-before");
    writeFileSync(join(dir, "a.txt"), "one\nwritten before the crash\n");
    a.store.flush();

    const b = session({}, home, dir);
    b.store.patchThread("t", { worktree: undefined });
    assert.deepEqual(b.runtime.continueAfterRestart(), ["t"]);
    await until(() => sent.length === 1 && !b.runtime.isRunning("t"), "it carries on");
    const cp = b.store.timeline("t").find((x) => x.kind === "checkpoint" && x.turn === 1);
    assert.ok(cp?.kind === "checkpoint" && cp.from && cp.to, "turn 1 has its snapshots");
    assert.deepEqual(cp.files.map((f) => f.path), ["a.txt"]);
  } finally {
    restore();
  }
});

test("restart: with carrying on off, a cut turn still gets its checkpoint", async () => {
  const { restore } = fake(async () => {});
  try {
    const dir = await repo();
    const home = mkdtempSync(join(tmpdir(), "lc-audit-"));
    const a = session({ turns: 1, status: "running" }, home, dir);
    a.store.setSettings({ continueAfterRestart: false });
    a.store.putItem("t", { kind: "turn", id: "m", turn: 1, at: 1, agent: "forge", model: "claude:claude-opus-5-5", status: "running" });
    await capture(dir, "t/1-before");
    writeFileSync(join(dir, "a.txt"), "changed\n");
    a.store.flush();
    const b = session({}, home, dir);
    assert.deepEqual(b.runtime.continueAfterRestart(), []);
    await until(() => b.store.timeline("t").some((x) => x.kind === "checkpoint"), "the checkpoint lands");
  } finally {
    restore();
  }
});

test("restart: what's in the queue stays held when nothing carries on; an edit of it doesn't send it", async () => {
  const { texts: sent, restore } = fake(async () => {});
  try {
    const home = mkdtempSync(join(tmpdir(), "lc-audit-"));
    const a = session({ queue: [{ id: "q1", text: "one", at: 1 }, { id: "q2", text: "two", at: 2 }] }, home);
    a.store.flush();
    const { store, runtime } = session({}, home);
    runtime.setQueue("t", [store.thread("t").queue![0]]);
    await tick(30);
    assert.equal(sent.length, 0, "taking one out doesn't send the other");
    await runtime.send("t", "now");
    await until(() => sent.length === 2 && !runtime.isRunning("t"), "your next message does");
  } finally {
    restore();
  }
});

test("limits: a window that reopened more than a day ago doesn't start a turn by itself", async () => {
  const { texts: sent, restore } = fake(async () => {});
  try {
    const now = Date.now();
    const at = (until: number) => {
      const s = session({ status: "limited", turns: 1, limit: { message: "used up", until, provider: "claude" } });
      s.store.setSettings({ resumeAtReset: true });
      s.store.putItem("t", { kind: "limit", id: "l", turn: 1, at: until - 3_600_000, message: "used up", until, provider: "claude" });
      return s;
    };
    const old = at(now - 24 * 3_600_000 - 1);
    old.runtime.resumeLimited(now);
    await tick(20);
    assert.equal(sent.length, 0, "24 hours and a moment is too old");
    assert.equal(old.store.thread("t").status, "limited");
    const edge = at(now - 24 * 3_600_000);
    edge.runtime.resumeLimited(now);
    await until(() => sent.length === 1, "exactly a day still goes");
  } finally {
    restore();
  }
});

test("limits: carrying on to another model drops the old model's context window", async () => {
  const { restore } = fake(async () => {});
  try {
    const { store, runtime } = session({ agent: "@claude:claude-opus-5-5", status: "limited", turns: 1, usage: { ...emptyUsage(), contextTokens: 900000, contextWindow: 1000000 } });
    store.putItem("t", { kind: "user", id: "u", turn: 1, at: 1, text: "hi" });
    store.putItem("t", { kind: "limit", id: "l", turn: 1, at: 1, message: "out", provider: "claude", fallback: "claude:claude-sonnet-5-5" });
    runtime.send = (async () => {}) as typeof runtime.send;
    await runtime.carryOn("t", "claude:claude-sonnet-5-5");
    assert.equal(store.thread("t").usage.contextWindow, undefined);
  } finally {
    restore();
  }
});

test("limits: a limit first said with no reset time takes one a later report gives", async () => {
  const until0 = Date.now() + 3_600_000;
  const { restore } = fake(async (_t, sink) => {
    sink.limited("out of usage");
    sink.limited("out of usage", until0);
  });
  try {
    const { store, runtime } = session();
    await runtime.send("t", "go");
    assert.equal(store.thread("t").limit?.until, until0, "so it can carry on at reset");
    const said = store.timeline("t").find((x) => x.kind === "limit");
    assert.equal(said?.kind === "limit" && said.until, until0);
    assert.equal(store.timeline("t").filter((x) => x.kind === "limit").length, 1);
  } finally {
    restore();
  }
});

test("approvals: an agent's card asked with no turn running doesn't leave the session in Needs you", async () => {
  const { store, runtime } = session({ status: "done" });
  const { id, answer } = runtime.askLiner("t", { tool: "x", title: "Add it", risk: "low", fields: [] });
  assert.equal(store.thread("t").status, "waiting");
  runtime.answer("t", id, true);
  await answer;
  assert.equal(store.thread("t").status, "done");
});

/* Pull request tests. */

test("pull requests: Stop ends tests that ignore being asked to", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-audit-pr-"));
  writeFileSync(join(dir, "stub.sh"), "#!/bin/sh\ntrap '' TERM\nsleep 30 &\nwait\nsleep 30\n", { mode: 0o755 });
  const { store, runtime } = session({ access: "full", turns: 1 }, undefined, dir);
  store.putProject({ ...store.project("p"), scripts: [{ id: "s", name: "Test", command: "sh ./stub.sh" }] as never });
  store.putItem("t", { kind: "pr", id: "card", turn: 1, at: 1 });
  const going = runtime.prTest("t", "card");
  await until(() => store.timeline("t").some((x) => x.kind === "tool"), "the tests run");
  await tick(100);
  runtime.stop("t");
  const result = await Promise.race([going, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
  assert.ok(result, "it ends within the moment a process group gets");
  assert.equal(result.state, "failed");
});

/* Snapshots. */

test("diff card: one reply holds a shared budget, and a cut never splits an emoji", async () => {
  const dir = await repo();
  const big = Array.from({ length: 12 }, (_, i) => `big${i}.txt`);
  const from = (await capture(dir, "t/1-before"))!;
  for (const f of big) writeFileSync(join(dir, f), `${"x".repeat(399_999)}😀 and more`);
  const to = (await capture(dir, "t/1-after"))!;
  const out = await diffFiles(dir, from, to, big.map((path) => ({ path, status: "added" as const, added: 1, removed: 0, rel: true })));
  const total = out.reduce((n, f) => n + (f.after?.length ?? 0), 0);
  assert.ok(total < 4_100_000, `${total} characters`);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(out[0].after!), "no half an emoji");
  assert.match(out[0].after!, /cut off/);
  assert.ok(out[11].after !== undefined, "a file past the budget still says it was cut");
});

/* Reading commands. */

test("risk: a command named like a reader isn't one", () => {
  for (const c of ["tree-sitter generate", "cat-file-writer x", "ls-rm src", "file-rename a b", "grep-replace a b", "sed-inplace x", "find-and-delete .", "rg-replace a b", "head-writer"]) assert.equal(readsOnly(c), false, c);
  for (const c of ["ls", "cat a", "tree", "git ls-files", "git rev-parse HEAD"]) assert.equal(readsOnly(c), true, c);
});

test("risk: git's own options in front of a command don't hide what it does", () => {
  for (const c of [`git -C /tmp/x reset --hard`, `git -C "/a b" push --force`, "git -c core.x=y clean -fd", "git --git-dir=.git --work-tree=. checkout -- .", "git --no-pager branch -D main"]) assert.equal(commandRisk(c), "high", c);
  assert.equal(commandRisk("git -C /tmp/x status"), "low");
});

test("risk: what can't be undone, however its flags are placed", () => {
  for (const c of ["git clean --force -d", "git clean -d --force", "git clean -d -f", "git reset HEAD~2 --hard", "git reset origin/main --hard"]) assert.equal(commandRisk(c), "high", c);
  for (const c of ["git reset --soft HEAD~1", "git clean -n"]) assert.notEqual(commandRisk(c), "high", c);
  for (const c of ["pnpm publish", "yarn publish --access public", "gem push x.gem", "twine upload dist/*"]) assert.equal(commandRisk(c), "high", c);
});

test("rules: git's own options in front get no rule, or the rule would allow every git command written that way", () => {
  for (const c of ["git -C /tmp/x status", "git --no-pager log", "npm --prefix app publish"]) assert.equal(ruleFor(c), undefined, c);
  assert.equal(ruleFor("git status"), "git status");
  assert.equal(ruleFor("make"), "make");
});

/* Processes. */

test("exec: a last line of JSON with no new line after it still counts", async () => {
  const stream = new PassThrough();
  const got: unknown[] = [];
  jsonLines(stream, (v) => got.push(v));
  stream.write('{"a":1}\n{"b":');
  stream.end("2}");
  await new Promise((r) => stream.once("end", r));
  await tick();
  assert.deepEqual(got, [{ a: 1 }, { b: 2 }]);
});

test("exec: a command that can't start says why", async () => {
  const r = await run("liner-no-such-command", []);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /ENOENT/);
  const gone = await run("git", ["status"], { cwd: join(tmpdir(), "lc-no-such-folder") });
  assert.notEqual(gone.code, 0);
  assert.ok(gone.stderr, "not an empty error");
});

test("exec: a command that ends without reading what it's given doesn't take the engine down", async () => {
  for (let i = 0; i < 5; i++) {
    const r = await run("true", [], { input: "x".repeat(4 * 1024 * 1024) });
    assert.equal(r.code, 0);
  }
  // A beat for an EPIPE still on its way, which would fail this test as an uncaught error.
  await new Promise((r) => setTimeout(r, 50));
});

/* Routines. */

/** A gh on PATH, answering by its arguments. */
function gh(script: string) {
  const bin = mkdtempSync(join(tmpdir(), "lc-audit-gh-"));
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$@" >> ${bin}/log\n${script}\n`, { mode: 0o755 });
  return { env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` }, log: () => readFileSync(join(bin, "log"), "utf8") };
}
const base = { name: "r", on: true, projectId: "p", trigger: { kind: "webhook", secret: "s" }, runsGo: "own", pauseAfter: 0, limits: { mergesPerDay: 9, tokensPerRun: 0 } } as const;
async function finish(routines: Routines, id: string) {
  await until(() => routines.recent.some((r) => r.routineId === id && r.status !== "running"), "the run ends");
  return routines.recent.findLast((r) => r.routineId === id)!;
}

test("routines: a GitHub trigger asks gh only for what gh can give, and sees a pull request opened since", async () => {
  const fired: string[] = [];
  // gh refuses a field it doesn't know, as gh 2.98 does authorAssociation; the REST list carries it.
  const fakeGh = gh(`case "$*" in
  *--json*authorAssociation*) echo 'Unknown JSON field: "authorAssociation"' >&2; exit 1;;
  api*pulls*) cat "$(dirname "$0")/open.json";;
  esac`);
  const bin = fakeGh.env.PATH.split(":")[0];
  const home = mkdtempSync(join(tmpdir(), "lc-audit-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-audit-dir-")), git: false, createdAt: 1 });
  const routines = new Routines(store, {} as never, fakeGh.env);
  (routines as unknown as { fire: (id: string, cause: string, ctx: unknown) => Promise<void> }).fire = async (_id, cause) => void fired.push(cause);
  const r = routines.put({ ...base, trigger: { kind: "webhook", secret: "s" }, steps: [] });
  const poll = (routines as unknown as { poll: (r: unknown, quiet?: boolean) => Promise<void> }).poll.bind(routines);
  const open = (...prs: { number: number; title: string; user: string; assoc: string }[]) => writeFileSync(join(bin, "open.json"), JSON.stringify(prs.map((p) => ({ number: p.number, title: p.title, html_url: `https://x/${p.number}`, user: { login: p.user }, author_association: p.assoc }))));
  const github = { ...r, trigger: { kind: "github", event: "pr.opened", outside: true } };
  open({ number: 1, title: "old", user: "a", assoc: "MEMBER" });
  await poll(github, true);
  open({ number: 1, title: "old", user: "a", assoc: "MEMBER" }, { number: 2, title: "ours", user: "b", assoc: "MEMBER" }, { number: 3, title: "theirs", user: "c", assoc: "CONTRIBUTOR" });
  await poll(github);
  assert.deepEqual(fired, ["c opened #3"], "the first look only notes; a team member's doesn't count as outside");
});

test("routines: an issue trigger leaves out the pull requests GitHub lists with issues", async () => {
  const fired: string[] = [];
  const fakeGh = gh(`case "$*" in
  api*issues*) cat "$(dirname "$0")/open.json";;
  esac`);
  const bin = fakeGh.env.PATH.split(":")[0];
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-audit-")));
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-audit-dir-")), git: false, createdAt: 1 });
  const routines = new Routines(store, {} as never, fakeGh.env);
  (routines as unknown as { fire: (id: string, cause: string, ctx: unknown) => Promise<void> }).fire = async (_id, cause) => void fired.push(cause);
  const r = routines.put({ ...base, steps: [] });
  const poll = (routines as unknown as { poll: (r: unknown, quiet?: boolean) => Promise<void> }).poll.bind(routines);
  const github = { ...r, trigger: { kind: "github", event: "issue.opened" } };
  writeFileSync(join(bin, "open.json"), "[]");
  await poll(github, true);
  writeFileSync(join(bin, "open.json"), JSON.stringify([{ number: 4, title: "a pull request", user: { login: "d" }, html_url: "u", pull_request: {} }, { number: 5, title: "an issue", user: { login: "e" }, html_url: "u" }]));
  await poll(github);
  assert.deepEqual(fired, ["e opened #5"]);
});

test("routines: the gate's deny list takes the patterns its builder offers", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-audit-")));
  const routines = new Routines(store, {} as never, process.env);
  const check = (files: string[], deny: string[]) => (routines as unknown as { check: (...a: unknown[]) => Promise<{ ok: boolean }[]> }).check({ kind: "gate", rules: [{ kind: "paths", deny }] }, { files }, undefined, tmpdir()).then((r) => r[0].ok);
  const deny = [".github/", "infra/", "*.lock"];
  assert.equal(await check(["pnpm.lock"], deny), false);
  assert.equal(await check(["web/yarn.lock"], deny), false);
  assert.equal(await check([".github/workflows/ci.yml"], deny), false);
  assert.equal(await check(["src/lock.ts", "src/app.locks"], deny), true);
  assert.equal(await check(["src/.env"], [".env"]), false, "a bare name still matches in any folder");
});

test("routines: one audit that fails isn't undone by a later one that passes", async () => {
  const says = ['<findings>{"verdict":"fail","summary":"No","findings":[{"file":"a","severity":"blocking","note":"bad"}]}</findings>', '<findings>{"verdict":"pass","summary":"Fine","findings":[]}</findings>'];
  let i = 0;
  const fakeGh = gh("exit 0");
  const { restore } = fake(async (_t, sink) => sink.text(says[i++]));
  try {
    const { store, runtime } = session();
    const routines = new Routines(store, runtime, fakeGh.env);
    const r = routines.put({ ...base, steps: [{ kind: "ai", role: "audit", agent: "@claude:claude-opus-5-5", prompt: "audit" }, { kind: "ai", role: "audit", agent: "@claude:claude-opus-5-5", prompt: "audit again" }, { kind: "gate", rules: [{ kind: "reviewer" }] }, { kind: "action", action: "notify", when: "pass" }] });
    await routines.fire(r.id, "test");
    const done = await finish(routines, r.id);
    assert.equal(done.rules?.[0].ok, false);
    assert.equal(done.status, "handed");
  } finally {
    restore();
  }
});

test("routines: a work step cut off by a usage limit isn't done, and what follows on a pass doesn't run", async () => {
  const fakeGh = gh("exit 0");
  const { restore } = fake(async (_t, sink) => sink.limited("out of usage"));
  try {
    const { store, runtime } = session();
    const routines = new Routines(store, runtime, fakeGh.env);
    const r = routines.put({ ...base, steps: [{ kind: "ai", role: "work", agent: "@claude:claude-opus-5-5", prompt: "work" }, { kind: "action", action: "notify", when: "pass" }] });
    await routines.fire(r.id, "test");
    const done = await finish(routines, r.id);
    assert.equal(done.steps[0].status, "failed");
    assert.equal(done.status, "handed");
    assert.equal(done.steps.length, 1, "the pass path doesn't run");
  } finally {
    restore();
  }
});

test("routines: a work step you stopped from its session isn't done either", async () => {
  const fakeGh = gh("exit 0");
  let started = false;
  const { restore } = fake(async (_t, _s, signal) => {
    started = true;
    while (!signal.aborted) await tick();
  });
  try {
    const { store, runtime } = session();
    const routines = new Routines(store, runtime, fakeGh.env);
    const r = routines.put({ ...base, steps: [{ kind: "ai", role: "work", agent: "@claude:claude-opus-5-5", prompt: "work" }, { kind: "action", action: "notify", when: "pass" }] });
    await routines.fire(r.id, "test");
    await until(() => started, "it works");
    runtime.stop(routines.recent.at(-1)!.threadId!);
    const done = await finish(routines, r.id);
    assert.equal(done.steps[0].status, "failed");
    assert.equal(done.steps.length, 1);
  } finally {
    restore();
  }
});

test("routines: a run's tokens are its own, not everything its one session ever used", async () => {
  const fakeGh = gh("exit 0");
  const { restore } = fake(async (_t, sink) => sink.usage({ inputTokens: 100, outputTokens: 20 }));
  try {
    const { store, runtime } = session();
    const routines = new Routines(store, runtime, fakeGh.env);
    const r = routines.put({ ...base, runsGo: "one", steps: [{ kind: "ai", role: "work", agent: "@claude:claude-opus-5-5", prompt: "work" }] });
    await routines.fire(r.id, "one");
    await finish(routines, r.id);
    assert.equal(routines.recent.at(-1)!.tokens, 120);
    const before = routines.recent.at(-1)!.id;
    await routines.fire(r.id, "two");
    await until(() => routines.recent.at(-1)!.id !== before && routines.recent.at(-1)!.status !== "running", "the second run ends");
    assert.equal(routines.recent.at(-1)!.tokens, 120);
  } finally {
    restore();
  }
});

test("routines: a step cut off by the engine stopping doesn't spin for ever", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-audit-"));
  writeFileSync(join(home, "routines.json"), JSON.stringify({ routines: [], runs: [{ id: "x", routineId: "r", at: 1, cause: "c", status: "running", steps: [{ label: "Work", status: "running", at: 1 }] }] }));
  const routines = new Routines(new Store(home), {} as never, process.env);
  assert.equal(routines.recent[0].status, "failed");
  assert.equal(routines.recent[0].steps[0].status, "failed");
});
