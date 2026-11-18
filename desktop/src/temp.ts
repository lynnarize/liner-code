/*
  What the shell leaves in the temporary folder and takes away again: the sign-in scripts
  runInTerminal writes (main.ts), which can't remove themselves before Terminal has read them.
*/
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/** A sign-in script's name, as runInTerminal makes it: liner-<8 hex>.command (.cmd on Windows). */
const SCRIPT = /^liner-[0-9a-f]{8}\.(command|cmd)$/;

/** Sign-in scripts in `dir` a day old or more: Terminal read them long ago. Nothing else there is touched. */
export function oldScripts(dir: string, now = Date.now()) {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    if (!SCRIPT.test(n)) continue;
    const f = join(dir, n);
    try {
      if (now - statSync(f).mtimeMs > 86_400_000) rmSync(f, { force: true });
    } catch {
      // gone already
    }
  }
}
