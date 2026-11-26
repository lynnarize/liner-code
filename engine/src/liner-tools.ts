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
import { SECURITY_READS, TOOLS as SECURITY_TOOLS } from "./security-tools.ts";

/**
  A property's description may be left out where its name says it all: Antigravity's agy leaves a tool over about a
  kilobyte out of what its model is told (liner-tools.test.ts), so every word in a tool has to earn its place.
*/
export type Schema = { type: "object"; properties: Record<string, { type: string; description?: string; enum?: string[]; items?: { type: string } }>; required?: string[] };
export type ToolDef = { name: string; description: string; inputSchema: Schema };

const none: Schema = { type: "object", properties: {} };
/** Set in the server's environment only for a pair's lead: no one else is offered `sidekick`. */
export const PAIR_ENV = "LINER_SIDEKICK";
/** Set in the server's environment only for sessions whose provider gets Liner Code's `subagent` tool. */
export const SUBAGENT_ENV = "LINER_SUBAGENT";
/** Set in the server's environment for a Swarm session: "coordinator" (lead), "orchestrator" (depth-1 manager), or "worker" (leaf specialist). */
export const SWARM_ENV = "LINER_SWARM";
/**
  Set in the server's environment only for a Liner Security session (Thread.security). "scan": every security_* tool and
  none of Liner's others (a scan only reads; nothing of Liner's that runs or reaches things), bar a pair lead's sidekick.
  "scan-read" (a scan's side chat or fork): the two security tools that only read, and nothing else. "read" (a fix of a
  finding, a question about one): the two that only read, beside the rest. Anyone else is offered none of them.
*/
export const SECURITY_ENV = "LINER_SECURITY";
/** Whether a session with this server environment is offered this tool, as far as Liner Security goes. */
const securityOffered = (name: string, env: Record<string, string | undefined>) => {
  const level = env[SECURITY_ENV];
  const security = name.startsWith("security_");
  if (level === "scan") return security || name === "sidekick";
  if (level === "scan-read") return SECURITY_READS.includes(name) || name === "sidekick";
  if (level === "read") return !security || SECURITY_READS.includes(name);
  return !security;
};
const SWARM_WORKER_TOOLS = new Set(["swarm_post", "swarm_read"]);
const SWARM_ALL_TOOLS = new Set(["swarm_manage", "swarm_post", "swarm_read"]);
/** The tools a session is offered: `sidekick` only for a pair's lead, `subagent` only where the provider has no native subagents, `swarm_*` only in Swarm sessions (workers get board tools; orchestrators also get swarm_manage), and Liner Security's only in its sessions. */
export const toolsFor = (env: Record<string, string | undefined>) => {
  const swarm = env[SWARM_ENV];
  if (swarm === "worker") return TOOLS.filter((t) => SWARM_WORKER_TOOLS.has(t.name));
  if (swarm === "orchestrator") return TOOLS.filter((t) => SWARM_ALL_TOOLS.has(t.name));
  return TOOLS.filter((t) => (t.name !== "sidekick" || env[PAIR_ENV] === "1") && (t.name !== "subagent" || env[SUBAGENT_ENV] === "1") && (!SWARM_ALL_TOOLS.has(t.name) || swarm === "coordinator") && securityOffered(t.name, env));
};
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
      "Starts a dev server named in .claude/launch.json in the session's folder (Claude Code's preview file) and opens it in Liner Code's Browser; returns its port and the page. Use it, not your shell: Liner Code stops it when no session needs it and starts it again later. One that runs already is used as it is.",
      'With no file or no such server, write it first: {"version": "0.0.1", "configurations": [{"name": "web", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 5173}]}. It gets PORT too; cwd, env and autoPort (true: a free port when its own is taken) are optional.',
      "A command the person hasn't run from this file may wait for their yes.",
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
      "Shows a design (a screen, a page, a clickable prototype) beside the session, at its size, for the person to comment on and have built.",
      "Write one self-contained HTML file under .liner/designs/ (settings.html) and call this with its path; to change it, edit only what was asked and call again: each call keeps a version. Without file tools, pass html.",
      "Use real content and the project's own look. Returns a picture as drawn, with console errors: fix what's off first.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        path: { type: "string" },
        html: { type: "string" },
        size: { type: "string", enum: ["desktop", "tablet", "phone"] },
        note: { type: "string", description: "What this version changed" },
        design: { type: "string", description: "A shown design's id" },
      },
      required: ["title"],
    },
  },
  // Liner Design, one line per area.
  ...CANVAS_TOOLS,
  ...LEAN_TOOLS,
  ...BUILD_TOOLS,
  ...PICTURE_TOOLS,
  // Liner Security: what a scan reports its findings with.
  ...SECURITY_TOOLS,
  {
    name: "liner_inspect",
    description:
      "Reads Liner Code's add-on guide: connections (an MCP server every agent tool here gets) and panels (a small page of your own in Liner Code: in the right dock, a tab beside Chat, or a page from the sidebar), the manifests to write, what's installed, and the agent tools on this Mac. Read it before you make either, when the person asks to connect a service through MCP or for a panel or small app in Liner Code. A topic reads one part in depth: apps is the bar a full-page app meets, design is Liner 2.0, the app's own look (read it before drawing a panel), installed has manifests and paths. Changes nothing.",
    inputSchema: { type: "object", properties: { topic: { type: "string", description: "One part, in depth; the short guide when left out", enum: ["catalogue", "connections", "panels", "manifest", "places", "apps", "bridge", "theme", "design", "starters", "verify", "installed"] } } },
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
      "Offers the person a card after your answer, to make something as an app in Liner Code. At most one, when they asked for an interface or your answer has a use they'll come back to; not for a one-off answer, a static table, or a change to their project. place: dock (beside this chat), tab (this session's output) or page (across projects). Don't make it yourself.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        brief: { type: "string", description: "What it does, reads and keeps, for a session that can't read this one" },
        place: { type: "string", enum: ["dock", "tab", "page"] },
        access: { type: "object", description: 'The least it needs: files ("project"), sessions ("this"/"all"), composer, storage (KB), ai, network (a host)' },
        initialContent: { type: "array", items: { type: "string" }, description: "The person's own items" },
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
      "Hands one bounded piece of work to your sidekick, a quicker model in this folder under the same access, and waits until it's done (10 minutes at most: the result says when a cap stopped it). One brief at a time.",
      "Give the goal, the constraints and how to tell it's done: it knows nothing of this conversation but your briefs. It remembers your earlier briefs, so send corrections to it; fresh starts it over.",
      "Returns how it went, its report, and the files it changed as Liner Code measured them. The report is its claim: read the diff before you build on it.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "string", description: "The goal, the files and constraints that matter, what to leave alone" },
        done_when: { type: "string", description: "The check to run, the behaviour to see" },
        fresh: { type: "boolean", description: "Forget your earlier briefs" },
      },
      required: ["brief"],
    },
  },
  {
    name: "subagent",
    description: [
      "Spawns a subagent in this folder with a fresh context for one focused task and returns its report (10 minutes at most).",
      "mode read (the default) is for exploring, audits and planning: several calls in one turn run in parallel, and they can't edit files.",
      "mode write is for bounded implementation: one at a time, under the session's access, returning the files it changed.",
      "Make prompt self-contained (goal, paths, constraints, what to report): it knows nothing of this conversation and can't ask the person.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What it's doing, a few words" },
        prompt: { type: "string", description: "The goal, files to read or change, constraints, what to report" },
        mode: { type: "string", enum: ["read", "write"] },
        done_when: { type: "string", description: "The check or deliverable that says it's done" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "swarm_manage",
    // Short on purpose (agy drops a tool over about a kilobyte): the coordinator's and members' notes in swarm.ts say how
    // to add, audit, fork and plan, so the fields here only name themselves.
    description:
      "Runs your Teamwork or Swarm team, as your notes say: add, plan, status, models, model (swap one's), title, kill, skip. land is refused: only the person merges.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "skip", "plan", "status", "models", "model", "land", "title", "kill"] },
        name: { type: "string" },
        role: { type: "string" },
        can_delegate: { type: "boolean" },
        audit: { type: "boolean" },
        of: { type: "string" },
        n: { type: "number" },
        tasks: { type: "array", items: { type: "string" } },
        fork: { type: "string" },
        model: { type: "string" },
        workspace: { type: "string", enum: ["inherit", "share", "branch"] },
        mode: { type: "string", enum: ["read", "write"] },
        channels: { type: "array", items: { type: "string" } },
        brief: { type: "string" },
        reason: { type: "string" },
        title: { type: "string" },
        plan: { type: "object" },
      },
      required: ["action"],
    },
  },
  {
    name: "swarm_post",
    description: "Posts to the team's board. An @name (@coordinator, @all) wakes that member, so post and end your turn instead of polling.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Your update, result, blocker or handoff; start with [blocked] or [question] to reach your parent at once. The coordinator posts '[done] <summary>' when the goal is met" },
        to: { type: "array", items: { type: "string" }, description: "Recipients besides the @names in text" },
        channel: { type: "string", description: "Channel (default main)" },
      },
      required: ["text"],
    },
  },
  {
    name: "swarm_read",
    description: "Reads board posts after a number, and with status the roster's live state.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "number", description: "Posts after this number (default 0)" },
        channel: { type: "string", description: "Only this channel (without #)" },
        status: { type: "boolean", description: "Include the roster and active slots" },
      },
    },
  },
  {
    name: "addon_remove",
    description: "Asks the person to remove an add-on (liner_inspect lists them). It stays on disk, so they can restore it. Waits for their answer.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The add-on's id" } }, required: ["id"] },
  },
];
