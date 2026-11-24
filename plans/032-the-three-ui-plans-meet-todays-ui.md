# Plan 032: 018, 020 and 021 run against today's UI, not last Thursday's

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If anything in "STOP conditions" happens, stop and
> report — do not improvise. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3e5bf0a..HEAD -- ui/src/app/Panel.tsx ui/src/app/SessionInfo.tsx ui/src/app/Browser.tsx ui/src/app/app.css ui/src/app/surfaces.css plans/018-one-keyboard-pattern.md plans/020-motion-scroll-and-rescroll.md plans/021-browser-back-and-forward.md`
> If any of those files changed since this plan was written, re-check the "Current state" anchors
> below before proceeding; a mismatch is a STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt (plan hygiene, then three UI fixes)
- **Planned at**: commit `3e5bf0a`, 2026-11-22

## Why this matters

Three planned UI fixes from the 20 November audit are still TODO: 018 (one keyboard pattern),
020 (thin scrollbars, and Changes re-scrolls) and 021 (Browser's Back and Forward grey when there
is nowhere to go). On 22 November, commit `41a5994` ("Fewer buttons and one look everywhere")
rewrote the same files: `Panel.tsx` lost 198 lines, `SessionInfo.tsx`, `Browser.tsx` and
`ui/src/app/app.css` (+1836/−1836) all moved. Every `file:line` citation in those three plans now
points at different code.

**All three findings still hold** — this plan re-anchors them, it does not re-audit them. An
executor that runs 018 as written will grep a line number and find the wrong thing, then either
stop late or "fix" the wrong declaration.

## Current state

What changed, and where each finding lives now. Read the plan named in the first column, then use
the anchor in the last column instead of its old line numbers.

| Plan | Its finding | Old citation | Where it is now (verified at `3e5bf0a`) |
|---|---|---|---|
| 018 | The dock strip's tabs use WAI-ARIA tabs (arrows, Home, End, roving tabindex) | `Panel.tsx:452-460` | The strip is `ui/src/app/Panel.tsx:468` (`role="tablist"`, `onKeyDown={onKey}`, `onFocus={onFocus}`); the roving handler is just above it (~430–455, ending `chips[to].focus()` at 449); each tab carries `role="tab"`/`aria-selected` at `:493-494` |
| 018 | Session surface: a failed check's names exist only in a native `title` on a plain div | `SessionInfo.tsx:160-175` | `SessionInfo.tsx:168-190` (`ChecksLine`, whose `title` is built at `:171`), rendered by `Line` at `:374-380` — still `<div className="lc-sinfo-line" title={title}>`, still no `aria-label`, still unreachable by keyboard |
| 020 | `:where(*)` promises "Every scrollbar thin" but only sets a colour | `app.css:383-387` | `app.css:383-388`: the comment then `:where(*) { scrollbar-color: var(--l-line-2) transparent; }` — `scrollbar-width: thin` is still absent |
| 020 | Docked Changes' re-scroll effect depends on `focus?.path`, so a second press does nothing | `Panel.tsx:685-692` | Same effect, near `Panel.tsx:640-700`; find it by the dependency array `[diff, focus?.path]` |
| 021 | Browser's Back and Forward never carry `disabled` | `Browser.tsx:670-675` | The two buttons are at `Browser.tsx:674-682` (Back) and just below (Forward), still `onClick={() => cmd("back")}` with no `disabled` |

Repo conventions that apply, all of them from `CLAUDE.md` and `plans/README.md`:

- **Never run a formatter.** The code is hand-formatted with long lines. Do not re-wrap a line you
  did not change.
- **Every fix comes with a test that fails without it.** For CSS, that test reads the stylesheet as
  written, in `engine/test/layout-rules.test.ts` (58 existing tests; its `sheet`, `blocks` and
  `value` helpers are at the top of the file). For React behaviour, the UI has no DOM test
  environment: follow whatever each of 018/020/021 says, and say plainly in the commit note what
  was not seen on screen.
- **One local commit per plan**, message one plain sentence about what is now true for the person
  using the app. Never push.
- New CSS goes **in place**, in the rule it corrects. Never append an override block.
- Test commands need `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID`, or `node --test` silently
  runs nothing.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Build the UI | `npm run build` | exit 0 |
| Layout source tests | `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/layout-rules.test.ts` | all pass, count ≥ 58 |

## Scope

**In scope**

- `plans/018-one-keyboard-pattern.md`, `plans/020-motion-scroll-and-rescroll.md`,
  `plans/021-browser-back-and-forward.md` — line-number corrections only, before running them
- The files each of those plans lists as its own scope, and no others

**Out of scope**

- Re-deciding any of the three findings. They are confirmed above; the refresh is mechanical.
- `ui/src/liner/**` (a vendored copy of another library), Routines, `mac/`, the Demo provider,
  `CHANGELOG.md` (release-owned), `docs/CHANGELOG-next.md` (the owner's voice).
- Plans 033, 034 and 035 in this folder — different work.

## Git workflow

Branch: stay where you are. One commit per plan executed (018, then 020, then 021), each with the
message its own plan gives. The plan-file line-number corrections may ride in the same commit as
the plan they correct.

## Steps

### Step 1: Re-anchor 018

Open `plans/018-one-keyboard-pattern.md`. For each `file:line` it gives, open that file and find the
symbol it names (by name, not by number). Replace the stale number with the live one. The table
above covers the two that definitely moved; check the rest the same way.

**Verify**: `grep -n "Panel.tsx:\|SessionInfo.tsx:\|surfaces.css:" plans/018-one-keyboard-pattern.md`
and, for each hit, `sed -n "<line>p"` the cited file → the code there is the code the plan
describes. If any citation cannot be reconciled because the code it named is gone, go to STOP.

### Step 2: Re-anchor 020 and 021

Same treatment. In 020 the scrollbar anchor is `app.css:385-387` (the `:where(*)` rule) and the
Changes effect is found by its dependency array; in 021 the two buttons are `Browser.tsx:674-682`.

**Verify**: `grep -c "app.css:38" plans/020-motion-scroll-and-rescroll.md` → every one resolves to
the `:where(*)` rule or the thread's `.lc-scroll`; `sed -n 674,682p ui/src/app/Browser.tsx` → the
Back button and Forward's markup.

### Step 3: Execute 018

Follow `plans/018-one-keyboard-pattern.md` as written, with the corrected anchors.

**Verify**: `npm run typecheck` → 0; `npm run build` → 0; the source tests its steps add → pass.
Then the plan's own done criteria.

### Step 4: Execute 020

**Verify**: as above, plus the plan's on-screen note: the scrollbar step must be looked at once with
macOS "Show scroll bars: Always", because a CSS change reasoned but never seen has been wrong in
this repo before. If you cannot look, say so in the commit note rather than claiming it.

### Step 5: Execute 021

**Verify**: `npm run typecheck` → 0; `npm run build` → 0. 021's desktops tests, if it names any, run
with `npm test -w desktop`.

## Test plan

Each of 018/020/021 brings its own tests, and this plan adds none of its own (it changes plan text
and then runs other plans). Before writing any of them, read the existing helper at the top of
`engine/test/layout-rules.test.ts` and model new assertions on an existing one, e.g. "A finding's
footer wraps instead of spilling out of a narrow panel".

**Verify**: `env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test engine/test/layout-rules.test.ts`
→ all pass, with the new tests' names present in the output.

## Done criteria

- [ ] Every `file:line` in 018, 020 and 021 resolves to the code it describes
- [ ] All three plans' own done criteria hold, in three separate commits
- [ ] `npm run typecheck` exits 0 and `npm run build` exits 0 after each
- [ ] `git status` shows no file outside each plan's scope
- [ ] Rows for 018, 020 and 021 in `plans/README.md` say DONE (or BLOCKED with the reason)

## STOP conditions

Stop and report if:

- A citation names code that no longer exists and you cannot find its replacement by symbol name
  (the finding may have been fixed by `41a5994`).
- Any of the three findings turns out not to hold at `3e5bf0a` — mark that plan REJECTED in
  `plans/README.md` with the one-line evidence, and leave its file untouched.
- Running 018 requires editing a file its own scope list does not name.

## Maintenance notes

- `41a5994` is the reason this plan exists. The next large UI change should be followed by a
  `grep` over `plans/` for the files it touched, before anyone executes an older plan.
- 018 and 020 both edit `Panel.tsx`, and 020 also edits `app.css` and `surfaces.css`. Run them one
  at a time, never in parallel.
- A reviewer should check that the line-number edits changed nothing but numbers and symbol names —
  no rewording of a finding.
