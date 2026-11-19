/*
  Which page survives a change of face (ui/src/app/face-pages.ts): a face draws its Home and a session itself,
  while every other page is reached from Liner Code's sidebar and must be left behind when the face changes,
  or the paper keeps it under another face's sidebar (plans/layout L02). Run with
  `node --test engine/test/face-change.test.ts`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { keptOnFaceChange } from "../../ui/src/app/face-pages.ts";

test("A change of face keeps Home and a session", () => {
  assert.equal(keptOnFaceChange("home"), true);
  assert.equal(keptOnFaceChange("session"), true);
});

test("A change of face leaves Add-ons, Usage, the Wall and an app page", () => {
  assert.equal(keptOnFaceChange("addons"), false);
  assert.equal(keptOnFaceChange("usage"), false);
  assert.equal(keptOnFaceChange("wall"), false);
  assert.equal(keptOnFaceChange("app"), false);
});
