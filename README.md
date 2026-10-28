# Liner Code

A desktop agent harness for macOS, on Electron. It drives the coding agents already on your
machine (Claude Code, Codex CLI, OpenCode, Hermes) with your own sign-ins, and shows their work
as GUI instead of a log: plans you approve, questions you answer, requests that wait as cards,
a diff for every turn that you can undo or commit or question line by line, a Reviewer from
another model family, surfaces beside the session (Terminal, Browser, Files, Pull request, Device,
Routines), models compared side by side, and sessions that sort themselves by what they need
from you. It's built from [Liner UI](https://linerui.sorafel.com), so it has Liner's look and motion:
white paper in a glass frame, one accent, text that comes into focus, springs that never overshoot.

Ideas came from [T3 Code](https://github.com/pingdotgg/t3code) (MIT) and
[Hermes Agent](https://github.com/nousresearch/hermes-agent) (MIT); no code was copied from either.

## Install the alpha

Liner Code is in **alpha** (0.1.x): for Macs with Apple Silicon, tried on macOS 27, and expect
rough edges. Download `Liner-Code-<version>-mac-arm64.dmg` from
[Releases](https://github.com/lynnarize/liner-code/releases), open it and drag Liner Code to
Applications. The alphas aren't notarized by Apple yet, so the first open is blocked: open
System Settings › Privacy & Security, press **Open Anyway** beside Liner Code, and confirm. (Or, in
Terminal: `xattr -dr com.apple.quarantine "/Applications/Liner Code.app"`.) After that it updates
itself from this repository's releases.

You need at least one coding tool installed and signed in: [Claude Code](https://code.claude.com),
[Codex CLI](https://github.com/openai/codex), [OpenCode](https://opencode.ai) or
[Hermes](https://github.com/nousresearch/hermes-agent). Git and the Terminal need Apple's command
line tools; first run says so if they're missing.

Found something? **Help › Report a Problem…** makes a zip with the log and versions and opens an
[issue](https://github.com/lynnarize/liner-code/issues/new/choose).

## Your accounts and your data

- **Sign-ins stay with each tool.** Liner Code runs the tools you installed, unmodified, and asks
  them only whether they're signed in (`claude auth status`, `codex login status`); "Sign in"
  opens the tool's own login in Terminal. It never sees, stores or forwards a sign-in.
- **API keys** you add are sealed in this Mac's keychain and handed to the tool's process in
  memory. For Claude, Anthropic asks apps built on its Agent SDK to use an API key (see its
  [terms](https://code.claude.com/docs/en/legal-and-compliance)), so Settings › Models lets Claude
  Code bill to your Anthropic key.
- **Nothing in between.** Model traffic goes from each tool to its own provider and is billed to
  your account. Liner Code has no server, no telemetry and no analytics. Besides its own releases from GitHub and
  the tools' versions on npm, it fetches the Agent Client Protocol registry when you look for
  agents to add, and reaches GitHub through your `gh` sign-in for pull requests and routines
  (which look every 5 minutes while one is on). Hermes's own update check runs a `git fetch`.
- **The Reviewer is another model family.** A coder's turns are read by another family by default:
  Codex or OpenCode for Claude, Claude for the rest. So with Claude Code and Codex both here, a
  Claude coder's diffs also go to OpenAI through Codex, billed to that account. Set the Reviewer
  to Nobody, or one of the same family, in the agent's settings.
- **Everything else is on this Mac**: sessions, snapshots and settings in `~/.liner-code` (see
  Where things live).

## Run it from source

```bash
npm install
npm run dev          # the engine on :7317 and the app on http://localhost:5179
npm run app:dev      # the Electron window against npm run dev (run both)
npm run app          # the Electron window from the repo, with its own engine
npm run mac          # builds build/Liner Code.app (Electron, about 300 MB)
npm run mac -- --open
npm run release      # the app zipped for GitHub Releases, with its SHA-256 (see Updates below)
npm run typecheck
npm test             # the engine's tests (node:test)
```

`npm run dev` keeps sessions in `~/.liner-code`; set `LINER_HOME` to use another folder (the
window then keeps its own data under `$LINER_HOME/shell` too, so it runs beside your app).
`LINER_INSPECT=1` turns on the Web Inspector, Reload and Inspect Element. The app runs its engine
on Electron's own Node, so it needs no Node installed; building it needs Node 24 and Xcode's
command line tools (for the Mac addon and the icon).

The first launch plays the intro, then three steps: connect models (it finds the CLIs you have),
add projects (it finds your Git repositories), and how you'll work (just a model, a lead and a
coder, or your own team). The **Demo**, a scripted agent with its own **Sample project**, runs
every flow with no account at all. It's hidden: tap your name at the foot of the sidebar six times
to show it (and six more to hide it again).

## What's in it

```
contracts/src/index.ts     everything that crosses the wire: items, threads, events, RPC methods
engine/                    the local backend (Node, TypeScript run directly, one dependency)
  src/main.ts              starts the server; prints LINER_READY {"port":…} for the shell
  src/server.ts            127.0.0.1 only: GET /events (NDJSON stream), POST /rpc, the built app
  src/api.ts               one handler per command
  src/runtime.ts           runs turns: lead → plan → coder and helpers, approvals, questions, queue and steer, the Reviewer loop
  src/review.ts            the Reviewer's prompt and findings, who reviews whom, Claude run modes and subagents
  src/routines.ts          routines: triggers, AI steps, the code gate, actions, test runs
  src/watch.ts             auto-settle and snooze until checks finish or someone replies
  src/updates.ts           Liner Code's releases on GitHub (download, check, stage) and the agent tools' own updaters
  src/surfaces.ts          files, the terminal (a Python pty bridge), gh pull requests, ports, the iOS Simulator
  src/proxy.ts             the Browser surface's proxy: console, element picking, offline
  src/checkpoints.ts       a git snapshot before and after every turn (undo, diff, commit)
  src/store.ts             state.json plus an append-only log per thread
  src/providers/claude.ts  Claude Code through the Claude Agent SDK (canUseTool, resume, fork)
  src/providers/codex.ts   Codex through `codex app-server` (`codex exec --json` for an older Codex), models from its own catalog
  src/providers/acp.ts     any Agent Client Protocol agent: Hermes, OpenCode, Cursor and Grok Build (those two in beta), the ACP registry
  src/providers/demo.ts    a scripted lead and coder, and the sample project it edits
ui/                        the app (React 19 + Vite), built from Liner UI
  src/liner/               the Liner UI library, copied in (npm run sync-liner refreshes it)
  src/app/                 Setup, Sidebar, Home, Session, Timeline cards, Composer, Panel and its surfaces
                           (Review, Files, Terminal, Browser, Pr, Device, Routines, RoutineBuilder), Compare, Usage, Settings
desktop/                   the Electron shell
  src/main.ts              the window, the bridge the page calls, menus with your keys, notifications, the Dock badge
  src/engine.ts            the engine as a child process on Electron's own Node (ELECTRON_RUN_AS_NODE), restarts, your login PATH
  src/keys.ts              API keys sealed with safeStorage; the Swift shell's keychain items come over once
  src/update.ts            puts a downloaded release in the app's place when you restart or quit
  src/preload.ts           window.__LINER__ and window.linerShell for the page, the traffic lights' place as CSS variables
  native/mac.mm            a Node-API addon: vibrancy or Liquid Glass behind the sidebar column only, the traffic lights' frames,
                           the trackpad's tap, and Apple Intelligence's badge kept off text fields
  build.ts, package.ts     bundles the shell and compiles the addon; wraps the app with @electron/packager
mac/                       the older Swift shell (npm run mac:swift builds it into build/swift/)
scripts/                   dev runner, Mac build, release, icon, Liner sync
engine/test/               node:test tests for the engine's pure parts and the proxy
docs/BACKEND.md            what the backend needs, now and later
```

## Where things live

| What | Where |
| --- | --- |
| Projects, threads, agents, settings, groups | `~/.liner-code/state.json` |
| Routines and their runs | `~/.liner-code/routines.json` |
| Scratch sessions with no project | `~/.liner-code/Scratch` (a Git repo) |
| Each thread's timeline | `~/.liner-code/threads/<id>.jsonl` |
| Tokens and cost per turn | `~/.liner-code/usage.jsonl` |
| Worktrees, attachments | `~/.liner-code/worktrees/`, `~/.liner-code/attachments/` |
| Turn snapshots | `refs/liner/<thread>/<turn>-before|after` in each repo |
| API keys | `~/Library/Application Support/Liner Code/keys.json`, sealed with a key macOS keeps in the login keychain as "Liner Code Safe Storage" (the engine gets them in memory only) |
| The window's frame and material | `~/Library/Application Support/Liner Code/shell.json` |
| Engine log | `~/Library/Logs/Liner Code/engine.log`, and `engine.previous.log` from the launch before (a test home's own: `$LINER_HOME/logs`) |
| A downloaded update, waiting to go in | `~/.liner-code/updates/` |

## Updates

Liner Code keeps itself and the agent tools current; both show on Home's corner and in
Settings › Updates, each set to Automatically, Just tell me, or Off. Liner Code itself starts on
Automatically. The tools are yours, so they start on Just tell me.

- **Liner Code** looks at the latest release of its GitHub repository a few seconds after it opens
  and every six hours. It downloads the zip for this Mac, checks it against the release's SHA-256
  (GitHub's own digest, or the `.sha256` file beside the zip), unpacks it and checks it again
  (bundle id, version, signature), then puts it in place when you press Restart to update, or
  when you quit. If it can't take the old copy's place, it says why next time it opens and links
  the release page instead of trying again at every quit. A copy run from source, from a folder
  you can't write to, or from Downloads without being moved to Applications says so and links the
  release page instead. A private repository is read with the GitHub CLI's sign-in.
- **The agent tools** (Claude Code, Codex, OpenCode, Hermes, Grok Build) are compared with where
  each is published (npm; Hermes asks itself). When you press Update (or by themselves, set to
  Automatically), they're updated with their own updaters (`claude update`, `codex update`,
  `opencode upgrade`, `hermes update --yes`), one at a time and only while no session is working
  on that tool. Its idle sessions restart after, and resume where they were.

To publish a release: the repository is package.json's `"repository"`, or else this checkout's
GitHub origin (`npm run mac` writes it into the app, so build after adding it). Then:

```bash
npm run release -- 0.2.0             # sets the version, builds, zips, writes the .sha256
npm run release -- 0.2.0 --publish   # …and creates the release v0.2.0 with gh
```

## Agents and models

| Provider | How | Approvals | Resume | Notes |
| --- | --- | --- | --- | --- |
| Claude Code | Claude Agent SDK, your installed `claude` | yes, all five access levels | yes, and real forks | plans with ExitPlanMode, asks with AskUserQuestion |
| Codex CLI | `codex app-server` | yes: commands, edits and MCP tools (an older Codex's `exec` maps access to its sandbox) | yes | models come from `codex debug models` |
| OpenCode | ACP over stdio | yes | when the agent can | any model OpenCode is set up with |
| Hermes | ACP over stdio | yes | yes | depends on Hermes's own provider being up |
| Cursor, Grok Build | ACP (`cursor-agent acp`, `grok agent stdio`) | yes | when the agent can | Beta: the drivers haven't been run against the real tools yet |
| Demo | scripted | yes | – | edits only its sample project |

## Licence

MIT, see [LICENSE](LICENSE). The app also contains other people's software under their own terms,
listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); the Claude Agent SDK inside it is
Anthropic's and isn't covered by the MIT licence. Tool and model names belong to their owners, and
Liner Code isn't made or endorsed by any of them.
