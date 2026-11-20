# Layout pass: the note

A read-only audit of the app's layout on 2026-11-19, at commit `125db4f` (branch `design-and-api-endpoints`, version 0.3.0 beta).
Nothing in the app was changed. This folder holds twelve fix plans for another model to carry out, the prompt to give it
(`PROMPT.md`), and a script that measures the running app (`check/measure.mjs`).

The older plans in `plans/001` to `plans/014` are a different job and are finished. Do not touch them.

## How the audit was done

- Four read-only auditors read every stylesheet under `ui/src/app` (22,000 lines) with the components that use them.
- The app was run isolated with only the Demo agent and looked at on about 140 captures at 1440×900, 1100×700 and 880×580
  (880×580 is the smallest window the shell allows, `desktop/src/main.ts:208-209`).
- Each finding a plan leans on was either seen on screen or measured. Where it was only reasoned from the CSS, the plan says so.

## What was found, in one page

1. **Things that are broken at a small window.** The finding panel's footer in Liner Security spills out of its bar; Liner
   Design's top row runs under the inspector; the Add-ons page's info note is one line 1,313px wide.
2. **One real bug that is not CSS.** With Add-ons (or Usage, or the Wall) open, switching to Design or Security leaves that page
   on the paper under the other face's sidebar.
3. **The side panel changed shape on 14 November and its insides were not brought along.** Beside the thread it is now a card
   with no top row, but most surfaces still start 0 to 4px from its top edge, as they did under a 44px row. Its column is not a
   whole number of pixels (991.4). Three generations of width rules are still in the sheet, and the newest loses while the panel
   closes, in two-pane mode and in a narrow session.
4. **Rules written twice, where the later one wins.** `app.css` grew by appending: about 60 declarations are dead under a later
   block, and seven classes have no reference at all.
5. **The same part built several ways.** Three top rows, five side panels, ten menu rows, ten empty states, eight section
   headings, about a dozen icon-button sizes, and corner radii mostly off the 18 / 14 / 8 scale the sheet's own comments name.

Items 1 to 4 are planned here. Item 5 is planned only where the answer is plain (menus, the top row's left edge, the Add-ons
page, the corner scale); the rest is listed under "Not planned" with the facts, because each needs a design decision.

## The plans

| # | Plan | What changes for the person using the app | Risk | Seen on screen? |
|---|---|---|---|---|
| L01 | `L01-nothing-breaks-at-the-smallest-window.md` | The finding panel's footer and Liner Design's top row hold together at 880×580 | low | yes |
| L02 | `L02-a-face-switch-shows-that-face.md` | Switching face always shows that face's page | low | yes |
| L03 | `L03-addons-page-on-the-page-pattern.md` | The Add-ons page reads as a page of the app; its note wraps | low | yes |
| L04 | `L04-menus-one-corner-one-gap.md` | Every menu has the 14px corner its rule asks for, rows 2px apart | low | yes |
| L05 | `L05-panel-card-one-inset.md` | Every surface in the panel card starts the same distance from its top; whole-pixel edges; Commit on the composer's row | medium | yes |
| L06 | `L06-panel-in-narrow-two-pane-and-closing.md` | The panel is right in a narrow session, with two panes, and while it closes | **high** | partly |
| L07 | `L07-thread-and-composer-one-edge.md` | What the agent wrote starts where what you type starts | low | yes |
| L08 | `L08-one-top-row-edge.md` | The top row's words start at one x on every face | low | yes |
| L09 | `L09-fold-by-own-width.md` | Usage, the lean page and Findings fold by their own width, not the window's | medium | no |
| L10 | `L10-small-spacing-faults.md` | A dozen 0 to 4px faults: rows that touch, a doubled gap, a stale toast offset | low | partly |
| L11 | `L11-dead-and-superseded-rules.md` | Nothing visible: the losing copies of rules are removed | medium | n/a |
| L12 | `L12-corner-scale.md` | Corners follow one scale | medium | no |

| L13 | `L13-after-the-audit.md` | What the audit of L01 to L12 found: the ring at 2x, a closing panel's shape, Remove, Design's title, pills | low | steps 1, 2a and 4 tried in the app |

Order: L01 to L12 as numbered. L05 must come before L06. L11 must come after L05 and L06 (they remove some of the same lines).
L12 is last and is the only plan that changes the look of healthy screens. The owner confirmed it on 2026-11-19: run it.

## Rules for every plan

These are the repo's rules (`CLAUDE.md`) and they are not negotiable.

- **Never run a formatter.** No prettier, no `eslint --fix`. Do not re-wrap or re-indent a line you did not change.
- **Do not touch**: `ui/src/liner/` (a vendored copy), Routines (`Routines.tsx`, `RoutineBuilder.tsx`, and the `.lc-rt*`,
  `.lc-rb*`, `.lc-run*`, `.lc-pr-head/-title/-checks/-dot/-status/-spin` rules that only they use), `mac/`, the Demo provider
  (`engine/src/providers/demo*.ts`), `CHANGELOG.md`.
- **Comments are plain sentences that say why**, in the style of the file. When a rule changes, fix the comment above it in the
  same edit: several comments in these sheets describe a layout that is gone.
- **Every fix comes with a test that fails without it.** For CSS the test is a source test (below). For L02 it is a logic test.
- **One local commit per plan**, message one plain sentence about what is now true for the person using the app (examples are in
  each plan). Never push. Never amend an earlier plan's commit.
- New CSS goes **in place**, in the rule it corrects. Do not append another override block at the end of a file: that is how
  the sheet got this way. Where a plan says "replace", the old declaration is deleted, not left under a new one.
- After every plan: `npm run typecheck`, `npm run build`, and `node --test engine/test/layout-rules.test.ts` must pass.

### The source test

CSS has no unit tests here, so each CSS plan adds assertions to one file, `engine/test/layout-rules.test.ts` (create it in the
first plan that needs it; engine tests already read `ui/src` files, see `engine/test/browser-frame.test.ts`). Start it with
exactly this helper, then one `test(...)` per plan step, named as a full sentence:

```ts
/*
  The layout rules that were wrong once (plans/layout): each is read from the stylesheet as written, since a
  stylesheet has nothing to run. Run with `node --test engine/test/layout-rules.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sheet = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
// Every block whose selector list holds exactly this selector, in file order: its declarations as text.
const blocks = (css: string, selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")).includes(selector)).map((m) => m[2]);
// One property's value in a block, or undefined.
const value = (block: string, property: string) => block.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`))?.[1].trim();
```

Write each test **before** the fix and see it fail for the stated reason. A test that passes before the fix means the code is
not as the plan describes: stop that plan and report.

### The measuring build

`check/measure.mjs` opens the app in a headless browser and prints the numbers the plans change. Use it before your first plan
and after each plan. It needs a dev build that can only reach the Demo agent, so nothing real is spent:

```bash
# terminal 1: the engine, with a throwaway home and no agent tool on the PATH
D=/tmp/liner-layout; mkdir -p $D/home $D/xdg $D/claude $D/codex $D/tmp
HOME=$D/tmp PATH=/usr/bin:/bin:/usr/sbin:/sbin XDG_CONFIG_HOME=$D/xdg CLAUDE_CONFIG_DIR=$D/claude CODEX_HOME=$D/codex TMPDIR=$D/tmp LINER_HOME=$D/home "$(command -v node)" engine/src/main.ts --port 7799 --dev

# terminal 2: the app
LINER_ENGINE=http://127.0.0.1:7799 npm run dev -w ui -- --port 5199 --strictPort

# once, after the engine is up: show the Demo
curl -s -X POST http://127.0.0.1:7799/rpc -H 'content-type: application/json' -H "x-liner-token: $(cat /tmp/liner-layout/home/dev-token)" -d '{"method":"settings.save","params":{"showDemo":true}}'

# then, whenever you want the numbers
node plans/layout/check/measure.mjs http://localhost:5199 > /tmp/layout-now.json
```

The first run walks through Setup and makes one Demo session and one Demo design (about a minute). If you cannot run a browser
at all, say so in "Executor notes", do the plans whose Done criteria are source tests only, and mark the measured criteria
"not measured". Do not guess a measurement.

### Baseline (measured at `125db4f`, 1440×900 unless said)

```
menu.radius                         16px        (the rule says 14)
panel.*.cardX / cardW               991.4 / 396.6   (not whole pixels)
panel.Session.textTop               12.5
panel.Changes.textTop               10
panel.Agents.textTop / textLeft     10.5 / 14
panel.Files.firstBoxTop             2           (the find field, 2px under the card's edge)
panel.Changes.footVsSend            -8          (Commit's centre is 8px above Send's)
panelNarrow (880×580)               margin "8px 0px 8px 8px", radius 14px, rowShown true, tabsShown 0
threadWide                          thread text 488, composer text 486
threadBesidePanel                   thread text 306, composer text 298
topRowTextLeft                      session 20, securityOverview 20, designHome 22, settings 26
addons                              h1 26px at 48, gutter 40px, column 860, top row absolute
addons.noteWidth                    1313, pageScrollsSideways true
faceSwitch.addonsPageStillShown     true
findingFoot (880×580)               barHeight 60, tallestChild 94, pastRightEdge 35
designBar (880×580)                 pastRightEdge 63
```

## Decisions I took, for the owner to confirm

You asked that where two layouts do one job, the newer wins. These are the places where I had to read that rule, and one
where I went against its letter. Strike a plan or a step before handing this over if you disagree.

- **D1. The panel beside the thread stays a card with the rail** (14 November, the newest shape of the Code panel). L05 and
  L06 bring the surfaces and the edge cases to it. The older flat column survives only over the whole paper and in a session
  too narrow for both, where the sheet's own newest comment calls the panel's row "the paper's header".
- **D2. The Add-ons page moves to Settings' page pattern**, although by `git blame` the Add-ons page (3 November) is newer than
  Settings' column (28 October). Reason: Settings' pattern is used by 14 sections and about 150 rows, the newest page of all
  (Setup, 17 November) uses the same 24px title, and the same add-ons are already listed in Settings in that pattern.
- **D3. The corner scale in L12 is 8 / 10 / 14 / 18**, not the 18 / 14 / 8 the comments name, because 10 is Liner's own field
  radius (`--l-r-sm`) and the 0.2.7 sidebar rows use it on purpose. Page cards go to 14, so they are never rounder than the
  paper they sit on (the paper is 14 on a Mac). This changes Settings' and Usage's cards from 18 to 14, which you will notice.
  **Confirmed by the owner on 2026-11-19: keep L12 and this scale.**
- **D4. The top row follows `.lc-top`** (20px to the first word). Liner Design's `.ld-bar` is newer by date but has 3 uses
  against 14, and the newest face, Security, chose `.lc-top`.
- **D6. The panel takes the whole paper sooner: under 786px of session, not 700** (L06). 786 is the thread's 420 plus a
  panel's 320 plus the rail's 46; the old 700 was set before the rail existed and let the card get as thin as 227px. With
  the sidebar shown this changes windows between about 971 and 1055px wide: the panel covers the thread there instead of
  squeezing beside it. Two panes: 946 instead of 860.
- **D5. Liner Design's inspector still does not give way at a small window.** L01 only stops the top row running under it. At
  880 wide with the sidebar shown the canvas is 316px. What should yield (the inspector, the sidebar, or a toggle) is yours.

## Not planned, and why

Each of these is real and came out of the audit with evidence. None is a one-answer fix: they need a decision or a drawing
first (your own rule: a mockup before a redesign).

| Finding | The facts | Why not now |
|---|---|---|
| Three shapes of side panel across faces | Code: floating card + rail (14 Nov). Design inspector: flat 292px column, tabs in the top row (13 Nov). Security finding and scan panels: flat columns with a hairline (18 Nov). Header insets 8 / 10 / 16 / 22 | Which shape is "the" panel is a design call. Security's are the newest by date |
| Icon buttons in a dozen sizes | `.lc-ib` 28 (83 uses), `.lc-tb` 32 (42), rail 30, sidebar head 26×28, row actions 22, and seven more | Changing sizes moves every row they sit in |
| Text-button and field heights | Buttons 24 to 44; inputs 28 / 30 / 34 / 36 / 44; three search-field heights; segmented at 30 / 38 / 40 | Same |
| Ten menu-row classes | `.lc-row` (153 uses) and nine local copies; newest metrics are the sidebar heading menu's (18 Nov) | Folding them is a refactor of ten components |
| Ten empty states, seven loading states, eight section headings | The shared `.lc-panel-empty` (7 surfaces) and nine local ones; `.lc-diff-wait` and six others; headings from 12/400 to 16/600 | Needs one drawn pattern each |
| A button used as a menu's trigger loses its fill | `.lc-pick { background: none }` (`app.css:731-737`) follows `.lc-btn` at the same weight: `Settings.tsx:2791`, `Panel.tsx:632` (Push) | The plain fix changes the weight of every menu trigger's rule |
| A dialog's buttons sit 2px from its bottom edge, in a 28px frame round a 16px card | `--l-frame-pad: 0px` (`app.css:114`) with Liner's `.l-dialog__actions { padding: 6px 6px 2px }` | Belongs with the dialog decision above |
| A long model name cannot shorten | `.lc-model { flex: none; white-space: nowrap }` (`app.css:525-533`) defeats the ellipsis at `models.css:197-202`, `564-567` | Needs a name of about 35 characters to show; not seen |
| Session info cuts a long branch with no "…" | `text-overflow` on a flex container (`surfaces.css:365-367`) | Same |
| Browser's toolbar has no narrow layout | 6 to 8 fixed 28px buttons and one address; about 64px of address at a 340px panel | Needs a decision on what to drop |
| The sidebar head's three buttons touch and are 26×28 | `app.css:7293-7300` | Belongs with icon-button sizes |
| The Wall's tiles start 4px under the top row | `wall.css:56` `padding: 4px 16px 16px` | May be intended |
| Two diff components | Docked Changes restyles Liner's `CodeDiff`; full Review draws its own rows | A component merge, not a layout fix |
| Two dialog systems and a hand-built drawer | `.lc-sheet` (2 uses), Liner `Dialog` (5), `.lc-ao-sheet` (1) | The newer and the more-used point opposite ways |
| Three tooltip systems plus 163 native `title`s in Settings | Liner `Tooltip`, `HoverNote`, the sidebar's card | L03 moves the one that is broken |
| Fractional type sizes in Security | 42 of 108 `font-size`s at 11.5 / 12.5 / 13.5 / 14.5, against "whole-pixel sizes" (`app.css:12`) | Type, not layout |
| Wells inside the panel card | Terminal box, Browser stage and console, Device stage: 14px wells 10px inside a 14px card | Each needs a look once L05 is in |
| Security's pages have three measures | Overview and Projects 1080, Start a scan 880, Findings 760 | May be intended per page; ask |
| Settings' sidebar rows are 34px at 14 medium, the main sidebar's 32px at 13 regular | `settings.css:164-185` against `app.css:1064-1074`, `7693-7699` | Small, but it restyles a whole column |
| Setup is a different shell | No paper, a 300px rail with a hairline | It is the newest page; likely intended |

## The advisor's audit of the work, 2026-11-20

Audited at `bfb0ebc`: twelve commits on top of `125db4f`, one per plan, nothing pushed. Four reviewers read every diff
against its plan and ran each new test against its parent commit; the advisor then checked each claimed fault in the
running app (the measuring build, 1x and 2x, 1440×900 down to 880×580) and compared captures with those taken before the work.

**Verdict: the work follows the plans, and the app is better on every number the plans named. Seven faults remain.
Six of them come from the plans, one from the way a plan was carried out. All are in `L13-after-the-audit.md`.**

**What holds**

- Every commit changes only what its plan names. No formatter ran, no `!important`, nothing appended as an override block,
  nothing under `ui/src/liner/`, Routines, `mac/`, the Demo provider or `CHANGELOG.md`. `engine/src`, `desktop/` and
  `contracts/` are untouched.
- Every new test fails on its parent commit for the reason its plan gives, and passes on its own (checked by running, all 12).
- `npm run typecheck` 0, `npm run build` 0, layout and face tests 40 of 40. `npm test`: 1,465 of 1,467; the two failures
  ("checks: a big repository never holds the engine's thread for long", "sidekick: a brief that waited in line…") are
  timing tests, ran while a browser was measuring, and pass alone (10 of 10, and 29 of 29 twice).
- Measured against the baseline above, every key moved to its plan's target and no other key moved: menus 14px; the card
  on whole pixels (992 / 396); Files' find field 8px in; Commit on Send's row; the narrow panel flat; thread and composer
  text on one edge (486 / 486, 298 / 298) and your message ending where Send does; the top row's words at 20 on all four
  faces; Add-ons on the page pattern with a 300px note; the face switch; the finding footer and Design's row inside the window.
- L11 removed 199 lines and no deletion changes what is drawn (each checked against the rule that survives and the markup).
- L09's Findings threshold is 1228px, not the plan's 958. The plan's number was wrong by its own rule (unchanged with the
  sidebar closed); the executor's is right. Seen: Usage folds at a 880px page, the finding panel narrows by the page.

**Faults (all in L13)**

| # | From | What the person sees | Whose |
|---|---|---|---|
| 1 | L06 | On a Retina screen the open panel's ring is 1px, not half a pixel (measured at 2x) | executor: the card rule became a selector list that outweighs the 2x override |
| 2 | L06 | A panel that was the paper (narrow session, full canvas) flashes as a card with a ring while it closes (seen frame by frame) | plan: its closing selectors ask for `[data-panel]`, which `Session.tsx` has already removed |
| 3 | L03 | "Remove {name}…" on an add-on's sheet is bare text with no padding (read; the Demo has no add-on) | plan: it took the size off both Remove buttons, and only one is a `.lc-btn` |
| 4 | L01 | At 880×580 Design's title is still drawn under "On its own" (seen). The row no longer leaves the window | plan and its measure: the script compared wrappers, and the wrapper shrinks under a button that does not |
| 5 | L01 | "Who is drawing" never hides in a narrow row (read) | plan: a later rule of the same weight wins |
| 6 | L08 | With the sidebar hidden, Design's title plate covers the last 4px of Show the sidebar (seen) | plan: −10px against a 6px gap |
| 7 | L12 | A switch, the checks' dots and counts, and Setup's pills have flat sides: 9→8 and 15→14 were half-heights, not corners (read) | plan: the table had no rule for pills |

Smaller, also in L13: two comments in `findings.css` that say the opposite of what happens, a rule there that does
nothing, "24px" in `intro.css`, two doubled blank lines and one orphaned comment from L11, and a test that would pass
with the wrong sidebar width.

**Not faults, but said plainly**

- **Executor notes stop at L06.** L07 to L12 were done and committed without a note, a measure output or a final test run
  on record. The numbers for them above are the advisor's.
- **Two panes cannot be reached** (`dock.ts` has made no second pane since 0.2.2), so that half of L06 fixes rules nobody
  can meet. The plan should not have planned it. Delete those rules or bring two panes back: the owner's call.
- **L11 skipped five listed items without saying so** (one rightly: the plan was wrong about `scan.css:264-267`).
  Nothing visible depends on them.
- **L12, nested corners.** With four steps, eight inner boxes now have the same corner as the box round them
  (1 to 2px off concentric). Listed in L13 under "Not in this plan".
- **The measure script** made a new Demo design on every run (it looked for the wrong row class), which is why the
  executor's build has 24 of them. Fixed, with four new keys: `panel.ringAt2x`, `panelNarrow.closingRadius`,
  `panelWide.closingRadius`, and `designBar.itemsOverlapBy` now compares the buttons themselves.
- Not seen by anyone: the traffic-light indent on the Mac shell, a real add-on's sheet, a switch in Session info, the
  lean page's fold, anything at 2x other than the ring.

## Executor notes

(The model that runs the plans fills this in: for each plan `DONE <commit>`, `BLOCKED <one line why>` or `SKIPPED <why>`, and
anything it could not verify.)

Baseline measured before the first plan (`/tmp/layout-before.json`, commit `125db4f`): matches the README's baseline on every
key. No difference to report.

- **L01 DONE `9c05294`.** Both source tests written first and seen to fail for the plan's stated reasons, then pass;
  typecheck and build pass. Measured at 880×580: `findingFoot.pastRightEdge` 35→0, `findingFoot.tallestChild` 94→31,
  `designBar.pastRightEdge` 63→0; every other measure key byte-identical (the `setup` key only prints on a first launch).
  At 1440×900 both rows verified unchanged by a read-only Playwright probe: the footer is one 60px row with a one-line hint,
  the Design bar stays 44px with no item hidden, no overlap and no overflow. Notes: (1) OwnChip's words sit in a classless
  `<span>` (`design/Tabs.tsx:385`), so step 2's "add that class's selector" branch was inapplicable; the chip was left as it
  is, `Tabs.tsx` untouched, and the measured target still passes. (2) When the footer wraps at 880 the buttons drop under the
  hint (DOM order), not the hint under the buttons as the plan's prose says; the plan's comment was used verbatim and the
  numeric Verify criteria pass. (3) No screen was inspected by eye — all visual claims are computed-style/geometry probe
  readouts, not screenshots looked at.
- **L02 DONE `a171aaa`.** Logic test written first, failed with `ERR_MODULE_NOT_FOUND` (face-pages.ts absent), then both
  tests pass; typecheck and build pass; L01's tests still pass. Measured `faceSwitch.addonsPageStillShown` true→false; all
  67 other keys unchanged. A Playwright probe confirmed Code session → Security → Code returns the same session thread, and
  Add-ons → Design shows Design with the Add-ons page gone. The plan's fallback was used: `face.ts` cannot load under Node
  (`ERR_UNKNOWN_FILE_EXTENSION` for `./face.css`, confirmed by two probes), so `keptOnFaceChange` lives in the new
  `ui/src/app/face-pages.ts`; `face.ts` untouched. Full suite caveat: under heavy parallel machine load (load averages
  11–24) `npm test` never exited 0 in one shot — 1420/1431 twice with different timing-test subsets; every failing file
  passes in isolation (antigravity 53/53 twice after one isolated flake; desktop run separately 49/49). No engine or desktop
  test imports the changed modules except the new face-change test, so these are load flakes, not regressions; a quiet
  full-suite re-run is recorded in the final pass below.
- **L03 DONE `2916281`.** Both source tests written first and seen to fail for the plan's stated reasons (absolute top row;
  860px/26px), then pass; typecheck and build pass. Measured: `addons.noteWidth.width` 1313→300, `pageScrollsSideways`
  true→false, `h1Size` 26px→24px, `gutter` 40px→32px, `colWidth` 860→760, `topRowPosition` absolute→static, `h1Top` 48→76;
  all 61 other keys unchanged. Probes: the info button's centre sits on the subtitle's line box (delta 0); the note portals
  at 300px wide, 5 lines, inside the window; the scroller fills the paper to its bottom and at 1440×360 scrolls with nothing
  clipped (the 96px bottom padding visible at max scroll). Screenshots were looked at (note wrap; page bottom at max scroll).
  The Remove button was not seen on a genuinely opened Details sheet — the Demo build lists no add-ons — verified instead by
  the source diff and an injected-button cascade readout (Keep it and Remove both pill 999px/30px high, Remove keeps its
  danger colour). Minor: the plan's drift comment names line 38 for the h1 font-size; the declaration is at line 40 (content
  matches).
- **L04 DONE `390167f`.** Both source tests written first and seen to fail (plain `.lc-pop-panel` selector + the 13px block;
  1px row gaps), then pass — 6 tests green; typecheck and build pass. Measured `menu.radius` 16px→14px; all 67 other keys
  unchanged. Row gaps changed to 2px in the nine row lists the plan's table names (`.lc-envp`, `.lc-env-in`, `.lc-who-scroll`,
  `.lc-rvm`, `.lc-qp-list`, `.lc-crp`, `.lc-cr-files`, `.lc-ao-ways`, `.lc-pc-list`), each confirmed a list of rows with a
  hover wash. Left at 1px, per the plan's criterion: `.lc-sl-acts` (the row's action icons, not rows), `.lc-team` and `.lc-qp`
  (their gaps separate header/list tracks, not rows). The sidebar-heading menu keeps padding 5px/gap 0, corner 13→14px.
  Screenshots were looked at for the composer's menus, the Crew menu, the Add-ons ways menu and the heading menu: 14px
  corners, no scrollbar (scrollHeight == clientHeight in each). `.lc-pc-list` cannot be opened in the Demo build (model lists
  exclude Demo) — verified by the source test and an injected-element cascade readout instead. Noticed, not fixed (the plan
  names only the gap): `.lc-qp-list`'s `max-height: calc(34px * 8 + 7px)` is sized for 1px gaps — eight 34px rows at 2px gaps
  need 286px against 279px, so the eighth row scrolls a little; left as the plan's scope dictates.
- **L05 DONE `d511352`.** Five source tests (one per value-changing step), each written first and seen to fail for its stated
  reason, each green at its own step before the next; 11 tests green overall; typecheck and build pass with no CSS warning.
  Measured: `cardX`/`cardW` 991.4/396.6 → 992/396 on all five surfaces; `Changes.footVsSend` −8→0; `Files.firstBoxTop` 2→8;
  `Agents.textLeft` 14→16. Consequential changes, all explained by the plan: `Files.textTop` 42.8→48.8 (the first text sits
  below the find field and moves with it), `Browser.textLeft` 49.8→49.5 (centred empty-state text in a 0.6px narrower card),
  `threadBesidePanel.youRight`/`sendRight` +1 (the thread gains the rounded-away 0.625px). 51 keys unchanged, including
  `panelNarrow` and every whole-paper value; Session/Changes/Agents `textTop` (10–12.5) left as they are — the plan's table
  marks them "fine". Probes: the 520ms grid animation interpolates with `round()` (no snap, the column never 0, console
  clean); the bottom panel's Terminal really resolves padding-top 0 (it lives outside `.lc-panel`); wide mode keeps all the
  old values through the var fallbacks; the MoreFiles line was verified by injection at the component's real DOM position
  plus a screenshot (16px inset, aligned with the diff text, Commit row intact). Not seen: Browser's address bar with a real
  page open (the plan marks it not required; opening a URL would hit the network), Linked/Device/add-on-banner with real
  content (the Demo has none), MoreFiles with >60 changed files (the Demo sample has 1) — verified by source tests and
  injected-element cascade readouts, labelled as such. Step 5 is unscoped as the plan writes it: Agents' text starts 16px in
  over the whole paper too (was 14).
- **L06 DONE `d7f6ac7`.** Four source tests written first, each seen to fail for its stated reason, each green at its own
  step; 15 layout-rules tests and 29 panels tests pass; typecheck and build pass. Step 1: the four `lc-session` containers
  700→786px and dock's two-pane handover 860→946px (the `@media 860` Add-ons rule and the unnamed container in surfaces.css
  untouched); a 1000×700 probe (session 730, inside D6's band) shows the panel now taking the paper where it used to squeeze
  to ~256px; 1440×900 measured byte-identical after the step (the plan's STOP guard). Step 2: measured `panelNarrow.margin`
  "8px 0px 8px 8px"→"0px" and `panelNarrow.radius` 14px→0px, `rowShown` true, header 44px; `panel.*` at 1440 unchanged —
  these two keys are the ONLY changes in the whole plan's measure diff (66 keys identical). Step 3: the close fade verified
  headlessly (real shell not run — Demo isolation): ~100ms into close `animationName: lc-panel-out`, opacity 0.27, card look
  and ring held, panel detached by ~450ms, repeat runs identical, no page errors. Step 4: the open-state two-pane width rule
  replaced by the plan's closing-only rule. Full `npm test` under load (averages 7–17): 1441/1444 twice, the SAME three
  timing tests (owners ×2, security-checks ×1); each passes in isolation (5/5, 10/10, 15/15 together), desktop 49/49
  separately — load flakes, the change is CSS + a source-test file only. **Findings for the owner (left exactly as the plan
  writes, neither is a plan STOP):** (1) `Session.tsx:556-558` drops `data-panel`/`data-wide`/`data-panes` while leaving, so
  step 3's duplicated flat selectors and step 4's closing-only two-pane width rule NEVER MATCH in a real close: the narrow
  closing panel keeps the CARD look for its 220ms fade (verified), and a real two-pane close would use the single-pane
  closing width. Making the close flat would need a Session.tsx change or selectors beyond the plan's letter — not done.
  (2) Two panes are unreachable through the UI in any build since 0.2.2 (`dock.ts`: "nothing makes a second"); an honest drag
  attempt executed the drop but `data-panes` stayed null. **Two panes not seen** — the open-state fix (the plan's actual bug:
  dock's width rule outweighing the card's `width: auto`) verified by injected-state cascade readouts: column 647px whole,
  card 639 = 647 − 8, right edge = rail's left, 8px gap, ring present; a screenshot corner was looked at. (3) Formulation
  deviation, forced by the no-modify-existing-tests rule: the card look rule names the open-state selector beside the bare
  one in a selector list (declarations written once, comment says why) so L05's source test still finds `--lc-card-top` on
  the card's own selector; `justify-self`/`width`/`min-width` stay on the open state alone. (4) The known rail overrun while
  closing was observed (302px past the rail mid-fade) and left alone as the plan defers it. Not live-verified headless: the
  traffic-light 946 copy (no `data-native="mac"` in a browser) and the 2dppx ring (dpr 1) — source-tested verbatim copies.
- **L07 DONE `0581410`** — "The conversation's text and the composer's text share their left edge, and your message ends
  where Send does". Carried out by another session during this orchestrator's auth outage; no executor note was left on
  record. The advisor's audit checked the diff against the plan, the test against its parent, and the numbers: thread and
  composer text on one edge (486/486 wide, 298/298 beside the panel), your message ending where Send does.
- **L08 DONE `f0193fe`** — "The top row's first word starts at the same place in Code, Design, Security and Settings".
  Same record as L07. Audited: the top row's words at 20 on all four faces. Its fault 6 (Design's title plate covering the
  Show-sidebar button) is L13 step 4d.
- **L09 DONE `b1431d0`** — "Usage, a design's lean page and a finding's panel fold by the room they have, sidebar open or
  not". Same record as L07. Audited: Usage folds at an 880px page, the finding panel narrows by the page. The Findings
  threshold is 1228px, not the plan's 958 — the plan's number was wrong by its own rule (unchanged with the sidebar closed);
  the executor's is right.
- **L10 DONE `68f1510`** — "Rows that touched stand apart, a doubled gap is single, and notices sit under the top row as it
  is now". Same record as L07. Audited with the rest: every key moved to its plan's target and no other key moved.
- **L11 DONE `42c5f9e`** — "The stylesheets no longer carry rules that a later one always overrode". Same record as L07.
  Audited: 199 lines removed, no deletion changes what is drawn (each checked against the surviving rule and the markup).
  Five listed items were skipped without a note (one rightly: the plan was wrong about `scan.css:264-267`); nothing visible
  depends on them.
- **L12 DONE `bfb0ebc`** — "Corners come in four sizes: 8 for a row, 10 for a field, 14 for a card or a menu, 18 for the
  paper". Same record as L07. Audited: the scale applied; eight inner boxes now sit 1–2px off concentric (listed in L13
  under "Not in this plan"); the flat-sided pills (fault 7) are L13 step 5.
- **L13 DONE `dbcddff`** — "The panel's ring is half a pixel again, a closing panel keeps the shape it had, Design's title
  gives way to its chips, and pills are round". Steps 1–2 had already been applied by a previous executor (idle since
  07:01); the orchestrator verified them before resuming (41 tests, typecheck, `ringAt2x` 0.5px, both `closingRadius` 0px)
  and did not redo them. Steps 3–6 were carried out test-first: seven new tests, each seen to fail for the plan's stated
  reason and then pass; the one existing-test change the plan names (the sidebar-width test also asserts `--lc-side:
  264px`) is a guard that passes before and after by design; L06's closing test was updated to the renamed selectors
  because step 2's "the dead `[data-panel]` copy is gone" assertion forces it. 48/48 layout-rules tests; typecheck and
  build pass. Measured, the four fault keys: `panel.ringAt2x` 1px→**0.5px**, `panelNarrow.closingRadius` 14px→**0px**,
  `panelWide.closingRadius` 14px→**0px**, `designBar.itemsOverlapBy` 103→**0**; every other key as before. The executor's
  clean full measure run changed only `itemsOverlapBy` (70 of 71 keys identical); the orchestrator's two full runs under
  load showed the documented Browser port-scan race (the script's 1300ms wait samples the surface mid-scan), proven
  environmental by a wait-for-settled probe reading Browser byte-identical to before (textTop 242, textLeft 49.5,
  firstBoxTop 573, card 992/396/872) and by the executor's stash diagnostic. Seen on screenshots: Design's row at 880×580
  (overlap 0, title 131px ending in "…", chip 49px icon+chevron), the row byte-identical at 1440×900 with `designHome` 20,
  the sidebar-hidden gap (button 26–58, title box from 60, words at 70), the checks' dots and counts fully round on the
  Demo design's findings (Checks 10), and the Add-ons split button's 10px outer corners with a square seam. Not seen: the
  first Remove on a real add-on sheet (the Demo lists no add-on — injected cascade readout: 32px high, 0 10px padding,
  10px corner; the confirm Remove identical to Keep it), the Session-info switch (needs a connection/add-on — injected
  readout 999px at 30×18), Setup's pill (the Setup chunk loads only on first launch — source test asserts 999px), and a
  real `.ld-who` (the Demo presence draws none — labelled injected cascade: hidden at bar 318, shown at 1440). Step 6: the
  inert `.lf-x-act-bar > .lc-grow` rule deleted with `findingFoot` unmoved (82/31/0); the two findings comments now say
  what happens (the buttons go under the hint), intro.css says 18px, the doubled blank lines and the orphaned comment are
  gone. A panel closing beside the thread at 1440 is still a card for its fade (radius 14px, ring, `lc-panel-out`,
  detached by ~250ms) — step 2's STOP holds. The commit also carries the audit's measure-script update and the L13 plan
  files; the notes themselves follow in the record commit below (a commit cannot name its own hash). Left for the owner,
  as L13's "Not in this plan" lists: the unreachable two-pane rules, eight inner corners 1–2px off concentric,
  `.lc-ship-morph`'s 1px, the unproven-dead L11 leftovers, and the rail overrun while closing.

## Final pass (2026-11-20, after L13)

- `npm run typecheck` 0, `npm run build` 0 (the pre-existing chunk-size warning only).
- `engine/test/layout-rules.test.ts` 48/48, `engine/test/face-change.test.ts` 2/2, `engine/test/panels.test.ts` 29/29.
- Full `npm test` on the settling machine: 1465/1477 — twelve failures, all in the known timing-sensitive families
  (antigravity, audit-codex-acp, outside, owners, polish-features, polish-providers, providers, security-checks, sidekick),
  run while the 1-minute load average was 7–19. Isolation protocol: seven of the nine files pass alone on the first try;
  antigravity 53/53 and owners 5/5 on a second alone run (both are documented load flakes); desktop separately 49/49,
  0 skipped, at load 2.2. Every failure resolved in isolation; the work since the audit is UI CSS, one TSX attribute and
  source tests — `engine/src`, `desktop/src` and `contracts/src` untouched — so these are load flakes, not regressions.
- Measure record: `/tmp/layout-before.json` (baseline at `125db4f`), per-plan `/tmp/layout-L01.json` … `/tmp/layout-L06.json`,
  `/tmp/layout-l13-before.json`, `/tmp/layout-L13.json` (the executor's clean run) and the orchestrator's settled-probe
  readouts; copies in the orchestrator's scratch dir. The advisor's audit of L01–L12 is above; L13's four keys are at
  target and no other measured key moved.
