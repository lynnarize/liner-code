# L11. The losing copies of rules are removed

**Commit message:** `The stylesheets no longer carry rules that a later one always overrode`

## Why

`app.css` was grown by appending a new block for each pass (0.2.5, 0.2.7 three times, 0.2.8, the sidebar of 18 November).
The later block wins, and the earlier declarations stay in the file as dead text that still reads as the truth: the sheet
says the sidebar is 244px wide at line 19 and 264px at line 7287. Your rule for this pass: where two say the same thing,
the newer wins and the older goes.

This plan removes **only** declarations that lose in every state, and classes nothing references. Nothing on screen may
change. Run it **after** L05 and L06, which rewrite some of the panel's rules.

## How to work

For every item below:

1. Read both locations. Confirm the later rule's selector matches the same element in every state the earlier one does
   (mind `@media`, `@container`, `[data-…]`, `:not(…)`, and `html[data-native="mac"]`). If the earlier rule applies in a
   state the later one does not, it is **not** dead: skip the item and note it.
2. Delete the dead declaration. If that empties the block, delete the block and a comment that only described it.
3. Never move a rule. Never merge two blocks into one in this plan.

**The check for the whole plan:** run `node plans/layout/check/measure.mjs` before the first deletion and after the last.
The two outputs must be identical. Also `npm run build` must report the same number of CSS files.

## The list

### A. Classes with no reference anywhere

Confirm each with `grep -rnE --include='*.ts' --include='*.tsx' -- '(^|[^A-Za-z0-9_-])CLASS([^A-Za-z0-9_-]|$)' ui/src`
(nothing printed), then delete its rules.

| Class | Where |
|---|---|
| `.lc-stop` and `@keyframes lc-stop-in` | `app.css:3163` (one selector in a list: remove only that selector), `3233-3243`, `3245`, `3265`, `3345` |
| `.lc-box-keys` | `app.css:3493-3514` |
| `.lc-agent-card-t` | `app.css:4735-4751` |
| `.lc-ask-title` | `app.css:2639`, `2645`, `2650`: the first selector of each list; the `.lc-plan-top` halves stay |
| `.lc-accent-t` | `app.css:189-192` |
| `.lc-tstep-line`, `.lc-tstep-target` | `timeline.css:110-115` |
| `.lc-trail-agent-t` | `surfaces.css:5785-5790` |

### B. Selectors that can no longer match

| Rule | Why it cannot match |
|---|---|
| `app.css:4469-4478` `.lc-session[data-beside] .lc-panel { box-shadow: inset 1px 0 0 … }` and `… > .lc-surface { margin-left: 1px }`, and with them `app.css:7807-7809` (which only resets that margin) | `data-beside` is never set together with `data-wide` (`Session.tsx:521`, `557-559`); the card's own shadow always wins |
| `app.css:4962-4965` `.lc-sheet-frame[data-size="md"]` | no sheet frame sets `data-size` (`AgentDialog.tsx:168`, `design/Intro.tsx:258`) |
| `app.css:1048-1051` `.lc-sb-find:not(.lc-st-find):has(input:focus-visible)` | the only `.lc-sb-find` is `Settings.tsx:241`, which also has `lc-st-find` |
| `app.css:7371-7375` `.lc-sb-facepick > .lc-face-tile` | the trigger has no tile (`Sidebar.tsx:1089-1091`) |
| `app.css:4378-4383` `.lc-ask-h .lc-pop` | the only `.lc-ask-h` is a plain `<h2>` (`Home.tsx:249`) |
| `surfaces.css:370-374` `.lc-sinfo-v > .lc-quiet` | no `.lc-quiet` is a direct child of `.lc-sinfo-v` in `SessionInfo.tsx` |
| `surfaces.css:219-221` `.lc-panel[data-wide-review] { box-shadow: none }` | nothing gives a shadow in that state any more |
| `security/security.css:360-363`, `393-395`, `427-430` `.ls-bx[aria-checked="true"]` | `.ls-bx` is a `div` with `data-on` (`security/StartScan.tsx:430`); `aria-checked` is on the button inside. `scan.css:49-59` does the job |
| `design/lean-page.css:448-451` `.lc-home-in:has(> .ld-fit) …` | `.ld-fit` is never a direct child of `.lc-home-in` (`design/Skills.tsx:163` inside `.ld-home-head`) |
| `design/design-face.css:879-881` `.ld-home-in { padding-bottom: 48px }` | its one element also has `data-mid`, and `app.css:7430-7438` `.lc-home-in[data-mid]` resets the padding |

### C. The same selector declared twice, the earlier value dead

Delete the **earlier** declaration named; keep everything else in its block.

| Earlier (delete) | Later (stays) |
|---|---|
| `app.css:19` `--lc-side: 244px` → **instead of deleting**, change line 19 to `264px` and delete the block at `7286-7288` | the sidebar's width is said once, at the top with the other sizes |
| `app.css:999` `.lc-sb-head { gap: 10px }` | `7294` `gap: 0` |
| `app.css:7740` `.lc-sb-head { padding-left: 10px }` | always beaten by `7831` (Mac) or `7949` (not Mac) |
| `app.css:1164` `.lc-sb-inner { gap: 12px }` | `7952` `gap: 0` |
| `app.css:1182` `.lc-sb-sec { gap: 2px }` | `7743` `gap: 0` |
| `app.css:1172` `.lc-sb-plate { border-radius: 12px }` | `7746` `10px` |
| `app.css:1319`, `1321` `.lc-sb-foot { gap: 6px; padding: 0 2px }` | `7749-7750` |
| `app.css:1326-1327` `.lc-sb-foot .lc-ib` 32px | `7753-7754` 30px |
| `app.css:1077` and `7306` `.lc-sb-nav { font-size }` | `7694` 13px |
| `app.css:1014` `.lc-brand { flex: 1 }` | `7290` `flex: none` |
| `app.css:7319-7334` `.lc-sb-facepick`: `display`, `align-items`, `gap`, `height`, `padding`, `border-radius`, `font-size`, `font-weight` | `8082-8098` `.lc-sb-foot .lc-sb-name` (same element, `Sidebar.tsx:1085`) |
| `app.css:4385-4388` `.lc-home-compose { width: min(720px, 100%) }` | `7505-7507` under `[data-mid]`, the only place it renders |
| `app.css:7444` `.lc-home-top` padding | `7762` |
| `app.css:7512` `.lc-home-pickup` padding | `7765` |
| `app.css:7543` `.lc-home-pick { font-size: 14px }` | `7707` 13px |
| `app.css:3855-3870` `.lc-who-tool`: `grid-template-columns`, `column-gap`, `padding`, `border-radius` | `3876-3882`, the same selector a few lines on |
| `app.css:3171` `.lc-ctl-attach { border-radius: 999px }` | `3181` 8px |
| `updates.css:36` `.lc-up-bar { width: 120px }` | `updates.css:67-69` 148px |
| `app.css:4429-4431` `.lc-panel { display: flex; flex-direction: column }` | `dock.css:46-50` `.lc-dockpanes { display: grid }`, the same element (`Panel.tsx:265`) |
| `app.css:4456`, `4459` `.lc-panel-top { gap; padding }` and `surfaces.css:30` `.lc-stabs { padding }` | `dock.css:53-57` `.lc-dockpanes > .lc-stabs { padding: 0 10px }`, `surfaces.css:29` gap 2px |
| `app.css:4728-4734` `.lc-agents-panel`: `display`, `align-content`, `gap`, `padding` | `crew.css:394-397` `.lc-agents-panel.lc-cr`; the one use has both classes (`Crew.tsx:721`) |
| `surfaces.css:262-294` the old Guide rows: `.lc-spick-b` `min-height`, `padding`, `border-radius`; `.lc-spick-i` `width`, `height`, `border-radius`; `.lc-spick-grid { gap: 8px }` | `surfaces.css:6041-6062` |
| `surfaces.css:360-368` `.lc-sinfo-v`: `display`, `align-items`, `gap`, `min-width` (keep `overflow`, `text-overflow`, `white-space`) | `surfaces.css:5934-5940` |
| `surfaces.css:4660-4661` `.lc-row-chev` 13px | `5780-5782` 11px |
| `app.css:6815` `.lc-prc-checks li { white-space: nowrap }` | `surfaces.css:5927-5930` `normal` |
| `design/design-face.css:1127-1139`: nothing to delete, but its comment should say it is `app.css:351-360` for `.ld-bar` | n/a |

### D. Rules that restate what already applies

Delete the restating rule after reading the one it repeats.

- `security/scan.css:254-256` and `264-267` (`.lsc-scan .lc-body` grid) equal `app.css:1819-1822`.
- `security/scan.css:416-419` `.lsc-ask-top .lc-ib { width: 28px; height: 28px }` equals `.lc-ib` (`app.css:383-384`).
- `security/overview.css:578-580` `.lo-td-act .lo-scan { padding: 0 10px }` equals `.lc-btn[data-kind="ghost"][data-size="sm"]` (`app.css:656-658`).
- `security/findings.css:532-534` `.lf-x-dismiss { gap: 6px }` equals `.lc-btn`'s gap (`app.css:583`).
- `app.css:7827-7829` `.lc-sb-head > .lc-grow { min-width: 0 }` equals `.lc-grow` (`app.css:182-185`).
- `design/design.css:347-350` `.lc-dz-thumb[data-size…] { padding-top: 0 }` over `padding: 0` at line 340.

### E. Stale comments

Rewrite, in one plain sentence each, the comments that describe the panel as a column with a hairline: `app.css:194-198`
(the side panel "is a column inside the paper with nothing drawn round it"), `4436`, `dock.css:51-52`. They should say what
L05 and L06 left true: beside the thread it is a card; over the whole paper it is flat with its row.

## Not in this plan

- The panel's width rules at `app.css:1838-1841` and `7674-7676`: L06 decides those.
- 38 redundant `box-sizing: border-box` in `app.css`: harmless; leave them.
- Anything under `.lc-rt*`, `.lc-rb*`, `.lc-run*` or used only by `Routines.tsx` (about 600 lines): Routines are off on
  purpose and their code is not to be touched.
- Setup's narrow layout (`setup.css:491-539`) and New agent's `@media (max-width: 860px)`: unreachable in the shipped
  window (880 minimum) but used in a browser tab under `npm run dev`.

## Source test

One test: for each class in list A, no stylesheet under `ui/src/app` contains it. One more: `app.css` declares `--lc-side`
exactly once.

## Done

- `measure.mjs` output is identical before and after.
- Source tests pass; `npm run typecheck`, `npm run build`, `npm test` pass.
- `git diff --stat` shows only `.css` files and the test (no `.tsx`).

## STOP conditions

- `measure.mjs` output differs: find which item did it with `git stash` and halving, restore that item, and note it.
- More than five items fail their "is it really dead" check: stop and report; the sheet has moved since the audit.
