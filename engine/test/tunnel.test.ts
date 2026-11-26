/*
  Liner MCP from the internet, with fake tools and processes only (no real tunnel is ever started here): Tailscale Funnel's
  address read from its status, a Funnel already serving something else left alone, Cloudflare's address read from its
  output, your own address taken only when it's https, and each taken down again. The tools are found on Windows too.
  Run with `node --test engine/test/tunnel.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Tunnel, defaultDeps, findTool, ownAddress, type TunnelDeps } from "../src/tunnel.ts";

function tailscale(o: { running?: boolean; serving?: unknown; funnelCode?: number; self?: Record<string, unknown> } = {}) {
  const ran: string[] = [];
  const deps: TunnelDeps = {
    which: async (n) => (n === "tailscale" ? "/fake/tailscale" : null),
    run: async (_c, args) => {
      ran.push(args.join(" "));
      if (args[0] === "status") return { code: 0, stdout: JSON.stringify(o.running === false ? { BackendState: "NeedsLogin" } : { BackendState: "Running", Self: { DNSName: "mac.tail1234.ts.net.", ...o.self } }), stderr: "" };
      if (args[0] === "funnel" && args[1] === "status") return { code: 0, stdout: JSON.stringify(o.serving ?? {}), stderr: "" };
      if (args[0] === "funnel" && args[1] === "--bg") return o.funnelCode ? { code: o.funnelCode, stdout: "", stderr: "Funnel is not enabled on your tailnet.\nTo enable, visit: https://login.tailscale.com/f/funnel" } : { code: 0, stdout: "", stderr: "" };
      if (args[0] === "version") return { code: 0, stdout: "1.90.0\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    spawn: () => {
      throw new Error("not here");
    },
  };
  return { deps, ran };
}

test("Tailscale Funnel goes up on the listener's port, gives its tailnet address, and comes down with off", async () => {
  const { deps, ran } = tailscale();
  const t = new Tunnel(deps);
  await t.start("tailscale", 7318);
  assert.deepEqual(t.now, { state: "up", url: "https://mac.tail1234.ts.net/mcp", note: "Up, through Tailscale 1.90.0" });
  assert.equal(t.host, "mac.tail1234.ts.net");
  assert.ok(ran.includes("funnel --bg 7318"));
  await t.stop();
  assert.ok(ran.includes("funnel --https=443 off"));
  assert.equal(t.now.state, "off");
  assert.equal(t.host, null);
});

test("A Funnel already serving something else on this Mac is left alone", async () => {
  const { deps, ran } = tailscale({ serving: { Web: { "mac.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } } } });
  const t = new Tunnel(deps);
  await t.start("tailscale", 7318);
  assert.equal(t.now.state, "down");
  assert.match(t.now.note ?? "", /already serves something else/);
  assert.equal(ran.some((r) => r.startsWith("funnel --bg")), false);
  await t.stop();
  assert.equal(ran.includes("funnel --https=443 off"), false, "nothing of Liner's to take down");
});

test("Tailscale not signed in, or Funnel not enabled, says why and stays down", async () => {
  const off = new Tunnel(tailscale({ running: false }).deps);
  await off.start("tailscale", 7318);
  assert.match(off.now.note ?? "", /isn't running or signed in/);
  const no = new Tunnel(tailscale({ funnelCode: 1 }).deps);
  await no.start("tailscale", 7318);
  assert.equal(no.now.state, "down");
  assert.match(no.now.note ?? "", /Funnel is not enabled/);
  assert.equal(no.now.link, "https://login.tailscale.com/f/funnel", "the page Tailscale names is the way out");
});

test("A tailnet without Funnel turned on is told so with Tailscale's page for it, and Funnel, which would wait for it forever, isn't started", async () => {
  // What Tailscale 1.104 says of a node whose tailnet hasn't turned Funnel on: neither "https" nor "funnel" in its caps.
  const { deps, ran } = tailscale({ self: { ID: "nk7vVP3gN921CNTRL", CapMap: { "https://tailscale.com/cap/ssh": null }, Capabilities: ["https://tailscale.com/cap/ssh"] } });
  const t = new Tunnel(deps);
  await t.start("tailscale", 7318);
  assert.equal(t.now.state, "down");
  assert.match(t.now.note ?? "", /Funnel isn't turned on for your tailnet/);
  assert.equal(t.now.link, "https://login.tailscale.com/f/funnel?node=nk7vVP3gN921CNTRL");
  assert.equal(ran.some((r) => r.startsWith("funnel --bg")), false);
  // With both caps it goes up as before.
  const on = new Tunnel(tailscale({ self: { ID: "n1", CapMap: { https: null, funnel: null } } }).deps);
  await on.start("tailscale", 7318);
  assert.equal(on.now.state, "up");
});

test("A tool started by a wrapper script without exec still ends when its time is up, and when the script ends first", { skip: process.platform === "win32" }, async () => {
  // Tailscale's /usr/local/bin/tailscale on a Mac is `#!/bin/sh` and then the app's binary, without exec.
  const dir = mkdtempSync(join(tmpdir(), "liner-tunnel-"));
  try {
    const hangs = join(dir, "hangs");
    writeFileSync(hangs, "#!/bin/sh\necho waiting\nsleep 30\n", { mode: 0o755 });
    const leaves = join(dir, "leaves");
    writeFileSync(leaves, "#!/bin/sh\necho done\nsleep 30 &\nexit 3\n", { mode: 0o755 });
    const { run } = defaultDeps(process.env);
    let t0 = Date.now();
    const timedOut = await run(hangs, [], 300);
    assert.ok(Date.now() - t0 < 3000, `ended after ${Date.now() - t0} ms`);
    assert.equal(timedOut.code, -1);
    assert.match(timedOut.stdout, /waiting/);
    t0 = Date.now();
    const ended = await run(leaves, [], 10_000);
    assert.ok(Date.now() - t0 < 3000, `ended after ${Date.now() - t0} ms`);
    assert.equal(ended.code, 3);
    assert.match(ended.stdout, /done/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A Cloudflare quick tunnel's address is read from its output, and the process ends with off", async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), killed: false, kill() { this.killed = true; return true; } });
  let argv: string[] = [];
  const t = new Tunnel({ which: async (n) => (n === "cloudflared" ? "/fake/cloudflared" : null), run: async () => ({ code: 0, stdout: "", stderr: "" }), spawn: (_c, a) => ((argv = a), child as never) });
  await t.start("cloudflare", 7318);
  assert.deepEqual(argv, ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:7318"]);
  assert.equal(t.now.state, "starting");
  child.stderr.emit("data", Buffer.from("INF |  https://tide-harbour-quiet-moon.trycloudflare.com  |\n"));
  assert.equal(t.now.url, "https://tide-harbour-quiet-moon.trycloudflare.com/mcp");
  assert.equal(t.host, "tide-harbour-quiet-moon.trycloudflare.com");
  await t.stop();
  assert.equal(child.killed, true);
  assert.equal(t.now.state, "off");
});

test("Nothing starts for Off, and your own address must be https", async () => {
  const { deps, ran } = tailscale();
  const t = new Tunnel(deps);
  await t.start("off", 7318);
  assert.deepEqual(ran, []);
  assert.equal(ownAddress("http://liner.example.com"), null);
  assert.equal(ownAddress("https://me:pw@liner.example.com"), null);
  await t.start("own", 7318, "https://liner.example.com/");
  assert.deepEqual(t.now, { state: "up", url: "https://liner.example.com/mcp" });
  await t.start("own", 7318, "http://liner.example.com");
  assert.equal(t.now.state, "down");
});

test("cloudflared's error line naming api.trycloudflare.com isn't taken for the tunnel's address", async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
  const t = new Tunnel({ which: async () => "/fake/cloudflared", run: async () => ({ code: 0, stdout: "", stderr: "" }), spawn: () => child as never });
  await t.start("cloudflare", 7318);
  child.stderr.emit("data", Buffer.from('ERR Error unmarshaling QuickTunnel response: failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup failed\n'));
  assert.equal(t.now.state, "starting");
  assert.equal(t.now.url, undefined);
  await t.stop();
});

test("A cloudflared that can't run says so and stays down, rather than bringing the engine down", async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
  const t = new Tunnel({ which: async () => "/fake/cloudflared", run: async () => ({ code: 0, stdout: "", stderr: "" }), spawn: () => child as never });
  await t.start("cloudflare", 7318);
  // An EventEmitter's "error" with no listener throws: without one, this line would throw here.
  child.emit("error", new Error("spawn /fake/cloudflared EACCES"));
  assert.equal(t.now.state, "down");
  assert.match(t.now.note ?? "", /EACCES/);
  const thrown = new Tunnel({ which: async () => "/fake/cloudflared", run: async () => ({ code: 0, stdout: "", stderr: "" }), spawn: () => { throw new Error("ENOENT"); } });
  await thrown.start("cloudflare", 7318);
  assert.equal(thrown.now.state, "down");
});

test("The wait for an address stops once cloudflared has failed or ended, so its own reason stays", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const how of ["error", "exit"] as const) {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
    const tunnel = new Tunnel({ which: async () => "/fake/cloudflared", run: async () => ({ code: 0, stdout: "", stderr: "" }), spawn: () => child as never });
    await tunnel.start("cloudflare", 7318);
    if (how === "error") child.emit("error", new Error("spawn EACCES"));
    else child.emit("exit", 1);
    const said = tunnel.now.note;
    t.mock.timers.tick(30_000);
    assert.equal(tunnel.now.note, said, how);
    assert.doesNotMatch(tunnel.now.note ?? "", /within 30 seconds/);
  }
});

test("On Windows the tools are found on the PATH by their .exe, with Windows' separator, and Tailscale where its installer puts it", () => {
  const files = new Set(["C:\\Tools\\cloudflared.exe", "C:\\Program Files\\Tailscale\\tailscale.exe", "C:\\Shims\\cloudflared.cmd"]);
  const has = (f: string) => files.has(f);
  const env = { Path: 'C:\\Windows;"C:\\Tools";C:\\Shims', PATHEXT: ".COM;.EXE;.BAT;.CMD", ProgramFiles: "C:\\Program Files" };
  assert.equal(findTool("cloudflared", env, "win32", has), "C:\\Tools\\cloudflared.exe");
  assert.equal(findTool("tailscale", env, "win32", has), "C:\\Program Files\\Tailscale\\tailscale.exe");
  // A .cmd needs a shell to start, which the tunnel doesn't use: not taken.
  assert.equal(findTool("cloudflared", { PATH: "C:\\Shims", PATHEXT: ".CMD;.EXE" }, "win32", has), null);
  // The Mac's way is unchanged.
  const mac = new Set(["/opt/homebrew/bin/cloudflared"]);
  assert.equal(findTool("cloudflared", { PATH: "/usr/bin:/opt/homebrew/bin" }, "darwin", (f) => mac.has(f)), "/opt/homebrew/bin/cloudflared");
  assert.equal(findTool("tailscale", { PATH: "/usr/bin" }, "darwin", (f) => f === "/Applications/Tailscale.app/Contents/MacOS/Tailscale"), "/Applications/Tailscale.app/Contents/MacOS/Tailscale");
});

test("What a tunnel says when its tool is missing fits the computer it runs on", async () => {
  const none = { which: async () => null, run: async () => ({ code: 0, stdout: "", stderr: "" }), spawn: () => { throw new Error("no"); } };
  const pc = new Tunnel({ ...none, platform: "win32" });
  await pc.start("cloudflare", 7318);
  assert.match(pc.now.note ?? "", /this PC.*winget install --id Cloudflare\.cloudflared/);
  await pc.start("tailscale", 7318);
  assert.match(pc.now.note ?? "", /isn't on this PC/);
  const mac = new Tunnel({ ...none, platform: "darwin" });
  await mac.start("cloudflare", 7318);
  assert.match(mac.now.note ?? "", /this Mac.*brew install cloudflared/);
});

test("A stop that comes while an earlier tunnel is still coming down leaves no tunnel starting after it", async () => {
  let release!: () => void;
  const ran: string[] = [];
  const deps: TunnelDeps = {
    which: async (n) => (n === "tailscale" ? "/fake/tailscale" : "/fake/cloudflared"),
    run: async (_c, args) => {
      ran.push(args.join(" "));
      // Taking Funnel down is slow: the next start waits on it.
      if (args.join(" ") === "funnel --https=443 off") await new Promise<void>((r) => (release = r));
      if (args[0] === "status") return { code: 0, stdout: JSON.stringify({ BackendState: "Running", Self: { DNSName: "mac.tail1234.ts.net." } }), stderr: "" };
      return { code: 0, stdout: "{}", stderr: "" };
    },
    spawn: () => {
      throw new Error("cloudflared must not start after the stop");
    },
  };
  const t = new Tunnel(deps);
  await t.start("tailscale", 7318);
  assert.equal(t.now.state, "up");
  const next = t.start("cloudflare", 7318);
  await new Promise((r) => setImmediate(r));
  const off = t.stop();
  release();
  await Promise.all([next, off]);
  assert.equal(t.now.state, "off");
});
