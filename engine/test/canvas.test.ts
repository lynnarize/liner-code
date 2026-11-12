/*
  Liner Design's canvas: design files of a folder, frames as HTML files with data-l ids stamped
  in without disturbing the rest, the tools an agent draws with (any provider: they're Liner
  Code's MCP tools), the watcher that tells an agent's edit from the engine's own, presence from
  the runtime's tool rows, and a copy per turn. Everything on temp folders, with the app's
  picture answered by hand. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineEvent, Item, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import type { DesignFile } from "../../contracts/src/design.ts";
import * as canvas from "../src/canvas.ts";
import { designCtx, type DesignCall } from "../src/canvas.ts";
import { applyOps, attr, byId, decode, elements, outline, parse, replaceNode, stamp, stampGuard } from "../src/canvas-html.ts";
import { AgentTools } from "../src/agent-tools.ts";
import * as buildlinks from "../src/buildlinks.ts";
import { Designs } from "../src/designs.ts";
import { Store } from "../src/store.ts";

const thread = (id: string, status: Thread["status"] = "running"): Thread => ({ id, projectId: "p", title: "Canvas", agent: "forge", status, access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
const page = (body: string) => `<!doctype html>\n<html>\n<head>\n<title>t</title>\n<style>p { color: red; }</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The file with every stamped id taken back out. */
const unstamped = (html: string) => html.replace(/ data-l="[a-z][a-z0-9]{3,}"/g, "");
const ids = (html: string) => [...html.matchAll(/data-l="([^"]+)"/g)].map((m) => m[1]);

function setup(o: Partial<Parameters<typeof designCtx>[1]> = {}) {
  const root = mkdtempSync(join(tmpdir(), "lc-canvas-"));
  const home = mkdtempSync(join(tmpdir(), "lc-canvas-home-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: root, git: false, createdAt: 1 });
  store.putThread(thread("t"));
  const events: EngineEvent[] = [];
  store.on((e) => events.push(e));
  const ctx = designCtx(store, { whoIs: (_id, sidekick) => (sidekick ? "Kimi" : "Opus 5.5"), ...o });
  const api = canvas.rpc(() => ctx);
  const at = (sidekick = false): DesignCall => ({ ...ctx, threadId: "t", sidekick });
  const changed = () => events.filter((e): e is Extract<EngineEvent, { type: "canvas.changed" }> => e.type === "canvas.changed");
  const presence = () => events.filter((e): e is Extract<EngineEvent, { type: "canvas.presence" }> => e.type === "canvas.presence");
  return { root, home, store, ctx, api, at, events, changed, presence };
}

const said = (r: { content: { type: string; text?: string }[] }) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

test("canvas html: every element in the body gets an id, and nothing else in the file moves", () => {
  const html = page(`<main class="today">\n  <h1>Today</h1>\n  <p>High tide <b>4:12</b> &amp; low</p>\n  <img src=a.png alt="Sea">\n  <svg viewBox="0 0 2 2"><path d="M0 0"/></svg>\n  <script>if (a < b) document.body.append("<div>")</script>\n</main>`);
  const once = stamp(html);
  assert.equal(once.added, 7, "body, main, h1, p, b, img, svg: not path, script or the head");
  assert.equal(unstamped(once.html), html, "taking the ids out gives back the file byte for byte");
  assert.equal(stamp(once.html).html, once.html, "stamping twice is stamping once");
  assert.equal(stamp(once.html).added, 0);
  assert.equal(new Set(ids(once.html)).size, 7, "unique in the frame");
  // The id goes in right after the tag's name.
  assert.match(once.html, /<main data-l="[a-z0-9]+" class="today">/);
  assert.match(once.html, /<script>if \(a < b\) document\.body\.append\("<div>"\)<\/script>/, "script text isn't read as tags");
});

test("canvas html: an id that's there never changes; a repeated or broken one gets a fresh one", () => {
  const html = page(`<div data-l="keep"><p data-l='also'>a</p><p data-l="keep">copied</p><span data-l>x</span><i data-l="has space">y</i></div>`);
  const out = stamp(html).html;
  assert.match(out, /<div data-l="keep">/);
  assert.match(out, /<p data-l='also'>a<\/p>/, "its own quotes kept");
  const doc = parse(out);
  const all = ids(out).concat([...out.matchAll(/data-l='([^']+)'/g)].map((m) => m[1]));
  assert.equal(new Set(all).size, all.length, "no id twice");
  assert.ok(!out.includes('data-l="has space"'));
  assert.ok(doc.root.children.length > 0);
  // Only the two broken ones and the body changed.
  assert.equal(stamp(out).html, out);
});

test("canvas html: implied ends and fragments read as a browser would", () => {
  const o = outline(stamp(`<ul><li>One<li>Two</ul><p>a<div>b</div>`).html);
  assert.ok(o);
  assert.equal(o.tag, "#document");
  assert.deepEqual(o.children.map((c) => c.tag), ["ul", "p", "div"], "a div closes the p before it");
  assert.equal(o.children[0].children.length, 2, "an li closes the li before it");
  assert.equal(o.children[0].kind, "stack");
  assert.equal(o.children[0].children[1].text, "Two");
  // A page with <html> and a head but no <body> tag: what's beside the head is its body.
  const bare = stamp(`<html><head><title>x</title></head><div><p>a</p></div></html>`);
  assert.equal(bare.added, 2);
  assert.deepEqual(outline(bare.html)?.children.map((c) => [c.tag, c.children.length]), [["div", 1]]);
});

test("canvas html: replacing a node keeps its id and every other one", () => {
  const html = stamp(page(`<main data-l="m"><h1 data-l="h">Today</h1><section data-l="s"><p data-l="p1">a</p><p data-l="p2">b</p></section><footer data-l="f">x</footer></main>`)).html;
  const out = replaceNode(html, "s", `<section class="cards"><p data-l="p1">A</p><p>new</p></section>`);
  assert.match(out, /<section data-l="s" class="cards">/);
  for (const id of ["m", "h", "s", "p1", "f"]) assert.ok(ids(out).includes(id), `${id} is kept`);
  // The new second p stands where p2 was, with the same tag: it takes p2's id (round 6, carryIds).
  assert.match(out, /<p data-l="p2">new<\/p>/);
  assert.equal(new Set(ids(out)).size, ids(out).length);
  assert.ok(out.startsWith(html.slice(0, html.indexOf("<section"))), "what's before it is the same");
  assert.ok(out.endsWith(html.slice(html.indexOf("<footer"))), "what's after it is the same");
  assert.throws(() => replaceNode(html, "nope", "<p>x</p>"), /no element with data-l="nope"/);
});

test("canvas: create, open and save round trip; files an agent wrote by itself join on open", async () => {
  const { root, api } = setup();
  const made = await api["canvas.create"]({ cwd: root, title: "Foreshore", size: "phone" });
  assert.equal(made.id, "foreshore");
  assert.deepEqual(made.frames.map((f) => [f.id, f.w, f.h, f.path]), [["phone", 390, 844, "frames/phone.html"]]);
  assert.ok(existsSync(join(root, ".liner/designs/foreshore/design.json")));
  assert.equal((await api["canvas.create"]({ cwd: root, title: "Foreshore" })).id, "foreshore-2", "a taken name gets a number");

  const saved = await api["canvas.save"]({ cwd: root, file: "foreshore", patch: { title: "Foreshore tides", pages: [{ id: "p1", name: "Screens" }, { id: "p2", name: "Brand" }], frames: [{ id: "phone", x: 40, y: 60, w: 400, name: "Phone / Today", page: "p2" }], pictures: { ask: "always" }, lean: { path: "DESIGN.md", skills: ["liner-2"] } } });
  assert.equal(saved.title, "Foreshore tides");
  assert.deepEqual([saved.frames[0].x, saved.frames[0].y, saved.frames[0].w, saved.frames[0].name, saved.frames[0].page], [40, 60, 400, "Phone / Today", "p2"]);

  // A frame the agent wrote with its own Write tool.
  writeFileSync(join(root, ".liner/designs/foreshore/frames/week.html"), page(`<meta name="viewport" content="width=390"><div>Week</div>`));
  const { file, base } = await api["canvas.open"]({ cwd: root, file: "foreshore" });
  assert.equal(base, "", "nothing serves files in a test");
  assert.deepEqual(file, { ...saved, frames: [...saved.frames, { id: "week", page: "p1", name: "Week", kind: "drawn", path: "frames/week.html", x: 0, y: 0, w: 390, h: 844 }] });
  const again = JSON.parse(readFileSync(join(root, ".liner/designs/foreshore/design.json"), "utf8")) as DesignFile;
  const { pictures: engines, ...onDisk } = file;
  assert.deepEqual(again, onDisk, "what open gave is what's on disk, but the picture setting (the engine's, design-prefs.ts)");
  assert.deepEqual(engines, { ask: "always" });

  const list = await api["canvas.list"]({ cwd: root });
  assert.deepEqual(list.map((x) => [x.id, x.frames]).sort(), [["foreshore", 2], ["foreshore-2", 0]]);
  await assert.rejects(async () => api["canvas.list"]({ cwd: "/somewhere/else" }), /isn't one of your projects/);
});

test("canvas: a design.json made from loose frames; a frame whose file went comes off on open", async () => {
  const { root, api } = setup();
  mkdirSync(join(root, ".liner/designs/loose/frames"), { recursive: true });
  writeFileSync(join(root, ".liner/designs/loose/frames/home.html"), page("<p>Home</p>"));
  writeFileSync(join(root, ".liner/designs/loose/frames/about.html"), page("<p>About</p>"));
  const { file } = await api["canvas.open"]({ cwd: root, file: "loose" });
  assert.deepEqual(file.frames.map((f) => [f.id, f.x, f.w]), [["about", 0, 1280], ["home", 1440, 1280]]);
  await api["canvas.frame.remove"]({ cwd: root, file: "loose", frame: "about" });
  assert.ok(!existsSync(join(root, ".liner/designs/loose/frames/about.html")));
  const copy = await api["canvas.frame.copy"]({ cwd: root, file: "loose", frame: "home" });
  assert.deepEqual(copy.frames.map((f) => f.name), ["Home", "Home copy"]);
  // Reading for the copy stamps it in memory only: the copy holds the same page with the ids the original's page gives.
  assert.equal(readFileSync(join(root, ".liner/designs/loose/frames/home-copy.html"), "utf8"), stamp(readFileSync(join(root, ".liner/designs/loose/frames/home.html"), "utf8")).html);
});

test("canvas: paths, names and sizes that lead out or can't be are refused", async () => {
  const { root, api } = setup();
  await api["canvas.create"]({ cwd: root, title: "Safe" });
  await assert.rejects(async () => api["canvas.open"]({ cwd: root, file: "../../etc" }), /isn't a design file's name/);
  await assert.rejects(async () => api["canvas.frame.read"]({ cwd: root, file: "safe/../x", frame: "a" }), /isn't a design file's name/);
  await assert.rejects(async () => api["canvas.frame.add"]({ cwd: root, file: "safe", frame: { name: "Huge", w: 9000, h: 800 } }), /40 to 8000 px/);
  await assert.rejects(async () => api["canvas.frame.add"]({ cwd: root, file: "safe", frame: { name: "Tiny", w: 20, h: 800 } }), /40 to 8000 px/);
  await assert.rejects(async () => api["canvas.frame.add"]({ cwd: root, file: "safe", frame: { name: "Out", w: 400, h: 800, kind: "live", url: "https://example.com" } }), /running on this Mac/);
  await assert.rejects(async () => api["canvas.save"]({ cwd: root, file: "safe", patch: { lean: { path: "../outside.md", skills: [] } } }), /inside this folder/);
  await assert.rejects(async () => api["canvas.save"]({ cwd: root, file: "safe", patch: { pages: [] } }), /at least one page/);

  // A design.json that names a frame outside its folder: that frame isn't read.
  writeFileSync(join(root, ".liner/designs/safe/design.json"), JSON.stringify({ v: 1, title: "Safe", pages: [{ id: "p1", name: "P" }], frames: [{ id: "evil", page: "p1", name: "Evil", kind: "drawn", path: "../../../secret.html", x: 0, y: 0, w: 400, h: 400 }], lean: { skills: [] } }));
  const { file } = await api["canvas.open"]({ cwd: root, file: "safe" });
  assert.deepEqual(file.frames, []);

  // A frame's file that is a link out of the folder is neither read nor written through.
  const outside = mkdtempSync(join(tmpdir(), "lc-canvas-out-"));
  writeFileSync(join(outside, "x.html"), "secret");
  const live = await api["canvas.frame.add"]({ cwd: root, file: "safe", frame: { name: "Linked", w: 400, h: 400 } });
  const f = live.frames.find((x) => x.name === "Linked")!;
  const abs = join(root, ".liner/designs/safe", f.path!);
  const { rmSync } = await import("node:fs");
  rmSync(abs);
  symlinkSync(join(outside, "x.html"), abs);
  await assert.rejects(async () => api["canvas.frame.read"]({ cwd: root, file: "safe", frame: f.id }), /is a link/);
  await assert.rejects(async () => api["canvas.frame.write"]({ cwd: root, file: "safe", frame: f.id, html: page("<p>x</p>") }), /is a link/);
  assert.equal(readFileSync(join(outside, "x.html"), "utf8"), "secret");
});

test("canvas: reading a frame stamps it once and keeps those ids; writing says it was you", async () => {
  const { root, api, changed } = setup();
  await api["canvas.create"]({ cwd: root, title: "Ids" });
  const raw = page(`<div class="card">\n  <p>Hello</p>\n</div>`);
  await api["canvas.frame.add"]({ cwd: root, file: "ids", frame: { name: "Card", w: 400, h: 300 }, html: raw });
  const first = (await api["canvas.frame.read"]({ cwd: root, file: "ids", frame: "Card" })).html;
  assert.equal(unstamped(first), raw);
  assert.equal((await api["canvas.frame.read"]({ cwd: root, file: "ids", frame: "card" })).html, first, "the same ids each read");
  const next = first.replace("Hello", "Hi there");
  await api["canvas.frame.write"]({ cwd: root, file: "ids", frame: "card", html: next, threadId: "t" });
  assert.equal(readFileSync(join(root, ".liner/designs/ids/frames/card.html"), "utf8"), next);
  assert.deepEqual(changed().map((e) => [e.file, e.frame, e.by, e.threadId]), [["ids", "card", "you", "t"]]);
});

test("canvas: the watcher tells an agent's edit from the engine's own", async () => {
  const { root, api, changed, ctx } = setup();
  await api["canvas.create"]({ cwd: root, title: "Watched", size: "desktop" });
  await api["canvas.watch"]({ cwd: root, file: "watched", on: true });
  await wait(100);
  const html = (await api["canvas.frame.read"]({ cwd: root, file: "watched", frame: "desktop" })).html;
  await api["canvas.frame.write"]({ cwd: root, file: "watched", frame: "desktop", html: html.replace("<body", "<body class=\"a\"") });
  await wait(600);
  assert.deepEqual(changed().map((e) => e.by), ["you"], "the engine's own write is said once, as yours");

  // The agent edits the file with its own tool.
  writeFileSync(join(root, ".liner/designs/watched/frames/desktop.html"), html.replace("</body>", "<p>new</p></body>"));
  // And writes a new frame by itself.
  writeFileSync(join(root, ".liner/designs/watched/frames/extra.html"), page("<p>extra</p>"));
  await wait(800);
  const agent = changed().filter((e) => e.by === "agent");
  assert.deepEqual([...new Set(agent.map((e) => e.frame))].sort(), ["desktop", "extra"]);
  assert.ok(agent.every((e) => e.threadId === "t"), "the session whose turn runs in that folder");
  assert.ok((await api["canvas.open"]({ cwd: root, file: "watched" })).file.frames.some((f) => f.id === "extra"), "the new file is on the canvas");
  await api["canvas.watch"]({ cwd: root, file: "watched", on: false });
  const n = changed().length;
  writeFileSync(join(root, ".liner/designs/watched/frames/desktop.html"), page("<p>later</p>"));
  await wait(500);
  assert.equal(changed().length, n, "nothing once it's not watched");
  ctx.close();
});

test("canvas: a copy per turn that changed a design; restore puts one back as a change", async () => {
  const { root, home, store, api, changed, ctx } = setup();
  await api["canvas.create"]({ cwd: root, title: "Turns", size: "phone" });
  await wait(0);
  const turn = (n: number, status: "running" | "done"): Item => ({ kind: "turn", id: `turn${n}`, turn: n, at: Date.now(), agent: "forge", model: "demo:x", status });
  // A turn's copies are taken off the engine's loop: wait for them as the engine would before a restore.
  const step = async (it: Item) => (store.putItem("t", it), await canvas.canvasIdle(ctx));
  const frame = join(root, ".liner/designs/turns/frames/phone.html");
  const before = readFileSync(frame, "utf8");

  await step(turn(1, "running"));
  writeFileSync(frame, before.replace("</body>", "<p>one</p></body>"));
  await step(turn(1, "done"));
  await step(turn(2, "running"));
  await step(turn(2, "done"));
  await step(turn(3, "running"));
  writeFileSync(frame, before.replace("</body>", "<p>three</p></body>"));
  await step(turn(3, "done"));

  const vs = await api["canvas.versions"]({ threadId: "t", file: "turns" });
  assert.deepEqual(vs.map((v) => [v.turn, v.frames, v.key, v.kind]), [[0, 1, "t0", "turn"], [1, 1, "t1", "turn"], [3, 1, "t3", "turn"]], "as it was before, and the turns that changed it; not turn 2");
  assert.ok(existsSync(join(home, "designs/t/canvas/turns/t1/frames/phone.html")), "kept under the session's designs, so a fork copies it");
  assert.match(readFileSync(join(home, "designs/t/canvas/turns/t1/frames/phone.html"), "utf8"), /one/);

  const back = await api["canvas.restore"]({ threadId: "t", file: "turns", turn: 1 });
  assert.equal(back.frames.length, 1);
  assert.match(readFileSync(frame, "utf8"), /<p>one<\/p>/);
  assert.equal(changed().at(-1)?.by, "you");
  await assert.rejects(async () => api["canvas.restore"]({ threadId: "t", file: "turns", turn: 9 }), /isn't kept/);
  await assert.rejects(async () => api["canvas.versions"]({ threadId: "../x", file: "turns" }), /No thread/);
});

test("canvas: a kept turn reads back as it was, after the file moved on; nothing else is read", async () => {
  const { root, store, api, ctx } = setup();
  await api["canvas.create"]({ cwd: root, title: "Turns", size: "phone" });
  await wait(0);
  const turn = (n: number, status: "running" | "done"): Item => ({ kind: "turn", id: `turn${n}`, turn: n, at: Date.now(), agent: "forge", model: "demo:x", status });
  // A turn's copies are taken off the engine's loop: wait for them as the engine would before a restore.
  const step = async (it: Item) => (store.putItem("t", it), await canvas.canvasIdle(ctx));
  const frame = join(root, ".liner/designs/turns/frames/phone.html");
  const before = readFileSync(frame, "utf8");
  await step(turn(1, "running"));
  writeFileSync(frame, before.replace("</body>", "<p>one</p></body>"));
  await step(turn(1, "done"));
  await step(turn(2, "running"));
  writeFileSync(frame, before.replace("</body>", "<p>two</p></body>"));
  await step(turn(2, "done"));

  const one = await api["canvas.version.read"]({ threadId: "t", file: "turns", turn: 1 });
  assert.deepEqual(one.file.frames.map((f) => f.id), ["phone"]);
  assert.match(one.html.phone, /<p[^>]*>one<\/p>/, "turn 1's frame, not today's");
  assert.ok(!one.html.phone.includes("two"));
  assert.match(readFileSync(frame, "utf8"), /two/, "reading writes nothing back");
  await assert.rejects(async () => api["canvas.version.read"]({ threadId: "t", file: "turns", turn: 7 }), /isn't kept/);
  await assert.rejects(async () => api["canvas.version.read"]({ threadId: "t", file: "turns", turn: -1 }), /isn't kept/);
  await assert.rejects(async () => api["canvas.version.read"]({ threadId: "t", file: "../turns", turn: 1 }), /isn't a design file's name/);
  await assert.rejects(async () => api["canvas.version.read"]({ threadId: "t", file: "turns/../../x", turn: 1 }), /isn't a design file's name/);
  await assert.rejects(async () => api["canvas.version.read"]({ threadId: "../t", file: "turns", turn: 1 }), /No thread/);
});

test("canvas: an old single-HTML design comes in as a frame at its size", async () => {
  const { root, store, api } = setup();
  const designs = new Designs(store);
  designs.cwdOf = () => root;
  const { item } = designs.show("t", { title: "Settings", html: page("<h1>Settings</h1>"), size: "tablet" });
  const { api: api2 } = { api: canvas.rpc(() => ({ ...designCtx(store), designs })) };
  await api["canvas.create"]({ cwd: root, title: "Adopted" });
  const file = await api2["canvas.frame.add"]({ cwd: root, file: "adopted", frame: { name: "", w: 0, h: 0, adopt: { threadId: "t", design: item.design } } });
  assert.deepEqual(file.frames.map((f) => [f.name, f.w, f.h]), [["Settings", 834, 1112]]);
  assert.match(readFileSync(join(root, ".liner/designs/adopted/frames/settings.html"), "utf8"), /<h1 data-l="[a-z0-9]+">Settings<\/h1>/);
});

test("canvas tools: draw a frame, read its outline, change one node, look at it", async () => {
  const shots: { url: string; width: number; height: number }[] = [];
  const { root, at, changed, presence, api } = setup({ filesUrl: async () => "http://127.0.0.1:9/files", shot: async (_t, p) => (shots.push(p), { png: "UE5H", height: 900 }) });
  assert.match(said(await canvas.call("design_files", {}, at())), /no design files in this folder yet/);

  const drawn = await canvas.call("design_frame", { name: "Phone / Today", width: 390, height: 844, html: page(`<main><h1>Today</h1><p class="tide">4:12</p></main>`) }, at());
  assert.match(said(drawn), /Drew the frame “Phone \/ Today” \(id phone-today, 390 × 844\) in the design file design/);
  assert.equal(drawn.content[1].type, "image");
  assert.deepEqual(shots[0], { url: "http://127.0.0.1:9/files/.liner/designs/design/frames/phone-today.html", width: 390, height: 844 });
  assert.equal(changed().at(-1)?.by, "agent");

  const files = said(await canvas.call("design_files", {}, at()));
  assert.match(files, /“Design” \(design design, \.liner\/designs\/design\/\)/);
  assert.match(files, /- phone-today · “Phone \/ Today” · 390 × 844 · \.liner\/designs\/design\/frames\/phone-today\.html/);

  const tree = said(await canvas.call("design_tree", { frame: "Phone / Today" }, at()));
  const tide = /<p> ([a-z0-9]+) “tide” · text · “4:12”/.exec(tree)?.[1];
  assert.ok(tide, tree);
  const h1 = /<h1> ([a-z0-9]+) · text · “Today”/.exec(tree)?.[1];
  assert.ok(h1, tree);

  assert.match(said(await canvas.call("design_node", { frame: "phone-today", id: tide }, at())), new RegExp(`<p data-l="${tide}" class="tide">4:12</p>`));
  const n = presence().length;
  const changedNode = said(await canvas.call("design_node", { frame: "phone-today", id: tide, html: `<p class="tide big">4:15 <small>high</small></p>` }, at(true)));
  assert.match(changedNode, new RegExp(`<p data-l="${tide}" class="tide big">4:15 <small data-l="[a-z0-9]+">high</small></p>`));
  const html = readFileSync(join(root, ".liner/designs/design/frames/phone-today.html"), "utf8");
  assert.ok(html.includes(`data-l="${h1}"`), "the other ids stay");
  assert.deepEqual(presence().slice(n).map((p) => [p.frame, p.agent, p.name, p.on]), [["phone-today", "sidekick", "Kimi", true], ["phone-today", "sidekick", "Kimi", false]]);

  // The same name replaces that frame.
  await canvas.call("design_frame", { name: "phone / today", width: 390, height: 900, html: page("<p>again</p>") }, at());
  assert.deepEqual((await api["canvas.open"]({ cwd: root, file: "design" })).file.frames.map((f) => [f.id, f.h]), [["phone-today", 900]]);

  const look = await canvas.call("design_shot", { frame: "phone-today" }, at());
  assert.match(said(look), /It is 900 px tall at 390 px wide/);

  await assert.rejects(canvas.call("design_tree", { frame: "nope" }, at()), /no frame “nope”.*phone-today/);
  await assert.rejects(canvas.call("design_frame", { name: "x", width: 10, height: 10, html: "<p>x</p>" }, at()), /40 to 8000/);
  await assert.rejects(canvas.call("design_frame", { name: "x", width: 400, height: 400, path: "../../etc/passwd.html" }, at()), /inside this session's folder/);
  writeFileSync(join(root, "mock.html"), page("<p>From a file</p>"));
  assert.match(said(await canvas.call("design_frame", { name: "From file", width: 400, height: 400, path: "mock.html" }, at())), /Drew the frame “From file”/);
});

test("canvas tools: a read-only session doesn't write; selection is what the app last said", async () => {
  const { root, api, ctx } = setup({ readOnly: () => true });
  await api["canvas.create"]({ cwd: root, title: "Sel", size: "phone" });
  const at: DesignCall = { ...ctx, threadId: "t", sidekick: false };
  await assert.rejects(canvas.call("design_frame", { name: "x", width: 400, height: 400, html: "<p>x</p>" }, at), /is at Read only now/);
  assert.match(said(await canvas.call("design_selection", {}, at)), /Nothing is selected/);
  await api["canvas.selection"]({ threadId: "t", sel: { file: "sel", frames: ["phone"], nodes: [{ frame: "phone", id: "ab12", html: "<p data-l=\"ab12\">x</p>" }], pending: [{ frame: "phone", ops: [{ id: "ab12", style: { color: "red" } }] }] } });
  const s = said(await canvas.call("design_selection", {}, at));
  assert.match(s, /Frames selected: phone/);
  assert.match(s, /Element ab12 in the frame phone:\n<p data-l="ab12">x<\/p>/);
  assert.match(s, /"color":"red"/);
});

test("canvas presence: a running edit of a frame's file puts its agent on that frame, lead or sidekick", async () => {
  const { root, store, api, presence } = setup();
  await api["canvas.create"]({ cwd: root, title: "Here", size: "phone" });
  await wait(0);
  const tool = (id: string, status: "running" | "done", path: string, extra: Partial<Extract<Item, { kind: "tool" }>> = {}): Item => ({ kind: "tool", id, turn: 1, at: 1, tool: "Edit", toolKind: "edit", title: `Edit ${path}`, status, path, ...extra });
  store.putItem("t", tool("e1", "running", ".liner/designs/here/frames/phone.html"));
  store.putItem("t", tool("e2", "running", "src/app.ts"));
  store.putItem("t", tool("e1", "done", ".liner/designs/here/frames/phone.html"));
  assert.deepEqual(presence().map((p) => [p.file, p.frame, p.agent, p.name, p.label, p.on]), [["here", "phone", "lead", "Opus 5.5", "Editing", true], ["here", "phone", "lead", "Opus 5.5", "Editing", false]]);

  const row = (state: "running" | "done", steps: { title: string; toolKind: "write"; status: "running" | "done"; path: string }[]): Item => ({ kind: "tool", id: "sk", turn: 1, at: 1, tool: "liner.sidekick", toolKind: "task", title: "Brief", status: state, agent: { name: "Sidekick", steps } });
  store.putItem("t", row("running", [{ title: "Write", toolKind: "write", status: "running", path: join(root, ".liner/designs/here/frames/week.html") }]));
  store.putItem("t", { kind: "turn", id: "tn", turn: 1, at: 1, agent: "forge", model: "demo:x", status: "done" });
  assert.deepEqual(presence().slice(2).map((p) => [p.frame, p.agent, p.name, p.label, p.on]), [["week", "sidekick", "Kimi", "Drawing", true], ["week", "sidekick", "Kimi", "Drawing", false]], "and the turn's end takes it off");
});

// Round 2: the reviewer's findings (build/reports/R.md), each probe now a test that the defect is gone.

test("canvas H1: nothing under .liner/designs is reached through a link, and restore never removes through one", async () => {
  const { root, ctx, api } = setup();
  const outside = mkdtempSync(join(tmpdir(), "lc-canvas-outside-"));
  writeFileSync(join(outside, "precious.txt"), "keep me");
  mkdirSync(join(outside, "sub"));
  writeFileSync(join(outside, "sub", "more.txt"), "keep me too");
  canvas.createFile(ctx, root, "Foo", "phone", "foo");
  canvas.keepVersion(ctx, "t", root, "foo", 0);
  // frames/ swapped for a link (an agent's shell, or a repository that carries .liner/).
  const dir = join(root, ".liner/designs/foo");
  rmSync(join(dir, "frames"), { recursive: true });
  symlinkSync(outside, join(dir, "frames"));
  assert.throws(() => canvas.restore(ctx, "t", "foo", 0), /frames is a link/);
  assert.deepEqual(readdirSync(outside).sort(), ["precious.txt", "sub"], "nothing outside was removed");
  assert.equal(readFileSync(join(outside, "sub", "more.txt"), "utf8"), "keep me too");
  assert.throws(() => canvas.readFrame(ctx, root, "foo", "phone"), /is a link/);
  await assert.rejects(async () => api["canvas.frame.add"]({ cwd: root, file: "foo", frame: { name: "New", w: 400, h: 400 } }), /is a link/);
  assert.deepEqual(readdirSync(outside).sort(), ["precious.txt", "sub"], "nothing was written there either");

  // A link higher up: .liner/designs itself, or a design's own folder.
  const root2 = mkdtempSync(join(tmpdir(), "lc-canvas-"));
  ctx.store.putProject({ id: "p2", name: "p2", path: root2, git: false, createdAt: 1 });
  mkdirSync(join(root2, ".liner"));
  mkdirSync(join(outside, "designs-elsewhere", "bar", "frames"), { recursive: true });
  writeFileSync(join(outside, "designs-elsewhere", "bar", "frames", "x.html"), "<p>x</p>");
  symlinkSync(join(outside, "designs-elsewhere"), join(root2, ".liner", "designs"));
  await assert.rejects(async () => api["canvas.list"]({ cwd: root2 }), /\.liner\/designs is a link/);
  await assert.rejects(async () => api["canvas.open"]({ cwd: root2, file: "bar" }), /is a link/);
  await assert.rejects(async () => api["canvas.create"]({ cwd: root2, title: "Bar" }), /is a link/);
  assert.ok(!existsSync(join(outside, "designs-elsewhere", "bar", "design.json")), "no index written through the link");
  assert.equal(canvas.linkFree(root, ".liner/designs/foo/assets/a.png"), join(root, ".liner/designs/foo/assets/a.png"), "a path with no link on the way is fine, made or not");
});

test("canvas H1: restore removes only regular files it listed inside the real frames/ and assets/", () => {
  const { root, ctx } = setup();
  canvas.createFile(ctx, root, "Foo", "phone", "foo");
  canvas.keepVersion(ctx, "t", root, "foo", 1);
  const dir = join(root, ".liner/designs/foo");
  writeFileSync(join(dir, "frames", "extra.html"), "<p>later</p>");
  writeFileSync(join(dir, "assets", "later.png"), "png");
  mkdirSync(join(dir, "assets", "folder"));
  writeFileSync(join(dir, "assets", "folder", "keep.png"), "png");
  const outside = mkdtempSync(join(tmpdir(), "lc-canvas-outside-"));
  writeFileSync(join(outside, "target.txt"), "keep");
  symlinkSync(join(outside, "target.txt"), join(dir, "assets", "linked.png"));
  canvas.restore(ctx, "t", "foo", 1);
  assert.ok(!existsSync(join(dir, "frames", "extra.html")), "a frame the copy hasn't got is gone");
  assert.ok(!existsSync(join(dir, "assets", "later.png")));
  assert.ok(existsSync(join(dir, "assets", "folder", "keep.png")), "a folder isn't removed, nor anything in it");
  assert.equal(readFileSync(join(outside, "target.txt"), "utf8"), "keep", "a link isn't followed");
  assert.ok(existsSync(join(dir, "assets", "linked.png")), "nor removed");
});

test("canvas H3: bringing a turn back always keeps what's there first, and never replaces a kept turn", () => {
  const { root, ctx, store } = setup();
  store.patchThread("t", { turns: 5 });
  const html = (s: string) => `<html><body><p>${s}</p></body></html>`;
  const now = () => readFileSync(join(root, ".liner/designs/foo/frames/a.html"), "utf8");
  canvas.createFile(ctx, root, "Foo", undefined, "foo");
  canvas.addFrame(ctx, root, "foo", { name: "A", w: 400, h: 400 }, html("turn 3"));
  canvas.keepVersion(ctx, "t", root, "foo", 3);
  canvas.writeFrame(ctx, root, "foo", "a", html("agent turn 5"), { by: "agent" });
  canvas.keepVersion(ctx, "t", root, "foo", 5);

  // V1: a hand edit, then turn 5 (the current one) back.
  canvas.writeFrame(ctx, root, "foo", "a", html("my hand edit"), { by: "you" });
  canvas.restore(ctx, "t", "foo", 5);
  assert.match(now(), /agent turn 5/);
  let vs = canvas.versions(ctx, "t", "foo");
  const before = vs.find((v) => v.kind === "before")!;
  assert.deepEqual([before.turn, before.back, before.frames], [5, 5, 1]);
  assert.match(before.key, /^b\d+$/);
  assert.match(canvas.versionRead(ctx, "t", "foo", { key: before.key }).html.a, /my hand edit/, "the hand edit is kept");

  // V2: another hand edit, then turn 3 back: turn 5's copy stays as the agent left it.
  canvas.writeFrame(ctx, root, "foo", "a", html("hand edit after 5"), { by: "you" });
  canvas.restore(ctx, "t", "foo", { turn: 3 });
  assert.match(now(), /turn 3/);
  assert.match(canvas.versionRead(ctx, "t", "foo", 5).html.a, /agent turn 5/);
  vs = canvas.versions(ctx, "t", "foo");
  assert.deepEqual(vs.map((v) => v.kind), ["turn", "turn", "before", "before"]);
  // And a "before" copy can itself be brought back, by its key.
  canvas.restore(ctx, "t", "foo", { key: vs[3].key });
  assert.match(now(), /hand edit after 5/);
  assert.throws(() => canvas.restore(ctx, "t", "foo", { key: "b1" }), /isn't kept/);

  // The newest 10 "before" copies are kept.
  for (let i = 0; i < 12; i++) canvas.restore(ctx, "t", "foo", 3);
  vs = canvas.versions(ctx, "t", "foo");
  assert.equal(vs.filter((v) => v.kind === "before").length, 10);
  assert.deepEqual(vs.filter((v) => v.kind === "turn").map((v) => v.key), ["t3", "t5"]);
});

test("canvas M5: a live frame's address from design.json must be a page on this Mac, or it's never drawn", async () => {
  const shots: string[] = [];
  const { root, ctx, at } = setup({ shot: async (_t, page) => (shots.push(page.url), { png: "" }) });
  canvas.createFile(ctx, root, "Foo", undefined, "foo");
  const p = join(root, ".liner/designs/foo/design.json");
  const j = JSON.parse(readFileSync(p, "utf8"));
  for (const [id, url] of [["evil", "file:///etc/passwd"], ["far", "https://example.com/x"], ["lan", "http://192.168.1.4:3000/"], ["creds", "http://user:pw@localhost:5173/"], ["ok", "localhost:5173/today"]])
    j.frames.push({ id, page: "p1", name: id, kind: "live", url, x: 0, y: 0, w: 400, h: 400 });
  writeFileSync(p, JSON.stringify(j));
  const file = canvas.readFile(ctx, root, "foo");
  assert.deepEqual(file.frames.map((f) => f.id), ["ok"], "the others are left off the canvas");
  await assert.rejects(canvas.call("design_shot", { frame: "evil", design: "foo" }, at()), /no frame “evil”/);
  await canvas.call("design_shot", { frame: "ok", design: "foo" }, at());
  assert.deepEqual(shots, ["http://localhost:5173/today"]);
});

test("canvas M6, L3: script text is never stamped, empty comments end, and crossed tags refuse a swap", () => {
  const src = `<!doctype html><html><head></head><body><script><!-- document.write("<script>x()</script>"); var s = "<div class=a>"; --></script><p>t</p></body></html>`;
  const out = stamp(src);
  assert.ok(out.ok);
  assert.ok(out.html.includes(`<script><!-- document.write("<script>x()</script>"); var s = "<div class=a>"; --></script>`), "the script is byte for byte as it was");
  assert.match(out.html, /<p data-l="[a-z0-9]+">t<\/p>/);
  // An escaped part that never ends: the script runs to its own </script>.
  const open = stamp(`<body><script>a = "<!--"; b = "<div>";</script><div>x</div></body>`).html;
  assert.ok(open.includes(`b = "<div>";</script>`));
  assert.match(open, /<div data-l="[a-z0-9]+">x<\/div>/);

  // P8: <!--> and <!---> are whole comments.
  for (const c of ["<!-->", "<!--->"]) {
    const o = stamp(`<html><body>${c}<p>one</p><p>two</p><!-- x --></body></html>`);
    assert.equal(o.added, 3, `${c} hides nothing`);
  }

  // P7: a </div> a browser ignores inside a td doesn't end the td, so it swaps cleanly.
  const table = `<html><body><div data-l="aaaa"><table><tr><td data-l="bbbb"></div>X</td><td data-l="cccc">Y</td></tr></table></div></body></html>`;
  const swapped = replaceNode(table, "bbbb", `<td>Z</td>`);
  assert.match(swapped, /<td data-l="bbbb">Z<\/td><td data-l="cccc">Y<\/td><\/tr><\/table><\/div><\/body>/);
  assert.ok(!swapped.includes("X</td>"), "no pieces left behind");

  // Crossed formatting tags: a browser ends <i> elsewhere, so it isn't swapped, and nothing changes.
  const crossed = `<html><body><p data-l="pppp"><b data-l="bbbb">x<i data-l="iiii">y</b>z</i></p></body></html>`;
  assert.throws(() => replaceNode(crossed, "iiii", "<i>new</i>"), /tags crossed/);
  assert.throws(() => applyOps(crossed, [{ id: "iiii", text: "new" }]), /tags crossed/);
  // A p a </div> ends, or an li a </ul>, is ended the same way by a browser: those swap.
  assert.match(replaceNode(`<body><div><p data-l="qqqq">a</div></body>`, "qqqq", "<p>b</p>"), /<div data-l="[a-z0-9]+"><p data-l="qqqq">b<\/p><\/div>/);
});

test("canvas L1: a read-only session writes nothing, yet sees the found frame and its ids", async () => {
  const { root, ctx, store } = setup({ readOnly: (id) => id === "ro" });
  store.putThread(thread("ro"));
  canvas.createFile(ctx, root, "Foo", undefined, "foo");
  const dir = join(root, ".liner/designs/foo");
  writeFileSync(join(dir, "frames/loose.html"), "<html><body><p>hi</p></body></html>");
  const index = readFileSync(join(dir, "design.json"), "utf8");
  const ro: DesignCall = { ...ctx, threadId: "ro", sidekick: false };
  assert.match(said(await canvas.call("design_files", {}, ro)), /- loose · “Loose”/);
  const tree = said(await canvas.call("design_tree", { frame: "loose", design: "foo" }, ro));
  assert.match(tree, /<p> [a-z0-9]{4,} · text · “hi”/, "ids in memory for it");
  assert.equal(readFileSync(join(dir, "design.json"), "utf8"), index, "design.json untouched");
  assert.equal(readFileSync(join(dir, "frames/loose.html"), "utf8"), "<html><body><p>hi</p></body></html>", "no ids written");
});

test("canvas revisions: read, open and changed carry a frame's rev; a write on an old base is refused", async () => {
  const { root, api, changed } = setup();
  await api["canvas.create"]({ cwd: root, title: "Revs", size: "phone" });
  const file = join(root, ".liner/designs/revs/frames/phone.html");
  const r = await api["canvas.frame.read"]({ cwd: root, file: "revs", frame: "phone" });
  assert.equal(r.rev, canvas.revOf(readFileSync(file)));
  assert.equal((await api["canvas.open"]({ cwd: root, file: "revs" })).revs.phone, r.rev);
  const w = await api["canvas.frame.write"]({ cwd: root, file: "revs", frame: "phone", html: r.html.replace("</body>", "<p>mine</p></body>"), base: r.rev });
  assert.equal(w.rev, canvas.revOf(readFileSync(file)));
  assert.equal(changed().at(-1)?.rev, w.rev);
  // The agent writes it meanwhile; the person's next write, on the old base, is refused and writes nothing.
  writeFileSync(file, r.html.replace("</body>", "<p>agent</p></body>"));
  const agents = readFileSync(file, "utf8");
  await assert.rejects(async () => api["canvas.frame.write"]({ cwd: root, file: "revs", frame: "phone", html: r.html, base: w.rev }), (e: Error) => e.message.startsWith("changed:"));
  await assert.rejects(async () => api["canvas.frame.apply"]({ cwd: root, file: "revs", frame: "phone", ops: [{ id: "x", text: "y" }], base: w.rev }), /^Error: changed:/);
  assert.equal(readFileSync(file, "utf8"), agents);
});

test("canvas.frame.apply: changes touch only their elements' bytes, undo puts back the exact bytes, an unknown id changes nothing", async () => {
  const { root, api, changed } = setup();
  await api["canvas.create"]({ cwd: root, title: "Apply" });
  const src = [
    `<!-- a note before the page -->`,
    `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">`,
    `<html data-l=root><head><title>t</title></head>`,
    `<body data-l="body">`,
    `  <main data-l="main" class=wide style="padding: 8px;color:red">`,
    `    <h1 data-l="h1" title=Today>Today &amp; tides</h1>`,
    `    <ul data-l="list"><li data-l="li1">One</li><li data-l="li2">Two</li></ul>`,
    `    <div data-l="chart" id=chart></div>`,
    `  </main>`,
    `  <script>for (const n of [1, 2]) document.getElementById("chart").append(Object.assign(document.createElement("i"), { textContent: n }));</script>`,
    `</body>`,
    `</html>`,
    `<!-- and one after -->`,
    ``,
  ].join("\n");
  await api["canvas.frame.add"]({ cwd: root, file: "apply", frame: { name: "Page", w: 800, h: 600 }, html: src });
  const path = join(root, ".liner/designs/apply/frames/page.html");
  const start = readFileSync(path, "utf8");
  assert.equal(start, src, "already stamped: added as it is");
  const { rev } = await api["canvas.frame.read"]({ cwd: root, file: "apply", frame: "page" });

  const r = await api["canvas.frame.apply"]({ cwd: root, file: "apply", frame: "page", base: rev, ops: [
    { id: "main", style: { color: "blue", gap: "4px", padding: null } },
    { id: "h1", text: "Tomorrow <3" },
    { id: "h1", attr: { title: "Tomorrow", lang: "en" } },
    { into: "list", insert: "<li>Three</li>" },
    { id: "li1", move: { into: "list" } },
    { id: "chart", remove: true },
  ] });
  const after = readFileSync(path, "utf8");
  assert.equal(r.rev, canvas.revOf(after));
  assert.equal(r.ids.length, 1, "the new li got an id");
  assert.ok(after.includes(`<main data-l="main" class=wide style="color: blue; gap: 4px">`), after);
  assert.ok(after.includes(`<h1 data-l="h1" title=Tomorrow lang="en">Tomorrow &lt;3</h1>`), after);
  assert.ok(after.includes(`<ul data-l="list"><li data-l="li2">Two</li><li data-l="${r.ids[0]}">Three</li><li data-l="li1">One</li></ul>`), after);
  assert.ok(!after.includes("chart\"></div>"));
  // What no op touched is byte for byte the same: the comments outside <html>, the doctype, the script.
  const head = start.slice(0, start.indexOf("<body"));
  const tail = start.slice(start.indexOf("  <script>"));
  assert.ok(after.startsWith(head) && after.endsWith(tail), "outside the touched elements nothing moved");
  assert.equal(changed().at(-1)?.by, "you");

  // Undo puts back the exact bytes.
  const u = await api["canvas.frame.apply"]({ cwd: root, file: "apply", frame: "page", ops: r.undo, base: r.rev });
  assert.equal(readFileSync(path, "utf8"), start);
  assert.equal(u.rev, rev);

  // All or nothing: one id the page hasn't got, and nothing is written.
  await assert.rejects(async () => api["canvas.frame.apply"]({ cwd: root, file: "apply", frame: "page", ops: [{ id: "h1", text: "x" }, { id: "nope", text: "y" }] }), /data-l="nope".*nothing was changed/);
  await assert.rejects(async () => api["canvas.frame.apply"]({ cwd: root, file: "apply", frame: "page", ops: [{ id: "h1", attr: { "data-l": "x" } }] }), /stays as it is/);
  await assert.rejects(async () => api["canvas.frame.apply"]({ cwd: root, file: "apply", frame: "page", ops: [{ id: "main", move: { into: "h1" } }] }), /inside itself|can't go/);
  assert.equal(readFileSync(path, "utf8"), start);
  // An html op swaps one element and keeps its id.
  await api["canvas.frame.apply"]({ cwd: root, file: "apply", frame: "page", ops: [{ id: "h1", html: "<h2>New</h2>" }] });
  assert.ok(readFileSync(path, "utf8").includes(`<h2 data-l="h1">New</h2>`));
});

test("canvas: a removed frame waits in the trash under the app's home and comes back the same", async () => {
  const { root, home, api } = setup();
  await api["canvas.create"]({ cwd: root, title: "Bin", size: "phone" });
  await api["canvas.save"]({ cwd: root, file: "bin", patch: { frames: [{ id: "phone", x: 120, y: 40, name: "Phone / Today" }] } });
  const index = () => JSON.parse(readFileSync(join(root, ".liner/designs/bin/design.json"), "utf8")) as DesignFile;
  const entry = index().frames[0];
  const html = readFileSync(join(root, ".liner/designs/bin/frames/phone.html"), "utf8");
  const gone = await api["canvas.frame.remove"]({ cwd: root, file: "bin", frame: "phone" });
  assert.deepEqual(gone.frames, []);
  assert.ok(!existsSync(join(root, ".liner/designs/bin/frames/phone.html")));
  assert.ok(existsSync(join(home, "canvas-trash")), "the trash is in Liner Code's home");
  assert.ok(!readdirSync(join(root, ".liner/designs/bin")).some((n) => n.includes("trash")), "not in the project");
  const back = await api["canvas.frame.unremove"]({ cwd: root, file: "bin", frame: "phone" });
  assert.deepEqual(back.frames, [entry]);
  assert.deepEqual(index().frames, [entry]);
  assert.equal(readFileSync(join(root, ".liner/designs/bin/frames/phone.html"), "utf8"), html);
  await assert.rejects(async () => api["canvas.frame.unremove"]({ cwd: root, file: "bin", frame: "phone" }), /no removed frame/);
  // The trash keeps the newest 20.
  for (let i = 0; i < 22; i++) {
    await api["canvas.frame.add"]({ cwd: root, file: "bin", frame: { name: `F${i}`, w: 400, h: 400 } });
    await api["canvas.frame.remove"]({ cwd: root, file: "bin", frame: `f${i}` });
  }
  const bins = readdirSync(join(home, "canvas-trash"));
  assert.equal(readdirSync(join(home, "canvas-trash", bins[0], "bin")).length, 20);
});

test("canvas M7: a turn in a folder without designs does nothing; a turn's copies wait off the loop", async () => {
  const { root, ctx, store } = setup();
  await canvas.turnStarted(ctx, "t", 1);
  await canvas.turnEnded(ctx, "t", 1);
  assert.ok(!existsSync(join(root, ".liner")));
  assert.ok(!existsSync(join(store.home, "designs")));
  canvas.createFile(ctx, root, "Foo", "phone", "foo");
  const pending = canvas.turnEnded(ctx, "t", 2);
  assert.ok(pending instanceof Promise);
  await pending;
  assert.deepEqual(canvas.versions(ctx, "t", "foo").map((v) => v.key), ["t2"]);
  await canvas.turnEnded(ctx, "t", 3);
  assert.deepEqual(canvas.versions(ctx, "t", "foo").map((v) => v.key), ["t2"], "unchanged by size and time: no new copy");
});

// Round 3: the second review (build/reports/R2.md) and the real run (build/reports/T.md P2).

/** The style an element says, as CSS reads it: property → value, from the attribute's decoded text. */
function styleOf(html: string, id: string) {
  const el = byId(parse(html), id)!;
  const raw = attr(el, "style")?.value ?? "";
  const out: Record<string, string> = {};
  // split as CSS does: outside quotes and brackets
  let depth = 0;
  let q = "";
  let from = 0;
  const push = (end: number) => {
    const d = raw.slice(from, end);
    const c = d.indexOf(":");
    if (c > 0) out[d.slice(0, c).trim()] = d.slice(c + 1).trim();
  };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (q) {
      if (ch === "\\") i++;
      else if (ch === q) q = "";
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === ";" && !depth) {
      push(i);
      from = i + 1;
    }
  }
  push(raw.length);
  return out;
}

test("canvas N1: style values with quotes, url(), ; in strings and & change cleanly, in any quoting", () => {
  const pg = (tag: string) => `<html><body data-l="body">${tag}hi</div></body></html>`;
  let html = pg(`<div data-l="a" style="color: red">`);
  const step = (style: Record<string, string | null>) => (html = applyOps(html, [{ id: "a", style }]).html);
  step({ "font-family": '"Inter", sans-serif' });
  assert.equal(/<div[^>]*>/.exec(html)![0], `<div data-l="a" style="color: red; font-family: &quot;Inter&quot;, sans-serif">`);
  step({ "font-family": '"Roboto Slab", serif' });
  step({ "font-family": "'Space Grotesk', system-ui" });
  assert.deepEqual(styleOf(html, "a"), { color: "red", "font-family": "'Space Grotesk', system-ui" });
  step({ color: "blue" });
  assert.equal(/<div[^>]*>/.exec(html)![0], `<div data-l="a" style="color: blue; font-family: 'Space Grotesk', system-ui">`);
  step({ "font-family": null });
  assert.equal(/<div[^>]*>/.exec(html)![0], `<div data-l="a" style="color: blue">`);
  step({ "background-image": 'url("a;b.png")', content: '";"', "font-family": '"A&B"' });
  assert.deepEqual(styleOf(html, "a"), { color: "blue", "background-image": 'url("a;b.png")', content: '";"', "font-family": '"A&B"' });
  assert.ok(html.includes(`font-family: &quot;A&amp;B&quot;`), "& encoded once");
  step({ color: "green" });
  step({ content: null });
  assert.deepEqual(styleOf(html, "a"), { color: "green", "background-image": 'url("a;b.png")', "font-family": '"A&B"' });
  // url( with no quotes holding a ;
  html = pg(`<div data-l="a" style="background: url(a;b.png) no-repeat; color: red">`);
  step({ color: "blue" });
  assert.deepEqual(styleOf(html, "a"), { background: "url(a;b.png) no-repeat", color: "blue" });
  // Single quotes: a " needs no entity, a ' does.
  html = pg(`<div data-l="a" style='color: red'>`);
  step({ "font-family": '"Inter", sans-serif' });
  step({ "font-family": "'Space Grotesk'" });
  assert.equal(/<div[^>]*>/.exec(html)![0], `<div data-l="a" style='color: red; font-family: &#39;Space Grotesk&#39;'>`);
  assert.deepEqual(styleOf(html, "a"), { color: "red", "font-family": "'Space Grotesk'" });
  // Unquoted: it gets double quotes.
  html = pg(`<div data-l="a" style=color:red>`);
  step({ "font-family": '"Inter"' });
  assert.equal(/<div[^>]*>/.exec(html)![0], `<div data-l="a" style="color:red; font-family: &quot;Inter&quot;">`);
  step({ "font-family": '"Roboto"' });
  assert.deepEqual(styleOf(html, "a"), { color: "red", "font-family": '"Roboto"' });
  // A value that isn't one value is refused.
  assert.throws(() => applyOps(html, [{ id: "a", style: { color: "red; background: blue" } }]), /isn't one CSS value/);
  assert.throws(() => applyOps(html, [{ id: "a", style: { "font-family": '"Inter' } }]), /isn't one CSS value/);
  assert.equal(decode("&quot;"), '"');
});

test("canvas N2: an agent's own write just before a person's change is announced first, and from names it", async () => {
  const { root, ctx, events } = setup();
  canvas.createFile(ctx, root, "Foo", undefined, "foo");
  canvas.addFrame(ctx, root, "foo", { name: "A", w: 400, h: 400 }, `<html><body data-l="b"><h1 data-l="h">Old</h1><p data-l="p">x</p></body></html>`);
  canvas.watchFile(ctx, root, "foo", true);
  await wait(300);
  const abs = join(root, ".liner/designs/foo/frames/a.html");
  events.length = 0;
  writeFileSync(abs, readFileSync(abs, "utf8").replace("Old", "AGENT"));
  const agentRev = canvas.revOf(readFileSync(abs));
  await wait(20);
  const r = canvas.applyFrame(ctx, root, "foo", "a", [{ id: "p", style: { color: "red" } }], { by: "you" });
  assert.equal(r.from, agentRev);
  await wait(600);
  canvas.watchFile(ctx, root, "foo", false);
  const ev = events.flatMap((e) => (e.type === "canvas.changed" ? [`${e.by}:${e.rev}`] : []));
  assert.deepEqual(ev, [`agent:${agentRev}`, `you:${r.rev}`], "the agent's write is heard before the person's, once");
  assert.ok(readFileSync(abs, "utf8").includes("AGENT"));
  // From the engine's own last write, nothing extra.
  events.length = 0;
  const r2 = canvas.writeFrame(ctx, root, "foo", "a", readFileSync(abs, "utf8").replace("AGENT", "Mine"), { by: "you" });
  assert.equal(r2.from, r.rev);
  assert.deepEqual(events.flatMap((e) => (e.type === "canvas.changed" ? [e.by] : [])), ["you"]);
});

test("canvas N3: undo is byte for byte, for elements without end tags and html that makes more than one", () => {
  const pg = (b: string) => `<!doctype html>\n<html>\n<head><title>t</title></head>\n<body data-l="body">\n${b}\n</body>\n</html>\n`;
  // A3
  const a3 = pg(`<ul data-l="u">\n  <li data-l="a">One\n  <li data-l="b">Two\n</ul>`);
  const s1 = applyOps(a3, [{ id: "a", style: { color: "red" } }]);
  assert.equal(applyOps(s1.html, s1.undo).html, a3);
  // A4
  const a4 = pg(`<section data-l="s"><div data-l="a">A</div></section>`);
  const s2 = applyOps(a4, [{ id: "a", html: `<div>X</div><div>Y</div>` }]);
  assert.equal(s2.ids.length, 1, "the second element's new id (the first keeps a)");
  assert.equal(applyOps(s2.html, s2.undo).html, a4);
  // Six steps on a page of li, p and td without end tags, undone one by one: exact at every step.
  const src = pg(`<ul data-l="u">\n  <li data-l="l1">One\n  <li data-l="l2">Two\n</ul>\n<div data-l="d">\n  <p data-l="p1">First\n  <p data-l="p2">Second\n</div>\n<table data-l="t"><tr data-l="r"><td data-l="c1">A<td data-l="c2">B</table>`);
  const steps = [
    [{ id: "l1", style: { color: "red" } }],
    [{ id: "p1", text: "Changed" }],
    [{ id: "c2", attr: { title: "x" } }],
    [{ id: "l2", html: "<li>Two, new\n  " }],
    [{ into: "u", insert: "<li>Three" }],
    [{ id: "p2", remove: true }],
  ];
  const states = [src];
  const undos: unknown[][] = [];
  for (const ops of steps) {
    const r = applyOps(states.at(-1)!, ops as never);
    states.push(r.html);
    undos.push(r.undo);
  }
  let cur = states.at(-1)!;
  for (let i = steps.length - 1; i >= 0; i--) {
    cur = applyOps(cur, undos[i] as never).html;
    assert.equal(cur, states[i], `undo of step ${i + 1} gives the bytes before it`);
  }
});

test("canvas N5: html and insert pieces must be balanced; void, open li and inline script are fine", () => {
  const src = `<html><body data-l="b"><div data-l="a">A</div><footer data-l="f">Footer</footer></body></html>`;
  for (const bad of ["<!-- note", "</div><script>", "<div>open", "<script>x()", "<style>p{}", "<p>a</span>", "<div class=\"x"]) {
    assert.throws(() => applyOps(src, [{ into: "a", insert: bad }]), /Nothing was changed/, bad);
    assert.throws(() => applyOps(src, [{ id: "a", html: bad }]), /Nothing was changed/, bad);
    assert.throws(() => replaceNode(src, "a", bad), /Nothing was changed/, bad);
  }
  const good = `<div><img src=a.png><br><ul><li>One<li>Two</ul><script>document.currentScript.before("x")</script></div>`;
  const r = applyOps(src, [{ into: "a", insert: good }]);
  assert.ok(r.html.includes(`<script>document.currentScript.before("x")</script>`));
  assert.ok(byId(parse(r.html), "f"), "the footer is still there");
});

test("canvas N6: one attribute named twice in one op, in any case, is refused", () => {
  const src = `<html><body data-l="b"><div data-l="a" class="xxxxxxxxxx" title="keep">hi</div></body></html>`;
  assert.throws(() => applyOps(src, [{ id: "a", attr: { class: "y", CLASS: "zzz" } }]), /named twice/);
  const r = applyOps(src, [{ id: "a", attr: { CLASS: "y" } }]);
  assert.ok(r.html.includes(`class="y" title="keep"`));
});

test("canvas N14: when stamps can't be taken back out, nothing stamped passes for the file, and design_node won't write", async () => {
  const { root, ctx, at } = setup();
  canvas.createFile(ctx, root, "Foo", undefined, "foo");
  const page0 = `<html><body><p>hi</p></body></html>`;
  mkdirSync(join(root, ".liner/designs/foo/frames"), { recursive: true });
  writeFileSync(join(root, ".liner/designs/foo/frames/a.html"), page0);
  const was = stampGuard.undoes;
  stampGuard.undoes = () => false;
  try {
    const r = canvas.readFrameRev(ctx, root, "foo", "a", { keep: true });
    assert.equal(r.ok, false);
    assert.equal(r.html, page0, "the page as it is, with no ids");
    assert.equal(readFileSync(join(root, ".liner/designs/foo/frames/a.html"), "utf8"), page0);
    assert.throws(() => applyOps(page0, [{ into: "x", insert: "<p>" }]), /can't take ids/);
    await assert.rejects(canvas.call("design_node", { frame: "a", id: "x", html: "<p>y</p>", design: "foo" }, at()), /can't take data-l ids/);
  } finally {
    stampGuard.undoes = was;
  }
});

test("canvas P2: a Read only session's design_files and design_tree, through the MCP dispatch, write nothing", async () => {
  const { root, ctx, store } = setup();
  store.putThread({ ...thread("ro"), access: "read" });
  // The engine's rule (runtime.readOnly): access "read", or a side chat.
  const design = { ...ctx, readOnly: (id: string) => store.thread(id).access === "read" || Boolean(store.thread(id).sideOf) };
  buildlinks.rpc(() => design);
  const tools = new AgentTools(store, process.env);
  tools.design = design;
  tools.cwdOf = () => root;
  canvas.createFile(design, root, "Foo", "phone", "foo");
  // A frame tied to a file (so design_files asks the build links of it), its file unstamped since, and a loose one.
  writeFileSync(join(root, "Today.html"), "<p>today</p>");
  buildlinks.link(design, root, "foo", "phone", "Today.html");
  const dir = join(root, ".liner/designs/foo");
  writeFileSync(join(dir, "frames/phone.html"), `<html><body><p class="unstamped">hi</p></body></html>`);
  writeFileSync(join(dir, "frames/loose.html"), `<html><body><p>loose</p></body></html>`);
  const before = [readFileSync(join(dir, "design.json"), "utf8"), readFileSync(join(dir, "frames/phone.html"), "utf8"), readFileSync(join(dir, "frames/loose.html"), "utf8")];
  const files = await tools.call("ro", "design_files", {});
  assert.equal(files.isError, undefined, said(files));
  assert.match(said(files), /phone · “Phone” · 390 × 844 .* built as Today\.html/);
  const tree = await tools.call("ro", "design_tree", { frame: "phone" });
  assert.match(said(tree), /<p> [a-z0-9]{4,} “unstamped” · text · “hi”/);
  const again = await tools.call("ro", "design_tree", { frame: "phone" });
  assert.equal(said(again), said(tree), "the same ids each read, though none are written");
  await tools.call("ro", "design_tree", { frame: "loose" });
  const after = [readFileSync(join(dir, "design.json"), "utf8"), readFileSync(join(dir, "frames/phone.html"), "utf8"), readFileSync(join(dir, "frames/loose.html"), "utf8")];
  assert.deepEqual(after, before);
  // A writer's design_tree still keeps its ids in the file.
  await tools.call("t", "design_tree", { frame: "phone" });
  assert.match(readFileSync(join(dir, "frames/phone.html"), "utf8"), /<p data-l="[a-z0-9]+" class="unstamped">/);
});

test("canvas: unremove checks the trash entry; versions say backKind and count what they show; FrameBy.thread stays", async () => {
  const { root, home, ctx, store } = setup();
  canvas.createFile(ctx, root, "Foo", undefined, "foo");
  canvas.addFrame(ctx, root, "foo", { name: "A", w: 400, h: 400, by: { agent: "lead", name: "Opus", thread: "t", way: "w1", cost: 0.1 } }, `<html><body><p>x</p></body></html>`);
  assert.deepEqual(canvas.readFile(ctx, root, "foo").frames[0].by, { agent: "lead", name: "Opus", cost: 0.1, way: "w1", thread: "t" });
  canvas.saveFile(ctx, root, "foo", { frames: [{ id: "a", x: 10 }] });
  assert.equal(canvas.readFile(ctx, root, "foo").frames[0].by?.thread, "t", "kept through a save");
  canvas.removeFrame(ctx, root, "foo", "a");
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(join(d, x.name)) : [join(d, x.name)]));
  const entry = walk(join(home, "canvas-trash")).find((p) => p.endsWith("entry.json"))!;
  const e = JSON.parse(readFileSync(entry, "utf8"));
  e.frame.path = "design.json";
  writeFileSync(entry, JSON.stringify(e));
  const index = readFileSync(join(root, ".liner/designs/foo/design.json"), "utf8");
  assert.throws(() => canvas.unremoveFrame(ctx, root, "foo", "a"), /can't be put back/);
  assert.equal(readFileSync(join(root, ".liner/designs/foo/design.json"), "utf8"), index);

  // Versions: frames counts what a copy shows; a "before" copy says what kind was brought back.
  store.patchThread("t", { turns: 2 });
  canvas.addFrame(ctx, root, "foo", { name: "B", w: 400, h: 400 }, `<html><body><p>b</p></body></html>`);
  canvas.addFrame(ctx, root, "foo", { name: "Live", w: 400, h: 400, kind: "live", url: "localhost:5173/" });
  rmSync(join(root, ".liner/designs/foo/frames/b.html"));
  canvas.keepVersion(ctx, "t", root, "foo", 1);
  assert.equal(canvas.versions(ctx, "t", "foo")[0].frames, 1, "the live frame; not b, whose file the copy hasn't got");
  assert.equal(canvas.versionRead(ctx, "t", "foo", 1).file.frames.length, 1);
  canvas.restore(ctx, "t", "foo", 1);
  const b = canvas.versions(ctx, "t", "foo").find((v) => v.kind === "before")!;
  assert.deepEqual([b.back, b.backKind], [1, "turn"]);
  canvas.restore(ctx, "t", "foo", { key: b.key });
  assert.equal(canvas.versions(ctx, "t", "foo").filter((v) => v.kind === "before").at(-1)?.backKind, "before");
});

test("canvas: a new frame never lands on another; a replaced one keeps its place", async () => {
  const shots: string[] = [];
  const { root, api, at } = setup({ shot: async (_t, p) => (shots.push(p.url), { png: "" }) });
  await api["canvas.create"]({ cwd: root, title: "Places" });
  const one = await api["canvas.frame.add"]({ cwd: root, file: "places", frame: { name: "One", w: 400, h: 800, x: 0, y: 0 } });
  assert.deepEqual(one.placed, { frame: "one", x: 0, y: 0, moved: false });
  const two = await api["canvas.frame.add"]({ cwd: root, file: "places", frame: { name: "Two", w: 400, h: 800, x: 100, y: 100 } });
  assert.deepEqual(two.placed, { frame: "two", x: 560, y: 100, moved: true }, "to the right of One, 160 apart");
  const three = await api["canvas.frame.add"]({ cwd: root, file: "places", frame: { name: "Three", w: 400, h: 800 } });
  assert.deepEqual(three.placed, { frame: "three", x: 1120, y: 0, moved: false }, "none asked: the right of the top row");
  const free = await api["canvas.frame.add"]({ cwd: root, file: "places", frame: { name: "Far", w: 400, h: 400, x: 0, y: 2000 } });
  assert.deepEqual(free.placed, { frame: "far", x: 0, y: 2000, moved: false }, "a free place asked is kept");
  const all = (await api["canvas.open"]({ cwd: root, file: "places" })).file.frames;
  for (const a of all) for (const b of all) if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} and ${b.id} overlap`);
  // design_frame: a new one is placed free and says where; the same name keeps its place.
  const drawn = said(await canvas.call("design_frame", { design: "places", name: "Agent", width: 400, height: 800, html: "<p>a</p>" }, at()));
  assert.match(drawn, /placed at 1680, 0/);
  await canvas.call("design_frame", { design: "places", name: "One", width: 400, height: 800, html: "<p>again</p>" }, at());
  const one2 = (await api["canvas.open"]({ cwd: root, file: "places" })).file.frames.find((f) => f.id === "one")!;
  assert.deepEqual([one2.x, one2.y], [0, 0]);
});

// Round 4: pieces a browser would put elsewhere (build/reports/R3.md L1, probe6).

test("canvas L1: a piece a browser would place elsewhere is refused; the Demo's own elements all pass", async () => {
  const pg = (b: string) => `<!doctype html>\n<html>\n<head><title>t</title></head>\n<body data-l="body">\n${b}\n</body>\n</html>\n`;
  const refused = (body: string, op: Record<string, unknown>, why: RegExp) => assert.throws(() => applyOps(pg(body), [op as never]), why);
  refused(`<p data-l="p">one <span data-l="s">two</span> three</p>`, { id: "s", html: "<div>block</div>" }, /a <div> inside a <p>/);
  refused(`<a data-l="a" href="/x">link <span data-l="s">in</span></a>`, { into: "s", insert: `<a href="/y">inner</a>` }, /a link inside a link/);
  refused(`<table data-l="t"><tbody data-l="tb"><tr data-l="tr"><td data-l="td">c</td></tr></tbody></table>`, { into: "tr", insert: "<div>x</div>" }, /a <div> directly inside a <tr>/);
  refused(`<div data-l="d"><svg data-l="v" viewBox="0 0 1 1"><rect/></svg></div>`, { id: "d", html: `<div><svg><p>out</p></svg></div>` }, /a <p> straight inside <svg>/);
  refused(`<div data-l="d">x</div>`, { into: "d", insert: `<body class="x">` }, /a <body> tag/);
  refused(`<div data-l="d">x</div>`, { into: "d", insert: `<tr><td>x</td></tr>` }, /a <tr> outside a table/);
  refused(`<form data-l="f"><div data-l="d">x</div></form>`, { into: "d", insert: `<form></form>` }, /a form inside a form/);
  assert.throws(() => replaceNode(pg(`<p data-l="p"><b data-l="b">x</b></p>`), "b", "<ul><li>x</li></ul>"), /a <ul> inside a <p>/);
  // What a browser keeps where it's written passes: html in foreignObject, an option in a div, the page's body swapped for itself.
  applyOps(pg(`<div data-l="d">x</div>`), [{ id: "d", html: `<div><svg><foreignObject><p>in</p></foreignObject></svg></div>` }]);
  applyOps(pg(`<div data-l="d">x</div>`), [{ into: "d", insert: "<option>o</option>" }]);
  applyOps(pg(`<div data-l="d">x</div>`), [{ id: "body", html: `<body data-l="body" class="x"><p>new</p></body>` }]);

  // Every element of the Demo's frames, put back in its own place and copied into its parent, passes.
  const dir = new URL("../src/providers/demo-foreshore/", import.meta.url);
  let n = 0;
  for (const name of readdirSync(dir).filter((x) => x.endsWith(".html"))) {
    const html = stamp(readFileSync(new URL(name, dir), "utf8")).html;
    const doc = parse(html);
    for (const el of elements(doc)) {
      const id = attr(el, "data-l")?.value;
      if (!id || el.tag === "body") continue;
      const piece = html.slice(el.start, el.end);
      const r = applyOps(html, [{ id, html: piece }]);
      assert.equal(applyOps(r.html, r.undo).html, html, `${name} ${id}`);
      const parent = el.parent && attr(el.parent, "data-l")?.value;
      if (parent && el.closedBy === "self") applyOps(html, [{ into: parent, insert: piece }]);
      n++;
    }
  }
  assert.ok(n >= 20, `${n} ordinary pieces`);
});

test("canvas: design_frame says where a first frame went without speaking of others", async () => {
  const { at } = setup();
  const first = said(await canvas.call("design_frame", { name: "First", width: 400, height: 400, html: "<p>a</p>" }, at()));
  assert.match(first, /placed at 0, 0\. Its file/);
  const second = said(await canvas.call("design_frame", { name: "Second", width: 400, height: 400, html: "<p>b</p>" }, at()));
  assert.match(second, /placed at 560, 0 beside the others/);
});

// Round 5: a stray end tag left by a browser's implied end names its cause.

test("canvas: a block inside a <p> in a piece is refused by naming the block, not the stray </p>", () => {
  const src = `<html><body data-l="b"><p data-l="p">old</p></body></html>`;
  assert.throws(() => replaceNode(src, "p", "<p>Sample <div>Harbour</div></p>"), (e: Error) => e.message === "That html has a <div> inside a <p> (a browser ends the <p> before the <div>, which leaves its </p> over), so it would change the page beyond its own place. Nothing was changed.");
  assert.throws(() => applyOps(src, [{ id: "p", html: "<p>List: <ul><li>a</li></ul></p>" }]), /a <ul> inside a <p> \(a browser ends the <p> before the <ul>/);
  // Implied ends that leave nothing over stay allowed.
  applyOps(`<html><body data-l="b"><ul data-l="u"><li>a</li></ul></body></html>`, [{ into: "u", insert: "<li>one<li>two" }]);
  applyOps(src, [{ id: "p", html: "<p>Sample</p><div>Harbour</div>" }]);
});

// Round 6: an html op's piece without ids takes the ids of what it replaces (build/reports/T4.md item 1).

test("canvas: an html piece without ids keeps the old ids where its elements line up", () => {
  const src = `<html><body data-l="b"><section data-l="s" class="stack"><h2 data-l="h">Title</h2><p data-l="p">Body</p><footer data-l="f">End</footer></section></body></html>`;
  const idsIn = (html: string) => [...html.matchAll(/<([a-z0-9]+) data-l="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
  const dup = (html: string) => {
    const all = idsIn(html).map((x) => x.split(":")[1]);
    return all.length !== new Set(all).size;
  };
  // A class added, the piece as the Code tab shows it (no ids): all four ids kept, nothing new.
  const r1 = applyOps(src, [{ id: "s", html: `<section class="stack wide"><h2>Title</h2><p>Body</p><footer>End</footer></section>` }]);
  assert.deepEqual(idsIn(r1.html), ["body:b", "section:s", "h2:h", "p:p", "footer:f"]);
  assert.deepEqual(r1.ids, []);
  assert.equal(applyOps(r1.html, r1.undo).html, src, "undo is the old source");
  // A new child in the middle: the others keep theirs, the new one is fresh.
  const r2 = applyOps(src, [{ id: "s", html: `<section class="stack"><h2>Title</h2><figure>New</figure><p>Body</p><footer>End</footer></section>` }]);
  const got2 = idsIn(r2.html);
  assert.deepEqual([got2[1], got2[2], got2[4], got2[5]], ["section:s", "h2:h", "p:p", "footer:f"]);
  assert.equal(r2.ids.length, 1);
  assert.equal(got2[3], `figure:${r2.ids[0]}`);
  assert.ok(!dup(r2.html));
  // A child's tag changed: that one fresh, its siblings kept.
  const r3 = applyOps(src, [{ id: "s", html: `<section class="stack"><h2>Title</h2><div>Body</div><footer>End</footer></section>` }]);
  const got3 = idsIn(r3.html);
  assert.deepEqual([got3[2], got3[4]], ["h2:h", "footer:f"]);
  assert.equal(got3[3], `div:${r3.ids[0]}`);
  assert.equal(r3.ids.length, 1);
  // A piece that names one child's id (here the footer's, on the p) and leaves the others: stated ids stay, none twice.
  const r4 = applyOps(src, [{ id: "s", html: `<section class="stack"><h2>Title</h2><p data-l="f">Body</p><footer>End</footer></section>` }]);
  const got4 = idsIn(r4.html);
  assert.deepEqual([got4[2], got4[3]], ["h2:h", "p:f"]);
  assert.notEqual(got4[4], "footer:f", "the footer's old id went to the p, as stated, so the footer gets a fresh one");
  assert.ok(!dup(r4.html));
  // design_node's replace does the same.
  assert.deepEqual(idsIn(replaceNode(src, "s", `<section class="x"><h2>T</h2><p>B</p><footer>E</footer></section>`)), ["body:b", "section:s", "h2:h", "p:p", "footer:f"]);
});

// Round 7: children lined up by content first, then by tag between matches.

test("canvas: list items keep their own ids through inserts, a delete and an edit; a swap and twins behave", () => {
  const words = ["one", "two", "three", "four", "five"];
  const src = `<html><body data-l="b"><ul data-l="u">${words.map((w, i) => `<li data-l="i${i}">${w}</li>`).join("")}</ul></body></html>`;
  const items = (html: string) => [...html.matchAll(/<li data-l="([^"]+)">([^<]*)<\/li>/g)].map((m) => [m[1], m[2]] as [string, string]);
  const own = (html: string) => items(html).filter(([, t]) => words.includes(t)).every(([id, t]) => id === `i${words.indexOf(t)}`);
  const put = (list: string[]) => applyOps(src, [{ id: "u", html: `<ul>${list.map((t) => `<li>${t}</li>`).join("")}</ul>` }]);
  for (const at of [0, 2, 5]) {
    const list = [...words];
    list.splice(at, 0, "new");
    const r = put(list);
    assert.ok(own(r.html), `insert at ${at}: the five keep their own ids`);
    assert.deepEqual(r.ids, [items(r.html).find(([, t]) => t === "new")![0]], `insert at ${at}: only the new one is fresh`);
  }
  // Delete the second: the other four keep theirs.
  const del = put(words.filter((w) => w !== "two"));
  assert.ok(own(del.html));
  assert.deepEqual(del.ids, []);
  // Edit the third while inserting one before it: the edited one keeps its id (by tag between matched neighbours), the new one is fresh.
  const ed = put(["one", "two", "new", "THREE", "four", "five"]);
  const got = items(ed.html);
  assert.deepEqual(got.map(([id]) => id).filter((_, k) => k !== 2), ["i0", "i1", "i2", "i3", "i4"], "THREE keeps three's id");
  assert.deepEqual(ed.ids, [got[2][0]], "the new one is fresh");
  assert.ok(new Set(got.map(([id]) => id)).size === got.length);
  // An edit alone between matched neighbours keeps the id.
  const ed2 = put(["one", "two", "THREE", "four", "five"]);
  assert.deepEqual(items(ed2.html).map(([id]) => id), ["i0", "i1", "i2", "i3", "i4"]);
  // Swap two neighbours: content matches one of them, which keeps its id; the other lines up with nothing left of its tag on its side, so it's treated as new (acceptable: its id was the one given up).
  const sw = put(["one", "three", "two", "four", "five"]);
  const swi = items(sw.html);
  assert.equal(swi.filter(([id, t]) => id === `i${words.indexOf(t)}`).length, 4);
  assert.equal(sw.ids.length, 1);
  // Five twins and one more: no id twice, exactly one fresh.
  const twins = `<html><body data-l="b"><ul data-l="u">${[0, 1, 2, 3, 4].map((i) => `<li data-l="t${i}">same</li>`).join("")}</ul></body></html>`;
  const tw = applyOps(twins, [{ id: "u", html: `<ul>${"<li>same</li>".repeat(6)}</ul>` }]);
  const ids6 = items(tw.html).map(([id]) => id);
  assert.equal(new Set(ids6).size, 6);
  assert.equal(tw.ids.length, 1);
});

// Round 8: a frame's file gone for a while, and a broken design.json (build/reports/T5.md S1, S2).

test("canvas: a frame whose file goes away keeps its entry, and is itself again when the file is back", async () => {
  const { root, api, ctx } = setup();
  await api["canvas.create"]({ cwd: root, title: "Web" });
  await api["canvas.frame.add"]({ cwd: root, file: "web", frame: { name: "Web / Launch", w: 1280, h: 800, x: 400, y: 200, screen: false, by: { agent: "lead", name: "Opus", thread: "t" } }, html: "<html><body><p>Launch</p></body></html>" });
  await api["canvas.frame.add"]({ cwd: root, file: "web", frame: { name: "Other", w: 400, h: 400, x: 0, y: 2000 } });
  writeFileSync(join(root, "Launch.tsx"), "x");
  buildlinks.link(ctx, root, "web", "web-launch", "Launch.tsx");
  const dir = join(root, ".liner/designs/web");
  const index = () => readFileSync(join(dir, "design.json"), "utf8");
  const before = index();
  const entry = (JSON.parse(before) as DesignFile).frames[0];
  const away = join(mkdtempSync(join(tmpdir(), "lc-canvas-away-")), "web-launch.html");
  const { renameSync } = await import("node:fs");
  renameSync(join(dir, "frames/web-launch.html"), away);
  // Read every way the app and the tools do while it's gone.
  const open = await api["canvas.open"]({ cwd: root, file: "web" });
  assert.deepEqual(open.file.frames[0], { ...entry, missing: true }, "the entry stays, marked missing");
  await api["canvas.list"]({ cwd: root });
  canvas.readFile(ctx, root, "web");
  await api["canvas.save"]({ cwd: root, file: "web", patch: { frames: [{ id: "other", x: 10 }] } });
  assert.ok(!index().includes("missing"), "missing is never written");
  assert.deepEqual((JSON.parse(index()) as DesignFile).frames[0], entry);
  renameSync(away, join(dir, "frames/web-launch.html"));
  const back = (await api["canvas.open"]({ cwd: root, file: "web" })).file;
  assert.deepEqual(back.frames.map((f) => f.id), ["web-launch", "other"], "no second frame for the file");
  assert.deepEqual(back.frames[0], entry, "the same id, name, place, build link, screen mark and by");
  // An editor's save: write a temp file, rename it over the frame's.
  writeFileSync(join(dir, "frames/.web-launch.html.tmp"), "<html><body><p>Saved</p></body></html>");
  rmSync(join(dir, "frames/web-launch.html"));
  canvas.readFile(ctx, root, "web");
  renameSync(join(dir, "frames/.web-launch.html.tmp"), join(dir, "frames/web-launch.html"));
  assert.deepEqual(canvas.readFile(ctx, root, "web").frames[0], entry);
  assert.deepEqual((JSON.parse(index()) as DesignFile).frames.map((f) => f.id), ["web-launch", "other"]);
  // Only a remove takes it out.
  await api["canvas.frame.remove"]({ cwd: root, file: "web", frame: "web-launch" });
  assert.deepEqual((JSON.parse(index()) as DesignFile).frames.map((f) => f.id), ["other"]);
});

test("canvas: a broken design.json is said to be unreadable, never absent, and nothing writes over it", async () => {
  const { root, home, api, ctx, store, at } = setup();
  await api["canvas.create"]({ cwd: root, title: "Tides", size: "phone" });
  canvas.keepVersion(ctx, "t", root, "tides", 1);
  const dir = join(root, ".liner/designs/tides");
  const whole = readFileSync(join(dir, "design.json"), "utf8");
  const cut = whole.slice(0, Math.floor(whole.length / 2));
  writeFileSync(join(dir, "design.json"), cut);
  writeFileSync(join(dir, "frames/loose.html"), "<p>loose</p>");
  const files = () => readdirSync(dir, { recursive: true }).map(String).sort();
  const was = files();
  const list = await api["canvas.list"]({ cwd: root });
  assert.equal(list.length, 1);
  assert.match(list[0].unreadable!, /\.liner\/designs\/tides\/design\.json can't be read \(it isn't whole JSON\).*Bring this back \(Versions, in the session “Canvas”\) has an earlier copy/);
  await assert.rejects(async () => api["canvas.open"]({ cwd: root, file: "tides" }), (e: Error) => e.message.startsWith("unreadable: .liner/designs/tides/design.json can't be read"));
  assert.throws(() => canvas.createFile(ctx, root, "Tides", undefined, "tides"), /already/);
  await assert.rejects(canvas.call("design_frame", { name: "X", width: 400, height: 400, html: "<p>x</p>" }, at()), /^Error: unreadable:/);
  assert.match(said(await canvas.call("design_files", {}, at())), /“tides” can't be read/);
  assert.equal(readFileSync(join(dir, "design.json"), "utf8"), cut, "nothing wrote over it, not even adopting the loose frame");
  assert.deepEqual(files(), was);
  const kept = join(home, "designs", "canvas-broken");
  const copies = readdirSync(kept, { recursive: true }).map(String).filter((n) => n.endsWith(".json"));
  assert.equal(copies.length, 1, "one copy, kept the first time");
  assert.equal(readFileSync(join(kept, copies[0]), "utf8"), cut);
  // Bring this back puts the kept copy back, and the file reads again.
  store.patchThread("t", { turns: 2 });
  canvas.restore(ctx, "t", "tides", 1);
  assert.equal((await api["canvas.list"]({ cwd: root }))[0].unreadable, undefined);
});

// Round 9: a frame's file going and coming back is told, whatever its bytes.

test("canvas: a frame's file gone and back is told each time, even with the engine's own bytes; an own write still isn't", async () => {
  const { root, ctx, changed } = setup();
  canvas.createFile(ctx, root, "Foo", undefined, "foo");
  canvas.addFrame(ctx, root, "foo", { name: "A", w: 400, h: 400 }, `<html><body><p>x</p></body></html>`);
  canvas.watchFile(ctx, root, "foo", true);
  await wait(300);
  const abs = join(root, ".liner/designs/foo/frames/a.html");
  // An ordinary write through the engine: told once, as the write's own, and the watcher adds nothing.
  const w = canvas.writeFrame(ctx, root, "foo", "a", `<html><body><p>mine</p></body></html>`, { by: "you" });
  await wait(500);
  const n0 = changed().length;
  assert.deepEqual(changed().map((e) => e.by), ["you"]);
  const away = join(mkdtempSync(join(tmpdir(), "lc-canvas-away-")), "a.html");
  const { renameSync } = await import("node:fs");
  renameSync(abs, away);
  await wait(500);
  const gone = changed().slice(n0);
  assert.deepEqual(gone.map((e) => [e.frame, e.by, e.rev]), [["a", "agent", undefined]], "gone: one event, no rev");
  renameSync(away, abs);
  await wait(500);
  const back = changed().slice(n0 + 1);
  assert.deepEqual(back.map((e) => [e.frame, e.by, e.rev]), [["a", "agent", w.rev]], "back with the engine's own bytes: one event, with its rev");
  canvas.writeFrame(ctx, root, "foo", "a", `<html><body><p>again</p></body></html>`, { by: "you" });
  await wait(500);
  assert.deepEqual(changed().slice(n0 + 2).map((e) => e.by), ["you"], "an own write while it stayed: nothing extra");
  canvas.watchFile(ctx, root, "foo", false);
});

// Round 10: a gone frame's delete and undo, its file coming back after a delete, and the unreadable sentence.

test("canvas: undo of deleting a frame whose file was gone puts it back as it was, missing, and whole when the file returns", async () => {
  const { root, api, ctx } = setup();
  await api["canvas.create"]({ cwd: root, title: "Gone" });
  await api["canvas.frame.add"]({ cwd: root, file: "gone", frame: { name: "Phone / Week", w: 390, h: 844, x: 300, y: 100, screen: false, by: { agent: "lead", name: "Opus", thread: "t" } }, html: "<html><body><p>Week</p></body></html>" });
  writeFileSync(join(root, "Week.tsx"), "x");
  buildlinks.link(ctx, root, "gone", "phone-week", "Week.tsx");
  const dir = join(root, ".liner/designs/gone");
  const entry = (JSON.parse(readFileSync(join(dir, "design.json"), "utf8")) as DesignFile).frames[0];
  const away = join(mkdtempSync(join(tmpdir(), "lc-canvas-away-")), "w.html");
  const { renameSync } = await import("node:fs");
  renameSync(join(dir, "frames/phone-week.html"), away);
  await api["canvas.frame.remove"]({ cwd: root, file: "gone", frame: "phone-week" });
  const back = await api["canvas.frame.unremove"]({ cwd: root, file: "gone", frame: "phone-week" });
  assert.deepEqual(back.frames, [{ ...entry, missing: true }], "the same entry, missing");
  assert.deepEqual((JSON.parse(readFileSync(join(dir, "design.json"), "utf8")) as DesignFile).frames, [entry]);
  renameSync(away, join(dir, "frames/phone-week.html"));
  assert.deepEqual(canvas.readFile(ctx, root, "gone").frames, [entry], "whole again with its file");
  // Taken meanwhile: refused with a sentence.
  await api["canvas.frame.remove"]({ cwd: root, file: "gone", frame: "phone-week" });
  await api["canvas.frame.add"]({ cwd: root, file: "gone", frame: { name: "Phone / Week", w: 390, h: 844 } });
  await assert.rejects(async () => api["canvas.frame.unremove"]({ cwd: root, file: "gone", frame: "phone-week" }), /on the canvas again|is there again|Another frame has/);
});

test("canvas: a deleted frame's file coming back is adopted with that frame's name, size, screen mark and author, not as a stranger", async () => {
  const { root, api } = setup();
  await api["canvas.create"]({ cwd: root, title: "Back" });
  await api["canvas.frame.add"]({ cwd: root, file: "back", frame: { name: "Phone / Week", w: 390, h: 844, x: 300, y: 100, screen: false, by: { agent: "lead", name: "Opus" } }, html: "<html><body><p>Week</p></body></html>" });
  const dir = join(root, ".liner/designs/back");
  const html = readFileSync(join(dir, "frames/phone-week.html"), "utf8");
  rmSync(join(dir, "frames/phone-week.html"));
  await api["canvas.frame.remove"]({ cwd: root, file: "back", frame: "phone-week" });
  writeFileSync(join(dir, "frames/phone-week.html"), html);
  const f = (await api["canvas.open"]({ cwd: root, file: "back" })).file.frames[0];
  assert.deepEqual([f.id, f.name, f.w, f.h, f.x, f.y, f.screen, f.by?.name, f.built], ["phone-week", "Phone / Week", 390, 844, 300, 100, false, "Opus", undefined]);
});

test("canvas: the unreadable sentence says plainly when Liner has no earlier copy", async () => {
  const { root, api } = setup();
  await api["canvas.create"]({ cwd: root, title: "Lone" });
  writeFileSync(join(root, ".liner/designs/lone/design.json"), "{ \"v\": 1, \"ti");
  const [info] = await api["canvas.list"]({ cwd: root });
  assert.match(info.unreadable!, /Liner Code has no earlier copy of it, and has left the broken file as it is: fix it by hand\.$/);
});
