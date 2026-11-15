/*
  The engine as the packaged app runs it (engine/build.ts): one .js per entry where engine/src is,
  with the files it reads beside it, so what it finds from its own folder (paths.ts) holds as from
  source; the engine starts from it and says its version; each process of its own it starts (an
  agent's tools, a tool outside the app, a DSH plugin's tools and host) starts from its .js; and the
  compile cache lands in the engine's home. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { BUNDLED, enginePath, script } from "../src/paths.ts";
import { FRAME_AGENT } from "../src/canvas.ts";
import { LINER_2 } from "../src/creator.ts";
import { FORESHORE } from "../src/providers/demo-canvas.ts";
import { VERSION } from "../src/version.ts";

const repo = join(import.meta.dirname, "../..");
const ENTRIES = ["mcp", "outside", "dsh-mcp", "dsh-host", "dsh-shims"];

test("paths from source: the .ts entries, and the files the engine reads, found from engine/src", () => {
  assert.equal(BUNDLED, false);
  for (const e of ["main", ...ENTRIES]) assert.ok(existsSync(script(e)) && script(e).endsWith(`${e}.ts`), e);
  for (const f of [FRAME_AGENT, LINER_2, join(FORESHORE, "DESIGN.md"), enginePath("../../package.json")]) assert.ok(existsSync(f), f);
  assert.equal(VERSION, (JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version: string }).version);
});

/** Speaks MCP to an entry on stdio: initialize, then ping. Anything on stderr comes back too: an MCP client may take it for a failure. */
async function pings(file: string, env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [file], { env, stdio: ["pipe", "pipe", "pipe"] });
  const got: { id?: number; result?: { serverInfo?: { version?: string } } }[] & { err?: string } = [];
  got.err = "";
  child.stderr.on("data", (d: Buffer) => (got.err += d.toString()));
  createInterface({ input: child.stdout }).on("line", (l) => void got.push(JSON.parse(l)));
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}\n`);
  for (let i = 0; i < 500 && got.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  child.kill();
  return got;
}

test("the bundle: built where engine/src would be, it starts, says its version, keeps a compile cache, and each entry starts from its .js", { timeout: 60_000 }, async () => {
  const app = mkdtempSync(join(tmpdir(), "lc-bundle-"));
  execFileSync(process.execPath, [join(repo, "engine/build.ts"), app], { stdio: "pipe" });
  const src = join(app, "engine/src");
  for (const f of ["main.js", "engine.js", ...ENTRIES.map((e) => `${e}.js`), "skills/liner-2/SKILL.md", "providers/demo-foreshore/DESIGN.md", "../package.json", "../../contracts/src/frame-agent.js"]) assert.ok(existsSync(join(src, f)), f);
  assert.ok(!existsSync(join(src, "main.ts")), "no source beside the bundle");
  // dsh-host imports dsh-shims.js rather than carrying a copy, so the plugin's shims (by URL) are the module it uses.
  const host = readFileSync(join(src, "dsh-host.js"), "utf8");
  assert.match(host, /from "\.\/dsh-shims\.js"/);
  assert.doesNotMatch(host, /class HarnessError/);
  // The staged app around it: its package.json, and only the Agent SDK in node_modules, as the build scripts copy it,
  // so a bundle that needed any other package would fail here.
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "liner-code", version: "9.8.7", type: "module" }));
  cpSync(join(repo, "node_modules/@anthropic-ai/claude-agent-sdk"), join(app, "node_modules/@anthropic-ai/claude-agent-sdk"), { recursive: true });
  const home = join(app, "home");
  mkdirSync(home);
  const env = { PATH: "/usr/bin:/bin", HOME: home, LINER_HOME: home };
  const engine = spawn(process.execPath, [join(src, "main.js"), "--port", "0", "--dev"], { env, stdio: ["pipe", "pipe", "pipe"] });
  let err = "";
  engine.stderr.on("data", (d: Buffer) => (err += d));
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let out = "";
      engine.stdout.on("data", (d: Buffer) => {
        out += d.toString();
        const m = /LINER_READY (\{.*\})/.exec(out);
        if (m) resolve((JSON.parse(m[1]) as { port: number }).port);
      });
      engine.once("exit", (code) => reject(new Error(`the engine stopped (${code}): ${err}`)));
      setTimeout(() => reject(new Error("the engine didn't start in time")), 20_000).unref();
    });
    const r = (await (await fetch(`http://127.0.0.1:${port}/rpc`, { method: "POST", headers: { "content-type": "application/json", "x-liner-token": "liner-dev" }, body: JSON.stringify({ method: "state.get", params: {} }) })).json()) as { ok: boolean; result: { version: string } };
    assert.equal(r.result.version, "9.8.7", "version.ts reads the staged package.json, two folders up from the bundle");
    // Written once the engine is up (flushCompileCache), into a folder of this Node's own.
    const v8 = join(home, "cache", "v8");
    const written = () => existsSync(v8) && readdirSync(v8).some((d) => d.startsWith(`v${process.versions.node}-`) && readdirSync(join(v8, d)).length > 0);
    for (let i = 0; i < 100 && !written(); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(written(), "the compile cache is written into the engine's home");
    // outside.ts: the path 0.2.6 and before told people to register with their own tools, run as they saved it.
    for (const [e, extra] of [["mcp.js", {}], ["outside.js", {}], ["outside.ts", {}], ["dsh-mcp.js", { LINER_DSH_NAME: "Fake" }]] as const) {
      const got = await pings(join(src, e), { ...env, ...extra });
      assert.equal(got.find((m) => m.id === 1)?.result?.serverInfo?.version, "9.8.7", e);
      assert.ok(got.some((m) => m.id === 2), e);
      assert.equal(got.err, "", `${e} says nothing on stderr`);
    }
  } finally {
    engine.kill();
  }
});

test("the bundle: dsh-host.js runs a DSH plugin that imports DSH's tools and settings packages, which it gets as dsh-shims.js", { timeout: 30_000 }, async () => {
  const app = mkdtempSync(join(tmpdir(), "lc-bundle-dsh-"));
  execFileSync(process.execPath, [join(repo, "engine/build.ts"), app], { stdio: "pipe" });
  const plug = join(app, "plugin");
  mkdirSync(join(plug, "lib"), { recursive: true });
  writeFileSync(join(plug, "package.json"), JSON.stringify({ name: "dsh-fake", type: "module", main: "lib/index.js" }));
  writeFileSync(
    join(plug, "lib/index.js"),
    `import { defineTool, HarnessError } from '@deepseek-ai/dsh-tools'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
export const name = 'dsh-fake'
export const inject = ['tools']
const text = (_a, v) => [{ type: 'text', text: String(v) }]
export function apply(ctx) {
  if (!(new SettingsConflictError('x') instanceof HarnessError)) throw new Error('two copies of the shims')
  ctx.inject(['tools'], (s) => s.tools.register(defineTool({ name: 'shout', description: 'Capitals.', parameters: { text: { type: 'string', required: true } }, output: { schema: { type: 'string' }, render: text }, async execute(a) { return a.text.toUpperCase() + '!' } })))
}
`,
  );
  const host = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(app, "engine/src/dsh-host.js")], { cwd: plug, env: { PATH: "/usr/bin:/bin", HOME: app, DSH_HOME: join(app, "dsh"), NODE_NO_WARNINGS: "1" }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let log = "";
  host.stdout!.on("data", (d: Buffer) => (log += d));
  host.stderr!.on("data", (d: Buffer) => (log += d));
  const msgs: { t: string; error?: string; tools?: { name: string }[]; content?: { text: string }[] }[] = [];
  host.on("message", (m) => void msgs.push(m as (typeof msgs)[number]));
  const until = async (t: string) => {
    for (let i = 0; i < 250 && !msgs.some((m) => m.t === t || m.t === "failed"); i++) await new Promise((r) => setTimeout(r, 20));
  };
  try {
    host.send({ t: "start", dir: plug, entry: "lib/index.js", config: {}, name: "Fake", secret: "s".repeat(32), model: null, tools: ["shout"] });
    await until("ready");
    const ready = msgs.find((m) => m.t === "ready" || m.t === "failed");
    assert.equal(ready?.t, "ready", `${ready?.error ?? ""} ${log}`);
    assert.deepEqual(ready?.tools?.map((t) => t.name), ["shout"]);
    host.send({ t: "call", call: "c1", name: "shout", args: { text: "tide" } });
    await until("result");
    assert.equal(msgs.find((m) => m.t === "result")?.content?.[0]?.text, "TIDE!");
  } finally {
    host.kill();
  }
});
