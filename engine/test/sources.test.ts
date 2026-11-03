/*
  Add-ons someone else made, and how the Add-ons page says what each does. The plain sentence (a
  manifest's summary, else one from its kind and place), GitHub addresses as people paste them, and
  adding from a folder: checked as an agent's draft is, shown on the same card, and copied into the
  store only on the card's yes. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PanelAsk, PanelManifest } from "../../contracts/src/index.ts";
import { summaryOf } from "../../contracts/src/index.ts";
import { Addons, checkManifest } from "../src/addons.ts";
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
  await assert.rejects(sources.open("pomodoro"), /isn't a GitHub address or a folder/);
  await assert.rejects(sources.open(join(tmpdir(), "no-such-folder-here")), /no folder there/);
  await assert.rejects(sources.open(mkdtempSync(join(tmpdir(), "lc-src-empty-"))), /There's no add-on there/);
  await assert.rejects(sources.open(folder({ ...pomodoro(), server: { http: { url: "https://x" } } })), /server isn't a key a manifest has here/);
  await assert.rejects(sources.open(folder(pomodoro(), { "index.html": "x", "run.sh": "rm -rf ~" })), /run\.sh isn't a kind of file/);
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
