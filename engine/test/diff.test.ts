/*
  The diff behind Changes and Review (ui/src/liner/pro/code-diff/diff.ts). Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSeq } from "../../ui/src/liner/pro/code-diff/diff.ts";

test("a small change keeps what stayed", () => {
  const e = diffSeq(["a", "b", "c"], ["a", "x", "c"]);
  assert.equal(e.filter((x) => x.op === "same").length, 2);
  assert.equal(e.filter((x) => x.op === "del").length, 1);
  assert.equal(e.filter((x) => x.op === "add").length, 1);
});

test("two files rewritten line by line read as one out, one in, without the memory a full diff would take", () => {
  const a = Array.from({ length: 20000 }, (_, i) => `a${i}`);
  const b = Array.from({ length: 20000 }, (_, i) => `b${i}`);
  const before = process.memoryUsage().arrayBuffers;
  const e = diffSeq(["top", ...a, "end"], ["top", ...b, "end"]);
  assert.ok(process.memoryUsage().arrayBuffers - before < 512 * 1024 * 1024);
  assert.equal(e.length, 40002);
  assert.equal(e.filter((x) => x.op === "del").length, 20000);
  assert.equal(e.filter((x) => x.op === "add").length, 20000);
  // Every line of each side is there, in order, so the rows can be drawn from them.
  assert.deepEqual(e.filter((x) => x.op === "del").map((x) => x.a), Array.from({ length: 20000 }, (_, i) => i + 1));
  assert.deepEqual(e.filter((x) => x.op === "add").map((x) => x.b), Array.from({ length: 20000 }, (_, i) => i + 1));
});
