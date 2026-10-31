/*
  What keeps work from being lost: the commands that throw away what git can't give back are high
  risk (and `git branch` that deletes isn't a read), and the engine's own state survives a crash
  mid-write. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandRisk, readsOnly } from "../src/risk.ts";
import { Store, writeAtomic } from "../src/store.ts";
import { factsOf, remember } from "../src/memory.ts";

test("risk: commands that throw away changes, stashes or unmerged branches are high", () => {
  for (const c of [
    "git checkout .",
    "git checkout -- src/a.ts",
    "git checkout HEAD -- src",
    "git checkout ./src",
    "git checkout -f main",
    "git restore src/a.ts",
    "git restore .",
    "git restore --staged --worktree src/a.ts",
    "git stash clear",
    "git stash drop stash@{1}",
    "git switch --discard-changes main",
    "git switch -f main",
    "find . -name '*.log' -delete",
    "find build -type f -exec rm {} +",
    "git worktree remove --force ../wt",
    "git worktree remove -f ../wt",
    "git branch -D feature",
    "git branch -Dr origin/x",
    "git branch --delete --force feature",
    "git branch -d -f feature",
    "cd app && git checkout -- .",
  ])
    assert.equal(commandRisk(c), "high", c);
});

test("risk: their careful forms aren't high", () => {
  for (const c of ["git restore --staged src/a.ts", "git restore -S a.ts", "git switch main", "git switch -c feature", "git checkout -b feature", "git checkout main", "git stash", "git stash pop", "find . -name '*.ts'", "git worktree remove ../wt", "git worktree list", "git status && git checkout main"]) assert.notEqual(commandRisk(c), "high", c);
  // A merged branch's delete asks, but isn't one that loses work.
  assert.equal(commandRisk("git branch -d feature"), "medium");
});

test("reads: git branch only when it lists", () => {
  for (const c of ["git branch", "git branch -a", "git branch -vv", "git branch -r --merged", "git branch --list 'feat*'", "git branch --contains abc123", "git branch --show-current", "git branch --sort=-committerdate --format='%(refname:short)'"]) assert.equal(readsOnly(c), true, c);
  for (const c of ["git branch -D feature", "git branch -d feature", "git branch --delete --force feature", "git branch -f main HEAD~3", "git branch -m old new", "git branch -M old new", "git branch -c a b", "git branch -C a b", "git branch new-feature", "git branch -u origin/main", "git branch --set-upstream-to=origin/main", "git branch --edit-description"]) assert.equal(readsOnly(c), false, c);
});

test("state: a garbled state.json gives way to the last good copy, and is kept aside", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-state-"));
  const a = new Store(home);
  a.putProject({ id: "p1", name: "one", path: "/tmp/one", git: false, createdAt: 1 });
  a.flush();
  a.putProject({ id: "p2", name: "two", path: "/tmp/two", git: false, createdAt: 2 });
  a.flush();
  assert.ok(existsSync(join(home, "state.json.bak")), "the save before is kept");
  assert.ok(!existsSync(join(home, "state.json.tmp")), "no temporary file is left behind");
  // Cut off mid-write, as after a power cut without a flush to disk.
  writeFileSync(join(home, "state.json"), '{"projects":[{"id":"p1"');
  const b = new Store(home);
  assert.deepEqual(b.projects.map((p) => p.id), ["p1"], "the last good copy");
  assert.ok(existsSync(join(home, "state.json.broken")), "the garbled one is kept aside");
  // The next save can't put the garbled one over the good copy.
  b.flush();
  assert.deepEqual((JSON.parse(readFileSync(join(home, "state.json.bak"), "utf8")) as { projects: { id: string }[] }).projects.map((p) => p.id), ["p1"]);
  // Neither reads: it starts, empty, rather than not at all.
  writeFileSync(join(home, "state.json"), "{");
  writeFileSync(join(home, "state.json.bak"), "");
  assert.deepEqual(new Store(home).projects, []);
});

test("state: an atomic write replaces the file whole, and memory is written that way", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-mem-"));
  const file = join(home, "x.json");
  writeAtomic(file, "one");
  writeAtomic(file, "two", { backup: true });
  assert.equal(readFileSync(file, "utf8"), "two");
  assert.equal(readFileSync(`${file}.bak`, "utf8"), "one");
  remember(home, "pr_1", "Tests run with npm test");
  remember(home, "pr_1", "Use pnpm, not npm");
  assert.deepEqual(factsOf(home, "pr_1"), ["Tests run with npm test", "Use pnpm, not npm"]);
  assert.deepEqual(readdirSync(join(home, "memory")), ["pr_1.md"], "no temporary file is left behind");
});
