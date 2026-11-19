# Plan 010: The app checks a waiting update's signature again before it swaps it in

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6970155..HEAD -- desktop/src/update.ts desktop/test`
> If `desktop/src/update.ts` changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `6970155`, 2026-11-19

## Why this matters

Updates work in two halves. The engine downloads a release into `~/.liner-code/updates/`, checks its checksum, bundle id, version and code signature, and writes `ready.json`. Later, when the app quits or restarts, the Electron shell moves that folder's `Liner Code.app` over the running app.

The shell's half checks only where the bundle is, that its version is newer and that its bundle id is right. It does not look at the signature. So anything that can write into `~/.liner-code/updates/` between the engine's check and the swap (which can be days later) gets its own bundle installed in the app's place at the next quit, and the swap script then removes macOS's quarantine mark from it. This plan makes the shell verify the code signature, and the signer when this copy has one, right before the swap.

## Current state

- `desktop/src/update.ts:9-14` (imports):

  ```ts
  import { execFileSync, spawn } from "node:child_process";
  import { existsSync, readFileSync, writeFileSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { dirname, join } from "node:path";
  import { app } from "electron";
  import { APP_BUNDLE_ID as BUNDLE_ID, APP_BUNDLE_NAME as APP_NAME, newerVersion as newer } from "../../contracts/src/index.ts";
  ```
- `desktop/src/update.ts:23-39`:

  ```ts
  /** The update waiting in `home`, if it's a Liner Code newer than this one. */
  export function staged(home: string) {
    const bundle = bundlePath();
    if (!bundle || !home) return null;
    const dir = join(home, "updates");
    const ready = join(dir, "ready.json");
    try {
      const r = JSON.parse(readFileSync(ready, "utf8")) as { version?: string; app?: string };
      const path = join(dir, APP_NAME);
      if (r.app !== path || !r.version || !existsSync(join(path, "Contents/Info.plist"))) return null;
      if (!newer(r.version, app.getVersion())) return null;
      const id = execFileSync("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", join(path, "Contents/Info.plist")], { encoding: "utf8" }).trim();
      if (id !== BUNDLE_ID) return null;
      return { path, version: r.version, ready, bundle };
    } catch {
      return null;
    }
  }
  ```
  `bundle` is the running app's own bundle path. `staged` is called from `install` (same file, line 63) and from `desktop/src/main.ts:988` at quit.
- The engine's check, for reference (`engine/src/updates.ts:586-595`): `codesign --verify --deep --strict <app>`, then, only if the running copy has a Team ID, the download's Team ID must be the same. The Team ID is read from the output of `codesign -dv --verbose=2 <app>`, which codesign prints on standard error, from the line `TeamIdentifier=<id>`; `TeamIdentifier=not set` means none (`engine/src/updates.ts:72-76`). Today's builds are ad-hoc signed, so they have no Team ID.
- The desktop workspace must not import from `engine/src` (it never does today). `desktop/src/update.ts` imports `electron`, so it cannot be loaded by a plain Node test. The repo's way round that is a small file with no Electron import, tested on its own: see `desktop/src/finish.ts` with `desktop/test/finish.test.ts`, and `desktop/src/material.ts` with `desktop/test/material.test.ts`.
- A tiny signed app for tests is built like this in `engine/test/updates.test.ts:125-133`:

  ```ts
  function miniApp(dir: string, version: string) {
    const app = join(dir, "Liner Code.app");
    mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
    copyFileSync("/usr/bin/true", join(app, "Contents/MacOS/Liner Code"));
    writeFileSync(join(app, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>app.liner.code</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleExecutable</key><string>Liner Code</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`);
    execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "ignore" });
    return app;
  }
  ```

Conventions: TypeScript run directly by Node 24 (imports end in `.ts`). Long hand-formatted lines; never run a formatter. Comments are plain sentences that say why. Tests are `node:test`, sentence names, a block comment at the top of the file.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck -w desktop` | exit 0 |
| The new tests | `node --test desktop/test/signed.test.ts` | all pass |
| All desktop tests | `npm test -w desktop` | all pass |

## Scope

**In scope**:
- `desktop/src/signed.ts` (create)
- `desktop/test/signed.test.ts` (create)
- `desktop/src/update.ts` (`staged` only)

**Out of scope**:
- `engine/src/updates.ts`: the engine's check stays as it is.
- The swap script (`SCRIPT` in `update.ts`), including its `xattr` line.
- `desktop/src/main.ts`.
- Any new signing key or release format: that is a separate decision for the owner.

## Git workflow

- Stay on `design-and-api-endpoints`. One commit for this plan, a plain sentence (example from `git log`: `A Reviewer block reads as one, without a question's amber`). Do not push.

## Steps

### Step 1: Write the failing tests

Create `desktop/test/signed.test.ts`:

```ts
/*
  The check the shell makes on a waiting update right before it swaps it in (desktop/src/signed.ts): its code signature must
  hold, and when this copy is signed by a developer the update must be signed by the same one. Run with
  `node --test desktop/test/signed.test.ts`.
*/
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { signedAsOurs, teamIn } from "../src/signed.ts";
```

Add a local `miniApp(dir, version)` helper copied from the excerpt above, and these tests (the two that run `codesign` take `{ skip: process.platform !== "darwin" }`):

1. `"a Team ID is read from codesign's words; ad hoc and unsigned have none"`:
   `teamIn("Authority=Developer ID Application: Lin (AB12CD34EF)\nTeamIdentifier=AB12CD34EF\n")` → `"AB12CD34EF"`; `teamIn("Signature=adhoc\nTeamIdentifier=not set\n")` → `undefined`; `teamIn("code object is not signed at all")` → `undefined`.
2. `"an update whose signature holds may go in, for a copy with no developer of its own"`: two `miniApp`s in two temp folders; `signedAsOurs(update, running)` → `true`.
3. `"an update changed after it was signed is refused"`: build a `miniApp`, then `writeFileSync(join(app, "Contents/MacOS/Liner Code"), "#!/bin/sh\n")` to change it after signing; `signedAsOurs(app, running)` → `false`.
4. `"a folder that isn't a signed app is refused"`: `signedAsOurs(mkdtempSync(...), running)` → `false`.

**Verify**: `node --test desktop/test/signed.test.ts` → FAILS (the module does not exist yet).

### Step 2: Create the check

Create `desktop/src/signed.ts`:

```ts
/*
  The shell's own look at a waiting update, right before the swap: the engine checked the download when it came, but the swap
  can be days later, and whatever can write in Liner Code's folder could have put another bundle there meanwhile. No Electron
  here, so it can be tested alone (desktop/test/signed.test.ts). The engine's check is engine/src/updates.ts verify.
*/
import { spawnSync } from "node:child_process";

/** The Team ID in `codesign -dv --verbose=2`'s words, or nothing for an ad-hoc or unsigned bundle. */
export function teamIn(out: string) {
  const id = /^TeamIdentifier=(.+)$/m.exec(out)?.[1]?.trim();
  return id && id !== "not set" ? id : undefined;
}

const teamOf = (app: string) => teamIn(spawnSync("codesign", ["-dv", "--verbose=2", app], { encoding: "utf8", timeout: 60_000 }).stderr ?? "");

/**
  Whether `update` may take `running`'s place: its signature holds (nothing in it changed since it was signed), and when the
  running copy is signed by a developer, the update is signed by the same one. An ad-hoc copy has no developer to hold it to.
*/
export function signedAsOurs(update: string, running: string) {
  const sig = spawnSync("codesign", ["--verify", "--deep", "--strict", update], { stdio: "ignore", timeout: 120_000 });
  if (sig.status !== 0) return false;
  const mine = teamOf(running);
  return !mine || teamOf(update) === mine;
}
```

**Verify**: `node --test desktop/test/signed.test.ts` → all pass.

### Step 3: Use it in `staged`

In `desktop/src/update.ts`:

1. Add `import { signedAsOurs } from "./signed.ts";`.
2. In `staged`, after the `if (id !== BUNDLE_ID) return null;` line, add:

   ```ts
       // Checked again here, not only when it was downloaded: the swap can come days later, and it puts this in the app's place.
       if (!signedAsOurs(path, bundle)) return null;
   ```
3. Update the file's header comment: change "this checks it again (where it is, its bundle id, that it's newer)" to "this checks it again (where it is, its bundle id, that it's newer, and that its signature still holds: signed.ts)".

**Verify**: `npm run typecheck -w desktop` → exit 0; `grep -c "signedAsOurs" desktop/src/update.ts` → `2`.

### Step 4: Full check

**Verify**: `npm test -w desktop` → all pass; `node desktop/build.ts` → exit 0 (the shell still bundles).

## Test plan

`desktop/test/signed.test.ts`, four tests (Step 1): the Team ID parser, a good ad-hoc update accepted, a tampered one refused, a non-app refused. The Team ID mismatch itself cannot be tested without two Developer IDs; the parser test covers its reading.

## Done criteria

- [ ] `npm run typecheck -w desktop` exits 0
- [ ] `node --test desktop/test/signed.test.ts` passes
- [ ] `npm test -w desktop` passes
- [ ] `grep -c "signedAsOurs" desktop/src/update.ts` → `2`
- [ ] `git status --short` shows no modified file outside the three in scope
- [ ] `plans/README.md` status row updated, with "the real swap was not run" noted

## STOP conditions

- `desktop/build.ts` fails to bundle after the new import (for example it does not accept the `.ts` import path the other files use; then copy the import style `update.ts` already uses for local files).
- `staged` is called somewhere it must answer quickly and often (a timer, a render), not only at quit or restart. `codesign --verify --deep` on the real app takes a few seconds.
- The tampered-app test passes `signedAsOurs` as true on this machine.

## Maintenance notes

- `staged()` now takes a few seconds on the real bundle, at quit or restart only. If it is ever called from a place that must be instant, cache its answer.
- Not run: a real update swap in the packaged app. The owner's release rehearsal (a fake GitHub serving the next version) should be repeated once after this lands.
- Known and left alone: an ad-hoc copy still accepts any release published in the repo, because the checksum comes from the same release. Closing that needs either the Developer ID or a signing key built into the app; it is listed in `plans/README.md` as the owner's decision.
