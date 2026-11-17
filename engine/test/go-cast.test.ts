/*
  OpenCode Go listed once: while OpenCode has Go itself, casting (castOf, reviewerOf, startOf,
  shortlistOf) never chooses one of Go's models through another tool (Hermes, with a Go key), also
  when handed only some tools and told of `every` one; a pick you saved on one still stands. With
  no Go in OpenCode, Hermes's Go models are chosen as before. A session out of Go's allowance
  never falls back to Go through another tool (fallbackFor). Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelInfo, ProviderInfo } from "../../contracts/src/index.ts";
import { castOf, isGoModel, listedHere, openCodeHasGo, reviewerOf, shortlistOf, startOf } from "../../contracts/src/index.ts";
import { Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

const info = (id: ProviderInfo["id"], models: (string | ModelInfo)[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => (typeof m === "string" ? { id: m, label: m, description: "" } : m)), supports: { approvals: true, resume: true, effort: true, plan: true } });

// Hermes first, so a walk down the providers meets its Go models before OpenCode's.
const hermes = info("hermes", ["opencode-go/deepseek-v4-flash", "opencode-go/glm-5", { id: "kimi-k3", label: "Kimi K3", description: "", group: "OpenCode Go" }, "nous/hermes-4-405b"]);
const withGo = info("opencode", ["opencode-go/deepseek-v4-flash", "opencode-go/glm-5", "opencode/big-pickle"]);
const noGo = info("opencode", ["opencode/big-pickle"]);
const throughHermes = (ref: string | null | undefined) => Boolean(ref && ref.startsWith("hermes:") && (ref.includes("opencode-go/") || ref.endsWith(":kimi-k3")));

test("Go's models, by id or by source; OpenCode has Go only when an OpenCode tool that is ready reports one", () => {
  assert.equal(isGoModel({ id: "opencode-go/glm-5" }), true);
  assert.equal(isGoModel({ id: "kimi-k3", group: "OpenCode Go" }), true);
  assert.equal(isGoModel({ id: "opencode/big-pickle", group: "OpenCode" }), false);
  assert.equal(openCodeHasGo([hermes, withGo]), true);
  assert.equal(openCodeHasGo([hermes, noGo]), false);
  assert.equal(openCodeHasGo([hermes, { ...withGo, available: false }]), false, "an OpenCode that isn't ready has nothing");
  assert.equal(listedHere("hermes", { id: "opencode-go/glm-5" }, true), false);
  assert.equal(listedHere("opencode", { id: "opencode-go/glm-5" }, true), true);
  assert.equal(listedHere("hermes", { id: "opencode-go/glm-5" }, false), true);
});

test("OpenCode with Go and Hermes with Go: nothing is chosen through Hermes's Go", () => {
  const ready = [hermes, withGo];
  const cast = castOf(ready)!;
  assert.ok(!throughHermes(cast.lead) && !throughHermes(cast.sidekick), `cast ${cast.lead} + ${cast.sidekick}`);
  assert.equal(cast.sidekick, "opencode:opencode-go/deepseek-v4-flash");
  assert.ok(!throughHermes(reviewerOf([cast.lead, cast.sidekick], ready)));
  const start = startOf({}, ready)!;
  assert.ok(!throughHermes(start.agent.slice(1)) && !throughHermes(start.sidekick));
  for (const kind of ["frontier", "quicker"] as const) assert.ok(!shortlistOf(ready, kind, { n: 8 }).some(throughHermes), kind);
});

test("OpenCode with Go: a pick you saved on Hermes's Go still stands", () => {
  const ready = [hermes, withGo];
  const picks = { sidekick: "hermes:opencode-go/deepseek-v4-flash", checker: "hermes:opencode-go/glm-5" };
  const cast = castOf(ready, { picks })!;
  assert.equal(cast.sidekick, picks.sidekick);
  assert.equal(reviewerOf(["opencode:opencode/big-pickle"], ready, picks), picks.checker);
});

test("OpenCode without Go: Hermes's Go models are chosen as before", () => {
  const ready = [hermes, noGo];
  const cast = castOf(ready)!;
  assert.equal(cast.sidekick, "hermes:opencode-go/deepseek-v4-flash");
  assert.ok(shortlistOf(ready, "quicker", { n: 8 }).some(throughHermes));
});

test("every: casting from some tools still knows OpenCode has Go", () => {
  const all = [hermes, withGo];
  // Hermes's own pair (the composer's tool picker), judged on every tool: never its Go models.
  const own = castOf([hermes], { every: all })!;
  assert.ok(!throughHermes(own.lead) && !throughHermes(own.sidekick), `${own.lead} + ${own.sidekick}`);
  assert.equal(own.sidekick, "hermes:nous/hermes-4-405b");
  assert.ok(!throughHermes(reviewerOf(["claude:claude-opus-5-5"], [hermes], {}, all)));
  assert.ok(!shortlistOf([hermes], "quicker", { n: 8, every: all }).some(throughHermes));
  // Told nothing of the others, Hermes alone is as before.
  assert.equal(castOf([hermes])!.sidekick, "hermes:opencode-go/deepseek-v4-flash");
  // A Hermes with nothing but Go's models has nothing to offer once OpenCode has Go.
  assert.equal(castOf([info("hermes", ["opencode-go/glm-5"])], { every: [info("hermes", ["opencode-go/glm-5"]), withGo] }), null);
});

test("fallbackFor: out of OpenCode Go, never Go's models through Hermes; else Hermes's Go only while OpenCode has none", () => {
  const runtime = new Runtime(new Store(mkdtempSync(join(tmpdir(), "lc-go-fall-"))), process.env);
  runtime.providerInfo = [hermes, withGo];
  const out = runtime.fallbackFor("opencode", "opencode-go/deepseek-v4-flash");
  assert.ok(out && !isGoModel({ id: out.slice(out.indexOf(":") + 1) }), `fell back to ${out}`);
  // Out on Zen while OpenCode has Go: Hermes's Go models still aren't chosen.
  const zen = runtime.fallbackFor("opencode", "opencode/big-pickle");
  assert.ok(!throughHermes(zen), `fell back to ${zen}`);
  // OpenCode without Go, out on Zen: Hermes's Go is chosen as before.
  runtime.providerInfo = [hermes, noGo];
  assert.equal(runtime.fallbackFor("opencode", "opencode/big-pickle"), "hermes:opencode-go/deepseek-v4-flash");
});
