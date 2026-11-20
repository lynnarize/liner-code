# 031. Search and import read their files off the engine's loop

**Commit message:** `Searching sessions and bringing one in no longer hold up every other session while they read`

**Priority:** P2 · **Effort:** M · **Depends on:** none (touches `memory.ts`, `imports.ts` and two call sites).

Written by the advisor on 2026-11-20 at 13c7757 after the review of the audit. Finding: CORE-08 (HIGH confidence). The
audit had queued it as low-urgency; the review found it under-rated (below).

## Why this matters

The engine is one Node process: while it reads and parses files synchronously, every session's stream, every approval
card and every timer waits. Three paths still read without yielding:

1. **Search.** `searchSessions` (`engine/src/memory.ts:99-124`) loops over every thread of a project and calls
   `store.peek(t.id, ["user", "text"])`. For a timeline not in memory, `peek` (`engine/src/store.ts:544-561`) reads the
   whole log with `readFileSync` and JSON-parses each matching line. The app's sidebar find calls it for **every
   project**, 220 ms after each pause in typing (`ui/src/app/App.tsx:693-694`: `projects.map((p) => rpc("sessions.search", …))`),
   and an agent's `sessions_search` tool calls it too (`engine/src/agent-tools.ts:503`). So each pause in typing reads
   every saved session log of every project on the engine's loop.
2. **Importing a Codex session.** `transcript` (`engine/src/imports.ts:320-350`) finds the rollout by walking Codex's whole
   sessions tree with the synchronous `rollouts` (:142-158), then reads the file whole with `readFileSync` (:350). The
   file's own comment (:160-163) says why `recentSessions` already uses the async `newestRollouts`: Codex keeps every
   rollout ever, thousands after months.
3. **The import list.** `importable` (`imports.ts:264-267`, the `sessions.importable` RPC at `api.ts:870`) walks the
   same tree synchronously through `codexSessions` (:237-241: `newest(rollouts(sessions, ROLLOUT))`).

Nothing is lost, but the stall grows with history, and it lands while the person is typing in the find field.

## Current state (drift check)

```bash
git log --oneline -1                               # 13c7757 or later
sed -n '20,35p;94,125p' engine/src/memory.ts       # titleForAgents (peeks too) and searchSessions
sed -n '540,562p' engine/src/store.ts              # peek: cached, else readFileSync of the whole log
sed -n '96,115p;137,200p' engine/src/imports.ts    # newest(), rollouts() (sync) and newestRollouts() (async)
sed -n '234,267p;320,352p' engine/src/imports.ts   # codexSessions, importable, transcript
sed -n '1235p;870p;872,876p' engine/src/api.ts     # sessions.search, sessions.importable, sessions.import
sed -n '501,505p' engine/src/agent-tools.ts        # the agent's sessions_search (inside the async answer())
grep -rn "searchSessions(\|transcript(\|importable(" engine/test   # the tests that call them synchronously today
```

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first. Tests are `node:test`, names full sentences. Test
  commands need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push. Nothing the app sees changes: same results, same order, same errors.

## Steps

### 1. Search reads logs with awaited reads (memory.ts, store.ts)

**Test first** (add to `engine/test/memory.test.ts`): "search: reading sessions that aren't open lets the engine's
other work run meanwhile".
- Three threads in project `p`, each with one user message holding "reset button"; `store.flush()`; a fresh
  `new Store(home)` (so the timelines are read from their logs, as the existing search test does at :45).
- `let ran = false; setImmediate(() => (ran = true));` then `const hits = await searchSessions(fresh, "p", "reset button");`
- Assert `hits.length === 3` and `ran === true`.
- **Seen failing at 13c7757** (a scratch copy importing the engine at HEAD): the hits are right, but `ran` is false: the
  search finished before the loop turned once. (`await` on the array it returns resolves in a microtask, before any
  `setImmediate`.) After the fix the awaited file reads let the loop turn.

**Fix:**
- `Store` gains `async peekLater(threadId, kinds)`: the same as `peek` (the cached timeline at once if there is one, `[]`
  when the log isn't there, a torn last line skipped), but reading the log with `readFile` from `node:fs/promises`. Keep
  `peek` as it is; it has other callers.
- `searchSessions` becomes `async` and returns `Promise<SessionHit[]>`; it awaits `store.peekLater(...)` per thread
  (one thread at a time is enough: each await yields). Keep the scoring, snippet and ordering exactly as they are.
- `titleForAgents` (memory.ts:26) peeks the thread's first user message again. In search, pass the first user item
  already read to it through an optional third parameter, so a hit costs no second read; keep its own `peek` for other
  callers, and keep the `typeof store.peek === "function"` check (stand-in stores).
- Callers: `api.ts:1235` returns the promise as it is; `agent-tools.ts:503` adds `await` (it is inside the async
  `answer`). Tests that call it: `memory.test.ts:46,50`, `polish-core.test.ts:249`, `shown.test.ts:173`: add `await`
  (and `async` to the test function where it isn't).

**Verify:** `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/memory.test.ts engine/test/polish-core.test.ts engine/test/shown.test.ts`
passes; `npm run typecheck -w engine` exits 0.

### 2. Import finds and reads a Codex rollout off the loop (imports.ts)

**Test first** (add to `engine/test/engine.test.ts` next to the import test at :747-797, or a new
`engine/test/imports-async.test.ts`): "import: finding a Codex session and listing them let the engine's other work run".
- A temp `CODEX_HOME` with `sessions/2026/10/02/rollout-2026-10-02-c1.jsonl` holding one `session_meta` line
  (`{ id: "c1", cwd: <the temp folder> }`).
- `let ran = false; setImmediate(() => (ran = true)); await transcript("codex", "c1", home, { CODEX_HOME: home });`
  assert `ran`; then the same around `await importable(home, { CODEX_HOME: home, CLAUDE_CONFIG_DIR: join(home, "c") }, new Set())`.
- **Seen failing at 13c7757** on the first assertion (`transcript`): it returns before the loop turns.

**Fix:**
- Split `newestRollouts` (:164-200) in two: `async function rolloutFiles(sessions, match): Promise<string[]>` (its
  breadth-first `readdir` walk as it is, links never followed) and `newestRollouts`, which calls it and then dates,
  sorts and cuts to LATEST as now. `recentSessions` is unchanged.
- `transcript` becomes `async`: for Codex, `(await rolloutFiles(sessions, (n) => n.endsWith(".jsonl") && n.includes(id)))[0]`
  (the whole tree: an older session is still found, which `newestRollouts`' LATEST cut would miss); the plain-file
  check with `stat` from `node:fs/promises`; the file read with `readFile`. The parsing below is unchanged.
- `importable` becomes `async`; `codexSessions` uses `await newestRollouts(sessions, ROLLOUT)` in place of
  `newest(rollouts(sessions, ROLLOUT))` (the same newest LATEST files, the same `codexOf`). `claudeSessions` stays
  synchronous (one folder of one project; leave it, and say so in the note).
- The synchronous `rollouts` then has no callers: delete it. `newest` is still used by `claudeSessions`; keep it.
- Callers: `api.ts:870` (`sessions.importable`) returns the promise; `api.ts:876` (`sessions.import`, already async)
  adds `await`. Tests: `engine.test.ts:788,790,792,796`, `polish-round2-c.test.ts:42`, `audit-api.test.ts:275`: add `await`.

**Verify:** `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/engine.test.ts engine/test/polish-round2-c.test.ts engine/test/audit-api.test.ts`
passes; `npm run typecheck -w engine` exits 0 (it catches a caller left without `await`: a Promise has no `.items`).

## Done

- Both new tests fail before and pass after; every test that called these functions passes with `await`; `npm run typecheck`
  exits 0; `npm run test:steady -w engine` is not required for this change, but `npm test -w engine` should be green
  apart from the known flaky tests.
- One commit, the message above. Executor note in `plans/README.md`: the commit, and that `claudeSessions` stays
  synchronous on purpose.

## STOP conditions

- A caller of `searchSessions`, `transcript` or `importable` outside the ones listed turns up (grep `engine/src`, `desktop/src`,
  `ui/src/app`): add `await` where it is already async; if one is synchronous and can't become async, stop and report it.
- Results differ after the change (order, titles, snippets) in any existing test: stop; the change must be the reading only.

## Maintenance note

A request the app makes as you type must not read files synchronously on the engine's loop. Use `peekLater` and the
async walks (`rolloutFiles`, `newestRollouts`). `peek` stays for small, rare reads.
