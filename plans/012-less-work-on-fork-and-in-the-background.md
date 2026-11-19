# Plan 012: A fork keeps its snapshots in one git call, the other faces stop redrawing on every session event, and hidden windows stop polling

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6970155..HEAD -- engine/src/checkpoints.ts ui/src/app/App.tsx ui/src/app/design/Shell.tsx ui/src/app/security/Shell.tsx ui/src/app/Browser.tsx ui/src/app/Pr.tsx`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `6970155`, 2026-11-19

## Why this matters

Three small costs, none measured, each found by reading:

1. Forking a session keeps a git ref for every snapshot commit of the parent, one `git update-ref` process per commit, one after another. A long session has hundreds. Deleting a session had the same problem and was fixed with one batched call; the fork was missed.
2. Liner Design and Liner Security are drawn by `App` with a new inline function as a prop on every render, and `App` re-renders on every event of every session. So while a Code session works in the background, the whole Design or Security face re-renders several times a second.
3. Two timers keep running while the window is hidden: the Browser panel looks for dev servers every 5 seconds (two `lsof` runs and a `ps` in the engine each time), and the Pull request panel asks GitHub every 30 seconds.

## Current state

- `engine/src/checkpoints.ts:368-371`:

  ```ts
  export async function keep(cwd: string, name: string, commits: string[]) {
    let n = 0;
    for (const c of new Set(commits)) await git(cwd, ["update-ref", `refs/liner/${name}/kept-${n++}`, c]);
  }
  ```
- The pattern to copy, same file, `forget` (lines 377-384):

  ```ts
  export async function forget(cwd: string, prefix: string) {
    const r = await git(cwd, ["for-each-ref", "--format=%(refname)", `refs/liner/${prefix}`]);
    const refs = r.stdout.split("\n").filter(Boolean);
    if (!refs.length) return;
    const all = await git(cwd, ["update-ref", "--stdin"], undefined, refs.map((ref) => `delete ${ref}\n`).join(""));
    if (all.code === 0) return;
    for (const ref of refs) await git(cwd, ["update-ref", "-d", ref]);
  }
  ```
  (`git(cwd, args, env, input)`: the fourth argument is text for git's standard input.)
- `keep` is called when a session is forked (`engine/src/api.ts:1125-1126`). `engine/test/checkpoints.test.ts` tests this file with a real temporary repository; it has helpers for making a repo and running git (see its top 40 lines).
- `ui/src/app/App.tsx:571-572` already has stable callbacks:

  ```ts
  const showSidebar = useCallback(() => setSidebar(true), []);
  const newAgent = useCallback(() => setAgentDialog({ open: true }), []);
  ```
  but `App.tsx:902` and `:904` pass new functions each render:

  ```tsx
  <SecurityShell sidebar={sidebar} onSidebar={() => setSidebar(true)} />
  …
  <DesignShell sidebar={sidebar} onSidebar={() => setSidebar(true)} onNewAgent={() => setAgentDialog({ open: true })} />
  ```
- `ui/src/app/design/Shell.tsx:16`: `export function DesignShell({ sidebar, onSidebar, onNewAgent }: { sidebar: boolean; onSidebar: () => void; onNewAgent: () => void }) {`
  `ui/src/app/security/Shell.tsx:20`: `export function SecurityShell({ sidebar, onSidebar }: { sidebar: boolean; onSidebar: () => void }) {`
  Neither is wrapped in `memo`. Other components in this app are memoised as `export const X = memo(function X(props) { … });` (see `Session` in `ui/src/app/Session.tsx`).
- `ui/src/app/Browser.tsx:236-247`:

  ```ts
  const waiting = !target && !hidden;
  useEffect(() => {
    if (!waiting) return;
    let live = true;
    const t = window.setInterval(() => {
      void look().then(({ p, f }) => live && setTarget((now) => now ?? pick(p, f, null)));
    }, 5000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [waiting]);
  ```
- `ui/src/app/Pr.tsx:405-413`:

  ```ts
  useEffect(() => {
    const came = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (!visible) return;
    if (came) look.current(true);
    // The card watches its own checks; this keeps the reviews under it current.
    const t = window.setInterval(() => look.current(false), 30000);
    return () => window.clearInterval(t);
  }, [visible]);
  ```
- The pattern already used elsewhere, `ui/src/app/design/BuildTab.tsx:92`:
  `beat = window.setInterval(() => document.visibilityState === "visible" && void refreshBuilds(), 4000);`

Conventions: long hand-formatted lines; never run a formatter; comments are plain sentences that say why. Engine fixes come with a test; the interface has no test runner, so UI steps are verified by the type check and the build.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Checkpoint tests | `node --test engine/test/checkpoints.test.ts` | all pass |
| Fork tests | `node --test engine/test/audit-api-turns.test.ts engine/test/engine.test.ts` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `engine/src/checkpoints.ts` (`keep` only), `engine/test/checkpoints.test.ts` (add a test)
- `ui/src/app/App.tsx` (the two JSX lines), `ui/src/app/design/Shell.tsx`, `ui/src/app/security/Shell.tsx` (the `memo` wrap only)
- `ui/src/app/Browser.tsx`, `ui/src/app/Pr.tsx` (the two intervals only)

**Out of scope**:
- The fork's item-by-item copy of the parent's timeline (`engine/src/api.ts:1119-1123`): it needs a new store method and is deferred.
- `Home`, `Wall` and anything inside the Design canvas.
- Any other timer.

## Git workflow

- Stay on `design-and-api-endpoints`. One commit for this plan, a plain sentence (example from `git log`: `A Reviewer block reads as one, without a question's amber`). Do not push.

## Steps

### Step 1: Test what `keep` must do

In `engine/test/checkpoints.test.ts` add a test using the file's own repo helpers:

- Make a repository with three commits and collect their ids.
- `await keep(dir, "fork1", [a, b, c, a]);` (one id twice).
- Read `git for-each-ref --format="%(refname) %(objectname)" refs/liner/fork1` and assert there are exactly three refs, named `refs/liner/fork1/kept-0`, `kept-1`, `kept-2`, pointing at `a`, `b`, `c`.
- `await keep(dir, "fork2", []);` → no ref under `refs/liner/fork2`, and no error.

Name: `"keep: a fork's hold on the snapshots it copied is one ref each, the same commit once"`. Import `keep` from `../src/checkpoints.ts` if the file does not import it yet.

**Verify**: `node --test engine/test/checkpoints.test.ts` → passes already (this pins today's behaviour before the change).

### Step 2: One git process for all of them

Replace `keep` in `engine/src/checkpoints.ts` with:

```ts
export async function keep(cwd: string, name: string, commits: string[]) {
  const refs = [...new Set(commits)].map((c, n) => [`refs/liner/${name}/kept-${n}`, c] as const);
  if (!refs.length) return;
  // All in one git, as forget drops them: a long session's fork made hundreds of these one process at a time. A batch that
  // fails fails whole, so then they go one at a time, as before.
  const all = await git(cwd, ["update-ref", "--stdin"], undefined, refs.map(([ref, c]) => `update ${ref} ${c}\n`).join(""));
  if (all.code === 0) return;
  for (const [ref, c] of refs) await git(cwd, ["update-ref", ref, c]);
}
```

Keep the doc comment above it.

**Verify**: `node --test engine/test/checkpoints.test.ts engine/test/audit-api-turns.test.ts engine/test/engine.test.ts` → all pass.

### Step 3: Stable props and memo for the two faces

1. `App.tsx:902`: `<SecurityShell sidebar={sidebar} onSidebar={showSidebar} />`
2. `App.tsx:904`: `<DesignShell sidebar={sidebar} onSidebar={showSidebar} onNewAgent={newAgent} />`
3. `design/Shell.tsx:16`: change `export function DesignShell(…) {` to `export const DesignShell = memo(function DesignShell(…) {` and close it with `});` where the function ended with `}`. Import `memo` from `"react"`. Add above it: `// Memoised: App redraws on every session's events, and this face only needs to when its own props change.`
4. `security/Shell.tsx:20`: the same for `SecurityShell`.

**Verify**: `npm run typecheck -w ui` → exit 0; `grep -c "onSidebar={() =>" ui/src/app/App.tsx` → `0`.

### Step 4: Timers wait while the window is hidden

1. `Browser.tsx`: inside the interval callback, return early when the window is not visible:

   ```ts
   const t = window.setInterval(() => {
     // Nobody is looking: the engine isn't asked to list this Mac's servers every five seconds for a hidden window.
     if (document.visibilityState !== "visible") return;
     void look().then(({ p, f }) => live && setTarget((now) => now ?? pick(p, f, null)));
   }, 5000);
   ```
2. `Pr.tsx`: change the interval line to:
   `const t = window.setInterval(() => document.visibilityState === "visible" && look.current(false), 30000);`

**Verify**: `npm run typecheck -w ui` → exit 0; `grep -c "visibilityState" ui/src/app/Browser.tsx ui/src/app/Pr.tsx` → at least `1` in each.

### Step 5: Build

**Verify**: `npm run typecheck` → exit 0; `npm run build` → exit 0.

## Test plan

One new engine test for `keep` (Step 1), written before the change so it proves the batched version does the same thing. The UI steps have no automated test; report them as "not measured, not seen on screen".

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `node --test engine/test/checkpoints.test.ts` passes, with the new test
- [ ] `npm run build` exits 0
- [ ] `grep -c "onSidebar={() =>" ui/src/app/App.tsx` → `0`
- [ ] `git status --short` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

- `git(...)` in `checkpoints.ts` does not take standard input as its fourth argument (the `forget` function no longer looks like the excerpt).
- Wrapping a shell in `memo` breaks the type check because the component is used with a `ref` or as a `lazy` target with a different shape.
- `showSidebar` or `newAgent` is declared after the JSX that would use it, or inside a branch.

## Maintenance notes

- `memo` only helps while every prop is stable. A new prop added to either shell must be a primitive or wrapped in `useCallback`/`useMemo` in `App.tsx`.
- Not measured: the redraw count of the Design face while a background session streams. The audit of 18 November has a way to count React commits; it is worth repeating once.
- Deferred, same family: the fork's per-item timeline copy; about 20 git processes per turn for snapshots; up to 120 `git show` runs for one diff card; the `@` file list being re-read on every keystroke; `refs/liner/` growing without limit.
