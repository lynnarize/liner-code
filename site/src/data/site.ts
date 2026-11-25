// Every word on the site, from the approved mockup (v2). The version comes from the repository's
// package.json and its stage (beta) from CHANGELOG.md, so a release updates them by itself.
// Pictures are named here and sized by src/data/shots.json.
// Download addresses are not: those come from the latest GitHub release (src/lib/latest-release.ts).
import pkg from '../../../package.json';
import { releases } from '../lib/changelog';
import { first } from '../lib/pick';

const all = releases();
const REPO = 'https://github.com/lynnarize/liner-code';
const VERSION: string = pkg.version;
const STAGE = all.find((r) => r.version === VERSION)?.title || 'beta';

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
  { href: '/#agents', label: 'Agents' },
  { href: '/features/', label: 'Features' },
  { href: '/changelog/', label: 'Changelog' },
];

export const hero = {
  callout: { tag: `New in ${VERSION}`, text: 'Teamwork and Swarm', href: `/changelog/#v${VERSION}` },
  faces: ['Code it.', 'Design it.', 'Secure it.'],
  lead: 'The coding agents you already have, in one desktop app, on your own sign-ins.',
  small: `Free and open source. ${VERSION} ${STAGE}.`,
  // The window's three faces and the stage behind each.
  shots: [
    { name: 'face-code', stage: 'sky', alt: 'Liner Code at work: sessions by folder in the left panel, one session mid-turn with its plan and the files it changed' },
    { name: 'face-design', stage: 'chart', alt: 'Liner Design: a canvas of frames an agent drew, one layer selected and its style in the inspector' },
    { name: 'face-security', stage: 'steel', alt: 'Liner Security: open findings, a chart of them day by day, and how many a second model confirmed' },
  ],
};

// The tools, by their key in the app's own BRANDS (ui/src/app/brands.ts).
export const tools = { say: 'Runs the agents you have', list: ['claudecode', 'codex', 'opencode', 'hermes', 'cursor', 'grok', 'antigravity'] as const, names: { claudecode: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', hermes: 'Hermes', cursor: 'Cursor', grok: 'Grok Build', antigravity: 'Antigravity' } };

// A close-up's shown width is its true width (w / scale in shots.json) times k. `fit` lets Frag choose from the
// picture's shape: a short one sits in the middle of its stage, a tall one runs off the foot.
export type Frag = { name: string; k: number; stage: string; alt: string; title: string; text: string; phone?: string; mid?: boolean; fit?: boolean };

// A home card names its pictures newest first; the first one that exists is shown, with its own words.
// Each card is a list of choices because the 0.3.2 pictures arrive after these words were written.
const card = (stage: string, ...choices: Omit<Frag, 'k' | 'stage' | 'fit'>[]): Frag => ({ ...first(choices), k: 1, stage, fit: true });

export const design = {
  id: 'design',
  tag: 'Liner Design',
  head: 'A canvas your agents draw on.',
  sub: 'Real HTML and CSS, one step from your code.',
  cards: [
    card('chart',
      { name: 'd-canvas', title: 'Say what to draw', text: 'Any agent you have draws it frame by frame while you watch.', alt: 'An agent drawing frames on the canvas' },
      { name: 'f-d-side', title: 'Say what to draw', text: 'Any agent you have draws it frame by frame while you watch.', alt: "The design's lean, its pages and its layers" }),
    card('sand', { name: 'f-d-style', title: 'Change anything by hand', text: 'Size, fill, corners and type of any layer, as in a design tool.', alt: 'The Style tab: size, fill, corners and type of the selected layer' }),
    card('sky', { name: 'f-d-checks', title: 'Checks that cost nothing', text: 'Screens checked on your machine, with no agent and no tokens.', alt: 'The Checks tab: the screens checked, with what to fix' }),
  ],
};

export const security = {
  id: 'security',
  tag: 'Liner Security',
  head: 'A security scan that only reads.',
  sub: 'Your own agent looks for holes, held to Read only.',
  cards: [
    card('steel',
      { name: 's-finding', title: 'Findings in plain words', text: 'What is wrong, who can do it, and what they get.', alt: 'The top of a finding: what is wrong, and the second look' },
      { name: 'sec-panel', title: 'Findings in plain words', text: 'What is wrong, who can do it, and what they get.', alt: 'A finding: what is wrong, who can do it, and the line of code' }),
    card('mist',
      { name: 'f-sec-second', title: 'A second look', text: 'A model from another maker rereads each finding.', alt: 'Open findings by the second look: confirmed, not confirmed, not looked at' },
      { name: 'f-sec-howfar-m', title: 'You pick how far it reads', text: 'The free checks, what this branch changed, or the whole project.', alt: 'How far a scan reads' }),
    card('sand', { name: 'f-sec-free', title: 'Free checks first', text: 'Secrets, risky packages and stray files, in seconds, with no agent.', alt: 'Free checks with no agent: secrets in tracked files, packages with known problems, files that should not be in git' }),
  ],
};

export const agents = {
  id: 'agents',
  tag: 'Liner Code',
  head: 'Agents that work as a team.',
  sub: 'Several agents in one session, and only you land their work.',
  more: { href: '/features/', label: 'Every feature' },
  cards: [
    card('mist',
      { name: 'c-team', title: 'Teamwork and Swarm', text: 'A team of agents on any tool, each writer in its own worktree.', alt: 'A team of agents at work in one session' },
      { name: 'f-c-agents', title: 'One ask, several agents', text: 'The lead sends agents out under its plan, each on a model that suits.', alt: 'A plan of four steps and three agents started under it, each with its model, tools and time' }),
    card('sand',
      { name: 'c-fusion', title: 'A lead and a sidekick', text: 'A lead plans, a quicker model works, then the lead reads the diff.', alt: 'The lead handing a brief to its sidekick' },
      { name: 'fusion', title: 'A lead and a sidekick', text: 'A lead plans, a quicker model works, then the lead reads the diff.', alt: 'A session where the lead hands one brief to its sidekick, then reads the diff it sent back' }),
    card('sky',
      { name: 'c-wall', title: 'Every live session at once', text: 'Answer, allow or settle any session from its tile on the Wall.', alt: 'A tile on the Wall waiting for a yes to run a command' },
      { name: 'wall', title: 'Every live session at once', text: 'Answer, allow or settle any session from its tile on the Wall.', alt: 'The Wall: sessions as tiles, one waiting for a yes to run npm test' }),
  ],
};

export const trust = {
  tag: 'For your security review',
  head: 'Nothing between you and your agents.',
  sub: 'Your code goes only where your own tools send it.',
  link: 'Read the threat model',
  items: [
    { dt: 'Your sign-ins', dd: 'Never seen by Liner, and every call bills your own account.' },
    { dt: 'Your machine', dd: 'The engine listens only on 127.0.0.1, behind a fresh token.' },
    { dt: 'Held to a level', dd: 'Sessions run at the level you pick, and scans at Read only.' },
    { dt: 'Signed updates', dd: 'Each Mac update is checked by SHA\u2011256 and signature first.' },
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
  free: 'Free and open source, MIT.',
};
