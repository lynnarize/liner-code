/*
  Add-ons, phase 2: panels. The bridge's permission checks (what each access allows, and nothing
  else), the panel manifest's checks, the files a panel may hold, the version rules (the same
  manifest and files are the same version; one that asks for nothing more goes in without a card;
  one that asks for more asks again), its storage quota, the frame's document (the content policy
  and the bridge first, nothing from elsewhere), addon_install's panel paths, and the right dock's
  layout rules (ui/src/app/dock.ts). Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item, PanelAccess, PanelAsk, PanelManifest, Thread } from "../../contracts/src/index.ts";
import { emptyUsage, panelDocument, panelPolicy } from "../../contracts/src/index.ts";
import { accessWords, Addons, checkManifest, readDraft, readPanelFiles, widerAccess } from "../src/addons.ts";
import { AgentTools, type AddonHost } from "../src/agent-tools.ts";
import { panelCall, PANEL_METHODS, readable, refusal, type PanelEnv } from "../src/panels.ts";
import { Store } from "../src/store.ts";
import * as dock from "../../ui/src/app/dock.ts";

const home = () => mkdtempSync(join(tmpdir(), "lc-panels-"));
const todos = (access: PanelAccess = { files: "project", composer: true }, extra: Partial<PanelManifest> = {}): PanelManifest => ({ apiVersion: 1, id: "todos", kind: "panel", name: "TODOs", place: "dock", entry: "index.html", icon: "list", access, ...extra });
const FILES = { "index.html": "<h1>TODOs</h1><script src=\"app.js\"></script>", "app.js": "liner.files.search(['TODO'])" };
const wrong = (m: unknown) => {
  try {
    checkManifest(m);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};

/* ---------- The bridge's permission checks ---------- */

test("bridge: each call needs its own access, and nothing in the manifest means nothing allowed", () => {
  const none = { access: {}, place: "dock" as const, threadId: "t" };
  for (const m of PANEL_METHODS) {
    if (m === "context") assert.equal(refusal(none, m), null, "anyone may ask who it is");
    else assert.match(refusal(none, m) ?? "", /didn't ask/, `${m} is refused without access`);
  }
  const files = { access: { files: "project" as const }, place: "dock" as const, threadId: "t" };
  for (const m of ["files.list", "files.read", "files.search"]) assert.equal(refusal(files, m), null);
  for (const m of ["session.info", "sessions.list", "composer.put", "storage.get"]) assert.notEqual(refusal(files, m), null, `files access doesn't give ${m}`);
  const thisOne = { access: { sessions: "this" as const }, place: "dock" as const, threadId: "t" };
  assert.equal(refusal(thisOne, "session.info"), null);
  assert.equal(refusal(thisOne, "session.commands"), null);
  assert.match(refusal(thisOne, "sessions.list") ?? "", /every session/, "this session isn't every session");
  const all = { access: { sessions: "all" as const }, place: "dock" as const, threadId: "t" };
  assert.equal(refusal(all, "sessions.list"), null);
  assert.equal(refusal(all, "session.info"), null);
  assert.equal(refusal({ access: { composer: true }, place: "dock", threadId: "t" }, "composer.put"), null);
  for (const m of ["storage.get", "storage.set", "storage.remove", "storage.keys"]) assert.equal(refusal({ access: { storage: 64 }, place: "dock", threadId: "t" }, m), null);
});

test("bridge: a page has no session, an unknown call or another version is refused", () => {
  const page = { access: { files: "project" as const, sessions: "all" as const, composer: true, storage: 8 }, place: "page" as const };
  assert.match(refusal(page, "files.read") ?? "", /no session here/);
  assert.match(refusal(page, "composer.put") ?? "", /no session here/);
  assert.match(refusal(page, "session.info") ?? "", /no session here/);
  assert.equal(refusal(page, "sessions.list"), null);
  assert.equal(refusal(page, "storage.set"), null);
  assert.match(refusal(page, "shell.run") ?? "", /no shell\.run/);
  assert.match(refusal(page, "__proto__") ?? "", /no __proto__/);
  assert.match(refusal(page, "sessions.list", 2) ?? "", /version 1; the panel spoke version 2/);
});

test("bridge: a panel reads the project's files, never a hidden one, one outside, or one through a link", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-panel-root-"));
  const outside = mkdtempSync(join(tmpdir(), "lc-panel-out-"));
  writeFileSync(join(outside, "secret.txt"), "no");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "a.js"), "// TODO: one");
  symlinkSync(join(outside, "secret.txt"), join(root, "src", "link.txt"));
  assert.equal(readable(root, "src/a.js"), "src/a.js");
  assert.throws(() => readable(root, ".env"), /Hidden files/);
  assert.throws(() => readable(root, "src/.git/config"), /Hidden files/);
  assert.throws(() => readable(root, "../x"), /outside the project/);
  assert.throws(() => readable(root, join(outside, "secret.txt")), /outside the project/);
  assert.throws(() => readable(root, "src/link.txt"), /link to outside/);
  assert.throws(() => readable(root, ""), /Say which file/);
  assert.throws(() => readable(root, 7), /Say which file/);
});

test("bridge: search takes plain words, and storage holds to its quota", async () => {
  const root = mkdtempSync(join(tmpdir(), "lc-panel-root-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "a.js"), "one\n// TODO: two\n// FIXME: three\n");
  writeFileSync(join(root, ".env"), "TODO=leak");
  const kept: Record<string, unknown> = {};
  const env: PanelEnv = {
    cwdOf: () => root,
    thread: () => ({ id: "t" }) as Thread,
    threads: () => [],
    timeline: () => [],
    projectName: () => "p",
    branchOf: () => undefined,
    storage: {
      all: () => kept,
      put: (k, v) => {
        if (v !== undefined && JSON.stringify({ ...kept, [k]: v }).length > 1024) throw new Error("over its quota");
        if (v === undefined) delete kept[k];
        else kept[k] = v;
      },
    },
  };
  const where = { access: { files: "project" as const, storage: 1 }, place: "dock" as const, threadId: "t" };
  const hits = (await panelCall(env, where, "files.search", { pattern: ["TODO", "FIXME"] })) as { path: string; line: number }[];
  assert.deepEqual(hits.map((h) => `${h.path}:${h.line}`), ["src/a.js:2", "src/a.js:3"], "found in the project, never in .env");
  // A pattern is a word: nothing a panel writes runs in the engine, a regular expression included.
  assert.deepEqual(await panelCall(env, where, "files.search", { pattern: "(a+)+$" }), []);
  await assert.rejects(panelCall(env, where, "files.search", {}), /Say what to look for/);
  assert.equal(await panelCall(env, where, "storage.set", { key: "n", value: 1 }), true);
  assert.equal(await panelCall(env, where, "storage.get", { key: "n" }), 1);
  await assert.rejects(panelCall(env, where, "storage.set", { key: "big", value: "x".repeat(2000) }), /quota/);
  assert.deepEqual(await panelCall(env, where, "storage.keys", {}), ["n"]);
  assert.deepEqual(await panelCall(env, { ...where, access: { composer: true } }, "composer.put", { text: "Fix it" }), { text: "Fix it" });
  await assert.rejects(panelCall(env, { ...where, access: { composer: true } }, "composer.put", { text: "" }), /Say what/);
});

/* ---------- The manifest ---------- */

test("panel manifest: passes as written, entry defaulting to index.html", () => {
  assert.deepEqual(checkManifest(todos()), todos());
  const { entry: _e, ...bare } = todos();
  assert.equal((checkManifest(bare) as PanelManifest).entry, "index.html");
  assert.deepEqual(checkManifest(todos({ sessions: "all", storage: 1024, network: "API.GitHub.com" })), todos({ sessions: "all", storage: 1024, network: "api.github.com" }));
  assert.deepEqual((checkManifest(todos({ composer: false, storage: 0 })) as PanelManifest).access, {}, "nothing and false are left out");
});

test("panel manifest: place, entry, icon and every access are checked, all said at once", () => {
  assert.match(wrong({ ...todos(), place: "float" }), /place must be "dock"/);
  assert.match(wrong({ ...todos(), entry: "../index.html" }), /entry must be an \.html file/);
  assert.match(wrong({ ...todos(), entry: "app.js" }), /entry must be an \.html file/);
  assert.match(wrong({ ...todos(), icon: "rocket" }), /icon must be one of/);
  assert.match(wrong({ ...todos(), server: { http: { url: "https://x" } } }), /server isn't a key a manifest has here/);
  assert.match(wrong(todos({ files: "home" as never })), /access\.files must be "project"/);
  assert.match(wrong(todos({ sessions: "every" as never })), /access\.sessions must be "this"/);
  assert.match(wrong(todos({ composer: "yes" as never })), /access\.composer must be true or false/);
  assert.match(wrong(todos({ storage: 2048 })), /up to 1024/);
  assert.match(wrong(todos({ storage: 1.5 })), /whole number/);
  assert.match(wrong({ ...todos(), access: { files: "project", camera: true } }), /access\.camera isn't a key/);
  for (const host of ["https://api.github.com", "api.github.com:443", "api.github.com/repos", "*.github.com", "github", "localhost", "printer.local", "10.0.0.1", "router.lan"]) assert.match(wrong(todos({ network: host })), /access\.network/, `${host} isn't one host on the internet`);
  // A page has no session beside it.
  assert.match(wrong({ ...todos(), place: "page" }), /A page \(place "page"\) has no session beside it/);
  assert.equal(wrong({ ...todos({ sessions: "all", storage: 64 }), place: "page" }), "");
  const many = wrong({ ...todos({ storage: -1, network: "x" }), place: "nowhere", icon: 3 });
  assert.equal(many.split("\n- ").length - 1, 4, "every problem at once");
});

/* ---------- Its files ---------- */

test("panel files: its own page's kinds only, no links, nothing hidden, within the limits, with its entry", () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-panel-files-"));
  writeFileSync(join(dir, "addon.json"), JSON.stringify(todos()));
  writeFileSync(join(dir, "index.html"), "<p>hi</p>");
  writeFileSync(join(dir, ".DS_Store"), "x");
  mkdirSync(join(dir, "img"));
  writeFileSync(join(dir, "img", "dot.png"), Buffer.from([137, 80, 78, 71]));
  const files = readPanelFiles(dir, "index.html");
  assert.deepEqual(Object.keys(files).sort(), ["img/dot.png", "index.html"], "the manifest and hidden files aren't its files");
  assert.equal(files["img/dot.png"], Buffer.from([137, 80, 78, 71]).toString("base64"), "pictures in base64");
  assert.throws(() => readPanelFiles(dir, "main.html"), /There's no main\.html/);
  writeFileSync(join(dir, "run.sh"), "rm -rf /");
  assert.throws(() => readPanelFiles(dir, "index.html"), /run\.sh isn't a kind of file/);
  const dir2 = mkdtempSync(join(tmpdir(), "lc-panel-files-"));
  writeFileSync(join(dir2, "index.html"), "<p>hi</p>");
  symlinkSync("/etc/hosts", join(dir2, "hosts.txt"));
  assert.throws(() => readPanelFiles(dir2, "index.html"), /hosts\.txt is a link/);
  const dir3 = mkdtempSync(join(tmpdir(), "lc-panel-files-"));
  writeFileSync(join(dir3, "index.html"), "x".repeat(600_000));
  assert.throws(() => readPanelFiles(dir3, "index.html"), /over 512 KB/);
});

test("panel draft: read with its files from the session's folder", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-panel-root-"));
  mkdirSync(join(root, ".liner", "addons", "todos"), { recursive: true });
  writeFileSync(join(root, ".liner", "addons", "todos", "addon.json"), JSON.stringify(todos()));
  for (const [p, c] of Object.entries(FILES)) writeFileSync(join(root, ".liner", "addons", "todos", p), c);
  const d = readDraft(root, "todos");
  assert.equal(d.manifest.kind, "panel");
  assert.deepEqual(d.files, FILES);
});

/* ---------- Versions ---------- */

test("versions: the same manifest and files are one version, a change to either is the next, and each is kept", () => {
  const a = new Addons(home());
  const by = { agent: "Opus 5.5", at: 1 };
  assert.equal(a.install(todos(), { by }, FILES), 1);
  assert.equal(a.install(todos(), { by }, { ...FILES }), 1, "nothing changed");
  assert.deepEqual(a.wouldBe(todos(), { ...FILES, "app.js": "// v2" }), { version: 2, replaces: 1 });
  assert.equal(a.install(todos(), { by }, { ...FILES, "app.js": "// v2" }), 2, "its files changed");
  assert.equal(a.install(todos({ files: "project" }), { by }, FILES), 3, "its manifest changed");
  assert.deepEqual(a.files("todos", 2), { ...FILES, "app.js": "// v2" }, "each version keeps its own files");
  assert.deepEqual(a.files("todos", 1), FILES);
  a.update("todos", { version: 1 });
  assert.equal(a.wouldBe(todos(), { ...FILES, "app.js": "// v2" }).version, 2, "an earlier version comes back as itself");
  const info = a.get("todos")!;
  assert.deepEqual([info.kind, info.version, info.versions, info.panel?.place, info.reaches], ["panel", 1, [1, 2, 3], "dock", "reads this project's files · can put text in the composer · no network"]);
  assert.throws(() => a.install(todos(), { by }), /needs its files/);
});

test("versions: a panel and a connection never share an id, and panels never reach an agent tool", () => {
  const a = new Addons(home());
  const by = { agent: "Opus 5.5", at: 1 };
  a.install(todos(), { by }, FILES);
  assert.throws(() => a.install({ apiVersion: 1, id: "todos", kind: "connection", name: "T", server: { http: { url: "https://x.dev/mcp" } } }, { by }), /already the id of a panel/);
  assert.deepEqual(a.connections("p", new Map()), [], "a panel isn't an MCP server");
});

test("versions: what counts as asking for more", () => {
  assert.deepEqual(widerAccess({ files: "project" }, { files: "project" }), []);
  assert.deepEqual(widerAccess({ files: "project", composer: true, storage: 64 }, { files: "project", storage: 32 }), [], "asking for less never asks again");
  assert.deepEqual(widerAccess({}, { files: "project" }), ["Read the project's files"]);
  assert.deepEqual(widerAccess({ sessions: "this" }, { sessions: "all" }), ["Read every session's titles and changes"]);
  assert.deepEqual(widerAccess({ sessions: "all" }, { sessions: "this" }), []);
  assert.deepEqual(widerAccess({}, { composer: true }), ["Put text in the composer"]);
  assert.deepEqual(widerAccess({}, { storage: 64 }), ["Keep its own storage, up to 64 KB"]);
  assert.deepEqual(widerAccess({ storage: 64 }, { storage: 1024 }), ["Keep more in its storage: up to 1 MB, not 64 KB"]);
  assert.deepEqual(widerAccess({}, { network: "api.github.com" }), ["Reach api.github.com over the internet"]);
  assert.deepEqual(widerAccess({ network: "api.github.com" }, { network: "evil.example" }), ["Reach evil.example instead of api.github.com"], "another host is more, not the same");
  assert.equal(accessWords({ sessions: "all", storage: 1024, network: "api.github.com" }), "reads your sessions' titles and changes · keeps its own storage, up to 1 MB · reaches api.github.com");
});

test("storage: one per add-on, kept through its versions, within its quota", () => {
  const a = new Addons(home());
  a.install(todos({ storage: 1 }), { by: { agent: "x", at: 1 } }, FILES);
  a.store("todos", "note", "hi", 1);
  a.install(todos({ storage: 1 }), { by: { agent: "x", at: 1 } }, { ...FILES, "app.js": "// v2" });
  a.update("todos", { removed: true });
  assert.deepEqual(a.storage("todos"), { note: "hi" }, "a new version and a removal keep it");
  assert.throws(() => a.store("todos", "big", "x".repeat(2000), 1), /over the 1 KB it asked for/);
  a.store("todos", "note", undefined, 1);
  assert.deepEqual(a.storage("todos"), {});
  assert.equal(a.panel("todos"), null, "a removed panel doesn't run");
  a.update("todos", { removed: false, project: "p1" });
  assert.equal(a.panel("todos", "p2"), null, "nor one for another project");
  assert.equal(a.panel("todos", "p1")?.id, "todos");
});

/* ---------- The frame ---------- */

test("frame: the content policy and the bridge come first, its own files go in, nothing from elsewhere", () => {
  const doc = panelDocument({
    files: { "index.html": `<html><script>first()</script><head><link rel="stylesheet" href="s.css"><script src="https://cdn.example/x.js"></script></head><body class="b"><img src="dot.svg"><script src="./app.js"></script></body></html>`, "app.js": "go('</script>')", "s.css": "p{}", "dot.svg": "<svg/>" },
    entry: "index.html",
    access: {},
    theme: { "--ink": "#000" },
    place: "dock",
  });
  const csp = doc.indexOf("Content-Security-Policy");
  assert.ok(csp > 0 && csp < doc.indexOf("first()") && csp < doc.indexOf("<script"), "the policy before any script");
  assert.ok(doc.indexOf("window,\"liner\"") < doc.indexOf("first()"), "the bridge before the agent's first script, even one before <head>");
  assert.match(doc, /connect-src 'none'/);
  assert.doesNotMatch(doc, /cdn\.example/, "a script from elsewhere is left out");
  assert.match(doc, /<style>p\{\}<\/style>/);
  assert.match(doc, /go\('<\\\/script>'\)\n\/\/# sourceURL=app\.js<\/script>/, "its script inlined, closed safely, named after its file");
  assert.match(doc, /src="data:image\/svg\+xml;charset=utf-8,%3Csvg%2F%3E"/);
  assert.match(doc, /<body class="b">/);
  assert.equal((doc.match(/<head>/g) ?? []).length, 1, "one head, ours");
  assert.equal(panelPolicy({ network: "api.github.com" }).includes("connect-src https://api.github.com"), true);
  assert.doesNotMatch(panelPolicy({ network: "api.github.com" }), /\*|'self'/, "nothing but the one host");
});

/* ---------- addon_install for a panel ---------- */

function rig(answer: { allow: boolean; reason?: string; scope?: "all" | "project" }) {
  const root = mkdtempSync(join(tmpdir(), "lc-panel-session-"));
  const dir = home();
  const store = new Store(dir);
  store.putProject({ id: "p", name: "Sample project", path: root, git: false, createdAt: 1 });
  store.putThread({ id: "t", projectId: "p", title: "TODO panel", agent: "forge", status: "running", access: "auto", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  const addons = new Addons(dir);
  const tools = new AgentTools(store, process.env);
  tools.cwdOf = () => root;
  const asked: Parameters<AddonHost["askLiner"]>[1][] = [];
  const host: AddonHost = {
    keys: new Map(),
    providerInfo: [],
    askLiner(threadId, ask) {
      asked.push(ask);
      const id = `it-${asked.length}`;
      store.putItem(threadId, { kind: "approval", id, turn: 1, at: Date.now(), ...ask, state: "asking" });
      const it = store.item(threadId, id) as Extract<Item, { kind: "approval" }>;
      store.putItem(threadId, { ...it, state: answer.allow ? "approved" : "denied", reason: answer.reason });
      return { id, answer: Promise.resolve(answer) };
    },
    relink: async () => new Map(),
    readOnly: () => false,
    whoIs: () => "Opus 5.5",
    toolOf: () => ({ label: "Claude Code", family: "claude" }),
  };
  tools.addons = addons;
  tools.host = host;
  const write = (m: PanelManifest, files = FILES) => {
    const d = join(root, ".liner", "addons", m.id);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "addon.json"), JSON.stringify(m));
    for (const [p, c] of Object.entries(files)) writeFileSync(join(d, p), c);
  };
  return { store, addons, tools, asked, write };
}
const said = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? "").join("");

test("addon_install, a panel: asks with what it touches, and a yes adds it with its files", async () => {
  const x = rig({ allow: true, scope: "project" });
  x.write(todos());
  const r = await x.tools.call("t", "addon_install", { id: "todos" });
  assert.match(said(r), /^applied: TODOs \(v1\) is added in the right dock, in Sample project's sessions/);
  const ask = x.asked[0].addon as PanelAsk;
  assert.deepEqual([ask.kind, ask.place, ask.access, ask.files.map((f) => f.path).sort(), ask.next, x.asked[0].risk], ["panel", "dock", { files: "project", composer: true }, ["app.js", "index.html"], 1, "medium"]);
  assert.deepEqual(x.addons.files("todos"), FILES);
  assert.equal(x.addons.get("todos")?.project, "p");
  assert.equal(x.tools.pending.size, 0, "the preview is over once it's answered");
});

test("addon_install, a panel: the same access goes in without a card, more asks again, and a no keeps the one in use", async () => {
  const x = rig({ allow: true, scope: "all" });
  x.write(todos());
  await x.tools.call("t", "addon_install", { id: "todos" });
  x.write(todos(), { ...FILES, "app.js": "// grouped" });
  const same = await x.tools.call("t", "addon_install", { id: "todos" });
  assert.match(said(same), /^applied: TODOs is v2 now\. It asks for nothing more than v1 did, so it went in without a card/);
  assert.equal(x.asked.length, 1, "no second card");
  const line = x.store.timeline("t").filter((i): i is Extract<Item, { kind: "approval" }> => i.kind === "approval").at(-1)!;
  assert.deepEqual([line.state, (line.addon as PanelAsk).same, line.addon?.version, line.addon?.replaces], ["approved", true, 2, 1]);
  const again = await x.tools.call("t", "addon_install", { id: "todos" });
  assert.match(said(again), /already in as v2/);

  const no = rig({ allow: false, reason: "No storage" });
  no.write(todos());
  no.addons.install(todos(), { by: { agent: "x", at: 1 } }, FILES);
  no.write(todos({ files: "project", composer: true, storage: 64 }));
  const more = await no.tools.call("t", "addon_install", { id: "todos" });
  assert.match(said(more), /^denied: the person said no to TODOs, and said: “No storage”/);
  assert.deepEqual((no.asked[0].addon as PanelAsk).wider, ["Keep its own storage, up to 64 KB"]);
  assert.equal(no.addons.get("todos")?.version, 1, "the one in use stays");
});

test("addon_install, a panel: one that reaches the internet holds, and Never in Settings refuses it", async () => {
  const x = rig({ allow: true });
  x.write(todos({ network: "api.github.com" }));
  await x.tools.call("t", "addon_install", { id: "todos" });
  assert.equal(x.asked[0].risk, "high", "held to allow, like a push");
  const never = rig({ allow: true });
  never.store.setSettings({ addonNetwork: "never" });
  never.write(todos({ network: "api.github.com" }));
  const r = await never.tools.call("t", "addon_install", { id: "todos" });
  assert.equal(r.isError, true);
  assert.match(said(r), /never to reach the internet/);
  assert.equal(never.asked.length, 0);
});

/* ---------- The right dock ---------- */

test("dock: opening, toggling and closing tabs", () => {
  let d = dock.emptyDock();
  d = dock.showDock(d);
  assert.deepEqual(d.panes, [{ tabs: ["guide"], tab: "guide" }], "an empty dock opens on the guide");
  d = dock.openTab(d, "terminal");
  assert.deepEqual(d.panes, [{ tabs: ["terminal"], tab: "terminal" }], "the guide gives way to what you open");
  d = dock.openTab(d, "browser");
  assert.equal(dock.onScreen(d, "browser"), true);
  assert.equal(dock.behind(d, "terminal"), true);
  d = dock.toggleTab(d, "browser");
  assert.equal(d.open, false, "a surface that's up puts the dock away");
  assert.equal(dock.behind(d, "browser"), true, "still open, just hidden");
  d = dock.toggleTab(d, "terminal");
  assert.deepEqual([d.open, d.panes[0].tab], [true, "terminal"]);
  d = dock.closeTab(d, "terminal");
  assert.equal(d.panes[0].tab, "browser");
  d = dock.closeTab(d, "browser");
  assert.deepEqual(d, dock.emptyDock(), "the last tab hides the dock");
});

test("dock: two panes at most, chips move between them, and an emptied pane merges away", () => {
  let d = dock.openTab(dock.openTab(dock.emptyDock(), "terminal"), "app:todos");
  d = dock.split(d, 0);
  assert.deepEqual(d.panes, [{ tabs: ["terminal"], tab: "terminal" }, { tabs: ["app:todos"], tab: "app:todos" }], "the tab that's up moves into the new pane");
  assert.equal(dock.canSplit(d), false);
  assert.equal(dock.split(d, 1), d, "never a third");
  assert.equal(dock.moveTab(d, "terminal", 2), d, "nor by moving a tab past the last");
  d = dock.openTab(d, "browser", 0);
  d = dock.moveTab(d, "browser", 1, 0);
  assert.deepEqual(d.panes[1], { tabs: ["browser", "app:todos"], tab: "browser" });
  d = dock.moveTab(d, "terminal", 1);
  assert.deepEqual(d.panes, [{ tabs: ["browser", "app:todos", "terminal"], tab: "terminal" }], "the pane it left empty merged away");
  assert.equal(d.at, 0);
  d = dock.split(dock.openTab(dock.emptyDock(), "files"), 0);
  assert.deepEqual(d.panes.map((p) => p.tabs), [["files"], ["guide"]], "a lone tab stays; the new pane gets the guide");
  d = dock.openTab(d, "guide", 0);
  d = dock.moveTab(d, "guide", 1);
  assert.deepEqual(d.panes.map((p) => p.tabs), [["files"], ["guide"]], "one guide per pane: one arriving merges into it");
});

test("dock: a preview becomes its add-on in place, and a kept layout is read back only if it makes sense", () => {
  let d = dock.openTab(dock.openTab(dock.emptyDock(), "terminal"), "preview:it-1");
  d = dock.replaceTab(d, "preview:it-1", "app:todos");
  assert.deepEqual(d.panes[0], { tabs: ["terminal", "app:todos"], tab: "app:todos" });
  d = dock.closeWhere(d, (t) => t.startsWith("app:"));
  assert.deepEqual(d.panes[0].tabs, ["terminal"]);
  assert.deepEqual(dock.readDock(JSON.parse(JSON.stringify(d))), d);
  assert.equal(dock.readDock({ panes: [{ tabs: ["a"], tab: "a" }, { tabs: ["b"], tab: "b" }, { tabs: ["c"], tab: "c" }] }), null, "three panes isn't a dock");
  assert.equal(dock.readDock("nonsense"), null);
  assert.deepEqual(dock.readDock({ open: true, panes: [{ tabs: [], tab: "x" }, { tabs: ["a", "a", 3], tab: "zz" }], at: 9 }), { open: true, full: false, panes: [{ tabs: ["a"], tab: "a" }], at: 0 }, "empty panes, repeats and junk go");
});
