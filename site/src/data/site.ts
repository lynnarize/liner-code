// Every word on the site. Facts come from the README, the changelog and the source; nothing here
// is a claim the app doesn't make about itself.
export const VERSION = '0.2.1';
const REPO = 'https://github.com/lynnarize/liner-code';

export const site = {
  name: 'Liner Code',
  url: 'https://linercode.dev',
  title: 'Liner Code: a home for the coding agents you already use',
  description:
    'A free, open-source app for Mac and Windows that drives Claude Code, Codex, OpenCode and Hermes, with plans, cards and a diff for every turn.',
  version: VERSION,
  released: '4 November 2026',
  repo: REPO,
  releases: `${REPO}/releases`,
  issues: `${REPO}/issues/new/choose`,
  mac: `${REPO}/releases/download/v${VERSION}/Liner-Code-${VERSION}-mac-arm64.dmg`,
  win: `${REPO}/releases/download/v${VERSION}/Liner-Code-${VERSION}-win-x64.zip`,
  author: 'Lin',
  licence: 'MIT',
};

export const nav = [
  { href: '/#features', label: 'Features' },
  { href: '/#auto', label: 'Auto' },
  { href: '/workshop/', label: 'Workshop' },
  { href: '/changelog/', label: 'Changelog' },
];

export const hero = {
  lead: 'A home for the coding agents you already use.',
  note: `Free and open source. Version ${VERSION}, an alpha, for Apple Silicon Macs and Windows.`,
  hint: { fine: 'Click the code to send a turn.', touch: 'Tap the code to send a turn.' },
};

// The app at work, under the sea in the hero (and above the statement without WebGL or motion).
export const home = {
  alt: "Liner Code in dark mode, at work on Fix the tide time after midnight: Sonnet 5.5 on a second turn with two helper agents exploring the code, the Reviewer's Verified verdict on the first, and the Changes panel open on src/tides.js, three lines added and one removed.",
};

export const intro =
  'It runs Claude Code, Codex, OpenCode and Hermes with your own sign-ins, and shows their work as plans you approve and questions you answer.';

// One turn of the Demo's tide app, as the app shows it. Wording from the app and the Demo.
export const turn = {
  ask: 'Fix the tide time after midnight',
  question: {
    title: 'After the last high tide of the day, what should it show?',
    note: 'Past midnight',
    options: [
      { title: "Tomorrow's first high tide", note: 'Marked as tomorrow, so the label can say so.', suggested: true },
      { title: 'Nothing until the next table loads', note: 'The simplest, but the card goes blank at night.' },
      { title: 'The last high tide that passed', note: 'Never blank, but it can look like an error.' },
    ],
  },
  plan: {
    title: "Wrap round to tomorrow's first high tide",
    steps: [
      { title: 'Fall back to the first high tide of the list when none is left today', file: 'tides.js' },
      { title: 'Mark it as tomorrow so the label can say so', file: 'tides.js' },
      { title: 'Add a test for a time after the last high tide', file: 'tides.test.js' },
      { title: 'Run npm test' },
    ],
  },
  diff: {
    file: 'src/tides.js',
    lines: [
      { n: 3, t: '  for (const t of times) {', k: ' ' },
      { n: 4, t: '    if (t.kind === "high" && t.at > from) return t;', k: ' ' },
      { n: 5, t: '  }', k: ' ' },
      { n: 6, t: '  return null;', k: '-' },
      { n: 6, t: "  // Past the last high tide: wrap round to tomorrow's first one.", k: '+' },
      { n: 7, t: '  const first = times.find((t) => t.kind === "high");', k: '+' },
      { n: 8, t: '  return first ? { ...first, tomorrow: true } : null;', k: '+' },
      { n: 9, t: '}', k: ' ' },
    ],
  },
};

// Auto, with Claude Code, Codex and OpenCode Go signed in: the cast castOf() picks from them.
export const autoCast = {
  everyday: 'DeepSeek V4.1 Flash',
  strong: 'Opus 5.5',
  judge: 'Opus 5.5',
  critics: ['GPT Astra', 'DeepSeek V4.1 Flash'],
};
export const autoExamples = [
  'Why does the build fail on Windows?',
  'Fix the typo in the onboarding title',
  'Refactor the cache layer so a phone that changes time zone never shows yesterday',
  'Migrate auth to the new session schema across every service',
];

// The surfaces beside a session, with their keys (ui/src/app/Surfaces.tsx: ⌘⇧ and the letter).
export const surfaces = [
  { key: 'B', name: 'Browser', note: 'Your app on localhost beside the session, with its console, and an element you pick goes to the agent.' },
  { key: 'E', name: 'Design', note: 'Ask any agent for a screen and it draws it here: desktop, tablet, phone, every version kept.' },
  { key: 'T', name: 'Terminal', note: "The session's own shell, in its folder, with full-screen programs on a Mac." },
  { key: 'F', name: 'Files', note: 'The project as it is now, read beside the conversation instead of in another window.' },
  { key: 'D', name: 'Diff', note: 'Every turn as a diff: undo it, commit it, or ask about a line.' },
  { key: 'P', name: 'Pull request', note: 'Open one from the session through your own gh sign-in, and follow it from there.' },
  { key: 'M', name: 'Device', note: 'The iOS Simulator beside the session, for apps that run on a phone.' },
  { key: 'R', name: 'Routines', note: 'Work that runs on a schedule, or when a pull request comes in.' },
];

export const data = {
  title: 'Nothing in between',
  lead: 'Model traffic goes from each tool to its own provider and is billed to your account. Liner Code has no server, no telemetry and no analytics.',
  facts: [
    { title: 'Sign-ins stay with each tool', note: 'It asks only whether you are signed in, and "Sign in" opens the tool\'s own login.' },
    { title: 'Keys go to the keychain', note: "An API key you add is sealed in this Mac's keychain and handed to the tool in memory." },
    { title: 'Everything else is on this Mac', note: 'Sessions, snapshots and settings live in ~/.liner-code.' },
  ],
  commands: ['claude auth status', 'codex login status'],
};

// Features beside the session, each with a real picture of the app. Wording from the README,
// the changelog and the app's own labels.
export const features = [
  {
    id: 'desk', name: 'The Desk', tag: 'Every session',
    title: 'Sessions sort themselves by what they need from you.',
    items: [
      { label: 'Back', title: 'Back with you', note: 'A plan to read, a question, a change to review: what waits on you comes first.' },
      { label: 'Out', title: 'Out with agents', note: 'What is working now, and which model has it.' },
      { label: 'Case', title: 'Press what waits', note: 'The case for it: the checks, the Reviewer, what changed, and one press to decide.' },
      { label: 'Done', title: 'Done', note: 'Finished work, committed or not yet.' },
    ],
    pic: { src: '/media/app-desk.jpg', w: 1800, h: 1125, alt: 'Home with the Desk open: one session back with you, the tide fix with one file to review, and the tide screen design done.', cap: 'The Desk.' },
  },
  {
    id: 'design', name: 'Designs', tag: '\u2318\u21e7E',
    title: 'Ask any agent for a screen, and it draws it beside the session.',
    items: [
      { label: 'Draw', title: 'With every agent', note: 'Claude Code, Codex, OpenCode, Hermes, any ACP agent or an API endpoint draws one HTML file.' },
      { label: 'Look', title: 'Desktop, tablet and phone', note: 'Live or any version, its code, light or dark. Every time it is shown, it is kept.' },
      { label: 'Point', title: 'Comment on a part', note: 'Pick any element and say what should change; the agent edits the file and shows the next version.' },
      { label: 'Build', title: 'Build it', note: "The agent makes it for real with the project's own components, and never in your diff." },
    ],
    pic: { src: '/media/app-design.jpg', w: 1800, h: 1125, alt: 'A session that asked for a home screen for the tide tables, with the Design surface beside it showing the phone screen: the next high tide at 21:52, its curve and today’s tides.', cap: 'The Design surface beside a session.' },
  },
  {
    id: 'modes', name: 'Modes', tag: 'Solo, Plan, Auto',
    title: 'Pick how a session works, and who checks each change.',
    items: [
      { label: 'Solo', title: 'One model in one loop', note: 'It reads, answers and edits as you allow. Pick any model, or one of your agents.' },
      { label: 'Plan', title: 'Plan, then build', note: 'Most messages go straight to the builder; a hard job goes to the frontier model first, which reads and plans.' },
      { label: 'Auto', title: 'Least work per message', note: 'Each message is weighed on your Mac at no cost: light work to the cheaper model, a hard one to the frontier model with a critic.' },
      { label: 'Check', title: 'After each change', note: 'Check by another maker, Refine by the frontier model, or Off.' },
    ],
    pic: { src: '/media/app-agentic.jpg', w: 1800, h: 1125, alt: 'Settings, Agentic features: Solo, Plan then build and Auto, each with the models it uses, and below them the frontier and cheaper models.', cap: 'Settings, Agentic features.' },
  },
  {
    id: 'addons', name: 'Add-ons', tag: 'Workshop',
    title: "Ask for what Liner Code doesn't have, and an agent makes it.",
    items: [
      { label: 'Connect', title: 'Connections', note: 'An MCP server from a prompt; its key goes to the keychain and every agent gets it.' },
      { label: 'Make', title: 'Panels and apps', note: 'A page of its own in a sealed frame, in the dock, beside Chat or in the sidebar.' },
      { label: 'Allow', title: 'A card first', note: 'It shows what the add-on can touch, and nothing is added until you say yes.' },
      { label: 'Ask', title: 'A model in an app', note: 'New in 0.2.1: an add-on can ask one of your models, picked and allowed in the app.' },
    ],
    more: { href: '/workshop/', label: 'How Workshop makes them' },
    pic: { src: '/media/app-addons-page.jpg', w: 1800, h: 1125, alt: 'The Add-ons page with nothing added yet: say what you would like and an agent makes it in Workshop, with Make one with an agent and From GitHub or a folder.', cap: 'The Add-ons page, before anything is added.' },
  },
];

export const download = {
  close: ['Stand in', 'the middle.'],
  after: 'Open it, connect the tools you have, add a project, and pick how you will work: Solo, Plan then build, or Auto.',
  mac: {
    label: 'Mac', file: `Liner-Code-${VERSION}-mac-arm64.dmg`, needs: 'Apple Silicon, tried on macOS 27',
    first: "The alpha isn't notarized yet. The first time, open System Settings, Privacy & Security, and press Open Anyway, or run:",
    command: 'xattr -dr com.apple.quarantine "/Applications/Liner Code.app"',
    after: 'After that it updates itself.',
  },
  win: {
    label: 'Windows', file: `Liner-Code-${VERSION}-win-x64.zip`, needs: 'x64, unzip it anywhere',
    first: "It isn't signed yet, so SmartScreen asks the first time: More info, then Run anyway.",
    command: 'Liner Code.exe',
    after: "It doesn't update itself yet: download the next zip.",
  },
};

export const footer = {
  statement: 'Made in the open by Lin, from ideas in T3 Code and Hermes Agent.',
  legal: "No code was copied from either. Tool and model names belong to their owners; Liner Code isn't made or endorsed by any of them. MIT licence.",
};
