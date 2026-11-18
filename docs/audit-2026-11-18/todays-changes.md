# Audit: today's changes (uncommitted sessions sidebar + 2026-11-17/18 commits)

Scope read: `git diff` of the 15 modified files, the untracked `contracts/src/doing.ts`, `engine/test/doing.test.ts`, `ui/src/app/SideList.tsx`; `ui/src/app/design/Tabs.tsx` and `ui/src/app/security/Side.tsx` in full; `desktop/src/finish.ts` and the quit parts of `779de1c` (main.ts, tray.ts); spot checks of `de80da8`'s security UI and CHANGELOG/README.
`node --test engine/test/doing.test.ts`: 20 of 20 pass (7.7 s).

What the uncommitted work does: the engine works out a short "doing" line for each running session (`doingOf` in contracts/src/doing.ts) as each of the lead's steps starts. It sends at most one about every 700 ms, says "Thinking" or "Writing its answer" only after a finished step's words have stood for 2.5 s, and clears it on every way a turn can end or wait. It keeps it in memory only (`Store.setDoing`, not saved, dropped on load) and ships it on `Thread.doing` over the normal `thread` event. The three faces draw their lists from shared parts (SideList.tsx). Code gets a "Sessions" heading with By folder / By status (Needs you, Working, groups, Complete), two-line rows whose second line is `Thread.doing` while working, and a counts pill in the top row. Design and Security use the same parts.

---

### 1. Every step of any running session re-renders App, the whole sidebar and 12 other `s.threads` readers (new today)
- category: perf
- severity: medium
- confidence: confirmed
- where: engine/src/store.ts:435-445 (`setDoing` emits `{ type: "thread" }`); ui/src/app/engine.ts:186-192 (`upsert(state.threads, …)`, so the array is new each time); ui/src/app/Sidebar.tsx:177-178, 253-256, 291-322, 325-343; ui/src/app/App.tsx:149, 785-792
- evidence:
  - store.ts: `this.state.threads[i] = next; this.emit({ type: "thread", thread: next });`
  - engine.ts: `case "thread": … return set({ threads: upsert(state.threads, e.thread) });`
  - `git grep -l "useEngine((s) => s.threads)"`: App, Browser, Compare, Projects, Sidebar, Wall, design/DesignHome, design/Shell, design/Tabs, design/Ways, security/Overview, security/Side (14 uses).
  - Sidebar.tsx:343, the plate's layout effect: `}, [current, list, archivedList, view, shutProjects, shutForks, renaming, groups, Boolean(faceBody)]);` where `list` is a new array on every thread event.
- what goes wrong: before this change a running turn sent few `thread` events (status, clock, eta). Now each running session sends about 1.4 a second while it works, plus Thinking and Writing. Each one re-renders App (which rebuilds the up-to-200 palette items at App.tsx:785 because `threads` is in its deps), the whole Sidebar (every row is a plain function call, none is memoised, and each row renders its own snooze `<Pop>`), re-filters and re-sorts `list`, `byBucket` and `tree`, and runs the plate's `useLayoutEffect` again: it disconnects and re-creates a ResizeObserver and forces a layout with two `getBoundingClientRect` calls. Five sessions running with 150 in the list means about 7 full-app renders a second for one changed line of grey text. The engine side is cheap; the UI is where it costs.
- fix: send the line on its own event (`{ type: "doing", threadId, doing }`), keep `doings: Record<id, string>` beside `threads` in the UI store, and have the row's second line be a tiny `<DoingLine id>` that selects only `s.doings[id]`. `Thread` keeps no `doing` field, so nothing else re-renders. A cheaper alternative is to have the store keep the old `threads` array identity when only `doing` changed and expose `doing` through a separate selector.
- effort: M
- risk of the fix: Design Tabs and Security Side read `t.doing` too (Tabs.tsx:168, Side.tsx:119, 125), so they move to the new selector. doing.test.ts asserts on `thread.doing` and needs adapting. Check that a reconnect (`hello`) seeds `doings`.

### 2. Liner Design shows a failed or limited session as "At rest" (new today)
- category: bug
- severity: medium
- confidence: confirmed
- where: ui/src/app/design/Tabs.tsx:90, 99-103, 168, 173-174
- evidence: `const state: SideState = s?.status === "running" ? "working" : s?.status === "waiting" ? "needs" : "done";` and `const STATUS = [["Needs you","needs"],["Drawing","working"],["At rest","done"]]`
- what goes wrong: a design whose session ran into a problem, or hit its plan's limit, gets the small grey "done" dot labelled "At rest". The row is quiet, and its second line says "12 frames". By status files it under "At rest". Code (Sidebar.tsx:238, `asks()`) and Security (Side.tsx:116) both show the error mark or the clock and put the session in Needs you. On the Design side the user only finds out when they open the tab.
- fix: map `error` to "error" and `limited` to "limited" in `standOf`. Give them a second line ("Ran into a problem", "Hit its plan's limit") and rank them with "needs" in STATUS, as Code's `asks()` does.
- effort: S
- risk of the fix: the ⌃Tab ring order uses the same rank (`laidOut`), so check that it still walks the list as drawn.

### 3. Naming a frame reads the design file from disk on every update of the latest canvas call (new today)
- category: perf
- severity: low
- confidence: confirmed
- where: engine/src/runtime.ts:3239-3246 (`frameName`), 3378-3392; contracts/src/doing.ts:298, 358; engine/src/canvas.ts:523-539, 424-454
- evidence: `const frameName = (frame, design) => { … return lookFile(t.worktree?.path ?? store.project(t.projectId).path, design).frames.find(…)?.name; … }`. `lookFile` runs `existsSync`, `statSync`, `readFileSync(design.json)`, `JSON.parse`, then `sync()`: an `lstatSync` per drawn frame, a `readdirSync(frames/)` and a `readFileSync` of each loose frame.
- what goes wrong: `doingOf(steps, frameName)` runs on each `tool` update of the lead's latest call while it runs. That is before the 700 ms throttle, so even words that are then dropped cost the reads. For any `design_tree`, `design_node`, `design_shot` or `design_frame` call with an id and a design, and for any edit under `.liner/designs/*/frames/`, that is a synchronous file-system walk of the whole design on the engine's event loop. A design with 60 frames costs 60+ stats a call. The comment says "read only when a step writes a frame", but the canvas read tools call it too.
- fix: memoise per turn by `design` (a `Map<design, DesignFile>`) and drop the entry when the step is a write (`framesChanged` already exists). Alternatively, resolve the name only when `doing()` is actually about to send.
- effort: S
- risk of the fix: a frame renamed mid-turn would show its old name until the cache drops. That is harmless for a status line.

### 4. Rows jump, with no motion, as they start or stop working; By status remounts them (new today)
- category: ux
- severity: low
- confidence: confirmed
- where: ui/src/app/Sidebar.tsx:306-307, 803-807; ui/src/app/security/Side.tsx:230; app.css:8538 (`.lc-sl-row { animation: lc-row-in … }`)
- evidence: `const rank = (t) => (asks(t) ? 0 : works(t) ? 1 : 2); const here = [...].sort((a, b) => rank(a) - rank(b) || newest(a, b));`; By status: `block("Needs you", …)`, `block("Working", …)`, `block("Complete", …)` are separate `<section>`s.
- what goes wrong: in By folder, sending a message hops the row to the top of its folder, and finishing drops it back (Security's folders do the same). In By status, each permission ask moves the session from Working to Needs you and back. Because the row changes parent section, React unmounts and remounts it, so its 180 ms fade plays again each time. The plate re-measures and snaps, with no transition (app.css:1201). With several sessions asking for approvals, the list reshuffles under the pointer, and a click can land on the wrong row.
- fix: the smallest change is to stop ranking working above the rest inside a folder (order by your sort only, keep needs-first if wanted) and to keep By status sections but key rows so a section change doesn't replay `lc-row-in` (`data-fresh`-style "seen" flag for every row already drawn). A FLIP on reorder is the fuller fix.
- effort: S (rank/flag) or M (FLIP)
- risk of the fix: the mockup asked for needs first, so confirm with the owner which order is wanted.

### 5. The doing line swaps abruptly; the CSS comment says it fades (new today)
- category: polish
- severity: low
- confidence: confirmed
- where: ui/src/app/app.css:8586-8598; ui/src/app/SideList.tsx:179-183
- evidence: `.lc-sl-sub { … /* A new state fades in over the old one's place: no letters sliding or popping. */ animation: lc-row-in 160ms ease-out backwards; }`. The span has no key and is only re-rendered with new text.
- what goes wrong: a CSS animation runs once, on mount. When `sub` changes from "Reading Sidebar.tsx" to "Running npm test", the text node changes in place, so there is no fade, even though the comment says there is. The line flicks every 0.7 to 2.5 s on every working row.
- fix: if a fade is wanted, `<span key={String(sub)} className="lc-sl-sub">`; if not, delete the comment. Also add `.lc-sl-sub` to the reduced-motion list (app.css:6268 lists `.lc-sl-row` only).
- effort: S
- risk of the fix: a remount per change is cheap, but add it to the reduced-motion block.

### 6. The top-row pill leaves out Liner Security's sessions, though The Wall shows them (new today)
- category: bug
- severity: low
- confidence: likely (that Wall shows security threads is read from its `onTheWall` filter, Wall.tsx:45, which has no `security` test)
- where: ui/src/app/Sidebar.tsx:177-178, 276-278, 543, 561
- evidence: `const threads = useMemo(() => everyThread.filter((t) => !t.security), [everyThread]); … const onWallNow = threads.filter((t) => onTheWall(t, now));`. The pill's comment: "the sessions on The Wall that work".
- what goes wrong: a running scan, or a fix waiting on you, appears on The Wall, in the tray and in the Dock count (App.tsx:362-373 use all threads). The pill that opens The Wall says nothing about it, in every face, including Security itself.
- fix: compute `onWallNow` from `everyThread`.
- effort: S
- risk of the fix: none beyond the count changing.

### 7. Quit when they finish can wait for ever on an engine that stops answering
- category: bug
- severity: low
- confidence: likely (assumes a wedged engine where the TCP connection stays open)
- where: desktop/src/main.ts:338-343 (`engineRpc`), 885-911 (`checkWaiting`)
- evidence: `const r = await fetch(`http://127.0.0.1:${engine.port}/rpc`, { method: "POST", … });` (no signal, no timeout). `if (!w || checking) return; checking = true; try { const s = await engineRpc("state.get", {}) … } finally { checking = false; }`
- what goes wrong: if the engine is alive but stuck (a sync loop, a hung `writeAtomic`), the first `state.get` never settles. `checking` stays true, so every 3 s tick returns at once. The app sits with no window and no Dock icon, and quits only if the user finds the tray item and presses Quit Now. A crash is fine: fetch rejects and the next tick retries.
- fix: `fetch(…, { signal: AbortSignal.timeout(5000) })` in `engineRpc`, or in `checkWaiting` only.
- effort: S
- risk of the fix: other `engineRpc` callers (the tray's menu) would also get the timeout. That is also an improvement.

### 8. The step words now live in three places that must agree (new today)
- category: refactor
- severity: low
- confidence: confirmed
- where: contracts/src/doing.ts:18, 293-336 (NOT_STEPS, isStep, commandOf, canvasDoing, readable); ui/src/app/Timeline.tsx:80-91, 649, 708-718 (CARD_TOOLS, DESIGN_TOOLS, isStep, commandOf, readableFrame, canvasStep); ui/src/app/design/Chat.tsx:105-137 (`useNow` builds its own "doing" from the timeline)
- evidence: doing.ts's comments point at the copies by name five times: "(Timeline.tsx's CARD_TOOLS and DESIGN_TOOLS)", "(Timeline.tsx's isStep)", "(Timeline.tsx's readableFrame)", "(as Timeline.tsx's commandOf reads it)", "(Timeline.tsx's canvasStep)".
- what goes wrong: a new card tool or canvas tool added to Timeline.tsx and not to doing.ts makes the sidebar call a card a step, or the reverse. Liner Design's chat header (`useNow`) and its sidebar row (`Thread.doing`) are worked out separately, so they can disagree at the same moment: the chat says "Opus is drawing Phone / Week" from presence while the row says "Thinking".
- fix: export `isStep`, the card-tool set and `readable` from contracts/doing.ts and import them in Timeline.tsx. Have Chat.tsx's short line use `thread.doing?.text` when it is set.
- effort: S to M
- risk of the fix: Timeline's isStep takes a `Tool` while doing's takes a `DoingCall`; `Tool` satisfies `DoingCall`, so the types fit.

### 9. `Thread.doing.at` is written and never read (new today)
- category: dead
- severity: low
- confidence: confirmed
- where: contracts/src/index.ts:388; engine/src/runtime.ts:2208
- evidence: `doing?: { text: string; at: number }`. `grep -rn "doing?\.at\|doing\.at\b" ui/src engine/src contracts/src` finds nothing. Every reader uses `.text`.
- what goes wrong: an extra field that changes on every send; nothing uses it.
- fix: make it `doing?: string`, or drop `at`. Do this together with finding 1 if that lands.
- effort: S
- risk of the fix: doing.test.ts shapes.

### 10. Old CSS with no markup, left beside today's rewrite of app.css
- category: dead
- severity: low
- confidence: confirmed
- where: app.css:1391-1405 (`.lc-sb-fdot`), 1548-1590 (`.lc-sb-team-list`, `.lc-sb-agent`, `.lc-sb-agent-t`); face.css:20-61 (`.lc-sb-face`, `.lc-sb-face-b`); dock.css:584-595 (`.lc-sb-more`, `.lc-sb-more-pop`); design-face.css (`.ld-bubble`, `.ld-head`, `.ld-sheet`, `.ld-sheet-h`, `.ld-tile`, `.ld-tiles`, `.ld-tile-frame`, `.ld-tile-pic`, `.ld-tl`); `@keyframes lc-row-in` is defined twice (app.css:1291, surfaces.css:5026)
- evidence: I extracted every `.lc-sb*`, `.lc-sl*`, `.lc-carry*`, `.lc-mk*`, `.ld-*` and `.ls-*` class from the CSS and ran `grep -rlw <class>` over ui/src *.ts/*.tsx (untracked files included). Those are the only ones with no hit. `git grep -lw <class> HEAD -- 'ui/src/**/*.tsx'` is also 0, so they predate today. Everything the old sidebar used (`.lc-sb-h`, `-time`, `-st`, `-lab`, `-plab`, `-view(s)`, `-bar`, `-pneeds`, `-add`, `data-two`) is gone from both CSS and TSX: today's rewrite cleaned up after itself.
- what goes wrong: dead selectors in a 8800-line stylesheet.
- fix: delete them.
- effort: S
- risk of the fix: none (no markup, no querySelector use).

### 11. The three faces' lists differ in small ways that look accidental (new today)
- category: ux
- severity: low
- confidence: confirmed
- where: Sidebar.tsx:525-529 vs design/Tabs.tsx:181-189 vs security/Side.tsx:103-113; Sidebar.tsx:1714 vs Side.tsx:119; Side.tsx:285-298; Tabs.tsx:168 vs Sidebar.tsx:1708
- evidence:
  - Arrow keys: Code's rows move with ArrowUp and ArrowDown (`rowKeys`). Design's rows are `role="tab"` in a `role="tablist"` with no arrow handling (the tablist pattern expects arrows). Security's rows have none.
  - Limit: Code says `Hit its plan's limit, back at 14:00`; Security says `Hit its plan's limit` with no time.
  - Error: Code says "Ran into a problem" (danger tone). A Security fix says `Stopped · 2h` (no tone) under a mark whose label is "Ran into a problem".
  - Counts: Security's "Fixes" label has a count, but "Scans" and "Asked about" don't.
  - Empty text: Design uses `s?.doing?.text ?? "Drawing"`, Code and Security use `||`.
  - The folded-folder dot's label is always "A session here needs you", even in Design ("designs").
- what goes wrong: the shared parts were meant to make the three read as one. These are the places they still don't.
- fix: put the second-line rules for waiting, limited and error in one helper in SideList.tsx (`liveLine(t, now)`) that all three call. Add ArrowUp/ArrowDown to `SideRow`'s pick, or to the list root, once. Pass `what` into the folder's needs and working labels.
- effort: S
- risk of the fix: Code's `rowKeys` also handles P, D and S. Keep those in Code only.

### 12. CHANGELOG has nothing for the two feature commits or the new sidebar
- category: polish
- severity: low
- confidence: confirmed
- where: CHANGELOG.md:3-48; README.md
- evidence: the newest entry is "0.2.8 (beta), 2026-11-17" (commit 258c3ed). 779de1c (Check my tools, prompt check, quit when they finish, time left) and de80da8 (Liner Security) came after it and have no entry. `grep -i "security\|quit when\|check my tools" README.md` finds only macOS's "Privacy & Security". The 0.2.8 text also says "Carry on: one row at the top of the sidebar's list", which the uncommitted tree replaces with a row in the Sessions menu.
- what goes wrong: the next release's notes have to be rebuilt from the commits.
- fix: add an Unreleased section now: Security face, Check my tools, the prompt check, quit when they finish, the time left, and the Sessions list with its live second line.
- effort: S
- risk of the fix: none.

### 13. Security's dev-only mock data is bundled into the build
- category: dead
- severity: low
- confidence: likely (that rollup keeps it is assumed: these are static imports whose call sites are guarded at run time, not at build time)
- where: ui/src/app/security/data.ts:7; ScanSession.tsx:32, 92-93; StartScan.tsx:24
- evidence: `import { MOCK, mockAnswer } from "./mock";` and `import { mockMode, mockScan, type MockScan } from "./scan-mock";`. Compare findings-data.ts:22, which loads its mock on demand: `void import("./findings-mock")`.
- what goes wrong: the mockup's sample boards (mock.ts, 138 lines; scan-mock.ts, 136 lines) ship in the app's JS even though `mockMode()` returns null outside dev.
- fix: load them with `import()` behind `import.meta.env.DEV`, as findings-data.ts does.
- effort: S
- risk of the fix: dev mock pages need an extra tick to load.

### 14. While the Reviewer reads, the row just says "Working"
- category: ux
- severity: low
- confidence: confirmed
- where: engine/src/runtime.ts:1646-1648 (`doneDoing` at turn end), 1817 (`patchThread(threadId, { status: "running", verdict: { state: "checking" … } })`); Sidebar.tsx:1708
- evidence: `const doing = t.status === "running" ? t.doing?.text || "Working" : "Working";`. The Reviewer's read sets status running but no doing line, and `doing()` refuses it because no turn is in `this.turns`.
- what goes wrong: for up to REVIEW_MS (10 min) after a turn, the row's live line falls back to a bare "Working", the one moment the user most wants to know why it's still busy.
- fix: in `reviewNow`, call `store.setDoing(threadId, { text: "The Reviewer is reading", … })` right after the patch to running. It is cleared by the next status change, since putThread drops it.
- effort: S
- risk of the fix: none (setDoing only takes while running).

### 15. Carry on's focus may end on the hidden trigger after Escape
- category: ux
- severity: low
- confidence: suspected (depends on whether Pop gives focus back to its trigger after CarryOn's effect has run; needs a run)
- where: ui/src/app/Sidebar.tsx:1503-1516, 1522-1535
- evidence: `<span ref={holder} className="lc-sb-carry-at" aria-hidden> <Pop … triggerAttrs={{ tabIndex: "-1" }} …>`. The effect moves focus to `.lc-sl-head-b` when `holder.current?.contains(document.activeElement)`.
- what goes wrong: if Pop's own focus restore runs after this effect, focus lands on a 1 px, opacity-0, aria-hidden button. A screen reader announces nothing, and the next Tab starts from an invisible place.
- fix: give Pop a `returnFocus` (or `onClosed`) option, and have CarryOn point it at the heading's menu button instead of correcting afterwards.
- effort: S
- risk of the fix: Pop is shared, so test that other popovers still return focus to their own trigger.

---

## In good shape (checked, found fine)
- **The line stays live only while a turn runs.** It is never left standing as "Working": `doneDoing` runs on `end`, `error`, `limited`, Stop, a thrown sink end (runtime.ts:1486) and the `finally` of every turn (1648). `putThread` drops `doing` for any status but running (store.ts:418). `Store` load clears it (store.ts:278). `setDoing` refuses a non-running thread. Rewind is only allowed once stopped (api.ts:1248). Every test for these passes.
- **No disk write per step.** `setDoing` emits but doesn't `save()`. A later save may carry the line into state.json by chance, and load clears it; the comment says so.
- **Throttle and timers.** One pending timer and one "think" timer per thread, both cleared in `doneDoing`. The `doingSent` entries go in the turn's `finally`, so the map doesn't grow. Timer callbacks check that the entry is still theirs.
- **Waiting on you.** `needsYou` pauses the line and keeps the last words. An allowed step says them again, while a refusal, a question or a plan says "Thinking". `askLiner`, `askQuestions` and the PR-test approval set waiting without pausing, but `putThread` clears the line and late timers are refused by `setDoing`, so nothing shows wrong.
- **Nothing secret in the line.** `commandWords` reads the command the way a shell does, refuses `$(`, backticks, heredocs and unknown wrapper flags, names only known subcommands, and says file names only when they are plain. I tried `git clone https://token@…`, `make PASSWORD=x`, `docker login -u u -p p`, `echo hunter2`, `env -S` and `$CMD`, and none leaks.
- **doing.test.ts** covers the step words, gathered reads, cards, frame names, commands, cutting, the throttle, Think and Write timing, Stop, problem, thrown turn, limit, approval allowed or refused, question, restart, agents' own calls, and the Demo provider end to end. It does not cover `askLiner` or `askQuestions` mid-turn, or a queued message starting the next turn (a different finally/new-turn order); both read fine in code.
- **Old-sidebar leftovers in TSX.** Every import in Sidebar.tsx is still used. `rowState`, `projectName`, `active`, the `two` option and the `EtaLeft` use on rows are gone. EtaLeft.tsx is still used by Timeline.tsx. demo-shots.mjs was moved to `.lc-sl-title`. App's `sidebarOrder` and focus rules still match `.lc-sb-row` and `.lc-sb-pick`.
- **finish.ts's decision logic** is sound. Only sessions working at quit, those that start later, or those with a live ask are waited for. A 2.5 s settle covers a queued message or the Reviewer starting, and the Reviewer sets status running (runtime.ts:1817). Logging out passes through `before-quit` while waiting.
- **Mocks in Security.** No TODO, FIXME or `console.log` in the new engine files (doctor, precheck, edits, security*, finish). Mocks only answer under `import.meta.env.DEV` plus `?ls-mock`.

## Not done
- No run of the app, so the visual claims (the jump in 4, the swap in 5, the focus in 15) are read from the code, not watched.
- de80da8's engine (security-scan.ts, 1027 lines; security.ts; bring-in; checks) and 779de1c's doctor.ts (898 lines), precheck.ts and edits.ts were only spot-checked for mocks and TODOs, not reviewed line by line. The area auditors for engine and security should cover them.
- b54ec47 (Carry on reading plain session files, see-through window, keys) was not reviewed beyond its file list.
- I didn't measure render times; the cost in 1 is counted from the code paths.
