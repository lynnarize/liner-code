// Draws the link preview picture (1200 x 630) from the site's own parts: the mark, the headline, one line,
// and the Code window on its stage. Run from site/: node scripts/og.mjs public/og-3.png
// Give it a new file name each time, so apps that keep previews fetch it fresh, and point Base.astro at it.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const out = process.argv[2] ?? 'public/og.png';
const b64 = (p, t) => 'data:' + t + ';base64,' + readFileSync(new URL(p, import.meta.url)).toString('base64');
const shot = b64('../public/shots/face-code-light.webp', 'image/webp'), stage = b64('../public/stage/sky-light.webp', 'image/webp');
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600&family=Inter:wght@400;500&family=JetBrains+Mono:wght@500&display=swap"><style>
*{box-sizing:border-box;margin:0}body{width:1200px;height:630px;background:#fff;color:#0d0f12;font-family:Inter,sans-serif;position:relative;overflow:hidden}
.rail{position:absolute;top:0;bottom:0;width:1px;background:rgba(13,15,18,.1)}.rule{position:absolute;left:0;right:0;height:1px;background:rgba(13,15,18,.1)}
.h{position:absolute;width:9px;height:9px;background:#fff;border:1.5px solid #2a6fe8}
.brand{position:absolute;left:72px;top:40px;display:flex;align-items:center;gap:12px;font:600 30px/1 "Inter Tight";letter-spacing:-.03em}
.tag{position:absolute;right:72px;top:48px;font:500 14px/1 "JetBrains Mono";letter-spacing:.06em;text-transform:uppercase;color:#4b5059}
h1{position:absolute;left:68px;top:128px;font:500 96px/1 "Inter Tight";letter-spacing:-.045em;white-space:nowrap}h1 span{color:#8a9099}
p{position:absolute;left:72px;top:250px;font:400 25px/1.35 Inter;letter-spacing:-.012em;color:#4b5059;white-space:nowrap}
.stage{position:absolute;left:48px;right:48px;top:330px;bottom:0;background:url(${stage}) center/cover;overflow:hidden}
.stage img{position:absolute;left:56px;top:40px;width:992px;border-radius:12px 12px 0 0;border:1px solid rgba(13,15,18,.1);box-shadow:0 28px 64px -28px rgba(22,34,56,.4)}
</style></head><body>
<div class="rail" style="left:48px"></div><div class="rail" style="right:48px"></div><div class="rule" style="top:100px"></div>
<i class="h" style="left:44px;top:96px"></i><i class="h" style="right:44px;top:96px"></i><i class="h" style="left:44px;top:326px"></i><i class="h" style="right:44px;top:326px"></i>
<div class="brand"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#0d0f12" stroke-width="3.4" stroke-linecap="round"><path d="M5.2 19.6 10.6 4.4"/><path d="M13.4 19.6 18.8 4.4" stroke="#2a6fe8"/></svg>Liner</div>
<div class="tag">linercode.dev</div>
<h1>Code it. <span>Design it. Secure it.</span></h1>
<p>The coding agents you already have, in one desktop app, on your own sign-ins.</p>
<div class="stage"><img src="${shot}"></div></body></html>`;
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
await page.setContent(html, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: out });
await browser.close();
