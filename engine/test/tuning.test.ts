/*
  How a pair works (contracts' tuning.ts): the class of a sidekick from the lists and from where the
  person moved it, a model no list knows, and the ways a pair resolves to from the class, Settings
  and the session's own, with only real changes counted as its own. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLASS_WAYS, placedOf, sidekickClassOf, waysOf } from "../../contracts/src/index.ts";

const OPUS = "claude:claude-opus-5-5";
const SONNET = "claude:claude-sonnet-5-5";
const SOL = "codex:gpt-6-sol";
const ASTRA = "codex:gpt-6-astra";
const FLASH = "opencode:deepseek-v4.1-flash";
const UNKNOWN = "endpoint:acme-coder-7";

test("a sidekick's class comes from the lists: Sol and Sonnet mid, Astra frontier, Flash small", () => {
  assert.equal(sidekickClassOf(SONNET), "mid");
  assert.equal(sidekickClassOf(SOL), "mid", "Sol is frontier-class and quicker, and mid as a sidekick");
  assert.equal(sidekickClassOf("codex:gpt-6-sol-pro"), "frontier", "Sol Pro isn't MID's");
  assert.equal(sidekickClassOf(ASTRA), "frontier");
  assert.equal(sidekickClassOf(OPUS), "frontier");
  assert.equal(sidekickClassOf(FLASH), "small");
  assert.equal(sidekickClassOf("codex:gpt-6-luna"), "small");
  assert.equal(sidekickClassOf(`@${SONNET}`), "mid", "a bare model reads like its ref");
});

test("a person's move comes first", () => {
  assert.equal(sidekickClassOf(FLASH, { [FLASH]: "mid" }), "mid");
  assert.equal(sidekickClassOf(OPUS, { [OPUS]: "small" }), "small");
  assert.equal(sidekickClassOf(SONNET, { [OPUS]: "small" }), "mid", "another model's move changes nothing");
});

test("a model no list knows isn't placed, and is small", () => {
  assert.equal(placedOf(UNKNOWN), false);
  assert.equal(sidekickClassOf(UNKNOWN), "small");
  for (const ref of [OPUS, SONNET, SOL, FLASH]) assert.equal(placedOf(ref), true, ref);
  // By maker and name: a Sonnet by name from a maker that isn't Anthropic's isn't Sonnet.
  assert.equal(placedOf("endpoint:qwen-sonnet-clone"), false);
  assert.equal(waysOf(OPUS, UNKNOWN, {}).placed, false);
  assert.equal(waysOf(OPUS, UNKNOWN, { classes: { [UNKNOWN]: "mid" } }).cls, "mid", "placed by the person, it takes that class");
});

test("each class's ways, with nothing changed", () => {
  for (const [sidekick, cls] of [[FLASH, "small"], [SONNET, "mid"], [ASTRA, "frontier"]] as const) {
    const ways = waysOf(OPUS, sidekick, {});
    assert.deepEqual(ways, { cls, placed: true, ...CLASS_WAYS[cls], handOver: "default", firm: false, own: [] }, sidekick);
  }
  assert.deepEqual(CLASS_WAYS.small, { brief: "exact", explore: "none", review: "all", takeBack: 1 });
  assert.deepEqual(CLASS_WAYS.mid, { brief: "scoped", explore: "bounded", review: "diff", takeBack: 2 });
  assert.deepEqual(CLASS_WAYS.frontier, { brief: "open", explore: "open", review: "risk", takeBack: 2 });
});

test("a lead that isn't frontier-class is told firmly to hand over, unless the person said how", () => {
  assert.equal(waysOf(SONNET, FLASH, {}).firm, true);
  assert.equal(waysOf("opencode:deepseek-v4.1-flash", FLASH, {}).firm, true);
  assert.equal(waysOf(`@${OPUS}`, FLASH, {}).firm, false);
  assert.equal(waysOf(SONNET, FLASH, { handOver: "default" }).firm, false, "By default in Settings is said plainly");
  const asked = waysOf(SONNET, FLASH, { handOver: "asked" });
  assert.equal(asked.handOver, "asked");
  assert.equal(asked.firm, false);
  assert.deepEqual(asked.own, [], "Settings' word isn't the session's own");
});

test("the session's own goes on top, and only real changes count as its own", () => {
  const ways = waysOf(OPUS, FLASH, {}, { brief: "scoped", review: "all", takeBack: 2, handOver: "asked" });
  assert.equal(ways.brief, "scoped");
  assert.equal(ways.review, "all");
  assert.equal(ways.takeBack, 2);
  assert.equal(ways.handOver, "asked");
  assert.equal(ways.explore, "none", "an unset key stays automatic");
  assert.deepEqual(ways.own, ["brief", "takeBack", "handOver"], "review all is a small sidekick's anyway");
  // Over Settings: the session's "default" against Settings' "asked" is its own, and the person's word, so not firm.
  const back = waysOf(SONNET, FLASH, { handOver: "asked" }, { handOver: "default" });
  assert.equal(back.handOver, "default");
  assert.deepEqual(back.own, ["handOver"]);
  assert.equal(back.firm, false);
  // The class is resolved first, so the session's keys are measured against a moved model's class.
  assert.deepEqual(waysOf(OPUS, FLASH, { classes: { [FLASH]: "frontier" } }, { brief: "open", explore: "none" }).own, ["explore"]);
});
