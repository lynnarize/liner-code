/*
  Which tool notices still speak (ui/src/app/update-notices.ts): a dismissal holds until a newer version comes
  out, whatever state the tool is in now. Run with `node --test engine/test/update-notices.test.ts`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { toolShown } from "../../ui/src/app/update-notices.ts";

test("a dismissal holds for an updated tool, not only an available one", () => {
  assert.equal(toolShown({ id: "claude", latest: "2.1.330" }, { claude: "2.1.330" }), false);
});

test("the old filter let a dismissed updated tool speak again", () => {
  // The bug, kept as a pin: the old predicate honoured a dismissal only while the offer was "available",
  // so the same version spoke again once the tool became "updated".
  const t = { id: "claude", latest: "2.1.330", state: "updated" };
  const dismissed: Record<string, string> = { claude: "2.1.330" };
  const oldShown = !(t.state === "available" && dismissed[t.id] === t.latest);
  assert.equal(oldShown, true);
});

test("a newer version speaks again", () => {
  assert.equal(toolShown({ id: "claude", latest: "2.1.330" }, { claude: "2.1.329" }), true);
});

test("an undismissed tool speaks", () => {
  assert.equal(toolShown({ id: "claude", latest: "2.1.330" }, {}), true);
});