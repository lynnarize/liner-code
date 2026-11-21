/*
  A tool's model list as the composer's who panel reads it (contracts' lineup.ts): a family is the
  name without its version, the newest of each comes first, and older versions keep apart at the
  end of their maker's group. Run with `node --test engine/test/lineup.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, lineupOf, versionOf } from "../../contracts/src/index.ts";

const byName = (n: string) => n.split(" ")[0].replace(/\d.*$/, "");

test("A version is read from a word of its own, a lettered word and a word glued to the name", () => {
  assert.deepEqual(versionOf("Opus 5.5"), { family: "opus", version: [5, 5] });
  assert.deepEqual(versionOf("Fable 5"), { family: "fable", version: [5] });
  assert.deepEqual(versionOf("Kimi K3.1 Pro"), { family: "kimi k pro", version: [3, 1] });
  assert.deepEqual(versionOf("Qwen3.8 Max"), { family: "qwen max", version: [3, 8] });
  assert.deepEqual(versionOf("GPT-6.1 Sol"), { family: "gpt sol", version: [6, 1] });
  assert.deepEqual(versionOf("DeepSeek V4.1 Flash"), { family: "deepseek v flash", version: [4, 1] });
});

test("A name with no version it can read has none, and a size is never a version", () => {
  assert.equal(versionOf("Big Pickle"), undefined);
  assert.equal(versionOf("Default"), undefined);
  assert.equal(versionOf("Llama 70B"), undefined);
});

test("A version with more parts or a bigger part is the newer one", () => {
  assert.ok(compareVersions([5, 5], [5]) > 0);
  assert.ok(compareVersions([5, 10], [5, 9]) > 0);
  assert.equal(compareVersions([5, 0], [5]), 0);
});

test("Claude Code's newest of each family keep the tool's order, its strongest first, and the older ones follow in the same order", () => {
  const list = ["Fable 5.2", "Opus 5.5", "Sonnet 5.5", "Haiku 5.5", "Fable 5", "Opus 5", "Sonnet 5"];
  const [one, ...more] = lineupOf(list, (n) => n, () => "Claude");
  assert.equal(more.length, 0);
  assert.deepEqual(one.newest, ["Fable 5.2", "Opus 5.5", "Sonnet 5.5", "Haiku 5.5"]);
  assert.deepEqual(one.older, ["Fable 5", "Opus 5", "Sonnet 5"]);
});

test("A tool that lists its models out of version order keeps its order of families, and each family runs newest first", () => {
  const list = ["Opus 5", "Fable 4.5", "Opus 5.5", "Fable 5", "Fable 5.2", "Haiku 5.5"];
  const [one] = lineupOf(list, (n) => n, () => "Claude");
  assert.deepEqual(one.newest, ["Opus 5.5", "Fable 5.2", "Haiku 5.5"]);
  assert.deepEqual(one.older, ["Opus 5", "Fable 5", "Fable 4.5"]);
});

test("A version never ranks one family over another: a lower number named first stays first", () => {
  const [one] = lineupOf(["Kimi K2.7 Code", "Kimi K3", "Kimi K3.1 Pro"], (n) => n, () => "Kimi");
  assert.deepEqual(one.newest, ["Kimi K2.7 Code", "Kimi K3", "Kimi K3.1 Pro"]);
  assert.deepEqual(one.older, []);
});

test("A flash line and a pro line are families of their own, so none of them is older, and makers come in the order the tool names them", () => {
  const list = ["GLM 5.3", "GLM 5.3 Flash", "Kimi K3.1 Pro", "Kimi K3", "Kimi K2.7 Code", "DeepSeek V4.1 Flash", "DeepSeek V4 Pro", "Qwen3.8 Max"];
  const groups = lineupOf(list, (n) => n, byName);
  assert.deepEqual(groups.map((g) => g.maker), ["GLM", "Kimi", "DeepSeek", "Qwen"]);
  assert.ok(groups.every((g) => g.older.length === 0));
  assert.deepEqual(groups.find((g) => g.maker === "Kimi")!.newest, ["Kimi K3.1 Pro", "Kimi K3", "Kimi K2.7 Code"]);
  assert.deepEqual(groups.find((g) => g.maker === "DeepSeek")!.newest, ["DeepSeek V4.1 Flash", "DeepSeek V4 Pro"]);
});

test("An older Kimi K3 goes under its newer K3.1 of the same line", () => {
  const groups = lineupOf(["Kimi K3", "Kimi K3.1"], (n) => n, () => "Kimi");
  assert.deepEqual(groups[0].newest, ["Kimi K3.1"]);
  assert.deepEqual(groups[0].older, ["Kimi K3"]);
});

test("A name it cannot read is its own family, never older, and keeps its place in the tool's order", () => {
  const groups = lineupOf(["Big Pickle", "Opus 5", "Opus 5.5"], (n) => n, () => "");
  assert.deepEqual(groups[0].newest, ["Big Pickle", "Opus 5.5"]);
  assert.deepEqual(groups[0].older, ["Opus 5"]);
});

test("A model its tool calls legacy goes with the older ones whatever its version", () => {
  const groups = lineupOf(["Opus 5.5", "Sonnet 4"], (n) => n, () => "Claude", (n) => n === "Sonnet 4");
  assert.deepEqual(groups[0].newest, ["Opus 5.5"]);
  assert.deepEqual(groups[0].older, ["Sonnet 4"]);
});

test("The same family from two makers is two families, and a group with no maker comes last even when it is named first", () => {
  const groups = lineupOf(["Mystery 3", "Fusion 2", "Fusion 1"], (n) => n, (n) => (n === "Fusion 1" ? "B" : n === "Mystery 3" ? "" : "A"));
  assert.deepEqual(groups.map((g) => g.maker), ["A", "B", ""]);
  assert.ok(groups.every((g) => g.older.length === 0));
});

test("A hyphen between a name and its version reads as a space, so hyphenated names group as newer and older", () => {
  assert.deepEqual(versionOf("GLM-4.5-Air"), { family: "glm air", version: [4, 5] });
  assert.deepEqual(versionOf("DeepSeek-V3.1"), { family: "deepseek v", version: [3, 1] });
  const glm = lineupOf(["GLM-4.6-Air", "GLM-4.5-Air", "GLM-4.6"], (n) => n, () => "GLM");
  assert.deepEqual(glm[0].newest, ["GLM-4.6-Air", "GLM-4.6"]);
  assert.deepEqual(glm[0].older, ["GLM-4.5-Air"]);
  const deepseek = lineupOf(["DeepSeek-V3.1", "DeepSeek-V3"], (n) => n, () => "DeepSeek");
  assert.deepEqual(deepseek[0].newest, ["DeepSeek-V3.1"]);
  assert.deepEqual(deepseek[0].older, ["DeepSeek-V3"]);
});

test("GLM-4.5-Air is its own line beside GLM-4.6, so neither is older than the other", () => {
  const [one] = lineupOf(["GLM-4.6", "GLM-4.5-Air"], (n) => n, () => "GLM");
  assert.deepEqual(one.newest, ["GLM-4.6", "GLM-4.5-Air"]);
  assert.deepEqual(one.older, []);
});

test("GPT-4o is a family of its own and never older than GPT-5", () => {
  assert.equal(versionOf("GPT-4o"), undefined);
  const [one] = lineupOf(["GPT-5", "GPT-4o", "GPT-4.1"], (n) => n, () => "OpenAI");
  assert.deepEqual(one.newest, ["GPT-5", "GPT-4o"]);
  assert.deepEqual(one.older, ["GPT-4.1"]);
});
