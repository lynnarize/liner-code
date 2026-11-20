/*
  Measures the layout facts the plans in plans/layout change, in a running dev build that has only the Demo agent.
  It prints one JSON object; each plan's "Done" names the keys it must move. It changes nothing in the repo.

  Run (from the repo root, two terminals, see plans/layout/README.md "The measuring build"):
    node plans/layout/check/measure.mjs http://localhost:5199 > /tmp/layout-after.json
  Playwright comes from site/node_modules (run `npm install` in site/ once if it is missing).
*/
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { chromium } = createRequire(path.join(root, "site/node_modules/"))("playwright");
const url = process.argv[2] || "http://localhost:5199";
const out = {};
const r1 = (x) => Math.round(x * 10) / 10;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" })).newPage();
const wait = (ms) => page.waitForTimeout(ms);
const size = async (w, h) => { await page.setViewportSize({ width: w, height: h }); await wait(700); };
const nav = (t) => page.locator(".lc-sb button, .lc-sb a").filter({ hasText: t }).first();
const face = async (n) => { await page.locator(".lc-sb-facepick").first().click(); await wait(500); await page.getByRole("menuitemradio", { name: new RegExp(n) }).click(); await wait(1800); };
const rail = (l) => page.locator(`.lc-rail-b[aria-label^="${l}"]`).first();

await page.goto(url); await wait(4000);

// First run: Setup. Its install list at the smallest window, then start with the sample project.
if (await page.getByText(/^Start with \d+ project/).count()) {
  await size(880, 580);
  out.setup = await page.evaluate(() => { const s = document.querySelector(".lc-wel-fscroll"); return s ? { listCutBy: s.scrollHeight - s.clientHeight, hasFade: getComputedStyle(s).maskImage !== "none" } : null; });
  await size(1440, 900);
  await page.getByText(/^Start with \d+ project/).click(); await wait(3000);
}
// One finished Demo session to look at.
if (!(await page.locator(".lc-sl-row").count())) {
  const box = page.locator("textarea").first(); await box.click(); await box.fill("Fix the tide time after midnight"); await page.keyboard.press("Enter"); await wait(13000);
}

// Menus: the corner that is drawn, and the gap between rows.
await page.locator(".lc-composer button").filter({ hasText: "Auto" }).first().click(); await wait(500);
out.menu = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector(".lc-pop-panel")); return { radius: cs.borderRadius, padding: cs.padding, gap: cs.rowGap }; });
await page.keyboard.press("Escape"); await wait(300);

// The session: thread text against the composer's text, with and without the panel.
await page.locator(".lc-sl-row").first().click(); await wait(1500);
const edges = () => page.evaluate(() => {
  const left = (el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const rg = document.createRange(); for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.trim() && n.parentElement.checkVisibility()) { rg.selectNodeContents(n); return rg.getClientRects()[0]?.left; } };
  const md = document.querySelector(".lc-scroll-in .lc-md p"); const ta = document.querySelector(".lc-composer textarea"); const send = document.querySelector(".lc-composer .lc-send"); const you = document.querySelector(".lc-you");
  const tcs = getComputedStyle(ta);
  return { threadTextLeft: Math.round(left(md)), composerTextLeft: Math.round(ta.getBoundingClientRect().left + parseFloat(tcs.paddingLeft)), youRight: you ? Math.round(you.getBoundingClientRect().right) : null, sendRight: Math.round(send.getBoundingClientRect().right) };
});
out.threadWide = await edges();

// Each surface in the docked panel: the card's box, and how far the first thing in it is from the card's top and sides.
out.panel = {};
for (const l of ["Session", "Changes", "Files", "Browser", "Agents"]) {
  if (!(await rail(l).count())) continue;
  await rail(l).click(); await wait(1300);
  out.panel[l] = await page.evaluate(() => {
    const r1 = (x) => Math.round(x * 10) / 10; const p = document.querySelector(".lc-panel"); const pr = p.getBoundingClientRect();
    const s = [...p.querySelectorAll(":scope > .lc-surface")].find((x) => !x.hidden && getComputedStyle(x).visibility !== "hidden");
    let b = null; const add = (q) => { if (q.width < 1 || q.height < 1 || q.left > pr.right || q.right < pr.left || q.top > pr.bottom || q.bottom < pr.top) return; b = b ? { l: Math.min(b.l, q.left), t: Math.min(b.t, q.top) } : { l: q.left, t: q.top }; };
    const w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT); const rg = document.createRange(); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim() || !n.parentElement.checkVisibility({ checkVisibilityCSS: true })) continue; rg.selectNodeContents(n); for (const q of rg.getClientRects()) add(q); }
    let box = 1e9; for (const e of s.querySelectorAll("*")) { if (!e.checkVisibility()) continue; const cs = getComputedStyle(e); if (cs.backgroundColor === "rgba(0, 0, 0, 0)" && cs.boxShadow === "none") continue; const q = e.getBoundingClientRect(); if (q.height < 12 || q.height > 60 || q.top < pr.top) continue; box = Math.min(box, q.top); }
    const foot = s.querySelector(".lc-panel-foot .lc-btn:last-child"); const send = document.querySelector(".lc-composer .lc-send");
    return { cardX: r1(pr.left), cardW: r1(pr.width), cardH: r1(pr.height), textTop: r1(b.t - pr.top), textLeft: r1(b.l - pr.left), firstBoxTop: box < 1e9 ? r1(box - pr.top) : null, footVsSend: foot && send ? r1((foot.getBoundingClientRect().top + foot.getBoundingClientRect().height / 2) - (send.getBoundingClientRect().top + send.getBoundingClientRect().height / 2)) : null };
  });
}
if (await rail("Changes").count()) { await rail("Changes").click(); await wait(900); out.threadBesidePanel = await edges(); }

// The smallest window with a surface open: is the panel still a card, and does its row show its tabs?
await size(880, 580);
out.panelNarrow = await page.evaluate(() => { const p = document.querySelector(".lc-panel"); if (!p) return null; const cs = getComputedStyle(p); const top = p.querySelector(":scope > .lc-panel-top"); return { margin: cs.margin, radius: cs.borderRadius, rowShown: top ? getComputedStyle(top).display !== "none" : false, tabsShown: top ? [...top.querySelectorAll("[role=tab], .lc-stab")].filter((t) => t.checkVisibility()).length : 0, paperHeaderHeight: top ? Math.round(top.getBoundingClientRect().height) : 0 }; });
// Closing it there: the look it keeps while it fades. A card's corner on a panel that was the paper is the fault.
const hide = () => page.locator('button[aria-label="Hide the panel"]:visible').first();
if (out.panelNarrow && (await hide().count())) { await hide().click(); await wait(120); out.panelNarrow.closingRadius = await page.evaluate(() => { const p = document.querySelector(".lc-panel"); return p ? getComputedStyle(p).borderRadius : "gone"; }); await wait(700); }
await size(1440, 900);
if (await hide().count()) { await hide().click(); await wait(700); }
// Over the whole paper, closing: flat as it was (a card's corner is the fault). Then back beside the thread, hidden.
if (await rail("Changes").count()) {
  await rail("Changes").click(); await wait(1200);
  const full = page.locator('.lc-rail-b[aria-label^="Open in the full canvas"]:visible').first();
  if (await full.count()) {
    await full.click(); await wait(1200); await hide().click(); await wait(120);
    out.panelWide = { closingRadius: await page.evaluate(() => { const p = document.querySelector(".lc-panel"); return p ? getComputedStyle(p).borderRadius : "gone"; }) }; await wait(700);
    await rail("Changes").click(); await wait(1200); await page.locator('button[aria-label="Leave the full canvas"]:visible').first().click().catch(() => {}); await wait(900);
  }
  if (await hide().count()) { await hide().click(); await wait(700); }
}

// The top row of each place: where its first words start, from the paper's left edge.
const topText = () => page.evaluate(() => { const paper = document.querySelector(".lc-paper").getBoundingClientRect(); const bar = document.elementsFromPoint(paper.left + 200, paper.top + 24).map((e) => e.closest("header, .lc-top, .ld-bar")).find(Boolean); if (!bar) return null; let l = 1e9; const w = document.createTreeWalker(bar, NodeFilter.SHOW_TEXT); const rg = document.createRange(); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim() || !n.parentElement.checkVisibility() || n.parentElement.closest(".l-sr-only")) continue; rg.selectNodeContents(n); for (const q of rg.getClientRects()) if (q.width > 0) l = Math.min(l, q.left); } return l < 1e9 ? Math.round((l - paper.left) * 10) / 10 : null; });
out.topRowTextLeft = { session: await topText() };

// Add-ons: the info note's width, and what switching face does to the page on the paper.
await nav("Add-ons").click(); await wait(1200);
out.addons = await page.evaluate(() => { const col = document.querySelector(".lc-ao-col"); const h1 = col.querySelector("h1"); const paper = document.querySelector(".lc-paper").getBoundingClientRect(); const cs = getComputedStyle(col); return { h1Size: getComputedStyle(h1).fontSize, h1Top: Math.round(h1.getBoundingClientRect().top - paper.top), gutter: cs.paddingLeft, colWidth: Math.round(col.getBoundingClientRect().width), topRowPosition: getComputedStyle(document.querySelector(".lc-ao-page > .lc-top")).position }; });
const info = page.locator(".lc-ao-info").first();
if (await info.count()) { await info.hover(); await wait(900); out.addons.noteWidth = await page.evaluate(() => { const t = [...document.querySelectorAll(".l-tip, .lc-hnote, [role=tooltip]")].find((x) => x.checkVisibility()); const sc = document.querySelector(".lc-ao-scroll"); return { width: t ? Math.round(t.getBoundingClientRect().width) : null, pageScrollsSideways: sc.scrollWidth > sc.clientWidth }; }); await page.mouse.move(700, 600); }
await face("Security");
out.faceSwitch = { addonsPageStillShown: (await page.locator(".lc-ao-page").count()) > 0 };
if (out.faceSwitch.addonsPageStillShown) { await face("Code"); await nav("New session").click(); await wait(800); await face("Security"); }
out.topRowTextLeft.securityOverview = await topText();

// Security, Findings with a finding open at the smallest window: the footer's row.
await nav("Findings").click(); await wait(1000);
const first = page.locator(".lf-rw").first();
if (await first.count()) {
  await first.click(); await wait(1000); await size(880, 580);
  out.findingFoot = await page.evaluate(() => { const bar = document.querySelector(".lf-x-act-bar"); if (!bar) return null; const br = bar.getBoundingClientRect(); const kids = [...bar.children].map((c) => c.getBoundingClientRect()); return { barHeight: Math.round(br.height), tallestChild: Math.round(Math.max(...kids.map((k) => k.height))), pastRightEdge: Math.round(Math.max(0, ...kids.map((k) => k.right - br.right))) }; });
  await size(1440, 900); await page.keyboard.press("Escape"); await wait(400);
}

// Design: the top row at the smallest window. Any two of its buttons overlapping is the fault (the buttons themselves:
// a wrapper can shrink under a button that does not).
await face("Design");
const sd = page.getByText("Start drawing"); if (await sd.count()) { await sd.first().click(); await wait(900); }
out.topRowTextLeft.designHome = await topText();
if (!(await page.locator(".lc-sb .ld-file, .lc-sb .ld-tr, .lc-sb .lc-sl-row").count())) { const box = page.locator("textarea").first(); await box.click(); await box.fill("Design a home screen for the tide tables"); await page.keyboard.press("Enter"); await wait(32000); }
else { await page.locator(".lc-sb .ld-file:visible, .lc-sb .lc-sl-row:visible, .lc-sb .ld-tr:visible").first().click(); await wait(2500); }
if (await page.locator(".ld-bar").count()) {
  await size(880, 580);
  out.designBar = await page.evaluate(() => { const bar = document.querySelector(".ld-bar"); const br = bar.getBoundingClientRect(); const kids = [...bar.querySelectorAll(":scope > button, :scope > .lc-pop > button, :scope > span > button, :scope > span > .lc-pop > button")].filter((c) => c.checkVisibility() && c.getBoundingClientRect().width > 1).map((c) => c.getBoundingClientRect()).sort((a, b) => a.left - b.left); let overlap = 0; for (let i = 0; i < kids.length - 1; i++) overlap = Math.max(overlap, kids[i].right - kids[i + 1].left); return { itemsOverlapBy: Math.round(Math.max(0, overlap)), pastRightEdge: Math.round(Math.max(0, ...kids.map((k) => k.right - br.right))) }; });
  await size(1440, 900);
}

// Settings: where the crumbs' words start.
await face("Code"); await page.locator(".lc-sb-foot > button.lc-ib").click(); await wait(1200);
out.topRowTextLeft.settings = await topText();

// The docked card's ring on a 2x screen: half a pixel, open (1px here is the fault).
const page2 = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", deviceScaleFactor: 2 })).newPage();
await page2.goto(url); await page2.waitForTimeout(4000); await page2.locator(".lc-sl-row").first().click(); await page2.waitForTimeout(1500);
if (!(await page2.locator(".lc-panel").count())) { await page2.locator('.lc-rail-b[aria-label^="Changes"]').first().click(); await page2.waitForTimeout(1300); }
out.panel.ringAt2x = await page2.evaluate(() => getComputedStyle(document.querySelector(".lc-panel")).boxShadow.match(/0px 0px 0px ([\d.]+px)/)?.[1] ?? null);
await page2.locator('button[aria-label="Hide the panel"]:visible').first().click().catch(() => {}); await page2.waitForTimeout(700);

console.log(JSON.stringify(out, null, 2));
await browser.close();
