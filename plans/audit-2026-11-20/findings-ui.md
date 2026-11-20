# UI polish & detail-correctness audit — findings (category UI)

Read-only audit at `bfb0ebc`, branch `design-and-api-endpoints`. Scope: `ui/src/app/**` + desktop shell renderer-facing.
Playbook read: `~/.hermes/skills/improve/references/audit-playbook.md` (Correctness/Bugs, Finding format, Prioritization rubric).
Recorded backlogs NOT re-reported: `plans/layout/README.md` "Not planned, and why", L13's seven pending faults, the shared briefing's fixed/rejected lists.
Visual claims are marked "read, not seen" with repro steps; nothing was run against the real app.

---

### [UI-01] Say "up to date", not "Pushed 1 commit", when a push carries nothing

- **Evidence**: `ui/src/app/Ship.tsx:131` — `const n = Math.max(1, s.files ? rows.length : s.commits.length);` floors the commit count at 1. For a push-only shipment (`ship(thread, null)`, entered from `ui/src/app/Panel.tsx:636`, the Changes foot's Push menu when nothing is left to commit), `s.files` is 0 and `s.commits` comes from `git.outgoing`, which returns `[]` for a branch level with its upstream (`engine/src/api.ts:1607`, `log([`${from}..HEAD`])` over an empty range; `ahead` is 0 too, `api.ts:1609`). The chip then reads "1 commit to push" (`Ship.tsx:182`), "Pushing 1 commit to {remote}" (`Ship.tsx:234`) and "Pushed 1 commit" (`Ship.tsx:243`).
- **Impact**: Pushing an already-up-to-date branch — the exact case the Push menu exists for ("Nothing to commit", `Panel.tsx:635`) — animates a card claiming one commit was pushed when git pushed zero. A count that disagrees with what happened, on the app's most celebratory card. Read, not seen. Repro: session on a branch already pushed, no uncommitted changes → Changes tab → Push → "Push {branch}" → watch the chip's words.
- **Effort**: S
- **Risk**: LOW — wording/count only; the `Math.max(1, …)` also guards the with-commit path, which must keep its floor.
- **Confidence**: HIGH — every line on the path read, engine range semantics confirmed.
- **Fix sketch**: For `files === 0` use `s.ahead ?? s.commits.length` without the floor, and give the 0 case its own words ("Everything is up to date" / "Nothing to push"). A source/logic test can pin the count helper once extracted; the card itself is not component-tested today.

### [UI-02] Keep a dismissed tool-update notice away after leaving Home

- **Evidence**: `ui/src/app/Updates.tsx:104` — `const shown = u.tools.filter((t) => !(t.state === "available" && u.dismissed[t.id] === t.latest));` honours the persisted dismissal only for `available` notices. `dismissNotice` (`Updates.tsx:129-133`) persists a dismissal for every notice id, including the grouped `tools:…:updated` and single `…:failed` ones, via `updates.dismiss` → `rpc("updates.dismiss")`. What actually hides them afterwards is the vendored stack's component-local `gone` state (`ui/src/liner/components/notice-stack/notice-stack.tsx:36-37`, `useState<string[]>([])`), which dies with the component. `HomeUpdates` (`Updates.tsx:136-144`) mounts only on Home; `App.tsx` renders `<Home>` only for `view.kind === "home"` (`App.tsx:947` in the home branch of the view switch). The app notice, by contrast, is filtered by the persisted `u.dismissed.app` (`Updates.tsx:101`).
- **Impact**: Dismiss "Updated to X" (or a failed-update notice) on Home, open any session, come back to Home: the notice is back, contradicting the file's own promise "putting one away keeps it away until a newer version comes out" (`Updates.tsx:5-6`). Read, not seen. Repro: with a tool just updated, dismiss its notice on Home → open a session → Back to Home.
- **Effort**: S
- **Risk**: LOW — widening the filter to `u.dismissed[t.id] === t.latest` for the settled states (`updated`, `failed`) matches the app-notice rule; `updating`/`waiting` ids change with state, so a new state still speaks.
- **Confidence**: HIGH — filter, dismiss path, local `gone` state and Home's conditional mount all read.
- **Fix sketch**: In `noticesOf`, exclude any tool whose persisted dismissal equals its `t.latest` (not only `available`), or at least the `updated`/`failed` states; keep the stack's `gone` for the exit animation only. Logic-testable in a node test of `noticesOf` (pure function).

### [UI-03] Stop three infinite animations under Reduce Motion

- **Evidence**: `ui/src/app/dock.css:205-207` — `.lc-addon-frame[data-wait] { animation: lc-frame-wait 1.4s ease-in-out infinite; }` (keyframes at `dock.css:413`); `ui/src/app/surfaces.css:965-971` — `.lc-br-lspin { animation: l-spin 900ms linear infinite; }` (the Browser address bar's loading spinner); `ui/src/app/addons-page.css:71-72` — `.lc-ao-ghost[data-busy] svg { animation: lc-ao-spin 700ms linear infinite; }` (the Add-ons page's Look-again spinner). No `prefers-reduced-motion` block exists in `dock.css`, and no reduce block in any of the 18 sheets names these three selectors (all reduce blocks enumerated). The repo's own contract says "The system's Reduce motion stops both" (`ui/src/app/look.ts:21-22`), and equivalent washes/spinners are covered: `timeline.css:200-208` (`.lc-you-thumb-wait`), `surfaces.css:2985` block (`.lc-pr-spin`, `.lc-rt-spin`), `app.css:5980` block (`.lc-spin-arc`).
- **Impact**: With OS Reduce Motion on, an add-on frame's waiting wash pulses forever, the Browser's load spinner spins, and the Add-ons refresh spinner spins — the three motion holdouts in sheets whose siblings all stop. Read, not seen. Repro: enable Reduce Motion (System Settings → Accessibility → Display), open an add-on tab while its frame loads, load a page in Browser, press Look again on the Add-ons page.
- **Effort**: S
- **Risk**: LOW — `animation: none` under the media query, as the sibling rules do; the wait wash keeps its static gradient.
- **Confidence**: HIGH — every mention of the three selectors/keyframes grepped and read.
- **Fix sketch**: Add the three selectors to reduce blocks in their own sheets (in place, per house rules). Source-testable in `engine/test/layout-rules.test.ts`'s pattern: each sheet's reduce block names its infinite animation's selector.

### [UI-04] Return focus from the add-on Details sheet, and keep the background out of Tab

- **Evidence**: `ui/src/app/AddonsPage.tsx:321-407` — the hand-built `.lc-ao-sheet`: Escape closes via a window keydown listener (`:269-273`), the Close button takes `autoFocus` (`:329`), but `onClose` (`:236`, `setOpen(null)`) never restores focus to the row's "Details for {name}" button that opened it (`:181`), and nothing makes the page behind the sheet inert or traps Tab inside it. (The drawer's *shape* is the recorded backlog item "Two dialog systems and a hand-built drawer"; focus management is a separate fault, not that decision.)
- **Impact**: A keyboard user who opens an add-on's details and closes it lands on `document.body` and must Tab through the whole page again; while the sheet is open, Tab walks the page behind it, out of sight. Read, not seen. Repro: keyboard-only, focus an add-on row's Details button → Enter → Escape → observe focus; repeat and Tab past the sheet's last control.
- **Effort**: S
- **Risk**: LOW — focus save/restore is local to `Details`; inerting the background touches the page wrapper only while the sheet is open.
- **Confidence**: HIGH — the whole component read; no restore/trap code exists in it.
- **Fix sketch**: Capture `document.activeElement` when the sheet opens and focus it in the close path (as `ContextMenu` already does, `ui.tsx:227-231`); set `inert` on the page content while open, or move the sheet to Liner's `Dialog` when the dialog decision is taken.

### [UI-05] Let the docked Changes say its diff failed, as the full Review does

- **Evidence**: `ui/src/app/Panel.tsx:669-675` — the `checkpoint.diff` catch in `Changes` sets `diff: []`, `total: 0` and shows a transient toast (`fail(e)`); the surface then renders `CodeDiff files={[]}`, whose header reads "0 files changed" (`ui/src/liner/pro/code-diff/code-diff.tsx:325`). The full-width Review keeps a persistent error state instead: `diffErr` (`ui/src/app/Review.tsx:137,172-177`) rendered as `SurfaceNote` "The changes didn't open" (`Review.tsx:421-424`). The catch's own comment admits the hazard: "An empty diff alone would read as a turn that changed nothing" (`Panel.tsx:673`).
- **Impact**: When a diff fails in the docked Changes (git error, a snapshot gone), the toast fades and the tab reads as a turn that changed nothing — the error state renders blank, with no retry; the same failure in the full Review stays said. Two faces of one diff, two answers. Read, not seen. Repro: force `checkpoint.diff` to fail (e.g. a checkpoint whose commit was pruned) with the Changes tab docked, wait out the toast.
- **Effort**: S
- **Risk**: LOW — mirror Review's `diffErr` + `SurfaceNote` in `Changes`; the empty-vs-failed distinction already exists in Review.
- **Confidence**: HIGH — both paths and CodeDiff's empty header read.
- **Fix sketch**: Keep a `diffErr` state in `Changes` and render the same `SurfaceNote` the Review uses (with the message), instead of an empty `CodeDiff`.

### [UI-06] Guard the bare storage reads and writes in the app shell, Settings, Changes and Device

- **Evidence**: The newer code wraps every storage access and says why: "A window without storage (it throws) starts on its own each time, rather than breaking the page" (`ui/src/app/design/DesignHome.tsx:181-194`), also `design/Intro.tsx:24-36`, `security/Side.tsx:45-64`, `face.ts:64-82`, `Commit.tsx:29-45`, `Review.tsx:34-50`, `Surfaces.tsx:53-60,81-88`, `AgentDialog.tsx:391-395`. Still bare: the app shell itself — `App.tsx:197` (`lc:sidebar` read in a state initializer), `:203` (`lc:project`), `:253` (`sessionStorage.setItem("lc:view", …)` on every view change), `:254-257` (sidebar/project writes); Settings — `Settings.tsx:88` (`lc:enter` read, cast into the union), `:141` (the whole look written on every appearance change), `:203,622`; the docked Changes — `Panel.tsx:651` (read + `as "split"` cast), `:655` (write); Device — `Device.tsx:17` (read), `:55` (write).
- **Impact**: In a window where storage throws (the case the newer comments name), the app fails at mount or on the first navigation — the `sessionStorage` write runs on every view change, so the Boundary fault screen replaces the app, not just one tab; Settings throws on any appearance change; a corrupted `lc:view`/`lc:enter` value passes its cast straight into the code. Read, not seen. Repro: block storage for the app origin (or fill it), launch / navigate / change the accent.
- **Effort**: S (mechanical: the same try/catch the neighbours use, ~10 sites)
- **Risk**: LOW — defaults on failure are already the neighbours' behaviour; validate the two cast values against their unions.
- **Confidence**: HIGH — every site read; the repo's own comments state the intent the bare sites break.
- **Fix sketch**: Wrap the reads/writes in try/catch with the same quiet defaults (sidebar shown, queue Enter, unified view), and accept only known values where a cast stands today.

### [UI-07] Re-scroll to a file pressed again in the docked Changes, as the Review does

- **Evidence**: `ui/src/app/Review.tsx:237-242` — the scroll effect depends on `[diff, focus]`; each press makes a new `focus` object (`onFocus({ id: pick, path })`), so pressing the same file again after scrolling away scrolls again — the comment says exactly that ("pressed again after scrolling away, it does again"). The docked `Changes` effect (`ui/src/app/Panel.tsx:682-688`) depends on `[diff, focus?.path]` — a string that does not change on a re-press, so the effect never re-runs.
- **Impact**: The same gesture — press a file in the thread, scroll away, press it again — works in the full Review and does nothing in the docked Changes. Cross-face inconsistency in the app's core review loop. Read, not seen. Repro: docked Changes open, press file A in the thread, scroll the diff away, press A again; repeat with the full-canvas Review.
- **Effort**: S
- **Risk**: LOW — depend on the `focus` object as Review does (the viewed-mark write is idempotent).
- **Confidence**: HIGH — both effects and their deps read.
- **Fix sketch**: Change the deps to `[diff, focus]` in `Changes`, matching Review; keep the `focus?.path` guard inside.

### [UI-08] Give the Session checks' failed names to the keyboard, not only the pointer

- **Evidence**: `ui/src/app/SessionInfo.tsx:154-168` — `ChecksLine` puts the failed checks' names (or "N still running") only into `title` (`:159`), which `Line` renders as a native `title` on a plain div (`SessionInfo.tsx:362-368`). The visible text is just the `passed/total` count and a coloured dot (`aria-hidden`, `:163`). The recorded backlog item is the 163 native titles in Settings; this is the same pattern elsewhere, and here the title carries information shown nowhere else.
- **Impact**: A keyboard or screen-reader user on the Session surface can see that checks failed but cannot learn which — the names exist only in a pointer-hover tooltip on a non-focusable div. Read, not seen. Repro: a session whose PR has a failed check, open the Session tab, navigate by keyboard/screen reader to the Checks row.
- **Effort**: S
- **Risk**: LOW — wording/layout only.
- **Confidence**: HIGH — component and its `Line` wrapper read end to end.
- **Fix sketch**: Show the names as text (the row already wraps) or move them into a `HoverNote`, which also opens on keyboard focus (`ui.tsx:410`), keeping the count as the row's face.

### [UI-09] Hold Compact to one press until the turn takes it

- **Evidence**: `ui/src/app/SessionInfo.tsx:51-56` — `compactNow` sends `/compact` with no in-flight guard; the button (`SessionInfo.tsx:279`) is disabled only by `running || !ctx`, where `running` is `thread.status === "running"` (`:28`) — a store value that updates an engine round-trip after the press. The composer's cold-cache banner has the same unguarded `compactNow` (`ui/src/app/Composer.tsx:738-744`), and its Compact button carries no `disabled` at all (`Composer.tsx:1089`). Two quick presses (or a held Enter) both send before the status lands; the second `/compact` queues (`engine/src/runtime.ts:1256` `send` enqueues while running). Contrast `security/StartScan.tsx:58-59`, which sets `starting` at the press precisely so "a second press (Enter held, or pressed again …) can't" start twice.
- **Impact**: A double-press compacts the conversation twice — the second run spends a turn summarising what was just summarised. Read, not seen. Repro: Session tab → Context → Compact, double-click before the session's status turns to running.
- **Effort**: S
- **Risk**: LOW — a local `compacting` flag cleared when the turn starts or the send fails, as StartScan does.
- **Confidence**: MED — the race window is real but narrow; whether the tool no-ops a second `/compact` needs the real tool to confirm.
- **Fix sketch**: Disable the button from the press (local state), re-enable on failure or when the turn ends, mirroring StartScan's `starting`.
### [UI-10] Let a held ⌘⇧Enter send one queued message, not the whole queue

- **Evidence**: `ui/src/app/Composer.tsx:722-734` — the window keydown for ⌘⇧Enter ("Send now" for the first queued message) checks key/modifiers/`isComposing` but not `e.repeat`, and `sendNow` (`Composer.tsx:691-707`) has no in-flight guard: it reads `queue.findIndex`, fires `thread.queue` + `thread.send` and returns. Each key-repeat (~30ms) therefore sends the then-first queued message; the engine round-trip that removes it is faster than the repeat, so holding the shortcut drains the queue one message at a time. The repo's own pattern checks repeat: `security/StartScan.tsx:388` (`!e.repeat` on Enter), and Review's line-ask guards with `sending.current` (`Review.tsx:275-291`).
- **Impact**: Holding ⌘⇧Enter — a common way to press a shortcut firmly — sends every queued message into the turn (or starts turns with them), not just the first; the queue's "Send now" button double-pressed inside the RPC window can likewise send one message twice, since nothing marks it in flight. Read, not seen. Repro: queue three messages, hold ⌘⇧Enter for a second.
- **Effort**: S
- **Risk**: LOW — `e.repeat` check plus an in-flight ref cleared when the queue event lands, as `steered` already tracks.
- **Confidence**: HIGH for the missing repeat/guard (lines read); MED for how often a held key drains the whole queue in practice (event timing).
- **Fix sketch**: Ignore `e.repeat` in the shortcut handler and give `sendNow` a per-message in-flight mark (the `steered` ref is close by) so a second press of the same row is a no-op until the queue event answers.

### [UI-11] Give the seven other tablists the arrow keys the dock strip already has

- **Evidence**: The dock strip implements the WAI-ARIA tabs pattern — arrows, Home, End, roving `tabIndex` (`ui/src/app/Panel.tsx:451-460,505`), and the Design inspector does too (`ui/src/app/design/Inspector.tsx:89`). Seven other `role="tablist"`s have none of it (no arrow handler, every tab left tabbable): `ui/src/app/security/parts.tsx:112-123` (`CountTabs`, the Findings state tabs), `ui/src/app/security/FindingPanel.tsx:256-262` (Summary/Code/Activity), `ui/src/app/Session.tsx:642-649` (Chat beside a tab app), `ui/src/app/Terminal.tsx:468-479` (shells), `ui/src/app/Models.tsx:198-215` (the tool rail — its Up/Down go to the model list instead, `Models.tsx:159-172`), `ui/src/app/design/Tabs.tsx:196,216` (the open designs, which even declare `aria-orientation="vertical"` while every row keeps `tabIndex: 0` and only Enter/Space is handled), `ui/src/app/Modes.tsx:117-124` (the guide's two sections).
- **Impact**: A keyboard user moving between tabs in Security, the session views, terminals, the model picker's rail or Design's open-design list must Tab through every tab (and, in the vertical design list, through every row) instead of the arrows the same app teaches on the dock strip; the vertical tablist's declared orientation promises Up/Down that do nothing. Read, not seen. Repro: focus a Findings state tab or an open-design row, press ArrowRight/ArrowDown.
- **Effort**: M (seven sites, but one shared hook lifts the strip's eight-line handler)
- **Risk**: LOW — key handling only; the strip's handler is the proven copy.
- **Confidence**: HIGH — every tablist grepped and each handler (or its absence) read.
- **Fix sketch**: Extract the strip's arrow/Home/End + roving-tabindex logic into a small hook and apply it to the seven lists; for the vertical design list use Up/Down per its `aria-orientation`.

### [UI-12] Give the page scrollers the thread's scrollbar and overscroll treatment

- **Evidence**: The Code thread's scroller is `scrollbar-width: thin; scrollbar-color: transparent transparent` with the thumb shown only on hover (`ui/src/app/app.css:1926-1940`, `.lc-scroll`), and Design's lean/chat/inspector scrollers are thin too (`design/lean-page.css:92,161,229`, `design/chat.css:183-184`, `design/inspector.css:83,532`). The other faces' page scrollers take the OS default and no overscroll containment: `.ls-scroll` (every Security page, `security/security.css:35-39`), `.lc-st-scroll` (Settings, `app.css:5268-5272`), `.lc-ao-scroll` (Add-ons, `addons-page.css:9-13`), `.lc-usage-in` (Usage, `app.css:4672-4679`), `.lc-home-in` (Home, `app.css:4302-4313`), `.lf-x-body` (the finding panel's body, `security/findings.css:260-268`). The Wall grid has `overscroll-behavior: contain` but not the thin width (`wall.css:46-50`).
- **Impact**: With the OS set to always show scrollbars (or on Windows/Linux), Security, Settings, Add-ons, Usage and Home draw a full default scrollbar beside the thread's quiet hover thumb — the faces don't read as one app; and scrolling past a page's end chains to the window (no `overscroll-behavior: contain`), where the thread and the Wall hold it. Read, not seen. Repro: macOS System Settings → Appearance → "Show scroll bars: Always", open Settings beside a session and compare the two scrollers.
- **Effort**: S
- **Risk**: LOW — the thread's three declarations copied in place; the finding body's foot mask keeps its fade.
- **Confidence**: HIGH — every scroller rule read; the visual difference depends on the OS scrollbar setting (hence the repro).
- **Fix sketch**: Add `scrollbar-width: thin; scrollbar-color: transparent transparent` + the hover-thumb rule (or one shared class) and `overscroll-behavior: contain` to the six page scrollers. Source-testable in the layout-rules pattern.

### [UI-13] Disable Browser's Back and Forward when there is nowhere to go

- **Evidence**: `ui/src/app/Browser.tsx:670-675` — the Back and Forward buttons carry no `disabled` and no history state; they post `cmd("back")`/`cmd("forward")` (`Browser.tsx:276`) into the frame, whose probe answers with a bare `history.back()` / `history.forward()` (`engine/src/proxy.ts:644-645`). Nothing in the probe or the surface tracks whether a back/forward entry exists (no history reporting in `browserFrame.ts` or the message handler, `Browser.tsx:252-273`). The neighbouring toolbar buttons do have disabled states (Open in your browser `:727`, zoom `:736-742`).
- **Impact**: On the first page loaded, Back looks pressable and does nothing — the one toolbar affordance every browser trains people to trust is a silent no-op; same for Forward at the newest page. Read, not seen. Repro: open the Browser surface on any page, press Back before navigating anywhere.
- **Effort**: M (the probe must report its place in history; the UI part is two `disabled` attributes)
- **Risk**: LOW — a wrong guess only re-enables/disables a button; the probe already owns navigation.
- **Confidence**: HIGH — button, command path and probe handler all read.
- **Fix sketch**: Have the probe count its navigations and back/forward moves and post `canGoBack`/`canGoForward` with its load events; disable the two buttons from that state.

### [UI-14] Call the Session surface's re-ask "Look again", as everywhere else does

- **Evidence**: The re-query action is named "Look again" on the Add-ons page (`ui/src/app/AddonsPage.tsx:145`), Usage (`ui/src/app/Usage.tsx:279`), Linked pull requests (`ui/src/app/Pr.tsx:833`), Projects (`ui/src/app/Projects.tsx:234`) and Settings' agent tools (`ui/src/app/Settings.tsx:1412-1414`). The Session surface's same action is `aria-label="Refresh"` with `title="Ask the session again"` (`ui/src/app/SessionInfo.tsx:67`).
- **Impact**: One action, two names across faces — a screen-reader user hears "Refresh" in one tab and "Look again" in the next for the same gesture; the app's own converged word is the plain one. Read, not seen.
- **Effort**: S
- **Risk**: LOW — two strings.
- **Confidence**: HIGH — every refresh-labelled button grepped and read.
- **Fix sketch**: Rename the Session button's label/title to "Look again" (its busy state already reads through `looking`).

### [UI-15] Say why Add it is grey when the pasted manifest isn't JSON

- **Evidence**: `ui/src/app/Settings.tsx:2553-2625` (`AddByHand`, also reached from the Add-ons page's Connect a service dialog, `AddonsPage.tsx:246-252`): `parsed` is `null` whenever `JSON.parse(text)` throws (`:2560-2567`), and the Add button is simply `disabled={busy || !parsed}` (`:2616`) — no error line, no hint, no `title`. The sibling flow does say why: `AddFrom` renders its `why` as `role="alert"` under the field (`AddonsPage.tsx:461-465`), and the connection card hints "Type the {label} first" (`AddonsPage.tsx:732`).
- **Impact**: Paste a manifest with one stray comma and the Add button goes grey with nothing said — the form's only feedback is silence, while the app's other add flows explain themselves. Read, not seen. Repro: Settings › Add-ons › add by hand (or Add-ons › Connect a service), paste `{ "id": "x", }`, watch the button.
- **Effort**: S
- **Risk**: LOW — one conditional line under the textarea, as AddFrom does.
- **Confidence**: HIGH — the whole form read; no other feedback path exists in it.
- **Fix sketch**: When `text` is non-empty and `parsed` is null, show a quiet alert line ("That isn't JSON yet" with the parse message's first words), and keep Add disabled.

### [UI-16] Give the radio groups the arrow keys StartScan and the scan questions already have

- **Evidence**: The newest choice surfaces implement the keyboard pattern: StartScan's boxes move by arrows (`ui/src/app/security/StartScan.tsx:230,255,410-432`), and the scan's question card answers to A/B/C, arrows and Enter (`ui/src/app/security/Questions.tsx:52-66`). The other `role="radiogroup"`s have no arrow handling and leave every option tabbable: Home's "Where it runs" (`ui/src/app/Home.tsx:199-205`), Design's "Where the design lives" (`ui/src/app/Design.tsx:223-230`), the Code timeline's question options (`ui/src/app/Timeline.tsx:1587-1605`, divs with `tabIndex={0}`, Enter/Space only), Settings' theme cards and both swatch rows and backgrounds (`ui/src/app/Settings.tsx:806-821,893-901,912-920,1056`), the agent dialog's "Good at" (`ui/src/app/AgentDialog.tsx:183-192`), and an add-on offer's "Add to" (`ui/src/app/Addon.tsx:612-622`). The composer's permission group uses number keys on purpose, with visible kbd hints (`Composer.tsx:919-944`) — a documented exception, not a gap.
- **Impact**: The same gesture — pick one of a few options — answers to arrows in Security and to nothing but Tab-and-Enter in Code, Home, Design and Settings; the Code question card, the one an agent waits on, is the least keyboard-friendly of them. Read, not seen. Repro: focus an option of Home's "Where it runs" or a question's answers in the thread, press ArrowDown.
- **Effort**: M (eight sites; one shared roving hook serves all)
- **Risk**: LOW — key handling only; StartScan's `arrows` is the proven copy.
- **Confidence**: HIGH — every radiogroup grepped and each handler (or its absence) read.
- **Fix sketch**: Lift StartScan's arrow/roving-tabindex handler into a hook and apply it to the eight groups; keep the composer's number keys as they are.

### [UI-17] Let Settings' project memory and rules say they failed, not that they're empty or gone

- **Evidence**: `ui/src/app/Settings.tsx:2734-2739` — `MemoryEditor` answers a failed `memory.list` with `setFacts([])`, which renders the empty-state words "Nothing yet. Agents save facts here as they learn them…" (`:2747`); a failed read is indistinguishable from a project with no memories. `ui/src/app/Settings.tsx:2778-2783` — `RulesEditor` answers a failed `project.rules` with `setRules(null)`, and `if (!rules) return null` (`:2783`) then removes the whole "Rules for every agent" field from the page: on error the feature silently vanishes. Both also render nothing at all while loading (`:2739`, `:2783`). The app's own pattern for a failed read is a said state (Review's `SurfaceNote`, `Review.tsx:421-424`; the Session surface's `failed` note, `SessionInfo.tsx:58,62`).
- **Impact**: If the engine can't read a project's memory or rules (folder moved, file unreadable), Settings tells the person the project remembers nothing, or hides the rules editor entirely — either way they may re-write what's already there, or never find the editor. Read, not seen. Repro: make `project.rules` fail (e.g. a project whose folder was removed outside the app) and open its Settings section.
- **Effort**: S
- **Risk**: LOW — an error line in place of the empty words / the null return, as the Session surface does.
- **Confidence**: HIGH — both components read end to end.
- **Fix sketch**: Keep a failed flag per editor; render a quiet alert line with a Look again, and keep the field visible; show the loading shimmer while the first read is out.

### [UI-18] Give Usage a loading and a failed state instead of "No turns yet"

- **Evidence**: `ui/src/app/Usage.tsx:18,27-36` — `data` starts `null` and a failed `usage.summary` sets it back to `null`; the page then renders its empty words in both cases: "No turns yet." under By agent (`Usage.tsx:122`) and the By model empty line (`:152`), with the hero figures at zero. There is no shimmer while the first summary is out and no note when it fails. The same pattern one page over: `ui/src/app/Projects.tsx:145` answers a failed `projects.scan` with `[]`, which reads "No Git repositories in the usual folders." (`Projects.tsx:227`); the GitHub tab beside it keeps the failure's detail (`Projects.tsx:150,286`). A third shape of the same fault: Design Home's first `design.all` failure is swallowed (`design/DesignHome.tsx:352-362`, the `() => {}` handler), leaving `listed` null and the page on "Looking for designs" forever (`DesignHome.tsx:514`) — a loading state that never ends and never says why.
- **Impact**: Opening Usage on a slow or failing engine shows a confident "$0 / no turns" page — the person reads it as truth rather than a wait or a fault; the project finder likewise says the Mac has no repositories when the scan failed. Read, not seen. Repro: open Usage with the engine briefly unreachable (or force `usage.summary` to fail); compare the GitHub tab's said failure in Projects.
- **Effort**: S
- **Risk**: LOW — a shimmer while `data === null` on first load, and a quiet failed line with Look again (the page already has the refresh button, `:279`).
- **Confidence**: HIGH — state, fetch and both empty renderings read.
- **Fix sketch**: Distinguish loading from failed from empty (three states, as the Session surface does with `looking`/`failed`/info); keep the scan's error message for the Mac tab as the GitHub tab keeps its own.

### [UI-19] Hide the Ship card's unused stage words from screen readers

- **Evidence**: `ui/src/app/Ship.tsx:137` — the whole card is `role="status" aria-live="polite"`, and every stage's words are rendered at once: the header's Committing/Pushing/Pushed (`Ship.tsx:160-167`), the row's "N commits to push"/"up to date" (`:181-184`), the chip's five lines x0–x4 (`:222-245`). The inactive ones are hidden by `opacity: 0; filter: blur(4px)` only (`ui/src/app/app.css:6303-6313`) — opacity does not remove content from the accessibility tree, and none of the spans carries `aria-hidden`. The repo's own stacked-swap pattern does it right: the inspector's regular/medium cell puts `aria-hidden` on the unused span (`ui/src/app/design/inspect/controls.tsx:102-103`), and Send/Stop swaps the button's `aria-label` instead (`ui.tsx:335`).
- **Impact**: A screen reader reads the push card as all its stages at once — "Commit and push / Committing N files / Pushing N commits / Pushed to origin / Pushed N commits / Committing / Pushing / Pushed / N commits to push / up to date" — and the live region on the whole card re-announces as rows and the sha arrive. The card's one sentence per stage is lost in the pile. Read, not seen. Repro: VoiceOver on, commit and push from the Changes foot, listen to the card.
- **Effort**: S
- **Risk**: LOW — mark the spans not shown at the current stage `aria-hidden` (the stage is already in hand as `s.stage`); the look does not change.
- **Confidence**: HIGH — markup, CSS hiding and the live region all read; the correct sibling pattern confirmed.
- **Fix sketch**: Compute `aria-hidden` per span from `s.stage` (or move the live region onto the one visible status line), keeping the cross-blur as it is.

### [UI-20] Give the right-click menus the Home and End keys the Pop menus have

- **Evidence**: `ui/src/app/ui.tsx:202-208` — a `Pop` menu moves by ArrowDown/ArrowUp/Home/End, wrapping; the `ContextMenu` at `ui.tsx:253-259` handles only ArrowDown/ArrowUp. Both render the same rows (`Row` with `role="menuitem"`), and the WAI-ARIA menu pattern names Home/End as part of it.
- **Impact**: The same rows answer to Home/End when opened from a button and not when opened by right-click (a tab's menu, a design file's menu, the Mix-two menu) — one keyboard behaviour, two answers depending on how the menu opened. Read, not seen. Repro: right-click a dock tab, press End.
- **Effort**: S
- **Risk**: LOW — two cases added to the existing handler, copied from the Pop's.
- **Confidence**: HIGH — both handlers read side by side.
- **Fix sketch**: Extend ContextMenu's key handler with Home/End as the Pop menu does (one shared helper would keep them from drifting again).
