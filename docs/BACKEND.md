# Backend requirements

## Short version

**Version 0.1 needs no server of yours.** The backend is the *engine*, a local Node process the
app starts and stops. It talks to the agent CLIs on the Mac, and they talk to their own
providers with your own sign-ins. Nothing about your code or sessions leaves the machine except
what the agents themselves send to their model providers. The one exception is an anonymous usage
count the app sends once a day (see README, "Your accounts and your data"); Settings can turn it off.
If you set up an AI pictures model, the words of a picture you ask for go to that endpoint of yours
(see AI pictures below).
If you add a Linear key, Linear's issues come from api.linear.app with it. If you set up Tell an app,
one line goes to your webhook when a session needs you. Apps outside Liner Code reach it only once you
let them in, and from the internet only through a way in you pick (see Liner MCP below).

A cloud backend becomes necessary only for features on the roadmap: the phone app and remote
access, routines triggered by webhooks, sharing with a team, licences and updates. The last part
of this document says what each of those needs.

## What a Mac needs to run it

| Needed | Version | Why |
| --- | --- | --- |
| macOS | 13 or newer | the shell (Electron's own floor, `LSMinimumSystemVersion` 13.0) |
| Node.js | 24 or newer | runs the engine's TypeScript directly (type stripping) |
| git | 2.30 or newer | turn snapshots, diffs, undo, commit, worktrees |
| At least one agent | signed in | Claude Code `claude auth login`, Codex `codex login`, OpenCode `opencode auth login`, Hermes `hermes model` |

The app needs no Node of its own: the Electron shell runs the engine on Electron's Node (24).
The Sample project with the Demo agent works with none of the agents installed.

## The engine

```
Electron shell ──spawns──▶ <the app's own binary, ELECTRON_RUN_AS_NODE=1> engine/src/main.ts --port 0 --ui <built app>
        │                         │  prints: LINER_READY {"port":51830}
        ▼                         ▼
 BrowserWindow ── http://127.0.0.1:port ──▶ GET  /          the built app
                                        GET  /events     NDJSON stream: hello snapshot, then events
                                        POST /rpc        { method, params } → { ok, result | error }
                                          │
                                          ├─ Claude Code   (Claude Agent SDK → your `claude`)
                                          ├─ Codex CLI     (`codex exec --json`, one process a turn)
                                          ├─ Hermes        (ACP: JSON-RPC over stdio)
                                          ├─ OpenCode      (`opencode serve` on 127.0.0.1, HTTP + SSE, one process shared; ACP on older versions)
                                          ├─ git           (snapshots under refs/liner/, worktrees)
                                          ├─ gh            (pull requests, checks; the watch reads a session's open one each minute while its checks run, for two hours at most, or it waits on it; routines poll it; `#` in the message box lists open ones)
                                          │                (the Pull requests and Issues pages, the sidebar's review dot, scans of a pull request or an issue, Scan new PRs)
                                          ├─ Linear        (POST api.linear.app/graphql with the key you added, for the Issues page)
                                          ├─ tailscale, cloudflared  (a way in from the internet to Liner MCP's listener, only the one you pick)
                                          ├─ python3 pty   (the Terminal surface)
                                          ├─ xcrun simctl  (the Device surface)
                                        POST /hooks/r/<id>?key=…  a routine's webhook (its own secret)
                                        POST /outside    the stdio MCP server's calls (outside.ts), with the key in outside.json
                                        127.0.0.1:7318   Liner MCP's own listener, while apps are let in: /mcp and OAuth, nothing else
                                        127.0.0.1:<n>    one proxy per dev-server port, for the Browser surface
```

- **One contract.** `contracts/src/index.ts` types every item, event and method. The engine and
  the app both import it; change a shape there and both sides follow.
- **Events, not polling.** The engine pushes `thread`, `item`, `delta` (streamed text),
  `providers`, `settings`, `keys`, `notify`, `groups`, `routine`, `run`, `settled`, `mcp`, and the
  surfaces' streams (`term`, `devlog`). The app applies them to one store and re-renders at most
  once a frame (a timer stands in when the window paints no frames, so the Dock badge keeps up).
- **The Reviewer.** After a coder turn that edited files, a model from another family reads the
  diff against fixed criteria and answers with findings as data (`<findings>{…}</findings>`). A
  blocker goes back to the coder; after two rounds it comes to you.
- **Routed sessions** (after GitHub Copilot's Fusion). `route.ts` scores each message from its
  words (reasoning, code, debugging, tools, reach) and rules in order pick the pattern: one model
  alone; a cascade, where the everyday model (GPT Luna) writes and a judge from another family
  (Opus) passes it or hands it to the strong model to repair; or a critique, where the strong
  model writes, critics from other families read side by side and it revises once. Standard,
  High and Max set how far it goes. A follow-up keeps the working model while its cache is warm.
  Judge and critic reads are logged as their own usage rows.
- **Routines.** A trigger (schedule, a pull request or issue through `gh`, a webhook, by hand)
  starts a run; AI steps read, audit or work in a session; then the gate, in code, checks its
  rules and only it acts (merge within a daily limit, comment, label, close, hand it to you).
  `routine.test` does everything but act.
- **Liner MCP** (`mcp-http.ts`, `mcp-apps.ts`, `mcp-oauth.ts`, `tunnel.ts`, `mcp-webhook.ts`). Apps outside Liner Code
  (Claude Code or Codex in a terminal, Claude, ChatGPT, Grok Bot, Muse) list and read sessions, pull requests, issues and
  findings, start a session, message it, wait for it, scan a pull request or an issue, and stop one. Nothing is let in until
  Settings › Liner MCP's Let apps outside Liner Code in is on. A terminal agent comes in on stdio (`outside.ts`, through
  `/outside`); any other app through a listener of its own on 127.0.0.1:7318 (or a free port), which answers only POST/DELETE
  `/mcp` with a Bearer key or OAuth access token, and the OAuth routes (`/.well-known/…`, `/register`, `/authorize`,
  `/token`). An app added by hand gets an `lc_…` key, shown once and kept only as its SHA-256 in `mcp-apps.json` (0600),
  for 30 days; an app that signs in itself gets a card in the app only within 15 minutes of your picking it in Add an app
  (`mcp.expectSignIn`), and is let in only once you allow it there (at most 10 cards a minute; allowing one closes the
  window; `/register`: 300 registrations a minute). Each
  call goes through one gate at the app's level: Read only; Asks first, where a start, send, answer, scan or stop waits up
  to ten minutes for your Allow; Trusted, whose sessions run at your default access but never Full access. A message or an
  answer to a session at Full access always asks. A revoked terminal agent is turned away by its name until let in again. No app answers a permission ask or changes a
  setting, and each gets 60 calls a minute. From the internet (off unless picked): Tailscale Funnel (`tailscale funnel --bg
  <port>`, taken down with `tailscale funnel --https=443 off`), a Cloudflare quick tunnel (`cloudflared tunnel --url
  http://127.0.0.1:<port>`, a new trycloudflare.com address each start), or your own https address. Each start lists its
  steps for Settings (`Tunnel.checks`: tool, signed in, Funnel on, :443 free, started), and once up the engine GETs its own
  public `/.well-known/oauth-protected-resource/mcp` and expects its own address back, then every 5 minutes and on
  `mcp.checkAgain`; `mcp.halt` stops a start that hangs. The engine's own
  server still takes no host but its own. Tell an app posts `{event, session title, app}` with your secret to your https
  webhook when a session starts waiting on you: never to this computer or a private network, no redirects, 10 seconds, two
  retries.
- **Pull requests and issues** (`worklists.ts`, `sourcecontrol.ts`). GitHub's come from `gh` in each project's folder
  (`gh pr list`, `gh pr view`, `gh issue list`, `gh issue view`, `gh api user`), Linear's from its API with your key; each
  list is kept for Settings › Source control & issues' refresh (`worklistRefresh`, 120 seconds), and a project that can't be
  read is named with why. Once Pull requests has been opened on this Mac, the sidebar reads the open list every refresh
  (60 seconds at the least, 0 for never) while the window shows, for its review dot. Open a session on it and Start a
  session from it use `thread.create`, Merge uses `pr.merge` after a confirm. The Source control scan asks each tool it
  finds for its version and its sign-in, never a token; a Linear key or a Bitbucket app password sits in the keychain as
  `scm.linear` or `scm.bitbucket` (the Bitbucket one is used for nothing yet).
- **Scans of pull requests and issues** (`security-targets.ts`, `security-watch.ts`). A read-only Liner Security session of
  your own tool (sealed when a Specialist runs it), reading through `gh pr view`, `gh pr diff` or `gh issue view` (a Linear
  issue can't be scanned yet); a head
  commit that isn't here is fetched with `git fetch --no-tags --no-write-fetch-head origin pull/<n>/head` (objects only).
  Comment posts its summary with `gh pr|issue comment --body-file -` on a second press. Scan new PRs, off by default, is a
  60-second timer that looks every five minutes at the least while a window is open, and scans a pull request that opens or
  gets new commits: one at a time, never a draft, at most ten a day, resting one whose scan keeps failing to start
  (`security/watch.json`).
- **Worktrees.** A session can run in a worktree of its own; a project's setup command (like
  `npm install`) runs there before the first turn.
- **Turns.** For each message: snapshot the tree, open or reuse the provider session, map its
  stream into items (text, thinking, tool calls, plan, approval, question, proposal), wait on
  you where it must, then snapshot again and write a checkpoint item with the files changed.
- **Lead and coder.** With a lead, your message goes to the lead in read-only mode; its plan
  becomes a card; approving it starts the coder with the plan. "Or tell it what to change" goes
  back to the lead.
- **Queue and steer.** Messages written during a turn queue and go as one message when it ends;
  steering pushes into a running Claude Code turn at its next step.
- **Model lists.** Each tool is asked which models it has, with each model's effort levels, by a listing that runs no
  model turn: at launch when the saved list (`models.json`) is half a day old or the tool's version changed, on Look
  again in Agent tools, and in Check my tools (30 seconds each). Claude Code: the Agent SDK's `supportedModels()` on a session
  with no prompt (`~/.liner-code/probe`, your user settings only, 30 seconds), and a second one with the older models in
  its picker (`modelPicker`) only when its answer isn't kept yet for that account and `claude --version`. Codex: `codex
  debug models` (20 seconds). Antigravity: `agy models` (30 seconds). OpenCode 2 and later: `opencode api --standalone GET /api/model`
  in the probe folder, its whole process group ended past 30 seconds or on a stop; an older OpenCode, or one whose list
  fails, and every other ACP agent: `initialize` and `session/new` in the probe folder (45 seconds), then it is ended. All
  run with the engine's environment; only a model's id, name, description, group, levels, default and price are kept.
- **AI pictures** (optional). An endpoint of yours that speaks OpenAI's Images API, set up in Settings › Agent tools
  (`settings.pictures`, its key in the keychain as `pictureKey(id)`). The engine posts to its `/images/generations`
  for Liner Design's pictures (your press in the Picture pane, `pictures.make`; an agent's `design_picture` after a card,
  unless the design file says not to ask), with the lean's colours, and for one landscape picture for the dots behind
  Home (`wallpaper.draw`, your press of Draw it: the words you typed and nothing else). Both go through one request in `engine/src/pictures.ts`: https only (http only on this Mac), no
  redirects, the answer capped at 40 MB, a linked picture fetched without the key and never from a private network, only
  picture bytes kept, the key only in the header and taken out of every error. Each picture is charged to that account.
- **Pictures of your own.** The one behind a session (`background.*`) and the one drawn as dots behind Home
  (`wallpaper.*`) are kept apart under `~/.liner-code/backgrounds` (`own.jpg`, `dots.jpg`), made JPEGs with `sips`;
  neither is sent anywhere. The dots are drawn in the app from that picture, words or a built-in scene.
- **Storage.** `state.json` (written atomically, debounced) and one append-only JSONL log per
  thread; the newest line for an item wins and the log is rewritten when it grows. This is fine
  to tens of thousands of items per thread. Past that, move to `node:sqlite` (built into Node)
  with the same item model.

### Adding a provider

Implement `Provider` in `engine/src/providers/types.ts`: `detect(env)` says whether it's installed
and which models it has, `open(options)` returns a session whose `turn(text, sink, signal)` streams
into the `TurnSink`. Any agent that speaks the Agent Client Protocol is one line in `acp.ts`
(Gemini CLI, Goose, claude-code-acp, Cursor's ACP mode).

## Security model

- The server listens on **127.0.0.1 only**, and `/rpc` and `/events` must carry the random token the
  shell generates at launch (compared in constant time); the few other routes each have their own
  key or one-time token, listed in `SECURITY_MODEL.md`. Other apps and web pages on the Mac can't
  drive your agents.
- **Keys** are sealed with Electron's safeStorage (its key sits in the login keychain). The shell
  hands them to the engine once, over its standard input (never its environment, which other processes can read), and the engine passes them only to the tool that uses them (Anthropic → Claude Code
  when billing is set to the key; OpenAI → Codex). They are never written to disk or sent to the app.
- **Approvals** come from the agent's own permission system (Claude Code's `canUseTool`, ACP's
  `session/request_permission`). In Full access the **guard** still asks before force pushes,
  `rm -rf`, `sudo`, publishing, `curl | sh` and similar.
- **Liner MCP's listener** is a second door on 127.0.0.1, open only while apps are let in. It serves `/mcp` and OAuth and
  nothing of the app (`/rpc`, `/events`, `/surface`, `/outside` and the UI are 404 there), answers only its own address or
  the tunnel's public host, and lets a call in only with an app's key or a sign-in you allowed, at that app's level.
- ACP agents read and write files only **inside the project**; paths that resolve outside it are refused.
- Snapshots go through a **throwaway git index**: your staging area is never touched, and undo
  writes files back without changing what's staged.

## When a cloud backend is needed

| Feature (board) | What it needs | A fit with your other projects |
| --- | --- | --- |
| Phone app, remote control (Phone) | a relay that pairs a phone with this Mac's engine, end-to-end encrypted; push notifications | a small WebSocket relay on Railway or Fly.io; APNs; or Tailscale for a self-hosted path |
| Routines on webhooks (Routines, RoutineTrigger) | a public URL that forwards signed webhooks to the Mac, and a queue for when it's asleep | Vercel Functions + Upstash Redis (queue) + the relay |
| Team sharing (Share access, workspaces) | accounts, auth, shared agent definitions; transcripts only if encrypted | Vercel + Upstash + Resend sign-in links (as on the Liner UI site) |
| Licences and updates | licence check, a Sparkle appcast, notarized downloads | Ko-fi webhook → Upstash (as Liner UI Pro), appcast on Vercel |
| API-key models without a CLI | nothing server-side: the engine calls the provider directly, or via OpenCode | – |
| Crash reports | opt-in only | Sentry, or nothing |

None of these should ever proxy model traffic: calls go from the Mac to the provider, on your account.
