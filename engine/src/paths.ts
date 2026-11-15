/*
  Where the engine's own files are. From the repo the engine runs as these .ts files; the packaged app
  runs engine/build.ts's bundle, one .js per entry written where engine/src is, beside the skills and
  the demo's files copied as they are. So a path from this folder holds in both, ../../package.json
  and ../../contracts/src/frame-agent.js too, as long as it's asked here and not of a module that
  sits in a subfolder (providers/), which a bundle flattens.
*/
import { join } from "node:path";

/** engine/src, in the repo or inside the app. */
export const ENGINE_DIR = import.meta.dirname;

/** True when this runs from the bundle: this module is then part of a .js, not paths.ts. */
export const BUNDLED = !import.meta.url.endsWith(".ts");

/** A file of the engine's, from engine/src. */
export const enginePath = (...parts: string[]) => join(ENGINE_DIR, ...parts);

/** An entry the engine starts as a process of its own or loads by path ("mcp", "outside", "dsh-host"…): its .ts from source, its .js from the bundle. */
export const script = (name: string) => join(ENGINE_DIR, `${name}.${BUNDLED ? "js" : "ts"}`);
