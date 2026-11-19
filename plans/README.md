# Fix plans from the audit of 19 November 2026

Written by the advisor session on 2026-11-19 against commit `6970155` (branch `design-and-api-endpoints`, Liner Code 0.2.9).
Each plan stands alone: it holds the facts, the code as it is today, the steps, a check after every step, and when to stop.
The advisor changed no code. When the plans are done, the advisor audits the work against them.

To hand this to another model, send it `plans/PROMPT.md`.

## Execution order and status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| [001](001-docs-say-what-the-app-does.md) | The README, BACKEND.md and SECURITY_MODEL.md say what 0.2.9 really does | P1 | S | — | DONE |
| [002](002-release-gate-and-ci.md) | A release can't be built from code that fails its checks; the checks run on a fresh clone | P1 | M | — | DONE |
| [003](003-memory-and-reviewer-prompt.md) | Text an agent wrote can't steer later sessions or the Reviewer's allow | P1 | S | — | DONE |
| [004](004-session-key-in-a-file.md) | A session's key to Liner Code's tools is in no environment or command line | P1 | M | — | DONE |
| [005](005-stop-and-stopped-turn-bugs.md) | A sidekick that ignores Stop is given up; a stopped "Make it an app" isn't installed; a quiet read survives a deleted session | P1 | M | — | DONE |
| [006](006-quit-does-not-wait-on-old-questions.md) | Quitting no longer waits on a question whose turn is over | P2 | S | — | DONE |
| [007](007-ui-work-is-not-lost.md) | Drafts, hand edits and a half-written line comment aren't lost | P1 | M | — | DONE |
| [008](008-one-definition-of-session-state.md) | Every face reads a session's state from one tested file | P2 | M | 007 | DONE |
| [009](009-pin-access-and-updater-checks.md) | Tests pin Codex's access table, the proxy's WebSocket check, the updater's refusals, rewind's refusal, open-with | P1 | M | — | DONE |
| [010](010-check-the-update-before-the-swap.md) | The app checks a waiting update's signature again before the swap | P2 | S | — | DONE |
| [011](011-engine-answers-only-its-own-callers.md) | The engine checks the caller before reading a request, and answers only to its own address | P2 | S | — | BLOCKED |
| [012](012-less-work-on-fork-and-in-the-background.md) | Less work on a fork, on the other faces, and in a hidden window | P3 | S | — | DONE |
| [013](013-house-rules-and-a-safe-sync.md) | A CLAUDE.md with the house rules, and a Liner UI sync that shows its changes first | P2 | S | 002 | TODO |
| [014](014-small-engine-fixes.md) | One fix session per finding, a cancellable outside wait, export makes its folder | P3 | S | — | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale)

When you finish a plan, set its status and add one line under "Executor notes" below: the commit, anything you could not verify, and any STOP you hit.

## Dependency notes

- **009 before any later change to `engine/src/providers/codex-server.ts`**: it pins the access table, so a slip there shows up.
- **007 before 008**: both edit `ui/src/app/Session.tsx`; 008 expects 007's version.
- **002 before 013**: 013's `CLAUDE.md` names the commands 002 puts in the release script.
- **004 and 005 change how real tools are started and stopped.** Their tests use fakes. They are not done until the owner has run the real tools (Claude Code, Codex, OpenCode) once.
- Plans 003, 004, 005, 009, 011 and 014 all touch `engine/`. They do not edit the same functions, but run them one at a time, not in parallel.

## Rules that hold for every plan

- **Never run a formatter** (prettier, `eslint --fix`). The code is formatted by hand with long lines. Do not re-wrap or re-indent lines you did not change.
- **A bug fix comes with a test that fails without it**, written first. Tests are `node:test`; names are full sentences.
- **Do not touch**: `ui/src/liner/**` (a copy of another library), Routines (switched off behind `ROUTINES_ON`), `mac/` (an old Swift shell), the Demo provider, `CHANGELOG.md`, and the untracked folders `.taste-skill/`, `ads/`, `docs/demo/`, `site-next/`.
- **Stay on the current branch.** One commit per plan, a plain sentence about what is now true. Never push.
- **Honour each plan's STOP conditions.** A stopped plan with a clear report is a good result; an improvised fix is not.
- Reliable test command for the engine: `npm run test:steady -w engine` (about 11 minutes). `npm test -w engine` is faster, but one timing test ("Stop is decisive…" in `antigravity.test.ts`) can fail on a busy machine; that failure alone is not yours.

## Decisions the advisor made that the owner should confirm

1. **Plan 006**: a question holds a quit only while its turn is still running. An old open question no longer triggers the ⌘Q dialog or keeps "Quit when it finishes" waiting.
2. **Plan 003**: `memory_add` is refused in a session that only reads (Read only, a side chat). No card was added for saving a fact in other sessions.
3. **Plan 002**: `npm run release` refuses a tree with uncommitted changes and a version with no `CHANGELOG.md` entry, and runs about 12 minutes of checks. `LINER_SKIP_CHECKS=1` skips all three.
4. **Plan 002**: a GitHub Actions workflow is added. It runs on GitHub's macOS runners once pushed, and it is unverified until then.
5. **Plan 008**: only the Reviewer-block rule is unified. The Wall still shows a finished, unread session as done while the sidebar and Dock count it under Needs you.
6. **Every plan**: one local commit per plan. If you would rather review uncommitted work, change that line in `PROMPT.md` before sending it.

## Not planned, and why

These came out of the same audit. Each needs something a plan for another model cannot supply.

| Finding | Why it has no plan |
|---|---|
| About 20 git processes per turn for snapshots, and up to 120 `git show` runs per diff card | Not measured. Measure on a large repository first; the fix touches the code that protects undo. |
| The plugin sandbox starts from allow-everything with a deny list | Tightening it can break plugins, and the owner's rule is to keep matching DeepSeek Harness behaviour. Needs a decision and a real plugin to test with. |
| A plugin's answers are served on the engine's own origin without a sandbox policy | Needs the shell's navigation guard moved somewhere testable first, and a real plugin. |
| An ad-hoc build accepts any release published in the repo | Closed by the Developer ID, or by a signing key built into the app. The owner's decision; plan 001 corrects the doc meanwhile. |
| Whether a given-up Codex leaves its commands running; whether closing one ACP session ends a daemon another shares | Only the real CLIs can answer. |
| The fork copies its parent's timeline one item at a time | Needs a new store method; do it with the next change to `store.ts`. |
| `rpc()` in the app has no time limit; about 76 places toast "The engine isn't answering" beside the Reconnecting pill | A mechanical sweep by hand across the UI; better done after plan 008, with eyes on the running app. |
| The hover note screen readers can't reach; the Security Overview staying blank when a second call fails | Small, but need to be seen on screen. |
| Record which CLI versions were tested, and warn on a newer one | A product decision (warn or block), tied to the direction option "re-prove access levels when a tool updates". |
| README copy for Liner Security and Liner Design; new screenshots | The owner's voice. |

## Findings considered and rejected

- **`npm audit`'s 5 moderate advisories** (hono through the Agent SDK's MCP library; glob and minimatch through the packager): the app does not load those packages at run time. Bump them when the SDK or packager is next bumped.
- **Renaming and splitting the dated test files** (`polish-*.test.ts`, `audit-*.test.ts`): do it when a file is next touched; a sweep costs git blame for no measured gain.
- **A shared query hook for every engine read, and splitting `api.ts` or `acp.ts`**: worth doing only when builders next collide on those files.
- **The lean file's unchecked path fallback** (`engine/src/lean.ts` `safePath`): not reachable at the write site, which checks the path first.
- **An indented task list never offered as a split** (`engine/src/precheck.ts`): the check is conservative on purpose; failing to offer costs nothing.
- **A type-aware lint**: useful, but it needs a baseline of existing hits and a decision on rules; not a fix.

## What the audit did not look at

Routines (switched off), the website and ads, the Swift shell in `mac/`, the inside of the Liner UI copy, `Settings.tsx`. Nothing was run on the real tools or on Windows, and no timings were taken.

## Executor notes

(One line per finished plan: commit, what was not verified, any STOP.)

- **001** DONE — docs only; commit “The docs say what 0.2.9 really does”. Every step grep and the table-balance check passed; nothing needed a real tool or a screen. No STOP.
- **002** DONE — commit “A release can't be built from code that fails its checks, and a fresh clone passes them”. Engine 1392/1392 and desktop 35/35 pass, typecheck green, lock now 0.2.9. The CI workflow (.github/workflows/check.yml) is unverified until the owner pushes it. No STOP.
- **003** DONE — commit “Text an agent wrote can't steer later sessions or the Reviewer's allow”. The 3 new tests fail before and pass after; memory/access/reviewer/audit-review/grants 88/88, engine typecheck green. Not verified on the real CLIs (fakes only); the owner's real-tool check should include one Reviewer-decides step. No STOP.
- **004** DONE — commit “A session's key to Liner Code's tools is in a file of the user's own, not in any environment or command line”. Focused tests 236/236; full suite 1395/1396, the only failure the documented “Stop is decisive” timing flake (passes in isolation). Needs the owner's real-tool run (Claude Code, Codex, OpenCode). One in-scope deviation: serverFor guards store.home as the constructor does, falling back to a temp dir for a home-less stand-in store (engine.test.ts, which the plan didn't list) so it can't crash. No STOP.
- **005** DONE — commit “A sidekick that ignores Stop is given up, a stopped “Make it an app” isn't installed, and a quiet read survives a deleted session”. The 3 new tests fail before and pass after; the 8 named files 141/141, engine typecheck green. Not verified on the real CLIs (fakes only); the owner's real-tool check should include stopping a pair mid-brief. No STOP.
- **006** DONE — commit “Quitting no longer waits on a question whose turn is over”. New test fails before, passes after; finish 12/12, desktop typecheck green, full desktop 36/36. Not verified on screen (⌘Q and “Quit when it finishes” with a real open question); this is the advisor's behaviour decision for the owner to confirm. No STOP.
- **007** DONE — commit “Drafts, hand edits and a half-written line comment aren't lost in the interface”. UI + full typecheck and production build green; greps pass. No UI tests exist, so all six changes are NOT seen on screen — the owner should try each once (separate drafts, Send-to-code keeps held edits on failure, bottom Terminal reloads, script keys wait over ⌘K, text kept while a send reads files, line comment survives a new turn). No STOP.
- **008** DONE — commit “Every face reads a session's state from one tested file, so a Reviewer block means the same everywhere”. Moved the state rules into ui/src/app/session-state.ts (+sideStateOf); 5 new Node tests pass (the wallKind Reviewer-block one failed before the fix); typecheck + build green. Not seen on screen (a Reviewer-blocked session on the Wall, menu bar item, Design rows). Session's Announcer had only copied primitives, so held is plumbed as a prop (2 lines) and the branch reads held !== "review". The Wall's finished-unread-as-done product question is left as-is. No STOP.
- **009** DONE — commit “Tests pin Codex's access table, the proxy's WebSocket check, the updater's refusals, rewind's refusal and the open-with list”. 7 characterization tests added (Codex table, proxy upgrade, 3 updater refusals, rewind-committed, open-with); all pass, engine typecheck green, no engine/src touched. The Codex table test was proven to fail when a WANT value is mutated. Still unpinned: updater Team ID (needs two Developer IDs), the swap script, rewind's other-session refusal, Electron main guards. No STOP.
- **010** DONE — commit “The app checks a waiting update's signature again before it swaps it in”. New desktop/src/signed.ts (no Electron) + 4 tests pass; staged re-verifies the signature (and the signer when this copy has one); desktop typecheck green, full desktop 40/40, shell bundles. The real swap was NOT run; the Team ID mismatch can't be tested without two Developer IDs (the parser is). An ad-hoc copy still accepts any release published in the repo (owner's decision). No STOP.
- **011** BLOCKED — the plan's own STOP: the new Host check answers 403 to the pre-existing test “server: a webhook that throws is answered, not left hanging” (engine/test/audit-api.test.ts:87), which posts to /hooks/r/abc with a bare `Host: x` and expects 500. That test is out of scope; the plan says not to widen the rule or bend the test. Reverted server.ts/main.ts/engine.test.ts (tree type-checks, suite green again). The key-before-body half was verified working before the revert. Needs the advisor/owner to decide: give that test a real Host, or exempt the switched-off /hooks route from the Host check.
- **012** DONE — commit “A fork keeps its snapshots in one git call, the other faces stop redrawing on every session event, and hidden windows stop polling”. keep batched (new test pins it, checkpoints 16/16); Design/Security shells memoised with stable props; Browser/Pr timers gated on visibility; typecheck + build green. Not measured, not seen on screen. Note: the plan's Done-criteria grep `onSidebar={() =>` → 0 can't reach 0 — 7 other faces (Wall, RoutinesPage, Compare, Usage, AddonsPage, …) are out of scope and Routines is do-not-touch; only the two named shell lines were changed. No STOP.
