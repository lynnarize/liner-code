# L01. Nothing breaks at the smallest window

**Commit message:** `A finding's footer and Liner Design's top row hold together in a small window`

## Why

The window can be 880×580 (`desktop/src/main.ts:208-209`). With the sidebar shown (264px) the paper is 610px. Two places
were never laid out for that, and both were seen on screen.

1. **Liner Security, a finding open.** The footer is a fixed 60px bar holding Dismiss, a hint, "Ask about it" and "Open the
   session" (or "Fix"), none of which may shrink except the hint. At a 320px panel the hint wraps one word a line to 94px,
   spilling over the text above and under the window, and the last button runs 35px past the panel's edge.
   Baseline: `findingFoot { barHeight: 60, tallestChild: 94, pastRightEdge: 35 }`.
2. **Liner Design, a design open.** The top row has no narrow behaviour: every item on the right is `flex: none`, so the
   kept-copies control, the "On its own" chip and the zoom overlap the title and slide 63px under the inspector.
   Baseline: `designBar { pastRightEdge: 63 }`.
3. **Liner Security's project pickers** print the project's name with `white-space: nowrap` and no cap, so a long folder
   name pushes the top row under the finding panel. (Reasoned from the CSS, not seen: the sample's names are short.)

## Current state (drift check)

Run this first. Every line must print; if one does not, stop this plan and report.

```bash
grep -n "height: 60px;" ui/src/app/security/findings.css          # 522, in .lf-x-act-bar
grep -n "flex: 0 1 auto;" ui/src/app/security/findings.css        # 541, in .lf-x-hint
grep -n "^\.ld-bar {" ui/src/app/design/design-face.css           # 340
grep -n "^\.ld-ver {" ui/src/app/design/build.css                 # 443
grep -n "^\.lo-cb {" ui/src/app/security/overview.css             # 6
grep -n "^\.lf-proj {" ui/src/app/security/findings.css           # 17
grep -n "^\.lc-strip-cap {" ui/src/app/app.css                    # 3414
```

`ui/src/app/security/findings.css:517-548`:

```css
.lf-x-act-bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 60px;
  box-sizing: border-box;
  padding: 0 22px;
  border-top: 1px solid var(--lc-hair);
  font-size: 13px;
}
…
/* What the actions will do, in a few words: it wraps onto a second line when the panel is narrow, never cut with "…". */
.lf-x-hint {
  flex: 0 1 auto;
  min-width: 0;
  …
```

The markup is `ui/src/app/security/FindingPanel.tsx:365-383`: `<footer className="lf-x-act-bar">` holding `Dismiss`,
`<span className="lc-grow" />`, `<span className="lf-x-hint">`, then two `.lc-btn`s.

Liner Design's row is `ui/src/app/design/DesignFace.tsx:187-219`: `header.ld-bar` holding, in order: Show the sidebar (only
when hidden), `TabTitle`, `span.lc-grow`, `LiveChip` (`.ld-srv`), `Versions` (`.ld-ver`, two `.lc-ib` and a `.ld-ver-t`
trigger), `.ld-who`, `OwnChip`, the zoom `Pop` (`.ld-zoom`), Play (`.lc-tb`).

## Steps

### 1. The finding's footer wraps instead of spilling

In `ui/src/app/security/findings.css`, in `.lf-x-act-bar`:

- replace `height: 60px;` with `min-height: 60px;`
- add `flex-wrap: wrap;` and `row-gap: 4px;`
- replace `padding: 0 22px;` with `padding: 8px 22px;`

In `.lf-x-hint`, replace `flex: 0 1 auto;` with `flex: 1 1 120px;` (it takes what is left, and once less than 120px is left
it drops to a line of its own under the buttons, by the wrap). Then add, directly under the `.lf-x-hint` block:

```css
/* The hint on a line of its own (a narrow panel) reads from the left, under the buttons it explains. */
.lf-x-act-bar > .lc-grow {
  flex: 1 0 0px;
}
```

Fix the comment above `.lf-x-hint` so it says what is now true: it takes the room left on the row and goes under the
buttons when there is none.

The body above the footer is the scroller (`.lf-x-body`), so a taller footer takes room from it, not from the window.

**Source test** (write first): `.lf-x-act-bar` has no `height`, has `min-height: 60px` and `flex-wrap: wrap`.

**Verify:** `findingFoot.pastRightEdge` is `0` and `findingFoot.tallestChild` is `40` or less. At 1440×900 the footer must
look as before: one row, 60px.

### 2. Liner Design's top row gives way in steps

In `ui/src/app/design/design-face.css`, add to `.ld-bar` (line 340): `container: ld-bar / inline-size;`.
Then, directly after the `.ld-bar .lc-pop { flex: none; }` rule, add:

```css
/* A narrow row gives way from the least needed: the kept copy's name, then the server chip and who is drawing, then the
   kept copies altogether. The title, the zoom and Play stay: the title shortens (its own rule below). */
@container ld-bar (max-width: 620px) {
  .ld-ver-t .ld-ell {
    display: none;
  }
}
@container ld-bar (max-width: 520px) {
  .ld-srv,
  .ld-who {
    display: none;
  }
}
@container ld-bar (max-width: 420px) {
  .ld-ver {
    display: none;
  }
}
```

Before you add it, read `OwnChip` (search `function OwnChip` under `ui/src/app/design/`) and find the element that holds its
words. If its words are in an element with a class, add that class's selector to the 420px step with `display: none` so the
chip shows its icon alone; if they are a bare text node, leave the chip as it is and say so in Executor notes.

**Source test:** `.ld-bar` declares `container: ld-bar / inline-size`, and a block for `.ld-ver` exists with `display: none`.

**Verify:** `designBar.pastRightEdge` is `0` at 880×580. At 1440×900 the row must look as before.

### 3. A long project name shortens in Security's pickers

`ui/src/app/security/Overview.tsx:78` and `ui/src/app/security/Findings.tsx:272` both print `{picked?.name ?? "All projects"}`
as a bare text node in the trigger. Wrap that expression, in both files, in `<span className="lc-strip-cap">…</span>`
(`.lc-strip-cap`, `app.css:3414-3420`, is the app's existing cap: 240px and an ellipsis). Change nothing else on those lines.

**Verify:** `npm run typecheck`. No measurement (the sample's names are short).

## Done

- `node --test engine/test/layout-rules.test.ts` passes with this plan's two tests.
- `npm run typecheck` and `npm run build` pass.
- Measured: `findingFoot.pastRightEdge = 0`, `designBar.pastRightEdge = 0`.

## STOP conditions

- The footer's markup in `FindingPanel.tsx` no longer has a `.lc-grow` between Dismiss and the hint.
- Any `@container` rule in `ui/src/app/design/*.css` already names `ld-bar`, or `grep -n "cq[wihb]" ui/src/app/design/*.css`
  prints a rule that applies inside `.ld-bar` (a new container would change what its units mean).
- After step 2 the row still overlaps at 880×580. Report the measure output; do not add a rule that hides the inspector
  (decision D5 in the README).
