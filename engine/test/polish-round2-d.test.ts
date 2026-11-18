/*
  Round two of the polish build, the engine's leftovers: canvas watches let go when the last window's event stream closes, and a
  commit message, PR draft or Desk answer that can be stopped (writer.cancel) or taken over by a newer ask. Fake tools stand in
  for every model. Run with `node --test test/polish-round2-d.test.ts`.
*/
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInfo } from "../../contracts/src/index.ts";
import { emptyUsage, WRITER_CANCELLED } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import * as canvas from "../src/canvas.ts";
import { designCtx } from "../src/canvas.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { Provider, TurnSink } from "../src/providers/types.ts";
import { startServer } from "../src/server.ts";
import { Store } from "../src/store.ts";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string, ms = 3000) {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await tick();
  assert.ok(ok(), what);
}
const opened: { stop(): void | Promise<unknown> }[] = [];
after(async () => {
  for (const o of opened) await o.stop();
});

// Item 1 (engine-design-security #5): the watches a reloaded window never let go go when no window is connected.

async function watching() {
  const root = tmp("lc-r2d-root-");
  const store = new Store(tmp("lc-r2d-home-"));
  store.putProject({ id: "p", name: "p", path: root, git: false, createdAt: 1 });
  const ctx = designCtx(store, {});
  const rpc = canvas.rpc(() => ctx) as unknown as Record<string, (p: unknown) => unknown>;
  canvas.createFile(ctx, root, "W", undefined, "w");
  let alone = 0;
  const server = await startServer({ store, api: { call: async (m, p) => rpc[m](p), ready: Promise.resolve() }, snapshot: async () => ({ seq: store.seq }) as never, token: "t", port: 0, alone: () => (alone++, canvas.resetWatches(ctx)) });
  opened.push({ stop: () => server.close() });
  const url = `http://127.0.0.1:${server.port}`;
  const watchers = (ctx.keep("canvas", () => ({})) as { watchers: Map<string, unknown> }).watchers;
  /** A window: its event stream open, read up to the snapshot. */
  const window = async () => {
    const gone = new AbortController();
    const res = await fetch(`${url}/events`, { headers: { "x-liner-token": "t" }, signal: gone.signal });
    const reader = res.body!.getReader();
    await reader.read();
    return { close: () => gone.abort() };
  };
  const watch = (on: boolean) => fetch(`${url}/rpc`, { method: "POST", headers: { "x-liner-token": "t", "content-type": "application/json" }, body: JSON.stringify({ method: "canvas.watch", params: { cwd: root, file: "w", on } }) }).then((r) => r.json());
  return { watchers, window, watch, alone: () => alone };
}

test("item 1: a window that reloads without its off leaves no canvas watch once its event stream closes", async () => {
  const w = await watching();
  const one = await w.window();
  assert.deepEqual(await w.watch(true), { ok: true, result: null });
  assert.equal(w.watchers.size, 1, "the design is watched");
  // The reload: the stream drops, and no off is ever sent.
  one.close();
  await until(() => w.watchers.size === 0, "the watcher and its once-a-second look are gone with the last stream");
  assert.equal(w.alone(), 1, "told once");
  // The window that loads in its place watches again as it opens the design.
  const two = await w.window();
  await w.watch(true);
  assert.equal(w.watchers.size, 1);
  two.close();
  await until(() => w.alone() === 2, "and let go again when it closes");
  assert.equal(w.watchers.size, 0);
});

test("item 1: while another window is still connected, one closing leaves the watches be", async () => {
  const w = await watching();
  const one = await w.window();
  const two = await w.window();
  await w.watch(true);
  one.close();
  await tick(150);
  assert.equal(w.alone(), 0, "a window is still open");
  assert.equal(w.watchers.size, 1, "so its design stays watched");
  two.close();
  await until(() => w.watchers.size === 0, "gone once the last one closes");
});

// Item 2 (engine-design-security #18): the quick model writing a commit message, PR draft or Desk answer can be stopped.

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });

/** A fake Claude Code whose quiet turns report some tokens, then hang (never hearing the abort) unless `answer` gives them text. */
function hanging(answer: (n: number) => string | null = () => null) {
  const seen = { opened: 0, closed: 0 };
  const p: Provider = {
    id: "claude",
    detect: async () => info("claude", ["claude-opus-5-5"]),
    open: () => {
      const n = ++seen.opened;
      return {
        close: () => void seen.closed++,
        turn: async (_text: string, sink: TurnSink) => {
          sink.usage({ ...emptyUsage(), inputTokens: 100, outputTokens: 5 }, true);
          const a = answer(n);
          if (a === null) return new Promise<void>(() => {});
          sink.text(a);
        },
      };
    },
  };
  const saved = providers.claude;
  providers.claude = p;
  return { seen, restore: () => (providers.claude = saved) };
}

function writerRig() {
  const dir = tmp("lc-r2d-repo-");
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir });
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git("add", "-A");
  git("commit", "-qm", "a");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  const store = new Store(tmp("lc-r2d-home-"));
  const e = { PATH: "/usr/bin:/bin", HOME: tmp("lc-r2d-h-") } as NodeJS.ProcessEnv;
  const runtime = new Runtime(store, e);
  const api = createApi(store, runtime, e, { routines: { routines: [], recent: [], put: () => undefined, remove: () => undefined }, terms: {}, logs: {}, proxies: {} } as never);
  opened.push({ stop: () => (api.updates.stop(), runtime.shutdown()) });
  store.putProject({ id: "p", name: "p", path: dir, git: true, createdAt: 1 });
  store.putThread({ id: "t", projectId: "p", title: "Work", agent: "@claude:claude-opus-5-5", status: "idle", access: "full", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  store.putItem("t", { kind: "checkpoint", id: "c1", turn: 1, at: 1, files: [{ path: "a.txt", status: "modified", added: 1, removed: 0 }] });
  return { store, api };
}

test("item 2: writer.cancel ends a commit message still being written, promptly, with WRITER_CANCELLED; nothing lands in the session and its tokens still count", async () => {
  const tool = hanging();
  try {
    const { store, api } = writerRig();
    const items = store.timeline("t").length;
    const out = api.call("git.message", { threadId: "t" });
    out.catch(() => {});
    await until(() => tool.seen.opened === 1, "the quick model was asked");
    const asked = Date.now();
    assert.equal(await api.call("writer.cancel", { threadId: "t", kind: "message" }), null);
    await assert.rejects(out, (e: Error) => e.message === WRITER_CANCELLED);
    assert.ok(Date.now() - asked < 1000, `ended in ${Date.now() - asked} ms, not at its three-minute limit`);
    assert.equal(tool.seen.closed, 1, "its session is closed");
    assert.equal(store.timeline("t").length, items, "nothing is written into the session");
    assert.notEqual(store.thread("t").status, "error", "and it isn't a failure of the session's");
    assert.equal(store.thread("t").usage.inputTokens, 100, "the tokens it used are counted");
    // Another kind, or another session, isn't stopped by it: a cancel with nothing out is nothing.
    assert.equal(await api.call("writer.cancel", { threadId: "t", kind: "draft" }), null);
  } finally {
    tool.restore();
  }
});

test("item 2: a second git.message for the same session stops the first, and the second's message comes back", async () => {
  const tool = hanging((n) => (n === 2 ? "<message>Add a second line</message>" : null));
  try {
    const { api } = writerRig();
    const first = api.call("git.message", { threadId: "t" });
    first.catch(() => {});
    await until(() => tool.seen.opened === 1, "the first was asked");
    const second = api.call("git.message", { threadId: "t" });
    await assert.rejects(first, (e: Error) => e.message === WRITER_CANCELLED);
    assert.deepEqual(await second, { message: "Add a second line", by: "claude:claude-opus-5-5" });
    assert.equal(tool.seen.closed, 2, "both sessions closed");
  } finally {
    tool.restore();
  }
});

test("item 2: a cancel before the quick model is asked stops it there, and a PR draft and a Desk answer stop the same way", async () => {
  const tool = hanging();
  try {
    const { api } = writerRig();
    const draft = api.call("pr.draft", { threadId: "t" });
    draft.catch(() => {});
    const desk = api.call("desk.ask", { threadId: "t", question: "What changed?", context: "" });
    desk.catch(() => {});
    await until(() => tool.seen.opened === 2, "both were asked");
    await api.call("writer.cancel", { threadId: "t", kind: "draft" });
    await assert.rejects(draft, (e: Error) => e.message === WRITER_CANCELLED);
    await api.call("writer.cancel", { threadId: "t", kind: "desk" });
    await assert.rejects(desk, (e: Error) => e.message === WRITER_CANCELLED);
    // Asked and cancelled at once, while it still reads the diff: the model is never opened.
    const early = api.call("git.message", { threadId: "t" });
    early.catch(() => {});
    await api.call("writer.cancel", { threadId: "t", kind: "message" });
    await assert.rejects(early, (e: Error) => e.message === WRITER_CANCELLED);
    assert.equal(tool.seen.opened, 2, "no third session opened for a message already stopped");
  } finally {
    tool.restore();
  }
});
