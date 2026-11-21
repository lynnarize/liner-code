/*
  The effort a turn is given and what the session says of it: a level the person picked that the model doesn't take is said
  once, the first turn it applies, and a level nobody picked is neither sent nor spoken of. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { effortOf } from "../src/providers/models.ts";
import type { OpenOptions, Provider, ProviderSession, TurnSink } from "../src/providers/types.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

const codex: ProviderInfo = { id: "codex", label: "Codex", available: true, adapter: true, login: "", models: [{ id: "gpt-6", label: "GPT-6", description: "", efforts: ["low", "high"].map((x) => effortOf(x)) }], supports: { approvals: true, resume: true, effort: true, plan: true } };

/** Codex in its place, whose every turn says a word and ends, keeping the effort each session was opened at. */
function fakeCodex() {
  const opened: (string | undefined)[] = [];
  const saved = providers.codex;
  const p: Provider = { id: "codex", detect: async () => codex, open: (o: OpenOptions) => (opened.push(o.effort), { close: () => {}, update: async () => true, turn: async (_text: string, sink: TurnSink) => void sink.text("ok") }) as unknown as ProviderSession };
  providers.codex = p;
  return { opened, restore: () => void (providers.codex = saved) };
}

function session(extra: Partial<Thread> = {}) {
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-effort-note-")));
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-effort-note-dir-")), git: false, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Work", agent: "@codex:gpt-6", status: "idle", access: "ask", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = [codex];
  return { store, runtime };
}

const notes = (store: Store) => store.timeline("t").flatMap((x) => (x.kind === "notice" && /effort/.test(x.text) ? [x.text] : []));

test("A level the person picked that the model doesn't take is said once, on the first turn it applies, not every turn", async () => {
  const f = fakeCodex();
  try {
    const { store, runtime } = session({ effort: "medium" });
    await runtime.send("t", "one");
    await runtime.send("t", "two");
    await runtime.send("t", "three");
    assert.equal(notes(store).length, 1, "said once");
    assert.match(notes(store)[0], /GPT-6 has no Medium effort, so this turn runs at Low/);
    assert.equal(f.opened[0], "low", "it runs at the nearest level the model lists");
    store.patchThread("t", { effort: "max" });
    await runtime.send("t", "four");
    await runtime.send("t", "five");
    assert.equal(notes(store).length, 2, "another level picked is said once more, once");
  } finally {
    f.restore();
  }
});

test("A session on a bare model whose level the person never set sends no level and says nothing of one", async () => {
  for (const extra of [{}, { effort: "" }]) await neverSet(extra);
});

async function neverSet(extra: Partial<Thread>) {
  const f = fakeCodex();
  try {
    const { store, runtime } = session(extra);
    await runtime.send("t", "one");
    await runtime.send("t", "two");
    assert.equal(notes(store).length, 0, "nothing said of a level nobody picked");
    assert.ok(f.opened.length >= 1);
    assert.ok(f.opened.every((e) => !e), `no level sent: ${JSON.stringify(f.opened)}`);
    assert.equal(runtime.resolve(store.thread("t")).effort, "");
  } finally {
    f.restore();
  }
}

test("Before its tool's list is read, a picked level is sent as none and nothing is said of the model having no such level", async () => {
  const f = fakeCodex();
  try {
    const { store, runtime } = session({ effort: "high" });
    // Just started: tools.json not read yet, so the engine doesn't know which levels the model takes.
    runtime.providerInfo = [];
    await runtime.send("t", "one");
    assert.equal(f.opened[0], "", "no level sent while its levels aren't known");
    assert.deepEqual(notes(store), [], "no \"has no High effort\" written into the timeline for good");
    // Once the list is in, a level the model lacks is said, as before.
    runtime.providerInfo = [codex];
    store.patchThread("t", { effort: "medium" });
    await runtime.send("t", "two");
    assert.match(notes(store).join("\n"), /GPT-6 has no Medium effort, so this turn runs at Low/, "a model its tool lists without the level is still said");
  } finally {
    f.restore();
  }
});
