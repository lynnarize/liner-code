/*
  Run by dsh-frame.test.ts inside real Electron: a ported DeepSeek Harness plugin's page, in a
  panel's sealed frame, as the window builds it. A fake plugin bundle registers with the loader,
  draws with the shared React, and from its frame fetches its own program's route and picture at
  its base (/dsh/<token>/), and something else on this Mac. Each case prints one JSON line.
*/
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const { dshEntry, panelDocument, panelFrame, panelFrameUrl, sealedFrame } = require(process.env.PANEL_BUNDLE);
const platform = require("node:fs").readFileSync(process.env.PLATFORM_BUNDLE, "utf8");

const TOKEN = "0123456789abcdef0123456789abcdef";
const json = (v) => JSON.stringify(v).replaceAll("<", "\\u003c");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

/** A DSH plugin's client.js, as its build emits one: React from the loader, a page in `main` keyed to its sidebar entry. */
const client = (secret) => `window.__ModuleLoader__.load({id:"dsh-fake",factory:(require)=>{const module={exports:{}};
const React=require("react");const h=React.createElement;const say=(m)=>parent.postMessage(Object.assign({liner:1,kind:"dsh-test"},m),"*");
function Main(){const [t,setT]=React.useState("loading");
React.useEffect(()=>{
fetch("fake/ping",{method:"POST",headers:{"content-type":"application/json","x-fake":"1"},body:"{}"}).then((r)=>r.json()).then((j)=>{setT("pong:"+j.pong);say({ping:j.pong})},(e)=>say({ping:"fail "+e.message}));
fetch(${json(secret)}).then(()=>say({other:"reached"}),()=>say({other:"refused"}));
},[]);
return h("div",{id:"main"},t,h("img",{src:"plugins/dsh-fake/assets/dot.png",onLoad:()=>say({img:"loaded"}),onError:()=>say({img:"error"})}))}
module.exports={inject:["slots"],apply(ctx){ctx.slots.inject("main",()=>ctx.slots.register({name:"main",key:"fake"},Main));
ctx.effect(()=>ctx.slots.inject("sidebar.panellist",()=>ctx.slots.register({name:"sidebar.panellist",id:"fake",order:5,label:()=>"Fake"},()=>null)))}};
return module.exports}})`;

const hits = { ping: 0, preflight: 0, picture: 0, secret: 0 };
const pages = new Map();
const server = http.createServer((q, r) => {
  const u = new URL(q.url, "http://x");
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": String(q.headers["access-control-request-headers"] ?? "content-type"), "access-control-allow-methods": "GET, POST, OPTIONS" };
  if (u.pathname === "/panel-frame") {
    const f = panelFrame(u.searchParams.get("network"), `http://${q.headers.host}`, u.searchParams.get("dsh"));
    return f ? r.writeHead(200, f.headers).end(f.html) : r.writeHead(400).end();
  }
  if (u.pathname === `/dsh/${TOKEN}/fake/ping`) {
    if (q.method === "OPTIONS") return hits.preflight++, r.writeHead(204, cors).end();
    hits.ping++;
    return r.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ pong: "yes" }));
  }
  if (u.pathname === `/dsh/${TOKEN}/plugins/dsh-fake/assets/dot.png`) return hits.picture++, r.writeHead(200, { ...cors, "content-type": "image/png" }).end(PNG);
  if (u.pathname === "/secret") return hits.secret++, r.writeHead(200, { ...cors, "content-type": "text/plain" }).end("secret");
  const page = pages.get(u.pathname);
  if (!page) return r.writeHead(404).end();
  r.writeHead(200, { "content-type": "text/html" }).end(page);
});

let next = 0;
async function run(name, { allow = true } = {}) {
  for (const k of Object.keys(hits)) hits[k] = 0;
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = `${origin}/dsh/${TOKEN}/`;
  const doc = panelDocument({
    files: { "index.html": dshEntry("Fake"), "client.js": client(`${origin}/secret`) },
    entry: "index.html",
    access: {},
    theme: { "--bg": "#ffffff", "--surface": "#ffffff", "--ink": "#111111" },
    place: "page",
    dsh: { frame: { package: "dsh-fake", slot: "sidebar.panellist", base: `/dsh/${TOKEN}/` }, platform, base },
  });
  const path = `/case/${++next}`;
  pages.set(
    path,
    `<!doctype html><title>host</title><iframe id="p" sandbox="allow-scripts" src="${panelFrameUrl({}, allow)}"></iframe><script>
    self.heard=[];const doc=${json(doc)};
    addEventListener("message",(e)=>{if(e.source!==p.contentWindow||!e.data||e.data.liner!==1)return;
    if(e.data.kind!=="frame")return heard.push(e.data);
    const c=new MessageChannel();(self.lines||=[]).push(c.port1);c.port1.start();p.contentWindow.postMessage({liner:1,doc},"*",[c.port2])});</` + "script>",
  );
  const w = new BrowserWindow({ show: false, width: 600, height: 400, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const wc = w.webContents;
  wc.on("will-frame-navigate", (e) => {
    if (!e.isMainFrame && sealedFrame(e.frame?.url, e.url, origin)) e.preventDefault();
  });
  wc.loadURL(origin + path).catch(() => {});
  await new Promise((ok) => setTimeout(ok, 3500));
  const out = { name, hits: { ...hits } };
  try {
    out.heard = await wc.mainFrame.executeJavaScript("self.heard");
  } catch (e) {
    out.error = String(e);
  }
  w.destroy();
  process.stdout.write(`CASE ${JSON.stringify(out)}\n`);
}

app.whenReady().then(async () => {
  try {
    await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
    await run("dsh frame");
    await run("no dsh allowlist", { allow: false });
  } catch (e) {
    process.stdout.write(`FAILED ${String(e && e.stack ? e.stack : e)}\n`);
    app.exit(1);
    return;
  }
  server.close();
  app.exit(0);
});
app.on("window-all-closed", () => {});
