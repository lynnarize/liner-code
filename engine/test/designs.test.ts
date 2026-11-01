/*
  Designs: a page an agent draws as one HTML file in the session's folder, kept version by
  version, served for the Design surface, and never a turn's change to commit. design_show is
  the same call from every agent tool, so it's tested here through AgentTools, with the app's
  picture answered by hand. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineEvent, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { AgentTools } from "../src/agent-tools.ts";
import { capture, changes } from "../src/checkpoints.ts";
import { Designs, designPath, designsOf, slugOf } from "../src/designs.ts";
import { run } from "../src/exec.ts";
import { Proxies } from "../src/proxy.ts";
import { Store } from "../src/store.ts";

const thread = (id: string): Thread => ({ id, projectId: "p", title: "Designs", agent: "forge", status: "running", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
const page = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

function setup(root = mkdtempSync(join(tmpdir(), "lc-design-"))) {
  const home = mkdtempSync(join(tmpdir(), "lc-design-home-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: root, git: false, createdAt: 1 });
  store.putThread(thread("t"));
  const designs = new Designs(store);
  designs.cwdOf = () => root;
  designs.turnOf = () => 3;
  return { root, home, store, designs };
}

const get = (url: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    request(url, (r) => {
      let body = "";
      r.on("data", (c) => (body += c));
      r.on("end", () => resolve({ status: r.statusCode ?? 0, body }));
    })
      .on("error", reject)
      .end();
  });

test("designs: a title makes a file name, and a design's file stays in the folder and is HTML", () => {
  assert.equal(slugOf("Settings screen"), "settings-screen");
  assert.equal(slugOf("Café — Menü!"), "cafe-menu");
  assert.equal(slugOf("!!!"), "design");
  assert.equal(designPath("/p", ".liner/designs/a.html"), ".liner/designs/a.html");
  assert.equal(designPath("/p", "/p/mock/b.htm"), "mock/b.htm");
  assert.equal(designPath("/p", "file:///p/c.html?x=1"), "c.html");
  assert.throws(() => designPath("/p", "../elsewhere.html"), /inside this session's folder/);
  assert.throws(() => designPath("/p", "/etc/a.html"), /inside this session's folder/);
  assert.throws(() => designPath("/p", "notes.md"), /HTML file/);
});

test("designs: each show keeps a version; the same page keeps the last one; id, path or title find the design", () => {
  const { root, home, store, designs } = setup();
  const one = designs.show("t", { title: "Settings screen", html: page("one"), size: "phone" });
  assert.equal(one.fresh, true);
  assert.equal(one.item.path, ".liner/designs/settings-screen.html");
  assert.equal(one.item.version, 1);
  assert.equal(one.item.size, "phone");
  assert.equal(one.item.turn, 3);
  assert.equal(readFileSync(join(root, one.item.path), "utf8"), page("one"), "html is written to the file");
  assert.equal(readFileSync(join(home, "designs", "t", one.item.design, "v1.html"), "utf8"), page("one"), "and kept as a version");

  assert.equal(designs.show("t", { title: "Settings screen", path: one.item.path }).fresh, false, "nothing changed: no new version");

  // The agent edits the file with its own tools, then shows it again by its path.
  writeFileSync(join(root, one.item.path), page("two"));
  const two = designs.show("t", { title: "Settings screen", path: one.item.path, note: "Bigger buttons" });
  assert.deepEqual([two.item.design, two.item.version, two.item.size, two.item.note], [one.item.design, 2, "phone", "Bigger buttons"], "same design, its size kept");

  // Handed over whole again, by title, and by id.
  assert.equal(designs.show("t", { title: "settings SCREEN", html: page("three") }).item.version, 3);
  assert.equal(designs.show("t", { title: "Renamed", design: one.item.design, html: page("four") }).item.version, 4);
  assert.equal(designs.latest("t", one.item.design)?.title, "Renamed");

  const other = designs.show("t", { title: "Onboarding", html: page("hi") });
  assert.notEqual(other.item.design, one.item.design);
  assert.deepEqual(designsOf(store.timeline("t")).map((d) => [d.item.title, d.versions]), [["Onboarding", 1], ["Renamed", 4]], "newest first, with how many versions");

  // Another session in the same folder: its own file, never this one's.
  store.putThread({ ...thread("t2"), title: "Elsewhere" });
  const theirs = designs.show("t2", { title: "Onboarding", html: page("theirs") });
  assert.equal(theirs.item.path, ".liner/designs/onboarding-2.html");
  assert.equal(readFileSync(join(root, other.item.path), "utf8"), page("hi"), "the first session's design is left alone");

  assert.throws(() => designs.show("t", { title: "x", design: "dz_nope" }), /no design dz_nope/);
  assert.throws(() => designs.show("t", { title: "x", path: "missing.html" }), /no missing\.html yet/);
  assert.throws(() => designs.show("t", { title: "x", html: "   " }), /empty/);
  assert.throws(() => designs.show("t", { title: "x", path: "../out.html" }), /inside this session's folder/);
});

test("designs: read gives a version or the file as it is now; restore puts one back as a new version; built is remembered", () => {
  const { root, designs } = setup();
  const d = designs.show("t", { title: "Card", html: page("v1") }).item;
  writeFileSync(join(root, d.path), page("v2"));
  designs.show("t", { title: "Card", path: d.path });
  writeFileSync(join(root, d.path), page("being edited"));
  assert.equal(designs.read("t", d.design).html, page("being edited"), "no version: the file now");
  assert.equal(designs.read("t", d.design, 1).html, page("v1"));
  assert.throws(() => designs.read("t", d.design, 9), /isn't kept/);

  const back = designs.restore("t", d.design, 1);
  assert.deepEqual([back.version, back.note], [3, "Back to version 1"]);
  assert.equal(readFileSync(join(root, d.path), "utf8"), page("v1"));

  assert.equal(designs.list("t")[0].built, undefined);
  const listed = designs.built("t", d.design, 2);
  assert.equal(listed[0].built?.version, 2);
  assert.equal(listed[0].versions, 3);
  assert.throws(() => designs.built("t", "dz_nope", 1), /isn't in this session/);
});

test("designs: .liner/ stays out of git, in its exclude and in every snapshot", async () => {
  const root = mkdtempSync(join(tmpdir(), "lc-design-git-"));
  const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@e.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@e.com" };
  await run("git", ["init", "-q", "-b", "main"], { cwd: root, env });
  writeFileSync(join(root, "app.js"), "1\n");
  await run("git", ["add", "-A"], { cwd: root, env });
  await run("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "start"], { cwd: root, env });
  const { designs } = setup(root);

  const before = await capture(root, "d/1-before");
  designs.show("t", { title: "Home", html: page("home") });
  writeFileSync(join(root, "app.js"), "2\n");
  const after = await capture(root, "d/1-after");
  assert.ok(before, "before"); assert.ok(after, "after");
  assert.deepEqual((await changes(root, before, after)).map((f) => f.path), ["app.js"], "the design isn't a change");

  // Its exclude is written once, a moment after the first design.
  for (let i = 0; i < 50 && !readFileSync(join(root, ".git/info/exclude"), "utf8").includes(".liner/"); i++) await new Promise((r) => setTimeout(r, 20));
  const exclude = readFileSync(join(root, ".git/info/exclude"), "utf8");
  assert.match(exclude, /^\.liner\/$/m);
  designs.show("t", { title: "Home", html: page("home 2") });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(readFileSync(join(root, ".git/info/exclude"), "utf8"), exclude, "only once");
  assert.equal((await run("git", ["status", "--porcelain"], { cwd: root })).stdout.includes(".liner"), false);

  // Ignored now, and snapshots still go: git refuses a plain exclude of an ignored path.
  writeFileSync(join(root, "app.js"), "3\n");
  const next = await capture(root, "d/2-after");
  assert.ok(next, "a snapshot with .liner/ ignored");
  assert.deepEqual((await changes(root, after, next)).map((f) => f.path), ["app.js"]);
});

test("designs: the folder's server serves .liner/designs/, and nothing else hidden", async () => {
  const root = mkdtempSync(join(tmpdir(), "lc-design-serve-"));
  mkdirSync(join(root, ".liner/designs/.private"), { recursive: true });
  writeFileSync(join(root, ".liner/designs/a.html"), page("design a"));
  writeFileSync(join(root, ".liner/designs/.private/b.html"), page("hidden"));
  writeFileSync(join(root, ".liner/secret.txt"), "no");
  const proxies = new Proxies();
  try {
    const base = await proxies.files(root);
    const a = await get(`${base}/.liner/designs/a.html`);
    assert.equal(a.status, 200);
    assert.match(a.body, /__liner\/probe\.js[\s\S]*design a/, "with the probe, so you can pick its parts");
    assert.equal((await get(`${base}/.liner/secret.txt`)).status, 404);
    assert.equal((await get(`${base}/.liner/designs/.private/b.html`)).status, 404);
    assert.equal((await get(`${base}/.liner/designs/%2e%2e/secret.txt`)).status, 404);
  } finally {
    proxies.closeAll();
  }
});

test("design_show: any agent's call keeps a version and gets back the app's picture of it, or says why not", async () => {
  const { root, store, designs } = setup();
  const tools = new AgentTools(store, process.env);
  tools.designs = designs;
  tools.cwdOf = () => root;
  tools.filesUrl = async () => "http://127.0.0.1:1";
  // The app draws the page out of sight and answers.
  const asked: EngineEvent[] = [];
  store.on((e) => {
    if (e.type !== "agent.browser" || e.op !== "shot") return;
    asked.push(e);
    tools.reply(e.id, true, { png: "UE5H", errors: ["Uncaught x is not defined"], height: 1900 });
  });
  const r = await tools.call("t", "design_show", { title: "Pricing", html: page("plans"), size: "Tablet", note: "" });
  assert.equal(r.isError, undefined);
  const said = r.content[0].type === "text" ? r.content[0].text : "";
  assert.match(said, /Showing “Pricing”, version 1, in the Design surface/);
  assert.match(said, /file \.liner\/designs\/pricing\.html, drawn tablet/);
  assert.match(said, /1900 px tall at 834 px wide/);
  assert.match(said, /Uncaught x is not defined/);
  assert.deepEqual(r.content[1], { type: "image", data: "UE5H", mimeType: "image/png" });
  const shot = asked[0];
  assert.ok(shot && shot.type === "agent.browser");
  assert.deepEqual(shot.args, { url: "http://127.0.0.1:1/.liner/designs/pricing.html", width: 834, height: 1112 });
  assert.ok(existsSync(join(root, ".liner/designs/pricing.html")));

  // No window to draw it: the version is kept all the same.
  const quiet = new AgentTools(store, process.env);
  quiet.designs = designs;
  quiet.cwdOf = () => root;
  const r2 = await quiet.call("t", "design_show", { title: "Pricing", html: page("plans, cheaper") });
  assert.match(r2.content[0].type === "text" ? r2.content[0].text : "", /version 2[\s\S]*No picture of it: its folder isn't served/);
  assert.equal((await quiet.call("t", "design_show", { title: "Pricing", size: "watch" })).isError, true);
});
