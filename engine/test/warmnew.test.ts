/*
  A new session from Home opened before you press send (thread.warmNew): the session thread.create is about to make opens its
  tool under the id Home picked, and thread.create takes it when it opens the same way, or closes it. Fake tools stand in, through
  the API, on throwaway repositories. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { AgentTools } from "../src/agent-tools.ts";
import { createApi } from "../src/api.ts";
import { markFile, run } from "../src/exec.ts";
import type { OpenOptions, Provider, ProviderSession, TurnSink } from "../src/providers/types.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

const info = (id: ProviderInfo["id"]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: [{ id: "claude-opus-5-5", label: "Opus", description: "" }, { id: "claude-sonnet-5-5", label: "Sonnet", description: "" }], supports: { approvals: true, resume: true, effort: true, plan: true } });
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string, ms = 3000) {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await tick();
  assert.ok(ok(), what);
}
const who = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
const git = async (cwd: string, ...args: string[]) => {
  const r = await run("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: { ...process.env, ...who } });
  assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

type Made = { o: OpenOptions; warms: number; closed: boolean; texts: string[]; before: boolean[] };
/** Claude Code, faked: every session it opens, with what it was opened with, warmed, sent and closed. `warms`: false, a tool that can't open ahead. */
function fake(x: { warms?: boolean; fail?: boolean; close?: () => Promise<void> | void } = {}) {
  const made: Made[] = [];
  const p: Provider = {
    id: "claude",
    detect: async () => info("claude"),
    ...(x.warms === false ? {} : { warms: () => true }),
    open: (o) => {
      const m: Made = { o, warms: 0, closed: false, texts: [], before: [] };
      made.push(m);
      const s: ProviderSession = {
        turn: async (text, sink: TurnSink) => {
          m.texts.push(text);
          // The turn's "before" snapshot is there by the time the prompt goes.
          const id = String(o.env[THREAD]);
          m.before.push((await run("git", ["rev-parse", "--verify", "-q", `refs/liner/${id}/1-before`], { cwd: o.cwd })).code === 0);
          sink.session("sid-1");
          sink.text("ok");
        },
        warm: async () => {
          m.warms++;
          if (x.fail) throw new Error("no start");
        },
        settled: () => true,
        close: () => ((m.closed = true), x.close?.()),
      };
      return s;
    },
  };
  const saved = providers.claude;
  providers.claude = p;
  return { made, restore: () => (providers.claude = saved) };
}
const THREAD = "LINER_THREAD_ID";

async function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lc-wn-repo-")));
  await git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.txt"), "one\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "start");
  const other = realpathSync(mkdtempSync(join(tmpdir(), "lc-wn-other-")));
  const home = realpathSync(mkdtempSync(join(tmpdir(), "lc-wn-home-")));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: true, createdAt: Date.now() });
  store.putProject({ id: "q", name: "q", path: other, git: false, createdAt: Date.now() });
  const env = { PATH: "/usr/bin:/bin", ...who };
  const tools = new AgentTools(store, env);
  tools.url = "http://127.0.0.1:9";
  const runtime = new Runtime(store, env, tools);
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const call = <T>(method: string, params: unknown) => api.call(method, params) as Promise<T>;
  // Detection done, so the warm waits on nothing.
  await call("state.get", {});
  return { dir, home, store, runtime, tools, call };
}
const choices = { projectId: "p", agent: "@claude:claude-opus-5-5", review: false, effort: "medium", access: "edits" };
const ahead = (runtime: Runtime) => (runtime as unknown as { ahead: Map<string, unknown> }).ahead;
const live = (runtime: Runtime) => (runtime as unknown as { live: Map<string, unknown> }).live;

test("warmNew, then create and send with the same choices: one open, warmed once, the first turn takes it, after its snapshot", async () => {
  const f = fake();
  try {
    const s = await setup();
    await s.call("thread.warmNew", { id: "th_new1", ...choices });
    await until(() => f.made.length === 1 && f.made[0].warms === 1, "opened and warmed as you write");
    assert.equal(f.made[0].o.env[THREAD], "th_new1", "under the id the thread will have");
    assert.equal(f.made[0].o.resume, undefined, "a new conversation: the first turn hears it fresh");
    assert.equal(s.store.threads.some((t) => t.id === "th_new1"), false, "no thread is made, or saved, before thread.create");
    assert.equal(live(s.runtime).size, 0, "and nothing of a thread's is live");
    const t = await s.call<Thread>("thread.create", { id: "th_new1", ...choices });
    assert.equal(t.id, "th_new1");
    assert.equal(ahead(s.runtime).size, 0, "taken by the thread");
    await s.call("thread.send", { id: t.id, text: "hello" });
    await until(() => s.store.thread(t.id).status === "done", "the turn ran");
    assert.equal(f.made.length, 1, "no second process");
    assert.deepEqual(f.made[0].texts, ["hello"], "the turn ran on the session opened ahead, with no hand-over");
    assert.deepEqual(f.made[0].before, [true], "its snapshot was taken before the prompt went");
    assert.equal(f.made[0].closed, false);
    // Sent the same choices again (a re-render), nothing more opens.
    await s.call("thread.warmNew", { id: "th_new2", ...choices });
    await until(() => f.made.length === 2, "the next ask's id opens one of its own");
    await s.call("thread.warmNew", { id: "th_new2", ...choices });
    await tick(50);
    assert.equal(f.made.length, 2, "the same choices again open nothing more");
    await s.runtime.shutdown();
  } finally {
    f.restore();
  }
});

test("create with other choices than were warmed: the warmed one closes, and the turn opens its own", async () => {
  const cases: [string, Record<string, unknown>][] = [
    ["model", { agent: "@claude:claude-sonnet-5-5" }],
    ["effort", { effort: "high" }],
    ["access", { access: "full" }],
    ["mode", { mode: "creator" }],
    ["sidekick", { sidekick: "claude:claude-sonnet-5-5" }],
    ["project", { projectId: "q" }],
  ];
  for (const [what, change] of cases) {
    const f = fake();
    try {
      const s = await setup();
      await s.call("thread.warmNew", { id: "th_x", ...choices });
      await until(() => f.made.length === 1, `${what}: warmed`);
      await s.call("thread.create", { id: "th_x", ...choices, ...change });
      assert.equal(f.made[0].closed, true, `${what}: the warmed one is closed by thread.create`);
      await s.call("thread.send", { id: "th_x", text: "hello" });
      await until(() => s.store.thread("th_x").status === "done", `${what}: the turn ran`);
      assert.equal(f.made.length, 2, `${what}: on a session of its own`);
      assert.deepEqual(f.made[1].texts, ["hello"]);
      await s.runtime.shutdown();
    } finally {
      f.restore();
    }
  }
});

test("a choice changed on Home before create: the same id warmed again closes the old one and opens the new", async () => {
  const f = fake();
  try {
    const s = await setup();
    await s.call("thread.warmNew", { id: "th_c", ...choices });
    await until(() => f.made.length === 1, "warmed");
    await s.call("thread.warmNew", { id: "th_c", ...choices, effort: "high" });
    await until(() => f.made.length === 2, "warmed again with the new choice");
    assert.equal(f.made[0].closed, true);
    assert.equal(f.made[1].o.effort, "high");
    await s.call("thread.create", { id: "th_c", ...choices, effort: "high" });
    await s.call("thread.send", { id: "th_c", text: "hello" });
    await until(() => s.store.thread("th_c").status === "done", "the turn ran");
    assert.equal(f.made.length, 2, "and the turn took it");
    // Switched to Worktree: what was open for that id closes, and nothing opens.
    await s.call("thread.warmNew", { id: "th_d", ...choices });
    await until(() => f.made.length === 3, "warmed");
    await s.call("thread.warmNew", { id: "th_d", ...choices, worktree: true });
    await until(() => f.made[2].closed, "closed once Worktree was picked");
    await tick(50);
    assert.equal(f.made.length, 3);
    await s.runtime.shutdown();
  } finally {
    f.restore();
  }
});

test("nothing opens for a worktree, a picked worktree, a fork, a design, a design project, the Demo, a tool that can't open ahead, or an id taken", async () => {
  let f = fake();
  try {
    const s = await setup();
    s.store.putProject({ id: "d", name: "d", path: s.dir, git: true, kind: "design", createdAt: Date.now() });
    const base = await s.call<Thread>("thread.create", { ...choices });
    for (const extra of [{ worktree: true }, { inWorktree: s.dir }, { base: "main" }, { forkOf: base.id }, { design: { file: "home" } }, { projectId: "d" }, { agent: "demo" }, { id: base.id }, { mode: "agent:nobody" }])
      await s.call("thread.warmNew", { id: "th_no", ...choices, ...extra });
    await tick(100);
    assert.equal(f.made.length, 0);
    await s.runtime.shutdown();
  } finally {
    f.restore();
  }
  f = fake({ warms: false });
  try {
    const s = await setup();
    await s.call("thread.warmNew", { id: "th_no", ...choices });
    await tick(100);
    assert.equal(f.made.length, 0, "a tool that can't open ahead isn't opened");
    await s.runtime.shutdown();
  } finally {
    f.restore();
  }
});

test("warmed and never made: closed after the limit, counted with other warms in the limit of two, closed at quit, and leaving nothing", async () => {
  const f = fake();
  try {
    const s = await setup();
    s.runtime.warmMs = 150;
    await s.call("thread.warmNew", { id: "th_gone", ...choices });
    await until(() => f.made.length === 1, "warmed");
    const key = f.made[0].o.mcp!.env.LINER_SURFACE_KEY;
    assert.equal(s.tools.threadOf(key), "th_gone");
    await until(() => f.made[0].closed, "closed once nobody made it in time");
    assert.equal(ahead(s.runtime).size, 0);
    assert.equal(s.tools.threadOf(key), undefined, "its key to Liner Code's tools reaches nothing now");
    assert.equal(existsSync(join(s.home, "attachments", "th_gone")), false, "no attachments folder");
    assert.equal(s.store.threads.length, 0, "nothing saved");
    // The id can still be made later, and another id is never held up by it.
    const t = await s.call<Thread>("thread.create", { id: "th_gone", ...choices });
    assert.equal(t.id, "th_gone");
    // Two warms of existing sessions and one ahead: the oldest closes.
    s.runtime.warmMs = 10_000;
    const a = await s.call<Thread>("thread.create", { ...choices });
    const b = await s.call<Thread>("thread.create", { ...choices });
    await s.runtime.warm(a.id);
    await s.runtime.warm(b.id);
    await s.call("thread.warmNew", { id: "th_third", ...choices });
    await until(() => f.made.length === 4, "the third opened");
    await until(() => f.made[1].closed, "the oldest of the three closed");
    assert.deepEqual(f.made.slice(2).map((m) => m.closed), [false, false]);
    // Quit closes the one ahead too.
    await s.runtime.shutdown();
    assert.equal(f.made[3].closed, true, "closed at quit");
  } finally {
    f.restore();
  }
});

test("a create that fails closes what was opened for its id; one whose start fails is let go", async () => {
  const f = fake();
  try {
    const s = await setup();
    await s.call("thread.warmNew", { id: "th_f", ...choices });
    await until(() => f.made.length === 1, "warmed");
    await assert.rejects(s.call("thread.create", { id: "th_f", ...choices, worktree: true, base: "no-such-branch" }));
    await until(() => f.made[0].closed, "closed when the create threw");
    assert.equal(ahead(s.runtime).size, 0);
    await s.runtime.shutdown();
  } finally {
    f.restore();
  }
  const g = fake({ fail: true });
  try {
    const s = await setup();
    await s.call("thread.warmNew", { id: "th_g", ...choices });
    await until(() => g.made[0]?.closed === true, "a session whose start failed is let go");
    await s.call("thread.create", { id: "th_g", ...choices });
    await s.call("thread.send", { id: "th_g", text: "hello" });
    await until(() => s.store.thread("th_g").status === "done", "the turn opens its own");
    assert.equal(g.made.length, 2);
    await s.runtime.shutdown();
  } finally {
    g.restore();
  }
});

test("a session opened ahead is no thread's: Stop, the idle close and retool pass it by, and an adopted one follows the warm rules, then the idle ones", async () => {
  const f = fake();
  try {
    const s = await setup();
    s.runtime.idleMs = 40;
    await s.call("thread.warmNew", { id: "th_i", ...choices });
    await until(() => f.made.length === 1, "warmed");
    s.runtime.stop("th_i");
    await s.runtime.retoolAll();
    await tick(150);
    assert.equal(f.made[0].closed, false, "nothing that goes by a thread touches it");
    await s.call("thread.create", { id: "th_i", ...choices });
    await tick(150);
    assert.equal(f.made[0].closed, false, "adopted and unused: the idle close leaves it to the warm rules");
    await s.call("thread.send", { id: "th_i", text: "hello" });
    await until(() => f.made[0].closed, "after its first turn, the idle close takes it like any other");
    await s.runtime.shutdown();
  } finally {
    f.restore();
  }
});

test("a comparison picked, or the draft emptied or left: what was opened for the id closes at once, even while it's still opening", async () => {
  const f = fake();
  try {
    const s = await setup();
    await s.call("thread.warmNew", { id: "th_cmp", ...choices });
    await until(() => f.made.length === 1, "warmed");
    await s.call("thread.warmNew", { id: "th_cmp", ...choices, compare: true });
    await until(() => f.made[0].closed, "a comparison makes its own sessions: closed");
    await s.call("thread.warmNew", { id: "th_left", ...choices });
    await until(() => f.made.length === 2, "warmed");
    await s.call("thread.unwarmNew", { id: "th_left" });
    await until(() => f.made[1].closed, "the draft went: closed");
    // Asked to let go before its opening has even begun: it's let go once it's open.
    await Promise.all([s.call("thread.warmNew", { id: "th_quick", ...choices }), s.call("thread.unwarmNew", { id: "th_quick" })]);
    await until(() => f.made.length === 3 && f.made[2].closed, "closed as soon as it opened");
    assert.equal(ahead(s.runtime).size, 0);
    await s.runtime.shutdown();
  } finally {
    f.restore();
  }
});

test("create waits for any opening of its id, under whichever agent, and takes it only if it's the same; an omitted agent resolves alike", async () => {
  let release!: () => void;
  let slow = false;
  const f = fake({ close: () => (slow ? new Promise<void>((r) => (release = r)) : undefined) });
  try {
    const s = await setup();
    // A choice changed while the first is still closing, and create comes meanwhile: nothing opens beside the close, and the
    // session opens once (the warm sees the thread made and leaves it to the turn).
    await s.call("thread.warmNew", { id: "th_r", ...choices });
    await until(() => f.made.length === 1, "warmed");
    slow = true;
    await s.call("thread.warmNew", { id: "th_r", ...choices, effort: "high" });
    await until(() => f.made[0].closed, "the old one is closing");
    slow = false;
    const creating = s.call("thread.create", { id: "th_r", ...choices, effort: "high" });
    await tick(30);
    assert.equal(f.made.length, 1, "nothing opens while the old one is still closing");
    release();
    await creating;
    await s.call("thread.send", { id: "th_r", text: "hello" });
    await until(() => s.store.thread("th_r").status === "done", "the turn ran");
    assert.equal(f.made.length, 2, "one session for the thread");
    assert.deepEqual(f.made[1].texts, ["hello"]);
    // An opening under one agent, the thread made with another at that very moment: adopt waits for it, then closes it.
    const draft = (agent: string): Thread => ({ id: "th_a", projectId: "p", title: "New session", agent, status: "idle", access: "edits", effort: "medium", review: false, turns: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }, createdAt: 1, updatedAt: 1 }) as Thread;
    const warming = s.runtime.warmNew(draft("@claude:claude-opus-5-5"));
    const made = draft("@claude:claude-sonnet-5-5");
    s.store.putThread(made);
    await s.runtime.adopt(made);
    await warming;
    await until(() => f.made.length === 3 && f.made[2].closed, "the one opened for the other agent is closed, not left beside the thread");
    assert.equal(ahead(s.runtime).size, 0);
    assert.equal(live(s.runtime).has("th_a:@claude:claude-sonnet-5-5"), false);
    // The same at that moment, with the agent it was opened for: taken.
    const same = { ...draft("@claude:claude-opus-5-5"), id: "th_b" };
    const warming2 = s.runtime.warmNew(same);
    s.store.putThread(same);
    await s.runtime.adopt(same);
    await warming2;
    await until(() => f.made.length === 4, "opened");
    await tick(30);
    assert.equal(f.made[3].closed, false);
    assert.equal(live(s.runtime).has("th_b:@claude:claude-opus-5-5"), true, "taken by the thread");
    // No agent named, both ways: the project's, the same for warmNew as for create.
    s.store.putProject({ ...s.store.project("p"), agent: "@claude:claude-opus-5-5" });
    const { agent: _, ...none } = choices;
    await s.call("thread.warmNew", { id: "th_o", ...none });
    await until(() => f.made.length === 5, "warmed");
    await s.call("thread.create", { id: "th_o", ...none });
    assert.equal(f.made[4].closed, false, "taken");
    assert.equal(ahead(s.runtime).size, 0);
    await s.runtime.shutdown();
  } finally {
    f.restore();
  }
});

test("a thread made under the id while its marker's holders are looked up keeps its marker", async () => {
  const f = fake();
  try {
    const s = await setup();
    let answer!: (v: Set<number>) => void;
    s.runtime.markHolders = () => new Promise((r) => (answer = r));
    await s.call("thread.warmNew", { id: "th_m", ...choices });
    await until(() => f.made.length === 1, "warmed");
    const file = markFile("thread", "th_m");
    writeFileSync(file, "");
    await s.call("thread.unwarmNew", { id: "th_m" });
    await until(() => f.made[0].closed && Boolean(answer), "closed, and its marker's holders asked about");
    await s.call("thread.create", { id: "th_m", ...choices });
    answer(new Set());
    await tick(30);
    assert.equal(existsSync(file), true, "the new thread's marker stays");
    // One nobody made goes.
    await s.call("thread.warmNew", { id: "th_m2", ...choices });
    await until(() => f.made.length === 2, "warmed");
    const file2 = markFile("thread", "th_m2");
    writeFileSync(file2, "");
    answer = undefined as never;
    await s.call("thread.unwarmNew", { id: "th_m2" });
    await until(() => Boolean(answer), "asked");
    answer(new Set());
    await until(() => !existsSync(file2), "removed");
    await s.runtime.shutdown();
  } finally {
    f.restore();
  }
});

test("thread.warm while a worktree is being put back opens nothing until its setup has run", async () => {
  const f = fake();
  try {
    const s = await setup();
    // A session whose worktree a clean-up took, put away: opened again, the folder comes back, then the project's setup runs there.
    s.store.putProject({ ...s.store.project("p"), setup: "sleep 1.5" });
    await git(s.dir, "branch", "liner/back");
    const root = join(s.home, "worktrees", "th_back");
    s.store.putThread({ id: "th_back", projectId: "p", title: "Back", agent: "@claude:claude-opus-5-5", status: "idle", access: "edits", archived: true, providerSession: "claude:sid-0", worktree: { path: root, branch: "liner/back", made: true }, turns: 1, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
    await s.call("thread.update", { id: "th_back", archived: false });
    await until(() => existsSync(join(root, "a.txt")), "the worktree's folder is back");
    assert.equal(s.runtime.settingUp?.("th_back"), true, "and its setup still runs");
    await s.call("thread.warm", { id: "th_back" });
    await tick(200);
    assert.equal(f.made.length, 0, "nothing opens in a folder still being set up");
    await until(() => s.runtime.settingUp?.("th_back") === false, "the setup ends", 10_000);
    await s.call("thread.warm", { id: "th_back" });
    await until(() => f.made.length === 1, "once it's done, writing opens the session ahead as it would anywhere");
    assert.equal(f.made[0].o.cwd, root);
    await s.runtime.shutdown();
  } finally {
    f.restore();
  }
});
