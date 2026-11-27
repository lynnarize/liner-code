/*
  The motion study after Kimi (approved by the owner 2026-11-27, "Yes, build it"): menus and pop-ups close with a motion and
  open out of their button, dialogs fade in and out, icon buttons have the app's own tip, hover cards linger, folds are
  quicker with their content fading, the sidebar and panel take 300 / 240ms at Full with Quick as it was, and Reduce motion
  keeps a 100ms fade. The decisions run from motion.ts; the rest is read from the sources and sheets, since a stylesheet has
  nothing to run. Run with `node --test engine/test/motion-after-kimi.test.ts`.
*/
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ariaKeys, cardAfter, EXIT_SLACK, MOTION, originOf, sameWords, splitTip, stageAfter, tipDelay, tipPlace, type CardStage, type Stage } from "../../ui/src/app/motion.ts";

const src = (path: string) => readFileSync(new URL(`../../ui/src/app/${path}`, import.meta.url), "utf8");
/** A sheet with its comments out, so a rule's words can't pass for the rule. */
const sheet = (path: string) => src(path).replace(/\/\*[\s\S]*?\*\//g, "");
/** Every block whose selector list holds exactly `selector`, in file order. */
const blocks = (css: string, selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(/,(?![^(]*\))/).map((s) => s.trim().replace(/\s+/g, " ")).includes(selector)).map((m) => m[2]);
const value = (block: string, property: string) => block.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`))?.[1].trim().replace(/\s+/g, " ");
const one = (css: string, selector: string, property: string) => blocks(css, selector).map((b) => value(b, property)).filter(Boolean).at(-1);
/** The first value a selector's blocks give, before any Reduce motion block further down overrides it. */
const first = (css: string, selector: string, property: string) => blocks(css, selector).map((b) => value(b, property)).filter(Boolean)[0];
/** A keyframe's body. */
const keyframes = (css: string, name: string) => {
  const at = css.indexOf(`@keyframes ${name} {`);
  assert.ok(at >= 0, `no @keyframes ${name}`);
  return css.slice(at, css.indexOf("}\n}", at) + 3);
};
/** The block of an @media query, as text. */
const media = (css: string, query: string, from = 0) => {
  const at = css.indexOf(`@media ${query} {`, from);
  assert.ok(at >= 0, `no @media ${query}`);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  return css.slice(at);
};
const fn = (code: string, name: string) => code.slice(code.indexOf(`function ${name}(`), code.indexOf("\n}\n", code.indexOf(`function ${name}(`)));
const app = sheet("app.css");
const tokens = blocks(app, ":root").find((b) => value(b, "--lc-menu-in")) ?? "";

/* ---------- The numbers live in one place ---------- */

test("The motion's lengths and curves are tokens in one place in app.css, the same numbers motion.ts uses", () => {
  const want: Record<string, string> = {
    "--lc-ease-out": "cubic-bezier(0, 0, 0.2, 1)",
    "--lc-ease-in": "cubic-bezier(0.4, 0, 1, 1)",
    "--lc-ease-even": "cubic-bezier(0.4, 0, 0.2, 1)",
    "--lc-ease-settle": "cubic-bezier(0.2, 0, 0, 1)",
    "--lc-menu-in": `${MOTION.menuIn}ms`,
    "--lc-menu-out": `${MOTION.menuOut}ms`,
    "--lc-tip-in": `${MOTION.tipIn}ms`,
    "--lc-tip-out": `${MOTION.tipOut}ms`,
    "--lc-sheet-in": `${MOTION.sheetIn}ms`,
    "--lc-sheet-out": `${MOTION.sheetOut}ms`,
    "--lc-card-fade": `${MOTION.cardFade}ms`,
    "--lc-fold": `${MOTION.fold}ms`,
    "--lc-side-open": `${MOTION.sideOpen}ms`,
    "--lc-side-shut": `${MOTION.sideShut}ms`,
    "--lc-reduced": `${MOTION.reduced}ms`,
  };
  for (const [k, v] of Object.entries(want)) {
    assert.equal(value(tokens, k), v, `${k} is not ${v}`);
    assert.equal((app.match(new RegExp(`${k}:`, "g")) ?? []).length, 1, `${k} is set in more than one place`);
  }
  assert.deepEqual(
    { menuIn: MOTION.menuIn, menuOut: MOTION.menuOut, tipWait: MOTION.tipWait, tipSkip: MOTION.tipSkip, tipIn: MOTION.tipIn, tipOut: MOTION.tipOut, sheetIn: MOTION.sheetIn, sheetOut: MOTION.sheetOut, cardWait: MOTION.cardWait, cardLinger: MOTION.cardLinger, cardFade: MOTION.cardFade, fold: MOTION.fold, sideOpen: MOTION.sideOpen, sideShut: MOTION.sideShut, reduced: MOTION.reduced },
    { menuIn: 200, menuOut: 140, tipWait: 500, tipSkip: 300, tipIn: 150, tipOut: 150, sheetIn: 225, sheetOut: 160, cardWait: 250, cardLinger: 120, cardFade: 120, fold: 240, sideOpen: 300, sideShut: 240, reduced: 100 },
  );
});

/* ---------- 1. Menus close with a motion ---------- */

test("A closed menu stays on screen through its exit and is gone after it, and a second open during the exit takes it back", () => {
  const walk = (events: ("open" | "close" | "ended")[]) => events.reduce<Stage[]>((seen, e) => [...seen, stageAfter(seen.at(-1)!, e)], ["shut"]).slice(1);
  assert.deepEqual(walk(["open", "close", "ended"]), ["open", "closing", "shut"], "it does not close through a closing stage");
  // Opened again mid-exit it is open as it is, and the late end of the old exit does nothing to it.
  assert.deepEqual(walk(["open", "close", "open", "ended"]), ["open", "closing", "open", "open"]);
  // A shut part asked to close stays shut: nothing to play.
  assert.equal(stageAfter("shut", "close"), "shut");
  assert.equal(stageAfter("closing", "close"), "closing");
});

test("A menu's exit is ended by a timer when no transition event comes, and its panel renders only while mounted", () => {
  const ui = src("ui.tsx");
  const presence = fn(ui, "usePresence");
  assert.match(presence, /stageAfter\(stage, open \? "open" : "close"\)/);
  // The timer: a little past the exit, whatever the page did (a hidden window, Reduce motion, display none).
  assert.match(presence, /window\.setTimeout\(end, ms \+ EXIT_SLACK\)/, "no timer ends an exit that never fires its event");
  assert.ok(EXIT_SLACK > 0 && EXIT_SLACK <= 100);
  // Its own opacity transition ending ends it, not one of its rows'.
  assert.match(presence, /e\.target === e\.currentTarget/);
  for (const part of ["Pop", "SubMenu"]) {
    const code = fn(ui, part);
    assert.match(code, /usePresence\(open, MOTION\.menuOut\)/, `${part} has no exit`);
    assert.match(code, /\{life\.mounted &&\s*createPortal\(/, `${part} still unmounts the moment it shuts`);
    assert.doesNotMatch(code, /\{open &&\s*createPortal\(/, `${part} still unmounts the moment it shuts`);
  }
  const ctx = fn(ui, "ContextMenu");
  assert.match(ctx, /usePresence\(shown, MOTION\.menuOut\)/);
  assert.match(ctx, /if \(!held\) return null;/, "the context menu still goes the moment it shuts");
  assert.doesNotMatch(ctx, /if \(!at\) return null;/);
});

test("A closing menu takes no presses, is hidden from a screen reader, gives the keyboard back at once and never draws its caller's rows again", () => {
  const ui = src("ui.tsx");
  for (const part of ["Pop", "ContextMenu", "SubMenu"]) {
    const code = fn(ui, part);
    assert.match(code, /data-closing=\{(?:life\.)?closing \|\| undefined\}/, `${part} has no closing state`);
    assert.match(code, /inert=\{(?:life\.)?closing \|\| undefined\}/, `${part} takes presses while it closes`);
    assert.match(code, /aria-hidden=\{(?:life\.)?closing \|\| undefined\}/, `${part} is read while it closes`);
    assert.match(code, /onTransitionEnd=\{life\.onEnd\}/);
    // Its rows are what they were as it closed: the caller is not asked again (a row's menu after the row is gone).
    assert.match(code, /<Held hold=\{(?:life\.)?closing\}>\{(?:life\.)?closing \? null : children\(/, `${part} asks its caller for rows while it closes`);
  }
  // Nested side menus close with the menu they came from.
  assert.match(fn(ui, "SubMenu"), /const outerClosing = useContext\(Closing\);\s*const closing = life\.closing \|\| outerClosing;/);
  // The trigger has the keyboard at once, not when the exit ends.
  assert.match(fn(ui, "Pop"), /if \(life\.closing && panel\.current\?\.contains\(document\.activeElement\)\) btn\.current\?\.focus/);
  // A failure inside a closing panel draws nothing; one while it is open still reaches the app's boundary.
  assert.match(ui, /if \(this\.props\.hold\) return null;\s*throw this\.state\.error;/);
  // CSS: a fade and 96%, 140ms, ease-in, no pointer, and its entrance stopped.
  const closing = blocks(app, '.l-pop.lc-pop-panel.lc-layer[data-ready][data-closing]')[0] ?? "";
  assert.equal(value(closing, "opacity"), "0");
  assert.equal(value(closing, "transform"), "scale(0.96)");
  assert.equal(value(closing, "pointer-events"), "none");
  assert.equal(value(closing, "animation"), "none");
  assert.equal(value(closing, "transition"), "opacity var(--lc-menu-out) var(--lc-ease-in), transform var(--lc-menu-out) var(--lc-ease-in)");
  // Back mid-exit it doesn't replay its entrance from nothing.
  assert.equal(one(app, ".l-pop.lc-pop-panel.lc-layer[data-ready][data-again]", "animation"), "none");
});

/* ---------- 2. Menus open from their button ---------- */

test("A menu grows from its trigger's centre on the edge it hangs from: below, above, left and right", () => {
  const trigger = { left: 100, top: 300, width: 28, height: 28 };
  // Under it: the panel's top edge, at the trigger's centre across.
  assert.deepEqual(originOf("bottom", { left: 90, top: 334, width: 240, height: 200 }, trigger), { x: 24, y: 0 });
  // Over it (flipped up): the panel's bottom edge.
  assert.deepEqual(originOf("top", { left: 90, top: 94, width: 240, height: 200 }, trigger), { x: 24, y: 200 });
  // Opened to its left: the panel's right edge, level with the trigger's middle.
  assert.deepEqual(originOf("left", { left: -160, top: 300, width: 248, height: 120 }, trigger), { x: 248, y: 14 });
  // To its right: the panel's left edge.
  assert.deepEqual(originOf("right", { left: 140, top: 290, width: 250, height: 120 }, trigger), { x: 0, y: 24 });
  // A panel pushed along by the window's edge still grows from its own edge, never from outside it.
  assert.deepEqual(originOf("bottom", { left: 400, top: 334, width: 240, height: 200 }, trigger), { x: 0, y: 0 });
  const ui = src("ui.tsx");
  // Pop, ContextMenu and SubMenu work it out from where the panel was actually put, and set it.
  assert.match(fn(ui, "usePlace"), /originCss\(originOf\(s, \{ left, top, width, height \}, r\)\)/);
  for (const part of ["Pop", "ContextMenu", "SubMenu"]) assert.match(fn(ui, part), /transformOrigin: (?:at|pos\?)\.origin/, `${part} doesn't grow from its trigger`);
});

test("A menu comes in over 200ms, settling, from 4px and 96% with no blur, and a sideways one from the side it opened to", () => {
  assert.equal(one(app, ".l-pop.lc-pop-panel.lc-layer[data-ready]", "animation"), "lc-menu-in var(--lc-menu-in) var(--lc-ease-out) backwards");
  assert.equal(one(app, '.l-pop.lc-pop-panel.lc-layer[data-ready][data-side="top"]', "animation-name"), "lc-menu-up");
  assert.equal(one(app, '.l-pop.lc-pop-panel.lc-layer[data-ready][data-side="left"]', "animation-name"), "lc-menu-left");
  assert.equal(one(app, '.l-pop.lc-pop-panel.lc-layer[data-ready][data-side="right"]', "animation-name"), "lc-menu-right");
  const from: Record<string, string> = { "lc-menu-in": "translateY(-4px) scale(0.96)", "lc-menu-up": "translateY(4px) scale(0.96)", "lc-menu-left": "translateX(4px) scale(0.96)", "lc-menu-right": "translateX(-4px) scale(0.96)" };
  for (const [name, t] of Object.entries(from)) {
    const kf = keyframes(app, name);
    assert.ok(kf.includes(`transform: ${t};`) && kf.includes("opacity: 0;"), `${name} doesn't start from ${t}`);
    assert.doesNotMatch(kf, /blur|filter/, `${name} blurs`);
  }
  // Not before it is placed: an entrance that started off screen would land half played.
  assert.equal(one(app, ".l-pop.lc-layer:not([data-ready])", "animation"), "none");
});

test("A right-clicked menu says the side it was put on, over the pointer or under it, rather than bottom whatever happened", () => {
  const ctx = fn(src("ui.tsx"), "ContextMenu");
  assert.doesNotMatch(ctx, /data-side="bottom"/);
  assert.match(ctx, /data-side=\{pos\?\.side \?\? "bottom"\}/);
  assert.match(ctx, /side: to\.side/, "the side placeMenu chose is not kept");
  assert.match(ctx, /originOf\(to\.side,/, "its origin doesn't follow the side it was put on");
});

/* ---------- 3. Dialogs ---------- */

test("A dialog comes in over 225ms, a fade and 4px and nothing else, and leaves over 160ms with its scrim through a closing state", () => {
  assert.equal(one(app, ".lc-sheet[open] .lc-sheet-frame", "animation"), "lc-sheet-in var(--lc-sheet-in) var(--lc-ease-even) backwards");
  const kin = keyframes(app, "lc-sheet-in");
  assert.ok(kin.includes("transform: translateY(4px);") && !/scale|blur/.test(kin), "the sheet still rises far, grows or blurs");
  assert.equal(one(app, ".lc-sheet::backdrop", "animation"), "lc-fade var(--lc-sheet-in) var(--lc-ease-even)");
  assert.equal(one(app, ".lc-sheet[open][data-closing] .lc-sheet-frame", "animation"), "lc-sheet-out var(--lc-sheet-out) var(--lc-ease-even) forwards");
  assert.equal(one(app, ".lc-sheet[data-closing]::backdrop", "animation"), "lc-fade-out var(--lc-sheet-out) var(--lc-ease-even) forwards");
  assert.equal(one(app, ".lc-sheet[data-closing]", "pointer-events"), "none");
  // Quick no longer shortens the sheet: a dialog moves the same at both levels.
  assert.doesNotMatch(app, /data-motion="quick"\][^{]*\.lc-sheet/);
});

test("A sheet closes through its closing state: Escape, the scrim and its buttons all wait for its fade, then close it", () => {
  const code = src("sheet.ts");
  assert.match(code, /d\.dataset\.closing = "";/);
  assert.match(code, /e\.animationName === "lc-sheet-out" && finish\(true\)/);
  assert.match(code, /window\.setTimeout\(\(\) => finish\(true\), MOTION\.sheetOut \+ EXIT_SLACK\)/, "no timer closes a sheet whose fade never ends");
  // The dialog is closed only once the fade has ended (which gives the focus back), and its caller told after.
  assert.match(code, /delete d\.dataset\.closing;\s*if \(!close\) return;\s*d\.close\(\);\s*then\?\.\(\);/);
  // Opened again on the way out: it stays open.
  assert.match(code, /leaving\.get\(d\)\?\.\(\);\s*if \(!d\.open\) d\.showModal\(\);/);
  // Every sheet in the app leaves through it.
  const agent = src("AgentDialog.tsx");
  assert.match(agent, /if \(!open\) closeSheet\(ref\.current\);/);
  assert.doesNotMatch(agent, /ref\.current\?\.close\(\)/);
  const mcp = src("settings/LinerMcp.tsx");
  assert.match(mcp, /const onClose = \(then\?: \(\) => void\) => closeSheet\(ref\.current, \(\) => \(closed\(\), then\?\.\(\)\)\);/);
  assert.match(mcp, /onCancel=\{\(e\) => \(e\.preventDefault\(\), onClose\(\)\)\}/, "Escape closes the sheet at once");
  const intro = src("design/Intro.tsx");
  assert.match(intro, /closeSheet\(ref\.current, \(\) => setOpen\(false\)\);/);
  assert.doesNotMatch(intro, /ref\.current\?\.close\(\)/);
  // ⌘K takes a dialog's timing.
  const models = sheet("models.css");
  assert.equal(one(models, ".l-root .l-cmd__panel", "animation"), "lc-cmd-in var(--lc-sheet-in) var(--lc-ease-even) both");
  assert.equal(one(models, ".l-root .l-cmd[data-closing] .l-cmd__panel", "animation"), "lc-cmd-out var(--lc-sheet-out) var(--lc-ease-even) both");
});

test("The Settings sheet moves as a dialog does: in over 225ms with 4px, out over 160 with its dim, the keyboard given back as it starts to leave", () => {
  const st = sheet("settings.css");
  assert.equal(first(st, ".lc-st-pop", "animation"), "lc-st-dim var(--lc-sheet-in) var(--lc-ease-even) backwards");
  assert.equal(first(st, ".lc-st-sheet", "animation"), "lc-st-rise var(--lc-sheet-in) var(--lc-ease-even) backwards");
  const rise = keyframes(st, "lc-st-rise");
  assert.ok(rise.includes("transform: translateY(4px);") && !/scale|blur/.test(rise), "Settings still rises 6px and grows");
  assert.equal(one(st, ".lc-st-pop[data-closing]", "animation"), "lc-st-undim var(--lc-sheet-out) var(--lc-ease-even) forwards");
  assert.equal(one(st, ".lc-st-pop[data-closing] .lc-st-sheet", "animation"), "lc-sheet-out var(--lc-sheet-out) var(--lc-ease-even) forwards");
  assert.equal(one(st, ".lc-st-pop[data-closing]", "pointer-events"), "none");
  const settings = src("Settings.tsx");
  assert.match(settings, /data-closing=\{leaving \|\| undefined\}\s*inert=\{leaving \|\| undefined\}/);
  assert.match(settings, /if \(leaving\) giveBack\.current\(\);/, "the keyboard waits for the fade to come back");
  // What had the keyboard is read as the sheet is drawn, before the app under it goes inert and the browser drops the focus to the page.
  assert.match(settings, /const \[was\] = useState\(\(\) => \(document\.activeElement instanceof HTMLElement \? document\.activeElement : null\)\);/, "Settings gives the keyboard back to the page, not to the button that opened it");
  assert.match(src("App.tsx"), /closing=\{settingsLife\.closing\}/);
});

/* ---------- 4. The app's own tips ---------- */

test("A tip waits 500ms, then none while one shows or within 300ms of the last one hiding", () => {
  assert.equal(tipDelay(10_000, -Infinity, false), 500, "the first tip doesn't wait");
  assert.equal(tipDelay(10_000, 9_800, false), 0, "the next within 300ms waits again");
  assert.equal(tipDelay(10_000, 9_701, false), 0);
  assert.equal(tipDelay(10_000, 9_700, false), 500, "past the 300ms window it doesn't wait");
  assert.equal(tipDelay(10_000, -Infinity, true), 0, "moving along while one shows waits");
});

test("A button's title gives the tip its words and its key, and a key in words a screen reader knows", () => {
  assert.deepEqual(splitTip("Show the panel (⇧⌘D)"), { words: "Show the panel", keys: "⇧⌘D" });
  assert.deepEqual(splitTip("Pin (P)"), { words: "Pin", keys: "P" });
  assert.deepEqual(splitTip("Back to the Wall (Esc)"), { words: "Back to the Wall", keys: "Esc" });
  assert.deepEqual(splitTip("Send (⌘Enter)"), { words: "Send", keys: "⌘Enter" });
  assert.deepEqual(splitTip("Show session details (Ctrl+Shift+I)"), { words: "Show session details", keys: "Ctrl+Shift+I" });
  assert.deepEqual(splitTip("A secret (set, not shown)"), { words: "A secret (set, not shown)" }, "words in brackets were taken for a key");
  assert.equal(ariaKeys("⇧⌘D"), "Shift+Meta+D");
  assert.equal(ariaKeys("Ctrl+Shift+I"), "Control+Shift+I");
  assert.equal(ariaKeys("Esc"), "Escape");
  assert.ok(sameWords("Hide the panel", "Hide the panel") && !sameWords("Pull requests: one waits", "Pull requests"));
  // Under its button while there's room, over it at the window's foot; kept inside the window across.
  assert.deepEqual(tipPlace({ left: 100, top: 20, width: 28, height: 28 }, { width: 80, height: 24 }, 1400, 860), { left: 74, top: 54, side: "bottom" });
  assert.equal(tipPlace({ left: 1360, top: 820, width: 28, height: 28 }, { width: 80, height: 24 }, 1400, 860).side, "top");
  assert.equal(tipPlace({ left: 1380, top: 20, width: 28, height: 28 }, { width: 80, height: 24 }, 1400, 860).left, 1312);
});

test("Icon-only buttons draw the app's tip from their title through one part, keep an accessible name, and the tip is never read twice", () => {
  const tips = src("Tips.tsx");
  // One part for the window, mounted beside the toasts in both of App's trees.
  assert.equal((src("App.tsx").match(/<Tips \/>/g) ?? []).length, 2);
  // Only a button that is an icon alone: one with words keeps the system's title.
  assert.match(tips, /const iconOnly = \(b: HTMLElement\) => !\(b\.textContent \?\? ""\)\.trim\(\) && b\.querySelector\("svg, img"\) !== null;/);
  assert.match(tips, /if \(!title\.trim\(\) \|\| !iconOnly\(b\)\) return/);
  // The title moves to data-tip, so the system's tooltip never shows beside the app's.
  assert.match(tips, /b\.removeAttribute\("title"\);\s*b\.dataset\.tip = title;/);
  // Its name: the aria-label it has, or one from its title; words the tip adds become its description, its key aria-keyshortcuts.
  assert.match(tips, /b\.setAttribute\("aria-label", words\)/);
  assert.match(tips, /b\.setAttribute\("aria-description", words\)/);
  assert.match(tips, /b\.setAttribute\("aria-keyshortcuts", ariaKeys\(keys\)\)/);
  // The tip is for the eye: hidden from a screen reader, so nothing is announced twice.
  assert.match(tips, /className="lc-tip" aria-hidden/);
  // Never for a touch; gone on a press, a scroll, Escape and when its button goes.
  assert.match(tips, /if \(e\.pointerType === "touch" \|\| e\.buttons !== 0\) return;/);
  assert.match(tips, /document\.addEventListener\("pointerdown", down, true\)/);
  assert.match(tips, /window\.addEventListener\("scroll", gone/);
  assert.match(tips, /if \(el\.isConnected\) return;/);
  assert.match(tips, /tipDelay\(performance\.now\(\), lastHidden\.current, showing\.current\)/);
  // The buttons named in the study have a title or a tip to give, and an aria-label.
  const switcher = src("Switcher.tsx");
  for (const words of ["Fill the window", "Hide the panel", "Show the panel"]) assert.match(switcher, new RegExp(`aria-label="${words}" title="${words}"|aria-label=\\{[^}]*"${words}"[^}]*\\} title=`), `${words} lost its name or its tip`);
  assert.match(switcher, /triggerAttrs=\{\{ title: "Open a surface" \}\}/);
  assert.match(src("Sidebar.tsx"), /aria-label="Hide the sidebar" title="Hide the sidebar"/);
  assert.match(src("Composer.tsx"), /triggerClass="lc-plus-b" tip="Add files, commands and skills"/);
  assert.match(src("Pane.tsx"), /className="lc-pane-tool l-focus" aria-label=\{label\} title=\{label\}/);
  // Liner's own Tooltip is no longer a second kind of tip in the app.
  assert.doesNotMatch(src("Modes.tsx"), /components\/tooltip/);
});

test("A tip grows from 85% with a fade over 150ms, settling, from the edge facing its button, and goes back over 150ms", () => {
  assert.equal(one(app, ".lc-tip[data-ready]:not([data-again], [data-closing])", "animation"), "lc-tip-in var(--lc-tip-in) var(--lc-ease-out) backwards");
  const kf = keyframes(app, "lc-tip-in");
  assert.ok(kf.includes("transform: scale(0.85);") && kf.includes("opacity: 0;") && !/blur/.test(kf));
  const out = blocks(app, ".lc-tip[data-closing]")[0] ?? "";
  assert.equal(value(out, "transform"), "scale(0.85)");
  assert.equal(value(out, "transition"), "opacity var(--lc-tip-out) var(--lc-ease-in), transform var(--lc-tip-out) var(--lc-ease-in)");
  assert.equal(one(app, ".lc-tip", "pointer-events"), "none");
  assert.equal(one(app, ".lc-tip kbd", "color"), "var(--l-ink-4)", "the key is not in grey");
  assert.match(src("Tips.tsx"), /t\.style\.transformOrigin = originCss\(originOf\(at\.side,/);
});

/* ---------- 5. Hover cards ---------- */

test("A hover card shows after 250ms, waits 120ms when left, fades over 120, and moving to another row swaps it without closing", () => {
  const run = (events: ("enter" | "leave" | "timer")[]) => {
    let s: CardStage = "hidden";
    const seen: { to: CardStage; wait?: number; swap?: boolean }[] = [];
    for (const e of events) {
      const n = cardAfter(s, e);
      seen.push(n);
      s = n.to;
    }
    return seen;
  };
  assert.deepEqual(run(["enter", "timer"]), [{ to: "waiting", wait: 250 }, { to: "shown" }]);
  assert.deepEqual(run(["enter", "timer", "leave", "timer", "timer"]).slice(2), [{ to: "lingering", wait: 120 }, { to: "fading", wait: 120 }, { to: "hidden" }]);
  // Another row reached in the pause, or even in the fade, takes the card over with its words, never closing it.
  assert.deepEqual(run(["enter", "timer", "leave", "enter"]).at(-1), { to: "shown", swap: true });
  assert.deepEqual(run(["enter", "timer", "leave", "timer", "enter"]).at(-1), { to: "shown", swap: true });
  // Left before it showed: nothing.
  assert.deepEqual(run(["enter", "leave"]).at(-1), { to: "hidden" });
  const ui = src("ui.tsx");
  assert.match(fn(ui, "HoverNote"), /cardAfter\(stage\.current, "enter"\)/);
  assert.doesNotMatch(fn(ui, "HoverNote"), /450/, "a hover note still waits 450ms");
  const side = src("Sidebar.tsx");
  assert.match(side, /cardTimer\.current = window\.setTimeout\(show, MOTION\.cardWait\);/);
  assert.match(side, /leaveTimer\.current = window\.setTimeout\(fadeCard, MOTION\.cardLinger\);/);
  assert.match(side, /leaveTimer\.current = window\.setTimeout\(\(\) => setCard\(null\), MOTION\.cardFade\);/);
  assert.doesNotMatch(side, /setTimeout\(show, 450\)/);
  for (const sel of [".lc-sbc[data-closing]", ".lc-hnote[data-closing]"]) {
    const b = blocks(app, sel)[0] ?? "";
    assert.equal(value(b, "opacity"), "0", `${sel} doesn't fade`);
    assert.match(value(b, "transition") ?? "", /opacity var\(--lc-card-fade\) var\(--lc-ease-in\)/, `${sel} doesn't fade over 120ms`);
  }
});

/* ---------- 6. Folds ---------- */

test("A fold opens and shuts over 240ms on the settling curve, its content fading in over 160ms from 60ms in and out over 120", () => {
  assert.equal(first(app, ".lc-fold", "transition"), "grid-template-rows var(--lc-fold) var(--lc-ease-settle)");
  const inner = blocks(app, ".lc-fold > div").find((b) => value(b, "opacity")) ?? "";
  assert.equal(value(inner, "opacity"), "0");
  assert.equal(value(inner, "transition"), "opacity var(--lc-fold-hide) ease");
  const open = blocks(app, "[data-open] > .lc-fold > div").find((b) => value(b, "opacity")) ?? "";
  assert.equal(value(open, "opacity"), "1");
  assert.equal(value(open, "transition"), "opacity var(--lc-fold-show) ease var(--lc-fold-show-after)");
  assert.equal(value(tokens, "--lc-fold-show"), "160ms");
  assert.equal(value(tokens, "--lc-fold-show-after"), "60ms");
  assert.equal(value(tokens, "--lc-fold-hide"), "120ms");
  assert.doesNotMatch(app, /grid-template-rows 420ms/, "a fold still takes 420ms on a spring");
  // "Worked for" opens as a fold too, its steps kept while it shuts over them, where they once came and went in one frame.
  const summary = fn(src("Timeline.tsx"), "Summary");
  assert.match(summary, /const steps = usePresence\(open, MOTION\.fold\);/);
  assert.match(summary, /<div className="lc-fold">\s*<div>\{steps\.mounted && has && <StepList /);
  assert.doesNotMatch(summary, /\{open && has && <StepList/);
});

/* ---------- 7. Sidebar and panel ---------- */

test("With Full the sidebar and panel open over 300ms and shut over 240 on the settling curve, and Quick keeps its 180ms", () => {
  assert.equal(first(app, ".lc-app", "transition"), "grid-template-columns var(--lc-side-shut) var(--lc-ease-settle)");
  assert.equal(one(app, ".lc-app[data-sidebar]", "transition-duration"), "var(--lc-side-open)");
  assert.equal(first(app, ".lc-body", "transition"), "grid-template-columns var(--lc-side-shut) var(--lc-ease-settle), grid-template-rows var(--lc-side-shut) var(--lc-ease-settle)");
  assert.equal(one(app, ".lc-session[data-panel] .lc-body", "transition-duration"), "var(--lc-side-open)");
  // The sidebar's content slides 8px left and fades over 180ms as it shuts, at Full only.
  assert.equal(one(app, 'html:not([data-motion="quick"]) .lc-side > .lc-sb', "transition"), "opacity var(--lc-side-fade) ease, transform var(--lc-side-fade) ease");
  const shut = blocks(app, 'html:not([data-motion="quick"]) .lc-app:not([data-sidebar]) .lc-side > .lc-sb')[0] ?? "";
  assert.equal(value(shut, "opacity"), "0");
  assert.equal(value(shut, "transform"), "translateX(-8px)");
  // The panel's content fades, 240ms after 60ms in, 180ms out, and never slides.
  assert.equal(first(app, ".lc-panel", "animation"), "lc-panel-in var(--lc-panel-show) var(--lc-ease-out) var(--lc-panel-show-after) backwards");
  assert.equal(one(app, ".lc-panel[data-leaving]", "animation"), "lc-panel-out var(--lc-panel-hide) var(--l-ease-out) forwards");
  assert.doesNotMatch(keyframes(app, "lc-panel-in") + keyframes(app, "lc-panel-out"), /transform|translate/, "the panel slides");
  // Quick as it was: widths 180ms on Liner's smooth spring, the panel 180 in with no wait and 220 out, the sidebar fading whole 320 / 260.
  const quick = blocks(app, 'html[data-motion="quick"] .lc-app')[0] ?? "";
  assert.equal(value(quick, "transition-duration"), "180ms");
  assert.equal(value(quick, "transition-timing-function"), "var(--l-spring-smooth)");
  assert.equal(one(app, 'html[data-motion="quick"] .lc-panel:not([data-leaving])', "animation-duration"), "180ms");
  assert.equal(one(app, 'html[data-motion="quick"] .lc-panel:not([data-leaving])', "animation-delay"), "0ms");
  assert.equal(one(app, 'html[data-motion="quick"] .lc-panel[data-leaving]', "animation-duration"), "220ms");
  assert.equal(one(app, 'html[data-motion="quick"] .lc-side', "transition"), "opacity 320ms var(--l-ease-out)");
  assert.equal(one(app, 'html[data-motion="quick"] .lc-app:not([data-sidebar]) .lc-side', "transition-duration"), "260ms");
  assert.doesNotMatch(app, /grid-template-columns 520ms/, "the sidebar still takes 520ms at Full");
});

/* ---------- 8. Reduce motion ---------- */

test("Under Reduce motion pop-ups, menus, tips, hover cards, dialogs and the scrim keep a plain 100ms fade, and nothing else moves", () => {
  const raw = src("app.css");
  const block = media(raw, "(prefers-reduced-motion: reduce)", raw.indexOf("Reduce motion: what still fades"));
  const css = block.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const part of [".lc-pop-panel", ".lc-tip", ".lc-sbc", ".lc-hnote", ".lc-sheet-frame", ".lc-sheet::backdrop", ".lc-st-pop", ".lc-st-sheet"]) assert.ok(css.includes(part), `${part} has no reduced fade`);
  assert.match(css, /animation-name: lc-fade !important;\s*animation-duration: var\(--lc-reduced\) !important;\s*animation-timing-function: linear !important;/);
  assert.match(css, /transform: none !important;\s*transition-property: opacity !important;\s*transition-duration: var\(--lc-reduced\) !important;/);
  // Each selector outranks foundation.css's blanket 1ms (.l-scope *:not([data-timer]), which loads after this sheet).
  for (const sel of css.match(/^\s*\.l-root\.l-scope [^{,]+/gm) ?? []) assert.ok(sel.trim().startsWith(".l-root.l-scope ."), sel);
  assert.ok(keyframes(raw, "lc-fade").includes("opacity: 0;") && !/transform|scale|blur/.test(keyframes(raw, "lc-fade")));
  // Widths and folds change at once.
  const old = sheet("app.css").match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.lc-app,\s*\.lc-body,[\s\S]*?transition: none !important;/)?.[0] ?? "";
  for (const sel of [".lc-app", ".lc-body", ".lc-fold", ".lc-fold > div"]) assert.ok(old.includes(sel), `${sel} still moves under Reduce motion`);
});

/* ---------- Across all of it ---------- */

test("No new motion rule blurs, and Liner's library is untouched", () => {
  const raw = src("app.css");
  const added = [
    ...[".l-pop.lc-pop-panel.lc-layer[data-ready]", ".l-pop.lc-pop-panel.lc-layer[data-ready][data-closing]", ".lc-tip", ".lc-tip[data-closing]", ".lc-sheet[data-closing]", ".lc-sbc[data-closing]", ".lc-hnote[data-closing]", ".lc-fold > div", 'html:not([data-motion="quick"]) .lc-side > .lc-sb'].flatMap((s) => blocks(app, s)),
    ...["lc-menu-in", "lc-menu-up", "lc-menu-left", "lc-menu-right", "lc-tip-in", "lc-sheet-in", "lc-sheet-out", "lc-fade-out"].map((k) => keyframes(raw, k)),
    media(raw, "(prefers-reduced-motion: reduce)", raw.indexOf("Reduce motion: what still fades")),
  ];
  for (const b of added) assert.doesNotMatch(b, /backdrop-filter|filter:\s*blur/, `a new rule blurs: ${b.slice(0, 80)}`);
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const diff = execFileSync("git", ["diff", "--stat", "--", "ui/src/liner"], { cwd: root, encoding: "utf8" });
  assert.equal(diff.trim(), "", "ui/src/liner was edited; change it upstream and sync");
});
