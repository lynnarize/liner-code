# Plan 001: The README, BACKEND.md and SECURITY_MODEL.md say what 0.2.9 really does

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6970155..HEAD -- README.md docs/BACKEND.md SECURITY_MODEL.md docs/CHANGELOG-next.md THIRD_PARTY_NOTICES.md`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live text before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `6970155`, 2026-11-19

## Why this matters

The public README says "no telemetry and no analytics", but since 0.2.9 the app sends one anonymous usage count a day, on by default. A user who sees that request in a firewall log will read the README as a lie. The same docs also describe a feature that was removed (the Desk), a Node version nobody tests, and security facts that changed. These files are what people and coding agents reason from, so they must match the code.

This plan changes documentation only. It changes no code.

## Current state

- `README.md:200` (inside the "Nothing in between" bullet):
  `your account. Liner Code has no server, no telemetry and no analytics. Besides its own releases from GitHub and`
- What the app really sends, from the header comment of `engine/src/usage-ping.ts:1-16`: once a day at most, one POST to `linercode.dev/api/usage` with a random install id, the app's version, the OS and chip, the day, and the tokens counted since the last one. No prompts, files, folders, projects, models, tools, sessions or errors. `Settings › General › Share anonymous usage counts` turns it off; `LINER_NO_USAGE=1` never sends.
- `README.md:97-101` is a feature tile for "The Desk" and `README.md:121-128` is a Desk screenshot. The Desk screen no longer exists (`ui/src/app/Desk.tsx` is gone).
  The feature grid is an HTML `<table>` with three `<td width="33%" valign="top">` cells per `<tr>`. Today the rows are: (Designs beside the session, Surfaces, The Desk) then (Models side by side, Workshop, an empty cell).
  The Screenshots table has two `<td width="50%">` cells per `<tr>`: (The Desk, Plans) then (Diffs, Pull requests).
- `README.md:61`: `<td align="center"><b>Cursor · Grok Build</b><br><sub>ACP, beta</sub></td>` (Antigravity CLI is also a built-in tool now; see the `antigravity` entry in `engine/src/providers/acp.ts`).
- `README.md:224`: `npm test             # the engine's tests (node:test)`. The root script is `npm test -w engine && npm test -w desktop`.
- `README.md:411`: `native/mac.mm            a Node-API addon: vibrancy or Liquid Glass behind the sidebar column only, the traffic lights' frames,`. The addon's own header (`desktop/native/mac.mm:1-6`) now says: the window see-through to the desktop, crisp or blurred (Background: Desktop), where the traffic lights sit, the trackpad's tap, and keeping Apple Intelligence's badge off the page's text fields.
- `docs/BACKEND.md:18-19`:
  `| macOS | 14 or newer; 26+ for Liquid Glass | the shell; older systems get vibrancy |`
  `| Node.js | 22.18 or newer (24 or 26 recommended) | runs the engine's TypeScript directly (type stripping) |`
  The root `package.json` says `"engines": { "node": ">=24" }`.
- `docs/BACKEND.md:6-8`: "Nothing about your code or sessions leaves the machine except what the agents themselves send to their model providers."
- `docs/BACKEND.md:87`: `(Gemini CLI, Goose, claude-code-acp, Cursor's ACP mode once it ships).`
- `docs/BACKEND.md:91-93`: "every request must carry the random token the shell generates at launch". Not true for every route: `SECURITY_MODEL.md:11-16` lists the routes with their own guard.
- `docs/BACKEND.md:95`: "hands them to the engine once, through its environment". The shell passes them over standard input (`desktop/src/engine.ts` sets `LINER_SECRETS: "stdin"`).
- `SECURITY_MODEL.md:3`: "version 0.2.5 beta".
- `SECURITY_MODEL.md:14`: `- /hooks/r/<id>?key=: a routine's webhook secret.` Routines are switched off in this version (`engine/src/main.ts:183`: `hooks: ROUTINES_ON ? … : undefined`).
- `SECURITY_MODEL.md:66`: "Panels get a sandboxed iframe with an opaque origin, a CSP, a Connection-Allowlist against WebRTC, and an engine-side access check".
- `SECURITY_MODEL.md:69`: "Updates are checked by SHA-256, bundle id, version, codesign and the same Team ID." In `engine/src/updates.ts:591-595` the Team ID check runs only when the running copy is signed by a developer; the expected SHA-256 comes from the same GitHub release as the download.
- `SECURITY_MODEL.md:77`: open question "Is Windows auto-update in place…". Answer from code (`engine/src/updates.ts:227`): a packaged Windows copy is `"manual"`; it does not update itself.
- `docs/CHANGELOG-next.md` is titled `## Next (not released)` but holds the 0.2.9 text that already shipped in `CHANGELOG.md:3`.
- `THIRD_PARTY_NOTICES.md:12-13` lists Instrument Sans and Geist Mono. `ui/package.json` also depends on `@fontsource-variable/inter` (`^5.3.0`), which is not listed.

Conventions: plain sentences, no marketing words, the same tone as the lines around each edit. Keep each file's existing line wrapping style (lines of roughly 100 characters). Do not run any formatter.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Find leftover claims | `grep -n "no telemetry" README.md` | no output |
| Show changed files | `git status --short` | only the five in-scope files (plus pre-existing untracked folders) |

## Scope

**In scope** (the only files you may modify):
- `README.md`
- `docs/BACKEND.md`
- `SECURITY_MODEL.md`
- `docs/CHANGELOG-next.md`
- `THIRD_PARTY_NOTICES.md`

**Out of scope** (do NOT touch):
- `CHANGELOG.md`: the website is built from it, and the owner decided the usage count stays out of it.
- Any source file, any image under `.github/readme/` (leave the Desk images on disk).
- New feature copy for Liner Security or Liner Design in the README: the owner writes product copy.
- `docs/ROADMAP.md` (private, gitignored).

## Git workflow

- Stay on the current branch (`design-and-api-endpoints`). Do not create branches, do not push.
- One commit for this plan. Message: one plain sentence saying what is now true, in the repo's style. Example from `git log`: `A Reviewer block reads as one, without a question's amber`.

## Steps

### Step 1: Correct the privacy sentence in the README

In `README.md:200`, replace the sentence `Liner Code has no server, no telemetry and no analytics.` with:

`Liner Code has no server in between and never sends your work anywhere. Once a day it sends an anonymous count to linercode.dev: a random install id, the app's version, your OS and chip, the day, and how many tokens your agents read and wrote. Never prompts, files, folders, projects, models, tools, sessions or errors. Settings › General › Share anonymous usage counts turns it off, and so does LINER_NO_USAGE=1.`

Re-wrap the paragraph to the same width as its neighbours. Keep the rest of the bullet.

**Verify**: `grep -c "no telemetry" README.md` → `0`; `grep -c "anonymous count" README.md` → `1`.

### Step 2: Remove the Desk from the README

1. Feature grid: delete the `<td>` block for "The Desk" (`README.md:97-101`). Move the "Models side by side" `<td>` block from the next `<tr>` into its place, so the first row is (Designs beside the session, Surfaces, Models side by side). The last row then holds Workshop first; add empty `<td width="33%" valign="top"></td>` cells so that row still has three cells.
2. Screenshots table: delete the Desk `<td width="50%">…</td>` block (`README.md:121-128`). Re-flow the three remaining cells in their existing order, two per row: (Plans, Diffs) then (Pull requests, an empty `<td width="50%"></td>`).

**Verify**: `grep -c "The Desk" README.md` → `0`; `grep -c "<tr>" README.md` equals `grep -c "</tr>" README.md`.

### Step 3: Small README corrections

1. `README.md:61`: change the cell's bold text to `Cursor · Grok Build · Antigravity`.
2. `README.md:224`: change the comment to `# the engine's and the desktop shell's tests (node:test)`.
3. `README.md:411`: replace `vibrancy or Liquid Glass behind the sidebar column only, the traffic lights' frames,` with `the window see-through to the desktop (clear or frosted), the traffic lights' frames,`.

**Verify**: `grep -c "Liquid Glass" README.md` → `0`; `grep -c "Antigravity" README.md` → at least `1`.

### Step 4: Correct docs/BACKEND.md

1. Line 18: `| macOS | 14 or newer | the shell |`.
2. Line 19: `| Node.js | 24 or newer | runs the engine's TypeScript directly (type stripping) |`.
3. After the sentence ending "…send to their model providers." (lines 6-8), add: `The one exception is an anonymous usage count the app sends once a day (see README, "Your accounts and your data"); Settings can turn it off.`
4. Line 87: remove the words ` once it ships`.
5. Lines 91-93: replace "every request must carry the random token the shell generates at launch (compared in constant time)" with "`/rpc` and `/events` must carry the random token the shell generates at launch (compared in constant time); the few other routes each have their own key or one-time token, listed in `SECURITY_MODEL.md`".
6. Line 95: replace "through its environment" with "over its standard input (never its environment, which other processes can read)".

**Verify**: `grep -c "22.18" docs/BACKEND.md` → `0`; `grep -c "through its environment" docs/BACKEND.md` → `0`.

### Step 5: Re-baseline SECURITY_MODEL.md

1. Line 3: `0.2.5 beta` → `0.2.9 beta`.
2. Line 14: append ` Routines are switched off in this version (ROUTINES_ON in contracts/src/index.ts), so no webhook is taken.` to the `/hooks/r/` bullet.
3. In "Entry points and who can reach them", add a bullet: `- Outbound: one anonymous usage count a day to linercode.dev (engine/src/usage-ping.ts): install id, version, OS and chip, day, token counts. Off with the Settings switch or LINER_NO_USAGE=1.`
4. Line 66: append ` The Connection-Allowlist header fails open: if an Electron upgrade stops honouring it, nothing blocks WebRTC from a panel, so desktop/test/panel-network.test.ts must pass (not skip) after every Electron upgrade.`
5. Line 69: append ` The Team ID check applies only once this copy is signed with a Developer ID; an ad-hoc copy takes the first signed release and is pinned from then on. The SHA-256 comes from the same release as the download, so it proves the download is whole, not who published it.`
6. Replace the first open question (line 77) with: `- Windows does not update itself yet: a packaged Windows copy only tells you a new version exists (engine/src/updates.ts). When it gains an updater it needs integrity checks equal to codesign and Team ID.`

**Verify**: `grep -c "0.2.5" SECURITY_MODEL.md` → `0`; `grep -c "usage count" SECURITY_MODEL.md` → `1`.

### Step 6: Empty docs/CHANGELOG-next.md

Replace the whole file with:

```markdown
## Next (not released)

Notes for the next release are collected here, then moved into `CHANGELOG.md` when it ships
(the website is built from `CHANGELOG.md`).

- A compact model picker, a blue dot for what finished, and rows that never touch.
- A Reviewer block reads as one, without a question's amber.
- The Browser's Desktop shows the page zoomed out in a narrow panel.
```

**Verify**: `wc -l < docs/CHANGELOG-next.md` → less than `12`.

### Step 7: Add Inter to the notices

In `THIRD_PARTY_NOTICES.md`, add a row after the Geist Mono row:

`| [Inter](https://github.com/rsms/inter) (via Fontsource) | 5.x | SIL Open Font License 1.1 | Text in the app |`

**Verify**: `grep -c "rsms/inter" THIRD_PARTY_NOTICES.md` → `1`.

## Test plan

No code changes, so no tests. Read the rendered README once (`git diff README.md`) to confirm both tables still have balanced rows.

## Done criteria

- [ ] `grep -c "no telemetry" README.md` → `0`
- [ ] `grep -c "The Desk" README.md` → `0`
- [ ] `grep -c "22.18" docs/BACKEND.md` → `0`
- [ ] `grep -c "0.2.5" SECURITY_MODEL.md` → `0`
- [ ] `git status --short` shows no modified file outside the five in scope
- [ ] `plans/README.md` status row updated

## STOP conditions

- A quoted line is not where "Current state" says it is, and you cannot find the same sentence nearby.
- Removing the Desk cells leaves a table you cannot balance by the rule in Step 2.
- You find yourself wanting to edit `CHANGELOG.md` or any source file.

## Maintenance notes

- Whenever the app gains or loses an outbound request, update README "Your accounts and your data" and `SECURITY_MODEL.md` together.
- Left for the owner on purpose: README copy for Liner Security and Liner Design, new screenshots, and the licence texts that the notices table only names.
