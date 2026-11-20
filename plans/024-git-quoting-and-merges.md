# 024. Git's own quoting and merges stop fooling the turn's attribution and the Reviewer's small-change pass

**Commit message:** `A merge at the turn's start no longer disables its attribution, and a unicode docs change or a pure rename reads as small to the Reviewer`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Findings: CORE-01 (MED), CORE-02 (HIGH). Every excerpt below is from the advisor's own read.

## Why this matters

1. **CORE-01.** `authoredPaths` (`engine/src/checkpoints.ts:226-252`) asks git for the two snapshots' parents and
   times with `--format=%P %ct` and splits on spaces:

```ts
  const heads = await git(cwd, ["log", "--no-walk=unsorted", "--format=%P %ct", `${from}^{commit}`, `${to}^{commit}`]);
  if (heads.code !== 0) return null;
  const [fromLine = "", toLine = ""] = heads.stdout.trimEnd().split("\n");
  const [start = "", at = ""] = fromLine.split(" ");
  const [end = ""] = toLine.split(" ");
```

   A MERGE commit prints TWO parents, so `at` becomes the second parent's hash, not the commit time. `--since=@${at}`
   (:244) then fails to parse, `list()` throws, and the catch (:248-251, "An older git without remerge diffs") returns
   null — which `changes()` reads as "HEAD stayed put, every change is the turn's". When HEAD was a merge at the
   turn's start and moved during it (a pull or merge mid-turn), files the pull brought in are attributed to the turn:
   its diff card shows them, and Undo puts back files the turn never wrote. The fallback fires on current git too.
2. **CORE-02.** The Reviewer's small-change check (`engine/src/runtime.ts:1860`) runs
   `git diff --relative --numstat from cp.to` with NEITHER `-z` NOR `-M`, and `smallChange`
   (`contracts/src/index.ts:1194-1200`) tests the third tab-field against `/\.(md|mdx|txt|rst|adoc)$/i`:

```ts
export function smallChange(numstat: string) {
  const files = numstat.split("\n").filter(Boolean).map((l) => l.split("\t"));
  if (!files.length) return true;
  const docs = files.every((f) => /\.(md|mdx|txt|rst|adoc)$/i.test(f[2] ?? "") || /^docs\//.test(f[2] ?? ""));
  const lines = files.reduce((n, f) => n + (f[0] === "-" ? Infinity : Number(f[0]) + Number(f[1])), 0);
  return docs || lines <= SMALL_CHANGE;
}
```

   Without `-z`, git C-quotes a non-ASCII path (`"caf\303\251.md"`) — the trailing quote defeats the docs test.
   Without `-M`, a rename reads as delete+add with full line counts. So a 50-line docs-only change with one unicode
   file name, or a pure rename of a large file, is never "small": it costs a full Reviewer read (a quiet model turn,
   up to ten minutes) instead of passing through. The checkpoint path already knows this — `changes()` uses `-M -z`
   (:187) and `numstat()` (:165-179) parses the -z records, with the comment "Without -z, git quotes a name like
   café.txt … which matches no file" (:163).

## Current state (drift check)

```bash
git log --oneline -1                                # bfb0ebc or later
sed -n '226,252p' engine/src/checkpoints.ts         # authoredPaths
sed -n '160,179p;186,189p' engine/src/checkpoints.ts # numstat() and changes()'s -M -z
sed -n '1853,1863p' engine/src/runtime.ts           # changeOf's small path
sed -n '1190,1200p' contracts/src/index.ts          # SMALL_CHANGE and smallChange
```

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first. Scratch-repo pattern:
  `engine/test/checkpoints.test.ts` builds temp git repos and runs real git. Test commands need
  `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push. Steps independent.

## Steps

### 1. Read the parent line as parents PLUS a time (CORE-01)

In `authoredPaths`:
- Change the format to separate the fields unambiguously: `--format=%P%x09%ct` (a tab between the parents and the
  time). Parse each line by the TAB: the time is the field after the last tab; the parents are the field before it;
  `start`/`end` remain the FIRST parent hash (`parents.split(" ")[0]`), keeping the existing first-parent semantics
  and the `start === end` early return. A root commit (empty %P) still yields an empty start → null, as today.
- One comment saying why: a merge prints two parents, and a space-split read the second as the time.
- Do not change the remerge-diff lists, the prefix handling, or the null fallback (it stays for genuine failures).

**Test first** (`engine/test/authored-paths.test.ts`, scratch repo): build a repo where HEAD is a MERGE commit at the
turn's start (branch, commit on each side, merge --no-ff), take `from` at the merge, make a turn commit that writes
file A, then bring in an unrelated commit via a second parent line or a pull-like fast-forward that writes file B
(the simplest: `to` = a descendant merge that merged a branch writing B during the "turn"). Call
`authoredPaths(cwd, from, to)`; assert it returns a Set containing A and NOT B. Before the fix it returns null (the
`--since=@<hash>` failure) — see it fail. Also pin: a non-merge HEAD still works (the existing case), and HEAD staying
put still returns null.
**Verify:** `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/authored-paths.test.ts` and
`engine/test/checkpoints.test.ts` pass; engine typecheck exits 0.

### 2. The small-change numstat comes with -z and -M, parsed as the checkpoint path parses it (CORE-02)

- In `contracts/src/index.ts`, add a counts-based sibling beside `smallChange` (keep `smallChange` for any other
  caller — grep it first; if changeOf is the only caller, refactor it to delegate and say so):

```ts
/** The same rule over parsed -z numstat counts (checkpoints.numstat): a rename is its new path with its own counts,
    and a unicode path is itself, not git's quoted spelling. */
export function smallCounts(counts: Map<string, [number, number]>): boolean {
  if (!counts.size) return true;
  let lines = 0;
  let docs = true;
  for (const [path, [a, r]] of counts) {
    if (!/\.(md|mdx|txt|rst|adoc)$/i.test(path) && !/^docs\//.test(path)) docs = false;
    lines += a + r;
  }
  return docs || lines <= SMALL_CHANGE;
}
```

  (Binary counts: `numstat()` already maps "-" to 0 — a binary-only change reads as 0 lines, which matches the old
  code's Infinity→not-small? NO: the old code treats "-" as Infinity (not small). Preserve that: carry binary as a
  flag. Read numstat(): it maps "-" to 0, losing the binary distinction. Either extend numstat to keep "-" as
  Infinity in the tuple, or have smallCounts take the raw records. Choose the smallest change that keeps the OLD
  semantics for binaries — a binary change must NOT read as small. Pin it with a test either way.)
- In `engine/src/runtime.ts`'s `changeOf` (:1860): run the small-path diff with `-M -z`
  (`["diff", "--relative", "--no-ext-diff", "-M", "-z", "--numstat", from, cp.to]`), parse with `numstat()`
  (import from `./checkpoints.ts` — runtime already imports from it; verify), and call `smallCounts`. The full-diff
  path (:1861) stays as it is.
- Do not change SMALL_CHANGE, the docs extensions, or the reviewSmall setting's behaviour.

**Test first** (`engine/test/small-change.test.ts`): scratch repo + real git, producing the numstat stdout the same
way changeOf does, then the parse+rule chain:
- "a fifty-line change in a unicode-named markdown file reads as small" (café.md, 50 lines changed, nothing else) —
  fails before (quoted path defeats docs, 50 > 6).
- "a pure rename of a large file reads as small" (git mv of a 500-line file, no content change) — fails before
  (delete+add counts).
- "a binary change does not read as small" (a PNG byte change) — passes before and after (the semantics guard).
- "a fifty-line code change does not read as small" — guard.
- "an ascii docs-only change still reads as small" — guard.
Plus a contracts unit test of smallCounts over hand-built maps (empty → true, docs-only → true, few lines → true).
**Verify:** the new tests, `engine/test/reviewer.test.ts` (the small-change behaviour it pins), engine typecheck.

## Done

- Both new test files fail before their fixes and pass after; checkpoints.test.ts and reviewer.test.ts still pass;
  `npm run typecheck` exits 0.
- One commit, the message above. Executor note: commit, the binary-semantics choice you made, any STOP.

## STOP conditions

- Step 1: the scratch-repo merge scenario cannot be built as described (git version differences): stop, report the
  git version and what you tried — do not weaken the assertion.
- Step 2: keeping the binary semantics requires changing `numstat()`'s public shape and other callers depend on the
  0-mapping: stop and report; a separate records-based parser may be the answer, but decide with the caller list in
  hand, not by guess.
- `smallChange` has callers beyond changeOf that pass non-`-z` output: keep it working for them (delegate only the
  -z path), and say so.

## Maintenance note

Any new git parsing should use `-z` and the existing `numstat()`/record parsers — the quoting bug class is now pinned
twice (checkpoints and the Reviewer). A merge commit's `%P` is plural: never space-split a format that contains it.
