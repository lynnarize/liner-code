/*
  When the round button's Stop is pressed by mistake. Send (or Queue, or Steer) clears the field, and with a turn running
  the same button turns into Stop under the pointer, so the second click of a double-click on Send would stop the turn it
  just sent to. A pointer press on Stop that soon after it appeared, or one that is itself part of a double-click, is
  ignored. A keyboard press reaches the button with no click count (detail 0), and Escape doesn't go through the button
  at all, so stopping from the keyboard is never held back. Pure, so the engine's tests read it too
  (engine/test/stop-guard.test.ts).
*/

/** How long after the button becomes Stop a pointer press on it is still taken for the end of a double-click. */
export const STOP_GRACE_MS = 600;

/**
  Whether a press on Stop is ignored: `since` is when the button became Stop, `now` the press, and `detail` the click's
  count (MouseEvent.detail: 0 from the keyboard, 2 or more for the later clicks of a double-click).
*/
export function stopIgnored(since: number | undefined, now: number, detail: number): boolean {
  if (detail === 0) return false;
  if (detail > 1) return true;
  return since !== undefined && now - since < STOP_GRACE_MS;
}
