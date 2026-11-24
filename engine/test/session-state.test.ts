/*
  How a session stands, for every face of the app (ui/src/app/session-state.ts). Run with `node --test engine/test/session-state.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { readFileSync } from "node:fs";
import { asksYou, bucketOf, markStateOf, needsYou, newsForYou, reviewHeld, seenAsk, sideStateOf, statusKind, wallKind } from "../../ui/src/app/session-state.ts";

const t = (more: Partial<Thread> = {}): Thread => ({ id: "t", projectId: "p", title: "Work", agent: "forge", status: "done", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1, ...more });

test("bucketOf: where a session sits, from the session alone", () => {
  assert.equal(bucketOf(t({ status: "running" })), "working");
  assert.equal(bucketOf(t({ status: "waiting" })), "needs");
  assert.equal(bucketOf(t({ status: "error" })), "needs");
  assert.equal(bucketOf(t({ status: "limited" })), "needs");
  assert.equal(bucketOf(t({ status: "done", unread: true })), "needs");
  assert.equal(bucketOf(t({ status: "done" })), "open");
  assert.equal(bucketOf(t({ status: "done", agentsAtWork: 1 })), "working");
  assert.equal(bucketOf(t({ pinned: true })), "pinned");
  assert.equal(bucketOf(t({ done: true })), "settled");
  assert.equal(bucketOf(t({ snoozedUntil: Date.now() + 60_000 })), "snoozed");
});

test("a Reviewer block is not asking: it reads as finished, not Needs you", () => {
  const b = t({ status: "waiting", held: "review" });
  assert.equal(reviewHeld(b), true);
  assert.equal(asksYou(b), false);
  assert.equal(bucketOf(b), "open");
  assert.equal(sideStateOf(b), "done");
  assert.equal(wallKind(b), "done");
  // Finished and not read still needs you, even held by the Reviewer.
  const u = t({ status: "waiting", held: "review", unread: true });
  assert.equal(bucketOf(u), "needs");
  assert.equal(needsYou(u), true);
});

test("needsYou: not one put away or not started; a pinned waiting one yes; agents still at work make it working", () => {
  assert.equal(needsYou(t({ status: "waiting", archived: true })), false);
  assert.equal(needsYou(t({ status: "waiting", turns: 0 })), false);
  assert.equal(needsYou(t({ status: "waiting", pinned: true })), true);
  assert.equal(needsYou(t({ status: "done", unread: true, agentsAtWork: 1 })), false);
});

test("sideStateOf: the mark a session's row shows", () => {
  assert.equal(sideStateOf(t({ status: "running" })), "working");
  assert.equal(sideStateOf(t({ status: "error" })), "error");
  assert.equal(sideStateOf(t({ status: "limited" })), "limited");
  assert.equal(sideStateOf(t({ status: "waiting" })), "needs");
  assert.equal(sideStateOf(t({ turns: 0 })), "new");
  assert.equal(sideStateOf(t()), "done");
  assert.equal(sideStateOf(t(), true), "working");
});

test("markStateOf: the state mark a session shows, from working to its pull request", () => {
  assert.equal(markStateOf(t({ status: "running" })), "working");
  assert.equal(markStateOf(t(), { busy: true }), "working");
  assert.equal(markStateOf(t({ status: "waiting", unread: true })), "needs");
  assert.equal(markStateOf(t({ status: "error" })), "problem");
  assert.equal(markStateOf(t({ status: "limited" })), "limit");
  assert.equal(markStateOf(t({ turns: 0 })), "new");
  assert.equal(markStateOf(t()), "done");
  // A question you have seen is done in grey; the same question looked at now is seen too.
  assert.equal(markStateOf(t({ status: "waiting" })), "done");
  assert.equal(markStateOf(t({ status: "waiting", unread: true }), { looking: true }), "done");
  // Finished while you were elsewhere is fresh until you open it, and a Reviewer block reads as finished.
  assert.equal(markStateOf(t({ unread: true })), "fresh");
  assert.equal(markStateOf(t({ unread: true }), { looking: true }), "done");
  assert.equal(markStateOf(t({ status: "waiting", held: "review", unread: true })), "fresh");
  // Its pull request, once nothing else is news: open, its checks running, passed or failed, then merged; a closed one says nothing.
  const pr = (state: string) => ({ pr: { number: 4, url: "u", state } });
  assert.equal(markStateOf(t(pr("OPEN"))), "pr");
  assert.equal(markStateOf(t(pr("OPEN")), { checks: "running" }), "checks");
  assert.equal(markStateOf(t(pr("OPEN")), { checks: "passed" }), "ready");
  assert.equal(markStateOf(t(pr("OPEN")), { checks: "failed" }), "problem");
  assert.equal(markStateOf(t(pr("MERGED"))), "merged");
  assert.equal(markStateOf(t(pr("CLOSED"))), "done");
  assert.equal(markStateOf(t({ ...pr("OPEN"), unread: true })), "fresh");
  assert.equal(markStateOf(t({ ...pr("OPEN"), status: "running" })), "working");
});

test("wallKind: working, needs you, or done on the Wall", () => {
  assert.equal(wallKind(t({ status: "running" })), "working");
  assert.equal(wallKind(t({ status: "waiting" })), "needs");
  assert.equal(wallKind(t({ status: "error" })), "needs");
  assert.equal(wallKind(t({ status: "limited" })), "needs");
  assert.equal(wallKind(t({ status: "done", agentsAtWork: 2 })), "working");
  assert.equal(wallKind(t({ status: "done" })), "done");
});

test("a question is news until you open the session, and still needs you after", () => {
  const fresh = t({ status: "waiting", unread: true });
  const seen = t({ status: "waiting" });
  assert.deepEqual([seenAsk(fresh), newsForYou(fresh)], [false, true]);
  assert.deepEqual([seenAsk(seen), newsForYou(seen), needsYou(seen), bucketOf(seen)], [true, false, true, "needs"]);
  // A problem and a plan's limit aren't questions: they stay news whether or not you've looked.
  assert.equal(newsForYou(t({ status: "error" })), true);
  assert.equal(newsForYou(t({ status: "limited" })), true);
  // A Reviewer block isn't a question either: read, it doesn't need you at all.
  assert.equal(seenAsk(t({ status: "waiting", held: "review" })), false);
});

test("the session you are looking at is never news, but its problem or its plan's limit still is", () => {
  // A question that just came in on the open session: the engine's unread mark is still on its way to being cleared.
  const asking = t({ status: "waiting", unread: true });
  assert.deepEqual([seenAsk(asking, true), newsForYou(asking, Date.now(), true)], [true, false]);
  assert.equal(newsForYou(t({ status: "done", unread: true }), Date.now(), true), false);
  assert.equal(newsForYou(t({ status: "error" }), Date.now(), true), true);
  assert.equal(newsForYou(t({ status: "limited" }), Date.now(), true), true);
  // Not looking, the same question is news.
  assert.equal(newsForYou(asking, Date.now(), false), true);
});

test("Needs you means one thing: The Wall's filter counts a finished session you haven't read under Needs you, as the sidebar's By status does", () => {
  const unread = t({ status: "done", unread: true });
  const read = t({ status: "done" });
  // The sidebar said "Needs you 1 · Finished 1" for these two; The Wall must say the same.
  assert.deepEqual([statusKind(unread), statusKind(read)], ["needs", "done"]);
  assert.equal(statusKind(t({ status: "running" })), "working");
  assert.equal(statusKind(t({ status: "waiting" })), "needs");
  assert.equal(statusKind(t({ status: "done", agentsAtWork: 2 })), "working");
  // Answered while you were away, its agents still at work: working until they are done, in both.
  assert.equal(statusKind(t({ status: "done", unread: true, agentsAtWork: 1 })), "working");
  // A tile's own buttons still go by wallKind: a finished unread tile keeps its finished foot.
  assert.equal(wallKind(unread), "done");
  // Both lists take the one test: The Wall's filter and counts read statusKind, the sidebar's Working reads worksNow and Needs you needsYou.
  const wall = readFileSync(new URL("../../ui/src/app/Wall.tsx", import.meta.url), "utf8");
  assert.match(wall, /wallFilter = \(all: Thread\[\], filter: Filter, now = Date\.now\(\)\) => \(filter === "all" \? all : filter === "review" \? all\.filter\(needsReview\) : all\.filter\(\(t\) => statusKind\(t, now\) === filter\)\)/);
  assert.match(wall, /const count = \(k: WallKind \| "review"\) => wallFilter\(all, k, now\)\.length;/);
  assert.doesNotMatch(wall, /wallKind\(t\) === filter|wallKind\(t\) === k/);
  const side = readFileSync(new URL("../../ui/src/app/Sidebar.tsx", import.meta.url), "utf8");
  assert.match(side, /const needs = \(t: Thread\) => needsYou\(t, now\);/);
  assert.match(side, /const works = worksNow;/);
});
