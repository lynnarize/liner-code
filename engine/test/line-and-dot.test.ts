/*
  Line and dot (2026-11-27), the from-zero look the person approved: the foundation every area is drawn on. Each rule
  here is one the person asked for by name or one the orchestrator ruled on, read from the stylesheets and the marks'
  source as written. Run with `node --test engine/test/line-and-dot.test.ts`.
*/
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const src = (file: string) => readFileSync(new URL(`../../ui/src/${file}`, import.meta.url), "utf8");
const sheet = (file: string) => src(`app/${file}`).replace(/\/\*[\s\S]*?\*\//g, "");
// Every block whose selector list holds exactly this selector, in file order: its declarations as text.
const blocks = (css: string, selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")).includes(selector)).map((m) => m[2]);
const value = (block: string, property: string) => block.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`))?.[1].trim();
const has = (css: string, selector: string, property: string, want: string) => blocks(css, selector).some((b) => value(b, property) === want);
const appSheets = () => {
  const root = new URL("../../ui/src/app/", import.meta.url);
  const files: URL[] = [];
  const walk = (d: URL) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = new URL(e.name + (e.isDirectory() ? "/" : ""), d); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".css")) files.push(p); } };
  walk(root);
  return files;
};

test("The ground, the sheet, the inks and the lines take the board's values in the dark and in the light", () => {
  const css = sheet("app.css");
  const dark = blocks(css, '[data-theme="dark"]').find((b) => value(b, "--l-bg"));
  const light = blocks(css, '[data-theme="light"]').find((b) => value(b, "--l-bg"));
  assert.ok(dark && light, "the look's colours are not set on Liner's own tokens for both themes");
  assert.equal(value(dark, "--l-bg"), "#070708", "the dark ground is not near black");
  assert.equal(value(dark, "--l-surface"), "#101012", "the dark sheet is not one step up from the ground");
  assert.equal(value(dark, "--l-line"), "rgba(255, 255, 255, 0.07)");
  assert.equal(value(dark, "--l-line-2"), "rgba(255, 255, 255, 0.115)");
  assert.equal(value(light, "--l-bg"), "#f0f0f1");
  assert.equal(value(light, "--l-surface"), "#ffffff");
  assert.equal(value(light, "--l-line"), "rgba(12, 12, 24, 0.08)");
  assert.equal(value(light, "--l-ink"), "#151518");
  // The default action colour is Liner red, a lighter one in the dark; Appearance's choice still wins (html[data-action]).
  assert.ok(blocks(css, ":root").some((b) => value(b, "--lc-act") === "oklch(0.6 0.215 29)"), "the light action colour is not Liner red");
  assert.ok(blocks(css, '[data-theme="dark"]').some((b) => value(b, "--lc-act") === "oklch(0.66 0.205 31)"), "the dark action colour is not Liner red");
  assert.ok(has(css, 'html[data-action="accent"]', "--lc-act", "var(--l-accent)"), "Appearance's accent choice no longer sets the action colour");
});

test("Everything but the sidebar is one sheet, inset 8 at the top, right and foot and 0 beside the sidebar, at radius 12 with a 0.5px ring and no shadow", () => {
  const css = sheet("app.css");
  assert.ok(has(css, ".lc-app", "--lc-gap", "8px"), "the sheet is not inset 8");
  assert.ok(has(css, ".lc-app", "padding", "var(--lc-gap) var(--lc-gap) var(--lc-gap) 0"), "the sheet is not inset at the top, right and foot only");
  assert.ok(has(css, ".lc-app", "--lc-paper-r", "var(--lc-r-card)"), "the sheet's corner is not the card corner");
  const paper = blocks(css, ".lc-paper");
  assert.ok(paper.some((b) => value(b, "border-radius") === "var(--lc-paper-r)"));
  assert.ok(paper.some((b) => value(b, "box-shadow") === "0 0 0 0.5px var(--lc-line2)"), "the sheet's edge is not one 0.5px ring");
  assert.ok(paper.every((b) => !/0 1px 2px|-?\d+px -?\d+px \d+px/.test(value(b, "box-shadow")?.replace("0 0 0 0.5px", "") ?? "")), "the sheet still casts a shadow");
  assert.equal(blocks(css, 'html[data-native="mac"] .lc-app').length, 0, "the Mac app gives the sheet a corner of its own again");
});

test("The four corner tokens are 8, 10, 12 and 16, and the sheet and cards use them", () => {
  const css = sheet("app.css");
  for (const t of ["--lc-r-row: 8px", "--lc-r-field: 10px", "--lc-r-card: 12px", "--lc-r-sheet: 16px"]) assert.ok(css.includes(t), `${t} is not declared`);
  assert.ok(has(css, ".l-frame-card", "border-radius", "var(--lc-r-card)"));
  assert.ok(has(css, ".lc-btn", "border-radius", "var(--lc-r-row)"), "a button is not at the row corner");
  assert.ok(has(css, ".lc-input", "border-radius", "var(--lc-r-field)"), "a field is not at the field corner");
});

test("Every rule in the shared sheet is 0.5px: no 1px line is drawn in the hair or line colours, and a menu's rule is half a pixel", () => {
  const css = sheet("app.css");
  const thick = css.match(/(?<![0-9.])1px (solid )?var\(--(lc-hair|l-line|l-line-2|lc-line|lc-line2)\)/g) ?? [];
  assert.deepEqual(thick, [], "a 1px rule is left in app.css");
  assert.ok(has(css, ".lc-sep", "height", "0.5px"), "a menu's separator is not 0.5px");
  assert.ok(has(css, ".lc-pop-foot", "border-top", "0.5px solid var(--lc-line2)"), "a menu's foot line is not under a 0.5px rule");
  assert.ok(blocks(css, ":root").some((b) => value(b, "--lc-card-ring") === "0 0 0 0.5px var(--lc-line2)"), "a card's edge is not 0.5px");
});

test("Every state mark is a compact 3x3 box of square pixels: Needs you and every warning all nine in amber, Failed all nine in red, New to you a blue cross", () => {
  const icons = src("app/icons.tsx");
  const mark = icons.slice(icons.indexOf("export function StateMark("), icons.indexOf("export type StepState"));
  assert.equal((mark.match(/<i \/>/g) ?? []).length, 9, "the mark is not nine pixels");
  assert.match(icons, /const MARK_GRID: Record<number, \[number, number\]> = \{ 12: \[2\.5, 1\], 14: \[3, 1\], 16: \[3\.5, 1\], 20: \[4\.5, 1\.5\] \};/, "the box is not compact (pixels a pixel apart)");
  assert.match(mark, /"--mk-box": `\$\{size\}px`/, "the box does not keep its square in its place");
  const css = sheet("app.css");
  assert.ok(has(css, ".lc-mk", "grid-template-columns", "repeat(3, var(--mk-d, 3px))"), "the mark is not three across");
  // Square: a pixel's corner is a fifth of it at most, not the round dot it was.
  const px = blocks(css, ".lc-mk > i").find((b) => value(b, "border-radius"));
  const k = Number(/\* ([\d.]+)\)$/.exec(value(px ?? "", "border-radius") ?? "")?.[1]);
  assert.ok(k > 0 && k <= 0.25, "a pixel is round, not square");
  // All nine lit for needs, limit and problem, in one rule with no :nth-child.
  assert.match(css, /\.lc-mk:is\(\[data-s="needs"\], \[data-s="limit"\], \[data-s="problem"\]\) > i,[^{]*\{\s*opacity: 1;/, "a warning or a failure does not light all nine");
  assert.match(css, /\.lc-mk:is\(\[data-s="needs"\], \[data-s="limit"\]\) \{\s*color: var\(--l-warn\);/, "Needs you is not amber");
  assert.ok(has(css, '.lc-mk[data-s="problem"]', "color", "var(--l-danger)"), "Failed is not red");
  // New to you: the cross (2, 4, 5, 6, 8) lit in the board's blue.
  assert.ok(css.includes('.lc-mk[data-s="fresh"] > i:is(:nth-child(2), :nth-child(4), :nth-child(5), :nth-child(6), :nth-child(8))'), "New to you is not a cross");
  // Done is no box at all, so it can't be read as New to you: the step mark's tick in the ok green (2026-11-27 ruling B3).
  assert.ok(!/\[data-s="done"\][^{]*> i/.test(css), "Done still lights pixels of the box, as New to you does");
  assert.match(icons, /if \(state === "done"\)\s*return \(\s*<span [^>]*data-s="done" data-step="tick" data-tone="ok"[^>]*>\s*<I\.check size=\{size\} \/>/, "Done is not the green tick");
  assert.ok(has(css, '.lc-mk[data-step="tick"][data-tone="ok"]', "color", "var(--l-ok)"), "the done tick is not green");
  assert.ok(has(css, '.lc-mk[data-s="fresh"]', "color", "var(--lc-blue)"), "New to you is not blue");
  assert.ok(blocks(css, '[data-theme="dark"]').some((b) => value(b, "--lc-blue") === "oklch(0.77 0.11 264)"), "the dark blue is not the board's");
});

test("Working lights three of the nine in the working yellow and is the one mark that travels, a place at a time round the outer eight", () => {
  const css = sheet("app.css");
  assert.ok(has(css, '.lc-mk[data-s="working"]', "color", "var(--lc-progress)"));
  const run = blocks(css, '.lc-mk[data-s="working"] > i')[0] ?? "";
  assert.match(value(run, "animation") ?? "", /^lc-mk-run var\(--mk-loop\) step-end infinite$/, "Working does not step round the box");
  const kf = /@keyframes lc-mk-run \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  const lit = [...kf.matchAll(/opacity: ([\d.]+);/g)].map((m) => Number(m[1]));
  assert.equal(lit.filter((o) => o > 0.3).length, 3, "Working does not light three pixels at once (the light and its two-place tail)");
  // The middle never lights, and the eight others each take their turn 150ms apart.
  assert.ok(has(css, '.lc-mk[data-s="working"] > i:nth-child(5)', "animation", "none"));
  for (const [n, d] of [[1, "-1.2s"], [2, "-1.05s"], [3, "-0.9s"], [6, "-0.75s"], [9, "-0.6s"], [8, "-0.45s"], [7, "-0.3s"], [4, "-0.15s"]] as const) assert.ok(has(css, `.lc-mk[data-s="working"] > i:nth-child(${n})`, "animation-delay", d), `pixel ${n} is out of the round`);
  // No other state of the mark loops but the checks' light, which is Working for a pull request's checks.
  const loops = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /\.lc-mk\b/.test(m[1]) && /animation:[^;]*infinite/.test(m[2])).map((m) => m[1].trim());
  assert.deepEqual(loops.sort(), ['.lc-mk[data-s="checks"] > i', '.lc-mk[data-s="working"] > i'], "another state of the mark loops");
});

test("In a plan the step in work is a still mark, a ring with its middle lit: no 3x3 box and nothing that moves", () => {
  const icons = src("app/icons.tsx");
  assert.match(icons, /now: \(p: P\) => <S \{\.\.\.p\}><circle cx="8" cy="8" r="4\.25" \/><circle cx="8" cy="8" r="1\.75" fill="currentColor" stroke="none" \/><\/S>/, "the still step is not a ring with its middle lit");
  const step = icons.slice(icons.indexOf("export function StepMark("));
  assert.match(step, /if \(state === "working" && live\) return <StateMark/, "a step in work that is not the lone sign of work still draws the moving box");
  assert.match(icons, /working: "now"/, "the step in work does not take the still shape");
  // The plan card never asks for the live box.
  const tl = src("app/Timeline.tsx");
  const plan = tl.slice(tl.indexOf("function PlanCard("), tl.indexOf("function PlanCard(") + 4000);
  assert.ok(plan.includes("<StepMark"), "the plan card lost its step marks");
  assert.doesNotMatch(plan, /<StepMark[^>]*\blive\b/, "the plan card's step in work moves");
  assert.doesNotMatch(plan, /<StateMark/, "the plan card draws a 3x3 box");
  const css = sheet("app.css");
  const now = blocks(css, '.lc-mk[data-step="now"]');
  assert.ok(now.length && now.every((b) => !/animation|transition/.test(b)), "the still step moves");
  assert.ok(now.some((b) => value(b, "color") === "var(--l-ink)"), "the still step is not in ink");
});

test("No stylesheet of the app fetches a font or anything else from the network, and the fonts are the three bundled ones", () => {
  for (const f of appSheets()) {
    const css = readFileSync(f, "utf8");
    assert.doesNotMatch(css, /@import|url\(\s*["']?(https?:)?\/\//, `${f.pathname} fetches from the network`);
  }
  const main = src("main.tsx");
  const fonts = [...main.matchAll(/import "(@fontsource[^"]+)"/g)].map((m) => m[1].split("/").slice(0, 2).join("/"));
  assert.deepEqual([...new Set(fonts)].sort(), ["@fontsource-variable/inter", "@fontsource-variable/instrument-sans", "@fontsource/geist-mono"].sort(), "a font other than Inter, Instrument Sans and Geist Mono is loaded");
  assert.ok(main.indexOf('import "./app/halftone.css"') > main.indexOf('import "./app/app.css"'), "the dots' sheet is not loaded after the app's");
});

test("The shell has no backdrop blur: the window, the sidebar, the sheet and every menu are solid", () => {
  const css = sheet("app.css");
  for (const sel of [".lc-app", ".lc-side", ".lc-paper", ".lc-sb", ".lc-sb-blur", ".l-pop.lc-pop-panel"]) {
    for (const b of blocks(css, sel)) assert.ok(!/backdrop-filter:\s*(?!\s|none)/.test(b), `${sel} blurs what is behind it`);
  }
  assert.ok(has(css, ".l-pop.lc-pop-panel", "backdrop-filter", "none"), "a menu does not say it has no blur, so Liner's glass could come back");
  for (const t of ["--l-backdrop", "--l-frame-backdrop"]) assert.ok(blocks(css, ":root").some((b) => value(b, t) === "none"), `${t} is not off`);
  assert.doesNotMatch(sheet("halftone.css"), /backdrop-filter|filter:\s*blur/, "the dots blur");
  assert.match(src("app/look.ts"), /composer: "solid"/, "the message box is glass by default");
});

test("The dots are in one sheet of their own: the halftone, its corner and state colours, the bar of dots and the dither fill of a track", () => {
  const css = sheet("halftone.css");
  for (const sel of [".lc-ht", ".lc-ht-corner", ".lc-ht-down", ".lc-ht-left", ".lc-ht-soft", ".lc-ht-faint", ".lc-ht-blue", ".lc-ht-ok", ".lc-ht-prog", ".lc-ht-warn", ".lc-ht-bad", ".lc-dotbar", ".lc-dither"]) assert.ok(blocks(css, sel).length, `${sel} is missing`);
  // Round dots on a 4px grid in three sizes, in the action colour unless a state says otherwise.
  assert.ok(has(css, ".lc-ht", "--lc-ht-c", "var(--lc-act)"));
  assert.ok(has(css, ".lc-ht", "--lc-ht-s", "4px"));
  assert.ok(blocks(css, ".lc-ht").some((b) => /radial-gradient\(circle/.test(b)), "the halftone's dots are not round");
  // The dither: solid action colour, and eight cells of the 4x4 pattern on a 3px grid, the last a step before the knob.
  assert.ok(has(css, ".lc-dither", "background", "var(--lc-act)"));
  assert.ok(has(css, ".lc-dither > i", "background-size", "12px 12px"));
  assert.ok(has(css, ".lc-dither > i", "right", "12px"), "the dots run on past the knob");
  const cells = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => /circle at ([\d.]+)px ([\d.]+)px/.exec(blocks(css, `.lc-dither > i:nth-child(${n})`)[0] ?? "")?.slice(1).join(","));
  assert.equal(new Set(cells).size, 8, "the dither's eight cells are not eight different places");
  assert.ok(cells.every((c) => c && c.split(",").every((v) => (Number(v) - 1.5) % 3 === 0)), "a dither cell is off the 3px grid");
  // Round dots, in light ink, before the knob only.
  assert.ok(blocks(css, ".lc-dither > i:nth-child(1)").some((b) => /radial-gradient\(circle at/.test(b) && /--lc-dither-ink/.test(b)));
});
