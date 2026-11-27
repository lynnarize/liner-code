/*
  The words the app uses for one gesture (ui/src/app): the session details card's re-ask must carry the same name as
  every other face. Run with `node --test engine/test/ui-words.test.ts`.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const face = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");

test("the details card's re-ask (the Session surface's, before it went) is named Look again, as on every other face", () => {
  const env = face("Env.tsx");
  assert.ok(env.includes('<Row title="Look again"'), "the details card's re-ask is not named Look again");
  assert.ok(!/title="Refresh"|aria-label="Refresh"/.test(env), "the details card's re-ask still says Refresh");
  // Add-ons, Settings and Usage say it through the one control that carries the word (ui.tsx LookAgain).
  assert.ok(face("ui.tsx").includes('{looking ? "Looking" : "Look again"}'), "the shared Look again control no longer carries the converged word");
  for (const f of ["AddonsPage.tsx", "Usage.tsx", "Settings.tsx"]) assert.ok(face(f).includes("<LookAgain "), `${f} no longer asks again with the shared Look again`);
});
