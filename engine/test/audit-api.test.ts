/*
  What an audit of the engine's front door and what hangs off it found: the local server, the RPC
  handlers, terminals, add-ons, offers, the updater and quitting. Each test here failed before its
  fix. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddonManifest, Item, Thread } from "../../contracts/src/index.ts";
import { emptyUsage, panelDocument } from "../../contracts/src/index.ts";
import { Addons } from "../src/addons.ts";
import { Designs } from "../src/designs.ts";
import { importable } from "../src/imports.ts";
import { Offers, type OfferHost } from "../src/offers.ts";
import { startServer } from "../src/server.ts";
import { Store } from "../src/store.ts";
import { DeviceLogs, pagePath, Terminals } from "../src/surfaces.ts";
import { Updater } from "../src/updates.ts";
import { Watch } from "../src/watch.ts";

const temp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), `lc-audit-${name}-`)));
const PATH = "/usr/bin:/bin";

const until = async (ok: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** The API over a real store, with a Runtime that runs nothing unless a test swaps in its own send. */
async function apiFor(path: string, git = false) {
  const { createApi } = await import("../src/api.ts");
  const { Runtime } = await import("../src/runtime.ts");
  const store = new Store(temp("home"));
  store.putProject({ id: "p", name: "p", path, git, createdAt: 1 });
  const env = { PATH, HOME: store.home };
  const runtime = new Runtime(store, env);
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
  const call = <T>(m: string, p: unknown) => api.call(m, p) as Promise<T>;
  return { store, runtime, api, call };
}

function repo() {
  const dir = temp("repo");
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "T");
  git("config", "user.email", "t@example.com");
  writeFileSync(join(dir, "a.txt"), "a\n");
  git("add", "-A");
  git("commit", "-q", "-m", "first");
  return { dir, git };
}

const thread = (id: string, projectId = "p"): Thread => ({ id, projectId, title: id, agent: "@claude:x", status: "idle", access: "auto", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });

/* ---------- The local server ---------- */

const raw = (port: number, text: string) =>
  new Promise<string>((resolve, reject) => {
    const s = connect(port, "127.0.0.1", () => s.write(text));
    let got = "";
    s.on("data", (d) => (got += d.toString()));
    s.on("close", () => resolve(got));
    s.on("error", reject);
    setTimeout(() => (s.destroy(), resolve(got)), 1500);
  });

test("server: a request whose address can't be read is answered, not left hanging", async () => {
  const store = new Store(temp("home"));
  const server = await startServer({ store, api: { call: async () => null, ready: Promise.resolve() }, snapshot: async () => ({}) as never, token: "t", port: 0 });
  try {
    assert.match(await raw(server.port, "GET // HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"), /^HTTP\/1\.1 400/);
  } finally {
    server.close();
  }
});

test("server: a webhook that throws is answered, not left hanging", async () => {
  const store = new Store(temp("home"));
  const hooks = () => {
    throw new Error("broken");
  };
  const server = await startServer({ store, api: { call: async () => null, ready: Promise.resolve() }, snapshot: async () => ({}) as never, token: "t", port: 0, hooks });
  try {
    assert.match(await raw(server.port, "POST /hooks/r/abc?key=k HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"), /^HTTP\/1\.1 500/);
  } finally {
    server.close();
  }
});

test("rpc: a method name that's only a property of every object is no method", async () => {
  const { call } = await apiFor(temp("p"));
  for (const m of ["constructor", "toString", "__proto__", "hasOwnProperty"]) await assert.rejects(call(m, {}), /Unknown method/, m);
});

/* ---------- Rules ---------- */

test("rules: saving through CLAUDE.md linked to AGENTS.md keeps the text", async () => {
  const dir = temp("rules");
  writeFileSync(join(dir, "AGENTS.md"), "old rules\n");
  symlinkSync("AGENTS.md", join(dir, "CLAUDE.md"));
  const { call } = await apiFor(dir);
  const saved = await call<{ agents?: string; linked: boolean }>("project.rules.save", { id: "p", text: "new rules" });
  assert.equal(readFileSync(join(dir, "AGENTS.md"), "utf8"), "new rules\n");
  assert.equal(saved.agents, "new rules\n");
});

test("rules: saving through AGENTS.md linked to CLAUDE.md keeps the text", async () => {
  const dir = temp("rules");
  writeFileSync(join(dir, "CLAUDE.md"), "old rules\n");
  symlinkSync("CLAUDE.md", join(dir, "AGENTS.md"));
  const { call } = await apiFor(dir);
  await call("project.rules.save", { id: "p", text: "new rules" });
  assert.equal(readFileSync(join(dir, "AGENTS.md"), "utf8"), "new rules\n");
});

test("rules: a CLAUDE.md that links to a file elsewhere isn't written through", async () => {
  const dir = temp("rules");
  const shared = join(temp("shared"), "team.md");
  writeFileSync(shared, "the whole team's rules\n");
  symlinkSync(shared, join(dir, "CLAUDE.md"));
  const { call } = await apiFor(dir);
  await call("project.rules.save", { id: "p", text: "mine" });
  assert.equal(readFileSync(shared, "utf8"), "the whole team's rules\n");
  assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
});

/* ---------- git ---------- */

test("git.commit: a file made in one turn and gone by the next doesn't stop the commit", async () => {
  const { dir } = repo();
  const { store, call } = await apiFor(dir, true);
  store.putThread(thread("th_a"));
  writeFileSync(join(dir, "kept.txt"), "kept\n");
  writeFileSync(join(dir, "a.txt"), "changed\n");
  const file = (path: string, status: "added" | "modified" | "deleted") => ({ path, status, added: 1, removed: 0 });
  store.putItem("th_a", { kind: "checkpoint", id: "c1", turn: 1, at: 1, files: [file("gone.txt", "added"), file("kept.txt", "added")] });
  store.putItem("th_a", { kind: "checkpoint", id: "c2", turn: 2, at: 2, files: [file("gone.txt", "deleted"), file("a.txt", "modified")] });
  const r = await call<{ sha: string }>("git.commit", { threadId: "th_a", message: "work" });
  assert.ok(r.sha);
  assert.equal(execFileSync("git", ["show", "--format=", "--name-only", "HEAD"], { cwd: dir, encoding: "utf8" }).trim().split("\n").sort().join(","), "a.txt,kept.txt");
});

test("git.commit: a tracked file an agent removed with git rm still goes in", async () => {
  const { dir, git } = repo();
  const { store, call } = await apiFor(dir, true);
  store.putThread(thread("th_a"));
  git("rm", "-q", "a.txt");
  writeFileSync(join(dir, "b.txt"), "b\n");
  store.putItem("th_a", { kind: "checkpoint", id: "c1", turn: 1, at: 1, files: [{ path: "a.txt", status: "deleted", added: 0, removed: 1 }, { path: "b.txt", status: "added", added: 1, removed: 0 }] });
  await call("git.commit", { threadId: "th_a", message: "work" });
  assert.equal(execFileSync("git", ["ls-files"], { cwd: dir, encoding: "utf8" }).trim(), "b.txt");
});

test("thread.create: a base that reads as an option is refused", async () => {
  const { dir } = repo();
  const { call } = await apiFor(dir, true);
  await assert.rejects(call("thread.create", { projectId: "p", agent: "@claude:x", worktree: true, base: "--detach" }), /base/);
});

test("compare.start: a message that couldn't start waits in its queue", async () => {
  const { dir } = repo();
  const { store, runtime, call } = await apiFor(dir, true);
  runtime.send = async () => {
    throw new Error("no model");
  };
  const made = await call<Thread[]>("compare.start", { projectId: "p", text: "do it", models: ["@claude:x", "@claude:y"] });
  await until(() => made.every((t) => (store.thread(t.id).queue ?? []).length === 1));
  assert.equal(store.thread(made[0].id).queue?.[0].text, "do it");
  assert.ok(store.timeline(made[0].id).some((x) => x.kind === "notice" && /in the queue/.test(x.text)));
});

test("compare.keep: a diff that failed isn't read as no changes", async () => {
  const { dir } = repo();
  const { store, call } = await apiFor(dir, true);
  const t = await call<Thread>("thread.create", { projectId: "p", agent: "@claude:x", worktree: true });
  store.patchThread(t.id, { compare: { id: "cmp", base: "0".repeat(40) } });
  writeFileSync(join(t.worktree!.path, "new.txt"), "x\n");
  await assert.rejects(call("compare.keep", { threadId: t.id }), /Couldn't read/);
});

/* ---------- Terminals ---------- */

const termsFor = (store: Store) => new Terminals(store, { PATH, SHELL: "/bin/bash", HOME: store.home });

test("terminal: a folder that's gone says so, and no shell is left half open", () => {
  const store = new Store(temp("home"));
  const terms = termsFor(store);
  assert.throws(() => terms.open(join(store.home, "nope"), 80, 24, undefined, "t"), /isn't there any more/);
  assert.deepEqual(terms.list("t"), []);
});

test("terminal: one that can't start says why and ends, without an uncaught error", async () => {
  const store = new Store(temp("home"));
  // A python3 whose interpreter isn't there: the spawn fails as it starts, as a missing Python would.
  const bin = temp("bin");
  writeFileSync(join(bin, "python3"), "#!/no/such/interpreter\n", { mode: 0o755 });
  const terms = new Terminals(store, { PATH: bin, SHELL: "/bin/bash", HOME: store.home });
  const { id } = terms.open(store.home, 80, 24);
  await until(() => terms.attach(id).exited !== undefined);
  assert.match(terms.attach(id).text, /didn't start/);
  terms.write(id, "ls\r");
  terms.closeAll();
});

test("terminal: no size at all still opens a shell", async () => {
  const store = new Store(temp("home"));
  const terms = termsFor(store);
  const { id } = terms.open(store.home, undefined as never, undefined as never);
  terms.write(id, "echo up-$((40+2))\r");
  await until(() => terms.attach(id).text.includes("up-42"));
  terms.closeAll();
});

test("terminal: a large paste doesn't lock it up", { skip: process.platform === "win32" }, async () => {
  const store = new Store(temp("home"));
  const terms = termsFor(store);
  const { id } = terms.open(store.home, 80, 24);
  let got = 0;
  store.on((e) => {
    if (e.type === "term") got += e.data.length;
  });
  // What comes back (the tty's echo, and cat printing it) is what fills the pty the other way.
  terms.write(id, "cat; echo finished-$((40+2))\r");
  await new Promise((r) => setTimeout(r, 400));
  const line = `${"y".repeat(79)}\n`;
  terms.write(id, line.repeat(20000));
  terms.write(id, "\x04");
  await until(() => terms.attach(id).text.includes("finished-42"), 20_000);
  assert.ok(got > 0);
  terms.closeAll();
});

test("terminal: writing to one that's gone is no uncaught error", async () => {
  const store = new Store(temp("home"));
  const terms = termsFor(store);
  const { id } = terms.open(store.home, 80, 24);
  await new Promise((r) => setTimeout(r, 200));
  (terms as unknown as { terms: Map<string, { child: { kill(s: string): void } }> }).terms.get(id)!.child.kill("SIGKILL");
  terms.write(id, "x".repeat(4_000_000));
  terms.resize(id, 100, 30);
  await until(() => terms.attach(id).exited !== undefined);
  await new Promise((r) => setTimeout(r, 50));
});

test("device log: no simulator tools is no uncaught error", async () => {
  const store = new Store(temp("home"));
  const logs = new DeviceLogs(store, { PATH: join(store.home, "nothing") });
  // On this Mac xcrun is found by its full path: a name that isn't there stands for a machine without one.
  (logs as unknown as { tool: string }).tool = "liner-no-such-xcrun";
  logs.set("abc", true);
  await new Promise((r) => setTimeout(r, 100));
  logs.stopAll();
});

/* ---------- Bringing sessions in ---------- */

test("imports: a link to nothing among a tool's sessions doesn't hide the rest", () => {
  const home = temp("claude");
  const cwd = temp("p");
  const dir = join(home, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "good.jsonl"), `${JSON.stringify({ type: "user", message: { content: "Fix the login" } })}\n`);
  symlinkSync(join(dir, "nowhere"), join(dir, "bad.jsonl"));
  assert.deepEqual(importable(cwd, { CLAUDE_CONFIG_DIR: home, CODEX_HOME: join(home, "no-codex") }, new Set()).map((s) => s.id), ["good"]);
});

/* ---------- Paths ---------- */

test("pagePath: a file whose name starts with two dots is in the folder", () => {
  assert.equal(pagePath("/work/app", "..notes.html"), "/..notes.html");
  assert.throws(() => pagePath("/work/app", "../other.html"), /outside/);
  assert.throws(() => pagePath("/work/app", "sub/../../other.html"), /outside/);
});

test("addons: a version that isn't a number names no file", () => {
  const home = temp("addons");
  const addons = new Addons(home);
  const m: AddonManifest = { apiVersion: 1, id: "linear", kind: "connection", name: "Linear", server: { http: { url: "https://mcp.linear.app/mcp" } } };
  addons.install(m, { by: { agent: "You", at: 1 } });
  mkdirSync(join(home, "addons", "other"), { recursive: true });
  writeFileSync(join(home, "addons", "other", "addon.json"), JSON.stringify({ ...m, name: "Elsewhere" }));
  assert.equal(addons.manifest("linear", "/../../other" as never), null);
  assert.equal(addons.manifest("linear", 1.5), null);
  assert.equal(addons.manifest("linear", 1)?.name, "Linear");
});

test("designs: a version that isn't a number names no file", () => {
  const store = new Store(temp("home"));
  store.putProject({ id: "p", name: "p", path: store.home, git: false, createdAt: 1 });
  store.putThread(thread("t"));
  const designs = new Designs(store);
  designs.cwdOf = () => store.home;
  const { item } = designs.show("t", { title: "A", html: "<p>a</p>" });
  writeFileSync(join(store.home, "designs", "t", "secret.html"), "secret");
  assert.throws(() => designs.read("t", item.design, "/../../secret" as never), /isn't kept/);
  assert.throws(() => designs.restore("t", item.design, "/../../secret" as never), /isn't kept/);
  assert.equal(designs.read("t", item.design, 1).html, "<p>a</p>");
});

test("panels: a script or stylesheet named after what every object has isn't taken for a file", () => {
  // Without the check this reads a function as its text, and the frame can't be built at all.
  const doc = panelDocument({ files: { "index.html": '<script src="constructor"></script><link rel="stylesheet" href="toString"><p>hello</p>' }, entry: "index.html", access: {}, theme: {}, place: "dock" });
  assert.match(doc, /a script from elsewhere, left out/);
  assert.match(doc, /a stylesheet from elsewhere, left out/);
  assert.match(doc, /hello/);
});

/* ---------- Offers ---------- */

type Offer = Extract<Item, { kind: "offer" }>;
const ACCESS = { files: "project" as const };

function offers(over: Partial<OfferHost> = {}, home = temp("home")) {
  const store = new Store(home);
  const addons = new Addons(home);
  const cwd = temp("cwd");
  if (!store.projects.length) store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
  let n = 0;
  const h: OfferHost = {
    store,
    addons,
    createThread: async (p) => store.putThread({ ...thread(`child${++n}`, p.projectId), title: p.title, turns: 0 }),
    send: async () => {},
    stop: () => {},
    cwdOf: () => cwd,
    whoIs: () => "Sonnet",
    readOnly: () => false,
    turnOf: () => 1,
    ...over,
  };
  const o = new Offers(h);
  if (!store.threads.some((t) => t.id === "parent")) {
    store.putThread(thread("parent"));
    store.putItem("parent", { kind: "offer", id: "of", turn: 1, at: 1, name: "Todos", brief: "Lists the todos in this project.", place: "dock", access: ACCESS, state: "proposed" });
  }
  return { store, addons, o, cwd, h };
}
const state = (s: Store) => s.item("parent", "of") as Offer;
function draft(cwd: string, id: string) {
  const dir = join(cwd, ".liner/addons", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "addon.json"), JSON.stringify({ apiVersion: 1, id, kind: "panel", name: "Todos", place: "dock", entry: "index.html", access: ACCESS }));
  writeFileSync(join(dir, "index.html"), "<p>todos</p>");
}

test("offers: an app whose session couldn't start says so, and can be tried again", async () => {
  const { store, o } = offers({
    send: async () => {
      throw new Error("no model is ready");
    },
  });
  await o.answer("parent", "of", "create");
  assert.equal(state(store).state, "failed");
  assert.match(state(store).error ?? "", /no model is ready/);
});

test("offers: the session that offered it going away doesn't break the turn that's making it", async () => {
  const { store, o } = offers();
  await o.answer("parent", "of", "create");
  const child = state(store).child!;
  store.patchThread(child, { status: "running" });
  store.removeThread("parent");
  assert.doesNotThrow(() => store.patchThread(child, { status: "done" }));
});

test("offers: the session making it being deleted ends the card", async () => {
  const { store, o } = offers();
  await o.answer("parent", "of", "create");
  const child = state(store).child!;
  store.patchThread(child, { status: "running" });
  store.removeThread(child);
  store.emit({ type: "thread.removed", id: child });
  assert.equal(state(store).state, "failed");
  assert.match(state(store).error ?? "", /deleted/);
});

test("offers: an app being made when Liner Code quit is added once it's back", async () => {
  const first = offers();
  await first.o.answer("parent", "of", "create");
  const child = state(first.store).child!;
  draft(first.cwd, state(first.store).addon!);
  first.store.flush();
  // Back again, with the child's turn stopped by the quit and not carrying on.
  const again = offers({ cwdOf: () => first.cwd }, first.store.home);
  assert.equal(state(again.store).state, "creating");
  again.o.resume([]);
  assert.equal(state(again.store).state, "installed");
  assert.ok(again.addons.get(state(again.store).addon!));
  assert.equal(child, state(again.store).child);
});

test("offers: one that carries on after the restart is added when that turn ends", async () => {
  const first = offers();
  await first.o.answer("parent", "of", "create");
  const child = state(first.store).child!;
  draft(first.cwd, state(first.store).addon!);
  first.store.flush();
  const again = offers({ cwdOf: () => first.cwd }, first.store.home);
  again.o.resume([child]);
  assert.equal(state(again.store).state, "creating");
  again.store.patchThread(child, { status: "running" });
  again.store.patchThread(child, { status: "done" });
  assert.equal(state(again.store).state, "installed");
});

test("offers: one whose session is gone after a restart fails rather than waiting for good", async () => {
  const first = offers();
  await first.o.answer("parent", "of", "create");
  const child = state(first.store).child!;
  first.store.removeThread(child);
  first.store.flush();
  const again = offers({}, first.store.home);
  again.o.resume([]);
  assert.equal(state(again.store).state, "failed");
});

/* ---------- Following a pull request ---------- */

function fakeGh(dir: string, json: string) {
  writeFileSync(join(dir, "gh"), `#!/bin/bash\ncat <<'EOF'\n${json}\nEOF\n`, { mode: 0o755 });
}

test("watch: a session snoozed until a reply wakes when its pull request closes or merges", async () => {
  for (const state of ["MERGED", "CLOSED"]) {
    const store = new Store(temp("home"));
    const bin = temp("bin");
    fakeGh(bin, JSON.stringify({ state, comments: [], reviews: [] }));
    store.putProject({ id: "p", name: "p", path: bin, git: false, createdAt: 1 });
    store.putThread({ ...thread("t"), pr: { number: 7, url: "u", state: "OPEN" }, wake: { kind: "reply", pr: 7 }, snoozedUntil: Date.now() + 30 * 86400000 });
    const w = new Watch(store, { PATH: `${bin}:${PATH}` });
    await w.tick();
    const t = store.thread("t");
    assert.equal(t.snoozedUntil, undefined, state);
    assert.equal(t.wake, undefined, state);
    assert.equal(t.unread, true, state);
  }
});

test("watch: merging with settle-on-merge still wakes what was snoozed", async () => {
  const store = new Store(temp("home"));
  store.setSettings({ settleOnMerge: true });
  const bin = temp("bin");
  fakeGh(bin, JSON.stringify({ state: "MERGED", comments: [], reviews: [] }));
  store.putProject({ id: "p", name: "p", path: bin, git: false, createdAt: 1 });
  store.putThread({ ...thread("t"), pr: { number: 7, url: "u", state: "OPEN" }, wake: { kind: "reply", pr: 7 }, snoozedUntil: Date.now() + 30 * 86400000 });
  await new Watch(store, { PATH: `${bin}:${PATH}` }).tick();
  assert.equal(store.thread("t").snoozedUntil, undefined);
  assert.equal(store.thread("t").done, true);
});

test("watch: a reply that came while Liner Code was shut still wakes the session", async () => {
  const store = new Store(temp("home"));
  const bin = temp("bin");
  store.putProject({ id: "p", name: "p", path: bin, git: false, createdAt: 1 });
  store.putThread({ ...thread("t"), pr: { number: 7, url: "u", state: "OPEN" }, wake: { kind: "reply", pr: 7 }, snoozedUntil: Date.now() + 30 * 86400000 });
  const env = { PATH: `${bin}:${PATH}` };
  fakeGh(bin, JSON.stringify({ state: "OPEN", comments: [], reviews: [] }));
  await new Watch(store, env).tick();
  assert.ok(store.thread("t").wake, "nothing yet");
  // A new Watch is the engine started again; the reply came in between.
  fakeGh(bin, JSON.stringify({ state: "OPEN", comments: [{}], reviews: [] }));
  await new Watch(store, env).tick();
  assert.equal(store.thread("t").wake, undefined);
  assert.equal(store.thread("t").unread, true);
});

/* ---------- The updater ---------- */

const ARCH = process.arch === "arm64" ? "arm64" : "x64";
const idle = { working: () => 0, restartIdle: () => {} };

async function releaseServer(asset: (res: import("node:http").ServerResponse) => void, digest: string) {
  const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    if (req.url === "/repos/o/n/releases/latest") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ tag_name: "v0.2.0", html_url: `${base}/r`, assets: [{ id: 1, name: `Liner-Code-0.2.0-mac-${ARCH}.zip`, size: 1000, url: `${base}/asset`, digest }] }));
    if (req.url === "/asset") return asset(res);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, api: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

function installed(api: string) {
  const dir = temp("app");
  const bundle = join(dir, "Liner Code.app");
  mkdirSync(bundle);
  return { PATH, LINER_UPDATE_REPO: "o/n", LINER_UPDATE_API: api, LINER_APP_BUNDLE: bundle, LINER_APP_VERSION: "0.1.0" };
}

test("updater: a download that can't be written fails, rather than downloading for good", { skip: process.platform !== "darwin" }, async () => {
  const body = Buffer.alloc(1000, 1);
  const gh = await releaseServer((res) => res.writeHead(200).end(body), `sha256:${createHash("sha256").update(body).digest("hex")}`);
  const home = temp("home");
  try {
    const up = new Updater(new Store(home), installed(gh.api), idle, () => {});
    mkdirSync(join(home, "updates"), { recursive: true });
    chmodSync(join(home, "updates"), 0o555);
    await assert.rejects(() => up.download(), /stopped/);
    assert.equal(up.state.app.state, "failed");
  } finally {
    chmodSync(join(home, "updates"), 0o755);
    gh.server.close();
  }
});

test("updater: a download that goes quiet stops, and can be tried again", { skip: process.platform !== "darwin" }, async () => {
  const gh = await releaseServer((res) => {
    res.writeHead(200, { "content-length": "1000" });
    res.write("partial");
  }, `sha256:${"0".repeat(64)}`);
  try {
    const up = new Updater(new Store(temp("home")), installed(gh.api), idle, () => {});
    (up as unknown as { stall: number }).stall = 150;
    await assert.rejects(() => up.download(), /stopped/);
    assert.equal(up.state.app.state, "failed");
    assert.equal((up as unknown as { downloading: unknown }).downloading, null);
  } finally {
    gh.server.closeAllConnections();
    gh.server.close();
  }
});

/* ---------- Quitting ---------- */

test("quitting: a save that fails on the way out still ends the engine", { skip: process.platform === "win32" }, async () => {
  const home = temp("home");
  const child = spawn(process.execPath, [join(import.meta.dirname, "../src/main.ts"), "--port", "0"], { env: { PATH, HOME: home, LINER_HOME: home, LINER_TOKEN: "t", LINER_KEYS: "{}" }, stdio: ["pipe", "pipe", "ignore"] });
  try {
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    await until(() => out.includes("LINER_READY"), 15_000);
    chmodSync(home, 0o555);
    const gone = new Promise<boolean>((r) => {
      child.once("exit", () => r(true));
      setTimeout(() => r(false), 4000);
    });
    child.kill("SIGTERM");
    assert.equal(await gone, true);
  } finally {
    child.kill("SIGKILL");
    chmodSync(home, 0o755);
    rmSync(home, { recursive: true, force: true });
  }
});

