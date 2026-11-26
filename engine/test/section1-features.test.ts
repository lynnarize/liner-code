import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodedError, FRAME_CHANGED, rpcErrorCode, WRITER_CANCELLED } from "../../contracts/src/index.ts";
import { Store } from "../src/store.ts";
import { Runtime } from "../src/runtime.ts";
import { importable, streamTranscript } from "../src/imports.ts";
import { pickAsset, TOOLS, Updater } from "../src/updates.ts";
import { clampTermSize } from "../src/surfaces.ts";
import { saveExport, sessionJson } from "../src/export.ts";
import { panelCall, refusal } from "../src/panels.ts";
import { Security } from "../src/security.ts";
import { runChecks } from "../src/security-checks.ts";

test("CodedError and rpcErrorCode produce structured error codes alongside legacy sentinel strings", () => {
  const frameErr = new CodedError("FRAME_CHANGED", `${FRAME_CHANGED} changed`);
  assert.equal(rpcErrorCode(frameErr), "FRAME_CHANGED");
  assert.equal(rpcErrorCode(new Error(WRITER_CANCELLED)), "WRITER_CANCELLED");
  assert.equal(rpcErrorCode(new Error(`${FRAME_CHANGED} file`)), "FRAME_CHANGED");
  assert.equal(rpcErrorCode(new Error("plain error")), undefined);
});

test("session approval grants survive a runtime restart and clear only on forget or thread removal", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-grants-"));
  const cwd = mkdtempSync(join(tmpdir(), "lc-grants-proj-"));
  const store1 = new Store(home);
  let rt1: Runtime | undefined;
  try {
    const p = store1.putProject({ id: "p1", name: "proj", path: cwd, git: false, createdAt: 1 });
    const t = store1.putThread({ id: "t1", projectId: p.id, title: "Test", agent: "@claude:default", access: "ask", status: "idle", turns: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }, createdAt: 1, updatedAt: 1, grants: [{ kind: "rule", label: "npm test", parts: ["npm test"] }] });
    rt1 = new Runtime(store1, process.env);
    assert.deepEqual(rt1.grantsOf(t.id).grants, [{ kind: "rule", label: "npm test" }]);
    // Archiving/closing keeps persisted grants until explicitly forgotten or deleted.
    await rt1.closeThread(t.id);
    assert.deepEqual(rt1.grantsOf(t.id).grants, [{ kind: "rule", label: "npm test" }]);
    // Forgetting clears both in-memory and persisted grants.
    rt1.forget(t.id, "rule", "npm test");
    assert.deepEqual(rt1.grantsOf(t.id).grants, []);
    assert.equal(store1.thread(t.id).grants, undefined);
  } finally {
    await rt1?.shutdown();
    store1.flush();
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("streamTranscript reads Claude, OpenCode, and Hermes transcripts asynchronously", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "lc-imp-proj-")));
  const claudeHome = mkdtempSync(join(tmpdir(), "lc-imp-claude-"));
  const hermesHome = mkdtempSync(join(tmpdir(), "lc-imp-hermes-"));
  const opencodeHome = mkdtempSync(join(tmpdir(), "lc-imp-oc-"));
  try {
    const cdir = join(claudeHome, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
    mkdirSync(cdir, { recursive: true });
    writeFileSync(join(cdir, "cl1.jsonl"), [
      JSON.stringify({ type: "user", timestamp: "2026-11-20T10:00:00.000Z", message: { role: "user", content: "Hello Claude" } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-11-20T10:00:05.000Z", message: { role: "assistant", model: "claude-sonnet-4-6", content: [{ type: "text", text: "Hi back" }] } }),
    ].join("\n") + "\n");

    const hdir = join(hermesHome, "sessions");
    mkdirSync(hdir, { recursive: true });
    writeFileSync(join(hdir, "hm1.jsonl"), [
      JSON.stringify({ session_id: "hm1", cwd, role: "user", content: "Inspect memory leak" }),
      JSON.stringify({ role: "assistant", model: "hermes-4", content: "Checked heap." }),
    ].join("\n") + "\n");

    const odir = join(opencodeHome, "storage", "session");
    mkdirSync(odir, { recursive: true });
    writeFileSync(join(odir, "oc1.json"), JSON.stringify({
      id: "oc1",
      directory: cwd,
      title: "Refactor router",
      model: "openai/gpt-5",
      messages: [
        { role: "user", content: "Refactor router" },
        { role: "assistant", content: "Done." },
      ],
    }));

    // OpenCode's own info file holds no messages (they live in storage/message, or opencode.db): it isn't offered, as it would come in empty.
    writeFileSync(join(odir, "oc2.json"), JSON.stringify({ id: "oc2", directory: cwd, title: "Only the info file" }));

    const env = { CLAUDE_CONFIG_DIR: claudeHome, HERMES_HOME: hermesHome, OPENCODE_DATA_DIR: opencodeHome };
    const found = importable(cwd, env, new Set());
    const ids = found.map((x) => `${x.tool}:${x.id}`).sort();
    assert.deepEqual(ids, ["claude:cl1", "hermes:hm1", "opencode:oc1"]);

    const cl = await streamTranscript("claude", "cl1", cwd, env);
    assert.equal(cl.turns, 1);
    assert.equal(cl.model, "claude-sonnet-4-6");
    const hm = await streamTranscript("hermes", "hm1", cwd, env);
    assert.equal(hm.turns, 1);
    assert.equal(hm.model, "hermes-4");
    const oc = await streamTranscript("opencode", "oc1", cwd, env);
    assert.equal(oc.turns, 1);
    assert.equal(oc.title, "Refactor router");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(claudeHome, { recursive: true, force: true });
    rmSync(hermesHome, { recursive: true, force: true });
    rmSync(opencodeHome, { recursive: true, force: true });
  }
});

test("Updater has no Cursor Agent row whose look could run its installer, picks cross-platform release assets, and cancels queued tool updates", () => {
  // Cursor Agent's only update command installs (Hermes's `update --check` is a real look; Cursor's was never seen to be): no row until one is.
  assert.ok(!TOOLS.some((t) => t.id === "cursor"), "a Cursor row would run `cursor-agent update --check`, which may install");
  const assets = [
    { name: "Liner-Code-1.0.0-mac-arm64.zip" },
    { name: "Liner-Code-1.0.0-win-x64.exe" },
    { name: "Liner-Code-1.0.0-linux-x64.AppImage" },
  ];
  assert.equal(pickAsset(assets, "x64", "win32")?.name, "Liner-Code-1.0.0-win-x64.exe");
  assert.equal(pickAsset(assets, "x64", "linux")?.name, "Liner-Code-1.0.0-linux-x64.AppImage");
  assert.equal(pickAsset(assets, "arm64", "darwin")?.name, "Liner-Code-1.0.0-mac-arm64.zip");

  const home = mkdtempSync(join(tmpdir(), "lc-upd-"));
  const store = new Store(home);
  try {
    // Only the LINER_APP_ and LINER_UPDATE_ variables this test sets: run from a Liner Code session, the tests inherit its bundle and version, which made this copy look installable.
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("LINER_APP_") && !k.startsWith("LINER_UPDATE_"))), LINER_APP_PACKAGED: "1" };
    const updater = new Updater(store, env, { working: () => 1, restartIdle: () => {} }, () => {});
    assert.equal(updater.state.app.can, "manual");
    const cancelled = updater.cancelTool();
    assert.ok(cancelled);
    updater.stop();
  } finally {
    store.flush();
    rmSync(home, { recursive: true, force: true });
  }
});

test("clampTermSize clamps invalid or extreme terminal dimensions safely", () => {
  assert.deepEqual(clampTermSize(NaN, -5), { cols: 80, rows: 24 });
  assert.deepEqual(clampTermSize(5, 2), { cols: 20, rows: 5 });
  assert.deepEqual(clampTermSize(9999, 9999), { cols: 500, rows: 200 });
  assert.deepEqual(clampTermSize(120, 40), { cols: 120, rows: 40 });
});

test("sessionJson and saveExport write structured JSON exports to a custom path", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-exp-"));
  const outDir = mkdtempSync(join(tmpdir(), "lc-exp-out-"));
  const store = new Store(home);
  try {
    store.putProject({ id: "p1", name: "proj", path: outDir, git: false, createdAt: 1 });
    store.putThread({ id: "t1", projectId: "p1", title: "Export Me", agent: "@claude:default", access: "auto", status: "done", turns: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }, createdAt: 1, updatedAt: 1 });
    store.putItem("t1", { kind: "user", id: "u1", turn: 1, at: 2, text: "Write a test" });
    const json = await sessionJson(store, "t1", async () => "");
    const target = join(outDir, "nested", "export.json");
    const written = saveExport("Export Me", json, { path: target, format: "json" });
    assert.equal(written, target);
    const parsed = JSON.parse(readFileSync(written, "utf8")) as { thread: { id: string }; items: { id: string }[] };
    assert.equal(parsed.thread.id, "t1");
    assert.equal(parsed.items[0]?.id, "u1");
  } finally {
    store.flush();
    rmSync(home, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("panel bridge supports files.read pagination, truncation metadata, and read-only git.status", async () => {
  const root = mkdtempSync(join(tmpdir(), "lc-panel-"));
  try {
    writeFileSync(join(root, "lines.txt"), "one\ntwo\nthree\nfour\nfive\n");
    const where = { access: { files: "project" as const }, place: "dock" as const, threadId: "t1" };
    assert.equal(refusal(where, "git.status"), null);
    assert.equal(refusal(where, "git.diff"), null);
    assert.notEqual(refusal({ access: {}, place: "dock", threadId: "t1" }, "git.status"), null);
    const env = {
      cwdOf: () => root,
      thread: () => { throw new Error("unused"); },
      threads: () => [],
      timeline: () => [],
      projectName: () => "proj",
      branchOf: () => undefined,
      storage: { all: () => ({}), put: () => {} },
    };
    const page = (await panelCall(env, where, "files.read", { path: "lines.txt", startLine: 2, limit: 2 })) as { text: string; truncated: boolean; startLine: number; endLine: number; totalLines: number };
    assert.equal(page.text, "two\nthree");
    assert.equal(page.truncated, true);
    assert.equal(page.startLine, 2);
    assert.equal(page.endLine, 3);
    const full = (await panelCall(env, where, "files.read", { path: "lines.txt" })) as { text: string; truncated: boolean };
    assert.equal(full.truncated, false);
    assert.equal(full.text, "one\ntwo\nthree\nfour\nfive\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Liner Security runs baseline checks on non-git directories and supports inline SECURITY.md editing and finding notes", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-sec-home-"));
  const proj = mkdtempSync(join(tmpdir(), "lc-sec-nongit-"));
  const store = new Store(home);
  try {
    writeFileSync(join(proj, ".env"), "SECRET_KEY=supersecretvalue123456\n");
    store.putProject({ id: "p1", name: "nongit", path: proj, git: false, createdAt: 1 });
    const sec = new Security(store, process.env);
    const run = await runChecks(sec, "p1");
    const filesCheck = run.results.find((c) => c.check === "files");
    assert.equal(filesCheck?.state, "found", "non-git directory should still scan bad files like .env");
    const findings = sec.findings("p1");
    assert.ok(findings.length >= 1);
    const noted = sec.note(findings[0].id, { kind: "note", text: "Rotated token", by: "you" });
    assert.ok(noted.activity.some((a) => a.kind === "note" && a.text === "Rotated token"));

    const before = sec.modelText("p1");
    assert.equal(before.exists, false);
    const written = sec.writeModel("p1", "# Security\n\n## Areas\n\n### Auth\n- Session cookies\n");
    assert.equal(written.exists, true);
    const after = sec.modelText("p1");
    assert.equal(after.exists, true);
    assert.match(after.text, /Session cookies/);
  } finally {
    store.flush();
    rmSync(home, { recursive: true, force: true });
    rmSync(proj, { recursive: true, force: true });
  }
});
