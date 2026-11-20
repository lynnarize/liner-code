# 025. A deleted thread and a full disk can't leave the wind-down hanging: late sink calls, the surface heartbeat, and the Stop listeners

**Commit message:** `A late report from a deleted session is quiet, a gone caller's heartbeat stops, and Stop settles its waiter even when the disk write fails`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Refreshed 2026-11-20 at 13c7757 after the advisor's review. Findings: CORE-03 (MED), CORE-04 (HIGH, low impact), CORE-05 (MED).
Every excerpt below was re-read at 13c7757 (engine/src is unchanged since bfb0ebc, so the line numbers hold).

## What the review changed

- All three findings hold; the plan's approach stands. What changed is how each test observes the fault, and all three
  tests were **seen failing** at 13c7757 in a scratch copy (they import the engine at HEAD).
- Step 1: a sink throw inside a tool's turn is caught by the runtime, so `unhandledRejection` never sees it. The fake tool
  now records whether each late sink call threw. One more caller to guard: the sidekick brief's own sink (`session`, :2587).
- Step 2: no `process._getActiveHandles()`; `node:test`'s `mock.timers` (setInterval only) plus a counting wrapper on
  `ServerResponse.prototype.write` sees the beat write to a caller that has gone.
- Step 3: the disk-full seam is `engine/test/turns.test.ts:462` (a `store.putItem` stand-in that throws ENOSPC); the old
  "grep couldn't be saved in engine/test" hint finds nothing there.
- Each test now names its harness: `engine/test/audit-api-turns.test.ts` (`fake`, `setup`, `session`) for steps 1 and 3,
  `engine/test/audit-api.test.ts`'s `startServer` stand-ins for step 2.

## Why this matters

The repo already fixed this class once at the turn's end: `sink.end()` is wrapped so "a save that fails here (a full
disk) can't leave the turn running for good" (`engine/src/runtime.ts:1686-1693`). Three places one layer down still
hang or throw:

1. **CORE-03.** `sink.usage` guards a deleted thread (`runtime.ts:3708`: `if (!store.threads.some((x) => x.id === threadId)) return;`,
   with the comment "a session deleted meanwhile takes none"). Its siblings call `store.thread(threadId)`, which THROWS
   `No thread <id>` (`engine/src/store.ts:332-335`): `session` (:3728), `notice` with `once` (:3735), `effortNow` (:3754),
   `error` when it has a `why` (:3759), `window` (:3774), `limited` (:3775). The sidekick brief's sink has the same
   shape in its `session` (:2587). (`store.putItem` itself is already a no-op on a removed thread, `store.ts:588`.) A side
   chat is removed without waiting for its turn to wind down (`api.ts:401-406`, dropSide: closeThread then removeThread),
   so its tool's late events land after removal. **Seen:** a fake tool that reports after the delete gets
   `No thread th_…` thrown back from `session`, `error`, `limited`, `notice(once)` and `effortNow`.
2. **CORE-04.** The `/surface` keep-alive (`engine/src/server.ts:172-185`): the 20-second space is cleared only in
   `done`; `res.on("close")` (:173) aborts `gone` but never clears the interval. An install card (`askLiner`) settles only
   when the turn ends or you answer (`runtime.ts:1154`, and the turn's end at :1695), so a caller that went keeps a timer writing to a destroyed
   response until then. `/events` does it right (`server.ts:129-138`: `drop` clears the beat on close). **Seen:** after
   the client disconnects, the beat still calls `res.write`.
3. **CORE-05.** Three abort listeners write to disk BEFORE settling their waiter, unguarded:
   - the approval/question `gone` (`runtime.ts:3443-3453`, in `wait`): `store.putItem(… state: "expired")`, then
     `this.clock(threadId)`, then `reject(new Error("stopped"))`;
   - `askLiner`'s `gone` (:1143-1149): `store.item(threadId, id)` (throws when the item is gone), putItem, then resolve;
   - the PR-test abort (:1401-1410): the same shape.
   They run inside `AbortController.abort()` (`stop`, :2286). A Node probe: a throwing abort listener lets `abort()`
   return normally, the error surfaces as `uncaughtException` (`main.ts:249` only logs it), and the rest of the listener
   never runs. `map.delete(id)` already ran, so nothing can settle the waiter later. **Seen:** with `putItem` throwing
   ENOSPC on the expired write, Stop leaves the approval promise unsettled.

## Current state (drift check)

```bash
git log --oneline -1                                  # 13c7757 or later
sed -n '3705,3708p' engine/src/runtime.ts             # usage's guard (the exemplar)
sed -n '3728,3740p;3754,3760p;3770,3778p' engine/src/runtime.ts  # the unguarded siblings
sed -n '2587,2591p' engine/src/runtime.ts             # the sidekick brief sink's session
sed -n '1686,1693p' engine/src/runtime.ts             # sink.end's wrap (the exemplar)
sed -n '3435,3459p;1140,1155p;1398,1411p' engine/src/runtime.ts  # the three listeners
sed -n '2931,2947p' engine/src/runtime.ts             # clock(): settles nothing, may write (log=true on its else branch)
sed -n '163,189p' engine/src/server.ts                # the surface heartbeat
sed -n '123,138p' engine/src/server.ts                # /events' drop (the exemplar)
sed -n '36,95p' engine/test/audit-api-turns.test.ts   # fake(), setup(), session(): the harness for steps 1 and 3
sed -n '455,470p' engine/test/turns.test.ts           # the ENOSPC putItem stand-in
sed -n '76,85p' engine/test/audit-api.test.ts         # startServer with stand-ins
```

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first. Test commands need
  `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push. Steps independent.

## Steps

### 1. Late sink calls from a deleted thread are quiet (CORE-03)

**Test first** (`engine/test/late-sink.test.ts`, copying `fake`/`setup`/`session`/`until`/`tick` from
`audit-api-turns.test.ts`): "a late report from a deleted session's tool throws nothing".
- The fake's work waits for the turn's `signal` to abort, waits ~20 ms more, then calls, each in its own try/catch that
  pushes the error message to `threw`: `sink.session("late-id")`, `sink.error("late", { why: "overloaded" })`,
  `sink.limited("late")`, `sink.notice("late", undefined, { once: true })`, `sink.effortNow("high")`; then sets `late = true`.
- The test: `thread.send` "go", wait until the turn runs, then the dropSide shape directly on the runtime and store:
  `void s.runtime.closeThread(t.id); s.store.removeThread(t.id);`. Wait until `late`, assert `threw` is `[]`.
- **Seen failing at 13c7757:** `threw` holds five `No thread th_…`.

**Fix:** in the sink factory (`sink(threadId, …)`, :3347):
- One guard beside the closures: `const alive = () => store.threads.some((x) => x.id === threadId);`
- `if (!alive()) return;` at the TOP of `session`, `notice`, `effortNow`, `error`, `window`, `limited`, before any store
  access or `settle()`. Replace usage's inline check with `alive()` (same behaviour); keep its comment and add that its
  siblings take none either. A gone thread has nowhere to show an error, so returning before `errored = true` hides
  nothing: both callers (`:1574`, `:2523`) build the sink for a thread that exists, and nothing reads `errored` once
  the thread is gone.
- The sidekick brief's sink (`session` at :2587): the same early return before `store.thread(threadId)`.
- `heard` touches no store; leave it. Read the whole sink object for any other `store.thread(threadId)` caller added
  since and guard it too; list them in the note.
- Do not change what a live thread's late events do.

**Verify:** the new test; `engine/test/audit-api-turns.test.ts` (side chats, delete) and `engine/test/turns.test.ts`
still pass; `npm run typecheck -w engine` exits 0.

### 2. The surface heartbeat stops when its caller goes (CORE-04)

**Test first** (add to `engine/test/audit-api.test.ts`, beside its other `server:` tests): "server: a surface call whose
caller has gone writes nothing more to it".
- `startServer({ store, api: …, snapshot: …, token: "t", port: 0, surface, knows: { surface: () => true, outside: () => false } })`
  where `surface` marks `started` and returns a promise that only a `release()` settles.
- `mock.timers.enable({ apis: ["setInterval"] })` (from `node:test`) AFTER `startServer` and before the request, so only
  the beat's interval is faked.
- Wrap `ServerResponse.prototype.write` (from `node:http`) to count calls made after a `gone` flag is set.
- POST `/surface` with header `x-liner-surface: k` and body `{"tool":"x","args":{}}` (`http.request`, with an error
  handler), wait until `started`, `req.destroy()`, wait ~30 ms, set `gone`, `mock.timers.tick(60_000)`, assert the count
  is 0. In `finally`: put `write` back, `mock.timers.reset()`, `release()`, `server.close()`.
- **Seen failing at 13c7757:** the beat writes after the caller has gone.

**Fix** in `server.ts`'s `/surface`/`/outside` POST path (:163-189):
- Hoist `let beat: NodeJS.Timeout | undefined;` above the `res.on("close", …)` registration; the close handler clears it
  beside `gone.abort()`: `res.on("close", () => (clearInterval(beat), res.writableEnded || gone.abort()));`.
- Assign the interval to the hoisted variable, and write only to a response still there:
  `beat = setInterval(() => res.destroyed || res.write(" "), 20_000);`. `done` keeps clearing it.
- One comment: a caller that goes while its call waits on a person keeps no timer behind it.

**Verify:** the new test and the rest of `engine/test/audit-api.test.ts`; `npm run typecheck -w engine` exits 0.

### 3. Stop settles its waiter even when the disk write fails (CORE-05)

**Test first** (`engine/test/stop-diskfull.test.ts`, the same harness as step 1): "Stop settles an open approval even
when saving its expired state fails".
- The fake's work: `answer = await sink.approve({ tool: "Bash", title: "Run make deploy", risk: "medium", fields: [{ label: "Command", value: "make deploy" }] }, signal).then((a) => a, (e) => \`rejected: ${e.message}\`)`,
  with `answer` starting as `"unsettled"`.
- The session is made with `{ access: "ask" }` so the card asks. Wait until the timeline has an `approval` in `asking`.
- Swap `s.store.putItem` for a stand-in that throws `ENOSPC: no space left on device` when
  `item.kind === "approval" && item.state === "expired"` (the `turns.test.ts:462` pattern), else calls through.
- `s.runtime.stop(t.id)`, wait ~200 ms, put `putItem` back, assert `answer !== "unsettled"`.
- **Seen failing at 13c7757:** `answer` stays `"unsettled"`, and the ENOSPC surfaces as an uncaught exception, which
  `node:test` also reports as a failure of the test.
- If the askLiner card and the PR-test card can be reached from a test cheaply, add one each; at minimum the approval
  path. Say in the note which you covered.

**Fix** in the three listeners:
- Wrap the disk writes (`store.putItem`, and `this.clock(threadId)` in `wait`'s `gone`) in one try/catch with a quiet
  catch and a comment: the card's expired state can't be saved; the waiter still settles. (`clock` settles no other
  waiter; it only writes the turn mark's waiting time, :2931-2947.) The thread may already be gone, so no notify here.
- ALWAYS run the settle (`reject(new Error("stopped"))` / `resolve({ allow: false, … })`) after the try/catch.
- In `askLiner`'s gone (:1143) and the PR-test abort (:1401), replace `store.item(threadId, id)` (:1146 and :1405) with
  `store.timeline(threadId).find((x) => x.id === id)` (as `wait`'s gone already does), and check `it?.kind`.
- Keep the `map.has(id)` / `approvals.delete(id)` early returns exactly as they are (they prevent a double settle).

**Verify:** the new test; `engine/test/turns.test.ts`, `engine/test/stop-guard.test.ts`, `engine/test/stop-grace.test.ts`
still pass; `npm run typecheck -w engine` exits 0.

## Done

- The three new tests fail before and pass after; the named existing tests still pass; `npm run typecheck` exits 0.
- One commit, the message above. Executor note: commit, which listeners the tests covered, the extra sink callers guarded.

## STOP conditions

- The sink object's shape changed (methods renamed or added): guard what exists, list it, report.
- Step 2: `mock.timers` doesn't take hold of the server's interval on your Node: fall back to a source assertion that
  the close handler clears `beat`, keep the behavioural test skipped with a reason, and say so.
- Step 3: `this.clock` turns out to settle other waiters: wrap only its write, not its logic; if unclear, stop and report.

## Maintenance note

The rule is now uniform: a wind-down path settles its waiter first; disk writes are best-effort around it, and a deleted
thread takes no late reports. Any new abort listener or sink method copies the neighbour's guard.
