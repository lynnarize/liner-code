# PERF findings — bounded pass after 2026-11-18 (auditor: perf-debt, HEAD bfb0ebc + uncommitted layout work)

### [PERF-01] Memoise the dock so the open session's own stream stops redrawing it every frame

- **Evidence**: `ui/src/app/Panel.tsx:109` — `export function Panel(...)` is not memoised; `Changes` (`Panel.tsx:643`) and `Strip` (`Panel.tsx:344`) are plain functions too. `ui/src/app/Session.tsx:877` — `SessionPanel` is a plain wrapper, and `Session.tsx:786-800` passes `lead={<span>…buttons…</span>}` — a fresh JSX element every render — plus `dock={dock.open ? dock : leaving!}`. The 11-18 pass's own measurement shows the residue: with the open session streaming and Changes open, 1,154 component redraws in 6 s remain (vs 248–260 for a background stream) (`docs/AUDIT-2026-11-18.md:285`).
- **Impact**: while the session you are watching streams, Session re-renders each frame (its own items change) and the whole dock — strip, Changes surface, every mounted surface — re-renders with it, ~190 redraws/s, even though the surfaces' `useItemsWhere` slices are unchanged. This is the largest remaining render cost in the Code face.
- **Effort**: M — memo Panel/Changes/Strip, hoist the `lead` JSX into a memoised component with stable props, keep the dock object reference stable; verify with the audit's CDP redraw count.
- **Risk**: MED — the dock carries drag/focus/leave transitions; a stale prop could freeze a tab state. The existing redraw measurement is the regression test.
- **Confidence**: HIGH (code read; corroborated by the audit's own post-fix numbers).
- **Fix sketch**: wrap Panel and the dock surfaces in `memo`, move the inline `lead` element into its own memoised component taking `sidebar/onSidebar/onCloseSide`, and re-run the 6 s streaming redraw count to confirm the dock goes to ~0 like the background case.

### [PERF-02] Trim usage.jsonl and stop keeping every turn's record in engine memory

- **Evidence**: `engine/src/store.ts:385` — one line appended per turn, no rotation or trim anywhere (grep for trim/prune/rotate on usage finds none). `engine/src/store.ts:390-418` — `usageRead.records` only ever grows; `usage(from)` filters the whole history on every call. Callers: `engine/src/api.ts:1190` (`store.usage(t.createdAt)` per thread), `api.ts:1688,2274` (usage summary/page), `engine/src/runtime.ts:2172-2177` (ETA, per provider:model every 10 min). `engine/src/runtime.ts:2163` — comment still says "usage.jsonl is read whole each time", which the incremental read at store.ts:389 made untrue.
- **Impact**: a year of heavy use is tens of thousands of records: the file grows without bound, the engine holds all of them in RAM for its whole run, and every usage read is O(all records) though only 30 days are ever asked for. The incremental read fixed the disk cost, not the growth.
- **Effort**: S — drop records older than the widest window (30 days + margin) when reading/appending, or rotate the file at a size cap; fix the stale comment; test that a trimmed file still answers summary and ETA.
- **Risk**: LOW — only affects history older than any screen shows; keep the on-disk file intact if the owner wants an archive, trim only the in-memory array as a first step.
- **Confidence**: HIGH.
- **Fix sketch**: prune `usageRead.records` to the retention window after each incremental read (and optionally compact the file on startup), so memory and per-call filtering are bounded by 30 days of turns, not by the app's lifetime.

### [PERF-03] The dock's open/close animates grid tracks — a full thread + panel relayout every frame for 520 ms

- **Evidence**: `ui/src/app/app.css:1817-1828` — `.lc-session`'s body grid transitions `grid-template-columns` AND `grid-template-rows` 400 ms, extended to 520 ms when the panel opens (`transition-duration: 520ms`), with the panel width computed via `clamp(…, round(down, 36%, 1px), …)`. Same class of animation elsewhere: `.lc-fold` grid-rows 420 ms (`app.css:2340`), Ship message/body grid-rows 520/380 ms (`app.css:6034,6100`), Mac traffic-light padding 520 ms (`app.css:353`, `design/design-face.css:1152`). The sidebar's own 520 ms grid animation is the known held-back A15 — this is the dock's, not the sidebar's.
- **Impact**: opening/closing the dock re-lays out the thread, its composer and the panel on every animation frame (grid tracks are layout properties; the round() interpolation only makes the width land on whole pixels). On a long thread this is the same per-frame layout + paint storm A15 describes, on a different surface. The fold/ship/padding ones animate small subtrees and are cheap by comparison.
- **Effort**: M — measure first (CDP frame times while toggling the dock on a long thread), then the A15-style fix: animate the panel with transform/clip over a fixed grid, or accept a crossfade.
- **Risk**: MED — the panel's drag-to-width and beside-mode share this grid; a transform approach must not break the grip or the 420 px thread minimum.
- **Confidence**: HIGH that the layout animation exists; MED on the felt cost — measure first.
- **Fix sketch**: time a dock toggle on a 2,000-item thread; if frames drop, move the open/close to a compositor-only animation (transform + opacity on the panel, grid set instantly) as proposed for A15, keeping the dragged width logic on the static grid.

### [PERF-04] CodeDiff and its tokenizer ride in the main chunk for a dock tab — lazy the Changes surface

- **Evidence**: `ui/src/app/Panel.tsx:19` imports `CodeDiff` from `@liner/pro/code-diff/code-diff`, used only at `Panel.tsx:725` inside the `Changes` surface (`Panel.tsx:643`). CodeDiff pulls `tokenize` (`ui/src/liner/components/code-block/tokenize.ts`), `diff.ts` (202 lines) and two stylesheets. Review (the other big CodeDiff user) is already `early()`-lazy (`Panel.tsx:56`) and Compare is `lazyAgain` (`App.tsx:40`), so the Changes surface is the only reason the diff machinery is eager. Main chunk was 970 KB after the 11-18 pass (`docs/AUDIT-2026-11-18.md:295`); `ui/vite.config.ts:47` raises chunkSizeWarningLimit to 900.
- **Impact**: every launch parses the diff renderer + syntax tokenizer even for someone who never opens Changes; the lazy-Review work is partly undone by Panel's eager import. Browser/Pr/Crew/Addon surfaces are also still eager in Panel.tsx:30-41 (Browser is additionally eager via App.tsx:48 HiddenBrowsers) — secondary candidates, measure before moving.
- **Effort**: S — move the Changes surface (or just CodeDiff inside it) behind `early()` like Review; measure the chunk delta with one build (not run in this audit).
- **Risk**: LOW — the surface already shows a "Reading the changes" wait state; a chunk fallback fits it.
- **Confidence**: HIGH on the import graph; MED on the KB payoff — measure first.
- **Fix sketch**: extract `Changes` into its own module loaded with `early()`, keeping the empty state eager; confirm main-chunk size drops and Changes' first open shows no regression.

### [PERF-05] The composer's markdown mirror retokenizes the whole draft on every keystroke

- **Evidence**: `ui/src/app/Composer.tsx:352` — `const md = useMemo(() => mirror(text), [text])`; `ui/src/app/mdMirror.tsx:35` — `mirror` splits the entire draft into lines, runs a multi-alternative regex with recursive bold/italic handling per line, and builds React nodes for every token. Memoised only on the text itself, so each keystroke recomputes the whole draft.
- **Impact**: typing in a long draft (a pasted spec or brief of a few hundred lines) does O(draft) regex + React-element work per keystroke on the main thread, while the agent may also be streaming. Short drafts are fine; the cost grows linearly with draft length and is paid at typing speed.
- **Effort**: M — measure first (type into a 500-line draft, watch input latency); then debounce the mirror (~50–100 ms behind the caret) or tokenise only the changed line and its fence context.
- **Risk**: MED — the mirror must stay glyph-width-identical and scroll-synced (its own comment says the caret drifts otherwise); a debounce shows plain text briefly behind the caret.
- **Confidence**: MED — the per-keystroke full recompute is certain; the felt cost needs measurement.
- **Fix sketch**: keep the textarea authoritative, run `mirror` on a short trailing debounce (or incrementally per changed line), and verify caret alignment and scroll sync on a long draft before/after.
