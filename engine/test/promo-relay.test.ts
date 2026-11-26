/*
  The promo's relay (promo.ts): the voucher stays in the engine. OpenCode is pointed at the engine's
  own /promo/v1 with a key made for this run, and the engine sends each call on to Liner Code's site
  with the voucher. A real OpenCode (2.4.1) printed the voucher from its shell while it held it.
  Run with `node --test engine/test/promo-relay.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { ProviderInfo } from "../../contracts/src/index.ts";
import { endpointKey, VOUCHER } from "../../contracts/src/index.ts";
import { KEY_VAR } from "../src/providers/endpoint.ts";
import type { OpenOptions, Provider, ProviderSession } from "../src/providers/types.ts";
import { PROMO_PATH, PromoRelay } from "../src/promo.ts";
import { providers, syncProviders } from "../src/runtime.ts";
import { startServer } from "../src/server.ts";
import { defaultSettings } from "../src/store.ts";

/** A stand-in for Liner Code's site: what it was asked, and a streamed answer. */
async function fakeSite() {
  const asked: { method: string; url: string; headers: IncomingHttpHeaders; body: string }[] = [];
  const site = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      asked.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      if (req.url?.endsWith("/models")) return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "deepseek-v4.1-flash" }] }));
      res.writeHead(200, { "content-type": "text/event-stream", "set-cookie": "site=1" });
      res.write('data: {"choices":[{"delta":{"content":"he"}}]}\n\n');
      setTimeout(() => res.end('data: {"choices":[{"delta":{"content":"llo"}}]}\n\ndata: [DONE]\n\n'), 20);
    });
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  const a = site.address();
  return { asked, url: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}/api/code/v1`, close: () => site.close() };
}

/** The engine's server with the relay on it, as main.ts starts it. */
async function engineWith(relay: PromoRelay) {
  const store = { on() {}, emit() {} } as never;
  const server = await startServer({ store, api: { call: async () => null, ready: Promise.resolve() }, snapshot: async () => ({}) as never, token: "app-token", port: 0, promo: (rest, req, res) => relay.serve(rest, req, res) });
  relay.url = `http://127.0.0.1:${server.port}`;
  return server;
}

const chat = JSON.stringify({ model: "deepseek-v4.1-flash", stream: true, messages: [{ role: "user", content: "hi" }] });

test("promo relay: a promo session's tool is pointed at the engine with this run's key, and nothing it is given holds the voucher", () => {
  const relay = new PromoRelay(() => "v-secret");
  relay.url = "http://127.0.0.1:4555";
  const keys = new Map([[endpointKey(VOUCHER.id), "v-secret"]]);
  let given: OpenOptions | undefined;
  const real = providers.opencode;
  const base: Provider = { id: "opencode", detect: async () => ({}) as ProviderInfo, open: (o) => ((given = o), { turn: async () => {}, close() {} }) as ProviderSession };
  providers.opencode = base;
  try {
    syncProviders({ ...defaultSettings, voucher: true }, keys, relay);
    providers[`opencode.${VOUCHER.id}`].open({ cwd: "/p", model: "deepseek-v4.1-flash", effort: "medium", access: "edits", soul: "", guard: false, env: { PATH: "/usr/bin" } });
  } finally {
    providers.opencode = real;
    syncProviders(defaultSettings, keys);
  }
  assert.ok(given, "the session opened");
  assert.equal(given.env[KEY_VAR], relay.token, "the tool's key is the relay's");
  const config = JSON.parse(String(given.env.OPENCODE_CONFIG_CONTENT));
  assert.equal(config.provider.liner_voucher.options.baseURL, `http://127.0.0.1:4555${PROMO_PATH}`);
  assert.ok(!JSON.stringify({ env: given.env, config: given.config }).includes("v-secret"), "the voucher is nowhere in what the tool gets");
});

test("promo relay: with no relay listening yet, a promo session doesn't open, rather than open with the voucher", () => {
  const relay = new PromoRelay(() => "v-secret");
  const keys = new Map([[endpointKey(VOUCHER.id), "v-secret"]]);
  const real = providers.opencode;
  let opened = false;
  providers.opencode = { id: "opencode", detect: async () => ({}) as ProviderInfo, open: () => ((opened = true), { turn: async () => {}, close() {} }) as ProviderSession };
  try {
    syncProviders({ ...defaultSettings, voucher: true }, keys, relay);
    assert.throws(() => providers[`opencode.${VOUCHER.id}`].open({ cwd: "/p", model: "deepseek-v4.1-flash", effort: "medium", access: "edits", soul: "", guard: false, env: {} }), /isn't ready/);
  } finally {
    providers.opencode = real;
    syncProviders(defaultSettings, keys);
  }
  assert.equal(opened, false);
});

test("promo relay: a call with this run's key goes on to the site with the voucher as its key, and its stream comes back as it is made", async (t) => {
  const site = await fakeSite();
  const relay = new PromoRelay(() => "v-secret");
  relay.upstream = site.url;
  const server = await engineWith(relay);
  t.after(() => (server.close(), site.close()));

  const r = await fetch(`${relay.url}${PROMO_PATH}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${relay.token}`, "content-type": "application/json", accept: "text/event-stream" }, body: chat });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/event-stream");
  assert.equal(r.headers.get("set-cookie"), null, "the site's cookies stay behind");
  const text = await r.text();
  assert.match(text, /"he".*"llo".*\[DONE\]/s);
  assert.equal(site.asked.length, 1);
  assert.equal(site.asked[0].url, "/api/code/v1/chat/completions");
  assert.equal(site.asked[0].headers.authorization, "Bearer v-secret");
  assert.equal(site.asked[0].body, chat);

  const m = await fetch(`${relay.url}${PROMO_PATH}/models`, { headers: { authorization: `Bearer ${relay.token}` } });
  assert.deepEqual(await m.json(), { data: [{ id: "deepseek-v4.1-flash" }] });
});

test("promo relay: without this run's key, or past the two calls OpenCode makes, nothing is read and nothing reaches the site", async (t) => {
  const site = await fakeSite();
  let voucher: string | undefined = "v-secret";
  const relay = new PromoRelay(() => voucher);
  relay.upstream = site.url;
  const server = await engineWith(relay);
  t.after(() => (server.close(), site.close()));
  const at = (path: string, init: RequestInit = {}) => fetch(`${relay.url}${PROMO_PATH}${path}`, init);
  const post = (key: string) => ({ method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: chat });

  assert.equal((await at("/chat/completions", { method: "POST", body: chat })).status, 401, "no key");
  assert.equal((await at("/chat/completions", post("app-token"))).status, 401, "the app's own token isn't this one");
  assert.equal((await at("/chat/completions", post("v-secret"))).status, 401, "nor is the voucher");
  assert.equal((await at("/chat/completions", post(`${relay.token}x`))).status, 401);
  assert.equal((await at("/usage", { headers: { authorization: `Bearer ${relay.token}` } })).status, 404, "the site's other routes aren't reached");
  assert.equal((await at("/../usage", { headers: { authorization: `Bearer ${relay.token}` } })).status, 404);
  assert.equal((await at("/chat/completions", { headers: { authorization: `Bearer ${relay.token}` } })).status, 404, "a chat is a POST");
  voucher = undefined;
  const off = await at("/chat/completions", post(relay.token));
  assert.equal(off.status, 401, "a voucher removed in Settings stops the next call");
  assert.match(JSON.stringify(await off.json()), /No voucher/);
  assert.equal(site.asked.length, 0);
});

test("promo relay: a page that names itself 127.0.0.1 (DNS rebinding) isn't answered", async (t) => {
  const site = await fakeSite();
  const relay = new PromoRelay(() => "v-secret");
  relay.upstream = site.url;
  const server = await engineWith(relay);
  t.after(() => (server.close(), site.close()));
  const { request } = await import("node:http");
  const status = await new Promise<number>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.port, path: `${PROMO_PATH}/chat/completions`, method: "POST", headers: { host: "evil.example:80", authorization: `Bearer ${relay.token}`, "content-type": "application/json" } }, (res) => (res.resume(), resolve(res.statusCode ?? 0)));
    req.on("error", reject);
    req.end(chat);
  });
  assert.equal(status, 403);
  assert.equal(site.asked.length, 0);
});

test("promo relay: the promo's model reads in the picker as Liner Code's, free within the voucher's limits, never as OpenCode's", async () => {
  const keys = new Map([[endpointKey(VOUCHER.id), "v-secret"]]);
  const real = providers.opencode;
  providers.opencode = { id: "opencode", detect: async () => ({ available: true }) as ProviderInfo, open: () => ({ turn: async () => {}, close() {} }) as ProviderSession };
  try {
    syncProviders({ ...defaultSettings, voucher: true }, keys, new PromoRelay(() => "v-secret"));
    const info = await providers[`opencode.${VOUCHER.id}`].detect({ PATH: "/usr/bin" });
    assert.equal(info.label, "Promo");
    const [m] = info.models;
    assert.equal(m.label, "DeepSeek V4.1 Flash");
    assert.equal(m.description, "Liner Code's promo, with your voucher");
    assert.deepEqual([m.price?.input, m.price?.output], ["$0", "$0"]);
    assert.match(m.price?.note ?? "", /5-hour and weekly/);
  } finally {
    providers.opencode = real;
    syncProviders(defaultSettings, keys);
  }
});
