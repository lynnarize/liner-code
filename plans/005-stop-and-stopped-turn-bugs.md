# Plan 005: A sidekick that ignores Stop is given up, a stopped "Make it an app" is not installed, and a quiet read survives its session being deleted

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6970155..HEAD -- engine/src/runtime.ts engine/src/offers.ts engine/test/sidekick.test.ts engine/test/audit-api.test.ts engine/test/reviewer.test.ts`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `6970155`, 2026-11-19

## Why this matters

Three independent engine bugs, each small:

1. **A sidekick's brief has no give-up.** In a pair, the lead hands work to a second model (the sidekick) as a "brief". When Stop is pressed, or the brief's time cap passes, the engine only signals the tool to stop. A lead's own turn is wrapped in `untilStopped`, which gives up on a tool that ignores the signal after 15 seconds. A brief is not wrapped. A sidekick whose tool hangs then holds the session's brief line forever: every later brief waits behind it, and the session's processes are never closed. Since commit `d352fb1`, Codex's Stop relies on that give-up, so a frozen Codex sidekick now does exactly this.
2. **A stopped add-on session is installed.** "Make it an app" runs a background session that writes an add-on draft. When that session's turn ends, `Offers.watch` installs the draft. A turn the person stopped also ends with thread status `"done"`, so a half-written panel can be installed.
3. **A quiet read crashes on a deleted session.** `quiet()` (the Reviewer's read, the prompt check) looks its session up in a `finally` block with `store.thread(id)`, which throws when the session was deleted meanwhile. The real result or error is replaced by "No thread …" and the read's usage record is lost.

## Current state

- `engine/src/runtime.ts:1665` (the lead's turn is wrapped):
  `const go = (p: string) => this.untilStopped(threadId, turn, session, o.wake ? o.wake.w.run(sink.api, abort.signal) : session.turn(p, sink.api, abort.signal, o.files), abort.signal);`
- `engine/src/runtime.ts:2973-3003` (`untilStopped`), shortened:

  ```ts
  private untilStopped(threadId: string, turn: number, session: ProviderSession, run: Promise<void>, signal: AbortSignal): Promise<void> {
    run.catch(() => {});
    let timer: NodeJS.Timeout | undefined;
    let onAbort = () => {};
    const given = new Promise<void>((resolve) => {
      onAbort = () => {
        timer = setTimeout(() => {
          const key = [...this.live].find(([, l]) => l.session === session)?.[0];
          if (key) this.drop(key);
          if (this.store.threads.some((x) => x.id === threadId)) {
            const t = this.store.thread(threadId);
            … builds `tool` from the LEAD's provider …
            this.store.putItem(threadId, { kind: "notice", …, text: `${tool} hadn't stopped ${spanOf(this.stopGraceMs)} after Stop, so Liner Code ended it. It picks up again on your next message.` });
          }
          resolve();
        }, this.stopGraceMs);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    return Promise.race([run, given]).finally(() => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); });
  }
  ```
- `engine/src/runtime.ts:2626-2636` (inside `runBrief`; `threadId`, `turn`, `session`, `sink`, `abort` are all in scope here):

  ```ts
      const prompt = briefPrompt(b.brief, b.doneWhen);
      began = true;
      try {
        await session.turn(prompt, sink, abort.signal);
      } catch (e) {
        // Its session from before is gone: the tool opened a new one, and the brief is all it needs.
        if (!(e instanceof ResumeFailed) || abort.signal.aborted) throw e;
        await session.turn(prompt, sink, abort.signal);
      }
  ```
  The brief's cap only aborts: `runtime.ts:2495` `const cap = setTimeout(() => ((brief.by ??= "cap"), abort.abort()), b.capMs ?? this.sidekickMs);`
- `engine/src/runtime.ts:2078-2083` (the `finally` of `quiet`):

  ```ts
    } finally {
      clearTimeout(timer);
      session.close();
      const t = this.store.thread(threadId);
      this.store.logUsage({ at: Date.now(), threadId: apart ? "" : threadId, projectId: apart ? "" : t.projectId, agent: as, provider, model, …, seconds: (Date.now() - started) / 1000 });
    }
  ```
  `engine/src/store.ts:332-336`: `thread(id)` throws `new Error(`No thread ${id}`)` when it is gone. `this.store.threads` is the plain array.
- `engine/src/offers.ts:212-227` (`watch`):

  ```ts
  private watch(t: Thread) {
    const m = this.making.get(t.id);
    if (!m) return;
    if (t.status === "running") {
      m.started = true;
      return;
    }
    if (!m.started || t.status === "waiting") return;
    this.making.delete(t.id);
    this.keep();
    const store = this.h.store;
    // Told from inside whatever changed this session (its turn ending): the session that offered it may be gone.
    const it = this.offerOf(m);
    if (!it || (it.state !== "creating" && it.state !== "installing")) return;
    if (t.status === "error" || t.status === "limited") return void store.putItem(m.threadId, { ...it, state: "failed", error: "Making it stopped with an error. Try again." });
    store.putItem(m.threadId, { ...it, state: "installing" });
    try {
      const { manifest, files } = readDraft(this.h.cwdOf(t.id), m.id);
  ```
  `t` is the making session. A stopped turn leaves its turn marker in the timeline with `status: "stopped"` (`engine/src/runtime.ts:1744`: `status: stopped ? "stopped" : errored ? "error" : "done"` on the item of `kind: "turn"`), while the thread's status becomes `"done"` (`runtime.ts:1753`).
- Test harnesses to copy:
  - Sidekick: `engine/test/sidekick.test.ts`. `fake(id, script)` (line 47) installs a fake provider whose turn runs `script(o, text, sink, signal)`; `pair()` (line 76) builds a store, tools and runtime for a lead + sidekick session `"t"`; `hand(tools, o, sink, key, args)` (line 99) is the lead calling the `sidekick` tool. The test at lines 292-312 sets `runtime.sidekickMs = 1500` and asserts the lead is told `/cap for one brief/`. `engine/test/stop-grace.test.ts:255` shows `runtime.stopGraceMs = 300`.
  - Offers: `engine/test/audit-api.test.ts:340-420`. `offers(over)` builds an `Offers` with a fake host; `draft(cwd, id)` writes an add-on draft; `state(store)` reads the offer item.

Conventions: TypeScript run directly by Node 24. Long hand-formatted lines; never run a formatter, do not re-wrap untouched code. Comments are plain sentences that say why. Every bug fix comes with a test that fails without the fix.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck -w engine` | exit 0 |
| Sidekick tests | `node --test engine/test/sidekick.test.ts` | all pass |
| Stop tests | `node --test engine/test/stop-grace.test.ts engine/test/polish-core.test.ts` | all pass |
| Offers tests | `node --test engine/test/audit-api.test.ts` | all pass |
| Reviewer tests | `node --test engine/test/reviewer.test.ts engine/test/audit-review.test.ts` | all pass |

## Scope

**In scope**:
- `engine/src/runtime.ts`: `untilStopped`, the two `session.turn` calls in `runBrief`, the `finally` of `quiet`
- `engine/src/offers.ts`: `watch`
- `engine/test/sidekick.test.ts`, `engine/test/audit-api.test.ts`, `engine/test/reviewer.test.ts` (add tests)

**Out of scope**:
- `engine/src/providers/*`: no provider changes.
- The wording of the existing Stop notice for a lead's turn.
- `plain()` in `runtime.ts` (an add-on's model call has the same missing give-up; it is deferred).

## Git workflow

- Stay on `design-and-api-endpoints`. One commit for this plan, a plain sentence (example from `git log`: `A Reviewer block reads as one, without a question's amber`). Do not push.

## Steps

### Step 1: Failing test for the brief

In `engine/test/sidekick.test.ts` add, after the cap test that ends near line 316:

```ts
test("sidekick: a brief whose tool never ends after its cap is given up, and the lead is told", async () => {
  // A tool that hears nothing: its turn never settles, abort or not.
  const side = fake("codex", () => new Promise<void>(() => {}));
  let said = "";
  const lead = fake("claude", async (o, _t, sink) => {
    said = (await hand(tools, o, sink, "k1", { brief: "one that hangs" })).text;
  });
  const { runtime, tools } = pair();
  runtime.sidekickMs = 1500;
  runtime.stopGraceMs = 200;
  try {
    const hung = new Promise<never>((_, no) => setTimeout(() => no(new Error("the brief never ended")), 15_000).unref());
    await Promise.race([runtime.send("t", "go"), hung]);
    assert.match(said, /cap for one brief/);
  } finally {
    side.restore();
    lead.restore();
  }
});
```

(End the `finally` the way the neighbouring tests in this file do; if they also shut the runtime down, do the same.)

**Verify**: `node --test engine/test/sidekick.test.ts` → this new test FAILS with "the brief never ended" (it takes about 15 seconds); the others pass. If it passes before any fix, STOP and report.

### Step 2: Give a brief the same grace as a turn

In `engine/src/runtime.ts`:

1. Add a sixth parameter to `untilStopped`: `…, signal: AbortSignal, say = true): Promise<void>`, and extend its doc comment with: `` `say` false: no notice in the thread (a brief's own row says how it ended). ``
2. Change the condition around the notice from `if (this.store.threads.some((x) => x.id === threadId)) {` to `if (say && this.store.threads.some((x) => x.id === threadId)) {`.
3. In `runBrief` replace both `await session.turn(prompt, sink, abort.signal);` lines with:

   ```ts
   // A tool that doesn't hear Stop or its cap is given up as a turn's is (untilStopped), or the brief would hold this session's
   // line of briefs for good. No notice: the brief's row and what the lead is told say how it ended.
   await this.untilStopped(threadId, turn, session, session.turn(prompt, sink, abort.signal), abort.signal, false);
   ```
   (Write the comment once, above the `try`.)

**Verify**: `node --test engine/test/sidekick.test.ts` → all pass, the new test within a few seconds; `node --test engine/test/stop-grace.test.ts engine/test/polish-core.test.ts` → all pass.

### Step 3: Failing test for the stopped offer

In `engine/test/audit-api.test.ts`, in the Offers section, add a test modelled on the neighbouring ones (read lines 340-420 first to see how `offers()`, `draft()`, `state()` and `store.patchThread` are used to play a making session through `running` and then its end):

- Start an offer with `await o.answer("parent", "of", "create")` so a child session exists and the offer is `creating`.
- Write a valid draft with `draft(cwd, <the offer's add-on id>)`, as the nearest passing "is added" test does.
- Play the child's turn: put a turn marker item `{ kind: "turn", id: "tm", turn: 1, at: 2, agent: "forge", model: "demo:demo", status: "stopped" }` in the child's timeline with `store.putItem`, then set the child `status: "running"` and then `status: "done"` with `store.patchThread`, exactly as the neighbouring tests move a child through its states.
- Assert `state(store).state === "failed"` and `/stopped/i` matches `state(store).error`, and that nothing was installed (use the same check the neighbouring tests use for "installed", negated).

Name it: `"offers: a session that was stopped while making it isn't added: the card says it stopped"`.

**Verify**: `node --test engine/test/audit-api.test.ts` → the new test FAILS (the draft is installed); the others pass.

### Step 4: Do not install a stopped session's draft

In `engine/src/offers.ts` `watch`, directly after the line that handles `error`/`limited`, add:

```ts
    // A turn you stopped ends as "done" too: what it had written by then is half an add-on, not one to put in.
    const last = store.timeline(t.id).findLast((x) => x.kind === "turn");
    if (last?.kind === "turn" && last.status === "stopped") return void store.putItem(m.threadId, { ...it, state: "failed", error: "Making it was stopped before it finished. Try again." });
```

**Verify**: `node --test engine/test/audit-api.test.ts` → all pass.

### Step 5: Failing test, then fix, for the quiet read

1. In `engine/test/reviewer.test.ts`, two tests already call `runtime.quiet("t", "codex:gpt-6-sol", dir, "…", new AbortController().signal, …)` against a fake `providers.codex` (near lines 336 and 444). Using the same setup, add a test in which the fake provider's `turn` deletes the session mid-read with `store.removeThread("t")` (`engine/src/store.ts:422`), then writes some text to the sink and returns. Call `runtime.quiet(...)` the way those tests do and assert the returned promise does NOT reject with `/No thread/`. Name it: `"a quiet read whose session is deleted meanwhile still gives its answer"`.
2. **Verify**: the new test FAILS with "No thread …".
3. In `engine/src/runtime.ts`, in the `finally` of `quiet`, replace

   ```ts
      const t = this.store.thread(threadId);
   ```
   with

   ```ts
      // The session may have been deleted while it read: its answer and what it spent are still worth keeping.
      const t = this.store.threads.find((x) => x.id === threadId);
   ```
   and in the next line replace `t.projectId` with `(t?.projectId ?? "")`.
4. **Verify**: `node --test engine/test/reviewer.test.ts engine/test/audit-review.test.ts` → all pass.

### Step 6: Full check

**Verify**: `npm run typecheck -w engine` → exit 0; `node --test engine/test/sidekick.test.ts engine/test/stop-grace.test.ts engine/test/polish-core.test.ts engine/test/audit-api.test.ts engine/test/audit-review.test.ts engine/test/reviewer.test.ts engine/test/pair-design.test.ts engine/test/pair-ways.test.ts` → all pass.

## Test plan

Three new tests, one per bug (Steps 1, 3, 5), each failing before its fix. They use the harnesses already in the three test files.

## Done criteria

- [ ] `npm run typecheck -w engine` exits 0
- [ ] `grep -c "untilStopped" engine/src/runtime.ts` → at least `5` (the two brief calls added)
- [ ] The three new tests exist and pass
- [ ] The test files named in Step 6 all pass
- [ ] `git status --short` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

- The new brief test passes before the fix in Step 2 (the bug is not where this plan says).
- After Step 2 an existing sidekick test fails because a brief now ends where it used to wait.
- You cannot build the stopped-offer scenario from the neighbouring tests in `audit-api.test.ts` within the existing harness.
- You cannot find a way to call `quiet` in a test from the existing files; then make only the two-line fix in Step 5.3, say so in `plans/README.md`, and do not invent a harness.

## Maintenance notes

- `untilStopped` drops the session from `this.live` by identity. If briefs ever share a live session with the lead, a give-up on a brief would also close the lead's session; check this when changing how sidekick sessions are kept.
- This changes when a real Codex or ACP sidekick is closed after Stop. It is proven with fakes only: the owner's real-tool check should include stopping a pair mid-brief.
- Deferred, same family: `plain()` (an add-on's model call) has no give-up; a late question in a Reviewer-blocked session keeps `held: "review"` (`runtime.ts:3461`).
