/*
  Liner Code as an MCP server on stdio, for agents outside it (Claude Code or Codex in a
  terminal): projects and sessions to list and read, sessions to start, message and wait for. It
  finds the engine through ~/.liner-code/outside.json (LINER_HOME moves it), which is there only
  while "Agents outside Liner Code" is on in Settings, and passes each call there with its key.
  It runs on its own, so it imports nothing from the engine.
*/
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { VERSION } from "./version.ts";

type Schema = { type: "object"; properties: Record<string, { type: string; description: string }>; required?: string[] };
const s = (properties: Schema["properties"], required?: string[]): Schema => ({ type: "object", properties, ...(required ? { required } : {}) });

const TOOLS = [
  { name: "liner_projects", description: "The projects in Liner Code: id, name and folder.", inputSchema: s({}) },
  { name: "liner_sessions", description: "Recent Liner Code sessions, newest first: id, title, project and status (running, waiting on the person, done).", inputSchema: s({ project: { type: "string", description: "A project's id, name or folder; all when left out" }, limit: { type: "number", description: "How many, up to 50" } }) },
  { name: "liner_read", description: "A session's last turns: what the person asked, what the agent answered and did, what changed, what the Reviewer found, and anything waiting on the person.", inputSchema: s({ session: { type: "string", description: "The session's id" }, turns: { type: "number", description: "How many turns back, up to 10" } }, ["session"]) },
  { name: "liner_start", description: "Starts a session in a project with a message, on the project's usual agent unless you name one. It works with the person's default access; what it asks waits for them in Liner Code.", inputSchema: s({ project: { type: "string", description: "A project's id, name or folder" }, message: { type: "string", description: "What the session should do" }, agent: { type: "string", description: "An agent's id, or provider:model like codex:gpt-6-luna" } }, ["project", "message"]) },
  { name: "liner_send", description: "Sends a message to a session; while it works, the message waits for its turn to end.", inputSchema: s({ session: { type: "string", description: "The session's id" }, message: { type: "string", description: "The message" } }, ["session", "message"]) },
  { name: "liner_wait", description: "Waits for a session to stop working (up to 4 minutes; call it again to wait longer), then reads its last turn.", inputSchema: s({ session: { type: "string", description: "The session's id" }, seconds: { type: "number", description: "How long to wait at most, default 120, up to 240" } }, ["session"]) },
];

type Msg = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Record<string, unknown> };
const send = (m: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
const failed = (t: string) => ({ content: [{ type: "text", text: t }], isError: true });

/** Read at every call: the engine's port and key change when it restarts. */
function where(): { url: string; key: string } | null {
  try {
    return JSON.parse(readFileSync(join(process.env.LINER_HOME || join(homedir(), ".liner-code"), "outside.json"), "utf8")) as { url: string; key: string };
  } catch {
    return null;
  }
}

/** The calls at work, by their request's id: one its tool cancels (it gave up on it) is let go, so a held liner_wait doesn't keep the engine's connection open after the tool has stopped waiting. */
const calls = new Map<string | number, AbortController>();
/** What a call its tool cancelled comes to: no answer at all, as MCP has it (the tool has stopped waiting for one). */
const CANCELLED = Symbol("cancelled");

async function call(id: string | number, name: string, args: unknown, progress?: string | number) {
  const w = where();
  if (!w) return failed("Liner Code isn't running, or Settings › Safety › Agents outside Liner Code is off.");
  let n = 0;
  const ac = new AbortController();
  calls.set(id, ac);
  const message = "Waiting for the session";
  const beat = progress === undefined ? undefined : setInterval(() => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: progress, progress: ++n, message } })}\n`), 20_000);
  try {
    const r = await fetch(w.url, { method: "POST", headers: { "content-type": "application/json", "x-liner-outside": w.key }, body: JSON.stringify({ tool: name, args: args ?? {} }), signal: ac.signal });
    if (ac.signal.aborted) return CANCELLED;
    if (r.status === 401) return failed("Liner Code turned this key down. Turn Agents outside Liner Code off and on again in its Settings.");
    const b = (await r.json()) as { ok: boolean; result?: unknown; error?: string };
    if (ac.signal.aborted) return CANCELLED;
    return b.ok ? b.result : failed(b.error ?? "Liner Code didn't answer.");
  } catch {
    return ac.signal.aborted ? CANCELLED : failed("Liner Code isn't running.");
  } finally {
    clearInterval(beat);
    // A later call may have taken its id by now: that one stays.
    if (calls.get(id) === ac) calls.delete(id);
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let m: Msg;
  try {
    m = JSON.parse(line) as Msg;
  } catch {
    return;
  }
  // A cancel is a notification (no id): let go the call it names before the id check below would drop it.
  if (m?.method === "notifications/cancelled") {
    const of = m.params?.requestId;
    if (typeof of === "string" || typeof of === "number") calls.get(of)?.abort();
    return;
  }
  // Valid JSON needn't be a message: null, say.
  if (m?.id === undefined) return;
  if (m.method === "initialize") {
    send({
      id: m.id,
      result: {
        protocolVersion: String(m.params?.protocolVersion ?? "2025-06-18"),
        capabilities: { tools: {} },
        serverInfo: { name: "liner-code", title: "Liner Code", version: VERSION },
        instructions: "The person's Liner Code sessions. Read what a session did before you redo it; start or message one to hand work to Liner Code's agents, then wait for it and read what it did.",
      },
    });
  } else if (m.method === "tools/list") send({ id: m.id, result: { tools: TOOLS } });
  else if (m.method === "tools/call") {
    const token = (m.params?._meta as { progressToken?: string | number } | undefined)?.progressToken;
    const id = m.id;
    void call(id, String(m.params?.name ?? ""), m.params?.arguments, token).then((result) => result === CANCELLED || send({ id, result }));
  }
  else if (m.method === "ping") send({ id: m.id, result: {} });
  else send({ id: m.id, error: { code: -32601, message: `No method ${m.method}` } });
});
