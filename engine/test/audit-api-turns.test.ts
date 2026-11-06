/*
  What an audit of the turn loop left in the API around it: one lock across a rewind, an undo or a
  delete, worktrees that come back, side chats that don't go stale, forks that aren't left half
  made, and the smaller ones beside them. Each test here failed before its fix, with fake agents
  and throwaway repositories. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineEvent, FileDiff, Item, ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { run } from "../src/exec.ts";
import { claude, sdk } from "../src/providers/claude.ts";
import type { OpenOptions, Provider, TurnSink } from "../src/providers/types.ts";
import { Proxies } from "../src/proxy.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 400 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}

const who = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
const git = async (cwd: string, ...args: string[]) => {
  const r = await run("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: { ...process.env, ...who } });
  assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

/** Claude Code, faked: each turn runs `work` in the session's folder, and records what it was told. */
type Work = (text: string, sink: TurnSink, signal: AbortSignal, cwd: string) => Promise<void> | void;
function fake(work: Work = () => {}) {
  const texts: string[] = [];
  const opened: OpenOptions[] = [];
  const p: Provider = {
    id: "claude",
    detect: async () => info("claude", ["claude-opus-5-5"]),
    open: (o) => {
      opened.push(o);
      return {
        close() {},
        turn: async (text, sink, signal) => {
          texts.push(text);
          await work(text, sink, signal, o.cwd);
        },
      };
    },
  };
  const saved = providers.claude;
  providers.claude = p;
  return { texts, opened, restore: () => (providers.claude = saved) };
}

/** The API over a real store and runtime, on a throwaway repository with one commit. */
async function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lc-turns-repo-")));
  await git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.txt"), "one\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "start");
  const home = realpathSync(mkdtempSync(join(tmpdir(), "lc-turns-home-")));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: true, createdAt: Date.now() });
  // A bare PATH, so finding the agent tools doesn't start any.
  const env = { PATH: "/usr/bin:/bin", ...who };
  const runtime = new Runtime(store, env);
  runtime.providerInfo = [info("claude", ["claude-opus-5-5"])];
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const events: EngineEvent[] = [];
  store.on((e) => events.push(e));
  const call = <T>(method: string, params: unknown) => api.call(method, params) as Promise<T>;
  return { dir, home, store, runtime, call, events };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const session = (s: Setup, extra: Record<string, unknown> = {}) => s.call<Thread>("thread.create", { projectId: "p", agent: "@claude:claude-opus-5-5", after: "off", ...extra });
const rootOf = (t: Thread) => t.worktree!.root ?? t.worktree!.path;
const said = (s: Setup, id: string, text: string) => s.store.timeline(id).some((x) => x.kind === "user" && x.text === text);
const cpOf = (s: Setup, id: string) => s.store.timeline(id).find((x): x is Extract<Item, { kind: "checkpoint" }> => x.kind === "checkpoint");
const edit: Work = (text, _sink, _signal, cwd) => {
  if (text === "change it") writeFileSync(join(cwd, "a.txt"), "two\n");
};
/** A session with one turn behind it that changed a.txt. */
async function changed(s: Setup, extra: Record<string, unknown> = {}) {
  const t = await session(s, extra);
  await s.call("thread.send", { id: t.id, text: "change it" });
  await until(() => Boolean(cpOf(s, t.id)) && !s.runtime.isRunning(t.id), "the turn left a checkpoint");
  return t;
}

/* 1. One lock across a rewind, an undo or a delete. */

test("lock: a message sent during an undo waits for it, then goes", async () => {
  const f = fake(edit);
  try {
    const s = await setup();
    const t = await changed(s);
    const undoing = s.call("checkpoint.revert", { threadId: t.id, itemId: cpOf(s, t.id)!.id });
    await s.call("thread.send", { id: t.id, text: "next" });
    await tick(1);
    assert.equal(said(s, t.id, "next"), false, "no turn starts under the files being put back");
    assert.deepEqual(s.store.thread(t.id).queue?.map((q) => q.text), ["next"]);
    await undoing;
    await until(() => said(s, t.id, "next") && !s.runtime.isRunning(t.id), "it goes when the undo is done");
    assert.ok(cpOf(s, t.id)!.reverted);
    assert.deepEqual(s.store.thread(t.id).queue, []);
    assert.equal(readFileSync(join(s.dir, "a.txt"), "utf8"), "one\n");
  } finally {
    f.restore();
  }
});

test("lock: a /goal sent during an undo waits too, and starts when it's done", async () => {
  const f = fake(edit);
  try {
    const s = await setup();
    const t = await changed(s);
    const undoing = s.call("checkpoint.revert", { threadId: t.id, itemId: cpOf(s, t.id)!.id });
    await s.call("thread.send", { id: t.id, text: "/goal the tests pass" });
    await tick(1);
    assert.equal(s.store.thread(t.id).goal, undefined, "no goal under the undo");
    await undoing;
    await until(() => s.store.thread(t.id).goal !== undefined, "it starts when the undo is done");
  } finally {
    f.restore();
  }
});

test("lock: a message sent during a rewind with files isn't cut off by it, and goes when it's done", async () => {
  const f = fake(edit);
  try {
    const s = await setup();
    const t = await changed(s);
    const asked = s.store.timeline(t.id).find((x) => x.kind === "user")!;
    const going = s.call("thread.rewind", { threadId: t.id, itemId: asked.id, files: true });
    await s.call("thread.send", { id: t.id, text: "next" });
    await tick(1);
    assert.equal(said(s, t.id, "next"), false);
    await going;
    await until(() => said(s, t.id, "next") && !s.runtime.isRunning(t.id), "it goes when the rewind is done");
    assert.equal(s.store.thread(t.id).turns, 1, "turn 1 again, and only that");
    assert.equal(said(s, t.id, "change it"), false);
    assert.equal(readFileSync(join(s.dir, "a.txt"), "utf8"), "one\n");
  } finally {
    f.restore();
  }
});

test("lock: a second undo while one runs is refused, as work in flight", async () => {
  const f = fake(edit);
  try {
    const s = await setup();
    const t = await changed(s);
    const itemId = cpOf(s, t.id)!.id;
    const undoing = s.call("checkpoint.revert", { threadId: t.id, itemId });
    await assert.rejects(s.call("checkpoint.revert", { threadId: t.id, itemId }), /Stop the session before undoing/);
    await undoing;
  } finally {
    f.restore();
  }
});

test("lock: an undo that fails lets go, and the next message goes", async () => {
  const f = fake(edit);
  try {
    const s = await setup();
    const t = await changed(s);
    writeFileSync(join(s.dir, "a.txt"), "yours\n");
    await assert.rejects(s.call("checkpoint.revert", { threadId: t.id, itemId: cpOf(s, t.id)!.id }), /Changed after that turn/);
    assert.equal(s.runtime.isRunning(t.id), false);
    await s.call("thread.send", { id: t.id, text: "next" });
    await until(() => f.texts.includes("next"), "the session still works");
  } finally {
    f.restore();
  }
});

test("lock: a message sent as a session is deleted starts nothing", async () => {
  const f = fake();
  try {
    const s = await setup();
    const t = await session(s);
    const going = s.call("thread.remove", { id: t.id });
    await s.call("thread.send", { id: t.id, text: "next" });
    await tick(1);
    assert.equal(said(s, t.id, "next"), false, "no turn starts in a session on its way out");
    await going;
    await tick(30);
    assert.deepEqual(f.texts, []);
    assert.equal(s.runtime.isRunning(t.id), false);
    assert.ok(!s.store.threads.some((x) => x.id === t.id));
  } finally {
    f.restore();
  }
});

test("lock: a message sent as a deleted session's turn winds down starts no turn after it", async () => {
  let ended = false;
  const f = fake(async (_text, _sink, signal) => {
    while (!signal.aborted) await tick(2);
    // A tool that takes a moment to stop.
    await tick(80);
    ended = true;
  });
  try {
    const s = await setup();
    const t = await session(s);
    await s.call("thread.send", { id: t.id, text: "first" });
    await until(() => f.texts.length === 1, "it works");
    const going = s.call("thread.remove", { id: t.id });
    await tick(5);
    await s.call("thread.send", { id: t.id, text: "next" });
    await going;
    assert.ok(ended, "the delete waited for the turn to wind down");
    await tick(30);
    assert.deepEqual(f.texts, ["first"], "that message goes with the session");
    assert.equal(s.runtime.isRunning(t.id), false);
  } finally {
    f.restore();
  }
});

/* 2. Rewind or undo when the worktree is gone. */

/** A worktree session whose turn's change is committed on its branch, and whose worktree was then deleted. */
async function gone(s: Setup) {
  const t = await changed(s, { worktree: true });
  await git(rootOf(t), "add", "-A");
  await git(rootOf(t), "commit", "-q", "-m", "the turn's work");
  rmSync(rootOf(t), { recursive: true, force: true });
  return t;
}

test("worktree gone: an undo puts it back first, then undoes the turn there", async () => {
  const f = fake(edit);
  try {
    const s = await setup();
    const t = await gone(s);
    const done = await s.call<Item>("checkpoint.revert", { threadId: t.id, itemId: cpOf(s, t.id)!.id });
    assert.ok(done.kind === "checkpoint" && done.reverted);
    assert.equal(readFileSync(join(rootOf(t), "a.txt"), "utf8"), "one\n");
    assert.ok(s.store.timeline(t.id).some((x) => x.kind === "notice" && /worktree was gone/.test(x.text)));
  } finally {
    f.restore();
  }
});

test("worktree gone: a rewind with files puts it back first", async () => {
  const f = fake(edit);
  try {
    const s = await setup();
    const t = await gone(s);
    const asked = s.store.timeline(t.id).find((x) => x.kind === "user")!;
    const r = await s.call<{ files: number }>("thread.rewind", { threadId: t.id, itemId: asked.id, files: true });
    assert.equal(r.files, 1);
    assert.equal(readFileSync(join(rootOf(t), "a.txt"), "utf8"), "one\n");
  } finally {
    f.restore();
  }
});

/* 3. Rewind and side chats. */

test("rewind: a side chat that holds the turns that came off goes with them; the next one starts fresh", async () => {
  const f = fake();
  try {
    const s = await setup();
    const t = await session(s);
    s.store.patchThread(t.id, { turns: 2, providerSession: "claude:old" });
    s.store.putItem(t.id, { kind: "user", id: "u1", turn: 1, at: 1, text: "one" });
    s.store.putItem(t.id, { kind: "user", id: "u2", turn: 2, at: 2, text: "two" });
    const side = await s.call<Thread>("thread.side", { id: t.id });
    await s.call("thread.rewind", { threadId: t.id, itemId: "u2" });
    assert.ok(!s.store.threads.some((x) => x.id === side.id));
    assert.ok(s.events.some((e) => e.type === "thread.removed" && e.id === side.id), "the app is told");
    const next = await s.call<Thread>("thread.side", { id: t.id });
    assert.notEqual(next.id, side.id);
    assert.equal(next.forkSession, "", "no fork of the conversation that came off");
  } finally {
    f.restore();
  }
});

test("rewind: a side chat from before the turns that came off is still true, and stays", async () => {
  const f = fake();
  try {
    const s = await setup();
    const t = await session(s);
    s.store.patchThread(t.id, { turns: 1 });
    s.store.putItem(t.id, { kind: "user", id: "u1", turn: 1, at: 1, text: "one" });
    const side = await s.call<Thread>("thread.side", { id: t.id });
    s.store.patchThread(t.id, { turns: 2 });
    s.store.putItem(t.id, { kind: "user", id: "u2", turn: 2, at: 2, text: "two" });
    await s.call("thread.rewind", { threadId: t.id, itemId: "u2" });
    assert.ok(s.store.threads.some((x) => x.id === side.id));
  } finally {
    f.restore();
  }
});

/* 4. Undoing an already undone turn. */

test("undo: a turn already undone is refused, and keeps its way back", async () => {
  const f = fake(edit);
  try {
    const s = await setup();
    const t = await changed(s);
    const itemId = cpOf(s, t.id)!.id;
    await s.call("checkpoint.revert", { threadId: t.id, itemId });
    const redo = cpOf(s, t.id)!.redo;
    assert.ok(redo);
    await assert.rejects(s.call("checkpoint.revert", { threadId: t.id, itemId, force: true }), /already undone/);
    assert.equal(cpOf(s, t.id)!.redo, redo);
  } finally {
    f.restore();
  }
});

/* 5. A half-made fork. */

const copyFails = async (folder: "attachments" | "designs") => {
  const f = fake();
  const s = await setup();
  const t = await session(s);
  s.store.putItem(t.id, { kind: "user", id: "u", turn: 1, at: 1, text: "see this" });
  const held = join(s.home, folder, t.id);
  mkdirSync(held, { recursive: true });
  const secret = join(held, "locked.txt");
  writeFileSync(secret, "x");
  chmodSync(secret, 0o000);
  try {
    await assert.rejects(s.call("thread.create", { projectId: "p", agent: "@claude:claude-opus-5-5", forkOf: t.id }));
    assert.deepEqual(s.store.threads.map((x) => x.id), [t.id], "no half-made fork in the sidebar");
    const fork = s.events.flatMap((e) => (e.type === "thread" && e.thread.id !== t.id ? [e.thread.id] : []))[0];
    if (fork) {
      assert.ok(s.events.some((e) => e.type === "thread.removed" && e.id === fork), "the app is told it went");
      assert.ok(!existsSync(join(s.home, "attachments", fork)) && !existsSync(join(s.home, "designs", fork)), "what it had copied goes too");
    }
    assert.ok(!s.events.some((e) => e.type === "notify" && /Kept its worktree/.test(e.title)), "nothing to say about a fork that never was");
  } finally {
    chmodSync(secret, 0o600);
    f.restore();
  }
};

test("fork: attachments that can't be copied leave no half-made fork", () => copyFails("attachments"));
test("fork: design versions that can't be copied leave no half-made fork", () => copyFails("designs"));

/* 6 and 8. A new worktree's setup holds back what would work in it. */

async function settingUp(s: Setup) {
  s.store.putProject({ ...s.store.project("p"), setup: "sleep 0.4 && touch ready.txt" });
  return session(s, { worktree: true });
}

test("side chat: its first question waits for its session's new worktree to be set up", async () => {
  let ready: boolean | undefined;
  const f = fake((_text, _sink, _signal, cwd) => void (ready = existsSync(join(cwd, "ready.txt"))));
  try {
    const s = await setup();
    const t = await settingUp(s);
    const side = await s.call<Thread>("thread.side", { id: t.id });
    await s.call("thread.send", { id: side.id, text: "what's here?" });
    await until(() => f.texts.length === 1, "it was asked");
    assert.equal(ready, true);
  } finally {
    f.restore();
  }
});

test("goal: /goal waits for a new worktree to be set up, as a message does", async () => {
  let ready: boolean | undefined;
  const f = fake((_text, _sink, _signal, cwd) => void (ready = existsSync(join(cwd, "ready.txt"))));
  try {
    const s = await setup();
    const t = await settingUp(s);
    await s.call("thread.send", { id: t.id, text: "/goal the tests pass" });
    await until(() => f.texts.length > 0, "it started");
    assert.equal(ready, true);
    s.runtime.stop(t.id);
  } finally {
    f.restore();
  }
});

test("goal: /goal in a session whose worktree is gone puts it back first", async () => {
  let there: boolean | undefined;
  const f = fake((_text, _sink, _signal, cwd) => void (there = existsSync(cwd)));
  try {
    const s = await setup();
    const t = await session(s, { worktree: true });
    rmSync(rootOf(t), { recursive: true, force: true });
    await s.call("thread.send", { id: t.id, text: "/goal the tests pass" });
    await until(() => f.texts.length > 0, "it started");
    assert.equal(there, true);
    s.runtime.stop(t.id);
  } finally {
    f.restore();
  }
});

/* 7. Rewind and a queue Stop kept. */

test("rewind: a queue Stop kept isn't dropped, or sent by itself; your next message sends it", async () => {
  const f = fake(async (text, _sink, signal) => {
    if (text === "first") while (!signal.aborted) await tick(2);
  });
  try {
    const s = await setup();
    const t = await session(s);
    await s.call("thread.send", { id: t.id, text: "first" });
    await until(() => f.texts.length === 1, "it works");
    await s.call("thread.send", { id: t.id, text: "queued" });
    await until(() => s.store.thread(t.id).queue?.length === 1, "it waits");
    await s.call("thread.stop", { id: t.id });
    await until(() => !s.runtime.isRunning(t.id), "stopped");
    const asked = s.store.timeline(t.id).find((x) => x.kind === "user")!;
    await s.call("thread.rewind", { threadId: t.id, itemId: asked.id });
    assert.deepEqual(s.store.thread(t.id).queue?.map((q) => q.text), ["queued"]);
    await tick(30);
    assert.deepEqual(f.texts, ["first"], "going back sends nothing");
    // The app sends the edited message next.
    await s.call("thread.send", { id: t.id, text: "first, edited" });
    await until(() => f.texts.length === 3, "your message, then the queue");
    assert.deepEqual(f.texts.slice(1), ["first, edited", "queued"]);
  } finally {
    f.restore();
  }
});

test("undo: a queue Stop kept stays held through it, and isn't sent by itself", async () => {
  const f = fake(async (text, sink, signal, cwd) => {
    await edit(text, sink, signal, cwd);
    if (text === "second") while (!signal.aborted) await tick(2);
  });
  try {
    const s = await setup();
    const t = await changed(s);
    await s.call("thread.send", { id: t.id, text: "second" });
    await until(() => f.texts.length === 2, "it works");
    await s.call("thread.send", { id: t.id, text: "queued" });
    await until(() => s.store.thread(t.id).queue?.length === 1, "it waits");
    await s.call("thread.stop", { id: t.id });
    await until(() => !s.runtime.isRunning(t.id), "stopped");
    await s.call("checkpoint.revert", { threadId: t.id, itemId: cpOf(s, t.id)!.id });
    await tick(30);
    assert.deepEqual(f.texts, ["change it", "second"]);
    assert.deepEqual(s.store.thread(t.id).queue?.map((q) => q.text), ["queued"]);
  } finally {
    f.restore();
  }
});

/* 9. Carrying on by itself in a session whose worktree is gone. */

/** A worktree session a restart cut off mid-turn, with the worktree deleted meanwhile. */
async function cutOff(s: Setup) {
  const t = await session(s, { worktree: true });
  s.store.putItem(t.id, { kind: "user", id: "u", turn: 1, at: 1, text: "do it" });
  s.store.putItem(t.id, { kind: "turn", id: "m", turn: 1, at: 1, agent: "@claude:claude-opus-5-5", model: "claude:claude-opus-5-5", planning: false, status: "stopped" });
  s.store.patchThread(t.id, { turns: 1, status: "idle", unread: true });
  rmSync(rootOf(t), { recursive: true, force: true });
  return t;
}

test("restart: a session that carries on gets its worktree back first", async () => {
  let there: boolean | undefined;
  const f = fake((_text, _sink, _signal, cwd) => void (there = existsSync(cwd)));
  try {
    const s = await setup();
    const t = await cutOff(s);
    assert.deepEqual(s.runtime.continueAfterRestart(), [t.id]);
    await until(() => f.texts.length === 1 && !s.runtime.isRunning(t.id), "it carried on");
    assert.equal(there, true);
    assert.notEqual(s.store.thread(t.id).status, "error");
  } finally {
    f.restore();
  }
});

test("limits: a session that carries on when its window reopens gets its worktree back first", async () => {
  let there: boolean | undefined;
  const f = fake((_text, _sink, _signal, cwd) => void (there = existsSync(cwd)));
  try {
    const s = await setup();
    s.store.setSettings({ resumeAtReset: true });
    const t = await session(s, { worktree: true });
    const now = Date.now();
    const reset = now - 2 * 60_000;
    s.store.patchThread(t.id, { status: "limited", turns: 1, limit: { message: "used up", until: reset, provider: "claude" } });
    s.store.putItem(t.id, { kind: "limit", id: "l1", turn: 1, at: reset - 60 * 60_000, message: "used up", until: reset, provider: "claude" });
    rmSync(rootOf(t), { recursive: true, force: true });
    s.runtime.resumeLimited(now);
    await until(() => f.texts.length === 1 && !s.runtime.isRunning(t.id), "it carried on");
    assert.equal(there, true);
    assert.notEqual(s.store.thread(t.id).status, "error");
    assert.equal(s.store.thread(t.id).queue?.length ?? 0, 0, "it goes as itself, not through the queue");
  } finally {
    f.restore();
  }
});

/* 11. A plan between paragraphs. */

test("plan: words after a plan start a paragraph of their own, without a message id too", async () => {
  const f = fake((_text, sink) => {
    sink.text("before");
    sink.plan([{ title: "step", status: "pending" }]);
    sink.text("after");
  });
  try {
    const s = await setup();
    const t = await session(s);
    await s.call("thread.send", { id: t.id, text: "go" });
    await until(() => f.texts.length === 1 && !s.runtime.isRunning(t.id), "it ended");
    assert.deepEqual(s.store.timeline(t.id).flatMap((x) => (x.kind === "text" ? [x.text] : [])), ["before", "after"]);
  } finally {
    f.restore();
  }
});

/* 12. Attachments from before a restart. */

test("attachments: the session's folder goes to the tool as an extra directory, once there's one", async () => {
  const f = fake();
  try {
    const s = await setup();
    const t = await session(s);
    await s.call("thread.send", { id: t.id, text: "one" });
    await until(() => f.opened.length === 1, "opened");
    assert.deepEqual(f.opened[0].dirs ?? [], [], "no folder yet: Claude Code would refuse one that isn't there");
    const sent = join(s.home, "attachments", t.id);
    mkdirSync(sent, { recursive: true });
    const later = await session(s);
    mkdirSync(join(s.home, "attachments", later.id), { recursive: true });
    await s.call("thread.send", { id: later.id, text: "two" });
    await until(() => f.opened.length === 2, "opened");
    assert.deepEqual(f.opened[1].dirs, [join(s.home, "attachments", later.id)]);
    // A side chat reads what was sent to its session.
    const side = await s.call<Thread>("thread.side", { id: later.id });
    await s.call("thread.send", { id: side.id, text: "three" });
    await until(() => f.opened.length === 3, "opened");
    assert.deepEqual(f.opened[2].dirs, [join(s.home, "attachments", later.id)]);
  } finally {
    f.restore();
  }
});

test("attachments: Claude Code is given the folder, and a file in it reads without asking before any is sent again", async () => {
  type Ask = (name: string, input: Record<string, unknown>, o: Record<string, unknown>) => Promise<{ behavior: string }>;
  const saved = sdk.query;
  let options: Record<string, unknown> = {};
  let finish = () => {};
  let got = () => {};
  const delivered = new Promise<void>((r) => (got = r));
  sdk.query = (({ prompt, options: o }: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
    options = o;
    void (async () => {
      for await (const _ of prompt) got();
    })();
    return {
      async *[Symbol.asyncIterator]() {
        await new Promise<void>((r) => (finish = r));
      },
      initializationResult: async () => ({}),
      setMcpServers: async () => ({ added: [], removed: [], errors: {} }),
      interrupt: async () => {},
      return: async () => ({ done: true, value: undefined }),
    };
  }) as unknown as typeof sdk.query;
  const dir = mkdtempSync(join(tmpdir(), "lc-turns-att-"));
  const asked: unknown[] = [];
  const sink = { text() {}, reasoning() {}, tool() {}, plan() {}, approve: async (r: unknown) => (asked.push(r), { allow: false }), ask: async () => null, propose: async () => ({ approve: false }), usage() {}, session() {}, notice() {}, error() {}, limited() {} } as TurnSink;
  try {
    const s = claude.open({ cwd: "/tmp", model: "claude-opus-5-5", effort: "medium", access: "ask", soul: "", guard: true, env: { PATH: "" }, dirs: [dir] });
    const stop = new AbortController();
    const turn = s.turn("go", sink, stop.signal);
    await delivered;
    assert.deepEqual(options.additionalDirectories, [dir]);
    const ask = options.canUseTool as Ask;
    assert.equal((await ask("Read", { file_path: join(dir, "notes.txt") }, { signal: stop.signal, toolUseID: "t1" })).behavior, "allow");
    assert.equal(asked.length, 0);
    stop.abort();
    finish();
    await turn.catch(() => {});
    s.close();
  } finally {
    sdk.query = saved;
  }
});

/* 13. The proxy's own pages. */

test("browser: a page of the proxy's own carries the probe, so Back and Forward work from it", async () => {
  const proxies = new Proxies();
  // A port nothing listens on: taken, then let go.
  const free = createServer();
  await new Promise<void>((r) => free.listen(0, "127.0.0.1", r));
  const port = (free.address() as AddressInfo).port;
  await new Promise((r) => free.close(r));
  try {
    const nothing = await fetch(await proxies.url(port));
    assert.equal(nothing.status, 502);
    assert.match(await nothing.text(), /<script src="\/__liner\/probe\.js"><\/script>/);
    const site = await proxies.files(mkdtempSync(join(tmpdir(), "lc-turns-page-")));
    const missing = await fetch(`${site}/nope.html`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /<script src="\/__liner\/probe\.js"><\/script>/);
    assert.match(await (await fetch(`${site}/__liner/probe.js`)).text(), /__linerCmd/);
  } finally {
    proxies.closeAll();
  }
});

/* 14. How many files a diff left out. */

test("diff: All turns and This branch say how many files there are past the first 60", async () => {
  const f = fake((text, _sink, _signal, cwd) => {
    if (text === "many") for (let i = 0; i < 63; i++) writeFileSync(join(cwd, `f${i}.txt`), "x\n");
  });
  try {
    const s = await setup();
    const t = await session(s);
    await s.call("thread.send", { id: t.id, text: "many" });
    await until(() => Boolean(cpOf(s, t.id)) && !s.runtime.isRunning(t.id), "it changed them");
    for (const itemId of ["all", "branch", cpOf(s, t.id)!.id]) {
      const d = await s.call<{ files: FileDiff[]; total: number }>("checkpoint.diff", { threadId: t.id, itemId });
      if (itemId !== "branch") {
        assert.equal(d.files.length, 60, itemId);
        assert.equal(d.total, 63, itemId);
      }
    }
    // On a branch of its own, what a pull request would carry.
    await git(s.dir, "checkout", "-q", "-b", "work");
    await git(s.dir, "add", "-A");
    await git(s.dir, "commit", "-q", "-m", "the work");
    const d = await s.call<{ files: FileDiff[]; total: number }>("checkpoint.diff", { threadId: t.id, itemId: "branch" });
    assert.equal(d.files.length, 60);
    assert.equal(d.total, 63);
  } finally {
    f.restore();
  }
});
