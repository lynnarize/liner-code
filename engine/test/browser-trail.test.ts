/*
  The Browser's Back and Forward after a link back to a page it has shown before, and after a link to an anchor on the
  page. The trail's logic is run; the page's script (engine/src/proxy.ts) is run in a stand-in window; what lives only
  in Browser.tsx is read from its source as written. Run with `node --test engine/test/browser-trail.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { canBack, canForward, landed, landing, NO_TRAIL } from "../../ui/src/app/browser-trail.ts";

const browser = readFileSync(new URL("../../ui/src/app/Browser.tsx", import.meta.url), "utf8");

// The page's script as the proxy serves it, run in a window with only what it reaches for, and the Navigation API.
const probe = (navigationApi = true) => {
  const source = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  const from = source.indexOf("const PROBE = `") + "const PROBE = `".length;
  const script = vm.runInNewContext("`" + source.slice(from, source.indexOf("})();`;", from) + "})();".length) + "`") as string;
  const on: Record<string, ((e: unknown) => void)[]> = {};
  const onNav: Record<string, ((e: unknown) => void)[]> = {};
  const posted: Record<string, unknown>[] = [];
  const page: Record<string, unknown> = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    location: { pathname: "/a", search: "", hash: "" },
    document: { title: "A" },
    history: { pushState() {}, replaceState() {}, back() {}, forward() {} },
    fetch() {},
    XMLHttpRequest: Object.assign(function () {}, { prototype: { send() {} } }),
    addEventListener: (k: string, f: (e: unknown) => void) => void (on[k] ??= []).push(f),
    removeEventListener() {},
    navigation: { currentEntry: { index: 0 }, addEventListener: (k: string, f: (e: unknown) => void) => void (onNav[k] ??= []).push(f) },
    parent: { postMessage: (m: Record<string, unknown>) => void posted.push(m) },
  };
  if (!navigationApi) delete page.navigation;
  page.window = page;
  vm.runInNewContext(script, page);
  const fire = (k: string) => (on[k] ?? []).forEach((f) => f({}));
  const navigate = (navigationType: string, index?: number) => (onNav.navigate ?? []).forEach((f) => f({ navigationType, destination: { index } }));
  return { page, posted, fire, navigate, navs: () => posted.filter((m) => m.kind === "nav") };
};

test("The Browser's Forward after a link back to the first page lands ahead again, so Back shows and Forward doesn't", () => {
  let t = landed(NO_TRAIL, "/a", "new");
  t = landed(t, "/b", "new");
  t = landed(t, "/a", "new");
  t = landed(t, "/b", "pop", -1);
  assert.equal(t.at, 1);
  t = landed(t, "/a", "pop", 1);
  assert.equal(t.at, 2, "the Forward onto A was read as a Back onto the first A");
  assert.equal(canBack(t), true);
  assert.equal(canForward(t), false);
});

test("A step through history the trail can't place in the way it went is still read from its neighbours", () => {
  let t = landed(NO_TRAIL, "/a", "new");
  t = landed(t, "/b", "new");
  t = landed(t, "/a", "pop");
  assert.equal(t.at, 0, "a step without a direction no longer finds the place before");
  t = landed(t, "/b", "pop", -1);
  assert.equal(t.at, 1, "a Back with no place behind it isn't read from the place ahead");
});

test("The head's Back and Forward say which way they asked the page to go, and the trail is told", () => {
  assert.match(browser, /aria-label="Back"[^\n]*onClick=\{\(\) => \(\(stepped\.current = \{ at: Date\.now\(\), step: -1 \}\), cmd\("back"\)\)\}/);
  assert.match(browser, /aria-label="Forward"[^\n]*onClick=\{\(\) => \(\(stepped\.current = \{ at: Date\.now\(\), step: 1 \}\), cmd\("forward"\)\)\}/);
  assert.match(browser, /setTrail\(\(t\) => landed\(t, path, how, step\)\);/);
});

test("A link to an anchor on the page is a new place in the Browser's trail, not a step back", () => {
  const p = probe();
  p.navigate("push");
  (p.page.location as { hash: string }).hash = "#x";
  // Chromium fires popstate and then hashchange for a link to #x, just as it does for a Back.
  p.fire("popstate");
  p.fire("hashchange");
  const navs = p.navs();
  assert.deepEqual(navs.slice(-2).map((m) => [m.how, m.path]), [["push", "/a#x"], ["push", "/a#x"]]);
  let t = landed(NO_TRAIL, "/a", "new");
  t = landed(t, "/b", "new");
  t = landed(t, "/a", "new");
  for (const m of navs.slice(-2)) t = landed(t, String(m.path), landing(m.how, false));
  assert.deepEqual(t, { places: ["/a", "/b", "/a", "/a#x"], at: 3 });
});

test("A step the page takes through its own history tells the Browser which way it went", () => {
  const p = probe();
  (p.page.navigation as { currentEntry: { index: number } }).currentEntry.index = 2;
  p.navigate("traverse", 3);
  p.fire("popstate");
  const m = p.navs().at(-1)!;
  assert.equal(m.how, "pop");
  assert.equal(m.step, 1, "a page's own Forward doesn't say it went forward");
  p.navigate("traverse", 1);
  p.fire("popstate");
  assert.equal(p.navs().at(-1)!.step, -1);
});

test("A page without the Navigation API reads popstate and hashchange as a step through history, as before", () => {
  const p = probe(false);
  (p.page.location as { hash: string }).hash = "#x";
  p.fire("popstate");
  p.fire("hashchange");
  assert.deepEqual(p.navs().slice(-2).map((m) => [m.how, m.step, m.path]), [["pop", undefined, "/a#x"], ["pop", undefined, "/a#x"]]);
});
