/*
  Codex's access table, pinned: each of Liner Code's six access levels is the sandbox and approval policy the app server is told,
  both as the thread opens and with each turn. A stand-in Codex logs what it is sent. Run with
  `node --test engine/test/codex-access.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexServerSession } from "../src/providers/codex-server.ts";
import type { OpenOptions, TurnSink } from "../src/providers/types.ts";
import { noLeaks } from "./leaks.ts";

noLeaks();

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string, ms = 5000) {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await tick(20);
  assert.ok(ok(), what);
}
const opts = (extra: Partial<OpenOptions> = {}) => ({ cwd: tmpdir(), model: "default", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: process.env.PATH ?? "" }, ...extra }) as OpenOptions;
function recorder() {
  const r = { text: "", notices: [] as string[], errors: [] as string[], sessions: [] as string[], tools: [] as { key: string; status?: string; output?: string }[] };
  const sink = {
    text: (d: string) => void (r.text += d), reasoning: () => {}, tool: (u: { key: string; status?: string; output?: string }) => void r.tools.push(u), plan: () => {},
    approve: async () => ({ allow: true }), ask: async () => null, propose: async () => ({ approve: true }),
    usage: () => {}, session: (id: string) => void r.sessions.push(id), notice: (m: string) => void r.notices.push(m), error: (m: string) => void r.errors.push(m), limited: () => {},
  } as unknown as TurnSink;
  return { r, sink };
}
/** A Node script at `name` that reads JSON lines and runs `on` for each (`m`), logging each to FAKE_LOG. */
function script(name: string, on: string) {
  const dir = mkdtempSync(join(tmpdir(), "lc-grace-"));
  const file = join(dir, name);
  writeFileSync(file, `#!/usr/bin/env node
const fs = require("fs");
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ pid: process.pid, ...m }) + "\\n");
    ${on}
  }
});
`, { mode: 0o755 });
  const log = join(dir, "log.jsonl");
  writeFileSync(log, "");
  const read = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { pid: number; method?: string; id?: number; params?: Record<string, unknown> });
  return { file, log, dir, read };
}

/** A Codex app server: the first thread's turn runs until it's interrupted; FAKE_FREEZE: it freezes (SIGSTOP) as it's asked. A thread resumed answers at once. */
const CODEX = `
switch (m.method) {
  case "initialize": send({ id: m.id, result: {} }); break;
  case "thread/start": send({ id: m.id, result: { thread: { id: "t-1" } } }); break;
  case "thread/resume": global.resumed = true; send({ id: m.id, result: { thread: { id: m.params.threadId } } }); break;
  case "turn/start":
    send({ id: m.id, result: { turn: { id: "turn-" + process.pid } } });
    if (global.resumed) setTimeout(() => { send({ method: "item/agentMessage/delta", params: { threadId: "t-1", turnId: "turn-" + process.pid, itemId: "a", delta: "Back." } }); send({ method: "turn/completed", params: { threadId: "t-1", turn: { id: "turn-" + process.pid, status: "completed" } } }); }, 20);
    break;
  case "turn/interrupt":
    if (process.env.FAKE_FREEZE) process.kill(process.pid, "SIGSTOP");
    send({ id: m.id, result: {} });
    send({ method: "turn/completed", params: { threadId: "t-1", turn: { id: m.params.turnId, status: "interrupted" } } });
    break;
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`;


const WANT = {
  read: { sandbox: "read-only", approval: "never", type: "readOnly" },
  ask: { sandbox: "read-only", approval: "on-request", type: "readOnly" },
  edits: { sandbox: "workspace-write", approval: "untrusted", type: "workspaceWrite" },
  auto: { sandbox: "workspace-write", approval: "on-request", type: "workspaceWrite" },
  review: { sandbox: "workspace-write", approval: "untrusted", type: "workspaceWrite" },
  full: { sandbox: "danger-full-access", approval: "on-request", type: "dangerFullAccess" },
} as const;

test("codex app server: each access level is the sandbox and approval policy Codex is told, as the thread opens and with each turn", async () => {
  for (const [access, want] of Object.entries(WANT)) {
    const fake = script("codex", CODEX);
    const s = new CodexServerSession(opts({ access: access as OpenOptions["access"], env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log } }));
    const { sink } = recorder();
    const ac = new AbortController();
    const turn = s.turn("go", sink, ac.signal);
    await until(() => fake.read().some((m) => m.method === "turn/start"), `${access}: the turn started`);
    const opened = fake.read().find((m) => m.method === "thread/start")!.params!;
    const began = fake.read().find((m) => m.method === "turn/start")!.params!;
    assert.equal(opened.sandbox, want.sandbox, `${access}: the thread's sandbox`);
    assert.equal(opened.approvalPolicy, want.approval, `${access}: the thread's approval policy`);
    assert.equal(began.approvalPolicy, want.approval, `${access}: the turn's approval policy`);
    assert.equal((began.sandboxPolicy as { type: string }).type, want.type, `${access}: the turn's sandbox`);
    ac.abort();
    await turn;
    await s.close();
  }
});
