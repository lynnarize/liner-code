/*
  The check the shell makes on a waiting update right before it swaps it in (desktop/src/signed.ts): its code signature must
  hold, and when this copy is signed by a developer the update must be signed by the same one; one that doesn't is dropped,
  with why left for the engine. Run with `node --test desktop/test/signed.test.ts`.
*/
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { signedAsOurs, teamIn, waiting } from "../src/signed.ts";

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

/** A Liner Code home with `version` downloaded and waiting, as the engine leaves it (engine/src/updates.ts fetchApp). */
function stagedHome(version: string) {
  const home = mkdtempSync(join(tmpdir(), "lc-signed-home-"));
  const updates = join(home, "updates");
  const app = miniApp(updates, version);
  writeFileSync(join(updates, "ready.json"), JSON.stringify({ version, app }));
  return { home, updates, app };
}

test("a waiting update that checks out is left as it is, to go in", { skip: process.platform !== "darwin" }, () => {
  const running = miniApp(mkdtempSync(join(tmpdir(), "lc-signed-run-")), "0.1.0");
  const { home, updates, app } = stagedHome("0.2.0");
  assert.deepEqual(waiting(home, running, "0.1.0"), { path: app, version: "0.2.0", ready: join(updates, "ready.json") });
  for (const f of ["ready.json", "Liner Code.app"]) assert.ok(existsSync(join(updates, f)), `${f} stays`);
  assert.ok(!existsSync(join(updates, "refused.json")));
});

test("a waiting update that doesn't check out is removed, with why left for the engine to say", { skip: process.platform !== "darwin" }, () => {
  const running = miniApp(mkdtempSync(join(tmpdir(), "lc-signed-run-")), "0.1.0");
  const { home, updates, app } = stagedHome("0.2.0");
  writeFileSync(join(app, "Contents/MacOS/Liner Code"), "#!/bin/sh\n");
  const r = waiting(home, running, "0.1.0");
  assert.ok(r && "refused" in r);
  assert.match(r.refused, /signature/);
  // Gone, so the engine doesn't announce it again and the next download can take its place.
  for (const f of ["ready.json", "Liner Code.app"]) assert.ok(!existsSync(join(updates, f)), `${f} is gone`);
  const left = JSON.parse(readFileSync(join(updates, "refused.json"), "utf8")) as { version: string; why: string };
  assert.equal(left.version, "0.2.0");
  assert.equal(left.why, r.refused);
  // Asked again (a quit after a refused Restart to update), nothing waits.
  assert.equal(waiting(home, running, "0.1.0"), null);
});

test("a waiting update that isn't Liner Code is removed too", { skip: process.platform !== "darwin" }, () => {
  const running = miniApp(mkdtempSync(join(tmpdir(), "lc-signed-run-")), "0.1.0");
  const { home, updates, app } = stagedHome("0.2.0");
  writeFileSync(join(app, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.example.other</string><key>CFBundleShortVersionString</key><string>0.2.0</string><key>CFBundleExecutable</key><string>Liner Code</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`);
  const r = waiting(home, running, "0.1.0");
  assert.ok(r && "refused" in r);
  assert.match(r.refused, /bundle id/);
  assert.ok(!existsSync(join(updates, "Liner Code.app")));
});

test("a waiting update no newer than this copy is left for the engine to clear, without a word", { skip: process.platform !== "darwin" }, () => {
  const running = miniApp(mkdtempSync(join(tmpdir(), "lc-signed-run-")), "0.2.0");
  const { home, updates } = stagedHome("0.2.0");
  assert.equal(waiting(home, running, "0.2.0"), null);
  assert.ok(!existsSync(join(updates, "refused.json")));
  assert.equal(waiting(mkdtempSync(join(tmpdir(), "lc-signed-empty-")), running, "0.1.0"), null);
});
