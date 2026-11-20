# 020. Every scrollbar is thin, and Changes re-scrolls on a second press

**Commit message:** `Every scrollbar is thin, and a file pressed again scrolls again in Changes`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Refreshed 2026-11-20 at 13c7757 after the advisor's review.
Findings: UI-12 (partly), UI-07.

**Removed: the old step 1 (UI-03, three spinners under Reduce Motion).** The finding is false. `ui/src/main.tsx:19`
puts `l-scope` on body, and `ui/src/liner/foundation.css:619-627` gives every element under it
`animation-duration: 1ms !important; animation-iteration-count: 1 !important` under `prefers-reduced-motion: reduce`.
None of the three elements carries `data-timer`, so all three already stop. This was so at bfb0ebc too. That global
rule is how the app does Reduce Motion; the per-sheet reduce blocks are extra.

## What the review changed

- Step 1 (Reduce Motion) is removed, for the reason above.
- The scroller step is now one declaration: `scrollbar-width: thin` in the app's existing all-elements rule
  (`app.css:385-387`), whose comment already promises "Every scrollbar thin". The quiet colour is already there.
- Hover-only thumbs on the page scrollers, and `overscroll-behavior: contain`, are no longer planned. They are the
  owner's design call (see "Not planned").
- The scroller step needs an on-screen check with the OS set to show scroll bars always, because a CSS change reasoned
  but never seen has been wrong before.
- The Changes re-scroll step is kept. Both tests were seen failing against the current tree.
- L13 is committed, so the ordering note is gone.

## Why this matters

1. **UI-12 (the part that holds).**
   - `app.css:383-387` reads: "Every scrollbar thin and quiet: a soft thumb on no track. Set per element, with no
     weight, so a scroller's own rule still wins". It then sets only `scrollbar-color: var(--l-line-2) transparent`.
   - So the page scrollers (Settings `.lc-st-scroll`, Security `.ls-scroll`, Add-ons `.lc-ao-scroll`, Usage, Home, the
     finding panel) get the quiet colour but full width.
   - The thread (`.lc-scroll`, `app.css:1926-1943`) and Design's scrollers set `thin` themselves. With "Show scroll
     bars: Always", the faces draw scrollbars of two widths.
2. **UI-07.** In the full Review, pressing a file again after scrolling away scrolls again: the effect depends on the
   `focus` OBJECT (`Review.tsx:237-242`, deps `[diff, focus]`, and the comment says so). The docked Changes' effect
   depends on `focus?.path` (`Panel.tsx:685-692`, deps `[diff, focus?.path]`). That string does not change on a
   second press, so the gesture does nothing there.
   - Each press makes a new object: `Session.tsx:301-302`, `review = useCallback((id, path) => { setFocus({ id, path }); …`.
   - `Panel.tsx:191` and :217 do the same through `onFocus({ id, path })`.
   - The turn picker (:719) passes `{ id }` with no path, and the effect's guard returns for it.

## Current state (drift check)

```bash
git log --oneline -1                          # 13c7757 or later
sed -n 383,387p ui/src/app/app.css            # the :where(*) rule, scrollbar-color only
sed -n 685,692p ui/src/app/Panel.tsx          # Changes' scroll effect, deps [diff, focus?.path]
sed -n 237,242p ui/src/app/Review.tsx         # Review's, deps [diff, focus]
```

## Rules (hold for every step)

- Never run a formatter. CSS changes go IN PLACE, in the rule they correct: no override block appended at the end of
  a file, no `!important`. When a rule changes, fix the comment above it in the same edit if it describes the old look.
- Do not touch `ui/src/liner/**`, Routines' rules (`.lc-rt*`, `.lc-rb*`, `.lc-run*`), `mac/`, the Demo provider,
  `CHANGELOG.md`, or the untracked folders.
- Plan 019's edits may be uncommitted in `Panel.tsx` (its import and the `lc:view` lines at :653-657). Keep them and
  commit only this plan's hunks (`git add -p`).
- Tests first, in a NEW file `engine/test/css-details.test.ts`. Copy the three helpers (`sheet`, `blocks`, `value`)
  from the head of `engine/test/layout-rules.test.ts`; do not modify that file. Test commands need
  `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit with the message above. Never push.

## Steps

### 1. Every scrollbar thin (UI-12)

`ui/src/app/app.css:385-387`: add `scrollbar-width: thin;` to the existing `:where(*)` rule, below its
`scrollbar-color`. Its comment already says "thin", so leave it. Change nothing else. Scrollers that set their own
width keep it, because `:where()` has no weight: the thread's `thin` and every `scrollbar-width: none` stay as they
are. Do not add per-scroller rules.

**Test first** (`css-details.test.ts`): "Every scrollbar in the app is thin, as the shared rule's comment says".
Assert `blocks(sheet("app.css"), ":where(*)")` has one block, and that block's `scrollbar-width` is `thin`. Seen
failing against the current tree (`actual: undefined`).
**Verify:** the test passes; `npm run build` exits 0. On screen, which is required here (write "not seen" only if you
truly could not run the app):
- Set macOS System Settings → Appearance → "Show scroll bars" to Always. Open Settings beside a session: both
  scrollbars are the same thin width.
- Glance at Security, Add-ons, a long code block in the thread, and the composer with a tall draft. The Terminal's
  viewport already sets `thin` itself (`surfaces.css:543-546`), so it does not change.
- Set "Show scroll bars" back afterwards.
- If any scroller looks wrong (a clipped column, a scrollbar over content), STOP and report it with a screenshot. Do
  not add per-element exceptions.

### 2. Changes re-scrolls to a file pressed again (UI-07)

In `ui/src/app/Panel.tsx`, the effect commented "The file pressed in the thread scrolls into view and counts as looked
at" (:685-692):
- Change its deps from `[diff, focus?.path]` to `[diff, focus]`, as Review's are (`Review.tsx:242`).
- Keep the guard inside (`if (!diff || !focus?.path) return;`) and the viewed mark. `setViewed` adds to a Set, so
  running it again is harmless.
- Add to the comment, in the same sentence style: pressed again after scrolling away, it does again, as in the Review.

Before changing, read the press path (`Session.tsx:301-302`, `Panel.tsx:191,217`). If `focus` is ever the SAME
object on a second press, STOP and report: the fix would do nothing.

**Test first:** "The docked Changes scrolls again to a file pressed a second time, as the Review does".
- Read `Panel.tsx` as text and find the comment "// The file pressed in the thread scrolls into view".
- Take the first `\n  }, [ … ]);` after it and assert the deps read `diff, focus`.
- Seen failing against the current tree (`actual: 'diff, focus?.path'`).

**Verify:** tests, `npm run typecheck`, `npm run build`. On screen (or say "not seen"): with the docked Changes open,
press file A in the thread, scroll the diff away, press A again; it scrolls back.

## Done

- `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/css-details.test.ts` passes, and both
  tests were seen to fail before their changes. `engine/test/layout-rules.test.ts` still passes, untouched.
- `npm run typecheck` and `npm run build` exit 0.
- One commit with the message above. Executor note: the commit, what was seen with scroll bars set to Always (or
  "not seen"), and any STOP.

## STOP conditions

- A named rule's substance changed (not just its line): stop that step and report.
- Step 1: anything looks wrong on screen with scroll bars set to Always: stop and report.
- Step 2: `focus` is the same object on a second press: stop and report.
- Any change would land in `ui/src/liner/` or in Routines' rules.

## Not planned (the owner's design call)

- **Hover-only thumbs on the page scrollers.** The thread hides its thumb until the pointer is over it, for a reason
  of its own: no track down the edge between the thread and the panel (`app.css:1933-1934`). On a long Settings or
  Security page, the thumb is the only cue that more is below. Hiding it there is a design choice, not a fix.
- **`overscroll-behavior: contain` on the page scrollers.** The audit said the thread "holds" its overscroll, but
  `.lc-scroll` sets no `overscroll-behavior` (`app.css:1926-1931`). html, body and #root are `overflow: hidden`
  (`app.css:149-155`), so a chained scroll has no scrollable parent to move. No harm is shown. Whether the mac
  rubber-band appears at the root was not checked.

## Maintenance note

Scrollbar width and colour now both come from the one `:where(*)` rule. A scroller that needs something else sets it
on its own rule, which wins because `:where` has no weight. Reduce Motion is handled for the whole app by
`liner/foundation.css`'s `.l-scope` rule. A new animation needs no reduce block of its own, unless it carries
`data-timer` or must keep running under Reduce Motion.
