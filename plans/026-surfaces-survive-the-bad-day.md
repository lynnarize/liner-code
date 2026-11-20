# 026. The Design and Device surfaces survive a huge file, a wedged simctl, a backslash filter, a transient git failure, gh's banner, a dead watcher, and a broken build link

**Commit message:** `A huge frame file no longer stalls the engine, the simulator's screenshot and log say when they fail, and a design's watcher, git-exclude and build links recover from a bad file`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Refreshed 2026-11-20 at 13c7757 after the advisor's review (engine/src is unchanged since bfb0ebc, so the line numbers hold).
Findings: FEAT-01, FEAT-05, FEAT-06, FEAT-08 (its real fault only), FEAT-10, FEAT-12, FEAT-14.

## What the review changed

- Step 1: the cap now applies to **frame files only**. The file's presence comes from the stat, not from whether it was read; the failing assertion is "no rev" (the old "a timer fires" assertion meant nothing, because the handler is synchronous). `Designs.read` falls back to the kept version instead of throwing.
- Step 3: the expected strings are the ones the review measured with the real `NSPredicate`. The step also covers a backslash in the middle of a filter (it was dropped silently) and quotes (they were stripped). "Stopped" is said only for the live child on a real exit.
- Step 4: a folder git says is not a repository ("not a git repository", exit 128) is marked done. Every other failure is retried. The STOP's old default ("retryable") would have run git on every frame added in ~/Liner Designs.
- New step 7 (from FEAT-08): a malformed `built` in design.json is left out, so it can't crash `buildState`. The "forgery" part of FEAT-08 is dropped, because the agent owns design.json anyway.
- Each test now names the seam that already exists: `fakeGh`, the `env` PATH, `DeviceLogs.tool`, and `ctx.keep("canvas")`. Steps 1, 4, 5, 6 and 7 were seen failing at 13c7757 in scratch probes.

## Why this matters

1. **FEAT-01.** The 2 MB cap (`MAX_FRAME`, `engine/src/canvas.ts:147`) is enforced in several places:
   - the tool paths: `frameFile()` at `:976-982`, used by `readFrameRev`, `addFrame` at `:801`, a frame from a path at `:2417`, and a kept version's read at `:2008`;
   - `designs.show` (`engine/src/designs.ts:153,168`).

   Three automatic paths skip it:
   - the watcher's `changedOnDisk` (`canvas.ts:1161`: `readFileSync(abs)`, then `hash(content)` at :1171 and `revOf` at :1191);
   - `revsOf` (`canvas.ts:2136`, on every `canvas.open`);
   - `Designs.read` (`designs.ts:216`).

   An agent writing a huge frame (a base64 video inline) makes the engine read and sha1 it on its single thread. The cost is milliseconds at a few MB and grows with the file; the point is that these paths should share the tools' refusal.
2. **FEAT-05.** `screenshot` (`engine/src/surfaces.ts:699-707`) spawns `xcrun simctl io … screenshot` with no timeout, and nobody reads its stderr pipe. `devices()` (:680) uses `run(…, { timeout: 20000 })`. A wedged CoreSimulator leaves the Device panel waiting forever.
3. **FEAT-06.** The log filter (`surfaces.ts:728`) is pasted into an NSPredicate with only `"` removed. Measured with `NSPredicate predicateWithFormat` and `/usr/bin/log stream` on this Mac:
   - Filter `C:\` builds `eventMessage CONTAINS[c] "C:\" OR process CONTAINS[c] "C:\"`. `log` exits 64: `log: Bad predicate (Unable to parse the format string …)`. The stream dies, and nothing reads its stderr or exit (:729-734).
   - Filter `C:\Users\x` parses as `"C:Usersx"`: the backslashes are dropped and the filter silently matches nothing.
   - Filter `say "hi"` becomes `"say hi"`: the wrong text.
4. **FEAT-10.** `keepOutOfGit` (`designs.ts:79-93`) adds the root to `excluded` at :81, before `await run("git", …)`. A failed `git rev-parse` or a throwing append means the root is never tried again for the engine's life.
5. **FEAT-12.** `prList` (`surfaces.ts:423-427`) parses `gh pr list --json` stdout unguarded, while `prFor` (:413-421) wraps the same parse. Seen at 13c7757: a fake `gh` printing a banner line and then `[]` makes `prList` reject with `SyntaxError: Unexpected token 'W', "Welcome to"... is not valid JSON`.
6. **FEAT-14.** On a watcher error, `fw.on("error", …)` (`canvas.ts:1288`) closes the watcher and sets `w.fw = undefined`. The 1 s poll (:1229-1239) re-listens only when presence flips. Seen at 13c7757: after `w.fw.emit("error")`, `w.fw` is still undefined a poll later, and a later frame write produces no `canvas.changed`.
7. **FEAT-08 (the real fault).** `normal()` copies any object `built` from design.json (`canvas.ts:354`). `buildState` (`engine/src/buildlinks.ts:69-93`) then calls `inside(cwd, b.file)` (:78). With `built: {}`, `isAbsolute(undefined)` throws `TypeError: The "path" argument must be of type string`, so the whole design's build state fails. Seen at 13c7757.

## Current state (drift check)

```bash
git log --oneline -1                                   # 13c7757 or later
git diff 13c7757 -- engine/src/canvas.ts engine/src/designs.ts engine/src/surfaces.ts engine/src/buildlinks.ts | head   # expect nothing
sed -n '147,149p;976,982p' engine/src/canvas.ts        # MAX_FRAME, FRAME_FILE, frameFile's cap (the exemplar)
sed -n '1153,1192p' engine/src/canvas.ts               # changedOnDisk
sed -n '2127,2142p' engine/src/canvas.ts               # revsOf
sed -n '1226,1239p;1286,1289p' engine/src/canvas.ts    # the poll and the error handler
sed -n '354p' engine/src/canvas.ts                     # normal()'s built
sed -n '209,218p' engine/src/designs.ts                # Designs.read
sed -n '79,93p' engine/src/designs.ts                  # keepOutOfGit
sed -n '413,427p;699,707p;715,770p' engine/src/surfaces.ts  # prFor/prList, screenshot, DeviceLogs
sed -n '69,82p' engine/src/buildlinks.ts               # buildState
```

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first and seen failing. Test commands need
  `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test <file>`.
- Fixtures to reuse:
  - design ctx + store: `setup()` in `engine/test/canvas-peek.test.ts:20-28` and `engine/test/buildlinks.test.ts:33-61`;
  - designs: `setup()` in `engine/test/designs.test.ts:25`;
  - fake `gh`: `fakeGh()` in `engine/test/audit-api.test.ts:443` (module-local, so put the new test in that file or copy the four lines);
  - DeviceLogs: the `tool` seam, `(logs as unknown as { tool: string }).tool = …` (`engine/test/audit-api.test.ts:256-263`);
  - spawn's `env` PATH: `screenshot(udid, env)` looks up `xcrun` on `env.PATH`;
  - canvas state: `ctx.keep("canvas", …)` returns the live `State`, so `.watchers.get(dir).fw` is reachable.
- One local commit, the message above. Never push. Steps are independent; a STOP in one leaves the rest doable.

## Steps

### 1. Cap the automatic frame reads (FEAT-01)

- **`changedOnDisk` (canvas.ts:1154-1192).** For a path that matches `FRAME_FILE` only, take the `lstatSync` result first and keep it apart from the read:
  - Presence is `l?.isFile()`, and `st.there` is set from presence, not from `Boolean(content)` (:1168). Otherwise an over-cap file reads as gone, and the next normal write as "back".
  - When `l.size > MAX_FRAME`, do not read and do not hash: `content` stays undefined, so the event goes out without a rev (:1191 already leaves `rev` out when there's no content).
  - `moved` must also come from presence, so an over-cap frame that is there is not told as moved.
  - design.json and `assets/` keep today's read. A big picture in assets/ is legitimate, and design.json with no content returns early at :1173, which would silence it.
  - One comment: the tools refuse a frame over 2 MB, so the watcher doesn't read one either.
- **`revsOf` (:2128-2142).** Skip a frame over `MAX_FRAME` by stat before `readFileSync` (no revision, as for a gone file).
- **`Designs.read` (designs.ts:209-218).** With no version asked, a live file over `MAX` (by `statSync`) is not read. Fall back to the latest kept version, exactly as for a missing file: `this.version(threadId, design, latest.version) ?? ""`. The person still sees the design, and show() already refuses to keep a version that big.
- Do not change `MAX_FRAME`/`MAX`, the emit shapes, or the own-write hash suppression.

**Test first** (in `engine/test/canvas-peek.test.ts` or a new `engine/test/frame-cap.test.ts`, using the canvas-peek `setup()`):
- A design with a drawn frame `big`. `canvas.open` → `revs.big` is undefined when the file is 3 MB.
- `watchFile(ctx, root, slug, true)`, then rewrite `frames/big.html` with 3 MB. After ~1.2 s, the `canvas.changed` event for frame `big` has no `rev` and is not `gone`. A later 1 KB write gives one with a rev.
- `Designs.read` of a design whose live file grew past 2 MB returns the last kept version's HTML (designs.test.ts `setup()`).

Seen failing at 13c7757: `revs.big` present, and the watcher event carried `rev: "b37aa12c4534"`.
**Verify:** the new tests, `node --test engine/test/canvas.test.ts engine/test/canvas-peek.test.ts engine/test/designs.test.ts`, `npm run typecheck`.

### 2. The simulator screenshot gets a timeout and a drained stderr (FEAT-05)

In `surfaces.ts`'s `screenshot`:
- Race the close against a timer (20 s, devices()'s budget) that kills the child and rejects with the close path's sentence ("The simulator didn't give a screenshot. Is the device booted?").
- Drain stderr (`child.stderr.resume()`).
- Clear the timer on settle, and keep the base64 resolution shape.
- Make the budget a module `let` with a setter, following the file's neighbours' pattern (`acp.ts:340-342`'s `setOpencodeUsageMs`), so a test doesn't wait 20 s.

**Test first:** a fake `xcrun` on a temp PATH (`#!/bin/sh\nsleep 30`) and `screenshot("x", { PATH: bin })` with the budget set to 200 ms. It rejects with the sentence within ~1 s, and the fake is gone. Before the fix it never settles; bound the test with its own 3 s race and assert the rejection.
**Verify:** the test, `npm run typecheck`.

### 3. The log filter is escaped for NSPredicate, and a dead stream says so (FEAT-06)

- Add `export const logPredicate = (filter: string) => …` in surfaces.ts:
  - Escape backslash first, then quote: `const e = filter.replace(/\\/g, "\\\\").replace(/"/g, '\\"')`.
  - Return `` `eventMessage CONTAINS[c] "${e}" OR process CONTAINS[c] "${e}"` ``.
  - Use it in `DeviceLogs.set` (:728).
- Keep a small tail of the child's stderr (≤2 KB). In the existing `close` handler, inside its `this.live.get(udid) === child` check, emit one devlog line only when the exit is real: `code !== 0 && code !== null`, i.e. not our own kill, which ends with a signal. The line says the log stopped and why (stderr's first line, else the exit code), through `this.store.emit({ type: "devlog", udid, lines: [...] })`.
  - A replaced stream (a new filter) and `stopAll` are already deleted from `live` before their close, so they say nothing.
  - Leave the `error` handler (no xcrun on the machine: the log stays empty, as its comment says).

**Test first** (`engine/test/devlog-filter.test.ts`). Expected strings, as measured; in the JS source below a single `\` is written `\\`:
- `logPredicate("C:\\")` === `` `eventMessage CONTAINS[c] "C:\\\\" OR process CONTAINS[c] "C:\\\\"` `` (the text `"C:\\"`).
- `logPredicate("C:\\Users\\x")` holds `"C:\\\\Users\\\\x"` (the text `"C:\\Users\\x"`).
- `logPredicate('say "hi"')` holds `"say \\"hi\\""` (the text `"say \"hi\""`).
- `logPredicate("50%")` holds `"50%"` unchanged.
- The dead stream: a `DeviceLogs` with `tool` set to a temp script that writes `log: Bad predicate` to stderr and exits 64. After `set("abc", true, "x")`, a `devlog` event with a line containing "Bad predicate" arrives. A second test calls `set` on, then off, with a script that sleeps, and asserts that no "stopped" line arrives.

Before the fix, the import fails (the helper is new) and no devlog line comes from the exit script. The second half is the behavioural failure.

MED confidence holds only for the simulator: on this Mac `/usr/bin/log` behaves as described. Running inside a simulator through `simctl spawn` is owed to the owner; say "not run on a real simulator".
**Verify:** the tests, `node --test engine/test/audit-api.test.ts`, `npm run typecheck`.

### 4. The git-exclude is marked done only when it landed, or git says there's no repository (FEAT-10)

In `designs.ts`'s `keepOutOfGit`:
- Move `excluded.add(root)` to the end states:
  - after the append succeeds;
  - on the already-excluded read (:87);
  - when `run` returns code 128 with stderr matching `/not a git repository/i`. That is final: a folder in ~/Liner Designs isn't a repository, and `addFrame` (canvas.ts:874) calls this on every frame added.
- Any other failure (a timeout, which `run` reports as code 1; a throwing read or append) leaves the root retryable.
- Keep the catch's comment true. Add one comment saying why "not a repository" counts as done and the rest don't.

**Test first** (`engine/test/designs.test.ts`):
- `git init` a temp folder.
- Make `.git/info/exclude` 0444 and `.git/info` 0555, then `await keepOutOfGit(root)`; the append throws.
- Restore the modes and call `await keepOutOfGit(root)` again. The exclude now holds `.liner/`.

Seen failing at 13c7757: the second call returned early and the exclude had no `.liner/`. A second test can pin that a non-repo is marked: call twice on a non-repo temp folder with `GIT_CEILING_DIRECTORIES` unset. It's hard to observe without a seam, so it's optional; the comment carries the reason.
**Verify:** the test, `node --test engine/test/designs.test.ts`, `npm run typecheck`.

### 5. prList's parse is guarded as prFor's is (FEAT-12)

In `prList` (surfaces.ts:423-427), wrap `JSON.parse(r.stdout)`. On failure, throw `new Error("gh pr list gave an answer that isn't JSON.")`, in the file's voice. Do not return [] silently: the PR surface should say it failed, as it does for a gh error at :425.

**Test first** (in `engine/test/audit-api.test.ts`, beside `fakeGh`): a fake `gh` printing `Welcome to gh-wrapper` then `[]`. `prList(bin, { PATH: bin + ":" + process.env.PATH })` rejects with `/isn't JSON/` and not a `SyntaxError` (`assert.rejects(…, (e) => !(e instanceof SyntaxError) && /isn't JSON/.test(e.message))`). Seen failing at 13c7757 (a SyntaxError).
**Verify:** the test, `npm run typecheck`.

### 6. A dead watcher is re-armed on the next poll (FEAT-14)

In `watchFile`'s poll (canvas.ts:1229-1239), before `if (now === w.present) return;`, add `if (now && w.present && !w.fw) listen(ctx, cwd, slug, dir, w);`. `listen` already catches a `watch` that throws, so a watch that keeps failing is tried again once a second and nothing else. Keep the gone/back emit exactly as it is. One comment: a watch that errored while the folder stayed is re-armed, not only one whose folder went and came back.

**Test first** (canvas-peek `setup()`):
- Create a design and call `watchFile(ctx, root, slug, true)`.
- `const w = ctx.keep("canvas", () => ({}) as never).watchers.get(designDir(root, slug))` (import `designDir` from canvas.ts: it resolves links, so a hand-joined tmpdir path misses), then `w.fw.emit("error", new Error("EMFILE"))`.
- Wait 1.3 s and assert `w.fw` is set again.
- Write a frame file, wait 0.8 s, and assert a `canvas.changed` for that frame.
- Turn the watch off at the end.

Seen failing at 13c7757: `fw` was still undefined after a poll, and 0 events arrived.
**Verify:** the test, `node --test engine/test/canvas.test.ts engine/test/canvas-peek.test.ts`, `npm run typecheck`.

### 7. A malformed build link is left out of the index, not a crash (FEAT-08's real fault)

In `normal()` (canvas.ts:354), keep `built` only when it is an object whose `file`, `frameHash` and `fileHash` are strings: the fields `buildlinks.ts:58` writes, read at :77-82. Otherwise leave it out, as invalid sizes are. The frame then reads as not built, and `filesSaid` (:2325) no longer names a file that isn't one. One comment: design.json is the agent's to write, and a link missing its fields would throw in `buildState`.

**Test first** (`engine/test/buildlinks.test.ts`, its `setup()`): write design.json with a frame carrying `built: {}` (and another with `built: { file: 5 }`). `buildState(ctx, cwd, slug)` doesn't throw, and those frames read `state: "none"`. Seen failing at 13c7757: `TypeError: The "path" argument must be of type string. Received undefined`.
**Verify:** the test, `node --test engine/test/buildlinks.test.ts engine/test/canvas.test.ts`, `npm run typecheck`.

## Done

- All new tests fail before and pass after; the named existing tests pass; `npm run typecheck` exits 0.
- One commit, the message above. Executor note: commit, per-step status, what was not run on real hardware (simctl screenshot, `log stream` inside a simulator), any STOP.

## STOP conditions

- A cited region's substance changed since 13c7757: stop that step, report.
- Step 3: if you run `log stream` inside a booted simulator and the escaped predicate is refused there, stop and report the real behaviour. Do not ship a guess.
- Step 1: if the UI treats a frame `canvas.changed` without a rev as "the file is gone" (read `ui/src/app/design/` for the handler), stop and report. The step assumes the UI re-reads, and the re-read then gets frameFile's "over 2 MB" sentence.

## Maintenance note

The automatic paths (watcher, open, read) now share the tools' caps; a new automatic read copies frameFile's guard and
takes presence from the stat. The Device surface's children all have timeouts and say their failures; a new spawn
copies screenshot's shape. Anything read from design.json is checked field by field in normal(), as sizes are.
