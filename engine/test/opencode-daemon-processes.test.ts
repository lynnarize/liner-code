/*
  The shared `opencode serve` (providers/opencode-server.ts) is one long-lived process that starts the commands of every
  OpenCode session on it. Its ACP driver learnt the hard way that OpenCode's server and what it starts outlive a plain kill
  as pid 1's; these hold the HTTP driver to the same: a group of its own, a marker an engine after a crash can sweep, and a
  shutdown that waits until all of it has gone. A fake `opencode` (a small Node server) stands in for the real one.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holders, markDir } from "../src/exec.ts";
import { OpenCodeDaemon } from "../src/providers/opencode-server.ts";

const win = process.platform === "win32";
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const kill = (pid?: number) => {
  try {
    if (pid) process.kill(pid, "SIGKILL");
  } catch {
    // gone
  }
};

/** A fake `opencode` whose `serve` answers /api/info and /api/event, and starts a `sleep` the way a session's command would. */
function fakeOpenCode(opts: { ignoreTerm?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lc-oc-daemon-"));
  const bin = join(dir, "opencode");
  const pids = join(dir, "pids.json");
  writeFileSync(
    bin,
    `#!${process.execPath}
const http = require("node:http");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
${opts.ignoreTerm ? 'process.on("SIGTERM", () => {});' : ""}
const kid = spawn("sleep", ["300"], { stdio: "ignore" });
fs.writeFileSync(${JSON.stringify(pids)}, JSON.stringify({ daemon: process.pid, kid: kid.pid }));
const s = http.createServer((req, res) => {
  if (req.url.startsWith("/api/info")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ version: "2.0.0" })); }
  if (req.url.startsWith("/api/event")) { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": hi\\n\\n"); return; }
  res.writeHead(404); res.end();
});
s.listen(0, "127.0.0.1", () => console.log("opencode server listening on http://127.0.0.1:" + s.address().port));
`,
  );
  chmodSync(bin, 0o755);
  const read = async () => {
    for (let i = 0; i < 100 && !existsSync(pids); i++) await tick(20);
    return JSON.parse(readFileSync(pids, "utf8")) as { daemon: number; kid: number };
  };
  return { bin, read };
}

test("Closing OpenCode's shared server ends the commands it started too, not the server alone", { skip: win }, async () => {
  const fake = fakeOpenCode();
  const d = await OpenCodeDaemon.spawn(fake.bin, { ...process.env });
  const { daemon, kid } = await fake.read();
  try {
    assert.ok(alive(kid), "the server's command runs");
    await d.shutdown();
    for (let i = 0; i < 60 && (alive(kid) || alive(daemon)); i++) await tick();
    assert.equal(alive(daemon), false, "the server has gone");
    assert.equal(alive(kid), false, "what the server started has gone with it");
  } finally {
    kill(kid);
    kill(daemon);
  }
});

test("A shared OpenCode server that ignores SIGTERM is gone by the time its shutdown resolves", { skip: win }, async () => {
  const fake = fakeOpenCode({ ignoreTerm: true });
  const d = await OpenCodeDaemon.spawn(fake.bin, { ...process.env });
  const { daemon, kid } = await fake.read();
  try {
    await d.shutdown();
    // A moment for Node to reap its own child once it has been killed.
    for (let i = 0; i < 6 && alive(daemon); i++) await tick();
    assert.equal(alive(daemon), false, "an engine that quits right after the shutdown leaves no server behind");
  } finally {
    kill(kid);
    kill(daemon);
  }
});

test("The shared OpenCode server holds a marker in the engine's folder, so an engine that starts after a crash ends it", { skip: win }, async () => {
  const fake = fakeOpenCode();
  const d = await OpenCodeDaemon.spawn(fake.bin, { ...process.env });
  const { daemon, kid } = await fake.read();
  try {
    const dir = markDir();
    const files = readdirSync(dir).filter((f) => f.startsWith("liner-run-")).map((f) => join(dir, f));
    const held = await Promise.all(files.map((f) => holders(f, [daemon, kid])));
    assert.ok(held.some((h) => h?.has(daemon)), "the server holds a run marker, which what it starts inherits");
    await d.shutdown();
    assert.equal(readdirSync(dir).filter((f) => f.startsWith("liner-run-")).length, 0, "the marker goes with an orderly shutdown");
  } finally {
    kill(kid);
    kill(daemon);
  }
});
