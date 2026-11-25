import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hermes, opencode } from "../src/providers/acp.ts";
import { createApi } from "../src/api.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

/** A home where OpenCode signed in with a Go key and Hermes keeps one in its .env, and a fetch that counts what reaches opencode.ai. */
function setUp(t: { after: (f: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "liner-go-key-"));
  mkdirSync(join(dir, "data", "opencode"), { recursive: true });
  writeFileSync(join(dir, "data", "opencode", "auth.json"), JSON.stringify({ "opencode-go": { type: "api", key: "go-key-from-opencode" } }));
  mkdirSync(join(dir, "hermes"));
  writeFileSync(join(dir, "hermes", ".env"), "OPENCODE_GO_API_KEY=go-key-from-hermes\n");
  const env: NodeJS.ProcessEnv = { HOME: dir, XDG_DATA_HOME: join(dir, "data"), OPENCODE_DB: ":memory:", HERMES_HOME: join(dir, "hermes") };
  const sent: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sent.push(String((init?.headers as Record<string, string>)?.authorization));
    return new Response(JSON.stringify({ usage: { rolling: { percent: 12 }, weekly: { percent: 30 } } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = real;
    rmSync(dir, { recursive: true, force: true });
  });
  return { env, dir, sent };
}

test("OpenCode's saved Go key is neither read nor sent to opencode.ai until the person agrees, and is once they do", async (t) => {
  const { env, dir, sent } = setUp(t);
  assert.equal(await opencode.limits!(env, dir), null);
  assert.equal(await opencode.limits!(env, dir, { readGoKey: false }), null);
  assert.deepEqual(sent, []);
  const r = await opencode.limits!(env, dir, { readGoKey: true });
  assert.equal(r?.windows.length, 2);
  assert.deepEqual(sent, ["Bearer go-key-from-opencode"]);
});

test("Hermes's Go key in its .env is neither read nor sent to opencode.ai until the person agrees, and is once they do", async (t) => {
  const { env, dir, sent } = setUp(t);
  assert.equal(await hermes.limits!(env, dir), null);
  assert.deepEqual(sent, []);
  const r = await hermes.limits!(env, dir, { readGoKey: true });
  assert.equal(r?.plan, "OpenCode Go");
  assert.deepEqual(sent, ["Bearer go-key-from-hermes"]);
});

test("Go's windows asked for with the key don't come back once the person takes their consent back while the ask is still out", async (t) => {
  const off = (id: string) => ({ id, label: id, available: false, adapter: false, login: "", models: [], supports: { approvals: false, resume: false, effort: false, plan: false } });
  const all = Object.values(providers) as { id: string; detect: unknown; limits: unknown }[];
  const saved = all.map((p) => ({ p, detect: p.detect, limits: p.limits }));
  t.after(() => saved.forEach((s) => Object.assign(s.p, { detect: s.detect, limits: s.limits })));
  for (const p of all) if (p.id !== "opencode") Object.assign(p, { detect: async () => off(p.id), limits: undefined });
  const asked: boolean[] = [];
  let release = () => {};
  Object.assign(providers.opencode, {
    detect: async () => ({ ...off("opencode"), label: "OpenCode", available: true, adapter: true }),
    limits: async (_e: unknown, _s: unknown, o?: { readGoKey?: boolean }) => {
      asked.push(o?.readGoKey === true);
      if (!o?.readGoKey) return null;
      await new Promise<void>((r) => (release = r));
      return { plan: "Go", windows: [{ label: "5h", percent: 42 }], models: "opencode-go" };
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "liner-go-key-api-"));
  const store = new Store(dir);
  const env = { PATH: "/nonexistent", HOME: dir } as NodeJS.ProcessEnv;
  const runtime = new Runtime(store, env);
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [], put: () => undefined, remove: () => undefined }, terms: {}, logs: {}, proxies: {} } as never);
  t.after(() => (api.updates.stop(), runtime.shutdown()));
  const call = (m: string, p: unknown) => api.call(m, p) as Promise<{ tools: { provider: string; windows: unknown[] }[] }>;
  const until = async (f: () => boolean) => {
    for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(f());
  };
  await until(() => asked.length === 1);
  await call("settings.save", { readGoKey: true });
  await until(() => asked.length === 2 && asked[1]);
  await call("settings.save", { readGoKey: false });
  release();
  await new Promise((r) => setTimeout(r, 50));
  const r = await call("usage.limits", {});
  assert.deepEqual(r.tools.filter((x) => x.provider === "opencode" && x.windows.length), [], "no Go windows read with a key the person no longer lets Liner read");
});
