# Fix plans from the deep audit of 20 November 2026

Written by the advisor session on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Eight parallel read-only auditors (engine core, providers, features, security, performance, tests, UI polish/detail,
tech-debt/deps/DX/docs) plus the advisor's own direction pass produced **82 findings**; the advisor spot-vetted 23 of
them against the code (all held) and wrote the top ~55 into the sixteen plans below, clustered by theme. The full
findings files are in the advisor's scratch (`improve-audit/findings-*.md`); every plan inlines its own evidence.
The advisor changed no code. The previous run (001–014) is finished and its record is kept below, unchanged.

**L13 first:** the layout job's last plan (`plans/layout/L13-after-the-audit.md`) is carried out in the working tree
but uncommitted at this writing. Commit it (its own prompt: `plans/layout/PROMPT-L13.md`) before running the plans
here that share its files — 018, 020, 027 — or edit only the regions each plan names, as they instruct.

## Execution order and status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| [015](015-ci-goes-green.md) | CI goes green: the fifth flake tamed, the bundle built on every check | P1 | S | — | DONE — flake cure corrected in the review round (uncommitted) |
| [016](016-the-push-card-says-what-happened.md) | The push card says what happened; one stage at a time to a screen reader; "Look again" | P1 | S | — | DONE — screen-reader leaks and counts corrected in the review round (uncommitted) |
| [017](017-a-failed-read-is-said.md) | A failed read is said, not shown as empty (Changes, Settings, Usage, Projects, Design Home, manifest form, notices) | P1 | M | — | DONE — picker, dismissal rule and manifest wording corrected in the review round (uncommitted) |
| [018](018-one-keyboard-pattern.md) | One keyboard pattern: tablists, radio groups, menus, the add-on sheet, the checks' names | P1 | M | L13 committed (shared files) | TODO |
| [019](019-storage-and-one-press.md) | A storage-less window keeps working; Compact and Send-now take one press | P1 | S | after 017 (Settings.tsx) | DONE (uncommitted; Composer and Wall finished in the review round) |
| [020](020-motion-scroll-and-rescroll.md) | Thin scroll bars everywhere; Changes re-scroll (the spinner step removed: UI-03 was false) | P1 | S | L13 committed (shared sheets) | TODO |
| [021](021-browser-back-and-forward.md) | Browser's Back and Forward grey when there is nowhere to go | P2 | M | — | TODO |
| [022](022-commit-switch-update-hold-the-thread.md) | Commit, switch and tool update hold the thread; autoPull holds the checkout | P1 | M | — | TODO |
| [023](023-the-engine-checks-before-it-works.md) | The engine checks before it works: addon-check, boot, MCP key, the walk, endpoint http, turn-grant links | P1 | M | — | TODO |
| [024](024-git-quoting-and-merges.md) | Git's own spelling of a path stops fooling the Reviewer's small-change pass (the merge step removed: CORE-01 was false) | P1 | S | — | TODO |
| [025](025-wind-down-guards.md) | Deleted-thread sink calls, the surface heartbeat, Stop's disk-full listeners | P1 | S | after 023 (server.ts) | TODO |
| [026](026-surfaces-survive-the-bad-day.md) | Design/Device survive a huge file, wedged simctl, backslash filter, transient git, gh banner, dead watcher | P2 | M | — | TODO |
| [027](027-the-dock-stands-still.md) | The dock stands still while the open session streams (measure first) | P2 | M | L13 committed; after 020 (Panel.tsx) | REJECTED — PERF-01 is false: measured, the dock renders 4 times in 6 s |
| [028](028-four-provider-details.md) | ACP refusal is an error (not Antigravity's quota); Codex tokens clamp; PROMPTED bounded; model choices deduped | P2 | S | — | TODO |
| [029](029-codex-keeps-the-guard.md) | Codex keeps the destructive-command guard at Full (investigate + real-Codex gate) | P1 | M | after 028 (providers) | TODO |
| [030](030-the-swap-checks-at-the-move.md) | The swap script checks the signature itself, right before the move | P2 | M | — | TODO |
| [031](031-search-off-the-engine-loop.md) | Search and import read histories off the engine's loop (CORE-08, added by the review) | P2 | M | after 022 (runtime/api) | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale)

**Refreshed after the advisor's review (2026-11-20, `plans/REVIEW-2026-11-20.md`).** Every TODO plan above was
re-checked against the code and refreshed in place; each begins with "What the review changed". Do not run a copy of
a plan made before that refresh. Five findings were false (CORE-01, FEAT-02, PROV-03, PERF-01, UI-03); `AUDIT-2026-11-20.md`
now marks every finding's status. The review round also corrected 015, 016 and 017 and finished 019, all uncommitted
in the tree; what changed is in `plans/REVIEW-2026-11-20.md`, "The review round".

**Recommended order:** 015 first (it unblocks the release gate — CI is red on main and the desktop steps have never
run). Then the UI polish cluster 016→017→019→018→020→021 (the owner's stated priority; 017 before 019 and 020 before
027 because they share files). Then the engine cluster one at a time: 022, 023, 025, 024, 026, 028, 031. (027 is rejected.) 029 and 030 last — they carry real-tool / real-machine gates.

**Shared files (run sequentially, not in parallel):** Settings.tsx (017, 019); SessionInfo.tsx (018, 019);
Panel.tsx (017, 020, 027); Session.tsx (018, 027, L13); server.ts (023, 025); runtime.ts (022, 024, 025);
app.css/surfaces.css/addons-page.css/findings.css (020, L13); providers (028, 029). Engine plans also follow the
previous run's rule: one at a time, never in parallel.

**Real-tool / real-machine gates (not done until the owner runs them):** 029 (real Codex against a fake local API),
030 (the signed-copy swap rehearsal), 026 (simctl/log stream on a real simulator), 022 (real git hooks' variety),
028 (refusal wording per agent). 015's CI is unverified until the owner pushes. The UI plans' on-screen checks are
the owner's eyes or the measuring build — each plan says "not seen" where it could not look.

## Not planned, and why

| Finding | Why it has no plan |
|---|---|
| SEC-01 endpoint/add-on keys reach spawned processes via env (SECURITY_MODEL drift) | Needs a per-tool handoff decision (Codex env_key / OpenCode {env:} read env by design) + a real-tool run; the doc-drift half is a sentence the owner should approve with the mechanism. Recommended: extend plan 004's key-file pattern where the tool allows, document the exceptions. |
| SEC-04 the proxy strips the dev server's CSP/XFO | Framing needs the XFO strip; keeping CSP with frame-ancestors relaxed needs real dev-server checks. A decision + a probe, not a blind fix. |
| SEC-06 DSH sandbox denies read but not hard-link of secrets; some credential paths unlisted | LOW confidence — SBPL/XNU link() semantics need a real-Mac probe first (investigate plan on request). |
| PROV-03 Claude plan-window utilization units disagree (0–1 vs percent) | Which unit the experimental usage API returns needs the SDK/real-tool check; the fix is one line once confirmed. |
| PROV-06 endpoint key redaction only on errors, not streamed answers | Needs delta-buffering care (a key split across chunks); plan on request with a real-endpoint echo test. |
| CORE-07 compare.keep --3way can leave conflict markers in the main checkout | Rollback must not destroy the person's own uncommitted work; needs a scratch-repo characterization + a design (apply through a throwaway index, or name the residue). |
| CORE-08 search/import read whole histories synchronously | M, valuable; the async walk already exists to reuse — plan on request (it was outside this run's cap). |
| FEAT-02 provisional version copy dropped on fast turn succession | MED — needs a characterization test of two overlapping turns first; the version lifecycle is delicate. |
| FEAT-03 canvas.restore's sync copy+hash | M — restore must stay atomic-ish; plan on request with the async queue pattern. |
| FEAT-07 proxy HTML buffering unbounded, no upstream timeout | MED — the user's own local server; robustness, plan on request. |
| FEAT-08 forged `built` link from design.json | MED — buildlinks.ts consumption not fully traced; investigate first. |
| FEAT-09 freePath's 50-try fallback can overwrite another session's file | LOW — the n>50 clause may be a deliberate bail; investigate before fixing. |
| FEAT-13 hung DSH plugin call holds its slot | LOW — the agent-side MCP client may impose its own timeout; investigate the real call path. |
| PERF-03 dock open/close animates grid tracks; PERF-04 lazy Changes; PERF-05 mirror retokenizes | Measure first (CDP frame times / chunk KB / typing latency) — the plans would be guesses without numbers. |
| DEBT-01 cwdOf expression ×27; DEBT-03 ~20 falsely-public UI symbols; DEBT-04 14 test-only engine exports; PERF-02 usage.jsonl never trimmed | Cheap, safe, queued — say the word and they become one "engine/UI bookkeeping" plan. DEBT-04 needs the owner's E5-precedent call (document seams vs inject). |
| TEST-02 Windows risk rules untested on macOS CI; TEST-04 quit sequence untested; TEST-05 six doing.ts helpers; TEST-06 endpoint's four branches | Queued test plans — say the word. TEST-02 is the strongest (the Full-access guard's Windows half has zero effective coverage). |
| DEBT-02 three stdio tool-server copies | M, touches agent tool processes — needs the real-tool run; held like F2. |
| DEBT-05 Electron 44→45, SDK 0.3.310→0.3.329; DEBT-06 TS 5.9→7, Vite 7→8 | Release-gated bumps, each its own change (CLAUDE.md's pin rules); schedule, don't bundle. |
| DEBT-08 SECURITY_MODEL says 0.2.9; BACKEND's macOS floor matches nothing built | The version line is a release-process fix; the floor needs the packaged Info.plist inspected first (owner). |
| DEBT-09 CHANGELOG-next empty while 12 commits sit past v0.3.0 | The owner's voice + a release.sh checklist item; the commit subjects are already user-facing sentences to draft from. |
| DEBT-10 engine logging has no structure/request ids | M — measure against real support cases first; must not log keys or prompts. |
| Two-pane dock rules unreachable since 0.2.2; the layout "Not planned" backlog (panel shapes, icon sizes, dialogs, tooltips, fractional type…) | Design decisions — the owner's rule: a mockup before a redesign. Recorded in plans/layout/README.md. |
| Windows CI job (DEBT-07's other half) | Needs a mac-only test inventory + a Windows runner shakedown; the first run surfaces unknown path/spawn failures a fix plan cannot bound. Investigate first. |

## Findings considered and rejected (this run)

The auditors' own dismissed candidates, kept so the next run does not re-audit them:
- CORE: store.removeProject orphan logs (api.project.remove drops every thread first); firstLine hang on an ended
  stdin (the shell keeps stdin open); updates/state.json non-atomic write (constructor tolerates corruption, small
  file); refused-undo snapshot refs accumulate (forget cleans them at delete); doctor probe env stripping (strictly
  cleaner than a real session's env); launch.ts port race (the loser exits early and says so).
- UI: sessionPrAgent's stale thread.status (engine mode defaults to queue — harmless); notification click with a
  hidden window (send() calls show()); Dock badge vs sidebar counts (both use needsYou).
- PERF/DEBT verified-merged since 11-18 (NOT debt): F5 asking-test + usage totals, F7 version-compare/bundle-id,
  A13 KEEP=20 hold/release, C8 eviction + flat state.json + findLastIndex, C17 incremental usage read, A16 Security
  throttle, A11 isBlank memo, D6 opacity/transform pulses, font preload; CSS scans found 0 unused
  keyframes/props/classes; contracts 0 dead exports; BACKEND route list and README data-send claims accurate.
- The previous run's rejections (below) still hold.

## What this audit did not look at

Routines internals (off by decision), `ui/src/liner` internals (vendored), `mac/`, the Demo provider, `site/` and the
untracked folders. No real-tool runs (Cursor, Grok, Antigravity have never been run; Claude/Codex/OpenCode only by
the owner's earlier rehearsals). No Windows runtime behaviour. No app runs or timings by the auditors (read-only) —
the measure-first items say so. Settings.tsx, Timeline.tsx, Sidebar.tsx, Composer.tsx had targeted hotspot passes,
not line-by-line; design Canvas/Frame/Drop and security Overview/ScanSession internals are partly read;
security-checks/bringing-in/demo/tools, creator, canvas-html internals, buildlinks, watch and the small engine files
have sampled coverage (the FEAT auditor's coverage note lists them). The packaged Info.plist was not inspected.

## Rules that hold for every plan (this run)

The previous run's rules below still hold, plus:
- Test commands in this harness need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID` or node --test silently skips
  every file (the CI workflow itself does not need it).
- L13's uncommitted work is in the tree: plans that share its files say how to sequence; commit only your plan's files.
- One local commit per plan, the plan's own message. Never push. Honour each plan's STOP conditions.

## Executor notes (this run)

(One line per finished plan: commit, what was not verified, any STOP.)

- **015** DONE — commit "CI passes on a cold runner, and the app's bundle is built on every check". The fork-during-Reviewer-read
  wait in reviewer.test.ts is now a 20s clock deadline instead of a ~4s tick budget (the cause of CI run 44493395572's single
  failure, 1426/1427); 19/19 in four local runs including one under build load. check.yml gains `npm run build`, the
  design-and-api-endpoints push trigger, and checkout/setup-node v5 (tags confirmed to exist; the latest majors are v7 — the
  plan pins v5, the owner may prefer v7 later). Typecheck and build exit 0. **Owed to the owner:** CI on GitHub is unverified
  until pushed; the desktop CI steps have still never executed anywhere. No STOP. L13 was already committed (dbcddff) before
  this run began, so the index's "L13 first" precondition is satisfied.
- **016** DONE — commit "A push that carries nothing says up to date, and the push card reads one stage at a time".
  New pure module ship-words.ts: pushCount keeps the floor for a shipment with files but keeps ZERO for a push-only one;
  shipLive mirrors the CSS [data-p] stage map (the five per-stage deepEqual tests are the tripwire against the map drifting).
  The three source tests were seen to fail (the Math.max(1,…) floor, zero of ten aria-hidden spans, "Refresh") and then pass;
  12/12 tests, typecheck and build exit 0. All ten stacked spans now carry aria-hidden={!live.*}; role="status"
  aria-live="polite" kept; the stage machine and CSS unchanged. SessionInfo's re-ask is "Look again", as on the five other
  faces. NOT SEEN (owner's gates): a push-only shipment on an already-pushed branch saying "up to date" (the Demo measuring
  build has no reachable push remote), VoiceOver reading one stage at a time, and the Look again button on screen. No STOP.
- **017** DONE — commit "A failed read says so instead of reading as empty, and a dismissed notice stays away". Seven source
  tests seen RED then GREEN (a seventh pins Updates' toolShown wiring, per the plan's own every-fix-has-a-test rule); the four
  pure toolShown tests pass by design and the old-filter pin documents the bug (passes before and after). 11/11 tests;
  typecheck and build exit 0. Docked Changes keeps a failed diff said (SurfaceNote "The changes didn't open", three-state as
  the Review); Settings' memory/rules editors keep their fields, say the failure with role=alert and retry with Look again;
  AddByHand says "That isn't JSON yet: …" with aria-invalid/describedby; Usage says the failure instead of a confident $0
  (hero, charts and table only when data present; the page's Look again now retries the summary too); Projects' Mac scan keeps
  its error as the GitHub tab does; Design Home's relist failure is said with an inline Look again instead of an endless
  shimmer; a dismissed notice stays away in every tool state through the new pure update-notices.ts. Choices recorded (the
  plan's fallbacks): .lc-ao-why is scoped to .lc-ao-from, so the alerts use app-owned lc-sinfo-note (no CSS edited anywhere);
  toolShown's latest widened to optional to match contracts (predicate byte-identical to the plan); the Settings failed-guard
  precedes the null-guard for TS narrowing; Projects took the plan's { detail } variant. **OWNER DECISION (step 5, like plan
  006):** a dismissal now holds across state changes at the SAME version — a tool put away while 'waiting' stays away when it
  becomes 'updated', until a newer version comes out; if the owner wants 'updated' to speak again, narrow toolShown to the
  settled states. Executor observation for that ruling: engine/src/updates.ts dismiss() does not persist a dismissal made
  while 'updated' (it resets the tool to current/available), so the decision bites on waiting/available→updated transitions;
  engine untouched, out of scope. SEEN on screen (per-browser RPC interception, the measuring engine untouched; screenshots
  looked at): the manifest form invalid and valid; the docked Changes note staying after the toast fades; both Settings
  editors failed and successful; Usage failed (no $0) and successful; Projects' Mac failure banner; Design Home's failure note
  and success list. NOT SEEN: a real pruned checkpoint on disk, a project folder actually removed outside the app, the engine
  genuinely unreachable (one method aborted in the probe browser only), the dismissed-notice round-trip (the Demo build shows
  no notices at all), VoiceOver announcing the alerts. No STOP.
- **019** DONE — commit "A window without storage starts on its own instead of breaking, and Compact and Send-now take one
  press". New shared ui/src/app/kept.ts: keptRead/keptWrite (JSON + an `ok` predicate), wordRead/wordWrite (known words), and
  textRead (a plain-string try/catch read) — textRead added because lc:project and lc:device store RAW strings, not JSON, so
  keptRead's JSON.parse would break them; it is the "string read with try/catch" step 2 asked for. App shell: lc:view keptRead
  with isView validating the outer kind against the file's own nine VIEW_KINDS, lc:sidebar wordRead ["0","1"], lc:project
  textRead, the writes keptWrite/wordWrite, lc:settings wordWrite. Settings: page wordRead (the fifteen SettingsPage values),
  enter wordRead ["queue","steer"] (the cast gone), look keptWrite; AgentDialog.tsx checked — already guarded, unchanged.
  Panel: view wordRead ["unified","split"] + wordWrite. Device: udid textRead + wordWrite. Compact: a `compacting` STATE (not a
  ref — the button reads the same state, per the plan), set at the press, cleared on settle, disabled reads it. Send-now:
  `|| e.repeat` in the keydown early-return; a sendingNow Set guard in sendNow, cleared in the queue effect once the message is
  gone and in the catch. 12/12 tests (kept-storage's five pure tests pass by design against the new module; the press-guards and
  shell-storage source tests were seen RED then GREEN — "the app shell's storage reads and writes are guarded", "Compact is
  disabled from its own press", "a held Send-now shortcut sends one message", the view-kind test); typecheck and build exit 0.
  SEEN on screen (per-browser probes, the isolated Demo engine untouched): **Compact** double-pressed before the status lands →
  exactly one /compact send, the button disabled mid-flight from its own press and re-enabled after. **Held ⌘⇧Enter**: three
  messages queued WHILE the Demo turn ran (an idle thread drains its queue at once — runtime.setQueue:522, which is why an
  idle-thread probe sees nothing), one press + ten repeats → exactly one send (mode steer); the sendingNow guard seen cleanly
  too — one queued message, its removal RPC delayed so two quick presses both see the same head → one send. **Storage-less**:
  with storage throwing for every key EXCEPT lc:enter, the app mounts, the composer renders, navigates, opens Changes (diff
  content), opens Device (via its keyboard shortcut — this build's rail has no Device button), changes the accent (teal applied),
  zero Boundary faults, ERRORS=[] — every site the plan names survives. **FLAGGED, out of scope (the gate's one gap):** with
  storage throwing for ALL keys the session view still hits the Boundary at Composer.tsx:342, the bare
  `localStorage.getItem("lc:enter") as "steer"` read (no try/catch). UI-06's bare-site list and step 6 do not name it; it is
  pre-existing at bfb0ebc, and its twin at Settings.tsx:88 was in scope and is fixed. One-line follow-up for a later pass:
  `wordRead(localStorage, "lc:enter", ["queue","steer"], "queue")`. The maintenance note's "zero direct storage calls in the
  named files" is broader than the tests the steps write (steps 2–4 cover App/Settings/Panel/Device; Composer's storage is not a
  named step) — a later pass should fold Composer:342 and design/Tabs.tsx's own readKept into kept.ts. NOT SEEN: whether the real
  tool no-ops a second /compact (Demo only; the plan's MED-confidence note — the guard is right either way); VoiceOver.
  design/Tabs.tsx untouched (L13's file). No STOP, no formatter.

---

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
| [011](011-engine-answers-only-its-own-callers.md) | The engine checks the caller before reading a request, and answers only to its own address | P2 | S | — | DONE (commit `79cf3d0`, approved, fast-forwarded onto `design-and-api-endpoints` by the owner) |
| [012](012-less-work-on-fork-and-in-the-background.md) | Less work on a fork, on the other faces, and in a hidden window | P3 | S | — | DONE |
| [013](013-house-rules-and-a-safe-sync.md) | A CLAUDE.md with the house rules, and a Liner UI sync that shows its changes first | P2 | S | 002 | DONE |
| [014](014-small-engine-fixes.md) | One fix session per finding, a cancellable outside wait, export makes its folder | P3 | S | — | DONE |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale)

When you finish a plan, set its status and add one line under "Executor notes" below: the commit, anything you could not verify, and any STOP you hit.

## The advisor's audit of the work, 2026-11-19

Audited at `f4f3c84` (13 commits on top of `6970155`, one per plan, nothing pushed). Every diff was read against its plan's scope and steps, and the checks were run again.

- **Verdict: plans 001 to 010 and 012 to 014 are approved.** Each commit changes only files its plan lists, does what the plan's steps say, and its new tests assert the behaviour (none is hollow). `CHANGELOG.md`, `ui/src/liner`, `mac/` and Routines are untouched.
- **Checks re-run:** `npm run typecheck` exit 0. `npm run test:steady -w engine`: 1,414 of 1,415 passed. `npm test -w desktop`: 40 of 40. `npm run build` and `node desktop/build.ts` exit 0. Both scripts pass `bash -n`.
- **The one failing test is not from this work.** "opencode: Stop, then the next message at once: the stopped turn's late count leaves the next turn's steps out" (`engine/test/polish-providers.test.ts:288`) failed once in the full run and passed six times out of six alone. Neither that file nor `engine/src/providers/acp.ts` was changed by these commits. It is a second timing-dependent test, beside the known "Stop is decisive".
- **Plan 011** was stopped correctly by its first executor (an existing test sends a made-up `Host: x`). The plan was refreshed in place to change that one header, then run by a builder in its own worktree: commit `79cf3d0`, parent `f4f3c84`, branch `worktree-agent-a17ac75a6772c0120`, four files, all in scope. **Approved.** The diff matches the plan line for line; the two new tests failed before the fix and pass after. Re-run by the advisor in that worktree: engine type check exit 0, and 302 of 302 tests across the twelve files that start or call the server. The builder's own full run was 1,417 of 1,417. The app reaches its engine as `http://127.0.0.1:<port>` (`desktop/src/main.ts:1046`) and Vite's proxy rewrites the host, so neither is locked out by reading; neither was opened on screen. To bring it onto the branch: `git merge --ff-only worktree-agent-a17ac75a6772c0120`.
- **Two deviations, both reported by the executor and both accepted:**
  - Plan 004: when a store has no `home` (only a test's stand-in at `engine/test/engine.test.ts:498`), the key file goes to the temp folder instead. The real engine always has a home. Worth tidying later: give that stand-in a `home` and drop the fallback, so a key can never land outside Liner Code's folder.
  - Plan 012: its done criterion `grep -c "onSidebar={() =>" ui/src/app/App.tsx` → `0` was wrong. Seven other screens in `App.tsx` still pass an inline function, and they were out of scope. The two lines the plan named were changed. The criterion was the plan's mistake, not the executor's.
- **Still owed, and no test can supply it:** the real-tool run for plans 003, 004 and 005 (Claude Code, Codex, OpenCode); a look on screen for plans 006, 007, 008 and 012; the first run of the CI workflow once pushed; a rehearsal of the update swap for plan 010.

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
- **013** DONE — commit “The repo tells coding agents its rules, and syncing Liner UI can no longer wipe local edits unseen”. CLAUDE.md created; sync-liner.sh lists changes and needs --yes, refuses uncommitted liner edits, records UPSTREAM; bash -n and the refusal checks pass; ui/src/liner untouched (sync not run for real). For the owner: commits efa7f7b/15e0990/92fc252 edited the copy — check each exists in Liner UI before the next real sync. No STOP.
- **014** DONE — commit “Fix pressed twice at once starts one session, an outside tool's wait can be cancelled, and an export makes its folder”. Three tests fail-before/pass-after; engine typecheck green; 65/65 across the named files. outside.ts now mirrors mcp.ts's cancel/progress loop (three copies of it now — merge next time one changes). No STOP.
