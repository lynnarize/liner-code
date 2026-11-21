/*
  What a new session starts with can be one model picked in the panel ("@<provider>:<model>"), beside Fusion: startOf
  starts on that model alone while its tool is ready, and as unset would once its tool has gone. A Best or Fast saved
  before still reads as the lead alone and the sidekick alone. Run with `node --test engine/test/start-model.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInfo, Settings } from "../../contracts/src/index.ts";
import { castOf, startOf } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const claude = info("claude", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
const codex = info("codex", ["gpt-6.1-sol"]);

test("a start of one model begins a new session on that model alone, with no sidekick", () => {
  assert.deepEqual(startOf({ start: "@codex:gpt-6.1-sol" }, [claude, codex]), { agent: "@codex:gpt-6.1-sol" });
});

test("a start of one model whose tool has gone starts as an unset start would", () => {
  assert.deepEqual(startOf({ start: "@codex:gpt-6.1-sol" }, [claude]), startOf({}, [claude]));
});

test("a Best or Fast saved before still starts on the lead alone and on the sidekick alone", () => {
  const cast = castOf([claude, codex])!;
  assert.deepEqual(startOf({ start: "best" }, [claude, codex]), { agent: `@${cast.lead}` });
  assert.deepEqual(startOf({ start: "fast" }, [claude, codex]), { agent: `@${cast.sidekick}` });
});

test("Fusion still starts as a pair of the lead and its sidekick", () => {
  const cast = castOf([claude, codex])!;
  assert.deepEqual(startOf({ start: "pair" }, [claude, codex]), { agent: `@${cast.lead}`, sidekick: cast.sidekick });
});

test("A start that isn't one of its forms, from a settings file edited by hand, reads as unset and never throws", () => {
  for (const start of [42, { model: "x" }, ["pair"], "", "solo", "@", "@codex", "@ codex:x"]) assert.deepEqual(startOf({ start } as unknown as Pick<Settings, "start">, [claude, codex]), startOf({}, [claude, codex]), JSON.stringify(start));
});

test("settings.save keeps a start of one of its forms, clears it on null, and refuses anything else", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-start-save-"));
  const env = { PATH: "/usr/bin:/bin", HOME: dir } as NodeJS.ProcessEnv;
  const store = new Store(join(dir, "home"));
  const runtime = new Runtime(store, env);
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [], put: () => undefined, remove: () => undefined }, terms: {}, logs: {}, proxies: {} } as never);
  try {
    const save = (start: unknown) => api.call("settings.save", { start } as never) as Promise<Settings>;
    assert.equal((await save("fast")).start, "fast");
    assert.equal((await save("@codex:gpt-6.1-sol")).start, "@codex:gpt-6.1-sol");
    for (const bad of [42, { model: "x" }, "solo", "@codex", ""]) await assert.rejects(save(bad), /starts as/, JSON.stringify(bad));
    assert.equal(store.settings.start, "@codex:gpt-6.1-sol", "a refused start leaves the one before");
    assert.equal((await save(null)).start, undefined);
  } finally {
    api.updates.stop();
    runtime.shutdown();
  }
});

test("A start that isn't one of its forms in the settings file is dropped as the engine loads, so the app never reads it", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-start-load-"));
  mkdirSync(join(home, "threads"));
  writeFileSync(join(home, "state.json"), JSON.stringify({ projects: [], threads: [], settings: { pairVersion: 1, mode: "solo", settleVersion: 2, accessVersion: 2, start: 42 } }));
  assert.equal(new Store(home).settings.start, undefined);
  writeFileSync(join(home, "state.json"), JSON.stringify({ projects: [], threads: [], settings: { pairVersion: 1, mode: "solo", settleVersion: 2, accessVersion: 2, start: "fast" } }));
  assert.equal(new Store(home).settings.start, "fast");
});
