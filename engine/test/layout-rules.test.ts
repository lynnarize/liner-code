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
