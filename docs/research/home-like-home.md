# Home, next to Claude Code and Devin (14 Nov 2026)

Question: what would make Liner Code's Home and main view feel like home to someone who mostly uses Claude Code and Devin.
Mockup: https://claude.ai/artifact/CoMExWeNmx6Q4yTtve4dgh (A, B and the four homes at one scale). Nothing in the app was changed.

Measured from 2x window captures taken the same day: Claude desktop's Code tab (window 1470 × 840), Devin Desktop (1200 × 800), the installed Liner Code 0.2.6 (1470 × 840). All light theme. See `devin-desktop.md` for Devin's tokens and its session view.

## The three Homes

| | Claude Code · New session | Devin · New session | Liner Code 0.2.6 · Home |
|---|---|---|---|
| The box | 770 × 44, one line, 40 from the window's foot | 687 × 117, centre at 52% of the height | 714 × 123, centre at 51% |
| When you send | nothing moves: the box is where a session holds it | the box moves to the foot | the box moves to the foot |
| Over the box | nothing | wordmark at 20px left, Cloud / Local right | a 34px headline that also picks the project |
| Under the box | where it runs (computer, folder, worktree) left; model, effort, mode right | nothing (controls are inside the box) | a 36 strip (checkout, branch, mode), then a line of three links |
| Middle of the page | two lists 320 wide: three recent folders plus "Choose environment"; then what to pick up (a waiting session, "Turn on Worktree", "Continue uncommitted work, 11 files") | empty | empty; the Desk is two scrolls down |
| Sessions from other tools | no | yes: Claude Code sessions are listed under Recent | behind "carry on a session from Claude Code or Codex" |
| Sidebar's first row | "New", lit on this page (#d8d8d8 on #f0f0f0) | "New session", lit (#eaeaea on #f8f8f8) | "New session", never lit |
| Back and forward | by the lights | by the lights | none |
| Frame | flat, sidebar 254, one line | flat, sidebar 300, one line | rounded paper, sidebar 244 |

## What the two share that Liner's Home does not

1. The sidebar's first row is the page you are on, and it is lit.
2. No headline. The project is a control next to the box, not a sentence above it.
3. The box is one object with one set of rows on Home and in a session.
4. Back and forward.

Claude Code alone: the box never moves, and Home shows your work (projects, what waits). Devin alone: sessions from other tools are in its own list.

The session view needs nothing from this study: its header came from Claude Code (5 Nov) and its panel and tray from Devin (10 Nov).

## Proposals

- **A, Home that stays put (recommended).** The tray sits at the foot where a session holds it. Where it runs and the mode move to the tray's head, the row a session already uses for what waits to commit, so the card's place is the same in both. The middle holds two short lists at 380: Start in (recent projects, another folder, a scratch folder) and Pick up (sessions that wait on you, uncommitted work from `git.status`, importable Claude Code and Codex sessions, a row to the Desk). No headline. The line of links goes: each link became a row.
- **B, centred and quieter.** The composition stays. The headline becomes the project's name at 20px with This checkout / Worktree at the right; the line of links becomes a Pick up list of three rows.
- Both: "New session" lit on Home; back and forward at the start of the paper's top row.

Kept in both: the paper, sidebar D, the red Send, the tray, the Desk.

Data both need already exists: `needsYou` (Desk.tsx), `git.status`, `sessions.importable`, the project list.

## The live turn, in Devin and in Claude Code (14 Nov, later)

Devin, from frames of one small turn in its sandbox session ("Read tides.js and tell me in two sentences what it does"):

1. A black dot and "Thinking…", a highlight sweeping across the letters.
2. "Thinking ⌄" opens; the thought streams in under it with the newest words fading out to the right. Below it the Devin mark and "Thinking." with one to three dots cycling.
3. "Working for a bit ⌄", then "Working for 1s": a rail holding "Thoughts ›", "Read tides.js", and a nested "Thinking ⌄" with its text. The status line stays at the foot.
4. Done: the group folds to "› Worked for 1s"; the answer; a row with thumbs left and stats, branch and ··· right; then "Devin is awaiting instructions" with an orange dot.
5. The box: the placeholder becomes "Guide Devin while it works, or press ⌘↵ to queue", and Send becomes a black round Stop.

Claude Code (desktop), from this session's own window: one live line (animated mark, what it is doing in present-tense words, seconds, a chevron); finished steps as grey one-liners with thumbnails; short prose updates between them; the task list as a checklist card; the box reads "↵ to send, ⌘↵ to queue for later" with a square Stop.

Board C of the mockup fuses the two: Devin's folding Thinking and Working groups and its rail, one live line in Claude Code's words with Devin's highlight, Claude Code's updates between groups, text that streams with lighter newest words, and on the box Claude Code's task list while it works and Devin's what-changed row when it ends.

## Why Devin reads as sharper (14 Nov, from its bundle and from pixels)

Devin Desktop 3.12.59 is Electron 43; Liner Code 0.2.6 is Electron 44. Neither passes any rendering switch. Both set `-webkit-font-smoothing: antialiased`. The difference is in what is drawn, not in the engine.

| | Devin | Liner Code 0.2.6 |
|---|---|---|
| UI face | Inter, one variable file (`out/media/InterVariable.woff2`) | Instrument Sans Variable (`@fontsource-variable/instrument-sans/wdth.css`) |
| Tracking | −0.005em almost everywhere | negative throughout: −0.01 to −0.04em |
| Sizes | 11, 12, 13 (default), 14, 15 (prose), whole pixels | 12.5 (66 rules), 13, 12, 11.5 (27), 13.5 (23): mostly half pixels, a size smaller |
| Hairlines | 0.5px in 42 places | 0.5px in 10 |
| Shadows and blur | three small shadow levels, no blur at rest | 115 `box-shadow` rules, 25 `filter: blur`, 13 `backdrop-filter` |
| Window | opaque | transparent page over vibrancy or glass |

Measured on 2x captures of each sidebar (share of text pixels that reach full ink; the rest are grey edge pixels): Claude 56%, Devin 44%, Liner 23%. Liner's strokes are thinner than a device pixel more often, and its letters sit closer, so more of each word is edge.

What to change in the build, in order of effect: whole-pixel sizes one step up (12 / 13 / 14 / 15), no negative tracking under 17px, regular weight 450 for small text (or Inter), no text lighter than `--l-ink-3`, 0.5px dividers on 2x screens, flat surfaces with small shadows and no blur at rest, every length on a whole pixel, the three-size icon family. The mockup's boards carry a Type tweak (Inter, tuned, today) to judge the first three.

Decided 14 Nov: the interface type is Inter. The "Liner Code" name in the sidebar stays in Instrument Sans.
