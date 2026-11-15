/*
  The agent opened before you press send: a turn's tool opens while its snapshot is taken, and a session's tool opens as you
  start writing (Runtime.warm, thread.warm), once, with what its opening said reaching the first turn. Fake tools stand in.
  Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { OpenOptions, Provider, ProviderSession, TurnSink } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const ready = [info("claude", ["claude-opus-5-5", "claude-sonnet-5-5"])];
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 300 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}

type Made = { o: OpenOptions; warms: number; closed: boolean; texts: string[] };
type Opts = { work?: (text: string, sink: TurnSink, signal: AbortSignal, m: Made) => Promise<void> | void; warm?: ((m: Made) => Promise<void>) | false; open?: (o: OpenOptions) => void; close?: () => Promise<void> | void };
/** Claude Code, faked: every session it opens, how often each was warmed and closed, and what each turn was sent. */
function fake(x: Opts = {}) {
  const made: Made[] = [];
  const p: Provider = {
    id: "claude",
    detect: async () => ready[0],
    // A tool with nothing to start ahead says so before anything opens (Provider.warms).
    ...(x.warm === false ? {} : { warms: () => true }),
    open: (o) => {
      x.open?.(o);
      const m: Made = { o, warms: 0, closed: false, texts: [] };
      made.push(m);
      const s: ProviderSession = {
        turn: async (text, sink, signal) => {
          m.texts.push(text);
          await x.work?.(text, sink, signal, m);
        },
        close: () => {
          m.closed = true;
          return x.close?.();
        },
      };
      const warm = x.warm;
      if (warm !== false)
        s.warm = async () => {
          m.warms++;
          await warm?.(m);
        };
      return s;
    },
  };
  const saved = providers.claude;
  providers.claude = p;
  return { made, restore: () => (providers.claude = saved) };
}

function setup(threads: Partial<Thread>[] = [{}], o: { git?: boolean; dir?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), "lc-warm-"));
  const dir = o.dir ?? mkdtempSync(join(tmpdir(), "lc-warm-dir-"));
  if (o.git) {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    writeFileSync(join(dir, "a.txt"), "a\n");
  }
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: Boolean(o.git), createdAt: Date.now() });
  for (const [i, extra] of threads.entries()) store.putThread({ id: i ? `t${i + 1}` : "t", projectId: "p", title: "New session", agent: "forge", status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = ready;
  return { store, runtime, dir };
}

test("warm then send: one session, opened once, warmed, and the turn runs on it", async () => {
  const f = fake();
  try {
    const { runtime } = setup();
    await runtime.warm("t");
    assert.equal(f.made.length, 1, "warm opens the lead's session");
    assert.equal(f.made[0].warms, 1, "and starts its tool");
    assert.equal((await runtime.inspect("t")).live, true, "kept live for the turn");
    await runtime.send("t", "hello");
    assert.equal(f.made.length, 1, "the turn takes the warmed session rather than opening another");
    assert.deepEqual(f.made[0].texts, ["hello"]);
    assert.equal(f.made[0].closed, false);
    // A second warm of a session that's live does nothing.
    await runtime.warm("t");
    assert.equal(f.made.length, 1);
  } finally {
    f.restore();
  }
});

test("a message sent while a slow open is under way waits for it and opens nothing of its own", async () => {
  let release!: () => void;
  const slow = new Promise<void>((r) => (release = r));
  let slowClose = false;
  const f = fake({ close: () => (slowClose ? slow : undefined) });
  try {
    const { runtime } = setup();
    // A session of the thread still being ended holds every new opening of it (Runtime.ending).
    await runtime.warm("t");
    slowClose = true;
    runtime.restartIdle("claude");
    slowClose = false;
    const warming = runtime.warm("t");
    const sending = runtime.send("t", "hello");
    await tick(30);
    assert.equal(f.made.length, 1, "nothing opens while the old one is still ending");
    release();
    await Promise.all([warming, sending]);
    assert.equal(f.made.length, 2, "the warm and the send open the one session between them");
    assert.deepEqual(f.made[1].texts, ["hello"], "and the turn ran on it");
  } finally {
    f.restore();
  }
});

test("a warmed session that starts knowing nothing still hands the conversation to its first turn", async () => {
  const f = fake();
  try {
    const { store, runtime } = setup([{ turns: 1, title: "Earlier" }]);
    store.putItem("t", { kind: "user", id: "u1", turn: 1, at: Date.now(), text: "write the parser" });
    store.putItem("t", { kind: "text", id: "x1", turn: 1, at: Date.now(), text: "The parser is in parse.ts.", streaming: false });
    store.patchThread("t", { effortNow: "high" });
    await runtime.warm("t");
    await runtime.send("t", "now the tests");
    const sent = f.made[0].texts[0];
    assert.match(sent, /You were asked: write the parser/, "the handoff reaches the warmed session's first turn");
    assert.match(sent, /now the tests$/);
    assert.equal(store.thread("t").effortNow, undefined, "a fresh session's thinking level is its own to say again");
    // Told once: the next turn carries on without it.
    await runtime.send("t", "and the docs");
    assert.equal(f.made[0].texts[1], "and the docs");
  } finally {
    f.restore();
  }
});

test("a session moved to another tool, warmed, says so on its first turn", async () => {
  const f = fake();
  try {
    const { store, runtime } = setup([{ turns: 1, providerSession: "codex:th-1" }]);
    store.putItem("t", { kind: "user", id: "u1", turn: 1, at: Date.now(), text: "first" });
    await runtime.warm("t");
    await runtime.send("t", "second");
    assert.match(f.made[0].texts[0], /You were asked: first/);
    assert.ok(store.timeline("t").some((x) => x.kind === "notice" && /takes over here/.test(x.text)), "the switch is said, as when the turn opens it itself");
  } finally {
    f.restore();
  }
});

test("a stop while the snapshot and the opening both run starts nothing and leaves nothing live", async () => {
  let release!: () => void;
  const slow = new Promise<void>((r) => (release = r));
  let slowClose = false;
  const f = fake({ close: () => (slowClose ? slow : undefined) });
  try {
    const { store, runtime } = setup([{}], { git: true });
    await runtime.warm("t");
    slowClose = true;
    runtime.restartIdle("claude");
    slowClose = false;
    const sending = runtime.send("t", "hello");
    await tick(20);
    runtime.stop("t");
    release();
    await sending;
    const opened = f.made.at(-1)!;
    assert.deepEqual(opened.texts, [], "the tool never heard the prompt");
    assert.equal(opened.closed, true, "a fresh session that heard nothing is closed");
    assert.equal((await runtime.inspect("t")).live, false, "and nothing is left live");
    assert.ok(store.timeline("t").some((x) => x.kind === "notice" && x.text === "You stopped this turn."));
    assert.ok(!store.timeline("t").some((x) => x.kind === "error"), "a stop isn't an error");
  } finally {
    f.restore();
  }
});

test("a warmed session nobody sends to is closed after the time limit", async () => {
  const f = fake();
  try {
    const { runtime } = setup();
    runtime.warmMs = 40;
    await runtime.warm("t");
    await until(() => f.made[0].closed, "closed once its time is up");
    assert.equal((await runtime.inspect("t")).live, false);
    // Sent to in time, it's the turn's and nothing closes it.
    await runtime.warm("t");
    await runtime.send("t", "hi");
    await tick(80);
    assert.equal(f.made[1].closed, false, "a session a turn took is left alone");
  } finally {
    f.restore();
  }
});

test("a third warmed and unused session closes the oldest", async () => {
  const f = fake();
  try {
    const { runtime } = setup([{}, {}, {}]);
    await runtime.warm("t");
    await tick(2);
    await runtime.warm("t2");
    await tick(2);
    await runtime.warm("t3");
    assert.equal(f.made.length, 3);
    assert.deepEqual(
      f.made.map((m) => m.closed),
      [true, false, false],
      "the oldest unused one goes",
    );
    assert.equal((await runtime.inspect("t")).live, false);
    assert.equal((await runtime.inspect("t3")).live, true);
  } finally {
    f.restore();
  }
});

test("warm does nothing for a running, archived or side session, a fork, the Demo, or a tool that can't open ahead", async () => {
  const f = fake({ work: (_t, _s, signal) => new Promise((r) => signal.addEventListener("abort", () => r(), { once: true })) });
  const demoSaved = providers.demo;
  let demoOpens = 0;
  providers.demo = { ...demoSaved, open: (o) => (demoOpens++, demoSaved.open(o)) };
  try {
    const { store, runtime } = setup([{}, { archived: true }, { sideOf: "t" }, { forkSession: "claude:s1" }, { agent: "demo" }]);
    const running = runtime.send("t", "work");
    await until(() => runtime.isRunning("t") && f.made.length === 1, "the turn runs");
    for (const id of ["t", "t2", "t3", "t4", "t5"]) await runtime.warm(id);
    assert.equal(f.made.length, 1, "nothing more opened");
    assert.equal(demoOpens, 0, "the Demo has no start to save");
    runtime.stop("t");
    await running;
    assert.equal(store.thread("t2").archived, true);
  } finally {
    providers.demo = demoSaved;
    f.restore();
  }
  let closes = 0;
  const g = fake({ warm: false, close: () => void closes++ });
  try {
    const { runtime } = setup();
    await runtime.warm("t");
    assert.equal(g.made.length, 0, "a tool with nothing to start ahead isn't opened");
    assert.equal(closes, 0, "nor closed");
    assert.equal((runtime as unknown as { closing: Map<string, unknown> }).closing.size, 0, "so no close holds the next message");
    assert.equal((await runtime.inspect("t")).live, false);
    const started = Date.now();
    await runtime.send("t", "hi");
    assert.deepEqual(g.made[0].texts, ["hi"], "the send right after opens it itself");
    assert.ok(Date.now() - started < 500);
  } finally {
    g.restore();
  }
});

test("a failing open or start under warm leaves the next turn working", async () => {
  let fail = true;
  const f = fake({
    open: () => {
      if (fail) throw new Error("no such tool");
    },
  });
  try {
    const { store, runtime } = setup();
    await runtime.warm("t");
    assert.equal(f.made.length, 0);
    fail = false;
    await runtime.send("t", "hi");
    assert.deepEqual(f.made[0].texts, ["hi"]);
    assert.ok(!store.timeline("t").some((x) => x.kind === "error"), "the warm's failure isn't said");
  } finally {
    f.restore();
  }
  let bad = true;
  const g = fake({
    warm: async () => {
      if (bad) throw new Error("didn't start");
    },
  });
  try {
    const { runtime } = setup();
    await runtime.warm("t");
    await until(() => g.made[0]?.closed === true, "a session whose start failed is let go");
    bad = false;
    await runtime.send("t", "hi");
    assert.equal(g.made.length, 2, "the turn opens it again");
    assert.deepEqual(g.made[1].texts, ["hi"]);
  } finally {
    g.restore();
  }
});

test("a turn's snapshot is taken before the prompt goes, its tool started beside it", async () => {
  const f = fake({
    work: (_text, _sink, _signal, m) => {
      // The before snapshot is there already, and the tool was started as the turn opened it.
      execFileSync("git", ["rev-parse", "--verify", "-q", "refs/liner/t/1-before"], { cwd: m.o.cwd });
      assert.equal(m.warms, 1);
      writeFileSync(join(m.o.cwd, "b.txt"), "b\n");
    },
  });
  try {
    const { store, runtime } = setup([{}], { git: true });
    await runtime.send("t", "add b");
    const cp = store.timeline("t").find((x) => x.kind === "checkpoint");
    assert.ok(cp && cp.kind === "checkpoint", "the turn left a checkpoint");
    assert.deepEqual(cp.files.map((x) => x.path), ["b.txt"], "with only what the agent wrote after it heard the prompt: a.txt was in the snapshot already");
    assert.ok(!store.timeline("t").some((x) => x.kind === "error"));
  } finally {
    f.restore();
  }
});

test("the missing-folder and no-snapshot notices are as they were", async () => {
  const f = fake();
  try {
    const gone = join(tmpdir(), `lc-warm-gone-${Date.now()}`);
    const { store, runtime } = setup([{}], { dir: gone });
    assert.equal(existsSync(gone), false);
    await runtime.send("t", "hi");
    assert.equal(f.made.length, 0, "nothing opens in a folder that's gone");
    const err = store.timeline("t").find((x) => x.kind === "error");
    assert.ok(err && err.kind === "error" && err.message === `This session's folder isn't there any more: ${gone}`);
  } finally {
    f.restore();
  }
  const g = fake();
  try {
    const { store, runtime, dir } = setup([{}], { git: true });
    // A file where git keeps Liner Code's refs: the snapshot can't be saved.
    writeFileSync(join(dir, ".git", "refs", "liner"), "");
    await runtime.send("t", "hi");
    assert.deepEqual(g.made[0].texts, ["hi"], "the turn still runs");
    const said = store.timeline("t").filter((x) => x.kind === "notice" && x.text === "Couldn't snapshot this turn, so its changes can't be shown or undone.");
    assert.ok(said.length >= 1, "and says it has no snapshot");
  } finally {
    g.restore();
  }
});

test("a session warm opened is let go when the thread moved on while it opened: another agent, or a rewind", async () => {
  let release!: () => void;
  let slow = new Promise<void>((r) => (release = r));
  let slowClose = false;
  const f = fake({ close: () => (slowClose ? slow : undefined) });
  try {
    const { store, runtime } = setup([{ providerSession: "claude:s1" }]);
    // Each opening below waits on a close still ending, while the thread changes under it.
    const hold = async () => {
      slow = new Promise<void>((r) => (release = r));
      await runtime.warm("t");
      slowClose = true;
      runtime.restartIdle("claude");
      slowClose = false;
    };
    await hold();
    const moved = runtime.warm("t");
    await tick(20);
    store.patchThread("t", { agent: "@claude:claude-sonnet-5-5" });
    release();
    await moved;
    assert.equal(f.made.at(-1)!.closed, true, "opened for the old agent: closed, not left 10 minutes");
    assert.equal((await runtime.inspect("t")).live, false);
    store.patchThread("t", { agent: "forge" });
    await hold();
    const rewound = runtime.warm("t");
    await tick(20);
    assert.equal(f.made.at(-1)!.o.resume, "s1", "it opened on the conversation as it was");
    // A rewind clears the conversation the opening resumed.
    store.patchThread("t", { providerSession: undefined });
    release();
    await rewound;
    assert.equal(f.made.at(-1)!.closed, true, "a session on a conversation taken back is let go");
    await runtime.send("t", "again");
    assert.equal(f.made.at(-1)!.o.resume, undefined, "the turn opens a new one");
    assert.deepEqual(f.made.at(-1)!.texts, ["again"]);
  } finally {
    f.restore();
  }
});

test("a fresh session a turn opened is let go when anything before the turn's try throws, so the next turn hands over", async () => {
  const f = fake();
  try {
    const { store, runtime, dir } = setup([{ turns: 1 }], { git: true });
    store.putItem("t", { kind: "user", id: "u1", turn: 1, at: Date.now(), text: "write the parser" });
    writeFileSync(join(dir, ".git", "refs", "liner"), "");
    // Saving the no-snapshot notice fails (a full disk, say).
    const put = store.putItem.bind(store);
    store.putItem = ((id: string, it: Parameters<typeof put>[1], ...rest: unknown[]) => {
      if (it.kind === "notice" && /Couldn't snapshot/.test(it.text)) throw new Error("disk full");
      return (put as (...a: unknown[]) => unknown)(id, it, ...rest);
    }) as typeof store.putItem;
    await runtime.send("t", "first try");
    await until(() => f.made[0]?.closed === true, "the session that heard nothing is closed");
    assert.deepEqual(f.made[0].texts, []);
    store.putItem = put;
    await runtime.send("t", "second try");
    assert.equal(f.made.length, 2);
    assert.match(f.made[1].texts[0], /You were asked: write the parser/, "the next turn's new session gets the conversation");
  } finally {
    f.restore();
  }
});
