# Audit: UI shell and session view (ui/src/app)

Scope: App.tsx, AppModel.tsx, engine.ts, model.ts, bridge.ts, Sidebar.tsx, SideList.tsx, Session.tsx, Timeline.tsx, Composer.tsx, Ask.tsx, ask-text.ts, TopBar.tsx, Home.tsx, Settings.tsx, Setup.tsx, SessionInfo.tsx, SideChat.tsx, Find.tsx, keymap.ts, look.ts, face.ts, dock.ts, themes.ts, Panel.tsx, Surfaces.tsx, ui.tsx, icons.tsx, Backdrop.tsx, Page.tsx, main.tsx, index.html.

Note on "new today": while I worked, the other session committed the working-tree changes as `220cc0e` ("A new left panel: sessions by folder..."). The content I read is that commit (Sidebar.tsx 1787 lines, SideList.tsx 218 lines, Thread.doing in contracts/engine). "(new today)" below means code in 220cc0e.

## How one streamed text delta reaches the DOM (traced)

1. `engine.ts:296` `apply(JSON.parse(line))` → `case "delta"` (`engine.ts:211`) appends to the `deltas` map and calls `notify()`. No state copy yet.
2. `notify()` (`engine.ts:109`) schedules one `flush` per animation frame (plus a 100 ms timer for hidden windows). Good: batched per frame.
3. `flush` → `takeDeltas()` (`engine.ts:77`): one shallow copy of `state.items`, one `slice()` of each streaming thread's list, one new object for the streaming item. Then every `useSyncExternalStore` listener runs its selector.
4. Selectors that see a change, and so re-render:
   - `Timeline` (`useItems`, Timeline.tsx:139) → `turnsOf` over all items (cheap, O(n)) → only the streaming `Turn` (memo, Timeline.tsx:164) re-renders, because `turnsOf` keeps unchanged turns' arrays and all other props are stable (`useSteady`, `seen` ref, `focus` state).
   - Inside that Turn: every block of that turn is rebuilt; `StreamedMarkdown` is `memo` with an incremental parser (liner/pro/ai-kit/streamed.tsx:25-33), so only the growing text re-parses; `Trail` and `LiveStatus` re-render.
   - `SessionPanel` → `Panel` and every open surface (finding 3), only while the panel is open.
   - `WatchCanvas` in the composer tray (Composer.tsx:1872, `useItems`) — tiny, early exit.
   - Wall tiles / Design chat if those are on screen.
5. Not re-rendered by a delta: App, Sidebar (its `sentLine` string selector is stable), Session (it reads `count`, `loaded` and `itemsWhere` views only), Composer (reads the `isPrompt` view), Ask dock, and session B (its `items[B]` reference does not change).

So the delta path itself is in good shape. The re-render storm comes from `thread` events instead (finding 2), and from the panel (finding 3).

---

### 1. Opening a session re-fetches its whole timeline every time, and pauses its live stream until the fetch returns
- category: perf
- severity: high
- confidence: confirmed
- where: ui/src/app/engine.ts:341-366; ui/src/app/Session.tsx:170-175 (also SideChat.tsx:43, Compare.tsx:22, design/Dock.tsx:110, security/ScanSession.tsx:97)
- evidence:
  ```ts
  // engine.ts
  export function loadItems(threadId: string, again = false): Promise<void> {
    wanted.add(threadId);
    const going = loading.get(threadId);
    if (going && !again) return going.done;   // only dedupes a fetch in flight
    ...
      const { items, seq } = await rpc("thread.load", { id: threadId });
      ...
      loading.delete(threadId);
  // apply():
  if ((e.type === "item" || e.type === "delta" || e.type === "timeline") && loading.has(e.threadId)) {
    loading.get(e.threadId)!.events.push(e);   // held, not shown
    return;
  }
  // Session.tsx
  useEffect(() => { ...; void loadItems(thread.id).catch(() => {}); }, [thread.id]);
  ```
  Session is keyed by thread id in App.tsx:882/887, so every switch remounts it and calls `loadItems`. Wall.tsx:289 and Addon.tsx:546 check `getState().items[id]` first; Session does not.
- what goes wrong: clicking back to a session already in memory sends `thread.load` (engine serialises the whole timeline, api.ts:1111), parses it, and replaces `items[id]` with all-new objects, so every Turn re-renders a second time right after the first render from cache. While that request is out, every `delta`/`item` for that session is queued in `loading`, so a reply that was streaming visibly freezes on switch and then jumps. Cost scales with thread length, on every click in the sidebar, ⌘1–9, Back/Forward.
- fix: in `loadItems`, return at once when the timeline is already held and the stream is live: `if (!again && state.items[threadId] && cursor.has(threadId)) return Promise.resolve();` (the reconnect path already passes `again`).
- effort: S
- risk of the fix: relies on the event stream keeping cached timelines current, which it already does for every opened thread (hello refetches with `again`). Test: open A, open B, back to A while A streams: no request, no stall; reconnect still refetches.

### 2. Every `thread` event in any session re-renders the whole shell: App, every sidebar row, the open Session(s), Composer and Settings; `Thread.doing` now sends one up to ~1.4 times a second per running session (new today)
- category: perf
- severity: high
- confidence: confirmed (re-render path); cost per render suspected (not measured)
- where: ui/src/app/App.tsx:149 (`useEngine((s) => s.threads)`), App.tsx:861 (Sidebar with ~30 inline props), App.tsx:882/887 (Session with inline props), App.tsx:822 (Settings); engine/src/store.ts:435-444 and runtime.ts `DOING_MS = 700` (new today); no `memo` on Sidebar, Session or Composer (only `Turn` and Wall's `Tile` are memoised: `grep -n "memo(" ui/src/app/*.tsx`).
- evidence:
  ```ts
  // store.ts (new today)
  setDoing(id, doing) { ... this.state.threads[i] = next; this.emit({ type: "thread", thread: next }); }
  // runtime.ts (new today)
  export const DOING_MS = 700;
  // App.tsx
  const threads = useEngine((s) => s.threads);
  <Sidebar face={face} onFace={(f) => setFace(f)} ... onOpen={(id) => openSession(id)} ... />
  <Session key={current.id} thread={current} sidebar={sidebar} onSidebar={() => setSidebar(true)} ... />
  ```
- what goes wrong: session B (in the background) moves from "Reading a.ts" to "Running npm test": a new `threads` array → App re-renders → Sidebar rebuilds every row (each row mounts a closed `Pop` with its hooks, `SideRow`, `SideMark`, a fresh `acts` tree), runs its plate `useLayoutEffect` (finding 13), and session A on screen re-renders its header (EnvMenu, ModeChip, CrewChip, ReviewerSwitch), its Composer (1,895-line component, `usePrecheck`, `mirror(text)`), ShipCard and CrewStrip, though nothing of A changed. Settings, when open, re-renders its page too. With five sessions running that is ~7 full-shell renders a second, on top of status/usage/eta thread events that already existed. This is the main "feels busy" cost in the shell.
- fix (bounded, no new library): (a) wrap `Session` in `memo` and have it read its own thread by id (`useEngine((s) => threadOf(s, id))`), so App passes `id` plus callbacks made stable with the existing `useSteady` pattern (Timeline.tsx:132); (b) pull the sidebar row into a `memo` component `SessionRow({ t, current, picked, now, ... })` so only the row whose `Thread` object changed re-renders; (c) `memo(Settings)` with a stable `onClose`. App itself can keep subscribing to `threads` for the badge/tray.
- effort: M
- risk of the fix: stale props if a callback is captured instead of steadied; test session switching, Open beside, rename, pin/snooze from the row, ⌘K actions on "This session".

### 3. With the right panel open, every streamed frame re-renders the Panel and each open surface (Review's diff, Changes, Files, Agents, Session info) with the full item list
- category: perf
- severity: medium
- confidence: confirmed that they re-render per frame; likely that Review/Files are the expensive ones (link assumed: their inner diff rows are not memoised; I did not read Review.tsx beyond its head)
- where: ui/src/app/Session.tsx:844-848; ui/src/app/Panel.tsx:89, 138-155; Review.tsx:166-170
- evidence:
  ```ts
  /** The dock's surfaces read the whole timeline (a reply's words too), so the panel subscribes to it on its own. */
  function SessionPanel(props) { const items = useItems(props.thread.id); return <Panel {...props} items={items} />; }
  // Panel.tsx
  if (t === "changes") return wideReview ? <Review thread={thread} items={items} .../> : <Changes ... items={items} />;
  // Review.tsx
  export function Review({ thread, items, focus, onFocus }) { ... const cps = useMemo(() => checkpointsOf(items), [items]); ...
  ```
- what goes wrong: Changes or Review open beside a streaming reply: each frame re-runs `checkpointsOf(items)` and re-renders the whole diff view, though checkpoints did not change. The streaming text is the one thing none of these surfaces shows.
- fix: give the panel the view it needs: `useItemsWhere(id, isCheckpoint)` for Changes/Review/Files (the cache in engine.ts:392 already returns the same array while checkpoints are unchanged), and read the whole list only in the surfaces that need it (Agents, Session info), or `memo` each surface.
- effort: M
- risk of the fix: a surface that silently relied on tool items (Files "touched by this turn") must get its own view; test Changes, Review, Files, Agents with a turn running.

### 4. A timeline that is slow to load shows an empty column, and one that fails to load stays empty with no word and no retry
- category: ux
- severity: medium
- confidence: confirmed
- where: ui/src/app/Session.tsx:106-108, 174, 510, 645-653; engine.ts:359-362
- evidence:
  ```ts
  const loaded = useEngine((s) => s.items[thread.id] !== undefined);
  void loadItems(thread.id).catch(() => {});
  const empty = loaded && count === 0;
  {empty ? <div className="lc-fresh">…</div> : <Timeline threadId={thread.id} … />}
  ```
- what goes wrong: before the first fetch returns, `loaded` is false, so the Timeline renders with `EMPTY`: a blank thread, no shimmer (the engine's own comment calls this deliberate to avoid the "new session" card, but nothing is shown instead). If `thread.load` throws (a thread file the engine cannot read, a 500), the error is swallowed, `wanted` keeps it for a reconnect that may never come, and events for it are dropped (`if (!state.items[e.threadId]) return`), so the session looks empty until the app restarts.
- fix: keep a per-thread load error (a small `Map` in engine.ts, or local state in Session from the `catch`), and render `<span className="l-shimmer">Opening</span>` while `!loaded`, and on error a line with Try again that calls `loadItems(id, true)`.
- effort: S
- risk of the fix: none beyond copy; test with the engine stopped mid-open.

### 5. The session header's give-way measuring is dead code since 0c55f8c, so its overflow rules never apply
- category: ux / dead
- severity: medium
- confidence: likely (that the header now overflows or clips in narrow columns: the link assumed is that no other CSS handles it; that the code is dead is confirmed)
- where: ui/src/app/TopBar.tsx:67-148 (`GIVE`, `useGiveWay`, `TopBar`), TopBar.tsx:151 (`OpenTab`); dock.css:27-43, 483, 930-933
- evidence: `git grep -n "<TopBar\|useGiveWay" -- ui/src` finds only TopBar.tsx itself; `git log -S"<TopBar" -- ui/src/app/Session.tsx` shows it was dropped in 0c55f8c (2026-11-14). The CSS still waits for it:
  ```css
  .lc-top[data-give~="mode"] .lc-mode-chip, .lc-top[data-give~="faces"] .lc-crew-t, .lc-top[data-give~="crew"] .lc-crew-pop { display: none; }
  .lc-top[data-give~="count"] :is(.lc-wallback-n, ...)
  ```
- what goes wrong: in Open beside, or with the panel open, or opened from the Wall, the header holds the title menu, mode chip, crew chip, app tabs, the Wall's way back and the Reviewer; nothing ever sets `data-give`, so nothing steps aside and the row is squeezed.
- fix: either call `useGiveWay` on the Session header (`<header ref=… className="lc-top">` in Session.tsx:549; the hook finds `.lc-top` from any child ref) and delete the rest of `TopBar`, or delete `TopBar`/`useGiveWay`/`GIVE`/`OpenTab` and the `data-give`/`data-measure` rules in dock.css. Keep `onOpenSurface`, `SideKeys`, `usePins`, `pin`, which are used.
- effort: S
- risk of the fix: restoring it brings back a MutationObserver on the header; check a narrow beside view with a pair, a mode and two app tabs.

### 6. A reconnect re-fetches every timeline opened since launch, all at once, and loaded timelines are never let go
- category: perf
- severity: medium
- confidence: confirmed
- where: ui/src/app/engine.ts:168-180, 41, 156
- evidence:
  ```ts
  const open = [...new Set([...Object.keys(state.items), ...wanted])].filter((id) => there.has(id));
  ...
  for (const id of open) void loadItems(id, true).catch(() => {});
  ```
- what goes wrong: open 40 sessions in a day, then the engine restarts (an update, a crash, sleep/wake with a half-open socket after 45 s): 40 parallel `thread.load` calls, each a whole timeline, while the app shows "Reconnecting". `state.items` keeps every timeline ever opened for the life of the window (also scanned by ⌘K's in-message search, App.tsx:664), so memory and that scan grow with use.
- fix: refetch at once only timelines that are mounted (track a ref count from `useItems`/Session mount) and mark the rest stale, fetching them on next open; optionally drop timelines of sessions not shown for N minutes, keeping the 20 most recent.
- effort: M
- risk of the fix: the Wall reads every tile's timeline; keep Wall tiles counted as mounted. Test reconnect with Wall and Open beside up.

### 7. "Needs you" now means two different things: the Dock badge, the menu-bar item and "Next session that needs you" count unread and unstarted sessions, the sidebar's Needs you and its top pill do not (new today)
- category: ux
- severity: medium
- confidence: confirmed
- where: ui/src/app/Sidebar.tsx:122, 272, 277, 1137-1141; App.tsx:362, 370, 544; model.ts:250-260
- evidence:
  ```ts
  // Sidebar.tsx (new today)
  const asks = (t: Thread) => t.status === "waiting" || t.status === "error" || t.status === "limited";
  const wallWaits = onWallNow.filter(asks).length;
  {block("Complete", [...byBucket.needs.filter((t) => !asks(t) && !works(t)), ...byBucket.open].sort(newest))}
  // App.tsx (unchanged)
  const needs = threads.filter((t) => !t.archived && waitsOnYou(t) && t.turns > 0).length;  // bucketOf: includes t.unread
  ```
- what goes wrong: a session answered while you were away: the Dock says 1, the tray says 1 needs you, ⌥⌘↓ jumps to it, but the sidebar's top pill shows no amber count and the row sits under Complete (in amber words). The comment at Sidebar.tsx:267-271 says the split is from the mockup, but the other three places were not moved with it.
- fix: decide once, then share one predicate: export `asks` (or `needsYouNow`) from model.ts and use it for the badge, tray `needs`, and `nextNeeds`, or keep unread in the sidebar's Needs you.
- effort: S
- risk of the fix: Settle-the-project and bucketOf callers rely on the old meaning; change only the counting sites.

### 8. Opening a session straight from an rpc answer can bounce you to Home when the answer beats the `thread` event
- category: bug
- severity: medium
- confidence: suspected (needs a run; the race is between two separate HTTP connections)
- where: ui/src/app/App.tsx:291-295, 733 (Fork it), 522; Sidebar.tsx:1489-1495 (Carry on's Bring in)
- evidence:
  ```ts
  useEffect(() => {
    if (!ready || view.kind !== "session" || current) return;
    forget(view.id);
    setViewNow(besideThread ? { kind: "session", id: besideThread.id } : { kind: "home" });
  }, [ready, view, current, besideThread]);
  ...
  onSelect: () => void rpc("thread.create", { projectId: here.projectId, forkOf: here.id }).then((t) => openSession(t.id)),
  ```
- what goes wrong: `thread.create` / `sessions.import` resolve on the `/rpc` connection; the new thread arrives on `/events`. If React renders the new view before the event is applied, `current` is undefined and this effect treats the session as deleted: back to Home, and the session is dropped from Back/Forward. Home's own start is safe because it awaits `thread.send` first (Home.tsx:162).
- fix: when the view names an id not yet in `threads`, wait (one or two frames, or until the next `thread` event) before treating it as gone; or have `openSession` upsert the returned `Thread` into the store (`set({ threads: upsert(...) })`) before switching.
- effort: S
- risk of the fix: a truly deleted session must still leave; test delete from ⌘K and from another window.

### 9. Home: if `thread.create` succeeds and `thread.send` fails, an empty "Not started" session is left behind, and every retry makes another
- category: bug
- severity: low
- confidence: likely (link assumed: the engine does not remove a session whose first send failed)
- where: ui/src/app/Home.tsx:150-172
- evidence:
  ```ts
  const id = nextId.current ?? undefined;
  nextId.current = null;
  ...
  const t = await rpc("thread.create", { ...(id ? { id } : {}), projectId: project.id, ... });
  await rpc("thread.send", { id: t.id, text: m.text, files: m.files });
  ...
  } catch (e) { toast.error(...); throw e; }
  ```
- what goes wrong: a send refused (a file too big, a tool not ready) toasts, the Composer puts the text back, and the sidebar gains a "Not started" row; pressing Enter again creates a second one under a fresh id.
- fix: on a failed send after a successful create, either open that session (the text is still in its composer draft) or `thread.remove` it; at least keep `t.id` and reuse it on the retry.
- effort: S
- risk of the fix: removing must not take a session the engine did start; prefer opening it.

### 10. No windowing: a long thread mounts and parses every turn on open, and since Session remounts on every switch this cost is paid on every switch
- category: perf
- severity: medium
- confidence: confirmed (no windowing, full mount); cost suspected (not measured)
- where: ui/src/app/Timeline.tsx:138-161; App.tsx:882, 887 (`key={t.id}`); styling relies on `content-visibility` for layout only (Session.tsx:188-191 comment)
- evidence:
  ```tsx
  {turns.map(({ turn, n, items: list }) => (<Boundary key={turn} …><Turn … /></Boundary>))}
  ```
  Each `StreamedMarkdown` creates its parser with `useState(createMarkdownParser)` and parses its whole text at mount.
- what goes wrong: a 500-item, 60-turn thread: React builds every Turn, every trail, every card (PageCard iframes reload their `srcDoc`), and parses every answer's markdown before the first paint, every time you open it. `content-visibility` saves layout and paint, not React work or parsing. Combined with finding 1 it happens twice per switch today.
- fix (bounded): render the last ~12 turns first and the earlier ones in an idle callback or when the scroller nears the top (a `shown` count in Timeline), keeping scroll restore working by waiting for the target block (Session.tsx's `where()` already handles an undrawn block). No virtualisation library needed.
- effort: M
- risk of the fix: Find (DOM walk), the prompt map and ⌥↑/⌥↓ need the earlier turns mounted: mount all before they run, or mount all on first Find.

### 11. Dead components and helpers in the shell's shared files
- category: dead
- severity: low
- confidence: confirmed
- where and how checked (`git grep -nw <name> -- ui/src desktop engine contracts`, only the definition matches):
  - ui/src/app/ui.tsx:342 `ContextRing`, ui.tsx:363 `ContextMeter`, ui.tsx:442 `LimitMeter` and its private `pairOf` (ui.tsx:~430), about 110 lines; CSS `.lc-ctxm*` (app.css:7200-7222) goes with them.
  - ui/src/app/model.ts:275 `statusLine` (15 lines).
  - ui/src/app/Composer.tsx:1892 `Hints` (and `.lc-hints` in app.css:4535).
  - ui/src/app/dock.ts:58 `toggleDock`.
  - ui/src/app/icons.tsx:355 `ToolIcon`.
  - ui/src/app/TopBar.tsx `TopBar`, `useGiveWay`, `GIVE`, `OpenTab` (see finding 5).
  - Exported but used only in their own file (drop the `export` only): `appModelReady`, `EFFORTS`, `askWords`, `TYPING_GUARD`, `SHOWN_GUARD`, `AskKeyIn`, `Bit`, `DESK_SHOW`, `FACES`, `subscribeTabs`, `MAX_PANES`, `ghLine`, `HIDDEN_VALUE`, `backgroundUrl`, `exportSession`.
- what goes wrong: noise in files already at 500-3,300 lines; `LimitMeter` even starts its own 30 s interval if someone mounts it again by mistake.
- fix: delete the first group, un-export the second.
- effort: S
- risk of the fix: none at runtime; run `tsc`.

### 12. Sidebar leftovers from before the rebuild (partly new today)
- category: dead
- severity: low
- confidence: confirmed
- where: ui/src/app/Sidebar.tsx:47, 68 (props `onAgent`, `onCreateAddon`: declared, passed by App.tsx:861, never destructured — `grep -n "onAgent\|onCreateAddon" Sidebar.tsx` finds only the type); Sidebar.tsx:196-197, 252, 896, 907-908 (`const query = ""`, `matches()`, and the "No session matches that" branch, unreachable since the filter field went in 0.2.7); Sidebar.tsx:1687 (`ProjectBadge`'s `dot` param, never passed); Sidebar.tsx:1670 (`onIt().model`, never read); App.tsx:537 and Sidebar.tsx:614 (`.filter((r) => !r.closest(".lc-fold[inert]"))`: the sidebar no longer renders `.lc-fold`; `SideFolder` unmounts folded rows, SideList.tsx:142).
- what goes wrong: App builds two closures per render for props nobody reads; the `q` branch and its copy describe a feature that is gone; App's comment at 536 describes fold behaviour that no longer exists.
- fix: remove the two props from `Props` and App's JSX; remove `query`, `matches`, `q` and that branch (list/archivedList memos lose `query` from deps); drop `dot`; drop the `.lc-fold[inert]` filters and fix the comment.
- effort: S
- risk of the fix: none; `tsc` catches all.

### 13. The sidebar's plate effect forces a layout and builds a new ResizeObserver on every thread event
- category: perf
- severity: low
- confidence: confirmed
- where: ui/src/app/Sidebar.tsx:325-343
- evidence:
  ```ts
  useLayoutEffect(() => {
    ... const b = row.getBoundingClientRect(); ...
    const ro = new ResizeObserver(measure); ro.observe(sc.firstElementChild as HTMLElement);
    return () => ro.disconnect();
  }, [current, list, archivedList, view, shutProjects, shutForks, renaming, groups, Boolean(faceBody)]);
  ```
  `list` is a new array whenever `threads` changes (Sidebar.tsx:253-256), i.e. on every `doing` update (finding 2).
- what goes wrong: a synchronous layout read inside the commit, plus observer teardown and setup, on each background status change; it shows up as a forced reflow in the commit's profile while sessions run.
- fix: key the effect on the open row's position inputs only: the ordered ids string (`list.map((t) => t.id).join()`) instead of `list`; the ResizeObserver already covers size changes. Or create the observer once (`[]`) and call `measure` from a separate effect.
- effort: S
- risk of the fix: the plate must still follow a row that moves because another row's second line wrapped; the ResizeObserver on the inner list covers that.

### 14. Each memoised Turn runs its own store selector on every flush
- category: perf
- severity: low
- confidence: confirmed
- where: ui/src/app/Timeline.tsx:173 (and LiveStatus 542-543)
- evidence: `const mode = useEngine((s) => { const t = threadOf(s, threadId); return t ? (t.mode ?? "standard") : null; });`
- what goes wrong: every listener's selector runs on every frame of every stream (useSyncExternalStore), so a 200-turn thread does 200 `threads.find` + `sides.find` scans per frame even though only one Turn re-renders. Small per call, but it scales with thread length × session count.
- fix: read `mode` once in `Timeline` and pass it as a prop (it is fixed for a session's life).
- effort: S
- risk of the fix: none.

### 15. Caches that only grow
- category: bug (leak)
- severity: low
- confidence: confirmed
- where: ui/src/app/engine.ts:392-404 (`views` per filter per thread, not cleared on `thread.removed` at 193-201); Session.tsx:76, 78, 84 (`places`, `views`, `belows`); Composer.tsx:216 (`draftFiles` keeps File objects for any session left with attachments); Timeline.tsx Page iframes aside.
- what goes wrong: entries for deleted sessions stay for the life of the window; `draftFiles` can hold megabytes of pasted files for sessions you never return to.
- fix: in `thread.removed`, also `for (const m of views.values()) m.delete(e.id)`; cap `draftFiles` (it already caps drafts at 50 in localStorage; do the same).
- effort: S
- risk of the fix: none.

### 16. Listeners re-subscribed on every render or every thread change
- category: perf
- severity: low
- confidence: confirmed
- where: ui/src/app/App.tsx:388-396 (`onStream` "settled" effect depends on `[threads]`); Settings.tsx:118-133 (window keydown effect depends on `[onClose]`, which App passes inline at App.tsx:822, so it re-subscribes on every App render); Sidebar.tsx:1080 `CarryOn` gets a fresh `side={() => nav.current}` each render (harmless, noted).
- what goes wrong: churn only (add/remove listener pairs per thread event); no missed events because the swaps are synchronous.
- fix: read the title with `getState()` inside the settled listener and use `[]`; keep `onClose` in a ref in Settings.
- effort: S
- risk of the fix: none.

### 17. `@` file lookup sends one `fs.files` request per keystroke
- category: perf
- severity: low
- confidence: confirmed (UI side; engine cost of fs.files not read)
- where: ui/src/app/Composer.tsx:492-507
- evidence: the effect on `[mention, ...]` calls `rpc("fs.files", { …, query: mention.query, limit: 8 })` with no delay; only a `live` flag discards stale answers.
- what goes wrong: typing `@src/components/but` sends ~20 requests; on a big repo each may walk or filter the file list on the engine.
- fix: a 60-100 ms debounce for `@` (keep `/` and `$` instant, they filter locally).
- effort: S
- risk of the fix: list may feel a frame slower; keep the old rows shown meanwhile (already done).

### 18. A token or auth failure on `/rpc` is reported as "engine isn't answering", which the app then hides
- category: bug
- severity: low
- confidence: confirmed
- where: ui/src/app/engine.ts:323-334; App.tsx:249-257
- evidence:
  ```ts
  try { const res = await fetch(...); body = (await res.json()) as typeof body; }
  catch { throw new EngineAway("The engine isn't answering. Try again in a moment."); }
  // App: if (!(e.reason instanceof EngineAway)) toast.error(e.reason.message);
  ```
- what goes wrong: a 401 (plain text) or a 500 HTML page fails `res.json()`, becomes `EngineAway`, and every action without its own catch (pin, stop, rename) silently does nothing while the stream may still show "connected".
- fix: check `res.ok` before `json()`; for a non-OK response throw `RpcError(\`The engine said ${res.status}\`)`; keep `EngineAway` for network errors only.
- effort: S
- risk of the fix: none.

### 19. Removing an API endpoint ignores failures to delete its key
- category: bug
- severity: low
- confidence: confirmed
- where: ui/src/app/Settings.tsx:1877-1882
- evidence:
  ```ts
  void bridge.keychainSet(`key:${endpointKey(e.id)}`, null).catch(() => {});
  void rpc("keys.set", { provider: endpointKey(e.id), key: null }).catch(() => {});
  ```
- what goes wrong: the endpoint disappears from the list but its key can stay in the Keychain or the engine's store with nothing said; re-adding an endpoint with the same id picks the old key up.
- fix: `toast.error("The endpoint is gone, but its key couldn't be removed: …")` in both catches.
- effort: S
- risk of the fix: none.

### 20. Composer's stash writes localStorage without a guard
- category: bug
- severity: low
- confidence: confirmed
- where: ui/src/app/Composer.tsx:794, 801, 808
- evidence: `localStorage.setItem(stashKey, JSON.stringify([{ text, at: Date.now() }, ...list].slice(0, 20)));` with no try, while every other write in the file is guarded (drafts at 203, `lc:enter` at 396).
- what goes wrong: with storage full, ⌘S throws in the key handler: no toast, the draft is not cleared, nothing says why.
- fix: wrap in try and toast "Couldn't stash it: storage is full".
- effort: S
- risk of the fix: none.

### 21. Arrow keys in the sessions list skip folder headers, so a folded folder can't be reached or opened from the keyboard by arrows
- category: ux
- severity: low
- confidence: confirmed
- where: ui/src/app/Sidebar.tsx:525-529; SideList.tsx:126 (`.lc-sl-fold-b`)
- evidence: `const rows = [...(… .closest(".lc-sb")?.querySelectorAll<HTMLElement>(".lc-sb-pick") ?? [])];` — folder buttons are `.lc-sl-fold-b`, not `.lc-sb-pick`, and have no arrow handling of their own.
- what goes wrong: ↑/↓ jumps from the last row of one folder to the first row of the next and never lands on a header; a folded folder's sessions are reachable only with Tab.
- fix: query `.lc-sb-pick, .lc-sl-fold-b` and add the same ↑/↓ handler to the folder button (SideFolder could take an `onKeyDown`).
- effort: S
- risk of the fix: P/S/D on a header must do nothing (rowKeys already returns on `e.target !== e.currentTarget`).

### 22. "Watch on the canvas" re-renders on every streamed frame
- category: perf
- severity: low
- confidence: confirmed
- where: ui/src/app/Composer.tsx:1872-1876
- evidence: `const items = useItems(thread.id); ... const now = thread.status === "running" ? drawingOf(items) : undefined;`
- what goes wrong: small, but it is the one part of the composer tray that redraws per frame, and `drawingOf` scans back through the turn each time.
- fix: `const frame = useEngine((s) => (thread.status === "running" ? drawingOf(s.items[thread.id] ?? []) : undefined)?.frame ?? (… ? "" : null))` — select a string, not the list.
- effort: S
- risk of the fix: none.

---

## In good shape (checked, nothing to report)

- Event stream batching (engine.ts:70-118): deltas coalesce per frame, other events flush pending deltas first so order holds, a 100 ms timer keeps hidden windows current, heartbeats with a 45 s silence cut, backoff to 4 s. `seq`/`cursor` logic against snapshot and held events is sound, including engine restarts (cursor cleared on hello).
- Selectors: no `useEngine` selector in scope returns a fresh array/object (checked with grep for `filter|map|?? []|=> ({` inside `useEngine((`); `itemsWhere` gives stable arrays per view.
- Timeline: `Turn` memo with kept per-turn arrays, `useSteady` callbacks, `StreamedMarkdown` memo plus incremental parser; clocks tick by writing text (one shared interval, Timeline.tsx:477-503) instead of re-rendering.
- Typing: Composer state is local; a keystroke does not re-render Session, Timeline or Sidebar. Drafts per session in localStorage with a 300 ms debounce, flushed on unmount, session change and `beforeunload`; files kept per draft in memory; IME (`isComposing`/229) respected in the composer, rename fields, Find; big pastes become a text file with an undo; focus returns to the field after send.
- Scroll position per session (Session.tsx:76, 178-263) is kept by block id and offset and restored before paint; entry animations at Quick motion are finished by `entering()` (look.ts:181) on each view change, and `seen` prevents old items from animating: the earlier fix holds.
- Window listeners in App, Session, Composer, Sidebar, Find, Page all have cleanups; the three `setInterval`s (Sidebar 246/1612, ui.tsx 445) are cleared. Keyboard handlers in Open beside are gated by `keysOn`/`SideKeys`; the Wall's Esc steps aside for fields, menus, dialogs and terminals.
- Settings: already lazy (`early()` in App.tsx:29-41) and prefetched at idle, and renders one page at a time (Settings.tsx:335-349). A file split would not buy measurable speed; the only win is `memo` with a stable `onClose` (finding 16 / 2).
- PageCard (Page.tsx): sandboxed `allow-scripts` without same origin, strict CSP, messages checked by `e.source`, links limited to http(s)/mailto.
- SideList.tsx (new today) is small and clean; its parts are shared with Design and Security sidebars.

## What I did not get to

- Not run: no profiling or real render counts; costs in findings 2, 3 and 10 are from reading, not measurement.
- Read only in part: Settings.tsx (top level and a few sections), Setup.tsx, SessionInfo.tsx, Surfaces.tsx, Backdrop.tsx, themes.ts, icons.tsx beyond the dead-export check; Timeline.tsx past ~line 610 (Trail, cards) skimmed by grep only.
- Did not check focus traps inside the Liner `Dialog`/`CommandMenu` components (vendored library) or the Escape order between a Pop inside Settings and Settings' own Escape beyond the `defaultPrevented` check.
- CSS selectors left dead by the sidebar rebuild (`.lc-sb-lab`, `.lc-sb-time`, `.lc-sb-views`, `.lc-sb-bar`, `.lc-sb-view`, `data-two`) are the CSS auditor's; worth a grep there.
- Routines code skipped as instructed.
