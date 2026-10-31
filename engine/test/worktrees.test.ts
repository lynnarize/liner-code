/*
  Sessions' worktrees and undo, through the engine's own commands on a throwaway repository:
  deleting a session or cleaning up never takes work with it, a worktree that's gone comes back
  when its session does, and undo won't overwrite what changed after a turn or pull files out from
  under another session. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineEvent, Item, Thread } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { capture, changes } from "../src/checkpoints.ts";
import { run } from "../src/exec.ts";
import { Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";
import { localChanges, removeWorktree } from "../src/worktrees.ts";

const who = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
const git = async (cwd: string, ...args: string[]) => {
  const r = await run("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: { ...process.env, ...who } });
  assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "lc-wt-repo-"));
  await git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.txt"), "one\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "start");
  const home = mkdtempSync(join(tmpdir(), "lc-wt-home-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: true, createdAt: Date.now() });
  // A bare PATH, so finding the agent tools doesn't start any.
  const env = { PATH: "/usr/bin:/bin", ...who };
  const runtime = new Runtime(store, env);
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const events: EngineEvent[] = [];
  store.on((e) => events.push(e));
  const call = <T>(method: string, params: unknown) => api.call(method, params) as Promise<T>;
  return { dir, home, store, runtime, call, events };
}

const rootOf = (t: Thread) => t.worktree!.root ?? t.worktree!.path;

test("worktrees: removed only when nothing in them would be lost, never forced", async () => {
  const { dir } = await setup();
  const wt = join(mkdtempSync(join(tmpdir(), "lc-wt-")), "w");
  await git(dir, "worktree", "add", "-q", "-b", "w", wt);
  writeFileSync(join(wt, "untracked.txt"), "not committed anywhere\n");
  assert.match((await removeWorktree(dir, wt)) ?? "", /changes that aren't committed \(1 file\)/);
  assert.ok(existsSync(join(wt, "untracked.txt")));
  rmSync(join(wt, "untracked.txt"));
  assert.equal(await localChanges(wt), null);
  assert.equal(await removeWorktree(dir, wt), null);
  assert.ok(!existsSync(wt));
  assert.equal((await git(dir, "branch", "--list", "w")).trim(), "w", "its branch stays");
});

test("deleting a session keeps its worktree while it holds changes or another session works there", async () => {
  const { store, call, events } = await setup();
  const t = await call<Thread>("thread.create", { projectId: "p", agent: "demo", worktree: true });
  assert.equal(t.worktree?.made, true);
  const root = rootOf(t);
  assert.ok(existsSync(root));
  // A fork works in the same worktree: deleting the first session leaves it.
  const fork = await call<Thread>("thread.create", { projectId: "p", forkOf: t.id });
  assert.deepEqual(await call("thread.remove", { id: t.id }), { kept: `"${fork.title}" works there too` });
  assert.ok(existsSync(root));
  // Work not committed: kept, and said so.
  writeFileSync(join(root, "draft.txt"), "an afternoon's work\n");
  const res = await call<{ kept: string }>("thread.remove", { id: fork.id });
  assert.match(res.kept, /changes that aren't committed/);
  assert.equal(readFileSync(join(root, "draft.txt"), "utf8"), "an afternoon's work\n");
  assert.ok(events.some((e) => e.type === "notify" && e.title === "Kept its worktree"));
  assert.equal(store.threads.length, 0, "the sessions are gone all the same");
  // Once it's committed, the clean-up takes it.
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "keep the work");
  const clean = await call<{ removed: number; kept: number }>("worktrees.clean", { projectId: "p" });
  assert.equal(clean.removed, 1);
  assert.ok(!existsSync(root));
});

test("a worktree you picked stays when its session goes; a clean one Liner made goes", async () => {
  const { dir, call } = await setup();
  const mine = join(mkdtempSync(join(tmpdir(), "lc-wt-")), "mine");
  await git(dir, "worktree", "add", "-q", "-b", "mine", mine);
  const picked = await call<Thread>("thread.create", { projectId: "p", agent: "demo", inWorktree: mine });
  assert.equal(picked.worktree?.made, false);
  assert.equal(await call("thread.remove", { id: picked.id }), null);
  assert.ok(existsSync(mine), "yours stays yours");
  const made = await call<Thread>("thread.create", { projectId: "p", agent: "demo", worktree: true });
  assert.equal(await call("thread.remove", { id: made.id }), null);
  assert.ok(!existsSync(rootOf(made)));
});

test("clean-up keeps an archived session's worktree with changes, and says why", async () => {
  const { call } = await setup();
  const t = await call<Thread>("thread.create", { projectId: "p", agent: "demo", worktree: true });
  writeFileSync(join(rootOf(t), "wip.txt"), "unsaved\n");
  await call("thread.update", { id: t.id, archived: true });
  const r = await call<{ removed: number; kept: number; reasons: { path: string; reason: string }[] }>("worktrees.clean", { projectId: "p" });
  assert.equal(r.removed, 0);
  assert.deepEqual(r.reasons.map((x) => realpathSync(x.path)), [realpathSync(rootOf(t))]);
  assert.ok(existsSync(join(rootOf(t), "wip.txt")));
});

test("a session whose worktree is gone gets it back, on its branch, when it's opened again", async () => {
  const { dir, store, call } = await setup();
  const t = await call<Thread>("thread.create", { projectId: "p", agent: "demo", worktree: true });
  const root = rootOf(t);
  writeFileSync(join(root, "b.txt"), "on the branch\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "work on the branch");
  await call("thread.update", { id: t.id, archived: true });
  await call("worktrees.clean", { projectId: "p" });
  assert.ok(!existsSync(root));
  await call("thread.update", { id: t.id, archived: false });
  for (let i = 0; i < 100 && !existsSync(join(root, "b.txt")); i++) await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(readFileSync(join(root, "b.txt"), "utf8"), "on the branch\n");
  assert.equal((await git(root, "rev-parse", "--abbrev-ref", "HEAD")).trim(), t.worktree!.branch);
  assert.ok(store.timeline(t.id).some((x) => x.kind === "notice" && /worktree was gone/.test(x.text)));
  // Its branch gone too: a new one of that name from where the checkout is.
  await call("thread.update", { id: t.id, archived: true });
  await call("worktrees.clean", { projectId: "p" });
  await git(dir, "branch", "-D", t.worktree!.branch);
  await call("thread.update", { id: t.id, archived: false });
  for (let i = 0; i < 100 && !existsSync(join(root, "a.txt")); i++) await new Promise((ok) => setTimeout(ok, 20));
  assert.ok(existsSync(join(root, "a.txt")) && !existsSync(join(root, "b.txt")));
});

test("undo won't overwrite a later edit unless forced, and never under another session working there", async () => {
  const { dir, store, runtime, call } = await setup();
  const t = await call<Thread>("thread.create", { projectId: "p", agent: "demo" });
  const other = await call<Thread>("thread.create", { projectId: "p", agent: "demo", title: "Other work" });
  const from = await capture(dir, `${t.id}/1-before`);
  writeFileSync(join(dir, "a.txt"), "the turn's edit\n");
  const to = await capture(dir, `${t.id}/1-after`);
  assert.ok(from && to);
  const cp = store.putItem(t.id, { kind: "checkpoint", id: "cp1", turn: 1, at: Date.now(), files: await changes(dir, from, to), from, to }) as Extract<Item, { kind: "checkpoint" }>;
  writeFileSync(join(dir, "a.txt"), "your edit after it\n");
  await assert.rejects(call("checkpoint.revert", { threadId: t.id, itemId: cp.id }), /Changed after that turn: a\.txt/);
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "your edit after it\n");
  // Another session in the same folder is working: no undo, no branch switch.
  const running = runtime.isRunning.bind(runtime);
  runtime.isRunning = (id: string) => id === other.id || running(id);
  await assert.rejects(call("checkpoint.revert", { threadId: t.id, itemId: cp.id, force: true }), /"Other work" is working in this folder now/);
  await assert.rejects(call("git.switch", { threadId: t.id, branch: "elsewhere", create: true }), /"Other work" is working in this folder now/);
  runtime.isRunning = running;
  const done = await call<Extract<Item, { kind: "checkpoint" }>>("checkpoint.revert", { threadId: t.id, itemId: cp.id, force: true });
  assert.equal(done.reverted, true);
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "one\n");
  assert.equal(await git(dir, "show", `${done.redo}:a.txt`), "your edit after it\n", "the undo can be taken back");
});
