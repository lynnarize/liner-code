/*
  Faults a checker found in the app on 2026-11-27: a scan card holding every shortcut, Design and the Wall acting on keys
  meant for Settings over them, the inspector throwing on a text layer under a lean with families only, the Files tree
  losing the keyboard after a refresh, a team showing old state after a reconnect, an unhandled rejection from the
  wallpaper, a project picture with a space in its name drawn as nothing, and Look again's spinner that never stopped.
  The deciding part is run as a pure function where one could be pulled out; the wiring in the components is read from
  the source as written (precedent: reviewed-faults.test.ts). Run with `node --test engine/test/ui-faults-2026-11-27.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as keys from "../../ui/src/app/menu-keys.ts";
import * as css from "../../ui/src/app/design/inspect/values.ts";
import * as tree from "../../ui/src/app/treeRows.ts";
import { parseLean } from "../src/lean.ts";

const app = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");
/** One region of a file, from its marker to the next marker. */
const span = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `marker not found: ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `end marker not found after "${from}": ${to}`);
  return src.slice(a, b);
};

test("A scan card left open is not a dialog, so the app's shortcuts go on working while it shows", () => {
  const card = /<div className="lst-card"[^>]*>/.exec(app("security/ScanDock.tsx"))?.[0];
  assert.ok(card, "the scan card is not where it was");
  const role = /role="([^"]+)"/.exec(card)?.[1];
  assert.notEqual(role, "dialog", "the scan card says it is a dialog, and hasOpenModal turns every shortcut off while it shows");
  assert.ok(!keys.MODAL.includes(`[role='${role}']`), `MODAL holds the keys for a part with role ${role}`);
  assert.match(card, /aria-label=/, "the scan card lost its name");
  assert.equal(keys.anyModal([]), false);
});

test("Design and the Wall leave a key alone while the Settings sheet is open over them, wherever the focus is", () => {
  const over = (keys as Record<string, unknown>).settingsOver as ((target: unknown, doc: unknown) => boolean) | undefined;
  assert.equal(typeof over, "function", "menu-keys.ts has no guard for keys while Settings is open");
  // The sheet as Settings.tsx draws it: .lc-st-sheet in .lc-st-pop, which says data-closing while it goes.
  const sheet = (s: string, closing = false) => /\.lc-st-sheet$/.test(s) && (!closing || !/\[data-closing\]/.test(s));
  const doc = (open: boolean, closing = false) => ({ querySelector: (s: string) => (open && sheet(s, closing) ? {} : null) });
  const el = (inSheet: boolean) => ({ closest: (s: string) => (inSheet && sheet(s) ? {} : null) });
  assert.equal(over!(el(true), doc(true)), true, "a key pressed inside Settings deletes layers or leaves the Wall");
  assert.equal(over!(null, doc(true)), true, "a key with the focus on the page under Settings deletes layers");
  assert.equal(over!(el(false), doc(true)), true);
  assert.equal(over!(el(false), doc(false)), false, "with Settings shut the canvas and the Wall lose their keys");
  assert.equal(over!(null, doc(false)), false);
  assert.equal(over!(null, doc(true, true)), false, "a sheet on its way out still keeps the canvas's keys from it");
  const face = span(app("design/DesignFace.tsx"), "const onKey = (e: KeyboardEvent) => {", "const s = getDesign();");
  assert.match(face, /settingsOver\(e\.target, document\)/, "the canvas acts on keys meant for Settings");
  const wall = span(app("Wall.tsx"), "const onKey = (e: KeyboardEvent) => {", "const { ids, pick, cols, open, onBack } = live.current;");
  assert.match(wall, /settingsOver\(e\.target, document\)/, "the Wall acts on keys meant for Settings");
  // Settings itself is still left out of MODAL, so ⌘, ⌘N and ⌘K go on working over it.
  assert.match(keys.MODAL, /\[role='dialog'\]:not\(\.lc-st-sheet\)/);
});

test("A text layer under a lean whose type has families only picks no nearest size, and doesn't throw", () => {
  const nearest = (css as Record<string, unknown>).nearestSize as (<T extends { size?: number }>(styles: T[], size: number | undefined) => T | undefined) | undefined;
  assert.equal(typeof nearest, "function", "the inspector has no pure pick of the nearest type style");
  const families = parseLean("## Typography\nHeadings in Fraunces, body in Inter.\n").type;
  assert.ok(families.length > 0 && families.every((s) => s.size === undefined), "parseLean no longer makes family-only styles");
  assert.equal(nearest!(families, 16), undefined);
  assert.equal(nearest!([], 16), undefined);
  const sized = [
    { name: "Body", size: 16 },
    { name: "Fraunces" },
    { name: "Title", size: 32 },
  ];
  assert.equal(nearest!(sized, 16), undefined, "a size that is one of the lean's is off the lean");
  assert.equal(nearest!(sized, 18)?.name, "Body");
  assert.equal(nearest!(sized, 28)?.name, "Title");
  assert.equal(nearest!(sized, undefined), undefined);
  const text = app("design/inspect/Text.tsx");
  assert.match(text, /nearestSize\(styles, size\)/, "Text inside still picks the nearest size by itself");
  assert.doesNotMatch(text, /\.reduce\(/, "Text inside still reduces a list that can be empty");
});

test("The Files tree keeps a row the keyboard can reach after a refresh takes away the focused one", () => {
  const focusOf = (tree as Record<string, unknown>).focusOf as ((rows: tree.TreeRow[], focus: string | undefined) => string | undefined) | undefined;
  assert.equal(typeof focusOf, "function", "treeRows.ts has no focusOf");
  const nodes: tree.TreeNode[] = [{ id: "a", label: "a", children: [{ id: "a/x", label: "x" }] }, { id: "b", label: "b" }];
  const { rows } = tree.treeRows(nodes, new Set(["a"]));
  assert.equal(focusOf!(rows, "a/x"), "a/x");
  assert.equal(focusOf!(rows, "gone"), "a", "a refresh that took away the focused row leaves no row with tabIndex 0");
  assert.equal(focusOf!(rows, undefined), "a");
  assert.equal(focusOf!(tree.treeRows(nodes, new Set()).rows, "a/x"), "a", "a row inside a shut folder holds the focus");
  assert.equal(focusOf!([], "a"), undefined);
  const ft = app("FileTree.tsx");
  assert.match(ft, /const at = focusOf\(rows, focus\);/);
  assert.match(ft, /tabIndex=\{at === n\.id \? 0 : -1\}/, "the rows' tabIndex still follows a focus that may be gone");
  assert.match(ft, /rows\.findIndex\(\(v\) => v\.node\.id === at\)/, "the keys still start from a focus that may be gone");
});

test("ArrowRight on an open folder at the foot of the drawn rows stays put rather than moving to a row not drawn", () => {
  const onKey = span(app("FileTree.tsx"), "const onKey = (e: KeyboardEvent) => {", "const render = ");
  assert.doesNotMatch(onKey, /move\(cur\.node\.children!\[0\]\.id\)/, "ArrowRight moves the focus to a child that may not be drawn");
  assert.match(onKey, /else if \(has && rows\[i \+ 1\]\?\.parent === cur\.node\.id\) move\(rows\[i \+ 1\]\.node\.id\);/);
});

test("A reconnect forgets the teams it held, so a team is fetched afresh rather than shown as it was", () => {
  const hello = span(app("engine.ts"), 'case "hello": {', 'case "project":');
  assert.match(hello, /set\(\{ items: kept, [^\n]*swarms: \{\}/, "the hello snapshot keeps state.swarms, and useSwarm never asks again");
  assert.match(app("engine.ts"), /if \(!threadId \|\| !enabled \|\| cached !== undefined\) return;/);
});

test("A wallpaper picture that failed to load, once replaced, doesn't end in an unhandled rejection", () => {
  assert.match(app("Dots.tsx"), /void old\?\.at\.then\(\(b\) => b\?\.close\(\), \(\) => \{\}\);/);
});

test("A project picture whose path has spaces or quotes is put in as a quoted CSS url", () => {
  const cssUrl = (css as Record<string, unknown>).cssUrl as ((url: string) => string) | undefined;
  assert.equal(typeof cssUrl, "function", "there is no helper that writes a CSS url safely");
  assert.equal(cssUrl!("../Screen Shot 1.png"), 'url("../Screen Shot 1.png")');
  assert.equal(cssUrl!('../a "b".png'), 'url("../a \\"b\\".png")');
  assert.equal(cssUrl!("../a\\b.png"), 'url("../a\\\\b.png")');
  assert.equal(cssUrl!("data:image/png;base64,AAAA"), 'url("data:image/png;base64,AAAA")');
  const pictures = app("design/Pictures.tsx");
  assert.match(pictures, /"background-image": cssUrl\(url\)/);
  assert.doesNotMatch(pictures, /`url\(\$\{url\}\)`/, "a picture is still put in as an unquoted url");
});

test("Look again's spinner stops when its own ask ends, even after the card asked again meanwhile", () => {
  const look = span(app("Env.tsx"), "const look = (again = false) => {", "useEffect(() => look()");
  assert.match(look, /if \(again\) \(spin\.current = n\), setLooking\(true\);/, "the spinner is not tied to the ask that started it");
  assert.match(look, /\.finally\(\(\) => n === spin\.current && setLooking\(false\)\)/, "a newer ask from the card leaves the spinner going for good");
  assert.match(app("Env.tsx"), /const spin = useRef\(0\);/);
});

test("Escape on a scan card in a session opened from the Wall stays with the card rather than going back to the Wall", () => {
  const src = app("App.tsx");
  const at = src.indexOf('setView({ kind: "wall" })');
  assert.ok(at > 0, "the Escape back to the Wall is not where it was");
  const guard = src.slice(Math.max(0, at - 600), at);
  assert.match(guard, /\[role='dialog'\][^"]*\.lst-card/, "the scan card was a dialog and Escape on it stayed with it; as a region it needs naming");
});
