/*
  The Browser's page drawn smaller, in real Electron: a page of another site in a frame sized by
  ui/src/app/browserFrame.ts lays out as wide as a laptop, and its devicePixelRatio is the pixels
  it is really shown at, so a canvas it sizes by its window is the size of its box. It is Chromium
  that carries a frame's zoom into the page inside (in another process too): this is what would
  catch an Electron update that stops, and a change back to a transform, under which the same page
  keeps a canvas thirteen times the box and the whole app slows to a crawl while it animates.
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
type Case = { name: string; css: string; page?: { w: number; h: number; dpr: number; canvas: [number, number]; wide: boolean }; hostDpr?: number; client?: [number, number]; drawn?: [number, number]; processes?: number[]; error?: string };

const electron = (() => {
  try {
    return require("electron") as string;
  } catch {
    return "";
  }
})();
const noDisplay = process.platform === "linux" && !process.env.DISPLAY;
const skip = !electron || !existsSync(electron) ? "Electron isn't installed" : noDisplay ? "no display for Electron" : false;

const BOX = { width: 348, height: 686 };
const cases = new Map<string, Case>();
const at = (name: string) => {
  const c = cases.get(name);
  assert.ok(c, `no result for "${name}"`);
  assert.ok(c.page && c.hostDpr && c.client && c.drawn, `${name}: ${c.error ?? "the page said nothing"}`);
  return c as Required<Case>;
};
/** Canvas pixels over the pixels of the box it fills on screen. */
const overdraw = (c: Required<Case>) => (c.page.canvas[0] * c.page.canvas[1]) / (c.drawn[0] * c.drawn[1] * c.hostDpr ** 2);
const near = (a: number, b: number, by = 0.02) => Math.abs(a - b) <= Math.abs(b) * by;

before(
  () => {
    if (skip) return;
    const bundle = join(mkdtempSync(join(tmpdir(), "lc-browser-zoom-")), "frame.cjs");
    const esbuild = require("esbuild") as typeof import("esbuild");
    esbuild.buildSync({ entryPoints: [join(here, "../../ui/src/app/browserFrame.ts")], bundle: true, format: "cjs", platform: "node", outfile: bundle, logLevel: "error" });
    const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
    const r = spawnSync(electron, [join(here, "browser-zoom.app.cjs")], { encoding: "utf8", timeout: 60_000, env: { ...env, FRAME_BUNDLE: bundle } });
    const lines = r.stdout.split("\n");
    for (const l of lines) if (l.startsWith("CASE ")) (({ name, ...rest }: Case) => cases.set(name, { name, ...rest }))(JSON.parse(l.slice(5)));
    assert.equal(r.status, 0, lines.find((l) => l.startsWith("FAILED")) ?? r.stderr.slice(-2000));
  },
  { timeout: 70_000 },
);

const opts = { skip };

test("the test can see: under a transform the page is asked for every pixel of 1280 by 2523", opts, () => {
  const c = at("under a transform");
  assert.equal(c.page.w, 1280);
  assert.equal(c.page.dpr, c.hostDpr);
  assert.ok(overdraw(c) > 10, `a canvas ${c.page.canvas.join(" by ")} for a box ${c.drawn.join(" by ")}`);
});

test("Desktop in a narrow panel lays out 1280 wide, and its canvas is the size of the box it is shown in", opts, () => {
  const c = at("Desktop in a narrow panel");
  assert.equal(c.page.w, 1280);
  assert.ok(c.page.wide, "the page's own desktop layout");
  assert.ok(near(c.page.h, BOX.height / (BOX.width / 1280)), `as tall as the box at that width: ${c.page.h}`);
  assert.ok(near(c.page.dpr, c.hostDpr * (BOX.width / 1280)), `the pixels it is shown at: ${c.page.dpr} in a window at ${c.hostDpr}`);
  assert.ok(overdraw(c) < 1.05, `a canvas ${c.page.canvas.join(" by ")} for a box ${c.drawn.join(" by ")} at ${c.hostDpr}x`);
});

test("the frame still fills its box, and still says the page's own size: what an agent's screenshot and click go by", opts, () => {
  const c = at("Desktop in a narrow panel");
  assert.ok(near(c.drawn[0], BOX.width, 0.005) && near(c.drawn[1], BOX.height, 0.005), c.drawn.join(" by "));
  assert.deepEqual(c.client, [c.page.w, c.page.h]);
});

test("the page is in a process of its own, where the zoom still reaches it", opts, () => {
  const c = at("Desktop in a narrow panel");
  assert.equal(new Set(c.processes).size, 2, JSON.stringify(c.processes));
});

test("a page at its own pixels is left as it is, and one zoomed in is drawn with more pixels, as a browser zooms", opts, () => {
  const own = at("at its own pixels");
  assert.deepEqual([own.page.w, own.page.h, own.page.dpr], [BOX.width, BOX.height, own.hostDpr]);
  const into = at("zoomed in");
  assert.equal(into.page.w, BOX.width / 1.5);
  assert.ok(near(into.page.dpr, into.hostDpr * 1.5), String(into.page.dpr));
});
