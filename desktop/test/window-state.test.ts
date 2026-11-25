import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterCrash, closeOf, engineStatusDue } from "../src/window-state.ts";

test("the menu-bar item reads the engine itself only once no window's page is alive, never over a quiet page", () => {
  // A window open (or hidden by the close button on a Mac) whose page has said nothing for a minute: its last word stands.
  assert.equal(engineStatusDue([{ destroyed: false }]), false);
  assert.equal(engineStatusDue([{ destroyed: true }, { destroyed: false }]), false);
  // Every window gone: no page is there to say, so the engine is read.
  assert.equal(engineStatusDue([{ destroyed: true }]), true);
  assert.equal(engineStatusDue([]), true);
});

test("a page that keeps going is loaded again three times a minute, then asked about once, not once a crash", () => {
  let gone: number[] = [];
  const steps: string[] = [];
  for (const at of [0, 1000, 2000]) {
    const s = afterCrash(gone, at, false);
    gone = s.gone;
    steps.push(s.then);
  }
  assert.deepEqual(steps, ["reload", "reload", "reload"]);
  const ask = afterCrash(gone, 3000, false);
  assert.equal(ask.then, "ask");
  // While that question is up, more crashes add no dialog over it.
  assert.equal(afterCrash(ask.gone, 4000, true).then, "nothing");
  // A minute later the count starts again.
  assert.equal(afterCrash(ask.gone, 70_000, false).then, "reload");
});

test("closing the last window open keeps the app as one window did, whichever window it is, and any other just closes", () => {
  // A New Window and the first one: the first closed for good, then the second, which was made as a secondary one, was
  // destroyed too on a Mac, leaving no window for the Dock to show; elsewhere it quit with sessions at work, unasked.
  assert.equal(closeOf({ open: 2, quitting: false, mac: true }), "close");
  assert.equal(closeOf({ open: 1, quitting: false, mac: true }), "hide");
  assert.equal(closeOf({ open: 1, quitting: false, mac: false }), "ask");
  assert.equal(closeOf({ open: 1, quitting: true, mac: true }), "close", "a quit closes it for good");
  // main.ts decides with it, by the windows open, never by which one was made first.
  const main = readFileSync(join(import.meta.dirname, "..", "src", "main.ts"), "utf8");
  assert.match(main, /closeOf\(\{ open: windows\.size, quitting, mac: isMac \}\)/);
  assert.doesNotMatch(main, /if \(quitting \|\| secondary \|\| windows\.size > 1\) return;/);
});
