# Changelog

## 0.1.4 (alpha), 2026-10-29

**Update from 0.1.2 if you have it.** Liner Code does it by itself (Restart to update), or
download the new DMG.

### New

- **One solid ground.** The window's glass frame is gone: the sidebar sits on the ground, and
  Home, a session, Usage and Settings sit on a white paper inside it, with no rim, gap of glass
  or line between them. The side panel is a column inside the paper, and the diff ends where it
  ends.
- **The session tray** stands at the thread's right edge in a lane of its own, so it never covers
  what you read. It is the one glass surface left: solid controls inside, the open surface's
  icon on a tile, and the files waiting to be committed in a chip inside Commit and push.
  Settings › Appearance › Session tray sets its glass: Clear, Tinted or Solid.
- **The composer** is one text box with its controls inside, in a tray of their own: who works on
  it, effort, access, and Send in the accent. While a turn runs, Stop sits beside Send, and the
  note beside them says what Enter does (press it to change that).
- **Commit and push plays out in the thread.** The chip grows into a card, your commits come into
  focus from the bottom up, the line to origin flows while it pushes and the ring turns green when
  it lands; then it folds back into a chip, with Open a pull request beside it.
- **New agent, in two columns**, and three new things an agent knows: a **prompt** added to every
  turn after its soul, **skills** (skill.md files it reads when a task calls for one, yours or
  each project's own) and **context files** read at the start of each session.
- **Routed sessions** (after GitHub Copilot's Fusion): pick Routed in the composer and each
  message gets the least work likely to do it well: one model, a cascade where a judge from
  another family passes the change or hands it to the strong model to repair, or a critique.
  Standard, High and Max set how far it goes.

### Changed

- Menus, popovers, ⌘K, tooltips and toasts are solid, with a soft shadow. Reconnecting is an
  ink pill.
- The L mark is gone: the sidebar and Setup say Liner Code, a size larger.
- Settings keeps its layout, with white cards and a 1px ring. Appearance shows the window in
  miniature, the modes as cards and pictures as tiles; Behind the glass and the window's Clear to
  Tinted are gone.
- Usage sits on white cards; the routine builder's canvas and Step settings sit on the paper; in
  Agentic features the ways are two across, the last 30 days fold under one row, each test result
  is one line with its details a press away, and the wiring starts with who writes.
- Buttons are pills; a picked row is a solid plate.

### Fixed

- Pickers inside a dialog (New agent's effort and model) opened underneath it.
- Usage › Limits showed rows of NaN%: only Claude Code's five-hour and weekly windows count now.
- The cost test lets Codex run read-only commands, a quick model that changed nothing is read by
  the judge and handed up, and Codex's running token totals no longer write over Claude's.

## 0.1.2 (alpha), 2026-10-28

**Update from 0.1.1 if you have it.** Liner Code does it by itself (Restart to update), or
download the new DMG.

### New

- **Session tab** (⌘⇧I, first in the panel): where the session runs (Mac, folder, branch, tool and
  model, access), what fills its context (Claude Code's own breakdown; the last turn's total for
  the rest) with **Compact**, and the changes still to commit, each opening in the diff.
- **Commit some of the files.** The commit form lists them; untick what should wait for a later
  commit. Undoing a turn leaves its committed files alone.
- **Export a session as Markdown** (the session's menu, or the Session tab): asks, plans, answers,
  findings and each turn's diff, saved in Downloads.
- **Carry on a Claude Code or Codex session** from Home: one from the project's folder comes in
  with its timeline, and the next turn resumes the tool's own session.
- **Rules for every agent** (Settings › Projects): one text in AGENTS.md, with CLAUDE.md pointing
  to it, so Claude Code, Codex, OpenCode and Cursor read the same rules.
- **A spending cap per session** (Settings › General): a session or routine run that spends it
  stops and says so; your next message lets it go on for another cap's worth. Claude Code reports
  cost; other tools can't be held to it.
- **The menu bar**: a ring counts what works and what needs you; its menu opens a session or
  allows a request waiting in one. Settings › Notifications turns it off.
- **The Mac stays awake** while a session or routine run works (no idle sleep). Settings › General.

### Changed

- The Demo is hidden: tap your name at the foot of the sidebar six times to show it, six more to
  hide it.
- The Reviewer lets small changes through (6 lines or fewer, or docs alone); "Small ones too" on
  its row in Agentic features has it read them.
- Snapshots start from the repository's own index, so they only read changed files: a 30,000-file
  repository went from about 2 s to under 0.1 s per snapshot.
- Settings, Setup, Usage and Compare load when you first open them; the app's main script is a
  fifth smaller.

### Fixed

- The Desk cue's draining line runs under its words, clear of the chevron.
- The note under Open a surface has its own spacing again.

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
