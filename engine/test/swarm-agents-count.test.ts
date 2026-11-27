/*
  A team's rows (the Coordinator and each worker) are written by the swarm, not by a tool's sink, so the session's count of
  agents at work (agentsAtWork) was taken only at a turn's end. That end comes before the coordinator is marked waiting, so
  the count caught the Coordinator row still running and kept "Working · 1 agent" on a finished session for good, on every
  tool (seen first on Antigravity's Teamwork).
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentState, emptyUsage } from "../../contracts/src/index.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { OpenOptions, Provider } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test("A team that has finished leaves no agents counted at work on its session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-swarm-count-"));
  const store = new Store(join(dir, "home"));
  store.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Team", agent: "claude", status: "idle", access: "auto", turns: 1, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  const saved = providers.claude;
  providers.claude = {
    ...saved,
    open: (o: OpenOptions) => ({
      async turn(_prompt, sink) {
        // The worker stays at work until the test lets it go, so the count can be seen while it works.
        if (o.sidekick) await held;
        sink.text(o.sidekick ? "looked" : "noted");
      },
      close: async () => {},
    }),
  } as Provider;
  const runtime = new Runtime(store, { PATH: "/nonexistent", HOME: dir } as NodeJS.ProcessEnv);
  runtime.providerInfo = [{ id: "claude", label: "Claude Code", available: true, signedIn: true, models: [{ id: "claude-opus-5-5", label: "Opus", description: "" }] } as never];
  const running = () => store.timeline("t").filter((x) => x.kind === "tool" && x.agent && agentState(x) === "running").length;
  try {
    runtime.swarm.enable("t", { enabled: true, mode: "teamwork", maxActive: 2, hibernateSec: 60 });
    const added = await runtime.swarm.handleTool("t", undefined, "swarm_manage", { action: "add", name: "explorer", mode: "read", workspace: "inherit", model: "claude:claude-opus-5-5", brief: "Look around." });
    assert.ok(!added.isError, added.text);
    for (let i = 0; i < 250 && runtime.swarm.snapshot("t")?.members.find((m) => m.name === "explorer")?.state !== "working"; i++) await tick();
    for (let i = 0; i < 250 && store.thread("t").agentsAtWork === undefined; i++) await tick();
    assert.equal(store.thread("t").agentsAtWork, running(), "the session counts the team's rows at work while the worker works");
    release();
    // The worker's report wakes the coordinator: a turn of the session's own, which ends with the coordinator marked waiting.
    for (let i = 0; i < 400 && !(runtime.swarm.snapshot("t")?.members.every((m) => m.state !== "working" && m.state !== "queued") && store.thread("t").status !== "running" && store.thread("t").turns > 1); i++) await tick();
    await tick(100);
    assert.equal(running(), 0, "every row of the team reads finished");
    assert.equal(store.thread("t").agentsAtWork, undefined, "and the session counts none at work");
  } finally {
    release();
    await runtime.shutdown();
    providers.claude = saved;
  }
});
