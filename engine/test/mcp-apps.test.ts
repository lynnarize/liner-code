/*
  Liner MCP's apps and gate: keys kept only as hashes in a file only you can read, revoked and run-out keys refused, and
  every call held to its app's level (read only, asks first with your Allow, trusted but never Full access), logged without
  its words, and limited to 60 a minute. Run with `node --test engine/test/mcp-apps.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { ASK_WAIT, McpApps, McpGate, sha256, trustedAccess } from "../src/mcp-apps.ts";
import { mcpTrustWords } from "../../contracts/src/mcp.ts";
import { Outside } from "../src/outside-tools.ts";
import { Store } from "../src/store.ts";

const words = (r: { content: { type: string; text?: string }[] }) => (r.content[0] as { text: string }).text;

function rig(o: { defaultAccess?: Thread["access"]; now?: () => number } = {}) {
  const home = mkdtempSync(join(tmpdir(), "lc-mcp-apps-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "Foreshore", path: "/work/foreshore", git: true, createdAt: 1 });
  store.putThread({ id: "th_1", projectId: "p", title: "Tide chart", agent: "forge", status: "done", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 2 } as Thread);
  store.putThread({ id: "th_full", projectId: "p", title: "Everything", agent: "forge", status: "done", access: "full", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 2 } as Thread);
  const calls: [string, Record<string, unknown>][] = [];
  let made = 0;
  const api = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params as Record<string, unknown>]);
      if (method === "thread.create") {
        const p = params as { projectId: string; access?: Thread["access"] };
        const t = { id: `th_new${++made}`, projectId: p.projectId, title: "", agent: "forge", status: "idle", access: p.access ?? "full", turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1 } as Thread;
        store.putThread(t);
        return t;
      }
      if (method === "thread.remove") store.removeThread((params as { id: string }).id);
      return null;
    },
  };
  const outside = new Outside(store, api);
  const apps = new McpApps(home, o.now);
  const logs: string[] = [];
  let asked = 0;
  const gate = new McpGate({ apps, runner: outside, defaultAccess: () => o.defaultAccess ?? "full", stdioLevel: () => outside.stdioLevel, onAsks: () => void asked++, log: (l) => logs.push(l), now: o.now });
  return { home, store, apps, gate, calls, logs, outside, asks: () => asked };
}

test("A key is shown once, kept only as its SHA-256 in a file only you can read, and lets in its app alone", () => {
  const { apps } = rig();
  const { app, key } = apps.create({ name: "Grok Bot", kind: "grokbot", level: "ask" });
  assert.match(key, /^lc_[A-Za-z0-9_-]{43}$/);
  assert.equal(app.keyEnd, key.slice(-4));
  const disk = readFileSync(apps.file, "utf8");
  assert.equal(disk.includes(key), false, "the key itself is never written");
  assert.equal(disk.includes(sha256(key)), true);
  assert.equal(statSync(apps.file).mode & 0o777, 0o600);
  assert.equal(apps.verify(key)?.id, app.id);
  assert.equal(apps.verify(`${key.slice(0, -1)}${key.endsWith("A") ? "B" : "A"}`), undefined);
  assert.equal(apps.verify(""), undefined);
  assert.equal(apps.verify(sha256(key)), undefined, "its hash is no key");
  assert.equal("keyHash" in apps.list()[0], false, "Settings never sees a hash");
});

test("A revoked key and one past its 30 days are refused", () => {
  let now = 1_000_000;
  const { apps } = rig({ now: () => now });
  const a = apps.create({ name: "Muse", kind: "muse", level: "read" });
  const b = apps.create({ name: "Grok Bot", kind: "grokbot", level: "read" });
  let gone = "";
  apps.onGone = (id) => void (gone = id);
  assert.equal(apps.revoke(a.app.id), true);
  assert.equal(gone, a.app.id, "its open calls are told to end");
  assert.equal(apps.verify(a.key), undefined);
  now += 30 * 86_400_000 + 1;
  assert.equal(apps.verify(b.key), undefined);
});

test("A read only app may read but not start, send, scan or stop, and isn't shown those tools as allowed", async () => {
  const { apps, gate, calls, logs } = rig();
  const app = apps.get(apps.create({ name: "Muse", kind: "muse", level: "read" }).app.id)!;
  assert.match(words(await gate.call(app, "liner_projects", {}, { waitMax: 55 })), /Foreshore/);
  for (const tool of ["liner_start", "liner_send", "liner_scan", "liner_stop", "liner_answer", "liner_wait"]) {
    const r = await gate.call(app, tool, { project: "p", session: "th_1", message: "go", answer: "yes", pr: 1 }, { waitMax: 55 });
    assert.equal(r.isError, true, tool);
    assert.match(words(r), /may only read/);
  }
  assert.deepEqual(calls, [], "nothing reached the engine");
  assert.ok(logs.some((l) => l === "[mcp] Muse liner_start refused: level"));
});

test("At Asks first a send waits for your Allow, goes on Allow, and is refused on Deny", async () => {
  const { apps, gate, calls, logs } = rig();
  const app = apps.get(apps.create({ name: "Grok Bot", kind: "grokbot", level: "ask" }).app.id)!;
  const going = gate.call(app, "liner_send", { session: "th_1", message: "the secret plan" }, { waitMax: 55 });
  await new Promise((r) => setImmediate(r));
  const [ask] = gate.list();
  assert.equal(ask.appName, "Grok Bot");
  assert.equal(ask.message, "the secret plan", "the card quotes it");
  assert.deepEqual(calls, [], "nothing goes before the Allow");
  gate.decide(ask.id, true);
  assert.match(words(await going), /Sent/);
  assert.deepEqual(calls.map((c) => c[0]), ["thread.send"]);
  const denied = gate.call(app, "liner_stop", { session: "th_1" }, { waitMax: 55 });
  await new Promise((r) => setImmediate(r));
  gate.decide(gate.list()[0].id, false);
  assert.match(words(await denied), /didn't allow/);
  assert.equal(calls.length, 1);
  assert.equal(logs.some((l) => l.includes("secret plan")), false, "what it said is never logged");
});

test("An ask nobody answers is refused after ten minutes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { apps, gate, calls } = rig();
  const app = apps.get(apps.create({ name: "Grok Bot", kind: "grokbot", level: "ask" }).app.id)!;
  const going = gate.call(app, "liner_send", { session: "th_1", message: "hi" }, { waitMax: 55 });
  await new Promise((r) => setImmediate(r));
  assert.equal(gate.list().length, 1);
  t.mock.timers.tick(ASK_WAIT);
  assert.match(words(await going), /didn't allow/);
  assert.equal(gate.list().length, 0);
  assert.deepEqual(calls, []);
});

test("At Asks first a start makes the session at Manual, marked as the app's, and sends only after the Allow", async () => {
  const { apps, gate, calls, store } = rig();
  const app = apps.get(apps.create({ name: "Grok Bot", kind: "grokbot", level: "ask" }).app.id)!;
  const going = gate.call(app, "liner_start", { project: "Foreshore", message: "Fix the blank chart" }, { waitMax: 55 });
  for (let i = 0; i < 20 && !gate.list().length; i++) await new Promise((r) => setImmediate(r));
  const [ask] = gate.list();
  assert.equal(ask.threadId, "th_new1", "Open it first has a session to show");
  assert.equal(ask.project, "Foreshore");
  assert.match(ask.access ?? "", /^Manual/);
  assert.deepEqual(calls.map((c) => c[0]), ["thread.create"]);
  assert.equal(calls[0][1].access, "ask");
  assert.deepEqual(store.thread("th_new1").startedBy, { appId: app.id, name: "Grok Bot", kind: "grokbot", asks: true });
  gate.decide(ask.id, true);
  assert.match(words(await going), /^Started th_new1/);
  assert.deepEqual(calls.map((c) => c[0]), ["thread.create", "thread.send"]);
  assert.deepEqual(store.thread("th_new1").startedBy, { appId: app.id, name: "Grok Bot", kind: "grokbot" });
});

test("A trusted app's sessions run at your default access, but never at Full access", async () => {
  assert.equal(trustedAccess("full"), "edits");
  assert.equal(trustedAccess("auto"), "auto");
  const { apps, gate, calls } = rig({ defaultAccess: "full" });
  const app = apps.get(apps.create({ name: "Claude", kind: "claude", level: "trusted" }).app.id)!;
  assert.match(words(await gate.call(app, "liner_start", { project: "p", message: "go" }, { waitMax: 55 })), /^Started/);
  assert.equal(calls[0][1].access, "edits");
  assert.equal(gate.list().length, 0, "it didn't ask");
});

test("A trusted app's message to a session at Full access asks first", async () => {
  const { apps, gate, calls } = rig();
  const app = apps.get(apps.create({ name: "Claude", kind: "claude", level: "trusted" }).app.id)!;
  const going = gate.call(app, "liner_send", { session: "th_full", message: "rm it all" }, { waitMax: 55 });
  await new Promise((r) => setImmediate(r));
  assert.equal(gate.list().length, 1);
  assert.match(gate.list()[0].summary, /Full access/);
  gate.decide(gate.list()[0].id, false);
  assert.equal((await going).isError, true);
  assert.deepEqual(calls, []);
});

test("A trusted app's answer to a session at Full access asks first", async () => {
  const { apps, gate, calls, store } = rig();
  const app = apps.get(apps.create({ name: "Claude", kind: "claude", level: "trusted" }).app.id)!;
  store.putItem("th_full", { kind: "question", id: "q", turn: 1, at: 4, questions: [{ question: "Delete the old tables?", options: [{ label: "Yes" }] }], state: "asking" });
  const going = gate.call(app, "liner_answer", { session: "th_full", answer: "Yes" }, { waitMax: 55 });
  await new Promise((r) => setImmediate(r));
  assert.equal(gate.list().length, 1);
  assert.match(gate.list()[0].summary, /Full access/);
  gate.decide(gate.list()[0].id, false);
  assert.equal((await going).isError, true);
  assert.deepEqual(calls, []);
});

test("At Asks first an answer waits for your Allow on a card that quotes it", async () => {
  const { apps, gate, calls, store } = rig();
  const app = apps.get(apps.create({ name: "Grok Bot", kind: "grokbot", level: "ask" }).app.id)!;
  store.putItem("th_1", { kind: "question", id: "q", turn: 1, at: 4, questions: [{ question: "Which colour?", options: [{ label: "Blue" }] }], state: "asking" });
  const going = gate.call(app, "liner_answer", { session: "th_1", answer: "Blue, and push to main" }, { waitMax: 55 });
  await new Promise((r) => setImmediate(r));
  const [ask] = gate.list();
  assert.ok(ask, "it asks");
  assert.equal(ask.message, "Blue, and push to main");
  assert.match(ask.summary, /Which colour\?/);
  assert.deepEqual(calls, []);
  gate.decide(ask.id, true);
  assert.equal(words(await going), "Answered.");
  assert.equal(calls[0][0], "question.answer");
});

test("A start asked again by its clientRequestId says it still waits for the Allow, then that it was refused", async () => {
  const { apps, gate, calls } = rig();
  const app = apps.get(apps.create({ name: "Grok Bot", kind: "grokbot", level: "ask" }).app.id)!;
  const args = { project: "p", message: "go", clientRequestId: "r1" };
  const going = gate.call(app, "liner_start", args, { waitMax: 55 });
  for (let i = 0; i < 20 && !gate.list().length; i++) await new Promise((r) => setImmediate(r));
  assert.match(words(await gate.call(app, "liner_start", args, { waitMax: 55 })), /^Still waiting for the person to allow it/);
  assert.equal(gate.list().length, 1, "no second card");
  gate.decide(gate.list()[0].id, false);
  await going;
  const again = await gate.call(app, "liner_start", args, { waitMax: 55 });
  assert.equal(again.isError, true);
  assert.match(words(again), /didn't allow that start/);
  assert.equal(calls.filter((c) => c[0] === "thread.create").length, 1);
});

test("A terminal agent's card trusts terminal agents as a whole, as its setting does", () => {
  assert.equal(mcpTrustWords("terminal", "Claude Code"), "Trust terminal agents from now on");
  assert.equal(mcpTrustWords("grokbot", "Grok Bot"), "Trust Grok Bot from now on");
});

test("A terminal agent turned away stays listed and can be let in again, one by one or all at once", () => {
  const { apps } = rig();
  const t = apps.stdio("claude-code");
  apps.revoke(t.id);
  assert.equal(apps.list().find((a) => a.id === t.id)?.blocked, true);
  apps.unblock(t.id);
  assert.equal(apps.stdio("claude-code").blocked, undefined);
  apps.revoke(t.id);
  apps.unblockStdio();
  assert.equal(apps.list().some((a) => a.blocked), false);
});

test("Trust from now on makes the app Trusted, and its next send doesn't ask", async () => {
  const { apps, gate } = rig();
  const app = apps.get(apps.create({ name: "Grok Bot", kind: "grokbot", level: "ask" }).app.id)!;
  const going = gate.call(app, "liner_send", { session: "th_1", message: "hi" }, { waitMax: 55 });
  await new Promise((r) => setImmediate(r));
  gate.decide(gate.list()[0].id, true, true);
  await going;
  assert.equal(apps.get(app.id)?.level, "trusted");
  await gate.call(app, "liner_send", { session: "th_1", message: "again" }, { waitMax: 55 });
  assert.equal(gate.list().length, 0);
});

test("liner_answer answers a question but never an approval", async () => {
  const { apps, gate, calls, store } = rig();
  const app = apps.get(apps.create({ name: "Claude", kind: "claude", level: "trusted" }).app.id)!;
  store.putItem("th_1", { kind: "approval", id: "a", turn: 1, at: 3, tool: "Bash", title: "Run npm test", risk: "low", fields: [], state: "asking" });
  const none = await gate.call(app, "liner_answer", { session: "th_1", answer: "yes" }, { waitMax: 55 });
  assert.equal(none.isError, true);
  assert.match(words(none), /permission stays the person's/);
  assert.deepEqual(calls, []);
  store.putItem("th_1", { kind: "question", id: "q", turn: 1, at: 4, questions: [{ question: "Which colour?", options: [{ label: "Blue" }] }], state: "asking" });
  assert.equal(words(await gate.call(app, "liner_answer", { session: "th_1", answer: "Blue" }, { waitMax: 55 })), "Answered.");
  assert.deepEqual(calls, [["question.answer", { threadId: "th_1", itemId: "q", answers: { "Which colour?": "Blue" } }]]);
});

test("An app gets 60 calls a minute, then is told to wait", async () => {
  const { apps, gate } = rig();
  const app = apps.get(apps.create({ name: "Muse", kind: "muse", level: "read" }).app.id)!;
  for (let i = 0; i < 60; i++) assert.equal((await gate.call(app, "liner_projects", {}, { waitMax: 55 })).isError, undefined);
  const r = await gate.call(app, "liner_projects", {}, { waitMax: 55 });
  assert.equal(r.isError, true);
  assert.match(words(r), /60 calls in a minute/);
});

test("A revoked app's call that was let in is refused, and what it was asking goes", async () => {
  const { apps, gate } = rig();
  const app = apps.get(apps.create({ name: "Grok Bot", kind: "grokbot", level: "ask" }).app.id)!;
  apps.onGone = (id) => gate.dropApp(id);
  const going = gate.call(app, "liner_send", { session: "th_1", message: "hi" }, { waitMax: 55 });
  await new Promise((r) => setImmediate(r));
  apps.revoke(app.id);
  assert.equal((await going).isError, true);
  assert.equal(gate.list().length, 0);
  assert.match(words(await gate.call(app, "liner_projects", {}, { waitMax: 55 })), /doesn't let this app in/);
});

test("A terminal agent on stdio is listed by its name, held to the stdio level, and refused once revoked", async () => {
  const { apps, gate, store } = rig();
  const t = apps.stdio("claude-code");
  assert.equal(t.name, "Claude Code");
  assert.equal(apps.stdio("claude-code").id, t.id, "one entry per agent");
  store.setSettings({ mcpStdioLevel: "read" });
  assert.match(words(await gate.call(t, "liner_start", { project: "p", message: "go" }, { waitMax: 240 })), /may only read/);
  apps.revoke(t.id);
  assert.equal(apps.stdio("claude-code").blocked, true);
});

test("liner_wait over the internet comes back within its limit saying it's still working", async () => {
  const { apps, gate, store } = rig();
  store.patchThread("th_1", { status: "running" });
  const app = apps.get(apps.create({ name: "Claude", kind: "claude", level: "ask" }).app.id)!;
  const r = await gate.call(app, "liner_wait", { session: "th_1", seconds: 1 }, { waitMax: 1 });
  assert.match(words(r), /still working.*Call liner_wait again/);
});

test("A start whose app hung up while it waited asks again when retried, rather than saying the person refused", async () => {
  const { apps, gate } = rig();
  const app = apps.get(apps.create({ name: "Grok Bot", kind: "grokbot", level: "ask" }).app.id)!;
  const args = { project: "p", message: "go", clientRequestId: "r2" };
  const hangUp = new AbortController();
  const going = gate.call(app, "liner_start", args, { waitMax: 55, gone: hangUp.signal });
  for (let i = 0; i < 20 && !gate.list().length; i++) await new Promise((r) => setImmediate(r));
  hangUp.abort();
  await going;
  assert.equal(gate.list().length, 0);
  const again = gate.call(app, "liner_start", args, { waitMax: 55 });
  for (let i = 0; i < 20 && !gate.list().length; i++) await new Promise((r) => setImmediate(r));
  assert.equal(gate.list().length, 1, "it asks again");
  gate.decide(gate.list()[0].id, true);
  assert.match(words(await again), /^Started/);
});

test("A session an app starts is titled from its message at once and runs at its tool's usual effort, never a forced Low", async () => {
  const { apps, gate, calls, store, outside } = rig();
  outside.usualEffort = () => "medium";
  const app = apps.get(apps.create({ name: "Grok Bot", kind: "grokbot", level: "ask" }).app.id)!;
  const going = gate.call(app, "liner_start", { project: "p", message: "Fix the blank tide chart" }, { waitMax: 55 });
  for (let i = 0; i < 20 && !gate.list().length; i++) await new Promise((r) => setImmediate(r));
  assert.equal(calls[0][1].title, "Fix the blank tide chart", "titled while it waits for the Allow");
  assert.equal(calls[0][1].effort, undefined, "no effort is forced on the create");
  assert.equal(store.thread("th_new1").effort, "medium");
  gate.decide(gate.list()[0].id, false);
  await going;
});

test("Two apps of one kind get told apart, and an app can be renamed", () => {
  const { apps } = rig();
  assert.equal(apps.freeName("Another app"), "Another app");
  apps.create({ name: apps.freeName("Another app"), kind: "other", level: "read" });
  assert.equal(apps.freeName("Another app"), "Another app 2");
  const b = apps.create({ name: apps.freeName("Another app"), kind: "other", level: "read" });
  assert.equal(b.app.name, "Another app 2");
  assert.equal(apps.rename(b.app.id, "  Home\u0007 Assistant ").name, "Home Assistant");
  assert.throws(() => apps.rename(b.app.id, "   "), /Give it a name/);
});

test("An ask card names the session's model, for the tool's mark beside Runs on", async () => {
  const home = rig();
  const gate = new McpGate({ apps: home.apps, runner: home.outside, defaultAccess: () => "edits", stdioLevel: () => "trusted", runsOn: () => "Sonnet 5.5", runsOnRef: () => "claude:claude-sonnet-5-5", log: () => {} });
  const app = home.apps.get(home.apps.create({ name: "Grok Bot", kind: "grokbot", level: "ask" }).app.id)!;
  const going = gate.call(app, "liner_send", { session: "th_1", message: "hi" }, { waitMax: 55 });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([gate.list()[0].runsOn, gate.list()[0].runsOnRef], ["Sonnet 5.5", "claude:claude-sonnet-5-5"]);
  gate.decide(gate.list()[0].id, false);
  await going;
});
