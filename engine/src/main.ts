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
import { DeviceLogs, listeningPorts, Terminals } from "./surfaces.ts";
import { Launcher } from "./launch.ts";
import { Watch } from "./watch.ts";
import { AgentTools } from "./agent-tools.ts";
import { Designs } from "./designs.ts";
import { Addons } from "./addons.ts";
import { Offers } from "./offers.ts";
import { Sources } from "./sources.ts";
import { DshHosts } from "./dsh-hosts.ts";
import type { Thread } from "../../contracts/src/index.ts";
import { Outside } from "./outside-tools.ts";
import { Awake } from "./awake.ts";
import { firstLine, linkHelpers, secretsFrom, takeSecrets, withPath } from "./exec.ts";

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
const env: NodeJS.ProcessEnv = linkHelpers(join(store.home, "bin"), withPath(process.env, process.env.LINER_PATH || process.env.PATH)).env;
const tools = new AgentTools(store, env);
const runtime = new Runtime(store, env, tools);
// Your add-ons: kept beside the engine's state, handed to each session's tool by the runtime, asked for through the agent tools.
const addons = new Addons(store.home);
runtime.addons = addons;
tools.addons = addons;
tools.host = runtime;
// Keys the shell read from the keychain, handed over once at launch and kept in memory only.
for (const [k, v] of Object.entries(secrets.keys)) if (v) runtime.keys.set(k, v);
const terms = new Terminals(store, env);
const logs = new DeviceLogs(store, env);
const routines = new Routines(store, runtime, env);
// Keeping the default branch pulled waits while a session works in that checkout (one in its own worktree doesn't count).
const watch = new Watch(store, env, (path) => routines.busy || store.threads.some((t) => !t.worktree && (runtime.isRunning(t.id) || t.status === "running" || t.status === "waiting") && store.projects.some((p) => p.id === t.projectId && p.path === path)));
const proxies = new Proxies();
// Designs live in each session's folder and the engine's; the runtime knows both the folder and the turn.
const designs = new Designs(store);
designs.cwdOf = (id) => tools.cwdOf(id);
designs.turnOf = (id) => tools.turnOf(id);
tools.designs = designs;
tools.filesUrl = (root) => proxies.files(root);
// The servers of each folder's .claude/launch.json: they stop when no one has looked for a while, and come back when you do.
const folderOf = (id: string) => {
  const t = store.thread(id);
  return t.worktree?.path ?? store.project(t.projectId).path;
};
const launch = new Launcher({
  env,
  emit: (e) => store.emit(e),
  cwdOf: folderOf,
  sessionsIn: (root) =>
    store.threads.flatMap((t) => {
      if (t.archived) return [];
      try {
        return folderOf(t.id) === root ? [{ id: t.id, busy: t.status === "running" || t.status === "waiting" || runtime.isRunning(t.id) }] : [];
      } catch {
        return [];
      }
    }),
  file: join(store.home, "servers-asleep.json"),
  holder: (port) => listeningPorts(env).then((l) => l.find((s) => s.port === port)?.process),
});
launch.watch();
// What the last engine left running when it crashed or was killed: stopped, if it's still what it started.
void launch.reap().catch((e) => console.error("[engine]", e));
tools.launch = launch;
const outside: { now?: Outside } = {};
// Ported DeepSeek Harness plugins' own programs: each in a process of its own, never in the engine.
const dsh = new DshHosts(addons, env, store.home);
dsh.projects = () => [...store.projects.map((p) => p.path), ...store.threads.flatMap((t) => (t.worktree?.path ? [t.worktree.path] : []))];
const extras: Parameters<typeof createApi>[3] = { routines, terms, logs, proxies, tools, designs, launch, dsh, outside: { apply: () => outside.now?.apply() } };
const api = createApi(store, runtime, env, extras);
// "Make it an app": the card's Create starts a session of its own, through the same door the app uses.
const offers = new Offers({
  store,
  addons,
  createThread: (p) => api.call("thread.create", p) as Promise<Thread>,
  send: (id, text) => runtime.send(id, text),
  stop: (id) => runtime.stop(id),
  cwdOf: (id) => tools.cwdOf(id) ?? store.thread(id).worktree?.path ?? store.project(store.thread(id).projectId).path,
  whoIs: (id) => runtime.whoIs(id),
  readOnly: (id) => runtime.readOnly(id),
  turnOf: (id) => tools.turnOf(id),
});
extras.offers = offers;
// Add-ons someone else made, from GitHub or a folder: staged, checked, and added only on the card's yes.
const sources = new Sources(addons, env);
sources.network = () => store.settings.addonNetwork ?? "ask";
extras.sources = sources;
tools.offers = offers;
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
  check: { page: (t) => tools.checkPage(t), call: (t, b) => tools.checkCall(t, b), report: (t, b) => tools.checkReport(t, b as never), settle: (t) => tools.checkSettle(t) },
  dsh: (token, rest, search, req, res) => dsh.serve(token, rest, search, req, res),
});
tools.url = `http://127.0.0.1:${server.port}`;
outside.now.url = tools.url;
// Where a ported plugin's tools bring your agents' calls (dsh-mcp.ts).
dsh.url = tools.url;
outside.now.apply();
// No idle sleep while a session or a routine run works.
const awake = new Awake(store, () => routines.busy || store.threads.some((t) => t.status === "running"));
void api.ready.then(() => {
  // Sessions stopped mid-turn when Liner Code last quit or crashed carry on, now that the tools are known.
  offers.resume(runtime.continueAfterRestart());
  routines.start();
  watch.start();
  api.updates.start();
  awake.start();
});

process.stdout.write(`LINER_READY ${JSON.stringify({ port: server.port, home: store.home })}\n`);

/** How long launch.json servers and plugins' programs get to go by themselves when Liner Code quits, before SIGKILL. */
const QUIT_WAIT = 1500;
let quitting = false;
const quit = () => {
  if (quitting) return;
  quitting = true;
  // However the waits below go, the engine is gone in a few seconds.
  setTimeout(() => process.exit(0), QUIT_WAIT + 2500);
  // Each on its own, so one that fails (the last save, on a full disk) doesn't leave the rest undone
  // and the engine running with nothing to stop it: its signal has been sent, and its stdin has closed.
  const waits: Promise<void>[] = [];
  const steps = [() => waits.push(dsh.stopAll(QUIT_WAIT)), () => awake.stop(), () => routines.stop(), () => watch.stop(), () => api.updates.stop(), () => terms.closeAll(), () => waits.push(launch.quit(QUIT_WAIT)), () => proxies.closeAll(), () => logs.stopAll(), () => runtime.shutdown(), () => store.keepStreaming(), () => store.flush(), () => server.close()];
  for (const step of steps) {
    try {
      step();
    } catch (e) {
      console.error("[engine]", e);
    }
  }
  // Servers and programs asked to stop get a moment to, then what's left of their groups is killed (SIGKILL), then out.
  void Promise.allSettled(waits).then(() => process.exit(0));
};
process.on("SIGTERM", quit);
process.on("SIGINT", quit);
// The shell holds our stdin; when it goes away, so do we.
if (!dev) process.stdin.on("end", quit).resume();
process.on("uncaughtException", (e) => console.error("[engine]", e));
process.on("unhandledRejection", (e) => console.error("[engine]", e));
