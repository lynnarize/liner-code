# Changelog

## 0.2.5 (beta)

**Lead + sidekick.** A session is one model or a pair: the lead talks to you, plans, and hands
bounded work to a quicker model beside it, then reads what it did. It takes the place of Plan, then
build and Auto, and your sessions from before move over by themselves. **The picker is about models
only**, and the Reviewer has a switch of its own in the session's bar.

### Added

- **A pair:** the lead hands its sidekick one piece of work at a time (an edit it can spell out, the
  same change in many files, a slow test or build run) and waits for it. The sidekick works in the
  same folder under the session's access level, and its work shows as a row under the lead's turn:
  its steps, its tokens, its report and the files it changed, as Liner Code measured them, not as it
  said. Stop on its row stops it alone; the session's Stop stops both. Its use counts toward the
  session's spending cap. It remembers earlier briefs, so the lead can correct it rather than start
  over. It can't ask you anything, and it may not send agents of its own: one that tries is stopped,
  and the lead is told why. It works with Claude Code, Codex, OpenCode and Hermes, in any mix.
- **The Demo plays a pair**, so you can watch a lead hand work over with no account.

### Changed

- **Plan, then build and Auto are gone**, replaced by the pair. A Plan session's planner is now its
  lead and its builder the sidekick; an Auto session is led by its strongest model with its everyday
  one beside it. Each picks up from the conversation so far.
- **The model picker:** Pair, Best (the lead alone) and Fast (the sidekick alone), filled in from what's
  ready, then every model by tool, then your agents. Picking Pair shows who leads and who works, and
  each model has its maker's mark.
- **The Reviewer leaves the picker:** its word in the session's bar opens a menu to read each change
  or not, and who reads. Settings › Agentic features is down to two parts: your pair and the Reviewer.
- **The Reviewer is never one of the models that wrote the change**, the sidekick included. A change
  whose check was skipped because you'd queued a message is read afterwards, from where it started.
  A fix that changed nothing isn't read a second time: it's yours, and it says so.
- **Routines are switched off for now.** What you saved stays as it is, and comes back with them.

### Fixed

- A model whose tool is gone says so, instead of answering as the Demo.
- Picking another model after a usage limit really switches to it; before, the session kept running
  on the model it had fallen back to, while the picker showed your pick.
- ⌘K no longer drops what you type while it opens.
- The panel's tabs keep their names wherever they fit.
- Long tool calls no longer time out on OpenCode.
- A Codex session on Read only can use Liner Code's own tools.
- OpenCode's token counts were far too low on turns of several steps; they're right now.

## 0.2.4 (beta), 2026-11-09

**The first beta.** Update from 0.2.3 if you have it: on a Mac Liner Code does it by itself (Restart
to update), or download the new DMG; on Windows, run the new setup. **The Wall:** every live session
at once, as tiles you can answer from. **Who sent whom:** a model's agents fan out under its work.
**DeepSeek Harness plugins from npm**, and dev servers from `.claude/launch.json` that agents start
too. A live page in the Browser now costs about what it costs on its own.

### Added

- **The Wall** (⌘⇧O, "The Wall" in the sidebar, or the grid icon in a session's header) shows each
  live session as a tile (not one snoozed, settled or not yet started): its title, project and model, how it stands, and its latest
  steps, or once it's done, its answer in brief: the first sentence, its main points and the files it
  changed. What waits on you comes first, then what's working, then what's done, and All, Needs you,
  Working and Done filter them. From a tile you can allow a request or say no, pick an answer, retry
  a turn that stopped, settle what's done, or write to it: while it works your words steer it, and
  while it asks one thing they're your reason or your answer. High-risk requests, plans and a card
  of several questions open the session. 1–9 open a tile, the arrows pick one, typing writes to the
  one you picked (with an input method too), your words stay with that session however the tiles
  move, and Esc goes back; in the composer Esc first stops a running turn. A session you open
  from the Wall says where it sits ("3 of 7"), steps to the next tile, and Esc takes you back.
- **Dev servers from `.claude/launch.json`**, the file Claude Code reads, are listed in the Browser,
  each a press from running, and the server icon in its bar restarts or stops them. As Claude Code's
  do, they stop by themselves: after half an hour with no session in their folder on screen and
  none working, when the session that started one is archived, when another needs the port, and
  when Liner Code quits. One stopped while you were away, or by the quit, starts again when you
  open a session in its folder, unless its entry in launch.json changed since you ran it.
- **Agents start those servers too**, with `server_start`, as Claude Code's do with `preview_start`,
  instead of from their shell: the page opens in the Browser beside the session, and the server
  stops and starts again on the same rules. `server_logs` reads what it printed, `server_list` and
  `server_stop` do what they say. An entry you ran, or allowed once, runs again without asking;
  a command nobody has run from the file asks you first (in Full access, only one that can't be
  undone, or one whose environment changes what runs), and never runs in a routine. The card shows
  the command, its folder, its environment and its port, and any change to them asks again. Run in
  the Browser does the same for an entry Liner Code hasn't run as it is now: it shows what it runs,
  and only your yes trusts it. An entry an agent ran unasked in Full access isn't trusted for later.
- **DeepSeek Harness plugins from npm.** In Add add-on, type a DSH plugin's name (`dsh-media-desk`,
  or `npm i dsh-media-desk`) and it comes in as an add-on. A plugin with a sidebar page, a
  right-pane tab or a conversation view becomes a page, a dock panel or a tab. Its page runs in a
  sealed frame under a loader shaped like DSH's, with React and DSH's design tokens drawn in Liner
  Code's colours. If it has a program of its own, that runs in a separate process, never in the
  engine. On a Mac it runs under a sandbox: it can't read your keys, your agents' sign-ins or Liner
  Code's state, start other apps, or connect to another program's socket (ssh-agent's, Docker's),
  and it writes as it likes only in a folder of its own. A plugin with a page also gets a folder
  Liner Code makes for it in your Documents (Media Desk saves to ~/Documents/Media Desk), where it can
  save and save again pictures, sound, video, PDFs and plain text, but never code, settings, a file
  whose name starts with a dot, or a file that steers an agent like CLAUDE.md or AGENTS.md; Liner
  Code makes the folders inside it, never a bundle or a package's folder. If a folder of that name is
  already yours, it doesn't get it, and says so. Everywhere else in your Documents, Downloads,
  Desktop, Pictures, Movies and Music it may only add new pictures, sound, video and PDFs: no
  folders, nothing moved or cloned in, and never a change to a file that's already there, so nothing
  it leaves behind runs the next time you run tests, a build or a dev server. It still reaches the
  internet and every port on this Mac, and runs as you, so the card asks you to trust where it's from.
  On Windows and Linux there's no sandbox: a plugin's program runs as you, with your files and the
  internet, and its card and the Add-ons page say so. Its model calls go to a model you pick for it,
  as an app's do. A bundle that only connects an MCP server becomes a connection, and a key DSH would
  read from your environment is a key you type on its card. The card says what the plugin's program
  may do, holds to allow, and lists anything of DSH's that Liner Code doesn't have. A plugin with
  nothing Liner Code can show or give your agents is refused, with the reason.
- **A plugin's tools reach your agents.** The tools a DSH plugin gives DeepSeek Harness's agent come
  to Claude Code, Codex, OpenCode and Hermes as an MCP server run from the plugin's own process. The
  card lists them under "Gives your agents", read from the plugin's code, and they're the only ones
  offered; what it tells your agents is on the card too.
- **Who sent whom.** When a model sends agents off (Claude Code's Explore, Test runner and
  Subagent), they fan out under its work, each on a branch under the one that sent it: what it was
  sent to do, what it's doing now, its model, its tools, tokens and time, and once it's done, what it
  sent back. The session's header says who leads and how many work for it ("Sonnet 5.5 + 3 agents")
  and opens the whole crew as a list; the composer says who waits on how many ("Sonnet 5.5 is
  waiting on 2 agents"); the sidebar row says it too. The Agents surface (⌘⇧A) shows the crew as a
  tree (you, the mode, each model's part, the agents each sent, the Reviewer), a timeline of who
  worked when, with a model's wait on its agents hatched, the tasks with who took each, and what
  runs in the background. Open an agent to read its brief, its steps and its report; Stop it stops
  that agent alone, the model that sent it is told, and the turn goes on. The same goes for each
  tool's agents:
  - Claude Code's agents show their steps, model, tokens and report as they work. Claude Code 2.1.319
    runs them in the background by default: they carry on after the turn, still on show with a Stop,
    and end on their own row, even turns later. A word for one goes to the model that sent it, since
    Claude Code's agents can't take one mid-run. A session whose turn is over while its agents
    still work counts as working: on the Wall ("2 agents at work"), in the sidebar ("+ 2 agents"),
    for auto-settling, and when you quit, which asks first.
  - Codex's agents (spawnAgent) go by their Codex names and show their thread's own steps, model,
    tokens and last words, also after the turn that sent them; a word for one goes straight to it,
    read at its next step.
  - Hermes's delegations become a row per task, with its goal, role, model, report and the tools it
    used, from what Hermes says over ACP; ACP can't show their steps live, or stop one alone.
  - OpenCode's subagents stay off, as before: its ACP drops their permission requests, so they'd
    get past your access level.
  The Demo agent sends three when you mention agents, and they take a word as Codex's do.

### Changed

- **The sidebar shows sessions by how they stand**, in grey: what needs you, what's working and
  the rest, with a view menu (All, By folder, Snoozed, Settled, Archive) in place of the shelves, and
  Add-ons a group of its own. A pinned session that waits on you is marked as such.
- Home's composer matches the session's: attach first, then the choices, then Send. Standard, Auto
  and Solo each have an icon of their own.

### Fixed

- A live page in the Browser, such as a canvas game, took about half as much again of the CPU and
  three times the GPU as the same page alone. The composer's glass, the stage's round corners and
  the page running on the app's own thread were each to blame; now it costs about what it costs
  alone.

## 0.2.3 (alpha), 2026-11-06

**Update from 0.2.2 if you have it.** On a Mac Liner Code does it by itself (Restart to update), or
download the new DMG; on Windows, run the new setup. **A session header in the manner of Claude
Code**, and **a full audit** of the layout and the engine: about 200 fixes, most of all to what asks
before it writes, tried this time on the real Claude Code, Codex and OpenCode. **On OpenCode, access
levels now hold**, and its subagents are off for now (below).

### Changed

- **The session's header follows Claude Code:** the title, grey with a chevron, opens the session's
  menu: Rename, Pin, where it works and the branch. The Reviewer's word is quiet text with a ticked
  circle. On the right are Run, then Session, Terminal, Changes (with its count on the icon's
  corner), Browser, Files and a ··· for the other panels, your apps and hiding the panel. Each opens
  its tab, and pressing it again closes the panel. The icons are redrawn to be sharp at 2x. In a
  narrow window they step into the ··· one by one, and the title cuts short rather than running
  under them.
- **A surface's key hides it too:** ⌘⇧ and its letter shows a surface, and on the one showing it closes
  the panel, as its icon does.
- **OpenCode always asks Liner Code now,** and your access level decides. In your `opencode.json`,
  allows give way to the level and denies stay denies, at every level; an agent's own `permission`
  there still goes around it. Saying no lets it carry on and adapt, and a turn stops after 10 refused
  steps, so a model that won't take no can't go on for good.
- **OpenCode's subagents are off for now:** its ACP drops their approvals, so one would wait for good.
  `/review` runs in the session instead, and any other command that runs a subagent stops and says
  why.

### Fixed

- **OpenCode's access levels didn't hold:** Ask first ran writes, edits and commands with no card;
  Read only stopped edits but not a command that writes; a link out of the project read and wrote
  there unasked. Each level now does what it says, also when you change it mid-session. A harmless
  command like `ls` or `git status` goes without a card, a connection's tool can be allowed by name,
  and reading a file you attached doesn't ask.
- In Full access, a step your own Claude settings, or a hook of yours, said to ask about went ahead.
  It now comes to you, in every mode, with no "Don't ask again". A compound command that holds such
  a step does too.
- **On Windows with OpenCode,** a Git Bash path, a network path or a quoted path with spaces could
  read outside the project unasked, and `.ENV` wasn't a secret. They now count for what they are.
- "Don't ask again" on `cmd`, `powershell` or a path to one allowed whatever came next. Shells get
  no such rule now, `git.exe status` counts as `git status`, and `git.exe reset --hard` as high risk.
  For an interpreter the rule covers that exact command: `python x.py` no longer allows `python -c`.
- Stop left a Codex command you had approved running. It now ends that one and leaves a server from
  an earlier turn alone.
- A Codex planner's question never reached you: Codex said it wasn't available. It now comes as the
  question card.
- A Claude session on a second account didn't see the files it had read when it picked up again.
- The first start still made room for the logo that's gone: the name sat off centre, then slid over.
  It now stays in one place from the start screen until it docks in the corner, and Setup's top row
  sits level with the traffic lights, its steps on the window's centre.
- A panel's "no network" wasn't quite true: over WebRTC, a page could still send to a server of its
  choosing, so one that reads your files could have leaked them. Panels now have no WebRTC at all,
  from any frame they make, and one that may reach a host reaches only that. Anything that stays on
  https still works, and the Browser surface keeps its WebRTC.
- A panel whose process ended left a grey frame and no word of why. Its tab now says so with Retry,
  and the Add-ons page shows it with a Problem tag, the reason and Retry, as DeepSeek Harness's
  Plugins page does. Retry there takes you to where it runs, and the tag stays until it's back.
- A planner, a side chat or a Read only session could run a write command when the Reviewer allowed
  it, or on an earlier "don't ask again". A command or edit that writes now always comes to you in
  those turns.
- An ACP agent's edit went ahead in Edits, Auto and Reviewer decides wherever it pointed. One outside
  the project, or one that names no file, now asks each time. Agents that don't name their files will
  ask more often.
- A link in the project that points outside it let an ACP agent read and write there. Links are now
  followed before the check, and a file whose name starts with two dots is no longer refused.
- Ask first and Reviewer decides on an older Codex, without its app server, edited without asking.
  They now only read there, and say so.
- With Carry on set, two tools out of usage handed a session back and forth without end. It now makes
  one hop and stops on the limit card.
- A message that couldn't start was lost, with only a toast to say so. It now waits in the queue,
  and the timeline says why.
- Handing a session to another tool dropped the whole conversation when your newest message was very
  long. That message is now cut, and the work before it goes over.
- A comment on a diff line lost its file and line when it waited in the queue or went as a steer.
- Answering a question twice sent the answer twice.
- Quitting with a question open expired it. It now stays, and your answer carries on after the restart.
- A save that failed as a turn ended, on a full disk, left the session running until the next start.
- Stop did nothing while a new worktree was set up, and the message started anyway. It now waits in
  the queue.
- An ACP agent that ignored being stopped went on working. After 15 seconds it's now ended.
- "Don't ask again" on an ACP tool of no known kind allowed every other such tool. It can't be
  chosen for those now.
- In Ask first, an ACP agent that wrote files through Liner Code without asking wasn't stopped. That
  write now asks, unless you just allowed that file.
- A Codex request for more access could show an empty card, and Allow granted it unseen. The card now
  lists the paths, including globs.
- With `log.showSignature` on, a signed commit dropped a file from its turn's diff and undo.
- In the composer, the text you typed slowly slid away from what the field really held: the caret sat
  in empty space past the last letter, the blanks could be selected, and spellcheck's underlines
  landed on the wrong words. The two now line up to the pixel.
- An ACP agent's form now comes as the question card. OpenCode doesn't send them yet, so its own
  question tool stays off.
- In Auto, a Codex edit outside the project, or one asking for a folder outside it, went ahead without
  asking. It now asks each time, as ACP agents do, except in the temporary folders its sandbox allows. A Codex request to reach a host, or for more
  access, showed little or nothing of what it asked; both now say so and come to you.
- "Don't ask again" for a harmless `rm` also allowed `rm -rf`, and on `git -C x status` it allowed any
  git command written that way. What can't be undone now always asks.
- `git -C folder reset --hard` and the like passed as safe, in Full access's guard too, and so did
  `git -c alias.x='!rm -rf ~' x`, `git --no-advice reset --hard`, `npm --prefix app publish` and
  `cargo +nightly publish`.
  `git clean --force`, `git reset x --hard` and publishing with other package tools weren't high risk.
- Programs named like a reader (`tree-sitter`, say) counted as read-only and ran without asking.
- A routine could push with `git -C …` or `docker push`, or with a rule you gave in its session.
- In Reviewer decides, a step could go ahead on the Reviewer's word after you pressed Stop. A Reviewer
  that answered "blocked" or "needs changes" counted as a pass, and a fail with no blocking finding
  told the coder nothing.
- Read only could put an ACP agent in its "don't ask" mode, because the name has "ask" in it. It now
  also reaches agents that offer their mode as a setting, and a failed switch is tried again and said.
- A crafted link could run script on a session's local preview. An endpoint that quoted your key in
  an error could pass it to an app, and keys and home folders in a tool's error output reached the
  timeline.
- With a large paste the Terminal froze for good. It now goes in as the shell takes it. One that
  couldn't start showed an empty pane; it now says why, or that the session's folder has gone.
- When Claude Code carried on by itself, its first request could be refused before you saw it. It
  now waits and shows on that turn. If its process died first, the turn hung; it now ends.
- After Claude Code died while idle, your next message could be lost and the turn hang. One that never
  answered on reopening hung too, and now ends after 90 seconds and says so.
- A connection slow to start could hold a session for good, or leave a turn without its tools unsaid.
  It now goes on and says so.
- Changing the effort on Claude Code no longer restarts it, so a dev server or background agent keeps
  running. A model or mode a tool refused failed your turn; the session now reopens and goes on.
- After a crash, the first thing written to a session could be lost along with the cut-off line before
  it. An answer that went on after a retry notice lost everything past the notice once the app restarted.
- A turn cut off by a crash or quit had no diff and no undo. It now gets its checkpoint at the next start.
- A message or a steer sent right after Stop waited in the queue, or was lost. It now goes as soon as
  the stop has settled, and skipping a question or turning a plan down no longer leaves the queue waiting.
- A `/goal` or `/reviewer` sent while a turn ran reached the agent as words. It now runs when the turn
  ends. `/compact` after a switch or a rewind went to the model as words too.
- Stopping a session just as another tool took over left that tool with no conversation, and a handoff
  kept only the first line of older multi-line messages.
- A session left limited for days started by itself when you reopened the app. Past a day it now waits
  for you. A limit first reported with no reset time now takes one a later report gives, and a gateway's
  rate limit counts as a limit.
- A request that arrived after its turn ended left the session in Needs you, and a stopped Codex turn
  could still ask you something in the next one.
- Stop now reaches Codex's subagents, its running commands and a compaction, and ends tests and agents
  that ignore being asked. A Codex subagent that finished after the turn ended went unread; the parent
  now carries on with what it found.
- A session whose folder was gone hung on ACP agents and Codex. It now fails and says which folder.
- A tool that crashed while something it started held its pipes left the turn running.
- After a compaction, the next Codex message could end as soon as it began, and Claude Code's context
  meter jumped back to the old size.
- A Codex conversation open in another client was quietly restarted. It now says it's in use.
- Rules saved when CLAUDE.md and AGENTS.md were linked replaced them with one line, and wrote through a
  link to a file elsewhere. Your text now stays, and that file isn't touched.
- A file made in one turn and deleted in a later one stopped Commit for everything else.
- A compared model that couldn't start lost your message, and Keep could bring in only part of a very
  large change. In Compare, each column now scrolls inside itself and says when a model hit its limit.
- GitHub routines never fired: their check failed quietly every time. With two audit steps a later
  pass undid an earlier fail, a gate's `*.lock` rule matched nothing, and a work step cut off by a limit
  counted as done, so its pass actions ran.
- A session snoozed until a reply or checks stayed asleep for a month if its pull request closed or
  merged, and a reply that came while Liner Code was shut didn't wake it.
- A card for an app being made could stay on "making" for good. It now finishes after a restart, or
  says why it didn't.
- An update download that hit a full disk or a dead connection stayed on Downloading for good.
- An add-on that asks you to choose or confirm now shows a card. A picture with the wrong extension no
  longer breaks every later turn, and reading a file you attached no longer asks.
- If the window's page crashed it stayed blank. It now loads again by itself. A crash while saving a key
  could lose all your saved keys. On Windows, a folder with `&` in its name broke Open in Terminal.
- In an answer, a number in square brackets vanished, so `items[0]` read `items`. A fast reply could
  stall and then arrive in a lump.
- Going back to a long session could land you somewhere other than where you left it.
- Files you'd attached but not sent were lost when you moved to another session. What you were writing
  in a side chat now survives moving away too. Attaching more than ten files says some were left out.
- Escape while composing with an input method stopped the running turn, and Enter or Tab picked from an
  open list or sent early. Those keys now go to the input method.
- After pressing Send or Stop, your typing went nowhere. Editing a recalled message and pressing ↑ lost
  your edit, and text dragged into the composer was dropped.
- Find now keeps up with a reply as it streams, stays on your match and gives the keyboard back. It sat
  too low, and opened where you couldn't see it.
- A question with no choices sent an empty answer. Dropping every step of a plan no longer leaves you
  stuck, and a message edited from an earlier turn that couldn't send goes back to the composer.
- Review said nothing changed when it couldn't read the changes, kept the old position when you switched
  turns, hid notes on folded lines and showed a binary file as garbled text. It now marks moved files.
- Two very large files rewritten line by line could stall the window. They now read as one out, one in.
- A dev server you start in the Terminal now opens in the Browser without waiting for a turn to end.
  Reload did nothing on the "Nothing answers on localhost" page, and a local address with a query or
  hash opened in your browser. A dev server dying mid-page hung it.
- After a pull request was closed on GitHub, you couldn't open another from that branch. One failed look
  at GitHub could take the card down mid-step, or say the project had no remote. A check that failed
  showed green, and the card named main whatever the base branch.
- A commit stopped by a hook said "The push didn't go through", and the chip vanished when you left.
- Remove was already armed when you reopened an add-on's menu, one click from removing it.
- Going back right after an edit in the routine builder lost that edit, and a step added on a gate's
  path disappeared the next time you opened the routine.
- Opening a session from ⌘K while Settings was open did nothing you could see. Archiving the open
  session from the sidebar left it on screen.
- A budget typed with a decimal comma was read a hundred times too high. Clearing Where worktrees live
  didn't take, and clicking away from a project's rules lost what you wrote.
- A pin, rename or stop the engine turned down now says so, and errors while it's away read in words.
- After the engine restarted mid-reply, a session could show text twice.
- Arrow keys now move through the panel, snooze and mode menus. On a session with forks, Pin and Snooze
  were covered by the forks button.
- With many tabs open, the panel's names shrank to single letters and the open tab was cut off. They now
  go down to icons together, and the open one stays in view.
- Long paths, branch names and unbroken strings no longer push Settings, the timeline or the panels
  sideways, and a long project name on Home keeps its question mark.
- A message sent while a rewind or undo was putting files back started a turn underneath it, and one
  sent to a session being deleted could outlive it. It now waits, or goes with the deleted session.
- Going back or undoing in a session whose worktree was cleaned up failed, and so did a session carrying
  on after a restart or a usage limit. The worktree now comes back first.
- Going back silently dropped messages Stop had kept in the queue, and a side chat could answer from
  turns that no longer exist. The messages stay, and the side chat starts fresh.
- A side chat or a `/goal` in a new worktree started before its setup had finished. They now wait, as a
  message does.
- A fork whose files couldn't be copied left an empty session in the sidebar. It's now removed.
- Files attached before a restart asked for approval when read again on Claude Code. They no longer do.
- Text before and after a plan ran together in one paragraph on some agents.
- Back and Forward did nothing on the Browser's "nothing answers here" and "file not found" pages.
- All turns and This branch now say how many files past the first 60 aren't shown, in the side
  Changes panel too.
- A command that ended without reading what it was given could take the engine down.
- An add-on's form in a routine could hold the run for good, on Claude Code and ACP agents. With
  nobody there to answer, it's declined.
- A queued `/compact` was joined to the next message and did neither. It now goes on its own.
- Liner Code's own tools went without a card only by name: one from an agent's or a project's config that
  called itself `liner` ran unasked, and an add-on with that id took its place on Codex. On OpenCode
  any server named `liner_…` passed as ours. Only Liner Code's own server does now.

## 0.2.2 (alpha), 2026-11-05

**Update from 0.2.1 if you have it.** On a Mac Liner Code does it by itself (Restart to update), or
download the new DMG. **On Windows, Liner Code now installs:** run the new setup. **A cleaner
window**, after TasteCode v0.5, in Liner 2.0's own look, and **a new icon** that turns dark with your
Mac.

### New

- **A Windows installer:** `Liner-Code-0.2.2-win-x64-setup.exe` installs Liner Code for you alone,
  with no administrator, in your own folder. It's in the Start menu with the new apps, and Settings ›
  Apps removes it again, leaving your sessions and settings. Running the next setup puts the new
  version in place of the old one, asking to quit Liner Code first. The zip stays, to run it without
  installing. Neither is signed yet, so SmartScreen asks the first time (More info › Run anyway).
- **A new icon:** two turns that share one centre, the outer in ink and the inner in Liner blue.
  On macOS 26 and later it follows the system's light or dark look by itself, in the Dock, the
  Finder and Launchpad; on earlier systems the Dock icon follows it while Liner Code runs. The
  site's favicon and the README follow your theme too.
- **A bottom panel:** the session's shells and script runs open under the thread and its composer,
  with the shells as the panel's own tabs, a + for another, the open shell's folder and tools, and
  a button to put it away. Terminal comes up there from its key (which also puts it away), ⌘K or a
  script.
- **Open beside:** right-click a session and Open beside puts it next to the one on screen, each
  with its own header, composer and panels. Keys go to the side you're in; × closes a side.
- **Needs you:** sessions waiting on you have a section at the top of the sidebar, with their
  project at the end of the row, while there are any; pinned ones too, as the Dock's badge counts
  them.
- **Plan limits at a glance:** the ring at the sidebar's foot shows your busiest plan window and
  opens every tool's windows with when each resets, and Usage and cost. In a session, the context
  ring's pop holds the plan's windows too.
- **Agents at work stay in sight:** while a model's subagents run, each has a line under its folded
  row, with what it's doing and for how long.
- **Settle a whole project:** point at a project's header and press its settle button, or right-click
  it, and its finished sessions go to Settled at once, with one Undo. Sessions still at work or
  waiting on you stay; the project comes back to the list with its next session. In Settled, sessions sit under their
  project's header, folded, and the header's ↶ brings the whole project back.
- **An update waits in the sidebar:** a Liner Code that's ready or downloading shows on a card over
  the foot, with Restart and how many sessions are working, and × to put it away until the next
  one. With the sidebar hidden, Home says so instead.

### Changed

- **The session's header is one quiet row:** the title with its ··· menu (rename, pin, where it
  works, your editor, scripts, the branch and committing), the branch, the Reviewer's verdict,
  Changes, Run, and two buttons for the bottom and right panels. Side chat, Browser, Files, Design,
  Pull request and the rest open from the right panel's + and their keys (⌘⇧ and a letter).
- **The right panel's tabs are its header:** every tab keeps its name, the + holds the guide, and
  the arrows give a tab the whole window. Apps you pin (right-click their tab) keep an icon at the
  start of the strip. The second pane and its Split button are gone: a panel split in two in 0.2.1
  opens as one, with all its tabs.
- **The sidebar is lighter:** New session, with search at its end, Routines and Add-ons as rows on
  top; your app pages under Apps; then Needs you, Pinned and Projects, with Filter and Add a project
  beside the Projects label. A session takes one line: its maker's mark, its title, and a mark while
  it works or waits, or how long ago; the rest is in the card that comes as you rest on it.
  Snoozed and Settled are one quiet row; the foot is you, the team, your plans' limits and Settings.
- **The chat lines up with the composer:** the text starts where the composer's does, folded rows
  end in a small triangle, and a turn's changes read "2 files changed +3 −1 · View changes".
- **Diff is called Changes** everywhere: its tab, its key's name and ⌘K.
- **Project badges are flat:** one colour of their own each, without the gradient and shine.
- **Add-ons in the sidebar opens its page** straight away; Make one with an agent is that page's
  button.

## 0.2.1 (alpha), 2026-11-04

**Update from 0.2.0 if you have it.** On a Mac Liner Code does it by itself (Restart to update), or
download the new DMG; on Windows, download the new zip.

### New

- **Liner 2.0:** what agents make for Liner Code is drawn in its own look. Every add-on is made
  with a design skill of Liner Code's surfaces, buttons, rows and type, and gets the app's colours
  to draw with, so a panel or a page reads as part of the app.
- **A model in an app:** an add-on can ask a model and get the answer back as it's written. The
  first ask opens Liner Code's own popup, where you pick one of your models and allow it; the app
  keeps it and shows it on its strip, where a click changes it. It's only a model, with no tools,
  files or agent: an API endpoint's, or Claude Code's with its tools, settings and servers off.
  Each app gets two answers at a time and 300 a day, and its usage is logged under it.
- Each mode leads with its icon in the picker, on Home's strip and in the chip beside a session's
  title: Standard's sparkle, Workshop's blocks, and your own modes with their agent's glyph.

### Changed

- **Creator mode is now Workshop**, in name only: your sessions and settings carry over.
- **Workshop only when you ask for it:** it starts from Create your add-on, from "Make it an app",
  or when you pick it under the box. Everything else starts in your default mode.
- **Models come from one tier list** built on Artificial Analysis (Terminal-Bench 4.0, FrontierCode
  v1.1, cost per task) instead of a maker-by-maker order. Opus and GPT Astra plan and take the hard
  jobs; DeepSeek V4.1 Flash builds wherever it's ready, then Sol, then Sonnet. A model never builds
  for itself: when Sol is your best, Sol plans and Terra builds. Critics come from different makers.
- **OpenCode Go's quota lasts longer:** its frontier-class models have a small monthly cap, so none
  of them plans, takes hard jobs or builds in Dual. DeepSeek V4.1 Flash does it all, the newest GLM
  Flash judges, and MiMo V2.6 Pro and the newest GLM critique. Capped models still read.

### Fixed

- Home's strip no longer runs past the box. It holds where the task runs and the branch on the
  left and the mode at the right, each cut short with an ellipsis; Scratch folder, Carry on a
  session and the keys move to a quiet line under it.

## 0.2.0 (alpha), 2026-11-03

**Update from 0.1.9 if you have it.** On a Mac Liner Code does it by itself (Restart to update), or
download the new DMG; on Windows, download the new zip. **New: add-ons**, things your agents make
for Liner Code itself, and **Workshop** to make them.

### New

- **Add-ons:** ask an agent for a connection, a panel or an app, and it makes one for Liner Code.
  A card shows what it can touch before it's added, and nothing is added until you say yes.
- **Connections:** an MCP server from a prompt. The agent drafts it, you add it on the card with
  its key, which goes to the keychain, and every agent gets it next to Liner Code's own tools.
- **Panels and apps:** the agent's own page, run in a sealed frame that reaches Liner Code only
  through what its card allowed: your files, your sessions, the composer, its own storage, or an
  address on the internet, which you hold to allow. One opens in the right dock, as a tab beside
  Chat, or as a page of its own from the left sidebar.
- **Create your add-on:** Add-ons in the sidebar opens a menu with Browse add-ons and Create your
  add-on, which starts a task in Workshop with "Create a Liner Code add-on with a left sidebar
  entry." in the box. Say what it should be, like a notes app for long writing, and the agent
  builds the full app on a page of its own, not a demo.
- **Make it an app:** at the end of a turn an agent can offer to turn what it did into an app.
  Pick where it goes and Create: it's made in the background and added if it touches no more than
  the card said. Then Keep or Undo, and Restore.
- **Workshop:** each session now has a mode, picked under the box on Home and kept for the session:
  Standard, Workshop, or one of your own. Workshop is Standard plus a guide to add-ons and a closer
  look at Liner Code, never more trust. A Workshop session shows a chip beside its title, and the
  agent can save a mode of yours on a card.
- **Settings › Modes:** the built-in modes and yours as cards, each with its details, how to use
  it with example tasks, Set as new task default, and Let the agent help me make one.
- **The Add-ons page:** what you've added, each with one sentence and a switch. A row opens its
  details: where it shows, what it can touch, its version and the way back, who made it, and
  Remove, which keeps its files. **Add add-on** adds one from GitHub or a folder, through the same
  card. Settings › Add-ons keeps the detailed view.
- Every version of an add-on is kept. An update that touches no more than before goes in without
  asking; one that touches more asks again.

### Changed

- **One row at the top right** of a session takes the place of the floating tray and the panel's
  bottom row: Changes, the surfaces (Browser, Design, Terminal and the rest, with their ⌘⇧ keys),
  pinned apps, a ⋯ menu and the dock button.
- **The right panel is a dock** of one or two panes, with tabs you can move, a + tab that lists
  what can open there, and a full-canvas switch. Each session keeps its own.
- Home's heading is "What should we build in …?" again; the mode picker sits under the box.
- Settings › Appearance › Glass keeps only the composer: the tray it also styled is gone.

### Fixed

- A writing command could pass as a read in approvals through quoting, comments, `bash -c` or zsh
  expansions. A "don't ask again" rule covered env prefixes and `./git`; split or long `rm` flags
  weren't counted as destructive; Auto waved through MCP tools named like edits.
- A routine's work step on a busy session let the gate and merge run anyway. A failed first poll,
  or older pull requests coming into the window, fired runs; a bad schedule time wasn't caught; a
  run's token limit wasn't kept, and a run that threw wasn't counted or cleaned up.
- An old unanswered question held every later turn in Needs you. Messages queued during a /goal
  waited for its end instead of going between its turns. Deleted and archived sessions were mixed
  up, and streamed text showed twice after a reload.
- The window could leave the app's own address, and embeds opened elsewhere instead of in place.
  A key saved after launch didn't reach a restarted engine, a capture window could hang, and
  Windows consoles closed too soon.
- ⌘1–⌘9 fired from inside pickers, and Enter in an input method sent early. Archive's Delete
  didn't ask twice. A docked panel hid a narrow session, and in dark mode find, gutters and theme
  chips were hard to read.

## 0.1.9 (alpha), 2026-11-02

**Update from 0.1.8 if you have it.** Liner Code does it by itself (Restart to update), or
download the new DMG. **New: Liner Code for Windows**, as a zip.

### New

- **Liner Code for Windows** (x64, alpha): download `Liner-Code-0.1.9-win-x64.zip`, unzip it
  anywhere and open `Liner Code.exe`. It isn't signed yet, so SmartScreen asks the first time
  (More info › Run anyway). It drives the Claude Code, Codex and OpenCode you installed with npm,
  as on a Mac; Sign in and Install open a console. It puts itself in the Start menu, so its
  notifications show. The Terminal is PowerShell, without full-screen programs for now, and the
  app doesn't update itself yet: download the next zip.
- On Windows the words follow: this PC, File Explorer, Ctrl in every shortcut, and keys sealed by
  Windows rather than a keychain.
- **Designs, with every agent.** Ask Claude Code, Codex, OpenCode, Hermes or any ACP agent for a
  screen, a page or a prototype, and it draws it in the new **Design** surface beside the session
  (⌘⇧E): one HTML file in `.liner/designs/`, written and edited with the agent's own tools, then
  shown with Liner Code's `design_show`. Each time it's shown it's kept as a version.
- **The surface:** Desktop, Tablet and Phone frames fitted to the panel (or at 100%), Live or any
  version, its code, light or dark. Each edit the agent makes draws as it lands, the next drawing
  loading behind the one you see. Bring back an old version, open it in your browser, copy its
  HTML, or show its file.
- **Comment on a part:** pick any element of the design and say what should change; the agent
  gets the element and your words, edits the file and shows the next version.
- **Build it** asks the agent to make the design for real with the project's own components. The
  surface remembers which version you had built and says when the design has changed since.
- **The agent sees what it drew:** `design_show` answers with a picture of the design at its size
  and full height, and its console errors.
- Each version has a card on the timeline with a picture of it. A page shown in the chat can be
  opened as a design. A lead draws a design itself, and plans its build when you ask.
- The Demo draws a tide screen, and a new version for each comment.
- **API endpoints** (Settings › Models): models from DeepSeek, Kimi, GLM, OpenRouter, LM Studio,
  Ollama or any Anthropic- or OpenAI-compatible API, run through the tool that speaks it:
  Claude Code for Anthropic's Messages, Codex for OpenAI's Responses, OpenCode for Chat
  Completions. Each is a tool of its own in the model picker, with that tool's files, commands
  and approvals, and Liner Code's Browser and designs. **Find its models** asks the endpoint for
  its list. Keys go to the keychain, and only to that tool's process.
- **Pick a service** and its address and protocol fill in: Anthropic, DeepSeek, Kimi, GLM,
  MiniMax, OpenAI, xAI, OpenRouter, Gemini, Qwen, Groq, Mistral, Together, Fireworks,
  SiliconFlow, NVIDIA NIM, Ollama Cloud, and LM Studio, Ollama, LiteLLM or vLLM on this Mac, with
  a link to get each one's key. Any other service works by its address and protocol.

### Changed

- `.liner/` is left out of every turn's snapshot and goes in the repository's `info/exclude` with
  the first design, so designs never show as changes to review or commit.
- Codex through `codex exec` (an older Codex) gets Liner Code's tools too: the Browser, pages and
  designs.
- Liner Code's tools in an ACP agent (OpenCode's `liner_design_show`) show by their own names and
  titles, as they do in Claude Code and Codex.
- An agent is told Liner Code's tools by the names its tool offers them (`mcp__liner__design_show`
  in Claude Code, `liner_design_show` in OpenCode): a smaller model through an API endpoint
  called the plain name it was told, which Claude Code doesn't have.

### Fixed

- **Install** in Setup and Settings ran its note as part of the command (`npm install -g
  @openai/codex, then codex login`), so it tried to install packages called "then" and "login".
- Committing with every file unticked (⌘↩ in the message) committed all of them, and pushed too
  with Commit and push on; pressing it twice made two commits.
- Stop on the pull request card stopped nothing: the title was still written and the branch
  pushed. "Open it as a draft" with no title or body of your own opened it ready for review.
- A link in `.liner/designs/` to a file outside the folder let a design be written there; and
  bringing back a version of a design kept outside `.liner/designs/` failed.
- An agent tool that died or went quiet while starting (an ACP agent, the Codex app server) left
  the turn waiting for good, Stop included. Stop while a session couldn't be picked up again
  lost its conversation for the turns after.
- Read only, and back, now reaches OpenCode's own mode: it stayed in plan, or could still edit.
- A Codex app server that never started made usage limits wait for the rest of the run; one that
  died as a session opened showed its error twice.
- Forking while the Reviewer read a turn dropped that turn from the fork. Compared sessions
  started before their worktree's setup command finished. Edit from here kept the refiner's
  conversation with the turns taken back.
- Editing the queue after Stop sent it at once, though Stop keeps the queue for you.
- A question card with no questions broke the turn, with no Skip. A turn carried on by a second
  model pointed each part's diff at the first part's.
- The model picker's Enter picked the highlighted model even on a star or a source; a selection
  dragged out of an agent's dialog closed it and lost your edits; Run the setup again set you
  back to Solo.
- Appearance's Restore defaults kept your own theme and picture. The Terminal kept old colours
  after a theme of your own. Find counted, and jumped to, text in folded steps.
- The Browser showed the last server's page under a new address while it switched, and an
  agent's screenshot of a Browser tab you weren't on caught what covered it.
- A routine step edited just before Turn on could switch it off again with a late save.

## 0.1.8 (alpha), 2026-10-31

**Update from 0.1.7 if you have it.** Liner Code does it by itself (Restart to update), or
download the new DMG.

### Changed

- **The session's tray matches Home:** who works on it, the effort, the context and the access sit
  in one light bar, each drawn small beside its word, with attach as a light round.
- A narrow tray gives way in steps instead of overlapping: the queue-or-steer note shortens, then
  keeps only its key; access, effort and who keep only their icons; last, the row wraps.
- A working turn's head no longer has a progress bar under it.

### Fixed

- A lead's plan card lands where its "Generating the plan" line was, without the thread jumping,
  and what the lead says after the plan reads below the card instead of moving above it.

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
