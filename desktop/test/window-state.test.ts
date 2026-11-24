import test from "node:test";
import assert from "node:assert/strict";
import { afterCrash, engineStatusDue } from "../src/window-state.ts";

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
