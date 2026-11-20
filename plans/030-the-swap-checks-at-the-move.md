# 030. The swap script checks the update's signature itself, right before it moves it in

**Commit message:** `The update's signature is checked again inside the swap, right before the new copy moves in`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Refreshed 2026-11-20 at 13c7757 after the advisor's review. `desktop/src/update.ts`, `desktop/src/signed.ts`,
`engine/src/updates.ts` and `SECURITY_MODEL.md` did not change between `bfb0ebc` and `13c7757`.
Finding: SEC-02 (MED confidence: the race is read from the code; exploiting it needs a same-user writer).

## What the review changed

- A refusal in the script now goes the way the shell's own refusal goes: it writes `refused.json` and removes the
  bundle and `ready.json`, like `signed.ts` `refuse()`, so the engine's `readRefused` drops it and a fresh copy can
  download. The old plan wrote `swap-failed.txt`. That file is read by `readSwap` (`engine/src/updates.ts:256-275`),
  which marks the version "stuck", never retries it, and tells you to drag it in from the release page.
- Real behaviour tests with an ad-hoc signed bundle: `desktop/test/signed.test.ts:15-22` (`miniApp`) already signs
  one with `codesign --sign -`. The old plan said codesign could not pass on a fake. Tampered, wrong id, wrong team
  and the good path are all run for real. The old script was seen moving a tampered bundle in at 13c7757.
- The running copy's Team ID goes in only as `$6`; the script text no longer depends on it.
- The remaining window is stated honestly: about as long as the deep verify (0.45 s for the installed app on this
  Mac, cache warm), not "milliseconds".
- The signed-swap rehearsal (two Developer ID copies) stays the owner's gate, as plan 010 recorded.

## Why this matters

Plan 010 built the re-verification before the swap: `install()` calls `staged()` → `waiting()` → `whyNot()` →
`signedAsOurs()` (`desktop/src/update.ts:24-30,53-62`, `desktop/src/signed.ts:23-28,62-76`). But the check runs BEFORE
the waiter script starts, and the script (`update.ts:32-50`) then waits up to 60 s for the app to exit and only then
moves the bundle into place:

```bash
for _ in $(seq 1 600); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
# Still running after a minute: leave everything as it is.
kill -0 "$pid" 2>/dev/null && exit 1
old="$(dirname "$dest")/.Liner Code (replaced $$).app"
if ! err="$(mv "$dest" "$old" 2>&1)"; then fail "$err"; fi
if ! err="$(mv "$new" "$dest" 2>&1)"; then mv "$old" "$dest"; fail "$err"; fi
rm -rf "$old" "$ready"
xattr -dr com.apple.quarantine "$dest" 2>/dev/null
```

A same-user process with write access to `~/.liner-code/updates` (attacker profile 1 in SECURITY_MODEL.md) can replace
the verified bundle during the verify→exit→mv window, and the swap installs the replacement as the app. The script
also strips quarantine. `SECURITY_MODEL.md:20` says the shell checks "again right before it swaps the bundle in";
today the check runs right before it STARTS THE WAITER, which is not the same moment.

What this plan can and cannot do: `codesign` and `plutil` are in every macOS (`/usr/bin`), so the script can check
right before the move. It cannot close the race to zero. `codesign --verify --deep` reads the bundle file by file,
so a file it has already hashed can be changed while it reads the rest. A same-user writer can also change the app
after it lands. The check narrows the window from the whole wait (up to a minute, plus however long you take to
quit) to the length of the verification. The two `mv`s stay as they are (no more and no less atomic than today).

## Current state (drift check)

```bash
git log --oneline -1                          # 13c7757 or later
sed -n '24,62p' desktop/src/update.ts         # staged, SCRIPT and install()
sed -n '11,28p;62,85p' desktop/src/signed.ts  # teamIn, teamOf, signedAsOurs, whyNot, refuse
sed -n '15,22p' desktop/test/signed.test.ts   # miniApp: an ad-hoc signed Liner Code.app for tests
sed -n '236,300p' engine/src/updates.ts       # readSwap (swap-failed.txt) and readRefused (refused.json)
sed -n '20,20p' SECURITY_MODEL.md             # the sentence step 3 extends
```

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first. The desktop suite tests pure modules without
  Electron (`signed.ts`'s header: "No Electron here, so it can be tested alone"). Follow that: the script moves to a
  pure module. Test commands need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push.
- The real swap rehearsal (a Developer ID signed release replacing a Developer ID signed copy) is the owner's, as
  plan 010 recorded. This plan runs the script for real on ad-hoc signed bundles; it does not claim a signed swap was
  run.

## Steps

### 1. Move the script into a pure module, unchanged, then see the tests fail against it

Create `desktop/src/swap-script.ts` (no Electron imports) exporting `SWAP_SCRIPT: string`, the text of `update.ts`'s
`SCRIPT` moved verbatim (same escapes). `update.ts` imports it and deletes its own copy. No behaviour change yet.
Write the tests of step 4 now and run them: the refusal cases fail (the tampered bundle is moved in), the good case
passes.

### 2. The script checks right before the move, and a refusal is dropped as the shell drops one

In `desktop/src/swap-script.ts`:
- Arguments: `pid="$1"; new="$2"; dest="$3"; ready="$4"; reopen="$5"; team="$6"; shift 6`. What's left is still the
  `--env NAME=VALUE` pairs (`envs=("$@")`), so a test copy's `LINER_HOME` comes back as itself.
- After the wait (after the `kill -0 … && exit 1` line) and BEFORE `old=…` and the first `mv`, add:

```bash
# Checked again here, right before the move: the wait can be long, and whatever can write in Liner Code's folder
# could have put another bundle in the waiting one's place since the shell looked (signed.ts). It narrows that
# window to the check's own length; it can't close it, since codesign reads the bundle a file at a time.
refuse() {
  version="$(plutil -extract version raw -o - "$ready" 2>/dev/null | tr -cd '0-9A-Za-z.+-')"
  rm -rf "$new"; rm -f "$ready"
  # As signed.ts refuse(): the engine says why once (updates.ts readRefused), and the next download is a fresh one.
  printf '{"version":"%s","why":"%s","at":%s}\n' "$version" "$1" "$(($(date +%s) * 1000))" > "$(dirname "$ready")/refused.json"
  again; exit 1
}
id="$(plutil -extract CFBundleIdentifier raw -o - "$new/Contents/Info.plist" 2>/dev/null)"
[ "$id" = "${APP_BUNDLE_ID}" ] || refuse "It isn't Liner Code: its bundle id is different."
codesign --verify --deep --strict "$new" 2>/dev/null || refuse "Its signature no longer holds."
if [ -n "$team" ]; then
  got="$(codesign -dv --verbose=2 "$new" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
  [ "$got" = "$team" ] || refuse "It isn't signed by whoever signed this copy."
fi
```

  `${APP_BUNDLE_ID}` is filled in from `contracts`' `APP_BUNDLE_ID` when the module builds the string (a constant, not
  a value from outside; `signed.ts` already imports it). The why strings are the same as `signed.ts` `whyNot`'s.
  `plutil` reads JSON, so `ready.json`'s version comes out with `-extract version raw` (tried: it prints `0.3.1` for
  `{"version":"0.3.1"}`). The `tr` keeps the JSON well-formed whatever the file holds.
  Tried at 13c7757 in a scratch copy (the old script with exactly this added, run as step 4 runs it): a tampered
  bundle, a wrong bundle id and team `ABCDE12345` each exited 1 with `dest` untouched, the bundle and `ready.json`
  gone and `refused.json` holding `9.9.9` and the right why; a good ad-hoc bundle with team `""` moved in, exit 0.
- `fail()` and `swap-failed.txt` stay for what they were for: an `mv` that doesn't go through.
- An ad-hoc copy (no team, `$6` empty) skips the team comparison: the owner's decided baseline (signedAsOurs: "an
  ad-hoc copy has no developer to hold it to"). Do not change that.

### 3. install() passes the running copy's Team ID, and the threat model says where the check is

In `desktop/src/signed.ts`, export the team reader: rename the private `teamOf` (`:17`) to
`export const teamOfBundle` and update its use in `signedAsOurs`.
In `desktop/src/update.ts` `install()`, after `staged()` succeeds: `const team = teamOfBundle(s.bundle) ?? "";`,
write `SWAP_SCRIPT` to the temp script as now, and spawn with
`[script, String(process.pid), s.path, s.bundle, s.ready, reopen ? "1" : "0", team, ...env]`. Keep everything else
(the staged refusal, the script's mode, the detached spawn, the `LINER_` env pairs). Update the file's header
comment: the script checks the signature again right before the move.
`SECURITY_MODEL.md:20`: extend the sentence "The shell checks the bundle id and the signature again right before it
swaps the bundle in" by one clause: inside the swap script itself, after the app has quit and right before the move,
so a bundle replaced during the wait is refused. Keep the rest of the bullet; the ad-hoc acceptance is the owner's
open item.

### 4. Tests

`desktop/test/swap-script.test.ts` (no Electron; `{ skip: process.platform !== "darwin" }` on each case that runs
codesign, as `signed.test.ts` does). Reuse `miniApp` from `signed.test.ts`: copy it into the new file, or move it to
`desktop/test/mini-app.ts` and import it in both. Each case makes a temp `updates/` with `ready.json`
(`{"version":"9.9.9","app":"<path>"}`) and `Liner Code.app` from `miniApp`, a `dest` folder `apps/Liner Code.app`
holding a marker file, writes `SWAP_SCRIPT` to a file and runs
`bash <script> 999999 <new> <dest> <ready> 0 <team>` (pid 999999 is not running, so the wait ends at once; reopen 0
opens nothing).
- "the swap refuses a waiting bundle changed after it was signed, before anything moves": after `miniApp`, write one
  more file into `Contents/MacOS`. Expect exit 1; `dest` still holds its marker; the waiting bundle and `ready.json`
  are gone; `updates/refused.json` parses, with `version` `9.9.9` and a `why` naming the signature; no
  `swap-failed.txt`. Seen failing at 13c7757: the old script, run this way on a tampered ad-hoc bundle, exited 0
  and replaced `dest`.
- "the swap refuses a bundle that isn't Liner Code": `miniApp` with another `CFBundleIdentifier` (give `miniApp` an
  id parameter), signed properly. Expect the same refusal shape with the bundle-id words.
- "the swap refuses a bundle signed by someone other than this copy's developer": a good `miniApp`, team argument
  `ABCDE12345` (an ad-hoc bundle has no team). Expect the refusal with the team words.
- "the swap moves a waiting bundle that checks out in, and an ad-hoc copy holds it to no developer": a good
  `miniApp`, team `""`. Expect exit 0; `dest/Contents/Info.plist` is the new one; the marker and the aside copy are
  gone; `ready.json` gone; no `refused.json`. (This passes before the fix too: it guards the good path.)
- "the swap still takes --env pairs after the team": the script text contains `team="$6"; shift 6`, and a run with
  `--env LINER_HOME=/x` after the team argument still refuses or moves as above (the pairs are only used by `open`,
  which reopen 0 skips).
- "install() hands the script the running copy's team": read `desktop/src/update.ts` as text (it imports Electron)
  and assert the spawn's arguments carry `team` right after the reopen flag.

**Verify:** `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test desktop/test/swap-script.test.ts desktop/test/signed.test.ts`;
`npm test -w desktop`; `npm run typecheck -w desktop` exits 0; `node desktop/build.ts` exits 0.

## Done

- The three refusal tests fail against the moved, unchanged script (step 1) and pass after step 2; the good-path and
  wiring tests pass; the desktop suite passes; typecheck and the shell build exit 0.
- SECURITY_MODEL.md's wording matches the code.
- One commit, the message above. Executor note: commit, the remaining window as stated above (as long as the deep
  verify), the real signed-swap rehearsal still owed by the owner (two Developer ID copies, as plan 010 recorded),
  any STOP.

## STOP conditions

- `codesign` or `plutil` is missing or behaves differently on the test machine: stop, report. Both are in `/usr/bin`
  on every macOS, and the checks as written fail closed (a missing `plutil` gives an empty id, a missing `codesign`
  a non-zero status: either refuses).
- The shift to `$6` breaks the `--env` pairs: stop, report. The test copy's `LINER_HOME` return path must keep working
  (the comment in the script's header).
- Any change would weaken the ad-hoc acceptance rule (an ad-hoc copy has no team to hold to: the owner's decided
  baseline, not this plan's to change).
- The engine's `readRefused` would not take the script's `refused.json` (read `engine/src/updates.ts:279-293`; it reads
  `version` and `why`): stop, report.

## Maintenance note

The swap's integrity now has three looks: the engine at download, the shell at install, the script at the move. They
share the same three why strings and the same refusal (`refused.json`, bundle and `ready.json` removed). A change to
any check updates the other two; the swap-script tests are the tripwire. When Windows gains an updater
(SECURITY_MODEL's open question), it needs the same three looks with its own signing tooling.
