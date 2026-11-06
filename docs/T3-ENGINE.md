# Liner Code on T3's engine: each engine call, mapped

**Shelved on 2026-11-06.** Liner Code keeps its own engine, and the modular split is off too, since
the port was its main reason. By a rough sort of the changelog's 50 fixes, T3's engine would have
touched about 38% at most, and the port would add an adapter, a fast-moving dependency and 336 MB
per platform. Look at it again if T3 ships MCP servers per thread (2, below) and real users' bug
reports turn out to be mostly about agents and turns. Everything below is the research for then;
its numbers are from 2026-11-05 and 06, and "Next" is the order if the port comes back.

The question: could Liner Code keep its own app and run on T3 Code's engine (`t3` on npm), with
Liner's own features in a small engine of its own beside it (the sidecar)? This maps every call
the app makes to Liner's engine onto T3's.

Checked against T3 Code at `337c5858c` (2026-11-05; npm `t3@0.1.7`, nightly
`0.1.8-nightly.20261105.4218`), from its contracts: `packages/contracts/src/rpc.ts` and
`orchestrationV2.ts`. The mapping is names and shapes; the routing test below ran the parts that
decide it against a real `t3` 0.1.7. Liner's side is `Rpc` and `EngineEvent` in
`contracts/src/index.ts`: 126 calls and 27 events.

- **T3**: T3 has it; the adapter only translates.
- **T3, differs**: T3 has something close; the note says what's different or what to check.
- **Sidecar**: Liner's own; stays in Liner's engine.
- **Shell**: the Mac app's own job, not an engine's.

| | Calls |
| --- | --- |
| T3 | 42 |
| T3, differs | 33 |
| Sidecar | 43 |
| Shell | 8 |

Before the routing test, `proposal.answer` and `review.run` had no T3 answer. The test found one
for each (below), so no call is left without one. What's still open is about what happens inside a
turn, which no single call shows. That comes first.

## The routing test

Run on 2026-11-05 against `t3` 0.1.7, headless (`t3 serve --no-browser --base-dir <its own
folder>`), driven only through its public WebSocket protocol, with Claude Code 2.1.318 and Codex
0.166.0 signed in. A throwaway repository; the user's own `~/.t3` (T3 Code's desktop app is
installed on this Mac) wasn't touched. The scripts are in the session's scratchpad, not the repo.

| Question | Answer |
| --- | --- |
| Is `plan` mode read-only on Claude Code? | Yes, enforced. In `plan` mode, even with `full-access`, a write becomes a `file-change` request; declining it gives the model "User declined tool execution", and nothing is written |
| On Codex? | Only with `approval-required`. T3 sends Codex's plan mode as instructions; the sandbox follows the runtime mode (`full-access` is no sandbox). With `approval-required` the sandbox is read-only, and a file change and a command each became a request; declined, nothing was written |
| Lead to coder | Works, natively. The lead (Claude Code, `plan` + `approval-required`) made a `proposed_plan` in 24 s. Approving took two commands (8 ms) and one `message.dispatch` with the coder's `modelSelection` (Codex) and `sourcePlanRef` (the plan). T3 switched the tool, handed the context over, and Codex made the change in 12 s |
| A model per message | Works within a tool: Sonnet then Opus in one thread, context kept, no handoff, 1.5 s. Works across tools: Sonnet then Codex, with a handoff, 3.4 s |
| A T3 bug | After a Claude model change in a thread (Sonnet then Opus), switching that thread to Codex is refused: "The previous provider is still running background agents or commands". It stays refused, even after Stop. It happened in all three tries; Sonnet straight to Codex never did. Way round: `thread.fork` at `latest_stable` (9 ms) and send on the fork; Codex answered there in 2.2 s with the context kept. Worth reporting to T3 with this repro |
| The Reviewer | `orchestration.getTurnDiff` gave the coder turn's unified diff in 40 ms. A helper thread (Claude Code, read-only as above) answered with findings as data in 9 s |
| Keeping helpers out of sight | Archiving a thread while it runs cancels the run. Tag it while it runs, archive it once it has answered; archived threads leave the active list. The sidecar keeps their ids, so it never needs T3's list for them |
| Side chats | T3 has them: `thread.fork` takes `sideChat: true` (and there's `thread.merge_back`) |

### Tokens

Is Liner on T3 heavier on tokens than Liner today? The same one-line turn ("Reply with just the
word OK. Do not use any tools.") in the same repository, on Claude Code (Sonnet 5.5) and Codex
(GPT 5.6 Luna). Tokens sent to the model:

| Run through | Claude Code | Codex |
| --- | --- | --- |
| The bare CLI (`claude -p`, `codex exec`) | 42,824 | 15,372 |
| Liner's engine today (its own home, `LINER_HOME`) | 49,289 | 15,620 |
| T3's engine | 43,486 | 17,617 |

These totals can't be compared as they stand. Claude Code connects your own MCP servers and
claude.ai connectors in the background, and the first request goes out with whichever are ready.
In the Liner run, Claude Docs, Figma and cua were ready; in the bare run, Claude Docs and cua; in
the T3 run, none. Their tool names and instructions come to about 16,000 characters (about 4k
tokens), so most of the gap is when they connected, not the engine.

Claude Code keeps a record of each request in its transcript (`~/.claude/projects/…`, the
`prompt_snapshot` and `deferred_tools_delta` entries). Comparing those with the bare CLI's shows
what each engine itself adds on Claude Code (characters, and about a quarter as many tokens):

| Added by the engine | Liner | T3 |
| --- | --- | --- |
| Text appended to the system prompt | 1,218 (what Liner's tools are for) | 5,154 (where it runs, linking pull requests, orchestration, background waits, device tools) |
| The `AskUserQuestion` tool (the bare `claude -p` has none) | 5,996 | 7,392 |
| Its own MCP tools, by name only (Claude Code defers their schemas until used) | 483 (19 tools) | 2,185 (`t3-code`) |
| Its MCP server's instructions | 433 | none (they're in the system prompt) |
| Its subagents, in the agent list | 432 (Explorer, Test runner) | none |
| **In all** | **8,562, about 2.1k tokens** | **14,731, about 3.7k tokens** |

- **The adapter adds nothing.** It never talks to a model.
- **T3 adds more than Liner does, about 1.6k tokens a turn on Claude Code**, and about 2k more on
  Codex. On T3, Liner would pay T3's additions plus its own tools' names and note (about 0.3k): about
  2k tokens a turn more than today. That's 0.2% of Sonnet's 1M window, and it's cached after the
  first request. T3's additions are written into its Claude adapter, so Liner can't trim them
  without changing T3.
- **The big items are yours, in any engine:** your skills list (34,839 characters, about 8.7k
  tokens) and your MCP servers and connectors (about 4k tokens once they're connected). A session
  setting that leaves them out would save more than any engine choice. T3 does this for its own
  capability checks (`strictMcpConfig`, `ENABLE_CLAUDEAI_MCP_SERVERS=false`), and Liner's apps
  already run without them.
- **A handoff is cheap.** The coder's first Codex turn after the lead's plan read 22.9k, against
  18.9k for a fresh Codex turn: the plan and the handed-over context are about 4k.
- **Helpers pay the full prompt.** The Reviewer's helper thread on Claude Code read 59.7k (45.3k
  of it cached), because it read files. Liner's Reviewer is a turn of its own today too, so this
  isn't new.
- **Context limits.** T3 reports each turn's context and window (1,000,000 for Sonnet 5.5,
  258,400 for Luna), and has compaction when idle and a budget for handoffs. Neither was pushed
  to its limit here.

One run each. The Codex totals weren't broken down the same way, so the same caution applies to
them.

### Not tested yet

- ACP tools. OpenCode is installed here, but T3 lists it as disabled; Hermes wasn't tried.
- Codex as the lead, and Claude Code as the coder.
- A cascade end to end (a judge that fails a change and a stronger model that repairs it).
- Usage rows for helpers: each helper turn's tokens are on its `providerTurns`, so the sidecar can
  write its own judge and critic rows, but that wasn't built.

### What else turned up

- **The npm package is a launcher.** `t3` on npm is 8 KB; it downloads a self-contained build for
  the Mac from T3's GitHub release, checks it against `SHA256SUMS`, and keeps it in
  `<base dir>/runtime/versions/<version>`. That build is 336 MB: the executable (156 MB, signed
  by T3's Apple team), T3's own web app (112 MB, which Liner wouldn't need) and native modules
  (67 MB). Liner could ship the pinned build, with no `node-pty` to rebuild.
- **A protocol version.** The WebSocket needs `?orchestrationProtocol=2`; another version gets an
  HTTP 426 that names the one the engine speaks. That's the version check, built in.
- **Signing in.** `t3 auth session issue --token-only` gives a bearer token for a headless client;
  T3's desktop app hands its secrets over a file descriptor (`--bootstrap-fd`), which the Mac app
  could copy.
- **Analytics need no patch.** See below.
- **Messages need three more fields** than the contracts' names suggest: `createdBy`,
  `creationSource` (there's no "desktop": Liner would send `web`) and `dispatchMode`.

### Analytics

T3's engine sends product analytics to `ingest.t3.codes`, which forwards them to PostHog
(`apps/server/src/telemetry/AnalyticsService.ts`). They're on unless turned off, and turning them
off takes one environment variable, so Liner starts the engine with
`T3CODE_TELEMETRY_ENABLED=false`. No patch.

Checked on 2026-11-06 with a real Codex turn on `t3` 0.1.7, with `T3CODE_POSTHOG_HOST` pointed at a
sink on this Mac so nothing could reach T3:

| | Analytics on | `T3CODE_TELEMETRY_ENABLED=false` |
| --- | --- | --- |
| Events that reached the sink | 7 | 0 |
| Connection to `ingest.t3.codes` | none (sent to the sink instead) | none |

- **What the 7 events held:** the T3 version, OS and chip, how many projects and threads there are,
  the model, modes, token counts and timings, and hashed ids for the install and the account (the
  engine reads Claude Code's and Codex's account ids and hashes them). The prompt, the repository's
  path and the Mac's user name weren't in them.
- **What the engine still reached:** `downloads.claude.ai` and GitHub's file CDN (the code fetches
  T3's model list and LiteLLM's prices from `raw.githubusercontent.com`; the CDN address doesn't
  show which of them ran). These are fixed addresses for public files, but the requests
  themselves weren't captured. The agents' own traffic is separate.
- **The rest of T3's reporting is off unless set up:** OTLP needs its URLs set, T3 Connect needs a
  link, and `provider.uploadFeedback` needs a call, which the adapter won't pass on. `@statsig` in
  the build is a dependency of `@cursor/sdk`, for Cursor sessions (not run here).
- **Guard against a rename.** T3 could rename the variable in a later release, so the pin script
  should repeat this check on every upgrade and refuse a build that reaches `ingest.t3.codes`. T3's
  managed policy (`telemetry: false`) also turns it off, but it's machine-wide and would change the
  user's own T3 Code too, so Liner shouldn't use it.

## What decides it

### 1. Sharing the work

Lead and coder, the Reviewer, routed sessions (cascade and critique), and Solo, Plan and Auto run
inside Liner's turn loop today (`engine/src/runtime.ts`, `route.ts`). On T3 the sidecar drives
them from outside. The routing test says it can:

- **Lead and coder.** Start the thread in `plan` mode with `approval-required` on the lead's
  model, and decline every request while the lead works. The plan arrives as `plan.updated`
  (`proposed_plan`) and shows as Liner's card. Approving sets `default` mode and the coder's
  runtime mode, and sends one message with the coder's model and the plan as its source.
- **Reviewer.** When a turn that changed files ends, read `getTurnDiff`, ask the Reviewer in a
  read-only helper thread on a model from another family, and send blockers back with
  `message.dispatch`.
- **Routed sessions.** Put the model on each message; judges and critics run in helper threads.
  Until T3 fixes the switch after a Claude model change, the sidecar forks when a switch is
  refused, and the session carries on in the fork.

### 2. Tools for agents

Liner's agents get tools from Liner's engine (`agent-tools.ts`): memory, designs, add-ons and
"Make it an app" offers, the Browser and the Simulator. T3 puts its own MCP servers into each
session (`ClaudeAdapterV2.ts`, `setMcpServers`), but 0.1.7 has no setting for extra ones.
Without one, the sidecar can't give agents memory, designs or add-ons.

T3 has the feature in review: three open pull requests, a maintainer's rebuild of an earlier one,
not yet approved or merged (checked 2026-11-06).

- [#21815](https://github.com/pingdotgg/t3code/pull/21815) stores shared MCP servers and skill
  switches in settings, for the whole environment with overrides per project.
- [#21816](https://github.com/pingdotgg/t3code/pull/21816) gives them to every session of
  Claude Code, Codex, Cursor, OpenCode and the ACP tools, without writing the tools' own config
  files.
- [#21817](https://github.com/pingdotgg/t3code/pull/21817) adds Settings → Tools to manage them.

Liner's server is one per session (each has its own key, reaching only that session's Browser and
Device), and the stack scopes servers to the environment or a project. So what to ask for is a
server scoped to one thread, or one that takes the thread's id, and a way for a headless client to
set it.

- **Best fix:** ask in T3's Ideas discussions (T3 takes feature requests there, not in issues),
  pointing at the stack.
- **Stopgap:** write the sidecar's MCP server into each tool's own config (`~/.claude.json`,
  `~/.codex/config.toml`). That changes the user's own files, so only with their OK.

### 3. One timeline from two places

Some of Liner's items have nothing like them in T3: the Reviewer's findings on diff lines, the
plan card with owners and estimates, offer and add-on cards, designs, the limit card. The sidecar
keeps them and the adapter merges them into T3's timeline by turn. A rewind
(`checkpoint.rollback`) and a deleted thread have to take both away.

### 4. API endpoints as models

T3 has no provider for an API endpoint (`engine/src/providers/endpoint.ts`, `plain.ts`, and the
OpenCode Go voucher model). A way round: the sidecar runs each endpoint as an ACP agent, and T3
adds it as an ACP agent of your own (its registry entries take a `command`). Check that T3 takes a
command that isn't from the registry.

## Calls, by area

### Sessions and turns

| Call | Label | T3 | Note |
| --- | --- | --- | --- |
| `state.get` | T3, differs | `orchestration.subscribeShell`, `server.getConfig` | The first snapshot, merged with the sidecar's |
| `thread.create` | T3, differs | `thread.create`; `thread.fork` for `forkOf` | `access` becomes `runtimeMode`; `lead`, `route`, `dual`, `after` and `mode` are Liner's (1) |
| `thread.update` | T3, differs | `thread.metadata.update`, `thread.archive`, `thread.unarchive`, `thread.runtime-mode.set`, `thread.model-selection.set`, `thread.pin`, `thread.unpin`, `thread.snooze`, `thread.unsnooze`, `thread.settle`, `thread.mark-unread` | `lead`, `route`, `dual`, `after` and `group` stay in the sidecar; check `wake` (on checks or a reply) against `thread.pull-request.watch` |
| `thread.items` | T3 | `orchestration.getThreadProjection` | |
| `thread.load` | T3 | `orchestration.subscribeThread` | Liner's `seq` already copies T3's snapshot sequence |
| `thread.send` | T3 | `message.dispatch` | `mode` becomes `deliveryIntent`; a diff-line `anchor` goes in as text |
| `thread.queue` | T3 | `queued-run.edit`, `.reorder`, `.cancel`, `.start` | |
| `thread.stop` | T3 | `thread.stop`, `run.interrupt` | |
| `thread.remove` | T3, differs | `thread.delete` | Check T3 says why a worktree stayed (`kept`) |
| `thread.rewind` | T3, differs | `checkpoint.rollback` with `restoreFiles` | Check it takes the turns off the conversation too, not only the files |
| `thread.carryOn` | T3 | `provider.switch` | |
| `thread.side` | T3, differs | `thread.fork` with `sideChat: true` | Check T3's side chat only reads, as Liner's does |
| `thread.info` | T3, differs | the thread's `contextUsage`, branch and worktree | |
| `thread.export` | Sidecar | | Markdown from T3's timeline and the sidecar's items |
| `approval.answer` | T3, differs | `runtime-request.respond` (`decision`) | `scope` is for add-on cards (sidecar); check `always` has a decision to match |
| `question.answer` | T3 | `runtime-request.respond` (`answers`) | |
| `proposal.answer` | T3, differs | `thread.interaction-mode.set`, `thread.runtime-mode.set`, then `message.dispatch` with `modelSelection` and `sourcePlanRef` | Tested. The plan card's owners and estimate stay in the sidecar |
| `review.run` | Sidecar | `orchestration.getTurnDiff`, a helper thread | Tested: the Reviewer runs in a read-only helper thread |
| `checkpoint.diff` | T3 | `orchestration.getTurnDiff` | |
| `checkpoint.revert` | T3 | `checkpoint.rollback` | T3 checks restores are safe too (`CheckpointRestoreSafety`) |
| `compare.start` | Sidecar | `thread.create`, once a model, each in a worktree | |
| `compare.keep` | Sidecar | | Brings one worktree's changes into your checkout |
| `sessions.search` | T3 | `orchestration.searchThreads` | |
| `sessions.importable` | T3 | `agentSessions.scan` | |
| `sessions.import` | T3 | `agentSessions.import` | |
| `desk.ask` | Sidecar | | A quick model on the side |
| `agent.browser.reply` | T3, differs | `preview.*` automation | T3 expects its own window to host the preview and answer the agent; Liner's window would answer T3's calls instead |
| `outside.info` | Sidecar | | Liner's MCP server for agents outside the app |

### Providers and models

| Call | Label | T3 | Note |
| --- | --- | --- | --- |
| `providers.refresh` | T3 | `server.refreshProviders` | |
| `acp.registry` | T3 | `server.searchAcpRegistry` | |
| `acp.add` | T3 | `server.prepareAcpRegistryAgent`, `server.setAcpRegistryProvider` | An agent of your own: see (4) |
| `acp.remove` | T3 | `server.disableAcpRegistryProvider`, `server.uninstallAcpRegistryManagedBinary` | |
| `agent.commands` | T3 | the provider's slash commands and skills, in `server.getConfig` | |
| `skills.list` | T3, differs | the provider's skills | Liner also lists your skills folders; check T3's list has them |
| `agents.save` | Sidecar | | Named agents and their instructions |
| `keys.set` | Sidecar | | Keys for API endpoints (4) |
| `voucher.redeem` | Sidecar | | |
| `endpoint.models` | Sidecar | | API endpoints (4) |
| `usage.limits` | T3 | provider usage limits (`providerUsageLimits.ts`) | |
| `usage.summary` | T3, differs | `server.getUsageSummary` | The monthly budget and judge and critic rows stay in the sidecar |
| `ways.compare` | Sidecar | | Routed sessions' stats |
| `updates.tool` | T3 | `server.updateProvider`, `server.getNpmRelease` | |

### Projects and files

| Call | Label | T3 | Note |
| --- | --- | --- | --- |
| `project.add` | T3, differs | `projects.mutate` | The contracts don't make clear which command adds a folder you already have |
| `project.update` | T3, differs | project `scripts`, worktree setup | A project's default agent stays in the sidecar |
| `project.remove` | T3 | `projects.mutate` | |
| `project.scratch` | T3 | `projects.ensureScratch` | |
| `project.clone` | T3 | `projectClone.start`, `sourceControl.cloneRepository` | |
| `projects.scan` | Sidecar | | Finds repositories in your folders |
| `github.repos` | T3, differs | `sourceControl.*` | T3 signs in to GitHub itself; Liner uses `gh` |
| `project.rules` | Sidecar | `projects.readFile` | |
| `project.rules.save` | Sidecar | `projects.writeFile` | AGENTS.md, with CLAUDE.md pointing to it |
| `memory.list` | Sidecar | | Agents reach memory through tools (2) |
| `memory.add` | Sidecar | | |
| `memory.forget` | Sidecar | | |
| `fs.files` | T3 | `projects.searchEntries` | |
| `fs.tree` | T3 | `projects.listEntries` | |
| `fs.read` | T3 | `projects.readFile` | |
| `files.raw` | T3, differs | `assets.createUrl` | A URL instead of base64 |
| `attachment.read` | T3, differs | `assets.*`, `attachments.*` | |
| `apps.editors` | T3, differs | T3's editor list (`editor.ts`) | Check it has terminals as well as editors |
| `apps.open` | T3 | `shell.openInEditor` | |

### Git and pull requests

| Call | Label | T3 | Note |
| --- | --- | --- | --- |
| `git.branches` | T3 | `vcs.listRefs` | |
| `git.switch` | T3 | `vcs.switchRef`, `vcs.createRef` | |
| `git.status` | T3 | `vcs.refreshStatus` | |
| `worktrees.clean` | T3, differs | `vcs.removeWorktree`, `server.runStorageCleanup` | Liner's rule (the session is archived or gone) moves to the adapter |
| `git.commit` | T3 | `git.runStackedAction` `commit`, with `filePaths` | |
| `git.push` | T3 | `git.runStackedAction` `push` | |
| `git.outgoing` | T3, differs | `review.getBranchCommits` | |
| `git.message` | T3, differs | `git.runStackedAction` without `commitMessage` | Check T3 writes one when it's left out, and can show it before committing |
| `pr.draft` | T3, differs | `git.runStackedAction` `create_pr` | The same check for the title and description |
| `pr.create` | T3 | `git.runStackedAction` `create_pr` | |
| `pr.status` | T3 | `pullRequests.detail`, `pullRequests.checks`, `thread.pull-request.link` | |
| `pr.list` | T3 | `pullRequests.list` | |
| `pr.merge` | T3 | `pullRequests.runAction` `merge` | |
| `pr.picture` | T3, differs | `pullRequests.changeBreakdown`, `pullRequests.checks` | |
| `pr.test` | Sidecar | | Runs the project's tests for the pull request card |

### Terminal, Browser and Device

| Call | Label | T3 | Note |
| --- | --- | --- | --- |
| `term.open`, `term.attach`, `term.write`, `term.resize`, `term.clear`, `term.close` | T3 | `terminal.open`, `.attach`, `.write`, `.resize`, `.clear`, `.close` | Six calls |
| `term.list` | T3, differs | `terminal.observe` | Check it lists a session's terminals |
| `ports.list` | T3, differs | `preview.list` | Liner says whose each server is; check T3 does |
| `ports.stop` | T3 | `preview.stopLocalServer` | |
| `browser.proxy` | T3, differs | `preview.open` | Liner's proxy reports the console and answers picks; check T3's preview does |
| `browser.files` | T3, differs | `preview.open` | |
| `device.list`, `device.boot`, `device.shot`, `device.appearance`, `device.log` | T3, differs | `device.list`, `.open`, `.action`, `.detail` | Five calls. T3 has iOS and Android (and Expo's cloud simulators); check screenshots, appearance and logs are actions |

### Routines

| Call | Label | T3 | Note |
| --- | --- | --- | --- |
| `routine.save`, `routine.remove`, `routine.run`, `routine.test`, `routine.stop` | Sidecar | `scheduledTasks.*` could take the triggers later | Five calls. Liner's gate is code (rules, a daily merge limit, test runs that never act); T3's tasks are run by the agent. The AI steps become T3 threads |

### Add-ons, panels and designs

| Call | Label | T3 | Note |
| --- | --- | --- | --- |
| `addons.update`, `.add`, `.files`, `.source`, `.adopt`, `.drop`, `.list`, `.read`, `.off` | Sidecar | | Nine calls |
| `panel.call`, `panel.cancel` | Sidecar | `mcpApps.*` is the nearest | |
| `offer.answer` | Sidecar | | |
| `design.list`, `.read`, `.save`, `.restore`, `.built`, `.watch` | Sidecar | | Six calls |

### App and machine

| Call | Label | T3 | Note |
| --- | --- | --- | --- |
| `settings.save` | T3, differs | `server.updateSettings` | Split: the engine's settings go to T3, the rest stay |
| `groups.save` | Sidecar | `thread.tag.set` is close | |
| `background.list`, `.image`, `.save`, `.remove` | Shell | | Four calls |
| `machine.info` | Shell | | |
| `system.check` | Sidecar | | T3 checks what it needs itself |
| `updates.check`, `updates.download`, `updates.dismiss` | Shell | | Three calls. Liner Code's own updates |

## Events

| Liner event | Label | From T3 |
| --- | --- | --- |
| `hello` | T3, differs | `orchestration.subscribeShell`'s first snapshot, with the sidecar's |
| `project`, `project.removed` | T3 | `project.updated`, `project.removed` |
| `thread`, `thread.removed` | T3 | the shell stream's thread events |
| `item`, `delta` | T3, differs | `orchestration.subscribeThread` (`turn-item.updated`, `message.updated`), with the sidecar's items (3) |
| `timeline` | T3 | the thread's projection, read again after `checkpoint.rollback` |
| `providers` | T3 | the server config's providers |
| `settings` | T3, differs | T3's settings with the sidecar's |
| `notify` | T3, differs | made by the adapter from `runtime-request.updated` and `run.updated` |
| `settled` | T3, differs | `thread.settle` and auto-settle; Liner's reasons differ |
| `limits` | T3 | provider usage limits |
| `term`, `term.exit` | T3 | `terminal.attach` |
| `devlog` | T3, differs | `device.*`; check |
| `agent.browser` | T3, differs | T3's preview automation |
| `agents`, `keys`, `groups`, `routine`, `routine.removed`, `run`, `design.changed`, `addons`, `panel.ai` | Sidecar | |
| `updates` | Shell | Liner Code's own updates; the tools' from `server.getNpmRelease` |

## Next

1. **The routing test (1): passed**, with one T3 bug and a way round it. Report the bug to T3
   with its repro: in one thread, Sonnet, then Opus, then switch to Codex. Draft:
   [t3-issues/switch-after-model-change.md](t3-issues/switch-after-model-change.md).
2. **Ask T3 about MCP servers per thread (2)**, pointing at its Tools stack. It's now the one thing
   that decides it. Draft: [t3-issues/mcp-servers-per-thread.md](t3-issues/mcp-servers-per-thread.md).
3. **Finish what wasn't tested:** the ACP tools, Codex as the lead, a cascade end to end.
4. **Check the "T3, differs" rows** by running each against `t3@0.1.7`, and move the ones that
   match to T3.
