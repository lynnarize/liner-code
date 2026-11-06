<!--
Draft for T3's Ideas discussions: https://github.com/pingdotgg/t3code/discussions/categories/ideas
(T3 takes feature requests there, not in issues.) It builds on the open Tools stack, #21815,
#21816 and #21817, which wasn't merged on 2026-11-06; check it hasn't changed before posting.
Naming Liner Code is up to you; it reads fine with "a desktop app" in its place.
-->

**Title:** Shared Tools: MCP servers scoped to one thread, settable by a headless client

I'm building Liner Code, a desktop app for coding agents, and looking at running it on T3's
engine: `t3 serve` headless, driven over the WebSocket protocol, with our own app in front. Plans,
handoffs between Claude Code and Codex, turn diffs and helper threads all work from outside
through the public commands. The one thing we can't do yet is give the agents our own tools.

The Tools stack (#21815, #21816, #21817) looks like the right home for this. It stores shared MCP
servers per environment with project overrides, and gives them to every provider's sessions.
Two things would make it work for an app like ours:

1. **A server for one thread.** Our MCP server is one per session. Each has its own key, and
   reaches only that session's Browser, Simulator and design surfaces. T3's own
   `t3-code-<threadId>` server works the same way. Could a Tools entry be scoped to a thread? Or
   could its URL, headers or env take the thread's id (say `${threadId}`), so one entry serves each
   thread its own?
2. **Setting it headless.** Can a client with the `providers:manage` scope set these through
   `server.updateSettings`, or another RPC, rather than Settings → Tools? Is it picked up by new
   sessions only, as #21816 says? We'd set it before a thread's first turn, so that would be fine.

Happy to test either against a nightly, or to help with the change if it's wanted.
