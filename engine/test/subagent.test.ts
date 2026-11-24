/*
  Ephemeral subagents for providers without working native subagents (OpenCode, Cursor, Grok, added
  ACP): parallel read-only fan-out, serialized write mode with measured git diffs, strict read-only
  enforcement, per-row stop and steer, recursion prevention, and OpenCode rule integration.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item, ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage, stepKind } from "../../contracts/src/index.ts";
import { AgentTools, linerTitle } from "../src/agent-tools.ts";
import { createApi } from "../src/api.ts";
import { SUBAGENT_ENV, toolsFor } from "../src/liner-tools.ts";
import { linerCall, opencodeRules } from "../src/providers/acp.ts";
import type { OpenOptions, Provider, TurnSink } from "../src/providers/types.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";
import { isSubagentTool, needsSubagentTool, subagentResult } from "../src/subagent.ts";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string, ms = 3000) {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await tick();
  assert.ok(ok(), what);
}
const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });

const nap = (ms: number, signal: AbortSignal) =>
  new Promise<void>((ok, no) => {
    if (signal.aborted) return no(new Error("stopped"));
    const t = setTimeout(ok, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), no(new Error("stopped"))), { once: true });
  });

type Script = (o: OpenOptions, text: string, sink: TurnSink, signal: AbortSignal) => Promise<void>;
function fake(id: "opencode" | "claude" | "cursor", script: Script, onSteer?: (o: OpenOptions, msg: string) => void) {
  const opened: OpenOptions[] = [];
  const closed: OpenOptions[] = [];
  const child = { now: 0, most: 0, stopped: 0 };
  const p: Provider = {
    id,
    detect: async () => info(id, []),
    open: (o) => {
      opened.push(o);
      return {
        close() {
          closed.push(o);
        },
        ...(onSteer ? { steer: (msg: string) => (onSteer(o, msg), true) } : {}),
        turn: async (text, sink, signal) => {
          const isChild = Boolean(o.sidekick);
          if (isChild) child.most = Math.max(child.most, ++child.now);
          try {
            await script(o, text, sink, signal);
          } catch (e) {
            if (isChild && signal.aborted) child.stopped++;
            throw e;
          } finally {
            if (isChild) child.now--;
          }
        },
      };
    },
  };
  const saved = providers[id];
  providers[id] = p;
  return { opened, closed, child, restore: () => (providers[id] = saved) };
}

function setup(agent = "@cursor:auto", extra: Partial<Thread> = {}) {
  const home = mkdtempSync(join(tmpdir(), "lc-sa-"));
  const dir = mkdtempSync(join(tmpdir(), "lc-sa-dir-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "one\n");
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a"], { cwd: dir });
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: true, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Work", agent, status: "idle", access: "full", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  const tools = new AgentTools(store, process.env);
  tools.url = "http://127.0.0.1:9";
  const runtime = new Runtime(store, process.env, tools);
  tools.host = runtime;
  runtime.providerInfo = [info("opencode", ["deepseek-v4.1-flash"]), info("claude", ["claude-opus-5-5"]), info("cursor", ["auto"])];
  const used: { agent: string; costUsd: number }[] = [];
  const log = store.logUsage.bind(store);
  store.logUsage = (r) => (used.push({ agent: r.agent, costUsd: r.costUsd }), log(r));
  return { store, runtime, tools, dir, used };
}

async function callSubagent(tools: AgentTools, o: OpenOptions, sink: TurnSink, key: string, args: Record<string, unknown>, gone?: AbortSignal) {
  sink.tool({ key, tool: "liner_subagent", toolKind: "other", title: linerTitle("subagent", args), input: JSON.stringify(args), status: "running" });
  const r = await tools.call(tools.threadOf(o.mcp!.key!)!, "subagent", args, gone);
  const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  sink.tool({ key, tool: "liner_subagent", toolKind: "other", title: linerTitle("subagent", args), status: r.isError ? "failed" : "done", output: text });
  return { text, isError: Boolean(r.isError) };
}

const taskRows = (items: Item[]) => items.filter((x): x is Extract<Item, { kind: "tool" }> => x.kind === "tool" && x.toolKind === "task");

test("subagent: provider gating offers the tool to ACP providers without native subagents, not Claude, OpenCode V2 server, or side chats", async () => {
  assert.equal(needsSubagentTool("opencode"), false);
  assert.equal(needsSubagentTool("opencode", { LINER_OPENCODE_ACP: "1" }), true);
  assert.equal(needsSubagentTool("cursor"), true);
  assert.equal(needsSubagentTool("grok"), true);
  assert.equal(needsSubagentTool("acp"), true);
  assert.equal(needsSubagentTool("claude"), false);
  assert.equal(needsSubagentTool("codex"), false);
  assert.equal(needsSubagentTool("hermes"), false);
  assert.equal(needsSubagentTool("antigravity"), false);

  const cur = fake("cursor", async (_o, _text, sink) => sink.text("ok"));
  const cl = fake("claude", async (_o, _text, sink) => sink.text("ok"));
  try {
    const a = setup("@cursor:auto");
    await a.runtime.send("t", "hi");
    assert.equal(cur.opened[0].mcp!.env[SUBAGENT_ENV], "1");
    assert.ok(toolsFor(cur.opened[0].mcp!.env).some((t) => t.name === "subagent"));
    assert.match(cur.opened[0].soul ?? "", /subagent/);

    // A side chat on Cursor never gets subagent.
    const side = setup("@cursor:auto", { sideOf: "parent" });
    await side.runtime.send("t", "hi");
    assert.equal(cur.opened[1].mcp!.env[SUBAGENT_ENV], undefined);
    assert.ok(!toolsFor(cur.opened[1].mcp!.env).some((t) => t.name === "subagent"));

    // Claude Code keeps its native subagents and does not receive Liner's subagent tool.
    const b = setup("@claude:claude-opus-5-5");
    await b.runtime.send("t", "hi");
    assert.equal(cl.opened[0].mcp!.env[SUBAGENT_ENV], undefined);
    assert.ok(!toolsFor(cl.opened[0].mcp!.env).some((t) => t.name === "subagent"));
  } finally {
    cur.restore();
    cl.restore();
  }
});

test("subagent: OpenCode permission rules allow liner_subagent while keeping native task and subagent denied", () => {
  const rules = opencodeRules({}, true);
  assert.equal(rules.liner_subagent, "allow");
  assert.equal(rules["task*"], "deny");
  assert.equal(rules["subagent*"], "deny");
  for (const name of ["mcp__liner__subagent", "liner.subagent", "liner_subagent", "mcp__editor_liner_8c735fbc__subagent"]) {
    assert.ok(isSubagentTool(name), name);
    assert.equal(stepKind({ tool: name, toolKind: "other", title: "Subagent" }), "agent", name);
  }
  assert.deepEqual(linerCall("liner_subagent", { prompt: "check" }), { name: "subagent", input: { prompt: "check" } });
});

test("subagent: parallel read-only subagents run concurrently up to the cap and never receive an MCP server", async () => {
  const { store, runtime, tools, used } = setup();
  runtime.subagentMaxConcurrent = 2;
  let results: { text: string; isError: boolean }[] = [];
  const oc = fake("cursor", async (o, text, sink, signal) => {
    if (!o.sidekick) {
      results = await Promise.all([
        callSubagent(tools, o, sink, "k1", { title: "Audit CSS", prompt: "Inspect CSS tokens" }),
        callSubagent(tools, o, sink, "k2", { title: "Audit routing", prompt: "Inspect routing" }),
        callSubagent(tools, o, sink, "k3", { title: "Audit tests", prompt: "Inspect tests" }),
      ]);
      sink.text("All three reports received.");
      return;
    }
    // Children never get Liner's MCP server (no recursion, no extra subprocess) and run ephemeral + read-only.
    assert.equal(o.mcp, undefined);
    assert.equal(o.ephemeral, true);
    assert.equal(o.access, "read");
    sink.tool({ key: "r", tool: "Read", toolKind: "read", title: "Read a.txt", path: "a.txt", status: "done" });
    await nap(80, signal);
    sink.usage({ inputTokens: 50, outputTokens: 20, cacheReadTokens: 0, costUsd: 0.002 });
    sink.text(`Done: ${text}`);
  });
  try {
    await runtime.send("t", "Audit three areas in parallel");
    assert.equal(oc.child.most, 2, "two read-only subagents ran in parallel, capped at subagentMaxConcurrent");
    assert.equal(oc.closed.filter((o) => o.sidekick).length, 3, "every ephemeral child session was closed");
    assert.equal(results.length, 3);
    for (const r of results) assert.equal(r.isError, false);
    assert.match(results[0].text, /Done: Inspect CSS tokens/);
    assert.match(results[2].text, /Done: Inspect tests/);
    const rows = taskRows(store.timeline("t"));
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.agent?.state, "done");
      assert.equal(row.agent?.tools, 1);
      assert.equal(row.agent?.tokens, 70);
    }
    assert.equal(used.filter((u) => u.agent === "subagent").length, 3);
  } finally {
    oc.restore();
  }
});

test("subagent: read-only mode refuses edits and mutating commands even when the parent session is on Auto or Full access", async () => {
  const { runtime, tools } = setup("@cursor:auto", { access: "auto" });
  let editDecision: { allow: boolean; reason?: string } | undefined;
  let cmdDecision: { allow: boolean; reason?: string } | undefined;
  let readDecision: { allow: boolean; reason?: string } | undefined;
  const oc = fake("cursor", async (o, _text, sink, signal) => {
    if (!o.sidekick) {
      const r = await callSubagent(tools, o, sink, "k1", { title: "Check files", prompt: "Inspect a.txt", mode: "read" });
      assert.equal(r.isError, false);
      sink.text("checked");
      return;
    }
    editDecision = await sink.approve({ tool: "Edit", title: "Edit a.txt", risk: "medium", rule: "Edit", fields: [{ label: "File", value: "a.txt" }] }, signal);
    cmdDecision = await sink.approve({ tool: "Bash", title: "Run rm a.txt", risk: "medium", fields: [{ label: "Command", value: "rm a.txt" }] }, signal);
    readDecision = await sink.approve({ tool: "Bash", title: "Run git status", risk: "low", fields: [{ label: "Command", value: "git status" }] }, signal);
    sink.text("Only read a.txt.");
  });
  try {
    await runtime.send("t", "check");
    assert.equal(editDecision?.allow, false);
    assert.match(editDecision?.reason ?? "", /read-only/i);
    assert.equal(cmdDecision?.allow, false);
    assert.match(cmdDecision?.reason ?? "", /read-only/i);
    assert.equal(readDecision?.allow, true);
  } finally {
    oc.restore();
  }

  // Even at Full access, read-only subagent refuses edits and mutating commands outright.
  const full = setup("@cursor:auto", { access: "full" });
  let fullEdit: { allow: boolean; reason?: string } | undefined;
  const oc2 = fake("cursor", async (o, _text, sink, signal) => {
    if (!o.sidekick) {
      const r = await callSubagent(full.tools, o, sink, "k1", { title: "Check files", prompt: "Inspect a.txt", mode: "read" });
      assert.equal(r.isError, false);
      sink.text("checked");
      return;
    }
    fullEdit = await sink.approve({ tool: "Edit", title: "Edit a.txt", risk: "medium", rule: "Edit", fields: [{ label: "File", value: "a.txt" }] }, signal);
    sink.text("Read only.");
  });
  try {
    await full.runtime.send("t", "check full");
    assert.equal(fullEdit?.allow, false);
    assert.match(fullEdit?.reason ?? "", /read-only/i);
  } finally {
    oc2.restore();
  }
});

test("subagent: write mode serializes concurrent writers, measures changed files, and is refused in a Read only session", async () => {
  const { store, runtime, tools, dir } = setup();
  let writeResults: { text: string; isError: boolean }[] = [];
  const oc = fake("cursor", async (o, text, sink, signal) => {
    if (!o.sidekick) {
      writeResults = await Promise.all([
        callSubagent(tools, o, sink, "w1", { title: "Write b.txt", prompt: "Write b.txt", mode: "write" }),
        callSubagent(tools, o, sink, "w2", { title: "Write c.txt", prompt: "Write c.txt", mode: "write" }),
      ]);
      sink.text("both written");
      return;
    }
    await nap(40, signal);
    const file = text.includes("b.txt") ? "b.txt" : "c.txt";
    writeFileSync(join(dir, file), `from ${file}\n`);
    sink.text(`Created ${file}.`);
  });
  try {
    await runtime.send("t", "write two files");
    assert.equal(oc.child.most, 1, "write subagents serialize so two writers never race on the working tree");
    assert.equal(writeResults[0].isError, false);
    assert.equal(writeResults[1].isError, false);
    assert.match(writeResults[0].text, /b\.txt: added, \+1 -0/);
    assert.match(writeResults[1].text, /c\.txt: added, \+1 -0/);
    const rows = taskRows(store.timeline("t"));
    assert.equal(rows[0].agent?.files?.[0]?.path, "b.txt");
    assert.equal(rows[1].agent?.files?.[0]?.path, "c.txt");
  } finally {
    oc.restore();
  }

  // Write mode is refused outright when the parent session is Read only.
  const ro = setup("@cursor:auto", { access: "read" });
  let refused: { text: string; isError: boolean } | undefined;
  const oc2 = fake("cursor", async (o, _text, sink) => {
    refused = await callSubagent(toolsForReturn(ro.tools), o, sink, "w1", { title: "Edit", prompt: "Edit a.txt", mode: "write" });
    sink.text("ok");
  });
  try {
    await ro.runtime.send("t", "edit");
    assert.equal(refused?.isError, true);
    assert.match(refused?.text ?? "", /Read only/);
  } finally {
    oc2.restore();
  }
});

const toolsForReturn = (t: AgentTools) => t;

test("subagent: stopAgent stops one parallel subagent while its sibling finishes, and steerAgent reaches a running subagent", async () => {
  const { store, runtime, tools } = setup();
  const steered: string[] = [];
  let out: { text: string; isError: boolean }[] = [];
  const oc = fake(
    "cursor",
    async (o, text, sink, signal) => {
      if (!o.sidekick) {
        out = await Promise.all([
          callSubagent(tools, o, sink, "s1", { title: "Slow task", prompt: "Slow task" }),
          callSubagent(tools, o, sink, "s2", { title: "Fast task", prompt: "Fast task" }),
        ]);
        sink.text("done");
        return;
      }
      if (text.includes("Slow")) {
        await nap(5000, signal);
        sink.text("never");
      } else {
        await nap(120, signal);
        sink.text("fast done");
      }
    },
    (_o, msg) => steered.push(msg),
  );
  try {
    const turn = runtime.send("t", "run two");
    await until(() => taskRows(store.timeline("t")).filter((r) => r.agent?.taskId).length === 2, "two subagent rows started");
    const slow = taskRows(store.timeline("t")).find((r) => r.agent?.task === "Slow task")!;
    assert.equal(await runtime.steerAgent("t", slow.id, "focus on CSS"), true);
    assert.deepEqual(steered, ["focus on CSS"]);
    assert.equal(await runtime.stopAgent("t", slow.id), true);
    await turn;
    assert.match(out[0].text, /was stopped/);
    assert.match(out[1].text, /fast done/);
    const rows = taskRows(store.timeline("t"));
    assert.equal(rows.find((r) => r.id === slow.id)?.agent?.state, "stopped");
    assert.equal(rows.find((r) => r.id !== slow.id)?.agent?.state, "done");
  } finally {
    oc.restore();
  }
});

test("subagent: formatting handles capped, failed and unstarted outcomes cleanly", () => {
  assert.match(subagentResult({ how: "stopped", who: "DeepSeek", mode: "read", seconds: 0, report: "", unstarted: true }), /before it started/);
  assert.match(subagentResult({ how: "capped", who: "DeepSeek", mode: "read", seconds: 600, report: "partial" }), /10-minute cap/);
  assert.match(subagentResult({ how: "failed", who: "DeepSeek", mode: "write", seconds: 3, report: "", problem: "boom", files: [] }), /boom/);
});

test("subagent: Settings.maxActiveSubagents controls parallel read-only concurrency, updates the lead prompt, and validates bounds", async () => {
  const { store, runtime, tools } = setup();
  const api = createApi(store, runtime, process.env, {} as Parameters<typeof createApi>[3]);
  await assert.rejects(() => api.call("settings.save", { maxActiveSubagents: 0 }), /1 to 8/);
  await assert.rejects(() => api.call("settings.save", { maxActiveSubagents: 9 }), /1 to 8/);
  await assert.rejects(() => api.call("settings.save", { maxActiveSubagents: 2.5 }), /1 to 8/);
  const saved = (await api.call("settings.save", { maxActiveSubagents: 6 })) as { maxActiveSubagents?: number };
  assert.equal(saved.maxActiveSubagents, 6);
  assert.equal(runtime.subagentMax("t"), 6);

  const oc = fake("cursor", async (o, text, sink, signal) => {
    if (!o.sidekick) {
      await Promise.all([1, 2, 3, 4, 5, 6].map((i) => callSubagent(tools, o, sink, `k${i}`, { title: `Task ${i}`, prompt: `Check ${i}` })));
      sink.text("all 6 done");
      return;
    }
    await nap(60, signal);
    sink.text(`ok ${text}`);
  });
  try {
    await runtime.send("t", "fan out 6");
    assert.match(oc.opened[0].soul ?? "", /up to 6 read-only subagents run in parallel/);
    assert.equal(oc.child.most, 6, "all 6 read-only subagents ran concurrently with maxActiveSubagents=6");
  } finally {
    oc.restore();
  }
});
