# Liner Code site: design record

## Brief

- **Subject:** Liner Code 0.2.1 (alpha), a free, MIT-licensed desktop app for macOS (Apple Silicon)
  and Windows (x64) that drives the coding agents already on the machine (Claude Code, Codex,
  OpenCode, Hermes) and shows their work as plans, cards and diffs.
- **Audience:** developers who already use one of those CLIs.
- **Job:** download the alpha (GitHub Releases), or read the code (GitHub).
- **Assets that exist:** the app icon (two offset L strokes, ink and blue), the app's fonts
  (Instrument Sans, Geist Mono), Liner 2.0 tokens, the ad stills in `../ads` (0.1.2 real captures;
  0.2.0/0.2.1 drawn in HTML from the app's look), the README, the changelog, the source itself.
- **Owner's reference:** a poster with a giant cream word on the curved horizon of a field of
  concentric blue and cream rings, a tiny figure at the centre, under a deep ultramarine sky. The
  field here is a sea of code that moves and answers clicks.

## Inventory (things only Liner Code has)

1. Its source: `route.ts` scores a message from its words, on the Mac, with no model call.
2. The two-stroke mark: two Ls, one ink and one blue, side by side (a writer and a checker).
3. "Every turn is a diff you can undo": Undo turn, Commit.
4. One red main button (the app's Send, `oklch(0.6 0.215 27)`).
5. The ⌘⇧ keys of its surfaces: B Browser, E Design, T Terminal, F Files, D Diff, P Pull request,
   M Device, R Routines.
6. Three modes: Solo, Plan then build, Auto; Auto's levels Standard, High, Max.
7. Three releases in three days: 0.1.9 on 2 Nov, 0.2.0 on 3 Nov, 0.2.1 on 4 Nov 2026.
8. No server, no telemetry: it asks each tool only `claude auth status`, `codex login status`.
9. Text comes into focus (Liner motion), springs never overshoot.
10. Everything on the Mac lives in `~/.liner-code`.

## Concepts

| | A. The sea of code (owner's image + material) | B. Two lines (name, mark) | C. One turn (process) |
|---|---|---|---|
| Idea | You stand still in the middle; the code moves around you in rings, and each message is a ripple that rewrites what it passes | Two parallel strokes run through the whole page: the one that writes and the one that checks | The page is a single session turn: ask, it asks back, approve, diff |
| Signature | Click the sea: a ripple rewrites the rings it crosses; Undo turn pulls it back | Two lines draw and split at each section | The page scrolls as a timeline |
| O/F/Fe/P | 5 / 5 / 4 / 1 | 3 / 4 / 5 / 3 | 3 / 4 / 4 / 4 |

Pick **A**: the owner asked for it, and the rings are made of Liner Code's real source, so it
cannot move to another product. From B: the mark and the page transition (two strokes). From C:
the "how it works" section is one turn told as call and response.

## Concept card

```
Idea:        You stand in the middle of your code. Every message is a ripple that rewrites what it passes, and you can take it back.
Metaphor:    A still figure in a field of concentric rings; each ring is a real line of Liner Code's source.
Signature:   Click or tap the sea: a ripple spreads from that point, scrambles each line as it crosses and leaves it rewritten.
             "Undo turn" pulls the ripple back to where it started and the old lines return. The diff count is real (lines rewritten).
Emotion:     calm, vast, in control.
Motion verb: ripple out and settle; text comes into focus.
Screenshot:  the cream wordmark sitting on the curved horizon of blue code rings, a tiny figure at the centre, one ripple mid-way.
```

## Art direction

Taste draw: `product-performs` (seed 1393711241). Adopted: the idea (true working fragments of
the product), the section blueprints. Overridden with reasons:
- **Hero:** the owner's poster (the sea), not "column on one line".
- **Type:** `--keep type`. Instrument Sans is the app's own face (the direction asks the marketing
  type to match the interface). Geist Mono only for real code (the sea, commands).
- **Palette:** dealt proportions (one ground, one ink, one accent), colours from the subject: the
  owner's ultramarine sky and cream ground, the app's red for the main action.

### Palette

| Role | Name | Hex |
|---|---|---|
| ground | paper (the sea's cream) | `#F4EBDC` |
| ground step | paper-2 | `#E9DFCC` |
| ink | night | `#0B0E1C` |
| muted (AA on paper) | slate | `#4F4C47` |
| field / accent | sky (ultramarine) | `#0B33B4` |
| code | tide (glyph blue) | `#2557E3` |
| action | send red | `#E0412F` (only the app's own main buttons) |

### Type

- Instrument Sans (variable, OFL): display 700, tracking -0.045em at mega, -0.03em at head,
  leading 0.86/0.98; text 400/500, leading 1.5.
- Steps: mega `clamp(5.2rem, 18vw, 23rem)`, head `clamp(2.25rem, 1.2rem + 4vw, 4.75rem)`,
  lead `clamp(1.375rem, 1.05rem + 1.1vw, 2.25rem)`, body `clamp(1.0625rem, 1rem + .25vw, 1.1875rem)`,
  small `.875rem`. Interface fragments keep their true 12.5 to 14px inside `[data-ui]`.

### Grid, shape, motion

- 12 columns, margins `clamp(16px, 2.4vw, 36px)`, gutter `clamp(12px, 1.4vw, 24px)`.
  Sections 160 to 220px apart on desktop, 96 to 120 on phones.
- One radius rule: page panels square; every button a pill (the app's main button shape).
  Fragments keep the app's own radii (9/11/12px).
- Ease: `expo.out` for travel, Liner's `cubic-bezier(.22,1,.36,1)` for UI. Text comes into focus
  (blur 6px to 0, 18px rise), 40ms between words. Big things move slower than small ones.
- One clock: GSAP's ticker drives Lenis, ScrollTrigger and the sea.

### Sections (argument)

| Section | Claim | Proof | Layout family |
|---|---|---|---|
| Hero | A home for your coding agents | the name on the sea; Download | poster, full bleed GL |
| Intro | It runs your tools and shows their work as GUI | statement with inline crops of real cards | centred statement |
| How | One turn, from ask to diff | working fragments: question card, plan card, diff | call and response column |
| Auto | Each message gets the least work it needs | `route.ts` itself, typed live | headline you can type |
| Surfaces | Everything beside the session, one key away | the real ⌘⇧ keys | giant command list |
| Data | Nothing in between | the only two commands it asks | ink field split |
| New | Three releases in three days | the changelog | release tabs, banded |
| Download | Get the alpha | the real files and the first-open step | sky field, dialog |
| Footer | the name returns, on the sea | tiles + a live horizon tile | tiles |

```
HERO            ┌──────────────────────────────────────────────┐
                │ mark Liner Code    links          Download    │
                │ lead sentence                                 │
                │                                               │
                │      L I N E R   C O D E  (sits on horizon)   │
                │ ~~~~~~~~ curved horizon of code rings ~~~~~~~ │
                │            rings ( ( ( • ) ) )                │
                │ hint                       Changes +0 −0 Undo │
                └──────────────────────────────────────────────┘
INTRO                  statement with [crop] inline [crop]
HOW            col 4..9: sentence / call panel / response fragment ×3, last one wide
AUTO           [ giant input .................. ]▌
               answer rows (weight, pattern, hint)     examples ↙
SURFACES       [ Open a surface            ]
               Browser                              ⌘ ⇧ B
               Design  (accent block + sentence)    ⌘ ⇧ E …
DATA (ink)     big line left                 two commands (code) right
NEW            heading 2 lines           [Read the changelog]
               [0.2.1][0.2.0][0.1.9] | bands: kind · title · note
DOWNLOAD (sky) closing line bottom-left        dialog right (Mac | Windows)
FOOTER         tiles: statement | nav | version | GitHub
               [ live horizon with the wordmark ............ ][ Get the alpha ↗ ]
```

### Genericness test

- A generic model would put a dark hero with a glowing terminal. Here: a cream and ultramarine
  poster with the product's own source as the landscape.
- A generic model would use three feature cards. Here: working fragments and the real command list.
- A generic model would claim speed and savings in numbers. Here: no numbers that are not true.

## Changes after the owner's review (4 Nov 2026)

- "Three releases in three days" became **Features in Liner Code**: the Desk, Designs, Pull
  requests, Add-ons, each with a real picture of the app. The 0.2.1 add-on "ideas" picture is gone.
- The statement's screenshot crops became the app's own parts at type size (Approve, a picked
  answer, +3 −1). Every fragment is re-toned into the page's paper and ink: surfaces stepped in
  tone, no white boxes, no rings.
- The wordmark sinks deeper: about a quarter of its letters sit under the horizon.

## Inspector results we keep on purpose

- `covered-text`: the wordmark lies under the sea. That is the concept and the owner's request.
- `palette-cream`: the cream ground is the owner's reference picture.
- `pinned-over-picture`: the hero's lead sits on the sky over the canvas and fades in the first
  16% of the hero's scroll.
- `no-footage`: the moving picture is the live sea itself.
