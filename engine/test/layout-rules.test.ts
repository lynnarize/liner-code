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

test("A finding's foot is the panel's own, so its buttons never spill out of a narrow panel", () => {
  // Its words give way with an ellipsis and its buttons keep their size (pane.css), where its own bar once spilled them out.
  assert.equal(blocks(sheet("security/findings.css"), ".lf-x-act-bar").length, 0, "the finding keeps a foot bar of its own");
  const tsx = readFileSync(new URL("../../ui/src/app/security/FindingPanel.tsx", import.meta.url), "utf8");
  assert.match(tsx, /<PaneFoot say=/, "the finding's foot is not the frame's PaneFoot");
  const pane = sheet("pane.css");
  assert.equal(value(blocks(pane, ".lc-pane-say")[0], "min-width"), "0", "the foot's words don't give way to its buttons");
  assert.equal(value(blocks(pane, ".lc-pane-btn")[0], "flex"), "none", "the foot's buttons shrink under their words");
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

test("Every menu has the one lean menu shape's 8px corner and 4px inset, outweighing Liner's own sheet", () => {
  const css = sheet("app.css");
  const panels = blocks(css, ".l-pop.lc-pop-panel");
  assert.ok(css.includes("--lc-r-menu: 8px"), "the menu's corner has no token of its own");
  assert.ok(panels.some((b) => value(b, "border-radius") === "var(--lc-r-menu)" && value(b, "padding") === "4px" && value(b, "gap") === "0"), "no .l-pop.lc-pop-panel block draws the 8px corner with 4px round its touching rows");
  // blocks() only matches whole selectors, so scan every selector that mentions the panel for the old corners too.
  const stale = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].includes("lc-pop-panel") && ["13px", "14px"].includes(value(m[2], "border-radius") ?? ""));
  assert.equal(stale.length, 0, "a block whose selector contains lc-pop-panel still draws 13 or 14px");
  // A rule runs edge to edge, a label is grey, and a foot line sits under a rule.
  assert.ok(blocks(css, ".lc-pop-panel > .lc-sep").some((b) => value(b, "margin") === "4px -4px"), "a menu's rule doesn't run edge to edge");
  assert.ok(blocks(css, ".lc-pop-head").some((b) => value(b, "font-size") === "12px" && value(b, "min-height") === "22px" && value(b, "color") === "var(--l-ink-4)"), "a menu's label isn't 12px and 22 high in the fourth ink");
  assert.ok(blocks(css, ".lc-pop-foot").some((b) => value(b, "border-top") === "0.5px solid var(--lc-line2)" && value(b, "color") === "var(--l-ink-3)"), "a menu's foot line isn't grey under a 0.5px rule edge to edge (line and dot)");
});

test("A menu's rows stand 2px apart in every list of rows", () => {
  const lists: [string, string][] = [
    ["app.css", ".lc-envp"], ["app.css", ".lc-who-scroll"], ["app.css", ".lc-rvm"], ["app.css", ".lc-qp-list"],
    ["crew.css", ".lc-crp"], ["crew.css", ".lc-cr-files"], ["models.css", ".lc-pc-list"],
  ];
  for (const [file, selector] of lists) {
    const bs = blocks(sheet(file), selector);
    assert.equal(bs.length, 1, `${file} should hold one ${selector} block`);
    assert.equal(value(bs[0], "gap") ?? value(bs[0], "row-gap"), "2px", `${selector} in ${file} does not stand its rows 2px apart`);
  }
});

test("Beside the thread the panel is a flush column of the paper: no card, no ring, no inset, one hairline at its left", () => {
  const css = sheet("app.css");
  // The card is gone: nothing gives the open panel a margin, a corner or a ring of its own.
  for (const sel of [".lc-session:not([data-wide]) .lc-body > .lc-panel", ".lc-session:not([data-wide]) .lc-body > .lc-panel:not([data-leaving])"]) {
    for (const b of blocks(css, sel)) {
      assert.equal(value(b, "border-radius"), undefined, `${sel} still rounds the panel into a card`);
      assert.equal(value(b, "--lc-card-top"), undefined, `${sel} still insets the panel as a card`);
      assert.ok(!(value(b, "margin") ?? "").includes("--lc-card-top"), `${sel} still sets the card's margin`);
    }
  }
  assert.ok(blocks(css, ".lc-session[data-beside] .lc-panel").some((b) => value(b, "box-shadow") === "inset 0.5px 0 0 var(--lc-line2)"), "the panel has no 0.5px rule, in the edge's strength, down its left edge");
  assert.ok(blocks(css, ".lc-session .lc-body > .lc-panel").some((b) => value(b, "background") === "var(--lc-paper)" && value(b, "flex-direction") === "column"), "the panel isn't a column on the paper");
  assert.ok(blocks(css, ".lc-session:not([data-wide]) .lc-grip::after").some((b) => value(b, "top") === "0" && value(b, "bottom") === "0"), "the grip's line stops short of the panel's ends, as it did round the card");
  // A surface out of sight lies over the whole panel, now that no strip of tabs stands over them.
  assert.ok(blocks(sheet("surfaces.css"), ".lc-surface[hidden]").some((b) => value(b, "inset") === "0"), "a hidden surface still leaves room for a strip of tabs");
});

test("The panel's column lands on whole pixels, in one pane and in two", () => {
  // Line and dot (board Main): the panel is 500 wide until you drag it, a whole number of pixels already.
  const one = blocks(sheet("app.css"), ".lc-session[data-panel] .lc-body").filter((b) => (value(b, "grid-template-columns") ?? "").includes("--lc-panel-w"));
  assert.equal(one.length, 1, "app.css should hold one column for the panel");
  assert.ok((value(one[0], "grid-template-columns") ?? "").includes("var(--lc-panel-w, 500px)"), "the panel is not 500 wide until it is dragged");
  assert.ok(!(value(one[0], "grid-template-columns") ?? "").includes("36%"), "the panel's default width is a share of the paper again, which can land between pixels");
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

test("The more-files line in Changes' files menu is the menus' grey foot line, and the full canvas's column keeps its own", () => {
  const css = sheet("surfaces.css");
  const base = blocks(css, ".lc-rv-more");
  assert.equal(base.length, 1);
  assert.equal(value(base[0], "padding"), "6px 8px", "the line in the full canvas's files column keeps the padding sized for its list");
  // In the side panel the files are a menu under the head's "N files ⌄" (Review.tsx): its foot is the shared MenuFoot, not rows of its own.
  const review = readFileSync(new URL("../../ui/src/app/Review.tsx", import.meta.url), "utf8");
  assert.ok(/<MenuFoot>\{\[hidden > 0 \? `\$\{plural\(hidden, "test file"\)\} hidden` : "", diff && total > diff\.length \? moreFilesSaid\(/.test(review), "the files menu doesn't say the hidden tests and the files not sent in its foot line");
  assert.equal(blocks(css, ".lc-rv-fm").length, 0, "the files menu still draws rows of its own");
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

test("Over the whole paper, and in a session too narrow for both, the panel lies under the session header, which stays in view with its row of surfaces", () => {
  const css = sheet("app.css");
  const over = (b: string) => value(b, "grid-column") === "1 / -1" && value(b, "margin-top") === "var(--lc-head)" && value(b, "z-index") === "2";
  assert.ok(blocks(css, ".lc-session[data-wide] .lc-body > .lc-panel").some(over), "in the full canvas the panel doesn't lie under the header");
  assert.ok(blocks(css, ".lc-session[data-wide] .lc-body > .lc-thread").some((b) => value(b, "grid-area") === "1 / 1"), "the thread loses its cell, and its header drops under the panel");
  assert.ok(blocks(css, ".lc-session[data-wide] .lc-thread > :not(.lc-top)").some((b) => value(b, "visibility") === "hidden"), "the rest of the thread stays in sight under the panel");
  assert.equal(blocks(css, ".lc-session[data-wide] .lc-thread").filter((b) => value(b, "opacity") === "0").length, 0, "the whole thread, its header too, still goes see-through in the full canvas");
  const narrow = [...css.matchAll(/@container lc-session \(max-width: 786px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
  assert.ok(blocks(narrow, ".lc-session[data-panel]:not([data-wide]) .lc-body > .lc-panel:not([data-leaving])").some(over), "a narrow session's panel doesn't lie under the header");
  assert.ok(blocks(narrow, ".lc-session[data-panel] .lc-body > .lc-thread").some((b) => value(b, "grid-area") === "1 / 1"), "a narrow session's thread loses its cell");
  assert.ok(blocks(narrow, ".lc-session[data-panel] .lc-thread > :not(.lc-top)").some((b) => value(b, "visibility") === "hidden"), "a narrow session's thread stays in sight under the panel");
  // The panel never has a row of its own as the paper's header, so nothing puts one under the Mac's lights.
  assert.ok(!css.includes(".lc-panel-top {\n  --lc-up"), "a rule still puts the panel's own row under the traffic lights");
  assert.ok(!sheet("dock.css").includes(".lc-stabs-lead"), "the sidebar's button still has a place in a panel row");
});

test("A panel that was the whole paper closes as it was, under the header, told by the session's data-left-wide", () => {
  const css = sheet("app.css");
  assert.ok(blocks(css, ".lc-session[data-left-wide] .lc-body > .lc-panel[data-leaving]").some((b) => value(b, "grid-column") === "1 / -1" && value(b, "margin-top") === "var(--lc-head)"), "a closing full-canvas panel jumps into the column beside the thread");
  assert.ok(blocks(css, ".lc-session[data-left-wide] .lc-body > .lc-thread").some((b) => value(b, "grid-area") === "1 / 1"), "the thread loses its cell while the full canvas closes");
  assert.ok(blocks(css, "html[data-bg] .lc-session .lc-body > .lc-panel").some((b) => value(b, "background") === "color-mix(in oklab, var(--lc-paper) 86%, transparent)"), "the panel's own ground over a picture is gone");
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

test("The conversation's text starts where the composer's text does: it takes the whole measure, and the box's 16 of padding meets it", () => {
  // Line and dot (board Main): a 720 column and a 752 box, the box 16 past the column on each side, so neither insets its text twice.
  const tls = blocks(sheet("surfaces.css"), ".lc-scroll-in > .lc-tl");
  assert.equal(tls.length, 1);
  assert.equal(value(tls[0], "padding-inline"), "0", "the timeline insets its text inside the measure again");
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

test("the Found panel's header is a pane's head, not a page's top row", () => {
  const tsx = readFileSync(new URL("../../ui/src/app/security/FoundPanel.tsx", import.meta.url), "utf8");
  assert.equal(tsx.includes("lc-top"), false, "the Found header still carries lc-top, so the traffic-light rule reaches it");
  assert.match(tsx, /<PaneHead\s+name="Found"/, "the Found panel does not draw the frame's head");
  assert.equal(value(blocks(sheet("pane.css"), ".lc-pane-head")[0], "height"), "var(--lc-head)", "a pane's head is not the top row's height");
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

test("a finding's last line ends clear of its foot, with no fade over it", () => {
  const css = sheet("security/findings.css");
  assert.ok(blocks(css, ".lf-x-body").every((b) => !value(b, "mask-image")), "the finding's body still fades its last lines out");
  assert.equal(value(blocks(css, ".lf-x-body > .lc-pane-sec:last-child")[0], "padding-bottom"), "16px", "the last section ends flush on the foot's rule");
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

test("Browser's servers, pages and the rest of the Mac are in the address's list, not rows on a start page", () => {
  const browser = readFileSync(new URL("../../ui/src/app/Browser.tsx", import.meta.url), "utf8");
  const list = browser.slice(browser.indexOf("function AddressList("));
  for (const label of ["<PanelHead end={runningNote(servers)}>Dev servers</PanelHead>", "<PanelHead>Pages in this folder</PanelHead>", "<PanelHead>Elsewhere on {os.here}</PanelHead>", '<MenuFoot>{error ?? "Servers come from .claude/launch.json"}</MenuFoot>']) assert.ok(list.includes(label), `${label} is not in the address's list`);
  assert.equal(blocks(sheet("surfaces.css"), ".lc-br-start-in .lc-br-ports").length, 0, "the start page still draws its own rows of servers");
  assert.ok(!/lc-br-ports|LaunchRows/.test(browser), "the start page or a servers button still lists what the address's list lists");
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
  assert.ok(css.includes("--lc-side: 240px"), "the one declaration is not --lc-side: 240px (Capy's default, 2026-11-26), so a wrong width would pass");
});

test("the corner scale declares its four tokens", () => {
  const css = sheet("app.css");
  // Line and dot (2026-11-27, the orchestrator's ruling on corners): rows 8, fields and menus 10, cards and the sheet 12, the message box and large pop-ups 16.
  for (const t of ["--lc-r-row: 8px", "--lc-r-field: 10px", "--lc-r-card: 12px", "--lc-r-sheet: 16px"]) assert.equal(css.includes(t), true, t + " is not declared");
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


test("the dead [data-panel] closing copy of the panel's look is gone", () => {
  const css = sheet("app.css");
  assert.equal(blocks(css, ".lc-session[data-panel]:not([data-wide]) .lc-body > .lc-panel").length, 0, "the closing copy that asks for [data-panel] is still there: the session has lost that mark by then, so it never matches");
});


test("an add-on's sheet is drawn in the panel's frame, and Remove asks in its ··· as a confirm row that isn't red", () => {
  // The sheet once drew its own head, a dl of facts and a foot with a red Remove (QA D36): now the frame's parts draw it.
  const page = readFileSync(new URL("../../ui/src/app/AddonsPage.tsx", import.meta.url), "utf8");
  const details = page.slice(page.indexOf("function Details("), page.indexOf("type Opened ="));
  for (const part of ["<PaneHead", "<PaneBody", "<PaneSection", "<PaneRow", "<PaneFoot"]) assert.ok(details.includes(part), `the sheet lost ${part}`);
  assert.ok(!/<dl>|<footer>/.test(details), "the sheet still draws its own facts list or foot");
  const confirm = details.match(/<ConfirmRow [^\n]*title="Remove" sure="Remove it"[^\n]*\/>/)?.[0];
  assert.ok(confirm, "Remove is not a confirm row in the sheet's ···");
  assert.ok(!/\b(red|forGood)\b/.test(confirm), "Remove keeps the files, so it should not be red from the start");
  assert.ok(/<PaneButton ink[\s\S]*?>\s*Open it\s*<\/PaneButton>/.test(details), "Open it is not the foot's ink action");
  assert.equal(blocks(sheet("addons-page.css"), ".lc-ao-remove").length, 0, "a rule is left for the old Remove button");
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
  // Show the sidebar is the session header's 32px button (lc-sw-b) in Design's row, as in Code's.
  const after = blocks(sheet("design/design-face.css"), ".ld-bar > .lc-sw-b + .lc-pop > .ld-tt");
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
  // One exception by design (2026-11-26, calmer): a working step in a row of a list is drawn still unless it is `live`, so it is
  // the still variant, not a moving mark put to sleep, and Reduce motion has no say in it either way.
  // Since line and dot the still variant draws no pixels at all (StepMark's "now" ring), and only a live step is the moving box.
  assert.match(readFileSync(new URL("../../ui/src/app/icons.tsx", import.meta.url), "utf8"), /if \(state === "working" && live\) return <StateMark state="working"/, "the still row variant left a live one out");
  for (const file of ["app.css", "surfaces.css", "crew.css", "wall.css", "design.css", "design/design-face.css", "security/scan.css"]) {
    const still = [...sheet(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /\.lc-mk\b/.test(m[1].replace(/:not\([^)]*\)\)?/g, "")) && /animation:\s*none|transition:\s*none/.test(m[2]) && !/nth-child\(5\)/.test(m[1]) && !/\.lc-stepmark\[data-s="working"\]:not\(\.lc-mk-live\)/.test(m[1]));
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
  // In-content buttons and chips are 28 square or high (lc-ib's size): none of the 18 to 26 or 34 they once had. The live picker's rows are the menu's own Row now (28).
  const sized: [string, string, string, string][] = [
    ["design/inspector.css", ".ld-ib", "height", "28px"], ["design/inspector.css", ".ld-stops > button", "height", "28px"], ["design/inspector.css", ".ld-swt", "height", "28px"],
    ["design/design-face.css", ".ld-chip", "height", "28px"], ["design/design-face.css", ".ld-lab-b", "height", "28px"], ["design/build.css", ".ld-live-lk", "height", "28px"],
["pane.css", ".lc-pane-pick", "height", "28px"], ["design.css", ".lc-dz-zoom > button", "height", "28px"],
    ["security/security.css", ".ls-sg", "height", "28px"], ["security/overview.css", ".lo-chev", "height", "28px"],
  ];
  for (const [file, selector, property, want] of sized) {
    const found = blocks(sheet(file), selector).map((b) => value(b, property)).filter(Boolean);
    assert.ok(found.length && found.every((v) => v === want), `${selector} in ${file} is ${found.join(", ") || "unset"}, not ${want}`);
  }
  // One tab look in Security: no page sets its own height or size on the shared tab.
  const findings = sheet("security/findings.css");
  for (const tab of [".lf-tab", ".lf-x-tab"]) assert.ok(blocks(findings, tab).every((b) => !value(b, "height") && !value(b, "font-size")), `${tab} sizes Security's shared tab its own way`);
  // Start a scan's Sign in, Look again and Add are the app's own small buttons (LookAgain, .lc-btn), not a 28px look of its own.
  assert.equal(blocks(sheet("security/scan.css"), ".lsc-pb").length, 0, "Start a scan keeps its own button look");
  assert.match(readFileSync(new URL("../../ui/src/app/security/StartScan.tsx", import.meta.url), "utf8"), /<LookAgain looking=\{looking\}/, "Start a scan's Look again is not the app's one LookAgain");
  // A model's working light, a fact's dot: the server's live dot is words now, so no 7px dot is left in Design's sheets.
  assert.equal(blocks(sheet("design/build.css"), ".ld-bdot").length, 0, "the server's live dot is back in build.css");
  // A finding's code excerpt is code as Files, Changes and Compare show it: 13 on a 22px line.
  const excerpt = blocks(findings, ".lf-x-ev");
  assert.ok(excerpt.some((b) => value(b, "font-size") === "13px" && value(b, "line-height") === "22px"), "a finding's excerpt is not 13px on a 22px line");
});

test("Code's and the shell's buttons, marks and code take the app's sizes, one look each", () => {
  const app = sheet("app.css");
  // Every icon button is 28 since line and dot (a header's was 30, R11), in content and in a header, the sidebar's Hide too.
  assert.ok(blocks(app, ".lc-tb").some((b) => value(b, "height") === "28px" && value(b, "min-width") === "28px"), "the header's button is not 28px");
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
  // Code is 12 on a 20px line in a file view, as in Changes and Compare (line and dot, board Main).
  const surfaces = sheet("surfaces.css");
  assert.ok(blocks(surfaces, ".lc-code-view").some((b) => value(b, "font-size") === "12px" && value(b, "line-height") === "20px"), "Files shows code at another size than Changes");
  assert.ok(blocks(surfaces, ".lc-rv-code").some((b) => value(b, "font-size") === "12px" && value(b, "line-height") === "20px"), "Changes shows code at another size");
  assert.ok(blocks(surfaces, ".lc-cmp-body .l-cdiff__rows").some((b) => value(b, "font-size") === "12px" && value(b, "line-height") === "20px"), "Compare shows code at another size");
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
    // The session row's ··· and right-click menu (SessionMenu, board RowMenu): the snooze times and the groups are choices in the menus two of its rows open to the side; the rest act.
    { file: "Sidebar.tsx", from: "function SessionMenu(", to: "\n}\n", actions: ['"Open beside"', '"Unpin"', 'unreadRow(t).title', '"Settle"', '"Snooze until"', '"Group"', '"Wake it now"', '"New group"', '"Take it out of its group"', '"Rename"', '"Export as Markdown"', '"Stop it"', '"Archive"', '"Bring it back"'] },
    // Several rows picked: the groups are where they go, and taking them out is an action.
    { file: "Sidebar.tsx", from: 'label="Move them to a group"', to: "</Pop>", actions: ['"Take them out of their group"'] },
    // Liner Design's zoom menu, as the zoom buttons elsewhere draw it.
    { file: "design/DesignFace.tsx", from: "<Pop label={`Zoom,", to: "</Pop>", actions: ['"Zoom in"', '"Zoom out"', '"Zoom to fit"', '"Actual size"'] },
    // Run it's arrow: the ways to say yes are choices; the rules page is an action after them.
    { file: "Ask.tsx", from: "function Ways(", to: "\n}\n", actions: ["no longer asks about"] },
  ];
  for (const m of menus) {
    // A row that opens a menu to its side (SubMenu) is a row of the menu too.
    const rows = between(source(m.file), m.from, m.to).split("\n").filter((l) => l.includes("<Row ") || l.includes("<SubMenu "));
    for (const a of m.actions) {
      const lines = rows.filter((l) => l.includes(a));
      assert.ok(lines.length, `${m.file} has no ${a} row in its menu`);
      for (const l of lines) assert.equal((l.match(/icon=\{/g) ?? []).length, (l.match(/<(Row|SubMenu) /g) ?? []).length, `${a} in ${m.file} has no icon`);
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
  // Side by side (board Menus): 37 of rail, 320 of list, 288 of card, 11 apart; narrow, the card goes and the list keeps its width.
  assert.equal(value(one('.lc-pk[data-side="card"]'), "grid-template-columns"), "37px 320px 288px", "the picker's three parts are not 37, 320 and 288 wide");
  assert.equal(value(one('.lc-pk[data-side="line"]'), "grid-template-columns"), "37px 320px", "narrow, the list doesn't keep its width without the card");
  assert.equal(value(one(".lc-pk"), "gap"), "11px", "the picker's parts are not 11 apart");
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
  // As dense as Capy's picker: 28px rows touching, 22px labels, the side card's facts 12px lines 20 apart.
  assert.equal(value(one(".lc-pk-top"), "height"), "32px", "Find is not a 32px row");
  assert.equal(value(one(".lc-pk-head"), "height"), "28px", "the tool's row with its source switch is not 28px");
  assert.equal(value(one(".lc-who-row.lc-pk-row"), "height"), "28px", "a model's row is not 28 high");
  assert.equal(value(one(".lc-pk .lc-who-row"), "min-height"), "28px", "Fusion, Your agents and Older versions are taller than a model's row");
  assert.equal(value(one(".lc-pk-scroll"), "gap"), undefined, "the models' rows have room between them");
  assert.equal(value(one(".lc-pk-models"), "gap"), undefined, "the models' rows have room between them");
  assert.equal(value(one(".lc-pk-lab"), "height"), "22px", "a maker's label is not 22 high");
  assert.equal(value(one(".lc-pk-f"), "height"), "20px", "the side card's facts are not 20px lines");
  assert.equal(value(one(".lc-pk-f"), "font-size"), "12px", "the side card's facts are not 12px");
  assert.equal(value(one(".lc-pk-lvr"), "height"), "24px", "a source's row in the card is not 24 high");
  assert.equal(value(one(".lc-pk-rail"), "width"), "37px", "the rail is not 37 wide");
  assert.equal(value(one(".lc-pk-tool"), "width"), "29px", "a tool's button is not 29 wide");
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
  assert.match(picker, /\{wide && \(\s*<div className="lc-pk-col" data-low=\{low \|\| undefined\}>\s*<section ref=\{card_\} className="lc-pk-card lc-pk-side"/, "the side card isn't drawn only where there is room");
  assert.match(picker, /\{side === "line" && shown && <div className="lc-pk-line">\{shown\.line\}<\/div>\}/, "narrow, the card's words aren't a line at the list's foot");
  // The card turns to a row only after the pointer rests on it, and never while the pointer is over the card.
  assert.match(picker, /settle\(d, performance\.now\(\), overCard\.current\)/, "the side card follows the pointer without the dwell");
  assert.match(picker, /onPointerEnter=\{\(\) => \(\(overCard\.current = true\), window\.clearTimeout\(timer\.current\)\)\}/, "the pointer over the card doesn't hold it");

  // The message box's who chip opens the picker, its card at the side where the window has room.
  const composer = readFileSync(new URL("../../ui/src/app/Composer.tsx", import.meta.url), "utf8");
  const pop = composer.split("\n").find((l) => l.includes("<Pop label={`Who works on this, and how hard"));
  assert.ok(pop, "the who panel's Pop is gone");
  // The chip stands straight after the + (board Main), so the picker hangs from its left edge, the rail before the chip.
  assert.match(pop, /align="start" width=\{pickerWide \? PICKER_WIDE : PICKER_NARROW\} out=\{pickerOut\("start", pickerWide\)\} bare/, "the who chip doesn't open the picker at its own widths, its list over the chip, drawing its own cards");
  assert.match(composer, /<WhoPanel [^>]*side=\{pickerWide \? "card" : "line"\}/, "the who panel doesn't fold its card into a line when narrow");
  const picker_ = readFileSync(new URL("../../ui/src/app/picker.ts", import.meta.url), "utf8");
  assert.match(picker_, /export const PICKER = \{ rail: 37, gap: 11, list: 320, height: 476, side: 288 \} as const;/, "the picker's sizes moved");
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
  assert.match(body, /m\?\.efforts\?\.length \? \{ list: m\.efforts, fallback: m\.defaultEffort(, said)? \} : \{ list: \[\], fallback: undefined(, said)? \}/, "a model's levels are not exactly its own");
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

test("A menu row is one line 28px high, 6px round, with a 14px icon in the muted icon grey, and no menu draws its icons in the accent", () => {
  const css = sheet("app.css");
  const row = blocks(css, ".lc-row");
  assert.equal(row.length, 1, "the menu row has more than one base rule");
  assert.equal(value(row[0], "min-height"), "28px", "a menu row is not 28 high");
  assert.equal(value(row[0], "border-radius"), "6px", "a menu row's corner is not 6px");
  assert.equal(value(row[0], "padding"), "0 8px", "a menu row's padding gives it a second line's height");
  assert.equal(value(row[0], "align-items"), "center", "a menu row's icon and title don't sit on one line");
  assert.equal(value(row[0], "color"), "var(--l-ink)", "a menu row's words are not in ink");
  const tick = blocks(css, ".lc-row-tick");
  assert.equal(tick.length, 1);
  assert.equal(value(tick[0], "color"), "var(--lc-icon)", "a menu row's icon is not in the muted icon grey");
  assert.ok(blocks(css, ".lc-row-tick > svg").some((b) => value(b, "width") === "14px" && value(b, "height") === "14px"), "a menu row's icon is not 14px");
  assert.ok(blocks(css, ".lc-row-end").some((b) => value(b, "font-size") === "13px" && value(b, "color") === "var(--l-ink-4)"), "a row's end is not 13px in the fourth ink");
  assert.ok(blocks(css, ".lc-row[data-bare]").some((b) => value(b, "grid-template-columns") === "minmax(0, 1fr) auto"), "a row with no icon keeps an empty icon column");
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
  const rowSource = ui.slice(ui.indexOf("export function Row("), ui.indexOf("export function SubMenu("));
  assert.match(rowSource, /const shown = keepNote && note;/, "a row shows its note without being asked to");
  assert.match(rowSource, /\{shown && <small>\{note\}<\/small>\}/, "a kept note is not under the title");
  assert.match(rowSource, /title=\{tip\}/, "a note that goes is not the row's tooltip");
  // The picked one's tick is at the end, the icon stays; a › ends a row that opens a list or leads elsewhere.
  assert.match(rowSource, /\{tickEnd && <I\.check size=\{14\} className="lc-row-on" \/>\}/, "the picked row's tick isn't at its end");
  assert.match(rowSource, /\{\(opens \|\| chevron\) && <I\.chevR size=\{14\} \/>\}/, "a row that opens a list has no 14px › at its end");
  // A confirm about to act keeps its note: it says what the press will do.
  assert.match(ui.slice(ui.indexOf("export function ConfirmRow("), ui.indexOf("export const PanelHead")), /keepNote=\{asked\}/, "a confirm's second state hides what it will do");
});

test("The session menu's rows go in the board's order, and its snooze times and groups open to the side", () => {
  const side = readFileSync(new URL("../../ui/src/app/Sidebar.tsx", import.meta.url), "utf8");
  const menu = side.slice(side.indexOf("function SessionMenu("), side.indexOf("\n}\n", side.indexOf("function SessionMenu(")));
  assert.ok(menu.length > 100, "SessionMenu is gone");
  // Board RowMenu: Pin, Mark unread, Settle, Snooze until, Group; a rule; Open beside, Rename, Export as Markdown; a rule; Stop it, Archive. No note shows under any.
  const order = ['"Pin"', "unreadRow(t).title", '"Settle"', '<SubMenu title="Snooze until"', '<SubMenu title="Group"', "<Sep />", '"Open beside"', '"Rename"', '"Export as Markdown"', "<Sep />", '"Stop it"', '<Row title="Archive"'];
  let at = -1;
  for (const o of order) {
    const i = menu.indexOf(o, o === "<Sep />" ? at + 1 : 0);
    assert.ok(i > at, `${o} is not where the menu's order puts it`);
    at = i;
  }
  assert.doesNotMatch(menu, /keepNote/, "a row in the session menu keeps a second line");
  assert.doesNotMatch(menu, /title="Archive"[^\n]*forGood|title="Archive"[^\n]*\bred\b|title="Archive"[^\n]*danger/, "Archive, which can be undone, is red");
  // Stop it is red, and only there while the session works (row-menu.ts stopShows, tested in row-menu.test.ts).
  assert.match(menu, /\{stopShows\(t\) && <Row title="Stop it"[^\n]*\bred\b[^\n]*rpc\("thread\.stop", \{ id: t\.id \}\)/, "Stop it is not the message box's red stop, shown while it works");
  // Group says the group it is in at its end.
  assert.match(menu, /<SubMenu title="Group"[^\n]*value=\{groupValue\(t, groups\)\}/, "Group doesn't say which group it is in");
  // No list opens in the menu's place any more, so no way back row.
  assert.doesNotMatch(menu, /BackRow|setList/, "a list still opens in the menu's place");
  assert.match(side, /<SessionMenu\s+key=\{menu\.t\.id\}/, "the menu keeps one session's state for the next");
  // S still snoozes for an hour from the row, and the hour's row says so before its clock time.
  assert.match(side, /else if \(e\.key === "s" \|\| e\.key === "S"\) void act\(t, "snooze", snoozeTimes\(\)\[0\]\.at\);/, "S no longer snoozes for an hour");
  assert.match(menu, /end=\{i === 0 \? `S  \$\{s\.note\}` : `\$\{day\(s\.at\)\} \$\{s\.note\}`\}/, "the hour's row lost its S, or the others their day and time at the end");
  // Pointing at a row: Pin, Settle, then the ···, with Archive in the menu.
  const row = side.slice(side.indexOf("const acts = t.archived ?"), side.indexOf("return (", side.indexOf("const acts = t.archived ?")));
  const pin = row.indexOf('act(t, "pin")');
  const settle = row.indexOf('act(t, "settle")');
  const more = row.indexOf("menuAt(t");
  assert.ok(pin > 0 && settle > pin && more > settle, "pointing at a row doesn't show Pin, Settle, then the ···");
  assert.doesNotMatch(row, /\.archive\(t\)/, "Archive is still beside the row, not in its menu");
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
  assert.equal(value(blocks(css, ".lc-qp-foot")[0], "border-top"), "0.5px solid var(--l-line)", "no 0.5px hairline over the foot rows");
  assert.match(readFileSync(new URL("../../ui/src/app/Home.tsx", import.meta.url), "utf8"), /label=\{`Project: \$\{project\.name\}\. Change it`\}\s*width=\{260\}/, "the chooser isn't 260 wide");
  assert.match(readFileSync(new URL("../../ui/src/app/ui.tsx", import.meta.url), "utf8"), /\.\.\.\(at\.max !== undefined \? \{ "--lc-pop-room"/, "a Pop's room isn't handed to what it holds");
});

test("The chat's Plan and crew cards have a class of their own, so the message box's card keeps its padding and has no border", () => {
  // The message box is `.lc-card` (app.css). A second `.lc-card` rule in another sheet restyled it: a 1px border and no room round the words.
  for (const file of ["crew.css", "timeline.css", "surfaces.css", "pane.css"]) assert.doesNotMatch(sheet(file), /(^|[\s,>+~])\.lc-card(?![\w-])/m, `${file} styles .lc-card, the message box's own class`);
  assert.match(sheet("crew.css"), /^\.lc-ccard \{/m, "the chat cards have no rule of their own");
  const tsx = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");
  for (const file of ["Crew.tsx", "Timeline.tsx"]) assert.doesNotMatch(tsx(file), /className="lc-card"/, `${file} draws a chat card with the message box's class`);
  assert.match(tsx("Composer.tsx"), /<div className="lc-card">/, "the message box lost its card");
});

test("A finding's tick box stands clear of its row's plate, and takes the severity square's place when a finding is open", () => {
  const css = sheet("security/findings.css");
  const px = (v: string | undefined) => Number.parseFloat(v ?? "NaN");
  const box = px(value(blocks(sheet("pane.css"), ".lc-pane-check")[0], "width"));
  // How far a row's plate reaches into the column's margin (.lf-rw: margin 0 -6px).
  const bleed = -px(value(blocks(css, ".lf-rw")[0], "margin")?.split(/\s+/)[1]);
  const left = px(value(blocks(css, ".lf-li > .lc-pane-check")[0], "left"));
  // With no finding open the column keeps 32px at each side (max-width: calc(100% - 64px)): the box is in it, off the plate.
  assert.ok(left + box <= -bleed - 2, `the box (left ${left}px, ${box}px wide) lies on the row's plate, which starts at ${-bleed}px`);
  assert.ok(-left <= 32, "the box runs out of the column's margin");
  // With a finding open the margin is the title's 20px, less than the box needs beside the plate: it is on the row then.
  assert.equal(value(blocks(css, ".lf[data-panel] .lf-col")[0], "margin"), "0 20px");
  const open = px(value(blocks(css, ".lf[data-panel] .lf-li > .lc-pane-check")[0] ?? "", "left"));
  assert.ok(open >= -bleed, `with a finding open the box (left ${open}px) is cut by the pane's edge or straddles the plate's`);
  const gives = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].includes("[data-panel]") && m[1].includes(".ls-sev i") && value(m[2], "visibility") === "hidden");
  assert.equal(gives.length, 1, "the severity square doesn't give its place to the box");
  // A row that was clicked keeps the focus, which once kept the box showing on the open finding: only the keyboard's focus shows it.
  assert.equal(blocks(css, ".lf-li:focus-within > .lc-pane-check").length, 0, "any focus in a row still shows its box");
  assert.equal(blocks(css, ".lf-li:has(:focus-visible) > .lc-pane-check").length, 1, "the keyboard's focus doesn't show a row's box");
});
