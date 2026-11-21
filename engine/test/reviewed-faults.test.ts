/*
  Faults a review found in the 2026-11-20 change, each held where it was fixed: the deciding part as a pure function
  where one could be pulled out (confirm.ts, composer-rules.ts, live-thought.ts, start-words.ts, browserFrame.ts), and
  the wiring read from the files as written where it is component markup (precedent: said-states.test.ts,
  layout-rules.test.ts). Run with `node --test engine/test/reviewed-faults.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ProviderInfo } from "../../contracts/src/index.ts";
import { CONFIRM_SETTLE, confirmPress } from "../../ui/src/app/confirm.ts";
import { stashKeyOf, steersHere } from "../../ui/src/app/composer-rules.ts";
import { thoughtLine } from "../../ui/src/app/live-thought.ts";
import { startSaid } from "../../ui/src/app/start-words.ts";
import { widthUnseen } from "../../ui/src/app/browserFrame.ts";

const app = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");
/** One region of a file, from its marker to the next marker (or the end of the file). */
const span = (src: string, from: string, to?: string) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `marker not found: ${from}`);
  if (to === undefined) return src.slice(a);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `end marker not found after "${from}": ${to}`);
  return src.slice(a, b);
};

/* 1. Delete, then Delete for good */

test("A confirm asks on the first press, ignores the second click of a double-click, and acts on a later press", () => {
  assert.equal(confirmPress(null, 1000), "ask");
  assert.equal(confirmPress(1000, 1000 + 120), "wait", "a double-click's second click confirmed at once");
  assert.equal(confirmPress(1000, 1000 + CONFIRM_SETTLE - 1), "wait");
  assert.equal(confirmPress(1000, 1000 + CONFIRM_SETTLE), "do");
  assert.equal(confirmPress(1000, 1000 + 4000), "do");
});

test("Settings' Archive keeps no ask of its own, so Delete for good goes when the row's menu closes or another opens", () => {
  const archive = span(app("Settings.tsx"), "function Archive()", "/* ----------------------------------- Updates");
  assert.ok(!/useState/.test(archive), "Archive still keeps the ask in its own state, which outlives the menu");
  assert.ok(/<ConfirmRow\s+title="Delete"\s+sure="Delete for good"/.test(archive), "Delete is not the confirm row that keeps its ask inside the menu");
  const ui = app("ui.tsx");
  const row = span(ui, "export function ConfirmRow(", "export const PanelHead");
  assert.ok(/const \[askedAt, setAskedAt\] = useState<number \| null>\(null\)/.test(row), "the confirm row keeps no ask of its own, which would go with the menu");
  assert.ok(/confirmPress\(askedAt, now\)/.test(row), "the confirm row doesn't hold back a double-click's second click");
  assert.ok(/danger=\{asked\}/.test(row), "the confirm has lost the danger look the old one had");
  assert.ok(/data-danger=\{danger \|\| undefined\}/.test(span(ui, "export function Row(", "export function ConfirmRow(")), "a row can't take the danger look");
});

test("An add-on's Remove in its menu asks through the same confirm, so a double-click can't remove it", () => {
  const addon = app("Addon.tsx");
  assert.ok(!/function RemoveRow/.test(addon), "the old Remove row, which a double-click confirms, is still there");
  assert.ok(/<ConfirmRow title="Remove…" sure=\{`Remove \$\{a\.name\}`\}/.test(span(addon, "export function AddonMenu(", "export function AppPage(")), "the add-on menu's Remove is not the confirm row");
});

/* 2. The side chat and Fusion */

test("The side chat's box offers one model, with no Fusion and nothing that makes a pair", () => {
  assert.ok(/<Composer[\s\S]*?\baside\b[\s\S]*?\/>/.test(app("SideChat.tsx")), "the side chat doesn't mark its box as a side chat's");
  const composer = app("Composer.tsx");
  assert.ok(/<WhoPanel [^>]*solo=\{aside\}/.test(composer), "the box doesn't pass its side chat's mark to the who panel");
  const panel = span(composer, "function WhoPanel(", "export function PermissionRows(");
  // The picker draws the rows a caller pins; the who panel pins Fusion only when the box isn't a side chat's.
  assert.ok(/first=\{solo \? undefined : fusionRow\}/.test(panel), "the Fusion row is offered in a side chat");
  assert.ok(/<button type="button" className="lc-who-row l-focus" data-rove data-way="pair"/.test(panel), "the Fusion row is gone");
  assert.ok(/card=\{\(key, t, inPlace\) => \(key === "fusion" && !solo \? fusionCard\(t, inPlace\) : undefined\)\}/.test(panel), "Fusion's card is offered in a side chat");
  assert.ok(/const pickFusion = \(t: string, effort\?: string\) => \{\s*if \(solo\) return;/.test(panel), "picking Fusion still makes a pair in a side chat");
  // The rail only shows a tool's models now: pressing a tool starts nothing, so no other tool's pair can start there.
  assert.doesNotMatch(panel, /const pickTool =/, "pressing a tool on the rail still changes the session");
  assert.ok(/showDemo && !solo\s*\?/.test(panel), "the Demo's scripted Fusion run is offered in a side chat");
});

/* 3. ⌘⇧Enter */

test("Only one box steers on ⌘⇧Enter: the one with the focus, else the session's own, never the side chat's", () => {
  assert.equal(steersHere("mine", false), true);
  assert.equal(steersHere("mine", true), true, "the side chat's box with the focus doesn't steer");
  assert.equal(steersHere("other", false), false, "the session's box steers while the side chat's box has the focus");
  assert.equal(steersHere("none", false), true, "with the focus in no box, the session's own doesn't steer");
  assert.equal(steersHere("none", true), false, "with the focus in no box, the side chat's steers too");
  const keys = span(app("Composer.tsx"), "// ⌘⇧Enter sends the first queued message now", "// Compact:");
  assert.ok(/if \(!steersHere\(focus, live\.current\.aside\)\) return;/.test(keys), "the window key listener sends from every box that hears it");
  assert.ok(/root\.current\?\.contains\(at\)/.test(keys) && /closest\("\.lc-composer"\)/.test(keys), "the box doesn't tell its own focus from another box's");
});

/* 4. The Browser's Offline and width */

test("A phone or tablet drawn smaller to fit needs saying in the top row; one drawn at its own size says it itself", () => {
  assert.equal(widthUnseen(null, 500), false, "Desktop is the default and needs no chip");
  assert.equal(widthUnseen(390, 600), false, "a phone narrower than the stage is a frame that shows its width");
  assert.equal(widthUnseen(820, 500), true, "a tablet drawn smaller fills the stage as Desktop does");
  assert.equal(widthUnseen(390, 300), true);
});

test("Offline shows as a chip in the Browser's top row while it is on, and the chip's cross turns it off", () => {
  const browser = app("Browser.tsx");
  const bar = span(browser, '<div className="lc-br-bar">', '<Pop label="More for the page"');
  assert.ok(/\{offline && <ChoiceChip className="lc-br-chip" icon=\{<I\.offline size=\{14\} \/>\} label="Offline" clear=\{\{ label: "Go back online", onClear: \(\) => setOff\(false\) \}\} \/>\}/.test(bar), "Offline shows nowhere once its menu is shut");
  assert.ok(/widthUnseen\(w, room\) && <ChoiceChip/.test(bar), "a width the page doesn't show has no chip");
  const off = span(browser, "const setOff = (on: boolean) => {", "};");
  assert.ok(/setOffline\(on\)/.test(off) && /cmd\("offline", \{ on \}\)/.test(off), "the chip's cross doesn't tell the page it is back online");
});

/* 5 and 6. The live line */

test("The live line's sliding step is no live region, so the steps aren't read out one by one", () => {
  const slide = span(app("Timeline.tsx"), "function Slide(", "export function LiveLine(");
  assert.ok(!/aria-live/.test(slide), "each step that slides in is read aloud");
});

test("A thought's live words are its last sentence, and change sentence only at a sentence's end", () => {
  assert.deepEqual(thoughtLine(["I'll read the config."]), { sentence: "I'll read the config.", n: 1 });
  const mid = thoughtLine(["I'll read the config. Then the te"]);
  const more = thoughtLine(["I'll read the config. Then the tests"]);
  assert.equal(mid.sentence, "Then the te");
  assert.equal(more.sentence, "Then the tests");
  assert.equal(mid.n, more.n, "a new token slides the line as if a new sentence began");
  assert.equal(thoughtLine(["I'll read the config. Then the tests. Now"]).n, mid.n + 1, "a new sentence doesn't slide in");
  assert.equal(thoughtLine(["**Reading** the `config`"]).sentence, "Reading the config", "markdown shows as marks");
});

test("While a part works, the live line says what it is thinking and its open list holds the thoughts so far", () => {
  const live = span(app("Timeline.tsx"), "function Live(", "/** Thinking under 3 seconds");
  assert.ok(/thoughtLine\(since\.flatMap/.test(live), "the thinking line doesn't read the thought");
  assert.ok(/key: `think-\$\{since\[0\]\.it\.id\}:\$\{thought\.n\}`/.test(live), "the thinking line slides on every token, or never on a new sentence");
  assert.ok(/<span className="lc-wk-r">\{thought\.sentence\}<\/span>/.test(live), "the thought's last sentence isn't on the line in the quiet style");
  assert.ok(/const list = rows;/.test(live), "the list the head opens still leaves the thoughts out");
  assert.ok(/if \(!n && !newest\)/.test(live), "thinking before the first step shows the clock alone, without its words");
  assert.ok(/<Tick text=\{fine\} every=\{100\} \/>/.test(live), "the clock no longer redraws only its own text");
});

/* 7. Dead code */

test("Nothing is exported that only its own file uses, and the Spinner no one draws is gone", () => {
  assert.ok(!/export function Spinner\b/.test(app("icons.tsx")), "Spinner is still there with no caller");
  assert.ok(!/export function StepIcon\b/.test(app("Timeline.tsx")), "StepIcon is exported though only Timeline uses it");
  assert.ok(!/export function onWhom\b/.test(app("Crew.tsx")), "onWhom is exported though only Crew uses it");
});

/* 8. The side chat's stash */

test("The side chat keeps its stashed drafts apart from the session's box", () => {
  assert.equal(stashKeyOf("p1", false), "lc:stash:p1", "the session's stash moved, so drafts stashed before are lost");
  assert.notEqual(stashKeyOf("p1", true), stashKeyOf("p1", false), "⌘S in the side chat brings back the session's draft");
  assert.ok(/const stashKey = stashKeyOf\(project\.id, aside\);/.test(app("Composer.tsx")), "the box doesn't keep its stash by whose box it is");
});

/* 9. lc:view */

test("Changes keeps Unified or Split under a key of its own, reading the one released apps wrote when it has none", () => {
  const review = app("Review.tsx");
  assert.ok(/wordRead\(localStorage, "lc:changes-view", \["unified", "split"\], wordRead\(localStorage, "lc:view", \["unified", "split"\], "unified"\)\)/.test(review), "the choice isn't read from its own key with the released key as the fallback");
  assert.ok(/wordWrite\(localStorage, "lc:changes-view", view\)/.test(review) && !/wordWrite\(localStorage, "lc:view"/.test(review), "the choice is still written under lc:view, the window's place");
});

/* 10. What a new session starts with */

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const claude = info("claude", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
const codex = info("codex", ["gpt-6.1-sol"]);
const label = (ref: string) => ref.slice(ref.indexOf(":") + 1);

test("Settings says what a new session really starts with when the saved model's tool isn't ready, and that it isn't", () => {
  const said = startSaid({ start: "@codex:gpt-6.1-sol" }, [claude], label);
  assert.ok(!said.startsWith("gpt-6.1-sol alone"), "Settings says the saved model starts, though Home won't start it");
  assert.ok(/^Fusion: claude-opus-5-5 leads/.test(said), `Settings doesn't say what Home starts instead: ${said}`);
  assert.ok(/gpt-6\.1-sol, waits until its tool is ready/.test(said), "the note doesn't say the saved model's tool isn't ready");
  assert.equal(startSaid({ start: "@codex:gpt-6.1-sol" }, [claude, codex], label), "gpt-6.1-sol alone.", "a ready saved model isn't what starts");
  assert.ok(/note=\{startSaid\(s, providers, label, shortName\)\}/.test(span(app("Settings.tsx"), "function General(")), "Settings doesn't read the start the way Home does");
});

/* 11. The Wall's step count */

test("A working tile on The Wall says its step count once, on the live line, not again in its foot", () => {
  const wall = app("Wall.tsx");
  assert.ok(/live: marks\.some\(\(m\) => m\.status === "running"\)/.test(wall), "the tile doesn't know when its live line shows");
  assert.ok(/t\.status === "running" \? \(info\.live \? "" : `\$\{plural\(info\.count, "step"\)\} this turn`\)/.test(wall), "the foot repeats the live line's step count");
});

/* 12. Archive's empty words */

test("Settings' empty Archive says a session's row archives, before the command menu", () => {
  const archive = span(app("Settings.tsx"), "function Archive()", "/* ----------------------------------- Updates");
  assert.ok(/Archive a session from its row's ··· or the command menu \(\{os\.mod\}K\)/.test(archive), "the empty Archive names only the command menu");
});
