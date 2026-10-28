/*
  The picture a pull request card draws: your branch's commits on a line above the base, what
  reached the base since you branched, and the lines where the two clash. Conflicts come from
  git's own three-way merge, run in the object store (`git merge-tree`), so the checkout is
  never touched. Before it goes up, the card runs the project's tests (`testCommand`) and says
  how they went (`testSummary`).
*/
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrPicture } from "../../contracts/src/index.ts";
import { run } from "./exec.ts";

const git = (cwd: string, args: string[]) => run("git", args, { cwd, timeout: 60000 });
const SEP = "\x1f";

/** The lines where your branch and the base both changed the same place, one pair each. */
export function parseMergeTree(out: string): PrPicture["conflicts"] {
  const found: PrPicture["conflicts"] = [];
  let file = "";
  let oldLine = 0;
  let side: "none" | "ours" | "theirs" = "none";
  let ours: { text: string; line: number }[] = [];
  let theirs: string[] = [];
  for (const raw of out.split("\n")) {
    if (/^(changed|added|removed) in /.test(raw)) {
      side = "none";
      continue;
    }
    const entry = /^ {2}(our|their|base|result) +\d+ [0-9a-f]+ (.+)$/.exec(raw);
    if (entry) {
      if (entry[1] === "our" || entry[1] === "result" || !file) file = entry[2];
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      side = "none";
      continue;
    }
    if (!raw.length || !" +-".includes(raw[0])) continue;
    const mark = raw[0];
    const text = raw.slice(1);
    if (text.startsWith("<<<<<<< ")) {
      side = "ours";
      ours = [];
      theirs = [];
      continue;
    }
    if (side === "ours" && text.startsWith("=======")) {
      side = "theirs";
      continue;
    }
    if (side === "theirs" && text.startsWith(">>>>>>> ")) {
      const yours = ours.find((l) => l.text.trim()) ?? ours[0];
      const base = theirs.find((l) => l.trim()) ?? theirs[0] ?? "";
      found.push({ id: `${file}:${yours?.line ?? oldLine}:${found.length}`, file, line: yours?.line ?? oldLine, yours: (yours?.text ?? "").trim().slice(0, 140), base: base.trim().slice(0, 140) });
      side = "none";
      continue;
    }
    // The diff runs from your side to the merge, so your lines keep your file's numbers.
    if (side === "ours") ours.push({ text, line: oldLine });
    else if (side === "theirs") theirs.push(text);
    if (mark !== "+") oldLine++;
  }
  return found.slice(0, 24);
}

/** Your branch against the base it goes into (a remote ref when there is one). */
export async function picture(cwd: string, baseRef: string): Promise<Omit<PrPicture, "branch" | "base">> {
  const mb = (await git(cwd, ["merge-base", "HEAD", baseRef])).stdout.trim();
  if (!mb) return { ahead: 0, behind: 0, branchCommits: [], baseCommits: [], conflicts: [], diff: { add: 0, del: 0 } };
  const [mine, theirs, stat, tree] = await Promise.all([
    git(cwd, ["log", "--reverse", "-n", "12", `--format=%h${SEP}%s`, `${mb}..HEAD`]),
    git(cwd, ["log", "--reverse", "-n", "8", `--format=%h${SEP}%an${SEP}%ar${SEP}%s`, `${mb}..${baseRef}`]),
    git(cwd, ["diff", "--shortstat", mb, "HEAD"]),
    git(cwd, ["merge-tree", mb, "HEAD", baseRef]),
  ]);
  const lines = (s: string) => s.split("\n").filter(Boolean);
  const branchCommits = lines(mine.stdout).map((l) => {
    const [sha, title] = l.split(SEP);
    return { sha, title };
  });
  const baseCommits = lines(theirs.stdout).map((l) => {
    const [sha, who, when, title] = l.split(SEP);
    return { sha, who, when, title };
  });
  const [ahead, behind] = await Promise.all([git(cwd, ["rev-list", "--count", `${mb}..HEAD`]), git(cwd, ["rev-list", "--count", `${mb}..${baseRef}`])]);
  const add = Number(/(\d+) insertion/.exec(stat.stdout)?.[1] ?? 0);
  const del = Number(/(\d+) deletion/.exec(stat.stdout)?.[1] ?? 0);
  return { ahead: Number(ahead.stdout.trim()) || 0, behind: Number(behind.stdout.trim()) || 0, branchCommits, baseCommits, conflicts: baseCommits.length ? parseMergeTree(tree.stdout) : [], diff: { add, del } };
}

/**
  What runs a project's tests before its pull request goes up: a project script named Test
  first, then the project's own test script (by its package manager), then each toolchain's
  usual command. Undefined when there's nothing to run.
*/
export function testCommand(cwd: string, scripts: { name: string; command: string }[] = []): string | undefined {
  const own = scripts.find((s) => /^(run\s+)?(the\s+)?tests?$/i.test(s.name.trim()));
  if (own) return own.command;
  const has = (f: string) => existsSync(join(cwd, f));
  if (has("package.json")) {
    try {
      const test = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"))?.scripts?.test;
      // npm init's placeholder only says there are none.
      if (typeof test === "string" && test.trim() && !/no test specified/.test(test)) {
        if (has("pnpm-lock.yaml")) return "pnpm test";
        if (has("yarn.lock")) return "yarn test";
        if (has("bun.lock") || has("bun.lockb")) return "bun run test";
        return "npm test";
      }
    } catch {
      // not JSON: look further
    }
  }
  if (has("Cargo.toml")) return "cargo test";
  if (has("go.mod")) return "go test ./...";
  if (has("Package.swift")) return "swift test";
  if (has("pytest.ini") || (has("pyproject.toml") && /\[tool\.pytest/.test(readFileSync(join(cwd, "pyproject.toml"), "utf8")))) return "pytest";
  if (has("Makefile") && /^test\s*:/m.test(readFileSync(join(cwd, "Makefile"), "utf8"))) return "make test";
  return undefined;
}

/** "3 passed", "2 failed, 40 passed": what a test run's output says, in the common runners' words. */
export function testSummary(out: string, ok: boolean): string {
  const say = (failed: number, passed: number) => (failed ? `${failed} failed${passed ? `, ${passed} passed` : ""}` : `${passed} passed`);
  let m: RegExpExecArray | null;
  // node --test
  const nodePass = /^ℹ pass (\d+)$/m.exec(out);
  if (nodePass) return say(Number(/^ℹ fail (\d+)$/m.exec(out)?.[1] ?? 0), Number(nodePass[1]));
  // vitest: "Tests  2 failed | 40 passed (42)"
  if ((m = /^\s*Tests\s+(?:(\d+) failed \| )?(?:\d+ skipped \| )?(\d+) passed/m.exec(out))) return say(Number(m[1] ?? 0), Number(m[2]));
  // jest: "Tests:       2 failed, 40 passed, 42 total"
  if ((m = /^Tests:\s+(?:(\d+) failed, )?(?:\d+ skipped, )?(?:(\d+) passed, )?\d+ total/m.exec(out))) return say(Number(m[1] ?? 0), Number(m[2] ?? 0));
  // cargo, once per test binary
  const cargo = [...out.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed/g)];
  if (cargo.length) return say(cargo.reduce((s, x) => s + Number(x[2]), 0), cargo.reduce((s, x) => s + Number(x[1]), 0));
  // pytest: "==== 2 failed, 40 passed in 1.2s ===="
  if ((m = /=+ (?:(\d+) failed,? ?)?(?:(\d+) passed)?.* in [\d.]+s/.exec(out)) && (m[1] || m[2])) return say(Number(m[1] ?? 0), Number(m[2] ?? 0));
  // swift: "Executed 12 tests, with 1 failure"
  if ((m = /Executed (\d+) tests?, with (\d+) failures?/.exec(out))) return say(Number(m[2]), Number(m[1]) - Number(m[2]));
  // go: one line per package
  const goOk = (out.match(/^ok\s+\S+/gm) ?? []).length;
  const goFail = (out.match(/^FAIL\s+\S+/gm) ?? []).length;
  if (goOk || goFail) return goFail ? `${goFail} ${goFail === 1 ? "package" : "packages"} failed` : `${goOk} ${goOk === 1 ? "package" : "packages"} passed`;
  return ok ? "Passed" : "Failed";
}
