# Devin Desktop, measured (10 Nov 2026)

Devin Desktop 3.12.43 (a Windsurf / VS Code 1.141 fork, bundle `com.exafunction.windsurf`), light theme, window 1200 × 800 pt.
Sources: its own stylesheet (`Resources/app/out/vs/workbench/devin-webapp-host/index.css`, `splash.html`) for tokens, and 2x window captures for layout.
One test session was run in its empty sandbox folder (`~/Project/devin`): it made `tides.js` and `tides.test.js` and ran `node --test`.

Dark values below are from the stylesheet, not seen on screen (the app is set to Light).

## What the Liner Code mockup took, and where it differs

Mockup: https://claude.ai/artifact/LXZHjEfYoTJtmEBhLzmSzv (second pass, 10 Nov).

| | Devin Desktop | Liner Code 0.2.4 | Mockup |
|---|---|---|---|
| Frame | none: sidebar and page on one line | rounded paper, 6 gap, 18 corner | paper kept; "Frame › flush" tweak shows Devin's |
| Top row | 38, shared by all columns | 52, and the panel starts under it | 44, shared by all columns |
| Panel | full-height column, one line | cut out below the header, own tab strip | full-height column, one line |
| Tabs | icon + name on all; clips at four | header icons plus a strip of the same | names while they fit, then only the open one |
| Panel content | Changes and Browser boxed, rest full bleed | a card per surface | no boxes |
| Composer | bordered card; tinted tray when it carries a row | card with a shadow; loose rows under it on Home | same card everywhere; tray with a head (session) or foot (Home) |
| What's waiting to commit | tray head, always in sight | red badge on a header icon | tray head |
| Action colour | black buttons, blue links | red Send, blue Commit | red Send, ink Commit |
| Corners | 4, 6, 8, 12, 16 | 18, 22, 14, 10, 8, pills | 18, 14, 8 |

## Tokens (from the stylesheet)

| | Light | Dark |
|---|---|---|
| Page (`bg-page`) | rgb 252 252 252 | 20 20 20 |
| Sidebar (`bg-wash`) | 248 248 248 | 25 25 25 |
| Raised (`bg-elevated`) | 255 255 255 | 31 31 31 |
| Ground behind a framed page (`layout-ground`) | 237 237 237 | 15 15 15 |
| Text | 25 25 25 | white 90% |
| Text, secondary | 25 25 25 at 56% | white 52% |
| Text, disabled | at 40% | white 40% |
| Border primary / secondary | black 8% / 6% | white 8% / 4% |
| Tint primary / secondary / tertiary | black 8% / 6% / 4% | white 8% / 5% / 3% |
| Accent | 49 124 255 | 73 176 255 |
| Green / orange / red text | 0 165 88 / 245 142 58 / 245 59 58 | 0 236 126 / same / same |

- Fonts: Inter for UI, "Devin Mono" for code.
- Type scale (size / line height): 11/14, 12/16, **13/18 (the UI default, tracking −0.005em)**, 14/20, 15/22 (chat prose), 16/26, 18/29, 22/28. Weights 400, 500, 600.
- Radii: 4, 6, 8, 12, 16, full. Menus and cards use 12; rows and chips 6 to 8.
- Shadows: L1 `0 1px 2px` at 5%; L2 `0 1px 3px` at 6% plus `0 1px 2px` at 6%; L2-border adds a 0.5px ring; L4 `0 25px 50px -12px` at 25%.
- Sidebar padding 8px; sidebar menu item gap 2px.
- On the web the page is a framed card (6px gap, 12px radius, shadow) beside a service rail; on desktop the frame is the whole window (gap 0, radius 0).

## Layout (measured)

- Sidebar 300 wide, `bg-wash`; one 1px line (black 6%) to the page. No other frame.
- Top row 38 high in every column: sidebar head (lights, sidebar toggle, "Agents ⌄", back/forward), session title, panel tabs. No line under it.
- Sidebar nav rows: 284 wide (8 margin), about 29 high on a 32 pitch, 13px text, 16px icons. Selected row: black 6% fill, radius 8.
- Session rows: two lines on a 45 pitch: title 13/500, then agent mark + time in secondary. Hover shows pin, archive and ··· and a preview card.
- Chat column: user bubble max about 585 wide, right edge at the column's right, fill = tint tertiary (#f2f2f2), radius about 16, 15/22 text.
- Composer tray 720 wide, centred, 8 from the window's bottom. The tray is a tinted container (#f2f2f2, radius about 20) with 4 to 6 padding holding the white card (radius about 16, shadow L2).
  - Home: tray 700 wide; card 122 high; the tray's foot (45 high) holds "Local ⌄ · folder · agent".
  - Session: the tray's head (44 high) holds "2 files changed +23 · Quick review · View changes · Mark as seen"; card about 111 high.
  - Card row: `+`, `/`, mode ("Code"), folder … model name, context ring, mic, send (32 round; grey when empty, black with text, black square while working).
- Right panel: opens at 404 wide (chat keeps 496). One 1px line the full height. Drag it to resize; under about 380 the composer drops its labels.
- Panel top row: tabs with icon + label on every tab; the selected one has a fill chip (#eeeeee, 25 high, radius 6 to 8); then `+`; at the far right expand and the panel toggle. The toggle keeps its screen position open or closed.
- Expanded: the panel replaces the chat and its tab row takes the session header's place.
- A fourth tab does not fit at 404: the row scrolls and tabs are clipped.

## Surfaces in the panel

- Changes: an inset bordered box (8 from the panel edges, top corners rounded). Row "Changes › Since last seen ⌄ … 2 files +23 −0". Per file: a 36 high header (chevron, name, path in secondary, +N, "Added" chip, ···) on #f8f8f8; diff lines 20 high in 12px mono, wrapped, with a 3px green bar (#00a658) and #ddfbeb fill.
- Progress: a filter field, an event list (full-bleed selected row), then a bordered detail card.
- Files: the tab takes the open file's name and icon. A sub-row (crumb, copy, "Open ⌄", tree toggle), a line, then editor left and tree right with a bordered filter field.
- Terminal: full bleed, no toolbar, no border.
- Browser: a row of back, forward, reload, history, a pill address field, ···; the page in a bordered rounded box 8 from the edges.
- `+` menu: search field, then Changes, Progress, Files, Browser, Terminal, Previews. 30 high rows, radius 12.

## The thread at work

- Working: sidebar row shows a spinner and "Working"; the thread shows "Investigating."; the placeholder becomes "Guide Devin while it works, or press ⌘↵ to queue".
- Steps sit under a "Working for 7s +23" header on a left rail (1px line): "Thoughts ›", "Created tides.js +6", "Ran node --test …". All secondary text; the newest is primary. Collapses to "Worked for 1m 17s +23" when done.
- Approval: "Run a command?" then a card with a 1px accent-tinted border (#c0d5ff), radius 12: label "Command", the command in mono, then an edit icon, "Allow ⌄" (black, split) and "Reject" (outlined). Below: an orange dot and "Action required: Approval required"; the sidebar row turns orange.
- Answer: prose 15/22, inline code as tinted chips, code blocks in a 1px bordered box (radius about 10) with wrap and copy on hover. Then thumbs, stats, branch, ···, and "Devin is awaiting instructions" with an orange dot.

## Menus and pages

- Menus: white, radius 12, hairline plus soft shadow, 30 high rows; mode items are two lines (name, description). An open trigger gets a pill fill.
- Sidebar display menu ("Properties"): Sort, Filter, Group, Property visibility, Compact view, Reveal child sessions, Sync view settings.
- ⌘K palette: "Type a command or search…", Start session, Search sessions, Recent, Actions, key hints in the foot.
- Sidebar collapsed: the page takes the window; the head controls move into the page's top row.
- Settings opens in place: the sidebar becomes its nav with "Back to app"; sections are a title plus a bordered rounded group of rows (label, description, control at the right). Options include Theme, High contrast and Chat width.
- Automations, Customizations: a centred column, 18px title, segmented chips, black primary button, 1px bordered cards.
