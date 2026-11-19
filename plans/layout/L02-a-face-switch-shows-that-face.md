# L02. A face switch shows that face

**Commit message:** `Switching to Design or Security always shows that face, whatever page was open`

## Why

With the Add-ons page open in Liner Code, choose Liner Security from the name at the sidebar's foot. The sidebar becomes
Security's, with Overview picked, and the paper still shows the Add-ons page. The same happens for Design, and for Usage and
the Wall. Seen on screen; baseline `faceSwitch.addonsPageStillShown = true`.

The cause is in `ui/src/app/App.tsx:897-906`: a face's own shell is drawn only when the view is Home or a session.

```tsx
{face === "security" && (view.kind === "home" || view.kind === "session") ? (
  …<SecurityShell … />
) : face === "design" && (view.kind === "home" || view.kind === "session") ? (
  …<DesignShell … />
```

Nothing moves the view when the face changes. The effect at `App.tsx:308-320` returns at once for Security
(`if (face === "security" || was === "security") return;`) and only looks at sessions for Design.

The pages that belong to no face (`addons`, `usage`, `wall`, `app`, and the others in the `View` type at `App.tsx:67`) are
reached from Code's sidebar, so leaving Code should leave them.

## Current state (drift check)

```bash
grep -n 'face === "security" && (view.kind === "home" || view.kind === "session")' ui/src/app/App.tsx   # one line, near 897
grep -n 'if (face === "security" || was === "security") return;' ui/src/app/App.tsx                     # one line, near 313
grep -n "^type View = " ui/src/app/App.tsx                                                              # 67
```

Read `App.tsx:60-80` (the `View` type) and `App.tsx:300-345` (the face effect) to the end before changing anything.

## Steps

### 1. A pure rule, with its test first

Add to `ui/src/app/face.ts` (it already holds the face's state and has no React in its logic):

```ts
// The pages a face draws itself: its Home and a session. Every other page (Add-ons, Usage, the Wall, an app) is reached
// from Liner Code's sidebar, so a change of face leaves it: the paper would otherwise keep it under another face's sidebar.
export const keptOnFaceChange = (kind: string) => kind === "home" || kind === "session";
```

Write `engine/test/face-change.test.ts` first, importing it as the other tests import UI logic
(`import { keptOnFaceChange } from "../../ui/src/app/face.ts";`, see `engine/test/browser-frame.test.ts`). Tests, as full
sentences: "A change of face keeps Home and a session" and "A change of face leaves Add-ons, Usage, the Wall and an app
page". Run `node --test engine/test/face-change.test.ts`: it must fail because the export does not exist.

If importing `face.ts` from a Node test fails because the module touches `window` or `sessionStorage` when loaded, put the
function in a new file `ui/src/app/face-pages.ts` instead and import it from there in both places.

### 2. Use it when the face changes

In the effect at `App.tsx:308`, directly after `if (was === face || !ready) return;` and **before** the Security early
return, add:

```tsx
// A page that belongs to no face (Add-ons, Usage, the Wall, an app) is left behind with the face it was opened from.
if (!keptOnFaceChange(view.kind)) setView({ kind: "home" });
```

and import `keptOnFaceChange` in the existing import from `./face` at `App.tsx:50`. Use the same setter the rest of that
effect uses for a view change (`setView`); do not add a second effect.

**Verify:** `npm run typecheck`; `node --test engine/test/face-change.test.ts` passes.

## Done

- The new test file passes; `npm run typecheck` passes.
- Measured: `faceSwitch.addonsPageStillShown = false`.
- Going Code → Security → Code from a session still returns to that session (the existing behaviour of the effect).

## STOP conditions

- The effect at `App.tsx:308-320` no longer starts with the `was === face` check.
- `setView({ kind: "home" })` on a face change breaks an existing test in `engine/test` or `desktop/test` (run `npm test`).
  Report which.
