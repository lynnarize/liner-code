/*
  The anonymous usage counts (usage-ping.ts): the count kept on disk, one ping a day at most, the off
  switch, what a ping says (and nothing more), whose tokens count, and that a test, a dev run or
  the engine from source never sends. Every send goes to an injected fetch or a server on this
  machine: nothing here reaches linercode.dev. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Settings, UsageRecord } from "../../contracts/src/index.ts";
import { counts, dayOf, PING_CAP, USAGE_URL, UsagePing, usageTarget } from "../src/usage-ping.ts";
import { Store } from "../src/store.ts";

const home = () => mkdtempSync(join(tmpdir(), "liner-usage-"));
const rec = (o: Partial<UsageRecord> = {}): UsageRecord => ({ at: Date.now(), threadId: "t1", projectId: "p1", agent: "a1", provider: "claude", model: "opus", inputTokens: 100, outputTokens: 40, cacheReadTokens: 900, costUsd: 0.1, seconds: 3, ...o });
const DAY = 86_400_000;
const T0 = Date.parse("2026-11-19T10:00:00Z");

/** A ping with a fake fetch: every request it was handed, and what it answers (a status, or a throw). */
function rig(o: { home?: string; settings?: Partial<Settings>; answer?: () => number; arch?: string } = {}) {
  const dir = o.home ?? home();
  const settings: Partial<Settings> = { ...o.settings };
  const sent: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  let now = T0;
  const fake = (async (url: string | URL, init?: RequestInit) => {
    sent.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) });
    const status = (o.answer ?? (() => 204))();
    if (status === 0) throw new TypeError("fetch failed");
    return new Response(status === 204 ? null : "no", { status });
  }) as typeof fetch;
  const make = () => new UsagePing({ home: dir, url: "https://usage.example/api/usage", version: "0.2.9", settings: () => settings as Settings, fetch: fake, now: () => now, platform: "darwin", arch: o.arch ?? "arm64" });
  return { dir, settings, sent, make, ping: make(), at: (t: number) => (now = t), kept: () => JSON.parse(readFileSync(join(dir, "usage.json"), "utf8")) };
}

test("the count is kept on disk, 0600, under a random id, and adds up across launches", () => {
  const r = rig();
  const id = r.kept().id;
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  if (process.platform !== "win32") assert.equal(statSync(join(r.dir, "usage.json")).mode & 0o777, 0o600);
  r.ping.add(rec());
  r.ping.add(rec({ outputTokens: 60, inputTokens: 0, cacheReadTokens: 0 }));
  assert.deepEqual([r.kept().out, r.kept().in], [100, 1000]);
  // A new engine on the same home: the same id, the same count, and it goes on from there.
  const again = r.make();
  again.add(rec({ outputTokens: 1, inputTokens: 1, cacheReadTokens: 0 }));
  assert.deepEqual([r.kept().id, r.kept().out, r.kept().in], [id, 101, 1001]);
  // Nothing about the machine, the user or the folder in the file.
  const text = readFileSync(join(r.dir, "usage.json"), "utf8");
  for (const s of [homedir(), r.dir, process.env.USER ?? "nobody-at-all"]) assert.ok(!text.includes(s), s);
});

test("a garbled file starts again with a new id rather than failing", () => {
  const dir = home();
  writeFileSync(join(dir, "usage.json"), "{nope");
  const r = rig({ home: dir });
  r.ping.add(rec());
  assert.match(r.kept().id, /^[0-9a-f-]{36}$/);
  assert.equal(r.kept().out, 40);
});

test("a ping says exactly id, v, os, arch, day, out and in, with a plain user agent, no redirects and no cookies", async () => {
  const r = rig();
  r.ping.add(rec());
  assert.equal(await r.ping.tick(), true);
  assert.equal(r.sent.length, 1);
  const { url, init, body } = r.sent[0];
  assert.equal(url, "https://usage.example/api/usage");
  assert.deepEqual(Object.keys(body).sort(), ["arch", "day", "id", "in", "os", "out", "v"]);
  assert.deepEqual(body, { id: r.kept().id, v: "0.2.9", os: "mac", arch: "arm64", day: "2026-11-19", out: 40, in: 1000 });
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  assert.equal(init.credentials, "omit");
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(init.headers, { "content-type": "application/json", "user-agent": "liner-code/0.2.9" });
  // What went is off the count; the day is kept.
  assert.deepEqual([r.kept().out, r.kept().in, r.kept().day], [0, 0, "2026-11-19"]);
});

test("once a day: a second look the same day sends nothing, the next day sends what was counted since", async () => {
  const r = rig();
  r.ping.add(rec());
  assert.equal(await r.ping.tick(), true);
  r.ping.add(rec({ outputTokens: 7, inputTokens: 3, cacheReadTokens: 0 }));
  r.at(T0 + 5 * 3_600_000);
  assert.equal(await r.ping.tick(), false);
  // A new engine the same day doesn't send either: the day is on disk.
  assert.equal(await r.make().tick(), false);
  assert.equal(r.sent.length, 1);
  r.at(T0 + DAY);
  const next = r.make();
  assert.equal(await next.tick(), true);
  assert.deepEqual([r.sent[1].body.day, r.sent[1].body.out, r.sent[1].body.in], ["2026-11-20", 7, 3]);
  assert.equal(r.sent[1].body.id, r.sent[0].body.id);
});

test("a failed send keeps the count, and isn't tried again within the hour", async () => {
  let status = 0;
  const r = rig({ answer: () => status });
  r.ping.add(rec());
  assert.equal(await r.ping.tick(), false);
  assert.equal(r.kept().out, 40);
  status = 500;
  r.at(T0 + 30 * 60_000);
  assert.equal(await r.ping.tick(), false);
  assert.equal(r.sent.length, 1, "no second try within the hour");
  r.at(T0 + 61 * 60_000);
  assert.equal(await r.ping.tick(), false);
  assert.equal(r.sent.length, 2);
  assert.equal(r.kept().out, 40, "a 500 keeps the count too");
  status = 204;
  r.ping.add(rec({ outputTokens: 2, inputTokens: 0, cacheReadTokens: 0 }));
  r.at(T0 + 125 * 60_000);
  assert.equal(await r.ping.tick(), true);
  assert.equal(r.sent[2].body.out, 42);
  assert.equal(r.kept().out, 0);
});

test("a heavy count goes at most the Worker's cap a day, the rest on the next day's", async () => {
  const r = rig();
  // Months offline with a heavy user's cache reads: more than the Worker takes in one ping.
  r.ping.add(rec({ outputTokens: 5e9, inputTokens: 0, cacheReadTokens: 2.5e12 }));
  assert.equal(await r.ping.tick(), true);
  assert.deepEqual([r.sent[0].body.out, r.sent[0].body.in], [5e9, PING_CAP]);
  assert.deepEqual([r.kept().out, r.kept().in], [0, 1.5e12]);
  r.at(T0 + DAY);
  assert.equal(await r.ping.tick(), true);
  assert.equal(r.sent[1].body.in, PING_CAP);
  assert.equal(r.kept().in, 5e11);
});

test("a refused ping (400) drops what it held and isn't sent again that day, said once; the next day's goes", async () => {
  let status = 400;
  const r = rig({ answer: () => status });
  const said: unknown[] = [];
  const was = console.error;
  console.error = (...a: unknown[]) => void said.push(a);
  try {
    r.ping.add(rec());
    assert.equal(await r.ping.tick(), false);
    assert.deepEqual([r.kept().out, r.kept().in, r.kept().day], [0, 0, "2026-11-19"], "dropped, and today is done");
    r.at(T0 + 2 * 3_600_000);
    assert.equal(await r.ping.tick(), false);
    assert.equal(r.sent.length, 1, "not sent again the same day");
    r.ping.add(rec());
    r.at(T0 + DAY);
    assert.equal(await r.ping.tick(), false);
    assert.equal(r.sent.length, 2);
    assert.equal(said.length, 1, "said once a run");
    status = 204;
    r.ping.add(rec({ outputTokens: 7, inputTokens: 0, cacheReadTokens: 0 }));
    r.at(T0 + 2 * DAY);
    assert.equal(await r.ping.tick(), true);
    assert.equal(r.sent[2].body.out, 7);
  } finally {
    console.error = was;
  }
});

test("a chip the Worker doesn't know by name goes as \"other\"", async () => {
  for (const arch of ["riscv64", "loong64", "s390x"]) {
    const r = rig({ arch });
    r.ping.add(rec());
    assert.equal(await r.ping.tick(), true);
    assert.equal(r.sent[0].body.arch, "other");
  }
  const r = rig({ arch: "x64" });
  r.ping.add(rec());
  await r.ping.tick();
  assert.equal(r.sent[0].body.arch, "x64");
});

test("a redirect is refused, against a real server on this machine, and the count stays", async () => {
  const server = createServer((_, res) => res.writeHead(302, { location: "http://127.0.0.1:1/elsewhere" }).end());
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  try {
    const dir = home();
    const port = (server.address() as { port: number }).port;
    const ping = new UsagePing({ home: dir, url: `http://127.0.0.1:${port}/api/usage`, version: "0.2.9", settings: () => ({}) as Settings });
    ping.add(rec());
    assert.equal(await ping.tick(), false);
    assert.equal(JSON.parse(readFileSync(join(dir, "usage.json"), "utf8")).out, 40);
  } finally {
    server.close();
  }
});

test("the off switch: nothing counted, nothing sent, and what was counted is dropped", async () => {
  const r = rig();
  r.ping.add(rec());
  const id = r.kept().id;
  r.settings.usagePing = false;
  r.ping.off();
  assert.deepEqual(r.kept(), { id, out: 0, in: 0 });
  r.ping.add(rec());
  assert.equal(r.kept().out, 0);
  assert.equal(await r.ping.tick(), false);
  assert.equal(r.sent.length, 0);
  // Off since the last run: a new engine drops whatever is in the file.
  writeFileSync(join(r.dir, "usage.json"), JSON.stringify({ id, out: 5, in: 5 }));
  r.make();
  assert.deepEqual(r.kept(), { id, out: 0, in: 0 });
  // On again: it counts from nothing, under the same id.
  r.settings.usagePing = true;
  const on = r.make();
  on.add(rec());
  assert.equal(await on.tick(), true);
  assert.deepEqual([r.sent[0].body.id, r.sent[0].body.out], [id, 40]);
});

test("switched off while a ping goes: the count stays dropped", async () => {
  let release!: () => void;
  const dir = home();
  const settings: Partial<Settings> = {};
  const fake = (() => new Promise<Response>((ok) => (release = () => ok(new Response(null, { status: 204 }))))) as unknown as typeof fetch;
  const ping = new UsagePing({ home: dir, url: "https://usage.example/api/usage", version: "0.2.9", settings: () => settings as Settings, fetch: fake, platform: "darwin" });
  ping.add(rec());
  const going = ping.tick();
  settings.usagePing = false;
  ping.off();
  release();
  await going;
  const kept = JSON.parse(readFileSync(join(dir, "usage.json"), "utf8"));
  assert.deepEqual([kept.out, kept.in, kept.day], [0, 0, undefined]);
});

test("whose tokens count: not the Demo's, not Check my tools', not an endpoint on this machine", () => {
  const settings = { endpoints: [
    { id: "api-local", label: "Ollama", url: "http://localhost:11434/v1", protocol: "responses" as const, models: ["qwen"] },
    { id: "api-fake", label: "Fake", url: "http://127.0.0.1:4010/anthropic", protocol: "anthropic" as const, models: ["m"] },
    { id: "api-deepseek", label: "DeepSeek", url: "https://api.deepseek.com/anthropic", protocol: "anthropic" as const, models: ["deepseek-chat"] },
  ] };
  assert.equal(counts(rec({ provider: "demo" }), settings), false);
  assert.equal(counts(rec({ agent: "check" }), settings), false);
  assert.equal(counts(rec({ provider: "codex.api-local" }), settings), false);
  assert.equal(counts(rec({ provider: "claude.api-fake" }), settings), false);
  assert.equal(counts(rec({ provider: "claude.api-deepseek" }), settings), true);
  assert.equal(counts(rec({ provider: "claude" }), settings), true);
  assert.equal(counts(rec({ provider: "claude.work", agent: "sidekick" }), settings), true);
  const r = rig({ settings });
  r.ping.add(rec({ provider: "demo" }));
  r.ping.add(rec({ agent: "check", provider: "codex" }));
  r.ping.add(rec({ provider: "codex.api-local" }));
  assert.deepEqual([r.kept().out, r.kept().in], [0, 0]);
  r.ping.add(rec({ provider: "opencode", outputTokens: 9, inputTokens: 1, cacheReadTokens: 0 }));
  assert.deepEqual([r.kept().out, r.kept().in], [9, 1]);
  // Odd numbers never make the count odd.
  r.ping.add(rec({ outputTokens: Number.NaN, inputTokens: -5, cacheReadTokens: 2.6 }));
  assert.deepEqual([r.kept().out, r.kept().in], [9, 4]);
});

test("the store hands each record over as it's logged", () => {
  const dir = home();
  const store = new Store(dir);
  const seen: UsageRecord[] = [];
  store.counted = (r) => void seen.push(r);
  store.logUsage(rec());
  assert.equal(seen.length, 1);
  assert.equal(seen[0].outputTokens, 40);
});

test("a test, a dev run, the engine from source, a temp home or LINER_NO_USAGE=1 never sends", () => {
  const real = join(homedir(), ".liner-code-never-made");
  const plain = { env: {}, home: real, dev: false, bundled: true };
  assert.equal(usageTarget(plain), USAGE_URL);
  assert.equal(usageTarget({ ...plain, dev: true }), undefined);
  assert.equal(usageTarget({ ...plain, bundled: false }), undefined);
  assert.equal(usageTarget({ ...plain, env: { NODE_ENV: "test" } }), undefined);
  assert.equal(usageTarget({ ...plain, env: { NODE_TEST_CONTEXT: "child" } }), undefined);
  assert.equal(usageTarget({ ...plain, env: { LINER_NO_USAGE: "1" } }), undefined);
  assert.equal(usageTarget({ ...plain, home: home() }), undefined);
  if (process.platform !== "win32") assert.equal(usageTarget({ ...plain, home: "/tmp/liner-x" }), undefined);
  // This very run, as main.ts asks it: nowhere.
  assert.equal(usageTarget({ env: process.env, home: home(), dev: false, bundled: false }), undefined);
  // A check's fake server on this machine is honoured, even from source; anything else in LINER_USAGE_URL is ignored.
  assert.equal(usageTarget({ ...plain, bundled: false, env: { LINER_USAGE_URL: "http://127.0.0.1:4555/api/usage" } }), "http://127.0.0.1:4555/api/usage");
  assert.equal(usageTarget({ ...plain, bundled: false, env: { LINER_USAGE_URL: "https://elsewhere.example/api/usage" } }), undefined);
  assert.equal(usageTarget({ ...plain, env: { LINER_USAGE_URL: "https://elsewhere.example/api/usage" } }), USAGE_URL);
  assert.equal(usageTarget({ ...plain, env: { LINER_USAGE_URL: "http://127.0.0.1:4555/", LINER_NO_USAGE: "1" } }), undefined);
  assert.ok(!existsSync(real));
});

test("days are UTC", () => {
  assert.equal(dayOf(Date.parse("2026-11-19T23:59:59Z")), "2026-11-19");
  assert.equal(dayOf(Date.parse("2026-11-20T00:00:00Z")), "2026-11-20");
});
