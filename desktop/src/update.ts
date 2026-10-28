/*
  Puts a downloaded Liner Code in place of this one. The engine downloads and checks a release
  into <home>/updates and writes ready.json; this checks it again (where it is, its bundle id, that
  it's newer), then hands the swap to a small script that waits for this app to quit, moves the
  old copy aside, moves the new one in (putting the old one back if that fails) and, for a
  restart, opens it. An app can't replace its own bundle while it runs, so the script outlives it.
*/
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { app } from "electron";

const BUNDLE_ID = "app.liner.code";
const APP_NAME = "Liner Code.app";

const parts = (v: string) => /(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number) ?? null;
function newer(a: string, b: string) {
  const x = parts(a);
  const y = parts(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** This app's bundle ("/Applications/Liner Code.app"), or null when it runs from the repo. */
export function bundlePath() {
  if (!app.isPackaged || process.platform !== "darwin") return null;
  const b = dirname(dirname(dirname(app.getPath("exe"))));
  return b.endsWith(".app") ? b : null;
}

/** The update waiting in `home`, if it's a Liner Code newer than this one. */
export function staged(home: string) {
  const bundle = bundlePath();
  if (!bundle || !home) return null;
  const dir = join(home, "updates");
  const ready = join(dir, "ready.json");
  try {
    const r = JSON.parse(readFileSync(ready, "utf8")) as { version?: string; app?: string };
    const path = join(dir, APP_NAME);
    if (r.app !== path || !r.version || !existsSync(join(path, "Contents/Info.plist"))) return null;
    if (!newer(r.version, app.getVersion())) return null;
    const id = execFileSync("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", join(path, "Contents/Info.plist")], { encoding: "utf8" }).trim();
    if (id !== BUNDLE_ID) return null;
    return { path, version: r.version, ready, bundle };
  } catch {
    return null;
  }
}

const SCRIPT = `#!/bin/bash
# Liner Code's update: waits for the app to quit, then swaps the new copy in.
pid="$1"; new="$2"; dest="$3"; ready="$4"; reopen="$5"; shift 5
# What's left is --env NAME=VALUE pairs: a test copy (LINER_HOME) comes back as itself.
for _ in $(seq 1 600); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
# Still running after a minute: leave everything as it is.
kill -0 "$pid" 2>/dev/null && exit 1
old="$(dirname "$dest")/.Liner Code (replaced $$).app"
if ! mv "$dest" "$old"; then [ "$reopen" = 1 ] && open -n "$@" "$dest"; exit 1; fi
if ! mv "$new" "$dest"; then mv "$old" "$dest"; [ "$reopen" = 1 ] && open -n "$@" "$dest"; exit 1; fi
rm -rf "$old" "$ready"
xattr -dr com.apple.quarantine "$dest" 2>/dev/null
[ "$reopen" = 1 ] && open -n "$@" "$dest"
exit 0
`;

/** Starts the swap; the caller quits the app right after. False when nothing valid is waiting. */
export function install(home: string, reopen: boolean) {
  const s = staged(home);
  if (!s) return false;
  const script = join(tmpdir(), `liner-update-${process.pid}.sh`);
  writeFileSync(script, SCRIPT, { mode: 0o755 });
  const env = Object.entries(process.env).flatMap(([k, v]) => (k.startsWith("LINER_") && v ? ["--env", `${k}=${v}`] : []));
  spawn("/bin/bash", [script, String(process.pid), s.path, s.bundle, s.ready, reopen ? "1" : "0", ...env], { detached: true, stdio: "ignore" }).unref();
  return true;
}
