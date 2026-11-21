/*
  "Copy the diff as a patch" in Changes (ui/src/app/patch.ts): what it copies must be a patch git
  itself takes. Each case writes the files as they were into a fresh repository, applies the patch
  with `git apply`, and reads back the files as they are after.
*/
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { FileDiff } from "../../contracts/src/index.ts";
import { fileLetter, patchOf } from "../../ui/src/app/patch.ts";

/** Applies the patch of `files` in a repository holding their texts before, and says what each path holds after. */
function applied(files: FileDiff[]) {
  const dir = mkdtempSync(join(tmpdir(), "liner-patch-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    for (const f of files)
      if (f.before !== undefined) {
        const p = join(dir, f.from ?? f.path);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, f.before);
      }
    const r = patchOf(files);
    if (!("patch" in r)) throw new Error(r.why);
    writeFileSync(join(dir, ".liner.patch"), r.patch);
    execFileSync("git", ["apply", "--check", ".liner.patch"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["apply", ".liner.patch"], { cwd: dir, stdio: "pipe" });
    const out: Record<string, string | undefined> = {};
    for (const f of files) {
      out[f.path] = existsSync(join(dir, f.path)) ? readFileSync(join(dir, f.path), "utf8") : undefined;
      if (f.from && f.from !== f.path) out[f.from] = existsSync(join(dir, f.from)) ? readFileSync(join(dir, f.from), "utf8") : undefined;
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const many = (n: number, at = 1) => Array.from({ length: n }, (_, i) => `line ${i + at}`).join("\n") + "\n";

test("a change in the middle of a file applies with git", () => {
  const before = many(20);
  const after = before.replace("line 10\n", "line ten\nline ten and a half\n");
  assert.equal(applied([{ path: "src/a.ts", before, after }])["src/a.ts"], after);
});

test("changes far apart are separate hunks, and ones close together are one, and both apply", () => {
  const before = many(60);
  const after = before.replace("line 2\n", "two\n").replace("line 5\n", "five\n").replace("line 50\n", "fifty\n");
  const r = patchOf([{ path: "a.txt", before, after }]);
  assert.ok("patch" in r);
  assert.equal(r.patch.match(/^@@ /gm)?.length, 2);
  assert.equal(applied([{ path: "a.txt", before, after }])["a.txt"], after);
});

test("a new file, a deleted file and an empty new file apply together", () => {
  const out = applied([
    { path: "new/b.ts", after: "export const b = 1;\n" },
    { path: "old.ts", before: "gone\nfor good\n" },
    { path: "empty.txt", after: "" },
  ]);
  assert.equal(out["new/b.ts"], "export const b = 1;\n");
  assert.equal(out["old.ts"], undefined);
  assert.equal(out["empty.txt"], "");
});

test("a moved file, with and without changes to it, applies as a rename", () => {
  const out = applied([
    { path: "lib/c.ts", from: "src/c.ts", before: many(8), after: many(8).replace("line 4\n", "four\n") },
    { path: "lib/d.ts", from: "src/d.ts", before: "same\n", after: "same\n" },
  ]);
  assert.equal(out["lib/c.ts"], many(8).replace("line 4\n", "four\n"));
  assert.equal(out["src/c.ts"], undefined);
  assert.equal(out["lib/d.ts"], "same\n");
  assert.equal(out["src/d.ts"], undefined);
});

test("a last line that gains or loses its newline, or never had one, applies exactly", () => {
  assert.equal(applied([{ path: "a", before: "one\ntwo", after: "one\ntwo\n" }])["a"], "one\ntwo\n");
  assert.equal(applied([{ path: "b", before: "one\ntwo\n", after: "one\ntwo" }])["b"], "one\ntwo");
  assert.equal(applied([{ path: "c", before: "one\ntwo", after: "uno\ntwo" }])["c"], "uno\ntwo");
  assert.equal(applied([{ path: "d", after: "no newline" }])["d"], "no newline");
});

test("Windows line endings stay as they are", () => {
  const before = "a\r\nb\r\nc\r\n";
  const after = "a\r\nB\r\nc\r\n";
  assert.equal(applied([{ path: "w.txt", before, after }])["w.txt"], after);
});

test("a turn with nothing changed has no patch", () => {
  assert.ok("why" in patchOf([]));
});

test("files with git's status apply as that status says", () => {
  const out = applied([
    { path: "m.txt", status: "modified", before: "a\nb\n", after: "a\nB\n" },
    { path: "n.txt", status: "added", after: "new\n" },
    { path: "d.txt", status: "deleted", before: "old\n" },
    { path: "to.txt", from: "fro.txt", status: "renamed", before: "same\n", after: "same\n" },
  ]);
  assert.deepEqual(out, { "m.txt": "a\nB\n", "n.txt": "new\n", "d.txt": undefined, "to.txt": "same\n", "fro.txt": undefined });
});

test("a changed file git wouldn't show on one side (a submodule) has no patch, and says why, rather than reading as added or deleted", () => {
  // Before, the old side missing made it a new file ("already exists" from git apply), both missing made it both at once.
  for (const f of [
    { path: "vendor/lib", status: "modified" as const, after: "x\n" },
    { path: "vendor/lib", status: "modified" as const, before: "x\n" },
    { path: "vendor/lib", status: "modified" as const },
    { path: "b.txt", from: "a.txt", status: "renamed" as const, after: "x\n" },
    { path: "gone.txt", status: "deleted" as const },
    { path: "new.txt", status: "added" as const },
  ]) {
    const r = patchOf([f]);
    assert.ok("why" in r, JSON.stringify(f));
    assert.match(r.why, /couldn't be read/);
  }
});

test("a change of mode alone isn't dropped from the patch without a word: there is no patch, and it says the diff carries no modes", () => {
  const r = patchOf([{ path: "run.sh", status: "modified", before: "echo hi\n", after: "echo hi\n" }]);
  assert.ok("why" in r);
  assert.match(r.why, /mode/);
  // The same with no status, from an engine before it, reads the same way.
  assert.match((patchOf([{ path: "a", before: "x\n", after: "x\n" }]) as { why: string }).why, /mode/);
});

test("a binary file, a file cut short, a name a patch can't carry or files past the first 60 have no patch, and say why", () => {
  assert.match((patchOf([{ path: "i.png", before: "a\u0000b", after: "c\u0000d" }]) as { why: string }).why, /binary/);
  assert.match((patchOf([{ path: "big.txt", before: "a\n", after: "a\n… (cut off: the file is larger than the diff view shows)" }]) as { why: string }).why, /too large/);
  assert.match((patchOf([{ path: 'we"ird', before: "a\n", after: "b\n" }]) as { why: string }).why, /name/);
  assert.match((patchOf([{ path: "../out", before: "a\n", after: "b\n" }]) as { why: string }).why, /name/);
  assert.match((patchOf([{ path: "a", before: "a\n", after: "b\n" }], 61) as { why: string }).why, /partial/);
});

test("A file's letter in Changes follows git's word for it, so a changed submodule reads M, not A or D, though a side couldn't be read", () => {
  // Before, the letter went by the missing sides alone: a submodule git shows neither side of read as added.
  assert.equal(fileLetter({ path: "vendor/lib", status: "modified" }), "M");
  assert.equal(fileLetter({ path: "vendor/lib", status: "modified", after: "x\n" }), "M");
  assert.equal(fileLetter({ path: "vendor/lib", status: "modified", before: "x\n" }), "M");
  assert.equal(fileLetter({ path: "b.txt", from: "a.txt", status: "renamed", before: "x\n", after: "x\n" }), "R");
  assert.equal(fileLetter({ path: "n.txt", status: "added", after: "x\n" }), "A");
  assert.equal(fileLetter({ path: "d.txt", status: "deleted", before: "x\n" }), "D");
  // An engine from before `status` leaves only the sides to go by.
  assert.equal(fileLetter({ path: "n.txt", after: "x\n" }), "A");
  assert.equal(fileLetter({ path: "d.txt", before: "x\n" }), "D");
  assert.equal(fileLetter({ path: "b.txt", from: "a.txt", before: "x\n", after: "y\n" }), "R");
  assert.equal(fileLetter({ path: "m.txt", before: "x\n", after: "y\n" }), "M");
});
