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
  { name: "liner_wait", description: "Waits for a session to stop working (up to 10 minutes), then reads its last turn.", inputSchema: s({ session: { type: "string", description: "The session's id" }, seconds: { type: "number", description: "How long to wait at most, default 120" } }, ["session"]) },
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

async function call(name: string, args: unknown) {
  const w = where();
  if (!w) return failed("Liner Code isn't running, or Settings › Safety › Agents outside Liner Code is off.");
  try {
    const r = await fetch(w.url, { method: "POST", headers: { "content-type": "application/json", "x-liner-outside": w.key }, body: JSON.stringify({ tool: name, args: args ?? {} }) });
    if (r.status === 401) return failed("Liner Code turned this key down. Turn Agents outside Liner Code off and on again in its Settings.");
    const b = (await r.json()) as { ok: boolean; result?: unknown; error?: string };
    return b.ok ? b.result : failed(b.error ?? "Liner Code didn't answer.");
  } catch {
    return failed("Liner Code isn't running.");
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let m: Msg;
  try {
    m = JSON.parse(line) as Msg;
  } catch {
    return;
  }
  if (m.id === undefined) return;
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
  else if (m.method === "tools/call") void call(String(m.params?.name ?? ""), m.params?.arguments).then((result) => send({ id: m.id, result }));
  else if (m.method === "ping") send({ id: m.id, result: {} });
  else send({ id: m.id, error: { code: -32601, message: `No method ${m.method}` } });
});
