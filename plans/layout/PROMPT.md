# Prompt for the model that does the layout fixes

Copy everything below the line into the other model, started in this repository's root folder
(`Liner Code`, branch `design-and-api-endpoints`, at or after commit `125db4f`).

---

You are fixing a set of audited layout problems in this repository's desktop app (Electron, React 19, hand-written CSS).
Another session audited the layout, measured the running app, and wrote one plan per fix in `plans/layout/`. It will audit
your work against those plans when you are done. Your job is to carry the plans out exactly, one at a time. You are not
redesigning anything.

## What to read first

1. `CLAUDE.md` in the repo root: the house rules. They override your habits.
2. `plans/layout/README.md`: what was found, the order, the rules that hold for every plan, how to write the source test,
   how to start the measuring build, the baseline numbers, and the decisions already taken.
3. Then one plan at a time, in order: `plans/layout/L01-…md` to `L12-…md`. Read a plan to the end before you change
   anything for it.

Each plan has everything you need for that fix: why it matters, the code as it is today with file and line, the exact
change, what to measure afterwards, and STOP conditions. Do not go looking for a better fix than the plan describes, and do
not fix other things you notice on the way: write them under "Executor notes" in `plans/layout/README.md` instead.

Ignore `plans/001` to `plans/014` and `plans/PROMPT.md`: they are an older, finished job.

## How to work

- Do the plans in order, one at a time. L05 before L06. L11 after L05 and L06. L12 last.
- Before your first plan, start the measuring build (README, "The measuring build") and save the numbers:
  `node plans/layout/check/measure.mjs http://localhost:5199 > /tmp/layout-before.json`. Compare them with the README's
  baseline. If they differ, say so in Executor notes before you start.
- Start each plan with its **drift check**. If the code no longer matches what the plan quotes, stop that plan and report;
  do not adapt the plan yourself. (L10 is the exception: there a step that has drifted is skipped and the rest go on.)
- Where a plan gives a **source test**, write it first in `engine/test/layout-rules.test.ts` and see it fail for the stated
  reason. A test that passes before the fix means the code is not as the plan says: stop and report.
- After each step that has a **Verify**, run it and compare before moving on. After each plan run:
  `npm run typecheck`, `npm run build`, `node --test engine/test/layout-rules.test.ts`, and the measure script.
- When a **STOP condition** occurs: stop that plan, leave the tree type-checking and building (revert your partial change
  with `git checkout -- <files>` if needed), write `BLOCKED` with one line of why under Executor notes, and go on to the
  next plan that does not depend on it.
- One local commit per finished plan, with the commit message the plan gives (one plain sentence about what is now true for
  the person using the app), ending with your own co-author line if you add one. Never push. Never amend.

## Rules you must not break

- **Never run a formatter**: no prettier, no `eslint --fix`, no editor format-on-save. The code is formatted by hand with
  long lines. Do not re-wrap, re-indent or reorder anything you did not have to change. If your diff for a plan touches
  more lines than the plan's steps name, something reformatted the file: revert and redo it by hand.
- **Do not touch** `ui/src/liner/` (a vendored library: where its styles are wrong for the app, the plan overrides them
  from the app's own sheet), `Routines.tsx`, `RoutineBuilder.tsx` and the CSS only they use, `mac/`,
  `engine/src/providers/demo*.ts`, `CHANGELOG.md`.
- **Change CSS in place.** Edit the rule that is wrong. Do not add a new block at the end of a file to override it: the
  audit exists because the sheets were grown that way. No `!important`.
- **Comments are plain sentences that say why.** When you change a rule whose comment describes the old behaviour, fix the
  comment in the same edit.
- TypeScript runs directly on Node 24: imports end in `.ts`, no enums, no namespaces, no constructor parameter properties.
- Do not start any real agent tool. The measuring build has only the Demo agent on purpose.
- Do not invent a measurement or say you looked at a screen you did not. If you cannot run a browser, say so once in
  Executor notes, do what can be verified by source tests, typecheck and build, and mark every measured criterion
  "not measured".

## When you are done

Fill in "Executor notes" at the end of `plans/layout/README.md`: for each plan `DONE <commit hash>`, `BLOCKED <why>` or
`SKIPPED <why>`; the before and after output of the measure script; every step you skipped and why; everything you could
not see on screen; and anything you noticed that the plans do not cover. Then stop. Do not push, do not open a pull
request, do not update the changelog.
