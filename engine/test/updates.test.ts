/*
  Updates: comparing versions, where releases come from, which zip is this Mac's, and the tool
  queue that waits for sessions to finish. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newerVersion } from "../../contracts/src/index.ts";
import { pickAsset, repoName, Updater, versionOf } from "../src/updates.ts";
import { Store } from "../src/store.ts";

test("versions: the first x.y.z of what a tool prints, compared part by part", () => {
  assert.equal(versionOf("2.1.311 (Claude Code)"), "2.1.311");
  assert.equal(versionOf("codex-cli 0.164.0"), "0.164.0");
  assert.equal(versionOf("Hermes Agent v0.22.2 (2026.9.24) · stable"), "0.22.2");
  assert.equal(versionOf("no version here"), undefined);
  assert.ok(newerVersion("v0.10.0", "0.9.9"));
  assert.ok(newerVersion("2.1.312", "2.1.311"));
  assert.ok(!newerVersion("1.0.0", "1.0.0"));
  assert.ok(!newerVersion("0.9.0", "0.10.0"));
  assert.ok(!newerVersion(undefined, "1.0.0"));
});

test("releases come from a GitHub repository, however package.json names it", () => {
  assert.equal(repoName("github:lynnarize/liner-code"), "lynnarize/liner-code");
  assert.equal(repoName("lynnarize/liner-code"), "lynnarize/liner-code");
  assert.equal(repoName("https://github.com/lynnarize/Liner-Code.git"), "lynnarize/Liner-Code");
  assert.equal(repoName("git@github.com:lynnarize/liner-code.git"), "lynnarize/liner-code");
  assert.equal(repoName({ type: "git", url: "git+https://github.com/o/n.git" }), "o/n");
  assert.equal(repoName(""), undefined);
  assert.equal(repoName("https://gitlab.com/o/n"), undefined);
});

test("the zip for this Mac: its architecture first, then a universal one", () => {
  const assets = [{ name: "Liner-Code-0.2.0-mac-x64.zip" }, { name: "Liner-Code-0.2.0-mac-arm64.zip" }, { name: "Liner-Code-0.2.0-mac-arm64.zip.sha256" }, { name: "Liner-Code-0.2.0-win-x64.zip" }];
  assert.equal(pickAsset(assets, "arm64")?.name, "Liner-Code-0.2.0-mac-arm64.zip");
  assert.equal(pickAsset(assets, "x64")?.name, "Liner-Code-0.2.0-mac-x64.zip");
  assert.equal(pickAsset([{ name: "Liner-Code-0.2.0-mac-universal.zip" }], "arm64")?.name, "Liner-Code-0.2.0-mac-universal.zip");
  assert.equal(pickAsset([{ name: "Liner-Code-0.2.0-mac-x64.zip" }, { name: "Liner-Code-0.2.0-mac-x64.dmg" }], "arm64"), undefined);
  assert.equal(pickAsset([{ name: "notes.txt" }], "arm64"), undefined);
  assert.equal(pickAsset([{ name: "helper-1.0.0-darwin-arm64.zip" }, { name: "Liner-Code-0.2.0-mac-arm64.zip" }], "arm64")?.name, "Liner-Code-0.2.0-mac-arm64.zip");
});

/** Waits until the check holds, or fails after a few seconds. */
async function until(ok: () => boolean) {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(ok(), "it didn't happen in time");
}

/** A fake tool on PATH: prints its version, and its updater moves it to `to` (or fails). */
function fakeTool(dir: string, name: string, version: string, update: string) {
  writeFileSync(join(dir, `${name}.v`), version);
  writeFileSync(join(dir, name), `#!/bin/bash\nvf="$(dirname "$0")/${name}.v"\ncase "$1" in --version) cat "$vf";; ${update}\nesac\n`, { mode: 0o755 });
}

test("a tool waits for the sessions working on it, then updates, and its idle sessions restart", async () => {
  const home = mkdtempSync(join(tmpdir(), "liner-up-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  fakeTool(bin, "opencode", "1.0.0", `upgrade) echo 1.2.0 > "$vf";;`);
  const store = new Store(home);
  let busy = 1;
  const restarted: string[] = [];
  let found = 0;
  const up = new Updater(store, { PATH: `${bin}:/usr/bin:/bin` }, { working: () => busy, restartIdle: (f) => void restarted.push(f) }, () => void found++);
  // As if the registry said 1.2.0: the look itself goes to npm, so set what it found directly.
  (up as unknown as { tools: unknown[] }).tools = [{ id: "opencode", label: "OpenCode", current: "1.0.0", latest: "1.2.0", command: "opencode upgrade", state: "available" }];
  up.updateTool("opencode");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(up.state.tools[0].state, "waiting");
  assert.equal(up.state.tools[0].busy, 1);
  busy = 0;
  void (up as unknown as { next(): Promise<void> }).next();
  await until(() => up.state.tools[0].state === "updated");
  const t = up.state.tools[0];
  assert.equal(t.state, "updated");
  assert.equal(t.current, "1.2.0");
  assert.equal(t.from, "1.0.0");
  assert.deepEqual(restarted, ["opencode"]);
  assert.equal(found, 1);
  // Putting the notice away leaves it up to date.
  assert.equal(up.dismiss("opencode").tools[0].state, "current");
});

test("a tool whose updater fails says why, and stays offered", async () => {
  const home = mkdtempSync(join(tmpdir(), "liner-up-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  fakeTool(bin, "codex", "codex-cli 0.160.0", `update) echo "error: the lock is held" >&2; exit 1;;`);
  const store = new Store(home);
  const up = new Updater(store, { PATH: `${bin}:/usr/bin:/bin` }, { working: () => 0, restartIdle: () => {} }, () => {});
  (up as unknown as { tools: unknown[] }).tools = [{ id: "codex", label: "Codex CLI", current: "0.160.0", latest: "0.165.0", command: "codex update", state: "available" }];
  up.updateTool("codex");
  await until(() => up.state.tools[0].state === "failed");
  const t = up.state.tools[0];
  assert.equal(t.state, "failed");
  assert.equal(t.error, "error: the lock is held");
  assert.throws(() => up.updateTool("opencode" as never), /nothing newer/);
});

test("a copy run from the repo can't put a release in its own place", async () => {
  const home = mkdtempSync(join(tmpdir(), "liner-up-"));
  const up = new Updater(new Store(home), { PATH: "/usr/bin:/bin", LINER_UPDATE_REPO: "o/n" }, { working: () => 0, restartIdle: () => {} }, () => {});
  assert.equal(up.state.app.can, "source");
  assert.equal(up.state.app.repo, "o/n");
  await assert.rejects(() => up.download(), /runs from source/);
  const dir = mkdtempSync(join(tmpdir(), "liner-app-"));
  mkdirSync(join(dir, "Liner Code.app"));
  const installed = new Updater(new Store(home), { PATH: "/usr/bin:/bin", LINER_APP_BUNDLE: join(dir, "Liner Code.app"), LINER_APP_VERSION: "0.3.0" }, { working: () => 0, restartIdle: () => {} }, () => {});
  assert.equal(installed.state.app.can, process.platform === "darwin" ? "install" : "source");
  assert.equal(installed.state.app.current, "0.3.0");
  const moved = new Updater(new Store(home), { PATH: "/usr/bin:/bin", LINER_APP_BUNDLE: "/private/var/folders/x/AppTranslocation/ABC/d/Liner Code.app" }, { working: () => 0, restartIdle: () => {} }, () => {});
  assert.equal(moved.state.app.can, process.platform === "darwin" ? "translocated" : "source");
});
