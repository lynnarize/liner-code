/*
  A model's effort levels and price are what its tool said for that model, never a shared list, another model's, or a guess:
  Claude Code's supportedModels(), Codex's catalog, OpenCode's model list, an ACP session's thinking option. A saved effort the
  model no longer takes still runs. Run with `node --test engine/test/model-efforts.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ModelInfo, ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { opencode } from "../src/providers/acp.ts";
import { claude, sdk } from "../src/providers/claude.ts";
import { codexListed } from "../src/providers/codex.ts";
import { acpModels, effortOf, OPENCODE_LIST, opencodeModelList, thoughtLevels, toolLevels, ULTRACODE, ULTRATHINK } from "../src/providers/models.ts";
import { Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

const SAMPLE = readFileSync(join(import.meta.dirname, "fixtures", "opencode-model-list.sample.json"), "utf8");
const ids = (m: ModelInfo | undefined) => m?.efforts?.map((e) => e.id);

test("OpenCode's model list gives each model its own effort levels from each provider, in OpenCode's order, never merged", () => {
  const list = opencodeModelList(SAMPLE)!;
  const by = (id: string) => list.find((m) => m.id === id);
  assert.deepEqual(ids(by("opencode/glm-5.3")), ["low", "high", "max"], "GLM-5.3 has no medium");
  assert.deepEqual(ids(by("opencode-go/glm-5.3")), ["low", "high", "max"]);
  assert.deepEqual(ids(by("opencode/kimi-k3")), ["low", "high", "max"]);
  assert.deepEqual(ids(by("opencode-go/kimi-k3")), ["max"], "the same model from Go takes only what Go says");
  assert.deepEqual(ids(by("opencode/deepseek-v4-pro")), ["high", "max"]);
  assert.deepEqual(ids(by("opencode/hy4-flash-free")), ["none", "high"]);
  assert.equal(by("opencode/hy4-flash-free")!.efforts![0].label, "none", "a level the app doesn't know keeps OpenCode's word");
  assert.deepEqual(by("opencode/iceman-free")!.efforts, [], "a model listed with no variants is said to take none, not left unknown");
  assert.equal(by("opencode-go/glm-5.3")!.group, "opencode-go");
  assert.equal(by("opencode/glm-5.3")!.label, "GLM-5.3");
  assert.equal(list.length, 16);
});

test("OpenCode's model list gives each model its price per million tokens as the tool says it, long prompts as a note", () => {
  const list = opencodeModelList(SAMPLE)!;
  const by = (id: string) => list.find((m) => m.id === id)!;
  assert.deepEqual(by("opencode/glm-5.3").price, { input: "$1.40", output: "$4.40" });
  assert.deepEqual(by("opencode/deepseek-v4-pro").price, { input: "$1.74", output: "$3.48" });
  assert.deepEqual(by("opencode-go/deepseek-v4-pro").price, { input: "$0.66", output: "$1.98" }, "each provider's own price");
  assert.deepEqual(by("opencode/gemini-4-neon").price, { input: "$3", output: "$15" });
  assert.deepEqual(by("opencode/gpt-6.2-sol").price, { input: "$2", output: "$10", note: "$4/$15 for prompts over 272k" });
  assert.deepEqual(by("opencode/iceman-free").price, { input: "$0", output: "$0" });
});

test("Nothing of a model's headers or settings in OpenCode's list is kept", () => {
  const withSecrets = JSON.stringify({ data: [{ id: "x", providerID: "opencode", name: "X", headers: { "x-org": "org_secret" }, settings: { baseURL: "https://secret.example" }, variants: [{ id: "low", settings: { key: "secret" } }], cost: [] }] });
  const [row] = opencodeModelList(withSecrets)!;
  assert.ok(!JSON.stringify(row).includes("secret"));
  assert.deepEqual(Object.keys(row).sort(), ["description", "efforts", "group", "id", "label"]);
});

test("An answer from OpenCode not in its model list's shape gives no list, so no level or price is made up", () => {
  for (const said of ["", "opencode/glm-5.3\nopencode-go/glm-5.3\n", "[]", "{}", '{"data":{}}', '{"data":[]}', '{"data":[{"name":"No id"}]}']) assert.equal(opencodeModelList(said), null, JSON.stringify(said));
  const [odd] = opencodeModelList('{"data":[{"id":"m","providerID":"p","variants":"high","cost":[{"input":"1","output":2}]}]}')!;
  assert.equal(odd.efforts, undefined);
  assert.equal(odd.price, undefined);
  assert.equal(opencodeModelList('{"data":[{"id":"m","providerID":"p","enabled":false}]}'), null, "a model OpenCode switched off isn't listed");
});

test("An ACP session's thinking option gives the levels of the model it is on, in the tool's words, without its default", () => {
  // OpenCode 2.3.2's options after session/new.
  const configOptions = [
    { id: "model", name: "Model", category: "model", type: "select", currentValue: "opencode-go/kimi-k3", options: [{ value: "opencode-go/kimi-k3", name: "opencode-go/Kimi K3" }] },
    { id: "effort", name: "Effort", description: "Available effort levels for this model", category: "thought_level", type: "select", currentValue: "default", options: [{ value: "low", name: "Low" }, { value: "thinking-max", name: "Thinking Max" }, { value: "default", name: "Default" }] },
  ];
  const levels = thoughtLevels(configOptions);
  assert.deepEqual(levels.map((e) => e.id), ["low", "thinking-max"]);
  assert.deepEqual(levels.map((e) => e.label), ["Low", "Thinking Max"]);
  for (const odd of [undefined, null, {}, [], [{ category: "thought_level", type: "boolean" }], [{ category: "model", options: [{ value: "low" }] }]]) assert.deepEqual(thoughtLevels(odd), [], JSON.stringify(odd));
});

test("Codex's levels are the ones its catalog lists for the model, and a default it doesn't list is none", () => {
  const m = codexListed({ slug: "gpt-6.1-sol", display_name: "GPT-6.1 Sol", description: "Frontier", default_reasoning_level: "medium", supported_reasoning_levels: [{ effort: "low", description: "Quick" }, { effort: "medium" }, { effort: "high" }] });
  assert.deepEqual(ids(m), ["low", "medium", "high"]);
  assert.equal(m.efforts![0].description, "Quick");
  assert.equal(m.defaultEffort, "medium");
  assert.equal(codexListed({ slug: "x", default_reasoning_level: "medium", supported_reasoning_levels: [{ effort: "high" }] }).defaultEffort, undefined);
  assert.deepEqual(codexListed({ slug: "y" }).efforts, []);
});

test("A level the app has never seen keeps the tool's own word, and a known one its label", () => {
  assert.equal(effortOf("turbo").label, "turbo");
  assert.equal(effortOf("xhigh").label, "Extra high");
});

/** A Claude Code that answers supportedModels() with `main`, and with `older` when asked with the older models added to its picker. */
function fakeClaude(main: unknown[], older: unknown[] | Error) {
  const bin = mkdtempSync(join(tmpdir(), "lc-efforts-bin-"));
  // Its --version says what the version file holds, so a test can update it.
  writeFileSync(join(bin, "version"), "2.1.400 (Claude Code)\n");
  writeFileSync(join(bin, "claude"), `#!/bin/sh\n[ "$1" = "--version" ] && cat ${JSON.stringify(join(bin, "version"))}\nexit 0\n`);
  chmodSync(join(bin, "claude"), 0o755);
  const was = sdk.query;
  const asked: unknown[] = [];
  const said = { older };
  // How many looks answer at once, at most: each takes a moment, as a Claude Code starting does, the main look long enough to
  // outlast its --version beside it.
  const at = { now: 0, most: 0 };
  sdk.query = ((a: { options: { settings?: unknown } }) => {
    asked.push(a.options.settings);
    return {
      supportedModels: async () => {
        at.most = Math.max(at.most, ++at.now);
        await new Promise((r) => setTimeout(r, a.options.settings ? 20 : 1000));
        at.now--;
        return a.options.settings ? (said.older instanceof Error ? Promise.reject(said.older) : said.older) : main;
      },
    };
  }) as never;
  return { env: { PATH: `${bin}:/bin:/usr/bin`, HOME: bin } as NodeJS.ProcessEnv, scratch: join(bin, "probe"), asked, said, at, update: (v: string) => writeFileSync(join(bin, "version"), `${v} (Claude Code)\n`), restore: () => void (sdk.query = was) };
}

const ROWS = [
  { value: "default", resolvedModel: "claude-opus-5-5", displayName: "Default", description: "Use the default model" },
  { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus", description: "Opus 5.5 · Best for everyday, complex tasks · $4/$20 per Mtok", supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"], supportsAdaptiveThinking: true },
  { value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku", description: "Haiku 5.5 · Fastest for quick answers · $0.10/$0.50 per Mtok ($0.50/$2.50 for prompts over 100k)", supportedEffortLevels: ["low", "high"], supportsAdaptiveThinking: false },
];

test("Claude Code's models carry the levels it says for each, its extras marked apart, its price apart, and no default it didn't say", async () => {
  const f = fakeClaude(ROWS, [...ROWS, { value: "claude-opus-4-8", displayName: "Opus", description: "Opus 4.8 · Older · $5/$25 per Mtok", supportedEffortLevels: ["low", "medium", "high"], supportsAdaptiveThinking: true }]);
  try {
    const list = await claude.models!(f.env, f.scratch);
    const by = (id: string) => list.find((m) => m.id === id)!;
    assert.deepEqual(ids(by("claude-opus-5-5")), ["low", "medium", "high", "xhigh", "max", "ultracode", "ultrathink"]);
    assert.deepEqual(by("claude-opus-5-5").efforts!.filter((e) => e.extra).map((e) => e.id), ["ultracode", "ultrathink"], "Liner Code's own are marked");
    assert.deepEqual(ids(by("claude-haiku-5-5")), ["low", "high"], "Haiku's own levels, not Opus's");
    assert.equal(by("claude-opus-5-5").defaultEffort, undefined);
    assert.deepEqual(by("claude-opus-5-5").price, { input: "$4", output: "$20" });
    assert.equal(by("claude-opus-5-5").description, "Best for everyday, complex tasks");
    assert.deepEqual(by("claude-haiku-5-5").price, { input: "$0.10", output: "$0.50", note: "$0.50/$2.50 for prompts over 100k" });
    assert.deepEqual(ids(by("claude-opus-4-8")), ["low", "medium", "high", "ultrathink"], "an older model Claude Code was asked about has what it said");
    assert.equal(by("claude-opus-4-8").legacy, true);
    assert.equal(by("claude-sonnet-4-6").efforts, undefined, "one it didn't describe has none");
    assert.deepEqual(f.asked.filter(Boolean).length, 1, "the older models are asked about in a look of their own");
  } finally {
    f.restore();
  }
});

test("When Claude Code can't be asked about the older models, they have no effort levels and the list still comes", async () => {
  const f = fakeClaude(ROWS, new Error("unknown setting"));
  try {
    const list = await claude.models!(f.env, f.scratch);
    assert.deepEqual(ids(list.find((m) => m.id === "claude-haiku-5-5")), ["low", "high"]);
    const old = list.find((m) => m.id === "claude-opus-4-8")!;
    assert.equal(old.efforts, undefined);
    assert.equal(old.legacy, true);
  } finally {
    f.restore();
  }
});

test("Claude Code's second look at the older models runs once per version, its answer kept, and never costs the main list", async () => {
  const OLD = { value: "claude-opus-4-8", displayName: "Opus", description: "Opus 4.8 · Older · $5/$25 per Mtok", supportedEffortLevels: ["low", "high"], supportsAdaptiveThinking: true, secret: "not kept" };
  const f = fakeClaude(ROWS, new Error("busy"));
  const looks = () => f.asked.filter(Boolean).length;
  try {
    let list = await claude.models!(f.env, f.scratch);
    assert.ok(list.some((m) => m.id === "claude-opus-5-5"), "a failed second look leaves the main list");
    assert.equal(looks(), 1);
    f.said.older = [...ROWS, OLD];
    list = await claude.models!(f.env, f.scratch);
    assert.equal(looks(), 2, "a failed look isn't kept: it is asked again");
    assert.deepEqual(ids(list.find((m) => m.id === "claude-opus-4-8")), ["low", "high", "ultrathink"]);
    f.said.older = new Error("must not be asked");
    list = await claude.models!(f.env, f.scratch);
    assert.equal(looks(), 2, "the same version: its kept answer, no second Claude Code");
    assert.deepEqual(ids(list.find((m) => m.id === "claude-opus-4-8")), ["low", "high", "ultrathink"], "what it said is kept");
    const kept = readFileSync(join(f.scratch, "claude-older.json"), "utf8");
    assert.doesNotMatch(kept, /not kept|claude-haiku-5-5/, "only the older models' named fields");
    f.update("2.1.401");
    f.said.older = [...ROWS, { ...OLD, supportedEffortLevels: ["low", "medium", "high"] }];
    list = await claude.models!(f.env, f.scratch);
    assert.equal(looks(), 3, "a new version is asked again");
    assert.deepEqual(ids(list.find((m) => m.id === "claude-opus-4-8")), ["low", "medium", "high", "ultrathink"]);
  } finally {
    f.restore();
  }
});

test("Claude Code's second look at the older models starts only once the main look has ended, never beside it on the same config folder", async () => {
  const f = fakeClaude(ROWS, [...ROWS, { value: "claude-opus-4-8", displayName: "Opus", description: "Opus 4.8 · Older", supportedEffortLevels: ["low", "high"], supportsAdaptiveThinking: false }]);
  try {
    const list = await claude.models!(f.env, f.scratch);
    assert.equal(f.asked.filter(Boolean).length, 1, "the second look ran");
    assert.equal(f.at.most, 1, "two Claude Codes never start at once");
    assert.deepEqual(ids(list.find((m) => m.id === "claude-opus-4-8")), ["low", "high"]);
  } finally {
    f.restore();
  }
});

test("A second look that described none of the older models (signed out, say) isn't kept, so it is asked again next time", async () => {
  const f = fakeClaude(ROWS, ROWS);
  const looks = () => f.asked.filter(Boolean).length;
  try {
    await claude.models!(f.env, f.scratch);
    assert.equal(looks(), 1);
    assert.equal(existsSync(join(f.scratch, "claude-older.json")), false, "nothing kept for an answer with none of them");
    f.said.older = [...ROWS, { value: "claude-opus-4-8", displayName: "Opus", description: "Opus 4.8 · Older", supportedEffortLevels: ["low", "high"], supportsAdaptiveThinking: false }];
    const list = await claude.models!(f.env, f.scratch);
    assert.equal(looks(), 2, "the same version is asked again, as nothing was kept");
    assert.deepEqual(ids(list.find((m) => m.id === "claude-opus-4-8")), ["low", "high"]);
  } finally {
    f.restore();
  }
});

test("Claude Code's models before it answers have no effort levels", async () => {
  const info = await claude.detect({ PATH: mkdtempSync(join(tmpdir(), "lc-efforts-none-")) } as NodeJS.ProcessEnv);
  assert.ok(info.models.length > 0);
  for (const m of info.models) assert.equal(m.efforts, undefined, m.id);
});

const tool = (id: ProviderInfo["id"], models: ModelInfo[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models, modelsFrom: "cli", supports: { approvals: true, resume: true, effort: true, plan: true } });

function engine(saved: ProviderInfo[] = [], customModels: unknown[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "lc-efforts-"));
  const env = { PATH: "/nonexistent", HOME: dir } as NodeJS.ProcessEnv;
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  if (saved.length) writeFileSync(join(home, "tools.json"), JSON.stringify(saved));
  const store = new Store(home);
  if (customModels.length) store.settings.customModels = customModels as never;
  const runtime = new Runtime(store, env);
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [], put: () => undefined, remove: () => undefined }, terms: {}, logs: {}, proxies: {} } as never);
  return { runtime, stop: () => (api.updates.stop(), runtime.shutdown()) };
}

test("A saved effort the model no longer takes still runs: at the nearest it has, else its default, else the tool's own", () => {
  const e = engine();
  try {
    e.runtime.providerInfo = [
      tool("opencode", [{ id: "opencode-go/kimi-k3", label: "Kimi K3", description: "", efforts: ["max"].map((x) => effortOf(x)) }, { id: "opencode/glm-5.3", label: "GLM-5.3", description: "", efforts: ["low", "high", "max"].map((x) => effortOf(x)) }, { id: "opencode/iceman-free", label: "Iceman", description: "" }]),
      tool("codex", [{ id: "gpt", label: "GPT", description: "", efforts: ["low", "high"].map((x) => effortOf(x)), defaultEffort: "high" }]),
    ];
    assert.equal(e.runtime.effortFor("opencode", "opencode-go/kimi-k3", "medium"), "max");
    assert.equal(e.runtime.effortFor("opencode", "opencode/glm-5.3", "medium"), "low", "two as near: the lower, with no default said");
    assert.equal(e.runtime.effortFor("opencode", "opencode/glm-5.3", "high"), "high");
    assert.equal(e.runtime.effortFor("opencode", "opencode/glm-5.3", "ultracode"), "", "nothing near and no default: the tool picks");
    assert.equal(e.runtime.effortFor("codex", "gpt", "ultrathink"), "high", "nothing near: the model's default");
    assert.equal(e.runtime.effortFor("opencode", "opencode/iceman-free", "medium"), "", "a model with no levels said is given none");
    const t = { id: "t1", agent: "@opencode:opencode/glm-5.3", effort: "ultracode", access: "full" } as unknown as Thread;
    assert.equal(e.runtime.resolve(t).effort, "", "a thread saved at a level the model no longer takes resolves without throwing");
  } finally {
    e.stop();
  }
});

test("A model its tool lists no levels for is given no level, whatever was asked, and nothing asked is none", () => {
  const e = engine();
  try {
    e.runtime.providerInfo = [
      tool("codex", [{ id: "gpt-bare", label: "Bare", description: "" }, { id: "gpt", label: "GPT", description: "", efforts: ["low", "high"].map((x) => effortOf(x)), isDefault: true }]),
      tool("claude", [{ id: "claude-opus-4-1", label: "Opus 4.1", description: "", legacy: true }, { id: "claude-opus-5-5", label: "Opus 5.5", description: "", efforts: [...["low", "high", "xhigh"].map((x) => effortOf(x)), ULTRACODE, ULTRATHINK] }, { id: "claude-haiku-4-5", label: "Haiku", description: "", efforts: [effortOf("low"), effortOf("high")] }]),
    ];
    for (const word of ["low", "medium", "high", "max", "ultrathink"]) {
      assert.equal(e.runtime.effortFor("codex", "gpt-bare", word), "", `${word} is not sent to a model its catalog lists bare`);
      assert.equal(e.runtime.effortFor("codex", "my-own-model", word), "", `${word} is not sent to a model id the tool never listed`);
      assert.equal(e.runtime.effortFor("claude", "claude-opus-4-1", word), "", `${word} is not sent to an older Claude model with no levels`);
    }
    assert.equal(e.runtime.effortFor("codex", "gpt", ""), "", "nothing asked: none");
    assert.equal(e.runtime.effortFor("codex", "gpt", undefined), "", "never set: none");
    assert.equal(e.runtime.effortFor("codex", "gpt", "medium"), "low", "a listed model still gets the nearest it lists");
    assert.equal(e.runtime.effortFor("codex", "default", "high"), "high", "the tool's default model goes by the model it marks as default");
    assert.equal(e.runtime.effortFor("claude", "claude-opus-5-5", "ultracode"), "ultracode", "Ultracode where extra high is listed");
    assert.equal(e.runtime.effortFor("claude", "claude-opus-5-5", "ultrathink"), "ultrathink", "Ultrathink where adaptive thinking is");
    assert.equal(e.runtime.effortFor("claude", "claude-haiku-4-5", "ultrathink"), "", "Ultrathink nowhere it isn't listed");
    assert.equal(e.runtime.effortFor("claude", "claude-haiku-4-5", "ultracode"), "", "Ultracode nowhere it isn't listed");
  } finally {
    e.stop();
  }
});

test("A model id you added takes no effort levels from the tool's other models", () => {
  const e = engine([tool("claude", [{ id: "claude-opus-5-5", label: "Opus 5.5", description: "Best", efforts: [effortOf("low"), effortOf("high")], isDefault: true }])], [{ provider: "claude", id: "claude-mine-1" }]);
  try {
    const mine = e.runtime.providerInfo.find((p) => p.id === "claude")?.models.find((m) => m.id === "claude-mine-1");
    assert.ok(mine?.custom);
    assert.equal(mine.efforts, undefined);
    assert.equal(mine.defaultEffort, undefined);
  } finally {
    e.stop();
  }
});

test("A model id you added takes the levels its tool showed are the same for every model", () => {
  const levels = [effortOf("low"), effortOf("high")];
  const e = engine([tool("hermes", [{ id: "default", label: "Hermes default", description: "", efforts: levels }, { id: "nous:a", label: "A", description: "", efforts: levels }])], [{ provider: "hermes", id: "nous:mine" }]);
  try {
    const mine = e.runtime.providerInfo.find((p) => p.id === "hermes")?.models.find((m) => m.id === "nous:mine");
    assert.ok(mine?.custom);
    assert.deepEqual(mine.efforts?.map((x) => x.id), ["low", "high"]);
    assert.equal(e.runtime.effortFor("hermes", "nous:mine", "high"), "high", "and runs at the one picked");
  } finally {
    e.stop();
  }
});

/**
  An ACP agent asked only for its models: m1 (it opens on), m2 and m3. `levels`: each model's thinking choices (one with none
  has no thought_level option). `how` it answers a model switch: "" with its options, "empty" with none (Hermes's older ACP
  server), "notify" with a config_option_update and a bare reply, "ask" only after asking permission, "refuse" staying on m1.
*/
function fakeLister(levels: Record<string, string>, how = "") {
  const dir = mkdtempSync(join(tmpdir(), "lc-acp-levels-"));
  const file = join(dir, "fake-acp");
  const script = `
const rl = require("node:readline").createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n");
const LEVELS = ${JSON.stringify(levels)}, HOW = ${JSON.stringify(how)};
let model = "m1", held = null;
const opts = () => [
  { id: "model", category: "model", type: "select", currentValue: model, options: ["m1", "m2", "m3"].map((v) => ({ value: v, name: v.toUpperCase() })) },
  ...(LEVELS[model] ? [{ id: "effort", category: "thought_level", type: "select", currentValue: "default", options: [...LEVELS[model].split(","), "default"].map((v) => ({ value: v, name: v })) }] : []),
];
rl.on("line", (l) => {
  const m = JSON.parse(l);
  if (m.method === "initialize") send({ id: m.id, result: {} });
  if (m.method === "session/new") send({ id: m.id, result: { sessionId: "s1", configOptions: opts() } });
  if (m.method === "session/set_config_option") {
    if (HOW === "ask") return ((held = m), send({ id: "p1", method: "session/request_permission", params: { sessionId: "s1", options: [] } }));
    if (HOW !== "refuse") model = m.params.value;
    if (HOW === "empty") return send({ id: m.id, result: { configOptions: [] } });
    if (HOW === "notify") return (send({ method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "config_option_update", configOptions: opts() } } }), send({ id: m.id, result: {} }));
    send({ id: m.id, result: { configOptions: opts() } });
  }
  if (m.id === "p1" && !m.method && held) ((model = held.params.value), send({ id: held.id, result: { configOptions: opts() } }), (held = null));
});`;
  writeFileSync(file, `#!${process.execPath}\n${script}`);
  chmodSync(file, 0o755);
  return () => acpModels([file], "Fake", { ...process.env }, join(dir, "scratch"));
}
const levelsOf = (list: ModelInfo[]) => Object.fromEntries(list.map((m) => [m.id, m.efforts?.map((e) => e.id).join(",")]));

test("An ACP agent whose thinking levels are the same on two models gives them to every model, its default row too", async () => {
  const list = await fakeLister({ m1: "low,high", m2: "low,high", m3: "low,high" })();
  assert.deepEqual(levelsOf(list), { default: "low,high", m1: "low,high", m2: "low,high", m3: "low,high" });
  assert.deepEqual(toolLevels(list)?.map((e) => e.id), ["low", "high"], "the default row says they are the tool's");
});

test("An ACP agent whose thinking levels differ by model gives each of the two it was on its own, and the rest none until a session says", async () => {
  const list = await fakeLister({ m1: "low,high", m2: "max" })();
  assert.deepEqual(levelsOf(list), { default: undefined, m1: "low,high", m2: "max", m3: undefined });
  assert.equal(toolLevels(list), undefined);
});

test("An ACP agent with no thinking option on either model is said to take none, on every model", async () => {
  const list = await fakeLister({})();
  assert.deepEqual(levelsOf(list), { default: "", m1: "", m2: "", m3: "" });
});

test("An ACP agent that answers a model switch with no options, or stays put, is not taken to share its levels", async () => {
  for (const how of ["empty", "refuse"]) {
    const list = await fakeLister({ m1: "low,high", m2: "low,high", m3: "low,high" }, how)();
    assert.deepEqual(levelsOf(list), { default: undefined, m1: "low,high", m2: undefined, m3: undefined }, how);
  }
});

test("An ACP agent's levels sent as an update after a model switch are read as its answer", async () => {
  const list = await fakeLister({ m1: "low,high", m2: "low,high" }, "notify")();
  assert.equal(levelsOf(list).m3, "low,high");
});

test("An ACP agent that asks permission before a model switch is answered at once, so its model listing never waits on it", async () => {
  const start = Date.now();
  const list = await fakeLister({ m1: "low,high", m2: "low,high" }, "ask")();
  assert.equal(levelsOf(list).m3, "low,high");
  assert.ok(Date.now() - start < 5000, "not the switch's whole time limit");
});

test("Claude Code's list saved for the next launch reads with its price apart and no levels copied onto older models", () => {
  const e = engine([tool("claude", [{ id: "claude-opus-5-5", label: "Opus", description: "Opus 5.5 · Best for everyday, complex tasks · $4/$20 per Mtok", efforts: [effortOf("low")] }, { id: "claude-opus-4-8", label: "Opus 4.8", description: "An older version", efforts: [effortOf("low")], legacy: true }])]);
  try {
    const models = e.runtime.providerInfo.find((p) => p.id === "claude")!.models;
    assert.deepEqual(models[0].price, { input: "$4", output: "$20" });
    assert.equal(models[0].description, "Best for everyday, complex tasks");
    assert.equal(models.find((m) => m.id === "claude-opus-4-8")!.efforts, undefined);
  } finally {
    e.stop();
  }
});

/**
  An opencode on PATH that says `version` to --version, answers `opencode api GET /api/model` with `said` (or fails when it's
  null), or with `hang` starts a child that holds its output open and never answers; its ACP session lists one model. It logs
  how it was started, and the pids of a hanging call and its child.
*/
function fakeOpencode(said: string | null, o: { version?: string; hang?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lc-efforts-oc-"));
  const answer = join(dir, "answer.json");
  const pids = join(dir, "pids");
  if (said !== null) writeFileSync(answer, said);
  writeFileSync(join(dir, "opencode"), `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(dir, "log"))}, JSON.stringify({ argv: a, cwd: process.cwd(), permission: Boolean(process.env.OPENCODE_PERMISSION) }) + "\\n");
if (a[0] === "--version") {
  process.stdout.write(${JSON.stringify(o.version ?? "2.3.0")} + "\\n");
  process.exit(0);
} else if (a[0] === "api" && ${Boolean(o.hang)}) {
  const c = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"] });
  fs.appendFileSync(${JSON.stringify(pids)}, process.pid + "\\n" + c.pid + "\\n");
  setInterval(() => {}, 1000);
} else if (a[0] === "api" && fs.existsSync(${JSON.stringify(answer)})) {
  process.stdout.write(fs.readFileSync(${JSON.stringify(answer)}, "utf8"));
  process.exit(0);
} else if (a[0] === "acp") {
  let buf = "";
  process.stdin.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\\n")) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      const result = m.method === "initialize" ? { protocolVersion: 1 } : { sessionId: "s", configOptions: [{ id: "model", category: "model", currentValue: "opencode/big-pickle", options: [{ value: "opencode/big-pickle", name: "OpenCode/Big Pickle" }] }] };
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");
    }
  });
} else process.exit(1);
`);
  chmodSync(join(dir, "opencode"), 0o755);
  const log = () => readFileSync(join(dir, "log"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { argv: string[]; cwd: string; permission: boolean });
  const started = () => (existsSync(pids) ? readFileSync(pids, "utf8").split("\n").filter(Boolean).map(Number) : []);
  return { env: { PATH: `${dir}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir } as NodeJS.ProcessEnv, scratch: join(dir, "probe"), log, started };
}

/** Waits up to 5 seconds for every one of `pids` to be gone (killTree's SIGKILL comes 2 seconds after its SIGTERM). */
async function gone(pids: number[]) {
  for (let i = 0; i < 50 && pids.some(alive); i++) await new Promise((r) => setTimeout(r, 100));
}

/** Whether a process is still there. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("OpenCode's models come from its own model list, asked with OpenCode's environment in an empty folder, with its default first", async () => {
  const f = fakeOpencode(SAMPLE);
  const list = await opencode.models!(f.env, f.scratch);
  assert.equal(list[0].id, "default");
  assert.deepEqual(ids(list.find((m) => m.id === "opencode-go/kimi-k3")), ["max"]);
  const call = f.log().find((c) => c.argv[0] === "api")!;
  assert.deepEqual(call.argv.filter((a) => a !== "--standalone"), ["api", "GET", "/api/model"]);
  assert.ok(call.cwd.endsWith("probe"), call.cwd);
  assert.equal(call.permission, true, "started as every other OpenCode call is");
});

test("OpenCode's model list is asked standalone, so it never starts OpenCode's background service, which would outlive the app and its time limit", async () => {
  const f = fakeOpencode(SAMPLE);
  await opencode.models!(f.env, f.scratch);
  const call = f.log().find((c) => c.argv[0] === "api")!;
  assert.deepEqual(call.argv, ["api", "--standalone", "GET", "/api/model"]);
});

test("An OpenCode whose model list can't be read falls back to its session's list, with no levels or price made up", async () => {
  const f = fakeOpencode(null);
  const list = await opencode.models!(f.env, f.scratch);
  assert.ok(list.every((m) => !m.efforts && !m.price));
  assert.deepEqual(f.log().map((c) => c.argv[0]), ["--version", "api", "acp"], "its version, its list, then a session");
});

test("An OpenCode before version 2 is never asked for its model list, which it could read as a folder, and its session's list comes", async () => {
  const f = fakeOpencode(SAMPLE, { version: "1.14.2" });
  const list = await opencode.models!(f.env, f.scratch);
  assert.deepEqual(f.log().map((c) => c.argv[0]), ["--version", "acp"], "no api call");
  assert.ok(list.some((m) => m.id === "opencode/big-pickle"), "the session's list");
});

test("An OpenCode model list that hangs is ended with the children it started, and the session's list still arrives", async () => {
  const f = fakeOpencode(null, { hang: true });
  const was = OPENCODE_LIST.ms;
  // Long enough for the call to start its child under a loaded run, short of the 30 seconds.
  OPENCODE_LIST.ms = 3000;
  try {
    const at = Date.now();
    const list = await opencode.models!(f.env, f.scratch);
    assert.ok(Date.now() - at < 15000, "not held up past its bound");
    assert.ok(list.some((m) => m.id === "opencode/big-pickle"), "the session's list");
    const pids = f.started();
    assert.equal(pids.length, 2, "the call and its child");
    await gone(pids);
    assert.deepEqual(pids.filter(alive), [], "both ended");
  } finally {
    OPENCODE_LIST.ms = was;
  }
});

test("An OpenCode model list is ended, with its children, when the look that asked for it is stopped", async () => {
  const f = fakeOpencode(null, { hang: true });
  const stop = new AbortController();
  const at = Date.now();
  // Stopped once the call and its child are both running.
  const watch = setInterval(() => f.started().length === 2 && (clearInterval(watch), stop.abort()), 50);
  const list = await opencode.models!(f.env, f.scratch, stop.signal);
  clearInterval(watch);
  assert.ok(Date.now() - at < 10000, "it ends with the stop, not its 30 seconds");
  assert.deepEqual(list, [], "stopped: nothing more is asked");
  const pids = f.started();
  assert.equal(pids.length, 2);
  await gone(pids);
  assert.deepEqual(pids.filter(alive), [], "both ended");
});
