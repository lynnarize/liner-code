# 018. One keyboard pattern: every tablist and radio group answers to the arrows, menus to Home/End, and the add-on sheet gives focus back

**Commit message:** `Every tab list and choice group moves by the arrows, right-click menus by Home and End too, and the add-on sheet gives the keyboard back`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Refreshed 2026-11-20 at 13c7757 after the advisor's review (plan 019's uncommitted edits in the tree are counted in
the line numbers below).
Findings: UI-11, UI-16, UI-20, UI-04, UI-08.

## What the review changed

- The shared code is a plain function, `roveKeys(e, selector, how)`. It is not a hook: several groups sit inside
  conditional JSX (`Session.tsx:641`, `Terminal.tsx:467`, `Models.tsx:198`, `Home.tsx:198`, `Design.tsx:222`), where
  calling a hook inline breaks the rules of hooks.
- The old guard "skip when `e.target !== e.currentTarget`" is gone: on a group's onKeyDown it is always true, so the
  handler would never run. The real guard is that the focused element is one of the group's items, plus no modifier
  keys (`Session.tsx:530-533` uses ⌥↑/⌥↓ at window level and does not look at `defaultPrevented`).
- The Tab stop is the selected item, or the FIRST item when nothing is selected. Settings' Mode cards
  (`value=""`, `Settings.tsx:891`), the Accent swatches (`!own && …`, :896) and the Models rail while a query is typed
  all select nothing, so `on ? 0 : -1` would have taken the whole group out of Tab.
- Radios take all four arrows, as StartScan does (`security/StartScan.tsx:407-417`).
- Design's open-designs list is dropped. `SideList.tsx:192` runs `listArrows` on every row, so Up/Down already move
  there. Roving -1 would break `listArrows`, which skips `[tabindex='-1']` (:27).
- New site: `security/Findings.tsx:290` ("Findings by state") is its own tablist, not `CountTabs`. The Models rail is
  decided as vertical, with automatic activation (step 2.6).
- The Timeline's "Something else" box no longer takes focus when it was picked by an arrow key.
- The add-on sheet's focus goes back from the page (an effect on `open`), not from inside the sheet. The sheet's own
  layout effect would capture the Close button, whose autoFocus runs first (React 19 commits a child's autoFocus
  before its parent's layout effects). The failed check names are a visible second line, not a HoverNote.

## Why this matters

The app already teaches two keyboard patterns, then breaks them elsewhere:
- The dock strip implements WAI-ARIA tabs: arrows, Home, End and a roving tabindex (`ui/src/app/Panel.tsx:452-460`,
  `tabIndex={on ? 0 : -1}` at :506). So does the Design inspector (`design/Inspector.tsx:79-95`). Eight other
  `role="tablist"`s have none of it.
- StartScan's boxes move by the arrows (`security/StartScan.tsx:407-417`). Nine other `role="radiogroup"`s, in six
  files, have no arrow handling.
- `Pop` menus move by ArrowDown/Up/Home/End (`ui/src/app/ui.tsx:201-208`). The right-click `ContextMenu` handles only
  ArrowDown/Up (`ui.tsx:253-260`).
- The add-on Details sheet takes focus (Close has `autoFocus`, `AddonsPage.tsx:329`) but never gives it back, and Tab
  walks the page behind it.
- The Session surface's failed check names exist only in a native `title` on a plain div (`SessionInfo.tsx:160-175`;
  `Line` at :368-375).

Helpers that already exist and why they are not reused: `SideList.tsx:25 listArrows` (Up/Down along a sidebar list,
by the list's own stops), `Composer.tsx:1354 rove` / `roveStrip` / `roveGrid` (local walkers with column and edge
rules), `Settings.tsx:190` and `security/Findings.tsx:230` (row lists). None does tab and radio semantics. Liner's
`RadioGroup`, `RadioCards` and `Tabs` (`ui/src/liner/components/…`) do, but moving these sites onto them would restyle
them. So this plan adds one small helper file.

## Rules (hold for every step)

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, or the untracked folders.
- L13 is committed (`dbcddff`, `c94e0db`). Plan 019's edits may still be uncommitted in `App.tsx`, `Composer.tsx`,
  `Device.tsx`, `Panel.tsx`, `SessionInfo.tsx`, `Settings.tsx` and `kept.ts`. Keep them, and commit only this plan's
  hunks (`git add -p`). If a cited region's substance changed, STOP that site.
- Each fix comes with a test written first that fails without it. Pure logic gets node tests; each site's wiring gets
  a SOURCE test (read the file as text, as `engine/test/layout-rules.test.ts` does). New tests:
  `engine/test/roving.test.ts` (logic) and `engine/test/keyboard-pattern.test.ts` (source).
- Test commands need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit with the message above. Never push. Sites are independent: a STOP at one leaves the rest doable.

## Steps

### 1. The shared move logic, test first

Create `ui/src/app/roving.ts`. It has no React runtime import: the type import is erased, so the engine tests can
import the file directly. This exact code was tried in a scratch copy and its four tests pass:

```ts
/*
  The arrows, Home and End in a tab list or a choice group, as the dock strip (Panel.tsx) and StartScan
  (security/StartScan.tsx) answer them, so every such group answers the same way. A plain function, not a hook:
  several groups sit inside conditional JSX.
*/
import type { KeyboardEvent } from "react";

/** Where a key moves in a list of `count`, from `at`: Left and Right always, Up and Down too when `both`. -1: it doesn't. */
export const rove = (key: string, at: number, count: number, both = false): number => {
  if (count < 1 || at < 0) return -1;
  if (key === "ArrowRight" || (both && key === "ArrowDown")) return (at + 1) % count;
  if (key === "ArrowLeft" || (both && key === "ArrowUp")) return (at - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return -1;
};

/** The item that keeps the one Tab stop: the chosen one, or the first while none is chosen (else Tab skips the group). */
export const tabStop = (on: boolean[]): number => Math.max(0, on.indexOf(true));

/**
  A group's onKeyDown. `sel` finds its items; the focused element must be one of them, so a field inside an item (the
  question card's own answer) keeps its keys. `pick` also chooses the item (radios, StartScan's way) and implies Up and
  Down; without it focus moves and Enter or Space chooses (tabs, the strip's way). A key with a modifier is someone
  else's (⌥↑ and ⌥↓ move between prompts).
*/
export function roveKeys(e: KeyboardEvent<HTMLElement>, sel: string, how: { both?: boolean; pick?: boolean } = {}) {
  if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(sel)];
  const to = rove(e.key, items.indexOf(document.activeElement as HTMLElement), items.length, how.both || how.pick);
  if (to < 0) return;
  e.preventDefault();
  items[to].focus();
  if (how.pick) items[to].click();
}
```

Write `engine/test/roving.test.ts` first (`import { rove, tabStop } from "../../ui/src/app/roving.ts";`):
- "The arrows step through a list and wrap at both ends" (Right from the last gives 0, Left from 0 gives the last,
  Home gives 0, End gives the last).
- "Up and Down move only where the list says they do" (ArrowDown gives -1 without `both`, and steps with it).
- "Nothing moves from outside the list, in an empty list, or on another key".
- "With nothing chosen, the first item takes the one Tab stop" (`tabStop([false, true])` is 1, `tabStop([false, false])` is 0).

The tests fail before because the module does not exist. Selectors used below: `[role=tab]` for tabs;
`[role=radio]:not([aria-disabled]):not(:disabled)` for radios. BgTile uses `aria-disabled` (`Settings.tsx:1011`), and
Terminal's close buttons sit inside its tablist, so the selector has to name the role.

**Verify:** `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/roving.test.ts` passes.

### 2. The tablists (UI-11): manual activation, roving tabindex

For each site, add `onKeyDown={(e) => roveKeys(e, "[role=tab]")}` to the `role="tablist"` element. Before the map,
compute `const stop = tabStop(<items>.map(<is selected>))`, and give each tab `tabIndex={k === stop ? 0 : -1}`.
Keep each site's onClick. Re-grep `role="tablist"` first. Expect exactly these sites, plus the strip
(`Panel.tsx:479`), the inspector (`design/Inspector.tsx:89`) and Design's open designs (`design/Tabs.tsx:216`); the
last three stay as they are.

1. `ui/src/app/security/parts.tsx:112-123`: `CountTabs` (`.ls-sg` buttons; it serves `security/Projects.tsx:82` and
   `security/FoundPanel.tsx:161`).
2. `ui/src/app/security/Findings.tsx:290-297`: "Findings by state", its own markup, not `CountTabs`.
3. `ui/src/app/security/FindingPanel.tsx:256-262`: Summary, Code, Activity.
4. `ui/src/app/Session.tsx:642-649`: Chat beside a tab app (inside `tabApps.length > 0 &&`).
5. `ui/src/app/Terminal.tsx:468-479`: the shells. Only the `role="tab"` buttons rove; the close buttons, `lead` and
   "Another shell" keep their own Tab stops.
6. `ui/src/app/Models.tsx:198-220`: the tool rail, which is VERTICAL (`models.css:18-20`, `flex-direction: column`).
   Decided:
   - Give it `aria-orientation="vertical"` and
     `onKeyDown={(e) => (roveKeys(e, "[role=tab]", { pick: true }), e.defaultPrevented && e.stopPropagation())}`.
     That is AUTOMATIC activation with all four arrows. Automatic, because Enter here is already taken: the picker's
     root `keys` (:159-172) turns Enter into "pick the lit model". The stopPropagation keeps the rail's Up/Down from
     also moving the model list's highlight in `keys`.
   - Selection there is `rail === … && !query`, so while a query is typed nothing is selected and `tabStop` gives
     the star.
   - Do not change `keys`.
7. `ui/src/app/Modes.tsx:117-124`: the guide's two sections (inside Liner's Dialog; that is fine, as the dialog is
   not edited).

**Test first** (`engine/test/keyboard-pattern.test.ts`): read each file as text and take the region from the
tablist's `aria-label` (e.g. `aria-label="Findings by state"`, `aria-label="Shells"`) to about 1500 characters on.
Write one test per site, for example "The Findings state tabs move by the arrows and keep one Tab stop". Each asserts
that the region contains `roveKeys(` and a `tabIndex={` on the tabs. For Models, also assert
`aria-orientation="vertical"`. Each fails before, since none of the files contains `roveKeys` yet.
**Verify:** tests, `npm run typecheck`, `npm run build`. On screen (or say "not seen"):
- On the Findings page, focus "Open" and press ArrowRight: focus moves and the list does not change until Enter.
- Tab enters the list once.
- In the model picker's rail, ArrowDown moves to the next tool and shows its models.

### 3. The radio groups (UI-16): StartScan's activation

For each group: `onKeyDown={(e) => roveKeys(e, "[role=radio]:not([aria-disabled]):not(:disabled)", { pick: true })}`
on the `role="radiogroup"` element, a `stop` from `tabStop`, and `tabIndex={k === stop ? 0 : -1}` on its radios.
Leave the composer's permission group AS IT IS: it uses number keys with visible kbd hints (`Composer.tsx:919-944`),
a documented exception. Sites:

1. `ui/src/app/Home.tsx:199-206`: "Where it runs" (two buttons).
2. `ui/src/app/Design.tsx:223-230`: "Where the design lives".
3. `ui/src/app/Timeline.tsx:1587-1606`: `QuestionCard`'s options (divs with `tabIndex={0}` today; one is always
   chosen, `pickOf` at :1562).
   - The textarea inside "Something else" keeps its letters on its own: the focused element is the textarea, not an
     item.
   - The arrows must not pull focus out of the group. Today the box mounts with `autoFocus={picks[q.question] === OTHER}`
     (:1604), so an arrow that picks "Something else" would drop focus into the box.
   - The fix: add `const arrowed = useRef(false);` at the top of `QuestionCard`, beside its `useState`s (:1525-1527).
     It must go BEFORE the early `return` at :1528, or the hook order breaks.
   - In the option's onClick, set `arrowed.current = e.detail === 0`. `roveKeys` chooses by `.click()`, whose event
     has `detail` 0 (seen in Electron 44.9.3); a pointer's click has 1 or more.
   - In the option's Enter/Space handler (:1591-1596), set it `false` before `setPicks`.
   - The textarea becomes `autoFocus={picks[q.question] === OTHER && !arrowed.current}`. Comment why: an arrow
     passing over "Something else" leaves you in the group, while a press on it puts you in the box.
4. `ui/src/app/Settings.tsx`:
   - The `PictureCards` group at :807-821, which serves Theme (:837, `value` can be `""`) and "Where designs and
     pages open" (:969).
   - The Accent swatches at :894-901 and the Main buttons swatches at :913-920. Each has an optional "own" radio after
     the map, so compute `stop` over the whole list.
   - The backgrounds at :1057. `BgTile` (:1008-1015) takes a new `stop` boolean prop for its tabIndex; Desktop can be
     `aria-disabled` and is skipped by the selector.
5. `ui/src/app/AgentDialog.tsx:183-192`: "Good at".
6. `ui/src/app/Addon.tsx:612-622`: an offer's "Add to".

**Test first:** one source test per region, shaped as in step 2. For Timeline, also assert that the textarea's
`autoFocus` reads `arrowed`. "A tabIndex that is not the literal 0" catches the Timeline's current `tabIndex={0}`.
Each fails before.
**Verify:** tests, typecheck, build. On screen (or say "not seen"):
- Focus Home's "This checkout" and press ArrowDown: "Worktree" takes focus and is picked.
- On a question card, ArrowDown onto "Something else" picks it and focus stays on the option; a click on it puts the
  cursor in the box.
- Under Settings, Appearance, with your own theme in use, Tab still reaches the Mode cards.

### 4. Right-click menus get Home and End (UI-20)

In `ui/src/app/ui.tsx`, lift the Pop's computation (:202-208) into a small local helper in the same file:
`menuStep(key, i, n)`, returning the target index or -1 for any other key. Use it in both the Pop's handler and the
ContextMenu's (:253-260), so they cannot drift again. Each keeps its own selector: the Pop's `[role^='menuitem']:not(:disabled)`
and the ContextMenu's `button:not(:disabled)`. Menus are vertical: do not use `rove` here, since Left/Right must not
move a menu.

**Test first:** a source test, "The right-click menu answers Home and End as the Pop menu does". Take the region from
`export function ContextMenu` to `export function Row` and assert it handles `Home` and `End` (or calls
`menuStep(`). It fails before: the region names neither.
**Verify:** tests, typecheck, build. On screen (or say "not seen"): right-click a dock tab and press End; the last row
takes focus.

### 5. The add-on sheet gives focus back and keeps the page behind it out of Tab (UI-04)

`ui/src/app/AddonsPage.tsx`:
- Remember the opener in the PAGE, not in `Details`.
  - Add `const opener = useRef<HTMLElement | null>(null);`.
  - The row's button (:181) becomes `onClick={(e) => ((opener.current = e.currentTarget), setOpen(a.id))}`.
  - Add `useEffect(() => { if (open === null && opener.current) { opener.current.focus({ preventScroll: true }); opener.current = null; } }, [open]);`
    with a comment saying why. Capturing inside `Details` would get the Close button, because React 19 commits its
    autoFocus before Details' own layout effect. The effect runs after the sheet has gone and the page is no longer
    inert (focus() on an inert element does nothing). An effect on `open` does not re-run under StrictMode's
    mount-twice, unlike a cleanup in a component that mounts with the sheet.
- While the sheet is shown (`const sheet = Boolean(picked && !picked.removed)`, the condition at :236), put
  `inert={sheet || undefined}` on the page's `<header className="lc-top">` (:123) and its `<div className="lc-ao-scroll">`
  (:131). Do not add a wrapper: those two and the sheet are siblings in `.lc-ao-page`, and the sheet is
  `position: absolute; inset: 0` over them (`addons-page.css:297-307`).
- The window's sidebar stays reachable by Tab, as it is outside this page. That is intended: the sheet covers the
  page, not the window.
- Leave Escape (:268-272) as it is. Do not move the sheet to Liner's Dialog: the dialog-system decision is the
  owner's.

**Test first:** a source test, "The add-on sheet hands focus back to its row and keeps the page behind it out of Tab".
Assert that `AddonsPage.tsx` sets `opener.current` in the Details button's onClick, focuses `opener.current` in an
effect on `[open]`, and has `inert=` on the `lc-ao-scroll` element. It fails before: none of these exist.
**Verify:** tests, typecheck, build. On screen (or say "not seen"), keyboard only:
- Focus a row's Details, press Enter, then Escape: focus is back on that button.
- While the sheet is open, Tab never reaches the page's rows.

### 6. The failed checks' names in text (UI-08)

`ui/src/app/SessionInfo.tsx`, `ChecksLine` (:160-175): the names live only in `title` (:165, rendered by `Line` as a
native title at :370), and `.lc-sinfo-v` is `white-space: nowrap` (`surfaces.css:349-353`), so the row cannot wrap.

Render a second line under the row:
- `ChecksLine` returns a fragment: the `Line` (keep its `title`), then, when checks failed or are still running,
  `<p className="lc-sinfo-note lc-sinfo-why">{failed.length ? `Failed: ${…}` : `${running} still running`}</p>`.
- `lc-sinfo-note` (`surfaces.css:490-498`) already gives 13px in `--l-ink-3`.
- Add one rule beside it, `.lc-sinfo-why { margin: 0 0 4px; padding-left: 28px; }`, with a comment that 28 is the
  icon column (18, :346) plus the row's gap (10, :337), so the names start under "Checks". These numbers are reasoned,
  not seen: look at them on screen and correct them in place if the line does not sit under the word.

**Test first:** a source test, "The Session checks say their failed names in text, not only in a pointer title".
Assert that the `ChecksLine` region renders the names expression inside an element with `lc-sinfo-why`. It fails
before: no such element exists.
**Verify:** tests, typecheck, build. On screen (or say "not seen"): a session with a failed PR check shows the names
under the Checks row, and VoiceOver reads them as text.

## Done

- `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/roving.test.ts engine/test/keyboard-pattern.test.ts`
  passes, and every test was seen to fail before its change.
- `npm run typecheck` and `npm run build` exit 0.
- One commit with the message above, holding only this plan's hunks. Executor note: the commit, per-site status (any
  STOP), and what was not seen on screen.

## STOP conditions

- A site's markup no longer matches its cited shape (substance, not lines): stop that site and report.
- `inert` would need a change under `ui/src/liner/`: stop step 5's inert half and keep the focus restore.
- Any site is inside Routines or the vendored copy: it is out of scope, so skip it and say so.

## Maintenance note

New tablists and radio groups should use `roving.ts` from the start. The source tests name the current sites, so a
new site without the pattern is a review question, not a test failure. The two activation semantics are deliberate:
tabs are manual, radios and the Models rail are automatic. Sidebar lists keep `listArrows`, where every row is a Tab
stop.
