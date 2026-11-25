/*
  Switching a running session to another tool: the tool taking over gets a handoff note with everything so far, and the
  timeline shows the switch, from which model to which, with the note it was sent. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item, ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { handoff, providers, Runtime } from "../src/runtime.ts";
import type { Provider, ProviderSession } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const info = (id: ProviderInfo["id"], models: [string, string][]): ProviderInfo => ({ id, label: id === "codex" ? "Codex" : "Claude Code", available: true, adapter: true, login: "", models: models.map(([m, label]) => ({ id: m, label, description: "", efforts: [{ id: "low", label: "low" }, { id: "medium", label: "medium" }, { id: "high", label: "high" }] })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const ready = [info("claude", [["claude-opus-5-5", "Opus 5.5"]]), info("codex", [["gpt-6.1-sol", "GPT-6.1-Sol"]])];

/** Stands in for Codex, keeping what each turn was told. */
function fakeCodex() {
  const texts: string[] = [];
  const p: Provider = {
    id: "codex",
    detect: async () => ready[1],
    open: () => ({ close: () => {}, turn: async (text: string) => void texts.push(text) }) as unknown as ProviderSession,
  };
  const saved = providers.codex;
  providers.codex = p;
  return { texts, restore: () => (providers.codex = saved) };
}

function session(extra: Partial<Thread>) {
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-handoff-")));
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-handoff-dir-")), git: false, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Work", agent: "forge", status: "idle", access: "ask", turns: 1, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = ready;
  return { store, runtime };
}

test("Switching a session from Opus to GPT hands GPT a note naming who answered, and the timeline shows the switch with that note", async () => {
  const { texts, restore } = fakeCodex();
  try {
    const { store, runtime } = session({ model: "codex:gpt-6.1-sol", effort: "medium", providerSession: "claude:old" });
    store.putItem("t", { kind: "turn", id: "m1", turn: 1, at: 1, agent: "forge", model: "claude:claude-opus-5-5", status: "done" });
    store.putItem("t", { kind: "user", id: "u1", turn: 1, at: 1, text: "make the tide chart scroll" });
    store.putItem("t", { kind: "text", id: "x1", turn: 1, at: 1, text: "It scrolls now, the axis stays pinned.", streaming: false });
    await runtime.send("t", "match the colours too");
    assert.equal(texts.length, 1);
    assert.match(texts[0], /taking over this conversation from Opus 5\.5/);
    assert.match(texts[0], /Opus 5\.5 answered: It scrolls now/, "the answer is Opus's, not GPT's own");
    assert.doesNotMatch(texts[0], /You answered/);
    assert.match(texts[0], /match the colours too$/, "your message comes after the note, as it was");
    const row = store.timeline("t").find((x) => x.kind === "notice" && x.handoff);
    assert.ok(row?.kind === "notice" && row.handoff, "the switch is in the timeline");
    assert.equal(row.handoff.from, "claude:claude-opus-5-5");
    assert.equal(row.handoff.to, "codex:gpt-6.1-sol");
    assert.equal(row.handoff.effort, "medium");
    assert.ok(texts[0].startsWith(row.handoff.note), "the note shown is the note sent");
  } finally {
    restore();
  }
});

test("The first ask, the plan left open and the files changed outlive the turns a small handoff leaves out", () => {
  const items: Item[] = [
    { kind: "user", id: "u1", turn: 1, at: 1, text: "build the harbour page" },
    { kind: "text", id: "x1", turn: 1, at: 1, text: "a".repeat(3000), streaming: false },
    { kind: "checkpoint", id: "c1", turn: 1, at: 1, files: [{ path: "src/harbour.tsx", status: "added", added: 40, removed: 0, rel: true }], from: "f", to: "t" },
    { kind: "checkpoint", id: "c0", turn: 1, at: 1, files: [{ path: "src/undone.ts", status: "added", added: 1, removed: 0, rel: true }], from: "f", to: "t", reverted: true },
    ...[2, 3, 4].flatMap((turn): Item[] => [
      { kind: "user", id: `u${turn}`, turn, at: turn, text: `ask ${turn} ${"y".repeat(600)}` },
      { kind: "text", id: `x${turn}`, turn, at: turn, text: `answer ${turn} ${"z".repeat(600)}`, streaming: false },
    ]),
    { kind: "plan", id: "p1", turn: 4, at: 4, entries: [{ title: "Draw the tide table", status: "completed" }, { title: "Add the moon phases", status: "in_progress" }] },
  ];
  const out = handoff(items, "switch", 2600);
  assert.ok(out.length < 3200, "it stays near the budget");
  assert.match(out, /older turns? left out/, "something was left out");
  assert.match(out, /The first ask, which started it: build the harbour page/);
  assert.match(out, /\[~\] Add the moon phases/);
  assert.match(out, /Files changed so far and not undone: src\/harbour\.tsx/);
  assert.doesNotMatch(out, /not undone: [^\n]*undone\.ts/, "a change since undone isn't said to stand");
});

test("A failed command hands on its last lines, and a turn you stopped says so", () => {
  const items: Item[] = [
    { kind: "user", id: "u1", turn: 1, at: 1, text: "run the tests" },
    { kind: "tool", id: "c1", turn: 1, at: 1, tool: "Bash", toolKind: "exec", title: "Run npm test", status: "failed", output: "1 passing\nError: tide.test.ts expected 4 to equal 5" },
    { kind: "notice", id: "n1", turn: 1, at: 1, text: "You stopped this turn." },
  ];
  const out = handoff(items, "switch");
  assert.match(out, /Run npm test, failed: …1 passing\nError: tide\.test\.ts expected 4 to equal 5\)/);
  assert.match(out, /The person stopped this turn before it finished/);
});
