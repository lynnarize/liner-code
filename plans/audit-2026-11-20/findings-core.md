# Findings — CORRECTNESS: engine core (CORE)

Auditor: core. Repo: Liner Code @ bfb0ebc (branch design-and-api-endpoints). Read-only audit.
Playbook read: yes (audit-playbook.md §1 Correctness/Bugs, Finding format, Prioritization rubric).
Scope read in full: engine/src/runtime.ts (4010), store.ts, checkpoints.ts, server.ts, exec.ts, sidekick.ts, review.ts, api.ts (2311), watch.ts, awake.ts, launch.ts, updates.ts, imports.ts, memory.ts, worktrees.ts, atomic.ts, lean.ts, precheck.ts, usage-ping.ts, doctor.ts, main.ts (wiring/quit); contracts/src/cast.ts, tiers.ts, doing.ts, index.ts (logic sections). Providers read only where the core gates meet them (acp.ts inProject/gitInside, marking call sites).
Reconciliation: nothing below re-reports the 2026-11-18 fixes, plans 001–014, the known flaky tests, rejected findings, or EDGE-CASES items marked fixed. Line numbers are HEAD bfb0ebc.
Leverage order (impact ÷ effort, discounted by confidence and fix-risk): CORE-06, CORE-01, CORE-08, CORE-11, CORE-02, CORE-05, CORE-04, CORE-10, CORE-07, CORE-03, CORE-09.
Considered and not reported: store.removeProject orphan logs (api.project.remove drops every thread first); firstLine hang on an ended stdin (the shell keeps stdin open, /dev/null EOF fires after attach); updates/state.json non-atomic write (constructor tolerates corruption, small file); refused-undo snapshot refs accumulate (forget cleans them at delete); doctor probe env stripping (strictly cleaner than a real session's env); launch.ts port race between two entries (the loser exits early and says so).

### [CORE-01] Read a merge commit's parent line as parents plus a timestamp, not two words

- **Evidence**: `engine/src/checkpoints.ts:227-231` — `git log --no-walk=unsorted --format=%P %ct` is split with `fromLine.split(" ")` into `[start, at]`; a merge commit prints two parents, so `at` becomes the second parent's hash, not the commit time. `engine/src/checkpoints.ts:244` — `--since=@${at}` then fails to parse, `list()` throws (`:235`), and the catch at `:248-251` returns null, which `changes()` (`:206`) reads as "HEAD stayed put, every change is the turn's".
- **Impact**: When HEAD was a merge commit at the turn's start and moved during the turn (a pull or merge mid-turn), the authored-paths filter silently disables itself: files the pull brought in are attributed to the turn, so its diff card shows them and Undo puts back files the turn never wrote. The fallback comment says "an older git without remerge diffs", but this fires on current git too.
- **Effort**: S
- **Risk**: LOW — parsing change only; the null fallback stays for genuine failures.
- **Confidence**: MED — read the code; git's `%P` output for merges is certain, the end-to-end effect needs a scratch-repo test (a merge at turn start, HEAD moved during it).
- **Fix sketch**: Separate the fields unambiguously (`--format=%P%x09%ct`, take the last tab-field as the time, the first parent as start), and add a test with a merge-commit HEAD that fails without the fix.

### [CORE-02] Ask git for the Reviewer's small-change numstat with -z and -M, as the checkpoint path does

- **Evidence**: `engine/src/runtime.ts:1860` — `changeOf` runs `git diff --relative --numstat from cp.to` with neither `-z` nor `-M`; `contracts/src/index.ts:1194-1199` (`smallChange`) then tests `f[2]` against `/\.(md|mdx|txt|rst|adoc)$/i`. Without `-z`, git C-quotes a non-ASCII path (`"caf\303\251.md"`), so the trailing quote defeats the docs test; without `-M`, a rename reads as delete+add with full line counts. The checkpoint path already knows this (`engine/src/checkpoints.ts:160-164` comment, `-M -z` at `:187`).
- **Impact**: A docs-only change with one non-ASCII file name, or a pure rename of a large file, is never "small": it costs a full Reviewer read (a quiet model turn, up to 10 minutes) instead of passing through. Wasted spend and wait, no lost work.
- **Effort**: S
- **Risk**: LOW — same flags the diff card already uses; smallChange's parser would need the -z record shape (or keep -M only and strip quotes).
- **Confidence**: HIGH — git's quoting without -z is documented and already cited in checkpoints.ts; the regex mismatch is plain in the code.
- **Fix sketch**: Pass `-z` (and `-M`) and parse records as `numstat()` does, or at minimum `-M` plus unquoting; test a unicode docs-only change and a rename that reads small without the fix being absent.

### [CORE-03] Guard the sink's late calls against a deleted thread, as usage already is

- **Evidence**: `engine/src/runtime.ts:3708` — `sink.usage` checks `store.threads.some(...)` before touching the thread; its siblings do not: `session` (`:3729`), `notice` with `once` (`:3739`), `effortNow` (`:3756`), `error` (`:3769`), `window` (`:3774`), `limited` (`:3778`) all call `store.thread(threadId)`, which throws `No thread <id>` (`engine/src/store.ts:332-335`). A side chat is removed without waiting for its turn to wind down (`engine/src/api.ts:401-406`, `dropSide`: closeThread then removeThread at once), so its tool's late events land after removal.
- **Impact**: A late session-id/error/limit report from a deleted side chat (or any thread deleted mid-wind-down) throws inside the provider's event handling. Where lines are read through `jsonLines` the throw is caught and logged (`engine/src/exec.ts:811-815`); in the Claude SDK loop it can fail a turn that is already ending and surface as an error event. At best log noise on a normal delete, at worst a spurious failure path — the usage guard shows the intended behavior.
- **Effort**: S
- **Risk**: LOW — early-return like usage's; a deleted thread keeps nothing anyway.
- **Confidence**: MED — the throw path is certain from the code; which providers surface it as more than log noise needs a fake-agent test.
- **Fix sketch**: One shared "thread still there" check at the top of these sink methods (as usage has), returning quietly when it is gone; a test that deletes a side chat mid-turn and feeds a late session/error event.

### [CORE-04] Clear the /surface keep-alive interval when the caller disconnects

- **Evidence**: `engine/src/server.ts:172-185` — the 20-second space heartbeat (`setInterval(() => res.write(" "), 20_000)`) is cleared only in `done`, when the work settles. `res.on("close", ...)` (`:173`) aborts the `gone` signal but never clears the interval. A surface call that waits on a person (an add-on install card, `runtime.askLiner`, has no timeout) can stay pending long after its MCP caller disconnected.
- **Impact**: Every abandoned-but-still-pending surface call leaves a 20s timer writing to a destroyed response for as long as the work stays pending (a card can wait on a person indefinitely). Probed on this Node: `res.write` after destroy returns false silently, so no crash — but the interval, the response and the pending work are retained, and the engine keeps "serving" a caller that is gone. The /events stream clears its heartbeat on close (`:130-138`); this path does not.
- **Effort**: S
- **Risk**: LOW — clear the interval in the close handler as /events does.
- **Confidence**: HIGH — leak read from the code; write-after-destroy behavior verified with a local probe (returns false, no error event).
- **Fix sketch**: Track `beat` and clear it in the `close` handler (and guard the write with `res.destroyed`); test a surface call whose caller disconnects while the work stays pending.

### [CORE-05] Settle the waiter even when a Stop listener's disk write fails

- **Evidence**: `engine/src/runtime.ts:3443-3453` — the approval/question waiter's `gone` abort listener writes to disk (`store.putItem(... state: "expired")`) before `reject(...)`, with no guard; same shape in `askLiner`'s `gone` (`:1143-1149`, which also calls `store.item`, a throw when the item is gone) and the PR-test abort listener (`:1401-1410`). These run inside `AbortController.abort()` (`stop`, `:2286`); a listener that throws on an EventTarget is reported as an uncaught exception — which `engine/src/main.ts:249` only logs — and the rest of that listener (the resolve/reject) never runs. The turn's own `sink.end()` write was wrapped for exactly this failure (`:1687-1693`, the EDGE-CASES disk-full fix), but the abort listeners were not.
- **Impact**: With a full or read-only disk, pressing Stop with a card open leaves the tool's approval promise unsettled: the call hangs until the 15-second stop grace force-closes the session, and the card's expired state is never written. The engine survives (main.ts logs the uncaught exception), so this is a stalled wind-down and a lost card state, not a crash — the same disk-full class the sink.end fix removed, one layer down.
- **Effort**: S
- **Risk**: LOW — wrap the listener bodies; the card may stay "asking" in memory when the write fails, which the next timeline read settles.
- **Confidence**: MED — the write path and EventTarget semantics are clear; a write-failure test should pin the unsettled-waiter effect.
- **Fix sketch**: Try/catch around the disk writes in the three gone/abort listeners, always settling the waiter (log and resolve as refused, as sink.end does); use timeline().find instead of store.item in askLiner; a test that injects a putItem failure during Stop.
### [CORE-06] Hold the thread across git.commit and git.switch, as rewind and undo already do

- **Evidence**: `engine/src/api.ts:1640-1642` — `git.commit` checks `idleOr(threadId, ...)` once, then awaits prefixOf, two ls-files, `git add` and a commit that may run hooks for up to 10 minutes (`:1672`); `git.switch` (`:1612-1621`) is the same shape. Neither takes `runtime.exclusive`, and `thread.send` (`:1238-1277`) checks nothing about a commit or switch in flight — a message sent during those awaits starts a turn beside them. `checkpoint.revert` (`:1561`) and `thread.rewind` (`:1315`) already hold the thread with `runtime.exclusive` for exactly this reason (the EDGE-CASES rewind/delete lock fix); commit and switch were left outside it.
- **Impact**: A turn started mid-commit edits files while `git add -A`/`git commit` stage and commit them: the commit can capture half-written agent edits, and the turn's own checkpoint bookkeeping (the `open` list read at `:1644` before the awaits) never marks them committed, so Undo later tries to put back files that are now in a commit. Mid-switch, `git switch` changes the working tree under a turn whose before-snapshot was taken on the old branch. Same class as the fixed rewind race, on the paths that stayed uncovered.
- **Effort**: S
- **Risk**: LOW — wrap the git work in `runtime.exclusive` as revert does; messages queue instead of racing (the hold's drain sends them after).
- **Confidence**: HIGH — the missing hold and the unguarded send are plain in the code; the race window is the git time of add/commit/switch.
- **Fix sketch**: Run commit's and switch's git steps inside `runtime.exclusive(threadId, ...)` (keep the early idleOr refusal for its message); a test that sends a message while a fake slow commit runs and asserts it queues.

### [CORE-07] A Keep that fails to apply leaves the checkout as git apply left it

- **Evidence**: `engine/src/api.ts:1818-1819` — `compare.keep` runs `git apply --3way --whitespace=nowarn -` on the project's top folder and throws when the exit code is non-zero. With `--3way`, a patch that doesn't apply cleanly falls back to a three-way merge that can apply part of the patch and leave conflict markers in the working tree (and staged entries) before exiting 1; nothing here restores the checkout or says which files were touched.
- **Impact**: Pressing Keep on a comparison whose base has moved on can fail with "The changes didn't apply to this checkout" while the person's main checkout is left with conflict markers and partially applied changes — the error reads as "nothing happened" but the folder is dirty, and the sessions of that folder now see the markers as outside edits. No other session working in that folder is checked either (`busyBeside` is not consulted here).
- **Effort**: M
- **Risk**: MED — a rollback must not destroy the person's own uncommitted work; the safe shape is to detect the partial apply and say exactly what was left, or apply through a throwaway worktree/index.
- **Confidence**: MED — git apply --3way's conflict behavior is documented; the exact residue needs a scratch-repo test with a conflicting base.
- **Fix sketch**: Refuse when another session works in the target folder (busyBeside); on a non-zero apply, read `git status`/conflicted paths and name them in the error (or reset only the paths the apply touched, never others); test a conflicting Keep.

### [CORE-08] Read search and import histories off the engine's thread, as Recent already does

- **Evidence**: `engine/src/memory.ts:106` — `searchSessions` loops every thread of the project and calls `store.peek(t.id, ["user","text"])`, which for any timeline not in memory reads and JSON-parses the whole log synchronously (`engine/src/store.ts:544-561`); it serves both the app's search and the agent's `sessions_search` (`engine/src/agent-tools.ts:911`). `engine/src/imports.ts:327` — `transcript()` walks the whole Codex sessions tree with the synchronous `rollouts` (the file's own comment at `:160-163` says the tree holds thousands of rollouts and `recentSessions` uses the async `newestRollouts` for exactly that reason), then `:350` reads the chosen session file whole with `readFileSync` and parses every line.
- **Impact**: One search or import on a project with a long history blocks the single engine loop for the duration of the disk reads and parses — every other session's stream, approvals and timers stall behind it. The 2026-11-18 pass made sessions.list/recent cheap and moved the Codex walk off-thread for Recent; search and import kept the synchronous shape.
- **Effort**: M
- **Risk**: LOW — the async walk already exists to reuse; search can read logs in awaited chunks or keep a small per-thread index.
- **Confidence**: HIGH — the synchronous calls are plain in the code; the stall scales with history size (no measurement taken).
- **Fix sketch**: Route transcript's Codex lookup through newestRollouts (or a targeted async find) and read the file in chunks; make searchSessions async with awaited reads (its callers are already async RPC handlers); pin with a test that a slow read doesn't hold a fake turn's events.

### [CORE-09] autoPull's busy check is a moment before the pull, not a hold across it

- **Evidence**: `engine/src/watch.ts:49-55` — `pull()` checks `this.busy(p.path)` before and after reading status/branch, then awaits `git pull --ff-only` with nothing holding the checkout; a message sent during the pull's network time starts a turn in that folder (thread.send checks nothing about a pull). The comment at `:42-43` says the guard exists so a pull never runs under a turn.
- **Impact**: With autoPull on, a turn can start mid-pull and work in a tree the pull is still updating. The turn's change attribution survives (authoredPaths excludes what came with HEAD), but the agent reads and edits files that change under it mid-turn. Narrow window: opt-in setting, clean checkout on the default branch, send during the pull.
- **Effort**: S
- **Risk**: LOW — hold the project's sessions (or re-check busy after the pull and say so) rather than widening the lock.
- **Confidence**: LOW — the gap is real in the code; how often a send lands inside it needs measurement, and the attribution mitigation softens the worst outcome. Investigate before fixing.
- **Fix sketch**: Take the same per-thread hold the commit/switch fix uses for every session in the checkout (or skip the pull when one is opening), and re-check busy after; a test with a fake slow pull and a send mid-flight.

### [CORE-10] A tool update runs on a busy-check, not a hold: a turn can start mid-update

- **Evidence**: `engine/src/updates.ts:720-731` — `next()` picks a wanted tool only when `this.busy.working(t.id) === 0`, then `runUpdate` runs the tool's own updater for up to 15 minutes (`:762`); nothing stops a new turn starting on that tool while the updater replaces its files. `runtime.working(family)` (`engine/src/runtime.ts:3138-3145`) is a count asked at selection time, and `thread.send`/`openSession` never consult the updater.
- **Impact**: A message sent while `claude update` / `codex update` / `npm install -g` is replacing the tool can open a session on a half-installed binary: the turn fails to start (spawn or syntax error) and says so; the next turn works. Self-healing, but it is the same check-then-act shape as the commit/pull races, on a window that lasts minutes rather than seconds.
- **Effort**: S
- **Risk**: LOW — a "updating" gate the runtime consults before opening that family's sessions (queue the message with a note, as a worktree setup does).
- **Confidence**: MED — the unguarded window is plain in the code; how often a send lands in it depends on update timing (auto updates wait for idle, which is exactly when a person may send).
- **Fix sketch**: Expose the updating family to the runtime (as settingUp is exposed) and hold sends behind it with the worktree-setup pattern; a test that a send during a fake update waits and then opens the new version.

### [CORE-11] Follow links in the turn-grant's in-project check, as the ACP gate already does

- **Evidence**: `engine/src/runtime.ts:2880-2882` — `turnCovers` (what "don't ask again this turn" lets an edit go ahead on at Manual/Edits) checks `resolve(cwd, f.value)` against `resolve(cwd)` with `startsWith` — plain lexical paths, no link following. The ACP gate for the same rule was fixed to follow links (`engine/src/providers/acp.ts:1311-1313`, `inProject` → `inFolder`, the EDGE-CASES symlink fix), and `gitInside` (`engine/src/providers/acp.ts:672-680`) resolves real paths too; the runtime's turn-grant gate kept the lexical check.
- **Impact**: A symlink inside the project that points outside it passes the turn-grant's "every file it names is in the project" test, so an edit through it goes ahead without asking on a tool whose edits come through Liner's approve (Claude Code's, Codex's apply_patch) — the write lands outside the project under a grant that promised in-project only. The ACP path is covered by its own gate; this is the same rule enforced two ways, one of them stale. Needs a planted or agent-made link to bite, and the tool's own path rules may catch some cases — hence investigate-and-pin, not a certain bypass.
- **Effort**: S
- **Risk**: LOW — reuse the same real-path check the ACP gate uses; a link to nothing counts as outside, as there.
- **Confidence**: MED — the lexical check and the divergence are certain in the code; whether Claude Code/Codex's own write path catches the link first needs a fake-tool test.
- **Fix sketch**: Resolve each named file's real path (as acp.ts inFolder does) before the in-project test in turnCovers; a test with an in-project symlink pointing out that fails without the fix.
