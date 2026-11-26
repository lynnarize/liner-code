## Next (not released)

Notes for the next release are collected here, then moved into `CHANGELOG.md` when it ships
(the website is built from `CHANGELOG.md`).

### Changed

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
