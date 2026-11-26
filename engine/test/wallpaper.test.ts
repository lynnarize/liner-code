/*
  The dots behind Home on the engine's side: a picture of your own kept, read back and removed
  (made a JPEG with sips, so these run on a Mac), and one drawn by the AI pictures model against a
  local fake of OpenAI's Images API (never a real endpoint), through /rpc's own handlers.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { pictureKey } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { run } from "../src/exec.ts";
import { Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

const KEY = "sk-test-0123456789abcdefghijklmnop";
const mac = process.platform === "darwin" ? false : "sips is macOS's";

/** A real PNG of w × h, a gradient, so sips has something to read and to make smaller. */
function png(w: number, h: number) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])));
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, crc]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rows.set([(x * 255) / w, (y * 255) / h, 160], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

type Seen = { url: string; auth?: string; raw: string; body: Record<string, unknown> };
async function fake(answer: (seen: Seen) => { status: number; body: unknown }) {
  const seen: Seen[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const s = { url: req.url ?? "", auth: req.headers.authorization, raw, body: JSON.parse(raw || "{}") };
      seen.push(s);
      const a = answer(s);
      res.writeHead(a.status, { "content-type": "application/json" }).end(JSON.stringify(a.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/v1`, seen, close: () => server.close() };
}

function setup(url?: string) {
  // Left in the temporary folder, as the other API tests leave theirs: the store still writes state.json a moment after a test ends.
  const home = mkdtempSync(join(tmpdir(), "lc-wallpaper-"));
  const store = new Store(home);
  if (url) store.setSettings({ pictures: [{ id: "img", label: "ChatGPT Images", url, model: "gpt-image-2" }] });
  // No tool on its PATH and the store's home for its own: the API's look at the tools as it starts never asks this Mac's.
  const env = { PATH: "/usr/bin:/bin", HOME: home };
  const runtime = new Runtime(store, env);
  runtime.keys.set(pictureKey("img"), KEY);
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const call = <T>(method: string, params: unknown = {}) => api.call(method, params) as Promise<T>;
  return { home, store, call, dots: join(home, "backgrounds", "dots.jpg") };
}

const longSide = async (file: string) => {
  const r = await run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { timeout: 15000 });
  return Math.max(...[...r.stdout.matchAll(/pixel(?:Width|Height): (\d+)/g)].map((m) => Number(m[1])));
};
const isJpeg = (b64: string) => Buffer.from(b64, "base64").subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));

test("A picture of your own for the dots is kept as a JPEG at most 2000 px long, read back, and removed, apart from the session background's", { skip: mac }, async () => {
  const s = setup();
  assert.equal(await s.call("wallpaper.image"), null, "nothing kept yet");
  assert.equal((await s.call<{ picture: boolean }>("wallpaper.info")).picture, false);
  await s.call("wallpaper.save", { data: png(2400, 1200).toString("base64"), name: "Harbour at dusk.png" });
  const got = await s.call<{ data: string; type: string } | null>("wallpaper.image");
  assert.equal(got?.type, "image/jpeg");
  assert.ok(got && isJpeg(got.data), "a JPEG, whatever came in");
  assert.equal(await longSide(s.dots), 2000);
  assert.equal((await s.call<{ picture: boolean }>("wallpaper.info")).picture, true);
  // The session background's own picture is a different slot: saving the dots' never makes one.
  assert.equal((await s.call<{ own: boolean }>("background.list")).own, false);
  assert.equal(await s.call("background.image", { id: "own" }), null);
  await s.call("background.save", { data: png(40, 30).toString("base64"), name: "own.png" });
  await s.call("wallpaper.remove");
  assert.equal(await s.call("wallpaper.image"), null);
  assert.equal((await s.call<{ picture: boolean }>("wallpaper.info")).picture, false);
  assert.ok((await s.call<{ data: string } | null>("background.image", { id: "own" }))?.data, "removing the dots' picture leaves the background's");
});

test("Draw it asks the AI pictures model for one landscape picture of the words alone and keeps it as the dots' picture", { skip: mac }, async (t) => {
  const api = await fake(() => ({ status: 200, body: { data: [{ b64_json: png(1536, 1024).toString("base64") }], usage: { cost: 0.04 } } }));
  t.after(api.close);
  const s = setup(api.url);
  const info = await s.call<{ picture: boolean; models: unknown[] }>("wallpaper.info");
  assert.deepEqual(info.models, [{ id: "img", name: "ChatGPT Images" }], "the models without their address or key");
  const r = await s.call<{ model: string; ms: number; cost?: number }>("wallpaper.draw", { prompt: "  A harbour at dusk, boats asleep  " });
  assert.equal(r.model, "ChatGPT Images");
  assert.equal(r.cost, 0.04);
  assert.equal(typeof r.ms, "number");
  assert.equal(api.seen.length, 1, "one request");
  assert.equal(api.seen[0].url, "/v1/images/generations");
  assert.equal(api.seen[0].auth, `Bearer ${KEY}`);
  assert.deepEqual(api.seen[0].body, { model: "gpt-image-2", prompt: "A harbour at dusk, boats asleep", n: 1, size: "1536x1024" });
  const got = await s.call<{ data: string; type: string } | null>("wallpaper.image");
  assert.ok(got && isJpeg(got.data), "kept as a JPEG");
  assert.equal(await longSide(s.dots), 1536);
  assert.equal((await s.call<{ picture: boolean }>("wallpaper.info")).picture, true);
});

test("With no AI pictures model Draw it says so in a plain sentence and asks nobody", async () => {
  const s = setup();
  assert.deepEqual((await s.call<{ models: unknown[] }>("wallpaper.info")).models, []);
  await assert.rejects(s.call("wallpaper.draw", { prompt: "A harbour at dusk" }), /^Error: There's no AI pictures model, so nothing was drawn and nothing was charged\. Add one in Settings › Models, or use a picture of your own\.$/);
  await assert.rejects(s.call("wallpaper.draw", { prompt: "A harbour at dusk", model: "gone" }), /There's no AI pictures model/);
  assert.equal(existsSync(s.dots), false);
});

test("The AI pictures key never shows in Draw it's error, even when the endpoint says it back", async (t) => {
  const api = await fake((seen) => ({ status: 401, body: { error: { message: `Incorrect API key provided: ${seen.auth?.slice(7)}. You sent ${seen.auth}.` } } }));
  t.after(api.close);
  const s = setup(api.url);
  const err = await s.call("wallpaper.draw", { prompt: "A harbour at dusk" }).then(() => null, (e: Error) => e);
  assert.ok(err, "it failed");
  assert.match(err.message, /^ChatGPT Images answered 401: Incorrect API key provided/);
  assert.equal(err.message.includes(KEY), false, err.message);
  assert.equal(err.message.includes(KEY.slice(8)), false, "not even the key's tail");
  assert.equal(api.seen[0].raw.includes(KEY), false, "the key went only in the header, never in the body");
  assert.equal(existsSync(s.dots), false);
});

test("An answer that isn't a picture is refused and nothing is kept for the dots", async (t) => {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`).toString("base64");
  const api = await fake(() => ({ status: 200, body: { data: [{ b64_json: svg }] } }));
  t.after(api.close);
  const s = setup(api.url);
  await assert.rejects(s.call("wallpaper.draw", { prompt: "A harbour at dusk" }), /ChatGPT Images sent something that isn't a picture, so it wasn't saved\./);
  assert.equal(existsSync(s.dots), false);
  assert.equal(await s.call("wallpaper.image"), null);
});

test("A second Draw it while one is still on its way is refused in a plain sentence and asks the model nothing", { timeout: 10000 }, async (t) => {
  // The fake holds its answer until let go, so the first draw is still on its way when the second comes.
  let letGo = () => {};
  const held = new Promise<void>((r) => (letGo = r));
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(req.url ?? "");
    req.resume();
    req.on("end", () => void held.then(() => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ b64_json: png(64, 40).toString("base64") }] }))));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const s = setup(`http://127.0.0.1:${(server.address() as { port: number }).port}/v1`);
  const first = s.call<{ model: string }>("wallpaper.draw", { prompt: "A harbour at dusk" });
  while (!seen.length) await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(s.call("wallpaper.draw", { prompt: "A harbour at dawn" }), /^Error: A picture is already being drawn for the dots\. Wait for it before asking for another\.$/);
  assert.equal(seen.length, 1, "the second was never sent, so never billed");
  letGo();
  // Whether sips is here to keep it or not, the first one's press is done and the next can be asked.
  await first.catch(() => null);
  letGo();
  const again = s.call("wallpaper.draw", { prompt: "A harbour at noon" }).catch((e: Error) => e);
  while (seen.length < 2) await new Promise((r) => setTimeout(r, 10));
  const r = await again;
  assert.equal(r instanceof Error && /already being drawn/.test(r.message), false, "once the first is done another can be drawn");
});

test("A picture from the model that can't be read says the model sent it, not to try a JPEG", { skip: mac }, async (t) => {
  // A PNG's first bytes and nothing a PNG reader can use: it passes as a picture but sips can't read it.
  const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]).toString("base64");
  const api = await fake(() => ({ status: 200, body: { data: [{ b64_json: broken }] } }));
  t.after(api.close);
  const s = setup(api.url);
  await assert.rejects(s.call("wallpaper.draw", { prompt: "A harbour at dusk" }), /^Error: ChatGPT Images sent a picture Liner Code couldn't read, so nothing was kept\.$/);
  assert.equal(existsSync(s.dots), false);
});
