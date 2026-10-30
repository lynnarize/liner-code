/*
  What the Browser surface opens by itself: only a server of the session's (its agent or its
  Terminal started it, or it runs in the session's folder), never another app's; and a page
  that needs no server, straight from the session's folder. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkHelpers, THREAD_ENV, withCodexPath } from "../src/exec.ts";
import { withExit } from "../src/providers/codex-server.ts";
import { Proxies } from "../src/proxy.ts";
import { htmlPages, listeningPorts, pagePath, parseListeners, parseThreads } from "../src/surfaces.ts";
import { AgentTools, isPage, linerTitle } from "../src/agent-tools.ts";

const get = (url: string) =>
  new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    request(url, (r) => {
      let body = "";
      r.on("data", (c) => (body += c));
      r.on("end", () => resolve({ status: r.statusCode ?? 0, type: String(r.headers["content-type"] ?? ""), body }));
    })
      .on("error", reject)
      .end();
  });

test("ports: lsof's listeners by pid and name, each port once", () => {
  const out = ["p501", "cnode", "f22", "n127.0.0.1:5173", "f23", "n[::1]:5173", "p502", "cLM\\x20Studio", "f9", "n*:1234", ""].join("\n");
  const l = parseListeners(out);
  assert.deepEqual(l.get(5173), { pid: 501, process: "node" });
  assert.deepEqual(l.get(1234), { pid: 502, process: "LM Studio" });
  assert.equal(l.size, 2);
});

test("ports: the session named in a process's environment, as ps -E prints it", () => {
  const out = ` 501 node vite.js PATH=/usr/bin ${THREAD_ENV}=th_abc HOME=/Users/x\n 502 node other.js PATH=/usr/bin\n 503 node x.js NOT_${THREAD_ENV}=th_no\n`;
  const t = parseThreads(out);
  assert.equal(t.get(501), "th_abc");
  assert.equal(t.has(502), false);
  assert.equal(t.has(503), false, "only the variable itself, not one that ends with its name");
});

test("pages: a file asked for by name, by its path in the folder, or by its full path; outside throws", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "liner-pages-")));
  writeFileSync(join(root, "index.html"), "<p>hi</p>");
  assert.equal(pagePath(root, "index.html"), "/index.html");
  assert.equal(pagePath(root, "./games/snake.html?level=2"), "/games/snake.html?level=2");
  assert.equal(pagePath(root, "/index.html"), "/index.html", "a leading slash is the folder's top");
  assert.equal(pagePath(root, join(root, "index.html")), "/index.html");
  assert.equal(pagePath(root, `file://${join(root, "index.html")}`), "/index.html");
  assert.equal(pagePath(root, ""), "/");
  assert.throws(() => pagePath(root, "../elsewhere.html"), /outside/);
  assert.throws(() => pagePath(root, "/etc/hosts"), /outside/);
});

test("pages: the folder's HTML, index.html first, hidden folders and node_modules left out", () => {
  const root = mkdtempSync(join(tmpdir(), "liner-pages-"));
  for (const d of ["docs", "node_modules/pkg", ".git", "a/b/c/d/e"]) mkdirSync(join(root, d), { recursive: true });
  for (const f of ["about.html", "index.html", "docs/index.html", "docs/guide.htm", "node_modules/pkg/x.html", ".git/y.html", "a/b/c/d/e/deep.html", "style.css"]) writeFileSync(join(root, f), "");
  assert.deepEqual(htmlPages(root), ["index.html", "docs/index.html", "about.html", "docs/guide.htm"]);
  assert.equal(isPage("index.html"), true);
  assert.equal(isPage("games/snake.html#start"), true);
  assert.equal(isPage("localhost:5173"), false);
});

test("files: a page from the session's folder gets the probe; its scripts pass as they are; hidden files and the outside don't", async () => {
  const root = mkdtempSync(join(tmpdir(), "liner-files-"));
  mkdirSync(join(root, "games"));
  writeFileSync(join(root, "index.html"), "<!doctype html><html><head><title>Flap</title></head><body><canvas></canvas></body></html>");
  writeFileSync(join(root, "games", "index.html"), "<p>more</p>");
  writeFileSync(join(root, "game.js"), "console.log(1)");
  writeFileSync(join(root, ".env"), "SECRET=1");
  const proxies = new Proxies();
  try {
    const base = await proxies.files(root);
    assert.equal(await proxies.files(root), base, "one server per folder");
    const page = await get(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assert.match(page.body, /<head><script src="\/__liner\/probe\.js"><\/script><title>Flap/);
    assert.match((await get(`${base}/games/`)).body, /more/, "a folder serves its index.html");
    const js = await get(`${base}/game.js`);
    assert.equal(js.body, "console.log(1)");
    assert.match(js.type, /javascript/);
    assert.match((await get(`${base}/__liner/probe.js`)).body, /__linerProbe/);
    assert.equal((await get(`${base}/.env`)).status, 404);
    assert.equal((await get(`${base}/%2e%2e/%2e%2e/etc/hosts`)).status, 404);
    assert.equal((await get(`${base}/missing.html`)).status, 404);
  } finally {
    proxies.closeAll();
  }
});

/** A Node server on a free port, started with `env` in `cwd`; resolves with its port and a way to stop it. */
function serve(cwd: string, env: Record<string, string>, type = "text/html") {
  const child = spawn(process.execPath, ["-e", `const s=require("http").createServer((q,r)=>{r.writeHead(200,{"content-type":${JSON.stringify(type)}});r.end("ok")});s.listen(0,"127.0.0.1",()=>console.log(s.address().port))`], { cwd, env: { ...process.env, ...env } });
  return new Promise<{ port: number; stop: () => void }>((resolve, reject) => {
    child.stdout.once("data", (d: Buffer) => resolve({ port: Number(String(d).trim()), stop: () => child.kill() }));
    child.once("error", reject);
  });
}

test("ports: the session's own server first, then one in its folder; another app's is nobody's, and an API isn't a page", async () => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "liner-project-")));
  const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "liner-elsewhere-")));
  const servers = await Promise.all([serve(elsewhere, { [THREAD_ENV]: "th_mine" }), serve(folder, {}), serve(elsewhere, {}), serve(elsewhere, { [THREAD_ENV]: "th_other" }, "application/json")]);
  const proxies = new Proxies();
  try {
    const [own, inFolder, other, api] = servers.map((s) => s.port);
    const engine = Number(new URL(await proxies.files(folder)).port);
    const list = await listeningPorts(process.env, { threadId: "th_mine", folders: [folder] });
    const of = (port: number) => list.find((x) => x.port === port);
    assert.deepEqual([of(own)?.owner, of(own)?.web], ["session", true]);
    assert.deepEqual([of(inFolder)?.owner, of(inFolder)?.web], ["project", true]);
    assert.deepEqual([of(other)?.owner, of(other)?.web], [null, true]);
    assert.deepEqual([of(api)?.owner, of(api)?.web], [null, false], "another session's server isn't this one's");
    assert.ok(list.findIndex((x) => x.port === own) < list.findIndex((x) => x.port === inFolder), "the session's own come first");
    assert.ok(list.findIndex((x) => x.port === inFolder) < list.findIndex((x) => x.port === other));
    assert.equal(of(engine), undefined, "the engine's own servers aren't offered");
  } finally {
    for (const s of servers) s.stop();
    proxies.closeAll();
  }
});

test("agent tools: a window without the session doesn't win over the one that has it", async () => {
  let tools: AgentTools;
  // Two windows: one answers at once that the session isn't open there, the other a moment later with the page.
  const store = {
    emit: (e: { id: string }) => {
      setTimeout(() => tools.reply(e.id, false, undefined, "This session isn't open in Liner Code, so its Browser isn't open either."), 0);
      setTimeout(() => tools.reply(e.id, true, { url: "/index.html", title: "Counter", text: "Clicks: 2", controls: [{ n: 1, tag: "button", label: "Clicks: 2" }], errors: [] }), 300);
    },
  };
  tools = new AgentTools(store as never, process.env);
  const r = await tools.call("th_x", "browser_read", {});
  assert.equal(r.isError, undefined);
  assert.match((r.content[0] as { text: string }).text, /^index\.html · Counter[\s\S]*Clicks: 2[\s\S]*1\. button "Clicks: 2"[\s\S]*Console: no errors/);
});

test("agent tools: a click at a point (a canvas game) and key presses reach the page; a click with nothing to click says how", async () => {
  let tools: AgentTools;
  const sent: { op: string; args: Record<string, unknown> }[] = [];
  const store = {
    emit: (e: { id: string; op: string; args: Record<string, unknown> }) => {
      sent.push({ op: e.op, args: e.args });
      setTimeout(() => tools.reply(e.id, true, { url: "/index.html", title: "Updraft", text: "Score 3", controls: [], canvases: [{ selector: "#game", width: 400, height: 600, shown: "300×450" }], errors: [] }), 0);
    },
  };
  tools = new AgentTools(store as never, process.env);
  // As a model sent it: the point as strings, and no target.
  const r = await tools.call("th_x", "browser_click", { x: "200", y: "300" });
  assert.equal(r.isError, undefined);
  assert.deepEqual(sent[0], { op: "click", args: { x: 200, y: 300, times: 1, every: 150 } });
  assert.match((r.content[0] as { text: string }).text, /Canvases[^\n]*:\n#game: 400×600, shown at 300×450/);
  await tools.call("th_x", "browser_click", { target: "#game", x: 10, y: 20, times: 5 });
  assert.deepEqual(sent[1].args, { target: "#game", x: 10, y: 20, times: 5, every: 150 });
  await tools.call("th_x", "browser_press", { key: "Space", times: 50, every: 1000 });
  assert.deepEqual(sent[2], { op: "press", args: { key: "Space", times: 20, every: 300 } });
  const none = await tools.call("th_x", "browser_click", {});
  assert.equal(none.isError, true);
  assert.match((none.content[0] as { text: string }).text, /as target; or a point, as x and y/);
  const half = await tools.call("th_x", "browser_click", { x: 4 });
  assert.match((half.content[0] as { text: string }).text, /two numbers, x and y/);
  assert.equal(sent.length, 3);
  assert.equal(linerTitle("browser_click", { x: "200", y: "300" }), "Click at 200, 300 in the Browser");
  assert.equal(linerTitle("browser_click", { target: "#game", x: 1, y: 2, times: 3 }), "Click “#game” at 1, 2 3 times in the Browser");
  assert.equal(linerTitle("browser_press", { key: "Space", times: 4 }), "Press Space 4 times in the Browser");
});

test("helpers: what agents take for granted is linked into one folder first on PATH, only when PATH lacks it", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "liner-helpers-")));
  const shipped = join(root, "other-tool", "codex-path");
  mkdirSync(shipped, { recursive: true });
  writeFileSync(join(shipped, "rg"), "#!/bin/sh\necho ripgrep\n", { mode: 0o755 });
  const dir = join(root, "home", "bin");
  const helpers = { rg: [join(root, "nowhere", "rg"), join(shipped, "rg")], fd: [join(root, "nowhere", "fd")] };
  const r = linkHelpers(dir, { PATH: "/usr/bin:/bin" }, helpers);
  assert.equal(r.env.PATH, `${dir}:/usr/bin:/bin`);
  assert.equal(realpathSync(join(dir, "rg")), join(shipped, "rg"));
  assert.deepEqual(r.missing, ["fd"]);
  // Again, from an env that already has the folder: it stays first, once.
  assert.equal(linkHelpers(dir, r.env, helpers).env.PATH, `${dir}:/usr/bin:/bin`);
  // Once PATH has its own, the link goes and PATH's is used.
  const own = join(root, "own");
  mkdirSync(own);
  writeFileSync(join(own, "rg"), "#!/bin/sh\n", { mode: 0o755 });
  linkHelpers(dir, { PATH: `${own}:/usr/bin` }, helpers);
  assert.equal(existsSync(join(dir, "rg")), false);
});

test("codex: its own helpers folder goes on its PATH; a failed command says how it ended", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "liner-codex-")));
  mkdirSync(join(root, "release", "bin"), { recursive: true });
  mkdirSync(join(root, "release", "codex-path"));
  writeFileSync(join(root, "release", "bin", "codex"), "#!/bin/sh\n", { mode: 0o755 });
  symlinkSync(join(root, "release", "bin", "codex"), join(root, "codex"));
  assert.equal(withCodexPath(join(root, "codex"), { PATH: "/usr/bin" }).PATH, `${join(root, "release", "codex-path")}:/usr/bin`);
  assert.equal(withCodexPath("/nowhere/codex", { PATH: "/usr/bin" }).PATH, "/usr/bin");
  assert.equal(withExit("/Users/x/Test\n", 127), "/Users/x/Test\n[exit 127: a command in it isn't installed here]");
  assert.equal(withExit(undefined, 1), "[exit 1]");
  assert.equal(withExit("ok", 0), "ok");
});
