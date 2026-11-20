# L13. What the audit of L01 to L12 found

**Commit message:** `The panel's ring is half a pixel again, a closing panel keeps the shape it had, Design's title gives way to its chips, and pills are round`

Written after the audit of commits `9c05294` to `bfb0ebc` (README, "The advisor's audit of the work"). Every fault here
was seen in the running app or read in both rules. Most come from a wrong number or a wrong assumption in the plans, not
from the model that ran them. Steps 1 to 4 were tried in the running app as injected styles before this was written, and
the numbers under each **Verify** are what that trial measured.

`plans/layout/check/measure.mjs` gained four keys for this plan. Today they read:

```
panel.ringAt2x                 "1px"     (must be "0.5px")
panelNarrow.closingRadius      "14px"    (must be "0px")
panelWide.closingRadius        "14px"    (must be "0px")
designBar.itemsOverlapBy       103       (must be 0)
```

## Current state (drift check)

```bash
git log --oneline -1                                             # bfb0ebc, or a later commit that touches none of the files below
sed -n 7690,7694p ui/src/app/app.css                             # @media (min-resolution: 2dppx) { .lc-session:not([data-wide]) .lc-body > .lc-panel {
sed -n 7745,7751p ui/src/app/app.css                             # "The flat look holds while it closes too" and .lc-session[data-panel]:not([data-wide]) .lc-body > .lc-panel {
sed -n 556,558p ui/src/app/Session.tsx                           # data-panel, data-wide, data-panes, all from dock.open
sed -n 452,460p ui/src/app/addons-page.css                       # .lc-ao-remove { border: 0; background: none; … } with no height
sed -n 392,395p ui/src/app/design/design-face.css                # .ld-bar .lc-pop:has(> .ld-tt) { flex: 0 1 auto; min-width: 0; }
sed -n 385p ui/src/app/design/Tabs.tsx                           # … <span>On its own</span> …
```

If a line does not match, find the rule by its selector. If the rule itself is different, STOP that step.

## Steps

### 1. The card's ring on a 2x screen

`ui/src/app/app.css:7690-7694`. L06 wrote the card rule as a list of two selectors, and the second
(`…> .lc-panel:not([data-leaving])`) outweighs this override, so an open panel on any Retina screen draws a 1px ring
instead of half a pixel. Give the override the same two selectors:

```css
@media (min-resolution: 2dppx) {
  .lc-session:not([data-wide]) .lc-body > .lc-panel,
  .lc-session:not([data-wide]) .lc-body > .lc-panel:not([data-leaving]) {
    box-shadow: 0 0 0 0.5px var(--lc-line), 0 1px 2px oklch(0.3 0.04 265 / 0.04);
  }
}
```

**Source test:** a block whose selector is `.lc-session:not([data-wide]) .lc-body > .lc-panel:not([data-leaving])` has a
`box-shadow` that contains `0.5px`.
**Verify:** `panel.ringAt2x` is `"0.5px"`.

### 2. A closing panel keeps the shape it had

While a panel closes, `Session.tsx:556-558` has already taken `data-panel`, `data-wide` and `data-panes` off the session
(they follow `dock.open`). So the "closing" selectors L06 added, which all ask for `[data-panel]`, never match, and the
bare card rule does: a panel that was the paper (a narrow session, or the full canvas) turns into a card with a ring for
the 220ms it fades.

**a. A narrow session (CSS only).** In `@container lc-session (max-width: 786px)` at `app.css:7734-7762` there are two
blocks whose selector has no `:not([data-leaving])`: the one under the comment "The flat look holds while it closes too",
and the last one, for `[data-tab="session"]`. Change only their selectors:

- `.lc-session[data-panel]:not([data-wide]) .lc-body > .lc-panel` becomes
  `.lc-session:not([data-wide]) .lc-body > .lc-panel[data-leaving]`
- `.lc-session[data-panel]:not([data-wide]) .lc-body > .lc-panel[data-tab="session"]` becomes
  `.lc-session:not([data-wide]) .lc-body > .lc-panel[data-tab="session"][data-leaving]`

Extend the comment with one sentence: the session has lost `[data-panel]` by then, so the closing panel is named by its
own mark. Leave the `946px` block and `dock.css` alone (see "Not in this plan").

**b. The full canvas (one attribute and one rule).**

- `ui/src/app/Session.tsx`, directly under the `data-wide=` line, add:
  `data-left-wide={leaving?.full || undefined}`
  (`leaving` is the dock as it was, `Session.tsx:126`; it is `null` unless a panel is closing.)
- `ui/src/app/app.css`, directly after the `@media (min-resolution: 2dppx)` block of step 1, add:

```css
/* A panel that was the whole paper closes as it was, flat. The session has lost [data-wide] by then, so it says what it
   left (Session.tsx, data-left-wide). */
.lc-session[data-left-wide] .lc-body > .lc-panel[data-leaving] {
  --lc-card-top: 0px;
  margin: 0;
  border-radius: 0;
  box-shadow: none;
}
```

**Source tests:** inside the 786px block, a block for `.lc-session:not([data-wide]) .lc-body > .lc-panel[data-leaving]`
has `border-radius: 0`; no block in `app.css` has the selector
`.lc-session[data-panel]:not([data-wide]) .lc-body > .lc-panel` (the dead copy is gone); a block for
`.lc-session[data-left-wide] .lc-body > .lc-panel[data-leaving]` has `box-shadow: none`.
**Verify:** `panelNarrow.closingRadius` and `panelWide.closingRadius` are `"0px"`. `panel.*` at 1440 and `panelNarrow`'s
other keys do not move. Beside the thread at 1440 the closing panel must still be a card (radius 14px, ring) for its fade:
step a was tried and holds; **step b was not tried** (the attribute does not exist yet), so look at it.

### 3. The first Remove on an add-on's sheet

`ui/src/app/addons-page.css:452-460`. L03 took `height`, `padding` and `border-radius` off `.lc-ao-remove` so the confirm
button (a `.lc-btn`, `AddonsPage.tsx:395`) would match "Keep it". But the first button, "Remove {name}…"
(`AddonsPage.tsx:400`), is not a `.lc-btn`: it is now bare text with no padding, and its footer is shorter. Directly
after the `.lc-ao-remove` rule add:

```css
/* The first Remove is a text button of its own, not a .lc-btn: it keeps its size and corner. The confirm Remove is a
   .lc-btn and takes that button's. */
.lc-ao-remove:not(.lc-btn) {
  height: 32px;
  padding: 0 10px;
  border-radius: var(--lc-r-field);
}
```

**Source test:** a block for `.lc-ao-remove:not(.lc-btn)` has `height: 32px`; the plain `.lc-ao-remove` block still has no
`height`.
**Verify:** the Demo build lists no add-on, so this cannot be opened there. Say "not seen" unless you can.

### 4. Liner Design's top row

All in `ui/src/app/design/design-face.css` unless said.

**a. The title shortens instead of running under the chip.** At 880×580 the title's wrapper shrinks but the button in it
does not, so "Design a home screen" is drawn under "On its own" (`designBar.itemsOverlapBy` 103). The button already has
`flex: 0 1 auto; min-width: 0`: it was written for a flex parent it never got. In the rule at lines 392-395 add one
declaration:

```css
.ld-bar .lc-pop:has(> .ld-tt) {
  display: flex;
  flex: 0 1 auto;
  min-width: 0;
}
```

**b. The chip gives up its words before the title is cut.** `ui/src/app/design/Tabs.tsx:385`: change `<span>On its own</span>`
to `<span className="ld-own-t">On its own</span>` and nothing else on the line. In the `@container ld-bar (max-width: 420px)`
step (lines 365-369) add `.ld-own-t` to the selector list beside `.ld-ver`.

**c. "Who is drawing" really hides.** In the `520px` step (lines 359-364) `.ld-who` loses to `.ld-who { display: inline-flex }`
at line 433, later in the same sheet at the same weight. Change the selector in the step to `.ld-bar .ld-who`.

**d. With the sidebar hidden, the title does not run under Show the sidebar.** L08 moved `.ld-tt` to `margin-left: -10px`
so its words start at 20px when it is first in the row. When the sidebar button stands before it (`.ld-bar` has
`gap: 6px`) the title's hover plate now covers the button's last 4px. Directly after the `.ld-tt` rule's closing brace add:

```css
/* After Show the sidebar the title keeps 2px clear of that button: only its first place in the row needs the full pull. */
.ld-bar > .lc-tb + .lc-pop > .ld-tt {
  margin-left: -4px;
}
```

**Source tests:** the `.ld-bar .lc-pop:has(> .ld-tt)` block has `display: flex`; a block whose selector list holds
`.ld-own-t` has `display: none`; a block for `.ld-bar .ld-who` has `display: none`; a block for
`.ld-bar > .lc-tb + .lc-pop > .ld-tt` has `margin-left: -4px`.
**Verify (measured in the trial):** at 880×580 `designBar.itemsOverlapBy` is 0, the title is about 131px wide and ends in
"…", the chip is its icon and chevron (about 49px). At 1440×900 nothing in the row moves and `topRowTextLeft.designHome`
stays 20. With the sidebar hidden the title's box starts 2px after the button (button 26 to 58, title from 60, words at 70).

### 5. Pills stay pills

L12's table sent 9px to 8 and 15px to 14. Five of those were not corners but half the height of a pill or a circle, and
they now have flat sides. Give each `border-radius: 999px` (a full pill is outside the scale, and the scale's test allows it):

| Rule | File and line | It is |
|---|---|---|
| `.lc-sinfo-switch` | `surfaces.css:5971` | a 30×18 switch with a round knob |
| `.ld-ck-n` | `design/checks.css:90` | an 18px count |
| `.ld-ck-mark[data-more]` | `design/checks.css:232` | an 18px count |
| `.ld-ck-mark` | `design/checks.css:249` | an 18×18 dot |
| `.lc-wel-pill` | `setup.css:238` | a 30px pill (its comment says so) |

Also `addons-page.css:111` and `:114`: the two halves of `.lc-ao-split` keep `11px` inside a parent that went to 10.
Write them `var(--lc-r-field) 0 0 var(--lc-r-field)` and `0 var(--lc-r-field) var(--lc-r-field) 0`.

**Source test:** each of the five blocks has `border-radius: 999px`; `addons-page.css` has no `11px`.
**Verify:** a switch shows in the Session surface only when a connection or add-on exists, and the checks need a design
with findings: say which you saw. `node --test engine/test/layout-rules.test.ts` still passes the corner-scale test.

### 6. Comments and leftovers

No behaviour changes. Each is one small edit.

- `security/findings.css:538`: the comment says the hint "goes under the buttons". The hint comes first in the markup, so
  when the row wraps the **buttons** go under the hint. Say that.
- `security/findings.css:549-552`, the rule `.lf-x-act-bar > .lc-grow { flex: 1 0 0px; }` and its comment ("reads from the left"):
  `.lc-grow` is already `flex: 1` and the hint keeps `text-align: right`, so the rule changes nothing and the comment is
  not true. Delete the rule and its comment. Then run the measure: `findingFoot` must not move (82 / 31 / 0 at 880×580).
  If it moves, put the rule back and correct only the comment.
- `design/intro.css:3`: "24px corners" is now 18.
- `surfaces.css:218-219` and `timeline.css:109-110`: two blank lines where L11 took a rule out. Leave one.
- `surfaces.css:355`: the comment "In a flex row the ellipsis is its own…" lost its rule in L11. Delete the comment.
- `engine/test/layout-rules.test.ts`, the test "the sidebar's width is said once": also assert the one declaration is
  `--lc-side: 264px` (today a wrong fix that kept 244px would pass).

## Done

- `npm run typecheck`, `npm run build` and `node --test engine/test/layout-rules.test.ts` pass.
- Measured: `panel.ringAt2x` "0.5px"; `panelNarrow.closingRadius` "0px"; `panelWide.closingRadius` "0px";
  `designBar.itemsOverlapBy` 0. Every other key is as it was before this plan.
- Executor notes filled in for this plan, and one line each for L07 to L12, which have none.

## STOP conditions

- Step 2b: `leaving` in `Session.tsx` is no longer the previous dock state, or has no `full`.
- Step 2: after the change a panel closing **beside the thread** at 1440 is no longer a card. Revert step 2 and report.
- Step 4a: at 1440×900 anything in Design's top row moves.
- Any step would need a change under `ui/src/liner/`.

## Not in this plan, on purpose

- **Two panes.** `dock.ts` has made no second pane since 0.2.2, so L06's two-pane rules (`app.css` 946px blocks,
  `dock.css:146-160`) cannot be reached and were only ever checked by injected state. Whether to delete them or bring two
  panes back is the owner's call.
- **Inner corners that now equal the outer one** (`.lc-dz-sizes`, `.lc-esc`, `.ld-say`, `.ld-way-keep`, `.ld-rail`,
  `.lc-sb-bulk`, `.lc-cold`, `.lc-mode-tabs`): a four-step scale cannot keep every nested pair concentric. They are 1 to
  2px off, not broken. A fifth step or per-pair tuning is a design decision.
- **`.lc-ship-morph`** is 14px closed and open, so its corner no longer morphs from a pill. 1px, left.
- **`.lc-session[data-beside] .lc-panel`'s hairline** (`app.css:4409-4416`) and the other L11 items that were skipped:
  they look dead but were not proven dead. Left.
- **The rail overrun while closing** (the fading card slides over the rail): L06 deferred it and so does this.
