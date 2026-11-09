/*
  The servers of a folder's .claude/launch.json: read as Claude Code reads the file, run on a
  press, stopped by themselves when no one has looked for a while (and on archive, on quit, for a
  port), and started again when someone does, unless the entry changed. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineEvent } from "../../contracts/src/index.ts";
import { canMove, commandLine, HIDDEN, Launcher, launchRisk, movePort, plainJson, portFree, readLaunch, riskyEnv, runKey, shownEnv, type LaunchEntry } from "../src/launch.ts";
import { AgentTools, SERVER_TOOL, type AddonHost } from "../src/agent-tools.ts";
import type { Access } from "../../contracts/src/index.ts";

const SERVER = `require("http").createServer((q, s) => s.end("ok " + process.env.PORT + " " + (process.env.GREETING || ""))).listen(Number(process.env.PORT), "127.0.0.1");`;

/** A port nothing listens on now. */
const freePort = () =>
  new Promise<number>((done) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => done(typeof a === "object" && a ? a.port : 0));
    });
  });

/** A folder with a launch.json of these entries and a server.js that answers on $PORT. */
function folder(configs: unknown[]) {
  const root = mkdtempSync(join(tmpdir(), "liner-launch-"));
  mkdirSync(join(root, ".claude"));
  writeFileSync(join(root, "server.js"), SERVER);
  writeFileSync(join(root, "fail.js"), `console.error("boom: no config"); process.exit(3);`);
  const write = (c: unknown[]) => writeFileSync(join(root, ".claude", "launch.json"), JSON.stringify({ version: "0.0.1", configurations: c }));
  write(configs);
  return { root, write };
}

/** A Launcher over one folder with one session in it, with a clock of the test's. */
function launcher(root: string, o: { file?: string; busy?: () => boolean; engine?: { pid: number; at: number } } = {}) {
  const events: EngineEvent[] = [];
  let clock = 1_000_000;
  const l = new Launcher({
    env: process.env,
    emit: (e) => events.push(e),
    cwdOf: () => root,
    sessionsIn: () => [{ id: "th_a", busy: o.busy?.() ?? false }],
    file: o.file,
    engine: o.engine,
    now: () => clock,
    idleMs: 60_000,
  });
  return { l, events, tick: (ms: number) => (clock += ms) };
}

const body = async (port: number) => (await fetch(`http://127.0.0.1:${port}/`)).text();
const until = async (ok: () => boolean | Promise<boolean>, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail("waited too long");
};

test("launch.json: comments and trailing commas go, a // or ,] in a string stays", () => {
  const text = `{
    // the servers
    "configurations": [ /* one */ { "name": "a // b", "runtimeArgs": ["x,]"], }, ],
  }`;
  assert.deepEqual(JSON.parse(plainJson(text)), { configurations: [{ name: "a // b", runtimeArgs: ["x,]"] }] });
});

test("launch.json: each entry as Claude Code reads it", () => {
  const { root } = folder([
    { name: "web", runtimeExecutable: "npm", runtimeArgs: ["run", "dev"], port: 5173, env: { A: 1, "bad key": "x" }, cwd: "${workspaceFolder}/app" },
    { name: "script", program: "server.js", args: ["--x"] },
    { name: "mine", url: "http://localhost:4000" },
    { name: "far", url: "https://example.com" },
    { name: "web", runtimeExecutable: "echo" },
    { runtimeExecutable: "echo" },
    { name: "low", runtimeExecutable: "echo", port: 80 },
  ]);
  const { entries, file } = readLaunch(root);
  assert.equal(file, true);
  assert.deepEqual(
    entries.map((e) => e.name),
    ["web", "script", "mine", "far", "low"],
  );
  const [web, script, mine, far, low] = entries;
  assert.deepEqual([web.command, web.args, web.port, web.cwd, web.env], ["npm", ["run", "dev"], 5173, join(root, "app"), { A: "1" }]);
  assert.deepEqual([script.command, script.args, script.port], ["node", ["server.js", "--x"], 3000]);
  assert.deepEqual([mine.command, mine.port, mine.problem], [undefined, 4000, undefined]);
  assert.match(far.problem ?? "", /elsewhere/);
  assert.match(low.problem ?? "", /1024/);
  assert.deepEqual(readLaunch(mkdtempSync(join(tmpdir(), "liner-none-"))), { entries: [], file: false });
});

test("launch.json: a port moves where the command names it, and only that port", () => {
  assert.deepEqual(movePort(["run", "dev", "--", "--port", "5173"], 5173, 6000), ["run", "dev", "--", "--port", "6000"]);
  assert.deepEqual(movePort(["--port=5173", "-p", "5173"], 5173, 6000), ["--port=6000", "-p", "6000"]);
  assert.deepEqual(movePort(["-c", "node e.js --port 7607 & vite --port 5469 --strictPort"], 5469, 6000), ["-c", "node e.js --port 7607 & vite --port 6000 --strictPort"]);
  assert.equal(movePort(["run", "dev"], 5173, 6000), null);
});

test("launch.json: a package script that pins its port stays on it; one that doesn't, or autoPort, moves", () => {
  const { root } = folder([]);
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { pinned: "vite --port 5173", free: "vite" } }));
  const e = (o: Partial<LaunchEntry>): LaunchEntry => ({ name: "x", command: "npm", args: [], port: 5173, cwd: root, env: {}, raw: "", ...o });
  assert.equal(canMove(e({ args: ["run", "pinned"] })), false);
  assert.equal(canMove(e({ args: ["run", "free"] })), true);
  assert.equal(canMove(e({ args: ["run", "missing"] })), false);
  assert.equal(canMove(e({ args: ["run", "pinned"], autoPort: true })), true);
  assert.equal(canMove(e({ command: "node", args: ["server.js"], autoPort: false })), false);
  assert.equal(canMove(e({ command: "node", args: ["server.js"] })), true);
});

test("launch: runs on a press, answers on its port, and stops saying so", async () => {
  const port = await freePort();
  const { root } = folder([{ name: "app", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port, env: { GREETING: "hi" } }]);
  const { l, events } = launcher(root);
  assert.equal((await l.list("th_a")).servers[0].status, "stopped");
  const s = await l.start("th_a", "app");
  assert.equal(s.at, port);
  await until(async () => (await l.list("th_a")).servers[0].status === "running");
  assert.equal(await body(port), `ok ${port} hi`);
  // A second press is the same server.
  assert.equal((await l.start("th_a", "app")).at, port);
  assert.equal(await l.stop("th_a", "app"), 1);
  const after = (await l.list("th_a")).servers[0];
  assert.equal(after.status, "stopped");
  assert.equal(after.ended?.reason, "Stopped");
  assert.equal(await portFree(port), true);
  assert.ok(events.every((e) => e.type === "launch" && e.root === root));
});

test("launch: out of sight for the idle time it stops, and it starts again when the session is opened", async () => {
  const port = await freePort();
  const { root } = folder([{ name: "app", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port }]);
  let busy = false;
  const { l, tick } = launcher(root, { busy: () => busy });
  await l.start("th_a", "app");
  await until(async () => (await l.list("th_a")).servers[0].status === "running");
  l.seen("th_a");
  // Looked at a moment ago, or working a turn: it stays.
  tick(30_000);
  l.sweep();
  busy = true;
  tick(120_000);
  l.sweep();
  assert.equal((await l.list("th_a")).servers[0].status, "running");
  busy = false;
  l.sweep();
  await until(async () => (await l.list("th_a")).servers[0].status === "stopped");
  const asleep = (await l.list("th_a")).servers[0];
  assert.equal(asleep.asleep, true);
  assert.match(asleep.ended?.reason ?? "", /no session in its folder on screen/);
  assert.equal(await portFree(port), true);
  // Opened again: it comes back by itself.
  l.seen("th_a");
  await until(async () => (await l.list("th_a")).servers[0].status === "running");
  assert.equal(await body(port), `ok ${port} `);
  await l.stop("th_a");
});

test("launch: one whose entry changed while it slept waits for a press", async () => {
  const port = await freePort();
  const app = { name: "app", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port };
  const { root, write } = folder([app]);
  const { l, tick } = launcher(root);
  await l.start("th_a", "app");
  tick(120_000);
  l.sweep();
  await until(async () => (await l.list("th_a")).servers[0].status === "stopped");
  write([{ ...app, env: { GREETING: "new" } }]);
  l.seen("th_a");
  await new Promise((r) => setTimeout(r, 300));
  const s = (await l.list("th_a")).servers[0];
  assert.equal(s.status, "stopped");
  assert.equal(s.asleep, undefined);
  assert.match(s.ended?.reason ?? "", /changed since you ran it/);
});

test("launch: what ran when Liner Code quit starts again next time the session is opened", async () => {
  const port = await freePort();
  const { root } = folder([{ name: "app", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port }]);
  const file = join(root, "asleep.json");
  const first = launcher(root, { file });
  await first.l.start("th_a", "app");
  await until(async () => !(await portFree(port)));
  first.l.quit();
  await until(() => portFree(port));
  assert.equal(JSON.parse(readFileSync(file, "utf8")).asleep.length, 1);
  const next = launcher(root, { file });
  assert.equal((await next.l.list("th_a")).servers[0].asleep, true);
  next.l.seen("th_a");
  await until(async () => (await next.l.list("th_a")).servers[0].status === "running");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).asleep.length, 0);
  await next.l.stop("th_a");
});

test("launch: archived, what its session started stops", async () => {
  const port = await freePort();
  const { root } = folder([{ name: "app", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port }]);
  const { l } = launcher(root);
  await l.start("th_a", "app");
  l.forget("th_a");
  await until(async () => (await l.list("th_a")).servers[0].status === "stopped");
  assert.match((await l.list("th_a")).servers[0].ended?.reason ?? "", /session that started it/);
});

test("launch: a taken port moves the server when it may, and stops ours when it may not", async () => {
  const taken = await freePort();
  const holder = createServer().listen(taken, "127.0.0.1");
  await new Promise((r) => holder.once("listening", r));
  const other = await freePort();
  const { root } = folder([
    { name: "moves", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port: taken },
    { name: "pinned", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port: taken, autoPort: false },
    { name: "a", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port: other, autoPort: false },
    { name: "b", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port: other, autoPort: false },
  ]);
  const { l } = launcher(root);
  try {
    const moved = await l.start("th_a", "moves");
    assert.notEqual(moved.at, taken);
    await until(async () => (await l.list("th_a")).servers[0].status === "running");
    assert.equal(await body(moved.at!), `ok ${moved.at} `);
    await assert.rejects(l.start("th_a", "pinned"), /Port \d+ is taken/);
    assert.equal((await l.list("th_a")).servers[1].ended?.failed, true);
    // Two of ours on one port: the second takes it.
    await l.start("th_a", "a");
    await until(async () => !(await portFree(other)));
    await l.start("th_a", "b");
    const list = (await l.list("th_a")).servers;
    assert.equal(list[2].status, "stopped");
    assert.match(list[2].ended?.reason ?? "", /make way for b/);
    assert.notEqual(list[3].status, "stopped");
  } finally {
    await l.stop("th_a");
    holder.close();
  }
});

test("launch: one that ends straight away says so, with what it printed", async () => {
  const { root } = folder([{ name: "bad", runtimeExecutable: process.execPath, runtimeArgs: ["fail.js"], port: await freePort() }]);
  const { l } = launcher(root);
  await assert.rejects(l.start("th_a", "bad"), /Exited with code 3\nboom: no config/);
  const s = (await l.list("th_a")).servers[0];
  assert.equal(s.status, "stopped");
  assert.equal(s.ended?.failed, true);
  assert.deepEqual(s.ended?.tail, ["boom: no config"]);
});

/**
  An agent's server tools over one folder: a session with this access, a window that opens what
  it's told, and the person's answer to a card (or nobody there to give one).
*/
function agentTools(root: string, o: { access: Access; answer?: boolean; unwatched?: boolean; file?: string }) {
  const { l } = launcher(root, { file: o.file });
  const opened: string[] = [];
  const asked: Parameters<AddonHost["askLiner"]>[1][] = [];
  let tools: AgentTools;
  const store = {
    thread: () => ({ id: "th_a", access: o.access }),
    emit: (e: { type: string; id: string; op: string; args: Record<string, unknown> }) => {
      if (e.type !== "agent.browser") return;
      opened.push(String(e.args.url));
      const port = Number(/:(\d+)$/.exec(String(e.args.url))?.[1]);
      setTimeout(() => tools.reply(e.id, true, { url: "/", title: "Home", text: "ok", controls: [], errors: [], port }), 0);
    },
  };
  tools = new AgentTools(store as never, process.env);
  tools.launch = l;
  tools.host = {
    keys: new Map(),
    providerInfo: [],
    askLiner: (_t, ask) => (asked.push(ask), { id: `it-${asked.length}`, answer: Promise.resolve({ allow: o.answer ?? false }) }),
    relink: async () => new Map(),
    readOnly: () => o.access === "read",
    unwatched: () => o.unwatched ?? false,
    whoIs: () => "Opus 5.5",
    toolOf: () => ({ label: "Claude Code", family: "claude" }),
  };
  const said = async (tool: string, args: Record<string, unknown> = {}) => {
    const r = await tools.call("th_a", tool, args);
    return { error: r.isError ?? false, text: r.content.map((c) => ("text" in c ? c.text : "")).join("") };
  };
  return { l, tools, opened, asked, said };
}

test("agents: a server they start runs once the person would have it, and opens in the Browser", async () => {
  const port = await freePort();
  const { root, write } = folder([{ name: "web", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port }]);
  // Asked: the card shows the command, and no means it doesn't run.
  const no = agentTools(root, { access: "auto", answer: false });
  const refused = await no.said("server_start", { name: "web" });
  assert.equal(refused.error, true);
  assert.match(refused.text, /The person said no to running web/);
  assert.equal(no.asked[0].tool, SERVER_TOOL);
  assert.equal(no.asked[0].title, "Run web from launch.json");
  assert.match(no.asked[0].fields[0].value, /server\.js$/);
  assert.equal(await portFree(port), true, "nothing ran");
  // Yes: it runs, on its port, and opens in the Browser.
  const yes = agentTools(root, { access: "auto", answer: true });
  try {
    const ran = await yes.said("server_start", { name: "web" });
    assert.equal(ran.error, false, ran.text);
    assert.match(ran.text, new RegExp(`^web is running on localhost:${port}, from \\.claude/launch\\.json`));
    assert.match(ran.text, /In the Browser now:\nlocalhost:\d+\/ · Home/);
    assert.deepEqual(yes.opened, [`localhost:${port}`]);
    assert.equal(await body(port), `ok ${port} `);
    // The same entry again, stopped and started: yours now, so no card.
    assert.equal((await yes.said("server_stop", { name: "web" })).text, "Stopped web.");
    assert.equal((await yes.said("server_start", { name: "web" })).error, false);
    assert.equal(yes.asked.length, 1);
    // Changed by the agent: a command nobody ran asks again.
    write([{ name: "web", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port, env: { GREETING: "hi" } }]);
    await yes.said("server_stop");
    await yes.said("server_start", { name: "web" });
    assert.equal(yes.asked.length, 2);
    assert.equal(await body(port), `ok ${port} hi`);
  } finally {
    await yes.l.stop("th_a");
  }
});

test("agents: what the person ran from the Browser runs without a card; Full access runs any, short of what can't be undone", async () => {
  const port = await freePort();
  const { root, write } = folder([{ name: "web", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port }]);
  const file = join(root, "asleep.json");
  const a = agentTools(root, { access: "ask", file });
  try {
    // Pressed Run in the Browser (the launch.start the app calls): nobody has said yes to it, so it's shown first, and the yes runs it.
    const asked = await a.l.press("th_a", "web");
    assert.ok(asked.ask && asked.status === "stopped");
    assert.equal(await portFree(port), true, "nothing ran");
    await a.l.press("th_a", "web", { allow: asked.ask.key });
    await until(async () => !(await portFree(port)));
    await a.l.stop("th_a");
    // Kept through a quit, by a new engine reading the same file.
    const b = agentTools(root, { access: "ask", file });
    assert.equal((await b.said("server_start", { name: "web" })).error, false);
    assert.equal(b.asked.length, 0);
    await b.l.stop("th_a");
    // Full access: no card for a new one either.
    write([{ name: "web", runtimeExecutable: process.execPath, runtimeArgs: ["server.js", "--new"], port }]);
    const full = agentTools(root, { access: "full", file });
    assert.equal((await full.said("server_start", { name: "web" })).error, false);
    assert.equal(full.asked.length, 0);
    await full.l.stop("th_a");
    // What it ran with nobody asked is nobody's yes: a session in Ask after it is asked, and so is Run in the Browser.
    const after = agentTools(root, { access: "ask", answer: false, file });
    await after.said("server_start", { name: "web" });
    assert.equal(after.asked.length, 1);
    assert.ok((await after.l.press("th_a", "web")).ask);
    // But not what can't be undone, and not in a side chat or Read only.
    write([{ name: "web", runtimeExecutable: "sudo", runtimeArgs: ["node", "server.js"], port }]);
    const sudo = agentTools(root, { access: "full", file });
    await sudo.said("server_start", { name: "web" });
    assert.equal(sudo.asked.length, 1);
    assert.equal(sudo.asked[0].risk, "high");
    write([{ name: "web", runtimeExecutable: process.execPath, runtimeArgs: ["server.js", "--read"], port }]);
    const read = agentTools(root, { access: "read", file });
    await read.said("server_start", { name: "web" });
    assert.equal(read.asked.length, 1);
    // Nobody there to answer (a routine's step): a new one doesn't run at all.
    const routine = agentTools(root, { access: "full", unwatched: true, file });
    const r = await routine.said("server_start", { name: "web" });
    assert.match(r.text, /No one is here to say yes/);
    assert.equal(routine.asked.length, 0);
    assert.equal(await portFree(port), true);
  } finally {
    await a.l.stop("th_a");
  }
});

test("agents: one that runs already, come back by itself, is used with no card", async () => {
  const port = await freePort();
  const { root } = folder([{ name: "web", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port }]);
  const file = join(root, "asleep.json");
  const first = launcher(root, { file });
  await first.l.start("th_a", "web");
  await until(async () => !(await portFree(port)));
  first.l.quit();
  await until(() => portFree(port));
  // Kept asleep from before entries were kept as yours: it wakes, and nobody has said yes to it.
  writeFileSync(file, JSON.stringify(JSON.parse(readFileSync(file, "utf8")).asleep));
  const t = agentTools(root, { access: "ask", answer: false, file });
  try {
    t.l.seen("th_a");
    await until(async () => (await t.l.list("th_a")).servers[0].status !== "stopped");
    const r = await t.said("server_start", { name: "web" });
    assert.equal(r.error, false, r.text);
    assert.equal(t.asked.length, 0);
    assert.match(r.text, new RegExp(`^web is running on localhost:${port}`));
  } finally {
    await t.l.stop("th_a");
  }
});

test("agents: list, logs, a server that fails, and a folder with no launch.json", async () => {
  const port = await freePort();
  const { root } = folder([
    { name: "web", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port },
    { name: "bad", runtimeExecutable: process.execPath, runtimeArgs: ["fail.js"], port: await freePort() },
  ]);
  const t = agentTools(root, { access: "full" });
  try {
    await t.said("server_start", { name: "web" });
    const bad = await t.said("server_start", { name: "bad" });
    assert.equal(bad.error, true);
    assert.match(bad.text, /Exited with code 3[\s\S]*boom: no config/);
    const list = (await t.said("server_list")).text.split("\n");
    assert.equal(list[0], `web · running on localhost:${port}`);
    assert.match(list[1], /^bad · stopped \(port \d+\): Exited with code 3$/);
    assert.equal((await t.said("server_logs", { name: "bad", search: "BOOM" })).text, "bad isn't running: Exited with code 3.\n\nboom: no config");
    assert.equal((await t.said("server_logs", { name: "bad", errors: true })).text, "bad isn't running: Exited with code 3.\n\n(No lines match.)");
    assert.match((await t.said("server_logs", { name: "nope" })).text, /no server named "nope"; it has "web", "bad"/);
    assert.match((await t.said("server_start", {})).text, /Say which server, as name: web, bad/);
    assert.equal((await t.said("server_stop")).text, "Stopped 1 server.");
  } finally {
    await t.l.stop("th_a");
  }
  const empty = mkdtempSync(join(tmpdir(), "liner-launch-"));
  const e = agentTools(empty, { access: "full" });
  assert.match((await e.said("server_list")).text, /^This folder has no \.claude\/launch\.json\. Write one/);
  assert.match((await e.said("server_start", { name: "web" })).text, /has no \.claude\/launch\.json/);
});

test("launch.json: what an entry runs is its command, folder, environment and port, and its risk counts the environment", () => {
  const root = "/p";
  const e: LaunchEntry = { name: "web", command: "npm", args: ["run", "dev"], port: 5173, cwd: "/p", env: { GREETING: "hi" }, raw: "" };
  const k = runKey(root, e);
  // Any change to any of the four is another entry; the order variables are written in isn't.
  const changes: Partial<LaunchEntry>[] = [{ command: "pnpm" }, { args: ["run", "evil"] }, { cwd: "/p/sub" }, { env: { GREETING: "hi", NODE_OPTIONS: "--require x" } }, { env: { GREETING: "bye" } }, { port: 5174 }];
  for (const o of changes) assert.notEqual(runKey(root, { ...e, ...o }), k, JSON.stringify(o));
  assert.notEqual(runKey("/q", e), k);
  assert.equal(runKey(root, { ...e, env: { B: "2", A: "1" } }), runKey(root, { ...e, env: { A: "1", B: "2" } }));
  assert.equal(launchRisk(e), "low");
  for (const key of ["NODE_OPTIONS", "PATH", "Path", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "PYTHONSTARTUP", "PYTHONPATH", "BASH_ENV", "npm_config_script_shell", "GIT_SSH_COMMAND", "BROWSER", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JAVA_HOME", "GRADLE_OPTS", "MAVEN_OPTS", "OPENSSL_CONF", "BUNDLE_GEMFILE", "RUBYOPT", "PERL5OPT", "PHP_INI_SCAN_DIR", "LUA_INIT", "LUA_INIT_5_4"]) {
    assert.deepEqual(riskyEnv({ [key]: "x", PORT_HINT: "1" }), [key], key);
    assert.equal(launchRisk({ ...e, env: { [key]: "x" } }), "high", key);
  }
  assert.deepEqual(riskyEnv({ GREETING: "hi", VITE_API: "x", DEBUG: "1", NODE_ENV: "development" }), []);
  // A secret's value is said to be set, not shown (a card is kept in the session's history); one that names a program is shown.
  assert.deepEqual(shownEnv({ OPENAI_API_KEY: "sk-1", GITHUB_TOKEN: "ghp", DB_PASSWORD: "pw", CLIENT_SECRET: "s", SENTRY_DSN: "https://k@x", GREETING: "hi", GIT_ASKPASS: "/bin/x" }), { OPENAI_API_KEY: HIDDEN, GITHUB_TOKEN: HIDDEN, DB_PASSWORD: HIDDEN, CLIENT_SECRET: HIDDEN, SENTRY_DSN: HIDDEN, GREETING: "hi", GIT_ASKPASS: "/bin/x" });
  assert.equal(launchRisk({ ...e, command: "sudo" }), "high");
});

test("agents: an entry's environment is on its card, one that changes what runs is high risk, and a change to it asks again", async () => {
  const port = await freePort();
  const app = { name: "web", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port, env: { GREETING: "hi" } };
  const { root, write } = folder([{ ...app, env: { GREETING: "hi", STRIPE_SECRET_KEY: "sk_live_123" } }]);
  writeFileSync(join(root, "evil.cjs"), `require("fs").writeFileSync(__dirname + "/PWNED.txt", "ran")`);
  const file = join(root, "asleep.json");
  const yes = agentTools(root, { access: "auto", answer: true, file });
  try {
    assert.equal((await yes.said("server_start", { name: "web" })).error, false);
    const card = yes.asked[0];
    assert.deepEqual(card.fields.map((f) => f.label), ["Command", "Where", "Environment", "Port"]);
    // The key's value isn't on the card, which the session's history keeps.
    assert.equal(card.fields[2].value, `GREETING=hi\nSTRIPE_SECRET_KEY=${HIDDEN}`);
    assert.ok(!JSON.stringify(card).includes("sk_live_123"));
    write([app]);
    await yes.said("server_stop");
    assert.equal((await yes.said("server_start", { name: "web" })).error, false);
    assert.equal(card.risk, "low");
    await yes.said("server_stop");
    // NODE_OPTIONS under the same command: shown, high risk, and not run in Full access without a yes.
    write([{ ...app, env: { GREETING: "hi", NODE_OPTIONS: `--require ${join(root, "evil.cjs")}` } }]);
    const full = agentTools(root, { access: "full", answer: false, file });
    const r = await full.said("server_start", { name: "web" });
    assert.equal(r.error, true);
    assert.equal(full.asked.length, 1);
    assert.equal(full.asked[0].risk, "high");
    assert.match(full.asked[0].description ?? "", /Its environment sets NODE_OPTIONS, which can make it run other code/);
    assert.equal(full.asked[0].fields[2].value, `GREETING=hi\nNODE_OPTIONS=--require ${join(root, "evil.cjs")}`);
    assert.equal(existsSync(join(root, "PWNED.txt")), false);
    // The folder and the port count too.
    write([{ ...app, cwd: "${workspaceFolder}" }]);
    assert.equal(full.l.trusts("th_a", full.l.entry("th_a", "web")), true, "the same folder, written another way, is the same entry");
    write([{ ...app, port: port + 1 }]);
    assert.equal(full.l.trusts("th_a", full.l.entry("th_a", "web")), false);
  } finally {
    await yes.l.stop("th_a");
  }
});

test("Browser: Run on an entry nobody said yes to shows what it would run, and only a yes runs it and makes it yours", async () => {
  const port = await freePort();
  const { root, write } = folder([{ name: "web", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port, env: { GREETING: "a", API_TOKEN: "t0k" } }]);
  writeFileSync(join(root, "evil.cjs"), `require("fs").writeFileSync(__dirname + "/PWNED.txt", "ran")`);
  const { l } = launcher(root);
  try {
    // The list says what a press would run before anyone presses, a secret's value kept back.
    const listed = (await l.list("th_a")).servers[0];
    assert.equal(listed.ask?.command, commandLine({ command: process.execPath, args: ["server.js"] }));
    assert.deepEqual(listed.ask?.env, { GREETING: "a", API_TOKEN: HIDDEN });
    write([{ name: "web", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port, env: { GREETING: "a" } }]);
    const first = await l.press("th_a", "web");
    assert.equal(first.status, "stopped");
    assert.deepEqual({ ...first.ask, key: "" }, { key: "", command: commandLine({ command: process.execPath, args: ["server.js"] }), cwd: root, env: { GREETING: "a" }, port, risk: "low" });
    assert.equal(await portFree(port), true, "nothing ran");
    // A yes to something else runs nothing.
    assert.ok((await l.press("th_a", "web", { allow: "0".repeat(32) })).ask);
    const ran = await l.press("th_a", "web", { allow: first.ask!.key });
    assert.equal(ran.ask, undefined);
    await until(async () => (await l.list("th_a")).servers[0].status === "running");
    assert.equal((await l.list("th_a")).servers[0].ask, undefined);
    assert.equal(l.trusts("th_a", l.entry("th_a", "web")), true);
    // Pressed again while it runs: nothing new runs, so nothing's asked.
    assert.equal((await l.press("th_a", "web")).ask, undefined);
    // An agent rewrites the entry and asks you to press Restart: what's new doesn't run, and the one running is left alone.
    write([{ name: "web", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port, env: { GREETING: "a", NODE_OPTIONS: `--require ${join(root, "evil.cjs")}` } }]);
    const re = await l.press("th_a", "web", { again: true });
    assert.deepEqual(re.ask?.risky, ["NODE_OPTIONS"]);
    assert.equal(re.ask?.risk, "high");
    assert.equal(re.status, "running");
    assert.equal(await body(port), `ok ${port} a`);
    await l.stop("th_a");
    assert.ok((await l.press("th_a", "web")).ask, "Run asks the same");
    assert.equal(existsSync(join(root, "PWNED.txt")), false, "it never ran");
  } finally {
    await l.stop("th_a");
  }
});

test("launch: quitting gives a server that ignores SIGTERM a moment, then kills it, and doesn't hang", async () => {
  const port = await freePort();
  const { root } = folder([{ name: "stubborn", runtimeExecutable: process.execPath, runtimeArgs: ["stubborn.js"], port }]);
  writeFileSync(join(root, "stubborn.js"), `process.on("SIGTERM", () => {}); ${SERVER}`);
  const { l } = launcher(root);
  await l.start("th_a", "stubborn");
  await until(async () => !(await portFree(port)));
  const t0 = Date.now();
  await l.quit(400);
  assert.ok(Date.now() - t0 < 1500, "it waits a moment, not long");
  // Gone well before killTree's own two-second backstop.
  await until(() => portFree(port), 1000);
});

test("launch: a server the last engine left running is stopped when the next starts; a pid that's something else now is left alone", async () => {
  const port = await freePort();
  const { root } = folder([{ name: "app", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port }]);
  const file = join(root, "asleep.json");
  const first = launcher(root, { file });
  await first.l.start("th_a", "app");
  await until(async () => !(await portFree(port)));
  // The engine dies without quitting (a crash, a SIGKILL): what it kept says what was running.
  const kept = JSON.parse(readFileSync(file, "utf8")) as { running: { pid: number; at: number; command: string }[] };
  assert.equal(kept.running.length, 1);
  // Two more kept pids that are someone else's now: one started after it was kept, one running another program.
  const other = spawn("sleep", ["30"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1200));
  const theirs = [
    { pid: other.pid, at: Date.now() - 60_000, command: "sleep", root, name: "x" },
    { pid: other.pid, at: Date.now() + 60_000, command: process.execPath, root, name: "y" },
  ];
  writeFileSync(file, JSON.stringify({ ...kept, running: [...kept.running, ...theirs] }));
  try {
    const next = launcher(root, { file });
    assert.equal(await next.l.reap(), 1);
    await until(() => portFree(port));
    assert.equal(other.exitCode, null, "the other program is still running");
    assert.equal(other.signalCode, null);
    await until(() => (JSON.parse(readFileSync(file, "utf8")) as { running: unknown[] }).running.length === 0);
    assert.equal(await next.l.reap(), 0, "once is all");
  } finally {
    other.kill();
  }
});

test("launch: two engines on one home (npm run dev beside the app): what the other one runs is left alone while it's alive", async () => {
  const port = await freePort();
  const { root } = folder([{ name: "app", runtimeExecutable: process.execPath, runtimeArgs: ["server.js"], port }]);
  const file = join(root, "asleep.json");
  // The other engine: a process that's alive, and when it started.
  const other = spawn("sleep", ["60"], { stdio: "ignore" });
  const engine = { pid: other.pid!, at: Date.now() };
  const theirs = launcher(root, { file, engine });
  await theirs.l.start("th_a", "app");
  await until(async () => !(await portFree(port)));
  try {
    const mine = launcher(root, { file });
    assert.equal(await mine.l.reap(), 0, "its server is its to stop");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await portFree(port), false);
    // Kept for when it's gone, and stopped then.
    assert.equal((JSON.parse(readFileSync(file, "utf8")) as { running: unknown[] }).running.length, 1);
    other.kill();
    await new Promise((r) => other.once("exit", r));
    const next = launcher(root, { file });
    assert.equal(await next.l.reap(), 1);
    await until(() => portFree(port));
  } finally {
    other.kill();
    await theirs.l.stop("th_a");
  }
});
