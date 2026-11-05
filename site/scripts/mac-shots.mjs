// Pictures of the real macOS app window (its own rounded corners, traffic lights and shadow),
// taken with `screencapture -l` while Playwright drives the window over Electron's debugging port.
// Start the app first, with a throwaway LINER_HOME and the Demo set up:
//   LINER_HOME=… electron desktop --remote-debugging-port=9333
//   node scripts/mac-shots.mjs [dark|light] [shot names, to take only those]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const theme = process.argv[2] === 'light' ? 'light' : 'dark';
const only = process.argv.slice(3);
const out = fileURLToPath(new URL(`../.mac-shots/${theme}/`, import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools')) ?? browser.contexts()[0].pages()[0];
const look = { theme, accent: 'blue', composer: 'tinted', designs: 'panel', designsAuto: true, action: 'red' };
const store = {
  'liner-code:look': JSON.stringify(look),
  'lc:dock:th_mw264fss0ptnf3': JSON.stringify({ open: true, full: false, panes: [{ tabs: ['design'], tab: 'design' }], at: 0 }),
  'lc:dock:th_mw2633gw0d8qrd': JSON.stringify({ open: true, full: false, panes: [{ tabs: ['changes'], tab: 'changes' }], at: 0 }),
  'lc:project': 'pr_mw26025s00r1w7',
  'lc:sidebar': '1',
};
await page.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, store);
await page.reload();
await page.waitForTimeout(5000);

const win = () => execFileSync('swift', [here + 'winid.swift', 'Electron']).toString().trim();
// Your Mac account's name stays out of the pictures: a neutral "You" in its place.
// So do your Mac's name and your folders (the Session panel shows both).
const anon = () => page.evaluate(() => {
  for (const el of document.querySelectorAll('.lc-me-av, .lc-sb-av, .lc-st-av')) el.textContent = 'Y';
  for (const el of document.querySelectorAll('.lc-st-me-t b, .lc-sb-me-n')) el.textContent = 'You';
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walk.nextNode()); ) {
    const t = n.nodeValue.replace(/\b[A-Z][a-z]+[’']s (MacBook|Mac mini|iMac|Mac Studio|Mac Pro)/g, '$1').replace(/(\/private\/tmp|\/Users)\/.*$/, '~/Sample project');
    if (t !== n.nodeValue) n.nodeValue = t;
  }
});
const shot = async (name) => {
  await page.mouse.move(1100, 840);
  await page.waitForTimeout(1800);
  await anon();
  // In front, so the traffic lights show in colour.
  execFileSync('osascript', ['-e', 'tell application id "com.github.Electron" to activate']);
  await page.waitForTimeout(500);
  execFileSync('screencapture', ['-x', '-l' + win(), out + name + '.png']);
  console.log('shot', name);
};
const click = async (loc) => { await loc.first().click({ timeout: 5000 }); };
const tryShot = async (name, fn) => { if (only.length && !only.includes(name)) return; try { await fn(); await shot(name); } catch (e) { console.log('skip', name, e.message.split('\n')[0]); } };

await tryShot('diff', async () => { await click(page.getByText('Fix the tide time after midnight')); });
await tryShot('design', async () => { await click(page.getByText('Design a home screen for the tide tables')); });
await tryShot('agentic', async () => { await click(page.getByRole('button', { name: 'Settings' })); await page.waitForTimeout(800); await click(page.getByText('Agentic features', { exact: true })); });
await tryShot('modes', async () => { await click(page.getByText('Modes', { exact: true })); });
await tryShot('addons-page', async () => { await click(page.getByText('Back to sessions')); await page.waitForTimeout(800); await click(page.getByRole('button', { name: 'Add-ons' })); await page.waitForTimeout(500); await click(page.getByText('Browse add-ons')); });
await tryShot('workshop-home', async () => { await click(page.getByRole('button', { name: 'Add-ons' })); await page.waitForTimeout(500); await click(page.getByText('Create your add-on')); });
await tryShot('desk', async () => { await page.keyboard.press('Escape'); await click(page.getByRole('button', { name: 'New session' })); await page.waitForTimeout(800); await click(page.getByText('Desk', { exact: true })); });

// Surfaces: the tide fix with its dock open on the New tab guide, which lists every surface and its
// key, behind it the Diff, Files and Browser tabs.
await tryShot('surfaces', async () => {
  const key = 'lc:dock:th_mw2633gw0d8qrd';
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ open: true, full: false, panes: [{ tabs: ['changes', 'files', 'browser', 'guide'], tab: 'guide' }], at: 0 })), key);
  await page.reload();
  await page.waitForTimeout(4000);
  await click(page.getByText('Fix the tide time after midnight'));
  await page.waitForTimeout(1200);
  // Put the Diff-only dock back, for the diff picture.
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ open: true, full: false, panes: [{ tabs: ['changes'], tab: 'changes' }], at: 0 })), key);
});

// At work: a new session on the Demo (never a real agent: it stops if the composer's agent isn't the
// Demo), on Manual so it stops to ask before running the tests, with the Session panel beside it.
await tryShot('working', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+n');
  await page.waitForTimeout(1200);
  const tap = (pick) => page.evaluate(pick);
  await tap(() => [...document.querySelectorAll('button')].find((b) => ['Plan, then build', 'Solo', 'Auto routing'].includes(b.textContent.trim()) && b.getBoundingClientRect().y > 300)?.click());
  await page.waitForTimeout(600);
  await tap(() => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Demo' || b.getAttribute('title') === 'Demo')?.click());
  await page.waitForTimeout(600);
  await tap(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('DemoPlays a short scripted run'))?.click());
  await page.waitForTimeout(700);
  const demo = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Demo' && b.getBoundingClientRect().y > 300));
  if (!demo) throw new Error('the composer is not on the Demo; nothing sent');
  await tap(() => [...document.querySelectorAll('button')].find((b) => ['Auto', 'Reviewer decides'].includes(b.textContent.trim()) && b.getBoundingClientRect().y > 300)?.click());
  await page.waitForTimeout(500);
  await tap(() => [...document.querySelectorAll('button, [role=menuitemradio], [role=option]')].find((b) => b.textContent.trim().startsWith('Manual'))?.click());
  await page.waitForTimeout(400);
  await page.locator('textarea.lc-field').first().click();
  await page.keyboard.type("Mark tomorrow's first high tide in the label", { delay: 8 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
  await page.keyboard.press('Meta+Shift+I');
  await page.waitForTimeout(1500);
});

// Home: a new session in the sample project, the Desk folded away.
await tryShot('home', async () => {
  await page.keyboard.press('Escape');
  await click(page.getByRole('button', { name: 'New session' }));
  await page.waitForTimeout(900);
  const home = page.getByRole('button', { name: 'Home', exact: true });
  if (await home.count()) await click(home);
  // An empty composer, its placeholder showing.
  const field = page.locator('textarea.lc-field').first();
  await field.click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Backspace');
  await field.blur();
});

await browser.close();
