# 021. Browser's Back and Forward go back in their own page, and are grey when there is nowhere to go

**Commit message:** `The Browser's Back and Forward move its own page, even beside another session's, and are grey when there is nowhere to go`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Refreshed 2026-11-20 at 13c7757 after the advisor's review.
Finding: UI-13, plus a fault the audit missed: Back does nothing once another frame has moved.

## What the review changed

- Back and Forward now go through the Navigation API (`navigation.back()` / `navigation.forward()`), so the button's
  state and its action read the same history. Before, the flags were to come from the Navigation API while the
  buttons still called `history.back()`.
- A fault the audit missed, seen in a scratch Electron 44.9.3 probe: every frame in the app's window shares ONE
  session history. Once another frame has moved after this one, both `history.back()` and `navigation.back()` from
  the Browser's sandboxed frame are refused (details under "What was seen"). The probe now falls back to opening that
  entry's address itself.
- The executor first proves `navigation` exists inside the Browser's sandboxed frame, with a real-Electron desktop
  test that also covers two frames. If `navigation` is absent: STOP.
- Disabled `.lc-ib` had no look at all (`app.css:388-417`). The bar copies `dock.css:116`'s pattern (0.4,
  `cursor: default`) and turns off the hover wash.
- Tests point at the real files: `engine/test/browser.test.ts` (the served probe), `engine/test/browser-frame.test.ts`
  (a pure helper and the wiring), and a new `desktop/test/browser-history.test.ts` beside `browser-zoom.test.ts`.
  `engine/test/proxy*.test.ts` does not exist.

## Why this matters

- On the first page loaded, Back looks pressable and does nothing; so does Forward at the newest page. The two
  buttons (`ui/src/app/Browser.tsx:670-675`) carry no `disabled`. They post `cmd("back")` / `cmd("forward")` (:276)
  into the frame, whose probe answers with a bare `history.back()` / `history.forward()` (`engine/src/proxy.ts:644-645`).
- Worse, other sessions' Browser frames stay alive in the same window (`HiddenBrowsers`, `Browser.tsx:88-100`), and
  add-on and design frames navigate too. All of them share the window's one session history. When any other frame
  has navigated after this one, Back in this frame is silently refused, even though this frame has a page behind it.

## What was seen (scratch probe, Electron 44.9.3, two frames with the Browser's `sandbox` list)

- `typeof navigation` is `"object"` inside both sandboxed frames. `canGoBack` / `canGoForward` follow each frame's
  own entries (a frame on its first page: false / false; after one link: true / false).
- One frame alone: `history.back()` and `navigation.back()` both work.
- B goes b1 → b2, then A goes a1 → a2, then Back is pressed in B:
  - `history.back()` changes nothing (B stays on b2, A on a2).
  - `navigation.back()` rejects: `SecurityError: Navigating to key … would require a navigation that violates this
    frame's sandbox policy`.
  - `navigation.navigate(<b1's url>)` from B works: B shows b1 and A stays on a2.
- Without the `sandbox` attribute, B's `history.back()` moved A instead. That is why the sandbox refuses it.
- An `element.click()` gives a click event whose `detail` is 0 (used by plan 018, recorded here because it was seen
  in the same run).

## Current state (drift check)

```bash
git log --oneline -1                                # 13c7757 or later
sed -n 670,675p ui/src/app/Browser.tsx              # the two buttons, no disabled
sed -n 252,260p ui/src/app/Browser.tsx              # onMsg; the "nav" branch keeps path only
sed -n 803,814p ui/src/app/Browser.tsx              # the iframe: key={`${src}#${nonce}`}, sandbox list without allow-top-navigation
sed -n 489,494p engine/src/proxy.ts                 # the probe's nav() and its listeners
sed -n 644,645p engine/src/proxy.ts                 # back/forward commands
sed -n 116,119p ui/src/app/dock.css                 # the disabled pattern to copy
```

The probe's nav reporting as it stands (`proxy.ts:489-493`):

```js
  const nav = () => post({ kind: "nav", path: location.pathname + location.search + location.hash, title: document.title });
  for (const k of ["pushState", "replaceState"]) { const o = history[k].bind(history); history[k] = (...a) => { const r = o(...a); nav(); return r; }; }
  addEventListener("popstate", nav);
  addEventListener("hashchange", nav);
  addEventListener("DOMContentLoaded", nav);
```

The probe also calls `nav()` at its end and on the `hello` command (:650, :652), and it reports every unhandled promise
rejection to the Browser's console (:488). So every promise this plan starts must be caught.

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, or the untracked folders.
- A provider-adjacent engine file changes (`proxy.ts`), so the real-Electron desktop test below is the check. No
  agent CLI is involved.
- Test commands need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit with the message above. Never push.

## Steps

### 1. Prove the API is there (before writing any fix)

Create `desktop/test/browser-history.test.ts` and `desktop/test/browser-history.app.cjs`, shaped like
`browser-zoom.test.ts` / `browser-zoom.app.cjs`: the same `electron` / `skip` lines, a `CASE {json}` line per case, and
the `ELECTRON_RUN_AS_NODE` stripped from the env.
- The `.test.ts` starts the REAL proxy: `new Proxies().files(dir)` from `../../engine/src/proxy.ts`
  (`desktop/test/signed.test.ts` already imports engine source). `dir` is a temp folder holding `a1.html`, `a2.html`,
  `b1.html` and `b2.html`, each with a `<title>` and a link `<a id="next" href="…2.html">` on the 1 pages. The test
  passes the proxy's base URL to the app in an env var and calls `proxies.closeAll()` at the end.
- The `.app.cjs` serves a host page from its own 127.0.0.1 server, so the app and the pages are different sites, as in
  the app. The host page holds two iframes named `A` and `B` with the Browser's exact sandbox list
  (`allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads`, `Browser.tsx:813`),
  pointing at `${base}/a1.html` and `${base}/b1.html`.
- The host keeps each frame's last `__liner` "nav" message (`e.source` is that frame's window), and sends commands as
  the Browser does: `frame.contentWindow.postMessage({ __linerCmd: "back" }, "*")`.
- It drives links with `wc.mainFrame.frames.find((f) => f.name === "B").executeJavaScript("next.click()", true)` and
  waits about 900 ms after each step. It reports `location.pathname` and `typeof navigation` from each frame.
- Window options as in `browser-zoom.app.cjs`: `show: false`, `sandbox: true`, `contextIsolation: true`.

The first test, "Both of the Browser's sandboxed frames have the Navigation API", asserts `typeof navigation` is
`"object"` in A and B. It passes today (seen in the scratch probe). **If it fails, STOP the whole plan and report:**
without the API the flags cannot be known, and this plan adds no counters.

### 2. The probe reports its place and steps through its own history, test first

In `engine/src/proxy.ts`:

- Extend `nav()` (:489):

```js
  // Where the page stands in its own history, for Back and Forward's grey (the Navigation API knows this frame's entries;
  // without it the fields stay out and the buttons stay pressable, as they were).
  const place = () => (window.navigation ? { back: navigation.canGoBack, forward: navigation.canGoForward } : {});
  const nav = () => post(Object.assign({ kind: "nav", path: location.pathname + location.search + location.hash, title: document.title }, place()));
```

- Replace the two bare commands (:644-645) with a `step` helper defined above the message listener:

```js
  /*
    Back and Forward in this frame's own history. Every frame in the app's window shares one history: once another frame
    has moved since (another session's Browser kept behind), the sandbox refuses the step, since it would move that frame
    too (SecurityError; history.back() is refused without a word). Then this frame opens that entry's address itself,
    which loses the entries ahead of it but lands where Back said.
  */
  const step = (by) => {
    if (!window.navigation) return void (by < 0 ? history.back() : history.forward());
    const to = navigation.entries()[navigation.currentEntry.index + by];
    if (!to || !to.url) return;
    const r = by < 0 ? navigation.back() : navigation.forward();
    r.finished.catch(() => {});
    r.committed.catch((err) => { if (err && err.name === "SecurityError") navigation.navigate(to.url).finished.catch(() => {}); });
  };
```

  and `if (c === "back") step(-1); else if (c === "forward") step(1);`.
- Fall back only on `SecurityError`. An abort while the page unloads must not start a second navigation.
- Keep every listener as it is. A same-document traversal re-reports through popstate; a cross-document one loads a
  new page, which reports on DOMContentLoaded.
- Do not add counters or sessionStorage.

**Tests first:**
- In `engine/test/browser.test.ts`: "The Browser's probe reports where the page stands in its history and steps
  through the Navigation API". Serve a folder with `new Proxies().files(root)` as the "files:" test at :73 does. Fetch
  `${base}/__liner/probe.js` and assert the body contains `navigation.canGoBack`, `navigation.canGoForward`,
  `navigation.back()`, `navigation.forward()` and `SecurityError`. It fails before: the served probe has none of them.
- In the desktop test, behaviour in real Electron:
  - "A page on its first load says it has nowhere to go back or forward": B's first nav message has `back: false,
    forward: false`. This fails before, because the fields are absent.
  - "After a link, the page says Back has somewhere to go, and Back then Forward return it": B b1 → b2 gives
    `back: true`. Back shows b1 with `forward: true`; Forward shows b2.
  - "Back in one Browser goes back in that page even after another Browser has moved": B b1 → b2, then A a1 → a2, then
    Back to B. B shows b1 and A still shows a2. This fails before: with `history.back()`, B stays on b2. That mechanism
    was seen in the scratch probe; run the test against the unchanged probe once and record the failure.

**Verify:** `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/browser.test.ts` and
`env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test desktop/test/browser-history.test.ts` pass; the desktop
test PASSES, not skips. `npm run typecheck` exits 0.

### 3. The buttons take the state

- In `ui/src/app/browserFrame.ts`, add a pure helper with a one-line comment:
  `export const historyOf = (d: Record<string, unknown>) => ({ back: d.back !== false, forward: d.forward !== false });`
  A field the page left out (a browser without the API) means pressable.
- In `ui/src/app/Browser.tsx`:
  - Beside `nonce` (:139), add `const [hist, setHist] = useState({ back: true, forward: true });`.
  - In the onMsg "nav" branch (:257-260), after the path and address updates, add `setHist(historyOf(d));`.
  - A new frame is a new history. The iframe is keyed `${src}#${nonce}` (:805), so add
    `useEffect(() => setHist({ back: true, forward: true }), [src, nonce]);` with a comment saying the buttons stay
    pressable until the new page says where it stands.
  - The two buttons (:670, :673) get `disabled={!hist.back}` / `disabled={!hist.forward}`. Keep their aria-labels.
- In `ui/src/app/surfaces.css`, right after the `.lc-br-bar` rule (:555-561), copy `dock.css:116`'s pattern and turn
  off `.lc-ib`'s hover wash (`app.css:412-416`):

```css
/* Back or Forward with nowhere to go: greyed as the dock's disabled buttons are (dock.css), without the hover's wash. */
.lc-br-bar .lc-ib:disabled {
  opacity: 0.4;
  cursor: default;
}
@media (hover: hover) {
  .lc-br-bar .lc-ib:disabled:hover {
    background: none;
    color: var(--l-ink-3);
  }
}
```

  `--l-ink-3` is `.lc-ib`'s resting colour (`app.css:398`). "Open in your browser" (:727) sits in the same bar and
  takes the same grey when it is disabled, which is consistent. The zoom buttons are in a Pop, outside the bar, and
  do not change.

**Tests first** (`engine/test/browser-frame.test.ts`, which already imports `browserFrame.ts`):
- "A page that says nothing of its history keeps Back and Forward pressable, and one that says it cannot go back greys
  Back": `historyOf({})` and `historyOf({ back: false, forward: true })`. It fails before: there is no export.
- "The Browser's Back and Forward take their grey from the page's history": read `Browser.tsx` and assert it contains
  `disabled={!hist.back}`, `disabled={!hist.forward}` and `setHist(historyOf(`. Read `surfaces.css` and assert a
  `.lc-br-bar .lc-ib:disabled` block with `opacity: 0.4`. It fails before.

**Verify:** tests, `npm run typecheck`, `npm run build` exit 0.

### 4. See it (or say "not seen")

In the measuring build (plans/layout/README.md's Demo-only dev build) or the real app, open the Browser surface on a
plain HTML page from a session's folder:
- Back and Forward are grey, and pointing at them shows no wash.
- Follow a link: Back is pressable. Press Back: Forward is pressable and Back is grey again.
- Reload: the state holds, since a probed reload keeps the frame (`Browser.tsx:279-287`).
- If another session's Browser can be made to navigate meanwhile, Back still moves this page.
- Do not claim a step you did not see.

## Done

- `engine/test/browser.test.ts`, `engine/test/browser-frame.test.ts` and `desktop/test/browser-history.test.ts` pass;
  the desktop test passes rather than skips, and each new test was seen to fail before its change.
- `npm run typecheck` and `npm run build` exit 0.
- One commit with the message above. Executor note: the commit, the desktop test's result, seen or not seen, and any
  STOP.

## STOP conditions

- Step 1's first test fails (`navigation` absent in a sandboxed frame): stop the whole plan and report. Do not invent
  counters.
- The probe's nav() or command handler no longer matches the cited shape (substance): stop and report.
- The fallback `navigation.navigate` is also refused in the desktop test: stop and report what it says. The scratch
  probe saw it work.

## Maintenance note

The flags ride the existing nav message, so any future navigation reporting keeps them for free. Accepted cost: when
the fallback runs, the frame's entries ahead of it are dropped, as after any new navigation. A test of the probe's
behaviour lives in `desktop/test/browser-history.test.ts`. If the Browser's `sandbox` list changes (`Browser.tsx:813`),
change it there too.
