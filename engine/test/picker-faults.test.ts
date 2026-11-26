/*
  The model picker's faults found in review on 2026-11-21, where they live in a component or a stylesheet rather than in
  picker.ts (whose rules engine/test/picker.test.ts runs): each is read from the source as written, since a component
  needs a page to run. Run with `node --test engine/test/picker-faults.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const sheet = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, "");
// Every block whose selector list holds exactly this selector, in file order: its declarations as text.
const blocks = (css: string, selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")).includes(selector)).map((m) => m[2]);
const value = (block: string, property: string) => block.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`))?.[1].trim();
// A function's body, from its head to the first line that closes it at the start of a line.
const body = (text: string, head: string) => {
  const at = text.indexOf(head);
  assert.ok(at >= 0, `${head} is gone`);
  return text.slice(at, text.indexOf("\n}\n", at));
};

test("Find resolves a model several sources offer the way the list does, so picking the session's ticked row never moves it to another source", () => {
  const models = code("Models.tsx");
  assert.match(body(models, "export function ModelSearch("), /useOffered\(value\)/, "Find merges without the session's own source");
  assert.match(body(models, "export function ModelPicker("), /useOffered\(value\)/, "the list merges without the session's own source");
  assert.equal(models.match(/mergeOffers\(/g)?.length, 1, "a model's row is merged in more than one place, which can disagree");
});

test("A row's note that tells it from another of the same name stays in sight at its end, and no note that isn't words is dropped", () => {
  const ui = code("ui.tsx");
  const row = body(ui, "export function Row(");
  assert.match(row, /className="lc-row-which" data-path=\{whichPath \|\| undefined\} title=\{which\}/, "what tells a row apart isn't on its line with its whole text in its tooltip");
  assert.match(row, /whichPath \? <bdi>\{which\}<\/bdi>/, "a path isn't kept in its own order when cut from its start");
  assert.match(row, /loose !== undefined \?/, "a note that isn't words is dropped");
  const css = sheet("app.css");
  const which = blocks(css, ".lc-row-which");
  assert.equal(which.length, 1);
  assert.equal(value(which[0], "color"), "var(--l-ink-3)");
  assert.equal(value(which[0], "text-overflow"), "ellipsis");
  assert.equal(value(which[0], "white-space"), "nowrap");
  assert.equal(value(blocks(css, ".lc-row-which[data-path]")[0] ?? "", "direction"), "rtl", "a path is cut from its end, hiding where it ends");
  // The rows that differ only by what the note says.
  // The full chooser's projects and Mac repositories, and Home's quick pick.
  assert.equal(code("Projects.tsx").match(/which=\{/g)?.length, 3, "same-named projects can't be told apart by path or remote");
  assert.match(code("security/StartScan.tsx"), /<Row key=\{p\.id\} title=\{p\.name\} which=\{p\.path\} whichPath/, "a scan's projects can't be told apart by path");
  assert.equal(code("AgentDialog.tsx").match(/which=\{(shortPath\()?x\.path/g)?.length, 2, "skills of one name can't be told apart by path");
  assert.match(code("design/Versions.tsx"), /which=\{`\$\{v\.frames\}/, "a design's copies can't be told apart by their frames");
  assert.match(code("design/Pictures.tsx"), /which=\{p\} whichPath/, "pictures of one name can't be told apart by folder");
});

test("A tool with more than two sources shows one chip for them, and its name never shrinks below its mark and about six letters", () => {
  const models = code("Models.tsx");
  assert.match(models, /stepped && !switchAsChip\(sources\.length\) && \(\s*<span className="lc-pk-src"/, "the buttons show however many sources there are");
  assert.match(models, /stepped && switchAsChip\(sources\.length\) && \(\s*<button type="button" className="lc-pk-chip lc-pk-srcchip/, "no chip stands in for many sources");
  assert.match(models, /view === "sources" && tool/, "the chip opens no list of sources in place");
  const css = sheet("models.css");
  assert.equal(value(blocks(css, ".lc-pk-head-t")[0], "min-width"), "6ch", "the tool's name shrinks to nothing beside the switch");
  assert.equal(value(blocks(css, ".lc-pk-chip.lc-pk-srcchip")[0] ?? "", "min-width"), "0");
});

test("A row offered by several sources is starred and unstarred by all its ids, the card saying Starred as the list does", () => {
  const models = code("Models.tsx");
  assert.doesNotMatch(models, /star\((m|r\.pick)\.ref\)/, "a star still acts on one id of a row several sources offer");
  assert.match(body(models, "function ModelCard("), /const fav = row\.offers\.some\(\(x\) => favs\.includes\(x\.ref\)\);[\s\S]*star\(row\.offers\.map\(\(x\) => x\.ref\)\)/, "the card's star isn't the row's");
  assert.match(body(models, "export function ModelPicker("), /starred: \(m\) => favs\.includes\(m\.ref\)/);
});

test("The side card with nothing pointed at shows the session's own only while the rail shows the session's tool", () => {
  const picker = body(code("Models.tsx"), "export function ModelPicker(");
  assert.match(picker, /shownOf\(cardKey\(null, fallback \?\? value \?\? null, toolId, home\)\)/, "another tool's would-be pair stands in for the session's");
  assert.match(picker, /const pickTool = \(id: string\) => \([^\n]*setDwell\(dwellAt\(null\)\)\)/, "a row pointed at on one tool keeps the card on another");
});

test("The arrow keys reach every row of the picker: the Reviewer's Automatic, the source switch, the narrow line, and the card's Star", () => {
  assert.match(code("Session.tsx"), /first=\{<Row title="Automatic" rove /, "the Reviewer's Automatic is skipped by Up and Down");
  assert.match(body(code("ui.tsx"), "export function Row("), /data-rove=\{rove \|\| undefined\}/, "a Row can't be one the arrows walk");
  const models = code("Models.tsx");
  assert.match(body(models, "function ModelCard("), /className="lc-pk-star l-focus" data-rove/, "the card's Star is skipped by Up and Down");
  assert.match(body(models, "function ModelLine("), /className="lc-pk-chip l-focus" data-rove/, "the narrow line's Effort is skipped");
  assert.match(body(models, "function ModelLine("), /className="lc-pk-ib l-focus" data-rove/, "the narrow line's star is skipped");
  const picker = body(models, "export function ModelPicker(");
  assert.match(picker, /data-rove=\{source === s \|\| undefined\}/, "the source switch is no stop of Up and Down");
  assert.match(picker, /closest<HTMLElement>\("\.lc-pk-src"\)/, "Left and Right don't walk the source switch");
  assert.match(picker, /card_\.current\.querySelector<HTMLElement>\("\[data-rove\]:not\(:disabled\)"\)/, "Right goes to the card's first button, not its first row");
});

test("A long name has first call on its row: the sources give way first, then the price", () => {
  const css = sheet("models.css");
  assert.equal(value(blocks(css, ".lc-pk-row > .lc-who-row-t")[0] ?? "", "flex"), "0 0 auto", "the name shrinks while the sources and price have room to give");
  assert.equal(value(blocks(css, ".lc-pk-row > .lc-who-row-t")[0] ?? "", "max-width"), "calc(100% - 44px)", "a name alone too long runs past the tick");
  assert.equal(value(blocks(css, ".lc-pk-from")[0], "flex"), "0 100000 auto", "the sources don't give way first");
  assert.equal(value(blocks(css, ".lc-pk-row > .lc-pk-price")[0] ?? "", "flex"), "0 1 auto", "the price never gives way");
  assert.match(code("Models.tsx"), /<span className="lc-pk-from" title=\{fromTitle\}>/, "cut sources have no tooltip with their whole text");
});

test("The source switch's choice is written through contracts' Settings from the latest value, and nothing dead is left of the old picker", () => {
  const models = code("Models.tsx");
  assert.doesNotMatch(models, /WithSources|as Partial<EngineSettings>/, "the sources are still read through a local type");
  assert.match(models, /const writeSources = sourceWriter\(/, "a choice is written from the value one render saw");
  assert.doesNotMatch(models, /modelsOfTool/, "modelsOfTool is left with nothing using it");
  assert.doesNotMatch(sheet("models.css"), /lc-who-line\b/, ".lc-who-line is left with nothing using it");
  assert.match(body(models, "export function ModelPicker("), /older\.length > 0 && \(/);
  assert.doesNotMatch(models, /rowsAll\.length/, "the tool's count counts what the source switch leaves out");
});

test("The picker's cards are never taller than the room its bare Pop was given, only the models' part giving way", () => {
  const ui = code("ui.tsx");
  assert.match(ui, /panelSide\(\{ h, below, above, prefer, keep, keepMin: KEEP_MIN, whole \}\)/, "a Pop's side isn't chosen by panelSide");
  assert.match(ui, /within, bare, out\);/, "a bare Pop isn't placed as a whole panel");
  assert.match(ui, /\.\.\.\(at\.max !== undefined \? \{ "--lc-pop-room": `\$\{at\.max\}px` \}/, "the room isn't handed to the picker's cards");
  assert.match(ui, /p\.style\.removeProperty\("--lc-pop-room"\)/, "the cards are measured at the room they were fitted to");
  const css = sheet("models.css");
  assert.equal(value(blocks(css, ".lc-pk")[0], "--lc-pk-tall"), "min(var(--lc-pk-h, 476px), calc(100vh - 96px), var(--lc-pop-room, 100vh))", "the cards keep 476 whatever room they were given");
  assert.equal(value(blocks(css, ".lc-pk-mid")[0], "height"), "var(--lc-pk-tall)");
  assert.equal(value(blocks(css, ".lc-pk-side")[0], "max-height"), "var(--lc-pk-tall)");
  assert.equal(value(blocks(css, ".lc-pk-scroll")[0], "flex"), "1 1 0", "the models' part doesn't give way");
});

test("The Effort head is one line: the label, whose levels they are going whole when there is no room, and the level at the right, never cut", () => {
  const css = sheet("models.css");
  const head = blocks(css, ".lc-pk-eh")[0];
  assert.equal(value(head, "flex-direction"), undefined, "the head is a column of two lines again");
  assert.equal(value(head, "align-items"), "center");
  // Whose levels wraps onto a line the head hides, rather than being cut to "from Cl…".
  const left = blocks(css, ".lc-pk-eh-l")[0];
  assert.equal(value(left, "flex-wrap"), "wrap", "whose levels is cut mid-word instead of going whole");
  assert.equal(value(left, "height"), "20px");
  assert.equal(value(left, "overflow"), "hidden");
  assert.equal(value(blocks(css, ".lc-pk-eh-by")[0], "flex"), "none");
  assert.equal(value(blocks(css, ".lc-pk-eh-by")[0], "white-space"), "nowrap");
  assert.equal(value(blocks(css, ".lc-pk-eh-now")[0], "flex"), "none", "the level is cut");
  assert.equal(value(blocks(css, ".lc-pk-eh-now")[0], "font-weight"), "500");
  assert.equal(value(blocks(css, ".lc-pk-eh-now[data-own]")[0], "color"), "var(--l-ink-3)", "the tool's own default isn't in the third ink");
  const part = body(code("Models.tsx"), "export function EffortPart(");
  assert.match(part, /<span className="lc-pk-eh-l">\s*<b>\{label\}<\/b>\s*\{tool && <span className="lc-pk-eh-by">from \{tool\}<\/span>\}\s*<\/span>\s*<span className="lc-pk-eh-now" data-own=\{!level \|\| undefined\}>\s*\{name\}/, "the head isn't the label, whose levels, then the level");
  assert.match(part, /const name = level \? levelName\(level\.label\) : "Its own default";/);
  assert.match(part, /Its own default until you pick one/, "the head's tooltip lost its ending while the tool's own default runs");
  // An extra's words are one line too, whole on their tooltip.
  assert.equal(value(blocks(css, ".lc-pk-xr-t > span")[0], "white-space"), "nowrap");
  assert.equal(value(blocks(css, ".lc-pk-xr-t > span")[0], "text-overflow"), "ellipsis");
  // The lead's effort uses the same part.
  assert.match(code("Composer.tsx"), /<EffortPart list=\{pEfforts\.list\} [^\n]*label="The lead's effort"/);
});

test("Effort is one slider of the model's own levels with no shared list of levels, Claude Code's extras are switches, and no radio list of levels is left", () => {
  const models = code("Models.tsx");
  const part = body(models, "export function EffortPart(");
  // The levels come from the model's list as its tool gave it (effortsFor → model.efforts), the extras parted from them.
  assert.match(part, /const \{ levels, extras \} = effortParts\(list\);/, "the slider's stops aren't the model's own levels");
  assert.match(part, /<EffortSlider levels=\{levels\}/);
  const slider = body(models, "function EffortSlider(");
  assert.match(slider, /role="slider"/);
  assert.match(slider, /tabIndex=\{0\}/, "the slider isn't one focus stop");
  assert.match(slider, /data-rove/, "Up and Down in the card skip the slider");
  assert.match(slider, /aria-valuemin=\{0\}\s+aria-valuemax=\{n - 1\}\s+aria-valuenow=\{sliderNow\(shown\.at\)\}\s+aria-valuetext=\{name\}/, "the slider doesn't say its value");
  assert.match(slider, /aria-label=\{label\}/);
  assert.match(slider, /setPointerCapture\(e\.pointerId\)/, "a drag leaves the track and is lost");
  assert.match(slider, /\{levels\.map\(\(e, i\) => \(\s*<span key=\{e\.id\} className="lc-pk-slide-stop" aria-hidden data-tick=\{i > at \|\| undefined\} [^\n]*title=\{stopTitle\(e, i, shown, fallback\)\} \/>/, "a stop has no tick past the level or no title for the mouse");
  assert.match(models, /press again for its own default/, "nothing says how to go back to the tool's own default");
  // The extras as the app's own switch, which the arrows walk.
  assert.match(part, /\{extras\.map\(\(e\) => \(\s*<div key=\{e\.id\} className="lc-pk-xr">/);
  assert.match(part, /<NamedSwitch name=\{levelName\(e\.label\)\} size="sm" rove checked=\{shown\.extra === e\.id\} onCheckedChange=\{\(on\) => onPick\(switchExtra\(e\.id, on, before\.current\.level\)\)\} \/>/, "an extra isn't a switch that goes back to the level before it");
  // No list of the app's own levels, and no radio rows of levels anywhere the picker is used.
  for (const f of ["Models.tsx", "Composer.tsx", "AgentDialog.tsx", "Agentic.tsx", "Settings.tsx", "security/StartScan.tsx"]) {
    const text = code(f);
    assert.doesNotMatch(text, /EffortRows|EffortHead\b/, `${f} still draws the old list of levels`);
    assert.doesNotMatch(text, /"(low|medium|high|xhigh|max)",\s*"(low|medium|high|xhigh|max)"/, `${f} keeps a list of levels of its own`);
  }
  assert.doesNotMatch(models, /role="radiogroup" aria-label=\{label\}/, "a radio list of levels is left");
  assert.doesNotMatch(sheet("models.css"), /\.lc-pk-def\b/, ".lc-pk-def is left with nothing using it");
  // The narrow line's chip opens this same part in place.
  const picker = body(models, "export function ModelPicker(");
  assert.match(picker, /view === "effort" && effort && effortOf[\s\S]*?<EffortPart list=\{list\}/, "the narrow form's Effort doesn't open the slider");
  // The fill and the knob move only as decoration: Reduce motion stops them.
  assert.match(sheet("models.css"), /@media \(prefers-reduced-motion: reduce\) \{\s*\.lc-pk-slide-fill,\s*\.lc-pk-slide-knob \{\s*transition: none;/);
  const css = sheet("models.css");
  assert.equal(value(blocks(css, ".lc-pk-slide")[0], "height"), "24px");
  assert.equal(value(blocks(css, ".lc-pk-slide")[0], "border-radius"), "8px");
  // The fill is the model's maker's colour, the app's accent for one drawn in ink, a gradient laid across the whole track.
  assert.equal(value(blocks(css, ".lc-pk-slide-fill")[0], "background"), "var(--lc-pk-tint, var(--l-accent))", "the fill isn't in the model's colour");
  assert.equal(value(blocks(css, ".lc-pk-slide-fill")[0], "background-size"), "100cqw 100%", "a gradient is squeezed into a low level's fill");
  assert.equal(value(blocks(css, ".lc-pk-slide")[0], "container-type"), "inline-size");
  assert.match(slider, /"--lc-pk-tint": tint/, "the slider doesn't take its model's colour");
  for (const where of ["function ModelCard(", "export function EffortPick("]) assert.match(body(models, where), /tint=\{[^}]*tintPaint\(markOf\(/, `${where} doesn't hand the slider its model's colour`);
  // A halftone of dots runs small and faint to big and bright across the whole track, and the fill shows as much of it as the level reaches.
  assert.match(models, /const DOTS = Array\.from\(\{ length: DOT_COLUMNS \* 3 \}, \(_, k\) => \(\{ at: \(k % DOT_COLUMNS\) \/ \(DOT_COLUMNS - 1\)/, "a dot doesn't know how far along the track it stands");
  assert.match(slider, /<span className="lc-pk-slide-dots">/);
  assert.doesNotMatch(models, /lc-pk-slide-ascii|const RAMP/, "the ASCII ramp is left behind");
  assert.equal(value(blocks(css, ".lc-pk-slide-dots")[0], "width"), "100cqw", "the dots are squeezed into the fill instead of cut by it");
  assert.equal(value(blocks(css, ".lc-pk-slide-dots > i")[0], "width"), "calc(1px + var(--d) * 2.4px)", "the dots don't grow toward the high end");
  assert.equal(value(blocks(css, ".lc-pk-slide-dots > i")[0], "border-radius"), "50%", "the dots aren't round");
  assert.equal(value(blocks(css, ".lc-pk-slide-knob")[0], "width"), "12px");
  assert.equal(value(blocks(css, ".lc-pk-slide-knob")[0], "height"), "18px");
  assert.equal(value(blocks(css, ".lc-pk-slide-knob")[0], "border-radius"), "5px");
});

test("Fusion's pair at the row's end is cut with an ellipsis and whole in its tooltip, and the word Fusion never shrinks", () => {
  const composer = code("Composer.tsx");
  assert.match(composer, /<span className="lc-who-row-t lc-pk-word">Fusion<\/span>\s*(\{\}\s*)?<span className="lc-pk-pair" title=\{note\}>/, "the pair is clipped mid-letter with no tooltip");
  assert.match(composer, /shortName\(label\(cast\.lead\)\)\} \+ \$\{shortName\(label\(cast\.sidekick\)\)\}/, "the pair doesn't use each model's short name");
  assert.match(code("Models.tsx"), /<span className="lc-pk-pair" title=\{c\.note\}>/, "a pinned choice's note is clipped mid-letter");
  const css = sheet("models.css");
  assert.equal(value(blocks(css, ".lc-who-row-t.lc-pk-word")[0] ?? "", "flex"), "none", "the word Fusion gives way to the pair");
  const pair = blocks(css, ".lc-pk-pair")[0] ?? "";
  assert.equal(value(pair, "display"), "block", "an ellipsis can't cut text in a flex box");
  assert.equal(value(pair, "text-overflow"), "ellipsis");
  assert.equal(value(pair, "min-width"), "0");
});

test("The rail and the cards start on one line, and a hairline parts the models' scroll from the foot rows", () => {
  const css = sheet("models.css");
  assert.equal(value(blocks(css, ".lc-pk")[0], "align-items"), "start", "the rail and the cards don't share their top");
  for (const sel of [".lc-pk-rail", ".lc-pk-mid", ".lc-pk-side"]) for (const b of blocks(css, sel)) assert.equal(value(b, "margin-top") ?? value(b, "margin"), undefined, `${sel} is moved off the shared top`);
  assert.equal(value(blocks(css, ".lc-pk-foot")[0], "border-top"), "1px solid var(--l-line)", "nothing parts the scroll from the foot rows");
  assert.equal(value(blocks(css, ".lc-pk-scroll")[0], "min-height"), "0");
});

test("Every place gives Effort the word it stores, never one resolved to the tool's default, and says which card holds it, so another model's level carried over is picked by a press", () => {
  const composer = code("Composer.tsx");
  const hook = composer.slice(composer.indexOf("const effort: EffortHook = {"), composer.indexOf("const agentsOn"));
  assert.match(hook, /of: \(\) => settings\.effort,\s*held: \(ref\) => ref === runs,/, "the session picker hands every card the session's level resolved for it, marked as chosen there");
  assert.doesNotMatch(hook, /effortIn\(/, "the session picker resolves the stored word before Effort sees it");
  const models = code("Models.tsx");
  assert.match(models, /<EffortPart list=\{list\} fallback=\{fallback\} value=\{effort\.of\(m\.ref\)\} held=\{effort\.held\?\.\(m\.ref\) \?\? true\}/, "a model's card doesn't say whether it holds the effort");
  assert.match(models, /value=\{effort\.of\(effortOf\)\} held=\{effort\.held\?\.\(effortOf\) \?\? true\}/, "the narrow Effort view doesn't say whether it holds the effort");
  const pick = body(models, "export function EffortPick(");
  assert.match(pick, /<EffortPart list=\{list\} fallback=\{fallback\} value=\{value\} held=\{held\}/, "EffortPick hands Effort the level resolved to the tool's default, so it reads as chosen");
  const dialog = code("AgentDialog.tsx");
  assert.match(dialog, /const holds = \(ref: string\) => ref === model && effortMine;/);
  assert.match(dialog, /effort=\{\{ of: effortHere, held: holds, pick:/, "the new agent's picker marks another model's level as chosen");
  assert.match(dialog, /<EffortPick modelRef=\{model\} value=\{effortHere\(model\)\} held=\{holds\(model\)\}/);
});

test("Fusion's card for another tool shows Settings' pair level as one a press picks, and the session's own pair hands Effort its stored word", () => {
  assert.match(code("Composer.tsx"), /<EffortPart list=\{pEfforts\.list\} fallback=\{pEfforts\.fallback\} value=\{mine \? settings\.effort : pEffortNow\} held=\{mine\} label="The lead's effort"/, "another tool's Fusion card marks the pair's level as chosen, so a press makes the pair at the tool's default");
});

test("Fusion's How it works picks the lead's effort with the same slider and switches as Fusion's card, not a list of levels of its own", () => {
  const composer = code("Composer.tsx");
  assert.match(composer, /line === "effort" && \(\s*<>\s*<EffortPart list=\{efforts\.list\} fallback=\{efforts\.fallback\} value=\{settings\.effort\} label="The lead's effort"[^\n]*onPick=\{\(id\) => pickLine\("effort", id\)\} \/>/, "How it works › The lead's effort isn't the shared Effort part");
  assert.doesNotMatch(composer, /effortParts\(efforts\.list\)\.levels\.map/, "How it works keeps its own list of effort levels");
  assert.doesNotMatch(composer, /EFFORT_NOTES/, "the old list's notes are left with nothing using them");
});

test("Settings' lead effort saves the tool's own default as no word, so pressing the chosen level again or Delete is saved and not refused", () => {
  const agentic = code("Agentic.tsx");
  assert.match(agentic, /<EffortPick modelRef=\{c\.lead\} value=\{settings\.pairEffort \?\? ""\} label="The lead's effort" onChange=\{\(v\) => save\(\{ pairEffort: settingLevel\(v\) \?\? UNSET \}\)\} \/>/, "Settings' lead effort sends \"\", which settings.save refuses");
});

test("The Effort knob is white in both looks with the switch thumb's shadow, and the source rows' CSS no longer says it is Effort's", () => {
  const knob = blocks(sheet("models.css"), ".lc-pk-slide-knob")[0];
  assert.equal(value(knob, "background"), "oklch(0.995 0 0)", "the knob isn't the white of the app's switch thumb");
  assert.equal(value(knob, "box-shadow"), "var(--l-thumb-shadow)");
  const raw = read("models.css");
  const note = raw.slice(raw.lastIndexOf("/*", raw.indexOf(".lc-pk-lv {")), raw.indexOf(".lc-pk-lv {"));
  assert.doesNotMatch(note, /Effort/, "the note over the source rows still says Effort uses them");
});

test("In the picker the marks are in their makers' colours, a row's corner follows its card's, and the hover and the side card move instead of jumping", () => {
  const css = sheet("models.css");
  // Colour only in the picker, only on a logo (a stroke icon such as the cube would fill solid), and grey for a tool not signed in.
  assert.equal(value(blocks(css, ".lc-pk .lc-mark[data-brand]")[0] ?? "", "fill"), "var(--lc-tint, currentColor)", "the picker's marks aren't in their makers' colours");
  assert.equal(value(blocks(css, ".lc-pk-tool[data-off] .lc-mark[data-brand]")[0] ?? "", "fill"), "currentColor", "a tool not signed in is drawn in colour");
  assert.equal(blocks(css, ".lc-pk .lc-mark").length, 0, "a stroke icon in the picker is filled solid");
  assert.match(code("icons.tsx"), /"--lc-tint": typeof tint === "string" \? tint : `url\("#\$\{cut\}"\)`/, "a mark doesn't carry its colour, or Gemini's gradient");
  const brands = read("brands.ts");
  assert.match(brands, /claude: "#D97757"/);
  assert.match(brands, /gemini: \[/, "Gemini isn't its gradient");
  assert.doesNotMatch(brands, /\n  (openai|grok|cursor|opencode|ollama): "#/, "a maker drawn in black is given a colour");
  // A row 4 in from a 14 card's edge takes 10, so the Star at the card's foot and the foot rows follow its corners.
  assert.equal(value(blocks(css, ".lc-pk[data-side]")[0] ?? "", "--lc-pk-r"), "10px");
  assert.equal(value(blocks(css, ".lc-pk-side")[0], "padding"), "4px");
  assert.equal(value(blocks(css, ".lc-pk-star")[0], "border-radius"), "var(--lc-pk-r)", "the Star's corners don't follow the card's");
  assert.equal(value(blocks(css, ".lc-pk .lc-who-row")[0], "border-radius"), "var(--lc-pk-r)");
  assert.equal(value(blocks(css, ".lc-pk[data-side] .lc-pk-rail")[0], "border-radius"), "14px", "the rail's corner isn't the cards'");
  // One plate slides under the rows; the rows in the list don't light themselves.
  const models = code("Models.tsx");
  assert.match(body(models, "export function ModelPicker("), /<HoverPlate within=\{scroll\} reset=/, "the list has no sliding plate");
  assert.match(value(blocks(css, ".lc-pk-plate")[0], "transition") ?? "", /transform 160ms/);
  assert.equal(value(blocks(css, ".lc-pk-scroll .lc-who-row:not(:disabled):hover")[0] ?? "", "background"), "none", "a row lights itself under the plate");
  // The side card eases to the height of what it holds, its words fading in afresh for each model, and Reduce motion stops both.
  assert.match(body(models, "export function ModelPicker("), /useEasedHeight\(card_, cardIn\)/);
  assert.match(value(blocks(css, ".lc-pk-side")[0], "transition") ?? "", /^height 220ms/);
  assert.equal(value(blocks(css, ".lc-pk-side")[0], "overflow"), "hidden", "a scrollbar shows while the card eases");
  assert.match(body(models, "export function ModelPicker("), /<div key=\{shown\?\.label \?\? ""\} className="lc-pk-side-in lc-pk-fade">/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.lc-pk-fade \{\s*animation: none;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.lc-pk-side \{\s*transition: none;/);
});

test("The side card drops to the list's foot beside a row pointed at in the list's lower half, and stands at its top otherwise, never in between", () => {
  const picker = body(code("Models.tsx"), "export function ModelPicker(");
  assert.match(picker, /setLow\(r\.top \+ r\.height \/ 2 > a\.top \+ a\.height \/ 2\)/, "the card's place isn't judged by which half of the list the row is in");
  assert.match(picker, /if \(!m \|\| !row\) return setLow\(false\);/, "with nothing pointed at the card isn't at the top");
  assert.match(picker, /className="lc-pk-card lc-pk-side" data-low=\{low \|\| undefined\}/);
  const css = sheet("models.css");
  assert.equal(value(blocks(css, ".lc-pk-side[data-low]")[0] ?? "", "transform"), "translateY(calc(var(--lc-pk-tall) - 100%))", "the dropped card's bottom isn't on the list's bottom");
  assert.match(value(blocks(css, ".lc-pk-side")[0], "transition") ?? "", /transform 220ms/, "the card jumps between top and foot");
});

test("Your agents is a place on the picker's rail under the tools, not a row at the middle card's foot, so the models keep the card's height", () => {
  const models = code("Models.tsx");
  const rail = body(models, "function ToolRail(");
  assert.match(rail, /\{places\.length > 0 && <span className="lc-pk-rail-rule" role="presentation" \/>\}/, "nothing parts the tools from the places");
  assert.match(rail, /className="lc-pk-tool l-focus" data-view=\{p\.id\} data-on=\{p\.on \|\| undefined\} aria-pressed=\{open === p\.id\}/, "a place isn't a rail button pressed while its list is open");
  const picker = body(models, "export function ModelPicker(");
  assert.match(picker, /<ToolRail tools=\{tools\} extras=\{railExtras\} places=\{places\} on=\{placeOpen \? "" :/, "a tool stays pressed while a place's list shows");
  assert.match(picker, /const hasFoot = older\.length > 0;/, "the foot still holds the places");
  assert.doesNotMatch(picker, /\{places\.map\(\(p\) => \(\s*<button key=\{p\.id\} type="button" className="lc-who-row/, "a place is still a row at the foot");
  // Escape out of a place's list goes back to its rail button.
  assert.match(picker, /rail\.current\?\.querySelector<HTMLElement>\(`\[data-view="\$\{was\}"\]`\)/);
  assert.equal(value(blocks(sheet("models.css"), ".lc-pk-tool[data-on]::after")[0] ?? "", "border-radius"), "50%", "a place that holds the pick has no dot");
});

test("Liner's mark in the app is the line comment, two slanted strokes with the second in the accent, and the two turns are gone", () => {
  const icons = code("icons.tsx");
  assert.match(icons, /mark: \(p: P\) => <S \{\.\.\.p\} w=\{2\}><path d="M3\.45 13\.05 7\.05 2\.95" \/><path d="M8\.95 13\.05 12\.55 2\.95" stroke="var\(--l-accent\)" \/><\/S>,/, "the mark isn't the line comment");
  assert.match(icons, /markMono: \(p: P\) => <S \{\.\.\.p\} w=\{2\}>/);
  assert.doesNotMatch(icons, /\bturn(Mono)?: \(p: P\)/, "the two turns are still drawn");
  for (const f of ["AppModel.tsx", "Crew.tsx", "AddonsPage.tsx", "Home.tsx", "Addon.tsx", "Pr.tsx", "Page.tsx", "Models.tsx", "Composer.tsx"]) assert.doesNotMatch(code(f), /\bI\.turn(Mono)?\b/, `${f} still uses the two turns`);
  // Run from source on macOS before 26, the Dock gets the line comment's PNGs, which are there.
  const main = readFileSync(new URL("../../desktop/src/main.ts", import.meta.url), "utf8");
  assert.match(main, /"docs\/brand\/line-comment", `liner-code-icon-\$\{look\}\.png`/, "the Dock is given the two turns when run from source");
  for (const look of ["light", "dark"]) assert.ok(readFileSync(new URL(`../../docs/brand/line-comment/liner-code-icon-${look}.png`, import.meta.url)).length > 1000, `the ${look} icon is missing`);
});
