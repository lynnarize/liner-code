/*
  A session that starts waiting on you is unread until you open it, so a question you have not seen is amber and news (the
  folded folders, the pill), and one you have is grey with no mark and not news (ui/src/app/session-state.ts, seenAsk). Run with `node --test engine/test/waiting-unread.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyUsage } from "../../contracts/src/index.ts";
import { Store } from "../src/store.ts";

function made() {
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-waiting-")));
  store.putThread({ id: "t", projectId: "p", title: "Work", agent: "forge", status: "running", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  return store;
}

test("A session that starts waiting on you mid-turn is marked unread", () => {
  const store = made();
  assert.equal(store.thread("t").unread, undefined);
  store.patchThread("t", { status: "waiting", held: undefined });
  assert.equal(store.thread("t").unread, true);
});

test("Opening a waiting session clears unread, and it stays clear while it goes on waiting", () => {
  const store = made();
  store.patchThread("t", { status: "waiting" });
  store.patchThread("t", { unread: false });
  // Another patch while it still waits (a second card, a tick of its clock) is not a new wait.
  store.patchThread("t", { status: "waiting" });
  store.patchThread("t", { title: "Renamed" });
  assert.equal(store.thread("t").unread, false);
});

test("A patch that says unread itself has the say, and other statuses leave unread alone", () => {
  const store = made();
  store.patchThread("t", { status: "waiting", unread: false });
  assert.equal(store.thread("t").unread, false);
  store.patchThread("t", { status: "done" });
  assert.equal(store.thread("t").unread, false);
  store.patchThread("t", { status: "error" });
  assert.equal(store.thread("t").unread, false);
});

const ask = (id: string) => ({ kind: "approval" as const, id, turn: 1, at: Date.now(), tool: "Bash", title: "Run npm test", risk: "low" as const, fields: [], state: "asking" as const });

test("A second approval while the session already waits, and seen, is news again", () => {
  const store = made();
  store.putItem("t", ask("a1"));
  store.patchThread("t", { status: "waiting" });
  // You looked: the app cleared it.
  store.patchThread("t", { unread: false });
  store.putItem("t", ask("a2"));
  assert.equal(store.thread("t").unread, true);
});

test("A question after a Reviewer block you have seen is news again", () => {
  const store = made();
  store.patchThread("t", { status: "waiting", held: "review" });
  store.patchThread("t", { unread: false });
  store.putItem("t", { kind: "question", id: "q1", turn: 1, at: Date.now(), questions: [{ question: "Which?", options: [{ label: "A" }, { label: "B" }] }], state: "asking" });
  assert.equal(store.thread("t").unread, true);
});

test("An ask answered, or anything that isn't a new ask, leaves unread alone", () => {
  const store = made();
  store.putItem("t", ask("a1"));
  store.patchThread("t", { unread: false });
  // The same card again, answered: not a new ask.
  store.putItem("t", { ...ask("a1"), state: "approved" as const });
  store.putItem("t", { kind: "text", id: "x1", turn: 1, at: Date.now(), text: "Hello", streaming: false });
  assert.equal(store.thread("t").unread, false);
});
