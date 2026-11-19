/*
  How a session stands, for every face of the app (ui/src/app/session-state.ts). Run with `node --test engine/test/session-state.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { asksYou, bucketOf, needsYou, reviewHeld, sideStateOf, wallKind } from "../../ui/src/app/session-state.ts";

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

test("wallKind: working, needs you, or done on the Wall", () => {
  assert.equal(wallKind(t({ status: "running" })), "working");
  assert.equal(wallKind(t({ status: "waiting" })), "needs");
  assert.equal(wallKind(t({ status: "error" })), "needs");
  assert.equal(wallKind(t({ status: "limited" })), "needs");
  assert.equal(wallKind(t({ status: "done", agentsAtWork: 2 })), "working");
  assert.equal(wallKind(t({ status: "done" })), "done");
});
