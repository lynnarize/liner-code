/*
  The 2026-11-18 polish round, second pass, the add-on side: a path check that took a name starting
  with two dots (..notes) for a way out of the folder, and the Browser's proxy, which read every
  page as UTF-8 text and so served a gzipped one as garbage and a Shift_JIS one with its words mangled.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { AddonManifest } from "../../contracts/src/index.ts";
import { readDraft } from "../src/addons.ts";
import { transcript } from "../src/imports.ts";
import { Proxies } from "../src/proxy.ts";

const ping = (): AddonManifest => ({ apiVersion: 1, id: "ping", kind: "connection", name: "Ping", server: { stdio: { command: process.execPath, args: ["ping.mjs"] } } });

test("a draft in a folder whose name starts with two dots is in the session's folder; .., ../x and a full path elsewhere are not", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lc-r2c-draft-")));
  mkdirSync(join(root, "..drafts"), { recursive: true });
  writeFileSync(join(root, "..drafts", "addon.json"), JSON.stringify(ping()));
  assert.equal(readDraft(root, "..drafts/addon.json").path, "..drafts/addon.json");
  assert.equal(readDraft(root, "..drafts").manifest.id, "ping", "its folder, as for any draft");
  const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "lc-r2c-out-")));
  writeFileSync(join(elsewhere, "addon.json"), JSON.stringify(ping()));
  for (const asked of ["..", "../addon.json", `../${elsewhere.split("/").pop()}/addon.json`, join(elsewhere, "addon.json")]) assert.throws(() => readDraft(root, asked), /in this session's folder/, asked);
  // A link out still isn't followed, a ..name link included.
  symlinkSync(elsewhere, join(root, "..out"));
  assert.throws(() => readDraft(root, "..out/addon.json"), /link to outside/);
});

test("an imported Claude Code session names a ..file by its path in the project, and one outside in full", () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "lc-r2c-proj-")));
  const claude = mkdtempSync(join(tmpdir(), "lc-r2c-claude-"));
  const cdir = join(claude, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(cdir, { recursive: true });
  const line = (o: Record<string, unknown>) => JSON.stringify({ timestamp: "2026-11-18T10:00:00.000Z", cwd, sessionId: "s1", ...o });
  const edit = (file_path: string) => line({ type: "assistant", message: { role: "assistant", model: "claude-opus-5-5", content: [{ type: "tool_use", name: "Edit", input: { file_path } }] } });
  writeFileSync(join(cdir, "s1.jsonl"), [line({ type: "user", message: { role: "user", content: "Tidy the notes" } }), edit(join(cwd, "..notes.md")), edit(join(cwd, "..", "other.md")), edit("/etc/hosts")].join("\n") + "\n");
  const titles = transcript("claude", "s1", cwd, { CLAUDE_CONFIG_DIR: claude }).items.flatMap((i) => (i.kind === "tool" ? [i.title] : []));
  assert.deepEqual(titles, ["Edit ..notes.md", `Edit ${join(cwd, "..", "other.md")}`, "Edit /etc/hosts"]);
});

test("proxy: a dev server that gzips its page anyway gets the probe in the page, not a garbled page", async () => {
  const page = "<!doctype html><html><head><title>Tides</title></head><body><p>Hoch­wasser 06:12 — été</p></body></html>";
  const sjis = Buffer.concat([Buffer.from("<html><head><title>"), Buffer.from([0x93, 0xfa, 0x96, 0x7b]), Buffer.from("</title></head><body></body></html>")]);
  const site = createServer((req, res) => {
    if (req.url === "/") return void res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip" }).end(gzipSync(page));
    if (req.url === "/sjis") return void res.writeHead(200, { "content-type": "text/html; charset=Shift_JIS" }).end(sjis);
    if (req.url === "/odd") return void res.writeHead(200, { "content-type": "text/html", "content-encoding": "compress" }).end("LZW bytes");
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
  const port = (site.address() as { port: number }).port;
  const proxies = new Proxies();
  try {
    const base = await proxies.url(port);
    const r = await fetch(`${base}/`);
    assert.equal(r.headers.get("content-encoding"), null, "it went out as the plain page it now is");
    const html = await r.text();
    assert.match(html, /<head><script src="\/__liner\/probe\.js"><\/script><title>Tides<\/title>/);
    assert.ok(html.includes("Hoch­wasser 06:12 — été"), "its text as it was");
    // A Shift_JIS page keeps its bytes: 日本 is still 93 FA 96 7B, the probe before the title.
    const bytes = Buffer.from(await (await fetch(`${base}/sjis`)).arrayBuffer());
    assert.equal(bytes.toString("latin1"), Buffer.concat([Buffer.from('<html><head><script src="/__liner/probe.js"></script><title>'), Buffer.from([0x93, 0xfa, 0x96, 0x7b]), Buffer.from("</title></head><body></body></html>")]).toString("latin1"));
    // An encoding it can't undo goes on as it came, rather than as garbage with the probe in it.
    const odd = await fetch(`${base}/odd`);
    assert.equal(odd.headers.get("content-encoding"), "compress");
    assert.equal(Buffer.from(await odd.arrayBuffer()).toString(), "LZW bytes");
  } finally {
    proxies.closeAll();
    site.close();
  }
});
