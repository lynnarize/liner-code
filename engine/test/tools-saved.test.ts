/*
  The first snapshot and last launch's look at the tools (tools.json): with a saved list the app's
  state.get answers before this launch's look is done and carries what was saved, the look's answer
  follows as a providers event and is saved in its place; with no list, or one that doesn't read,
  state.get waits for the look as before; and Settings, not the file, say which of your own tools
  (endpoints, added agents) there are. Fake tools and throwaway folders only. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineEvent, ProviderId, ProviderInfo, Snapshot } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

const info = (id: ProviderId, label: string, version = "1.0.0"): ProviderInfo => ({ id, label, version, available: true, adapter: true, login: "", models: [{ id: "m", label: "M", description: "" }], supports: { approvals: true, resume: true, effort: true, plan: true } });
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
/** Whether `p` settles within `ms`. */
const settles = (p: Promise<unknown>, ms = 400) => Promise.race([p.then(() => true), tick(ms).then(() => false)]);

/** Claude Code, faked, whose look stays open until the test lets it answer. */
function held() {
  let release!: (i: ProviderInfo) => void;
  const look = new Promise<ProviderInfo>((r) => (release = r));
  const saved = providers.claude;
  providers.claude = { id: "claude", detect: () => look, open: () => assert.fail("no turn opens here") };
  return { release, restore: () => (providers.claude = saved) };
}

function setup(file?: string, settings?: Parameters<Store["setSettings"]>[0], more: Record<string, string> = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "lc-tools-home-")));
  if (file !== undefined) writeFileSync(join(home, "tools.json"), file);
  const store = new Store(home);
  if (settings) store.setSettings(settings);
  const env = { PATH: "/usr/bin:/bin", HOME: home, ...more };
  const runtime = new Runtime(store, env);
  const events: EngineEvent[] = [];
  store.on((e) => void events.push(e));
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const call = <T>(method: string, params: unknown) => api.call(method, params) as Promise<T>;
  return { home, store, runtime, api, call, events };
}

test("tools.json: with a saved list, state.get answers before the look and the look's answer follows and is saved", async () => {
  const h = held();
  try {
    const s = setup(JSON.stringify([info("claude", "Claude Code (saved)", "1.0.0")]));
    s.store.putProject({ id: "p", name: "p", path: s.home, git: false, createdAt: 1 });
    const snap = s.call<Snapshot>("state.get", {});
    assert.ok(await settles(snap), "state.get answers while the look is still open");
    const first = await snap;
    assert.equal(first.providers.find((p) => p.id === "claude")?.label, "Claude Code (saved)", "the snapshot carries the saved tool");
    assert.equal(s.runtime.providerInfo.find((p) => p.id === "claude")?.label, "Claude Code (saved)", "the runtime starts from the saved list too");
    // What opens a tool waits for this launch's own look.
    const made = s.call("thread.create", { projectId: "p", agent: "@claude:m", review: false, worktree: false });
    assert.equal(await settles(made, 200), false, "a session isn't made from the saved list alone");
    h.release(info("claude", "Claude Code (fresh)", "2.0.0"));
    await s.api.ready;
    await made;
    const sent = s.events.filter((e): e is Extract<EngineEvent, { type: "providers" }> => e.type === "providers").at(-1);
    assert.equal(sent?.providers.find((p) => p.id === "claude")?.label, "Claude Code (fresh)", "the providers event carries the look's answer");
    const kept = JSON.parse(readFileSync(join(s.home, "tools.json"), "utf8")) as ProviderInfo[];
    assert.deepEqual(kept.find((p) => p.id === "claude")?.version, "2.0.0", "the look's answer replaces the saved one on disk");
    assert.equal((await s.call<Snapshot>("state.get", {})).providers.find((p) => p.id === "claude")?.label, "Claude Code (fresh)");
  } finally {
    h.restore();
  }
});

test("tools.json: with no saved list state.get waits for the look, as before", async () => {
  const h = held();
  try {
    const s = setup();
    const snap = s.call<Snapshot>("state.get", {});
    assert.equal(await settles(snap), false, "no answer before the look");
    h.release(info("claude", "Claude Code"));
    assert.equal((await snap).providers.find((p) => p.id === "claude")?.label, "Claude Code");
  } finally {
    h.restore();
  }
});

test("tools.json: a garbled file or one of the wrong shape is ignored", async () => {
  for (const file of ["{not json", "[]", JSON.stringify({ claude: info("claude", "x") }), JSON.stringify([{ id: "claude", label: 3 }]), JSON.stringify([{ ...info("claude", "x"), models: [{ id: 1 }] }])]) {
    const h = held();
    try {
      const s = setup(file);
      const snap = s.call<Snapshot>("state.get", {});
      assert.equal(await settles(snap, 200), false, `waits for the look with ${file.slice(0, 40)}`);
      h.release(info("claude", "Claude Code"));
      await snap;
    } finally {
      h.restore();
    }
  }
});

test("tools.json: an endpoint removed since doesn't come back, and an agent added since isn't hidden", async () => {
  const agent = { id: "mine", label: "Mine", command: ["lc-no-such-agent"], from: "local" as const };
  // The endpoint is in the file but no longer in Settings: the saved list paints without it.
  {
    const h = held();
    try {
      const s = setup(JSON.stringify([info("claude", "Claude Code"), info("claude.gone", "Claude Code · Gone")]));
      const snap = s.call<Snapshot>("state.get", {});
      assert.ok(await settles(snap), "answers at once");
      assert.equal((await snap).providers.some((p) => p.id === "claude.gone"), false, "the removed endpoint stays gone");
      h.release(info("claude", "Claude Code"));
      await s.api.ready;
    } finally {
      h.restore();
    }
  }
  // The agent is in Settings but not in the file: the snapshot waits for the look rather than hide it.
  {
    const h = held();
    try {
      const s = setup(JSON.stringify([info("claude", "Claude Code")]), { addedAgents: [agent] });
      const snap = s.call<Snapshot>("state.get", {});
      assert.equal(await settles(snap, 200), false, "waits for the look");
      h.release(info("claude", "Claude Code"));
      assert.ok((await snap).providers.some((p) => p.id === "acp.mine"), "the added agent shows");
    } finally {
      h.restore();
    }
  }
  // In both: it paints from the file at once.
  {
    const h = held();
    try {
      const s = setup(JSON.stringify([info("claude", "Claude Code"), info("acp.mine", "Mine (saved)")]), { addedAgents: [agent] });
      const snap = s.call<Snapshot>("state.get", {});
      assert.ok(await settles(snap), "answers at once");
      assert.equal((await snap).providers.find((p) => p.id === "acp.mine")?.label, "Mine (saved)");
      h.release(info("claude", "Claude Code"));
      await s.api.ready;
    } finally {
      h.restore();
    }
  }
});

test("tools.json: a session brought in waits for the look too, though it's made through thread.create from inside", async () => {
  const h = held();
  try {
    const claudeHome = realpathSync(mkdtempSync(join(tmpdir(), "lc-tools-claude-")));
    const s = setup(JSON.stringify([info("claude", "Claude Code (saved)")]), undefined, { CLAUDE_CONFIG_DIR: claudeHome });
    s.store.putProject({ id: "p", name: "p", path: s.home, git: false, createdAt: 1 });
    const where = join(claudeHome, "projects", s.home.replace(/[^a-zA-Z0-9]/g, "-"));
    mkdirSync(where, { recursive: true });
    writeFileSync(join(where, "abc-123.jsonl"), "");
    assert.ok(await settles(s.call("state.get", {})), "the snapshot doesn't wait");
    const brought = s.call("sessions.import", { projectId: "p", tool: "claude", id: "abc-123" });
    assert.equal(await settles(brought, 200), false, "no session is made from the saved list alone");
    h.release(info("claude", "Claude Code"));
    await brought;
  } finally {
    h.restore();
  }
});

test("tools.json: an added agent's command line isn't kept in the file, and the file is yours alone to read", async () => {
  const agent = { id: "mine", label: "Mine", command: ["lc-no-such-agent", "--key", "sk-LC-SECRET-123"], from: "local" as const };
  const h = held();
  try {
    const s = setup(undefined, { addedAgents: [agent] });
    h.release(info("claude", "Claude Code"));
    const snap = await s.call<Snapshot>("state.get", {});
    assert.ok(snap.providers.find((p) => p.id === "acp.mine")?.login.includes("sk-LC-SECRET-123"), "the app is still told how it runs");
    const file = join(s.home, "tools.json");
    const text = readFileSync(file, "utf8");
    assert.ok(text.includes('"acp.mine"'), "the agent itself is kept");
    assert.ok(!text.includes("sk-LC-SECRET-123") && !text.includes("lc-no-such-agent"), "its command line isn't");
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    h.restore();
  }
});
