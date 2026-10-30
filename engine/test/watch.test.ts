/*
  What the engine does on its own in the background, and when it holds off: a project's checkout
  is fast-forwarded only while nothing works in it, and a simulator's log stream that's replaced
  (a new filter) never leaves the new one beyond reach. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/exec.ts";
import { Store } from "../src/store.ts";
import { DeviceLogs } from "../src/surfaces.ts";
import { Watch } from "../src/watch.ts";

const who = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = async (cwd: string, ...args: string[]) => {
  const r = await run("git", args, { cwd, env: who });
  assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

test("auto-pull: a checkout something works in is left as it is, and pulled once it's free", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-watch-"));
  const origin = join(dir, "origin");
  const work = join(dir, "work");
  mkdirSync(origin);
  await git(origin, "init", "-q", "-b", "main");
  writeFileSync(join(origin, "a.txt"), "one\n");
  await git(origin, "add", "-A");
  await git(origin, "commit", "-q", "-m", "one");
  await git(dir, "clone", "-q", origin, work);
  writeFileSync(join(origin, "a.txt"), "two\n");
  await git(origin, "commit", "-q", "-am", "two");
  const ahead = await git(origin, "rev-parse", "HEAD");

  const store = new Store(join(dir, "home"));
  store.setSettings({ autoPull: true });
  store.putProject({ id: "p", name: "work", path: work, git: true, createdAt: 1 });
  let busy = true;
  const watch = new Watch(store, who, (path) => busy && path === work);
  const pull = () => (watch as unknown as { pull(): Promise<void> }).pull();

  await pull();
  assert.notEqual(await git(work, "rev-parse", "HEAD"), ahead, "a session works there: no pull");
  busy = false;
  await pull();
  assert.equal(await git(work, "rev-parse", "HEAD"), ahead, "free again: it fast-forwards");
});

test("device log: a stream replaced by a new filter is stopped, and the new one stops when it's turned off", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-devlog-"));
  // A stand-in for `xcrun simctl spawn … log stream`: it runs until it's stopped.
  writeFileSync(join(dir, "xcrun"), "#!/bin/sh\nexec sleep 30\n");
  chmodSync(join(dir, "xcrun"), 0o755);
  const logs = new DeviceLogs(new Store(join(dir, "home")), { ...process.env, PATH: `${dir}:${process.env.PATH}` });
  const live = (logs as unknown as { live: Map<string, ChildProcess> }).live;

  logs.set("U", true, "first");
  const first = live.get("U")!;
  logs.set("U", true, "second");
  const second = live.get("U")!;
  assert.notEqual(first, second);
  await once(first, "close");
  assert.equal(live.get("U"), second, "the old stream closing leaves the new one in reach");
  const closed = once(second, "close");
  logs.set("U", false);
  await closed;
  assert.equal(live.size, 0);
});
