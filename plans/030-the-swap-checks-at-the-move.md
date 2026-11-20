# 030. The swap script checks the update's signature itself, right before it moves it in

**Commit message:** `The update's signature is checked again inside the swap, right before the new copy moves in`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Finding: SEC-02 (MED confidence — the race is read from the code; exploiting it needs a same-user writer). Every
excerpt below is from the advisor's own read.

## Why this matters

Plan 010 built the re-verification before the swap: `install()` calls `staged()` → `waiting()` → `whyNot()` →
`signedAsOurs()` (`desktop/src/update.ts:53-61`, `desktop/src/signed.ts:23-28,62-76`). But the check runs BEFORE the
waiter script starts, and the script (`update.ts:32-50`) then waits up to 60 s for the app to exit and only then moves
the bundle into place:

```bash
for _ in $(seq 1 600); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
kill -0 "$pid" 2>/dev/null && exit 1
old="$(dirname "$dest")/.Liner Code (replaced $$).app"
if ! err="$(mv "$dest" "$old" 2>&1)"; then fail "$err"; fi
if ! err="$(mv "$new" "$dest" 2>&1)"; then mv "$old" "$dest"; fail "$err"; fi
rm -rf "$old" "$ready"
xattr -dr com.apple.quarantine "$dest" 2>/dev/null
```

A same-user process with write access to `~/.liner-code/updates` (attacker profile 1 in SECURITY_MODEL.md) can replace
the verified bundle during the verify→exit→mv window, and the swap installs the replacement as the app. The script
also strips quarantine, so Gatekeeper's first-launch assessment never runs on what was swapped in.
`SECURITY_MODEL.md:20` says the shell checks "again right before it swaps the bundle in" — today it checks right
before it STARTS THE WAITER, which is not the same moment.

## Current state (drift check)

```bash
git log --oneline -1                          # bfb0ebc or later
sed -n '32,62p' desktop/src/update.ts         # SCRIPT and install()
sed -n '11,28p;62,76p' desktop/src/signed.ts  # teamIn, signedAsOurs, whyNot
cat desktop/test/signed.test.ts | head -30    # the no-Electron test pattern
```

## Rules

- Never run a formatter; do not re-wrap or re-indent unchanged lines. Comments are plain sentences that say why.
- Do not touch `ui/src/liner/**`, Routines, `mac/`, the Demo provider, `CHANGELOG.md`, the untracked folders.
- Every fix comes with a test that fails without it, written first. The desktop suite tests pure modules without
  Electron (`desktop/test/signed.test.ts` — signed.ts's own header says "No Electron here, so it can be tested
  alone"). Follow that: the script moves to a pure module. Test commands need
  `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`.
- One local commit, the message above. Never push.
- The real swap rehearsal (a signed release replacing a signed copy) is the owner's, as plan 010 recorded. This plan
  tests the refusal paths and the ordering; it does not claim a real swap was run.

## Steps

### 1. Extract the script into a pure, testable module

Create `desktop/src/swap-script.ts` (no Electron imports):
- Export `swapScript(opts: { team: string | undefined }): string` returning the bash script, parameterised by the
  RUNNING copy's Team ID (empty/undefined for an ad-hoc copy — the same rule signedAsOurs uses: no developer to hold
  it to). Keep the existing positional args ($1 pid, $2 new, $3 dest, $4 ready, $5 reopen, --env pairs) so
  install()'s spawn stays compatible; the team goes in as $6 (shift 6).
- Move the SCRIPT verbatim from update.ts, then add the re-verification IMMEDIATELY BEFORE the first mv:

```bash
# Checked again here, right before the move: the wait can be long, and whatever can write in Liner Code's folder
# could have put another bundle in the waiting one's place since the shell looked (signed.ts).
if ! codesign --verify --deep --strict "$new" 2>/dev/null; then fail "Its signature no longer holds."; fi
if [ -n "$team" ]; then
  got="$(codesign -dv --verbose=2 "$new" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
  [ "$got" = "$team" ] || fail "It isn't signed by whoever signed this copy."
fi
id="$(plutil -extract CFBundleIdentifier raw -o - "$new/Contents/Info.plist" 2>/dev/null)"
[ "$id" = "app.liner.code" ] || fail "It isn't Liner Code: its bundle id is different."
```

  (Read the bundle id constant from contracts — `APP_BUNDLE_ID` — and inject it into the script string at build time
  in the module, not a hard-coded literal; signed.ts already imports it.)
- `fail()` stays as it is: it writes swap-failed.txt beside ready.json and reopens the OLD copy (which is still in
  place — the mv has not happened), so the engine says why once at next launch (the existing readRefused path).
- The residual window between this check and the mv is milliseconds; a truly atomic verify-and-move is not possible
  with codesign on a live filesystem. Comment that honestly; do not claim the race is closed to zero.

### 2. install() passes the running copy's Team ID

In `desktop/src/signed.ts`, export the team reader (the private `teamOf` at :17): `export const teamOfBundle = (app: string) => teamIn(spawnSync("codesign", ["-dv", "--verbose=2", app], …).stderr ?? "");`
In `desktop/src/update.ts`:
- Import `swapScript` from `./swap-script.ts` and `teamOfBundle` from `./signed.ts`; delete the inline SCRIPT.
- In `install()`, after `staged()` succeeds: `const team = teamOfBundle(s.bundle);` and write
  `swapScript({ team })` to the temp script; pass `team ?? ""` as the sixth positional arg before the --env pairs.
- Keep everything else (the staged refusal, the temp script's mode, the detached spawn, the LINER_ env pairs).

### 3. Update the threat model's wording

`SECURITY_MODEL.md:20`: the sentence "The shell checks the bundle id and the signature again right before it swaps
the bundle in" becomes true in substance — extend it one clause: the check runs inside the swap script itself, right
before the move, so a bundle replaced during the wait is refused. Keep the rest of the bullet (the ad-hoc acceptance
is the owner's open item — do not change that sentence). This is the "docs kept true" rule (CLAUDE.md).

### 4. Tests

`desktop/test/swap-script.test.ts` (no Electron; the signed.test.ts pattern):
- "a waiting bundle whose signature doesn't hold is refused by the script itself, before any move": temp dir with a
  fake `new` bundle (a plain directory with a Contents/Info.plist carrying the right bundle id — codesign --verify
  FAILS on it), a fake `dest` (a marker directory), a `ready` file, pid = a nonexistent pid (the wait loop breaks at
  once), reopen = 0. Run the script with bash; assert: exit 1, swap-failed.txt holds the signature words, `dest` is
  UNTOUCHED (the marker still there), `new` still in place. Before the fix (the old script) the mv happens — see it
  fail. (Run the OLD script in the test's first assertion to pin the bug, then the new one.)
- "a bundle id that isn't Liner Code's is refused": a fake bundle that passes… codesign can't be made to pass on a
  fake — so this case is pinned structurally: assert the script string checks the id BEFORE the mv line, and the
  team check precedes the mv. (A real signed-bundle success path needs the owner's rehearsal; say so.)
- "the team check is present only when the running copy has a team": swapScript({team: undefined}) has no
  TeamIdentifier comparison; swapScript({team: "ABCDE12345"}) compares against it.
- "the verification precedes the move": indexOf the codesign line < indexOf the first `mv "` line in the script.
- install()'s wiring: source-pin that update.ts passes the team arg (update.ts imports Electron; read it as text).

**Verify:** `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test desktop/test/swap-script.test.ts` and the
existing signed tests pass; `npm run typecheck -w desktop` exits 0; `node desktop/build.ts` exits 0.

## Done

- The refusal test fails against the old script and passes against the new; the ordering/team tests pass; the
  existing desktop suite passes; typecheck and shell build exit 0.
- SECURITY_MODEL.md's wording matches the code.
- One commit, the message above. Executor note: commit, the residual-window honesty, the real-swap rehearsal owed
  (two signed copies, as plan 010 recorded), any STOP.

## STOP conditions

- codesign/plutil behave differently on the test machine (a CI runner without Xcode tools): the refusal test still
  works (codesign failing is the point); if codesign is ABSENT, the script's check fails closed (refuses) — pin that
  too, and report.
- The script's arg shift breaks the --env pairs handling: stop, report — the test copy's LINER_HOME return path must
  keep working (the existing comment at update.ts:35).
- Any change would weaken the ad-hoc acceptance rule (an ad-hoc copy has no team to hold to — that is the owner's
  decided baseline, not this plan's to change).

## Maintenance note

The swap's integrity now has three looks: the engine at download, the shell at install, the script at the move. A
change to any check updates the other two's comments; the ordering test is the tripwire. When Windows gains an
updater (SECURITY_MODEL's open question), it needs the same three looks with its own signing tooling.
