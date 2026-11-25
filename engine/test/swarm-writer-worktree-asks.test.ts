/*
  A Swarm or Teamwork writer with workspace "share" works in its own git worktree, apart from the person's checkout. What its tool
  hands Liner Code to approve was judged against the session's folder, though: at Auto, `touch <the checkout>/escape-marker` read
  as routine in-folder work and ran with no ask, on the real Claude Code CLI. These judge a writer's asks against its worktree.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Access } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { ApprovalRequest, OpenOptions, Provider } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

async function team(access: Access) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lc-swarm-writer-")));
  const home = realpathSync(mkdtempSync(join(tmpdir(), "lc-swarm-writer-home-")));
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
  const g = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "ignore" });
  g("init", "-q");
  g("add", "a.ts");
  g("commit", "-q", "-m", "a");
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: true, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Team", agent: "claude", status: "idle", access, turns: 1, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
  const answers: { title: string; allow: boolean }[] = [];
  let workerCwd = "";
  const saved = providers.claude;
  providers.claude = {
    ...saved,
    open: (o: OpenOptions) => ({
      close() {},
      async turn(_prompt, sink, signal) {
        workerCwd = o.cwd;
        // Asked all at once, so one that waits on a card doesn't keep the others from being judged.
        const asks: ApprovalRequest[] = [
          { tool: "Bash", title: "Run touch inside.txt", risk: "low", fields: [{ label: "Command", value: "touch inside.txt" }], rule: "touch", unjudged: true },
          { tool: "Edit", title: "Edit a.ts in the worktree", risk: "low", fields: [{ label: "File", value: join(o.cwd, "a.ts") }], rule: "Edit" },
          { tool: "Bash", title: "Run touch escape-marker in the checkout", risk: "low", fields: [{ label: "Command", value: `touch ${join(dir, "escape-marker")}` }], rule: "touch", unjudged: true },
          { tool: "Edit", title: "Edit a.ts in the checkout", risk: "low", fields: [{ label: "File", value: join(dir, "a.ts") }], rule: "Edit" },
        ];
        await Promise.all(asks.map((req) => sink.approve(req, signal).catch(() => ({ allow: false })).then((a) => void answers.push({ title: req.title, allow: a.allow }))));
        sink.text("done");
      },
    }),
  } as Provider;
  const runtime = new Runtime(store, { PATH: process.env.PATH, HOME: home } as NodeJS.ProcessEnv);
  runtime.providerInfo = [{ id: "claude", label: "Claude Code", available: true, signedIn: true, models: [{ id: "claude-opus-5-5", label: "Opus", description: "" }] } as never];
  return {
    dir,
    store,
    runtime,
    answers,
    workerCwd: () => workerCwd,
    stop: () => {
      providers.claude = saved;
      runtime.swarm.enable("t", { enabled: false });
      runtime.shutdown();
    },
  };
}

test("A Swarm writer in its own worktree is asked before it writes into the person's checkout at Auto, and goes ahead inside its worktree", async () => {
  const e = await team("auto");
  try {
    e.runtime.swarm.enable("t", { enabled: true, maxActive: 2, hibernateSec: 0 });
    const added = await e.runtime.swarm.handleTool("t", undefined, "swarm_manage", { action: "add", name: "writer", mode: "write", workspace: "share", model: "claude:claude-opus-5-5", brief: "Change a.ts." });
    assert.ok(!added.isError, added.text);
    const asking = () => e.store.timeline("t").filter((x) => x.kind === "approval" && x.state === "asking").map((x) => (x.kind === "approval" ? x.title : ""));
    for (let i = 0; i < 300 && (e.answers.length < 2 || asking().length < 2) && e.answers.length < 4; i++) await tick();
    assert.ok(e.workerCwd() && e.workerCwd() !== e.dir, "the writer works in a worktree of its own");
    const answered = Object.fromEntries(e.answers.map((a) => [a.title, a.allow]));
    assert.equal(answered["Run touch inside.txt"], true, "a routine command in its worktree goes ahead at Auto");
    assert.equal(answered["Edit a.ts in the worktree"], true, "an edit in its worktree goes ahead at Auto");
    assert.equal(answered["Run touch escape-marker in the checkout"], undefined, "a write into the person's checkout doesn't go ahead by itself");
    assert.equal(answered["Edit a.ts in the checkout"], undefined, "nor an edit of the person's checkout");
    assert.deepEqual(asking().sort(), ["@writer: Edit a.ts in the checkout", "@writer: Run touch escape-marker in the checkout"], "both come to the person as asks");
  } finally {
    e.stop();
  }
});
