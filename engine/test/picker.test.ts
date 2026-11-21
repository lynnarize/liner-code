/*
  The model picker's rules that hold without a page (ui/src/app/picker.ts): the side card waits for the pointer to rest
  before it turns, a tool's list is grouped by maker or by purpose with the starred first, one model several sources offer
  is one row, and effort and price read only what the tool reported. Run with `node --test engine/test/picker.test.ts`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { aimAt, cardKey, DWELL_MS, dwellAt, effortIn, effortParts, effortShown, fillOf, focusAt, keptLevel, levelName, mergeOffers, pressStop, releaseStop, settingLevel, sliderNow, sourceWriter, startLevel, stopAt, stopKey, stopOf, switchAsChip, switchExtra, toggleStars, toolList, pickerWide, PICKER_WIDE, priceSaid, purposeOf, sectionsOf, settle } from "../../ui/src/app/picker.ts";
import { lineupOf } from "../../contracts/src/lineup.ts";

test("The side card turns to a row only once the pointer has rested on it, so crossing rows on the way to the card leaves it as it was", () => {
  let d = dwellAt(null);
  d = aimAt(d, "a", 0);
  assert.equal(settle(d, DWELL_MS - 1, false).shown, null, "the card turned before the pointer rested");
  // On the way to the card the pointer crosses row b for 40ms, then reaches the card.
  d = aimAt(d, "b", 30);
  d = settle(d, 70, false);
  assert.equal(d.shown, null, "a row crossed on the way took the card");
  assert.equal(settle(d, 30 + DWELL_MS + 50, true).shown, null, "the card turned while the pointer was over it");
  assert.equal(settle(d, 30 + DWELL_MS, false).shown, "b", "a row rested on doesn't take the card");
});

test("Coming back to the same row keeps the time it first came, and leaving the list goes back to the session's own after the same rest", () => {
  let d = aimAt(dwellAt(null), "a", 0);
  d = aimAt(d, "a", 90);
  assert.equal(settle(d, DWELL_MS, false).shown, "a", "a row's rest started again when the pointer moved inside it");
  d = settle(d, DWELL_MS, false);
  d = aimAt(d, null, 200);
  assert.equal(settle(d, 250, false).shown, "a");
  assert.equal(settle(d, 200 + DWELL_MS, false).shown, null, "leaving the list never goes back to the session's own");
});

test("The keyboard on a row turns the card at once", () => {
  assert.deepEqual(focusAt("k"), { shown: "k", aim: "k", at: 0 });
});

test("The picker draws its card at the side only where the window has room for all three parts and a menu's edges", () => {
  assert.equal(PICKER_WIDE, 636);
  assert.equal(pickerWide(656), true);
  assert.equal(pickerWide(655), false);
});

type M = { name: string; maker: string; desc?: string; legacy?: boolean };
const lineup = (ms: M[]) => lineupOf(ms, (m) => m.name, (m) => m.maker, (m) => Boolean(m.legacy));
const shape = (ss: { kind: string; label: string; items: M[] }[]) => ss.map((s) => [s.kind, s.label, s.items.map((m) => m.name)]);

test("A tool whose models come from several makers groups them by maker, in the order the tool first names each, the starred first", () => {
  const ms: M[] = [
    { name: "GLM 5.3", maker: "GLM" },
    { name: "Kimi K3", maker: "Kimi" },
    { name: "GLM 5.3 Flash", maker: "GLM" },
    { name: "DeepSeek V4", maker: "DeepSeek" },
    { name: "Kimi K2", maker: "Kimi" },
  ];
  const { sections, older, makers } = sectionsOf(lineup(ms), { starred: (m) => m.name === "DeepSeek V4", purposeOf: () => "" });
  assert.equal(makers, 2, "a maker all of whose models are starred still counts as a maker of the list");
  assert.deepEqual(shape(sections), [
    ["starred", "Starred", ["DeepSeek V4"]],
    ["maker", "GLM", ["GLM 5.3", "GLM 5.3 Flash"]],
    ["maker", "Kimi", ["Kimi K3"]],
  ]);
  assert.deepEqual(older.map((m) => m.name), ["Kimi K2"], "an older version isn't kept behind its own row");
});

test("A tool of one maker shows each model under what the tool says it is for, with no maker heading, and a model with no purpose under no label", () => {
  const ms: M[] = [
    { name: "Opus 5.5", maker: "Claude", desc: "Best for everyday, complex tasks · $4/$20 per Mtok" },
    { name: "Sonnet 5.5", maker: "Claude", desc: "Efficient for routine tasks" },
    { name: "Sonnet 5.5 Long", maker: "Claude", desc: "Efficient for routine tasks" },
    { name: "Haiku 5.5", maker: "Claude" },
    { name: "Opus 5", maker: "Claude", desc: "An older version", legacy: true },
  ];
  const { sections, older } = sectionsOf(lineup(ms), { starred: () => false, purposeOf: (m) => purposeOf(m.desc) });
  assert.deepEqual(shape(sections), [
    ["purpose", "Best for everyday, complex tasks", ["Opus 5.5"]],
    ["purpose", "Efficient for routine tasks", ["Sonnet 5.5", "Sonnet 5.5 Long"]],
    ["purpose", "", ["Haiku 5.5"]],
  ]);
  assert.deepEqual(older.map((m) => m.name), ["Opus 5"]);
});

test("A starred older version shows with the starred and is not counted again behind Older versions", () => {
  const ms: M[] = [{ name: "Opus 5.5", maker: "Claude" }, { name: "Opus 5", maker: "Claude" }];
  const { sections, older } = sectionsOf(lineup(ms), { starred: (m) => m.name === "Opus 5", purposeOf: () => "x" });
  assert.deepEqual(shape(sections)[0], ["starred", "Starred", ["Opus 5"]]);
  assert.deepEqual(older, []);
});

type O = { ref: string; name: string; src: string };
const oc: O[] = [
  { ref: "opencode:opencode/glm-5.3", name: "GLM-5.3", src: "OpenCode Zen" },
  { ref: "opencode:opencode/big-pickle", name: "Big Pickle", src: "OpenCode Zen" },
  { ref: "opencode:opencode-go/glm-5.3", name: "GLM-5.3", src: "OpenCode Go" },
  { ref: "opencode:opencode-go/kimi-k3", name: "Kimi K3", src: "OpenCode Go" },
];
const merge = (items: O[], kept: Record<string, string> = {}, last?: string) => mergeOffers(items, { keyOf: (o) => `opencode/${o.name}`, refOf: (o) => o.ref, sourceOf: (o) => o.src, remembered: (k) => kept[k], lastSource: () => last });

test("One model a tool offers from two sources is one row, in the order it is first named, the tool's first source running it before any choice", () => {
  const rows = merge(oc);
  assert.deepEqual(rows.map((r) => [r.key, r.pick.ref, r.offers.length]), [
    ["opencode/GLM-5.3", "opencode:opencode/glm-5.3", 2],
    ["opencode/Big Pickle", "opencode:opencode/big-pickle", 1],
    ["opencode/Kimi K3", "opencode:opencode-go/kimi-k3", 1],
  ]);
});

test("The source chosen for a model runs it; with none chosen for it, the source chosen last for any model does", () => {
  assert.equal(merge(oc, {}, "OpenCode Go")[0].pick.ref, "opencode:opencode-go/glm-5.3", "the source chosen last doesn't run a model both offer");
  assert.equal(merge(oc, { "opencode/GLM-5.3": "opencode:opencode/glm-5.3" }, "OpenCode Go")[0].pick.ref, "opencode:opencode/glm-5.3", "the model's own choice doesn't come before the last one");
  // A choice kept for an id the tool no longer lists falls back as if none were kept.
  assert.equal(merge(oc, { "opencode/GLM-5.3": "opencode:gone" })[0].pick.ref, "opencode:opencode/glm-5.3");
});

test("Narrowed to one source, each row is that source's alone", () => {
  const rows = merge(oc.filter((o) => o.src === "OpenCode Go"), { "opencode/GLM-5.3": "opencode:opencode/glm-5.3" });
  assert.deepEqual(rows.map((r) => [r.pick.ref, r.offers.length]), [["opencode:opencode-go/glm-5.3", 1], ["opencode:opencode-go/kimi-k3", 1]]);
});

test("A row says what the tool reports a model costs, Free for nothing, and nothing when it reports none", () => {
  assert.equal(priceSaid({ input: "$4", output: "$20" }), "$4 / $20");
  assert.equal(priceSaid({ input: "$0", output: "$0" }), "Free");
  assert.equal(priceSaid({ input: "$0", output: "$1.40" }), "$0 / $1.40");
  assert.equal(priceSaid(undefined), "");
});

test("A model's effort levels are its own in its tool's order, Claude Code's extras apart after them, and a level it doesn't take shows as the nearest it does", () => {
  const glm = [{ id: "low", label: "low" }, { id: "high", label: "high" }, { id: "max", label: "max" }];
  // GLM-5.3 takes no Medium: a saved Medium runs as the nearest, never offered itself.
  assert.equal(effortIn(glm, "medium", undefined), "low");
  assert.equal(effortIn(glm, "max", undefined), "max");
  // A tool that names no default, and nothing saved it takes or is near: no tick, the tool's own default runs.
  assert.equal(effortIn(glm, undefined, undefined), undefined);
  assert.equal(effortIn(glm, "ultra-special", undefined), undefined);
  assert.equal(effortIn([], "medium", "medium"), undefined, "a model of no levels shows one");
  const claude = [{ id: "low", label: "Low" }, { id: "ultrathink", label: "Ultrathink", extra: true }, { id: "high", label: "High" }, { id: "ultracode", label: "Ultracode" }];
  const { levels, extras } = effortParts(claude);
  assert.deepEqual(levels.map((e) => e.id), ["low", "high"]);
  assert.deepEqual(extras.map((e) => e.id), ["ultrathink", "ultracode"]);
  assert.equal(levelName("minimal"), "Minimal");
});

const glm53 = [{ id: "low", label: "low" }, { id: "high", label: "high" }, { id: "max", label: "max" }];

test("A new session on a model whose tool lists low, high and max asks for its tool's default, else for no level, never for Medium", () => {
  assert.equal(startLevel(glm53, undefined), "", "a fresh session on GLM-5.3 was given a level its tool never listed");
  assert.equal(startLevel(glm53, "high"), "high");
  // A default the tool names but doesn't list for the model is no level of it either.
  assert.equal(startLevel(glm53, "medium"), "");
  assert.equal(startLevel([], "medium"), "", "a model of no levels was given one");
});

test("A level asked for is kept when the model lists it; a preset's word it doesn't list is dropped, and the person's own runs as the nearest it lists", () => {
  assert.equal(keptLevel(glm53, "high", undefined, false), "high", "a preset level the model lists was dropped");
  assert.equal(keptLevel(glm53, "medium", undefined, false), "", "a preset's Medium was saved for a model that has none");
  assert.equal(keptLevel(glm53, "medium", "max", false), "max", "a dropped preset level doesn't fall to the model's default");
  assert.equal(keptLevel(glm53, "medium", undefined, true), "low", "the person's own old choice doesn't run as the nearest level");
  assert.equal(keptLevel([], "high", undefined, true), "", "a level was kept for a model of none");
  assert.equal(keptLevel(glm53, undefined, undefined, false), "");
});

test("The session's own model runs from the source it runs from in Find as in the list, whatever source is kept for the model", () => {
  // The session runs Go's GLM-5.3 while Zen is kept for GLM-5.3: the merged row picks Go's, so picking it never moves the session.
  const rows = mergeOffers(oc, { keyOf: (o) => `opencode/${o.name}`, refOf: (o) => o.ref, sourceOf: (o) => o.src, remembered: () => "opencode:opencode/glm-5.3", current: "opencode:opencode-go/glm-5.3" });
  assert.equal(rows[0].pick.ref, "opencode:opencode-go/glm-5.3", "a row ticked as the session's would move it to another source");
  // A model the session doesn't run keeps the source kept for it.
  assert.equal(mergeOffers(oc, { keyOf: (o) => `opencode/${o.name}`, refOf: (o) => o.ref, sourceOf: (o) => o.src, remembered: () => "opencode:opencode/glm-5.3", current: "opencode:opencode-go/kimi-k3" })[0].pick.ref, "opencode:opencode/glm-5.3");
});

type L = O & { legacy?: boolean };
const ocAll: L[] = [...oc, { ref: "opencode:opencode/glm-4.6", name: "GLM-4.6", src: "OpenCode Zen", legacy: true }, { ref: "opencode:opencode-go/kimi-k2", name: "Kimi K2", src: "OpenCode Go", legacy: true }];
const listOf = (source: string | null, favs: string[] = []) => toolList(ocAll, { source, sourceOf: (o) => o.src, merge: (items) => mergeOffers(items, { keyOf: (o) => `opencode/${o.name}`, refOf: (o) => o.ref, sourceOf: (o) => o.src }), nameOf: (o) => o.name, makerOf: (o) => (o.name.startsWith("Kimi") ? "Kimi" : o.name.startsWith("GLM") ? "GLM" : "OpenCode"), legacy: (o) => Boolean(o.legacy), starred: (o) => favs.includes(o.ref), purposeOf: () => "" });

test("Narrowed to one source, the older versions behind their row and the tool's count are that source's alone", () => {
  const go = listOf("OpenCode Go");
  assert.deepEqual(go.older.map((r) => r.pick.ref), ["opencode:opencode-go/kimi-k2"], "Zen's older models are offered while the switch is on Go");
  assert.equal(go.count, 3, "the count counts what the switch leaves out");
  const all = listOf(null);
  assert.deepEqual(all.older.map((r) => r.pick.ref).sort(), ["opencode:opencode-go/kimi-k2", "opencode:opencode/glm-4.6"]);
  assert.equal(all.count, 5, "a model two sources offer is counted twice");
});

test("A row offered by two sources is starred when either id is, whatever the switch, and its star acts on both ids together", () => {
  const goOnly = listOf("OpenCode Go", ["opencode:opencode/glm-5.3"]);
  assert.equal(goOnly.sections[0].kind, "starred", "a model starred from Zen isn't under Starred while the switch is on Go");
  assert.deepEqual(goOnly.sections[0].items.map((r) => r.pick.ref), ["opencode:opencode-go/glm-5.3"]);
  const both = ["opencode:opencode/glm-5.3", "opencode:opencode-go/glm-5.3"];
  assert.deepEqual(toggleStars([], both), both, "starring a row stars one of its ids");
  assert.deepEqual(toggleStars(["x", "opencode:opencode/glm-5.3"], both), ["x"], "unstarring a row leaves one of its ids starred");
});

test("With the rail on another tool and nothing pointed at, the side card shows nothing of the session's, never another tool's would-be pair", () => {
  assert.equal(cardKey(null, "fusion", "codex", "claude"), null, "the card stood in another tool's pair for the session's");
  assert.equal(cardKey(null, "fusion", "claude", "claude"), "fusion");
  assert.equal(cardKey("fusion", "fusion", "codex", "claude"), "fusion", "a tool's Fusion row pointed at doesn't show its pair");
  assert.equal(cardKey(null, "claude:opus", "claude", undefined), "claude:opus", "a place with no tool of its own shows its pick");
});

test("A tool's source switch is buttons up to All and two sources, and one chip past that", () => {
  assert.equal(switchAsChip(2), false);
  assert.equal(switchAsChip(3), true, "three sources overflow the middle card as buttons");
});

test("Two quick source choices both stay, though the engine's copy hasn't caught up with the first when the second is written", async () => {
  const stored: Record<string, string> = { "switch:opencode": "OpenCode Go" };
  const sent: Record<string, string>[] = [];
  // The engine answers later; until then the app's copy stays as it was.
  const keep = sourceWriter(() => stored, (next) => (sent.push(next), Promise.resolve(next)));
  const one = keep({ "opencode/GLM-5.3": "opencode:opencode/glm-5.3" });
  const two = keep({ "last:opencode": "OpenCode Zen" });
  await Promise.all([one, two]);
  assert.deepEqual(sent[1], { "switch:opencode": "OpenCode Go", "opencode/GLM-5.3": "opencode:opencode/glm-5.3", "last:opencode": "OpenCode Zen" }, "the second choice lost the first");
  // What the engine kept is what the next choice builds on: an entry it dropped (it keeps only so many) stays dropped.
  const kept: Record<string, string> = { "last:opencode": "OpenCode Zen" };
  const trim = sourceWriter(() => stored, (next) => (sent.push(next), Promise.resolve(kept)));
  await trim({ "switch:opencode": undefined });
  await trim({ "switch:opencode": "OpenCode Zen" });
  assert.deepEqual(sent.at(-1), { "last:opencode": "OpenCode Zen", "switch:opencode": "OpenCode Zen" }, "an entry the engine dropped came back");
});

// Claude Code's list for a model with extra high, as claude.ts claudeRow builds it: its levels, then Ultracode and Ultrathink.
const opus = [{ id: "low", label: "Low" }, { id: "medium", label: "Medium" }, { id: "high", label: "High" }, { id: "xhigh", label: "Extra high" }, { id: "max", label: "Max" }, { id: "ultracode", label: "Ultracode", extra: true }, { id: "ultrathink", label: "Ultrathink", extra: true }];
const opusLevels = effortParts(opus).levels;

test("A level's stop on the Effort slider is its place among the model's own levels, the extras never a stop", () => {
  assert.equal(stopOf(opusLevels, "low"), 0);
  assert.equal(stopOf(opusLevels, "max"), 4);
  assert.equal(stopOf(opusLevels, "ultracode"), -1, "an extra became a stop of the slider");
  assert.equal(stopOf(opusLevels, ""), -1);
  assert.equal(stopOf(opusLevels, undefined), -1);
  assert.equal(stopOf(glm53, "medium"), -1, "a level the model lacks found a stop");
});

test("The Effort slider shows what the engine runs: an empty track for the tool's own default, the nearest level for one the model lacks, Extra high under Ultracode and the tool's default under Ultrathink", () => {
  assert.deepEqual(effortShown(opus, "", undefined), { at: -1, level: undefined, extra: undefined, chosen: false }, "the tool's own default drew a knob");
  assert.deepEqual(effortShown(opus, undefined, undefined), { at: -1, level: undefined, extra: undefined, chosen: false });
  // A tool that names its default fills to it before anyone picks, and a press there picks it rather than taking it back.
  assert.deepEqual(effortShown(glm53, "", "high"), { at: 1, level: "high", extra: undefined, chosen: false });
  assert.deepEqual(effortShown(opus, "high", undefined), { at: 2, level: "high", extra: undefined, chosen: true });
  // GLM-5.3 has no Medium: a saved Medium runs as Low, as runtime.ts effortFor resolves it, and Low was never chosen there.
  assert.deepEqual(effortShown(glm53, "medium", undefined), { at: 0, level: "low", extra: undefined, chosen: false });
  // claude.ts sdkEffort sends "xhigh" with ultracode on.
  assert.deepEqual(effortShown(opus, "ultracode", undefined), { at: 3, level: "xhigh", extra: "ultracode", chosen: false }, "Ultracode doesn't show the level it runs at");
  // Ultrathink sends no level (sdkEffort gives none), only its word in each message: the tool's own default runs.
  assert.deepEqual(effortShown(opus, "ultrathink", undefined), { at: -1, level: undefined, extra: "ultrathink", chosen: false }, "Ultrathink shows a level the engine doesn't send");
  // An extra's word on a model that doesn't list it is no extra there.
  assert.equal(effortShown(glm53, "ultracode", undefined).extra, undefined);
  assert.deepEqual(effortShown([], "high", undefined), { at: -1, level: undefined, extra: undefined, chosen: false }, "a model of no levels shows one");
});

test("A press on a stop picks its level, the level asked for pressed again goes back to the tool's own default, and with an extra on any stop is a level picked", () => {
  assert.equal(pressStop(opusLevels, effortShown(opus, "", undefined), 1), "medium");
  assert.equal(pressStop(opusLevels, effortShown(opus, "medium", undefined), 1), "", "the level in use pressed again doesn't go back to the tool's default");
  assert.equal(pressStop(opusLevels, effortShown(opus, "medium", undefined), 2), "high");
  assert.equal(pressStop(opusLevels, effortShown(opus, "ultracode", undefined), 3), "xhigh", "Extra high pressed under Ultracode left Ultracode on");
  assert.equal(pressStop(glm53, effortShown(glm53, "", "high"), 1), "high", "the tool's named default pressed was taken back instead of picked");
  assert.equal(pressStop(opusLevels, effortShown(opus, "", undefined), 9), undefined);
});

test("An extra switched on is the session's one effort, and switched off goes back to the level picked before it, else to the tool's own default", () => {
  let effort = "high";
  const before = effortShown(opus, effort, undefined).level;
  effort = switchExtra("ultracode", true, before);
  assert.equal(effort, "ultracode");
  // Ultrathink on turns Ultracode off: the engine holds one value.
  effort = switchExtra("ultrathink", true, before);
  assert.equal(effort, "ultrathink");
  assert.equal(switchExtra("ultrathink", false, before), "high", "an extra switched off didn't go back to the level before it");
  assert.equal(switchExtra("ultracode", false, undefined), "", "with no level known an extra switched off didn't go back to the tool's own default");
});

test("A pointer along the Effort track picks the stop it is in, for one, two, three and five stops, the ends taking what lies past them", () => {
  assert.equal(stopAt(0, 240, 1), 0);
  assert.equal(stopAt(239, 240, 1), 0);
  assert.equal(stopAt(119, 240, 2), 0);
  assert.equal(stopAt(120, 240, 2), 1);
  assert.equal(stopAt(79, 240, 3), 0);
  assert.equal(stopAt(80, 240, 3), 1);
  assert.equal(stopAt(200, 240, 3), 2);
  assert.deepEqual([0, 47, 48, 100, 150, 239, 240].map((x) => stopAt(x, 240, 5)), [0, 0, 1, 2, 3, 4, 4]);
  assert.equal(stopAt(-30, 240, 5), 0, "a drag past the left end picked nothing");
  assert.equal(stopAt(400, 240, 5), 4, "a drag past the right end picked nothing");
  assert.equal(stopAt(10, 240, 0), -1);
  assert.equal(fillOf(-1, 5), 0, "an empty track was filled");
  assert.equal(fillOf(4, 5), 1);
  assert.equal(fillOf(0, 1), 1);
});

test("On the Effort slider Left and Right step a level, Home and End go to the ends, Delete goes back to the tool's default, and Up and Down are left to the card", () => {
  assert.equal(stopKey("ArrowRight", 1, 5), 2);
  assert.equal(stopKey("ArrowLeft", 1, 5), 0);
  assert.equal(stopKey("ArrowLeft", 0, 5), 0);
  assert.equal(stopKey("ArrowRight", 4, 5), 4);
  assert.equal(stopKey("ArrowRight", -1, 5), 0, "Right on an empty track didn't start at the lowest");
  assert.equal(stopKey("Home", 3, 5), 0);
  assert.equal(stopKey("End", 0, 5), 4);
  assert.equal(stopKey("Delete", 2, 5), "own");
  assert.equal(stopKey("Backspace", 2, 5), "own");
  assert.equal(stopKey("ArrowUp", 2, 5), undefined, "Up was taken from the card's walk between its parts");
  assert.equal(stopKey("ArrowDown", 2, 5), undefined);
});

test("On a model's card that doesn't hold the effort, the level carried over shows but a press or a drag onto it picks that model at it, never its own default", () => {
  // The session runs Opus at High; Sonnet's card shows High too, carried over, not chosen for Sonnet.
  const carried = effortShown(opus, "high", undefined, false);
  assert.deepEqual(carried, { at: 2, level: "high", extra: undefined, chosen: false }, "another model's card marks the session's level as chosen there");
  assert.equal(pressStop(opusLevels, carried, 2), "high", "a press on the carried level picked the model at its own default");
  assert.equal(releaseStop(opusLevels, carried, 0, 2, true), "high", "a drag released on the carried level picked nothing");
  assert.equal(releaseStop(opusLevels, carried, 2, 2, false), "high");
  // Another tool's Fusion card: Settings' pair level shown, a press makes the pair at it.
  assert.equal(pressStop(glm53, effortShown(glm53, "high", undefined, false), 1), "high", "Fusion's card for another tool made the pair at the tool's default");
  // Where the effort is held, the chosen level pressed again goes back to the tool's own, and a drag back onto it does nothing.
  const held = effortShown(opus, "high", undefined);
  assert.equal(pressStop(opusLevels, held, 2), "");
  assert.equal(releaseStop(opusLevels, held, 0, 2, true), undefined);
  assert.equal(releaseStop(opusLevels, held, 2, 3, true), "xhigh");
  assert.equal(releaseStop(opusLevels, effortShown(opus, "ultracode", undefined), 0, 3, true), "xhigh", "a drag onto Extra high under Ultracode left Ultracode on");
  assert.equal(releaseStop(opusLevels, held, 2, 9, true), undefined);
});

test("The tool's named default shows unchosen while the stored word is empty, so a press picks it and a switch turned off goes back to the empty word", () => {
  // The stored "" goes in (not the default it resolves to): the default fills, unchosen.
  const own = effortShown(glm53, "", "high");
  assert.equal(own.chosen, false, "the tool's default reads as a level chosen");
  assert.equal(pressStop(glm53, own, 1), "high", "the default pressed sent the empty word again");
  // Nothing was chosen, so the level remembered for a switch stays unknown and off goes back to "".
  assert.equal(switchExtra("ultrathink", false, own.chosen ? own.level : undefined), "", "a switch turned off saved the tool's default as a level picked");
});

test("The Effort slider always has an aria-valuenow, the lowest stop on an empty track where its text says the tool's own default", () => {
  assert.equal(sliderNow(-1), 0, "an empty track left the slider without a value");
  assert.equal(sliderNow(0), 0);
  assert.equal(sliderNow(3), 3);
});

test("Settings saves the tool's own default for the lead's effort as no word, which the engine takes, never the empty word it refuses", () => {
  assert.equal(settingLevel(""), null, "the lead's own default was sent as \"\", which settings.save refuses");
  assert.equal(settingLevel("high"), "high");
  assert.equal(settingLevel("ultracode"), "ultracode");
});
