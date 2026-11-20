/*
  Which tool notices still speak (ui/src/app/update-notices.ts): a dismissal holds until a newer version comes
  out while the tool is offered, waiting or updating; "updated" and "failed" are news, so they speak even at a
  version you put away. Run with `node --test engine/test/update-notices.test.ts`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { toolShown } from "../../ui/src/app/update-notices.ts";

const put = { claude: "2.1.330" };
const at = (state: string) => ({ id: "claude", state, latest: "2.1.330" });

test("a tool dismissed while waiting stays quiet while it is offered, waits and updates at the same version", () => {
  assert.equal(toolShown(at("available"), put), false);
  assert.equal(toolShown(at("waiting"), put), false);
  assert.equal(toolShown(at("updating"), put), false);
});

test("a tool dismissed while waiting speaks again once it is updated, at the same version", () => {
  assert.equal(toolShown(at("updated"), put), true);
});

test("a tool dismissed while waiting speaks again when its update fails, at the same version", () => {
  assert.equal(toolShown(at("failed"), put), true);
});

test("a newer version speaks again", () => {
  assert.equal(toolShown(at("available"), { claude: "2.1.329" }), true);
});

test("an undismissed tool speaks", () => {
  assert.equal(toolShown(at("waiting"), {}), true);
});

test("a tool with no version known yet still speaks when nothing was put away", () => {
  assert.equal(toolShown({ id: "claude", state: "failed" }, {}), true);
  assert.equal(toolShown({ id: "claude", state: "waiting" }, {}), true);
});
