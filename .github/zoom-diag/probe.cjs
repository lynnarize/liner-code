/*
  A throwaway probe for CI run 44704625376: on GitHub's Mac runner, desktop/test/browser-zoom.test.ts's control case (a
  page of another site in a frame shrunk by a CSS transform) reports a window 0 wide, even after 4 s, while the same
  page shrunk by zoom is sized. Each variant here changes one thing and prints what the frame says, so the runner's
  numbers tell which one matters. Run with Electron: `electron .github/zoom-diag/probe.cjs`. Delete with its workflow.
*/
const { app, BrowserWindow, screen } = require("electron");
const http = require("node:http");

const BOX = { width: 348, height: 686 };
const DESKTOP = 1280;
const scale = BOX.width / DESKTOP;
const TRANSFORM = `width:${DESKTOP}px;height:${100 / scale}%;transform:scale(${scale});`;
const ZOOM = `width:${BOX.width / scale}px;height:${BOX.height / scale}px;zoom:${scale};`;
const script = (js) => `<script>${js}</` + "script>";

const page = `<!doctype html><body style="margin:0"><canvas id="c"></canvas>${script(
  `const say=(why)=>{c.width=Math.round(innerWidth*devicePixelRatio);c.height=Math.round(innerHeight*devicePixelRatio);parent.postMessage({page:1,why,t:Math.round(performance.now()),w:innerWidth,h:innerHeight,dpr:devicePixelRatio,vv:visualViewport?[visualViewport.width,visualViewport.height]:null,hidden:document.hidden,vis:document.visibilityState},"*")};addEventListener("resize",()=>say("resize"));addEventListener("load",()=>say("load"));document.addEventListener("visibilitychange",()=>say("visibility"));say("start");setTimeout(()=>say("1s"),1000)`,
)}`;
const host = (src, css) =>
  `<!doctype html><body style="margin:0"><div style="position:relative;width:${BOX.width}px;height:${BOX.height}px;overflow:hidden"><iframe id="f" src="${src}" style="position:absolute;top:0;left:0;border:0;transform-origin:0 0;${css}"></iframe></div>${script(
    `self.log=[];addEventListener("message",(e)=>{if(e.source===f.contentWindow&&e.data&&e.data.page)log.push(e.data)})`,
  )}`;

const styles = new Map();
const server = http.createServer((q, r) => {
  const u = new URL(q.url, "http://x");
  if (u.pathname === "/page") return r.writeHead(200, { "content-type": "text/html" }).end(page);
  const c = styles.get(u.pathname);
  if (!c) return r.writeHead(404).end();
  const port = server.address().port;
  r.writeHead(200, { "content-type": "text/html" }).end(host(`http://${c.site}:${port}/page`, c.css));
});

let next = 0;
async function run(name, { css, site = "localhost", show = false, wait = 4000, x, y }) {
  const path = `/case/${++next}`;
  styles.set(path, { css, site });
  const w = new BrowserWindow({ show, width: 800, height: 800, x, y, useContentSize: true, paintWhenInitiallyHidden: true, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const wc = w.webContents;
  const out = { name, site, show, wait };
  try {
    await wc.loadURL(`http://127.0.0.1:${server.address().port}${path}`);
    await new Promise((ok) => setTimeout(ok, wait));
    Object.assign(out, await wc.mainFrame.executeJavaScript(`(()=>{const r=f.getBoundingClientRect();return {log:self.log,hostDpr:devicePixelRatio,hostHidden:document.hidden,client:[f.clientWidth,f.clientHeight],drawn:[r.width,r.height]}})()`));
    const frames = wc.mainFrame.framesInSubtree;
    out.processes = frames.map((f) => f.processId);
    out.child = frames[1] ? await frames[1].executeJavaScript("[innerWidth, innerHeight, document.visibilityState]").catch((e) => String(e)) : null;
    out.visible = w.isVisible();
    out.bounds = w.getContentBounds();
  } catch (e) {
    out.error = String(e);
  }
  w.destroy();
  console.log(`CASE ${JSON.stringify(out)}`);
}

app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  try {
    console.log(`ENV ${JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, displays: screen.getAllDisplays().map((d) => ({ bounds: d.bounds, scale: d.scaleFactor })), gpu: app.getGPUFeatureStatus() })}`);
    await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
    await run("transform, other site, hidden (the failing case)", { css: TRANSFORM });
    await run("zoom, other site, hidden (passes on CI)", { css: ZOOM });
    await run("transform, same site, hidden", { css: TRANSFORM, site: "127.0.0.1" });
    await run("transform, other site, shown", { css: TRANSFORM, show: true });
    await run("transform, other site, shown off-screen", { css: TRANSFORM, show: true, x: -3000, y: -3000 });
    await run("transform, other site, hidden, 10 s", { css: TRANSFORM, wait: 10_000 });
    await run("no transform, full size, other site, hidden", { css: `width:${DESKTOP}px;height:2523px;` });
    await run("transform 0.5, other site, hidden", { css: `width:${DESKTOP}px;height:1372px;transform:scale(0.5);` });
  } catch (e) {
    console.log(`FAILED ${e?.stack ?? e}`);
  }
  server.close();
  app.exit(0);
});
