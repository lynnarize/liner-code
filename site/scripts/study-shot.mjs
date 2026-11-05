// The hero's window, taken from the 0.2.2 layout study (docs/research/harness-layout.html), the same
// window the 0.2.2 release video films: dark, its numbers off, the session at work with Changes
// open on the right. Drawn at 1360 by 800 and saved at 2x with its rounded corners transparent.
//   node scripts/study-shot.mjs [out.png]
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const study = join(here, '../../docs/research/harness-layout.html');
const out = resolve(process.argv[2] ?? join(here, '../.mac-shots/dark/study.png'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(study).href);
await page.click('[data-theme-btn="t-dark"]');
if ((await page.getAttribute('#marks-btn', 'aria-pressed')) === 'true') await page.click('#marks-btn');
// Only the window: the page around it goes transparent so the corners come out clean.
// The study scales the window to its column; here it is drawn at its own size. Its frame line sits
// outside the box there, so it is drawn just inside here, where the picture keeps it.
await page.addStyleTag({ content: `html, body, main, .stage { background: transparent !important; }
  .stage { overflow: visible !important; width: 1360px !important; height: 800px !important; }
  #win { transform: none !important; }
  #win::after { content: ""; position: absolute; inset: 0; border-radius: 12px; box-shadow: inset 0 0 0 1px var(--line); pointer-events: none; z-index: 99; }` });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
const win = page.locator('#win');
const box = await win.boundingBox();
if (Math.round(box.width) !== 1360) throw new Error(`the window is drawn at ${box.width}px, not 1360`);
await win.screenshot({ path: out, omitBackground: true, animations: 'disabled' });
console.log(out, `${box.width * 2}x${box.height * 2}`);
await browser.close();
