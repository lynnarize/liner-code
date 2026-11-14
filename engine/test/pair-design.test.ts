/*
  A pair on Liner Design's canvas. The lead of a pair is told in the "## Design" note what to hand
  its sidekick there (the look and first frames stay its own; frames that follow a pattern and
  mechanical fixes go over), and the sidekick never gets that note: it hears only the briefs. The
  Demo pair does it end to end: its lead draws the first drawing's frames, hands the night chart to
  its sidekick through the real sidekick tool, and the sidekick writes that frame in parts, on the
  canvas as the sidekick. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesignFile, EngineEvent, Item, ProviderInfo } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { AgentTools } from "../src/agent-tools.ts";
import * as canvas from "../src/canvas.ts";
import { designNote, sidekickPart } from "../src/lean.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { ensureSampleProject } from "../src/providers/demo.ts";
import { drawBrief, frameBrief, HANDED, isFrameBrief, piecesOf } from "../src/providers/demo-canvas.ts";
import type { OpenOptions, Provider, TurnSink } from "../src/providers/types.ts";
import { sidekickResult } from "../src/sidekick.ts";
import { Store } from "../src/store.ts";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const HAND = /Once a frame sets the pattern, hand/;

function design(cwd: string, frames = 3) {
  const d: DesignFile = {
    v: 1,
    id: "tide-tables",
    title: "Tide tables",
    pages: [{ id: "p1", name: "Page 1" }],
    frames: Array.from({ length: frames }, (_, i) => ({ id: `frame-${i}`, page: "p1", name: `Phone / Screen number ${i}`, kind: "drawn" as const, path: `frames/frame-${i}.html`, x: 0, y: 0, w: 390, h: 844 })),
    lean: { skills: [] },
  };
  mkdirSync(join(cwd, ".liner", "designs", "tide-tables", "frames"), { recursive: true });
  writeFileSync(join(cwd, ".liner", "designs", "tide-tables", "design.json"), JSON.stringify(d, null, 2));
}

test("the design note tells a pair's lead what to hand its sidekick, by name, and says nothing of it to a single model", () => {
  const cwd = tmp("lc-pd-");
  design(cwd);
  writeFileSync(join(cwd, "DESIGN.md"), "## Colour\n- Ink #111111\n");
  const home = tmp("lc-pd-home-");
  const one = designNote(cwd, { file: "tide-tables" }, { HOME: home });
  const two = designNote(cwd, { file: "tide-tables" }, { HOME: home }, { sidekick: "Haiku 4.5" });
  assert.doesNotMatch(one, HAND);
  assert.doesNotMatch(one, /sidekick/i, "a single model hears nothing of a sidekick");
  const part = sidekickPart("Haiku 4.5", ".liner/designs/tide-tables/", "DESIGN.md");
  assert.equal(
    part,
    "Haiku 4.5 is your sidekick. The look is yours: decide it, and draw each screen's first frame and any small change to one element yourself. Once a frame sets the pattern, hand Haiku 4.5 its follow-on frames (another size, dark, empty, loading, error) and the same change across frames, such as a check's finding in several. It sees none of this note: each brief names .liner/designs/tide-tables/, the frame to copy, the lean (DESIGN.md), the frame to make or change, and that data-l ids stay; done_when says what design_shot should show.",
  );
  assert.ok(part.length < 560, `${part.length}`);
  assert.ok(two.includes(`\n${part}\nFrames:`), "a line of its own after the head");
  assert.equal(two.match(/design_shot before you say it's done/g)?.length, 1, "the note's own last line says to look, once");
  assert.ok(two.endsWith("Look at a frame with design_shot before you say it's done."));
  // With no lean the brief names none.
  const bare = tmp("lc-pd-bare-");
  design(bare);
  assert.doesNotMatch(designNote(bare, { file: "tide-tables" }, { HOME: home }, { sidekick: "Haiku" }), /the lean \(/);
});

test("a pair's lead's design note is the single model's note byte for byte, plus the hand-over: nothing is cut for it", () => {
  const home = tmp("lc-pd-home-");
  const sel = (n: number, size = 30) => ({ file: "tide-tables", frames: ["frame-1"], nodes: Array.from({ length: n }, (_, i) => ({ frame: "frame-1", id: `n${i}`, html: `<div class="x">node ${i} ${"t".repeat(size)}</div>` })) });
  const cases: [string, number, number, ReturnType<typeof sel> | undefined][] = [
    ["few", 3, 2, undefined],
    ["many rules", 5, 12, sel(1)],
    ["many selected", 5, 2, sel(8)],
    ["80 frames", 80, 3, sel(2)],
    ["cut at the end", 80, 12, sel(30, 80)],
    ["no lean", 6, -1, sel(3)],
  ];
  for (const [what, frames, rules, s] of cases) {
    const cwd = tmp("lc-pd-eq-");
    design(cwd, frames);
    if (rules >= 0) writeFileSync(join(cwd, "DESIGN.md"), `## Rules\n${Array.from({ length: rules }, (_, i) => `- Never do forbidden thing number ${i} in any frame`).join("\n")}\n`);
    const mark = { file: "tide-tables", ...(s ? { sel: s } : {}) };
    const name = "A sidekick with a really quite long model name (preview)";
    const one = designNote(cwd, mark, { HOME: home });
    const two = designNote(cwd, mark, { HOME: home }, { sidekick: name });
    const part = sidekickPart(name, ".liner/designs/tide-tables/", rules >= 0 ? "DESIGN.md" : undefined);
    assert.ok(one.length <= 2000, `${what}: ${one.length}`);
    assert.ok(two.includes(`\n${part}\n`), `${what}: the part, whole`);
    assert.equal(two.replace(`\n${part}`, ""), one, `${what}: the rest is the single model's note`);
    assert.equal(two.length, one.length + part.length + 1, what);
  }
});

test("through the runtime: a pair's lead gets the hand-over in its design turn, and its sidekick gets only the brief", async () => {
  const cwd = tmp("lc-pd-rt-");
  design(cwd);
  const home = tmp("lc-pd-rt-home-");
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
  const info = (id: ProviderInfo["id"], m: string): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: [{ id: m, label: m === "gpt-6-luna" ? "GPT-6 Luna" : m, description: "" }], supports: { approvals: true, resume: true, effort: true, plan: true } });
  const tools = new AgentTools(store, process.env);
  tools.url = "http://127.0.0.1:9";
  const runtime = new Runtime(store, { ...process.env, HOME: home }, tools);
  tools.host = runtime;
  runtime.providerInfo = [info("claude", "claude-opus-5-5"), info("codex", "gpt-6-luna")];
  const heard: { who: string; text: string }[] = [];
  let result = "";
  const fake = (id: "claude" | "codex", lead: boolean): Provider => ({
    id,
    detect: async () => info(id, ""),
    open: (o: OpenOptions) => ({
      close() {},
      turn: async (text: string, sink: TurnSink) => {
        heard.push({ who: o.sidekick ? "sidekick" : lead ? "lead" : "single", text });
        // The sidekick changes a frame with its own file tools, not Liner Code's: measured all the same.
        if (o.sidekick) return void writeFileSync(join(o.cwd, ".liner/designs/tide-tables/frames/frame-1.html"), "<!doctype html><html class=\"night\"><body><p>Night</p></body></html>");
        if (!lead || !o.mcp?.env.LINER_SIDEKICK) return;
        // The lead hands a frame over the way a tool calls Liner Code's server.
        const args = { brief: "Draw Dark / Today from frames/frame-0.html at night.", done_when: "design_shot shows it at night." };
        sink.tool({ key: "k", tool: "mcp__liner__sidekick", toolKind: "other", title: "Sidekick", input: JSON.stringify(args), status: "running" });
        const r = await tools.call(tools.threadOf(o.mcp.env.LINER_SURFACE_KEY)!, "sidekick", args);
        result = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
        sink.tool({ key: "k", tool: "mcp__liner__sidekick", toolKind: "other", title: "Sidekick", status: "done" });
      },
    }),
  });
  const saved = { claude: providers.claude, codex: providers.codex };
  providers.claude = fake("claude", true);
  providers.codex = fake("codex", false);
  try {
    store.putThread({ id: "pair", projectId: "p", title: "Pair", agent: "@claude:claude-opus-5-5", sidekick: "codex:gpt-6-luna", status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
    store.putThread({ id: "one", projectId: "p", title: "One", agent: "@claude:claude-opus-5-5", status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
    await runtime.send("pair", "Draw the night chart", "queue", undefined, undefined, { file: "tide-tables" });
    await runtime.send("one", "Draw the night chart", "queue", undefined, undefined, { file: "tide-tables" });
    const lead = heard.find((h) => h.who === "lead");
    const side = heard.find((h) => h.who === "sidekick");
    assert.ok(lead && side, JSON.stringify(heard.map((h) => h.who)));
    assert.match(lead.text, /^## Design\n/);
    assert.match(lead.text, /GPT-6 Luna is your sidekick\./, "named by its label");
    assert.match(lead.text, HAND);
    assert.doesNotMatch(side.text, /## Design|Once a frame sets the pattern|is your sidekick/, "the sidekick hears the brief alone");
    assert.match(side.text, /^Draw Dark \/ Today from frames\/frame-0\.html at night\.\n\nDone when: design_shot shows it at night\.$/);
    // A single model in the same face: the note, without the hand-over (the lead of the pair above opened first, so this is the last turn).
    const single = heard.filter((h) => h.who === "lead").at(-1)!;
    assert.notEqual(single, lead);
    assert.match(single.text, /^## Design\n/);
    assert.doesNotMatch(single.text, HAND);
    // The frame it changed is measured, though the folder's snapshot leaves .liner/ out (and this one has no git at all).
    assert.match(result, /Frames changed on the canvas \(measured\):\n- Phone \/ Screen number 1 \(\.liner\/designs\/tide-tables\/frames\/frame-1\.html\)/);
    assert.match(result, /look at the frames with design_shot/);
    const row = store.timeline("pair").find((x): x is Extract<Item, { kind: "tool" }> => x.kind === "tool" && x.tool === "mcp__liner__sidekick");
    assert.deepEqual(row?.agent?.frames, [{ name: "Phone / Screen number 1", path: ".liner/designs/tide-tables/frames/frame-1.html" }]);
  } finally {
    Object.assign(providers, saved);
    runtime.shutdown();
  }
});

test("a brief that only drew on the canvas reads so to the lead: its frames by name and path, never \"none\"", () => {
  const frames = [{ name: "Dark / Today", path: ".liner/designs/x/frames/dark-today.html" }];
  const drew = sidekickResult({ how: "done", who: "Haiku", seconds: 3, report: "Done.", files: [], frames });
  assert.match(drew, /Frames changed on the canvas \(measured\):\n- Dark \/ Today \(\.liner\/designs\/x\/frames\/dark-today\.html\)/);
  assert.match(drew, /Outside the design files, no file changed \(measured\)\./);
  assert.doesNotMatch(drew, /none/i);
  // With code changed too, both; with nothing at all, as before.
  const both = sidekickResult({ how: "done", who: "Haiku", seconds: 3, report: "Done.", files: [{ path: "src/a.ts", status: "modified", added: 1, removed: 0 }], frames });
  assert.match(both, /Files changed \(measured\):\n- src\/a\.ts: modified, \+1 -0\n\nFrames changed on the canvas/);
  assert.match(sidekickResult({ how: "done", who: "Haiku", seconds: 3, report: "Done.", files: [] }), /Files changed \(measured\): none\.\n\nThe report is its own claim: check the diff before you rely on it\.$/);
});

test("the Demo's frame brief carries what the sidekick needs, and only that brief is drawn on the canvas", () => {
  const b = frameBrief(".liner/designs/tide-tables", { name: "Dark / Today", path: "frames/dark-today.html", w: 390, h: 844, x: 1650, y: 1040 }, { name: "Phone / Today", path: "frames/phone-today.html" }, "DESIGN.md");
  assert.match(b.brief, /^Draw Dark \/ Today in the design folder \.liner\/designs\/tide-tables\/: frames\/dark-today\.html, 390 × 844, a copy of Phone \/ Today \(frames\/phone-today\.html\)/);
  assert.match(b.brief, /The lean is DESIGN\.md/);
  assert.match(b.brief, /Every data-l id stays/);
  assert.match(b.done_when, /^design_shot of Dark \/ Today shows/);
  assert.equal(isFrameBrief(b.brief), true);
  assert.equal(isFrameBrief("In src/tides.js, change nextHigh so that…"), false, "the code brief stays the code brief");
});

test("the Demo's sidekick draws a frame brief in parts, scripts only in the last, every data-l id of the copy kept", async () => {
  const home = tmp("lc-pd-demo-");
  const dir = await ensureSampleProject(home);
  const rel = ".liner/designs/tide-tables";
  mkdirSync(join(dir, rel, "frames"), { recursive: true });
  const src = readFileSync(join(import.meta.dirname, "..", "src", "providers", "demo-foreshore", "phone-today.html"), "utf8").replace("<body", '<body data-l="b0"').replace('<div class="abs tabs"', '<div data-l="m1" class="abs tabs"');
  writeFileSync(join(dir, rel, "frames/phone-today.html"), src);
  writeFileSync(join(dir, rel, "design.json"), JSON.stringify({ v: 1, id: "tide-tables", title: "Tide tables", pages: [{ id: "p1", name: "Page 1" }], frames: [{ id: "phone-today", page: "p1", name: "Phone / Today", kind: "drawn", path: "frames/phone-today.html", x: 0, y: 1040, w: 390, h: 844 }], lean: { skills: [] } }));
  const b = frameBrief(rel, { name: "Dark / Today", path: "frames/dark-today.html", w: 390, h: 844, x: 1650, y: 1040 }, { name: "Phone / Today", path: "frames/phone-today.html" });
  const writes: string[] = [];
  const steps: { title: string; status: string; path?: string }[] = [];
  let said = "";
  const sink = { session() {}, reasoning() {}, plan() {}, usage() {}, text: (d: string) => (said += d), tool: (u: { title?: string; status: string; path?: string; toolKind?: string }) => {
      steps.push({ title: u.title ?? "", status: u.status, ...(u.path ? { path: u.path } : {}) });
      // While its Write runs, each part as the canvas would read it.
      if (u.toolKind === "write" && u.status === "running") poll();
    } } as unknown as TurnSink;
  const file = join(dir, rel, "frames/dark-today.html");
  let polling: NodeJS.Timeout | undefined;
  const poll = () => (polling = setInterval(() => {
    try {
      const now = readFileSync(file, "utf8");
      if (writes.at(-1) !== now) writes.push(now);
    } catch {}
  }, 1));
  await drawBrief({ cwd: dir, access: "edits" } as OpenOptions, `${b.brief}\n\nDone when: ${b.done_when}`, sink, new AbortController().signal, "t", 40);
  clearInterval(polling);
  const page = readFileSync(file, "utf8");
  assert.match(page, /<html[^>]*class="[^"]*\bnight\b/, "the night chart");
  assert.match(page, /data-l="b0"/);
  assert.match(page, /data-l="m1"/);
  assert.equal(writes.at(-1), page);
  assert.ok(writes.length >= 3, `written in parts (${writes.length})`);
  assert.deepEqual(writes, piecesOf(page).filter((p, i, all) => all.indexOf(p) === i), "the parts piecesOf gives, in order");
  for (const w of writes.slice(0, -1)) assert.ok(!/<script\b/i.test(w), "no part but the last carries a script");
  const d = JSON.parse(readFileSync(join(dir, rel, "design.json"), "utf8")) as DesignFile;
  assert.deepEqual(d.frames.find((f) => f.id === "dark-today") && { x: d.frames.find((f) => f.id === "dark-today")!.x, y: d.frames.find((f) => f.id === "dark-today")!.y }, { x: 1650, y: 1040 });
  assert.ok(steps.some((s) => s.title === "Draw Dark / Today" && s.status === "running" && s.path === `${rel}/frames/dark-today.html`), "its Write names the frame's file while it runs");
  assert.match(said, /^Done\. Dark \/ Today is drawn/);
});

test("the Demo pair in Design: the lead draws the first frames, hands the night chart to its sidekick, and the canvas shows the sidekick on it", async () => {
  const home = tmp("lc-pd-pair-");
  const dir = await ensureSampleProject(home);
  const store = new Store(home);
  store.putProject({ id: "p", name: "Sample", path: dir, git: true, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Demo", agent: "@demo:demo", sidekick: "demo:demo", status: "idle", access: "full", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
  const events: EngineEvent[] = [];
  store.on((e) => events.push(e));
  const tools = new AgentTools(store, process.env);
  const runtime = new Runtime(store, { ...process.env, HOME: home }, tools);
  tools.host = runtime;
  const ctx = canvas.designCtx(store, { whoIs: (_id, sidekick) => (sidekick ? "Demo sidekick" : "Demo") });
  canvas.attach(ctx);
  // The engine's /surface, as main.ts serves it.
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      // Other tests running beside this one may knock on any local port: only a call is answered.
      let call: { tool: string; args: Record<string, unknown> };
      try {
        call = JSON.parse(body);
      } catch {
        return void res.end("{}");
      }
      const { tool, args } = call;
      const threadId = tools.threadOf(String(req.headers["x-liner-surface"]));
      res.end(JSON.stringify(threadId ? { ok: true, result: await tools.call(threadId, tool, args) } : { ok: false, error: "no key" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  tools.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await runtime.send("t", "Design a home screen for the tide tables", "queue", undefined, undefined, { file: "tide-tables" });
    const items = store.timeline("t");
    const row = items.find((x): x is Extract<Item, { kind: "tool" }> => x.kind === "tool" && x.tool === "mcp__liner__sidekick")!;
    assert.ok(row, "the lead called the sidekick tool");
    assert.equal(row.agent?.state, "done", JSON.stringify(row.agent));
    assert.match(row.agent?.brief ?? "", /^Draw Dark \/ Today in the design folder \.liner\/designs\/tide-tables\/: frames\/dark-today\.html/);
    assert.deepEqual(row.agent?.steps?.map((s) => s.title), ["Read Phone / Today", "Draw Dark / Today", "Read Dark / Today"]);
    // What it drew, measured on the canvas: on the row, and in what the lead read back.
    assert.deepEqual(row.agent?.frames, [{ name: "Dark / Today", path: ".liner/designs/tide-tables/frames/dark-today.html" }]);
    assert.match(row.output ?? "", /Frames changed on the canvas \(measured\):\n- Dark \/ Today \(\.liner\/designs\/tide-tables\/frames\/dark-today\.html\)/);
    assert.doesNotMatch(row.output ?? "", /Files changed \(measured\): none/);
    // The lead drew every frame but the one it handed over.
    const leadDrew = items.filter((x): x is Extract<Item, { kind: "tool" }> => x.kind === "tool" && /^Draw /.test(x.title ?? "") && x.tool === "Write").map((x) => x.title);
    assert.ok(!leadDrew.includes("Draw Dark / Today") && leadDrew.includes("Draw Phone / Today"), leadDrew.join(", "));
    const on = events.filter((e): e is Extract<EngineEvent, { type: "canvas.presence" }> => e.type === "canvas.presence" && e.on);
    assert.ok(on.some((p) => p.frame === HANDED && p.agent === "sidekick" && p.name === "Demo sidekick" && p.label === "Drawing"), "the sidekick on its frame");
    assert.ok(on.filter((p) => p.frame !== HANDED).every((p) => p.agent === "lead"), "the lead on the rest");
    assert.ok(!on.some((p) => p.frame === HANDED && p.agent === "lead"), "the lead never on the sidekick's frame");
    const page = readFileSync(join(dir, ".liner/designs/tide-tables/frames/dark-today.html"), "utf8");
    assert.match(page, /<html[^>]*class="[^"]*\bnight\b/);
    const said = items.filter((x) => x.kind === "text").map((x) => (x.kind === "text" ? x.text : "")).join("");
    assert.match(said, /my sidekick drew it from Phone \/ Today: I read the frame it wrote/);
  } finally {
    server.close();
    runtime.shutdown();
  }
});
