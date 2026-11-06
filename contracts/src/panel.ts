/*
  A panel's frame: the one document an add-on panel runs in, built the same way in the window
  (the dock, a session tab, a page) and in the engine's headless check (addon_check). It runs in an
  iframe with `sandbox="allow-scripts"` and nothing else, so it has an opaque origin: no cookies, no
  storage of the app's, no way into the window around it, no popups, forms or top-level navigation.
  A content policy, first in its head, takes the network away (or leaves the one host its manifest
  names), and a small bridge script, before anything the agent wrote, is its only way to ask Liner
  Code for anything (apiVersion 1).

  A content policy doesn't reach WebRTC: under it a page still sends STUN and TURN to any host. So
  the frame also lives under a Connection-Allowlist, which only a response's header can set: the
  engine serves an empty document with it (panelFrame), and the window writes the panel into that.
  Chromium then gives it no WebRTC: the frame's own peer connections never gather, and one in a
  child frame, which that check misses, is refused its socket by the browser process, which ends
  the renderer that asked (the frame's, apart from the window's). Leaving for a document with no
  allowlist is refused too. A page without the header, the Browser surface's, keeps its WebRTC.

  The agent's files are inlined: scripts and styles it links by a relative path go in as they are,
  pictures as data: addresses. Nothing it names elsewhere loads.
*/
import type { PanelAccess } from "./index.ts";

/** The bridge's version. A frame that speaks another is answered with an error. */
export const PANEL_API = 1;

/** What a frame asks of the window (every message carries `liner: 1`). */
export type PanelRequest = { liner: 1; id: number; method: string; args?: unknown };
/** What it says on its own: that its frame is ready for its document, an error it didn't catch, a request the content policy blocked, that it drew. */
export type PanelReport = { liner: 1; kind: "frame" } | { liner: 1; kind: "error"; message: string; stack?: string } | { liner: 1; kind: "blocked"; host: string; directive: string } | { liner: 1; kind: "ready"; elements: number; width: number; height: number };
/** The window's answer to a request, or news it pushes (`event`): the theme, a change in the session. `doc` answers a frame that's ready. */
export type PanelReply = { liner: 1; doc: string } | { liner: 1; id: number; ok: true; value: unknown } | { liner: 1; id: number; ok: false; error: string } | { liner: 1; event: string; data?: unknown };

/** The app's colours and fonts as CSS variables, the same names a shown page gets. */
export type PanelTheme = Record<string, string>;

const ATTR = (name: string) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
const attr = (tag: string, name: string) => {
  const m = ATTR(name).exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
};
/** A path the frame names, as its files are keyed: relative, no ./, no query. */
const local = (p: string) => {
  const t = p.trim().replace(/[?#].*$/, "").replace(/^\.\//, "");
  if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("/") || t.startsWith("//") || t.split("/").includes("..")) return null;
  return t;
};
const MIME: Record<string, string> = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", json: "application/json", txt: "text/plain", css: "text/css", js: "text/javascript" };
const extOf = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";
/** A picture's file as a data: address. Its content is text for SVG, base64 (as kept) for the rest. */
const dataUrl = (path: string, content: string) => {
  const type = MIME[extOf(path)] ?? "application/octet-stream";
  if (type === "image/svg+xml" || type.startsWith("text/") || type === "application/json") return `data:${type};charset=utf-8,${encodeURIComponent(content)}`;
  return `data:${type};base64,${content}`;
};
/** One of its own files by the path it names: "constructor" names no file, whatever every object inherits. */
const fileOf = (files: Record<string, string>, p: string | null) => (p !== null && Object.hasOwn(files, p) ? files[p] : undefined);
/** A script's text, safe inside a <script> element. */
const scriptText = (js: string) => js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

/** Where a panel's frame loads from, on the app's own origin. */
export const PANEL_FRAME = "/panel-frame";
/** A panel's frame for this access: the one host it may reach goes in the address, for the header. */
export const panelFrameUrl = (access: PanelAccess) => (access.network ? `${PANEL_FRAME}?network=${encodeURIComponent(access.network)}` : PANEL_FRAME);
/** Where this Mac's engine says it's served from, if that's a thing to name in a header. */
const hereOf = (origin?: string) => (origin && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin) ? origin : "");
/** addon_check's page: it reaches its own addresses, and its srcdoc frame inherits the rest of the refusal. */
export const checkConnections = (origin?: string) => (hereOf(origin) ? `("${hereOf(origin)}/addon-check/*")` : "()");
/**
  The empty document a panel is written into, and its headers: null for a host that can't be one.
  It's served on the app's origin to whoever asks, so it holds nothing and can't run as the app:
  its own policy sandboxes it, however it was loaded, and only the app's page may frame it.
  `origin` is where it's served from: the allowlist names this one address, so a panel that
  reloads comes back, and nothing else on this Mac opens to it.
*/
export function panelFrame(network?: string | null, origin?: string) {
  if (network && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(network)) return null;
  const home = hereOf(origin) ? `"${hereOf(origin)}${PANEL_FRAME}"` : "";
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "sandbox allow-scripts; frame-ancestors 'self'",
    "connection-allowlist": `(${[home, network ? `"https://${network}/*"` : ""].filter(Boolean).join(" ")})`,
  };
  // It asks for its document, as it does each time it loads. Writing it drops this listener too.
  // The port comes with it and stays held: it closes when this frame's process ends, which is how
  // the window hears of it. Nothing else reports that.
  const html = `<!doctype html><meta charset="utf-8"><script>addEventListener("message",(e)=>{const d=e.data;if(e.source!==parent||!d||d.liner!==1||typeof d.doc!=="string")return;Object.defineProperty(self,"linerLine",{value:e.ports[0]});document.open();document.write(d.doc);document.close()});parent.postMessage({liner:1,kind:"frame"},"*")</script>`;
  return { headers, html };
}
/**
  A frame that must stay on its document, sending itself anywhere else: what would load there has
  no policy and no allowlist of ours. A srcdoc anywhere, or a panel's frame on the app's origin.
*/
export function sealedFrame(at: string | undefined, to: string, appOrigin: string) {
  const here = (at ?? "").split("#")[0];
  if (to.split("#")[0] === here) return false;
  if (here === "about:srcdoc") return true;
  const u = URL.parse(here);
  return !!u && u.origin === appOrigin && u.pathname === PANEL_FRAME;
}

/** The content policy: nothing but inline scripts and styles, pictures in data:, and at most one host over https. */
export function panelPolicy(access: PanelAccess) {
  const host = access.network ? `https://${access.network}` : "";
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `img-src data: blob:${host ? ` ${host}` : ""}`,
    "font-src data:",
    "media-src data: blob:",
    `connect-src ${host || "'none'"}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/**
  The bridge, as the frame's first script: window.liner, and what it reports on its own. WebRTC is
  removed only so a panel that looks for it finds none, rather than a connection that never comes:
  the allowlist is what stops it, since a child frame has the constructors back.
*/
function shim(access: PanelAccess, theme: PanelTheme, place: string) {
  return `(()=>{"use strict";
delete window.RTCPeerConnection;delete window.webkitRTCPeerConnection;
const post=(m)=>parent.postMessage(Object.assign({liner:1},m),"*");
let n=0;const waiting=new Map();const ears=new Map();const streams=new Map();
const call=(method,args)=>new Promise((ok,no)=>{const id=++n;waiting.set(id,{ok,no});post({id,method,args})});
const ask=(prompt,o)=>{o=o||{};const f=typeof o.onText==="function"?o.onText:null;const id=++n;
return new Promise((ok,no)=>{waiting.set(id,{ok,no});if(f)streams.set(id,f);post({id,method:"ai.ask",args:{prompt,system:o.system,stream:!!f}})}).finally(()=>streams.delete(id))};
addEventListener("message",(e)=>{if(e.source!==parent)return;const d=e.data;if(!d||d.liner!==1)return;
if(d.event==="ai.text"){const f=streams.get(d.data&&d.data.id);if(f)try{f(String(d.data.text))}catch(x){report(x)}return}
if(d.event){if(d.event==="theme")for(const[k,v]of Object.entries(d.data||{}))document.documentElement.style.setProperty(k,v);for(const f of ears.get(d.event)||[])try{f(d.data)}catch(x){report(x)}return}
const w=waiting.get(d.id);if(!w)return;waiting.delete(d.id);d.ok?w.ok(d.value):w.no(new Error(d.error))});
const report=(x)=>post({kind:"error",message:String(x&&x.message||x),stack:x&&x.stack?String(x.stack).slice(0,2000):undefined});
addEventListener("error",(e)=>{if(e.error||e.message)report(e.error||e.message)});
addEventListener("unhandledrejection",(e)=>report(e.reason));
document.addEventListener("securitypolicyviolation",(e)=>{let h="";try{h=new URL(e.blockedURI).host}catch{h=String(e.blockedURI||"")}post({kind:"blocked",host:h,directive:e.effectiveDirective||e.violatedDirective})},true);
const said=()=>{const b=document.body;post({kind:"ready",elements:b?b.getElementsByTagName("*").length:0,width:innerWidth,height:Math.ceil(b?b.scrollHeight:0)})};
addEventListener("load",()=>setTimeout(said,250));
const liner=Object.freeze({apiVersion:${PANEL_API},place:${JSON.stringify(place)},access:Object.freeze(${JSON.stringify(access)}),theme:Object.freeze(${JSON.stringify(theme)}),
call,
on:(ev,f)=>{const s=ears.get(ev)||new Set();s.add(f);ears.set(ev,s);return()=>s.delete(f)},
files:Object.freeze({list:(dir)=>call("files.list",{dir}),read:(path)=>call("files.read",{path}),search:(pattern,o)=>call("files.search",Object.assign({pattern},o||{}))}),
session:Object.freeze({info:()=>call("session.info"),commands:()=>call("session.commands")}),
sessions:Object.freeze({list:()=>call("sessions.list")}),
composer:Object.freeze({put:(text)=>call("composer.put",{text})}),
storage:Object.freeze({get:(key)=>call("storage.get",{key}),set:(key,value)=>call("storage.set",{key,value}),remove:(key)=>call("storage.remove",{key}),keys:()=>call("storage.keys")}),
ai:Object.freeze({ask,model:()=>call("ai.model"),pick:()=>call("ai.pick")})});
Object.defineProperty(window,"liner",{value:liner,writable:false,configurable:false});
})();`;
}

/**
  The frame's whole document. `files` are the panel's own (text as it is, pictures in base64),
  `entry` the HTML among them it opens on.
*/
export function panelDocument(o: { files: Record<string, string>; entry: string; access: PanelAccess; theme: PanelTheme; place: string }) {
  const html = fileOf(o.files, o.entry) ?? `<p>There's no ${o.entry} among its files.</p>`;
  const root = Object.entries(o.theme)
    .map(([k, v]) => `${k}:${v || "initial"}`)
    .join(";");
  const head =
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${panelPolicy(o.access)}"><meta http-equiv="x-dns-prefetch-control" content="off">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><script>${shim(o.access, o.theme, o.place)}</script>` +
    `<style>:root{${root};color-scheme:light dark}html,body{margin:0}body{background:var(--surface);color:var(--ink);font:13.5px/1.55 var(--font),system-ui,sans-serif}code,pre{font-family:var(--font-mono),ui-monospace,monospace}</style>`;
  // Its own scripts, styles and pictures, inlined from its files; anything else it names stays out.
  const body = html
    .replace(/<script\b([^>]*)>\s*<\/script>/gi, (whole, a: string) => {
      const src = attr(` ${a}`, "src");
      const p = src === null ? null : local(src);
      if (src === null) return whole;
      // Named after its file, so an error's stack says app.js:48 rather than about:srcdoc.
      const js = fileOf(o.files, p);
      return p && js !== undefined ? `<script${a.replace(ATTR("src"), "")}>${scriptText(js)}\n//# sourceURL=${p.replace(/[^\w./-]/g, "")}</script>` : "<!-- a script from elsewhere, left out -->";
    })
    .replace(/<link\b[^>]*>/gi, (tag) => {
      const rel = (attr(tag, "rel") ?? "").toLowerCase();
      const href = attr(tag, "href");
      const p = href === null ? null : local(href);
      const css = fileOf(o.files, p);
      if (rel.split(/\s+/).includes("stylesheet")) return css !== undefined ? `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>` : "<!-- a stylesheet from elsewhere, left out -->";
      if (rel.split(/\s+/).includes("icon")) return "";
      return tag;
    })
    .replace(/(\s(?:src|href|poster)\s*=\s*)("([^"]*)"|'([^']*)')/gi, (whole, lead: string, _q: string, a?: string, b?: string) => {
      const p = local(a ?? b ?? "");
      const file = fileOf(o.files, p);
      return p && file !== undefined && /^(?:svg|png|jpe?g|gif|webp)$/.test(extOf(p)) ? `${lead}"${dataUrl(p, file)}"` : whole;
    });
  // The policy and the bridge come before anything of the agent's, always: its own document's
  // wrappers go, so no script of its can run ahead of them (one written before <head> would),
  // and its <body>'s attributes move onto ours.
  const bodyAttrs = /<body\b([^>]*)>/i.exec(body)?.[1] ?? "";
  const inner = body.replace(/<!doctype[^>]*>/gi, "").replace(/<\/?(?:html|head|body)(?=[\s>/])[^>]*>/gi, "");
  return `<!doctype html><html><head>${head}</head><body${bodyAttrs}>${inner}</body></html>`;
}
