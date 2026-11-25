/*
  What the push card says (ui/src/app/ship-words.ts): the count a push carries, its words for that count, and which
  of its stacked parts is live at each stage (checked against app.css's own [data-p] map), plus the card's source as
  written. Run with `node --test engine/test/ship-words.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pushCount, shipLive, shipWords } from "../../ui/src/app/ship-words.ts";

test("a push-only shipment with nothing outgoing counts zero, not one", () => {
  assert.equal(pushCount({ files: 0, commits: 0, listed: false, counted: true }), 0);
});

test("a push-only shipment whose outgoing commits could not be read has no count, so it can't say up to date", () => {
  assert.equal(pushCount({ files: 0, commits: 0, listed: false, counted: false }), null);
});

test("a push-only shipment counts what is outgoing", () => {
  assert.equal(pushCount({ files: 0, commits: 3, listed: false, counted: true }), 3);
});

test("a shipment with files counts every outgoing commit, not only the four rows the card shows", () => {
  assert.equal(pushCount({ files: 2, commits: 6, listed: true, counted: true }), 6);
});

test("a shipment with files counts the commit it makes before git lists it", () => {
  assert.equal(pushCount({ files: 2, commits: 3, listed: false, counted: true }), 4);
  assert.equal(pushCount({ files: 2, commits: 0, listed: false, counted: true }), 1);
});

test("a push with a count says the count; one that carries nothing says up to date", () => {
  assert.deepEqual(shipWords(3, "origin"), { meta: "3 commits to push", pushing: "Pushing 3 commits to origin", pushed: "Pushed 3 commits" });
  assert.deepEqual(shipWords(1, "origin"), { meta: "1 commit to push", pushing: "Pushing 1 commit to origin", pushed: "Pushed 1 commit" });
  assert.deepEqual(shipWords(0, "origin"), { meta: "up to date", pushing: "Pushing to origin", pushed: "Everything is up to date" });
});

test("a push whose count is unknown says it pushed, with no count and never up to date", () => {
  assert.deepEqual(shipWords(null, "origin"), { meta: "", pushing: "Pushing to origin", pushed: "Pushed to origin" });
});

test("a push that publishes a new branch says so, never up to date, even with no commit of its own", () => {
  assert.deepEqual(shipWords(0, "origin", false), { meta: "new on origin", pushing: "Publishing to origin", pushed: "Published to origin" });
  assert.deepEqual(shipWords(2, "origin", false), shipWords(2, "origin"));
});

const none = { h1: false, h2: false, h3: false, m0: false, m1: false, x0: false, x1: false, x2: false, x3: false, x4: false, body: false, msg: false, next: false };

test("at stage 0 the live parts are the chip's x0 and the count m0; the rows are folded away", () => {
  assert.deepEqual(shipLive(0), { ...none, m0: true, x0: true });
});

test("at stage 1 the live parts are Committing (h1), the count m0, x1 and the open rows", () => {
  assert.deepEqual(shipLive(1), { ...none, h1: true, m0: true, x1: true, body: true });
});

test("at stage 2 the live parts are Pushing (h2), the count m0, x2 and the open rows", () => {
  assert.deepEqual(shipLive(2), { ...none, h2: true, m0: true, x2: true, body: true });
});

test("at stage 3 the live parts are Pushed (h3), up to date (m1), x3 and the open rows", () => {
  assert.deepEqual(shipLive(3), { ...none, h3: true, m1: true, x3: true, body: true });
});

test("at stage 4 the rows fold away; the message, the folded chip x4 and the next button are live", () => {
  assert.deepEqual(shipLive(4), { ...none, h3: true, m1: true, x4: true, msg: true, next: true });
});

// The selector each part of the card is shown by in app.css, after `.lc-ship[data-p="N"]` or `.lc-ship:is(…)`.
const PARTS: Record<keyof typeof none, string> = { h1: ".h1", h2: ".h2", h3: ".h3", m0: ".m0", m1: ".m1", x0: ".x0", x1: ".x1", x2: ".x2", x3: ".x3", x4: ".x4", body: ".lc-ship-body", msg: ".lc-ship-msg", next: ".lc-ship-next" };

test("the stage map in shipLive is the one app.css draws, part by part", () => {
  const css = readFileSync(new URL("../../ui/src/app/app.css", import.meta.url), "utf8");
  for (const [part, sel] of Object.entries(PARTS) as [keyof typeof none, string][]) {
    const drawn = new Set<number>();
    for (const line of css.split("\n")) {
      const m = /^\.lc-ship((?:\[data-p="\d"\])|:is\((?:\[data-p="\d"\](?:, )?)+\)) (\S+) ?[{,]$/.exec(line.trim());
      if (m && m[2] === sel) for (const d of m[1].matchAll(/data-p="(\d)"/g)) drawn.add(Number(d[1]));
    }
    assert.ok(drawn.size, `app.css shows ${sel} at no stage`);
    for (let stage = 0; stage <= 4; stage++) assert.equal(shipLive(stage)[part], drawn.has(stage), `${part} at stage ${stage}`);
  }
});

// The card has no component tests, so its source is read as written (the layout-rules.test.ts pattern).
const shipSource = () => readFileSync(new URL("../../ui/src/app/Ship.tsx", import.meta.url), "utf8");

test("the push card takes its count from pushCount and its words from shipWords, with no floor of its own", () => {
  const src = shipSource();
  assert.ok(src.includes("const n = pushCount({"), "the card does not take its count from pushCount");
  assert.ok(src.includes("const words = shipWords(n, remote, s.published !== false);"), "the card does not take its words from shipWords, or not whether the branch is published");
  assert.ok(src.includes("commits: s.outgoing ?? s.commits.length"), "the card counts the thirty listed commits instead of every one the push carries");
  assert.ok(!/Math\.max\(1, (s\.|rows)/.test(src) && !src.includes("rows.length, commits"), "the card floors or caps its count on its own");
  assert.ok(!/plural\(n,/.test(src), "the card says a count in words of its own");
});

test("every stacked stage span in the push card is aria-hidden when not live", () => {
  const src = shipSource();
  for (const k of ["h1", "h2", "h3", "m0", "m1", "x0", "x1", "x2", "x3", "x4"]) {
    assert.ok(src.includes(`className="${k}" aria-hidden={!live.${k}}`), `the ${k} span is not aria-hidden when not live`);
  }
});

test("the finished message, the folded rows and the hidden button stay out of reach until their stage", () => {
  const src = shipSource();
  assert.ok(src.includes(`className="lc-ship-msg" aria-hidden={!live.msg}`), "the Pushed message is read before the push ends");
  assert.ok(src.includes(`className="lc-ship-body" inert={!live.body || undefined}`), "the folded rows are read while folded");
  // The card's buttons are the frame's (PaneButton, RULING 2): the one action ink, Dismiss quiet.
  const buttons = src.split("\n").filter((l) => l.includes("<PaneButton") && l.includes(`className="lc-ship-next"`));
  assert.equal(buttons.length, 2, "the card's next buttons are not where they were");
  for (const b of buttons) assert.ok(b.includes("inert={!live.next || undefined}"), `a hidden next button can be reached: ${b}`);
});
