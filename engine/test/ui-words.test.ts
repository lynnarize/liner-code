/*
  The words the app uses for one gesture (ui/src/app): the Session surface's re-ask must carry the same name as
  every other face. Run with `node --test engine/test/ui-words.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const face = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");

test("the Session surface's re-ask is named Look again, as on every other face", () => {
  const session = face("SessionInfo.tsx");
  assert.ok(session.includes('aria-label="Look again"'), "the Session surface's re-ask is not named Look again");
  assert.ok(!session.includes('aria-label="Refresh"'), "the Session surface's re-ask still says Refresh");
  // Add-ons, Settings and Usage say it through the one control that carries the word (ui.tsx LookAgain).
  assert.ok(face("ui.tsx").includes('{looking ? "Looking" : "Look again"}'), "the shared Look again control no longer carries the converged word");
  for (const f of ["AddonsPage.tsx", "Usage.tsx", "Settings.tsx"]) assert.ok(face(f).includes("<LookAgain "), `${f} no longer asks again with the shared Look again`);
});
