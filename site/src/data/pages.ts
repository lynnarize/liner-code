// The words of /features/ and /workshop/. Facts come from the old site's pages (site/), checked against the
// 0.2.9 tree: CHANGELOG.md, the app's own strings (ui/src/app, contracts/src/index.ts) and the engine
// (engine/src/creator.ts, addons.ts, review.ts). Pictures are named here and sized by shots.json.
import { site } from './site';
import type { Frag } from './site';

export type Row = { b: string; span: string; code?: string; href?: string };

export const features = {
  title: 'Features',
  description: `Everything in Liner Code ${site.version}: Liner Design, Liner Security, Fusion, the Wall and the Reviewer, then plans, asks and a diff for every turn, the surfaces beside a session, access levels and the tools it runs.`,
  tag: 'Features',
  dim: 'Everything in it.',
  head: 'What only Liner has, first.',
  lead: `The coding agents you already have, and everything Liner Code ${site.version} puts round them, in four groups.`,
  index: [
    { href: '#only', label: 'Only in Liner' },
    { href: '#session', label: 'The session' },
    { href: '#surfaces', label: 'Beside the session' },
    { href: '#rest', label: 'The rest' },
  ],
  only: {
    tag: 'Only in Liner',
    dim: 'Start here.',
    head: "The parts you won't find in a terminal.",
    sub: 'Three faces in one window, a crew instead of one model, and a check from a maker that wrote none of it.',
    rows: [
      { b: 'Liner Design', span: 'The same session as a canvas. Frames are real HTML and CSS, drawn by any tool you have, with checks that cost nothing and a Build into your code.', code: '⌥⌘E', href: '/#design' },
      { b: 'Liner Security', span: 'Your own agent reads your code for holes, held to Read only. Free checks first, a second look from another maker, and a fix per finding in a worktree of its own.', code: 'New', href: '/#security' },
      { b: 'Fusion', span: 'A lead plans and hands bounded work to a quicker sidekick in the same folder, then reads the files it changed as Liner measured them, not as it said.', code: 'Code' },
      { b: 'The Wall', span: 'Every live session as a tile. Allow a command, answer a question, steer one at work or settle what is done, from its tile.', code: '⌘⇧O' },
      { b: 'The Reviewer', span: 'A model from another maker reads each change against five fixed criteria, and it is never one that wrote it. What it blocks goes back to the lead, two rounds by default.', code: 'Code' },
      { b: 'Models side by side', span: 'One ask to several models, each in a worktree of its own from the same commit. Read what each said, changed and cost, then keep one.', code: 'Code' },
      { b: 'Workshop', span: "Ask for what Liner doesn't have. An agent builds it as an add-on, and it goes in only on your yes.", code: 'Add-ons', href: '/workshop/' },
      { b: 'Carry on', span: 'Work to pick up here: changes not committed, and the Claude Code and Codex sessions you started in a terminal.', code: 'Sessions' },
      { b: 'See-through window', span: 'Your desktop behind the app on a Mac. Menus and dialogs stay solid, and so does full screen.', code: 'Mac' },
    ] as Row[],
  },
  session: {
    tag: 'The session',
    dim: 'One turn at a time.',
    head: 'You read it before it is yours.',
    sub: 'What a good harness does, in plain sight: a plan before the work, a card when it needs you, a diff after.',
    diff: { name: 'f-diff', dim: 'Every turn is a diff', title: 'Undo it, commit it, or ask about a line', text: 'Liner takes a git snapshot before and after each turn. Changes shows the turn file by file, with Undo turn and Commit at its foot.', alt: 'A finished session with Changes open beside it: src/tides.js with one line taken out and one put in, 0 of 1 viewed, Undo turn 1 and Commit 1 file' },
    cells: [
      { name: 'f-plan', k: 0.82, stage: 'mist', mid: true, alt: "The Demo's plan, Wrap round to tomorrow's first high tide: three steps and the file each touches, a box to say what to change, Edit steps and Approve and start", title: 'Plans you approve', text: 'Ask for a plan first and it waits, with each step and the file it touches. Approve and start, edit the steps, or say what to change.' },
      { name: 'f-ask', k: 0.82, stage: 'sand', mid: true, alt: 'An ask in the composer tray: Demo asks to run npm test, Manual asks before running commands, with Not this and Run it', title: 'Asks at the composer', text: 'A command waits in the tray with why it came to you. Enter runs it. Esc says no and lets you say why.' },
    ] as Frag[],
    rows: [
      { b: 'Questions before guesses', span: 'An agent that needs a choice asks it as a card of options, and waits for your answer.' },
      { b: 'Queue or steer', span: 'While it works, Enter keeps your next message for when the turn ends, and ⌘Enter steers the turn that is running.', code: '⌘Enter' },
      { b: 'A check before send', span: 'A row over the box offers to split a list of tasks into sessions, or to hand a small ask to the fast model.', code: '0.2.9' },
      { b: 'Stop that stops', span: "A tool that hasn't ended its turn a few seconds after Stop is closed. The session picks up where it was on your next message." },
      { b: 'Time left', span: 'A working session says about how long it has to go, from how long its own turns took.' },
      { b: 'What it cost', span: 'A turn closes on one line with its model, time and cost. Usage adds up every turn by agent and model.' },
    ] as Row[],
  },
  surfaces: {
    tag: 'Beside the session',
    dim: 'One key away.',
    head: 'Surfaces on a rail at its edge.',
    sub: "Each opens in the panel beside the thread with ⌘⇧ and its letter. Agents reach the Browser and designs through Liner's own tools.",
    rows: [
      { b: 'Changes', span: 'The turn as a diff, file by file, with Undo turn and Commit.', code: '⌘⇧D' },
      { b: 'Files', span: 'The project as it is now, read beside the conversation instead of in another window.', code: '⌘⇧F' },
      { b: 'Browser', span: 'Your app on localhost with its console. Pick an element and it goes to the agent. Dev servers from .claude/launch.json are a press from running.', code: '⌘⇧B' },
      { b: 'Terminal', span: "The session's own shell, in its folder. PowerShell on Windows.", code: '⌘⇧T' },
      { b: 'Design', span: "The session's frames, small and redrawn as they change, one press from Liner Design.", code: '⌘⇧E' },
      { b: 'Pull request', span: 'Open one through your own gh sign-in, and follow its checks and reviews from the session.', code: '⌘⇧P' },
      { b: 'Device', span: 'The iOS Simulator beside the session, for apps that run on a phone.', code: '⌘⇧M' },
      { b: 'Session', span: 'Context and what fills it, cost and cache hit, the branch, this turn, and who works on it.', code: '⌘⇧I' },
      { b: 'Agents', span: 'The crew as a tree and a timeline: who sent whom, the tasks, and what runs in the background.', code: '⌘⇧A' },
      { b: 'Side chat', span: 'Ask about the session from a fork of its conversation, without stopping it or adding to it.', code: '⌘⇧C' },
    ] as Row[],
  },
  rest: {
    tag: 'And the rest',
    dim: 'Around it all.',
    head: 'Your tools, your levels, your machine.',
    sub: 'Liner drives the tools you installed, unchanged, on their own sign-ins, and holds each to the level you pick.',
    rows: [
      { b: 'API endpoints', span: 'DeepSeek, Kimi, GLM, OpenRouter, or a model in Ollama or LM Studio, run through the tool that speaks its protocol. Its key is sealed in the keychain.', code: 'Settings' },
      { b: 'Access levels', span: "Auto, Manual, Reviewer decides or Full access, and Read only for a Security scan. Even at Full access it asks before a step it can't take back.", code: 'Composer' },
      { b: 'Worktrees', span: 'Start a session on this checkout or in a worktree of its own, so work in two sessions stays apart.', code: 'Home' },
      { b: 'Check my tools', span: 'Settings shows each tool found and signed in, then points it at a test model on this machine to see that Read only and Manual still hold.', code: '0.2.9' },
      { b: 'A spending cap', span: 'Stop a session at a dollar amount, its sidekick included. Your next message is the go-ahead for another. It holds on tools that report cost.', code: 'Settings' },
      { b: 'Quit when they finish', span: 'Quit while sessions work and the app steps out of sight, then quits by itself once they are done.', code: '0.2.9' },
      { b: 'Updates', span: 'On a Mac it updates itself, each release checked by SHA-256 and signature first. Your tools update with their own updaters when you say.', code: 'Mac' },
      { b: 'Mac and Windows', span: 'macOS on Apple silicon and Windows x64. Both in beta.', code: site.version },
    ] as Row[],
  },
};

export const workshop = {
  title: 'Workshop',
  description: "Workshop, the Liner Code mode that adds to the app itself: ask for a connection, a panel, an app or a mode, and an agent builds it as an add-on that goes in only on a card you answer.",
  tag: 'Workshop',
  dim: "Ask for what it doesn't have.",
  head: 'An agent builds it as an add-on.',
  lead: "Workshop is a mode: Standard plus a guide to Liner's add-ons, never more trust. Say what you want and where it should appear. The agent makes it, checks it, and asks you.",
  kinds: {
    tag: 'What it can make',
    dim: 'Four kinds.',
    head: 'Each with a place of its own.',
    items: [
      { kind: 'Every agent tool', title: 'Connections', text: 'An MCP server from a prompt: Linear, Sentry, a database. You type its key on the card, and it is sealed in the keychain.' },
      { kind: 'The right dock', title: 'Panels', text: 'A small page beside a session: a viewer, an editor, a log to watch while you chat.' },
      { kind: 'Beside Chat, or a page', title: 'Apps', text: "A tab beside Chat for a session's own output, or a page under Add-ons in the sidebar, kept across projects." },
      { kind: 'Picked per session', title: 'Modes', text: 'Instructions, with skills and context files, for whichever model a session runs. You pick one when you start.' },
    ],
  },
  ways: {
    tag: 'Ways in',
    dim: 'Only when you ask.',
    head: 'Three ways into Workshop.',
    sub: 'What you type never switches the mode. Everything else starts in your default one.',
    page: { name: 'addons', dim: 'From Add-ons', title: 'Make one with an agent', text: 'The Add-ons page lists what you have, each with its own switch. Make one with an agent starts a Workshop session.', alt: 'The Add-ons page with nothing added yet: say what you would like and an agent makes it in Workshop, with Make one with an agent, and From GitHub, npm or a folder' },
    home: { name: 'ws-home', dim: 'Then, on Home', title: 'The ask is already written', text: 'Home opens with Workshop picked and the start of the ask in the box. Say what it should be, then send.', alt: 'The composer on Home with Create a Liner Code add-on with a left sidebar entry in the box, the Demo, Auto, the main branch and Workshop picked' },
    rows: [
      { b: 'Pick Workshop under the box', span: "Home's mode menu has Standard and Workshop. A Workshop session keeps a chip beside its title.", code: 'Home' },
      { b: 'Make it an app', span: 'At the end of a Standard turn an agent can offer to make what it did into an app, on a card. Create makes it in a session of its own.', code: 'A turn' },
    ] as Row[],
  },
  gate: {
    tag: 'The card',
    dim: 'Nothing goes in without your yes.',
    head: 'It gets only what its card lists.',
    lead: 'What Workshop makes runs in a sealed frame, and reaches Liner only through the access on its card.',
    items: [
      { dt: 'A card first', dd: 'Where it opens, what it can touch and who made it. Nothing is added until you answer.' },
      { dt: 'The least access', dd: 'Project files, the session, the composer, storage of its own, a model, or one host over https, each only if it asks. A new kind asks you again.' },
      { dt: 'Keys stay sealed', dd: 'A connection only names its keys. You type them on the card, and they never reach the transcript or a log.' },
      { dt: 'A model you pick', dd: "An app that asks a model opens Liner's own picker. Two answers at a time, 300 a day, billed to the model you chose." },
    ],
  },
  turn: {
    tag: 'Inside a turn',
    dim: 'What the agent does.',
    head: 'Make it, check it, ask.',
    rows: [
      { b: 'A short to-do list', span: 'Liner shows it as a card you can follow, and it closes when the work is done.' },
      { b: 'The look first', span: "It reads Liner 2.0, the app's own design skill, before any HTML or CSS, so what it makes looks like part of the app." },
      { b: 'The full thing', span: 'In .liner/addons in your project, with the least access it needs. An app on a page gets its library, toolbar, empty states and autosave.' },
      { b: 'A check', span: 'addon_check draws it out of sight at its real size, with real data, and hands back a picture, its errors and anything refused.' },
      { b: 'Your answer', span: 'addon_install shows it to you live, with its card.' },
      { b: 'A version at a time', span: 'It fixes what is wrong in the same add-on until what you asked for works, and stops there.' },
    ] as Row[],
  },
  keep: {
    tag: 'What you keep',
    dim: 'Every version.',
    head: 'Nothing made is thrown away.',
    rows: [
      { b: 'Every version', span: 'Each one is kept, with where it opens, what it can touch, who made it and when.', code: 'Kept' },
      { b: 'Same access, no card', span: 'An update that asks for nothing new goes in by itself. One that asks for more shows a new card.', code: 'Update' },
      { b: 'Remove keeps it', span: 'A removed add-on keeps its files, versions and storage, so Settings can restore it.', code: 'Restore' },
      { b: 'The draft is yours', span: 'Its source stays in .liner/addons in your project, kept out of git, to read and edit.', code: 'Draft' },
      { b: 'From someone else', span: 'Add one from GitHub, npm or a folder, DeepSeek Harness plugins included, on the same kind of card.', code: 'Add-ons' },
    ] as Row[],
  },
  try: {
    tag: 'Try one',
    dim: 'Three to start with.',
    head: 'The asks Workshop suggests.',
    sub: 'These are the examples in Settings, Modes.',
    // BUILTIN_MODES' Workshop examples, contracts/src/index.ts.
    items: [
      { h: 'Add a page', ask: 'Make a notes app with a left sidebar entry that opens a full-page editor. Keep my notes between sessions. Add it, and check that the page opens.', expect: 'An app under Add-ons in the left sidebar, its page working, and what it checked.' },
      { h: 'Add a panel', ask: 'Make a panel beside my sessions that lists the TODOs in this project, so I can send one to you. Check it, then ask me to add it.', expect: 'A panel in the right dock, tried live as a preview before you add it.' },
      { h: 'Make my own mode', ask: 'Make a “Code review” mode: prioritise likely bugs and missing tests, cite files and lines, and ask before changing anything. Save it as a mode I can pick.', expect: 'A mode you pick when you start a session. Its instructions guide the model, and the access level still decides what it may do.' },
    ],
  },
};
