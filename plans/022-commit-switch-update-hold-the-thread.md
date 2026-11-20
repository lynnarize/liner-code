# 022. A commit, a branch switch and a tool update hold the thread: no turn starts beside them

**Commit message:** `A commit, a branch switch and a tool update hold the session, so no turn starts beside them`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Findings: CORE-06 (HIGH), CORE-10 (MED), CORE-09 (LOW — investigate step). Every excerpt below is from the advisor's own read.

## Why this matters

The runtime already has the mechanism: `runtime.exclusive(threadId, work)` (`engine/src/runtime.ts:429-434`) holds the
thread and marks it halted — its own comment: "no turn, review or wake starts meanwhile. A message sent meanwhile waits
in the queue and goes when this ends." `checkpoint.revert` uses it (`engine/src/api.ts:1561-1569`, the EDGE-CASES
rewind/delete lock fix). Three paths that change the folder or the tool were left outside it:

1. **CORE-06.** `git.commit` (`api.ts:1640-1686`) checks `idleOr` once, then awaits `prefixOf`, two `ls-files`,
   `git add` and a commit that may run hooks for up to 10 minutes (:1672). `git.switch` (:1612-1624) is the same shape.
   `thread.send` (:1238-1277) checks nothing about a commit or switch in flight — a message sent during those awaits
   starts a turn beside them: the commit can capture half-written agent edits, and the turn's checkpoint bookkeeping
   (the `open` list read at :1644 before the awaits) never marks them committed. Mid-switch, the working tree changes
   under a turn whose before-snapshot was taken on the old branch.
2. **CORE-10.** The updater picks a tool only when `this.busy.working(t.id) === 0` (`engine/src/updates.ts:720`), then
   runs its updater for up to 15 minutes (:762). Nothing stops a new turn starting on that tool while its files are
   being replaced — a check-then-act window measured in minutes. `runtime.working` (`runtime.ts:3138-3145`) is a count
   asked at selection time. Auto updates wait for idle, which is exactly when a person may send.
3. **CORE-09.** `autoPull` (`engine/src/watch.ts:46-56`) checks `busy(p.path)` before and after reading status, then
   awaits `git pull --ff-only` with nothing holding the checkout. Opt-in, narrow window, and the turn-attribution
   filter softens the worst outcome — hence investigate-first, not a blind fix.

## Current state (drift check)

```bash
git log --oneline -1                              # bfb0ebc or later
sed -n '429,434p' engine/src/runtime.ts           # exclusive
sed -n '1561,1569p' engine/src/api.ts             # revert's hold (the exemplar)
sed -n '1640,1649p;1672,1685p' engine/src/api.ts  # commit: idleOr, the open read, the commit, the bookkeeping
sed -n '1612,1624p' engine/src/api.ts             # switch
sed -n '720,737p' engine/src/updates.ts           # next(): the busy-check and this.running
sed -n '398,398p' engine/src/api.ts               # new Updater(store, env, runtime, …) — the updater holds runtime
sed -n '46,56p' engine/src/watch.ts               # pull()
```

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first. Tests are `node:test`, names full sentences.
  Repo fixtures: `engine/test/checkpoints.test.ts` builds temp git repos; `engine/test/reviewer.test.ts` shows the
  fake-provider pattern (`fakeTools`). Test commands need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push. Steps 1-3 are independent; step 4 is investigate-only.
- These paths touch real git and real tool processes in production; the tests use temp repos and fakes. The release
  rules' real-tool run (CLAUDE.md) applies before a release that ships this — note it.

## Steps

### 1. git.commit holds the thread (CORE-06)

In `api.ts`'s `git.commit`: keep `store.thread`, `idleOr` and `cwdOf` where they are (the early refusal keeps its
message), and wrap EVERYTHING from the `open` read (:1644) through the return (:1685) in
`return runtime.exclusive(threadId, async () => { … });` — exactly revert's shape (:1561). The `open` list must be
read INSIDE the hold, so the bookkeeping matches what the commit took. Do not change the git commands, the picked/
adding/going logic, or the error words.

**Test first** (`engine/test/git-holds.test.ts`): build a temp repo (checkpoints.test.ts's pattern) with a
`.git/hooks/pre-commit` that sleeps ~400 ms; a store/runtime/api as the engine tests build them (see
`engine/test/audit-api.test.ts` for createApi's stand-ins); one ended turn with an uncommitted checkpoint. Call
`api.call("git.commit", …)`; while it runs (the hook sleeps), call `api.call("thread.send", …)` with a fake provider;
assert the turn does NOT start until the commit resolves (the fake's open/turn spy is called only after), and the
message is not lost (it goes after, via the hold's drain). Without the fix the send starts mid-commit — see it fail.
**Verify:** `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/git-holds.test.ts` passes;
the checkpoints and api test files still pass; `npm run typecheck -w engine` exits 0.

### 2. git.switch holds the thread (CORE-06)

Same treatment: keep the early checks (idleOr, worktree refusal, busyBeside, name validation), wrap the `git switch`
run and `store.putProject` (:1621-1624) in `runtime.exclusive`. Extend the test file: "a message sent while a branch
switch runs waits for it" — a fake slow switch is harder (git switch is fast); use a repo where the switch triggers a
slow post-checkout hook, or assert the hold directly: start the switch, send mid-flight via a hook sleep, assert
ordering as step 1. If a hook cannot make switch slow on the test platform, pin the hold structurally (the send queues
while `runtime.exclusive` is held — assert via the halted state) and say so in the note.

**Verify:** as step 1.

### 3. A tool update gates sends and warms on its family (CORE-10)

The updater already holds the runtime (`new Updater(store, env, runtime, …)`, api.ts:398; inside Updater it is
`this.busy`). Wire a gate through it:
- In `Runtime`, add a small public seam beside `settingUp` (read how settingUp is exposed and awaited — api.ts:1262
  `await setups.get(...)` and the comment at :1279-1282 name `runtime.settingUp` asked again by `Runtime.warm`):
  `toolUpdating: { family: string; done: Promise<void> } | null` (or a Map if two families can update at once — read
  `next()`: `this.running` is one tool at a time, so one slot suffices).
- In `Updater.next()`/`runUpdate`: set the seam when `this.running` is assigned (:727), with a promise that resolves
  in the `finally` (:732-734); clear it there. The family is the tool id's family (`familyOf` — read how the updater
  names tools vs how runtime names families; `this.busy.working(t.id)` already takes the tool id, and
  `runtime.working` compares `familyOf(l.provider) === family` — match that keying exactly).
- In `thread.send`'s async block (api.ts:1259-1275), beside `await setups.get(...)`: await the gate while it matches
  the session's provider family. In `Runtime.warm`/wherever a tool is opened ahead (read the :1279 comment's path),
  await the same gate before opening. A message sent during an update waits, then opens the NEW version — the
  updater's `restartIdle` (:767) already restarts idle sessions after.
- Do not change the updater's own scheduling (the busy-check stays; the gate closes the window after it).

**Test first** (`engine/test/update-gate.test.ts`): a fake updater run (stub `runUpdate` or the `run` it uses — read
how updates.test.ts fakes it) held pending; a send on that family awaits (spy not called) until the gate resolves;
a send on ANOTHER family goes at once. See it fail without the gate.
**Verify:** the new test, the existing updates tests, engine typecheck.

### 4. autoPull: investigate, then decide (CORE-09 — LOW confidence)

Do NOT fix blind. Write `engine/test/autopull-race.test.ts` as an INVESTIGATE test: a fake slow `git pull` (a temp
repo whose origin is a local path, with the pull delayed via the test's `run` seam or a hook), autoPull on, a send
mid-pull — does a turn start in the folder while the pull runs? Record what you see.
- If the race is real and reachable: the fix needs a FOLDER-level hold (exclusive is per-thread; holding N threads
  one by one leaves windows, and a thread opened mid-pull is not held). That is a new mechanism — design it after
  reading `hold`/`halted`, and if it exceeds a bounded change, STOP and report the design instead of improvising.
  The advisor's recommendation: a `Runtime.folderExclusive(path, work)` that halts every thread in the folder and
  refuses new opens into it while held, used by Watch.pull; but verify against the code first.
- If the window proves unreachable (e.g. every send into the folder already goes through a hold that checks busy):
  report not-a-bug with the evidence, and delete the investigate test or keep it as a pin (say which).
- Either way: re-check `busy(p.path)` immediately before the pull as a cheap narrowing ONLY if the full hold is
  deferred — and comment that the window remains, so nobody reads it as closed.

**Verify:** the investigate test runs and its result is recorded in the executor note. No production change in this
step unless the hold is bounded and tested.

## Done

- Steps 1-3: new tests fail before and pass after; the named existing test files still pass; engine typecheck exits 0.
- Step 4: the race's reachability is recorded with evidence; a fix only if bounded and tested, else a design report.
- One commit, the message above (step 4's investigate-only outcome goes in the note, not the commit message).
- Executor note in `plans/README.md`: commit, what the fake tests did NOT prove (real git hooks' variety, real tool
  updaters), any STOP.

## STOP conditions

- `runtime.exclusive`'s semantics differ from its comment (read `hold`): stop steps 1-2, report.
- The send path does not go through the hold's queue (read runtime.send): stop, report — the fix would not queue.
- Step 3's family keying cannot be made to match `runtime.working`'s: stop step 3, report.
- Step 4's folder hold exceeds a bounded change: stop with the design, do not improvise.

## Maintenance note

Any new path that changes the checkout or the tool binary must take the same hold — commit, switch, revert, rewind,
update now do; pull is the open question. The tests in git-holds.test.ts are the pattern for the next one.
