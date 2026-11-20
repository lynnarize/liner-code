/*
  A failed read is said, not shown as empty (plan 017): the docked Changes, Settings' memory and rules
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

test("the docked Changes keeps a failed diff said, as the Review does", () => {
  const changes = span(app("Panel.tsx"), "function Changes(");
  assert.ok(/setDiffErr\(/.test(changes), "the docked Changes keeps no failed state for its diff read");
  assert.ok(changes.includes(`title="The changes didn't open"`), "a failed diff is not said with the Review's own words");
  assert.ok(/setDiffErr\(e instanceof Error \? e\.message : String\(e\)\)/.test(changes), "the failure keeps the engine's words");
  assert.ok(/Reading the changes/.test(changes), "the wait while the diff reads is gone");
});

test("the docked Changes keeps its turn picker when a diff fails, so another turn is one press away", () => {
  // The picker rides in CodeDiff's strip, which a failed diff doesn't draw: the note has to carry it.
  const changes = span(app("Panel.tsx"), "function Changes(");
  const note = span(changes, `title="The changes didn't open"`, "</SurfaceNote>");
  assert.ok(/action=\{picker\}/.test(note), "a failed diff leaves the docked Changes with no turn picker");
});

test("Settings' memory and rules editors say a failed read instead of empty or gone", () => {
  const editors = span(app("Settings.tsx"), "function MemoryEditor(", "function RulesForm(");
  assert.ok(count(editors, /role="alert"/g) >= 2, "both editors say the failure with role=alert");
  assert.ok(count(editors, /Look again/g) >= 2, "both editors offer a Look again retry");
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
  assert.ok(/lc-pr-warn lc-pc-warn/.test(mac), "the Mac tab does not say the scan's failure as the GitHub tab does");
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
