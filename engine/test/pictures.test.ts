/*
  Liner Design's pictures, against a local fake of OpenAI's Images API (never a real endpoint):
  a picture saved under the design's assets/ and put into a frame, no model set, the person asked
  first (once, each time, or never, as the design file says), a failing endpoint, and the key never
  in an answer or an error. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesignFile, EngineEvent } from "../../contracts/src/index.ts";
import { emptyUsage, pictureKey } from "../../contracts/src/index.ts";
import { createFile, designCtx, readFile, saveFile, type DesignCtx } from "../src/canvas.ts";
import { ADD_MAX, ANSWER_MAX, call, checkEndpointUrl, fetchLinked, NO_ONE, normalIp, placeInto, privateIp, rpc, sizeFor } from "../src/pictures.ts";
import { Store } from "../src/store.ts";

/** A design file on disk as any writer leaves it (the canvas reads it back through peekFile / readFile). */
function saveDesign(cwd: string, slug: string, d: DesignFile) {
  mkdirSync(join(cwd, ".liner", "designs", slug, "frames"), { recursive: true });
  writeFileSync(join(cwd, ".liner", "designs", slug, "design.json"), JSON.stringify(d, null, 2));
}

const KEY = "sk-test-0123456789abcdefghijklmnop";
/** A one-pixel PNG. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Seen = { url: string; auth?: string; body: Record<string, unknown> };
async function fake(answer: (seen: Seen) => { status: number; body: unknown }) {
  const seen: Seen[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const s = { url: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(raw || "{}") };
      seen.push(s);
      const a = answer(s);
      res.writeHead(a.status, { "content-type": "application/json" }).end(JSON.stringify(a.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/v1`, seen, close: () => server.close() };
}

const frame = `<!doctype html><html><body data-l="b"><div data-l="hero" class="hero" style="height:200px;background:#eee"></div><img data-l="pic" alt=""></body></html>`;
/** The same frame with an element the agent added by hand, not stamped yet. */
const framePlus = frame.replace("</body>", "<p>Low water</p></body>");

function setup(url?: string, ask: NonNullable<DesignFile["pictures"]>["ask"] = "first", model?: string | null) {
  const home = mkdtempSync(join(tmpdir(), "lc-pics-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "lc-pics-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
  store.putThread({ id: "t", projectId: "p", title: "Pictures", agent: "forge", status: "running", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  if (url) store.setSettings({ pictures: [{ id: "img", label: "ChatGPT Images", url, model: "gpt-image-2" }] });
  writeFileSync(join(cwd, "DESIGN.md"), "## Colour\n- Deep #F7F8F5\n- Mark #C4127A\n");
  saveDesign(cwd, "tide-tables", { v: 1, id: "tide-tables", title: "Tide tables", pages: [{ id: "page-1", name: "Page 1" }], frames: [{ id: "web-launch", page: "page-1", name: "Web / Launch", kind: "drawn", path: "frames/web-launch.html", x: 0, y: 0, w: 1280, h: 800 }], lean: { skills: [] } });
  mkdirSync(join(cwd, ".liner/designs/tide-tables/frames"), { recursive: true });
  writeFileSync(join(cwd, ".liner/designs/tide-tables/frames/web-launch.html"), framePlus);
  const events: EngineEvent[] = [];
  const asks: { title: string; fields: { label: string; value: string }[] }[] = [];
  let say = true;
  const keys = new Map([[pictureKey("img"), KEY]]);
  const ctx: DesignCtx = designCtx(store, { keys, emit: (e) => void events.push(e), whoIs: () => "Opus 5.5", ask: (_id, a) => (asks.push(a), { id: "it", answer: Promise.resolve(say ? { allow: true } : { allow: false, reason: "Not now" }) }) });
  // The picture setting is the engine's (design-prefs.ts), set as the app sets it: through canvas.save.
  saveFile(ctx, cwd, "tide-tables", { pictures: { ask, ...(model !== undefined ? { model } : {}) } });
  return { cwd, home, store, ctx, events, asks, no: () => (say = false), at: { ...ctx, threadId: "t", sidekick: false } };
}
const said = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? "").join("");

test("pictures: made by the endpoint, saved under assets/, put into a frame, the lean's colours sent, asked once a session", async () => {
  const api = await fake(() => ({ status: 200, body: { data: [{ b64_json: PNG }], usage: { cost: 0.04 } } }));
  try {
    const { cwd, events, asks, at } = setup(api.url);
    const r = await call("design_picture", { prompt: "The estuary at low water, from above", width: 640, height: 800, into: { frame: "Web / Launch", id: "hero" } }, at);
    const text = said(r);
    assert.match(text, /^made: assets\/the-estuary-at-low-water-from-[\w-]+\.png/);
    assert.match(text, /by ChatGPT Images in [\d.]+ s, \$0\.040\. It's in Web \/ Launch now, in hero\./);
    const path = /assets\/[\w-]+\.png/.exec(text)![0];
    assert.equal(readFileSync(join(cwd, ".liner/designs/tide-tables", path)).toString("base64"), PNG);
    const html = readFileSync(join(cwd, ".liner/designs/tide-tables/frames/web-launch.html"), "utf8");
    assert.match(html, new RegExp(`<div data-l="hero" class="hero" style="height:200px;background-image:url\\(\\.\\./${path}\\);background-size:cover;background-position:center" data-by="ChatGPT Images" data-prompt="The estuary at low water, from above">`), "the old background goes, the rest of the style stays");
    assert.match(html, /<p data-l="[a-z0-9]+">Low water<\/p>/, "written through the canvas's frame writer, so what was new is stamped");
    assert.equal(api.seen[0].url, "/v1/images/generations");
    assert.equal(api.seen[0].auth, `Bearer ${KEY}`);
    assert.deepEqual([api.seen[0].body.model, api.seen[0].body.size, api.seen[0].body.n, api.seen[0].body.response_format], ["gpt-image-2", "1024x1536", 1, undefined]);
    assert.match(String(api.seen[0].body.prompt), /Keep to this palette: Deep #F7F8F5, Mark #C4127A\./);
    assert.equal(asks.length, 1);
    assert.match(asks[0].title, /Make an AI picture/);
    assert.deepEqual(asks[0].fields.map((f) => f.label), ["Picture", "Size", "Goes into"]);
    assert.ok(events.some((e) => e.type === "pictures.progress" && e.done === 1));
    assert.ok(events.some((e) => e.type === "canvas.changed" && e.frame === "web-launch" && e.by === "agent"));

    // "first": the session said yes once; an img gets a src.
    await call("design_picture", { prompt: "A tide gauge", width: 400, height: 400, into: { frame: "web-launch", id: "pic" } }, at);
    assert.equal(asks.length, 1, "asked before the first picture only");
    assert.match(readFileSync(join(cwd, ".liner/designs/tide-tables/frames/web-launch.html"), "utf8"), /<img data-l="pic" alt="" src="\.\.\/assets\/a-tide-gauge-[\w-]+\.png" data-by="ChatGPT Images" data-prompt="A tide gauge">/);
    assert.ok(!JSON.stringify(events).includes(KEY), "no event carries the key");
  } finally {
    api.close();
  }
});

test("pictures: asked each time, or never, as the design file says; a no makes nothing", async () => {
  const api = await fake(() => ({ status: 200, body: { data: [{ b64_json: PNG }] } }));
  try {
    const always = setup(api.url, "always");
    await call("design_picture", { prompt: "Sand", width: 100, height: 100 }, always.at);
    await call("design_picture", { prompt: "Sand", width: 100, height: 100 }, always.at);
    assert.equal(always.asks.length, 2);
    always.no();
    assert.match(said(await call("design_picture", { prompt: "Sand", width: 100, height: 100 }, always.at)), /^denied: the person said no to this picture, and said: “Not now”\. Nothing was made\./);
    assert.equal(api.seen.length, 2, "nothing was asked of the endpoint after a no");
    const never = setup(api.url, "never");
    await call("design_picture", { prompt: "Sand", width: 100, height: 100 }, never.at);
    assert.equal(never.asks.length, 0);
    // The person's own press in the inspector is their yes.
    const r = await rpc(() => never.ctx)["pictures.make"]({ threadId: "t", cwd: never.cwd, file: "tide-tables", prompt: "Shingle", size: { w: 1600, h: 900 }, count: 3 });
    assert.equal(r.paths.length, 1, "as many as came back");
    assert.equal(api.seen.at(-1)!.body.size, "1536x1024");
    assert.equal(api.seen.at(-1)!.body.n, 3);
    assert.deepEqual(rpc(() => never.ctx)["pictures.models"]({}), [{ id: "img", name: "ChatGPT Images", kind: "openai-images", model: "gpt-image-2" }], "no url, no key");
  } finally {
    api.close();
  }
});

test("pictures: with no model set, a plain sentence and nothing made; a failing endpoint says so without the key", async () => {
  const none = setup();
  const r = await call("design_picture", { prompt: "Sand", width: 100, height: 100 }, none.at);
  assert.equal(r.isError, undefined);
  // "AI pictures" are optional (the spec's decision 6): a labelled empty box, and never a nudge to add a model.
  assert.match(said(r), /^There's no AI pictures model, so no picture was made and nothing was charged\. Leave a labelled empty box/);
  assert.doesNotMatch(said(r), /Settings|add a/i);
  assert.equal(none.asks.length, 0);
  assert.equal(existsSync(join(none.cwd, ".liner/designs/tide-tables/assets")), false);
  await assert.rejects(async () => rpc(() => none.ctx)["pictures.make"]({ threadId: "t", cwd: none.cwd, file: "tide-tables", prompt: "x", size: { w: 1, h: 1 } }), /There's no AI pictures model\. Your own image files always work/);

  const api = await fake((s) => ({ status: 401, body: { error: { message: `Incorrect API key provided: ${s.auth?.slice(7)}` } } }));
  try {
    const bad = setup(api.url, "never");
    await assert.rejects(call("design_picture", { prompt: "Sand", width: 100, height: 100 }, bad.at), (e: Error) => {
      assert.match(e.message, /^ChatGPT Images answered 401: Incorrect API key provided: /);
      assert.ok(!e.message.includes(KEY), e.message);
      return true;
    });
    assert.ok(!JSON.stringify(bad.events).includes(KEY));
    assert.ok(bad.events.some((e) => e.type === "pictures.progress" && e.error));
  } finally {
    api.close();
  }
  const gone = setup("http://127.0.0.1:9/v1", "never");
  await assert.rejects(call("design_picture", { prompt: "Sand", width: 100, height: 100 }, gone.at), /didn't answer at 127\.0\.0\.1:9/);
  const empty = await fake(() => ({ status: 200, body: { data: [] } }));
  try {
    await assert.rejects(call("design_picture", { prompt: "Sand", width: 100, height: 100 }, setup(empty.url, "never").at), /sent no picture back/);
  } finally {
    empty.close();
  }
  const ro = setup("http://127.0.0.1:9/v1", "never");
  await assert.rejects(call("design_picture", { prompt: "Sand", width: 100, height: 100 }, { ...ro.at, readOnly: () => true }), /is at Read only now/);
});

test("pictures: sizes by shape, and a picture placed by data-l only where that id is", () => {
  assert.deepEqual([sizeFor(1280, 800), sizeFor(390, 844), sizeFor(500, 520)], ["1536x1024", "1024x1536", "1024x1024"]);
  assert.throws(() => placeInto(frame, "missing", "../assets/a.png", "x"), /no element missing/);
  assert.match(placeInto('<img data-l="a" src="old.png"/>', "a", "../assets/b.png", "M"), /^<img data-l="a" src="\.\.\/assets\/b\.png" data-by="M" \/>$/);
});

test("pictures: lean false sends no palette, and the layer remembers it for Make again", async () => {
  const api = await fake(() => ({ status: 200, body: { data: [{ b64_json: PNG }] } }));
  try {
    const { cwd, at, ctx } = setup(api.url, "never");
    await call("design_picture", { prompt: "Mudflats at dawn", width: 400, height: 400, lean: false, into: { frame: "web-launch", id: "pic" } }, at);
    assert.equal(api.seen[0].body.prompt, "Mudflats at dawn", "no palette");
    const html = readFileSync(join(cwd, ".liner/designs/tide-tables/frames/web-launch.html"), "utf8");
    assert.match(html, /<img data-l="pic" alt="" src="[^"]+" data-by="ChatGPT Images" data-prompt="Mudflats at dawn" data-lean="0">/);
    await call("design_picture", { prompt: "Mudflats at noon", width: 400, height: 400, into: { frame: "web-launch", id: "pic" } }, at);
    assert.match(String(api.seen[1].body.prompt), /Keep to this palette/, "left out, the lean goes with it as before");
    assert.match(readFileSync(join(cwd, ".liner/designs/tide-tables/frames/web-launch.html"), "utf8"), /data-prompt="Mudflats at noon">/, "data-lean only when off; the old marks don't pile up");
    await rpc(() => ctx)["pictures.make"]({ threadId: "t", cwd, file: "tide-tables", prompt: "Shingle", size: { w: 400, h: 400 }, lean: false });
    assert.equal(api.seen[2].body.prompt, "Shingle");
  } finally {
    api.close();
  }
});

test("pictures: a design file's own model, No one (refused, nobody asked, nothing called), and a stale id falling back", async () => {
  const api = await fake(() => ({ status: 200, body: { data: [{ b64_json: PNG }] } }));
  try {
    const none = setup(api.url, "always", null);
    assert.equal(readFile(none.ctx, none.cwd, "tide-tables").pictures?.model, null, "No one survives a read");
    const r = await call("design_picture", { prompt: "Sand", width: 100, height: 100 }, none.at);
    assert.equal(said(r), NO_ONE);
    assert.equal(r.isError, undefined);
    await assert.rejects(async () => rpc(() => none.ctx)["pictures.make"]({ threadId: "t", cwd: none.cwd, file: "tide-tables", prompt: "x", size: { w: 100, h: 100 } }), /AI pictures are off for this design file/);
    assert.deepEqual([none.asks.length, api.seen.length], [0, 0]);

    const stale = setup(api.url, "never", "gone-model");
    await call("design_picture", { prompt: "Sand", width: 100, height: 100 }, stale.at);
    assert.equal(api.seen.length, 1, "Settings' first answered");

    // Saved through canvas.save like the other settings; ask alone keeps the model.
    const s = setup(api.url, "never");
    assert.equal(saveFile(s.ctx, s.cwd, "tide-tables", { pictures: { ask: "first", model: null } }).pictures?.model, null);
    assert.equal(saveFile(s.ctx, s.cwd, "tide-tables", { pictures: { ask: "always" } }).pictures?.model, null);
    assert.deepEqual(saveFile(s.ctx, s.cwd, "tide-tables", { pictures: { ask: "always", model: "img" } }).pictures, { ask: "always", model: "img" });
    assert.deepEqual(readFile(s.ctx, s.cwd, "tide-tables").pictures, { ask: "always", model: "img" });
  } finally {
    api.close();
  }
});

test("pictures.add: a picture of the person's own into assets/, by its bytes, capped, its name made safe", async () => {
  const { cwd, ctx } = setup();
  const add = rpc(() => ctx)["pictures.add"];
  const r = await add({ cwd, file: "tide-tables", name: "../../x.png", data: PNG });
  assert.match(r.path, /^assets\/x-[0-9a-f]{8}\.png$/);
  assert.equal(readFileSync(join(cwd, ".liner/designs/tide-tables", r.path)).toString("base64"), PNG);
  assert.equal(existsSync(join(cwd, ".liner/x.png")) || existsSync(join(cwd, "x.png")), false);
  const again = await add({ cwd, file: "tide-tables", name: "x.png", data: `data:image/png;base64,${PNG}` });
  assert.equal(again.path, r.path, "the same bytes and name are the same file");
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]).toString("base64");
  assert.match((await add({ cwd, file: "tide-tables", name: "Harbour photo.PNG", data: jpeg })).path, /^assets\/harbour-photo-[0-9a-f]{8}\.jpg$/, "the kind is the bytes', not the name's");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
  await assert.rejects(async () => add({ cwd, file: "tide-tables", name: "logo.png", data: svg }), /not SVG/);
  const big = Buffer.concat([Buffer.from(PNG, "base64"), Buffer.alloc(ADD_MAX)]).toString("base64");
  await assert.rejects(async () => add({ cwd, file: "tide-tables", name: "big.png", data: big }), /over 8 MB/);
  await assert.rejects(async () => add({ cwd: "/somewhere/else", file: "tide-tables", name: "x.png", data: PNG }), /isn't one of your projects/);
});

// Round 4: what decides whether money is spent never comes from a file the agent writes (R's H4), and a hostile endpoint (L4).

test("H4: pictures.ask written into design.json by the agent is ignored: the person is still asked (R's probe P2)", async () => {
  const api = await fake(() => ({ status: 200, body: { data: [{ b64_json: PNG }] } }));
  try {
    const home = mkdtempSync(join(tmpdir(), "lc-h4-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "lc-h4-"));
    const store = new Store(home);
    store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
    store.putThread({ id: "t", projectId: "p", title: "Pictures", agent: "forge", status: "running", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
    store.setSettings({ pictures: [{ id: "pic-x", label: "Fake", url: api.url, model: "fake" }] });
    let asked = 0;
    const ctx = designCtx(store, { ask: () => (asked++, { id: "it", answer: Promise.resolve({ allow: false }) }) });
    createFile(ctx, cwd, "Foo", undefined, "foo");
    const p = join(cwd, ".liner/designs/foo/design.json");
    const j = JSON.parse(readFileSync(p, "utf8"));
    j.pictures = { ask: "never" };
    writeFileSync(p, JSON.stringify(j));
    const r = await call("design_picture", { prompt: "a harbour", width: 100, height: 100, design: "foo" }, { ...ctx, threadId: "t", sidekick: false });
    assert.equal(asked, 1, "asked, whatever design.json says");
    assert.equal(api.seen.length, 0, "and nothing charged on a no");
    assert.match(said(r), /^denied/);
    assert.equal(readFile(ctx, cwd, "foo").pictures, undefined, "the file's own claim isn't the setting");
  } finally {
    api.close();
  }
});

test("H4: a model written into design.json doesn't undo No one held by the engine, and the setting survives a restart", async () => {
  const api = await fake(() => ({ status: 200, body: { data: [{ b64_json: PNG }] } }));
  try {
    const s = setup(api.url, "always", null);
    const p = join(s.cwd, ".liner/designs/tide-tables/design.json");
    assert.equal(JSON.parse(readFileSync(p, "utf8")).pictures, undefined, "never written to design.json");
    writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, "utf8")), pictures: { ask: "never", model: "img" } }));
    assert.equal(said(await call("design_picture", { prompt: "Sand", width: 100, height: 100 }, s.at)), NO_ONE);
    assert.deepEqual([api.seen.length, s.asks.length], [0, 0]);
    // A new engine on the same home: the setting is still the person's.
    const again = designCtx(new Store(s.home));
    assert.deepEqual(readFile(again, s.cwd, "tide-tables").pictures, { ask: "always", model: null });
  } finally {
    api.close();
  }
});

test("L4: the endpoint's address is https, or on this Mac; checked when saved and when used", async () => {
  assert.throws(() => checkEndpointUrl("http://192.168.1.20:8080/v1"), /must start https:\/\//);
  assert.throws(() => checkEndpointUrl("http://images.example.com/v1"), /in clear/);
  assert.throws(() => checkEndpointUrl("ftp://x"), /must start https/);
  for (const ok of ["https://api.example.com/v1", "http://localhost:1234/v1", "http://127.0.0.1:9/v1", "http://[::1]:9/v1"]) assert.equal(checkEndpointUrl(ok).href.startsWith(ok.slice(0, 8)), true, ok);
  const s = setup("http://images.example.com/v1", "never");
  await assert.rejects(call("design_picture", { prompt: "Sand", width: 100, height: 100 }, s.at), /must start https:\/\//);
  // Saved through the app: refused before anything is kept.
  const { createApi } = await import("../src/api.ts");
  const { Runtime } = await import("../src/runtime.ts");
  const env = { PATH: "/usr/bin:/bin", HOME: s.home };
  const app = createApi(s.store, new Runtime(s.store, env), env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  await assert.rejects(async () => app.call("settings.save", { pictures: [{ id: "lan", label: "LAN", url: "http://10.0.0.2/v1", model: "m" }] }), /in clear/);
  assert.equal(s.store.settings.pictures?.[0].id, "img", "nothing was kept");
  app.updates.stop();
});

test("L4: a hostile answer: links only over https or from this Mac, never into a private network, capped, and only pictures saved", async () => {
  let links = 0;
  const pics = createServer((req, res) => {
    links++;
    if (req.url === "/svg") return void res.writeHead(200, { "content-type": "image/png" }).end("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>");
    if (req.url === "/redirect") return void res.writeHead(302, { location: "http://10.0.0.5/x.png" }).end();
    res.writeHead(200, { "content-type": "image/png" }).end(Buffer.from(PNG, "base64"));
  });
  await new Promise<void>((r) => pics.listen(0, "127.0.0.1", r));
  const here = `http://127.0.0.1:${(pics.address() as { port: number }).port}`;
  let answer: unknown = {};
  const api = await fake(() => ({ status: 200, body: answer }));
  try {
    const s = setup(api.url, "never");
    const ask = () => call("design_picture", { prompt: "Sand", width: 100, height: 100 }, s.at);
    answer = { data: [{ url: `${here}/pic` }] };
    assert.match(said(await ask()), /^made: assets\/sand-[\w]+\.png/, "a link on this Mac");
    answer = { data: [{ url: "http://cdn.example.com/x.png" }] };
    await assert.rejects(ask(), /isn't https/);
    answer = { data: [{ url: "https://10.0.0.5/x.png" }] };
    await assert.rejects(ask(), /private network/);
    answer = { data: [{ url: "https://[fd00::1]/x.png" }] };
    await assert.rejects(ask(), /private network/);
    answer = { data: [{ url: `${here}/redirect` }] };
    await assert.rejects(ask(), /fetch failed|redirect/i, "no redirects followed");
    answer = { data: [{ url: `${here}/svg` }] };
    await assert.rejects(ask(), /isn't a picture/, "decided by the bytes, whatever the type says");
    answer = { data: [{ b64_json: Buffer.from("not a picture at all").toString("base64") }] };
    await assert.rejects(ask(), /isn't a picture/);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]).toString("base64");
    answer = { data: [{ b64_json: jpeg }] };
    assert.match(said(await ask()), /^made: assets\/sand-[\w]+\.jpg/, "saved as what it is");
    assert.equal(privateIp("192.168.0.4") && privateIp("172.20.1.1") && privateIp("169.254.1.1") && privateIp("::ffff:10.1.1.1") && !privateIp("8.8.8.8"), true);
  } finally {
    api.close();
    pics.close();
  }
});

test("L4: an answer over 40 MB is refused, not read", async () => {
  const big = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    const chunk = Buffer.alloc(1024 * 1024, 32);
    let n = 0;
    const more = () => {
      while (n < 45) {
        n++;
        if (!res.write(chunk)) return void res.once("drain", more);
      }
      res.end();
    };
    more();
  });
  await new Promise<void>((r) => big.listen(0, "127.0.0.1", r));
  try {
    const s = setup(`http://127.0.0.1:${(big.address() as { port: number }).port}/v1`, "never");
    await assert.rejects(call("design_picture", { prompt: "Sand", width: 100, height: 100 }, s.at), /over 40 MB/);
    assert.equal(ANSWER_MAX, 40 * 1024 * 1024);
  } finally {
    big.close();
  }
});

test("L9: pictures aren't written through a link in the design's folder", async () => {
  const s = setup();
  const away = mkdtempSync(join(tmpdir(), "lc-away-"));
  const assets = join(s.cwd, ".liner/designs/tide-tables/assets");
  symlinkSync(away, assets);
  await assert.rejects(async () => rpc(() => s.ctx)["pictures.add"]({ cwd: s.cwd, file: "tide-tables", name: "x.png", data: PNG }), /is a link/);
  assert.deepEqual(readdirSync(away), []);
});

test("N7: a picture link on this Mac is followed only when the endpoint itself is on this Mac (R's probe L4b)", async () => {
  const hits: string[] = [];
  const local = createServer((req, res) => {
    hits.push(req.url ?? "");
    res.writeHead(200, { "content-type": "image/png" }).end(Buffer.from(PNG, "base64"));
  });
  await new Promise<void>((r) => local.listen(0, "127.0.0.1", r));
  const link = `http://127.0.0.1:${(local.address() as { port: number }).port}/admin/delete?all=1`;
  try {
    for (const remote of ["https://images.example.com/v1", "https://203.0.113.9/v1"]) {
      await assert.rejects(fetchLinked(link, new URL(remote), AbortSignal.timeout(5000)), /link to this Mac, which only an AI pictures model on this Mac may do/);
      await assert.rejects(fetchLinked(link.replace("http:", "https:"), new URL(remote), AbortSignal.timeout(5000)), /link to this Mac/);
    }
    assert.deepEqual(hits, [], "no request reached the service on this Mac");
    assert.equal((await fetchLinked(link, new URL("http://localhost:9/v1"), AbortSignal.timeout(5000))).toString("base64"), PNG, "a picture model on this Mac may link to it");
    assert.equal(hits.length, 1);
  } finally {
    local.close();
  }
});

test("L2: every way of writing this Mac's or a private address is caught (mapped, compatible, hex, octal, decimal, short)", async () => {
  for (const a of ["[::ffff:7f00:1]", "::ffff:127.0.0.1", "::127.0.0.1", "2130706433", "0177.0.0.1", "0x7f.1", "127.1", "[::1]", "0:0:0:0:0:0:0:1"]) {
    assert.equal(normalIp(a), ["[::1]", "0:0:0:0:0:0:0:1"].includes(a) ? "0:0:0:0:0:0:0:1" : "127.0.0.1", a);
    assert.equal(privateIp(a), true, a);
  }
  for (const a of ["::ffff:0a00:0001", "::ffff:c0a8:0101", "0xa.0.0.1", "012.0.0.1", "167772161", "fd00::1", "fe80::1%en0"]) assert.equal(privateIp(a), true, a);
  for (const a of ["8.8.8.8", "2001:db8::1", "::ffff:808:808", "example.com"]) assert.equal(privateIp(a), false, a);
  // A remote endpoint's link written any of these ways never reaches this Mac.
  const remote = new URL("https://images.example.com/v1");
  for (const link of ["https://[::ffff:7f00:1]:9/x.png", "https://[::ffff:127.0.0.1]:9/x.png", "https://2130706433:9/x.png", "https://0x7f.1:9/x.png", "https://[::127.0.0.1]:9/x.png"]) await assert.rejects(fetchLinked(link, remote, AbortSignal.timeout(3000)), /link to this Mac/, link);
  await assert.rejects(fetchLinked("https://[::ffff:c0a8:101]/x.png", remote, AbortSignal.timeout(3000)), /private network/);
});
