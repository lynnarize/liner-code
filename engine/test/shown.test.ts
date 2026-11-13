/*
  What the person reads of a message Liner wrote for them (thread.send's `shown`): it is kept on the
  user item, in the queue, in a fork, in the export and in search, and it never reaches the agent:
  the prompt a provider gets is byte for byte what it was without it. Fake agents and throwaway
  folders only. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item, ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { sessionMarkdown } from "../src/export.ts";
import { searchSessions, titleForAgents } from "../src/memory.ts";
import type { Provider, TurnSink } from "../src/providers/types.ts";
import { providers, Runtime, shownOf } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 400 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}

/** Claude Code, faked: records every prompt and steer it is given, and runs `work` for each turn. */
function fake(work: (text: string, sink: TurnSink, signal: AbortSignal) => Promise<void> | void = () => {}) {
  const prompts: { text: string }[] = [];
  const steers: { text: string }[] = [];
  const p: Provider = {
    id: "claude",
    detect: async () => info("claude", ["claude-opus-5-5"]),
    open: () => ({
      close() {},
      steer: (text) => (steers.push({ text }), true),
      turn: async (text, sink, signal) => {
        prompts.push({ text });
        await work(text, sink, signal);
      },
    }),
  };
  const saved = providers.claude;
  providers.claude = p;
  return { prompts, steers, restore: () => (providers.claude = saved) };
}

function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lc-shown-dir-")));
  const home = realpathSync(mkdtempSync(join(tmpdir(), "lc-shown-home-")));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  const env = { PATH: "/usr/bin:/bin" };
  const runtime = new Runtime(store, env);
  runtime.providerInfo = [info("claude", ["claude-opus-5-5"])];
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const call = <T>(method: string, params: unknown) => api.call(method, params) as Promise<T>;
  const session = () => call<Thread>("thread.create", { projectId: "p", agent: "@claude:claude-opus-5-5", review: false, worktree: false });
  return { store, runtime, call, session };
}

type User = Extract<Item, { kind: "user" }>;
const users = (store: Store, id: string) => store.timeline(id).filter((x): x is User => x.kind === "user");

const TOLD = "Fix this check in Phone / Menu:\n- Phone / Menu (touch, data-l oum1): Visit is 23 wide to touch. 24 is the least.\n\nChange only what this needs.";
const SHOWN = { text: "Visit is 23 wide to touch. 24 is the least. READ-ONLY-WORDS", chips: [{ kind: "check" as const, label: "Fix 1 check" }, { kind: "frame" as const, label: "Phone / Menu" }] };

test("shown: the provider's prompt is byte for byte the one without it, and the item keeps both", async () => {
  const f = fake();
  try {
    const s = setup();
    const plain = await s.session();
    const read = await s.session();
    await s.call("thread.send", { id: plain.id, text: TOLD });
    await until(() => f.prompts.length === 1 && !s.runtime.isRunning(plain.id), "the plain turn ran");
    await s.call("thread.send", { id: read.id, text: TOLD, shown: SHOWN });
    await until(() => f.prompts.length === 2 && !s.runtime.isRunning(read.id), "the turn with shown ran");
    assert.equal(f.prompts[1].text, f.prompts[0].text, "the agent is told exactly the same words");
    assert.ok(!f.prompts[1].text.includes("READ-ONLY-WORDS"), "nothing of `shown` reaches the agent");
    const [u] = users(s.store, read.id);
    assert.equal(u.text, TOLD, "the item keeps what the agent was told, whole");
    assert.deepEqual(u.shown, SHOWN, "and what the person reads");
    assert.equal(users(s.store, plain.id)[0].shown, undefined, "a plain message has none");
    // A session named by its first message is named by what the person read of it.
    assert.match(s.store.thread(read.id).title, /^Visit is 23 wide/);
  } finally {
    f.restore();
  }
});

test("shown: a queued message keeps it, and still sends only its words", async () => {
  let hold: () => void = () => {};
  const f = fake((text) => (text === "first" ? new Promise<void>((r) => (hold = r)) : undefined));
  try {
    const s = setup();
    const t = await s.session();
    await s.call("thread.send", { id: t.id, text: "first" });
    await until(() => f.prompts.length === 1, "the first turn runs");
    await s.call("thread.send", { id: t.id, text: TOLD, shown: SHOWN, mode: "queue" });
    await until(() => (s.store.thread(t.id).queue ?? []).length === 1, "the ask waits in the queue");
    assert.deepEqual(s.store.thread(t.id).queue![0].shown, SHOWN, "the queue holds what the person reads");
    hold();
    await until(() => f.prompts.length === 2 && !s.runtime.isRunning(t.id), "the queue went");
    assert.equal(f.prompts[1].text, TOLD, "the agent gets the words alone");
    const last = users(s.store, t.id).at(-1)!;
    assert.equal(last.text, TOLD);
    assert.deepEqual(last.shown, SHOWN);
  } finally {
    f.restore();
  }
});

test("shown: a steer keeps it, and steers with the same words as without it", async () => {
  let hold: () => void = () => {};
  const f = fake(() => new Promise<void>((r) => (hold = r)));
  try {
    const s = setup();
    const t = await s.session();
    await s.call("thread.send", { id: t.id, text: "first" });
    await until(() => f.prompts.length === 1, "the first turn runs");
    await s.call("thread.send", { id: t.id, text: TOLD, mode: "steer" });
    await s.call("thread.send", { id: t.id, text: TOLD, shown: SHOWN, mode: "steer" });
    await until(() => f.steers.length === 2, "both steered");
    assert.equal(f.steers[1].text, f.steers[0].text, "the same words reach the agent");
    const steered = users(s.store, t.id).filter((x) => x.steer);
    assert.equal(steered.length, 2);
    assert.equal(steered[0].shown, undefined);
    assert.deepEqual(steered[1].shown, SHOWN);
    hold();
    await until(() => !s.runtime.isRunning(t.id), "the turn ends");
  } finally {
    f.restore();
  }
});

test("shown: a fork carries it, and the conversation it hands on says what the agent was told", async () => {
  const f = fake();
  try {
    const s = setup();
    const t = await s.session();
    await s.call("thread.send", { id: t.id, text: TOLD, shown: SHOWN });
    await until(() => f.prompts.length === 1 && !s.runtime.isRunning(t.id), "the turn ran");
    const fork = await s.call<Thread>("thread.create", { projectId: "p", forkOf: t.id });
    const copied = users(s.store, fork.id);
    assert.equal(copied.length, 1);
    assert.deepEqual(copied[0].shown, SHOWN, "the fork's copy keeps what the person reads");
    assert.equal(copied[0].text, TOLD);
    await s.call("thread.send", { id: fork.id, text: "and the next" });
    await until(() => f.prompts.length === 2 && !s.runtime.isRunning(fork.id), "the fork's turn ran");
    const handed = f.prompts[1].text;
    assert.ok(handed.includes("Visit is 23 wide to touch"), "the fork hears the earlier ask");
    assert.ok(!handed.includes("READ-ONLY-WORDS"), "in the agent's words, not the person's");
  } finally {
    f.restore();
  }
});

test("shown: the export and the search read it", async () => {
  const f = fake();
  try {
    const s = setup();
    const t = await s.session();
    await s.call("thread.send", { id: t.id, text: TOLD, shown: SHOWN });
    await until(() => f.prompts.length === 1 && !s.runtime.isRunning(t.id), "the turn ran");
    const md = await sessionMarkdown(s.store, t.id, async () => "");
    assert.match(md, /READ-ONLY-WORDS/, "the export has what the person read");
    assert.match(md, /`Fix 1 check` `Phone \/ Menu`/, "with its chips");
    assert.match(md, /What the agent was told:\n\n> Fix this check in Phone \/ Menu:/, "and what the agent was told, quoted");
    // The person's own search in the app (sessions.search) finds it by what they read, and shows that.
    const mine = await s.call<{ snippet: string }[]>("sessions.search", { projectId: "p", query: "read-only-words" });
    assert.equal(mine.length, 1, "the person finds it by what they read");
    assert.match(mine[0].snippet, /READ-ONLY-WORDS/);
    const byTold = searchSessions(s.store, "p", "oum1", { person: true });
    assert.equal(byTold.length, 1, "and by what the agent was told");
  } finally {
    f.restore();
  }
});

test("shown: an agent's session search reads what the agent was told, never the line the person read", async () => {
  const f = fake();
  try {
    const s = setup();
    const t = await s.session();
    await s.call("thread.send", { id: t.id, text: TOLD, shown: SHOWN });
    await until(() => f.prompts.length === 1 && !s.runtime.isRunning(t.id), "the turn ran");
    // What agent-tools.ts's sessions_search calls: no `person`.
    assert.equal(searchSessions(s.store, "p", "read-only-words").length, 0, "the person's line doesn't match for an agent");
    const hits = searchSessions(s.store, "p", "oum1");
    assert.equal(hits.length, 1, "the agent finds it by its own words");
    assert.equal(hits[0].who, "you");
    assert.match(hits[0].snippet, /Fix this check in Phone \/ Menu/, "and reads them");
    assert.ok(!hits[0].snippet.includes("READ-ONLY-WORDS"), "never the shown line");
    assert.ok(!searchSessions(s.store, "p", "visit wide touch").some((h) => h.snippet.includes("READ-ONLY-WORDS")));
  } finally {
    f.restore();
  }
});

test("shown: a queued message whose text changes in the app loses its line; one moved keeps it; the app can't add one", async () => {
  let hold: () => void = () => {};
  const f = fake((text) => (text === "first" ? new Promise<void>((r) => (hold = r)) : undefined));
  try {
    const s = setup();
    const t = await s.session();
    await s.call("thread.send", { id: t.id, text: "first" });
    await until(() => f.prompts.length === 1, "the first turn runs");
    await s.call("thread.send", { id: t.id, text: TOLD, shown: SHOWN, mode: "queue" });
    await s.call("thread.send", { id: t.id, text: "plain one", mode: "queue" });
    await until(() => (s.store.thread(t.id).queue ?? []).length === 2, "both wait");
    const [a, b] = s.store.thread(t.id).queue!;
    // Moved, same words: its line stays. The plain one can't be given a line by the app.
    await s.call("thread.queue", { id: t.id, queue: [{ ...b, shown: { text: "made up" } }, a] });
    let q = s.store.thread(t.id).queue!;
    assert.deepEqual(q.find((x) => x.id === a.id)!.shown, SHOWN, "moved, it keeps its line");
    assert.equal(q.find((x) => x.id === b.id)!.shown, undefined, "the app's copy can't bring a line in");
    // Edited: the person's own words now.
    await s.call("thread.queue", { id: t.id, queue: q.map((x) => (x.id === a.id ? { ...x, text: "my own words now" } : x)) });
    q = s.store.thread(t.id).queue!;
    assert.equal(q.find((x) => x.id === a.id)!.shown, undefined, "edited, its line goes");
    hold();
    await until(() => !s.runtime.isRunning(t.id) && (s.store.thread(t.id).queue ?? []).length === 0, "the queue went");
    assert.ok(users(s.store, t.id).every((u) => !u.shown), "nothing went out with the old line");
  } finally {
    f.restore();
  }
});

test("shown: a queued message taken out for Send now and put back when the send fails keeps its line", async () => {
  let hold: () => void = () => {};
  const f = fake((text) => (text === "first" ? new Promise<void>((r) => (hold = r)) : undefined));
  try {
    const s = setup();
    const t = await s.session();
    await s.call("thread.send", { id: t.id, text: "first" });
    await until(() => f.prompts.length === 1, "the first turn runs");
    await s.call("thread.send", { id: t.id, text: TOLD, shown: SHOWN, mode: "queue" });
    await until(() => (s.store.thread(t.id).queue ?? []).length === 1, "it waits");
    const before = s.store.thread(t.id).queue!;
    // Composer.tsx sendNow: out of the queue first; the send fails; the app puts its copy back.
    await s.call("thread.queue", { id: t.id, queue: [] });
    assert.equal((s.store.thread(t.id).queue ?? []).length, 0);
    await s.call("thread.queue", { id: t.id, queue: before.map(({ shown: _, ...q }) => q) });
    assert.deepEqual(s.store.thread(t.id).queue![0].shown, SHOWN, "put back, it has its line again");
    // Put back with other words, it is the person's own message.
    await s.call("thread.queue", { id: t.id, queue: [] });
    await s.call("thread.queue", { id: t.id, queue: [{ ...before[0], text: "changed words", shown: undefined }] });
    assert.equal(s.store.thread(t.id).queue![0].shown, undefined, "with other words, no line");
    hold();
    await until(() => !s.runtime.isRunning(t.id) && !(s.store.thread(t.id).queue ?? []).length, "the queue went");
  } finally {
    f.restore();
  }
});

test("shown: a line kept for a put-back belongs to its own thread, and one that went by Send now doesn't come back", async () => {
  const holds: (() => void)[] = [];
  const hold = () => holds.forEach((r) => r());
  const f = fake((text) => (text === "first" ? new Promise<void>((r) => holds.push(r)) : undefined));
  try {
    const s = setup();
    const a = await s.session();
    const b = await s.session();
    // Both busy, so a queue put in place waits rather than going.
    await s.call("thread.send", { id: a.id, text: "first" });
    await s.call("thread.send", { id: b.id, text: "first" });
    await until(() => f.prompts.length === 2, "both turns run");
    await s.call("thread.send", { id: a.id, text: TOLD, shown: SHOWN, mode: "queue" });
    await until(() => (s.store.thread(a.id).queue ?? []).length === 1, "it waits in a");
    const q = s.store.thread(a.id).queue![0];
    await s.call("thread.queue", { id: a.id, queue: [] });
    // The same id and words put into another thread's queue: no line from a.
    await s.call("thread.queue", { id: b.id, queue: [{ ...q, shown: undefined }] });
    assert.equal(s.store.thread(b.id).queue![0].shown, undefined, "b doesn't get a's line");
    await s.call("thread.queue", { id: b.id, queue: [] });
    // Sent now as a steer, then put back with the same id and words: it went, so no line.
    await s.call("thread.send", { id: a.id, text: TOLD, shown: SHOWN, mode: "steer" });
    await until(() => users(s.store, a.id).some((u) => u.steer), "it steered");
    await s.call("thread.queue", { id: a.id, queue: [{ ...q, shown: undefined }] });
    assert.equal(s.store.thread(a.id).queue![0].shown, undefined, "one that went can't bring its line back");
    await s.call("thread.queue", { id: a.id, queue: [] });
    hold();
    await until(() => !s.runtime.isRunning(a.id) && !s.runtime.isRunning(b.id), "both end");
  } finally {
    f.restore();
  }
});

test("shown: a session named by what the person read is named by what the agent was told wherever an agent reads it", async () => {
  const f = fake();
  try {
    const s = setup();
    const t = await s.session();
    await s.call("thread.send", { id: t.id, text: TOLD, shown: SHOWN });
    await until(() => f.prompts.length === 1 && !s.runtime.isRunning(t.id), "the turn ran");
    const named = s.store.thread(t.id);
    assert.match(named.title, /^Visit is 23 wide/, "the person reads their line as its name");
    assert.match(titleForAgents(s.store, named), /^Fix this check in Phone/, "an agent reads the agent's words");
    const hits = searchSessions(s.store, "p", "oum1");
    assert.match(hits[0].title, /^Fix this check in Phone/, "agent-side search names it so");
    const mine = await s.call<{ title: string }[]>("sessions.search", { projectId: "p", query: "oum1" });
    assert.match(mine[0].title, /^Visit is 23 wide/, "the person's own search names it as they read it");
    // Renamed by the person: their name, everywhere.
    s.store.patchThread(t.id, { title: "Menu fixes" });
    assert.equal(titleForAgents(s.store, s.store.thread(t.id)), "Menu fixes");
    s.store.patchThread(t.id, { title: named.title });
    const side = await s.call<Thread>("thread.side", { id: t.id });
    assert.match(side.title, /^Side chat · Visit is 23/);
    assert.match(titleForAgents(s.store, s.store.thread(side.id)), /^Side chat · Fix this check in Phone/, "a side chat named after it too");
    // The session renamed after the side chat was made: the side chat still reads the session's agent name, by its link.
    s.store.patchThread(t.id, { title: "Menu fixes" });
    assert.equal(titleForAgents(s.store, s.store.thread(side.id)), "Side chat · Menu fixes", "a side chat follows its session's name, not the old line");
    assert.ok(!titleForAgents(s.store, s.store.thread(side.id)).includes("Visit is 23"));
  } finally {
    f.restore();
  }
});

test("shown: only a line and known chips are kept; anything else is dropped, never the message", async () => {
  assert.equal(shownOf(undefined), undefined);
  assert.equal(shownOf({ text: 3 }), undefined);
  assert.equal(shownOf({ text: "  " }), undefined);
  assert.deepEqual(shownOf({ text: "Fix it", chips: [{ kind: "bogus", label: "x" }, { kind: "frame", label: "  Phone  " }, { kind: "layer" }, "no"] }), { text: "Fix it", chips: [{ kind: "frame", label: "Phone" }] });
  assert.equal(shownOf({ text: "x".repeat(5000) })!.text.length, 2000);
  const f = fake();
  try {
    const s = setup();
    const t = await s.session();
    await s.call("thread.send", { id: t.id, text: "plain words", shown: { text: 42, chips: "no" } });
    await until(() => f.prompts.length === 1 && !s.runtime.isRunning(t.id), "a bad `shown` doesn't stop the message");
    assert.equal(f.prompts[0].text, "plain words");
    assert.equal(users(s.store, t.id)[0].shown, undefined);
  } finally {
    f.restore();
  }
});
