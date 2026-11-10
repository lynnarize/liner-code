<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/readme/icon-dark.png">
  <img src=".github/readme/icon.png" width="112" alt="Liner Code icon">
</picture>

# Liner Code

**Your coding agents, with a real app around them.**

Claude Code, Codex, OpenCode and Hermes on your desktop, with your own sign-ins:
plans you approve, a diff for every turn, a check from another maker, and a quicker model
beside the lead for the work it can hand over.

[![Release](https://img.shields.io/github/v/release/lynnarize/liner-code?include_prereleases&label=release&color=2f6fe4&style=flat-square)](https://github.com/lynnarize/liner-code/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/lynnarize/liner-code/total?color=1f9d55&style=flat-square)](https://github.com/lynnarize/liner-code/releases)
[![Status](https://img.shields.io/badge/status-beta-2f6fe4?style=flat-square)](CHANGELOG.md)
[![License](https://img.shields.io/github/license/lynnarize/liner-code?color=4a4f59&style=flat-square)](LICENSE)
<br>
[![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-1b1d22?logo=apple&logoColor=white&style=flat-square)](#install-the-beta)
[![Windows](https://img.shields.io/badge/Windows-x64-1b1d22?logo=windows&logoColor=white&style=flat-square)](#install-the-beta)
[![Electron](https://img.shields.io/badge/Electron-47848f?logo=electron&logoColor=white&style=flat-square)](desktop/)
[![React 19](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white&style=flat-square)](ui/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white&style=flat-square)](engine/)
[![Stars](https://img.shields.io/github/stars/lynnarize/liner-code?color=e2412f&style=flat-square)](https://github.com/lynnarize/liner-code/stargazers)

[![Download for macOS](https://img.shields.io/badge/Download_for_macOS-.dmg-e2412f?logo=apple&logoColor=white&style=for-the-badge)](https://github.com/lynnarize/liner-code/releases/latest)
&nbsp;
[![Download for Windows](https://img.shields.io/badge/Download_for_Windows-.exe-1b1d22?logo=windows&logoColor=white&style=for-the-badge)](https://github.com/lynnarize/liner-code/releases/latest)

[Install](#install-the-beta) · [Features](#features) · [How agents share the work](#how-agents-share-the-work) · [Designs](#designs) · [API endpoints](#api-endpoints) · [Run from source](#run-it-from-source) · [Changelog](CHANGELOG.md)

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/readme/hero-dark.jpg">
  <img src=".github/readme/hero-light.jpg" width="100%" alt="Liner Code: a session where the agent asks a question as a card before it changes anything">
</picture>

</div>

## What it is

A desktop agent harness for macOS and Windows, on Electron. It drives the coding agents already on your
machine (Claude Code, Codex CLI, OpenCode, Hermes) with your own sign-ins, and shows their work
as GUI instead of a log: plans you approve, questions you answer, requests that wait as cards,
a diff for every turn that you can undo or commit or question line by line, a lead that can hand
bounded work to a quicker model beside it, a Reviewer from another model family, surfaces in a
panel beside the session (Changes, Files, Browser, Terminal, Design, Pull request, Device), models
compared side by side, and sessions that sort themselves by what they need from you. It's built from [Liner UI](https://linerui.sorafel.com), so it has Liner's look and motion:
white paper on one solid ground, glass only on the session tray, one accent, text that comes into
focus, springs that never overshoot.

<table>
  <tr>
    <td align="center"><b>Claude Code</b><br><sub>Agent SDK</sub></td>
    <td align="center"><b>Codex CLI</b><br><sub>app server</sub></td>
    <td align="center"><b>OpenCode</b><br><sub>ACP</sub></td>
    <td align="center"><b>Hermes</b><br><sub>ACP</sub></td>
    <td align="center"><b>Cursor · Grok Build</b><br><sub>ACP, beta</sub></td>
    <td align="center"><b>API endpoints</b><br><sub>DeepSeek, Kimi, GLM, OpenRouter, Ollama…</sub></td>
  </tr>
</table>

## Features

<table>
  <tr>
    <td width="33%" valign="top">
      <img src=".github/readme/pair.svg" width="100%" alt="Wireframe: a lead's brief worked by its sidekick, then verified by the Reviewer">
      <b>Lead + sidekick</b><br>
      <sub>The lead plans and hands bounded work to a quicker model beside it, then reads what it did.</sub>
    </td>
    <td width="33%" valign="top">
      <img src=".github/readme/diff.svg" width="100%" alt="Wireframe: a turn's diff with Undo turn and Commit">
      <b>Every turn is a diff</b><br>
      <sub>A git snapshot before and after each turn: undo it, commit it, or ask about a line.</sub>
    </td>
    <td width="33%" valign="top">
      <img src=".github/readme/check.svg" width="100%" alt="Wireframe: the Reviewer's five criteria, one sent back">
      <b>Checked by another maker</b><br>
      <sub>A model of another maker reads each change against five fixed criteria. It never wrote it.</sub>
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <img src=".github/readme/design.svg" width="100%" alt="Wireframe: the Design surface with a comment on a part">
      <b>Designs beside the session</b><br>
      <sub>Any agent draws a screen; point at a part to change it, then Build it.</sub>
    </td>
    <td width="33%" valign="top">
      <img src=".github/readme/surfaces.svg" width="100%" alt="Wireframe: the surfaces tabs with the Terminal open">
      <b>Surfaces</b><br>
      <sub>Changes, Files, Browser, Terminal, Design, Pull request and Device, in the panel beside the session.</sub>
    </td>
    <td width="33%" valign="top">
      <img src=".github/readme/desk.svg" width="100%" alt="Wireframe: the Desk, sessions grouped by what they need">
      <b>The Desk</b><br>
      <sub>Sessions sort themselves: back with you, out with agents, done.</sub>
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <img src=".github/readme/compare.svg" width="100%" alt="Wireframe: two models' answers side by side">
      <b>Models side by side</b><br>
      <sub>One prompt to the models you have, with what each cost, and keep the best.</sub>
    </td>
    <td width="33%" valign="top">
      <img src=".github/readme/workshop.svg" width="100%" alt="Wireframe: Workshop making an add-on">
      <b>Workshop</b><br>
      <sub>Ask for what Liner Code doesn't have; an agent makes it as an add-on.</sub>
    </td>
    <td width="33%" valign="top"></td>
  </tr>
</table>

## Screenshots

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/readme/desk-dark.jpg">
        <img src=".github/readme/desk-light.jpg" width="100%" alt="The Desk and a case ready to commit">
      </picture>
      <p align="center"><sub><b>The Desk</b>: every agent's work in one place</sub></p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/readme/plan-dark.jpg">
        <img src=".github/readme/plan-light.jpg" width="100%" alt="A plan card with Approve and start">
      </picture>
      <p align="center"><sub><b>Plans</b>: approve it, then it builds</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/readme/diff-dark.jpg">
        <img src=".github/readme/diff-light.jpg" width="100%" alt="The diff panel with Undo turn and Commit">
      </picture>
      <p align="center"><sub><b>Diffs</b>: every turn, undoable</sub></p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/readme/pr-dark.jpg">
        <img src=".github/readme/pr-light.jpg" width="100%" alt="The pull request card">
      </picture>
      <p align="center"><sub><b>Pull requests</b>: checks and reviews beside the session</sub></p>
    </td>
  </tr>
</table>

<sub>Screenshots are the real app on a sample project (0.1.2 and 0.1.5, with a scripted demo agent);
the feature pictures above are wireframes. Both follow your system's light or dark theme.</sub>

Ideas came from [T3 Code](https://github.com/pingdotgg/t3code) (MIT) and
[Hermes Agent](https://github.com/nousresearch/hermes-agent) (MIT); no code was copied from either.
The Design surface takes ideas from [Kun](https://github.com/KunAgent/Kun)'s Design mode
(PolyForm Noncommercial), and from T3 Code's HTML previews; no code was copied from them either.

## Install the beta

Liner Code is in **beta** (since 0.2.4): for Macs with Apple Silicon, tried on macOS 27, and still
with rough edges. Download `Liner-Code-<version>-mac-arm64.dmg` from
[Releases](https://github.com/lynnarize/liner-code/releases), open it and drag Liner Code to
Applications. It isn't notarized by Apple yet, so the first open is blocked: open
System Settings › Privacy & Security, press **Open Anyway** beside Liner Code, and confirm. (Or, in
Terminal: `xattr -dr com.apple.quarantine "/Applications/Liner Code.app"`.) After that it updates
itself from this repository's releases.

**On Windows** (x64, new in 0.1.9): download `Liner-Code-<version>-win-x64-setup.exe` and run it.
It installs for you alone, with no administrator, and puts Liner Code in the Start menu; Settings ›
Apps removes it again, leaving your sessions and settings. It isn't signed yet, so SmartScreen asks
the first time: **More info › Run anyway**. It doesn't update itself yet: run the next setup, which
puts the new version in place of the old one. To run it without installing, unzip
`Liner-Code-<version>-win-x64.zip` anywhere and open `Liner Code.exe`. Its Terminal is PowerShell,
without full-screen programs for now. Building it from a Mac: `npm run win` (it needs NSIS:
`brew install makensis`).

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
- **API keys** you add (an endpoint's too) are sealed in this Mac's keychain and handed to the
  tool's process in memory. For Claude, Anthropic asks apps built on its Agent SDK to use an API key (see its
  [terms](https://code.claude.com/docs/en/legal-and-compliance)), so Settings › Models lets Claude
  Code bill to your Anthropic key.
- **Nothing in between.** Model traffic goes from each tool to its own provider and is billed to
  your account. Liner Code has no server, no telemetry and no analytics. Besides its own releases from GitHub and
  the tools' versions on npm, it fetches the Agent Client Protocol registry when you look for
  agents to add, and reaches GitHub through your `gh` sign-in for pull requests. Hermes's own
  update check runs a `git fetch`.
- **Changes are checked by another maker.** By default the Reviewer reads each change, and it's a
  model of another maker than the ones that wrote it whenever one is ready. So with Claude Code and
  Codex both here, diffs Claude writes also go to OpenAI through Codex, billed to that account. A
  pair's sidekick can be another maker's model too, and then its briefs and what it reads go to
  that maker. Turn the Reviewer off in Settings › Agentic features, or for one session from its
  word in the session's bar.
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
add projects (it finds your Git repositories), and who works on a new session (a pair, the best
model alone, or the fast one alone). The **Demo**, a scripted agent with its own **Sample project**,
runs every flow with no account at all, a pair included. It's hidden: tap your name at the foot
of the sidebar six times to show it (and six more to hide it again).

## How agents share the work

A session is one model or a pair, and in both one model writes at a time (`engine/src/runtime.ts`,
`sidekick.ts`, `review.ts`; who is picked, `contracts/src/cast.ts`). Agents are optional: every
part is a bare model unless you pick one of your agents, which you make when a model should carry
instructions of its own (a soul.md, a prompt, skills, context files).

```
 One model   You ──► the model, or one of your agents ──────────────► Reviewer ──► yours

 A pair      You ──► Lead: talks to you, plans, decides ────────────► Reviewer ──► yours
                      │                  ▲                               │
                      │ one brief        │ its report, and the files     │ blocking findings go back
                      ▼ at a time        │ it changed, measured          │ to the lead, up to 2 rounds
                     Sidekick ───────────┘                               ▼
                     same folder, same access level             the lead fixes them
```

**The lead and the sidekick.** In a pair the lead owns the session: it talks to you, does the
reading that decides the plan, takes the judgment calls, and hands bounded work to a quicker model
beside it through Liner Code's own `sidekick` tool: an edit it can spell out, the same change in
many files, a test or build run it would otherwise wait on. It hands over one brief at a time and
waits for it. The sidekick works in the same folder under the session's access level, and runs
each brief as a turn of a session of its own, which it keeps between briefs, so the lead can
correct it rather than start over. A brief runs ten minutes at most, less when the lead's tool
gives up on a call sooner. The sidekick's report is a claim: the lead gets it with the files it
changed as Liner Code measured them, and reads them before it builds on them or tells you it's
done. A frontier-class sidekick gets lighter briefs and may push back; a quicker one gets
prescriptive ones.

**What you see.** A brief shows as a row under the lead's turn: its steps, its tokens, its report
and the files it changed. Stop on its row stops the sidekick alone; the session's Stop stops both.
Its approvals use the same cards as the lead's. It can't ask you anything, and it may not send
agents of its own: one that tries is stopped, and the lead is told why. A pair works with Claude
Code, Codex, OpenCode and Hermes, in any mix. A fix the Reviewer sends back carries your turn on
rather than starting one of its own, so the timeline shows one turn with one footer for all its
changes, and "done" is said once, when everything your message set off is done.

**Picking who works.** The model picker starts with **Pair**, **Best** (the lead alone) and
**Fast** (the sidekick alone), filled in from what's ready, then every model by tool, then your
agents. Picking Pair shows who leads and who works beside it. Settings › Agentic features has two
parts: your pair (the lead, the sidekick, and what new sessions start with) and the Reviewer.

| | Lead | Sidekick | Reviewer |
| --- | --- | --- | --- |
| Does | talks to you, plans, decides, reads the sidekick's work, fixes what the Reviewer sends back | the briefs the lead hands it | reads each change against five fixed criteria |
| Automatic | the best frontier model ready: Opus, else GPT Astra, Fable, Gemini, Sol, GLM… | the best quicker model that isn't the lead: DeepSeek Flash, else Sol, Sonnet, Terra, Luna… | the best model of another maker than the writers' |
| Alone | Best | Fast | – |

Each starts on Automatic, which says what it lands on. Models are told apart by who made them,
from their names, so GPT Astra counts as OpenAI's whether it runs in Codex, Hermes or an API
endpoint, and each maker's models come from its own tool first (Claude Code for Claude, Codex for
GPT). Any model a tool here runs can be picked for any part, Chinese ones through OpenCode, Hermes
or an endpoint included, and none of it needs a Claude or ChatGPT subscription. With only OpenCode
Go there's no pair: DeepSeek Flash does it all (Go's frontier-class models never lead, as they draw
down the plan's capped allowance at many times the price) and GLM Flash reads its changes. The
picker goes tool, then source (Hermes's Nous Portal or OpenCode Go), then model, so a tool with a
hundred models is two short lists.

**The Reviewer.** When a turn changed files, the Reviewer reads the change against five fixed
criteria before it's yours; blocking findings go back to the lead, up to 2 rounds by default (3 at
most), then it's yours. It's a model of another maker than the ones that wrote the change whenever
one is ready, so they don't share blind spots, and it's never one of the writers, the sidekick
included. It's on by default. Its word in the session's bar (Reviewing, Verified, Blocked, or
Reviewer off) opens a menu: read each change or not, and who reads. A change whose check was
skipped because you'd queued a message is read afterwards, from where it started. A fix that
changed nothing isn't read a second time: it's yours, and it says so. A read is given up after ten
minutes. A few lines, or docs alone, go through as they are unless you turn on Small changes too.

**Inside Claude Code**, a lead (an agent or a bare model) brings two helpers on Haiku: an Explorer
that reads, greps and maps the code, and a Test runner that runs the tests and reports the first
useful line. One of your agents can run alone instead.

### What keeps the cost down

- **The lead hands over what it can spell out.** Edits it can specify, the same change in many
  files, and slow test or build runs go to the quicker sidekick; the lead keeps the reading that
  decides the plan, and the judgment calls.
- **Checks aren't run twice.** The lead is told not to run a check again that the sidekick ran and
  reported, unless the report or the diff gives it a reason to doubt it.
- **Haiku does the reading.** Explorer and Test runner keep long file reads and test output out
  of the lead's context, so the lead's model never pays for them.
- **You see when the cache runs out.** The composer shows when Claude's prompt cache for the
  session is likely to run out (an hour after the last turn on a plan, five minutes with an API
  key); past it a long thread is read again at full price.
- **Small things go to the quickest model.** Commit messages, pull request text and Reviewer
  decides (ALLOW or ASK for one step) run on Haiku or a mini model, not the session's own.
- **Checks have a limit.** At most 2 fix rounds by default (3 at most); after that it's yours.
- **A spending cap.** Settings › General › Spending can stop a session at a dollar amount; your
  next message is the go-ahead for another cap's worth. A sidekick's use counts toward it. (Claude
  Code reports cost; other tools can't be held to it.)
- **You can see it all.** Every turn's tokens, cache reads and cost, by agent and model, go to
  `~/.liner-code/usage.jsonl`, and the Usage page adds them up.

## Designs

Ask any agent for a screen, a page or a prototype and it draws it in the **Design** surface
beside the session (⌘⇧E), the same with Claude Code, Codex, OpenCode, Hermes, any ACP agent or a
model from an API endpoint (see API endpoints below):

```
 You: "Design the settings screen"
   │
   ▼
 Agent writes .liner/designs/settings.html          (its own Write/Edit tools; or hands the page over whole)
   │  design_show { title, path, size }            (Liner Code's MCP server, which every agent tool gets)
   ▼
 Liner Code keeps it as version n ───────────────► timeline card with a picture of it
   │  draws it out of sight at its size ─────────► the agent gets the picture, its height and its console errors back
   ▼
 Design surface: Desktop / Tablet / Phone, Live or any version, the code, light or dark
   │  pick a part and comment ─────────────────────► the agent gets the element and your words, edits, shows v(n+1)
   │  Build it ────────────────────────────────────► the agent builds it with the project's own components
   ▼  Bring back version 2 ────────────────────────► v2 goes back in the file, as v(n+1)
```

- **One file, edited in place.** A design is one self-contained HTML file in the session's folder
  (`.liner/designs/` by default). The agent changes it with its own edit tools, so a change costs
  an edit, not the whole page again; the surface draws each edit as it lands, the next drawing
  loading behind the one you see.
- **Not your project's changes.** `.liner/` goes in the repository's `info/exclude` with the first
  design and is left out of every turn's snapshot, so designs never show in the diff or a commit.
- **The agent sees what it drew.** `design_show` answers with a picture of the design at its size
  and as tall as it is (up to 2400 px), at its own pixels, with the errors it logged, so the agent
  can fix what's off before it says it's done.
- **No way into the app.** A version is drawn on its own with no origin; the live file comes from
  the session folder's own address on 127.0.0.1. An agent that can't write files (on Read only,
  say) draws a design by handing over the page; asking for it to be built is a change like any other.

## What's in it

<details>
<summary>The repository, folder by folder</summary>

```
contracts/src/index.ts     everything that crosses the wire: items, threads, events, RPC methods
contracts/src/cast.ts      who leads, who is the sidekick and who reviews, from your picks and what's ready
contracts/src/tiers.ts     the model lists casting reads: who made a model, and the frontier and quicker tiers
engine/                    the local backend (Node, TypeScript run directly, one dependency)
  src/main.ts              starts the server; prints LINER_READY {"port":…} for the shell
  src/server.ts            127.0.0.1 only: GET /events (NDJSON stream), POST /rpc, the built app
  src/api.ts               one handler per command
  src/runtime.ts           runs turns: the lead's turn, a pair's briefs to its sidekick, approvals, questions, queue and steer, the Reviewer's rounds
  src/sidekick.ts          lead + sidekick: what each is told, a brief's time cap, what the lead reads back
  src/review.ts            the Reviewer's prompt and findings, the fix the lead is sent, Reviewer decides, Claude run modes and subagents
  src/routines.ts          routines (switched off for now: ROUTINES_ON in contracts): triggers, AI steps, the code gate, actions, test runs
  src/watch.ts             auto-settle and snooze until checks finish or someone replies
  src/updates.ts           Liner Code's releases on GitHub (download, check, stage) and the agent tools' own updaters
  src/surfaces.ts          files, the terminal (a Python pty bridge), gh pull requests, ports, the iOS Simulator
  src/proxy.ts             the Browser surface's proxy: console, element picking, offline
  src/designs.ts           designs: versions, the file each lives in, watching it, keeping .liner/ out of git
  src/agent-tools.ts       what agents reach of the app through mcp.ts: the Browser, the simulator, pages, designs, memory
  src/liner-tools.ts       Liner Code's own tools as agents are told of them, `sidekick` offered to a pair's lead only
  src/checkpoints.ts       a git snapshot before and after every turn (undo, diff, commit)
  src/store.ts             state.json plus an append-only log per thread
  src/providers/claude.ts  Claude Code through the Claude Agent SDK (canUseTool, resume, fork)
  src/providers/codex.ts   Codex through `codex app-server` (`codex exec --json` for an older Codex), models from its own catalog
  src/providers/acp.ts     any Agent Client Protocol agent: Hermes, OpenCode, Cursor and Grok Build (those two in beta), the ACP registry
  src/providers/demo.ts    a scripted agent that leads a pair or works a brief, and the sample project it edits
  src/providers/endpoint.ts  an API endpoint as a tool: Claude Code, Codex or OpenCode pointed at it, by protocol
ui/                        the app (React 19 + Vite), built from Liner UI
  src/liner/               the Liner UI library, copied in (npm run sync-liner refreshes it)
  src/app/                 Setup, Sidebar, Home, Session, Timeline cards, Composer, Panel and its surfaces
                           (Review, Files, Terminal, Browser, Design, Pr, Device; Routines and RoutineBuilder, off for now),
                           Compare, Usage, Settings, Agentic (your pair and the Reviewer)
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
scripts/                   dev runner, Mac and Windows builds (windows/: the setup), release, icon, Liner sync
engine/test/               node:test tests for the engine's pure parts and the proxy
docs/BACKEND.md            what the backend needs, now and later
```

</details>

## Where things live

<details>
<summary>Every file Liner Code keeps, and where</summary>

| What | Where |
| --- | --- |
| Projects, threads, agents, settings, groups | `~/.liner-code/state.json` |
| That state as it was before sessions moved over to pairs (0.2.5), copied once | `~/.liner-code/state.before-pairs.json` |
| Routines and their runs (kept while routines are off) | `~/.liner-code/routines.json` |
| Scratch sessions with no project | `~/.liner-code/Scratch` (a Git repo) |
| Each thread's timeline | `~/.liner-code/threads/<id>.jsonl` |
| Tokens and cost per turn | `~/.liner-code/usage.jsonl` |
| Worktrees, attachments | `~/.liner-code/worktrees/`, `~/.liner-code/attachments/` |
| Turn snapshots | `refs/liner/<thread>/<turn>-before|after` in each repo |
| A design's file, and its versions | `.liner/designs/` in the session's folder; `~/.liner-code/designs/<thread>/<design>/v<n>.html` |
| API keys | `~/Library/Application Support/Liner Code/keys.json`, sealed with a key macOS keeps in the login keychain as "Liner Code Safe Storage" (the engine gets them in memory only) |
| The window's frame and material | `~/Library/Application Support/Liner Code/shell.json` |
| Engine log | `~/Library/Logs/Liner Code/engine.log`, and `engine.previous.log` from the launch before (a test home's own: `$LINER_HOME/logs`) |
| A downloaded update, waiting to go in | `~/.liner-code/updates/` |

</details>

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
| Claude Code | Claude Agent SDK, your installed `claude` | yes, every access level | yes, and real forks | plans with ExitPlanMode, asks with AskUserQuestion |
| Codex CLI | `codex app-server` | yes: commands, edits and MCP tools (an older Codex's `exec` maps access to its sandbox) | yes | models come from `codex debug models` |
| OpenCode | ACP over stdio | yes | when the agent can | any model OpenCode is set up with |
| Hermes | ACP over stdio | yes | yes | depends on Hermes's own provider being up |
| Cursor, Grok Build | ACP (`cursor-agent acp`, `grok agent stdio`) | yes | when the agent can | Beta: the drivers haven't been run against the real tools yet |
| Demo | scripted | yes | – | edits only its sample project |
| API endpoints | through Claude Code, Codex or OpenCode, by protocol | as that tool | as that tool | Settings › Models › API endpoints |

### API endpoints

Models from an API (DeepSeek, Kimi, GLM, OpenRouter, a model in LM Studio or Ollama) run through
the tool that speaks the endpoint's protocol, pointed at it, so they get everything that tool
does (files, commands, approvals, resume) and Liner Code's own tools (the Browser, designs),
with no agent loop of Liner Code's own (`engine/src/providers/endpoint.ts`):

| The endpoint speaks | Runs through | How it's pointed there |
| --- | --- | --- |
| Anthropic Messages | Claude Code | `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`; its model for every alias (Sonnet, Haiku, subagents); tool search off, so every tool is in the list |
| OpenAI Responses | Codex | a model provider of its own (`-c model_provider=…`, `wire_api = "responses"`), given to its app server at start |
| OpenAI Chat Completions | OpenCode | a provider of its own in `OPENCODE_CONFIG_CONTENT` (`@ai-sdk/openai-compatible`) |

Add one in Settings › Models › API endpoints. Pick its service and the address and protocol fill
in (`ui/src/app/services.ts`, each address checked against the service): Anthropic, DeepSeek,
Kimi, GLM (Z.ai and Zhipu) and MiniMax through Claude Code; OpenAI and xAI through Codex;
OpenRouter, Gemini, Qwen, Groq, Mistral, Together, Fireworks, SiliconFlow, NVIDIA NIM and Ollama
Cloud through OpenCode; LM Studio, Ollama, LiteLLM or vLLM on this Mac. Or give any other
service's address and protocol. Then its key and its models (**Find its models** asks its
`/models`). It shows in the model picker as a tool
of its own. Its key is sealed in the keychain with the others and goes only to that tool's
process, under a variable of its own; your Anthropic key never goes to another maker's endpoint,
and Claude Code's own sign-in isn't sent there either. One on this Mac needs no key.

## Licence

MIT, see [LICENSE](LICENSE). The app also contains other people's software under their own terms,
listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); the Claude Agent SDK inside it is
Anthropic's and isn't covered by the MIT licence. Tool and model names belong to their owners, and
Liner Code isn't made or endorsed by any of them.
