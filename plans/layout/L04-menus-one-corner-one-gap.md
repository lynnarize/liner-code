# L04. Menus have one corner and one gap

**Commit message:** `Every menu has the same 14px corner, and its rows stand 2px apart`

## Why

`ui/src/app/app.css:753-754` says, on `.lc-pop-panel`:

```css
  /* One menu corner in the app: 14, its rows 8 (6 in, so they sit concentric). */
  border-radius: 14px;
```

Every menu in the app draws **16px** instead (measured: `menu.radius = "16px"`). The panel's element is
`className="l-pop lc-pop-panel lc-layer"` (`ui/src/app/ui.tsx:186` and `247`), and Liner's `.l-pop { border-radius: 16px }`
(`ui/src/liner/lib/overlay.css:7-12`) has the same weight and loads later (`ui/src/main.tsx:8-10` imports `app.css` before
`App`, so every vendored component sheet lands after it). The one menu that escapes is the sidebar heading's, at 13px
(`app.css:8193-8197`). So no menu is 14, and the 8px rows are not concentric (16 − 6 = 10).

The fix is on the app's side, with a selector that outweighs `.l-pop`, as `app.css:758` (`.l-pop.lc-layer`) already does for
position. `ui/src/liner` is not touched.

Second: on 19 November (`6970155`, "rows that never touch") the gap between a menu's rows went from 1px to 2px
(`app.css:746`). That reaches only the panel's direct children, so every menu whose rows sit in a wrapper kept its own gap:

| Gap | Rule |
|---|---|
| 0 | `.lc-crp` (`crew.css:85-89`), `.lc-ao-ways` (`addons-page.css:134-137`) |
| 1px | `.lc-envp` (`app.css:852-855`), `.lc-env-in` (`:900`), `.lc-team` (`:3649`), `.lc-who-scroll` (`:3775`), `.lc-rvm` (`:7178`), `.lc-qp` and `.lc-qp-list` (`:7854`, `:7869`), `.lc-sl-acts` (`:8545`), `.lc-pc-list` (`models.css:392-395`), `.lc-cr-files` (`crew.css:844-846`) |

## Current state (drift check)

```bash
sed -n 753,754p ui/src/app/app.css                      # the comment and "border-radius: 14px;"
grep -n "^\.l-pop {" ui/src/liner/lib/overlay.css        # must exist: do not edit it
grep -n "^\.l-pop\.lc-layer" ui/src/app/app.css          # 758
grep -n "^\.lc-pop-panel:has(> \.lc-sl-menu)" ui/src/app/app.css   # 8193
```

## Steps

### 1. The corner

In `app.css`, change the selector of the rule that holds `border-radius: 14px` at line 754 from `.lc-pop-panel` to
`.l-pop.lc-pop-panel`. Read lines 738-760 first: if `.lc-pop-panel` is the whole selector of one block, change that block's
selector; if it is one of a list, split out only what you need. Add one sentence to the comment: Liner's own sheet loads
after this one, so the selector carries Liner's class to outweigh it.

In the sidebar heading menu's rule (`app.css:8193-8197`), change `border-radius: 13px` to `14px` and, if its selector would
now lose to the new one, give it the same `.l-pop` prefix. Keep its `padding: 5px` and its `gap: 0`: that menu's rows are
30px with no plate on the picked one, by its own drawing.

**Source test:** a block with selector `.l-pop.lc-pop-panel` has `border-radius: 14px`; no block in `app.css` whose selector
contains `lc-pop-panel` has `border-radius: 13px`.

**Verify:** `menu.radius = "14px"`.

### 2. The gap

For each rule in the table, set its `gap` (or `row-gap`) to `2px`. Read each block first: change only a gap that is between
**rows** (elements with a hover wash). If the block lays out something else (a form, a header), leave it and note it.
`.lc-sl-acts` (`app.css:8545`): read it; if it is the row's action icons side by side and not a list of rows, leave it.

**Verify:** `npm run build`. Open three of the menus if you can (the composer's model menu, the Crew menu in a session's
header, "Add add-on ▾" on the Add-ons page) and check no menu grew a scrollbar.

## Done

- Source tests pass; typecheck and build pass; `menu.radius = "14px"`.

## STOP conditions

- `.l-pop.lc-pop-panel` does not win: `menu.radius` is still 16px after step 1. Report the computed style; do not use
  `!important`.
