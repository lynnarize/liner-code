import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// In dev the engine runs on 7317 with the "liner-dev" token (npm run dev:engine); the proxy adds
// the token, so the app is one origin and nothing about the engine is baked into the bundle.
const engine = process.env.LINER_ENGINE ?? "http://127.0.0.1:7317";
const token = process.env.LINER_TOKEN ?? "liner-dev";
const proxy = { target: engine, changeOrigin: true, headers: { "x-liner-token": token } };

/*
  The modules a ported DeepSeek Harness plugin's frame shares, as DSH's page shares them (React and
  React DOM, platform.ts there): the app's own React, bundled once into a script the frame runs
  before the plugin's client.js (contracts/src/dsh.ts). Imported as text: virtual:dsh-platform.
*/
const dshPlatform = (): Plugin => ({
  name: "dsh-platform",
  resolveId: (id) => (id === "virtual:dsh-platform" ? "\0dsh-platform" : null),
  async load(id) {
    if (id !== "\0dsh-platform") return null;
    const r = await build({
      stdin: { contents: 'self.__dshPlatform={react:require("react"),jsx:require("react/jsx-runtime"),dom:require("react-dom"),client:require("react-dom/client")};', resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "js" },
      bundle: true,
      minify: true,
      format: "iife",
      platform: "browser",
      define: { "process.env.NODE_ENV": '"production"' },
      legalComments: "none",
      write: false,
    });
    return `export default ${JSON.stringify(r.outputFiles[0].text)};`;
  },
});

export default defineConfig({
  plugins: [react(), dshPlatform()],
  base: "./",
  resolve: {
    alias: {
      "@liner": fileURLToPath(new URL("./src/liner", import.meta.url)),
      "@contracts": fileURLToPath(new URL("../contracts/src/index.ts", import.meta.url)),
    },
  },
  // cors: false, so a ported plugin's frame (an opaque origin) has its preflights for /dsh answered by the engine, not refused here first.
  server: { port: 5179, strictPort: true, cors: false, proxy: { "/rpc": proxy, "/events": proxy, "/panel-frame": proxy, "/dsh": proxy } },
  build: { outDir: "dist", chunkSizeWarningLimit: 900 },
});
