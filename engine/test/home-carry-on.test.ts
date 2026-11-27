/*
  Home as the owner ruled it for "line and dot" (2026-11-27, board Home): the headline with no two-stroke mark above it,
  no "Runs on" row, Carry on as three cards under the box, and one switch in Settings ("Show Carry on on Home", on by
  default) that takes Carry on away everywhere: the cards, the sidebar's panel and the reads behind them. These read the
  app's source as text. Run with `node --test engine/test/home-carry-on.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = (f: string) => readFileSync(new URL(`../../ui/src/app/${f}`, import.meta.url), "utf8");
/** The text from `from` up to the first `to` after it. */
const span = (s: string, from: string, to: string) => {
  const a = s.indexOf(from);
  assert.ok(a >= 0, `${from} is missing`);
  const b = s.indexOf(to, a + from.length);
  return s.slice(a, b < 0 ? undefined : b);
};

test("Home's headline is the board's words in the name's face, with nothing drawn above it", () => {
  const home = app("Home.tsx");
  const head = span(home, '<div className="lc-home-head">', "</h1>");
  assert.match(head, /What are we making\? <span>Pick a folder, say it plainly\.<\/span>/);
  // Nothing before the headline in its block: no icon, no mark, no picture.
  const before = head.slice(0, head.indexOf("<h1"));
  assert.doesNotMatch(before, /<I\.|<svg|Mark|<img|lc-ht/, "something is drawn above the headline");
  const css = app("app.css");
  assert.match(span(css, ".lc-home-h {", "}"), /font: 600 28px\/1\.15 var\(--lc-font-name\)/, "the headline isn't Instrument Sans 28/600");
});

test("Home has no Runs on row", () => {
  for (const f of ["Home.tsx", "CarryOn.tsx"]) assert.doesNotMatch(app(f), /Runs on/i, `${f} has a Runs on row`);
});

test("Carry on shows as three cards under Home's box, and only while it is on", () => {
  const home = app("Home.tsx");
  const compose = home.indexOf('className="lc-home-compose"');
  const foot = home.indexOf('className="lc-home-foot"');
  assert.ok(compose > 0 && foot > compose, "Carry on isn't under the box");
  assert.match(home.slice(foot, foot + 300), /\{carryOn && <HomeCarry /, "the cards don't wait on the switch");
  assert.match(home, /const carryOn = useEngine\(\(s\) => carryOnOn\(s\.settings\)\)/);
  const carry = app("CarryOn.tsx");
  assert.match(carry, /export const HOME_CARDS = 3;/);
  assert.match(carry, /if \(cards\.length >= HOME_CARDS\) break;/, "Home shows more than three cards");
  // Each card carries the dots in its top right corner, in its state's colour.
  assert.equal((carry.match(/className="lc-ht lc-ht-corner lc-ht-soft lc-ht-(ok|blue)"/g) ?? []).length, 2);
});

test("Turned off, the sidebar's Carry on is not mounted, so it reads nothing and its menu rows count none", () => {
  const carry = app("CarryOn.tsx");
  const outer = span(carry, "export function CarryOn(", "\n}\n");
  assert.match(outer, /const on = useEngine\(\(s\) => carryOnOn\(s\.settings\)\);\s*return on \? <CarryOnPanel \{\.\.\.props\} \/> : null;/);
  // Going away, it says there is nothing, so the menus' rows go with it.
  assert.match(span(carry, "function CarryOnPanel(", "\n}\n"), /onCount\(0\);\s*opener\.current = null;/);
  // sessions.recent and git.status are asked only from the hook both places mount.
  assert.equal((carry.match(/rpc\("sessions\.recent"/g) ?? []).length, 1);
  assert.doesNotMatch(app("Sidebar.tsx"), /rpc\("sessions\.recent"/, "the sidebar still reads the tools' sessions itself");
});

test("Settings has one switch for Carry on, on by default, where Home's other choices are", () => {
  const settings = app("Settings.tsx");
  const field = span(settings, "function CarryOnField()", "\n}\n");
  assert.match(field, /const on = useEngine\(\(x\) => carryOnOn\(x\.settings\)\);/);
  assert.match(field, /<NamedSwitch name="Show Carry on on Home" checked=\{on\} onCheckedChange=\{\(carryOn\) => save\(\{ carryOn \}\)\} \/>/);
  assert.match(span(settings, '<Group title="Home"', "</Group>"), /<CarryOnField \/>/, "the switch isn't in Appearance's Home group");
});

test("Home's card for work not committed shows the age of the last session that left it, or no age at all, never a made-up now", () => {
  const carry = app("CarryOn.tsx");
  const home = span(carry, "export function HomeCarry(", "\n}\n");
  assert.doesNotMatch(home, /<span>now<\/span>/, "the card still says now whatever its age");
  assert.match(home, /const touched = useEngine\(\(s\) => s\.threads\.reduce\(/, "the age isn't read from the sessions the app already holds");
  assert.match(home, /\{touched > 0 && <span>\{ago\(touched, now\)\}<\/span>\}/);
});

test("On The Wall a session not started yet has no dots: blue is for one finished and not seen yet", () => {
  const wall = app("Wall.tsx");
  const dots = span(wall, "const DOTS_OF", "};");
  assert.match(dots, /fresh: "lc-ht-blue"/);
  assert.doesNotMatch(dots, /\bnew:/, "a session not started yet is drawn as news");
});

/** The body of the first rule whose selector list is exactly `selector`. */
const rule = (css: string, selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `${selector} has no rule`);
  return css.slice(at, css.indexOf("}", at));
};

test("Everything Home shows sits above whatever is behind it, its words straight on the backdrop with no sheet behind them", () => {
  const css = app("app.css");
  assert.match(rule(css, ".lc-home > .lc-top,\n.lc-home > .lc-home-in"), /position: relative;\s*z-index: 1;/, "Home's content is not lifted over the backdrop");
  assert.match(rule(css, ".lc-sea"), /z-index: 0;/, "the backdrop is not on the lower layer");
  // The owner's ruling ("remove the white"): no fill, fade, mask or pseudo-element sheet behind the headline, the chips row or Carry on's label.
  const words = /\.lc-home-(head|h|top|chip|cap|tile|branch|direct|name)\b|\.lc-hc-(head|all)\b/;
  for (const [sel, body] of [...css.matchAll(/(^|\n)([^{}\n][^{}]*)\{([^{}]*)\}/g)].map((m) => [m[2].trim(), m[3]] as const)) {
    if (!words.test(sel)) continue;
    assert.doesNotMatch(sel, /::?(before|after)\b/, `${sel} draws a sheet behind Home's words`);
    assert.doesNotMatch(body, /mask-image|backdrop-filter/, `${sel} fades or blurs the backdrop behind Home's words`);
    if (!/\[data-open\]|:hover/.test(sel) && !/lc-home-tile/.test(sel)) assert.doesNotMatch(body, /(^|\n)\s*background(-color)?: (?!none)/, `${sel} puts a fill behind Home's words`);
  }
  // The cards keep the boards' faint card fill and its edge, not a slab.
  const card = rule(css, ".lc-hc-card");
  assert.match(card, /background: var\(--lc-card\);/);
  assert.match(card, /box-shadow: var\(--lc-card-ring\);/);
});

test("Settings' column of places is wide enough for Source control & issues with its New tag", () => {
  const css = app("settings.css");
  const cols = [...css.matchAll(/grid-template-columns: (\d+)px minmax\(0, 1fr\);/g)].map((m) => Number(m[1]));
  assert.ok(cols.at(-1)! >= 248, `the column is ${cols.at(-1)}px, and the longest place is cut short`);
});

test("A Wall tile for a finished session it has nothing to say about draws no mark, while one that waits on you keeps its own", () => {
  const wall = app("Wall.tsx");
  assert.match(wall, /<span className="lc-wt-mark">\{!\(mark === "done" && kind === "done"\) && <SideMark /, "a finished tile still draws a mark, or a waiting one lost its");
});
