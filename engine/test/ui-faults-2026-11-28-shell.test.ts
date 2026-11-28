/*
  Faults found in the app's shell on 2026-11-28, in the review before 0.3.3. Where the deciding part could be run on its
  own it is run here; the wiring in the components is read from the source as written (precedent:
  ui-faults-2026-11-27.test.ts). Run with `node --test engine/test/ui-faults-2026-11-28-shell.test.ts`.
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

test("With Settings open over a session, the session's own keys and a project script's keys wait, as they did when Settings was a page", () => {
  // Since Settings became a pop-up (line and dot) the session stays mounted under it, so a key bound "when session"
  // (⌘F, the surface keys) toggled panels and opened the find bar behind the sheet, and a project script's keys ran
  // the script in the session while you typed or recorded keys in Settings.
  const ctx = span(app("keymap.ts"), "function context(e: KeyboardEvent) {", "export function holds(");
  assert.match(ctx, /settingsOver\(/, "keymap's context doesn't know Settings is open over the session");
  assert.match(ctx, /session: !over && /, "a key bound to the session fires under the Settings sheet");
  assert.match(ctx, /review: !over && /, "Changes' find fires under the Settings sheet");
  const scripts = span(app("Session.tsx"), "// A project script with keys of its own runs from them", "runScript(thread.id, x);");
  assert.match(scripts, /settingsOver\(e\.target, document\)/, "a project script's keys run the script under the Settings sheet");
});
