/*
  Faults a review of the app's UI before 0.3.1 found, each held where it was fixed: the deciding part as a pure function
  where one could be pulled out, and the wiring read from the files as written where it is component markup (precedent:
  reviewed-faults.test.ts). Run with `node --test engine/test/release-ui-review.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const app = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");
/** One region of a file, from its marker to the next marker. */
const span = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `marker not found: ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `end marker not found after "${from}": ${to}`);
  return src.slice(a, b);
};

test("A design's Remove asks through the confirm row, so a double-click on Remove can't remove it", () => {
  const files = span(app("design/DesignHome.tsx"), "export function DesignFiles(", "\n}\n");
  assert.ok(!/if \(!sure\) return setSure\(true\)/.test(files), "Remove still keeps its own ask, which the second click of a double-click confirms at once");
  assert.ok(/<ConfirmRow\s+key=\{mk\}\s+title="Remove"\s+sure="Remove it"/.test(files), "Remove is not the confirm row keyed by the design");
  assert.ok(/onConfirm=\{\(\) => \{\s+close\(\);\s+void rpc\("design\.remove"/.test(files), "the confirm row doesn't remove the design");
});

test("A project's Remove in Settings, which deletes every session in it, ignores the second click of a double-click", () => {
  const projects = span(app("Settings.tsx"), "function Projects() {", "function MemoryEditor(");
  assert.ok(/confirmPress\(sure\?\.id === p\.id \? sure\.at : null, now\)/.test(projects), "the project's Remove doesn't hold back a double-click's second click");
  assert.ok(!/if \(sure !== p\.id\) return setSure\(p\.id\)/.test(projects), "the project's Remove still confirms on any second press");
  assert.match(app("Settings.tsx"), /import \{ confirmPress \} from "\.\/confirm";/);
});
