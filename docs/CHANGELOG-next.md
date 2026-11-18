## Next (not released)

Update from 0.2.8: on a Mac Liner Code does it by itself (Restart to update), or download the new DMG;
on Windows, run the new setup. **Liner Security**, a third face that scans your code, keeps what it
finds and fixes it. **A new left panel**, with sessions by folder, each saying what it is doing now.
**Check my tools** and **a prompt check** before you send. **A smoother app while an agent answers**,
and Stop that always stops.

### Added

- **Liner Security:** the name at the sidebar's foot now switches Code, Design and Security. Security
  has an Overview, Findings, Projects and Start a scan. A scan is a Read only session of your own tool:
  it asks what your threat model does not say and waits for the answer, and can take a second look
  with another maker's model. Free checks need no agent: secrets in tracked files (never kept
  unmasked), npm audit, and files that should not be in git. GitHub alerts and SARIF files can be
  brought in. Fix opens a worktree session with the finding as its brief. A scan never leaves Read
  only and takes no checkpoints; a Specialist scan runs without skills, plugins, hooks or add-ons,
  which today only Claude Code can do.
- **Check my tools:** Settings › Models shows what is found, signed in and loading, then points the
  real tool at a test model on this Mac to see that Read only and Manual still hold. It sends one real
  test message only when you press for it.
- **A prompt check before send:** it offers to split a list of tasks into sessions, or to use the fast
  model for a small ask. The rule that asks a model is off until you turn it on.
- **Quit can wait for the work:** quit while sessions work and the app goes out of sight, then quits
  when they finish.
- **How long is left:** a working session says about how long it has to go, from how long its own
  turns took.
- **Try again or Carry on:** an overloaded provider offers Try again, and Carry on with another tool.
  A refusal says who refused and is never sent on to another provider.

### Changed

- **The left panel:** sessions are listed by folder, each row with a second line saying what the
  session is doing now or how it ended, and a mark for its pull request. By status is the second view.
  Views, Carry on, sort, groups and Add a project are in the one Sessions menu. The top row has Hide,
  Back and Forward on the left, and the working and waiting counts as a pill on the right that opens
  The Wall. Liner Design lists places on top and open designs in folders, and Liner Security lists
  scans, fixes and questions under their project.
- **The agent hears what changed between its turns:** the names of the files you changed and their
  line counts, never their contents.
- **Needs you means one thing everywhere:** a session is asking you something, or it finished and you
  have not read it. The sidebar, the top pill, the Dock and the menu bar now count the same sessions.
- **Stop always stops:** a tool that has not ended its turn 15 seconds after Stop is closed, and the
  session says so. It picks up where it was on your next message.
- **Step words agree:** the sidebar's line, the trail and the Design chat use the same words for a
  step; a Browser step at work reads "Checking in the Browser" in all three.
- **Design versions:** only sessions that draw keep copies of a design, and each keeps its newest 20
  turns for each design. Older turns can no longer be restored.
- **Commands' output as it runs:** ACP tools that send a command's output while it runs now show it.
- **Device:** Light and Dark is now a menu of two.
- **Window materials:** the Glass and Vibrancy materials are gone. A window saved with one of them
  is solid.
- **Updates** are looked for by themselves at most every six hours, not on every launch.
- **The sidebar** opens and closes in 180 ms when Motion is set to Quick.
- **The full-screen design view** no longer blurs the app behind it.
- **A sooner start:** the window opens while your login shell is read, and the text you see first has
  its font ready sooner.
- **A slightly smaller download.**

### Fixed

- Opening a session you had already opened fetched it again, and its live text froze until that
  returned. It now opens at once and keeps streaming.
- A reply streaming in one session redrew the dock's panels, the session on screen and the composer
  of another. Now only what shows that reply is redrawn.
- In Liner Design, dragging a frame was not smooth, and scrubbing a number or pulling a layer's edge
  wrote the file on every move. Dragging is smooth, and a scrub or an edge pull is written once, when
  you let go.
- A design kept being watched and checked after you left it. It is let go when its last tab closes.
- A large design frame could stall every session for a moment while the agent drew it.
- When a sidekick's brief ended, the lead's line in the sidebar went blank although the lead was still
  working.
- In Liner Design's rows, a session that failed or hit its limit showed as at rest. It now says so and
  is filed under Needs you.
- With two layers selected in Liner Design, their selection boxes drifted off the layers.
- Quitting while sessions worked could wait forever on an engine that had stopped answering.
- A plugin program that crashed was started again at once, over and over. It now waits before
  starting again.
- OpenCode, Hermes, Cursor, Grok and Antigravity could not read the files you attached through their
  own file reading, at any access level. They can now, at every level.
- OpenCode held a stopped turn open while it counted the turn's tokens.
- Listing slash commands for some tools opened an empty session in that tool every five minutes.
- The Browser showed some pages as garbled text: compressed pages and pages not in UTF-8.
- A commit message or pull request draft kept being written after you closed its card. It now stops.
