/*
  The Pull requests and Issues lists: gh's JSON read into rows, each project asked once per refresh, the projects that
  can't be read named with why, Linear's issues through a fake fetch, and the Demo's mockup lists. No real gh, GitHub or
  Linear: a fake runner and fetch stand in. Run with `node --test engine/test/worklists.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scmKey } from "../../contracts/src/index.ts";
import type { Runner } from "../src/sourcecontrol.ts";
import { Store } from "../src/store.ts";
import { checkCounts, issueItemOf, LINEAR_PROJECT, linearItemOf, matches, prItemOf, Worklists, type GhIssueRow, type GhPrRow } from "../src/worklists.ts";

const PR_ROW: GhPrRow = {
  number: 131,
  title: "Store tide alerts per harbour",
  url: "https://github.com/o/foreshore/pull/131",
  state: "OPEN",
  isDraft: false,
  author: { login: "devon" },
  headRefName: "liner/alerts",
  baseRefName: "main",
  additions: 342,
  deletions: 58,
  changedFiles: 9,
  labels: [{ name: "bug", color: "d73a4a" }],
  updatedAt: "2026-11-26T10:00:00Z",
  reviewRequests: [{ login: "Harbour-Dev" }, { name: "core-team" }],
  statusCheckRollup: [{ name: "test", conclusion: "SUCCESS" }, { name: "lint", conclusion: "FAILURE" }, { context: "deploy", state: "PENDING" }, { name: "docs", conclusion: "SKIPPED" }],
};
const ISSUE_ROW: GhIssueRow = { number: 42, title: "Harbour alerts show for the wrong harbour", url: "https://github.com/o/foreshore/issues/42", state: "OPEN", author: { login: "kai" }, assignees: [{ login: "harbour-dev" }], labels: [{ name: "bug", color: "d73a4a" }], comments: [{}, {}, {}, {}], updatedAt: "2026-11-25T09:00:00Z" };
const proj = { id: "p1", name: "foreshore" };

test("A row of gh pr list becomes a pull request: its state, its checks counted, yours and asked of you by your login", () => {
  const it = prItemOf(PR_ROW, proj, "harbour-dev", "th_1");
  assert.equal(it.state, "open");
  assert.equal(it.mine, false);
  assert.equal(it.reviewRequested, true, "matched without regard to case; a team asked counts for no one");
  assert.deepEqual(it.checks, { passed: 1, failed: 1, pending: 1, failing: ["lint"] });
  assert.deepEqual(it.labels, [{ name: "bug", color: "#d73a4a" }]);
  assert.equal(it.files, 9);
  assert.equal(it.updatedAt, Date.parse("2026-11-26T10:00:00Z"));
  assert.equal(it.threadId, "th_1");
  assert.equal(it.host, "github");
  assert.equal(prItemOf({ ...PR_ROW, isDraft: true }, proj).state, "draft");
  assert.equal(prItemOf({ ...PR_ROW, state: "MERGED" }, proj).state, "merged");
  assert.equal(prItemOf({ ...PR_ROW, author: { login: "harbour-dev" } }, proj, "harbour-dev").mine, true);
  assert.equal(checkCounts([]), undefined, "no checks, no count");
});

test("A row of gh issue list becomes an issue with its comments counted and whether it's yours", () => {
  const it = issueItemOf(ISSUE_ROW, proj, "harbour-dev");
  assert.equal(it.key, "#42");
  assert.equal(it.state, "open");
  assert.equal(it.assignedToMe, true);
  assert.equal(it.comments, 4);
  assert.equal(it.tracker, "github");
  assert.equal(issueItemOf({ ...ISSUE_ROW, state: "CLOSED" }, proj).state, "closed");
});

test("The search box matches a number, a label, an author and words in the title", () => {
  const it = prItemOf(PR_ROW, proj);
  assert.equal(matches(it, "#131"), true);
  assert.equal(matches(it, "131"), true);
  assert.equal(matches(it, "label:bug"), true);
  assert.equal(matches(it, "label:docs"), false);
  assert.equal(matches(it, "author:dev"), true);
  assert.equal(matches(it, "tide harbour"), true);
  assert.equal(matches(it, "tide wind"), false);
  assert.equal(matches(it, ""), true);
});

/** A store with a GitHub project, one elsewhere, and a session that owns #131. */
function rig() {
  const home = mkdtempSync(join(tmpdir(), "lc-wl-"));
  const store = new Store(home);
  store.putProject({ id: "p1", name: "foreshore", path: "/work/foreshore", git: true, remote: "o/foreshore", createdAt: 1 });
  store.putProject({ id: "p2", name: "notes", path: "/work/notes", git: true, createdAt: 2 });
  store.putProject({ id: "p3", name: "plain", path: "/work/plain", git: false, createdAt: 3 });
  store.putThread({ id: "th_1", projectId: "p1", title: "Alerts", agent: "a", status: "idle", access: "ask", turns: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }, createdAt: 1, updatedAt: 1, pr: { number: 131, url: PR_ROW.url, state: "OPEN" } });
  return { home, store };
}

/** A gh that's signed in as harbour-dev, answers for /work/foreshore, and counts what it's asked. */
function fakeGh(o: { signedIn?: boolean; failList?: boolean } = {}) {
  const calls: { cmd: string; args: string[]; cwd?: string }[] = [];
  const run: Runner = async (cmd, args, opt) => {
    calls.push({ cmd, args, cwd: opt.cwd });
    const a = args.join(" ");
    if (cmd === "git") return { code: 0, stdout: "git@gitlab.com:o/notes.git\n", stderr: "" };
    if (a === "auth status") return o.signedIn === false ? { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts." } : { code: 0, stdout: "", stderr: "" };
    if (a.startsWith("api user")) return { code: 0, stdout: "harbour-dev\n", stderr: "" };
    if (args[0] === "pr" && args[1] === "list") return o.failList ? { code: 1, stdout: "", stderr: "HTTP 502\nGraphQL: something went wrong" } : { code: 0, stdout: JSON.stringify([PR_ROW]), stderr: "" };
    if (args[0] === "issue" && args[1] === "list") return { code: 0, stdout: JSON.stringify([ISSUE_ROW]), stderr: "" };
    if (args[0] === "pr" && args[1] === "view") return { code: 0, stdout: JSON.stringify({ ...PR_ROW, body: "Per harbour.", files: [{ path: "src/a.ts", additions: 3, deletions: 1 }], headRefOid: "9f2c4e1a7b3d5f60812a4c6e8b0d2f4a6c8e0b1d", isCrossRepository: true }), stderr: "" };
    return { code: 1, stdout: "", stderr: "unknown" };
  };
  return { calls, run };
}

test("Pull requests come from each GitHub project, tied to the session that owns one, and the others are named with why", async () => {
  const { store } = rig();
  const gh = fakeGh();
  const w = new Worklists({ env: {}, keys: new Map(), run: gh.run, which: () => "/opt/bin/gh" });
  const r = await w.prs(store);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].project, "foreshore");
  assert.equal(r.items[0].threadId, "th_1");
  assert.equal(r.items[0].reviewRequested, true);
  assert.deepEqual(r.unavailable.map((u) => [u.project, u.why]).sort(), [["notes", "Not on GitHub."], ["plain", "Not a Git repository."]]);
  const list = gh.calls.find((c) => c.args[0] === "pr");
  assert.equal(list?.cwd, "/work/foreshore");
  assert.deepEqual(list?.args.slice(0, 4), ["pr", "list", "--state", "open"]);
});

test("Lists are kept until the refresh comes round, and fresh asks gh again", async () => {
  const { store } = rig();
  const gh = fakeGh();
  let now = 1_000_000;
  const w = new Worklists({ env: {}, keys: new Map(), run: gh.run, which: () => "/opt/bin/gh", now: () => now });
  const lists = () => gh.calls.filter((c) => c.args[0] === "pr" && c.args[1] === "list").length;
  await w.prs(store);
  await w.prs(store);
  assert.equal(lists(), 1, "the second page asks no one");
  await w.prs(store, { fresh: true });
  assert.equal(lists(), 2);
  now += 2 * 60_000;
  await w.prs(store);
  assert.equal(lists(), 3, "after the two-minute refresh it asks again");
  await Promise.all([w.prs(store, { q: "tide" }), w.prs(store, { q: "harbour" })]);
  assert.equal(lists(), 3, "a search reads the kept list");
});

test("Without gh, or signed out of it, every GitHub project says so instead of failing the list", async () => {
  const { store } = rig();
  const missing = await new Worklists({ env: {}, keys: new Map(), run: fakeGh().run, which: () => null }).prs(store);
  assert.deepEqual(missing.items, []);
  assert.match(missing.unavailable.find((u) => u.projectId === "p1")!.why, /isn't installed/);
  const out = await new Worklists({ env: {}, keys: new Map(), run: fakeGh({ signedIn: false }).run, which: () => "/opt/bin/gh" }).prs(store);
  assert.match(out.unavailable.find((u) => u.projectId === "p1")!.why, /isn't signed in/);
  const failed = await new Worklists({ env: {}, keys: new Map(), run: fakeGh({ failList: true }).run, which: () => "/opt/bin/gh" }).prs(store);
  assert.equal(failed.unavailable.find((u) => u.projectId === "p1")!.why, "GraphQL: something went wrong", "gh's own last line");
});

test("GitHub's switch off leaves its pull requests out without calling gh", async () => {
  const { store } = rig();
  store.setSettings({ hosts: { github: false } });
  const gh = fakeGh();
  const r = await new Worklists({ env: {}, keys: new Map(), run: gh.run, which: () => "/opt/bin/gh" }).prs(store);
  assert.deepEqual(r.items, []);
  assert.ok(!gh.calls.some((c) => c.cmd === "gh"));
});

test("A pull request's detail lists its files and body, its head commit and whether it comes from a fork", async () => {
  const { store } = rig();
  const gh = fakeGh();
  const d = await new Worklists({ env: {}, keys: new Map(), run: gh.run, which: () => "/opt/bin/gh" }).pr(store, "p1", 131);
  assert.equal(d.body, "Per harbour.");
  assert.deepEqual(d.fileList, [{ path: "src/a.ts", additions: 3, deletions: 1 }]);
  assert.equal(d.headSha, "9f2c4e1a7b3d5f60812a4c6e8b0d2f4a6c8e0b1d");
  assert.equal(d.isCrossRepository, true);
  const fields = gh.calls.find((c) => c.args[1] === "view")!.args.at(-1)!.split(",");
  assert.ok(fields.includes("headRefOid") && fields.includes("isCrossRepository"), "gh is asked for both");
});

test("A Linear issue is closed when done or canceled, and yours when the viewer is assigned", () => {
  const n = { identifier: "LIN-12", number: 12, title: "Tide feed times out", url: "https://linear.app/x/issue/LIN-12", updatedAt: "2026-11-20T00:00:00Z", state: { type: "started" }, creator: { displayName: "kai" }, assignee: { id: "u1" }, team: { key: "LIN", name: "Harbour" }, labels: { nodes: [{ name: "Bug", color: "#eb5757" }] }, comments: { nodes: [{}, {}] } };
  const it = linearItemOf(n, "u1");
  assert.equal(it.key, "LIN-12");
  assert.equal(it.projectId, LINEAR_PROJECT);
  assert.equal(it.project, "Harbour");
  assert.equal(it.state, "open");
  assert.equal(it.assignedToMe, true);
  assert.equal(it.comments, 2);
  assert.equal(linearItemOf({ ...n, state: { type: "canceled" } }).state, "closed");
  assert.equal(linearItemOf(n, "u2").assignedToMe, false);
});

test("Issues come from gh and from Linear with the key alone, and a Linear failure is named, not thrown", async () => {
  const { store } = rig();
  const key = "lin_api_0123456789abcdefghij";
  const sent: { auth: string; body: { variables: { filter?: unknown } } }[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    sent.push({ auth: String((init.headers as Record<string, string>).authorization), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ data: { viewer: { id: "u1" }, issues: { nodes: [{ identifier: "LIN-7", number: 7, title: "Tides in Welsh", url: "https://linear.app/x/issue/LIN-7", state: { type: "unstarted" }, assignee: { id: "u1" }, team: { name: "Harbour" } }] } } }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const w = new Worklists({ env: {}, keys: new Map([[scmKey("linear"), key]]), run: fakeGh().run, which: () => "/opt/bin/gh", fetch });
  const r = await w.issues(store);
  assert.deepEqual(r.items.map((i) => i.key).sort(), ["#42", "LIN-7"]);
  assert.equal(r.items.find((i) => i.key === "#42")!.assignedToMe, true);
  assert.equal(sent[0].auth, key);
  assert.deepEqual(sent[0].body.variables.filter, { state: { type: { nin: ["completed", "canceled"] } } });
  // One project's issues leave Linear's out: they belong to no folder.
  const one = await w.issues(store, { projectId: "p1", fresh: true });
  assert.deepEqual(one.items.map((i) => i.key), ["#42"]);
  const down = new Worklists({ env: {}, keys: new Map([[scmKey("linear"), key]]), run: fakeGh().run, which: () => "/opt/bin/gh", fetch: (async () => new Response("{}", { status: 401 })) as unknown as typeof globalThis.fetch });
  const d = await down.issues(store);
  assert.deepEqual(d.items.map((i) => i.key), ["#42"]);
  assert.match(d.unavailable.find((u) => u.projectId === LINEAR_PROJECT)!.why, /didn't take the key/);
  assert.ok(!JSON.stringify(d).includes(key), "the key is never in a list");
});

test("Without a Linear key, Linear is never asked", async () => {
  const { store } = rig();
  const fetch = (async () => assert.fail("no key, no request")) as unknown as typeof globalThis.fetch;
  const r = await new Worklists({ env: {}, keys: new Map(), run: fakeGh().run, which: () => "/opt/bin/gh", fetch }).issues(store);
  assert.deepEqual(r.items.map((i) => i.key), ["#42"]);
});

test("The Demo's Sample project shows the mockup's pull requests and issues without asking gh", async () => {
  const { store, home } = rig();
  store.putProject({ id: "ps", name: "Sample project", path: join(home, "Sample project"), git: true, createdAt: 4 });
  const gh = fakeGh();
  const w = new Worklists({ env: {}, keys: new Map(), run: gh.run, which: () => "/opt/bin/gh" });
  const hidden = await w.prs(store, { projectId: "ps" });
  assert.equal(hidden.unavailable[0]?.why, "Not on GitHub.", "only while the Demo is shown");
  store.setSettings({ showDemo: true });
  const before = gh.calls.length;
  const prs = await w.prs(store, { projectId: "ps" });
  assert.deepEqual(prs.items.map((p) => p.number), [129, 128, 131, 126, 58, 124]);
  assert.equal(prs.items.find((p) => p.number === 126)!.state, "draft");
  assert.deepEqual(prs.items.find((p) => p.number === 131)!.checks, { passed: 5, failed: 1, pending: 0, failing: ["lint"] });
  const issues = await w.issues(store, { projectId: "ps" });
  assert.deepEqual(issues.items.map((i) => i.key).sort(), ["#12", "#31", "#35", "#37", "#40", "#42"]);
  const d = await w.pr(store, "ps", 131);
  assert.equal(d.fileList.length, 9);
  assert.equal(d.fileList.reduce((a, f) => a + f.additions, 0), 342);
  assert.equal(d.fileList.reduce((a, f) => a + f.deletions, 0), 58);
  assert.match(d.headSha ?? "", /^[0-9a-f]{40}$/);
  assert.equal(d.isCrossRepository, false);
  assert.deepEqual((await w.issue(store, "ps", "#42")).linkedPrs, [131]);
  assert.equal(gh.calls.length, before, "gh is never asked for the Demo");
});

test("A pull request's detail is asked of gh only for a positive whole number", async () => {
  const { store } = rig();
  const gh = fakeGh();
  const w = new Worklists({ env: {}, keys: new Map(), run: gh.run, which: () => "/opt/bin/gh" });
  for (const n of [-1, 0, 1.5, Number.NaN]) await assert.rejects(w.pr(store, "p1", n), /isn't a pull request's number/, String(n));
  assert.ok(!gh.calls.some((c) => c.args[0] === "pr"), "gh never sees a number like that");
});

test("A Linear issue's detail comes from Linear, asked by its key under a project or under Linear's own id", async () => {
  const { store } = rig();
  const key = "lin_api_0123456789abcdefghij";
  const asked: unknown[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    asked.push(JSON.parse(String(init.body)).variables);
    return new Response(JSON.stringify({ data: { viewer: { id: "u1" }, issue: { identifier: "LIN-12", number: 12, title: "Tide feed times out", url: "https://linear.app/x/issue/LIN-12", state: { type: "started" }, assignee: { id: "u1" }, team: { name: "Harbour" }, description: "It times out at dawn." } } }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const gh = fakeGh();
  const w = new Worklists({ env: {}, keys: new Map([[scmKey("linear"), key]]), run: gh.run, which: () => "/opt/bin/gh", fetch });
  const a = await w.issue(store, "p1", "LIN-12");
  assert.equal(a.key, "LIN-12");
  assert.equal(a.tracker, "linear");
  assert.equal(a.body, "It times out at dawn.");
  const b = await w.issue(store, LINEAR_PROJECT, "LIN-12");
  assert.equal(b.key, "LIN-12");
  assert.deepEqual(asked, [{ id: "LIN-12" }, { id: "LIN-12" }]);
  assert.ok(!gh.calls.some((c) => c.cmd === "gh"), "gh is never asked for a Linear key");
  await assert.rejects(w.issue(store, LINEAR_PROJECT, "#12"), /Linear issue's key/);
});

test("A pull request merged from Liner is gone from the next open list, rather than kept as open until the refresh", async () => {
  const { createApi } = await import("../src/api.ts");
  const { Runtime } = await import("../src/runtime.ts");
  // A gh on PATH that is signed in, lists #131 as open until it is asked to merge it, then lists none.
  const bin = mkdtempSync(join(tmpdir(), "lc-wl-gh-"));
  const merged = join(bin, "merged");
  writeFileSync(join(bin, "open.json"), JSON.stringify([PR_ROW]));
  writeFileSync(join(bin, "gh"), `#!/bin/bash\ncase "$1 $2" in\n  "auth status") exit 0;;\n  "api user") echo harbour-dev;;\n  "pr list") if [ -f "${merged}" ]; then echo '[]'; else cat "${join(bin, "open.json")}"; fi;;\n  "pr merge") touch "${merged}";;\n  *) exit 1;;\nesac\n`, { mode: 0o755 });
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-wl-")));
  const work = mkdtempSync(join(tmpdir(), "lc-wl-work-"));
  store.putProject({ id: "p1", name: "foreshore", path: work, git: true, remote: "o/foreshore", createdAt: 1 });
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: store.home };
  const api = createApi(store, new Runtime(store, env), env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const call = <T>(m: string, p: unknown) => api.call(m, p) as Promise<T>;
  const before = await call<{ items: { number: number }[] }>("worklists.prs", { state: "open" });
  assert.deepEqual(before.items.map((x) => x.number), [131]);
  await call("pr.merge", { projectId: "p1", number: 131 });
  assert.ok(existsSync(merged), "gh was asked to merge it");
  const after = await call<{ items: { number: number }[] }>("worklists.prs", { state: "open" });
  assert.deepEqual(after.items.map((x) => x.number), [], "the kept list still showed it open, with Merge it there to press again");
});
