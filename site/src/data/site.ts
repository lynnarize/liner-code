// Every word on the site, from the approved mockup (v2), with what 0.2.9 changed. The version comes from
// the repository's package.json and its stage (beta) and dates from CHANGELOG.md, so a release updates
// them by itself. Pictures are named here and sized by src/data/shots.json.
import pkg from '../../../package.json';
import { releases, shortDate } from '../lib/changelog';

const all = releases();
const REPO = 'https://github.com/lynnarize/liner-code';
const VERSION: string = pkg.version;
const STAGE = all.find((r) => r.version === VERSION)?.title || 'beta';
const dateOf = (v: string) => shortDate(all.find((r) => r.version === v)?.date ?? '');

export const site = {
  name: 'Liner Code',
  url: 'https://linercode.dev',
  title: 'Liner Code: code it, design it, secure it',
  description:
    'A free, open-source desktop app for Mac and Windows that runs Claude Code, Codex, OpenCode and Hermes on your own sign-ins, with a canvas they draw on and a security scan that only reads.',
  version: VERSION,
  stage: STAGE,
  label: `${VERSION} ${STAGE}`,
  repo: REPO,
  latest: `${REPO}/releases/latest`,
  releases: `${REPO}/releases`,
  threat: `${REPO}/blob/main/SECURITY_MODEL.md`,
  license: `${REPO}/blob/main/LICENSE`,
};

export const nav = [
  { href: '/#design', label: 'Design' },
  { href: '/#security', label: 'Security' },
  { href: '/#code', label: 'Agents' },
  { href: '/features/', label: 'Features' },
  { href: '/#trust', label: 'Trust' },
  { href: '/changelog/', label: 'Changelog' },
];

export const hero = {
  callout: { tag: `New in ${VERSION}`, text: 'Liner Security: scans that only read', href: '#security' },
  faces: ['Code it.', 'Design it.', 'Secure it.'],
  lead: 'One desktop app for the coding agents you already have. Claude Code, Codex, OpenCode and Hermes run in it on your own sign-ins, and do more than write code.',
  small: `Free and open source. ${VERSION} ${STAGE}.`,
  // The caption over the window, one per face; the script reads them from the page.
  caps: [
    ['Liner Code', 'One ask, three agents, each on the model that suits the job.'],
    ['Liner Design', 'Your agent draws real screens on a canvas, and you change any part by hand.'],
    ['Liner Security', 'Your agent reads the code for holes, and a second model checks each finding.'],
  ],
  // The window's three faces and the stage behind each.
  shots: [
    { name: 'face-code', stage: 'sky', alt: 'Liner Code at work: sessions by folder in the left panel, each saying what it is doing, one session mid-turn with its plan and the files it changed, and a second panel open beside it' },
    { name: 'face-design', stage: 'chart', alt: 'Liner Design: a canvas with seven frames an agent drew, one text layer selected and its style in the inspector' },
    { name: 'face-security', stage: 'steel', alt: 'Liner Security: four open findings, a chart of them day by day, and how many a second model confirmed' },
  ],
};

// The tools, by their key in the app's own BRANDS (ui/src/app/brands.ts).
export const tools = { say: 'Runs the agents you have', list: ['claudecode', 'codex', 'opencode', 'hermes', 'cursor', 'grok', 'antigravity'] as const, names: { claudecode: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', hermes: 'Hermes', cursor: 'Cursor', grok: 'Grok Build', antigravity: 'Antigravity' } };

export const stats = [
  { b: '3', span: 'faces in one window: Code, Design and Security' },
  { b: '7', span: 'agent tools, plus any API endpoint, on your own sign-ins' },
  { b: '0', span: 'accounts or markup between you and your agents' },
  { b: '0.6 s', span: 'from launch to your sessions on screen' },
];

// A close-up's shown width is its true width (w / scale in shots.json) times k, the mockup's own scale.
export type Frag = { name: string; k: number; stage: string; alt: string; title: string; text: string; phone?: string; mid?: boolean };

export const design = {
  tag: 'Liner Design',
  dim: 'Not only code.',
  head: 'A canvas your agents can draw on.',
  sub: 'Every screen is real HTML and CSS, drawn by whichever agent you use, and it stays one step from your code.',
  steps: [
    { name: 'design-draw', title: 'Say what to draw.', text: 'Any agent you have draws it frame by frame, while you watch.', alt: 'An agent drawing the third frame of a tide tables app on the canvas' },
    { name: 'design-point', title: "Then point at what's wrong.", text: 'Select a layer and restyle it yourself, or tell the agent what should change, right on the part.', alt: 'A text layer selected on the canvas, with its size, fill and type in the inspector' },
    { name: 'design-check', title: 'Check it, then build it.', text: 'Build turns the frames into code in the same session, and keeps the two in step.', alt: 'The Checks tab: six screens checked in 0.2 seconds, ten things to fix' },
  ],
  cells: [
    { name: 'f-d-side', k: 1, stage: 'chart', alt: "The design's lean, its pages and its layers", title: 'A lean keeps it yours', text: 'A DESIGN.md and skills such as /awwwards steer every frame the agent draws.' },
    { name: 'f-d-style', k: 262 / 292, stage: 'sand', alt: 'The Style tab: size, fill, corners and type of the selected layer', title: 'Change anything by hand', text: 'Size, fill, corners and type of any layer, the way a design tool does it.' },
    { name: 'f-d-code', k: 262 / 292, stage: 'mist', alt: "The Code tab: the selected layer's own HTML and CSS", title: 'The layer is the code', text: "Type in the layer's HTML and CSS and it redraws. It is the layer itself, not an export." },
    { name: 'f-d-checks', k: 262 / 292, stage: 'sky', alt: 'The Checks tab: six screens checked in 0.2 seconds, with what to fix', title: 'Checks that cost nothing', text: 'Six screens checked in 0.2 s on your Mac, with no agent and no tokens.' },
  ] as Frag[],
};

export const security = {
  tag: 'Liner Security',
  dim: 'Before it ships.',
  head: 'A security scan that only reads.',
  sub: 'It points your own agent at your code and holds it to Read only. Each finding comes back in plain words: what is wrong, who can do it, and what they get.',
  shot: { name: 'sec-findings', phone: 'sec-panel', alt: 'A finding open beside the list: the station id goes into the database query as text, confirmed by a second model, with the line of code and who can do it' },
  first: [
    { name: 'f-sec-howfar', phone: 'f-sec-howfar-m', k: 770 / 880, stage: 'mist', mid: true, alt: 'How far a scan reads: the free checks only, what this branch changed, or the whole project', title: 'You pick how far it reads', text: 'The free checks, what this branch changed, or the whole project against its threat model. It says what each costs before it starts.' },
    { name: 'f-sec-second', k: 1, stage: 'steel', mid: true, alt: 'Open findings by the second look: two confirmed, one not confirmed, one not looked at', title: 'A second look from another maker', text: "A model from a different maker rereads each finding, so the two don't share blind spots." },
  ] as Frag[],
  second: [
    { name: 'f-sec-free', k: 1, stage: 'sand', mid: true, alt: 'Free checks with no agent: secrets in tracked files, packages with known problems, files that should not be in git', title: 'Free checks, no agent', text: "Secrets in tracked files, packages with known problems and files that shouldn't be in git, in seconds." },
    { name: 'f-sec-chart', k: 520 / 636, stage: 'sky', mid: true, alt: 'Open findings day by day, with a mark under each day a scan ran', title: 'It changes nothing', text: 'A scan reads and keeps count. A fix is its own session in its own worktree, started per finding, and the finding closes when the fix merges.' },
  ] as Frag[],
};

export const code = {
  tag: 'Liner Code',
  dim: 'More than one model.',
  head: 'Agents that work as a crew.',
  sub: 'Plans, asks and diffs are here as in any harness. These are the parts that are not.',
  more: { href: '/features/', label: 'Every feature' },
  fusion: { name: 'fusion', dim: 'Fusion', title: 'A lead that hands work down', text: 'A lead model plans, writes the brief for a quicker sidekick, then reads the diff that comes back.', alt: 'A session where the lead hands one brief to its sidekick, then reads the diff it sent back' },
  wall: { name: 'wall', dim: 'The Wall', title: 'Every live session, answerable', text: 'Answer a question, allow a command or settle a finished job, without opening the session.', alt: 'The Wall: five sessions as tiles, one waiting for a yes to run npm test, one at work, three done' },
  cells: [
    { name: 'f-c-agents', k: 600 / 710, stage: 'mist', mid: true, alt: 'A plan of four steps and three agents started under it, each with its model, tools and time', title: 'One ask, several agents', text: 'The lead sends agents out under its plan, each on the model that suits the job. You see who it sent and what each brought back.' },
    { name: 'f-c-session', k: 268 / 340, stage: 'sand', mid: true, alt: 'The Session card: context used, cache hit, the branch, and who works: tool, lead, sidekick, Reviewer', title: 'Who works, and what it cost', text: 'Context, cache hit, the branch, and the tool, lead, sidekick and Reviewer on this session.' },
  ] as Frag[],
  also: {
    tag: 'Also only here',
    rows: [
      { b: 'The Reviewer', span: 'A model from another maker reads each change against five fixed criteria. It never wrote it.', code: 'Code' },
      { b: 'Workshop', span: "Ask for what Liner doesn't have. An agent builds it as an add-on.", code: 'Add-ons', href: '/workshop/' },
      { b: 'Models side by side', span: 'One prompt to the models you have, with what each cost. Keep the best.', code: 'Code' },
      { b: 'Carry on', span: 'Pick up the Claude Code and Codex sessions you started in a terminal.', code: '0.2.8' },
      { b: 'See-through window', span: 'On a Mac, your desktop shows behind the app.', code: '0.2.8' },
    ],
  },
};

export const trust = {
  tag: 'For your security review',
  dim: 'No account, no markup.',
  head: 'Nothing between you and your agents.',
  sub: 'Your code and your prompts go only where your own tools send them.',
  lead: 'There is nothing to procure and nothing to host. The whole threat model is in the repository, written for the person who has to say yes.',
  link: 'Read the threat model',
  items: [
    { dt: 'Your sign-ins', dd: 'Liner never sees a sign-in and resells no tokens. Every call is billed to your own account.' },
    { dt: 'Your machine', dd: 'The app talks to its own engine on 127.0.0.1, behind a token made new on each run.' },
    { dt: 'Held to a level', dd: "Auto, Manual, Reviewer decides or Full access, and Read only for a Security scan. Even at Full access it asks before a step it can't take back." },
    { dt: 'Signed updates', dd: 'Each update is checked by SHA-256, code signature and Team ID before it is swapped in.' },
  ],
};

// One line each, written from CHANGELOG.md; the dates come from it too.
const log = [
  { v: '0.2.9', span: 'Liner Security, the third face: scans that only read, a second look, and a fix per finding. A new left panel.' },
  { v: '0.2.8', span: 'A see-through window on a Mac, a compact Home, and Carry on for work left open.' },
  { v: '0.2.7', span: "Sessions on screen in about 0.6 s. Fusion works to its sidekick's class." },
  { v: '0.2.6', span: 'Liner Design: the same session as a canvas of frames. The Antigravity CLI, in beta.' },
  { v: '0.2.5', span: 'Lead and sidekick: a session is one model or a pair.' },
  { v: '0.2.4', span: 'The first beta. The Wall: every live session as tiles you can answer.' },
];
export const shipped = {
  tag: 'Changelog',
  dim: 'Six betas this month.',
  head: 'Liner Security is the newest.',
  link: 'The whole changelog',
  rows: log.map((r) => ({ ...r, date: dateOf(r.v) })),
};

export const faq = {
  tag: 'Questions',
  dim: 'Fair questions.',
  head: 'Short answers.',
  items: [
    { q: 'Do I need an account?', a: 'No. There is no Liner account to make. You sign in to Claude Code, Codex and the others the way you already do.' },
    { q: 'What does it cost?', a: 'Nothing. Liner Code is free and MIT licensed. You pay what your own plans and keys already cost, with no markup.' },
    { q: 'Where does my code go?', a: 'Nowhere new. Your agents talk to their own makers exactly as they do in a terminal. The app itself sends one anonymous count a day (version, system and token totals), and Settings has a switch for it.' },
    { q: 'Which agents does it run?', a: 'Claude Code, Codex, OpenCode and Hermes, with Cursor, Grok Build and Antigravity in beta, and any OpenAI-compatible endpoint by its key.' },
    { q: 'Can a team use it?', a: 'Yes. It is a local app, so there is nothing to host. The threat model and the licence are in the repository for your review.' },
    { q: 'Mac and Windows?', a: 'macOS on Apple silicon and Windows x64. On a Mac it updates itself.' },
  ],
};

export const close = {
  head: 'Start with one ask.',
  mac: 'Download for macOS',
  win: 'Download for Windows',
  small: 'Free and open source, MIT. Apple silicon and Windows x64.',
};

export const footer = {
  say: 'Your coding agents, with a real app round them.',
  copy: '© 2026 Liner Code. MIT licensed.',
  links: [
    { href: REPO, label: 'GitHub' },
    { href: '/features/', label: 'Features' },
    { href: '/workshop/', label: 'Workshop' },
    { href: '/changelog/', label: 'Changelog' },
    { href: `${REPO}/blob/main/SECURITY_MODEL.md`, label: 'Threat model' },
    { href: `${REPO}/blob/main/LICENSE`, label: 'License' },
  ],
  platforms: 'macOS on Apple silicon, Windows x64. On a Mac it updates itself.',
  get: 'Download Liner Code',
};
