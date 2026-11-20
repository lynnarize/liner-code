# 018. One keyboard pattern: every tablist and radio group answers to the arrows, menus to Home/End, and the add-on sheet gives focus back

**Commit message:** `Every tab list and choice group moves by the arrows, right-click menus by Home and End too, and the add-on sheet gives the keyboard back`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Findings: UI-11, UI-16, UI-20, UI-04, UI-08. Every excerpt below is from the advisor's own read.

## Why this matters

The app already teaches two keyboard patterns, and then breaks its own lesson elsewhere:
- The dock strip implements WAI-ARIA tabs — arrows, Home, End, roving tabindex (`ui/src/app/Panel.tsx:451-460,505`).
  SEVEN other `role="tablist"`s have none of it.
- StartScan's choice boxes move by arrows (`ui/src/app/security/StartScan.tsx:407-417`), and the scan's questions answer
  to A/B/C/arrows/Enter (`security/Questions.tsx:52-66`). EIGHT other `role="radiogroup"`s have no arrow handling.
- `Pop` menus move by ArrowDown/Up/Home/End (`ui/src/app/ui.tsx:202-208`); the `ContextMenu` opened by right-click
  handles only ArrowDown/Up (`ui.tsx:253-259`) — the same rows, two answers.
- The add-on Details sheet takes focus (Close `autoFocus`) but never gives it back, and Tab walks the page behind it
  (`ui/src/app/AddonsPage.tsx:262-341`). `ContextMenu` already does the restore right (`ui.tsx:227-231`).
- The Session surface's failed check names exist only in a native `title` on a non-focusable div
  (`ui/src/app/SessionInfo.tsx:154-168`) — a keyboard or screen-reader user sees the red dot but cannot learn which.

## The canonical copies (as they stand)

The strip's handler (`Panel.tsx:452-460`) — MANUAL activation (focus only; Enter/Space picks, as the buttons already do):

```tsx
  const onKey = (e: ReactKeyboardEvent) => {
    const chips = [...(row.current?.querySelectorAll<HTMLButtonElement>(".lc-stab-b") ?? [])];
    const k = chips.indexOf(document.activeElement as HTMLButtonElement);
    if (k < 0) return;
    const to = e.key === "ArrowRight" ? (k + 1) % chips.length : e.key === "ArrowLeft" ? (k - 1 + chips.length) % chips.length : e.key === "Home" ? 0 : e.key === "End" ? chips.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    chips[to].focus();
  };
```

StartScan's `arrows` (`StartScan.tsx:407-417`) — AUTOMATIC activation (focus and pick), skipping disabled:

```tsx
function arrows(e: KeyboardEvent<HTMLDivElement>) {
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!step) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".lsc-choice-r:not([aria-disabled])")];
  const at = radios.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  const next = radios[(at + step + radios.length) % radios.length];
  next.focus();
  next.click();
}
```

## Rules (hold for every step)

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- L13's in-flight work touches `design/Tabs.tsx` (the OwnChip span, ~:385) and `Session.tsx` (data-left-wide, ~:557).
  This plan touches OTHER regions of those files (the tablists at Tabs.tsx:196/216, Session.tsx:642). If L13 is
  uncommitted when you start, edit only your regions and commit only your files' hunks — or wait for L13's commit;
  say which in the note. If a cited region's substance changed, STOP that site.
- Each fix comes with a test written first that fails without it: the pure move logic gets node tests; each site's
  wiring gets a SOURCE test (read the file as text; precedent `engine/test/layout-rules.test.ts`). New tests:
  `engine/test/roving.test.ts` (logic) and `engine/test/keyboard-pattern.test.ts` (source).
- Test commands need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push. Sites are independent: a STOP at one leaves the rest doable.

## Steps

### 1. The shared move logic, test first

Create `ui/src/app/roving.ts` — the pure computation both patterns share (no React import needed for the math; the
hook below lives in the same file and imports React, which loads under Node fine — but keep the math exported alone so
the test imports only it):

```ts
/*
  Where the arrows, Home and End move in a list of choices: the dock strip's pattern (Panel.tsx) and StartScan's
  (security/StartScan.tsx) as one computation, so every tablist and radio group answers the same way.
  `vertical`: Up/Down step too (a vertical list, as Design's open designs declare). Returns the new index, or -1.
*/
export const rove = (key: string, at: number, count: number, vertical = false): number => {
  if (count < 1 || at < 0) return -1;
  const fwd = key === "ArrowRight" || (vertical && key === "ArrowDown");
  const back = key === "ArrowLeft" || (vertical && key === "ArrowUp");
  if (fwd) return (at + 1) % count;
  if (back) return (at - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return -1;
};
```

`engine/test/roving.test.ts` first: wraps both ways, Home/End, vertical maps Up/Down, horizontal ignores Up/Down,
unknown key → -1, empty list → -1. Then a small hook in the same file:

```ts
/** The strip's key handling for any list of choices: `sel` finds the items, `pick` optionally activates (radios). */
export function useRoving(sel: string, vertical = false, pick = false) { ... }
```

— implement it as a returned `onKeyDown` handler that queries `e.currentTarget.querySelectorAll(sel)`, finds
`document.activeElement`, calls `rove`, `preventDefault`, focuses, and (when `pick`) clicks; skip when the event's
target is an input/textarea/select or `e.target !== e.currentTarget` for nested-interactive items (the Timeline
question's OTHER box holds a textarea — its letters must stay letters, as its own comment at Timeline.tsx:1592 says).

**Verify:** `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/roving.test.ts` passes.

### 2. The seven tablists (UI-11) — manual activation, roving tabindex

For each site: add `onKeyDown={useRoving("<the item selector>")}` on the `role="tablist"` element, and
`tabIndex={on ? 0 : -1}` on each tab (the strip's :505 shape). Keep each site's existing onClick/Enter behaviour.
The sites (auditor-grepped; re-grep `role="tablist"` to confirm the list is still exactly these plus the strip and the
Design inspector, which already have it):

1. `ui/src/app/security/parts.tsx:112-123` — `CountTabs` (`.ls-sg` buttons). One fix here serves every Findings state list.
2. `ui/src/app/security/FindingPanel.tsx:256-262` — Summary/Code/Activity.
3. `ui/src/app/Session.tsx:642-649` — Chat beside a tab app.
4. `ui/src/app/Terminal.tsx:468-479` — the shells.
5. `ui/src/app/Models.tsx:198-215` — the tool rail. READ FIRST: its Up/Down already go to the model list
   (`Models.tsx:159-172`). Give the rail Left/Right + Home/End roving only; if the rail is vertical and Up/Down is the
   only sensible pair, STOP this site and report the conflict — do not steal the list's keys.
6. `ui/src/app/design/Tabs.tsx:196,216` — the open designs; it declares `aria-orientation="vertical"`, so pass
   `vertical = true` (Up/Down). Every row currently keeps `tabIndex: 0` — make it roving.
7. `ui/src/app/Modes.tsx:117-124` — the guide's two sections.

**Test first** (`keyboard-pattern.test.ts`): one source test per site asserting the tablist element carries
`onKeyDown` and its items carry a conditional `tabIndex` (assert the file contains `useRoving(` and `tabIndex={` in
the site's region). Each fails before its change.
**Verify:** tests, `npm run typecheck`, `npm run build`. On screen (or "not seen"): focus a Findings state tab, press
ArrowRight — focus moves; Tab enters the list once, not per tab.

### 3. The eight radio groups (UI-16) — StartScan's activation

For each site: `onKeyDown` with the shared hook in pick mode (`useRoving("<item selector>", vertical?, true)`), and
roving `tabIndex={on ? 0 : -1}` on the radios. Keep the composer's permission group AS IT IS (number keys with visible
kbd hints, `Composer.tsx:919-944` — a documented exception). Sites:

1. `ui/src/app/Home.tsx:199-205` — "Where it runs" (two buttons).
2. `ui/src/app/Design.tsx:223-230` — "Where the design lives".
3. `ui/src/app/Timeline.tsx:1587-1605` — the question options (divs with `tabIndex={0}`; the OTHER box's textarea must
   keep its letters — the hook's nested-target guard covers it; verify by reading the guard against this markup).
4. `ui/src/app/Settings.tsx:806-821` — theme cards; `:893-901` and `:912-920` — the swatch rows; `:1056` — backgrounds.
5. `ui/src/app/AgentDialog.tsx:183-192` — "Good at".
6. `ui/src/app/Addon.tsx:612-622` — an offer's "Add to".

**Test first:** one source test per file region as step 2. **Verify:** tests, typecheck, build. On screen (or "not
seen"): focus Home's "This checkout", press ArrowRight — "Worktree" takes focus and is picked.

### 4. Right-click menus get Home and End (UI-20)

`ui/src/app/ui.tsx:253-259`: extend the ContextMenu handler to the Pop's shape (:202-208) — add `"Home"`/`"End"` to
the key list and the `to` computation (`Home → 0`, `End → last`). Better: lift the Pop's computation into a tiny
shared helper in the same file and use it in both, so they cannot drift again (the file's own style: small local
helpers). Keep the ContextMenu's `button:not(:disabled)` selector as it is.

**Test first:** source test "the right-click menu answers Home and End as the Pop menu does" — assert the ContextMenu
region contains `Home` and `End`; fails before.
**Verify:** tests, typecheck, build. On screen (or "not seen"): right-click a dock tab, press End — the last row takes focus.

### 5. The add-on sheet gives focus back and keeps the background out of Tab (UI-04)

`ui/src/app/AddonsPage.tsx`, `Details` (:262-341):
- Capture `document.activeElement` when the sheet opens and restore it on close, exactly as `ContextMenu` does
  (`ui.tsx:227-231`): a `useLayoutEffect` keyed on the sheet's presence, returning `back?.focus({ preventScroll: true })`.
  The sheet is mounted/unmounted by its parent (`setOpen(null)`), so the effect's cleanup is the close path.
- While the sheet is open, make the page behind it inert: the sheet's parent renders the page content beside it —
  find the wrapper (the Add-ons page's root) and set `inert` on it while `open` is set (React 19 supports the `inert`
  attribute as a boolean prop). If the sheet is a sibling INSIDE the same wrapper, wrap the page content in its own
  element first (one structural line, comment why). The sheet itself stays interactive; Escape still closes
  (:269-273), and focus now lands back on the row's "Details for {name}" button (:181 region).
- Do not move the sheet to Liner's Dialog — the dialog-system decision is the owner's (recorded backlog).

**Test first:** source test "the add-on sheet restores focus and inert-izes the page behind it" — assert
`AddonsPage.tsx` contains `preventScroll` in the Details region and `inert`; fails before.
**Verify:** tests, typecheck, build. On screen (or "not seen"): keyboard-only — focus a row's Details, Enter, Escape:
focus is back on the button; while open, Tab never leaves the sheet.

### 6. The failed checks' names reach the keyboard (UI-08)

`ui/src/app/SessionInfo.tsx:154-168`, `ChecksLine`: the names live only in `title` (:159), which `Line` renders as a
native title on a plain div (:362-368 region — read it). Move the information into the row's visible text: keep the
count as the row's face, and render the names as a quiet second line under the row when checks failed (the row already
wraps — read `Line`'s markup), OR pass them through `HoverNote` (which opens on keyboard focus, `ui.tsx:410` region)
instead of the native title. Choose the second-line shape if `Line`'s markup makes a HoverNote awkward; say which in
the note. The running case ("N still running") gets the same treatment.

**Test first:** source test "the Session checks say their failed names in text, not only a pointer title" — assert
the ChecksLine region no longer passes the names solely via `title=` (assert the names expression appears in rendered
text or a HoverNote content prop); fails before.
**Verify:** tests, typecheck, build. On screen (or "not seen"): a session with a failed PR check — the names are
readable without a pointer, and VoiceOver speaks them.

## Done

- `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/roving.test.ts engine/test/keyboard-pattern.test.ts`
  passes; every test seen to fail before its change.
- `npm run typecheck` and `npm run build` exit 0.
- One commit, the message above. Executor note: commit, per-site status (any STOP at Models' rail or elsewhere), what
  was not seen on screen.

## STOP conditions

- A site's markup no longer matches its cited shape (substance, not lines): stop that site, report.
- The Models rail conflict (step 2.5): stop that site only.
- `inert` would need a change under `ui/src/liner/`: stop step 5's inert half, keep the focus restore.
- Any site is inside Routines or the vendored copy: it is out of scope — skip and say so.

## Maintenance note

New tablists and radio groups should use `roving.ts` from the start; the source tests name the current sites, so a new
site without the pattern is a review question, not a test failure. The two activation semantics (tabs manual, radios
automatic) are deliberate — keep them when extending the hook.
