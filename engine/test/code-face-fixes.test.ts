/*
  The Code face's faults found by the fresh review of the right-panel build (2026-11-25), each fixed: the logic in the
  small pure files beside the components (menu-keys.ts, browser-trail.ts, commit-ask.ts, session-pop.ts, chat-cards.ts,
  row-menu.ts) run here, and what lives only in a component or a stylesheet is read from its source as written.
  Run with `node --test engine/test/code-face-fixes.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { backFromSide, FIRST_FOCUS, inText, movesRows } from "../../ui/src/app/menu-keys.ts";
import { canBack, canForward, landed, landing, NO_TRAIL } from "../../ui/src/app/browser-trail.ts";
import { ASK_KEPT_MS, askCommit, takeCommit } from "../../ui/src/app/commit-ask.ts";
import { addFive } from "../../ui/src/app/session-pop.ts";
import { agentsReach, crewCounts } from "../../ui/src/app/chat-cards.ts";
import { stopShows } from "../../ui/src/app/row-menu.ts";

const src = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");
const sheet = (file: string) => src(file).replace(/\/\*[\s\S]*?\*\//g, "");
// Every block whose selector list holds exactly this selector, in file order: its declarations as text.
const blocks = (css: string, selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")).includes(selector)).map((m) => m[2]);
const value = (block: string, property: string) => block.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`))?.[1].trim();
// A stand-in for an element: `closest` answers for the selectors the element would match.
const el = (matches: (selector: string) => boolean) => ({ closest: (s: string) => (matches(s) ? {} : null) });

test("The agents popup left open when its chip went does not drop open by itself with the next chip", () => {
  const crew = src("Crew.tsx");
  const chip = crew.slice(crew.indexOf("function ChipPop("), crew.indexOf("export function CrewChip("));
  assert.match(chip, /return \(\) => void \(chipsShown\.delete\(threadId\), popOpen\.delete\(threadId\)\);/, "the chip's cleanup keeps the popup's open state for the next chip");
});

test("A chat card's agents open the Agents surface in a Code session, open the session in Liner Code elsewhere, and are not buttons in a scan", () => {
  assert.equal(agentsReach(true, false), "panel");
  assert.equal(agentsReach(false, false), "code", "in Liner Design or a side chat the press does nothing");
  assert.equal(agentsReach(false, true), "none", "a scan's rows are buttons that can go nowhere");
  const crew = src("Crew.tsx");
  assert.match(crew, /agentsReach\(openSurface\(threadId, "agents"\), Boolean\(t\?\.security\)\) === "code"\) window\.dispatchEvent\(new CustomEvent\("lc:show-surface"/, "no way to the Code session where openSurface finds none");
  assert.doesNotMatch(crew, /else \(showAgent\(threadId, null\), openSurface\(threadId, "agents"\)\)/, "openAgents still opens only a Code session's panel");
  assert.equal((crew.match(/disabled=\{still/g) ?? []).length, 4, "a scan's card rows are still buttons");
  const app = src("App.tsx");
  assert.match(app, /window\.addEventListener\("lc:show-surface", surface\);/, "App doesn't hear a card's agents");
  assert.match(app, /const surface = \(e: Event\) => \{\s+const d = \(e as CustomEvent<\{ id: string; tab: Tab \}>\)\.detail;\s+openSession\(d\.id, d\.tab\);/);
});

test("A text field in a menu keeps its arrow, Home and End keys and its ←, and a side menu with a field focuses the field", () => {
  const field = el((s) => s.includes("textarea") || s.startsWith("input"));
  const row = el(() => false);
  assert.equal(inText(field), true);
  assert.equal(inText(row), false);
  assert.equal(inText(null), false);
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
    assert.equal(movesRows(key, false), true, `${key} no longer moves between a menu's rows`);
    assert.equal(movesRows(key, true), false, `${key} in a text field moves the menu, not the caret`);
  }
  assert.equal(movesRows("a", false), false);
  assert.equal(backFromSide("ArrowLeft", false), true);
  assert.equal(backFromSide("ArrowLeft", true), false, "← in a side menu's field closes the side menu");
  assert.equal(backFromSide("Escape", true), true, "Escape no longer closes a side menu from its field");
  assert.match(FIRST_FOCUS, /textarea/);
  assert.match(FIRST_FOCUS, /input:not\(\[type='checkbox'\]\)/, "a side menu of switches would focus a switch before its first row");
  const ui = src("ui.tsx");
  assert.match(ui, /if \(menu && movesRows\(e\.key, inText\(e\.target as HTMLElement\)\)\) \{/, "a Pop menu's keys still take a text field's");
  assert.match(ui, /if \(backFromSide\(e\.key, typing\) && !e\.defaultPrevented\) \{/, "SubMenu's ← still closes it from a field");
  assert.match(ui, /if \(movesRows\(e\.key, typing\)\) \{/, "SubMenu's arrows still take a text field's");
  assert.match(ui, /querySelector<HTMLElement>\(FIRST_FOCUS\) \?\?/, "a side menu still focuses its first button over its field");
});

test("A plan written in a Liner Design build, refine or fix turn shows once, as the Plan card", () => {
  const tl = src("Timeline.tsx");
  assert.match(tl, /hidePlan=\{card\?\.plan\.id\} \/>/, "the turn that holds a part turn's plan still draws it");
  assert.doesNotMatch(tl, /hidePlan=\{card\?\.plan\.turn === turn/);
});

test("Add $5 never sets a spend limit below what the session has spent", () => {
  assert.equal(addFive(undefined, 0), 5);
  assert.equal(addFive(undefined, 7), 12, "a session that spent $7 with no limit is over its new limit at once");
  assert.equal(addFive(10, 3), 15);
  assert.equal(addFive(10, 12.5), 17.5, "a limit already passed stays passed");
  assert.equal(addFive(0.1, 0.2), 5.2, "the sum is not rounded to cents");
  assert.match(src("SessionInfo.tsx"), /update\(\{ spendLimit: addFive\(thread\.spendLimit, usage\?\.costUsd \?\? 0\) \}\)/);
});

test("The Agents key opens the agents popup, and its name in Settings says so", () => {
  assert.match(src("keymap.ts"), /agents: "Open the agents"/);
  const session = src("Session.tsx");
  assert.match(session, /else if \(s\.id === "agents"\) !e\.repeat && openAgents\(thread\.id\);/, "the Agents key still toggles the surface");
  assert.ok(session.indexOf('s.id === "agents"') < session.indexOf("setDock((d) => toggleTab(d, s.id))"), "the Agents key falls through to toggleTab first");
});

test("The terminal's Find leaves the thread's Find highlights alone, and finds lines printed after the search", () => {
  const find = src("Find.tsx");
  assert.match(find, /const paint = \(\) => \(search \? undefined : registry\(\)\);/);
  assert.equal((find.match(/registry\(\)/g) ?? []).length, 1, "something besides paint() still reaches the page's highlights");
  const step = find.slice(find.indexOf("const step = (d: number) => {"), find.indexOf("return (", find.indexOf("const step = (d: number) => {")));
  assert.match(step, /search\.count\(query\.trim\(\)\)/, "a step through the terminal's matches doesn't count them again");
});

test("The Browser keeps Back after a link back to the page before, and a replaced address adds no place", () => {
  let t = landed(NO_TRAIL, "/a", "new");
  t = landed(t, "/b", "new");
  t = landed(t, "/a", "new");
  assert.equal(canBack(t), true, "A, B, then a link to A hides Back");
  assert.equal(canForward(t), false);
  assert.deepEqual(t.places, ["/a", "/b", "/a"]);
  t = landed(t, "/b", "pop");
  assert.equal(t.at, 1, "a Back onto the place before is read as a new place");
  assert.equal(canForward(t), true);
  let r = landed(NO_TRAIL, "/a", "new");
  r = landed(r, "/a?tab=2", "replace");
  assert.equal(canBack(r), false, "a replaced address shows Back with nowhere to go");
  assert.deepEqual(r.places, ["/a?tab=2"]);
  assert.equal(landing("push", false), "new");
  assert.equal(landing("replace", false), "replace");
  assert.equal(landing("pop", false), "pop");
  assert.equal(landing("load", false), "new", "a page loaded by a link reads as a step through history");
  assert.equal(landing("load", true), "pop", "a page loaded by the head's Back reads as a new place");
  assert.equal(landing(undefined, false), "pop");
  const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /nav\(k === "pushState" \? "push" : "replace"\)/, "the page no longer says how it landed");
  assert.match(proxy, /addEventListener\("popstate", \(\) => \(went \? nav\(went\.how, went\.step\) : nav\("pop"\)\)\);/);
  assert.match(proxy, /addEventListener\("DOMContentLoaded", \(\) => nav\("load"\)\);/);
  assert.match(src("Browser.tsx"), /setTrail\(\(t\) => landed\(t, path, how, step\)\);/);
});

test("A commit asked for from the title menu that nobody takes in time does not open the form later", () => {
  askCommit("late", "push", 1000);
  assert.equal(takeCommit("late", 1000 + ASK_KEPT_MS + 1), undefined, "a greyed-out Commit button opened the form minutes later");
  assert.equal(takeCommit("late", 1000), undefined, "the stale ask was kept after it was dropped");
  askCommit("soon", "pr", 1000);
  assert.equal(takeCommit("soon", 1000 + ASK_KEPT_MS), "pr", "an ask taken as Changes shows was dropped");
});

test("Run on a dev server closes the address list", () => {
  assert.match(src("Browser.tsx"), /onRun=\{\(n, again\) => \(close\(\), void runServer\(n, again\)\)\}/);
});

test("Device's ask card keeps its 460px cap beside the Browser card's look", () => {
  const css = sheet("surfaces.css");
  assert.equal(value(blocks(css, ".lc-dev-ask.lc-br-ask")[0] ?? "", "max-width"), "min(460px, calc(100% - 24px))");
  // Two classes outweigh the Browser card's one, wherever its rule sits in the sheet.
});

test("Changes: a file's path folds it as its chevron does", () => {
  assert.match(src("Review.tsx"), /fold=\{\{ open: !folded, onToggle: \(\) => onFold\(p\.file\.path\) \}\} onOpen=\{\(\) => onFold\(p\.file\.path\)\}>/);
});

test("A surface's Close puts it away, so a page, a Device or an add-on doesn't stay open unseen", () => {
  assert.match(src("Panel.tsx"), /onClose=\{\(\) => onDock\(hideDock\(closeTab\(dock, t\)\)\)\}/);
});

test("Stop it in ⌘K and a row's menu shows while the session's turn waits on you too", () => {
  assert.equal(stopShows({ status: "waiting" }), true, "a session waiting on an approval can't be stopped from ⌘K");
  assert.equal(stopShows({ status: "waiting", held: "review" }), false, "a Reviewer's held work has no turn to stop");
  assert.match(src("App.tsx"), /\.\.\.\(stopShows\(here\) \? \[\{ id: "stop", label: "Stop it"/, "⌘K's Stop it no longer follows the row menu's rule");
});

test("What this session no longer asks about forgets a grant only by the word at its row's end", () => {
  const ask = src("Ask.tsx");
  const rules = ask.slice(ask.indexOf("function Rules("), ask.indexOf("function Ways("));
  assert.doesNotMatch(rules, /<Row[^>]*onPick=\{\(\) => forget/, "a press on the row itself still forgets a grant");
  assert.match(rules, /<GrantRow key=\{`\$\{g\.kind\}:\$\{g\.label\}`\}[^\n]*word="Forget" onForget=\{\(\) => forget\(g\.kind, g\.label\)\} \/>/);
  const row = ask.slice(ask.indexOf("function GrantRow("), ask.indexOf("function Rules("));
  assert.match(row, /<div className="lc-row lc-dask-rule"/, "the grant's row is a button");
  assert.equal((row.match(/<button/g) ?? []).length, 1, "more than the word is a button");
});

test("The title menu has no Multi-agent row, only an Agents row that opens what the Agents key opens; /teamwork and /swarm start a team", () => {
  // Since 8ba917c a team starts only from the message box: no menu row turns one on.
  const session = src("Session.tsx");
  assert.doesNotMatch(session, /title="Start Teamwork"|title="Start Swarm"|"Swarm panel"|"Teamwork panel"|<MultiAgentRow/);
  assert.match(session, /<Row title="Agents" icon=\{<I\.agents size=\{16\} \/>\} onPick=\{\(\) => \(close\(\), openAgents\(thread\.id\)\)\} \/>/);
  assert.match(session, /\/\^\\\/\(teamwork\|swarm\)/, "/teamwork and /swarm no longer start a team");
  assert.doesNotMatch(src("SessionInfo.tsx"), /MultiAgentRow/, "the Session surface has a Multi-agent row again");
});

test("The Session popup's Connections list says it is this session's", () => {
  const info = src("SessionInfo.tsx");
  const conn = info.slice(info.indexOf("function Connections("), info.indexOf("function spanOf("));
  assert.match(conn, /<PanelHead>In this session<\/PanelHead>/);
});

test("Settings: a passed tool check is the green tick, and a picked endpoint model is a pressed plate, not ink", () => {
  const settings = src("Settings.tsx");
  assert.match(settings, /tone=\{busy !== t && c\.state === "passed" \? "ok" : undefined\}/);
  assert.doesNotMatch(settings, /data-kind=\{list\.includes\(m\) \? "ink" : "plain"\}/, "a picked model chip is still ink");
  assert.match(settings, /className="lc-btn lc-st-pick" data-kind="plain" data-size="sm" aria-pressed=\{list\.includes\(m\)\}/);
  assert.equal(value(blocks(sheet("settings.css"), '.lc-btn.lc-st-pick[aria-pressed="true"]')[0] ?? "", "background"), "var(--lc-plate)");
});

test("The picture viewer's Done is ink", () => {
  assert.match(src("Timeline.tsx"), /data-kind="ink" data-size="sm" onClick=\{onClose\}>\s+Done/);
});

test("Words a person reads say message box, not composer", () => {
  assert.match(src("Wall.tsx"), /Your words wait in its message box\./);
  assert.match(src("AddonsPage.tsx"), /"The message box, to put text in for you"/);
  assert.match(src("AddonsPage.tsx"), /"Put text in the message box, for you to send"/);
  assert.match(src("Addon.tsx"), /"can put text in the message box"/);
  assert.match(src("Addon.tsx"), /"put text in the message box for you"/);
  for (const old of ["Your words wait in its composer.", "The composer, to put text in for you", "Put text in the composer, for you to send", "can put text in the composer", "put text in the composer for you"]) assert.ok(!["Wall.tsx", "AddonsPage.tsx", "Addon.tsx"].some((f) => src(f).includes(old)), `"${old}" is still shown`);
});

test("The crew card counts with crewCounts, and Surfaces holds no dead Viewed", () => {
  assert.equal(crewCounts(2, 1), "2 working, 1 finished");
  assert.match(src("Crew.tsx"), /const counts = crewCounts\(working\.length, done\);/);
  const surfaces = src("Surfaces.tsx");
  assert.doesNotMatch(surfaces, /export function Viewed\(/);
  assert.doesNotMatch(surfaces, /Pull request, Linked pull requests, Device/, "the header comment still names Linked pull requests as a surface");
});
