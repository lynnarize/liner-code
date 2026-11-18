# Engine core audit (runtime, store, server, main, exec, checkpoints, launch, and the small modules)

Read in full: runtime.ts (all 3850 lines), store.ts, server.ts, main.ts, checkpoints.ts, watch.ts, awake.ts, worktrees.ts, paths.ts, mcp.ts, edits.ts, memory.ts, contracts/src/doing.ts, and the uncommitted diff of runtime.ts, store.ts and contracts/src/index.ts. Partly read: exec.ts (spawn, run, killTree, closesOnExit), launch.ts (the Launcher class), agent-tools.ts (keys, waiting, serverFor, call). The new engine/test/doing.test.ts passes (20/20, run alone).

Overall the turn loop is careful: every waiter has a matching expiry, timers on live sessions are cleared through `unwarmed`, the watchdog is cleared on shutdown, the stream handles a client that leaves during its snapshot, and the new doing line is throttled and cleared on every way a turn ends. Most findings below are small. Numbers 1 to 5 are the ones worth doing first.

### 1. A sidekick brief ending clears the lead's doing line while the lead's turn still runs (new today)
- category: bug
- severity: medium
- confidence: confirmed (how long the line stays blank depends on the tool, see below)
- where: engine/src/runtime.ts:2464, :2607, :3642-3646
- evidence:
  ```ts
  // runBrief
  const cards = this.sink(threadId, turn, abort.signal, agentId);
  ...
  } finally { ...; cards.end(); }
  // sink(...).end
  end: () => { settle(); over = true;
    // The turn has ended: it does nothing more, though its wind-down (snapshots, the Reviewer) takes a while yet.
    this.doneDoing(threadId);
  ```
- what goes wrong: `runBrief` builds a second sink only to reuse the lead's approval cards, and ends it when the brief ends. `end()` now calls `doneDoing(threadId)` for the whole thread. That deletes the lead's `doingSent` entry and sets `Thread.doing` to nothing, even though the lead's turn is still running. With one brief, the sidebar line goes blank from the brief's end until the lead says something new (usually a few seconds). With two briefs in line (the lead made two `sidekick` calls, so the second waits in `briefLine`), the line stays blank for all of the second brief, which can be minutes. None of the doing tests covers a brief's end.
- fix: give `sink()` an option such as `{ cardsOnly: true }`, or pass `agentId` through, and skip `doneDoing` in `end()` (and in `error`/`limited`) when the sink isn't the lead's (`agentId !== the turn's agentId`). Add a test: a pair turn whose brief ends while the lead's call still runs keeps "Working with its sidekick".
- effort: S
- risk of the fix: low. Test that a lead turn's own end still clears the line, and that a sidekick's card still pauses and resumes it.

### 2. The PR card's test run waits for the pipes to close, so a process the tests leave behind holds the card for 10 minutes and then marks it failed
- category: bug
- severity: medium
- confidence: likely (the mechanism is confirmed; it happens only when a test script leaves a child holding stdout/stderr)
- where: engine/src/runtime.ts:1397-1418
- evidence:
  ```ts
  const child = spawn(sh.cmd, sh.args, { cwd, env, detached: true, ..., stdio: ["ignore", "pipe", "pipe"] });
  ...
  const limit = setTimeout(() => ((out += "\nStopped after 10 minutes."), kill()), 600000);
  const code = await new Promise<number>((resolve) => {
    child.on("error", ...);
    child.on("close", (c) => resolve(c ?? 1));
  });
  ```
- what goes wrong: `close` fires only once every holder of the pipes has exited. Suppose a test script starts something in the background (a server for e2e tests, a watcher, a forked worker that outlives its parent). The suite can exit 0 after 30 s, but the card stays "running" until the 10-minute limit kills the group, and then reports "failed / Stopped after 10 minutes". If the leftover process called setsid, it isn't in the group, so `close` never comes. The run's promise then never settles, `prTests` keeps the entry for good, and `idleNow` (which checks `prTests.has`) never lets that session's tool close for idleness. exec.ts already has `closesOnExit` for exactly this case, and five other spawns use it (launch.ts:719, acp.ts:997, codex-server.ts:218, codex.ts:143).
- fix: call `closesOnExit(child)` after the spawn. Or resolve on `exit` with its code, then end the group with `killTree(child)` so nothing it left keeps running.
- effort: S
- risk of the fix: output printed after exit may be cut. `closesOnExit` waits 500 ms, which is enough. Test with a script like `sleep 60 & echo ok`.

### 3. Agent session search reads a thread's whole log once per hit, through titleForAgents
- category: perf
- severity: medium
- confidence: confirmed
- where: engine/src/memory.ts:110 (searchSessions), :32 (titleForAgents)
- evidence:
  ```ts
  for (const it of store.peek(t.id, ["user", "text"])) {
    ...
    hits.push({ threadId: t.id, title: o.person ? t.title : titleForAgents(store, t), ... });
  // titleForAgents
  const first = (typeof store.peek === "function" ? store.peek(t.id, ["user"]) : []).find(...)
  ```
- what goes wrong: an agent's `sessions_search` runs without `person`, so every matching item calls `titleForAgents`. That calls `store.peek(t.id, ["user"])`, which for a thread that isn't cached in memory reads and scans the whole `threads/<id>.jsonl` with `readFileSync`. A common word that matches 200 items in a 500 KB thread costs about 100 MB of synchronous reads in one call, and it blocks the engine (every stream and every session) for the whole time. For a thread that is cached, it is O(hits × items) instead.
- fix: work out the title once per thread, lazily, before the inner loop (`let title: string | undefined; ... title ??= titleForAgents(store, t)`).
- effort: S
- risk of the fix: none. The output is the same.

### 4. Stop depends entirely on each provider ending `session.turn()`: the runtime has no deadline of its own after abort
- category: bug
- severity: medium
- confidence: suspected (whether a provider can actually hang after abort is the provider auditors' question)
- where: engine/src/runtime.ts:1605-1617 (`await go(prompt)`), :2221-2229 (stop)
- evidence:
  ```ts
  const go = (p: string) => (o.wake ? o.wake.w.run(sink.api, abort.signal) : session.turn(p, sink.api, abort.signal, o.files));
  ...
  if (ran) await go(prompt);
  ```
  `quiet()` races its turn against an abort promise (`Promise.race([turn, gaveUp])`, :2016), but `runTurn` does not.
- what goes wrong: a provider whose turn promise doesn't settle after abort keeps `this.turns` and `busy` set, so the session shows "running" forever. Every later message only queues, and the watchdog's one "may be stuck" notice is the only thing that happens. After Stop, the doing line already clears (new today), so the session looks idle while it is actually locked.
- fix: in `runTurn`, after Stop, race `go()` against `abort` plus a grace period (say 15 s). When the grace runs out, `drop()` the live session (its close ends the tool and what it marked) and fall through to `finally`. That is the same "given up" path `quiet()` already has.
- effort: S
- risk of the fix: a provider that legitimately needs longer to wind down gets its session closed and reopened next turn, resuming. Test with a fake provider that ignores the signal.

### 5. Deleting a session runs one git process per snapshot ref, in sequence, while the thread is held
- category: perf
- severity: medium
- confidence: confirmed
- where: engine/src/checkpoints.ts:374-377, called from engine/src/api.ts:663 inside `runtime.exclusive`
- evidence:
  ```ts
  export async function forget(cwd: string, prefix: string) {
    const r = await git(cwd, ["for-each-ref", "--format=%(refname)", `refs/liner/${prefix}`]);
    for (const ref of r.stdout.split("\n").filter(Boolean)) await git(cwd, ["update-ref", "-d", ref]);
  }
  ```
- what goes wrong: each turn leaves 2 refs (`<turn>-before`, `-after`), each sidekick brief 2 more, and each Undo, Keep or fork more again. A 200-turn pair session holds about 600 refs, so deleting it runs 600 sequential `git update-ref -d` spawns, at roughly 5 to 10 ms each: 3 to 6 s of delete before the worktree and log are removed.
- fix: one spawn, `git update-ref --stdin` with input `delete <ref>\n` per ref. `run()` already takes `input`.
- effort: S
- risk of the fix: low. With `--stdin`, a bad line fails the whole batch, so keep the old loop as a fallback when the batch exits non-zero.

### 6. Each card's abort listeners stay on the turn's signal until the turn ends; past 10 in one turn, Node warns
- category: bug
- severity: low
- confidence: likely (the listeners are confirmed; the warning text is Node's usual EventTarget leak warning)
- where: engine/src/runtime.ts:3287-3305 (sink `wait`), :1127 (askLiner), :1172 (askQuestions)
- evidence:
  ```ts
  pending.add(id);
  sig.addEventListener("abort", gone, { once: true });
  signal.addEventListener("abort", gone, { once: true });
  ```
  An answer resolves through the map (`answer()` → `waiter.resolve`) and never removes `gone`.
- what goes wrong: at Manual, every command asks. A long turn with 30 cards puts 30 `gone` closures (each holding its item id and the sink's closure) on the turn's AbortSignal, and Node prints `MaxListenersExceededWarning: Possible EventTarget memory leak detected. 11 abort listeners added to [AbortSignal]` to the engine's stderr. The memory is freed when the turn ends.
- fix: in `wait`, wrap resolve and reject so they remove both listeners (`signal.removeEventListener("abort", gone)`) before settling. Do the same in askLiner and askQuestions.
- effort: S
- risk of the fix: low.

### 7. The event stream sends one write per token per client, with no coalescing and no back-pressure
- category: perf
- severity: low
- confidence: likely
- where: engine/src/server.ts:39-46, engine/src/store.ts:542-547 (appendText emits a `delta` per chunk)
- evidence:
  ```ts
  store.on((e: EngineEvent) => {
    const line = `${JSON.stringify({ ...e, seq: store.seq })}\n`;
    for (const res of clients) { ... else res.write(line); }
  });
  ```
- what goes wrong: every streamed text chunk becomes its own `delta` event and one `res.write` (a syscall) per connected client. Twenty sessions streaming at about 50 chunks/s is about 1,000 writes/s, and as many separate messages for the app to parse and render. `res.write`'s return value is ignored, so a client that stops reading (a frozen renderer, a backgrounded preview tab) has everything buffered in the engine's memory with no limit. The bigger events are bounded (tool output is capped at 20 kB, and Codex's running output is throttled to 250 ms), so this is about how often events go, not how large they are.
- fix: in server.ts, batch the lines per client and flush on `setImmediate` or every 16 ms (one `write` of joined lines). Optionally merge consecutive `delta`s for the same item into one. If `res.writableLength` passes a few MB, drop that client; the app reconnects and gets a fresh snapshot.
- effort: S (batching) / M (delta merging)
- risk of the fix: the app must accept merged deltas (they are only longer text). Keep `seq` correct per line.

### 8. state.json is rewritten whole, plus a .bak copy and two fsyncs, at most every 120 ms while anything changes
- category: perf
- severity: low
- confidence: confirmed (cost estimated)
- where: engine/src/store.ts:573-581, :38-59
- evidence:
  ```ts
  private save() { if (this.saveTimer) return; this.saveTimer = setTimeout(() => this.flush(), 120); }
  flush() { ...; writeAtomic(join(this.home, "state.json"), JSON.stringify(this.state, null, 2), { backup: true }); }
  ```
- what goes wrong: every `patchThread` (usage on each assistant message, status, eta, unread, queue) schedules a full save: stringify all projects and threads pretty-printed, `copyFileSync` the old file to `.bak`, write, fsync the file, fsync the folder, all synchronous on the engine's one thread. Today it is 55 KB for 62 threads (about 0.9 KB a thread). At 500 threads that is about 450 KB written about 8 times a second while sessions run, plus a 450 KB copy each time, with the event loop blocked for each.
- fix: copy the `.bak` at most once a minute, or rotate by rename (`file` → `.bak`, then `tmp` → `file`) instead of copying. Drop the `null, 2` indentation (it makes the file about 40% larger). Optionally raise the debounce to about 500 ms while a turn runs.
- effort: S
- risk of the fix: a `.bak` up to a minute older after a corrupt write. That is acceptable for its purpose.

### 9. Every timeline the engine reads stays in memory for the life of the process
- category: perf
- severity: low
- confidence: confirmed
- where: engine/src/store.ts:461-502 (`this.items.set(threadId, list)`), :392-396 (only removeThread deletes)
- evidence: `private items = new Map<string, Item[]>();`. `timeline()` caches each list, and nothing evicts it except deletion.
- what goes wrong: opening a session in the app, a Wall tile, `continueAfterRestart`, `editsOf`'s `beside` (it calls `store.timeline(x.id)` on every other session in the same folder), and `factsOf` and the other readers all load whole timelines and keep them. Over a long-running engine, every session ever opened stays resident: the largest logs are 400 to 550 KB on disk today, and parsed objects take several times that.
- fix: a small LRU (say 30 timelines) that never evicts a thread with a turn, a busy hold, or a streaming item. `peek` already covers readers that need only some kinds of item.
- effort: M
- risk of the fix: code that holds a list reference across awaits (`putItem` mutates the cached list). Evict only threads that are idle, and only from a timer, never in the middle of a call.

### 10. Small in-memory sets and maps that only grow, and keys that outlive their thread
- category: bug (leak)
- severity: low
- confidence: confirmed
- where: engine/src/runtime.ts:297 `drained`, :299 `reopened`, :266 `queuedDesign`, :1190 `linerWrites`, :272 `leftQueue`; engine/src/agent-tools.ts:253 `keys`, :318 `forget`
- evidence: `for (const q of going) this.drained.add(q.id);` is never deleted. `this.reopened.add(key)` is never deleted. `setQueue` never deletes from `queuedDesign`, although the comment at :261 says "a command or a removed message drops it". `closeThread` (:2901-2920) clears `grants`, `turnGrants` and `toldOnce`, but not `linerWrites`, `leftQueue`, `queuedDesign`, `wakes` or `finished`. `AgentTools.forget` runs only for warm threads that never came to be (runtime.ts:846, :915), so a deleted session's MCP key stays mapped to its id.
- what goes wrong: memory grows slowly with use (one id per queued message that went, one key per limit reset, the hashes from Security writes). It is tiny per entry, but unbounded. A deleted session's surface key still resolves to its thread id, so a late call reaches handlers that then throw on `store.thread`.
- fix: in `closeThread` (or in a new `forgetThread` called from api.ts letGo and dropSide), delete the thread's entries from `linerWrites`, `leftQueue`, `wakes`, `finished`, and from `queuedDesign` for its queue ids, and call `this.tools?.forget(threadId)`. In `setQueue`, delete `queuedDesign` entries for ids that left the queue (they come back with the put-back from `leftQueue`, if that's wanted). Prune `drained` ids once they're older than an hour.
- effort: S
- risk of the fix: low. `forget` on archive must not run (an archived session may come back); call it on delete only.

### 11. A delete that stops waiting after 10 s can bring the deleted session's log file back
- category: bug
- severity: low
- confidence: likely (needs a turn that takes over 10 s to wind down after Stop)
- where: engine/src/api.ts:656-659 (`await runtime.idle(id, 10_000, 1)`), engine/src/runtime.ts:1627-1629 (`sink.end()` in finally, before the "deleted meanwhile" guard at :1653), engine/src/store.ts:525-532
- evidence: `idle()` returns after `ms` whether or not the turn has ended. `sink.end()` then calls `store.putItem` for each tool row still running, and `putItem` calls `this.timeline(threadId)` (which caches a new empty list for the removed id) and `appendFileSync(this.logFile(threadId), ...)`, which creates `threads/<id>.jsonl` again.
- what goes wrong: an orphan log file and an `items` entry for a session that no longer exists. They are never cleaned up, because nothing lists them.
- fix: make `putItem` (and `appendText`) do nothing when the thread isn't in `state.threads`, or check in `sink.end()` first.
- effort: S
- risk of the fix: a putItem for a thread that hasn't been put yet. Check that no code path puts items before `putThread` (thread.create, forks copying timelines).

### 12. Awake re-checks on every engine event, each token included, and never unsubscribes
- category: perf
- severity: low
- confidence: confirmed
- where: engine/src/awake.ts:21-24, engine/src/main.ts:186
- evidence: `start() { this.store.on(() => this.check()); ... }` with `busy = () => routines.busy || store.threads.some((t) => t.status === "running")`. `stop()` only kills the child.
- what goes wrong: an O(threads) scan per delta event, across every streaming session. It is cheap per call, but it is pure overhead on the hottest path. After `quit()` calls `awake.stop()`, the turns that wind down still emit `thread` events, so `check()` can spawn caffeinate again during shutdown. That is harmless (`-w pid` ends it with the engine), but untidy.
- fix: `this.store.on((e) => e.type === "thread" || e.type === "settings" ? this.check() : undefined)`. Keep the unsubscribe that `on()` returns and call it in `stop()`.
- effort: S
- risk of the fix: a routine run's busy flag changes without a thread event. Check that a routine run still emits a thread event when it starts (it does, through patchThread on its run thread).

### 13. Linear scans of the whole timeline on every text delta and tool update
- category: perf
- severity: low
- confidence: confirmed
- where: engine/src/store.ts:543 (appendText `find`), :527 (putItem `findIndex`), engine/src/runtime.ts:3250 (settle), :3278, :3337 (tool `find`), :3594 (notice)
- evidence: `const it = this.timeline(threadId).find((x) => x.id === itemId);` runs per streamed chunk. The streaming item is always near the end, so the scan walks the whole list first.
- what goes wrong: O(items) per token. The largest thread today has about 1,300 items, which is negligible alone, but it scales with thread length × sessions streaming at once.
- fix: use `findLast` (or a loop from the end) in `appendText` and `putItem`. Optionally keep a `Map<id, index>` beside each cached list.
- effort: S
- risk of the fix: none for `findLast`.

### 14. contracts/doing.ts copies Timeline.tsx's step helpers instead of sharing them (new today)
- category: refactor
- severity: low
- confidence: confirmed
- where: contracts/src/doing.ts:18, :26, :82-95, :319-323, :336; ui/src/app/Timeline.tsx:80-91, :649-663, :708-713
- evidence: `readable` (doing.ts:319) is character for character the same as `readableFrame` (Timeline.tsx:708). `commandOf` is the same except for how it joins an array. `NOT_STEPS` hard-codes `CARD_TOOLS ∪ DESIGN_TOOLS ∪ "liner.test"` (the literal value of `PR_TEST_TOOL`) and `isStep` repeats Timeline's `isStep`. The doc comments say "as Timeline.tsx's ...".
- what goes wrong: the sidebar's doing line and the session's trail are meant to use the same verbs and the same idea of a step. A tool added to CARD_TOOLS in Timeline.tsx, or a change to `readableFrame`, now silently disagrees with the engine's line.
- fix: export `readableFrame`, `NOT_STEPS` (built from `PR_TEST_TOOL`) and a shared `isStepCall` from contracts/doing.ts, and import them in Timeline.tsx. Keep doing.ts's safer array quoting in its own commandOf, or share that too.
- effort: S
- risk of the fix: Timeline.tsx is being edited in another session. Do it after that work lands.

### 15. Three copies of the "settle a wait, put the session back out of Needs you" logic, and the same predicate written ten times
- category: refactor
- severity: low
- confidence: confirmed
- where: engine/src/runtime.ts:1137, :1179, :1384 (status restore); the "anything asking" predicate at :436, :1007, :1137, :1179, :1383, :1691, :1898, :2687, :2841, :2866; `t.worktree?.path ?? store.project(t.projectId).path` 13 times
- evidence:
  ```ts
  if (now?.status === "waiting" && !this.isRunning(threadId) && !store.timeline(threadId).some((x) => (x.kind === "approval" || x.kind === "question" || x.kind === "proposal") && x.state === "asking")) store.patchThread(threadId, { status: was === "waiting" || was === "running" ? "done" : was });
  ```
- what goes wrong: some copies bound the predicate by `x.turn > sideFrom` (:436, :1691, :2866) and some don't (:1007, :1137, :1179, :2687, :2841). A side chat that copied a parent's open card can therefore read as "still asking" in the unbounded places. Whether that is intended per site isn't stated, and the copies make it hard to see.
- fix: add `private asking(threadId, o?: { from?: number; turn?: number })`, `private cwdOf(t)`, and `private backFromWaiting(threadId, was)`. Use them at each site, choosing the `sideFrom` bound on purpose at each.
- effort: S
- risk of the fix: low if it is done mechanically. Run engine.test.ts and doing.test.ts.

### 16. Three hand-copied usage accumulators (the lead's sink, a brief, a quiet read)
- category: refactor
- severity: low
- confidence: confirmed
- where: engine/src/runtime.ts:1987-1999 (quiet), :2518-2536 (runBrief), :3548-3571 (sink)
- evidence: each one builds `cur = { ...emptyUsage(), ...t.usage }`, loops the four keys, subtracts running totals (by `this.totals` in two, by a local `own` in quiet), patches the thread, then calls `holdToCap`.
- what goes wrong: the rule for running totals is written three ways. quiet's version subtracts `own[k]` without `Math.max(0, …)`, so a tool whose total went down (a reset) would subtract from the thread's usage. The other two clamp at zero.
- fix: one `addUsage(threadId, u, total, seen, spent)` helper that returns the new seen totals, used by all three.
- effort: S
- risk of the fix: low.

### 17. Two different exported `commandWords` functions with different meanings (new today)
- category: dead / refactor
- severity: low
- confidence: confirmed
- where: contracts/src/doing.ts:241 (exported, and re-exported through contracts/src/index.ts:1964 `export * from "./doing.ts"`), engine/src/providers/acp.ts:2009 (its own exported `commandWords`, which returns a word list for read checks; tested in engine/test/providers.test.ts)
- what goes wrong: anyone importing `commandWords` from contracts gets the display one, and anyone importing it from acp.ts gets the security one. A wrong auto-import in risk-sensitive code would type-check, since both take a string.
- fix: rename the doing.ts one to `commandShown` (or `doingCommand`).
- effort: S
- risk of the fix: none (only doing.ts and doing.test.ts use it).

### 18. `toolRisk` in risk.ts is dead
- category: dead
- severity: low
- confidence: confirmed
- where: engine/src/risk.ts:1562-1567
- evidence: `git grep -nw toolRisk -- engine ui/src desktop contracts scripts` finds only its definition. It has been there since the first commit (e641536), and its body returns "low" on every branch but exec.
- fix: delete it.
- effort: S
- risk of the fix: none.

### 19. launch.ts writes servers-asleep.json non-atomically, and a torn file forgets which servers to reap
- category: bug
- severity: low
- confidence: confirmed (how it fails); rare
- where: engine/src/launch.ts:796-805, :781-795
- evidence: `writeFileSync(this.host.file, JSON.stringify({ asleep, trust, running }))`. On a parse error, `load()` returns `{ asleep: [], trusted: [], running: [] }`.
- what goes wrong: a crash or power cut mid-write leaves a torn file. The next start then forgets the `running` list, so `reap()` can't end the dev servers the dead engine left up, and they hold their ports. It also forgets every launch entry you trusted.
- fix: use store.ts's `writeAtomic` (it is already exported).
- effort: S
- risk of the fix: `save()` runs often (every spawn and end), and `writeAtomic` adds two fsyncs. That is acceptable at this rate.

### 20. Snapshots list the whole index, and refs/liner grows as loose refs for good
- category: perf
- severity: low
- confidence: suspected (cost scales with repository size; not measured)
- where: engine/src/checkpoints.ts:102-103 (`ls-files -v` on every capture), :152 (`update-ref` per capture)
- evidence: `const tags = await git(cwd, [...SCRATCH, "ls-files", "-v"], env); if (tags.code === 0 && !/^(?:[a-z]|S) /m.test(tags.stdout)) return;`
- what goes wrong: twice per turn (and twice per brief), the whole index is printed into a JS string only to look for a lowercase or `S` tag: on a 100k-file monorepo, several MB per capture. Separately, each capture adds a loose ref file under `.git/refs/liner/<thread>/`. Nothing packs them, so thousands accumulate per long session and slow every git command that walks refs (`for-each-ref` in edits.ts:83 runs on every message).
- fix: for the tags, `git ls-files -v -z | ` is not available without a shell; instead check `git config core.sparseCheckout` and run `git ls-files -t`, or stream and stop at the first match with `run`'s `onOutput`. For refs, run `git pack-refs` occasionally (for example when a thread is archived), or write refs with `update-ref --stdin` in batches.
- effort: M
- risk of the fix: the skip-worktree detection must stay exact. Keep the current check as the fallback.

### 21. usage.jsonl is read whole for each ETA refresh and grows forever
- category: perf
- severity: low
- confidence: confirmed
- where: engine/src/runtime.ts:2112-2117, engine/src/store.ts:375-389
- evidence: `recent = { at: Date.now(), ms: this.store.usage(from).flatMap(...) }`, refreshed per model every 10 minutes at turn start. `usage()` does `readFileSync` on the whole file and parses every line.
- what goes wrong: each turn, review, brief, prompt check and app call adds a line, and nothing trims the file. It has 150 lines today; after a year of heavy use it could hold tens of thousands of lines and several MB, parsed synchronously at a turn's start (on the path between Send and the prompt going out).
- fix: cache per model incrementally (remember the file offset read so far and parse only what was appended), or trim lines older than the Usage page's longest range at startup.
- effort: S
- risk of the fix: the Usage page reads the same file. Keep its range.

### 22. The doing line reads a design file from disk on running canvas steps (new today)
- category: perf
- severity: low
- confidence: confirmed
- where: engine/src/runtime.ts:3239-3246 (frameName → `lookFile`), contracts/src/doing.ts:298, :358
- evidence: `return lookFile(t.worktree?.path ?? store.project(t.projectId).path, design).frames.find((f) => f.id === frame)?.name;`. `lookFile` stats the folder, reads design.json, lstats every drawn frame and reads `frames/` (canvas.ts:424-454).
- what goes wrong: it runs synchronously on each tool update of a canvas step or a frame-file edit while the step runs and is the latest. A canvas with 40 frames costs about 45 fs calls per update. That's small today (2 to 3 updates per step), but it is disk I/O inside the stream handler.
- fix: memoise per `(design)` for the turn (in the sink's closure), and clear it when a `design_frame` step ends.
- effort: S
- risk of the fix: a frame renamed mid-turn shows its old name for the rest of the turn. Acceptable.

## In good shape (checked)
- Live session lifecycle: `unwarmed` clears warm and idle timers on every way a session goes. `once()` serialises openings by key. `ending()` chains closes per thread, and the next opening waits for it. The idle close checks again after the tool's `settled()` answer.
- Waiters: approvals, questions and proposals each have exactly one expiry path (abort, turn end through `pending`, or answer). `answerQuestion` ignores double answers. `askLiner` and `askQuestions` expire on abort.
- `hold`/`drain`/`halted`/`kept`/`released`: Stop, then send, then wind down, behaves as documented. The disk-full path in `turnNow` and `sink.end` can't leave a turn registered.
- Shutdown: the watchdog interval is cleared, each turn is stopped, PR tests are aborted, live and ahead sessions are closed, and closes still under way are awaited. Server heartbeats are cleared on close.
- Startup: the server answers before the tools are detected when `models.json` is seeded (`state.get` waits for `ready` only when it isn't). The Store constructor reads only state.json and the timelines of threads that were running or waiting.
- Tool output on the stream is bounded (20 kB, and Codex throttles it to 250 ms).
- The new doing code: throttling, the pause and resume around cards, clearing on stop, error, limit and end, the guard against status, and the reset on load are all correct, except finding 1. `commandWords` in doing.ts reads quotes, `$(`, heredocs and wrappers conservatively. I found no way to make it say a secret.
- `watch.ts`, `worktrees.ts`, `paths.ts`, `mcp.ts`: no issues.

## Not covered
- risk.ts (1701 lines): checked only for dead exports, not read for correctness.
- launch.ts lines 1-370 (parsing launch.json, port helpers), sidekick.ts, review.ts, prflow.ts, files.ts and liner-tools.ts: skimmed only.
- agent-tools.ts past `call()` (panel checks, browser ops, shot): not read.
- Whether each provider really ends `session.turn()` after abort (finding 4) belongs to the providers' auditor.
- Routines: skipped as instructed. engine/src/routines.ts is 557 lines, plus the `unattended` paths in runtime.ts.
