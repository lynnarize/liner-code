/*
  A DeepSeek Harness plugin's browser half, in a panel's sealed frame. DSH loads a plugin's
  client.js into its own page: the bundle calls window.__ModuleLoader__.load({ id, factory }), and
  its factory, given `require`, returns a Cordis plugin ({ inject, apply }) whose apply(ctx) puts
  React components into the app's slots with ctx.slots.inject and ctx.slots.register
  (packages/client/modules, packages/client/web/src/platform.ts, and the plugin skill's
  references/ui-plugin.md, in github.com/deepseek-ai/deepseek-harness, MIT).

  Here the same bundle runs in a panel's frame, under a loader of Liner Code's shaped like DSH's:
  `require` answers the shared modules DSH's page shares (React and React DOM; the rest are said to
  be missing), ctx has the slots, effect and the few services a frame can have, and the one slot
  the plugin was ported for (DshPlugin.slot) is drawn full size: a sidebar page's `main` component,
  a right-pane tab's body, or a conversation view. Its own CSS reads DSH's design tokens, which are
  set here from the app's colours (dshTokens), so it follows light and dark like any panel.

  Nothing here reaches DSH's stores, sessions or other slots: a plugin that needs them says so
  rather than drawing half.
*/
import type { DshSlot } from "./index.ts";

/** Where a ported plugin's frame reaches its Node half and its package, on the engine: /dsh/<token>/. */
export const DSH_PATH = "/dsh/";
export const DSH_TOKEN = /^[a-f0-9]{32}$/;
/** A frame's base for its plugin: the app's own origin on this Mac, then /dsh/<token>/. */
export const DSH_BASE = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}\/dsh\/[a-f0-9]{32}\/$/;
export const dshBase = (origin: string, token: string) => `${origin}${DSH_PATH}${token}/`;

/**
  DeepSeek Harness's design tokens (packages/client/ui-theme/src/styles/design-platform.css), each
  set from Liner Code's own (the panel's --bg, --ink…), so a plugin styled with DSH's aliases draws
  in the app's colours. Radii and type sizes are DSH's own values.
*/
export const DSH_TOKENS = `:root{
--dsw-alias-bg-base:var(--bg);--dsw-alias-bg-layer-1:var(--surface);--dsw-alias-bg-layer-2:var(--surface);--dsw-alias-bg-layer-3:var(--well);
--dsw-alias-bg-module-platform:var(--bg);--dsw-alias-bg-skeleton:var(--well);--dsw-alias-bg-mask-1:color-mix(in srgb,var(--ink) 36%,transparent);
--dsw-alias-label-primary:var(--ink);--dsw-alias-label-secondary:var(--ink-2);--dsw-alias-label-tertiary:var(--ink-3);--dsw-alias-label-caption:var(--ink-3);
--dsw-alias-label-dimmed:var(--ink-4);--dsw-alias-label-primary-dimmed:var(--ink-2);--dsw-alias-label-primary-inverted:var(--act-ink);--dsw-alias-label-primary-foreground:var(--act-ink);
--dsw-alias-border-l1:var(--hair);--dsw-alias-border-l2:var(--line);--dsw-alias-border-l3:var(--line);--dsw-alias-border-l4:var(--ink-4);--dsw-alias-border-l2-darkmode-thin:var(--hair);
--dsw-alias-interactive-bg-hover:color-mix(in srgb,var(--ink) 6%,transparent);--dsw-alias-interactive-bg-hover-solid:var(--well);
--dsw-alias-interactive-bg-active:color-mix(in srgb,var(--ink) 10%,transparent);--dsw-alias-interactive-bg-hover-danger:color-mix(in srgb,var(--danger) 10%,transparent);
--dsw-alias-button-primary-fill:var(--act);--dsw-alias-button-primary-hover:color-mix(in srgb,var(--act) 86%,var(--ink));--dsw-alias-button-ghost-active-fill:color-mix(in srgb,var(--ink) 10%,transparent);
--dsw-alias-link:var(--accent);--dsw-alias-brand-primary:var(--accent);--dsw-alias-danger:var(--danger);
--dsw-alias-state-success-primary:var(--ok);--dsw-alias-state-success-tertiary:color-mix(in srgb,var(--ok) 14%,transparent);
--dsw-alias-state-warn-primary:var(--warn);--dsw-alias-state-warn-label:var(--warn);--dsw-alias-state-warn-tertiary:color-mix(in srgb,var(--warn) 14%,transparent);
--dsw-alias-state-error-primary:var(--danger);--dsw-alias-state-error-secondary:color-mix(in srgb,var(--danger) 70%,var(--surface));
--dsw-alias-state-business-primary:var(--accent);--dsw-alias-state-business-tertiary:color-mix(in srgb,var(--accent) 14%,transparent);
--dsw-alias-markdown-code-block:var(--well);--dsw-alias-menu-icon:var(--ink-2);--dsw-alias-illustration-detail:var(--ink-3);
--dsw-alias-scrollbar-bg-l2:color-mix(in srgb,var(--ink) 18%,transparent);--dsw-alias-scrollbar-hover-l2:color-mix(in srgb,var(--ink) 30%,transparent);
--dsw-alias-settings-card-fill:var(--surface);--dsw-alias-settings-card-stroke:var(--hair);
--dsw-specific-sidebar-fill:var(--bg);--dsw-specific-menu:var(--surface);--dsw-specific-input-major:var(--surface);
--dsw-font-family:var(--font),system-ui,sans-serif;--dsw-font-mono:var(--font-mono),ui-monospace,monospace;
--dsw-font-l-20:500 20px/28px var(--dsw-font-family);--dsw-font-m-18:500 16px/28px var(--dsw-font-family);--dsw-font-s-14:14px/22px var(--dsw-font-family);
--dsw-font-xs-13:13px/20px var(--dsw-font-family);--dsw-font-xs-strong-13:500 13px/20px var(--dsw-font-family);--dsw-font-xxs-12:12px/18px var(--dsw-font-family);--dsw-font-xxxs-11:11px/14px var(--dsw-font-family);
--dsw-radius-xs:4px;--dsw-radius-sm:8px;--dsw-radius-md:12px;--dsw-radius-lg:16px;--dsw-radius-xl:20px;--dsw-radius-panel:28px;
--dsw-elevation-stroke-color:var(--hair);--dsw-elevation-stroke:0 0 0 .5px var(--dsw-elevation-stroke-color);
--dsw-elevation-soft:0 1px 2px color-mix(in srgb,var(--ink) 8%,transparent),var(--dsw-elevation-stroke);
--dsw-elevation-panel:0 4px 18px color-mix(in srgb,var(--ink) 10%,transparent),var(--dsw-elevation-stroke);
--dsw-elevation-prominent:0 12px 36px color-mix(in srgb,var(--ink) 16%,transparent),var(--dsw-elevation-stroke);
--dsw-focus-ring-color:var(--accent);--dsw-focus-ring-width:2px;--dsh-frame-leading-clearance:0px}
html,body,#dsh-root{height:100%}body{overflow:hidden}#dsh-root{overflow:auto}`;

/**
  The loader and the plugin's ctx, as the frame's script after the bridge and the shared modules
  (window.__dshPlatform, which the window bundles from its own React). It starts the plugin once the
  page is parsed, so its client.js, further down, has registered its factory by then.
*/
export function dshRuntime(o: { package: string; slot: DshSlot; config?: Record<string, unknown> }) {
  const cfg = JSON.stringify({ pkg: o.package, slot: o.slot, config: o.config ?? {} }).replace(/</g, "\\u003c");
  return `(()=>{"use strict";
const P=self.__dshPlatform||{};try{delete self.__dshPlatform}catch{}
const C=${cfg};
const SHARED={"react":P.react,"react/jsx-runtime":P.jsx,"react/jsx-dev-runtime":P.jsx,"react-dom":P.dom,"react-dom/client":P.client};
const factories=new Map(),made=new Map(),busy=new Set();
const lacks=(what)=>new Error(C.pkg+" needs "+what+", a part of DeepSeek Harness that Liner Code doesn't have.");
const req=(spec)=>{spec=String(spec);
if(Object.hasOwn(SHARED,spec)&&SHARED[spec])return SHARED[spec];
const id=factories.has(spec)?spec:spec.endsWith("/client")&&factories.has(spec.slice(0,-7))?spec.slice(0,-7):null;
if(id===null)throw lacks(spec);
if(made.has(id))return made.get(id);
if(busy.has(id))throw new Error(id+" requires itself while it loads.");
busy.add(id);try{const m=factories.get(id)(req);made.set(id,m);return m}finally{busy.delete(id)}};
req.async=(p)=>Promise.reject(lacks("a split chunk ("+p+")"));
req.asset=(p)=>String(p);
Object.defineProperty(window,"__ModuleLoader__",{value:Object.freeze({load:(h)=>{if(h&&typeof h.id==="string"&&typeof h.factory==="function"&&!factories.has(h.id))factories.set(h.id,h.factory)}}),configurable:false});
const fail=(x)=>{const e=x instanceof Error?x:new Error(String(x));dispatchEvent(new ErrorEvent("error",{error:e,message:e.message}))};
const regs=[];const ears=new Set();let queued=false;
const changed=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;for(const f of ears)try{f()}catch(x){fail(x)}})};
const slots=Object.freeze({
inject:(name,fn)=>{const d=fn();return typeof d==="function"?d:()=>{}},
register:(options,component)=>{const r={options:Object.assign({},options),component};regs.push(r);changed();return()=>{const i=regs.indexOf(r);if(i>=0){regs.splice(i,1);changed()}}},
entriesOfSlot:(name)=>regs.filter((r)=>r.options.name===name).map((r)=>({options:r.options,component:r.component})),
subscribe:(name,f)=>{const g=()=>f();ears.add(g);return()=>ears.delete(g)}});
const log=(...a)=>console.log("["+C.pkg+"]",...a);
const logger=Object.assign((...a)=>log(...a),{info:log,debug:log,success:log,warn:(...a)=>console.warn("["+C.pkg+"]",...a),error:(...a)=>console.error("["+C.pkg+"]",...a)});
const services={slots,logger};
const ends=[];
const keep=(r)=>{if(typeof r==="function")ends.push(r);else if(r&&typeof r.next==="function"&&typeof r[Symbol.iterator]==="function"){for(const d of r)keep(d)}else if(r&&typeof r.then==="function")r.then(keep,fail)};
const named=(inject,which)=>{if(!inject)return[];if(Array.isArray(inject))return which==="required"?inject:[];if(Array.isArray(inject[which]))return inject[which];
return Object.entries(inject).filter(([k,v])=>k!=="required"&&k!=="optional"&&(which==="required"?v===true||!!(v&&v.required):!!(v&&v.required===false))).map(([k])=>k)};
const base={name:C.pkg,fiber:Object.freeze({entry:undefined}),
effect:(fn)=>{try{keep(fn())}catch(x){fail(x)}return()=>{}},
on:()=>()=>{},once:()=>()=>{},off:()=>{},emit:()=>{},parallel:()=>{},serial:()=>{},bail:()=>{},
get:(n)=>services[n],set:(n,v)=>{services[n]=v;return()=>{delete services[n]}},provide:()=>{},
inject:(deps,fn)=>start({inject:deps,apply:fn}),
plugin:(p,config)=>start(p,config),
logger:(n)=>logger};
const ctx=new Proxy(base,{get:(t,k)=>(k in t?t[k]:services[k]),has:(t,k)=>k in t||k in services});
const isClass=(f)=>typeof f==="function"&&/^class[\\s{]/.test(Function.prototype.toString.call(f));
function start(mod,config){
let p=mod;if(p&&typeof p==="object"&&!p.apply&&p.default)p=p.default;
if(!p)throw new Error(C.pkg+"'s client.js gave no plugin.");
const inject=p.inject??(mod&&mod.inject);
const missing=named(inject,"required").filter((n)=>!(n in services));
if(missing.length)throw lacks("the "+missing.join(", ")+" service"+(missing.length>1?"s":""));
if(isClass(p))return new p(ctx,config);
const apply=typeof p==="function"?p:p.apply;
if(typeof apply!=="function")throw new Error(C.pkg+"'s client.js has no apply.");
return apply.call(p,ctx,config)}
const R=SHARED.react,D=SHARED["react-dom/client"];
const pick=()=>{
if(C.slot==="sidebar.panellist"){const e=regs.find((r)=>r.options.name==="sidebar.panellist");const id=e&&(e.options.id??e.options.key);const main=regs.filter((r)=>r.options.name==="main");return main.find((r)=>id!==undefined&&(r.options.key===id||r.options.id===id))||main[0]}
return regs.find((r)=>r.options.name===C.slot)};
const scheme=()=>{const c=getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();const m=/^#?([0-9a-f]{6})$/i.exec(c);let dark=false;
if(m){const n=parseInt(m[1],16);dark=(((n>>16)&255)*299+((n>>8)&255)*587+(n&255)*114)/1000<128}else{const r=/rgba?\\(([\\d.]+)[ ,]+([\\d.]+)[ ,]+([\\d.]+)/.exec(c);if(r)dark=(+r[1]*299+ +r[2]*587+ +r[3]*114)/1000<128}
document.documentElement.dataset.theme=dark?"dark":"light";document.documentElement.style.colorScheme=dark?"dark":"light"};
function boot(){
document.documentElement.lang=document.documentElement.lang||"en";scheme();
if(self.liner&&liner.on)liner.on("theme",()=>setTimeout(scheme));
if(!R||!D)return fail(new Error("Liner Code's React didn't load, so "+C.pkg+" can't draw."));
const el=document.getElementById("dsh-root")||document.body.appendChild(document.createElement("div"));
try{start(req(C.pkg),C.config)}catch(x){return fail(x)}
class Edge extends R.Component{constructor(p){super(p);this.state={x:null}}static getDerivedStateFromError(x){return{x}}componentDidCatch(x){fail(x)}render(){return this.state.x?null:this.props.children}}
const root=D.createRoot(el);
const draw=()=>{const r=pick();if(!r){if(!regs.length)return;return root.render(R.createElement("p",{style:{padding:"24px",color:"var(--ink-3)"}},C.pkg+" didn't put anything where Liner Code shows it."))}
let props={};try{if(typeof r.options.inject==="function")props=r.options.inject("liner")||{}}catch(x){fail(x)}
root.render(R.createElement(Edge,null,R.createElement(r.component,props)))};
ears.add(draw);draw()}
if(document.readyState==="loading")addEventListener("DOMContentLoaded",boot,{once:true});else queueMicrotask(boot);
})();`;
}

/** The page a ported plugin's frame opens on: its root and its client.js, which the frame inlines. */
export const dshEntry = (name: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${name.replace(/[<&>"]/g, "")}</title></head><body><div id="dsh-root"></div><script src="client.js"></script></body></html>\n`;
