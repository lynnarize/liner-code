/*
  Check my tools (doctor.ts). Tier 2 is the part that matters: the real tool is pointed at a test model the engine serves, in
  each of the three protocols an endpoint speaks, and asked to write a file and run a command at Read only and at Manual. Here
  the tools are fake CLIs that speak those protocols to it for real (over HTTP, through the endpoint wiring endpoint.ts gives
  a session) and either obey Liner Code, ignore the level and just act, or never ask: the first must pass every check, the
  others must fail the ones they break. Tier 1 reads what the tools say and starts Liner Code's own tools; tier 3 sends one
  message and logs its use under "check", with no session. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Endpoint, ProviderId, ProviderInfo, ToolCheckRow } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { clearScratch, Doctor, probeEnv, RAN_FILE, testModel, WRITE_FILE } from "../src/doctor.ts";
import type { ApprovalRequest, OpenOptions, Provider, ProviderSession, TurnSink } from "../src/providers/types.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";
import { noLeaks } from "./leaks.ts";

noLeaks();

const here = dirname(fileURLToPath(import.meta.url));
const PING = join(here, "ping-mcp.mjs");
type Family = "claude" | "codex" | "opencode";
/** obey: asks Liner Code before each step unless at Full access. ignore: acts whatever the level. silent: refuses everything without asking. */
type Mode = "obey" | "ignore" | "silent";

const info = (id: ProviderId, label: string, more: Partial<ProviderInfo> = {}): ProviderInfo => ({ id, label, available: true, adapter: true, login: `${id} login`, version: "9.9.9", signedIn: true, models: [{ id: "m", label: "M", description: "", isDefault: true }], supports: { approvals: true, resume: true, effort: true, plan: true }, ...more });

function rig(infos: ProviderInfo[], settings: Parameters<Store["setSettings"]>[0] = {}, withLiner = true) {
  const home = mkdtempSync(join(tmpdir(), "lc-doctor-home-"));
  const store = new Store(home);
  store.setSettings(settings);
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home };
  const runtime = new Runtime(store, env);
  runtime.providerInfo = infos;
  const forgot: string[] = [];
  const mcp = withLiner ? { serverFor: () => ({ command: process.execPath, args: [PING], env: {} }), forget: (k: string) => void forgot.push(k) } : undefined;
  const doctor = new Doctor({ store, runtime, env, mcp });
  return { home, store, runtime, doctor, forgot };
}

const check = (rows: ToolCheckRow[], tool: string, id: string) => {
  const c = rows.find((r) => r.tool === tool)?.checks.find((x) => x.id === id);
  assert.ok(c, `${tool} has the check ${id}`);
  return c;
};

/* A fake CLI: it finds the test model where the endpoint wiring says (Claude Code's ANTHROPIC_BASE_URL, Codex's -c model
   provider, OpenCode's OPENCODE_CONFIG_CONTENT), offers its own tools (and Liner Code's when it was given them), and does
   what the model asks as its mode says. */
function fakeCli(family: Family, mode: Mode, seen: { opened: OpenOptions[] } = { opened: [] }): Provider {
  return {
    id: family,
    detect: async () => info(family, family),
    open: (o: OpenOptions): ProviderSession => {
      seen.opened.push(o);
      return {
        close() {},
        async turn(text: string, sink: TurnSink, signal: AbortSignal) {
          const act = async (kind: "write" | "command", path: string, cmd: string): Promise<string> => {
            const req: ApprovalRequest = kind === "write" ? { tool: "Write", title: `Write ${path}`, risk: "low", fields: [{ label: "File", value: path }], rule: "Edit" } : { tool: "Bash", title: `Run ${cmd}`, risk: "low", fields: [{ label: "Command", value: cmd }], rule: cmd.split(" ")[0] };
            const go = mode === "ignore" || o.access === "full" || (mode === "obey" && (await sink.approve(req, signal)).allow);
            if (!go) return "Refused.";
            if (kind === "write") writeFileSync(path, "written\n");
            else execSync(cmd, { cwd: o.cwd, stdio: "ignore", shell: "/bin/sh" });
            return "Done.";
          };
          if (family === "claude") {
            const base = o.env.ANTHROPIC_BASE_URL!;
            const tools = [
              { name: "Write", input_schema: { properties: { file_path: {}, content: {} } } },
              { name: "Bash", input_schema: { properties: { command: {}, description: {} } } },
              ...(o.mcp ? [{ name: "mcp__liner__browser_open", input_schema: { properties: {} } }] : []),
            ];
            const messages: unknown[] = [{ role: "user", content: [{ type: "text", text }] }];
            for (let i = 0; i < 5; i++) {
              const r = (await (await fetch(`${base}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": o.env.ANTHROPIC_AUTH_TOKEN! }, body: JSON.stringify({ model: o.model, max_tokens: 100, tools, messages }) })).json()) as { content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, string> }[] };
              const use = r.content.find((b) => b.type === "tool_use");
              if (!use) return sink.text(r.content.map((b) => b.text ?? "").join(""));
              const out = use.name === "Write" ? await act("write", use.input!.file_path, "") : await act(/liner-check-write/.test(use.input!.command) ? "write" : "command", join(o.cwd, WRITE_FILE), use.input!.command);
              messages.push({ role: "assistant", content: r.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: use.id, content: out }] });
            }
            return;
          }
          if (family === "codex") {
            const cfg = o.config as Record<string, { base_url?: string } | string>;
            const base = (cfg[`model_providers.${cfg.model_provider as string}`] as { base_url: string }).base_url;
            const tools = [{ type: "function", name: "exec_command", parameters: { properties: { cmd: {} } } }, { type: "custom", name: "apply_patch" }, ...(o.mcp ? [{ type: "namespace", name: "mcp__liner" }] : [])];
            const input: unknown[] = [{ role: "user", content: [{ type: "input_text", text }] }];
            for (let i = 0; i < 5; i++) {
              const body = await (await fetch(`${base}/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: o.model, tools, input, stream: true }) })).text();
              const done = body
                .split("\n")
                .filter((l) => l.startsWith("data: "))
                .map((l) => JSON.parse(l.slice(6)) as { type: string; response?: { output: Record<string, string>[] } })
                .find((e) => e.type === "response.completed");
              const item = done!.response!.output[0];
              if (item.type === "message") return sink.text((item as unknown as { content: { text: string }[] }).content[0].text);
              let out: string;
              if (item.type === "custom_tool_call") out = await act("write", join(o.cwd, /Add File: (\S+)/.exec(item.input)![1]), "");
              else {
                const cmd = (JSON.parse(item.arguments) as { cmd: string }).cmd;
                out = await act(/liner-check-write/.test(cmd) ? "write" : "command", join(o.cwd, WRITE_FILE), cmd);
              }
              input.push(item, { type: item.type === "custom_tool_call" ? "custom_tool_call_output" : "function_call_output", call_id: item.call_id, output: out });
            }
            return;
          }
          const cfg = JSON.parse(o.env.OPENCODE_CONFIG_CONTENT!) as { provider: Record<string, { options: { baseURL: string } }> };
          const base = Object.values(cfg.provider)[0].options.baseURL;
          const tools = [
            { type: "function", function: { name: "write", parameters: { properties: { path: {}, content: {} } } } },
            { type: "function", function: { name: "bash", parameters: { properties: { command: {}, description: {} } } } },
            ...(o.mcp ? [{ type: "function", function: { name: "liner_browser_open", parameters: { properties: {} } } }] : []),
          ];
          const messages: unknown[] = [{ role: "user", content: text }];
          for (let i = 0; i < 5; i++) {
            const r = (await (await fetch(`${base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: o.model, tools, messages }) })).json()) as { choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] };
            const m = r.choices[0].message;
            const call = m.tool_calls?.[0];
            if (!call) return sink.text(m.content ?? "");
            const args = JSON.parse(call.function.arguments) as Record<string, string>;
            const out = call.function.name === "write" ? await act("write", args.path, "") : await act("command", "", args.command);
            messages.push(m, { role: "tool", tool_call_id: call.id, content: out });
          }
        },
      };
    },
  };
}

/** Puts fake CLIs in the three tools' places for `run`. */
async function withFakes(modes: Record<Family, Mode>, run: () => Promise<void>) {
  const saved = { claude: providers.claude, codex: providers.codex, opencode: providers.opencode };
  for (const f of Object.keys(modes) as Family[]) providers[f] = fakeCli(f, modes[f]);
  try {
    await run();
  } finally {
    Object.assign(providers, saved);
  }
}

const THREE = [info("claude", "Claude Code"), info("codex", "Codex"), info("opencode", "OpenCode")];
const LEVEL_CHECKS = ["read-write", "read-command", "ask-write", "ask-command"];

test("tier 2: Claude Code, Codex and OpenCode that obey pass every check, each through its own protocol to the test model, leaving nothing behind", async () => {
  const { home, store, doctor, forgot } = rig(THREE);
  await withFakes({ claude: "obey", codex: "obey", opencode: "obey" }, async () => {
    const rows = await doctor.check(2);
    for (const f of ["claude", "codex", "opencode"]) {
      for (const id of ["reach", ...LEVEL_CHECKS, "liner-reach"]) assert.equal(check(rows, f, id).state, "passed", `${f} ${id}: ${check(rows, f, id).detail}`);
      assert.match(check(rows, f, "read-write").detail!, /Liner Code refused it/);
      assert.match(check(rows, f, "ask-command").detail!, /asked Liner Code first/);
      assert.equal(typeof check(rows, f, "reach").at, "number");
    }
  });
  // The scratch folders went, no session was made, nothing was logged as used, and Liner Code's tools' keys were let go.
  assert.deepEqual(existsSync(join(home, "check")) ? readdirSync(join(home, "check")) : [], []);
  assert.equal(store.threads.length, 0);
  assert.equal(store.usage(0).length, 0);
  assert.ok(forgot.length >= 3);
});

test("tier 2: a tool that ignores the level fails Read only and Manual, in every protocol", async () => {
  const { doctor } = rig(THREE);
  await withFakes({ claude: "ignore", codex: "ignore", opencode: "ignore" }, async () => {
    const rows = await doctor.check(2);
    for (const f of ["claude", "codex", "opencode"]) {
      assert.equal(check(rows, f, "reach").state, "passed");
      for (const id of LEVEL_CHECKS) assert.equal(check(rows, f, id).state, "failed", `${f} ${id}`);
      assert.match(check(rows, f, "read-write").detail!, /wrote a file at Read only\. Don't rely on Read only with .* 9\.9\.9/);
      assert.match(check(rows, f, "read-command").detail!, /ran a command at Read only/);
      assert.match(check(rows, f, "ask-command").detail!, /without asking/);
    }
  });
});

test("tier 2: a tool that never asks passes Read only but fails Manual, which must bring each step to you", async () => {
  const { doctor } = rig(THREE);
  await withFakes({ claude: "silent", codex: "silent", opencode: "silent" }, async () => {
    const rows = await doctor.check(2);
    for (const f of ["claude", "codex", "opencode"]) {
      assert.equal(check(rows, f, "read-write").state, "passed");
      assert.match(check(rows, f, "read-write").detail!, /refused it itself/);
      assert.equal(check(rows, f, "ask-write").state, "failed");
      assert.match(check(rows, f, "ask-command").detail!, /didn't ask/);
    }
  });
});

test("tier 2: only one tool breaks, and only its row says so; one that isn't installed isn't probed", async () => {
  const { doctor } = rig([info("claude", "Claude Code"), info("codex", "Codex", { available: false, install: "npm i -g codex" }), info("opencode", "OpenCode")]);
  await withFakes({ claude: "obey", codex: "obey", opencode: "ignore" }, async () => {
    const rows = await doctor.check(2);
    assert.ok(LEVEL_CHECKS.every((id) => check(rows, "claude", id).state === "passed"));
    assert.ok(LEVEL_CHECKS.every((id) => check(rows, "opencode", id).state === "failed"));
    assert.deepEqual(rows.find((r) => r.tool === "codex")?.checks.map((c) => c.id), ["access"], "one row that says why");
    assert.equal(check(rows, "codex", "access").detail, "Not checked: Codex isn't installed.");
  });
});

test("tier 2: tools that can't be pointed at a model say so; an endpoint and an account take their tool's probe", async () => {
  const ep: Endpoint = { id: "ds", label: "DeepSeek", url: "https://api.deepseek.com/anthropic", protocol: "anthropic", models: ["deepseek-chat"] };
  const infos = [info("claude", "Claude Code"), info("claude.ds", "DeepSeek", { endpoint: "api.deepseek.com" }), info("claude.work", "Claude Code · Work", { account: "Work" }), info("hermes", "Hermes"), info("antigravity", "Antigravity"), info("acp.gemini", "Gemini", { added: "registry" }), info("demo", "Demo")];
  const { doctor } = rig(infos, { endpoints: [ep], accounts: [{ id: "work", provider: "claude", label: "Work" }] });
  const seen = { opened: [] as OpenOptions[] };
  const saved = providers.claude;
  providers.claude = fakeCli("claude", "obey", seen);
  try {
    const rows = await doctor.check(2);
    for (const t of ["hermes", "antigravity", "acp.gemini"]) {
      assert.equal(rows.find((r) => r.tool === t)?.checks.length, 1);
      assert.equal(check(rows, t, "access").state, "skipped");
      assert.equal(check(rows, t, "access").detail, "Not checked: this tool can't be pointed at a test model.");
    }
    assert.match(check(rows, "demo", "access").detail!, /Demo/);
    for (const t of ["claude.ds", "claude.work"]) {
      assert.equal(check(rows, t, "reach").state, "passed");
      assert.match(check(rows, t, "reach").detail!, /Checked on Claude Code/);
      assert.ok(LEVEL_CHECKS.every((id) => check(rows, t, id).state === "passed"));
    }
    assert.equal(rows.find((r) => r.tool === "claude.ds")?.kind, "endpoint");
    assert.equal(rows.find((r) => r.tool === "claude.work")?.kind, "account");
    // One probe stood for all three rows: two sessions (Read only and Manual), never the endpoint's own address or your sign-in.
    assert.equal(seen.opened.length, 2);
    for (const o of seen.opened) {
      assert.match(o.env.ANTHROPIC_BASE_URL!, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.equal(o.env.ANTHROPIC_AUTH_TOKEN, "liner-check-dummy-key");
      assert.equal(o.ephemeral, true);
      assert.ok(o.env.CLAUDE_CONFIG_DIR!.includes(`${join("check", "run_")}`), "a config folder of its own");
      assert.deepEqual(new Set(seen.opened.map((x) => x.access)), new Set(["read", "ask"]));
    }
  } finally {
    providers.claude = saved;
  }
});

test("the probe's tool runs with none of your keys or tool settings, and its own folders", () => {
  const env = probeEnv({ PATH: "/bin", HOME: "/Users/me", ANTHROPIC_API_KEY: "sk-ant-real", OPENAI_API_KEY: "sk-real", GITHUB_TOKEN: "ghp_x", CLAUDE_CONFIG_DIR: "/Users/me/.claude-work", CODEX_HOME: "/Users/me/.codex", OPENCODE_CONFIG_CONTENT: "{}", XDG_CONFIG_HOME: "/Users/me/.config", LANG: "en_US.UTF-8" }, "/tmp/x");
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN", "OPENCODE_CONFIG_CONTENT"]) assert.equal(env[k], undefined, k);
  assert.equal(env.CLAUDE_CONFIG_DIR, "/tmp/x/claude");
  assert.equal(env.CODEX_HOME, "/tmp/x/codex");
  assert.equal(env.XDG_CONFIG_HOME, "/tmp/x/config");
  assert.equal(env.HOME, "/tmp/x/home");
  assert.equal(env.XDG_CACHE_HOME, "/Users/me/.cache");
  assert.equal(env.PATH, "/bin");
  assert.equal(env.LANG, "en_US.UTF-8");
  assert.match(env.NO_PROXY!, /127\.0\.0\.1/);
});

test("the test model makes each call the tool offers a way to, and says when it offers none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-doctor-tm-"));
  const fake = await testModel({ read: dir, ask: dir });
  try {
    // Codex with apply_patch as a function, and no command tool at all.
    const ask = async (tools: unknown[], text: string) => (await (await fetch(`${fake.base}/v1/responses`, { method: "POST", body: JSON.stringify({ tools, input: [{ role: "user", content: text }] }) })).text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6))).find((e) => e.type === "response.completed").response.output[0];
    const w = await ask([{ type: "function", name: "apply_patch", parameters: {} }], "go [[liner-check ask write]]");
    assert.equal(w.name, "apply_patch");
    assert.match(JSON.parse(w.arguments).input, /Add File: liner-check-write\.txt/);
    const c = await ask([{ type: "function", name: "apply_patch", parameters: {} }], "go [[liner-check ask command]]");
    assert.equal(c.type, "message");
    assert.ok(fake.seen.none.has("ask-command"));
    // OpenCode 1's write takes filePath; the path is the level's folder.
    const r = (await (await fetch(`${fake.base}/v1/chat/completions`, { method: "POST", body: JSON.stringify({ tools: [{ function: { name: "write", parameters: { properties: { filePath: {}, content: {} } } } }], messages: [{ role: "user", content: "[[liner-check read write]]" }] }) })).json()) as { choices: { message: { tool_calls: { function: { arguments: string } }[] } }[] };
    assert.equal(JSON.parse(r.choices[0].message.tool_calls[0].function.arguments).filePath, join(dir, WRITE_FILE));
    // A request with no marker (a title, a summary) just gets words.
    const plain = (await (await fetch(`${fake.base}/v1/messages`, { method: "POST", body: JSON.stringify({ tools: [{ name: "Bash" }], messages: [{ role: "user", content: "Name this session" }] }) })).json()) as { content: { text: string }[] };
    assert.equal(plain.content[0].text, "OK.");
    assert.equal(fake.seen.requests, 4);
  } finally {
    await fake.close();
  }
});

test("tier 1: found and where, version, sign-in as the tool says it, the model list, and Liner Code's tools starting", async () => {
  const bin = mkdtempSync(join(tmpdir(), "lc-doctor-bin-"));
  writeFileSync(join(bin, "claude"), "#!/bin/sh\n");
  chmodSync(join(bin, "claude"), 0o755);
  // An endpoint that lists its models, on this Mac.
  const srv = createServer((req, res) => (req.url === "/v1/models" ? res.end(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] })) : (res.writeHead(404), res.end())));
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const ep: Endpoint = { id: "lm", label: "LM Studio", url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`, protocol: "chat", models: ["a"] };
  const infos = [info("claude", "Claude Code", { version: "2.1.326 (Claude Code)", detail: "Uses your Claude Code sign-in" }), info("codex", "Codex", { available: false, install: "npm install -g @openai/codex", signedIn: undefined }), info("opencode", "OpenCode", { signedIn: undefined }), info("hermes", "Hermes", { signedIn: false, login: "hermes model" }), info("opencode.lm", "LM Studio", { endpoint: "127.0.0.1" }), info("demo", "Demo")];
  const { doctor, runtime } = rig(infos, { endpoints: [ep] });
  (runtime as unknown as { env: NodeJS.ProcessEnv }).env.PATH = bin;
  (doctor.deps.env as NodeJS.ProcessEnv).PATH = bin;
  const saved = { claude: providers.claude, opencode: providers.opencode };
  providers.claude = { ...fakeCli("claude", "obey"), models: async () => [{ id: "x", label: "X", description: "" }, { id: "y", label: "Y", description: "" }] };
  providers.opencode = { ...fakeCli("opencode", "obey"), models: async () => [] };
  let looked = 0;
  (doctor.deps as { look?: () => Promise<unknown> }).look = async () => void looked++;
  try {
    const rows = await doctor.check(1);
    assert.equal(looked, 1, "the tools are found again first");
    assert.equal(check(rows, "claude", "found").state, "passed");
    assert.equal(check(rows, "claude", "found").detail, join(bin, "claude"));
    assert.equal(check(rows, "claude", "version").detail, "2.1.326 (Claude Code)");
    assert.equal(check(rows, "claude", "signin").state, "passed");
    assert.equal(check(rows, "claude", "models").detail, "It listed 2 models");
    assert.equal(check(rows, "claude", "liner").state, "passed");
    assert.match(check(rows, "claude", "liner").detail!, /^1 tools ready/);
    assert.equal(check(rows, "codex", "found").state, "failed");
    assert.match(check(rows, "codex", "found").detail!, /npm install -g @openai\/codex/);
    assert.deepEqual(rows.find((r) => r.tool === "codex")?.checks.map((c) => c.id), ["found"], "one that isn't there has only the row that says so");
    assert.equal(check(rows, "opencode", "signin").state, "skipped");
    assert.equal(check(rows, "opencode", "models").state, "failed");
    assert.equal(check(rows, "hermes", "signin").state, "failed");
    assert.match(check(rows, "hermes", "signin").detail!, /hermes model/);
    assert.match(check(rows, "opencode.lm", "models").detail!, /lists 2 models/);
    assert.equal(check(rows, "opencode.lm", "signin").state, "passed");
    assert.equal(check(rows, "demo", "found").detail, "Built into Liner Code");
    assert.equal(rows.find((r) => r.tool === "demo")?.checks.some((c) => c.id === "liner"), false);
    // Kept, with tier 2 beside it later; a tier run again replaces only its own.
    assert.equal(doctor.rows().find((r) => r.tool === "claude")?.checks.length, 5);
  } finally {
    Object.assign(providers, saved);
    srv.close();
  }
});

test("tier 1 without Liner Code's tools running says so rather than failing", async () => {
  const { doctor } = rig([info("hermes", "Hermes")], {}, false);
  const saved = providers.hermes;
  providers.hermes = { id: "hermes", detect: async () => info("hermes", "Hermes"), open: () => assert.fail("tier 1 opens no session") };
  try {
    const rows = await doctor.check(1, "hermes");
    assert.equal(check(rows, "hermes", "liner").state, "skipped");
    assert.equal(check(rows, "hermes", "models").detail, "1 model it's known to run");
  } finally {
    providers.hermes = saved;
  }
});

test("tier 3: a tool's test message goes on its account, with no session, and its use is logged under check", async () => {
  const { store, doctor } = rig([info("claude", "Claude Code", { models: [{ id: "claude-opus-5-5", label: "Opus", description: "", isDefault: true }, { id: "claude-haiku-5", label: "Haiku", description: "" }] }), info("codex", "Codex", { signedIn: false })]);
  const opened: OpenOptions[] = [];
  const saved = { claude: providers.claude, codex: providers.codex };
  providers.claude = { id: "claude", detect: async () => info("claude", "x"), open: (o) => (opened.push(o), { close() {}, turn: async (_t, sink) => (sink.text("ready"), sink.usage({ inputTokens: 12, outputTokens: 1 })) }) };
  providers.codex = { id: "codex", detect: async () => info("codex", "x"), open: () => assert.fail("not signed in: nothing is sent") };
  try {
    const rows = await doctor.check(3);
    assert.equal(check(rows, "claude", "reply").state, "passed");
    assert.match(check(rows, "claude", "reply").detail!, /ready/);
    assert.equal(check(rows, "codex", "reply").state, "skipped");
    assert.equal(opened[0].model, "claude-haiku-5", "the quickest model, which costs least");
    assert.equal(opened[0].ephemeral, true);
    assert.equal(opened[0].access, "read");
    assert.equal(store.threads.length, 0);
    const used = store.usage(0);
    assert.equal(used.length, 1);
    assert.deepEqual([used[0].agent, used[0].threadId, used[0].provider, used[0].inputTokens], ["check", "", "claude", 12]);
  } finally {
    Object.assign(providers, saved);
  }
});

test("tier 3: an endpoint answers over plain HTTP, and its tool call through its tool is checked by what the file said", async () => {
  // A Chat Completions endpoint that answers in words.
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "ready" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
    });
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const eps: Endpoint[] = ["good", "talky", "broken"].map((id) => ({ id, label: id, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`, protocol: "chat" as const, models: ["m1"] }));
  const { store, doctor } = rig(eps.map((e) => info(`opencode.${e.id}` as ProviderId, e.label, { endpoint: "127.0.0.1" })), { endpoints: eps });
  const read = (o: OpenOptions) => readFileSync(join(o.cwd, "liner-check.txt"), "utf8").trim();
  const fake = (turn: (o: OpenOptions, sink: TurnSink) => void): Provider => ({ id: "opencode", detect: async () => info("opencode", "x"), open: (o) => ({ close() {}, turn: async (_t, sink) => turn(o, sink) }) });
  const saved = { ...providers };
  providers["opencode.good" as ProviderId] = fake((o, sink) => (sink.tool({ key: "r", tool: "read", toolKind: "read", title: "Read liner-check.txt", status: "done" }), sink.text(read(o))));
  providers["opencode.talky" as ProviderId] = fake((_o, sink) => sink.text("I can't read files."));
  providers["opencode.broken" as ProviderId] = fake((_o, sink) => sink.error("The endpoint refused the tools field."));
  try {
    const rows = await doctor.check(3);
    for (const e of eps) assert.equal(check(rows, `opencode.${e.id}`, "plain").state, "passed");
    assert.match(check(rows, "opencode.good", "plain").detail!, /m1 answered “ready”/);
    assert.equal(check(rows, "opencode.good", "toolcall").state, "passed");
    assert.equal(check(rows, "opencode.talky", "toolcall").state, "failed");
    assert.match(check(rows, "opencode.talky", "toolcall").detail!, /without calling a tool/);
    assert.equal(check(rows, "opencode.broken", "toolcall").detail, "The endpoint refused the tools field.");
    assert.equal(check(rows, "opencode.good", "toolcall").label, "Makes a tool call through OpenCode");
    assert.equal(rows[0].checks.some((c) => c.id === "reply"), false);
    // Two messages each, logged under check.
    assert.equal(store.usage(0).filter((u) => u.agent === "check").length, 6);
  } finally {
    for (const k of Object.keys(providers)) if (!(k in saved)) delete providers[k as ProviderId];
    srv.close();
  }
});

test("tools.check and tools.checked through the engine's API, results kept in memory", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-doctor-api-"));
  mkdirSync(home, { recursive: true });
  const store = new Store(home);
  const runtime = new Runtime(store, { PATH: "/usr/bin:/bin" });
  const saved = providers.hermes;
  providers.hermes = { id: "hermes", detect: async () => info("hermes", "Hermes"), open: () => assert.fail("no session") };
  const api = createApi(store, runtime, { PATH: "/usr/bin:/bin", HOME: home }, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  try {
    await api.ready;
    const rows = (await api.call("tools.check", { tool: "hermes", tier: 2 })) as ToolCheckRow[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].checks[0].id, "access");
    const kept = (await api.call("tools.checked", {})) as ToolCheckRow[];
    assert.equal(kept.find((r) => r.tool === "hermes")?.checks[0].state, "skipped");
    await assert.rejects(api.call("tools.check", { tool: "nope", tier: 1 }), /doesn't know that tool/);
    await assert.rejects(api.call("tools.check", { tier: 4 }), /three tiers/);
  } finally {
    providers.hermes = saved;
  }
});

// A level's files are what the checks read: their names don't change under the tools.
test("the files the test model's calls make", () => {
  assert.equal(WRITE_FILE, "liner-check-write.txt");
  assert.equal(RAN_FILE, "liner-check-ran.txt");
});

test("overlapping tier 1 checks share one look, one start of Liner Code's tools, and one model list a tool", async () => {
  const { doctor } = rig([info("claude", "Claude Code"), info("hermes", "Hermes"), info("opencode", "OpenCode")]);
  let looks = 0;
  let starts = 0;
  const lists: Record<string, number> = {};
  (doctor.deps as { look?: () => Promise<unknown> }).look = async () => (looks++, new Promise((r) => setTimeout(r, 30)));
  const real = doctor.deps.mcp!.serverFor;
  doctor.deps.mcp!.serverFor = (k: string) => (starts++, real(k));
  const saved = { claude: providers.claude, hermes: providers.hermes, opencode: providers.opencode };
  for (const id of ["claude", "hermes", "opencode"] as const) providers[id] = { id, detect: async () => info(id, id), models: async () => ((lists[id] = (lists[id] ?? 0) + 1), [{ id: "m", label: "M", description: "" }]), open: () => assert.fail("no session") };
  try {
    // The page asking per tool, twice over, and once for all: all at the same time.
    const rows = (await Promise.all([doctor.check(1, "claude"), doctor.check(1, "hermes"), doctor.check(1, "opencode"), doctor.check(1, "claude"), doctor.check(1)])).flat();
    assert.equal(looks, 1, "one look at the tools");
    assert.equal(starts, 1, "Liner Code's tools started once");
    assert.deepEqual(lists, { claude: 1, hermes: 1, opencode: 1 }, "each tool listed its models once");
    assert.ok(rows.filter((r) => r.tool === "claude").every((r) => r.checks.find((c) => c.id === "models")?.state === "passed"));
  } finally {
    Object.assign(providers, saved);
  }
});

test("N overlapping tools.check calls through the API run the look once", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-doctor-api2-"));
  const store = new Store(home);
  const runtime = new Runtime(store, { PATH: "/usr/bin:/bin" });
  let looks = 0;
  const saved = providers.hermes;
  providers.hermes = { id: "hermes", detect: async () => (looks++, info("hermes", "Hermes")), open: () => assert.fail("no session") };
  const api = createApi(store, runtime, { PATH: "/usr/bin:/bin", HOME: home }, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  try {
    await api.ready;
    const before = looks;
    await Promise.all(Array.from({ length: 6 }, () => api.call("tools.check", { tool: "hermes", tier: 1 })));
    assert.equal(looks - before, 1);
  } finally {
    providers.hermes = saved;
  }
});

test("scratch folders a stopped check left are cleared when the doctor starts, and nothing else is", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-doctor-stale-"));
  const root = join(home, "check");
  for (const d of ["run_abc123", "msg_x9", "notes", "run_ABC"]) mkdirSync(join(root, d, "inner"), { recursive: true });
  writeFileSync(join(root, "run_file1"), "a file, not a folder");
  writeFileSync(join(home, "keep.txt"), "outside");
  rig([]);
  const store = new Store(home);
  new Doctor({ store, runtime: new Runtime(store, {}), env: {} });
  assert.deepEqual(readdirSync(root).sort(), ["notes", "run_ABC", "run_file1"]);
  assert.ok(existsSync(join(home, "keep.txt")));
  // Before a probe, only ones older than an hour go: a check running beside it keeps its folder.
  mkdirSync(join(root, "run_fresh1"));
  clearScratch(root, 3600_000);
  assert.ok(existsSync(join(root, "run_fresh1")));
});
