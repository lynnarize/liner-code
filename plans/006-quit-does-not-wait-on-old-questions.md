# Plan 006: Quitting no longer waits on a question whose turn is already over

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6970155..HEAD -- desktop/src/finish.ts desktop/test/finish.test.ts`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `6970155`, 2026-11-19

## Why this matters

When the person presses ⌘Q, the app asks "A session is waiting on you. Quit anyway?" for sessions with an open request, because quitting would end a live turn. "Quit when it finishes" hides the app until those sessions are done.

A question the agent asked is different from an approval: the engine keeps a question across a quit on purpose (the answer goes as the next message). After a restart such a session still has status `waiting` with the question still `asking`, but no turn is running. Today that old question holds every later quit: the ⌘Q dialog appears each time, and "Quit when it finishes" leaves a hidden app that never quits until the person answers. The class's own comment says a session waiting for days must not hold the quit.

The fix: a question counts as a live request only while its turn is still running.

**This is a behaviour decision made by the advisor.** It is recorded in `plans/README.md` for the owner to confirm.

## Current state

- `desktop/src/finish.ts:19-22`:

  ```ts
  /** The kinds of ask that hold a turn open until you answer (the same three runtime.ts looks for). */
  const ASKS = new Set(["approval", "question", "proposal"]);
  /** Whether a session's timeline has a request still open: then its "waiting" is a live turn, not an old one. */
  export const openAsk = (items: unknown) => Array.isArray(items) && items.some((i) => i && typeof i === "object" && ASKS.has((i as { kind?: string }).kind ?? "") && (i as { state?: string }).state === "asking");
  ```
- `items` is what the engine's `thread.items` call returns: the session's whole timeline (`engine/src/api.ts:1175`). Each turn has a marker item `{ kind: "turn", turn: <n>, status: "running" | "done" | "stopped" | "error", … }`. While a turn runs its marker's status is `"running"`. When the engine restarts, a marker still `"running"` is settled to `"stopped"` (`engine/src/store.ts:534`: `if (it.kind === "turn" && it.status === "running") it.status = "stopped";`).
- On quit, the engine expires open approvals and plans but keeps a question (`engine/src/runtime.ts:3445-3447`: `const keep = this.quitting && it?.kind === "question";`).
- `openAsk` is used by `heldOnYou` (`finish.ts:141-144`, ⌘Q's count) and by `desktop/src/main.ts:941` (`w.mark(id, await engineRpc("thread.items", { id }).then(openAsk, () => undefined))`, for "Quit when it finishes").
- `desktop/test/finish.test.ts:107-114` (must keep passing unchanged):

  ```ts
  test("an open request is an approval, a question or a plan still asking", () => {
    assert.equal(openAsk([{ kind: "message" }, { kind: "approval", state: "asking" }]), true);
    assert.equal(openAsk([{ kind: "question", state: "asking" }]), true);
    assert.equal(openAsk([{ kind: "proposal", state: "asking" }]), true);
    assert.equal(openAsk([{ kind: "approval", state: "allowed" }]), false);
    assert.equal(openAsk(null), false);
    assert.equal(openAsk([null, 3]), false);
  });
  ```

Conventions: TypeScript run directly by Node 24. Long hand-formatted lines; never run a formatter. Comments are plain sentences that say why. Tests are `node:test` with sentence names, in `desktop/test/`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck -w desktop` | exit 0 |
| The tests | `node --test desktop/test/finish.test.ts` | all pass |
| All desktop tests | `npm test -w desktop` | all pass |

## Scope

**In scope**:
- `desktop/src/finish.ts` (`openAsk` only)
- `desktop/test/finish.test.ts` (add one test)

**Out of scope**:
- `desktop/src/main.ts`, `desktop/src/tray.ts`: they call `openAsk` and need no change.
- The engine: what it keeps across a quit stays as it is.
- The wording of the quit dialog.

## Git workflow

- Stay on `design-and-api-endpoints`. One commit for this plan, a plain sentence (example from `git log`: `A Reviewer block reads as one, without a question's amber`). Do not push.

## Steps

### Step 1: Write the failing test

Add to `desktop/test/finish.test.ts`, after the test quoted above:

```ts
test("a question whose turn is over doesn't hold a quit: it outlives the quit, and its answer goes as the next message", () => {
  const asked = { kind: "question", state: "asking" };
  // Its turn still runs: quitting would end that turn.
  assert.equal(openAsk([{ kind: "turn", turn: 1, status: "running" }, asked]), true);
  // Left from before a restart, or from a turn that ended: nothing is lost by quitting.
  assert.equal(openAsk([{ kind: "turn", turn: 1, status: "stopped" }, asked]), false);
  assert.equal(openAsk([{ kind: "turn", turn: 1, status: "done" }, asked]), false);
  // An approval or a plan is ended by a quit whatever its turn says, so it still holds one.
  assert.equal(openAsk([{ kind: "turn", turn: 1, status: "stopped" }, { kind: "approval", state: "asking" }]), true);
  // Only the newest turn counts.
  assert.equal(openAsk([{ kind: "turn", turn: 1, status: "running" }, asked, { kind: "turn", turn: 2, status: "done" }]), false);
});
```

**Verify**: `node --test desktop/test/finish.test.ts` → the new test FAILS on its second assertion; the others pass.

### Step 2: Make a question count only while its turn runs

In `desktop/src/finish.ts` replace the `openAsk` line (keep `ASKS` as it is) with:

```ts
/**
  Whether a session's timeline has a request still open that a quit would end: then its "waiting" is a live turn, not an old
  one. An approval or a plan still asking always is. A question is only while its turn still runs: the engine keeps a question
  across a quit (your answer goes as the next message), so one left from an earlier run, or from a turn that has ended, loses
  nothing to a quit and must not hold one for good. With no turn marker to read (a partial timeline), a question counts.
*/
export const openAsk = (items: unknown) => {
  if (!Array.isArray(items)) return false;
  const of = (i: unknown) => (i && typeof i === "object" ? (i as { kind?: string; state?: string; status?: string }) : {});
  const asking = items.map(of).filter((i) => ASKS.has(i.kind ?? "") && i.state === "asking");
  if (!asking.length) return false;
  if (asking.some((i) => i.kind !== "question")) return true;
  const last = items.map(of).findLast((i) => i.kind === "turn");
  return last ? last.status === "running" : true;
};
```

**Verify**: `node --test desktop/test/finish.test.ts` → all pass, including the unchanged older test.

### Step 3: Full check

**Verify**: `npm run typecheck -w desktop` → exit 0; `npm test -w desktop` → all pass.

## Test plan

One new test (Step 1) covering: a question in a running turn holds; a question after a stopped or finished turn does not; an approval still holds; only the newest turn counts. The existing eleven tests in the file must pass unchanged.

## Done criteria

- [ ] `npm run typecheck -w desktop` exits 0
- [ ] `node --test desktop/test/finish.test.ts` passes with the new test
- [ ] `npm test -w desktop` passes
- [ ] `git status --short` shows no modified file outside the two in scope
- [ ] `plans/README.md` status row updated

## STOP conditions

- The older test "an open request is an approval, a question or a plan still asking" fails after Step 2.
- `findLast` is rejected by the type checker for this workspace (then use a reverse loop instead; that is allowed and is not a STOP).
- You find another caller of `openAsk` that needs questions to always count.

## Maintenance notes

- If the engine ever stops keeping questions across a quit, this rule must go back to "a question always holds".
- Not verified on screen: ⌘Q and "Quit when it finishes" with a real open question. The owner should try both once.
- Deferred: a session whose timeline never loads is held as "unsure" with no limit (`finish.ts:92-97`).
