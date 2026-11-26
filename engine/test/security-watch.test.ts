/*
  Scan new PRs (security-watch.ts): which open pull request it scans and when, with no gh, no model and no clock of its own.
  The first look is only the baseline; a pull request that opens after (or stops being a draft) is new; one that gets a
  commit after its last scan is scanned again; a draft never is; one scan at a time; at most the day's cap; and the watcher
  looks only while Scan new PRs is on and a window is open. Run with `node --test engine/test/security-watch.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrItem, ScanTarget } from "../../contracts/src/index.ts";
import { Security } from "../src/security.ts";
import { DAILY_CAP, decide, failedStart, freshState, needsHead, prKey, Watcher, type WatchState } from "../src/security-watch.ts";
import { Store } from "../src/store.ts";
import { wideError } from "../src/security-targets.ts";

const pr = (number: number, more: Partial<PrItem> = {}): PrItem => ({ projectId: "p", project: "foreshore", host: "github", number, title: `PR ${number}`, url: "", state: "open", author: "devon", mine: false, reviewRequested: false, branch: `b${number}`, base: "main", additions: 1, deletions: 0, files: 1, labels: [], updatedAt: 100, ...more });
const NOW = new Date(2026, 10, 26, 12).getTime();
const base = (prs: PrItem[], heads: Record<string, string> = {}): WatchState => decide({ prs, state: freshState(), heads, scanned: {}, running: false, now: NOW }).state;
const look = (prs: PrItem[], state: WatchState, more: { heads?: Record<string, string>; scanned?: Record<string, string>; running?: boolean; now?: number; cap?: number } = {}) => decide({ prs, state, heads: more.heads ?? {}, scanned: more.scanned ?? {}, running: more.running ?? false, now: more.now ?? NOW, ...(more.cap !== undefined ? { cap: more.cap } : {}) });

test("The first look only records what is open as the baseline, and scans nothing", () => {
  const r = decide({ prs: [pr(1), pr(2, { state: "draft" })], state: freshState(), heads: { "pr:p:1": "aaa" }, scanned: {}, running: false, now: NOW });
  assert.equal(r.pick, undefined);
  assert.equal(r.state.baselined, true);
  assert.deepEqual(r.state.seen["pr:p:1"], { sha: "aaa", updatedAt: 100 });
  assert.deepEqual(r.state.seen["pr:p:2"], { updatedAt: 100, draft: true });
});

test("A pull request that opens after the baseline is scanned as new, and only once", () => {
  const s = base([pr(1)]);
  const r = look([pr(1), pr(2, { updatedAt: 200 })], s, { heads: { "pr:p:2": "bbb" } });
  assert.equal(r.pick?.pr.number, 2);
  assert.equal(r.pick?.why, "new");
  assert.equal(r.pick?.sha, "bbb");
  assert.equal(r.state.count, 1);
  assert.equal(look([pr(1), pr(2, { updatedAt: 200 })], r.state, { heads: { "pr:p:2": "bbb" }, scanned: { "pr:p:2": "bbb" } }).pick, undefined);
});

test("A pull request with a new commit since its last scan is scanned again, and a comment alone (same head) isn't", () => {
  const s = base([pr(1)], { "pr:p:1": "aaa" });
  assert.equal(look([pr(1, { updatedAt: 300 })], s, { heads: { "pr:p:1": "aaa" } }).pick, undefined);
  const r = look([pr(1, { updatedAt: 300 })], s, { heads: { "pr:p:1": "ccc" } });
  assert.equal(r.pick?.why, "commits");
  // A scan started by hand at that commit counts: nothing to do.
  assert.equal(look([pr(1, { updatedAt: 300 })], s, { heads: { "pr:p:1": "ccc" }, scanned: { "pr:p:1": "ccc" } }).pick, undefined);
});

test("A draft is never scanned, and is new once it's marked ready", () => {
  const s = base([]);
  const drafted = look([pr(5, { state: "draft", updatedAt: 200 })], s, { heads: { "pr:p:5": "ddd" } });
  assert.equal(drafted.pick, undefined);
  const ready = look([pr(5, { updatedAt: 250 })], drafted.state, { heads: { "pr:p:5": "ddd" } });
  assert.equal(ready.pick?.pr.number, 5);
  assert.equal(ready.pick?.why, "new");
});

test("One scan at a time: while its scan runs, a new pull request waits for the next look", () => {
  const s = base([]);
  const busy = look([pr(7, { updatedAt: 200 })], s, { running: true });
  assert.equal(busy.pick, undefined);
  assert.equal(busy.state.seen["pr:p:7"], undefined, "still new next time");
  assert.equal(look([pr(7, { updatedAt: 200 })], busy.state).pick?.pr.number, 7);
});

test("No more than the day's cap is started, and the count starts again the next day", () => {
  let s = base([]);
  const prs = Array.from({ length: DAILY_CAP + 2 }, (_, i) => pr(i + 1, { updatedAt: 200 + i }));
  let started = 0;
  for (let i = 0; i < DAILY_CAP + 2; i++) {
    const r = look(prs, s);
    if (r.pick) started++;
    s = r.state;
  }
  assert.equal(started, DAILY_CAP);
  const capped = look(prs, s);
  assert.equal(capped.pick, undefined);
  assert.equal(capped.capped, true);
  const tomorrow = look(prs, s, { now: NOW + 24 * 3_600_000 });
  assert.ok(tomorrow.pick, "a new day starts a new count");
  assert.equal(tomorrow.state.count, 1);
});

test("A pull request that was merged or closed is forgotten", () => {
  const s = base([pr(1), pr(2)]);
  const r = look([pr(1), pr(2, { state: "merged" })], s);
  assert.ok(r.state.seen["pr:p:1"]);
  assert.equal(r.state.seen["pr:p:2"], undefined);
});

test("gh is asked for a head commit only where it may have moved: on the first look, for a new one, or one GitHub says changed", () => {
  const s = base([pr(1, { updatedAt: 100 })], { "pr:p:1": "aaa" });
  assert.deepEqual(needsHead([pr(1, { updatedAt: 100 }), pr(2), pr(3, { state: "closed" })], s).map((p) => p.number), [2]);
  assert.deepEqual(needsHead([pr(1, { updatedAt: 150 })], s).map((p) => p.number), [1]);
  assert.deepEqual(needsHead([pr(1), pr(4, { state: "draft" })], freshState()).map((p) => p.number), [1, 4]);
});

test("The watcher looks only while Scan new PRs is on and a window is open, starts the new pull request, and tries again one that couldn't start", async () => {
  const store = new Store(realpathSync(mkdtempSync(join(tmpdir(), "lc-watch-"))));
  const sec = new Security(store, { PATH: "/nowhere" });
  let open = true;
  let prs = [pr(1)];
  const started: ScanTarget[] = [];
  let fail = false;
  let now = NOW;
  const w = new Watcher(sec, {
    listPrs: async () => prs,
    windows: () => open,
    now: () => now,
    head: async (_p, n) => `h${n}`,
    start: async (t) => {
      if (fail) throw new Error("gh isn't signed in");
      started.push(t);
      return { scanId: "" };
    },
  });
  // Off by default: nothing is asked.
  assert.equal(await w.tick(true), undefined);
  assert.equal(w.load().baselined, false);
  store.setSettings({ scanNewPrs: true });
  open = false;
  assert.equal(await w.tick(true), undefined);
  assert.equal(w.load().baselined, false, "no window, no look");
  open = true;
  assert.equal(await w.tick(true), undefined);
  assert.equal(w.load().baselined, true);
  prs = [pr(1), pr(2, { updatedAt: 200 })];
  // Too soon after the last look: it waits for its interval.
  now += 60_000;
  assert.equal(await w.tick(), undefined);
  fail = true;
  assert.equal(await w.tick(true), undefined);
  assert.equal(w.load().count, 0, "a scan that didn't start isn't counted");
  assert.equal(w.load().seen[prKey(pr(2))], undefined, "and is new again next time");
  fail = false;
  now += 6 * 60_000;
  assert.equal((await w.tick())?.pr.number, 2);
  assert.deepEqual(started, [{ kind: "pr", projectId: "p", number: 2 }]);
  // Turned off: what's open when it's next on is the baseline again.
  store.setSettings({ scanNewPrs: false });
  await w.tick(true);
  assert.equal(w.load().baselined, false);
});

test("A pull request that can't be scanned doesn't hold up the others: the next one is started in the same look", async () => {
  const store = new Store(realpathSync(mkdtempSync(join(tmpdir(), "lc-watch-"))));
  store.setSettings({ scanNewPrs: true });
  const sec = new Security(store, { PATH: "/nowhere" });
  let prs: PrItem[] = [];
  const started: number[] = [];
  let now = NOW;
  const w = new Watcher(sec, {
    listPrs: async () => prs,
    windows: () => true,
    now: () => now,
    head: async (_p, n) => `h${n}`,
    start: async (t) => {
      if (t.kind === "pr" && t.number === 9) throw new Error("gh can't read #9");
      started.push(t.kind === "pr" ? t.number : 0);
      return { scanId: "" };
    },
  });
  await w.tick(true);
  // #9 is the newest, so it comes first, and fails.
  prs = [pr(9, { updatedAt: 300 }), pr(8, { updatedAt: 200 })];
  assert.equal((await w.tick(true))?.pr.number, 8);
  assert.deepEqual(started, [8]);
  assert.equal(w.load().count, 1, "only the scan that started is counted");
});

test("A pull request that keeps failing is left for an hour after two tries, and for good at that commit after four; a new commit tries again", () => {
  let s = base([]);
  const p9 = pr(9, { updatedAt: 300 });
  const fail = (at: number) => {
    const r = look([p9], s, { heads: { "pr:p:9": "h9" }, now: at });
    assert.equal(r.pick?.pr.number, 9, `tried at +${(at - NOW) / 60_000} min`);
    s = failedStart(r.state, r.pick!, at);
  };
  fail(NOW);
  fail(NOW + 5 * 60_000);
  assert.equal(look([p9], s, { heads: { "pr:p:9": "h9" }, now: NOW + 30 * 60_000 }).pick, undefined, "resting for an hour");
  fail(NOW + 66 * 60_000);
  fail(NOW + 132 * 60_000);
  assert.equal(look([p9], s, { heads: { "pr:p:9": "h9" }, now: NOW + 600 * 60_000 }).pick, undefined, "given up at that commit");
  assert.equal(look([p9], s, { heads: { "pr:p:9": "h10" }, now: NOW + 601 * 60_000 }).pick?.pr.number, 9, "a new commit tries again");
});

test("A failure with no head commit to pin it to only rests the pull request, never gives up on it", () => {
  let s = base([]);
  const p9 = pr(9, { updatedAt: 300 });
  for (let i = 0; i < 4; i++) {
    const at = NOW + i * 61 * 60_000;
    const r = look([p9], s, { now: at });
    assert.equal(r.pick?.pr.number, 9, `try ${i + 1}`);
    s = failedStart(r.state, r.pick!, at);
  }
  assert.equal(look([p9], s, { now: NOW + 3 * 61 * 60_000 + 30 * 60_000 }).pick, undefined, "resting");
  assert.equal(look([p9], s, { now: NOW + 5 * 61 * 60_000 }).pick?.pr.number, 9, "tried again after its rest");
});

test("A failure no pull request caused (no tool ready, gh signed out, the network) stops the look and is held against none", async () => {
  const store = new Store(realpathSync(mkdtempSync(join(tmpdir(), "lc-watch-"))));
  store.setSettings({ scanNewPrs: true });
  const sec = new Security(store, { PATH: "/nowhere" });
  let prs: PrItem[] = [];
  const tried: number[] = [];
  let down = true;
  const w = new Watcher(sec, {
    listPrs: async () => prs,
    windows: () => true,
    now: () => NOW,
    head: async (_p, n) => `h${n}`,
    start: async (t) => {
      tried.push(t.kind === "pr" ? t.number : 0);
      if (down) throw wideError("gh isn't signed in, so pull request #9 can't be read. Run gh auth login, then try again.");
      return { scanId: "" };
    },
  });
  await w.tick(true);
  prs = [pr(9, { updatedAt: 300 }), pr(8, { updatedAt: 200 })];
  for (let i = 0; i < 5; i++) assert.equal(await w.tick(true), undefined);
  assert.deepEqual(tried, [9, 9, 9, 9, 9], "the look stops at the first: #8 would fail the same way");
  const s = w.load();
  assert.deepEqual(s.failed ?? {}, {});
  assert.equal(s.count, 0);
  down = false;
  assert.equal((await w.tick(true))?.pr.number, 9, "once gh is back, #9 is scanned, never given up on");
});
