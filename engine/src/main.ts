/*
  Starts the engine. The desktop shell runs it as a child process and reads one line from it:
    LINER_READY {"port":53121}
  Flags: --port <n> (0 picks a free one), --ui <dir> (serve the built app), --dev (a fixed
  token for the Vite dev server). The shell writes the token and keys as the first line on stdin
  (LINER_SECRETS=stdin; LINER_TOKEN by hand), and nothing the engine starts inherits them.
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
import { Outside } from "./outside-tools.ts";
import { Awake } from "./awake.ts";
import { firstLine, linkHelpers, secretsFrom, takeSecrets } from "./exec.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const dev = process.argv.includes("--dev");

// The Electron shell runs the engine on its own Node with ELECTRON_RUN_AS_NODE. Nothing the engine
// starts may inherit that: an agent's `npm run dev` on an Electron project would get a bare Node.
delete process.env.ELECTRON_RUN_AS_NODE;
// The token and the keys are the engine's alone. The shell writes them as the first line on stdin
// (LINER_SECRETS=stdin), never in the environment, which anything running as you can read with
// `ps eww`, agents included. An engine run by hand may still take LINER_TOKEN and LINER_KEYS;
// either way they're out of the environment before anything starts.
const handed = takeSecrets(process.env);
let secrets = handed;
if (process.env.LINER_SECRETS === "stdin") {
  const line = await firstLine(process.stdin);
  if (line === null) {
    console.error("[engine] The shell went away before it handed over the token.");
    process.exit(1);
  }
  secrets = secretsFrom(line);
}
delete process.env.LINER_SECRETS;

const store = new Store();
// The shell passes your login shell's PATH; without it, a Dock-launched app can't find agents.
// Helpers agents take for granted (ripgrep) go first on the PATH of everything the engine runs.
const env: NodeJS.ProcessEnv = linkHelpers(join(store.home, "bin"), { ...process.env, PATH: process.env.LINER_PATH || process.env.PATH }).env;
const tools = new AgentTools(store, env);
const runtime = new Runtime(store, env, tools);
// Keys the shell read from the keychain, handed over once at launch and kept in memory only.
for (const [k, v] of Object.entries(secrets.keys)) if (v) runtime.keys.set(k, v);
const terms = new Terminals(store, env);
const logs = new DeviceLogs(store, env);
const routines = new Routines(store, runtime, env);
// Keeping the default branch pulled waits while a session works in that checkout (one in its own worktree doesn't count).
const watch = new Watch(store, env, (path) => routines.busy || store.threads.some((t) => !t.worktree && (runtime.isRunning(t.id) || t.status === "running" || t.status === "waiting") && store.projects.some((p) => p.id === t.projectId && p.path === path)));
const proxies = new Proxies();
const outside: { now?: Outside } = {};
const api = createApi(store, runtime, env, { routines, terms, logs, proxies, tools, outside: { apply: () => outside.now?.apply() } });
outside.now = new Outside(store, api);

// In dev the token is written where the Vite dev server can read it; the shell passes its own.
const token = secrets.token || (dev ? "liner-dev" : randomBytes(24).toString("hex"));
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
  outside: (key, tool, args) => (outside.now?.allows(key) ? outside.now.call(tool, args) : null),
});
tools.url = `http://127.0.0.1:${server.port}`;
outside.now.url = tools.url;
outside.now.apply();
// No idle sleep while a session or a routine run works.
const awake = new Awake(store, () => routines.busy || store.threads.some((t) => t.status === "running"));
void api.ready.then(() => {
  // Sessions stopped mid-turn when Liner Code last quit or crashed carry on, now that the tools are known.
  runtime.continueAfterRestart();
  routines.start();
  watch.start();
  api.updates.start();
  awake.start();
});

process.stdout.write(`LINER_READY ${JSON.stringify({ port: server.port, home: store.home })}\n`);

const quit = () => {
  awake.stop();
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
