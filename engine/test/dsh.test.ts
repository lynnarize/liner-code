/*
  DeepSeek Harness plugins, ported (dsh.ts, dsh-hosts.ts, dsh-host.ts): npm names as people paste
  them, the YAML of a cordis.patch.yml, a tarball read with nothing outside its folder, a package
  read into the add-on it makes (a page with its program, a connection, or a refusal in words), the
  dsh block taken only from Liner Code itself, and a plugin's program in a process of its own,
  under its sandbox on a Mac, answering its frame through the engine and asking its model through
  the bridge; the tools it gives DSH's agent, named on its card and served to your agents as an
  MCP server through Liner Code's own stdio bridge. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { ConnectionAsk, ConnectionManifest, DshConnectionManifest, PanelManifest } from "../../contracts/src/index.ts";
import { Addons, accessWords, checkManifest } from "../src/addons.ts";
import { envOf, idOf, npmOf, readDsh, readYaml, toolsIn, untar } from "../src/dsh.ts";
import { DshHosts, sandboxProfile } from "../src/dsh-hosts.ts";
import { Sources } from "../src/sources.ts";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

test("npm names as people paste them, and nothing else", () => {
  assert.deepEqual(npmOf("dsh-media-desk"), { name: "dsh-media-desk" });
  assert.deepEqual(npmOf("npm i dsh-media-desk"), { name: "dsh-media-desk" });
  assert.deepEqual(npmOf("npm install -g @scope/x@1.2.3"), { name: "@scope/x", version: "1.2.3" });
  assert.deepEqual(npmOf("dsh plugin --profile web add dsh-media-desk"), { name: "dsh-media-desk" });
  assert.deepEqual(npmOf("pnpm add dsh-free-search@latest"), { name: "dsh-free-search", version: "latest" });
  assert.deepEqual(npmOf("https://www.npmjs.com/package/@michengai/dsh-skills-manager"), { name: "@michengai/dsh-skills-manager" });
  assert.deepEqual(npmOf("npmjs.com/package/dsh-pet/v/0.4.7"), { name: "dsh-pet", version: "0.4.7" });
  // A package may be called what a command's words are: they're read by where they stand.
  assert.deepEqual(npmOf("npm i plugin"), { name: "plugin" });
  assert.deepEqual(npmOf("npm install add"), { name: "add" });
  assert.deepEqual(npmOf("dsh plugin add plugin"), { name: "plugin" });
  for (const no of ["github.com/a/b", "/Users/x/y", "~/x", "./x", "two words", "Some-Name", "npm i a b", "x@^1.2", "npm plugin x", "dsh add x", "https://www.npmjs.com/package/%E0%A4%A"]) assert.equal(npmOf(no), null, no);
  assert.equal(idOf("@michengai/dsh-archive-manager"), "michengai-dsh-archive-manager");
  assert.equal(idOf("liner-thing"), "dsh-liner-thing");
});

test("a patch's YAML: lists, maps, quotes, flow, text blocks, and !!js kept as text", () => {
  const doc = readYaml(`# a patch
- insert:
    - id: demo
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        url: http://127.0.0.1:3000/mcp # local
        on: true
        n: 3
        args: [a, 'b c', 3]
        env: {A: "x y", B: 2}
        headers: !!js "(process.env.K ? { Authorization: 'Bearer ' + process.env.K } : {})"
        notes: |
          one
          two
    - id: other
      name: foo
      disabled: true
`);
  assert.deepEqual(doc, [{ insert: [{ id: "demo", name: "@deepseek-ai/dsh-mcp-client", config: { url: "http://127.0.0.1:3000/mcp", on: true, n: 3, args: ["a", "b c", 3], env: { A: "x y", B: 2 }, headers: { "!!js": `"(process.env.K ? { Authorization: 'Bearer ' + process.env.K } : {})"` }, notes: "one\ntwo\n" } }, { id: "other", name: "foo", disabled: true }] }]);
  assert.throws(() => readYaml("a: &x 1\nb: *x"), /anchors/);
  // What a hostile patch writes is said, never looped on: these once ran the engine out of memory.
  for (const bad of ["a: [}]", "a: [: ]", "a: [a}]", "a: {: 1}", "a: [,]"]) assert.throws(() => readYaml(bad), /where a value goes/, bad);
  assert.deepEqual(readYaml('a: "x\\\\" # c'), { a: "x\\" });
});

test("!!js from the launch environment's keys reads as a key on the card, and nothing more does", () => {
  assert.deepEqual(envOf(`"(process.env.CONTEXT7_API_KEY ? { Authorization: 'Bearer ' + process.env.CONTEXT7_API_KEY } : {})"`, true), { value: { Authorization: "Bearer ${CONTEXT7_API_KEY}" }, keys: ["CONTEXT7_API_KEY"], optional: true });
  assert.deepEqual(envOf(`{ "X-Key": process.env.MY_KEY }`, true), { value: { "X-Key": "${MY_KEY}" }, keys: ["MY_KEY"], optional: false });
  assert.deepEqual(envOf(`'Bearer ' + process.env.TOKEN`, false), { value: "Bearer ${TOKEN}", keys: ["TOKEN"], optional: false });
  for (const no of [`require('fs').readFileSync('/etc/passwd')`, `{ A: process.env.K, B: fetch('x') }`, `({ A: ctx.credentials.get('x') })`, `process.env`]) assert.equal(envOf(no, true), null, no);
});

/** A tarball with whatever headers it's given: what npm makes, and what an attacker would. */
function tarOf(entries: { name: string; body?: string; type?: string; link?: string }[]) {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const h = Buffer.alloc(512);
    const body = Buffer.from(e.body ?? "");
    h.write(e.name, 0, 100);
    h.write("0000644\0", 100);
    h.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
    h.write("00000000000\0", 136);
    h.write(e.type ?? "0", 156);
    if (e.link) h.write(e.link, 157, 100);
    h.write("ustar\0", 257);
    h.write("        ", 148);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

test("a tarball unpacks its own files only: no links, nothing outside its folder", () => {
  const dir = tmp("lc-tar-");
  const out = join(dir, "pkg");
  untar(tarOf([{ name: "package/package.json", body: "{}" }, { name: "package/src/a.js", body: "x" }, { name: "package/..notes.txt", body: "kept" }, { name: "package/link", type: "2", link: "/etc/passwd" }, { name: "package/hard", type: "1", link: "package/package.json" }, { name: "package/../../escape.txt", body: "no" }, { name: "package/dev", type: "3" }]), out);
  assert.equal(readFileSync(join(out, "src/a.js"), "utf8"), "x");
  assert.equal(readFileSync(join(out, "..notes.txt"), "utf8"), "kept");
  assert.ok(existsSync(join(out, "package.json")));
  for (const no of ["link", "hard", "dev"]) assert.ok(!existsSync(join(out, no)), no);
  assert.ok(!existsSync(join(dir, "escape.txt")) && !existsSync(join(tmpdir(), "escape.txt")));
  assert.throws(() => untar(Buffer.from("not a tarball"), out), /doesn't unpack/);
});

/** A DSH plugin package on disk, like dsh-media-desk: a Node half, a browser half in the sidebar, a patch. */
function mediaDesk(o: { host?: string; client?: string; patch?: string; pkg?: Record<string, unknown>; files?: Record<string, string> } = {}) {
  const dir = tmp("lc-dsh-");
  const pkg = { name: "dsh-fake-desk", version: "1.2.3", description: "DeepSeek Harness 插件。一句话记灵感。", type: "module", main: "src/host.js", exports: { ".": "./src/host.js", "./client": "./dist/client.js" }, dsh: { bundle: { patch: "./cordis.patch.yml" }, client: { platform: "web", inject: ["@deepseek-ai/dsh-client-runtime"] } }, ...o.pkg };
  const files: Record<string, string> = {
    "package.json": JSON.stringify(pkg),
    "cordis.patch.yml": o.patch ?? "- insert:\n    - id: fake-desk\n      name: 'dsh-fake-desk'\n",
    "README.en.md": '<h1 align="center">Fake Desk</h1>\n\n<p align="center"><b>A DeepSeek Harness plugin. Keeps your ideas and drafts them.</b></p>\n\n## More\n',
    "src/host.js":
      o.host ??
      `export const name = 'dsh-fake-desk'
export default { inject: ['webServer', 'connection'], apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/fake', handler: async (req, res) => {
    if (ctx.connection.requestRejection({ headers: req.headers })) { res.statusCode = 403; return res.end() }
    if (req.url.startsWith('/fake/ask')) {
      const llm = ctx.get('llm'); const sel = ctx.get('agentDefaultModel').currentSelection()
      const call = await llm.prepareCall({ provider: sel.provider, model: sel.model, maxTokens: 50 }, undefined, (c) => c)
      let text = ''; for await (const ch of call.stream({ ...call.config, system: 'be brief', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] })) { if (ch.type === 'text-delta') text += ch.text; if (ch.type === 'finish' && ch.reason.kind !== 'stop') text = 'ERR ' + ch.reason.failure.message }
      return res.end(JSON.stringify({ text, model: sel.model }))
    }
    if (req.url.startsWith('/fake/write')) {
      const { writeFileSync, mkdirSync } = await import('node:fs'); const { execFileSync } = await import('node:child_process'); const out = {}
      try { mkdirSync(process.env.DSH_HOME + '/proj', { recursive: true }) } catch {}
      for (const p of [process.env.DSH_HOME + '/fake.txt', '/Users/Shared/liner-dsh-probe-' + process.pid, process.env.DSH_HOME + '/proj/package.json', process.env.DSH_HOME + '/proj/run.command']) { try { writeFileSync(p, 'x'); out[p] = 'wrote' } catch (e) { out[p] = e.code } }
      try { mkdirSync(process.env.DSH_HOME + '/proj/.git/hooks', { recursive: true }); writeFileSync(process.env.DSH_HOME + '/proj/.git/hooks/pre-commit', 'x'); out.hook = 'wrote' } catch (e) { out.hook = e.code }
      try { execFileSync('/usr/bin/security', ['list-keychains'], { stdio: 'pipe' }); out.security = 'ran' } catch (e) { out.security = e.code }
      return res.end(JSON.stringify(out))
    }
    res.end(JSON.stringify({ hello: 'from the program', home: process.env.DSH_HOME, keys: Object.keys(process.env).filter((k) => /KEY|TOKEN/.test(k)) }))
  } }))
} }
`,
    "dist/client.js": o.client ?? `window.__ModuleLoader__.load({id:"dsh-fake-desk",factory:(require)=>{const R=require("react");return{inject:["slots"],apply(ctx){ctx.slots.inject("main",()=>ctx.slots.register({name:"main",key:"k"},()=>R.createElement("p",null,"hi")));ctx.slots.inject("sidebar.panellist",()=>ctx.slots.register({name:"sidebar.panellist",id:"k",label:()=>"Fake"},()=>null))}}}})`,
    "assets/dot.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
    "src/llm-note.js": "export const uses = ['llm']\n",
    ...o.files,
  };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}

test("a plugin with a sidebar page and a program becomes a page that runs its program, said in English", () => {
  const r = readDsh(mediaDesk(), { integrity: `sha512-${"A".repeat(86)}==` });
  const m = r.manifest as PanelManifest;
  assert.equal(m.kind, "panel");
  assert.equal(m.place, "page");
  assert.equal(m.id, "dsh-fake-desk");
  assert.equal(m.name, "Fake Desk");
  assert.equal(m.summary, "Keeps your ideas and drafts them.");
  assert.deepEqual(m.access, { ai: true });
  assert.deepEqual(m.dsh, { package: "dsh-fake-desk", version: "1.2.3", integrity: `sha512-${"A".repeat(86)}==`, host: "src/host.js", slot: "sidebar.panellist" });
  assert.deepEqual(Object.keys(r.files ?? {}).sort(), ["client.js", "index.html"]);
  assert.match(r.files!["index.html"], /<div id="dsh-root"><\/div><script src="client.js"><\/script>/);
  assert.match(accessWords(m.access, m.place, m.dsh), /^runs its own program on this Mac · asks a model you pick · its page has no network$/);
});

test("what Liner Code doesn't have is said, and a page with none of its places is refused in words", () => {
  const more = readDsh(mediaDesk({ client: `window.__ModuleLoader__.load({id:"dsh-fake-desk",factory:(require)=>{require("@deepseek-ai/dsh-client-store");return{apply(ctx){ctx.slots.register({name:"sidebar.right.pane.tab",key:"k"},()=>null);ctx.slots.register({name:"conversation.composer.dock",id:"x"},()=>null)}}}})`, patch: "- insert:\n    - id: fake-desk\n      name: 'dsh-fake-desk'\n    - id: t\n      name: '@deepseek-ai/dsh-terminal'\n" }));
  assert.equal((more.manifest as PanelManifest).place, "dock");
  assert.ok(more.left.some((l) => /dsh-client-store/.test(l)));
  assert.ok(more.left.some((l) => /conversation\.composer\.dock/.test(l)));
  assert.ok(more.left.some((l) => /dsh-terminal in DeepSeek Harness/.test(l)));
  assert.throws(() => readDsh(mediaDesk({ client: `window.__ModuleLoader__.load({id:"dsh-fake-desk",factory:()=>({apply(ctx){ctx.slots.register({name:"shell.overlay",id:"pet"},()=>null)}})})` })), /nothing Liner Code can show/);
  assert.throws(() => readDsh(mediaDesk({ pkg: { dsh: undefined } })), /isn't a DeepSeek Harness plugin/);
  assert.throws(() => readDsh(mediaDesk({ client: "console.log('no loader')" })), /module loader/);
  // DSH's template host (export function apply() {}) runs no program.
  assert.equal((readDsh(mediaDesk({ host: "/** Host half */\nexport function apply() {}\n" })).manifest as PanelManifest).dsh?.host, undefined);
});

test("an MCP bundle becomes a connection, its key from the launch environment typed on the card", () => {
  const r = readDsh(mediaDesk({ pkg: { name: "dsh-mcp-docs", exports: { "./locale/*.json": "./locale/*.json" }, dsh: { bundle: { patch: "./cordis.patch.yml" } } }, patch: `- insert:\n    - id: mcp-docs\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: docs\n        transport: streamable-http\n        url: https://mcp.example.com/mcp\n        headers: !!js "(process.env.DOCS_API_KEY ? { Authorization: 'Bearer ' + process.env.DOCS_API_KEY } : {})"\n`, files: { "locale/en.json": JSON.stringify({ meta: { title: "Docs MCP", description: "Docs for your agents." } }) } }));
  const m = r.manifest as ConnectionManifest;
  assert.equal(m.kind, "connection");
  assert.equal(m.id, "docs");
  assert.equal(m.name, "Docs MCP");
  assert.deepEqual(m.server, { http: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer ${DOCS_API_KEY}" } } });
  assert.deepEqual(m.secrets, [{ name: "DOCS_API_KEY", label: "Docs API key", optional: true }]);
  assert.throws(() => readDsh(mediaDesk({ pkg: { dsh: { bundle: { patch: "./cordis.patch.yml" } } }, patch: `- insert:\n    - id: m\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        url: !!js "ctx.root.config.url"\n` })), /beyond a key/);
});

test("the dsh block comes only from Liner Code: never an agent's draft or an addon.json", () => {
  const raw = { apiVersion: 1, id: "sneaky", kind: "panel", name: "Sneaky", place: "page", entry: "index.html", access: {}, dsh: { package: "sneaky", version: "1.0.0", host: "evil.js", slot: "sidebar.panellist" } };
  assert.throws(() => checkManifest(raw), /dsh isn't a key a manifest has here/);
  assert.equal((checkManifest(raw, { dsh: true }) as PanelManifest).dsh?.host, "evil.js");
  assert.throws(() => checkManifest({ ...raw, dsh: { ...raw.dsh, host: "../../etc/x.js" } }, { dsh: true }), /dsh.host is a \.js file in the package/);
});

test("the sandbox's profile: writes only where it keeps its own and your documents, no reading your keys", () => {
  const p = sandboxProfile({ home: "/Users/me", linerHome: "/Users/me/.liner-code", dshHome: "/Users/me/.liner-code/dsh", addonDir: "/Users/me/.liner-code/addons/x", tmp: "/private/tmp" });
  assert.match(p, /\(deny file-write\* \(subpath "\/"\)\)/);
  assert.match(p, /\(allow file-write\* [^\n]*"\/Users\/me\/Documents"/);
  assert.doesNotMatch(p.split("\n").find((l) => l.startsWith("(allow file-write*"))!, /Library|\.ssh|"\/Users\/me"\)/);
  assert.match(p, /\(deny file-read-data [^\n]*"\/Users\/me\/\.ssh"[^\n]*"\/Users\/me\/\.liner-code"/);
  assert.match(p, /\(allow file-read-data \(subpath "\/Users\/me\/\.liner-code\/addons\/x"\) \(subpath "\/Users\/me\/\.liner-code\/dsh"\)\)/);
  assert.match(p, /"\/Users\/me\/\.claude"[^\n]*"\/Users\/me\/\.codex"/);
  assert.match(p, /\(deny file-write\* \(regex #"\/\\\.\(git\|/);
  assert.match(p, /\(deny process-exec [^\n]*"\/usr\/bin\/open"[^\n]*"\/bin\/launchctl"/);
});

test("its program runs in a process of its own, answers its frame through the engine, and asks its model through the bridge", { timeout: 60_000 }, async () => {
  const home = tmp("lc-dsh-home-");
  const addons = new Addons(home);
  const pkg = mediaDesk();
  const r = readDsh(pkg);
  const m = r.manifest as PanelManifest;
  const version = addons.install(m, { by: { agent: "You", from: "npmjs.com/package/dsh-fake-desk", at: Date.now() } }, r.files, { dir: pkg, modules: false });
  const hosts = new DshHosts(addons, { ...process.env, SOME_API_KEY: "must-not-leak" }, home);
  let asked: { prompt: string; system?: string } | null = null;
  hosts.modelOf = () => "Fake 1";
  hosts.ask = async (_addon, _name, o) => {
    asked = { prompt: o.prompt, system: o.system };
    for (const t of ["he", "llo"]) o.onText(t);
    return { text: "hello" };
  };
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const d = /^\/dsh\/([a-f0-9]{32})\/(.*)$/.exec(u.pathname);
    if (!d || !hosts.serve(d[1], d[2], u.search, req, res)) res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  try {
    const frame = await hosts.frame(m, version);
    assert.equal(frame.error, undefined, frame.error);
    assert.match(frame.base!, /^\/dsh\/[a-f0-9]{32}\/$/);
    const at = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${frame.base}${p}`, init);
    const hello = (await (await at("fake/hi", { headers: { origin: "null" } })).json()) as { hello: string; home: string; keys: string[] };
    assert.equal(hello.hello, "from the program");
    assert.equal(hello.home, join(home, "dsh"));
    assert.deepEqual(hello.keys, [], "the engine's environment keys stay out");
    const pre = await at("fake/hi", { method: "OPTIONS", headers: { origin: "null", "access-control-request-method": "POST", "access-control-request-headers": "x-lang" } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "*");
    assert.equal(pre.headers.get("access-control-allow-headers"), "x-lang");
    // Its model: the one picked for it, asked through the engine, streamed back.
    const said = (await (await at("fake/ask")).json()) as { text: string; model: string };
    assert.deepEqual(said, { text: "hello", model: "Fake 1" });
    assert.deepEqual(asked, { prompt: "hello", system: "be brief" });
    // Its package's pictures, from its kept files.
    const pic = await at("plugins/dsh-fake-desk/assets/dot.svg");
    assert.equal(pic.status, 200);
    assert.equal(pic.headers.get("content-security-policy"), "script-src 'none'");
    assert.equal((await at("plugins/dsh-fake-desk/assets/../package.json")).status, 404);
    // Another token, or none of this run's, reaches nothing.
    assert.equal((await fetch(`http://127.0.0.1:${port}/dsh/${"0".repeat(32)}/fake/hi`)).status, 404);
    // On a Mac it writes in its own folder, and nowhere else outside your documents.
    if (hosts.sandbox) {
      const w = (await (await at("fake/write")).json()) as Record<string, string>;
      const probe = Object.keys(w).find((k) => k.startsWith("/Users/Shared/"))!;
      rmSync(probe, { force: true });
      assert.equal(w[join(home, "dsh", "fake.txt")], "wrote");
      assert.equal(w[probe], "EPERM");
      // Not even in its own folder may it leave what runs code later, nor start what would act outside it.
      assert.equal(w[join(home, "dsh", "proj", "package.json")], "EPERM");
      assert.equal(w[join(home, "dsh", "proj", "run.command")], "EPERM");
      assert.equal(w.hook, "EPERM");
      assert.equal(w.security, "EPERM");
    }
    // Turned off, its program stops.
    addons.update(m.id, { enabled: false });
    hosts.changed();
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal((await at("fake/hi")).status, 404);
  } finally {
    hosts.stopAll();
    server.close();
  }
});

test("a program's packages come from npm's registry only, installed in a clean folder of the engine's", async () => {
  const addons = new Addons(tmp("lc-dsh-deps-home-"));
  const sources = new Sources(addons, process.env);
  const dir = mediaDesk({ pkg: { dependencies: { left: "git+https://example.com/evil.git" } } });
  const install = (sources as unknown as { dependencies(dir: string, deps: string[]): Promise<void> }).dependencies.bind(sources);
  await assert.rejects(install(dir, ["left"]), /not npm's registry/);
  for (const spec of ["file:../x", "github:evil/x", "evil/x", "https://x.example/x.tgz", "npm:other@1"]) {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "dsh-fake-desk", dependencies: { left: spec } }));
    await assert.rejects(install(dir, ["left"]), /not npm's registry/, spec);
  }
});

test("a folder's program is part of its version: changed code is a new version, not the one kept", () => {
  const dir = mediaDesk();
  const a = (readDsh(dir).manifest as PanelManifest).dsh!.integrity;
  writeFileSync(join(dir, "src/host.js"), readFileSync(join(dir, "src/host.js"), "utf8") + "\n// changed\n");
  const b = (readDsh(dir).manifest as PanelManifest).dsh!.integrity;
  assert.match(a!, /^sha256-/);
  assert.notEqual(a, b);
});

/**
  A DSH plugin shaped like dsh-free-search: a Node half that gives DSH's agent tools (defineTool from
  @deepseek-ai/dsh-tools), a search provider for web_search, a word for the agent's system prompt,
  and a browser half that only adds to DSH's plugin settings row, so nothing to show.
*/
function fakeSearch(host?: string) {
  return mediaDesk({
    pkg: { name: "dsh-fake-search", description: "Free web search for DeepSeek Harness: three fake engines, no key.", main: "lib/index.js", exports: { ".": "./lib/index.js", "./client": "./dist/client.js" }, dsh: { bundle: { patch: "cordis.patch.yml" }, client: { platform: "web", inject: ["@deepseek-ai/dsh-client-ui-plugin-manager"] } } },
    patch: "- insert:\n    - id: web-search-free\n      name: dsh-fake-search\n      config:\n        greeting: hi\n",
    client: `window.__ModuleLoader__.load({id:"dsh-fake-search",factory:()=>({apply(ctx){ctx.slots.register({name:"plugins.row.config",id:"x"},()=>null)}})})`,
    files: {
      "lib/index.js":
        host ??
        `import { defineTool } from '@deepseek-ai/dsh-tools'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
export const name = 'dsh-fake-search'
export const inject = ['web', 'settings', 'tools', 'systemPrompt']
let stopped = 0
const text = (_a, v) => [{ type: 'text', text: String(v) }]
export function apply(ctx, config) {
  if (typeof SettingsConflictError !== 'function') throw new Error('no settings error')
  ctx.web.registerSearchProvider({ id: 'fake', available: () => true, async search(req) { return { content: 'About ' + req.query + '.', sources: [{ url: 'https://example.com/' + encodeURIComponent(req.query), title: 'Result for ' + req.query, snippet: 'a snippet' }] } } })
  ctx.inject(['webStartup'], () => { throw new Error('webStartup is not here, so this never runs') })
  ctx.inject(['tools'], (sctx) => {
    sctx.effect(() => sctx.tools.register(defineTool({
      name: 'shout',
      description: 'Says the text back in capitals, ' + config.greeting + '.',
      parameters: { text: { type: 'string', required: true, description: 'What to say' }, times: { type: 'integer' } },
      output: { schema: { type: 'string' }, render: text },
      async execute(args) { return (args.text.toUpperCase() + '!').repeat(args.times ?? 1) },
    })))
    sctx.tools.register(defineTool({ name: 'wait_for_stop', description: "Waits until it's stopped.", parameters: {}, output: { schema: { type: 'string' }, render: text },
      execute: (_args, exec) => new Promise((ok) => exec.signal.addEventListener('abort', () => { stopped++; ok('stopped') })) }))
    sctx.tools.register(defineTool({ name: 'stops', description: 'How many calls were stopped.', parameters: {}, output: { schema: { type: 'integer' }, render: text }, async execute() { return stopped } }))
    sctx.tools.register(defineTool({ name: 'boom', description: 'Always fails.', parameters: {}, output: { schema: { type: 'string' }, render: text }, async execute() { throw new Error('it went boom') } }))
    const unnamed = ['sneaky', 'tool'].join('_')
    sctx.tools.register(defineTool({ name: unnamed, description: 'Not on its card.', parameters: {}, output: { schema: { type: 'string' }, render: text }, async execute() { return 'sneaky' } }))
  })
  ctx.systemPrompt.section({ name: 'fake:engines', order: 500, text: 'Use shout for emphasis.' })
  ctx.settings.configure({ auto: false }, ctx.fiber)
}
`,
    },
  });
}

test("the tools a program gives DSH's agent are read from its code by the names written in it", () => {
  const { tools, unnamed } = toolsIn([
    `x.tools.register(defineTool({parameters:{name:{type:"string"}},description:'It\\'s "quoted"\\u0021',name:"late_name",execute(){return{name:"inner"}}}))`,
    "ctx.get('tools').register({ name: 'raw_tool', description: `Raw ${1}`, parameters: { type: 'object' }, output: { render: () => [] }, execute: async () => 1 })",
    "sctx.tools?.register(defineTool({ /* a word */ name: TOOL, description: 'computed' }))",
    "ctx.web.registerFetchProvider(p)",
  ]);
  assert.deepEqual(tools, [{ name: "late_name", description: `It's "quoted"!` }, { name: "raw_tool" }, { name: "web_fetch", description: "Fetch the content of a specific HTTP(S) URL and return it decoded to text." }]);
  assert.equal(unnamed, 1);
});

test("a plugin that gives tools and draws nothing becomes a connection, its tools named on its card", () => {
  const r = readDsh(fakeSearch(), { integrity: `sha512-${"B".repeat(86)}==` });
  const m = r.manifest as DshConnectionManifest;
  assert.equal(m.kind, "connection");
  assert.equal(m.id, "dsh-fake-search");
  assert.equal(m.name, "Fake Search");
  assert.equal(m.dsh.host, "lib/index.js");
  assert.deepEqual(m.dsh.config, { greeting: "hi" });
  assert.deepEqual(
    m.dsh.tools.map((t) => t.name),
    ["shout", "wait_for_stop", "stops", "boom", "web_search"],
  );
  assert.equal(m.dsh.tools[0].description, undefined, "a description worked out as it runs isn't read");
  assert.equal(m.dsh.tools[1].description, "Waits until it's stopped.");
  assert.deepEqual(r.deps, []);
  // What Liner Code answers for it (dsh-tools, dsh-settings) isn't said to be missing; what it can't name is.
  assert.ok(!r.left.some((l) => /dsh-tools|dsh-settings/.test(l)), r.left.join("\n"));
  assert.ok(r.left.some((l) => /works out as it runs/.test(l)));
  assert.ok(r.left.some((l) => /plugins\.row\.config/.test(l)));
  // A program that gives no tools it names, and shows nothing, is still refused in words.
  assert.throws(() => readDsh(fakeSearch(`export function apply(ctx) { ctx.tools.register(make()) }\n`)), /nothing Liner Code can show or give your agents/);
});

test("a plugin's tools connection is Liner Code's to write: never an agent's draft, and only with a program and tools", () => {
  const raw = { apiVersion: 1, id: "sneaky", kind: "connection", name: "Sneaky", dsh: { package: "sneaky", version: "1.0.0", host: "evil.js", tools: [{ name: "do_it" }] } };
  assert.throws(() => checkManifest(raw), /dsh isn't a key a manifest has here/);
  assert.deepEqual((checkManifest(raw, { dsh: true }) as DshConnectionManifest).dsh.tools, [{ name: "do_it" }]);
  assert.throws(() => checkManifest({ ...raw, server: { stdio: { command: "x" } } }, { dsh: true }), /server isn't a key/);
  assert.throws(() => checkManifest({ ...raw, dsh: { ...raw.dsh, tools: [] } }, { dsh: true }), /gives at least one tool/);
  assert.throws(() => checkManifest({ ...raw, dsh: { ...raw.dsh, host: undefined } }, { dsh: true }), /has dsh\.host|has one/);
  assert.throws(() => checkManifest({ ...raw, dsh: { ...raw.dsh, tools: [{ name: "has space" }] } }, { dsh: true }), /a tool's name/);
  assert.throws(() => checkManifest({ ...raw, dsh: { ...raw.dsh, tools: [{ name: "a" }, { name: "a" }] } }, { dsh: true }), /named twice/);
  assert.throws(() => checkManifest({ ...raw, dsh: { ...raw.dsh, slot: "sidebar.panellist" } }, { dsh: true }), /slot isn't a key/);
});

/** An MCP client on stdio, as an agent tool is: it starts the server it's given and speaks JSON-RPC. */
function mcpClient(c: { command: string; args: string[]; env: Record<string, string> }) {
  const child = spawn(c.command, c.args, { env: { ...process.env, ...c.env }, stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map<number, (m: Record<string, unknown>) => void>();
  createInterface({ input: child.stdout! }).on("line", (l) => {
    const m = JSON.parse(l) as { id?: number };
    if (typeof m.id === "number") waiting.get(m.id)?.(m), waiting.delete(m.id);
  });
  let n = 0;
  const request = (method: string, params: Record<string, unknown> = {}) => {
    const id = ++n;
    child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return { id, done: new Promise<Record<string, unknown>>((ok) => waiting.set(id, ok)) };
  };
  return {
    ask: (method: string, params?: Record<string, unknown>) => request(method, params).done,
    request,
    notify: (method: string, params: Record<string, unknown>) => child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`),
    close: () => child.kill(),
  };
}

test("its tools reach your agents as an MCP server: listed as its card named them, run in its own process, stopped when called off", { timeout: 60_000 }, async () => {
  const home = tmp("lc-dsh-tools-home-");
  const addons = new Addons(home);
  const pkg = fakeSearch();
  const r = readDsh(pkg);
  const m = r.manifest as DshConnectionManifest;
  addons.install(m, { by: { agent: "You", from: "npmjs.com/package/dsh-fake-search", at: Date.now() } }, undefined, { dir: pkg, modules: false });
  assert.match(addons.get(m.id)!.reaches, /^its own program on this Mac · gives your agents shout, wait_for_stop, stops and 2 more$/);
  assert.deepEqual(addons.get(m.id)!.dsh, { package: "dsh-fake-search", version: "1.2.3", host: true, tools: ["shout", "wait_for_stop", "stops", "boom", "web_search"] });
  const hosts = new DshHosts(addons, process.env, home);
  // No address for the engine yet: no connection to hand out.
  assert.deepEqual(addons.connections("p1", new Map()), []);
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const d = /^\/dsh\/([a-f0-9]{32})\/(.*)$/.exec(u.pathname);
    if (!d || !hosts.serve(d[1], d[2], u.search, req, res)) res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  hosts.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const [c] = addons.connections("p1", new Map());
  assert.equal(c.name, "dsh-fake-search");
  assert.ok(c.stdio && !c.stdio.args.join(" ").includes(c.stdio.env.LINER_DSH_URL), "its address goes in its environment, not its command line");
  assert.match(c.stdio.env.LINER_DSH_URL, /\/dsh\/[a-f0-9]{32}\/mcp$/);
  const agent = mcpClient(c.stdio);
  try {
    const init = (await agent.ask("initialize", { protocolVersion: "2025-06-18" })) as { result: { instructions?: string; serverInfo: { title: string } } };
    assert.equal(init.result.instructions, "Use shout for emphasis.");
    assert.match(init.result.serverInfo.title, /Fake Search/);
    const list = (await agent.ask("tools/list")) as { result: { tools: { name: string; description: string; inputSchema: unknown }[] } };
    // Only what its card named: the tool it registered under a name worked out as it ran isn't there.
    assert.deepEqual(list.result.tools.map((t) => t.name).sort(), ["boom", "shout", "stops", "wait_for_stop", "web_search"]);
    const shout = list.result.tools.find((t) => t.name === "shout")!;
    assert.equal(shout.description, "Says the text back in capitals, hi.");
    assert.deepEqual(shout.inputSchema, { type: "object", properties: { text: { type: "string", description: "What to say" }, times: { type: "integer" } }, required: ["text"] });
    const call = async (name: string, args: Record<string, unknown> = {}) => ((await agent.ask("tools/call", { name, arguments: args })) as { result: { content: { type: string; text: string }[]; isError?: boolean } }).result;
    assert.deepEqual(await call("shout", { text: "hey", times: 2 }), { content: [{ type: "text", text: "HEY!HEY!" }] });
    // Arguments that don't fit its parameters fail in words, and its body never runs.
    const bad = await call("shout", { times: "two" });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /^Error: invalid arguments: missing required property "text"; "times" must be an integer$/);
    assert.deepEqual(await call("boom"), { content: [{ type: "text", text: "Error: it went boom" }], isError: true });
    const sneaky = await call("sneaky_tool");
    assert.equal(sneaky.isError, true);
    assert.match(sneaky.content[0].text, /no tool called sneaky_tool/);
    // DSH's web_search, over the search provider it registered.
    const found = await call("web_search", { queries: ["liner code"] });
    assert.match(found.content[0].text, /About liner code\./);
    assert.match(found.content[0].text, /- \[Result for liner code\]\(https:\/\/example\.com\/liner%20code\) — a snippet/);
    // An agent that calls a call off stops it in the program.
    const waiting = agent.request("tools/call", { name: "wait_for_stop", arguments: {} });
    await new Promise((ok) => setTimeout(ok, 300));
    agent.notify("notifications/cancelled", { requestId: waiting.id });
    assert.match(JSON.stringify(await waiting.done), /The call was stopped/);
    let stops = "0";
    for (let i = 0; i < 30 && stops === "0"; i++) {
      await new Promise((ok) => setTimeout(ok, 100));
      stops = (await call("stops")).content[0].text;
    }
    assert.equal(stops, "1");
    // The agent's token reaches its MCP endpoint and nothing else.
    const base = c.stdio.env.LINER_DSH_URL.replace(/mcp$/, "");
    assert.equal((await fetch(`${base}mcp`)).status, 404);
    assert.equal((await fetch(`${base}plugins/dsh-fake-search/assets/dot.svg`)).status, 404);
    // Turned off, its tools are gone and its program stops.
    addons.update(m.id, { enabled: false });
    hosts.changed();
    assert.deepEqual(addons.connections("p1", new Map()), []);
    const off = (await agent.ask("tools/list")) as { error?: { message: string } };
    assert.match(off.error?.message ?? "", /off in Liner Code/);
  } finally {
    agent.close();
    hosts.stopAll();
    server.close();
  }
});

test("adding a plugin of tools from a folder shows a card that lists them, and keeps its package", async () => {
  const addons = new Addons(tmp("lc-dsh-src-home-"));
  const sources = new Sources(addons, process.env);
  const dir = fakeSearch();
  const opened = await sources.open(dir);
  assert.notEqual(opened.ask.kind, "panel");
  const ask = opened.ask as ConnectionAsk;
  assert.equal(ask.dsh?.host, true);
  assert.deepEqual(ask.dsh?.gives?.map((t) => t.name), ["shout", "wait_for_stop", "stops", "boom", "web_search"]);
  assert.equal(ask.server, "Its own program, in a process of its own on this Mac");
  assert.deepEqual(ask.secrets, []);
  const got = sources.adopt(opened.token);
  assert.equal(got.kind, "connection");
  assert.ok(addons.packageDir(got.id, got.version), "its package is kept with its version");
});
