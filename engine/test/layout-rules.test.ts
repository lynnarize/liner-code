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

test("The more-files line in Changes' files menu starts where the menu's files start", () => {
  const css = sheet("surfaces.css");
  const base = blocks(css, ".lc-rv-more");
  assert.equal(base.length, 1);
  assert.equal(value(base[0], "padding"), "6px 8px", "the line in the full canvas's files column keeps the padding sized for its list");
  // In the side panel the files are a menu under the row's Files button (Review.tsx), its rows 10px in.
  const row = blocks(css, ".lc-rv-fm");
  assert.equal(row.length, 1);
  assert.equal(value(row[0], "padding"), "0 10px", "the menu's files are no longer 10px in, so the line below would not line up");
  const menu = blocks(css, ".lc-rv-fmenu > .lc-rv-more");
  assert.equal(menu.length, 1, "no rule stands the line in the files menu where its files start");
  assert.equal(value(menu[0], "padding-inline"), "10px");
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
  // L13 renamed these closing selectors to the panel's own [data-leaving] mark: the session has lost [data-panel] by then.
  const flatClosing = blocks(css, '.lc-session:not([data-wide]) .lc-body > .lc-panel[data-leaving]');
  assert.ok(flatClosing.some((b) => value(b, "--lc-card-top") === "0px" && value(b, "margin") === "0" && value(b, "border-radius") === "0" && value(b, "box-shadow") === "none"), "a narrow session's panel does not stay flat while it closes");
  const sessClosing = blocks(css, '.lc-session:not([data-wide]) .lc-body > .lc-panel[data-tab="session"][data-leaving]');
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

import { readdirSync } from "node:fs";

test("the classes nothing references are gone from every stylesheet", () => {
  const root = new URL("../../ui/src/app/", import.meta.url);
  const files: URL[] = [];
  const walk = (d: URL) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = new URL(e.name + (e.isDirectory() ? "/" : ""), d); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".css")) files.push(p); } };
  walk(root);
  const dead = ["lc-stop", "lc-box-keys", "lc-agent-card-t", "lc-ask-title", "lc-accent-t", "lc-tstep-line", "lc-tstep-target", "lc-trail-agent-t"];
  for (const f of files) {
    const css = readFileSync(f, "utf8");
    for (const c of dead) assert.equal(new RegExp(`(^|[^A-Za-z0-9_-])${c}([^A-Za-z0-9_-]|$)`).test(css), false, `${c} is still in ${f.pathname}`);
  }
});

test("the sidebar's width is said once", () => {
  const css = sheet("app.css");
  assert.equal((css.match(/--lc-side:/g) ?? []).length, 1, "--lc-side is declared more than once");
  assert.ok(css.includes("--lc-side: 264px"), "the one declaration is not --lc-side: 264px, so a wrong width would pass");
});

test("the corner scale declares its four tokens", () => {
  const css = sheet("app.css");
  for (const t of ["--lc-r-row: 8px", "--lc-r-field: 10px", "--lc-r-card: 14px", "--lc-r-sheet: 18px"]) assert.equal(css.includes(t), true, t + " is not declared");
});

test("corners follow the four-size scale outside the skipped ranges", () => {
  const root = new URL("../../ui/src/app/", import.meta.url);
  const files: URL[] = [];
  const walk = (d: URL) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = new URL(e.name + (e.isDirectory() ? "/" : ""), d); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".css")) files.push(p); } };
  walk(root);
  const skippedSel = /(^|[\s,])(\.lc-rt|\.lc-rb|\.lc-run|\.lc-pr-(head|title|checks|dot|status|spin)|\.lc-pv-)/;
  const banned = /border-radius: (7|9|11|13|15)px;/;
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    const isIntro = f.pathname.endsWith("/intro.css");
    for (let i = 0; i < lines.length; i++) {
      if (!banned.test(lines[i])) continue;
      if (isIntro && i + 1 >= 150 && i + 1 <= 815) continue;
      let j = i; while (j > 0 && !lines[j].trimEnd().endsWith("{")) j--;
      const sel = lines[j].trimEnd().slice(0, -1);
      if (skippedSel.test(sel)) continue;
      assert.fail(`${f.pathname}:${i + 1} has an off-scale corner outside the skipped ranges: ${lines[i].trim()}`);
    }
  }
});

test("the 2x ring override names the open card's selector beside the bare one, so the ring is half a pixel", () => {
  const css = sheet("app.css");
  const open = ".lc-session:not([data-wide]) .lc-body > .lc-panel:not([data-leaving])";
  const bare = ".lc-session:not([data-wide]) .lc-body > .lc-panel";
  const lists = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")), body: m[2] }));
  assert.ok(lists.some((b) => b.sels.includes(open) && b.sels.includes(bare) && (value(b.body, "box-shadow") ?? "").includes("0.5px")), "the 2x override does not carry the open card's selector, so the card rule's 1px ring wins on a Retina screen");
});

test("a narrow session's closing panel is named by its own mark, and the dead [data-panel] closing copy is gone", () => {
  const css = sheet("app.css");
  const narrow = [...css.matchAll(/@container lc-session \(max-width: 786px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  assert.ok(narrow.length, "app.css does not hold the 786px session container");
  const closing = narrow.flatMap((c) => blocks(c, ".lc-session:not([data-wide]) .lc-body > .lc-panel[data-leaving]"));
  assert.ok(closing.some((b) => value(b, "border-radius") === "0"), "the narrow closing panel is not named by its own [data-leaving] mark, so the bare card rule turns it into a card while it fades");
  assert.equal(blocks(css, ".lc-session[data-panel]:not([data-wide]) .lc-body > .lc-panel").length, 0, "the closing copy that asks for [data-panel] is still there: the session has lost that mark by then, so it never matches");
});

test("a panel that was the whole paper closes flat, told by the session's data-left-wide", () => {
  const wide = blocks(sheet("app.css"), ".lc-session[data-left-wide] .lc-body > .lc-panel[data-leaving]");
  assert.ok(wide.some((b) => value(b, "box-shadow") === "none" && value(b, "border-radius") === "0" && value(b, "margin") === "0"), "no data-left-wide rule keeps a closing full-canvas panel flat: it flashes as a card with a ring");
});

test("the first Remove on an add-on's sheet keeps its size and corner, while the confirm Remove stays without a height", () => {
  const css = sheet("addons-page.css");
  const own = blocks(css, ".lc-ao-remove:not(.lc-btn)");
  // 30, a button's size from the set (R11), the same as the header buttons.
  assert.ok(own.some((b) => value(b, "height") === "30px"), "the first Remove is not a .lc-btn and has no rule giving it a height, so it reads as bare text");
  const plain = blocks(css, ".lc-ao-remove");
  assert.ok(plain.length > 0 && plain.every((b) => value(b, "height") === undefined), "the plain .lc-ao-remove rule carries a height, so the confirm .lc-btn would not take the button's size");
});

test("Design's title wrapper is a flex parent, so the title button shortens instead of running under the chip", () => {
  const wrap = blocks(sheet("design/design-face.css"), ".ld-bar .lc-pop:has(> .ld-tt)");
  assert.ok(wrap.some((b) => value(b, "display") === "flex"), "the title's wrapper is not a flex parent, so the button in it keeps its width and is drawn under the chip");
});

test("Liner Design's top row keeps the title, the kept copies, the zoom and Play, and puts the rest under one ···", () => {
  // Who is drawing, the server chip and the On-its-own chip once crowded the row (and each needed a narrow step to hide): they live on the frames, in the sidebar and under the ··· now.
  const face = readFileSync(new URL("../../ui/src/app/design/DesignFace.tsx", import.meta.url), "utf8");
  const row = face.slice(face.indexOf("function TopRow("), face.indexOf("/** Under an empty canvas"));
  for (const gone of ["ld-who", "OwnChip", "LiveChip"]) assert.ok(!row.includes(gone), `the top row still draws ${gone}`);
  for (const kept of ["<TabTitle />", "<Versions />", "Zoom,", "aria-label=\"Play", "<TopMore "]) assert.ok(row.includes(kept), `the top row lost ${kept}`);
  const css = sheet("design/design-face.css");
  assert.equal(blocks(css, ".ld-who").length + blocks(css, ".ld-own-t").length, 0, "a rule is left for a part the top row no longer has");
  // The kept copies are one menu: no back and forward buttons beside it.
  const versions = readFileSync(new URL("../../ui/src/app/design/Versions.tsx", import.meta.url), "utf8");
  assert.ok(!/<button[^>]*aria-label="A copy (back|forward)"/.test(versions), "the kept copies still have their own back and forward buttons beside the menu");
});

test("with the sidebar hidden, Design's title keeps clear of Show the sidebar", () => {
  const after = blocks(sheet("design/design-face.css"), ".ld-bar > .lc-tb + .lc-pop > .ld-tt");
  assert.ok(after.some((b) => value(b, "margin-left") === "-4px"), "the title keeps its full -10px pull after the sidebar button, so its hover plate covers the button's last 4px");
});

test("the switch, the checks' dots and counts, and Setup's pills keep their round sides at 999px", () => {
  const pills: [string, string][] = [
    ["surfaces.css", ".lc-sinfo-switch"], ["design/checks.css", ".ld-ck-n"], ["design/checks.css", ".ld-ck-mark[data-more]"],
    ["design/checks.css", ".ld-ck-mark"], ["setup.css", ".lc-wel-pill"],
  ];
  for (const [file, selector] of pills) {
    const bs = blocks(sheet(file), selector);
    assert.ok(bs.some((b) => value(b, "border-radius") === "999px"), `${selector} in ${file} is not a full pill: the corner scale flattened what was half its height`);
  }
});

test("the add-on split button's halves take the field corner, and no 11px corner is left on the page", () => {
  const css = sheet("addons-page.css");
  const left = blocks(css, ".lc-ao-split > button:first-child");
  assert.ok(left.some((b) => value(b, "border-radius") === "var(--lc-r-field) 0 0 var(--lc-r-field)"), "the split's first half keeps 11px inside a parent that went to 10");
  const right = blocks(css, ".lc-ao-split-more");
  assert.ok(right.some((b) => value(b, "border-radius") === "0 var(--lc-r-field) var(--lc-r-field) 0"), "the split's chevron half keeps 11px inside a parent that went to 10");
  const stale = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => (value(m[2], "border-radius") ?? "").includes("11px"));
  assert.equal(stale.length, 0, "a border-radius on the Add-ons page still draws 11px");
});

test("the state mark moves whatever Reduce motion and the Motion setting say", () => {
  const css = sheet("app.css");
  // foundation.css cuts every animation and transition under .l-scope to a moment, with !important: the mark's dots outrank it.
  const kept = blocks(css, ".l-scope .lc-mk > i");
  assert.ok(kept.some((b) => (value(b, "animation-iteration-count") ?? "").includes("!important") && (value(b, "transition-duration") ?? "").includes("!important")), "nothing holds the mark's dots against foundation.css's reduced-motion rule, so its light and its change of state stop");
  // No rule of the app's own puts the mark's dots, or the mark, to sleep (one that leaves them out with :not() is fine; the middle dot of working stays dim on purpose).
  for (const file of ["app.css", "surfaces.css", "crew.css", "wall.css", "design.css", "design/design-face.css", "security/scan.css"]) {
    const still = [...sheet(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /\.lc-mk\b/.test(m[1].replace(/:not\([^)]*\)\)?/g, "")) && /animation:\s*none|transition:\s*none/.test(m[2]) && !/nth-child\(5\)/.test(m[1]));
    assert.equal(still.length, 0, `${file} stops the state mark: ${still.map((m) => m[1].trim()).join(", ")}`);
  }
  // Quick motion's entering window ends what a view starts as it opens, except its hints: the mark's dots are one.
  const look = readFileSync(new URL("../../ui/src/app/look.ts", import.meta.url), "utf8");
  assert.match(look, /const HINTS = "[^"]*\.lc-mk > i/, "look.ts's entering window would end a mark's change of state as a view opens");
});

test("The live line's newest step slides in whatever Reduce motion and the Motion setting say", () => {
  const css = sheet("timeline.css");
  // foundation.css cuts every animation under .l-scope to a moment, with !important: the step's slide outranks it, at its own length.
  assert.ok(blocks(css, '.l-scope .lc-ll-tick > [data-ph="in"]').some((b) => value(b, "animation-duration") === "300ms !important"), "Reduce motion stops the newest step sliding up into place");
  assert.ok(blocks(css, '.l-scope .lc-ll-tick > [data-ph="out"]').some((b) => value(b, "animation-duration") === "200ms !important"), "Reduce motion stops the old step leaving upward");
  assert.ok(blocks(css, '.lc-ll-step[data-ph="in"]').some((b) => /lc-ll-in 300ms/.test(value(b, "animation") ?? "")), "the step comes in over 300ms");
  // No rule of the app's own puts the step to sleep.
  for (const file of ["app.css", "surfaces.css", "timeline.css", "design/chat.css", "security/scan.css"]) {
    const still = [...sheet(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /\.lc-ll-(?:tick|step)\b/.test(m[1]) && /animation:\s*none/.test(m[2]));
    assert.equal(still.length, 0, `${file} stops the live line's step: ${still.map((m) => m[1].trim()).join(", ")}`);
  }
  // Quick motion's entering window leaves the step's slide to play.
  const look = readFileSync(new URL("../../ui/src/app/look.ts", import.meta.url), "utf8");
  assert.match(look, /const HINTS = "[^"]*\.lc-ll-tick > \*/, "look.ts's entering window would end the newest step's slide as a view opens");
});

test("Liner Design's and Liner Security's buttons, chips and tabs take the app's sizes, as Code's do", () => {
  // In-content buttons and chips are 28 square or high (lc-ib's size), a picker's rows 36: none of the 18 to 26 or 34 they once had.
  const sized: [string, string, string, string][] = [
    ["design/inspector.css", ".ld-ib", "height", "28px"], ["design/inspector.css", ".ld-stops > button", "height", "28px"], ["design/inspector.css", ".ld-swt", "height", "28px"],
    ["design/design-face.css", ".ld-chip", "height", "28px"], ["design/design-face.css", ".ld-lab-b", "height", "28px"], ["design/build.css", ".ld-live-lk", "height", "28px"],
    ["design/build.css", ".ld-lpick-r", "height", "36px"], ["design.css", ".lc-dz-ver", "height", "28px"], ["design.css", ".lc-dz-zoom > button", "height", "28px"],
    ["security/security.css", ".ls-sg", "height", "28px"], ["security/scan.css", ".lsc-pb", "height", "28px"], ["security/overview.css", ".lo-chev", "height", "28px"],
  ];
  for (const [file, selector, property, want] of sized) {
    const found = blocks(sheet(file), selector).map((b) => value(b, property)).filter(Boolean);
    assert.ok(found.length && found.every((v) => v === want), `${selector} in ${file} is ${found.join(", ") || "unset"}, not ${want}`);
  }
  // One tab look in Security: no page sets its own height or size on the shared tab.
  const findings = sheet("security/findings.css");
  for (const tab of [".lf-tab", ".lf-x-tab"]) assert.ok(blocks(findings, tab).every((b) => !value(b, "height") && !value(b, "font-size")), `${tab} sizes Security's shared tab its own way`);
  // A model's working light, a fact's dot: the server's live dot is words now, so no 7px dot is left in Design's sheets.
  assert.equal(blocks(sheet("design/build.css"), ".ld-bdot").length, 0, "the server's live dot is back in build.css");
  // A finding's code excerpt is code as Files, Changes and Compare show it: 13 on a 22px line.
  const excerpt = blocks(findings, ".lf-x-ev");
  assert.ok(excerpt.some((b) => value(b, "font-size") === "13px" && value(b, "line-height") === "22px"), "a finding's excerpt is not 13px on a 22px line");
});

test("Code's and the shell's buttons, marks and code take the app's sizes, one look each", () => {
  const app = sheet("app.css");
  // A header's button is 30 (R11), an icon button in content 28, the sidebar's Hide too.
  assert.ok(blocks(app, ".lc-tb").some((b) => value(b, "height") === "30px" && value(b, "min-width") === "30px"), "the header's button is not 30px");
  assert.ok(blocks(app, ".lc-sb-hb").some((b) => value(b, "width") === "28px" && value(b, "height") === "28px"), "the sidebar's Hide is not 28 square");
  // Pressed, an icon button looks as the right edge's lit icon does: a wash, no ring, in content and in a header.
  for (const sel of ['.lc-ib[aria-pressed="true"]', '.lc-tb[aria-pressed="true"]']) {
    const b = blocks(app, sel);
    assert.ok(b.length && b.every((x) => value(x, "background") === "var(--l-wash-2)" && value(x, "box-shadow") === undefined), `${sel} is not the lit icon's look`);
  }
  // A model's or tool's mark is bare: a setting's mark place and a line's small mark place have no plate.
  for (const sel of [".lc-st-mark", ".lc-tile"]) assert.ok(blocks(app, sel).every((b) => !value(b, "background") && !value(b, "box-shadow")), `${sel} draws a tile round its mark`);
  const crew = sheet("crew.css");
  assert.ok(blocks(crew, ".lc-cr-tile").every((b) => !value(b, "background")), "an agent's mark in the Agents surface sits on a plate");
  // A word on a pill has no dot of its own: a state is the state mark.
  assert.equal(blocks(app, ".lc-badge[data-dot]::before").length, 0, "Badge draws its own dot again");
  // Code is 13 on a 22px line in a file view, as in Changes and Compare.
  const surfaces = sheet("surfaces.css");
  assert.ok(blocks(surfaces, ".lc-code-view").some((b) => value(b, "font-size") === "13px" && value(b, "line-height") === "22px"), "Files shows code at another size than Changes");
  assert.ok(blocks(surfaces, ".lc-rv-code").some((b) => value(b, "font-size") === "13px" && value(b, "line-height") === "22px"), "Changes shows code at another size");
  assert.ok(blocks(surfaces, ".lc-cmp-body .l-cdiff__rows").some((b) => value(b, "font-size") === "13px" && value(b, "line-height") === "22px"), "Compare shows code at another size");
  // A changed line in Files is tinted green as an added line in Changes is, never amber.
  assert.equal(blocks(surfaces, '.lc-cl[data-mark="changed"]').length, 0, "Files tints a changed line its own amber again");
  // A shell tab's close is the panel tabs' size.
  assert.ok(blocks(surfaces, ".lc-terms-x").some((b) => value(b, "width") === "16px" && value(b, "height") === "16px"), "a shell tab's close is not the panel tabs' 16px");
  assert.ok(blocks(surfaces, ".lc-stab-x").some((b) => value(b, "width") === "16px"), "the panel tabs' close moved off 16px");
  // The Wall's filter tabs are Security's tabs: 28 high.
  assert.ok(blocks(sheet("wall.css"), ".lc-wall-tab").some((b) => value(b, "height") === "28px"), "The Wall's tabs are not 28 high");
});

test("Every action in an actions menu carries an icon, so no menu has some rows with one and some without", () => {
  // The source as written, comments and all: a menu's rows are one to a line, so each line with a <Row is read on its own.
  const source = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");
  const between = (text: string, from: string, to: string) => {
    const i = text.indexOf(from);
    assert.ok(i >= 0, `${from} is gone`);
    return text.slice(i, text.indexOf(to, i));
  };
  const menus: { file: string; from: string; to: string; actions: string[] }[] = [
    // The session row's ··· and right-click menu (SessionMenu): the snooze times and the groups are choices in the lists two of its rows open; the rest act.
    { file: "Sidebar.tsx", from: "function SessionMenu(", to: "\n}\n", actions: ['"Open beside"', '"Unpin"', '"Settle"', '"Snooze until"', '"Move to a group"', '"Wake it now"', '"New group"', '"Take it out of its group"', '"Rename"', '"Export as Markdown"', '"Archive"', '"Bring it back"'] },
    // Several rows picked: the groups are where they go, and taking them out is an action.
    { file: "Sidebar.tsx", from: 'label="Move them to a group"', to: "</Pop>", actions: ['"Out of their groups"'] },
    // Liner Design's zoom menu, as the zoom buttons elsewhere draw it.
    { file: "design/DesignFace.tsx", from: "<Pop label={`Zoom,", to: "</Pop>", actions: ['"Zoom in"', '"Zoom out"', '"Zoom to fit"', '"Actual size"'] },
    // Run it's arrow: the ways to say yes are choices; the rules page is an action after them.
    { file: "Ask.tsx", from: "function Ways(", to: "\n}\n", actions: ["no longer asks about"] },
  ];
  for (const m of menus) {
    const rows = between(source(m.file), m.from, m.to).split("\n").filter((l) => l.includes("<Row "));
    for (const a of m.actions) {
      const lines = rows.filter((l) => l.includes(a));
      assert.ok(lines.length, `${m.file} has no ${a} row in its menu`);
      for (const l of lines) assert.equal((l.match(/icon=\{/g) ?? []).length, (l.match(/<Row /g) ?? []).length, `${a} in ${m.file} has no icon`);
    }
  }
});

test("The model picker is a rail, a middle card that never changes size, and a card at its side that folds into a line when narrow", () => {
  const css = sheet("models.css");
  const one = (selector: string) => {
    const bs = blocks(css, selector);
    assert.equal(bs.length, 1, `models.css should hold one ${selector} block`);
    return bs[0];
  };
  // Side by side: 40 of rail, 312 of list, 268 of card; narrow, the card goes and the list keeps its width.
  assert.equal(value(one('.lc-pk[data-side="card"]'), "grid-template-columns"), "40px 312px 268px", "the picker's three parts are not 40, 312 and 268 wide");
  assert.equal(value(one('.lc-pk[data-side="line"]'), "grid-template-columns"), "40px 312px", "narrow, the list doesn't keep its width without the card");
  assert.match(value(one(".lc-pk"), "--lc-pk-tall") ?? "", /^min\(var\(--lc-pk-h, 476px\)/, "the middle card isn't 476 high");
  assert.equal(value(one(".lc-pk"), "align-items"), "start", "the side card's top isn't on the middle card's top");
  // One height whatever the tool: a set height, never a max, with nothing spilling out of it.
  const mid = one(".lc-pk-mid");
  assert.equal(value(mid, "height"), "var(--lc-pk-tall)", "the middle card grows or shrinks with its rows");
  assert.equal(value(mid, "max-height"), undefined);
  assert.equal(value(mid, "overflow"), "hidden");
  // Only the middle scrolls: every other part keeps its height, and the scroller takes what is left.
  assert.equal(value(one(".lc-pk-mid > *"), "flex"), "none", "Find, Fusion, the tool's row or the foot rows give up height to the list");
  const scroll = one(".lc-pk-scroll");
  assert.equal(value(scroll, "flex"), "1 1 0", "the models don't take the middle card's room left over");
  assert.equal(value(scroll, "overflow"), "hidden auto", "the models don't scroll inside the card");
  assert.equal(value(one(".lc-pk-top"), "height"), "40px", "Find is not a 40px row");
  assert.equal(value(one(".lc-pk-head"), "height"), "36px", "the tool's row with its source switch is not 36px");
  assert.equal(value(one(".lc-who-row.lc-pk-row"), "height"), "32px", "a model's row is not 32 high");
  assert.equal(value(one(".lc-pk-lvr"), "height"), "28px", "an effort level's row is not 28 high");
  assert.equal(value(one(".lc-pk-rail"), "width"), "40px", "the rail is not 40 wide");
  assert.equal(value(one(".lc-pk-tool"), "width"), "28px", "a tool's button is not 28 wide");
  assert.equal(value(one('.lc-pk-tool[aria-pressed="true"]'), "background"), "var(--lc-plate)", "the tool shown isn't in the app's one pressed look");

  const models = readFileSync(new URL("../../ui/src/app/Models.tsx", import.meta.url), "utf8");
  const picker = models.slice(models.indexOf("export function ModelPicker("), models.indexOf("export type PickChoice"));
  assert.ok(picker.length > 500, "ModelPicker is gone");
  // In the middle card, in this order: Find, the pinned rows, the tool's row, the models, a note, the foot rows, the narrow line.
  const order = ['className="lc-pk-top"', 'className="lc-pk-pin"', "{head}", 'className="lc-pk-scroll"', 'className="lc-pk-note"', 'className="lc-pk-foot"', 'className="lc-pk-line"'];
  let at = picker.indexOf('className="lc-pk-card lc-pk-mid"');
  assert.ok(at > 0, "the middle card is gone");
  for (const o of order) {
    const i = picker.indexOf(o, at);
    assert.ok(i > at, `${o} is not where the middle card's order puts it`);
    at = i;
  }
  // The source switch sits in the tool's pinned row, never in what scrolls.
  const head = picker.slice(picker.indexOf("const head ="), picker.indexOf("const pinned ="));
  assert.match(head, /className="lc-pk-src" role="group"/, "the source switch isn't in the tool's pinned row");
  assert.match(models, /className="lc-pk-card lc-pk-rail" role="toolbar" aria-orientation="vertical" aria-label="Tools"/, "the rail isn't a vertical toolbar");
  assert.match(models, /className="lc-pk-slide l-focus"\s+role="slider"/, "the effort levels aren't one slider");
  assert.match(picker, /\{wide && \(\s*<section ref=\{card_\} className="lc-pk-card lc-pk-side"/, "the side card isn't drawn only where there is room");
  assert.match(picker, /\{side === "line" && shown && <div className="lc-pk-line">\{shown\.line\}<\/div>\}/, "narrow, the card's words aren't a line at the list's foot");
  // The card turns to a row only after the pointer rests on it, and never while the pointer is over the card.
  assert.match(picker, /settle\(d, performance\.now\(\), overCard\.current\)/, "the side card follows the pointer without the dwell");
  assert.match(picker, /onPointerEnter=\{\(\) => \(\(overCard\.current = true\), window\.clearTimeout\(timer\.current\)\)\}/, "the pointer over the card doesn't hold it");

  // The message box's who chip opens the picker, its card at the side where the window has room.
  const composer = readFileSync(new URL("../../ui/src/app/Composer.tsx", import.meta.url), "utf8");
  const pop = composer.split("\n").find((l) => l.includes("<Pop label={`Who works on this, and how hard"));
  assert.ok(pop, "the who panel's Pop is gone");
  assert.match(pop, /width=\{pickerWide \? PICKER_WIDE : PICKER_NARROW\} bare/, "the who chip doesn't open the picker at its own widths, drawing its own cards");
  assert.match(composer, /<WhoPanel [^>]*side=\{pickerWide \? "card" : "line"\}/, "the who panel doesn't fold its card into a line when narrow");
  const picker_ = readFileSync(new URL("../../ui/src/app/picker.ts", import.meta.url), "utf8");
  assert.match(picker_, /export const PICKER = \{ rail: 40, gap: 8, list: 312, height: 476, side: 268 \} as const;/, "the picker's sizes moved");
});

test("No effort level is invented in the app: a model's levels are what its tool reported for it, and nothing stands in when it reported none", () => {
  const dir = new URL("../../ui/src/app/", import.meta.url);
  const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.(ts|tsx)$/.test(f));
  for (const f of files) {
    const text = readFileSync(new URL(f, dir), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // A list of levels kept in the app: an object naming a level by id beside its label ({ id: "medium", label: "Medium" }).
    assert.doesNotMatch(text, /\{\s*id:\s*"(minimal|low|medium|high|xhigh|max)",\s*label:/, `${f} keeps a list of effort levels of its own`);
    assert.doesNotMatch(text, /PAIR_EFFORTS|const EFFORTS\b/, `${f} keeps a list of effort levels of its own`);
  }
  const model = readFileSync(new URL("model.ts", dir), "utf8");
  const body = model.slice(model.indexOf("export function effortsFor("), model.indexOf("\n}\n", model.indexOf("export function effortsFor(")));
  assert.doesNotMatch(body, /supports\.effort/, "a model's levels still follow whether its tool takes levels at all");
  assert.match(body, /m\?\.efforts\?\.length \? \{ list: m\.efforts, fallback: m\.defaultEffort \} : \{ list: \[\], fallback: undefined \}/, "a model's levels are not exactly its own");
  // Settings' lead's effort is the levels of the lead's model, not the app's three.
  assert.match(readFileSync(new URL("Agentic.tsx", dir), "utf8"), /<EffortPick modelRef=\{c\.lead\}/, "Settings' lead's effort isn't the lead model's levels");
});

test("No level word is saved or sent as a default from the app: a new session, a pair's lead, the Demo and a new agent ask only for a level the model's tool listed", () => {
  const dir = new URL("../../ui/src/app/", import.meta.url);
  const code = (f: string) => readFileSync(new URL(f, dir), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const word = "(minimal|low|medium|high|xhigh|max)";
  for (const f of ["model.ts", "Home.tsx", "design/session.ts", "AgentDialog.tsx", "Composer.tsx"]) {
    const text = code(f);
    // A word put in as the effort ("effort: \"low\"", "?? \"medium\"", "word = \"medium\""), not a preset's wish that goes through keptLevel.
    const given = new RegExp(`(effort|word|pairEffort)\\s*(:|=|\\?\\?)\\s*"${word}"|\\?\\?\\s*"${word}"|useState<Effort>\\("${word}"\\)`);
    const lines = text.split("\n").filter((l) => given.test(l) && !/^\s*\{\s*id:\s*"\w+",\s*label:/.test(l));
    assert.deepEqual(lines, [], `${f} gives a level word as an effort`);
  }
  // A new agent saves the level kept for its model, never the preset's word as it is.
  assert.match(code("AgentDialog.tsx"), /effort: levelOf\(model\)/, "a new agent saves its preset's level whether the model lists it or not");
  assert.match(code("AgentDialog.tsx"), /keptLevel\(/, "a new agent's level doesn't go through keptLevel");
  // A model alone and a pair's lead start at a level their tool listed.
  const model = code("model.ts");
  assert.match(model, /export function startEffort\(ref: string, providers: ProviderInfo\[\]\): string \{[\s\S]*?return startLevel\(list, fallback\);/, "a new session's level isn't startLevel");
  assert.match(model, /return keptLevel\(list, pairEffort, fallback, pairEffort !== undefined\);/, "a pair's lead's level isn't keptLevel");
});

test("A menu row is one line 30px high with a 16px icon in the second ink, and no menu draws its icons in the accent", () => {
  const css = sheet("app.css");
  const row = blocks(css, ".lc-row");
  assert.equal(row.length, 1, "the menu row has more than one base rule");
  assert.equal(value(row[0], "min-height"), "30px", "a menu row is not 30 high");
  assert.equal(value(row[0], "padding"), "0 8px", "a menu row's padding gives it a second line's height");
  assert.equal(value(row[0], "align-items"), "center", "a menu row's icon and title don't sit on one line");
  const tick = blocks(css, ".lc-row-tick");
  assert.equal(tick.length, 1);
  assert.equal(value(tick[0], "color"), "var(--l-ink-2)", "a menu row's icon is not in the second ink");
  assert.ok(blocks(css, ".lc-row-tick > svg").some((b) => value(b, "width") === "16px" && value(b, "height") === "16px"), "a menu row's icon is not 16px");
  const title = blocks(css, ".lc-row-t b");
  assert.ok(title.some((b) => value(b, "white-space") === "nowrap"), "a menu row's title wraps onto a second line");
  // No sheet puts a row's icon, tick or end back in the accent.
  for (const file of ["app.css", "modes.css", "surfaces.css", "dock.css", "models.css", "design.css", "design/design-face.css", "security/security.css", "security/side.css"]) {
    const text = sheet(file);
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\.lc-row-(tick|end)\b/.test(m[1])) assert.doesNotMatch(m[2], /--l-accent/, `${file}: ${m[1].trim()} draws a menu row's icon in the accent`);
    }
  }
  // The note under a title is the row's tooltip; it shows only where a caller keeps it (keepNote).
  const ui = readFileSync(new URL("../../ui/src/app/ui.tsx", import.meta.url), "utf8");
  const rowSource = ui.slice(ui.indexOf("export function Row("), ui.indexOf("export function ConfirmRow("));
  assert.match(rowSource, /const shown = keepNote && note;/, "a row shows its note without being asked to");
  assert.match(rowSource, /\{shown && <small>\{note\}<\/small>\}/, "a kept note is not under the title");
  assert.match(rowSource, /title=\{tip\}/, "a note that goes is not the row's tooltip");
  assert.match(rowSource, /\{opens && <I\.chevR size=\{14\} \/>\}/, "a row that opens a list has no 14px › at its end");
  // A confirm about to act keeps its note: it says what the press will do.
  assert.match(ui.slice(ui.indexOf("export function ConfirmRow("), ui.indexOf("export const PanelHead")), /keepNote=\{asked\}/, "a confirm's second state hides what it will do");
});

test("The session menu has no inner headings, and its snooze times and groups open as lists in its place", () => {
  const side = readFileSync(new URL("../../ui/src/app/Sidebar.tsx", import.meta.url), "utf8");
  const menu = side.slice(side.indexOf("function SessionMenu("), side.indexOf("\n}\n", side.indexOf("function SessionMenu(")));
  assert.ok(menu.length > 100, "SessionMenu is gone");
  assert.doesNotMatch(menu, /<PanelHead>/, "the session menu still has a heading inside it");
  // Its rows, in order, one line each: no note shows under any.
  const order = ['"Open beside"', '"Pin"', '"Settle"', '"Snooze until"', '"Move to a group"', '"Rename"', '"Export as Markdown"', "<Sep />", '<Row title="Archive"'];
  const top = menu.slice(menu.lastIndexOf(") : (", menu.indexOf('"Open beside"')));
  let at = -1;
  for (const o of order) {
    const i = top.indexOf(o, at + 1);
    assert.ok(i > at, `${o} is not where the menu's order puts it`);
    at = i;
  }
  assert.doesNotMatch(menu, /keepNote/, "a row in the session menu keeps a second line");
  assert.doesNotMatch(menu, /title="Archive"[^\n]*forGood|title="Archive"[^\n]*danger/, "Archive, which can be undone, is red");
  // The two lists open in place, with the way back on top, and the keyboard goes in and comes back.
  assert.match(menu, /<Row title="Snooze until"[^\n]*opens="snooze" onPick=\{\(\) => open\("snooze"\)\}/, "Snooze until doesn't open its list in the menu's place");
  assert.match(menu, /<Row title="Move to a group"[^\n]*opens="group" onPick=\{\(\) => open\("group"\)\}/, "Move to a group doesn't open its list in the menu's place");
  assert.match(menu, /<BackRow name="Snooze until" menu onBack=\{back\} \/>/);
  assert.match(menu, /<BackRow name="Move to a group" menu onBack=\{back\} \/>/);
  assert.match(menu, /open = \(which: "snooze" \| "group"\) => \(setList\(which\), focus\("button:not\(:disabled\):not\(\.lc-who-back\)"\)\)/, "the keyboard doesn't land on the list's first row");
  assert.match(menu, /focus\(`\[data-opens="\$\{was\}"\]`\)/, "the keyboard doesn't come back to the row that opened the list");
  assert.match(menu, /e\.key === "Escape" && !e\.defaultPrevented && \(e\.preventDefault\(\), back\(\)\)/, "Escape closes the menu from a list instead of going back");
  // The list is the menu part's own state, and the part is drawn anew for each session and gone when the menu closes.
  assert.match(menu, /useState<"" \| "snooze" \| "group">\(""\)/);
  assert.match(side, /<SessionMenu\s+key=\{menu\.t\.id\}/, "the menu keeps one session's open list for the next");
  // S still snoozes for an hour from the row, and the hour's row says so.
  assert.match(side, /else if \(e\.key === "s" \|\| e\.key === "S"\) void act\(t, "snooze", snoozeTimes\(\)\[0\]\.at\);/, "S no longer snoozes for an hour");
  assert.match(menu, /end=\{i === 0 \? "S" : s\.note\}/, "the hour's row lost its S, or the others their clock time at the end");
});

test("Home's project chooser is a small card: the picker's plain find line, six rows before its list scrolls, and two foot rows pinned under a hairline", () => {
  const src = readFileSync(new URL("../../ui/src/app/Projects.tsx", import.meta.url), "utf8");
  const quick = src.slice(src.indexOf("export function ProjectQuickPick("), src.indexOf("export function ProjectChooser("));
  // The find line is the model picker's: FindField in .lc-pk-top, no boxed field of its own.
  assert.match(quick, /<div className="lc-pk-top">\s*<FindField value=\{query\} onChange=\{setQuery\} field=\{find\} label="Find a project" autoFocus \/>/, "the chooser's Find is not the picker's plain line");
  assert.doesNotMatch(quick, /lc-qp-find|"Recent"/, "the chooser still draws a boxed field or a Recent label over a list of recents");
  assert.match(src.slice(src.indexOf("export function ProjectChooser(")), /<div className="lc-pk-top lc-pc-find">/, "the full chooser's Find is a third look");
  // The rows: the app's Row, its path at its end, the tick on the one picked; the foot: two rows, Add a project opening in place.
  assert.match(quick, /<Row key=\{p\.id\} rove keepIcon title=\{p\.name\} which=\{tilde\(p\.path\)\} whichPath on=\{p\.id === value\}/);
  assert.match(quick, /<div className="lc-qp-foot">\s*<Row rove title="Add a project" icon=\{<I\.plus size=\{16\} \/>\} opens="add" onPick=\{\(\) => go\("add"\)\} \/>\s*<Row rove title="Manage projects"/, "the foot isn't Add a project and Manage projects");
  assert.match(quick, /detail: "projects"/, "Manage projects doesn't open Settings › Projects");
  assert.match(quick, /<BackRow name="Add a project" label="Back to your projects"/, "the ways to add a project don't open in place with a way back");
  for (const way of ["title={`A folder on ${os.here}`}", 'title="From GitHub"', "title={`Find on ${os.here}`}"]) assert.ok(quick.includes(way), `${way} is missing from the ways to add a project`);
  assert.match(quick, /bridge\.pickFolder\(\)\.then\(add\)/, "a folder on this Mac no longer opens the folder dialog");
  assert.match(quick, /if \(e\.key === "Escape" && view && !e\.defaultPrevented\) return void \(e\.preventDefault\(\), go\(view === "add" \? "" : "add"\)\)/, "Escape doesn't step back out of a list in place before closing");
  assert.match(quick, /rove\(e, card\.current\)/, "Up and Down don't walk the rows and the foot");
  // The card: never taller than its room, only the list scrolling, six rows in sight.
  const css = sheet("app.css");
  const card = blocks(css, ".lc-qp")[0];
  assert.equal(value(card, "max-height"), "calc(var(--lc-pop-room, calc(100vh - 24px)) - 12px)", "the card runs past the room its Pop was given");
  const list = blocks(css, ".lc-qp-list")[0];
  assert.equal(value(list, "max-height"), "calc(30px * 6 + 2px * 5)", "more than six rows show before the list scrolls");
  assert.equal(value(list, "overflow"), "hidden auto");
  assert.equal(value(list, "min-height"), "0", "the list can't give way to a short room");
  assert.equal(value(blocks(css, ".lc-qp-foot")[0], "border-top"), "1px solid var(--l-line)", "no hairline over the foot rows");
  assert.match(readFileSync(new URL("../../ui/src/app/Home.tsx", import.meta.url), "utf8"), /label=\{`Project: \$\{project\.name\}\. Change it`\}\s*width=\{260\}/, "the chooser isn't 260 wide");
  assert.match(readFileSync(new URL("../../ui/src/app/ui.tsx", import.meta.url), "utf8"), /\.\.\.\(at\.max !== undefined \? \{ "--lc-pop-room"/, "a Pop's room isn't handed to what it holds");
});
