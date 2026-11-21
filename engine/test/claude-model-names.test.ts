import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelInfo } from "../../contracts/src/index.ts";
import { lineupOf } from "../../contracts/src/lineup.ts";
import { claudeModelName, claudeWithOlder, savedModelsNamed } from "../src/providers/claude.ts";

// Claude Code's own rows as its SDK gives them (supportedModels, Claude Code 2.1.3xx).
const OPUS = { id: "claude-opus-5-5", label: "Opus", description: "Opus 5.5 · Best for everyday, complex tasks · $4/$20 per Mtok" };
const FABLE = { id: "claude-fable-5-2", label: "Fable", description: "Fable 5.2 · Most capable for your hardest and longest-running tasks · $8/$40 per Mtok" };
const HAIKU = { id: "claude-haiku-5-5", label: "Haiku", description: "Haiku 5.5 · Fastest for quick answers · $0.10/$0.50 per Mtok ($0.50/$2.50 for prompts over 100k)" };

test("A Claude Code model is named with the version its description starts with, its description is what it is for, and its price is apart", () => {
  assert.deepEqual(claudeModelName(OPUS), { label: "Opus 5.5", description: "Best for everyday, complex tasks", price: { input: "$4", output: "$20" } });
  assert.deepEqual(claudeModelName(FABLE), { label: "Fable 5.2", description: "Most capable for your hardest and longest-running tasks", price: { input: "$8", output: "$40" } });
  assert.deepEqual(claudeModelName(HAIKU), { label: "Haiku 5.5", description: "Fastest for quick answers", price: { input: "$0.10", output: "$0.50", note: "$0.50/$2.50 for prompts over 100k" } });
});

test("A Claude Code description whose last part is no price keeps it, and one that is only a price leaves no description", () => {
  assert.deepEqual(claudeModelName({ id: "claude-opus-5-5", label: "Opus", description: "Opus 5.5 · Best · cheap per token" }), { label: "Opus 5.5", description: "Best · cheap per token" });
  assert.deepEqual(claudeModelName({ id: "claude-opus-5-5", label: "Opus", description: "Opus 5.5 · $4/$20 per Mtok" }), { label: "Opus 5.5", description: "", price: { input: "$4", output: "$20" } });
});

test("A Claude Code model whose description has no version takes it from its id, and a date at the end of the id is not one", () => {
  assert.equal(claudeModelName({ id: "claude-opus-5-5", label: "Opus", description: "Best for everyday tasks" }).label, "Opus 5.5");
  assert.equal(claudeModelName({ id: "claude-sonnet-5", label: "Sonnet", description: "" }).label, "Sonnet 5");
  assert.equal(claudeModelName({ id: "claude-opus-4-5-20251101", label: "Opus", description: "" }).label, "Opus 4.5");
  assert.equal(claudeModelName({ id: "claude-sonnet-20251101", label: "Sonnet", description: "" }).label, "Sonnet", "a date alone gives no version");
  assert.equal(claudeModelName({ id: "claude-opus-5-5", label: "Opus", description: "Opus is the best · for everyday" }).label, "Opus 5.5", "a description that names the model with no version doesn't count");
});

test("A Claude Code model with a 1M context id keeps the tool's words and gets its version after the family", () => {
  const m = claudeModelName({ id: "claude-opus-5-5[1m]", label: "Opus (1M context)", description: "For long sessions" });
  assert.deepEqual(m, { label: "Opus 5.5 (1M context)", description: "For long sessions" });
});

test("A Claude Code model name that already has a version, or that no version can be read for, is left as the tool gives it", () => {
  assert.deepEqual(claudeModelName({ id: "claude-opus-4-1", label: "Opus 4.1", description: "Older · $15/$75 per Mtok" }), { label: "Opus 4.1", description: "Older", price: { input: "$15", output: "$75" } });
  assert.deepEqual(claudeModelName({ id: "claude-opus-5-5", label: "Opus 5.5", description: "Opus 5.5 · Best" }), { label: "Opus 5.5", description: "Best" }, "a description that only repeats the name loses it");
  assert.deepEqual(claudeModelName({ id: "default", label: "Default (recommended)", description: "Use the default model" }), { label: "Default (recommended)", description: "Use the default model" });
  assert.deepEqual(claudeModelName({ id: "claude-3-5-sonnet", label: "Sonnet", description: "" }), { label: "Sonnet", description: "" });
});

test("Naming a Claude Code model twice changes nothing", () => {
  for (const m of [OPUS, FABLE, HAIKU]) {
    const once = claudeModelName(m);
    assert.deepEqual(claudeModelName({ id: m.id, ...once }), once);
  }
});

test("A Claude Code list saved before the names had versions reads with them, for its other accounts too, and another tool's list is as saved", () => {
  const saved = [OPUS, HAIKU].map((m) => ({ ...m, efforts: [], isDefault: m === OPUS || undefined }));
  const named = savedModelsNamed("claude", saved);
  assert.deepEqual(named.slice(0, 2).map((m) => m.label), ["Opus 5.5", "Haiku 5.5"]);
  assert.equal(named[0].isDefault, true, "the rest of the row is kept");
  assert.equal(named[0].description, "Best for everyday, complex tasks", "the price leaves a saved description too");
  assert.deepEqual(named[0].price, { input: "$4", output: "$20" });
  assert.deepEqual(savedModelsNamed("claude", named), named, "reading it twice changes nothing");
  assert.deepEqual(savedModelsNamed("claude.work", saved).slice(0, 2).map((m) => m.label), ["Opus 5.5", "Haiku 5.5"]);
  assert.deepEqual(savedModelsNamed("codex", saved), saved);
});

test("Claude Code's versioned names still sort into one maker with older versions apart", () => {
  const rows = [OPUS, FABLE, HAIKU, { id: "claude-opus-5", label: "Opus", description: "Opus 5 · Older" }].map((m) => ({ ...m, ...claudeModelName(m) }));
  const [group] = lineupOf(rows, (r) => r.label, () => "Anthropic");
  assert.deepEqual(group.newest.map((r) => r.label), ["Opus 5.5", "Fable 5.2", "Haiku 5.5"]);
  assert.deepEqual(group.older.map((r) => r.label), ["Opus 5"]);
});

test("Claude Code's list ends with the older models it still runs, with no effort levels or price Claude Code didn't say for them, and its own newest is not called old", () => {
  const efforts = [{ id: "high", label: "High" }];
  const mine: ModelInfo[] = [
    { ...OPUS, efforts, isDefault: true },
    { ...FABLE, efforts: [], legacy: true },
    { id: "claude-sonnet-5-5", label: "Sonnet", description: "Sonnet 5.5 · Efficient", efforts: [{ id: "low", label: "Low" }] },
    { id: "claude-opus-5", label: "Opus", description: "Opus 5 · The one before · $5/$25 per Mtok", efforts, legacy: true },
  ];
  const all = claudeWithOlder(mine);
  const by = (id: string) => all.find((m) => m.id === id)!;
  assert.deepEqual(all.slice(0, 4).map((m) => m.label), ["Opus 5.5", "Fable 5.2", "Sonnet 5.5", "Opus 5"]);
  for (const id of ["claude-fable-5-1", "claude-fable-5", "claude-opus-4-8", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5"]) {
    assert.equal(by(id).legacy, true, id);
    assert.equal(by(id).efforts, undefined, `${id}: Claude Code didn't describe it, so it has no levels`);
    assert.equal(by(id).defaultEffort, undefined, id);
    assert.equal(by(id).price, undefined, id);
    assert.equal(by(id).isDefault, undefined, id);
  }
  assert.equal(all.filter((m) => m.id === "claude-opus-5").length, 1, "one Claude Code lists itself is not added again");
  assert.equal(by("claude-opus-5").legacy, true, "an older one Claude Code lists stays old");
  assert.deepEqual(by("claude-opus-5").efforts, efforts, "an older one Claude Code describes keeps its own levels");
  assert.deepEqual(by("claude-opus-5").price, { input: "$5", output: "$25" });
  assert.equal(by("claude-fable-5-2").legacy, undefined, "the newest of its family is not old");
  assert.deepEqual(claudeWithOlder(all), all, "running it twice changes nothing");
  assert.deepEqual(claudeWithOlder([]), [], "no list yet stays empty");
  const older = lineupOf(all, (m) => m.label, () => "", (m) => Boolean(m.legacy))[0].older.map((m) => m.label);
  assert.ok(older.includes("Fable 5.1") && older.includes("Opus 4.8") && !older.includes("Fable 5.2"));
});

test("An older Claude model saved with its family's effort levels copied onto it reads with none", () => {
  const efforts = [{ id: "low", label: "Low" }, { id: "high", label: "High" }];
  const saved: ModelInfo[] = [
    { id: "claude-opus-5-5", label: "Opus 5.5", description: "Best for everyday, complex tasks · $4/$20 per Mtok", efforts, defaultEffort: "low", isDefault: true },
    { id: "claude-opus-4-8", label: "Opus 4.8", description: "An older version", efforts, defaultEffort: "low", legacy: true },
  ];
  const named = savedModelsNamed("claude", saved);
  const old = named.find((m) => m.id === "claude-opus-4-8")!;
  assert.equal(old.efforts, undefined);
  assert.equal(old.defaultEffort, undefined);
  assert.equal(old.legacy, true);
  assert.deepEqual(named[0].efforts, efforts, "Claude Code's own model keeps what it said");
});
