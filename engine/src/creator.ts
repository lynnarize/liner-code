/*
  Creator mode: a session that adds to Liner Code itself, through conversation (DeepSeek Harness's
  Creator mode, its `cordis` preset). It's Standard plus a guide and deeper reading, never more
  trust: what it makes still goes in only on a card you answer, sealed in its frame with the access
  it lists (addons.ts, panels.ts).

  The guide comes a little at a time. The session starts knowing the short catalogue below (what it
  can make, the order to work in, what to report); the rest it reads when it needs it, as
  liner_inspect topics: the panel bridge's calls, the places, the manifest, the theme's tokens, a
  starter for each kind, how to check its work, and what's installed now with manifests and files.
*/
import { join } from "node:path";
import type { AddonInfo, AgentProfile, Thread } from "../../contracts/src/index.ts";
import { PANEL_ICONS } from "../../contracts/src/index.ts";
import { ADDON_DIR, STORAGE_MAX, type Addons } from "./addons.ts";
import { briefOf } from "./agents.ts";
import { CHECK_THEME } from "./panels.ts";

/** The topics liner_inspect reads, each a part of the creator's guide. */
export const TOPICS = ["catalogue", "connections", "panels", "manifest", "places", "bridge", "theme", "starters", "verify", "installed"] as const;
export type Topic = (typeof TOPICS)[number];

/**
  What a Creator session is told from its first turn: the catalogue, the order to work in, and where
  the rest is. Kept short, as DeepSeek Harness keeps creator text out of every turn: the procedure
  is its cordis-plugin-development skill's, the detail is read a part at a time.
*/
export function creatorNote(n: (tool: string) => string) {
  return [
    "## Creator mode",
    "",
    "This session adds to Liner Code itself: the person describes something they'd like in the app they're using, and you make it as an add-on. What you can make:",
    "- a connection: an MCP server every agent tool in Liner Code gets (Linear, Sentry, a database);",
    "- a panel: a small page of your own in the right dock, beside a session (a viewer, an editor, something to watch while chatting);",
    "- an app: a panel as a tab beside Chat in a session (its live output or interaction), or as a page of its own opened from Apps in the left sidebar (something global, kept across projects). A visual request that names no other place means an add-on in Liner Code, not an HTML file;",
    `- a mode: instructions (with skills and context files) for whichever model a session runs, which the person picks when they start one. Work it out with them, then ask with ${n("mode_add")}.`,
    "",
    `Knowledge, in this order: ${n("liner_inspect")} with a topic reads one part of the guide ("panels" step by step, "places" which place fits, "manifest" every key, "bridge" each window.liner call and the access it needs, "theme" the tokens, "starters" a copyable start for each kind, "verify" how to check it, "installed" what's there now with manifests and file paths, "connections"); then the files of an installed add-on that "installed" names. Read only the topics this task needs.`,
    "",
    "When the person asks you to design or review, report what you'd do or what you found: write and install nothing unless they ask.",
    "",
    "Otherwise, deliver a working add-on first:",
    "1. Keep a short to-do list with your plan or to-do tool: Liner Code shows it as a card the person follows. Close it when you're done.",
    `2. Make a small first version in ${ADDON_DIR}/<id>/ in this folder, with the least access it needs and sensible looks. No preview pages, mock-ups or variants first: the add-on itself is the preview.`,
    `3. ${n("addon_check")} it: it draws it out of sight at its real size, with real data, and returns a picture, errors and anything refused. Fix what it shows.`,
    `4. ${n("addon_install")} it. The person sees it live and answers its card: nothing goes in without that. The result says whether it's live.`,
    "5. Fix what's wrong in the same add-on, a version at a time (the same access goes in without a card). Stop when what was asked works: no speculative extras.",
    "",
    `Finish with where it opens, what you checked and what you couldn't, and what's saved (the draft in ${ADDON_DIR}/<id>/) against what's live (added or not, which version). You add to Liner Code only through these tools: never edit Liner Code's own files or settings.`,
  ].join("\n");
}

/**
  What a session's mode adds to what its agent is told (Thread.mode): Creator mode's guide (only
  where Liner Code's tools come with it), or a custom mode's instructions, skills and context, one of
  your named agents' laid over whichever model the session runs. Standard adds nothing. Set once, so
  the prompt stays the same turn to turn.
*/
export function modeNote(t: Pick<Thread, "mode" | "agent">, agents: AgentProfile[], cwd: string, n: (tool: string) => string, tools: boolean) {
  if (t.mode === "creator") return tools ? creatorNote(n) : "";
  if (!t.mode?.startsWith("agent:")) return "";
  const a = agents.find((x) => `agent:${x.id}` === t.mode);
  // The session's own agent brings its brief already.
  if (!a || a.id === t.agent) return "";
  const brief = briefOf(a, cwd);
  return brief ? `## Mode: ${a.name}\n\n${brief}` : "";
}

const CONNECTIONS = `Connections
A connection is an MCP server Liner Code hands to every agent tool it runs, next to its own liner server. Settings, not code: each tool starts the server itself.
1. Find the service's own MCP server: a hosted address (streamable HTTP), or a command that runs it on this Mac (npx, uvx, a program).
2. Write ${ADDON_DIR}/<id>/addon.json (see "starters").
3. Call addon_install with the id. applied: its tools are in this session now; saved, starts in the next turn: they arrive with the next turn; denied: don't ask again unless they do.
Keys are never written in a manifest: name each in secrets, and \${NAME} in a header or env value stands for it. The person types it on the card, and it's sealed in the keychain. args can't carry a secret, nor an address. A server that signs in through a browser (OAuth) can't be a connection yet.`;

const PANELS = `Panels, step by step
1. Pick its place ("places"), and the least access it needs ("manifest").
2. Write ${ADDON_DIR}/<id>/addon.json and its files beside it: index.html, and any .js, .css, .json, .svg or pictures it links by a relative path. Up to 40 files and 2 MB; html, js, css, json, svg, png, jpg, gif, webp, txt, md only; no links, nothing hidden. Nothing from a CDN: the frame can't reach one, so libraries go in its own files.
3. In its scripts, window.liner is the only way to Liner Code ("bridge"). Draw with the theme's tokens ("theme").
4. addon_check it, fix what's off, check again ("verify").
5. addon_install it. A dock panel opens as a preview beside its card; a tab or a page shows in the dock too while the card is up. After the yes, a dock panel stays in the dock, a tab shows beside Chat in its project's sessions, and a page gets an entry under Apps in the left sidebar.
6. To change it, edit the draft and addon_install again.`;

function manifest() {
  return `The panel manifest (addon.json), version 1. Only these keys; every problem is said at once.
{
  "apiVersion": 1,                 required, 1
  "id": "notes",                   2 to 40 of a-z, 0-9 and -, a letter first, not ending with -; not liner…
  "kind": "panel",
  "name": "Notes",                 up to 60 characters
  "description": "…",             optional, up to 300
  "place": "page",                 "dock", "tab" or "page" ("places")
  "entry": "index.html",           optional, index.html when left out: an .html file beside it, or one folder down
  "icon": "notes",                 optional: ${PANEL_ICONS.join(", ")}
  "access": {                      each left out unless it needs it
    "files": "project",            read the session's project files (not hidden ones, not outside it)
    "sessions": "this" | "all",    the session it's beside (title, changes, commands), or every session's titles and changes
    "composer": true,              put text in the composer, for the person to send
    "storage": 256,                KB of storage of its own, up to ${STORAGE_MAX}, kept across versions and removal
    "network": "api.example.com"   one host over https; the person holds a button to allow it
  }
}
A page has no session beside it: only sessions "all", storage and network.
Asking for more than the version in use (a new kind of access, more storage, another host) means the person is asked again.`;
}

const PLACES = `Places: which one fits
- "dock": the right dock, beside a session, a tab among Liner Code's own surfaces (Browser, Terminal, Files…). For something to look at or edit while the conversation goes on: a viewer, an editor, a live log to watch. It knows the session it's beside.
- "tab": a tab beside Chat in each session of its project. For a session's own output or interaction, in place of the conversation while it's up: test runs, a task board. It knows its session.
- "page": a page of its own, opened from Apps at the top of the left sidebar, in the conversation's place, with a way back. For something global, kept across projects: notes, a log, a checklist. It has no session beside it.
Default by scope first: global goes on a page; tied to a session, watched while chatting goes in the dock, the session's own output or interaction goes in a tab. When the person names a place, use theirs. The person can open any of them in the dock too.`;

function bridge() {
  return `window.liner: the panel bridge, apiVersion 1
The frame is sealed (an opaque origin, a content policy with no network but the one host it lists, no popups, forms or navigation). window.liner is its only way to Liner Code; each call goes to the engine, which answers only what its access allows, and refuses the rest with an error saying what's missing.
Every call returns a promise:
- liner.files.list(dir?) → ["src/a.js", …]                      access.files
- liner.files.read(path) → { path, size, text }                   access.files (not hidden files, nothing outside the project)
- liner.files.search(["TODO", "FIXME"], { ignoreCase, limit }) → [{ path, line, text }]   access.files; plain words, not patterns
- liner.session.info() → { id, title, status, turns, project, branch, updatedAt, changes: [{ path, added, removed }] }   access.sessions; not on a page
- liner.session.commands() → [{ title, command, status, output, seconds, at, turn }]   access.sessions; not on a page
- liner.sessions.list() → [{ id, title, project, status, updatedAt, files, added, removed }]   access.sessions "all"
- liner.composer.put(text)                                         access.composer; lands in the composer for the person to send; not on a page
- liner.storage.get(key), .set(key, value), .remove(key), .keys()  access.storage; JSON values, within its quota
- liner.call("context") → { apiVersion, place, access }            always
Also: liner.apiVersion (1), liner.place, liner.access, liner.theme (the tokens as it opened), and liner.on(event, fn) → off: "theme" when the colours change (they're applied for you), "session" when the session moves on.
What it reports by itself: an error it didn't catch takes it off the screen and shows the person a card with the error (so catch what you expect), and a request the content policy blocked shows a notice naming the host.
Under it, a call is a postMessage { liner: 1, id, method, args } to its parent, answered { liner: 1, id, ok, value | error }; use window.liner rather than that.`;
}

function theme() {
  return `The theme's tokens
The frame gets the app's colours and fonts as CSS variables on :root, and follows light and dark while it's open. Draw with these, never fixed colours:
${Object.entries(CHECK_THEME)
  .map(([k, v]) => `- var(${k})  ${({ "--bg": "the window's ground", "--surface": "the panel's own ground (its body is this already)", "--ink": "text", "--ink-2": "quieter text", "--ink-3": "quietest text: labels, counts", "--line": "hairlines and borders", "--accent": "the one accent: what's on, links", "--font": "the app's type", "--font-mono": "code and paths" } as Record<string, string>)[k] ?? ""} (light: ${v})`)
  .join("\n")}
Its body starts with no margin, the surface behind it, ink on it, 13.5px/1.55 in the app's type. For a tint, mix: color-mix(in oklch, var(--ink) 6%, transparent). Keep it quiet like the rest of the app: no shadows or gradients of its own, 13 to 14 px text, 8 to 14 px corners, an empty state when there's nothing to show.`;
}

const STARTERS = `Starters: copy one and change it

A connection (${ADDON_DIR}/linear/addon.json):
{ "apiVersion": 1, "id": "linear", "kind": "connection", "name": "Linear", "description": "Issues in Linear",
  "server": { "http": { "url": "https://mcp.linear.app/mcp", "headers": { "Authorization": "Bearer \${LINEAR_API_KEY}" } } },
  "secrets": [{ "name": "LINEAR_API_KEY", "label": "Linear key" }] }

A dock panel (${ADDON_DIR}/todos/addon.json, index.html):
{ "apiVersion": 1, "id": "todos", "kind": "panel", "name": "TODOs", "place": "dock", "icon": "list", "access": { "files": "project", "composer": true } }
<!doctype html><html><head><style>
body { padding: 14px; } li { list-style: none; padding: 8px 10px; border-radius: 10px; }
li:hover { background: color-mix(in oklch, var(--ink) 5%, transparent); } small { color: var(--ink-3); font-family: var(--font-mono); }
</style></head><body><h3>TODOs</h3><ul id="list"></ul><script>
liner.files.search(["TODO"]).then((hits) => {
  document.getElementById("list").replaceChildren(...hits.map((h) => {
    const li = document.createElement("li");
    li.textContent = h.text; li.append(Object.assign(document.createElement("small"), { textContent: \` \${h.path}:\${h.line}\` }));
    li.onclick = () => liner.composer.put(\`Fix the TODO at \${h.path}:\${h.line}\`);
    return li;
  }));
}).catch((e) => (document.body.textContent = e.message));
</script></body></html>

A session tab (${ADDON_DIR}/tests/addon.json; its page draws liner.session.commands() and redraws on liner.on("session", …)):
{ "apiVersion": 1, "id": "tests", "kind": "panel", "name": "Tests", "place": "tab", "icon": "flask", "access": { "sessions": "this" } }

A global page (${ADDON_DIR}/notes/addon.json; keeps its data in storage):
{ "apiVersion": 1, "id": "notes", "kind": "panel", "name": "Notes", "place": "page", "icon": "notes", "access": { "storage": 1024 } }
<script>
const notes = (await liner.storage.get("notes")) ?? [];   // in a module script, or inside an async function
await liner.storage.set("notes", notes);                   // the whole value, as JSON
</script>`;

const VERIFY = `Verify, then report saved against live
1. addon_check with the id: it draws the draft in the same sealed frame and at the same size as in Liner Code (dock 428 × 780, tab 900 × 720, page 1100 × 800), with this session's real data and storage that's thrown away. It returns a picture, how many elements it drew, its errors with file and line, what the content policy blocked, and what the bridge refused.
2. Fix what it shows and check again, until it draws what you meant with no errors.
3. addon_install: the person sees it live and answers. A dock panel opens as a preview beside the card; a page and a tab show there too while the card is up.
4. After the yes, it opens where its place says. If you change it, addon_check and addon_install again: the same access goes in without a card.
5. Report: saved is the draft in ${ADDON_DIR}/<id>/ (always yours to edit); live is what was added, as which version, and where it opens. Say which it is. If the person said no, nothing is live.`;

/** What's installed now: each add-on, its manifest as in use, and where its files are. */
function installed(addons: Addons | undefined, draftRoot: string | null) {
  const list: AddonInfo[] = addons?.list() ?? [];
  if (!list.length) return "Installed add-ons\nNone yet.";
  return `Installed add-ons\n${list
    .map((a) => {
      const m = addons!.manifest(a.id);
      const state = a.removed ? "removed (the person can restore it)" : a.enabled ? "on" : "off";
      const files = a.panel ? `\nIts files (v${a.version}): ${join(addons!.dir, a.id, `v${a.version}`, "files")}${a.panel ? `; its storage: ${join(addons!.dir, a.id, "storage.json")}` : ""}` : "";
      const draft = draftRoot ? `\nIts draft, if this folder has one: ${join(ADDON_DIR, a.id)}/` : "";
      return `- ${a.id}: ${a.name}, ${a.kind}${a.panel ? ` (${a.panel.place})` : ""}, v${a.version} of ${a.versions.length}, ${state}${files}${draft}\n${JSON.stringify(m)}`;
    })
    .join("\n\n")}\nThe kept files are Liner Code's: read them, never edit them. Change an add-on through its draft and addon_install.`;
}

/** One part of the creator's guide, for liner_inspect. */
export function topicText(topic: Topic, o: { addons?: Addons; draftRoot: string | null; n: (tool: string) => string }) {
  switch (topic) {
    case "catalogue":
      return creatorNote(o.n);
    case "connections":
      return CONNECTIONS;
    case "panels":
      return PANELS;
    case "manifest":
      return manifest();
    case "places":
      return PLACES;
    case "bridge":
      return bridge();
    case "theme":
      return theme();
    case "starters":
      return STARTERS;
    case "verify":
      return VERIFY;
    case "installed":
      return installed(o.addons, o.draftRoot);
  }
}
