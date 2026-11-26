# Contributing

Lin ([@lynnarize](https://github.com/lynnarize)) maintains Liner Code alone. Questions go in
[Discussions](https://github.com/lynnarize/liner-code/discussions), which is being turned on: Q&A
for something that won't start, Ideas for what it should do, and Early testers for how the beta
feels. A bug is a
[bug report](https://github.com/lynnarize/liner-code/issues/new?template=bug.yml). Something the
app could do is a [feature request](https://github.com/lynnarize/liner-code/issues/new?template=idea.yml).
A vulnerability is not an issue: see [SECURITY.md](SECURITY.md).

**Help › Report a Problem…** in the app opens the bug report and can attach a zip of the log and
the versions. Look through the log before you attach it. It can hold folder names and parts of
what the agents did.

## Set up

Node 24 or newer (see `engines` in `package.json`) and npm. Git. On a Mac, building the app also
needs Xcode's command line tools, for the Mac addon and the icon.

```bash
npm install
npm run dev          # the engine on :7317 and the app on http://localhost:5179
npm run app:dev      # the Electron window against npm run dev (run both)
```

`npm run dev` keeps sessions in `~/.liner-code`. Set `LINER_HOME` to use another folder. The
window then keeps its own data under `$LINER_HOME/shell` too, so it runs beside the installed app.

CI installs with `npm ci` from `package-lock.json`.

There is no lint script and no formatter config. The code is formatted by hand. Don't run
Prettier or `eslint --fix`, and don't rewrap a line you didn't change.

## Tests

```bash
npm run typecheck
npm test                              # engine tests, then desktop tests
npm run test:steady -w engine         # the engine's tests, one file at a time
node --test engine/test/NAME.test.ts  # one engine file
npm test -w desktop                   # the desktop shell
npm run build                         # the UI (vite)
```

The Check workflow runs those on macOS: `npm run typecheck`, `npm run build`,
`npm run test:steady -w engine`, `node desktop/build.ts`, and `npm test -w desktop`. Some engine
tests call `codesign`, `sandbox-exec` and `ditto`, and the desktop tests start Electron. A test
that needs one of those skips where the tool isn't there, so `npm test` still runs off a Mac.

One timing test can fail when the machine is busy ("Stop is decisive…" in
`engine/test/antigravity.test.ts`). Run that file alone before you blame your change.

A bug fix comes with a test that fails without the fix. Tests are `node:test`, in `engine/test`
and `desktop/test`, and the name is a full sentence.

## A pull request from a fork

1. Fork the repository and clone your fork.
2. Branch from `main`. Open a pull request into `main` on `lynnarize/liner-code`.
3. The Check workflow runs on `pull_request`. A fork's code runs with a read-only token and no
   secrets. The check that has to pass is named `check`.
4. Lin reviews. Say what you changed and how you checked it. Resolve review conversations.

Commit messages are one plain sentence about what is now true for the person using the app, for
example `A Reviewer block reads as one, without a question's amber`.

Merge commits and squash merges are both used. Either is fine.

## Leave these unless you were asked

- `ui/src/liner` is a copy of the Liner UI library. Change it upstream, then `npm run sync-liner`.
- Routines are switched off on purpose (`ROUTINES_ON` in `contracts/src/index.ts`).
- `mac/` is an older Swift shell.
- The Demo provider and its sample project (`engine/src/providers/demo*.ts`).
- `CHANGELOG.md` is what the website is built from. Notes for the next release go in
  `docs/CHANGELOG-next.md`.

What the app sends off the machine is in the README ("Your accounts and your data") and in
[SECURITY_MODEL.md](SECURITY_MODEL.md). If a change adds or drops a network request, or a route
that doesn't check the token, update those in the same pull request.
