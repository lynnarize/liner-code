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
- Teamwork and a Swarm are no longer pinned over the chat or kept as a card at its end: their chip, and turning a team
  on, open the team in the Agents panel on the right. Liner Design's chat and a Liner Security scan, which have no
  Agents panel, keep the team's card.
- The sidebar is a little wider (240, Capy's default) so titles say more, and it reads the same in Code, Design and
  Security: every session or design is a one-line title with its state at the right end and the time on the second
  line, and each list's heading has the same Filter and ··· at its right end.

### Fixed

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
