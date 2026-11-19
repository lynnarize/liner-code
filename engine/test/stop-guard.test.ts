/*
  The round button that is Send while you write and Stop while a turn runs (ui.tsx, SendButton): a double-click on Send
  doesn't stop the turn it just sent to, a click on Stop after a moment still stops it, and the keyboard always does.
  Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { STOP_GRACE_MS, stopIgnored } from "../../ui/src/app/stop-guard.ts";

test("a double-click on Send doesn't stop the turn: the second click, landing on the new Stop, is ignored", () => {
  // The first click sends at 1000 and the button becomes Stop at once; the second comes 120 ms later as part of a double-click.
  assert.equal(stopIgnored(1000, 1120, 2), true);
  // A slower second click that the system no longer counts as a double-click, still just after Stop appeared.
  assert.equal(stopIgnored(1000, 1000 + STOP_GRACE_MS - 1, 1), true);
});

test("a single click on Stop after the button has been Stop for a moment stops the turn", () => {
  assert.equal(stopIgnored(1000, 1000 + STOP_GRACE_MS, 1), false);
  assert.equal(stopIgnored(1000, 5000, 1), false);
  assert.equal(stopIgnored(undefined, 5000, 1), false, "no time known: the click stops");
});

test("Stop pressed from the keyboard is never held back, however soon after the button became Stop", () => {
  assert.equal(stopIgnored(1000, 1001, 0), false);
});
