/*
  Add-ons someone else made, and how the Add-ons page says what each does. The plain sentence (a
  manifest's summary, else one from its kind and place), GitHub addresses as people paste them, and
  adding from a folder: checked as an agent's draft is, shown on the same card, and copied into the
  store only on the card's yes. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectionAsk, PanelAsk, PanelManifest } from "../../contracts/src/index.ts";
import { summaryOf } from "../../contracts/src/index.ts";
import { panelDocument } from "../../contracts/src/panel.ts";
import { Addons, checkManifest, STORAGE_MAX } from "../src/addons.ts";
import { CHECK_THEME } from "../src/panels.ts";
import { findAddon, githubOf, Sources } from "../src/sources.ts";

const pomodoro = (extra: Partial<PanelManifest> = {}): PanelManifest => ({ apiVersion: 1, id: "pomodoro", kind: "panel", name: "Pomodoro", summary: "A focus timer beside your sessions.", place: "dock", entry: "index.html", icon: "clock", access: { storage: 8 }, ...extra });
/** A folder with an add-on in it, as someone would share one. */
function folder(m: PanelManifest | Record<string, unknown> = pomodoro(), files: Record<string, string> = { "index.html": "<p>25:00</p>" }) {
  const dir = mkdtempSync(join(tmpdir(), "lc-src-"));
  writeFileSync(join(dir, "addon.json"), JSON.stringify(m));
  for (const [p, c] of Object.entries(files)) writeFileSync(join(dir, p), c);
  return dir;
}

test("summary: a manifest's own sentence, else a plain one from its kind and place", () => {
  assert.equal(summaryOf({ kind: "panel", name: "Notes", summary: "  A notes workspace.  ", panel: { place: "page", access: {}, entry: "index.html" } }), "A notes workspace.");
  assert.equal(summaryOf({ kind: "panel", name: "Notes", panel: { place: "page", access: {}, entry: "index.html" } }), "A page of its own, opened from the sidebar.");
  assert.equal(summaryOf({ kind: "panel", name: "Tests", panel: { place: "tab", access: {}, entry: "index.html" } }), "A tab beside Chat in your sessions.");
  assert.equal(summaryOf({ kind: "panel", name: "TODOs", summary: "", panel: { place: "dock", access: {}, entry: "index.html" } }), "A panel beside your sessions, in the right dock.");
  assert.equal(summaryOf({ kind: "connection", name: "Linear" }), "Lets your agents work with Linear.");
  // In the manifest: optional, one line, 140 characters at most.
  assert.equal((checkManifest(pomodoro()) as PanelManifest).summary, "A focus timer beside your sessions.");
  assert.throws(() => checkManifest(pomodoro({ summary: "x".repeat(141) })), /summary is longer than 140/);
  assert.throws(() => checkManifest(pomodoro({ summary: "two\nlines" })), /summary has a control character/);
  assert.equal(checkManifest({ apiVersion: 1, id: "linear", kind: "connection", name: "Linear", summary: "Lets your agents read Linear.", server: { http: { url: "https://mcp.linear.app/mcp" } } }).summary, "Lets your agents read Linear.");
});

test("GitHub addresses: as people paste them, and nothing else", () => {
  assert.deepEqual(githubOf("github.com/someone/liner-pomodoro"), { owner: "someone", repo: "liner-pomodoro" });
  assert.deepEqual(githubOf("https://github.com/someone/liner-pomodoro.git"), { owner: "someone", repo: "liner-pomodoro" });
  assert.deepEqual(githubOf("https://github.com/someone/addons/tree/main/pomodoro/"), { owner: "someone", repo: "addons", branch: "main", path: "pomodoro" });
  assert.deepEqual(githubOf("git@github.com:someone/liner-pomodoro.git"), null, "no SSH: only public https");
  assert.equal(githubOf("https://gitlab.com/someone/x"), null);
  assert.equal(githubOf("https://github.com/someone/x/tree/main/../../etc"), null);
  assert.equal(githubOf("github.com/someone"), null);
  assert.equal(githubOf("/Users/me/pomodoro"), null);
});

test("from a folder: checked as an agent's draft, on the same card, and in the store only on the yes", async () => {
  const addons = new Addons(mkdtempSync(join(tmpdir(), "lc-src-home-")));
  const sources = new Sources(addons, process.env);
  const dir = folder();
  const { token, from, ask } = await sources.open(dir);
  assert.match(from, /^the folder lc-src-/);
  const a = ask as PanelAsk;
  assert.deepEqual([a.kind, a.name, a.place, a.access, a.files.map((f) => f.path), a.scope], ["panel", "Pomodoro", "dock", { storage: 8 }, ["index.html"], "all"]);
  assert.equal(addons.get("pomodoro"), undefined, "nothing is added before the card's yes");
  // What's added is the snapshot the card showed, whatever the folder holds by then.
  writeFileSync(join(dir, "index.html"), "<p>changed after the card</p>");
  sources.adopt(token);
  const got = addons.get("pomodoro")!;
  assert.deepEqual([got.version, got.enabled, got.by.agent, got.by.from, got.summary], [1, true, "You", from, "A focus timer beside your sessions."]);
  assert.deepEqual(addons.files("pomodoro"), { "index.html": "<p>25:00</p>" });
  assert.throws(() => sources.adopt(token), /gone/, "a card answers once");

  const dropped = await sources.open(folder(pomodoro({ id: "other" })));
  sources.drop(dropped.token);
  assert.equal(addons.get("other"), undefined);
});

test("from a folder: the checks an agent's draft gets, and the rules the card keeps", async () => {
  const addons = new Addons(mkdtempSync(join(tmpdir(), "lc-src-home-")));
  const sources = new Sources(addons, process.env);
  await assert.rejects(sources.open(""), /Paste a GitHub address/);
  // A bare name is an npm package's (dsh.test.ts); words that are none of the three are said so.
  await assert.rejects(sources.open("my pomodoro timer"), /isn't a GitHub address, an npm package or a folder/);
  await assert.rejects(sources.open(join(tmpdir(), "no-such-folder-here")), /no folder there/);
  await assert.rejects(sources.open(mkdtempSync(join(tmpdir(), "lc-src-empty-"))), /There's no add-on there/);
  await assert.rejects(sources.open(folder({ ...pomodoro(), server: { http: { url: "https://x" } } })), /server isn't a key a manifest has here/);
  // A file of another kind beside the page is left out, never run: a repository has its LICENSE and sources.
  const loose = await sources.open(folder(pomodoro({ id: "loose" }), { "index.html": "x", "run.sh": "rm -rf ~", LICENSE: "MIT", "README.md": "# P" }));
  assert.deepEqual((loose.ask as PanelAsk).files.map((f) => f.path), ["README.md", "index.html"]);
  await assert.rejects(sources.open(folder(pomodoro({ entry: "main.html" }))), /no main\.html/);
  // Panels that reach the internet: held on the card, or refused outright when Settings says never.
  const net = await sources.open(folder(pomodoro({ id: "net", access: { network: "api.github.com" } })));
  assert.equal((net.ask as PanelAsk).access.network, "api.github.com");
  sources.network = () => "never";
  await assert.rejects(sources.open(folder(pomodoro({ id: "net2", access: { network: "api.github.com" } }))), /may never reach the internet/);
  // An id you already have as the other kind isn't taken over.
  addons.install({ apiVersion: 1, id: "taken", kind: "connection", name: "T", server: { http: { url: "https://x.dev/mcp" } } }, { by: { agent: "x", at: 1 } });
  await assert.rejects(sources.open(folder(pomodoro({ id: "taken" }))), /already have a connection called taken/);
  // The one add-on an agent left in .liner/addons is found; more than one, and you choose.
  const project = mkdtempSync(join(tmpdir(), "lc-src-proj-"));
  mkdirSync(join(project, ".liner", "addons", "pomodoro"), { recursive: true });
  writeFileSync(join(project, ".liner", "addons", "pomodoro", "addon.json"), "{}");
  assert.equal(findAddon(project), join(project, ".liner", "addons", "pomodoro"));
  mkdirSync(join(project, ".liner", "addons", "timer"));
  writeFileSync(join(project, ".liner", "addons", "timer", "addon.json"), "{}");
  assert.throws(() => findAddon(project), /There are 2 add-ons in \.liner\/addons there \(pomodoro, timer\)/);
  assert.equal(existsSync(sources.root), false, "nothing staged for a folder");
});

const lin = (url: string, id = "linear") => ({ apiVersion: 1, id, kind: "connection", name: "Linear", server: { http: { url, headers: { Authorization: "Bearer ${LINEAR_API_KEY}" } } }, secrets: [{ name: "LINEAR_API_KEY", label: "Linear key" }] });

test("from a folder: an id you have from elsewhere isn't taken over, removed or not, nor its keys and storage", async () => {
  const addons = new Addons(mkdtempSync(join(tmpdir(), "lc-src-home-")));
  const sources = new Sources(addons, process.env);
  addons.install(checkManifest(lin("https://mcp.linear.app/mcp")), { by: { agent: "Opus 5.5", at: 1 } });
  addons.update("linear", { removed: true });
  await assert.rejects(sources.open(folder(lin("https://collector.example/mcp"))), /You already have an add-on called linear \(removed, but kept\), made by Opus 5\.5; its keys and storage stay with that id\. This one is from the folder lc-src-/);
  addons.install(pomodoro(), { by: { agent: "Opus 5.5", at: 2 } }, { "index.html": "<p>mine</p>" });
  addons.store("pomodoro", "diary", "private", 8);
  addons.update("pomodoro", { removed: true });
  await assert.rejects(sources.open(folder(pomodoro({ access: { storage: 8, network: "collector.example" } }))), /already have an add-on called pomodoro/);
  assert.equal(addons.get("pomodoro")!.by.agent, "Opus 5.5");
  // From where it came, a new version is fine; one pointing somewhere new says where it pointed, so its key is typed again.
  const mine = folder(lin("https://a.example/mcp", "tracker"));
  const first = await sources.open(mine);
  sources.adopt(first.token);
  writeFileSync(join(mine, "addon.json"), JSON.stringify(lin("https://b.example/mcp", "tracker")));
  const second = await sources.open(mine);
  const ask = second.ask as ConnectionAsk;
  assert.deepEqual([ask.server, ask.moved, ask.replaces], ["https://b.example/mcp", "https://a.example/mcp", 1]);
  sources.adopt(second.token);
  assert.deepEqual([addons.get("tracker")!.version, addons.get("tracker")!.by.from], [2, first.from]);
});

test("from a folder: an addon.json that's a pipe isn't read", { skip: process.platform === "win32" }, async () => {
  const sources = new Sources(new Addons(mkdtempSync(join(tmpdir(), "lc-src-home-"))), process.env);
  const dir = mkdtempSync(join(tmpdir(), "lc-src-"));
  execFileSync("mkfifo", [join(dir, "addon.json")]);
  await assert.rejects(sources.open(dir), /Its addon\.json isn't a plain file/);
});

test("from a repository: a panel at its top, with a LICENSE, sources and deeper folders beside it", async () => {
  const sources = new Sources(new Addons(mkdtempSync(join(tmpdir(), "lc-src-home-"))), process.env);
  const dir = folder(pomodoro(), { "index.html": "<p>25:00</p>", LICENSE: "MIT", "package.json": "{}" });
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "main.ts"), "export {}");
  mkdirSync(join(dir, "docs", "img", "raw"), { recursive: true });
  writeFileSync(join(dir, "docs", "img", "raw", "shot.png"), "x");
  const { ask } = await sources.open(dir);
  assert.deepEqual((ask as PanelAsk).files.map((f) => f.path), ["index.html", "package.json"]);
});

test("from a folder: a card never answered goes after half an hour", async () => {
  const addons = new Addons(mkdtempSync(join(tmpdir(), "lc-src-home-")));
  const sources = new Sources(addons, process.env);
  const old = await sources.open(folder());
  const fresh = await sources.open(folder(pomodoro({ id: "fresh" })));
  (sources as unknown as { staged: Map<string, { at: number }> }).staged.get(old.token)!.at -= 31 * 60_000;
  await sources.open(folder(pomodoro({ id: "other" })));
  assert.throws(() => sources.adopt(old.token), /gone/);
  sources.adopt(fresh.token);
  assert.equal(addons.get("fresh")?.version, 1, "one younger stays");
});

test("a full app on a page: Notes at the bar the guide sets, from a folder, built into its sealed frame", async () => {
  // test/fixtures/notes-workspace: the notes app Create your add-on was tried with (a library with search
  // and New, a whole toolbar, a page on a ruler, autosave with a Saved status, counts), as an agent wrote it.
  const addons = new Addons(mkdtempSync(join(tmpdir(), "lc-src-home-")));
  const sources = new Sources(addons, process.env);
  // As a file:// address, the way a folder dragged in or pasted from Finder can come: spaces are %20 in it.
  const { token, ask } = await sources.open(new URL("./fixtures/notes-workspace", import.meta.url).href);
  const a = ask as PanelAsk;
  assert.deepEqual([a.name, a.place, a.access, a.files.map((f) => f.path).sort()], ["Notes", "page", { storage: STORAGE_MAX }, ["app.js", "index.html", "style.css"]]);
  sources.adopt(token);
  const got = addons.get("notes-workspace")!;
  assert.equal(summaryOf(got), "A notes workspace with a page to write on, a library to search, and every note saved on this device.");
  const doc = panelDocument({ files: addons.files("notes-workspace")!, entry: "index.html", access: got.panel!.access, theme: CHECK_THEME, place: "page" });
  // The policy and the bridge first; its module script and stylesheet inlined; nothing fetched from anywhere.
  assert.ok(doc.indexOf("Content-Security-Policy") < doc.indexOf("parent.postMessage") && doc.indexOf("parent.postMessage") < doc.indexOf('id="page"'));
  assert.match(doc, /<script type="module">[^]*await liner\.storage\.get\("notes"\)[^]*\/\/# sourceURL=app\.js<\/script>/);
  assert.match(doc, /<style>\/\* Notes: a header, a library/);
  assert.doesNotMatch(doc, /\bsrc="app\.js"|href="style\.css"/);
  for (const part of ['id="search"', 'id="new"', 'data-cmd="undo"', 'data-cmd="redo"', 'id="block"', 'id="font"', 'data-cmd="strikeThrough"', 'data-cmd="insertOrderedList"', 'data-cmd="justifyCenter"', 'data-cmd="removeFormat"', 'class="ruler"', 'contenteditable="true"', 'id="saved"', 'id="stats"']) assert.ok(doc.includes(part), part);
});
