// The words of /features/ and /workshop/, one sentence a row, checked against the 0.3.2 tree: CHANGELOG.md,
// the app's own strings (ui/src/app, contracts/src/index.ts) and the engine (engine/src/creator.ts, addons.ts, review.ts). Pictures are named here and sized by shots.json.
import { site } from './site';
import type { Frag } from './site';

export type Row = { b: string; span: string; code?: string; href?: string };

export const features = {
  title: 'Features',
  description: `Everything in Liner Code ${site.version}: Liner Design, Liner Security, Teamwork and Swarm, Fusion, the Wall and the Reviewer, then plans, asks and a diff for every turn, the right panel, access levels and the tools it runs.`,
  tag: 'Features',
  dim: 'Everything in it.',
  head: 'What only Liner has, first.',
  lead: `Everything Liner Code ${site.version} puts round the agents you already have, in four groups.`,
  index: [
    { href: '#only', label: 'Only in Liner' },
    { href: '#session', label: 'The session' },
    { href: '#surfaces', label: 'Beside the session' },
    { href: '#rest', label: 'The rest' },
  ],
  only: {
    tag: 'Only in Liner',
    head: "The parts you won't find in a terminal.",
    sub: 'Three faces in one window, a team instead of one model, and a check from another maker.',
    rows: [
      { b: 'Liner Design', span: 'The same session as a canvas of real HTML and CSS frames, with free checks and a Build into your code.', code: '⌥⌘E', href: '/#design' },
      { b: 'Liner Security', span: 'Your own agent reads your code for holes at Read only, with a second look and a fix per finding.', code: 'Security', href: '/#security' },
      { b: 'Teamwork and Swarm', span: 'A team of agents in one session on any tool, each writer in its own worktree, and only you land their work.', code: 'New', href: '/#agents' },
      { b: 'Fusion', span: 'A lead plans, hands bounded work to a quicker sidekick, then reads the files it really changed.', code: 'Code' },
      { b: 'The Wall', span: 'Every live session as a tile you can answer, allow, steer or settle.', code: '⌘⇧O' },
      { b: 'The Reviewer', span: 'A model from another maker reads each change against five fixed criteria and sends what it blocks back to the lead.', code: 'Code' },
      { b: 'Models side by side', span: 'One ask to several models, each in its own worktree from the same commit, and you keep one.', code: 'Compare' },
      { b: 'Workshop', span: "Ask for what Liner doesn't have, and an agent builds it as an add-on that goes in on your yes.", code: 'Add-ons', href: '/workshop/' },
      { b: 'Carry on', span: 'Pick up uncommitted work and the Claude Code and Codex sessions you started in a terminal.', code: 'Sessions' },
    ] as Row[],
  },
  session: {
    tag: 'The session',
    head: 'You read it before it is yours.',
    sub: 'A plan before the work, a card when it needs you, and a diff after.',
    diff: { name: 'f-diff', title: 'Every turn is a diff', text: 'Changes shows each turn file by file, with Undo turn and Commit at its foot.', alt: 'A finished session with Changes open beside it: one file with a line taken out and one put in, with Undo turn and Commit' },
    cells: [
      { name: 'f-plan', k: 0.82, stage: 'mist', mid: true, alt: 'A plan of three steps and the file each touches, a box to say what to change, Edit steps and Approve and start', title: 'Plans you approve', text: 'Ask for a plan and it waits for your yes, each step with the file it touches.' },
      { name: 'f-ask', k: 0.82, stage: 'sand', mid: true, alt: 'An ask over the message box: the Demo asks to run npm test, with Not this and Run it', title: 'Asks at the message box', text: 'A command waits with why it came to you, and Enter runs it while Esc says no.' },
    ] as Frag[],
    rows: [
      { b: 'Questions before guesses', span: 'An agent that needs a choice asks it as a card of options and waits for you.' },
      { b: 'Queue or steer', span: 'While it works, Enter queues your next message and ⌘Enter steers the running turn.', code: '⌘Enter' },
      { b: 'A check before send', span: 'A row over the box offers to split a list of tasks into sessions, or to send a small ask to a quicker model.', code: 'Message box' },
      { b: 'Stop that stops', span: 'A tool still running a few seconds after Stop is closed, and the session picks up on your next message.' },
      { b: 'Switch tools mid-session', span: "Pick another tool's model and the session moves there with a note of everything so far.", code: '0.3.2' },
      { b: 'What it cost', span: "Each turn's Worked for line carries its cost, and Usage adds it up by agent and model.", code: '⌘⇧U' },
    ] as Row[],
  },
  surfaces: {
    tag: 'Beside the session',
    head: 'The right panel, one key away.',
    sub: 'Each opens from its icon in the session header, or with ⌘⇧ and its letter.',
    rows: [
      { b: 'Changes', span: 'The turn file by file as a diff viewer shows it, with Viewed ticks, Undo turn and Commit.', code: '⌘⇧D' },
      { b: 'Files', span: 'The project as it is now, with a find field and only the changed files a press away.', code: '⌘⇧F' },
      { b: 'Browser', span: 'Your app on localhost with its console and dev servers, and any element you pick goes to the agent.', code: '⌘⇧B' },
      { b: 'Terminal', span: "The session's own shell in its folder, and PowerShell on Windows.", code: '⌘⇧T' },
      { b: 'Design', span: "The session's frames, small and redrawn as they change, one press from Liner Design.", code: '⌘⇧E' },
      { b: 'Pull request', span: 'Open one through your own gh sign-in and follow its checks and reviews from the session.', code: '⌘⇧P' },
      { b: 'Device', span: 'The iOS Simulator beside the session, with its log at the foot.', code: '⌘⇧M' },
      { b: 'Session', span: "A card pinned at the chat's top right with context, cost, the branch and who works.", code: '⌘⇧I' },
      { b: 'Agents', span: "Every agent and subagent on every tool as a tree with its trail, and a team's board and worktrees.", code: '⌘⇧A' },
      { b: 'Side chat', span: 'Ask about the session from a fork of it, without stopping it or adding to it.', code: '⌘⇧C' },
    ] as Row[],
  },
  rest: {
    tag: 'And the rest',
    head: 'Your tools, your levels, your machine.',
    sub: 'Liner drives the tools you installed, unchanged, on their own sign-ins.',
    rows: [
      { b: 'API endpoints', span: 'DeepSeek, Kimi, GLM, OpenRouter, Ollama or LM Studio through the tool that speaks its protocol, with its key sealed in the keychain.', code: 'Settings' },
      { b: 'A picker by tool', span: 'Your tools down its side, each tool\'s models with their own effort levels, and a card for the one you point at.', code: 'Message box' },
      { b: 'Access levels', span: "Auto, Manual, Reviewer decides or Full access, and Read only for a scan, with a yes before any step it can't take back.", code: 'Permissions' },
      { b: 'Worktrees', span: 'Start a session on this checkout, in a new worktree or from a branch, so two sessions stay apart.', code: 'Home' },
      { b: 'Check my tools', span: 'Settings shows each tool found and signed in, and checks that Read only and Manual still hold.', code: 'Settings' },
      { b: 'A spend limit', span: 'A session stops at a dollar amount you set, on tools that report their cost, such as Claude Code.', code: 'Settings' },
      { b: 'Quit when they finish', span: 'Quit while sessions work and the app steps out of sight, then quits once they are done.', code: 'Quit' },
      { b: 'Mac and Windows', span: 'macOS on Apple silicon and Windows x64, in beta, and a Mac updates itself once each release passes its signature check.', code: site.version },
    ] as Row[],
  },
};

export const workshop = {
  title: 'Workshop',
  description: "Workshop, the Liner Code mode that adds to the app itself: ask for a connection, a panel, an app or a mode, and an agent builds it as an add-on that goes in only on a card you answer.",
  tag: 'Workshop',
  dim: "Ask for what it doesn't have.",
  head: 'An agent builds it as an add-on.',
  lead: 'Say what you want and where it should appear, and an agent makes it, checks it and asks you.',
  kinds: {
    tag: 'What it can make',
    head: 'Four kinds, each with a place of its own.',
    items: [
      { kind: 'Every agent tool', title: 'Connections', text: 'An MCP server from a prompt, such as Linear, Sentry or a database, with its key typed on the card and sealed in the keychain.' },
      { kind: 'The right panel', title: 'Panels', text: 'A small page beside a session, such as a viewer, an editor or a log to watch while you chat.' },
      { kind: 'Beside Chat, or a page', title: 'Apps', text: "A tab beside Chat for a session's own output, or a page under Add-ons kept across projects." },
      { kind: 'Picked per session', title: 'Modes', text: 'Instructions, skills and context files for whichever model a session runs, picked when you start.' },
    ],
  },
  ways: {
    tag: 'Ways in',
    head: 'Three ways into Workshop.',
    sub: 'What you type never switches the mode.',
    page: { name: 'addons', title: 'Make one with an agent', text: 'The Add-ons page lists what you have, and Make one with an agent starts a Workshop session.', alt: 'The Add-ons page with nothing added yet, with Make one with an agent, and From GitHub, npm or a folder' },
    home: { name: 'ws-home', title: 'The ask is already written', text: 'Home opens with Workshop picked and the start of the ask already in the box.', alt: 'The message box on Home with the start of an add-on ask in it and Workshop picked' },
    rows: [
      { b: 'Pick Workshop on Home', span: "The + in Home's message box holds the mode, and Workshop shows as a chip you can cross off.", code: 'Home' },
      { b: 'Make it an app', span: 'At the end of a Standard turn an agent can offer, on a card, to make what it did into an app.', code: 'A turn' },
    ] as Row[],
  },
  gate: {
    tag: 'The card',
    head: 'Nothing goes in without your yes.',
    lead: 'What Workshop makes runs in a sealed frame and reaches Liner only through the access on its card.',
    items: [
      { dt: 'A card first', dd: 'It says where it opens, what it can touch and who made it, and nothing goes in until you answer.' },
      { dt: 'The least access', dd: 'Files, the session, the message box, its own storage, a model or one https host, each only if it asks.' },
      { dt: 'Keys stay sealed', dd: "You type a connection's keys on its card, and they never reach the transcript or a log." },
      { dt: 'A model you pick', dd: "An app that asks a model uses Liner's own picker, two answers at a time and 300 a day, billed to the model you chose." },
    ],
  },
  turn: {
    tag: 'Inside a turn',
    head: 'Make it, check it, ask.',
    rows: [
      { b: 'A short to-do list', span: 'Liner shows it as a card you can follow, and it closes when the work is done.' },
      { b: 'The look first', span: "It reads Liner 2.0, the app's own design skill, so what it makes looks like part of the app." },
      { b: 'The full thing', span: 'It writes it in .liner/addons in your project, with the least access it needs.' },
      { b: 'A check', span: 'addon_check draws it out of sight at its real size and hands back a picture, its errors and anything refused.' },
      { b: 'Your answer', span: 'addon_install shows it to you live, with its card.' },
      { b: 'A version at a time', span: 'It fixes what is wrong in the same add-on until what you asked for works, and stops there.' },
    ] as Row[],
  },
  keep: {
    tag: 'What you keep',
    head: 'Every version, nothing thrown away.',
    rows: [
      { b: 'Every version', span: 'Each one is kept, with where it opens, what it can touch, who made it and when.', code: 'Kept' },
      { b: 'Same access, no card', span: 'An update that asks for nothing new goes in by itself, and one that asks for more shows a new card.', code: 'Update' },
      { b: 'Remove keeps it', span: 'A removed add-on keeps its files, versions and storage, so Settings can restore it.', code: 'Restore' },
      { b: 'The draft is yours', span: 'Its source stays in .liner/addons in your project, kept out of git, to read and edit.', code: 'Draft' },
      { b: 'From someone else', span: 'Add one from GitHub, npm or a folder, DeepSeek Harness plugins included, on the same kind of card.', code: 'Add-ons' },
    ] as Row[],
  },
  try: {
    tag: 'Try one',
    head: 'Three asks Workshop suggests.',
    sub: 'These are the examples in Settings, Modes.',
    // BUILTIN_MODES' Workshop examples, contracts/src/index.ts.
    items: [
      { h: 'Add a page', ask: 'Make a notes app with a left sidebar entry that opens a full-page editor. Keep my notes between sessions. Add it, and check that the page opens.', expect: 'An app under Add-ons in the left sidebar, its page working, and what it checked.' },
      { h: 'Add a panel', ask: 'Make a panel beside my sessions that lists the TODOs in this project, so I can send one to you. Check it, then ask me to add it.', expect: 'A panel in the right panel, tried live as a preview before you add it.' },
      { h: 'Make my own mode', ask: 'Make a “Code review” mode: prioritise likely bugs and missing tests, cite files and lines, and ask before changing anything. Save it as a mode I can pick.', expect: 'A mode you pick when you start a session, still held to the access level you choose.' },
    ],
  },
};
