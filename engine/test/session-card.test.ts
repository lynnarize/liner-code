/*
  The session details card as the one place for a session (the owner, 2026-11-27: "session as 1 in pop up rather than 2
  (pop up and right tab)? and context show compact session button", built from the approved drawing): the Session surface
  is gone from the panel, every way into it opens the card, and the card holds what the surface showed: the pull request,
  Context with its Compact, its bar of dots and its sources folding in place, Setup's six, and Look again. The choices are
  run as functions (pinned.ts, dock.ts, surface-row.ts); the rest is read as text, as layout-rules.test.ts reads it.
  Run with `node --test engine/test/session-card.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as dock from "../../ui/src/app/dock.ts";
import { ALWAYS, MENU_ORDER, START_HERE, surfaceRows } from "../../ui/src/app/surface-row.ts";
import { detailsNow, setContextOpen, setSessionPinned, showDetails } from "../../ui/src/app/pinned.ts";

const at = (path: string) => new URL(`../../ui/src/app/${path}`, import.meta.url);
const read = (path: string) => readFileSync(at(path), "utf8");
/** One region of a file, from its marker to the next marker. */
const span = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `marker not found: ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `end marker not found after "${from}": ${to}`);
  return src.slice(a, b);
};
const rule = (css: string, sel: string) => {
  const i = css.indexOf(`\n${sel} {`);
  assert.ok(i >= 0, `no rule ${sel}`);
  return css.slice(i, css.indexOf("\n}", i));
};

test("Session is no surface of the panel anywhere: not in the surfaces, +, More, the start page, the panel's body, nor a kept layout", () => {
  assert.equal(existsSync(at("SessionInfo.tsx")), false, "the Session surface's file is back");
  const surfaces = read("Surfaces.tsx");
  assert.doesNotMatch(surfaces, /id: "session"/, "Session is listed as a surface");
  assert.doesNotMatch(span(surfaces, "export type SurfaceId =", ";"), /"session"/, "Session is a surface's id");
  for (const list of [MENU_ORDER, ALWAYS, [...START_HERE]]) assert.ok(!list.includes("session"), "a + or start page list names Session");
  const rows = surfaceRows(["session", "changes", "files", "browser"], { agents: false, pr: false, canvas: false, device: false, open: ["session"] });
  assert.ok(!rows.top.includes("session") && !rows.more.includes("session"), "+ or More lists Session, even as an open tab");
  const panel = read("Panel.tsx");
  assert.doesNotMatch(panel, /t === "session"|SessionInfo|SessionTab/, "the panel still draws a Session surface");
  // A remembered layout loses its Session tab; one that held nothing else comes back on the start page.
  assert.deepEqual(dock.GONE_TABS, ["session"]);
  assert.equal(dock.isEmptyOpen(dock.readDock({ open: true, full: false, panes: [{ tabs: ["session"], tab: "session" }], at: 0 })!), true);
});

test("Every old way into the Session surface opens the card, wherever the panel stands", () => {
  const session = read("Session.tsx");
  // A surface asked for as "session" (openSurface, an agent), the title's menu, the toggle and the key.
  assert.match(session, /tab === "session" \? showDetails\(\)/, "asking for the Session surface opens a tab");
  assert.match(session, /<Row title="Session details" icon=\{<I\.details size=\{16\} \/>\} onPick=\{\(\) => \(close\(\), showDetails\(\)\)\} \/>/, "the title's Session details doesn't show the card");
  assert.match(session, /const toggleDetails = \(\) => setSessionOpen\(\(o\) => !o\);/);
  assert.match(session, /if \(is\(e, "surface\.session"\)\) return void \(e\.preventDefault\(\), !e\.repeat && toggleDetails\(\)\);/, "⇧⌘I is not the card's toggle");
  assert.doesNotMatch(session, /openTab\(d, "session"\)|onScreen\(d(?:ock)?, "session"\)/, "something still opens the Session tab");
  // ⌘K, notifications and deep links that asked for the Session tab (App.tsx openSession).
  const app = read("App.tsx");
  assert.match(app, /if \(tab === "session"\) showDetails\(\);\s*else if \(tab\) keepDock\(id, openTab\(keptDock\(id\), tab\)\);/, "openSession with the Session tab puts it in the panel");
  assert.match(app, /\{ id: "surface-session", label: "Show session details",[^\n]*shortcut: shortcutOf\("surface\.session"\), onSelect: \(\) => openSession\(here\.id, "session"\) \}/, "⌘K's Show session details doesn't show the card");
  // The message box's ring and "N% of context" open the card with Context unfolded.
  const composer = read("Composer.tsx");
  const under = span(composer, "const under = ", "const ready = Boolean(text");
  assert.match(under, /<button type="button" className="lc-under-u lc-under-b l-focus"[^\n]*onClick=\{\(\) => showDetails\(\{ context: true \}\)\}>\s*<i className="lc-under-ring"[^\n]*\n\s*\{ctxPct\}% of context/, "the ring and its share don't open the card's Context");
  // The keymap still names the key for the card.
  assert.match(read("keymap.ts"), /\["session", "Session", "i"\]/, "the Session key's id went, so a binding of yours stops working");
});

test("showDetails shows the card, and with Context asked for unfolds it and asks the card to bring it into view", () => {
  setSessionPinned(false);
  setContextOpen(false);
  showDetails();
  assert.equal(detailsNow().shown, true, "the card doesn't show");
  assert.equal(detailsNow().context.open, false, "a plain way in unfolds Context");
  const before = detailsNow().context.shown;
  showDetails({ context: true });
  assert.deepEqual([detailsNow().context.open, detailsNow().context.shown], [true, before + 1], "the ring doesn't unfold Context and bring it into view");
});

test("The card shows with the panel open, in the chat's column, and the chat keeps its gutter beside it", () => {
  const session = read("Session.tsx");
  assert.match(session, /const cardShown = sessionOpen;/, "the card hides while the panel is open");
  assert.match(session, /const detailsOn = sessionOpen;/, "the toggle is lit for something other than the card");
  // The card is in the thread's own column (the stage), not the panel's.
  const thread = span(session, '<section ref={threadRef} className="lc-thread"', "</section>");
  assert.match(thread, /<aside className="lc-pin" aria-label="Session details">\s*\{cardShown && project && \(\s*<DetailsCard/, "the card isn't in the chat's column");
  assert.match(read("app.css"), /\.lc-thread:has\(\.lc-pin > \*\) > \* \{\s*--lc-pin-gutter: calc\(var\(--lc-pin-w\) \+ 34px\);/, "the chat lost its gutter rule beside the card");
});

test("The Context row's Compact is the surface's own action, a button of its own that never folds the row, shown only where the tool compacts", () => {
  const parts = read("DetailsParts.tsx");
  const hook = span(parts, "export function useCompact(", "\n}\n");
  assert.match(hook, /rpc\("thread\.send", \{ id: thread\.id, text: "\/compact" \}\)/, "Compact sends something other than /compact");
  assert.match(hook, /toast\("Compacting the conversation", \{ description: "The tool sums up what came before, so the context has room again\." \}\)/, "Compact's words while it runs changed");
  const card = span(parts, "export function CardContext(", "export function CardSetup(");
  const row = span(card, '<div className="lc-dr lc-dc-ctx">', "{ctx && (\n        <div className=\"lc-dc-bar\"");
  const fold = span(row, '<button type="button" className="lc-dr-main', "</button>");
  assert.doesNotMatch(fold, /Compact|compactNow/, "Compact sits inside the button that folds the row");
  assert.match(row, /\{info\?\.compact && \(\s*<button type="button" className="lc-dc-compact l-focus" title=\{compactNote\} disabled=\{running \|\| !ctx \|\| compacting\} onClick=\{compactNow\}>\s*Compact\s*<\/button>/, "Compact is not its own button with the surface's states");
  const css = read("app.css");
  const b = rule(css, ".lc-dc-compact");
  assert.match(b, /height: 22px;/);
  assert.match(b, /font-size: 12px;\s*font-weight: 500;/);
});

test("Pressed, the Context row unfolds in place: X of Y, a row per source with its dot and count, Free, the grey note; folded or not is remembered while the app is open", () => {
  const parts = read("DetailsParts.tsx");
  const card = span(parts, "export function CardContext(", "export function CardSetup(");
  // One choice for every session while the app is open (pinned.ts), not the card's own state, which a session switch drops.
  assert.match(card, /const \{ open, shown \} = useContextOpen\(\);/, "the fold is the card's own state");
  assert.match(card, /const fold = \(\) => setContextOpen\(!open\);/);
  assert.match(card, /<em>\{!ctx \? "Empty" : open \? `\$\{compact\(ctx\.used\)\} of \$\{compact\(ctx\.max\)\}` : `\$\{share\}% used`\}<\/em>/, "the row doesn't say X of Y unfolded");
  assert.match(card, /const life = usePresence\(open, MOTION\.fold\);/, "the fold doesn't keep its rows while it shuts");
  assert.match(card, /<div ref=\{box\} className="lc-dc-ctxw" data-open=\{open \|\| undefined\}>/);
  const inside = span(card, '<div className="lc-fold">', "\n  );\n}");
  assert.match(inside, /sources\.map\(\(s, i\) =>/, "the sources aren't listed");
  assert.match(inside, /<span className="lc-dc-kt">Free<\/span>/, "what is free isn't listed");
  assert.match(inside, /\{note && <p className="lc-dc-note">\{note\}<\/p>\}/, "the note is gone");
  assert.match(card, /As of the last turn\./);
  assert.match(card, /It compacts by itself at \$\{Math\.round\(\(by \/ ctx\.max\) \* 100\)\}%\./, "the note doesn't say when it compacts by itself");
  // A tool that gives only a total shows the one Used row, as the surface did.
  assert.match(card, /\[\{ name: "Used", tokens: ctx\.used, group: "talk" as const \}\]/);
  // Remembered: the choice outlives a card that goes and comes back.
  setContextOpen(true);
  assert.equal(detailsNow().context.open, true);
  setContextOpen(false);
  assert.equal(detailsNow().context.open, false);
  const css = read("app.css");
  assert.match(rule(css, ".lc-dc-k"), /height: 26px;/, "a source's row isn't 26 high");
});

test("The bar of dots sits under the Context row, inset to its words, with the mark where the tool compacts", () => {
  const card = span(read("DetailsParts.tsx"), "export function CardContext(", "export function CardSetup(");
  assert.match(card, /<div className="lc-dc-bar" role="img"[^\n]*>\s*<div className="lc-dotbar"/, "the bar isn't the shared bar of dots");
  assert.match(card, /\{by && <span className="lc-dc-mark" style=\{\{ left: pct\(by\) \}\} aria-hidden \/>\}/, "the auto-compact mark is gone");
  assert.match(rule(read("app.css"), ".lc-dc-bar"), /margin: 1px 8px 7px 30px;/, "the bar isn't inset to the row's words");
});

test("Setup is one row opening a menu to the card's left with the Session surface's six, each with its own handler", () => {
  const parts = read("DetailsParts.tsx");
  const setup = span(parts, "export function CardSetup(", "/** The setup rows");
  assert.match(setup, /<Pop\s+label="Setup"\s+menu\s+side="left"/, "Setup's menu doesn't open to the card's left");
  assert.match(setup, /<em>\{thread\.toolPreset === "lean" \? "Lean" : "Standard"\} preset<\/em>/, "the row doesn't say the preset");
  assert.match(setup, /<Setup thread=\{thread\} \/>/);
  assert.match(setup, /rpc\("settings\.save", \{ keepAwake: on \}\)/, "Keep this Mac awake doesn't save the setting");
  const rows = span(parts, "function Setup(", "function Connections(");
  for (const [title, call] of [
    ["Tool preset", /update\(\{ toolPreset: "lean" \}\)/],
    ["Sidekick context", /update\(\{ sidekickContext: "fork" \}\)/],
    ["Spend limit", /update\(\{ spendLimit: addFive\(thread\.spendLimit, usage\?\.costUsd \?\? 0\) \}\)/],
    ["Workspace memory", /rpc\("memory\.distill", \{ threadId: thread\.id \}\)/],
  ] as const) {
    assert.ok(rows.includes(`<SubMenu title="${title}"`), `Setup has no ${title}`);
    assert.match(rows, call, `${title} doesn't do what it did`);
  }
  // Hidden where the surface hid it: Sidekick context without a sidekick, Connections with none.
  assert.match(rows, /\{thread\.sidekick && \(\s*<SubMenu title="Sidekick context"/);
  const conn = parts.slice(parts.indexOf("function Connections("));
  assert.match(conn, /if \(!all\.length\) return null;/);
  assert.match(conn, /rpc\("thread\.update", \{ id: thread\.id, connectionsOff: next\.length \? next : null \}\)/);
  assert.match(read("Env.tsx"), /<CardSetup thread=\{thread\} \/>/, "the card has no Setup row");
});

test("The card has a Pull request row, its number in grey and its state in its colour as the start page says it, opening the Pull request surface", () => {
  const env = read("Env.tsx");
  const card = span(env, "export function DetailsCard(", "/** A row's state mark");
  assert.match(card, /const pr = thread\.pr && prEnd\(thread\.pr\);/, "the row's state isn't the start page's");
  assert.match(card, /<span className="lc-dr-t">Pull request<\/span>\s*<em className="l-num">#\{thread\.pr\.number\}<\/em>\s*<span className="lc-dr-v" data-tone=\{pr\.tone\}>\s*\{pr\.word\}/);
  assert.match(read("Session.tsx"), /onPr=\{\(\) => setDock\(\(d\) => openTab\(d, "pr"\)\)\}/, "the row doesn't open the Pull request surface");
  assert.match(rule(read("app.css"), '.lc-dr-v[data-tone="ok"]'), /color: var\(--l-ok-text\);/);
});

test("Look again is in the card's Mac list and reads where it runs and the pull request again", () => {
  const env = read("Env.tsx");
  assert.match(env, /\{look && <Row title="Look again"[^\n]*disabled=\{look\.looking\} onPick=\{\(\) => \(close\(\), look\.onLook\(\)\)\} \/>\}/, "the Mac's list has no Look again");
  const card = span(env, "export function DetailsCard(", "/** A row's state mark");
  assert.match(card, /look=\{more === "mac" \? \{ looking, onLook: \(\) => look\(true\) \} : undefined\}/, "the card doesn't hand Look again to its Mac list");
  const look = span(card, "const look = (again = false) =>", "useEffect(() => look()");
  assert.match(look, /rpc\("thread\.info", \{ id: thread\.id \}\)/);
  assert.match(look, /if \(again && thread\.pr\) reads\.push\(rpc\("pr\.status", \{ threadId: thread\.id \}\)/, "Look again doesn't ask how the pull request stands");
});

test("The card says no money, and stays a flat card that scrolls itself", () => {
  const env = read("Env.tsx");
  const card = span(env, "export function DetailsCard(", "/** A row's state mark");
  const parts = read("DetailsParts.tsx");
  const shown = card + span(parts, "export function CardContext(", "/** The setup rows");
  assert.doesNotMatch(shown, /money\(|costUsd|"\$|\$\d/, "the card says what the session costs");
  // The who-leads card went with the drawing: no model, no Lead badge, no "Through" line in the card.
  assert.doesNotMatch(shown, /lc-ss-hero|ModelMark|Works alone|Through \{/, "the surface's who-leads card came into the card");
  const css = read("app.css");
  const box = rule(css, ".lc-dcard");
  assert.match(box, /overflow: hidden auto;/);
  assert.match(box, /box-shadow: 0 0 0 0\.5px var\(--lc-line2\);/);
});
