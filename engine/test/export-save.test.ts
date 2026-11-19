/*
  Saving a session as Markdown: it goes to Downloads, which is made when this Mac has none. Run with
  `node --test engine/test/export-save.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveToDownloads } from "../src/export.ts";

test("export: a home with no Downloads folder gets one, and a taken name gets a number", { skip: process.platform === "win32" }, () => {
  const home = mkdtempSync(join(tmpdir(), "lc-export-"));
  const was = process.env.HOME;
  process.env.HOME = home;
  try {
    const first = saveToDownloads("Fix: the/login", "# one\n");
    assert.equal(first, join(home, "Downloads", "Fix- the-login.md"));
    assert.equal(readFileSync(first, "utf8"), "# one\n");
    const second = saveToDownloads("Fix: the/login", "# two\n");
    assert.equal(second, join(home, "Downloads", "Fix- the-login 2.md"));
    assert.ok(existsSync(second));
  } finally {
    process.env.HOME = was;
  }
});
