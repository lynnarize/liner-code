<!--
Draft for a bug report on pingdotgg/t3code (template: Bug report). Each "##" heading below is a
field of the form; paste its text into that field.

Before posting:
- The "Before submitting" checkboxes: I searched issues on 2026-11-06. #16073 shows the same message
  (closed 2026-10-14, after subagents); #30447 is an open PR on the same check. Neither covers this
  repro, but look again in case something new landed.
- The repro was run over the WebSocket protocol, not in T3 Code's app. The "In the app" steps are
  what should hit the same path; try them in your T3 Code first if you can, and delete that part
  if you can't.
-->

**Title:** [Bug]: After a Claude model change, switching the thread to another provider is refused for good ("still running background agents or commands")

## Area

apps/server

## Steps to reproduce

Over the WebSocket protocol (`t3 serve`, orchestration protocol 2), in one thread:

1. `orchestration.launchThread` with `modelSelection` `{ instanceId: "claudeAgent", model: "claude-sonnet-5-5" }`, `runtimeMode: "approval-required"`, `interactionMode: "default"`, and the message "Remember the number 41. Reply with just OK, and don't use any tools." Wait for the run to complete.
2. `message.dispatch` (`dispatchMode: { type: "queue_after_active" }`) with `modelSelection` `{ instanceId: "claudeAgent", model: "claude-opus-5-5" }` and "What number did I ask you to remember? Reply with just the number, no tools." It completes and answers "41", with no handoff.
3. `message.dispatch` with the same text and `modelSelection` `{ instanceId: "codex", model: "gpt-5.6-luna" }`.

In the app, this should be the same: start a thread on Claude Sonnet and send a message; pick Opus and send another; then pick a Codex model and send a third.

It happened on all three tries. Without step 2 (Sonnet straight to Codex), the switch is accepted every time and hands the context over.

## Expected behavior

The thread switches to Codex and hands the context over, as it does when step 2 is left out. Neither Claude turn started a background task, a subagent or a command.

## Actual behavior

Step 3's `message.dispatch` fails:

> The previous provider is still running background agents or commands, and switching would end them. Wait for them to finish, or press Stop, then send the message again.

It doesn't clear on its own: the same send was still refused minutes later. It doesn't clear after `thread.stop` either. The thread's projection shows every run completed, every node completed, no subagents and the Claude session `ready`.

## Impact

Major degradation or frequent failure

## Version or commit

`t3` 0.1.7 (the npm launcher's darwin-arm64 build). The check is unchanged on main at `337c5858c`.

## Environment

macOS (Darwin 27.2), Apple Silicon. Headless: `t3 serve --no-browser --base-dir <a folder of its own>`. Claude Code 2.1.318, Codex 0.166.0. Models: claude-sonnet-5-5, claude-opus-5-5, gpt-5.6-luna.

## Logs or stack traces

```shell
OrchestratorDispatchError: Failed to dispatch orchestration command message.dispatch (…).
cause: The previous provider is still running background agents or commands, and switching would end them. Wait for them to finish, or press Stop, then send the message again.
```

A guess at the cause, not confirmed. The refusal comes from `sessionHasBackgroundWork` in `Orchestrator.ts`, which calls the Claude session's `hasPendingBackgroundWork` (`ClaudeAdapterV2.ts`). That probe also returns true when any `wakeBuffers` entry holds a `user`, `assistant` or `result` message. My suspicion is that the query replaced at the Sonnet to Opus change leaves a message in a wake buffer that's never drained, or that the probe fails, which the orchestrator counts as busy. Related: #16073 shows the same message with every subagent completed (closed 2026-10-14). #30447 moves this check into `sessionHasBackgroundWork`.

## Workaround

`thread.fork` with `sourcePoint: { type: "latest_stable" }`, then send on the fork with the Codex model. It's accepted, and Codex answers "41" with the context kept. But the conversation moves to a new thread, and per #28949 a fork may not get its per-thread `t3-code-<threadId>` MCP server.
