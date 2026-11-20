# 015. CI goes green: the fifth flake is tamed, and the bundle is built on every check

**Commit message:** `CI passes on a cold runner, and the app's bundle is built on every check`

Written by the advisor on 2026-11-20 against commit `bfb0ebc` (branch `design-and-api-endpoints`, Liner Code 0.3.0 beta).
Findings: TEST-01, TEST-03, DEBT-07 (build-step half). This plan is the prerequisite for every other plan's release gate:
the repository's only CI run ever is red, and the steps after the failure never ran.

## Why this matters

- GitHub Actions run `44493395572` (2026-11-19, push to `main`, the workflow's only run) failed at
  `npm run test:steady -w engine`: 1426/1427 passed. The failure is the test "a fork while the Reviewer reads the last
  change takes that turn along" (`engine/test/reviewer.test.ts:351`): `AssertionError: the Reviewer reads`, actual false,
  test duration 6035 ms. The two desktop steps after it were skipped — the desktop suite has never executed in CI.
- This is a FIFTH timing flake, not one of the four known ones ("Stop is decisive" in `antigravity.test.ts`, the opencode
  late-count in `polish-providers.test.ts:288`, "checks: a big repository never holds the engine's thread for long",
  "sidekick: a brief that waited in line…"). It polls a fixed tick budget that a slow runner outruns.
- `.github/workflows/check.yml` never runs `npm run build` (the vite UI build). A broken import graph, CSS syntax error
  or chunk failure passes CI and surfaces only at release. `tsc --noEmit` does not catch those.
- The workflow triggers on `push: branches: [main]` and `pull_request`. This branch is 12 commits ahead of `origin/main`
  with no PR (`gh pr list --state all` shows none for it), so none of that work has any CI verification.
- `actions/checkout@v4` and `actions/setup-node@v4` run on the deprecated Node 20 runner image.

## Current state (drift check)

```bash
git log --oneline -1                                    # bfb0ebc or later
sed -n '351,365p' engine/test/reviewer.test.ts          # the test named above; line 364 is the 400-tick poll
cat .github/workflows/check.yml                         # steps: npm ci, typecheck, test:steady, desktop build, desktop test
gh run list --limit 3                                   # the failed run 44493395572 (read-only; gh must be signed in)
```

The poll as it stands (`engine/test/reviewer.test.ts:363-365`):

```ts
    const working = runtime.send("t", "add a dark mode toggle to settings");
    for (let i = 0; i < 400 && !reading; i++) await tick();
    assert.ok(reading && runtime.isRunning("t"), "the Reviewer reads");
```

`tick` is a 10 ms sleep, so the budget is ~4 s of wall time; the CI runner took longer than that to reach the
Reviewer's read. The assertion itself is correct — the wait is what fails.

## Rules (hold for every step)

- Never run a formatter. Do not re-wrap or re-indent lines you did not change. Comments are plain sentences that say why.
- Do not touch: `ui/src/liner/**`, Routines, `mac/`, `engine/src/providers/demo*.ts`, `CHANGELOG.md`, the untracked
  folders (`.taste-skill/`, `ads/`, `docs/demo/`, `site-next/`), and the in-flight L13 layout work (see `plans/README.md`).
- Test commands in this harness need the prefix `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID` or node --test
  silently skips every file. The CI workflow itself does not need it (GitHub runners don't export those vars).
- One local commit for this plan. Never push. Never amend.

## Steps

### 1. Give the fork-during-read wait a real-time budget

In `engine/test/reviewer.test.ts`, replace the fixed 400-tick poll with a deadline wait that keeps the same assertion.
Use the file's own `tick` helper; a 20-second wall budget is generous for a cold runner and still fails fast when the
read truly never starts:

```ts
    const working = runtime.send("t", "add a dark mode toggle to settings");
    // A cold CI runner can take seconds to reach the Reviewer's read: wait on the clock, not a tick count.
    const deadline = Date.now() + 20_000;
    while (!reading && Date.now() < deadline) await tick();
    assert.ok(reading && runtime.isRunning("t"), "the Reviewer reads");
```

Check whether the same fixed-tick poll pattern guards a Reviewer read elsewhere in this file (grep `i < 400` and
`!reading` in `engine/test/reviewer.test.ts`); if another test waits on the same event with the same budget, give it
the same deadline shape. Do not touch other files' polls — the four known flakes are a separate, recorded matter.

**Verify:**
```bash
env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/reviewer.test.ts   # all pass
# three runs in a row, then once while the machine is busy (e.g. alongside a build): still all pass
```
This step is a test-only change: the "test that fails without the fix" rule is satisfied by the CI failure itself
(run 44493395572) — record that run id in the executor note.

### 2. Build the UI bundle in CI

In `.github/workflows/check.yml`, add one step after `npm run typecheck` and before the engine tests:

```yaml
      # The bundle users load: tsc alone misses import-graph, CSS and chunk failures.
      - run: npm run build
```

**Verify:** `npm run build` locally exits 0 (it is the same command). Read the workflow top to bottom: the step order
is now ci → typecheck → build → engine steady → desktop build → desktop test.

### 3. Let CI see this branch

The workflow only runs on pushes to `main` and on pull requests. Two options; do (a), and note (b) for the owner:

(a) Add the working branch to the push trigger so its commits are checked without a PR:

```yaml
on:
  push:
    branches: [main, design-and-api-endpoints]
  pull_request:
  workflow_dispatch:
```

(b) The owner may instead open a PR for the branch (then `pull_request` covers it and the branch line can stay out).
Do not open the PR yourself; do not push. Say in the executor note that CI stays unverified until the owner pushes,
exactly as plan 002 recorded.

**Verify:** the YAML parses (node -e with a YAML read is overkill; read it carefully — indentation matches the existing
file). `git diff .github/workflows/check.yml` shows only the trigger line and the new build step.

### 4. Bump the two actions off the deprecated runner image

In the same file: `actions/checkout@v4` → `actions/checkout@v5`, `actions/setup-node@v4` → `actions/setup-node@v5`.
Before writing, confirm v5 exists for each (a read-only `gh api repos/actions/checkout/releases/latest --jq .tag_name`
and the same for setup-node; if gh is unavailable, leave the bumps out and say so — do not guess a major).

**Verify:** the file references only majors that exist; nothing else in the workflow changes.

## Done

- `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/reviewer.test.ts` passes three runs in a
  row and once under load.
- `npm run typecheck` and `npm run build` exit 0.
- `.github/workflows/check.yml` contains the build step, the branch trigger (or the note that the owner will open a
  PR), and the bumped actions (or the note that they could not be confirmed).
- One commit with the message above. Executor note in `plans/README.md`: the commit, the run id this fixes, and
  "CI unverified until pushed".

## STOP conditions

- The fork test fails for a reason other than the wait budget (e.g. `reading` never becomes true even after 20 s on a
  quiet machine): that is a product bug, not a flake. Stop, leave the test change in place only if it still passes
  locally, and report what you saw.
- `npm run build` fails on this tree: report the error; do not fix UI code in this plan.
- The working tree carries uncommitted L13 layout changes when you start: this plan touches none of those files, so
  proceed, but commit ONLY the two files this plan names.

## Not in this plan, on purpose

- **A Windows CI job** (DEBT-07's other half): Windows ships, but the engine suite uses codesign/sandbox-exec/ditto and
  the macOS-only paths are not inventoried. A first Windows run would surface unknown path/spawn failures a fix plan
  cannot bound. Recorded in `plans/README.md` as investigate-first.
- The four known timing flakes: recorded, and `test:steady` exists for them.
- Re-triggering the failed run or pushing: the owner's actions.
