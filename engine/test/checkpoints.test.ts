/*
  Snapshots and undo on a throwaway repository: a bug here loses someone's code, so each kind of
  change goes round the whole loop (capture before, change, capture after, read the changes, undo)
  and the files have to come back byte for byte, with the staging area and HEAD left alone.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture, changes, forget, restore } from "../src/checkpoints.ts";
import { run } from "../src/exec.ts";

const who = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
const git = async (cwd: string, ...args: string[]) => {
  const r = await run("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: { ...process.env, ...who } });
  assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const read = (dir: string, path: string) => readFileSync(join(dir, path));
const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10, 0x00, 0x7f, 0x80]);

async function repo(commit = true) {
  const dir = mkdtempSync(join(tmpdir(), "liner-cp-"));
  await git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  writeFileSync(join(dir, "keep.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(dir, "gone.txt"), "about to be deleted\n");
  writeFileSync(join(dir, "old-name.txt"), "a file that moves\nwith a few lines\nso git sees a rename\n");
  writeFileSync(join(dir, "logo.png"), BINARY);
  if (commit) {
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "start");
  }
  return dir;
}

/** One turn's worth of edits: a change, a new file in a new folder, a delete, a rename, a binary. */
function edit(dir: string) {
  writeFileSync(join(dir, "keep.txt"), "one\nTWO\nthree\nfour\n");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/new.ts"), "export const x = 1;\n");
  rmSync(join(dir, "gone.txt"));
  renameSync(join(dir, "old-name.txt"), join(dir, "new-name.txt"));
  writeFileSync(join(dir, "logo.png"), Buffer.from([0x00, 0x01, 0x02]));
  mkdirSync(join(dir, "node_modules/pkg"), { recursive: true });
  writeFileSync(join(dir, "node_modules/pkg/index.js"), "ignored\n");
}

test("a turn's changes are read file by file, and undo puts every file back as it was", async () => {
  const dir = await repo();
  const before = await capture(dir, "t1/1-before");
  assert.ok(before);
  edit(dir);
  const after = await capture(dir, "t1/1-after");
  assert.ok(after);

  const files = await changes(dir, before, after);
  const by = new Map(files.map((f) => [f.path, f]));
  assert.deepEqual({ ...by.get("keep.txt") }, { path: "keep.txt", status: "modified", added: 2, removed: 1 });
  assert.equal(by.get("src/new.ts")?.status, "added");
  assert.equal(by.get("gone.txt")?.status, "deleted");
  assert.equal(by.get("new-name.txt")?.status, "renamed");
  assert.equal(by.get("new-name.txt")?.from, "old-name.txt");
  assert.equal(by.get("logo.png")?.status, "modified");
  assert.ok(![...by.keys()].some((p) => p.startsWith("node_modules/")), "ignored files stay out of snapshots");

  await restore(dir, before, files);
  assert.equal(read(dir, "keep.txt").toString(), "one\ntwo\nthree\n");
  assert.equal(read(dir, "gone.txt").toString(), "about to be deleted\n");
  assert.ok(existsSync(join(dir, "old-name.txt")) && !existsSync(join(dir, "new-name.txt")), "a rename is undone");
  assert.ok(!existsSync(join(dir, "src/new.ts")), "an added file is removed");
  assert.deepEqual(read(dir, "logo.png"), BINARY, "a binary file comes back byte for byte");
  assert.ok(existsSync(join(dir, "node_modules/pkg/index.js")), "undo leaves ignored files alone");
  assert.equal(await git(dir, "status", "--porcelain", "--untracked-files=no"), "", "the tree matches HEAD again");
});

test("snapshots leave your staging area, HEAD and branch where they were", async () => {
  const dir = await repo();
  writeFileSync(join(dir, "keep.txt"), "staged on purpose\n");
  await git(dir, "add", "keep.txt");
  writeFileSync(join(dir, "scratch.txt"), "untracked, not staged\n");
  const head = await git(dir, "rev-parse", "HEAD");
  const staged = await git(dir, "diff", "--cached", "--name-only");

  const before = await capture(dir, "t2/1-before");
  writeFileSync(join(dir, "scratch.txt"), "the agent changed it\n");
  const after = await capture(dir, "t2/1-after");
  assert.ok(before && after);
  const files = await changes(dir, before, after);
  assert.deepEqual(files.map((f) => f.path), ["scratch.txt"], "an untracked file is in the snapshot too");
  await restore(dir, before, files);

  assert.equal(read(dir, "scratch.txt").toString(), "untracked, not staged\n");
  assert.equal(await git(dir, "rev-parse", "HEAD"), head);
  assert.equal(await git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "main\n");
  assert.equal(await git(dir, "diff", "--cached", "--name-only"), staged, "the staging area is untouched");
  assert.equal(await git(dir, "ls-files", "--others", "--exclude-standard"), "scratch.txt\n", "undo doesn't stage what it puts back");
});

test("a repository with no commits yet still gets snapshots and undo", async () => {
  const dir = await repo(false);
  const before = await capture(dir, "t3/1-before");
  assert.ok(before);
  edit(dir);
  const after = await capture(dir, "t3/1-after");
  assert.ok(after);
  await restore(dir, before, await changes(dir, before, after));
  assert.equal(read(dir, "keep.txt").toString(), "one\ntwo\nthree\n");
  assert.ok(existsSync(join(dir, "gone.txt")) && existsSync(join(dir, "old-name.txt")) && !existsSync(join(dir, "src/new.ts")));
  assert.equal((await run("git", ["rev-parse", "--verify", "-q", "HEAD"], { cwd: dir })).code, 1, "no commit appears on your branch");
});

test("undoing an earlier turn takes back only the files it touched", async () => {
  const dir = await repo();
  const t1 = await capture(dir, "t4/1-before");
  writeFileSync(join(dir, "keep.txt"), "turn one\n");
  const t1after = await capture(dir, "t4/1-after");
  writeFileSync(join(dir, "other.txt"), "turn two\n");
  const t2after = await capture(dir, "t4/2-after");
  assert.ok(t1 && t1after && t2after);
  await restore(dir, t1, await changes(dir, t1, t1after));
  assert.equal(read(dir, "keep.txt").toString(), "one\ntwo\nthree\n");
  assert.equal(read(dir, "other.txt").toString(), "turn two\n", "turn two's file stays");
});

test("a thread's snapshots are dropped when it's forgotten, and only that thread's", async () => {
  const dir = await repo();
  await capture(dir, "gone/1-before");
  await capture(dir, "kept/1-before");
  await forget(dir, "gone");
  const refs = await git(dir, "for-each-ref", "--format=%(refname)", "refs/liner/");
  assert.equal(refs, "refs/liner/kept/1-before\n");
});
