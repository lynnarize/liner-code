// PNG window captures to WebP with their alpha (the macOS shadow), scaled to a width.
//   node scripts/to-webp.mjs <width> <out-dir> <in.png>...
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [width, outDir, ...files] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
for (const f of files) {
  const url = 'data:image/png;base64,' + readFileSync(f).toString('base64');
  const data = await page.evaluate(async ({ url, w }) => {
    const img = new Image(); img.src = url; await img.decode();
    const h = Math.round(img.naturalHeight * (w / img.naturalWidth));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, h);
    return { b64: c.toDataURL('image/webp', 0.84).split(',')[1], h };
  }, { url, w: +width });
  const out = join(outDir, 'mac-' + basename(f, '.png') + (process.env.SUFFIX || '') + '.webp');
  writeFileSync(out, Buffer.from(data.b64, 'base64'));
  console.log(out, width + 'x' + data.h);
}
await browser.close();
