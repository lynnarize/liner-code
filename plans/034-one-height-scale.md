# Plan 034: Every control's height comes from one five-step scale

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If anything in "STOP conditions" happens, stop and
> report — do not improvise. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3e5bf0a..HEAD -- ui/src/app/app.css ui/src/app/surfaces.css ui/src/app/models.css ui/src/app/crew.css ui/src/app/settings.css ui/src/app/dock.css`
> If any changed, compare the excerpts below with the live code first; a mismatch is a STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (run after 033 if both are queued — they share `app.css` and `surfaces.css`)
- **Category**: tech-debt (one look)
- **Planned at**: commit `3e5bf0a`, 2026-11-22

## Why this matters

The app's four shared controls already agree on a rhythm: a 28px icon button, a 30px toolbar
button, a 36px button and a 36px field. Everything else picks its own number. At `3e5bf0a` there
are **119 rules with a literal height of 22, 24, 26, 34, 40 or 44px** across the app's 21 sheets —
69 of them in `app.css` and `surfaces.css` alone. A row of controls therefore lines up by luck: two
buttons side by side can be 26 and 30, a field and the button beside it can be 34 and 36.

The stylesheet already does this properly for corners — `--lc-r-row`, `--lc-r-field`, `--lc-r-card`,
`--lc-r-sheet`, four named steps with a comment saying what each is for (`ui/src/app/app.css:27-31`).
Heights never got the same treatment. This plan gives them one, converts the shared controls to it,
and then moves the outliers onto the nearest step **by what the control does**, not by number.

This is the riskiest plan in the 032–035 set: heights move rows. It is deliberately staged so every
batch is small and can be looked at.

## Current state

The four shared controls and their heights, `ui/src/app/app.css`:

```css
.lc-ib   { height: 28px; ... }   /* :393 — an icon button */
.lc-tb   { height: 30px; ... }   /* :424 — a toolbar button */
.lc-btn  { height: 36px; ... }   /* :566 — a button; radius 999px, font 14 */
.lc-input{ height: 36px; ... }   /* :677 — a field; radius 10px, font 14 */
```

The corner scale they sit beside, `app.css:27-31`:

```css
  /* Corners, four sizes: a row or small button, a field, a card or menu, and the paper or a floating sheet. */
  --lc-r-row: 8px;
  --lc-r-field: 10px;
  --lc-r-card: 14px;
  --lc-r-sheet: 18px;
```

The outliers, counted at `3e5bf0a` (`height` or `min-height` set to a literal, per sheet):

| Sheet | 22 | 24 | 26 | 34 | 40 | 44 |
|---|---|---|---|---|---|---|
| `app.css` | 7 | 8 | 8 | 4 | 4 | 3 |
| `surfaces.css` | 5 | 8 | 6 | 8 | 5 | 3 |
| `crew.css` | 3 | 2 | 2 | | 1 | |
| `models.css` | 1 | 3 | 1 | | 1 | 1 |
| `agentic.css` | 2 | | | | | |
| `design/build.css` | 2 | | | | 2 | 1 |
| `design/intro.css` | 1 | | 4 | | | |
| `design/lean-page.css` | | | | | 2 | |
| `security/overview.css` | 1 | | 1 | 1 | | 2 |
| `settings.css` | | | | 1 | 2 | |
| `security/scan.css` | | | | | 1 | 1 |
| `design/design-face.css` | 1 | | | | | |
| `timeline.css`, `wall.css`, `dock.css`, `design/chat.css`, `design/inspector.css`,
  `design.css`, `security/findings.css`, `security/security.css`, `setup.css` | 1–2 each | | | | | |

**Not every literal height is a control.** A 6px progress bar, a 1px hairline, a 360px empty state
and a 44px top row are not controls and must not be touched. Step 1 is what separates them.

Repo conventions that apply:

- **Never run a formatter.** Hand-formatted, long lines; do not re-wrap a line you did not change.
- **New CSS goes in place**, in the rule it corrects — never appended as an override block.
- **Comments are plain sentences that say why**, in the sheet's voice. The corner scale's comment is
  the model to copy.
- **Every fix comes with a test that fails without it.** For CSS, a source test in
  `engine/test/layout-rules.test.ts` (read its `sheet`, `blocks`, `value` helpers first).
- This is the owner's stated priority order (`plans/README.md`): UI polish first. But a *design*
  decision is the owner's: the five steps below are the advisor's proposal, and Step 2 gets it
  approved before Step 4 changes anything visible.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Build the UI | `npm run build` | exit 0 |
| Layout source tests | `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/layout-rules.test.ts` | all pass |

## Scope

**In scope**

- `ui/src/app/app.css` — the tokens, and the four shared controls
- The sheets named in the table above, for their **control** heights only
- `engine/test/layout-rules.test.ts`

**Out of scope**

- Any height that is not a control: progress bars, hairlines, empty states, the top row's 44px
  (`--lc-head`), artwork, the composer's own box.
- Widths, paddings, fonts, colours. This plan moves heights only. (`034` does not restyle type;
  `035` handles Security's fractional sizes.)
- `ui/src/liner/**` (vendored), Routines, `mac/`, the Demo provider, `CHANGELOG.md`.
- `plans/layout/` — its twelve plans are done; its "Not planned" table lists this item as needing a
  decision, which Step 2 records.

## Git workflow

One commit per batch (Steps 3–8), on top of one commit for the tokens and tests (Steps 1–2).
Messages name what is now true, e.g. `The app's controls share one five-step height scale`.
Never push, never amend an earlier batch's commit.

## Steps

### Step 1: Inventory the controls, and write the decision down

```bash
cd ui/src/app && node -e '
const fs=require("fs"),path=require("path");
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
for(const f of walk(".").filter(f=>f.endsWith(".css"))){const t=fs.readFileSync(f,"utf8").replace(/\/\*[\s\S]*?\*\//g,"");
 for(const m of t.matchAll(/([^{}]+)\{([^{}]*)\}/g)){const h=(m[2].match(/(?:^|[;\s])(?:min-)?height:\s*(\d+)px/)||[])[1];
  if(h&&[22,24,26,34,40,44].includes(+h))console.log(f+": "+m[1].trim().replace(/\s+/g," "))}}'
```

For each selector, write one word beside it: **row action** (a 22px icon inside a list row), **icon**
(a lone icon button), **toolbar** (an icon button in a toolbar or a bar), **control** (a text button,
a field, a select), **primary** (a Send / Commit / Start button, the top row), or **not a control**.

Produce a table `selector → kind` and put it in the commit note for Step 2. Any selector you cannot
place is a STOP (see below).

### Step 2: Write the scale, with the owner's yes

Proposed scale — five steps, each with what it is for:

| Token | Value | What it is for |
|---|---|---|
| `--lc-h-row` | 22px | the one small action inside a list row (rename, star, ···) |
| `--lc-h-icon` | 28px | a lone icon button, the app's `.lc-ib` |
| `--lc-h-tool` | 30px | an icon button in a toolbar or a bar, the app's `.lc-tb` |
| `--lc-h-ctl` | 36px | a text button or a field, the app's `.lc-btn` and `.lc-input` |
| `--lc-h-primary` | 44px | the one main action of a place, and the window's top row |

Add to `ui/src/app/app.css` directly under the corner scale (`:31`), in the same voice:

```css
  /* Heights, five steps: the small action in a row, a lone icon, an icon in a bar, a text button or
     a field, and the one main action of a place (or the top row). A control takes the step its job
     names, never a number that looks right beside it. */
  --lc-h-row: 22px;
  --lc-h-icon: 28px;
  --lc-h-tool: 30px;
  --lc-h-ctl: 36px;
  --lc-h-primary: 44px;
```

**Ask the owner to confirm the five steps before continuing** (this is a look, not a bug fix). If they
say no, change the tokens to their answer and continue; the steps' roles stay the same. Record their
answer in the commit note.

**Verify**: `npm run build` → 0.

### Step 3: The four shared controls read the tokens

Replace the literals in `.lc-ib` (`28`), `.lc-tb` (`30`), `.lc-btn` (`36`) and `.lc-input` (`36`)
with `var(--lc-h-icon)`, `var(--lc-h-tool)`, `var(--lc-h-ctl)` and `var(--lc-h-ctl)`. Add the source
test now, before the edit or beside it, and see it fail first:

- "The app's four shared controls take their height from the scale" — each of `.lc-ib`, `.lc-tb`,
  `.lc-btn`, `.lc-input` has exactly one block in `app.css`, and its `height` is the matching `var(...)`.

**Verify**: `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/layout-rules.test.ts`
→ the new test passes; `npm run build` → 0.

### Step 4: `app.css`'s outliers

Work down Step 1's table for `app.css` (34 rules). For each, replace the literal with the token its
kind names. Where a rule sets `height` equal to the token's value already, replace it too, so the
number lives in one place.

Do **not** convert anything Step 1 marked "not a control".

**Verify**: `grep -n "height: 2[246]px\|height: 3[40]px\|height: 44px" ui/src/app/app.css` → no
control hits remain (the top row's `--lc-head: 44px` and non-control heights may stay);
`npm run build` → 0; look at one session, the sidebar, and Settings › General and say in the commit
note what moved.

### Step 5: `surfaces.css`'s outliers

Same treatment for `surfaces.css` (35 rules). This sheet holds the panel's rows, the Changes card and
Session info — all row-dense. One batch, one look at the panel's Session tab and the Changes card.

**Verify**: as Step 4, against `surfaces.css`; `npm run build` → 0.

### Step 6: `models.css`, `crew.css`, `settings.css`, `dock.css`

These four carry 19 between them. `dock.css`'s is the dock strip's own row; `settings.css`'s are its
34px sidebar rows and two 40px fields — a Settings row that changes height moves the whole column's
rhythm, so check Settings › General and one long page (Models) before committing.

**Verify**: `npm run build` → 0; the Step 3 test still passes.

### Step 7: Design's sheets

`design/build.css` (5), `design/intro.css` (5), `design/lean-page.css` (2),
`design/design-face.css` (1), `design/chat.css` (1), `design/inspector.css` (1). Design is its own
face with its own density; the same five steps apply, but if a control needs 32 or 38 to sit right in
Design's own rows, that is a STOP, not a sixth token.

**Verify**: `npm run build` → 0; open Liner Design and look at one row of its top bar.

### Step 8: Security, Setup, Timeline, Wall, Agentic

`security/*.css` (9), `setup.css` (1), `timeline.css` (1), `wall.css` (2), `agentic.css` (2). The
Security pages were designed at three different measures already; do not change a *page's* width or
a *column's* height, only a control's.

**Verify**: the inventory command from Step 1 returns only selectors Step 1 marked "not a control"
(or none); `npm run build` → 0; `npm run typecheck` → 0.

## Test plan

- Two source tests in `engine/test/layout-rules.test.ts`, written first and seen red:
  1. "The app's four shared controls take their height from the scale" (Step 3).
  2. "A control's height is one of the scale's five steps" — for the selectors in Step 1's table,
     every `height`/`min-height` is a `var(--lc-h-*)` or one of `22px 28px 30px 36px 44px`. Keep the
     selector list in the test as an explicit array with the kind beside each, so a later control
     with a new number fails here.
- No DOM tests: the UI has no test environment. Heights were **not seen on screen** unless you looked;
  say which surfaces you looked at in each commit note.

**Verify**: `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/layout-rules.test.ts`
→ all pass, including the two new names.

## Done criteria

- [ ] `--lc-h-row`, `--lc-h-icon`, `--lc-h-tool`, `--lc-h-ctl`, `--lc-h-primary` exist in `app.css`'s
      `:root`, with the why-comment, and the owner's answer is in a commit note
- [ ] `.lc-ib`, `.lc-tb`, `.lc-btn`, `.lc-input` read them
- [ ] `npm run typecheck` exits 0 and `npm run build` exits 0
- [ ] The two new source tests pass
- [ ] The Step 1 inventory returns no control height outside the five steps
- [ ] `git status` shows no file outside the scope list
- [ ] This plan's row in `plans/README.md` is DONE (or BLOCKED with the reason)

## STOP conditions

Stop and report if:

- A control genuinely needs a sixth height (a 32px segmented control in a 30px bar, a 38px field in a
  dense inspector). Report the selector, its neighbours and why the nearest step does not work. Do
  not add a token.
- Converting a height moves a row so that a pinned test fails (e.g. "Commit's bar keeps its controls
  on the composer's row" in `layout-rules.test.ts`). Name the test and the rule.
- A 44px literal turns out to be the top row (`--lc-head`), a dialog's frame, or the composer's box —
  these are not controls; leave them and note them.
- The owner does not answer Step 2. Do Steps 1 and 2's file edit only, mark the plan BLOCKED, and stop.

## Maintenance notes

- New controls take a token, not a number. The Step 3/4 tests are the tripwire.
- `plans/layout/README.md`'s "Not planned" table lists "Text-button and field heights" and "Icon
  buttons in a dozen sizes" as needing a decision. This plan is that decision; when it lands, update
  that table's row to point here instead of leaving it as open.
- A reviewer should check: no width, padding, font or colour changed in the same hunk; no rule
  appended at the end of a sheet; the non-control heights untouched.
