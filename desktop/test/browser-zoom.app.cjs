/*
  Run by browser-zoom.test.ts inside real Electron: a page in a frame of another site, as the
  Browser surface holds one, in a box 348 by 686. The page sizes a canvas by its window, as an
  animation does, and says what it found; each case's result is printed as one JSON line.
*/
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const { DESKTOP, frameBox } = require(process.env.FRAME_BUNDLE);

const BOX = { width: 348, height: 686 };
const script = (js) => `<script>${js}</` + "script>";

// Anybody's animation: a canvas as large as the window, at the pixels the window says it has.
const page = `<!doctype html><body style="margin:0"><canvas id="c"></canvas>${script(
  `const say=()=>{c.width=Math.round(innerWidth*devicePixelRatio);c.height=Math.round(innerHeight*devicePixelRatio);parent.postMessage({page:1,w:innerWidth,h:innerHeight,dpr:devicePixelRatio,canvas:[c.width,c.height],wide:matchMedia("(min-width: 1280px)").matches},"*")};addEventListener("resize",say);say()`,
)}`;
/** The window's page: the Browser's zoom box and its frame, placed as surfaces.css places them. */
const host = (frameSrc, css) =>
  `<!doctype html><body style="margin:0"><div style="position:relative;width:${BOX.width}px;height:${BOX.height}px;overflow:hidden"><iframe id="f" src="${frameSrc}" style="position:absolute;top:0;left:0;border:0;transform-origin:0 0;${css}"></iframe></div>${script(
    `self.heard=null;addEventListener("message",(e)=>{if(e.source===f.contentWindow&&e.data&&e.data.page)heard=e.data})`,
  )}`;

const styles = new Map();
const server = http.createServer((q, r) => {
  const u = new URL(q.url, "http://x");
  if (u.pathname === "/page") return r.writeHead(200, { "content-type": "text/html" }).end(page);
  const css = styles.get(u.pathname);
  if (css === undefined) return r.writeHead(404).end();
  // The app is at 127.0.0.1 and the page at localhost: another site, so another process, as the engine's proxy has it.
  r.writeHead(200, { "content-type": "text/html" }).end(host(`http://localhost:${server.address().port}/page`, css));
});

let next = 0;
async function run(name, css) {
  const path = `/case/${++next}`;
  styles.set(path, css);
  const w = new BrowserWindow({ show: false, width: 800, height: 800, useContentSize: true, paintWhenInitiallyHidden: true, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const wc = w.webContents;
  const out = { name, css };
  try {
    await wc.loadURL(`http://127.0.0.1:${server.address().port}${path}`);
    // The page says again whenever its window's size changes: what it said last, once it has settled. On a cold runner
    // its first word can come before the frame is laid out, as a window 0 wide (CI run 44701494292), so wait for a size.
    for (let i = 0; i < 40 && !(await wc.mainFrame.executeJavaScript("Boolean(self.heard && self.heard.w > 0)")); i++) await new Promise((ok) => setTimeout(ok, 100));
    await new Promise((ok) => setTimeout(ok, 300));
    Object.assign(out, await wc.mainFrame.executeJavaScript(`(()=>{const r=f.getBoundingClientRect();return {page:self.heard,hostDpr:devicePixelRatio,client:[f.clientWidth,f.clientHeight],drawn:[r.width,r.height]}})()`));
    out.processes = wc.mainFrame.framesInSubtree.map((f) => f.processId);
    // The frame's own size, read from inside it rather than from what it last posted: tells a late word from no size.
    const inner = wc.mainFrame.framesInSubtree[1];
    out.inner = inner ? await inner.executeJavaScript("[innerWidth, innerHeight, document.visibilityState]").catch((e) => String(e)) : null;
  } catch (e) {
    out.error = String(e);
  }
  w.destroy();
  console.log(`CASE ${JSON.stringify(out)}`);
}

const cssOf = (s) => `width:${s.width};height:${s.height};${s.zoom === undefined ? "" : `zoom:${s.zoom};`}`;

async function all() {
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const scale = BOX.width / DESKTOP;
  // The test can see: the same page under a transform, as the Browser drew it before, is asked for every pixel of 1280 by 2523.
  await run("under a transform", `width:${DESKTOP}px;height:${100 / scale}%;transform:scale(${scale});`);
  await run("Desktop in a narrow panel", cssOf(frameBox(null, 1, BOX.width).style));
  await run("at its own pixels", cssOf(frameBox(null, 1, 0).style));
  await run("zoomed in", cssOf(frameBox(null, 1.5, 0).style));
  server.close();
}

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
