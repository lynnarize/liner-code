# L06. The panel is right in a narrow session, with two panes, and while it closes

**Commit message:** `The panel keeps its card while it closes and with two panes, and takes the paper before it gets too thin`

**Risk: high.** This plan changes how the panel is sized in states that are hard to reach in a test (two panes, a drag, a
window between two widths). Do the steps one at a time, measure after each, and stop at the first surprise. Run L05 first.

## Why

The card of 14 November (`app.css:7780-7809`) was added on top of two older generations of rules, and three states still
fall through to them.

1. **A narrow session shows the panel as a card inside the paper with an almost empty row on top.** Under 700px of session
   the panel takes the paper and its top row comes back as "the paper's header" (the sheet's own words,
   `app.css:7835-7844`), but the card's rule has no width condition: the header starts 8px down and 8px in, inside a ring
   with a 14px corner. Seen at 880×580; baseline `panelNarrow { margin: "8px 0px 8px 8px", radius: "14px", rowShown: true }`.
2. **Just above that breakpoint the card can be 227px wide.** The session's width has included the 46px rail since
   14 November (`app.css:7581-7596`) and the 700px breakpoint was not moved. At a 701px session the body is 655, the thread
   keeps 420, so the panel's column is 235 and the card 227. The panel's own minimum is 320 (`Surfaces.tsx:79`, `PANE_MIN`),
   reached only at 786. With the sidebar shown that is every window from about 971 to 1055px wide. (Arithmetic; not seen.)
3. **While it closes, the panel stops being a card.** The card's rules are scoped `:not([data-leaving])`. For the 220ms fade
   the panel loses its margin, corner, ring and ground, and takes the older fixed width (`app.css:7674-7676`): its content
   jumps 8px up and left and squares off. (Reasoned from the cascade; a 220ms state was not captured.)
4. **With two panes the card overruns its column.** `dock.css:146-148` sets a `width` with the same weight as the card's
   `width: auto` and loads later, so it wins; the card's 8px left margin is added on top. The formula also still uses the
   width before the rail (`100cqw - 420px`, where the one-pane rule was corrected to `100cqw - 466px`). The card runs 8 to
   54px past its column, under the rail's icons. (Reasoned from the cascade; not seen.)
5. **Two panes in a session between 701 and 860px have no header at all.** `dock.css:150-161` hands the paper to the panel
   at 860px, but the three rules that bring a header back are all at 700 (`app.css:7840-7844`, `dock.css:70-74`,
   `app.css:364-370`). (Reasoned.)

The decision (D1, README): beside the thread the panel is the card; where it takes the whole paper it is flat with its row.

## Current state (drift check)

```bash
grep -n "max-width: 700px" ui/src/app/app.css ui/src/app/dock.css     # app.css:364, 1893, 7840 and dock.css:70
grep -n "max-width: 860px" ui/src/app/dock.css                        # 150
grep -n ":not(\[data-leaving\])" ui/src/app/app.css                   # the card's four rules, 7780-7803
sed -n 146,148p ui/src/app/dock.css                                   # the two-pane width
sed -n 7674,7676p ui/src/app/app.css                                  # the one-pane width, with the rail taken off
grep -n "PANE_MIN\|THREAD_MIN" ui/src/app/Surfaces.tsx                # 320 and 420
```

Read `app.css:1815-1905` and `app.css:7770-7845` to the end before you change anything.

## Steps

### 1. One number for "too narrow for both"

The thread keeps 420, a pane 320, the rail 46: **786**. For two panes the old rule allowed 160 more: **946**.
Change the four `@container lc-session (max-width: 700px)` (`app.css:364`, `1893`, `7840`; `dock.css:70`) to `786px`, and
`dock.css:150`'s `860px` to `946px`. In the comment at `app.css:1888-1889` add the sum, so the next person does not have to
work it out: thread 420 + panel 320 + rail 46.

Do **not** change `surfaces.css:2595` (`@container (max-width: 700px)`, another container) or `app.css:5332`.

**Source test:** `app.css` and `dock.css` hold no `@container lc-session (max-width: 700px)`.

**Verify:** `panelNarrow.rowShown` is still `true` at 880×580 (session 610 − rail). At 1440×900 nothing changes.

### 2. Taking the whole paper, the panel is flat

Inside the container block at `app.css:7840` (now 786px), beside the rule that shows `.lc-panel-top`, add:

```css
  /* Here the panel is the paper, not a card on it: its row is the paper's header, at the paper's corner. */
  .lc-session[data-panel]:not([data-wide]) .lc-body > .lc-panel:not([data-leaving]) {
    --lc-card-top: 0px;
    margin: 0;
    border-radius: 0;
    box-shadow: none;
  }
  .lc-session[data-panel]:not([data-wide]) .lc-body > .lc-panel[data-tab="session"]:not([data-leaving]) {
    align-self: stretch;
    height: auto;
    max-height: none;
  }
```

(`--lc-card-top` is L05's property. If L05 was not run, leave that line out.)

For two panes the same must hold up to 946px: add a second container block directly after it,
`@container lc-session (max-width: 946px)`, holding the same two rules and the `.lc-panel-top { display: flex; }` rule, each
with `[data-panes="2"]` added after `[data-panel]`. Do the same in `dock.css` for the `.lc-stabs-lead` rule at lines 70-74,
and for the traffic-light rule at `app.css:364-370` (copy the block with `[data-panes="2"]` and 946px).

**Verify:** `panelNarrow { margin: "0px", radius: "0px", rowShown: true }`.

### 3. The card stays a card while it closes

In the four card rules at `app.css:7780-7803`, the look must hold in both states and only the width may differ. Rewrite them
so that:

- `margin`, `overflow`, `border-radius`, `background`, `box-shadow`, `--lc-card-top` (and the `html[data-bg]` and the
  `2dppx` variants, and the `[data-tab="session"]` rule) apply to
  `.lc-session:not([data-wide]) .lc-body > .lc-panel` with **no** `:not([data-leaving])`;
- `justify-self: stretch; width: auto; min-width: 0;` stay on the `:not([data-leaving])` selector alone.

Then, in the one-pane width rule at `app.css:7674-7676`, take the card's margin off the width it closes at, so the content
does not re-wrap by 8px on its first frame:
`width: calc(max(100%, min(…)) - 8px);` keeping the inside of `max(…)` exactly as it is.

The flat rules of step 2 keep their `:not([data-leaving])`: add the same two selectors without it, so a narrow session's
panel also stays flat while it closes.

**Verify:** open and close a surface a few times in the measuring build's window if you can see it (`npm run app:dev`
against the same engine is the real shell). The measure script does not catch a 220ms state: say in Executor notes whether
you saw it.

### 4. Two panes fit their column

Replace `dock.css:146-148` with a rule that applies only while closing, and that knows the rail and the margin:

```css
/* Closing, two panes keep the width they had (the card's own width is its column's, less its 8px). */
.lc-session[data-panes="2"]:not([data-wide]) .lc-body > .lc-panel[data-leaving] {
  width: calc(max(100%, min(calc(var(--lc-panel-w, clamp(340px, (100cqw - 46px) * 0.36, 520px)) * 1.6), calc(100cqw - 466px))) - 8px);
}
```

Open, the card's `width: auto` (the newer rule) now applies with two panes as it does with one.

**Verify (if you can drag):** in a session, open Files, then drag another tab to the panel's right half to make a second
pane. The card's right ring must be visible left of the rail, with the same 8px from the thread as with one pane. If you
cannot drag in your browser, say "two panes not seen" in Executor notes.

## Known and left alone

While it closes, the panel is still wider than its shrinking column and so passes over the rail for 220ms as it fades. It
did so before this plan. Clipping it needs a look at what else relies on `.lc-body` not clipping (popovers in the thread),
so it is not done blind.

## Done

- Source test passes; typecheck and build pass; `npm test` passes (panel logic has tests in `engine/test/panels.test.ts`).
- Measured: `panelNarrow.margin = "0px"`, `radius = "0px"`.
- At 1440×900 `panel.*` is unchanged from after L05.

## STOP conditions

- After step 1 a surface open at 1440×900 measures differently from before the step.
- After step 3 the panel does not fade out at all, or stays on screen after closing (the `lc-panel-out` animation at
  `app.css:4443-4446` must still run): revert step 3 and report.
- Any step makes the card's ring disappear when open.
