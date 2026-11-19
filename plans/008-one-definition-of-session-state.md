# Plan 008: Every face reads a session's state from one tested file, so "Reviewer blocked it" means the same everywhere

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6970155..HEAD -- ui/src/app/model.ts ui/src/app/Sidebar.tsx ui/src/app/SideList.tsx ui/src/app/Wall.tsx ui/src/app/design/Tabs.tsx ui/src/app/security/Side.tsx ui/src/app/Compare.tsx ui/src/app/App.tsx ui/src/app/Session.tsx ui/src/app/DesignMini.tsx ui/src/app/design/Chat.tsx`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (plan 007 touches `Session.tsx` too; do 007 first to avoid a conflict)
- **Category**: bug / tests
- **Planned at**: commit `6970155`, 2026-11-19

## Why this matters

A session whose change the Reviewer blocked has status `waiting` with `held: "review"`. The latest commit decided that such a session reads as finished, not as "Needs you", and applied that in the sidebar only. The Wall, the menu bar item, Liner Design's rows, Liner Security's rows, Compare and the screen-reader announcement still treat every `waiting` session as needing the person. So the same session is "Reviewer blocked it" in one place and "Needs you" in another.

The cause is that each place writes its own rule. This plan puts the rules in one small file with no React in it, makes every place use it, and gives it unit tests. These are the first tests of UI logic that plain Node can run.

## Current state

- `ui/src/app/model.ts:263-283` (imports types and values from the `@contracts` path alias, which plain Node cannot resolve):

  ```ts
  export type Bucket = "pinned" | "needs" | "working" | "open" | "snoozed" | "settled";

  /** The Reviewer blocked its change, and its agent asked nothing: it reads as finished, with a blue dot until you open it. */
  export const reviewHeld = (t: Thread) => t.status === "waiting" && t.held === "review";

  /** … */
  export function bucketOf(t: Thread, now = Date.now()): Bucket {
    if (t.snoozedUntil && t.snoozedUntil > now) return "snoozed";
    if (t.done) return "settled";
    if (t.pinned) return "pinned";
    if (t.status === "running") return "working";
    // Files changed and not committed don't wait on you: …
    const needs = (t.status === "waiting" && !reviewHeld(t)) || t.status === "error" || t.status === "limited" || t.unread || t.turns === 0;
    // Agents it sent still at work in the background: it works, though its turn has ended.
    return needs ? "needs" : t.agentsAtWork ? "working" : "open";
  }
  ```
- `ui/src/app/Sidebar.tsx:116-129` (a React component file) defines and exports:

  ```ts
  export const waitsOnYou = (t: Thread, now = Date.now()) => bucketOf(t.pinned ? { ...t, pinned: false } : t, now) === "needs";
  export const asksYou = (t: Thread) => (t.status === "waiting" && !reviewHeld(t)) || t.status === "error" || t.status === "limited";
  export const needsYou = (t: Thread, now = Date.now()) => !t.archived && t.turns > 0 && waitsOnYou(t, now) && (asksYou(t) || !t.agentsAtWork);
  ```
  `ui/src/app/App.tsx` imports `needsYou` from `./Sidebar`.
- `ui/src/app/Sidebar.tsx:1663` (the row's mark):
  `const state: SideState = busy ? "working" : t.status === "error" ? "error" : t.status === "limited" ? "limited" : reviewHeld(t) ? "done" : t.status === "waiting" ? "needs" : t.turns === 0 ? "new" : "done";`
- `ui/src/app/SideList.tsx:33`: `export type SideState = "working" | "needs" | "limited" | "error" | "done" | "new";`
- The places that ignore `reviewHeld`:
  - `ui/src/app/Wall.tsx:40`: `export const wallKind = (t: Thread): WallKind => (t.status === "running" ? "working" : t.status === "waiting" || t.status === "error" || t.status === "limited" ? "needs" : t.agentsAtWork ? "working" : "done");`
  - `ui/src/app/Wall.tsx:526`: `: t.status === "waiting"` followed by `? { word: `Needs you · ${when}`, tone: "warn" }`
  - `ui/src/app/design/Tabs.tsx:108`: `const state: SideState = s?.status === "running" ? "working" : s?.status === "waiting" ? "needs" : s?.status === "error" ? "error" : s?.status === "limited" ? "limited" : "done";`
  - `ui/src/app/security/Side.tsx:138`: `const standing = (t: Thread): SideState => (t.status === "running" ? "working" : t.status === "waiting" ? "needs" : t.status === "error" ? "error" : t.status === "limited" ? "limited" : "done");`
  - `ui/src/app/security/Side.tsx:141`: `… : t.status === "waiting" ? { text: "Waits for your answer", tone: "warn" } : …`
  - `ui/src/app/Compare.tsx:105`: `… : t.status === "waiting" ? <Badge tone="warn">Waits for you</Badge> : …`
  - `ui/src/app/App.tsx:363`: `needs: live.filter((t) => needsYou(t)).map((t) => ({ id: t.id, title: t.title, waiting: t.status === "waiting" })),`
  - `ui/src/app/App.tsx:368`: `asking: [...threads, ...sides].filter((t) => !t.archived && t.status === "waiting" && !t.agentsAtWork).map((t) => t.id),`
  - `ui/src/app/Session.tsx:1001`: `status === "waiting" ? `${who} needs you` : status === "error" ? …`
  - `ui/src/app/DesignMini.tsx:295`: `….filter((t) => t.status === "running" || t.status === "waiting")…`
  - `ui/src/app/design/Chat.tsx:119`: `const running = thread.status === "running" || thread.status === "waiting";`
- How a UI file becomes testable by Node: it must have no imports except relative ones ending in `.ts`. Example: `ui/src/app/precheck-state.ts:7` `import type { Precheck } from "../../../contracts/src/index.ts";`, tested from `engine/test/precheck.test.ts:14` with `import { DraftMemory } from "../../ui/src/app/precheck-state.ts";`. The engine's `tsconfig.json` type-checks `engine/test`.
- `Thread` (in `contracts/src/index.ts`) has `status`, `held?: "review"`, `unread`, `turns`, `pinned`, `done`, `snoozedUntil`, `archived`, `agentsAtWork`.

Conventions: long hand-formatted lines; never run a formatter; do not re-wrap code you did not change. Comments are plain sentences that say why; move each function's existing comment with it. Tests are `node:test` with sentence names.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (all) | `npm run typecheck` | exit 0 |
| The new tests | `node --test engine/test/session-state.test.ts` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `ui/src/app/session-state.ts` (create)
- `engine/test/session-state.test.ts` (create)
- `ui/src/app/model.ts`, `ui/src/app/Sidebar.tsx`, `ui/src/app/SideList.tsx`, `ui/src/app/Wall.tsx`, `ui/src/app/design/Tabs.tsx`, `ui/src/app/security/Side.tsx`, `ui/src/app/Compare.tsx`, `ui/src/app/App.tsx`, `ui/src/app/Session.tsx`, `ui/src/app/DesignMini.tsx`, `ui/src/app/design/Chat.tsx`: only the lines named in "Current state"

**Out of scope**:
- What "Needs you" means: do not change `bucketOf`'s rules. In particular the Wall keeps showing an unread finished session as done (that is an open product question, not part of this plan).
- Row wording (`rowLine`, `cardState` in `Sidebar.tsx`), any CSS, `ui/src/liner/**`.

## Git workflow

- Stay on `design-and-api-endpoints`. One commit for this plan, a plain sentence (example from `git log`: `A Reviewer block reads as one, without a question's amber`). Do not push.

## Steps

### Step 1: Create the shared file by moving code

Create `ui/src/app/session-state.ts`:

```ts
/*
  How a session stands, read from the session alone: where it sits in the sidebar, whether it needs you, and the mark its row
  shows. One place for every face (Code's sidebar and Wall, Liner Design's rows, Liner Security's, the Dock and the menu bar), so
  they can't disagree. No React and no alias imports here, so plain Node can test it (engine/test/session-state.test.ts).
*/
import type { Thread } from "../../../contracts/src/index.ts";
```

Then MOVE into it, with their comments, unchanged:
- from `model.ts`: `Bucket`, `reviewHeld`, `bucketOf`;
- from `Sidebar.tsx`: `waitsOnYou`, `asksYou`, `needsYou`;
- from `SideList.tsx`: the `SideState` type;
- from `Wall.tsx`: the `WallKind` type and `wallKind`.

Add one new function:

```ts
/** The mark a session's row shows. `busy`: it works now (its turn runs, or agents it sent still do). A session not started yet is "new". */
export const sideStateOf = (t: Thread, busy = t.status === "running"): SideState =>
  busy ? "working" : t.status === "error" ? "error" : t.status === "limited" ? "limited" : reviewHeld(t) ? "done" : t.status === "waiting" ? "needs" : t.turns === 0 ? "new" : "done";
```

Keep every old import working by re-exporting from the old files:
- `model.ts`: `export { bucketOf, reviewHeld, type Bucket } from "./session-state";` A re-export alone gives the file no local name, so if `model.ts` itself still calls `bucketOf` or `reviewHeld` (or uses `Bucket`), also add `import { bucketOf, reviewHeld, type Bucket } from "./session-state";` with only the names it uses.
- `Sidebar.tsx`: import the three functions from `"./session-state"` and add `export { asksYou, needsYou, waitsOnYou };`
- `SideList.tsx`: `export type { SideState } from "./session-state";` (and import the type for its own use)
- `Wall.tsx`: import `wallKind` and `WallKind` from `"./session-state"` and add `export { wallKind }; export type { WallKind };`

**Verify**: `npm run typecheck` → exit 0. Behaviour is unchanged so far.

### Step 2: Write the tests

Create `engine/test/session-state.test.ts`, modelled on the top of `engine/test/precheck.test.ts`:

```ts
/*
  How a session stands, for every face of the app (ui/src/app/session-state.ts). Run with `node --test engine/test/session-state.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { asksYou, bucketOf, needsYou, reviewHeld, sideStateOf, wallKind } from "../../ui/src/app/session-state.ts";

const t = (more: Partial<Thread> = {}): Thread => ({ id: "t", projectId: "p", title: "Work", agent: "forge", status: "done", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1, ...more });
```

Tests to write (each a sentence-named `test`):
1. `bucketOf`: running → `"working"`; `waiting` → `"needs"`; `error` and `limited` → `"needs"`; finished and `unread` → `"needs"`; finished and read → `"open"`; finished, read, `agentsAtWork: 1` → `"working"`; `pinned` → `"pinned"`; `done: true` → `"settled"`; `snoozedUntil` in the future → `"snoozed"`.
2. A Reviewer block is not asking: with `t({ status: "waiting", held: "review" })`: `reviewHeld` is true, `asksYou` is false, `bucketOf` is `"open"`, `sideStateOf` is `"done"`, `wallKind` is `"done"`. With `unread: true` as well: `bucketOf` is `"needs"` and `needsYou` is true (finished and not read).
3. `needsYou`: false for `archived`, false for `turns: 0`, true for a pinned waiting session, false for a finished unread session with `agentsAtWork: 1`.
4. `sideStateOf` table: running → `"working"`; `error` → `"error"`; `limited` → `"limited"`; `waiting` → `"needs"`; `turns: 0` → `"new"`; otherwise `"done"`; and `sideStateOf(t(), true)` → `"working"`.
5. `wallKind`: running → `"working"`; plain `waiting`, `error`, `limited` → `"needs"`; finished with `agentsAtWork: 2` → `"working"`; finished → `"done"`.

**Verify**: `node --test engine/test/session-state.test.ts` → the `wallKind` assertion for a Reviewer block (test 2) FAILS; everything else passes. That failure is the bug.

### Step 3: Apply the rule everywhere

1. `session-state.ts` `wallKind`: change `t.status === "waiting" || …` to `(t.status === "waiting" && !reviewHeld(t)) || …`.
2. `Wall.tsx:526`: `: t.status === "waiting"` → `: t.status === "waiting" && !reviewHeld(t)` (import `reviewHeld` from `"./session-state"`). A Reviewer block then falls through to the last branch, `Done · …`.
3. `Sidebar.tsx:1663`: replace the whole expression with `const state: SideState = sideStateOf(t, busy);`.
4. `design/Tabs.tsx:108`: replace with:
   ```ts
   // As Code's rows mark it (session-state.ts), but a design's row has no "not started" mark.
   const mark = s ? sideStateOf(s) : "done";
   const state: SideState = mark === "new" ? "done" : mark;
   ```
5. `security/Side.tsx:138`: replace the body with `{ const mark = sideStateOf(t); return mark === "new" ? "done" : mark; }` (keep the function's name and comment).
6. `security/Side.tsx:141`: `t.status === "waiting" ?` → `t.status === "waiting" && !reviewHeld(t) ?`.
7. `Compare.tsx:105`: `t.status === "waiting" ?` → `t.status === "waiting" && !reviewHeld(t) ?`.
8. `App.tsx:363`: `waiting: t.status === "waiting"` → `waiting: t.status === "waiting" && !reviewHeld(t)`.
9. `App.tsx:368`: add `&& !reviewHeld(t)` to the filter.
10. `Session.tsx:1001`: the announcement. Find where `status` comes from in that effect (it is read from the session object, `thread`). Make the first branch `status === "waiting" && !reviewHeld(thread) ? `${who} needs you`` so a Reviewer block is not announced as needing the person.
11. `DesignMini.tsx:295`: `t.status === "waiting"` → `(t.status === "waiting" && !reviewHeld(t))`.
12. `design/Chat.tsx:119`: `thread.status === "waiting"` → `(thread.status === "waiting" && !reviewHeld(thread))`.

In each file import `reviewHeld` / `sideStateOf` from the right relative path, written without the extension as the interface's other imports are (`import { DraftMemory } from "./precheck-state";` in `Precheck.tsx`): `"./session-state"`, and `"../session-state"` for files in `design/` and `security/`. Only two imports keep the `.ts` ending, because plain Node reads them: the `Thread` type import inside `session-state.ts`, and the test's import of `session-state.ts`.

**Verify**: `node --test engine/test/session-state.test.ts` → all pass; `npm run typecheck` → exit 0; `grep -rn 'status === "waiting"' ui/src/app --include='*.tsx' --include='*.ts' | grep -v reviewHeld | grep -v session-state.ts` → review each remaining line: the only ones allowed to remain are those that read what a waiting session is asking (for example `Wall.tsx:537-539`, `Wall.tsx:574`, `Wall.tsx:687`) or that are outside the files in scope.

### Step 4: Build

**Verify**: `npm run build` → exit 0.

## Test plan

The five tests in Step 2, in a new file `engine/test/session-state.test.ts`. They import the UI file directly, the way `engine/test/precheck.test.ts` imports `precheck-state.ts`.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `node --test engine/test/session-state.test.ts` passes
- [ ] `npm run build` exits 0
- [ ] `grep -c "reviewHeld" ui/src/app/Wall.tsx ui/src/app/Compare.tsx ui/src/app/design/Chat.tsx ui/src/app/DesignMini.tsx` → at least `1` in each
- [ ] `git status --short` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row updated, with "not seen on screen" noted

## STOP conditions

- `session-state.ts` needs anything from `@contracts` other than the `Thread` type (a value import would break the Node test).
- The Node test cannot import the file ("Cannot find module" or a syntax error from type stripping).
- In `Session.tsx` the announcement effect has no access to the session object, only to copied primitives, and adding `held` to what it copies needs more than a two-line change.
- Moving a function changes the result of `npm run typecheck` in a file not in scope.

## Maintenance notes

- New code that asks "does this session need the person?" must call `needsYou`, `asksYou` or `sideStateOf`, never test `status === "waiting"` itself.
- Open product question left as it is: the Wall shows a finished, unread session as done, while the sidebar and the Dock count it under Needs you.
- Good next candidates for the same move-and-test treatment: `trailSteps` and `liveOf` in `Timeline.tsx`, the drafts store in `Composer.tsx`, `rowLine` and `cardState` in `Sidebar.tsx`.
- Not seen on screen: check one Reviewer-blocked session on the Wall, in the menu bar item and in Liner Design's rows.
