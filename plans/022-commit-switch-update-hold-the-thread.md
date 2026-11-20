# 022. A commit, a branch switch, a tool update and an automatic pull hold their sessions: no turn starts beside them

**Commit message:** `A commit, a branch switch, a tool update and an automatic pull hold their sessions, so no turn starts beside them`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Refreshed 2026-11-20 at 13c7757 after the advisor's review. Findings: CORE-06 (HIGH), CORE-10 (MED), CORE-09 (now a fix,
not an investigation). engine/src is unchanged since bfb0ebc, so the line numbers below hold at 13c7757.

## What the review changed

- Step 1 stands as written, and the advisor ran it: wrapped in `runtime.exclusive`, a message sent mid-commit waits in
  the queue and goes after; no deadlock (`hold` is a counter, not a lock); 62/62 in the two api test files. The test now
  copies `audit-api-turns.test.ts`'s undo-lock test. **Seen failing** at 13c7757.
- Step 1 names a side effect: while `exclusive` holds, a turn the tool starts by itself (a wake) is cancelled, not
  deferred (`runtime.ts:534`). Accepted for a commit, as for an undo.
- Step 2 says plainly that a per-thread hold leaves the OTHER sessions in the same checkout free to start a turn mid-switch.
  Step 4's folder hold closes that, and step 4 moves the switch onto it.
- Step 3 gates the update where a tool actually opens: `Runtime.openSession` and the two one-off opens (`quiet`,
  `plain`). A message sent to that tool meanwhile shows in the queue with a note, and goes when the update ends.
  `thread.send` is not touched. **Seen failing** at 13c7757; the fix was tried in a scratch worktree and passes.
- Step 4 is now a fix, not an investigation. The race is plain in the code and was **seen failing**: a send during
  autoPull's `git pull` started a turn. The slow pull comes from `remote.origin.uploadpack` pointing at a script that
  sleeps. The fix is a bounded `Runtime.folderExclusive`, tried in a scratch worktree (both its tests pass, and the
  watch, turns and api suites still do).

## Why this matters

The runtime already has the mechanism: `runtime.exclusive(threadId, work)` (`engine/src/runtime.ts:429-434`) holds the
thread and marks it halted. Its comment: "no turn, review or wake starts meanwhile. A message sent meanwhile waits in
the queue and goes when this ends." `checkpoint.revert` uses it (`engine/src/api.ts:1552-1570`). Four paths that change
the checkout or the tool were left outside any hold:

1. **CORE-06.** `git.commit` (`api.ts:1640-1686`) checks `idleOr` once, then awaits `prefixOf`, two `ls-files`,
   `git add` and a commit that may run hooks for up to 10 minutes (:1672). `git.switch` (:1612-1624) is the same shape.
   `runtime.send` only queues when `running || this.busy.has(threadId)` (`runtime.ts:1264`), and neither path sets
   `busy`: a message sent during those awaits starts a turn beside them, and the commit's checkpoint bookkeeping (the
   `open` list read at :1644, before the awaits) never covers what that turn writes.
2. **CORE-10.** The updater picks a tool only when `this.busy.working(t.id) === 0` (`engine/src/updates.ts:720`), then
   runs its updater for up to 15 minutes (:762). Nothing stops a session of that tool opening while its files are being
   replaced. Auto updates wait for idle, which is exactly when a person may send.
3. **CORE-09.** `Watch.pull` (`engine/src/watch.ts:46-56`) checks `busy(p.path)` before and after reading status, then
   awaits `git pull --ff-only` with nothing holding the checkout: a send during the pull's network time starts a turn
   in a tree that is being fast-forwarded.

## Current state (drift check)

```bash
git log --oneline -1                              # 13c7757 or later
sed -n '391,434p' engine/src/runtime.ts           # hold and exclusive
sed -n '445,452p;532,541p' engine/src/runtime.ts  # drain (a wake goes first) and wake (halted cancels it)
sed -n '1258,1282p' engine/src/runtime.ts         # send: the busy check and the queue
sed -n '719,760p' engine/src/runtime.ts           # openSession: where the provider's open is called (:755-756)
sed -n '2030,2038p;2094,2118p' engine/src/runtime.ts  # quiet and plain: the two one-off opens
sed -n '1552,1570p' engine/src/api.ts             # revert's hold (the exemplar)
sed -n '1640,1649p;1672,1686p' engine/src/api.ts  # commit: idleOr, the open read, the commit, the bookkeeping
sed -n '1612,1624p' engine/src/api.ts             # switch
sed -n '104,104p;711,737p' engine/src/updates.ts  # Busy, next(): the busy-check and this.running
sed -n '398,398p' engine/src/api.ts               # new Updater(store, env, runtime, …): the runtime is the Busy
sed -n '42,56p' engine/src/watch.ts               # pull()
sed -n '89,89p' engine/src/main.ts                # new Watch(store, env, busy)
sed -n '36,95p;97,115p' engine/test/audit-api-turns.test.ts  # fake/setup/changed, and the undo-lock test (the template)
sed -n '57,72p' engine/test/updates.test.ts       # fakeTool and how a test sets an Updater's tools
sed -n '18,40p' engine/test/watch.test.ts         # the autoPull test's origin/work repos
```

## Rules

- Never run a formatter; do not re-wrap or re-indent lines you did not change. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first. Tests are `node:test`, names full sentences. Test
  commands need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push. Steps 1 and 3 are independent; step 4's last part replaces step 2's hold.
- These paths touch real git and real tool updaters in production; the tests use temp repos and fakes. The release rule's
  real-tool run (CLAUDE.md) applies before a release that ships this: note it.

## Steps

All new tests go in `engine/test/holds.test.ts`, which copies `info`, `tick`, `until`, `who`, `git`, `fake`, `setup`,
`session`, `said`, `cpOf`, `edit` and `changed` from the top of `engine/test/audit-api-turns.test.ts` (lines 1-95).

### 1. git.commit holds the thread (CORE-06)

**Test first:** "a message sent during a commit waits for it, then goes" (the shape of the "lock: a message sent during
an undo waits for it, then goes" test, `audit-api-turns.test.ts:99`):
- `const t = await changed(s)`; write `.git/hooks/pre-commit` (`#!/bin/sh\nsleep 0.4\n`, mode 0o755) in `s.dir`.
- `const committing = s.call("git.commit", { threadId: t.id, message: "work" }); await tick(5);`
  `await s.call("thread.send", { id: t.id, text: "next" }); await tick(100);`
- Assert `said(s, t.id, "next")` is false and the queue is `["next"]`; `await committing`; then
  `until(() => said(s, t.id, "next") && !s.runtime.isRunning(t.id))`, and `cpOf(s, t.id)!.committed` is set.
- **Seen failing at 13c7757:** the turn starts mid-commit.

**Fix:** in `api.ts`'s `git.commit`, keep `store.thread`, `idleOr` and `cwdOf` where they are (the early refusal keeps
its message; no await sits between it and the hold), and wrap everything from the `open` read (:1644) through the return
(:1685) in `return runtime.exclusive(threadId, async () => { … });`, revert's shape. The `open` list is read inside the
hold, so the bookkeeping matches what the commit took. Do not change the git commands, the picked/adding/going logic or
the error words.

Known and accepted: while the hold lasts, a wake (a turn the tool starts by itself, e.g. a background task finishing) is
cancelled, as during an undo (`wake`, `runtime.ts:534`). Commit does not consult `busyBeside`: it stages only its own
turns' paths; leave that as it is.

**Verify:** the new test; `engine/test/audit-api-turns.test.ts` and `engine/test/audit-api.test.ts` still pass (62 tests);
`npm run typecheck -w engine` exits 0.

### 2. git.switch holds the thread (CORE-06)

Wrap the `git switch` run and `store.putProject` (:1621-1623) in `runtime.exclusive(threadId, …)`, keeping the early
checks (idleOr, the worktree refusal, busyBeside, the name check) before it.

This covers only the session that asked. Any OTHER session working in the same checkout is checked once by
`busyBeside` and then left free: a message to it mid-switch starts a turn on a tree that is changing. That gap is
closed in step 4, which moves the switch onto the folder hold; do step 2 anyway, so the switch is never unheld if step 4
stops.

**Test first:** "a message sent while a branch switch runs waits for it": a `.git/hooks/post-checkout` that sleeps
0.4 s makes `git switch` slow; start `git.switch` to a new branch (`create: true`), send mid-flight, assert as in step 1.
Not run by the advisor; expect it to fail before the fix the same way step 1's did.

**Verify:** as step 1.

### 3. A tool update holds every open of that tool (CORE-10)

**Test first:** "a message sent while its tool updates waits in the queue, then opens the new version":
- `const t = await session(s)`. In `join(s.home, "bin")` write a fake `claude` as `updates.test.ts`'s `fakeTool` does
  (`--version` prints `claude.v`; `update)` runs `sleep 1` and then writes `1.2.0` to it).
- `const up = new Updater(s.store, { PATH: \`${bin}:/usr/bin:/bin\` }, s.runtime, () => {})`; set its `tools` to one
  `claude` entry at 1.0.0 → 1.2.0 (as `updates.test.ts:74` does); `up.updateTool("claude")`; wait for state `updating`.
- `thread.send` "go", `tick(200)`; assert `f.opened.length === 0`, the queue is `["go"]`, and the timeline has a notice
  matching `/being updated/`. Wait for state `updated`, then `until(() => f.opened.length === 1)`.
- **Seen failing at 13c7757:** the session opens while the tool is being replaced.

**Fix** (tried in a scratch worktree: the test above passes, as do `updates.test.ts`, `turns.test.ts`, `reviewer.test.ts`,
`access.test.ts`, `warm.test.ts`):
- `updates.ts` `Busy` (:104) gains an optional `toolUpdating?(family: string, done: Promise<void>): void` (optional, so the
  stand-ins in `updates.test.ts` still type). In `next()`, right before the `try { await this.runUpdate(ready) }`, make
  the promise and hand it over: `let ended = () => {}; this.busy.toolUpdating?.(ready.id, new Promise<void>((r) => (ended = r)));`
  and call `ended()` in the `finally` after `this.running = null`. The tool ids are `BuiltinProvider` ids, the same
  keys as `familyOf` (`contracts/src/index.ts:28`); a second account (`claude.work`) is the same binary and family.
- `Runtime` gains, beside `released`:
  - `private updating = new Map<string, Promise<void>>()`;
  - `toolUpdating(family, done)`: sets it; on `done.finally`, deletes it and drains every thread that has a queue, isn't
    running, isn't `kept`, and whose lead's family (`familyOf(this.resolve(t).provider)`) is that family;
  - `private updateHeld(threadId)`: whether the thread's lead's family is in `updating` (false at once when the map is empty).
- In `openSession`, right before `const p = providers[r.provider];` (:755): `await this.updating.get(familyOf(r.provider));`
  with a one-line comment (not while its tool is being replaced: it opens the new version when that's done). The same
  await before the open in `quiet` (:2038) and in `plain` (:2118), with `familyOf(provider)`. This catches every way a
  session opens: a message, the queue, a review, the sidekick, a warm-up.
- In `send` (:1264): when nothing runs and nothing holds the thread but `updateHeld(threadId)`, put a notice on its
  timeline (`${label} is being updated. Your message goes when that's done.`, the label from `this.labelOf`), and take
  the queue branch: `if (running || this.busy.has(threadId) || this.updateHeld(threadId))`.
- In `drain` (:445): `if (this.updateHeld(threadId)) return;` first, so nothing sends the queue before the update ends.
- Do not change the updater's own scheduling (its busy-check stays; the gate closes the window after it).

**Verify:** the new test; `engine/test/updates.test.ts`, `engine/test/warm.test.ts`, `engine/test/turns.test.ts` still pass;
`npm run typecheck -w engine` exits 0.

### 4. autoPull, and the branch switch, hold the whole checkout (CORE-09, and step 2's gap)

`exclusive` is per thread. A pull (or a switch) changes the checkout under every session working there, including one
made while it runs. The fix is a folder-level hold.

**Test first** (two tests; the slow pull is real git, slowed on the fetch side):
- Setup for both: `const origin = join(s.home, "origin.git")`; `git clone -q --bare s.dir origin`; in `s.dir`
  `git remote add origin <origin>`, `git fetch -q origin`, `git branch -q -u origin/main`. For a commit to pull: clone
  `origin` into `join(s.home, "other")`, commit a `b.txt` there, `git push -q origin main`. Then write
  `join(s.home, "slow-upload-pack")` as `#!/bin/sh\nsleep 1\nexec git-upload-pack "$@"\n` (mode 0o755) and
  `git config remote.origin.uploadpack <that script>` in `s.dir`: every fetch from that remote now waits a second.
  `s.store.setSettings({ autoPull: true })`.
- `const watch = new Watch(s.store, { ...process.env, ...who }, () => false, (path, work) => s.runtime.folderExclusive(path, work));`
  and start `(watch as unknown as { pull(): Promise<void> }).pull()`; `tick(300)`.
- "a message sent while autoPull fast-forwards the checkout waits for the pull": a session made before the pull;
  `thread.send` "go", `tick(200)`, assert `f.texts.length === 0`; after the pull, `b.txt` is there and the message goes
  (`until(() => f.texts.length === 1 && !s.runtime.isRunning(t.id))`). **Seen failing at 13c7757** (with the Watch made
  without the fourth argument): the turn starts mid-pull.
- "a session made during the pull keeps its first message until the pull ends": the session is made after `tick(300)`,
  then the same assertions, plus its queue is `["go"]` mid-pull.

**Fix** (tried in a scratch worktree; both tests pass; `watch.test.ts`, `turns.test.ts`, `audit-api-turns.test.ts`
still pass):
- `Runtime`, beside `released`:
  - `private folders = new Set<string>()` (checkouts held whole);
  - `private folderHeld(threadId)`: the thread exists, has no worktree, and its project's path is in `folders` (false at
    once when the set is empty; read the project with `store.projects.find`, not `store.project`, so a removed project
    doesn't throw);
  - `async folderExclusive<T>(path, work)`: take the ids of every thread with no worktree whose project path is `path`;
    `folders.add(path)`; run `work` nested inside `exclusive` for each id
    (`const nest = (i: number): Promise<T> => (i < ids.length ? this.exclusive(ids[i], () => nest(i + 1)) : work());`);
    in `finally`, `folders.delete(path)`, then drain every thread in that checkout that has a queue, isn't running and
    isn't `kept`. (The per-thread holds end while the folder is still held, so their own drain is refused; this drain is
    the one that sends.)
- `send` (:1264): `|| this.folderHeld(threadId)` in the queue condition; `drain` (:445): `if (this.folderHeld(threadId)) return;`
  first (beside step 3's check).
- `Watch`: a fourth constructor argument `hold: <T>(path: string, work: () => Promise<T>) => Promise<T> = (_, work) => work()`.
  In `pull()`, after the existing `busy(p.path)` check and the 15-minute spacing (no await between them and the hold),
  run the status/branch/HEAD reads and the pull inside `await this.hold(p.path, async () => { … })`, and DROP the
  `this.busy(p.path)` re-check that sits beside the status check: inside the hold, `main.ts`'s busy reads
  `runtime.isRunning`, which is now true for every held session, so it would skip every pull.
- `main.ts:89`: pass `(path, work) => runtime.folderExclusive(path, work)` as the fourth argument.
- `git.switch`: replace step 2's `runtime.exclusive(threadId, …)` with `runtime.folderExclusive(project.path, …)` (a
  switch always works on the project's own checkout: a worktree is refused before). Add the test "a message to another
  session in the same checkout waits for a branch switch" (two sessions on the project, a slow post-checkout hook,
  switch from one, send to the other). Not run by the advisor.

**Verify:** the new tests; `engine/test/watch.test.ts`, `engine/test/turns.test.ts`, `engine/test/audit-api-turns.test.ts`
still pass; `npm run typecheck -w engine` exits 0.

## Done

- Every new test fails before its fix and passes after; the named existing test files still pass; `npm run typecheck`
  exits 0.
- One commit, the message above.
- Executor note in `plans/README.md`: the commit; that a wake during a commit, switch or pull is cancelled (accepted);
  what the fakes don't prove (real hooks, real updaters, a real network pull); any STOP.

## STOP conditions

- `runtime.exclusive` or `hold` differ from what the drift check shows (a mutex instead of a counter, a different
  drain): stop steps 1, 2 and 4, report.
- Step 3's fake update can't be held pending the way the test needs on your machine (the fake `claude` script's `sleep`):
  report what you saw rather than weakening the assertion.
- Step 4: if folding `folderHeld` into `send` and `drain` breaks an existing test in `turns.test.ts` or
  `audit-api-turns.test.ts`, stop and report the test and the difference; do not widen the hold to make it pass.

## Maintenance note

Any new path that changes a checkout or a tool binary takes a hold: one session's own work takes `exclusive`, work on
the whole checkout takes `folderExclusive`, and a tool's update holds every open of that tool. The tests in
`holds.test.ts` are the pattern for the next one.
