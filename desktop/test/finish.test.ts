/*
  "Quit when they finish": when the app, out of sight, may quit, and whom it tells it waits on.
  The Electron side (hiding, the Dock, the menu bar item) is in main.ts; this is its deciding part.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { heldOnYou, openAsk, quitQuestion, QuitWhenDone, waitLine, type Live } from "../src/finish.ts";

const t = (id: string, status: string, more: Partial<Live> = {}): Live => ({ id, title: `Session ${id}`, status, ...more });

test("waits while a session works, and quits only once all have been quiet a moment", () => {
  const q = new QuitWhenDone(2000);
  let r = q.read([t("a", "running"), t("b", "running"), t("c", "done")], 0);
  assert.equal(r.quit, false);
  assert.deepEqual(r.left.working.map((s) => s.id), ["a", "b"]);
  r = q.read([t("a", "done"), t("b", "running")], 3000);
  assert.equal(r.quit, false);
  assert.equal(waitLine(r.left), "Quits when the session finishes");
  // The last one ends: quiet now, but not for long enough yet (the next turn of a queue could start).
  r = q.read([t("a", "done"), t("b", "done")], 6000);
  assert.equal(r.quit, false);
  assert.equal(waitLine(r.left), "Quitting in a moment");
  r = q.read([t("a", "done"), t("b", "done")], 9000);
  assert.equal(r.quit, true);
});

test("a turn that starts again in the quiet moment puts the quit off", () => {
  const q = new QuitWhenDone(2000);
  q.read([t("a", "running")], 0);
  q.read([t("a", "done")], 3000);
  // A queued message started the next turn before the quit was due.
  let r = q.read([t("a", "running")], 4000);
  assert.equal(r.quit, false);
  r = q.read([t("a", "done")], 5000);
  assert.equal(r.quit, false, "the quiet moment starts over");
  assert.equal(q.read([t("a", "done")], 7500).quit, true);
});

test("agents still at work in the background hold the app, as quitting would end them", () => {
  const q = new QuitWhenDone(0);
  const r = q.read([t("a", "done", { agentsAtWork: 2 })], 0);
  assert.equal(r.quit, false);
  assert.deepEqual(r.left.working.map((s) => s.id), ["a"]);
});

test("a session it waited for that now waits on you holds the app, and is told of once", () => {
  const q = new QuitWhenDone(0);
  q.read([t("a", "running")], 0);
  let r = q.read([t("a", "waiting")], 3000);
  assert.equal(r.quit, false);
  assert.deepEqual(r.left.waiting.map((s) => s.id), ["a"]);
  assert.deepEqual(r.tell.map((s) => s.id), ["a"]);
  assert.equal(waitLine(r.left), "Quits when the session finishes");
  // Hours later it still waits: the app stays, and says nothing more.
  r = q.read([t("a", "waiting")], 3000 + 4 * 3600_000);
  assert.equal(r.quit, false);
  assert.deepEqual(r.tell, []);
  // You answered from the menu bar item, and the turn ran to its end.
  q.read([t("a", "running")], 5 * 3600_000);
  assert.equal(q.read([t("a", "done")], 5 * 3600_000 + 1).quit, true);
});

test("an old session left waiting (no request open) doesn't keep the app forever", () => {
  const q = new QuitWhenDone(0);
  const threads = [t("old", "waiting"), t("a", "running")];
  assert.deepEqual(q.toCheck(threads), ["old"]);
  q.mark("old", false);
  assert.deepEqual(q.toCheck(threads), [], "looked at once");
  let r = q.read(threads, 0);
  assert.deepEqual(r.left.waiting, []);
  r = q.read([t("old", "waiting"), t("a", "done")], 1);
  assert.equal(r.quit, true);
});

test("a session already waiting on an open request when you quit holds the app", () => {
  const q = new QuitWhenDone(0);
  const threads = [t("w", "waiting")];
  q.mark(q.toCheck(threads)[0], true);
  const r = q.read(threads, 0);
  assert.equal(r.quit, false);
  assert.deepEqual(r.left.waiting.map((s) => s.id), ["w"]);
  assert.equal(waitLine({ working: [{ id: "x", title: "" }], waiting: r.left.waiting }), "Quits when 2 sessions finish");
});

test("archived sessions don't count", () => {
  const q = new QuitWhenDone(0);
  assert.deepEqual(q.toCheck([t("a", "waiting", { archived: true })]), []);
  assert.equal(q.read([t("a", "running", { archived: true })], 0).quit, true);
});

test("the same news isn't told twice: the page's notice and the shell's", () => {
  const q = new QuitWhenDone(0);
  q.read([t("a", "running"), t("b", "running")], 0);
  // The page already said a needs you (it still runs while hidden).
  q.heard("a", 1000);
  let r = q.read([t("a", "waiting"), t("b", "waiting")], 2000);
  assert.deepEqual(r.tell.map((s) => s.id), ["b"]);
  // The page's notice for b, coming just after the shell's, is the one left out.
  assert.equal(q.toldLately("b", 3000), true);
  assert.equal(q.toldLately("a", 3000), false);
  // A later notice about b (it finished) goes out as usual.
  assert.equal(q.toldLately("b", 60_000), false);
  r = q.read([t("a", "waiting"), t("b", "waiting")], 60_000);
  assert.deepEqual(r.tell, [], "each is told of once");
});

test("an open request is an approval, a question or a plan still asking", () => {
  assert.equal(openAsk([{ kind: "message" }, { kind: "approval", state: "asking" }]), true);
  assert.equal(openAsk([{ kind: "question", state: "asking" }]), true);
  assert.equal(openAsk([{ kind: "proposal", state: "asking" }]), true);
  assert.equal(openAsk([{ kind: "approval", state: "allowed" }]), false);
  assert.equal(openAsk(null), false);
  assert.equal(openAsk([null, 3]), false);
});

test("a waiting session whose timeline didn't come in time is held, not told of, and looked at again", () => {
  const q = new QuitWhenDone(0);
  const threads = [t("w", "waiting")];
  q.mark(q.toCheck(threads)[0], undefined);
  let r = q.read(threads, 0);
  assert.equal(r.quit, false, "held as if it waits on you");
  assert.deepEqual(r.left.waiting.map((s) => s.id), ["w"]);
  assert.deepEqual(r.tell, [], "not told of on a guess");
  assert.deepEqual(q.toCheck(threads), ["w"], "asked again next time");
  q.mark("w", false);
  r = q.read(threads, 1);
  assert.deepEqual(r.left.waiting, []);
  assert.equal(r.quit, true);
});

test("⌘Q counts sessions waiting on a live request, and one whose timeline doesn't come", async () => {
  const timelines: Record<string, unknown> = { open: [{ kind: "approval", state: "asking" }], old: [{ kind: "approval", state: "allowed" }] };
  const items = (id: string) => (id in timelines ? Promise.resolve(timelines[id]) : Promise.reject(new Error("timed out")));
  assert.equal(await heldOnYou(["open", "old"], items), 1);
  assert.equal(await heldOnYou(["open", "old", "silent"], items), 2);
  assert.equal(await heldOnYou([], items), 0);
  assert.equal(quitQuestion(1, 0), "A session is still working. Quit anyway?");
  assert.equal(quitQuestion(3, 0), "3 sessions are still working. Quit anyway?");
  assert.equal(quitQuestion(0, 1), "A session is waiting on you. Quit anyway?");
  assert.equal(quitQuestion(0, 2), "2 sessions are waiting on you. Quit anyway?");
  assert.equal(quitQuestion(1, 1), "1 session is still working and 1 is waiting on you. Quit anyway?");
});
