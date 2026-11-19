# Plan 014: Two quick Fix presses make one session, an outside tool's wait can be cancelled, and an export finds its folder

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6970155..HEAD -- engine/src/security-scan.ts engine/src/outside.ts engine/src/export.ts`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `6970155`, 2026-11-19

## Why this matters

Three unrelated small engine bugs:

1. **Liner Security's Fix can start twice.** `fixFinding` checks whether a fix already exists, then awaits three slow calls, and only then records the new fix. A double click, or two windows, start two sessions and two worktrees for one finding; one of them is never linked to the finding.
2. **An outside tool cannot cancel a wait.** Liner Code gives agents outside the app a small MCP server (`engine/src/outside.ts`). Its `liner_wait` tool can hold a call for up to four minutes. The two sibling servers (`mcp.ts`, `dsh-mcp.ts`) handle the caller's cancel and send progress notes so the caller does not give up early; this one does neither.
3. **Export fails without a Downloads folder.** Saving a session as Markdown writes to `~/Downloads` and throws if that folder does not exist.

## Current state

- `engine/src/security-scan.ts:629-650` (shortened):

  ```ts
  export async function fixFinding(sec: Security, p: { id: string; agent?: string; model?: string; effort?: Effort }): Promise<Thread> {
    wake(sec);
    const f = sec.finding(p.id);
    if (f.state !== "open") throw new Error(…);
    const had = f.fix && (f.fix.state === "working" || f.fix.state === "ready") ? sec.store.threads.find((t) => t.id === f.fix!.threadId && !t.archived) : undefined;
    if (had) return had;
    …
    if ((await git(project.path, ["rev-parse", "--show-toplevel"], sec.env)).code !== 0) throw new Error(…);
    if ((await git(project.path, ["rev-parse", "--verify", "-q", "HEAD"], sec.env)).code !== 0) throw new Error(…);
    …
    const t = await sec.host.call("thread.create", { … });
    const at = Date.now();
    sec.update(f.id, (x) => ({ ...x, fix: { threadId: t.id, state: "working", at }, … }));
    await sec.host.call("thread.send", { … });
    return sec.store.thread(t.id);
  }
  ```
  A test that drives it: `engine/test/security-scan.test.ts:316` ("scan: a fix is a session in a worktree with the finding as its brief…").
- `engine/src/outside.ts:39-51` and `:53-75`:

  ```ts
  async function call(name: string, args: unknown) {
    const w = where();
    if (!w) return failed("Liner Code isn't running, or Settings › Safety › Agents outside Liner Code is off.");
    try {
      const r = await fetch(w.url, { method: "POST", headers: { "content-type": "application/json", "x-liner-outside": w.key }, body: JSON.stringify({ tool: name, args: args ?? {} }) });
      if (r.status === 401) return failed("Liner Code turned this key down. …");
      const b = (await r.json()) as { ok: boolean; result?: unknown; error?: string };
      return b.ok ? b.result : failed(b.error ?? "Liner Code didn't answer.");
    } catch {
      return failed("Liner Code isn't running.");
    }
  }

  createInterface({ input: process.stdin }).on("line", (line) => {
    let m: Msg;
    try { m = JSON.parse(line) as Msg; } catch { return; }
    // Valid JSON needn't be a message: null, say.
    if (m?.id === undefined) return;
    …
    else if (m.method === "tools/call") void call(String(m.params?.name ?? ""), m.params?.arguments).then((result) => send({ id: m.id, result }));
  ```
- The pattern to copy, `engine/src/mcp.ts:16-45` and `:54-58, 73-77`:

  ```ts
  /** The calls at work, by their request's id: one its tool cancels (it gave up on it) is let go … */
  const calls = new Map<string | number, AbortController>();
  /** What a call its tool cancelled comes to: no answer at all, as MCP has it (the tool has stopped waiting for one). */
  const CANCELLED = Symbol("cancelled");

  async function call(id: string | number, name: string, args: unknown, progress?: string | number) {
    let n = 0;
    const ac = new AbortController();
    calls.set(id, ac);
    const message = …;
    const beat = progress === undefined ? undefined : setInterval(() => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: progress, progress: ++n, message } })}\n`), 20_000);
    try {
      const r = await fetch(url, { …, signal: ac.signal });
      …
      if (ac.signal.aborted) return CANCELLED;
      return …;
    } catch {
      return ac.signal.aborted ? CANCELLED : { … isError: true };
    } finally {
      clearInterval(beat);
      // A later call may have taken its id by now: that one stays.
      if (calls.get(id) === ac) calls.delete(id);
    }
  }
  …
  if (m?.method === "notifications/cancelled") {
    const of = m.params?.requestId;
    if (typeof of === "string" || typeof of === "number") calls.get(of)?.abort();
    return;
  }
  …
  else if (m.method === "tools/call") {
    const token = (m.params?._meta as { progressToken?: string | number } | undefined)?.progressToken;
    const id = m.id;
    void call(id, String(m.params?.name ?? ""), m.params?.arguments, token).then((result) => result === CANCELLED || send({ id, result }));
  }
  ```
  `engine/test/outside.test.ts` already starts `outside.ts` as a child process against a test engine (see how it spawns it and writes `outside.json`).
- `engine/src/export.ts:112-119`:

  ```ts
  export function saveToDownloads(title: string, markdown: string) {
    const base = title.replace(/[\\/:*?"<>|\n]+/g, "-").trim().slice(0, 80) || "Liner Code session";
    const dir = join(homedir(), "Downloads");
    let path = join(dir, `${base}.md`);
    for (let n = 2; existsSync(path); n++) path = join(dir, `${base} ${n}.md`);
    writeFileSync(path, markdown);
    return path;
  }
  ```

Conventions: TypeScript run directly by Node 24. Long hand-formatted lines; never run a formatter. Comments are plain sentences that say why. Every fix comes with a test that fails without it. `outside.ts` and `mcp.ts` run as their own small processes and must import nothing heavy from the engine.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck -w engine` | exit 0 |
| Security tests | `node --test engine/test/security-scan.test.ts` | all pass |
| Outside tests | `node --test engine/test/outside.test.ts` | all pass |
| Export tests | `node --test engine/test/shown.test.ts engine/test/engine.test.ts` | all pass |

## Scope

**In scope**:
- `engine/src/security-scan.ts` (`fixFinding` only)
- `engine/src/outside.ts`
- `engine/src/export.ts` (`saveToDownloads` only)
- `engine/test/security-holes.test.ts`, `engine/test/outside.test.ts`, and one new file `engine/test/export-save.test.ts`

**Out of scope**:
- `engine/src/mcp.ts` and `engine/src/dsh-mcp.ts`: do not merge the three servers into one helper in this plan.
- `engine/src/outside-tools.ts` (the engine side of the outside tools).

## Git workflow

- Stay on `design-and-api-endpoints`. One commit for this plan, a plain sentence (example from `git log`: `A Reviewer block reads as one, without a question's amber`). Do not push.

## Steps

### Step 1: One fix per finding at a time

1. `engine/test/security-holes.test.ts` already calls `await fixFinding(sec, { id: f.id });` directly (near lines 355 and 369). Next to that test and using its setup, add a test that calls `fixFinding(sec, { id })` twice without awaiting the first (`const [a, b] = await Promise.all([fixFinding(sec, { id }), fixFinding(sec, { id })]);`) and asserts `a.id === b.id` and that only one session with `security?.kind === "fix"` exists in the store. Name: `"scan: Fix pressed twice at once starts one session, not two"`.
2. **Verify**: `node --test engine/test/security-holes.test.ts` → the new test FAILS (two sessions).
3. In `engine/src/security-scan.ts`, rename the existing function to `async function startFix(…)` (not exported, same body and doc comment), and add above it:

   ```ts
   /** Fixes being started, by finding: a second ask while the first is still making its session and worktree (a double press, another window) joins it. */
   const fixing = new WeakMap<Security, Map<string, Promise<Thread>>>();

   /** Starts a fix: a session in a worktree of its own (Thread.security { kind: "fix", finding }) with the finding as its brief. One at a time per finding. */
   export function fixFinding(sec: Security, p: { id: string; agent?: string; model?: string; effort?: Effort }): Promise<Thread> {
     let mine = fixing.get(sec);
     if (!mine) fixing.set(sec, (mine = new Map()));
     const going = mine.get(p.id);
     if (going) return going;
     const started = startFix(sec, p).finally(() => mine.delete(p.id));
     mine.set(p.id, started);
     return started;
   }
   ```
   Move the original doc comment's first sentence to `fixFinding` as shown and give `startFix` the comment `/** fixFinding's work, once per finding at a time. */`.
4. **Verify**: `node --test engine/test/security-holes.test.ts engine/test/security-scan.test.ts` → all pass.

### Step 2: The outside server hears a cancel and says it is waiting

1. In `engine/test/outside.test.ts`, add a test built like the file's existing one that spawns `outside.ts`: point it at a small local HTTP server (through the `outside.json` the file already writes) that never answers `/outside`, send a `tools/call` for `liner_wait` with `id: 7`, then send `{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":7}}`. Assert the HTTP server sees that request's connection close within two seconds, and that the child writes no line with `"id":7`. Name: `"outside: a call its tool cancels is let go, and no answer is sent for it"`.
2. **Verify**: the new test FAILS (the request stays open).
3. In `engine/src/outside.ts`, change `call` and the `tools/call` and message handling to the shape of `mcp.ts` shown in "Current state": the `calls` map, the `CANCELLED` symbol, `call(id, name, args, progress)` with an `AbortController` whose signal goes to `fetch`, the progress beat every 20 seconds with the message `"Waiting for the session"`, the `finally` that clears the beat and the map entry, the `notifications/cancelled` branch placed before the `if (m?.id === undefined) return;` line, and the `tools/call` branch that reads `_meta.progressToken` and skips `send` for a cancelled call. Keep this file's own error texts and its `where()` lookup. Copy the comments that explain why, adapted to "an outside tool".
4. **Verify**: `node --test engine/test/outside.test.ts` → all pass.

### Step 3: Export makes its folder

1. Create `engine/test/export-save.test.ts`:

   ```ts
   /*
     Saving a session as Markdown: it goes to Downloads, which is made when this Mac has none. Run with
     `node --test engine/test/export-save.test.ts`.
   */
   import { test } from "node:test";
   import assert from "node:assert/strict";
   import { existsSync, mkdtempSync, readFileSync } from "node:fs";
   import { tmpdir } from "node:os";
   import { join } from "node:path";
   import { saveToDownloads } from "../src/export.ts";

   test("export: a home with no Downloads folder gets one, and a taken name gets a number", { skip: process.platform === "win32" }, () => {
     const home = mkdtempSync(join(tmpdir(), "lc-export-"));
     const was = process.env.HOME;
     process.env.HOME = home;
     try {
       const first = saveToDownloads("Fix: the/login", "# one\n");
       assert.equal(first, join(home, "Downloads", "Fix- the-login.md"));
       assert.equal(readFileSync(first, "utf8"), "# one\n");
       const second = saveToDownloads("Fix: the/login", "# two\n");
       assert.equal(second, join(home, "Downloads", "Fix- the-login 2.md"));
       assert.ok(existsSync(second));
     } finally {
       process.env.HOME = was;
     }
   });
   ```
2. **Verify**: `node --test engine/test/export-save.test.ts` → FAILS (no such folder).
3. In `engine/src/export.ts`, add `mkdirSync` to the `node:fs` import and, after the `const dir = …` line:

   ```ts
   // A Mac set up without one, or a home that isn't a person's (a server, a test): the folder is made rather than the save failing.
   mkdirSync(dir, { recursive: true });
   ```
4. **Verify**: `node --test engine/test/export-save.test.ts` → passes. If the expected file name differs only because the title is cleaned differently from this plan's guess, correct the expected names in the test to what the function's regular expression produces; do not change the function.

### Step 4: Full check

**Verify**: `npm run typecheck -w engine` → exit 0; `node --test engine/test/security-scan.test.ts engine/test/security-store.test.ts engine/test/outside.test.ts engine/test/export-save.test.ts engine/test/shown.test.ts` → all pass.

## Test plan

Three new tests, one per bug, each failing before its fix (Steps 1.1, 2.1, 3.1).

## Done criteria

- [ ] `npm run typecheck -w engine` exits 0
- [ ] The three new tests exist and pass
- [ ] `grep -c "notifications/cancelled" engine/src/outside.ts` → `1`
- [ ] `git status --short` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

- `fixFinding` has callers that rely on it being an `async function` declaration in a way a plain function returning a promise breaks (the type checker will say).
- `engine/test/outside.test.ts` does not spawn `outside.ts` as a process, so the cancel cannot be tested the way Step 2 describes. Then make the code change, say in `plans/README.md` that it has no test, and do not invent a harness.
- The concurrent-fix test passes before the fix.

## Maintenance notes

- `mcp.ts`, `dsh-mcp.ts` and `outside.ts` now hold three copies of the same small server loop. Merging them into one helper is worth doing the next time one of them changes.
- Deferred small items from the audit: a pasted task list that is indented as a whole is never offered as a split (`precheck.ts`, by design conservative); the edits note's git calls do not hear Stop (`edits.ts`); merged duplicate Security findings lose the ids their fix sessions point at (`security.ts`).
