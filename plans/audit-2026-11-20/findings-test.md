# TEST findings — Liner Code test-coverage audit (branch design-and-api-endpoints, HEAD bfb0ebc)

Playbook: `/Users/hilmi/.hermes/skills/improve/references/audit-playbook.md` — read in full (§4 Test Coverage, Finding format, Prioritization rubric).
Coverage maps: `test-coverage-map.json` (direct test imports per src file), `test-reach-map.json` (transitive). 100 engine test files + 7 desktop test files; ~1427 tests (CI count).

### [TEST-01] Fix the fifth flake: the fork-during-Reviewer-read test fails CI's steady run

- **Evidence**: `engine/test/reviewer.test.ts:351` — test "a fork while the Reviewer reads the last change takes that turn along"; `:364` polls `for (let i = 0; i < 400 && !reading; i++) await tick()` then `:365` asserts `reading && runtime.isRunning("t")`. GitHub Actions run 44493395572 (2026-11-19, push to main, the workflow's only run ever) failed exactly here: `AssertionError: the Reviewer reads`, actual false, test duration 6035 ms, 1426/1427 pass. This is NOT one of the four known timing flakes.
- **Impact**: CI is red on main and the failure gates everything after it: `node desktop/build.ts` and `npm test -w desktop` never ran in that run (steps skipped). The release gate (`scripts/release.sh` runs the same steady suite) is blocked by a load-sensitive poll budget, not by a product bug — the turn hadn't reached the Reviewer's read within the poll window on the slow runner.
- **Effort**: S — replace the fixed 400-tick poll with a deadline generous enough for a cold runner (or await an event the runtime already emits), keeping the assertion.
- **Risk**: LOW — test-only change; the behavior under test (fork takes the ended turn along) is unchanged.
- **Confidence**: HIGH — CI log read via `gh run view 44493395572 --log-failed`; code read.
- **Fix sketch**: Give the wait a real-time budget (e.g. 15–20 s) or hook the read's start instead of counting ticks; re-run the file alone and under load to confirm. Then re-trigger CI so the desktop steps actually execute once.

### [TEST-02] Windows-only risk rules are loaded by process.platform, so macOS CI never tests them

- **Evidence**: `engine/src/risk.ts:54-63` — `if (process.platform === "win32") HIGH.push(...)` adds Remove-Item -Recurse -Force, `rd /s`, `del /s`, `format c:`, Format-Volume/Clear-Disk/Remove-Partition, `iwr|irm … | iex`, `-Verb RunAs`; `:398` the same for ASKS (del/erase/taskkill/Stop-Process/schtasks/reg add…). Grep of `engine/test` for `Remove-Item|Format-Volume|Clear-Disk|RunAs|taskkill|rd /s|del /s`: 0 hits. The win32 cases in `risk.test.ts:389-396` pass `platform:"win32"` to `routine()`, but that only steers `judge`'s allowlist — on macOS the HIGH/ASKS tables never contain the Windows entries, so those assertions pass via the allowlist, not the risk rating.
- **Impact**: `commandRisk`/`isDestructive` (the Full-access guard, risk.ts:1558) rate `Remove-Item -Recurse -Force ~` as low on a Mac but high on Windows; the Windows rating path has zero effective coverage, and CI is macOS-only (`.github/workflows/check.yml:11`), so a regression in those regexes ships unnoticed to Windows users — the guard that still asks in Full access.
- **Effort**: S — build the tables per platform (a function of platform, or export the win32 entries) and add a table-driven test that exercises them with `platform:"win32"` on any OS.
- **Risk**: LOW — refactor of table construction; behavior on each platform must stay identical (pin with the new tests first).
- **Confidence**: HIGH — read the conditional and grepped every test for the Windows command names.
- **Fix sketch**: Make HIGH/ASKS construction take the platform (as `judge` already does), keep the module-load default, and assert `riskOf`/`isDestructive`/`judge` on the Windows entries from macOS tests.

### [TEST-03] CI never builds the UI, never ran the desktop tests, and has never seen this branch

- **Evidence**: `.github/workflows/check.yml:13-24` — steps are typecheck, `test:steady -w engine`, `node desktop/build.ts`, `npm test -w desktop`; no `npm run build` (vite UI build) anywhere. `on: push: branches: [main]` + `pull_request` only. `gh run list`: exactly one run ever (44493395572, main, failed at the engine step, so the two desktop steps were skipped). `gh pr list --state all`: no PR for `design-and-api-endpoints`; `git rev-list --count origin/main..HEAD` = 12 — the whole endpoints/design branch is unverified by CI. Runner annotation: actions/checkout@v4 and setup-node@v4 target deprecated Node 20.
- **Impact**: A vite build break (import resolution, CSS, asset paths — things `tsc --noEmit` does not catch) ships without any gate; the desktop suite has never actually executed in CI; 12 commits of new feature work (endpoint provider, pictures, Auto-as-Edits) have no CI verification at all until a PR opens.
- **Effort**: S — add `npm run build` step; open the PR (or add the branch to the push trigger); bump the two actions to v5/v6 majors.
- **Risk**: LOW — additive CI changes; a newly-green-required build may surface existing breaks (that is the point).
- **Confidence**: HIGH — workflow file, run list, run view and PR list all read.
- **Fix sketch**: Add the UI build step before the desktop build, widen the trigger or open the PR, bump the actions; then watch one full green run including desktop.

### [TEST-04] The engine's quit sequence (main.ts) has no test beyond a boot smoke

- **Evidence**: `engine/src/main.ts:222-250` — `quit()` orders 14 shutdown steps (dsh.stopAll, terms.closeAll, launch.quit, runtime.shutdown, store.keepStreaming/flush, server.close), a `QUIT_WAIT + 2500` hard-exit timer with `marksKept()`, and `dropMarks()` on clean exit; SIGTERM/SIGINT/stdin-end wiring. No test imports main.ts (coverage map: 0 direct, 0 transitive); `engine/test/bundle.test.ts:62-92` spawns the bundled main.js, asserts LINER_READY + version + compile cache, then `engine.kill()` without asserting anything about shutdown. `marksKept` has 0 hits in engine/test. `docs/EDGE-CASES.md:205` lists "Quitting with a turn running leaves it for restart recovery" as handled-no-test; runtime-level pieces are now tested (`turns.test.ts:344` keepStreaming, `drivers.test.ts:266-287` continueAfterRestart) but the quit ordering/deadline itself is not.
- **Impact**: The step order is load-bearing (a full-disk save must not leave the engine running with nothing to stop it; markers must survive a hard exit so the next engine sweeps orphans). A reordering or a thrown step regression is invisible to the suite; orphaned agent processes or lost "cut vs stopped" turn state on quit would ship silently.
- **Effort**: M — a test that spawns main.ts (source, `--port 0 --dev`) with a fake running turn, sends SIGTERM, and asserts: exit within the deadline, turn readable as cut on next boot, markers kept/dropped per path.
- **Risk**: MED — spawns a real engine process in tests (bundle.test.ts already does, so the pattern exists); must use a temp LINER_HOME.
- **Confidence**: HIGH — coverage map + code read; the gap is certain, the failure modes are reasoned.
- **Fix sketch**: Extend the bundle-style spawn harness with a quit case: SIGTERM mid-turn, assert exit code/deadline and the next boot's recovery view; a second case with a stubbed failing store.flush to pin the hard-exit fallback.

### [TEST-05] Six doing.ts helpers have no test at all

- **Evidence**: `contracts/src/doing.ts` exports `bareTitle` (:48), `stepFileName` (:60), `callInput` (:64), `callPath` (:74), `frameFileName` (:352), `serverOf` (:390); grep of `engine/test` for each name: 0 hits. `engine/test/doing.test.ts` (597 lines) covers the rest (callCommand, doingCommand, cutDoing, doingOf, canvasFrame/Words, toolNameOf, isStepCall…) via the contracts index re-export.
- **Impact**: These shape what the timeline says a step is doing (file names in step words, frame names from "Draw X" titles, launch.json server names, JSON input parsing of tool calls). They run on every tool call of every turn; a regression mislabels steps app-wide and nothing fails. `callInput` parses agent-supplied JSON — the malformed-input path is exactly what characterization tests are for.
- **Effort**: S — pure functions, table-driven tests in doing.test.ts.
- **Risk**: LOW — additive tests.
- **Confidence**: HIGH — grep-verified zero references.
- **Fix sketch**: Add cases per helper: quoted/spaced paths, empty and malformed JSON input, "Draw …" titles vs frame ids, `Run … from launch.json` titles, bare-title edge cases.

### [TEST-06] endpoint.ts is well tested overall; four branches are not

- **Evidence**: `engine/src/providers/endpoint.ts` (169 lines, NEW) is covered by `endpoints.test.ts` (8 tests: options per protocol, key separation, detect/open/update, /models lookup incl. redirect refusal, voucher), `models-reach.test.ts` (modelEntry modalities, takesPictures, noAuto/Auto-as-Edits), `polish-providers.test.ts:424` (detectOnce dedupe), `limits.test.ts` (goUsage/isGo). Untested branches: `endpointModels` 404 message ("doesn't list its models, so type them", :97), the `b.models` response shape and 200-id cap (:98-100); `local()` → `signedIn: true` with no key for localhost endpoints (:28, :126 — detect tests only use hosted URLs); the Go-endpoint `limits()` wrapper (:147-153 — voucher path tested, `isGo` path only via goUsage directly); `warms` passthrough (:155).
- **Impact**: Each is a user-visible path of the new feature: adding a keyless local endpoint (LM Studio/Ollama) shows the wrong sign-in state if `local()` regresses; a 404 from /models gives the wrong guidance; a Go endpoint's usage windows could silently disappear. Small surface, but it is the branch's headline feature.
- **Effort**: S — extend endpoints.test.ts (local-URL detect, 404 + models-shape + cap via the existing local HTTP server, Go limits with the existing fetch mock pattern).
- **Risk**: LOW — additive tests.
- **Confidence**: HIGH — read both files and grepped every export's test references.
- **Fix sketch**: One test per branch above, reusing the file's existing fake server/fetch scaffolding.