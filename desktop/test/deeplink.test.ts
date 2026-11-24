import test from "node:test";
import assert from "node:assert/strict";
import { extractLaunchTarget, launchQuestion, parseDeepLink } from "../src/deeplink.ts";

test("parseDeepLink parses liner-code thread and project URLs and rejects invalid ones", () => {
  assert.deepEqual(parseDeepLink("liner-code://thread/th_123"), { kind: "thread", id: "th_123" });
  assert.deepEqual(parseDeepLink("liner-code://session/abc-99"), { kind: "thread", id: "abc-99" });
  assert.deepEqual(parseDeepLink("liner-code://open?path=%2Ftmp%2Fmy%20app"), { kind: "project", path: "/tmp/my app", link: true });
  assert.equal(parseDeepLink("https://example.com/thread/th_123"), null);
  assert.equal(parseDeepLink("liner-code://thread/../evil"), null);
  assert.equal(parseDeepLink("not a url"), null);
});

test("extractLaunchTarget prefers deep-links and falls back to explicit folder paths in second-instance argv", () => {
  const dirs = new Set(["/workspace/project-a"]);
  const isDir = (p: string) => dirs.has(p);
  assert.deepEqual(extractLaunchTarget(["Liner Code", "--flag", "liner-code://thread/th_9"], "/workspace", isDir), { kind: "thread", id: "th_9" });
  assert.deepEqual(extractLaunchTarget(["Liner Code", "project-a"], "/workspace", isDir), { kind: "project", path: "/workspace/project-a" });
  assert.equal(extractLaunchTarget(["Liner Code", "--inspect", "."], "/workspace", isDir), null);
});

test("a folder that came in a link is asked about before it's added; one from a command line you typed, or a session's link, isn't", () => {
  const linked = parseDeepLink("liner-code://open?path=%2FUsers%2Fme%2FDownloads%2Frepo");
  assert.ok(linked);
  assert.match(launchQuestion(linked)?.message ?? "", /Add “\/Users\/me\/Downloads\/repo” as a project\?/);
  const typed = extractLaunchTarget(["Liner Code", "project-a"], "/workspace", (p) => p === "/workspace/project-a");
  assert.ok(typed);
  assert.equal(launchQuestion(typed), null);
  assert.equal(launchQuestion({ kind: "thread", id: "th_1" }), null);
});

test("under electron <path> (npm run app:dev) the app's own folder isn't taken for a folder to open", () => {
  const isDir = (p: string) => p === "/repo/desktop" || p === "/workspace/project-a";
  // argv is [electron, desktop]: with the app's own two arguments skipped, there's nothing to open.
  assert.equal(extractLaunchTarget(["/path/to/electron", "desktop"], "/repo", isDir, 2), null);
  assert.deepEqual(extractLaunchTarget(["/path/to/electron", "desktop", "/workspace/project-a"], "/repo", isDir, 2), { kind: "project", path: "/workspace/project-a" });
});
