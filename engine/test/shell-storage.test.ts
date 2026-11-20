/*
  A storage-less window keeps working (plan 019, steps 2-4): the app shell, Settings, the docked Changes and Device
  read and write their keeps through kept.ts, validated, with no bare storage call left. These are SOURCE tests —
  the wiring is read from the files as written (precedent: layout-rules.test.ts, said-states.test.ts).
  Run with `node --test engine/test/shell-storage.test.ts`.
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

test("the app shell's storage reads and writes are guarded", () => {
  const shell = app("App.tsx");
  assert.ok(/from "\.\/kept\.ts"/.test(shell), "the shell does not take the shared kept-storage helper");
  assert.ok(/keptRead(?:<[^>]+>)?\(/.test(shell) && /wordRead\(/.test(shell), "the shell's reads do not go through the helper");
  assert.ok(!/localStorage\.getItem\(/.test(shell), "a bare localStorage read remains in the shell");
  assert.ok(!/sessionStorage\.getItem\(/.test(shell), "a bare sessionStorage read remains in the shell");
  assert.ok(!/\.setItem\(/.test(shell), "a bare storage write remains in the shell");
});

test("a kept view is trusted only for a kind the View type names", () => {
  const shell = app("App.tsx");
  const type = span(shell, "type View = ", "\n");
  const kinds = [...type.matchAll(/kind: "([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(kinds.length >= 9, "the View type's kinds could not be read");
  const guard = span(shell, "const VIEW_KINDS", "const readView");
  for (const k of kinds) assert.ok(guard.includes(`"${k}"`), `the view guard does not know the kind "${k}"`);
  const read = span(shell, "const readView", "\n\n");
  assert.ok(/keptRead/.test(read) && read.includes('"lc:view"') && read.includes('{ kind: "home" }'), "the view read does not fall back to Home through the helper");
});

test("Settings' preference reads validate their values and guard storage", () => {
  const settings = app("Settings.tsx");
  assert.ok(/wordRead\(/.test(settings), "Settings' reads do not go through the helper");
  assert.ok(!/localStorage\.getItem\("lc:enter"\)/.test(settings), "the lc:enter read is still a bare cast into the union");
  assert.ok(/wordRead\(localStorage, "lc:enter", \["queue", "steer"\], "queue"\)/.test(settings), "the lc:enter read does not validate against the known words");
  // The page read lists the SettingsPage union's own values, not a cast of whatever is stored.
  const type = span(settings, "type SettingsPage = ", ";");
  const pages = [...type.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(pages.length >= 15, "the SettingsPage union's values could not be read");
  const pageRead = span(settings, "const [page, setPage]", "const [query");
  for (const p of pages) assert.ok(pageRead.includes(`"${p}"`), `the lc:settings read does not know the page "${p}"`);
  assert.ok(!/localStorage\.getItem\(/.test(settings) && !/sessionStorage\.getItem\(/.test(settings) && !/\.setItem\(/.test(settings), "a bare storage call remains in Settings");
});

test("the docked Changes' view choice is a known word, read and written guarded", () => {
  const changes = span(app("Panel.tsx"), "function Changes(");
  assert.ok(/wordRead\(localStorage, "lc:view", \["unified", "split"\], "unified"\)/.test(changes), "the view read is still a bare cast");
  assert.ok(/wordWrite\(localStorage, "lc:view", view\)/.test(changes), "the view write is still bare");
  assert.ok(!/localStorage\.getItem\(/.test(changes) && !/\.setItem\(/.test(changes), "a bare storage call remains in the docked Changes");
});

test("Device's remembered simulator is read and written guarded", () => {
  const device = app("Device.tsx");
  assert.ok(/textRead\(localStorage, "lc:device", null\)/.test(device), "the udid read is still bare");
  assert.ok(/wordWrite\(localStorage, "lc:device", udid\)/.test(device), "the udid write is still bare");
  assert.ok(!/localStorage\.getItem\(/.test(device) && !/\.setItem\(/.test(device), "a bare storage call remains in Device");
});
test("the composer's Enter choice is a known word, read guarded, so a storage-less window still opens a session", () => {
  const composer = app("Composer.tsx");
  assert.ok(/wordRead\(localStorage, "lc:enter", \["queue", "steer"\], "queue"\)/.test(composer), "the composer's lc:enter read is still a bare cast that throws without storage");
  assert.ok(!/localStorage\.getItem\("lc:enter"\)/.test(composer), "a bare lc:enter read remains in the composer");
});

test("the Wall's filter is read and written guarded, so a storage-less window still opens the Wall", () => {
  const wall = app("Wall.tsx");
  assert.ok(/wordRead\(sessionStorage, "lc:wall-filter", \["all", "needs", "working", "done"\], "all"\)/.test(wall), "the Wall's filter read is still bare");
  assert.ok(/wordWrite\(sessionStorage, "lc:wall-filter", filter\)/.test(wall), "the Wall's filter write is still bare");
  assert.ok(!/sessionStorage\.getItem\(/.test(wall) && !/\.setItem\(/.test(wall), "a bare storage call remains in the Wall");
});
