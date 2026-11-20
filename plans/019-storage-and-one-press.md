# 019. A storage-less window keeps working, and Compact and Send-now answer one press

**Commit message:** `A window without storage starts on its own instead of breaking, and Compact and Send-now take one press`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Findings: UI-06, UI-09, UI-10. Every excerpt below is from the advisor's own read.

## Why this matters

1. **UI-06.** The newer code wraps every storage access and says why: "A window without storage (it throws) starts on
   its own each time, rather than breaking the page" (`ui/src/app/design/DesignHome.tsx:181-194`); also `face.ts:18-40`,
   `design/Tabs.tsx:68-89` (`readKept`/`useKept` — try/catch AND a validation predicate), `Commit.tsx:29-45`,
   `Review.tsx:34-50`. Still bare: the APP SHELL itself — `App.tsx:77` (`JSON.parse(sessionStorage.getItem("lc:view") || "") as View`),
   `:197` (`lc:sidebar`), `:203` (`lc:project`), `:253` (`sessionStorage.setItem("lc:view", …)` on EVERY view change),
   `:254-257` (sidebar/project writes), `:400` (`lc:settings` write); Settings — `Settings.tsx:83` (`lc:settings` read,
   cast), `:88` (`lc:enter` read, cast into the union), `:101,:141,:203,:622` (writes); the docked Changes —
   `Panel.tsx:651` (read + `as "split"` cast), `:655` (write); Device — `Device.tsx:17` (read), `:55` (write).
   With storage blocked or full, the app fails at mount or on the first navigation — the Boundary fault screen replaces
   the whole app, not one tab. A corrupted `lc:view`/`lc:enter` value passes its cast straight into the code.
2. **UI-09.** `compactNow` (`ui/src/app/SessionInfo.tsx:51-56`) sends `/compact` with no in-flight guard; the button
   (:279) is disabled only by `running || !ctx` — a store value that updates an engine round-trip after the press. Two
   quick presses both send; the second `/compact` queues (`runtime.ts` send enqueues while running) and spends a turn
   summarising what was just summarised. StartScan guards exactly this (`security/StartScan.tsx:58-61`): a `starting`
   state AND a `going` ref, "so a second press (Enter held, or pressed again …) can't slip past before React draws the
   button as Starting."
3. **UI-10.** The ⌘⇧Enter "Send now" handler (`ui/src/app/Composer.tsx:722-734`) checks key/modifiers/`isComposing` but
   not `e.repeat`, and `sendNow` (:691-707) has no in-flight guard. Holding the shortcut sends the then-first queued
   message on every key-repeat (~30 ms) — the queue drains one message at a time. The repo's own pattern checks repeat
   (`security/StartScan.tsx:388`, `!e.repeat` on Enter).

## The canonical copy (design/Tabs.tsx:68-89, as it stands)

```tsx
function readKept<T>(key: string, fallback: T, ok: (v: unknown) => v is T): T {
  if (keptNow.has(key)) return keptNow.get(key) as T;
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
```

— and its write half wraps `setItem` in try/catch with the comment "private window: the choice lasts until the window
closes". `Commit.tsx:29-45` is the plain-string variant.

## Rules (hold for every step)

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders, or L13's
  in-flight regions. This plan touches `App.tsx`, `Settings.tsx`, `Panel.tsx`, `Device.tsx`, `SessionInfo.tsx`,
  `Composer.tsx` — L13 touches none of these except `Session.tsx` (not in this plan). `design/Tabs.tsx` is L13's: do
  NOT move its helper; copy the pattern into the new shared module and leave Tabs.tsx alone.
- Tests first: the shared helper gets node tests with a fake storage that throws; the component guards get SOURCE
  tests (precedent `engine/test/layout-rules.test.ts`). New files: `engine/test/kept-storage.test.ts`,
  `engine/test/press-guards.test.ts`.
- Test commands need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push. Steps independent; a STOP in one leaves the rest doable.

## Steps

### 1. One shared kept-storage helper, test first

Create `ui/src/app/kept.ts` (no React, no CSS — loads under Node). Take the storage object as a parameter so a test
can hand it one that throws:

```ts
/*
  A preference kept in window storage, for a window where storage throws (blocked or full): the read falls back to the
  default and validates what it finds, the write fails quietly. The pattern design/Tabs.tsx and Commit.tsx already
  use, as one helper the bare sites can take. `ok` guards the cast: a corrupted value falls back too.
*/
export type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export const keptRead = <T>(s: Store, key: string, fallback: T, ok: (v: unknown) => v is T): T => {
  try {
    const v: unknown = JSON.parse(s.getItem(key) ?? "null");
    return ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
export const keptWrite = (s: Store, key: string, v: unknown) => {
  try {
    s.setItem(key, JSON.stringify(v));
  } catch {
    // Full or blocked: the choice lasts until the window closes.
  }
};
/** For the plain-string preferences (lc:sidebar, lc:enter, lc:view): no JSON, just the known words. */
export const wordRead = (s: Store, key: string, words: readonly string[], fallback: string): string => {
  try {
    const v = s.getItem(key);
    return v !== null && words.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
export const wordWrite = (s: Store, key: string, v: string) => {
  try {
    s.setItem(key, v);
  } catch {
    // As keptWrite.
  }
};
```

`engine/test/kept-storage.test.ts` FIRST: a fake store whose get/set throw → reads return the fallback, writes do not
throw; a corrupted JSON value → fallback; a value outside `words` → fallback; a known value → itself; a round-trip
through a working fake store. See them pass against the new module (the module is new; the FAILING-first tests are the
source tests of steps 2-5, which pin the bare sites before the change).

**Verify:** `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/kept-storage.test.ts` passes.

### 2. The app shell (App.tsx)

Replace each bare site with the helper, keeping the existing defaults:
- `:77` the `lc:view` read: `keptRead(sessionStorage, "lc:view", <the same default view the code uses when nothing is stored>, isView)`
  where `isView` validates the shape minimally (an object whose `kind` is one of the view kinds the file's own type
  names — read the `View` type at the top of the file; do not invent kinds). On any doubt the fallback is the default.
- `:197` `lc:sidebar`: `wordRead(localStorage, "lc:sidebar", ["0", "1"], "1") !== "0"`.
- `:203` `lc:project`: a string read with try/catch (keptRead with a string predicate), fallback undefined.
- `:253,:254,:256,:400` the writes: `keptWrite`/`wordWrite` as appropriate.
Import from `./kept.ts`. Do not change what is stored, only how it is read/written.

**Test first** (`press-guards.test.ts` or a new `engine/test/shell-storage.test.ts`): source test "the app shell's
storage reads and writes are guarded" — assert `App.tsx` contains `keptRead(`/`wordRead(` and no bare
`localStorage.getItem(` / `sessionStorage.getItem(` / `.setItem(` outside the helper import region (grep-style
assertion on the file text; the helper calls live in kept.ts, so App.tsx should have zero direct storage calls after).
Fails before.
**Verify:** tests, `npm run typecheck`, `npm run build`.

### 3. Settings (Settings.tsx:83,88,101,141,203,622)

- `:83` `lc:settings` (sessionStorage): `wordRead` against the `SettingsPage` union's values (read the type; list them
  in the call), fallback `initial`.
- `:88` `lc:enter`: `wordRead(localStorage, "lc:enter", ["queue", "steer"], "queue")` — the cast is gone.
- `:101,:141,:203,:622`: `wordWrite`/`keptWrite` (the look at :141 is JSON → keptWrite).
- Check `AgentDialog.tsx:391-395` while here: the auditor read it as guarded; if its `lc:project` read is bare, give it
  the same treatment (one line).

**Test first:** source test "Settings' preference reads validate their values and guard storage" — assert
`Settings.tsx` contains `wordRead(` and no bare `localStorage.getItem("lc:enter")`. Fails before.
**Verify:** tests, typecheck, build.

### 4. The docked Changes (Panel.tsx:651,655) and Device (Device.tsx:17,55)

- `Panel.tsx:651`: `useState<"unified" | "split">(() => wordRead(localStorage, "lc:view", ["unified", "split"], "unified") as "unified" | "split")`
  — the helper returns a known word, the cast is now safe; `:655`: `wordWrite`.
- `Device.tsx:17`: the udid read — a string read with try/catch (keptRead with a string-or-null predicate), fallback
  null; `:55`: keptWrite/wordWrite (it stores a plain string).

**Test first:** source tests per file as above. **Verify:** tests, typecheck, build.
**On screen (or "not seen"):** block storage for the app origin (DevTools → Application → storage, or a private window
with storage disabled) — the app mounts, navigates, changes the accent, opens Changes and Device without the Boundary
fault screen. This is the finding's whole point; if you cannot run the app, say "not seen".

### 5. Compact takes one press (UI-09)

`ui/src/app/SessionInfo.tsx`:
- Add `const compacting = useRef(false);` beside `compactNow` (:51). In `compactNow`: `if (compacting.current) return;`
  first; set it true before the rpc; clear it in BOTH the then and the catch (the turn's own running state takes over
  the disabling once it lands). Mirror StartScan's comment style: one sentence saying why.
- The button (:279): `disabled={running || !ctx || compacting.current}` is not reactive on a ref — use a state instead
  (`const [compacting, setCompacting] = useState(false)`), set at the press, cleared on settle; the ref is unnecessary
  because the state setter is synchronous enough within one event (StartScan keeps both because its button lives in
  another component; here the button reads the same state — a state alone suffices; say so in the comment).
- Do not change what `/compact` sends.

**Test first** (`press-guards.test.ts`): source test "Compact is disabled from its own press, not only the turn's
status" — assert the SessionInfo region contains a `compacting` state and the button's disabled reads it. Fails before.
**Verify:** tests, typecheck, build. On screen (or "not seen"): double-click Compact before the status lands — one
`/compact` goes. MED-confidence note: whether the tool no-ops a second `/compact` needs the real tool; the guard is
right either way.

### 6. A held ⌘⇧Enter sends one message, and Send-now marks it in flight (UI-10)

`ui/src/app/Composer.tsx`:
- In the keydown handler (:726), add `|| e.repeat` to the early-return condition (one word, comment why: a held key
  repeats, and each repeat would send the next queued message).
- In `sendNow` (:691-707): keep an in-flight set in a ref (`const sending = useRef(new Set<string>())`); at the top,
  `if (sending.current.has(q.id)) return;` and add the id; remove it when the queue event lands (the `steered` effect
  at :708-716 already watches the queue — clear the id there when its message is gone from the queue) and in the catch
  (which already restores the queue). The `steered` ref stays as it is — it serves the reorder display.
- The queue row's own "Send now" button calls the same `sendNow`, so it inherits the guard.

**Test first:** source test "a held Send-now shortcut sends one message" — assert the Composer keydown region contains
`e.repeat` and `sendNow`'s region contains an in-flight guard (`sending.current.has`). Fails before.
**Verify:** tests, typecheck, build. On screen (or "not seen"): queue three messages, hold ⌘⇧Enter a second — one goes.

## Done

- `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/kept-storage.test.ts engine/test/press-guards.test.ts engine/test/shell-storage.test.ts`
  passes (whichever of the source-test files you created); every source test seen to fail before its change.
- `npm run typecheck` and `npm run build` exit 0.
- One commit, the message above. Executor note: commit, what was not seen, any STOP.

## STOP conditions

- A cited site's substance changed (not just lines): stop that step, report.
- The `View` type's kinds are not enumerable as a simple union (a discriminated shape with nested data): validate only
  the outer `kind` and fall back on anything else — if even that is unclear, STOP step 2's view-read and report.
- Any step would need a change under `ui/src/liner/` or in L13's regions.

## Maintenance note

New preferences should use `kept.ts` from the start; the source tests assert zero direct storage calls in the named
files, so a new bare site fails the suite. `design/Tabs.tsx` keeps its own `readKept`/`useKept` for now (L13's file);
a later pass can fold it into the shared helper — record that in the note, do not do it here.
