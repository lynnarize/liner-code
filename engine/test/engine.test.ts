/*
  The engine's pure parts: what the Reviewer's answer means, who checks whom, who fills the parts
  of each pairing, how a Claude writer's helpers are set up, how settings from before modes and
  sessions of a deleted agent carry on, when a routine fires next and what its prompt says, the Browser
  surface's proxy, and the secrets the engine keeps from what it starts. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import type { Access, AgentProfile, ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { castOf, checkerOf, emptyUsage, frontiersOf, makerOf, smallChange } from "../../contracts/src/index.ts";
import { claudeTeam, parseFindings, quickOf, subagentName } from "../src/review.ts";
import { contextSources } from "../src/providers/claude.ts";
import { describeTrigger, fill, nextRun, sameSecret } from "../src/routines.ts";
import { Proxies } from "../src/proxy.ts";
import { compareWays, githubName } from "../src/api.ts";
import { clean, isPrAsk } from "../src/runtime.ts";
import { testCommand, testSummary } from "../src/prflow.ts";
import { defaultSettings, fourLevels, fromWorkStyle, Store } from "../src/store.ts";
import { run, secretsFrom, takeSecrets } from "../src/exec.ts";
import { sessionMarkdown } from "../src/export.ts";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agent = (p: Partial<AgentProfile>): AgentProfile => ({ id: "forge", name: "Forge", role: "Code", glyph: "code", specialty: "coder", model: "claude:claude-sonnet-5-5", effort: "medium", soul: "", ...p });
const provider = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });

test("findings: a blocker fails the verdict even when the model said pass", () => {
  const r = parseFindings(`Looks fine.\n<findings>{"verdict":"pass","summary":"ok","findings":[{"file":"./src/a.ts","line":4,"severity":"blocking","note":"leaks a key"}]}</findings>`);
  assert.equal(r?.verdict, "fail");
  assert.equal(r?.findings[0].file, "src/a.ts");
  assert.equal(r?.findings[0].severity, "blocking");
});

test("findings: notes alone pass; garbage gives nothing", () => {
  assert.equal(parseFindings(`<findings>{"verdict":"pass","findings":[{"file":"a.ts","note":"a nit"}]}</findings>`)?.verdict, "pass");
  assert.equal(parseFindings("no tags here"), null);
  assert.equal(parseFindings("<findings>{not json</findings>"), null);
  // The format echoed before the real block, a code fence round the JSON, a verdict in capitals, prose with a brace first.
  const echoed = parseFindings(`I'll answer as <findings>{"verdict":"pass"|"fail"}</findings> asks.\n<findings>\n\`\`\`json\n{"verdict":"FAIL","summary":"x","findings":[{"file":"a.ts","severity":"Blocking","note":"breaks"}]}\n\`\`\`\n</findings>`);
  assert.deepEqual([echoed?.verdict, echoed?.findings[0].severity], ["fail", "blocking"]);
  assert.equal(parseFindings(`It uses {braces} in prose. {"verdict":"FAIL","summary":"no","findings":[]}`)?.verdict, "fail");
});

test("makers: by the model's name first, so a model keeps its maker in any tool", () => {
  assert.equal(makerOf("claude:claude-opus-5-5"), "anthropic");
  assert.equal(makerOf("hermes:nous:openai/gpt-6-astra"), "openai");
  assert.equal(makerOf("hermes:nous:anthropic/claude-opus-5.5"), "anthropic");
  assert.equal(makerOf("claude.api-deepseek:deepseek-v4-pro"), "deepseek", "DeepSeek through Claude Code's endpoint is DeepSeek's");
  assert.equal(makerOf("opencode:opencode/glm-5.3-flash-free"), "zhipu");
  assert.equal(makerOf("opencode-go:kimi-k3"), "moonshot");
  assert.equal(makerOf("upstage:solar-pro4"), "other", "Solar isn't GPT Sol");
  assert.equal(makerOf("codex:default"), "openai");
});

test("permissions: four levels, Auto by default; the old default and the levels that went move once", () => {
  assert.equal(defaultSettings.defaultAccess, "auto");
  const t = (id: string, access: Access, extra: Partial<Thread> = {}): Thread => ({ id, projectId: "p", title: id, agent: "forge", status: "idle", access, turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1, ...extra });
  const threads = [t("a", "edits"), t("b", "read"), t("c", "full"), t("d", "review"), t("e", "ask"), t("side", "read", { sideOf: "a" }), t("run", "read", { routine: { id: "r", run: "x" } })];
  // Asks first was the default nobody picked: Auto now. Edits on its own is Auto, Read only Manual; side chats and routine runs still only read.
  const moved = fourLevels({ settings: { ...defaultSettings, defaultAccess: "ask", accessVersion: undefined }, threads });
  assert.deepEqual([moved.settings.defaultAccess, moved.settings.accessVersion], ["auto", 2]);
  assert.deepEqual(moved.threads.map((x) => x.access), ["auto", "ask", "full", "review", "ask", "read", "read"]);
  // A default you chose that's still offered stays.
  assert.equal(fourLevels({ settings: { ...defaultSettings, defaultAccess: "review" }, threads: [] }).settings.defaultAccess, "review");
  // Once, on start: a home from before moves; after that, what you pick stays.
  const home = mkdtempSync(join(tmpdir(), "lc-levels-"));
  writeFileSync(join(home, "state.json"), JSON.stringify({ projects: [], threads, agents: [], settings: { ...defaultSettings, defaultAccess: "ask", accessVersion: undefined }, groups: [] }));
  const store = new Store(home);
  assert.deepEqual([store.settings.defaultAccess, store.thread("a").access], ["auto", "auto"]);
  store.setSettings({ defaultAccess: "ask" });
  store.flush();
  assert.equal(new Store(home).settings.defaultAccess, "ask");
});

test("checks: another maker than the writer's reads it, from the cast", () => {
  const cast = { everyday: "codex:gpt-6-luna", strong: "claude:claude-opus-5-5", judge: "claude:claude-opus-5-5", critics: ["codex:gpt-6-sol"] };
  assert.equal(checkerOf("codex:gpt-6-luna", cast), "claude:claude-opus-5-5");
  assert.equal(checkerOf("claude:claude-sonnet-5-5", cast), "codex:gpt-6-sol");
  assert.equal(checkerOf("opencode:opencode/deepseek-v4.1-flash-free", cast), "claude:claude-opus-5-5");
  // One maker only: another model of it, never the writer itself.
  assert.equal(checkerOf("claude:claude-opus-5-5", { everyday: "claude:claude-sonnet-5-5", strong: "claude:claude-opus-5-5", judge: "claude:claude-opus-5-5", critics: [] }), "claude:claude-sonnet-5-5");
  assert.equal(checkerOf("claude:claude-opus-5-5", null), null);
});

test("checks: the checker you picked reads it, even of the writer's own maker; never the writer itself", () => {
  const claude = provider("claude", ["claude-opus-5-5", "claude-sonnet-5-5"]);
  const hermes = provider("hermes", ["nous:openai/gpt-6-astra"]);
  const picks = { frontier: "claude:claude-opus-5-5", cheaper: "claude:claude-sonnet-5-5", checker: "claude:claude-opus-5-5" };
  const cast = castOf([claude, hermes], { picks });
  // Sonnet builds, Opus checks, as Settings says; Astra in Hermes is only for when there's no pick.
  assert.equal(checkerOf("claude:claude-sonnet-5-5", cast), "claude:claude-opus-5-5");
  assert.equal(checkerOf("claude:claude-sonnet-5-5", castOf([claude, hermes], { picks: { ...picks, checker: undefined } })), "hermes:nous:openai/gpt-6-astra");
  // Opus wrote it: it doesn't check itself; another maker's model does.
  assert.equal(checkerOf("claude:claude-opus-5-5", cast), "hermes:nous:openai/gpt-6-astra");
  // A pick whose tool went away is automatic again.
  assert.equal(checkerOf("claude:claude-sonnet-5-5", castOf([claude, hermes], { picks: { ...picks, checker: "codex:gpt-6-sol" } })), "hermes:nous:openai/gpt-6-astra");
});

test("your models: frontier + cheaper, dual frontier with Astra wherever it runs, your picks with Chinese models", () => {
  const claude = provider("claude", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
  const codex = provider("codex", ["gpt-6-luna", "gpt-5.6-terra"]);
  const hermes = provider("hermes", ["nous:openai/gpt-6-astra-pro", "nous:openai/gpt-6-astra", "nous:openai/gpt-6-luna", "nous:anthropic/claude-opus-5.5"]);
  const opencode = provider("opencode", ["opencode/deepseek-v4.1-flash-free", "opencode/glm-5.3-flash-free"]);
  const all = [claude, codex, hermes, opencode];
  // Automatic: DeepSeek Flash does the everyday work (ahead of GPT Luna), Opus in Claude Code the hard jobs.
  assert.deepEqual(castOf(all), { everyday: "opencode:opencode/deepseek-v4.1-flash-free", strong: "claude:claude-opus-5-5", judge: "claude:claude-opus-5-5", critics: ["hermes:nous:openai/gpt-6-astra", "opencode:opencode/deepseek-v4.1-flash-free"] });
  // Without DeepSeek or Sol, Sonnet builds: the workers of the tier list come before Terra and Luna.
  assert.equal(castOf([claude, codex, hermes])!.everyday, "claude:claude-sonnet-5-5");
  // Codex alone: Astra plans, Sol builds; without Astra, Sol plans and Terra builds.
  const full = provider("codex", ["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"]);
  assert.deepEqual([castOf([full])!.strong, castOf([full])!.everyday], ["codex:gpt-6-astra", "codex:gpt-6.1-sol"]);
  const noAstra = provider("codex", ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"]);
  assert.deepEqual([castOf([noAstra])!.strong, castOf([noAstra])!.everyday], ["codex:gpt-6.1-sol", "codex:gpt-6.1-terra"]);
  // Claude Code and Codex: Opus plans, Sol builds (an eighth of Sonnet's cost a task), Opus judges.
  const pair = castOf([claude, full])!;
  assert.deepEqual([pair.strong, pair.everyday, pair.judge], ["claude:claude-opus-5-5", "codex:gpt-6.1-sol", "claude:claude-opus-5-5"]);
  // Dual: your frontier model (Opus) still plans; Astra, the best of another maker (here through Hermes, not its Pro), builds.
  assert.deepEqual(frontiersOf(all), { frontier: "claude:claude-opus-5-5", second: "hermes:nous:openai/gpt-6-astra" });
  assert.deepEqual(castOf(all, { dual: true }), { everyday: "hermes:nous:openai/gpt-6-astra", strong: "claude:claude-opus-5-5", judge: "claude:claude-opus-5-5", critics: ["hermes:nous:openai/gpt-6-astra", "opencode:opencode/deepseek-v4.1-flash-free"] });
  // Opus building instead: pick Astra as your frontier model and Opus as the second.
  const swapped = castOf(all, { dual: true, picks: { frontier: "hermes:nous:openai/gpt-6-astra", second: "claude:claude-opus-5-5" } })!;
  assert.deepEqual([swapped.strong, swapped.everyday], ["hermes:nous:openai/gpt-6-astra", "claude:claude-opus-5-5"]);
  // Dual with no other maker's frontier model ready is frontier + cheaper.
  assert.deepEqual(castOf([claude, codex], { dual: true }), castOf([claude, codex]));
  // Your picks: DeepSeek builds, Opus takes the hard jobs; the checker follows from them.
  const mine = castOf(all, { picks: { cheaper: "opencode:opencode/deepseek-v4.1-flash-free" } })!;
  assert.deepEqual([mine.everyday, mine.strong, mine.judge], ["opencode:opencode/deepseek-v4.1-flash-free", "claude:claude-opus-5-5", "claude:claude-opus-5-5"]);
  // A pick counts while its tool is ready.
  assert.equal(castOf([claude], { picks: { cheaper: "opencode:opencode/deepseek-v4.1-flash-free" } })!.everyday, "claude:claude-sonnet-5-5");
  // The quick step-checker stays with the reviewer's maker in a tool that runs many.
  assert.equal(quickOf("hermes:nous:openai/gpt-6-astra", [provider("hermes", ["nous:anthropic/claude-haiku-5.5", "nous:openai/gpt-5.4-mini"])]), "hermes:nous:openai/gpt-5.4-mini");
});

test("without Claude Code or Codex: the parts fill from any maker, Chinese models too", () => {
  // OpenCode Go only: DeepSeek Flash does it all (so Plan is Solo), GLM-5.3 Flash judges, GLM-5.3 and Kimi critique; Go's caps leave Dual nothing to build with.
  const go = [provider("opencode", ["opencode-go:deepseek-v4-pro", "opencode-go:deepseek-v4.1-flash", "opencode-go:kimi-k3", "opencode-go:glm-5.3", "opencode-go:glm-5.3-flash", "opencode-go:qwen3.8-max", "opencode-go:qwen3.8-flash"])];
  assert.deepEqual(castOf(go), { everyday: "opencode:opencode-go:deepseek-v4.1-flash", strong: "opencode:opencode-go:deepseek-v4.1-flash", judge: "opencode:opencode-go:glm-5.3-flash", critics: ["opencode:opencode-go:glm-5.3", "opencode:opencode-go:kimi-k3"] });
  // Go's whole lineup: DeepSeek V4.1 Flash builds ahead of GPT Luna, and MiMo V2.6 Pro and GLM-5.3 are the critics.
  const lineup = [provider("opencode", ["opencode-go/grok-4.7", "opencode-go/glm-5.3-flash", "opencode-go/glm-5.3", "opencode-go/glm-5.2", "opencode-go/gpt-6-luna", "opencode-go/gpt-5.6-luna", "opencode-go/claude-haiku-5.5", "opencode-go/gemini-4-argon", "opencode-go/kimi-k3.1-pro", "opencode-go/kimi-k3", "opencode-go/kimi-k2.7-code", "opencode-go/mimo-v2.6-flash", "opencode-go/mimo-v2.6-pro", "opencode-go/mimo-v2.5-pro", "opencode-go/minimax-m3", "opencode-go/qwen3.8-max", "opencode-go/deepseek-v4.1-flash", "opencode-go/deepseek-v4-pro"])];
  // V4.1 Flash is the frontier model too, ahead of Grok 4.7 and V4 Pro.
  const full = castOf(lineup)!;
  assert.deepEqual([full.everyday, full.strong, full.critics], ["opencode:opencode-go/deepseek-v4.1-flash", "opencode:opencode-go/deepseek-v4.1-flash", ["opencode:opencode-go/mimo-v2.6-pro", "opencode:opencode-go/glm-5.3"]]);
  // GLM-5.3 Flash judges and checks, but never takes the hard work; with Go's caps, Dual has no second model to build.
  assert.equal(full.judge, "opencode:opencode-go/glm-5.3-flash");
  assert.equal(checkerOf(full.everyday, full), "opencode:opencode-go/glm-5.3-flash");
  const dual = castOf(lineup, { dual: true })!;
  assert.deepEqual([dual.everyday, dual.strong, dual.judge], ["opencode:opencode-go/deepseek-v4.1-flash", "opencode:opencode-go/deepseek-v4.1-flash", "opencode:opencode-go/glm-5.3-flash"]);
  // Outside Go (no caps), the same lineup plans by the tier list: Gemini 4 Argon plans, DeepSeek Flash builds.
  const zen = castOf([provider("opencode", lineup[0].models.map((m) => m.id.replace("opencode-go/", "zen/")))])!;
  assert.deepEqual([zen.strong, zen.everyday], ["opencode:zen/gemini-4-argon", "opencode:zen/deepseek-v4.1-flash"]);
  // A newer GLM takes over on its own, wherever it's listed: its Flash judges, its frontier model critiques.
  const later = castOf([provider("opencode", [...lineup[0].models.map((m) => m.id), "opencode-go/glm-5.10", "opencode-go/glm-5.10-flash"])])!;
  assert.deepEqual([later.judge, later.critics], ["opencode:opencode-go/glm-5.10-flash", ["opencode:opencode-go/mimo-v2.6-pro", "opencode:opencode-go/glm-5.10"]]);
  // The checker you picked still wins over Argon.
  assert.equal(castOf(lineup, { picks: { checker: "opencode:opencode-go/glm-5.3" } })!.judge, "opencode:opencode-go/glm-5.3");
  // With Opus doing the hard work, Astra critiques it, not MiMo or GLM; DeepSeek Flash builds and reads second.
  const opus = provider("claude", ["claude-opus-5-5", "claude-sonnet-5-5"]);
  const codex = provider("codex", ["gpt-6-astra", "gpt-6.1-sol"]);
  assert.deepEqual(castOf([opus, codex, lineup[0]])!.critics, ["codex:gpt-6-astra", "opencode:opencode-go/deepseek-v4.1-flash"]);
  // With Astra doing it, its best reader would be Go's Gemini 4 Argon: MiMo and GLM read instead, for less of Go's allowance.
  assert.deepEqual(castOf([codex, lineup[0]])!.critics, ["opencode:opencode-go/mimo-v2.6-pro", "opencode:opencode-go/glm-5.3"]);
  // MiMo V2.6 Flash stands in for the Pro; a critic of the strong model's own maker is left out.
  const noPro = lineup[0].models.filter((m) => m.id !== "opencode-go/mimo-v2.6-pro").map((m) => m.id);
  assert.equal(castOf([provider("opencode", noPro)])!.critics[0], "opencode:opencode-go/mimo-v2.6-flash");
  assert.ok(!castOf(lineup, { picks: { frontier: "opencode:opencode-go/glm-5.3" } })!.critics.includes("opencode:opencode-go/glm-5.3"));
  assert.deepEqual(castOf(go, { dual: true }), castOf(go));
  assert.deepEqual(frontiersOf(go), { frontier: undefined, second: undefined });
  // Gemini alone: Flash builds, Pro plans; one maker is no dual pair.
  const gemini = [provider("acp.gemini", ["gemini-3-pro", "gemini-3-flash"])];
  assert.deepEqual([castOf(gemini)!.everyday, castOf(gemini)!.strong], ["acp.gemini:gemini-3-flash", "acp.gemini:gemini-3-pro"]);
  assert.equal(frontiersOf(gemini).second, undefined);
  // Free models only: no frontier model to plan, so Plan is Solo, but another maker still checks.
  const free = castOf([provider("opencode", ["default", "opencode/big-pickle", "opencode/deepseek-v4.1-flash-free", "opencode/glm-5.3-flash-free"])])!;
  assert.deepEqual([free.everyday, free.strong, checkerOf(free.everyday, free)], ["opencode:opencode/deepseek-v4.1-flash-free", "opencode:opencode/deepseek-v4.1-flash-free", "opencode:opencode/glm-5.3-flash-free"]);
  // Flash, Turbo and Fast models are never taken as frontier ones.
  assert.equal(frontiersOf([provider("grok", ["grok-4-fast", "grok-code-fast"])]).frontier, undefined);
});

test("claude team: helpers by default, for an agent or a bare model; none alone", () => {
  const helpers = claudeTeam(agent({ model: "claude:claude-opus-5-5" }), "claude-opus-5-5");
  assert.equal(helpers.model, "claude-opus-5-5");
  assert.ok(helpers.agents.explorer && helpers.agents["test-runner"]);
  // "escalate", from before, runs with helpers on its own model.
  const old = claudeTeam(agent({ runMode: "escalate" as never }), "claude-sonnet-5-5");
  assert.deepEqual([old.model, Object.keys(old.agents)], ["claude-sonnet-5-5", ["explorer", "test-runner"]]);
  assert.deepEqual(claudeTeam(agent({ runMode: "single" }), "claude-sonnet-5-5").agents, {});
  assert.equal(subagentName("opus-planner"), "Opus");
  assert.equal(subagentName("test-runner"), "Test runner");
});

test("routines: weekdays skip the weekend, and the words say when", () => {
  const friday = new Date(2026, 9, 23, 10, 0).getTime(); // a Friday, after 9:00
  const next = new Date(nextRun({ kind: "schedule", every: "weekday", at: "09:00" }, friday)!);
  assert.equal(next.getDay(), 1);
  assert.equal(next.getHours(), 9);
  const monday = new Date(nextRun({ kind: "schedule", every: "week", at: "09:00", day: 1 }, friday)!);
  assert.equal(monday.getDay(), 1);
  assert.equal(nextRun({ kind: "manual" }), undefined);
  assert.equal(describeTrigger({ kind: "schedule", every: "week", at: "09:00", day: 1 }), "Mondays at 09:00");
  assert.equal(describeTrigger({ kind: "github", event: "pr.opened", outside: true }), "When someone outside the team opens a pull request");
});

test("routines: a prompt quotes only what the call sent", () => {
  const out = fill("PR {{body.pull_request.number}} was {{ body.action }} via {{headers.x-github-event}}; {{body.missing}}.", { body: { action: "opened", pull_request: { number: 142 } }, headers: { "x-github-event": "pull_request" } });
  assert.equal(out, "PR 142 was opened via pull_request; .");
});

test("routines: a webhook answers only to its own secret", () => {
  assert.ok(sameSecret("a1b2c3", "a1b2c3"));
  assert.ok(!sameSecret("a1b2c3", "a1b2c4"));
  assert.ok(!sameSecret("a1b2c3", "a1b2c"));
  assert.ok(!sameSecret("a1b2c3", ""));
});

test("proxy: pages get the probe, framing headers come off, other files pass through", async () => {
  const site = createServer((req, res) => {
    if (req.url === "/") res.writeHead(200, { "content-type": "text/html", "x-frame-options": "DENY" }).end("<html><head><title>x</title></head><body>hi</body></html>");
    else res.writeHead(200, { "content-type": "text/css" }).end("body{}");
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
  const port = (site.address() as { port: number }).port;
  const proxies = new Proxies();
  try {
    const base = await proxies.url(port);
    const page = await fetch(`${base}/`);
    assert.equal(page.headers.get("x-frame-options"), null);
    const html = await page.text();
    assert.match(html, /<head><script src="\/__liner\/probe\.js"><\/script><title>/);
    assert.equal(await (await fetch(`${base}/a.css`)).text(), "body{}");
    const probe = await (await fetch(`${base}/__liner/probe.js`)).text();
    assert.match(probe, /__linerProbe/);
    // It must parse, or no page gets console lines, picking, or an agent's hands.
    assert.doesNotThrow(() => new Function(probe));
    assert.match(probe, /replace\(\/\\s\+\/g/);
    assert.equal(await proxies.url(port), base, "one proxy per port");
    await assert.rejects(proxies.url(80));
  } finally {
    proxies.closeAll();
    site.close();
  }
});

/** A GET with headers fetch won't let you set (Host): its status and body. */
function get(url: string, headers: Record<string, string>) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString("utf8")));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("proxy: only requests for the proxy itself get through; other sites keep their origin", async () => {
  const site = createServer((req, res) => res.writeHead(200, { "content-type": "text/plain" }).end(req.headers.origin ?? "none"));
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
  const port = (site.address() as { port: number }).port;
  const proxies = new Proxies();
  try {
    const base = await proxies.url(port);
    const host = new URL(base).host;
    // A page that rebinds its own name to 127.0.0.1 says so in its Host.
    assert.equal((await get(`${base}/`, { host: `evil.example:${new URL(base).port}` })).status, 403);
    assert.deepEqual(await get(`${base}/`, { host, origin: base }), { status: 200, body: "none" });
    assert.deepEqual(await get(`${base}/`, { host, origin: "https://evil.example" }), { status: 200, body: "https://evil.example" });
  } finally {
    proxies.closeAll();
    site.close();
  }
});

test("secrets: the engine's token and keys don't reach anything it starts", async () => {
  process.env.LINER_TOKEN = "t0ken";
  process.env.LINER_KEYS = JSON.stringify({ anthropic: "sk-test" });
  assert.deepEqual(takeSecrets(process.env), { token: "t0ken", keys: { anthropic: "sk-test" } });
  const seen = (await run("/usr/bin/env", [])).stdout;
  assert.match(seen, /PATH=/);
  assert.doesNotMatch(seen, /LINER_TOKEN|LINER_KEYS|t0ken|sk-test/);
  assert.deepEqual(takeSecrets({ LINER_KEYS: "{not json" }), { token: undefined, keys: {} });
});

test("secrets: the shell's token and keys come over stdin, so nothing on this Mac can read them in the engine's environment", async () => {
  assert.deepEqual(secretsFrom('{"token":"t","keys":{"openai":"sk-o","bad":1}}'), { token: "t", keys: { openai: "sk-o" } });
  assert.deepEqual(secretsFrom(null), { token: undefined, keys: {} });
  const home = mkdtempSync(join(tmpdir(), "liner-secrets-"));
  const token = "stdin-token-0123456789abcdef";
  const engine = spawn(process.execPath, [join(import.meta.dirname, "../src/main.ts"), "--port", "0"], {
    env: { PATH: "/usr/bin:/bin", HOME: home, LINER_HOME: home, LINER_SECRETS: "stdin", LINER_UPDATE_REPO: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    engine.stdin.write(`${JSON.stringify({ token, keys: { anthropic: "sk-ant-secret" } })}\n`);
    const port = await new Promise<number>((resolve, reject) => {
      let out = "";
      engine.stdout.on("data", (d: Buffer) => {
        out += d.toString();
        const m = /LINER_READY (\{.*\})/.exec(out);
        if (m) resolve((JSON.parse(m[1]) as { port: number }).port);
      });
      engine.once("exit", (code) => reject(new Error(`the engine stopped (${code})`)));
      setTimeout(() => reject(new Error("the engine didn't start in time")), 20_000);
    });
    // What any process running as you sees of the engine's environment.
    const seen = (await run("ps", ["eww", "-p", String(engine.pid), "-o", "command="])).stdout;
    assert.match(seen, /LINER_SECRETS=stdin/);
    assert.doesNotMatch(seen, /stdin-token|sk-ant-secret|LINER_TOKEN|LINER_KEYS/);
    const rpc = (t: string) => fetch(`http://127.0.0.1:${port}/rpc`, { method: "POST", headers: { "content-type": "application/json", "x-liner-token": t }, body: JSON.stringify({ method: "apps.editors", params: {} }) });
    assert.equal((await rpc(token)).status, 200, "the token the shell handed over opens /rpc");
    assert.equal((await rpc("guess")).status, 401);
    // The shell going away (stdin closing) still takes the engine with it.
    const gone = new Promise((r) => engine.once("exit", r));
    engine.stdin.end();
    await Promise.race([gone, new Promise((_, no) => setTimeout(() => no(new Error("the engine outlived its shell")), 10_000))]);
  } finally {
    engine.kill();
  }
});

test("github: a remote's owner and name, whichever way it's written", () => {
  assert.equal(githubName("git@github.com:halcyon/app.git"), "halcyon/app");
  assert.equal(githubName("https://github.com/halcyon/app"), "halcyon/app");
  assert.equal(githubName("https://github.com/halcyon/my.app.git\n"), "halcyon/my.app");
  assert.equal(githubName("https://gitlab.com/halcyon/app.git"), undefined);
});

test("handoff: one huge message is cut, not the whole conversation lost", async () => {
  const { handoff } = await import("../src/runtime.ts");
  const items = [
    { kind: "user", id: "u1", turn: 1, at: 0, text: "the first ask" },
    { kind: "text", id: "t1", turn: 1, at: 0, text: "the first answer", streaming: false },
    { kind: "user", id: "u2", turn: 2, at: 0, text: `here's the log ${"x".repeat(60000)}` },
  ] as never[];
  const out = handoff(items, "switch");
  assert.ok(out.length < 26000, "it stays in the budget");
  assert.match(out, /here's the log/);
  assert.match(out, /cut here/);
  assert.match(out, /the first ask/, "the earlier work still fits");
});

test("handoff: your requests survive a small budget; the newest answers come first", async () => {
  const { handoff } = await import("../src/runtime.ts");
  const items = [1, 2, 3].flatMap((turn) => [
    { kind: "user", id: `u${turn}`, turn, at: 0, text: `ask ${turn}` },
    { kind: "text", id: `t${turn}`, turn, at: 0, text: `answer ${turn} `.repeat(200), streaming: false },
  ]) as never[];
  const full = handoff(items, "switch");
  assert.match(full, /taking over/);
  assert.match(full, /ask 1[\s\S]*ask 2[\s\S]*ask 3/);
  const small = handoff(items, "switch", 3000);
  assert.match(small, /ask 3/);
  assert.match(small, /answer 3/);
  assert.doesNotMatch(small, /answer 1/);
});

test("codex: a command wrapped in a login shell reads as the command", async () => {
  const { unwrap, isLimit } = await import("../src/providers/codex-server.ts");
  assert.equal(unwrap(`/bin/zsh -lc "npm test"`), "npm test");
  assert.equal(unwrap(`bash -lc 'printf "%s" hi'`), `printf "%s" hi`);
  assert.equal(unwrap("git status"), "git status");
  assert.ok(isLimit({ codexErrorInfo: "usageLimitExceeded" }));
  assert.ok(isLimit({ message: "You've hit your usage limit. Try again at 4pm." }));
  assert.ok(!isLimit({ message: "Network error" }));
});

test("accounts: a second account moves the tool's config folder and binary; ids stay apart", async () => {
  const { accountEnv, slugFor, splitCommand, listRegistry } = await import("../src/providers/added.ts");
  const { familyOf } = await import("../../contracts/src/index.ts");
  const { which } = await import("../src/exec.ts");
  const env = accountEnv({ id: "work", provider: "claude", label: "Work", home: "/tmp/claude-work", env: { ANTHROPIC_BASE_URL: "https://example.test" }, binary: "/bin/echo" });
  assert.equal(env.CLAUDE_CONFIG_DIR, "/tmp/claude-work");
  assert.equal(env.ANTHROPIC_BASE_URL, "https://example.test");
  assert.equal(which("claude", { PATH: "", ...env }), "/bin/echo");
  assert.equal(accountEnv({ id: "x", provider: "codex", label: "X", home: "/tmp/cx" }).CODEX_HOME, "/tmp/cx");
  assert.equal(familyOf("claude.work"), "claude");
  assert.equal(familyOf("acp.gemini"), "acp");
  assert.equal(slugFor("Gemini CLI", ["gemini-cli"]), "gemini-cli-2");
  assert.deepEqual(splitCommand(`my-agent --acp --name "two words" ''`), ["my-agent", "--acp", "--name", "two words", ""]);
  const list = listRegistry([{ id: "a", name: "A", version: "1", distribution: { uvx: { package: "a" } } }, { id: "b", name: "B", version: "2", distribution: { npx: { package: "b" } } }], [{ id: "b", label: "B", command: ["npx", "b"], from: "registry", registryId: "b" }], { PATH: "" });
  assert.equal(list.find((x) => x.id === "b")?.added, "acp.b");
  assert.equal(list.find((x) => x.id === "a")?.runnable, false);
});

test("agent tools: the MCP server lists Liner Code's tools and a call reaches only its own session", async () => {
  const { spawn } = await import("node:child_process");
  const { AgentTools } = await import("../src/agent-tools.ts");
  const { startServer } = await import("../src/server.ts");
  const put: { threadId: string; item: { kind: string; title?: string } }[] = [];
  const store = { on() {}, emit() {}, putItem: (threadId: string, item: { kind: string; title?: string }) => put.push({ threadId, item }), thread: () => ({ turns: 1 }) } as never;
  const tools = new AgentTools(store, process.env);
  const server = await startServer({ store, api: { call: async () => null, ready: Promise.resolve() }, snapshot: async () => ({}) as never, token: "t", port: 0, surface: (key, tool, args) => { const id = tools.threadOf(key); return id ? tools.call(id, tool, args) : null; } });
  tools.url = `http://127.0.0.1:${server.port}`;
  const spec = tools.serverFor("th1")!;
  const child = spawn(spec.command, spec.args, { env: { ...process.env, ...spec.env }, stdio: ["pipe", "pipe", "inherit"] });
  const replies = new Map<number, Record<string, unknown>>();
  let buf = "";
  child.stdout.on("data", (d: Buffer) => {
    buf += d.toString();
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      const m = JSON.parse(buf.slice(0, i)) as { id: number };
      replies.set(m.id, m);
      buf = buf.slice(i + 1);
    }
  });
  const ask = async (id: number, method: string, params: unknown = {}) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    for (let t = 0; t < 200 && !replies.has(id); t++) await new Promise((r) => setTimeout(r, 20));
    return replies.get(id) as { result: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean } };
  };
  try {
    assert.equal((await ask(1, "initialize", { protocolVersion: "2025-06-18" })) ? "ok" : "", "ok");
    const list = await ask(2, "tools/list");
    assert.ok(list.result.tools!.some((x) => x.name === "show_page"));
    assert.ok(list.result.tools!.some((x) => x.name === "browser_click"));
    const shown = await ask(3, "tools/call", { name: "show_page", arguments: { title: "Sizes", html: "<table><tr><td>1</td></tr></table>" } });
    assert.ok(!shown.result.isError);
    assert.equal(put[0]?.threadId, "th1");
    assert.equal(put[0]?.item.kind, "page");
    // Another key reaches nothing.
    const r = await fetch(`${tools.url}/surface`, { method: "POST", headers: { "x-liner-surface": "nope" }, body: JSON.stringify({ tool: "show_page", args: { title: "x", html: "y" } }) });
    assert.equal(r.status, 401);
  } finally {
    child.kill();
    server.close();
  }
});

test("pr picture: a three-way conflict comes back as one pair of lines, numbered in your file", async () => {
  const { parseMergeTree } = await import("../src/prflow.ts");
  const out = ["changed in both", "  base   100644 de98 f.txt", "  our    100644 a641 f.txt", "  their  100644 0978 f.txt", "@@ -1,3 +1,7 @@", " a", "+<<<<<<< .our", " B-feat", "+=======", "+B-main", "+>>>>>>> .their", " c"].join("\n");
  const c = parseMergeTree(out);
  assert.equal(c.length, 1);
  assert.equal(c[0].file, "f.txt");
  assert.equal(c[0].line, 2);
  assert.equal(c[0].yours, "B-feat");
  assert.equal(c[0].base, "B-main");
});

test("rules: don't ask again covers one plain command, never a compound one", async () => {
  const { ruleFor } = await import("../src/risk.ts");
  assert.equal(ruleFor("npm test"), "npm test");
  assert.equal(ruleFor(`cd "/Users/me/app" && npm test -- --watch=false`), "npm test");
  assert.equal(ruleFor("CI=1 pnpm lint"), undefined);
  assert.equal(ruleFor("ls -la src"), "ls");
  assert.equal(ruleFor("git add x && rm -rf ~"), undefined);
  assert.equal(ruleFor("cat a | sh"), undefined);
  assert.equal(ruleFor("echo $(whoami)"), undefined);
  assert.equal(ruleFor("printf hi > notes.txt"), undefined);
});

test("a message that only asks for a pull request opens the PR card", () => {
  for (const t of ["create pr", "Create PR", "open a pull request", "please make a PR.", "/pr", "  raise the pr! "]) assert.equal(isPrAsk(t), true, t);
  for (const t of ["create pr for the auth fix and add tests", "why did the pr fail?", "/pr 12", "fix the tide time, then create pr", "prepare"]) assert.equal(isPrAsk(t), false, t);
});

test("pr tests: the project's own test command, by its package manager or toolchain", () => {
  const dir = (files: Record<string, string>) => {
    const d = mkdtempSync(join(tmpdir(), "lc-test-"));
    for (const [f, text] of Object.entries(files)) writeFileSync(join(d, f), text);
    return d;
  };
  assert.equal(testCommand(dir({ "package.json": '{"scripts":{"test":"node --test"}}' })), "npm test");
  assert.equal(testCommand(dir({ "package.json": '{"scripts":{"test":"vitest"}}', "pnpm-lock.yaml": "" })), "pnpm test");
  assert.equal(testCommand(dir({ "package.json": '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' })), undefined);
  assert.equal(testCommand(dir({ "Cargo.toml": "" })), "cargo test");
  assert.equal(testCommand(dir({ "pyproject.toml": "[tool.pytest.ini_options]\n" })), "pytest");
  assert.equal(testCommand(dir({ Makefile: "build:\n\ttrue\ntest:\n\ttrue\n" })), "make test");
  assert.equal(testCommand(dir({ "package.json": '{"scripts":{"test":"jest"}}' }), [{ name: "Test", command: "npm run test:ci" }]), "npm run test:ci");
  assert.equal(testCommand(dir({ "README.md": "" })), undefined);
});

test("pr tests: what a run's output says, in each runner's words", () => {
  assert.equal(testSummary("✔ finds the next high tide\nℹ tests 3\nℹ pass 3\nℹ fail 0\n", true), "3 passed");
  assert.equal(testSummary(" Test Files  1 failed | 4 passed (5)\n      Tests  2 failed | 40 passed (42)\n", false), "2 failed, 40 passed");
  assert.equal(testSummary("Test Suites: 1 failed, 3 passed, 4 total\nTests:       2 failed, 40 passed, 42 total\n", false), "2 failed, 40 passed");
  assert.equal(testSummary("test result: ok. 3 passed; 0 failed; 0 ignored\ntest result: ok. 2 passed; 0 failed; 0 ignored\n", true), "5 passed");
  assert.equal(testSummary("========= 1 failed, 12 passed in 0.31s =========\n", false), "1 failed, 12 passed");
  assert.equal(testSummary("ok  \texample.com/a\t0.01s\nFAIL\texample.com/b\t0.02s\n", false), "1 package failed");
  assert.equal(testSummary("all good\n", true), "Passed");
  assert.equal(clean("\x1b[32m✔ ok\x1b[39m\r\n 10%\r 55%\r100%\n"), "✔ ok\n100%\n");
});

test("settling is yours: old defaults that settled sessions by themselves are switched off once", () => {
  const old = mkdtempSync(join(tmpdir(), "lc-home-"));
  writeFileSync(join(old, "state.json"), JSON.stringify({ settings: { onboarded: true, settleDays: 3, settleOnMerge: true, settleOnRoutine: true } }));
  const s = new Store(old).settings;
  assert.deepEqual([s.settleDays, s.settleOnMerge, s.settleOnRoutine, s.settleVersion], [0, false, false, 2]);
  // Turned back on after that, they stay on.
  const kept = mkdtempSync(join(tmpdir(), "lc-home-"));
  writeFileSync(join(kept, "state.json"), JSON.stringify({ settings: { onboarded: true, settleDays: 7, settleOnMerge: true, settleVersion: 2 } }));
  assert.deepEqual([new Store(kept).settings.settleDays, new Store(kept).settings.settleOnMerge], [7, true]);
  assert.equal(new Store(mkdtempSync(join(tmpdir(), "lc-home-"))).settings.settleOnMerge, false);
});

test("modes compared: sessions sorted by how they ran, undone changes not kept, demo and routines left out", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-home-"));
  const now = Date.now();
  const thread = (id: string, p: Record<string, unknown>) => ({ id, projectId: "p", title: id, status: "done", access: "ask", turns: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }, createdAt: now, updatedAt: now, ...p });
  const threads = [
    thread("alone", { agent: "@claude:claude-opus-5-5" }),
    thread("planned", { agent: "forge", lead: "helm" }),
    thread("routed", { agent: "@codex:gpt-6-luna", route: { level: "high", cast: {}, root: "codex:gpt-6-luna" } }),
    thread("direct", { agent: "forge" }),
    thread("demo", { agent: "demo" }),
    thread("routine", { agent: "forge", routine: { id: "r", run: "x" } }),
  ];
  writeFileSync(join(home, "state.json"), JSON.stringify({ settings: { onboarded: true }, threads }));
  const use = (threadId: string, costUsd: number, seconds: number) => JSON.stringify({ at: now, threadId, projectId: "p", agent: "a", provider: "claude", model: "m", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd, seconds });
  writeFileSync(join(home, "usage.jsonl"), [use("alone", 1, 10), use("alone", 1, 20), use("planned", 3, 30), use("demo", 9, 9), use("routine", 9, 9)].join("\n") + "\n");
  const cp = (id: string, reverted = false) => JSON.stringify({ kind: "checkpoint", id, turn: 1, at: now, files: [{ path: "a.ts", status: "modified", added: 1, removed: 0 }], reverted });
  const review = (id: string, status: string) => JSON.stringify({ kind: "review", id, turn: 1, at: now, reviewer: "codex:x", round: 1, status, findings: [] });
  const log = (id: string, lines: string[]) => writeFileSync(join(home, "threads", `${id}.jsonl`), lines.join("\n") + "\n");
  new Store(home); // makes the threads folder
  log("alone", [cp("c1"), cp("c2", true)]);
  // A later line replaces an earlier one with the same id: the review ran, then passed.
  log("planned", [cp("c3"), review("r1", "running"), review("r1", "passed")]);
  log("routed", [cp("c4"), review("r2", "blocked")]);
  log("demo", [cp("c5")]);
  const by = Object.fromEntries(compareWays(new Store(home), 30).map((w) => [w.way, w]));
  // A bare model and your agent alone are both Solo; demo and routine runs don't count anywhere.
  assert.deepEqual([by.solo.sessions, by.solo.changed, by.solo.kept, by.solo.turns, by.solo.costUsd, by.solo.seconds], [2, 2, 1, 2, 2, 30]);
  assert.deepEqual([by.plan.sessions, by.plan.kept, by.plan.reviewed, by.plan.firstPass, by.plan.costUsd], [1, 1, 1, 1, 3]);
  assert.deepEqual([by.auto.sessions, by.auto.changed, by.auto.reviewed, by.auto.firstPass, by.auto.costUsd], [1, 1, 1, 0, 0]);
});

test("before modes: a lead and a coder is Plan, a staged setup's models are your models, and refine when it was your way", () => {
  const staged = { id: "s", lead: null, stages: [{ who: "@opencode:opencode/deepseek-v4.1-flash-free", job: "Build the core" }, { who: "@claude:claude-opus-5-5", job: "Improve it" }] };
  const lead = fromWorkStyle({ onboarded: true, workStyle: "lead", setups: [staged], setup: "mine", team: { lead: "helm" } });
  assert.deepEqual([lead.mode, lead.picks, lead.after], ["plan", { cheaper: "opencode:opencode/deepseek-v4.1-flash-free", frontier: "claude:claude-opus-5-5" }, undefined]);
  // Building, then improving, as the way you worked: Solo, and the frontier model refines each change.
  const team = fromWorkStyle({ workStyle: "team", setups: [staged], setup: "s" });
  assert.deepEqual([team.mode, team.after], ["solo", "refine"]);
  assert.ok(!("setups" in lead) && !("workStyle" in lead) && !("team" in lead));
  assert.equal(fromWorkStyle({ workStyle: "model" }).mode, "solo");
  assert.equal(fromWorkStyle({ workStyle: "team", setups: [{ id: "x", lead: "helm", stages: [{ who: "forge", job: "" }] }], setup: "x" }).mode, "plan");
  const routed = fromWorkStyle({ workStyle: "model", route: { level: "max", cast: { judge: "codex:gpt-6-sol", critics: [] } } });
  assert.deepEqual([routed.picks, routed.route], [{ checker: "codex:gpt-6-sol" }, { level: "max" }]);
  // A saved state from before modes is read that way once.
  const home = mkdtempSync(join(tmpdir(), "lc-home-"));
  writeFileSync(join(home, "state.json"), JSON.stringify({ settings: { onboarded: true, workStyle: "lead" } }));
  assert.equal(new Store(home).settings.mode, "plan");
  assert.equal(new Store(mkdtempSync(join(tmpdir(), "lc-home-"))).agents.map((a) => a.id).join(), "demo", "a fresh install has no named agents");
});

test("a deleted agent: its sessions carry on with its model, never with another agent", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-home-"));
  const now = Date.now();
  const thread = (id: string, p: Record<string, unknown>) => ({ id, projectId: "p", title: id, status: "done", access: "ask", turns: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }, createdAt: now, updatedAt: 5, ...p });
  const forge = agent({});
  writeFileSync(
    join(home, "state.json"),
    JSON.stringify({ settings: { onboarded: true, mode: "plan" }, agents: [forge], projects: [{ id: "p", name: "p", path: "/p", agent: "helm", git: false, createdAt: now }], threads: [thread("a", { agent: "forge", lead: "helm", turnBy: "helm", leadSession: "claude:s1" }), thread("b", { agent: "quill", lead: "leader" }), thread("c", { agent: "forge", lead: "gone" })] }),
  );
  new Store(home);
  const turn = (agentId: string, model: string) => JSON.stringify({ kind: "turn", id: `t-${agentId}`, turn: 1, at: now, agent: agentId, model, planning: false, status: "done" });
  writeFileSync(join(home, "threads", "a.jsonl"), turn("helm", "claude:claude-opus-5-5") + "\n");
  writeFileSync(join(home, "threads", "b.jsonl"), turn("leader", "hermes:anthropic:claude-fable-5.1") + "\n");
  const store = new Store(home);
  // Before it's repaired, a gone agent is the stand-in model, not your first agent.
  assert.equal(store.agent("helm").model, store.standIn);
  store.repairAgents(new Map([["quill", "codex:gpt-6-luna"]]), "claude:claude-sonnet-5-5");
  const [a, b, c] = store.threads;
  assert.deepEqual([a.agent, a.lead, a.turnBy, a.leadSession, a.updatedAt], ["forge", "@claude:claude-opus-5-5", "@claude:claude-opus-5-5", "claude:s1", 5]);
  assert.deepEqual([b.agent, b.lead], ["@codex:gpt-6-luna", "@hermes:anthropic:claude-fable-5.1"]);
  // A planner with nothing to go on leaves the session in Solo.
  assert.deepEqual([c.agent, c.lead], ["forge", undefined]);
  assert.equal(store.projects[0].agent, undefined);
});

test("reviewer: a few lines or docs alone are small; code past the line, or a binary, isn't", () => {
  assert.ok(smallChange(""));
  assert.ok(smallChange("3\t2\tsrc/a.ts\n1\t0\tsrc/b.ts\n"));
  assert.ok(!smallChange("5\t2\tsrc/a.ts\n"));
  assert.ok(smallChange("120\t40\tREADME.md\n30\t0\tdocs/guide/setup.ts\n"));
  assert.ok(!smallChange("120\t40\tREADME.md\n1\t0\tsrc/a.ts\n"));
  assert.ok(!smallChange("-\t-\tlogo.png\n"));
});

test("export: a session reads as Markdown, with its asks, answers, tools, findings and diffs", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-home-"));
  const now = Date.now();
  const thread = { id: "t", projectId: "p", title: "Fix the tide table", agent: "@claude:claude-opus-5-5", status: "done", access: "ask", turns: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }, createdAt: now, updatedAt: now };
  writeFileSync(join(home, "state.json"), JSON.stringify({ settings: { onboarded: true }, projects: [{ id: "p", name: "tidewater", path: home, git: true }], threads: [thread] }));
  new Store(home);
  const at = (o: Record<string, unknown>) => JSON.stringify({ turn: 1, at: now, ...o });
  writeFileSync(
    join(home, "threads", "t.jsonl"),
    [
      at({ kind: "user", id: "u", text: "Why is high tide off by an hour?" }),
      at({ kind: "turn", id: "tn", agent: "@claude:claude-opus-5-5", model: "claude-opus-5-5", status: "done" }),
      at({ kind: "text", id: "x", text: "Daylight saving wasn't applied.", streaming: false }),
      at({ kind: "tool", id: "tl", tool: "Bash", toolKind: "execute", title: "Run npm test", status: "done" }),
      at({ kind: "checkpoint", id: "c", files: [{ path: "src/tide.ts", status: "modified", added: 2, removed: 1 }], from: "a1", to: "b2" }),
      at({ kind: "review", id: "r", reviewer: "codex:x", round: 1, status: "passed", findings: [{ file: "src/tide.ts", line: 4, severity: "note", note: "Name the offset" }] }),
    ].join("\n") + "\n",
  );
  const md = await sessionMarkdown(new Store(home), "t", async (from, to) => `diff --git a/src/tide.ts b/src/tide.ts\n-old ${from}\n+new ${to} \`\`\`\n`);
  assert.match(md, /^# Fix the tide table\n/);
  assert.match(md, /## You\n\nWhy is high tide off by an hour\?/);
  assert.match(md, /Daylight saving wasn't applied\.\n\n- Run npm test/);
  assert.match(md, /### Changes in turn 1\n\n- src\/tide\.ts \(modified, \+2 −1\)/);
  // A diff with ``` in it gets a longer fence, so it stays one block.
  assert.match(md, /````diff\ndiff --git[\s\S]*\+new b2 ```\n````/);
  assert.match(md, /### The Reviewer, round 1: passed\n\n- \*\*src\/tide\.ts:4\*\* \(note\) Name the offset/);
});

test("rules: one text in AGENTS.md, with CLAUDE.md importing it, reads as linked", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-home-"));
  const root = mkdtempSync(join(tmpdir(), "lc-proj-"));
  writeFileSync(join(root, "CLAUDE.md"), "Use pnpm.\n");
  writeFileSync(join(home, "state.json"), JSON.stringify({ settings: { onboarded: true }, projects: [{ id: "p", name: "proj", path: root, git: false }] }));
  const { createApi } = await import("../src/api.ts");
  const { Runtime } = await import("../src/runtime.ts");
  const store = new Store(home);
  const api = createApi(store, new Runtime(store, { PATH: "/usr/bin:/bin" }), { PATH: "/usr/bin:/bin" }, { routines: {}, terms: {}, logs: {}, proxies: {} } as never);
  assert.deepEqual(await api.call("project.rules", { id: "p" }), { claude: "Use pnpm.\n", agents: undefined, linked: false });
  assert.deepEqual(await api.call("project.rules.save", { id: "p", text: "Use pnpm.\nRun the tests before you finish." }), { claude: "@AGENTS.md\n", agents: "Use pnpm.\nRun the tests before you finish.\n", linked: true });
});

test("imports: Claude Code and Codex sessions in a folder come in as timelines that resume them", async () => {
  const { importable, transcript } = await import("../src/imports.ts");
  const cwd = mkdtempSync(join(tmpdir(), "lc-proj-"));
  const claude = mkdtempSync(join(tmpdir(), "lc-claude-"));
  const codex = mkdtempSync(join(tmpdir(), "lc-codex-"));
  const env = { CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex };
  const real = (await import("node:fs")).realpathSync(cwd);
  const cdir = join(claude, "projects", real.replace(/[^a-zA-Z0-9]/g, "-"));
  const { mkdirSync } = await import("node:fs");
  mkdirSync(cdir, { recursive: true });
  const ts = "2026-10-01T10:00:00.000Z";
  const line = (o: Record<string, unknown>) => JSON.stringify({ timestamp: ts, cwd: real, sessionId: "s1", ...o });
  writeFileSync(
    join(cdir, "s1.jsonl"),
    [
      line({ type: "user", isMeta: true, message: { role: "user", content: "<local-command-caveat>ignore</local-command-caveat>" } }),
      line({ type: "user", message: { role: "user", content: "Fix the tide offset" } }),
      line({ type: "assistant", message: { role: "assistant", model: "claude-opus-5-5", content: [{ type: "thinking", thinking: "hm" }, { type: "tool_use", name: "Edit", input: { file_path: join(real, "src/tide.ts") } }] } }),
      line({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } }),
      line({ type: "assistant", isSidechain: true, message: { role: "assistant", content: [{ type: "text", text: "a subagent's words" }] } }),
      line({ type: "assistant", message: { role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "Fixed: DST now applies." }] } }),
      JSON.stringify({ type: "custom-title", customTitle: "Tide offset", sessionId: "s1" }),
    ].join("\n") + "\n",
  );
  const rdir = join(codex, "sessions", "2026", "10", "02");
  mkdirSync(rdir, { recursive: true });
  const item = (payload: Record<string, unknown>, type = "response_item") => JSON.stringify({ timestamp: ts, type, payload });
  writeFileSync(
    join(rdir, "rollout-2026-10-02-c1.jsonl"),
    [
      item({ id: "c1", cwd: real }, "session_meta"),
      item({ model: "gpt-5.6-sol" }, "turn_context"),
      item({ type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>x</environment_context>" }] }),
      item({ type: "message", role: "user", content: [{ type: "input_text", text: "Add a test for leap years" }] }),
      item({ type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["bash", "-lc", "npm test"] }) }),
      item({ type: "message", role: "assistant", content: [{ type: "output_text", text: "Added and passing." }] }),
    ].join("\n") + "\n",
  );
  // Another folder's Codex session stays out.
  writeFileSync(join(rdir, "rollout-2026-10-02-c2.jsonl"), item({ id: "c2", cwd: "/elsewhere" }, "session_meta") + "\n");

  const found = importable(cwd, env, new Set());
  assert.deepEqual(found.map((s) => [s.tool, s.id, s.title]).sort(), [["claude", "s1", "Tide offset"], ["codex", "c1", "Add a test for leap years"]]);
  assert.deepEqual(importable(cwd, env, new Set(["claude:s1"])).map((s) => s.id), ["c1"], "one already here isn't offered again");

  const c = transcript("claude", "s1", cwd, env);
  assert.equal(c.turns, 1);
  assert.equal(c.model, "claude-opus-5-5");
  assert.deepEqual(c.items.map((i) => (i.kind === "text" || i.kind === "user" ? `${i.kind}:${i.text}` : i.kind === "tool" ? `tool:${i.title}` : i.kind)), ["user:Fix the tide offset", "turn", "tool:Edit src/tide.ts", "text:Fixed: DST now applies."]);
  const x = transcript("codex", "c1", cwd, env);
  assert.equal(x.model, "gpt-5.6-sol");
  assert.deepEqual(x.items.map((i) => (i.kind === "text" || i.kind === "user" ? `${i.kind}:${i.text}` : i.kind === "tool" ? `tool:${i.title}` : i.kind)), ["user:Add a test for leap years", "turn", "tool:Run npm test", "text:Added and passing."]);
});

test("an agent's brief: its soul, its prompt, the skills it may read and its context files as they read now", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { briefOf } = await import("../src/agents.ts");
  const dir = mkdtempSync(join(tmpdir(), "liner-brief-"));
  mkdirSync(join(dir, ".claude", "skills", "release-notes"), { recursive: true });
  writeFileSync(join(dir, ".claude", "skills", "release-notes", "SKILL.md"), "---\nname: release-notes\ndescription: Writes the changelog entry\n---\nSteps.");
  writeFileSync(join(dir, "AGENTS.md"), "Use tabs.");
  const brief = briefOf({ soul: "You are Forge.", prompt: "Keep diffs small.", skills: [".claude/skills/release-notes/SKILL.md", "missing/SKILL.md"], contextFiles: ["AGENTS.md", "gone.md"] }, dir);
  assert.ok(brief.startsWith("You are Forge.\n\nKeep diffs small."));
  assert.match(brief, /- release-notes \(\.claude\/skills\/release-notes\/SKILL\.md\): Writes the changelog entry/);
  assert.doesNotMatch(brief, /missing/);
  assert.match(brief, /<file path="AGENTS\.md">\nUse tabs\.\n<\/file>/);
  assert.doesNotMatch(brief, /gone\.md/);
  // An agent with only a soul is told only its soul.
  assert.equal(briefOf({ soul: "You are Helm." }, dir), "You are Helm.");
});

test("context: Claude Code's sources add up to what it uses, the conversation's estimate fitted inside its Messages", () => {
  // What a session reported: the breakdown's attachments count the skills and MCP instructions again.
  const u = {
    categories: [
      { id: "system_prompt", name: "System prompt", tokens: 3691, kind: "used" },
      { id: "system_tools", name: "System tools", tokens: 7494, kind: "used" },
      { id: "mcp_instructions", name: "MCP server instructions", tokens: 2339, kind: "used" },
      { id: "mcp_tools_deferred", name: "MCP tools (deferred)", tokens: 105644, kind: "deferred" },
      { id: "memory_files", name: "Memory files", tokens: 434, kind: "used" },
      { id: "skills", name: "Skills", tokens: 9957, kind: "used" },
      { id: "messages", name: "Messages", tokens: 12453, kind: "used" },
      { id: "autocompact_buffer", name: "Autocompact buffer", tokens: 33000, kind: "buffer" },
      { id: "free_space", name: "Free space", tokens: 931066, kind: "free" },
    ],
    memoryFiles: [{ path: "/Users/x/.claude/CLAUDE.md", type: "User", tokens: 434 }],
    mcpTools: [{ name: "mcp__cua__add_space", serverName: "cua", tokens: 720, isLoaded: false }],
    skills: { totalSkills: 100, includedSkills: 100, tokens: 9957, skillFrontmatter: [] },
    agents: [],
    messageBreakdown: { toolCallTokens: 104, toolResultTokens: 188, attachmentTokens: 35398, assistantMessageTokens: 454, userMessageTokens: 60, redirectedContextTokens: 0, unattributedTokens: 0, toolCallsByType: [{ name: "Read", callTokens: 66, resultTokens: 38 }, { name: "mcp__liner__browser_open", callTokens: 40, resultTokens: 900 }, { name: "mcp__cua__list_spaces", callTokens: 20, resultTokens: 300 }], attachmentsByType: [{ name: "prompt_snapshot", tokens: 19000 }, { name: "skill_listing", tokens: 8700 }] },
  } as unknown as Parameters<typeof contextSources>[0];
  const s = contextSources(u);
  const used = u.categories.filter((c) => c.kind === "used").reduce((n, c) => n + c.tokens, 0);
  assert.equal(s.reduce((n, x) => n + x.tokens, 0), used, "the chips add up to what's used");
  const by = Object.fromEntries(s.map((x) => [x.name, x]));
  assert.equal(by["CLAUDE.md"].group, "project");
  assert.match(by["CLAUDE.md"].detail ?? "", /User: ~\/\.claude\/CLAUDE\.md/);
  assert.equal(by["Browser"].group, "web");
  assert.equal(by["Files read"].group, "files");
  assert.equal(by["cua tools"].group, "tools", "an MCP server's calls go together under its name");
  assert.ok(by["Added context"].tokens > 0, "what's left of Messages is the context Claude Code adds");
  assert.equal(by["MCP tools"], undefined, "tools waiting outside the window aren't in it");
  // In the bar's order: the tool's own first, then the project's, then the conversation.
  assert.deepEqual([...new Set(s.map((x) => x.group))].slice(0, 3), ["setup", "project", "talk"]);
});

test("events: numbered; what's sent while the snapshot is taken comes after it, never lost, never twice", async () => {
  const { startServer } = await import("../src/server.ts");
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-events-")));
  const notice = (body: string) => store.emit({ type: "notify", threadId: "t", kind: "done", title: "x", body });
  const server = await startServer({
    store,
    api: { call: async () => null, ready: Promise.resolve() },
    // Something happens while the snapshot is being taken: before it's read, and after.
    snapshot: async () => {
      notice("in the snapshot");
      const snap = { seq: store.seq } as never;
      await new Promise((r) => setTimeout(r, 10));
      notice("after the snapshot");
      return snap;
    },
    token: "t",
    port: 0,
  });
  const lines: { type: string; seq?: number; body?: string }[] = [];
  const res = await fetch(`http://127.0.0.1:${server.port}/events`, { headers: { "x-liner-token": "t" } });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  const more = async () => {
    const { value } = await reader.read();
    buf += value ?? "";
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      if (buf.slice(0, i).trim()) lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  };
  try {
    while (!lines.some((l) => l.body === "after the snapshot")) await more();
    notice("later");
    while (!lines.some((l) => l.body === "later")) await more();
    assert.deepEqual(lines.map((l) => l.body ?? l.type), ["hello", "after the snapshot", "later"]);
    assert.ok(lines[2].seq! > lines[1].seq!);
  } finally {
    await reader.cancel();
    server.close();
  }
});

test("routines: a routines.json cut short gives way to the last good copy; the engine still starts", async () => {
  const { Routines } = await import("../src/routines.ts");
  const home = mkdtempSync(join(tmpdir(), "lc-routines-"));
  const store = new Store(home);
  writeFileSync(join(home, "routines.json"), '{"routines":[{"id":"r1"');
  assert.doesNotThrow(() => new Routines(store, {} as never, process.env));
  writeFileSync(join(home, "routines.json.bak"), JSON.stringify({ routines: [{ id: "r0" }], runs: [] }));
  writeFileSync(join(home, "routines.json"), "");
  assert.deepEqual(new Routines(store, {} as never, process.env).routines.map((r) => r.id), ["r0"]);
});

test("routines: a merge takes only the commit the run read, never past the day's limit even side by side; a trigger changed to GitHub starts from what's open", async () => {
  const { Routines } = await import("../src/routines.ts");
  const home = mkdtempSync(join(tmpdir(), "lc-routines-"));
  const bin = mkdtempSync(join(tmpdir(), "lc-gh-"));
  const log = join(bin, "gh.log");
  // A gh that takes its time merging, and says what it was asked.
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$@" >> ${log}\nsleep 0.2\n`, { mode: 0o755 });
  const store = new Store(home);
  const routines = new Routines(store, {} as never, { PATH: `${bin}:/usr/bin:/bin` });
  const r = routines.put({ name: "r", on: true, projectId: "p", trigger: { kind: "schedule", every: "day" }, steps: [], runsGo: "own", pauseAfter: 0, limits: { mergesPerDay: 1, tokensPerRun: 0 } });
  const act = (n: number, head?: string) => (routines as unknown as { act: (...a: unknown[]) => Promise<boolean> }).act({ kind: "action", action: "merge" }, { subject: { kind: "pr", number: n }, head }, "", bin, "t", r, { steps: [] });
  await assert.rejects(act(1), /didn't say which commit/);
  const both = await Promise.allSettled([act(2, "abc123"), act(3, "def456")]);
  assert.deepEqual(both.map((x) => x.status).sort(), ["fulfilled", "rejected"], "one merges, the other is past the limit");
  assert.match(readFileSync(log, "utf8"), /pr merge \d --squash --match-head-commit (abc123|def456)/);

  const polled: boolean[] = [];
  (routines as unknown as { poll: (r: unknown, quiet?: boolean) => Promise<void> }).poll = async (_r, quiet) => void polled.push(Boolean(quiet));
  routines.put({ ...r, trigger: { kind: "github", event: "pr.opened" } });
  assert.deepEqual(polled, [true], "a quiet first look, so what's already open doesn't fire");
});

test("context meter: another model, or going back, leaves no window or count from before", async () => {
  const { createApi } = await import("../src/api.ts");
  const { Runtime } = await import("../src/runtime.ts");
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-ctx-")));
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-ctx-p-")), git: false, createdAt: 1 });
  store.putThread({ id: "t", projectId: "p", title: "x", agent: "forge", model: "claude:claude-opus-5-5", status: "idle", access: "auto", turns: 1, usage: { ...emptyUsage(), contextTokens: 900000, contextWindow: 1000000 }, createdAt: 1, updatedAt: 1 });
  store.putItem("t", { kind: "user", id: "u", turn: 1, at: 1, text: "hi" });
  const api = createApi(store, new Runtime(store, { PATH: "/usr/bin:/bin" }), { PATH: "/usr/bin:/bin" }, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  await api.call("thread.update", { id: "t", model: "claude:claude-sonnet-5-5" });
  assert.deepEqual([store.thread("t").usage.contextTokens, store.thread("t").usage.contextWindow], [900000, undefined]);
  await api.call("thread.rewind", { threadId: "t", itemId: "u" });
  assert.equal(store.thread("t").usage.contextTokens, undefined);
});

test("going back: every part's own session starts fresh, the refiner's too, so none resumes the turns that came off", async () => {
  const { createApi } = await import("../src/api.ts");
  const { Runtime } = await import("../src/runtime.ts");
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-back-")));
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-back-p-")), git: false, createdAt: 1 });
  store.putThread({ id: "t", projectId: "p", title: "x", agent: "@codex:gpt-6-luna", status: "idle", access: "auto", turns: 1, usage: emptyUsage(), providerSession: "codex:a", sessions: { "@claude:claude-opus-5-5": "claude:b" }, createdAt: 1, updatedAt: 1 });
  store.putItem("t", { kind: "user", id: "u", turn: 1, at: 1, text: "hi" });
  const api = createApi(store, new Runtime(store, { PATH: "/usr/bin:/bin" }), { PATH: "/usr/bin:/bin" }, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  await api.call("thread.rewind", { threadId: "t", itemId: "u" });
  assert.deepEqual([store.thread("t").providerSession, store.thread("t").sessions], [undefined, undefined]);
});
