# 021. Browser's Back and Forward are grey when there is nowhere to go

**Commit message:** `The Browser's Back and Forward are grey when there is nowhere to go`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Finding: UI-13. Every excerpt below is from the advisor's own read.

## Why this matters

On the first page loaded, Back looks pressable and does nothing; Forward at the newest page likewise. The two buttons
(`ui/src/app/Browser.tsx:670-675`) carry no `disabled` and no history state; they post `cmd("back")`/`cmd("forward")`
(:276) into the frame, whose probe answers with a bare `history.back()` / `history.forward()`
(`engine/src/proxy.ts:644-645`). Nothing tracks whether an entry exists. The neighbouring toolbar buttons DO have
disabled states (Open in your browser :727, zoom :736-742) — Back/Forward are the one affordance every browser trains
people to trust, and they are silent no-ops.

## Current state (drift check)

```bash
git log --oneline -1                                # bfb0ebc or later
sed -n '670,675p' ui/src/app/Browser.tsx            # the two buttons, no disabled
sed -n '256,260p' ui/src/app/Browser.tsx            # the onMsg "nav" branch
sed -n '489,494p' engine/src/proxy.ts               # the probe's nav() and its listeners
sed -n '644,645p' engine/src/proxy.ts               # back/forward commands
```

The probe's nav reporting as it stands (`proxy.ts:489-494`):

```js
  const nav = () => post({ kind: "nav", path: location.pathname + location.search + location.hash, title: document.title });
  for (const k of ["pushState", "replaceState"]) { const o = history[k].bind(history); history[k] = (...a) => { const r = o(...a); nav(); return r; }; }
  addEventListener("popstate", nav);
  addEventListener("hashchange", nav);
  addEventListener("DOMContentLoaded", nav);
```

— so a nav message already fires on every navigation, including back/forward (popstate). The UI's nav branch
(`Browser.tsx:257-260`) keeps only the path and title.

## The fix shape

The app's frame is Chromium (Electron), which has the Navigation API: `navigation.canGoBack` / `navigation.canGoForward`
are exactly the truth the buttons need, across reloads and traversals, with no counters to drift. The probe reports
them with each nav message; the UI disables the buttons from that state. Where the API is absent (a dev build opened
in Firefox/Safari), the fields are omitted and the buttons stay enabled — today's behaviour, no regression.

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders, L13's regions.
- Tests first: source tests in a new `engine/test/browser-history.test.ts` (the stylesheet/file-as-text pattern of
  `engine/test/layout-rules.test.ts`; engine tests already read both `ui/src` and `engine/src` files — see
  `engine/test/browser-frame.test.ts`). Test commands need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push.

## Steps

### 1. The probe reports its place in history

In `engine/src/proxy.ts`, extend `nav()` (:489) to carry the two flags when the Navigation API is present:

```js
  const nav = () => post({ kind: "nav", path: location.pathname + location.search + location.hash, title: document.title,
    // Where the page stands in its history, for Back and Forward's grey (the Navigation API is Chromium's; elsewhere
    // the fields stay out and the buttons stay pressable, as they were).
    ...(window.navigation ? { back: navigation.canGoBack, forward: navigation.canGoForward } : {}) });
```

Keep the listeners as they are — popstate/hashchange/DOMContentLoaded/pushState/replaceState already re-post. The
back/forward command handlers (:644-645) stay bare `history.back()`/`history.forward()`: the resulting popstate
re-reports the flags. Do not add counters or sessionStorage.

**Test first:** source test "the Browser probe reports canGoBack and canGoForward with its nav messages" — read
`engine/src/proxy.ts`, assert the nav() region contains `navigation.canGoBack` and `navigation.canGoForward`. Fails before.
**Verify:** `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/browser-history.test.ts` and the
existing proxy tests (`engine/test/proxy*.test.ts` — find them by name) pass; `npm run typecheck` exits 0.

### 2. The buttons take the state

In `ui/src/app/Browser.tsx`:
- Add `const [hist, setHist] = useState({ back: true, forward: true });` beside the other toolbar state (true until
  the first nav message — today's behaviour).
- In the onMsg "nav" branch (:257-260), after the path/address updates:
  `setHist({ back: d.back === undefined ? true : Boolean(d.back), forward: d.forward === undefined ? true : Boolean(d.forward) });`
  (omitted fields mean a browser without the API — keep pressable).
- The two buttons (:670,:673): add `disabled={!hist.back}` / `disabled={!hist.forward}`. Keep their aria-labels; the
  grey is the existing `.lc-ib:disabled` look the zoom buttons already use (verify the class has a disabled style —
  read the `.lc-ib` rules in `surfaces.css`; if none exists, add one quiet opacity rule in place beside the zoom
  buttons' treatment, comment why).
- When the target changes to a different port/page (`go`, openServer), reset hist to {true,true} until the new page's
  first nav message — find where `setTarget`/`setLogs([])` happen on a new load and reset beside them.

**Test first:** source test "Back and Forward are disabled from the page's own history state" — assert `Browser.tsx`
contains `disabled={!hist.back}` and `disabled={!hist.forward}` and the nav branch sets hist. Fails before.
**Verify:** tests, `npm run typecheck`, `npm run build` exit 0.

### 3. See it (or say "not seen")

In the measuring build (plans/layout/README.md's Demo-only dev build) or the real app: open the Browser surface on a
plain HTML page (no server needed — `browser_open` takes a file; the Demo sample has pages) → Back and Forward grey;
navigate to a second page → Back pressable; press Back → Forward pressable, Back grey again; reload → state holds.
If you cannot run a browser, write "not seen" in the note — do not claim it.

## Done

- `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/browser-history.test.ts` passes, both
  tests seen to fail before their changes; the existing proxy tests still pass.
- `npm run typecheck` and `npm run build` exit 0.
- One commit, the message above. Executor note: commit, seen/not-seen, any STOP.

## STOP conditions

- The probe's nav() no longer matches the cited shape (substance): stop, report.
- `window.navigation` is somehow absent in the app's own frame (check the Electron version's Chromium): the fallback
  keeps buttons enabled — report it, do not invent counters.
- The iframe's sandbox blocks the Navigation API (it should not — it is same-origin scripting in the probe): stop and
  report what the console says.

## Maintenance note

The flags ride the existing nav message — any future navigation reporting (e.g. a title change) keeps them for free.
If the probe ever moves out of proxy.ts, the source test's file path moves with it.
