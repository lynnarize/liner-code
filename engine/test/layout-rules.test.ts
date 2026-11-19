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

test("The panel takes the paper at 786px of session, and two panes at 946px, not the old 700 and 860", () => {
  for (const file of ["app.css", "dock.css"]) {
    assert.ok(!sheet(file).includes("@container lc-session (max-width: 700px)"), `${file} still hands the paper over at 700px, a breakpoint set before the rail was counted`);
  }
  assert.ok(sheet("app.css").includes("@container lc-session (max-width: 786px)"), "app.css does not hand the paper over at 786px (thread 420 + panel 320 + rail 46)");
  const dock = sheet("dock.css");
  assert.ok(!dock.includes("@container lc-session (max-width: 860px)"), "dock.css still hands the paper over to two panes at 860px");
  assert.ok(dock.includes("@container lc-session (max-width: 946px)"), "dock.css does not hand the paper over to two panes at 946px");
});

test("Taking the whole paper, the panel is flat with its row as the paper's header, in one pane and in two", () => {
  const css = sheet("app.css");
  const flat = (two: boolean) => {
    const at = two ? '[data-panes="2"]' : "";
    const why = two ? " with two panes" : "";
    const p = blocks(css, `.lc-session[data-panel]${at}:not([data-wide]) .lc-body > .lc-panel:not([data-leaving])`);
    assert.ok(p.some((b) => value(b, "--lc-card-top") === "0px" && value(b, "margin") === "0" && value(b, "border-radius") === "0" && value(b, "box-shadow") === "none"), `no flat rule for the panel that takes the paper${why}`);
    const s = blocks(css, `.lc-session[data-panel]${at}:not([data-wide]) .lc-body > .lc-panel[data-tab="session"]:not([data-leaving])`);
    assert.ok(s.some((b) => value(b, "align-self") === "stretch" && value(b, "height") === "auto" && value(b, "max-height") === "none"), `the Session panel does not fill the paper's height${why}`);
    const t = blocks(css, `.lc-session[data-panel]${at}:not([data-wide]) .lc-body > .lc-panel > .lc-panel-top`);
    assert.ok(t.some((b) => value(b, "display") === "flex"), `the paper's header row does not come back${why}`);
  };
  flat(false);
  flat(true);
  assert.ok(css.includes("@container lc-session (max-width: 946px)"), "app.css does not hold the two-pane paper handover at 946px");
  const lead = blocks(sheet("dock.css"), '.lc-session[data-panel][data-panes="2"] .lc-stabs-lead');
  assert.ok(lead.some((b) => value(b, "display") === "inline-flex"), "the sidebar's button does not come back in the two-pane paper header");
  const lights = blocks(css, 'html[data-native="mac"] .lc-app:not([data-sidebar]) .lc-session[data-panel][data-panes="2"]:not(.lc-beside + .lc-beside .lc-session) .lc-panel-top');
  assert.ok(lights.some((b) => value(b, "padding-left") === "max(10px, calc(var(--lc-lights-x, 70px) + 4px))"), "the two-pane paper header does not start after the traffic lights");
});

test("The panel keeps its card while it closes, and a narrow session keeps its flat paper", () => {
  const css = sheet("app.css");
  const look = blocks(css, ".lc-session:not([data-wide]) .lc-body > .lc-panel");
  assert.ok(look.some((b) => value(b, "--lc-card-top") === "8px" && value(b, "margin") === "var(--lc-card-top) 0 var(--lc-card-top) var(--lc-card-top)" && value(b, "overflow") === "hidden" && value(b, "border-radius") === "14px" && value(b, "background") === "var(--lc-paper)" && value(b, "box-shadow") === "0 0 0 1px var(--lc-hair), 0 1px 2px oklch(0.3 0.04 265 / 0.04)"), "the card's look still drops while the panel closes");
  assert.ok(look.some((b) => value(b, "box-shadow") === "0 0 0 0.5px var(--lc-line), 0 1px 2px oklch(0.3 0.04 265 / 0.04)"), "the Retina ring still drops while the panel closes");
  const bg = blocks(css, "html[data-bg] .lc-session:not([data-wide]) .lc-body > .lc-panel");
  assert.ok(bg.some((b) => value(b, "background") === "color-mix(in oklab, var(--lc-paper) 86%, transparent)"), "the tinted ground still drops while the panel closes");
  const sess = blocks(css, '.lc-session:not([data-wide]) .lc-body > .lc-panel[data-tab="session"]');
  assert.ok(sess.some((b) => value(b, "align-self") === "start" && value(b, "height") === "auto" && value(b, "max-height") === "calc(100% - 16px)" && value(b, "overflow") === "auto"), "the Session card's height still drops while it closes");
  const open = blocks(css, ".lc-session:not([data-wide]) .lc-body > .lc-panel:not([data-leaving])");
  assert.ok(open.some((b) => value(b, "justify-self") === "stretch" && value(b, "width") === "auto" && value(b, "min-width") === "0"), "the open card no longer stretches to its column");
  assert.ok(look.some((b) => value(b, "width") === "calc(max(100%, min(var(--lc-panel-w, clamp(340px, (100cqw - 46px) * 0.36, 520px)), calc(100cqw - 466px))) - 8px)"), "the width it closes at does not take the card's 8px margin off");
  const flatClosing = blocks(css, '.lc-session[data-panel]:not([data-wide]) .lc-body > .lc-panel');
  assert.ok(flatClosing.some((b) => value(b, "--lc-card-top") === "0px" && value(b, "margin") === "0" && value(b, "border-radius") === "0" && value(b, "box-shadow") === "none"), "a narrow session's panel does not stay flat while it closes");
  const sessClosing = blocks(css, '.lc-session[data-panel]:not([data-wide]) .lc-body > .lc-panel[data-tab="session"]');
  assert.ok(sessClosing.some((b) => value(b, "align-self") === "stretch" && value(b, "height") === "auto" && value(b, "max-height") === "none"), "a narrow session's Session panel does not stay flat while it closes");
});

test("Two panes fit their column while open, and keep their width less the card's margin while closing", () => {
  const dock = sheet("dock.css");
  const open = blocks(dock, '.lc-session[data-panes="2"]:not([data-wide]) .lc-body > .lc-panel');
  assert.equal(open.length, 0, "a two-pane width still outweighs the card's width: auto while open");
  const closing = blocks(dock, '.lc-session[data-panes="2"]:not([data-wide]) .lc-body > .lc-panel[data-leaving]');
  assert.equal(closing.length, 1, "no closing-only width for two panes");
  assert.equal(value(closing[0], "width"), "calc(max(100%, min(calc(var(--lc-panel-w, clamp(340px, (100cqw - 46px) * 0.36, 520px)) * 1.6), calc(100cqw - 466px))) - 8px)", "the closing two-pane width does not know the rail and the card's margin");
});

test("The thread's column keeps the composer's width, its side inset the composer's 14 plus the tray's 4", () => {
  const ins = blocks(sheet("app.css"), ".lc-scroll-in");
  assert.equal(ins.length, 1);
  assert.equal(value(ins[0], "max-width"), "calc(var(--lc-measure) + 36px)", "the thread's column is not the composer's 748");
  assert.equal(value(ins[0], "padding"), "24px 18px calc(var(--lc-dock-h, 132px) + 18px)", "the thread's side inset is not the composer's 14 plus the tray's 4");
});

test("The conversation's text starts where the composer's text does, and your messages end where its controls end", () => {
  const tls = blocks(sheet("surfaces.css"), ".lc-scroll-in > .lc-tl");
  assert.equal(tls.length, 1);
  assert.equal(value(tls[0], "padding-inline"), "16px 8px", "the timeline keeps its own insets instead of the composer card's 16 and 8");
});

test("Liner Design's top row starts its words at the same edge as Code's", () => {
  const bar = blocks(sheet("design/design-face.css"), ".ld-bar");
  assert.equal(bar.length, 1);
  assert.equal(value(bar[0], "padding"), "6px 10px 6px 20px", "Design's row keeps its own 16px left instead of the row's 20");
  const tt = blocks(sheet("design/design-face.css"), ".ld-tt");
  assert.equal(value(tt[0], "margin-left"), "-10px", "the title's own 10px padding is not pulled back to the row's edge");
});

test("the lean page's title starts on the row's edge too", () => {
  const t = blocks(sheet("design/design-face.css"), ".ld-title");
  assert.equal(value(t[0], "margin-left"), "-8px", "the lean title's own 8px padding is not pulled back to the row's edge");
});

test("Settings' crumbs start their word, not their box, on the row's edge", () => {
  const c = blocks(sheet("app.css"), ".lc-st-crumbs");
  assert.equal(value(c[0], "margin-left"), "-6px", "a crumb's own 6px padding is not pulled back to the row's edge");
});

test("the Found panel's header is its own, not a page's top row", () => {
  const tsx = readFileSync(new URL("../../ui/src/app/security/FoundPanel.tsx", import.meta.url), "utf8");
  assert.equal(tsx.includes("lc-top lsc-found-top"), false, "the Found header still carries lc-top, so the traffic-light rule reaches it");
  const top = blocks(sheet("security/scan.css"), ".lsc-found-top");
  assert.equal(value(top[0], "min-height"), "var(--lc-head)", "the Found header does not keep the top row's height on its own");
});

test("Usage folds by its own width, not the window's", () => {
  const css = sheet("app.css");
  assert.equal(css.includes("@media (max-width: 980px)"), false, "Usage still folds by the window's width");
  assert.equal((css.match(/container: lc-usage \/ inline-size/g) ?? []).length, 1, "Usage's container is not named once");
  assert.equal(css.includes("@container lc-usage (max-width: 968px)"), true, "Usage does not fold by its own 968px");
});

test("the lean page folds by its own width, not the window's", () => {
  const css = sheet("design/lean-page.css");
  assert.equal(css.includes("@media (max-width: 900px)"), false, "the lean page still folds by the window's width");
  assert.equal((css.match(/container: ld-lp \/ inline-size/g) ?? []).length, 1, "the lean page's container is not named once");
  assert.equal(css.includes("@container ld-lp (max-width: 888px)"), true, "the lean page does not fold by its own 888px");
});

test("a finding's panel folds by its page's width, not the window's", () => {
  const css = sheet("security/findings.css");
  assert.equal(css.includes("@media (max-width: 1240px)"), false, "the finding panel still folds by the window's width");
  assert.equal((css.match(/container: lf-page \/ inline-size/g) ?? []).length, 1, "the findings page's container is not named once");
  assert.equal(css.includes("@container lf-page (max-width: 1228px)"), true, "the finding panel does not fold by its page's own width");
});

test("a session's forks stand 2px from the rows round them", () => {
  const css = sheet("app.css");
  const first = blocks(css, ".lc-sb-kids > .lc-sl-row:first-child");
  const after = blocks(css, ".lc-sb-kids + .lc-sl-row");
  assert.equal(first.length, 1, "the first fork has no spacing rule");
  assert.equal(after.length, 1, "the row after a fork list has no spacing rule");
  assert.equal(value(first[0], "margin-top"), "2px");
  assert.equal(value(after[0], "margin-top"), "2px");
});

test("the Limits card keeps the grid's single gap under it", () => {
  assert.equal(blocks(sheet("surfaces.css"), ".lc-limits").length, 0, "Limits still adds its own margin under the grid's gap");
});

test("notices hang under the top row as it is now, not the old 52px one", () => {
  const css = sheet("app.css");
  assert.equal(value(blocks(css, ".l-toaster.lc-toaster")[0], "top"), "calc(6px + var(--lc-head) + 6px)", "the toaster hangs at the old header's height");
  assert.equal(value(blocks(css, '.lc-broke[data-place="float"]')[0], "top"), "calc(6px + var(--lc-head) + 6px)", "the floating notice hangs at the old header's height");
});

test("Liner Design's sidebar rows stand 2px apart, as the shared ones do", () => {
  const css = sheet("design/design-face.css");
  for (const sel of [".ld-side", ".ld-layers", ".ld-files"]) assert.equal(value(blocks(css, sel)[0], "gap"), "2px", sel + " keeps 1px between rows");
});

test("a finding's last line ends clear of the fade", () => {
  assert.equal(value(blocks(sheet("security/findings.css"), ".lf-x-body")[0], "padding"), "4px 22px 40px", "the body's bottom padding is under the fade's 36px");
});

test("Liner Design's open chat keeps 4px at its header's right", () => {
  assert.equal(value(blocks(sheet("design/chat.css"), ".ldc-open > .ldc-h")[0], "padding"), "0 4px 0 10px", "the open chat's header has no right padding");
});

test("the add-ons-off banner keeps the grid's gap, not a margin on top of it", () => {
  assert.equal(value(blocks(sheet("settings.css"), ".lc-st-banner")[0], "margin"), "0", "the banner adds 18px to the grid's 28px gap");
});

test("the composer's stacked rows stand on the card's 4px edge", () => {
  const css = sheet("app.css");
  assert.equal(value(blocks(css, ".lc-queued")[0], "padding"), "6px 4px 6px", "the queued messages sit 2px in, not the card's 4");
  assert.equal(value(blocks(css, ".lc-cold")[0], "margin"), "0 4px 6px", "the cache line sits 2px in, not the card's 4");
});

test("Browser's start-page rows take the column's width, not the panel's 300", () => {
  assert.equal(value(blocks(sheet("surfaces.css"), ".lc-br-start-in .lc-br-ports")[0], "max-width"), "none", "the start page's ports are held to the panel's 300px");
});

test("Setup's install list fades at its bottom to say it scrolls", () => {
  const b = blocks(sheet("setup.css"), ".lc-wel-fold[data-open] > div > .lc-wel-fscroll")[0];
  assert.equal(value(b, "padding-bottom"), "12px", "the open install list has no room for a fade");
  assert.equal(value(b, "mask-image"), "linear-gradient(#000 calc(100% - 12px), transparent)", "the open install list does not fade");
});
