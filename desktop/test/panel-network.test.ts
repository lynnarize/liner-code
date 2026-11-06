/*
  A panel's "no network" in real Electron: a page under the panel policy tries STUN, TURN over UDP
  and TURN over TCP, from its top frame and from child frames, and nothing reaches a local server,
  while the same page in a frame without the panel's header does. It's what would catch an Electron
  update that drops Connection-Allowlist: the header would then simply do nothing.
*/
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";

const here = import.meta.dirname;
const require = createRequire(import.meta.url);
type Case = { name: string; opened?: string[]; hits?: Record<string, number>; hostAlive?: boolean; page?: { heard?: Record<string, unknown>[]; got?: unknown; asked?: number; lineEnds?: number }; processes?: { url: string; process: number }[]; origin?: string; heard?: unknown[]; error?: string };

const electron = (() => {
  try {
    return require("electron") as string;
  } catch {
    return "";
  }
})();
const noDisplay = process.platform === "linux" && !process.env.DISPLAY;
const skip = !electron || !existsSync(electron) ? "Electron isn't installed" : noDisplay ? "no display for Electron" : false;

const cases = new Map<string, Case>();
const at = (name: string) => {
  const c = cases.get(name);
  assert.ok(c, `no result for "${name}"`);
  return c;
};
const total = (c: Case) => Object.values(c.hits ?? {}).reduce((a, b) => a + b, 0);

before(
  () => {
    if (skip) return;
    const bundle = join(mkdtempSync(join(tmpdir(), "lc-panel-net-")), "panel.cjs");
    const esbuild = require("esbuild") as typeof import("esbuild");
    esbuild.buildSync({ entryPoints: [join(here, "../../contracts/src/panel.ts")], bundle: true, format: "cjs", platform: "node", outfile: bundle, logLevel: "error" });
    const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
    const r = spawnSync(electron, [join(here, "panel-network.app.cjs")], { encoding: "utf8", timeout: 150_000, env: { ...env, PANEL_BUNDLE: bundle } });
    const lines = r.stdout.split("\n");
    for (const l of lines) if (l.startsWith("CASE ")) (({ name, ...rest }: Case) => cases.set(name, { name, ...rest }))(JSON.parse(l.slice(5)));
    assert.equal(r.status, 0, lines.find((l) => l.startsWith("FAILED")) ?? r.stderr.slice(-2000));
  },
  { timeout: 160_000 },
);

const opts = { skip };

test("the test can see: the same page reaches all three in a frame with no header", opts, () => {
  for (const way of ["control top", "control child"]) {
    const c = at(way);
    assert.ok(c.hostAlive, way);
    for (const k of ["stun", "turn-udp", "turn-tcp"]) assert.ok((c.hits?.[k] ?? 0) > 0, `${way} ${k}: ${JSON.stringify(c.hits)}`);
  }
});

test("a panel reaches nothing: top frame and children, each transport on its own", opts, () => {
  for (const way of ["top", "child", "blank"]) {
    for (const k of ["stun", "turn-udp", "turn-tcp"]) {
      const c = at(`panel ${way} ${k}`);
      assert.equal(total(c), 0, `${c.name}: ${JSON.stringify(c.hits)}`);
      assert.ok(c.hostAlive, `${c.name}: the window around it went`);
    }
  }
});

test("a panel's frame runs apart from the window, so what ends it ends nothing else", opts, () => {
  const c = at("panel blank stun");
  const procs = new Map((c.processes ?? []).map((f) => [new URL(f.url).pathname, f.process]));
  assert.ok(procs.has("/panel-frame"), JSON.stringify(c.processes));
  assert.notEqual(procs.get("/panel-frame"), c.processes?.[0]?.process);
});

test("a panel that looks for WebRTC finds none and carries on; its children still reach nothing", opts, () => {
  const c = at("panel as shipped");
  assert.equal(total(c), 0, JSON.stringify(c.hits));
  assert.ok(c.hostAlive);
  assert.equal(c.page?.heard?.find((m) => m.method === "look")?.args && (c.page.heard.find((m) => m.method === "look")?.args as { webrtc: string }).webrtc, "undefined");
});

test("the one host a panel may reach opens nothing else", opts, () => {
  for (const k of ["stun", "turn-udp", "turn-tcp"]) assert.equal(total(at(`network panel ${k}`)), 0, k);
});

test("addon_check's page holds its panel the same way, and still reaches itself", opts, () => {
  for (const k of ["stun", "turn-udp", "turn-tcp"]) {
    const c = at(`check page ${k}`);
    assert.equal(total(c), 0, c.name);
    assert.equal(c.page?.got, 200, `${c.name}: ${String(c.page?.got)}`);
  }
  assert.equal(total(at("check page escape")), 0, "leaving for another page of this Mac");
});

test("a panel can't leave its frame for one without the header, or for your browser", opts, () => {
  assert.ok(total(at("control escape")) > 0, "from a frame with no header this leaks, or the cases below prove nothing");
  for (const how of ["self to data:", "self to a local page", "self to the web", "meta refresh", "child to data:", "child sends itself to data:"]) {
    for (const name of [`escape ${how}`, `escape ${how} unguarded`]) {
      assert.equal(total(at(name)), 0, name);
      assert.deepEqual(at(name).opened, [], name);
    }
  }
});

test("the window hears when a panel's process ends, and only then", opts, () => {
  assert.ok((at("panel child stun").page?.lineEnds ?? 0) > 0, "a child's WebRTC ended the process: its line should have closed");
  assert.equal(at("a quiet panel").page?.lineEnds, 0);
});

test("a panel that reloads comes back and asks for its document again", opts, () => {
  for (const name of ["a panel reloads", "a network panel reloads"]) assert.ok((at(name).page?.asked ?? 0) > 1, `${name}: asked ${at(name).page?.asked}`);
});

test("a panel still works: the bridge answers and data: and blob: pictures draw", opts, () => {
  const drew = at("a panel draws").page?.heard?.find((m) => m.method === "drew");
  assert.deepEqual(drew?.args, { data: 1, blob: 1, bridge: "object" });
});

test("the frame on its own isn't the app: an opaque origin, and only the app may frame it", opts, () => {
  assert.equal(at("frame alone").origin, "null");
  assert.deepEqual(at("framed by a stranger").heard, []);
});
