# L10. A dozen small spacing faults

**Commit message:** `Rows that touched stand apart, a doubled gap is single, and notices sit under the top row as it is now`

## Why

Each is 1 to 18px and each has one plain answer. "Seen" says whether it was looked at on screen or worked from the CSS.

## Steps

Do them in order; each is one or two declarations. Run the drift `grep` for a step before its edit. If a line is not as
quoted, skip that step and note it.

### 1. A session's forks touch the rows round them (CSS)

`app.css:8393-8395` keeps lit rows 2px apart with `:is(.lc-sl-row, .lc-sl-fold) + .lc-sl-row { margin-top: 2px; }`, and its
comment says why: "so two plates never run into one". A fork list is a `div.lc-sb-kids` between rows
(`Sidebar.tsx:673-676`), so the first fork (a first child) and the row after the list (it follows a `div`) match nothing:
0px there, 2px everywhere else.

Extend that selector list, in place:

```css
:is(.lc-sl-row, .lc-sl-fold) + .lc-sl-row,
.lc-sb-kids > .lc-sl-row:first-child,
.lc-sb-kids + .lc-sl-row {
  margin-top: 2px;
}
```

Check first that a fork's row has the class `lc-sl-row` (`grep -n "lc-sl-row" ui/src/app/SideList.tsx ui/src/app/Sidebar.tsx`).

### 2. Usage: the Limits card has twice the gap under it (CSS)

`.lc-usage-in` is a grid with `gap: 14px` (`app.css:4754-4757`) and its child `.lc-limits` adds `margin-bottom: 14px`
(`surfaces.css:3308-3310`): 28px under Limits, 14 between everything else. Delete the `.lc-limits { margin-bottom: 14px; }`
rule. First `grep -rn "lc-limits\"" ui/src/app --include=*.tsx`: if `.lc-limits` is also rendered somewhere that is not a
grid with a gap, scope the deletion by keeping the rule as `:not(.lc-usage-in) > .lc-limits` instead.

### 3. Notices hang at the old header's height (CSS; the 64 was seen)

`app.css:7060` `.l-toaster.lc-toaster { top: 64px; … }` and `app.css:6973` `.lc-broke[data-place="float"] { top: 64px; }`
are 6 + 52 + 6 from when the top row was 52px. It has been 44 since 10 November (`app.css:20-23`). In both, replace
`top: 64px;` with `top: calc(6px + var(--lc-head) + 6px);`.

### 4. Liner Design's sidebar rows are 1px apart (CSS)

The shared sidebar keeps 2px between rows that light up (step 1's rule, 19 November). Liner Design's three lists use 1px:
`design/design-face.css:12` (`.ld-side`), `:165` (`.ld-layers`), `:214` (`.ld-files`). Change each `gap: 1px;` to `gap: 2px;`.

### 5. A finding's last line ends under the fade (CSS)

`security/findings.css:263-267`: the body fades over its last 36px (`mask-image: linear-gradient(#000 calc(100% - 36px), transparent)`)
but its bottom padding is 32px, so scrolled to the end the last 4px of text is under the fade.
`padding: 4px 22px 32px;` → `padding: 4px 22px 40px;`.

### 6. Liner Design's open chat: its last button sits on the edge (CSS)

`design/chat.css:172-174` `.ldc-open > .ldc-h { padding: 0 0 0 10px; }` gives the header no right padding; the small row
keeps 4 (`chat.css:61`). → `padding: 0 4px 0 10px;`.

### 7. Settings › Add-ons: 46px under the "add-ons are off" banner (CSS)

`settings.css:460-461` `.lc-st-banner { margin: 0 0 18px; … }` is a child of a grid with `gap: 28px`
(`.lc-st-col`, `app.css:5363-5367`), where margins add to the gap. → `margin: 0;`.

### 8. The composer's stacked rows stand on two left edges (CSS)

The tray puts the composer's card 4px in (`app.css:2899`, 10 November); the queued messages and the cache line above it
were set 2px in before that: `app.css:3610` `.lc-queued { padding: 6px 2px 6px; }` → `6px 4px 6px`, and `app.css:7025`
`.lc-cold { margin: 0 2px 6px; }` → `0 4px 6px`.

### 9. Browser's start page: its page rows are 300 wide in a 360 column (CSS)

`surfaces.css:5858-5860` `.lc-br-ports { max-width: 300px; }`, while inside the launch page everything else is the
column's 360 (`surfaces.css:856-861`). Add `.lc-br-start-in .lc-br-ports` to the selector of the rule at line 859
(`.lc-br-start-in .lc-br-first { max-width: none; … }`) **only** for `max-width`: if that rule also sets `margin-top`,
write a separate one-declaration rule directly under it instead.

### 10. Setup: the install list is cut mid-row with nothing to say it scrolls (seen at 880×580)

`setup.css:291-302`: `.lc-wel-fscroll { max-height: 44vh; … }` scrolls when open, and at a 580px-high window the fourth row
of install buttons is cut in half with no scrollbar showing and no fade. In the `.lc-wel-fold[data-open] > div > .lc-wel-fscroll`
rule (line 300) add:

```css
  padding-bottom: 12px;
  -webkit-mask-image: linear-gradient(#000 calc(100% - 12px), transparent);
  mask-image: linear-gradient(#000 calc(100% - 12px), transparent);
```

(The 12px of padding is what the fade covers when everything fits, so no row is dimmed.)

## Source tests

One test per step that changes a value, each asserting the new declaration (for example: the toaster's block has
`top: calc(6px + var(--lc-head) + 6px)`; `.ld-layers` has `gap: 2px`).

## Done

- Source tests pass; typecheck and build pass.
- Measured where there is a key: `setup.hasFade = true` on a fresh home (the key only prints on the first run).

## STOP conditions

None for the plan as a whole: a step whose drift check fails is skipped and noted, and the rest go on.
