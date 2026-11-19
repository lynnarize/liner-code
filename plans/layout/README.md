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

## Executor notes

(The model that runs the plans fills this in: for each plan `DONE <commit>`, `BLOCKED <one line why>` or `SKIPPED <why>`, and
anything it could not verify.)
