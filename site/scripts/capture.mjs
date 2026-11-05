// Captures the sea as pictures: the ground for browsers without WebGL2, frames for the brand
// board, and the OG image. Run against the dev server: node scripts/capture.mjs [http://localhost:4321]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] || 'http://localhost:4321';
const pub = fileURLToPath(new URL('../public/', import.meta.url));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const quiet = '.nav,.hero__top,.hero__foot,#curtain,.skip-link{visibility:hidden!important}';

async function open(width, height, dpr) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4200);
  return page;
}

async function toWebp(page, png, quality = 0.82) {
  const url = 'data:image/png;base64,' + png.toString('base64');
  const data = await page.evaluate(async ({ url, quality }) => {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', quality).split(',')[1];
  }, { url, quality });
  return Buffer.from(data, 'base64');
}

// 1. Frames with the word, without the page's controls.
{
  const p = await open(1600, 1000, 1);
  await p.addStyleTag({ content: quiet });
  await p.waitForTimeout(400);
  writeFileSync(pub + 'media/sea-horizon.jpg', await p.screenshot({ type: 'jpeg', quality: 84 }));
  // From above: scroll half way through the hero.
  await p.mouse.move(800, 500);
  const span = await p.evaluate(() => { const h = document.querySelector('[data-hero]'); return h.offsetHeight - innerHeight; });
  for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, (span * 0.5) / 12); await p.waitForTimeout(60); }
  await p.waitForTimeout(2200);
  writeFileSync(pub + 'media/sea-above.jpg', await p.screenshot({ type: 'jpeg', quality: 84 }));
  await p.context().close();
}

// 2. The OG image.
{
  const p = await open(1200, 630, 1);
  await p.addStyleTag({ content: quiet });
  await p.waitForTimeout(400);
  writeFileSync(pub + 'og.png', await p.screenshot({ type: 'png' }));
  await p.context().close();
}

// 3. The ground alone, from the horizon down, with a clear sky: the picture under the canvas.
for (const [name, w, h, dpr] of [['ground', 1600, 1000, 1.5], ['ground-phone', 430, 932, 2]]) {
  const p = await open(w, h, dpr);
  await p.addStyleTag({ content: quiet + 'html,body,.hero,.stage{background:transparent!important}.stage__word,.figure{visibility:hidden!important}' });
  await p.waitForTimeout(500);
  const top = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.stage--hero')).getPropertyValue('--horizon')) || innerHeight * 0.47);
  const png = await p.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: Math.floor(top) - 2, width: w, height: h - Math.floor(top) + 2 } });
  writeFileSync(pub + `media/${name}.webp`, await toWebp(p, png));
  console.log(name, w * dpr, Math.round((h - top + 2) * dpr));
  await p.context().close();
}

await browser.close();
console.log('captured');
