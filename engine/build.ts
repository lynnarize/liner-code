/*
  Builds the engine as the packaged app runs it: each entry bundled by esbuild into one .js, written
  where engine/src is in the repo, with the files the engine reads beside its code (the skills, the
  demo's frames) and contracts/src/frame-agent.js, so every path the engine finds from its own folder
  holds as it does from source (src/paths.ts). From the repo the engine still runs its .ts files;
  only the app runs this. Launch: about 80 ms to LINER_READY on Electron's Node instead of about
  180 ms, and 87 MB instead of 135, since Node no longer strips the types of 70 files each time.
    node engine/build.ts <staged app folder>     writes <folder>/engine and <folder>/contracts
  The Agent SDK stays outside, in the staged node_modules: it finds its own files beside itself.
  Nothing is minified, so a stack in engine.log still names the functions.
*/
import { build, type Plugin } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const here = import.meta.dirname;
const root = join(here, "..");
const [target] = process.argv.slice(2);
if (!target) {
  console.error("usage: node engine/build.ts <staged app folder>");
  process.exit(2);
}
const out = resolve(target);
const src = join(out, "engine", "src");
rmSync(join(out, "engine"), { recursive: true, force: true });
mkdirSync(src, { recursive: true });

/*
  What the engine starts as a process of its own, or loads by path, each found by paths.ts's script():
  main the engine; mcp an agent's Liner Code tools; outside the same for a tool outside the app;
  dsh-mcp a DSH plugin's tools for an agent; dsh-host a DSH plugin's own process, which hands the
  plugin dsh-shims by URL.
*/
const ENTRIES = ["main", "mcp", "outside", "dsh-mcp", "dsh-host", "dsh-shims"];
// main.js is the loader below, so the engine itself is written as engine.js.
const named = (e: string) => (e === "main" ? "engine" : e);

// dsh-host imports dsh-shims and also gives it to the plugin by URL: one module, as from source, not a copy inlined in dsh-host.js.
const shimsApart: Plugin = {
  name: "shims-apart",
  setup(b) {
    b.onResolve({ filter: /^\.\/dsh-shims\.ts$/ }, (a) => (a.importer.endsWith("dsh-host.ts") ? { path: "./dsh-shims.js", external: true } : undefined));
  },
};

await build({
  entryPoints: Object.fromEntries(ENTRIES.map((e) => [named(e), join(here, "src", `${e}.ts`)])),
  outdir: src,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["@anthropic-ai/claude-agent-sdk"],
  plugins: [shimsApart],
  legalComments: "none",
  logLevel: "warning",
});

/*
  The entry the shell starts. It turns on Node's compile cache before the engine is read, so from the
  second launch V8 takes engine.js's compiled code from the cache rather than compiling 1.4 MB again
  (about 18 ms and 8 MB less on Electron's Node 24.22). A cache in the bundle itself would come too
  late: a module is compiled before any of it runs. In the engine's home, beside its other files;
  Node keeps a folder per version of itself in there (v24.22.0-arm64-<hash>-<uid>), and nothing the
  engine starts is told of it. Written once the engine is up, as a kill would lose it at exit; then
  the folders of other Nodes (an Electron from before an update) go, and only when this Node's own is
  there by that name, so a Node that names them otherwise loses nothing.
*/
writeFileSync(
  join(src, "main.js"),
  `// Written by engine/build.ts: Node's compile cache, then the engine (engine.js, from src/main.ts).
import { readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { enableCompileCache, flushCompileCache } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
const cache = join(process.env.LINER_HOME || join(homedir(), ".liner-code"), "cache", "v8");
let on = false;
try {
  on = enableCompileCache(cache).status === 1;
} catch {
  // A home it can't write to: the engine starts without the cache, as it would from source.
}
await import("./engine.js");
if (on)
  try {
    flushCompileCache();
    const mine = \`v\${process.versions.node}-\${process.arch}-\`;
    const names = readdirSync(cache);
    if (names.some((n) => n.startsWith(mine))) for (const n of names) if (/^v\\d+\\.\\d+\\.\\d+-/.test(n) && !n.startsWith(mine)) void rm(join(cache, n), { recursive: true, force: true }).catch(() => {});
  } catch {
    // Nothing to keep this time.
  }
`,
);

/*
  0.2.6 and before ran outside.ts from source, and Settings told people to register exactly that with
  their own tools (`claude mcp add liner-code -e ELECTRON_RUN_AS_NODE=1 -- <app> …/engine/src/outside.ts`,
  api.ts outside.info), which their config keeps. So the name stays, as one import of the bundle:
  Electron's Node runs a .ts entry with nothing to strip as it is, and says nothing on stderr.
*/
writeFileSync(join(src, "outside.ts"), `// Written by engine/build.ts: what Liner Code 0.2.6 and before told your tools to start.\nimport "./outside.js";\n`);

// What the engine reads as files: Liner 2.0's skill (creator.ts, lean.ts) and the Demo's frames (providers/demo-canvas.ts).
cpSync(join(here, "src", "skills"), join(src, "skills"), { recursive: true });
cpSync(join(here, "src", "providers", "demo-foreshore"), join(src, "providers", "demo-foreshore"), { recursive: true });
// So Node takes the .js files as ES modules.
writeFileSync(join(out, "engine", "package.json"), `${JSON.stringify({ name: "@liner-code/engine", private: true, type: "module" })}\n`);
// The frame agent, which the engine serves to a live frame as a file (canvas.ts, proxy.ts). The page bundles its own copy.
rmSync(join(out, "contracts"), { recursive: true, force: true });
mkdirSync(join(out, "contracts", "src"), { recursive: true });
cpSync(join(root, "contracts", "src", "frame-agent.js"), join(out, "contracts", "src", "frame-agent.js"));
