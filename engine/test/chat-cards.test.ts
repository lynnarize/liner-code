/*
  The cards at the end of the chat and the Session popup's words, without a page (ui/src/app/chat-cards.ts and
  session-pop.ts): which plan is the Plan card and when its finished steps fold, each card's folded line, a team's
  counts and tree, a hand-over said in one row, the agents that worked and the Spend limit's value.
  Run with `node --test engine/test/chat-cards.test.ts`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Item, PlanEntry, SwarmMember } from "../../contracts/src/index.ts";
import { crewCounts, firstSentence, lineCount, planCard, planCount, planLine, reportHead, teamCounts, teamLine, teamTree } from "../../ui/src/app/chat-cards.ts";
import { agentsWorked, spendWords } from "../../ui/src/app/session-pop.ts";

const turn = (n: number, status = "done"): Item => ({ kind: "turn", id: `t${n}`, turn: n, at: n, agent: "demo", model: "demo:demo", status }) as unknown as Item;
const user = (n: number): Item => ({ kind: "user", id: `u${n}`, turn: n, at: n, text: "next" }) as unknown as Item;
const plan = (n: number, entries: PlanEntry[]): Item => ({ kind: "plan", id: `p${n}`, turn: n, at: n, entries }) as unknown as Item;
const step = (title: string, status: PlanEntry["status"], owner?: string): PlanEntry => ({ title, status, ...(owner ? { owner } : {}) }) as PlanEntry;
const never = () => false;

test("The Plan card is the newest plan, while its turn is the newest or steps are left to do", () => {
  const steps = [step("Read how it is drawn", "completed"), step("Make it 3D", "in_progress")];
  const items = [turn(1), plan(1, steps)];
  assert.equal(planCard(items, never)?.plan.id, "p1");
  // A newer message, and the plan still has steps: it stays the card, its finished steps folding.
  const later = [...items, user(2), turn(2, "running")];
  assert.equal(planCard(later, never)?.plan.id, "p1", "an unfinished plan left the end of the chat when you sent a new message");
  assert.equal(planCard(later, never)?.foldDone, true, "finished steps don't fold once you have sent a newer message");
  assert.equal(planCard(items, never)?.foldDone, false, "finished steps fold before you have said anything new");
  // Every step done and a newer turn: it goes back to its own turn.
  const done = [turn(1), plan(1, [step("One", "completed")]), user(2), turn(2)];
  assert.equal(planCard(done, never), null, "a finished plan of an older turn stays at the chat's end for ever");
  // A plan whose run was stopped stays in its turn once a newer turn starts.
  assert.equal(planCard(later, () => true), null, "a stopped plan was lifted to the end of a newer turn");
  assert.equal(planCard([turn(1)], never), null);
});

test("A folded Plan says the step at work, else the next, and counts what is done", () => {
  assert.equal(planLine([step("Read it", "completed"), step("The menu turns wind on", "in_progress")]), "Now: the menu turns wind on");
  assert.equal(planLine([step("Read it", "completed"), step("Add a slider", "pending")]), "Next: add a slider");
  assert.equal(planLine([step("Read it", "completed")]), "Every step is done");
  assert.equal(planLine([step("NOAA feed", "in_progress")]), "Now: NOAA feed", "an acronym lost its capitals");
  assert.equal(planCount([step("a", "completed"), step("b", "pending")]), "1 of 2 done");
  assert.equal(planCount([step("a", "completed")]), "All 1 done");
});

const member = (name: string, state: SwarmMember["state"], more: Partial<SwarmMember> = {}) => ({ name, role: name, model: "demo:demo", state, workspace: "inherit", mode: "read", channels: ["main"], brief: "", lastReadSeq: 0, tokens: 0, costUsd: 0, ...more }) as SwarmMember;

test("A team's card counts its members the way the board does, the coordinator left out", () => {
  const team = [member("coordinator", "working"), member("scout", "working", { now: "Reading src/scene.js" }), member("build", "working"), member("settings", "queued"), member("qa", "queued"), member("gone", "killed")];
  assert.equal(teamCounts(team), "2 working, 2 wait for a slot");
  assert.equal(teamCounts([member("a", "hibernated"), member("b", "stopped")]), "1 parked, 1 stopped");
  assert.equal(teamCounts([member("coordinator", "working")]), "", "a team with no worker said it had some");
  assert.equal(teamLine(team), "@scout: reading src/scene.js");
  assert.equal(teamLine([member("a", "queued")]), "");
});

test("The agents popup's tree nests a team under who sent it and folds the finished on each level", () => {
  const team = [
    member("coordinator", "working"),
    member("planner", "stopped"),
    member("scene", "working"),
    member("wind", "working", { parent: "scene" }),
    member("leaves", "stopped", { parent: "scene" }),
    member("trunk", "stopped", { parent: "scene" }),
    member("orphan", "waiting", { parent: "nobody" }),
    member("gone", "killed"),
  ];
  const tree = teamTree(team);
  assert.deepEqual(tree.kids.map((n) => n.m.name), ["scene", "orphan"], "a member whose parent is gone didn't go under the coordinator");
  assert.deepEqual(tree.finished.map((m) => m.name), ["planner"]);
  const scene = tree.kids[0];
  assert.deepEqual(scene.kids.map((n) => n.m.name), ["wind"]);
  assert.deepEqual(scene.finished.map((m) => m.name), ["leaves", "trunk"], "the finished under an agent did not fold to one row");
});

test("A report reads as one row: who to whom, its first sentence and how long it is", () => {
  const r = { from: "planner", to: "coordinator", text: "@coordinator Six steps; the scene and the menu can be built side by side. Then more.\nSecond line.", lines: 28 };
  assert.equal(reportHead(r), "@planner reported to Coordinator");
  assert.equal(reportHead({ ...r, from: "settings", to: "build3d" }), "@settings handed over to @build3d");
  assert.equal(firstSentence(r.text), "Six steps; the scene and the menu can be built side by side.");
  assert.equal(firstSentence("- **Done** with `scene.js`"), "Done with scene.js");
  assert.equal(lineCount(r), 28);
});

test("The Session popup counts the agents that worked and says the Spend limit as a value", () => {
  const task = (id: string, status: string, seconds: number, at = 0) => ({ kind: "tool", id, turn: 1, at, tool: "Agent", title: "Explore", toolKind: "task", status, seconds }) as unknown as Item;
  const worked = agentsWorked([turn(1), task("a", "done", 4), task("b", "done", 5), { kind: "tool", id: "c", turn: 1, at: 0, tool: "Read", title: "Read", toolKind: "read", status: "done" } as unknown as Item, task("d", "running", 0, 1000)], 3000);
  assert.deepEqual(worked, { count: 3, seconds: 11 });
  assert.deepEqual(agentsWorked([turn(1)]), { count: 0, seconds: 0 });
  assert.equal(spendWords(undefined, 0), "None");
  assert.equal(spendWords(5, 0), "$5.00");
  assert.equal(spendWords(5, 2), "$5.00, 40% used");
  assert.equal(spendWords(150, 15), "$150, 10% used");
});

test("A plain crew folded to one line counts who works and who finished, and says nothing while none works", () => {
  assert.equal(crewCounts(2, 1), "2 working, 1 finished");
  assert.equal(crewCounts(1, 0), "1 working", "a crew with nothing finished still said how many finished");
  assert.equal(crewCounts(0, 3), "", "a crew with no one at work still had a line, though its card is gone");
});
