# Plan 013: The repo tells coding agents its rules, and syncing Liner UI can no longer wipe local edits unseen

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6970155..HEAD -- scripts/sync-liner.sh CLAUDE.md`
> If `scripts/sync-liner.sh` changed, or a `CLAUDE.md` now exists, compare
> against "Current state" before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plan 002 (the commands named in the new file exist after it)
- **Category**: dx
- **Planned at**: commit `6970155`, 2026-11-19

## Why this matters

Almost all code in this repo is written by coding agents, and its rules live only in the owner's private notes: never run a formatter (one already wrecked uncommitted work), do not edit the copied Liner UI library, leave Routines switched off, write a failing test with each fix. Every new agent has to be told again or learns by breaking something. A short `CLAUDE.md` at the root fixes that.

Second, `ui/src/liner` is a copy of a separate library. `scripts/sync-liner.sh` refreshes it with `rsync --delete`, which silently removes anything changed in the copy. Three commits in this repo did change files in the copy, so the next sync would undo them without a word. The script should show what it is about to change and ask for a go-ahead, and it should record which upstream version was copied.

## Current state

- No `CLAUDE.md`, `AGENTS.md` or `CONTRIBUTING.md` exists in the repo.
- `scripts/sync-liner.sh` (whole file):

  ```bash
  #!/usr/bin/env bash
  # Copies the Liner UI library into this app again, after it changes in ../Liner UI.
  # Liner Code doesn't edit ui/src/liner; app styles live in ui/src/app/app.css.
  set -euo pipefail
  cd "$(dirname "$0")/.."
  SRC="${LINER_UI:-../Liner UI}/src/liner"
  [ -d "$SRC" ] || { echo "No Liner UI library at $SRC (set LINER_UI to its folder)"; exit 1; }
  rsync -a --delete "$SRC/" ui/src/liner/
  echo "✓ ui/src/liner now matches $SRC"
  ```
  It is run as `npm run sync-liner` (root `package.json`).
- Commits in this repo that edited files under `ui/src/liner`: `efa7f7b`, `15e0990`, `92fc252` (see `git log --oneline -- ui/src/liner`).
- Facts for the new file, all checked against the repo at this commit:
  - Workspaces: `contracts/` (types and small shared logic that cross between engine and app), `engine/` (the local Node engine: `src/runtime.ts` the turn loop, `src/api.ts` the `/rpc` handlers, `src/providers/` one driver per agent tool, `src/store.ts` what is saved), `ui/` (React 19 + Vite; `src/app` is the app, `src/liner` the copied library), `desktop/` (the Electron shell; `native/mac.mm` a small Mac addon).
  - Node 24 runs the TypeScript directly: imports end in `.ts`, and the tsconfigs set `erasableSyntaxOnly`, so no enums, no namespaces and no constructor parameter properties.
  - Root scripts: `npm run dev` (engine on port 7317 and the app on http://localhost:5179), `npm run app:dev` (the Electron window against `npm run dev`), `npm run typecheck`, `npm test` (engine then desktop), `npm run test:steady -w engine` (one file at a time, about 11 minutes), `npm run build` (the UI), `npm run mac`, `npm run release`.
  - One test file: `node --test engine/test/<name>.test.ts` or `node --test desktop/test/<name>.test.ts`, from the repo root.
  - A known flaky test under parallel load: "Stop is decisive from the moment it's pressed" in `engine/test/antigravity.test.ts`.
  - Routines are switched off behind `ROUTINES_ON` in `contracts/src/index.ts`; `engine/test/routines-off.test.ts` pins that.
  - `mac/` is an older Swift shell, kept untouched.
  - The Demo provider (`engine/src/providers/demo.ts`) is a scripted agent used for trying the app and for captures.
  - Electron (`44.9.3`) and esbuild (`0.28.2`) are pinned exactly, with matching `allowScripts` entries in the root `package.json`.
  - Commit messages are one plain sentence about what is now true for the person using the app, for example: `A Reviewer block reads as one, without a question's amber`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Shell syntax | `bash -n scripts/sync-liner.sh` | exit 0 |
| Dry run without a source | `LINER_UI=/nonexistent bash scripts/sync-liner.sh; echo $?` | prints the "No Liner UI library" line, then `1` |

## Scope

**In scope**:
- `CLAUDE.md` (create, at the repo root)
- `scripts/sync-liner.sh`

**Out of scope**:
- Anything under `ui/src/liner` (do not run the sync for real).
- `README.md` (plan 001 owns it).
- A `CONTRIBUTING.md` or `SECURITY.md`: the owner decides how outsiders report things.

## Git workflow

- Stay on `design-and-api-endpoints`. One commit for this plan, a plain sentence (example from `git log`: `A Reviewer block reads as one, without a question's amber`). Do not push.

## Steps

### Step 1: Create CLAUDE.md

Create `CLAUDE.md` at the repo root with exactly this content:

````markdown
# Liner Code: notes for coding agents

Liner Code is a desktop agent harness on Electron. It drives the agent tools the person already has (Claude Code, Codex,
ACP agents such as OpenCode and Hermes, and API endpoints). It has no model server and no agent loop of its own: every
feature must work through those tools.

## Commands

```bash
npm run dev                      # the engine on :7317 and the app on http://localhost:5179
npm run app:dev                  # the Electron window against npm run dev (run both)
npm run typecheck                # engine, ui and desktop
npm test                         # engine tests, then desktop tests
npm run test:steady -w engine    # the engine's tests one file at a time (about 11 minutes): use this before a release
node --test engine/test/NAME.test.ts     # one test file
npm run build                    # the UI (vite)
```

Under parallel load one timing test can fail ("Stop is decisive…" in `engine/test/antigravity.test.ts`). Run that file
alone before you blame your change.

## Rules

- **Never run a formatter** (no prettier, no `eslint --fix`). The code is formatted by hand with long lines. Do not re-wrap
  or re-indent lines you did not change.
- **Every bug fix comes with a test that fails without the fix.** Tests are `node:test` in `engine/test` and
  `desktop/test`, with names that are full sentences.
- **Comments are plain sentences that say why**, in the style of the file you are in.
- **TypeScript runs directly on Node 24**: imports end in `.ts`; no enums, no namespaces, no constructor parameter
  properties (`erasableSyntaxOnly`).
- **Commit messages** are one plain sentence about what is now true for the person using the app, for example
  `A Reviewer block reads as one, without a question's amber`. Commit or push only when asked.

## Where things live

- `contracts/src` — the types that cross between the engine and the app, and small logic both sides share.
- `engine/src` — the local engine: `runtime.ts` (the turn loop), `api.ts` (the `/rpc` handlers), `providers/` (one driver
  per agent tool), `store.ts` (what is saved), `server.ts` (the HTTP server on 127.0.0.1).
- `ui/src/app` — the app (React 19): Code, Liner Design (`design/`) and Liner Security (`security/`).
- `desktop/src` — the Electron shell; `desktop/native/mac.mm` is a small Mac addon.

## Do not touch unless asked

- `ui/src/liner` — a copy of the separate Liner UI library. Change it upstream, then `npm run sync-liner`.
- Routines — switched off on purpose behind `ROUTINES_ON` (`contracts/src/index.ts`). Do not fix or re-enable them.
- `mac/` — an older Swift shell, kept as it is.
- The Demo provider and its sample project (`engine/src/providers/demo*.ts`).
- `CHANGELOG.md` — the website is built from it. Notes for the next release go in `docs/CHANGELOG-next.md`.

## Before a release

1. `npm run typecheck` and `npm run test:steady -w engine` and `npm test -w desktop` (the release script runs these).
2. If a provider driver changed (`engine/src/providers`), run it on the real tools against a fake local API first. The
   fakes in the tests have missed real access holes before.
3. Electron, esbuild and the Agent SDK are pinned exactly. Bump the pin and the root `allowScripts` entry together, and
   after an Electron bump make sure `desktop/test/panel-network.test.ts` passes (not skips).

## Docs to keep true

`README.md` ("Your accounts and your data" lists everything the app sends out), `SECURITY_MODEL.md`, `docs/BACKEND.md`.
When the app gains or loses a network request or a route without the token, update them in the same change.
````

**Verify**: `test -f CLAUDE.md && grep -c "Never run a formatter" CLAUDE.md` → `1`.

### Step 2: Make the sync show its changes first

Replace `scripts/sync-liner.sh` with:

```bash
#!/usr/bin/env bash
# Copies the Liner UI library into this app again, after it changes in ../Liner UI.
# Liner Code isn't meant to edit ui/src/liner (app styles live in ui/src/app/app.css), but it has, more than once: so this
# first lists what the copy would lose or gain and stops. --yes does it.
#   npm run sync-liner            lists what would change, and changes nothing
#   npm run sync-liner -- --yes   copies, and records which Liner UI it took in ui/src/liner/UPSTREAM
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${LINER_UI:-../Liner UI}/src/liner"
[ -d "$SRC" ] || { echo "No Liner UI library at $SRC (set LINER_UI to its folder)"; exit 1; }

YES=0
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done

# Edits here that were never committed would be gone for good.
if [[ -n "$(git status --porcelain -- ui/src/liner)" ]]; then
  echo "ui/src/liner has changes that aren't committed. Commit or drop them first." >&2
  exit 1
fi

CHANGES="$(rsync -a --delete --exclude UPSTREAM -n -i "$SRC/" ui/src/liner/)"
if [[ -z "$CHANGES" ]]; then
  echo "✓ ui/src/liner already matches $SRC"
  exit 0
fi
if [[ "$YES" != 1 ]]; then
  echo "$CHANGES"
  echo
  echo "These files in ui/src/liner would be replaced or deleted (a line starting with *deleting is removed)."
  echo "A change made only in this copy is lost unless Liner UI has it too. To go ahead: npm run sync-liner -- --yes"
  exit 1
fi

rsync -a --delete --exclude UPSTREAM "$SRC/" ui/src/liner/
# Which Liner UI this copy is, so the next person can tell.
{
  echo "Copied from Liner UI on $(date +%Y-%m-%d)."
  echo "Commit: $(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo "unknown (the source isn't a git checkout)")"
} > ui/src/liner/UPSTREAM
echo "✓ ui/src/liner now matches $SRC"
```

Keep the file executable (`chmod +x scripts/sync-liner.sh` if its mode changed).

**Verify**: `bash -n scripts/sync-liner.sh` → exit 0; `LINER_UI=/nonexistent bash scripts/sync-liner.sh; echo $?` → the "No Liner UI library" line and `1`; `bash scripts/sync-liner.sh --bogus; echo $?` → `Unknown option: --bogus` and `2` (if `../Liner UI` does not exist on this machine the first check exits `1` instead: that is fine too).

Do NOT run the script with `--yes`.

## Test plan

No automated tests: one file is documentation and the other a maintenance script. The verifications above exercise the script's refusals without copying anything.

## Done criteria

- [ ] `CLAUDE.md` exists at the root with the content above
- [ ] `bash -n scripts/sync-liner.sh` exits 0 and the script contains `--yes`
- [ ] `git status --short ui/src/liner` prints nothing (the copy was not touched)
- [ ] `git status --short` shows no modified file outside the two in scope
- [ ] `plans/README.md` status row updated

## STOP conditions

- A `CLAUDE.md` or `AGENTS.md` already exists.
- Plan 002 has not landed and `npm run test:steady -w engine` does not exist in `engine/package.json` (it does at this commit; if it is gone, report).
- You are about to run the sync with `--yes`.

## Maintenance notes

- For the owner: three commits (`efa7f7b`, `15e0990`, `92fc252`) changed files in the copy. Before the next real sync, check each change exists in Liner UI too, or the sync will list it as a loss.
- `CLAUDE.md` must stay short. Add a rule only after an agent has broken something for lack of it.
