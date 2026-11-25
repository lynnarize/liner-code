/*
  A Teamwork or Swarm worker that only reads (an Explorer, the auditor) works in the session's own folder, with no worktree of
  its own. Its tool is opened at Read only, but what the tool hands Liner Code to approve came through the session's level: at
  Auto, an edit or a routine command a reader asked for went ahead, in the person's checkout. These hold it to Read only.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Access } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { ApprovalRequest, OpenOptions, Provider } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

async function team(access: Access) {
  const dir = mkdtempSync(join(tmpdir(), "lc-swarm-reader-"));
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
  const store = new Store(join(dir, "home"));
  store.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Team", agent: "claude", status: "idle", access, turns: 1, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
  const answers: { who: string; access: Access; title: string; allow: boolean }[] = [];
  const asks: ApprovalRequest[] = [
    { tool: "Edit", title: "Edit a.ts", risk: "low", fields: [{ label: "File", value: join(dir, "a.ts") }], rule: "Edit" },
    { tool: "Bash", title: "Run touch b.txt", risk: "low", fields: [{ label: "Command", value: "touch b.txt" }], rule: "touch", unjudged: true },
  ];
  const saved = providers.claude;
  providers.claude = {
    ...saved,
    open: (o: OpenOptions) => ({
      close() {},
      async turn(_prompt, sink, signal) {
        for (const req of asks) {
          const a = await sink.approve(req, signal).catch(() => ({ allow: false }));
          answers.push({ who: o.cwd, access: o.access, title: req.title, allow: a.allow });
        }
        sink.text("done");
      },
    }),
  } as Provider;
  const runtime = new Runtime(store, { PATH: "/nonexistent", HOME: dir } as NodeJS.ProcessEnv);
  runtime.providerInfo = [{ id: "claude", label: "Claude Code", available: true, signedIn: true, models: [{ id: "claude-opus-5-5", label: "Opus", description: "" }] } as never];
  return {
    runtime,
    answers,
    stop: () => {
      providers.claude = saved;
      runtime.swarm.enable("t", { enabled: false });
      runtime.shutdown();
    },
  };
}

test("A Teamwork worker that only reads can't change the session's folder through an ask, even when the session is at Auto", async () => {
  const e = await team("auto");
  try {
    e.runtime.swarm.enable("t", { enabled: true, maxActive: 2, hibernateSec: 0 });
    const added = await e.runtime.swarm.handleTool("t", undefined, "swarm_manage", { action: "add", name: "explorer", mode: "read", workspace: "inherit", model: "claude:claude-opus-5-5", brief: "Look around and report." });
    assert.ok(!added.isError, added.text);
    for (let i = 0; i < 250 && e.answers.length < 2; i++) await tick();
    assert.equal(e.answers.length, 2, "the reader's tool asked both");
    assert.ok(e.answers.every((a) => a.access === "read"), "its tool is opened at Read only");
    assert.deepEqual(e.answers.map((a) => [a.title, a.allow]), [["Edit a.ts", false], ["Run touch b.txt", false]], "neither goes ahead at the session's Auto");
  } finally {
    e.stop();
  }
});

test("A Teamwork worker that writes still has its asks judged at the session's level", async () => {
  const e = await team("auto");
  try {
    e.runtime.swarm.enable("t", { enabled: true, maxActive: 2, hibernateSec: 0 });
    const added = await e.runtime.swarm.handleTool("t", undefined, "swarm_manage", { action: "add", name: "writer", mode: "write", workspace: "inherit", model: "claude:claude-opus-5-5", brief: "Change a.ts." });
    assert.ok(!added.isError, added.text);
    for (let i = 0; i < 250 && e.answers.length < 1; i++) await tick();
    assert.equal(e.answers[0]?.title, "Edit a.ts");
    assert.equal(e.answers[0]?.allow, true, "an edit in the project goes ahead at Auto, as the session's own would");
  } finally {
    e.stop();
  }
});
