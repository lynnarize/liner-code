/*
  The right panel's start page (the owner approved the board "as drawn", 2026-11-27, after Kimi's empty right panel): what
  the panel shows open with nothing in it. Its rows run from surface-row.ts startPage, and the rest is read as text.
  Run with `node --test engine/test/panel-start.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as dock from "../../ui/src/app/dock.ts";
import { pickOf, prEnd, START_HERE, startPage, surfaceRows, tileOf, type StartInput } from "../../ui/src/app/surface-row.ts";

const read = (path: string) => readFileSync(new URL(`../../ui/src/app/${path}`, import.meta.url), "utf8");
/** Every block whose selector list ends in a selector starting with `prefix`. */
const blocksOf = (css: string, prefix: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").some((s) => s.trim().split("\n").pop()!.trim().startsWith(prefix))).map((m) => m[2]);

const IDS = ["side", "browser", "design", "terminal", "files", "changes", "pr", "linked", "device", "agents"];
const LABEL: Record<string, string> = { agents: "Agents", pr: "Pull request", design: "Design", device: "Device" };
const KEYS: Record<string, string> = { changes: "⇧⌘D", files: "⇧⌘F", browser: "⇧⌘B", session: "⇧⌘I", side: "⇧⌘C", terminal: "⇧⌘T" };
const input = (o: Partial<StartInput> = {}): StartInput => ({
  ids: IDS,
  labelOf: (id) => LABEL[id] ?? id,
  now: { agents: false, pr: false, canvas: false, device: false },
  changes: { files: 0, added: 0, removed: 0 },
  servers: [],
  thread: {},
  worked: 0,
  apps: [],
  keyOf: (id) => KEYS[id.replace(/^surface\./, "")],
  ...o,
});

test("The panel open with no tabs draws the start page, with no tabs and no rule under its head", () => {
  const open = dock.showDock(dock.emptyDock());
  assert.equal(dock.isEmptyOpen(open), true, "the panel's toggle on nothing doesn't leave it open and empty");
  assert.equal(open.panes.length, 0, "the panel opened on a surface by itself");
  const panel = read("Panel.tsx");
  assert.match(panel, /\{all\.length === 0 && <PanelStart /, "the panel with nothing in it draws no start page");
  assert.match(panel, /<aside ref=\{box\} className="lc-panel"[^>]*>\s*<PanelTabs /, "the head row isn't first");
  const sw = read("Switcher.tsx");
  assert.match(sw, /<div className="lc-ptabs" data-empty=\{tabs\.length === 0 \|\| undefined\}>/, "the head doesn't know it is empty");
  assert.match(sw, /className="lc-ptabs-list" role="tablist" hidden=\{tabs\.length === 0\}/, "an empty tab list still shows");
  const css = read("dock.css");
  assert.match(css, /\n\.lc-ptabs\[data-empty\] \{\s*border-bottom-color: transparent;\s*\}/, "the hairline stays under an empty panel's head");
  assert.match(css, /\n\.lc-ptabs-list\[hidden\] \{\s*display: none;\s*\}/);
  // The head keeps +, Fill the window and Hide the panel.
  const head = sw.slice(sw.indexOf("export function PanelTabs("), sw.indexOf("/**\n  +, as lean"));
  assert.match(head, /<SurfaceMenu [\s\S]*"Fill the window"[\s\S]*aria-label="Hide the panel"/);
});

test("Closing the last tab still hides the panel, and the start page shows only while it is open", () => {
  const files = dock.openTab(dock.showDock(dock.emptyDock()), "files");
  assert.deepEqual(files.panes, [{ tabs: ["files"], tab: "files" }], "a surface opened from the start page isn't its one tab");
  assert.equal(dock.isEmptyOpen(files), false, "the start page stays with a surface open");
  const closed = dock.closeTab(files, "files");
  assert.equal(closed.open, false, "closing the last tab leaves the start page instead of hiding the panel");
  assert.deepEqual(closed, dock.emptyDock());
  assert.equal(dock.isEmptyOpen(closed), false);
  // A surface's own close puts the panel away as before.
  assert.match(read("Panel.tsx"), /onClose=\{\(\) => onDock\(hideDock\(closeTab\(dock, t\)\)\)\}/);
  // Hidden on a narrow window with the terminal up, as before.
  assert.match(read("Session.tsx"), /if \(w > 0 && w <= 786\) setDock\(\(d\) => \(\{ \.\.\.d, open: false \}\)\);/);
});

test("Start here lists Changes, Files, Browser, New side chat and New terminal, each doing what its row in + does; Session is the details card's now", () => {
  const { here } = startPage(input());
  assert.deepEqual(here.map((r) => r.title), ["Changes", "Files", "Browser", "New side chat", "New terminal"]);
  assert.deepEqual(here.map((r) => r.id), [...START_HERE]);
  assert.ok(!(START_HERE as readonly string[]).includes("session"), "the start page lists the Session surface again");
  // Even where an older list of surfaces still names it, the start page has no Session row.
  assert.ok(!startPage(input({ ids: ["session", ...IDS] })).here.some((r) => r.id === "session"), "a Session row comes back from the surfaces' list");
  assert.deepEqual(here.map((r) => r.pick), [{ kind: "surface", tab: "changes" }, { kind: "surface", tab: "files" }, { kind: "surface", tab: "browser" }, { kind: "side" }, { kind: "terminal" }]);
  for (const r of here) assert.deepEqual(r.pick, pickOf(r.id), `${r.title} presses differently from its row in +`);
  // + presses the same RowPick through the same runPick; the start page has no opening of its own.
  const sw = read("Switcher.tsx");
  const list = sw.slice(sw.indexOf("function SurfaceList("), sw.indexOf("/** The menu's shells part"));
  assert.match(list, /const run = \(p: RowPick\) => \(close\(\), runPick\(\{ thread, dock, onDock, onBelow, onMake \}, p\)\);/);
  assert.match(list, /const pick = \(tab: Tab\) => run\(pickOf\(tab\)\);/);
  assert.match(list, /title="New add-on"[^\n]*run\(pickOf\("make"\)\)/);
  const start = read("PanelStart.tsx");
  assert.match(start, /const press = \(r: StartRow\) => runPick\(\{ thread, dock, onDock, onBelow, onMake \}, r\.pick\);/, "the start page doesn't press through runPick");
  assert.doesNotMatch(start, /openTab|closeTab|runScript\(|onMake\(\)|setBelow/, "the start page opens surfaces a second way");
  assert.equal((sw.match(/runScript\(/g) ?? []).length, 1, "Switcher starts a shell in more than one place");
});

test("A Start here row ends in a live fact when the app holds one: changed files and lines, a server this session started; else its key", () => {
  const plain = startPage(input()).here;
  assert.deepEqual(plain.map((r) => r.end), [{ kind: "key", keys: "⇧⌘D" }, { kind: "key", keys: "⇧⌘F" }, { kind: "key", keys: "⇧⌘B" }, { kind: "key", keys: "⇧⌘C" }, { kind: "key", keys: "⇧⌘T" }]);
  const busy = startPage(input({ changes: { files: 3, added: 27, removed: 6 }, servers: [{ port: 3000, owner: "project" }, { port: 5179, owner: "session" }, { port: 5180, owner: "session" }] })).here;
  assert.deepEqual(busy[0].end, { kind: "changes", files: 3, added: 27, removed: 6 }, "Changes doesn't end in its files and lines");
  assert.equal(busy[0].name, "Changes, 3 files, 27 lines added, 6 removed");
  assert.deepEqual(busy[2].end, { kind: "server", port: 5179 }, "Browser doesn't end in the first server this session started");
  assert.equal(busy[2].name, "Browser, localhost:5179 listens");
  assert.deepEqual(busy[1].end, { kind: "key", keys: "⇧⌘F" }, "Files lost its key");
  const others = startPage(input({ servers: [{ port: 3000, owner: "project" }, { port: 8080, owner: null }] })).here;
  assert.deepEqual(others[2].end, { kind: "key", keys: "⇧⌘B" }, "a server another session or tool started is shown as this session's");
  // The numbers are the commit tab's, handed down from the session.
  assert.match(read("Session.tsx"), /changes=\{\{ files: openFiles \|\| wtChanges, added: openFiles > 0 \? lines\.added : 0, removed: openFiles > 0 \? lines\.removed : 0 \}\}/);
  assert.deepEqual(startPage(input({ changes: { files: 2, added: 0, removed: 0 } })).here[0].end, { kind: "changes", files: 2, added: 0, removed: 0 });
});

test("In this session is left out with nothing, and lists agents, a pull request, a canvas and a device by +'s own rules", () => {
  assert.deepEqual(startPage(input()).session, [], "a session with nothing shows In this session");
  assert.match(read("PanelStart.tsx"), /\{page\.session\.length > 0 && <Group label="In this session"/, "the group's label shows with no rows");
  const all = startPage(input({ now: { agents: true, pr: true, canvas: true, device: true } })).session;
  assert.deepEqual(all.map((r) => r.id), ["agents", "pr", "design", "device"]);
  assert.deepEqual(all.map((r) => r.id), surfaceRows(IDS, { agents: true, pr: true, canvas: true, device: true, open: [] }).top.filter((id) => !["changes", "files", "browser"].includes(id)), "In this session disagrees with +");
  assert.deepEqual(all.map((r) => r.pick), all.map((r) => pickOf(r.id)));
  for (const k of ["agents", "pr", "canvas", "device"] as const) assert.equal(startPage(input({ now: { agents: false, pr: false, canvas: false, device: false, [k]: true } })).session.length, 1, `${k} alone`);
  // Agents: Fusion's mark and mode, working while any work, else how many worked.
  const fusion = startPage(input({ now: { agents: true, pr: false, canvas: false, device: false }, thread: { sidekick: "codex:gpt", agentsAtWork: 2 } })).session[0];
  assert.deepEqual([fusion.title, fusion.note, fusion.fusion, fusion.end], ["Agents", "Fusion", true, { kind: "agents", n: 2, working: true }]);
  const done = startPage(input({ now: { agents: true, pr: false, canvas: false, device: false }, thread: {}, worked: 3 })).session[0];
  assert.deepEqual([done.note, done.fusion, done.end], ["Subagents", false, { kind: "agents", n: 3, working: false }]);
  const swarm = startPage(input({ now: { agents: true, pr: false, canvas: false, device: false }, thread: { sidekick: "x", swarm: { enabled: true, mode: "swarm" } as never } })).session[0];
  assert.deepEqual([swarm.note, swarm.fusion], ["Swarm", false]);
  assert.equal(startPage(input({ now: { agents: true, pr: false, canvas: false, device: false }, thread: { swarm: { enabled: true } as never } })).session[0].note, "Teamwork");
  // Pull request: its number, its state in its colour.
  const pr = startPage(input({ now: { agents: false, pr: true, canvas: false, device: false }, thread: { pr: { number: 412, url: "u", state: "OPEN", checks: { state: "passed" } } } })).session[0];
  assert.deepEqual([pr.title, pr.note, pr.end], ["Pull request", "#412", { kind: "pr", word: "Checks pass", tone: "ok" }]);
  assert.deepEqual(prEnd({ number: 1, url: "u", state: "OPEN", checks: { state: "running" } }), { kind: "pr", word: "Checks running", tone: "dim" });
  assert.deepEqual(prEnd({ number: 1, url: "u", state: "OPEN", checks: { state: "failed", failed: 2 } }), { kind: "pr", word: "Checks fail", tone: "bad" });
  assert.deepEqual(prEnd({ number: 1, url: "u", state: "MERGED" }), { kind: "pr", word: "Merged", tone: "merged" });
  assert.deepEqual(prEnd({ number: 1, url: "u", state: "OPEN" }), { kind: "pr", word: "Open", tone: "dim" });
  const remote = startPage(input({ now: { agents: false, pr: true, canvas: false, device: false } })).session[0];
  assert.deepEqual([remote.note, remote.end], [undefined, undefined], "a project with a remote and no pull request yet says a number");
  const design = startPage(input({ now: { agents: false, pr: false, canvas: true, device: false } })).session[0];
  assert.deepEqual([design.title, design.note, design.end], ["Design", undefined, undefined]);
});

test("Your apps lists the person's apps with their lines, and always ends in New add-on, which asks for one as + does", () => {
  const none = startPage(input()).apps;
  assert.deepEqual(none.map((r) => [r.title, r.pick]), [["New add-on", { kind: "make" }]], "with no apps the group isn't just New add-on");
  const apps = startPage(input({ apps: [{ id: "tide", name: "Tide board", line: "Today's tides for the sample harbour" }, { id: "rel", name: "Release notes", icon: "notes" }] })).apps;
  assert.deepEqual(apps.map((r) => r.title), ["Tide board", "Release notes", "New add-on"]);
  assert.deepEqual(apps[0].pick, { kind: "surface", tab: "app:tide" }, "an app doesn't open as its panel tab, as in +");
  assert.equal(apps[0].note, "Today's tides for the sample harbour");
  assert.equal(apps[0].app?.tile, "Tb");
  assert.equal(apps[1].app?.icon, "notes", "an app's own icon is dropped for a tile");
  assert.equal(apps[2].quiet, true, "New add-on isn't the grey row");
  assert.equal(tileOf("tides"), "Ti");
  // The apps are +'s list, in its order (pinned first).
  assert.match(read("PanelStart.tsx"), /const ordered = moreRows\(dock, apps, pins\)\.apps\.map/);
  assert.match(read("PanelStart.tsx"), /const apps = appsFor\(addons, thread\.projectId\);/);
});

test("Each row of the start page is one button with an accessible name, and nothing in it is a second button", () => {
  const page = startPage(input({ now: { agents: true, pr: true, canvas: true, device: true }, thread: { pr: { number: 9, url: "u", state: "OPEN" } }, apps: [{ id: "a", name: "Alpha" }] }));
  for (const r of [...page.here, ...page.session, ...page.apps]) assert.ok(r.name.startsWith(r.title), `${r.title} has no accessible name of its own`);
  const start = read("PanelStart.tsx");
  assert.equal((start.match(/<button /g) ?? []).length, 1, "the start page draws more than its rows' one button");
  assert.match(start, /<button key=\{r\.id\} type="button" className="lc-start-r l-focus"[^>]*aria-label=\{r\.name\} onClick=\{\(\) => press\(r\)\}>/);
  assert.match(start, /<span className="lc-start-k" aria-hidden>/, "the row's end is read out twice");
});

test("The start page's rules have no shadow, blur, animation or transition, and only a row's fill changes under the pointer or the keyboard", () => {
  const css = read("dock.css");
  const blocks = blocksOf(css, ".lc-start");
  assert.ok(blocks.length >= 10, "the start page's rules could not be read");
  for (const b of blocks) assert.doesNotMatch(b, /box-shadow|filter|animation|transition|transform|backdrop|radial-gradient/, `a start page rule moves or floats: ${b.trim().slice(0, 80)}`);
  assert.match(css, /\n\.lc-start-r:focus-visible \{\s*background: var\(--lc-menu-hl\);\s*\}/, "keyboard focus doesn't fill the row");
  assert.match(css, /\n {2}\.lc-start-r:hover \{\s*background: var\(--lc-menu-hl\);\s*\}/, "the pointer doesn't fill the row");
  const row = blocksOf(css, ".lc-start-r {")[0] ?? css.slice(css.indexOf("\n.lc-start-r {"), css.indexOf("}", css.indexOf("\n.lc-start-r {")));
  assert.match(row, /height: 34px;[\s\S]*padding: 0 10px;[\s\S]*border-radius: var\(--lc-r-menu\);[\s\S]*font-size: 14px;\s*font-weight: 400;/);
  assert.match(css, /\n\.lc-start-in \{\s*width: 100%;\s*max-width: 388px;/);
  assert.match(css, /\n\.lc-start \{[^}]*overflow-y: auto;[^}]*padding: 64px 28px 32px;/, "the page doesn't scroll inside the panel or start 64 under the head");
  assert.match(css, /\n\.lc-start-l \{[^}]*height: 26px;[^}]*font-size: 12\.5px;/);
  assert.match(css, /\n\.lc-start-g \+ \.lc-start-g \{\s*margin-top: 26px;/);
});

test("The start page asks the engine nothing the details card and + don't already ask", () => {
  const start = read("PanelStart.tsx");
  const asks = [...start.matchAll(/rpc\("([\w.]+)"/g)].map((m) => m[1]);
  assert.deepEqual(asks, ["ports.list"], "the start page asks something of its own");
  assert.match(read("Env.tsx"), /rpc\("ports\.list", \{ threadId: thread\.id \}\)/, "the details card no longer asks ports.list");
  // A running simulator comes from +'s own look.
  assert.match(start, /const device = useBooted\(\);/);
  assert.match(read("Switcher.tsx"), /export function useBooted\(\) \{[\s\S]*?rpc\("device\.list", \{\}\)/);
});
