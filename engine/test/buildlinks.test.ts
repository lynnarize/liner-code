/*
  Liner Design's build links: design_built ties a frame to the project file it became, and
  build.state says per frame whether they still agree (in step, design ahead with what changed in
  words, code ahead, both), from the hashes kept at the build and the frame's HTML of that moment.
  Through the tool as an agent calls it and through the RPC as the app does. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesignFile, EngineEvent } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { builtCopy, buildState, call, diffFrames, elementsOf, frameHash, rpc } from "../src/buildlinks.ts";
import { designCtx } from "../src/canvas.ts";
import { peekFile as designOf, saveFile } from "../src/canvas.ts";
import { Store } from "../src/store.ts";

/** A design file on disk as any writer leaves it (the canvas reads it back through peekFile / readFile). */
function saveDesign(cwd: string, slug: string, d: DesignFile) {
  mkdirSync(join(cwd, ".liner", "designs", slug, "frames"), { recursive: true });
  writeFileSync(join(cwd, ".liner", "designs", slug, "design.json"), JSON.stringify(d, null, 2));
}

const today = (gap = "12px", text = "Next high water") => `<!doctype html><html><head><style>.x{}</style><script>const a = "<div data-l=\\"zz\\">";</script></head><body data-l="b0">
<main data-l="m1" class="screen">
  <section data-l="n1" data-name="Next tide" style="display:flex; gap:${gap}">
    <h2 data-l="n2">${text}</h2>
    <img data-l="n3" src="../assets/a.png">
  </section>
</main></body></html>`;

function setup() {
  const home = mkdtempSync(join(tmpdir(), "lc-build-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "lc-build-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
  store.putThread({ id: "t", projectId: "p", title: "Build", agent: "forge", status: "running", access: "edits", turns: 4, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  const file: DesignFile = {
    v: 1,
    id: "tide-tables",
    title: "Tide tables",
    pages: [{ id: "page-1", name: "Page 1" }],
    frames: [
      { id: "phone-today", page: "page-1", name: "Phone / Today", kind: "drawn", path: "frames/phone-today.html", x: 0, y: 0, w: 390, h: 844 },
      { id: "phone-week", page: "page-1", name: "Phone / Week", kind: "drawn", path: "frames/phone-week.html", x: 500, y: 0, w: 390, h: 844 },
      { id: "app", page: "page-1", name: "Live", kind: "live", url: "localhost:5173", x: 1000, y: 0, w: 390, h: 844 },
    ],
    lean: { skills: [] },
  };
  saveDesign(cwd, "tide-tables", file);
  mkdirSync(join(cwd, ".liner/designs/tide-tables/frames"), { recursive: true });
  writeFileSync(join(cwd, ".liner/designs/tide-tables/frames/phone-today.html"), today());
  writeFileSync(join(cwd, ".liner/designs/tide-tables/frames/phone-week.html"), "<p data-l='w1'>Week</p>");
  mkdirSync(join(cwd, "src/screens"), { recursive: true });
  writeFileSync(join(cwd, "src/screens/Today.tsx"), "export const Today = () => <main />;\n");
  const events: EngineEvent[] = [];
  const ctx = designCtx(store, { emit: (e) => void events.push(e) });
  return { home, cwd, store, ctx, events, frame: join(cwd, ".liner/designs/tide-tables/frames/phone-today.html") };
}

test("build links: none, then in step, design ahead with what changed, code ahead, and both", async () => {
  const { home, cwd, ctx, events, frame } = setup();
  const state = () => buildState(ctx, cwd, "tide-tables");
  assert.deepEqual(state().map((s) => s.state), ["none", "none", "none"]);

  const r = await call("design_built", { frame: "Phone / Today", file: "src/screens/Today.tsx" }, { ...ctx, threadId: "t", sidekick: false });
  assert.match((r.content[0] as { text: string }).text, /^recorded: Phone \/ Today is built as src\/screens\/Today\.tsx/);
  const built = designOf(cwd, "tide-tables")!.frames[0].built!;
  assert.deepEqual([built.file, built.turn, built.frameHash.length], ["src/screens/Today.tsx", 4, 32]);
  assert.ok(existsSync(builtCopy(home, cwd, "tide-tables", "phone-today")), "the frame of that moment is kept");
  assert.deepEqual(events.at(-1), { ...(events.at(-1) as object), type: "canvas.changed", file: "tide-tables", frame: "phone-today", by: "agent", threadId: "t" });
  assert.deepEqual(state()[0], { frame: "phone-today", state: "step", file: "src/screens/Today.tsx" });
  // The link is in the canvas's own index: the canvas's next save (a frame moved) keeps it.
  assert.equal(saveFile(ctx, cwd, "tide-tables", { frames: [{ id: "phone-today", x: 40 }] }).frames[0].built?.file, "src/screens/Today.tsx");
  assert.deepEqual([designOf(cwd, "tide-tables")!.frames[0].x, designOf(cwd, "tide-tables")!.frames[0].built?.frameHash], [40, built.frameHash]);

  // Stamping ids alone isn't a change.
  writeFileSync(frame, today().replace('<h2 data-l="n2">', '<h2 data-l="n2"><b data-l="nb" hidden></b>').replace(/<b data-l="nb" hidden><\/b>/, ""));
  assert.equal(frameHash(today()), frameHash(today().replace(/ data-l="[^"]*"/g, "")));
  assert.equal(state()[0].state, "step");

  writeFileSync(frame, today("16px", "Next high tide").replace("</section>", '<p data-l="n4">Springs on Wednesday</p></section>'));
  const ahead = state()[0];
  assert.equal(ahead.state, "design-ahead");
  assert.deepEqual(ahead.changed!.split("\n"), ["Next tide: gap 12 to 16", "“Next high water”: text “Next high water” to “Next high tide”", "Added “Springs on Wednesday” in Next tide"]);

  writeFileSync(join(cwd, "src/screens/Today.tsx"), "export const Today = () => <main className='x' />;\n");
  const both = state()[0];
  assert.deepEqual([both.state, both.both, both.changed!.split("\n").at(-1)], ["design-ahead", true, "src/screens/Today.tsx changed too."]);

  writeFileSync(frame, today());
  assert.deepEqual(state()[0], { frame: "phone-today", state: "code-ahead", file: "src/screens/Today.tsx", changed: "src/screens/Today.tsx changed since it was built." });
});

test("build links: the RPC ties and lets go as the person does; bad files, live frames and read-only sessions are refused", async () => {
  const { home, cwd, ctx, store } = setup();
  const h = rpc(() => ctx);
  const linked = await h["build.link"]({ cwd, file: "tide-tables", frame: "phone-week", path: "src/screens/Today.tsx" });
  assert.deepEqual(linked.map((s) => s.state), ["none", "step", "none"]);
  assert.deepEqual((await h["build.unlink"]({ cwd, file: "tide-tables", frame: "phone-week" })).map((s) => s.state), ["none", "none", "none"]);
  assert.equal(existsSync(builtCopy(home, cwd, "tide-tables", "phone-week")), false);
  assert.throws(() => h["build.link"]({ cwd, file: "tide-tables", frame: "phone-week", path: "../outside.tsx" }), /inside this folder/);
  assert.throws(() => h["build.link"]({ cwd, file: "tide-tables", frame: "phone-week", path: "src/missing.tsx" }), /write it first/);
  assert.throws(() => h["build.link"]({ cwd, file: "tide-tables", frame: "Live", path: "src/screens/Today.tsx" }), /live frame/);
  assert.throws(() => h["build.link"]({ cwd, file: "tide-tables", frame: "nope", path: "src/screens/Today.tsx" }), /no frame “nope”/);
  assert.throws(() => h["build.state"]({ cwd: "/somewhere/else", file: "tide-tables" }), /isn't one of your projects/);
  store.putThread({ ...store.thread("t"), access: "read" });
  await assert.rejects(call("design_built", { frame: "phone-today", file: "src/screens/Today.tsx" }, { ...ctx, readOnly: () => true, threadId: "t", sidekick: false }), /is at Read only now/);
  assert.equal(JSON.parse(readFileSync(join(cwd, ".liner/designs/tide-tables/design.json"), "utf8")).frames[0].built, undefined);
});

test("what changed: by data-l, in plain words, at most ten lines; scripts aren't elements", () => {
  const els = elementsOf(today());
  assert.deepEqual([...els.keys()], ["b0", "m1", "n1", "n2", "n3"], "the data-l inside a script is text, not an element");
  assert.deepEqual(diffFrames(today(), today()), []);
  const before = `<div data-l="a">${Array.from({ length: 14 }, (_, i) => `<p data-l="p${i}" style="padding:4px">Row ${i}</p>`).join("")}</div>`;
  const after = before.replace(/padding:4px/g, "padding:8px");
  const lines = diffFrames(before, after);
  assert.equal(lines.length, 10);
  assert.equal(lines[0], "“Row 0”: padding 4 to 8");
  assert.equal(lines.at(-1), "and 5 more changes");
  assert.deepEqual(diffFrames(before, before.replace(/<p data-l="p3"[^>]*>Row 3<\/p>/, "")), ["Removed “Row 3”"]);
  assert.deepEqual(diffFrames("<p>no ids at all</p>", "<p data-l='x'>now ids</p>"), [], "a copy with no ids can't be compared: the state says so in a general sentence instead");
});

test("build links: a frame marked screen: false (a brand board) survives a save and a reload, and isn't counted as unbuilt", async () => {
  const { cwd, ctx } = setup();
  saveFile(ctx, cwd, "tide-tables", { frames: [{ id: "phone-week", screen: false }] });
  saveFile(ctx, cwd, "tide-tables", { frames: [{ id: "phone-week", x: 600 }] });
  assert.equal(designOf(cwd, "tide-tables")!.frames[1].screen, false, "kept on disk through a later save");
  assert.deepEqual(buildState(ctx, cwd, "tide-tables")[1], { frame: "phone-week", state: "none", screen: false });
  const unbuilt = buildState(ctx, cwd, "tide-tables").filter((s) => s.state === "none" && s.screen !== false && s.frame !== "app");
  assert.deepEqual(unbuilt.map((s) => s.frame), ["phone-today"], "the board isn't among what's waiting for code");
  assert.equal(saveFile(ctx, cwd, "tide-tables", { frames: [{ id: "phone-week", screen: true }] }).frames[1].screen, undefined, "and it can be a screen again");
});

test("what changed: an attribute a fix sets (aria-label) is said by name", () => {
  assert.deepEqual(diffFrames('<input data-l="f1" class="find">', '<input data-l="f1" class="find" aria-label="Find a station">'), ["“.find”: aria-label set to “Find a station”".replace("“.find”", ".find")]);
});

test("what changed: a class added through the Code tab (an html op with no ids) is named, and nothing else", async () => {
  const { cwd, ctx, frame } = setup();
  await call("design_built", { frame: "Phone / Today", file: "src/screens/Today.tsx" }, { ...ctx, threadId: "t", sidekick: false });
  const { applyFrame } = await import("../src/canvas.ts");
  applyFrame(ctx, cwd, "tide-tables", "phone-today", [{ id: "n1", html: `<section data-name="Next tide" class="tight" style="display:flex; gap:12px">\n    <h2>Next high water</h2>\n    <img src="../assets/a.png">\n  </section>` }], { by: "you" });
  assert.match(readFileSync(frame, "utf8"), /<h2 data-l="n2">Next high water<\/h2>\s*<img data-l="n3"/);
  const s = buildState(ctx, cwd, "tide-tables")[0];
  assert.equal(s.state, "design-ahead");
  assert.deepEqual(s.changed!.split("\n"), ["Next tide: class “” to “tight”"]);
});

test("build links: a frame whose file is gone isn't ahead and says nothing changed", () => {
  const { cwd, ctx, frame } = setup();
  return call("design_built", { frame: "Phone / Today", file: "src/screens/Today.tsx" }, { ...ctx, threadId: "t", sidekick: false }).then(async () => {
    const { rmSync } = await import("node:fs");
    rmSync(frame);
    const s = buildState(ctx, cwd, "tide-tables")[0];
    assert.deepEqual(s, { frame: "phone-today", state: "step", file: "src/screens/Today.tsx", missing: true });
    writeFileSync(frame, today());
    assert.deepEqual(buildState(ctx, cwd, "tide-tables")[0].state, "step");
  });
});
