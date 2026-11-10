/*
  Liner Code's tools as an MCP server on stdio, started by an agent tool for one session. It
  lists the tools and passes each call to the engine with the session's key; the engine does
  the work (see agent-tools.ts). It runs on its own, so it imports nothing from the engine but
  the list of tools, which is only data.
*/
import { createInterface } from "node:readline";
import { toolsFor } from "./liner-tools.ts";
import { VERSION } from "./version.ts";

const url = process.env.LINER_SURFACE_URL ?? "";
const key = process.env.LINER_SURFACE_KEY ?? "";
type Msg = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Record<string, unknown> };

const send = (m: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);

/**
  A call that waits for the person (an install card) or on a sidekick's brief says so every 20 seconds, when its tool asked
  for progress: one that resets its wait on progress (the MCP SDK's resetTimeoutOnProgress) then
  doesn't give up after a minute.
*/
async function call(name: string, args: unknown, progress?: string | number) {
  let n = 0;
  const message = name === "sidekick" ? "The sidekick is working on the brief" : "Waiting for the person to answer";
  const beat = progress === undefined ? undefined : setInterval(() => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: progress, progress: ++n, message } })}\n`), 20_000);
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-liner-surface": key }, body: JSON.stringify({ tool: name, args: args ?? {} }) });
    const b = (await r.json()) as { ok: boolean; result?: unknown; error?: string };
    return b.ok ? b.result : { content: [{ type: "text", text: b.error ?? "Liner Code didn't answer." }], isError: true };
  } catch {
    return { content: [{ type: "text", text: "Liner Code isn't running, so its tools aren't there." }], isError: true };
  } finally {
    clearInterval(beat);
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let m: Msg;
  try {
    m = JSON.parse(line) as Msg;
  } catch {
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
        serverInfo: { name: "liner", title: "Liner Code", version: VERSION },
        instructions: "Liner Code's own surfaces. Use the browser tools to check a web app you changed on its dev server, the device tools for an iOS app in the simulator, show_page to show a chart or table instead of describing it, and design_show for a screen, page or prototype you design. To connect a service through MCP for every agent tool, or to make a panel or small app inside Liner Code, read liner_inspect, then ask with addon_install.",
      },
    });
  } else if (m.method === "tools/list") send({ id: m.id, result: { tools: toolsFor(process.env) } });
  else if (m.method === "tools/call") {
    const token = (m.params?._meta as { progressToken?: string | number } | undefined)?.progressToken;
    void call(String(m.params?.name ?? ""), m.params?.arguments, token).then((result) => send({ id: m.id, result }));
  }
  else if (m.method === "ping") send({ id: m.id, result: {} });
  else send({ id: m.id, error: { code: -32601, message: `No method ${m.method}` } });
});
