## Next (not released)

Notes for the next release are collected here, then moved into `CHANGELOG.md` when it ships
(the website is built from `CHANGELOG.md`).

### Added

- **Pull requests and Issues pages,** from the sidebar's foot or ⌘K: every open pull request in your
  projects in Needs your review, Yours and Others, and the issues from GitHub and Linear in Assigned to
  you and Everyone else. Pick one to read it beside the list, open a session on it, or merge it after
  a confirm. Once you've opened Pull requests, a dot on its icon says when one waits on your review.
- **Scan a pull request or an issue** with Liner Security from its row: a read-only scan on your own
  tool, with a second look by another maker's model. A GitHub issue's check says whether what it describes
  is real in the code, where and how bad. Comment posts the summary on GitHub after a second press,
  and Fix them starts a session in a worktree of its own. **Scan new pull requests** (off until you
  turn it on) scans one as it opens or gets new commits: one at a time, never a draft, at most ten a
  day, while Liner Code is open.
- **Settings › Source control & issues:** each tool that knows your code on this Mac (git, gh, glab,
  az, fj or tea, Cursor's origin) and whether it's signed in, a Linear key for its issues, the default
  merge method, how commit messages are written, and, if you turn it on, pull requests that follow
  the repository's template.
- **Liner MCP:** apps outside Liner Code (Claude Code or Codex in a terminal, Claude, ChatGPT, Grok
  Bot, Muse) can read your sessions, pull requests, issues and findings, and start, message, scan and
  stop, each at the level you give it: Read only, Asks first (you allow each start, message, answer,
  scan or stop on a card) or Trusted (never Full access). An app gets a key shown once, or signs in
  itself after you start it from Add an app and allow it on a card, and can be revoked in one press;
  a terminal agent you revoke is turned away by name until you let it in again. From the internet is off until you
  pick Tailscale Funnel, a Cloudflare quick tunnel or an address of your own.
- **Tell an app:** an https webhook of yours hears when a session needs you, with its title and
  nothing else, so an app on your phone can say so. It never goes to this computer or a private network.
- **Tunnel checks** under Settings › Liner MCP › From the internet: each step of bringing a tunnel up,
  passed, failed or at work, with the step it's on while it starts and Stop when one takes too long. A
  step that fails says why and the way out (Tailscale's page, a command, Try again). Once up, Liner checks
  that the address really reaches this computer, then every 5 minutes, and says when an app last
  called in, or that it still has a quick tunnel's old address. Copy details puts it all in words.

### Changed

- The dots in Home's top right corner drift: their edge moves like a cloud, a slow swell runs out from
  the corner, and they swell a little round the pointer. The GPU draws it, 20 frames a second, none
  while the window isn't the one in use, and Reduce motion holds it still.
- Settings opens as a pop-up over the window, with its places regrouped: General (Notifications are
  in it now), Appearance and Keyboard; Agent tools, Agents and modes, Fusion and review and
  Permissions; Projects, Source control & issues and Worktrees; Liner MCP and Add-ons; then Archive
  and About and updates. A link to an old place opens the new one.
- The model picker draws each model's and tool's logo in its maker's colour, and the Effort pill fills in that colour
  with a halftone of dots that grow toward the high end. The Effort head is one line, the card beside the list follows
  the row you point at (at the list's top, or its foot for a row in its lower half), and a hover plate slides from row
  to row.
- Your agents moved from the picker's foot to its rail of tools, so the models have the list's whole height.
- A project's folder in the sidebar has a + beside its ··· that starts a new session in that project.
- The sidebar is narrower and quieter: Search, Hide and the arrows sit beside the lights, your places are short rows
  with your apps and Carry on under More, Sessions has a Filter, groups (Pinned too) fold under one small grey line,
  and every session is a two-line row with its state at the right and its live step, facts and time under it. The
  plan-limits ring left the foot (Usage and cost is in ⌘K).
- Liner's own mark inside the app (Workshop, the sample project, a pull request's draft, an agent with no logo) is the
  line comment, as the app icon and the website have it, not the two turns.
- What moves while something works is in colour: the working mark and running checks are a warm yellow everywhere, and
  there are fewer of them at once. The header's team and agents chips no longer carry their own working mark (the live
  line and the session's row already move for it).
- The app is calmer while it works. In a working session, only the live line and the session's row move. A step in
  progress in a list (the plan, agents, tasks) shows a still yellow ring, and a Code chat keeps no agents card at its end
  (the Agents panel lists them). The live line's clock counts whole seconds. New answers, cards and the panel fade in
  quickly without a blur, and Send no longer hops when you type. Nothing flows under a pull request or a push. Look
  again's arrow turns only when you press it, and lane bars and the Queued tag are grey, not the accent.
- In the sidebar, a session that is finished and read, or not started, shows no mark: its title has the room and the time
  says when. A session that works, needs you, finished while you were away, ran into a problem or has a pull request
  keeps its mark.
- Teamwork and a Swarm are no longer pinned over the chat or kept as a card at its end: their chip, and turning a team
  on, open the team in the Agents panel on the right. Liner Design's chat and a Liner Security scan, which have no
  Agents panel, keep the team's card.
- The sidebar is a little wider (240, Capy's default) so titles say more, and it reads the same in Code, Design and
  Security: every session or design is a one-line title with its state at the right end and the time on the second
  line, and each list's heading has the same Filter and ··· at its right end.

### Fixed

- A voucher's code no longer reaches the agent. OpenCode used to hold it in its environment, where a command the
  agent ran could print it; now OpenCode gets a key that works only on this Mac while Liner Code runs, and Liner
  Code adds the voucher as it sends each call on to linercode.dev.
- Promo in the model picker reads as Liner Code's own: DeepSeek's mark instead of OpenCode's, "Liner Code's promo,
  with your voucher", and Free within the voucher's 5-hour and weekly limits.
- A Teamwork or Swarm session whose team has finished no longer says "Working · 1 agent" in the sidebar and on The
  Wall for good: the count follows the team's agents as each starts and finishes, on every tool.
- In the dark look a card's main button (a plan's Approve and start, a question's Next, Try again) is a light pill
  again, not near-black on the near-black card.
- In Liner Security's Findings, a row's tick box no longer lies on the row: it stands in the margin clear of it, and
  with a finding open, where the margin is too narrow, it takes the severity square's place while you point at the
  row. A row you clicked no longer keeps its box showing after the pointer has left.
- A window from File › New Window works while another window has focus: its status, badge and buttons answer, it
  takes the window material and its own traffic lights, and Quit When They Finish hides it too.
- In Antigravity sessions the agent has every Liner tool again: Teamwork, Liner Design's frames and pictures, server
  start, add-on offers and Liner Security's findings had been left out because their descriptions ran over a kilobyte.
- Liner MCP through Tailscale Funnel no longer sits on Starting when Funnel isn't turned on for your tailnet: it says
  so at once, with Open Tailscale for the page that turns it on. A Tailscale command that hangs now ends when its time
  is up, also when `tailscale` is the Mac app's wrapper script.
- The Code, Design and Security menu at the sidebar's foot no longer scrolls sideways with a bar over its last row.
- A panel's heading (an agent's "Gemini 4 Neon, sent by Teamwork") no longer runs under Full canvas and Close in a
  narrow panel: its words end in "…" and say the rest when you point at them.
- Liner Code has a new look, "line and dot": the sidebar sits flush on a near-black ground and everything else is one
  sheet inset 8px with a 12px corner, every rule is half a pixel, and menus, cards and buttons share one set of corners.
- Every state mark is a small box of nine square pixels: Working lights three of them in yellow and travels round the
  box, Needs you and every warning light all nine in amber, a failure all nine in red, and something new to you is a
  blue cross.
- In a plan the step in work is a still ring with its middle lit: nothing in the plan moves.
- Buttons are 28px high with the row's corner, key hints are plain grey words, and switches are the small red ones.
- The message box is solid by default; glass stays in Appearance for anyone who picked it.
- Search and New session share one field at the top of the sidebar; The Wall says how many of its sessions are live,
  and Settled sits at the foot of the list with its count.
- A session's row says what it is doing in blue while it works and what it wants in amber, and on the right the tool
  that runs it, whether it runs on this Mac or in a worktree, and its pull request's number in green or purple.
- The traffic lights sit on the same line as the sidebar's top row and the sheet's top row.
- In the chat your message is a bubble on the right with a hairline edge, inline code is a small mono chip, and a file's
  name that opens in the app is a blue chip with the file icon.
- A finished stretch of work folds to one line with a hairline under it, "Worked for 1m 12s", and what was done as small
  tags at its end ("Read 6 files", "Edited 2").
- The files a turn changed are one card: the count, the lines and Review at its head, then a row a file with its letter,
  its folder in grey and five small bars.
- The Plan card is a bordered card with the halftone in its corner while a step is in work; hand-overs and switches to
  another tool are one centred grey line between two hairlines.
- An ask reads as a card with an amber edge and amber dots in its corner, Run it first, and "Say something else" at its
  end, at the message box and in the chat alike.
- Home asks "What are we making?" over a row of chips for the project, where it works and the branch, and Carry on is
  three cards under the box, with "All" for the whole list.
- Carry on can be switched off in Settings › Appearance ("Show Carry on on Home"), which takes its cards off Home and
  its rows out of the sidebar; it is on unless you turn it off.
- Settings is a smaller pop-up in the middle of the window: each page has its title and one line, and its settings are
  rows split by hairlines, with the app's version at the foot of the places.
- First-time setup is one page on the sheet: a row per agent tool with Ready, Sign in or Install, the projects to bring
  in as ticked rows, who works, and one button to start.
- The Wall's tiles are cards with the state's colour in dots in their corner, and the picked tile has a stronger ring.
- The message box is one rounded card with its controls in a row 28 high; Send is a square in the accent, and while a
  turn runs it is Stop, a white square on the same accent.
- With a sidekick on, the message box shows one chip, "Fusion", never two models.
- In the model picker, Fusion is a small card under the model's card, "Enable Fusion" with a switch; while it is on, the
  sidekick shows as one row there, which opens the lead, the sidekick and how the pair works.
- The Effort track is round, its accent fill breaking into light dots that end as a checkerboard at the round knob.
- Under a session's message box one grey line says where it runs, how many agents are at work, and how full the
  context is.
- The permissions menu shows each level with a small icon, and Search and commands (⌘K) is the app's menu shape with
  no blur.
- A session's top row shows its project's tile and name, a slash and its title, and ends in three toggles: session
  details, the terminal and the panel.
- The right panel names its open surfaces as tabs in its own head row, with + listing every surface and its key, the
  shells and New terminal; it opens 500 wide.
- Session details is a card under the top row's right end: where it runs, your editor, scripts, branch, Commit,
  Changes, Context and Fusion; the chat keeps clear of it, and it stays shown or hidden across sessions and restarts.
- Session details is the one place for a session: the card shows with the panel open too, and adds the pull request, a
  Compact button and a bar of dots on its Context row (pressed, it unfolds what fills the context), and a Setup menu with
  the tool preset, connections, spend limit, memory and keep awake. The panel no longer has a Session tab.
- Changes shows one column or side by side as a switch on its bar, with Wrap beside it, and its lines at 12px with a
  thin bar at the edge of each added or removed line.
- While a session works with agents (Fusion, its tool's subagents, a Swarm or Teamwork), Session details shows them as a
  small tree with each one's state, folding, and a way into the Agents panel; a session that works alone shows none.
- What is ready to commit is a tab on the message box's top edge, with the commit's first line beside it when one is
  already written.
- New design and Start a scan sit in the sidebar's search field, as New session does.
- The Agents surface no longer shows cost or cache rows.
- An ask's card has no state mark in its head.
- Words are set in the Mac's own face (SF Pro, with Inter where there is none) and code in its own mono, in three weights
  only; in the light look the sidebar and the sheet are nearly one tone, cards and menus are white, and the inks are softer.
- The session details card is flat: its own fill and a thin edge, with no shadow under it.
- Menus, pop-ups, ⌘K and the session details card are leaner: smaller corners, a lighter shadow, regular words and
  lighter grey icons.
- The panel's + lists the surfaces that hold something for this session and the ones you have open; the rest are under
  More, with your apps. New side chat and New terminal have rows of their own, and Show the terminal is the top row's toggle.
- Menus, side menus and right-click menus grow out of the button or point that opened them and close with a short fade
  instead of vanishing; dialogs and Settings fade in and out with their dimmed backdrop, and give the keyboard back to
  what had it.
- Icon buttons show Liner Code's own tip, with the button's key in grey, after half a second and then at once as you move
  along a row; hover cards come sooner and linger a moment before they fade, and folds such as "Worked for" open quicker
  with their steps fading in.
- With Motion set to Full the sidebar and panel open in 300ms and shut in 240ms, and with Reduce motion on, pop-ups,
  menus, tips and dialogs still fade in and out briefly while nothing slides or grows.
- Files stays light on a project with a folder of thousands of new files (video frames, an export): the tree puts a
  folder's files on the page only once you open it, so the panel opens without a stutter and the window no longer runs
  hot while Files is up. Files and @ mentions also list the project's own files before new ones, so such a folder can't
  crowd the project out of the tree.
- The right panel opened with nothing in it shows a start page rather than opening Changes by itself: Changes, Files,
  the Browser, a side chat and a terminal with what each holds now, what this session has, and your apps.
- Turning Liner MCP off while Tailscale Funnel is still starting takes Funnel down once it comes up, instead of leaving
  your address public on port 443.
- A Liner Security scan card left open no longer turns off ⌘N, ⌘B, ⌘1 to 9 and the app's other shortcuts.
- With Settings open over Liner Design or the Wall, Esc closes Settings, and Delete, the tool letters and the number keys
  no longer reach the layers or sessions under it.
- Selecting a text layer in a project whose DESIGN.md names fonts without sizes no longer breaks the inspector.
- In a project where one OpenCode session uses an add-on, another session there with that add-on switched off (or a Lean
  or sealed one) can't call its tools, and the add-on leaves OpenCode when the last session using it closes.
- Switching an OpenCode session back to Default puts it on OpenCode's default model rather than the one it was on.
- Fix them on a scan that covers several findings moves every one of them along (working, ready, fixed once merged), not
  only the first, and pressing it again after a rescan briefs a new session with only what nothing is fixing yet.
- Liner Security's free checks in a folder that isn't a git repository no longer say a .env file is tracked in git.
- A long Swarm board post still notifies the members named at its end, and says it was clipped; a model swap on a team
  that has finished says it takes effect when the team runs again instead of "Waking".
- A queued message on a worktree session that waited out a usage limit brings the worktree back before it runs.
- A second Claude Code account's session offers Compact in Session details, as the first account's does.
- A broken liner-code:// link is ignored instead of showing an error from the app, and on Windows no longer stops
  Liner Code starting when it opens from one.
- The Files tree keeps a row you can reach with Tab after a refresh takes away the one you were on, and Refresh in Session
  details stops spinning once its check is done.
- A project picture whose file name has a space in it shows as a background in Liner Design.
