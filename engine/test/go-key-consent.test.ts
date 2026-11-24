import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hermes, opencode } from "../src/providers/acp.ts";

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
