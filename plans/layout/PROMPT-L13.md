# Prompt for the model that does L13

Copy everything below the line into the other model, started in this repository's root folder
(`Liner Code`, branch `design-and-api-endpoints`, at or after commit `bfb0ebc`).

---

You are finishing a layout job in this repository's desktop app (Electron, React 19, hand-written CSS). Twelve plans in
`plans/layout/` were carried out and audited. The audit found seven small faults, and one more plan fixes them:
`plans/layout/L13-after-the-audit.md`. Carry out that plan exactly. You are not redesigning anything.

Read first, in this order: `CLAUDE.md`; in `plans/layout/README.md` the sections "Rules for every plan", "The source
test", "The measuring build" and "The advisor's audit of the work"; then `L13-after-the-audit.md` to its end.

How to work:

- Start the measuring build if it is not running (README) and save
  `node plans/layout/check/measure.mjs http://localhost:5199 > /tmp/layout-l13-before.json`. The four keys L13 names must
  read as its opening block says. If they do not, stop and say so.
- Do the steps in order. For each: the drift check, then the source test in `engine/test/layout-rules.test.ts` written
  first and seen to fail, then the change, then its Verify.
- After the last step: `npm run typecheck`, `npm run build`, `node --test engine/test/layout-rules.test.ts`, the measure
  script, and compare every key with the "before" file. Only the four keys may differ.
- One local commit for the whole plan, with the plan's commit message. Never push. Never amend.

Rules you must not break:

- Never run a formatter. Do not re-wrap, re-indent or reorder anything you did not have to change.
- Change CSS in place, in the rule the plan names. No `!important`. No block appended at the end of a file.
- Do not touch `ui/src/liner/`, Routines, `mac/`, `engine/src/providers/demo*.ts`, `CHANGELOG.md`.
- Comments are plain sentences that say why.
- Do not start any real agent tool. Do not say you saw a screen you did not see.
- A STOP condition means stop that step, leave the tree building, and report.

When you are done, fill in "Executor notes" in `plans/layout/README.md`: `L13 DONE <commit>` with the before and after of
the four keys and what you could not see, and one line each for L07 to L12 saying only what is on record (their commits).
Then stop. Do not push, do not open a pull request, do not update the changelog.
