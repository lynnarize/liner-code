/*
  Updates: comparing versions, where releases come from, which zip is this Mac's, a release from
  download to waiting (against a GitHub of its own), a swap that didn't go in, and the tool queue
  that waits for sessions to finish. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newerVersion } from "../../contracts/src/index.ts";
import { pickAsset, repoName, teamIn, Updater, versionOf, progressIn } from "../src/updates.ts";
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

const idle = { working: () => 0, restartIdle: () => {} };
const ARCH = process.arch === "arm64" ? "arm64" : "x64";

/** A Liner Code.app small enough for a test: /usr/bin/true under the app's name, signed ad hoc. */
function miniApp(dir: string, version: string) {
  const app = join(dir, "Liner Code.app");
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
  copyFileSync("/usr/bin/true", join(app, "Contents/MacOS/Liner Code"));
  writeFileSync(join(app, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>app.liner.code</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleExecutable</key><string>Liner Code</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`);
  execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "ignore" });
  return app;
}

/** GitHub's releases API for o/n, as much of it as the updater asks for: the latest release and its files. */
async function fakeGitHub(release: () => { tag: string; assets: { name: string; body: Buffer; digest?: string }[] }) {
  const server = createServer((req, res) => {
    const r = release();
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    if (req.url === "/repos/o/n/releases/latest") {
      const assets = r.assets.map((a, i) => ({ id: i, name: a.name, size: a.body.length, url: `${base}/asset/${i}`, digest: a.digest }));
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ tag_name: r.tag, html_url: `${base}/release`, body: "Notes", assets }));
    }
    const asset = /^\/asset\/(\d+)$/.exec(req.url ?? "");
    if (asset) return void res.writeHead(200, { "content-type": "application/octet-stream" }).end(r.assets[Number(asset[1])].body);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, api: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

test("a release is downloaded, checked against its SHA-256, unpacked, checked again and left waiting", { skip: process.platform !== "darwin" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "liner-rel-"));
  const running = miniApp(join(dir, "Applications"), "0.1.0");
  const zip = join(dir, "release.zip");
  execFileSync("ditto", ["-c", "-k", "--keepParent", miniApp(join(dir, "build"), "0.2.0"), zip]);
  const body = readFileSync(zip);
  let digest = `sha256:${"0".repeat(64)}`;
  const gh = await fakeGitHub(() => ({ tag: "v0.2.0", assets: [{ name: `Liner-Code-0.2.0-mac-${ARCH}.zip`, body, digest }] }));
  try {
    const home = mkdtempSync(join(tmpdir(), "liner-up-"));
    const env = { PATH: "/usr/bin:/bin", LINER_UPDATE_REPO: "o/n", LINER_UPDATE_API: gh.api, LINER_APP_BUNDLE: running, LINER_APP_VERSION: "0.1.0" };
    const up = new Updater(new Store(home), env, idle, () => {});
    // A download that isn't what its release says changes nothing.
    await assert.rejects(() => up.download(), /didn't match/);
    assert.ok(!existsSync(join(home, "updates/ready.json")));
    digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
    assert.equal((await up.download()).app.state, "ready");
    assert.equal(JSON.parse(readFileSync(join(home, "updates/ready.json"), "utf8")).version, "0.2.0");
    assert.ok(existsSync(join(home, "updates/Liner Code.app/Contents/MacOS/Liner Code")));
    // A relaunch finds it still waiting.
    assert.equal(new Updater(new Store(home), env, idle, () => {}).state.app.state, "ready");
  } finally {
    gh.server.close();
  }
});

test("a swap that didn't go through says why, and that version isn't tried again by itself", async () => {
  const dir = mkdtempSync(join(tmpdir(), "liner-rel-"));
  mkdirSync(join(dir, "Liner Code.app"));
  const home = mkdtempSync(join(tmpdir(), "liner-up-"));
  const updates = join(home, "updates");
  mkdirSync(join(updates, "Liner Code.app"), { recursive: true });
  writeFileSync(join(updates, "ready.json"), JSON.stringify({ version: "0.2.0", app: join(updates, "Liner Code.app") }));
  // What the shell's swap script leaves when mv is refused.
  writeFileSync(join(updates, "swap-failed.txt"), "mv: rename /Applications/Liner Code.app to /Applications/.Liner Code (replaced 1).app: Operation not permitted\n");
  let tag = "v0.2.0";
  const gh = await fakeGitHub(() => ({ tag, assets: [{ name: `Liner-Code-${tag.slice(1)}-mac-${ARCH}.zip`, body: Buffer.from("zip") }] }));
  try {
    const env = { PATH: "/usr/bin:/bin", LINER_UPDATE_REPO: "o/n", LINER_UPDATE_API: gh.api, LINER_APP_BUNDLE: join(dir, "Liner Code.app"), LINER_APP_VERSION: "0.1.0" };
    const up = new Updater(new Store(home), env, idle, () => {});
    let a = up.state.app;
    assert.equal(a.state, "failed");
    assert.ok(a.stuck);
    assert.match(a.error ?? "", /\(Operation not permitted\)/);
    for (const f of ["swap-failed.txt", "ready.json", "Liner Code.app"]) assert.ok(!existsSync(join(updates, f)), `${f} is cleared`);
    // The next look and a relaunch leave it where it is, rather than failing at every quit.
    a = (await up.check({ app: true, tools: false })).app;
    assert.equal(a.state, "failed");
    assert.ok(a.stuck);
    assert.equal(new Updater(new Store(home), env, idle, () => {}).state.app.stuck, true);
    // A newer release is offered as usual.
    tag = "v0.2.1";
    a = (await up.check({ app: true, tools: false })).app;
    assert.equal(a.state, "available");
    assert.equal(a.stuck, undefined);
    assert.equal(a.latest, "0.2.1");
    // Once that one is waiting, a relaunch offers it, not the one that didn't go in.
    mkdirSync(join(updates, "Liner Code.app"));
    writeFileSync(join(updates, "ready.json"), JSON.stringify({ version: "0.2.1", app: join(updates, "Liner Code.app") }));
    a = new Updater(new Store(home), env, idle, () => {}).state.app;
    assert.equal(a.state, "ready");
    assert.equal(a.latest, "0.2.1");
  } finally {
    gh.server.close();
  }
});

test("a signed copy is pinned to its Team ID; ad-hoc and unsigned copies have none", () => {
  assert.equal(teamIn("Executable=/A.app/Contents/MacOS/A\nAuthority=Developer ID Application: Lin (AB12CD34EF)\nTeamIdentifier=AB12CD34EF\nSealed Resources version=2"), "AB12CD34EF");
  assert.equal(teamIn("Signature=adhoc\nTeamIdentifier=not set\n"), undefined);
  assert.equal(teamIn("code object is not signed at all"), undefined);
});

test("progress: a percentage or a size of a size, the last one printed, and the last line as the step", () => {
  assert.deepEqual(progressIn("Checking for updates\nDownloading claude 2.1.312\r 12%\r 47%\r\x1b[2K 63.5%"), { progress: 0.635, step: "63.5%" });
  assert.deepEqual(progressIn("Fetching 12.5 MB / 50 MB"), { progress: 0.25, step: "Fetching 12.5 MB / 50 MB" });
  assert.deepEqual(progressIn("downloaded 512 KiB of 2 MiB"), { progress: 0.25, step: "downloaded 512 KiB of 2 MiB" });
  assert.deepEqual(progressIn("npm notice\nchanged 1 package in 3s\n"), { progress: undefined, step: "changed 1 package in 3s" });
  assert.equal(progressIn("").step, undefined);
});

test("progress: an updater's output shows while it runs, and is cleared when it's done", async () => {
  const home = mkdtempSync(join(tmpdir(), "liner-up-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  fakeTool(bin, "opencode", "1.0.0", `upgrade) echo "Downloading 1.2.0"; sleep 0.4; echo " 40%"; sleep 0.8; echo 1.2.0 > "$vf";;`);
  const store = new Store(home);
  const seen: { progress?: number; step?: string }[] = [];
  store.on((e) => {
    if (e.type === "updates" && e.updates.tools[0]?.state === "updating") seen.push({ progress: e.updates.tools[0].progress, step: e.updates.tools[0].step });
  });
  const up = new Updater(store, { PATH: `${bin}:/usr/bin:/bin` }, { working: () => 0, restartIdle: () => {} }, () => {});
  (up as unknown as { tools: unknown[] }).tools = [{ id: "opencode", label: "OpenCode", current: "1.0.0", latest: "1.2.0", command: "opencode upgrade", state: "available" }];
  up.updateTool("opencode");
  await until(() => up.state.tools[0].state === "updated");
  assert.ok(seen.some((s) => s.progress === 0.4 && s.step === "40%"), JSON.stringify(seen));
  assert.deepEqual([up.state.tools[0].progress, up.state.tools[0].step], [undefined, undefined]);
});
