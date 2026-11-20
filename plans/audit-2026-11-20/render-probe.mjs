// Throwaway: counts React component renders by name while the OPEN session streams with Changes docked.
import { createRequire } from "node:module";
const { chromium } = createRequire("/Users/hilmi/Project/Claude/X Apps/Liner Code/site/node_modules/")("playwright");
const url = process.argv[2];
const hook = () => {
  const counts = new Map();
  let on = false;
  const nameOf = (f) => {
    const t = f.type;
    if (!t || typeof t === "string") return null;
    if (f.tag === 0 || f.tag === 1 || f.tag === 15 || f.tag === 11) return t.displayName || t.name || (t.render && t.render.name) || "anon";
    if (f.tag === 14) return (t.type && (t.type.displayName || t.type.name)) || "memo";
    return null;
  };
  let dockN = 0;
  const walk = (f, inDock) => {
    while (f) {
      const n = nameOf(f);
      const d = inDock || n === "Panel";
      const rendered = !f.alternate || (f.flags & 1) === 1;
      if (n && rendered && on) { counts.set(n, (counts.get(n) || 0) + 1); if (d) dockN++; }
      if (f.child && (!f.alternate || f.child !== f.alternate.child)) walk(f.child, d);
      f = f.sibling;
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), inject() { return 1; }, checkDCE() {}, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) { if (on) walk(root.current.child, false); },
  };
  window.__probe = { start() { counts.clear(); dockN = 0; on = true; }, dock() { return dockN; }, stop() { on = false; return [...counts].sort((a, b) => b[1] - a[1]); } };
};
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.addInitScript(hook);
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(url); await wait(4000);
if (await page.getByText(/^Start with \d+ project/).count()) { await page.getByText(/^Start with \d+ project/).click(); await wait(3000); }
const send = async (t) => { const box = page.locator("textarea:visible").first(); await box.click(); await box.fill(t); await page.keyboard.press("Enter"); };
await send("Fix the tide time after midnight"); await wait(14000);
const rail = (l) => page.locator(`.lc-rail-b[aria-label^="${l}"]`).first();
console.log("rails:", await page.locator(".lc-rail-b").evaluateAll((xs) => xs.map((x) => x.getAttribute("aria-label"))));
const which = process.argv[3] || "Changes";
if (which !== "none") { await rail(which).click(); await wait(1500); }
console.log("panel open:", await page.locator(".lc-panel").count(), "tabs:", await page.locator(".lc-panel [role=tab]").allInnerTexts().catch(() => []));
await send("Fix the tide time after midnight again"); await wait(300);
await page.evaluate(() => window.__probe.start());
await wait(6000);
const res = await page.evaluate(() => window.__probe.stop());
const total = res.reduce((n, [, c]) => n + c, 0);
console.log("total renders in 6 s:", total, "inside Panel subtree:", await page.evaluate(() => window.__probe.dock()));
const pick = new Set(["SessionTab","Sessions","AskDock","Session", "SessionPanel", "Panel", "Strip", "Changes", "Composer", "Timeline", "App", "Rail", "ChangesSurface"]);
console.log("named:", JSON.stringify(res.filter(([n]) => pick.has(n) || /Session|Panel|Dock|Changes/.test(n))));
console.log("top 30:", JSON.stringify(res.slice(0, 30)));
await browser.close();
