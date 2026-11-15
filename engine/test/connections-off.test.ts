/*
  A connection switched off for one session: its tool isn't handed it, another session still is, and
  switching it back on brings it back. The change relinks that session alone (thread.update), as a
  change in Add-ons relinks them all. And a turn's closing mark carries what it cost, the same number
  its usage record has. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectionManifest, Item, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { Addons, type Connection } from "../src/addons.ts";
import type { TurnSink } from "../src/providers/types.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";
import { noLeaks } from "./leaks.ts";

noLeaks();

const manifest = (id: string): ConnectionManifest => ({ apiVersion: 1, id, kind: "connection", name: id, server: { http: { url: `https://${id}.example/mcp` } } });

function rig() {
  const home = mkdtempSync(join(tmpdir(), "lc-off-home-"));
  const store = new Store(home);
  // A project each, so the fake tool knows which session it opens by its folder.
  const dirs: Record<string, string> = {};
  for (const id of ["a", "b"]) {
    dirs[mkdtempSync(join(tmpdir(), `lc-off-${id}-`))] = id;
    store.putProject({ id: `p${id}`, name: id, path: Object.keys(dirs).at(-1)!, git: false, createdAt: 1 });
  }
  const thread = (id: string, extra: Partial<Thread> = {}) => store.putThread({ id, access: "ask", projectId: `p${id}`, title: id, agent: "@claude:claude-opus-5-5", status: "idle", turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1, ...extra });
  thread("a", { connectionsOff: ["linear"] });
  thread("b");
  const runtime = new Runtime(store, { PATH: "/usr/bin:/bin" });
  runtime.providerInfo = [{ id: "claude", label: "Fake tool", available: true, adapter: true, login: "", models: [{ id: "claude-opus-5-5", label: "Opus", description: "" }], supports: { approvals: true, resume: true, effort: false, plan: true } }];
  runtime.addons = new Addons(home);
  for (const id of ["linear", "ping"]) runtime.addons.install(manifest(id), { by: { agent: "You", at: 1 } });
  return { store, runtime, dirs };
}

/** A fake tool that says which connections each session opened with and was handed later, and runs `work` each turn. */
async function withTool(dirs: Record<string, string>, work: (sink: TurnSink) => void, run: (seen: { opened: Record<string, string[]>; connected: Record<string, string[][]> }) => Promise<void>) {
  const saved = providers.claude;
  const seen = { opened: {} as Record<string, string[]>, connected: {} as Record<string, string[][]> };
  const names = (cs: Connection[] | undefined) => (cs ?? []).map((c) => c.name).sort();
  providers.claude = {
    id: "claude",
    detect: async () => ({}) as never,
    open: (o) => {
      const who = dirs[o.cwd] ?? "?";
      seen.opened[who] = names(o.connections);
      return {
        close() {},
        connect: async (cs: Connection[]) => ((seen.connected[who] ??= []).push(names(cs)), true),
        turn: async (_t, sink) => work(sink),
      };
    },
  };
  try {
    await run(seen);
  } finally {
    providers.claude = saved;
  }
}

test("connections off: a session isn't handed a connection switched off for it, another still is, and clearing it brings it back to that session alone", async () => {
  const { store, runtime, dirs } = rig();
  await withTool(
    dirs,
    () => {},
    async (seen) => {
      await runtime.send("a", "go");
      await runtime.send("b", "go");
      assert.deepEqual(seen.opened.a, ["ping"], "linear is off for a");
      assert.deepEqual(seen.opened.b, ["linear", "ping"], "and still on for b");
      store.patchThread("a", { connectionsOff: undefined });
      const now = await runtime.relink("a");
      assert.deepEqual([...now.keys()], ["a"], "only a relinks");
      assert.deepEqual(seen.connected.a, [["linear", "ping"]], "a takes linear back in place");
      assert.equal(seen.connected.b, undefined, "b isn't touched");
      store.patchThread("b", { connectionsOff: ["ping"] });
      await runtime.relink("b");
      assert.deepEqual(seen.connected.b, [["linear"]]);
      runtime.shutdown();
    },
  );
});

test("turn cost: the closing mark carries the turn's cost from the same numbers as its usage record, and none when the tool reports none", async () => {
  const { store, runtime, dirs } = rig();
  let cost = 0.28;
  await withTool(
    dirs,
    (sink) => sink.usage({ inputTokens: 10, outputTokens: 5, costUsd: cost }),
    async () => {
      await runtime.send("a", "go");
      cost = 0;
      await runtime.send("b", "go");
      const mark = (id: string) => store.timeline(id).find((x): x is Extract<Item, { kind: "turn" }> => x.kind === "turn")!;
      assert.equal(mark("a").costUsd, 0.28);
      assert.equal(typeof mark("a").seconds, "number");
      assert.equal(mark("b").costUsd, undefined, "no cost reported, none on the mark");
      assert.equal(store.usage(0).find((r) => r.threadId === "a")?.costUsd, 0.28, "its usage record says the same");
      runtime.shutdown();
    },
  );
});

test("connections off: thread.update keeps the list, relinks that session, clears it with null, and takes only add-on ids", async () => {
  const { store, runtime, dirs } = rig();
  const { createApi } = await import("../src/api.ts");
  const api = createApi(store, runtime, { PATH: "/usr/bin:/bin" }, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const call = <T>(m: string, p: unknown) => api.call(m, p) as Promise<T>;
  await withTool(
    dirs,
    () => {},
    async (seen) => {
      await runtime.send("b", "go");
      assert.deepEqual((await call<Thread>("thread.update", { id: "b", connectionsOff: ["ping"] })).connectionsOff, ["ping"]);
      await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(seen.connected.b, [["linear"]], "b relinked without ping");
      assert.equal((await call<Thread>("thread.update", { id: "b", connectionsOff: null })).connectionsOff, undefined);
      await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(seen.connected.b, [["linear"], ["linear", "ping"]], "and with it again");
      await assert.rejects(call("thread.update", { id: "b", connectionsOff: "ping" }), /a list of add-on ids/);
      runtime.shutdown();
    },
  );
});

test("connections off: a side chat follows its session's switches, as they are and as they change; a fork starts with them and keeps its own", async () => {
  const { store, runtime, dirs } = rig();
  const { createApi } = await import("../src/api.ts");
  const api = createApi(store, runtime, { PATH: "/usr/bin:/bin" }, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const call = <T>(m: string, p: unknown) => api.call(m, p) as Promise<T>;
  await withTool(
    dirs,
    () => {},
    async (seen) => {
      // Only the side chat opens in a's folder here, so what the fake saw there is the side chat's.
      const side = await call<Thread>("thread.side", { id: "a" });
      assert.equal(side.sideOf, "a");
      await runtime.send(side.id, "what's here?");
      assert.deepEqual(seen.opened.a, ["ping"], "linear, off in the session, never reaches its side chat");
      // Switched back on in the session: the side chat open beside it gets it in place, and off again takes it away.
      await call("thread.update", { id: "a", connectionsOff: null });
      await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(seen.connected.a, [["linear", "ping"]], "the side chat relinked with the session");
      await call("thread.update", { id: "a", connectionsOff: ["linear", "ping"] });
      await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(seen.connected.a, [["linear", "ping"], []], "and lost both with it");
      // A side chat made after the change follows it too.
      const again = await call<Thread>("thread.side", { id: "a", fresh: true });
      await runtime.send(again.id, "and now?");
      assert.deepEqual(seen.opened.a, [], "a new side chat opens with none");

      // A fork: what's off in the parent is off as it starts; from then on its switches are its own.
      const fork = await call<Thread>("thread.create", { projectId: "pa", forkOf: "a" });
      assert.deepEqual(fork.connectionsOff, ["linear", "ping"], "the fork starts with its parent's switches");
      await call("thread.update", { id: "a", connectionsOff: null });
      assert.deepEqual(store.thread(fork.id).connectionsOff, ["linear", "ping"], "and keeps them when the parent's change");
      const plain = await call<Thread>("thread.create", { projectId: "pb", forkOf: "b" });
      assert.equal(plain.connectionsOff, undefined, "a fork of a session with none off has none off");
      runtime.shutdown();
    },
  );
});
