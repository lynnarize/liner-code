/*
  The shell's own look at a waiting update, right before the swap: the engine checked the download when it came, but the swap
  can be days later, and whatever can write in Liner Code's folder could have put another bundle there meanwhile. No Electron
  here, so it can be tested alone (desktop/test/signed.test.ts). The engine's check is engine/src/updates.ts verify.
*/
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_BUNDLE_ID, APP_BUNDLE_NAME, newerVersion } from "../../contracts/src/index.ts";

/** The Team ID in `codesign -dv --verbose=2`'s words, or nothing for an ad-hoc or unsigned bundle. */
export function teamIn(out: string) {
  const id = /^TeamIdentifier=(.+)$/m.exec(out)?.[1]?.trim();
  return id && id !== "not set" ? id : undefined;
}

const teamOf = (app: string) => teamIn(spawnSync("codesign", ["-dv", "--verbose=2", app], { encoding: "utf8", timeout: 60_000 }).stderr ?? "");

/**
  Whether `update` may take `running`'s place: its signature holds (nothing in it changed since it was signed), and when the
  running copy is signed by a developer, the update is signed by the same one. An ad-hoc copy has no developer to hold it to.
*/
export function signedAsOurs(update: string, running: string) {
  const sig = spawnSync("codesign", ["--verify", "--deep", "--strict", update], { stdio: "ignore", timeout: 120_000 });
  if (sig.status !== 0) return false;
  const mine = teamOf(running);
  return !mine || teamOf(update) === mine;
}

/** An update the engine left in <home>/updates that may go in now. */
export type Waiting = { path: string; version: string; ready: string };

/**
  The update waiting in `home`, looked at again: one that may take `running`'s place (version `current`), nothing (none
  waits, or it's no newer, which the engine clears by itself), or why it doesn't check out. One that doesn't is dropped here,
  bundle and all, and its why is left in refused.json for the engine to say once: left as it was, the engine would announce it
  as ready at every launch, Restart to update would fail each time, and the next good release would never come down.
*/
export function waiting(home: string, running: string, current: string): Waiting | { refused: string } | null {
  const dir = join(home, "updates");
  const ready = join(dir, "ready.json");
  let r: { version?: string; app?: string };
  try {
    r = JSON.parse(readFileSync(ready, "utf8")) as typeof r;
  } catch {
    return null;
  }
  if (!r.version || !newerVersion(r.version, current)) return null;
  const path = join(dir, APP_BUNDLE_NAME);
  const why = whyNot(r.app, path, running);
  if (!why) return { path, version: r.version, ready };
  try {
    refuse(dir, r.version, why);
  } catch (e) {
    // A folder it can't write to: the engine's own look at launch (updates.ts readStaged) finds the same and drops it.
    console.error("[shell] couldn't drop the update that didn't check out:", (e as Error).message);
  }
  return { refused: why };
}

/** Why the bundle at `path` (where ready.json says `said`) can't take `running`'s place, or nothing. */
function whyNot(said: string | undefined, path: string, running: string) {
  if (said !== path) return "It isn't where Liner Code left it.";
  const plist = join(path, "Contents/Info.plist");
  if (!existsSync(plist)) return "It isn't a whole app.";
  let id = "";
  try {
    id = execFileSync("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", plist], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "It isn't a whole app.";
  }
  if (id !== APP_BUNDLE_ID) return "It isn't Liner Code: its bundle id is different.";
  // Checked again here, not only when it was downloaded: the swap can come days later, and it puts this in the app's place.
  if (!signedAsOurs(path, running)) return "Its signature no longer holds, or it isn't signed by whoever signed this copy.";
  return undefined;
}

/** Drops a waiting update that didn't check out, and leaves why for the engine (engine/src/updates.ts readRefused). */
export function refuse(dir: string, version: string, why: string) {
  rmSync(join(dir, "ready.json"), { force: true });
  rmSync(join(dir, APP_BUNDLE_NAME), { recursive: true, force: true });
  writeFileSync(join(dir, "refused.json"), JSON.stringify({ version, why, at: Date.now() }, null, 2));
}
