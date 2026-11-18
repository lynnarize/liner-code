/*
  The prompt check (precheck.ts): each rule fires where it should and not where it shouldn't, their order, the three-second
  cap on the one model question, that the model is never asked when the words don't already point that way, and the
  composer's memory of a draft (ui precheck-state.ts): a suggestion you closed doesn't come back for that draft. Then the
  engine's side: what a session says of itself, a split's sessions, and "Use <fast model>" for one message. Fake tools only.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item, ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { draftCheck, longSession, maybeNewSubject, SEND_LIMIT_MS, sendCheck, smallAsk, tasksOf, yesNo, type DraftFacts } from "../src/precheck.ts";
import { DraftMemory } from "../../ui/src/app/precheck-state.ts";
import { createApi } from "../src/api.ts";
import { run } from "../src/exec.ts";
import type { Provider } from "../src/providers/types.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

const TASKS = "- Add a dark mode toggle to the settings page\n- Fix the date parser for leap years\n- Write tests for the CSV export";
const OPUS = "claude:claude-opus-5-5";
const SONNET = "claude:claude-sonnet-5-5";
const heavy: Omit<DraftFacts, "text"> = { first: false, model: OPUS, top: OPUS, fast: SONNET, fastLabel: "Sonnet 5.5" };

test("split: three list items that each read as a task fire on a first message, with the tasks", () => {
  const p = draftCheck({ text: TASKS, first: true });
  assert.equal(p?.kind, "split");
  assert.equal(p?.action, "Split into 3 sessions");
  assert.deepEqual(p?.tasks, ["Add a dark mode toggle to the settings page", "Fix the date parser for leap years", "Write tests for the CSV export"]);
  // Numbered, under a lead-in that names no task of its own.
  assert.equal(tasksOf("Please do these:\n1. Rename the config loader module\n2) Remove the unused lodash import\n3. Update the README install steps")?.length, 3);
});

test("split: no fire on two items, steps of one task, details, a later message, or a long backlog", () => {
  assert.equal(tasksOf("- Add a dark mode toggle\n- Fix the date parser for leap years"), null, "two items");
  assert.equal(tasksOf("Add login:\n1. Create the login form component\n2. Add the session route handler\n3. Write tests for the flow"), null, "a lead-in that is a task makes the list its steps");
  assert.equal(tasksOf("- Add the login form component\n- Then wire it to the session route\n- Write tests for the whole flow"), null, "an item that leans on the one before");
  assert.equal(tasksOf("- the header is too tall\n- the footer colour is off\n- the logo is blurry on retina"), null, "notes, not tasks");
  assert.equal(tasksOf(`${TASKS}\n\nThey all touch the same file, so go slowly.`), null, "prose after the list");
  assert.equal(tasksOf(Array.from({ length: 7 }, (_, i) => `- Fix bug number ${i} in the parser`).join("\n")), null, "past six is a backlog");
  assert.equal(draftCheck({ text: TASKS, first: false }), null, "not on a later message");
});

test("split: never when a task would lose words: a lead-in that says something of them all, or an item under another", () => {
  assert.equal(tasksOf(`We're on the staging DB, never run migrations.\n${TASKS}`), null, "context above the list would be left out of every task");
  assert.equal(tasksOf(`Use the new API client for all of these\n${TASKS}`), null, "a lead-in with no colon that isn't plain");
  assert.equal(tasksOf(`The following, and keep the old names:\n${TASKS}`), null, "plain words with more after them");
  assert.equal(tasksOf("- Add a dark mode toggle to the settings page\n  - Fix the toggle's label in the header\n- Fix the date parser for leap years\n- Write tests for the CSV export"), null, "an indented item is the one above's");
  assert.equal(tasksOf("- Add a dark mode toggle to the settings page\n\t- Fix the toggle's label in the header\n- Fix the date parser for leap years\n- Write tests for the CSV export"), null, "a tab-indented one too");
  // Still offered: a list indented as a whole, and plain lead-ins.
  assert.equal(tasksOf(TASKS.split("\n").map((l) => `  ${l}`).join("\n"))?.length, 3);
  for (const lead of ["Please do these:", "Here are a few things:", "The following, please:", "Fixes:", "Can you do the following for me?"]) assert.equal(tasksOf(`${lead}\n${TASKS}`)?.length, 3, lead);
  // A line with a long run of spaces is read in no time.
  const t = performance.now();
  tasksOf(`- Fix a${" ".repeat(50_000)}b\n${TASKS}`);
  assert.ok(performance.now() - t < 50);
});

test("heavy: the tool's top model or highest effort for a small ask offers the fast model, else nothing", () => {
  const p = draftCheck({ ...heavy, text: "rename getUser to fetchUser" });
  assert.equal(p?.kind, "heavy");
  assert.equal(p?.action, "Use Sonnet 5.5");
  assert.equal(p?.model, SONNET);
  assert.equal(draftCheck({ ...heavy, model: "claude:claude-haiku-5", top: OPUS, highest: true, text: "fix the typo in the README title" })?.kind, "heavy", "highest effort on a model that isn't the fast one");
  assert.equal(draftCheck({ ...heavy, model: SONNET, text: "rename getUser to fetchUser" }), null, "already on the fast model");
  assert.equal(draftCheck({ ...heavy, text: "why does the parser fail on leap years and how should we redesign it" }), null, "a big ask");
  assert.equal(draftCheck({ ...heavy, text: "rename getUser to fetchUser across the whole codebase" }), null, "a short ask with a big reach");
  assert.equal(draftCheck({ ...heavy, pair: true, text: "rename getUser to fetchUser" }), null, "a pair's lead hands small work over itself");
  assert.equal(draftCheck({ ...heavy, fast: undefined, text: "rename getUser to fetchUser" }), null, "a tool with one model");
  assert.ok(smallAsk("fix the typo in the header") && !smallAsk("add a settings page with a dark mode"));
});

test("priority: a split comes before the heavy model, and Send's split needs no model", async () => {
  const facts = { ...heavy, first: true, text: "- Rename the config loader module\n- Fix the typo in the README title\n- Bump the version in package json" };
  assert.equal(draftCheck(facts)?.kind, "split");
  let asked = 0;
  const p = await sendCheck({ ...facts, turns: 20 }, async () => (asked++, "yes"));
  assert.equal(p?.kind, "split");
  assert.equal(asked, 0);
});

const long: DraftFacts = { text: "Set up Stripe billing webhooks with retries and signature checks", first: false, turns: 12, recent: ["Fix the tide time after midnight", "the tide table shows 24:10 instead of 00:10", "also the timezone label is wrong"] };

test("unrelated: a long session and a new subject ask the quick model once; its yes is the suggestion, its no is nothing", async () => {
  assert.ok(longSession({ turns: 8 }) && longSession({ turns: 2, context: 0.6 }) && !longSession({ turns: 3, context: 0.2 }));
  assert.ok(maybeNewSubject(long.text, long.recent!));
  const prompts: string[] = [];
  const yes = await sendCheck(long, async (prompt) => (prompts.push(prompt), "Yes."));
  assert.equal(yes?.kind, "unrelated");
  assert.equal(yes?.action, "Start a new session");
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /yes or no/i);
  assert.equal(await sendCheck(long, async () => "No, it carries on."), null);
  assert.equal(await sendCheck(long, async () => "Maybe"), null, "neither yes nor no is nothing");
  assert.equal(await sendCheck(long, async () => Promise.reject(new Error("the tool failed"))), null, "a failure lets it go");
  assert.equal(yesNo("**yes**"), true);
});

test("unrelated: the model is never asked in a short session, on a follow-up, on shared words, or with the switch off", async () => {
  let asked = 0;
  const ask = async () => (asked++, "yes");
  assert.equal(await sendCheck({ ...long, turns: 2 }, ask), null, "short session");
  assert.equal(await sendCheck({ ...long, text: "also set up Stripe billing webhooks with retries" }, ask), null, "opens as a follow-up");
  assert.equal(await sendCheck({ ...long, text: "the timezone label still shows UTC after the fix" }, ask), null, "shares a word with the session");
  assert.equal(await sendCheck({ ...long, text: "do it" }, ask), null, "too short to say what it's about");
  assert.equal(await sendCheck(long, ask, { useModel: false }), null, "switch off");
  assert.equal(asked, 0);
});

test("unrelated: no answer within three seconds is no suggestion, and the send isn't held longer", async () => {
  assert.equal(SEND_LIMIT_MS, 3000);
  let aborted = false;
  const started = Date.now();
  const p = await sendCheck(long, (_, signal) => new Promise((ok) => signal.addEventListener("abort", () => ((aborted = true), ok("yes")))));
  const took = Date.now() - started;
  assert.equal(p, null, "a yes that came after the cap doesn't count");
  assert.ok(took >= 2900 && took < 3600, `held ${took} ms`);
  assert.ok(aborted, "the question is called off at the cap");
});

test("dismissed: a closed suggestion stays away for that draft, comes back for a new one, and a read draft sends", () => {
  const m = new DraftMemory();
  const split = draftCheck({ text: TASKS, first: true });
  m.see(TASKS);
  assert.equal(m.shown(split), split);
  m.close("split");
  assert.equal(m.shown(split), null);
  m.see(`${TASKS}\n- Bump the version in package json`);
  assert.equal(m.shown(split), null, "words changed on the way are the same draft");
  m.see("");
  assert.equal(m.shown(split), split, "a new draft starts clean");
  // Send's check: read once, the next Send goes; closing what it said lets every Send of the draft go.
  assert.equal(m.passes("Set up billing"), false);
  m.read("Set up billing");
  assert.ok(m.passes("Set up billing") && m.readNow("Set up billing"));
  m.reset();
  assert.equal(m.passes("Set up billing"), false);
  m.close("unrelated");
  assert.ok(m.passes("anything else in this draft"));
});

// The engine's side: a session's facts, the split, and one message on the fast model.

const info = (id: ProviderInfo["id"], models: { id: string; efforts?: string[] }[]): ProviderInfo => ({ id, label: "Claude Code", available: true, adapter: true, login: "", models: models.map((m) => ({ id: m.id, label: m.id === "claude-opus-5-5" ? "Opus 5.5" : m.id === "claude-sonnet-5-5" ? "Sonnet 5.5" : m.id, description: "", ...(m.efforts ? { efforts: m.efforts.map((e) => ({ id: e, label: e })) } : {}) })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 500 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}
const who = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
const git = (cwd: string, ...args: string[]) => run("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: { ...process.env, ...who } });

function fake() {
  const turns: { model: string; text: string }[] = [];
  const p: Provider = {
    id: "claude",
    detect: async () => info("claude", [{ id: "claude-opus-5-5" }, { id: "claude-sonnet-5-5" }]),
    open: (o) => ({ close() {}, turn: async (text) => void turns.push({ model: o.model, text }) }),
  };
  const saved = providers.claude;
  providers.claude = p;
  return { turns, restore: () => (providers.claude = saved) };
}

async function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lc-pc-dir-")));
  await git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.txt"), "one\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "start");
  const home = realpathSync(mkdtempSync(join(tmpdir(), "lc-pc-home-")));
  const store = new Store(home);
  store.setSettings({ worktreeRoot: join(home, "trees") });
  store.putProject({ id: "p", name: "p", path: dir, git: true, createdAt: Date.now() });
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", ...who };
  const runtime = new Runtime(store, env);
  runtime.providerInfo = [info("claude", [{ id: "claude-opus-5-5", efforts: ["low", "medium", "high"] }, { id: "claude-sonnet-5-5" }])];
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const call = <T>(method: string, params: unknown) => api.call(method, params) as Promise<T>;
  return { dir, store, runtime, call };
}

test("engine: a session's draft gets the heavy rule from its tool's own Best and Fast, and nothing in a side chat or Workshop", async () => {
  const f = fake();
  try {
    const s = await setup();
    const t = await s.call<Thread>("thread.create", { projectId: "p", agent: `@${OPUS}`, review: false, worktree: false });
    s.store.patchThread(t.id, { turns: 3 });
    const p = await s.call<{ kind: string; model?: string } | null>("precheck.draft", { threadId: t.id, text: "fix the typo in the README title" });
    assert.equal(p?.kind, "heavy");
    assert.equal(p?.model, SONNET);
    s.store.patchThread(t.id, { mode: "creator" });
    assert.equal(await s.call("precheck.draft", { threadId: t.id, text: "fix the typo in the README title" }), null, "Workshop");
    s.store.patchThread(t.id, { mode: undefined, sideOf: "x" });
    assert.equal(await s.call("precheck.draft", { threadId: t.id, text: "fix the typo in the README title" }), null, "a side chat");
    s.store.setSettings({ precheck: false });
    assert.equal(await s.call("precheck.draft", { projectId: "p", text: TASKS }), null, "the switch off");
  } finally {
    f.restore();
  }
});

test("engine: Use <fast model> runs this one message on it, and the session's model comes back after", async () => {
  const f = fake();
  try {
    const s = await setup();
    const t = await s.call<Thread>("thread.create", { projectId: "p", agent: `@${OPUS}`, review: false, worktree: false });
    await s.call("thread.send", { id: t.id, text: "rename getUser to fetchUser", once: SONNET });
    await until(() => f.turns.length === 1 && !s.runtime.isRunning(t.id), "the turn ran");
    const marker = s.store.timeline(t.id).find((x): x is Extract<Item, { kind: "turn" }> => x.kind === "turn");
    assert.equal(marker?.model, SONNET, "this message ran on the fast model");
    assert.equal(s.store.thread(t.id).model, undefined, "the session's own model is back");
    await s.call("thread.send", { id: t.id, text: "now explain the change" });
    await until(() => f.turns.length === 2 && !s.runtime.isRunning(t.id), "the next turn ran");
    const markers = s.store.timeline(t.id).filter((x): x is Extract<Item, { kind: "turn" }> => x.kind === "turn");
    assert.equal(markers[1].model, OPUS, "the next message is on the session's model again");
  } finally {
    f.restore();
  }
});

test("engine: a split starts one session per task, each in a worktree from the same commit, with the same model and access", async () => {
  const f = fake();
  try {
    const s = await setup();
    const head = (await git(s.dir, "rev-parse", "HEAD")).stdout.trim();
    const { made, left } = await s.call<{ made: Thread[]; left: string[] }>("precheck.split", { projectId: "p", tasks: ["Add a dark mode toggle", "Fix the leap year parser", "Write CSV export tests"], agent: `@${OPUS}`, effort: "medium", access: "auto" });
    assert.equal(made.length, 3);
    assert.deepEqual(left, []);
    for (const t of made) {
      assert.ok(t.worktree?.path, "a worktree of its own");
      assert.equal(t.agent, `@${OPUS}`);
      assert.equal(t.access, "auto");
      assert.equal((await git(t.worktree!.path, "rev-parse", "HEAD")).stdout.trim(), head, "from the same commit");
    }
    await until(() => f.turns.length === 3, "each task went as its session's first message");
    assert.deepEqual(f.turns.map((x) => x.text).sort(), ["Add a dark mode toggle", "Fix the leap year parser", "Write CSV export tests"]);
    // A session's first message keeps the first task where it is.
    const here = await s.call<Thread>("thread.create", { projectId: "p", agent: `@${OPUS}`, review: false, worktree: false });
    const { made: more } = await s.call<{ made: Thread[] }>("precheck.split", { projectId: "p", threadId: here.id, tasks: ["Task one is here", "Task two goes", "Task three goes"], agent: `@${OPUS}`, effort: "medium", access: "auto" });
    assert.equal(more.length, 2);
    await until(() => f.turns.length === 6, "the three went");
    assert.ok(s.store.timeline(here.id).some((x) => x.kind === "user" && x.text === "Task one is here"));
    await assert.rejects(s.call("precheck.split", { projectId: "p", threadId: here.id, tasks: ["a", "b"], agent: `@${OPUS}`, effort: "medium", access: "auto" }), /first message/);
  } finally {
    f.restore();
  }
});

test("engine: a split reads its tasks from the draft as it is when pressed, and refuses one that no longer reads as tasks", async () => {
  const f = fake();
  try {
    const s = await setup();
    // An edit after the last check: the fourth task is there, the old list (`tasks`) is not what goes.
    const { made } = await s.call<{ made: Thread[] }>("precheck.split", { projectId: "p", text: `${TASKS}\n- Update the README install steps`, tasks: ["Old task one here", "Old task two here", "Old task three here"], agent: `@${OPUS}`, effort: "medium", access: "auto" });
    assert.equal(made.length, 4);
    await until(() => f.turns.length === 4, "each task went");
    assert.ok(f.turns.some((x) => x.text === "Update the README install steps") && !f.turns.some((x) => x.text.startsWith("Old")));
    await assert.rejects(s.call("precheck.split", { projectId: "p", text: `We're on the staging DB, never run migrations.\n${TASKS}`, agent: `@${OPUS}`, effort: "medium", access: "auto" }), /doesn't read as separate tasks/);
    assert.equal(s.store.threads.length, 4, "nothing more was made");
  } finally {
    f.restore();
  }
});

test("engine: on Send, with the model rule turned on, a long session's new subject asks its tool's quick model once, read only, apart from the session's spend", async () => {
  const opened: { access: string; model: string; prompt?: string }[] = [];
  const p: Provider = {
    id: "claude",
    detect: async () => info("claude", [{ id: "claude-opus-5-5" }, { id: "claude-haiku-5" }]),
    open: (o) => {
      const me: { access: string; model: string; prompt?: string } = { access: o.access, model: o.model };
      opened.push(me);
      return { close() {}, turn: async (text, sink) => void ((me.prompt = text), sink.usage({ inputTokens: 10, outputTokens: 1, costUsd: 0.5 }), sink.text("yes", "b")) };
    },
  };
  const saved = providers.claude;
  providers.claude = p;
  try {
    const s = await setup();
    s.runtime.providerInfo = [info("claude", [{ id: "claude-opus-5-5" }, { id: "claude-haiku-5" }])];
    const t = await s.call<Thread>("thread.create", { projectId: "p", agent: `@${OPUS}`, review: false, worktree: false });
    s.store.patchThread(t.id, { turns: 12, title: "Fix the tide time after midnight" });
    s.store.putItem(t.id, { kind: "user", id: "u1", turn: 12, at: Date.now(), text: "the tide table shows 24:10 instead of 00:10" });
    const ask = "Set up Stripe billing webhooks with retries and signature checks";
    assert.equal(await s.call("precheck.send", { threadId: t.id, text: ask }), null, "off by default");
    assert.equal(opened.length, 0, "off by default asks nothing");
    s.store.setSettings({ precheckModel: true, capUsd: 0.1 });
    const said = await s.call<{ kind: string } | null>("precheck.send", { threadId: t.id, text: "Set up Stripe billing webhooks with retries and signature checks" });
    assert.equal(said?.kind, "unrelated");
    assert.equal(opened.length, 1, "one question");
    assert.equal(opened[0].access, "read");
    assert.equal(opened[0].model, "claude-haiku-5", "the quick model");
    assert.ok(s.store.usage(0).some((r) => r.agent === "precheck" && r.threadId === "" && r.costUsd === 0.5), "its use is logged as the prompt check's, with no session");
    assert.equal(s.store.thread(t.id).usage.costUsd, 0, "none of it counts toward the session or its cap");
    assert.ok(!s.store.timeline(t.id).some((x) => x.kind === "notice" && /cap/.test(x.text)), "no cap stop");
    assert.equal(await s.call("precheck.send", { threadId: t.id, text: "the label still shows 24:10 after the fix" }), null);
    assert.equal(opened.length, 1, "a draft on the same subject asks nothing");
    s.store.setSettings({ precheckModel: false });
    assert.equal(await s.call("precheck.send", { threadId: t.id, text: "Set up Stripe billing webhooks with retries and signature checks" }), null);
    assert.equal(opened.length, 1, "the model switch off asks nothing");
    // A tool with no quick model ready: skipped outright.
    s.store.setSettings({ precheckModel: true });
    s.runtime.providerInfo = [info("claude", [{ id: "claude-opus-5-5" }])];
    assert.equal(await s.call("precheck.send", { threadId: t.id, text: ask }), null);
    assert.equal(opened.length, 1, "no quick model, no question");
  } finally {
    providers.claude = saved;
  }
});

test("engine: a session left on the fast model (the engine stopped mid-message) gets its own model back when the engine starts", async () => {
  const f = fake();
  try {
    const s = await setup();
    const t = await s.call<Thread>("thread.create", { projectId: "p", agent: `@${OPUS}`, review: false, worktree: false });
    const other = await s.call<Thread>("thread.create", { projectId: "p", agent: `@${OPUS}`, review: false, worktree: false });
    // As a crash leaves them: switched to Sonnet for one message, the way back on the thread. The other was moved by hand since.
    s.store.patchThread(t.id, { model: SONNET, onceFrom: { once: SONNET } });
    s.store.patchThread(other.id, { model: "claude:claude-haiku-5", onceFrom: { model: OPUS, once: SONNET } });
    new Runtime(s.store, { PATH: "/usr/bin:/bin" });
    assert.equal(s.store.thread(t.id).model, undefined, "back on the agent's own model");
    assert.equal(s.store.thread(t.id).onceFrom, undefined);
    assert.equal(s.store.thread(other.id).model, "claude:claude-haiku-5", "a model picked meanwhile stays");
    assert.equal(s.store.thread(other.id).onceFrom, undefined);
    // And before the next message, should it still be there.
    s.store.patchThread(t.id, { model: SONNET, onceFrom: { model: OPUS, once: SONNET } });
    await s.call("thread.send", { id: t.id, text: "carry on" });
    await until(() => f.turns.length === 1 && !s.runtime.isRunning(t.id), "the turn ran");
    assert.equal(f.turns[0].model, "claude-opus-5-5", "the next message runs on the session's own model");
    assert.equal(s.store.thread(t.id).model, OPUS);
  } finally {
    f.restore();
  }
});

test("engine: a split from a session in a worktree starts from that worktree's commit, and one that fails partway says what started and what's left", async () => {
  const f = fake();
  try {
    const s = await setup();
    const head = (await git(s.dir, "rev-parse", "HEAD")).stdout.trim();
    const here = await s.call<Thread>("thread.create", { projectId: "p", agent: `@${OPUS}`, review: false, worktree: true });
    await until(() => Boolean(s.store.thread(here.id).worktree?.path), "its worktree");
    const tree = s.store.thread(here.id).worktree!.path;
    // The worktree moved on by a commit of its own: the split's sessions start there, not at the project's HEAD.
    writeFileSync(join(tree, "b.txt"), "two\n");
    await git(tree, "add", "-A");
    await git(tree, "commit", "-q", "-m", "in the worktree");
    const theirs = (await git(tree, "rev-parse", "HEAD")).stdout.trim();
    assert.notEqual(theirs, head);
    // The second session made fails (its save throws), after the first started.
    const put = s.store.putThread.bind(s.store);
    let n = 0;
    s.store.putThread = (t: Thread) => {
      if (t.title === "Task three fails" && n++ === 0) throw new Error("the disk is full");
      return put(t);
    };
    const r = await s.call<{ made: Thread[]; left: string[]; why?: string }>("precheck.split", { projectId: "p", threadId: here.id, tasks: ["Task one stays here", "Task two starts", "Task three fails", "Task four is left"], agent: `@${OPUS}`, effort: "medium", access: "auto" });
    s.store.putThread = put;
    assert.deepEqual(r.made.map((t) => t.title), ["Task two starts"]);
    assert.deepEqual(r.left, ["Task three fails", "Task four is left"], "only the unmade tasks come back");
    assert.match(r.why ?? "", /disk is full/);
    assert.equal((await git(r.made[0].worktree!.path, "rev-parse", "HEAD")).stdout.trim(), theirs, "from the worktree's commit");
    await until(() => f.turns.length === 2, "the session's own task and the one made went");
    assert.deepEqual(f.turns.map((x) => x.text).sort(), ["Task one stays here", "Task two starts"]);
  } finally {
    f.restore();
  }
});
