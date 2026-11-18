/*
  The Worker's /api/usage, against a fake env (no Cloudflare, no network): what passes and what's
  refused, that a point holds only the ping's fields (never the address or a header), that an older
  deploy without the dataset still answers 204, and that the promo's routes answer as they did.
  Run with `node --test site/worker/usage.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./index.ts";

type Point = { blobs?: string[]; doubles?: number[]; indexes?: string[] };
const fakeEnv = (o: { usage?: boolean } = {}) => {
  const points: Point[] = [];
  const assets: string[] = [];
  const env = {
    ASSETS: { fetch: async (r: Request) => (assets.push(new URL(r.url).pathname), new Response("page")) },
    LINER_CODE_VOUCHERS: "promo-one",
    ...(o.usage === false ? {} : { USAGE: { writeDataPoint: (p: Point) => void points.push(p) } }),
  };
  return { env, points, assets };
};

const today = () => new Date().toISOString().slice(0, 10);
const good = () => ({ id: "0b8f4c1e-7d2a-4c3b-9e5f-1a2b3c4d5e6f", v: "0.2.9", os: "mac", arch: "arm64", day: today(), out: 1234, in: 56789 });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://linercode.dev/api/usage", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", "user-agent": "liner-code/0.2.9", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("a good ping is one data point of its own fields, and a 204", async () => {
  const { env, points } = fakeEnv();
  const r = await worker.fetch(post(good()), env);
  assert.equal(r.status, 204);
  assert.equal(await r.text(), "");
  assert.deepEqual(points, [{ blobs: [good().id, "0.2.9", "mac", "arm64", today()], doubles: [1234, 56789], indexes: [good().id] }]);
  // Nothing of the request beyond the ping: not the address, not the user agent.
  assert.ok(!JSON.stringify(points).includes("203.0.113.9"));
  assert.ok(!JSON.stringify(points).includes("liner-code/"));
});

test("in is optional, and yesterday (UTC) passes too", async () => {
  const { env, points } = fakeEnv();
  const { in: _in, ...rest } = good();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  assert.equal((await worker.fetch(post({ ...rest, day: yesterday }), env)).status, 204);
  assert.deepEqual(points[0].doubles, [1234, 0]);
  assert.equal(points[0].blobs![4], yesterday);
});

test("a heavy day (cache reads in the billions) and a chip outside the list as \"other\" pass", async () => {
  const { env, points } = fakeEnv();
  assert.equal((await worker.fetch(post({ ...good(), out: 3e9, in: 1e12 }), env)).status, 204);
  assert.equal((await worker.fetch(post({ ...good(), arch: "other" }), env)).status, 204);
  assert.deepEqual(points[0].doubles, [3e9, 1e12]);
  assert.equal(points[1].blobs![3], "other");
});

test("anything that isn't a ping is a 400, and nothing is kept", async () => {
  const { env, points } = fakeEnv();
  const bad: unknown[] = [
    { ...good(), id: "not-a-uuid" },
    { ...good(), id: "0B8F4C1E-7D2A-4C3B-9E5F-1A2B3C4D5E6F" },
    { ...good(), v: "latest" },
    { ...good(), v: "0.2.9; drop table" },
    { ...good(), os: "android" },
    { ...good(), arch: "riscv" },
    { ...good(), day: "2020-01-01" },
    { ...good(), day: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) },
    { ...good(), out: -1 },
    { ...good(), out: 1.5 },
    { ...good(), out: 2e12 },
    { ...good(), in: 1e12 + 1 },
    { ...good(), out: "12" },
    { ...good(), in: -3 },
    { ...good(), prompt: "hello" },
    { ...good(), ip: "1.2.3.4" },
    (({ out: _o, ...r }) => r)(good()),
    [good()],
    null,
    "{not json",
    "",
  ];
  for (const b of bad) assert.equal((await worker.fetch(post(b), env)).status, 400, JSON.stringify(b));
  // Not JSON, or too big.
  assert.equal((await worker.fetch(post(good(), { "content-type": "text/plain" }), env)).status, 400);
  assert.equal((await worker.fetch(post({ ...good(), pad: "x".repeat(2000) }), env)).status, 400);
  assert.equal((await worker.fetch(post(JSON.stringify(good()) + " ".repeat(1100)), env)).status, 400);
  assert.equal(points.length, 0);
});

test("only POST", async () => {
  const { env, points } = fakeEnv();
  for (const method of ["GET", "PUT", "DELETE"]) {
    const r = await worker.fetch(new Request("https://linercode.dev/api/usage", { method }), env);
    assert.equal(r.status, 405);
    assert.equal(r.headers.get("allow"), "POST");
  }
  assert.equal(points.length, 0);
});

test("an older deploy without the dataset still answers 204", async () => {
  const { env } = fakeEnv({ usage: false });
  assert.equal((await worker.fetch(post(good()), env)).status, 204);
});

test("a dataset that throws still answers 204", async () => {
  const { env } = fakeEnv();
  env.USAGE!.writeDataPoint = () => {
    throw new Error("down");
  };
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal((await worker.fetch(post(good()), env)).status, 204);
  } finally {
    console.error = quiet;
  }
});

test("the promo's routes and the site answer as they did", async () => {
  const { env, points, assets } = fakeEnv();
  const models = (auth?: string) => new Request("https://linercode.dev/api/code/v1/models", { headers: auth ? { authorization: auth } : {} });
  assert.equal((await worker.fetch(models(), env)).status, 401);
  assert.equal((await worker.fetch(models("Bearer nope"), env)).status, 401);
  const ok = await worker.fetch(models("Bearer PROMO-ONE"), env);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { object: "list", data: [{ id: "deepseek-v4.1-flash", object: "model", owned_by: "liner" }] });
  // The chat with a good voucher but no Go key: the promo isn't set up (503), never sent anywhere.
  const quiet = console.error;
  console.error = () => {};
  const chat = await worker.fetch(new Request("https://linercode.dev/api/code/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer promo-one", "content-type": "application/json" }, body: JSON.stringify({ messages: [] }) }), env).finally(() => (console.error = quiet));
  assert.equal(chat.status, 503);
  assert.equal((await worker.fetch(new Request("https://linercode.dev/api/code/v1/models", { method: "POST", headers: { authorization: "Bearer promo-one" } }), env)).status, 405);
  assert.equal((await worker.fetch(new Request("https://linercode.dev/api/nothing"), env)).status, 404);
  assert.equal(await (await worker.fetch(new Request("https://linercode.dev/download"), env)).text(), "page");
  assert.deepEqual(assets, ["/download"]);
  assert.equal(points.length, 0);
});
