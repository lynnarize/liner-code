/*
  Liner Design's live frames and the Demo on the canvas. A live frame is the dev server's page
  through the Browser's proxy with the frame agent in it too, and only when the frame's marker is
  on the request: the Browser panel's pages stay as they were. The Demo, sent a message from the
  Design face, draws Foreshore's seven frames one after another, with a lean for the folder.
  Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesignFile } from "../../contracts/src/index.ts";
import { COMPUTED } from "../../contracts/src/index.ts";
import { FRAME_AGENT } from "../src/canvas.ts";
import { peekFile as designOf } from "../src/canvas.ts";
import { drawTides, foreshorePage, slugOfNote, TIDE_FRAMES } from "../src/providers/demo-canvas.ts";
import type { OpenOptions, ToolUpdate, TurnSink } from "../src/providers/types.ts";
import { FRAME_MARK, fromFrame, Proxies, unmarked } from "../src/proxy.ts";

/** A design file on disk as any writer leaves it (the canvas reads it back through peekFile / readFile). */
function saveDesign(cwd: string, slug: string, d: DesignFile) {
  mkdirSync(join(cwd, ".liner", "designs", slug, "frames"), { recursive: true });
  writeFileSync(join(cwd, ".liner", "designs", slug, "design.json"), JSON.stringify(d, null, 2));
}

const get = (url: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    request(url, { headers }, (r) => {
      let body = "";
      r.on("data", (c) => (body += c));
      r.on("end", () => resolve({ status: r.statusCode ?? 0, body }));
    })
      .on("error", reject)
      .end();
  });

test("live frames: the frame agent goes into a page only with the frame's marker; the dev server never sees it", async () => {
  const asked: string[] = [];
  const dev = createServer((req, res) => {
    asked.push(req.url ?? "");
    if (req.url?.startsWith("/app.js")) return void res.writeHead(200, { "content-type": "text/javascript" }).end("console.log(1)");
    res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><html><head><title>Today</title></head><body>Tides</body></html>");
  });
  await new Promise<void>((r) => dev.listen(0, "127.0.0.1", r));
  const port = (dev.address() as { port: number }).port;
  const proxies = new Proxies();
  try {
    const base = await proxies.url(port);
    const browser = await get(`${base}/today`);
    assert.match(browser.body, /<script src="\/__liner\/probe\.js"><\/script><title>/);
    assert.ok(!browser.body.includes("data-liner-agent"), "the Browser panel's page is as it was");

    const frame = await get(`${base}/today?tab=2&${FRAME_MARK}=1#tide`);
    assert.ok(frame.body.startsWith(`<!doctype html><html><head><script src="/__liner/probe.js"></script><script data-liner-agent>window.__linerComputed=${JSON.stringify(COMPUTED)};`), "tagged, so the agent leaves its own tag out of what it serialises, and it starts with the computed list");
    assert.ok(frame.body.includes(`${readFileSync(FRAME_AGENT, "utf8")}</script><title>`), "the agent's own text, inline in the same tag");
    assert.equal(asked.at(-1), "/today?tab=2", "the marker is taken off before the dev server sees it");

    const byHeader = await get(`${base}/week`, { "x-liner-frame": "1" });
    assert.match(byHeader.body, /data-liner-agent/);
    const reached = await get(`${base}/station`, { referer: `${base}/today?${FRAME_MARK}=1` });
    assert.match(reached.body, /data-liner-agent/, "a page reached from a live frame is still one");
    assert.ok(!(await get(`${base}/station`, { referer: `${base}/today` })).body.includes("data-liner-agent"));
    assert.equal((await get(`${base}/app.js?${FRAME_MARK}=1`)).body, "console.log(1)", "only HTML gets a script");

    const agent = await get(`${base}/__liner/frame-agent.js`);
    assert.equal(agent.body, readFileSync(FRAME_AGENT, "utf8"), "the same file the app inlines into a drawn frame");
  } finally {
    proxies.closeAll();
    dev.close();
  }
  assert.equal(unmarked(`/a?${FRAME_MARK}=1`), "/a");
  assert.equal(unmarked(`/a?b=1&${FRAME_MARK}=1#c`), "/a?b=1#c");
  assert.equal(unmarked("/a?b=1"), "/a?b=1");
  assert.equal(fromFrame({ url: `/x?${FRAME_MARK}=0`, headers: {} }), false);
});

function sink() {
  const tools: ToolUpdate[] = [];
  let text = "";
  const s: TurnSink = {
    text: (d) => void (text += d),
    reasoning: () => {},
    tool: (u) => void tools.push(u),
    plan: () => {},
    approve: async () => ({ allow: true }),
    ask: async () => null,
    propose: async () => ({ approve: true }),
    usage: () => {},
    session: () => {},
    notice: () => {},
    error: () => {},
    limited: () => {},
  };
  return { s, tools, said: () => text };
}

const note = (slug: string, selected = "", ask = "Design a home screen for the tide tables") => `## Design\n\nThe design file is “Tide tables”, .liner/designs/${slug}/ in this folder.${selected ? `\nSelected: ${selected}.` : ""}\n\n${ask}`;

/** The Demo's sample project: the tide tables' own code. */
function sampleDir() {
  const dir = mkdtempSync(join(tmpdir(), "lc-demo-sample-"));
  writeFileSync(join(dir, "package.json"), "{}");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/tides.js"), "export function nextHigh() {}\n");
  return dir;
}

/** Liner Code's tools as the Demo reaches them (its surface door), faked: design_built is recorded and answered. */
async function surface() {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => {
      let m: { tool: string; args: Record<string, unknown> };
      try {
        m = JSON.parse(b);
      } catch {
        return void res.writeHead(400).end("{}");
      }
      calls.push(m);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, result: { content: [{ type: "text", text: `recorded: ${m.args.frame} is built as ${m.args.file}.` }] } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const mcp = { command: "", args: [] as string[], env: { LINER_SURFACE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}/surface`, LINER_SURFACE_KEY: "k" } };
  return { calls, mcp, close: () => server.close() };
}

const run = async (o: OpenOptions, text: string) => {
  const k = sink();
  await drawTides(o, text, k.s, new AbortController().signal, `t${Math.random()}`, 0);
  return k;
};
const frameHtml = (cwd: string, slug: string, id: string) => readFileSync(join(cwd, ".liner/designs", slug, "frames", `${id}.html`), "utf8");

test("the Demo on the canvas: Foreshore's seven frames, one after another, into the file the note names, in its sample project; no DESIGN.md unless asked", async () => {
  const cwd = sampleDir();
  const o = { cwd, access: "edits" } as OpenOptions;
  const empty: DesignFile = { v: 1, id: "untitled", title: "Untitled", pages: [{ id: "p-a", name: "Page 1" }], frames: [], lean: { builtin: "liner-2", skills: ["brandkit"] } };
  saveDesign(cwd, "untitled", empty);
  assert.equal(slugOfNote(note("untitled")), "untitled");
  assert.equal(slugOfNote("no note"), "tide-tables");
  const k = await run(o, note("untitled"));
  const file = designOf(cwd, "untitled")!;
  assert.equal(file.title, "Tide tables");
  assert.deepEqual(file.frames.map((f) => [f.name, f.w, f.h, f.page]), [
    ["Desktop / Today", 1280, 800, "p-a"],
    ["Brand / Board", 1280, 800, "p-a"],
    ["Phone / Today", 390, 844, "p-a"],
    ["Phone / Station", 390, 844, "p-a"],
    ["Phone / Week", 390, 844, "p-a"],
    ["Dark / Today", 390, 844, "p-a"],
    ["Web / Launch", 1280, 800, "p-a"],
  ]);
  assert.deepEqual(file.frames.filter((f) => f.screen === false).map((f) => f.name), ["Brand / Board"], "the board isn't a screen of the app");
  // The lean is optional (the spec's decision 5): with none and no word of one in the ask, none is written.
  assert.deepEqual(file.lean, { builtin: "liner-2", skills: ["brandkit"] });
  assert.equal(existsSync(join(cwd, "DESIGN.md")), false, "no DESIGN.md nobody asked for");
  assert.equal(k.tools.some((t) => /DESIGN\.md/.test(t.title)), false, "no lean row either");
  assert.match(k.said(), /There's no lean here, so I drew it in Foreshore's own look/);
  for (const f of file.frames) {
    const html = readFileSync(join(cwd, ".liner/designs/untitled", f.path!), "utf8");
    assert.ok(!html.includes('href="foreshore.css"'), `${f.name} is self-contained`);
    assert.match(html, /--foreshore:#B5D3A0/, `${f.name} has the chart's colours`);
  }
  assert.match(frameHtml(cwd, "untitled", "dark-today"), /^<!doctype html>\n<html lang="en" class="night">/);
  const draws = k.tools.filter((t) => t.title.startsWith("Draw ") && t.status === "done");
  assert.deepEqual(draws.map((t) => t.path), TIDE_FRAMES.map((s) => `.liner/designs/untitled/frames/${s.id}.html`), "each frame a write of its own, in order, so presence follows them");
  assert.match(k.said(), /seven frames in “Tide tables”/);

  // Asked again with nothing it has a script for: it changes nothing. Asked for night or day: the selected frame, exactly.
  const before = frameHtml(cwd, "untitled", "phone-week");
  assert.match((await run(o, note("untitled", "Phone / Week › n4 (<div>)", "Make the week tighter"))).said(), /didn't change anything/);
  assert.equal(frameHtml(cwd, "untitled", "phone-week"), before);
  await run(o, note("untitled", "Phone / Week › n4 (<div>)", "Make it night"));
  assert.match(frameHtml(cwd, "untitled", "phone-week"), /<html lang="en" class="night">/);
  await run(o, note("untitled", "Phone / Week", "Back to the light colours"));
  assert.equal(frameHtml(cwd, "untitled", "phone-week"), before);
  assert.doesNotMatch(frameHtml(cwd, "untitled", "phone-today"), /class="night"/, "nothing else turned");
});

test("B1: the Demo draws into Design Home's empty frames and lays the rest out in two tidy rows beside what's there", async () => {
  const cwd = sampleDir();
  const blank = (name: string, w: number) => `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=${w}">\n<title>${name}</title>\n<style>body { margin: 0; }</style>\n</head>\n<body data-l="b${w}">\n</body>\n</html>\n`;
  saveDesign(cwd, "tides", { v: 1, id: "tides", title: "Tides", pages: [{ id: "p1", name: "Page 1" }], lean: { skills: [] }, frames: [
    { id: "desktop", page: "p1", name: "Desktop", kind: "drawn", path: "frames/desktop.html", x: 0, y: 0, w: 1280, h: 800 },
    { id: "phone", page: "p1", name: "Phone", kind: "drawn", path: "frames/phone.html", x: 1360, y: 0, w: 390, h: 844 },
    { id: "notes", page: "p1", name: "Notes", kind: "drawn", path: "frames/notes.html", x: 1900, y: 0, w: 600, h: 400 },
  ] });
  writeFileSync(join(cwd, ".liner/designs/tides/frames/desktop.html"), blank("Desktop", 1280));
  writeFileSync(join(cwd, ".liner/designs/tides/frames/phone.html"), blank("Phone", 390));
  writeFileSync(join(cwd, ".liner/designs/tides/frames/notes.html"), "<p>Ideas</p>");
  const k = await run({ cwd, access: "edits" } as OpenOptions, note("tides"));
  const file = designOf(cwd, "tides")!;
  assert.equal(file.frames.length, 8, "seven, two of them in the empty frames, and Notes kept");
  assert.deepEqual([file.frames.find((f) => f.id === "desktop")!.name, file.frames.find((f) => f.id === "phone")!.name], ["Desktop / Today", "Phone / Today"], "same id, renamed");
  assert.match(frameHtml(cwd, "tides", "phone"), /tide|Tide/);
  assert.equal(frameHtml(cwd, "tides", "notes"), "<p>Ideas</p>");
  const notes = file.frames.find((f) => f.id === "notes")!;
  const demo = file.frames.filter((f) => f.id !== "notes");
  for (const f of demo) assert.ok(f.x >= notes.x + notes.w + 240, `${f.name} is beside what was there`);
  const overlap = (a: (typeof demo)[0], b: (typeof demo)[0]) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const a of file.frames) for (const b of file.frames) if (a !== b) assert.ok(!overlap(a, b), `${a.name} and ${b.name} don't overlap`);
  assert.deepEqual(new Set(demo.map((f) => f.y)).size, 2, "two rows");
  assert.match(k.said(), /into the empty “Desktop” and “Phone”/);
});

test("B2: Build writes a page per named frame in the sample project and records each with design_built; Update code and Bring it into the frame do what they say", async () => {
  const cwd = sampleDir();
  const s = await surface();
  try {
    const o = { cwd, access: "edits", mcp: s.mcp } as unknown as OpenOptions;
    await run(o, note("tide-tables"));
    const ask = ["Build these frames of the design file “Tide tables” into the project's code:", "- Phone / Week (.liner/designs/tide-tables/frames/phone-week.html, 390 × 844)", "- Phone / Station (.liner/designs/tide-tables/frames/phone-station.html, 390 × 844)", "- Phone (.liner/designs/tide-tables/frames/phone.html, 390 × 844)", "", "Read the lean first…", "When a frame is built, call design_built with the frame and the file you wrote, so Liner keeps them in step with the code."].join("\n");
    const before = frameHtml(cwd, "tide-tables", "phone-today");
    const k = await run(o, note("tide-tables", "", ask));
    assert.deepEqual(s.calls.map((c) => [c.tool, c.args.frame, c.args.file]), [["design_built", "phone-week", "src/pages/phone-week.html"], ["design_built", "phone-station", "src/pages/phone-station.html"]], "exact names only: “Phone” isn't “Phone / Week”");
    const page = readFileSync(join(cwd, "src/pages/phone-week.html"), "utf8");
    assert.match(page, /built from its frame on Liner Design's canvas/);
    assert.doesNotMatch(page, /data-l=/);
    assert.equal(frameHtml(cwd, "tide-tables", "phone-today"), before, "no other frame changed");
    assert.match(k.said(), /Built 2 frames into the sample project/);

    // Update code: the frame moved on; its file is written again and recorded.
    writeFileSync(join(cwd, ".liner/designs/tide-tables/frames/phone-week.html"), frameHtml(cwd, "tide-tables", "phone-week").replace("<body", '<body data-l="wk" style="outline:2px solid red"'));
    await run(o, note("tide-tables", "", "Phone / Week (.liner/designs/tide-tables/frames/phone-week.html) changed since it was built as src/pages/phone-week.html. Change only this in src/pages/phone-week.html:\n- “The week”: outline set to 2px solid red\n\nLeave the rest of each file as it is. Then call design_built for each frame with its file, so they're in step again."));
    assert.match(readFileSync(join(cwd, "src/pages/phone-week.html"), "utf8"), /outline:2px solid red/);
    assert.equal(s.calls.length, 3);

    // Bring it into the frame: the file moved on; the frame takes it, every id kept.
    const ids = (h: string) => [...h.matchAll(/data-l="([^"]+)"/g)].map((m) => m[1]);
    const station = frameHtml(cwd, "tide-tables", "phone-station");
    writeFileSync(join(cwd, "src/pages/phone-station.html"), readFileSync(join(cwd, "src/pages/phone-station.html"), "utf8").replace("<body", '<body title="Hello from the code"'));
    await run(o, note("tide-tables", "", "src/pages/phone-station.html changed after Phone / Station was built from it: src/pages/phone-station.html changed since it was built.\nLook at what changed in src/pages/phone-station.html since then (git can show it) and bring only that into the frame, .liner/designs/tide-tables/frames/phone-station.html. Keep the frame's data-l ids, and leave the rest of it as it is.\nThen call design_built for Phone / Station with src/pages/phone-station.html, so they're in step again."));
    const now = frameHtml(cwd, "tide-tables", "phone-station");
    assert.match(now, /title="Hello from the code"/);
    assert.deepEqual(ids(now), ids(station), "every data-l id kept");
    assert.equal(s.calls.at(-1)!.args.frame, "phone-station");
  } finally {
    s.close();
  }
});

test("B2: Send to code puts held changes into the file the ask names, or says what it would; no frame changes", async () => {
  const cwd = sampleDir();
  const o = { cwd, access: "edits" } as OpenOptions;
  await run(o, note("tide-tables"));
  mkdirSync(join(cwd, "site"));
  writeFileSync(join(cwd, "site/index.html"), "<html><head><title>T</title></head><body><h1 class=\"title\">Tides</h1></body></html>");
  const frames = () => TIDE_FRAMES.map((f) => frameHtml(cwd, "tide-tables", f.id)).join("");
  const before = frames();
  const ask = (from: string) => ["Change the code so the running app shows this change. It was made by hand on the canvas, in a live frame of the app, and is shown there now, but nothing is written to the code yet:", "", `1. \`h1.title\` “Tides”, on localhost:5173/${from}`, "   background-color: not set → #F0DA9C", "   its text → “Tide tables”", "   Its HTML now: <h1 class=\"title\">Tides</h1>", "", "Find each element in the source…"].join("\n");
  const k = await run(o, note("tide-tables", "", ask(", from site/index.html:1")));
  const page = readFileSync(join(cwd, "site/index.html"), "utf8");
  assert.match(page, /h1\.title \{ background-color: #F0DA9C; \}/);
  assert.match(page, />Tide tables</);
  assert.match(k.said(), /1 change|One change/);
  const k2 = await run(o, note("tide-tables", "", ask("")));
  assert.match(k2.said(), /I'd set background-color to #F0DA9C, its text to “Tide tables”, but the ask names no file/);
  assert.equal(frames(), before, "the canvas is untouched");
});

test("B2, B3: 3 more like this draws three different takes into the take frames, never the original; a Fix fixes the named finding", async () => {
  const cwd = sampleDir();
  const o = { cwd, access: "edits" } as OpenOptions;
  await run(o, note("tide-tables"));
  const idx = designOf(cwd, "tide-tables")!;
  const station = frameHtml(cwd, "tide-tables", "phone-station");
  for (const id of ["phone-station-2", "phone-station-3", "phone-station-4"]) writeFileSync(join(cwd, ".liner/designs/tide-tables/frames", `${id}.html`), station);
  saveDesign(cwd, "tide-tables", { ...idx, frames: [...idx.frames, ...["2", "3", "4"].map((n, i) => ({ id: `phone-station-${n}`, page: idx.pages[0].id, name: `Phone / Station ${n}`, kind: "drawn" as const, path: `frames/phone-station-${n}.html`, x: 3000 + i * 500, y: 2000, w: 390, h: 844 }))] });
  // An empty "Phone" frame too: the ask's name is never taken by its start.
  writeFileSync(join(cwd, ".liner/designs/tide-tables/frames/phone.html"), "<p>empty</p>");
  const k = await run(o, note("tide-tables", "", "Draw 3 more ways of “Phone / Station” (frames/phone-station.html), one into each of these new frames, which start as copies of it: frames/phone-station-2.html, frames/phone-station-3.html, frames/phone-station-4.html. Make each one a different take…"));
  const takes = ["2", "3", "4"].map((n) => frameHtml(cwd, "tide-tables", `phone-station-${n}`));
  assert.equal(new Set([station, ...takes]).size, 4, "three takes, each different from the original and each other");
  assert.equal(frameHtml(cwd, "tide-tables", "phone-station"), station, "the original as it was");
  assert.equal(readFileSync(join(cwd, ".liner/designs/tide-tables/frames/phone.html"), "utf8"), "<p>empty</p>");
  assert.match(k.said(), /3 takes of Phone \/ Station/);

  // Fix: the named finding in the named frame.
  const week = frameHtml(cwd, "tide-tables", "phone-week");
  const id = /<(?:div|span|p)[^>]*data-l="([^"]+)"/.exec(week)?.[1] ?? /data-l="([^"]+)"/.exec(week)?.[1];
  const target = id ?? "x";
  if (!id) writeFileSync(join(cwd, ".liner/designs/tide-tables/frames/phone-week.html"), week.replace("<body", `<body data-l="${target}"`));
  const k2 = await run(o, note("tide-tables", "", `Fix this check in Phone / Week:\n- Phone / Week (contrast, data-l ${target}): “Tide gauge” in #C4127A on #F0DA9C is 4 to 1. Text this small needs 4.5.\n\nChange only what this needs…`));
  assert.match(frameHtml(cwd, "tide-tables", "phone-week"), new RegExp(`data-l="${target}"[^>]*style="[^"]*color: var\\(--ink\\)`));
  assert.match(k2.said(), /Fixed Phone \/ Week, contrast/);
});

test("the Demo writes a DESIGN.md only when the ask says so, and follows one that's there", async () => {
  const cwd = sampleDir();
  const o = { cwd, access: "edits" } as OpenOptions;
  const k = await run(o, note("tide-tables", "", "Draw the tide tables, and write a DESIGN.md for them"));
  assert.match(readFileSync(join(cwd, "DESIGN.md"), "utf8"), /^# Foreshore, tide tables/);
  assert.equal(designOf(cwd, "tide-tables")!.lean.path, "DESIGN.md");
  assert.ok(k.tools.some((t) => t.title === "Write DESIGN.md" && t.status === "done"));
  assert.match(k.said(), /I wrote DESIGN\.md as you asked/);
  // One the folder has already: read, never written over.
  const had = sampleDir();
  writeFileSync(join(had, "DESIGN.md"), "# Ours\n");
  const k2 = await run({ cwd: had, access: "edits" } as OpenOptions, note("tide-tables"));
  assert.equal(readFileSync(join(had, "DESIGN.md"), "utf8"), "# Ours\n");
  assert.ok(k2.tools.some((t) => t.title === "Read DESIGN.md"));
  assert.match(k2.said(), /I followed DESIGN\.md/);
});

test("N11: outside its sample project the Demo writes nothing and answers in words; a session that only reads too", async () => {
  const away = mkdtempSync(join(tmpdir(), "lc-demo-away-"));
  const k = await run({ cwd: away, access: "edits" } as OpenOptions, note("tide-tables"));
  assert.equal(existsSync(join(away, ".liner")), false);
  assert.equal(existsSync(join(away, "DESIGN.md")), false);
  assert.match(k.said(), /only draw and change files in my sample project \(Sample project in the sidebar\) or in a design on its own/);
  const ro = sampleDir();
  const k2 = await run({ cwd: ro, access: "read" } as OpenOptions, note("tide-tables"));
  assert.equal(existsSync(join(ro, ".liner")), false);
  assert.match(k2.said(), /this session only reads/);
  assert.equal(foreshorePage("phone-today.html", true).includes('class="night"'), true);
  // A frame's path in design.json that leads out isn't followed.
  const cwd = sampleDir();
  await run({ cwd, access: "edits" } as OpenOptions, note("tide-tables"));
  const idx = designOf(cwd, "tide-tables")!;
  writeFileSync(join(cwd, ".liner/designs/tide-tables/design.json"), JSON.stringify({ ...idx, frames: idx.frames.map((f) => (f.id === "phone-week" ? { ...f, path: "../../../escape.html" } : f)) }));
  await run({ cwd, access: "edits" } as OpenOptions, note("tide-tables", "Phone / Week", "Make it night"));
  assert.equal(existsSync(join(cwd, "escape.html")), false);
});

test("L2: unmarked takes only the marker out of the query, every other byte as it came (R's probe P5)", () => {
  const cases: [string, string][] = [
    ["/a?x=1;y=2&__liner_frame=1", "/a?x=1;y=2"],
    ["/a?flag&__liner_frame=1", "/a?flag"],
    ["/a?q=%7E~&__liner_frame=1", "/a?q=%7E~"],
    ["/a?q=a%20b&__liner_frame=1", "/a?q=a%20b"],
    ["//other/path?__liner_frame=1", "//other/path"],
    ["/a?__liner_frame=1&b=%2F+c", "/a?b=%2F+c"],
    ["/a?x=1&__liner_frame=1&y=2#h", "/a?x=1&y=2#h"],
    ["/a?x=__liner_frame=1", "/a?x=__liner_frame=1"],
  ];
  for (const [from, to] of cases) assert.equal(unmarked(from), to, from);
});

test("the Demo's frames sit far enough apart for their labels at low zoom: 160 within a row, 240 between rows, in order", () => {
  const row = (y: number) => TIDE_FRAMES.filter((f) => f.y === y).sort((a, b) => a.x - b.x);
  const top = row(0);
  const bottom = row(Math.max(...TIDE_FRAMES.map((f) => f.y)));
  assert.deepEqual(top.map((f) => f.name), ["Desktop / Today", "Brand / Board", "Web / Launch"]);
  assert.deepEqual(bottom.map((f) => f.name), ["Phone / Today", "Phone / Station", "Phone / Week", "Dark / Today"]);
  for (const r of [top, bottom]) for (let i = 1; i < r.length; i++) assert.ok(r[i].x - (r[i - 1].x + r[i - 1].w) >= 160, `${r[i - 1].name} to ${r[i].name}`);
  assert.ok(bottom[0].y - Math.max(...top.map((f) => f.y + f.h)) >= 240);
});

test("L6: night or day changes only the frame the selection holds or the ask names; with neither it asks which", async () => {
  const cwd = sampleDir();
  const o = { cwd, access: "edits" } as OpenOptions;
  await run(o, note("tide-tables"));
  const all = () => TIDE_FRAMES.map((f) => frameHtml(cwd, "tide-tables", f.id)).join("");
  const before = all();
  const k = await run(o, note("tide-tables", "", "Make the caption light grey"));
  assert.equal(all(), before, "nothing selected, no frame named: nothing changes");
  assert.match(k.said(), /Which frame should change\?/);
  await run(o, note("tide-tables", "", "Turn Phone / Week to the night colours"));
  assert.match(frameHtml(cwd, "tide-tables", "phone-week"), /<html lang="en" class="night">/);
  assert.doesNotMatch(frameHtml(cwd, "tide-tables", "phone-today"), /class="night"/, "Phone / Today isn't touched");
});
