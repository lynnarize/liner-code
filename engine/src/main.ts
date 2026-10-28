/*
  Starts the engine. The desktop shell runs it as a child process and reads one line from it:
    LINER_READY {"port":53121}
  Flags: --port <n> (0 picks a free one), --ui <dir> (serve the built app), --dev (a fixed
  token for the Vite dev server). The token comes from LINER_TOKEN.
*/
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApi } from "./api.ts";
import { Routines } from "./routines.ts";
import { Runtime } from "./runtime.ts";
import { startServer } from "./server.ts";
import { Store } from "./store.ts";
import { Proxies } from "./proxy.ts";
import { DeviceLogs, Terminals } from "./surfaces.ts";
import { Watch } from "./watch.ts";
import { AgentTools } from "./agent-tools.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const dev = process.argv.includes("--dev");

// The Electron shell runs the engine on its own Node with ELECTRON_RUN_AS_NODE. Nothing the engine
// starts may inherit that: an agent's `npm run dev` on an Electron project would get a bare Node.
delete process.env.ELECTRON_RUN_AS_NODE;

const store = new Store();
// The shell passes your login shell's PATH; without it, a Dock-launched app can't find agents.
const env: NodeJS.ProcessEnv = { ...process.env, PATH: process.env.LINER_PATH || process.env.PATH };
const tools = new AgentTools(store, env);
const runtime = new Runtime(store, env, tools);
// Keys the shell read from the keychain, handed over once at launch and kept in memory only.
try {
  for (const [k, v] of Object.entries(JSON.parse(process.env.LINER_KEYS || "{}") as Record<string, string>)) if (v) runtime.keys.set(k, v);
} catch {
  // none
}
delete process.env.LINER_KEYS;
delete env.LINER_KEYS;
const terms = new Terminals(store, env);
const logs = new DeviceLogs(store, env);
const routines = new Routines(store, runtime, env);
const watch = new Watch(store, env);
const proxies = new Proxies();
const api = createApi(store, runtime, env, { routines, terms, logs, proxies, tools });

// In dev the token is written where the Vite dev server can read it; the shell passes its own.
const token = process.env.LINER_TOKEN || (dev ? "liner-dev" : randomBytes(24).toString("hex"));
if (dev) writeFileSync(join(store.home, "dev-token"), token);

const server = await startServer({
  store,
  api,
  token,
  port: Number(arg("port") ?? 0),
  ui: arg("ui"),
  snapshot: () => api.call("state.get", {}) as never,
  hooks: (id, key, body, headers) => routines.webhook(id, key, body, headers),
  surface: (key, tool, args) => {
    const threadId = key ? tools.threadOf(key) : undefined;
    return threadId ? tools.call(threadId, tool, args) : null;
  },
});
tools.url = `http://127.0.0.1:${server.port}`;
void api.ready.then(() => {
  routines.start();
  watch.start();
  api.updates.start();
});

process.stdout.write(`LINER_READY ${JSON.stringify({ port: server.port, home: store.home })}\n`);

const quit = () => {
  routines.stop();
  watch.stop();
  api.updates.stop();
  terms.closeAll();
  proxies.closeAll();
  logs.stopAll();
  runtime.shutdown();
  store.flush();
  server.close();
  process.exit(0);
};
process.on("SIGTERM", quit);
process.on("SIGINT", quit);
// The shell holds our stdin; when it goes away, so do we.
if (!dev) process.stdin.on("end", quit).resume();
process.on("uncaughtException", (e) => console.error("[engine]", e));
process.on("unhandledRejection", (e) => console.error("[engine]", e));
