// Every picture of the app on the home page, in the light look and the dark, at 2x. Two browsers
// open the same app, one in each look, so one state is pictured twice. Nothing opens on screen.
//
// Two dev builds are needed (see .claude/launch.json):
//
//   liner-site-024   can only reach the Demo: a throwaway LINER_HOME, XDG_CONFIG_HOME,
//                    CLAUDE_CONFIG_DIR and CODEX_HOME, and a PATH without the agents' CLIs. Six taps
//                    on your name show the Demo, then "Try the sample project". Stage these in it,
//                    each a session of its own:
//                      Fix the tide time after midnight
//                      Design a home screen for the tide tables
//                      Mark tomorrow's first high tide in the label      (permissions on Manual)
//                      Add an alert for spring tides. Send agents to look, test and write fixtures at once.
//   liner-site-024b  a throwaway LINER_HOME but your own tools in sight, for Settings only: it shows
//                    the pair and the Reviewer it would pick. Nothing is ever sent there (a turn would be billed).
//
//   node scripts/demo-shots.mjs <stage>...     hero design turn crew sidekick wall addons settings
//   node scripts/demo-shots.mjs --convert      only turn .app-shots/demo/*.png into public/media
//
// "hero", "crew" and "turn" each send the Demo a message, so they add a turn or a session.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const stages = args.filter((a) => !a.startsWith('--'));
const out = fileURLToPath(new URL('../.app-shots/demo/', import.meta.url));
const media = fileURLToPath(new URL('../public/media/', import.meta.url));
mkdirSync(out, { recursive: true });
const DEMO = 'http://localhost:5523', REAL = 'http://localhost:5525';
const browser = await chromium.launch();

const mk = async (theme, base, w, h) => {
  const look = { theme, accent: 'blue', composer: 'tinted', designs: 'panel', designsAuto: true, action: 'red' };
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: theme });
  await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, { 'liner-code:look': JSON.stringify(look), 'lc:sidebar': '1' });
  const page = await ctx.newPage();
  await page.goto(base + '/', { waitUntil: 'load' });
  return page;
};
const pair = async (base, w, h) => { const p = await Promise.all([mk('light', base, w, h), mk('dark', base, w, h)]); await p[0].waitForTimeout(4500); return p; };
const both = (pages, fn) => Promise.all(pages.map((p, i) => fn(p, i ? 'dark' : 'light')));
const snap = (pages, name) => both(pages, async (p, t) => { const v = p.viewportSize(); await p.mouse.move(v.width / 2, v.height - 3); await p.screenshot({ path: `${out}${name}-${t}.png` }); }).then(() => console.log('shot', name));
// A session's row in the sidebar (its title also sits, hidden, in the command palette).
const row = (p, title) => p.locator('.lc-sb-h', { hasText: title }).first();
const hide = (pages) => both(pages, (p) => p.getByRole('button', { name: 'Hide the sidebar' }).first().click({ timeout: 6000 }));
const stage = async (name, fn) => { if (!stages.includes(name)) return; try { await fn(); } catch (e) { console.log('skip', name, e.message.split('\n')[0]); } };
const agentsAsk = 'And for king tides. Send agents to look, test and write fixtures at once.';

// The hero: the whole window, three agents at work and the Agents panel beside them, about six seconds in.
await stage('hero', async () => {
  const P = await pair(DEMO, 1440, 900);
  await both(P, (p) => row(p, 'Add an alert for spring').click({ timeout: 6000 }));
  await P[0].waitForTimeout(2000);
  await P[0].locator('textarea.lc-field').first().click({ timeout: 6000 });
  await P[0].keyboard.type(agentsAsk, { delay: 3 });
  await P[0].keyboard.press('Enter');
  const t0 = Date.now();
  await P[0].waitForTimeout(4300);
  await both(P, (p) => p.keyboard.press('Meta+Shift+A'));
  await P[0].waitForTimeout(Math.max(300, 5900 - (Date.now() - t0)));
  await snap(P, 'agents');
});
// Designs: the whole window too; the page shows its Design panel.
await stage('design', async () => {
  const P = await pair(DEMO, 1440, 900);
  await both(P, async (p) => { await row(p, 'Design a home screen').click({ timeout: 6000 }); await p.waitForTimeout(2500); if (!(await p.getByText("Today's tides").count())) await p.getByText('Open in the panel').first().click({ timeout: 6000 }); });
  await P[0].waitForTimeout(2200);
  await snap(P, 'design');
});
// The cards: the app in a small window of its own, the sidebar put away. A card shows the window's
// top 567px (it runs off the card's foot), so each is as tall as puts the composer just under that.
// The plan: asked to show one first, the Demo reads, proposes it and waits. (The Demo no longer asks
// a question of its own since 0.2.5, so the question card's picture is still the 0.2.4 one.)
await stage('turn', async () => {
  const P = await pair(DEMO, 720, 691);
  await P[0].getByRole('button', { name: /^New session/ }).first().click({ timeout: 6000 });
  await P[0].waitForTimeout(1500);
  await P[0].getByPlaceholder(/Ask for a change/).first().click({ timeout: 6000 });
  await P[0].keyboard.type('Fix the tide shown after midnight. Show me a plan first.', { delay: 3 });
  await P[0].keyboard.press('Enter');
  await P[0].waitForTimeout(2500);
  await row(P[1], 'Fix the tide shown after midnight').click({ timeout: 6000 });
  await P[0].waitForTimeout(1200);
  await hide(P);
  await P[0].waitForTimeout(8000);
  await snap(P, 'plan');
});
await stage('crew', async () => {
  const P = await pair(DEMO, 720, 724);
  await both(P, (p) => row(p, 'Add an alert for spring').click({ timeout: 6000 }));
  await P[0].waitForTimeout(1800);
  await hide(P);
  await P[0].locator('textarea.lc-field').first().click({ timeout: 6000 });
  await P[0].keyboard.type(agentsAsk, { delay: 3 });
  await P[0].keyboard.press('Enter');
  await P[0].waitForTimeout(4400);
  await snap(P, 'crew');
});
// A pair: the Demo leads and hands the fix to its sidekick (the sample project's src/tides.js must be
// as committed, or the sidekick has nothing to change). Pictured once the lead has read it back.
await stage('sidekick', async () => {
  const P = await pair(DEMO, 720, 724);
  await P[0].getByRole('button', { name: /^New session/ }).first().click({ timeout: 6000 });
  await P[0].waitForTimeout(1500);
  await P[0].getByPlaceholder(/Ask for a change/).first().click({ timeout: 6000 });
  await P[0].keyboard.type('Fix the tide time after the last high tide', { delay: 3 });
  await P[0].keyboard.press('Enter');
  await P[0].waitForTimeout(2500);
  await row(P[1], 'Fix the tide time after the last').click({ timeout: 6000 });
  await P[0].waitForTimeout(1200);
  await hide(P);
  await P[0].waitForTimeout(12000);
  await snap(P, 'sidekick');
});
await stage('wall', async () => {
  const P = await pair(DEMO, 1200, 680);
  await both(P, (p) => p.getByRole('button', { name: /^The Wall/ }).first().click({ timeout: 6000 }));
  await P[0].waitForTimeout(1500);
  await hide(P);
  await P[0].waitForTimeout(1500);
  await snap(P, 'wall');
});
await stage('addons', async () => {
  const P = await pair(DEMO, 1100, 800);
  await both(P, async (p) => { await p.getByRole('button', { name: 'Add-ons', exact: true }).first().click({ timeout: 6000 }); await p.waitForTimeout(600); await p.getByText('Add-on settings').first().click({ timeout: 6000 }); });
  await P[0].waitForTimeout(2200);
  await snap(P, 'addons');
});
// Settings, in the build that sees your tools: straight to Settings, and nothing is sent.
await stage('settings', async () => {
  const P = await pair(REAL, 1100, 800);
  await both(P, async (p) => { await p.getByRole('button', { name: 'Settings', exact: true }).first().click({ timeout: 6000 }); await p.waitForTimeout(1500); await p.getByText('Agentic features', { exact: true }).first().click({ timeout: 6000 }); });
  await P[0].waitForTimeout(2500);
  await snap(P, 'modes');
  await both(P, (p) => p.getByText('The Reviewer', { exact: true }).first().click({ timeout: 6000 }));
  await P[0].waitForTimeout(2200);
  await snap(P, 'check');
});

// To WebP. The hero's window also at 1200 wide; the cards' pictures at one width, a little over
// twice what a card shows.
const WIDTH = { agents: 2000, design: 2000, wall: 1800, addons: 1700, modes: 1700, check: 1700, question: 1440, plan: 1440, crew: 1440, sidekick: 1440 };
const conv = await (await browser.newContext()).newPage();
for (const f of readdirSync(out).filter((n) => n.endsWith('.png'))) {
  const name = f.replace(/\.png$/, ''), kind = name.replace(/-(light|dark)$/, '');
  const url = 'data:image/png;base64,' + readFileSync(out + f).toString('base64');
  for (const [w, suffix] of kind === 'agents' ? [[2000, ''], [1200, '-1200']] : [[WIDTH[kind] ?? 1500, '']]) {
    const data = await conv.evaluate(async ({ url, w }) => {
      const img = new Image(); img.src = url; await img.decode();
      const h = Math.round(img.naturalHeight * (w / img.naturalWidth));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/webp', 0.86).split(',')[1];
    }, { url, w });
    writeFileSync(`${media}shot-${name}${suffix}.webp`, Buffer.from(data, 'base64'));
    console.log(`public/media/shot-${name}${suffix}.webp`);
  }
}
await browser.close();
