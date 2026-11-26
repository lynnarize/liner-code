/*
  Liner Code as an MCP server on stdio, for agents outside it (Claude Code or Codex in a
  terminal): projects and sessions to list and read, sessions to start, message and wait for. It
  finds the engine through ~/.liner-code/outside.json (LINER_HOME moves it), which is there only
  while "Let apps outside Liner Code in" is on in Settings › Liner MCP, and passes each call there with its key.
  It runs on its own, so it imports nothing from the engine but the tool table (mcp-tools.ts), which imports nothing either.
  The engine holds a terminal agent to the level you gave it there on every call; this only lists what that level allows.
*/
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { VERSION } from "./version.ts";
import { SERVER_INSTRUCTIONS, toolsFor } from "./mcp-tools.ts";
import { MCP_LEVELS, type McpLevel } from "../../contracts/src/mcp.ts";

type Msg = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Record<string, unknown> };
const send = (m: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
const failed = (t: string) => ({ content: [{ type: "text", text: t }], isError: true });

/** Read at every call: the engine's port, key and the level you gave terminal agents change when it restarts or you change it. */
function where(): { url: string; key: string; level?: McpLevel } | null {
  try {
    return JSON.parse(readFileSync(join(process.env.LINER_HOME || join(homedir(), ".liner-code"), "outside.json"), "utf8")) as { url: string; key: string; level?: McpLevel };
  } catch {
    return null;
  }
}
/** The tools a terminal agent is shown: only those its level allows (the engine checks again on every call). Trusted when it isn't said, as before levels. */
const listed = () => {
  const level = where()?.level;
  return toolsFor(level && MCP_LEVELS.includes(level) ? level : "trusted");
};
/** Who started this server (its initialize's clientInfo), so Settings can list it by name among the apps. */
let client = "";

/** The calls at work, by their request's id: one its tool cancels (it gave up on it) is let go, so a held liner_wait doesn't keep the engine's connection open after the tool has stopped waiting. */
const calls = new Map<string | number, AbortController>();
/** What a call its tool cancelled comes to: no answer at all, as MCP has it (the tool has stopped waiting for one). */
const CANCELLED = Symbol("cancelled");

async function call(id: string | number, name: string, args: unknown, progress?: string | number) {
  const w = where();
  if (!w) return failed("Liner Code isn't running, or Settings › Liner MCP › Let apps outside Liner Code in is off.");
  let n = 0;
  const ac = new AbortController();
  calls.set(id, ac);
  const message = "Waiting for the session";
  const beat = progress === undefined ? undefined : setInterval(() => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: progress, progress: ++n, message } })}\n`), 20_000);
  try {
    const r = await fetch(w.url, { method: "POST", headers: { "content-type": "application/json", "x-liner-outside": w.key }, body: JSON.stringify({ tool: name, args: args ?? {}, client }), signal: ac.signal });
    if (ac.signal.aborted) return CANCELLED;
    if (r.status === 401) return failed("Liner Code turned this key down. Turn Let apps outside Liner Code in off and on again in Settings › Liner MCP.");
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
    const info = m.params?.clientInfo as { name?: unknown; title?: unknown } | undefined;
    client = String(info?.title ?? info?.name ?? "").slice(0, 60);
    send({
      id: m.id,
      result: {
        protocolVersion: String(m.params?.protocolVersion ?? "2025-06-18"),
        capabilities: { tools: {} },
        serverInfo: { name: "liner-code", title: "Liner Code", version: VERSION },
        instructions: SERVER_INSTRUCTIONS,
      },
    });
  } else if (m.method === "tools/list") send({ id: m.id, result: { tools: listed() } });
  else if (m.method === "tools/call") {
    const token = (m.params?._meta as { progressToken?: string | number } | undefined)?.progressToken;
    const id = m.id;
    void call(id, String(m.params?.name ?? ""), m.params?.arguments, token).then((result) => result === CANCELLED || send({ id, result }));
  }
  else if (m.method === "ping") send({ id: m.id, result: {} });
  else send({ id: m.id, error: { code: -32601, message: `No method ${m.method}` } });
});
