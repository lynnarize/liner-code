---
name: liner-2
description: Liner 2.0, Liner Code's own look, for anything an agent makes inside Liner Code (a panel in the dock, a tab beside Chat, a page from the left sidebar). Read it before writing an add-on's HTML or CSS, so what you make looks like part of the app and not a web page dropped into it.
---

# Liner 2.0

Liner 2.0 is the look of Liner Code itself: flat, quiet surfaces stepped in tone, one accent, one red
main button, and text that does the work. What you make sits in the app beside its own panels, so draw
it with the app's tokens and parts below. It isn't Liner UI: no glass, no white cards on frosted frames.

## Colour: the tokens, never a hex

- Surfaces, in steps: `--bg` (the window's ground) < `--surface` (the panel's paper; the body is this
  already) < `--well` (a card, a field, a hover) < `--plate` (the picked row, a control that's open).
- Ink: `--ink` text, `--ink-2` quieter text and most controls, `--ink-3` notes, labels and counts,
  `--ink-4` placeholders and empty-state icons. Nothing lighter than `--ink-4`.
- Lines: `--hair` for a hairline or a card's ring (`box-shadow: 0 0 0 1px var(--hair)`), `--line` where
  it must read more. Space separates first, a hairline second; never a border round every box.
- `--accent` is the one accent: focus, links, a switch that's on, a selected tick. Never a fill for
  large areas.
- `--act` with `--act-ink` is the main button's colour, the same as the app's Send. One per view.
- Status only from `--ok`, `--warn`, `--danger`: a 6px dot or the text itself, never a filled banner.
- A tint you need is a mix: `color-mix(in oklch, var(--ink) 6%, transparent)`.

## Type

- `--font` for everything, `--font-display` for headings and big numbers (weight 600,
  letter-spacing -0.02em; -0.035em from 24px up). `--font-mono` at 12px for paths, ids and code.
- Sizes: body 13.5px/1.55, controls and rows 13px, notes 12–12.5px, labels and counts 11.5–12px.
  A panel's heading 14px; a page's title 20–24px. Nothing under 11px.
- Weights 400 and 500; 600 only for headings. Sentence case everywhere, labels too (no uppercase
  with letter spacing). Numbers tabular: `font-variant-numeric: tabular-nums`.

## Shape and space

- Radii: controls 9px, rows 11px, fields and cards 12px, a page's sheet 14px, round buttons 999px.
- Heights: a control 28–30px, a field 32px, the main button 32px, a row 34px on one line and about
  52px with a note under its title.
- Space on a 4px step: 4, 6, 8, 10, 12, 16, 20, 24. A dock panel pads 14–16px; a page 24px.
- A page fills its whole column: html and body at 100%, never a small card centred on a big ground.

## The parts

- **Header**: the name at 14px weight 600, a count beside it in `--ink-3`, actions at the right as
  quiet buttons. 44–52px tall, no fill; a `--hair` line under it only while content scrolls under it.
- **Quiet button** (most buttons): no border, no fill, `--ink-2`, 13px, 28–30px tall, padding 0 8px,
  radius 9px, gap 6px to its icon. Hover fills `--well`, open or pressed fills `--plate`.
- **Main button**: `--act` fill, `--act-ink` text, weight 500, 32px tall, padding 0 14px, radius 999px.
- **Second button**: `--well` fill, `--ink` text, otherwise as the main one.
- **Icon button**: 28px square, radius 9px, the icon at 15px in `--ink-2`, `aria-label` always.
- **Row**: a 16px icon or tick column, then the title (13px, 500, `--ink`) with a note under it
  (12px, `--ink-3`), each on one line with an ellipsis; anything at its end in `--ink-3` 12px. Padding
  8px 9px, radius 11px. Hover `--well`, picked `--plate`. Keep 4px inside a scrolling list's edge so
  a row's focus ring isn't cut.
- **Section label**: 12px, weight 500, `--ink-3`, 8px above what it names.
- **Card**: `--well` fill, or `--surface` with the hair ring; radius 12px; padding 12–16px.
- **Field** (input, search, textarea): `--well` fill, no border, radius 10px, 32px tall, padding 0
  10px, placeholder `--ink-4`.
- **Focus**, on every control: `outline: 2px solid color-mix(in oklch, var(--accent) 60%,
  transparent); outline-offset: 2px`, on `:focus-visible` only.
- **Choice of a few** (tabs, a view switch): a `--well` track with the picked one on a `--surface`
  plate with the hair ring; one plate glides between choices, it doesn't blink.
- **Switch**: 28 by 16, off `--plate`, on `--accent`, the knob `--surface`.
- **Chip**: 22px tall, radius 999px, `--well` fill, 12px `--ink-2`.
- **Divider in a row of controls**: 1px wide, 14px tall, `--hair`, 4px either side.
- **Menu or popover**, the one thing that floats: `--surface`, radius 12px, padding 4px, rows as
  above, `box-shadow: 0 0 0 1px var(--hair), 0 16px 40px -16px color-mix(in oklch, black 45%,
  transparent)`.
- **Empty state**: in the middle of its space, a 20px icon in `--ink-4`, one line of what's missing
  (13px `--ink-2`), one of what to do (12.5px `--ink-3`), then its action as a main or quiet button.
  No illustrations.
- **Icons**: inline SVG on a 24 viewBox, drawn at 13–16px, `stroke: currentColor`, stroke width
  1.75, round caps and joins, no fill. Plain line icons, one colour, never one colour per item.

## Motion

- Ease out without overshoot: `cubic-bezier(0.22, 1, 0.36, 1)`. Hovers change the background only,
  in 140ms. Entrances 220–320ms; exits faster than entrances.
- Text arrives by coming into focus (from `filter: blur(4px); opacity: 0`), never typed out, slid
  in, or with a caret or dots.
- Nothing changes size in one frame: hold room for what loads.
- Under `prefers-reduced-motion: reduce`, no movement: a quick fade at most.

## Light and dark

Both, from the tokens alone; they're applied for you and follow `liner.on("theme")`. Never choose a
colour by reading the theme yourself.

## Words

Plain and specific, sentence case, warm, no exclamation marks. A button says what it does ("New
note", "Send to chat", not "Submit" or "OK"). An error says what happened and what to do next.
Counts in words: "3 notes · Saved". No emoji in place of icons.

## Never

No gradients, glows, glass or blur; no drop shadows but a floating menu's; no coloured icons or
rainbow tags; no uppercase labels; no borders round every box; no fixed colours or fonts of your own;
no small card centred on a page.

## Before you add it

Look at addon_check's picture against this list: tokens only, one main button at most, a header that
matches, rows and fields in the shapes above, sentence case, nothing under 11px, and an empty state
for each list.
