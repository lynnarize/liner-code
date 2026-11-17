/*
  A command's output while it runs, from ACP agents that send it in _meta once the client says `terminal_output: true`
  (codex-acp, claude-agent-acp): the row fills in pieces, then ends on the exit; an agent that sends none of it shows what it
  did before. The agents are small Node scripts speaking ACP. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acpProvider } from "../src/providers/acp.ts";
import type { OpenOptions, ToolUpdate, TurnSink } from "../src/providers/types.ts";
import type { ProviderInfo } from "../../contracts/src/index.ts";
import { noLeaks } from "./leaks.ts";

noLeaks();

const opts = (extra: Partial<OpenOptions> = {}) => ({ cwd: mkdtempSync(join(tmpdir(), "lc-term-cwd-")), model: "default", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: "" }, ...extra }) as OpenOptions;
const live = () => new AbortController().signal;

function recorder() {
  const tools: ToolUpdate[] = [];
  const sink = {
    text: () => {}, reasoning: () => {}, tool: (u: ToolUpdate) => void tools.push(u), plan: () => {},
    approve: async () => ({ allow: true }), ask: async () => null, propose: async () => ({ approve: true }),
    usage: () => {}, session: () => {}, notice: () => {}, error: () => {}, limited: () => {},
  } as unknown as TurnSink;
  return { tools, sink };
}

/**
  An ACP agent whose prompt runs `prompt` (with `up(update)` for the call "c1", `wait(ms)`, and `caps`, what the client said it can
  do), then ends its turn. It logs every message it gets.
*/
function agent(prompt: string) {
  const dir = mkdtempSync(join(tmpdir(), "lc-term-"));
  const file = join(dir, "agent");
  const log = join(dir, "log.jsonl");
  writeFileSync(log, "");
  writeFileSync(file, `#!/usr/bin/env node
const fs = require("fs");
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let caps = {};
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    fs.appendFileSync(${JSON.stringify(log)}, line + "\\n");
    if (m.method === "initialize") { caps = m.params.clientCapabilities || {}; send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } }); }
    else if (m.method === "session/new") send({ id: m.id, result: { sessionId: "s-1" } });
    else if (m.method === "session/prompt") {
      const up = (u) => send({ method: "session/update", params: { sessionId: "s-1", update: { toolCallId: "c1", ...u } } });
      (async () => { ${prompt}; send({ id: m.id, result: { stopReason: "end_turn" } }); })();
    }
    else if (m.id !== undefined && m.method) send({ id: m.id, result: {} });
  }
});
`, { mode: 0o755 });
  const p = acpProvider("acp.fake" as ProviderInfo["id"], { label: "Fake", cmd: [file], login: "" });
  const s = p.open(opts({ env: { ...process.env } }));
  const read = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { s, read };
}

/** codex-acp's shape (src/thread.rs): terminal_info at the start, pieces on their own, terminal_exit with the end. */
const codexLike = (exit: number, also = "") => `
  if (caps._meta && caps._meta.terminal_output === true) {
    up({ sessionUpdate: "tool_call", title: "npm test", kind: "execute", status: "in_progress", rawInput: { command: "npm test" }, content: [{ type: "terminal", terminalId: "c1" }], _meta: { terminal_info: { terminal_id: "c1", cwd: "/x" } } });
    await wait(50);
    up({ sessionUpdate: "tool_call_update", _meta: { terminal_output: { terminal_id: "c1", data: "building\\n" } } });
    await wait(400);
    up({ sessionUpdate: "tool_call_update", _meta: { terminal_output: { terminal_id: "c1", data: "testing\\n" } } });
    await wait(400);
    up({ sessionUpdate: "tool_call_update", status: "completed", rawOutput: { exit_code: ${exit}, stdout: "building\\ntesting\\n" }, ${also} _meta: { terminal_exit: { terminal_id: "c1", exit_code: ${exit}, signal: null } } });
  }`;

test("acp terminal: the client says terminal_output in _meta, and a command's row fills in pieces, then ends on its exit", async () => {
  const { s, read } = agent(codexLike(2));
  const { tools, sink } = recorder();
  await s.turn("run the tests", sink, live());
  s.close();
  assert.deepEqual(read().find((m) => m.method === "initialize").params.clientCapabilities._meta, { terminal_output: true });
  const rows = tools.filter((u) => u.key === "c1");
  const outs = rows.map((u) => u.output ?? "");
  assert.ok(rows.some((u) => u.status === "running" && u.output === "building"), `the first piece shows while it runs: ${JSON.stringify(outs)}`);
  assert.ok(rows.some((u) => u.status === "running" && u.output === "building\ntesting"), `then the next, after it: ${JSON.stringify(outs)}`);
  const last = rows.at(-1)!;
  assert.equal(last.output, "building\ntesting\n[exit 2]", "the end: what it printed, then its exit code, and not the agent's record of the run");
  assert.equal(last.status, "failed", "an exit code other than 0 fails the row");
});

test("acp terminal: exit 0 is done with no code, and the same output again as content isn't shown twice", async () => {
  const fenced = JSON.stringify({ type: "content", content: { type: "text", text: "```sh\nbuilding\ntesting\n```\n" } });
  const { s } = agent(codexLike(0, `content: [${fenced}],`));
  const { tools, sink } = recorder();
  await s.turn("run the tests", sink, live());
  s.close();
  const last = tools.filter((u) => u.key === "c1").at(-1)!;
  assert.equal(last.status, "done");
  assert.equal(last.output, "building\ntesting");
});

test("acp terminal: a long log keeps only its end, and a command's end after its turn makes no row", async () => {
  const { s } = agent(`
    if (globalThis.second) up({ sessionUpdate: "tool_call_update", _meta: { terminal_exit: { terminal_id: "c1", exit_code: null, signal: null } } });
    else {
    up({ sessionUpdate: "tool_call", title: "make", kind: "execute", status: "in_progress", _meta: { terminal_info: { terminal_id: "c1" } } });
    for (let n = 0; n < 60; n++) up({ sessionUpdate: "tool_call_update", _meta: { terminal_output: { terminal_id: "c1", data: String(n % 10).repeat(999) + "\\n" } } });
    up({ sessionUpdate: "tool_call_update", status: "completed", _meta: { terminal_output: { terminal_id: "c1", data: "the end\\n" }, terminal_exit: { terminal_id: "c1", exit_code: 0, signal: null } } });
    globalThis.second = true;
    }`);
  const one = recorder();
  await s.turn("build it", one.sink, live());
  // Ended first, so a failed check below can't leave the agent running.
  const two = recorder();
  await s.turn("again", two.sink, live());
  s.close();
  const last = one.tools.filter((u) => u.key === "c1").at(-1)!;
  assert.ok(last.output!.startsWith("…"), "says it's only the end");
  assert.ok(last.output!.endsWith("9".repeat(999) + "\nthe end"));
  assert.ok(last.output!.length <= 20001, `bounded: ${last.output!.length}`);
  // The next turn hears only the end of that command's terminal (as claude-agent-acp ends a background one): its row was the last turn's.
  assert.deepEqual(two.tools, []);
});

test("acp terminal: an agent that sends none of it shows its command as before", async () => {
  const { s } = agent(`
    up({ sessionUpdate: "tool_call", title: "ls", kind: "execute", status: "in_progress", rawInput: { command: "ls" } });
    await wait(50);
    up({ sessionUpdate: "tool_call_update", status: "completed", rawOutput: { exit_code: 1 }, content: [{ type: "content", content: { type: "text", text: "\`\`\`sh\\na.txt\\n\`\`\`" } }], _meta: { is_mcp_tool_call: false } })`);
  const { tools, sink } = recorder();
  await s.turn("list", sink, live());
  s.close();
  const rows = tools.filter((u) => u.key === "c1");
  assert.deepEqual(rows.map((u) => [u.status, u.output]), [["running", undefined], ["done", "```sh\na.txt\n```"]]);
});

test("acp terminal: a stray end for a call this turn never had makes no row", async () => {
  const { s } = agent(`up({ sessionUpdate: "tool_call_update", _meta: { terminal_exit: { terminal_id: "c1", exit_code: null, signal: null } } })`);
  const { tools, sink } = recorder();
  await s.turn("hi", sink, live());
  s.close();
  assert.deepEqual(tools, []);
});
