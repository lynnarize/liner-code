import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// In dev the engine runs on 7317 with the "liner-dev" token (npm run dev:engine); the proxy adds
// the token, so the app is one origin and nothing about the engine is baked into the bundle.
const engine = process.env.LINER_ENGINE ?? "http://127.0.0.1:7317";
const token = process.env.LINER_TOKEN ?? "liner-dev";
const proxy = { target: engine, changeOrigin: true, headers: { "x-liner-token": token } };

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@liner": fileURLToPath(new URL("./src/liner", import.meta.url)),
      "@contracts": fileURLToPath(new URL("../contracts/src/index.ts", import.meta.url)),
    },
  },
  server: { port: 5179, strictPort: true, proxy: { "/rpc": proxy, "/events": proxy } },
  build: { outDir: "dist", chunkSizeWarningLimit: 900 },
});
