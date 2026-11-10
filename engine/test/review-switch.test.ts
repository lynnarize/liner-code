/*
  What the pair and the Reviewer's switch keep: a session's own word on the Reviewer
  (Thread.review) over Settings.review, Settings.start and what a session started without an
  agent gets from it, and the shared helpers isPair and reviewOn. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderId, ProviderInfo, Settings, Thread } from "../../contracts/src/index.ts";
import { emptyUsage, isPair, reviewOn } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { Provider } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const ready = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });

function setup() {
  const home = mkdtempSync(join(tmpdir(), "lc-review-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-review-dir-")), git: false, createdAt: Date.now() });
  const runtime = new Runtime(store, process.env);
  const api = createApi(store, runtime, process.env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const thread = (extra: Partial<Thread> = {}): Thread => ({ id: "t", projectId: "p", title: "t", agent: "@claude:claude-opus-5-5", status: "idle", access: "full", turns: 0, usage: emptyUsage(), createdAt: 0, updatedAt: 0, ...extra });
  return { home, store, runtime, api, thread };
}

test("isPair: a sidekick set, and not a side chat", () => {
  assert.equal(isPair({}), false);
  assert.equal(isPair({ sidekick: "codex:gpt-6-luna" }), true);
  assert.equal(isPair({ sidekick: "codex:gpt-6-luna", sideOf: "t" }), false);
});

test("reviewOn: the session's word, then Settings'", () => {
  assert.equal(reviewOn({}, {}), true, "on unless something says off");
  assert.equal(reviewOn({ review: false }, {}), false);
  assert.equal(reviewOn({}, { review: false }), false);
  assert.equal(reviewOn({ review: true }, { review: false }), true, "the session's own word first");
  assert.equal(reviewOn({ review: false }, { review: true }), false);
});

test("reviewerFor: nobody when the Reviewer is off for the session; another maker than the lead's when it's on; Reviewer decides always has one", () => {
  const { store, runtime, thread } = setup();
  runtime.providerInfo = [ready("claude", ["claude-opus-5-5", "claude-sonnet-5-5"]), ready("codex", ["gpt-6-sol"])];
  assert.equal(runtime.reviewerFor(thread()), "codex:gpt-6-sol", "another maker reads Opus's change");
  assert.equal(runtime.reviewerFor(thread({ review: false })), null);
  assert.equal(runtime.reviewerFor(thread({ review: false }), true), "codex:gpt-6-sol", "a step still gets its call");
  store.setSettings({ review: false });
  assert.equal(runtime.reviewerFor(thread()), null, "Settings turned it off");
  assert.equal(runtime.reviewerFor(thread({ review: true })), "codex:gpt-6-sol", "the session's own word first");
  // The Reviewer you picked reads, unless it's the lead's own model.
  store.setSettings({ review: true, picks: { checker: "claude:claude-sonnet-5-5" } });
  assert.equal(runtime.reviewerFor(thread()), "claude:claude-sonnet-5-5");
  // In a pair the sidekick writes too: the pick loses when it's the sidekick, and the sidekick's own model never reads.
  assert.equal(runtime.reviewerFor(thread({ sidekick: "claude:claude-sonnet-5-5" })), "codex:gpt-6-sol");
  store.setSettings({ picks: {} });
  runtime.providerInfo = [ready("claude", ["claude-opus-5-5", "claude-sonnet-5-5"]), ready("codex", ["gpt-6-sol", "gpt-6-luna"])];
  assert.equal(runtime.reviewerFor(thread({ sidekick: "codex:gpt-6-sol" })), "codex:gpt-6-luna");
  // A side chat isn't a pair: only the lead counts.
  assert.equal(runtime.reviewerFor(thread({ sidekick: "codex:gpt-6-sol", sideOf: "x" })), "codex:gpt-6-sol");
});

test("settings: review and start are saved, and read back after a restart", async () => {
  const { home, api, store } = setup();
  const saved = (await api.call("settings.save", { review: false, start: "fast" })) as Settings;
  assert.equal(saved.review, false);
  assert.equal(saved.start, "fast");
  // As quitting does: the state file is written out.
  store.flush();
  const again = new Store(home);
  assert.equal(again.settings.review, false);
  assert.equal(again.settings.start, "fast");
  await api.call("settings.save", { review: true, start: "pair" });
  store.flush();
  assert.equal(new Store(home).settings.start, "pair");
});

test("thread.create with no agent starts as Settings say: a pair when two models are ready, else the one they name", async () => {
  const saved = { ...providers };
  const tool = (id: ProviderId, models: string[]): Provider => ({ id, detect: async () => ({ ...ready(id, models), available: models.length > 0 }), open: () => assert.fail("no turn runs here") });
  for (const id of Object.keys(providers) as ProviderId[]) providers[id] = tool(id, []);
  providers.claude = tool("claude", ["claude-opus-5-5", "claude-sonnet-5-5"]);
  providers.codex = tool("codex", ["gpt-6.1-sol"]);
  try {
    const { api, store } = setup();
    await api.ready;
    const pair = (await api.call("thread.create", { projectId: "p" })) as Thread;
    assert.deepEqual([pair.agent, pair.sidekick], ["@claude:claude-opus-5-5", "codex:gpt-6.1-sol"]);
    // An agent that's gone (an outside tool's guess) starts the same way.
    const gone = (await api.call("thread.create", { projectId: "p", agent: "nobody" })) as Thread;
    assert.deepEqual([gone.agent, gone.sidekick], ["@claude:claude-opus-5-5", "codex:gpt-6.1-sol"]);
    store.setSettings({ start: "fast" });
    const fast = (await api.call("thread.create", { projectId: "p" })) as Thread;
    assert.deepEqual([fast.agent, "sidekick" in fast], ["@codex:gpt-6.1-sol", false]);
    // One named is the one you get, alone.
    const named = (await api.call("thread.create", { projectId: "p", agent: "@claude:claude-sonnet-5-5" })) as Thread;
    assert.deepEqual([named.agent, "sidekick" in named], ["@claude:claude-sonnet-5-5", false]);
  } finally {
    Object.assign(providers, saved);
  }
});

test("thread.create takes review (a fork keeps its parent's); thread.update sets it, and null clears it", async () => {
  const { api } = setup();
  const t = (await api.call("thread.create", { projectId: "p", review: false })) as Thread;
  assert.equal(t.review, false);
  const fork = (await api.call("thread.create", { projectId: "p", forkOf: t.id })) as Thread;
  assert.equal(fork.review, false);
  const plain = (await api.call("thread.create", { projectId: "p" })) as Thread;
  assert.equal("review" in plain, false, "unset follows Settings");
  assert.equal(((await api.call("thread.update", { id: t.id, review: true })) as Thread).review, true);
  assert.equal(((await api.call("thread.update", { id: t.id, review: null })) as Thread).review, undefined);
});

test("thread.update: picking who works clears the session's own model with null; undefined leaves it", async () => {
  const { api, store } = setup();
  const t = (await api.call("thread.create", { projectId: "p", agent: "@claude:claude-opus-5-5" })) as Thread;
  // A usage limit moved it to the fallback model (carryOn), and its context window was the old model's.
  store.patchThread(t.id, { model: "codex:gpt-6-sol", usage: { ...emptyUsage(), contextWindow: 400_000 } });
  const left = (await api.call("thread.update", { id: t.id, effort: "low", model: undefined })) as Thread;
  assert.equal(left.model, "codex:gpt-6-sol", "undefined leaves it");
  const picked = (await api.call("thread.update", { id: t.id, agent: "@claude:claude-sonnet-5-5", sidekick: null, model: null })) as Thread;
  assert.deepEqual([picked.agent, picked.model, picked.usage.contextWindow], ["@claude:claude-sonnet-5-5", undefined, undefined]);
  // Cleared with the agent the same as before, too: the model it runs on changed.
  store.patchThread(t.id, { model: "codex:gpt-6-sol", usage: { ...emptyUsage(), contextWindow: 400_000 } });
  const same = (await api.call("thread.update", { id: t.id, model: null })) as Thread;
  assert.deepEqual([same.model, same.usage.contextWindow], [undefined, undefined]);
});
