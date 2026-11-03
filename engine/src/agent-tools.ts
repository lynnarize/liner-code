/*
  What the agents Liner Code runs can use of the app itself: the session's Browser (open a page of
  the app being built, read it, click and type, take a screenshot), the iOS Simulator (list,
  screenshot, open a link), a page shown in the session (a chart, a table, a mockup), and the
  Design surface (a screen or prototype, kept version by version: designs.ts).

  Every agent tool reaches these the same way: it starts `mcp.ts` as an MCP server on stdio, and
  each call comes back here with the session's own key. A key reaches that one session's
  surfaces and nothing else, so an agent that reads it from its environment can't drive the
  rest of the engine (approve its own requests, say).

  Add-ons go through here too (addons.ts): liner_inspect tells an agent what a connection is and
  what's installed, and addon_install and addon_remove put a card on the timeline and wait for you.
*/
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AgentBrowserOp, AddonInfo, Item, ProviderInfo, Risk } from "../../contracts/src/index.ts";
import { addonKey } from "../../contracts/src/index.ts";
import { ADDON_GUIDE, readDraft, type Addons } from "./addons.ts";
import { DESIGN_FRAME, keepOutOfGit, sizeOf, type DesignItem, type Designs } from "./designs.ts";
import { run } from "./exec.ts";
import { devices, pagePath, readFile, screenshot } from "./surfaces.ts";
import { remember, searchSessions } from "./memory.ts";
import { uid, type Store } from "./store.ts";

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
    default:
      return `Liner Code · ${tool}`;
  }
}

/** What a window says when it hasn't got the session open. */
const NOT_HERE = /isn't open in Liner Code/;

const text = (t: string): McpResult => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): McpResult => ({ content: [{ type: "text", text: t }], isError: true });

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
  whoIs(threadId: string): string;
  toolOf(threadId: string): { label: string; family: string };
};

/** The agent tools a connection reaches, by family, and whether each takes one in mid-session. */
const REACHED: { family: string; label: string; now: boolean }[] = [
  { family: "claude", label: "Claude Code", now: true },
  { family: "codex", label: "Codex", now: false },
  { family: "opencode", label: "OpenCode", now: false },
  { family: "hermes", label: "Hermes", now: false },
];
/** The tool for Liner Code's own requests (an install card), on the timeline. */
export const ADDON_TOOL = "liner.addon";

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
  /** Your add-ons, and the runtime they're handed to sessions through. */
  addons?: Addons;
  host?: AddonHost;

  constructor(store: Store, env: NodeJS.ProcessEnv) {
    this.store = store;
    this.env = env;
  }

  /** How an agent tool starts Liner Code's tools for one session. Null until the server is up. */
  serverFor(threadId: string): { command: string; args: string[]; env: Record<string, string> } | null {
    if (!this.url) return null;
    let key = [...this.keys].find(([, t]) => t === threadId)?.[0];
    if (!key) {
      key = randomBytes(18).toString("hex");
      this.keys.set(key, threadId);
    }
    // Under the Electron shell process.execPath is the app itself, which is a Node only when told so.
    const electron: Record<string, string> = process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};
    return { command: process.execPath, args: [fileURLToPath(new URL("./mcp.ts", import.meta.url))], env: { ...electron, LINER_SURFACE_URL: `${this.url}/surface`, LINER_SURFACE_KEY: key } };
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
    const r = await fetch(`http://127.0.0.1:${m[1]}${m[2] || "/"}`, { signal: AbortSignal.timeout(10000) });
    return `localhost:${m[1]}${m[2] || "/"} answered ${r.status} · ${pageText(await r.text())}\n\n(Read from the server; the session isn't open in Liner Code, so clicking and typing need it open.)`;
  }


  async call(threadId: string, tool: string, args: Record<string, unknown>): Promise<McpResult> {
    try {
      switch (tool) {
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
          const png = await this.browser<string>(threadId, "screenshot", {});
          return { content: [{ type: "image", data: png, mimeType: "image/png" }] };
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
          return text(this.inspect(threadId));
        case "addon_install":
          return await this.install(threadId, args);
        case "addon_remove":
          return await this.remove(threadId, args);
        default:
          return fail(`Liner Code has no tool called ${tool}.`);
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
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
    if (this.host.readOnly(threadId)) return "This session only reads (Read only, a side chat, or a planner's turn), so it can't add or remove an add-on. Say what you'd add; the person can ask for it in a session that makes changes.";
    return null;
  }

  private where(a: { project?: string }, threadId: string) {
    if (!a.project) return "every project";
    const p = this.store.projects.find((x) => x.id === a.project);
    return a.project === this.store.thread(threadId).projectId ? `${p?.name ?? "this project"} only (this project)` : `${p?.name ?? "another project"} only`;
  }

  /** liner_inspect: the guide, what's installed, which tools are here, and what this session may do. */
  private inspect(threadId: string) {
    const list: AddonInfo[] = this.addons?.list() ?? [];
    const keys = this.host?.keys;
    const installed = list.length
      ? list
          .map((x) => {
            const state = x.removed ? "removed (the person can restore it)" : x.enabled ? "on" : "off";
            const kept = x.versions.length > 1 ? ` (kept: ${x.versions.map((v) => `v${v}`).join(", ")})` : "";
            const secrets = x.secrets.length ? ` · keys: ${x.secrets.map((k) => `${k.name} ${keys?.has(addonKey(x.id, k.name)) ? "set" : "not set"}`).join(", ")}` : "";
            return `- ${x.id}: ${x.name} · v${x.version}${kept} · ${state} · ${this.where(x, threadId)} · ${x.transport} ${x.reaches}${secrets}`;
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
    const { path, manifest } = readDraft(root, String(args.id ?? args.path ?? args.draft ?? ""));
    void keepOutOfGit(root);
    const have = addons.get(manifest.id);
    const next = addons.wouldBe(manifest);
    if (have && have.enabled && !have.removed && next.version === have.version) return text(`applied: ${manifest.name} is already added as v${have.version}, for ${this.where(have, threadId)}, exactly as this draft says. Nothing to ask.`);
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
    const keyNote = missing.length ? ` The person left ${missing.join(", ")} empty, so calls that need ${missing.length === 1 ? "it" : "them"} may fail until they add ${missing.length === 1 ? "it" : "them"} in Settings › Add-ons.` : manifest.secrets?.length ? " Its keys are sealed in the keychain; you never see them." : "";
    const now = (await host.relink()).get(threadId) === "now";
    const mine = host.toolOf(threadId);
    if (now) return text(`applied: ${manifest.name} (v${version}) is added for ${where}, and its tools are in this session now${mine.family === "claude" ? ` as mcp__${manifest.id}__<tool>` : ""}. Every other agent tool gets it too.${keyNote}`);
    return text(`saved, starts in the next turn: ${manifest.name} (v${version}) is added for ${where}, but its tools can't reach this session yet. ${mine.label} takes in new MCP servers only when its session starts, so they arrive when the person's next message starts the next turn (the session picks up where it is). Tell the person that, and finish what you can without it now.${keyNote}`);
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
      description: `Takes ${have.name} away from every agent tool. It stays in the add-ons, so it can be restored in Settings › Add-ons.`,
      risk: "low",
      fields: [
        { label: "Server", value: have.reaches },
        { label: "Where", value: this.where(have, threadId) },
      ],
    });
    const r = await answer;
    if (!r.allow) return text(`denied: the person said no to removing ${have.name}${r.reason ? `, and said: “${r.reason}”` : ""}. It stays.`);
    this.addons!.update(id, { removed: true });
    const now = (await this.host!.relink()).get(threadId) === "now";
    return text(`removed: ${have.name} is gone from every agent tool${now ? ", this session included" : "; this session lets go of it from its next turn"}. The person can restore it in Settings › Add-ons.`);
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
