/*
  The 2026-11-18 polish round, add-ons and side services: a DSH plugin's program that dies at once
  is started again only after a wait. Run with `node --test test/polish-addons.test.ts`.
*/
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { PanelManifest } from "../../contracts/src/index.ts";
import { Addons } from "../src/addons.ts";
import { readDsh, untar } from "../src/dsh.ts";
import { DshHosts } from "../src/dsh-hosts.ts";
import { recentSessions } from "../src/imports.ts";
import { Proxies } from "../src/proxy.ts";
import { panelCall, type PanelEnv } from "../src/panels.ts";
import { Store } from "../src/store.ts";
import { Updater } from "../src/updates.ts";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** A DSH plugin with a page and a program (as dsh.test.ts's mediaDesk), its Node half given. */
function plugin(host: string) {
  const dir = tmp("lc-polish-dsh-");
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "dsh-fake-crash", version: "1.0.0", description: "Crashes.", type: "module", main: "src/host.js", exports: { ".": "./src/host.js", "./client": "./dist/client.js" }, dsh: { bundle: { patch: "./cordis.patch.yml" }, client: { platform: "web", inject: ["@deepseek-ai/dsh-client-runtime"] } } }),
    "cordis.patch.yml": "- insert:\n    - id: fake-crash\n      name: 'dsh-fake-crash'\n",
    "src/host.js": host,
    "dist/client.js": `window.__ModuleLoader__.load({id:"dsh-fake-crash",factory:(require)=>{const R=require("react");return{inject:["slots"],apply(ctx){ctx.slots.inject("sidebar.panellist",()=>ctx.slots.register({name:"sidebar.panellist",id:"k",label:()=>"Fake"},()=>null))}}}})`,
  };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}

test("a plugin's program that exits at once is started again only after a wait that doubles, its error said in between", { timeout: 60_000 }, async () => {
  const home = tmp("lc-polish-home-");
  const addons = new Addons(home);
  // Each start is counted in its own folder, then it exits before it's ready.
  const pkg = plugin(`import { appendFileSync } from 'node:fs'
export default { apply(ctx) { appendFileSync(process.env.DSH_HOME + '/starts', 'x'); process.exit(3) } }
`);
  const r = readDsh(pkg);
  const m = r.manifest as PanelManifest;
  assert.ok(m.dsh?.host, "it has a program");
  const version = addons.install(m, { by: { agent: "You", from: "npmjs.com/package/dsh-fake-crash", at: Date.now() } }, r.files, { dir: pkg, modules: false });
  const hosts = new DshHosts(addons, { ...process.env, HOME: home }, home);
  hosts.sandbox = false;
  const starts = () => {
    const f = join(home, "dsh", m.id, "starts");
    return existsSync(f) ? readFileSync(f, "utf8").length : 0;
  };
  try {
    const first = await hosts.frame(m, version);
    assert.match(first.error ?? "", /stopped as it started/);
    assert.equal(starts(), 1);
    // Asked again at once (a page that polls): the same error, and no new program.
    for (let i = 0; i < 5; i++) {
      const again = await hosts.frame(m, version);
      assert.equal(again.error, first.error);
    }
    assert.equal(starts(), 1, "no spawn inside its wait");
    // After the first wait (1 s) it's tried again, dies again, and now waits 2 s.
    await wait(1100);
    assert.match((await hosts.frame(m, version)).error ?? "", /stopped as it started/);
    assert.equal(starts(), 2);
    await wait(1100);
    await hosts.frame(m, version);
    assert.equal(starts(), 2, "the second wait is longer than the first");
    await wait(1000);
    await hosts.frame(m, version);
    assert.equal(starts(), 3);
    // Turned off and on again: its next start is a first one, at once.
    addons.update(m.id, { enabled: false });
    hosts.changed();
    addons.update(m.id, { enabled: true });
    await hosts.frame(m, version);
    assert.equal(starts(), 4);
  } finally {
    await hosts.stopAll(300);
  }
});

const panel = (id: string, access: PanelManifest["access"] = {}): PanelManifest => ({ apiVersion: 1, id, kind: "panel", name: id, place: "page", entry: "index.html", access });
const FILES = { "index.html": "<h1>Hi</h1>" };

test("a kept manifest is checked once while its file stays the same, and one add-on is found without building the others", () => {
  const a = new Addons(tmp("lc-polish-addons-"));
  a.install(panel("one"), { by: { agent: "x", at: 1 } }, FILES);
  a.install(panel("two"), { by: { agent: "x", at: 2 } }, FILES);
  const m = a.manifest("one");
  assert.ok(m);
  assert.equal(a.manifest("one"), m, "the same checked manifest, not read again");
  // Its file written again (a different name, a different size): read again.
  const file = join(a.dir, "one", "v1", "addon.json");
  writeFileSync(file, JSON.stringify({ ...panel("one"), name: "One, renamed" }));
  assert.equal(a.manifest("one")?.name, "One, renamed");
  // get(id) reads that add-on's manifest only.
  const asked: string[] = [];
  const read = a.manifest.bind(a);
  a.manifest = (id: string, v?: number) => (asked.push(id), read(id, v));
  assert.equal(a.get("two")?.name, "two");
  assert.deepEqual(asked, ["two"]);
  assert.equal(a.get("nobody"), undefined);
});

test("a panel's storage is read once and written a moment after a change, not on every set", async () => {
  const a = new Addons(tmp("lc-polish-store-"));
  a.install(panel("notes", { storage: 4 }), { by: { agent: "x", at: 1 } }, FILES);
  const file = join(a.dir, "notes", "storage.json");
  a.store("notes", "draft", "h", 4);
  a.store("notes", "draft", "hi", 4);
  assert.equal(existsSync(file), false, "not written as each key goes in");
  assert.deepEqual(a.storage("notes"), { draft: "hi" });
  // What's handed out is a copy: changing it changes nothing kept.
  a.storage("notes").draft = "changed";
  assert.deepEqual(a.storage("notes"), { draft: "hi" });
  assert.throws(() => a.store("notes", "big", "x".repeat(5000), 4), /over the 4 KB/);
  assert.deepEqual(a.storage("notes"), { draft: "hi" }, "a refused set keeps nothing of it");
  await wait(700);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { draft: "hi" });
  // A new Addons (the next launch) reads what was written; flush writes at once.
  a.store("notes", "more", 1, 4);
  a.flush();
  assert.deepEqual(new Addons(join(a.dir, "..")).storage("notes"), { draft: "hi", more: 1 });
});

test("a panel's sessions.list reads each session's changes without keeping its timeline", async () => {
  const threads = [{ id: "t1", title: "One", projectId: "p", status: "done", updatedAt: 2, archived: false }, { id: "t2", title: "Two", projectId: "p", status: "done", updatedAt: 1, archived: false }];
  const peeked: string[] = [];
  const env = {
    cwdOf: () => "",
    thread: () => threads[0],
    threads: () => threads,
    timeline: () => {
      throw new Error("the whole timeline was read");
    },
    peek: (id: string, kinds: string[]) => (peeked.push(`${id}:${kinds.join()}`), id === "t1" ? [{ kind: "checkpoint", id: "c", files: [{ path: "a.ts", added: 3, removed: 1 }] }] : []),
    projectName: () => "P",
    branchOf: () => undefined,
    storage: { all: () => ({}), put: () => {} },
  } as unknown as PanelEnv;
  const out = (await panelCall(env, { access: { sessions: "all" }, place: "page" }, "sessions.list", {})) as { id: string; files: number; added: number; removed: number }[];
  assert.deepEqual(out.map((s) => [s.id, s.files, s.added, s.removed]), [["t1", 1, 3, 1], ["t2", 0, 0, 0]]);
  assert.deepEqual(peeked, ["t1:checkpoint", "t2:checkpoint"]);
});

test("the updater doesn't look again at launch when it looked less than six hours ago, and shows what it found then", () => {
  const home = tmp("lc-polish-updates-");
  mkdirSync(join(home, "updates"), { recursive: true });
  const hour = 3600_000;
  const state = (checkedAt: number) => writeFileSync(join(home, "updates", "state.json"), JSON.stringify({ checkedAt, found: { app: { latest: "99.0.0", url: "https://example.com/r" }, tools: [{ id: "codex", label: "Codex CLI", current: "1.0.0", latest: "1.1.0", command: "codex update" }] } }));
  const make = () => new Updater(new Store(home), { PATH: "/usr/bin:/bin", LINER_UPDATE_REPO: "o/n", LINER_APP_VERSION: "0.2.8" }, { working: () => 0, restartIdle: () => {} }, () => {});
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.now() });
  try {
    state(Date.now() - hour);
    const up = make();
    // What the last look found, shown at once.
    assert.equal(up.state.app.latest, "99.0.0");
    assert.equal(up.state.app.state, "available");
    assert.deepEqual(up.state.tools.map((t) => [t.id, t.state]), [["codex", "available"]]);
    let looks = 0;
    up.check = () => (looks++, Promise.resolve(up.state));
    up.download = () => Promise.resolve(up.state);
    up.start();
    mock.timers.tick(10_000);
    assert.equal(looks, 0, "no look a few seconds after launch");
    mock.timers.tick(5 * hour);
    assert.equal(looks, 1, "the look is due six hours after the last");
    mock.timers.tick(6 * hour);
    assert.equal(looks, 2, "then every six hours");
    up.stop();
    // A look seven hours ago: due as before, a little after launch, and its findings are old news.
    state(Date.now() - 7 * hour);
    const late = make();
    assert.deepEqual(late.state.tools, []);
    let lateLooks = 0;
    late.check = () => (lateLooks++, Promise.resolve(late.state));
    late.start();
    mock.timers.tick(8000);
    assert.equal(lateLooks, 1);
    late.stop();
  } finally {
    mock.timers.reset();
  }
});

test("sessions.recent walks Codex's tree off the engine's thread, and reads a session's head once while it's unchanged", async () => {
  const project = realpathSync(tmp("lc-polish-recent-p-"));
  const codex = tmp("lc-polish-recent-codex-");
  const env = { PATH: "/usr/bin:/bin", CLAUDE_CONFIG_DIR: tmp("lc-polish-recent-claude-"), CODEX_HOME: codex };
  // Months of rollouts, one a day, the newest for this project.
  for (let day = 1; day <= 120; day++) {
    const dir = join(codex, "sessions", "2026", String(1 + Math.floor(day / 31)).padStart(2, "0"), String(1 + (day % 31)).padStart(2, "0"));
    mkdirSync(dir, { recursive: true });
    const f = join(dir, `rollout-${day}.jsonl`);
    writeFileSync(f, [JSON.stringify({ type: "session_meta", payload: { id: `c${day}`, cwd: day === 120 ? project : "/elsewhere" } }), JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: `Day ${day}` }] } })].join("\n") + "\n");
    const t = new Date(Date.now() - (121 - day) * 60_000);
    utimesSync(f, t, t);
  }
  let ticked = false;
  setImmediate(() => (ticked = true));
  const asked = recentSessions([{ id: "p", path: project }], env, new Set(), 6);
  assert.equal(ticked, false);
  const found = await asked;
  assert.equal(ticked, true, "the engine's thread went on while the tree was read");
  assert.deepEqual(found.map((s) => [s.id, s.title, s.projectId]), [["c120", "Day 120", "p"]]);
  // The same file, the same time and size: its head isn't read again (a changed word of the same length isn't seen).
  const f = join(codex, "sessions", "2026", "04", "28", "rollout-120.jsonl");
  const st = statSync(f);
  writeFileSync(f, readFileSync(f, "utf8").replace("Day 120", "Yad 120"));
  utimesSync(f, st.atime, st.mtime);
  assert.equal((await recentSessions([{ id: "p", path: project }], env, new Set(), 6))[0]?.title, "Day 120");
  // Written to since (a resumed session): read again.
  writeFileSync(f, readFileSync(f, "utf8").replace("Yad 120", "Resumed 120"));
  assert.equal((await recentSessions([{ id: "p", path: project }], env, new Set(), 6))[0]?.title, "Resumed 120");
});

test("a plugin's log is held to its limit while its program runs, not only as it starts", { timeout: 30_000 }, async () => {
  const home = tmp("lc-polish-log-");
  const addons = new Addons(home);
  // It says 200 KB every 10 ms once it's up: 2 MB in a tenth of a second.
  const pkg = plugin(`export default { apply(ctx) { setInterval(() => process.stdout.write('x'.repeat(200000) + '\\n'), 10) } }
`);
  const r = readDsh(pkg);
  const m = r.manifest as PanelManifest;
  const version = addons.install(m, { by: { agent: "You", from: "npmjs.com/package/dsh-fake-crash", at: Date.now() } }, r.files, { dir: pkg, modules: false });
  const hosts = new DshHosts(addons, { ...process.env, HOME: home }, home);
  hosts.sandbox = false;
  try {
    const frame = await hosts.frame(m, version);
    assert.equal(frame.error, undefined, frame.error);
    await wait(800);
    const size = statSync(join(addons.dir, m.id, "host.log")).size;
    assert.ok(size > 0 && size <= 1_000_000, `its log is ${size} bytes`);
  } finally {
    await hosts.stopAll(300);
  }
});

test("a plugin's tarball unpacks without holding up the engine's thread", async () => {
  // A plain ustar tarball (as dsh.test.ts's tarOf), with a few files of some size.
  const blocks: Buffer[] = [];
  for (let i = 0; i < 20; i++) {
    const h = Buffer.alloc(512);
    const body = Buffer.alloc(200_000, 120);
    h.write(`package/f${i}.txt`, 0, 100);
    h.write("0000644\0", 100);
    h.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
    h.write("00000000000\0", 136);
    h.write("0", 156);
    h.write("ustar\0", 257);
    h.write("        ", 148);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  const out = join(tmp("lc-polish-tar-"), "pkg");
  let ticked = false;
  setImmediate(() => (ticked = true));
  const unpacking = untar(gzipSync(Buffer.concat(blocks)), out);
  assert.equal(ticked, false);
  await unpacking;
  assert.equal(ticked, true, "the engine's thread went on while it unpacked");
  assert.equal(statSync(join(out, "f19.txt")).size, 200_000);
});

test("no GitHub CLI sign-in isn't held for the whole run: it's asked again a few minutes later", { skip: process.platform === "win32" && "a shell script stands in for gh" }, async () => {
  const bin = tmp("lc-polish-gh-");
  const signed = join(bin, "signed");
  writeFileSync(join(bin, "gh"), `#!/bin/sh\n[ -f "${signed}" ] && echo tok-after-login\nexit 0\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const up = new Updater(new Store(tmp("lc-polish-gh-home-")), { PATH: `${bin}:/usr/bin:/bin` }, { working: () => 0, restartIdle: () => {} }, () => {});
  const token = () => (up as unknown as { ghToken(): Promise<string | undefined> }).ghToken();
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    assert.equal(await token(), undefined);
    // gh auth login, run after the app started.
    writeFileSync(signed, "");
    assert.equal(await token(), undefined, "not asked again at once");
    mock.timers.tick(6 * 60_000);
    assert.equal(await token(), "tok-after-login");
  } finally {
    mock.timers.reset();
  }
});

test("a session folder's server can be closed when its sessions are gone, and opens afresh when asked again", async () => {
  const root = tmp("lc-polish-proxy-");
  writeFileSync(join(root, "index.html"), "<p>hi</p>");
  const proxies = new Proxies();
  try {
    const url = await proxies.files(root);
    assert.equal((await fetch(`${url}/index.html`)).status, 200);
    assert.deepEqual(proxies.folderRoots(), [root]);
    assert.equal(proxies.closeFolder(root), true);
    assert.deepEqual(proxies.folderRoots(), []);
    await assert.rejects(fetch(`${url}/index.html`, { headers: { connection: "close" } }));
    assert.equal(proxies.closeFolder(root), false, "closed once");
    const again = await proxies.files(root);
    assert.equal((await fetch(`${again}/index.html`)).status, 200);
  } finally {
    proxies.closeAll();
  }
});
