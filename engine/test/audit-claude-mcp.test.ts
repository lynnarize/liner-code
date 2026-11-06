/*
  Claude Code's driver and the MCP servers, edge by edge: what a person's own ask rule still asks in
  Full access, a tool asked for before a turn Claude Code began has started, a process that dies or
  never answers, settings changed on a live session, a compaction, what a restart loses, and the
  odd lines an MCP server or an agent tool can be sent. Each test failed before its fix.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Question, Thread, Usage } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { askRuleNames, claude, claudeMcp, sdk, waits, withFiles } from "../src/providers/claude.ts";
import { acpModels } from "../src/providers/models.ts";
import { Outside } from "../src/outside-tools.ts";
import type { ApprovalRequest, OpenOptions, TurnSink, WakeTurn } from "../src/providers/types.ts";
import type { Store } from "../src/store.ts";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 300 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}

type Calls = { interrupts: number; stopped: string[]; backgrounded: string[]; models: unknown[]; modes: unknown[]; flags: Record<string, unknown>[]; closed: number };
type Stand = { sent: SDKUserMessage[]; emit: (m: unknown) => void; end: () => void; calls: Calls; options: Record<string, unknown> };
type Over = Record<string, unknown> & { lateReader?: boolean; init?: () => Promise<unknown> };

/** Stands in for the SDK's query(), as drivers.test.ts does; `over` replaces any method of the n-th query. Like the real one, a dead query's reader of its prompt stays on it. */
function standIn(over: (n: number) => Over = () => ({})) {
  const made: Stand[] = [];
  const saved = sdk.query;
  sdk.query = (({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Record<string, unknown> }) => {
    const out: unknown[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    const calls: Calls = { interrupts: 0, stopped: [], backgrounded: [], models: [], modes: [], flags: [], closed: 0 };
    const s: Stand = { sent: [], emit: (m) => (out.push(m), wake?.()), end: () => ((ended = true), wake?.()), calls, options };
    made.push(s);
    const { lateReader, init, ...methods } = over(made.length);
    const read = async () => {
      for await (const m of prompt) s.sent.push(m);
    };
    if (lateReader) setTimeout(() => void read(), 5);
    else void read();
    return {
      async *[Symbol.asyncIterator]() {
        while (!ended || out.length) {
          if (out.length) yield out.shift();
          else await new Promise<void>((r) => (wake = r));
        }
      },
      initializationResult: init ?? (async () => ({})),
      interrupt: async () => void calls.interrupts++,
      stopTask: async (id: string) => void calls.stopped.push(id),
      backgroundTasks: async (id: string) => (calls.backgrounded.push(id), true),
      setModel: async (m: unknown) => void calls.models.push(m),
      setPermissionMode: async (m: unknown) => void calls.modes.push(m),
      applyFlagSettings: async (f: Record<string, unknown>) => void calls.flags.push(f),
      setMcpServers: async () => ({ added: [], removed: [], errors: {} }),
      return: async () => ((ended = true), calls.closed++, wake?.(), { done: true, value: undefined }),
      ...methods,
    };
  }) as unknown as typeof sdk.query;
  return { made, restore: () => (sdk.query = saved) };
}

function recorder(answer: { allow: boolean; reason?: string } = { allow: true }) {
  const r = { text: "", notices: [] as { text: string; key?: string }[], plans: [] as { title: string; status: string }[][], errors: [] as string[], limits: [] as { message: string; until?: number }[], approvals: [] as ApprovalRequest[], asked: [] as Question[][], usage: [] as Partial<Usage>[], answers: null as Record<string, string> | null };
  const sink: TurnSink = {
    text: (d) => void (r.text += d),
    reasoning: () => {},
    tool: () => {},
    plan: (e) => void r.plans.push(e),
    approve: async (req) => (r.approvals.push(req), answer),
    ask: async (q) => (r.asked.push(q), r.answers),
    propose: async () => ({ approve: true }),
    usage: (u) => void r.usage.push(u),
    session: () => {},
    notice: (text, key) => void r.notices.push({ text, key }),
    error: (m) => void r.errors.push(m),
    limited: (message, until) => void r.limits.push({ message, until }),
  };
  return { r, sink };
}

const opts = (extra: Partial<OpenOptions> = {}): OpenOptions => ({ cwd: "/tmp", model: "claude-opus-5-5", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: "" }, ...extra });
const words = (uuid: string, t: string) => [
  { type: "stream_event", parent_tool_use_id: null, uuid, session_id: "s", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
  { type: "stream_event", parent_tool_use_id: null, uuid, session_id: "s", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } } },
];
const result = (extra: Record<string, unknown> = {}) => ({ type: "result", subtype: "success", is_error: false, result: "", num_turns: 1, duration_ms: 1, duration_api_ms: 1, stop_reason: null, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: {}, permission_denials: [], uuid: "r", session_id: "s", ...extra });
const started = (id: string, extra: Record<string, unknown> = {}) => ({ type: "system", subtype: "task_started", task_id: id, tool_use_id: `tu-${id}`, description: "work", task_type: "local_agent", uuid: "x", session_id: "s", ...extra });

type Ask = (name: string, input: Record<string, unknown>, o: Record<string, unknown>) => Promise<{ behavior: string; message?: string }>;
const askOf = (s: Stand) => s.options.canUseTool as Ask;
const askOptions = (extra: Record<string, unknown> = {}) => ({ signal: new AbortController().signal, toolUseID: "t1", ...extra });

/** A turn that's running, with your message delivered. */
async function running(made: Stand[], s: ReturnType<typeof claude.open>, sink: TurnSink, n = 0, signal = new AbortController().signal, files?: string[]) {
  const turn = s.turn("go", sink, signal, files);
  await until(() => made[n]?.sent.length === 1, "your message went");
  return { turn, mine: made[n].sent[0].uuid! };
}

const quick = async (work: () => Promise<void>, set: Partial<typeof waits>) => {
  const saved = { ...waits };
  Object.assign(waits, set);
  try {
    await work();
  } finally {
    Object.assign(waits, saved);
  }
};

// ————— Permissions —————

test("full access: what your own ask rule stopped still comes to you, with the tool's reason, and can't be allowed for good", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts({ access: "full" }));
    const { r, sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    const ask = askOf(made[0]);
    const plain = await ask("Bash", { command: "ls" }, askOptions());
    assert.equal(plain.behavior, "allow", "the rest of Full goes ahead");
    assert.equal(r.approvals.length, 0);
    const held = await ask("Bash", { command: "git push" }, askOptions({ matchedAskRule: { source: "userSettings", toolName: "Bash", ruleContent: "git push:*" }, decisionReason: "\u001b[33mPermission rule requires approval\u001b[0m" }));
    assert.equal(held.behavior, "allow", "you said yes on the card");
    assert.equal(r.approvals.length, 1, "it came to you");
    assert.equal(r.approvals[0].risk, "high", "no Reviewer, Auto or routine answers for you");
    assert.equal(r.approvals[0].rule, undefined, "no earlier or later \"don't ask again\" covers it");
    assert.equal(r.approvals[0].description, "Permission rule requires approval");
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    s.close();
  } finally {
    restore();
  }
});

test("full access: a plain ask rule comes to you, though Claude Code sends only its type and no matched rule", async () => {
  const { made, restore } = standIn(() => ({ listPermissionRules: async () => ({ state: { rules: [] } }) }));
  try {
    const s = claude.open(opts({ access: "full", mcp: { command: "node", args: ["mcp.ts"], env: {} } }));
    const { r, sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    const ask = askOf(made[0]);
    const rule = askOptions({ decisionReasonType: "rule" });
    await ask("Bash", { command: "echo hi > a.txt" }, rule);
    await ask("Write", { file_path: "/tmp/a.txt", content: "x" }, rule);
    await ask("Read", { file_path: "/tmp/a.txt" }, rule);
    await ask("mcp__liner__memory_add", {}, askOptions({ decisionReasonType: "rule", mcpServer: { name: "liner", source: "dynamic" } }));
    assert.deepEqual(r.approvals.map((a) => a.tool), ["Bash", "Write", "Read", "mcp__liner__memory_add"], "each came to you");
    assert.ok(r.approvals.every((a) => a.risk === "high" && a.rule === undefined), "and only you can answer it");
    // What Claude Code asks about with no rule of yours, by each of the types it sends then: Full goes ahead.
    await ask("Bash", { command: "npm test" }, askOptions({ decisionReasonType: "other", decisionReason: "This command requires approval" }));
    await ask("Bash", { command: "npm test && npm run build" }, askOptions({ decisionReasonType: "subcommandResults" }));
    await ask("Write", { file_path: "/elsewhere/a.txt" }, askOptions({ decisionReasonType: "workingDir" }));
    await ask("Write", { file_path: "/tmp/.claude/settings.json" }, askOptions({ decisionReasonType: "safetyCheck" }));
    await ask("WebFetch", { url: "https://example.com" }, askOptions());
    assert.equal(r.approvals.length, 4, "no card for any of them");
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    s.close();
  } finally {
    restore();
  }
});

test("full access: a command Claude Code leaves unmatched comes to you only when one of your rules names it", async () => {
  const rules = [
    { behavior: "ask", source: "userSettings", rule: "Bash(npm test)" },
    { behavior: "ask", source: "userSettings", rule: "Bash(make *)", notInEffect: true },
    { behavior: "allow", source: "userSettings", rule: "Bash(cargo *)" },
    { behavior: "deny", source: "userSettings", rule: "Bash(rm *)" },
  ];
  const { made, restore } = standIn(() => ({ listPermissionRules: async () => ({ state: { rules } }) }));
  try {
    const s = claude.open(opts({ access: "full" }));
    const { r, sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    const ask = askOf(made[0]);
    const compound = askOptions({ decisionReasonType: "subcommandResults" });
    await ask("Bash", { command: "npm test && npm run build" }, compound);
    await ask("Bash", { command: "FOO=1 npm test | cat" }, compound);
    await ask("Bash", { command: 'bash -c "npm test"' }, askOptions({ decisionReasonType: "other" }));
    assert.equal(r.approvals.length, 3, "each names your rule");
    assert.ok(r.approvals.every((a) => a.risk === "high" && a.rule === undefined));
    await ask("Bash", { command: "npm run lint && npm run build" }, compound);
    await ask("Bash", { command: "cargo test && make all" }, compound);
    await ask("Bash", { command: "curl example.com" }, askOptions({ decisionReasonType: "other" }));
    assert.equal(r.approvals.length, 3, "an allow rule, or one that isn't in force, asks nothing");
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    s.close();
  } finally {
    restore();
  }
});

test("when Claude Code can't list your rules, a compound command comes to you, and the rest of Full goes ahead", async () => {
  const cases: Over[] = [{ listPermissionRules: async () => Promise.reject(new Error("Unsupported control request subtype")) }, { listPermissionRules: () => new Promise(() => {}) }, {}];
  for (const over of cases) {
    await quick(
      async () => {
        const { made, restore } = standIn(() => over);
        try {
          const s = claude.open(opts({ access: "full" }));
          const { r, sink } = recorder();
          const { turn, mine } = await running(made, s, sink);
          const ask = askOf(made[0]);
          await ask("Bash", { command: "npm test" }, askOptions({ decisionReasonType: "other" }));
          assert.equal(r.approvals.length, 0);
          await ask("Bash", { command: "npm test && npm run build" }, askOptions({ decisionReasonType: "subcommandResults" }));
          assert.equal(r.approvals.length, 1);
          made[0].emit(result({ user_message_uuids: [mine] }));
          await turn;
          s.close();
        } finally {
          restore();
        }
      },
      { rules: 20 },
    );
  }
});

test("an ask rule that names a command: forms it can take, and what it doesn't reach", () => {
  const caught = (rule: string, command: string) => askRuleNames([rule], "Bash", command);
  assert.ok(caught("Bash", "anything at all"));
  assert.ok(caught("Bash(npm test)", "npm run build && npm test"));
  assert.ok(caught("Bash(npm test)", "npm  test --watch"), "extra spaces, and words after");
  assert.ok(caught("Bash(npm test)", 'cd sub; "npm" test'), "quotes are gone by the time it runs");
  assert.ok(caught("Bash(npm test)", "n\\pm test"), "and so are escapes");
  assert.ok(caught("Bash(npm test)", "$(npm test) | cat"));
  assert.ok(caught("Bash(npm test)", "/usr/local/bin/npm test"));
  assert.ok(caught("Bash(git push:*)", "ls; git push origin main"));
  assert.ok(caught("Bash(git push:*)", "ls; git push"));
  assert.ok(caught("Bash(echo *)", "npm test && echo"));
  assert.ok(caught("Bash(git * --force)", "ls && git push --force"));
  assert.ok(caught("Bash(foo*)", "ls && foobar"));
  assert.ok(caught("Bash(*)", "ls"));
  assert.ok(!caught("Bash(npm test)", "npm run test"));
  assert.ok(!caught("Bash(npm test)", "xnpm test"));
  assert.ok(!caught("Bash(ls)", "lsof -i && pwd"));
  assert.ok(!caught("Write", "npm test"), "another tool's rule");
  assert.ok(!caught("Bash(1+1)", "11"), "a rule's words are read as they are");
  assert.ok(!askRuleNames([], "Bash", "npm test"));
});

test("a project folder that's gone is said plainly, before Claude Code is started", async () => {
  const { made, restore } = standIn();
  const gone = join(tmpdir(), `lc-gone-${randomUUID()}`);
  try {
    const signal = new AbortController().signal;
    await assert.rejects(claude.open(opts({ cwd: gone })).turn("hi", recorder().sink, signal), new RegExp(`folder isn't there any more: ${gone}`));
    await assert.rejects(claude.open(opts({ cwd: gone, resume: "s1" })).turn("hi", recorder().sink, signal), /folder isn't there any more/);
    assert.equal(made.length, 0, "nothing started, so the SDK has no libc to blame");
  } finally {
    restore();
  }
});

test("an ask that says it mustn't be allowed for good offers no rule", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts({ access: "edits" }));
    const { r, sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    await askOf(made[0])("Bash", { command: "npm test" }, askOptions({ suppressAlwaysAllowRule: true }));
    assert.equal(r.approvals[0].rule, undefined);
    await askOf(made[0])("Bash", { command: "npm test" }, askOptions());
    assert.ok(r.approvals[1].rule, "an ordinary ask still can be");
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    s.close();
  } finally {
    restore();
  }
});

test("liner's tools go without a card only from Liner Code's own server", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts({ mcp: { command: "node", args: ["mcp.ts"], env: {} } }));
    const { r, sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    const ask = askOf(made[0]);
    await ask("mcp__liner__memory_add", {}, askOptions({ mcpServer: { name: "liner", source: "dynamic" } }));
    assert.equal(r.approvals.length, 0, "its own goes ahead");
    await ask("mcp__liner__memory_add", {}, askOptions({ mcpServer: { name: "liner", source: "project" } }));
    assert.equal(r.approvals.length, 1, "a project's server of that name is any other server");
    await ask("mcp__liner__memory_add", {}, askOptions({ matchedAskRule: { source: "userSettings", toolName: "mcp__liner__memory_add" } }));
    assert.equal(r.approvals.length, 2, "and your ask rule counts here too");
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    s.close();
  } finally {
    restore();
  }
});

test("a connection named liner can't take the place of Liner Code's own server", () => {
  const mcp = { command: "node", args: ["mcp.ts"], env: { LINER_SURFACE_KEY: "k" } };
  const out = claudeMcp({ mcp }, [{ name: "liner", http: { url: "https://x.example/mcp", headers: {} } }]);
  assert.deepEqual(out.liner, { type: "stdio", ...mcp });
  assert.deepEqual(out["liner-addon"], { type: "http", url: "https://x.example/mcp", headers: {} });
});

// ————— A turn Claude Code began by itself —————

/** A session whose turn ended, with Claude Code just begun on a turn of its own. */
async function woken(made: Stand[], n = 0) {
  const wakes: WakeTurn[] = [];
  const s = claude.open(opts({ wake: (w) => void wakes.push(w) }));
  const { sink } = recorder();
  const { turn, mine } = await running(made, s, sink, n);
  made[n].emit(result({ user_message_uuids: [mine] }));
  await turn;
  for (const m of words("w1", "Picking this up.")) made[n].emit(m);
  await until(() => wakes.length === 1, "the turn was offered");
  return { s, w: wakes[0] };
}

test("a turn Claude Code began asks before the runtime starts it: the ask waits for that turn", async () => {
  const { made, restore } = standIn();
  try {
    const { s, w } = await woken(made);
    let answer: { behavior: string } | undefined;
    void askOf(made[0])("Bash", { command: "rm tmp" }, askOptions()).then((a) => (answer = a));
    await tick(150);
    assert.equal(answer, undefined, "not turned down while the snapshot is taken");
    const { r, sink } = recorder();
    const ending = w.run(sink, new AbortController().signal);
    await until(() => answer !== undefined, "it was asked on the wake turn");
    assert.equal(answer!.behavior, "allow");
    assert.equal(r.approvals.length, 1);
    assert.equal(r.text, "Picking this up.", "what came first shows first");
    made[0].emit(result());
    await ending;
    s.close();
  } finally {
    restore();
  }
});

test("a held ask is turned down when the wake is cancelled, the session closes, or its call is cancelled", async () => {
  const { made, restore } = standIn();
  try {
    const one = await woken(made);
    const first = askOf(made[0])("Bash", { command: "ls" }, askOptions());
    await tick(5);
    one.w.cancel();
    assert.equal((await first).behavior, "deny");
    one.s.close();

    const two = await woken(made, 1);
    const second = askOf(made[1])("Bash", { command: "ls" }, askOptions());
    await tick(5);
    two.s.close();
    assert.equal((await second).behavior, "deny");

    const three = await woken(made, 2);
    const stop = new AbortController();
    const third = askOf(made[2])("Bash", { command: "ls" }, askOptions({ signal: stop.signal }));
    await tick(5);
    stop.abort();
    assert.equal((await third).behavior, "deny");
    three.s.close();
  } finally {
    restore();
  }
});

test("an ask just ahead of the words that wake the turn isn't turned down: the SDK hands them over apart", async () => {
  const { made, restore } = standIn();
  try {
    const wakes: WakeTurn[] = [];
    const s = claude.open(opts({ wake: (w) => void wakes.push(w) }));
    const { sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    let answer: { behavior: string } | undefined;
    void askOf(made[0])("Bash", { command: "ls" }, askOptions()).then((a) => (answer = a));
    for (const m of words("w1", "Back.")) made[0].emit(m);
    await until(() => wakes.length === 1, "offered");
    const held = recorder();
    const ending = wakes[0].run(held.sink, new AbortController().signal);
    await until(() => answer !== undefined, "asked");
    assert.equal(answer!.behavior, "allow");
    made[0].emit(result());
    await ending;
    s.close();
  } finally {
    restore();
  }
});

test("with no turn to come, an ask is still turned down, soon", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    const a = await askOf(made[0])("Bash", { command: "ls" }, askOptions());
    assert.equal(a.behavior, "deny");
    s.close();
  } finally {
    restore();
  }
});

test("a wake whose process died before it ran shows what came and ends: it doesn't open a new process and wait for good", async () => {
  const { made, restore } = standIn();
  try {
    const { s, w } = await woken(made);
    made[0].end();
    await tick(20);
    const { r, sink } = recorder();
    await Promise.race([w.run(sink, new AbortController().signal), tick(500).then(() => assert.fail("the turn never ended"))]);
    assert.equal(r.text, "Picking this up.");
    assert.equal(made.length, 1, "no process was opened for it");
    s.close();
  } finally {
    restore();
  }
});

// ————— A process that dies or doesn't answer —————

test("a resumed Claude Code that never says it's up ends the turn with words, and is closed", async () => {
  const { made, restore } = standIn(() => ({ init: () => new Promise(() => {}) }));
  try {
    await quick(async () => {
      const s = claude.open(opts({ resume: "s1" }));
      const { sink } = recorder();
      await assert.rejects(Promise.race([s.turn("go", sink, new AbortController().signal), tick(1000).then(() => assert.fail("it hung"))]), /didn't start/);
      assert.equal(made[0].sent.length, 0);
      s.close();
    }, { open: 30 });
  } finally {
    restore();
  }
});

test("Stop still lets go of a resume that's waiting", async () => {
  const { restore } = standIn(() => ({ init: () => new Promise(() => {}) }));
  try {
    const s = claude.open(opts({ resume: "s1" }));
    const { sink } = recorder();
    const stop = new AbortController();
    const turn = s.turn("go", sink, stop.signal);
    await tick(5);
    stop.abort();
    await quick(() => turn, { stop: 10 });
    s.close();
  } finally {
    restore();
  }
});

test("a process that died while idle leaves no reader to swallow your next message", async () => {
  const { made, restore } = standIn((n) => (n === 2 ? { lateReader: true } : {}));
  try {
    const s = claude.open(opts());
    const { sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    made[0].end();
    await tick(20);
    const next = s.turn("again", sink, new AbortController().signal);
    await until(() => made[1]?.sent.length === 1, "the message reached the new process");
    assert.equal(made[0].sent.length, 1, "not the dead one");
    made[1].emit(result({ user_message_uuids: [made[1].sent[0].uuid] }));
    await next;
    s.close();
  } finally {
    restore();
  }
});

test("a process replaced takes its running tasks with it: a steer doesn't wait on them, and Stop doesn't call them", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    made[0].emit(started("gone"));
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    made[0].end();
    await tick(20);
    const stop = new AbortController();
    const next = await running(made, s, sink, 1, stop.signal);
    await s.steer!("and this");
    assert.deepEqual(made[1].calls.backgrounded, [], "nothing to move to the background");
    stop.abort();
    assert.deepEqual(made[1].calls.stopped, [], "nothing of the dead process's to stop");
    made[1].emit(result({ user_message_uuids: [next.mine] }));
    await next.turn;
    s.close();
  } finally {
    restore();
  }
});

// ————— Connections —————

const ping = { name: "ping", stdio: { command: "node", args: ["ping.mjs"], env: {} } };

test("connections stalled when a turn starts: the turn goes, and says so", async () => {
  const { made, restore } = standIn(() => ({ setMcpServers: () => new Promise(() => {}) }));
  try {
    await quick(async () => {
      const s = claude.open(opts({ connections: [ping] }));
      const { r, sink } = recorder();
      const { turn, mine } = await running(made, s, sink);
      assert.ok(r.notices.some((n) => /ping|connection/i.test(n.text)), "it says they aren't there yet");
      made[0].emit(result({ user_message_uuids: [mine] }));
      await turn;
      s.close();
    }, { link: 20 });
  } finally {
    restore();
  }
});

test("connections changed on a live session: a stalled handover doesn't hold the caller for good", async () => {
  const { made, restore } = standIn(() => ({ setMcpServers: () => new Promise(() => {}) }));
  try {
    await quick(async () => {
      const s = claude.open(opts());
      const { r, sink } = recorder();
      const { turn, mine } = await running(made, s, sink);
      const done = await Promise.race([s.connect!([ping]), tick(500).then(() => "hung" as const)]);
      assert.equal(done, true, "the session stays: the handover may yet land");
      assert.ok(r.notices.some((n) => /ping|connection/i.test(n.text)));
      made[0].emit(result({ user_message_uuids: [mine] }));
      await turn;
      s.close();
    }, { link: 20 });
  } finally {
    restore();
  }
});

test("a handover that fails while a resume fails too raises nothing nobody catches", async () => {
  const stray: unknown[] = [];
  const catcher = (e: unknown) => void stray.push(e);
  process.on("unhandledRejection", catcher);
  const { restore } = standIn(() => ({ init: async () => Promise.reject(new Error("exited with code 1")), setMcpServers: async () => Promise.reject(new Error("closed")) }));
  try {
    const s = claude.open(opts({ resume: "s1", connections: [ping] }));
    const { sink } = recorder();
    await assert.rejects(s.turn("go", sink, new AbortController().signal), /exited/);
    await tick(20);
    assert.deepEqual(stray, []);
    s.close();
  } finally {
    process.off("unhandledRejection", catcher);
    restore();
  }
});

// ————— Settings on a live session —————

test("effort changes in place, and ultracode stays on with its level", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    assert.equal(await s.update!({ model: "claude-opus-5-5", effort: "high", access: "edits" }), true);
    assert.equal(await s.update!({ model: "claude-opus-5-5", effort: "ultracode", access: "edits" }), true);
    assert.equal(await s.update!({ model: "claude-opus-5-5", effort: "low", access: "edits" }), true);
    assert.deepEqual(made[0].calls.flags, [{ effortLevel: "high", ultracode: null }, { effortLevel: "xhigh", ultracode: true }, { effortLevel: "low", ultracode: null }]);
    s.close();
  } finally {
    restore();
  }
});

test("an effort that can't change in place reopens, unless that would kill background work", async () => {
  const { made, restore } = standIn(() => ({ applyFlagSettings: async () => Promise.reject(new Error("no such control request")) }));
  try {
    const s = claude.open(opts());
    const { sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    assert.equal(await s.update!({ model: "claude-opus-5-5", effort: "high", access: "edits" }), false, "nothing running: reopen");
    const t2 = s.turn("go", sink, new AbortController().signal);
    await until(() => made[0].sent.length === 2, "sent");
    made[0].emit(started("dev", { is_backgrounded: true, task_type: "local_bash" }));
    made[0].emit(result({ user_message_uuids: [made[0].sent[1].uuid] }));
    await t2;
    assert.equal(await s.update!({ model: "claude-opus-5-5", effort: "high", access: "edits" }), true, "the dev server stays up");
    const t3 = s.turn("go", sink, new AbortController().signal);
    await until(() => made[0].sent.length === 3, "sent");
    made[0].emit(result({ user_message_uuids: [made[0].sent[2].uuid] }));
    await t3;
    assert.equal(made.length, 1);
    s.close();
  } finally {
    restore();
  }
});

test("ultrathink is a word in the prompt: going to it on a live session doesn't kill background work either", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    assert.equal(await s.update!({ model: "claude-opus-5-5", effort: "ultrathink", access: "edits" }), false, "nothing running: reopen, as its level can't be cleared in place");
    made[0].emit(started("dev", { is_backgrounded: true, task_type: "local_bash" }));
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    assert.equal(await s.update!({ model: "claude-opus-5-5", effort: "ultrathink", access: "edits" }), true);
    s.close();
  } finally {
    restore();
  }
});

test("a model or a mode Claude Code refuses reopens the session instead of failing your turn", async () => {
  for (const method of ["setModel", "setPermissionMode"]) {
    const { made, restore } = standIn(() => ({ [method]: async () => Promise.reject(new Error("auto mode isn't available")) }));
    try {
      const s = claude.open(opts());
      const { sink } = recorder();
      const { turn, mine } = await running(made, s, sink);
      made[0].emit(result({ user_message_uuids: [mine] }));
      await turn;
      const next = method === "setModel" ? { model: "claude-haiku-5-5", effort: "medium" as const, access: "edits" as const } : { model: "claude-opus-5-5", effort: "medium" as const, access: "auto" as const };
      assert.equal(await s.update!(next), false, method);
      s.close();
    } finally {
      restore();
    }
  }
});

// ————— Results, limits and the meter —————

test("a limit said in a turn that was stopped doesn't hide the next turn's failure", async () => {
  const { made, restore } = standIn();
  try {
    await quick(async () => {
      const s = claude.open(opts());
      const { r, sink } = recorder();
      const stop = new AbortController();
      const { turn } = await running(made, s, sink, 0, stop.signal);
      made[0].emit({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour" }, uuid: "u", session_id: "s" });
      await until(() => r.limits.length === 1, "the limit was said");
      stop.abort();
      await turn;
      const next = s.turn("again", sink, new AbortController().signal);
      await until(() => made[0].sent.length === 2, "sent");
      made[0].emit(result({ subtype: "error_during_execution", is_error: true, errors: ["Something broke"], user_message_uuids: [made[0].sent[1].uuid] }));
      await next;
      assert.deepEqual(r.errors, ["Something broke"]);
      s.close();
    }, { stop: 10 });
  } finally {
    restore();
  }
});

test("a sign-in that failed earlier doesn't dress up a 403 as a login problem", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { r, sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    const cli = "Failed to authenticate. API Error: 403 Your organization does not have access to this model.";
    made[0].emit({ type: "assistant", error: "authentication_failed", parent_tool_use_id: null, uuid: "a", session_id: "s", message: { id: "m", model: "<synthetic>", content: [{ type: "text", text: cli }] } });
    made[0].emit(result({ is_error: true, result: cli, api_error_status: 403, terminal_reason: "api_error", user_message_uuids: [mine] }));
    await turn;
    assert.deepEqual(r.errors, [cli]);
    s.close();
  } finally {
    restore();
  }
});

test("a 401 still says to sign in", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { r, sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    made[0].emit({ type: "assistant", error: "authentication_failed", parent_tool_use_id: null, uuid: "a", session_id: "s", message: { id: "m", model: "<synthetic>", content: [] } });
    made[0].emit(result({ is_error: true, result: "API Error: 401 Credentials expired.", api_error_status: 401, terminal_reason: "api_error", user_message_uuids: [mine] }));
    await turn;
    assert.match(r.errors[0], /claude auth login/);
    s.close();
  } finally {
    restore();
  }
});

test("the meter stays at the size a compaction left, past the stale numbers around it", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { r, sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    const usage = { input_tokens: 25, output_tokens: 1, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 };
    made[0].emit({ type: "stream_event", parent_tool_use_id: null, uuid: "e", session_id: "s", event: { type: "message_start", message: { id: "m1", usage } } });
    made[0].emit({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 1075, post_tokens: 400 }, uuid: "b", session_id: "s" });
    made[0].emit({ type: "assistant", parent_tool_use_id: null, uuid: "a", session_id: "s", message: { id: "m1", model: "claude-opus-5-5", usage, content: [] } });
    made[0].emit({ type: "stream_event", parent_tool_use_id: null, uuid: "e2", session_id: "s", event: { type: "message_delta", usage: { input_tokens: null, output_tokens: 60 } } });
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    const meter = r.usage.flatMap((u) => (u.contextTokens === undefined ? [] : [u.contextTokens]));
    assert.equal(meter.at(-1), 400);
    s.close();
  } finally {
    restore();
  }
});

test("a compaction that gives no size leaves the meter alone", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { r, sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    made[0].emit({ type: "stream_event", parent_tool_use_id: null, uuid: "e", session_id: "s", event: { type: "message_start", message: { id: "m1", usage: { input_tokens: 900, output_tokens: 1 } } } });
    made[0].emit({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 900 }, uuid: "b", session_id: "s" });
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    assert.equal(r.usage.at(-1)?.contextTokens, undefined);
    s.close();
  } finally {
    restore();
  }
});

test("a gateway's 503 that carries a rate limit is a limit, with its reset time", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { r, sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    const before = Date.now();
    made[0].emit(result({ is_error: true, api_error_status: 503, terminal_reason: "api_error", result: 'API Error: 503 [gw] [429]: {"type":"error","error":{"type":"rate_limit_error","message":"slow down"}} (reset after 1h 30m)', user_message_uuids: [mine] }));
    await turn;
    assert.equal(r.errors.length, 0);
    assert.equal(r.limits.length, 1);
    const until = r.limits[0].until!;
    assert.ok(until >= before + 90 * 60_000 && until <= Date.now() + 90 * 60_000, "ninety minutes on");
    s.close();
  } finally {
    restore();
  }
});

// ————— Attachments —————

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const JPEG = Buffer.from("ffd8ffe000104a464946", "hex");

test("an image goes by what it is, not by its name: one named wrong would fail every later turn", () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-audit-"));
  const png = join(dir, "really-a-png.jpg");
  const jpeg = join(dir, "photo.jpg");
  writeFileSync(png, PNG);
  writeFileSync(jpeg, JPEG);
  const blocks = withFiles("hi", [png, jpeg], { bytes: 0, pages: 0 });
  assert.ok(Array.isArray(blocks));
  assert.deepEqual((blocks as { source?: { media_type: string } }[]).flatMap((b) => (b.source ? [b.source.media_type] : [])), ["image/png", "image/jpeg"]);
});

test("a file named like an image that isn't one, or is empty, goes by its path alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-audit-"));
  const fake = join(dir, "notes.png");
  const empty = join(dir, "empty.jpg");
  writeFileSync(fake, "just some words");
  writeFileSync(empty, "");
  assert.equal(withFiles("hi", [fake, empty], { bytes: 0, pages: 0 }), "hi");
});

test("after a reopen, the images a transcript already holds count against what Claude reads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-audit-"));
  const image = join(dir, "next.png");
  writeFileSync(image, PNG);
  const { made, restore } = standIn();
  const saved = sdk.getSessionMessages;
  const asked: [string, unknown][] = [];
  sdk.getSessionMessages = (async (id: string, o: unknown) => {
    asked.push([id, o]);
    return [
      { type: "user", message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "x".repeat(28 * 1024 * 1024) } }, { type: "text", text: "look" }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "I see" }] } },
    ];
  }) as unknown as typeof sdk.getSessionMessages;
  try {
    const s = claude.open(opts({ resume: "s1", cwd: dir }));
    const { sink } = recorder();
    const { turn, mine } = await running(made, s, sink, 0, undefined, [image]);
    assert.deepEqual(asked.map(([id, o]) => [id, (o as { dir: string }).dir]), [["s1", dir]]);
    assert.equal(made[0].sent[0].message.content, "go", "the budget is spent: the new one goes by its path");
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    s.close();
  } finally {
    sdk.getSessionMessages = saved;
    restore();
  }
});

test("the transcript of an account with its own config folder is read from there, by the SDK's real reader", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-audit-"));
  const config = mkdtempSync(join(tmpdir(), "lc-audit-config-"));
  const image = join(dir, "next.png");
  writeFileSync(image, PNG);
  const id = randomUUID();
  const [u1, u2] = [randomUUID(), randomUUID()];
  const line = (uuid: string, parentUuid: string | null, type: string, content: unknown) => JSON.stringify({ parentUuid, isSidechain: false, type, message: { role: type, content }, uuid, timestamp: "2026-11-06T00:00:00.000Z", sessionId: id });
  const big = { type: "image", source: { type: "base64", media_type: "image/png", data: "x".repeat(28 * 1024 * 1024) } };
  const project = join(config, "projects", realpathSync(dir).replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, `${id}.jsonl`), [line(u1, null, "user", [big, { type: "text", text: "look" }]), line(u2, u1, "assistant", [{ type: "text", text: "I see" }]), '{"half a li'].join("\n"));
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts({ resume: id, cwd: dir, env: { PATH: "", CLAUDE_CONFIG_DIR: config } }));
    const { sink } = recorder();
    const { turn, mine } = await running(made, s, sink, 0, undefined, [image]);
    assert.equal(made[0].sent[0].message.content, "go", "the budget is spent: the new one goes by its path");
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    s.close();
  } finally {
    restore();
  }
});

test("a turn with no files doesn't read the transcript, and one that can't be read changes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-audit-"));
  const image = join(dir, "next.png");
  writeFileSync(image, PNG);
  const { made, restore } = standIn();
  const saved = sdk.getSessionMessages;
  let reads = 0;
  sdk.getSessionMessages = (async () => {
    reads++;
    throw new Error("no such file");
  }) as unknown as typeof sdk.getSessionMessages;
  try {
    const s = claude.open(opts({ resume: "s1", cwd: dir }));
    const { sink } = recorder();
    const first = await running(made, s, sink);
    made[0].emit(result({ user_message_uuids: [first.mine] }));
    await first.turn;
    assert.equal(reads, 0);
    const next = s.turn("look", sink, new AbortController().signal, [image]);
    await until(() => made[0].sent.length === 2, "sent");
    assert.ok(Array.isArray(made[0].sent[1].message.content), "the image goes");
    assert.equal(reads, 1);
    made[0].emit(result({ user_message_uuids: [made[0].sent[1].uuid] }));
    await next;
    s.close();
  } finally {
    sdk.getSessionMessages = saved;
    restore();
  }
});

test("reading a file you attached asks nothing, wherever it's saved; a file beside that folder still asks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-audit-"));
  const notes = join(dir, "attachments", "t1", "notes.txt");
  mkdirSync(join(dir, "attachments", "t1"), { recursive: true });
  writeFileSync(notes, "words");
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts({ access: "ask" }));
    const { r, sink } = recorder();
    const { turn, mine } = await running(made, s, sink, 0, undefined, [notes]);
    const ask = askOf(made[0]);
    assert.equal((await ask("Read", { file_path: notes }, askOptions())).behavior, "allow");
    assert.equal(r.approvals.length, 0);
    await ask("Read", { file_path: join(dir, "attachments", "t1", "..", "secret.txt") }, askOptions());
    assert.equal(r.approvals.length, 1, "outside it asks");
    await ask("Write", { file_path: notes, content: "x" }, askOptions());
    assert.equal(r.approvals.length, 2, "only reading");
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    s.close();
  } finally {
    restore();
  }
});

// ————— A running command's output —————

test("live output: a character cut between reads stays whole, and a file rewritten is read again", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "lc-audit-tail-"));
  const dir = join(tmp, `claude-${process.getuid!()}`, "proj", "s", "tasks");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "b1.output");
  writeFileSync(file, "");
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts({ env: { PATH: "", CLAUDE_CODE_TMPDIR: tmp } }));
    const seen: string[] = [];
    const { sink } = recorder();
    sink.tool = (u) => void (u.output && seen.push(u.output));
    const { turn, mine } = await running(made, s, sink);
    made[0].emit({ type: "assistant", parent_tool_use_id: null, uuid: "a", session_id: "s", message: { id: "m", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "make" } }] } });
    made[0].emit({ type: "system", subtype: "task_started", task_id: "b1", tool_use_id: "tu1", description: "make", task_type: "local_bash", uuid: "x", session_id: "s" });
    const bytes = Buffer.from("héllo");
    await tick(30);
    await appendFile(file, bytes.subarray(0, 2));
    await until(() => seen.length >= 1, "first read");
    await appendFile(file, bytes.subarray(2));
    await until(() => seen.length >= 2, "second read");
    assert.equal(seen.at(-1), "héllo");
    writeFileSync(file, "again");
    await until(() => seen.at(-1)?.includes("again") === true, "read after it was rewritten");
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    s.close();
  } finally {
    restore();
  }
});

// ————— The task list across a restart —————

test("after a restart, a task update finds its list in what Claude Code keeps on disk", async () => {
  const config = mkdtempSync(join(tmpdir(), "lc-audit-config-"));
  const dir = join(config, "tasks", "s1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "1.json"), JSON.stringify({ id: "1", subject: "Inspect", status: "completed" }));
  writeFileSync(join(dir, "2.json"), JSON.stringify({ id: "2", subject: "Implement", status: "in_progress" }));
  writeFileSync(join(dir, "3.json"), JSON.stringify({ id: "3", subject: "Internal", status: "pending", metadata: { _internal: true } }));
  writeFileSync(join(dir, "4.json"), "{");
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts({ resume: "s1", env: { PATH: "", CLAUDE_CONFIG_DIR: config } }));
    const { r, sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    made[0].emit({ type: "assistant", parent_tool_use_id: null, uuid: "a", session_id: "s1", message: { id: "m", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "tu1", name: "TaskUpdate", input: { taskId: "2", status: "in_progress" } }] } });
    made[0].emit({ type: "user", parent_tool_use_id: null, uuid: "u", session_id: "s1", tool_use_result: { success: true, taskId: "2" }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "Updated task #2 status" }] } });
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    assert.deepEqual(r.plans.at(-1), [{ title: "Inspect", status: "completed" }, { title: "Implement", status: "in_progress" }]);
    s.close();
  } finally {
    restore();
  }
});

// ————— An MCP server that asks —————

const elicit = (s: Stand) => s.options.onElicitation as (q: Record<string, unknown>, o: { signal: AbortSignal }) => Promise<{ action: string; content?: unknown }>;

test("an MCP server's form with choices comes as a question card, and its answer goes back typed", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { r, sink } = recorder();
    r.answers = { "Which environment?": "staging", "Deploy now?": "Yes" };
    const { turn, mine } = await running(made, s, sink);
    const a = await elicit(made[0])(
      {
        serverName: "deploy",
        message: "Where to?",
        mode: "form",
        requestedSchema: { type: "object", required: ["env"], properties: { env: { type: "string", title: "Which environment?", enum: ["staging", "production"] }, now: { type: "boolean", title: "Deploy now?" } } },
      },
      { signal: new AbortController().signal },
    );
    assert.deepEqual(a, { action: "accept", content: { env: "staging", now: true } });
    assert.deepEqual(r.asked[0].map((q) => q.question), ["Which environment?", "Deploy now?"]);
    assert.equal(r.asked[0][0].header, "deploy");
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    s.close();
  } finally {
    restore();
  }
});

test("an MCP server that only wants a yes gets the approval card; a skipped question declines; a form Liner can't show declines without asking", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { r, sink } = recorder({ allow: true });
    const { turn, mine } = await running(made, s, sink);
    const signal = new AbortController().signal;
    assert.deepEqual(await elicit(made[0])({ serverName: "deploy", message: "Go ahead?", mode: "form", requestedSchema: { type: "object", properties: {} } }, { signal }), { action: "accept", content: {} });
    assert.equal(r.approvals[0].title, "Go ahead?");
    assert.equal(r.approvals[0].rule, undefined, "each ask stands alone");
    assert.deepEqual(await elicit(made[0])({ serverName: "deploy", message: "Which?", mode: "form", requestedSchema: { type: "object", properties: { env: { type: "string", enum: ["a", "b"] } } } }, { signal }), { action: "decline" });
    assert.deepEqual(await elicit(made[0])({ serverName: "deploy", message: "Your name?", mode: "form", requestedSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } } }, { signal }), { action: "decline" });
    assert.deepEqual(await elicit(made[0])({ serverName: "deploy", message: "Sign in", mode: "url", url: "https://x.example" }, { signal }), { action: "decline" });
    assert.equal(r.asked.length, 1, "only the form it could show was asked");
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    s.close();
  } finally {
    restore();
  }
});

test("with no turn running, what an MCP server asks is declined", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts());
    const { sink } = recorder();
    const { turn, mine } = await running(made, s, sink);
    made[0].emit(result({ user_message_uuids: [mine] }));
    await turn;
    assert.deepEqual(await elicit(made[0])({ serverName: "x", message: "ok?", mode: "form", requestedSchema: { type: "object", properties: {} } }, { signal: new AbortController().signal }), { action: "decline" });
    s.close();
  } finally {
    restore();
  }
});

// ————— The stdio servers —————

async function speak(script: string, lines: string[], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "ignore"] });
  const got: Record<string, unknown>[] = [];
  createInterface({ input: child.stdout }).on("line", (l) => void got.push(JSON.parse(l) as Record<string, unknown>));
  let exit: number | null | undefined;
  child.on("exit", (c) => (exit = c));
  child.stdin.on("error", () => {});
  for (const l of lines) child.stdin.write(`${l}\n`);
  await until(() => got.some((m) => m.id === 9) || exit !== undefined, "an answer or an exit");
  child.kill();
  return got;
}

for (const script of ["../src/mcp.ts", "../src/outside.ts"]) {
  test(`${script.slice(7)}: a line that's valid JSON but no message doesn't bring the server down`, async () => {
    const got = await speak(script, ["null", "3", '"x"', "[]", '{"jsonrpc":"2.0","id":9,"method":"ping"}']);
    assert.deepEqual(got, [{ jsonrpc: "2.0", id: 9, result: {} }]);
  });
}

test("liner_send: an empty message isn't sent, and one to a session waiting on you says it waits", async () => {
  const thread = (status: Thread["status"]) => ({ id: "t", projectId: "p", title: "Work", agent: "a", status, access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 }) as Thread;
  const calls: unknown[] = [];
  const store = { home: tmpdir(), projects: [], threads: [thread("waiting")], settings: {}, timeline: () => [] } as unknown as Store;
  const outside = new Outside(store, { call: async (m, p) => void calls.push([m, p]) });
  const empty = await outside.call("liner_send", { session: "t", message: "   " });
  assert.equal(empty.isError, true);
  assert.deepEqual(calls, []);
  const sent = await outside.call("liner_send", { session: "t", message: "and this" });
  assert.deepEqual(calls, [["thread.send", { id: "t", text: "and this", mode: undefined }]]);
  assert.match((sent.content[0] as { text: string }).text, /waiting on the person/);
});

test("liner_wait doesn't take the moment before a turn begins for the turn being over", async () => {
  const t = { id: "t", projectId: "p", title: "Work", agent: "a", status: "done", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 } as Thread;
  const store = { home: tmpdir(), projects: [], threads: [t], settings: {}, timeline: () => [] } as unknown as Store;
  const outside = new Outside(store, { call: async () => null });
  await outside.call("liner_send", { session: "t", message: "and this" });
  setTimeout(() => Object.assign(t, { status: "running", turns: 2 }), 1300);
  setTimeout(() => Object.assign(t, { status: "done" }), 1500);
  const r = await outside.call("liner_wait", { session: "t", seconds: 5 });
  assert.match((r.content[0] as { text: string }).text, /2 turns/);
  // One that never starts lets go when the wait is up.
  await outside.call("liner_send", { session: "t", message: "again" });
  const start = Date.now();
  await outside.call("liner_wait", { session: "t", seconds: 1 });
  assert.ok(Date.now() - start >= 900);
});

// ————— An ACP tool's models —————

function tool(script: string) {
  const dir = mkdtempSync(join(tmpdir(), "lc-audit-acp-"));
  const path = join(dir, "fake-acp");
  writeFileSync(path, `#!${process.execPath}\n${script}`);
  chmodSync(path, 0o755);
  return { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, scratch: join(dir, "scratch") };
}

test("an ACP tool that exits at once gives no models straight away, with no stray pipe error", async () => {
  const { env, scratch } = tool("process.exit(1)");
  const stray: unknown[] = [];
  const catcher = (e: unknown) => void stray.push(e);
  process.on("uncaughtException", catcher);
  try {
    const start = Date.now();
    assert.deepEqual(await acpModels(["fake-acp"], "Fake", env, scratch), []);
    assert.ok(Date.now() - start < 5000, "not the whole 45 seconds");
    await tick(50);
    assert.deepEqual(stray, []);
  } finally {
    process.off("uncaughtException", catcher);
  }
});

const acpReply = (body: string) => `
const rl = require("node:readline").createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n");
rl.on("line", (l) => {
  const m = JSON.parse(l);
  if (m.method === "initialize") send({ id: m.id, result: {} });
  if (m.method === "session/new") { ${body.includes("ASK") ? 'send({ id: m.id, method: "fs/read_text_file", params: {} });' : ""} send({ id: m.id, result: ${body.replace("ASK", "")} }); }
});`;

test("a request from an ACP tool isn't taken for the answer to ours", async () => {
  const { env, scratch } = tool(acpReply('ASK{ models: { currentModelId: "m1", availableModels: [{ modelId: "m1", name: "One" }] } }'));
  const models = await acpModels(["fake-acp"], "Fake", env, scratch);
  assert.deepEqual(models.map((m) => m.id), ["default", "m1"]);
});

test("an ACP tool's model option may group its choices", async () => {
  const body = JSON.stringify({ configOptions: [{ id: "model", category: "model", currentValue: "m2", options: [{ group: "fast", name: "Fast", options: [{ value: "m1", name: "One" }] }, { group: "deep", name: "Deep", options: [{ value: "m2", name: "Two" }] }] }] });
  const { env, scratch } = tool(acpReply(body));
  const models = await acpModels(["fake-acp"], "Fake", env, scratch);
  assert.deepEqual(models.map((m) => m.id), ["default", "m1", "m2"]);
});
