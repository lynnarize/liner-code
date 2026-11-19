/*
  The check the shell makes on a waiting update right before it swaps it in (desktop/src/signed.ts): its code signature must
  hold, and when this copy is signed by a developer the update must be signed by the same one. Run with
  `node --test desktop/test/signed.test.ts`.
*/
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { signedAsOurs, teamIn } from "../src/signed.ts";

/** A Liner Code.app small enough for a test: /usr/bin/true under the app's name, signed ad hoc. */
function miniApp(dir: string, version: string) {
  const app = join(dir, "Liner Code.app");
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
  copyFileSync("/usr/bin/true", join(app, "Contents/MacOS/Liner Code"));
  writeFileSync(join(app, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>app.liner.code</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleExecutable</key><string>Liner Code</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`);
  execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "ignore" });
  return app;
}

test("a Team ID is read from codesign's words; ad hoc and unsigned have none", () => {
  assert.equal(teamIn("Authority=Developer ID Application: Lin (AB12CD34EF)\nTeamIdentifier=AB12CD34EF\n"), "AB12CD34EF");
  assert.equal(teamIn("Signature=adhoc\nTeamIdentifier=not set\n"), undefined);
  assert.equal(teamIn("code object is not signed at all"), undefined);
});

test("an update whose signature holds may go in, for a copy with no developer of its own", { skip: process.platform !== "darwin" }, () => {
  const update = miniApp(mkdtempSync(join(tmpdir(), "lc-signed-up-")), "0.2.0");
  const running = miniApp(mkdtempSync(join(tmpdir(), "lc-signed-run-")), "0.1.0");
  assert.equal(signedAsOurs(update, running), true);
});

test("an update changed after it was signed is refused", { skip: process.platform !== "darwin" }, () => {
  const app = miniApp(mkdtempSync(join(tmpdir(), "lc-signed-tamper-")), "0.2.0");
  writeFileSync(join(app, "Contents/MacOS/Liner Code"), "#!/bin/sh\n");
  const running = miniApp(mkdtempSync(join(tmpdir(), "lc-signed-run-")), "0.1.0");
  assert.equal(signedAsOurs(app, running), false);
});

test("a folder that isn't a signed app is refused", { skip: process.platform !== "darwin" }, () => {
  const running = miniApp(mkdtempSync(join(tmpdir(), "lc-signed-run-")), "0.1.0");
  assert.equal(signedAsOurs(mkdtempSync(join(tmpdir(), "lc-signed-notapp-")), running), false);
});
