# Plan 002: A release cannot be built from code that fails its checks, and the checks run on a fresh clone

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6970155..HEAD -- scripts/release.sh engine/test/lean.test.ts desktop/tsconfig.json engine/package.json ui/package.json package-lock.json`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests / dx
- **Planned at**: commit `6970155`, 2026-11-19

## Why this matters

`npm run release` builds and can publish the app without running the type check or a single test, and every installed copy takes a published release within six hours. There is also no CI, and one engine test reads a folder that is not in git, so the suite fails on a fresh clone. This plan puts the existing checks in front of a release, makes the suite pass on a fresh clone, pins two dependencies that are loose today, and adds a small CI workflow.

## Current state

- `scripts/release.sh` (112 lines, `set -euo pipefail`). After parsing arguments and checking for `makensis` (lines 34-38) it bumps the version and builds:

  ```bash
  if [[ -n "$NEXT" ]]; then
    node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));p.version=process.argv[1];fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")' "$NEXT"
  fi
  VERSION="$(node -p "require('./package.json').version")"
  ```
  then at line 56-57: `echo "→ Liner Code $VERSION for $REPO"` and `bash scripts/build-mac.sh`. Nothing runs `npm run typecheck` or any test. The version bump writes only `package.json`, so `package-lock.json` still says `"version": "0.2.6"` while `package.json` says `0.2.9`.
- `CHANGELOG.md` headings look like `## 0.2.9 (beta), 2026-11-19`.
- `engine/test/lean.test.ts:25`:
  `const FORESHORE = join(import.meta.dirname, "..", "..", "docs", "demo", "foreshore", "DESIGN.md");`
  `docs/demo/` is untracked (`git ls-files docs/demo` prints nothing), so on a fresh clone the 12 lean tests fail. The file exists on this machine. The tracked file `engine/src/providers/demo-foreshore/DESIGN.md` is a different version, so it cannot be used instead. The only tracked fixture folder today is `engine/test/fixtures/notes-workspace/`.
- `desktop/tsconfig.json`: `"include": ["src", "build.ts", "package.ts"]`. `desktop/test/*.test.ts` is never type-checked. (`engine/tsconfig.json` includes `test`.)
- `engine/package.json`: `"@anthropic-ai/claude-agent-sdk": "^0.3.310"`. The code reaches three SDK calls through casts (`engine/src/providers/claude.ts:916`, `:958`, `:2166`), so a silent minor bump can change behaviour without a type error. Electron (`44.9.3`) and esbuild (`0.28.2`) are already pinned exactly in `desktop/package.json`.
- `engine/build.ts:12` and `ui/vite.config.ts:3` both `import … from "esbuild"`, but neither `engine/package.json` nor `ui/package.json` declares it; it only resolves because `desktop` hoists it.
- Root `package.json` scripts: `"typecheck": "npm run typecheck -w engine && npm run typecheck -w ui && npm run typecheck -w desktop"`, `"test": "npm test -w engine && npm test -w desktop"`. Engine has `"test:steady": "node --test --test-concurrency=1 \"test/*.test.ts\""`.
- `.github/` holds only `ISSUE_TEMPLATE/` and `readme/`. No workflows.
- Known and not yours: under parallel load one timing test ("Stop is decisive from the moment it's pressed", `engine/test/antigravity.test.ts`) can fail. `test:steady` runs one file at a time and is the reliable command (about 11 minutes).

Conventions: shell scripts here use `set -euo pipefail`, two-space indent, `echo "→ …"` for progress lines, and comments that say why. Never run a formatter on this repo.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| One engine test file | `node --test engine/test/lean.test.ts` | all pass |
| Engine suite, reliable | `npm run test:steady -w engine` | all pass (about 11 minutes) |
| Desktop tests | `npm test -w desktop` | all pass |
| Shell syntax | `bash -n scripts/release.sh` | exit 0 |

## Scope

**In scope**:
- `scripts/release.sh`
- `engine/test/lean.test.ts`
- `engine/test/fixtures/foreshore/DESIGN.md` (create, by copying)
- `desktop/tsconfig.json`, and `desktop/test/*.test.ts` only to fix type errors the new include reveals
- `engine/package.json`, `ui/package.json`, `package-lock.json`
- `.github/workflows/check.yml` (create)

**Out of scope**:
- `scripts/build-mac.sh`, `scripts/build-win.sh`: the gate belongs in `release.sh` only.
- `docs/demo/` itself: leave it untracked.
- Any file under `engine/src`, `ui/src`, `desktop/src`.
- Adding a linter or formatter.

## Git workflow

- Stay on `design-and-api-endpoints`. One commit for this plan, a plain sentence (example from `git log`: `A Reviewer block reads as one, without a question's amber`). Do not push: the CI file only runs once the owner pushes.

## Steps

### Step 1: Make the lean tests pass on a fresh clone

1. `mkdir -p engine/test/fixtures/foreshore && cp docs/demo/foreshore/DESIGN.md engine/test/fixtures/foreshore/DESIGN.md`
2. In `engine/test/lean.test.ts:25` change the path to:
   `const FORESHORE = join(import.meta.dirname, "fixtures", "foreshore", "DESIGN.md");`

**Verify**: `node --test engine/test/lean.test.ts` → all pass; `grep -c '"docs", "demo"' engine/test/lean.test.ts` → `0`.

### Step 2: Type-check the desktop tests

In `desktop/tsconfig.json` change the include to `["src", "test", "build.ts", "package.ts"]`.

**Verify**: `npm run typecheck -w desktop` → exit 0. If it reports errors in `desktop/test/*.test.ts`, fix the types in those test files only (no behaviour change), then re-run. The `.app.cjs` files are not TypeScript and are not affected.

### Step 3: Pin the SDK and declare esbuild

1. `engine/package.json`: change `"^0.3.310"` to `"0.3.310"`, and add `"esbuild": "0.28.2"` to `devDependencies`.
2. `ui/package.json`: add `"esbuild": "0.28.2"` to `devDependencies`.
3. Run `npm install --package-lock-only` (needs network; it rewrites only `package-lock.json`).

**Verify**: `node -p "require('./package-lock.json').version"` → `0.2.9`; `npm ls @anthropic-ai/claude-agent-sdk esbuild` → SDK `0.3.310`, a single esbuild `0.28.2`; `git diff --stat package-lock.json` → a small diff (tens of lines).

### Step 4: Gate the release

In `scripts/release.sh`:

1. Add to the header comment block, after the `LINER_RELEASE_TITLE` line:
   `#   LINER_SKIP_CHECKS=1 skips the type check and the tests (about 12 minutes) and the clean-tree check`
2. Immediately after the `makensis` check (line 38) and before the `if [[ -n "$NEXT" ]]` block, insert:

   ```bash
   # Every copy of the app takes a published release by itself, so what goes out has passed its checks first.
   if [[ "${LINER_SKIP_CHECKS:-}" != 1 ]]; then
     if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
       echo "There are changes that aren't committed. Commit them first, so the release is what's in git." >&2
       exit 1
     fi
     echo "→ Checking types and running the tests (about 12 minutes; LINER_SKIP_CHECKS=1 skips them)"
     npm run typecheck
     npm run test:steady -w engine
     npm test -w desktop
   fi
   ```
3. Replace the `node -e '…p.version=…'` line inside `if [[ -n "$NEXT" ]]` with:
   `npm version "$NEXT" --no-git-tag-version --allow-same-version >/dev/null`
   (this updates `package.json` and `package-lock.json` together).
4. Right after the `VERSION="$(node -p …)"` line, add:

   ```bash
   # The website and the release notes are built from CHANGELOG.md: a version with no entry there isn't ready.
   if ! grep -q "^## $VERSION " CHANGELOG.md; then
     echo "CHANGELOG.md has no \"## $VERSION\" entry yet." >&2
     exit 1
   fi
   ```

**Verify**: `bash -n scripts/release.sh` → exit 0; `grep -c "test:steady" scripts/release.sh` → `1`; `grep -c "LINER_SKIP_CHECKS" scripts/release.sh` → `3`. Do NOT run the release script.

### Step 5: Add the CI workflow

Create `.github/workflows/check.yml`:

```yaml
# Type check and tests on every push and pull request. macOS, because the engine's tests use
# codesign, sandbox-exec and ditto, and the desktop tests start Electron.
name: Check
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
jobs:
  check:
    runs-on: macos-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      # One file at a time: the timing tests fail at random under parallel load.
      - run: npm run test:steady -w engine
      - run: node desktop/build.ts
      - run: npm test -w desktop
```

**Verify**: `node -e "require('fs').readFileSync('.github/workflows/check.yml','utf8')"` → exit 0; the file has no tab characters (`grep -c $'\t' .github/workflows/check.yml` → `0`). This workflow cannot be run locally; record in `plans/README.md` that it is unverified until the owner pushes.

### Step 6: Run the whole suite once

**Verify**: `npm run typecheck` → exit 0; `npm run test:steady -w engine` → all pass; `npm test -w desktop` → all pass.

## Test plan

No new tests: this plan makes the existing ones run in more places. The fixture copy in Step 1 keeps the 12 lean tests as they are.

## Done criteria

- [ ] `node --test engine/test/lean.test.ts` passes and no longer reads `docs/demo`
- [ ] `npm run typecheck` exits 0 with `desktop/test` included
- [ ] `node -p "require('./package-lock.json').version"` prints `0.2.9`
- [ ] `bash -n scripts/release.sh` exits 0 and the script contains the gate
- [ ] `.github/workflows/check.yml` exists
- [ ] `npm run test:steady -w engine` and `npm test -w desktop` pass
- [ ] `git status --short` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row updated, with the note that CI is unverified until pushed

## STOP conditions

- `npm install --package-lock-only` changes more than about 60 lines of `package-lock.json`, or changes the resolved version of any package other than adding esbuild entries and the root version.
- `npm ls esbuild` shows two different esbuild versions.
- Step 2 reveals type errors that can only be fixed by editing files under `desktop/src`.
- Any engine test other than the known timing test fails after your changes.

## Maintenance notes

- When the SDK, Electron or esbuild is bumped, bump the exact pin and the root `allowScripts` entry together, and re-run the real-tool check the owner does before a release.
- The CI job may need one round of fixes after its first real run (tools missing on the runner show up only there).
- A later step worth adding to the gate: the real-tool access check ("Check my tools", tier 2) so a release also proves Read only and Manual on the real CLIs.
