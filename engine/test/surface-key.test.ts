/*
  A session's key to Liner Code's own tools: kept in a file only this user can read, under Liner Code's folder, and named to the
  tool's MCP server by its path. Never in an environment or on a command line, which any process of this user can read.
  Run with `node --test engine/test/surface-key.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentTools } from "../src/agent-tools.ts";
import { execMcp } from "../src/providers/codex.ts";
import { Store } from "../src/store.ts";

test("a session's key is in a file of the user's own, and nowhere a process listing shows", { skip: process.platform === "win32" }, () => {
  const home = mkdtempSync(join(tmpdir(), "lc-key-"));
  const tools = new AgentTools(new Store(home), process.env);
  tools.url = "http://127.0.0.1:9";
  const s = tools.serverFor("t")!;
  assert.equal(s.env.LINER_SURFACE_KEY, undefined, "not in the environment");
  const file = s.env.LINER_SURFACE_KEY_FILE;
  assert.ok(file.startsWith(join(home, "surface-keys")), "under Liner Code's folder");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(readFileSync(file, "utf8"), s.key);
  assert.equal(tools.threadOf(s.key!), "t");
  assert.ok(!execMcp({ mcp: s }).join(" ").includes(s.key!), "not on codex exec's command line");
  // The same session again: the same key and file.
  assert.equal(tools.serverFor("t")!.env.LINER_SURFACE_KEY_FILE, file);
  tools.forget("t");
  assert.ok(!existsSync(file), "gone with the key");
});
