/*
  Liner Security's sessions through the engine's own API (nothing runs; no tool or account is touched): a Specialist scan
  stays sealed in its side chat and its forks and can't be moved to a tool that can't seal it; a question about a finding
  is held at Read only by the same guards as a scan; a question card keeps the answers given so far, so they survive a
  reload. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item, Thread } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

const temp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), `lc-secs-${name}-`)));

function engine() {
  const store = new Store(temp("home"));
  store.putProject({ id: "p", name: "p", path: temp("p"), git: false, createdAt: 1 });
  const env = { PATH: "/usr/bin:/bin", HOME: store.home };
  const runtime = new Runtime(store, env);
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const call = <T>(m: string, p: unknown) => api.call(m, p) as Promise<T>;
  return { store, runtime, call };
}

test("security sessions: a sealed scan stays sealed and Read only in its side chat and its forks, and only on a tool that can seal it", async () => {
  const { call, store, runtime } = engine();
  try {
    const scan = await call<Thread>("thread.create", { projectId: "p", agent: "@claude:claude-mythos-1", access: "full", title: "scan", security: { kind: "scan", scan: "sc_1", sealed: true } });
    assert.equal(scan.access, "read");
    const side = await call<Thread>("thread.side", { id: scan.id });
    assert.deepEqual(side.security, { kind: "scan", sealed: true }, "sealed, but not the parent's scan");
    assert.equal(side.access, "read");
    const fork = await call<Thread>("thread.create", { projectId: "p", forkOf: scan.id, access: "full" });
    assert.deepEqual(fork.security, { kind: "scan", sealed: true });
    assert.equal(fork.access, "read");
    await assert.rejects(call("thread.create", { projectId: "p", forkOf: scan.id, agent: "@codex:gpt-5.5" }), /only Claude Code can run a sealed session/);
    // A model change or a sidekick that can't seal: refused, in words the app can show.
    await assert.rejects(call("thread.update", { id: scan.id, agent: "@codex:gpt-5.5" }), /^Error: A Specialist scan is sealed, and only Claude Code can run a sealed session: pick a Claude Code model\.$/);
    await assert.rejects(call("thread.update", { id: scan.id, sidekick: "codex:gpt-5.5" }), /its sidekick has to be a Claude Code model, or none/);
    assert.equal((await call<Thread>("thread.update", { id: scan.id, sidekick: "claude:claude-opus-5-5" })).sidekick, "claude:claude-opus-5-5");
    assert.equal(store.thread(scan.id).agent, "@claude:claude-mythos-1");
    // An unsealed scan may move: it was never sealed.
    const plain = await call<Thread>("thread.create", { projectId: "p", agent: "@claude:claude-opus-5-5", title: "scan", security: { kind: "scan", scan: "sc_2" } });
    assert.equal((await call<Thread>("thread.update", { id: plain.id, agent: "@codex:gpt-5.5" })).agent, "@codex:gpt-5.5");
  } finally {
    await runtime.shutdown();
  }
});

test("security sessions: a question about a finding is held at Read only, as a scan is", async () => {
  const { call, store, runtime } = engine();
  try {
    const ask = await call<Thread>("thread.create", { projectId: "p", agent: "@claude:claude-opus-5-5", access: "full", title: "About", security: { kind: "ask", finding: "sf_1" } });
    assert.equal(ask.access, "read", "made at Read only whatever was asked");
    await assert.rejects(call("thread.update", { id: ask.id, access: "auto" }), /A question about a finding stays at Read only\./);
    assert.equal(store.putThread({ ...store.thread(ask.id), access: "full" }).access, "read", "and held there however it's written");
    const fork = await call<Thread>("thread.create", { projectId: "p", forkOf: ask.id, access: "full" });
    assert.deepEqual([fork.security, fork.access], [{ kind: "ask", finding: "sf_1" }, "read"]);
    // A fix isn't held: it works in its worktree at your level.
    const fix = await call<Thread>("thread.create", { projectId: "p", agent: "@claude:claude-opus-5-5", access: "auto", title: "Fix", security: { kind: "fix", finding: "sf_1" } });
    assert.equal(fix.access, "auto");
  } finally {
    await runtime.shutdown();
  }
});

test("security sessions: a question card keeps the answers given so far (question.partial), so they survive a reload", async () => {
  const { call, store, runtime } = engine();
  try {
    const t = await call<Thread>("thread.create", { projectId: "p", agent: "@claude:claude-opus-5-5", title: "scan", security: { kind: "scan", scan: "sc_1" } });
    const q = runtime.askQuestions(t.id, [1, 2, 3].map((n) => ({ question: `Q${n}?`, options: [{ label: "a" }, { label: "b" }] })));
    await call("question.partial", { threadId: t.id, itemId: q.id, answers: { "Q1?": "b", "Not asked?": "x", "Q2?": " " } });
    const item = () => store.item(t.id, q.id) as Extract<Item, { kind: "question" }>;
    assert.deepEqual(item().partial, { "Q1?": "b" });
    assert.equal(item().state, "asking", "nothing goes to the agent until it's answered");
    await call("question.answer", { threadId: t.id, itemId: q.id, answers: { "Q1?": "b", "Q2?": "a" } });
    assert.deepEqual(await q.answer, { "Q1?": "b", "Q2?": "a" });
    await call("question.partial", { threadId: t.id, itemId: q.id, answers: { "Q3?": "a" } });
    assert.deepEqual(item().partial, { "Q1?": "b" }, "an answered card takes no more");
    // Let go of: it ends as expired, never answered.
    const r = runtime.askQuestions(t.id, [{ question: "Q?", options: [{ label: "a" }, { label: "b" }] }]);
    r.end("expired");
    assert.equal(await r.answer, null);
    assert.equal((store.item(t.id, r.id) as Extract<Item, { kind: "question" }>).state, "expired");
    // An expired card takes no answer afterwards, and nothing goes into the session as a message.
    await call("question.answer", { threadId: t.id, itemId: r.id, answers: { "Q?": "a" } });
    assert.equal((store.item(t.id, r.id) as Extract<Item, { kind: "question" }>).state, "expired");
    await new Promise((x) => setTimeout(x, 100));
    assert.ok(!store.timeline(t.id).some((x) => x.kind === "user"), "no message sent for it");
  } finally {
    await runtime.shutdown();
  }
});

test("security sessions: a turn's changes leave out exactly what Liner wrote, and only while the file still holds it", () => {
  const { runtime } = engine();
  const cwd = temp("cwd");
  mkdirSync(join(cwd, "docs"));
  const text = "# S\n\n## The API\nChecks.\n";
  writeFileSync(join(cwd, "SECURITY.md"), text);
  writeFileSync(join(cwd, "docs", "SECURITY.md"), "# The agent's own\n");
  runtime.linerWrote("t1", "SECURITY.md", text);
  const files = [{ path: "SECURITY.md", status: "modified" }, { path: "docs/SECURITY.md", status: "added" }] as never[];
  const left = (runtime as unknown as { notLiners: (t: string, f: never[], c: string) => { path: string }[] }).notLiners;
  assert.deepEqual(left.call(runtime, "t1", files, cwd).map((f) => f.path), ["docs/SECURITY.md"], "the agent's docs/SECURITY.md is its own change");
  assert.deepEqual(left.call(runtime, "t1", files, cwd).map((f) => f.path), ["docs/SECURITY.md"], "kept for a checkpoint read again");
  assert.deepEqual(left.call(runtime, "t2", files, cwd).map((f) => f.path), ["SECURITY.md", "docs/SECURITY.md"], "another session's turn isn't touched");
  writeFileSync(join(cwd, "SECURITY.md"), `${text}\nAn edit after Liner's.\n`);
  assert.deepEqual(left.call(runtime, "t1", files, cwd).map((f) => f.path), ["SECURITY.md", "docs/SECURITY.md"], "changed since: it shows");
  void runtime.shutdown();
});
