# 024. Git's own spelling of a path stops fooling the Reviewer's small-change pass

**Commit message:** `A docs change with a unicode name, or a docs file renamed in its folder, reads as small to the Reviewer`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Refreshed 2026-11-20 at 13c7757 after the advisor's review. Findings: CORE-02 (HIGH for the unicode part).
The old step 1 (CORE-01, "a merge's `%P` is read as two words") is removed: `authoredPaths` reads Liner's own checkpoint
commits, which `capture()` makes with exactly one parent (`engine/src/checkpoints.ts:147-149`), so `%P` is one hash; a
probe with the real `capture`/`authoredPaths` on a merge HEAD that moved mid-turn attributed the turn's file alone.

## What the review changed

- Step 1 (CORE-01) is gone: the finding is false (above). The file name stays; the title no longer says "merges".
- A plain rename already reads small: `git diff` detects renames by default (`diff.renames`), printing
  `0\t0\tbig.ts => big2.ts`. The old "pure rename fails before" test passed before the fix; it is now a guard.
- The real rename case is a docs file renamed **inside a folder**: git prints `notes/{a.md => b.md}`, whose `}` defeats
  the docs test. That is the second failing test now.
- "-" (a binary) keeps reading as not small, through a parse local to the rule. `numstat()` in checkpoints.ts is not
  touched (`engine/src/files.ts:106` also uses it and wants "-" as 0).
- The diff gets `--no-textconv` too, as `changes()` has it. The existing pins are `engine/test/engine.test.ts:698-703`.
- The tests drive the real Reviewer path (`reviewer.test.ts`'s fake tools), and both were **seen failing** at 13c7757.

## Why this matters

The Reviewer's small-change check (`engine/src/runtime.ts:1860`) runs `git diff --relative --numstat from cp.to` with
neither `-z` nor `-M`, and `smallChange` (`contracts/src/index.ts:1194-1200`) tests the third tab-field against the docs
pattern:

```ts
export function smallChange(numstat: string) {
  const files = numstat.split("\n").filter(Boolean).map((l) => l.split("\t"));
  if (!files.length) return true;
  const docs = files.every((f) => /\.(md|mdx|txt|rst|adoc)$/i.test(f[2] ?? "") || /^docs\//.test(f[2] ?? ""));
  const lines = files.reduce((n, f) => n + (f[0] === "-" ? Infinity : Number(f[0]) + Number(f[1])), 0);
  return docs || lines <= SMALL_CHANGE;
}
```

What that command really prints (probed with git 2.55 on a scratch repo, through `smallChange`):

| Change | Output | small |
|---|---|---|
| 50 lines added to `café.md` | `50\t0\t"caf\303\251.md"` | false (the closing quote defeats `.md$`) |
| `notes/a.md` renamed to `notes/b.md`, 30 lines added | `30\t0\tnotes/{a.md => b.md}` | false (the `}` defeats `.md$`) |
| `big.ts` renamed to `big2.ts`, unchanged | `0\t0\tbig.ts => big2.ts` | true already |

So a docs-only change is sent to a full Reviewer read (a quiet model turn, up to ten minutes) when its file has a
non-ASCII name or was renamed within a folder. With `-z`, git writes each path as it is, and a rename as its own
records (old, new), which `checkpoints.ts` already parses that way (`numstat()`, :165-179, with the comment "Without
-z, git quotes a name like café.txt … which matches no file").

## Current state (drift check)

```bash
git log --oneline -1                                 # 13c7757 or later
sed -n '1853,1863p' engine/src/runtime.ts            # changeOf: the small path at :1860
sed -n '21,22p' engine/src/runtime.ts                # the contracts import (smallChange) and checkpoints import
sed -n '1190,1200p' contracts/src/index.ts           # SMALL_CHANGE and smallChange
sed -n '160,179p;186,189p' engine/src/checkpoints.ts # numstat() and changes()'s flags (do NOT change numstat)
sed -n '696,704p' engine/test/engine.test.ts         # the existing smallChange pins
sed -n '36,66p' engine/test/reviewer.test.ts         # fakeTools, the harness the new tests extend
grep -rn "smallChange" engine/src contracts/src ui/src/app   # changeOf should be the only caller
```

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first. Test commands need
  `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push.

## Steps

### 1. The small-change pass reads -z records (CORE-02)

**Test first** (add to `engine/test/reviewer.test.ts`, which already has the harness):
- Give `fakeTools` one more option, `write?: (cwd: string) => void`: when set, a writing turn calls it instead of writing
  its `${name}.ts` file, then says "Done." (one line before `const name = …`:
  `if (o.write) return void (o.write(opts.cwd), sink.text("Done."));`). Nothing else in the helper changes.
- Four tests. Each starts a session with `session()`, sends one message with `runtime.send`, and asserts `order(calls)`:
  - "reviewer: a fifty-line change to a unicode-named markdown file goes through as small": the turn writes 50 lines to
    `café.md`; expect `["claude-sonnet-5-5 writes"]` (no read). **Seen failing at 13c7757**: actual has
    `"gpt-6-sol reads"`.
  - "reviewer: a docs file renamed within its folder, with an edit, goes through as small": before sending, write
    `notes/a.md` (40 lines) and commit it (the `git` helper inside `session()` isn't returned, so run git as `session()`
    does, with `-c commit.gpgsign=false -c core.hooksPath=/dev/null`); the turn renames it to `notes/b.md` and appends 30
    lines; expect no read. **Seen failing at 13c7757** the same way.
  - Guard, passes before and after: "reviewer: a pure rename of a large file goes through as small" (commit a 500-line
    `big.ts`, the turn renames it to `big2.ts`).
  - Guard, passes before and after: "reviewer: a binary change is read" (the turn writes a few PNG bytes to `logo.png`;
    expect `["claude-sonnet-5-5 writes", "gpt-6-sol reads"]`).
  The existing "ten lines of code are read" behaviour is already covered by the file's other tests.

**Fix:**
- In `contracts/src/index.ts`, beside `smallChange`, add a sibling that takes `git diff --numstat -z` output and hands
  `smallChange` its records as tab lines, so the rule (docs pattern, SMALL_CHANGE, "-" as Infinity) stays in one place:

```ts
/**
  The same rule over `git diff --numstat -z`: a rename is its new path, and a name like café.md is itself, not git's
  quoted spelling. "-" (a binary) still counts as more than small.
*/
export function smallChangeZ(numstat: string) {
  const rec = numstat.split("\0");
  const files: string[][] = [];
  for (let i = 0; i < rec.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(rec[i]);
    if (!m) continue;
    let path = rec[i].slice(m[0].length);
    if (!path) {
      path = rec[i + 2] ?? "";
      i += 2;
    }
    files.push([m[1], m[2], path]);
  }
  return smallChange(files.map((f) => f.join("\t")).join("\n"));
}
```

  (The record walk is the one `checkpoints.ts numstat()` uses: a rename's counts come with an empty path, then its old
  and new paths as records of their own.)
- In `engine/src/runtime.ts` `changeOf` (:1860): run
  `["diff", "--relative", "--no-ext-diff", "--no-textconv", "-M", "-z", "--numstat", from, cp.to]` and call
  `smallChangeZ` on its stdout. In the import at :21 swap `smallChange` for `smallChangeZ` (the only caller; keep
  `smallChange` exported, `engine.test.ts` pins it). The full-diff path (:1861) stays as it is.
- Do not change SMALL_CHANGE, the docs pattern, `numstat()`, or the reviewSmall setting.

The advisor tried exactly this in a scratch worktree: the four tests pass, `reviewer.test.ts` and `engine.test.ts`
pass (68/68), and the engine typecheck is clean.

**Verify:**
`env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/reviewer.test.ts engine/test/engine.test.ts`
passes; `npm run typecheck -w engine` exits 0.

## Done

- The two new reviewer tests fail before the fix and pass after; the two guards pass both times; the
  `engine.test.ts:698-703` pins still pass; `npm run typecheck` exits 0.
- One commit, the message above. Executor note in `plans/README.md`: the commit, and that CORE-01 was dropped as false.

## STOP conditions

- `grep smallChange` finds a caller besides `changeOf` that passes non-`-z` output: keep `smallChange` for it (it stays
  exported anyway) and say so in the note.
- Either new test passes before the fix on your machine: check `git config --get diff.renames` and `core.quotepath` in
  your global config (both change git's spelling); report the git version and config instead of weakening the test.

## Maintenance note

Any new git parsing should use `-z` and walk the records as `numstat()` does; a path git prints without `-z` can be
C-quoted (`"caf\303\251.md"`) or a rename's brace form (`notes/{a.md => b.md}`). The small-change rule lives in one
function, `smallChange`; `smallChangeZ` only feeds it.
