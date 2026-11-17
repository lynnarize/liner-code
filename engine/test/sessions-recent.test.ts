/*
  sessions.recent, for the sidebar's Recent: the newest Claude Code and Codex sessions across your
  code projects, each with its project, from one read of Codex's tree; one already brought in is
  left out, and so is a folder that is no project. One entry that can't be read (a folder named like a session, a
  file you may not read, a pipe, one gone since the folder was read) is one session less, never an empty list or a
  stuck engine; Codex's tree is read without following links out of it; a project typed in another case finds the
  sessions the tools filed under the disk's own; and a first line longer than the usual head still gives a title.
  Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Project, RecentSession } from "../../contracts/src/index.ts";
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

/** A project folder, Claude Code's and Codex's homes, each with one good session for it, and an api over them. */
function world(name: string, folder?: (root: string) => string) {
  const root = temp(name);
  const project = folder ? folder(root) : join(root, "project");
  mkdirSync(project, { recursive: true });
  const claude = join(root, "claude");
  const codex = join(root, "codex");
  const env = { PATH: "/usr/bin:/bin", CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex };
  const cdir = join(claude, "projects", project.replace(/[^a-zA-Z0-9]/g, "-"));
  const rdir = join(codex, "sessions", "2026", "11", "17");
  mkdirSync(cdir, { recursive: true });
  mkdirSync(rdir, { recursive: true });
  const user = (text: string) => `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`;
  const rollout = (id: string, text: string, meta: Record<string, unknown> = {}) => [JSON.stringify({ type: "session_meta", payload: { id, cwd: project, ...meta } }), JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } })].join("\n") + "\n";
  writeFileSync(join(cdir, "good.jsonl"), user("Chart the spring tides"));
  writeFileSync(join(rdir, "rollout-2026-11-17-g1.jsonl"), rollout("g1", "Shade the neap tides"));
  const store = new Store(join(root, "home"));
  const api = (path = project) => {
    store.putProject({ id: "p", name: "project", path, git: false, createdAt: 1 });
    return createApi(store, new Runtime(store, env), env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  };
  const ids = async (path?: string) => ((await api(path).call("sessions.recent", { limit: 50 })) as RecentSession[]).map((s) => s.id).sort();
  return { root, project, cdir, rdir, codex, user, rollout, api, ids };
}

test("sessions.recent: a folder named like a session, in either tool's folder, is passed over, not the end of the list", async () => {
  const w = world("dir");
  mkdirSync(join(w.cdir, "folder.jsonl"));
  mkdirSync(join(w.rdir, "rollout-2026-11-17-folder.jsonl"));
  assert.deepEqual(await w.ids(), ["g1", "good"]);
});

test("sessions.recent: a session you may not read is passed over", { skip: (process.platform === "win32" || process.getuid?.() === 0) && "permissions don't hold here" }, async () => {
  const w = world("eacces");
  writeFileSync(join(w.cdir, "locked.jsonl"), w.user("Locked away"));
  chmodSync(join(w.cdir, "locked.jsonl"), 0o000);
  writeFileSync(join(w.rdir, "rollout-2026-11-17-locked.jsonl"), w.rollout("locked", "Locked away"));
  chmodSync(join(w.rdir, "rollout-2026-11-17-locked.jsonl"), 0o000);
  try {
    assert.deepEqual(await w.ids(), ["g1", "good"]);
  } finally {
    chmodSync(join(w.cdir, "locked.jsonl"), 0o600);
    chmodSync(join(w.rdir, "rollout-2026-11-17-locked.jsonl"), 0o600);
  }
});

test("sessions.recent: a pipe named like a session is never read, so the engine doesn't wait on it forever", { skip: process.platform === "win32" && "no mkfifo" }, async () => {
  const w = world("fifo");
  execFileSync("mkfifo", [join(w.rdir, "rollout-2026-11-17-pipe.jsonl")]);
  execFileSync("mkfifo", [join(w.cdir, "pipe.jsonl")]);
  assert.deepEqual(await w.ids(), ["g1", "good"]);
});

test("sessions.recent: Codex's tree is read without following links out of it, to a folder or a file", { skip: process.platform === "win32" && "links need rights there" }, async () => {
  const w = world("links");
  const outside = join(w.root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "rollout-2026-11-17-out1.jsonl"), w.rollout("out1", "From a folder outside"));
  writeFileSync(join(outside, "rollout-2026-11-17-out2.jsonl"), w.rollout("out2", "From a file outside"));
  symlinkSync(outside, join(w.codex, "sessions", "2026", "linked"));
  symlinkSync(join(outside, "rollout-2026-11-17-out2.jsonl"), join(w.rdir, "rollout-2026-11-17-out2.jsonl"));
  assert.deepEqual(await w.ids(), ["g1", "good"]);
});

/** Whether the temp disk ignores case: a file written as X can be found as x. */
const ignoresCase = (() => {
  const dir = temp("case-probe");
  writeFileSync(join(dir, "CaseProbe"), "");
  return existsSync(join(dir, "caseprobe"));
})();

test("sessions.recent: a project typed in another case finds the sessions the tools filed under the disk's own; project.add keeps the disk's", { skip: !ignoresCase && "the disk minds case" }, async () => {
  // The tools name their sessions by the folder as the disk spells it, App; the project was typed as app.
  const w = world("case", (root) => join(root, "Harbour", "App"));
  const typed = join(dirname(dirname(w.project)), "harbour", "app");
  assert.deepEqual(await w.ids(typed), ["g1", "good"]);
  assert.deepEqual(((await w.api(typed).call("sessions.importable", { projectId: "p" })) as RecentSession[]).map((s) => s.id).sort(), ["g1", "good"]);
  // Added fresh under the typed spelling, it is kept as the disk has it.
  const other = join(w.root, "Ledger");
  mkdirSync(other);
  const added = (await w.api().call("project.add", { path: join(w.root, "ledger") })) as Project;
  assert.equal(added.path, other);
  assert.equal(added.name, basename(other));
});

test("sessions.recent: a first line longer than the head still gives the session its title", async () => {
  const w = world("long");
  // A Claude Code transcript whose first line is a long paste, and a Codex rollout whose session_meta carries 200 KB of instructions.
  writeFileSync(join(w.cdir, "long.jsonl"), w.user(`Read this log ${"x".repeat(200_000)}`) + w.user("Then this"));
  writeFileSync(join(w.rdir, "rollout-2026-11-17-long.jsonl"), w.rollout("long-codex", "After long instructions", { instructions: "y".repeat(200_000) }));
  assert.deepEqual(await w.ids(), ["g1", "good", "long", "long-codex"]);
  const found = (await w.api().call("sessions.recent", { limit: 50 })) as RecentSession[];
  assert.equal(found.find((s) => s.id === "long")?.title.startsWith("Read this log x"), true);
  assert.equal(found.find((s) => s.id === "long-codex")?.title, "After long instructions");
  // Past a megabyte, a first line is left unread rather than read whole.
  writeFileSync(join(w.cdir, "huge.jsonl"), w.user(`Huge ${"z".repeat(1_200_000)}`));
  assert.deepEqual(await w.ids(), ["g1", "good", "long", "long-codex"]);
});
