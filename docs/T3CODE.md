# Liner Code and T3 Code, feature by feature

Compared against T3 Code at `e762f09e` (2026-10-26): its 45 user docs, its web app's components
and right panel, and its provider packages. T3 Code has grown into a large product (desktop,
web, iOS and Android apps, a relay, seven source-control hosts); Liner Code is the Mac app only,
by choice. Windows, the phone and teams are set aside, so those rows say so rather than counting
as gaps.

## Where Liner Code is ahead

| Liner Code | T3 Code |
| --- | --- |
| Liquid Glass or vibrancy behind the sidebar alone, and the Mac's own menus, sheets and notifications (Electron with a small native addon) | Electron, no system material |
| A lead that plans and a coder that builds, a plan card with owners, estimate and Edit steps, helpers the lead can bring in | One agent per thread; plans show as proposed plans |
| A Reviewer from another model family on every edit turn, up to two rounds, findings on the diff's lines | Review guides for pull requests (beta), no review loop on turns |
| Compare models: one ask to several models in their own worktrees, then a side-by-side view where you keep one and its changes come into your checkout | Shift-click sends one prompt to several models as separate threads and worktrees; no view to compare them and keep one |
| Routines whose gate is code (rules, daily merge limit), with test runs that never act | Scheduled tasks and webhook automations, run by the agent |
| Ask about lines in the diff; the answer stays on those lines | Review comments become context chips in the composer |
| Sidebar groups of your own, snooze until checks finish or someone replies, a monthly budget with pace | Pin and reorder, custom snooze, settle; usage without a budget |

## Built since the comparison (2026-10-27)

Everything on the missing-core list below is now in Liner Code, in the order at the end. What's
left of each, or wasn't checked live, is in the last column.

| # | In Liner Code now | Left, or not checked live |
| --- | --- | --- |
| 1 | Codex through `codex app-server`: approvals for commands and edits, its questions, and approvals for other MCP servers' tools as cards; `codex exec` stays for an older Codex | App-access (permissions) requests are declined |
| 2 | Switching a session to another tool hands over the conversation, your requests kept whole and the newest answers first | A live switch Claude Code → Codex end to end |
| 3 | Edit from here: rewinds the conversation to before a message, restoring the files or keeping them | |
| 4 | `/` lists each tool's own commands, `$` its skills; `/goal` keeps working until a goal is met; `/reviewer` | |
| 5 | Limited state with the window's reset and Resume; Usage → Limits for Claude Code and Codex | |
| 6 | Project scripts with run buttons in the session header, each in a Terminal tab of its own, keys of their own (recorded in Settings, Projects), and the ones that run in a new worktree | |
| 7 | Branch picker and base branch for new sessions, continuing in an existing worktree, worktree location, cleaning up old worktrees, keeping the default branch pulled | Clean up wasn't run live |
| 8 | Commit messages and pull request title and description, written by a quick model from the changes and the session | |
| 9 | Cursor (`cursor-agent acp`) and Grok Build (`grok agent stdio`) drivers; any agent from the ACP registry (npx, uvx, or a download for this Mac checked against its sha256), or an ACP command of your own | Cursor and Grok aren't installed here, so neither was run; Cursor goes through ACP rather than `@cursor/sdk` |
| 10 | Other accounts of a tool, each with its own config folder (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `HERMES_HOME`), variables and binary, each a tool of its own in the model picker; model ids you add to a tool's list | |
| 11 | ↑ recalls a sent prompt, ⌘S puts a draft aside, Cite quotes part of an answer, a terminal excerpt goes to the composer, files show before sending, Markdown styled as you type (a mirror behind the field, so the caret and typing stay the system's) | |
| 12 | Find in a thread and in a diff (folded parts too) | |
| 13 | Agents use the session's Browser (open, read, click, type, screenshot in the Mac app) and the Simulator (list, screenshot, open a link), through an MCP server every tool starts with a key that reaches only its own session | Taps in the Simulator (`simctl` has none); a session that isn't open gets a read from the server instead of the Browser |
| 14 | `show_page`: a page (chart, table, mockup) in the session, sandboxed, in the app's colours, following light and dark | |
| 15 | A keymap with your own keys (record them, or JSON like VS Code's with `when`), and the menu bar follows; themes from a VS Code theme or a few colours; an accent of your own | |
| 16 | The Browser opens only what's the session's: every agent and Terminal tab carries `LINER_THREAD_ID` (T3 Code's `T3CODE_THREAD_ID`), so a dev server is known by the session that started it, else by running in its folder, and only ports that answer with a page count. Plain HTML opens from the session's folder with no server, and `browser_open` takes a file. A Stop button for the session's own server, and archiving or removing a session stops what it started (T3 Code's resource cleanup, with its rule for which process group may be signalled) | |
| 17 | Agents check pages when the session isn't on screen: the app keeps a hidden Browser for it (scripts run, the console is read), and a screenshot draws the page in a window of the shell's own (T3 Code downloads a headless browser instead). Every agent is told to check pages there | Screenshots of a hidden Browser weren't checked in the Mac app |
| 18 | Live command output: Codex's `outputDelta` streams into the running row, every running row counts up, and rows are saved when they start and end rather than on every update | Claude Code reports only elapsed time, not output, while a command runs |
| 19 | Auto (the tool's own auto mode) apart from Reviewer decides, which now asks the Reviewer's quickest model about each step and brings you only what it won't allow; an answered ask folds into its tool call's row | |
| 20 | One folder of helpers first on the PATH of everything Liner Code runs: a ripgrep is linked in from Codex's own copy or the ChatGPT app's when the Mac has none, Codex gets its own `codex-path`, and a failed command says how it ended (exit 127: not installed) | |
| 21 | Routed work's models are yours to pick per role (everyday, hard jobs, judge, critics), each falling back to the automatic pick while its tool isn't ready | |
| 22 | A tool's update shows its progress: the updater's percentage or size as a bar, its last line as the step | Tools whose updater prints no numbers get a sweep, not a percentage |
| 23 | A watchdog for turns gone quiet (Hermes Agent's stream watchdog): nothing from the tool for 4 minutes (12 while a command runs), and nothing waiting on you, is said once on the timeline and as a notification | |
| 24 | Carrying on at a usage limit (Hermes Agent's fallbacks, with T3 Code's handoff): another account of the same tool first, else another family's everyday model, from the limit card or by itself (Settings › General) | |
| 25 | Memory and search across sessions (Hermes Agent's learning loop, kept small): agents save facts with memory_add, every new session starts with them, sessions_search reads earlier sessions; Settings › Projects shows and edits the memory | No search over session contents in ⌘K yet |
| 26 | An MCP server for agents outside Liner Code (T3 Code's orchestrator MCP server): list, read, start, message and wait for sessions; off until you turn it on (Settings › Safety), with a key only you can read | |

## Missing core features at the comparison, most important first

1. **Codex with approvals.** Liner Code runs `codex exec`, which can't stop to ask, so access
   maps to Codex's sandbox. T3 Code drives `codex app-server`: approvals, questions Codex asks
   while it keeps working, and app-access requests.
2. **Context when you switch models in a session.** Switching a session from Claude Code to
   Codex (or any other tool) opens a fresh session that knows nothing of the conversation; only
   forks carry a handoff today. T3 Code's portable handoffs move the context, keeping recent
   requests whole when it's long.
3. **Edit an earlier prompt.** T3 Code's Edit from here rewinds the conversation to before a
   message, with Revert and keep changes or Revert files too. Liner Code can undo a turn's files
   but can't rewind the conversation.
4. **Commands and skills in the composer.** T3 Code lists each tool's own commands with `/` and
   skills with `$` (Claude Code's `supportedCommands()`, OpenCode's, the project's
   `.claude/skills`). Liner Code only has `@` for files. `/goal` (keep working until a stated goal
   is met) rides on this.
5. **Usage limits.** When a plan runs out mid-turn, T3 Code marks the thread Limited, names the
   window and its reset, and offers Resume; Usage → Limits pools each subscription's remaining
   quota. Liner Code shows it as an error and has no limits view.
6. **Project scripts.** `t3.json` names commands (dev server, tests, setup) with run buttons and
   keyboard shortcuts, and marks which run when a worktree is made. Liner Code has one setup
   command per project.
7. **Branches for new sessions.** A branch picker, a base branch for a new worktree, continuing
   in an existing worktree, worktree location, storage cleanup of old worktrees, and keeping the
   default branch pulled. Liner Code makes a worktree from the current HEAD and nothing else.
8. **Written for you: commit messages and pull request text.** T3 Code writes commit messages,
   pull request titles and descriptions from the changes and the thread. Liner Code uses the plan's
   title as the commit message and leaves the pull request body to you.
9. **More tools.** Cursor (through `@cursor/sdk`), Grok Build, Antigravity, Pi and Muse Code, and
   any agent from the ACP registry or a local ACP command. Liner Code drives four, and finds Cursor
   and Grok without driving them.
10. **Several accounts per tool.** Separate Claude config directories or Codex homes as their own
    instances (work and personal, or a router such as OpenRouter), switchable in the model picker,
    with their own environment variables and binary path. Plus custom models a tool doesn't list.
11. **The composer's smaller powers.** ↑ to recall a sent prompt, ⌘S to stash a draft, Cite in
    composer for part of an answer, context chips placed in the text (a terminal excerpt, a review
    comment, a picked element), Markdown styled as you type, files previewed before sending.
12. **Find.** Find in a thread (messages and plans, older ones included) and find in a diff
    (⌘F across every file, folded parts too).
13. **Agents that use the surfaces.** T3 Code gives agents the preview browser and the device as
    tools, so they check their own work on screen. Liner Code's surfaces are for you only.
14. **Visual replies.** An agent can answer with a page (a chart, a table, a mockup) that follows
    the theme, sandboxed away from the app.
15. **Your shortcuts and themes.** A keybindings editor (a JSON file with `when` conditions) and
    custom themes, VS Code themes imported. Liner Code's shortcuts are fixed and its look is
    light, dark and an accent.

## Missing, but bigger or further off

- **Pull requests in depth:** review comments, request reviewers, check out a branch, the merge
  method, GitHub stacks, files marked viewed per pull request, and every thread linked to its pull
  request by branch even while the app is closed.
- **Start a project from nothing and publish it** to GitHub, and project icons.
- **Other hosts:** GitLab, Bitbucket, Azure DevOps, Forgejo and Gitea, GitCafe (Liner Code: GitHub
  through `gh`).
- **An MCP server for outside agents,** so Claude Code, Codex or ChatGPT can read projects and
  threads and start or message threads; and **prompt links** that open a ready prompt.
- **Device:** the Android emulator, and simulators on another machine over SSH.
- **Browser:** importing another browser's cookies, Liner Code as the default browser.
- **SnapShot:** capture another app's window with its accessibility data and attach it.
- **Usage:** custom model prices, subscription limits, CLIProxyAPI hubs.
- **Activity log:** live command output while it runs, Open diff on a tool call.
- **Start in the background** (⌘Enter starts one and opens the next draft), select several
  sessions at once, a hover card on a session.
- **A background service and a `t3` command** that keep the server running without the app.

## Set aside on purpose

- **Remote access** (T3 Connect, LAN pairing, Tailscale, SSH environments): it's what the phone
  and public webhooks need; it comes back with them.
- **The phone apps, mobile notifications, Live Activities, voice input on iPhone.**
- **Teams:** guest links that let a teammate follow a thread.
- **Windows and Linux builds.**
- **Product telemetry.** Liner Code sends none.

## The order I'd build them in

1. Context handoff on switching models, and Edit from here (the conversation's own correctness).
2. Codex through `codex app-server`, so every tool can ask.
3. Commands and skills with `/` and `$`, then `/goal`.
4. Usage limits: the Limited state with Resume, and Usage → Limits.
5. Project scripts and the branch picker for new sessions.
6. Written commit messages and pull request text.
7. The composer's smaller powers and Find.
8. Cursor and Grok drivers, the ACP registry, several accounts per tool.
