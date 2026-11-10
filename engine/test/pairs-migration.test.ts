/*
  Plan and Auto sessions from before pairs, moved once when the engine starts (store.ts, toPairs):
  each row of the spec's "What replaces what", a second run that changes nothing, and the backup
  of the state as it was. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentProfile, Thread } from "../../contracts/src/index.ts";
import { BEFORE_PAIRS, Store, toPairs } from "../src/store.ts";

const now = Date.now();
const thread = (id: string, p: Record<string, unknown> = {}) => ({ id, projectId: "p", title: id, status: "done", access: "auto", turns: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }, createdAt: now, updatedAt: now, agent: "@claude:claude-sonnet-5-5", ...p });
const forge: AgentProfile = { id: "forge", name: "Forge", role: "Builds", glyph: "spark", specialty: "custom", model: "codex:gpt-6-luna", effort: "medium", soul: "" };
const cast = { strong: "claude:claude-opus-5-5", everyday: "codex:gpt-6-sol", judge: "claude:claude-opus-5-5", critics: [] };
const saved = { providerSession: "codex:p1", leadSession: "claude:l1", sessions: { "@claude:claude-opus-5-5": "claude:r1" } };

/** A home with a state.json from before pairs (no pairVersion), and the store it starts. */
function home(state: Record<string, unknown>, logs: Record<string, unknown[]> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lc-pairs-"));
  mkdirSync(join(dir, "threads"), { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ agents: [forge], projects: [{ id: "p", name: "p", path: "/p", git: false, createdAt: now }], ...state }));
  for (const [id, items] of Object.entries(logs)) writeFileSync(join(dir, "threads", `${id}.jsonl`), items.map((x) => JSON.stringify(x)).join("\n") + "\n");
  return { dir, store: () => new Store(dir) };
}
const of = (store: Store, id: string) => store.threads.find((t) => t.id === id)!;
const OLD = ["lead", "leadSession", "route", "dual", "after", "checks", "trial"] as const;

test("pairs: a Plan session's planner leads it, its builder is the sidekick as a bare model, and its saved sessions go", () => {
  const h = home({
    settings: { onboarded: true, mode: "plan" },
    threads: [
      thread("bare", { lead: "@claude:claude-opus-5-5", agent: "@codex:gpt-6-sol", ...saved, turnBy: "@codex:gpt-6-sol" }),
      thread("named", { lead: "@claude:claude-opus-5-5", agent: "forge" }),
      thread("own", { lead: "@claude:claude-opus-5-5", agent: "forge", model: "codex:gpt-6-sol", effort: "low" }),
      thread("same", { lead: "@claude:claude-opus-5-5", agent: "@claude:claude-opus-5-5" }),
      thread("demo", { lead: "demo", agent: "demo", ...saved }),
    ],
  });
  const store = h.store();
  const bare = of(store, "bare");
  assert.deepEqual([bare.agent, bare.sidekick], ["@claude:claude-opus-5-5", "codex:gpt-6-sol"]);
  assert.deepEqual([bare.providerSession, bare.sessions, bare.turnBy], [undefined, undefined, undefined], "its next turn starts from the conversation as text");
  // One of your agents builds: its model is the sidekick.
  assert.deepEqual([of(store, "named").agent, of(store, "named").sidekick], ["@claude:claude-opus-5-5", "codex:gpt-6-luna"]);
  // The session's own model was the builder's: it's the sidekick, and the lead goes by its own model and effort.
  const own = of(store, "own");
  assert.deepEqual([own.sidekick, own.model, own.effort], ["codex:gpt-6-sol", undefined, undefined]);
  // Two of the same model make no pair.
  assert.deepEqual([of(store, "same").agent, of(store, "same").sidekick], ["@claude:claude-opus-5-5", undefined]);
  // The Demo played both parts: it stays one model, with its sessions.
  const demo = of(store, "demo");
  assert.deepEqual([demo.agent, demo.sidekick, demo.providerSession], ["demo", undefined, "codex:p1"]);
  for (const t of store.threads) for (const k of OLD) assert.ok(!(k in t), `${t.id} has no ${k}`);
});

test("pairs: a moved fork that never ran its first turn starts from the conversation as text, not the old builder's conversation", () => {
  const store = home({
    settings: { onboarded: true },
    threads: [
      thread("plan", { lead: "@claude:claude-opus-5-5", agent: "@claude:claude-sonnet-5-5", forkSession: "claude:builder-1" }),
      thread("auto", { route: { cast }, forkSession: "codex:p1" }),
      thread("solo", { forkSession: "claude:s1" }),
      thread("none", { lead: "@claude:claude-opus-5-5", agent: "@codex:gpt-6-sol" }),
    ],
  }).store();
  assert.equal(of(store, "plan").forkSession, "");
  assert.equal(of(store, "auto").forkSession, "");
  assert.equal(of(store, "solo").forkSession, "claude:s1", "a session that wasn't moved keeps its fork");
  assert.ok(!("forkSession" in of(store, "none")), "no fork, none made up");
});

test("pairs: an Auto session is led by its cast's strong model with the everyday one as its sidekick; one model when they're the same", () => {
  const store = home({
    settings: { onboarded: true, mode: "auto" },
    threads: [
      thread("auto", { agent: "@codex:gpt-6-sol", route: { level: "high", cast, root: "codex:gpt-6-sol" }, dual: true, ...saved }),
      thread("one", { agent: "@claude:claude-opus-5-5", route: { level: "standard", cast: { ...cast, everyday: cast.strong }, root: cast.strong } }),
    ],
  }).store();
  const auto = of(store, "auto");
  assert.deepEqual([auto.agent, auto.sidekick, auto.providerSession, auto.sessions], ["@claude:claude-opus-5-5", "codex:gpt-6-sol", undefined, undefined]);
  assert.deepEqual([of(store, "one").agent, of(store, "one").sidekick], ["@claude:claude-opus-5-5", undefined]);
  for (const t of store.threads) for (const k of OLD) assert.ok(!(k in t), `${t.id} has no ${k}`);
});

test("pairs: After off, or a checker of nobody, turns the Reviewer off for the session; Refine, Check and the rest follow Settings", () => {
  const store = home({
    settings: { onboarded: true, mode: "solo" },
    threads: [thread("off", { after: "off" }), thread("nobody", { checks: { by: null, rounds: 2 } }), thread("refine", { after: "refine" }), thread("check", { after: "check", checks: { by: "codex:gpt-6", rounds: 3 } }), thread("mine", { after: "off", review: true })],
  }).store();
  assert.deepEqual(["off", "nobody", "refine", "check", "mine"].map((id) => of(store, id).review), [false, false, undefined, undefined, true]);
});

test("pairs: a cost test's session is archived and loses the field", () => {
  const store = home({ settings: { onboarded: true, mode: "solo" }, threads: [thread("trial", { trial: { id: "x", way: "solo", at: 1 } }), thread("kept")] }).store();
  assert.deepEqual([of(store, "trial").archived, "trial" in of(store, "trial"), of(store, "kept").archived], [true, false, undefined]);
});

test("pairs: a planner's plan left asking expires, and its session no longer waits on it", () => {
  const store = home(
    { settings: { onboarded: true, mode: "plan" }, threads: [thread("a", { lead: "@claude:claude-opus-5-5", status: "waiting" })] },
    { a: [{ kind: "turn", id: "m", turn: 1, at: 1, agent: "@claude:claude-opus-5-5", model: "claude:claude-opus-5-5", planning: true, status: "done" }, { kind: "proposal", id: "x", turn: 1, at: 1, title: "Theme", plan: "1. Do it", state: "asking" }] },
  ).store();
  const plan = store.timeline("a").find((x) => x.kind === "proposal");
  assert.equal(plan?.kind === "proposal" && plan.state, "expired");
  assert.equal(of(store, "a").status, "idle");
});

test("pairs: Settings start from the old mode unless set, the Reviewer goes off where After was off, and the old fields go", () => {
  const start = (settings: Record<string, unknown>) => home({ settings: { onboarded: true, ...settings }, threads: [] }).store().settings;
  assert.equal(start({ mode: "solo" }).start, "fast");
  assert.equal(start({ mode: "plan" }).start, "pair");
  assert.equal(start({ mode: "auto" }).start, "pair");
  assert.equal(start({ mode: "plan", start: "best" }).start, "best", "a start already set stays");
  const off = start({ mode: "solo", after: "off", dual: true, route: { level: "high" }, approvePlans: true });
  assert.deepEqual([off.review, off.pairVersion], [false, 1]);
  for (const k of ["mode", "dual", "after", "route", "approvePlans"]) assert.ok(!(k in off), `Settings have no ${k}`);
  assert.equal(start({ mode: "solo", after: "off", review: true }).review, true);
  assert.equal(start({ mode: "solo", after: "refine" }).review, undefined);
  // A fresh install starts on the new version, with nothing to move.
  assert.equal(new Store(mkdtempSync(join(tmpdir(), "lc-pairs-"))).settings.pairVersion, 1);
});

test("pairs: your frontier model is your lead and your cheaper one your sidekick; Dual frontier's second goes, the Reviewer's pick stays", () => {
  const start = (settings: Record<string, unknown>) => home({ settings: { onboarded: true, mode: "plan", ...settings }, threads: [] }).store().settings;
  assert.deepEqual(start({ picks: { frontier: "claude:claude-opus-5-5", cheaper: "codex:gpt-6-sol", second: "codex:gpt-6-astra", checker: "codex:gpt-6-astra" } }).picks, { lead: "claude:claude-opus-5-5", sidekick: "codex:gpt-6-sol", checker: "codex:gpt-6-astra" });
  assert.deepEqual(start({ picks: { cheaper: "codex:gpt-6-sol" } }).picks, { sidekick: "codex:gpt-6-sol" });
  // Picks already under the new names stay; nothing picked leaves none.
  assert.deepEqual(start({ picks: { lead: "claude:claude-opus-5-5", frontier: "codex:gpt-6-astra" } }).picks, { lead: "claude:claude-opus-5-5" });
  assert.equal("picks" in start({ picks: { second: "codex:gpt-6-astra" } }), false);
  assert.equal("picks" in start({}), false);
});

test("pairs: a second run changes nothing", () => {
  const h = home({ settings: { onboarded: true, mode: "plan", after: "off" }, threads: [thread("bare", { lead: "@claude:claude-opus-5-5", agent: "@codex:gpt-6-sol", ...saved }), thread("auto", { route: { level: "high", cast, root: "codex:gpt-6-sol" } })] });
  const first = h.store();
  first.flush();
  const once = readFileSync(join(h.dir, "state.json"), "utf8");
  const again = h.store();
  again.flush();
  assert.equal(readFileSync(join(h.dir, "state.json"), "utf8"), once);
  // The function itself, run on what it made, gives the same sessions back.
  const s = JSON.parse(once) as { settings: never; threads: Thread[]; agents: AgentProfile[] };
  assert.deepEqual(toPairs(s).threads, s.threads);
});

test("pairs: the state from before is kept once beside state.json, and a later run never writes over it", () => {
  const h = home({ settings: { onboarded: true, mode: "plan" }, threads: [thread("bare", { lead: "@claude:claude-opus-5-5", agent: "@codex:gpt-6-sol" })] });
  const original = readFileSync(join(h.dir, "state.json"), "utf8");
  h.store().flush();
  const backup = join(h.dir, BEFORE_PAIRS);
  assert.equal(readFileSync(backup, "utf8"), original, "a byte-for-byte copy");
  // Something sets the state back to before pairs (an older build, a restore): the copy from the first run stays.
  writeFileSync(join(h.dir, "state.json"), JSON.stringify({ settings: { onboarded: true, mode: "solo" }, threads: [] }));
  h.store();
  assert.equal(readFileSync(backup, "utf8"), original);
  // A state that was already on pairs makes no copy.
  const fresh = mkdtempSync(join(tmpdir(), "lc-pairs-"));
  writeFileSync(join(fresh, "state.json"), JSON.stringify({ settings: { onboarded: true, mode: "solo", pairVersion: 1 }, threads: [] }));
  new Store(fresh);
  assert.equal(existsSync(join(fresh, BEFORE_PAIRS)), false);
});
