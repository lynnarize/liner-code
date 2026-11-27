/*
  The Files surface on a project with a folder of thousands of new files (2026-11-27: an ads folder of video frames, 5,616
  files beside the project's 1,236). Two faults met there. The engine listed the new files first and stopped at 5,000, so
  Files showed three entries and none of the project. And the tree drew a row for every file of every folder, shut or
  open, so the page held 53,000 parts: the panel took a third of a second to open and the window stuttered while Files
  was up. Run with `node --test engine/test/files-tree.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listFiles, tree } from "../src/files.ts";
import { TREE_ROWS, treeRows, type TreeNode } from "../../ui/src/app/treeRows.ts";

const ui = (name: string) => readFileSync(new URL(`../../ui/src/app/${name}`, import.meta.url), "utf8");

/** A repo with two files of its own and a folder of `fresh` new ones, named to sort before and after them. */
function repo(fresh: number) {
  const dir = mkdtempSync(join(tmpdir(), "liner-tree-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/app.ts"), "export {};\n");
  writeFileSync(join(dir, "readme.md"), "# A project\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "first");
  for (const name of [".frames", "zz-frames"]) {
    mkdirSync(join(dir, name));
    for (let i = 0; i < fresh / 2; i++) writeFileSync(join(dir, name, `${String(i).padStart(4, "0")}.png`), "");
  }
  return dir;
}

test("the project's own files are listed before new ones, so a folder of new files can't take every place up to the limit", async () => {
  const dir = repo(40);
  const files = await listFiles(dir, 10);
  assert.equal(files.length, 10);
  assert.deepEqual(files.slice(0, 2).sort(), ["readme.md", "src/app.ts"]);
  // Every file is still there when the limit has room for them.
  assert.equal((await listFiles(dir)).length, 42);
});

test("the Files tree of a project with more new files than its limit still shows the project", async () => {
  // As it was found: 5,000 was the tree's limit, and the new files alone were more than that.
  const top = await tree(repo(5200), 5000);
  const names = top.map((e) => e.path);
  assert.ok(names.includes("src") && names.includes("readme.md"), `the project's own entries are in the tree: ${names.join(", ")}`);
});

/** A folder of `n` files. */
const folder = (id: string, n: number): TreeNode => ({ id, label: id, children: Array.from({ length: n }, (_, i) => ({ id: `${id}/${i}.png`, label: `${i}.png` })) });

test("a shut folder gives the tree one row, however many files it holds", () => {
  const nodes = [folder("ads", 5000), folder("src", 30), { id: "readme.md", label: "readme.md" }];
  const { rows, more } = treeRows(nodes, new Set(), TREE_ROWS);
  assert.deepEqual(rows.map((r) => r.node.id), ["ads", "src", "readme.md"]);
  assert.equal(more, 0);
});

test("an open folder gives its files as rows under it, a level in, and only it", () => {
  const nodes = [folder("ads", 5000), folder("src", 3)];
  const { rows } = treeRows(nodes, new Set(["src"]), TREE_ROWS);
  assert.deepEqual(rows.map((r) => [r.node.id, r.level, r.parent]), [["ads", 1, null], ["src", 1, null], ["src/0.png", 2, "src"], ["src/1.png", 2, "src"], ["src/2.png", 2, "src"]]);
});

test("the tree draws at most its limit of rows and says how many it left out", () => {
  const nodes = [folder("ads", 5000), folder("src", 30)];
  const { rows, more } = treeRows(nodes, new Set(["ads", "src"]), TREE_ROWS);
  assert.equal(rows.length, TREE_ROWS);
  assert.equal(more, 5032 - TREE_ROWS);
  // The rows kept are the first ones drawn, so each has the folder over it among them.
  assert.equal(rows[0].node.id, "ads");
  assert.ok(rows.slice(1).every((r) => r.parent === "ads"));
  assert.ok(TREE_ROWS <= 500, "a row is some nine parts on the page: the limit keeps a full tree under five thousand");
});

test("Files draws its tree with the app's own, which leaves a shut folder's files off the page", () => {
  const files = ui("Files.tsx");
  assert.ok(!/from "@liner\/components\/tree-view\/tree-view"/.test(files), "Liner's TreeView draws every row of every folder and hides the shut ones by height");
  assert.match(files, /<FileTree /);
  const own = ui("FileTree.tsx");
  assert.match(own, /treeRows\(nodes, open, limit\)/);
  assert.match(own, /\{has && isOpen && \(/, "what a folder holds is drawn only while it is open");
  assert.match(own, /if \(!shown\.has\(n\.id\)\) return null;/, "a row past the limit is not drawn");
});
