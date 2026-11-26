/*
  Tell an app: a session that starts waiting on you sends one line to your https address, with its title and nothing from
  the session, the secret as a bearer token, two more tries when it fails, and none at all to an http address, this
  computer or a private network.
  Run with `node --test engine/test/mcp-webhook.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { Webhook, webhookOk } from "../src/mcp-webhook.ts";

/** A name that looks up to an address on the internet (TEST-NET-3), so no test asks real DNS. */
const PUBLIC = async () => ["203.0.113.7"];

const thread = (status: Thread["status"]) => ({ id: "th_1", projectId: "p", title: "Tide chart", agent: "a", status, access: "ask", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 }) as Thread;

test("A session that starts waiting sends one line with its title and no words from the session", async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  const hook = new Webhook({ url: () => "https://bot.example/hook", secret: () => "s3cret", fetch: (async (url: string, init: RequestInit) => (sent.push({ url, init }), new Response("ok"))) as typeof fetch, delays: [], lookup: PUBLIC });
  hook.hear({ type: "thread", thread: thread("running") });
  hook.hear({ type: "thread", thread: thread("waiting") });
  hook.hear({ type: "thread", thread: thread("waiting") });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent.length, 1, "once per wait");
  assert.equal(sent[0].url, "https://bot.example/hook");
  assert.deepEqual(JSON.parse(String(sent[0].init.body)), { event: "needs_you", session: "Tide chart", app: "Liner Code" });
  assert.equal((sent[0].init.headers as Record<string, string>).authorization, "Bearer s3cret");
  assert.equal(sent[0].init.redirect, "error");
});

test("A failed post is tried twice more, then dropped quietly", async () => {
  let tries = 0;
  const logs: string[] = [];
  const hook = new Webhook({ url: () => "https://bot.example/hook", secret: () => undefined, fetch: (async () => (tries++, new Response("no", { status: 500 }))) as typeof fetch, delays: [1, 1], log: (l) => logs.push(l), lookup: PUBLIC });
  assert.equal(await hook.tell("Tide chart"), false);
  assert.equal(tries, 3);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /Tide chart/);
});

test("Only an https address without a user or password is posted to", async () => {
  assert.equal(webhookOk("http://bot.example/hook"), null);
  assert.equal(webhookOk("https://u:p@bot.example/hook"), null);
  assert.ok(webhookOk("https://bot.example/hook"));
  let tries = 0;
  const hook = new Webhook({ url: () => "http://bot.example/hook", secret: () => undefined, fetch: (async () => (tries++, new Response("ok"))) as typeof fetch, delays: [] });
  assert.equal(await hook.tell("x"), false);
  assert.equal(tries, 0);
});

test("A webhook on this computer or a private network is refused, by its address and by what its name looks up to", async () => {
  for (const u of ["https://127.0.0.1/hook", "https://[::1]/hook", "https://localhost/hook", "https://localhost./hook", "https://app.localhost/hook", "https://10.0.0.5/hook", "https://172.16.4.1/hook", "https://192.168.1.10/hook", "https://169.254.169.254/latest", "https://[fd00::1]/hook", "https://[fe80::1]/hook", "https://[::ffff:10.0.0.1]/hook", "https://0x7f000001/hook"]) assert.equal(webhookOk(u), null, u);
  assert.ok(webhookOk("https://203.0.113.7/hook"), "an address on the internet is fine");
  let tries = 0;
  const logs: string[] = [];
  const hook = new Webhook({ url: () => "https://bot.example/hook", secret: () => "s3cret", fetch: (async () => (tries++, new Response("ok"))) as typeof fetch, delays: [1, 1], log: (l) => logs.push(l), lookup: async () => ["192.168.1.20"] });
  assert.equal(await hook.tell("Tide chart"), false);
  assert.equal(tries, 0, "nothing was posted, and the secret went nowhere");
  assert.match(logs[0] ?? "", /private network/);
});
