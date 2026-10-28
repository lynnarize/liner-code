# Changelog

## 0.1.1 (alpha), 2026-10-28

**Update from 0.1.0 if you have it.** Liner Code does it by itself (Restart to update), or
download the new DMG.

### Security

- **Agents can no longer get at the engine's token or your API keys.** In 0.1.0 the engine's
  token, the key that lets the app answer approvals, push and merge, sat in the environment of
  everything the engine started, and in the engine's own starting environment, which any
  process running as you can read (`ps eww`). A command an agent ran could have read it and
  approved its own requests. The app now hands the token and keys to the engine over a pipe, and
  nothing it starts inherits them.
- The Browser surface's proxy answers only requests addressed to itself (DNS rebinding) and keeps
  the `Origin` of other sites, so dev servers still turn them away.
- Webhook secrets are compared in constant time.

### Changed

- **Your agent tools aren't updated without asking.** Claude Code, Codex, OpenCode and Hermes
  updates start on *Just tell me*; choose Automatically in Settings › Updates if you want it.
  Liner Code's own updates stay automatic.
- Tools that nvm, Volta, pnpm, mise or asdf put on PATH in `.zshrc` are found.
- When an update downloads but can't replace the app, the next launch says why and links the
  release page instead of offering Restart to update again and again.
- Help › Report a Problem… also includes the previous launch's log and each tool's version.

## 0.1.0 (alpha), 2026-10-28

The first alpha: a Mac app (Apple Silicon) that drives Claude Code, Codex CLI, OpenCode and Hermes
with your own sign-ins, and shows their work as plans to approve, questions to answer, and a diff
for every turn that you can undo, commit or question line by line. Surfaces beside the session
(Terminal, Browser, Files, Pull request, Device, Routines), a Reviewer from another model family,
models compared side by side, Settings › Agentic features, the Desk, and updates from GitHub
Releases. MIT.
