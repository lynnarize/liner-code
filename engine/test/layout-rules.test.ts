/*
  The layout rules that were wrong once (plans/layout): each is read from the stylesheet as written, since a
  stylesheet has nothing to run. Run with `node --test engine/test/layout-rules.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sheet = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
// Every block whose selector list holds exactly this selector, in file order: its declarations as text.
const blocks = (css: string, selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")).includes(selector)).map((m) => m[2]);
// One property's value in a block, or undefined.
const value = (block: string, property: string) => block.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`))?.[1].trim();

test("A finding's footer wraps instead of spilling out of a narrow panel", () => {
  const bars = blocks(sheet("security/findings.css"), ".lf-x-act-bar");
  assert.equal(bars.length, 1);
  assert.equal(value(bars[0], "height"), undefined, "the bar keeps a fixed height instead of a minimum");
  assert.equal(value(bars[0], "min-height"), "60px");
  assert.equal(value(bars[0], "flex-wrap"), "wrap");
});

test("Liner Design's top row is a size container that hides the kept copies when narrow", () => {
  const css = sheet("design/design-face.css");
  assert.ok(blocks(css, ".ld-bar").some((b) => value(b, "container") === "ld-bar / inline-size"), "the row is not a size container");
  assert.ok(blocks(css, ".ld-ver").some((b) => value(b, "display") === "none"), "no narrow step hides the kept copies");
});

test("The Add-ons page's top row is in the flow, not laid over its scroller", () => {
  const tops = blocks(sheet("addons-page.css"), ".lc-ao-page > .lc-top");
  assert.ok(tops.every((b) => value(b, "position") === undefined), "a block for the top row still sets position");
});

test("The Add-ons page's column and title match Settings' page pattern", () => {
  const css = sheet("addons-page.css");
  const cols = blocks(css, ".lc-ao-col");
  const heads = blocks(css, ".lc-ao-head h1");
  assert.equal(cols.length, 1);
  assert.equal(heads.length, 1);
  assert.deepEqual({ maxWidth: value(cols[0], "max-width"), h1Size: value(heads[0], "font-size") }, { maxWidth: "760px", h1Size: "24px" }, "the column and title keep the Add-ons page's own measures instead of Settings'");
});

test("Every menu has the 14px corner its rule asks for, outweighing Liner's own sheet", () => {
  const css = sheet("app.css");
  const panels = blocks(css, ".l-pop.lc-pop-panel");
  assert.ok(panels.some((b) => value(b, "border-radius") === "14px"), "no .l-pop.lc-pop-panel block draws the 14px corner");
  // blocks() only matches whole selectors, so scan every selector that mentions the panel for the old 13px corner too.
  const stale = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].includes("lc-pop-panel") && value(m[2], "border-radius") === "13px");
  assert.equal(stale.length, 0, "a block whose selector contains lc-pop-panel still draws 13px");
});

test("A menu's rows stand 2px apart in every list of rows", () => {
  const lists: [string, string][] = [
    ["app.css", ".lc-envp"], ["app.css", ".lc-env-in"], ["app.css", ".lc-who-scroll"], ["app.css", ".lc-rvm"], ["app.css", ".lc-qp-list"],
    ["crew.css", ".lc-crp"], ["crew.css", ".lc-cr-files"], ["addons-page.css", ".lc-ao-ways"], ["models.css", ".lc-pc-list"],
  ];
  for (const [file, selector] of lists) {
    const bs = blocks(sheet(file), selector);
    assert.equal(bs.length, 1, `${file} should hold one ${selector} block`);
    assert.equal(value(bs[0], "gap") ?? value(bs[0], "row-gap"), "2px", `${selector} in ${file} does not stand its rows 2px apart`);
  }
});

test("Every surface's first row in the panel card takes its top inset from the card, written once", () => {
  const card = blocks(sheet("app.css"), ".lc-session:not([data-wide]) .lc-body > .lc-panel:not([data-leaving])");
  assert.ok(card.some((b) => value(b, "--lc-card-top") === "8px"), "the card's rule does not declare --lc-card-top: 8px");
  assert.ok(card.some((b) => value(b, "margin") === "var(--lc-card-top) 0 var(--lc-card-top) var(--lc-card-top)"), "the card's margin still writes the 8px out three times");
  const rows: [string, string][] = [
    ["surfaces.css", ".lc-br-bar"], ["surfaces.css", ".lc-linked-top"], ["surfaces.css", ".lc-dev-bar"],
    ["surfaces.css", ".lc-terms-tabs"], ["surfaces.css", ".lc-files-find"], ["dock.css", ".lc-addon-banner"],
  ];
  for (const [file, selector] of rows) {
    const bs = blocks(sheet(file), selector);
    assert.equal(bs.length, 1, `${file} should hold one ${selector} block`);
    assert.ok(bs[0].includes("var(--lc-card-top"), `${selector} in ${file} does not take its top inset from the card`);
  }
});

test("The panel's column lands on whole pixels, in one pane and in two", () => {
  const one = blocks(sheet("app.css"), ".lc-session[data-panel] .lc-body").filter((b) => (value(b, "grid-template-columns") ?? "").includes("36%"));
  assert.equal(one.length, 1, "app.css should hold one 36% column for the panel");
  assert.ok((value(one[0], "grid-template-columns") ?? "").includes("round(down, 36%, 1px)"), "the panel's column is not rounded down to a whole pixel");
  const two = blocks(sheet("dock.css"), ".lc-session[data-panel][data-panes=\"2\"]:not([data-wide]) .lc-body").filter((b) => (value(b, "grid-template-columns") ?? "").includes("* 1.6"));
  assert.equal(two.length, 1, "dock.css should hold one times-1.6 column for two panes");
  assert.ok((value(two[0], "grid-template-columns") ?? "").includes("round(down, calc(var(--lc-panel-w, clamp(340px, 36%, 520px)) * 1.6), 1px)"), "the two-pane column is not rounded down to a whole pixel");
});

test("Commit's bar keeps its controls on the composer's row, shorter inside the card", () => {
  const feet = blocks(sheet("app.css"), ".lc-panel-foot");
  assert.equal(feet.length, 1);
  assert.equal(value(feet[0], "height"), "calc(70px - 2 * var(--lc-card-top, 0px))", "the foot's height does not give back the card's top and bottom margins");
});

test("The Agents surface starts its text 16px in, like the other text-led surfaces", () => {
  const panels = blocks(sheet("crew.css"), ".lc-agents-panel.lc-cr");
  assert.equal(panels.length, 1);
  assert.equal(value(panels[0], "padding"), "2px 16px 16px", "Agents keeps its own 14px side inset");
});

test("The more-files line in docked Changes starts where the rest of Changes starts", () => {
  const css = sheet("surfaces.css");
  const base = blocks(css, ".lc-rv-more");
  assert.equal(base.length, 1);
  assert.equal(value(base[0], "padding"), "6px 8px", "Review's own line keeps the padding sized for its list");
  const docked = blocks(css, ".lc-changes-panel > .lc-rv-more");
  assert.equal(docked.length, 1, "no rule stands the line in Changes itself at 16px");
  assert.equal(value(docked[0], "padding-inline"), "16px");
});
