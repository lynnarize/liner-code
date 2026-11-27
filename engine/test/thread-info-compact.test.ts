/*
  The session details card offers Compact for every tool that compacts on request, a second Claude Code account
  ("claude.work") as much as the first. Run with `node --test engine/test/thread-info-compact.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyUsage } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

test("A session on a second Claude Code account is offered Compact, as one on the first account is", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-info-compact-"));
  const env = { PATH: "/usr/bin:/bin", HOME: dir } as NodeJS.ProcessEnv;
  const store = new Store(join(dir, "home"));
  store.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  for (const [id, agent] of [["first", "@claude:claude-opus-5-5"], ["work", "@claude.work:claude-opus-5-5"]]) store.putThread({ id, projectId: "p", title: "New session", agent, status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
  const runtime = new Runtime(store, env);
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [], put: () => undefined, remove: () => undefined }, terms: {}, logs: {}, proxies: {} } as never);
  try {
    const info = (id: string) => api.call("thread.info", { id } as never) as Promise<{ provider: string; compact: boolean }>;
    assert.equal((await info("first")).compact, true);
    const work = await info("work");
    assert.equal(work.provider, "claude.work");
    assert.equal(work.compact, true, "the second account's session has the Compact button too");
  } finally {
    api.updates.stop();
    runtime.shutdown();
  }
});
