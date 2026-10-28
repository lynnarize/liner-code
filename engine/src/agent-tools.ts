/*
  What the agents Liner Code runs can use of the app itself: the session's Browser (open a page of
  the app being built, read it, click and type, take a screenshot), the iOS Simulator (list,
  screenshot, open a link), and a page shown in the session (a chart, a table, a mockup).

  Every agent tool reaches these the same way: it starts `mcp.ts` as an MCP server on stdio, and
  each call comes back here with the session's own key. A key reaches that one session's
  surfaces and nothing else, so an agent that reads it from its environment can't drive the
  rest of the engine (approve its own requests, say).
*/
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AgentBrowserOp } from "../../contracts/src/index.ts";
import { run } from "./exec.ts";
import { devices, screenshot } from "./surfaces.ts";
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
      return `Open ${s(a.url)} in the Browser`;
    case "browser_read":
      return "Read the page in the Browser";
    case "browser_click":
      return `Click ${/^\d+$/.test(s(a.target)) ? `control ${s(a.target)}` : `“${s(a.target)}”`} in the Browser`;
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
    default:
      return `Liner Code · ${tool}`;
  }
}

const text = (t: string): McpResult => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): McpResult => ({ content: [{ type: "text", text: t }], isError: true });

/** What to click or type into, under whichever name the model gave it. */
function targetOf(a: Record<string, unknown>) {
  const t = a.target ?? a.selector ?? a.element ?? a.ref ?? a.control ?? a.label;
  if (t === undefined || String(t).trim() === "") throw new Error("Say what to act on: a control's number from browser_read, its text, or a CSS selector, as target.");
  return String(t);
}

type PageRead = { url: string; title: string; text: string; controls: { n: number; tag: string; label: string; value?: string }[]; errors?: string[]; port?: number };

/** A page as the agent reads it. */
function described(r: PageRead) {
  const controls = r.controls.length ? r.controls.map((c) => `${c.n}. ${c.tag} ${c.label ? `"${c.label}"` : ""}${c.value ? ` = "${c.value}"` : ""}`).join("\n") : "(none)";
  const errors = r.errors?.length ? `\n\nConsole errors:\n${r.errors.slice(-10).join("\n")}` : "\n\nConsole: no errors.";
  return `${r.port ? `localhost:${r.port}` : ""}${r.url} · ${r.title || "untitled"}\n\n${r.text || "(no text)"}\n\nControls:\n${controls}${errors}`;
}

export class AgentTools {
  private keys = new Map<string, string>();
  private waiting = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  /** Where the engine listens, set once its server is up. */
  url = "";
  private store: Store;
  private env: NodeJS.ProcessEnv;
  /** The turn a thread is on, for putting a page on its timeline. */
  turnOf: (threadId: string) => number = () => 0;

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
  reply(id: string, ok: boolean, value?: unknown, error?: string) {
    const w = this.waiting.get(id);
    if (!w) return;
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

  /** Without the window: the page fetched straight from the dev server, as text. */
  private async fetched(url: string): Promise<string> {
    const m = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])?:?(\d{2,5})(\/.*)?$/i.exec(url.trim());
    if (!m) throw new Error("Only pages on this Mac: localhost:<port>/<path>.");
    const r = await fetch(`http://127.0.0.1:${m[1]}${m[2] || "/"}`, { signal: AbortSignal.timeout(10000) });
    const html = await r.text();
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
    return `localhost:${m[1]}${m[2] || "/"} answered ${r.status} · ${title || "untitled"}\n\n${body || "(No text in the HTML; the page likely renders with scripts. Open the session in Liner Code to see it run.)"}\n\n(Read from the server; the session isn't open in Liner Code, so clicking and typing need it open.)`;
  }

  async call(threadId: string, tool: string, args: Record<string, unknown>): Promise<McpResult> {
    try {
      switch (tool) {
        case "browser_open": {
          const url = String(args.url ?? "");
          try {
            return text(described(await this.browser<PageRead>(threadId, "open", { url })));
          } catch (e) {
            if (/window didn't answer|isn't open in Liner Code/.test(String(e))) return text(await this.fetched(url));
            throw e;
          }
        }
        case "browser_read":
          return text(described(await this.browser<PageRead>(threadId, "read", {})));
        case "browser_click":
          return text(described(await this.browser<PageRead>(threadId, "click", { target: targetOf(args) })));
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
        case "show_page": {
          const html = String(args.html ?? "");
          if (!html.trim()) return fail("The page is empty.");
          if (html.length > 400_000) return fail("That page is too large to show; keep it under 400 KB.");
          this.store.putItem(threadId, { kind: "page", id: uid("it"), turn: this.turnOf(threadId), at: Date.now(), title: String(args.title ?? "").trim().slice(0, 120) || "A page", html });
          return text("It's showing in the session now, below your answer so far.");
        }
        default:
          return fail(`Liner Code has no tool called ${tool}.`);
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }

  private async booted(udid: unknown) {
    if (typeof udid === "string" && udid) return udid;
    const d = await devices(this.env);
    const on = d.devices.find((x) => x.state === "Booted");
    if (!on) throw new Error("No simulator is booted. Boot one in the session's Device surface, or name one with its udid from device_list.");
    return on.udid;
  }
}
