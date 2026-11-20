# 020. The last motion holdouts stop under Reduce Motion, every page scroller reads as the thread's, and Changes re-scrolls on a second press

**Commit message:** `Reduce Motion stops the last three spinners, every page scrolls like the thread, and a file pressed again scrolls again in Changes`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Findings: UI-03, UI-12, UI-07. Every excerpt below is from the advisor's own read.

## Why this matters

1. **UI-03.** The repo's contract says "The system's Reduce motion stops both" (`ui/src/app/look.ts:21-22`), and the
   sheets' reduce blocks stop every sibling spinner — except three: the add-on frame's waiting wash
   (`dock.css:205-207`, `animation: lc-frame-wait 1.4s ease-in-out infinite`), the Browser address bar's load spinner
   (`surfaces.css:963-970`, `.lc-br-lspin`, `l-spin 900ms linear infinite`), and the Add-ons page's Look-again spinner
   (`addons-page.css:71-72`, `.lc-ao-ghost[data-busy] svg`, `lc-ao-spin 700ms linear infinite`). `dock.css` has NO
   reduce block at all; the other two sheets' blocks never name these selectors.
2. **UI-12.** The thread's scroller is quiet: `scrollbar-width: thin; scrollbar-color: transparent transparent`, the
   thumb only on hover (`app.css:1926-1943`, `.lc-scroll`). Six page scrollers take the OS default and chain their
   overscroll to the window: `.ls-scroll` (every Security page, `security/security.css:35-39`), `.lc-st-scroll`
   (Settings, `app.css:5268-5272`), `.lc-ao-scroll` (Add-ons, `addons-page.css:9-13`), `.lc-usage-in` (Usage,
   `app.css:4672-4679`), `.lc-home-in` (Home, `app.css:4302-4313`), `.lf-x-body` (the finding panel's body,
   `security/findings.css:260-269` — it keeps its foot mask). The Wall grid has `overscroll-behavior: contain` but not
   the thin width (`wall.css:46-50`). With the OS set to always show scrollbars, the faces don't read as one app.
3. **UI-07.** In the full Review, pressing a file again after scrolling away scrolls again — the effect depends on the
   `focus` OBJECT, new on every press (`Review.tsx:237-242`, deps `[diff, focus]`, comment says exactly that). The
   docked Changes' same effect depends on `focus?.path` — a STRING that does not change on a re-press
   (`Panel.tsx:682-688`, deps `[diff, focus?.path]`), so the gesture does nothing there.

## The canonical copies (as they stand)

The thread's scroller (`app.css:1926-1943`):

```css
.lc-scroll {
  flex: 1;
  min-height: 0;
  overflow: hidden auto;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
/* No track down the thread's edge, between it and the panel: the thumb shows only while the
   pointer is over what scrolls. */
@media (hover: hover) {
  .lc-scroll:hover {
    scrollbar-color: var(--l-line-2) transparent;
  }
}
@media (hover: none) {
  .lc-scroll {
    scrollbar-color: var(--l-line-2) transparent;
  }
}
```

A reduce block (`timeline.css:199-209`):

```css
@media (prefers-reduced-motion: reduce) {
  .lc-pmap,
  .lc-pmap-tip,
  .lc-you-thumb img,
  .lc-you-thumb-wait {
    animation: none;
  }
  .lc-pmap-tick::before {
    transition: none;
  }
}
```

## Rules (hold for every step)

- Never run a formatter. CSS changes go IN PLACE, in the rule they correct — no override block appended at the end of
  a file, no `!important`. When a rule changes, fix the comment above it in the same edit if it describes the old look.
- Do not touch `ui/src/liner/**`, Routines' rules (`.lc-rt*`, `.lc-rb*`, `.lc-run*`), `mac/`, the Demo provider,
  `CHANGELOG.md`, the untracked folders.
- **L13 ordering:** L13's in-flight work touches `app.css` (panel regions ~7690+), `findings.css` (:538-552),
  `surfaces.css` (:5971), `addons-page.css` (:452-460), `timeline.css` (:109), and `engine/test/layout-rules.test.ts`.
  This plan's regions are all DIFFERENT rules in those same sheets. Prefer to run this plan AFTER L13's commit; if L13
  is still uncommitted, edit only the rules named here and do not touch `layout-rules.test.ts` — this plan's tests go
  in a NEW file, `engine/test/css-details.test.ts`, with the same helper shape L13's README documents (copy the helper
  from `engine/test/layout-rules.test.ts`'s head; do not modify that file).
- Tests first: source tests in `engine/test/css-details.test.ts` (the stylesheet-as-text pattern). Test commands need
  `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push.

## Steps

### 1. Three spinners stop under Reduce Motion (UI-03)

- `dock.css`: add a reduce block beside the waiting rule (in place, after the `.lc-addon-frame[data-wait]` rule's
  neighbourhood, with a comment saying why):

```css
/* The system's Reduce Motion stops the waiting wash too; the frame keeps its static ground. */
@media (prefers-reduced-motion: reduce) {
  .lc-addon-frame[data-wait] {
    animation: none;
  }
}
```

- `surfaces.css`: add `.lc-br-lspin` to the sheet's EXISTING reduce block's `animation: none` selector list (find it
  by `prefers-reduced-motion`; the auditor confirmed it exists and does not name this selector).
- `addons-page.css`: add `.lc-ao-ghost[data-busy] svg` to that sheet's existing reduce block the same way.
- The spinners keep their static look (the border ring, the ghost icon) — only the animation stops.

**Test first** (`css-details.test.ts`): one test per sheet — "dock.css stops the add-on frame's wash under Reduce
Motion" (a reduce block names `.lc-addon-frame[data-wait]` with `animation: none`), and the two selector-list tests.
Each fails before its change.
**Verify:** `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/css-details.test.ts` passes;
`npm run build` exits 0 (no CSS warnings). On screen (or "not seen"): OS Reduce Motion on → an add-on tab loading, a
Browser page loading, Add-ons' Look again — none moves.

### 2. Six page scrollers read as the thread's (UI-12)

For each of `.ls-scroll`, `.lc-st-scroll`, `.lc-ao-scroll`, `.lc-usage-in`, `.lc-home-in`, `.lf-x-body`: add to the
EXISTING rule, in place:

```css
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  overscroll-behavior: contain;
```

and give each the hover-thumb treatment the thread has: in each sheet, one `@media (hover: hover)` rule naming that
scroller with `scrollbar-color: var(--l-line-2) transparent`, and the `@media (hover: none)` fallback (copy the
`.lc-scroll` shape above; where a sheet already has hover blocks, join them in the sheet's own style). `.lf-x-body`
keeps its mask and padding untouched. The Wall grid (`wall.css:46-50`) gets only `scrollbar-width: thin;
scrollbar-color: transparent transparent` + the hover pair — it already contains overscroll.

Do not change overflow, flex or padding values; do not restyle the thread's own scroller.

**Test first:** one source test per scroller (the block holds the three declarations; the sheet has its hover pair).
Each fails before.
**Verify:** tests pass; `npm run build` exits 0. On screen (or "not seen"): macOS System Settings → Appearance →
"Show scroll bars: Always" → Settings beside a session: both scrollers thin, thumbs on hover; scroll past a page's
end — it does not chain to the window.

### 3. Changes re-scrolls to a file pressed again (UI-07)

`ui/src/app/Panel.tsx:682-688`: change the effect's deps from `[diff, focus?.path]` to `[diff, focus]`, exactly as
Review's (`Review.tsx:242`). Keep the guard inside (`if (!diff || !focus?.path) return;`) and the viewed-mark write
(it is idempotent — a Set add). Extend the comment with one sentence: pressed again after scrolling away, it does
again, as in the Review. Each press makes a new `focus` object upstream (`Session.tsx`'s `onFocus({ id, path })`), so
the object dep re-runs the effect; verify that by reading the press path before changing (if `focus` is ever the SAME
object on a re-press, STOP and report — the fix would do nothing).

**Test first:** source test "the docked Changes scrolls on a second press of the same file, as the Review does" —
assert the Changes scroll effect's deps line in `Panel.tsx` reads `[diff, focus]` (match the effect by its
`scrollIntoView` body). Fails before.
**Verify:** tests, `npm run typecheck`, `npm run build`. On screen (or "not seen"): docked Changes open, press file A
in the thread, scroll the diff away, press A again — it scrolls back.

## Done

- `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/css-details.test.ts` passes; every test
  seen to fail before its change. `engine/test/layout-rules.test.ts` still passes untouched.
- `npm run typecheck` and `npm run build` exit 0.
- One commit, the message above. Executor note: commit, L13's state when you ran (before/after its commit), what was
  not seen on screen, any STOP.

## STOP conditions

- A named rule's substance changed (not just its line): stop that step, report.
- Step 3: `focus` is the same object on a re-press (read the press path): stop, report.
- Any change would land in `ui/src/liner/`, Routines' rules, or L13's own regions.

## Maintenance note

The scroller treatment now lives in seven places (the thread + six pages + Wall). A shared `.lc-scroll`-style class
would fold them, but that is a markup refactor across faces — recorded as a design decision, not done here. New page
scrollers should copy the three declarations; the source tests name the current ones.
