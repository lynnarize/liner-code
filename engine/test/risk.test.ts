/*
  What runs without asking, read off the command itself: a read-only command in Auto or Reviewer
  decides, a "don't ask again" rule, and the Reviewer's one-line call on a step. Each way a command
  could slip something else past them stays closed. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStep } from "../src/review.ts";
import { commandRisk, isDestructive, plainGit, readsOnly, ruleFor } from "../src/risk.ts";

test("reads: what only reads still does, piped, chained or quoted", () => {
  for (const c of ["ls -la", "git status && git diff", "rg foo src | head", "cat a.txt", "sed -n '1,20p' file", "sed -n '/<script>/,/<\\/script>/p' index.html", "sed -n 's/version: \\(.*\\)/\\1/p' a.yml", "rg -o 'foo.*' src", "tree -L 2 src", "git log --oneline -n 5", "find . -name '*.ts'", "bash -lc 'ls src'"]) assert.equal(readsOnly(c), true, c);
  for (const c of [`cat "$HOME/a b"`, `sed -n '1,20p' "src/a b.ts"`, `rg -n "foo\\.bar" src`, `ls 'a"b'`, `echo "it's"`, "git log | head", "/bin/zsh -lc 'cat math.js'", "find . -type f -name '*.md'"]) assert.equal(readsOnly(c), true, c);
});

test("reads: quotes pair the way the shell pairs them, so none can hide a command", () => {
  for (const c of [`echo \\'; touch pwned; echo \\'`, `echo "it's"; touch pwned; echo "'"`, `echo "$x'"; touch pwned; echo "'"`, `echo "a`, `echo 'a`, `echo "\`touch pwned\`"`, `echo "$(touch pwned)"`, `ls a\\;touch pwned`]) assert.equal(readsOnly(c), false, c);
  // A comment hides a quote, an outer shell's quotes can end mid-script, $'…' escapes a quote, and zsh runs code from ( ).
  for (const c of ["echo x #'\ntouch pwned\n#'", `bash -c 'echo a'"; touch pwned; echo "'b'`, `bash -c "echo '$(touch pwned)'"`, `echo $'\\'' ; touch pwned ; echo "'"`, "cat =(touch pwned)", "ls *(e:'touch pwned':)", "echo ${(e):-'$(touch pwned)'}", `echo "\${(e):-\\$(touch pwned)}"`]) assert.equal(readsOnly(c), false, JSON.stringify(c));
});

test("reads: a lone & or a new line starts another command, which has to read too", () => {
  for (const c of ["ls & rm -r src", "ls\nrm -r src", "ls\r\nrm -r src", "git status\nrm -r src", "cat package.json & npm install evil", `ls & node -e 'require("fs").rmSync("src",{recursive:true})'`, "bash -lc 'ls & rm -r src'", "ls &"]) assert.equal(readsOnly(c), false, JSON.stringify(c));
});

test("reads: a reader's flags that run a command or write a file don't read", () => {
  for (const c of ["rg --pre ./x.sh foo", "rg --pre=./x.sh foo src", "sed -n '1w out.txt' in.txt", "sed -n 'w out.txt' in.txt", "sed -n '/a/W out' in", "sed -n '1e rm -r src' in", "sed -n 's/a/b/w out.txt' in", "sed -n 's/a/b/e' in", "sed -n -e 'p' -e '1w out' in", "sed -n -f script.sed in", "tree -o out.txt", "file -C -m magic", "git diff --output=patch.diff", "git log --output out.txt", "find . -fls out.txt", "sed '1,20p' file"]) assert.equal(readsOnly(c), false, c);
  for (const c of ["find . '-delete'", `find . "-delete"`, `find . "-exec" rm {} +`, "find . -execdir rm {} ;", "find . -fprint0 out", "find . -del'ete'", "rg --hostname-bin=touch --hyperlink-format=default x", "rg --hostname-bin ./x.sh foo"]) assert.equal(readsOnly(c), false, c);
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

test("rules: a leading variable or a program by another path doesn't pass for the plain command", () => {
  for (const c of ["PATH=/tmp/x git status", "GIT_EXTERNAL_DIFF=./x.sh git diff", "NODE_OPTIONS='--require ./p.js' npm test", `cd app && CI=1 npm test`]) assert.equal(ruleFor(c), undefined, c);
  assert.equal(ruleFor("./git status"), "./git status");
  assert.equal(ruleFor("/tmp/evil/npm test"), "/tmp/evil/npm test");
  assert.equal(ruleFor("/usr/bin/git status"), "/usr/bin/git status");
  assert.equal(ruleFor("/bin/bash -c 'ls'"), undefined);
});

test("rules: a flag in front of the subcommand gives a rule for that command alone, and none in git's own case", () => {
  for (const c of ["xcodebuild -scheme App build", "make -j8 test", "npm --prefix ui run build", "pnpm --filter ui build"]) assert.equal(ruleFor(c), c, c);
  assert.equal(ruleFor("cd app && make  -j8   test"), "make -j8 test", "the rule doesn't change with the spacing");
  // One command's rule can't allow another written the same way.
  assert.notEqual(ruleFor("npm --prefix ui install evil"), ruleFor("npm --prefix ui run build"));
  assert.notEqual(ruleFor("make -j8 deploy"), ruleFor("make -j8 test"));
  for (const c of ["git -C x status", "git -C x push", "git --no-pager log", "git -c core.x=y status", "/usr/bin/git -C x status"]) assert.equal(ruleFor(c), undefined, c);
  // Nor is what can't be undone allowed for good, flags or no.
  for (const c of ["npm --prefix app publish", "pnpm --filter ui publish"]) assert.equal(ruleFor(c), undefined, c);
  assert.equal(ruleFor("make test"), "make test");
  assert.equal(ruleFor("make"), "make");
});

test("risk: what's in a quoted option counts, and a quoted value ends where the shell ends it", () => {
  // An alias is the command itself, so it's read as written.
  for (const c of [`git -c alias.x='!rm -rf ~' x`, `git -c "alias.x=!rm -rf ~" x`, `git -c alias.x='!git reset --hard' x`, `git -c ALIAS.x='!git push --force' x`]) {
    assert.equal(commandRisk(c), "high", c);
    assert.equal(isDestructive(c), true, "so Full access's guard asks");
  }
  assert.equal(commandRisk(`git -c alias.x='!git push' x`), "medium", "the lesser list reads it as written too");
  assert.equal(plainGit(`git -c alias.x='!git push' x`), `git -c alias.x='!git push' x`, "and so does a routine's check for what leaves this Mac");
  // A quoted space stays in the value, whichever quotes and wherever they start.
  for (const c of [`git -c user.name='A B' reset --hard`, `git -c user.name="A B" clean -fd`, `git -c "user.name=A B" push --force`, `git -C "/a b" -c k='c d' branch -D main`, `git --git-dir="/a b/.git" reset --hard`]) assert.equal(commandRisk(c), "high", c);
  assert.equal(plainGit(`git -c user.name='A B' commit -m x`), "git commit -m x");
  assert.equal(commandRisk(`git -c user.name='A B' commit -m x`), "medium");
  assert.equal(commandRisk(`git -c user.name='A B' status`), "low", "what only reads stays as it is");
  // A folder called alias.* is only a folder.
  assert.equal(commandRisk("git -C alias.dir reset --hard"), "high");
});

test("risk: any of git's --options in front doesn't hide the command, known to us or not", () => {
  for (const c of ["git --no-advice reset --hard", "git --exec-path=/x reset --hard", "git --html-path --no-advice clean -fd", "git --no-lazy-fetch push --force", "git --attr-source HEAD reset --hard", "git --attr-source=HEAD reset --hard", "git --namespace x branch -D main", "git -P reset --hard", "git status && git --no-advice reset --hard"]) assert.equal(commandRisk(c), "high", c);
  assert.equal(commandRisk("git --no-advice push"), "medium");
  for (const c of ["git --no-advice status", "git --version", "git --no-pager log --oneline"]) assert.equal(commandRisk(c), "low", c);
  assert.equal(plainGit("git --no-advice --exec-path=/x log"), "git log");
  assert.equal(plainGit("git log --oneline reset --hard"), "git log --oneline reset --hard", "only what's in front of the command goes");
});

test("risk: flags in front of publish don't hide it, and a script named after it isn't it", () => {
  for (const c of ["npm --prefix app publish", "pnpm --filter ui publish", "cargo --locked publish", "npm publish"]) assert.equal(commandRisk(c), "high", c);
  for (const c of ["npm run publish", "npm --prefix ui run publish-docs"]) assert.equal(commandRisk(c), "low", c);
});

test("risk: cargo's +toolchain doesn't hide publish, and a rule from one command can't carry another", () => {
  for (const c of ["cargo +nightly publish", "cargo +1.80.0 --locked publish", "cargo --locked +nightly publish"]) assert.equal(commandRisk(c), "high", c);
  assert.equal(ruleFor("cargo +nightly publish"), undefined);
  assert.equal(ruleFor("cargo +nightly test"), "cargo +nightly test", "that one again and nothing else");
  assert.notEqual(ruleFor("cargo +nightly test"), ruleFor("cargo +nightly build"));
  assert.equal(commandRisk("cargo +nightly test"), "low");
  assert.equal(ruleFor("cargo test"), "cargo test");
});

test("reviewer decides: the call is the last line that starts with ALLOW or ASK", () => {
  assert.equal(parseStep("I can't ALLOW this. ASK: it deletes files"), null, "a word in passing isn't a call");
  assert.deepEqual(parseStep("Should I ALLOW it?\nASK: it pushes to the remote"), { allow: false, reason: "it pushes to the remote" });
  assert.deepEqual(parseStep("ALLOW: reads a file\nASK: on second look, it writes outside the folder"), { allow: false, reason: "on second look, it writes outside the folder" });
  assert.deepEqual(parseStep("**ALLOW**: runs the tests"), { allow: true, reason: "runs the tests" });
  assert.deepEqual(parseStep("  ASK — touches ~/.ssh"), { allow: false, reason: "touches ~/.ssh" });
  assert.equal(parseStep("Nothing to say"), null);
});
