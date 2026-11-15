/*
  Liner Code's version, from its own package.json (the repo's root while developing, the staged one
  inside the app), for what it tells the tools it drives about itself.
*/
import { readFileSync } from "node:fs";
import { enginePath } from "./paths.ts";

export const VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(enginePath("../../package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
