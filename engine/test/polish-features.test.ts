/*
  The design and security polish round (docs/audit-2026-11-18/engine-design-security.md): stamping a page is linear and its
  bytes are what they were, a look at a frame stamps it once, only sessions that draw keep version copies (the newest 20
  turns each) and a fork links them, Security writes once per batch of findings, the canvas tools read each file once per
  call, and the smaller fixes beside them. Everything on temp folders, with fakes for every tool. Run with `npm test -w engine`.
*/
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs, { mkdirSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineEvent, Item, NewFinding, SecurityFinding, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import * as canvas from "../src/canvas.ts";
import { designCtx, type DesignCall } from "../src/canvas.ts";
import { stamp, stampGuard } from "../src/canvas-html.ts";
import * as lean from "../src/lean.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { Provider } from "../src/providers/types.ts";
import { Security, stateAt } from "../src/security.ts";
import { startScan, wake } from "../src/security-scan.ts";
import { Store } from "../src/store.ts";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const opened: { stop(): void }[] = [];
after(() => {
  for (const o of opened) o.stop();
});
const thread = (id: string, o: Partial<Thread> = {}): Thread => ({ id, projectId: "p", title: "Canvas", agent: "@claude:claude-opus-5-5", status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1, ...o });
const turn = (n: number, status: "running" | "done"): Item => ({ kind: "turn", id: `turn${n}`, turn: n, at: Date.now(), agent: "forge", model: "demo:x", status });

function design() {
  const root = tmp("lc-pf-root-");
  const home = tmp("lc-pf-home-");
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: root, git: false, createdAt: 1 });
  // As main.ts hands it (runtime.readOnly): Read only, or a side chat.
  const ctx = designCtx(store, { readOnly: (id) => store.thread(id).access === "read" || Boolean(store.thread(id).sideOf) });
  const api = canvas.rpc(() => ctx);
  canvas.attach(ctx);
  // A turn's copies are taken off the engine's loop: wait for them as the engine would before a restore.
  const step = async (id: string, it: Item) => (store.putItem(id, it), await canvas.canvasIdle(ctx));
  return { root, home, store, ctx, api, step };
}

/** A page of n elements with no ids yet, as an agent writes one with its own tools. */
const bigPage = (n: number) => `<!doctype html><html><head><title>x</title></head><body>${Array.from({ length: n }, (_, i) => `<div class="card c${i}"><p>Item ${i} with some text</p><img src=a.png alt=x><span data-l>${i}</span><i data-l='bad id'>y</i><b data-l=dup>z</b></div>`).join("\n")}</body></html>`;

// C1 (#1): stamp and splice build the page once.

test("C1: stamping a large page is linear and its bytes are the old splice's, byte for byte", () => {
  const html = bigPage(3000);
  const t0 = performance.now();
  const s = stamp(html);
  const ms = performance.now() - t0;
  assert.ok(s.ok, "the guard takes every id back out to the very same page");
  assert.ok(ms < 1500, `3000 cards (15000 elements) stamp in well under the seconds the old way took: ${Math.round(ms)} ms`);
  assert.equal(stamp(s.html).added, 0, "stamping twice is stamping once");
  // The page from 220cc0e's canvas-html.ts (the quadratic splice), where git has it: the same ids in the same bytes.
  let old: string | undefined;
  try {
    old = execFileSync("git", ["show", "220cc0e:engine/src/canvas-html.ts"], { cwd: join(import.meta.dirname, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    // a checkout without that commit: the property checks above and below still hold
  }
  if (old) {
    const file = join(tmp("lc-pf-old-"), "canvas-html.ts");
    writeFileSync(file, old);
    return import(file).then((m: { stamp: typeof stamp }) => {
      const page = bigPage(400);
      assert.equal(stamp(page).html, m.stamp(page).html, "new and old stamp give the same page");
      assert.equal(stamp(html).added, m.stamp(html).added);
    });
  }
});

test("C1: a look at a frame (the mini view, a kept version) stamps the same unchanged page once", async () => {
  const { root, ctx } = design();
  canvas.createFile(ctx, root, "Look", undefined, "look");
  canvas.addFrame(ctx, root, "look", { name: "A", w: 400, h: 400 });
  // Written by an agent's own tools: no ids, so a look stamps it in memory, and writes nothing.
  writeFileSync(join(root, ".liner/designs/look/frames/a.html"), bigPage(50));
  const guard = stampGuard.undoes;
  let stamped = 0;
  stampGuard.undoes = (...a: Parameters<typeof guard>) => (stamped++, guard(...a));
  try {
    const one = canvas.peekFrame(root, "look", "a");
    const two = canvas.peekFrame(root, "look", "a");
    assert.equal(one.html, two.html);
    assert.equal(stamped, 1, "the second look is the first one's page");
    writeFileSync(join(root, ".liner/designs/look/frames/a.html"), bigPage(51));
    canvas.peekFrame(root, "look", "a");
    assert.equal(stamped, 2, "a changed page is stamped again");
  } finally {
    stampGuard.undoes = guard;
  }
  assert.ok(!readFileSync(join(root, ".liner/designs/look/frames/a.html"), "utf8").includes('data-l="'), "a look writes no ids");
});

// C2 (#2): only sessions that draw take copies; each keeps its newest 20 turns; a fork links them.

test("C2: a session that doesn't draw, in a folder with designs, takes no copy; one that starts drawing takes its own", async () => {
  const { root, home, store, ctx, step } = design();
  canvas.createFile(ctx, root, "Tides", "phone", "tides");
  store.putThread(thread("code"));
  await step("code", turn(1, "running"));
  await step("code", turn(1, "done"));
  await step("code", turn(2, "running"));
  await step("code", turn(2, "done"));
  assert.deepEqual(canvas.versions(ctx, "code", "tides"), []);
  assert.ok(!existsSync(join(home, "designs", "code")), "nothing under its designs folder at all");
  // A side chat (it only reads) takes none even while the design changes under it.
  store.putThread(thread("side", { access: "read", sideOf: "code" }));
  await step("side", turn(1, "running"));
  writeFileSync(join(root, ".liner/designs/tides/frames/phone.html"), "<html><body><p>by someone else</p></body></html>");
  await step("side", turn(1, "done"));
  assert.deepEqual(canvas.versions(ctx, "side", "tides"), []);
  // The Code session draws with a design tool in its third turn: as it was first, then the turn that drew.
  await step("code", turn(3, "running"));
  const at: DesignCall = { ...ctx, threadId: "code", sidekick: false };
  await canvas.call("design_frame", { design: "tides", name: "Phone", width: 390, height: 844, html: "<html><body><p>drawn</p></body></html>" }, at);
  await step("code", turn(3, "done"));
  assert.deepEqual(canvas.versions(ctx, "code", "tides").map((v) => v.key), ["t2", "t3"]);
  assert.match(canvas.versionRead(ctx, "code", "tides", 2).html.phone, /by someone else/, "the copy as it was before it drew");
  assert.match(canvas.versionRead(ctx, "code", "tides", 3).html.phone, /drawn/);
  // A plain session whose turn sees a design change it didn't make (another session drawing) keeps that state, and the one
  // before it: when in doubt, a copy.
  store.putThread(thread("other"));
  await step("other", turn(1, "running"));
  writeFileSync(join(root, ".liner/designs/tides/frames/phone.html"), "<html><body><p>changed meanwhile</p></body></html>");
  await step("other", turn(1, "done"));
  assert.deepEqual(canvas.versions(ctx, "other", "tides").map((v) => v.key), ["t0", "t1"]);
  assert.match(canvas.versionRead(ctx, "other", "tides", 0).html.phone, /drawn/);
});

// A real CLI writes as soon as it sends its tool call: nothing below waits for the canvas between a turn's start and its end,
// only for what a turn's prompt waits for (turnReady, runtime.beforeTurn). Each runs on a disk that clones (the copy is taken
// on the turn's event) and on one that can't (taken off the loop, the prompt waiting for it).

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A disk that can't clone, its copies `ms` slower than they are. */
function noClone(ms = 0) {
  const real = { ...canvas.designCopy };
  canvas.designCopy.clones = () => false;
  canvas.designCopy.slow = async (from, to, earlier) => (await delay(ms), real.slow(from, to, earlier));
  return () => Object.assign(canvas.designCopy, real);
}
/** A turn begins as runtime.ts begins one: its marker, then its prompt once the copies are taken. */
const begin = async (store: Store, ctx: ReturnType<typeof designCtx>, id: string, n: number) => (store.putItem(id, turn(n, "running")), await canvas.turnReady(ctx, id, n));

for (const slow of [false, true]) {
  const disk = slow ? "a disk that can't clone" : "a disk that clones";

  test(`C2 (${disk}): a Code session's own Write, its tool row arriving after the file already changed, can still be taken back to before the turn`, async () => {
    const back = slow ? noClone(20) : () => {};
    try {
      const { root, store, ctx } = design();
      canvas.createFile(ctx, root, "Tides", "phone", "tides");
      store.putThread(thread("code"));
      const frame = join(root, ".liner/designs/tides/frames/phone.html");
      const before = readFileSync(frame, "utf8");
      await begin(store, ctx, "code", 1);
      writeFileSync(frame, before.replace("</body>", "<p>mine</p></body>"));
      store.putItem("code", { kind: "tool", id: "e1", turn: 1, at: Date.now(), toolKind: "write", title: "Write phone.html", path: frame, status: "running" } as Item);
      store.putItem("code", { kind: "tool", id: "e1", turn: 1, at: Date.now(), toolKind: "write", title: "Write phone.html", path: frame, status: "done" } as Item);
      store.putItem("code", turn(1, "done"));
      await canvas.canvasIdle(ctx);
      assert.deepEqual(canvas.versions(ctx, "code", "tides").map((v) => v.key), ["t0", "t1"]);
      assert.equal(canvas.versionRead(ctx, "code", "tides", 0).html.phone.includes("mine"), false, "turn 0 is the design as the turn found it");
      assert.match(canvas.versionRead(ctx, "code", "tides", 1).html.phone, /mine/);
      canvas.restore(ctx, "code", "tides", 0);
      assert.equal(readFileSync(frame, "utf8").includes("mine"), false, "and it comes back");
    } finally {
      back();
    }
  });

  test(`C2 (${disk}): a tool that sends no tool row at all (the file just changes in the turn) still leaves the design as it was, with pictures`, async () => {
    const back = slow ? noClone(20) : () => {};
    try {
      const { root, home, store, ctx } = design();
      canvas.createFile(ctx, root, "Tides", "phone", "tides");
      const pic = join(root, ".liner/designs/tides/assets/sea.png");
      mkdirSync(join(root, ".liner/designs/tides/assets"), { recursive: true });
      writeFileSync(pic, Buffer.from("picture one"));
      store.putThread(thread("code"));
      const frame = join(root, ".liner/designs/tides/frames/phone.html");
      await begin(store, ctx, "code", 4);
      writeFileSync(frame, "<html><body><p>by a tool with no rows</p></body></html>");
      // A picture written in place, into the very file the copy was made from: the copy is its own (a clone or a copy, never a link to it).
      fs.writeFileSync(pic, Buffer.from("picture two"), { flag: "r+" });
      store.putItem("code", turn(4, "done"));
      await canvas.canvasIdle(ctx);
      assert.deepEqual(canvas.versions(ctx, "code", "tides").map((v) => v.key), ["t3", "t4"]);
      assert.equal(canvas.versionRead(ctx, "code", "tides", 3).html.phone.includes("no rows"), false);
      assert.equal(readFileSync(join(home, "designs/code/canvas/tides/t3/assets/sea.png"), "utf8"), "picture one", "the picture as it was");
      assert.notEqual(statSync(join(home, "designs/code/canvas/tides/t3/assets/sea.png")).ino, statSync(pic).ino);
      assert.ok(!readdirSync(join(home, "designs/code/canvas/tides")).some((n) => n.startsWith("p")), "no provisional copy left behind");
    } finally {
      back();
    }
  });

  test(`C2 (${disk}): a session that touches no design keeps no provisional copy past its turn, and one with a kept copy as it is takes none`, async () => {
    const back = slow ? noClone(20) : () => {};
    try {
      const { root, home, store, ctx } = design();
      canvas.createFile(ctx, root, "Tides", "phone", "tides");
      store.putThread(thread("code"));
      await begin(store, ctx, "code", 1);
      assert.ok(existsSync(join(home, "designs/code/canvas/tides/p0/design.json")), "while the turn runs, the design as it began is held");
      assert.deepEqual(canvas.versions(ctx, "code", "tides"), [], "but it isn't a kept copy");
      store.putItem("code", turn(1, "done"));
      await canvas.canvasIdle(ctx);
      assert.ok(!existsSync(join(home, "designs", "code")), "gone after the turn, and the folders it made");
      // A turn that changed the design keeps its copies; the next turn starts from a kept copy that holds the design as it is: none taken.
      await begin(store, ctx, "code", 2);
      writeFileSync(join(root, ".liner/designs/tides/frames/phone.html"), "<html><body><p>two</p></body></html>");
      store.putItem("code", turn(2, "done"));
      await canvas.canvasIdle(ctx);
      await begin(store, ctx, "code", 3);
      await canvas.canvasIdle(ctx);
      assert.deepEqual(readdirSync(join(home, "designs/code/canvas/tides")).sort(), ["t1", "t1.json", "t2", "t2.json"]);
      store.putItem("code", turn(3, "done"));
      await canvas.canvasIdle(ctx);
      assert.deepEqual(canvas.versions(ctx, "code", "tides").map((v) => v.key), ["t1", "t2"]);
    } finally {
      back();
    }
  });
}

test("C2 (a disk that can't clone): a picture an earlier copy already holds at the same size and time is linked from that copy, never from the design", async () => {
  const back = noClone();
  try {
    const { root, home, store, ctx } = design();
    canvas.createFile(ctx, root, "Tides", "phone", "tides");
    mkdirSync(join(root, ".liner/designs/tides/assets"), { recursive: true });
    const pic = join(root, ".liner/designs/tides/assets/sea.png");
    writeFileSync(pic, Buffer.alloc(200_000, 7));
    store.putThread(thread("a"));
    store.putThread(thread("b"));
    await begin(store, ctx, "a", 1);
    writeFileSync(join(root, ".liner/designs/tides/frames/phone.html"), "<p>a's</p>");
    store.putItem("a", turn(1, "done"));
    await canvas.canvasIdle(ctx);
    await begin(store, ctx, "b", 1);
    const kept = join(home, "designs/a/canvas/tides/t0/assets/sea.png");
    const mine = join(home, "designs/b/canvas/tides/p0/assets/sea.png");
    const theirs = ["t0", "t1"].map((k) => statSync(join(home, `designs/a/canvas/tides/${k}/assets/sea.png`)).ino);
    assert.ok(theirs.includes(statSync(mine).ino), "linked from one of a's kept copies: no bytes copied again");
    assert.notEqual(statSync(mine).ino, statSync(pic).ino, "and never to the design's own file");
    assert.notEqual(statSync(join(home, "designs/b/canvas/tides/p0/frames/phone.html")).ino, statSync(join(home, "designs/a/canvas/tides/t1/frames/phone.html")).ino, "frames are copied");
    store.putItem("b", turn(1, "done"));
    await canvas.canvasIdle(ctx);
    assert.equal(readFileSync(kept).length, 200_000, "a's copy is untouched by b's going");
  } finally {
    back();
  }
});

/** A Runtime on a design's folder with Claude Code faked, the canvas listening, its turns waiting for the copies as main.ts has them. */
function turning(work: (signal: AbortSignal) => Promise<void>) {
  const { root, home, store, ctx } = design();
  canvas.createFile(ctx, root, "Tides", "phone", "tides");
  mkdirSync(join(root, ".liner/designs/tides/assets"), { recursive: true });
  writeFileSync(join(root, ".liner/designs/tides/assets/sea.png"), Buffer.alloc(100_000, 3));
  const seen: { at: number; held: boolean }[] = [];
  const info = { id: "claude" as const, label: "claude", available: true, adapter: true, login: "", models: [{ id: "claude-opus-5-5", label: "x", description: "" }], supports: { approvals: true, resume: true, effort: true, plan: true } };
  const fakeClaude: Provider = {
    id: "claude",
    detect: async () => info,
    open: () => ({
      turn: async (_text, _sink, signal) => {
        seen.push({ at: Date.now(), held: existsSync(join(home, "designs/t/canvas/tides/p0/assets/sea.png")) && existsSync(join(home, "designs/t/canvas/tides/p0/design.json")) });
        await work(signal);
      },
      close() {},
    }),
  };
  const saved = providers.claude;
  providers.claude = fakeClaude;
  const runtime = new Runtime(store, { PATH: "/usr/bin:/bin", HOME: tmp("lc-pf-rh-") } as NodeJS.ProcessEnv);
  runtime.providerInfo = [info];
  runtime.beforeTurn = (id, n) => canvas.turnReady(ctx, id, n);
  store.putThread(thread("t", { agent: "forge", title: "New session" }));
  return { store, runtime, ctx, home, seen, restore: () => ((providers.claude = saved), runtime.shutdown()) };
}

test("C2 (a disk that can't clone): the copy is taken off the engine's loop, and the turn's prompt goes only once it's done", async () => {
  const back = noClone(300);
  const r = turning(async () => {});
  try {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    const sent = Date.now();
    await r.runtime.send("t", "draw the tides");
    for (let i = 0; i < 200 && !r.seen.length; i++) await delay(10);
    clearInterval(timer);
    assert.equal(r.seen.length, 1, "the tool got the prompt");
    assert.ok(r.seen[0].held, "with the design's copy whole by then");
    assert.ok(r.seen[0].at - sent >= 290, `and not before the copy was done (${r.seen[0].at - sent} ms)`);
    assert.ok(ticks >= 15, `the engine's loop ran on while the copy was taken (${ticks} ticks of 10 ms)`);
  } finally {
    back();
    r.restore();
  }
});

test("C2 (a disk that can't clone): Stop while a turn waits for its copy ends the turn, and the tool is never sent the prompt", async () => {
  const back = noClone(2000);
  const r = turning(async () => {});
  try {
    const going = r.runtime.send("t", "draw the tides");
    for (let i = 0; i < 100 && r.store.thread("t").status !== "running"; i++) await delay(5);
    await delay(50);
    r.runtime.stop("t");
    await going;
    for (let i = 0; i < 100 && r.store.thread("t").status === "running"; i++) await delay(10);
    assert.notEqual(r.store.thread("t").status, "running", "the turn ended");
    assert.equal(r.seen.length, 0, "and the tool heard nothing");
  } finally {
    back();
    r.restore();
  }
});

test("C2 (a disk that can't clone): a copy that fails doesn't fail the turn: it goes on without one, said once in the log", async () => {
  const real = { ...canvas.designCopy };
  canvas.designCopy.clones = () => false;
  canvas.designCopy.slow = async () => {
    throw new Error("disk full");
  };
  const r = turning(async () => {});
  const errs: string[] = [];
  const log = console.error;
  console.error = (...a: unknown[]) => void errs.push(a.map(String).join(" "));
  try {
    await r.runtime.send("t", "draw the tides");
    for (let i = 0; i < 200 && !r.seen.length; i++) await delay(10);
    assert.equal(r.seen.length, 1, "the tool got the prompt");
    assert.equal(errs.filter((e) => /couldn't be taken, so this turn goes on without one: disk full/.test(e)).length, 1);
  } finally {
    console.error = log;
    Object.assign(canvas.designCopy, real);
    r.restore();
  }
});

test("C2: a session keeps its newest 20 turn copies of a design; the 21st removes the oldest, and before copies keep their own rule", async () => {
  const { root, store, ctx, step } = design();
  canvas.createFile(ctx, root, "Tides", "phone", "tides");
  store.putThread(thread("d", { design: { file: "tides" } }));
  const frame = join(root, ".liner/designs/tides/frames/phone.html");
  for (let n = 1; n <= 19; n++) {
    await step("d", turn(n, "running"));
    writeFileSync(frame, `<html><body><p>turn ${n}</p></body></html>`);
    await step("d", turn(n, "done"));
  }
  const keys = () => canvas.versions(ctx, "d", "tides").filter((v) => v.kind === "turn").map((v) => v.key);
  assert.equal(keys().length, 20, "as it was (t0) and 19 turns");
  store.patchThread("d", { turns: 19 });
  canvas.restore(ctx, "d", "tides", 0);
  await step("d", turn(20, "running"));
  writeFileSync(frame, `<html><body><p>turn 20</p></body></html>`);
  await step("d", turn(20, "done"));
  assert.equal(keys().length, 20);
  assert.equal(keys()[0], "t1", "the oldest went");
  assert.equal(keys().at(-1), "t20", "the newest is always kept");
  assert.equal(canvas.versions(ctx, "d", "tides").filter((v) => v.kind === "before").length, 1, "the before copy stays");
  await assert.rejects(async () => canvas.versionRead(ctx, "d", "tides", 0), /isn't kept \(a session keeps the copies of its newest 20 turns\)/, "a turn that's gone says so plainly");
});

test("C2: a fork of a design session links its parent's copies, restores from them, and never writes into the parent's", async () => {
  const home = tmp("lc-pf-home-");
  const root = tmp("lc-pf-root-");
  const store = new Store(home);
  const e = { PATH: "/usr/bin:/bin", HOME: tmp("lc-pf-h-") } as NodeJS.ProcessEnv;
  const runtime = new Runtime(store, e);
  const ctx = designCtx(store, { env: e });
  const raw = createApi(store, runtime, e, { routines: { routines: [], recent: [], put: () => undefined, remove: () => undefined }, terms: {}, logs: {}, proxies: {}, design: ctx } as never);
  opened.push({ stop: () => (raw.updates.stop(), runtime.shutdown()) });
  store.putProject({ id: "p", name: "p", path: root, git: false, createdAt: 1 });
  canvas.attach(ctx);
  canvas.createFile(ctx, root, "Tides", "phone", "tides");
  store.putThread(thread("d", { design: { file: "tides" } }));
  const frame = join(root, ".liner/designs/tides/frames/phone.html");
  const step = async (id: string, it: Item) => (store.putItem(id, it), await canvas.canvasIdle(ctx));
  await step("d", turn(1, "running"));
  writeFileSync(frame, "<html><body><p>one</p></body></html>");
  await step("d", turn(1, "done"));
  store.patchThread("d", { turns: 1, status: "done" });
  const fork = (await raw.call("thread.create", { projectId: "p", forkOf: "d" })) as Thread;
  await canvas.canvasIdle(ctx);
  assert.deepEqual(canvas.versions(ctx, fork.id, "tides").map((v) => v.key), ["t0", "t1"]);
  const mine = join(home, "designs", fork.id, "canvas/tides/t1/frames/phone.html");
  const theirs = join(home, "designs", "d", "canvas/tides/t1/frames/phone.html");
  assert.equal(statSync(mine).ino, statSync(theirs).ino, "a link, not a second copy of the bytes");
  // The fork brings turn 1 back, then takes its own turn 1 again: the parent's copy and record stay as they were.
  writeFileSync(frame, "<html><body><p>later</p></body></html>");
  const parentRecord = readFileSync(join(home, "designs", "d", "canvas/tides/t1.json"), "utf8");
  canvas.restore(ctx, fork.id, "tides", 1);
  assert.match(readFileSync(frame, "utf8"), /one/);
  writeFileSync(frame, "<html><body><p>fork's own</p></body></html>");
  await canvas.keepVersionAsync(ctx, fork.id, root, "tides", 1);
  assert.match(readFileSync(theirs, "utf8"), /one/, "the parent's copy is its own still");
  assert.equal(readFileSync(join(home, "designs", "d", "canvas/tides/t1.json"), "utf8"), parentRecord, "and so is its record");
  assert.ok(readdirSync(join(home, "designs", fork.id, "canvas/tides")).includes("t1"));
});

// C3 (#3), #14, #15: Security writes once per batch, the Overview sweeps its days once, a batch is matched by index.

function secRig() {
  const store = new Store(tmp("lc-pf-sec-"));
  store.putProject({ id: "p", name: "p", path: tmp("lc-pf-secp-"), git: false, createdAt: 1 });
  const sec = new Security(store, { PATH: "/usr/bin:/bin" });
  let saves = 0;
  const raw = sec as unknown as { save: (id: string) => void };
  const save = raw.save.bind(sec);
  raw.save = (id: string) => (saves++, save(id));
  const scansSent: EngineEvent[] = [];
  store.on((e) => e.type === "security.scan" && scansSent.push(e));
  return { store, sec, saves: () => saves, scansSent };
}
const pkg = (i: number): NewFinding => ({ title: `left-pad ${i} has a known problem`, severity: i % 3 ? "medium" : "high", source: "checks", file: "package.json", rule: `GHSA-${i}` });

test("C3: a reported finding and its count on the scan are one write; a batch's counts are one write and one scan event", () => {
  const { sec, saves, scansSent } = secRig();
  const scan = sec.newScan({ projectId: "p", depth: "checks", title: "Free checks" });
  const before = saves();
  const a = sec.add("p", { title: "The token is logged", severity: "high", source: "agent", file: "a.js", scan: scan.id }, "Opus", scan.id);
  assert.equal(a.outcome, "new");
  assert.equal(saves() - before, 1, "the finding and its count in one write");
  assert.deepEqual([sec.scan(scan.id).counts.found, sec.scan(scan.id).counts.fresh, sec.scan(scan.id).counts.bySeverity.high], [1, 1, 1]);
  // 300 free-check results: one write for the findings, one for the counts, one security.scan.
  const sent = scansSent.length;
  const mid = saves();
  const added = sec.addMany("p", Array.from({ length: 300 }, (_, i) => ({ ...pkg(i), scan: scan.id })), "checks");
  sec.countMany(scan.id, added);
  assert.equal(saves() - mid, 2);
  assert.equal(scansSent.length - sent, 1);
  assert.equal(sec.scan(scan.id).counts.found, 301);
  assert.equal(sec.scan(scan.id).counts.bySeverity.high, 1 + 100);
  // The record on disk is whole: a fresh read has every finding and the counts.
  const again = new Security(sec.store, { PATH: "/usr/bin:/bin" });
  assert.equal(again.findings("p").length, 301);
  assert.equal(again.scan(scan.id).counts.found, 301);
});

test("#15: a batch matches what is stored as one result at a time did, by index, and quickly", () => {
  const one = secRig().sec;
  const many = secRig().sec;
  // What is stored: SARIF results with instances, a dismissed one, and one fixed.
  const stored: NewFinding[] = Array.from({ length: 2000 }, (_, i) => ({ title: `Query built from text ${i % 50}`, severity: "medium", source: "sarif", file: `src/f${i % 50}.js`, rule: "js/sql-injection", instance: `s:${i}` }));
  for (const sec of [one, many]) {
    sec.addMany("p", stored, "sarif");
    sec.addMany("p", Array.from({ length: 10 }, (_, i) => pkg(i)), "checks");
    sec.dismiss(sec.findings("p").find((f) => f.rule === "GHSA-1")!.id, "accepted-risk");
    sec.fixed(sec.findings("p").find((f) => f.rule === "GHSA-2")!.id);
  }
  const incoming: NewFinding[] = [...Array.from({ length: 300 }, (_, i) => pkg(i)), { title: "Query built from text 7", severity: "high", source: "agent", file: "src/f7.js", rule: "js/sql-injection" }, ...stored.slice(0, 5).map((n) => ({ ...n, severity: "high" as const }))];
  const t0 = performance.now();
  const batch = many.addMany("p", incoming, "x");
  const ms = performance.now() - t0;
  const each = incoming.map((n) => one.add("p", n, "x"));
  assert.deepEqual(batch.map((a) => a.outcome), each.map((a) => a.outcome));
  const shape = (f: SecurityFinding) => [f.key, f.state, f.severity, f.sources.join(","), f.activity.length];
  assert.deepEqual(many.findings("p").map(shape), one.findings("p").map(shape));
  assert.ok(ms < 1500, `300 results against 2000 stored: ${Math.round(ms)} ms`);
});

test("#14: the Overview's day line is what replaying each finding per day gives", () => {
  const { sec } = secRig();
  const now = Date.now();
  const DAY = 86_400_000;
  for (let i = 0; i < 60; i++) sec.add("p", { title: `Finding ${i}`, severity: "low", source: "agent", file: `f${i}.js` });
  // Back-date their activity over the last months, with fixes, dismissals and returns among them.
  const d = (sec as unknown as { load: (id: string) => { findings: SecurityFinding[] } }).load("p");
  d.findings.forEach((f, i) => {
    const at = now - (i % 40) * DAY - 3600_000;
    f.foundAt = at;
    f.activity = [{ at, kind: "found", text: "Found" }, ...(i % 3 === 0 ? [{ at: at + 5 * DAY, kind: "fixed" as const, text: "Fixed" }] : []), ...(i % 6 === 0 ? [{ at: at + 9 * DAY, kind: "raised-again" as const, text: "Again" }] : []), ...(i % 5 === 1 ? [{ at: at + 2 * DAY, kind: "dismissed" as const, text: "Dismissed" }] : [])];
  });
  const o = sec.overview(45, "p", now);
  const first = new Date(now);
  first.setHours(0, 0, 0, 0);
  const start = first.getTime() - 44 * DAY;
  o.series.forEach((day, i) => {
    const at = start + i * DAY;
    const end = Math.min(at + DAY - 1, now);
    const within = (t: number) => t >= at && t <= end;
    assert.equal(day.open, d.findings.filter((f) => stateAt(f, end) === "open").length, `open on ${day.day}`);
    assert.equal(day.found, d.findings.filter((f) => within(f.foundAt)).length);
    assert.equal(day.fixed, d.findings.flatMap((f) => f.activity).filter((e) => e.kind === "fixed" && within(e.at)).length);
    assert.equal(day.dismissed, d.findings.flatMap((f) => f.activity).filter((e) => e.kind === "dismissed" && within(e.at)).length);
  });
});

// C4 (#4): a canvas tool reads each design file once per call, and the prefs and skills once.

test("C4: design_frame reads the design it draws in and nothing else of the folder; design_files reads the skill folders once", async () => {
  const { root, store, ctx } = design();
  const home = tmp("lc-pf-skills-");
  mkdirSync(join(root, ".claude/skills/tide-type"), { recursive: true });
  writeFileSync(join(root, ".claude/skills/tide-type/SKILL.md"), "---\nname: tide-type\ndescription: Type for tide tables\n---\nUse a serif.\n");
  const c = { ...ctx, env: { HOME: home, PATH: "/usr/bin:/bin" } as NodeJS.ProcessEnv };
  lean.rpc(() => c);
  for (let i = 0; i < 10; i++) {
    canvas.createFile(c, root, `D${i}`, undefined, `d${i}`);
    for (let k = 0; k < 5; k++) canvas.addFrame(c, root, `d${i}`, { name: `F${k}`, w: 400, h: 400 }, `<html><body><p>${k}</p></body></html>`);
  }
  store.putThread(thread("t", { design: { file: "d3" } }));
  const at: DesignCall = { ...c, threadId: "t", sidekick: false };
  const reads: string[] = [];
  const real = fs.readFileSync;
  fs.readFileSync = ((p: fs.PathOrFileDescriptor, o?: unknown) => (reads.push(String(p)), real(p, o as never))) as typeof fs.readFileSync;
  syncBuiltinESMExports();
  try {
    await canvas.call("design_frame", { design: "d3", name: "F1", width: 400, height: 400, html: "<html><body><p>new</p></body></html>" }, at);
    const index = reads.filter((p) => p.endsWith("design.json"));
    assert.ok(index.every((p) => p.includes("/d3/")), `only d3's design.json is read: ${index.filter((p) => !p.includes("/d3/")).length} others were`);
    assert.ok(index.length <= 2, `d3's design.json read ${index.length} times (once, and once again after the write changed it)`);
    assert.ok(reads.filter((p) => p.endsWith("design-pictures.json")).length <= 1, "the picture settings at most once");
    reads.length = 0;
    await canvas.call("design_files", {}, at);
    assert.equal(reads.filter((p) => p.endsWith("tide-type/SKILL.md")).length, 1, "the folder's skill read once for ten design files");
  } finally {
    fs.readFileSync = real;
    syncBuiltinESMExports();
  }
});

// #5: watches a reloaded window never let go are let go when no window is connected.

test("#5: canvas and design watches counted up by reloads all go with resetWatches and unwatchAll", () => {
  const { root, ctx } = design();
  canvas.createFile(ctx, root, "W", undefined, "w");
  // A window watches, reloads (no off), and the new one watches again: the count is two, and nothing would ever end it.
  canvas.watchFile(ctx, root, "w", true);
  canvas.watchFile(ctx, root, "w", true);
  canvas.watchFile(ctx, root, "w", true, true);
  const st = (ctx.keep("canvas", () => ({})) as { watchers: Map<string, unknown> }).watchers;
  assert.equal(st.size, 1);
  canvas.resetWatches(ctx);
  assert.equal(st.size, 0, "the watcher and its once-a-second look are gone");
  // The window that loads in its place watches again, as it opens the design.
  canvas.watchFile(ctx, root, "w", true);
  assert.equal(st.size, 1);
  canvas.watchFile(ctx, root, "w", false);
  assert.equal(st.size, 0, "and its own off ends it, the count right again");
});

// Builder 7's hand-over (addons-desktop #20), round 2: a folder's file server stays while the folder is a project's, since the
// Design face, a Browser panel or an agent's browser may still hold its address; it closes when the project is removed.

test("a folder's file server stays when its last session is archived or deleted (a design may be open there), and closes with its project", async () => {
  const home = tmp("lc-pf-home-");
  const root = tmp("lc-pf-root-");
  const other = tmp("lc-pf-other-");
  const store = new Store(home);
  const e = { PATH: "/usr/bin:/bin", HOME: tmp("lc-pf-h-") } as NodeJS.ProcessEnv;
  const runtime = new Runtime(store, e);
  const open = new Set([root, other]);
  const closed: string[] = [];
  const proxies = { folderRoots: () => [...open], closeFolder: (r: string) => (open.delete(r), closed.push(r), true), files: async () => "" };
  const raw = createApi(store, runtime, e, { routines: { routines: [], recent: [], put: () => undefined, remove: () => undefined }, terms: {}, logs: {}, proxies } as never);
  opened.push({ stop: () => (raw.updates.stop(), runtime.shutdown()) });
  store.putProject({ id: "p", name: "p", path: root, git: false, createdAt: 1 });
  store.putProject({ id: "q", name: "q", path: other, git: false, createdAt: 1 });
  store.putThread(thread("a"));
  store.putThread(thread("b"));
  store.putThread(thread("c", { projectId: "q" }));
  await raw.call("thread.update", { id: "a", archived: true });
  await raw.call("thread.remove", { id: "b" });
  assert.deepEqual(closed, [], "the project is still there: the Design face may be showing its design through that server");
  await raw.call("project.remove", { id: "p" });
  assert.deepEqual(closed, [root], "a removed project's server closes");
  assert.ok(open.has(other), "another folder's server stays");
});

// #10: a real file whose name starts with two dots is inside the folder; ../ still isn't.

test("#10: a file named ..something is inside its folder, for a frame's path and a threat model; a path up out of it is still refused", async () => {
  const { root, store, ctx } = design();
  store.putThread(thread("t"));
  writeFileSync(join(root, "..draft.html"), "<html><body><p>draft</p></body></html>");
  const at: DesignCall = { ...ctx, threadId: "t", sidekick: false };
  const r = await canvas.call("design_frame", { name: "Draft", width: 400, height: 400, path: "..draft.html" }, at);
  assert.match((r.content[0] as { text: string }).text, /Drew the frame “Draft”/);
  await assert.rejects(canvas.call("design_frame", { name: "Up", width: 400, height: 400, path: "../x.html" }, at), /inside this session's folder/);
  const { sec } = secRig();
  sec.setModelFile("p", "..security.md");
  assert.equal(sec.modelFile("p"), "..security.md");
  assert.throws(() => sec.setModelFile("p", "../security.md"), /inside the project's folder/);
});

// #13: what the canvas keeps per turn doesn't grow with every turn ever run.

test("#13: the canvas keeps the running and last ended turn per session, and forgets a session that goes", async () => {
  const { root, store, ctx, step } = design();
  canvas.createFile(ctx, root, "T", undefined, "t1");
  store.putThread(thread("s"));
  for (let n = 1; n <= 30; n++) {
    await step("s", turn(n, "running"));
    await step("s", turn(n, "done"));
  }
  const st = ctx.keep("canvas", () => ({})) as { turns: Map<string, number>; ended: Map<string, number>; looks: Map<string, unknown> };
  assert.equal(st.turns.size, 0, "no turn runs now");
  assert.deepEqual([...st.ended], [["s", 30]]);
  assert.equal(st.looks.size, 0);
  // A repeated end of the last turn is no second copy, and a turn's start seen again after its end starts nothing.
  await step("s", turn(30, "done"));
  await step("s", turn(30, "running"));
  assert.equal(st.turns.size, 0);
  store.emit({ type: "thread.removed", id: "s" });
  assert.equal(st.ended.size, 0);
});

// #17: a scan whose first message never starts ends as failed in those words, not as running until its clock.

test("#17: a scan whose session's first message didn't start fails at once, saying why", async () => {
  const { store, sec } = secRig();
  let n = 0;
  sec.bind({
    call: (async (method: string, params: Record<string, unknown>) => {
      if (method === "thread.create") return store.putThread(thread(`th${++n}`, { access: "read", security: params.security as Thread["security"] }));
      // As api.ts thread.send does when the start fails: the message waits in the queue, and the app is told.
      if (method === "thread.send") store.emit({ type: "notify", threadId: String(params.id), kind: "error", title: "That didn't start", body: "the worktree couldn't be made" });
      return null;
    }) as never,
    runtime: { isRunning: () => false, stop: () => {} } as never,
    providers: () => [],
    refreshProviders: async () => [],
  });
  wake(sec);
  const { scan } = await startScan(sec, { projectId: "p", depth: "project", reader: { kind: "own", agent: "@claude:claude-opus-5-5" }, stopsAfter: 30 });
  for (let i = 0; i < 100 && sec.scan(scan.id).state === "running"; i++) await new Promise((r) => setTimeout(r, 20));
  const s = sec.scan(scan.id);
  assert.equal(s.state, "failed");
  assert.equal(s.error, "That didn't start: the worktree couldn't be made");
});
