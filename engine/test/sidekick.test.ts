/*
  Lead + sidekick: the lead of a pair hands a brief to its sidekick through Liner Code's own
  `sidekick` tool, and the engine runs it as a turn of the sidekick's own session, on the lead's
  tool row, one brief at a time, with the files it changed measured. Fake tools stand in for both
  models; the Demo's scripted pair runs end to end through a real HTTP surface. Run with
  `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item, ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { AgentTools } from "../src/agent-tools.ts";
import { PAIR_ENV, toolsFor } from "../src/liner-tools.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { ensureSampleProject } from "../src/providers/demo.ts";
import type { OpenOptions, Provider, TurnSink } from "../src/providers/types.ts";
import { BRIEF_MARGIN_MS, briefCap, isSidekickTool, leadRules, SIDEKICK_MS, sidekickResult, sidekickRules } from "../src/sidekick.ts";
import { linerName, toolsNote } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string, ms = 3000) {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await tick();
  assert.ok(ok(), what);
}
const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const LEAD = "@claude:claude-opus-5-5";
const SIDE = "codex:gpt-6-luna";

/** Waits for `ms`, or until stopped. */
const nap = (ms: number, signal: AbortSignal) =>
  new Promise<void>((ok, no) => {
    if (signal.aborted) return no(new Error("stopped"));
    const t = setTimeout(ok, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), no(new Error("stopped"))), { once: true });
  });

type Script = (o: OpenOptions, text: string, sink: TurnSink, signal: AbortSignal) => Promise<void>;
/** A fake tool in `id`'s place: each session it opens runs `script`, and what it was opened with is kept. */
function fake(id: "claude" | "codex", script: Script) {
  const opened: OpenOptions[] = [];
  const seen = { now: 0, most: 0, stopped: 0 };
  const p: Provider = {
    id,
    detect: async () => info(id, []),
    open: (o) => {
      opened.push(o);
      return {
        close() {},
        turn: async (text, sink, signal) => {
          seen.most = Math.max(seen.most, ++seen.now);
          try {
            await script(o, text, sink, signal);
          } catch (e) {
            if (signal.aborted) seen.stopped++;
            throw e;
          } finally {
            seen.now--;
          }
        },
      };
    },
  };
  const saved = providers[id];
  providers[id] = p;
  return { opened, seen, restore: () => (providers[id] = saved) };
}

function pair(extra: Partial<Thread> = {}, home = mkdtempSync(join(tmpdir(), "lc-sk-")), dir?: string) {
  const store = new Store(home);
  if (!store.projects.length) {
    dir ??= mkdtempSync(join(tmpdir(), "lc-sk-dir-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    writeFileSync(join(dir, "a.txt"), "one\n");
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], { cwd: dir });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a"], { cwd: dir });
    store.putProject({ id: "p", name: "p", path: dir, git: true, createdAt: Date.now() });
    store.putThread({ id: "t", projectId: "p", title: "Work", agent: LEAD, sidekick: SIDE, status: "idle", access: "full", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  }
  const tools = new AgentTools(store, process.env);
  tools.url = "http://127.0.0.1:9";
  const runtime = new Runtime(store, process.env, tools);
  tools.host = runtime;
  runtime.providerInfo = [info("claude", ["claude-opus-5-5"]), info("codex", ["gpt-6-luna"])];
  const used: { agent: string; costUsd: number }[] = [];
  const log = store.logUsage.bind(store);
  store.logUsage = (r) => (used.push({ agent: r.agent, costUsd: r.costUsd }), log(r));
  return { store, runtime, tools, home, dir: store.project("p").path, used };
}

/** The lead's call of the tool, as a tool makes it: a row first, then the call through its MCP server's key. */
async function hand(tools: AgentTools, o: OpenOptions, sink: TurnSink, key: string, args: Record<string, unknown>) {
  sink.tool({ key, tool: "mcp__liner__sidekick", toolKind: "other", title: "Sidekick", input: JSON.stringify(args), status: "running" });
  const r = await tools.call(tools.threadOf(o.mcp!.env.LINER_SURFACE_KEY)!, "sidekick", args);
  const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  sink.tool({ key, tool: "mcp__liner__sidekick", toolKind: "other", title: "Sidekick", status: r.isError ? "failed" : "done", output: text });
  return { text, isError: Boolean(r.isError) };
}

const rows = (items: Item[]) => items.filter((x): x is Extract<Item, { kind: "tool" }> => x.kind === "tool" && x.toolKind === "task");

/** A sidekick that writes b.txt, says a step and a report, and reports its use. */
const writer: Script = async (o, _text, sink) => {
  sink.session("side-1");
  sink.tool({ key: "w", tool: "Write", toolKind: "write", title: "Write b.txt", path: "b.txt", status: "running" });
  writeFileSync(join(o.cwd, "b.txt"), "two\nthree\n");
  sink.tool({ key: "w", tool: "Write", toolKind: "write", title: "Write b.txt", path: "b.txt", status: "done" });
  sink.text("Wrote b.txt with two lines. Checks: none needed.");
  sink.usage({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, costUsd: 0.01 });
};

test("sidekick: the lead hands a brief and reads back the report and the measured files, on its own row", async () => {
  const side = fake("codex", writer);
  let got = { text: "", isError: false };
  const lead = fake("claude", async (o, _t, sink) => {
    got = await hand(tools, o, sink, "k1", { brief: "Write b.txt with two lines.", done_when: "b.txt exists" });
    sink.text("Read its diff.");
  });
  const { store, runtime, tools, used } = pair();
  try {
    await runtime.send("t", "make b");
    assert.equal(got.isError, false, got.text);
    assert.match(got.text, /finished the brief/);
    assert.match(got.text, /Wrote b\.txt with two lines/);
    assert.match(got.text, /Files changed \(measured\):\n- b\.txt: added, \+2 -0/);
    assert.match(got.text, /its own claim/);
    assert.equal(side.opened[0].sidekick, true);
    assert.match(side.opened[0].soul, /You are the sidekick/);
    assert.match(lead.opened[0].soul, /You lead this session/);
    assert.equal(side.opened[0].cwd, store.project("p").path);
    const row = rows(store.timeline("t"))[0];
    assert.equal(row.agent?.name, "Sidekick");
    assert.equal(row.agent?.model, SIDE);
    assert.equal(row.agent?.state, "done");
    assert.equal(row.agent?.report, "Wrote b.txt with two lines. Checks: none needed.");
    assert.deepEqual(row.agent?.files?.map((f) => f.path), ["b.txt"]);
    assert.deepEqual(row.agent?.steps?.map((s) => s.title), ["Write b.txt"]);
    assert.equal(row.agent?.brief, "Write b.txt with two lines.");
    assert.equal(rows(store.timeline("t")).length, 1, "the call's own row, not a second one");
    assert.equal(store.thread("t").sessions?.[`@${SIDE}`], "codex:side-1");
    assert.equal(store.thread("t").usage.costUsd, 0.01);
    assert.deepEqual(used.filter((u) => u.agent === "sidekick").map((u) => u.costUsd), [0.01]);
  } finally {
    side.restore();
    lead.restore();
  }
});

test("sidekick: a second call while one works waits its turn; never two at once", async () => {
  const side = fake("codex", async (_o, text, sink, signal) => {
    await nap(120, signal);
    sink.text(`did ${text}`);
  });
  const got: string[] = [];
  const lead = fake("claude", async (o, _t, sink) => {
    const [a, b] = await Promise.all([hand(tools, o, sink, "k1", { brief: "first" }), hand(tools, o, sink, "k2", { brief: "second" })]);
    got.push(a.text, b.text);
  });
  const { store, runtime, tools } = pair();
  try {
    await runtime.send("t", "two things");
    assert.equal(side.seen.most, 1);
    assert.match(got[0], /did first/);
    assert.match(got[1], /did second/);
    const two = rows(store.timeline("t"));
    assert.deepEqual(two.map((r) => r.agent?.brief), ["first", "second"]);
    assert.deepEqual(two.map((r) => r.agent?.report), ["did first", "did second"]);
  } finally {
    side.restore();
    lead.restore();
  }
});

test("sidekick: a brief takes the row of its own call, not one of a call refused before it, when the tool shows no input (Codex)", async () => {
  const side = fake("codex", writer);
  const lead = fake("claude", async (o, _t, sink) => {
    for (const [key, brief] of [["k1", ""], ["k2", "Write b.txt"]]) {
      sink.tool({ key, tool: "liner.sidekick", toolKind: "other", title: "Sidekick", status: "running" });
      const r = await tools.call(tools.threadOf(o.mcp!.env.LINER_SURFACE_KEY)!, "sidekick", { brief });
      sink.tool({ key, tool: "liner.sidekick", toolKind: "other", title: "Sidekick", status: r.isError ? "failed" : "done" });
    }
  });
  const { store, runtime, tools } = pair();
  try {
    await runtime.send("t", "go");
    const [refused, ran] = rows(store.timeline("t"));
    assert.equal(refused.status, "failed");
    assert.equal(refused.agent?.brief, undefined);
    assert.equal(ran.agent?.brief, "Write b.txt");
    assert.equal(ran.agent?.state, "done");
  } finally {
    side.restore();
    lead.restore();
  }
});

test("sidekick: Stop on a waiting brief's row cancels it alone; it never starts, and says so", async () => {
  const side = fake("codex", async (_o, text, sink, signal) => {
    await nap(300, signal);
    sink.text(`did ${text}`);
  });
  const got: string[] = [];
  const lead = fake("claude", async (o, _t, sink) => {
    const [a, b] = await Promise.all([hand(tools, o, sink, "k1", { brief: "first" }), hand(tools, o, sink, "k2", { brief: "second" })]);
    got.push(a.text, b.text);
  });
  const { store, runtime, tools } = pair();
  try {
    const going = runtime.send("t", "two things");
    await until(() => rows(store.timeline("t"))[1]?.agent?.now === "Waiting for the brief before this one", "the second waits in line");
    assert.equal(await runtime.stopAgent("t", rows(store.timeline("t"))[1].id), true);
    await going;
    assert.match(got[0], /did first/);
    assert.equal(got[1], "The brief was stopped before the sidekick (gpt-6-luna) started on it: nothing was done, and no file changed.");
    assert.equal(side.opened.length, 1);
    assert.equal(side.seen.stopped, 0, "the one at work went on");
    const [first, second] = rows(store.timeline("t"));
    assert.equal(first.agent?.state, "done");
    assert.equal(second.agent?.state, "stopped");
    assert.equal(second.agent?.report, "Stopped before it started.");
  } finally {
    side.restore();
    lead.restore();
  }
});

test("sidekick: a call outside a running turn of the lead is refused, with a sentence that says why", async () => {
  const side = fake("codex", writer);
  const { runtime, tools } = pair();
  try {
    const r = await runtime.delegate("t", { brief: "anything" });
    assert.equal(r.isError, true);
    assert.match(r.text, /only takes a brief while you work a turn/);
    const key = tools.serverFor("t", { pair: true })!.env.LINER_SURFACE_KEY;
    const via = await tools.call(tools.threadOf(key)!, "sidekick", { brief: "anything" });
    assert.equal(via.isError, true);
    assert.equal(side.opened.length, 0);
  } finally {
    side.restore();
  }
});

test("sidekick: the session's Stop stops both; Stop on the row stops only the sidekick", async () => {
  const side = fake("codex", async (_o, _t, sink, signal) => {
    sink.tool({ key: "s", tool: "Bash", toolKind: "exec", title: "Run a long build", status: "running" });
    await nap(60_000, signal);
  });
  let said = "";
  let after = false;
  const lead = fake("claude", async (o, _t, sink, signal) => {
    said = (await hand(tools, o, sink, "k1", { brief: "build it" })).text;
    await nap(5, signal);
    after = true;
  });
  const { store, runtime, tools } = pair();
  try {
    // The row's Stop: the sidekick ends, the lead hears how far it got and goes on.
    const going = runtime.send("t", "go");
    await until(() => side.seen.now === 1 && rows(store.timeline("t"))[0]?.agent?.taskId !== undefined, "the sidekick works");
    const row = rows(store.timeline("t"))[0];
    assert.equal(await runtime.stopAgent("t", row.id), true);
    await going;
    assert.match(said, /^The person stopped the sidekick \(gpt-6-luna\) after/);
    assert.match(said, /This is what it did so far/);
    assert.equal(after, true, "the lead carried on");
    assert.equal(side.seen.stopped, 1);
    assert.equal(rows(store.timeline("t"))[0].agent?.state, "stopped");
    assert.equal(store.timeline("t").findLast((x) => x.kind === "turn")?.kind === "turn" && store.timeline("t").findLast((x) => x.kind === "turn")!.status, "done");

    // The session's Stop: both end.
    after = false;
    const again = runtime.send("t", "go again");
    await until(() => side.seen.now === 1, "the sidekick works again");
    runtime.stop("t");
    await again;
    assert.equal(side.seen.stopped, 2);
    assert.equal(after, false, "the lead stopped too");
    const turn = store.timeline("t").findLast((x) => x.kind === "turn");
    assert.equal(turn?.kind === "turn" && turn.status, "stopped");
    assert.equal(rows(store.timeline("t")).at(-1)?.agent?.state, "stopped");
  } finally {
    side.restore();
    lead.restore();
  }
});

test("sidekick: a brief that runs past the cap is stopped, and the lead is told what was done so far", async () => {
  const side = fake("codex", async (o, _t, sink, signal) => {
    writeFileSync(join(o.cwd, "half.txt"), "half\n");
    sink.text("Half way.");
    await nap(60_000, signal);
  });
  let said = "";
  const lead = fake("claude", async (o, _t, sink) => {
    said = (await hand(tools, o, sink, "k1", { brief: "a long one" })).text;
  });
  const { runtime, tools } = pair();
  // Long enough for the snapshot before it under a loaded full run: a cap that fires during it ends the brief unstarted.
  runtime.sidekickMs = 1500;
  try {
    await runtime.send("t", "go");
    assert.match(said, /cap for one brief/);
    assert.match(said, /Half way\./);
    assert.match(said, /- half\.txt: added/);
  } finally {
    side.restore();
    lead.restore();
  }
});

test("sidekick: in a Read only session its sidekick works read only, and an edit comes to the person as the lead's would", async () => {
  let asked: Promise<{ allow: boolean }> | undefined;
  const side = fake("codex", async (_o, _t, sink, signal) => {
    asked = sink.approve({ key: "e", tool: "Edit", title: "Edit a.txt", risk: "low", fields: [], rule: "Edit" }, signal);
    await asked;
  });
  const lead = fake("claude", async (o, _t, sink) => void (await hand(tools, o, sink, "k1", { brief: "edit a.txt" })));
  const { store, runtime, tools } = pair({ access: "read" });
  try {
    const going = runtime.send("t", "edit");
    await until(() => store.timeline("t").some((x) => x.kind === "approval" && x.state === "asking"), "the edit came to the person as a card");
    assert.equal(side.opened[0].access, "read");
    const card = store.timeline("t").find((x) => x.kind === "approval")!;
    runtime.answer("t", card.id, false);
    assert.equal((await asked!).allow, false);
    await going;
  } finally {
    side.restore();
    lead.restore();
  }
});

test("sidekick: the tool is only a pair's lead's; a session with none gets it by its next turn, and the sidekick never does", async () => {
  const side = fake("codex", async (o, _t, sink) => {
    // The sidekick can't hand work on, even if it calls the tool anyway.
    const r = await tools.call(tools.threadOf(o.mcp!.env.LINER_SURFACE_KEY)!, "sidekick", { brief: "more" });
    sink.text(r.content[0].type === "text" ? r.content[0].text : "");
  });
  const lead = fake("claude", async (o, _t, sink) => {
    if (o.mcp?.env[PAIR_ENV] === "1") await hand(tools, o, sink, "k1", { brief: "try" });
  });
  const { store, runtime, tools } = pair({ sidekick: undefined });
  try {
    await runtime.send("t", "one");
    assert.equal(lead.opened[0].mcp?.env[PAIR_ENV], undefined);
    assert.ok(!toolsFor(lead.opened[0].mcp!.env).some((x) => x.name === "sidekick"));
    assert.doesNotMatch(lead.opened[0].soul, /sidekick/i);
    const refused = await tools.call(tools.threadOf(lead.opened[0].mcp!.env.LINER_SURFACE_KEY)!, "sidekick", { brief: "x" });
    assert.equal(refused.isError, true);

    store.patchThread("t", { sidekick: SIDE, providerSession: "claude:lead-1" });
    await runtime.send("t", "two");
    assert.equal(lead.opened.length, 2, "reopened for its new tools");
    assert.equal(lead.opened[1].resume, "lead-1", "resuming where it was");
    assert.equal(lead.opened[1].mcp?.env[PAIR_ENV], "1");
    assert.ok(toolsFor(lead.opened[1].mcp!.env).some((x) => x.name === "sidekick"));
    assert.equal(side.opened[0].mcp?.env[PAIR_ENV], undefined);
    assert.ok(!toolsFor(side.opened[0].mcp!.env).some((x) => x.name === "sidekick"));
    assert.match(rows(store.timeline("t"))[0].agent?.report ?? "", /You are the sidekick here/);

    // A side chat of a pair only reads: no tool.
    store.putThread({ ...store.thread("t"), id: "side", sideOf: "t", sideFrom: 2, turns: 2 });
    await runtime.send("side", "what happened?");
    assert.equal(lead.opened.at(-1)!.mcp?.env[PAIR_ENV], undefined);
  } finally {
    side.restore();
    lead.restore();
  }
});

test("sidekick: its use counts toward the spending cap, which stops the lead and it both", async () => {
  const side = fake("codex", async (_o, _t, sink, signal) => {
    sink.usage({ inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, costUsd: 2 });
    await nap(60_000, signal);
  });
  const lead = fake("claude", async (o, _t, sink) => void (await hand(tools, o, sink, "k1", { brief: "spend" })));
  const { store, runtime, tools } = pair();
  store.setSettings({ capUsd: 1 });
  try {
    await runtime.send("t", "go");
    assert.equal(side.seen.stopped, 1);
    assert.equal(store.thread("t").usage.costUsd, 2);
    assert.ok(store.timeline("t").some((x) => x.kind === "notice" && /past its \$1\.00 cap/.test(x.text)));
    const turn = store.timeline("t").findLast((x) => x.kind === "turn");
    assert.equal(turn?.kind === "turn" && turn.status, "stopped");
  } finally {
    side.restore();
    lead.restore();
  }
});

test("sidekick: it keeps its own session from brief to brief and across a restart; fresh starts it over", async () => {
  const side = fake("codex", writer);
  const lead = fake("claude", async (o, text, sink) => void (await hand(tools2 ?? tools, o, sink, "k1", { brief: "again", fresh: text === "fresh" })));
  let tools2: AgentTools | undefined;
  const first = pair();
  const { tools } = first;
  try {
    await first.runtime.send("t", "one");
    assert.equal(side.opened[0].resume, undefined);
    assert.equal(first.store.thread("t").sessions?.[`@${SIDE}`], "codex:side-1");
    // Liner Code restarts: the next brief resumes the sidekick's session.
    first.runtime.shutdown();
    const second = pair({}, first.home);
    tools2 = second.tools;
    await second.runtime.send("t", "two");
    assert.equal(side.opened.at(-1)!.resume, "side-1");
    await second.runtime.send("t", "fresh");
    assert.equal(side.opened.at(-1)!.resume, undefined);
    second.runtime.shutdown();
  } finally {
    side.restore();
    lead.restore();
  }
});

test("sidekick: the Demo leads a pair end to end: it hands the change over, its sidekick works it in steps, and it reads the measured diff", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-sk-demo-"));
  const dir = await ensureSampleProject(home);
  const store = new Store(home);
  store.putProject({ id: "p", name: "Sample", path: dir, git: true, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Demo", agent: "@demo:demo", sidekick: "demo:demo", status: "idle", access: "full", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() });
  const tools = new AgentTools(store, process.env);
  const runtime = new Runtime(store, process.env, tools);
  tools.host = runtime;
  // The engine's /surface, as main.ts serves it.
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      let call: { tool: string; args: Record<string, unknown> };
      try {
        call = JSON.parse(body);
      } catch {
        console.log("ODD", req.method, req.url, JSON.stringify(req.headers), body);
        return void res.end("{}");
      }
      const { tool, args } = call;
      const threadId = tools.threadOf(String(req.headers["x-liner-surface"]));
      res.end(JSON.stringify(threadId ? { ok: true, result: await tools.call(threadId, tool, args) } : { ok: false, error: "no key" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  tools.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await runtime.send("t", "Fix the tide time after midnight");
    const row = rows(store.timeline("t"))[0];
    assert.equal(row.tool, "mcp__liner__sidekick");
    assert.equal(row.agent?.state, "done", JSON.stringify(row));
    assert.deepEqual(row.agent?.steps?.map((s) => s.title), ["Read src/tides.js", "Search for nextHigh(", "Edit src/tides.js", "Run npm test"]);
    assert.deepEqual(row.agent?.files?.map((f) => f.path), ["src/tides.js"]);
    assert.match(row.output ?? "", /Files changed \(measured\):\n- src\/tides\.js: modified/);
    assert.match(readFileSync(join(dir, "src/tides.js"), "utf8"), /tomorrow: true/);
    const said = store.timeline("t").filter((x) => x.kind === "text").map((x) => (x.kind === "text" ? x.text : "")).join("");
    assert.match(said, /I read its diff/);
    assert.equal(store.thread("t").status, "done");
  } finally {
    server.close();
    runtime.shutdown();
  }
});

test("sidekick: the words: a quicker sidekick gets prescriptive briefs, a frontier one lighter ones; the result is short and says it's a claim", () => {
  assert.match(leadRules("Luna", false), /be prescriptive/);
  assert.match(leadRules("Astra", true), /listen when it pushes back/);
  for (const rules of [leadRules("Luna", false), leadRules("Astra", true)]) {
    assert.match(rules, /By default, hand it any test, build or install run/, "handing over is the default, not a permission");
    assert.match(rules, /When the judgment is the deliverable .* do it yourself/);
    assert.match(rules, /Every brief says in done_when how it can tell it's done: the command to run and what it should show/);
    assert.match(rules, /A check it ran and reported needn't be run again unless/);
  }
  assert.match(sidekickRules("Opus 5.5"), /Opus 5\.5 leads it/);
  const r = sidekickResult({ how: "done", who: "Luna", seconds: 75, report: "Did it.", files: [] });
  assert.match(r, /^The sidekick \(Luna\) finished the brief in 1 min 15 s/);
  assert.match(r, /Files changed \(measured\): none\./);
  assert.match(sidekickResult({ how: "done", who: "x", seconds: 1, report: "", files: null }), /not measured/);
  assert.match(sidekickResult({ how: "agent", who: "x", seconds: 1, report: "", files: [], agent: "Run the tests" }), /^Liner Code stopped the sidekick \(x\) after 1 s: it tried to send an agent of its own \("Run the tests"\), and a sidekick may not\./);
});

test("sidekick: a lead whose tool waits less on a call than the cap gets a brief cut to fit, and is told the cap that held", async () => {
  const side = fake("codex", async (o, _t, sink, signal) => {
    writeFileSync(join(o.cwd, "half.txt"), "half\n");
    sink.text("Half way.");
    await nap(60_000, signal);
  });
  let said = "";
  const lead = fake("claude", async (o, _t, sink) => {
    said = (await hand(tools, o, sink, "k1", { brief: "a long one" })).text;
  });
  // As Hermes says from its config: it gives up on a call 1.5 s after it's made, so the brief gets half a second.
  let asked: NodeJS.ProcessEnv | undefined;
  providers.claude.toolWait = (env) => ((asked = env), BRIEF_MARGIN_MS + 500);
  const { runtime, tools } = pair();
  try {
    const t0 = Date.now();
    await runtime.send("t", "go");
    assert.ok(Date.now() - t0 < 20_000, "stopped at the tool's cap, not the 10 minutes");
    assert.ok(asked, "asked with the lead's environment");
    assert.match(said, /stopped the sidekick \(.*\) at 1 s, the cap for one brief here: your tool gives up on a call/);
    assert.match(said, /- half\.txt: added/);
  } finally {
    side.restore();
    lead.restore();
  }
});

test("sidekick: when the lead's tool won't wait long enough for any brief, none starts and the lead is told so", async () => {
  const side = fake("codex", async () => {});
  let r = { text: "", isError: false };
  const lead = fake("claude", async (o, _t, sink) => {
    r = await hand(tools, o, sink, "k1", { brief: "anything" });
  });
  providers.claude.toolWait = () => BRIEF_MARGIN_MS - 1;
  const { store, runtime, tools } = pair();
  try {
    await runtime.send("t", "go");
    assert.equal(r.isError, true);
    assert.match(r.text, /didn't start on it: nothing was done/);
    assert.equal(side.opened.length, 0, "the sidekick never opened");
    assert.equal(rows(store.timeline("t"))[0]?.agent?.state, "stopped");
  } finally {
    side.restore();
    lead.restore();
  }
});

test("sidekick: the cap for one brief from the lead's tool's wait", () => {
  assert.equal(briefCap(undefined), SIDEKICK_MS);
  assert.equal(briefCap(null), SIDEKICK_MS);
  assert.equal(briefCap(30 * 60_000), SIDEKICK_MS, "never more than the 10 minutes");
  assert.equal(briefCap(300_000), 300_000 - BRIEF_MARGIN_MS, "Hermes unset: its MCP call's 300 s, less the margin");
  assert.ok(briefCap(BRIEF_MARGIN_MS) <= 0, "no time for one");
  assert.match(sidekickResult({ how: "capped", who: "Luna", seconds: 600, report: "", files: [] }), /at the 10-minute cap for one brief/);
  assert.match(sidekickResult({ how: "capped", who: "Luna", seconds: 240, report: "", files: [], capMs: 240_000 }), /at 4 min, the cap for one brief here/);
  assert.match(sidekickResult({ how: "capped", who: "Luna", seconds: 90, report: "", files: [], capMs: 90_000 }), /at 1 min 30 s, the cap/);
});

test("sidekick: its tool is known by Hermes's name, and a Hermes lead is told that name and how to find it", () => {
  for (const name of ["mcp__liner__sidekick", "liner.sidekick", "liner_sidekick", "mcp__editor_liner_8c735fbc__sidekick"]) assert.ok(isSidekickTool(name), name);
  for (const name of ["mcp__editor_liner_zz__sidekick", "mcp__editor_github_8c735fbc__sidekick", "sidekick_x"]) assert.ok(!isSidekickTool(name), name);
  const rules = leadRules("Luna", false, linerName("hermes"));
  assert.match(rules, /mcp__editor_liner_<tag>__sidekick hands it/);
  assert.match(rules, /tool_search \("sidekick"\).*tool_call/);
  assert.doesNotMatch(leadRules("Luna", false, linerName("claude")), /tool_search|<tag>/, "only where the name has a tag");
  assert.match(toolsNote(linerName("hermes")), /^- mcp__editor_liner_<tag>__design_show shows/m);
  assert.match(toolsNote(linerName("hermes")), /find it with tool_search and call it through tool_call/);
  assert.doesNotMatch(toolsNote(linerName("codex")), /<tag>/);
});

test("sidekick: a turn that ends with its brief still at work waits for it to wind down: its last edits are in the turn's change, its use counted while the turn is held", async () => {
  let winding = false;
  const side = fake("codex", async (o, _t, sink, signal) => {
    sink.tool({ key: "s", tool: "Bash", toolKind: "exec", title: "Run a long build", status: "running" });
    await nap(60_000, signal).catch(() => {});
    // Told to stop, it takes a moment: one last write, its tokens, then it ends.
    winding = true;
    await tick(150);
    writeFileSync(join(o.cwd, "late.txt"), "late\n");
    sink.usage({ inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, costUsd: 0.5 });
    throw new Error("stopped");
  });
  const lead = fake("claude", async (o, _t, sink) => {
    // The lead's tool gives up on the call and its turn ends while the sidekick works.
    void hand(tools, o, sink, "k1", { brief: "build it" });
    await until(() => side.seen.now === 1, "the sidekick works");
  });
  const { store, runtime, tools, used } = pair();
  try {
    await runtime.send("t", "go");
    assert.equal(winding, true);
    const cp = store.timeline("t").findLast((x) => x.kind === "checkpoint");
    assert.ok(cp?.kind === "checkpoint" && cp.files.some((f) => f.path === "late.txt"), "the turn's change has the sidekick's last edit");
    assert.deepEqual(used.map((u) => u.agent), ["sidekick", LEAD], "its use is logged before the lead's turn lets go");
    assert.equal(store.thread("t").usage.costUsd, 0.5);
    assert.equal(rows(store.timeline("t"))[0].agent?.state, "stopped");
  } finally {
    side.restore();
    lead.restore();
  }
});

test("sidekick: a stopped brief that never answers can't hold the lead's turn past the bound", async () => {
  let release = () => {};
  const side = fake("codex", async () => {
    // Deaf to Stop until the test lets it go.
    await new Promise<void>((r) => (release = r));
  });
  const lead = fake("claude", async (o, _t, sink) => {
    void hand(tools, o, sink, "k1", { brief: "build it" });
    await until(() => side.seen.now === 1, "the sidekick works");
  });
  const { store, runtime, tools } = pair();
  runtime.briefWindMs = 100;
  try {
    const t0 = Date.now();
    await runtime.send("t", "go");
    assert.ok(Date.now() - t0 < 3000, "the turn ended at the bound");
    assert.equal(store.thread("t").status, "done");
  } finally {
    release();
    await until(() => side.seen.now === 0, "the sidekick ended");
    side.restore();
    lead.restore();
  }
});

test("sidekick: the first agent it tries to send of its own (Hermes's delegate_task) stops the brief; the row and the lead are told why, and a later brief still works", async () => {
  let tries = 0;
  let after = false;
  const side = fake("codex", async (o, text, sink, signal) => {
    if (text !== "look around") return void sink.text("Did it myself.");
    tries++;
    writeFileSync(join(o.cwd, "half.txt"), "half\n");
    sink.usage({ inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, costUsd: 0.25 });
    const agent = { name: "Subagent", task: "Find the callers", brief: "Find the callers", steps: [] };
    sink.tool({ key: "d#0", tool: "delegate_task", toolKind: "task", title: "Subagent: Find the callers", input: "Find the callers", status: "running", agent });
    // Its turn is stopped there: nothing after it runs.
    await nap(60_000, signal);
    after = true;
  });
  const said: string[] = [];
  const lead = fake("claude", async (o, text, sink) => void said.push((await hand(tools, o, sink, "k1", { brief: text === "again" ? "do it yourself" : "look around" })).text));
  const { store, runtime, tools, used } = pair();
  try {
    await runtime.send("t", "go");
    assert.equal(tries, 1);
    assert.equal(after, false, "stopped at the first agent");
    assert.equal(side.seen.stopped, 1);
    assert.match(said[0], /^Liner Code stopped the sidekick \(gpt-6-luna\) after .*: it tried to send an agent of its own \("Find the callers"\), and a sidekick may not\. This is what it had done\. If the brief is still needed, send it again and say to do the work itself\./);
    assert.doesNotMatch(said[0], /The person stopped/);
    assert.match(said[0], /- half\.txt: added/, "what it did so far is measured");
    const row = rows(store.timeline("t"))[0];
    assert.equal(row.agent?.state, "stopped");
    assert.deepEqual(row.agent?.steps?.map((s) => [s.title, s.status]), [["Stopped: it tried to send an agent of its own (Find the callers)", "failed"]]);
    assert.equal(row.agent?.report, "Stopped: a sidekick may not send agents of its own.");
    assert.equal(rows(store.timeline("t")).length, 1, "no row of its own for the agent it tried to send");
    assert.deepEqual(used.filter((u) => u.agent === "sidekick").map((u) => u.costUsd), [0.25], "its use is still logged");
    assert.match(side.opened[0].soul, /Don't send agents of your own/);
    // The next brief to the same sidekick works as usual.
    await runtime.send("t", "again");
    assert.match(said[1], /finished the brief/);
    assert.equal(rows(store.timeline("t"))[1].agent?.state, "done");
  } finally {
    side.restore();
    lead.restore();
  }
});
