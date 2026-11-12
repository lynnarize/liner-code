/*
  The Browser surface's window onto a dev server. The app can't reach into a page on another
  origin, so the engine opens a small proxy for each local port you browse: it passes every
  request through (WebSockets too, so hot reload keeps working) and adds one script to each HTML
  page. That script reports console lines and navigation to the app, and answers its commands:
  back, forward, reload, pick an element, simulate offline, and, for an agent, read the page and
  click or type in it. Only ports on this machine, only on its loopback (127.0.0.1, and ::1 for
  localhost), and only requests addressed to the proxy itself. A page that needs no dev server (an index.html with its scripts) is served
  from the session's folder the same way, probe and all.

  A live frame of Liner Design's canvas is the same proxied page with Liner Design's frame agent
  (contracts/src/frame-agent.js) in it too, so it speaks the canvas's bridge. Only a request that
  carries the frame's marker gets it: ?__liner_frame=1 on the frame's address (taken off before the
  dev server sees it), the header x-liner-frame: 1, or a page reached from a marked one (its Referer
  has the marker). The Browser panel never sends it, so its pages are as they were.
*/
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import { connect } from "node:net";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { COMPUTED, DESIGN_FRAME_STYLE } from "../../contracts/src/index.ts";
import { FRAME_AGENT } from "./canvas.ts";

const PROBE_PATH = "/__liner/probe.js";
const FRAME_AGENT_PATH = "/__liner/frame-agent.js";
/** The query a live frame's address carries (FRAME_MARK=1), for its page to get the frame agent. */
export const FRAME_MARK = "__liner_frame";

/** A request from a live frame on the canvas: the marker in its address, its header, or the address of the page it came from. */
export function fromFrame(req: Pick<IncomingMessage, "url" | "headers">) {
  if (req.headers["x-liner-frame"] === "1") return true;
  const marked = (u: string | undefined) => {
    try {
      return new URL(u ?? "/", "http://x").searchParams.get(FRAME_MARK) === "1";
    } catch {
      return false;
    }
  };
  return marked(req.url) || marked(typeof req.headers.referer === "string" ? req.headers.referer : undefined);
}

/**
  The address without the frame's marker, as the dev server is asked for it: only the marker's own
  part of the query is cut out of the raw string, every other byte stays as it came (x=1;y=2, a bare
  ?flag, ~, %20), since re-serialising would ask the dev server something else.
*/
export function unmarked(url: string) {
  const q = url.indexOf("?");
  if (q < 0 || !url.includes(FRAME_MARK, q)) return url;
  const h = url.indexOf("#", q);
  const query = url.slice(q + 1, h < 0 ? undefined : h);
  const kept = query.split("&").filter((p) => p !== FRAME_MARK && !p.startsWith(`${FRAME_MARK}=`));
  return `${url.slice(0, q)}${kept.length ? `?${kept.join("&")}` : ""}${h < 0 ? "" : url.slice(h)}`;
}

/** The frame agent, read from disk each time: it's one file the app and the engine share. */
const frameAgent = () => {
  try {
    return readFileSync(FRAME_AGENT, "utf8");
  } catch {
    return "";
  }
};

/**
  A live frame's agent, as one inline <script data-liner-agent> tag that starts by setting the
  computed properties it reads (contracts' COMPUTED), as a drawn frame's tag does (Frame.tsx), so
  the list lives in one place. A "</script" in its text can't end the tag early.
*/
const agentTag = () => `<script data-liner-agent>window.__linerComputed=${JSON.stringify(COMPUTED)};${frameAgent().replace(/<\/script/gi, "<\\/script")}</script>`;

/**
  A request for the proxy itself. A web page that points a name of its own at 127.0.0.1 (DNS
  rebinding) sends that name as its Host, and the dev server's own check for it never sees it,
  since the proxy writes localhost there.
*/
function addressed(server: Server, host?: string) {
  const a = server.address();
  const port = typeof a === "object" && a ? a.port : -1;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/**
  A request from the page the proxy serves, whose origin the dev server doesn't know, so it goes.
  Any other origin stays, so the dev server's own checks still turn other sites away.
*/
const fromItself = (req: IncomingMessage) => req.headers.origin === `http://${req.headers.host}`;

/** A page with the probe as the first thing in its head (and, for a design, the frame's style). */
const withProbe = (html: string, extra = "") => {
  const tag = `<script src="${PROBE_PATH}"></script>${extra}`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
};

/** Opens a server on a port (a free one for 0) of a host and says which. */
const listen = (server: Server, port: number, host: string) =>
  new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const a = server.address();
      resolve(typeof a === "object" && a ? a.port : 0);
    });
  });

/** A proxy's servers (closed together) and the address pages are given. */
type Served = { servers: Server[]; address: Promise<string> };

/**
  Opens a proxy on a free port of 127.0.0.1. Its pages are given as localhost, a site apart from
  the app's 127.0.0.1, so they draw in a process of their own: a live page's frames don't run on
  the app's thread or have its window drawn again. localhost is ::1 as well, so the same port is
  taken there too, for nothing else to answer on it; where it can't be, pages stay on 127.0.0.1.
*/
function serve(server: Server): Served {
  const servers = [server];
  const address = listen(server, 0, "127.0.0.1").then(async (port) => {
    const twin = createServer();
    for (const event of ["request", "upgrade"] as const) for (const on of server.listeners(event)) twin.on(event, on as (...args: unknown[]) => void);
    try {
      await listen(twin, port, "::1");
      servers.push(twin);
      return `http://localhost:${port}`;
    } catch {
      return `http://127.0.0.1:${port}`;
    }
  });
  return { servers, address };
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".map": "application/json", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".otf": "font/otf", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4", ".webm": "video/webm", ".wasm": "application/wasm", ".pdf": "application/pdf",
};

/** Text from a request, safe in a page: anything with this page's address could otherwise run script on it, and read the folder it serves. */
const escaped = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A page of the proxy's own. It carries the probe too: without it Back and Forward do nothing from here. */
const note = (text: string) => `<!doctype html><meta charset="utf-8"><script src="${PROBE_PATH}"></script><body style="font:14px system-ui;color:#666;display:grid;place-items:center;height:90vh"><div>${text}</div>`;

export class Proxies {
  /** Each with its servers, so a second ask while one opens gets the same one, not a server nothing will close. */
  private open = new Map<number, Served>();
  private folders = new Map<string, Served>();

  /**
    A server for a session folder's own files, for a page that needs no dev server: an
    index.html and the scripts, styles and images beside it. Pages get the probe, nothing is
    cached (so a reload shows the agent's latest edit), and nothing outside the folder or
    hidden in it (.env, .git) is served, but for the session's designs (.liner/designs/).
  */
  async files(root: string): Promise<string> {
    const have = this.folders.get(root);
    if (have) return have.address;
    const server = createServer((req, res) => {
      if (!addressed(server, req.headers.host)) return void res.writeHead(403).end();
      if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405).end();
      if (req.url === PROBE_PATH) return void res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(PROBE);
      let rel: string;
      try {
        rel = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      } catch {
        return void res.writeHead(400).end();
      }
      let abs = resolve(root, `.${rel}`);
      const inside = relative(root, abs);
      const parts = inside.split(sep);
      const design = parts[0] === ".liner" && parts[1] === "designs" && parts.length > 2;
      if (inside.startsWith("..") || isAbsolute(inside) || parts.slice(design ? 2 : 0).some((p) => p.startsWith("."))) return void res.writeHead(404, { "content-type": "text/html; charset=utf-8" }).end(note("Not a file of this session's folder."));
      try {
        if (statSync(abs).isDirectory()) abs = join(abs, "index.html");
      } catch {
        // missing; said below
      }
      if (!existsSync(abs) || !statSync(abs).isFile()) return void res.writeHead(404, { "content-type": "text/html; charset=utf-8" }).end(note(`No ${escaped(inside || "index.html")} in this session's folder yet.`));
      const type = TYPES[extname(abs).toLowerCase()] ?? "application/octet-stream";
      const headers = { "content-type": type, "cache-control": "no-store" };
      // A file can go, or be out of reach, between the look above and the read.
      const unread = () => void (res.headersSent ? res.destroy() : res.writeHead(404, { "content-type": "text/html; charset=utf-8" }).end(note(`Couldn't read ${escaped(inside)}.`)));
      if (type.startsWith("text/html")) {
        let page: string;
        try {
          page = readFileSync(abs, "utf8");
        } catch {
          return unread();
        }
        return void res.writeHead(200, headers).end(req.method === "HEAD" ? undefined : withProbe(page, design ? DESIGN_FRAME_STYLE : ""));
      }
      if (req.method === "HEAD") return void res.writeHead(200, { ...headers, "content-length": statSync(abs).size }).end();
      // The headers wait for the file to open, so one that can't be read can still say so.
      const file = createReadStream(abs);
      file.once("error", unread);
      file.once("open", () => {
        res.writeHead(200, { ...headers, "content-length": statSync(abs).size });
        file.pipe(res);
      });
      res.once("close", () => file.destroy());
    });
    const served = serve(server);
    served.address.catch(() => this.folders.delete(root));
    this.folders.set(root, served);
    return served.address;
  }

  /** The proxy's address for a local port, opening one the first time. */
  async url(target: number): Promise<string> {
    if (!Number.isInteger(target) || target < 1024 || target > 65535) throw new Error("That isn't a port on this Mac.");
    const have = this.open.get(target);
    if (have) return have.address;
    const server = createServer((req, res) => {
      if (!addressed(server, req.headers.host)) return void res.writeHead(403).end();
      if (req.url === PROBE_PATH) {
        res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(PROBE);
        return;
      }
      if (req.url === FRAME_AGENT_PATH) return void res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(frameAgent());
      const frame = fromFrame(req);
      const headers: import("node:http").OutgoingHttpHeaders = { ...req.headers, host: `localhost:${target}`, "accept-encoding": "identity" };
      if (fromItself(req)) delete headers.origin;
      delete headers.referer;
      delete headers["x-liner-frame"];
      const up = request({ host: "localhost", port: target, method: req.method, path: frame ? unmarked(req.url ?? "/") : req.url, headers }, (r) => this.answer(r, res, target, own(), frame));
      up.on("error", () => {
        // Partway through an answer, a page of ours would land in the middle of it.
        if (res.headersSent) return void res.destroy();
        res.writeHead(502, { "content-type": "text/html; charset=utf-8" }).end(note(`Nothing answers on localhost:${target}. Start the dev server, then reload.`));
      });
      // The page went (a reload, a tab closed): an event stream to the dev server would stay open for good.
      res.once("close", () => void (res.writableFinished || up.destroy()));
      req.pipe(up);
    });
    // Hot reload and anything else that upgrades: the raw socket goes straight through.
    server.on("upgrade", (req, socket, head) => {
      if (!addressed(server, req.headers.host)) return void socket.destroy();
      const up = connect({ host: "localhost", port: target }, () => {
        const lines = [`${req.method} ${req.url} HTTP/1.1`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const k = req.rawHeaders[i];
          if (/^host$/i.test(k)) lines.push(`Host: localhost:${target}`);
          else if (!/^origin$/i.test(k) || !fromItself(req)) lines.push(`${k}: ${req.rawHeaders[i + 1]}`);
        }
        up.write(`${lines.join("\r\n")}\r\n\r\n`);
        if (head.length) up.write(head);
        socket.pipe(up).pipe(socket);
      });
      const end = () => {
        socket.destroy();
        up.destroy();
      };
      up.on("error", end);
      socket.on("error", end);
    });
    let address = "";
    const own = () => address;
    const served = serve(server);
    served.address.catch(() => this.open.delete(target));
    this.open.set(target, served);
    address = await served.address;
    return address;
  }

  private answer(r: IncomingMessage, res: import("node:http").ServerResponse, target: number, own: string, frame = false) {
    // The dev server died partway: without this the page's request waits for an end that never comes.
    r.once("close", () => void (r.complete || res.destroy()));
    const headers = { ...r.headers };
    // The page shows inside the app, so headers that forbid framing come off.
    delete headers["x-frame-options"];
    delete headers["content-security-policy"];
    delete headers["content-security-policy-report-only"];
    if (typeof headers.location === "string") headers.location = headers.location.replace(new RegExp(`^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\]):${target}`), own);
    const html = String(headers["content-type"] ?? "").includes("text/html");
    if (!html) {
      res.writeHead(r.statusCode ?? 200, headers);
      r.pipe(res);
      return;
    }
    const chunks: Buffer[] = [];
    r.on("data", (c: Buffer) => chunks.push(c));
    r.on("end", () => {
      // A live frame's page gets the frame agent after the probe, tagged data-liner-agent (the agent leaves its own tag out of what it serialises); the Browser's gets the probe alone.
      const body = withProbe(Buffer.concat(chunks).toString("utf8"), frame ? agentTag() : "");
      delete headers["content-length"];
      delete headers["content-encoding"];
      res.writeHead(r.statusCode ?? 200, headers);
      res.end(body);
    });
  }

  closeAll() {
    for (const { servers } of [...this.open.values(), ...this.folders.values()]) for (const server of servers) server.close();
    this.open.clear();
    this.folders.clear();
  }
}

/* The script each page gets. It talks only to the window that framed it. */
const PROBE = `(() => {
  if (window.__linerProbe || window.parent === window) return;
  window.__linerProbe = true;
  const post = (m) => { try { window.parent.postMessage(Object.assign({ __liner: true }, m), "*"); } catch {} };
  const text = (a) => a.map((x) => { if (typeof x === "string") return x; try { return x instanceof Error ? x.stack || x.message : JSON.stringify(x); } catch { return String(x); } }).join(" ").slice(0, 2000);
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const orig = console[level].bind(console);
    console[level] = (...a) => { post({ kind: "console", level, text: text(a), at: Date.now() }); orig(...a); };
  }
  // A ResizeObserver that settles a frame late is reported as an error but harms nothing; DevTools leaves it out too.
  addEventListener("error", (e) => { if (/^ResizeObserver loop/.test(e.message || "")) return; post({ kind: "console", level: "error", text: e.message + (e.filename ? " (" + e.filename.split("/").pop() + ":" + e.lineno + ")" : ""), at: Date.now() }); });
  addEventListener("unhandledrejection", (e) => post({ kind: "console", level: "error", text: "Unhandled: " + text([e.reason]), at: Date.now() }));
  const nav = () => post({ kind: "nav", path: location.pathname + location.search + location.hash, title: document.title });
  for (const k of ["pushState", "replaceState"]) { const o = history[k].bind(history); history[k] = (...a) => { const r = o(...a); nav(); return r; }; }
  addEventListener("popstate", nav);
  addEventListener("hashchange", nav);
  addEventListener("DOMContentLoaded", nav);

  // Offline, as the page sees it: requests fail and navigator.onLine says so.
  let offline = false;
  const of = window.fetch.bind(window);
  window.fetch = (...a) => offline ? Promise.reject(new TypeError("Failed to fetch (offline in Liner Code)")) : of(...a);
  const xs = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) { if (offline) { setTimeout(() => this.dispatchEvent(new Event("error")), 0); return; } return xs.apply(this, a); };
  try { Object.defineProperty(Navigator.prototype, "onLine", { get: () => !offline, configurable: true }); } catch {}

  // Picking an element: a quiet outline follows the pointer; a click reports it.
  let picking = false, box = null, over = null;
  const sel = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return tag + "#" + el.id;
    const cls = [...el.classList].filter((c) => !/^(css|sc|jsx)-/.test(c)).slice(0, 2);
    return tag + (cls.length ? "." + cls.join(".") : "");
  };
  const path = (el) => { const out = []; for (let e = el; e && e.nodeType === 1 && out.length < 4; e = e.parentElement) out.unshift(sel(e)); return out.join(" > "); };
  const show = (el) => {
    if (!box) { box = document.createElement("div"); box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:1.5px solid #2f7ae5;background:rgba(47,122,229,.08);border-radius:4px;transition:all .08s ease-out"; document.documentElement.appendChild(box); }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", display: "block" });
  };
  const move = (e) => { over = e.target; if (over && over !== box) show(over); };
  const click = (e) => {
    e.preventDefault(); e.stopPropagation();
    const el = e.target; const r = el.getBoundingClientRect();
    post({ kind: "picked", selector: sel(el), path: path(el), text: (el.innerText || "").trim().slice(0, 160), html: el.outerHTML.slice(0, 800), rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
    stop();
  };
  const key = (e) => { if (e.key === "Escape") { stop(); post({ kind: "unpicked" }); } };
  const start = () => { if (picking) return; picking = true; addEventListener("mousemove", move, true); addEventListener("click", click, true); addEventListener("keydown", key, true); document.documentElement.style.cursor = "crosshair"; };
  const stop = () => { picking = false; removeEventListener("mousemove", move, true); removeEventListener("click", click, true); removeEventListener("keydown", key, true); document.documentElement.style.cursor = ""; if (box) box.style.display = "none"; };

  // The agent's hands: what the page shows, with its controls numbered, and clicking or typing.
  let controls = [];
  const seen = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const field = (el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !/^(submit|button|reset)$/.test(el.type);
  const label = (el) => String(el.getAttribute("aria-label") || (field(el) ? (el.labels && el.labels[0] && el.labels[0].innerText) || el.placeholder || el.name || el.title : el.innerText || el.value || el.title) || "").trim().replace(/\\s+/g, " ").slice(0, 80);
  const read = () => {
    controls = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=menuitem], [contenteditable=true]")].filter(seen).slice(0, 80);
    return {
      // A frame the window hasn't laid out yet (a window in the background) reads its scripts as text and has no controls.
      laidOut: innerWidth > 0 && document.documentElement.getBoundingClientRect().width > 0,
      url: location.pathname + location.search + location.hash,
      title: document.title,
      text: (document.body ? document.body.innerText : "").replace(/\\n{3,}/g, "\\n\\n").trim().slice(0, 12000),
      controls: controls.map((el, i) => ({ n: i + 1, tag: el.tagName.toLowerCase() + (el.tagName === "INPUT" ? "[" + (el.type || "text") + "]" : ""), label: label(el), value: field(el) && el.value ? String(el.value).slice(0, 80) : undefined })),
      // Canvases (a game, a chart): no controls inside, so the agent clicks points on them.
      canvases: [...document.querySelectorAll("canvas")].filter(seen).slice(0, 5).map((el) => { const r = el.getBoundingClientRect(); return { selector: el.id ? "#" + el.id : "canvas", width: el.width, height: el.height, shown: Math.round(r.width) + "×" + Math.round(r.height) }; }),
    };
  };
  const find = (t) => {
    let s = String(t == null ? "" : t).trim().replace(/^\\d+\\.\\s+(?=\\w)/, "");
    if (!s) return null;
    if (/^\\d+$/.test(s)) return controls[Number(s) - 1] || null;
    // The way a read lists a control: button "Say hello", input[email] "Email".
    const listed = /^([a-z]+)(?:\\[([\\w-]+)\\])?\\s+"(.*)"$/i.exec(s);
    if (listed) {
      const [, tag, type, name] = listed;
      const hit = [...document.querySelectorAll(tag)].filter(seen).find((el) => (!type || (el.type || "text") === type) && label(el).toLowerCase() === name.toLowerCase());
      if (hit) return hit;
      s = name;
    }
    try { const el = document.querySelector(s); if (el) return el; } catch {}
    const low = s.toLowerCase();
    const all = [...document.querySelectorAll("a, button, input, textarea, select, summary, label, [role]")].filter(seen);
    const by = (el) => (label(el) + " " + (el.placeholder || "")).toLowerCase();
    return all.find((el) => label(el).toLowerCase() === low) || all.find((el) => by(el).includes(low)) || null;
  };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  // A click at a point, as a hand would: pointer and mouse, down and up, then the click, on what's there.
  const tap = (x, y) => {
    const el = document.elementFromPoint(x, y) || document.body;
    const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0 };
    const p = Object.assign({ pointerId: 1, pointerType: "mouse", isPrimary: true }, o);
    el.dispatchEvent(new PointerEvent("pointerdown", Object.assign({ buttons: 1 }, p)));
    el.dispatchEvent(new MouseEvent("mousedown", Object.assign({ buttons: 1 }, o)));
    el.dispatchEvent(new PointerEvent("pointerup", p));
    el.dispatchEvent(new MouseEvent("mouseup", o));
    el.dispatchEvent(new MouseEvent("click", o));
  };
  const KEYS = { space: [" ", "Space"], " ": [" ", "Space"], enter: ["Enter", "Enter"], return: ["Enter", "Enter"], escape: ["Escape", "Escape"], esc: ["Escape", "Escape"], tab: ["Tab", "Tab"], backspace: ["Backspace", "Backspace"], up: ["ArrowUp", "ArrowUp"], down: ["ArrowDown", "ArrowDown"], left: ["ArrowLeft", "ArrowLeft"], right: ["ArrowRight", "ArrowRight"] };
  const keyOf = (k) => {
    const s = String(k);
    const named = KEYS[s.toLowerCase()] || (/^arrow(up|down|left|right)$/i.test(s) ? KEYS[s.slice(5).toLowerCase()] : null);
    if (named) return { key: named[0], code: named[1] };
    if (s.length === 1) return { key: s, code: /[a-z]/i.test(s) ? "Key" + s.toUpperCase() : /\d/.test(s) ? "Digit" + s : "" };
    return { key: s, code: s };
  };
  const again = async (d, once) => {
    for (let i = 0; i < (d.times || 1); i++) {
      if (i) await pause(d.every || 150);
      once();
    }
  };
  const act = async (op, d) => {
    if (op === "read") return read();
    if (op === "press") {
      const at = d.target ? find(d.target) : null;
      if (d.target && !at) throw new Error("Nothing on the page matches " + JSON.stringify(String(d.target)) + ". Read the page for its numbered controls.");
      if (at && at.focus) at.focus();
      const k = keyOf(d.key);
      const o = Object.assign({ bubbles: true, cancelable: true, composed: true }, k, { keyCode: k.key === " " ? 32 : k.key === "Enter" ? 13 : k.key === "Escape" ? 27 : k.key.length === 1 ? k.key.toUpperCase().charCodeAt(0) : { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Tab: 9, Backspace: 8 }[k.key] || 0 });
      await again(d, () => { const el = at || document.activeElement || document.body; el.dispatchEvent(new KeyboardEvent("keydown", o)); el.dispatchEvent(new KeyboardEvent("keyup", o)); });
      return { did: "pressed" };
    }
    if (op === "click" && typeof d.x === "number" && typeof d.y === "number") {
      const on = d.target ? find(d.target) : null;
      if (d.target && !on) throw new Error("Nothing on the page matches " + JSON.stringify(String(d.target)) + ". Read the page for its numbered controls.");
      // On a canvas, the point is in its own pixels (as its code draws), drawn at whatever size the page gives it.
      const r = on ? on.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
      const sx = on && on.tagName === "CANVAS" && on.width ? r.width / on.width : 1;
      const sy = on && on.tagName === "CANVAS" && on.height ? r.height / on.height : 1;
      const x = r.left + d.x * sx;
      const y = r.top + d.y * sy;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) throw new Error("That point is off the page as it's shown (" + innerWidth + "×" + innerHeight + ").");
      await again(d, () => tap(x, y));
      // Where it happened, so the Browser can show the agent's cursor there.
      return { did: "clicked", at: { x: x, y: y } };
    }
    let el = find(d.target);
    if (!el) throw new Error("Nothing on the page matches " + JSON.stringify(String(d.target)) + ". Read the page for its numbered controls.");
    if (el.tagName === "LABEL" && el.control) el = el.control;
    el.scrollIntoView({ block: "center" });
    const box = el.getBoundingClientRect();
    const mid = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    if (op === "click") { if (el.focus) el.focus(); await again(d, () => el.click()); return { did: "clicked", at: mid }; }
    if (op === "type") {
      el.focus();
      if (el.isContentEditable) el.textContent = d.text;
      else { const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; const set = Object.getOwnPropertyDescriptor(proto, "value"); if (set && set.set) set.set.call(el, d.text); else el.value = d.text; }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if (d.submit) { const f = el.form; if (f && f.requestSubmit) f.requestSubmit(); else { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })); el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true })); } }
      return { did: "typed", at: mid };
    }
    throw new Error("The page can't " + op + ".");
  };

  addEventListener("message", (e) => {
    if (e.source !== window.parent || !e.data || !e.data.__linerCmd) return;
    const c = e.data.__linerCmd;
    if (c === "agent") {
      Promise.resolve()
        .then(() => act(e.data.op, e.data))
        .then((value) => ({ ok: true, value }), (err) => ({ ok: false, error: String((err && err.message) || err) }))
        .then((r) => post(Object.assign({ kind: "agent", reqId: e.data.reqId }, r)));
      return;
    }
    if (c === "back") history.back();
    else if (c === "forward") history.forward();
    else if (c === "reload") location.reload();
    else if (c === "pick") start();
    else if (c === "unpick") stop();
    else if (c === "offline") { offline = !!e.data.on; dispatchEvent(new Event(offline ? "offline" : "online")); }
    else if (c === "hello") nav();
  });
  nav();
})();`;
