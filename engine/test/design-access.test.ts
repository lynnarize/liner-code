/*
  Liner Design's tools and the access level (R's M2). Every provider's call to Liner's tools comes to
  the engine the same way (mcp.ts, then AgentTools, then the design module), so the rule is held
  here, once: the tools that only read go free; those that write (design_frame, design_node with
  html, design_built, design_picture) are refused in a session that only reads (Read only, which is
  Claude Code's plan mode and Codex's read-only sandbox, and a side chat). At "ask" and above they
  go without a card, as they only write inside .liner/designs/ on a canvas the person watches, with a
  copy kept each turn; design_picture keeps its own card. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Access } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import * as buildlinks from "../src/buildlinks.ts";
import * as canvas from "../src/canvas.ts";
import { createFile, designCtx } from "../src/canvas.ts";
import * as pictures from "../src/pictures.ts";
import { Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "lc-access-"));
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-access-home-")));
  store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
  const base = { projectId: "p", title: "Access", agent: "forge", status: "running" as const, turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 };
  for (const a of ["read", "ask", "edits"] as Access[]) store.putThread({ id: a, access: a, ...base });
  store.putThread({ id: "side", access: "edits", sideOf: "edits", ...base });
  store.setSettings({ pictures: [{ id: "img", label: "Fake", url: "http://127.0.0.1:9/v1", model: "m" }] });
  const runtime = new Runtime(store, { PATH: "/usr/bin:/bin" });
  const asks: string[] = [];
  // The readOnly main.ts hands the modules: the runtime's own.
  const ctx = designCtx(store, { readOnly: (id) => runtime.readOnly(id), ask: (_id, a) => (asks.push(a.title), { id: "x", answer: Promise.resolve({ allow: false }) }) });
  createFile(ctx, cwd, "Tides", "phone", "tides");
  writeFileSync(join(cwd, ".liner/designs/tides/frames/phone.html"), '<!doctype html><html><body data-l="b1"><p data-l="p1">Low water</p></body></html>');
  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(cwd, "src/Today.tsx"), "export {};\n");
  return { cwd, ctx, asks, at: (threadId: string) => ({ ...ctx, threadId, sidekick: false }) };
}

const WRITES: [string, typeof canvas.call, Record<string, unknown>][] = [
  ["design_frame", canvas.call, { name: "Phone", width: 390, height: 844, html: "<p>x</p>", design: "tides" }],
  ["design_node", canvas.call, { frame: "phone", id: "p1", html: "<p>High water</p>", design: "tides" }],
  ["design_built", buildlinks.call, { frame: "phone", file: "src/Today.tsx", design: "tides" }],
  ["design_picture", pictures.call, { prompt: "Sand", width: 100, height: 100, design: "tides" }],
];

test("M2: Liner Design's writing tools are refused in a session that only reads (Read only, a side chat), in one sentence, and change nothing", async () => {
  const { cwd, at } = setup();
  const before = readFileSync(join(cwd, ".liner/designs/tides/frames/phone.html"), "utf8");
  for (const who of ["read", "side"])
    for (const [name, call, args] of WRITES) await assert.rejects(call(name, args, at(who)), /This session is at Read only now \(or it.s a side chat\)/, `${name} in ${who}`);
  assert.equal(readFileSync(join(cwd, ".liner/designs/tides/frames/phone.html"), "utf8"), before);
  assert.equal(JSON.parse(readFileSync(join(cwd, ".liner/designs/tides/design.json"), "utf8")).frames[0].built, undefined);
});

test("M2: the reading tools stay free in a session that only reads", async () => {
  const { at } = setup();
  for (const [name, args] of [["design_files", {}], ["design_tree", { frame: "phone", design: "tides" }], ["design_node", { frame: "phone", id: "p1", design: "tides" }], ["design_selection", {}]] as const) {
    const r = await canvas.call(name, args, at("read"));
    assert.notEqual(r.isError, true, name);
  }
});

test("M2: at ask before edits, the canvas's writes go without a card; design_picture keeps its own", async () => {
  const { cwd, at, asks } = setup();
  await canvas.call("design_node", { frame: "phone", id: "p1", html: "<p>High water</p>", design: "tides" }, at("ask"));
  assert.match(readFileSync(join(cwd, ".liner/designs/tides/frames/phone.html"), "utf8"), /High water/);
  await buildlinks.call("design_built", { frame: "phone", file: "src/Today.tsx", design: "tides" }, at("ask"));
  assert.deepEqual(asks, []);
  await pictures.call("design_picture", { prompt: "Sand", width: 100, height: 100, design: "tides" }, at("ask"));
  assert.deepEqual(asks, ["Make a picture"], "the picture asks on its card (and the no here spends nothing)");
});

test("P1: design_shot's result says what the frame holds in words too, for a model that gets no picture", async () => {
  const { ctx } = setup();
  const at = { ...ctx, threadId: "edits", sidekick: false, filesUrl: async () => "http://127.0.0.1:1", shot: async () => ({ png: "AAAA", height: 844 }) };
  const r = await canvas.call("design_shot", { frame: "phone", design: "tides" }, at);
  const words = r.content.find((c) => c.type === "text") as { text: string };
  assert.match(words.text, /If the picture doesn't reach you, this is what the frame holds/);
  assert.match(words.text, /<p> p1 · text · “Low water”/);
  assert.ok(r.content.some((c) => c.type === "image"), "the picture still goes to a model that takes it");
});
