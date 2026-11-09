/*
  A ported DeepSeek Harness plugin's page in real Electron: in a panel's sealed frame, its bundle
  loads under the DSH-shaped loader, draws with the shared React, and reaches its own program's
  route and picture at its base, and nothing else on this Mac. Without the frame's dsh=1 (the
  Connection-Allowlist entry for /dsh/), not even those: the allowlist is what lets it through.
*/
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";

const here = import.meta.dirname;
const require = createRequire(import.meta.url);
type Heard = { kind?: string; ping?: string; other?: string; img?: string; message?: string };
type Case = { name: string; hits: Record<string, number>; heard?: Heard[]; error?: string };

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
const said = (c: Case, key: keyof Heard) => c.heard?.find((h) => h.kind === "dsh-test" && h[key] !== undefined)?.[key];

before(
  () => {
    if (skip) return;
    const dir = mkdtempSync(join(tmpdir(), "lc-dsh-frame-"));
    const esbuild = require("esbuild") as typeof import("esbuild");
    esbuild.buildSync({ entryPoints: [join(here, "../../contracts/src/index.ts")], bundle: true, format: "cjs", platform: "node", outfile: join(dir, "contracts.cjs"), logLevel: "error" });
    // The shared modules, as ui/vite.config.ts bundles them for the window.
    const r = esbuild.buildSync({
      stdin: { contents: 'self.__dshPlatform={react:require("react"),jsx:require("react/jsx-runtime"),dom:require("react-dom"),client:require("react-dom/client")};', resolveDir: join(here, "../../ui"), loader: "js" },
      bundle: true,
      minify: true,
      format: "iife",
      platform: "browser",
      define: { "process.env.NODE_ENV": '"production"' },
      write: false,
      logLevel: "error",
    });
    writeFileSync(join(dir, "platform.js"), r.outputFiles[0].text);
    const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
    const out = spawnSync(electron, [join(here, "dsh-frame.app.cjs")], { encoding: "utf8", timeout: 60_000, env: { ...env, PANEL_BUNDLE: join(dir, "contracts.cjs"), PLATFORM_BUNDLE: join(dir, "platform.js") } });
    const lines = out.stdout.split("\n");
    for (const l of lines) if (l.startsWith("CASE ")) (({ name, ...rest }: Case) => cases.set(name, { name, ...rest }))(JSON.parse(l.slice(5)));
    assert.equal(out.status, 0, lines.find((l) => l.startsWith("FAILED")) ?? out.stderr.slice(-2000));
  },
  { timeout: 70_000 },
);

const opts = { skip };

test("a DSH plugin's page draws with the shared React and reaches its own program", opts, () => {
  const c = at("dsh frame");
  assert.equal(said(c, "ping"), "yes", JSON.stringify(c));
  assert.equal(c.hits.ping, 1);
  assert.ok(c.hits.preflight >= 1, "its custom header was preflighted and allowed");
  assert.ok(!c.heard?.some((h) => h.kind === "error"), JSON.stringify(c.heard));
});

test("its package's picture loads from its base", opts, () => {
  const c = at("dsh frame");
  assert.equal(said(c, "img"), "loaded", JSON.stringify(c));
  assert.equal(c.hits.picture, 1);
});

test("anything else on this Mac stays out of its reach", opts, () => {
  const c = at("dsh frame");
  assert.equal(said(c, "other"), "refused", JSON.stringify(c));
  assert.equal(c.hits.secret, 0);
});

test("without the frame's allowlist entry for /dsh/, not even its own program", opts, () => {
  const c = at("no dsh allowlist");
  assert.notEqual(said(c, "ping"), "yes", JSON.stringify(c));
  assert.equal(c.hits.ping, 0);
  assert.equal(c.hits.secret, 0);
});
