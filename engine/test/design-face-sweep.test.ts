/*
  Liner Design drawn in the Code panel's frame (the 2026-11-25 sweep): the inspector's head, sections and foot are the
  panel's own parts, one foot shows at a time with its one ink action, a design's row menu has what a session's row
  menu has, and the live picker says what the Browser says. The UI has nothing to run here, so its source is read.
  Run with `node --test engine/test/design-face-sweep.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const app = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");
const span = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `marker not found: ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b >= 0, `marker not found: ${to}`);
  return src.slice(a, b);
};

test("The inspector is drawn in the panel's frame: its head, its sections, its foot and its empty state", () => {
  const insp = app("design/Inspector.tsx");
  assert.match(insp, /<PaneHead /, "the inspector draws its own top row instead of the panel's head");
  assert.doesNotMatch(insp, /lc-stabs|ld-insp-foot/, "the old tab strip or the hand-made foot is still drawn");
  assert.match(app("design/inspect/controls.tsx"), /<PaneSection/, "the inspector's sections don't take the panel's label and inset rule");
  assert.match(app("design/inspect/Empty.tsx"), /<PaneNote /, "the inspector's empty state is not the panel's one");
  assert.doesNotMatch(app("design/ChecksTab.tsx"), /Segmented/, "Checks still splits To fix and Passed with a segmented control");
});

test("Checks' Fix all has the inspector's foot while there is something to fix, and Build's foot gives way to it there", () => {
  const checks = app("design/ChecksTab.tsx");
  assert.match(checks, /render: \(tab: string\) => \(tab === "checks" \? <ChecksFoot \/> : null\)/, "Fix all does not take the foot on Checks");
  assert.match(span(checks, "function ChecksFoot(", "\n}\n"), /if \(!all\.length\) return null;/, "an empty Fix all foot is drawn with nothing to fix");
  const build = span(app("design/BuildTab.tsx"), "function BuildFoot(", "\n}\n");
  assert.match(build, /const fixing = tab === "checks" && toFix\(\)\.length > 0;/, "Build's foot does not know Checks has the foot");
  assert.match(build, /if \(!file \|\| fixing\) return null;/, "Build's ink button still shows beside Fix all, two ink buttons at once");
  // Nothing to send: the words alone, no grey button holding the action's place.
  assert.match(build, /return <PaneFoot say=\{codeAhead \?.*"Every frame is in step"\} \/>;/, "in step, the foot still holds a dead All in step button");
  assert.doesNotMatch(build, /All in step/, "the dead All in step button is back");
});

test("A design's row menu has Stop it while its session works, Rename with F2, and its deletes in red", () => {
  const files = span(app("design/DesignHome.tsx"), "export function DesignFiles(", "\n}\n");
  assert.match(files, /t\?\.status === "running" \? <Row title="Stop it"[^\n]*red[^\n]*thread\.stop/, "Stop it is missing, or shows when nothing runs, or is not red");
  assert.match(files, /<Row title="Rename"[^\n]*end="F2"/, "Rename does not show its key");
  assert.match(files, /e\.key === "F2" \? \(e\.preventDefault\(\), setRenaming\(k\)\)/, "F2 on a design's row does not rename it");
  assert.match(span(files, 'title="Delete"', "onPick"), /\bred\b/, "Delete is not in the danger colour");
});

test("The live picker says what the Browser's server list says, with the ink button last", () => {
  const live = app("design/Live.tsx");
  const picker = span(live, "function Picker(", "\n}\n");
  assert.match(picker, /<PanelHead end=[^>]*>Dev servers<\/PanelHead>/, "the picker does not head its servers as the Browser does");
  assert.match(picker, /"Not running"/, "a stopped server is not said as the Browser says it");
  assert.doesNotMatch(picker, /"stopped"|"starting" :/, "the picker keeps its own words for a server");
  assert.match(picker, /<MenuFoot>Servers come from \.claude\/launch\.json<\/MenuFoot>/, "the grey foot line saying where servers come from is gone");
  // In every ask before a launch.json command runs, Not now comes first and Run it, the ink one, last.
  for (const ask of live.split("Not now</PaneButton>").slice(1)) assert.match(ask.slice(0, 300), /^\s*<PaneButton ink[\s\S]{0,160}?>\s*Run it\s*<\/PaneButton>/, "Run it is not the last button of its ask");
  assert.doesNotMatch(live, /Running" : "Stopped"/, "the server's menu says Stopped where the Browser says Not running");
});
