/*
  canvas.open with `peek`: the Code face's small view of a design reads a file without making it
  "the one the person has open", which a design tool that names no file draws on (designFor).
  Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineEvent } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import * as canvas from "../src/canvas.ts";
import { designCtx, designFor } from "../src/canvas.ts";
import { Store } from "../src/store.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup() {
  const root = mkdtempSync(join(tmpdir(), "lc-peek-"));
  const home = mkdtempSync(join(tmpdir(), "lc-peek-home-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: root, git: false, createdAt: 1 });
  store.putThread({ id: "t", projectId: "p", title: "Peek", agent: "forge", status: "idle", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  const ctx = designCtx(store, { whoIs: () => "Opus" });
  return { root, home, ctx, api: canvas.rpc(() => ctx), dir: ctx.folder(root) };
}

test("canvas.open with peek reads the file but leaves the one a tool means as it was; a plain open still moves it", async () => {
  const { root, ctx, api, dir } = setup();
  const a = await api["canvas.create"]({ cwd: root, title: "First" });
  const b = await api["canvas.create"]({ cwd: root, title: "Second" });
  // The last made is the one a tool that names none draws on.
  assert.equal(designFor(ctx, dir, "", false), b.id);
  const peeked = await api["canvas.open"]({ cwd: root, file: a.id, peek: true });
  assert.equal(peeked.file.id, a.id, "the peek reads the file asked for");
  assert.equal(typeof peeked.base, "string");
  assert.equal(designFor(ctx, dir, "", false), b.id, "a peek doesn't steer the agent");
  await api["canvas.open"]({ cwd: root, file: a.id });
  assert.equal(designFor(ctx, dir, "", false), a.id, "a plain open does");
  await api["canvas.open"]({ cwd: root, file: b.id, peek: true });
  assert.equal(designFor(ctx, dir, "", false), a.id, "and a later peek leaves it there");
});

/** Every file under a folder: its bytes and its mtime, by path. */
function snapshot(dir: string) {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out[p.slice(dir.length)] = `${st.mtimeMs}:${createHash("sha1").update(readFileSync(p)).digest("hex")}`;
    }
  };
  walk(dir);
  return out;
}

test("peek open and peek frame reads write nothing (no ids, no adopted frame, no heard revision); a normal read afterwards still stamps and announces", async () => {
  const { root, ctx, api, dir } = setup();
  const events: EngineEvent[] = [];
  ctx.store.on((e) => events.push(e));
  const d = await api["canvas.create"]({ cwd: root, title: "Look", size: "phone" });
  const designDir = join(dir, ".liner", "designs", d.id);
  const framesDir = join(designDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  // An agent's own write: a listed frame's file with no ids, and a loose frame file design.json doesn't list.
  const listed = d.frames.find((f) => f.kind === "drawn")!;
  const bare = "<!doctype html>\n<html><head><title>x</title></head><body><main><h1>Tide</h1><p>14:32</p></main></body></html>\n";
  writeFileSync(join(designDir, listed.path ?? `frames/${listed.id}.html`), bare);
  writeFileSync(join(framesDir, "loose.html"), bare.replace("Tide", "Loose"));
  const before = snapshot(designDir);
  const opened = await api["canvas.open"]({ cwd: root, file: d.id, peek: true });
  assert.ok(opened.file.frames.some((f) => f.id === "loose"), "the loose frame shows, adopted in memory only");
  for (const f of opened.file.frames) {
    const r = await api["canvas.frame.read"]({ cwd: root, file: d.id, frame: f.id, peek: true });
    assert.match(r.html, /data-l="/, "the page handed back carries ids");
  }
  assert.deepEqual(snapshot(designDir), before, "every file under the design, byte for byte and by mtime, as it was");
  assert.equal(events.filter((e) => e.type === "canvas.changed").length, 0);
  // Nothing was marked as heard: the agent's write is still announced when the next write lands over it.
  const r = await api["canvas.frame.read"]({ cwd: root, file: d.id, frame: listed.id });
  assert.match(readFileSync(join(designDir, listed.path ?? `frames/${listed.id}.html`), "utf8"), /data-l="/, "a normal read still writes the ids in");
  assert.ok(r.rev);
  const events2: EngineEvent[] = [];
  const { root: root2, ctx: ctx2, api: api2, dir: dir2 } = setup();
  ctx2.store.on((e) => events2.push(e));
  const d2 = await api2["canvas.create"]({ cwd: root2, title: "Heard", size: "phone" });
  const f2 = d2.frames.find((f) => f.kind === "drawn")!;
  const abs2 = join(dir2, ".liner", "designs", d2.id, f2.path ?? `frames/${f2.id}.html`);
  writeFileSync(abs2, bare);
  await api2["canvas.open"]({ cwd: root2, file: d2.id, peek: true });
  await api2["canvas.frame.read"]({ cwd: root2, file: d2.id, frame: f2.id, peek: true });
  await api2["canvas.frame.write"]({ cwd: root2, file: d2.id, frame: f2.id, html: bare.replace("14:32", "15:10") });
  assert.ok(events2.some((e) => e.type === "canvas.changed" && e.by === "agent" && e.frame === f2.id), "the agent's change is announced: the peek didn't mark it as heard");
});

const page = (h1: string) => `<!doctype html>\n<html><head><title>x</title></head><body><main><h1>${h1}</h1></main></body></html>\n`;
const listed = (designDir: string) => {
  try {
    return (JSON.parse(readFileSync(join(designDir, "design.json"), "utf8")) as { frames: { id: string }[] }).frames.map((f) => f.id);
  } catch {
    return null;
  }
};

test("a watch that only looks writes nothing and still announces; a plain watch on the same folder adopts as before; either can go off first", async () => {
  const { root, ctx, api, dir } = setup();
  const events: EngineEvent[] = [];
  ctx.store.on((e) => events.push(e));
  const d = await api["canvas.create"]({ cwd: root, title: "Watched", size: "phone" });
  const designs = join(dir, ".liner", "designs");
  const dd = join(designs, d.id);
  // A folder with frames and no design.json: a plain watch would make one at once.
  const bareDir = join(designs, "bare");
  mkdirSync(join(bareDir, "frames"), { recursive: true });
  writeFileSync(join(bareDir, "frames", "a.html"), page("A"));
  const before = snapshot(designs);
  await api["canvas.watch"]({ cwd: root, file: d.id, on: true, peek: true });
  await api["canvas.watch"]({ cwd: root, file: "bare", on: true, peek: true });
  await wait(400);
  assert.deepEqual(snapshot(designs), before, "starting the looking watches wrote nothing");
  // An agent writes a new loose frame file.
  writeFileSync(join(dd, "frames", "loose.html"), page("Loose"));
  const withLoose = snapshot(designs);
  await wait(900);
  assert.deepEqual(snapshot(designs), withLoose, "nothing adopted it into design.json or stamped it");
  assert.ok(events.some((e) => e.type === "canvas.changed" && e.file === d.id && e.frame === "loose"), "its change is still announced");
  assert.equal(listed(join(bareDir)), null, "the bare folder still has no design.json");
  // A plain watch joins: what the looking watch left loose is adopted, as a plain start would.
  await api["canvas.watch"]({ cwd: root, file: d.id, on: true });
  await api["canvas.watch"]({ cwd: root, file: "bare", on: true });
  assert.ok(listed(dd)?.includes("loose"), "the loose frame is adopted once a plain watch is on");
  assert.deepEqual(listed(bareDir), ["a"], "the bare folder gets its design.json, as on a plain start");
  // The looking watch goes off first: the plain one keeps adopting.
  await api["canvas.watch"]({ cwd: root, file: d.id, on: false, peek: true });
  writeFileSync(join(dd, "frames", "second.html"), page("Second"));
  await wait(900);
  assert.ok(listed(dd)?.includes("second"), "the plain watch still adopts after the looking one went");
  // The reverse: the plain one goes off while a looking one is on, and adopting stops.
  await api["canvas.watch"]({ cwd: root, file: d.id, on: true, peek: true });
  await api["canvas.watch"]({ cwd: root, file: d.id, on: false });
  const n = events.length;
  writeFileSync(join(dd, "frames", "third.html"), page("Third"));
  await wait(900);
  assert.ok(!listed(dd)?.includes("third"), "with only the looking watch left, nothing is adopted");
  assert.ok(events.slice(n).some((e) => e.type === "canvas.changed" && e.frame === "third"), "and its change is still announced");
  await api["canvas.watch"]({ cwd: root, file: d.id, on: false, peek: true });
  await api["canvas.watch"]({ cwd: root, file: "bare", on: false, peek: true });
  await api["canvas.watch"]({ cwd: root, file: "bare", on: false });
});

test("canvas.list with peek writes nothing (no adoption, no design.json made, no copy of a broken one); a plain list still does", async () => {
  const { root, home, api, dir } = setup();
  const d = await api["canvas.create"]({ cwd: root, title: "Listed", size: "phone" });
  const designs = join(dir, ".liner", "designs");
  writeFileSync(join(designs, d.id, "frames", "loose.html"), page("Loose"));
  mkdirSync(join(designs, "bare", "frames"), { recursive: true });
  writeFileSync(join(designs, "bare", "frames", "a.html"), page("A"));
  mkdirSync(join(designs, "broken"), { recursive: true });
  writeFileSync(join(designs, "broken", "design.json"), "{ not json");
  const before = snapshot(designs);
  const homeBefore = snapshot(home);
  const l = await api["canvas.list"]({ cwd: root, peek: true });
  assert.deepEqual(snapshot(designs), before, "every file in the folder as it was");
  assert.deepEqual(snapshot(home), homeBefore, "no copy of the broken one kept under the home");
  assert.equal(l.find((x) => x.id === d.id)?.frames, 2, "the loose frame is counted, adopted in memory only");
  assert.ok(l.find((x) => x.id === "bare"), "the folder with no design.json is listed");
  assert.ok(l.find((x) => x.id === "broken")?.unreadable, "the broken one is listed as unreadable");
  await api["canvas.list"]({ cwd: root });
  assert.ok(listed(join(designs, d.id))?.includes("loose"), "a plain list still adopts");
  assert.deepEqual(listed(join(designs, "bare")), ["a"], "and still makes design.json");
});

test("a peek open refuses a design.json that is a link, as a plain open does; a broken one is said to be broken", async () => {
  const { root, api, dir } = setup();
  const d = await api["canvas.create"]({ cwd: root, title: "Linked", size: "phone" });
  const dd = join(dir, ".liner", "designs", d.id);
  const outside = join(mkdtempSync(join(tmpdir(), "lc-peek-out-")), "design.json");
  writeFileSync(outside, readFileSync(join(dd, "design.json")));
  rmSync(join(dd, "design.json"));
  symlinkSync(outside, join(dd, "design.json"));
  // A handler may answer at once (throwing rather than rejecting): each is asked through an async step.
  const said = (f: () => unknown) => (async () => f())().then(() => "done", (e: Error) => e.message);
  const plain = await said(() => api["canvas.open"]({ cwd: root, file: d.id }));
  const peek = await said(() => api["canvas.open"]({ cwd: root, file: d.id, peek: true }));
  assert.match(plain, /is a link/);
  assert.equal(peek, plain, "the same refusal");
  const frame = await said(() => api["canvas.frame.read"]({ cwd: root, file: d.id, frame: d.frames[0].id, peek: true }));
  assert.match(frame, /is a link/);
  rmSync(join(dd, "design.json"));
  writeFileSync(join(dd, "design.json"), "{ not json");
  const broken = await said(() => api["canvas.open"]({ cwd: root, file: d.id, peek: true }));
  assert.match(broken, /^unreadable:/);
  const brokenFrame = await said(() => api["canvas.frame.read"]({ cwd: root, file: d.id, frame: d.frames[0].id, peek: true }));
  assert.match(brokenFrame, /^unreadable:/, "a frame read of a broken file says so, not that there's no design file");
});
