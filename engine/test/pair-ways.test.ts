/*
  How a pair works, as the engine says it and keeps it: the lead's rules by the class of its
  sidekick and by each of a session's own ways, with the judgment and done_when in every variant;
  the sidekick's one line on looking around; a session's own ways stored by thread.create and
  thread.update, and a new pair's effort; a pair's use by model (thread.shares), from reported
  costs and from the estimate; and how taken back is told from the stretches between snapshots
  (the fake pair in sidekick.test.ts measures it end to end). Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item, PairShare, PairWays, ProviderId, ProviderInfo, Thread, UsageRecord } from "../../contracts/src/index.ts";
import { emptyUsage, waysOf } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { Provider } from "../src/providers/types.ts";
import { leadRules, pairShare, sidekickRules, tookBackOf } from "../src/sidekick.ts";
import { Store } from "../src/store.ts";

const OPUS = "claude:claude-opus-5-5";
const SONNET = "claude:claude-sonnet-5-5";
const LUNA = "codex:gpt-6-luna";
const ASTRA = "codex:gpt-6-astra";

const JUDGMENT = /When the judgment is the deliverable \(a design call, a hard bug, a review\), do it yourself/;
const DONE_WHEN = /Every brief says in done_when how it can tell it's done/;

test("leadRules: each class of sidekick gets its own brief, exploring, reading and taking back", () => {
  const small = leadRules("Luna", waysOf(OPUS, LUNA, {}));
  assert.match(small, /be prescriptive, name paths/);
  assert.match(small, /Name every file it needs in the brief, and tell it not to go looking/);
  assert.match(small, /Always read the files it changed/);
  assert.match(small, /When it fails at something once, take that piece back/);
  const mid = leadRules("Sonnet", waysOf(OPUS, SONNET, {}));
  assert.match(mid, /the goal, the files involved and the limits.*Sonnet finds the lines itself.*one concern per brief/);
  assert.match(mid, /a few searches inside the folders the brief names/);
  assert.match(mid, /Read its diff/);
  assert.match(mid, /send it one correction\. When it fails at the same thing twice, take the work back/);
  const frontier = leadRules("Astra", waysOf(OPUS, ASTRA, {}));
  assert.match(frontier, /say what you want and why, leave the how to it, and listen when it pushes back/);
  assert.match(frontier, /It may read whatever it needs/);
  assert.match(frontier, /the parts of its diff that carry risk .* and skim the rest/);
  assert.match(frontier, /When it fails at the same thing twice/);
  for (const rules of [small, mid, frontier]) {
    assert.match(rules, /^By default, hand it any test, build or install run/m, "an Opus lead is told plainly");
    assert.match(rules, /A check it ran and reported needn't be run again unless/);
  }
});

test("leadRules: each of a session's own ways says what it says, and the judgment and done_when are in every variant", () => {
  const base = waysOf(OPUS, LUNA, {});
  const say = (w: Partial<PairWays>) => leadRules("Luna", { ...base, ...w });
  assert.match(say({ brief: "scoped" }), /the files involved and the limits/);
  assert.match(say({ brief: "open" }), /listen when it pushes back/);
  assert.match(say({ explore: "bounded" }), /a few searches inside the folders/);
  assert.match(say({ explore: "open" }), /read whatever it needs/);
  assert.match(say({ review: "diff" }), /Read its diff/);
  assert.match(say({ review: "risk" }), /carry risk/);
  assert.match(say({ takeBack: 2 }), /one correction/);
  assert.match(say({ handOver: "asked" }), /Keep the work yourself unless the person asks you to use your sidekick/);
  assert.doesNotMatch(say({ handOver: "asked" }), /By default, hand it/);
  const firm = say({ firm: true });
  assert.match(firm, /Handing over is the rule in this pair, not a choice: hand it any test, build or install run/);
  assert.match(firm, /A lead that keeps that kind of work is doing the pair wrong/);
  // Every combination keeps the lead's judgment and done_when.
  for (const brief of ["exact", "scoped", "open"] as const)
    for (const explore of ["none", "bounded", "open"] as const)
      for (const review of ["all", "diff", "risk"] as const)
        for (const takeBack of [1, 2] as const)
          for (const [handOver, firm] of [["default", false], ["default", true], ["asked", false]] as const) {
            const rules = say({ brief, explore, review, takeBack, handOver, firm });
            assert.match(rules, JUDGMENT, `${brief} ${explore} ${review} ${takeBack} ${handOver} ${firm}`);
            assert.match(rules, DONE_WHEN);
            assert.match(rules, /^You lead this session\./);
            assert.match(rules, /Its report is a claim\./);
          }
});

test("leadRules: a lead that isn't frontier-class is told firmly; one the person told how isn't", () => {
  assert.match(leadRules("Luna", waysOf(SONNET, LUNA, {})), /Handing over is the rule in this pair/);
  assert.match(leadRules("Luna", waysOf(SONNET, LUNA, { handOver: "default" })), /^By default, hand it/m);
});

test("sidekickRules: one line by how far it may look around, so both sides agree", () => {
  assert.match(sidekickRules("Opus", "none"), /Don't go looking beyond the files the brief names/);
  assert.match(sidekickRules("Opus", "bounded"), /A few searches inside the folders the brief names are fine/);
  assert.equal(sidekickRules("Opus", "open"), sidekickRules("Opus"), "open says nothing more, as before");
  assert.doesNotMatch(sidekickRules("Opus", "open"), /looking beyond|A few searches/);
  assert.doesNotMatch(sidekickRules("Opus", "none"), /\n\n/, "no empty line where a line is left out");
});

const rec = (agent: string, ref: string, tokens: [number, number, number], costUsd: number): UsageRecord => {
  const [provider, model] = [ref.slice(0, ref.indexOf(":")) as ProviderId, ref.slice(ref.indexOf(":") + 1)];
  return { at: Date.now(), threadId: "t", projectId: "p", agent, provider, model, inputTokens: tokens[0], outputTokens: tokens[1], cacheReadTokens: tokens[2], costUsd, seconds: 1 };
};
const briefRow = (id: string, state: "done" | "failed" | "stopped", more: Record<string, unknown> = {}): Item => ({ kind: "tool", id, turn: 1, at: 1, tool: "liner.sidekick", toolKind: "task", title: "Sidekick", status: "done", agent: { name: "Sidekick", taskId: `sidekick:${id}`, steps: [], steerable: false, state, ...more } });

test("pairShare: from the costs each tool reported, tokens counted as the Usage page counts them", () => {
  const share = pairShare(
    [rec(`@${OPUS}`, OPUS, [1000, 200, 800], 0.3), rec(`@${OPUS}`, OPUS, [0, 0, 0], 0), rec("sidekick", LUNA, [5000, 1000, 2000], 0.1), rec("reviewer", ASTRA, [9000, 9000, 0], 5)],
    [
      briefRow("a", "done"),
      briefRow("b", "done", { tookBack: true }),
      briefRow("c", "failed"),
      briefRow("d", "stopped", { report: "Stopped before it started." }),
      // Failed before its sidekick's turn was sent (its tool gone): its session never opened, so no steerable.
      briefRow("f", "failed", { steerable: undefined, report: "this session's folder isn't there any more" }),
      // A row the lead's tool made that no brief took: never sent.
      { kind: "tool", id: "e", turn: 1, at: 1, tool: "mcp__liner__sidekick", toolKind: "task", title: "Sidekick", status: "failed", agent: { name: "Sidekick" } },
    ],
  );
  assert.equal(share.estimated, false);
  assert.deepEqual(
    share.models.map((m) => [m.ref, m.role, m.tokens, m.costUsd]),
    [
      [OPUS, "lead", 2000, 0.3],
      [LUNA, "sidekick", 8000, 0.1],
    ],
    "cache reads in, the Reviewer's read left out",
  );
  assert.ok(Math.abs(share.models[0].costShare! - 0.75) < 1e-9);
  assert.ok(Math.abs(share.models[0].tokenShare - 0.2) < 1e-9);
  assert.ok(Math.abs(share.models[1].tokenShare - 0.8) < 1e-9);
  assert.deepEqual(share.briefs, { sent: 3, kept: 1, tookBack: 1 });
});

test("pairShare: an estimate from list prices when a tool reported no cost, and no cost share when a model has no price", () => {
  const est = pairShare([rec(`@${OPUS}`, OPUS, [1000, 0, 0], 0), rec("sidekick", LUNA, [9000, 0, 0], 0)], []);
  assert.equal(est.estimated, true);
  // Opus's 10.04 a task on 1000 tokens against Luna's 0.15 on 9000.
  assert.ok(Math.abs(est.models[0].costShare! - 10040 / (10040 + 1350)) < 1e-9);
  assert.ok(Math.abs(est.models[1].tokenShare - 0.9) < 1e-9);
  // One reported, one didn't: the estimate, not a mix of dollars and prices.
  assert.equal(pairShare([rec(`@${OPUS}`, OPUS, [1000, 0, 0], 0.2), rec("sidekick", LUNA, [9000, 0, 0], 0)], []).estimated, true);
  const none = pairShare([rec(`@${OPUS}`, OPUS, [1000, 0, 0], 0), rec("sidekick", "opencode:acme-coder-7", [9000, 0, 0], 0)], []);
  assert.equal(none.estimated, false);
  assert.ok(none.models.every((m) => m.costShare === undefined));
  assert.deepEqual(pairShare([], []), { models: [], estimated: false, briefs: { sent: 0, kept: 0, tookBack: 0 } });
});

const ready = (id: ProviderInfo["id"], models: { id: string; efforts?: string[] }[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m.id, label: m.id, description: "", ...(m.efforts ? { efforts: m.efforts.map((e) => ({ id: e, label: e })) } : {}) })), supports: { approvals: true, resume: true, effort: true, plan: true } });

function setup() {
  const home = mkdtempSync(join(tmpdir(), "lc-ways-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-ways-dir-")), git: false, createdAt: Date.now() });
  // No tool on its PATH and the store's home for its own: the API's look at the tools never asks this Mac's.
  const env = { PATH: "/usr/bin:/bin", HOME: home };
  const runtime = new Runtime(store, env);
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  return { store, runtime, api };
}

/** Fake tools in every tool's place, so the API's look finds these models and nothing of this Mac's. */
async function withTools(run: () => Promise<void>) {
  const saved = { ...providers };
  const tool = (id: ProviderId, models: { id: string; efforts?: string[] }[]): Provider => ({ id, detect: async () => ({ ...ready(id, models), available: models.length > 0 }), open: () => assert.fail("no turn runs here") });
  for (const id of Object.keys(providers) as ProviderId[]) providers[id] = tool(id, []);
  // Opus here has no medium, so a pair's medium lands on the nearest it has.
  providers.claude = tool("claude", [{ id: "claude-opus-5-5", efforts: ["high", "xhigh", "max"] }, { id: "claude-sonnet-5-5", efforts: ["low", "medium", "high"] }]);
  providers.codex = tool("codex", [{ id: "gpt-6-luna" }]);
  try {
    await run();
  } finally {
    Object.assign(providers, saved);
  }
}

test("thread.create and thread.update store a session's own ways: null or none clears them, a fork keeps them, a way there isn't fails", async () => {
  const { api } = setup();
  const t = (await api.call("thread.create", { projectId: "p", agent: `@${OPUS}`, sidekick: LUNA, tuning: { brief: "scoped", takeBack: 2 } })) as Thread;
  assert.deepEqual(t.tuning, { brief: "scoped", takeBack: 2 });
  const fork = (await api.call("thread.create", { projectId: "p", forkOf: t.id })) as Thread;
  assert.deepEqual(fork.tuning, { brief: "scoped", takeBack: 2 });
  assert.equal("tuning" in ((await api.call("thread.create", { projectId: "p", agent: `@${OPUS}`, sidekick: LUNA, tuning: {} })) as Thread), false);
  const changed = (await api.call("thread.update", { id: t.id, tuning: { review: "risk", handOver: "asked" } })) as Thread;
  assert.deepEqual(changed.tuning, { review: "risk", handOver: "asked" }, "stored as sent");
  assert.deepEqual(((await api.call("thread.update", { id: t.id, title: "x" })) as Thread).tuning, { review: "risk", handOver: "asked" }, "undefined leaves it");
  assert.equal(((await api.call("thread.update", { id: t.id, tuning: null })) as Thread).tuning, undefined);
  await api.call("thread.update", { id: t.id, tuning: { brief: "open" } });
  assert.equal(((await api.call("thread.update", { id: t.id, tuning: {} })) as Thread).tuning, undefined);
  await assert.rejects(api.call("thread.update", { id: t.id, tuning: { brief: "loose" } }), /no way "brief: loose"/);
  await assert.rejects(api.call("thread.update", { id: t.id, tuning: { takeBack: 3 } }), /no way/);
  await assert.rejects(api.call("thread.create", { projectId: "p", tuning: { colour: "red" } }), /no way/);
});

test("thread.create: a new pair with no effort works at the pair's effort, as near as its lead's model has one", async () => {
  await withTools(async () => {
    const { api, store } = setup();
    await api.ready;
    const opus = (await api.call("thread.create", { projectId: "p", agent: `@${OPUS}`, sidekick: LUNA })) as Thread;
    assert.equal(opus.effort, "high", "medium, which Opus here hasn't, lands on the nearest it has");
    const sonnet = (await api.call("thread.create", { projectId: "p", agent: `@${SONNET}`, sidekick: LUNA })) as Thread;
    assert.equal(sonnet.effort, "medium");
    assert.equal(((await api.call("thread.create", { projectId: "p", agent: `@${SONNET}`, sidekick: LUNA, effort: "high" })) as Thread).effort, "high", "an effort given stays");
    assert.equal(((await api.call("thread.create", { projectId: "p", agent: `@${SONNET}` })) as Thread).effort, undefined, "one model alone keeps its own");
    store.setSettings({ pairEffort: "low" });
    assert.equal(((await api.call("thread.create", { projectId: "p", agent: `@${SONNET}`, sidekick: LUNA })) as Thread).effort, "low");
    // Started as Settings say, a pair: the same.
    store.setSettings({ start: "pair", pairEffort: undefined });
    const started = (await api.call("thread.create", { projectId: "p" })) as Thread;
    assert.ok(started.sidekick, "started as a pair");
    assert.ok(started.effort, "with the pair's effort");
    // A fork keeps its parent's, even none.
    const parent = (await api.call("thread.create", { projectId: "p", agent: `@${SONNET}` })) as Thread;
    store.patchThread(parent.id, { sidekick: LUNA });
    assert.equal(((await api.call("thread.create", { projectId: "p", forkOf: parent.id })) as Thread).effort, undefined);
  });
});

test("thread.shares: the session's own usage records and its briefs", async () => {
  const { api, store } = setup();
  const t = (await api.call("thread.create", { projectId: "p", agent: `@${OPUS}`, sidekick: LUNA })) as Thread;
  const mine = (r: UsageRecord) => ({ ...r, threadId: t.id });
  store.logUsage(mine(rec(`@${OPUS}`, OPUS, [300, 100, 0], 0.4)));
  store.logUsage(mine(rec("sidekick", LUNA, [500, 100, 0], 0.1)));
  store.logUsage(rec("sidekick", LUNA, [99_999, 0, 0], 9));
  store.putItem(t.id, briefRow("r1", "done", { tookBack: false }));
  const share = (await api.call("thread.shares", { id: t.id })) as PairShare;
  assert.equal(share.estimated, false);
  assert.deepEqual(share.models.map((m) => [m.role, m.tokens, m.costShare]), [["lead", 400, 0.8], ["sidekick", 600, 0.2]], "another session's record is left out");
  assert.deepEqual(share.briefs, { sent: 1, kept: 1, tookBack: 0 });
  // Before its first turn: nothing.
  const fresh = (await api.call("thread.create", { projectId: "p", agent: `@${OPUS}`, sidekick: LUNA })) as Thread;
  assert.deepEqual(await api.call("thread.shares", { id: fresh.id }), { models: [], estimated: false, briefs: { sent: 0, kept: 0, tookBack: 0 } });
});

test("waysOf with a person's agent as lead: the pair is judged by the model the agent runs on", () => {
  const { store, runtime } = setup();
  store.setAgents([{ id: "writer", name: "Writer", model: SONNET, effort: "medium", soul: "" } as never]);
  const t: Thread = { id: "x", projectId: "p", title: "x", agent: "writer", sidekick: LUNA, status: "idle", access: "full", turns: 0, usage: emptyUsage(), createdAt: 0, updatedAt: 0 };
  assert.equal(runtime.pairWays(t).firm, true, "Sonnet isn't frontier-class");
  assert.equal(runtime.pairWays({ ...t, model: OPUS }).firm, false, "the session's own model first");
  assert.deepEqual(runtime.pairWays({ ...t, tuning: { explore: "open" } }).own, ["explore"]);
});

test("tookBackOf: the lead's stretches after a brief, a later brief's own changes apart; one it can't measure leaves the row unset", async () => {
  // Snapshots by name; what differs between two is listed by the stretch from one to the next.
  const diffs: Record<string, string[] | null> = { "a1>b0": [], "a2>end": ["x.txt"], "b1>end": ["y.txt"] };
  const changed = async (a: string, b: string) => (diffs[`${a}>${b}`] === null ? null : new Set(diffs[`${a}>${b}`] ?? []));
  const marks = [
    { row: "one", from: "a0", to: "a1", paths: ["x.txt"] },
    { row: "two", from: "b0", to: "a2", paths: ["z.txt"] },
  ];
  assert.deepEqual([...(await tookBackOf(marks, "end", changed))], [["one", true], ["two", false]], "x.txt changed by the lead after both");
  assert.deepEqual([...(await tookBackOf(marks, null, changed))], [], "no snapshot at the turn's end: nothing seen, and no brief called kept");
  // A brief with no after snapshot: its own stretch is unmeasured, the lead's change after the next brief still shows.
  assert.deepEqual([...(await tookBackOf([{ ...marks[0], to: null }, marks[1]], "end", changed))], [["one", true], ["two", false]]);
  assert.deepEqual([...(await tookBackOf([{ ...marks[0], paths: null }, marks[1]], "end", changed))], [["two", false]], "its files unmeasured: unset");
  // The last brief still at work past the wind-down: the stretch before it still tells on the first.
  diffs["a1>b0"] = ["x.txt"];
  const running = [marks[0], { ...marks[1], to: null }];
  assert.deepEqual([...(await tookBackOf(running, "end", changed))], [["one", true]], "taken back before the running one began");
  diffs["a1>b0"] = [];
  assert.deepEqual([...(await tookBackOf(running, "end", changed))], [], "not seen before it, and its stretch may hold it: unset, not kept");
  diffs["a1>b0"] = null;
  assert.deepEqual([...(await tookBackOf(marks, "end", changed))], [["one", true], ["two", false]], "git couldn't say for the stretch after the first; the one after it shows the change");
  diffs["a2>end"] = [];
  assert.deepEqual([...(await tookBackOf(marks, "end", changed))], [["two", false]], "and with nothing there, the first is unset");
});

test("thread.update: another sidekick without a word on the ways drops the last one's class keys and keeps hand-over", async () => {
  const { api } = setup();
  const t = (await api.call("thread.create", { projectId: "p", agent: `@${OPUS}`, sidekick: LUNA, tuning: { brief: "open", explore: "open", review: "risk", takeBack: 2, handOver: "asked" } })) as Thread;
  assert.deepEqual(((await api.call("thread.update", { id: t.id, sidekick: SONNET })) as Thread).tuning, { handOver: "asked" });
  await api.call("thread.update", { id: t.id, tuning: { brief: "exact" } });
  assert.equal(((await api.call("thread.update", { id: t.id, sidekick: `@${LUNA}` })) as Thread).tuning, undefined, "nothing left: cleared");
  await api.call("thread.update", { id: t.id, tuning: { brief: "exact" } });
  assert.deepEqual(((await api.call("thread.update", { id: t.id, sidekick: LUNA })) as Thread).tuning, { brief: "exact" }, "the same sidekick again changes nothing");
  assert.deepEqual(((await api.call("thread.update", { id: t.id, sidekick: SONNET, tuning: { review: "all" } })) as Thread).tuning, { review: "all" }, "a word on the ways in the same call is the one kept");
  assert.deepEqual(((await api.call("thread.update", { id: t.id, sidekick: null })) as Thread).tuning, { review: "all" }, "leaving the pair keeps them");
});

test("settings.save: classes, hand-over and the pair's effort are checked, and null clears them to unset", async () => {
  const { api, store } = setup();
  await api.call("settings.save", { classes: { [LUNA]: "mid", [SONNET]: "huge" }, handOver: "asked", pairEffort: "high" } as never);
  assert.deepEqual(store.settings.classes, { [LUNA]: "mid" }, "a class there isn't is dropped");
  assert.equal(store.settings.handOver, "asked");
  assert.equal(store.settings.pairEffort, "high");
  await assert.rejects(api.call("settings.save", { handOver: "never" } as never), /no way to hand over/);
  await assert.rejects(api.call("settings.save", { pairEffort: 3 } as never), /effort's name/);
  await api.call("settings.save", { classes: null, handOver: null, pairEffort: null } as never);
  assert.equal(store.settings.classes, undefined);
  assert.equal(store.settings.handOver, undefined);
  assert.equal(store.settings.pairEffort, undefined);
  store.flush();
  assert.equal("handOver" in (new Store(store.home).settings as object), false, "unset, not null");
  await api.call("settings.save", { classes: {} } as never);
  assert.equal(store.settings.classes, undefined, "no models moved: unset");
});

test("a hand-edited class or way the engine doesn't know falls back to the automatic one, never undefined in the lead's rules", () => {
  const { store, runtime } = setup();
  store.setSettings({ classes: { [LUNA]: "enormous" as never }, handOver: "sometimes" as never });
  const t: Thread = { id: "x", projectId: "p", title: "x", agent: `@${OPUS}`, sidekick: LUNA, status: "idle", access: "full", turns: 0, usage: emptyUsage(), createdAt: 0, updatedAt: 0, tuning: { brief: "vague" as never, review: "diff" } };
  const ways = runtime.pairWays(t);
  assert.deepEqual([ways.cls, ways.brief, ways.handOver, ways.review], ["small", "exact", "default", "diff"]);
  assert.doesNotMatch(leadRules("Luna", ways), /undefined/);
  // And leadRules on its own, handed ways nobody checked.
  const raw = { ...waysOf(OPUS, LUNA, {}), brief: "vague", explore: "far", review: "never", handOver: "sometimes", takeBack: 7 } as unknown as PairWays;
  const said = leadRules("Luna", raw);
  assert.doesNotMatch(said, /undefined/);
  assert.match(said, /be prescriptive/);
  assert.match(said, JUDGMENT);
});

test("thread.shares counts finished turns only: mid-turn, after a brief ended and before the lead's turn did, it's as it was before the turn", async () => {
  const { api, store } = setup();
  const t = (await api.call("thread.create", { projectId: "p", agent: `@${OPUS}`, sidekick: LUNA })) as Thread;
  const mine = (r: UsageRecord, at: number) => ({ ...r, threadId: t.id, at });
  // Turn 1, finished: a brief, then the lead's own record as its turn ended.
  store.putItem(t.id, { kind: "turn", id: "m1", turn: 1, at: 1000, status: "done" } as Item);
  store.putItem(t.id, briefRow("r1", "done"));
  store.logUsage(mine(rec("sidekick", LUNA, [500, 100, 0], 0.1), 1500));
  store.logUsage(mine(rec(`@${OPUS}`, OPUS, [300, 100, 0], 0.4), 2000));
  store.patchThread(t.id, { status: "done", turns: 1 });
  const before = await api.call("thread.shares", { id: t.id });
  // Turn 2 at work: its brief has ended and been logged; the lead's record isn't yet.
  store.patchThread(t.id, { status: "running", turns: 2 });
  store.putItem(t.id, { kind: "turn", id: "m2", turn: 2, at: Date.now() - 50, status: "running" } as Item);
  store.putItem(t.id, { ...briefRow("r2", "done"), turn: 2 } as Item);
  store.logUsage(mine(rec("sidekick", LUNA, [9000, 900, 0], 2), Date.now()));
  assert.deepEqual(await api.call("thread.shares", { id: t.id }), before);
  // Once it ends, it counts.
  store.putItem(t.id, { kind: "turn", id: "m2", turn: 2, at: Date.now() - 50, status: "done" } as Item);
  store.patchThread(t.id, { status: "done" });
  assert.equal(((await api.call("thread.shares", { id: t.id })) as PairShare).briefs.sent, 2);
});
