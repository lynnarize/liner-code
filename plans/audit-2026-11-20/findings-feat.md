# Findings — FEAT (engine features: Design canvas/designs, surfaces, proxy, panels; partial security/add-ons/DSH pass)

Auditor scope per `03-features.md`. Playbook read: `## 1. Correctness / Bugs`, `## Finding format`, `## Prioritization rubric`. All evidence from read-only inspection at HEAD bfb0ebc. Reconciliation lists in `00-shared.md` respected (C1–C4, C13, B3–B5, B9, B10, D4, plugin-sandbox posture, plugin-on-engine-origin not re-reported).

### [FEAT-01] Cap frame-file reads on the watcher and open paths, as the tool paths already do

- **Evidence**: `engine/src/canvas.ts:1161` — `changedOnDisk` does `readFileSync(abs)` on any changed file under a watched design folder with no size check, then `hash(content)` (sha1) at 1171/1192. `engine/src/canvas.ts:2136` — `revsOf` (canvas.open) reads every drawn frame file whole, no `MAX_FRAME` check. `engine/src/designs.ts:216` — `Designs.read` reads the live design file with no size cap (show() enforces 2 MB at 168, read() does not). Contrast `frameFile()` at `canvas.ts:980` which refuses >2 MB.
- **Impact**: An agent (or a bad edit) writing a huge file into `frames/` — e.g. a base64 video inline, the exact case MAX_FRAME exists for — makes the engine read the whole file and sha1 it on its single thread inside a watcher callback, and canvas.open repeats it per frame. Memory spike plus a multi-hundred-ms stall of every session's stream; the 2 MB guard is bypassed on precisely the paths that run automatically.
- **Effort**: S
- **Risk**: LOW — a size refusal where reads already refuse elsewhere; watcher must still emit the change (with no rev) so the UI learns the file is unreadable.
- **Confidence**: HIGH
- **Fix sketch**: In `changedOnDisk` and `revsOf`, stat first and skip the read/hash above MAX_FRAME (emit the event without a rev, as a gone file does); add the same cap to `Designs.read`. Test: a 3 MB frame file changed on disk produces a canvas.changed without stalling or reading it whole.

### [FEAT-02] Keep a turn's provisional copy when the next turn begins before its end work runs

- **Evidence**: `engine/src/canvas.ts:1791-1793` — `beginTurn` synchronously drops the previous look's provisional copies (`dropProvisional`). `engine/src/canvas.ts:2085-2098` (attach) — `beginTurn` runs inline on the turn-start event, but `turnEnded` for the previous turn is only queued (`queue(ctx, …)`), and it awaits `digestAsync` before promoting. `promote` at 1673 silently returns when the `p<turn>` dir is gone.
- **Impact**: In a session not known to draw (a Code session whose agent edits a design), sending the next message promptly after the previous turn ends deletes the "as it was" copy before `turnEnded` can promote it; `keepVersionAsync` then copies the *current* state, so the pre-turn state of that turn is lost from Versions and cannot be brought back. The comment at 1790 treats this as the engine-restart case, but the same drop fires on ordinary fast turn succession.
- **Effort**: M
- **Risk**: MED — version lifecycle is delicate (promote/drop/prune interact); needs a characterization test of two overlapping turns first.
- **Confidence**: MED (code path is certain; the timing window needs a test to pin down)
- **Fix sketch**: Don't drop the previous look's provisionals in beginTurn; hand them to the queued turnEnded (or mark them superseded and let turnEnded decide), dropping only copies whose turn's end has already been processed. Test: turn N changes a design, turn N+1 starts before N's end work runs, N's "as it was" copy survives.

### [FEAT-03] Take canvas.restore's "before" copy and file puts off the engine loop

- **Evidence**: `engine/src/canvas.ts:1715-1716` — `keepBefore` does `cpSync(src, to, { recursive: true, … })` (a plain byte copy, no FICLONE) plus sync `digest(ctx, src)` hashing every file. `engine/src/canvas.ts:2044-2059` — restore's `put` loop reads and writes every copied file synchronously. Turn copies were moved off-loop (`keepVersionAsync`, `digestAsync`, `takeProvisional`), restore was not.
- **Impact**: Restoring a version of a design with a few MB of assets blocks the engine's single thread for the whole copy+hash+rewrite — every session's streaming, terminals and RPCs stall while the person scrubs Versions. This is the residual of the C-class sync-work fixes the brief asks to look for.
- **Effort**: M
- **Risk**: LOW-MED — restore must stay atomic-ish (keepBefore before any deletion); the async rewrite can reuse cloneDesign/slowCopy and the existing queue.
- **Confidence**: HIGH
- **Fix sketch**: Make restore async: keepBefore via cloneDesign (FICLONE where possible) + digestAsync, put loop via fs/promises, all on the session's queue; canvas.restore already awaits canvasIdle, so awaiting the rest is natural. Test: a restore of a folder with a large asset yields to the loop (a timer fires mid-restore).

### [FEAT-04] Yield inside a panel's files.search instead of scanning the project synchronously

- **Evidence**: `engine/src/panels.ts:150-178` — the search loop over `listFiles(root, 20000)` is fully synchronous: per file `readable()` (two `realpathSync`), `statSync`, `readFile` (sync readFileSync up to 512 KB), split and scan; it only stops at the match limit or 20 MB read. A query with few matches walks all 20k files without a single await.
- **Impact**: One panel search in a large project holds the engine thread for seconds (realpath×2 + stat + read per file), stalling every session's stream and RPC — the same class the 11-18 audit fixed for checks ("a big repository never holds the engine's thread for long"), left in the panel bridge.
- **Effort**: M
- **Risk**: LOW — semantics unchanged; only interleaving added.
- **Confidence**: HIGH
- **Fix sketch**: Process files in chunks (e.g. 200) with `await new Promise(setImmediate)` between chunks, keeping the existing limits; reuse one realpath of the root. Test: a search over a fixture of many files lets a concurrent timer/RPC run mid-search.

### [FEAT-05] Give the simulator screenshot a timeout and drain its stderr

- **Evidence**: `engine/src/surfaces.ts:699-707` — `screenshot` spawns `xcrun simctl io … screenshot` with no timeout; the promise settles only on `close`/`error`. stderr is a pipe nobody reads. Contrast `devices()` at 680 which uses `run` with `timeout: 20000`.
- **Impact**: A simctl that hangs (device in a bad state, CoreSimulator service wedged) leaves the Device panel's screenshot call pending forever — and the UI's `rpc()` has no timeout (a known held item), so the surface spins indefinitely. A verbose stderr (>64 KB) would also wedge the child.
- **Effort**: S
- **Risk**: LOW — a timeout rejects with the same sentence the close-path already uses.
- **Confidence**: HIGH
- **Fix sketch**: Race the close against a ~20 s timer that kills the child and rejects; attach a stderr drain (or stdio ignore for stderr). Test: a fake xcrun that never exits rejects within the timeout.

### [FEAT-06] Escape the Device log filter for NSPredicate, and say when the stream dies

- **Evidence**: `engine/src/surfaces.ts:728` — the filter is embedded in `eventMessage CONTAINS[c] "…"` with only `"` stripped; a backslash is not escaped, so a filter ending in `\` escapes the closing quote and the predicate is malformed. `engine/src/surfaces.ts:729-734` — the spawned `log stream`'s stderr is unread and its exit is only removed from the map; nothing tells the app the stream failed.
- **Impact**: A filter containing a backslash (Windows paths are common log content) kills the log stream immediately and silently — the Device panel shows an empty log with no error, indistinguishable from "nothing logged".
- **Effort**: S
- **Risk**: LOW
- **Confidence**: MED (NSPredicate escaping semantics should be confirmed against `log stream` on a real Mac)
- **Fix sketch**: Escape `\` and `"` for the predicate string literal (or refuse characters it can't hold, in words); on a non-zero exit of the stream child, emit a devlog line saying the stream stopped and why (stderr's first line). Test: parse/build the predicate for a filter with quotes and backslashes.

### [FEAT-07] Bound the proxy's HTML buffering and give hung dev-server requests an end

- **Evidence**: `engine/src/proxy.ts:435-448` — every text/html response is accumulated in `chunks` with no size cap before the probe is injected. `engine/src/proxy.ts:380-388` — the upstream request has no timeout; a dev server that accepts and never answers leaves the Browser's request (and its upstream socket) open indefinitely.
- **Impact**: A dev server streaming endless HTML grows engine memory without bound; a wedged dev server leaves the Browser panel loading forever with no error page. Both are the user's own local server, so this is robustness, not attack surface.
- **Effort**: S
- **Risk**: LOW — over-cap pages can pass through unprobed (the existing `!body` path at 443 already does this for unencodable pages).
- **Confidence**: MED
- **Fix sketch**: Cap buffered HTML (e.g. 8 MB) and pass through untouched beyond it; add an upstream response timeout that destroys the pair and sends the existing 502 note when headers haven't gone. Test: a fake server that trickles HTML forever is cut at the cap; one that never answers gets the 502 note.

### [FEAT-08] Validate a frame's `built` link read from design.json, as setBuilt intends

- **Evidence**: `engine/src/canvas.ts:354` — `normal()` copies any object `f.built` straight into the frame (`f.built as DesignFrame["built"]`), no field checks. `engine/src/canvas.ts:604-608` — `setBuilt`'s comment says the build link is the engine's, "Not a DesignPatch field, so the app's canvas.save can't write one" — but design.json is agent-writable, and `filesSaid` at 2325 tells the agent `built as ${f.built.file}` from it.
- **Impact**: An agent (or a hand edit) can forge a frame's build state/link in design.json; the canvas and design_files then report a build that never happened, and Build's own bookkeeping (buildlinks.ts) can be contradicted by the index it reads. The guard exists for the app path but not the file path.
- **Effort**: S
- **Risk**: LOW — drop or coerce malformed `built` objects in normal(), as invalid sizes are already dropped.
- **Confidence**: MED (buildlinks.ts's consumption of `built` not fully traced)
- **Fix sketch**: In normal(), accept `built` only with the fields buildlinks writes (file/state of their kinds), else leave it out; test that a forged built object in design.json doesn't reach design_files' words.

### [FEAT-09] Don't let freePath's 50-try fallback land on another session's design file

- **Evidence**: `engine/src/designs.ts:193` — `if (!all.some((x) => x.path === path) && (n > 50 || !existsSync(join(root, path)))) return path;` — past 50 collisions the existence check is skipped, so `show()` with html can write over a file another session in the same folder owns (the comment at 186-188 says such a file "is that session's to change").
- **Impact**: After 50 same-slug designs in one folder, a new design silently overwrites an existing file instead of taking a free name. Rare, but it is silent data loss when it happens.
- **Effort**: S
- **Risk**: LOW
- **Confidence**: LOW (intent unclear — the `n > 50` clause may be a deliberate bail; investigate before fixing)
- **Fix sketch**: Keep looping until a genuinely free name (or fail in words past a sane bound); never return an existing path that isn't this session's. Test: 51 collisions still produce a free path.

### [FEAT-10] Mark a folder git-excluded only after the exclude actually landed

- **Evidence**: `engine/src/designs.ts:80-83` — `keepOutOfGit` adds the root to `excluded` before running git; if `git rev-parse` fails transiently (timeout under load) or the append throws, the root is never tried again for the engine's life.
- **Impact**: One transient failure leaves `.liner/` showing as untracked changes in that project forever (until engine restart), which is exactly what the feature exists to prevent.
- **Effort**: S
- **Risk**: LOW
- **Confidence**: HIGH
- **Fix sketch**: Add to `excluded` only on success (or on the confirmed already-excluded read); leave failures retryable. Test: a failing first git call still excludes on the next show.

### [FEAT-11] The non-git files walk is synchronous and follows symlinked directories

- **Evidence**: `engine/src/files.ts:19-41` — when `git ls-files` fails, `listFiles` falls back to a sync `readdirSync`/`statSync` walk (up to 20k entries, depth 8) on the engine thread; `statSync` follows symlinks, so a symlinked directory is walked and its files listed as project files even when it points outside the folder.
- **Impact**: In a non-git folder (or git missing), every @-mention/Files-panel listing blocks the loop for the walk's duration, and the list can include files outside the project via a planted link (the read paths still refuse them, so this is listing noise plus a stall, not a read hole).
- **Effort**: S-M
- **Risk**: LOW
- **Confidence**: MED
- **Fix sketch**: Use lstatSync and skip symlinked dirs; chunk the walk with setImmediate yields (or fs/promises) as FEAT-04 does. Test: a symlinked dir is not walked; a large walk yields.

### [FEAT-12] Guard prList's JSON.parse as prFor already does

- **Evidence**: `engine/src/surfaces.ts:426` — `prList` parses `gh pr list --json` stdout with no try/catch, while `prFor` at 416-420 wraps the same parse and returns null on failure.
- **Impact**: Any non-JSON stdout from gh (a wrapper script, a plugin's banner on stdout) rejects the PR list RPC with a raw SyntaxError instead of the graceful empty/error state the surface expects.
- **Effort**: S
- **Risk**: LOW
- **Confidence**: HIGH
- **Fix sketch**: Wrap the parse; on failure throw the same shaped error as a non-zero gh exit (stderr's words). Test: malformed stdout yields the surface's error, not a parse crash.

### [FEAT-13] A hung DSH plugin call holds its slot until the caller disconnects

- **Evidence**: `engine/src/dsh-hosts.ts:773-790` — a tool call is registered in `run.calls` and answered only when the plugin sends done/fail; the HTTP response is kept alive by a 20 s whitespace heartbeat (782) and aborted only on `res` close (787-790). No per-call timeout exists (start has START_WAIT at 551-556; calls have none). `CALLS_MAX = 16` at 69.
- **Impact**: A plugin whose tool never returns (a bug, a deadlocked fetch without its own timeout) occupies a call slot forever; after 16 such calls every further call to that add-on is refused with "already running 16 calls" until the engine restarts, and each hung caller holds an open response.
- **Effort**: S-M
- **Risk**: LOW-MED — a timeout must abort the call in the child (the abort message already exists, 790) and answer the caller with an error result.
- **Confidence**: LOW (the agent-side MCP client may impose its own timeout that closes the response; investigate the real call path before fixing)
- **Fix sketch**: Add a generous per-call deadline (e.g. 5 min, configurable by the manifest) that sends abort and answers an isError result; test with a fake plugin that never answers.

### [FEAT-14] Re-arm a design watcher after an fs.watch error, not only after the folder goes and comes back

- **Evidence**: `engine/src/canvas.ts:1288` — on watcher error, `fw.close()` and `w.fw = undefined`. `engine/src/canvas.ts:1230-1239` — the 1 s poll re-listens only when `present` flips false→true; while the folder and design.json stay there, nothing re-arms the dead watcher.
- **Impact**: After a transient watch failure (EMFILE under many open designs, a platform hiccup), agent edits to frames stop producing canvas.changed for that design until its folder is removed and restored — the canvas silently stops updating while the editor still writes.
- **Effort**: S
- **Risk**: LOW
- **Confidence**: MED
- **Fix sketch**: In the poll, when `now && !w.fw`, call listen() again (it already guards existsSync); keep the gone/back emit as is. Test: an errored watcher is re-created on the next poll tick.

---

## Coverage note

Fully read: files.ts, winterm.ts, prflow.ts, panels.ts, proxy.ts, surfaces.ts, designs.ts, design-prefs.ts, canvas-tools.ts, canvas.ts (all 2520 lines). Hazard-sampled (grep + targeted context reads, not full line-by-line): security.ts, security-scan.ts (parseLook/hasTests/fixPrompt verified guarded), addons.ts (manifest/storage paths verified guarded), dsh.ts, dsh-hosts.ts (mcp handler, start timer), dsh-host.ts (abort/timeout greps), design-start.ts (journal/restore paths), pictures.ts (WAIT caps). NOT audited in depth: security-checks.ts, security-bringin.ts, security-demo.ts, security-tools.ts, creator.ts, canvas-html.ts internals (stamp/applyOps), lean.ts, buildlinks.ts, watch.ts, and the remaining small files (agents/apps/awake/backgrounds/edits/export/imports/offers/outside/precheck/review/sources/worktrees/memory/usage-ping/doctor/launch/sidekick). The security scan lifecycle, add-on install flows and sandbox-exec profile construction therefore have only sampled coverage; FEAT-08/13 are the two findings that reach into them.
