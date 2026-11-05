// Saves the brand kit board (/brand) as one picture: node scripts/board.mjs [base url]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const base = process.argv[2] || 'http://127.0.0.1:4400';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
await page.goto(base + '/brand/', { waitUntil: 'networkidle' });
await page.addStyleTag({ content: '.nav{display:none!important}' });
await page.waitForTimeout(800);
await page.locator('.brand').screenshot({ path: fileURLToPath(new URL('../brand-kit.png', import.meta.url)) });
await browser.close();
console.log('brand-kit.png');
