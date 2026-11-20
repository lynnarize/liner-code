# 027. The dock stops redrawing on every frame of the open session's own reply

**Commit message:** `The dock stands still while the session you are watching streams`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Finding: PERF-01 (HIGH). Every excerpt below is from the advisor's own read.

## Why this matters

The 2026-11-18 pass memoised the shell and the background faces, and its own measurement shows the residue
(`docs/AUDIT-2026-11-18.md:285`): with the OPEN session streaming and Changes open, **1,154 component redraws in 6 s**
remain (vs 248–260 for a background stream). The cause is read in the code:

- `Panel` (`ui/src/app/Panel.tsx:109`) is a plain function — not memoised. `Changes` (:643) and `Strip` (:344) are
  plain too. (`DesignTab` at :100 IS memoised — the pattern exists in the file.)
- `SessionPanel` (`ui/src/app/Session.tsx:877-879`) is a plain wrapper whose comment claims "a reply's words don't
  redraw it" — but Session re-renders each frame of its own stream (its items change), and it passes
  `lead={<span>…buttons…</span>}` (:786-803) — a FRESH JSX element every render — plus inline callbacks. Even a
  memoised Panel would re-render on the new `lead` reference.
- The surfaces' own `useItemsWhere` slices are unchanged during a text stream; the redraw is pure prop churn.

This is the largest remaining render cost in the Code face: ~190 redraws/s of the strip, Changes and every mounted
surface while you watch a reply.

## Current state (drift check)

```bash
git log --oneline -1                                # bfb0ebc or later
sed -n '100,103p;109,136p' ui/src/app/Panel.tsx     # DesignTab's memo; Panel's plain signature and props
sed -n '344,346p;643,645p' ui/src/app/Panel.tsx     # Strip and Changes signatures
sed -n '774,804p;876,879p' ui/src/app/Session.tsx   # the dock prop, the inline lead, SessionPanel
```

The inline lead as it stands (`Session.tsx:786-803`): a `<span className="lc-stabs-lead">` holding the Show-the-sidebar
and Close-this-side buttons, built fresh every Session render, conditional on `(!sidebar || onCloseSide)`.

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- **L13 ordering:** L13's in-flight work touches `Session.tsx` (the `data-left-wide` attribute at :558, already in the
  tree) and `app.css`'s panel regions. This plan touches Session.tsx's dock-props region (:774-804) and Panel.tsx —
  different regions. Run AFTER L13's commit if possible; else edit only your regions and say so in the note.
- This is a behaviour-preserving refactor: the verification is the MEASUREMENT plus the interaction pass, not a unit
  test of markup. Where a pure helper emerges (a stable-props comparator), give it a node test.
- One local commit, the message above. Never push.

## Steps

### 1. Measure first (the before number)

Use the measuring build (`plans/layout/README.md` "The measuring build": Demo-only engine on :7799, UI on :5199;
Playwright comes from `site/node_modules`, as `plans/layout/check/measure.mjs` uses). Write a THROWAWAY probe script
in the scratch dir (not the repo), patterned on measure.mjs:
- Open a Demo session with the Changes tab docked; start a Demo reply that streams for several seconds.
- Count dock redraws over 6 s of streaming. The cheapest honest counter: a temporary dev-only `<Profiler id="dock"
  onRender={…}>` wrap around `SessionPanel` in Session.tsx (increment a window counter), read via
  `page.evaluate`. This temporary wrap is REVERTED before the commit — it is a probe, not a change.
- Record the number (the audit's was ~1,154 total component redraws; your dock-only number is its dock share).
If you cannot run a browser at all: say "not measured", do the refactor with the interaction pass by source reading
only, and mark the done criterion "not measured" — do not guess a number.

### 2. Hoist the lead into a memoised component with stable props

In `Session.tsx`:
- Extract the lead JSX into a small component beside SessionPanel:

```tsx
/** What starts the panel's row when it is the paper's header: its own component, so a reply's frames don't hand the
    dock a fresh element each time (the dock is memoised below). */
const PanelLead = memo(function PanelLead({ sidebar, onSidebar, onCloseSide }: { sidebar: boolean; onSidebar: () => void; onCloseSide?: () => void }) {
  if (sidebar && !onCloseSide) return null;
  return (
    <span className="lc-stabs-lead">
      {!sidebar && (<button …exactly the existing button…/>)}
      {onCloseSide && (<button …exactly the existing button…/>)}
    </span>
  );
});
```

  Move the existing buttons verbatim (same classes, aria-labels, titles, icons, onClicks). The condition
  `(!sidebar || onCloseSide)` becomes the component's early return — same truth table.
- Pass `lead={<PanelLead sidebar={sidebar} onSidebar={onSidebar} onCloseSide={onCloseSide} />}` — the element is
  still fresh each render, but PanelLead is memoised AND its props are stable (see step 3), so its OUTPUT reference
  is stable… note: a fresh `<PanelLead/>` element each render still re-renders PanelLead's wrapper unless the element
  itself is memoised. The robust shape: hoist the element too — `const lead = useMemo(() => <PanelLead …/>, [sidebar, onSidebar, onCloseSide])`
  in Session, so the `lead` prop reference is stable across frames. Do both.
- Stabilise the callbacks Session passes to Panel: `onDock`, `onFocus`, `onOpenSession`, `onRoutine` — wrap each in
  `useCallback` with its true deps (read each one's body; the setDock-based ones are stable with []). If a callback
  closes over per-frame state, restructure it to read from a ref or the store instead — do NOT drop a dependency to
  make it stable (that is the stale-closure bug class).

### 3. Memoise Panel, Strip and Changes

In `Panel.tsx`:
- `export const Panel = memo(function Panel(…existing props…) { …existing body… });` — keep the body verbatim.
  Default shallow comparison is right once the props are stable (step 2). If a prop is legitimately per-frame (none
  should be — `thread` is the store's object, `dock` is state, `files` a number, `focus` changes only on a press),
  say which and why in the note; do not write a custom comparator that ignores a real change.
- Wrap `Strip` and `Changes` in `memo` the same way (their props come from Panel; verify each is stable or primitive).
- `SessionPanel` (Session.tsx:877) can stay a plain wrapper once Panel is memoised — or memoise it too; either is
  fine, say which. Fix its comment if the claim only becomes true now.
- The surfaces inside Changes/Strip already read their own slices (`useItemsWhere`) — do not change those.

### 4. Measure after, and pass the interactions

- Re-run the probe: the dock's redraw count over 6 s of the open session's stream should fall to ~0 (the background
  case's dock share was 0 in the audit's measurement). Record before/after in the executor note. Every OTHER
  measure.mjs key must not move (run it once before and after; the layout is untouched).
- Interaction pass in the measuring build (or "not seen"): switch tabs, drag a tab between panes, drag the panel's
  width grip, close the panel (the leave animation keeps its card — L13's behaviour), open it full-canvas, press a
  file in the thread (Changes scrolls — plan 020's behaviour if it has landed), the sidebar button in the lead works
  over the whole paper. A stale prop would freeze one of these; check each.
- Revert the temporary Profiler wrap. `npm run typecheck` and `npm run build` exit 0.

## Done

- The dock's 6 s streaming redraw count: before/after recorded (or "not measured" with the reason).
- The interaction pass done (or each item marked "not seen").
- measure.mjs's keys unchanged; typecheck and build exit 0; the Profiler probe reverted.
- One commit, the message above. Executor note: the numbers, what was not seen, any STOP.

## STOP conditions

- A callback cannot be stabilised without dropping a real dependency: stop, report which — a stale closure is worse
  than a redraw.
- After the memo, any interaction freezes (tab state, drag, leave): revert the memo on the offending component,
  report what prop churn it actually needs.
- The redraw count does not fall: another prop is churning — find it (the Profiler's onRender gives the changed
  props in dev), report; do not ship a memo that does nothing.
- Any change would land in L13's regions or `ui/src/liner/`.

## Maintenance note

The dock's props are now a contract: stable references across a stream. A new prop that changes per frame re-opens
the cost — the probe script (keep it in scratch, or commit it under plans/layout/check if the owner wants it) is the
tripwire. The same shape applies to any future surface wrapper.
