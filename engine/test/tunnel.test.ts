/*
  Liner MCP from the internet, with fake tools and processes only (no real tunnel is ever started here): Tailscale Funnel's
  address read from its status, a Funnel already serving something else left alone, Cloudflare's address read from its
  output, your own address taken only when it's https, and each taken down again.
  Run with `node --test engine/test/tunnel.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Tunnel, ownAddress, type TunnelDeps } from "../src/tunnel.ts";

function tailscale(o: { running?: boolean; serving?: unknown; funnelCode?: number } = {}) {
  const ran: string[] = [];
  const deps: TunnelDeps = {
    which: async (n) => (n === "tailscale" ? "/fake/tailscale" : null),
    run: async (_c, args) => {
      ran.push(args.join(" "));
      if (args[0] === "status") return { code: 0, stdout: JSON.stringify(o.running === false ? { BackendState: "NeedsLogin" } : { BackendState: "Running", Self: { DNSName: "mac.tail1234.ts.net." } }), stderr: "" };
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
