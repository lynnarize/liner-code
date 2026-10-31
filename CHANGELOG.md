# Changelog

## 0.1.7 (alpha), 2026-10-31

**Update from 0.1.6 if you have it.** Liner Code does it by itself (Restart to update), or
download the new DMG.

### New

- **A cleaner Home.** One light bar holds who works on it, the effort and the access, each drawn
  small beside its word. Under the box, one line: the checkout and the branch, then a scratch
  folder, a session to carry on from Claude Code or Codex, and a key that lists what the box
  takes. The Desk's pill is solid white.
- **A quieter sidebar.** Search sits on one row with a filter, a new project and a new session
  beside it; the filter field shows from its button. Settings, Routines, the team and Usage are
  icons along the foot, with you at the end, and the team opens as a list from its icon. A
  project's + shows when you point at it.
- **Terminals stay** when you switch sessions or close the panel, scrollback and all. ⌘-click a
  localhost link in a terminal to open it in the Browser.
- **Answers show** tables, links, `file.ts:42` references you can click, and highlighted code.
- Images and PDFs go to the model as they are, and show as thumbnails in your message. A large
  paste becomes an attachment.
- Claude Code's background work, and the turns it starts on its own about it, now show up, and
  Stop stops them too. Its newer task lists fill the plan panel, and a steer acts at once.
- A turn cut off by a quit or a crash carries on by itself, up to 3 times in 5 minutes (Settings ›
  Usage limits turns it off). Carrying on when a usage limit resets is a switch of its own, off to
  begin with.
- ⌘K opens any surface, searches inside messages, and copies the branch or the session's id.
  ⌘1–9 open sessions, ⌥⌘↓ goes to the next one that needs you, and F6 moves between areas.
- A minimap of your prompts, and each session opens again where you left it. Queued messages get
  Send now, drafts survive a restart, and the context ring opens a Compact menu.
- The Browser shows where the agent clicks. Files previews images and Markdown, and the diff has
  word wrap and Hide tests.
- Pick several sessions in the sidebar (⌘- or ⇧-click) to settle, snooze, archive or move them at
  once. ⌘Enter on Home starts a session in the background.

### Changed

- ⌘Q asks first while sessions are working, and ⌘K's Delete asks first, with Keep it as the
  default.
- Retries ("overloaded"), compaction, sign-in trouble and failed turns say what happened.
- A part of the window that breaks shows its own error with Try again, instead of blanking the
  window. Streaming no longer draws the whole thread again on every token.

### Fixed

- File names with accents, or the spaces in macOS screenshots, work for the diff, Undo and Commit,
  and an Undo that fails no longer counts as done.
- Undo and Edit from here won't overwrite a file you changed after the turn: they say which files
  and offer Undo anyway, and they wait while another session works in the same folder.
- Deleting a session or cleaning up worktrees never forces a removal: a worktree with changes, one
  another session works in, or one you made yourself stays.
- Snapshots no longer miss an edit made in the same second, and a turn that pulls or merges claims
  only its own files.
- Auto no longer takes `git branch -D` as a read, and more destructive commands count as high
  risk.
- Saved state survives a crash. Commits get 10 minutes for hooks and signing, and diffs ignore
  your own diff tool settings.
- A resume that fails carries the conversation over: Claude Code no longer stops, and Codex and
  ACP agents no longer start again with no memory. A Codex steer that fails goes to the queue, and
  Stop on an ACP agent gives up after 15 s instead of hanging.
- A link whose text is a URL no longer puts a link inside a link.

## 0.1.6 (alpha), 2026-10-30

**Update from 0.1.5 if you have it.** Liner Code does it by itself (Restart to update), or
download the new DMG.

### New

- **Memory across sessions.** Agents save what they learn about a project with memory_add, and
  every new session there starts with it; sessions_search reads earlier sessions. Settings ›
  Projects shows the memory and lets you edit it.
- **Agents outside Liner Code can work with your sessions** through its MCP server: list, read,
  start, message and wait for them. It's off until you turn it on in Settings › Safety, with a
  key only you can read.
- **Agents check pages when the session isn't on screen.** The app keeps a hidden Browser for
  it, where scripts run and the console is read, and a screenshot still works.
- **The Browser opens only what's the session's.** A dev server is known by the session that
  started it, plain HTML opens from the session's folder with no server, and archiving or
  removing a session stops the servers it started.
- **Carrying on at a usage limit:** another account of the same tool first, else another
  family's everyday model, from the limit card or by itself (Settings › General).
- **Reviewer decides** asks the Reviewer's quickest model about each step and brings you only
  what it won't allow. Auto is the tool's own auto mode.
- Routed work: the model for each role (everyday, hard jobs, judge, critics) is yours to pick.
- Codex's command output streams into its running step, and every running step counts up.
- A turn that has said nothing for 4 minutes (12 while a command runs) says so once, on the
  timeline and as a notification.
- A tool's update shows its progress as a bar.
- Agents get a ripgrep when the Mac has none, and a failed command says how it ended (exit 127:
  not installed).

### Changed

- **A plan writes quietly.** While the lead writes its plan, one line says so, with its steps so
  far, and opens for a look; the plan card takes its place when it's done. Claude Code's own plan
  mode gets the same line.
- Edits in a row to one file are one step on the trail ("7 edits · ✓ You allowed ×4"), and
  thinking too short to show leaves no gap.
- The sidebar names the lead while it plans and while its plan waits on you.
- Esc closes the / or $ list first; it stops the turn only after.

### Fixed

- The context ring read 100% in long sessions: it added up every request of a turn. It reads the
  last one now, for Claude Code and Codex.
- A message sent as a turn ended could start a second turn beside it, and one sent during a
  review never went. What you send while work is in flight now waits and goes when it ends; Stop
  keeps it for you.
- Auto and "don't ask again" took `ls & rm …`, a command on a second line, `rg --pre` or a sed
  that writes as reading. A routine's trust lasts only for its own step, and its steps never
  push, merge or post.
- Stop pressed while a tool was still opening didn't stop it, and a request left from a turn
  that had ended kept the session in Needs you.
- Claude Code: a steer's answer could be lost, spend was counted again after a restart, extra
  usage read as a usage limit, and a plan you edited before approving wasn't the one it built.
  /usage and other local commands now show what they print.
- Codex showed an error twice, and a stopped command could go back to running. An ACP agent's
  text either side of a step ran together, and its cost was counted more than once.
- A failed send lost your prompt and files. Editing a plan step lost focus after each letter.
  ⌘⇧D and ⌘⇧P could settle or pin the open session. A Browser step's line ended in a stray dot.
- Keeping the default branch pulled no longer moves a checkout under a session working in it.
- First run said "1 tool and 0 keys is ready", times could read "1m 60s", and settings switches
  had no names for VoiceOver.

## 0.1.5 (alpha), 2026-10-29

**Update from 0.1.4 if you have it.** Liner Code does it by itself (Restart to update), or
download the new DMG.

### New

- **Side chat** (⌘⇧C, or the top of the session tray): ask about a session beside it without
  stopping it or adding to it. Who you talk to in the session answers from the conversation so
  far, reads what it needs and changes nothing; a command still asks first. Catch up starts it
  again from where the session is now.
- **The panel beside a session is yours to size.** Drag its edge, or focus it and use the arrow
  keys; double-click puts it back. It opens at about a third of the session now, and the width
  you pick holds in every session.
- **Main buttons in one colour, red to start.** Send, Commit and push in the session tray, and a
  card's main button. Settings › Appearance › Main buttons sets it: red, the accent, ink like
  the tray, or a colour of your own.

### Changed

- A sidebar row is two lines: the title with how long ago, then where it stands. Under its
  project it doesn't name the project again; in Pinned, your groups and the shelves the second
  line starts with it. Pin, snooze and settle show where the time was.
- Home's effort and access menus open downward, under the composer, and scroll in the room
  there rather than covering the question.
- Tiles inside the composer's and the session tray's pills are round, like the pills.
- A narrow composer lets the word "effort" and the model marks go, then shortens the name;
  narrower still, its controls take two lines.
- The disk image opens on a window that says what to drag where, with an arrow from Liner Code
  to Applications, and how to open it the first time: System Settings › Privacy & Security,
  Open Anyway.

### Fixed

- In Agentic features, the way you picked had a square blue ring round its rounded card. The
  ring follows the card's corners again.
- Liner Code's name and the sidebar button beside it, and Settings' name, sat 6px under the
  traffic lights. They sit on them again.
- With the sidebar hidden, the top bar's row sits on the traffic lights too (in full screen,
  where they're hidden, it stays where it was).
- A menu on Home that had more to show snapped back to its top as you scrolled, and scrolling in
  it, or beside it, slid the Desk in under it.
- In a narrow window the composer's controls ran over each other.
- The highlight on the effort and agent pickers met the pill's edge instead of sitting inside it.

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
- **The composer** is one text box with its controls inside, under what you type: who works on
  it, effort, access, and Send in the accent. While a turn runs, Stop sits beside Send, and the
  note beside them says what Enter does (press it to change that).
- **Commit and push plays out in the thread.** The chip grows into a card, your commits come into
  focus from the bottom up, the line to origin flows while it pushes and the ring turns green when
  it lands; then it folds back into a chip, with Open a pull request beside it.
- **The pull request card** in the thread and the Pull request panel read the same way: your
  commits on a rail under Merge into main, what reached main in amber beside them, each clash
  with its two lines, the checks in one row, and one status line with Resolve conflicts or Squash
  and merge beside it.
- **Asks are one row**: what the agent wants, its risk, Not this and Allow side by side. What it
  says and exactly where it runs fold under Details; a high-risk ask shows them, so you read
  before you hold.
- **New agent, in two columns**, and three new things an agent knows: a **prompt** added to every
  turn after its soul, **skills** (skill.md files it reads when a task calls for one, yours or
  each project's own) and **context files** read at the start of each session.
- **Routed sessions** (after GitHub Copilot's Fusion): pick Routed in the composer and each
  message gets the least work likely to do it well: one model, a cascade where a judge from
  another family passes the change or hands it to the strong model to repair, or a critique.
  Standard, High and Max set how far it goes.

### Changed

- Every card is white on the paper, with a 1px ring. Menus, popovers, ⌘K, tooltips and toasts
  are solid, with a soft shadow; the session tray's commit form and push menu open beside it.
  Reconnecting is an ink pill.
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
- The composer didn't shrink when you deleted lines (Shift-Enter, then Delete), and an empty one
  could stay several lines tall after the window widened.
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
