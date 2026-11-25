/*
  An ACP agent says its slash commands as a session runs (available_commands_update), and the engine tells the app at once
  (a `commands` event), which asks for the "/" list again. agent.commands kept what it had listed for five minutes
  (api.ts commandsCache), so the app got the old list back. A pushed list replaces what is kept for that tool and folder.
  A fake agent stands in for the tool: it says the command named in FAKE_NAME as its session opens.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderId } from "../../contracts/src/index.ts";
import { createApi } from "../src/api.ts";
import { acpProvider } from "../src/providers/acp.ts";
import type { OpenOptions, TurnSink } from "../src/providers/types.ts";
import { providers, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

function fakeAgent() {
  const dir = mkdtempSync(join(tmpdir(), "lc-pushed-cmds-"));
  const file = join(dir, "agent");
  writeFileSync(
    file,
    `#!${process.execPath}
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
    if (m.method === "initialize") send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } });
    else if (m.method === "session/new") {
      send({ id: m.id, result: { sessionId: "s-" + Date.now() } });
      send({ method: "session/update", params: { sessionId: "s", update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: process.env.FAKE_NAME || "first", description: "" }] } } });
    } else if (m.method === "session/prompt") setTimeout(() => send({ id: m.id, result: { stopReason: "end_turn" } }), 30);
    else if (m.id !== undefined) send({ id: m.id, result: {} });
  }
});
`,
    { mode: 0o755 },
  );
  return file;
}

const sink = {
  text: () => {}, reasoning: () => {}, tool: () => {}, plan: () => {},
  approve: async () => ({ allow: true }), ask: async () => null, propose: async () => ({ approve: true }),
  usage: () => {}, session: () => {}, notice: () => {}, error: () => {}, limited: () => {},
} as unknown as TurnSink;

test("A slash-command list an ACP agent pushes replaces the one agent.commands kept, so the app's next ask gets it", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lc-pushed-cmds-proj-")));
  const store = new Store(join(dir, "home"));
  store.putProject({ id: "p", name: "p", path: dir, git: false, createdAt: Date.now() });
  const id = "acp.pushed" as ProviderId;
  const p = acpProvider(id, { label: "Fake", cmd: [fakeAgent()], login: "" });
  const reg = providers as Record<string, unknown>;
  const env = { ...process.env } as NodeJS.ProcessEnv;
  const runtime = new Runtime(store, env);
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [], put: () => undefined, remove: () => undefined }, terms: {}, logs: {}, proxies: {} } as never);
  // After createApi, which syncs the added agents from Settings and would drop one it doesn't know.
  reg[id] = p;
  const names = async () => ((await api.call("agent.commands", { projectId: "p", agent: `@${id}:default`, team: false })) as { commands: { name: string; source?: string }[] }).commands.filter((c) => c.source === "tool").map((c) => c.name);
  try {
    assert.deepEqual(await names(), ["first"], "listed once, from a session it opened to ask");
    // A session in the folder says a new list, as one does after a plugin or a project command was added.
    const s = p.open({ cwd: dir, model: "default", effort: "medium", access: "edits", soul: "", guard: true, env: { ...env, FAKE_NAME: "second" } } as OpenOptions);
    await s.turn("hi", sink, new AbortController().signal);
    s.close();
    assert.deepEqual(await names(), ["second"], "the pushed list, not the one kept from before");
  } finally {
    delete reg[id];
    api.updates.stop();
    await runtime.shutdown();
  }
});
