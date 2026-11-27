/*
  A failed read is said, not shown as empty (plan 017): Changes (Review.tsx, docked or full), Settings' memory and rules
  editors, Usage, Projects' Mac scan, Design Home's list, the by-hand manifest form and Home's notices
  each keep waiting, failed and empty apart. These are SOURCE tests — the faces are component markup,
  so the wiring is read from the file as written (precedent: layout-rules.test.ts).
  Run with `node --test engine/test/said-states.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

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
const count = (src: string, re: RegExp) => (src.match(re) ?? []).length;

test("Changes keeps a failed diff said, in the panel and the full canvas alike", () => {
  // The docked Changes is Review now (Panel.tsx mounts it in both places).
  assert.ok(/<Review thread=\{thread\}/.test(span(app("Panel.tsx"), 'if (t === "changes")', 'if (t === "agents")')), "the docked Changes is not Review, so these checks read the wrong face");
  const changes = span(app("Review.tsx"), "export function Review(", "One file of the diff");
  assert.ok(/setDiffErr\(/.test(changes), "Changes keeps no failed state for its diff read");
  assert.ok(changes.includes(`title="The changes didn't open"`), "a failed diff is not said");
  assert.ok(/setDiffErr\(e instanceof Error \? e\.message : String\(e\)\)/.test(changes), "the failure keeps the engine's words");
  assert.ok(/Reading the changes/.test(changes), "the wait while the diff reads is gone");
});

test("Changes keeps its turn picker when a diff fails, so another turn is one press away", () => {
  // The picker rides in Changes' head (Pane.tsx PaneHead), drawn above whatever the diff's read came to, so a failed one keeps it.
  const changes = span(app("Review.tsx"), "export function Review(", "One file of the diff");
  const head = span(changes, "<PaneHead\n        shows={", '<div className="lc-rv-body">');
  assert.ok(/<TurnPicker /.test(head), "the turn picker is no longer in Changes' head");
  assert.ok(changes.lastIndexOf("<PaneHead\n        shows={") < changes.indexOf("diff === null ?"), "the head is drawn only for some of the diff's states");
});

test("Settings' memory and rules editors say a failed read instead of empty or gone", () => {
  const editors = span(app("Settings.tsx"), "function MemoryEditor(", "function RulesForm(");
  assert.ok(count(editors, /role="alert"/g) >= 2, "both editors say the failure with role=alert");
  // The retry is the one Look again control (ui.tsx LookAgain), as every list's.
  assert.ok(count(editors, /<LookAgain onLook=/g) >= 2, "both editors offer a Look again retry");
  assert.ok(!/\.catch\(\(\) => setFacts\(\[\]\)\)/.test(editors), "memory.list still answers a failure with empty facts");
  assert.ok(!/\.catch\(\(\) => setRules\(null\)\)/.test(editors), "project.rules still answers a failure by vanishing the field");
});

test("Usage says a failed read instead of a confident zero", () => {
  const usage = app("Usage.tsx");
  assert.ok(/const \[failed, setFailed\] = useState<string \| null>\(null\)/.test(usage), "Usage keeps no failed state");
  assert.ok(/role="alert"/.test(usage), "the failure is not said");
  assert.ok(!/\.catch\(\(\) => live && setData\(null\)\)/.test(usage), "a failed usage.summary still reads as no turns");
  assert.ok(/l-shimmer/.test(span(usage, "export function Usage(", "const Tile")), "the first read shows $0 instead of a shimmer");
});

test("Projects' Mac scan keeps its error, as the GitHub tab does", () => {
  const projects = app("Projects.tsx");
  assert.ok(!/rpc\("projects\.scan", \{\}\)\.catch\(\(\) => \[\]\)/.test(projects), "the scan still answers a failure with an empty list");
  const mac = span(projects, '{tab === "mac" &&', '{tab === "github" &&');
  assert.ok(/className="lc-pc-warn"/.test(mac), "the Mac tab does not say the scan's failure as the GitHub tab does");
  assert.ok(/detail/.test(mac), "the Mac tab does not keep the error's words");
  assert.ok(/Look again/.test(mac), "the Mac tab lost its retry");
});

test("Design Home's relist failure is said, not an endless shimmer", () => {
  const home = app("design/DesignHome.tsx");
  const relist = span(home, "function relist()", "/** What hears for the list");
  assert.ok(!/\(\) => \{\},/.test(relist), "relist still swallows the failure");
  assert.ok(/listFailed = e instanceof Error \? e\.message : String\(e\)/.test(relist), "the failure does not keep the engine's words");
  assert.ok(/listFailed = null/.test(relist), "a successful read does not clear the failure");
  const files = span(home, "export function DesignFiles(");
  assert.ok(/role="alert"/.test(files), "the sidebar does not say the failure");
  assert.ok(/Look again/.test(files) && /relist\(\)/.test(files), "no retry that reads the list again");
});

test("the by-hand manifest form says why Add it is grey", () => {
  const hand = span(app("Settings.tsx"), "export function AddByHand(", "/* ---------------------------------- Projects");
  assert.ok(/role="alert"/.test(hand), "the parse failure is not said");
  assert.ok(hand.includes("That isn't JSON yet"), "no words that name the problem");
  assert.ok(/aria-invalid/.test(hand) && /aria-describedby/.test(hand), "the textarea does not carry the failure for a screen reader");
});

test("the by-hand manifest form says a manifest is an object when the JSON is null, a number or a list", () => {
  // JSON.parse("null") succeeds, and reading its id then threw: the line said "That isn't JSON yet: Cannot read properties of null".
  const hand = span(app("Settings.tsx"), "export function AddByHand(", "/* ---------------------------------- Projects");
  const parse = span(hand, "JSON.parse(text)", "}, [text]);");
  assert.ok(hand.includes("A manifest is a JSON object"), "valid JSON that isn't an object is not said as such");
  const check = parse.search(/Array\.isArray\(m\)/);
  assert.ok(check >= 0 && /typeof m !== "object"/.test(parse), "a null, a number or a list is not turned away before its id is read");
  assert.ok(check < parse.indexOf("m.id"), "the id is read before the manifest is known to be an object");
});

test("Home's notices keep a dismissal in every tool state, through toolShown", () => {
  const updates = app("Updates.tsx");
  assert.ok(/import \{ toolShown \} from "\.\/update-notices"/.test(updates), "noticesOf does not read the pure rule");
  assert.ok(/u\.tools\.filter\(\(t\) => toolShown\(t, u\.dismissed\)\)/.test(updates), "the filter does not honour a dismissal in every state");
  assert.ok(!/t\.state === "available" && u\.dismissed\[t\.id\] === t\.latest/.test(updates), "the old available-only filter is still there");
});
test("the by-hand manifest form names a JSON fault in whole words, with where it is, never a phrase cut off mid-way", async () => {
  const { jsonFault } = await import("../../ui/src/app/json-words.ts");
  const fault = (text: string) => {
    try {
      JSON.parse(text);
    } catch (e) {
      return jsonFault((e as Error).message);
    }
    throw new Error(`${text} parsed`);
  };
  assert.equal(fault('{"id" "x"}'), "Expected ':' after property name (line 1, column 7)");
  assert.equal(fault('{"id": "x"'), "Expected ',' or '}' after property value (line 1, column 11)");
  assert.equal(fault('{"id": "x",}'), "Expected double-quoted property name (line 1, column 12)");
  assert.equal(fault("{"), "Expected property name or '}' (line 1, column 2)");
  assert.equal(fault(""), "Unexpected end of JSON input");
  const hand = app("Settings.tsx");
  assert.ok(hand.includes("That isn't JSON yet: ${jsonFault("), "the form does not name the fault through jsonFault");
});

test("one agent at work is said once, by the live line, not also by the card at the chat's end", () => {
  const crew = app("Crew.tsx");
  // The strip over the message box is gone (SPEC rule 6, 2026-11-25): the crew's card at the chat's end took its place.
  assert.ok(!/export function CrewStrip\(/.test(crew), "the strip over the message box is back");
  const card = span(crew, "function CrewCardOf(", "/** A card's head");
  // Exactly one agent while the turn runs: the card is not drawn (the crew chip's rule, two or more).
  assert.match(crew, /const lone = \(thread: Thread, working: Tool\[\]\) => working\.length === 1 && thread\.status === "running";/);
  assert.match(card, /if \(!crew \|\| !working\.length \|\| lone\(thread, working\)\) return null;/, "the card still shows for one agent");
  // Its Stop, same words, at the live line's end.
  const stop = span(crew, "export function LoneStop(", "/* ---------- the Agents surface");
  assert.match(stop, /stopAll\(thread\.id, working\)/);
  assert.match(stop, /stopWord\(working, /);
  assert.match(app("Session.tsx"), /<LiveLine threadId=\{thread\.id\} end=\{<LoneStop thread=\{thread\} \/>\} \/>/, "the session's live line has no Stop for its one agent");
  // The live line's newest step says what that agent is doing, in the trail's words.
  assert.match(app("Timeline.tsx"), /verb=\{`\$\{isSidekick\(agent\) \? "Sidekick" : agentName\(agent\)\} · \$\{agent\.agent\.now\}`\}/, "the newest step doesn't say what the agent is doing");
});

test("a step's mark has the dots only while it runs: finished is a tick, waiting an empty ring, failed a red cross (board Marks, choice B)", () => {
  const icons = app("icons.tsx");
  const step = span(icons, "export function StepMark(");
  // Line and dot: only a live step (the lone sign of work) is the moving box; in a list the step in work is a still ring with its middle lit.
  assert.match(step, /if \(state === "working" && live\) return <StateMark state="working"/, "a live working step isn't the state mark's travelling light");
  assert.match(icons, /const STEP_SHAPE: Record<StepState, "tick" \| "ring" \| "cross" \| "now"> = \{ waiting: "ring", working: "now", done: "tick", skipped: "ring", failed: "cross" \};/);
  assert.match(step, /className=\{`lc-mk \$\{cls\}`\} data-step=\{shape\}/, "the shapes lose the classes the lists place a mark by");
  const css = app("app.css");
  assert.match(css, /\.lc-mk\[data-step="tick"\] \{\s*color: var\(--l-ink-4\);/, "a finished step's tick isn't in the fourth ink");
  assert.match(css, /\.lc-mk\[data-step="cross"\] \{\s*color: var\(--l-danger\);/, "a failed step's cross isn't in the danger colour");
  // Working is three lit pixels travelling round the box, the rest of the box at rest under them (line and dot's 27 November notes), in the progress yellow, whoever's model it is.
  // No holder tints it either (RULING 5): only a mark on a coloured chip takes the chip's white (app.css).
  assert.match(css, /\.lc-mk\[data-s="working"\] \{\s*--mk-loop: 1\.2s;\s*color: var\(--lc-progress\);/, "working isn't in the progress yellow");
  assert.ok(!/\.lc-mk\[data-s="working"\][^{]*data-brand/.test(css), "working is tinted by its model again");
  assert.match(css, /\.lc-mk\[data-s="working"\] > i \{\s*opacity: 0\.22;/, "working's box isn't at rest under its light");
});

test("What moves while something runs is in colour, as Capy's progress marks are: Working and Checks in a yellow of their own, light and dark, apart from Needs you's amber", () => {
  const css = app("app.css");
  const light = /:root \{[\s\S]*?--lc-progress: (oklch\([^)]*\));/.exec(css);
  const dark = /\[data-theme="dark"\] \{[^}]*?--lc-progress: (oklch\([^)]*\));/.exec(css);
  assert.ok(light && dark, "the progress yellow isn't set for both looks");
  for (const state of ["working", "checks"]) assert.match(css, new RegExp(`\\.lc-mk\\[data-s="${state}"\\] \\{\\s*--mk-loop: [\\d.]+s;\\s*color: var\\(--lc-progress\\);`), `${state} is still grey`);
  assert.match(css, /\.lc-mk:is\(\[data-s="needs"\], \[data-s="limit"\]\) \{\s*color: var\(--l-warn\);/, "Needs you lost its amber");
});
