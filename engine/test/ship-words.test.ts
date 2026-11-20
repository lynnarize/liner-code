/*
  What the push card says (ui/src/app/ship-words.ts): the count a push carries and which of its stacked words is
  live at each stage, plus the card's source as written. Run with `node --test engine/test/ship-words.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pushCount, shipLive } from "../../ui/src/app/ship-words.ts";

test("a push-only shipment with nothing outgoing counts zero, not one", () => {
  assert.equal(pushCount({ files: 0, rows: 0, commits: 0 }), 0);
});

test("a shipment with files keeps its floor while the commit row is on its way", () => {
  assert.equal(pushCount({ files: 2, rows: 0, commits: 0 }), 1);
});

test("a shipment with files counts its rows once they are there", () => {
  assert.equal(pushCount({ files: 2, rows: 3, commits: 0 }), 3);
});

test("a push-only shipment counts what is outgoing", () => {
  assert.equal(pushCount({ files: 0, rows: 0, commits: 3 }), 3);
});

test("at stage 0 the live words are the chip's x0 and the count m0, nothing else", () => {
  assert.deepEqual(shipLive(0), { h1: false, h2: false, h3: false, m0: true, m1: false, x0: true, x1: false, x2: false, x3: false, x4: false });
});

test("at stage 1 the live words are Committing (h1), the count m0 and x1", () => {
  assert.deepEqual(shipLive(1), { h1: true, h2: false, h3: false, m0: true, m1: false, x0: false, x1: true, x2: false, x3: false, x4: false });
});

test("at stage 2 the live words are Pushing (h2), the count m0 and x2", () => {
  assert.deepEqual(shipLive(2), { h1: false, h2: true, h3: false, m0: true, m1: false, x0: false, x1: false, x2: true, x3: false, x4: false });
});

test("at stage 3 the live words are Pushed (h3), up to date (m1) and x3", () => {
  assert.deepEqual(shipLive(3), { h1: false, h2: false, h3: true, m0: false, m1: true, x0: false, x1: false, x2: false, x3: true, x4: false });
});

test("at stage 4 the live words stay Pushed (h3) and up to date (m1), with the folded chip x4", () => {
  assert.deepEqual(shipLive(4), { h1: false, h2: false, h3: true, m0: false, m1: true, x0: false, x1: false, x2: false, x3: false, x4: true });
});

// The card has no component tests, so its source is read as written (the layout-rules.test.ts pattern).
const shipSource = () => readFileSync(new URL("../../ui/src/app/Ship.tsx", import.meta.url), "utf8");

test("the push card no longer floors a push-only count at one", () => {
  const src = shipSource();
  assert.ok(src.includes("pushCount("), "the card does not take its count from pushCount");
  assert.ok(!src.includes("Math.max(1, s.files ? rows.length : s.commits.length)"), "the card still floors a push-only count at one");
});

test("every stacked stage span in the push card is aria-hidden when not live", () => {
  const src = shipSource();
  const marks = [...src.matchAll(/aria-hidden=\{!live\./g)];
  assert.ok(marks.length >= 10, `only ${marks.length} of the ten stacked spans are aria-hidden when not live`);
  for (const k of ["h1", "h2", "h3", "m0", "m1", "x0", "x1", "x2", "x3", "x4"]) {
    assert.ok(src.includes(`aria-hidden={!live.${k}}`), `the ${k} span is not aria-hidden when not live`);
  }
});
