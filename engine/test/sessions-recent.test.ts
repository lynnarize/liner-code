/*
  sessions.recent, for the sidebar's Recent: the newest Claude Code and Codex sessions across your
  code projects, each with its project, from one read of Codex's tree; one already brought in is
  left out, and so is a folder that is no project. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecentSession } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

const temp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), `lc-recent-${name}-`)));

test("sessions.recent: both tools across two projects, newest first, with their project; one brought in is left out", async () => {
  const a = temp("a");
  const b = temp("b");
  const claude = temp("claude");
  const codex = temp("codex");
  const env = { PATH: "/usr/bin:/bin", CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex };
  const at = (f: string, minutesAgo: number) => {
    const t = new Date(Date.now() - minutesAgo * 60_000);
    utimesSync(f, t, t);
  };

  // One Claude Code transcript in a, and one already brought in.
  const cdir = join(claude, "projects", a.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(cdir, { recursive: true });
  const user = (text: string) => `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`;
  writeFileSync(join(cdir, "s1.jsonl"), user("Fix the tide offset"));
  at(join(cdir, "s1.jsonl"), 30);
  writeFileSync(join(cdir, "s2.jsonl"), user("Already here"));
  at(join(cdir, "s2.jsonl"), 5);

  // One Codex rollout for each project's folder, and one for a folder that is no project.
  const rdir = join(codex, "sessions", "2026", "11", "16");
  mkdirSync(rdir, { recursive: true });
  const rollout = (id: string, cwd: string, text: string, minutesAgo: number) => {
    const f = join(rdir, `rollout-2026-11-16-${id}.jsonl`);
    writeFileSync(f, [JSON.stringify({ type: "session_meta", payload: { id, cwd } }), JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } })].join("\n") + "\n");
    at(f, minutesAgo);
  };
  rollout("c1", a, "Add a test for leap years", 20);
  rollout("c2", b, "Make the pricing page load faster", 10);
  rollout("c3", "/elsewhere", "Not one of yours", 1);

  const store = new Store(temp("home"));
  store.putProject({ id: "pa", name: "a", path: a, git: false, createdAt: 1 });
  store.putProject({ id: "pb", name: "b", path: b, git: false, createdAt: 1 });
  store.putThread({ id: "t", projectId: "pa", title: "Already here", agent: "@claude:default", status: "done", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1, providerSession: "claude:s2" });
  const api = createApi(store, new Runtime(store, env), env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);

  const found = (await api.call("sessions.recent", {})) as RecentSession[];
  assert.deepEqual(
    found.map((s) => [s.tool, s.id, s.projectId, s.title]),
    [
      ["codex", "c2", "pb", "Make the pricing page load faster"],
      ["codex", "c1", "pa", "Add a test for leap years"],
      ["claude", "s1", "pa", "Fix the tide offset"],
    ],
  );
  assert.deepEqual(((await api.call("sessions.recent", { limit: 2 })) as RecentSession[]).map((s) => s.id), ["c2", "c1"], "the newest `limit`");
  // sessions.importable, for one project, still reads the same.
  assert.deepEqual(((await api.call("sessions.importable", { projectId: "pa" })) as RecentSession[]).map((s) => s.id), ["c1", "s1"]);
});
