/*
  Each step's kind (contracts stepKind), which gives a step its mark on a turn's live line, in its row and on the folded
  line (Timeline.tsx): from the tool's own kind and name, one place for every face. Run with `node --test engine/test/step-kind.test.ts`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { STEP_KINDS, stepKind, type DoingCall } from "../../contracts/src/index.ts";

const call = (tool: string, toolKind: string, title = "", more: Partial<DoingCall> = {}): DoingCall => ({ tool, toolKind, title, ...more });

test("A file read or changed is the file kind, whatever the tool calls it", () => {
  assert.equal(stepKind(call("Read", "read", "Read src/app.ts", { path: "src/app.ts" })), "file");
  assert.equal(stepKind(call("Edit", "edit", "Edit src/app.ts", { path: "src/app.ts" })), "file");
  assert.equal(stepKind(call("write", "write", "write")), "file", "a write that names no file is still a file");
});

test("A search, a command and the web are their own kinds", () => {
  assert.equal(stepKind(call("Grep", "search", "Search the code for nextHigh")), "search");
  assert.equal(stepKind(call("Bash", "exec", "Run npm test", { input: JSON.stringify({ command: "npm test" }) })), "command");
  assert.equal(stepKind(call("WebFetch", "fetch", "Fetch https://example.com")), "web");
  assert.equal(stepKind(call("WebSearch", "web", "Search the web")), "web");
});

test("Liner's own Browser is the web and starting a dev server is a command, under any tool's name for them", () => {
  assert.equal(stepKind(call("mcp__liner__browser_open", "other", "Open localhost:5173 in the Browser")), "web");
  assert.equal(stepKind(call("liner.browser_click", "other", "Click")), "web");
  assert.equal(stepKind(call("mcp__liner__server_start", "exec", "Run web from launch.json")), "command");
});

test("An agent sent off and a brief to the sidekick are the agent kind", () => {
  assert.equal(stepKind(call("Task", "task", "Explore the sync code")), "agent");
  assert.equal(stepKind(call("mcp__liner__sidekick", "other", "Hand the sidekick the tests")), "agent");
  assert.equal(stepKind(call("liner_sidekick", "other", "sidekick")), "agent");
});

test("Liner Design's canvas tools and a design's frame written as its file are the canvas kind", () => {
  assert.equal(stepKind(call("mcp__liner__design_frame", "other", "Draw Phone / Week")), "canvas");
  assert.equal(stepKind(call("mcp_liner_design_node", "other", "design_node")), "canvas");
  assert.equal(stepKind(call("Write", "write", "Write the frame", { path: "/p/.liner/designs/tides/frames/week.html" })), "canvas");
  assert.equal(stepKind(call("Edit", "edit", "edit", { input: JSON.stringify({ file_path: "C:\\p\\.liner\\designs\\tides\\frames\\week.html" }) })), "canvas", "a Windows path in the input");
  assert.equal(stepKind(call("Read", "read", "Read the frame", { path: "/p/.liner/designs/tides/frames/week.html" })), "file", "reading a frame's file is reading a file");
});

test("Any other tool, and thinking, is the other kind, which the line shows no mark for", () => {
  assert.equal(stepKind(call("mcp__github__create_issue", "other", "Create an issue")), "other");
  assert.equal(stepKind(call("think", "think", "think")), "other");
  assert.ok(!STEP_KINDS.includes("other"));
  assert.deepEqual(STEP_KINDS, ["file", "search", "command", "web", "agent", "canvas"], "the line shows the kinds in one order");
});
