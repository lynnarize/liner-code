/*
  "Open in…": only the apps on Liner Code's own list are ever started, so a caller can't name any program. Run with
  `node --test engine/test/apps.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { openWith } from "../src/apps.ts";

test("open with: an app that isn't on the list is refused before anything runs", async () => {
  await assert.rejects(() => openWith("/", "com.example.anything"), /doesn't open folders in that app/);
  await assert.rejects(() => openWith("/", ""), /doesn't open folders in that app/);
});
