/*
  The window's material: only solid, clear and frost are left, and anything else the page sends or
  an older shell.json kept (Glass and Vibrancy, which are gone, or nothing at all) is solid.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { materialOf, seeThrough } from "../src/material.ts";

test("solid, clear and frost stay what they are", () => {
  for (const m of ["solid", "clear", "frost"]) assert.equal(materialOf(m), m);
});

test("a retired or unknown material is solid, at load and from the page", () => {
  for (const m of ["glass", "vibrancy", "", "Clear", "FROST", " clear", undefined, null, 3, {}]) assert.equal(materialOf(m), "solid");
});

test("only clear and frost are see-through", () => {
  assert.equal(seeThrough("clear"), true);
  assert.equal(seeThrough("frost"), true);
  for (const m of ["solid", "glass", "vibrancy"]) assert.equal(seeThrough(m), false);
});
