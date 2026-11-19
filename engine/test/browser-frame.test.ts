/*
  How the Browser sizes its frame when a page isn't shown at its own pixels (ui/src/app/browserFrame.ts):
  the page keeps the width it lays out at, the frame fills its box, and it is drawn smaller or
  larger by zoom, never by a transform, so the page inside is asked for the pixels it is shown at.
  What Chromium makes of that zoom is held in desktop/test/browser-zoom.test.ts. Run with
  `node --test engine/test/browser-frame.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { DESKTOP, frameBox } from "../../ui/src/app/browserFrame.ts";

/** How wide and tall the page inside finds its window, for a box of that size. */
const pageSize = (box: ReturnType<typeof frameBox>, width: number, height: number) => {
  const zoom = box.style.zoom ?? 1;
  const w = box.style.width === "100%" ? width / zoom : parseFloat(box.style.width);
  return { w: Math.round(w), h: Math.round(height / zoom), drawn: w * zoom };
};

test("Desktop in a panel narrower than a laptop lays out 1280 wide and is zoomed to the panel, not scaled by a transform", () => {
  const box = frameBox(null, 1, 348);
  assert.equal(box.scale, 348 / DESKTOP);
  assert.deepEqual(box.style, { width: "1280px", height: "100%", zoom: 348 / DESKTOP });
  assert.ok(!("transform" in box.style), "a transform leaves the page thinking it is shown at 1280 by 2523 at 2x");
  const page = pageSize(box, 348, 686);
  assert.equal(page.w, 1280);
  assert.equal(page.h, 2523);
  assert.equal(page.drawn, 348, "the frame is as wide as its box");
});

test("a page at its own pixels has no zoom on its frame at all", () => {
  for (const room of [0, 1280, 1600]) assert.deepEqual(frameBox(null, 1, room), { fit: 1, scale: 1, style: { width: "100%", height: "100%" } }, `Desktop in ${room}`);
  assert.deepEqual(frameBox(390, 1, 600).style, { width: "100%", height: "100%" }, "a phone that fits");
});

test("a phone or tablet wider than the panel keeps its own width and is zoomed to fit, 12px in on each side", () => {
  const box = frameBox(820, 1, 434);
  assert.equal(box.fit, 0.5);
  assert.deepEqual(box.style, { width: "100%", height: "100%", zoom: 0.5 });
  // Its box is the device's width times the fit (Browser.tsx), and the page inside is the device.
  assert.equal(pageSize(box, 820 * box.fit, 600).w, 820);
});

test("the page's own zoom multiplies the fit, and the page lays out 1/zoom as wide", () => {
  const out = frameBox(null, 0.5, 348);
  assert.equal(out.scale, 0.5 * (348 / DESKTOP));
  assert.equal(out.style.width, "2560px");
  assert.equal(pageSize(out, 348, 686).drawn, 348);
  const into = frameBox(null, 1.5, 1500);
  assert.deepEqual(into.style, { width: "100%", height: "100%", zoom: 1.5 });
  assert.equal(pageSize(into, 1500, 900).w, 1000);
  // Zoomed in until Desktop no longer fits: still as wide as the panel.
  const both = frameBox(null, 2, 640);
  assert.equal(both.scale, 1);
  assert.deepEqual(both.style, { width: "640px", height: "100%" });
});
