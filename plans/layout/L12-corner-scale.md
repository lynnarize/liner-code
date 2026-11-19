# L12. Corners follow one scale

**Commit message:** `Corners come in four sizes: 8 for a row, 10 for a field, 14 for a card or a menu, 18 for the paper`

**Read decision D3 in the README first.** This is the one plan that changes how healthy screens look (Settings' and
Usage's cards go from 18 to 14). The owner confirmed it on 2026-11-19: run it. Nothing else depends on it, so if it hits a
STOP condition the other eleven plans stand.

## Why

`app.css:753` says "One menu corner in the app: 14, its rows 8", and the paper is 18 (14 on a Mac, `app.css:204`, `215`).
Counted over the app's own stylesheets (pills, circles and marks of 6px or less left out), about a third of boxed corners
are on that scale. The rest: 9px ×40+, 10px ×45+, 12px ×45+, 16px ×12, and 7, 11, 13, 15, 22, 24, 26 a few times each.

What you see: cards at five radii (22, 18, 16, 14, 12), sometimes side by side (Usage's chart card is 16 beside 18px
siblings, `app.css:130-134` against `5345-5349`); on a Mac, Settings' 18px cards are rounder than the 14px paper they sit
on; a 9px row beside an 8px row in the same list (`surfaces.css:2305` against `1217`).

## The scale

| Size | For | Today's values that move to it |
|---|---|---|
| **8** | a row that lights up, a small button, a tab, a chip | 7, 9 |
| **10** | a field, a select, a segmented track, the sidebar's rows (Liner's `--l-r-sm` is 10; the 0.2.7 sidebar uses it on purpose) | 11; and 12 where the rule is a control (it sets a `height` or `min-height` of 40px or less, or is an `input`, `select`, `textarea`) |
| **14** | a card, a tile, a well, a banner, a menu, the panel card | 13, 15, 16; 12 where the rule is a box that holds other things; 18 and 22 on cards **inside** the paper |
| **18** | the paper itself; a sheet or dialog that floats over the window | 24, 26 |

Do not touch: `999px`, `50%`, `inherit`, `0`, anything 6px or less, two- and four-value radii, `var(--lc-paper-r)`,
and `ui/src/liner/`.

## Steps

### 1. The tokens

At the top of `app.css`, in the first `:root` block (line 11) after `--lc-ring`, add:

```css
  /* Corners, four sizes: a row or small button, a field, a card or menu, and the paper or a floating sheet. */
  --lc-r-row: 8px;
  --lc-r-field: 10px;
  --lc-r-card: 14px;
  --lc-r-sheet: 18px;
```

Existing literals that are already on the scale stay as literals in this plan. New and changed ones use the token.

### 2. The moves, file by file

For each file, list its off-scale radii with
`grep -n "border-radius: \(7\|9\|11\|12\|13\|15\|16\|18\|22\|24\|26\)px" FILE`, then change each line by the table above,
reading its block to tell a control from a box. Files, in this order, building after each:

`app.css`, `surfaces.css`, `dock.css`, `design.css`, `settings.css`, `models.css`, `modes.css`, `agentic.css`, `crew.css`,
`wall.css`, `addons-page.css`, `setup.css`, `timeline.css`, `updates.css`, `precheck.css`, `face.css`, then
`design/*.css`, then `security/*.css`.

Named cases, so there is no doubt about them:

- `app.css:131` `.l-frame-card { border-radius: 16px }` → `var(--lc-r-card)` (this is the app's override, not Liner's file).
- `app.css:2424` `.lc-fcard` 16 → `var(--lc-r-card)`; and delete the override at `app.css:5345-5349`
  (`.lc-st-col .lc-fcard, .lc-usage-in .lc-fcard { border-radius: 18px }`), so Settings' and Usage's cards take the same 14.
- `app.css:5625-5635` `.lc-st-empty` 22 → `var(--lc-r-card)`.
- `app.css:4958` `.lc-sheet-frame` 24 → `var(--lc-r-sheet)`.
- `surfaces.css:4561` `.lc-sc-compose` 26 → `var(--lc-r-card)`.
- `app.css:5748` (the Appearance preview) and `addons-page.css:321` (the details drawer) are written `18px` for a box
  inside the paper → `var(--lc-r-card)`.
- Security's cards (`security/security.css:265-271` `.ls-card`, `348-356` `.ls-bx`) and Design's tiles
  (`design/lean-page.css:93-102`) 12 → `var(--lc-r-card)`. The Wall's tiles (`wall.css:92-93`) 12 → `var(--lc-r-card)`.
- A box that sits inside the panel card with its own 14px corner 10px in (`.lc-term-box` `surfaces.css:557`,
  `.lc-br-stage` `:627`, `.lc-br-console` `:700`, `.lc-dev-stage` `:1414`): leave at 14. They are in "Not planned".

Skip, and leave exactly as they are:

- every rule whose selector starts `.lc-rt`, `.lc-rb`, `.lc-run`, or is one of `.lc-pr-head`, `.lc-pr-title`,
  `.lc-pr-checks`, `.lc-pr-dot`, `.lc-pr-status`, `.lc-pr-spin` (Routines);
- `design/intro.css` lines 150 to 815 (the intro's drawn pictures: they are illustrations, not interface);
- any radius on an element that draws a picture of something (a phone frame, a preview of a theme).

### 3. Concentric corners

Where a rounded box sits inside another with padding `p`, the inner corner should be the outer minus `p`. After step 2
check the three the comments name: a menu (14) with 6px padding and 8px rows; the composer's tray and its card
(`app.css:2899`, `2970`); the panel card (14) and the Files rows (8). If one is off by a pixel or two because of this plan,
say so in Executor notes; do not invent a fifth size.

## Source test

- `app.css` declares the four tokens.
- No stylesheet under `ui/src/app`, outside the skipped ranges, contains `border-radius: 9px`, `7px`, `11px`, `13px` or
  `15px`. (Write the test so it reads each file, drops the skipped selectors' blocks and `intro.css` 150-815, and searches
  the rest.)

## Done

- Source tests pass; typecheck and build pass.
- `measure.mjs`: `menu.radius` is still `14px`; nothing else in its output changed.
- You looked at, or say you could not look at: Settings › General, Usage, a session with the panel open, a menu, the Wall,
  Security's Overview, a design's lean page.

## STOP conditions

- A change makes a control look like a pill (its radius is half its height or more): put that one back and note it.
- You are unsure whether a 12px or 16px rule is a control or a box in more than ten cases: stop, commit nothing for this
  plan, and list them in Executor notes for the owner.
