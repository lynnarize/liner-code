// Every word on the site. Facts come from the README, the changelog and the source; nothing here
// is a claim the app doesn't make about itself. Server only: the version and the files come from
// GitHub's latest release at build time (./release). 
import { release, stars } from './release';
import { longDate, shortCount } from '../lib/release';

export const VERSION = release.version;
const REPO = 'https://github.com/lynnarize/liner-code';

export const site = {
  name: 'Liner Code',
  url: 'https://linercode.dev',
  title: 'Liner Code: one app for your coding agents',
  description:
    'A free, open-source app for Mac and Windows that drives Claude Code, Codex, OpenCode and Hermes, with plans, cards and a diff for every turn.',
  version: VERSION,
  released: longDate(release.date),
  repo: REPO,
  releases: `${REPO}/releases`,
  // The repository's stars at build time, as GitHub shows them (null if GitHub didn't answer).
  stars: stars === null ? null : shortCount(stars),
  starsExact: stars,
  issues: `${REPO}/issues/new/choose`,
  mac: release.mac.url,
  win: release.win.url,
  // The hero's second button, and the download panel's when Windows is picked.
  winLabel: release.win.kind === 'setup' ? 'Windows setup' : 'Windows zip',
  winAction: release.win.kind === 'setup' ? 'Download the setup' : 'Download the zip',
  author: 'Lin',
  licence: 'MIT',
};

export const nav = [
  { href: '/#how', label: 'How it works' },
  { href: '/#features', label: 'Features' },
  { href: '/workshop/', label: 'Workshop' },
  { href: '/changelog/', label: 'Changelog' },
];

export const hero = {
  title: 'One app for your coding agents',
  lead: 'Run Claude Code, Codex, OpenCode and Hermes together. One plans, one builds, another checks.',
  // {v} is the version, kept in its own element so the browser can bring it up to date.
  note: 'Free and open source. Version {v}, a beta, for Apple Silicon Macs and Windows.',
  hint: { fine: 'Click the code to send a turn.', touch: 'Tap the code to send a turn.' },
};

// The app itself, lying on the sea in the hero: Liner Code 0.2.5 with the Demo on its sample project
// (scripts/demo-shots.mjs).
export const home = {
  alt: 'Liner Code, six seconds into a turn that sent three agents off. In the session: the plan, then Started 3 agents, 1 done and 2 working, and Stop agents over the composer. Beside it the Agents panel: who is on it as a tree, a timeline with a bar for each agent, the tasks, and the session in numbers.',
};

// One turn in two steps, each said in a line beside a picture of the app.
export const steps = [
  { title: 'Waits for your yes', text: 'You read the steps and the files first. Approve the plan, or edit it.',
    alt: "The same session with its plan: Wrap round to tomorrow's first high tide, three steps in one file, a box to say what to change, and Edit steps and Approve and start. Nothing runs until you approve." },
  { title: 'Has another maker check it', text: "A model from another maker reads each change against five fixed criteria. What it blocks goes back before it's yours.",
    alt: "Settings, Agentic features, The Reviewer: it reads each change before it's yours and sends back what must be fixed. Read each change is on, and GPT Astra reads what Opus 5.5 and its sidekick change. Who reads: best from another maker than the pair's. Rounds before it's yours, set to 2." },
];

// Everything around the session, a picture of the app and a line each (scripts/demo-shots.mjs).
export const around = {
  wall: {
    title: 'Shows every session on one wall', text: 'Approve, answer or steer each one from its tile. What waits on you comes first.',
    alt: 'The Wall with six sessions as tiles. One needs you: it has a plan for you, with Read the plan. Five are done, each with its answer in brief and Settle.',
  },
  crew: {
    title: 'Shows who sent whom', text: 'When a model sends agents off, see what each is doing, and stop any one.',
    alt: 'Four seconds into a turn that sent three agents off: the plan, then Started 3 agents, 1 done and 2 working. Explore, on Haiku 5.5, is reading src/tides.test.js. The Test runner is done: 1 test, 1 passed. The Subagent, on Sonnet 5.5, is fetching tidesandcurrents.noaa.gov. Over the composer: Stop agents.',
  },
  sidekick: {
    title: 'Hands the routine work to a sidekick', text: 'Your best model leads. It hands the edits and test runs to a quicker one, then reads what came back.',
    alt: 'A session run by a pair. The lead reads a file and says the fix is mechanical, so it hands it to the sidekick. Under it: Handed 1 brief to its sidekick, and the sidekick done in 5.8 seconds, Changed tides.js, plus 3 minus 1, measured. Then the lead: I read its diff, and the tests pass.',
  },
  design: {
    title: 'Draws the screen beside the session', text: 'Ask any agent for a screen. The Browser, Terminal, Files and Diff open beside it the same way.',
    alt: "The Design surface beside a session, showing the phone screen an agent drew: Today's tides, the next high tide at 21:52, and its curve.",
  },
  addons: {
    title: 'Makes the add-ons it lacks', text: "Say what you'd like, and an agent makes it in Workshop. Nothing goes in until you say yes.",
    alt: 'The Add-ons page with nothing added yet: say what you would like and an agent makes it in Workshop, with Make one with an agent, and From GitHub, npm or a folder.',
  },
};

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

// The surfaces beside a session, with their keys (ui/src/app/Surfaces.tsx: ⌘⇧ and the letter).
export const surfaces = [
  { key: 'B', name: 'Browser', note: 'Your app on localhost beside the session, with its console, and an element you pick goes to the agent.' },
  { key: 'E', name: 'Design', note: 'Ask any agent for a screen and it draws it here: desktop, tablet, phone, every version kept.' },
  { key: 'T', name: 'Terminal', note: "The session's own shell, in its folder, with full-screen programs on a Mac." },
  { key: 'F', name: 'Files', note: 'The project as it is now, read beside the conversation instead of in another window.' },
  { key: 'D', name: 'Diff', note: 'Every turn as a diff: undo it, commit it, or ask about a line.' },
  { key: 'P', name: 'Pull request', note: 'Open one from the session through your own gh sign-in, and follow it from there.' },
  { key: 'M', name: 'Device', note: 'The iOS Simulator beside the session, for apps that run on a phone.' },
];

export const data = {
  title: 'Nothing in between',
  short: 'No server, no telemetry. Each tool talks straight to its own provider.',
  lead: 'Model traffic goes from each tool to its own provider and is billed to your account. Liner Code has no server, no telemetry and no analytics.',
  facts: [
    { title: 'Sign-ins stay with each tool', note: 'It asks only whether you are signed in.' },
    { title: 'Keys go to the keychain', note: 'Sealed there, and handed to the tool in memory.' },
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
    id: 'modes', name: 'Pair', tag: 'Lead and sidekick',
    title: 'Run a session on one model or a pair, and pick who checks each change.',
    items: [
      { label: 'Pair', title: 'A lead and its sidekick', note: 'The lead talks to you, plans and decides. It hands bounded work to a quicker model beside it: an edit it can spell out, the same change in many files, a slow test run.' },
      { label: 'Best', title: 'The lead alone', note: 'Your strongest model does all of it.' },
      { label: 'Fast', title: 'The sidekick alone', note: 'The quicker model does all of it, for small jobs.' },
      { label: 'Reviewer', title: 'Reads each change', note: "A model from another maker than the pair's reads each change and sends back what must be fixed." },
    ],
    pic: { src: '/media/app-agentic.jpg', w: 1800, h: 1125, alt: 'Settings, Agentic features: your pair, with the lead and its sidekick, and the Reviewer.', cap: 'Settings, Agentic features.' },
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

// New in 0.2.4, the first beta: cards in "Everything around the session", each with the app's own
// parts drawn at their size (Wall.tsx, Crew.tsx, Browser.tsx, AddonsPage.tsx), in their words.
// The facts are the 0.2.4 changelog's; the sessions are the Demo's tide project.
export const news = {
  since: 'New in 0.2.4',
  wall: {
    title: 'The Wall',
    text: "Every live session at once, as tiles you can answer from. What waits on you comes first, then what's working, then what's done.",
    aside: 'Allow a request or say no, pick an answer, steer one at work, retry or settle, from its tile. 1 to 9 open a tile, Esc goes back.',
    alt: 'The Wall with three sessions. Nightly invoice export needs you: it wants to run npm run export, with Not this and Run it. Add a weekly tide chart is working, running npm test. Fix the tide time after midnight is done, with its answer in brief, the two files it changed and Verified.',
    tiles: [
      {
        kind: 'needs', title: 'Nightly invoice export', state: 'Needs you · 2m', sub: 'ledger-api · Claude Code · Sonnet 5.5',
        steps: [['Read', 'export.ts', '1.2s'], ['Edited', 'export.ts', '+18 −2']],
        ask: { lead: 'Wants to run', cmd: 'npm run export -- --dry-run' },
        field: 'Or tell it what to do instead',
      },
      {
        kind: 'working', title: 'Add a weekly tide chart', state: 'Working · 4m', sub: 'tidewater · Codex · GPT Astra',
        steps: [['Searched', 'weekly', '3 matches'], ['Read', 'chart.js', '0.9s'], ['Edited', 'chart.js', '+24 −3'], ['Read', 'tides.js', '0.6s'], ['Edited', 'chart.test.js', '+31'], ['Running', 'npm test', '']],
        foot: '7 steps this turn',
      },
      {
        kind: 'done', title: 'Fix the tide time after midnight', state: 'Done · 12m', sub: 'tidewater · Claude Code · Opus 5.5',
        lead: "Past the last high tide, it wraps round to tomorrow's first.",
        points: ['Marked as tomorrow, so the label can say so.', 'A test for a time after the last high tide passes.'],
        files: [['tides.js', 'src', '+3', '−1'], ['tides.test.js', 'src', '+12', '']],
        foot: ['+15', '−1', '2 files'],
      },
    ],
  },
  crew: {
    title: 'Who sent whom',
    text: "When a model sends agents off, they fan out under its work: what each was sent to do, what it's doing now, its model, tokens and time, then what it sent back. The header says who leads and how many work for it; the Agents surface (⌘⇧A) shows the crew as a tree, a timeline and the tasks. Stop one, and the turn goes on.",
    tools: [
      { name: 'Claude Code', note: 'Its agents show their steps, model, tokens and report as they work. A word for one goes to the model that sent it.' },
      { name: 'Codex', note: "Each agent's own thread, step by step, and a word for one goes straight to it." },
      { name: 'Hermes', note: 'A row per delegated task, with its goal, role, model and report; ACP can’t show its steps live.' },
      { name: 'OpenCode', note: 'Subagents stay off: its ACP drops their permission requests, so they’d get past your access level.' },
    ],
    alt: 'A session where Sonnet 5.5 sent three agents. The header reads Sonnet 5.5 plus 3 agents. Under its work: Started 3 agents, 1 done and 2 working. The Test runner is done: 1 test, 1 passed. Explore, on Haiku 5.5, is reading src/tides.test.js; the Subagent, on Sonnet 5.5, is fetching tidesandcurrents.noaa.gov. Over the box: Sonnet 5.5 is waiting on 2 agents, and Stop agents.',
    session: 'Spring tide alert',
    lead: 'Sonnet 5.5',
    ask: 'Add an alert for spring tides. Send agents to look, test and write fixtures at once.',
    agents: [
      { kind: 'explore', name: 'Explore', task: 'Find where tide heights are parsed', model: 'Haiku 5.5', now: 'Read src/tides.test.js', stats: '3 tools · 7.4k · 6.1s' },
      { kind: 'test', name: 'Test runner', done: "1 test, 1 passed. Nothing covers a day's range yet.", time: '2.7s' },
      { kind: 'sub', name: 'Subagent', task: 'Write spring-tide fixtures', model: 'Sonnet 5.5', now: 'Fetch tidesandcurrents.noaa.gov', stats: '2 tools · 4.6k · 4.4s' },
    ],
    strip: { waiting: 'Sonnet 5.5 is waiting on 2 agents', doing: 'Explore is reading src/tides.test.js' },
  },
  servers: {
    title: 'Dev servers from launch.json',
    text: "The servers in .claude/launch.json, the file Claude Code reads, are each a press from running in the Browser. Agents start them too, with server_start, and they stop by themselves, as Claude Code's do, once nothing in their folder has been on screen or working for half an hour.",
    alt: 'An agent started web, on localhost:5173. Under it, the Browser lists the dev servers from .claude/launch.json: web running on 5173 with restart and stop, storybook stopped while you were away, and api ready to run.',
    step: ['Started', 'web', 'localhost:5173'],
    rows: [
      { name: 'web', port: '5173', on: true },
      { name: 'storybook', port: '6006', note: 'Stopped while you were away' },
      { name: 'api', port: '8787' },
    ],
    foot: 'Run a server to preview your app, or enter an address. Edit this list in .claude/launch.json.',
  },
  plugins: {
    title: 'DeepSeek Harness plugins',
    text: "Type a plugin's npm name in Add add-on, and it comes in as a page, a dock panel or a tab, with the tools it names for your agents. Its program runs in a process of its own, under a sandbox on a Mac (not on Windows), and as you either way, so its card asks you to trust where it's from.",
    alt: "The card for a DeepSeek Harness plugin from npm: Media Desk, a page of its own. Plugin dsh-media-desk 2.6.2. Its program runs as you, in a process of its own, and a sandbox keeps it from your keys, your sign-ins, Liner Code's state and other apps. It goes under Add-ons, in the left sidebar. Not this, or Hold to allow.",
    from: 'An add-on from npmjs.com/package/dsh-media-desk',
    name: 'Media Desk, a page of its own',
    ask: 'A DeepSeek Harness plugin with a program of its own',
    fields: [
      ['Plugin', 'dsh-media-desk 2.6.2'],
      ['Program', "Runs as you, in a process of its own. A sandbox keeps it from your keys, your sign-ins, Liner Code's state and other apps."],
      ['Where', 'Under Add-ons, in the left sidebar'],
    ],
  },
};

export const download = {
  close: ['Stand in', 'the middle.'],
  after: 'Open it, connect your tools, add a project.',
  mac: {
    label: 'Mac', file: release.mac.file, needs: 'Apple Silicon, tried on macOS 27', short: 'Apple Silicon · DMG',
    first: 'Not notarized yet. The first time, press Open Anyway in System Settings, Privacy & Security, or run:',
    command: 'xattr -dr com.apple.quarantine "/Applications/Liner Code.app"',
    after: 'After that it updates itself.',
  },
  // Since 0.2.2 Windows has a setup; the zip stays, to run it without installing.
  win: release.win.kind === 'setup'
    ? {
        label: 'Windows', file: release.win.file, needs: 'x64, installs for you alone, no administrator', short: 'x64 · Setup',
        first: 'Not signed yet. SmartScreen asks once: More info, then Run anyway.',
        command: '',
        after: 'No auto-update yet: run the next setup over it.',
        zip: release.win.zip,
      }
    : {
        label: 'Windows', file: release.win.file, needs: 'x64, unzip it anywhere', short: 'x64 · Zip',
        first: 'Not signed yet. SmartScreen asks once: More info, then Run anyway.',
        command: 'Liner Code.exe',
        after: "It doesn't update itself yet: download the next zip.",
        zip: undefined,
      },
};

export const footer = {
  statement: 'Made in the open by Lin, from ideas in T3 Code and Hermes Agent.',
  legal: "No code was copied from either. Tool and model names belong to their owners; Liner Code isn't made or endorsed by any of them. MIT licence.",
};
