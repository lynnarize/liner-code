/*
  Small faults left after the right panel and picker passes of 2026-11-25: a menu on the design canvas whose rows were not
  menu items, a side-menu row that called itself one outside any menu, the pinned column's end held under the message box,
  two picker controls the density pass missed, and words that still called the pinned Session card a popup. The UI has no
  DOM runner here, so the wiring is read from the source as written (precedent: stale-ui-state.test.ts). Run with
  `node --test engine/test/menu-pin-leftovers.test.ts`.
*/
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../ui/src/app/", import.meta.url);
const app = (file: string) => readFileSync(new URL(file, root), "utf8");
/** One region of a file, from its marker to the next marker. */
const span = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `marker not found: ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `end marker not found after "${from}": ${to}`);
  return src.slice(a, b);
};
/** The declarations of every rule whose selector list is exactly `sel`, in `css` (a container query's own rules included). */
const rules = (css: string, sel: string) => {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) if (m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim() === sel) out.push(m[2]);
  return out;
};
const value = (decls: string, prop: string) => new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`).exec(decls)?.[1].trim();
/** The text of one container query's block, by its exact head. */
const container = (css: string, head: string) => {
  const a = css.indexOf(head);
  assert.ok(a >= 0, `no ${head}`);
  let depth = 0;
  for (let i = css.indexOf("{", a); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(a, i + 1);
  }
  throw new Error(`${head} never closes`);
};

test("The findings at one spot on the design canvas are a menu whose rows are its items, walked by the arrow keys", () => {
  const ui = app("ui.tsx");
  const list = span(ui, "export function MenuList(", "\n}\n");
  assert.match(list, /role="menu"/, "the shared menu list isn't a menu");
  assert.match(list, /<InMenu\.Provider value>/, "the shared menu list doesn't make its rows menu items");
  assert.match(list, /movesRows\(e\.key, inText\(e\.target as HTMLElement\)\)/, "the shared menu list doesn't take the menu's keys");
  assert.match(list, /querySelectorAll<HTMLElement>\("\[role\^='menuitem'\]:not\(:disabled\)"\)/, "the shared menu list doesn't walk its items");
  const checks = app("design/ChecksTab.tsx");
  assert.doesNotMatch(checks, /role="menu"/, "the Checks tab still draws a menu of its own whose rows are plain buttons");
  assert.match(checks, /<MenuList className="ld-ck-spot-list" label="The findings here">[\s\S]*?<Row key=\{x\.f\.key\}/, "the findings at a spot aren't the shared menu list");
});

test("A row that opens a menu to its side is a menu item only inside a menu, as every other row is", () => {
  const sub = span(app("ui.tsx"), "export function SubMenu(", "export function ConfirmRow(");
  assert.match(sub, /const inMenu = useContext\(InMenu\);/, "the side-menu row doesn't ask whether it is in a menu");
  assert.match(sub, /role=\{inMenu \? "menuitem" : undefined\}/, "the side-menu row isn't a menu item by being in a menu");
  assert.doesNotMatch(sub.slice(0, sub.indexOf("createPortal(")), /role="menuitem"/, "the side-menu row calls itself a menu item in the pinned Session card, which is no menu");
});

test("In a thread too narrow to make room, the pinned column's end scrolls clear of the message box over it", () => {
  const css = app("app.css");
  const narrow = container(css, "@container lc-thread (max-width: 999.98px)");
  const pin = rules(narrow, ".lc-pin");
  assert.equal(pin.length, 1, "the narrow thread gives the pinned column no rule of its own");
  assert.equal(value(pin[0], "padding-bottom"), "calc(var(--lc-dock-h, 132px) + 12px)", "the column's last cards stay under the message box");
  // Wide, the message box stands beside the column, so its end needs no more than its own 12px.
  const wide = container(css, "@container lc-thread (min-width: 1000px)");
  assert.equal(rules(wide, ".lc-pin").length, 0, "the wide thread pads the column under a message box that isn't over it");
  assert.equal(value(rules(css, ".lc-pin")[0] ?? "", "padding"), "8px 12px 12px");
});

test("The model picker's star and All sources mark are the picker's 14px, and its icon button the 6px corner of its chips", () => {
  const models = app("Models.tsx");
  assert.doesNotMatch(models, /<I\.star size=\{16\}/, "a model's star is still 16px in a 24px button");
  assert.doesNotMatch(models, /<I\.layers size=\{16\}/, "All sources is still a 16px mark beside 14px ones");
  const css = app("models.css");
  assert.equal(value(rules(css, ".lc-pk-chip")[0] ?? "", "border-radius"), "6px");
  assert.equal(value(rules(css, ".lc-pk-ib")[0] ?? "", "border-radius"), "6px", "the star's button keeps the old 8px corner");
});

test("The Session key and ⌘K say they show the pinned Session card, and nothing in the app calls it a popup", () => {
  assert.match(app("keymap.ts"), /session: "Show or hide the Session card"/, "the keyboard settings say the key opens a popup");
  const palette = app("App.tsx");
  assert.match(palette, /s\.id === "session" \? "Show the Session card"/, "⌘K says it opens a popup");
  const files: string[] = [];
  const walk = (dir: URL, at: string) => {
    for (const name of readdirSync(dir)) {
      const url = new URL(name, dir);
      if (statSync(url).isDirectory()) walk(new URL(`${name}/`, dir), `${at}${name}/`);
      else if (/\.(tsx?|css)$/.test(name)) files.push(`${at}${name}`);
    }
  };
  walk(root, "");
  const stale = files.filter((f) => /Session popup/.test(app(f)));
  assert.deepEqual(stale, [], "these still call the pinned Session card a popup");
});
