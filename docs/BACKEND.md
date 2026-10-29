# Backend requirements

## Short version

**Version 0.1 needs no server of yours.** The backend is the *engine*, a local Node process the
app starts and stops. It talks to the agent CLIs on the Mac, and they talk to their own
providers with your own sign-ins. Nothing about your code or sessions leaves the machine except
what the agents themselves send to their model providers.

A cloud backend becomes necessary only for features on the roadmap: the phone app and remote
access, routines triggered by webhooks, sharing with a team, licences and updates. The last part
of this document says what each of those needs.

## What a Mac needs to run it

| Needed | Version | Why |
| --- | --- | --- |
| macOS | 14 or newer; 26+ for Liquid Glass | the shell; older systems get vibrancy |
| Node.js | 22.18 or newer (24 or 26 recommended) | runs the engine's TypeScript directly (type stripping) |
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
                                          ├─ Hermes, OpenCode (ACP: JSON-RPC over stdio)
                                          ├─ git           (snapshots under refs/liner/, worktrees)
                                          ├─ gh            (pull requests, checks; routines poll it)
                                          ├─ python3 pty   (the Terminal surface)
                                          ├─ xcrun simctl  (the Device surface)
                                        POST /hooks/r/<id>?key=…  a routine's webhook (its own secret)
                                        127.0.0.1:<n>    one proxy per dev-server port, for the Browser surface
```

- **One contract.** `contracts/src/index.ts` types every item, event and method. The engine and
  the app both import it; change a shape there and both sides follow.
- **Events, not polling.** The engine pushes `thread`, `item`, `delta` (streamed text),
  `providers`, `settings`, `keys`, `notify`, `groups`, `routine`, `run`, `settled`, and the
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
- **Storage.** `state.json` (written atomically, debounced) and one append-only JSONL log per
  thread; the newest line for an item wins and the log is rewritten when it grows. This is fine
  to tens of thousands of items per thread. Past that, move to `node:sqlite` (built into Node)
  with the same item model.

### Adding a provider

Implement `Provider` in `engine/src/providers/types.ts`: `detect(env)` says whether it's installed
and which models it has, `open(options)` returns a session whose `turn(text, sink, signal)` streams
into the `TurnSink`. Any agent that speaks the Agent Client Protocol is one line in `acp.ts`
(Gemini CLI, Goose, claude-code-acp, Cursor's ACP mode once it ships).

## Security model

- The server listens on **127.0.0.1 only**, and every request must carry the random token the
  shell generates at launch (compared in constant time). Other apps and web pages on the Mac
  can't drive your agents.
- **Keys** are sealed with Electron's safeStorage (its key sits in the login keychain). The shell
  hands them to the engine once, through its environment, and the engine passes them only to the tool that uses them (Anthropic → Claude Code
  when billing is set to the key; OpenAI → Codex). They are never written to disk or sent to the app.
- **Approvals** come from the agent's own permission system (Claude Code's `canUseTool`, ACP's
  `session/request_permission`). In Full access the **guard** still asks before force pushes,
  `rm -rf`, `sudo`, publishing, `curl | sh` and similar.
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
