# L08. The top row's words start at one x on every face

**Commit message:** `The top row's first word starts at the same place in Code, Design, Security and Settings`

## Why

Every page has the 44px top row, but its first word starts in three places (measured from the paper's left edge):

| Place | First word at | Why |
|---|---|---|
| A Code session, Security's pages, Usage, the Wall | 20 | `.lc-top { padding: 6px 10px 6px 20px }` (`app.css:1661-1670`) |
| Liner Design (Home and a design) | 22 | `.ld-bar { padding: 6px 10px 6px 16px }` (`design/design-face.css:340-347`), and its title `.ld-tt` has `margin-left: -4px; padding: 0 8px 0 10px` |
| Settings | 26 | the crumbs sit at 20 and each crumb has 6px of its own padding (`liner/components/breadcrumb/breadcrumb.css:23`) |

Switching face moves the title by 2px, and opening Settings by 6. Decision D4 (README): `.lc-top`'s 20 is the edge.

A second fault from the same row, reasoned from the cascade (it needs a Mac with the sidebar hidden to see): the scan's
"Found" panel uses `.lc-top` for the header of a panel at the **right** of the paper
(`security/FoundPanel.tsx:100` and `:133`, `<header className="lc-top lsc-found-top">`). The rule that moves a top row out
from under the traffic lights (`app.css:354-360`) matches every `.lc-top`, so with the sidebar hidden on a Mac "Found so
far" is indented about 74px for lights that are nowhere near it.

## Current state (drift check)

```bash
sed -n 340,347p ui/src/app/design/design-face.css        # .ld-bar … padding: 6px 10px 6px 16px;
grep -n "padding-left: max(16px, calc(var(--lc-lights-x, 70px) + 4px));" ui/src/app/design/design-face.css   # 1138
grep -n "^\.ld-tt {" -A12 ui/src/app/design/design-face.css | grep "margin-left: -4px"                         # one line
sed -n 5355,5357p ui/src/app/app.css                     # .lc-st-crumbs { min-width: 0; }
grep -n 'className="lc-top lsc-found-top"' ui/src/app/security/FoundPanel.tsx                                   # 100 and 133
sed -n 497,499p ui/src/app/security/scan.css             # .lsc-found-top { padding: 6px 10px 6px 22px; }
```

## Steps

### 1. Liner Design's row starts at 20

- `design/design-face.css:346`: `padding: 6px 10px 6px 16px;` → `padding: 6px 10px 6px 20px;`
- `design/design-face.css:1138`: `max(16px, …)` → `max(20px, …)` (its copy of the traffic-light rule).
- In `.ld-tt`: `margin-left: -4px;` → `margin-left: -10px;` (the button's own 10px of padding now ends on the row's edge,
  as Code's `.lc-tt` does with `-8px` and 8px: `app.css:1726-1744`).

Check the lean page: `design/lean-page.css:31-33` adds to `.ld-bar` on that page and `.ld-title` (`design-face.css:388-400`)
is its title. If `.ld-title` has no negative margin, its words will now start at 20 plus its own left padding: give it
`margin-left` of minus that padding, in its own rule.

**Source test:** `.ld-bar` has `padding: 6px 10px 6px 20px`.

**Verify:** `topRowTextLeft.designHome = 20`.

### 2. Settings' crumbs start at 20

`app.css:5355-5357`: add `margin-left: -6px;` to `.lc-st-crumbs`, with a comment: a crumb keeps 6px of its own (Liner's
breadcrumb), so its word, not its box, starts on the row's edge.

**Verify:** `topRowTextLeft.settings = 20`.

### 3. The "Found" panel's header is not a page's top row

In `security/FoundPanel.tsx` lines 100 and 133, change `className="lc-top lsc-found-top"` to `className="lsc-found-top"`.
In `security/scan.css:497-499`, make `.lsc-found-top` carry what it took from `.lc-top`:

```css
/* The panel's own header: the height of the top row beside it, but not a page's top row, so nothing that moves a page's
   row out from under the traffic lights reaches it. */
.lsc-found-top {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  min-height: var(--lc-head);
  box-sizing: border-box;
  padding: 6px 10px 6px 22px;
}
```

Then `grep -n "lc-top" ui/src/app/security/scan.css ui/src/app/security/*.tsx` and `grep -n "\.lc-top " ui/src/app/app.css`:
if any rule styles a child through `.lc-top` (for example `.lc-top .lc-title`) and the Found header has such a child, give
`.lsc-found-top` the same declaration. Its title is `.lsc-found-t`, which has its own rule (`scan.css:500-505`).

**Source test:** `FoundPanel.tsx` does not contain `lc-top lsc-found-top`; `.lsc-found-top` has `min-height: var(--lc-head)`.

## Done

- Source tests pass; typecheck and build pass.
- Measured: `topRowTextLeft { session: 20, securityOverview: 20, designHome: 20, settings: 20 }`.

## STOP conditions

- `.ld-tt`'s left padding is not 10px (then the margin that puts its words at 20 is minus whatever the padding is: use that
  and say so).
- The Found panel's header changes height after step 3 (it must stay 44).
