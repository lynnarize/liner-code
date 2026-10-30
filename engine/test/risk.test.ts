/*
  What runs without asking, read off the command itself: a read-only command in Auto or Reviewer
  decides, a "don't ask again" rule, and the Reviewer's one-line call on a step. Each way a command
  could slip something else past them stays closed. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStep } from "../src/review.ts";
import { readsOnly, ruleFor } from "../src/risk.ts";

test("reads: what only reads still does, piped, chained or quoted", () => {
  for (const c of ["ls -la", "git status && git diff", "rg foo src | head", "cat a.txt", "sed -n '1,20p' file", "sed -n '/<script>/,/<\\/script>/p' index.html", "sed -n 's/version: \\(.*\\)/\\1/p' a.yml", "rg -o 'foo.*' src", "tree -L 2 src", "git log --oneline -n 5", "find . -name '*.ts'", "bash -lc 'ls src'"]) assert.equal(readsOnly(c), true, c);
});

test("reads: a lone & or a new line starts another command, which has to read too", () => {
  for (const c of ["ls & rm -r src", "ls\nrm -r src", "ls\r\nrm -r src", "git status\nrm -r src", "cat package.json & npm install evil", `ls & node -e 'require("fs").rmSync("src",{recursive:true})'`, "bash -lc 'ls & rm -r src'", "ls &"]) assert.equal(readsOnly(c), false, JSON.stringify(c));
});

test("reads: a reader's flags that run a command or write a file don't read", () => {
  for (const c of ["rg --pre ./x.sh foo", "rg --pre=./x.sh foo src", "sed -n '1w out.txt' in.txt", "sed -n 'w out.txt' in.txt", "sed -n '/a/W out' in", "sed -n '1e rm -r src' in", "sed -n 's/a/b/w out.txt' in", "sed -n 's/a/b/e' in", "sed -n -e 'p' -e '1w out' in", "sed -n -f script.sed in", "tree -o out.txt", "file -C -m magic", "git diff --output=patch.diff", "git log --output out.txt", "find . -fls out.txt", "sed '1,20p' file"]) assert.equal(readsOnly(c), false, c);
});

test("rules: a compound command, a shell or a wrapper gets no rule to allow", () => {
  assert.equal(ruleFor("ls & rm -r src"), undefined);
  assert.equal(ruleFor("ls\nrm -r src"), undefined);
  assert.equal(ruleFor("git status\nrm -r src"), undefined);
  assert.equal(ruleFor("git status\r\nrm -r src"), undefined);
  assert.equal(ruleFor("bash -lc 'ls & rm -r src'"), undefined);
  assert.equal(ruleFor("env rm -r src"), undefined);
  assert.equal(ruleFor("xargs rm -r"), undefined);
  assert.equal(ruleFor("git status"), "git status");
  assert.equal(ruleFor(`cd "/Users/me/app" && npm test`), "npm test");
  assert.equal(ruleFor("ls -la src"), "ls");
});

test("reviewer decides: the call is the last line that starts with ALLOW or ASK", () => {
  assert.equal(parseStep("I can't ALLOW this. ASK: it deletes files"), null, "a word in passing isn't a call");
  assert.deepEqual(parseStep("Should I ALLOW it?\nASK: it pushes to the remote"), { allow: false, reason: "it pushes to the remote" });
  assert.deepEqual(parseStep("ALLOW: reads a file\nASK: on second look, it writes outside the folder"), { allow: false, reason: "on second look, it writes outside the folder" });
  assert.deepEqual(parseStep("**ALLOW**: runs the tests"), { allow: true, reason: "runs the tests" });
  assert.deepEqual(parseStep("  ASK — touches ~/.ssh"), { allow: false, reason: "touches ~/.ssh" });
  assert.equal(parseStep("Nothing to say"), null);
});
