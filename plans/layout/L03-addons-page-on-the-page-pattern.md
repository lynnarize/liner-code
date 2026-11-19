# L03. The Add-ons page reads as a page of the app

**Commit message:** `The Add-ons page lines up with Settings, and its note wraps beside its mark`

## Why

The Add-ons page is the outlier on every measure a page has (decision D2 in the README):

| | Add-ons page | Settings (14 sections) |
|---|---|---|
| Column | 860 with 40px gutters (`addons-page.css:23-25`) | 760 with 32px gutters (`app.css:5363-5370`) |
| Title | 26px, 48px from the paper's top | 24px, 32px under the 44px top row |
| Section heading | 16px / 600 (`addons-page.css:187-192`) | 14px / 600 |
| Top row | `position: absolute` over the scroller (`addons-page.css:9-13`) | in the flow |

Two things on it are broken, both seen on screen:

- **The info note.** `AddonsPage.tsx:139` gives a 212-character sentence to Liner's `Tooltip`, which is one `nowrap` line.
  It draws 1,313px wide, cut at both sides of the paper, and the page gains a sideways scrollbar while it shows.
  Baseline: `addons.noteWidth { width: 1313, pageScrollsSideways: true }`.
- **The page scrolls under its own top row**, because that row is laid over the scroller. Rows pass behind the Show-sidebar
  button, and the row is a window-drag region, so what scrolls into the top 44px likely cannot be clicked.

Also: "Remove" is a 10px-cornered rectangle beside the pill "Keep it" (`AddonsPage.tsx:393-398`, `addons-page.css:456-467`).

## Current state (drift check)

```bash
grep -n "^\.lc-ao-page > \.lc-top {" ui/src/app/addons-page.css    # 9
grep -n "padding: 48px 40px 60px;" ui/src/app/addons-page.css      # 25
grep -n "max-width: 860px;" ui/src/app/addons-page.css             # 23
grep -n "font-size: 26px;" ui/src/app/addons-page.css              # 38
grep -n "^\.lc-ao-list h2 {" ui/src/app/addons-page.css            # 187
grep -n "<Tooltip content=\"Connections let your agents" ui/src/app/AddonsPage.tsx   # 139
grep -n "^export function HoverNote" ui/src/app/ui.tsx             # 383
grep -n "^\.lc-ao-remove {" ui/src/app/addons-page.css             # 456
```

`HoverNote` (`ui/src/app/ui.tsx:383`) is the app's own note: a fixed width, wraps, drawn over the window.
Its signature: `HoverNote({ note, children, className, width = 280 })`.

## Steps

### 1. The note wraps

In `AddonsPage.tsx:139`, replace the `<Tooltip content="…">…</Tooltip>` pair with `<HoverNote note="…" width={300}>…</HoverNote>`,
keeping the sentence and the button inside it exactly as they are. Add `HoverNote` to the import from `./ui`; remove
`Tooltip` from this file's imports only if nothing else in the file uses it. Read `HoverNote`'s body first (to line ~418): if
it wraps its children in an element of its own, check the `.lc-ao-info` button still sits on the line of text.

**Verify:** `addons.noteWidth.width` is `300` or less and `pageScrollsSideways` is `false`.

### 2. The top row is in the flow

In `ui/src/app/addons-page.css`, delete the whole rule `.lc-ao-page > .lc-top { position: absolute; inset: 0 0 auto; z-index: 1; }`
(lines 9-13) and its comment if it has one. `.lc-apppage` is already a column (`dock.css:486-492`), so the row takes its
44px above `.lc-ao-scroll`.

**Source test:** no block for `.lc-ao-page > .lc-top` sets `position`.

### 3. The column, the title and the headings match Settings

In `ui/src/app/addons-page.css`:

- `.lc-ao-col`: `max-width: 860px` → `760px`; `padding: 48px 40px 60px` → `32px 32px 96px` (Settings' `.lc-st-col` values,
  `app.css:5363-5370`; the title now sits 32px under the row, as Settings' does).
- `.lc-ao-head h1`: `font-size: 26px` → `24px`.
- `.lc-ao-list h2`: `font-size: 16px` → `14px`; `margin: 0 0 6px` → `0 0 10px`.

Leave the rows' own type and the empty state as they are: those are in "Not planned".

**Source test:** `.lc-ao-col` has `max-width: 760px`; `.lc-ao-head h1` has `font-size: 24px`.

**Verify:** `addons { h1Size: "24px", gutter: "32px", colWidth: 760, topRowPosition: "static" }` and `h1Top` is `76`
(44 + 32).

### 4. "Remove" is a pill like the button beside it

In `.lc-ao-remove` (`addons-page.css:456-467`) delete `height`, `padding` and `border-radius` (the first two already lose to
`.lc-btn[data-size="sm"]`; the third is what makes it a rectangle). Keep its colour declarations.

## Done

- This plan's source tests pass; typecheck and build pass.
- Measured values as in steps 1 and 3.

## STOP conditions

- `HoverNote`'s props are not `note` / `children` / `width`.
- Removing the absolute top row leaves the page's content cut off at the bottom (the scroller no longer fills the paper):
  report, do not add a height by hand.
