/*
  The two facts a session's row says that the engine passes along (Rows.dc.html): what it waits on you for, in its own
  words (Thread.asking, contracts askingOf), short and plain like the doing line, set while it waits and gone when it
  stops; and how its pull request's checks stand (Thread.pr.checks, contracts prChecksOf), from the reads of the pull
  request the app makes already. Then how a row turns them into its mark and words (ui/src/app/session-state.ts).
  Run with `node --test engine/test/row-facts.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item, Thread } from "../../contracts/src/index.ts";
import { ASKING_MAX, askingOf, emptyUsage, prChecksOf, sameChecks } from "../../contracts/src/index.ts";
import { Store } from "../src/store.ts";
import { CHECKS_FOR, Watch } from "../src/watch.ts";
import { askWords, markLabelOf, markStateOf, prSaid } from "../../ui/src/app/session-state.ts";

const approval = (fields: { label: string; value: string }[], more: { tool?: string; title?: string } = {}) => ({ kind: "approval" as const, tool: more.tool ?? "Bash", title: more.title ?? "Run a command", fields });

test("An approval for a command is asked as its program and plain words, never the whole command line", () => {
  assert.equal(askingOf(approval([{ label: "Command", value: "npm test" }])), "Run npm test?");
  assert.equal(askingOf(approval([{ label: "Command", value: "cd app && npm run build -- --watch" }])), "Run npm run build?");
  // A value after an unknown program is never said: it could be a password.
  assert.equal(askingOf(approval([{ label: "Command", value: "sshpass -p hunter2 ssh me@host" }])), "Run sshpass?");
  assert.equal(askingOf(approval([{ label: "Command", value: "echo $(cat ~/.ssh/id_rsa)" }])), "Run echo?");
  assert.equal(askingOf(approval([{ label: "Command", value: "'unclosed" }])), "Run a command?");
});

test("An approval for an edit is asked by the file's name alone, and several files by how many", () => {
  assert.equal(askingOf(approval([{ label: "File", value: "src/tides/tides.js" }], { tool: "apply_patch", title: "Edit src/tides/tides.js" })), "Edit tides.js?");
  assert.equal(askingOf(approval([], { tool: "Write", title: "Write /Users/someone/app/notes.md" })), "Write notes.md?");
  assert.equal(askingOf(approval([{ label: "File", value: "a.ts" }, { label: "File", value: "b.ts" }], { tool: "apply_patch", title: "Edit a.ts, b.ts" })), "Edit 2 files?");
  // A title that is only the tool's kind names no file.
  assert.equal(askingOf(approval([], { tool: "edit", title: "Edit" })), "Change a file?");
});

test("A dev server, the Browser, another tool, a plan and an add-on are each asked in plain words", () => {
  assert.equal(askingOf(approval([], { tool: "mcp__liner__server_start", title: "Run web from launch.json" })), "Start web?");
  assert.equal(askingOf(approval([], { tool: "mcp__liner__server_start", title: "Run" })), "Start a server?");
  assert.equal(askingOf(approval([], { tool: "mcp__liner__browser_click", title: "Click" })), "Use the Browser?");
  assert.equal(askingOf(approval([], { tool: "mcp__github__create_issue", title: "Create an issue" })), "Use github?");
  assert.equal(askingOf(approval([], { tool: "mcp__liner__something", title: "Something" })), "Use a tool?");
  assert.equal(askingOf({ kind: "proposal", title: "Plan" }), "Approve its plan?");
  assert.equal(askingOf({ ...approval([]), addon: { name: "Tide feed" } }), "Add Tide feed?");
});

test("A question is said in its own words, on one line, cut at a word when it runs long", () => {
  assert.equal(askingOf({ kind: "question", questions: [{ question: "Which of the two keys is the live one?" }] }), "Which of the two keys is the live one?");
  assert.equal(askingOf({ kind: "question", questions: [{ question: "Pick one\nof the two headlines" }] }), "Pick one of the two headlines");
  const long = askingOf({ kind: "question", questions: [{ question: "Should the tide table show the times in the harbour's own time zone or in the time zone this computer is set to?" }] })!;
  assert.ok(long.length <= ASKING_MAX, `"${long}" runs past ${ASKING_MAX}`);
  assert.ok(!long.endsWith(" ") && !long.endsWith("…"));
  assert.equal(askingOf({ kind: "question", questions: [] }), undefined);
});

function made(dir = mkdtempSync(join(tmpdir(), "lc-asking-"))) {
  const store = new Store(dir);
  store.putThread({ id: "t", projectId: "p", title: "Work", agent: "forge", status: "running", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  return { store, dir };
}
const ask = (id: string, command: string): Item => ({ kind: "approval", id, turn: 1, at: Date.now(), tool: "Bash", title: `Run ${command}`, risk: "low", fields: [{ label: "Command", value: command }], state: "asking" });

test("A session that starts waiting on an approval says what it would run, and stops saying it once answered", () => {
  const { store } = made();
  store.putItem("t", ask("a1", "npm test"));
  // The ask goes in before the session waits (runtime.ts): nothing is said while it still runs.
  assert.equal(store.thread("t").asking, undefined);
  store.patchThread("t", { status: "waiting" });
  assert.deepEqual(store.thread("t").asking, { text: "Run npm test?" });
  store.putItem("t", { ...ask("a1", "npm test"), state: "approved" } as Item);
  store.patchThread("t", { status: "running" });
  assert.equal(store.thread("t").asking, undefined);
  assert.ok(!("asking" in store.thread("t")), "the field goes, not left as undefined in what's saved");
});

test("A second ask while it waits says the newest; answering it says the one still open", () => {
  const { store } = made();
  store.putItem("t", ask("a1", "npm test"));
  store.patchThread("t", { status: "waiting" });
  store.putItem("t", { kind: "question", id: "q1", turn: 1, at: Date.now(), questions: [{ question: "Which port?", options: [] }], state: "asking" });
  assert.deepEqual(store.thread("t").asking, { text: "Which port?" });
  store.putItem("t", { kind: "question", id: "q1", turn: 1, at: Date.now(), questions: [{ question: "Which port?", options: [] }], state: "answered" });
  assert.deepEqual(store.thread("t").asking, { text: "Run npm test?" });
});

test("A session that stops, ends or fails while it waited says nothing it asked; a Reviewer block asks nothing", () => {
  const { store } = made();
  store.putItem("t", ask("a1", "npm test"));
  store.patchThread("t", { status: "waiting" });
  store.patchThread("t", { status: "error" });
  assert.equal(store.thread("t").asking, undefined);
  store.patchThread("t", { status: "waiting", held: "review" });
  // The old ask is still on the timeline as asking in this test's store, but a block is the Reviewer's: only open asks speak.
  store.putItem("t", { ...ask("a1", "npm test"), state: "expired" } as Item);
  assert.equal(store.thread("t").asking, undefined);
});

test("Sessions saved before the field load as they were, and one that no longer waits after a restart loses it", () => {
  const { store, dir } = made();
  store.putItem("t", ask("a1", "npm test"));
  store.patchThread("t", { status: "waiting" });
  store.putThread({ id: "old", projectId: "p", title: "Old", agent: "forge", status: "done", access: "edits", turns: 2, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  store.flush();
  const again = new Store(dir);
  // The approval expired with the engine that held it: the session no longer waits, so it no longer asks.
  assert.equal(again.thread("t").status, "idle");
  assert.equal(again.thread("t").asking, undefined);
  assert.equal(again.thread("old").asking, undefined);
  assert.equal(askWords(again.thread("old")), "Waits for your answer");
});

test("A question still open after a restart keeps its session waiting, and its words", () => {
  const { store, dir } = made();
  store.putItem("t", { kind: "question", id: "q1", turn: 1, at: Date.now(), questions: [{ question: "Which port?", options: [] }], state: "asking" });
  store.patchThread("t", { status: "waiting" });
  store.flush();
  const again = new Store(dir);
  assert.equal(again.thread("t").status, "waiting");
  assert.deepEqual(again.thread("t").asking, { text: "Which port?" });
});

test("After a restart a session waiting on a question says the question, not an approval asked after it that expired", () => {
  const { store, dir } = made();
  store.putItem("t", { kind: "question", id: "q1", turn: 1, at: Date.now(), questions: [{ question: "Which port?", options: [] }], state: "asking" });
  store.patchThread("t", { status: "waiting" });
  store.putItem("t", ask("a1", "npm test"));
  assert.deepEqual(store.thread("t").asking, { text: "Run npm test?" });
  store.flush();
  const again = new Store(dir);
  assert.equal(again.thread("t").status, "waiting");
  assert.deepEqual(again.thread("t").asking, { text: "Which port?" });
});

test("A pull request's checks read as running while any is pending, then failed with how many, or passed", () => {
  assert.equal(prChecksOf([]), undefined);
  assert.equal(prChecksOf([{ state: "skipped" }]), undefined);
  assert.deepEqual(prChecksOf([{ state: "pass" }, { state: "pending" }, { state: "fail" }]), { state: "running" });
  assert.deepEqual(prChecksOf([{ state: "pass" }, { state: "fail" }, { state: "fail" }, { state: "skipped" }]), { state: "failed", failed: 2 });
  assert.deepEqual(prChecksOf([{ state: "pass" }, { state: "skipped" }]), { state: "passed" });
  assert.equal(sameChecks({ state: "failed", failed: 2 }, { state: "failed", failed: 2 }), true);
  assert.equal(sameChecks({ state: "failed", failed: 2 }, { state: "failed", failed: 1 }), false);
  assert.equal(sameChecks(undefined, undefined), true);
});

test("The minute's watch keeps the checks it reads from gh on the session's pull request", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-checks-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const answer = join(dir, "answer.json");
  // A stand-in for gh: whatever answer.json holds is the pull request.
  writeFileSync(join(bin, "gh"), `#!/bin/sh\ncat "${answer}"\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const store = new Store(join(dir, "home"));
  store.setSettings({ settleOnMerge: true });
  store.putProject({ id: "p", name: "work", path: dir, git: true, createdAt: 1 });
  store.putThread({ id: "t", projectId: "p", title: "Work", agent: "forge", status: "done", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1, pr: { number: 479, url: "https://example.invalid/479", state: "OPEN" } });
  const watch = new Watch(store, { ...process.env, PATH: `${bin}:${process.env.PATH}` });
  const follow = (t: Thread) => (watch as unknown as { followPr(t: Thread): Promise<void> }).followPr(t);

  writeFileSync(answer, JSON.stringify({ state: "OPEN", statusCheckRollup: [{ name: "build", status: "IN_PROGRESS" }, { name: "lint", conclusion: "SUCCESS" }] }));
  await follow(store.thread("t"));
  assert.equal(store.thread("t").pr?.checks?.state, "running");

  writeFileSync(answer, JSON.stringify({ state: "OPEN", statusCheckRollup: [{ name: "build", conclusion: "FAILURE" }, { name: "test", conclusion: "FAILURE" }, { name: "lint", conclusion: "SUCCESS" }] }));
  await follow(store.thread("t"));
  assert.deepEqual(store.thread("t").pr, { number: 479, url: "https://example.invalid/479", state: "OPEN", checks: { state: "failed", failed: 2 } });

  // Nothing new: the session isn't saved again (its time would move for nothing).
  const at = store.thread("t").updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  await follow(store.thread("t"));
  assert.equal(store.thread("t").updatedAt, at);
});

test("The minute's watch follows a pull request while its saved checks run, for two hours at most, and changes nothing else about the session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-running-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const answer = join(dir, "answer.json");
  const calls = join(dir, "calls");
  // A stand-in for gh that notes which pull request each read was for.
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$3" >> "${calls}"\ncat "${answer}"\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const read = () => (existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter(Boolean) : []);
  const home = join(dir, "home");
  const store = new Store(home);
  // Neither settling on merge nor a snooze: before, nothing followed these at all.
  assert.equal(store.settings.settleOnMerge, false);
  store.putProject({ id: "p", name: "work", path: dir, git: true, createdAt: 1 });
  const base = { projectId: "p", title: "Work", agent: "forge", status: "done" as const, access: "edits" as const, turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 };
  const now = Date.now();
  store.putThread({ ...base, id: "fresh", pr: { number: 1, url: "u1", state: "OPEN", checks: { state: "running", since: now - 60_000 } } });
  store.putThread({ ...base, id: "stale", pr: { number: 2, url: "u2", state: "OPEN", checks: { state: "running", since: now - CHECKS_FOR - 60_000 } } });
  store.putThread({ ...base, id: "old", pr: { number: 3, url: "u3", state: "OPEN", checks: { state: "running" } } });
  store.putThread({ ...base, id: "ended", pr: { number: 4, url: "u4", state: "OPEN", checks: { state: "passed" } } });
  store.flush();
  const events: string[] = [];
  store.on((e) => events.push(e.type));
  const watch = new Watch(store, { ...process.env, PATH: `${bin}:${process.env.PATH}` });

  writeFileSync(answer, JSON.stringify({ state: "OPEN", statusCheckRollup: [{ name: "build", status: "IN_PROGRESS" }] }));
  await watch.tick();
  assert.deepEqual(read().sort(), ["1", "3"], "the running ones are read; two hours on, or ended, they aren't");
  assert.deepEqual(store.thread("fresh").pr?.checks, { state: "running", since: now - 60_000 }, "still running: when it was first seen is kept");
  const since = store.thread("old").pr?.checks?.since;
  assert.ok(since && since >= now, "one saved before the field starts its two hours now");

  // Across a restart the two hours hold: the stale one still isn't read.
  const again = new Store(home);
  again.on((e) => events.push(e.type));
  const watch2 = new Watch(again, { ...process.env, PATH: `${bin}:${process.env.PATH}` });
  writeFileSync(answer, JSON.stringify({ state: "OPEN", statusCheckRollup: [{ name: "build", conclusion: "SUCCESS" }] }));
  await watch2.tick();
  assert.deepEqual(read().sort(), ["1", "1", "3", "3"]);
  assert.deepEqual(again.thread("fresh").pr, { number: 1, url: "u1", state: "OPEN", checks: { state: "passed" } });
  assert.equal(again.thread("stale").pr?.checks?.state, "running");

  // Once they've ended nothing is read any more, and none of it settled, woke or marked a session.
  await watch2.tick();
  assert.equal(read().length, 4);
  for (const id of ["fresh", "stale", "old", "ended"]) {
    const t = again.thread(id);
    assert.equal(t.done, undefined, id);
    assert.equal(t.unread, undefined, id);
    assert.equal(t.status, "done", id);
  }
  assert.ok(!events.includes("settled") && !events.includes("notify"));
});

const t = (more: Partial<Thread> = {}): Thread => ({ id: "t", projectId: "p", title: "Work", agent: "forge", status: "done", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1, ...more });
const pr = (checks?: NonNullable<Thread["pr"]>["checks"], state = "OPEN") => ({ number: 483, url: "u", state, ...(checks ? { checks } : {}) });

test("A row's mark and words follow its pull request's checks as the session carries them", () => {
  assert.equal(markStateOf(t({ pr: pr() })), "pr");
  assert.equal(markStateOf(t({ pr: pr({ state: "running" }) })), "checks");
  assert.equal(markStateOf(t({ pr: pr({ state: "passed" }) })), "ready");
  assert.equal(markStateOf(t({ pr: pr({ state: "failed", failed: 2 }) })), "problem");
  assert.equal(markStateOf(t({ pr: pr({ state: "failed", failed: 2 }, "MERGED") })), "merged");
  // A caller that knows better still has the say.
  assert.equal(markStateOf(t({ pr: pr({ state: "running" }) }), { checks: "passed" }), "ready");
  assert.equal(markLabelOf(t({ pr: pr({ state: "failed", failed: 2 }) }), "problem"), "Checks failed");
  assert.equal(markLabelOf(t({ status: "error" }), "problem"), undefined);

  assert.deepEqual(prSaid(pr()), { text: "PR open", num: "open" });
  assert.deepEqual(prSaid(pr({ state: "running" })), { text: "Checks running", num: "checks" });
  assert.deepEqual(prSaid(pr({ state: "passed" })), { text: "Ready to merge", num: "open" });
  assert.deepEqual(prSaid(pr({ state: "failed", failed: 1 })), { text: "1 check failed", tone: "danger", num: "bad" });
  assert.deepEqual(prSaid(pr({ state: "failed", failed: 2 })), { text: "2 checks failed", tone: "danger", num: "bad" });
  assert.deepEqual(prSaid(pr(undefined, "MERGED")), { text: "Merged", num: "merged" });
  assert.deepEqual(prSaid(pr(undefined, "CLOSED")), { text: "PR closed", num: "closed" });
});

test("A row says what a session waits on you for in its own words, and the plain words only without them", () => {
  assert.equal(askWords(t({ status: "waiting", asking: { text: "Run npm test?" } })), "Run npm test?");
  assert.equal(askWords(t({ status: "waiting" })), "Waits for your answer");
});
