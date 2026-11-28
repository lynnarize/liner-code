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

test("A sidekick's copy keeps the newest turn, cut to fit, when the first ask, plan and files take most of its budget, and the note stays in that budget", () => {
  const items: Item[] = [
    { kind: "user", id: "u1", turn: 1, at: 1, text: "F".repeat(1700) },
    { kind: "text", id: "x1", turn: 1, at: 1, text: "a".repeat(500), streaming: false },
    { kind: "plan", id: "p1", turn: 1, at: 1, entries: Array.from({ length: 40 }, (_, i) => ({ title: `step number ${i} do the thing well`, status: "pending" as const })) },
    { kind: "checkpoint", id: "c1", turn: 1, at: 1, files: Array.from({ length: 40 }, (_, i) => ({ path: `src/${i}/`.padEnd(70, "x"), status: "added" as const, added: 1, removed: 0, rel: true })), from: "f", to: "t" },
    ...[2, 3].flatMap((turn): Item[] => [
      { kind: "user", id: `u${turn}`, turn, at: turn, text: `q${turn}` },
      { kind: "text", id: `x${turn}`, turn, at: turn, text: `short answer ${turn}`, streaming: false },
    ]),
    { kind: "user", id: "u4", turn: 4, at: 4, text: "N".repeat(8000) },
    { kind: "text", id: "x4", turn: 4, at: 4, text: "newest answer", streaming: false },
  ];
  const out = handoff(items, "fork", 12000);
  assert.match(out, /You were asked: NNNN/, "the newest ask is carried over");
  assert.match(out, /cut here: it was too long to carry over/);
  const body = out.slice(out.indexOf("<earlier>\n") + 10, out.indexOf("\n</earlier>")).replace(/^\(\d+ older turns? left out\)\n\n/m, "");
  assert.ok(body.length <= 12000, `the note is ${body.length} long, over its budget`);
  // Hundreds of short turns: the blank line between each is counted too.
  const many: Item[] = Array.from({ length: 2000 }, (_, i): Item[] => [
    { kind: "user", id: `mu${i}`, turn: i + 1, at: i, text: `q${i}` },
    { kind: "text", id: `mx${i}`, turn: i + 1, at: i, text: `a${i}`, streaming: false },
  ]).flat();
  const note = handoff(many, "fork", 24000);
  const inner = note.slice(note.indexOf("<earlier>\n") + 10, note.indexOf("\n</earlier>")).replace(/\(\d+ older turns? left out\)\n\n/, "").replace(/The first ask, which started it: q0\n\n/, "");
  assert.ok(inner.length <= 24000 - "The first ask, which started it: q0".length - 2, `the turns run to ${inner.length}, past the room left for them`);
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

/** Stands in for a tool whose turns can fail before it keeps a session, as one not signed in does; the rest keep `id`. */
function fakeTool(id: "codex" | "claude", fails: number[] = []) {
  const texts: string[] = [];
  const p: Provider = {
    id,
    detect: async () => ready[id === "claude" ? 0 : 1],
    open: () =>
      ({
        close: () => {},
        turn: async (text: string, sink: { session: (s: string) => void }) => {
          texts.push(text);
          if (fails.includes(texts.length)) throw new Error("Not signed in.");
          sink.session(`${id}-sess`);
        },
      }) as unknown as ProviderSession,
  };
  const saved = providers[id];
  providers[id] = p;
  return { texts, restore: () => (providers[id] = saved) };
}

async function settle(store: Store) {
  for (let i = 0; i < 200 && store.thread("t").status === "running"; i++) await new Promise((r) => setTimeout(r, 5));
}

function opusAnswered(store: Store) {
  store.putItem("t", { kind: "turn", id: "m1", turn: 1, at: 1, agent: "forge", model: "claude:claude-opus-5-5", status: "done" });
  store.putItem("t", { kind: "user", id: "u1", turn: 1, at: 1, text: "make the tide chart scroll" });
  store.putItem("t", { kind: "text", id: "x1", turn: 1, at: 1, text: "It scrolls now, the axis stays pinned.", streaming: false });
}

const switches = (store: Store) => store.timeline("t").flatMap((x) => (x.kind === "notice" && x.handoff ? [x.handoff] : []));

test("A switch whose first turn fails before the new tool keeps a session still says it came from Opus on the next turn, and shows the switch once", async () => {
  const { texts, restore } = fakeTool("codex", [1]);
  try {
    const { store, runtime } = session({ model: "codex:gpt-6.1-sol", effort: "medium", providerSession: "claude:old" });
    opusAnswered(store);
    await runtime.send("t", "match the colours too");
    await settle(store);
    assert.equal(store.thread("t").providerSession, "claude:old", "the failed turn kept no session");
    await runtime.send("t", "try again");
    await settle(store);
    assert.equal(texts.length, 2);
    assert.match(texts[1], /taking over this conversation from Opus 5\.5/, "not from GPT, which never answered");
    assert.doesNotMatch(texts[1], /from GPT-6\.1-Sol/);
    const rows = switches(store);
    assert.equal(rows.length, 1, "one switch, one row");
    assert.equal(rows[0].from, "claude:claude-opus-5-5");
    assert.equal(rows[0].to, "codex:gpt-6.1-sol");
    assert.ok(texts[1].startsWith(rows[0].note), "the note shown is the note last sent");
  } finally {
    restore();
  }
});

test("A /compact sent right after a switch leaves the next turn's switch from Opus, not from the model it moved to", async () => {
  const { texts, restore } = fakeTool("codex");
  try {
    const { store, runtime } = session({ model: "codex:gpt-6.1-sol", effort: "medium", providerSession: "claude:old" });
    opusAnswered(store);
    await runtime.send("t", "/compact");
    await settle(store);
    await runtime.send("t", "match the colours too");
    await settle(store);
    assert.match(texts.at(-1)!, /taking over this conversation from Opus 5\.5/);
    const rows = switches(store);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].from, "claude:claude-opus-5-5");
  } finally {
    restore();
  }
});

test("Switching again after the session went back to its first tool shows the new switch as a row of its own", async () => {
  const codex = fakeTool("codex", [1]);
  const claude = fakeTool("claude");
  try {
    const { store, runtime } = session({ model: "codex:gpt-6.1-sol", effort: "medium", providerSession: "claude:old" });
    opusAnswered(store);
    await runtime.send("t", "match the colours too");
    await settle(store);
    store.patchThread("t", { model: "claude:claude-opus-5-5" });
    await runtime.send("t", "you do it then");
    await settle(store);
    store.patchThread("t", { model: "codex:gpt-6.1-sol" });
    await runtime.send("t", "now GPT again");
    await settle(store);
    assert.equal(codex.texts.length, 2);
    assert.match(codex.texts[1], /taking over this conversation from Opus 5\.5/);
    const rows = switches(store);
    assert.equal(rows.length, 2, "the switch made again is a switch of its own");
    assert.equal(rows[1].from, "claude:claude-opus-5-5");
  } finally {
    claude.restore();
    codex.restore();
  }
});

test("Handoff caps a long file list and preserves at least the newest turn even on a tight budget with large stand-apart notes", () => {
  const longFiles: Item[] = [
    { kind: "user", id: "u1", turn: 1, at: 1, text: "F".repeat(1600) },
    { kind: "text", id: "x1", turn: 1, at: 1, text: "a".repeat(200), streaming: false },
    { kind: "plan", id: "p1", turn: 1, at: 1, entries: Array.from({ length: 40 }, (_, i) => ({ title: `step number ${i} with a long description to fill plan budget`, status: "pending" as const })) },
    { kind: "checkpoint", id: "c1", turn: 1, at: 1, files: Array.from({ length: 40 }, (_, i) => ({ path: `src/feature-${i}/`.padEnd(250, "x"), status: "added" as const, added: 1, removed: 0, rel: true })), from: "f", to: "t" },
    { kind: "user", id: "u2", turn: 2, at: 2, text: "NEWEST_REQUEST_".repeat(500) },
    { kind: "text", id: "x2", turn: 2, at: 2, text: "newest answer", streaming: false },
  ];
  const out = handoff(longFiles, "fork", 12000);
  assert.match(out, /You were asked: NEWEST_REQUEST_/, "newest turn is preserved when 40 paths are very long");
  assert.match(out, /cut here: it was too long to carry over/);
  const body = out.slice(out.indexOf("<earlier>\n") + 10, out.indexOf("\n</earlier>")).replace(/^\(\d+ older turns? left out\)\n\n/m, "");
  assert.ok(body.length <= 12000, `body length ${body.length} exceeds 12000 budget`);
  const filesLine = body.split("\n").find((l) => l.startsWith("Files changed so far and not undone:")) ?? "";
  assert.ok(filesLine.length <= 1600, `filesNote length ${filesLine.length} exceeds 1600 cap`);

  // Tight budget where full firstNote + planNote + filesNote alone exceed budget: newest turn is still kept and body stays in budget.
  const tight = handoff(longFiles, "fork", 2600);
  assert.match(tight, /You were asked: NEWEST_REQUEST_/, "newest turn is never dropped on a tight budget");
  const tightBody = tight.slice(tight.indexOf("<earlier>\n") + 10, tight.indexOf("\n</earlier>")).replace(/^\(\d+ older turns? left out\)\n\n/m, "");
  assert.ok(tightBody.length <= 2600, `tight body length ${tightBody.length} exceeds 2600 budget`);
});
