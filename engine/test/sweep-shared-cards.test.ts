/*
  The sweep after the right panel's redesign (2026-11-25, builder H1): the shared parts, the chat's cards, the
  dialogs and the palette brought in line with the panel, and the small faults its pictures showed. Pure logic
  is run; what lives only in a stylesheet or a component's words is read from the file as written.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canBack, canForward, landed, NO_TRAIL } from "../../ui/src/app/browser-trail.ts";
import { TOAST_EDGE, toastRight } from "../../ui/src/app/toast-place.ts";

const src = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");
const sheet = (file: string) => src(file).replace(/\/\*[\s\S]*?\*\//g, "");
// Every block whose selector list holds exactly this selector, in file order: its declarations as text.
const blocks = (css: string, selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")).includes(selector)).map((m) => m[2]);
const value = (block: string, property: string) => block.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`))?.[1].trim();

test("The Browser offers Back only once the page has been somewhere before, and Forward only after a Back", () => {
  let t = landed(NO_TRAIL, "/");
  assert.equal(canBack(t), false, "a page just opened has nowhere to go back to");
  assert.equal(canForward(t), false);
  t = landed(t, "/tides");
  assert.equal(canBack(t), true);
  assert.equal(canForward(t), false);
  t = landed(t, "/");
  assert.equal(canBack(t), false, "landing on the place before is a Back");
  assert.equal(canForward(t), true);
  t = landed(t, "/about");
  assert.equal(canForward(t), false, "a new place drops the places ahead");
  assert.deepEqual(t.places, ["/", "/about"]);
  assert.equal(landed(t, "/about"), t, "the same place told twice changes nothing");
});

test("A Working mark is never tinted by the holder, except on a coloured chip where it takes the chip's white", () => {
  const icons = src("icons.tsx");
  assert.ok(!/"--mk-tint":\s*tint/.test(icons), "StateMark still hands its tint to the dots");
  const css = sheet("app.css");
  assert.equal(value(blocks(css, '.lc-mk[data-s="working"]')[0], "color"), "var(--lc-progress)");
  for (const chip of [".ld-ptag", ".lc-dm-tag"]) assert.equal(value(blocks(css, `${chip} > .lc-mk[data-s="working"]`)[0] ?? "", "color"), "inherit", `a mark on ${chip} is grey on the chip's colour, not its white`);
});

test("A check that passed is a green tick and a step that is done the grey one", () => {
  const css = sheet("app.css");
  assert.equal(value(blocks(css, '.lc-mk[data-step="tick"][data-tone="ok"]')[0] ?? "", "color"), "var(--l-ok)");
  assert.equal(value(blocks(css, '.lc-mk[data-step="tick"]')[0], "color"), "var(--l-ink-4)");
  assert.match(src("icons.tsx"), /data-tone=\{tone\}/, "StepMark does not carry its tone");
});

test("A pane's head with a field gives the field all the room up to its tools, for every field and not two by name", () => {
  const pane = sheet("pane.css");
  assert.equal(value(blocks(pane, ".lc-pane-head:has(> .lc-pane-shows > .lc-pane-field) > .lc-grow")[0] ?? "", "flex"), "0 0 0");
  assert.ok(!/\.lc-pane-head:has\(\.lc-files-field/.test(sheet("surfaces.css")), "the rule for two fields by name is still in surfaces.css");
});

test("Notices hang at the chat column's right edge while a panel shows, clear of the panel's head", () => {
  assert.equal(toastRight(1440, null), TOAST_EDGE, "with no panel they hang at the window's edge");
  assert.equal(toastRight(1440, 1000), 456, "beside a 440px panel they hang 16px inside the chat column");
  assert.equal(toastRight(1440, 1440), TOAST_EDGE);
  assert.match(sheet("app.css"), /\.l-toaster\.lc-toaster \{[^}]*right: var\(--lc-toast-right, 16px\);/, "the toaster doesn't read where the chat column ends");
  assert.match(src("App.tsx"), /useToastPlace\(\);/, "nothing measures the chat column for the notices");
});

test("The way back in a menu that opens in place is one shared row, a menu row like the rest", () => {
  const ui = src("ui.tsx");
  assert.match(ui, /export function BackRow\(/);
  assert.match(ui, /<Row title=\{name\} icon=\{<I\.chevL size=\{14\} \/>\}[^\n]*back /, "BackRow is not drawn as a Row with its ‹ in the icons' column");
  assert.match(ui, /data-back=\{back \|\| undefined\}/, "a back row can't be passed over by the parts that focus a list's first row");
  // The ask's rules list uses it, and no longer draws its own back header.
  const ask = src("Ask.tsx");
  assert.match(ask, /<BackRow name="What this session no longer asks about"/);
  assert.ok(!ask.includes("lc-dask-rules-h"), "the ask still draws its own back header");
});

test("A menu's foot line after a rule takes that rule rather than drawing a second", () => {
  const css = sheet("app.css");
  assert.equal(value(blocks(css, ".lc-sep + .lc-pop-foot")[0] ?? "", "border-top"), "0");
});

test("The keyboard settings name what the keys open now", () => {
  const keys = src("keymap.ts");
  assert.match(keys, /session: "Show or hide session details"/);
  assert.match(keys, /"Pin, snooze, settle"/);
  assert.match(keys, /"Find in the session, or in Changes"/);
  assert.ok(!/mark done|in the diff/.test(keys), "an old name is left in the keyboard settings");
});

test("⌘K's session rows say what the sidebar's row menu says, and Stop it shows only while it works", () => {
  const app = src("App.tsx");
  for (const gone of ['"Pin it"', '"Settle it"', '"Archive it"', '"Stop this session"']) assert.ok(!app.includes(`label: ${gone}`) && !app.includes(`"Unpin it" : "Pin it"`), `⌘K still says ${gone}`);
  for (const row of ['label: here.pinned ? "Unpin" : "Pin"', "label: unreadRow(here).title", 'label: "Settle"', 'label: "Open beside"', 'label: "Export as Markdown"', 'label: "Archive"']) assert.ok(app.includes(row), `⌘K has no ${row} row`);
  assert.match(app, /\.\.\.\(stopShows\(here\) \? \[\{ id: "stop", label: "Stop it"/, "Stop it is offered while nothing runs");
  assert.match(app, /footer=\{<span className="lc-cmd-foot">/, "⌘K still shows Liner's own name in its foot");
  assert.match(sheet("app.css"), /\.l-cmd__item:is\(\[id\$="-stop"\], \[id\$="-delete"\], \[id\$="-delete-yes"\]\)/, "Stop it and Delete are not in the danger colour");
});

test("A surface that breaks in the panel shows the pane's one empty state, not a tinted card", () => {
  const b = src("Boundary.tsx");
  assert.match(b, /const \{ inPanel \} = usePaneFrame\(\);/);
  assert.match(b, /if \(inPanel\)\s*return \([\s\S]*?<PaneNote /, "a broken surface in the panel is not a PaneNote");
});

test("The chat's Ship and pull request cards wear the cards' bordered skin and one ink action", () => {
  const css = sheet("app.css");
  for (const sel of [".lc-ship-morph", ".lc-prc"]) {
    const b = blocks(css, sel)[0];
    assert.equal(value(b, "border"), "0.5px solid var(--l-line-2)", `${sel} has no 0.5px rule round it`);
    assert.equal(value(b, "border-radius"), "14px", `${sel} is not at the cards' corner`);
    assert.equal(value(b, "background"), "none", `${sel} is still filled`);
    assert.equal(value(b, "box-shadow"), undefined, `${sel} still has the card ring`);
  }
  const pr = src("PrCard.tsx");
  assert.ok(!/data-kind="(accent|primary)"/.test(pr), "a pull request card's action is not ink");
  assert.match(pr, />\s*Open on GitHub\s*</, "the card still says View pull request");
  assert.ok(!/StateMark state=\{k\.state/.test(pr), "the card's checks still draw the nine-dot shapes");
  const ship = src("Ship.tsx");
  assert.match(ship, /<PaneButton ink className="lc-ship-next"[^\n]*>\s*Open a pull request/, "Open a pull request is not the card's ink action");
  assert.ok(!ship.includes("StateMark"), "the Ship card's status still draws the nine-dot shapes");
});

test("Compare's columns are the pane frame, flush, with Keep this one in ink", () => {
  const c = src("Compare.tsx");
  assert.match(c, /<PaneHead/);
  assert.match(c, /<PaneButton ink[^>]*>\s*Keep this one/);
  assert.ok(!c.includes('className="lc-panel-empty"'), "Compare still draws the empty state by hand");
  assert.ok(!c.includes("<dl"), "Compare's stats are still a table");
  assert.equal(value(blocks(sheet("surfaces.css"), ".lc-cmp-col")[0], "box-shadow"), undefined, "a column is still a card");
});
