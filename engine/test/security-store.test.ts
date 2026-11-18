/*
  Liner Security's store: a finding is added once however many places raise it (same project, file and normalised rule or
  title), one you dismissed is remembered so nothing raises it again (until you open it again), one fixed and found again
  opens again, the Overview's day-by-day line is replayed from each finding's activity, the threat model's areas come
  from SECURITY.md's headings, and a scan session never leaves Read only: not by thread.update, not by a plan approved,
  not however it was created. A Specialist scan is sealed: Claude Code opens it with none of the person's settings,
  skills, plugins or MCP servers, and Liner's own server kept. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInfo, SecurityFinding, Thread } from "../../contracts/src/index.ts";
import { emptyUsage, findingKey, normalKey } from "../../contracts/src/index.ts";
import { parseAreas, Security, specialists, stateAt } from "../src/security.ts";
import { Store } from "../src/store.ts";
import { claude, sdk } from "../src/providers/claude.ts";
import type { OpenOptions, TurnSink } from "../src/providers/types.ts";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

function rig() {
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-sec-home-")));
  const path = mkdtempSync(join(tmpdir(), "lc-sec-p-"));
  store.putProject({ id: "p", name: "Sample project", path, git: false, createdAt: 1 });
  const sec = new Security(store, { PATH: "/usr/bin:/bin" });
  return { store, path, sec };
}

test("security: the same problem from two sources is one finding, its sources merged and its worst severity kept", () => {
  const { sec } = rig();
  const a = sec.add("p", { title: "The station id goes into the database query as text", severity: "medium", source: "agent", file: "./src/station.js", line: 41 });
  assert.equal(a.outcome, "new");
  assert.equal(a.finding.file, "src/station.js");
  const b = sec.add("p", { title: "the station ID goes into the database query, as text!", severity: "high", source: "sarif", file: "src/station.js", line: 44 });
  assert.equal(b.outcome, "already-open");
  assert.equal(b.finding.id, a.finding.id);
  assert.deepEqual(b.finding.sources, ["agent", "sarif"]);
  assert.equal(b.finding.severity, "high");
  assert.equal(b.finding.line, 41, "the first line it was found at stays");
  assert.equal(sec.findings("p").length, 1);
  // A rule id is the key when there is one: another title, the same rule, the same finding.
  sec.add("p", { title: "lodash 4.17.20 has a known problem", severity: "medium", source: "checks", file: "package.json", rule: "GHSA-35jh-r3h4-6jhm" });
  assert.equal(sec.add("p", { title: "Prototype pollution in lodash", severity: "high", source: "github", file: "package.json", rule: "GHSA-35jh-r3h4-6jhm" }).outcome, "already-open");
  assert.equal(sec.findings("p").length, 2);
  assert.equal(findingKey("p", { file: "a.js", title: "A  B." }), findingKey("p", { file: "a.js", title: "a b" }));
});

test("security: what you dismissed is remembered, across a restart, until you open it again", () => {
  const { store, sec } = rig();
  const f = sec.add("p", { title: "Error pages show where in the code it failed", severity: "low", source: "agent", file: "server.js", line: 88 }).finding;
  assert.throws(() => sec.dismiss(f.id, "nope" as never), /reason/);
  const d = sec.dismiss(f.id, "accepted-risk", "Only on the dev server");
  assert.equal(d.state, "dismissed");
  assert.deepEqual(d.dismissed && { reason: d.dismissed.reason, note: d.dismissed.note }, { reason: "accepted-risk", note: "Only on the dev server" });
  assert.equal(sec.add("p", { title: "Error pages show where in the code it failed", severity: "high", source: "agent", file: "server.js" }).outcome, "dismissed-before");
  // A new engine reads it back from disk: still dismissed, still remembered.
  const again = new Security(store, {});
  assert.equal(again.finding(f.id).state, "dismissed");
  assert.equal(again.add("p", { title: "error pages show where in the code it failed", severity: "low", source: "sarif", file: "server.js" }).outcome, "dismissed-before");
  assert.equal(again.findings("p").length, 1, "nothing stored for what was left out");
  // Opened again: forgotten, so a scan raises it as the open finding it is.
  assert.equal(again.reopen(f.id).state, "open");
  assert.equal(again.add("p", { title: "Error pages show where in the code it failed", severity: "low", source: "agent", file: "server.js" }).outcome, "already-open");
  // Found again by the same source as before: no line of its own (the same source's next run adds none).
  assert.deepEqual(again.finding(f.id).activity.map((e) => e.kind), ["found", "dismissed", "reopened"]);
});

test("security: a fixed finding found again opens again; the file never sits in the project and a broken one reads as empty", () => {
  const { store, path, sec } = rig();
  const f = sec.add("p", { title: "API key in config", severity: "high", source: "checks", file: "config.js", rule: "secret/api-key" }).finding;
  assert.equal(sec.fixed(f.id).state, "fixed");
  const r = sec.add("p", { title: "API key in config", severity: "high", source: "checks", file: "config.js", rule: "secret/api-key" });
  assert.equal(r.outcome, "reopened");
  assert.equal(r.finding.state, "open");
  assert.equal(stateAt(r.finding, Date.now()), "open");
  // Kept under the engine's home, never in the project's folder.
  assert.equal(readdirSync(join(store.home, "security")).length, 1);
  assert.deepEqual(readdirSync(path), []);
  // A store file someone broke reads as nothing, rather than failing every call.
  const broken = mkdtempSync(join(tmpdir(), "lc-sec-broken-"));
  const s2 = new Store(broken);
  s2.putProject({ id: "q", name: "q", path, git: false, createdAt: 1 });
  const sec2 = new Security(s2, {});
  sec2.add("q", { title: "x", severity: "low", source: "agent" });
  const [only] = readdirSync(join(broken, "security"));
  writeFileSync(join(broken, "security", only), "{not json");
  assert.deepEqual(new Security(s2, {}).findings("q"), []);
  // Entries that don't hold up are dropped, the rest kept.
  writeFileSync(join(broken, "security", only), JSON.stringify({ findings: [{ id: "x" }, { ...sec2.findings("q")[0] }] }));
  assert.equal(new Security(s2, {}).findings("q").length, 1);
});

test("security: the Overview's line is replayed from activity, day by day, with the scans that ran and the splits", () => {
  const { sec } = rig();
  const now = new Date(2026, 10, 17, 15, 0).getTime();
  const day = 86_400_000;
  const at = (daysAgo: number) => now - daysAgo * day;
  // Put a finding in with its whole history, as the store keeps it.
  const put = (title: string, severity: SecurityFinding["severity"], events: SecurityFinding["activity"], more: Partial<SecurityFinding> = {}) => {
    const f = sec.add("p", { title, severity, source: "agent" }).finding;
    return sec.update(f.id, (x) => ({ ...x, foundAt: events[0].at, activity: events, state: more.state ?? "open", ...more }), true);
  };
  put("key in config", "high", [{ at: at(24), kind: "found", text: "" }, { at: at(1), kind: "fixed", text: "" }], { state: "fixed" });
  put("branch problem", "medium", [{ at: at(5), kind: "found", text: "" }, { at: at(3), kind: "dismissed", text: "" }], { state: "dismissed", dismissed: { reason: "accepted-risk", at: at(3) } });
  put("query as text", "high", [{ at: at(0) - 3600_000, kind: "found", text: "" }], { look: { state: "confirmed", by: "codex:gpt-5.5" } });
  put("admin in browser", "medium", [{ at: at(0) - 3600_000, kind: "found", text: "" }], { look: { state: "confirmed" }, fix: { threadId: "th_fix", state: "working", at: now } });
  put("error pages", "low", [{ at: at(0) - 3600_000, kind: "found", text: "" }], { look: { state: "unconfirmed" } });
  const s = sec.newScan({ projectId: "p", depth: "project", title: "Sample project, in full", startedAt: at(0) - 7200_000 });
  const o = sec.overview(30, undefined, now);
  assert.equal(o.series.length, 30);
  assert.equal(o.series[29].day, "2026-11-17");
  assert.equal(o.series[29].open, 3);
  assert.deepEqual(o.series[29].scans, [s.id]);
  assert.equal(o.series[29].found, 3);
  assert.equal(o.series[28].open, 0, "the key was fixed yesterday and nothing else was open");
  assert.equal(o.series[28].fixed, 1);
  assert.equal(o.series[25].open, 2, "four days ago the branch problem (found the day before) was open beside the key");
  assert.equal(o.series[26].dismissed, 1);
  assert.equal(o.series[0].open, 0);
  assert.equal(o.series[4].open, 0);
  assert.equal(o.series[5].open, 1, "found 24 days ago");
  assert.equal(o.open, 3);
  assert.equal(o.openWeekAgo, 1);
  assert.equal(o.found, 5);
  assert.equal(o.fixed, 1);
  assert.equal(o.dismissed, 1);
  assert.deepEqual(o.dismissReasons, { "accepted-risk": 1 });
  assert.equal(o.beingFixed, 1);
  assert.deepEqual(o.fixThreads, ["th_fix"]);
  assert.deepEqual(o.bySeverity, { critical: 0, high: 1, medium: 1, low: 1 });
  assert.deepEqual(o.byLook, { confirmed: 2, unconfirmed: 1, none: 0 });
  assert.deepEqual(o.worst.map((f) => f.title), ["query as text", "admin in browser", "error pages"]);
  assert.deepEqual(o.byProject, [{ projectId: "p", name: "Sample project", open: 3, bySeverity: { critical: 0, high: 1, medium: 1, low: 1 } }]);
  assert.equal(sec.projectSummary("p").lastScan?.id, s.id);
  assert.deepEqual(sec.projectSummary("p").readers, ["free checks"]);
});

test("security: SECURITY.md's areas are its headings and the line under each, with what is open in each", () => {
  const md = "# Security\n\nWhat this project trusts.\n\n## Station data\nThe tide stations' ids come from the URL.\n\n### Admin\n- Only staff reach /admin.\n\n```\n## not a heading\n```\n## Answers to the scan's questions\nAnswered on 17 Nov.\n\n## Empty\n";
  assert.deepEqual(parseAreas(md), [
    { name: "Station data", line: "The tide stations' ids come from the URL." },
    { name: "Admin", line: "Only staff reach /admin." },
    { name: "Empty", line: "" },
  ]);
  const { path, sec } = rig();
  assert.deepEqual(sec.model("p"), { file: "SECURITY.md", exists: false, areas: [] });
  writeFileSync(join(path, "SECURITY.md"), md);
  sec.add("p", { title: "query as text", severity: "high", source: "agent", area: "station data" });
  const m = sec.model("p");
  assert.equal(m.exists, true);
  assert.deepEqual(m.areas.map((a) => [a.name, a.open]), [["Station data", 1], ["Admin", 0], ["Empty", 0]]);
  assert.throws(() => sec.setModelFile("p", "../elsewhere.md"), /inside the project/);
});

test("security: a Specialist scan is offered only for a security model a signed-in tool lists, or an endpoint you marked, that can be sealed", () => {
  const info = (id: string, models: string[], more: Partial<ProviderInfo> = {}): ProviderInfo => ({ id: id as ProviderInfo["id"], label: id === "claude" ? "Claude Code" : id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true }, ...more });
  const none = specialists([info("claude", ["claude-opus-5-5"]), info("codex", ["gpt-5.5"])], {});
  assert.deepEqual(none, []);
  const found = specialists([info("claude", ["claude-opus-5-5", "claude-mythos-1"]), info("codex", ["gpt-5.5-cyber"]), info("claude.work", ["claude-mythos-1"], { signedIn: false })], {});
  assert.deepEqual(found.map((s) => [s.ref, s.via, s.sealable]), [["@claude:claude-mythos-1", "through Claude Code", true]], "Codex can't be sealed, a signed-out account isn't offered");
  const ep = specialists([info("claude.sec", ["unrestricted-1"], { endpoint: "sec" }), info("opencode.other", ["m"], { endpoint: "other" })], { endpoints: [{ id: "sec", label: "Red team API", url: "https://x", protocol: "anthropic", models: ["unrestricted-1"] }, { id: "other", label: "Other", url: "https://y", protocol: "chat", models: ["m"] }], securityEndpoints: ["sec", "other"] });
  assert.deepEqual(ep.map((s) => [s.id, s.ref]), [["endpoint:sec", "@claude.sec:unrestricted-1"]], "an endpoint through OpenCode can't be sealed");
});

test("security: a scan session is made at Read only and can never leave it", async () => {
  const { createApi } = await import("../src/api.ts");
  const { Runtime } = await import("../src/runtime.ts");
  const { store } = rig();
  const sec = new Security(store, {});
  const api = createApi(store, new Runtime(store, { PATH: "/usr/bin:/bin" }), { PATH: "/usr/bin:/bin" }, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {}, security: sec } as never);
  const call = <T>(m: string, p: unknown) => api.call(m, p) as Promise<T>;
  const t = await call<Thread>("thread.create", { projectId: "p", agent: "demo", access: "full", security: { kind: "scan", scan: "sc_1", sealed: true, other: 1 } });
  assert.equal(t.access, "read");
  assert.deepEqual(t.security, { kind: "scan", scan: "sc_1", sealed: true });
  await assert.rejects(call("thread.update", { id: t.id, access: "auto" }), /stays at Read only/);
  assert.equal((await call<Thread>("thread.update", { id: t.id, access: "read", title: "Scan" })).access, "read");
  // Whatever else asks (a plan approved patches the thread to Auto), the store holds it at Read only.
  assert.equal(store.patchThread(t.id, { access: "full" }).access, "read");
  // A fix is an ordinary session: its level is its own; sealed means nothing outside a scan.
  const fix = await call<Thread>("thread.create", { projectId: "p", agent: "demo", access: "auto", security: { kind: "fix", finding: "sf_1", sealed: true } });
  assert.equal(fix.access, "auto");
  assert.deepEqual(fix.security, { kind: "fix", finding: "sf_1" });
  await assert.rejects(call("thread.create", { projectId: "p", agent: "demo", security: { kind: "audit" } }), /scan, a fix or a question/);
  await assert.rejects(call("thread.create", { projectId: "p", agent: "demo", security: { kind: "scan", scan: "../x" } }), /is an id/);
  // The store work answers through the RPC too.
  const f = sec.add("p", { title: "query as text", severity: "high", source: "agent" }).finding;
  assert.equal((await call<SecurityFinding>("security.finding.dismiss", { id: f.id, reason: "false-positive" })).state, "dismissed");
  assert.deepEqual((await call<SecurityFinding[]>("security.findings.list", { state: "open" })).length, 0);
  assert.equal((await call<{ open: number }>("security.overview", {})).open, 0);
  await assert.rejects(call("settings.save", { openIn: "elsewhere" }), /Code, Design or Security/);
  assert.equal((await call<{ openIn?: string }>("settings.save", { openIn: "security" })).openIn, "security");
});

test("security: a plan proposed in a scan is turned down with no card, so it never goes to Auto", async () => {
  const { Runtime, providers } = await import("../src/runtime.ts");
  const { store } = rig();
  const now = Date.now();
  store.putThread({ id: "t", projectId: "p", title: "scan", agent: "@claude:claude-opus-5-5", status: "idle", access: "read", security: { kind: "scan" }, turns: 0, usage: emptyUsage(), createdAt: now, updatedAt: now });
  const runtime = new Runtime(store, { PATH: "/usr/bin:/bin" });
  const saved = providers.claude;
  let answer: { approve: boolean; note?: string } | undefined;
  providers.claude = { ...saved, open: () => ({ turn: async (_t: string, sink: TurnSink) => void (answer = await sink.propose("Fix it", "1. Edit the query", new AbortController().signal)), close() {} }) } as never;
  try {
    await runtime.send("t", "scan it");
    for (let i = 0; i < 200 && !answer; i++) await tick();
  } finally {
    providers.claude = saved;
  }
  assert.equal(answer?.approve, false);
  assert.match(answer?.note ?? "", /security scan: it only reads/);
  assert.ok(!store.timeline("t").some((x) => x.kind === "proposal"), "no plan card to approve");
  assert.equal(store.thread("t").access, "read");
});

test("security: Claude Code opens a sealed session with none of your settings, skills, plugins or servers, and Liner's own kept", async () => {
  const saved = sdk.query;
  let options: Record<string, unknown> = {};
  sdk.query = (({ options: o }: { options: Record<string, unknown> }) => {
    options = o;
    return { async *[Symbol.asyncIterator]() {}, initializationResult: async () => ({}), interrupt: async () => {}, setPermissionMode: async () => {}, setMcpServers: async () => ({ errors: {} }), return: async () => ({ done: true, value: undefined }) };
  }) as unknown as typeof sdk.query;
  const sink = { text() {}, reasoning() {}, tool() {}, plan() {}, approve: async () => ({ allow: false }), ask: async () => null, propose: async () => ({ approve: false }), usage() {}, session() {}, notice() {}, error() {}, limited() {} } as unknown as TurnSink;
  const open = async (more: Partial<OpenOptions>) => {
    options = {};
    const s = claude.open({ cwd: "/tmp", model: "claude-mythos-1", effort: "medium", access: "read", soul: "", guard: true, env: { PATH: "" }, mcp: { command: "node", args: ["mcp.js"], env: {} }, connections: [{ name: "notes", stdio: { command: "notes", args: [], env: {} } }], subagents: { explorer: { description: "x", prompt: "y" } }, ...more } as OpenOptions);
    void s.turn("go", sink, new AbortController().signal).catch(() => {});
    for (let i = 0; i < 100 && !options.cwd; i++) await tick();
    s.close();
    return options;
  };
  try {
    const sealed = await open({ sealed: true });
    assert.deepEqual(sealed.settingSources, []);
    assert.deepEqual(sealed.skills, []);
    assert.deepEqual(sealed.plugins, []);
    assert.equal(sealed.strictMcpConfig, true);
    assert.equal(sealed.agents, undefined);
    assert.ok((sealed.disallowedTools as string[]).includes("Skill"));
    assert.deepEqual(Object.keys(sealed.mcpServers as object), ["liner"], "Liner's own server stays");
    // A scan, sealed or not, reads the project and nothing else: none of Claude Code's own tools that reach out or spawn.
    const reach = ["WebFetch", "WebSearch", "Agent", "Workflow", "CronCreate", "ScheduleWakeup", "EnterWorktree"];
    for (const scan of [await open({ scan: true }), await open({ scan: true, sealed: true }), await open({ scan: true, side: true })]) for (const tool of reach) assert.ok((scan.disallowedTools as string[]).includes(tool), tool);
    assert.ok(((await open({ scan: true, side: true })).disallowedTools as string[]).includes("Edit"), "a scan's side chat still writes nothing");
    const usual = await open({});
    assert.equal(usual.disallowedTools, undefined);
    assert.deepEqual(usual.settingSources, ["user", "project", "local"]);
    assert.equal(usual.strictMcpConfig, undefined);
  } finally {
    sdk.query = saved;
  }
});

test("security: a folder removed and added again keeps its findings under its new id: listed, dismissed, counted", () => {
  const { store, path, sec } = rig();
  const f = sec.add("p", { title: "The station id goes into the query as text", severity: "high", source: "agent", file: "a.js" }).finding;
  assert.equal(sec.overview(30, "p").open, 1);
  store.removeProject("p");
  store.putProject({ id: "p2", name: "Sample project", path, git: false, createdAt: 2 });
  const list = sec.findings("p2");
  assert.deepEqual(list.map((x) => [x.id, x.projectId, x.key]), [[f.id, "p2", findingKey("p2", f)]]);
  assert.equal(sec.finding(f.id).projectId, "p2");
  assert.equal(sec.overview(30, "p2").open, 1);
  assert.equal(sec.overview(30).open, 1);
  assert.equal(sec.dismiss(f.id, "duplicate").state, "dismissed");
  assert.equal(sec.add("p2", { title: "The station id goes into the query as text", severity: "high", source: "agent", file: "a.js" }).outcome, "dismissed-before");
});

test("security: keys read every script, and follow a retitle the same before and after a restart", () => {
  const { store, sec } = rig();
  assert.equal(normalKey("駅のIDがそのままクエリに入る。"), "駅のidがそのままクエリに入る");
  const a = sec.add("p", { title: "駅のIDがそのままクエリに入る", severity: "high", source: "agent", file: "a.js" });
  const b = sec.add("p", { title: "管理画面にログインなしで入れる", severity: "medium", source: "agent", file: "a.js" });
  assert.deepEqual([a.outcome, b.outcome], ["new", "new"], "two titles in Japanese are two findings");
  sec.dismiss(a.finding.id, "false-positive");
  assert.equal(sec.finding(b.finding.id).state, "open", "dismissing one leaves the other");
  // Retitled: its key follows now, and is the same after a restart.
  const re = sec.update(b.finding.id, (x) => ({ ...x, title: "The admin page opens without signing in" }));
  assert.equal(re.key, findingKey("p", { file: "a.js", title: "The admin page opens without signing in" }));
  assert.equal(sec.add("p", { title: "the admin page opens without signing in.", severity: "low", source: "agent", file: "a.js" }).outcome, "already-open");
  assert.equal(new Security(store, {}).finding(b.finding.id).key, re.key);
});

test("security: the threat model is read only from inside the project by real path", () => {
  const { path, sec } = rig();
  const outside = mkdtempSync(join(tmpdir(), "lc-sec-out-"));
  writeFileSync(join(outside, "SECURITY.md"), "# Elsewhere\n\n## Outside area\nNot this project's.\n");
  symlinkSync(join(outside, "SECURITY.md"), join(path, "SECURITY.md"));
  assert.deepEqual([sec.model("p").exists, sec.model("p").areas.length], [false, 0], "a SECURITY.md linked outside isn't read");
  symlinkSync(outside, join(path, "docs"));
  sec.setModelFile("p", "docs/SECURITY.md");
  assert.equal(sec.model("p").exists, false, "nor through a linked folder");
  mkdirSync(join(path, "real"));
  writeFileSync(join(path, "real", "SECURITY.md"), "# Model\n\n## Sign in\nWho gets in.\n");
  sec.setModelFile("p", "real/SECURITY.md");
  assert.deepEqual(sec.model("p").areas.map((x) => x.name), ["Sign in"]);
});

test("security: the Overview's dismissed counts what is dismissed now, its reasons are the current ones, and being fixed is only fixes at work", () => {
  const { sec } = rig();
  const one = sec.add("p", { title: "One", severity: "high", source: "agent", file: "a.js" }).finding;
  const two = sec.add("p", { title: "Two", severity: "low", source: "agent", file: "a.js" }).finding;
  const three = sec.add("p", { title: "Three", severity: "low", source: "agent", file: "b.js" }).finding;
  for (const r of ["duplicate", "false-positive", "not-actionable", "accepted-risk", "mitigated"] as const) {
    sec.dismiss(one.id, r);
    sec.reopen(one.id);
  }
  sec.dismiss(two.id, "mitigated");
  let o = sec.overview(30, "p");
  assert.equal(o.dismissed, 1, "one finding is dismissed now, however often the other was");
  assert.deepEqual(o.dismissReasons, { mitigated: 1 });
  sec.update(one.id, (x) => ({ ...x, fix: { threadId: "t1", state: "working", at: 1 } }));
  sec.update(three.id, (x) => ({ ...x, fix: { threadId: "t3", state: "ready", at: 1 } }));
  o = sec.overview(30, "p");
  assert.deepEqual([o.beingFixed, o.fixThreads, o.fixesReady], [1, ["t1"], 1]);
});
