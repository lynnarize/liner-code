# Liner Code site: design record

## Brief

- **Subject:** Liner Code 0.2.1 (an alpha then; a beta since 0.2.4), a free, MIT-licensed desktop
  app for macOS (Apple Silicon) and Windows (x64) that drives the coding agents already on the
  machine (Claude Code, Codex, OpenCode, Hermes) and shows their work as plans, cards and diffs.
- **Audience:** developers who already use one of those CLIs.
- **Job:** download the beta (GitHub Releases), or read the code (GitHub).
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
| Download | Get the beta | the real files and the first-open step | sky field, dialog |
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
               [ live horizon with the wordmark ............ ][ Get the beta ↗ ]
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

## Changes for 0.2.4, the first beta (9 Nov 2026)

- Every "alpha" became "beta" in the same voice: the hero's note, the download menu and dialog,
  the first-open step, the footer's version tile and "Get the beta", Workshop's buttons.
- "Everything around the session" gained four cards for what 0.2.4 brought, each with a "New in
  0.2.4" mark over its title, and the app's own parts drawn at their size from Wall.tsx, Crew.tsx,
  Browser.tsx and AddonsPage.tsx, in their words (no new captures). They take the bento's dark app
  tones (a surface rising from the card's foot, then well, then plate; at night the parts step up
  from the card instead), with greens, reds and ambers lightened to read on them:
  - **The Wall** (across the grid, first): its bar and three tiles, one that needs you (Wants to
    run, Not this, Run it, picked, with its field), one at work (its trail), one done (its brief,
    files, Verified, Settle). Two tiles under 1024px, stacked under 600px.
  - **Who sent whom** (across the grid, after One turn and Surfaces): the words and each tool's
    agents as stepped bands on the left (OpenCode's subagents said to be off), the session on the
    right: the crew chip, the fan-out of the Demo's three agents, the composer's waiting line.
  - **Dev servers from launch.json** and **DeepSeek Harness plugins**, side by side: an agent's
    Started step over the Browser's launch.json list; the plugin's card from npm, sandboxed only
    on a Mac.
- Surfaces' sentence says a live page in the Browser costs about what it costs on its own.
- The changelog page reads a list inside a list item ("  - ", as in 0.2.4's tools), with open dots.

## Changes for the picture-first page (10 Nov 2026)

The owner asked whether the page was good enough to make someone try the app, gave devin.ai as the
example to lean toward, and approved a mockup built in three rounds. What changed, and why:

- **The app is on the first screen.** The old hero showed the name for two and a half screens before
  the sea parted for the window. Now the promise is the headline ("One app for your coding agents"),
  one sentence says what it does, and the window lies on the sea straight under it. The sea is a
  "lay" stage (motion/stage.ts): the end of the old move held still, camera overhead, the sea lying
  along the window's frame. No pin. Clicking the sea still sends a turn, and the turn bar still
  counts it. The wordmark on the horizon stays in the footer's tile.
- **Every claim sits under a piece of the app.** One turn is three steps (an ordered list, no index
  numbers), each a working part on a scene with a line beside it. Everything around the session is
  five pictures with a line under each: Auto (route.ts running), Designs, the Wall, agents at work,
  and the add-on's card. The scene is the sea toned to one blue (sea-above.jpg multiplied with the
  sky), so the dark app never sinks into the night page.
- **The pictures are the current app.** scripts/demo-shots.mjs takes them headlessly at 2x from a
  dev build that can only reach the Demo: the hero's window, Designs, the Wall and the agents are
  Liner Code 0.2.4 on its sample project. They are browser renders, so they carry no traffic lights.
  Each capture is zoomed to the part that matters inside a box the scene frames (.crop).
- **Shorter words.** A headline of one line, one sentence under it, captions that start with a verb
  and leave "Liner Code" unsaid ("Asks before it guesses", "Shows every session on one wall").
- **The cards moved.** The full cards (what 0.2.4 brought, surfaces, the Desk, modes, add-ons) are
  the Features page now (/features/), linked from under the five pictures. The statement is gone:
  the hero's sentence says it.
- **Nothing in between sits beside the download,** where the question comes up, and on a phone the
  dialog offers the link to open on a computer.
- **The star count shows from a hundred up** (Nav.astro). Below that the number argues against the app.
- **No line about the Demo.** 0.2.4 hides the Demo until you tap your name six times, so the page
  can't promise a first run without a sign-in. Showing the Demo on a fresh install with nothing
  connected would make that line true.

## Changes after the owner's look at the build (10 Nov 2026, later)

- **The pictures are smaller, in Devin's proportions:** two, then three, about 400px tall, the
  parts drawn at 84% of their size in the app (full size on a phone). Section titles and captions
  step down (`--t-title`, `--t-cap`) so the pictures lead.
- **No capture is cut through its words.** The first Designs picture was a box whose left edge
  sliced the session's text. Each capture is now cut along an edge the app has: the Wall from its
  own top left corner, running off the scene (`.crop--corner`); the Design panel alone, rising from
  the scene's foot (`.crop--rise`); the agents' column whole, in a box (`.crop--box`).
- **The third step is the Reviewer, not the diff.** A diff you can undo is in every harness; a
  model from another maker reading each change against five fixed criteria is not. The step draws
  the check with the engine's own criteria (engine/src/review.ts, read at build time), one sent
  back once. The title became "One turn, checked before it's yours" and the hero's sentence ends
  on the check.
- **The hero's window is agents at work,** with the Agents panel beside the session, for the same
  reason: it is the picture other harnesses can't show.

## Changes for one look, in Devin Desktop's presentation (10 Nov 2026, third look)

The owner's words: "change every card into screenshot (example devin)", "when in light mode just
use light instead of dark", "background instead of paper brown. change into light. the goal was
make consistent design", "make it style design screenshot, and presentation like devin.ai"
(devin.ai/desktop), and "make it smaller. create a empty space in right and left".

- **Every picture is the app itself.** The parts redrawn in HTML (the question, the plan, the
  check, the router pane) are gone from the home page; each card is a capture of 0.2.4
  (`scripts/demo-shots.mjs`). The live router moved to `/features/#auto`.
- **Each capture exists twice,** light and dark, taken from one app state by two browsers.
  `Shot.astro` puts both in the page and the look shows one: light pictures in the Blue look,
  dark ones at Night. No dark window on a light page any more.
- **The ground is a neutral light** (`--paper: #f8f9fb`), not cream; the sea's paper colour and
  the interface tokens follow it.
- **One column, with the margins left empty.** `--m` is now the page's margin on every page: 96px
  at 1440, 16px on a phone, and the column stops at 1248px, as on Devin Desktop. The nav, the
  download section and the other pages sit in the same column. The footer's tiles still run edge
  to edge.
- **Smaller.** The headline is 46px (was 60), section titles 32, step titles 26, captions 20, the
  closing line 84 (was 131). The hero's card is 1248 by 640 and the window runs off its foot,
  between the agents and the composer; the turn bar sits under the card. Steps are two equal
  columns with a 4:3 picture and the text on the picture's foot line; the cards are two 4:3
  pictures, then three.
- **A scene and a window.** Each picture is a scene (the sea from overhead, out of focus, in the
  look's colours) with the app's window on it: a hairline, a soft shadow, standing in from the top
  and the left and running off the foot. Insets are percentages of the scene, so a window is cut
  at the same place at every width. The session pictures were retaken in a 720px window so their
  text stays readable in a 528px one. Windows wider than their scene (the Wall, Settings,
  Add-ons) run off its right as well; that cut does go through words, the way Devin's does.

## The hero in usemono.dev's manner (10 Nov 2026)

The owner, on the sea of code: "how about making something like this https://www.usemono.dev/".
Mono's page is one black screen with the app as a 12% ghost across it and a soft torch on the
pointer that lights it up. The home page's hero now does that with our own material
(`components/Hero.astro`; the earlier hero, the sea in a card, is `HeroCard.astro`, unused and
kept only until the owner settles).

- **The first screen is the sea at rest:** almost the page's ground (`quiet` 0.94; at night the
  resting sea takes the ground's own colour), thinning out to the page at the hero's foot, so the
  hero has no edge. The pointer carries a lamp (`uLamp`, `uTorch` in sea/shader.ts) that brings
  the code up under it, with a little lag; with no pointer it drifts by itself. A click sends a
  ripple that lights the lines it crosses.
- **The promise is centred, and the app's window rises from the foot of the screen,** whole, the
  sea parted round it, so the product is still on the first screen (Mono shows none of it).
- **Calm water, not a light behind the words.** The first try let the ground through in a soft
  patch behind them; the owner asked for "alternative to improve readability instead of using
  black/white light background" and, of four ways tried on a switch, chose calm water: under the
  words the sea's characters thin out while its bands flow on, and the lamp dims (`uHush`,
  `CALM` in motion/stage.ts). Nothing is painted behind the text.
- **No hint and no turn bar.** The owner: "remove 'click the code to send a turn' and it's button
  (undo turn, changes)". The click still ripples; nothing counts it or undoes it.

## Inspector results we keep on purpose

- `covered-text`: the wordmark lies under the sea. That is the concept and the owner's request.
- `no-footage`: the moving picture is the live sea itself.
- `size-count`: thirteen sizes at 1440. Five steps carry the page (46, 32, 26, 20, 16); the rest are
  the nav, the keys beside a caption, the closing line and the footer's figures and wordmark.
- The lint's remaining hits (monospace for code, the interface fragments' own shadows) are the
  live site's too: the count matches `site/`.

## 11 Nov: the nav slimmed, and Auto became the sidekick

- **Nav** (the user picked option 1 of three, "and drop auto"): four links centred over the headline (How it works, Features, Workshop, Changelog), then one round look button (it shows the look a press turns to), the GitHub mark alone, and Download.
- **Auto is gone from the app** (0.2.5: Lead + sidekick), so the live router on Features is removed with its code and styles, and nothing on the site imports from `engine/` any more.
- The home card is now "Hands the routine work to a sidekick", with a picture of the Demo pair (`demo-shots.mjs sidekick`; the sample project's `src/tides.js` must be as committed first). The third step's picture is Settings, The Reviewer, and the Features card shows Settings, Your pair. All the home page's pictures were then retaken from the 0.2.5 tree at the user's ask, but the question card: the Demo no longer asks a question of its own, so the user had that step dropped: one turn is now two steps, the plan and the check (`shot-question-*.webp` is left in `public/media`, unused). The plan comes from "Show me a plan first". The rig's Wall was tidied by settling the old duplicate sessions.
