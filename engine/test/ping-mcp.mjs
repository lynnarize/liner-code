#!/usr/bin/env node
/*
  A tiny MCP server on stdio with one tool, ping, for trying a connection without an account:
  the add-on tests use it, and so can an agent in a dev session. ping answers pong and says whether
  PING_KEY reached it (its length, never the key). Run with node; it needs nothing else.
*/
import { createInterface } from "node:readline";

const send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
const tools = [{ name: "ping", description: "Answers pong, and says whether this server got its key.", inputSchema: { type: "object", properties: { say: { type: "string", description: "Words to echo back" } } } }];

createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.id === undefined) return;
  if (m.method === "initialize") send({ id: m.id, result: { protocolVersion: String(m.params?.protocolVersion ?? "2025-06-18"), capabilities: { tools: {} }, serverInfo: { name: "ping", version: "1.0.0" } } });
  else if (m.method === "tools/list") send({ id: m.id, result: { tools } });
  else if (m.method === "tools/call") {
    const key = process.env.PING_KEY;
    const said = m.params?.arguments?.say ? ` ${m.params.arguments.say}` : "";
    send({ id: m.id, result: { content: [{ type: "text", text: `pong${said} (key: ${key ? `set, ${key.length} characters` : "not set"})` }] } });
  } else if (m.method === "ping") send({ id: m.id, result: {} });
  else send({ id: m.id, error: { code: -32601, message: `No method ${m.method}` } });
});
