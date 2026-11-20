# 017. A failed read is said, not shown as empty: Changes, Settings, Usage, Projects, Design Home, the manifest form, and Home's notices

**Commit message:** `A failed read says so instead of reading as empty, and a dismissed notice stays away`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Findings: UI-05, UI-17, UI-18, UI-15, UI-02. Every excerpt below is from the advisor's own read.

## Why this matters

The app has a converged pattern for a read that fails: say it, with a way to try again. The full Review keeps
`diffErr` and renders `SurfaceNote "The changes didn't open"` (`ui/src/app/Review.tsx:137,172-177,421-424`); the
Session surface keeps `failed` (`ui/src/app/SessionInfo.tsx:58,62`); the Add-ons "Add from" flow renders its `why` as
`role="alert"` (`ui/src/app/AddonsPage.tsx:461-465`). Seven places still answer a failure with silence, an empty state,
or a loading state that never ends — and one place un-says a dismissal the person already made.

## The pattern to copy (Review.tsx:417-428, as it stands)

```tsx
            {diff === null ? (
              <div className="lc-diff-wait">
                <span className="l-shimmer">Reading the changes</span>
              </div>
            ) : diffErr ? (
              <SurfaceNote icon={<I.alert size={20} />} title="The changes didn't open">
                {diffErr}
              </SurfaceNote>
            ) : !diff.length ? (
              <div className="lc-panel-empty">
                <b>{pick === "branch" ? "This branch matches main" : "Nothing changed here"}</b>
              </div>
```

Three states: waiting, failed (said, with the engine's words), empty. Every step below brings one more place to it.

## Rules (hold for every step)

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders, or L13's
  in-flight files (`app.css`'s panel/ship regions, `Session.tsx`, `addons-page.css`'s Remove rule, `design-face.css`,
  `findings.css`, `checks.css`, `setup.css`, `intro.css`, `surfaces.css`'s switch rule, `timeline.css`,
  `engine/test/layout-rules.test.ts`). Step 1 touches `Panel.tsx`, which L13 does not.
- Each fix comes with a test written first that fails without it. Where the change is component markup, the test is a
  SOURCE test (read the file as text; precedent: `engine/test/layout-rules.test.ts`); where it is pure logic, a node
  test of the module (precedent: `engine/test/session-state.test.ts`). Put this plan's source tests in a new
  `engine/test/said-states.test.ts`, and the logic test in `engine/test/update-notices.test.ts`.
- Test commands need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID` or every file silently skips.
- One local commit, the message above. Never push. Steps are independent: a STOP in one leaves the others doable.

## Steps

### 1. The docked Changes says its diff failed (UI-05)

`ui/src/app/Panel.tsx`, the `Changes` surface. As it stands (:649-675): `diff`/`total` state, the fetch effect whose
catch does `setDiff([]); setTotal(0); fail(e);` with the comment "An empty diff alone would read as a turn that changed
nothing." — the toast fades and the tab reads "0 files changed".

- Add `const [diffErr, setDiffErr] = useState<string | null>(null);` beside `diff` (:649).
- In the effect: `setDiffErr(null)` where `setDiff(null)` is (:662); in the catch, after `setTotal(0)`, add
  `setDiffErr(e instanceof Error ? e.message : String(e));` — keep the `fail(e)` toast too (Review keeps both paths).
- Where `Changes` renders `CodeDiff` (find it below :690; it renders when `diff` is not null), render the three states
  as Review does: `diff === null` → the existing wait; `diffErr` → `<SurfaceNote icon={<I.alert size={20} />}
  title="The changes didn't open">{diffErr}</SurfaceNote>`; else the CodeDiff. Import `SurfaceNote`/`I` as the file
  already does for its other notes (check the imports at the top; Review imports them from `./ui`).
- Do not change the empty-diff words CodeDiff itself shows for a genuine no-change turn.

**Test first** (`engine/test/said-states.test.ts`): "the docked Changes keeps a failed diff said, as the Review does" —
read `Panel.tsx`, assert it contains `setDiffErr(` and `title="The changes didn't open"`; fails before, passes after.
**Verify:** the test passes; `npm run typecheck` and `npm run build` exit 0. On screen (or "not seen"): force
`checkpoint.diff` to fail with Changes docked (a pruned checkpoint), wait out the toast — the note stays.

### 2. Settings' memory and rules editors say they failed, and show while loading (UI-17)

`ui/src/app/Settings.tsx`. As it stands: `MemoryEditor` (:2731-2739) answers a failed `memory.list` with
`setFacts([])` — the empty words "Nothing yet…" — and renders nothing while loading (`if (!facts) return null`).
`RulesEditor` (:2774-2783) answers a failed `project.rules` with `setRules(null)` and `if (!rules) return null` — the
whole "Rules for every agent" field vanishes on error.

For each editor, keep three states as the Session surface does (`SessionInfo.tsx:58,62`):
- add `const [failed, setFailed] = useState<string | null>(null);`
- in the catch: `setFailed(e instanceof Error ? e.message : String(e))` (and leave facts/rules null).
- while the first read is out (`facts === null && !failed` / `rules === null && !failed`): render the field's title
  with `<span className="l-shimmer">…</span>` in place of the rows — not `null`.
- on failure: render the field with a quiet alert line (`<p className="lc-sinfo-note" role="alert">{failed}</p>` is
  the Session surface's shape; use the Settings-local quiet note class if one exists — check the file) and a
  "Look again" button that re-runs the read (clear failed, set the data null, fetch again). Keep the field visible.
- on success clear failed.

**Test first:** "Settings' memory and rules editors say a failed read instead of empty or gone" — read `Settings.tsx`,
assert both editor regions contain `role="alert"` and `Look again` (count ≥ 2 occurrences of the pair within the
editors' span of the file); fails before.
**Verify:** tests, typecheck, build. On screen (or "not seen"): a project whose folder was removed outside the app →
its Settings section shows the said failure, not "Nothing yet" and not a vanished field.

### 3. Usage, Projects' Mac tab, and Design Home distinguish waiting, failed, empty (UI-18)

- `ui/src/app/Usage.tsx` (:18,27-36): `data` starts null and a failed `usage.summary` sets it null again; the page then
  shows "$0 / No turns yet." Add a `failed` state as step 2; while `data === null && !failed` show the page's shimmer
  (the file already uses `l-shimmer` elsewhere — check); on failure a quiet note with the engine's words and the
  page's own refresh button (:279, "Look again") as the retry. The hero figures render only when data is present.
- `ui/src/app/Projects.tsx` (:144-148): `loadMac` answers a failed `projects.scan` with `[]` — "No Git repositories in
  the usual folders." The GitHub tab beside it keeps the failure's detail (:150). Give the Mac tab the same shape:
  keep the error message in the found-state (a `{ detail }` variant or a parallel `macFailed` state), render it as the
  GitHub tab renders its own (read :286 region for the exact pattern), with the tab's Look again (:234) as retry.
- `ui/src/app/design/DesignHome.tsx` (:348-362): `relist`'s failure handler is `() => {}` — `listed` stays null and the
  page says "Looking for designs" forever (:514 region). Give the store a failed flag the page can read: on failure
  set it (with the message), clear it on success; the page renders a said note with a retry that calls `relist()`
  instead of the endless shimmer. Read how `listed`/`listFns` notify the page (:364-380 region) and follow that shape.

**Test first:** one source test per file in `said-states.test.ts` (Usage keeps a failed state; Projects' Mac scan keeps
its error; DesignHome's relist failure is no longer `() => {}`). Each fails before its change.
**Verify:** tests, typecheck, build. On screen (or "not seen"): open Usage with the engine briefly unreachable — a wait
then a said failure, never a confident $0.

### 4. The manifest form says why Add it is grey (UI-15)

`ui/src/app/Settings.tsx`, `AddByHand` (:2553-2621): `parsed` is null whenever `JSON.parse(text)` throws (:2560-2567);
Add is `disabled={busy || !parsed}` (:2615) with no feedback. The sibling flow says why (`AddonsPage.tsx:461-465`,
`role="alert"` under the field).

- Keep a parse-error words state: in the `useMemo`'s catch, capture the message (return `{ error: … }` shape or a
  second memo — match the file's style; the simplest is a `why` string computed beside `parsed`).
- Under the textarea, when `text.trim()` is non-empty and `parsed` is null, render
  `<p className="lc-ao-why" role="alert">That isn't JSON yet: {first words of the parse message}</p>` — reuse the
  Add-ons page's `lc-ao-why` class if it is global (check where it is defined; if it lives in `addons-page.css` and is
  loaded app-wide, use it; otherwise use the Settings-local quiet note class). Wire `aria-invalid`/`aria-describedby`
  on the textarea as `AddonsPage.tsx:460` does.
- Add stays disabled; the words are the fix.

**Test first:** "the by-hand manifest form says why Add it is grey" — read `Settings.tsx`, assert the AddByHand region
contains `role="alert"` and `That isn't JSON yet`; fails before.
**Verify:** tests, typecheck, build. On screen (or "not seen"): paste `{ "id": "x", }` — the line appears.

### 5. A dismissed notice stays away until a newer version (UI-02)

`ui/src/app/Updates.tsx`. As it stands (:104):

```ts
  const shown = u.tools.filter((t) => !(t.state === "available" && u.dismissed[t.id] === t.latest));
```

`dismissNotice` (:129-133) persists a dismissal for every notice id, including the grouped `updated` and single
`failed` ones — but the filter honours it only for `available`. What hides the others afterwards is the vendored
NoticeStack's component-local `gone` state, which dies when Home unmounts (`App.tsx` renders Home only for the home
view). The file's own promise (:5-6): "putting one away keeps it away until a newer version comes out".

- Create `ui/src/app/update-notices.ts` (pure, no React/CSS imports):

```ts
/*
  Which tool notices still speak: a dismissal is kept until a newer version comes out (Updates.tsx's own promise),
  whatever state the tool is in now. Pure, so a node test can pin it.
*/
export const toolShown = (t: { id: string; latest: string }, dismissed: Record<string, string | undefined>) =>
  dismissed[t.id] !== t.latest;
```

- In `noticesOf`, replace the filter with `u.tools.filter((t) => toolShown(t, u.dismissed))`. The app notice (:101)
  already works this way — leave it.
- **Decision for the owner (recorded, like plan 006's):** the dismissal now holds across state changes at the same
  version — a tool put away while "waiting" stays away when it becomes "updated", until a newer version comes out.
  That is the file's stated promise; if the owner wants "updated" to speak again, narrow `toolShown` to the settled
  states and say so in the note.

**Test first** (`engine/test/update-notices.test.ts`, imports the pure module): "a dismissal holds for an updated tool,
not only an available one" (`toolShown({id:"claude",latest:"2.1.330"},{claude:"2.1.330"})` === false — fails against
the OLD filter once you also pin the old behaviour: write a second test "the old filter let a dismissed updated tool
speak again" that reproduces the old predicate inline and asserts it returns true, documenting the bug), "a newer
version speaks again" (dismissed "2.1.329", latest "2.1.330" → true), "an undismissed tool speaks" (→ true).
**Verify:** `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/update-notices.test.ts` passes;
typecheck and build exit 0. On screen (or "not seen"): dismiss an "Updated to X" notice on Home, open a session, back
to Home — it stays away.

## Done

- `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/said-states.test.ts engine/test/update-notices.test.ts`
  passes; every test was seen to fail before its change.
- `npm run typecheck` and `npm run build` exit 0.
- One commit, the message above. Executor note in `plans/README.md`: commit, what was not seen, the step-5 decision,
  any STOP.

## STOP conditions

- A step's cited region has changed in substance (not just line numbers): stop that step, report.
- `SurfaceNote` or the shimmer/note classes are not importable where a step needs them without touching
  `ui/src/liner/`: stop that step and report (the classes live in the app's own sheets — check first).
- Step 3's DesignHome store shape no longer matches `listed`/`listFns`: stop that step.

## Maintenance note

Every new engine read in the UI should land with three states (waiting/failed/empty) — this plan's source tests are
the pattern's tripwire for the named files. A future shared `useRead` hook could replace the per-file states; the
rejected-findings list records that as worth doing only when builders next collide on these files.
