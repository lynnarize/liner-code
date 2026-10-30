/*
  One turn at a time in a session: what you send while work is in flight waits in the queue and
  goes when it ends; Stop keeps the queue for you; a request the tool can no longer act on doesn't
  hold the session in Needs you; a routine's own step runs unattended, and nothing it does leaves
  this Mac. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { OpenOptions, Provider, TurnSink } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const ready = [info("claude", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"])];
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

/** Claude Code, faked: each turn runs `work` and counts how many turns run at once. */
function fake(work: (text: string, sink: TurnSink, signal: AbortSignal) => Promise<void>) {
  const seen = { texts: [] as string[], now: 0, most: 0 };
  const make: Provider = {
    id: "claude",
    detect: async () => info("claude", []),
    open: (_o: OpenOptions) => ({
      turn: async (text, sink, signal) => {
        seen.texts.push(text);
        seen.most = Math.max(seen.most, ++seen.now);
        try {
          await work(text, sink, signal);
        } finally {
          seen.now--;
        }
      },
      close() {},
    }),
  };
  const saved = providers.claude;
  providers.claude = make;
  return { seen, restore: () => (providers.claude = saved) };
}

function session(extra: Partial<Thread> = {}) {
  const home = mkdtempSync(join(tmpdir(), "lc-turns-"));
  const dir = mkdtempSync(join(tmpdir(), "lc-turns-dir-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "New session", agent: "forge", status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = ready;
  return { store, runtime };
}

/** Waits until `ok` holds, or fails after about two seconds. */
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 200 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}

test("one at a time: a message sent while a turn works waits, then goes when it ends", async () => {
  const { seen, restore } = fake(async (_text, sink, signal) => {
    sink.text("working");
    for (let i = 0; i < 10 && !signal.aborted; i++) await tick();
  });
  try {
    const { store, runtime } = session();
    const first = runtime.send("t", "first");
    await until(() => seen.texts.length === 1, "the first turn starts");
    await runtime.send("t", "second");
    await runtime.send("t", "third");
    assert.equal(store.thread("t").queue?.length, 2, "both wait in the queue");
    await first;
    await until(() => seen.texts.length === 2 && !runtime.isRunning("t"), "the queue goes as one message when the turn ends");
    assert.equal(seen.most, 1, "never two turns at once");
    assert.match(seen.texts[1], /second\n\nthird/);
    assert.equal(store.thread("t").queue?.length ?? 0, 0);
  } finally {
    restore();
  }
});

test("one at a time: Stop keeps what you queued for you", async () => {
  const { seen, restore } = fake(async (_text, _sink, signal) => {
    while (!signal.aborted) await tick();
  });
  try {
    const { store, runtime } = session();
    const first = runtime.send("t", "first");
    await until(() => seen.texts.length === 1, "the turn starts");
    await runtime.send("t", "later");
    runtime.stop("t");
    await first;
    await tick(50);
    assert.equal(seen.texts.length, 1, "nothing more starts after Stop");
    assert.equal(store.thread("t").queue?.length, 1, "the queued message is still yours");
  } finally {
    restore();
  }
});

test("a request the tool can't act on any more expires with its turn, and the session isn't left waiting", async () => {
  const { restore } = fake(async (_text, sink, signal) => {
    // The tool asks, then its process ends before you answer.
    void sink.approve({ key: "c1", tool: "Bash", title: "Run make", risk: "low", fields: [{ label: "Command", value: "make" }] }, signal).catch(() => {});
    await tick(20);
  });
  try {
    const { store, runtime } = session({ access: "ask" });
    await runtime.send("t", "build it");
    const ask = store.timeline("t").find((x) => x.kind === "approval");
    assert.equal(ask?.kind === "approval" && ask.state, "expired");
    assert.notEqual(store.thread("t").status, "waiting");
  } finally {
    restore();
  }
});

test("routines: its own step runs unattended, never what leaves this Mac; afterwards the session asks again", async () => {
  const answers: Record<string, boolean> = {};
  const { restore } = fake(async (_text, sink, signal) => {
    for (const command of ["npm run build", "git push origin main", "curl -X POST https://example.com/hook"]) {
      const a = await sink.approve({ key: command, tool: "Bash", title: `Run ${command}`, risk: "medium", fields: [{ label: "Command", value: command }] }, signal).catch(() => ({ allow: false }));
      answers[command] = a.allow;
    }
  });
  try {
    const { store, runtime } = session({ access: "ask", routine: { id: "r", run: "run" } });
    await runtime.unattendedTurn("t", () => runtime.send("t", "do the routine's work"));
    assert.deepEqual(answers, { "npm run build": true, "git push origin main": false, "curl -X POST https://example.com/hook": false });
    // Your own message in that session later: the routine's trust is gone, so it asks.
    const yours = runtime.send("t", "now push it");
    await until(() => store.timeline("t").some((x) => x.kind === "approval" && x.state === "asking"), "it asks you");
    runtime.stop("t");
    await yours;
  } finally {
    restore();
  }
});
