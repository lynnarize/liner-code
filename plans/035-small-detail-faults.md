# Plan 035: The last of the small detail faults

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If anything in "STOP conditions" happens, stop and
> report — do not improvise. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3e5bf0a..HEAD -- ui/src/app/app.css ui/src/app/security/findings.css ui/src/app/security/scan.css ui/src/app/security/overview.css ui/src/app/security/security.css`
> If any changed, check the excerpts below against the live code; a mismatch is a STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 033 (it moves Security's empty state off 12.5px), 034 (it owns every control height)
- **Category**: tech-debt (detail)
- **Planned at**: commit `3e5bf0a`, 2026-11-22

## Why this matters

Three small faults survived the 22 November "one look everywhere" pass. Each is a few lines; none
is worth its own plan; together they are the difference between "polished" and "almost".

1. **A dead pill.** `.lc-pill` and its two tone rules are still in `app.css`, and nothing renders
   them. The 22 November change replaced the pill with `.lc-badge` and left the old rules behind.
2. **Security's type is soft.** The sheet's own rule (`app.css:12`) is "open letters at whole-pixel
   sizes, so strokes fill their pixels". Liner Security has **37 declarations at 11.5, 12.5, 13.5 or
   14.5px**, so its text sits between pixels and reads slightly blurrier than the rest of the app.
3. **A dialog's buttons sit 2px from its edge.** The app makes a Liner frame "its card alone"
   (`app.css:121-123`) and pads the frame with nothing (`--l-frame-pad: 0px`, `app.css:119`). Liner's
   dialog puts its actions in a strip *below* the card (`ui/src/liner/components/dialog/dialog.css:136-140`,
   `padding: 6px 6px 2px`), so with no frame padding the strip's 2px is all the room the buttons get.

## Current state

**1. The dead pill** — `ui/src/app/app.css:509-524`:

```css
.lc-pill {
  flex: none;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--l-wash-2);
  font-size: 12px;
  font-weight: 500;
  color: var(--l-ink-2);
}
.lc-pill[data-tone="ok"] { background: var(--lc-add); color: var(--l-ok-text); }
.lc-pill[data-tone="danger"] { background: var(--lc-del); color: var(--l-danger-text); }
```

`grep -rn "lc-pill" ui/src --include=*.tsx` → no matches (checked at `3e5bf0a`).

**2. Security's fractional sizes** — counted at `3e5bf0a`:

| Size | Declarations | Files |
|---|---|---|
| 11.5px | 3 | `security/security.css`, `security/findings.css`, `security/scan.css` |
| 12.5px | 18 | mostly `security/findings.css`, `security/overview.css` |
| 13.5px | 14 | mostly `security/findings.css` |
| 14.5px | 2 | `security/security.css` |

The app's whole-pixel sizes are 11, 12, 13, 14, 15 (`app.css` uses 13 for body, 12 for quiet
labels, 14 for a lead). Security's neighbours are those.

**3. The dialog strip** — `ui/src/app/app.css:116-120`, then `:121-142`:

```css
  --l-frame-pad: 0px;
}
/* Liner's frames lose their glass and rim: a frame is its card alone, ... */
.l-frame { box-shadow: none; }
```

and `ui/src/liner/components/dialog/dialog.css:136-140`:

```css
.l-dialog__actions {
  justify-content: flex-end;
  gap: 6px;
  padding: 6px 6px 2px;
}
```

In `dialog.tsx` the strip is a sibling of `.l-dialog__card`, both inside `.l-dialog__frame.l-frame.l-frame-float`; the
card carries its own `padding: 22px 22px 20px`, the strip carries none but its own. With
`--l-frame-pad: 0`, the strip is the last thing in the dialog, 2px above its edge.

Repo conventions that apply:

- **Never run a formatter.** Hand-formatted, long lines; do not re-wrap what you did not change.
- **New CSS goes in place**; never append an override block. Overriding a Liner class from `app.css`
  is normal here (`app.css:121-142` does exactly that for frames) — put the dialog rule beside them.
- **Do not touch `ui/src/liner/**`.** It is a copy of a separate library; the fix belongs in
  `app.css`, or upstream in Liner UI and then `npm run sync-liner`.
- **Comments are plain sentences that say why**, in the sheet's voice.
- **Every fix comes with a test that fails without it** — a source test in
  `engine/test/layout-rules.test.ts` for each of the three.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Build the UI | `npm run build` | exit 0 |
| Layout source tests | `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/layout-rules.test.ts` | all pass |

## Scope

**In scope**

- `ui/src/app/app.css` — the pill, and the dialog actions' room
- `ui/src/app/security/security.css`, `overview.css`, `findings.css`, `scan.css` — type sizes only
- `engine/test/layout-rules.test.ts`

**Out of scope**

- `ui/src/liner/**` — vendored. If the right fix is Liner's own `padding`, STOP and report; it goes
  upstream and then through `npm run sync-liner`, which is a separate change.
- Any other type in Security: weights, colours, line heights. Sizes only.
- Any control height (034 owns those), any empty state (033 owns those).
- Routines, `mac/`, the Demo provider, `CHANGELOG.md`.

## Git workflow

One commit per item (three commits), messages in the repo's voice:
`Nothing renders the old pill, so its rules are gone`;
`Liner Security's text sits on whole pixels like the rest of the app`;
`A dialog's buttons keep the card's room under them`.
Never push.

## Steps

### Step 1: Delete the dead pill

Delete `.lc-pill`, `.lc-pill[data-tone="ok"]` and `.lc-pill[data-tone="danger"]` from `app.css:509-524`.
Write the test first and see it fail: "Nothing renders a pill, so its rules are gone" —
`assert.ok(!sheet("app.css").includes(".lc-pill"))`, with a comment saying the 22 November change
replaced it with `.lc-badge` (`app.css:496-508`).

**Verify**: `grep -rn "lc-pill" ui/src` → no matches; the new test passes; `npm run build` → 0.

### Step 2: Security's type lands on whole pixels

Write the test first and see it fail: "Liner Security sets its text in whole pixels" — for each of
`security/security.css`, `security/overview.css`, `security/findings.css` and `security/scan.css`,
`!/font-size:\s*\d+\.\d+px/.test(sheet(file))`, with a comment pointing at the rule in `app.css:12`.

Then replace every fractional size, rounding **down** so nothing gets wider:

| From | To |
|---|---|
| 11.5px | 11px |
| 12.5px | 12px |
| 13.5px | 13px |
| 14.5px | 14px |

Do this by hand, one declaration at a time. Do not run a formatter or a search-and-replace across
the whole sheet: three of these are `font-size` inside a `clamp()` or `font:` shorthand if the grep
shows any such line — those are a STOP (see below).

**Verify**: `grep -rn "font-size: *1[1-4]\.5px" ui/src/app/security/` → no matches; the new test
passes; `npm run build` → 0. Look at one Findings page and one Overview and say in the commit note
whether any label wrapped at the new size.

### Step 3: The dialog's actions keep their room

First look at one dialog (Settings › Projects › Remove a project, or any confirm) and measure the
gap under its buttons. If the buttons already sit about 22px from the dialog's bottom edge — the
same inset as the card — then the fault is not real at this commit: mark this step REJECTED in the
commit note and skip it.

If they sit tight, add one rule in `app.css` beside the frame rules (`app.css:142`), in their voice:

```css
/* Liner puts a dialog's actions on the glass below its card; the app's frame has no glass to stand
   on, so the strip keeps the card's own side and foot room instead of 2px of its own. */
.l-dialog__actions {
  padding: 6px 22px 20px;
}
```

Numbers: `22px` matches `.l-dialog__card`'s side padding (`dialog.css:64`), `20px` its foot. If the
look says otherwise, use the measured numbers and say so in the commit note.

Write the test first: "A dialog's actions keep the card's room under them" — one block for
`.l-dialog__actions` in `app.css`, `value(block, "padding") === "6px 22px 20px"`.

**Verify**: the new test passes; `npm run build` → 0; look at the same dialog again.

## Test plan

Three source tests in `engine/test/layout-rules.test.ts`, written first and seen red, following the
file's existing style. (If Step 3 is rejected, two tests.)

**Verify**: `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/layout-rules.test.ts`
→ all pass, including the new names.

## Done criteria

- [ ] `grep -rn "lc-pill" ui/src` → no matches
- [ ] `grep -rn "font-size: *[0-9]*\.[0-9]px" ui/src/app/security/` → no matches
- [ ] `.l-dialog__actions` has one block in `app.css`, or the step is recorded as rejected with the
      measurement that rejected it
- [ ] `npm run typecheck` exits 0, `npm run build` exits 0, the layout tests pass
- [ ] `git status` shows no file outside the scope list
- [ ] This plan's row in `plans/README.md` is DONE (or BLOCKED with the reason)

## STOP conditions

Stop and report if:

- A fractional size is inside a `font:` shorthand, a `clamp()` or a `calc()` — rounding it down by
  hand would change the declaration's shape. Name the line; do not restructure it.
- Deleting `.lc-pill` leaves an empty comment above it that described only the pill; fix the comment
  in the same edit, and if the comment also describes `.lc-badge`, keep it.
- The dialog's actions turn out to be styled by another app rule you did not find, so the new rule
  would fight it. Report the rule and stop.
- `ui/src/liner` needs the change to be correct (the strip's padding is Liner's own component
  contract). Report it as an upstream change; do not edit the copy.

## Maintenance notes

- Liner Security was designed before the whole-pixel rule reached it. Anyone adding a size there
  copies 11/12/13/14, not 12.5.
- The dialog rule is the app's second override of a Liner component's internals (after the frame).
  If Liner UI later gives dialogs their own foot room, delete this rule and note it in
  `scripts/sync-liner.sh`'s record.
- A reviewer should check that Step 2 touched only `font-size`, and that nothing was appended at the
  end of a sheet.
