import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { portOffsetFor, resolveWorktreePath, worktreeHookPath } from "../src/worktrees.ts";
import { loadLayeredPatch } from "../src/patches.ts";
import { distillSessionToMemory, memoryNote, readWorkspaceMemory, workspaceMemoryPath, writeWorkspaceMemory } from "../src/memory.ts";
import { evaluatePermissionMatrix, globMatch } from "../src/risk.ts";
import { eventsIn, parseAttachArgs, rpcCall } from "../src/attach.ts";
import { startServer } from "../src/server.ts";
import { resolveContainedPath } from "../src/providers/acp.ts";

test("resolveWorktreePath supports .worktrees/ inside repo, excludes it in git info, and portOffsetFor stays in 1..499", () => {
  const repo = mkdtempSync(join(tmpdir(), "lc-wt-repo-"));
  const defRoot = mkdtempSync(join(tmpdir(), "lc-wt-def-"));
  try {
    mkdirSync(join(repo, ".git", "info"), { recursive: true });
    writeFileSync(join(repo, ".git", "info", "exclude"), "# git exclude\n");
    const inside = resolveWorktreePath(repo, "th_abc123", defRoot, "inside");
    assert.equal(inside, join(repo, ".worktrees", "th_abc123"));
    assert.match(readFileSync(join(repo, ".git", "info", "exclude"), "utf8"), /\.worktrees\//);

    const sibling = resolveWorktreePath(repo, "th_abc123", defRoot, "sibling");
    assert.equal(sibling, join(defRoot, "th_abc123"));

    const off = portOffsetFor("th_abc123");
    assert.ok(off >= 1 && off <= 499);
    assert.equal(portOffsetFor("th_abc123"), off);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(defRoot, { recursive: true, force: true });
  }
});

test("worktreeHookPath accepts regular .liner/worktree-setup.sh inside root and rejects escaping symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-hook-root-"));
  const outside = mkdtempSync(join(tmpdir(), "lc-hook-out-"));
  try {
    mkdirSync(join(root, ".liner"), { recursive: true });
    const hook = join(root, ".liner", "worktree-setup.sh");
    writeFileSync(hook, "#!/bin/sh\necho ok\n");
    assert.equal(worktreeHookPath(root), realpathSync(hook));

    rmSync(hook);
    writeFileSync(join(outside, "evil.sh"), "echo evil\n");
    symlinkSync(join(outside, "evil.sh"), hook);
    assert.equal(worktreeHookPath(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("loadLayeredPatch merges user and project patch.json overlays with project precedence", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-patch-home-"));
  const proj = mkdtempSync(join(tmpdir(), "lc-patch-proj-"));
  try {
    writeFileSync(
      join(home, "patch.json"),
      JSON.stringify({
        toolPreset: "lean",
        maxActiveSubagents: 20,
        permissionRules: [{ kind: "command", pattern: "rm *", action: "deny" }],
      }),
    );
    mkdirSync(join(proj, ".liner"), { recursive: true });
    writeFileSync(
      join(proj, ".liner", "patch.json"),
      JSON.stringify({
        toolPreset: "standard",
        sidekickContext: "fork",
        permissionRules: [{ kind: "path", pattern: "**/.env*", action: "deny" }],
      }),
    );
    const merged = loadLayeredPatch(home, proj);
    assert.equal(merged.toolPreset, "standard");
    assert.equal(merged.sidekickContext, "fork");
    assert.equal(merged.maxActiveSubagents, 8);
    assert.equal(merged.permissionRules?.length, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(proj, { recursive: true, force: true });
  }
});

test("a repository's own .liner/patch.json can't let its commands run without asking: its allow rules are dropped, its deny and ask kept", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-patch-home-"));
  const proj = mkdtempSync(join(tmpdir(), "lc-patch-proj-"));
  try {
    writeFileSync(join(home, "patch.json"), JSON.stringify({ permissionRules: [{ kind: "command", pattern: "npm test*", action: "allow" }] }));
    mkdirSync(join(proj, ".liner"), { recursive: true });
    writeFileSync(
      join(proj, ".liner", "patch.json"),
      JSON.stringify({
        permissionRules: [
          { kind: "command", pattern: "*", action: "allow" },
          { kind: "command", pattern: "git push*", action: "ask" },
          { kind: "path", pattern: "**/.env*", action: "deny" },
        ],
      }),
    );
    const rules = loadLayeredPatch(home, proj).permissionRules ?? [];
    assert.deepEqual(
      rules.map((r) => `${r.action} ${r.pattern}`),
      ["allow npm test*", "ask git push*", "deny **/.env*"],
    );
    // So `npm publish` still comes to the person: nothing the project said allows it.
    assert.equal(evaluatePermissionMatrix(rules, { command: "npm publish" }), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(proj, { recursive: true, force: true });
  }
});

test("workspace MEMORY.md supports read/write, session distillation with deduplication, and refuses escaping symlinks", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-mem-home-"));
  const proj = mkdtempSync(join(tmpdir(), "lc-mem-proj-"));
  const away = mkdtempSync(join(tmpdir(), "lc-mem-away-"));
  const store = new Store(home);
  try {
    store.putProject({ id: "p1", name: "proj", path: proj, git: false, createdAt: 1 });
    store.putThread({ id: "t1", projectId: "p1", title: "Fix login", agent: "@claude:default", access: "auto", status: "done", turns: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }, createdAt: 1, updatedAt: 1 });
    store.putItem("t1", { kind: "user", id: "u1", turn: 1, at: 2, text: "Fix cookie SameSite flag" });
    store.putItem("t1", { kind: "text", id: "a1", turn: 1, at: 3, text: "Updated auth middleware to set SameSite=Lax on session cookies.", streaming: false });

    assert.equal(readWorkspaceMemory(proj).exists, false);
    const first = distillSessionToMemory(store, "t1");
    assert.equal(first.added, 2);
    assert.match(first.text, /Fix cookie SameSite flag/);
    const second = distillSessionToMemory(store, "t1");
    assert.equal(second.added, 0);

    const note = memoryNote(home, "p1", proj);
    assert.match(note, /Workspace MEMORY\.md/);
    assert.match(note, /SameSite=Lax/);

    writeWorkspaceMemory(proj, "# Memory\n- Use npm test\n");
    assert.match(readWorkspaceMemory(proj).text, /Use npm test/);

    rmSync(join(proj, "MEMORY.md"));
    writeFileSync(join(away, "secret.md"), "nope\n");
    symlinkSync(join(away, "secret.md"), join(proj, "MEMORY.md"));
    assert.throws(() => workspaceMemoryPath(proj), /outside the project/);
  } finally {
    store.flush();
    rmSync(home, { recursive: true, force: true });
    rmSync(proj, { recursive: true, force: true });
    rmSync(away, { recursive: true, force: true });
  }
});

test("evaluatePermissionMatrix uses last-match-wins glob semantics for commands and paths", () => {
  assert.equal(globMatch("git push*", "git push origin main"), true);
  assert.equal(globMatch("**/.env*", "packages/api/.env.local", true), true);
  assert.equal(globMatch("src/*.ts", "src/nested/a.ts", true), false);

  const rules = [
    { kind: "command" as const, pattern: "npm *", action: "allow" as const },
    { kind: "command" as const, pattern: "npm publish*", action: "deny" as const },
    { kind: "path" as const, pattern: "src/**", action: "allow" as const },
    { kind: "path" as const, pattern: "src/secrets/**", action: "ask" as const },
  ];
  assert.equal(evaluatePermissionMatrix(rules, { command: "npm test" })?.action, "allow");
  assert.equal(evaluatePermissionMatrix(rules, { command: "npm publish --access public" })?.action, "deny");
  assert.equal(evaluatePermissionMatrix(rules, { path: "src/app.ts" })?.action, "allow");
  assert.equal(evaluatePermissionMatrix(rules, { path: "src/secrets/key.ts" })?.action, "ask");
  assert.equal(evaluatePermissionMatrix(rules, { command: "cargo test" }), null);
});

test("npm run attach reaches the real engine with its token, and reads its events a line at a time", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-attach-"));
  const store = new Store(home);
  const server = await startServer({ store, api: { call: async (method: string) => ({ method }), ready: Promise.resolve() }, snapshot: async () => ({}) as never, token: "tok", port: 0 });
  try {
    const cfg = { base: `http://127.0.0.1:${server.port}`, token: "tok" };
    assert.deepEqual(await rpcCall(cfg, "state.get"), { method: "state.get" });
    await assert.rejects(rpcCall({ ...cfg, token: "wrong" }, "state.get"), /refused the token/);
    // The engine writes one JSON event a line (application/x-ndjson); a line cut short waits for the rest.
    const { events, rest } = eventsIn(`${JSON.stringify({ type: "delta", threadId: "th_1", text: "Hi" })}\n${JSON.stringify({ type: "item", threadId: "th_1", item: { kind: "notice", text: "Done" } })}\n{"type":"del`);
    assert.deepEqual(events.map((e) => e.type), ["delta", "item"]);
    assert.equal(rest, '{"type":"del');
  } finally {
    server.close();
    store.flush();
    rmSync(home, { recursive: true, force: true });
  }
});

test("parseAttachArgs parses port, token, thread, and URL arguments", () => {
  const a = parseAttachArgs(["http://127.0.0.1:8123", "--token", "secret", "--thread", "th_1"], {});
  assert.deepEqual(a, { base: "http://127.0.0.1:8123", token: "secret", threadId: "th_1" });
  const b = parseAttachArgs([], { LINER_PORT: "7400", LINER_TOKEN: "tok" });
  assert.deepEqual(b, { base: "http://127.0.0.1:7400", token: "tok", threadId: undefined });
});

test("resolveContainedPath enforces canonical realpath containment for ACP fs/* calls", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-acp-root-"));
  const outside = mkdtempSync(join(tmpdir(), "lc-acp-out-"));
  try {
    writeFileSync(join(root, "ok.txt"), "hello\n");
    writeFileSync(join(outside, "secret.txt"), "secret\n");
    symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));

    assert.equal(resolveContainedPath(root, "ok.txt"), realpathSync(join(root, "ok.txt")));
    assert.throws(() => resolveContainedPath(root, "../secret.txt"), /outside the project/);
    assert.throws(() => resolveContainedPath(root, "escape.txt"), /outside the project/);
    assert.throws(() => resolveContainedPath(root, "ok.txt\0.png"), /invalid/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("Settings doesn't promise that a deny rule blocks steps no one is asked about: Full access and a tool's own Auto never meet the rules", () => {
  const settings = readFileSync(new URL("../../ui/src/app/Settings.tsx", import.meta.url), "utf8");
  const note = /<Group title="Permission rules" note="([^"]+)"/.exec(settings)?.[1] ?? "";
  assert.ok(note, "the Permission rules group has its note");
  assert.doesNotMatch(note, /strictly block|even under Auto access/i);
  assert.match(note, /At Full access/);
});
