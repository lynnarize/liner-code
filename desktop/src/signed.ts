/*
  The shell's own look at a waiting update, right before the swap: the engine checked the download when it came, but the swap
  can be days later, and whatever can write in Liner Code's folder could have put another bundle there meanwhile. No Electron
  here, so it can be tested alone (desktop/test/signed.test.ts). The engine's check is engine/src/updates.ts verify.
*/
import { spawnSync } from "node:child_process";

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
