/*
  Plan windows: OpenCode Go's, read from opencode.ai with a Go key (fetch is stubbed here, so no
  key leaves the test), and where the keys come from. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goKeys, goUsage, hermesGoKey, isGo } from "../src/providers/opencode-go.ts";

const real = globalThis.fetch;
/** Answers each call in turn with a status and a body, and keeps what was asked. */
function stub(answers: { status: number; body?: unknown }[]) {
  const asked: { url: string; auth: string | null }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    asked.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
    const a = answers.shift() ?? { status: 500 };
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return asked;
}

test("limits: OpenCode Go's three windows, the 5-hour and the week marked, the reset read from its time", async (t) => {
  t.after(() => void (globalThis.fetch = real));
  const asked = stub([{ status: 200, body: { usage: { rolling: { status: "ok", percent: 5, resetsAt: "2026-11-02T06:00:12.000Z" }, weekly: { status: "ok", percent: 41, resetsAt: "2026-11-09T00:00:00.000Z" }, monthly: { status: "ok", percent: 117, resetsAt: "2026-11-28T11:29:15.000Z" } } } }]);
  const w = await goUsage(["sk-go"]);
  assert.deepEqual(asked, [{ url: "https://opencode.ai/zen/go/v1/usage", auth: "Bearer sk-go" }]);
  assert.deepEqual(w, [
    { label: "5-hour window", kind: "session", minutes: 300, usedPercent: 5, resetsAt: Date.parse("2026-11-02T06:00:12.000Z") },
    { label: "Weekly", kind: "weekly", minutes: 10080, usedPercent: 41, resetsAt: Date.parse("2026-11-09T00:00:00.000Z") },
    { label: "Monthly", kind: "monthly", usedPercent: 100, resetsAt: Date.parse("2026-11-28T11:29:15.000Z") },
  ]);
});

test("limits: a key opencode.ai turns away tries the next; none of them a Go key means no Go plan", async (t) => {
  t.after(() => void (globalThis.fetch = real));
  const asked = stub([{ status: 401 }, { status: 200, body: { usage: { rolling: { percent: 12, resetsAt: "2026-11-02T06:00:00Z" } } } }]);
  assert.equal((await goUsage(["sk-zen", "sk-go"]))?.[0].usedPercent, 12);
  assert.deepEqual(asked.map((a) => a.auth), ["Bearer sk-zen", "Bearer sk-go"]);
  stub([{ status: 401 }, { status: 403 }]);
  assert.equal(await goUsage(["a", "b"]), null);
});

test("limits: anything else that goes wrong says so", async (t) => {
  t.after(() => void (globalThis.fetch = real));
  stub([{ status: 503 }]);
  await assert.rejects(goUsage(["sk-go"]), /answered 503/);
  stub([{ status: 200, body: { something: "else" } }]);
  await assert.rejects(goUsage(["sk-go"]), /shape/);
});

test("limits: Go's keys come from OpenCode's auth.json or OPENCODE_API_KEY, and Hermes's from its .env", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-limits-"));
  mkdirSync(join(home, ".local", "share", "opencode"), { recursive: true });
  writeFileSync(join(home, ".local", "share", "opencode", "auth.json"), JSON.stringify({ "opencode-go": { type: "api", key: " sk-go " }, opencode: { type: "oauth" } }));
  assert.deepEqual(goKeys({ HOME: home, OPENCODE_DB: ":memory:" }), ["sk-go"]);
  assert.deepEqual(goKeys({ HOME: join(home, "nobody"), OPENCODE_DB: ":memory:", OPENCODE_API_KEY: "sk-env" }), ["sk-env"]);
  mkdirSync(join(home, ".hermes"));
  writeFileSync(join(home, ".hermes", ".env"), 'NOUS_API_KEY=x\nexport OPENCODE_GO_API_KEY="sk-hermes"\n');
  assert.equal(hermesGoKey({ HOME: home }), "sk-hermes");
  assert.equal(hermesGoKey({ HOME: home, OPENCODE_GO_API_KEY: "sk-own" }), "sk-own");
  assert.equal(hermesGoKey({ HOME: join(home, "nobody") }), undefined);
});

test("limits: an endpoint is OpenCode Go by its address", () => {
  assert.equal(isGo("https://opencode.ai/zen/go/v1"), true);
  assert.equal(isGo("https://opencode.ai/inference/go/openai/v1/"), true);
  assert.equal(isGo("https://opencode.ai/zen/v1"), false);
  assert.equal(isGo("https://api.example.com/go/v1"), false);
});
