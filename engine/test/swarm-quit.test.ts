/*
  The engine waits on Runtime.shutdown as it quits, so that every tool it started, and what that tool started, has ended
  first. A team's workers are tools too: their closes were let go unawaited (SwarmManager.dispose), and the engine could
  exit while a worker's CLI and its commands were still being ended, leaving them running until the next launch's sweep.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyUsage } from "../../contracts/src/index.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { OpenOptions, Provider } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test("Quitting waits for a team's waiting workers to close their tools", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-swarm-quit-"));
  const store = new Store(join(dir, "home"));
  store.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Team", agent: "claude", status: "idle", access: "auto", turns: 1, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
  let turned = 0;
  let closed = 0;
  const saved = providers.claude;
  providers.claude = {
    ...saved,
    open: (o: OpenOptions) => ({
      async turn(_prompt, sink) {
        if (o.sidekick) turned++;
        sink.text("looked");
      },
      // A close that takes a moment, as one that ends a process group and what left it does. Only the worker's is counted:
      // its report wakes the session's own turn, which opens a session of its own.
      close: () => new Promise<void>((r) => setTimeout(() => (o.sidekick && closed++, r()), o.sidekick ? 600 : 0)),
    }),
  } as Provider;
  const runtime = new Runtime(store, { PATH: "/nonexistent", HOME: dir } as NodeJS.ProcessEnv);
  runtime.providerInfo = [{ id: "claude", label: "Claude Code", available: true, signedIn: true, models: [{ id: "claude-opus-5-5", label: "Opus", description: "" }] } as never];
  try {
    // Workers stay open a while after a turn (hibernateSec), so one is still live when the engine quits.
    runtime.swarm.enable("t", { enabled: true, maxActive: 2, hibernateSec: 60 });
    const added = await runtime.swarm.handleTool("t", undefined, "swarm_manage", { action: "add", name: "explorer", mode: "read", workspace: "inherit", model: "claude:claude-opus-5-5", brief: "Look around." });
    assert.ok(!added.isError, added.text);
    for (let i = 0; i < 250 && runtime.swarm.snapshot("t")?.members.find((m) => m.name === "explorer")?.state !== "waiting"; i++) await tick();
    assert.equal(turned, 1);
    assert.equal(runtime.swarm.snapshot("t")?.members.find((m) => m.name === "explorer")?.state, "waiting", "the worker is parked with its tool open");
    await runtime.shutdown();
    assert.equal(closed, 1, "the worker's tool had closed by the time the shutdown settled");
  } finally {
    providers.claude = saved;
  }
});
