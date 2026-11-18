# Audit: UI panels and surfaces (ui/src/app top level)

Scope read in full: Browser.tsx, agentBrowser.ts, Terminal.tsx, Wall.tsx, Crew.tsx, Pr.tsx, PrCard.tsx, Review.tsx, Files.tsx, Commit.tsx, Ship.tsx, Addon.tsx, Device.tsx, launch.ts, panelLife.ts. Skimmed (effects, rpc calls, listeners): AddonsPage, AgentDialog, Agentic, Models, Modes, Usage, Projects, Env, Precheck, Updates, Compare and the small helpers. None of my files is modified in the working tree (`git status` shows only files owned by others), so nothing here is "(new today)".

The root of findings 1 to 4: `Session.tsx:846-847` hands the dock `useItems(thread.id)`, the full item list, which is a new array on every streamed word (engine.ts:386-390 says so). `Panel` re-renders and calls `body()` for every mounted tab, hidden ones too (Panel.tsx:137-166, :230). The surfaces below take that `items` prop and do work that scales with the thread, or with the file or diff, on every token. Panel itself belongs to another auditor. Each fix below sits in the surface.

---

### 1. Review redraws the whole diff, every line row, on every streamed word
- category: perf
- severity: high
- confidence: confirmed
- where: ui/src/app/Review.tsx:166, :170, :219-234, :334-338, :543-569
- evidence:
  ```
  export function Review({ thread, items, focus, onFocus }: ...
  const cps = useMemo(() => checkpointsOf(items), [items]);
  const asked = useMemo(() => { for (const it of items) { ... items.find(...) ... items.filter(...) } }, [items, ...]);
  const subs = items.filter(...)
  const carries = (p, r) => r.new !== undefined && (asked.some(...) || findings.list.some(...) || ...)
  shown.map((p) => ... p.segs.map((s) => ... s.rows.map((r) => lineRow(p, r, ...))))
  ```
- what goes wrong: with the wide Review open while the agent answers, each token re-runs `asked` (O(items × anchored questions)) and then re-renders every visible diff row with its `<Toks>` spans. `lineRow` and `carries` scan `asked` and `findings.list` once per row. A 2,000-line diff means about 2,000 rows rebuilt per token, so it janks exactly while the session streams.
- fix: read `useItemsWhere(thread.id, isCheckpoint)` for `cps`, and a module-level view (user-with-anchor, review, task, plus the text of anchored turns) for `asked`, `findings` and `subs`. Pull each file's body into a `memo` component keyed on `(p, open-for-file, sel-for-file, notes-for-file)`. Build per-file maps of questions and findings by line once, not a `.some` per row.
- effort: M
- risk of the fix: a question's streaming answer must still update. Test an anchored question answered while the diff is open, and J/K stepping.

### 2. Files redraws the open file's every line on every streamed word, while hidden too
- category: perf
- severity: high
- confidence: confirmed
- where: ui/src/app/Files.tsx:103, :121, :229, :354-364
- evidence:
  ```
  export function FilesSurface({ thread, items, onShowChanges, reveal }
  const cps = useMemo(() => checkpointsOf(items).filter((c) => !c.reverted), [items]);
  const turnItem = c ? items.find(...) : undefined;
  {lines.map((_, i) => (<div key={i} className="lc-cl" ...><Toks line={toks[i]} />...
  ```
- what goes wrong: the engine sends text up to 2 MB (`SHOWS_UP_TO`), so a 10k-line file is 10k `div`s with token spans. All of them re-render on each token of a reply, and also when the Files tab is open but behind another tab (Panel keeps it mounted). Nothing is windowed.
- fix: use `useItemsWhere(thread.id, isCheckpoint)` plus a small turn-items view instead of `items`. Move the `<pre>` body into a `memo` component on `(lines, toks, marks, hl)`. For large files, render only a window of lines (or `content-visibility: auto` on chunks of about 200 lines).
- effort: S for the items and memo part, M with windowing
- risk of the fix: the `goto` scroll uses `code.current.children[hl-1]`; chunking changes that lookup.

### 3. The Agents surface rebuilds the crew from the whole timeline on every streamed word
- category: perf
- severity: medium
- confidence: confirmed
- where: ui/src/app/Crew.tsx:715-721, :1236-1243
- evidence:
  ```
  export function AgentsSurface({ thread, items }: ...
    const crew = useMemo(() => crewOf(items.filter(isCrewItem), thread, profiles, providers), [items, thread, profiles, providers]);
  // SessionUse:
    const tools = items.filter((x) => x.kind === "tool").length;
    const turns = items.filter((x): x is Turn => x.kind === "turn");
  ```
- what goes wrong: `useCrew` (line 168) already exists for this: it reads `useItemsWhere(thread.id, isCrewItem)` so it doesn't redraw per word. AgentsSurface bypasses it and refilters the full list (three passes) on every token, then re-renders the tree, Lanes and SessionUse, also when the tab is hidden.
- fix: `const crew = useCrew(thread)`. Give AgentView a `useItemsWhere(thread.id, isSubagent)`-style view (it needs agents and turns only). Count tools and turns in SessionUse from a view, or from `thread.usage`.
- effort: S
- risk of the fix: AgentView's `part` lookup needs turn items; include `turn` in the view. Test opening one agent while it runs.

### 4. Each streaming Wall tile re-reads its whole timeline on every token
- category: perf
- severity: medium
- confidence: confirmed
- where: ui/src/app/Wall.tsx:476-480, :216-246
- evidence:
  ```
  const items = useItems(t.id);
  const info = useMemo(() => infoOf(t, items), [t, items]);
  function infoOf(t, items) { const last = turnsOf(items).at(-1)?.items ?? []; ... briefOf(text.text) ...
  ```
- what goes wrong: the Wall exists to show several sessions working at once. Each running tile runs `turnsOf` over its full item list, plus the regexes of `briefOf` on the latest text, once per token. With five long sessions streaming, that is five whole-timeline passes per token, though a tile shows only the last turn's 4 steps.
- fix: find the last turn's start once (scan from the end for the last `user` or `turn` item) and slice, rather than `turnsOf(items)`. Compute `brief` only when `kind === "done"`, since working tiles don't show it.
- effort: S
- risk of the fix: `turnsOf` may group items in ways a plain slice doesn't (queued user messages). Keep `turnsOf`, but call it on `items.slice(lastTurnStart)`.

### 5. Terminal sends a pty resize on every animation frame while the panel slides or is dragged
- category: perf
- severity: medium
- confidence: confirmed
- where: ui/src/app/Terminal.tsx:270-283
- evidence:
  ```
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      ...
      fitKeepingEnd(t, f);
      if (idRef.current) void rpc("term.resize", { id: idRef.current, cols: t.cols, rows: t.rows }).catch(() => {});
  ```
- what goes wrong: while the bottom panel opens or the panel grip is dragged, each frame refits xterm (reflowing up to 5,000 rows of scrollback) and sends `term.resize`, whether or not cols and rows changed. The engine resizes the pty (api.ts:1841), so the shell gets SIGWINCH as the width changes and zsh, vim or a CLI agent redraw on every frame.
- fix: keep the last sent `{cols, rows}`, send only when it changes, and send on a trailing 100 ms debounce. Fit locally each frame if wanted, or only at the end.
- effort: S
- risk of the fix: TUIs must still get the final size. Test opening, dragging and closing the bottom panel with `htop` running.

### 6. The Device log restarts its `log stream` process on every keystroke in the filter
- category: bug
- severity: medium
- confidence: confirmed
- where: ui/src/app/Device.tsx:74-84, :245; engine/src/surfaces.ts:733-738
- evidence:
  ```
  useEffect(() => {
    if (!udid || !booted || !logOn) return;
    void rpc("device.log", { udid, on: true, filter: filter.trim() || undefined })
    ...
    return () => { off(); void rpc("device.log", { udid, on: false }) };
  }, [udid, booted, logOn, filter]);
  // engine: set(...) { this.live.get(udid)?.kill(); ... spawn(this.tool, ["simctl","spawn",udid,"log","stream",...]) }
  ```
- what goes wrong: typing "MyApp" kills and spawns `xcrun simctl spawn … log stream` five times, with two rpcs per letter. Lines from the stream being replaced still arrive in between.
- fix: debounce the filter (about 400 ms) into a separate state, and use that in the deps.
- effort: S
- risk of the fix: none worth naming.

### 7. The Device screen keeps taking a simulator screenshot every 1.1 s while the window is hidden or minimised
- category: perf
- severity: medium
- confidence: confirmed
- where: ui/src/app/Device.tsx:52-71
- evidence:
  ```
  if (!visible || !booted || !udid) return;
  const tick = async () => { const r = await rpc("device.shot", { udid }); ... t = window.setTimeout(tick, point ? 4000 : 1100); };
  ```
- what goes wrong: `visible` is the dock tab's visibility, not the window's. With the app in the background, a `simctl io screenshot` runs and a base64 PNG crosses the bridge about once a second, indefinitely. (launch.ts:22 does check `document.visibilityState`.)
- fix: skip the rpc when `document.hidden` and reschedule. Also restart on `visibilitychange`.
- effort: S
- risk of the fix: none.

### 8. Each console line the page logs re-renders the whole Browser surface; open, the console rebuilds all 200 rows
- category: perf
- severity: medium
- confidence: confirmed
- where: ui/src/app/Browser.tsx:234, :849-854
- evidence:
  ```
  if (d.kind === "console") setLogs((l) => [...l.slice(-199), { level: ..., text: ..., at: ... }]);
  logs.map((l, i) => (<div key={i} className="lc-br-log lc-mono" ...>
  ```
- what goes wrong: a dev page that logs in a loop (an animation frame, a noisy HMR client, a polling fetch) sets state up to 60 times a second. Each one re-renders the bar, both Pops, LaunchRows and the stage. With the console open, the index keys shift after 200 lines, so every row re-renders and `toLocaleTimeString` runs 200 times per message.
- fix: buffer incoming lines in a ref and flush once per animation frame. Key rows by a running sequence number. Move the console into its own `memo` component.
- effort: S
- risk of the fix: `now.current.logs` feeds the agent's `read` errors. Keep the ref current.

### 9. Routines.tsx ships in the main chunk although Routines are switched off
- category: dead (bundle)
- severity: low
- confidence: confirmed
- where: ui/src/app/Panel.tsx:42; ui/src/app/App.tsx:46
- evidence:
  ```
  Panel.tsx:42  import { RoutinesList, RunDetail } from "./Routines";
  App.tsx:46    const RoutinesPage = lazy(() => import("./Routines").then(...));
  ```
  `ui/dist/assets` has a `RoutineBuilder-*.js` chunk (90 KB) but no Routines chunk. Routines is inside `index-*.js` (1.04 MB).
- what goes wrong: the static import from Panel defeats App's lazy import, so 336 lines of off code parse on every start. RoutineBuilder (470 lines plus WorkflowBuilder) stays lazy, so it doesn't load at start.
- fix: lazy-load `RoutinesList` and `RunDetail` in Panel the way it loads Terminal (behind `ROUTINES_ON`). No Routines code changes.
- effort: S
- risk of the fix: a `run:` tab from before the switch-off then needs a Suspense fallback.

### 10. The PR surface asks GitHub again every time its tab is hidden
- category: perf
- severity: low
- confidence: confirmed
- where: ui/src/app/Pr.tsx:365-386
- evidence:
  ```
  useEffect(() => { ... void get(); void rpc("pr.picture", ...); const t = visible ? window.setInterval(get, 30000) : 0; ... }, [thread.id, n, visible]);
  ```
- what goes wrong: switching from the PR tab to another runs `pr.status` and `pr.picture` (gh and git) again, for a surface nobody sees. Switching back runs them a third time.
- fix: split it into two effects: the fetch on `[thread.id, n]` and when `visible` becomes true, and the interval on `visible`.
- effort: S
- risk of the fix: none.

### 11. The Browser remembers only the first path it opened in a project, not the page you were on
- category: ux
- severity: low
- confidence: confirmed
- where: ui/src/app/Browser.tsx:197-211, :235-238
- evidence:
  ```
  useEffect(() => { if (!target) return; keep(key, target); ... }, [where, connected, retry]);   // where = port
  else if (d.kind === "nav") { setTarget((t) => (t ? { ...t, path } : t)); ...
  ```
- what goes wrong: in-page navigation updates `target.path`, but the save effect runs only when the port changes. After a restart, or coming back to the project, the Browser opens the old path, though the comment at :173 says "the page you had open last".
- fix: save `target` in its own effect on `[key, target?.port, target?.path, target?.server]`.
- effort: S
- risk of the fix: none.

### 12. The "ask about this element" card doesn't follow zoom, device width or panel resize
- category: polish
- severity: low
- confidence: confirmed
- where: ui/src/app/Browser.tsx:520-528
- evidence: `const card = useMemo(() => { ... f.left - s.left + picked.rect.x * scale ... }, [picked]);`
- what goes wrong: pick an element, then change Zoom or Desktop/Tablet/Phone, or drag the panel wider. The card stays where the element used to be, over the wrong part of the page.
- fix: add `scale`, `width` and `room` to the deps, or clear `picked` when they change (as `pointer` is cleared at :363).
- effort: S
- risk of the fix: none.

### 13. Every useLaunch reads launch.json again on any folder's server event
- category: perf
- severity: low
- confidence: confirmed
- where: ui/src/app/launch.ts:35-50; users at Browser.tsx:146, Crew.tsx:383, :729, design/Live.tsx:342, :461
- evidence: `useEffect(() => onStream((e) => void (e.type === "launch" && setN((x) => x + 1))), []);`
- what goes wrong: a server starting in project A makes every mounted Browser (hidden ones included), Agents surface and crew popover in every session rpc `launch.list`, which reads the file. It is cheap per call but scales with open surfaces.
- fix: if the event carries the folder or thread, filter on it. Otherwise coalesce with a 150 ms timer.
- effort: S
- risk of the fix: check the `launch` event's shape in contracts first.

### 14. Rarely opened panels sit in the main chunk; only Terminal and SessionInfo are lazy
- category: perf
- severity: low
- confidence: confirmed
- where: ui/src/app/Panel.tsx:30-46, :50-51
- evidence: static imports of `DeviceSurface`, `FilesSurface`, `LinkedSurface/PrSurface`, `Review`, `AgentsSurface`, `BrowserSurface`. Lazy: `TerminalSurface`, `SessionSurface`.
- what goes wrong: Device (255 lines, needs Xcode) and the wide Review (600) are opened rarely but parsed at start. Crew, Pr (PrChatCard), Addon (OfferCard) and Browser (HiddenBrowsers in App) are needed by the timeline or App, so they must stay. Device and Review can go.
- fix: `lazy()` DeviceSurface and Review in Panel, as Terminal is.
- effort: S
- risk of the fix: Suspense fallback flashes on first open.

### 15. Device's Ask can send the question and screenshot twice, and gives no busy state
- category: ux
- severity: low
- confidence: confirmed
- where: ui/src/app/Device.tsx:103-114, :227-233
- evidence: `const ask = async () => { if (!shot || !question.trim() || !point) return; try { await rpc("thread.send", { ..., files: [{ name: "simulator.png", data: ... }] ...` (no guard; the button stays enabled)
- what goes wrong: Enter, then Enter again before the rpc returns, sends two messages with two screenshots. Browser.tsx:486-489 has the `sending` ref guard for exactly this.
- fix: copy Browser's `sending` ref, and disable the button while sending.
- effort: S
- risk of the fix: none.

### 16. Device's Light/Dark button starts as Light whatever the simulator is in
- category: polish
- severity: low
- confidence: likely (assumes `device.list` reports no appearance; I didn't check the contract)
- where: ui/src/app/Device.tsx:20, :167-181
- evidence: `const [dark, setDark] = useState(false);` and it is never read from the device.
- what goes wrong: on a simulator already in dark mode, the first press says "Dark appearance" and sets dark, so nothing visibly happens.
- fix: read the appearance (`simctl ui <udid> appearance`) with the list, or make the button a two-way choice.
- effort: S
- risk of the fix: none.

### 17. The PR test console renders the whole test output, unbounded, on each chunk
- category: perf
- severity: low
- confidence: suspected (assumes `run.output` isn't capped by the engine)
- where: ui/src/app/Pr.tsx:676-679, :708-710
- evidence: `<pre ref={out} className="lc-prcon-out">{run.output || "Starting…"}</pre>` with a scroll-to-end effect on `[run.output]`
- what goes wrong: a verbose test run (MBs of output) is laid out in full on every chunk, inside the timeline.
- fix: show the last N lines (for example 400), and say how many lines are hidden.
- effort: S
- risk of the fix: Ask-to-fix already uses the last 30 lines, so it is unaffected.

### 18. OfferCard redraws per word of the background session it starts
- category: perf
- severity: low
- confidence: confirmed
- where: ui/src/app/Addon.tsx:543, :560-563
- evidence: `const child = useEngine((s) => (it.child ? s.items[it.child] : undefined));` then `(child ?? []).filter(kind === "tool")` three times per render
- what goes wrong: while "Make it an app" runs, the card in your thread re-renders and refilters on every token of the child session.
- fix: `useItemsWhere(it.child, isToolItem)` with a module-level `isToolItem`.
- effort: S
- risk of the fix: none.

### 19. Module maps in Terminal and agentBrowser only grow
- category: bug (small leak)
- severity: low
- confidence: confirmed
- where: ui/src/app/Terminal.tsx:50, :69-86; ui/src/app/agentBrowser.ts:18, :82-91
- evidence: `tabsOf` (per thread) is never deleted. `opening.set(pane.key, p)` is deleted only on failure, close or restart, so a successful open stays. `arrived.set(threadId, set)` stays as an empty Set after `done`.
- what goes wrong: these are small per-session entries kept for the app's lifetime. `tabsOf` also keeps showing shells of an archived session if it is reopened, which is intended.
- fix: `opening.delete(pane.key)` after the id is stored. Delete `arrived` entries once their set is empty.
- effort: S
- risk of the fix: `opening` is what makes a second view of the same pane wait. Delete only after `put` has written `id` (line 80).

### 20. `openInFiles` is exported and never called
- category: dead
- severity: low
- confidence: confirmed
- where: ui/src/app/Files.tsx:45-47 (and the mention at :9)
- evidence: `git grep -nw openInFiles -- ui/src` returns only Files.tsx:9 (comment) and :45 (definition). Callers dispatch `lc:open-file` directly (Terminal.tsx:186, Crew.tsx:1220).
- fix: delete it, or have the two dispatchers call it. One way, not both.
- effort: S
- risk of the fix: none.

---

## In good shape (checked and fine)
- **Terminal lifecycle.** The xterm instance, link provider, onData, onSelectionChange, ResizeObserver, MutationObserver and rAF are all disposed in the effect cleanup (Terminal.tsx:288-300). Shells live in the engine by design. Hidden panes return early on a 0 size. The dock Terminal is moved to the bottom panel rather than shown twice (Session.tsx:372-374), so two views never fight over one pty.
- **Browser frames.** The `message` handler checks `e.source === frame.contentWindow` and removes itself. Agent requests time out at 8 s and clear their map entry. The address polling (5 s) runs only with no target and when not hidden. Hidden Browsers are `opacity:0; z-index:-1` and let go after 2 minutes idle. Screenshots of a covered Browser use `shotUrl`, not a window grab.
- **Add-on frames.** `sandbox="allow-scripts"` srcdoc. Messages are accepted only from the frame's own window. The listener and MutationObserver are removed. In-flight `panel.ai` calls are cancelled when the frame goes. Ports are closed on rerun. The stopped-panel store is tiny.
- **PR card watch loops.** They are abortable (`pause` with signal), abort on unmount (PrCard.tsx:57), and end when checks settle. Chat cards slow to 25 s when the window is hidden.
- **Wall.** Tiles are `memo` with stable callbacks. There is one 30 s clock. Keyboard handling reads a ref, so there are no stale closures.
- **Commit and Ship.** `ship` refuses a second run per session. The commit message survives a failed commit. The buttons disable while busy.
- **setInterval inventory (my files):** agentBrowser.ts:50 runs every 30 s, module level, forever, and is cheap. Browser.tsx:219 runs every 5 s, only while nothing is open and not hidden. Pr.tsx:381 runs every 30 s, only while the tab is visible. Crew.tsx:181 runs every 1 s, only while something is running, once per instance (Fanout, CrewList, CrewView, AgentView). Wall.tsx:255 and Usage.tsx:269 run every 30 s while mounted. EtaLeft.tsx:20 runs every 10 s while mounted. launch.ts:25 runs every 60 s and skips when the document is hidden. Device.tsx:64 is a 1.1 s setTimeout chain; see finding 7.
- **Lazy loading.** Settings, Usage, Wall (prefetched), Compare, Setup, the Design and Security shells, Terminal (340 KB with xterm) and the DSH platform (220 KB, on first ported plugin) are all lazy.
- **Routines.** 806 lines (Routines.tsx 336 and RoutineBuilder.tsx 470), skipped as asked except for finding 9.

## Not done
- No windowing proposal for the split-view `CodeDiff` (vendored Liner UI). It may have the same full-render cost as finding 1.
- Dead CSS selectors in surfaces.css, crew.css and wall.css were not swept.
- AddonsPage (743), Agentic (454), AgentDialog (474) and Models (414) were skimmed for effects, listeners and rpc only, not read line by line.
- Nothing was run. The re-render findings rest on reading `useItems` (engine.ts:384) and Panel's mount pattern, not on a React profile.
