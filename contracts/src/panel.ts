/*
  A panel's frame: the one document an add-on panel runs in, built the same way in the window
  (the dock, a session tab, a page) and in the engine's headless check (addon_check). It is loaded
  as `srcdoc` into an iframe with `sandbox="allow-scripts"` and nothing else, so it has an opaque
  origin: no cookies, no storage of the app's, no way into the window around it, no popups, forms
  or top-level navigation. A content policy, first in its head, takes the network away (or leaves
  the one host its manifest names), and a small bridge script, before anything the agent wrote,
  is its only way to ask Liner Code for anything (apiVersion 1).

  The agent's files are inlined: scripts and styles it links by a relative path go in as they are,
  pictures as data: addresses. Nothing it names elsewhere loads.
*/
import type { PanelAccess } from "./index.ts";

/** The bridge's version. A frame that speaks another is answered with an error. */
export const PANEL_API = 1;

/** What a frame asks of the window (every message carries `liner: 1`). */
export type PanelRequest = { liner: 1; id: number; method: string; args?: unknown };
/** What it says on its own: an error it didn't catch, a request the content policy blocked, that it drew. */
export type PanelReport = { liner: 1; kind: "error"; message: string; stack?: string } | { liner: 1; kind: "blocked"; host: string; directive: string } | { liner: 1; kind: "ready"; elements: number; width: number; height: number };
/** The window's answer to a request, or news it pushes (`event`): the theme, a change in the session. */
export type PanelReply = { liner: 1; id: number; ok: true; value: unknown } | { liner: 1; id: number; ok: false; error: string } | { liner: 1; event: string; data?: unknown };

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
/** A script's text, safe inside a <script> element. */
const scriptText = (js: string) => js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

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

/** The bridge, as the frame's first script: window.liner, and what it reports on its own. */
function shim(access: PanelAccess, theme: PanelTheme, place: string) {
  return `(()=>{"use strict";
const post=(m)=>parent.postMessage(Object.assign({liner:1},m),"*");
let n=0;const waiting=new Map();const ears=new Map();
const call=(method,args)=>new Promise((ok,no)=>{const id=++n;waiting.set(id,{ok,no});post({id,method,args})});
addEventListener("message",(e)=>{if(e.source!==parent)return;const d=e.data;if(!d||d.liner!==1)return;
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
storage:Object.freeze({get:(key)=>call("storage.get",{key}),set:(key,value)=>call("storage.set",{key,value}),remove:(key)=>call("storage.remove",{key}),keys:()=>call("storage.keys")})});
Object.defineProperty(window,"liner",{value:liner,writable:false,configurable:false});
})();`;
}

/**
  The frame's whole document. `files` are the panel's own (text as it is, pictures in base64),
  `entry` the HTML among them it opens on.
*/
export function panelDocument(o: { files: Record<string, string>; entry: string; access: PanelAccess; theme: PanelTheme; place: string }) {
  const html = o.files[o.entry] ?? `<p>There's no ${o.entry} among its files.</p>`;
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
      return p && o.files[p] !== undefined ? `<script${a.replace(ATTR("src"), "")}>${scriptText(o.files[p])}\n//# sourceURL=${p.replace(/[^\w./-]/g, "")}</script>` : "<!-- a script from elsewhere, left out -->";
    })
    .replace(/<link\b[^>]*>/gi, (tag) => {
      const rel = (attr(tag, "rel") ?? "").toLowerCase();
      const href = attr(tag, "href");
      const p = href === null ? null : local(href);
      if (rel.split(/\s+/).includes("stylesheet")) return p && o.files[p] !== undefined ? `<style>${o.files[p].replace(/<\/style/gi, "<\\/style")}</style>` : "<!-- a stylesheet from elsewhere, left out -->";
      if (rel.split(/\s+/).includes("icon")) return "";
      return tag;
    })
    .replace(/(\s(?:src|href|poster)\s*=\s*)("([^"]*)"|'([^']*)')/gi, (whole, lead: string, _q: string, a?: string, b?: string) => {
      const p = local(a ?? b ?? "");
      return p && o.files[p] !== undefined && /^(?:svg|png|jpe?g|gif|webp)$/.test(extOf(p)) ? `${lead}"${dataUrl(p, o.files[p])}"` : whole;
    });
  // The policy and the bridge come before anything of the agent's, always: its own document's
  // wrappers go, so no script of its can run ahead of them (one written before <head> would),
  // and its <body>'s attributes move onto ours.
  const bodyAttrs = /<body\b([^>]*)>/i.exec(body)?.[1] ?? "";
  const inner = body.replace(/<!doctype[^>]*>/gi, "").replace(/<\/?(?:html|head|body)(?=[\s>/])[^>]*>/gi, "");
  return `<!doctype html><html><head>${head}</head><body${bodyAttrs}>${inner}</body></html>`;
}
