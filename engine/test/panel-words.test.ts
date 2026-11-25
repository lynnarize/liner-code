/*
  What Changes and the Browser say in the new panel frame (2026-11-25): Changes' foot and files menu
  (ui/src/app/review-words.ts) and the Browser's address list (ui/src/app/browser-list.ts).
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { linesSaid, moreFilesSaid, viewedSaid } from "../../ui/src/app/review-words.ts";
import { elsewhere, runningNote, serverValue } from "../../ui/src/app/browser-list.ts";

test("Changes' foot says how many files are viewed in words, one file as one", () => {
  assert.equal(viewedSaid(1, 2), "1 of 2 files viewed");
  assert.equal(viewedSaid(0, 1), "0 of 1 file viewed");
  assert.equal(viewedSaid(3, 2), "2 of 2 files viewed", "marks kept for files no longer shown count past the total");
});

test("The files menu's foot line says where the files not sent are", () => {
  assert.equal(moreFilesSaid(1, true, "cp1"), "1 more file in this turn isn't shown");
  assert.equal(moreFilesSaid(4, false, "branch"), "4 more files on this branch aren't shown");
  assert.equal(moreFilesSaid(2, false, "all"), "2 more files across all turns aren't shown");
});

test("A question's lines are one line when the range is one line", () => {
  assert.equal(linesSaid({ line: 6 }), "Line 6");
  assert.equal(linesSaid({ line: 6, endLine: 6 }), "Line 6");
  assert.equal(linesSaid({ line: 6, endLine: 8 }), "Lines 6–8");
});

test("A dev server's row ends with its port while it runs, and with where it stands otherwise", () => {
  assert.equal(serverValue({ status: "running", at: 5174, port: 5173 }), ":5174", "a server that moved shows the port it runs on now");
  assert.equal(serverValue({ status: "running", port: 5173 }), ":5173");
  assert.equal(serverValue({ status: "stopped", port: 5173 }), "Not running");
  assert.equal(serverValue({ status: "starting", port: 5173 }), "Starting");
  assert.equal(serverValue({ status: "stopped", port: 5173, ended: { reason: "exit 1", at: 1, failed: true } }), "Stopped with an error");
  assert.equal(serverValue({ status: "stopped", port: 5173, asleep: true, ended: { reason: "slept", at: 1, failed: true } }), "Not running", "one put to sleep while no one looked is not an error");
  assert.equal(serverValue({ status: "stopped", port: 5173, problem: "No command" }), "Can't run");
});

test("Dev servers counts what runs or starts, and says nothing while none does", () => {
  assert.equal(runningNote([{ status: "running" }, { status: "stopped" }]), "1 running");
  assert.equal(runningNote([{ status: "running" }, { status: "starting" }]), "2 running");
  assert.equal(runningNote([{ status: "stopped" }]), undefined);
});

test("Elsewhere on this Mac offers only servers that are no one's in this session, the ones with a page first", () => {
  const list = elsewhere([
    { port: 9000, process: "api", web: false, owner: null },
    { port: 5173, process: "vite", web: true, owner: "session" as const },
    { port: 3000, process: "node", web: true, owner: null },
  ]);
  assert.deepEqual(list.map((p) => p.port), [3000, 9000]);
  assert.deepEqual(elsewhere(null), []);
});
