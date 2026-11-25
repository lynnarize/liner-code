/*
  The Pull request surface's picker (ui/src/app/pr-pick.ts, board PullRequest, 2026-11-25), which took the Linked pull
  requests surface's place: what each pull request is called in it, how it groups and finds them, which actions a
  picked one offers, and how the Linked key reaches it. Run with `node --test engine/test/pr-pick.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PrInfo } from "../../contracts/src/index.ts";
import { askPicker, isMine, onPicker, pickerLists, prActions, prWord, takePicker } from "../../ui/src/app/pr-pick.ts";
import { emptyDock, openTab, replaceTab } from "../../ui/src/app/dock.ts";

const pr = (number: number, more: Partial<PrInfo> = {}): PrInfo => ({ number, title: `Change ${number}`, url: `https://github.com/o/r/pull/${number}`, state: "OPEN", isDraft: false, head: `b${number}`, base: "main", additions: 1, deletions: 0, commits: [], checks: [], reviews: [], requested: [], ...more });
const app = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");

test("A pull request's word in the picker says what it waits on, in the tone of how it stands", () => {
  assert.deepEqual(prWord(pr(1, { state: "MERGED" })), { word: "Merged" });
  assert.deepEqual(prWord(pr(1, { state: "CLOSED" })), { word: "Closed" });
  assert.deepEqual(prWord(pr(1, { mergeable: "CONFLICTING" })), { word: "Conflicts", tone: "warn" });
  assert.deepEqual(prWord(pr(1, { checks: [{ name: "test", state: "fail" }] })), { word: "A check failed", tone: "danger" });
  assert.deepEqual(prWord(pr(1, { isDraft: true })), { word: "Draft" });
  assert.deepEqual(prWord(pr(1, { checks: [{ name: "test", state: "pending" }] })), { word: "Checks running" });
  assert.deepEqual(prWord(pr(1, { reviewDecision: "CHANGES_REQUESTED" })), { word: "Changes asked for", tone: "warn" });
  assert.deepEqual(prWord(pr(1)), { word: "Open", tone: "ok" });
});

test("The picker puts this session's pull request on top, then the others open first and newest first", () => {
  const thread = { id: "t1", pr: { number: 128 } };
  const prs = [pr(121, { state: "MERGED" }), pr(127), pr(128), pr(125), pr(130, { threadId: "t2" })];
  const l = pickerLists(prs, thread);
  assert.equal(l.mine?.number, 128);
  assert.deepEqual(l.others.map((p) => p.number), [130, 127, 125, 121]);
  assert.equal(l.open, 3, "the others' label counts the open ones");
  // A pull request opened from this session is its own even before the thread remembers its number.
  assert.ok(isMine(pr(9, { threadId: "t1" }), { id: "t1" }));
  assert.ok(!isMine(pr(9, { threadId: "t2" }), { id: "t1" }));
});

test("The picker's find line finds a pull request by its number, with or without its #, or by words of its title or branch", () => {
  const thread = { id: "t1", pr: { number: 128 } };
  const prs = [pr(128, { title: "The next high tide wraps round" }), pr(127, { title: "The chart's axis says metres", head: "axis-units" }), pr(121, { title: "Low tides get their own colour" })];
  assert.deepEqual(pickerLists(prs, thread, "#127").others.map((p) => p.number), [127]);
  assert.deepEqual(pickerLists(prs, thread, "12").others.map((p) => p.number), [127, 121]);
  assert.deepEqual(pickerLists(prs, thread, "colour").others.map((p) => p.number), [121]);
  assert.deepEqual(pickerLists(prs, thread, "axis-units").others.map((p) => p.number), [127]);
  assert.equal(pickerLists(prs, thread, "colour").mine, undefined, "this session's one is hidden when it doesn't match");
  assert.equal(pickerLists(prs, thread, "tide").mine?.number, 128);
  assert.equal(pickerLists(prs, thread, "colour").open, 2, "the open count is of every other, not only the ones found");
});

test("A picked pull request offers what the Linked surface's card did: its session, Resolve conflicts, and Merge once it is ready", () => {
  const thread = { id: "t1" };
  assert.deepEqual(prActions(pr(1), thread), ["merge"]);
  assert.deepEqual(prActions(pr(1, { threadId: "t2" }), thread), ["session", "merge"]);
  assert.deepEqual(prActions(pr(1, { threadId: "t1" }), thread), ["merge"], "this session's own has no Open its session");
  assert.deepEqual(prActions(pr(1, { mergeable: "CONFLICTING", threadId: "t2" }), thread), ["session", "resolve"]);
  assert.deepEqual(prActions(pr(1, { isDraft: true }), thread), [], "a draft can't be merged from here");
  assert.deepEqual(prActions(pr(1, { checks: [{ name: "test", state: "pending" }] }), thread), [], "nor one whose checks still run");
  assert.deepEqual(prActions(pr(1, { checks: [{ name: "test", state: "fail" }] }), thread), [], "nor one whose check failed");
  assert.deepEqual(prActions(pr(1, { state: "MERGED", mergeable: "CONFLICTING" }), thread), [], "a merged one has nothing left to do");
});

test("The Linked key opens the picker once: at once when the surface listens, or when it next shows", () => {
  // Nobody listening: the ask waits, and is taken once.
  askPicker("a");
  assert.equal(takePicker("a"), true);
  assert.equal(takePicker("a"), false, "taken twice");
  // Listening: it opens at once, and nothing waits after.
  let opened = 0;
  const off = onPicker("b", () => opened++);
  askPicker("b");
  assert.equal(opened, 1);
  assert.equal(takePicker("b"), false);
  off();
  askPicker("b");
  assert.equal(opened, 1, "a surface that went still hears it");
  assert.equal(takePicker("b"), true);
  // Another session's ask is never this one's.
  askPicker("c");
  assert.equal(takePicker("d"), false);
  assert.equal(takePicker("c"), true);
});

test("Linked pull requests is no surface of its own: its key, ⌘K and a kept layout open Pull request with its picker", () => {
  // A layout kept from before has Pull request in its place, once.
  const kept = openTab(emptyDock(), "linked");
  const now = replaceTab(kept, "linked", "pr");
  assert.deepEqual(now.panes[0].tabs, kept.panes[0].tabs.map((t) => (t === "linked" ? "pr" : t)), "Pull request is not in Linked's place");
  assert.equal(now.panes[0].tab, "pr", "Pull request doesn't show where Linked showed");
  const both = replaceTab(openTab(openTab(emptyDock(), "pr"), "linked"), "linked", "pr").panes[0].tabs;
  assert.equal(both.filter((t) => t === "pr").length, 1, "Pull request twice");
  assert.ok(!both.includes("linked"));
  const session = app("Session.tsx");
  assert.match(session, /dropPopups\(replaceTab\(keptDock\(thread\.id\), "linked", "pr"\)\)/, "a kept layout still opens the Linked surface");
  assert.match(session, /else if \(s\.id === "linked"\) !e\.repeat && \(askPicker\(thread\.id\), setDock\(\(d\) => openTab\(d, "pr"\)\)\)/, "the Linked key doesn't open Pull request with its picker");
  assert.match(session, /tab === "linked" \? \(askPicker\(thread\.id\), setDock\(\(d\) => openTab\(d, "pr"\)\)\)/, "⌘K's Linked row doesn't open Pull request with its picker in an open session");
  assert.match(app("App.tsx"), /else if \(tab === "linked"\) \(askPicker\(id\), openSession\(id, "pr"\)\)/, "⌘K's Linked row doesn't open Pull request with its picker in a session that isn't open");
  const panel = app("Panel.tsx");
  assert.doesNotMatch(panel, /LinkedSurface|t === "linked"/, "the panel still draws the Linked surface");
  assert.doesNotMatch(app("Pr.tsx"), /export function LinkedSurface/, "the Linked surface is still there");
  // The surface takes the ask as it shows and while it is up.
  const pr = app("Pr.tsx");
  assert.match(pr, /onPicker\(thread\.id, \(\) => setPicking\(true\)\)/);
  assert.match(pr, /if \(visible && takePicker\(thread\.id\)\) setPicking\(true\)/);
});
