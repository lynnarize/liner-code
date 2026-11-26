/*
  What a session's row menu in the sidebar offers that depends on the session (ui/src/app/row-menu.ts, board RowMenu,
  2026-11-25): Stop it only while it works, as the message box's stop; Mark unread and back; the group it is in.
  Run with `node --test engine/test/row-menu.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupValue, stopShows, unreadRow } from "../../ui/src/app/row-menu.ts";

const app = (file: string) => readFileSync(new URL(`../../ui/src/app/${file}`, import.meta.url), "utf8");

test("Stop it shows in a row's menu while a turn of the session runs or waits on you, and never for an archived one", () => {
  assert.equal(stopShows({ status: "running" }), true);
  assert.equal(stopShows({ status: "waiting" }), true, "a turn waiting on an approval can't be stopped from the menu");
  assert.equal(stopShows({ status: "waiting", held: "review" }), false, "shown for a Reviewer's held work, which has no turn");
  for (const status of ["idle", "done", "error", "limited"] as const) assert.equal(stopShows({ status }), false, `shown while ${status}`);
  assert.equal(stopShows({ status: "running", archived: true }), false, "an archived session offers Stop");
});

test("Stop it in a row's menu shows when the message box's stop does, and stops the session the same way", () => {
  // The box's stop shows while it is busy (Composer `turning`), and Session passes it busy as the thread running.
  const session = app("Session.tsx");
  assert.match(session, /const busy = thread\.status === "running";/, "the message box's busy is no longer the thread running");
  assert.match(session, /onStop=\{\(\) => void rpc\("thread\.stop", \{ id: thread\.id \}\)/, "the message box no longer stops with thread.stop");
  assert.match(app("row-menu.ts"), /export const stopShows = \(t: Pick<Thread, "status" \| "archived" \| "held">\) => !t\.archived && \(t\.status === "running" \|\| \(t\.status === "waiting" && t\.held !== "review"\)\);/);
});

test("Mark unread marks a read session unread, and a session marked so offers Mark read", () => {
  assert.deepEqual(unreadRow({}), { title: "Mark unread", unread: true });
  assert.deepEqual(unreadRow({ unread: false }), { title: "Mark unread", unread: true });
  assert.deepEqual(unreadRow({ unread: true }), { title: "Mark read", unread: false });
  // The sidebar's act sends it, with Undo in its toast as the other row actions have.
  const side = app("Sidebar.tsx");
  assert.match(side, /what === "unread" \? \{ unread: unreadRow\(t\)\.unread \}/, "Mark unread doesn't set the thread's unread");
  assert.match(side, /toast\(what === "unread" \? `Marked \$\{t\.title\} \$\{t\.unread \? "read" : "unread"\}`[^\n]*label: "Undo"/, "Mark unread has no Undo");
});

test("Group's value is the name of the group a session is in, and nothing when it is in none or one since deleted", () => {
  const groups = [{ id: "g1", name: "Launch week" }, { id: "g2", name: "Tide tables" }];
  assert.equal(groupValue({ group: "g1" }, groups), "Launch week");
  assert.equal(groupValue({}, groups), undefined);
  assert.equal(groupValue({ group: "gone" }, groups), undefined);
});

test("A project's folder in the sidebar has a + beside its ··· that starts a session in that project, and Designs and sessions of no project have none", () => {
  const side = app("Sidebar.tsx");
  const plus = side.match(/\{x\.id && x\.id !== DESIGNS && \(\s*<button type="button" className="lc-sb-a l-focus" data-new aria-label=\{`New session in \$\{x\.name\}`\}[^\n]*onClick=\{\(\) => onNew\(x\.id\)\}>\s*<I\.plus size=\{14\} \/>/);
  assert.ok(plus, "a project's folder has no + that starts a session in it");
  // Before the ···, in the folder's actions, which show while you point at it.
  const acts = side.slice(side.indexOf("actions={", side.indexOf("<SideFolder")));
  assert.ok(acts.indexOf("data-new") < acts.indexOf('aria-haspopup="menu"'), "the + isn't before the ···");
  // The menu's New session here stays for a right-click, and starts the same way.
  assert.match(side, /<Row title="New session here" icon=\{<I\.plus size=\{16\} \/>\} onPick=\{\(\) => \(close\(\), onNew\(projMenu\.id\)\)\} \/>/);
});
