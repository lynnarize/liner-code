/*
  Liner Code's own tools, as an agent is told of them: what mcp.ts lists, and the one place their
  names are written. acp.ts goes by the same list to tell them from anyone else's, so it's data
  with no imports: importing mcp.ts itself would start its server. Liner Design's tools are data
  too, each area's in a file of its own beside its module (canvas-tools.ts for canvas.ts, and so on),
  so this file still pulls in nothing that does anything.
*/
import { TOOLS as CANVAS_TOOLS } from "./canvas-tools.ts";
import { TOOLS as LEAN_TOOLS } from "./lean-tools.ts";
import { TOOLS as BUILD_TOOLS } from "./buildlinks-tools.ts";
import { TOOLS as PICTURE_TOOLS } from "./pictures-tools.ts";

export type Schema = { type: "object"; properties: Record<string, { type: string; description: string; enum?: string[]; items?: { type: string } }>; required?: string[] };
export type ToolDef = { name: string; description: string; inputSchema: Schema };

const none: Schema = { type: "object", properties: {} };
/** Set in the server's environment only for a pair's lead: no one else is offered `sidekick`. */
export const PAIR_ENV = "LINER_SIDEKICK";
/** The tools a session is offered: all of them for a pair's lead, all but `sidekick` for anyone else. */
export const toolsFor = (env: Record<string, string | undefined>) => TOOLS.filter((t) => t.name !== "sidekick" || env[PAIR_ENV] === "1");
export const TOOLS: ToolDef[] = [
  {
    name: "browser_open",
    description:
      "Opens a page of the app you are building in Liner Code's Browser, beside the session, where the person can watch. Either a dev server on this Mac (localhost:5173/settings, or just a port) or an HTML file in the session's folder (index.html, games/snake.html), which needs no server: don't start one for plain HTML. Returns what the page shows, as text, with its controls numbered, and its console errors. After you build or change a web page, open it and check it works before you say it's done.",
    inputSchema: { type: "object", properties: { url: { type: "string", description: "localhost:<port>/<path>, a port, or an HTML file's path in the session's folder" } }, required: ["url"] },
  },
  { name: "browser_read", description: "What the Browser shows now: its address, title, visible text, its controls numbered for browser_click and browser_type, and recent console errors.", inputSchema: none },
  {
    name: "browser_click",
    description: "Clicks in the Browser: a control's number from browser_read, the text on a button or link, or a CSS selector. Or a point, with x and y: on a canvas (a game, say), give the canvas as target and the point in its own pixels, as its code draws; without a target, the point is in the page. times clicks again and again, like tapping to play. Returns the page after.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "A number from browser_read, visible text, or a CSS selector" },
        x: { type: "number", description: "A point to click: across, in the target's pixels (a canvas's own), or the page's" },
        y: { type: "number", description: "A point to click: down" },
        times: { type: "number", description: "How many clicks, up to 20" },
        every: { type: "number", description: "Milliseconds between clicks, default 150" },
      },
    },
  },
  {
    name: "browser_type",
    description: "Types into a field in the Browser, replacing what's there; with submit, sends its form. Returns the page after.",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string", description: "A number from browser_read, the field's label or placeholder, or a CSS selector" }, text: { type: "string", description: "What to type" }, submit: { type: "boolean", description: "Send the form after typing" } },
      required: ["target", "text"],
    },
  },
  {
    name: "browser_press",
    description: "Presses a key in the Browser, on the focused element or the page: Space, Enter, Escape, Tab, Backspace, ArrowUp and the other arrows, or a letter. times presses again and again, like flapping in a game. Returns the page after.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "The key: Space, Enter, ArrowUp, a letter…" },
        target: { type: "string", description: "Where to press it, like target in browser_click; the focused element when left out" },
        times: { type: "number", description: "How many presses, up to 20" },
        every: { type: "number", description: "Milliseconds between presses, default 150" },
      },
      required: ["key"],
    },
  },
  { name: "browser_screenshot", description: "A screenshot of the page in the Browser, as the person sees it.", inputSchema: none },
  {
    name: "server_start",
    description: [
      "Starts a dev server named in .claude/launch.json in the session's folder (the file Claude Code reads for its previews) and opens it in Liner Code's Browser. Returns its port and the page, as browser_open does.",
      "Use it instead of starting a dev server from your shell: Liner Code stops it when no session in the folder needs it and starts it again when the person comes back. One that runs already is used as it is.",
      'When the file is missing, or lacks the server, write it first: {"version": "0.0.1", "configurations": [{"name": "web", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 5173}]}. runtimeExecutable is the command and runtimeArgs its arguments (or program, a script for node, with args); port is where it listens (3000 when left out), and it gets PORT too; cwd, env and autoPort (true: it may move to a free port when its own is taken) are optional.',
      "A command the person hasn't run from this file before may wait for their yes.",
    ].join(" "),
    inputSchema: { type: "object", properties: { name: { type: "string", description: "The server's name in .claude/launch.json" } }, required: ["name"] },
  },
  {
    name: "server_stop",
    description: "Stops a dev server started from .claude/launch.json (server_start, or the person's Run), or all of the folder's when you leave out name.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "The server's name; all of them when left out" } } },
  },
  { name: "server_list", description: "The dev servers in this folder's .claude/launch.json: which run, on what port, and why one that stopped did.", inputSchema: none },
  {
    name: "server_logs",
    description: "What a dev server from .claude/launch.json printed, its output and errors, newest last: the one running, or the last run if it ended. To find a build error, or why it stopped.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The server's name" },
        lines: { type: "number", description: "How many of the last lines, up to 200; 50 when left out" },
        search: { type: "string", description: "Only lines with this text" },
        errors: { type: "boolean", description: "Only lines that look like errors" },
      },
      required: ["name"],
    },
  },
  { name: "device_list", description: "The iOS simulators on this Mac, and which one is booted.", inputSchema: none },
  { name: "device_screenshot", description: "A screenshot of a simulator's screen (the booted one, unless you name its udid).", inputSchema: { type: "object", properties: { udid: { type: "string", description: "Which simulator; the booted one when left out" } } } },
  {
    name: "device_open_url",
    description: "Opens a link or a deep link (myapp://settings) in a simulator.",
    inputSchema: { type: "object", properties: { url: { type: "string", description: "The link" }, udid: { type: "string", description: "Which simulator; the booted one when left out" } }, required: ["url"] },
  },
  {
    name: "memory_add",
    description:
      "Saves one fact about this project for later sessions, which start knowing it: a command that works here, a convention the code follows, a decision the person made, a trap you found. One sentence, true beyond this task. Not for progress notes.",
    inputSchema: { type: "object", properties: { fact: { type: "string", description: "The fact, in one sentence" } }, required: ["fact"] },
  },
  {
    name: "sessions_search",
    description: "Searches this project's earlier sessions: what the person asked and what agents answered. For \"like last time\", a decision made before, or how something was done. Returns the best snippets with each session's title and date.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Words to look for" } }, required: ["query"] },
  },
  {
    name: "show_page",
    description:
      "Shows the person a page in the session, beside your answer: a chart, a table, a mockup, a diagram, a comparison. Write an HTML fragment or a whole document. It runs sandboxed: scripts work, but it can't reach the network or the app, so put data and code inline. For the app's look in light and dark, use the CSS variables --bg, --surface, --ink, --ink-2, --ink-3, --line, --accent and --font (already set on the page).",
    inputSchema: { type: "object", properties: { title: { type: "string", description: "A short name for it" }, html: { type: "string", description: "The page" } }, required: ["title", "html"] },
  },
  {
    name: "design_show",
    description: [
      "Shows a design in the Design surface beside the session: a screen, a page, a component sheet, a clickable prototype. The person sees it full size at the size it's drawn for, comments on any part of it, and asks for it to be built.",
      "Write it as one self-contained HTML file in the session's folder, under .liner/designs/ (like .liner/designs/settings.html): CSS and scripts inline, pictures inline (SVG, data: URIs) or as files beside it; a font or a library from a CDN works too. Then call this with its path. To change it, read the file, change only what was asked, and call this again with the same path: each call keeps a version the person can go back to. If you can't write files, pass the whole page as html instead.",
      "Design it the way a good product designer would: real content (no lorem ipsum), one type scale and one spacing scale, clear hierarchy, enough contrast, and the states that matter (empty, loading, error). When the project has a look of its own, read its styles first and match them.",
      "It returns a picture of the design as drawn, with its console errors: look at it, and fix what's off before you say it's done.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "A short name for the design: \"Settings screen\"" },
        path: { type: "string", description: "Its HTML file in the session's folder, like .liner/designs/settings.html" },
        html: { type: "string", description: "The whole page, only when you can't write the file yourself" },
        size: { type: "string", enum: ["desktop", "tablet", "phone"], description: "What it's drawn for: desktop (the default), tablet or phone" },
        note: { type: "string", description: "What this version changed, in a few words" },
        design: { type: "string", description: "The id of a design shown before, to make this its next version (the same path does that too)" },
      },
      required: ["title"],
    },
  },
  // Liner Design, one line per area.
  ...CANVAS_TOOLS,
  ...LEAN_TOOLS,
  ...BUILD_TOOLS,
  ...PICTURE_TOOLS,
  {
    name: "liner_inspect",
    description:
      "Reads Liner Code's add-on guide: connections (an MCP server every agent tool here gets: Claude Code, Codex, OpenCode, Hermes) and panels (a small page of your own that opens in Liner Code, in the right dock, as a tab beside Chat, or as a page from the left sidebar), the manifests to write, the add-ons installed, and the agent tools on this Mac. Call it before you make either: when the person asks to connect a service through MCP, or for a panel, view or small app inside Liner Code. With a topic it reads one part in depth: panels, places, apps (the bar a full-page app meets), manifest, bridge, theme, design (Liner 2.0, the app's own look: read it before drawing a panel or page), starters, verify, installed (with manifests and file paths), connections, or catalogue. Changes nothing.",
    inputSchema: { type: "object", properties: { topic: { type: "string", description: "One part of the guide, in depth; leave it out for the whole short guide", enum: ["catalogue", "connections", "panels", "manifest", "places", "apps", "bridge", "theme", "design", "starters", "verify", "installed"] } } },
  },
  {
    name: "addon_check",
    description:
      "Draws a panel you drafted at .liner/addons/<id>/ out of sight, in the same sealed frame and at the same size as in Liner Code, with this session's real data. Returns a picture, what it drew, its console errors, and anything the bridge or the content policy refused. Call it before addon_install, and again after each fix.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The draft's id, for .liner/addons/<id>/addon.json; or its path in this folder" } }, required: ["id"] },
  },
  {
    name: "addon_offer",
    description:
      "Offers the person a card at the end of your answer: make something as an app in Liner Code, in the background, where they choose. Answer first, then offer at most one, when they asked for an interface, or your answer has a clear use they'll come back to (a record they keep, results they'll explore again); not for a one-off answer, a static table, or a change to their own project. Pick the place: \"dock\" to watch or edit beside this conversation, \"tab\" for this session's live output or interaction, \"page\" for something global they keep across projects. access is what it may touch, as a panel's manifest says it (liner_inspect); ask for the least it needs. Don't make it yourself.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "What it's called, a few words" },
        brief: { type: "string", description: "What it does, what it reads and what it keeps, so a session that can't read this one can make it" },
        place: { type: "string", description: "Where it goes", enum: ["dock", "tab", "page"] },
        access: { type: "object", description: 'As a panel manifest\'s access: files ("project"), sessions ("this" or "all"), composer (true), storage (KB), ai (true: it asks a model the person picks), network (one host)' },
        initialContent: { type: "array", items: { type: "string" }, description: "What it starts with, in the person's own items, when they gave some" },
      },
      required: ["name", "brief", "place"],
    },
  },
  {
    name: "mode_add",
    description:
      "Asks the person to add a custom mode you worked out with them: a name, a line on what it's for, and the instructions a model gets in it (plus any skills and context files, by path). It's one of their named agents, laid over whichever model a session runs; they pick it when they start a session. They see a card and say yes or no; this waits for them.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "What the mode is called, a word or two" },
        description: { type: "string", description: "One line on what it's for" },
        instructions: { type: "string", description: "What a model is told in this mode" },
        skills: { type: "array", items: { type: "string" }, description: "skill.md files it may read, by path" },
        contextFiles: { type: "array", items: { type: "string" }, description: "Files read at the start of each session, by path" },
      },
      required: ["name", "instructions"],
    },
  },
  {
    name: "addon_install",
    description:
      "Asks the person to add a connection or a panel you drafted at .liner/addons/<id>/addon.json in this folder (liner_inspect has the manifests' shapes). They see a card (and a panel live, as a preview) and say yes or no; this waits for them. Returns applied, saved, starts in the next turn (a connection: its tools arrive with the next turn), or denied (don't ask again unless they do). A changed panel that asks for nothing more than the version in use goes in without a card. Never put a key in a manifest: name it in secrets.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The draft's id, for .liner/addons/<id>/addon.json; or its path in this folder" } }, required: ["id"] },
  },
  {
    name: "sidekick",
    description: [
      "Hands one bounded piece of work to your sidekick, a quicker model working in this same folder under the same access, and waits until it's done (10 minutes at most, less where your tool won't wait that long on one call: the result says when the cap stopped it). One brief at a time: a second call waits for the first.",
      "Write the brief with the goal, the constraints and how to tell it's done; it knows nothing of this conversation but your briefs. It remembers your earlier briefs in this session, so send corrections to it; fresh starts it over.",
      "Returns how it went, its report, and the files it changed as Liner Code measured them. The report is its claim: read the diff before you build on it.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "string", description: "The work: the goal, the files and constraints that matter, what to leave alone" },
        done_when: { type: "string", description: "How it can tell it's done: the check to run, the behaviour to see" },
        fresh: { type: "boolean", description: "Start it over, forgetting your earlier briefs" },
      },
      required: ["brief"],
    },
  },
  {
    name: "addon_remove",
    description: "Asks the person to remove an add-on (liner_inspect lists them). It stays on disk, so they can restore it. Waits for their answer.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The add-on's id" } }, required: ["id"] },
  },
];
