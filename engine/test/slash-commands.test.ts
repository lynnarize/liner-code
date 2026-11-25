import { test } from "node:test";
import assert from "node:assert/strict";
import { commandsWith, LINER_COMMANDS } from "../src/api.ts";
import type { CommandInfo } from "../../contracts/src/index.ts";

const tool = (name: string): CommandInfo => ({ name, description: `the tool's ${name}`, source: "tool" });

test("The / list names Teamwork and Swarm among Liner Code's own commands, which the engine runs on every tool", () => {
  const names = commandsWith([]).map((c) => c.name);
  assert.ok(names.includes("teamwork"), "/teamwork isn't listed");
  assert.ok(names.includes("swarm"), "/swarm isn't listed");
  assert.ok(LINER_COMMANDS.every((c) => c.source === "liner"));
});

test("A side chat or a scan, which takes no team, lists neither /teamwork nor /swarm", () => {
  const names = commandsWith([tool("compact")], false).map((c) => c.name);
  assert.ok(!names.includes("teamwork") && !names.includes("swarm"));
  assert.ok(names.includes("goal") && names.includes("compact"));
});

test("A tool command with Liner Code's name is listed once, the tool's, whether the answer is fresh or cached", () => {
  const listed = commandsWith([tool("goal"), tool("compact")]);
  assert.equal(listed.filter((c) => c.name === "goal").length, 1, "/goal is listed twice");
  assert.equal(listed.find((c) => c.name === "goal")?.source, "tool");
  // Liner Code's own come first, the tool's after.
  assert.equal(listed[0].source, "liner");
  assert.equal(listed.at(-1)?.name, "compact");
});
