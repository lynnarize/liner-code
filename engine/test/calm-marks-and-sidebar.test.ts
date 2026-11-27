/*
  2026-11-26, after "too much loading/progress animation", the Teamwork card kept over the chat, an agent's heading
  running under the panel's buttons, and a face menu that scrolled sideways: the fixes, read from the source.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../../ui/src/app/${path}`, import.meta.url), "utf8");
const block = (css: string, selector: string) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `no ${selector} block`);
  return css.slice(at, css.indexOf("}", at));
};

test("The header's team and agents chips carry no working mark of their own: the live line and the session's row already move for it", () => {
  const crew = read("Crew.tsx");
  const chip = crew.slice(crew.indexOf("export function CrewChip("), crew.indexOf("export function CrewChip(") + 3200);
  assert.doesNotMatch(chip, /<StateMark/, "a chip still draws a moving mark");
});

test("A panel's heading gives way before its buttons: the quiet words shrink first and end in an ellipsis, with the whole line as their tooltip", () => {
  const css = read("pane.css");
  const words = block(css, ".lc-pane-words");
  assert.match(words, /min-width: 0;/);
  assert.match(words, /overflow: hidden;/);
  assert.match(words, /text-overflow: ellipsis;/);
  assert.match(block(css, ".lc-pane-shows"), /flex: 0 1000 auto;/, "the words don't give way before the name");
  assert.match(block(css, ".lc-pane-name"), /max-width: 60%;/, "a long name can still push the buttons off");
  assert.match(read("Pane.tsx"), /className="lc-pane-words" title=\{typeof children === "string" \? children : undefined\}/, "cut words have no tooltip");
});

test("The Code, Design and Security menu fits the sidebar: an option may not grow its grid column past the menu, which made it scroll sideways", () => {
  assert.match(block(read("app.css"), ".lc-face-opt"), /min-width: 0;/);
});

test("Every face's sidebar draws sessions and designs as Code's row, one line of title with the state at its end, never the wrapped one", () => {
  const security = read("security/Side.tsx");
  for (const key of ["key={`scan:${s.id}`}", "key={`fix:${t.id}`}", "key={`ask:${t.id}`}"]) {
    const row = security.slice(security.indexOf(key), security.indexOf(key) + 300);
    assert.match(row, /\n\s*compact\n/, `${key} isn't in Code's layout`);
    assert.doesNotMatch(row, /\n\s*wrap\n/, `${key} still wraps`);
  }
  const tabs = read("design/Tabs.tsx");
  assert.match(tabs.slice(tabs.indexOf("data-design-tab={k}"), tabs.indexOf("data-design-tab={k}") + 120), /compact/, "an open design's row isn't in Code's layout");
  const home = read("design/DesignHome.tsx");
  assert.match(home, /<SideRow\s+key=\{k\}\s+compact\s+quiet/, "a design in All designs isn't in Code's layout");
});

test("Every list heading finds the same way: a Filter beside the ··· at the heading's end opens the one field, in Code, Design and Security", () => {
  const security = read("security/Side.tsx");
  assert.match(security, /<SideHead title="Sessions"[^>]*onFilter=\{/, "Security's heading has no Filter");
  assert.doesNotMatch(security, /"Find a session"/, "Find is still a row in Security's menu as well");
  assert.match(security, /<PaneField className="lc-sb-filter"/, "Security's field isn't Code's");
  const home = read("design/DesignHome.tsx");
  assert.match(home, /<SideHead title="All designs"[^>]*onFilter=\{/, "All designs has no Filter");
  assert.match(home, /<PaneField className="lc-sb-filter"/, "Design's field isn't Code's");
  assert.doesNotMatch(read("design/design-face.css"), /\.ld-filter\b/, "Design's own field is still styled");
  // Design's rule that stretched every Pop across the list put the heading's ··· right after its name.
  assert.doesNotMatch(read("design/design-face.css"), /\.ld-side \.lc-pop \{/, "every Pop in Design's sidebar is still as wide as the list");
});

/* ---------- "audit all of the UI, make it calmer" (2026-11-26, after Capy: two moving marks per working thread, none in the chat) ---------- */

test("Working in a row of a list stands still, the ring lit and not moving; only a row that is the lone sign of work keeps moving", () => {
  const icons = read("icons.tsx");
  assert.match(icons, /export function StepMark\(\{ state, size = 16, label, tone, live, className \}/);
  assert.match(icons, /live \? "lc-mk-live" : ""/, "live isn't passed to the mark");
  const css = read("app.css");
  // Line and dot (2026-11-27): a row's working step is no box of pixels at all but a still ring with its middle lit.
  assert.match(icons, /if \(state === "working" && live\) return <StateMark state="working"/, "a row's working step is still the moving box");
  assert.doesNotMatch(block(css, '.lc-mk[data-step="now"]'), /animation/, "a row's working mark moves");
  for (const [file, re] of [
    ["Settings.tsx", /<StepMark state="working" size=\{14\} live \/>/],
    ["Ship.tsx", /<StepMark state="working" size=\{14\} live \/>\s*Committing/],
    ["security/ScanSession.tsx", /\{!liveShown && <StepMark state="working" size=\{14\} live \/>\}/],
  ] as const)
    assert.match(read(file), re, `${file}'s lone working row stopped moving`);
  // The plan being written sits over the live line, which moves for the turn.
  assert.match(read("Timeline.tsx"), /function PlanDraft[\s\S]*?<StepMark state="working" size=\{14\} \/>/);
});

test("The header's Reviewer chip keeps its shield while it reads; the chip at the chat's foot is the one that moves", () => {
  const session = read("Session.tsx");
  assert.doesNotMatch(session, /state === "checking" \? <StateMark/, "the header's Reviewer loops beside the chat's own");
});

test("The live line's clock says whole seconds once a second, not tenths ten times a second", () => {
  const timeline = read("Timeline.tsx");
  assert.doesNotMatch(timeline, /every=\{100\}/);
  assert.match(timeline, /const \{ waiting, word, clock: secs \} = liveOf\(marks, turn\);/);
});

test("What enters the chat and the panel fades in short with no blur: blocks, streamed words, cards that ask, the panel, the hover card; Send no longer lifts", () => {
  const css = read("app.css");
  for (const name of ["lc-focus-in", "lc-ask-in", "lc-sbc-in", "lc-panel-in", "lc-chunk-in"]) {
    const kf = css.slice(css.indexOf(`@keyframes ${name} {`), css.indexOf("}\n}", css.indexOf(`@keyframes ${name} {`)));
    assert.ok(kf.length > 0, `no ${name}`);
    assert.doesNotMatch(kf, /blur/, `${name} still blurs`);
  }
  assert.match(block(css, ".lc-blk[data-fresh]"), /animation: lc-focus-in 200ms/);
  assert.match(block(css, ".l-scope .l-chunk"), /animation: lc-chunk-in 180ms/);
  assert.match(css, /\.lc-panel \{\s*min-width: 0;\s*min-height: 0;\s*animation: lc-panel-in 200ms/);
  assert.doesNotMatch(css, /lc-lift/, "Send still lifts each time the box gets words");
});

test("Things that said 'working' twice say it once: no flowing dash under a pull request or a push, still lines while a commit message is written, no fade on the open row's step", () => {
  const css = read("app.css");
  assert.doesNotMatch(css, /lc-ship-flow/, "the line to the base still flows beside the card's moving mark");
  assert.doesNotMatch(read("surfaces.css"), /lc-commit-type/, "the commit message's lines still type themselves beside the mark");
  assert.match(block(css, ".lc-sl-row[data-current] .lc-sl-sub"), /animation: none;/);
  assert.doesNotMatch(read("design/Pictures.tsx"), /ld-pic-making l-shimmer/, "a picture's place shimmers beside the dock's moving row");
});

test("Look again's arrow turns only after its own press, not each time the list is read again in the background", () => {
  for (const file of ["PullRequests.tsx", "Issues.tsx"]) assert.match(read(file), /lookFresh\.current = false;\s*\/\/[^\n]*\n\s*setLooking\(fresh\);/, `${file} spins on every read`);
});

test("Bars and tags that aren't alerts are grey, not the accent", () => {
  const crew = read("crew.css");
  // Line and dot: a running lane is the shared halftone in the working yellow (lc-ht-prog), never the accent.
  assert.doesNotMatch(block(crew, ".lc-cr-bar[data-live]"), /--l-accent|--lc-act/);
  assert.match(read("Crew.tsx"), /<i className="lc-ht lc-ht-fill lc-ht-prog" aria-hidden \/>/, "a running lane takes a colour other than the working yellow");
  assert.doesNotMatch(block(crew, ".lc-cr-bar[data-wait]"), /--l-accent/);
  assert.match(block(read("app.css"), ".lc-queued-tag"), /color: var\(--l-ink-2\);/);
});

test("A sidebar row that is finished and read, or not started, shows no mark, as Capy's; anything that wants you keeps it", () => {
  const css = read("app.css");
  const rule = block(css, '.lc-sl-row[data-compact] .lc-sl-mark:has(> .lc-mk:is([data-s="done"], [data-s="new"]))');
  assert.match(rule, /display: none;/, "a finished row still draws its grey diamond");
  // Only those two: Working, Needs you, finished and not opened, a problem and a pull request's states still show.
  for (const kept of ["working", "needs", "fresh", "problem", "pr", "merged"]) assert.doesNotMatch(rule, new RegExp(`data-s="${kept}"`));
});
