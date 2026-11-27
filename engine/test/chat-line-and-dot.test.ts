/*
  Line and dot in the chat (2026-11-27, boards Main and Light): your message, the agent's words, the folded line, the
  changed files, the Plan card, hand-overs and the asks, read from the chat's stylesheets and source as written. The Plan
  card is the owner's ruling: nothing in it moves and the step in work is the still ring. Run with
  `node --test engine/test/chat-line-and-dot.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const src = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");
const sheet = (file: string) => src(file).replace(/\/\*[\s\S]*?\*\//g, "");
// Every block whose selector list holds exactly this selector, in file order: its declarations as text.
const blocks = (css: string, selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")).includes(selector)).map((m) => m[2]);
const value = (block: string, property: string) => block.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`))?.[1].trim();
const one = (css: string, selector: string, property: string) => blocks(css, selector).map((b) => value(b, property)).filter(Boolean).at(-1);
const fn = (code: string, name: string) => code.slice(code.indexOf(`function ${name}(`), code.indexOf("\n}\n", code.indexOf(`function ${name}(`)));

test("Nothing in the Plan card moves: the step in work is the still ring, never the box, and its halftone is still", () => {
  const plan = fn(src("Timeline.tsx"), "PlanCard");
  assert.ok(plan.includes('<StepMark size={14} state={shown(e.status)}'), "the plan's rows lost their step marks");
  assert.doesNotMatch(plan, /\blive\b(?!\s*=\s*false)/, "a step in the plan asks for the moving mark");
  assert.doesNotMatch(plan, /<StateMark/, "the plan draws a 3x3 box");
  // The halftone only while a step is in work in a run that hasn't ended, behind the head's top right corner.
  assert.match(plan, /const alive = !end && it\.entries\.some\(\(e\) => e\.status === "in_progress"\);/);
  assert.match(plan, /\{alive && <i className="lc-ht lc-ht-corner lc-ht-soft lc-ccard-ht" aria-hidden \/>\}/);
  // No rule of the card, its rows or its halftone animates or transitions.
  const crew = sheet("crew.css");
  const card = [...crew.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /\.lc-(?:ccard|cards)\b/.test(m[1]) && !/:hover|lc-ccard-(?:rb|more|act|name)/.test(m[1]));
  assert.ok(card.length > 5, "the plan card's rules are gone");
  for (const m of card) assert.doesNotMatch(m[2], /animation|transition/, `${m[1].trim()} moves`);
  assert.doesNotMatch(sheet("halftone.css"), /animation|transition/, "the halftone moves");
});

test("The Plan card is a bordered card: the card fill, a 0.5px edge at the card corner, a 36px head and 30px rows under a hairline", () => {
  const crew = sheet("crew.css");
  assert.equal(one(crew, ".lc-ccard", "border-radius"), "var(--lc-r-card)");
  assert.equal(one(crew, ".lc-ccard", "background"), "var(--lc-card)");
  assert.equal(one(crew, ".lc-ccard", "box-shadow"), "var(--lc-card-ring)");
  assert.equal(one(crew, ".lc-ccard-h", "height"), "36px");
  assert.equal(one(crew, ".lc-ccard-r", "min-height"), "30px");
  assert.equal(one(crew, ".lc-ccard-r", "border-top"), "0.5px solid var(--lc-hair)");
  // Done in grey, the step in work in ink.
  assert.match(blocks(crew, '.lc-ccard-r[data-s="done"] .lc-ccard-t').join(""), /color: var\(--l-ink-3\)/);
  assert.match(blocks(crew, '.lc-ccard-r[data-s="working"] .lc-ccard-t').join(""), /color: var\(--l-ink\)/);
});

test("Your message is a bubble on the right in the card's fill with a 0.5px edge and its corner small where it points at you, at most 84% wide", () => {
  const css = sheet("app.css");
  assert.equal(one(css, ".lc-you p", "max-width"), "84%");
  assert.equal(one(css, ".lc-you p", "background"), "var(--lc-well)");
  assert.equal(one(css, ".lc-you p", "box-shadow"), "inset 0 0 0 0.5px var(--lc-hair)");
  assert.equal(one(css, ".lc-you p", "border-radius"), "var(--lc-r-card) var(--lc-r-card) 4px var(--lc-r-card)");
  assert.equal(one(css, ".lc-you p", "line-height"), "21px");
});

test("The chat keeps the board's measure and type at every width: a 720 column, a box 32 wider (752), answers 14/22 and your message 14/21", () => {
  const css = sheet("app.css");
  assert.equal(value(blocks(css, ".lc-thread > *")[0], "--lc-measure"), "720px", "the chat column is not the board's 720");
  // Wider, the column may grow, from 720; the type does not go a size up.
  const wide = css.slice(css.indexOf("@container lc-thread (min-width: 1120px)"), css.indexOf("\n}\n", css.indexOf("@container lc-thread (min-width: 1120px)")));
  assert.match(wide, /--lc-measure: clamp\(720px, 58cqi, 840px\);/);
  assert.doesNotMatch(wide, /font-size|line-height/, "a wide session sets the answers or your message a size up");
  assert.equal(one(css, ".lc-compose", "max-width"), "calc(var(--lc-measure) + 32px + 28px)", "the box isn't 32 wider than the column inside the foot's 14 a side");
  // Liner's .l-md (15/1.65) loads after app.css: in the thread the pair of classes holds the board's 14/22.
  assert.equal(one(css, ".lc-thread .l-md.lc-md", "font-size"), "14px");
  assert.equal(one(css, ".lc-thread .l-md.lc-md", "line-height"), "22px");
  assert.equal(one(css, ".lc-thread .l-md.lc-md code", "font"), "500 12px/1.4 var(--l-font-mono)");
  assert.equal(one(css, ".lc-you p", "font-size"), "14px");
});

test("The agent's inline code is a small Geist Mono chip, a file's name a blue chip, and a code block has a 0.5px edge and a 32px head", () => {
  const css = sheet("app.css");
  assert.equal(one(css, ".lc-md code", "font"), "500 12px/1.4 var(--l-font-mono)");
  assert.equal(one(css, ".lc-md .l-md-link[data-file] > code", "color"), "var(--lc-blue)");
  assert.match(blocks(css, ".lc-md .l-md-link[data-file] > code::before").join(""), /mask: url\("data:image\/svg\+xml/, "the file chip has no file icon");
  assert.equal(one(css, ".lc-md .l-md-code", "box-shadow"), "inset 0 0 0 0.5px var(--lc-line2)");
  assert.equal(one(css, ".lc-md .l-md-code-bar", "height"), "32px");
});

test("A finished stretch of work folds to one line with a hairline under it, and what was done as small tags at its end", () => {
  const tl = src("Timeline.tsx");
  const sum = fn(tl, "Summary");
  assert.match(sum, /const tags = didTags\(tools, sent\);/, "the folded line doesn't say what was done");
  assert.match(sum, /className="lc-trail-tag"/);
  assert.match(fn(tl, "didTags"), /`Read \$\{plural\(files\(reads\), "file"\)\}`/);
  assert.match(fn(tl, "didTags"), /`Edited \$\{files\(edits\)\}`/);
  const css = sheet("surfaces.css");
  assert.equal(one(css, ".lc-trail", "border-bottom"), "0.5px solid var(--lc-hair)");
  assert.equal(one(css, ".lc-trail-tag", "border-radius"), "5px");
});

test("Changed files are one bordered card: a head with the count, the lines and Review, then a row a file with its letter, its folder in grey and five bars", () => {
  const foot = fn(src("Timeline.tsx"), "TurnFoot");
  assert.match(foot, /<b>\{plural\(cp\.files\.length, "file"\)\} changed<\/b>/);
  assert.match(foot, /data-size="sm" onClick=\{\(\) => onReview\(all \? "all" : cp\.id\)\}>\s*Review/, "the card has no Review button");
  assert.match(foot, /className="lc-ledger-badge" data-s=\{f\.status\}/);
  assert.match(foot, /<span className="lc-ledger-dir">/);
  assert.match(foot, /\[0, 1, 2, 3, 4\]\.map/, "the five bars are gone");
  const css = sheet("timeline.css");
  assert.equal(one(css, ".lc-ledger", "box-shadow"), "var(--lc-card-ring)");
  assert.equal(one(css, ".lc-ledger", "border-radius"), "var(--lc-r-card)");
  assert.equal(one(css, ".lc-ledger-r", "border-top"), "0.5px solid var(--lc-hair)");
  assert.equal(one(css, ".lc-ledger-sq > i", "width"), "5px");
  // Nothing else draws the old ruled lines over the card.
  assert.equal(blocks(sheet("app.css"), ".lc-ledger").length, 0, "app.css still rules the changed files above and below");
});

test("A hand-over and a switch to another tool are one centred grey line between two hairlines", () => {
  const crew = sheet("crew.css");
  const app = sheet("app.css");
  for (const [css, sel] of [[crew, ".lc-hand-h::before"], [app, ".lc-switched-h::before"]] as const) {
    assert.equal(one(css, sel, "height"), "0.5px", `${sel} isn't a hairline`);
    assert.equal(one(css, sel, "background"), "var(--lc-line2)");
  }
  assert.equal(one(crew, ".lc-hand-h", "font-size"), "12px");
  assert.equal(one(app, ".lc-switched-h", "font-size"), "12px");
});

test("The ask on the message box is drawn as the board's: an amber edge, the amber halftone, the white button first and Say something else at the end", () => {
  const ask = src("Ask.tsx");
  const dock = fn(ask, "AskDock");
  assert.match(dock, /lc-ht lc-ht-corner lc-ht-soft lc-dask-ht \$\{high \? "lc-ht-bad" : "lc-ht-warn"\}/);
  assert.match(dock, /Say something else/);
  // In the choosing row the white button (Run it, or the hold) comes before Not this.
  const acts = dock.slice(dock.lastIndexOf('<div className="lc-dask-acts">'));
  assert.ok(acts.indexOf("lc-dask-split") < acts.indexOf("Not this") && acts.indexOf("HoldToConfirm") < acts.indexOf("Not this"), "the white button isn't first");
  assert.ok(acts.indexOf("Not this") < acts.indexOf("{say}"), "Say something else isn't at the end");
  const css = sheet("surfaces.css");
  assert.equal(one(css, ".lc-dask", "border-radius"), "var(--lc-r-sheet)");
  assert.match(one(css, ".lc-dask", "box-shadow") ?? "", /^0 0 0 0\.5px color-mix\(in oklab, var\(--l-warn\) 45%, var\(--lc-line2\)\)/);
  assert.equal(one(css, ".lc-dask-ghost", "box-shadow"), "inset 0 0 0 0.5px var(--lc-line2)", "the other answers aren't outlined");
  // Every kind of ask in the chat takes the same shape: questions, the plan's go-ahead and app asks.
  const tl = src("Timeline.tsx");
  assert.match(fn(tl, "QuestionCard"), /lc-ht-warn lc-ask-ht/);
  assert.match(fn(tl, "Proposal"), /it\.state === "asking" && <i className="lc-ht lc-ht-corner lc-ht-soft lc-ht-warn lc-ask-ht"/);
  assert.match(src("AppAsk.tsx"), /lc-ht-warn lc-appask-ht/);
});

test("No ask card's head carries a state mark, and what the card holds starts at its own 14px inset, with the waiting said in words", () => {
  // The owner circled the amber mark before "Demo asks to run a command" and wrote "remove this": the edge and the halftone say it waits.
  const heads = [
    ["Ask.tsx", fn(src("Ask.tsx"), "AskDock")],
    ["security/Questions.tsx", src("security/Questions.tsx")],
  ] as const;
  for (const [file, code] of heads) {
    const top = code.slice(code.indexOf('<div className="lc-dask-top">'), code.indexOf("</div>", code.indexOf('<div className="lc-dask-top">')));
    assert.ok(top.length > 0, `${file} lost its ask head`);
    assert.doesNotMatch(top, /<(?:StateMark|StepMark|SideMark)\b/, `${file} draws a state mark at the ask's head`);
    assert.match(top, /<span className="l-sr-only">Waiting for you: <\/span>/, `${file}'s head no longer says it waits`);
  }
  for (const [file, re] of [["QuestionCard", /lc-q-top[\s\S]{0,400}?<(?:StateMark|StepMark)\b/], ["Proposal", /lc-plan-top[\s\S]{0,400}?<(?:StateMark|StepMark)\b/]] as const) assert.doesNotMatch(fn(src("Timeline.tsx"), file), re, `${file} draws a state mark at its head`);
  assert.doesNotMatch(src("AppAsk.tsx"), /<(?:StateMark|StepMark)\b/, "an app's ask draws a state mark");
  const css = sheet("surfaces.css");
  assert.equal(one(css, ".lc-dask-top", "padding"), "12px 14px 4px");
  assert.equal(one(css, ".lc-dask-body", "padding"), "0 14px 10px", "the ask's body still stands in past a mark");
  assert.equal(one(css, ".lc-dask-acts", "padding"), "0 10px 10px 14px", "the ask's buttons still stand in past a mark");
});

test("The chat's own sheets have no 1px hairline and nothing in them comes in with a blur", () => {
  for (const file of ["timeline.css", "app-ask.css", "precheck.css"]) {
    const css = sheet(file);
    assert.doesNotMatch(css, /1px solid var\(--(?:lc-hair|l-line|l-line-2|lc-line2)\)/, `${file} has a 1px rule`);
    assert.doesNotMatch(css, /inset 0 0 0 1px var\(--(?:lc-hair|l-line|l-line-2|lc-line2|l-line-strong)\)/, `${file} has a 1px ring`);
    assert.doesNotMatch(css, /l-unblur|backdrop-filter/, `${file} blurs`);
  }
});
