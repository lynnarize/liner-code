/*
  The title menu's Commit opening Changes with its commit form open (ui/src/app/commit-ask.ts), without a page.
  Run with `node --test engine/test/commit-ask.test.ts`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { askCommit, onCommitAsk, takeCommit } from "../../ui/src/app/commit-ask.ts";

test("A commit asked for before Changes shows waits for its Commit button, with what follows it, and is taken once", () => {
  askCommit("t1", "push");
  assert.equal(takeCommit("t2"), undefined, "another session's Commit took this session's ask");
  assert.equal(takeCommit("t1"), "push", "Changes opened without its commit form, or forgot to push after");
  assert.equal(takeCommit("t1"), undefined, "the form opened again the next time Changes showed");
});

test("A commit asked for while Changes' Commit button shows opens its form at once, and not again later", () => {
  const heard: string[] = [];
  const stop = onCommitAsk("t3", (then) => heard.push(then));
  askCommit("t3", "pr");
  assert.deepEqual(heard, ["pr"], "the Commit button showing did not open its form");
  assert.equal(takeCommit("t3"), undefined, "the ask was kept as well, so the form would open twice");
  stop();
  askCommit("t3", "commit");
  assert.deepEqual(heard, ["pr"], "a Commit button that went away still heard asks");
  assert.equal(takeCommit("t3"), "commit");
});
