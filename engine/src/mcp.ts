/*
  Liner Code's tools as an MCP server on stdio, started by an agent tool for one session. It
  lists the tools and passes each call to the engine with the session's key; the engine does
  the work (see agent-tools.ts). It runs on its own, so it imports nothing from the engine.
*/
import { createInterface } from "node:readline";
import { VERSION } from "./version.ts";

type Schema = { type: "object"; properties: Record<string, { type: string; description: string }>; required?: string[] };
type ToolDef = { name: string; description: string; inputSchema: Schema };

const none: Schema = { type: "object", properties: {} };
const TOOLS: ToolDef[] = [
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
];

const url = process.env.LINER_SURFACE_URL ?? "";
const key = process.env.LINER_SURFACE_KEY ?? "";
type Msg = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Record<string, unknown> };

const send = (m: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);

async function call(name: string, args: unknown) {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-liner-surface": key }, body: JSON.stringify({ tool: name, args: args ?? {} }) });
    const b = (await r.json()) as { ok: boolean; result?: unknown; error?: string };
    return b.ok ? b.result : { content: [{ type: "text", text: b.error ?? "Liner Code didn't answer." }], isError: true };
  } catch {
    return { content: [{ type: "text", text: "Liner Code isn't running, so its tools aren't there." }], isError: true };
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let m: Msg;
  try {
    m = JSON.parse(line) as Msg;
  } catch {
    return;
  }
  if (m.id === undefined) return;
  if (m.method === "initialize") {
    send({
      id: m.id,
      result: {
        protocolVersion: String(m.params?.protocolVersion ?? "2025-06-18"),
        capabilities: { tools: {} },
        serverInfo: { name: "liner", title: "Liner Code", version: VERSION },
        instructions: "Liner Code's own surfaces. Use the browser tools to check a web app you changed on its dev server, the device tools for an iOS app in the simulator, and show_page to show a chart, table or mockup instead of describing it.",
      },
    });
  } else if (m.method === "tools/list") send({ id: m.id, result: { tools: TOOLS } });
  else if (m.method === "tools/call") void call(String(m.params?.name ?? ""), m.params?.arguments).then((result) => send({ id: m.id, result }));
  else if (m.method === "ping") send({ id: m.id, result: {} });
  else send({ id: m.id, error: { code: -32601, message: `No method ${m.method}` } });
});
