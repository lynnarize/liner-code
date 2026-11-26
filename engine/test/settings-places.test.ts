// Settings' places after it became a pop-up (ui/src/app/settings/places.ts): every old place still opens where its
// settings went, every place sits in one of the five groups, and a search still finds a setting on its new page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findPlaces, MOVED, PAGE_IDS, PLACES, placeOf } from "../../ui/src/app/settings/places.ts";

const ui = (p: string) => readFileSync(fileURLToPath(new URL(`../../ui/src/app/${p}`, import.meta.url)), "utf8");

test("Every one of the fifteen old places opens the page its settings moved to.", () => {
  const old: Record<string, string> = { general: "general", appearance: "appearance", notifications: "general", keyboard: "keyboard", models: "tools", agentic: "fusion", modes: "agents", team: "agents", safety: "permissions", addons: "addons", projects: "projects", git: "worktrees", archive: "archive", updates: "about", data: "about" };
  for (const [was, now] of Object.entries(old)) assert.equal(placeOf(was).page, now, `${was} lands on ${now}`);
});

test("An old place that became one group of a page opens at that group.", () => {
  assert.deepEqual(placeOf("notifications"), { page: "general", at: "notifications" });
  assert.deepEqual(placeOf("modes"), { page: "agents", at: "modes" });
  assert.deepEqual(placeOf("updates"), { page: "about", at: "updates" });
  assert.deepEqual(placeOf("data"), { page: "about", at: "data" });
});

test("A name no place has, or none at all, opens General.", () => {
  assert.equal(placeOf("nowhere").page, "general");
  assert.equal(placeOf(undefined).page, "general");
  assert.equal(placeOf(42).page, "general");
});

test("Every moved name leads to a place that exists, and no place's own id is also an old name.", () => {
  for (const [was, to] of Object.entries(MOVED)) {
    assert.ok(PAGE_IDS.includes(to.page), `${was} → ${to.page}`);
    assert.ok(!PAGE_IDS.includes(was as never), `${was} is a place of its own`);
  }
});

test("The places come in T3 Code's five groups, in order, with Archive and About and updates at the foot.", () => {
  const order = ["", "Agents", "Code", "Connections", "foot"];
  const groups = PLACES.map((p) => order.indexOf(p.group));
  assert.ok(groups.every((g) => g >= 0));
  assert.deepEqual(groups, [...groups].sort((a, b) => a - b), "each group's places sit together, in the groups' order");
  assert.deepEqual(PLACES.filter((p) => p.group === "foot").map((p) => p.id), ["archive", "about"]);
  assert.deepEqual(PLACES.filter((p) => p.group === "Connections").map((p) => p.id), ["mcp", "addons"]);
  assert.equal(new Set(PAGE_IDS).size, PAGE_IDS.length);
});

test("A search finds settings on the page they moved to.", () => {
  const where = (q: string) => findPlaces(q).map((p) => p.id);
  assert.ok(where("dock").includes("general"), "Notifications' Dock count is in General");
  assert.ok(where("sounds").includes("general"));
  assert.ok(where("branch prefix").includes("source"), "branch names moved to Source control");
  assert.ok(where("pulled").includes("source"), "keeping the default branch pulled moved to Source control");
  assert.ok(where("snapshot").includes("worktrees"));
  assert.ok(where("soul").includes("agents"), "Team's agents are in Agents and modes");
  assert.ok(where("workshop").includes("agents"), "Modes are in Agents and modes");
  assert.ok(where("outside").includes("mcp"), "Agents outside Liner Code went to Liner MCP");
  assert.ok(where("engine log").includes("about"), "Data and about joined Updates");
  assert.ok(where("endpoint").includes("tools"));
  assert.equal(findPlaces("").length, PLACES.length, "no search shows every place");
});

test("Settings opens over the app as a dialog that keeps the app's keys working, and the app under it takes none.", () => {
  const app = ui("App.tsx");
  assert.match(app, /inert=\{!sidebar \|\| settings \|\| undefined\}/, "the sidebar under Settings takes no focus");
  assert.match(app, /className="lc-paper"[^>]*inert=\{settings \|\| undefined\}/, "the page under Settings takes no focus");
  assert.match(app, /\{settings && \(\s*\/\/[^\n]*\n\s*<Boundary label="Settings"/, "Settings is drawn over the app, not in place of it");
  const keys = ui("menu-keys.ts");
  assert.match(keys, /\[role='dialog'\]:not\(\.lc-st-sheet\)/, "⌘, ⌘K and ⌘N still work over Settings");
  const st = ui("Settings.tsx");
  assert.match(st, /className="lc-st-sheet" role="dialog" aria-modal="true"/);
  assert.match(st, /className="lc-st-side"/, "keymap.ts's settings context looks for .lc-st-side");
});
