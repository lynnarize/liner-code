# Plan 007: Drafts, hand edits and a half-written line comment are not lost in the interface

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6970155..HEAD -- ui/src/app/Composer.tsx ui/src/app/design/DesignHome.tsx ui/src/app/design/Dock.tsx ui/src/app/design/Live.tsx ui/src/app/design/BuildTab.tsx ui/src/app/Session.tsx ui/src/app/Review.tsx`
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

Six small bugs in the React interface where the person's own work can disappear or a control misbehaves:

1. The message box on Code's Home, the "New design" box in Liner Design, and the box of a design that has no session yet all store their draft under the same key, `"home"`. A half-written prompt in one shows up in the others, and sending from one empties all of them.
2. "Send to code" in Liner Design forgets the hand edits it was holding even when the send failed, and also forgets edits made while it was gathering.
3. The Terminal under a session is loaded with React's plain `lazy`. React keeps a failed import forever, so if that file fails to load once, every session with its bottom panel open breaks until the window is reloaded.
4. In the Review panel, a comment being typed on a line closes when the running turn ends, because the panel jumps to the newest turn.
5. Text typed into the message box while a send is still reading its attachments is wiped.
6. A project script's keyboard shortcut fires even while a dialog (for example ⌘K) is open.

The interface has no automated tests, so each step here is verified by the type checker, a production build and a `grep`. None of it was seen on screen; say so in your report.

## Current state

- `ui/src/app/Composer.tsx:335-339`:

  ```ts
  const draftKey = thread?.id ?? "home";
  const [text, setText] = useState(() => draftOf(draftKey));
  …
  const [files, setFiles] = useState<File[]>(() => draftFiles.get(draftKey) ?? []);
  ```
  `Composer` is declared at line 325 as `export function Composer({ variant, project, thread, settings, … }: <props type>)`. It is rendered by `ui/src/app/Home.tsx:216`, `ui/src/app/Session.tsx:733`, `ui/src/app/design/DesignHome.tsx:262`, `ui/src/app/design/Dock.tsx:146` and `ui/src/app/security/ScanSession.tsx:357`.
- `ui/src/app/design/DesignHome.tsx:262-264`: `<Composer variant="home" project={project ?? NOWHERE} …` with no `thread`.
- `ui/src/app/design/Dock.tsx:146-149`: `<Composer variant="session" project={project} thread={thread} …`, where `thread` is undefined for a design with no session yet. The same component has `tab` in scope (used as `makeSession(tab, first)`); its type is `DesignTab = { projectId: string; file: string; title?: string; threadId?: string; fresh?: string }` (`ui/src/app/face.ts:59`).
- `ui/src/app/Composer.tsx:631-634` (inside `send`):

  ```ts
      const payload: Outgoing = { text: t || "Here are the files.", files: await Promise.all(sent.map(async (f) => ({ name: f.name, data: await toBase64(f) }))), mode: how, ...(way.once ? { once: way.once } : {}) };
      setText(edit?.draft ?? "");
  ```
  `said` is the box's text when the send began (`const { text: said, files: sent } = box.current;`, line 602).
- `ui/src/app/design/Live.tsx:204-249` (`sendToCode`): reads `const s = getDesign(); const held = heldOf(s);`, awaits `frames.read(...)` per element, then:

  ```ts
  await askAgent(text, `Sent to ${thread ?? "the agent"}`, shownAsk(…));
  for (const frame of Object.keys(s.pending)) design.clearPending(frame);
  ```
- `ui/src/app/design/BuildTab.tsx:130-145` (`askAgent`): every failure path only shows a toast and returns `undefined`, so the caller cannot tell it failed:

  ```ts
  export async function askAgent(text: string, said = "Sent to the agent", shown?: UserShown) {
    const s = getDesign();
    if (!s.file) return void toast.error("Open a design file first");
    if (s.scrub !== undefined) return void toast("Back to now first", { … });
    if (s.mock) return void toast(said, { … });
    try {
      const id = await design.session();
      if (!id) return void toast.error("Open the design's session first");
      await rpc("thread.send", { … });
      toast(said, { duration: 2000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }
  ```
  All its other callers use `void askAgent(…)` and ignore the result.
- `ui/src/app/design/store.ts:1188-1197`: `design.keepPending(frame, ops)` replaces a frame's held edits (an empty list removes the frame); `design.clearPending(frame)` drops them. `state.pending` is `Record<string, FrameOp[]>`; new edits are added by building a new array (`store.ts:831`), so the op objects in an old snapshot keep their identity.
- `ui/src/app/Session.tsx:9` imports `lazy` from `"react"`; `Session.tsx:89`:
  `const TerminalSurface = lazy(() => import("./Terminal").then((m) => ({ default: m.TerminalSurface })));`
  It is rendered at `Session.tsx:759-763` inside `<Suspense fallback={null}>` with no error boundary of its own.
- The pattern to copy, `ui/src/app/Panel.tsx:44-47`:

  ```ts
  import { early, lazyAgain } from "./early";
  …
  const TerminalSurface = lazyAgain(() => import("./Terminal").then((m) => m.TerminalSurface));
  ```
  `ui/src/app/Boundary.tsx` exports `Boundary` with props `label: string` and `quiet?: boolean`; its "Try again" calls `retryChunks()` from `early.ts`.
- `ui/src/app/Session.tsx:441-454`:

  ```ts
    const onKey = (e: KeyboardEvent) => {
      if (!keysOn.current) return;
      const x = (project?.scripts ?? []).find((s) => s.key && matches(e, s.key));
      if (!x) return;
  ```
  The check other handlers use: `ui/src/app/App.tsx:635` `… || document.querySelector("dialog[open]")) return;`.
- `ui/src/app/Review.tsx:135-136`:

  ```ts
  const pick = focus?.id && (focus.id === "all" || focus.id === "branch" || cps.some((c) => c.id === focus.id)) ? focus.id : (cps[cps.length - 1]?.id ?? "all");
  const cp = cps.find((c) => c.id === pick);
  ```
  The state for a line comment is declared after it: `Review.tsx:144-145` `const [sel, setSel] = useState<Anchor | null>(null);` and `const [ask, setAsk] = useState("");`.
  `Review.tsx:154`: `const key = `${pick}:${cp?.reverted}:${cp?.committed}:${cps.length}:${cps.filter((c) => c.reverted).length}`;` and the effect that follows starts with `setDiff(null);`.
  `Review.tsx:176-180`: `useEffect(() => { setAt(0); setOpen(new Set()); setSel(null); }, [pick]);`

Conventions: React 19 function components, long hand-formatted lines, comments in plain sentences that say why. Never run a formatter and do not re-wrap code you did not change. `noUnusedLocals` is on: remove an import you stop using.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck -w ui` | exit 0 |
| Build | `npm run build` | exit 0 (writes `ui/dist`, which git ignores) |

## Scope

**In scope**:
- `ui/src/app/Composer.tsx`, `ui/src/app/design/DesignHome.tsx`, `ui/src/app/design/Dock.tsx`
- `ui/src/app/design/Live.tsx`, `ui/src/app/design/BuildTab.tsx` (`askAgent` only)
- `ui/src/app/Session.tsx`
- `ui/src/app/Review.tsx`

**Out of scope**:
- `ui/src/liner/**` (a copy of another library).
- `ui/src/app/Home.tsx`, `ui/src/app/security/ScanSession.tsx`: their boxes keep their keys.
- The other two plain `lazy` uses (`Settings.tsx:31`, `AddonsPage.tsx:31`).
- Any CSS.

## Git workflow

- Stay on `design-and-api-endpoints`. One commit for this plan, a plain sentence (example from `git log`: `A Reviewer block reads as one, without a question's amber`). Do not push.

## Steps

### Step 1: Each box keeps its own draft

1. In `Composer.tsx`, add an optional prop `draftKey?: string` to the component's props type, with the doc comment `/** Where this box keeps its draft when it has no session: unset is Code's Home. */`. In the destructuring on line 325 take it as `draftKey: draftAt`.
2. Change line 335 to: `const draftKey = thread?.id ?? draftAt ?? "home";`
3. `DesignHome.tsx`: add `draftKey="design-home"` to its `<Composer`.
4. `Dock.tsx`: add `draftKey={`design:${tab.projectId}:${tab.file}`}` to its `<Composer`.

**Verify**: `npm run typecheck -w ui` → exit 0; `grep -n "draftKey=" ui/src/app/design/DesignHome.tsx ui/src/app/design/Dock.tsx` → one match in each.

### Step 2: "Send to code" keeps what it did not send

1. `BuildTab.tsx` `askAgent`: make it return `Promise<boolean>`: `false` for "no file", "scrub", "no session" and the `catch`; `true` for the mock path and after a successful `thread.send`. Keep every toast as it is. Add to its doc comment: `Resolves true once it was sent (or shown, in the mock), false when it wasn't: the toast has said why.`
2. `Live.tsx` `sendToCode`: replace the last two lines with:

   ```ts
   const sent = await askAgent(text, `Sent to ${thread ?? "the agent"}`, shownAsk(…unchanged…));
   // Not sent: what was held stays held, or a reload of the frame would lose it with nothing told to the agent.
   if (!sent) return;
   // Only what went: a change made while this was gathering wasn't in the message, so it stays held.
   const now = getDesign().pending;
   for (const [frame, ops] of Object.entries(s.pending)) {
     const gone = new Set(ops);
     design.keepPending(frame, (now[frame] ?? []).filter((op) => !gone.has(op)));
   }
   ```

**Verify**: `npm run typecheck -w ui` → exit 0; `grep -c "clearPending" ui/src/app/design/Live.tsx` → `0`, unless another function in that file used it before (compare with `git show 6970155:ui/src/app/design/Live.tsx | grep -c clearPending` and expect one fewer).

### Step 3: The bottom Terminal loads again after a failed load

In `Session.tsx`:

1. Replace line 89 with `const TerminalSurface = lazyAgain(() => import("./Terminal").then((m) => m.TerminalSurface));` and add `import { lazyAgain } from "./early";`.
2. Remove `lazy` from the `react` import on line 9 (it is no longer used in this file).
3. Wrap the bottom panel's `<Suspense fallback={null}>…</Suspense>` (lines 759-763) in `<Boundary label="Terminal" quiet>…</Boundary>`. Import `Boundary` from `"./Boundary"` if the file does not import it yet.

**Verify**: `npm run typecheck -w ui` → exit 0; `grep -c "lazy(" ui/src/app/Session.tsx` → `0`.

### Step 4: A script's keys do not fire over a dialog

In `Session.tsx:443`, change `if (!keysOn.current) return;` to:

```ts
      // A dialog (⌘K, a confirm) has the keyboard: a script's keys wait, as ⌘1 to ⌘9 do (App.tsx).
      if (!keysOn.current || document.querySelector("dialog[open]")) return;
```

**Verify**: `grep -c 'dialog\[open\]' ui/src/app/Session.tsx` → at least `1`.

### Step 5: Text typed while a send reads its files is kept

In `Composer.tsx:632` replace `setText(edit?.draft ?? "");` with:

```ts
      // Reading the files can take a moment: words written in the box meanwhile aren't what was sent, so they stay.
      setText((cur) => (cur === said ? (edit?.draft ?? "") : cur));
```

**Verify**: `npm run typecheck -w ui` → exit 0.

### Step 6: A line comment being written survives a new turn

In `Review.tsx`:

1. Delete the two lines at 135-136 (`const pick = …` and `const cp = …`).
2. Directly after the `useState` block that ends near line 149 (after `const [finding, setFinding] = useState(false);`), insert:

   ```ts
   // The turn you chose, or else the newest. While a comment is being written on a line, the newest stands still: a turn that
   // ends meanwhile would otherwise move the view to its own diff and close the comment under your hands.
   const chosen = focus?.id && (focus.id === "all" || focus.id === "branch" || cps.some((c) => c.id === focus.id)) ? focus.id : undefined;
   const newest = cps[cps.length - 1]?.id ?? "all";
   const shownNewest = useRef(newest);
   if (!sel) shownNewest.current = newest;
   const pick = chosen ?? shownNewest.current;
   const cp = cps.find((c) => c.id === pick);
   ```
   (`useRef` is already imported in this file.)
3. Change line 154 so one turn's diff is not fetched again just because another turn was added:

   ```ts
   // All turns and This branch have no one checkpoint to watch: any turn added or undone changes what they show. One turn's own diff doesn't.
   const whole = pick === "all" || pick === "branch";
   const key = `${pick}:${cp?.reverted}:${cp?.committed}:${whole ? `${cps.length}:${cps.filter((c) => c.reverted).length}` : ""}`;
   ```
   Replace the old comment line above `const key` with the new one.

**Verify**: `npm run typecheck -w ui` → exit 0. If the type checker says `pick` or `cp` is used before its declaration, see STOP conditions.

### Step 7: Build

**Verify**: `npm run typecheck` → exit 0; `npm run build` → exit 0.

## Test plan

There is no UI test runner in this repo, and this plan does not add one (plan 008 adds the first UI logic tests). Verification is the type check, the build and the greps above. In your report list all six changes as "not seen on screen" so the owner tries each once:
1. Type in Code Home, switch to Liner Design: its box is empty.
2. Hold a hand edit on a live frame, stop the engine, press Send to code: the edit is still held.
3. Open a session's bottom Terminal.
4. Open ⌘K and press a project script's keys: nothing runs.
5. Attach a large file, press Send, type at once: the new words stay.
6. Start a comment on a line in Review while a turn runs, let the turn end: the comment box stays.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` exits 0
- [ ] `grep -c "lazy(" ui/src/app/Session.tsx` → `0`
- [ ] `grep -n "draftKey=" ui/src/app/design/DesignHome.tsx ui/src/app/design/Dock.tsx` → two matches
- [ ] `git status --short` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row updated, with "not seen on screen" noted

## STOP conditions

- In `Review.tsx`, something between the old line 135 and the new position reads `pick` or `cp` (the type checker reports use before declaration). Do not reorder hooks to work around it; report.
- `tab` is not in scope where `Dock.tsx` renders `<Composer`.
- `askAgent` has a caller that depends on it returning `undefined`.
- The build fails for a reason unrelated to these files.

## Maintenance notes

- The Design dock's draft key changes from the design's key to the session's id once a session exists; a draft written before the first send is sent by that send, so nothing is carried over.
- Plan 008 moves session-state rules into a testable file; the drafts store in `Composer.tsx:185-216` is the next good candidate for the same treatment.
- Deferred UI items from the audit: the Security Overview staying blank when a second call fails, the hover note that screen readers cannot reach (`ui.tsx`), `rpc()` having no time limit, and about 76 call sites that toast "The engine isn't answering" beside the Reconnecting pill.
