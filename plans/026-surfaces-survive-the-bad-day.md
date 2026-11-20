# 026. The Design and Device surfaces survive a huge file, a wedged simctl, a backslash filter, a transient git failure, gh's banner, and a dead watcher

**Commit message:** `A huge frame file no longer stalls the engine, the simulator's screenshot and log say when they fail, and a design's watcher and git-exclude recover from a transient failure`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Findings: FEAT-01, FEAT-05, FEAT-06, FEAT-10, FEAT-12, FEAT-14 (all S; FEAT-06 MED confidence). Every excerpt below is
from the advisor's own read.

## Why this matters

Six small robustness holes in the surfaces' automatic paths — each one is a guard a neighbouring path already has:

1. **FEAT-01.** The 2 MB frame cap (`MAX_FRAME`) is enforced on the TOOL path (`frameFile()`, `engine/src/canvas.ts:976-982`:
   "over 2 MB; keep a frame to one page") and on `designs.show` (`engine/src/designs.ts:168`), but NOT on the automatic
   paths: the watcher's `changedOnDisk` (`canvas.ts:~1160`) does `readFileSync(abs)` + `hash(content)` on any changed
   file; `revsOf` (`canvas.ts:2130-2142`) reads every drawn frame whole on `canvas.open`; `Designs.read`
   (`designs.ts:~216`) reads the live file with no cap. An agent writing a huge file into `frames/` (a base64 video
   inline — the exact case MAX_FRAME exists for) stalls the engine's single thread inside a watcher callback.
2. **FEAT-05.** The simulator screenshot (`engine/src/surfaces.ts:699-707`) spawns `xcrun simctl io … screenshot`
   with NO timeout and an unread stderr pipe; it settles only on close/error. `devices()` beside it (:680) uses
   `run(…, { timeout: 20000 })`. A wedged CoreSimulator leaves the Device panel spinning forever (the UI's rpc() has
   no timeout either — a known held item).
3. **FEAT-06.** The Device log filter (`surfaces.ts:728`) is embedded in an NSPredicate with only `"` stripped:
   `eventMessage CONTAINS[c] "${filter.replace(/"/g, "")}" OR process CONTAINS[c] "…"`. A backslash is not escaped —
   a filter ending in `\` (Windows paths are common log content) escapes the closing quote, the predicate is
   malformed, and the stream dies immediately and silently (stderr unread, exit only removed from the map, :731-734).
4. **FEAT-10.** `keepOutOfGit` (`designs.ts:79-93`) adds the root to `excluded` BEFORE running git; a transient
   `git rev-parse` failure or a throwing append means the root is never tried again for the engine's life — `.liner/`
   shows as untracked changes forever, the exact thing the feature prevents.
5. **FEAT-12.** `prList` (`surfaces.ts:423-427`) parses `gh pr list --json` stdout with no try/catch; `prFor`
   (:413-421) wraps the same parse and returns null. A wrapper script's banner on stdout rejects the RPC with a raw
   SyntaxError instead of the surface's error state.
6. **FEAT-14.** On a watcher error (`canvas.ts:1288`) the code closes it and sets `w.fw = undefined`; the 1 s poll
   (:1230-1239) re-listens only when `present` flips false→true. While the folder and design.json stay, nothing
   re-arms the dead watcher — agent edits stop producing canvas.changed until the folder is removed and restored.

## Current state (drift check)

```bash
git log --oneline -1                                   # bfb0ebc or later
sed -n '976,982p' engine/src/canvas.ts                 # frameFile's cap (the exemplar)
sed -n '1155,1195p' engine/src/canvas.ts               # changedOnDisk
sed -n '2130,2142p' engine/src/canvas.ts               # revsOf
sed -n '1230,1239p;1288,1288p' engine/src/canvas.ts    # the poll and the error handler
sed -n '168,168p;210,218p' engine/src/designs.ts       # show's cap; read's uncapped readFileSync
sed -n '79,93p' engine/src/designs.ts                  # keepOutOfGit
sed -n '699,707p;723,734p;423,427p' engine/src/surfaces.ts  # screenshot, devlog set, prList
```

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first. Scratch-design fixtures: `engine/test/designs*.test.ts`
  and `engine/test/canvas*.test.ts` (find them by name) build temp design folders; the fake-child pattern for spawn:
  grep `spawn` in engine/test for an existing seam (else test the pure helpers and pin the spawn wiring by source).
  Test commands need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push. Steps independent; a STOP in one leaves the rest doable.

## Steps

### 1. Cap the automatic frame reads (FEAT-01)

- In `changedOnDisk`: before `readFileSync(abs)`, stat; if the file is over `MAX_FRAME`, treat it as unreadable —
  `content = undefined` (the gone-file path already emits canvas.changed without a rev; the UI learns the file is
  there but unreadable). Do not hash what you did not read. One comment: the tool path refuses over 2 MB; the
  watcher must not read what the tools refuse.
- In `revsOf`: the same stat-first skip (no revision for an over-cap frame — the catch already handles gone files).
- In `Designs.read`: add the same cap show() uses (`statSync(abs).size > MAX` → throw show's sentence).
- Do not change MAX_FRAME/MAX, the emit shapes, or the own-write hash suppression.

**Test first:** a temp design with a 3 MB frame file changed on disk → canvas.changed is emitted WITHOUT a rev and
the engine is not held (assert a concurrent timer fires during the change handling; before the fix the whole file is
read and hashed — the timer assertion may need a large enough file to be meaningful; at minimum assert no rev and no
throw). `canvas.open`/revsOf over the same fixture returns no revision for the huge frame; `Designs.read` throws the
2 MB sentence. See them fail before.
**Verify:** the new tests, the existing canvas/designs tests, engine typecheck.

### 2. The simulator screenshot gets a timeout and a drained stderr (FEAT-05)

In `surfaces.ts`'s `screenshot`: race the close against a ~20 s timer (devices()'s budget) that kills the child and
rejects with the same sentence the close path uses ("The simulator didn't give a screenshot. Is the device booted?");
attach a stderr drain (`child.stderr.resume()` or collect-and-ignore — the bytes are not needed; a verbose stderr
must not wedge the child). Clear the timer on settle. Keep the base64 resolution shape.

**Test first:** if the test suite has a fake-xcrun seam (grep), use it: a child that never exits rejects within the
timeout (use a short seam budget if the code allows injecting it; else source-pin the timer and test the pure race
helper). If no seam exists, extract the race into a small exported helper `withTimeout(promise, ms, kill)` tested
with a never-resolving promise, and pin the wiring by source test. Say which you did.
**Verify:** tests, engine typecheck.

### 3. The log filter is escaped for NSPredicate, and a dead stream says so (FEAT-06)

- Extract a pure helper in surfaces.ts: `export const logPredicate = (filter: string) => …` building the
  `eventMessage CONTAINS[c] "…" OR process CONTAINS[c] "…"` string with BOTH `\` and `"` escaped for an NSPredicate
  string literal (backslash first, then quote: `filter.replace(/\\/g, "\\\\").replace(/"/g, '\\"')`). Use it in `set`.
- When the stream child exits non-zero or errors, emit one devlog line through the class's own batch path saying the
  stream stopped and why (stderr's first line if collected — collect a small tail, ≤2 KB, for this; else the exit
  code). The panel then shows the failure instead of an empty log indistinguishable from "nothing logged".
- MED confidence: NSPredicate's exact escaping should be confirmed against `log stream` on a real Mac if one is
  available (the owner's run); the unit test pins the construction either way. Say "not run on a real simulator" if
  you cannot.

**Test first** (`engine/test/devlog-filter.test.ts`): `logPredicate('a\\b')` holds `a\\\\b` (the backslash doubled),
`logPredicate('say "hi"')` holds `\\"hi\\"`, a trailing backslash does not escape the closing quote (assert the
literal ends `"` unescaped-by-adjacency — pin the exact expected string). Fails before (the helper is new; the OLD
inline construction is pinned by a second test reproducing it and showing the malformed output, documenting the bug).
**Verify:** tests, engine typecheck.

### 4. The git-exclude is marked done only when it landed (FEAT-10)

In `designs.ts`'s `keepOutOfGit`: move `excluded.add(root)` to the success paths — after the append succeeds, and on
the confirmed already-excluded read (:87). A failed `git rev-parse` (code !== 0) or a throwing append leaves the root
retryable on the next show. Keep the "not a repository: nothing to do" early return — but note: a non-repository root
is currently marked excluded forever too; if the folder LATER becomes a repo, the same staleness applies. Mark
non-repos excluded as today (the cheap path) ONLY if you confirm that is intended; else leave them retryable and say
which you chose. The catch's comment stays true.

**Test first:** a temp folder where the first git call fails (a seam on `run`, or a non-repo that becomes a repo
between calls): the second `keepOutOfGit` still appends `.liner/` to info/exclude. Before the fix the second call
returns early — see it fail.
**Verify:** tests, the existing designs tests, engine typecheck.

### 5. prList's parse is guarded as prFor's is (FEAT-12)

In `surfaces.ts`'s `prList`: wrap `JSON.parse(r.stdout)` in try/catch; on failure throw the same shaped error a
non-zero gh exit throws (stderr's words, or "gh pr list gave an answer that isn't JSON." — match the file's voice).
Do not return [] silently: the surface should say it failed, as it does for a gh error.

**Test first:** a fake gh (the seam the PR tests use — grep `prList`/`gh` in engine/test) whose stdout is a banner +
JSON or plain garbage → the RPC rejects with the shaped error, not a SyntaxError. Fails before.
**Verify:** tests, engine typecheck.

### 6. A dead watcher is re-armed on the next poll (FEAT-14)

In `canvas.ts`'s poll (:1230-1239): when `now` is true and `w.fw` is undefined, call `listen(ctx, cwd, slug, dir, w)`
again (it already guards existsSync and the present state). Keep the gone/back emit exactly as it is — the re-arm is
additional, not a replacement. One comment: a watch that errored while the folder stayed is re-armed, not only one
whose folder went and came back.

**Test first:** a temp design folder; kill its watcher via the error path (emit 'error' on the fs.watch instance if
the test can reach it, else close w.fw and set undefined through the state seam the canvas tests use); advance the
poll (fake timers or the 1 s wait); assert a new watcher exists and a subsequent file change emits canvas.changed.
Fails before. If the watcher internals are unreachable in tests, pin the poll's re-arm branch by source test and say
so — do not claim a behavioural test you did not run.
**Verify:** tests, the existing canvas watch tests, engine typecheck.

## Done

- All new tests fail before and pass after (or are honestly labelled source pins); the named existing tests pass;
  `npm run typecheck` exits 0.
- One commit, the message above. Executor note: commit, per-step status, what was not run on real hardware
  (simctl, log stream), any STOP.

## STOP conditions

- A cited region's substance changed: stop that step, report.
- Step 3: NSPredicate escaping differs from the construction on a real Mac (if you can run it): stop, report the
  real behaviour — do not ship a guess.
- Step 4: the non-repo marking decision is unclear from the callers: choose retryable, comment why, report.

## Maintenance note

The automatic paths (watcher, open, read) now share the tools' caps; a new automatic read copies frameFile's guard.
The Device surface's children all have timeouts and said failures; a new spawn copies screenshot's shape.
