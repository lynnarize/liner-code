/*
  A ported DeepSeek Harness plugin's tools as an MCP server on stdio, started by an agent tool
  (Claude Code, Codex, OpenCode, Hermes) like Liner Code's own (mcp.ts). It lists the tools and
  brings each call to the engine at LINER_DSH_URL (/dsh/<token>/mcp, a token for this plugin's
  tools alone), which runs it in the plugin's own process (dsh-hosts.ts, dsh-host.ts) and answers.
  It imports nothing of the engine's, nor of the plugin's: it only passes calls on.
*/
import { createInterface } from "node:readline";
import { VERSION } from "./version.ts";

const url = process.env.LINER_DSH_URL ?? "";
const name = process.env.LINER_DSH_NAME || "DeepSeek Harness plugin";
type Msg = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Record<string, unknown> };

const send = (m: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
/** Calls under way, by request id: an agent that calls one off stops it. */
const calls = new Map<string | number, AbortController>();

async function ask(body: Record<string, unknown>, signal?: AbortSignal) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  const text = await r.text();
  let got: Record<string, unknown>;
  try {
    got = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Liner Code answered ${r.status} for ${name}.`);
  }
  if (!r.ok) throw new Error(typeof got.error === "string" ? got.error : `Liner Code answered ${r.status} for ${name}.`);
  return got;
}
const down = (e: unknown) => (e instanceof TypeError ? "Liner Code isn't running, so this plugin's tools aren't there." : e instanceof Error ? e.message : String(e));

/** Its tools and what it tells an agent, asked as it starts: the first list takes that answer, and each after asks again. */
let warm: Promise<Record<string, unknown>> | null = null;
const list = () => {
  const p = warm ?? ask({ op: "list" });
  warm = null;
  return p;
};

/**
  A call that runs long says so every 20 seconds, when its tool asked for progress: one that resets
  its wait on progress (the MCP SDK's resetTimeoutOnProgress) then doesn't give up on it.
*/
async function call(id: string | number, params: Record<string, unknown>) {
  const progress = (params._meta as { progressToken?: string | number } | undefined)?.progressToken;
  let n = 0;
  const beat = progress === undefined ? undefined : setInterval(() => send({ method: "notifications/progress", params: { progressToken: progress, progress: ++n, message: `${name} is still working` } }), 20_000);
  const ac = new AbortController();
  calls.set(id, ac);
  try {
    return await ask({ op: "call", name: String(params.name ?? ""), arguments: params.arguments ?? {} }, ac.signal);
  } catch (e) {
    return { content: [{ type: "text", text: ac.signal.aborted ? "The call was stopped." : down(e) }], isError: true };
  } finally {
    clearInterval(beat);
    calls.delete(id);
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let m: Msg;
  try {
    m = JSON.parse(line) as Msg;
  } catch {
    return;
  }
  if (!m || typeof m !== "object") return;
  if (m.method === "notifications/cancelled") {
    const of = m.params?.requestId;
    if (typeof of === "string" || typeof of === "number") calls.get(of)?.abort();
    return;
  }
  if (m.id === undefined) return;
  const id = m.id;
  if (m.method === "initialize") {
    // What it tells an agent, when its program says it in time; the server is there either way.
    warm = ask({ op: "list" });
    warm.catch(() => {});
    const said = Promise.race([warm.then((r) => (typeof r.instructions === "string" ? r.instructions : "")), new Promise<string>((ok) => setTimeout(() => ok(""), 8000))]).catch(() => "");
    void said.then((instructions) =>
      send({
        id,
        result: {
          protocolVersion: String(m.params?.protocolVersion ?? "2025-06-18"),
          capabilities: { tools: {} },
          serverInfo: { name: "liner-dsh", title: `${name}, from DeepSeek Harness`, version: VERSION },
          ...(instructions ? { instructions } : {}),
        },
      }),
    );
  } else if (m.method === "tools/list")
    void list().then(
      (r) => send({ id, result: { tools: Array.isArray(r.tools) ? r.tools : [] } }),
      (e: unknown) => send({ id, error: { code: -32603, message: down(e) } }),
    );
  else if (m.method === "tools/call") void call(id, m.params ?? {}).then((result) => send({ id, result }));
  else if (m.method === "ping") send({ id, result: {} });
  else send({ id, error: { code: -32601, message: `${m.method ?? "That"} isn't something this server does.` } });
});
