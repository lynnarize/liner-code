# 025. A deleted thread and a full disk can't leave the wind-down hanging: late sink calls, the surface heartbeat, and the Stop listeners

**Commit message:** `A late report from a deleted session is quiet, a gone caller's heartbeat stops, and Stop settles its waiter even when the disk write fails`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Findings: CORE-03 (MED), CORE-04 (HIGH), CORE-05 (MED). Every excerpt below is from the advisor's own read.

## Why this matters

The repo already fixed this class once at the turn's end: `sink.end()` is wrapped so "a save that fails here (a full
disk) can't leave the turn running for good" (`engine/src/runtime.ts:1686-1693`, the EDGE-CASES disk-full fix). Three
places one layer down still hang or throw:

1. **CORE-03.** `sink.usage` guards a deleted thread (`runtime.ts:3708`: `if (!store.threads.some((x) => x.id === threadId)) return;`,
   with the comment "a session deleted meanwhile takes none"). Its siblings do not: `session` (:3729), `notice` with
   `once` (:3739), `effortNow` (:3756), `error` (:3769), `window` (:3774), `limited` (:3778) all call
   `store.thread(threadId)`, which THROWS `No thread <id>` (`engine/src/store.ts:332-335`). A side chat is removed
   without waiting for its turn to wind down (`api.ts` dropSide: closeThread then removeThread at once), so its tool's
   late events land after removal — log noise at best, a spurious failure path in the Claude SDK loop at worst.
2. **CORE-04.** The `/surface` keep-alive (`engine/src/server.ts:172-185`): the 20-second space heartbeat is cleared
   only in `done`, when the work settles; `res.on("close")` aborts the `gone` signal but never clears the interval. A
   surface call that waits on a person (an add-on install card has no timeout) keeps a timer writing to a destroyed
   response for as long as the work stays pending. The auditor probed this Node: write-after-destroy returns false
   silently — no crash, but the interval, response and pending work are retained. `/events` does it right
   (`server.ts:129-138`: `drop` clears the beat on close).
3. **CORE-05.** Three abort listeners write to disk BEFORE settling their waiter, unguarded:
   - the approval/question `gone` (`runtime.ts:3443-3453`): `store.putItem(… state: "expired")` then `this.clock(…)`
     then `reject(new Error("stopped"))`;
   - `askLiner`'s `gone` (:1143-1149): `store.item(threadId, id)` (throws when the item is gone) then putItem then resolve;
   - the PR-test abort (:1401-1410): the same shape.
   These run inside `AbortController.abort()` (Stop, :2286 region); a listener that throws on an EventTarget is
   reported as an uncaught exception — `main.ts:249` only logs it — and the rest of the listener (the resolve/reject)
   never runs. With a full or read-only disk, Stop with a card open leaves the tool's approval promise unsettled until
   the 15-second grace force-closes the session, and the card's expired state is never written.

## Current state (drift check)

```bash
git log --oneline -1                                  # bfb0ebc or later
sed -n '3705,3712p' engine/src/runtime.ts             # usage's guard (the exemplar)
sed -n '3728,3734p;3754,3758p;3774,3778p' engine/src/runtime.ts  # the unguarded siblings
sed -n '1686,1693p' engine/src/runtime.ts             # sink.end's wrap (the exemplar)
sed -n '3443,3453p;1143,1149p;1401,1410p' engine/src/runtime.ts  # the three listeners
sed -n '172,185p' engine/src/server.ts                # the surface heartbeat
sed -n '129,138p' engine/src/server.ts                # /events' drop (the exemplar)
```

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first. Fake-provider pattern: `engine/test/reviewer.test.ts`
  (`fakeTools`); server-test pattern: `engine/test/audit-api.test.ts`. Test commands need
  `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push. Steps independent.

## Steps

### 1. Late sink calls from a deleted thread are quiet (CORE-03)

In the sink factory (the object holding usage/session/notice/… around :3705-3790):
- Define one guard beside the closures: `const alive = () => store.threads.some((x) => x.id === threadId);`
- Put `if (!alive()) return;` at the TOP of `session`, `notice`, `effortNow`, `error`, `window`, `limited` — before
  any store access or settle() call, exactly where usage's guard sits. Replace usage's inline check with `alive()`
  (same behaviour, one definition). Keep usage's comment; extend it one sentence: the siblings take none either.
- `heard` (:3753) touches no store — leave it. Read the rest of the sink object for any other `store.thread(threadId)`
  caller added since (the file drifts); guard those too, and list them in the note.
- Do not change what a live thread's late events do.

**Test first** (`engine/test/late-sink.test.ts`): a fake provider whose turn, after the session is deleted mid-wind-down
(the dropSide shape: closeThread then removeThread), emits a late `session`/`error`/`limited` report; assert no throw
escapes (the turn's promise settles, no uncaught rejection — capture process-level unhandledRejection in the test and
fail on it) and nothing is written for the gone thread. Before the fix `store.thread` throws — see it fail.
**Verify:** the new test, the side-chat/delete tests (grep `dropSide`/side chat in engine/test), engine typecheck.

### 2. The surface heartbeat stops when its caller goes (CORE-04)

In `server.ts`'s `/surface`/`/outside` POST path (:170-189):
- Hoist `let beat: NodeJS.Timeout | undefined;` above the `res.on("close")` registration; in the close handler,
  `clearInterval(beat)` beside `gone.abort()` (the /events drop shape, :129-138).
- Guard the write: `const beat = setInterval(() => { if (!res.destroyed) res.write(" "); }, 20_000);` — assign to the
  hoisted variable. `done` keeps clearing it.
- One comment: a caller that goes while its call waits on a person keeps no timer behind it.

**Test first** (`engine/test/surface-heartbeat.test.ts`, the server-test pattern): start a surface call whose work
stays pending (a stand-in `take` that never resolves until released); disconnect the client (destroy the request);
advance fake timers or wait past one beat; assert no write happens after close (spy on res.write via the stand-in, or
assert the interval is cleared by counting active handles — `process._getActiveHandles()` is fragile; prefer a fake
timer seam if the test file already uses one, else assert via a write spy on the response object the stand-in holds).
Release the work in finally. Before the fix the beat keeps firing — see it fail.
**Verify:** the new test, the existing surface/server tests, engine typecheck.

### 3. Stop settles its waiter even when the disk write fails (CORE-05)

In the three listeners:
- Wrap the disk writes (`store.putItem`, and `this.clock` where it writes) in try/catch; on failure, log quietly
  (the file's own logging shape — read how the sink.end catch reports; a console.error with the thread id is the
  server's style, but prefer store.emit notify only if the thread still exists — keep it minimal: the catch swallows
  with a comment, as sink.end's does NOT swallow but reports; here the thread may be gone, so a quiet catch with a
  comment is right: "the card's expired state can't be saved; the waiter still settles").
- ALWAYS run the settle (`reject(new Error("stopped"))` / `resolve({ allow: false, … })`) after the try/catch.
- In `askLiner`'s gone and the PR-test abort, replace `store.item(threadId, id)` with
  `store.timeline(threadId).find((x) => x.id === id)` (the approval gone already uses the non-throwing find) — a gone
  item must not throw before the settle.
- Keep the `map.has(id)` / `approvals.delete(id)` early returns exactly as they are (they prevent double-settle).

**Test first** (`engine/test/stop-diskfull.test.ts`): a fake turn with an open approval card; stub `store.putItem` to
throw once (the disk-full seam — read how the EDGE-CASES sink.end test injects its failure, grep "couldn't be saved"
in engine/test for the existing pattern); call Stop; assert the approval promise SETTLES (allow:false / rejected) and
no uncaught exception escapes (capture uncaughtException in the test, fail on it). Before the fix the listener throws
before reject — see it fail. Repeat for askLiner's card and the PR-test card if their harnesses are reachable; at
minimum the approval path, and say which you covered.
**Verify:** the new test, the stop/approval tests, engine typecheck.

## Done

- All new tests fail before and pass after; the named existing tests still pass; `npm run typecheck` exits 0.
- One commit, the message above. Executor note: commit, which listeners the tests covered, any STOP.

## STOP conditions

- The sink object's shape changed (methods renamed/added): guard what exists, list it, report.
- Step 2: the test cannot observe the heartbeat without fragile internals: pin the clear structurally (source
  assertion that the close handler clears beat) AND keep a behavioural test if possible; say which.
- Step 3: `this.clock` does more than write (it may settle other waiters): read it; wrap only the throwing write,
  not the settling logic. If unclear, stop and report.

## Maintenance note

The rule is now uniform: a wind-down path settles its waiter FIRST-class — disk writes are best-effort around it, and
a deleted thread takes no late reports. Any new abort listener or sink method copies the neighbour's guard.
