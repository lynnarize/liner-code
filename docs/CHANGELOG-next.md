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

### Fixed

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
