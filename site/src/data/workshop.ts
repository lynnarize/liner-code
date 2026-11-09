// Workshop, in the app's own words: BUILTIN_MODES and CREATE_ADDON_ASK (contracts/src/index.ts),
// the Workshop note (engine/src/creator.ts), the add-on card (ui/src/app/AddonsPage.tsx, Addon.tsx)
// and the 0.2.0 and 0.2.1 changelog.
export const workshop = {
  blurb: 'Customize Liner Code through conversation.',
  lead: "Workshop is Standard plus a guide to add-ons and a closer look at Liner Code, never more trust. Ask for what the app doesn't have, and an agent makes it.",
  kinds: [
    { name: 'Connections', where: 'Every agent tool', note: "An MCP server from a prompt: Linear, Sentry, a database. Its key goes to the keychain, and every agent gets it next to Liner Code's own tools." },
    { name: 'Panels', where: 'The right dock', note: 'A small page of its own beside a session: a viewer, an editor, something to watch while you chat.' },
    { name: 'Apps', where: 'Beside Chat, or a page', note: 'A tab beside Chat for a session’s live output, or a page of its own under Add-ons in the left sidebar, kept across projects.' },
    { name: 'Modes', where: 'Picked for a session', note: 'Instructions, with skills and context files, for whichever model a session runs. You pick it when you start one.' },
  ],
  ask: 'Create a Liner Code add-on with a left sidebar entry.',
  places: [
    { id: 'dock', label: 'Right panel', hint: 'View alongside this conversation' },
    { id: 'tab', label: 'Session tab', hint: 'Open beside Chat' },
    { id: 'page', label: 'Global page', hint: 'Open from the left sidebar' },
    { id: 'custom', label: 'Write your own', hint: 'Describe where you want it' },
  ],
  offerSteps: ['Read the add-on guide', 'Write its files', 'Checked it in a sealed frame', 'Install'],
  turn: [
    { title: 'It keeps a short to-do list', note: 'Liner Code shows it as a card you can follow, and it closes it when it is done.' },
    { title: 'It reads the look first', note: "Before any HTML or CSS it reads Liner 2.0, the app's own design skill, so what it makes reads as part of the app." },
    { title: 'It makes the full thing', note: 'In .liner/addons in your project, with the least access it needs. Not a demo: an app on a page gets its library, toolbar, empty states and autosave.' },
    { title: 'It checks it', note: 'addon_check draws it out of sight at its real size, with real data, and hands back a picture, errors and anything refused.' },
    { title: 'It asks you', note: 'addon_install shows it to you live, with its card. Nothing goes in without your answer.' },
    { title: 'It fixes, a version at a time', note: 'Until what you asked for works fully, and no extras beyond it.' },
  ],
  versions: [
    { label: 'Kept', title: 'Every version of an add-on is kept', note: 'Its page shows where it shows, what it can touch, its version, who made it and the way back.' },
    { label: 'Same', title: 'An update that touches no more goes in', note: 'Without asking. One that touches more than before asks again, on a new card.' },
    { label: 'Undo', title: 'Remove keeps its files', note: 'They stay in .liner/addons, so Restore brings it back.' },
    { label: 'Model', title: 'A model in an app', note: 'New in 0.2.1: two answers at a time and 300 a day, each app’s usage logged under it.' },
  ],
  examples: [
    { h: 'Add a page', ask: 'Make a notes app with a left sidebar entry that opens a full-page editor. Keep my notes between sessions. Add it, and check that the page opens.', expect: 'An app under Add-ons in the left sidebar, its page working, and what it checked.' },
    { h: 'Add a panel', ask: 'Make a panel beside my sessions that lists the TODOs in this project, so I can send one to you. Check it, then ask me to add it.', expect: 'A panel in the right dock, tried live as a preview before you add it.' },
    { h: 'Make my own mode', ask: 'Make a “Code review” mode: prioritise likely bugs and missing tests, cite files and lines, and ask before changing anything. Save it as a mode I can pick.', expect: 'A mode you pick when you start a session. Its instructions guide the model; Safety still decides what it may do.' },
  ],
};
