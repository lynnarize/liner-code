# Audit: Design face and Security face (ui/src/app/design, ui/src/app/security, Design.tsx, DesignMini.tsx)

Read-only. Paths are relative to `ui/src/app/` unless they start with another root. `tsc --noEmit` (with the repo's own `noUnusedLocals`) is clean for this area, so there are no unused imports or locals; the dead-code items below are unused *exports* and props, found with `git grep -w <name>` across the whole repo.

---

### 1. Dragging or resizing a frame re-renders the whole Design face, synchronously, on every pointer move
- category: perf
- severity: high
- confidence: confirmed
- where: design/store.ts:421-425 (`patchFrames` → `setNow`), store.ts:872-885 (`place`), Canvas.tsx:370-385 (onMove → `design.place`), DesignFace.tsx:239, Tabs.tsx:149 (new today)
- evidence:
  - `const patchFrames = (fn) => { ... setNow({ file: { ...file, frames: file.frames.map(fn) } }); };`. `setNow` notifies every listener at once, skipping the rAF batching that `set` gives pan and zoom (store.ts:77-91).
  - `DesignFace`: `const file = useDesign((s) => s.file);`. This is the face's root component, and none of its children (TopRow, Rail, Canvas, Dock, Inspector, LeanLayer) is memoised.
  - 28 components select `s.file` itself (`git grep -n "useDesign((s) => s.file)"`): BuildTab ×3, Chat, ChecksTab, Dock, Layers ×2, LeanPage ×2, Live ×2, Pictures ×3, Ways ×2, Canvas, DesignFace, and the new `OpenDesigns` in Tabs.tsx:149, which re-renders the whole sidebar list and runs its `knowFrames` effect.
  - The module subscribers also run on each move: checks.ts:443 `look` (hashes every frame's html), BuildTab.tsx:68, Live.tsx:107, Skills.tsx:446, leanwalk.ts:191.
- what goes wrong: every `pointermove` during a frame drag (60-120 per second) builds a new `file` object and synchronously re-renders the face, the inspector, the dock and the sidebar's open-designs list. With 30 frames the drag lags behind the pointer. Pan does not have this problem, because it goes through `set`, which batches once per frame.
- fix: send the drag's intermediate `place` calls through `set` (rAF-batched) and keep `setNow` for the final `done` call. Narrow the selectors that only need the id or a count: `OpenDesigns` needs `s.file?.id` plus `s.file?.frames.length`, and `DesignFace` needs only `s.file?.id`/`title`. `memo()` the face's big children (Inspector, Dock, Rail).
- effort: M
- risk of the fix: a frame-size drag reads `getDesign().file` in `startLabel` and `fit`, so check that labels, handles and the Changed marks still follow the frame during a drag. Check that undo is still one step per drag.

### 2. Resizing a node by its edge, and scrubbing an inspector number, writes the frame's file on every pointer move
- category: perf
- severity: medium
- confidence: confirmed
- where: Canvas.tsx:451-459 (`sizeNode`), design/inspect/controls.tsx:161-180 (`Num` scrub), design/inspect/target.ts:87, store.ts:716-793 (`apply`)
- evidence:
  - Canvas: `sizeFrame.current = requestAnimationFrame(() => { ... void design.apply(c.frame, [{ id: c.id, style: c.style }], { coalesce: `size:${c.id}` }); });`
  - controls.tsx: `onChange(clamp(v0 + d), key);` sits inside an `el.addEventListener("pointermove", move)` handler, and target.ts:87 then does `void design.apply(f, list, ...)`, with no rAF limit at all.
  - For a drawn frame, each `apply` makes these calls: `frames.apply` (postMessage), then `rpc("canvas.frame.apply")` (a disk write, a new revision and a `canvas.changed` event), then `keepSource` (a second rpc, `canvas.frame.read`), then `refreshNode` and `refreshTree` (two more bridge round trips).
- what goes wrong: one second of dragging is roughly 60 file writes, 60 reads and 120 bridge questions. `inOrder` queues the writes per frame, so the queue can still be draining after you let go. Every write's `canvas.changed` also triggers the fan-out in finding 6 (design.all, build.state, canvas.versions).
- fix: during a gesture, apply only in the frame (`frames.apply`) and keep the newest ops. Send a single `canvas.frame.apply` on pointerup (a node-size drag) or after a 150 ms trailing debounce (a Num scrub). Coalescing already makes the gesture one undo step, so undo does not change.
- effort: M
- risk of the fix: if the page reloads mid-gesture, the in-frame-only change is lost. Check undo after a scrub, and check what happens when an agent writes the frame mid-drag (the N2 "moved" path).

### 3. Two fast edits on a live frame can lose the first one from `pending`
- category: bug
- severity: medium
- confidence: likely (assumed link: two `apply` calls overlap. They do with a Num scrub or a slider, which call `apply` per move without awaiting it, see finding 2)
- where: design/store.ts:720-726
- evidence:
  ```ts
  if (f.kind === "live") {
    const pending = { ...state.pending, [frame]: [...(state.pending[frame] ?? []), ...ops] };
    await frames.apply(frame, ops).catch(() => undefined);
    setNow({ pending });
  ```
- what goes wrong: `pending` is built from `state` before the await. Call A builds `[a]`, then call B builds `[b]` (A has not set yet), then A sets `[a]`, then B sets `[b]`. Op `a` is gone from the changes held for the live page. The page on screen still shows it, but "Send to code" and the selection sent to the agent (`selectionOf` includes `pending`) do not include it. Live.tsx's origin tracking (`ops.slice(was.length)`) also assumes `pending` only grows.
- fix: build `pending` after the await: `setNow({ pending: { ...state.pending, [frame]: [...(state.pending[frame] ?? []), ...ops] } })`.
- effort: S
- risk of the fix: none that I can see. Test: scrub a number on a live frame, then open Send to code.

### 4. Switching quickly between two designs of one project can leave a tab stuck on "Opening the design file"
- category: bug
- severity: medium
- confidence: likely (assumed link: the second open's rpc calls finish before the first's, e.g. the first design has more frames to read)
- where: design/store.ts:618-672 (`open`), store.ts:548-580 (`show`), DesignFace.tsx:242, 339-351
- evidence: the only staleness guard in `open` is the folder: `if (state.cwd !== cwd) return;` (lines 625 and 658). Nothing checks that a later `open` for another file of the same folder has started since. `show` then gives up quietly: `if (parkKey !== key || state.cwd !== cwd || state.file?.id !== file) return;`.
- what goes wrong: tab A (many frames) and tab B (few) are in the same project, so both have the same cwd. Press ⌃Tab twice fast (the new sidebar-order ⌃Tab makes this easy). `open(B)` lands, then `open(A)` lands after it and wins `setNow({ file: A ... })`, and also points `watchFile` and `listenCanvas` at A. Tab B is the one showing, but `mine` is false (`s.file?.id === tab.file`), so DesignFace shows the "Opening the design file" shimmer until you switch tabs again. A's undo stack also starts afresh.
- fix: add a sequence number to `open`: `const seq = ++openSeq;` and after each await `if (seq !== openSeq) return;`.
- effort: S
- risk of the fix: `create` and `adopt` call `open` and then read `state.file`, so check that they still see their file.

### 5. Once a design is opened, the store never lets it go: its watch, a 4 s build poll and the hidden checks keep running in the Code face and after every tab is closed
- category: perf
- severity: medium
- confidence: confirmed
- where: design/store.ts:693-697 (`close`), BuildTab.tsx:64-85, checks.ts:395-455, store.ts:504-512
- evidence:
  - `git grep -n "design\.close()" -- ui/src` finds nothing. The method is never called. Closing a tab (Tabs.tsx:31-37) only calls `design.forget(key)`, and Home and the Code face never reset the store.
  - BuildTab: `beat = window.setInterval(() => document.visibilityState === "visible" && void refreshBuilds(), 4000);`. This runs while `s.file` is set, whatever face is showing.
  - checks.ts: `subscribeDesign(look)` is installed once and runs `runChecks` in hidden iframes up to 12000 px tall whenever a frame's html changes.
- what goes wrong: open a design, then go back to the Code face or close its tab. The engine keeps a `canvas.watch` on that file, the UI asks `build.state` (which diffs every built frame against its project file) every 4 s for as long as the window is visible, and each agent write to that design re-runs the checks in hidden frames nobody looks at.
- fix: when the last design tab closes, call `design.close()`. Also, stop the BuildTab beat and the checks while `getFace() !== "design"`: both modules can read the `face` the store already holds, and start again when the face comes back.
- effort: S
- risk of the fix: the Code face's Design panel (DesignMini) has its own read, so it is not affected. Check that Build marks and check counts appear when you come back to the face.

### 6. Every `canvas.changed` from any folder fans out into three or four RPCs, filtered by nothing, for the window's lifetime
- category: perf
- severity: medium
- confidence: confirmed
- where: DesignHome.tsx:341-376, BuildTab.tsx:86-90, Versions.tsx:88-97
- evidence:
  - DesignHome: `if (!hearing) { hearing = true; onStream((e) => { if (e.type === "canvas.changed") relist(); }); ... }`. This is never unsubscribed, and `relist()` calls `rpc("design.all")`, which lists every project's designs.
  - BuildTab: `onStream((e) => { if (e.type !== "canvas.changed") return; ... refreshBuilds() }, 300)`. There is no cwd or file filter.
  - Versions: `onStream((e) => void (e.type === "canvas.changed" && setN((x) => x + 1)))`, which refetches `canvas.versions` 400 ms later, for any file.
- what goes wrong: an agent drawing in any design, or a scrub on the canvas (finding 2), causes a `design.all` about every 150 ms plus a `build.state` and a `canvas.versions` for the open file, even when the change was to another design or the Design face is not showing. The sidebar is lazy-loaded, so this starts the first time Design Home is visited, then lasts until the window closes.
- fix: filter BuildTab and Versions on `e.cwd === state.cwd && e.file === state.file?.id`. Have DesignHome's listener unsubscribe when its last `useListed` user unmounts (it already counts users in `listFns`), and only relist on `canvas.changed` events that add, remove or rename a file (e.g. `!e.frame`, or `e.gone !== undefined`).
- effort: S
- risk of the fix: frame counts on the sidebar rows (`knowFrames`) come from `design.all`. Check that they still update when an agent adds a frame (an index change has no `frame`).

### 7. Pan and zoom re-render every overlay component, and the store's readers scan every frame's HTML on every notification
- category: perf
- severity: medium
- confidence: likely (not measured; the cost scales with frame count and page size)
- where: Canvas.tsx:95, 483-506, 566-627, 663-665; Layers.tsx:118; DesignFace.tsx:226; checks.ts:367
- evidence:
  - Only `Frame` is `memo` (`grep -n "memo(" design/*.tsx`). Each pan frame re-renders Canvas, and for every frame on the page also `WayLabel`, `LiveMark`, `CheckLabel`, `FrameMark` and `CompareOver`. `CheckMarks`, `PictureOver` and `WaysOver` re-render too, because they get a new `boxOf` closure each time.
  - `labelRoom(i)` calls `boxOf` for every other frame, so that is n² per render.
  - Three selectors run `blankHtml` on every drawn frame on every store notification: Canvas.tsx:95 `blanks`, Layers.tsx:118 and DesignFace.tsx:226 `EmptyHint`. `blankHtml` does `html.replace(/<script\b[\s\S]*?<\/script>/gi, "")`, which copies the whole page each time.
  - checks.ts `sigOf` hashes up to 4096 characters of every frame on every notification.
- what goes wrong: with 30 frames of 50 KB each, one pan or zoom frame copies about 1.5 MB of strings (×2 or ×3, once per selector) and renders about 150 components that do not change. Panning a big design drops frames.
- fix: work out `blank` once per html change in the store (a `blank: Record<id, boolean>` set wherever `html` is set), and read it in all three places. Wrap the label children in `memo`, and give Canvas a stable `boxOf` (read pan and zoom from a ref, or position the overlay in plane units inside a layer that has the same transform).
- effort: M
- risk of the fix: a `blank` flag kept in the store has to be updated on every path that sets `html`: open, reloadFile, redrawFromFile, keepSource, scrub, addFrame, copyFrames, unremoveFrames and mock.

### 8. `security/scan-mock.ts` ships in the production bundle; the other two mocks do not
- category: dead
- severity: low
- confidence: confirmed
- where: security/ScanSession.tsx:32, security/StartScan.tsx:24, security/scan-mock.ts
- evidence:
  - Who uses each export:
    - `mockMode`: ScanSession.tsx:85 and StartScan.tsx.
    - `mockScan` and `MockScan`: ScanSession.tsx.
    - `mockChoices`: StartScan.tsx.
    - `mock.ts`'s `MOCK` and `mockAnswer`: only data.ts (used by Overview and Projects).
    - `findings-mock.ts`'s `mockFindings`: only a dynamic `import()` in findings-data.ts:22.
  - In today's build (`ui/dist/assets/Shell-CMcQoVwZ.js`, Nov 18 16:22): `grep -l "fix/tide-midnight\|claude-mythos\|Anyone signed in can read another"` matches. `grep -l "harbour-notes\|The station id goes"` (mock.ts and findings-mock.ts) matches nothing. `mockMode()` returns `null` when `!import.meta.env.DEV`, but the bundler cannot see through a function's return value, so `mockScan` and `mockChoices` stay in.
- what goes wrong: no real user sees mock data. Every mock path is gated on `import.meta.env.DEV` and the `?ls-mock` query, and no screen shows a mock in a build. The cost is a few KB of sample text in the bundle, plus dev-only branches in shipped code, for example StartScan.tsx:166-172, which on a failed start creates a real thread tagged `scan: "mock"`.
- fix: make it `const asked = import.meta.env.DEV ? mockMode() : null`, or load `scan-mock` through `import.meta.env.DEV ? await import("./scan-mock") : null`, the way findings-data does. Then the build drops the module.
- effort: S
- risk of the fix: none in a build. The dev boards C to F still need checking with `?ls-mock=d`.

### 9. Security pages refetch on every scan progress event, and some refetch on every security event at all
- category: perf
- severity: low
- confidence: confirmed
- where: security/store.ts:102-109, 114-120; Side.tsx:74; Projects.tsx:177; Overview.tsx:34-35
- evidence:
  - `onSecurity((e) => { const what = e.type === "security.scan" ? ["scans"] : e.what; if (!on || what.some((w) => on.includes(w))) setTick((n) => n + 1); })`, with no debounce.
  - `security.side` (the sidebar, always mounted in the face), `security.overview`, `security.projects` and the findings list for each opened card in Projects pass no `on`, so they refetch on every event.
  - The engine sends `security.scan` on every `patchScan` (engine/src/security.ts:479). That includes each area moving from reading to read (security-scan.ts:840) and each finding counted (security.ts:492, where `countOn` → `patchScan` comes in the same tick as `changed(["findings"])`).
  - `useScan` refetches `security.scans.list` on each `security.scan`, though the event already carries the record it then uses.
- what goes wrong: during a scan, each finding causes about two refetches of every mounted security query (sidebar, overview, projects, each card's findings). That is harmless with a few findings and a storm with an imported SARIF file or a chatty scan.
- fix: coalesce `setTick` per hook with a 150 ms trailing timer. Give `security.side` and the Projects card an `on` list. In `useScan`, call `useSecurity` with `on: []` semantics, since the live event already updates the record.
- effort: S
- risk of the fix: a page that relied on the catch-all refresh (the sidebar's GitHub row) needs the right `on` kinds ("projects", "findings", "scans").

### 10. Layers marks and folds by node id across frames, so a copied frame lights up and opens with its original
- category: bug
- severity: low
- confidence: likely (assumed link: a copy keeps the same `data-l` ids. engine/src/canvas.ts:935-939 `copyFrame` passes the source html through, and canvas.ts:952 says ids "come from the page itself", so a copy gets the same ones)
- where: design/Layers.tsx:120-146, 85-104
- evidence: `const picked = useMemo(() => new Set(sel.map((x) => x.node)...))` and `open` are one `Set<string>` of bare node ids (frame ids too). Lines 93 and 104 test `picked.has(c.id)` and `open.has(c.id)` without checking the frame.
- what goes wrong: duplicate a frame (⌘D) and open both in Layers. Picking a layer in one frame marks the same layer in the copy as selected, and opening a stack in one opens it in the other.
- fix: key both sets by `${frame}:${id}`.
- effort: S
- risk of the fix: the auto-open loop at lines 128-136 must add keys in the same form.

### 11. The new Security sidebar ignores a failed `security.side` and has no loading state
- category: ux
- severity: low
- confidence: confirmed
- where: security/Side.tsx:74, 263-296 (new today)
- evidence: `const { data } = useSecurity("security.side", {});`. `error` and `loading` are dropped. "No scans yet" shows only `data && !all.length`, and the Findings count is `data?.open ?? 0`.
- what goes wrong: while it loads, or if the call fails (engine away, an unreadable store), the Sessions list is blank with no word, the Findings badge is missing and the GitHub and report rows have no second line. Nothing says anything went wrong.
- fix: show a one-line "Couldn't read Security: <error>" in the list area when `error && !data`, and a quiet shimmer row while `loading && !data`.
- effort: S
- risk of the fix: none.

### 12. "Drop a SARIF file here", but nothing takes a drop
- category: polish
- severity: low
- confidence: confirmed
- where: security/Side.tsx:327 (carried into today's rewrite from the old row)
- evidence: `sub={data?.sarif.open ? ... : "Drop a SARIF file here"}`. `git grep -n -i "onDrop" -- ui/src/app/security` finds nothing. The only way in is the file input in Findings.tsx:138-151 ("Pick a file").
- what goes wrong: the copy promises something that does not work. A file dropped on the row does nothing (or Electron navigates to it).
- fix: change the copy to "Pick a SARIF file", or add an `onDrop` that does what `BringIn`'s input does.
- effort: S
- risk of the fix: none.

### 13. Findings shows nothing while its list loads
- category: ux
- severity: low
- confidence: confirmed
- where: security/Findings.tsx:349-355
- evidence: `{!list ? (error ? <div className="ls-none">…didn't load…</div> : null) : …}`
- what goes wrong: on first open, or when switching project scope, the area under the filters is empty until the answer comes, and the tab counts read 0, 0, 0. It looks like "nothing found" for a moment.
- fix: render a shimmer line ("Reading the findings") in the `null` branch.
- effort: S
- risk of the fix: none.

### 14. Dead exports and a dead prop
- category: dead
- severity: low
- confidence: confirmed
- where and how checked (`git grep -nw <name> -- . ':!ui/dist'` across the whole repo; each matches only its own definition):
  - design/store.ts:301 `heldRedraws` ("for a probe"). It is not on `window.__ld` (store.ts:1144 exposes only getDesign, design and frames), and no script uses it.
  - design/Frame.tsx:211 `heldMarks`: same as above.
  - design/Skills.tsx:212 `useLoadedCount`.
  - security/parts.tsx:158 `ChoiceBox` (about 70 lines with its markup) and parts.tsx:233 `NotBuilt`.
  - design/DesignFace.tsx:112 `cwdOf`. The only other hits are engine/src/agent-tools.ts, an unrelated method of the same name.
  - Prop: security/Shell.tsx:39 passes `{...(page.scan ? { scan: page.scan } : {})}` to `Findings`, whose props (Findings.tsx:158) have no `scan`. Findings reads the scan from `useSecurityPage()` instead.
- fix: delete them. If the two probes are wanted for the check scripts, put them on `window.__ld`.
- effort: S
- risk of the fix: none (type-checked).

### 15. Small maps that only grow
- category: bug (leak)
- severity: low
- confidence: confirmed
- where: design/store.ts:187 `mine` (every revision this window wrote; never pruned), design/Tabs.tsx:48 `frames` (new today: `knowFrames` sets a key for every design `design.all` lists, and a closed tab's key is never deleted), Pictures.tsx:79 `more` and `made`
- evidence: `mine.add(r.rev)` at store.ts:458, 757, 811 and 1020 has no matching delete. Tabs.tsx: `frames.set(key, n)`, with no delete in `close()`.
- what goes wrong: memory grows slowly over a long session. `mine` gains one entry per save, so a long scrub (finding 2) adds hundreds.
- fix: cap `mine` (drop the oldest past 500, or clear a frame's revisions when `forgetFrame` runs). Delete the `frames` key in Tabs' `close()`.
- effort: S
- risk of the fix: `mine` decides "this change is ours". A cap that is too small would turn an old own revision into "someone else changed it", but 500 is far more than any queue holds.

### 16. An agent's redraw parses the frame's page twice on the main thread, inside render
- category: perf
- severity: low
- confidence: suspected
- where: design/Frame.tsx:219-233 (`useMemo` → `planOf`), Frame.tsx:136-186
- evidence: `a = p.parseFromString(before, "text/html"); b = p.parseFromString(after, "text/html");`, then `sigOf` for every `[data-l]` element, which sorts all its attributes. This runs in `useMemo` during render, once for every agent write that redraws the frame.
- what goes wrong: an agent writing a large page in many pieces makes each redraw block the render for the parse (tens of ms for a big page), on top of the iframe's own reload.
- fix: skip `planOf` when `before.length + after.length` is over a threshold (e.g. 400 KB) and use `{ mode: "whole" }`. Or move it to an effect, because the plan is only needed for the settle script.
- effort: S
- risk of the fix: the settle animation must still get its plan before the iframe gets `srcDoc`, so a threshold is safer than moving it.

---

## In good shape (checked and found fine)

- **Frame bridge (design/bridge.ts):** answers are accepted only from the asked frame's own `contentWindow` (`portOf(e.source)`), with a pending question number and the expected kind. Keys come over a MessageChannel tied to a random per-document key, never over plain postMessage. `detach` fails pending questions at once. The single window `message` listener is installed once on purpose. I found no bridge that is left pointing at a closed frame: `attach` and `detach` compare the element.
- **Frame.tsx:** memoised, and it reloads its document only on a new `rev`, `base` or kind. The pan/zoom transform never re-creates iframes. Drawn frames are sandboxed without `allow-same-origin`.
- **DesignMini.tsx:** caps live iframes (MAX_LIVE and MAX_IN_VIEW, using IntersectionObserver), swaps two iframes so nothing flashes, and disconnects its observers. It reads with `peek` and pairs `canvas.watch` on and off.
- **Design.tsx's probe listener** checks `e.source` against its iframe, and every ResizeObserver and IntersectionObserver in this area is disconnected in cleanup.
- **Undo history** is capped at 200 (store.ts:171), and tabs' parked state is released on close (`design.forget`).
- **Agent redraw bookkeeping** (`redraws`, `marks`) expires after 4 s and is cleared on file switch.
- **Security mocks:** gated on `import.meta.env.DEV` and `?ls-mock`. `mock.ts` and `findings-mock.ts` are not in the build (checked in ui/dist). No screen shows mock data to a real user (see finding 8 for the one file that ships).
- **Findings filters and sorting** are memoised. Findings and finding lists are short enough that not windowing them is fine today.
- **SecurityShell** waits for a session that is coming in, then goes back to the Overview if it never does, so a deleted scan does not leave a blank page.
- **A running scan can be stopped from the UI** (ScanSession.tsx:243 `security.scan.stop`, or `thread.stop` once it is a chat).
- **`design/Compare.tsx` and `app/Compare.tsx`** are not duplicates: one overlays the running app on a built frame, the other compares several models' worktrees. They share no code.
- **Today's Tabs.tsx rewrite:** ⌃Tab follows the sidebar's own order through `laidOut`, which both use, so they cannot drift. Opening a folded folder for the current design works. Middle-click close keeps its guard. Apart from findings 1 and 15, it is sound.
- **Today's Layers.tsx and DesignHome.tsx changes** are straight swaps to `SideLabel`. `DesignFiles` lost its `onSearch` prop and its caller (App.tsx:855) was updated to match.
- `noUnusedLocals` and `noUnusedParameters` are on, and tsc is clean for this area.

## What I did not get to

- I read only parts of Ways.tsx (557 lines), Skills.tsx, LeanPage.tsx, lean.ts, leanwalk.ts, CodeTab.tsx and ChecksTab.tsx, for subscribers and timers. I did not read their logic line by line.
- I did not read the inspect/ section components (Size, Layout, Fill, Effects, Corners, Text, css.ts, convert.ts) beyond `controls.tsx`'s Num scrub and `target.ts`.
- I skimmed Design.tsx (the Code-face design surface) past line 470 and the security Overview.tsx, OpenChart.tsx, Projects.tsx, FoundPanel.tsx, Questions.tsx and FindingPanel.tsx for effects and data flow only.
- Nothing was measured in a running app. The perf findings rest on reading the code: 1 and 2 are certain from the code, and 7 needs a profile to size.
