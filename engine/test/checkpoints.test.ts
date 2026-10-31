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
import { capture, changes, diffFiles, forget, isRepo, local, prefixOf, restore, undo } from "../src/checkpoints.ts";
import { gitStatus, listFiles } from "../src/files.ts";
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

test("a file git is told to pass over still shows in a turn's changes", async () => {
  // Snapshots start from a copy of your index, which may say not to look at some files.
  const dir = await repo();
  await git(dir, "update-index", "--assume-unchanged", "keep.txt");
  await git(dir, "update-index", "--skip-worktree", "gone.txt");
  const before = await capture(dir, "t6/1-before");
  writeFileSync(join(dir, "keep.txt"), "changed under assume-unchanged\n");
  writeFileSync(join(dir, "gone.txt"), "changed under skip-worktree\n");
  const after = await capture(dir, "t6/1-after");
  assert.ok(before && after);
  assert.deepEqual((await changes(dir, before, after)).map((f) => f.path).sort(), ["gone.txt", "keep.txt"]);
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

test("a project in a folder of a bigger repository (a home folder that is one): its own paths, and a commit of them works", async () => {
  const top = await repo();
  const dir = join(top, "Project", "Liner Codes", "Test");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), "<h1>one</h1>\n");
  const before = await capture(dir, "nested/1-before");
  writeFileSync(join(dir, "index.html"), "<h1>two</h1>\n");
  writeFileSync(join(top, "keep.txt"), "outside the project\n");
  const after = await capture(dir, "nested/1-after");
  assert.ok(before && after);
  const files = await changes(dir, before, after);
  assert.deepEqual(files.map((f) => f.path), ["index.html"], "the project's own path, and nothing from outside its folder");
  const [diff] = await diffFiles(dir, before, after, files);
  assert.deepEqual([diff.before, diff.after], ["<h1>one</h1>\n", "<h1>two</h1>\n"]);
  // What the commit card runs, from the project's folder.
  await git(dir, "add", "-A", "--", ...files.map((f) => f.path));
  await git(dir, "commit", "-q", "-m", "two", "--", ...files.map((f) => f.path));
  assert.match(await git(top, "show", "--name-only", "--format=", "HEAD"), /^Project\/Liner Codes\/Test\/index\.html$/m);
  // A checkpoint saved with paths from the repository's top still finds its files.
  const prefix = await prefixOf(dir);
  assert.equal(prefix, "Project/Liner Codes/Test/");
  assert.equal(local("Project/Liner Codes/Test/index.html", prefix), "index.html");
  await restore(dir, before, [{ path: "Project/Liner Codes/Test/index.html", status: "modified", added: 1, removed: 1 }]);
  assert.equal(read(dir, "index.html").toString(), "<h1>one</h1>\n");
  assert.equal(read(top, "keep.txt").toString(), "outside the project\n", "files outside the project are left alone");
  await forget(dir, "nested");
});

// A name from a Mac screenshot (a narrow no-break space before AM), one with an accent, and one
// git would read as a pattern unless it's told otherwise.
const ODD = ["café.txt", "Screenshot 9.41.00 AM.png", "*.txt", "dir é/naïve.md"];

test("names git would quote or read as patterns: read, shown and undone as they are", async () => {
  const dir = await repo();
  mkdirSync(join(dir, "dir é"), { recursive: true });
  for (const f of ODD) writeFileSync(join(dir, f), `${f} as it was\n`);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "odd names");
  const before = await capture(dir, "odd/1-before");
  writeFileSync(join(dir, "café.txt"), "changed\nand longer\n");
  writeFileSync(join(dir, "Screenshot 9.41.00 AM.png"), "changed\n");
  rmSync(join(dir, "*.txt"));
  renameSync(join(dir, "dir é/naïve.md"), join(dir, "dir é/rené.md"));
  writeFileSync(join(dir, "über.txt"), "new\n");
  const after = await capture(dir, "odd/1-after");
  assert.ok(before && after);
  const files = await changes(dir, before, after);
  const by = new Map(files.map((f) => [f.path, f]));
  assert.deepEqual({ ...by.get("café.txt") }, { path: "café.txt", status: "modified", added: 2, removed: 1 });
  assert.equal(by.get("Screenshot 9.41.00 AM.png")?.status, "modified");
  assert.equal(by.get("*.txt")?.status, "deleted");
  assert.equal(by.get("dir é/rené.md")?.from, "dir é/naïve.md");
  assert.equal(by.get("über.txt")?.status, "added");
  const [diff] = await diffFiles(dir, before, after, [by.get("café.txt")!]);
  assert.equal(diff.after, "changed\nand longer\n");

  await restore(dir, before, files);
  for (const f of ODD) assert.equal(read(dir, f).toString(), `${f} as it was\n`, f);
  assert.ok(!existsSync(join(dir, "über.txt")) && !existsSync(join(dir, "dir é/rené.md")));
  // keep.txt matches `*.txt`; a pattern would have put it back too, or failed.
  assert.equal(await git(dir, "status", "--porcelain"), "");

  // A turn that only deleted `*.txt`: undoing it puts back that file, not every .txt file.
  const b2 = await capture(dir, "odd/2-before");
  rmSync(join(dir, "*.txt"));
  const a2 = await capture(dir, "odd/2-after");
  assert.ok(b2 && a2);
  writeFileSync(join(dir, "keep.txt"), "edited after the turn\n");
  await restore(dir, b2, await changes(dir, b2, a2));
  assert.equal(read(dir, "*.txt").toString(), "*.txt as it was\n");
  assert.equal(read(dir, "keep.txt").toString(), "edited after the turn\n", "a pattern would have put keep.txt back too");

  // The Files panel and @ mentions read the same names.
  writeFileSync(join(dir, "café.txt"), "again\n");
  assert.ok((await listFiles(dir)).includes("café.txt"));
  assert.ok((await gitStatus(dir)).changes.some((c) => c.path === "café.txt" && c.status === "modified"));
});

test("undo that can't happen says so and changes nothing: a missing snapshot, a missing folder", async () => {
  const dir = await repo();
  writeFileSync(join(dir, "made.txt"), "the turn made this\n");
  const files = [
    { path: "made.txt", status: "added" as const, added: 1, removed: 0 },
    { path: "keep.txt", status: "modified" as const, added: 1, removed: 1 },
  ];
  await assert.rejects(restore(dir, "0123456789abcdef0123456789abcdef01234567", files), /snapshot from before that turn is gone/);
  assert.ok(existsSync(join(dir, "made.txt")), "nothing is deleted when the snapshot is gone");
  // A file the snapshot doesn't have: git refuses, and the turn's new file is still there.
  const head = (await git(dir, "rev-parse", "HEAD")).trim();
  await assert.rejects(restore(dir, head, [...files, { path: "never-there.txt", status: "modified", added: 1, removed: 0 }]), /git couldn't put the files back/);
  assert.ok(existsSync(join(dir, "made.txt")), "checkout comes before deleting, so a failed one deletes nothing");
  await assert.rejects(restore(join(dir, "gone-folder"), head, files), /isn't there any more/);
});

test("undo refuses to overwrite what changed after the turn, unless forced, and keeps a snapshot to undo the undo", async () => {
  const dir = await repo();
  const before = await capture(dir, "u/1-before");
  writeFileSync(join(dir, "keep.txt"), "turn one\n");
  writeFileSync(join(dir, "made.txt"), "turn one made it\n");
  const after = await capture(dir, "u/1-after");
  assert.ok(before && after);
  const turn = { from: before, to: after, files: await changes(dir, before, after) };
  // You edit the file afterwards.
  writeFileSync(join(dir, "keep.txt"), "my own edit\n");
  await assert.rejects(undo(dir, "u/undo-1", [turn]), /Changed after that turn: keep\.txt\./);
  assert.equal(read(dir, "keep.txt").toString(), "my own edit\n", "nothing was put back");
  assert.ok(existsSync(join(dir, "made.txt")));

  const redo = await undo(dir, "u/undo-2", [turn], true);
  assert.equal(read(dir, "keep.txt").toString(), "one\ntwo\nthree\n");
  assert.ok(!existsSync(join(dir, "made.txt")));
  // The undo itself can be taken back from its snapshot.
  assert.equal(await git(dir, "show", `${redo}:keep.txt`), "my own edit\n");
  assert.equal(await git(dir, "show", `${redo}:made.txt`), "turn one made it\n");
  assert.equal((await git(dir, "rev-parse", "refs/liner/u/undo-2")).trim(), redo);

  // Untouched since the turn: no force needed.
  const b2 = await capture(dir, "u/2-before");
  writeFileSync(join(dir, "other.txt"), "turn two\n");
  const a2 = await capture(dir, "u/2-after");
  assert.ok(b2 && a2);
  await undo(dir, "u/undo-3", [{ from: b2, to: a2, files: await changes(dir, b2, a2) }]);
  assert.ok(!existsSync(join(dir, "other.txt")));
});

test("a same-size edit in the second the index was written still shows in the snapshot", async () => {
  // git trusts a file's size and time when they're older than the index; a copy of the index
  // dated now would vouch for an edit made in the same second as the real one was written.
  const dir = await repo();
  for (let round = 0; round < 3; round++) {
    // Start at the top of a second, so the write, the add and the edit share one.
    await new Promise((ok) => setTimeout(ok, 1000 - (Date.now() % 1000) + 20));
    writeFileSync(join(dir, "race.txt"), `aaaa${round}\n`);
    await git(dir, "add", "race.txt");
    writeFileSync(join(dir, "race.txt"), `bbbb${round}\n`);
    // The snapshot is taken in a later second.
    await new Promise((ok) => setTimeout(ok, 1000 - (Date.now() % 1000) + 20));
    const snap = await capture(dir, `race/${round}`);
    assert.ok(snap);
    assert.equal(await git(dir, "show", `${snap}:race.txt`), `bbbb${round}\n`, `round ${round}`);
  }
});

test("a repository inside the project with no commit yet doesn't stop the snapshot", async () => {
  const dir = await repo();
  const sub = join(dir, "vendor", "lib");
  mkdirSync(sub, { recursive: true });
  await git(sub, "init", "-q", "-b", "main");
  writeFileSync(join(sub, "a.js"), "inner\n");
  const before = await capture(dir, "nest/1-before");
  assert.ok(before, "a snapshot, without the inner repository");
  writeFileSync(join(dir, "keep.txt"), "changed beside it\n");
  const after = await capture(dir, "nest/1-after");
  assert.ok(after);
  assert.deepEqual((await changes(dir, before, after)).map((f) => f.path), ["keep.txt"]);
});

test("a turn that pulls only claims the files it wrote, not the ones that came in with HEAD", async () => {
  const dir = await repo();
  // Upstream work, committed before the turn started.
  await git(dir, "checkout", "-q", "-b", "upstream");
  writeFileSync(join(dir, "gone.txt"), "changed upstream\n");
  writeFileSync(join(dir, "theirs.txt"), "added upstream\n");
  await git(dir, "add", "-A");
  await run("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "upstream"], { cwd: dir, env: { ...process.env, ...who, GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z", GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z" } });
  await git(dir, "checkout", "-q", "main");
  const before = await capture(dir, "pull/1-before");
  // The turn: a fast-forward pull, a file of its own, and a commit of its own.
  await git(dir, "merge", "-q", "--ff-only", "upstream");
  writeFileSync(join(dir, "mine.txt"), "the turn wrote this\n");
  writeFileSync(join(dir, "committed.txt"), "the turn committed this\n");
  await git(dir, "add", "committed.txt");
  await git(dir, "commit", "-q", "-m", "the turn's commit");
  const after = await capture(dir, "pull/1-after");
  assert.ok(before && after);
  assert.deepEqual((await changes(dir, before, after)).map((f) => f.path).sort(), ["committed.txt", "gone.txt", "mine.txt", "theirs.txt"]);
  assert.deepEqual((await changes(dir, before, after, { turn: true })).map((f) => f.path).sort(), ["committed.txt", "mine.txt"]);
  // HEAD didn't move: every change is the turn's.
  const b2 = await capture(dir, "pull/2-before");
  writeFileSync(join(dir, "keep.txt"), "edited\n");
  const a2 = await capture(dir, "pull/2-after");
  assert.ok(b2 && a2);
  assert.deepEqual((await changes(dir, b2, a2, { turn: true })).map((f) => f.path), ["keep.txt"]);
});

test("a folder its repository ignores isn't a Git project", async () => {
  const top = await repo();
  writeFileSync(join(top, ".gitignore"), "node_modules/\nscratch/\n");
  mkdirSync(join(top, "scratch", "app"), { recursive: true });
  mkdirSync(join(top, "web"), { recursive: true });
  assert.equal(await isRepo(join(top, "scratch", "app")), false);
  assert.equal(await isRepo(join(top, "web")), true);
  assert.equal(await isRepo(top), true);
  assert.equal(await isRepo(tmpdir()), false);
});
