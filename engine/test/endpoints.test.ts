/*
  API endpoints run through the tool that speaks their protocol: what each tool is handed (its
  environment, its settings, the model by its name), what the model picker gets, and the lookup
  of an endpoint's models. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Endpoint, ProviderInfo } from "../../contracts/src/index.ts";
import { endpointKey, VOUCHER } from "../../contracts/src/index.ts";
import { toml } from "../src/providers/codex-server.ts";
import { endpointModels, endpointOptions, endpointProvider, hostOf, KEY_VAR } from "../src/providers/endpoint.ts";
import type { OpenOptions, Provider, ProviderSession } from "../src/providers/types.ts";
import { linerName, providers, syncProviders, toolsNote } from "../src/runtime.ts";
import { defaultSettings } from "../src/store.ts";

const ep = (protocol: Endpoint["protocol"], url = "https://api.example.com/v1/"): Endpoint => ({ id: "api-ex", label: "Example", url, protocol, models: ["ex-large", "ex-small"] });
const env = { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-ant-ours" };

test("endpoints: Anthropic's Messages go through Claude Code, pointed at the endpoint, its aliases all on the model, our key kept away", () => {
  const x = endpointOptions(ep("anthropic", "https://api.deepseek.com/anthropic/"), "deepseek-chat", "sk-theirs", env);
  assert.equal(x.model, "deepseek-chat");
  assert.equal(x.config, undefined);
  assert.equal(x.env.ANTHROPIC_BASE_URL, "https://api.deepseek.com/anthropic");
  assert.equal(x.env.ANTHROPIC_AUTH_TOKEN, "sk-theirs");
  assert.equal(x.env.ANTHROPIC_API_KEY, undefined, "Liner Code's Anthropic key never goes to someone else's endpoint");
  for (const k of ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"]) assert.equal(x.env[k], "deepseek-chat", k);
  assert.equal(x.env.ENABLE_TOOL_SEARCH, "false", "every tool in the list, Liner Code's too");
  assert.equal(x.env.PATH, "/usr/bin");
  // With no key (one on this Mac), a placeholder: Claude Code's own sign-in never goes to it.
  assert.equal(endpointOptions(ep("anthropic", "http://localhost:4000"), "m", undefined, env).env.ANTHROPIC_AUTH_TOKEN, "none");
});

test("endpoints: OpenAI's Responses go through Codex as a model provider of their own; Chat Completions through OpenCode's config", () => {
  const r = endpointOptions(ep("responses"), "ex-large", "sk-x", env);
  assert.equal(r.model, "ex-large");
  assert.equal(r.env[KEY_VAR], "sk-x");
  assert.deepEqual(r.config, {
    model_provider: "liner_api_ex",
    "model_providers.liner_api_ex": { name: "Example", base_url: "https://api.example.com/v1", wire_api: "responses", requires_openai_auth: false, supports_websockets: false, env_key: KEY_VAR },
  });
  assert.equal(toml(r.config!["model_providers.liner_api_ex"]), `{ name = "Example", base_url = "https://api.example.com/v1", wire_api = "responses", requires_openai_auth = false, supports_websockets = false, env_key = "${KEY_VAR}" }`);
  assert.equal(endpointOptions(ep("responses", "http://127.0.0.1:1234/v1"), "m", undefined, env).env[KEY_VAR], undefined, "no key, none sent");
  assert.ok(!("env_key" in (endpointOptions(ep("responses"), "m", undefined, env).config!["model_providers.liner_api_ex"] as object)));

  const c = endpointOptions(ep("chat"), "ex-small", "sk-c", env);
  assert.equal(c.model, "liner_api_ex/ex-small", "OpenCode names a model by its provider");
  const config = JSON.parse(String(c.env.OPENCODE_CONFIG_CONTENT));
  assert.equal(config.model, "liner_api_ex/ex-small");
  assert.deepEqual(config.provider.liner_api_ex.options, { baseURL: "https://api.example.com/v1", apiKey: `{env:${KEY_VAR}}` });
  assert.deepEqual(Object.keys(config.provider.liner_api_ex.models), ["ex-large", "ex-small"]);
  assert.equal(c.env[KEY_VAR], "sk-c");
});

test("endpoints: a tool of its own in the picker, its models yours; a session gets the endpoint, Claude's subagents its model", async () => {
  let opened: OpenOptions | null = null;
  const base: Provider = {
    id: "claude",
    detect: async () => ({ id: "claude", label: "Claude Code", available: true, adapter: true, login: "claude auth login", signedIn: false, models: [{ id: "claude-opus-5-5", label: "Opus", description: "" }], supports: { approvals: true, resume: true, effort: true, plan: true } }) as ProviderInfo,
    open: (o) => ((opened = o), {} as ProviderSession),
  };
  let key: string | undefined;
  const p = endpointProvider(base, ep("anthropic"), () => key);
  const d = await p.detect({});
  assert.equal(d.id, "claude.api-ex");
  assert.equal(d.label, "Example");
  assert.equal(d.endpoint, "api.example.com");
  assert.deepEqual(d.models.map((m) => [m.id, m.isDefault ?? false]), [["ex-large", true], ["ex-small", false]]);
  assert.equal(d.signedIn, undefined, "no key yet: some hosted ones need none, so it isn't called signed out");
  assert.match(d.detail ?? "", /api\.example\.com, through Claude Code, with no key/);
  key = "sk-later";
  assert.equal((await p.detect({})).signedIn, true, "a key saved later counts");

  p.open({ cwd: "/p", model: "ex-small", effort: "medium", access: "edits", soul: "", guard: false, env: { ...env }, subagents: { Explorer: { description: "reads", prompt: "p", model: "haiku" } } });
  assert.ok(opened);
  const o = opened as OpenOptions;
  assert.equal(o.model, "ex-small");
  assert.equal(o.env.ANTHROPIC_AUTH_TOKEN, "sk-later");
  assert.equal(o.subagents?.Explorer.model, undefined, "subagents run on the endpoint's model, not Haiku");
  p.open({ cwd: "/p", model: "default", effort: "medium", access: "edits", soul: "", guard: false, env: {} });
  assert.equal((opened as OpenOptions).model, "ex-large", "no model: its first");
});

test("endpoints: settings make them tools beside the others, through the tool for each protocol", () => {
  syncProviders({ ...defaultSettings, endpoints: [ep("anthropic"), { ...ep("responses"), id: "api-or" }, { ...ep("chat"), id: "api-local" }] }, new Map());
  assert.ok(providers["claude.api-ex"]);
  assert.ok(providers["codex.api-or"]);
  assert.ok(providers["opencode.api-local"]);
  syncProviders(defaultSettings);
  assert.equal(providers["claude.api-ex"], undefined, "taken away with the setting");
});

test("endpoints: its models come from its /models, with the key; a wrong key or address says so", async () => {
  const seen: { path?: string; auth?: string; version?: string }[] = [];
  const server = createServer((req, res) => {
    seen.push({ path: req.url, auth: req.headers.authorization, version: req.headers["anthropic-version"] as string | undefined });
    if (req.url === "/moved/models") return void res.writeHead(302, { location: "http://example.com/steal" }).end();
    if (req.headers.authorization !== "Bearer sk-ok") return void res.writeHead(401).end();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "a" }, { id: "b" }, { id: "a" }] }));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  try {
    assert.deepEqual(await endpointModels(`http://127.0.0.1:${port}/v1/`, "responses", "sk-ok"), ["a", "b"]);
    assert.equal(seen.at(-1)?.path, "/v1/models");
    assert.deepEqual(await endpointModels(`http://127.0.0.1:${port}`, "anthropic", "sk-ok"), ["a", "b"]);
    assert.deepEqual(seen.at(-1), { path: "/v1/models", auth: "Bearer sk-ok", version: "2023-06-01" }, "Anthropic's under /v1, as Claude Code addresses it");
    await assert.rejects(endpointModels(`http://127.0.0.1:${port}/v1`, "chat", "sk-bad"), /answered 401: check the key/);
    await assert.rejects(endpointModels(`http://127.0.0.1:${port}/moved`, "chat", "sk-ok"), /didn't answer/, "the key doesn't follow a redirect");
    await assert.rejects(endpointModels("api.example.com", "chat"), /starting https:\/\//);
  } finally {
    server.close();
  }
  assert.equal(hostOf("https://api.deepseek.com/anthropic"), "api.deepseek.com");
});

test("tools note: a model is told Liner Code's tools by the names its tool offers them", () => {
  // A small model called the bare name it was told (design_show) where Claude Code offered mcp__liner__design_show.
  assert.match(toolsNote(linerName("claude")), /^- mcp__liner__design_show shows/m);
  assert.match(toolsNote(linerName("claude")), /mcp__liner__browser_read, mcp__liner__browser_click/);
  assert.match(toolsNote(linerName("opencode")), /^- liner_design_show shows/m);
  assert.match(toolsNote(linerName("codex")), /^- design_show shows/m, "Codex lists them under the server's name");
});

test("endpoints: another model reopens the session (its model is in the environment); effort changes in place, by the tool's name for the model", async () => {
  const asked: Pick<OpenOptions, "model" | "effort" | "access">[] = [];
  const session = (): ProviderSession => ({ turn: async () => {}, update: async (u) => (asked.push(u), true), close() {} });
  const base: Provider = { id: "opencode", detect: async () => ({}) as ProviderInfo, open: () => session() };
  const p = endpointProvider(base, ep("chat"), () => "sk");
  const s = p.open({ cwd: "/p", model: "ex-small", effort: "medium", access: "edits", soul: "", guard: false, env: {} });
  assert.equal(await s.update!({ model: "ex-large", effort: "medium", access: "edits" }), false, "another model: reopened");
  assert.equal(await s.update!({ model: "ex-small", effort: "high", access: "edits" }), true);
  assert.deepEqual(asked, [{ model: "liner_api_ex/ex-small", effort: "high", access: "edits" }]);
});

test("endpoints: a redeemed voucher is a tool Settings doesn't list, its one model Flash on Liner Code's site, the voucher its key, its windows the site's", async (t) => {
  const keys = new Map([[endpointKey(VOUCHER.id), "v-test"]]);
  syncProviders({ ...defaultSettings, voucher: true }, keys);
  const p = providers[`opencode.${VOUCHER.id}`];
  assert.ok(p, "on with the setting");
  const c = endpointOptions(VOUCHER, "deepseek-v4.1-flash", "v-test", env);
  assert.equal(c.model, "liner_voucher/deepseek-v4.1-flash");
  assert.deepEqual(JSON.parse(String(c.env.OPENCODE_CONFIG_CONTENT)).provider.liner_voucher.options, { baseURL: "https://linercode.dev/api/code/v1", apiKey: `{env:${KEY_VAR}}` });
  assert.equal(c.env[KEY_VAR], "v-test");

  const real = globalThis.fetch;
  t.after(() => void (globalThis.fetch = real));
  const asked: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    asked.push(`${url} ${new Headers(init?.headers).get("authorization")}`);
    return Response.json({ usage: { rolling: { percent: 30, resetsAt: "2026-11-02T06:00:00.000Z" }, weekly: { percent: 8 } } });
  }) as typeof fetch;
  const l = await p.limits!({ PATH: "/usr/bin" }, "");
  assert.deepEqual(asked, ["https://linercode.dev/api/code/v1/usage Bearer v-test"]);
  assert.equal(l?.plan, "Promo");
  assert.deepEqual(l?.windows.map((w) => [w.kind, w.usedPercent]), [["session", 30], ["weekly", 8]]);

  syncProviders(defaultSettings, keys);
  assert.equal(providers[`opencode.${VOUCHER.id}`], undefined, "off without it");
});
