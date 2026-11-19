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
