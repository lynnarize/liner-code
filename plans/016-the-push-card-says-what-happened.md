# 016. The push card says what really happened, and a screen reader hears one stage at a time

**Commit message:** `A push that carries nothing says up to date, and the push card reads one stage at a time`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Findings: UI-01, UI-19, UI-14. All three were read end to end by the advisor; the excerpts below are from those reads.

## Why this matters

1. **UI-01.** The Changes foot's Push menu exists for the case "nothing left to commit" (`ui/src/app/Panel.tsx:635-636`,
   `ship(thread, null)`). On a branch already level with its upstream, `git.outgoing` returns no commits
   (`engine/src/api.ts:1607-1610`: `log([`${from}..HEAD`])` over an empty range, `ahead` 0). But the Ship card floors
   its count at 1 (`ui/src/app/Ship.tsx:131`), so the card animates "1 commit to push", "Pushing 1 commit to origin",
   "Pushed 1 commit" — while git pushed zero. The app's most celebratory card disagrees with what happened.
2. **UI-19.** The whole card is `role="status" aria-live="polite"` (`Ship.tsx:137`) and EVERY stage's words are in the
   DOM at once, hidden only by `opacity: 0; filter: blur(4px)` (`ui/src/app/app.css:6303-6313`). Opacity does not remove
   content from the accessibility tree: a screen reader reads all stages as one pile, and the live region re-announces
   it as rows arrive. The repo's own stacked-swap pattern does it right elsewhere
   (`ui/src/app/design/inspect/controls.tsx:102-103` puts `aria-hidden` on the unused span).
3. **UI-14.** The re-query action is "Look again" on Add-ons (`AddonsPage.tsx:145`), Usage (`Usage.tsx:279`), Linked PRs
   (`Pr.tsx:833`), Projects (`Projects.tsx:234`) and Settings' tools (`Settings.tsx:1412-1414`) — but the Session
   surface's same button says `aria-label="Refresh"` (`ui/src/app/SessionInfo.tsx:67`). One gesture, two names.

## Current state (drift check)

```bash
git log --oneline -1                                  # bfb0ebc or later
sed -n '129,134p' ui/src/app/Ship.tsx                 # const n = Math.max(1, s.files ? rows.length : s.commits.length);
sed -n '160,167p;181,184p;222,245p' ui/src/app/Ship.tsx   # the h1/h2/h3, m0/m1 and x0..x4 spans
sed -n '6299,6331p' ui/src/app/app.css                # the cross-blur and the data-p stage map
sed -n '65,70p' ui/src/app/SessionInfo.tsx            # aria-label="Refresh" title="Ask the session again"
```

If a line has moved, find it by its content. If the content itself differs, STOP that step and report.
**Note:** the tree may carry the uncommitted L13 layout work; it touches none of these regions. If L13 has landed as a
commit since `bfb0ebc`, re-run the drift check against the new lines — the selectors, not the numbers, are the anchor.

The count as it stands (`Ship.tsx:130-131`):

```tsx
  const rows = rowsOf(s);
  const n = Math.max(1, s.files ? rows.length : s.commits.length);
```

The stage map as it stands (`app.css:6319-6328`) — this is which span is VISIBLE at each stage:

```css
.lc-ship[data-p="0"] .x0,
.lc-ship[data-p="1"] .x1,
.lc-ship[data-p="2"] .x2,
.lc-ship[data-p="3"] .x3,
.lc-ship[data-p="4"] .x4,
.lc-ship[data-p="1"] .h1,
.lc-ship[data-p="2"] .h2,
.lc-ship:is([data-p="3"], [data-p="4"]) .h3,
.lc-ship:is([data-p="0"], [data-p="1"], [data-p="2"]) .m0,
.lc-ship:is([data-p="3"], [data-p="4"]) .m1 {
  opacity: 1;
  filter: none;
}
```

## Rules (hold for every step)

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders, or L13's files.
- Every fix comes with a test that fails without it, written first. UI logic tests live in `engine/test` and import the
  pure module directly (precedent: `engine/test/session-state.test.ts` imports `ui/src/app/session-state.ts`; a module
  that imports CSS cannot load under Node — precedent: plan L02's `face-pages.ts`).
- Test commands here need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID` or every file silently skips.
- One local commit, the message above. Never push.

## Steps

### 1. Extract the count and the stage words into a pure module, test first

Create `ui/src/app/ship-words.ts` (no React, no CSS imports — it must load under Node):

```ts
/*
  What the push card says: the count of commits a push carries, and which of its stacked words is the live one at
  each stage. Pure, so a node test can pin it (the card itself has no component tests).
*/
/** The commits a push carries: a shipment with files commits first (its rows), a push-only one takes what's outgoing.
    A push-only shipment can carry NOTHING — that case keeps its zero, it is the truth the card must say. */
export const pushCount = (s: { files: number; rows: number; commits: number }) =>
  s.files ? Math.max(1, s.rows) : s.commits;
/** The stage map app.css draws (.lc-ship[data-p] …): which stacked span is in focus at each stage. */
export const shipLive = (stage: number) => ({
  h1: stage === 1, h2: stage === 2, h3: stage === 3 || stage === 4,
  m0: stage <= 2, m1: stage >= 3,
  x0: stage === 0, x1: stage === 1, x2: stage === 2, x3: stage === 3, x4: stage === 4,
});
```

Write `engine/test/ship-words.test.ts` FIRST (pattern: `engine/test/session-state.test.ts`), with at least:
- "a push-only shipment with nothing outgoing counts zero, not one" — `pushCount({files:0, rows:0, commits:0})` === 0
  (this fails against the old `Math.max(1, …)` logic once step 2 wires it in; write it against the new module and see
  the module test pass, then see the OLD card behaviour pinned by the source test in step 2 fail before the change).
- "a shipment with files keeps its floor while the commit row is on its way" — `pushCount({files:2, rows:0, commits:0})` === 1.
- "a push-only shipment counts what is outgoing" — `pushCount({files:0, rows:0, commits:3})` === 3.
- one test per stage 0..4 asserting exactly the visible set from the CSS map above (e.g. stage 0: only x0 and m0).

**Verify:** `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/ship-words.test.ts` — all pass.

### 2. The card uses the real count, and says "up to date" when it carries nothing

In `ui/src/app/Ship.tsx`:
- Import `pushCount` from `./ship-words.ts`; replace line 131 with
  `const n = pushCount({ files: s.files, rows: rows.length, commits: s.commits.length });`
- The three places `n` is spoken, give the zero case its own words (keep the with-count words exactly as they are):
  - `m0` (line ~182): `{n ? `${plural(n, "commit")} to push` : "up to date"}` — write it as two spans or a ternary
    inside the existing `m0` span, matching the file's style.
  - `x2` (line ~234): when `n` is 0, `Pushing to {remote}` (no count — a push that carries nothing still asks the
    remote); otherwise the existing `Pushing {plural(n, "commit")} to {remote}`.
  - `x4` (line ~243, the success branch): when `n` is 0, `Everything is up to date`; otherwise the existing
    `Pushed ${plural(n, "commit")}`. The error branch stays as it is.
- Do not change the stage machine, the CSS, or the with-files path's floor.

Add a SOURCE test to `engine/test/ship-words.test.ts` (read the file as text, as `engine/test/layout-rules.test.ts`
does): "the push card no longer floors a push-only count at one" — assert `Ship.tsx` contains `pushCount(` and does NOT
contain `Math.max(1, s.files ? rows.length : s.commits.length)`. Write it before the change and see it fail.

**Verify:** the test file passes; `npm run typecheck` exits 0; `npm run build` exits 0.
**On screen (owner or a measuring build):** a session on an already-pushed branch with no uncommitted changes →
Changes → Push → the card says "up to date" / "Everything is up to date", never "1 commit". If you cannot run the app,
say "not seen" — do not claim it.

### 3. Only the live stage's words reach the accessibility tree

In `Ship.tsx`, import `shipLive` and compute `const live = shipLive(s.stage);` next to `n`. On each stacked span add
`aria-hidden={!live.h1}` (h1), `{!live.h2}` (h2), `{!live.h3}` (h3), `{!live.m0}` (m0), `{!live.m1}` (m1), and
`{!live.x0}` … `{!live.x4}` on the five chip spans. Keep `role="status" aria-live="polite"` on the card (line 137):
with the hidden spans marked, the live region now speaks only the visible stage. The SVG rails and diff bars already
carry `aria-hidden` — leave them.

Add a source test: "every stacked stage span in the push card is aria-hidden when not live" — assert each of the ten
spans' opening tags in `Ship.tsx` carries `aria-hidden={!live.` (count occurrences ≥ 10). Write it first, see it fail.

**Verify:** tests pass; typecheck and build exit 0. VoiceOver check is the owner's (repro: commit+push from the Changes
foot, listen — one sentence per stage, not the pile). Say "not seen" if you cannot.

### 4. One name for the re-query gesture

In `ui/src/app/SessionInfo.tsx:67`, change `aria-label="Refresh"` to `aria-label="Look again"` and
`title="Ask the session again"` to `title="Look again"`. Nothing else on the line.

Create `engine/test/ui-words.test.ts` (source-test pattern) with: "the Session surface's re-ask is named Look again,
as on every other face" — read `SessionInfo.tsx`, assert it contains `aria-label="Look again"` and does not contain
`aria-label="Refresh"`; read `AddonsPage.tsx` and assert "Look again" is present there too (the converged word).
Write it first, see it fail.

**Verify:** `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/ui-words.test.ts` passes;
typecheck and build exit 0.

## Done

- `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/ship-words.test.ts engine/test/ui-words.test.ts`
  passes; every new test was seen to fail before its change.
- `npm run typecheck` and `npm run build` exit 0.
- One commit, the message above. Executor note in `plans/README.md`: commit, what was not seen on screen, any STOP.

## STOP conditions

- `s.stage` is not the 0..4 the CSS map names (read the Ship state's source if unsure): stop step 3 and report.
- The push-only flow does not reach the Ship card at all in the current tree (Panel.tsx's Push menu changed): stop
  step 2 and report what the menu does now.
- Any step would need a change under `ui/src/liner/`.

## Maintenance note

The stage map lives in TWO places now: `app.css`'s `[data-p]` rules and `ship-words.ts`'s `shipLive`. A new stage must
update both; the per-stage tests are the tripwire. If a future change moves the card's words, keep the zero-case words
with them — the floor must never come back on the push-only path.
