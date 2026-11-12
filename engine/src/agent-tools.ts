/*
  What the agents Liner Code runs can use of the app itself: the session's Browser (open a page of
  the app being built, read it, click and type, take a screenshot), the iOS Simulator (list,
  screenshot, open a link), a page shown in the session (a chart, a table, a mockup), and the
  Design surface (a screen or prototype, kept version by version: designs.ts).

  Every agent tool reaches these the same way: it starts `mcp.ts` as an MCP server on stdio, and
  each call comes back here with the session's own key. A key reaches that one session's
  surfaces and nothing else, so an agent that reads it from its environment can't drive the
  rest of the engine (approve its own requests, say).

  Add-ons go through here too (addons.ts): liner_inspect tells an agent what connections and panels
  are and what's installed, addon_check draws a panel out of sight for its agent to look at, and
  addon_install and addon_remove put a card on the timeline and wait for you. A panel's calls from
  its frame come here as well (panelCall), checked against its access (panels.ts).
*/
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AgentBrowserOp, AddonInfo, Item, PanelManifest, PanelPlace, ProviderInfo, Risk, Thread } from "../../contracts/src/index.ts";
import { addonKey, panelDocument } from "../../contracts/src/index.ts";
import { accessWords, ADDON_GUIDE, modelHostRefusal, readDraft, sizeWords, type Addons, type PanelFiles } from "./addons.ts";
import { CHECK_THEME, panelCall, refusal, type PanelEnv, type PanelMethod, type PanelWhere } from "./panels.ts";
import { topicText, TOPICS, type Topic } from "./creator.ts";
import type { Offers } from "./offers.ts";
import { DESIGN_FRAME, keepOutOfGit, sizeOf, type DesignItem, type Designs } from "./designs.ts";
import { run } from "./exec.ts";
import { commandLine, launchRisk, riskyEnv, shownEnv, type Launcher } from "./launch.ts";
import { devices, pagePath, readFile, screenshot } from "./surfaces.ts";
import { remember, searchSessions } from "./memory.ts";
import { uid, type Store } from "./store.ts";
import { PAIR_ENV } from "./liner-tools.ts";
import { AS_SIDEKICK, sidekickTitle } from "./sidekick.ts";
import * as canvas from "./canvas.ts";
import * as lean from "./lean.ts";
import * as buildlinks from "./buildlinks.ts";
import * as pictures from "./pictures.ts";
import type { DesignCtx, Shot } from "./canvas.ts";

/** Liner Design's modules, one line each: their tools (TOOLS), answered by their call, titled by their titleOf. */
const DESIGN = [canvas, lean, buildlinks, pictures];

export type McpContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export type McpResult = { content: McpContent[]; isError?: boolean };

/** What a call to one of Liner Code's tools does, in words, for its row on the timeline. */
export function linerTitle(tool: string, input: unknown): string {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const a: Record<string, unknown> = { ...raw, target: raw.target ?? raw.selector ?? raw.element ?? raw.ref ?? raw.label };
  const s = (v: unknown) => String(v ?? "").slice(0, 60);
  switch (tool) {
    case "browser_open":
      return `Open ${s(urlOf(raw))} in the Browser`;
    case "browser_read":
      return "Read the page in the Browser";
    case "browser_click": {
      const at = a.x !== undefined && a.y !== undefined ? ` at ${s(a.x)}, ${s(a.y)}` : "";
      const what = a.target === undefined ? "" : /^\d+$/.test(s(a.target)) ? ` control ${s(a.target)}` : ` “${s(a.target)}”`;
      return `Click${what}${at}${Number(a.times) > 1 ? ` ${Math.min(20, Number(a.times))} times` : ""} in the Browser`;
    }
    case "browser_press":
      return `Press ${s(a.key)}${Number(a.times) > 1 ? ` ${Math.min(20, Number(a.times))} times` : ""} in the Browser`;
    case "browser_type":
      return `Type into ${/^\d+$/.test(s(a.target)) ? `field ${s(a.target)}` : `“${s(a.target)}”`} in the Browser`;
    case "browser_screenshot":
      return "Look at the Browser";
    case "server_start":
      return `Run ${s(a.name) || "a dev server"} from launch.json`;
    case "server_stop":
      return s(a.name) ? `Stop ${s(a.name)}` : "Stop the dev servers";
    case "server_list":
      return "List the dev servers";
    case "server_logs":
      return `Read ${s(a.name) || "a dev server"}'s output`;
    case "device_list":
      return "List the simulators";
    case "device_screenshot":
      return "Look at the simulator";
    case "device_open_url":
      return `Open ${s(a.url)} in the simulator`;
    case "show_page":
      return `Show ${s(a.title) || "a page"}`;
    case "design_show":
      return `Show the design ${s(a.title) ? `“${s(a.title)}”` : s(a.path) || ""}`.trim();
    case "memory_add":
      return `Remember: ${s(a.fact)}`;
    case "sessions_search":
      return `Search earlier sessions for “${s(a.query)}”`;
    case "liner_inspect":
      return "Read Liner Code's add-on guide";
    case "addon_install":
      return `Ask to add ${s(a.id ?? a.path) || "an add-on"}`;
    case "addon_remove":
      return `Ask to remove ${s(a.id) || "an add-on"}`;
    case "addon_check":
      return `Check the panel ${s(a.id ?? a.path)}`.trim();
    case "addon_offer":
      return `Offer to make ${s(a.name) || "an app"}`;
    case "mode_add":
      return `Ask to add the mode ${s(a.name) || ""}`.trim();
    case "sidekick":
      return sidekickTitle(raw.brief);
    default:
      for (const m of DESIGN) {
        const title = m.titleOf(tool, raw);
        if (title) return title;
      }
      return `Liner Code · ${tool}`;
  }
}

/** What a window says when it hasn't got the session open. */
const NOT_HERE = /isn't open in Liner Code/;

const text = (t: string): McpResult => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): McpResult => ({ content: [{ type: "text", text: t }], isError: true });
/** What a model that takes no pictures is told in a picture's place. */
export const NO_PICTURE =
  "The picture was left out: the model this session runs on doesn't take pictures (Settings › Models says so for it), so sending it would fail or be lost. What it shows is said in words above, so work from that; to know how it looks to the eye, ask the person to look at it.";
/** A result as a model that takes no pictures gets it: its words, the pictures out, and why. */
export function wordsOnly(r: McpResult): McpResult {
  const content = r.content;
  if (!content.some((c) => c.type === "image")) return r;
  return { ...r, content: [...content.filter((c) => c.type !== "image"), { type: "text", text: NO_PICTURE }] };
}

/** The page browser_open was asked for: url, or the name a model guessed for it (target, like the other browser tools, or path, file…). */
const urlOf = (args: Record<string, unknown>) => String(args.url ?? args.target ?? args.path ?? args.file ?? args.page ?? args.href ?? "").trim();

/** What to click or type into, under whichever name the model gave it. */
function targetOf(a: Record<string, unknown>) {
  const t = a.target ?? a.selector ?? a.element ?? a.ref ?? a.control ?? a.label;
  if (t === undefined || String(t).trim() === "") throw new Error("Say what to act on: a control's number from browser_read, its text, or a CSS selector, as target.");
  return String(t);
}

/** A click: on a control, or at a point (x and y, in its target's pixels or the page's), once or again and again. */
function clickOf(a: Record<string, unknown>) {
  const num = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? undefined : Number(v));
  const x = num(a.x);
  const y = num(a.y);
  if ((x === undefined) !== (y === undefined) || (x !== undefined && (!Number.isFinite(x) || !Number.isFinite(y)))) throw new Error("Give a point as two numbers, x and y.");
  const point = x !== undefined ? { x, y } : {};
  const t = a.target ?? a.selector ?? a.element ?? a.ref ?? a.control ?? a.label;
  const target = t === undefined || String(t).trim() === "" ? undefined : String(t);
  if (target === undefined && x === undefined) throw new Error("Say what to click: a control's number from browser_read, its text, or a CSS selector, as target; or a point, as x and y (on a canvas, give it as target too).");
  return { ...(target !== undefined ? { target } : {}), ...point, ...repeats(a) };
}

/** Again and again, as a game wants: up to 20 times, at most 6 seconds in all. */
function repeats(a: Record<string, unknown>) {
  const times = Math.max(1, Math.min(20, Math.round(Number(a.times) || 1)));
  const every = Math.max(30, Math.min(1000, Math.round(Number(a.every) || 150), Math.floor(6000 / times)));
  return { times, every };
}

/** An HTML file rather than a server: "index.html", "games/snake.html", its full path, or a file:// link. */
export const isPage = (url: string) => /^file:\/\//i.test(url.trim()) || /\.html?(?:[?#].*)?$/i.test(url.trim());

/** An HTML page's title and visible text, without running it. */
function pageText(html: string) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const body = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
  return `${title || "untitled"}\n\n${body || "(No text in the HTML; the page likely renders with scripts. Open the session in Liner Code to see it run.)"}`;
}

type PageRead = { url: string; title: string; text: string; controls: { n: number; tag: string; label: string; value?: string }[]; canvases?: { selector: string; width: number; height: number; shown: string }[]; errors?: string[]; port?: number };

/** A page as the agent reads it. */
function described(r: PageRead) {
  const controls = r.controls.length ? r.controls.map((c) => `${c.n}. ${c.tag} ${c.label ? `"${c.label}"` : ""}${c.value ? ` = "${c.value}"` : ""}`).join("\n") : "(none)";
  const errors = r.errors?.length ? `\n\nConsole errors:\n${r.errors.slice(-10).join("\n")}` : "\n\nConsole: no errors.";
  const canvases = r.canvases?.length ? `\n\nCanvases (click points on them with x and y in their own pixels, or press keys):\n${r.canvases.map((c) => `${c.selector}: ${c.width}×${c.height}, shown at ${c.shown}`).join("\n")}` : "";
  return `${r.port ? `localhost:${r.port}${r.url}` : r.url.slice(1) || "index.html"} · ${r.title || "untitled"}\n\n${r.text || "(no text)"}\n\nControls:\n${controls}${canvases}${errors}`;
}

/**
  What the add-on tools need of the runtime, which is made after these tools (main.ts): its keys,
  the tools it found, the install card's wait, and the sessions it hands connections to.
*/
export type AddonHost = {
  keys: Map<string, string>;
  providerInfo: ProviderInfo[];
  askLiner(threadId: string, ask: { tool: string; title: string; description?: string; risk: Risk; fields: { label: string; value: string }[]; addon?: Extract<Item, { kind: "approval" }>["addon"] }): { id: string; answer: Promise<{ allow: boolean; reason?: string; scope?: "all" | "project" }> };
  relink(): Promise<Map<string, "now" | "next">>;
  readOnly(threadId: string): boolean;
  /** Whether the model the session (its sidekick: `sidekick`) runs on takes pictures. Unset: it does. */
  seesPictures?(threadId: string, sidekick: boolean): boolean;
  /** Nobody is there to answer a card: a routine's step. */
  unwatched?(threadId: string): boolean;
  whoIs(threadId: string): string;
  toolOf(threadId: string): { label: string; family: string };
  /** A pair's lead hands its sidekick a brief: the runtime runs it and says how it went (sidekick.ts). */
  delegate?(threadId: string, args: Record<string, unknown>, gone?: AbortSignal): Promise<{ text: string; isError?: boolean }>;
};

/** The agent tools a connection reaches, by family, and whether each takes one in mid-session. */
const REACHED: { family: string; label: string; now: boolean }[] = [
  { family: "claude", label: "Claude Code", now: true },
  { family: "codex", label: "Codex", now: false },
  { family: "opencode", label: "OpenCode", now: false },
  { family: "hermes", label: "Hermes", now: false },
  { family: "antigravity", label: "Antigravity CLI", now: false },
];
/**
  A model, as a check sees it: nobody has picked one, and nothing is billed, so its answer is a
  stand-in that says so, shaped like a real one, for the picture to show where an answer goes.
*/
const CHECK_AI: NonNullable<PanelEnv["ai"]> = {
  model: () => ({ name: "A model you pick" }),
  pick: () => ({ name: "A model you pick" }),
  ask: async ({ prompt }) => ({ text: `(A check asks no model. Once it's added, the model the person picks answers here. It was asked: "${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}")`, model: "A model you pick" }),
};

/** The tool for Liner Code's own requests (an install card), on the timeline. */
export const ADDON_TOOL = "liner.addon";
/** The tool for an agent's request to run a server from launch.json, on the timeline. */
export const SERVER_TOOL = "liner.server";

/** A launch.json entry's command, as a line to read (launch.ts has it). */
export { commandLine };
/** Lines that read like an error, as Claude Code's preview_logs picks them. */
const ERRORISH = /error|exception|failed|fatal|cannot|unable|ERR!/i;

/** The size a panel is drawn at to check it, by where it opens: the dock's width, a tab's, a page's. */
export const CHECK_SIZE: Record<PanelPlace, { width: number; height: number }> = { dock: { width: 428, height: 780 }, tab: { width: 900, height: 720 }, page: { width: 1100, height: 800 } };

/** A panel being checked out of sight: its draft, the storage it plays with, what it said and was refused. */
type Check = {
  threadId: string;
  manifest: PanelManifest;
  files: PanelFiles;
  storage: Record<string, unknown>;
  report?: { errors: { message: string; stack?: string }[]; blocked: string[]; ready?: { elements: number; width: number; height: number } };
  refused: string[];
  busy: number;
  last: number;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class AgentTools {
  private keys = new Map<string, string>();
  private waiting = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; late?: NodeJS.Timeout }>();
  /** Where the engine listens, set once its server is up. */
  url = "";
  private store: Store;
  private env: NodeJS.ProcessEnv;
  /** The turn a thread is on, for putting a page on its timeline. */
  turnOf: (threadId: string) => number = () => 0;
  /** The folder a thread works in, for an HTML file the agent opens while the session isn't on screen. */
  cwdOf: (threadId: string) => string | null = () => null;
  /** The sessions' designs. */
  designs?: Designs;
  /** Where a session folder's files are served (proxy.ts), for drawing a design to look at. */
  filesUrl: (root: string) => Promise<string> = async () => "";
  /** What Liner Design's modules are handed (canvas.ts); their tools say they aren't there without it. */
  design?: DesignCtx;
  /** Your add-ons, and the runtime they're handed to sessions through. */
  addons?: Addons;
  host?: AddonHost;
  /** "Make it an app" cards, and the background sessions that make them. */
  offers?: Offers;
  /** The dev servers of the sessions' launch.json files. */
  launch?: Launcher;
  /** Panels whose card is up: the draft exactly as asked about, which the preview draws and Add it installs. */
  readonly pending = new Map<string, { threadId: string; manifest: PanelManifest; files: PanelFiles; storage: Record<string, unknown> }>();
  /** Panels being drawn out of sight for addon_check, by their one-time token. */
  private checks = new Map<string, Check>();
  /** What the last check of each draft saw, for its card (by session and id, with the files it saw). */
  private checked = new Map<string, { sum: string; words: string }>();

  constructor(store: Store, env: NodeJS.ProcessEnv) {
    this.store = store;
    this.env = env;
  }

  /**
    How an agent tool starts Liner Code's tools for one session. Null until the server is up.
    `pair`: it's a pair's lead, offered `sidekick` too. `sidekick`: it's that pair's sidekick, with
    a key of its own, so a call it makes is told apart from the lead's (it may not hand work on).
  */
  serverFor(threadId: string, o: { pair?: boolean; sidekick?: boolean } = {}): { command: string; args: string[]; env: Record<string, string> } | null {
    if (!this.url) return null;
    const who = o.sidekick ? `${threadId}${AS_SIDEKICK}` : threadId;
    let key = [...this.keys].find(([, t]) => t === who)?.[0];
    if (!key) {
      key = randomBytes(18).toString("hex");
      this.keys.set(key, who);
    }
    // Under the Electron shell process.execPath is the app itself, which is a Node only when told so.
    const electron: Record<string, string> = process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};
    return { command: process.execPath, args: [fileURLToPath(new URL("./mcp.ts", import.meta.url))], env: { ...electron, LINER_SURFACE_URL: `${this.url}/surface`, LINER_SURFACE_KEY: key, ...(o.pair && !o.sidekick ? { [PAIR_ENV]: "1" } : {}) } };
  }

  threadOf(key: string) {
    return this.keys.get(key);
  }

  /** The app's answer to a Browser request. */
  /**
    The app's answer to a Browser request. More than one window can be listening (the app, and
    its preview in a web browser); one that hasn't got the session says so at once, so that
    answer waits a few seconds for a window that has it.
  */
  reply(id: string, ok: boolean, value?: unknown, error?: string) {
    const w = this.waiting.get(id);
    if (!w) return;
    if (!ok && NOT_HERE.test(error ?? "")) {
      w.late ??= setTimeout(() => {
        if (this.waiting.get(id) !== w) return;
        this.waiting.delete(id);
        w.reject(new Error(error));
      }, 8000);
      return;
    }
    clearTimeout(w.late);
    this.waiting.delete(id);
    if (ok) w.resolve(value);
    else w.reject(new Error(error || "The Browser couldn't do that."));
  }

  private browser<T>(threadId: string, op: AgentBrowserOp, args: Record<string, unknown>, wait = 25000): Promise<T> {
    const id = uid("ab");
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error("Liner Code's window didn't answer. Is it open?"));
      }, wait);
      this.waiting.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v as T)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.store.emit({ type: "agent.browser", id, threadId, op, args });
    });
  }

  /** Without the window: the page fetched straight from the dev server, or read from the session's folder, as text. */
  private async fetched(threadId: string, url: string): Promise<string> {
    const m = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])?:?(\d{2,5})(\/.*)?$/i.exec(url.trim());
    const root = this.cwdOf(threadId);
    if (!m && isPage(url) && root) {
      const path = pagePath(root, url).replace(/[?#].*$/, "");
      return `${path.slice(1)} · ${pageText(readFile(root, path.slice(1)).text)}\n\n(Read from the file; the session isn't open in Liner Code, so its scripts didn't run, and clicking and typing need it open.)`;
    }
    if (!m) throw new Error("Only pages on this Mac: localhost:<port>/<path>, or an HTML file in this session's folder.");
    // localhost, as servesPage() reads it: Node tries ::1 and 127.0.0.1, and Vite on a Mac listens on ::1 alone.
    const r = await fetch(`http://localhost:${m[1]}${m[2] || "/"}`, { signal: AbortSignal.timeout(10000) });
    return `localhost:${m[1]}${m[2] || "/"} answered ${r.status} · ${pageText(await r.text())}\n\n(Read from the server; the session isn't open in Liner Code, so clicking and typing need it open.)`;
  }


  /** `threadId` as threadOf gave it: a sidekick's key names its thread with AS_SIDEKICK after it. `gone`: its caller let go of the call. */
  async call(threadId: string, tool: string, args: Record<string, unknown>, gone?: AbortSignal): Promise<McpResult> {
    // A model that takes no pictures never gets one (OpenCode would put "Cannot read image" in its place, another API may refuse the request).
    const sidekick = threadId.endsWith(AS_SIDEKICK);
    let sees = true;
    try {
      sees = this.host?.seesPictures?.(sidekick ? threadId.slice(0, -AS_SIDEKICK.length) : threadId, sidekick) ?? true;
    } catch {
      // a thread that's gone: its call fails below as it would have
    }
    const r = await this.answer(threadId, tool, args, gone, sees);
    return sees ? r : wordsOnly(r);
  }

  private async answer(threadId: string, tool: string, args: Record<string, unknown>, gone: AbortSignal | undefined, sees: boolean): Promise<McpResult> {
    const sidekick = threadId.endsWith(AS_SIDEKICK);
    if (sidekick) threadId = threadId.slice(0, -AS_SIDEKICK.length);
    try {
      switch (tool) {
        case "sidekick": {
          // The sidekick never hands work on: it would wait on itself.
          if (sidekick) return fail("You are the sidekick here: do the brief yourself.");
          if (!this.host?.delegate) return fail("This session has no sidekick to hand work to.");
          const r = await this.host.delegate(threadId, args, gone);
          return r.isError ? fail(r.text) : text(r.text);
        }
        case "browser_open": {
          const url = urlOf(args);
          if (!url) return fail("Say which page, as url: localhost:5173/settings, a port, or an HTML file in this folder (index.html).");
          try {
            return text(described(await this.browser<PageRead>(threadId, "open", { url })));
          } catch (e) {
            if (/window didn't answer/.test(String(e)) || NOT_HERE.test(String(e))) return text(await this.fetched(threadId, url));
            throw e;
          }
        }
        case "browser_read":
          return text(described(await this.browser<PageRead>(threadId, "read", {})));
        case "browser_click":
          return text(described(await this.browser<PageRead>(threadId, "click", clickOf(args))));
        case "browser_press": {
          const key = String(args.key ?? "").trim();
          if (!key) return fail("Say which key, as key: Space, Enter, ArrowUp, a letter…");
          const t = args.target ?? args.selector;
          return text(described(await this.browser<PageRead>(threadId, "press", { key, ...(t ? { target: String(t) } : {}), ...repeats(args) })));
        }
        case "browser_type":
          return text(described(await this.browser<PageRead>(threadId, "type", { target: targetOf(args), text: String(args.text ?? args.value ?? ""), submit: Boolean(args.submit) })));
        case "browser_screenshot": {
          // In words for a model that takes no pictures: the page's text, its controls and console errors.
          if (!sees) return text(`${described(await this.browser<PageRead>(threadId, "read", {}))}\n\n${NO_PICTURE}`);
          const png = await this.browser<string>(threadId, "screenshot", {});
          return { content: [{ type: "image", data: png, mimeType: "image/png" }] };
        }
        case "server_start":
          return await this.serverStart(threadId, args);
        case "server_stop": {
          const launch = this.launcher();
          const name = String(args.name ?? "").trim() || undefined;
          const n = await launch.stop(threadId, name);
          return text(name ? (n ? `Stopped ${name}.` : `${name} wasn't running.`) : n ? `Stopped ${n} ${n === 1 ? "server" : "servers"}.` : "No server from .claude/launch.json was running.");
        }
        case "server_list":
          return text(await this.serverList(threadId));
        case "server_logs": {
          const launch = this.launcher();
          const name = String(args.name ?? "").trim();
          if (!name) return fail("Say which server, as name.");
          launch.entry(threadId, name);
          const log = launch.logs(threadId, name);
          const search = String(args.search ?? "").trim().toLowerCase();
          const picked = log.lines.filter((l) => (!search || l.toLowerCase().includes(search)) && (!args.errors || ERRORISH.test(l)));
          const lines = picked.slice(-Math.max(1, Math.min(200, Math.round(Number(args.lines) || 50))));
          const head = log.running ? `${name} is running.` : log.ended ? `${name} isn't running: ${log.ended}.` : `${name} hasn't run since Liner Code started.`;
          return text(`${head}\n\n${lines.length ? lines.join("\n") : log.lines.length ? "(No lines match.)" : "(No output.)"}`);
        }
        case "device_list": {
          const d = await devices(this.env);
          if (!d.ready) return fail(d.detail ?? "Xcode's simulators aren't set up on this Mac.");
          return text(d.devices.map((x) => `${x.name} (${x.runtime}) · ${x.state} · ${x.udid}`).join("\n") || "No simulators.");
        }
        case "device_screenshot": {
          const udid = await this.booted(args.udid);
          return { content: [{ type: "image", data: await screenshot(udid, this.env), mimeType: "image/png" }] };
        }
        case "device_open_url": {
          const udid = await this.booted(args.udid);
          const r = await run("xcrun", ["simctl", "openurl", udid, String(args.url ?? "")], { env: this.env, timeout: 20000 });
          return r.code === 0 ? text(`Opened ${args.url}.`) : fail((r.stderr || r.stdout).trim() || "The simulator didn't open it.");
        }
        case "memory_add": {
          const t = this.store.thread(threadId);
          const r = remember(this.store.home, t.projectId, String(args.fact ?? ""));
          return text(r.added ? `Saved. This project's memory holds ${r.facts.length} ${r.facts.length === 1 ? "fact" : "facts"}; new sessions start with them.` : "That's already in this project's memory.");
        }
        case "sessions_search": {
          const t = this.store.thread(threadId);
          const hits = searchSessions(this.store, t.projectId, String(args.query ?? ""), { skip: threadId });
          if (!hits.length) return text("Nothing in this project's earlier sessions matches that.");
          return text(hits.map((h) => `“${h.title}”, ${new Date(h.at).toISOString().slice(0, 10)}, ${h.who === "you" ? "the person asked" : "the agent answered"}:\n${h.snippet}`).join("\n\n"));
        }
        case "show_page": {
          const html = String(args.html ?? "");
          if (!html.trim()) return fail("The page is empty.");
          if (html.length > 400_000) return fail("That page is too large to show; keep it under 400 KB.");
          this.store.putItem(threadId, { kind: "page", id: uid("it"), turn: this.turnOf(threadId), at: Date.now(), title: String(args.title ?? "").trim().slice(0, 120) || "A page", html });
          return text("It's showing in the session now, below your answer so far.");
        }
        case "design_show": {
          if (!this.designs) return fail("Designs aren't available in this session.");
          const opt = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? undefined : String(v));
          const size = opt(args.size) === undefined ? undefined : sizeOf(String(args.size).trim().toLowerCase());
          if (opt(args.size) !== undefined && !size) return fail("size is desktop, tablet or phone.");
          const { item, fresh } = this.designs.show(threadId, { title: opt(args.title), path: opt(args.path), html: opt(args.html), design: opt(args.design), size, note: opt(args.note) });
          const said = fresh
            ? `Showing “${item.title}”, version ${item.version}, in the Design surface beside the session (design ${item.design}, file ${item.path}, drawn ${item.size}). To change it, edit that file, changing only what was asked, and call design_show again with its path: each call keeps a version the person can go back to.`
            : `“${item.title}” is the same as version ${item.version}, so that version stays (design ${item.design}, file ${item.path}).`;
          try {
            const look = await this.look(threadId, item);
            const errors = look.errors?.length ? `Console errors while it loaded:\n${look.errors.slice(-10).join("\n")}` : "No console errors.";
            const tall = look.height ? ` It is ${look.height} px tall at ${DESIGN_FRAME[item.size].width} px wide${look.height > 2400 ? "; the picture shows the first 2400 px" : ""}.` : "";
            return { content: [{ type: "text", text: `${said}\n\nThe picture is how it draws.${tall} ${errors} Look at it and fix what's off before you say it's done.` }, { type: "image", data: look.png, mimeType: "image/png" }] };
          } catch (e) {
            return text(`${said}\n\n(No picture of it: ${e instanceof Error ? e.message : String(e)})`);
          }
        }
        case "liner_inspect":
          return args.topic === undefined || args.topic === "" ? text(this.inspect(threadId)) : this.topic(threadId, String(args.topic));
        case "addon_install":
          return await this.install(threadId, args);
        case "addon_remove":
          return await this.remove(threadId, args);
        case "addon_check":
          return await this.check(threadId, args);
        case "mode_add":
          return await this.addMode(threadId, args);
        case "addon_offer":
          if (!this.offers) return fail("Offers aren't available in this session.");
          return text(this.offers.offer(threadId, args));
        default: {
          const m = DESIGN.find((d) => d.TOOLS.some((t) => t.name === tool));
          if (!m) return fail(`Liner Code has no tool called ${tool}.`);
          if (!this.design) return fail("Liner Design isn't available in this session.");
          return await m.call(tool, args, { ...this.design, threadId, sidekick, gone });
        }
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }

  private launcher() {
    if (!this.launch) throw new Error("Dev servers from launch.json aren't available in this session.");
    return this.launch;
  }

  /** The folder's launch.json servers, for the agent. */
  private async serverList(threadId: string) {
    const { servers, file, error } = await this.launcher().list(threadId);
    if (error) return error;
    if (!file) return 'This folder has no .claude/launch.json. Write one to run a dev server with server_start: {"version": "0.0.1", "configurations": [{"name": "web", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 5173}]}';
    if (!servers.length) return ".claude/launch.json lists no servers.";
    return servers
      .map((v) => {
        const where = `localhost:${v.at ?? v.port}`;
        if (v.status !== "stopped") return `${v.name} · ${v.status} on ${where}${v.at && v.at !== v.port ? ` (its port ${v.port} was taken)` : ""}${v.changed ? " · its entry changed since it started: restart it with server_stop, then server_start" : ""}`;
        if (v.problem) return `${v.name} · can't run: ${v.problem}`;
        return `${v.name} · stopped (port ${v.port})${v.ended ? `: ${v.ended.reason}` : ""}`;
      })
      .join("\n");
  }

  /**
    Runs a server from launch.json, once the person would have it run: one they ran (or let run)
    in this folder goes ahead, and so does any in Full access, short of what can't be undone;
    another comes to them as a card. Then it's opened in the Browser.
  */
  private async serverStart(threadId: string, args: Record<string, unknown>): Promise<McpResult> {
    const launch = this.launcher();
    let name = String(args.name ?? args.server ?? "").trim();
    if (!name) {
      const { servers } = await launch.list(threadId);
      if (servers.length !== 1) return fail(servers.length ? `Say which server, as name: ${servers.map((v) => v.name).join(", ")}.` : "Say which server, as name, once .claude/launch.json lists it.");
      name = servers[0].name;
    }
    const e = launch.entry(threadId, name);
    // One that runs already (you started it, or it came back by itself) is only used.
    const running = (await launch.list(threadId)).servers.some((v) => v.name === name && v.status !== "stopped" && !v.changed);
    const known = launch.trusts(threadId, e);
    // Only a person's yes makes an entry theirs for agents to run again: a run in Full access that nobody saw trusts nothing.
    let yes = false;
    if (!running && !known) {
      const line = commandLine(e);
      const risk = launchRisk(e);
      const risky = riskyEnv(e.env);
      const host = this.host;
      if (host?.unwatched?.(threadId)) return fail(`No one is here to say yes, and nobody has said yes to ${name} in this folder's launch.json as it is now, so it didn't run. Leave it for the person.`);
      const t = this.store.thread(threadId);
      const free = t.access === "full" && risk !== "high" && !host?.readOnly(threadId);
      if (!free) {
        if (!host) return fail(`${name} hasn't been run here before, and there's no one to ask. The person can run it from the Browser.`);
        // A secret's value is said to be set, not shown: the card is kept in the session's history.
        const env = Object.entries(shownEnv(e.env));
        const { answer } = host.askLiner(threadId, {
          tool: SERVER_TOOL,
          title: `Run ${name} from launch.json`,
          description: `Starts a dev server from .claude/launch.json in this folder and opens it in the Browser. Liner Code stops it when no session here needs it, and an entry you allow runs again without asking until its command, folder, environment or port changes.${risky.length ? ` Its environment sets ${risky.join(", ")}, which can make it run other code than its command shows.` : ""}`,
          risk,
          fields: [
            { label: "Command", value: line },
            { label: "Where", value: e.cwd },
            ...(env.length ? [{ label: "Environment", value: env.map(([k, v]) => `${k}=${v}`).join("\n") }] : []),
            { label: "Port", value: String(e.port) },
          ],
        });
        const a = await answer;
        if (!a.allow) return fail(`The person said no to running ${name}${a.reason ? `: ${a.reason}` : "."} Don't start it another way.`);
        yes = true;
      }
    }
    let up = await launch.start(threadId, name, { key: launch.keyFor(threadId, e), trust: yes || known });
    if (up.status === "starting") up = (await launch.settle(threadId, name, 60_000)) ?? up;
    if (up.status === "stopped") {
      const why = up.ended ? [up.ended.reason, ...(up.ended.tail ?? []).slice(-6)].join("\n") : "It stopped.";
      return fail(`${name} didn't stay up.\n${why}\n\nserver_logs has all it printed.`);
    }
    const port = up.at ?? up.port;
    const moved = port !== up.port ? ` (its port ${up.port} was taken, so it moved)` : "";
    const said = `${name} is ${up.status === "starting" ? "starting, and not answering yet," : "running"} on localhost:${port}${moved}, from .claude/launch.json. Liner Code stops it when no session in this folder needs it; don't start it from your shell as well.`;
    try {
      return text(`${said}\n\nIn the Browser now:\n${described(await this.browser<PageRead>(threadId, "open", { url: `localhost:${port}` }))}`);
    } catch (err) {
      if (/window didn't answer/.test(String(err)) || NOT_HERE.test(String(err))) return text(`${said}\n\n${await this.fetched(threadId, `localhost:${port}`).catch((x) => `(It didn't answer a request: ${x instanceof Error ? x.message : String(x)})`)}`);
      return text(`${said}\n\n(The Browser couldn't open it: ${err instanceof Error ? err.message : String(err)})`);
    }
  }

  /** The agent tools on this Mac a connection reaches, by name. */
  private reached() {
    const info = this.host?.providerInfo ?? [];
    return REACHED.filter((r) => info.some((p) => p.id === r.family && p.available));
  }

  /** Why this session's agent can't add an add-on now, if it can't. */
  private refusal(threadId: string) {
    if (!this.addons || !this.host) return "Add-ons aren't available in this session.";
    if (this.store.settings.addonOffers === "never") return "The person turned this off: in Settings › Add-ons, agents may never offer add-ons. Nothing was added. They can still add one by hand there.";
    if (this.host.readOnly(threadId)) return "This session only reads (Read only, or a side chat), so it can't add or remove an add-on. Say what you'd add; the person can ask for it in a session that makes changes.";
    return null;
  }

  private where(a: { project?: string }, threadId: string) {
    if (!a.project) return "every project";
    const p = this.store.projects.find((x) => x.id === a.project);
    return a.project === this.store.thread(threadId).projectId ? `${p?.name ?? "this project"} only (this project)` : `${p?.name ?? "another project"} only`;
  }

  /** liner_inspect: the guide, what's installed, which tools are here, and what this session may do. */
  /** One part of the creator's guide (creator.ts), for any session that asks; a Workshop session is told they're there. */
  private topic(threadId: string, asked: string): McpResult {
    const topic = asked.trim().toLowerCase() as Topic;
    if (!(TOPICS as readonly string[]).includes(topic)) return fail(`There's no topic "${asked}". The topics are ${TOPICS.join(", ")}.`);
    const family = this.host?.toolOf(threadId).family;
    const n = (tool: string) => (family === "claude" ? `mcp__liner__${tool}` : family === "opencode" ? `liner_${tool}` : tool);
    return text(topicText(topic, { addons: this.addons, draftRoot: this.cwdOf(threadId), n }));
  }

  private inspect(threadId: string) {
    const list: AddonInfo[] = this.addons?.list() ?? [];
    const keys = this.host?.keys;
    const installed = list.length
      ? list
          .map((x) => {
            const state = x.removed ? "removed (the person can restore it)" : x.enabled ? "on" : "off";
            const kept = x.versions.length > 1 ? ` (kept: ${x.versions.map((v) => `v${v}`).join(", ")})` : "";
            const secrets = x.secrets.length ? ` · keys: ${x.secrets.map((k) => `${k.name} ${keys?.has(addonKey(x.id, k.name)) ? "set" : "not set"}`).join(", ")}` : "";
            if (x.panel) return `- ${x.id}: ${x.name} · panel (${x.panel.place}) · v${x.version}${kept} · ${state} · ${x.panel.place === "page" ? "a page of its own" : this.where(x, threadId)} · ${x.reaches}`;
            return `- ${x.id}: ${x.name} · connection · v${x.version}${kept} · ${state} · ${this.where(x, threadId)} · ${x.transport} ${x.reaches}${secrets}`;
          })
          .join("\n")
      : "None yet.";
    const info = this.host?.providerInfo ?? [];
    const tools = REACHED.map((r) => {
      const p = info.find((x) => x.id === r.family);
      return `- ${r.label}${p?.version ? ` ${p.version}` : ""}: ${p?.available ? (r.now ? "installed; takes a new connection mid-session" : "installed; takes a new connection from its next turn") : "not installed here"}`;
    }).join("\n");
    const mine = this.host?.toolOf(threadId);
    const no = this.refusal(threadId);
    const off = this.addons?.off ? "\nLiner Code was started without add-ons this time, so none reach any tool until it starts again." : "";
    return `${ADDON_GUIDE}\n\nInstalled add-ons\n${installed}${off}\n\nAgent tools on this Mac\n${tools}\n\nThis session\nIt runs on ${mine?.label ?? "an agent tool"}. ${no ? `It can't add one now: ${no}` : "It may ask to add one with addon_install."}`;
  }

  /** addon_install: checks the draft, asks on a card, and adds it if the person says yes. */
  private async install(threadId: string, args: Record<string, unknown>): Promise<McpResult> {
    const no = this.refusal(threadId);
    if (no) return fail(no);
    const addons = this.addons!;
    const host = this.host!;
    const t = this.store.thread(threadId);
    const project = this.store.project(t.projectId);
    const root = this.cwdOf(threadId) ?? t.worktree?.path ?? project.path;
    const { path, manifest, files } = readDraft(root, String(args.id ?? args.path ?? args.draft ?? ""));
    void keepOutOfGit(root);
    if (manifest.kind === "panel") return this.installPanel(threadId, t, { id: project.id, name: project.name }, path, manifest, files!);
    const have = addons.get(manifest.id);
    if (have?.kind === "panel") return fail(`${manifest.id} is already a panel's id: give the connection an id of its own.`);
    if (have?.by.from) return fail(`${manifest.id} is the id of an add-on the person added from ${have.by.from}; its keys stay with that id. Give yours an id of its own.`);
    const next = addons.wouldBe(manifest);
    // Set to another project, it isn't here: that asks, as a new one would.
    if (have && have.enabled && !have.removed && next.version === have.version && (!have.project || have.project === project.id)) return text(`applied: ${manifest.name} is already added as v${have.version}, for ${this.where(have, threadId)}, exactly as this draft says. Nothing to ask.`);
    const reached = this.reached();
    const ask = addons.askOf(manifest, path, { id: project.id, name: project.name }, reached.map((r) => r.label));
    const { id, answer } = host.askLiner(threadId, {
      tool: ADDON_TOOL,
      title: `Add ${manifest.name}`,
      risk: "medium",
      fields: [
        { label: "Server", value: ask.server },
        { label: "Reaches", value: reached.map((r) => r.label).join(", ") || "Every agent tool" },
      ],
      addon: ask,
    });
    const r = await answer;
    if (!r.allow) {
      const it = this.store.item(threadId, id);
      if (it.kind === "approval" && it.state === "expired") return text(`denied: the turn ended before the person answered, so ${manifest.name} wasn't added. The draft stays at ${path}.`);
      return text(`denied: the person said no to adding ${manifest.name}${r.reason ? `, and said: “${r.reason}”` : ""}. Nothing was added. The draft stays at ${path}; don't ask again unless they do.`);
    }
    const scope = r.scope ?? ask.scope ?? "all";
    const version = addons.install(manifest, { project: scope === "project" ? project.id : undefined, by: { agent: host.whoIs(threadId), threadId, title: t.title, at: Date.now() } });
    const it = this.store.item(threadId, id);
    if (it.kind === "approval" && it.addon) this.store.putItem(threadId, { ...it, addon: { ...it.addon, scope, version } });
    const where = scope === "project" ? `${project.name} only` : "every project";
    const missing = (manifest.secrets ?? []).filter((k) => !host.keys.has(addonKey(manifest.id, k.name))).map((k) => k.name);
    const keyNote = missing.length ? ` The person left ${missing.join(", ")} empty, so calls that need ${missing.length === 1 ? "it" : "them"} may fail until they add ${missing.length === 1 ? "it" : "them"} in Settings › Add-ons.` : manifest.secrets?.length ? " The person typed its keys on the card; you never see them." : "";
    const now = (await host.relink()).get(threadId) === "now";
    const mine = host.toolOf(threadId);
    if (now) return text(`applied: ${manifest.name} (v${version}) is added for ${where}, and its tools are in this session now${mine.family === "claude" ? ` as mcp__${manifest.id}__<tool>` : ""}. Every other agent tool gets it too.${keyNote}`);
    return text(`saved, starts in the next turn: ${manifest.name} (v${version}) is added for ${where}, but its tools can't reach this session yet. ${mine.label} takes in new MCP servers only when its session starts, so they arrive when the person's next message starts the next turn (the session picks up where it is). Tell the person that, and finish what you can without it now.${keyNote}`);
  }

  /**
    addon_install for a panel. One the same as the version in use is said to be in already; one that
    asks for nothing more than it goes in without a card, and a line on the timeline says so; any
    other shows its card, with the draft live in the dock as a preview, and waits for the person.
  */
  private async installPanel(threadId: string, t: Thread, project: { id: string; name: string }, path: string, m: PanelManifest, files: PanelFiles): Promise<McpResult> {
    const addons = this.addons!;
    const host = this.host!;
    const have = addons.get(m.id);
    if (have && have.kind !== "panel") return fail(`${m.id} is already a connection's id: give the panel an id of its own.`);
    if (have?.by.from) return fail(`${m.id} is the id of an add-on the person added from ${have.by.from}; its storage stays with that id. Give yours an id of its own.`);
    const next = addons.wouldBe(m, files);
    const live = have && have.enabled && !have.removed;
    // Set to another project, it doesn't show here: that asks, as a new one would.
    const here = !have?.project || have.project === project.id;
    if (live && here && next.version === have.version) return text(`applied: ${m.name} is already in as v${have.version}, exactly as this draft is. Nothing to ask.`);
    if (m.access.network && this.store.settings.addonNetwork === "never") return fail(`The person set panels never to reach the internet (Settings › Add-ons), so ${m.name} can't have access.network. Make it work without: whatever it needs from elsewhere goes in its own files. Nothing was added.`);
    const modelHost = modelHostRefusal(m.access.network);
    if (modelHost) return fail(`${modelHost} Nothing was added.`);
    const ask = addons.panelAsk(m, path, project, files);
    const seen = this.checked.get(`${threadId}:${m.id}`);
    if (seen && seen.sum === sumOf(files)) ask.checked = seen.words;
    const by = { agent: host.whoIs(threadId), threadId, title: t.title, at: Date.now() };
    // Nothing more than the version in use: in, without asking again, and its line says so.
    if (live && here && ask.wider && ask.wider.length === 0) {
      const version = addons.install(m, { project: have.project, by: have.by }, files);
      this.store.putItem(threadId, { kind: "approval", id: uid("it"), turn: this.turnOf(threadId), at: Date.now(), tool: ADDON_TOOL, title: `Update ${m.name}`, risk: "low", fields: [], state: "approved", addon: { ...ask, same: true, version, replaces: have.version, scope: have.project ? "project" : "all" } });
      return text(`applied: ${m.name} is v${version} now. It asks for nothing more than v${have.version} did, so it went in without a card; the person sees a line saying so, with a way back to v${have.version}. It shows wherever it was open.`);
    }
    const fields = [{ label: "Touches", value: accessWords(m.access, m.place) }];
    const { id, answer } = host.askLiner(threadId, { tool: ADDON_TOOL, title: `Add ${m.name}`, risk: m.access.network ? "high" : "medium", fields, addon: ask });
    this.pending.set(id, { threadId, manifest: m, files, storage: {} });
    let r: Awaited<typeof answer>;
    try {
      r = await answer;
    } finally {
      this.pending.delete(id);
    }
    if (!r.allow) {
      const it = this.store.item(threadId, id);
      if (it.kind === "approval" && it.state === "expired") return text(`denied: the turn ended before the person answered, so ${m.name} wasn't added. The draft stays at ${path}.`);
      return text(`denied: the person said no to ${m.name}${r.reason ? `, and said: “${r.reason}”` : ""}. Nothing was added. The draft stays at ${path}; don't ask again unless they do.`);
    }
    const scope = m.place === "page" ? "all" : (r.scope ?? ask.scope ?? "project");
    const version = addons.install(m, { project: scope === "project" ? project.id : undefined, by }, files);
    const it = this.store.item(threadId, id);
    if (it.kind === "approval" && it.addon) this.store.putItem(threadId, { ...it, addon: { ...it.addon, scope, version } });
    const where = m.place === "page" ? "under Add-ons in the left sidebar" : m.place === "tab" ? `as a tab beside Chat, in ${scope === "project" ? `${project.name}'s sessions` : "every session"}` : `in the right dock, in ${scope === "project" ? `${project.name}'s sessions` : "every session"}`;
    return text(`applied: ${m.name} (v${version}) is added ${where}. To change it, edit the draft and call addon_install again: a version that asks for nothing more goes in without a card.`);
  }

  /**
    addon_check: the draft drawn out of sight, in a sealed frame like the window's, at its place's
    size and with this session's real data. It answers with a picture, what it drew, its errors,
    and anything the bridge or the content policy refused.
  */
  private async check(threadId: string, args: Record<string, unknown>): Promise<McpResult> {
    const t = this.store.thread(threadId);
    const root = this.cwdOf(threadId) ?? t.worktree?.path ?? this.store.project(t.projectId).path;
    const { manifest, files } = readDraft(root, String(args.id ?? args.path ?? args.draft ?? ""));
    if (manifest.kind !== "panel") return fail("addon_check draws a panel; a connection has nothing to draw. Ask for it with addon_install.");
    const size = CHECK_SIZE[manifest.place];
    const token = randomBytes(18).toString("hex");
    const c: Check = { threadId, manifest, files: files!, storage: {}, refused: [], busy: 0, last: Date.now() };
    this.checks.set(token, c);
    try {
      const look = await this.browser<{ png: string; errors?: string[]; height?: number }>(threadId, "shot", { url: `${this.url}/addon-check/${token}`, ...size }, 45000);
      const rep = c.report;
      const errors = rep ? rep.errors.map((e) => (e.stack ? `${e.message}\n${e.stack.split("\n").slice(0, 4).join("\n")}` : e.message)) : (look.errors ?? []);
      const drew = rep?.ready ? `Drew ${rep.ready.elements} elements at ${size.width} × ${size.height}${rep.ready.height > size.height ? `, ${rep.ready.height} px tall (it scrolls)` : ""}` : `Drew it at ${size.width} × ${size.height}`;
      const said = errors.length ? `${errors.length === 1 ? "1 error" : `${errors.length} errors`}` : "no console errors";
      // A check runs without its own host (only the person's hold on the card gives it), so reaching that one isn't a fault.
      const net = manifest.access.network;
      const held = !!net && (rep?.blocked ?? []).some((h) => h.includes(net));
      const hosts = [...new Set(rep?.blocked ?? [])].filter((h) => !net || !h.includes(net));
      const words = `${drew}, ${said}${hosts.length ? `, ${hosts.length === 1 ? `a request to ${hosts[0]}` : `requests to ${hosts.length} hosts`} blocked` : ""}`;
      this.checked.set(`${threadId}:${manifest.id}`, { sum: sumOf(files!), words });
      const parts = [
        `${words}.`,
        errors.length ? `Errors:\n${errors.slice(0, 10).join("\n\n")}` : "",
        hosts.length ? `The content policy blocked: ${hosts.join(", ")}. A panel reaches no address but the one host in access.network; scripts, styles and pictures go in its own files.` : "",
        held ? `Requests to ${net} were held: a check runs without the network, which only the person's hold on the install card gives. Make it draw sensibly while that host doesn't answer.` : "",
        c.refused.length ? `The bridge refused: ${[...new Set(c.refused)].join("; ")}` : "",
        modelHostRefusal(net) ? `addon_install will refuse it: ${modelHostRefusal(net)}` : "",
        manifest.access.ai ? "No model was asked: in a check, liner.ai.ask answers with a stand-in that says so. In the window, the person's first ask opens Liner Code's model picker, and the model they allow answers." : "",
        "The picture is how it draws in the window. Fix what's off and check again before you call addon_install.",
      ].filter(Boolean);
      return { content: [{ type: "text", text: parts.join("\n\n") }, { type: "image", data: look.png, mimeType: "image/png" }] };
    } finally {
      setTimeout(() => this.checks.delete(token), 5000);
    }
  }

  /** The page a check draws: the sealed frame, and a host that answers it the way the window would. */
  checkPage(token: string): string | null {
    const c = this.checks.get(token);
    if (!c) return null;
    // Without its host: nobody has held to allow it yet, and the check runs with this session's real files.
    const doc = panelDocument({ files: c.files, entry: c.manifest.entry, access: { ...c.manifest.access, network: undefined }, theme: CHECK_THEME, place: c.manifest.place });
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.manifest.name)}</title><style>html,body{margin:0;height:100%;background:${CHECK_THEME["--surface"]}}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><iframe sandbox="allow-scripts" title="${esc(c.manifest.name)}" srcdoc="${esc(doc)}"></iframe><script>(()=>{const f=document.querySelector("iframe");const at=location.pathname;const rep={errors:[],blocked:[]};
const send=()=>fetch(at+"/report",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(rep)}).catch(()=>{});
addEventListener("message",async(e)=>{if(e.source!==f.contentWindow)return;const d=e.data;if(!d||d.liner!==1)return;
if(d.kind==="error"){rep.errors.push({message:String(d.message),stack:d.stack});console.error("[panel] "+d.message);send();return}
if(d.kind==="blocked"){rep.blocked.push(d.host||d.directive);send();return}
if(d.kind==="ready"){rep.ready={elements:d.elements,width:d.width,height:d.height};send();return}
if(typeof d.id!=="number")return;
const r=await fetch(at+"/call",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({method:d.method,args:d.args})}).then((x)=>x.json()).catch((x)=>({ok:false,error:String(x)}));
f.contentWindow.postMessage(r.ok?{liner:1,id:d.id,ok:true,value:r.value}:{liner:1,id:d.id,ok:false,error:r.error},"*")});
const img=new Image();img.alt="";img.style.display="none";img.src=at+"/settle";document.body.appendChild(img)})()</script></body></html>`;
  }

  /** A call from a frame being checked, answered as the window's bridge would. */
  async checkCall(token: string, body: { method?: unknown; args?: unknown }) {
    const c = this.checks.get(token);
    if (!c) return { ok: false, error: "That check is over." };
    const method = String(body.method ?? "");
    const where: PanelWhere = { access: c.manifest.access, place: c.manifest.place, threadId: c.manifest.place === "page" ? undefined : c.threadId };
    const no = refusal(where, method);
    if (no) {
      c.refused.push(`${method}: ${no}`);
      return { ok: false, error: no };
    }
    c.busy++;
    try {
      const value = await this.panelCall(where, method as PanelMethod, (body.args ?? {}) as Record<string, unknown>, { all: () => c.storage, put: (k, v) => (v === undefined ? delete c.storage[k] : (c.storage[k] = v)) }, c.manifest.access.storage ?? 0, CHECK_AI);
      // A check never writes to the composer: it says what it would have put there.
      return { ok: true, value };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      c.busy--;
      c.last = Date.now();
    }
  }

  checkReport(token: string, body: Check["report"]) {
    const c = this.checks.get(token);
    if (c && body && Array.isArray(body.errors) && Array.isArray(body.blocked)) c.report = { errors: body.errors.slice(0, 20), blocked: body.blocked.slice(0, 20).map(String), ...(body.ready ? { ready: body.ready } : {}) };
  }

  /** Answers once the frame has drawn and its calls have gone quiet (6 s at most), so the picture is of it settled. */
  async checkSettle(token: string) {
    const start = Date.now();
    for (;;) {
      const c = this.checks.get(token);
      if (!c || Date.now() - start > 6000) return;
      if (c.report?.ready && c.busy === 0 && Date.now() - c.last > 400) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** The engine's half of a panel's bridge: the session's folder and timeline, every session, and its storage within its quota. */
  async panelCall(where: PanelWhere, method: PanelMethod, args: Record<string, unknown>, storage: { all(): Record<string, unknown>; put(key: string, value: unknown): void }, quota: number, ai?: PanelEnv["ai"]) {
    const env: PanelEnv = {
      cwdOf: (id) => this.cwdOf(id) ?? this.store.thread(id).worktree?.path ?? this.store.project(this.store.thread(id).projectId).path,
      thread: (id) => this.store.thread(id),
      threads: () => this.store.threads,
      timeline: (id) => this.store.timeline(id),
      projectName: (id) => this.store.projects.find((p) => p.id === id)?.name ?? "",
      branchOf: (id) => this.store.thread(id).worktree?.branch ?? this.store.projects.find((p) => p.id === this.store.thread(id).projectId)?.branch,
      storage: {
        all: storage.all,
        put: (k, v) => {
          if (v !== undefined && Buffer.byteLength(JSON.stringify({ ...storage.all(), [k]: v })) > quota * 1024) throw new Error(`That would take its storage over the ${sizeWords(quota)} it asked for.`);
          storage.put(k, v);
        },
      },
      ai,
    };
    return panelCall(env, where, method, args);
  }

  /**
    mode_add: a custom mode, made with the person in a Workshop session. It's one of their named
    agents (instructions, skills and context files) and runs on whichever model a session picks:
    named agents are only ever a way to give a model instructions. Asked on a card, like an add-on.
  */
  private async addMode(threadId: string, args: Record<string, unknown>): Promise<McpResult> {
    // A mode isn't an add-on: Settings › Add-ons' "never offer" doesn't reach it, only a session that reads.
    const no = !this.host ? "Modes aren't available in this session." : this.host.readOnly(threadId) ? "This session only reads (Read only, or a side chat), so it can't add a mode. Say what you'd add; the person can ask for it in a session that makes changes." : null;
    if (no) return fail(no);
    const name = String(args.name ?? "").trim();
    const description = String(args.description ?? "").trim();
    const instructions = String(args.instructions ?? "").trim();
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0 && x.length < 500).map((x) => x.trim()).slice(0, 20) : []);
    const skills = list(args.skills);
    const contextFiles = list(args.contextFiles);
    if (!name || name.length > 40) return fail("name is what the mode is called, up to 40 characters.");
    if (!instructions || instructions.length > 20_000) return fail("instructions are what the model is told in this mode, up to 20,000 characters.");
    if (this.store.agents.some((a) => a.name.toLowerCase() === name.toLowerCase())) return fail(`There's already a mode or agent called ${name}: pick another name.`);
    const t = this.store.thread(threadId);
    const { answer } = this.host!.askLiner(threadId, {
      tool: ADDON_TOOL,
      title: `Add the mode ${name}`,
      description: `${description ? `${description} ` : ""}It's a set of instructions for whichever model a session runs: pick it when you start one. It sits with your agents in Settings › Team, where you can change it.`,
      risk: "low",
      fields: [
        // Whole: every session in this mode is told all of it, so all of it is what the person reads (the card scrolls it).
        { label: "Instructions", value: instructions },
        ...(skills.length ? [{ label: "Skills", value: skills.join(", ") }] : []),
        ...(contextFiles.length ? [{ label: "Context", value: contextFiles.join(", ") }] : []),
      ],
    });
    const r = await answer;
    if (!r.allow) return text(`denied: the person said no to the mode ${name}${r.reason ? `, and said: “${r.reason}”` : ""}. Nothing was added.`);
    const id = `mode-${uid("a").slice(-8)}`;
    const model = t.model ?? (t.agent.startsWith("@") ? t.agent.slice(1) : (this.store.agents.find((a) => a.id === t.agent)?.model ?? t.agent));
    this.store.setAgents([...this.store.agents, { id, name, role: description || "A mode", glyph: "spark", specialty: "custom", model, effort: t.effort ?? "medium", soul: instructions, ...(skills.length ? { skills } : {}), ...(contextFiles.length ? { contextFiles } : {}) }]);
    return text(`applied: the mode ${name} is added (agent:${id}). The person picks it beside the project when they start a session, and can set it as the new-session default in Settings › Modes. It gives a model these instructions; it doesn't choose the model.`);
  }

  /** addon_remove: asks on a card, and removes it (on disk still, so it can be restored) if the person says yes. */
  private async remove(threadId: string, args: Record<string, unknown>): Promise<McpResult> {
    const no = this.refusal(threadId);
    if (no) return fail(no);
    const id = String(args.id ?? "").trim();
    const have = this.addons!.get(id);
    if (!have || have.removed) return fail(`There's no add-on ${id ? `called ${id}` : "by that id"} to remove. liner_inspect lists them.`);
    const { answer } = this.host!.askLiner(threadId, {
      tool: ADDON_TOOL,
      title: `Remove ${have.name}`,
      description: have.panel ? `Takes ${have.name} out of Liner Code. Its files, versions and storage are kept, so it can be restored in Settings › Add-ons.` : `Takes ${have.name} away from every agent tool. It stays in the add-ons, so it can be restored in Settings › Add-ons.`,
      risk: "low",
      fields: [
        { label: have.panel ? "Touches" : "Server", value: have.reaches },
        { label: "Where", value: have.panel?.place === "page" ? "A page of its own" : this.where(have, threadId) },
      ],
    });
    const r = await answer;
    if (!r.allow) return text(`denied: the person said no to removing ${have.name}${r.reason ? `, and said: “${r.reason}”` : ""}. It stays.`);
    this.addons!.update(id, { removed: true });
    const now = (await this.host!.relink()).get(threadId) === "now";
    return text(`removed: ${have.name} is gone from every agent tool${now ? ", this session included" : "; this session lets go of it from its next turn"}. The person can restore it in Settings › Add-ons.`);
  }

  /** A page drawn out of sight by the app at this size: its picture, console errors and full height (Liner Design's frames). */
  shot(threadId: string, page: { url: string; width: number; height: number }, wait = 30000) {
    return this.browser<Shot>(threadId, "shot", page, wait);
  }

  /** A design drawn out of sight at its size, by the app: its picture, console errors and full height. */
  private async look(threadId: string, d: DesignItem) {
    const root = this.cwdOf(threadId);
    const base = root ? await this.filesUrl(root) : "";
    if (!base) throw new Error("its folder isn't served");
    const url = `${base}/${d.path.split("/").map(encodeURIComponent).join("/")}`;
    return this.browser<{ png: string; errors?: string[]; height?: number }>(threadId, "shot", { url, ...DESIGN_FRAME[d.size] }, 30000);
  }

  private async booted(udid: unknown) {
    if (typeof udid === "string" && udid) return udid;
    const d = await devices(this.env);
    const on = d.devices.find((x) => x.state === "Booted");
    if (!on) throw new Error("No simulator is booted. Boot one in the session's Device surface, or name one with its udid from device_list.");
    return on.udid;
  }
}

/** A fingerprint of a panel's files, to know a check saw these ones. */
const sumOf = (files: PanelFiles) => createHash("sha256").update(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))).digest("hex").slice(0, 16);
