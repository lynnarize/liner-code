# L05. Every surface in the panel card starts at the same distance from its edge

**Commit message:** `Every panel beside the thread starts 8px inside its card, on whole pixels, with Commit on the composer's row`

## Why

On 14 November (`0c55f8c`) the panel beside the thread became a floating card with no top row (`app.css:7770-7809`;
decision D1 in the README). The surfaces inside were written to sit **under** a 44px row, so their first row has 0 to 4px
above it. Now that row is gone and they touch the card's edge:

| Surface | First row | Space above it, in the card | Rule |
|---|---|---|---|
| Browser (a page open) | the address bar, 30px | **0** | `surfaces.css:576-582` `.lc-br-bar { padding: 0 10px 6px }` |
| Linked pull requests | its bar | **0** | `surfaces.css:1743-1749` `.lc-linked-top { padding: 0 10px 8px 12px }` |
| Device | its bar | **0** | `surfaces.css:1386-1392` `.lc-dev-bar { padding: 0 10px 8px 12px }` |
| Terminal tab, two shells or more | the shell chips, 24px | **0** | `surfaces.css:3474-3482` `.lc-terms-tabs { padding: 0 10px 4px }` |
| Files | the find field, 30px | **2** (measured: `panel.Files.firstBoxTop = 2`), against 12 at its sides | `surfaces.css:1151-1158` `.lc-files-find { margin: 2px 12px 6px }` |
| An add-on's preview | its banner | **2** | `dock.css:212-218` `.lc-addon-banner { margin: 2px 10px 10px }` |
| Session, Changes, Agents | text | 10 to 12.5 (measured) | fine |

Three more faults of the same card, all measured:

- **Its edge is not on a whole pixel.** The column is 36% of the body: 404.625px at a 1440 window, so the card sits at
  x = 991.4 with a width of 396.6 and its 1px ring is drawn across two pixels on a 1x screen.
  (`app.css:1831-1834`, `dock.css:143-145`.)
- **Commit is 8px above the composer's controls.** `.lc-panel-foot { height: 70px }` (`app.css:4632-4642`) was sized so its
  buttons' centre is 35px above the paper's bottom, "on the composer's control row" as its comment says. The card's 8px
  bottom margin lifted it to 43. Baseline: `panel.Changes.footVsSend = -8`.
- **Agents starts 14px in, every other text-led surface 16.** `crew.css:394-397`. Baseline: `panel.Agents.textLeft = 14`.

## Current state (drift check)

```bash
grep -n "margin: 8px 0 8px 8px;" ui/src/app/app.css                 # 7784, in the card's rule
grep -n "padding: 0 10px 6px;" ui/src/app/surfaces.css              # 581, .lc-br-bar
grep -n "padding: 0 10px 8px 12px;" ui/src/app/surfaces.css         # 1391 and 1748
grep -n "padding: 0 10px 4px;" ui/src/app/surfaces.css              # 3480, .lc-terms-tabs
grep -n "margin: 2px 12px 6px;" ui/src/app/surfaces.css             # 1157, .lc-files-find
grep -n "margin: 2px 10px 10px;" ui/src/app/dock.css                # 217, .lc-addon-banner
grep -n "height: 70px;" ui/src/app/app.css                          # 4639, .lc-panel-foot
grep -n "padding: 2px 14px 16px;" ui/src/app/crew.css               # 396
grep -n "clamp(340px, 36%, 520px)" ui/src/app/app.css ui/src/app/dock.css   # app.css:1832 and dock.css:144
```

## Steps

### 1. The card says how far its first row stands from its top

In the card's rule (`app.css:7780-7789`, selector `.lc-session:not([data-wide]) .lc-body > .lc-panel:not([data-leaving])`),
add one declaration:

```css
  /* What a surface's first row keeps above it here, where no top row stands over it (over the whole paper it is 0). */
  --lc-card-top: 8px;
```

and replace `margin: 8px 0 8px 8px;` with `margin: var(--lc-card-top) 0 var(--lc-card-top) var(--lc-card-top);` so the
number is written once.

### 2. Each first row uses it, in its own rule

Change these declarations **in place** (no new blocks):

| File:line | From | To |
|---|---|---|
| `surfaces.css:581` `.lc-br-bar` | `padding: 0 10px 6px;` | `padding: var(--lc-card-top, 0px) 10px 6px;` |
| `surfaces.css:1748` `.lc-linked-top` | `padding: 0 10px 8px 12px;` | `padding: var(--lc-card-top, 0px) 10px 8px 12px;` |
| `surfaces.css:1391` `.lc-dev-bar` | `padding: 0 10px 8px 12px;` | `padding: var(--lc-card-top, 0px) 10px 8px 12px;` |
| `surfaces.css:3480` `.lc-terms-tabs` | `padding: 0 10px 4px;` | `padding: var(--lc-card-top, 0px) 10px 4px;` |
| `surfaces.css:1157` `.lc-files-find` | `margin: 2px 12px 6px;` | `margin: var(--lc-card-top, 2px) 12px 6px;` |
| `dock.css:217` `.lc-addon-banner` | `margin: 2px 10px 10px;` | `margin: var(--lc-card-top, 2px) 10px 10px;` |

Over the whole paper, and in the bottom panel, the property is not set, so each keeps the value it has today.

`.lc-terms-tabs` is also used by the bottom panel's Terminal: check with
`grep -rn "lc-terms-tabs" ui/src/app --include=*.tsx` that the bottom panel is not inside `.lc-panel`. If it is, stop.

**Source test:** each of the six blocks contains `var(--lc-card-top`; the card's block declares `--lc-card-top: 8px`.

**Verify:** `panel.Files.firstBoxTop = 8`. With a Demo page open in Browser (not required) the address bar is 8px down.

### 3. The column is a whole number of pixels

- `app.css:1832`: `clamp(340px, 36%, 520px)` → `clamp(340px, round(down, 36%, 1px), 520px)`.
- `dock.css:144`: `calc(var(--lc-panel-w, clamp(340px, 36%, 520px)) * 1.6)` →
  `round(down, calc(var(--lc-panel-w, clamp(340px, 36%, 520px)) * 1.6), 1px)`.

`round()` is already used in this app (`ui/src/app/design.css:409`), so the shell's browser has it. Leave the `36cqw`
copies in the `width` rules (`app.css:1840`, `7675`, `dock.css:147`) alone: L06 and L11 deal with those.

**Source test:** the `.lc-session[data-panel] .lc-body` block's `grid-template-columns` contains `round(down, 36%, 1px)`.

**Verify:** `panel.*.cardX` and `cardW` are whole numbers (at 1440: 992 and 396).

### 4. Commit sits on the composer's row again

`app.css:4639`, in `.lc-panel-foot`: `height: 70px;` → `height: calc(70px - 2 * var(--lc-card-top, 0px));` (54 in the card:
8 + 27 = 35 up, the composer's row; still 70 over the whole paper). Extend the comment above it with one sentence saying
the card stands 8px off the paper's bottom, so the bar is that much shorter there.

**Verify:** `panel.Changes.footVsSend` is between `-1` and `1`.

### 5. Agents starts where the others do

`crew.css:396`: `padding: 2px 14px 16px;` → `padding: 2px 16px 16px;`.

**Verify:** `panel.Agents.textLeft = 16`.

### 6. "N more files aren't shown here" starts with the rest of Changes

`surfaces.css:5838-5842` `.lc-rv-more { padding: 6px 8px }` was sized for Review's file list, which has 10px of its own.
Docked, the line sits directly in `.lc-changes-panel` (`Surfaces.tsx:359`, `Panel.tsx:728`) 8px in, where the rest starts
at 16. Directly under that rule add:

```css
/* Beside the thread the line stands in Changes itself, whose text starts 16px in. */
.lc-changes-panel > .lc-rv-more {
  padding-inline: 16px;
}
```

First check `grep -n "lc-rv-more" ui/src/app/*.tsx` shows it is a direct child of the element with `lc-changes-panel`; if
not, skip this step and note it. (Reasoned from the CSS: it needs more changed files than the sample has.)

## Done

- Source tests pass; typecheck and build pass.
- Measured: `Files.firstBoxTop 8`, whole-number `cardX`/`cardW`, `Changes.footVsSend` within ±1, `Agents.textLeft 16`.
- Over the whole paper (the panel's expand button) every surface looks as before.

## STOP conditions

- The card's rule at `app.css:7780` no longer has the selector quoted above.
- `round()` in `grid-template-columns` makes the panel's column 0 or the build warns about it: revert step 3 only and report.
