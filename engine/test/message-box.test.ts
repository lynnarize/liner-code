/*
  The message box and its menus in the line-and-dot look (boards Main, Home, Details and Menus, 2026-11-27): the box's
  shape, its row of controls, Send and Stop, the line under it in a session, the access menu and ⌘K. The UI has no DOM
  runner here, so each is read from the source as written (precedent: picker-faults.test.ts). The owner's rulings on the
  who chip, Enable Fusion and the Effort track are pinned in picker-faults.test.ts.
  Run with `node --test engine/test/message-box.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const sheet = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, "");
const blocks = (css: string, selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")).includes(selector)).map((m) => m[2]);
const value = (block: string, property: string) => block.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`))?.[1].trim();
const one = (css: string, selector: string) => {
  const b = blocks(css, selector);
  assert.equal(b.length, 1, `one ${selector} block expected, found ${b.length}`);
  return b[0];
};

test("The box is the sheet's corner on the card fill with a 0.5px edge and the soft lift, and stands on the paper untinted on Home", () => {
  const css = sheet("app.css");
  const card = one(css, ".lc-card");
  assert.equal(value(card, "border-radius"), "var(--lc-r-sheet)", "the box isn't the sheet's 16 corner");
  assert.equal(value(card, "background"), "var(--lc-field)");
  assert.equal(value(card, "box-shadow"), "var(--lc-raise)", "the box has no edge and lift");
  assert.match(sheet("app.css"), /--lc-raise: 0 0 0 0\.5px var\(--lc-line2\)/, "the lift has no 0.5px edge");
  assert.equal(blocks(css, '.lc-tray[data-variant="home"]').length, 0, "Home's box sits in a tinted tray again");
  // The placeholder at 14 in grey.
  assert.equal(value(one(css, ".lc-field"), "font-size"), "14px");
  assert.equal(value(one(css, ".lc-field::placeholder"), "color"), "var(--l-ink-3)");
  // 752 at most in a session: 16 past the chat's measure on each side, inside the foot's 14 a side, nothing round it.
  assert.equal(value(one(css, ".lc-compose"), "max-width"), "calc(var(--lc-measure) + 32px + 28px)", "the box isn't 32 wider than the chat column");
});

test("Nothing holds the box: the tab rests on its top edge 12 in from its sides, 32 high with round top corners, and steps aside for a docked ask", () => {
  // Board Details: .dock-in holds the tab, the box and the line under it, with nothing wrapping them (round 3, the owner).
  const css = sheet("app.css");
  const tray = one(css, ".lc-tray");
  assert.equal(value(tray, "padding"), undefined, "a holder wraps the box again");
  assert.equal(value(tray, "background"), undefined, "a holder is tinted round the box again");
  assert.doesNotMatch(css, /\.lc-tray:has\(> \.lc-tray-head > \*\)/, "the tray is still drawn as a holder while it carries a row");
  assert.doesNotMatch(css, /calc\(var\(--lc-r-sheet\) \+ 4px\)/, "the holder's corner round the box is back");
  const tab = one(css, ".lc-tray-head");
  assert.equal(value(tab, "margin"), "0 12px", "the tab isn't 12 in from the box's sides");
  assert.equal(value(tab, "border-radius"), "10px 10px 0 0", "the tab isn't round at its top corners only");
  assert.equal(value(tab, "box-shadow"), "inset 0 0 0 0.5px var(--lc-hair)");
  assert.match(value(tab, "background") ?? "", /^color-mix\(in oklab, var\(--lc-well\) 55%, transparent\)$/);
  assert.equal(value(one(css, ".lc-tray-head > * + *"), "border-top"), "0.5px solid var(--lc-hair)", "several rows aren't parted by a rule");
  const row = one(css, ".lc-trow");
  assert.equal(value(row, "height"), "32px");
  assert.equal(value(row, "padding"), "0 6px 0 12px");
  assert.equal(value(row, "font-size"), "12.5px");
  // A docked ask has the place alone: the rows step aside and the ask stands over the box at its width.
  const composer = code("Composer.tsx");
  assert.match(composer, /<div className="lc-tray-head" data-ask=\{ask \? "" : undefined\}>/, "the tab doesn't know an ask is docked");
  assert.equal(value(one(css, ".lc-tray-head[data-ask]:not(.ld-dock *) > .lc-trow"), "display"), "none", "the commit row stays while an ask is docked");
  assert.equal(value(one(css, ".lc-tray-head[data-ask]"), "margin"), "0 0 8px");
  // What the commit would say is shown only when the app holds it: nothing here asks a model for it.
  assert.doesNotMatch(composer, /git\.message/, "the box asks a model for the commit message");
  const session = code("Session.tsx");
  const toCommit = session.slice(session.indexOf("function ToCommit("), session.indexOf("\n}\n", session.indexOf("function ToCommit(")));
  assert.ok(toCommit.length > 0, "the commit row is gone");
  assert.doesNotMatch(toCommit, /git\.message|rpc\(/, "the commit row asks a model (or anything that costs) for its message");
});

test("The box's controls are 28 high, the chips end in a small chevron, and there is no microphone", () => {
  const css = sheet("app.css");
  assert.equal(value(one(css, ".lc-card-row"), "min-height"), "28px");
  assert.equal(value(blocks(css, ".lc-seg-b")[0], "height"), "28px", "the who and access chips aren't 28 high");
  assert.equal(value(blocks(css, ".lc-plus-b").at(-1) ?? "", "height"), "28px", "the + isn't 28 square");
  const composer = code("Composer.tsx");
  assert.ok((composer.match(/<I\.chevD size=\{12\} className="lc-chip-cv" \/>/g) ?? []).length >= 3, "the who and access chips have no chevron");
  assert.doesNotMatch(composer, /\bmic\b|[Dd]ictat/, "a microphone was added though the app has no dictation");
  // Queue and Steer, the +, the usage ring and Send all stay.
  for (const part of ['aria-label="Mid-turn delivery"', 'triggerClass="lc-plus-b"', "<UsageRing model={model} />", "const sendButton = <SendButton"]) assert.ok(composer.includes(part), `the box lost ${part}`);
});

test("The box's row runs as drawn: the +, the who chip, the access chip, then the gap, then what Enter does, the usage ring and Send", () => {
  const composer = code("Composer.tsx");
  const row = composer.slice(composer.indexOf('<div className="lc-card-row" ref={tray}>'), composer.indexOf("<input ref={clip}"));
  const order = ["{plus}", 'triggerClass="lc-seg-b lc-who"', "{accessPick}", '<span className="lc-grow" />', "{steerNote}", "{!under && <UsageRing model={model} />}", "{sendButton}"];
  let at = -1;
  for (const o of order) {
    const i = row.indexOf(o);
    assert.ok(i > at, `${o} is not where board Main puts it in the row`);
    at = i;
  }
  assert.match(row, /align="start"[^\n]*out=\{pickerOut\("start", pickerWide\)\}/, "the picker still hangs from the chip's right edge");
  // One Fusion mark everywhere: the icon set's is the chip's two strokes, the second in the accent.
  assert.match(read("icons.tsx"), /fusion: \(p: P\) => <S \{\.\.\.p\} w=\{2\}><path d="M3\.45 13\.05 7\.05 2\.95" \/><path d="M8\.95 13\.05 12\.55 2\.95" stroke="var\(--lc-act\)" \/><\/S>,/, "I.fusion is not the two-stroke mark");
});

test("Send is 30 square at the field corner in the accent, lit from its top edge, and Stop is a white square on the same accent", () => {
  const css = sheet("app.css");
  const send = blocks(css, ".lc-send").filter((b) => value(b, "border-radius")).at(-1) ?? "";
  assert.equal(value(send, "border-radius"), "var(--lc-r-field)", "Send isn't at the field corner");
  assert.equal(value(send, "background"), "var(--lc-act)", "Send isn't the accent, or turns another red before there's something to send");
  assert.match(value(send, "box-shadow") ?? "", /^inset 0 0\.5px 0 rgb\(255 255 255 \/ 0\.4\)/, "Send isn't lit from its top edge");
  const stop = one(css, ".lc-send[data-stop]");
  assert.equal(value(stop, "background"), undefined, "Stop is drawn on a wash instead of the accent");
  assert.equal(value(stop, "color"), "var(--lc-act-ink)", "Stop's square isn't white on the accent");
  const base = blocks(css, ".lc-send").find((b) => value(b, "width")) ?? "";
  assert.equal(value(base, "width"), "30px", "Send is no longer 30 square");
  assert.equal(value(base, "height"), "30px");
});

test("A session's box has one grey line under it: where it runs, the agents at work with a green dot, and the context as a ring and its share", () => {
  const composer = code("Composer.tsx");
  const under = composer.slice(composer.indexOf("const under = "), composer.indexOf("const ready = Boolean(text"));
  assert.match(under, /variant === "session" && thread && !canvas && !aside/, "the line shows in the side chat or Liner Design's dock, or on Home");
  assert.match(under, /thread\.worktree \? thread\.worktree\.branch : os\.Here/, "the line doesn't say where it runs");
  assert.match(under, /\{working > 0 && \(/, "the agents' count shows with none at work");
  assert.match(under, /<i className="lc-under-dot" aria-hidden \/>/, "no green dot while agents work");
  assert.match(under, /\{ctxPct\}% of context/, "the context isn't said as a share");
  assert.match(under, /<UsageRing model=\{model\} \/>/, "the plan's usage ring is lost from a session's box");
  assert.match(composer, /\{!under && <UsageRing model=\{model\} \/>\}/, "the usage ring shows twice in a session");
  assert.match(composer, /<\/div>\s*\{under\}\s*<\/div>\s*\);\s*\}/, "the line isn't under the tray");
  const css = sheet("app.css");
  assert.equal(value(one(css, ".lc-under"), "font-size"), "12px");
  assert.equal(value(one(css, ".lc-under"), "color"), "var(--l-ink-3)");
  assert.equal(value(one(css, ".lc-under-dot"), "background"), "var(--l-ok)");
  assert.equal(value(one(css, ".lc-under-dot"), "border-radius"), "50%");
  assert.match(value(one(css, ".lc-under-ring"), "background") ?? "", /^conic-gradient\(var\(--l-ink-2\) var\(--lc-v, 0%\)/);
});

test("The access menu shows each level as an icon tile, its name and one grey line, a tick on the chosen one, and a grey foot line", () => {
  const composer = code("Composer.tsx");
  const rows = composer.slice(composer.indexOf("export function PermissionRows("));
  assert.match(rows, /<span className="lc-perm-tile" aria-hidden>/, "a level has no icon tile");
  assert.match(rows, /\{value === l\.id && <I\.check size=\{14\} \/>\}/, "the chosen level has no tick");
  assert.match(rows, /<MenuFoot>\{`1 to \$\{levels\.length\} picks a level while this is open`\}<\/MenuFoot>/, "no foot line");
  // The number keys still pick a level.
  assert.match(rows, /const l = levels\[Number\(e\.key\) - 1\];/, "the number keys no longer pick a level");
  const css = sheet("app.css");
  assert.equal(value(one(css, ".lc-perm-tile"), "width"), "24px");
  assert.equal(value(one(css, ".lc-perm-tile"), "background"), "var(--l-wash-2)");
  assert.equal(blocks(css, ".lc-perm-k").length, 0, "the old per-row number is left with nothing using it");
});

test("Search and commands is the menu's fill at the card corner with no blur, a 44px field, rows 38 high at the field corner, and a grey foot line", () => {
  const css = sheet("models.css");
  const panel = one(css, ".l-root .l-cmd__panel");
  assert.equal(value(panel, "border-radius"), "var(--lc-r-card)");
  assert.equal(value(panel, "background"), "var(--lc-float)");
  assert.equal(value(panel, "backdrop-filter"), "none", "the palette blurs what is behind it");
  assert.equal(value(one(css, ".l-root .l-cmd::backdrop"), "backdrop-filter"), "none", "the page behind the palette is blurred");
  assert.doesNotMatch(css, /@keyframes lc-cmd-in \{[^}]*filter/, "the palette blurs on its way in");
  assert.equal(value(one(css, ".l-root .l-cmd__field"), "height"), "44px");
  const item = one(css, ".l-root .l-cmd__item");
  assert.equal(value(item, "min-height"), "38px");
  assert.equal(value(item, "border-radius"), "var(--lc-r-field)");
  assert.equal(value(one(css, ".l-root .l-cmd__heading"), "color"), "var(--l-ink-3)");
  assert.equal(value(one(css, ".l-root .l-cmd__foot"), "box-shadow"), "inset 0 0.5px 0 var(--lc-line2)");
});

test("In Liner Design's dock a docked ask hides nothing: its chat and its rows stay, and the dock's head is a part of its card, not a tab", () => {
  // Review R1 M2: hiding every child but the ask hid the design chat (design/Dock.tsx puts ChatOpen or ChatMin in the head).
  const css = sheet("app.css");
  assert.equal(blocks(css, ".lc-tray-head[data-ask] > :not(.lc-dask)").length, 0, "a docked ask hides everything else in the head, the design chat too");
  assert.doesNotMatch(css, /\.lc-tray-head\[data-ask\][^{]*:not\(\.lc-dask\)/, "a docked ask hides everything else in the head");
  for (const sel of [".lc-tray-head[data-ask]:not(.ld-dock *) > .lc-trow", ".lc-tray-head[data-ask]:not(.ld-dock *) > .lc-pcheck-box"]) assert.equal(blocks(css, sel).length, 1, `only the tab's own rows step aside, and never in Liner Design's dock: ${sel}`);
  assert.match(code("design/Dock.tsx"), /top=\{<>\{chat\}\{asking && <AskDock dock=\{asking\} \/>\}/, "the design chat isn't in the dock's head beside the ask");
  const design = sheet("design/design-face.css");
  const head = one(design, ".ld-dock .lc-tray-head");
  assert.equal(value(head, "margin"), "0", "the dock's rows are inset as a tab inside its card");
  assert.equal(value(head, "background"), "none");
  assert.equal(value(head, "box-shadow"), "none");
  const card = one(design, ".ld-dock .lc-tray");
  assert.equal(value(card, "padding"), "4px", "the box touches the dock card's edge");
  assert.equal(value(card, "background"), "var(--lc-well)");
});

test("The line under the box says where it runs in the platform's own word, never a hard-coded Mac", () => {
  const composer = code("Composer.tsx");
  const under = composer.slice(composer.indexOf("const under = "), composer.indexOf("const ready = Boolean(text"));
  assert.doesNotMatch(under, /This Mac|this Mac/, "the line says Mac on every platform");
  assert.match(under, /thread\.worktree \? thread\.worktree\.branch : os\.Here/);
  assert.match(under, /`In the project's own folder on \$\{os\.here\}`/);
});

test("Effort takes no maker's colour: the prop is gone and nothing computes it for the track", () => {
  const models = code("Models.tsx");
  assert.doesNotMatch(models.slice(models.indexOf("export function EffortPart("), models.indexOf("export function EffortPart(") + 400), /tint/, "EffortPart still takes a tint it ignores");
  for (const f of ["Models.tsx", "Composer.tsx"]) assert.doesNotMatch(code(f), /<EffortPart [^\n]*tint=/, `${f} still computes a tint for Effort`);
  assert.doesNotMatch(sheet("app.css"), /\.lc-way-marks/, "rules for the who chip's old sidekick mark are left");
});

test("The side chat's box keeps a session's 752 at most, centred, however wide its pane grows", () => {
  // Review R2 B9: in Fill the window the side chat's box spanned the sheet, its pane having no thread measure.
  const css = sheet("app.css");
  const sc = one(css, ".lc-sc .lc-composer");
  assert.equal(value(sc, "max-width"), "752px");
  assert.equal(value(sc, "margin-inline"), "auto");
  assert.match(code("SideChat.tsx"), /<div className="lc-sc">/, "the side chat's root class moved");
});

test("The picker's tool head is a grey label row with its plan at the end, read only from what the engine already holds", () => {
  // Review R2 B6, board Menus' .ml.
  const css = sheet("models.css");
  const head = one(css, ".lc-pk-head");
  assert.equal(value(head, "font-size"), "12px");
  assert.equal(value(head, "font-weight"), "400");
  assert.equal(value(head, "color"), "var(--l-ink-3)", "the tool's head is in ink, not grey");
  assert.equal(value(one(css, ".lc-pk-on"), "background"), "var(--l-ok)", "no green dot while signed in");
  const picker = code("Models.tsx");
  assert.match(picker, /const plan = tool \? limits\.find\(\(l\) => l\.provider === tool\.id && l\.plan\)\?\.plan : undefined;/, "the plan isn't the one the engine already holds");
  const p = picker.slice(picker.indexOf("export function ModelPicker("), picker.indexOf("export type PickChoice"));
  assert.doesNotMatch(p, /rpc\(/, "the picker reads something new for the plan");
});

test("The Effort dither's layers come in a set distance before the knob and are cut on the 12px tile, so no cell is cut into a seam", () => {
  // Review R2 B7: shares of the fill's length let the layers in at wide bands and cut cells in half at Max.
  const css = sheet("halftone.css");
  const d = [156, 132, 108, 84, 60, 48, 36, 24];
  d.forEach((px, k) => {
    const b = blocks(css, `.lc-dither > i:nth-child(${k + 1})`)[0] ?? "";
    assert.ok(b.includes(`clip-path: inset(0 0 0 max(0px, round(down, calc(100% - ${px}px), 12px)));`), `layer ${k + 1} isn't cut on the tile ${px}px before the knob`);
  });
  assert.doesNotMatch(css, /clip-path: inset\(0 0 0 \d+%\)/, "a layer still comes in at a share of the fill's length");
  assert.equal(value(blocks(css, ".lc-dither > i")[0], "background-size"), "12px 12px");
});
