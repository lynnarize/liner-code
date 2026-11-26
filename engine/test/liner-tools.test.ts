/*
  Liner Code's own tools as its MCP server lists them (liner-tools.ts, which mcp.ts answers tools/list with). Antigravity's
  `agy` 1.5.18 left every one over about a kilobyte out of what its model was told: in a real session its <mcp_servers>
  block listed all 27 tools of 933 bytes or less and none of the 7 of 1,121 bytes or more (swarm_manage, design_show,
  design_frame, addon_offer, design_picture, server_start, liner_inspect), though it saved all of their schemas. server_start's
  schema is one plain string, so it is the size and not a schema feature. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS, toolsFor, PAIR_ENV, SUBAGENT_ENV, SWARM_ENV, SECURITY_ENV } from "../src/liner-tools.ts";

/** Under what agy was seen to keep (933 bytes) and what it dropped (1,121), with the room the brief asked for. */
const MAX = 1000;
const size = (t: object) => Buffer.byteLength(JSON.stringify(t));

test("Every tool Liner's MCP server lists fits under a kilobyte, as agy writes it down too", () => {
  const over = TOOLS.filter((t) => size(t) >= MAX).map((t) => `${t.name} (${size(t)} B)`);
  assert.deepEqual(over, [], "these would be left out of an Antigravity session");
  // agy saves each one as { name, description, parameters }: the same size within a byte or two.
  for (const t of TOOLS) assert.ok(size({ name: t.name, description: t.description, parameters: t.inputSchema }) < MAX, t.name);
});

test("Every session's own list fits under a kilobyte a tool: a pair's lead, subagents, each swarm role and each Liner Security level", () => {
  const envs: Record<string, string>[] = [{}, { [PAIR_ENV]: "1" }, { [SUBAGENT_ENV]: "1" }, { [SWARM_ENV]: "coordinator" }, { [SWARM_ENV]: "orchestrator" }, { [SWARM_ENV]: "worker" }, { [SECURITY_ENV]: "scan" }, { [SECURITY_ENV]: "scan-read" }, { [SECURITY_ENV]: "read" }];
  for (const env of envs) for (const t of toolsFor(env)) assert.ok(size(t) < MAX, `${t.name} (${size(t)} B) in ${JSON.stringify(env)}`);
});

test("No tool's schema uses what a Gemini function declaration may refuse: $ref, oneOf, anyOf, allOf or additionalProperties", () => {
  const walk = (v: unknown, at: string): string[] => {
    if (!v || typeof v !== "object") return [];
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [...(["$ref", "oneOf", "anyOf", "allOf", "additionalProperties"].includes(k) ? [`${at}.${k}`] : []), ...walk(x, `${at}.${k}`)]);
  };
  assert.deepEqual(TOOLS.flatMap((t) => walk(t.inputSchema, t.name)), []);
});
