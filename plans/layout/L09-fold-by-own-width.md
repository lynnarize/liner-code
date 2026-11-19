# L09. Usage, the lean page and Findings fold by their own width

**Commit message:** `Usage, a design's lean page and a finding's panel fold by the room they have, sidebar open or not`

## Why

Three layouts decide by the **window's** width (`@media`) though they live on the paper, which is 270px narrower whenever
the sidebar shows. Each has a band of window widths where it is cramped with the sidebar open and loose with it closed.
Everything else in the app decides by a container (`@container`): the session (`app.css:1890-1904`), the Wall
(`wall.css:13`, `35-44`), Security's Overview (`security/overview.css:36-43`, `211-256`). Those are the newer pattern.

None of these three was seen cramped on screen: the numbers are worked from the CSS.

| Page | Rule | The band |
|---|---|---|
| Usage | `app.css:6062-6067` `@media (max-width: 980px)` makes `.lc-usage-top` and `.lc-usage-mid` one column | Sidebar open, window 981 to about 1150: two columns in 679 to 850px, "By agent" names get about 74px |
| A design's lean page | `design/lean-page.css:514-525` `@media (max-width: 900px)` stacks `.ld-lp-cols` and `.ld-lp-two` | Sidebar open, window 901 to about 1150: the type sample column gets 0 to 10px |
| Security, a finding open | `security/findings.css:594-598` `@media (max-width: 1240px)` narrows the panel `.lf-x` | The step happens 270px late with the sidebar open |

## Current state (drift check)

```bash
sed -n 6062,6067p ui/src/app/app.css                 # @media (max-width: 980px) { .lc-usage-top, .lc-usage-mid { … } }
sed -n 514,516p ui/src/app/design/lean-page.css      # @media (max-width: 900px) { .ld-lp-cols {
sed -n 594,598p ui/src/app/security/findings.css     # @media (max-width: 1240px) { .lf-x { width: clamp(320px, 44%, 560px); } }
grep -n 'className="lc-usage"' ui/src/app/Usage.tsx  # 46
grep -n "^\.ld-lp {" ui/src/app/design/lean-page.css # 16
grep -n "container" ui/src/app/app.css | grep -n "lc-usage"   # nothing: Usage has no container yet
```

## Steps

For each page: name a container on the page's own root, then turn the `@media` into an `@container` on it with the width
less the 12px the window has round the paper (two 6px gaps), so that with the sidebar **closed** nothing changes.

### 1. Usage

- In the `.lc-usage` part of the shared rule at `app.css:1645-1653` do not add anything (it is shared with `.lc-session` and
  `.lc-home`). Instead add, directly above the `@media` at line 6062:
  `.lc-usage { container: lc-usage / inline-size; }`
- Change `@media (max-width: 980px)` to `@container lc-usage (max-width: 968px)`.
- The comment above line 6062 describes the session's panel, not Usage: replace it with one sentence that says Usage's two
  columns become one when the page itself is narrower than 968.

### 2. The lean page

- Add `container: ld-lp / inline-size;` to `.ld-lp` (`design/lean-page.css:16`).
- Change `@media (max-width: 900px)` at line 514 to `@container ld-lp (max-width: 888px)`.
- `.ld-lp` is `position: absolute; inset: 0`: check nothing inside it is sized with `cqw`/`cqi`
  (`grep -n "cq[wihb]" ui/src/app/design/lean-page.css` must print nothing).

### 3. A finding's panel

- Read `security/Findings.tsx` from line 280 to the closing tag of the element that holds both `.lf-col` and the panel
  (`.lf-x`, rendered by `FindingPanel`). That parent is the container. Find its class and its rule in `findings.css`.
- Add `container: lf-page / inline-size;` to that rule.
- Change `@media (max-width: 1240px)` to `@container lf-page (max-width: 958px)` (1240 − 270 − 12).
- `.lf-x`'s width is a percentage of that parent, which is allowed: a container may size its children.

**Source tests:** `app.css` has no `@media (max-width: 980px)`; `lean-page.css` has no `@media (max-width: 900px)`;
`findings.css` has no `@media (max-width: 1240px)`; each file names its container once.

## Done

- Source tests pass; typecheck and build pass.
- With the sidebar **hidden**, Usage, a lean page and a finding look the same at window widths 900, 1000 and 1300 as before
  the change. With it shown, each folds 270px sooner. If you cannot look, say "not seen" in Executor notes.

## STOP conditions

- The parent of `.lf-col` and `.lf-x` already has `container-type`, or is a grid whose columns are set from the panel's
  width in JS: report, do not add a second container.
- After step 3 the finding panel has width 0 or the list disappears (a container's inline size may not depend on its
  children: if the parent was shrink-wrapping them it cannot be the container).
