/*
  The panel's head row as line and dot draws it (board Main and board Panel, 2026-11-27), read as text: the surfaces moved
  from icons in the chat's top row to named tabs in the panel's head, so every one of them must still be reachable by
  pointer and by its key; and the session details card, which took the Session surface's Context and Setup, carries two
  rulings of the app's owner, no Cost section and a Context bar of dots. Run with `node --test engine/test/panel-tabs.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Item } from "../../contracts/src/index.ts";
import { changeKey, heldMessage, HELD_KEY } from "../../ui/src/app/commit-held.ts";
import { fadeOf, ICON_TAB, scrollToShow, shortTabs, surfaceRows } from "../../ui/src/app/surface-row.ts";

const read = (path: string) => readFileSync(new URL(`../../ui/src/app/${path}`, import.meta.url), "utf8");
const rule = (css: string, sel: string) => {
  const at = css.indexOf(`\n${sel} {`);
  assert.ok(at >= 0, `no rule ${sel}`);
  return css.slice(at, css.indexOf("\n}", at));
};

test("The details card's Context and Setup (the Session surface's, before it went) have no Cost section and say no money: no From cache row, no amounts, no cost", () => {
  const info = read("DetailsParts.tsx");
  assert.doesNotMatch(info, /From cache/, "the Cost section's From cache row is back");
  assert.doesNotMatch(info, /\bmoney\(/, "the card shows an amount of money");
  assert.doesNotMatch(info, /costUsd \?\? 0\)\}|cost=\{|\bCost\b/, "the card reads out what the session cost");
  // The spend limit stays a setting (nothing is lost), but its row says whether one is set, not how many dollars.
  assert.match(info, /value=\{thread\.spendLimit \? "Set" : "None"\}/, "the Spend limit row's value is an amount again");
});

test("The details card's Context bar is rows of round dots, one colour per source, with a round dot in its key", () => {
  const info = read("DetailsParts.tsx");
  const card = info.slice(info.indexOf("export function CardContext("), info.indexOf("export function CardSetup("));
  assert.match(card, /<div className="lc-dotbar"/, "the Context bar is not the bar of dots");
  assert.match(card, /"--lc-dotbar-c": GROUP_COLOUR\[s\.group\]/, "a source's part of the bar has no colour of its own");
  assert.match(card, /className="lc-dc-k" title=[^\n]*\n\s*<i style=\{\{ background: GROUP_COLOUR\[s\.group\] \}\} aria-hidden \/>/, "a source's row has no dot in its colour");
  assert.equal(new Set(Object.values(eval(`(${/const GROUP_COLOUR[^=]*= (\{[^}]*\})/.exec(info)?.[1] ?? "{}"})`) as Record<string, string>)).size, 7, "two sources share a colour");
  assert.match(rule(read("app.css"), ".lc-dc-k > i"), /border-radius: 999px;/, "the key's dots are not round");
  const dots = rule(read("halftone.css"), ".lc-dotbar");
  assert.match(dots, /mask: radial-gradient\(circle,/, "the bar is not cut into round dots");
});

test("The panel's head row names the open surfaces as tabs, then +, Fill the window and Hide the panel, with a hairline under it", () => {
  const panel = read("Panel.tsx");
  assert.match(panel, /<aside ref=\{box\} className="lc-panel"[^>]*>\s*<PanelTabs /, "the panel doesn't start with its head row");
  const sw = read("Switcher.tsx");
  const tabs = sw.slice(sw.indexOf("export function PanelTabs("), sw.indexOf("/** The surfaces + lists"));
  assert.match(tabs, /role="tab" className="lc-ptab-b l-focus" aria-selected=\{on\}/);
  assert.match(tabs, /<SurfaceMenu /, "the head row has no +");
  assert.match(tabs, /"Fill the window"[\s\S]*?aria-label="Hide the panel"/, "the head row doesn't end in Fill the window and Hide the panel");
  const css = read("dock.css");
  assert.match(rule(css, ".lc-ptabs"), /height: var\(--lc-head\);[\s\S]*border-bottom: 0\.5px solid var\(--lc-hair\);/, "the head row is not on the top row's line with a hairline under it");
  assert.match(rule(css, ".lc-ptab"), /height: 26px;/);
  assert.match(rule(css, ".lc-ptab-b"), /font-size: 12\.5px;\s*font-weight: 500;/);
  // The chat's top row keeps only its three toggles: no icon there opens a surface any more.
  assert.doesNotMatch(read("Session.tsx"), /<Switcher\b/, "the top row still has the row of surface icons");
});

test("Every surface stays reachable: + lists each one with its key (at most under More), the Terminal has its toggle and New terminal, and each key still works", () => {
  const surfaces = read("Surfaces.tsx");
  const ids = [...surfaces.matchAll(/\{ id: "(\w+)", label: "[^"]+", key: "\w"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 11, "the surfaces could not be read");
  // The Terminal lives in the bottom panel (its toggle, + 's New terminal); Linked pull requests is Pull request's picker;
  // Side chat is + 's New side chat row. Every other surface is in + 's list or its More, in a session with nothing at all.
  const none = { agents: false, pr: false, canvas: false, device: false, open: [] };
  const { top, more } = surfaceRows(ids, none);
  for (const id of ids.filter((x) => x !== "terminal" && x !== "linked" && x !== "side")) assert.ok(top.includes(id) || more.includes(id), `+ doesn't reach ${id}`);
  const sw = read("Switcher.tsx");
  assert.match(sw, /\{more\.map\(surface\)\}/, "More doesn't list what + leaves out");
  assert.match(sw, /end=\{keys\(`surface\.\$\{id\}`\)\}/, "+ doesn't show each surface's key");
  // + and the start page press through one runPick (surface-row.ts RowPick), so the opening itself is written once.
  assert.match(sw, /title="New side chat"[^\n]*end=\{keys\("surface\.side"\)\}[^\n]*run\(pickOf\("side"\)\)/, "+ has no New side chat with Side chat's key");
  assert.match(sw, /if \(pick\.kind === "side"\) return onDock\(openTab\(dock, "side"\)\);/, "New side chat doesn't open the side chat");
  assert.match(sw, /title="New terminal"[^\n]*onPick=\{onTerminal\}/, "+ has no New terminal");
  assert.match(sw, /<Shells thread=\{thread\} onTerminal=\{\(\) => run\(pickOf\("terminal"\)\)\} \/>/, "+'s New terminal doesn't press through runPick");
  assert.match(sw, /if \(pick\.kind === "terminal"\) return \(runScript\(thread\.id, \{ name: "Shell", command: "" \}\), onBelow\(true\)\);/, "New terminal doesn't open a shell below");
  assert.doesNotMatch(sw, /"Show the terminal" \/>|title=\{below \? "Hide the terminal"/, "+ still has a Show the terminal row: the top row's toggle does that");
  assert.match(sw, /aria-label=\{below \? "Hide the terminal" : "Show the terminal"\}/, "the top row has no terminal toggle");
  const session = read("Session.tsx");
  assert.match(session, /const s = SURFACES\.find\(\(x\) => is\(e, `surface\.\$\{x\.id\}`\)\);/, "the surfaces' keys are no longer read");
  assert.match(session, /else if \(!e\.repeat\) setDock\(\(d\) => toggleTab\(d, s\.id\)\);/, "a surface's key no longer shows or hides it");
  // An empty script is a plain shell, so New terminal opens one.
  assert.match(read("Terminal.tsx"), /command: x\.command \|\| undefined/);
});

test("The session's top row has no branch chip: the branch and its lines are in the details card and the commit tab", () => {
  const session = read("Session.tsx");
  assert.doesNotMatch(session, /BranchChip/, "the top row draws a branch chip");
  assert.doesNotMatch(read("Env.tsx"), /export function BranchChip\(/);
  assert.doesNotMatch(read("app.css"), /\.lc-bchip/);
  // The branch is still a press away: the details card's branch row opens its list.
  assert.match(read("Env.tsx"), /panel\("branch", "Branch"\)/);
});

test("The Agents surface says no money: no Cost or From cache rows, no cost share, and its note speaks of tokens alone", () => {
  const crew = read("Crew.tsx");
  const use = crew.slice(crew.indexOf("function SessionUse("), crew.indexOf("/* ---------- Liner-native Swarm"));
  assert.doesNotMatch(use, />Cost<\/PaneRow>|>From cache<\/PaneRow>|as="money"/, "This session shows what the session cost again");
  assert.doesNotMatch(crew, /Tokens and cost are as each tool reported them|Cost is an estimate from list prices/, "the note under Use by model speaks of cost");
  assert.doesNotMatch(crew, /of \{cost \? "cost" : "tokens"\}/, "Use by model shows a share of cost");
  // Its lanes are thin bars: a finished part flat, the part still running the shared halftone fill.
  assert.match(crew, /\{l\.live && <i className="lc-ht lc-ht-fill lc-ht-prog" aria-hidden \/>\}/);
  assert.match(rule(read("crew.css"), ".lc-cr-track"), /height: 6px;/);
});

test("The commit tab shows, dim, only the message the commit form kept for these very changes, first line only, and asks for none", () => {
  // Run it: a store the form wrote, then the same changes, changed ones, and none kept.
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const cp = (id: string, added: number) => ({ kind: "checkpoint", id, turn: 1, at: 1, to: "abc", files: [{ path: "src/tides.js", added, removed: 1 }] }) as unknown as Item;
  const now = [cp("c1", 3)];
  store.set(HELD_KEY, JSON.stringify({ t: { key: changeKey(now, 1), message: "Wrap the last tide to tomorrow\n\nTimes were compared as strings.", by: null } }));
  assert.equal(heldMessage("t", now, 1), "Wrap the last tide to tomorrow", "the held message isn't shown, or more than its first line is");
  assert.equal(heldMessage("t", [cp("c1", 4)], 1), undefined, "a message written for other changes is shown");
  assert.equal(heldMessage("t", [...now, cp("c2", 1)], 1), undefined, "a message written before the last turn's changes is shown");
  assert.equal(heldMessage("other", now, 1), undefined, "another session's message is shown");
  store.clear();
  assert.equal(heldMessage("t", now, 1), undefined);
  // The form keeps its message under the same key the tab reads, and nothing on the tab's way asks for a message.
  const commit = read("Commit.tsx");
  assert.match(commit, /const SAVED = HELD_KEY;/, "the form keeps its message where the tab doesn't look");
  assert.match(commit, /const key = items \? changeKey\(items, files\) : null;/, "the form keeps its message under another change-set key than the tab reads");
  assert.doesNotMatch(read("commit-held.ts"), /rpc\(|git\.message|fetch\(/, "the held message is asked for");
  const session = read("Session.tsx");
  assert.match(session, /held=\{heldMessage\(thread\.id, cps, openFiles\)\}/, "the tab isn't handed the held message");
  const tab = session.slice(session.indexOf("function ToCommit("), session.indexOf("\n}\n", session.indexOf("function ToCommit(")));
  assert.doesNotMatch(tab, /rpc\(|git\.message|fetch\(/, "the commit tab asks for its message");
  assert.match(tab, /\{held && \(\s*<span className="lc-trow-dim"/, "the tab doesn't show the held message, or shows an empty line without one");
  assert.match(tab, /<I\.commit size=\{16\} \/>/, "the tab's icon is not the commit glyph");
});

test("Many tabs: +, Fill and Hide never move; names drop to icons from the far end, the open tab's last; the open tab scrolls whole into view", () => {
  // Names go first, from the far end inwards, never the open tab's, and only as many as the room needs.
  const tabs = ["changes", "files", "browser", "session", "agents"];
  const full = { changes: 100, files: 70, browser: 90, session: 90, agents: 80 };
  const all = 100 + 70 + 90 + 90 + 80 + 2 * 4;
  assert.deepEqual([...shortTabs(tabs, "changes", full, all)], [], "a row that fits drops a name");
  assert.deepEqual([...shortTabs(tabs, "changes", full, all - 10)], ["agents"], "the far end doesn't give way first");
  assert.deepEqual([...shortTabs(tabs, "agents", full, all - 10)], ["session"], "the open tab drops its name");
  const tight = shortTabs(tabs, "browser", full, 5 * ICON_TAB);
  assert.ok(!tight.has("browser") && tight.size === 4, "with no room the open tab still keeps its name, every other drops its");
  // Past that the row scrolls, and the open tab is brought whole into view, at the nearer edge.
  assert.equal(scrollToShow(300, 80, 0, 320), 60, "a tab past the right edge is not brought into view");
  assert.equal(scrollToShow(20, 80, 150, 320), 20, "a tab cut at the left edge is not brought into view");
  assert.equal(scrollToShow(100, 80, 50, 320), 50, "a tab already in view moves the row");
  assert.deepEqual([fadeOf(0, 600, 300), fadeOf(150, 600, 300), fadeOf(300, 600, 300), fadeOf(0, 300, 300)], ["end", "both", "start", undefined]);
  // In the component: + sits outside the scrolling list, and the controls that never move never shrink.
  const sw = read("Switcher.tsx");
  const tabsRow = sw.slice(sw.indexOf("export function PanelTabs("), sw.indexOf("/** The surfaces + lists"));
  const listEnd = tabsRow.indexOf("</div>", tabsRow.indexOf('className="lc-ptabs-list"'));
  assert.ok(tabsRow.indexOf("<SurfaceMenu ") > listEnd, "+ scrolls away with the tabs");
  assert.match(tabsRow, /el\.scrollLeft = scrollToShow\(tab\.offsetLeft, tab\.offsetWidth, el\.scrollLeft, el\.clientWidth\);[\s\S]*?\}, \[shown, key, short\]\);/, "the open tab isn't scrolled into view when it changes");
  assert.match(tabsRow, /const iconOnly = short\.has\(t\) && !on;/, "the open tab can lose its name");
  const css = read("dock.css");
  assert.match(css, /\.lc-ptabs > :not\(\.lc-ptabs-list, \.lc-grow\) \{\s*flex: none;/, "+, Fill and Hide can be squeezed");
  assert.match(css, /\.lc-ptabs-list\[data-fade="both"\] \{[^}]*mask-image: linear-gradient\(to right, #0000 0, #000 28px/, "the scrolled row has no fade");
});

test("Changes' file strips meet on one rule: none doubled between strips, none under the bar's own", () => {
  const pane = read("pane.css");
  const strip = rule(pane, ".lc-pane-file");
  assert.match(strip, /border-bottom: 0\.5px solid var\(--lc-hair\);/);
  assert.doesNotMatch(strip, /border-top/, "a strip has a rule over it too, so two strips meet on a doubled band");
  const surfaces = read("surfaces.css");
  // After a file's lines the next strip has a rule over it; after a folded file (its own rule already there) it doesn't.
  assert.match(surfaces, /\.lc-rv-file:has\(> \.lc-rv-fh\[data-open\]\) \+ \.lc-rv-file > \.lc-rv-fh \{\s*border-top: 0\.5px solid var\(--lc-hair\);/);
  assert.doesNotMatch(surfaces, /\.lc-rv-file:not\(:first-child\) > \.lc-rv-fh \{[^}]*border-top/, "every strip after the first gets a rule over it, folded or not");
});

test("While Changes shows, the commit tab over the message box steps aside and Changes offers the white Commit in every view of it", () => {
  const session = read("Session.tsx");
  assert.match(session, /\{openFiles > 0 && !\(dock\.open && dock\.panes\[dock\.at\]\?\.tab === "changes"\) && <ToCommit /, "the tab no longer steps aside for Changes");
  const review = read("Review.tsx");
  // The working tree's own view (no turn made a change) has its foot with Commit.
  const wt = review.slice(review.indexOf("const wtFiles = wtStatus?.changes ?? [];"), review.indexOf("<SurfaceNote icon={<I.changes size={20} />} title=\"No changes yet\">"));
  assert.match(wt, /<PaneFoot [^>]*>\s*<CommitButton thread=\{thread\} files=\{wtFiles\.length\}/, "the working tree's view has no Commit");
  // The turns' view commits what is open, else what the working tree holds (every turn committed or undone): never Push
  // while the tab counts files to commit.
  assert.match(review, /const toCommit = openFiles \|\| \(turnsOpen \? 0 : \(wtStatus\?\.changes\.length \?\? 0\)\);/);
  assert.match(review, /\{toCommit > 0 \? <CommitButton thread=\{thread\} files=\{toCommit\}/, "the turns' view offers Push while there are files to commit");
  assert.match(review, /if \(!project\?\.git \|\| turnsOpen\) return;/, "the working tree isn't read once every turn is committed");
  assert.match(read("Commit.tsx"), /triggerClass="lc-pane-btn" triggerAttrs=\{\{ "data-ink": true \}\}/, "Commit isn't the white button");
});

test("Changes opens at the panel's 500 like every surface, until you drag it", () => {
  const session = read("Session.tsx");
  assert.match(session, /const PANEL_DEFAULT_W = 500;/);
  assert.match(session, /Math\.min\(changesW \?\? panelW \?\? PANEL_DEFAULT_W, /, "Changes has a wider default of its own again");
  assert.doesNotMatch(session, /bodyW \/ 2/, "Changes opens at half the body again");
});

test("Inside the panel a surface's own head is a 40px bar under the tabs, and draws nothing when it has nothing to show", () => {
  const pane = read("Pane.tsx");
  assert.match(pane, /if \(!lead && !own && !shows && !tools\) return null;/, "an empty bar still takes 40px");
  assert.match(pane, /className="lc-pane-head lc-pane-bar"/);
  assert.match(rule(read("pane.css"), ".lc-pane-head.lc-pane-bar"), /height: 40px;/);
  assert.doesNotMatch(pane, /own === 0 && <HeadRow/, "the frame still draws a head of its own over the tabs");
});

test("The commit row over the message box counts only this session's own changes, never files the project held before it or someone else changed", () => {
  const session = read("Session.tsx");
  const top = session.slice(session.indexOf("{asking && <AskDock dock={asking} />}"), session.indexOf("</>", session.indexOf("{asking && <AskDock dock={asking} />}")));
  assert.match(top, /<ToCommit files=\{openFiles\} lines=\{lines\}/, "the row doesn't count the session's own files and lines");
  // The working tree's count (git status) is any change in the project: untracked folders kept on purpose put the row
  // over every session's message box, a new one included, with nothing for its agent to commit.
  assert.doesNotMatch(top, /wtChanges/, "the row shows for changes in the project that this session's turns never made");
  // Changes' badge and its own view still count the whole working tree, so those files stay one click away.
  assert.match(session, /counts=\{\{ changes: openFiles \|\| wtChanges \|\| undefined \}\}/, "the Changes badge no longer counts the working tree");
});
