/*
  A session that sat idle has its tool closed, and comes back by resuming on its next turn or warm (Runtime.idleCheck), never
  while anything of the thread's or the tool's own is still going, and never one that couldn't come back as it was. Fake tools
  stand in, with the idle limit shortened. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { ResumeFailed, type OpenOptions, type Provider, type ProviderSession, type TurnSink } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const info = (id: ProviderInfo["id"], resume = true): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: [{ id: "claude-opus-5-5", label: "Opus", description: "" }], supports: { approvals: true, resume, effort: true, plan: true } });
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string, ms = 3000) {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await tick();
  assert.ok(ok(), what);
}
/** The idle limit in these tests. */
const IDLE = 60;

type Made = { o: OpenOptions; closed: boolean; texts: string[]; asked: number };
type Opts = {
  /** What a turn does; by default it says its session id, as a tool does once it's up. */
  work?: (text: string, sink: TurnSink, signal: AbortSignal, m: Made) => Promise<void> | void;
  /** The tool's own answer (ProviderSession.settled); false leaves the method out (a tool that can't tell). */
  settled?: ((m: Made) => boolean | Promise<boolean>) | false;
  close?: () => Promise<void> | void;
};
/** Claude Code, faked: every session it opens, what each was opened to resume, what each turn was sent, and whether each was closed. */
function fake(x: Opts = {}) {
  const made: Made[] = [];
  const p: Provider = {
    id: "claude",
    detect: async () => info("claude"),
    warms: () => true,
    open: (o) => {
      const m: Made = { o, closed: false, texts: [], asked: 0 };
      made.push(m);
      const s: ProviderSession = {
        turn: async (text, sink, signal) => {
          m.texts.push(text);
          if (x.work) return x.work(text, sink, signal, m);
          sink.session(o.resume ?? "sid-1");
          sink.text("ok");
        },
        warm: async () => {},
        close: () => {
          m.closed = true;
          return x.close?.();
        },
      };
      if (x.settled !== false)
        s.settled = () => {
          m.asked++;
          return x.settled ? x.settled(m) : !m.closed;
        };
      return s;
    },
  };
  const saved = providers.claude;
  providers.claude = p;
  return { made, restore: () => (providers.claude = saved) };
}

function setup(threads: Partial<Thread>[] = [{}], o: { resume?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), "lc-idle-"));
  const dir = mkdtempSync(join(tmpdir(), "lc-idle-dir-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  for (const [i, extra] of threads.entries()) store.putThread({ id: i ? `t${i + 1}` : "t", projectId: "p", title: "New session", agent: "forge", status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = [info("claude", o.resume ?? true)];
  runtime.idleMs = IDLE;
  return { store, runtime };
}
const liveOf = (runtime: Runtime) => (runtime as unknown as { live: Map<string, { idle?: { timer: NodeJS.Timeout } }> }).live;

test("a session idle past the limit is closed, and its next turn resumes it with no hand-over and no notice", async () => {
  const f = fake();
  try {
    const { store, runtime } = setup();
    await runtime.send("t", "write the parser");
    assert.equal(store.thread("t").providerSession, "claude:sid-1");
    const before = store.timeline("t").map((x) => x.id).join();
    const was = store.thread("t");
    const events: string[] = [];
    store.on((e) => events.push(e.type));
    await until(() => f.made[0].closed, "closed once it sat idle");
    assert.equal((await runtime.inspect("t")).live, false, "nothing is live for it, as after a restart");
    assert.equal(store.timeline("t").map((x) => x.id).join(), before, "the timeline doesn't change");
    const now = store.thread("t");
    assert.deepEqual([now.unread, now.status, now.providerSession, now.updatedAt], [was.unread, was.status, was.providerSession, was.updatedAt], "nor does the thread");
    assert.deepEqual(events, [], "and nothing is said to the page");
    await runtime.send("t", "now the tests");
    assert.equal(f.made.length, 2, "the next turn opens it again");
    assert.equal(f.made[1].o.resume, "sid-1", "resuming the conversation it was in");
    assert.deepEqual(f.made[1].texts, ["now the tests"], "with no hand-over text");
    assert.ok(!store.timeline("t").some((x) => x.kind === "notice"), "and no notice");
  } finally {
    f.restore();
  }
});

test("not closed while a turn runs, and closed after it ends", async () => {
  let release!: () => void;
  const f = fake({
    work: async (text, sink) => {
      sink.session("sid-1");
      if (text === "long") await new Promise<void>((r) => (release = r));
    },
  });
  try {
    const { runtime } = setup();
    await runtime.send("t", "first");
    const long = runtime.send("t", "long");
    await tick(IDLE * 4);
    assert.equal(f.made[0].closed, false, "a running turn holds it open");
    release();
    await long;
    await until(() => f.made[0].closed, "closed once the turn has ended and the limit passed");
  } finally {
    f.restore();
  }
});

test("not closed while an ask waits, messages are queued, a goal goes on, a brief works or one waits in line", async () => {
  const f = fake();
  try {
    const { store, runtime } = setup();
    await runtime.send("t", "first");
    const hold = async (what: string, on: () => void, off: () => void) => {
      on();
      await tick(IDLE * 4);
      assert.equal(f.made.at(-1)!.closed, false, `${what} holds it open`);
      off();
    };
    await hold(
      "an ask waiting on you",
      () => {
        store.putItem("t", { kind: "question", id: "q1", turn: 1, at: Date.now(), questions: [{ question: "Which?", options: [{ label: "A" }, { label: "B" }] }], state: "asking" });
        store.patchThread("t", { status: "waiting" });
      },
      () => {
        store.putItem("t", { ...(store.item("t", "q1") as Extract<ReturnType<typeof store.item>, { kind: "question" }>), state: "skipped" });
        store.patchThread("t", { status: "done" });
      },
    );
    await hold("a queued message", () => store.patchThread("t", { queue: [{ id: "q", text: "later", at: Date.now() }] }), () => store.patchThread("t", { queue: [] }));
    await hold("a goal between its turns", () => store.patchThread("t", { goal: { text: "tests pass", status: "active", turns: 1, max: 12 } }), () => store.patchThread("t", { goal: undefined }));
    const r = runtime as unknown as { briefs: Map<string, unknown>; briefLine: Map<string, Promise<void>>; wakes: Map<string, unknown> };
    await hold("a sidekick's brief", () => r.briefs.set("t", {}), () => r.briefs.delete("t"));
    await hold("a brief waiting in line", () => r.briefLine.set("t", Promise.resolve()), () => r.briefLine.delete("t"));
    await hold("a turn the tool began, waiting to run", () => r.wakes.set("t", {}), () => r.wakes.delete("t"));
    await hold("its worktree being set up", () => (runtime.settingUp = () => true), () => (runtime.settingUp = undefined));
    await until(() => f.made[0].closed, "closed once none of it is left");
  } finally {
    f.restore();
  }
});

test("not closed while the tool says something of its own still runs; closed once it ends", async () => {
  let running = true;
  const f = fake({ settled: () => !running });
  try {
    const { runtime } = setup();
    await runtime.send("t", "start the dev server in the background");
    await until(() => f.made[0].asked >= 2, "the tool is asked, and asked again after another limit");
    assert.equal(f.made[0].closed, false, "a background shell keeps it open");
    running = false;
    await until(() => f.made[0].closed, "closed once nothing of its own runs");
  } finally {
    f.restore();
  }
});

test("never closed when it can't come back as it was: a tool that can't tell, one that doesn't resume, no saved session yet, or a tool that answers late", async () => {
  // A tool that can't say whether something of its own runs.
  let f = fake({ settled: false });
  try {
    const { runtime } = setup();
    await runtime.send("t", "first");
    await tick(IDLE * 4);
    assert.equal(f.made[0].closed, false, "a tool that can't tell stays open");
    assert.equal(liveOf(runtime).get("t:forge")?.idle, undefined, "and has no idle timer at all");
  } finally {
    f.restore();
  }
  // A tool whose sessions don't resume.
  f = fake();
  try {
    const { runtime } = setup([{}], { resume: false });
    await runtime.send("t", "first");
    await tick(IDLE * 4);
    assert.equal(f.made[0].closed, false, "one that can't resume would come back knowing nothing: it stays");
  } finally {
    f.restore();
  }
  // No session id saved yet (the tool never said it), or one of another tool's.
  f = fake({ work: (_, sink) => sink.text("ok") });
  try {
    const { store, runtime } = setup();
    await runtime.send("t", "first");
    await tick(IDLE * 4);
    assert.equal(f.made[0].closed, false, "with no saved session to resume, it stays");
    store.patchThread("t", { providerSession: "codex:th-1" });
    await tick(IDLE * 4);
    assert.equal(f.made[0].closed, false, "nor with another tool's");
  } finally {
    f.restore();
  }
  // A turn sent while the tool works out its answer: it's looked at again, and the turn keeps it.
  let answer!: (v: boolean) => void;
  f = fake({ settled: () => new Promise<boolean>((r) => (answer = r)) });
  try {
    const { runtime } = setup();
    await runtime.send("t", "first");
    await until(() => f.made[0].asked === 1, "asked once idle");
    const sending = runtime.send("t", "second");
    answer(true);
    await sending;
    await tick(IDLE / 2);
    assert.equal(f.made.length, 1, "the turn ran on the session as it was");
    assert.equal(f.made[0].closed, false, "the answer that came after it started closes nothing");
  } finally {
    f.restore();
  }
});

test("each thing that happens starts the clock again", async () => {
  const f = fake();
  try {
    const { runtime } = setup();
    runtime.idleMs = 200;
    await runtime.send("t", "first");
    for (let i = 0; i < 4; i++) {
      await tick(120);
      await runtime.send("t", `again ${i}`);
    }
    assert.equal(f.made[0].closed, false, "turns closer together than the limit keep it open");
    assert.equal(f.made.length, 1);
    await until(() => f.made[0].closed, "and it closes once they stop");
  } finally {
    f.restore();
  }
});

test("a send racing the idle close waits for the close, then opens once, resuming", async () => {
  let release!: () => void;
  let slow = false;
  const f = fake({ close: () => (slow ? new Promise<void>((r) => (release = r)) : undefined) });
  try {
    const { runtime } = setup();
    await runtime.send("t", "first");
    slow = true;
    await until(() => f.made[0].closed, "the idle close has begun");
    slow = false;
    const sending = runtime.send("t", "second");
    await tick(40);
    assert.equal(f.made.length, 1, "nothing opens while the old process is still ending");
    release();
    await sending;
    assert.equal(f.made.length, 2, "opened once");
    assert.equal(f.made[1].o.resume, "sid-1");
    assert.deepEqual(f.made[1].texts, ["second"]);
  } finally {
    f.restore();
  }
});

test("closed for idleness, then warmed as you write: the warmed one resumes and the turn takes it", async () => {
  const f = fake();
  try {
    const { store, runtime } = setup();
    await runtime.send("t", "first");
    await until(() => f.made[0].closed, "closed once idle");
    await runtime.warm("t");
    assert.equal(f.made.length, 2, "warm opens it again");
    assert.equal(f.made[1].o.resume, "sid-1", "resuming");
    await runtime.send("t", "second");
    assert.equal(f.made.length, 2, "the turn takes the warmed one");
    assert.deepEqual(f.made[1].texts, ["second"], "with no hand-over");
    assert.ok(!store.timeline("t").some((x) => x.kind === "notice"));
    // A warmed one nobody sent to keeps its own, shorter rules; the idle close leaves it to them.
    runtime.warmMs = 10_000;
    await until(() => f.made[1].closed, "and idles out again after its turn");
    await runtime.warm("t");
    await tick(IDLE * 4);
    assert.equal(f.made[2].closed, false, "an unused warmed session isn't closed for idleness");
  } finally {
    f.restore();
  }
});

test("a resume that fails after an idle close still falls back to the conversation as text", async () => {
  const f = fake({
    work: async (text, sink, _signal, m) => {
      if (m.o.resume && text === "second") throw new ResumeFailed("gone");
      sink.session(m.o.resume && !text.includes("second") ? m.o.resume : "sid-1");
      sink.text("The parser is done.");
    },
  });
  try {
    const { store, runtime } = setup();
    await runtime.send("t", "write the parser");
    await until(() => f.made[0].closed, "closed once idle");
    await runtime.send("t", "second");
    const texts = f.made[1].texts;
    assert.equal(texts.length, 2, "sent again after the resume failed");
    assert.match(texts[1], /write the parser/, "with the conversation so far");
    assert.ok(store.timeline("t").some((x) => x.kind === "notice" && /couldn't pick up its own session/.test(x.text)));
  } finally {
    f.restore();
  }
});

test("archive, delete or quit during an idle close leave nothing live, and wait for the close", async () => {
  const releases: (() => void)[] = [];
  const release = () => releases.forEach((r) => r());
  let slow = false;
  const f = fake({ close: () => (slow ? new Promise<void>((r) => releases.push(r)) : undefined) });
  try {
    const { runtime } = setup([{}, {}]);
    await runtime.send("t", "first");
    await runtime.send("t2", "first");
    slow = true;
    await until(() => f.made[0].closed && f.made[1].closed, "both closing for idleness");
    slow = false;
    let closed = false;
    const putAway = runtime.closeThread("t", "You archived this session").then(() => (closed = true));
    let quit = false;
    const quitting = runtime.shutdown().then(() => (quit = true));
    await tick(30);
    assert.equal(closed, false, "putting it away waits for the close under way");
    assert.equal(quit, false, "so does quitting");
    release();
    await Promise.all([putAway, quitting]);
    assert.equal(liveOf(runtime).size, 0, "nothing is live");
    assert.equal(f.made.length, 2, "and nothing opened again");
  } finally {
    f.restore();
  }
});

test("the idle timer never keeps the engine up, and goes with the session", async () => {
  const f = fake();
  try {
    const { runtime } = setup();
    runtime.idleMs = 60_000;
    await runtime.send("t", "first");
    const l = liveOf(runtime).get("t:forge");
    assert.ok(l?.idle, "a session whose tool can tell has an idle timer");
    assert.equal(l.idle.timer.hasRef(), false, "unref'd");
    await runtime.shutdown();
    assert.equal(l.idle, undefined, "cleared as it closes");
  } finally {
    f.restore();
  }
});

test("a sidekick's session idles out by the same rule, resuming its own saved session", async () => {
  const f = fake();
  try {
    const { store, runtime } = setup();
    await runtime.send("t", "first");
    // Its session, as a brief leaves it: live under its own key, its id saved under its ref.
    const sid = f.made.length;
    const r = runtime as unknown as { session: (t: Thread, agentId: string, cwd: string, sidekick: boolean) => Promise<unknown> };
    await r.session(store.thread("t"), "@claude:claude-opus-5-5", store.project("p").path, true);
    assert.equal(f.made[sid].o.sidekick, true);
    assert.equal(f.made[sid].closed, false);
    await tick(IDLE * 4);
    assert.equal(f.made[sid].closed, false, "with no saved session of its own, it stays");
    store.patchThread("t", { sessions: { "@claude:claude-opus-5-5": "claude:side-1" } });
    await until(() => f.made[sid].closed, "with one, it's closed once idle");
  } finally {
    f.restore();
  }
});

test("writing in a session whose tool is up starts its idle clock again (warm)", async () => {
  const f = fake();
  try {
    const { runtime } = setup();
    runtime.idleMs = 200;
    await runtime.send("t", "first");
    for (let i = 0; i < 4; i++) {
      await tick(120);
      await runtime.warm("t");
    }
    assert.equal(f.made[0].closed, false, "not closed under your hands while you write");
    assert.equal(f.made.length, 1, "and nothing else opened");
    await until(() => f.made[0].closed, "closed once you stop");
  } finally {
    f.restore();
  }
});
