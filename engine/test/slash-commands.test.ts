import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandsWith, createApi, LINER_COMMANDS } from "../src/api.ts";
import { Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";
import { emptyUsage, type CommandInfo } from "../../contracts/src/index.ts";

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

test("Sending /teamwork <goal> with mode steer while a non-swarm turn runs queues it instead of steering the old turn", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-slash-home-"));
  const proj = mkdtempSync(join(tmpdir(), "lc-slash-proj-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: proj, git: false, createdAt: 1 });
  store.putThread({ id: "t", projectId: "p", title: "Work", agent: "@claude:claude-opus-5-5", status: "running", access: "auto", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  const env = { PATH: "/usr/bin:/bin", HOME: home };
  const runtime = new Runtime(store, env);
  const sent: { text: string; mode: string | undefined }[] = [];
  runtime.send = (async (_id, text, mode) => {
    sent.push({ text, mode });
  }) as typeof runtime.send;
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  try {
    await api.call("thread.send", { id: "t", text: "/teamwork audit the module", mode: "steer" });
    for (let i = 0; i < 100 && !sent.length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(sent, [{ text: "audit the module", mode: "queue" }]);
    assert.equal(store.thread("t").swarm?.enabled, true);
    assert.equal(store.thread("t").swarm?.mode, "teamwork");
    // Once already in the target mode, steer stays steer.
    await api.call("thread.send", { id: "t", text: "/teamwork keep going", mode: "steer" });
    for (let i = 0; i < 100 && sent.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(sent[1], { text: "keep going", mode: "steer" });
  } finally {
    runtime.shutdown();
  }
});
