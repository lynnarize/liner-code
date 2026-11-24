# Plan 033: Every quiet place in the app is one of three shapes

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If anything in "STOP conditions" happens, stop and
> report — do not improvise. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3e5bf0a..HEAD -- ui/src/app/app.css ui/src/app/surfaces.css ui/src/app/security/security.css ui/src/app/wall.css ui/src/app/crew.css ui/src/app/models.css ui/src/app/design/design-face.css ui/src/app/design/inspector.css ui/src/app/design/build.css`
> If any changed, compare the excerpts below against the live code first; a mismatch is a STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (but see "Shared files" if 032 is running)
- **Category**: tech-debt (one look)
- **Planned at**: commit `3e5bf0a`, 2026-11-22

## Why this matters

The app has 30 different classes for "there is nothing here yet" — 84 `className` sites, counted
with the command in Step 1 at `3e5bf0a`. Several centre a block with a bold lead, several are a
bare quiet line, one is a 15px headline 10vh down, and Security's carries a 12.5px size the
stylesheet's own rule forbids. The person using the app meets
these places at every dead end — an empty project, a missing search result, a scan with no findings
— and they do not read as one product. Every new page invents another one, which is how the count
reached 28.

The fix is not one component everywhere: a whole pane and a one-line "no file matches that" are
genuinely different. It is **three named shapes**, each shared, with every existing site mapped to
one of them. The shapes already exist in the sheet; this plan names them, moves the stragglers onto
them, and adds a test that stops a 29th.

## Current state

The three shapes as they exist today.

**The area** — `ui/src/app/app.css:4489-4510` (the whole-body state; 7 call sites):

```css
.lc-panel-empty {
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 8px;
  flex: 1;
  padding: 24px 40px 80px;
  text-align: center;
  color: var(--l-ink-3);
  font-size: 13px;
  line-height: 19px;
}
.lc-panel-empty b { color: var(--l-ink); font-size: 14px; font-weight: 600; }
.lc-panel-empty p { max-width: 300px; margin: 0; }
```

The Wall's own copy of it, with an icon and a button — `ui/src/app/wall.css:64-88`
(`.lc-wall-empty`: grid, centred, `min-height: 360px`, `> svg` in `--l-ink-4`, `> b` at 13/400,
`> span` at 13 in `--l-ink-3`, `> .lc-btn` with `margin-top: 4px`).

Design's inspector copy — `ui/src/app/design/inspector.css:480-500` (`.ld-insp-empty`: same grid,
`padding: 24px 28px 80px`, `> svg`, `> b` 13).

**The section** — Security's, 12 call sites, `ui/src/app/security/security.css:437-451`:

```css
.ls-none {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 26px 0 18px;
  font-size: 12.5px;
  color: var(--l-ink-3);
  text-align: center;
}
.ls-none b { font-size: 13.5px; font-weight: 500; color: var(--l-ink); }
```

**The line** — five near-identical quiet lines inside lists:

- `ui/src/app/models.css:184-187` — `.lc-mp-none { margin: 10px; font-size: 13px; }` (9 sites: the model picker)
- `ui/src/app/surfaces.css:1198-1202` — `.lc-files-none { display: block; margin: 10px 8px; font-size: 13px; }` (4)
- `ui/src/app/crew.css:681-684` — `.lc-cr-none { font-size: 12px; color: var(--l-ink-3); }` (5)
- `ui/src/app/app.css:7522-7526` — `.lc-qp-none { margin: 0; padding: 6px 9px; font-size: 13px; }` (2)
- `ui/src/app/surfaces.css:3796-3800` — `.lc-st-none { margin: 0; padding: 16px 0; font-size: 13px; }` (7)

The full inventory, so nothing is missed. **Re-derive it yourself at the start** (the command is in
Step 1) — this list was taken at `3e5bf0a` and a page may have gained one since:

| Shape | Classes (call sites at `3e5bf0a`) |
|---|---|
| area | `lc-panel-empty` (7), `lc-wall-empty` (2), `ld-insp-empty` (2), `lc-sc-empty` (2), `lc-ao-empty` (1) |
| section | `ls-none` (12), `ls-side-none` (4), `ld-bt-empty` (3), `lc-reg-none` (2), `lc-limits-none` (2), `lc-rt-empty` (1), `lc-pr-none` (1), `lc-cost-none` (1), `lc-carry-none` (1), `lc-appmodel-none` (1), `lc-st-empty` (1), `lc-sb-none` (1), `lc-sb-empty` (1), `lc-pk-none` (1), `lc-dm-none` (1), `lc-cr-empty` (1) |
| line | `lc-mp-none` (9), `lc-st-none` (7), `lc-cr-none` (5), `lc-files-none` (4), `lc-qp-none` (2), `ld-none` (3) |

Repo conventions that apply:

- **Never run a formatter.** Hand-formatted, long lines. Do not re-wrap anything you did not change.
- **New CSS goes in place.** Replace a rule; never append an override block at the end of a file.
- **Comments are plain sentences that say why**, in the style of the sheet. When a rule changes,
  fix the comment above it in the same edit.
- **Every fix comes with a test that fails without it.** For CSS that is a source test in
  `engine/test/layout-rules.test.ts`; read its `sheet`, `blocks` and `value` helpers at the top of
  the file before writing one.
- The type rule the sheet states at `ui/src/app/app.css:12`: *"open letters at whole-pixel sizes, so
  strokes fill their pixels"*. 12.5px breaks it; that is one reason Security's state is in scope.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Build the UI | `npm run build` | exit 0 |
| Layout source tests | `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/layout-rules.test.ts` | all pass |
| Inventory | see Step 1 | a list of classes and counts |

## Scope

**In scope**

- `ui/src/app/app.css` — the shared shapes live here, beside `.lc-panel-empty`
- `ui/src/app/surfaces.css`, `ui/src/app/models.css`, `ui/src/app/wall.css`,
  `ui/src/app/crew.css`, `ui/src/app/security/security.css`,
  `ui/src/app/design/design-face.css`, `ui/src/app/design/inspector.css`,
  `ui/src/app/design/build.css` — the local copies, deleted or reduced to what is genuinely local
- `ui/src/app/*.tsx` and `ui/src/app/{security,design}/*.tsx` — only the `className` that names a
  replaced class
- `engine/test/layout-rules.test.ts` — the new assertions

**Out of scope**

- `ui/src/liner/**` (vendored). Its own components may hold empty states; leave them.
- Loading states: `l-shimmer` (52 uses) and `.lc-diff-wait` (9) already do this job. Do not fold
  loading into these classes; that was considered and rejected (see `plans/README.md`).
- Error states: 017 already made a failed read say so, with `role="alert"` and "Look again". Those
  keep their own markup.
- Routines (`Routines.tsx`, `RoutineBuilder.tsx`), `mac/`, the Demo provider, `CHANGELOG.md`.

## Git workflow

One commit. Message: `Every quiet place in the app is one of three shapes`. Never push.

## Steps

### Step 1: Inventory, and write the test first

Derive the live list:

```bash
cd ui/src/app && grep -rn --include=*.tsx -o 'className="[^"]*"' . \
  | grep -oE '(lc|ls|ld|lo)-[a-z0-9-]*(none|empty)' | sort | uniq -c | sort -rn
```

Compare it with the table in "Current state". If a class appears that is not in the table, add it
to the shape you judge it belongs to and record the reason in the commit note. If one is missing, a
page was fixed since `3e5bf0a` — carry on.

Then add the tests to `engine/test/layout-rules.test.ts`, **before** the CSS changes, and run them
to see them fail for the stated reason:

1. "The app has one area state, one section state and one line state" — `blocks(sheet("app.css"), ".lc-panel-empty")`,
   `".lc-none"` and `".lc-none-line"` each has exactly one block, and each sets `display: grid` (area,
   section) or neither `display` nor a centred layout (line).
2. "A state is set in whole pixels" — no block whose selector includes `none`/`empty` sets a
   `font-size` with a fraction, across the in-scope sheets.
3. "No page keeps a private empty state" — after the migration, the only `*-none`/`*-empty`
   selectors left in the in-scope sheets are the three shared ones plus the allow-list this plan
   leaves behind (a page-specific state that genuinely carries its own furniture, such as the Wall's
   icon and button). Write the allow-list as an explicit array in the test, with one comment saying
   why each is allowed.

**Verify**: `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/layout-rules.test.ts`
→ three failures, each naming the missing class or the fractional size.

### Step 2: Write the two missing shared shapes

In `ui/src/app/app.css`, directly below `.lc-panel-empty` (line 4489), add — in the sheet's own
voice, with a comment above them:

```css
/* A page's quiet place, when the pane is not the whole body: centred, its lead in the ink, one
   quiet line under it. Security's pages and Design's panels both used their own copy of this. */
.lc-none { display: grid; justify-items: center; gap: 6px; padding: 26px 0 18px; text-align: center; color: var(--l-ink-3); font-size: 13px; line-height: 19px; }
.lc-none b { color: var(--l-ink); font-size: 13px; font-weight: 500; }
/* The quietest: one line inside a list or under a heading, where a centred block would read as a
   page of its own. Its margin is the list's own, so it lines up with the rows it sits among. */
.lc-none-line { font-size: 13px; color: var(--l-ink-3); }
```

The area keeps its existing name and values (`.lc-panel-empty`), because 7 call sites and a test
already read it.

**Verify**: `npm run build` → 0; the first new test passes.

### Step 3: Move Security onto the section shape

Replace `.ls-none`'s uses with `.lc-none` in `ui/src/app/security/*.tsx` (12 sites: `Projects.tsx`,
`StartScan.tsx`, `Overview.tsx`, `Findings.tsx` ×5, `FoundPanel.tsx` ×3), and delete the `.ls-none`
and `.ls-none b` rules from `security.css`. `.ls-side-none` (4) and `ls-card lo-empty` (3) are
Security's own card states with their own furniture — leave them, and list them in the test's
allow-list with a comment.

**Verify**: `grep -rn "ls-none" ui/src/app/security/` → no matches outside the sheet's deleted rule;
`npm run build` → 0.

### Step 4: Move Design onto the three shapes

- `ld-insp-empty` → `.lc-panel-empty` (it is the inspector's whole body), keeping Design's own
  `padding: 24px 28px 80px` as a one-line rule if the shared padding is wrong there.
- `ld-bt-empty` (Build tab) → `.lc-none`, keeping its 16px padding only if the shared one crowds it.
- `ld-none` (3) → `.lc-none-line`.

**Verify**: `grep -rn "ld-insp-empty\|ld-bt-empty\|ld-none" ui/src/app/design/` → no matches in
`*.tsx`; `npm run build` → 0.

### Step 5: Move the quiet lines onto the line shape

`lc-mp-none` (9), `lc-st-none` (7), `lc-cr-none` (5), `lc-files-none` (4), `lc-qp-none` (2) →
`.lc-none-line` plus, where the list needs it, one local rule for the margin only. Delete the old
classes. Keep `.lc-quiet` where it is used for colour — it is not an empty state.

**Verify**: `grep -rn "lc-mp-none\|lc-st-none\|lc-cr-none\|lc-files-none\|lc-qp-none" ui/src/app/`
→ only the deleted rules' history; `npm run build` → 0.

### Step 6: The Wall's area keeps its furniture, on the shared base

`.lc-wall-empty` → `.lc-panel-empty` plus a Wall-only rule for `min-height: 360px`, the icon's
colour and the button's `margin-top`. Delete the duplicated grid/gap/centring from `wall.css`.

**Verify**: `npm run build` → 0; the third new test passes with the Wall in its allow-list or with
the class gone.

### Step 7: The one-offs

Work through what remains from the inventory (`lc-reg-none`, `lc-limits-none`, `lc-sc-empty`,
`lc-rt-empty`, `lc-pr-none`, `lc-cost-none`, `lc-carry-none`, `lc-appmodel-none`, `lc-ao-empty`,
`lc-st-empty`, `lc-sb-none`, `lc-sb-empty`, `lc-pk-none`, `lc-dm-none`, `lc-cr-empty`). Each takes
one of the three shapes. `lc-sc-empty` (Start a scan's centred 15px lead) is an area; the rest are a
section or a line by where they sit.

**Verify**: the inventory command now returns only `.lc-panel-empty`, `.lc-none`, `.lc-none-line`,
and the allow-listed classes; `npm run build` → 0.

## Test plan

- Three source tests in `engine/test/layout-rules.test.ts`, written first and seen red, following the
  file's existing helper style (e.g. "A finding's footer wraps instead of spilling out of a narrow
  panel").
- No DOM tests: the UI has no test environment. Say in the commit note that the shapes were **not
  seen on screen**, or look at the four biggest ones (the Wall empty, Security's Findings with no
  findings, Files with no match, the model picker's "no model matches") and say you did.

**Verify**: `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/layout-rules.test.ts`
→ all pass, including the three new names.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` exits 0
- [ ] The layout source tests pass, with three new full-sentence test names
- [ ] `grep -rn --include=*.tsx -o 'className="[^"]*"' ui/src/app | grep -oE '(lc|ls|ld|lo)-[a-z0-9-]*(none|empty)' | sort -u`
      returns only `lc-panel-empty`, `lc-none`, `lc-none-line` and the classes the new test's
      allow-list names
- [ ] No fractional `font-size` remains on any of those classes in the in-scope sheets
- [ ] `git status` shows no file outside the scope list
- [ ] This plan's row in `plans/README.md` is DONE (or BLOCKED with the reason)

## STOP conditions

Stop and report if:

- A site needs a fourth shape (an icon-led line, a two-button block in a 22px row). Report the site
  and its measurements; do not invent a fourth class.
- Moving a site onto `.lc-none` visibly changes its column's height in a way that breaks a layout its
  test pins (e.g. the Findings page's fixed footer). Name the test and the site.
- `.lc-panel-empty` turns out to have call sites that are not whole-body states (a `flex: 1` block
  inside a card). Report them instead of forcing them.

## Maintenance notes

- The three shapes are the reference for every new page: whole body → `.lc-panel-empty`; a block in
  a page → `.lc-none`; a line in a list → `.lc-none-line`. The new test fails on a private class,
  which is the point.
- Allow-listed states (the Wall's, Security's cards, Design's) stay because they carry real
  furniture. If one later loses its icon or button, move it onto the shared shape and delete the
  allowance.
- Files change is broad but mechanical: a reviewer should check that no `className` edit changed
  more than the state class, and that no rule was appended at the end of a sheet.
