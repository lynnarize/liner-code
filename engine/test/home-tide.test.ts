/*
  2026-11-28, after "instead of the orange side wallpaper, make it animate beautifully but lightweight": the
  halftone in Home's top right corner is drawn live by a small WebGL shader (ui/src/app/homeTide.ts), and it has to
  stay cheap and fall back to the still CSS one.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TIDE_ALPHA, TIDE_CELL, TIDE_FRAME_MS, TIDE_SHADER, TIDE_STEP_MAX, ease, tideGap } from "../../ui/src/app/tide.ts";

const read = (path: string) => readFileSync(new URL(`../../ui/src/app/${path}`, import.meta.url), "utf8");

test("The tide draws no frame while the window is hidden or not the one in use, while Home is out of sight, or under Reduce motion", () => {
  const base = { hidden: false, seen: true, reduced: false, focused: true, touched: false };
  assert.equal(tideGap({ ...base, hidden: true }), null);
  assert.equal(tideGap({ ...base, seen: false }), null);
  assert.equal(tideGap({ ...base, reduced: true }), null);
  assert.equal(tideGap({ ...base, focused: false }), null);
  assert.equal(tideGap({ ...base, focused: false, touched: true }), null);
});

test("The tide drifts at 20 frames a second and only goes to 30 while the pointer swells it", () => {
  const base = { hidden: false, seen: true, reduced: false, focused: true };
  assert.ok(tideGap({ ...base, touched: false })! >= 1000 / 20 - 0.01);
  assert.ok(tideGap({ ...base, touched: true })! >= 1000 / 30 - 0.01);
  assert.ok(TIDE_FRAME_MS.drift > TIDE_FRAME_MS.touch);
});

test("After a pause the tide carries on from where it was: its clock steps a tenth of a second at most", () => {
  assert.ok(TIDE_STEP_MAX <= 0.1);
  const tide = readFileSync(new URL("../../ui/src/app/homeTide.ts", import.meta.url), "utf8");
  assert.match(tide, /Math\.min\(TIDE_STEP_MAX, Math\.max\(0, now - last\) \/ 1000\)/);
  assert.match(tide, /gl\.uniform1f\(uTime, still \? 40 : clock\);/, "the shader's time is the wall clock again, which jumps after a pause");
});

test("The pointer's swell eases the same way at any frame rate", () => {
  // One step of a second against thirty of a thirtieth land in the same place.
  let v = 0;
  for (let k = 0; k < 30; k++) v = ease(v, 1, 1 / 30, 3);
  assert.ok(Math.abs(v - ease(0, 1, 1, 3)) < 1e-9);
});

test("The live halftone keeps the still one's grid and strength, and never reaches the canvas's own edges", () => {
  assert.equal(TIDE_CELL, 6, "the CSS halftone's .lc-ht-big grid");
  assert.equal(TIDE_ALPHA, 0.22, "the CSS halftone's .lc-ht-faint");
  assert.match(TIDE_SHADER, /v \*= 1\.0 - smoothstep\(0\.78, 1\.0, d\);/, "the drift could carry dots to the canvas's straight edge");
});

test("Home falls back to the still CSS halftone when WebGL can't be had or its context is lost", () => {
  const sea = read("Sea.tsx");
  const tide = sea.slice(sea.indexOf("function Tide()"), sea.indexOf("function Tide()") + 800);
  assert.match(tide, /startTide\(ref\.current!, ref\.current!\.parentElement!, onWater, \(\) => setStill\(true\)\)/);
  assert.match(tide, /if \(!tide\) return setStill\(true\);/);
  assert.match(tide, /<i className="lc-ht lc-ht-corner lc-ht-big lc-ht-faint lc-home-ht" aria-hidden \/>/);
  assert.match(sea, /home === "none" && !open && <Tide \/>/);
});

test("Stopping the tide leaves its WebGL context alone, so the same canvas started again draws instead of falling back", () => {
  const tide = read("homeTide.ts");
  const stop = tide.slice(tide.indexOf("stop() {"), tide.indexOf("stop() {") + 1200);
  assert.doesNotMatch(stop, /\.loseContext\(\)/, "a second start (React's double effect) got a lost context and showed the still halftone");
});
