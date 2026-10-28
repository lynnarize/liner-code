/*
  The Browser surface's window onto a dev server. The app can't reach into a page on another
  origin, so the engine opens a small proxy for each local port you browse: it passes every
  request through (WebSockets too, so hot reload keeps working) and adds one script to each HTML
  page. That script reports console lines and navigation to the app, and answers its commands:
  back, forward, reload, pick an element, simulate offline, and, for an agent, read the page and
  click or type in it. Only ports on this machine, only on 127.0.0.1.
*/
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import { connect } from "node:net";

const PROBE_PATH = "/__liner/probe.js";

export class Proxies {
  private open = new Map<number, { server: Server; port: number }>();

  /** The proxy's address for a local port, opening one the first time. */
  async url(target: number): Promise<string> {
    if (!Number.isInteger(target) || target < 1024 || target > 65535) throw new Error("That isn't a port on this Mac.");
    const have = this.open.get(target);
    if (have) return `http://127.0.0.1:${have.port}`;
    const server = createServer((req, res) => {
      if (req.url === PROBE_PATH) {
        res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(PROBE);
        return;
      }
      const headers = { ...req.headers, host: `localhost:${target}`, "accept-encoding": "identity" };
      delete headers.origin;
      delete headers.referer;
      const up = request({ host: "localhost", port: target, method: req.method, path: req.url, headers }, (r) => this.answer(r, res, target, own()));
      up.on("error", () => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;color:#666;display:grid;place-items:center;height:90vh"><div>Nothing answers on localhost:${target}. Start the dev server, then reload.</div>`);
      });
      req.pipe(up);
    });
    // Hot reload and anything else that upgrades: the raw socket goes straight through.
    server.on("upgrade", (req, socket, head) => {
      const up = connect({ host: "localhost", port: target }, () => {
        const lines = [`${req.method} ${req.url} HTTP/1.1`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const k = req.rawHeaders[i];
          if (/^host$/i.test(k)) lines.push(`Host: localhost:${target}`);
          else if (!/^origin$/i.test(k)) lines.push(`${k}: ${req.rawHeaders[i + 1]}`);
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
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const a = server.address();
        resolve(typeof a === "object" && a ? a.port : 0);
      });
    });
    const own = () => `http://127.0.0.1:${port}`;
    this.open.set(target, { server, port });
    return own();
  }

  private answer(r: IncomingMessage, res: import("node:http").ServerResponse, target: number, own: string) {
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
      let body = Buffer.concat(chunks).toString("utf8");
      const tag = `<script src="${PROBE_PATH}"></script>`;
      body = /<head[^>]*>/i.test(body) ? body.replace(/<head[^>]*>/i, (m) => m + tag) : tag + body;
      delete headers["content-length"];
      delete headers["content-encoding"];
      res.writeHead(r.statusCode ?? 200, headers);
      res.end(body);
    });
  }

  closeAll() {
    for (const { server } of this.open.values()) server.close();
    this.open.clear();
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
  addEventListener("error", (e) => post({ kind: "console", level: "error", text: e.message + (e.filename ? " (" + e.filename.split("/").pop() + ":" + e.lineno + ")" : ""), at: Date.now() }));
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
      url: location.pathname + location.search + location.hash,
      title: document.title,
      text: (document.body ? document.body.innerText : "").replace(/\\n{3,}/g, "\\n\\n").trim().slice(0, 12000),
      controls: controls.map((el, i) => ({ n: i + 1, tag: el.tagName.toLowerCase() + (el.tagName === "INPUT" ? "[" + (el.type || "text") + "]" : ""), label: label(el), value: field(el) && el.value ? String(el.value).slice(0, 80) : undefined })),
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
  const act = (op, d) => {
    if (op === "read") return read();
    let el = find(d.target);
    if (!el) throw new Error("Nothing on the page matches " + JSON.stringify(String(d.target)) + ". Read the page for its numbered controls.");
    if (el.tagName === "LABEL" && el.control) el = el.control;
    el.scrollIntoView({ block: "center" });
    if (op === "click") { if (el.focus) el.focus(); el.click(); return { did: "clicked" }; }
    if (op === "type") {
      el.focus();
      if (el.isContentEditable) el.textContent = d.text;
      else { const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; const set = Object.getOwnPropertyDescriptor(proto, "value"); if (set && set.set) set.set.call(el, d.text); else el.value = d.text; }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if (d.submit) { const f = el.form; if (f && f.requestSubmit) f.requestSubmit(); else { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })); el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true })); } }
      return { did: "typed" };
    }
    throw new Error("The page can't " + op + ".");
  };

  addEventListener("message", (e) => {
    if (e.source !== window.parent || !e.data || !e.data.__linerCmd) return;
    const c = e.data.__linerCmd;
    if (c === "agent") {
      let r;
      try { r = { ok: true, value: act(e.data.op, e.data) }; } catch (err) { r = { ok: false, error: String((err && err.message) || err) }; }
      post(Object.assign({ kind: "agent", reqId: e.data.reqId }, r));
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
