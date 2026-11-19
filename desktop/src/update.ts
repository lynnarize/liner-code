/*
  Puts a downloaded Liner Code in place of this one. The engine downloads and checks a release
  into <home>/updates and writes ready.json; this checks it again (where it is, its bundle id, that
  it's newer, and that its signature still holds: signed.ts; one that doesn't check out is dropped there, for the engine to
  say so), then hands the swap to a small script that waits for this app to quit, moves the
  old copy aside, moves the new one in (putting the old one back if that fails, and leaving why
  for the engine to show) and, for a restart, opens it. An app can't replace its own bundle while
  it runs, so the script outlives it.
*/
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { app } from "electron";
import { waiting } from "./signed.ts";

/** This app's bundle ("/Applications/Liner Code.app"), or null when it runs from the repo. */
export function bundlePath() {
  if (!app.isPackaged || process.platform !== "darwin") return null;
  const b = dirname(dirname(dirname(app.getPath("exe"))));
  return b.endsWith(".app") ? b : null;
}

/** The update waiting in `home`: one to put in, why one waiting didn't check out (it's dropped: signed.ts waiting), or nothing. */
export function staged(home: string) {
  const bundle = bundlePath();
  if (!bundle || !home) return null;
  const w = waiting(home, bundle, app.getVersion());
  return w && "path" in w ? { ...w, bundle } : w;
}

const SCRIPT = `#!/bin/bash
# Liner Code's update: waits for the app to quit, then swaps the new copy in.
pid="$1"; new="$2"; dest="$3"; ready="$4"; reopen="$5"; shift 5
# What's left is --env NAME=VALUE pairs: a test copy (LINER_HOME) comes back as itself.
envs=("$@")
again() { [ "$reopen" = 1 ] && open -n "\${envs[@]}" "$dest"; }
# A swap that doesn't go through leaves why beside ready.json, for the app to say when it opens.
fail() { printf '%s\\n' "$1" > "$(dirname "$ready")/swap-failed.txt"; again; exit 1; }
for _ in $(seq 1 600); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
# Still running after a minute: leave everything as it is.
kill -0 "$pid" 2>/dev/null && exit 1
old="$(dirname "$dest")/.Liner Code (replaced $$).app"
if ! err="$(mv "$dest" "$old" 2>&1)"; then fail "$err"; fi
if ! err="$(mv "$new" "$dest" 2>&1)"; then mv "$old" "$dest"; fail "$err"; fi
rm -rf "$old" "$ready"
xattr -dr com.apple.quarantine "$dest" 2>/dev/null
again
exit 0
`;

/** Starts the swap ("started"; the caller quits the app right after), or says there was none, or one that didn't check out. */
export function install(home: string, reopen: boolean): "started" | "refused" | "none" {
  const s = staged(home);
  if (!s) return "none";
  if ("refused" in s) return "refused";
  const script = join(tmpdir(), `liner-update-${process.pid}.sh`);
  writeFileSync(script, SCRIPT, { mode: 0o755 });
  const env = Object.entries(process.env).flatMap(([k, v]) => (k.startsWith("LINER_") && v ? ["--env", `${k}=${v}`] : []));
  spawn("/bin/bash", [script, String(process.pid), s.path, s.bundle, s.ready, reopen ? "1" : "0", ...env], { detached: true, stdio: "ignore" }).unref();
  return "started";
}
