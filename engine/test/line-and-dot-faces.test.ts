/*
  Line and dot in Liner Design and Liner Security (2026-11-27): the rules of the approved boards that these two faces
  keep, read from their stylesheets and components as written. Run with `node --test engine/test/line-and-dot-faces.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const read = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");
const sheet = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, "");
const blocks = (css: string, selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")).includes(selector)).map((m) => m[2]);
const value = (block: string, property: string) => block.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`))?.[1].trim();
const faceSheets = () => ["design.css", "face.css", ...readdirSync(new URL("../../ui/src/app/design/", import.meta.url)).filter((f) => f.endsWith(".css")).map((f) => `design/${f}`), ...readdirSync(new URL("../../ui/src/app/security/", import.meta.url)).filter((f) => f.endsWith(".css")).map((f) => `security/${f}`)];

test("Nothing in either face blurs what is behind it, and nothing blurs as it comes in", () => {
  for (const file of faceSheets()) {
    const css = sheet(file);
    // Any backdrop-filter at all, however its value is written: a variable (var(--l-backdrop)) can carry a blur too.
    assert.doesNotMatch(css, /backdrop-filter\s*:\s*(?!none\s*[;}])/, `${file} still sets a backdrop filter`);
    // Keyframes that fade a thing in through a blur (the Design surface's picture, the inspector, the intro) are fades now.
    for (const k of css.matchAll(/@keyframes[^{]+\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)) assert.doesNotMatch(k[1], /filter:\s*blur\(/, `${file} has keyframes that blur`);
  }
  assert.doesNotMatch(sheet("design.css"), /l-blur-in/, "the Design surface's picture still comes in through a blur");
});

test("Every rule and ring in the two faces is half a pixel, where two things meet", () => {
  for (const file of faceSheets()) {
    const css = sheet(file);
    const thick = [...css.matchAll(/(?<![\d.])1px solid var\(--(?:lc-hair|l-line|l-line-2|ls-line|lc-line|lc-line2)\b|\b0 0 0 1px var\(--(?:lc-hair|l-line|l-line-2|ls-line|lc-line|lc-line2)\b/g)];
    assert.equal(thick.length, 0, `${file} draws ${thick.length} 1px hairline(s): ${thick.map((m) => m[0]).join(", ")}`);
  }
});

test("Security says how bad in the board's colours: High red, Medium amber, Low grey, each as a tag on its own tint", () => {
  const css = sheet("security/security.css");
  const tokens = blocks(css, "[data-theme]")[0];
  assert.equal(value(tokens, "--ls-sv-h"), "var(--l-danger)", "High is not the red");
  assert.equal(value(tokens, "--ls-sv-m"), "var(--l-warn)", "Medium is not the amber");
  assert.equal(value(tokens, "--ls-sv-l"), "var(--l-ink-5)", "Low is not grey");
  const tag = blocks(css, ".ls-sev")[0];
  assert.equal(value(tag, "width"), "58px", "the tag is not the list's fixed 58px column");
  assert.equal(value(tag, "height"), "20px");
  // (Its selector has commas inside :is(), so it is matched whole rather than through blocks().)
  assert.match(css, /\.ls-sev:is\(\[data-sev="critical"\], \[data-sev="high"\], \[data-sev="medium"\]\) \{\s*background: color-mix\(in oklab, var\(--ls-sv\) 15%, transparent\);\s*color: var\(--ls-sv\);/, "a severity's tag is not its colour on its own tint");
  // A split's key is round dots, and the split itself carries no numbers: they are in the key.
  assert.equal(value(blocks(css, ".ls-leg i")[0], "border-radius"), "50%", "the keys under a split are not round dots");
  assert.equal(value(blocks(css, ".ls-parts")[0], "height"), "10px", "a split is not the board's thin bar");
  assert.doesNotMatch(read("security/parts.tsx"), /\{p\.value\}\s*<\/i>/, "a split's part still prints its count inside it");
});

test("The Overview is boxes on a three-column grid, with the red halftone in the open count's corner and the dither as a running scan's progress", () => {
  const css = sheet("security/overview.css");
  assert.equal(value(blocks(css, ".lo-grid")[0], "grid-template-columns"), "repeat(3, minmax(0, 1fr))");
  const tsx = read("security/Overview.tsx");
  assert.match(tsx, /o\.open > 0 && <i className="lc-ht lc-ht-corner lc-ht-bad/, "the open count's box has no red halftone while anything is open");
  assert.match(tsx, /<span className="lc-ht lc-ht-fill lc-ht-prog"/, "a running scan's progress is not the dither of dots");
  // The free checks' rows say how each stands with the marks: a tick, the amber box, a ring.
  assert.match(tsx, /state="needs"/);
  assert.match(tsx, /<StepMark state="done"/);
  assert.match(tsx, /<StepMark state="waiting"/);
  assert.equal(value(blocks(css, ".lo-big")[0], "font"), "600 60px/0.9 var(--lc-font-name)", "the open count is not the large number in Instrument Sans");
});

test("A finding open beside the list is 540 wide at most, its title in Instrument Sans, its lead in a tinted block with the halftone", () => {
  const css = sheet("security/findings.css");
  assert.match(value(blocks(css, ".lf-x")[0], "width") ?? "", /540px\)$/);
  assert.equal(value(blocks(css, ".lf-x-h2")[0], "font-family"), "var(--lc-font-name)");
  assert.match(read("security/FindingPanel.tsx"), /<div className="lf-x-leadbox" data-sev=\{f\.severity\}>\s*<i className="lc-ht lc-ht-corner/, "the lead sentence is not in its block with the halftone");
  assert.ok(blocks(css, ".lf-x-leadbox").some((b) => /color-mix\(in oklab, var\(--lf-sv\) 9%/.test(value(b, "background") ?? "")), "the lead's block is not tinted by how bad it is");
});

test("Design's canvas is the ground with a grid of dots, the picked layer is blue with its name, and the lead draws in the accent, the sidekick in blue", () => {
  const face = sheet("face.css");
  assert.equal(value(blocks(face, ":root")[0], "--ld-cv"), "var(--lc-ground)");
  assert.equal(value(blocks(face, ":root")[0], "--ld-lead"), "var(--lc-act)");
  assert.equal(value(blocks(face, ":root")[0], "--ld-side"), "var(--lc-blue)");
  const css = sheet("design/design-face.css");
  assert.match(value(blocks(css, ".ld-cv-hit")[0], "background-image") ?? "", /radial-gradient\(circle, var\(--lc-line2\)/, "the canvas has no grid of dots");
  assert.match(read("design/Canvas.tsx"), /"--ld-gx" as string\]: `\$\{pan\.x\}px`/, "the dots do not ride with the pan");
  assert.match(value(blocks(css, ".ld-sel")[0], "box-shadow") ?? "", /var\(--lc-blue\)/, "the picked layer is not outlined in blue");
  assert.equal(value(blocks(css, ".ld-sel[data-n]::before")[0], "content"), "attr(data-n)", "the picked layer has no name tag");
  assert.match(value(blocks(css, ".ld-frame")[0], "box-shadow") ?? "", /^0 0 0 0\.5px var\(--lc-line2\)/, "a frame's edge is not 0.5px");
});

test("Design's tools are a segmented control in the top row, and the inspector's tabs are chips", () => {
  const face = read("design/DesignFace.tsx");
  const row = face.slice(face.indexOf("function TopRow("), face.indexOf("/** Under an empty canvas"));
  assert.ok(row.includes("<RailPart />"), "the tools are not in the top row");
  const main = face.slice(face.indexOf('<div className="ld-cv">'), face.indexOf("<EmptyHint />"));
  assert.ok(!main.includes("<RailPart />"), "the tools still float on the canvas too");
  const css = sheet("design/design-face.css");
  assert.equal(value(blocks(css, ".ld-rail")[0], "background"), "var(--l-wash)", "the tools are not on a washed track");
  assert.ok(!value(blocks(css, ".ld-rail")[0], "position"), "the tools are still laid over the canvas");
  const insp = sheet("design/inspector.css");
  assert.equal(value(blocks(insp, '.ld-itab[aria-selected="true"]')[0], "background"), "var(--l-wash-2)", "the inspector's tab that shows is not a chip");
  assert.equal(value(blocks(insp, ".ld-swt")[0], "border-radius"), "50%", "the lean's colours are not round swatches");
});

test("The inspector's Asked for box keeps its Send inside the panel, and a switch that is on is the accent in Design too", () => {
  // The box once took 100% on top of the section's 16px insets, which pushed Send past the panel's right edge.
  assert.equal(value(blocks(sheet("design/ways.css"), ".ld-pic-ask")[0], "width"), "auto", "the Asked for box is wider than its column");
  // No sheet of the face draws an on switch in ink: it is the shared switch's accent (app.css, --lc-act).
  for (const file of faceSheets()) {
    for (const m of sheet(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\.l-switch\[data-on\]/.test(m[1])) assert.doesNotMatch(m[2], /background:\s*var\(--l-ink\)/, `${file}: ${m[1].trim()} draws an on switch in ink`);
    }
  }
});

test("Design's top row says where you are as Code's does, then Compare outlined and Build as the one white button", () => {
  const face = read("design/DesignFace.tsx");
  const row = face.slice(face.indexOf("function TopRow("), face.indexOf("/** Under an empty canvas"));
  assert.match(row, /<span className="lc-crumb ld-crumb" aria-hidden>\s*<span className="lc-crumb-tile">\{tileOf\(project\.name\)\}<\/span>\s*<span className="lc-crumb-pj">\{project\.name\}<\/span>\s*<span className="lc-crumb-sl">\/<\/span>/, "the row has no project tile, name and slash before the design's name");
  assert.ok(row.indexOf("lc-crumb ld-crumb") < row.indexOf("<TabTitle />"), "the crumb is not before the design's name");
  assert.ok(row.includes("<TopBuild "), "Compare and Build are not in the row");
  const build = read("design/BuildTab.tsx");
  const top = build.slice(build.indexOf("export function TopBuild("), build.indexOf("// The foot is the inspector's slot"));
  assert.match(top, /className="lc-btn ld-top-cmp l-focus"\s+data-kind="outline"/, "Compare is not the outlined chip");
  assert.match(top, /className="lc-btn ld-top-build l-focus" data-kind="ink"/, "Build is not the white ink button");
  // Build opens the inspector's Build tab, whose foot has the one action that sends: nothing goes to the agent from two places.
  assert.match(top, /showInspectorTab\("build"\)/);
  assert.doesNotMatch(top, /askAgent\(/, "the top row's Build sends to the agent itself, beside the foot's");
  assert.match(read("design/Inspector.tsx"), /addEventListener\("ld:insp-tab"/, "the inspector doesn't hear the top row's Build");
  // No hairline under the row.
  const bar = blocks(sheet("design/design-face.css"), ".ld-bar")[0];
  assert.ok(!value(bar, "border-bottom") && !value(bar, "box-shadow"), "Design's top row has a rule under it");
});

test("While a design is drawn the small chat's live line is a pill, with no clip round its working mark", () => {
  const css = sheet("design/chat.css");
  const pill = blocks(css, '.ld-dock[data-chat="min"] .lc-ll.ldc-live')[0];
  assert.equal(value(pill, "border-radius"), "999px", "the live line is not the round chip shape");
  assert.equal(value(pill, "width"), "fit-content");
  assert.ok(!value(pill, "overflow"), "the pill clips the working mark with its rounded edge");
});

test("Design's sidebar rows are the Code sidebar's place rows, the lean is a row with its title, and a loaded skill has a switch", () => {
  const css = sheet("design/design-face.css");
  const row = blocks(css, ".ld-tr")[0];
  assert.equal(value(row, "height"), "28px");
  assert.equal(value(row, "border-radius"), "var(--lc-r-row)");
  assert.equal(value(row, "padding"), "0 9px");
  assert.equal(value(blocks(css, ".ld-ly")[0], "border-radius"), "var(--lc-r-row)");
  assert.match(read("design/Layers.tsx"), /className="ld-tr ld-lean l-focus"/, "the lean is still a card of its own");
  const skills = read("design/Skills.tsx");
  assert.match(skills, /<NamedSwitch name=\{`\/\$\{n\}, loaded for this design`\}/, "a loaded skill has no switch");
  assert.match(skills, /more \$\{rest === 1 \? "skill" : "skills"\}/, "the rest of the skills are not counted as 'N more skills'");
});

test("A session's row in the Design and Security sidebars is the shared compact row, whose actions take the mark's and the time's place", () => {
  for (const file of ["design/Tabs.tsx", "design/DesignHome.tsx", "security/Side.tsx"]) {
    const tsx = read(file);
    for (const m of tsx.matchAll(/<SideRow\b[\s\S]*?\/>/g)) if (/acts=/.test(m[0])) assert.match(m[0], /\bcompact\b/, `${file} has a row with actions that is not the compact row`);
  }
  // The shared row hides its mark and time while its actions show (app.css, the sidebar builder's), so they never sit on them.
  assert.match(sheet("app.css"), /\.lc-sl-row\[data-compact\]:is\(:hover, :focus-within\):has\(> \.lc-sl-acts\)[^{]*\{[^}]*\}|\.lc-sl-row\[data-compact\]:is\(:hover, :focus-within\):has\(> \.lc-sl-acts\), [^{]*\) :is\(\.lc-sl-mark, \.lc-sl-ago\) \{\s*display: none;/, "the shared row no longer makes room for its actions");
  // None of the two faces' sheets brings a row's mark back while its actions show.
  for (const file of faceSheets()) assert.doesNotMatch(sheet(file), /\.lc-sl-acts[^{]*\.lc-sl-(mark|ago)/, `${file} styles a row's mark against its actions`);
});

test("The faces' other pages keep the look: Design's Lean page and a scan's question sit in their frames, and the Found panel and Projects are drawn as the Finding board", () => {
  assert.equal(value(blocks(sheet("design/lean-page.css"), ".ld-lp")[0], "border-radius"), "var(--lc-paper-r, 12px)", "the Lean page's square corners show past the sheet's round ones");
  const scan = sheet("security/scan.css");
  // With no mark at the ask's head (the owner's ruling), the question and its answers start at the card's own 14 inset.
  assert.equal(value(blocks(scan, ".lsc-ask > .lc-dask-h")[0], "padding"), "2px 14px 6px", "the scan's question runs to the card's edge");
  assert.equal(value(blocks(scan, ".lsc-ask-opts")[0], "margin"), "0 10px 6px 6px", "the answers' keys don't line up with the question");
  assert.equal(value(blocks(scan, ".lsc-found")[0], "border-left"), "0.5px solid var(--lc-line2)");
  const ov = sheet("security/overview.css");
  assert.equal(value(blocks(ov, ".lo-ptile")[0], "background"), "var(--lc-card)", "a project's open tiles are not cards");
  assert.equal(value(blocks(ov, ".lo-dots i")[0], "border-radius"), "50%", "an area's severity keys are not round");
});

test("A picked layer's name tag never lies on its frame's own label: at the frame's top it goes inside the layer's top edge", async () => {
  const { tagInside } = await import("../../ui/src/app/design/tag-place.ts");
  // The frame's label row is its top at -22 to -4 above the frame; above the layer the tag runs from -16.5 to -1.5 above the layer's top.
  for (const zoom of [0.19, 0.43, 1, 2]) {
    for (const y of [0, 4, 10, 20, 40, 120]) {
      const lands = y * zoom - 1.5 - 15 < -4; // reaches into the frame's label row
      assert.equal(tagInside(y, zoom), lands, `a layer ${y}px down at ${zoom * 100}%: the tag ${lands ? "would cover" : "clears"} the frame's label`);
    }
  }
  assert.equal(tagInside(0, 0.43), true, "a layer at the frame's very top keeps its tag above, on the frame's label");
  assert.equal(tagInside(200, 1), false, "a layer well inside the frame has its tag moved in for nothing");
  assert.match(read("design/Canvas.tsx"), /data-in=\{\(one && x\.node && r && tagInside\(r\.y, zoom\)\) \|\| undefined\}/, "the selection doesn't say when its tag goes inside");
  const css = sheet("design/design-face.css");
  const inside = blocks(css, ".ld-sel[data-n][data-in]::before")[0];
  assert.equal(value(inside, "top"), "0", "the tag isn't drawn inside the layer's top edge");
  assert.equal(value(inside, "bottom"), "auto");
});

test("A scan you stopped rests as a finished one with the word Stopped; only a scan that failed is red", () => {
  const side = read("security/Side.tsx");
  assert.match(side, /: s\.state === "failed" \? "error" : "done";/, "a stopped scan still takes the error state in the sidebar");
  assert.doesNotMatch(side, /s\.state === "stopped" \|\| s\.state === "failed" \? "error"/);
  assert.match(side, /s\.state === "stopped" \? "Stopped"/, "a stopped scan's mark doesn't say Stopped");
  assert.match(read("security/Side.tsx"), /const scanEnd = \(s: ScanRecord\) => \(s\.state === "stopped" \? "Stopped"/, "a stopped scan's second line doesn't say Stopped");
  assert.match(read("security/Projects.tsx"), /s\.state === "stopped" \? "skipped" : s\.state === "failed" \? "failed"/, "a stopped scan in Projects still draws the red cross");
});

test("With a finding open, its own row keeps its severity tag: the tick box shows there only while picking or for the keyboard", () => {
  const css = sheet("security/findings.css");
  const kept = blocks(css, ".lf[data-panel]:not([data-picking]) .lf-li:has(> .lf-rw[data-on]):not(:has(:focus-visible)) > .lc-pane-check")[0];
  assert.equal(value(kept, "opacity"), "0", "pointing at the open finding's row still shows its tick box");
  assert.match(css, /\.lf\[data-panel\] \.lf-li:hover:not\(:has\(> \.lf-rw\[data-on\]\)\) \.ls-sev[,{\s]/, "pointing at the open finding's row still hides its tag");
  assert.doesNotMatch(css, /\.lf\[data-panel\] \.lf-li:hover \.ls-sev\b/, "a rule hides every row's tag on hover, the open one's too");
});
