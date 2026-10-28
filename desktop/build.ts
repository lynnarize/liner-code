/*
  Builds the shell: main.ts and preload.ts bundled to dist/*.cjs (Electron loads CommonJS, and a
  sandboxed preload has to be one file), and on a Mac the addon in native/mac.mm to dist/mac.node.
  It also fetches Electron's binary the first time, since Electron's package doesn't on install.
    node desktop/build.ts
*/
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
mkdirSync(dist, { recursive: true });

const electron = dirname(createRequire(import.meta.url).resolve("electron/package.json"));
if (!existsSync(join(electron, "dist"))) execFileSync(process.execPath, [join(electron, "install.js")], { stdio: "inherit" });

await build({
  entryPoints: { main: join(here, "src/main.ts"), preload: join(here, "src/preload.ts") },
  outdir: dist,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  logLevel: "warning",
});

if (process.platform === "darwin") buildAddon();

/** Node-API is ABI-stable, so this Node's headers build an addon that loads in Electron. */
function buildAddon() {
  const src = join(here, "native/mac.mm");
  const out = join(dist, "mac.node");
  if (existsSync(out) && statSync(out).mtimeMs > statSync(src).mtimeMs) return;
  const headers = [process.env.LINER_NODE_HEADERS, join(dirname(dirname(realpathSync(process.execPath))), "include/node")].find((d) => d && existsSync(join(d, "node_api.h")));
  if (!headers) {
    console.warn("! No Node-API headers beside this Node (set LINER_NODE_HEADERS): the shell runs without its Mac addon, so Vibrancy covers the whole window.");
    return;
  }
  execFileSync("xcrun", ["clang++", "-std=c++20", "-ObjC++", "-fobjc-arc", "-O2", "-bundle", "-undefined", "dynamic_lookup", "-mmacosx-version-min=12.0", "-DNAPI_VERSION=8", `-I${headers}`, "-framework", "AppKit", src, "-o", out], { stdio: "inherit" });
}
