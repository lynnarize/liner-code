// Fresh pictures of the current app for the site, at 2x, from a dev build running with a throwaway
// LINER_HOME and the Demo agent (see the liner-site-shots entry in .claude/launch.json).
//   node scripts/app-shots.mjs [http://localhost:5419] '<localStorage JSON>'
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] || 'http://localhost:5419';
const store = JSON.parse(process.argv[3] || '{}');
const scheme = process.env.SCHEME === 'dark' ? 'dark' : 'light';
const out = fileURLToPath(new URL(scheme === 'dark' ? '../.app-shots/dark/' : '../.app-shots/', import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: 'reduce' });
await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, store);
const page = await ctx.newPage();
await page.goto(base + '/', { waitUntil: 'load' });
await page.waitForTimeout(5000);

const shot = async (name) => { await page.mouse.move(1100, 880); await page.waitForTimeout(1600); await page.screenshot({ path: out + name + '.png' }); console.log('shot', name); };
const click = async (loc) => { await loc.first().click({ timeout: 5000 }); };
const tryShot = async (name, fn) => { try { await fn(); await shot(name); } catch (e) { console.log('skip', name, e.message.split('\n')[0]); } };

await tryShot('diff', async () => { await click(page.getByText('Fix the tide time after midnight')); });
await tryShot('design', async () => { await click(page.getByText('Design a home screen for the tide tables')); });
await tryShot('addons-menu', async () => { await page.keyboard.press('Escape'); await click(page.getByRole('button', { name: 'Add-ons' })); });
await tryShot('workshop-home', async () => { await click(page.getByText('Create your add-on')); });
await tryShot('modes', async () => { await click(page.getByRole('button', { name: 'Settings' })); await page.waitForTimeout(800); await click(page.getByText('Modes', { exact: true })); });
await tryShot('agentic', async () => { await click(page.getByText('Agentic features', { exact: true })); });
await tryShot('addons-page', async () => { await click(page.getByText('Back to sessions')); await page.waitForTimeout(800); await click(page.getByRole('button', { name: 'Add-ons' })); await page.waitForTimeout(500); await click(page.getByText('Browse add-ons')); });

await tryShot('desk', async () => { await page.keyboard.press('Escape'); await click(page.getByRole('button', { name: 'New session' })); await page.waitForTimeout(800); await click(page.getByText('Desk', { exact: true })); });

await browser.close();
