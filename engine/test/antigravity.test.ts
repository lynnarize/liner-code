/*
  Google's Antigravity CLI (`agy acp`) as a built-in tool, against a fake `agy`: a Node script that answers
  `--version` as told and speaks ACP with Antigravity's four modes (default, accept-edits, auto, plan), starting in the
  one its settings say. Each access level puts it in a mode of its own whatever it starts in, Auto falls back to its
  default where it has none or refuses it, Liner Code's tools are known inside call_mcp_tool and nothing that only looks
  like them is, the version gate keeps out an old build and an editor's launcher, its sign-in is asked of it, and nothing
  is written under its home. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Access } from "../../contracts/src/index.ts";
import { ACCESS, emptyUsage, nearestEffort } from "../../contracts/src/index.ts";
import { makerOf } from "../../contracts/src/cast.ts";
import { acpProvider, ANTIGRAVITY, antigravity, checkGate, devWaits, homeTitle, isMcpWrap, levelNote, linerCall, standingNote, toolGate } from "../src/providers/acp.ts";
import { agyModels } from "../src/providers/models.ts";
import type { ApprovalRequest, OpenOptions, TurnSink } from "../src/providers/types.ts";
import { linerName, providers, Runtime, toolsNote } from "../src/runtime.ts";
import * as canvas from "../src/canvas.ts";
import { createFile, designCtx } from "../src/canvas.ts";
import * as pictures from "../src/pictures.ts";
import { Store } from "../src/store.ts";
import { descendants, noLeaks } from "./leaks.ts";

// Every test ends with no agent of its own still running (leaks.ts).
noLeaks();

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

/**
  The fake `agy`. FAKE_VERSION: what --version prints (\n for lines); FAKE_START: the mode it opens in; FAKE_NOAUTO: auto
  isn't offered; FAKE_REFUSE: modes it refuses to switch to; FAKE_MODELS: what `agy models` says, "out" (signed out, as the
  real one says it) or "broken" (another failure), else its list as agy 1.5.6 prints it; FAKE_THOUGHT: the thinking levels
  its sessions offer (comma-separated), none without; FAKE_ASK: permission requests it sends in a prompt, one after another,
  FAKE_ASK_DELAY ms into it; FAKE_PROMPT: session updates it sends as a prompt starts; FAKE_SLOW: ms it takes to answer a prompt
  (session/cancel answers it at once, cancelled); FAKE_SYS: it takes a system prompt (_meta.antigravity.systemPrompt.append);
  FAKE_RESUME: it resumes (sessionCapabilities.resume); FAKE_MODELS_RAW: what `agy models` lists instead; FAKE_SPAWN: a file
  holding a shell line it starts as each prompt does, out of its tree (read each time, so a test can change it).
*/
function fakeAgy() {
  const dir = mkdtempSync(join(tmpdir(), "lc-agy-"));
  const file = join(dir, "agy");
  writeFileSync(
    file,
    `#!/usr/bin/env node
const fs = require("fs");
const env = process.env;
if (process.argv.includes("--version")) { process.stdout.write((env.FAKE_VERSION ?? "1.5.6").replace(/\\\\n/g, "\\n") + "\\n"); process.exit(0); }
if (process.argv[2] === "models") {
  if (env.FAKE_LOG) fs.appendFileSync(env.FAKE_LOG, JSON.stringify({ argv: "models" }) + "\\n");
  process.stdout.write("Fetching available models...\\n");
  if (env.FAKE_MODELS === "out") { process.stdout.write("Error: Please sign in to view available models. Launch the CLI without arguments to sign in.\\n"); process.exit(1); }
  if (env.FAKE_MODELS === "broken") { process.stderr.write("Error: something else\\n"); process.exit(2); }
  if (env.FAKE_MODELS_RAW) { process.stdout.write(env.FAKE_MODELS_RAW.replace(/\\\\n/g, "\\n").replace(/\\\\t/g, "\\t") + "\\n"); process.exit(0); }
  process.stdout.write(["gemini-3.8-flash-high\\tGemini 3.8 Flash (High)", "gemini-3.8-flash-medium\\tGemini 3.8 Flash (Medium)", "gemini-3.8-flash-low\\tGemini 3.8 Flash (Low)", "gemini-3.1-pro-high\\tGemini 3.1 Pro (High)", "gemini-3.1-pro-low\\tGemini 3.1 Pro (Low)", "claude-sonnet-4-6\\tClaude Sonnet 4.6 (Thinking)", "gpt-oss-120b-medium\\tGPT-OSS 120B (Medium)"].join("\\n") + "\\n");
  process.exit(0);
}
if (process.argv[2] !== "acp") process.exit(2);
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n");
const modes = ["default", "accept-edits", ...(env.FAKE_NOAUTO ? [] : ["auto"]), "plan"];
const refuse = (env.FAKE_REFUSE || "").split(",").filter(Boolean);
let asks = [], next = 0, prompt;
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (env.FAKE_LOG) fs.appendFileSync(env.FAKE_LOG, line + "\\n");
    if (m.method === "initialize") send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: { image: true }, ...(env.FAKE_RESUME ? { sessionCapabilities: { resume: {} } } : {}), ...(env.FAKE_SYS ? { _meta: { antigravity: { systemPrompt: { append: true } } } } : {}) }, authMethods: [{ id: "oauth-personal" }, { id: "gemini-api-key" }] } });
    else if (m.method === "session/resume" || m.method === "session/load") {
      if (m.method === "session/resume" && !env.FAKE_RESUME) send({ id: m.id, error: { code: -32601, message: "no" } });
      else {
        if (m.method === "session/load") send({ method: "session/update", params: { sessionId: m.params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "REPLAYED" } } } });
        send({ id: m.id, result: { modes: { currentModeId: "default", availableModes: modes.map((id) => ({ id, name: id })) } } });
      }
    }
    else if (m.method === "session/new") {
      if (env.FAKE_AUTH === "out") send({ id: m.id, error: { code: -32000, message: "Authentication required" } });
      else if (env.FAKE_AUTH === "other") send({ id: m.id, error: { code: -32603, message: "Internal error" } });
      else {
        const thought = [
          ...(env.FAKE_THOUGHT ? [{ id: "thought_level", category: "thought_level", type: "select", currentValue: "high", options: env.FAKE_THOUGHT.split(",").map((value) => ({ value, name: value })) }] : []),
          ...(env.FAKE_BADMODEL ? [{ id: "model", category: "model", type: "select", currentValue: "gemini-3.8-flash", options: [{ value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }] }] : []),
        ];
        send({ id: m.id, result: { sessionId: "agy-1", modes: { currentModeId: env.FAKE_START || "default", availableModes: modes.map((id) => ({ id, name: id })) }, ...(thought.length ? { configOptions: thought } : {}) } });
        send({ method: "session/update", params: { sessionId: "agy-1", update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "plan", description: "Plan carefully before executing a task." }, { name: "goal", description: "Set a goal" }] } } });
      }
    } else if (m.method === "session/set_config_option" && m.params.configId === "model" && m.params.value === env.FAKE_BADMODEL) {
      send({ id: m.id, error: { code: -32602, message: "model not available" } });
    } else if (m.method === "session/set_mode") {
      if (refuse.includes(m.params.modeId) || !modes.includes(m.params.modeId)) send({ id: m.id, error: { code: -32602, message: "mode not available" } });
      else send({ id: m.id, result: {} });
    } else if (m.method === "session/cancel") {
      if (prompt !== undefined) send({ id: prompt, result: { stopReason: "cancelled" } });
      prompt = undefined;
    } else if (m.method === "session/prompt") {
      prompt = m.id;
      // A command it leaves behind, out of its own tree (a double fork, a session of its own): FAKE_SPAWN, a shell line.
      // Handed on as agy (a Go program) hands on what it was given open: Node itself would keep the markers back. They sit
      // after its three pipes (exec.ts marking), from 3 on: each plain file open there goes on, at the same number (Node's own
      // descriptors past them are pipes and the like).
      const line = env.FAKE_SPAWN ? fs.readFileSync(env.FAKE_SPAWN, "utf8") : "";
      if (line) {
        const open = (fd) => { try { return fs.fstatSync(fd).isFile(); } catch { return false; } };
        const extra = [3, 4, 5, 6].map((fd) => (open(fd) ? fd : "ignore"));
        require("child_process").spawn("sh", ["-c", line], { detached: true, stdio: ["ignore", "ignore", "ignore", ...extra] }).unref();
      }
      asks = env.FAKE_ASK ? [].concat(JSON.parse(env.FAKE_ASK)) : [];
      next = 0;
      for (const update of env.FAKE_PROMPT ? JSON.parse(env.FAKE_PROMPT) : []) send({ method: "session/update", params: { sessionId: "agy-1", update } });
      const id = m.id;
      if (asks.length) setTimeout(() => send({ id: 900, ...asks[0] }), Number(env.FAKE_ASK_DELAY || 0));
      else setTimeout(() => prompt === id && send({ id, result: { stopReason: env.FAKE_STOP || "end_turn" } }), Number(env.FAKE_SLOW || 0));
    } else if (m.id >= 900) {
      next++;
      if (next < asks.length) send({ id: 900 + next, ...asks[next] });
      else if (prompt !== undefined) send({ id: prompt, result: { stopReason: env.FAKE_STOP || "end_turn" } });
    } else if (m.id !== undefined) send({ id: m.id, result: {} });
  }
});
`,
    { mode: 0o755 },
  );
  const log = join(dir, "log.jsonl");
  writeFileSync(log, "");
  const read = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id?: number; method?: string; params?: Record<string, unknown>; result?: { outcome?: { optionId?: string } } });
  return { dir, file, log, read };
}

// Liner Code's server under the plain name, as the runtime would hand it over were the tag "liner": the shapes below are agy's own.
const opts = (env: NodeJS.ProcessEnv, extra: Partial<OpenOptions> = {}) => ({ cwd: process.cwd(), model: "default", effort: "medium", access: "edits", soul: "", guard: true, env, mcpName: "liner", ...extra }) as OpenOptions;
function recorder() {
  const notices: string[] = [];
  const cards: ApprovalRequest[] = [];
  const sink = {
    text: () => {}, reasoning: () => {}, tool: () => {}, plan: () => {},
    approve: async (req: ApprovalRequest) => (cards.push(req), { allow: false }), ask: async () => null, propose: async () => ({ approve: true }),
    usage: () => {}, session: () => {}, notice: (n: string) => void notices.push(n), error: () => {}, limited: () => {},
  } as unknown as TurnSink;
  return { sink, notices, cards };
}
/** The fake's env: its folder on PATH, nothing else of this Mac's. */
const envOf = (fake: { dir: string; log: string }, more: Record<string, string> = {}): Record<string, string> => ({ PATH: `${fake.dir}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: mkdtempSync(join(tmpdir(), "lc-agy-home-")), FAKE_LOG: fake.log, ...more });
const modesSent = (fake: ReturnType<typeof fakeAgy>) => fake.read().filter((m) => m.method === "session/set_mode").map((m) => m.params!.modeId);

test("antigravity: each access level puts agy in its own mode, whatever agy's settings start it in: never its own auto", async () => {
  const want: Record<Access, string> = { read: "plan", ask: "default", edits: "default", auto: "default", review: "default", full: "default" };
  for (const access of ACCESS) {
    const fake = fakeAgy();
    // Its settings say Auto (agentMode "auto"), which would act before Liner Code is asked.
    const s = antigravity.open(opts(envOf(fake, { FAKE_START: "auto" }), { access }));
    await s.turn("hi", recorder().sink, new AbortController().signal);
    s.close();
    assert.deepEqual(modesSent(fake), [want[access]], `${access}: from auto to ${want[access]}`);
  }
});

test("antigravity: a change of level mid-session moves agy's mode with it, and the switch is waited on", async () => {
  const fake = fakeAgy();
  const s = antigravity.open(opts(envOf(fake), { access: "ask" }));
  await s.turn("hi", recorder().sink, new AbortController().signal);
  for (const access of ["auto", "edits", "read", "full", "auto", "read", "ask"] as Access[]) {
    assert.ok(await s.update!({ model: "default", effort: "medium", access }));
    // Waited on: the switch is in before update answers.
    if (access === "read") assert.equal(modesSent(fake).at(-1), "plan");
  }
  s.close();
  // Ask → Auto, Edits (still default) → Read only (plan) → Full (default) → Auto (default) → Read only (plan) → Ask (default).
  assert.deepEqual(modesSent(fake), ["plan", "default", "plan", "default"]);
});

test("antigravity: Auto is agy's default mode with Liner Code answering, as for OpenCode: an edit in the project goes, a command comes to its card (the Reviewer's)", async () => {
  const edit = { kind: "edit", title: "File src/a.ts", locations: [{ path: "src/a.ts" }], rawInput: { Path: "src/a.ts" } };
  assert.deepEqual(await agyAsk(edit, "auto"), { card: false, picked: "yes" });
  assert.deepEqual(await agyAsk({ kind: "execute", title: "touch x", rawInput: { CommandLine: "touch x" } }, "auto"), { card: true, picked: "no" });
  // Said to be nobody's call yet, so at Auto the runtime lets a routine command through instead of drawing the card (risk.ts, routine).
  assert.equal(asked[0]?.unjudged, true);
});

test("antigravity: Read only, refused by agy, is said; the session doesn't pretend it switched", async () => {
  const fake = fakeAgy();
  const s = antigravity.open(opts(envOf(fake, { FAKE_REFUSE: "plan" }), { access: "read" }));
  const r = recorder();
  await s.turn("hi", r.sink, new AbortController().signal);
  s.close();
  assert.ok(r.notices.some((n) => /didn't switch to its read-only mode/.test(n)), r.notices.join(" | "));
});

test("antigravity: Liner Code's tools by agy's own name for them (mcp_liner_<tool>), its toolSummary set aside", () => {
  const input = { frame: "phone", design: "tides" };
  assert.deepEqual(linerCall("mcp_liner_design_tree", { ...input, toolSummary: "Frame tree" }), { name: "design_tree", input });
  assert.deepEqual(linerCall("mcp_liner_design_files", { toolSummary: "Design step" }), { name: "design_files", input: {} });
  for (const t of ["mcp_liner_not_ours", "mcp_linerx_design_tree", "mcp_liner-notes_design_tree", "mcp_airliner_design_tree", "Run mcp_liner_design_tree"]) assert.equal(linerCall(t, input), undefined, t);
});

test("antigravity: Liner Code's tools are known inside call_mcp_tool, on the server called exactly liner", () => {
  const input = { frame: "phone", design: "tides" };
  assert.ok(isMcpWrap("call_mcp_tool") && isMcpWrap("call_mcp_tool: Phone frame") && !isMcpWrap("call_mcp_tools") && !isMcpWrap("my_call_mcp_tool"));
  for (const raw of [
    { server: "liner", tool: "design_tree", arguments: input },
    { serverName: "liner", toolName: "design_tree", args: input },
    { server_name: "liner", tool_name: "design_tree", input },
    { server: "liner", name: "design_tree", parameters: JSON.stringify(input) },
  ])
    assert.deepEqual(linerCall("call_mcp_tool", raw), { name: "design_tree", input }, JSON.stringify(raw));
  assert.deepEqual(linerCall("call_mcp_tool", { server: "liner", tool: "design_files" }), { name: "design_files", input: undefined }, "a tool that takes nothing");
  assert.deepEqual(linerCall("mcp(liner/design_tree)", input), { name: "design_tree", input }, "its rules' own name for one");
  assert.deepEqual(linerCall("liner/design_tree", input), { name: "design_tree", input });
  const lookalikes: Record<string, unknown>[] = [
    { server: "liner-notes", tool: "design_tree", arguments: input },
    { server: "liner_notes", tool: "design_tree", arguments: input },
    { server: "Liner", tool: "design_tree", arguments: input },
    { server: "airliner", tool: "design_tree", arguments: input },
    { server: "liner ", tool: "design_tree", arguments: input },
    { server: "liner", tool: "not_ours", arguments: input },
    { server: "liner", tool: "liner/design_tree", arguments: input },
    { server: "liner", serverName: "github", tool: "design_tree", arguments: input },
    { server: "liner", tool: "design_tree", name: "design_frame", arguments: input },
    { server: "liner", tool: "design_tree", arguments: input, args: {} },
    { server: "liner", tool: "design_tree", arguments: "not json" },
    { tool: "design_tree", arguments: input },
  ];
  for (const raw of lookalikes) assert.equal(linerCall("call_mcp_tool", raw), undefined, JSON.stringify(raw));
  assert.equal(linerCall("call_mcp_tool", ["liner", "design_tree"]), undefined, "an array");
  assert.equal(linerCall("mcp(liner-notes/design_tree)", input), undefined);
  assert.equal(linerCall("mcp(liner/not_ours)", input), undefined, "by the list");
});

/** One ask agy sends at Ask: whether it came to the person as a card, and what Liner Code answered. */
/** What the last agyAsk handed the runtime to answer. */
let asked: ApprovalRequest[] = [];
async function agyAsk(toolCall: Record<string, unknown>, access: Access = "ask", mcp = true) {
  const fake = fakeAgy();
  const options = [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }];
  const ask = { method: "session/request_permission", params: { sessionId: "agy-1", options, toolCall: { toolCallId: "c1", status: "pending", ...toolCall } } };
  const s = antigravity.open(opts(envOf(fake, { FAKE_ASK: JSON.stringify(ask) }), { access, mcp: mcp ? { command: "x", args: [], env: {} } : undefined }));
  const r = recorder();
  await s.turn("go", r.sink, new AbortController().signal);
  s.close();
  asked = r.cards;
  return { card: r.cards.length > 0, picked: fake.read().find((m) => m.id === 900 && !m.method)?.result?.outcome?.optionId };
}

test("antigravity: an ask for one of Liner Code's tools through call_mcp_tool goes without a card; anything else in that shape comes as one", async () => {
  const wrap = (raw: unknown, more: Record<string, unknown> = {}) => ({ kind: "other", title: "call_mcp_tool", rawInput: raw, ...more });
  assert.deepEqual(await agyAsk(wrap({ server: "liner", tool: "browser_open", arguments: { url: "localhost:5173" } })), { card: false, picked: "yes" });
  assert.deepEqual(await agyAsk(wrap({ server: "liner", tool: "design_files" })), { card: false, picked: "yes" }, "no input");
  // As agy 1.5.6 sends one (seen on the real CLI): its title for the row, the tool's name beside it, a toolSummary in its input.
  assert.deepEqual(await agyAsk({ kind: "other", title: "Run mcp_liner_browser_open", name: "mcp_liner_browser_open", rawInput: { url: "localhost:5173", toolSummary: "Page open" } }), { card: false, picked: "yes" }, "agy's own shape");
  assert.equal((await agyAsk({ kind: "other", title: "Run mcp_liner_browser_open", rawInput: { url: "x" } })).card, true, "a title alone, with no name beside it, isn't ours");
  assert.equal((await agyAsk({ kind: "other", title: "Run mcp_github_browser_open", name: "mcp_github_browser_open", rawInput: { url: "x", toolSummary: "x" } })).card, true, "another server's");
  const cards: Record<string, Record<string, unknown>> = {
    "another server": wrap({ server: "github", tool: "browser_open", arguments: { url: "x" } }),
    "a server named like ours": wrap({ server: "liner-notes", tool: "browser_open", arguments: { url: "x" } }),
    "more beside the wrapper's own": wrap({ server: "liner", tool: "browser_open", arguments: { url: "x" }, command: "rm -rf ~" }),
    "more input than the tool takes": wrap({ server: "liner", tool: "browser_open", arguments: { url: "x", script: "fetch('/x')" } }),
    "kind execute, with a command of its own": wrap({ server: "liner", tool: "browser_open", arguments: { url: "x" } }, { kind: "execute", title: "rm -rf ~" }),
    "a file named": wrap({ server: "liner", tool: "browser_open", arguments: { url: "x" } }, { locations: [{ path: "a.ts" }] }),
  };
  for (const [what, call] of Object.entries(cards)) assert.equal((await agyAsk(call)).card, true, what);
  assert.equal((await agyAsk(wrap({ server: "liner", tool: "browser_open", arguments: { url: "x" } }), "ask", false)).card, true, "with no server of ours in the session, it's someone else's");
  // As agy 1.5.6 really asks for it (V's run: attacks-ask-wrapliner-wrapframe): kind execute, "MCP Tool <tool>", ServerName / ToolName / Arguments.
  const real = (raw: Record<string, unknown>, more: Record<string, unknown> = {}) => ({ kind: "execute", title: `MCP Tool ${String(raw.ToolName)}`, name: "call_mcp_tool", rawInput: raw, ...more });
  assert.deepEqual(await agyAsk(real({ ServerName: "liner", ToolName: "design_files", Arguments: {} })), { card: false, picked: "yes" }, "agy's real shape");
  assert.deepEqual(await agyAsk(real({ ServerName: "liner", ToolName: "browser_open", Arguments: { url: "localhost:5173", toolSummary: "Page" } })), { card: false, picked: "yes" });
  assert.deepEqual(await agyAsk(real({ ServerName: "liner", ToolName: "design_frame", Arguments: { name: "Phone", width: 390, height: 844, html: "<p>x</p>" } }), "read"), { card: false, picked: "yes" }, "a writer at Read only: the engine refuses it");
  const realLookalikes: Record<string, Record<string, unknown>> = {
    "another server": real({ ServerName: "github", ToolName: "design_files", Arguments: {} }),
    "a server named like ours": real({ ServerName: "liner-notes", ToolName: "design_files", Arguments: {} }),
    "a tool not ours": real({ ServerName: "liner", ToolName: "not_ours", Arguments: {} }),
    "more beside the wrapper's own": real({ ServerName: "liner", ToolName: "design_files", Arguments: {}, CommandLine: "rm -rf ~" }),
    "a title that isn't the wrapper's": real({ ServerName: "liner", ToolName: "design_files", Arguments: {} }, { title: "rm -rf ~" }),
    "the title without the wrapper's name": { kind: "execute", title: "MCP Tool design_files", rawInput: { ServerName: "liner", ToolName: "design_files", Arguments: {} } },
  };
  for (const [what, call] of Object.entries(realLookalikes)) assert.equal((await agyAsk(call)).card, true, what);
  // The marker Antigravity's ACP server puts on an MCP call (T3 Code, runtimeModel.ts): server and tool in its input.
  assert.deepEqual(await agyAsk({ kind: "other", title: "Running design_files", _meta: { is_mcp_tool_call: true }, rawInput: { server: "liner", tool: "design_files" } }), { card: false, picked: "yes" });
  assert.equal((await agyAsk({ kind: "other", title: "Running design_files", _meta: { is_mcp_tool_call: true }, rawInput: { server: "xliner", tool: "design_files" } })).card, true);
});

test("antigravity: in Read only, agy's asks to edit or run a command are refused with no card (its plan mode still asks), reads go on", async () => {
  // As agy 1.5.6 asks in its plan mode (seen on the real CLI).
  const edit = { kind: "edit", title: "File src/tide.ts", locations: [{ path: "src/tide.ts" }], rawInput: { Path: "src/tide.ts", Target: "1", Replacement: "2" } };
  assert.deepEqual(await agyAsk(edit, "read"), { card: false, picked: "no" });
  assert.deepEqual(await agyAsk({ kind: "execute", title: "touch src/made.txt", rawInput: { CommandLine: "touch src/made.txt", toolSummary: "x" } }, "read"), { card: false, picked: "no" });
  assert.deepEqual(await agyAsk({ kind: "execute", title: "ls src", rawInput: { command: "ls src" } }, "read"), { card: false, picked: "yes" }, "a command that only reads");
  assert.deepEqual(await agyAsk({ kind: "other", title: "Run mcp_github_x", name: "mcp_github_x", rawInput: {} }, "read"), { card: false, picked: "no" }, "another server's tool");
  assert.deepEqual(await agyAsk(edit, "ask"), { card: true, picked: "no" }, "at Ask it's your card");
});

test("antigravity: through call_mcp_tool, the design writers are still refused in Read only and a side chat, and design_picture keeps its own card", async () => {
  // agy's ask in Read only: Liner Code's own tool goes without a card, as everywhere; the refusal is the tool's own, below.
  const frame = { server: "liner", tool: "design_frame", arguments: { name: "Phone", width: 390, height: 844, html: "<p>x</p>", design: "tides" } };
  assert.deepEqual(await agyAsk({ kind: "other", title: "call_mcp_tool", rawInput: frame }, "read"), { card: false, picked: "yes" });
  // What the call reaches: the engine's design tools under the name and input the wrapper carried.
  const cwd = mkdtempSync(join(tmpdir(), "lc-agy-design-"));
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-agy-store-")));
  store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
  const base = { projectId: "p", title: "Agy", agent: "forge", status: "running" as const, turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 };
  for (const a of ["read", "ask"] as Access[]) store.putThread({ id: a, access: a, ...base });
  store.putThread({ id: "side", access: "edits", sideOf: "ask", ...base });
  store.setSettings({ pictures: [{ id: "img", label: "Fake", url: "http://127.0.0.1:9/v1", model: "m" }] });
  const runtime = new Runtime(store, { PATH: "/usr/bin:/bin" });
  const asks: string[] = [];
  const ctx = designCtx(store, { readOnly: (id) => runtime.readOnly(id), ask: (_id, a) => (asks.push(a.title), { id: "x", answer: Promise.resolve({ allow: false }) }) });
  createFile(ctx, cwd, "Tides", "phone", "tides");
  const page = join(cwd, ".liner/designs/tides/frames/phone.html");
  writeFileSync(page, '<!doctype html><html><body data-l="b1"><p data-l="p1">Low water</p></body></html>');
  const at = (threadId: string) => ({ ...ctx, threadId, sidekick: false });
  const before = readFileSync(page, "utf8");
  const writers = [
    { server: "liner", tool: "design_frame", arguments: frame.arguments },
    { server: "liner", tool: "design_node", arguments: { frame: "phone", id: "p1", html: "<p>High water</p>", design: "tides" } },
  ];
  for (const who of ["read", "side"])
    for (const raw of writers) {
      const call = linerCall("call_mcp_tool", raw)!;
      await assert.rejects(canvas.call(call.name, call.input as Record<string, unknown>, at(who)), /This session is at Read only now \(or it.s a side chat\)/, `${call.name} in ${who}`);
    }
  assert.equal(readFileSync(page, "utf8"), before, "nothing changed");
  const picture = linerCall("call_mcp_tool", { server: "liner", tool: "design_picture", arguments: { prompt: "Sand", width: 100, height: 100, design: "tides" } })!;
  await assert.rejects(pictures.call(picture.name, picture.input as Record<string, unknown>, at("read")), /This session is at Read only now \(or it.s a side chat\)/);
  await pictures.call(picture.name, picture.input as Record<string, unknown>, at("ask"));
  assert.deepEqual(asks, ["Make a picture"], "the picture asks on its own card");
});

test("antigravity: liner goes to agy over ACP with each session, and nothing is written under agy's home", async () => {
  const fake = fakeAgy();
  const env = envOf(fake);
  const mcp = { command: "/usr/bin/true", args: ["--liner"], env: { LINER_THREAD: "t1" } };
  const s = antigravity.open(opts(env, { mcp, access: "full" }));
  await s.turn("hi", recorder().sink, new AbortController().signal);
  s.close();
  const opened = fake.read().find((m) => m.method === "session/new")!;
  assert.deepEqual(opened.params!.mcpServers, [{ name: "liner", command: "/usr/bin/true", args: ["--liner"], env: [{ name: "LINER_THREAD", value: "t1" }] }]);
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  assert.deepEqual(walk(env.HOME), [], "no mcp_config.json, nothing at all");
});

test("antigravity: the version gate takes 1.5.0 and later, and neither an older build nor an editor's launcher", () => {
  assert.deepEqual(toolGate("1.5.6\n", 0, "1.5.0", "Antigravity CLI", "agy"), { version: "1.5.6" });
  assert.deepEqual(toolGate("agy version 1.5.0 (6212266538958848)", 0, "1.5.0", "Antigravity CLI", "agy"), { version: "agy version 1.5.0 (6212266538958848)" });
  assert.equal(toolGate("2.0.1", 0, "1.5.0", "Antigravity CLI", "agy").why, undefined);
  assert.match(toolGate("1.4.12\n", 0, "1.5.0", "Antigravity CLI", "agy").why!, /1\.4\.12 has no ACP .* needs 1\.5\.0 or later/);
  assert.match(toolGate("0.9.9", 0, "1.5.0", "Antigravity CLI", "agy").why!, /needs 1\.5\.0/);
  // The Antigravity editor's launcher (VS Code's way): version, commit, architecture.
  assert.match(toolGate(`1.20.3\n${"a1b2c3d4".repeat(5)}\narm64\n`, 0, "1.5.0", "Antigravity CLI", "agy").why!, /an editor's launcher, not Antigravity CLI/);
  assert.match(toolGate("", 1, "1.5.0", "Antigravity CLI", "agy").why!, /didn't say which version/);
  assert.match(toolGate("agy: unknown flag --version", 0, "1.5.0", "Antigravity CLI", "agy").why!, /didn't say which version/);
});

test("antigravity: found or not, the gate applied, and its sign-in and models from `agy models`, with no session opened", async () => {
  const fake = fakeAgy();
  const gone = await antigravity.detect({ PATH: "/usr/bin:/bin" });
  assert.equal(gone.available, false);
  assert.equal(gone.install, "curl -fsSL https://antigravity.google/cli/install.sh | bash");
  // Each its own file: what a file's --version said is kept by the file (checkGate).
  const old = await antigravity.detect(envOf(fakeAgy(), { FAKE_VERSION: "1.4.9" }));
  assert.equal(old.available, false);
  assert.match(old.detail!, /needs 1\.5\.0 or later/);
  const editor = await antigravity.detect(envOf(fakeAgy(), { FAKE_VERSION: `1.11.2\\n${"0123456789".repeat(4)}\\narm64` }));
  assert.equal(editor.available, false, "an old agy alias of the editor's");
  assert.match(editor.detail!, /editor's launcher/);
  // Each its own HOME: what one look says isn't kept for another.
  const out = await antigravity.detect(envOf(fake, { FAKE_MODELS: "out" }));
  assert.deepEqual([out.available, out.signedIn, out.version, out.login, out.supports.effort], [true, false, "1.5.6", "agy acp --login", false]);
  const unknown = await antigravity.detect(envOf(fake, { FAKE_MODELS: "broken" }));
  assert.deepEqual([unknown.available, unknown.signedIn], [true, undefined]);
  assert.match(unknown.detail!, /didn't say whether it's signed in/);
  const env = envOf(fake);
  const yes = await antigravity.detect(env);
  assert.deepEqual([yes.available, yes.signedIn, yes.detail, yes.supports.effort], [true, true, "Talks over the Agent Client Protocol", true]);
  const models = await antigravity.models!(env, mkdtempSync(join(tmpdir(), "lc-agy-scratch-")));
  assert.deepEqual(models.map((m) => m.id), ["default", "gemini-3.8-flash", "gemini-3.1-pro", "claude-sonnet-4-6", "gpt-oss-120b-medium"]);
  // A look and the model ask after it share one `agy models`; and no ACP at all, so no session stays in its history.
  assert.equal(fake.read().filter((m) => (m as { argv?: string }).argv === "models").length, 3, "one per look, the last shared with the model ask");
  assert.ok(fake.read().every((m) => !m.method), "no initialize, no session/new");
});

test("antigravity: `agy models` read as models with their thinking levels as effort, medium by default where they have it", async () => {
  const fake = fakeAgy();
  const { signedIn, models } = await agyModels(fake.file, envOf(fake));
  assert.equal(signedIn, true);
  const by = Object.fromEntries(models.map((m) => [m.id, m]));
  assert.deepEqual(Object.keys(by), ["gemini-3.8-flash", "gemini-3.1-pro", "claude-sonnet-4-6", "gpt-oss-120b-medium"]);
  assert.equal(by["gemini-3.8-flash"].label, "Gemini 3.8 Flash");
  assert.deepEqual(by["gemini-3.8-flash"].efforts!.map((e) => e.id), ["low", "medium", "high"]);
  assert.equal(by["gemini-3.8-flash"].defaultEffort, "medium");
  assert.deepEqual(by["gemini-3.1-pro"].efforts!.map((e) => e.id), ["low", "high"]);
  assert.equal(by["gemini-3.1-pro"].defaultEffort, "low", "the nearest below medium");
  assert.equal(by["gpt-oss-120b-medium"].efforts, undefined, "listed once: its whole id, as its session names it");
  assert.equal(by["claude-sonnet-4-6"].label, "Claude Sonnet 4.6 (Thinking)");
  assert.deepEqual(await agyModels(fake.file, envOf(fake, { FAKE_MODELS: "out" })), { signedIn: false, models: [] });
});

test("antigravity: the effort picked is agy's thinking level, set as the session opens and changed in place", async () => {
  const fake = fakeAgy();
  const s = antigravity.open(opts(envOf(fake, { FAKE_THOUGHT: "low,medium,high" }), { effort: "low" }));
  const r = recorder();
  await s.turn("hi", r.sink, new AbortController().signal);
  assert.ok(await s.update!({ model: "default", effort: "high", access: "edits" }), "in place, no reopen");
  await tick(100);
  assert.ok(await s.update!({ model: "default", effort: "max", access: "edits" }));
  await s.turn("again", r.sink, new AbortController().signal);
  s.close();
  const set = fake.read().filter((m) => m.method === "session/set_config_option" && m.params!.configId === "thought_level").map((m) => m.params!.value);
  assert.deepEqual(set, ["low", "high"]);
  assert.ok(r.notices.some((n) => /has no “max” thinking level for this model, so it thinks at its own \(high\)/.test(n)), r.notices.join(" | "));
  // Its commands, as that session listed them, are what the composer offers.
  assert.deepEqual((await antigravity.commands!({}, process.cwd())).commands.map((c) => c.name), ["plan", "goal"]);
});

test("antigravity: the person's own connections reach agy only at Full, never in a side chat, and both the person and the model are told", async () => {
  const conn = { name: "conn", stdio: { command: "/usr/bin/true", args: [], env: {} } };
  const mcp = { command: "/usr/bin/true", args: ["--liner"], env: {} };
  const servers = async (access: Access, side = false) => {
    const fake = fakeAgy();
    const s = antigravity.open(opts(envOf(fake), { access, mcp, connections: [conn], side, soul: "Soul." }));
    const r = recorder();
    await s.turn("hi", r.sink, new AbortController().signal);
    s.close();
    const prompt = String((fake.read().find((m) => m.method === "session/prompt")!.params!.prompt as { text: string }[])[0].text);
    return { names: (fake.read().find((m) => m.method === "session/new")!.params!.mcpServers as { name: string }[]).map((x) => x.name), notices: r.notices, prompt };
  };
  for (const access of ["read", "ask", "edits", "auto", "review"] as Access[]) {
    const r = await servers(access);
    assert.deepEqual(r.names, ["liner"], `${access}: only Liner Code's own`);
    assert.ok(r.notices.some((n) => /Your connection conn isn't in this session: agy runs a connection's tools without asking, so Liner Code hands them over only at Full access\./.test(n)), `${access}: ${r.notices.join(" | ")}`);
    assert.match(r.prompt, /^Soul\.\n\n\(Not in this session: conn, the person's own connection\./, `${access}: the model is told`);
  }
  assert.deepEqual((await servers("full")).names, ["liner", "conn"], "full: as Liner Code lets it run there");
  assert.deepEqual((await servers("full")).notices, []);
  const side = await servers("full", true);
  assert.deepEqual(side.names, ["liner"], "a side chat never");
  assert.ok(side.notices.some((n) => /never to a side chat/.test(n)));
  // A change of level across Full reopens the session, so the servers it's handed change with it; one that keeps them doesn't.
  const fake = fakeAgy();
  const s = antigravity.open(opts(envOf(fake), { access: "edits", mcp, connections: [conn] }));
  await s.turn("hi", recorder().sink, new AbortController().signal);
  assert.equal(await s.update!({ model: "default", effort: "medium", access: "ask" }), true);
  assert.equal(await s.update!({ model: "default", effort: "medium", access: "full" }), false, "into Full: reopened, conn handed over");
  s.close();
  const t = antigravity.open(opts(envOf(fake), { access: "full", mcp, connections: [conn] }));
  await t.turn("hi", recorder().sink, new AbortController().signal);
  assert.equal(await t.update!({ model: "default", effort: "medium", access: "auto" }), false, "out of Full: reopened without it");
  t.close();
  // Without connections, nothing to reopen for.
  const u = antigravity.open(opts(envOf(fake), { access: "edits", mcp }));
  await u.turn("hi", recorder().sink, new AbortController().signal);
  assert.equal(await u.update!({ model: "default", effort: "medium", access: "full" }), true);
  u.close();
});

test("antigravity: a path outside the project in agy's titles reads from the home folder", () => {
  assert.equal(homeTitle("File ../../../../../../../../../../Users/you/.gemini/antigravity-cli/brain/x/plan.md", "/private/tmp/a/b/proj", "/Users/you", "darwin"), "File ~/.gemini/antigravity-cli/brain/x/plan.md");
  assert.equal(homeTitle("File src/tide.ts", "/private/tmp/p", "/Users/you", "darwin"), "File src/tide.ts");
  assert.equal(homeTitle("Read ../p/inside.ts", "/private/tmp/a/p", "/Users/you", "darwin"), "Read ../p/inside.ts", "one that comes back inside stays");
  assert.equal(homeTitle("Read ../other/x.ts", "/private/tmp/a/p", "/Users/you", "darwin"), "Read /private/tmp/a/other/x.ts", "outside the home folder: whole");
});

test("antigravity: Google's models, a built-in with tools of its own, told Liner Code's tools by the names it offers them", () => {
  assert.equal(makerOf("antigravity:default"), "google");
  assert.equal(makerOf("antigravity:gemini-3.8-flash"), "google");
  assert.equal(providers.antigravity, antigravity);
  // As agy 1.5.6 offers them to its model (seen on the real CLI): mcp_<server>_<tool>, the server liner_<tag>, its tag new each
  // time agy starts and said in the conversation then (namesNote), so a placeholder in what's written once.
  const n = linerName("antigravity");
  assert.equal(n("design_frame"), "mcp_liner_<tag>_design_frame");
  assert.match(toolsNote(n, "antigravity"), /the `liner_<tag>` MCP server.*<tag> is a short code Liner Code makes new each time the agent starts.*mcp_liner_<tag>_design_show shows a screen/s);
  assert.doesNotMatch(toolsNote(n, "antigravity"), /tool_search/, "not Hermes's way of finding them");
  assert.match(toolsNote(linerName("cursor"), "cursor"), /- design_show shows a screen/);
});

// ---- Round 4: what the independent run on the real agy found, and what T3 Code showed.

/** Until the fake has been sent a prompt: the session is up, its turn under way. */
test("antigravity: Stop pressed before the prompt went (agy still starting, or the look before it) sends no prompt at all", async () => {
  const fake = fakeAgy();
  const s = antigravity.open(opts(envOf(fake, { FAKE_SLOW: "5000" }), { access: "full" }));
  const stop = new AbortController();
  // Stopped as the turn begins: whichever await the turn is at, the prompt must not follow its cancel.
  const going = s.turn("hi", recorder().sink, stop.signal);
  stop.abort();
  const t0 = Date.now();
  await going;
  await tick(300);
  s.close();
  assert.ok(Date.now() - t0 < 4000, "no prompt to wait out");
  assert.ok(!methods(fake).includes("session/prompt"), methods(fake).join(","));
});

async function prompted(fake: ReturnType<typeof fakeAgy>) {
  for (let i = 0; i < 500 && !fake.read().some((m) => m.method === "session/prompt"); i++) await tick(10);
}
const initializes = (fake: ReturnType<typeof fakeAgy>) => fake.read().filter((m) => m.method === "initialize").length;
const methods = (fake: ReturnType<typeof fakeAgy>) => fake.read().map((m) => m.method).filter(Boolean);

test("antigravity: the version gate stands in front of every start, not only detection, and is checked again when the file changes", async () => {
  const fake = fakeAgy();
  for (const [version, why] of [["1.4.5", /1\.4\.5 has no ACP/], [`1.20.3\\n${"ab".repeat(20)}\\narm64`, /editor's launcher/], ["", /didn't say which version/]] as const) {
    const f = fakeAgy();
    const s = antigravity.open(opts(envOf(f, { FAKE_VERSION: version })));
    await assert.rejects(s.turn("hi", recorder().sink, new AbortController().signal), why, version);
    s.close();
    assert.deepEqual(methods(f), [], `${version || "no version"}: agy acp never ran`);
  }
  // A file that passed, then replaced by an older build in place: checked again, and refused.
  const env = envOf(fake);
  const s = antigravity.open(opts(env));
  await s.turn("hi", recorder().sink, new AbortController().signal);
  s.close();
  const text = readFileSync(fake.file, "utf8");
  writeFileSync(fake.file, text.replace('env.FAKE_VERSION ?? "1.5.6"', 'env.FAKE_VERSION ?? "1.4.12"'));
  const t = antigravity.open(opts(env));
  await assert.rejects(t.turn("hi", recorder().sink, new AbortController().signal), /1\.4\.12 has no ACP/);
  t.close();
});

test("antigravity: what a turn leaves running (a subagent, a schedule, a daemon) ends with the turn: its row says stopped, the timeline says so, and the next turn resumes", async () => {
  const fake = fakeAgy();
  const sub = { sessionUpdate: "tool_call", toolCallId: "sub1", name: "invoke_subagent", title: "Run invoke_subagent", kind: "other", status: "in_progress", rawInput: { Prompt: "go" } };
  const env = envOf(fake, { FAKE_PROMPT: JSON.stringify([sub]), FAKE_RESUME: "1" });
  const s = antigravity.open(opts(env, { access: "full" }));
  const r = recorder();
  const rows: { key: string; status: string }[] = [];
  r.sink.tool = (u) => void rows.push({ key: u.key, status: u.status });
  await s.turn("hi", r.sink, new AbortController().signal);
  assert.equal(rows.at(-1)?.status, "stopped");
  assert.ok(r.notices.some((n) => /ended it with the turn, so nothing runs where you can't see it/.test(n)), r.notices.join(" | "));
  // The process went with it: the next turn starts agy again, on the same session, by resume.
  const quietEnv = { ...env, FAKE_PROMPT: "" };
  Object.assign(env, quietEnv);
  await s.turn("again", recorder().sink, new AbortController().signal);
  s.close();
  assert.equal(initializes(fake), 2);
  assert.ok(methods(fake).includes("session/resume"));
  // A daemon command, done as a call but still at work: the same.
  const f2 = fakeAgy();
  const daemon = { sessionUpdate: "tool_call", toolCallId: "d1", name: "run_command", title: "sleep 8; touch x", kind: "execute", status: "completed", rawInput: { CommandLine: "sleep 8; touch x", IsDaemon: true } };
  const t = antigravity.open(opts(envOf(f2, { FAKE_PROMPT: JSON.stringify([daemon]) }), { access: "full" }));
  const r2 = recorder();
  await t.turn("hi", r2.sink, new AbortController().signal);
  assert.ok(r2.notices.some((n) => /ended it with the turn/.test(n)));
  // A turn that started nothing of the kind keeps its process.
  const f3 = fakeAgy();
  const u = antigravity.open(opts(envOf(f3), { access: "full" }));
  await u.turn("hi", recorder().sink, new AbortController().signal);
  await u.turn("again", recorder().sink, new AbortController().signal);
  u.close();
  assert.equal(initializes(f3), 1);
});

test("antigravity: Stop ends agy's process and all it started; the open call's row says stopped", async () => {
  const fake = fakeAgy();
  const call = { sessionUpdate: "tool_call", toolCallId: "c1", name: "run_command", title: "sleep 30", kind: "execute", status: "in_progress", rawInput: { CommandLine: "sleep 30" } };
  const env = envOf(fake, { FAKE_PROMPT: JSON.stringify([call]), FAKE_SLOW: "5000" });
  const s = antigravity.open(opts(env, { access: "full" }));
  const r = recorder();
  const rows: string[] = [];
  r.sink.tool = (u) => void rows.push(u.status);
  const stop = new AbortController();
  // Stop once the prompt is out and its call is running (a Stop before it is the next test's).
  const going = s.turn("hi", r.sink, stop.signal);
  await prompted(fake);
  await tick(200);
  const t0 = Date.now();
  stop.abort();
  await going;
  // Not Stop's 15-second wait: at once, give or take the look for what agy left (ps, lsof) and the check that it's gone.
  assert.ok(Date.now() - t0 < 10_000, "at once");
  assert.equal(rows.at(-1), "stopped");
  assert.ok(methods(fake).includes("session/cancel"));
  env.FAKE_PROMPT = "";
  env.FAKE_SLOW = "0";
  await s.turn("again", recorder().sink, new AbortController().signal);
  s.close();
  assert.equal(initializes(fake), 2, "a new process for the next turn");
});

test("antigravity: a quiet prompt ends the turn after its wait, and stops agy (AcpSpec.quietMs)", async () => {
  const fake = fakeAgy();
  const p = acpProvider("acp.quiet", { label: "Quiet", cmd: [fake.file, "acp"], login: "", quietMs: 300, endsWork: true });
  const s = p.open(opts(envOf(fake, { FAKE_SLOW: "60000" })));
  const r = recorder();
  const errors: string[] = [];
  r.sink.error = (m: string) => void errors.push(m);
  const t0 = Date.now();
  await s.turn("hi", r.sink, new AbortController().signal);
  s.close();
  assert.ok(Date.now() - t0 < 5000);
  assert.match(errors.join(" "), /said nothing for a second with nothing running, so Liner Code stopped it/);
});

test("antigravity: a lower level reaches the turn under way: the mode switches at once, Liner Code's answers follow, and with connections handed over the turn has to stop", async () => {
  // Full → Read only mid-turn, no connections: taken in place, plan mode waited on, the later edit refused with no card.
  const fake = fakeAgy();
  const options = [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }];
  const ask = { method: "session/request_permission", params: { sessionId: "agy-1", options, toolCall: { toolCallId: "e1", kind: "edit", title: "File src/a.ts", locations: [{ path: "src/a.ts" }], rawInput: { Path: "src/a.ts" } } } };
  const s = antigravity.open(opts(envOf(fake, { FAKE_ASK: JSON.stringify(ask), FAKE_ASK_DELAY: "400" }), { access: "full" }));
  const r = recorder();
  const turn = s.turn("hi", r.sink, new AbortController().signal);
  await prompted(fake);
  assert.equal(await s.setAccess!("read"), true);
  assert.equal(modesSent(fake).at(-1), "plan", "switched before setAccess answered");
  await turn;
  s.close();
  assert.equal(fake.read().find((m) => m.id === 900 && !m.method)?.result?.outcome?.optionId, "no");
  assert.equal(r.cards.length, 0);
  // Full with a connection → Edits mid-turn: it can't be held, so the runtime stops it; why is said.
  const conn = { name: "conn", stdio: { command: "/usr/bin/true", args: [], env: {} } };
  const f2 = fakeAgy();
  const t = antigravity.open(opts(envOf(f2, { FAKE_SLOW: "600" }), { access: "full", mcp: { command: "/usr/bin/true", args: [], env: {} }, connections: [conn] }));
  const going = t.turn("hi", recorder().sink, new AbortController().signal);
  await prompted(f2);
  assert.match(String(await t.setAccess!("edits")), /was given your connections as this turn started/);
  await going;
  t.close();
  // Edits → Full mid-turn: taken, never a stop; the connection comes with the next turn, by reopening.
  const f3 = fakeAgy();
  const u = antigravity.open(opts(envOf(f3, { FAKE_SLOW: "300" }), { access: "edits", mcp: { command: "/usr/bin/true", args: [], env: {} }, connections: [conn] }));
  const g3 = u.turn("hi", recorder().sink, new AbortController().signal);
  await prompted(f3);
  assert.equal(await u.setAccess!("full"), true);
  await g3;
  assert.equal(u.owes!(), true);
  assert.equal(await u.update!({ model: "default", effort: "medium", access: "full" }), false, "reopened for the next turn");
  u.close();
});

test("runtime: a lower access level during a turn reaches it at once; a tool that can't be held to it part-way has its turn stopped, with why", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "lc-agy-rt-"));
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-agy-rt-home-")));
  store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
  const base = { projectId: "p", title: "T", agent: "@claude:claude-opus-5-5", status: "idle" as const, turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1 };
  store.putThread({ id: "t", access: "full", ...base });
  const runtime = new Runtime(store, { PATH: "/usr/bin:/bin" });
  runtime.providerInfo = [{ id: "claude", label: "Fake tool", available: true, adapter: true, login: "", models: [{ id: "claude-opus-5-5", label: "Opus", description: "" }], supports: { approvals: true, resume: true, effort: false, plan: true } }];
  const saved = providers.claude;
  const seen: string[] = [];
  let answer: boolean | string = true;
  providers.claude = {
    id: "claude",
    detect: async () => runtime.providerInfo[0],
    open: () => ({
      close() {},
      setAccess: async (a) => (seen.push(a), answer),
      turn: async (_text, _sink, signal) => {
        await new Promise<void>((r) => (signal.aborted ? r() : (signal.addEventListener("abort", () => r(), { once: true }), setTimeout(r, 1500))));
      },
    }),
  };
  try {
    // Taken in place: the turn goes on.
    let sent = runtime.send("t", "go");
    await tick(200);
    store.patchThread("t", { access: "edits" });
    await runtime.accessChanged("t", "full");
    await sent;
    assert.deepEqual(seen, ["edits"]);
    assert.ok(!store.timeline("t").some((x) => x.kind === "notice" && /Access went down/.test(x.text)));
    // Can't be held: stopped, with why.
    answer = "it was given what this level doesn't allow";
    store.patchThread("t", { access: "full" });
    sent = runtime.send("t", "go");
    await tick(200);
    const t0 = Date.now();
    store.patchThread("t", { access: "read" });
    await runtime.accessChanged("t", "full");
    await sent;
    assert.ok(Date.now() - t0 < 1200, "stopped, not run out");
    const line = store.timeline("t").find((x) => x.kind === "notice" && /Access went down to Read only during this turn/.test(x.text));
    assert.ok(line, "said");
    assert.match((line as { text: string }).text, /it was given what this level doesn't allow, so Liner Code stopped the turn\.$/);
  } finally {
    providers.claude = saved;
  }
});

test("antigravity: the system prompt holds what doesn't change; the level is said in the conversation at the first turn, after a resume and after every change, never in system text", async () => {
  const fake = fakeAgy();
  const env = envOf(fake, { FAKE_SYS: "1", FAKE_RESUME: "1" });
  const s = antigravity.open(opts(env, { soul: "SOUL-TEXT", access: "read" }));
  await s.turn("first", recorder().sink, new AbortController().signal);
  const opened = fake.read().find((m) => m.method === "session/new")!;
  const append = String(((opened.params!._meta as Record<string, Record<string, Record<string, string>>>).antigravity.systemPrompt).append);
  assert.match(append, /^Nothing outlives your turn here\..*\n\nSOUL-TEXT$/s);
  assert.match(append, /server_start \(mcp_liner_<tag>_server_start, <tag> as the conversation last named it\)/, "the dev server tool by its name, the tag a placeholder: agy keeps this text across a resume");
  assert.doesNotMatch(append, /Access level|Read only|Full access/, "no level in system text");
  const prompts = () => fake.read().filter((m) => m.method === "session/prompt").map((m) => String((m.params!.prompt as { text: string }[])[0].text));
  assert.match(prompts()[0], /^\(Access level now: Liner Code holds this session to Read only.*\)\n\nfirst$/s, "the first turn says the level");
  await s.turn("again", recorder().sink, new AbortController().signal);
  assert.equal(prompts()[1], "again", "said once while it holds");
  await s.update!({ model: "default", effort: "medium", access: "ask" });
  await s.turn("second", recorder().sink, new AbortController().signal);
  assert.match(prompts()[2], /^\(Access level now: Liner Code asks the person before each file edit/);
  s.close();
  // Opened again (an engine restart): resumed, the same system text, and the level said again at the first turn, as it is now.
  const t = antigravity.open(opts(env, { soul: "SOUL-TEXT", access: "full", resume: "agy-1" }));
  await t.turn("third", recorder().sink, new AbortController().signal);
  t.close();
  const resumed = fake.read().find((m) => m.method === "session/resume")!;
  assert.doesNotMatch(JSON.stringify(resumed.params!._meta), /Access level/);
  assert.match(prompts()[3], /^\(Access level now: File edits and commands go ahead without asking \(Full access\)\./);
  assert.doesNotMatch(prompts()[3], /Read only|asks the person/, "no older level claimed as now");
  // An agent that doesn't say it takes one gets the soul in its first message, as before.
  const f2 = fakeAgy();
  const u = antigravity.open(opts(envOf(f2), { soul: "SOUL-TEXT" }));
  await u.turn("first", recorder().sink, new AbortController().signal);
  u.close();
  assert.match(String((f2.read().find((m) => m.method === "session/prompt")!.params!.prompt as { text: string }[])[0].text), /^SOUL-TEXT/);
  assert.equal(f2.read().find((m) => m.method === "session/new")!.params!._meta, undefined);
});

test("antigravity: Read only's refusal ends agy's turn, so the timeline says so, and the model hears it at the start of the next turn", async () => {
  const fake = fakeAgy();
  const options = [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }];
  const ask = { method: "session/request_permission", params: { sessionId: "agy-1", options, toolCall: { toolCallId: "e1", kind: "edit", title: "File src/a.ts", locations: [{ path: "src/a.ts" }], rawInput: { Path: "src/a.ts" } } } };
  const env = envOf(fake, { FAKE_ASK: JSON.stringify(ask) });
  const s = antigravity.open(opts(env, { access: "read" }));
  const r = recorder();
  await s.turn("change it", r.sink, new AbortController().signal);
  assert.ok(r.notices.some((n) => /This session only reads, so agy wasn't let change src\/a\.ts, and that ended its turn\./.test(n)), r.notices.join(" | "));
  env.FAKE_ASK = "";
  await s.turn("well?", recorder().sink, new AbortController().signal);
  s.close();
  const last = String((fake.read().filter((m) => m.method === "session/prompt").at(-1)!.params!.prompt as { text: string }[])[0].text);
  assert.match(last, /^\(Last turn Liner Code refused your request to change src\/a\.ts: this session is Read only\./);
});

test("antigravity: resume before load where agy offers it; a loaded session's history isn't played onto the timeline", async () => {
  for (const resume of [true, false]) {
    const fake = fakeAgy();
    const s = antigravity.open(opts(envOf(fake, resume ? { FAKE_RESUME: "1" } : {}), { resume: "agy-1" }));
    const r = recorder();
    let text = "";
    r.sink.text = (d: string) => void (text += d);
    await s.turn("hi", r.sink, new AbortController().signal);
    s.close();
    assert.ok(methods(fake).includes(resume ? "session/resume" : "session/load"), String(resume));
    assert.ok(!methods(fake).includes("session/new"));
    assert.doesNotMatch(text, /REPLAYED/);
  }
});

test("antigravity: a refusal stop is its quota, not a refusal; Liner Code doesn't offer to write files for it; a model the account can't use is said in T3 Code's words", async () => {
  const fake = fakeAgy();
  const s = antigravity.open(opts(envOf(fake, { FAKE_STOP: "refusal", FAKE_BADMODEL: "gemini-9" }), { model: "gemini-9" }));
  const r = recorder();
  await s.turn("hi", r.sink, new AbortController().signal);
  s.close();
  assert.ok(r.notices.some((n) => /^Antigravity stopped: the quota for this period looks used up/.test(n)), r.notices.join(" | "));
  assert.ok(!r.notices.some((n) => /declined this one/.test(n)));
  assert.ok(r.notices.includes("Antigravity model 'gemini-9' is unavailable for this Google account. Select an available model."));
  const init = fake.read().find((m) => m.method === "initialize")!;
  assert.deepEqual((init.params!.clientCapabilities as { fs: unknown }).fs, { readTextFile: true, writeTextFile: false });
});

test("antigravity: the person's connections at an address can't reach agy at any level, and are named", async () => {
  const web = { name: "web", http: { url: "https://x.example/mcp", headers: {} } };
  const conn = { name: "conn", stdio: { command: "/usr/bin/true", args: [], env: {} } };
  const fake = fakeAgy();
  const s = antigravity.open(opts(envOf(fake), { access: "full", mcp: { command: "/usr/bin/true", args: [], env: {} }, connections: [conn, web] }));
  const r = recorder();
  await s.turn("hi", r.sink, new AbortController().signal);
  s.close();
  assert.deepEqual((fake.read().find((m) => m.method === "session/new")!.params!.mcpServers as { name: string }[]).map((x) => x.name), ["liner", "conn"]);
  assert.ok(r.notices.some((n) => /Your connection web can't reach agy at any level: it takes connections that run as a command on this Mac, not ones at an address\./.test(n)), r.notices.join(" | "));
  assert.match(String((fake.read().find((m) => m.method === "session/prompt")!.params!.prompt as { text: string }[])[0].text), /web is reached at an address, which you don't take/);
});

test("antigravity: `agy models` read by the base ids a session listed; a missing key reads as not signed in", async () => {
  const fake = fakeAgy();
  const raw = ["gemini-3.8-flash-high\\tGemini 3.8 Flash (High)", "gemini-3.8-flash-low\\tGemini 3.8 Flash (Low)", "gemini-3.1-pro-high\\tGemini 3.1 Pro (High)", "claude-sonnet-4-6\\tClaude Sonnet 4.6 (Thinking)", "gpt-oss-120b-medium\\tGPT-OSS 120B (Medium)"].join("\\n");
  const env = envOf(fake, { FAKE_MODELS_RAW: raw });
  // Without a session's families: one Pro line with a level reads as its own model.
  const before = await agyModels(fake.file, env);
  assert.deepEqual(before.models.map((m) => m.id), ["gemini-3.8-flash", "gemini-3.1-pro-high", "claude-sonnet-4-6", "gpt-oss-120b-medium"]);
  // With them (its model option's values): by the longest it starts with.
  const after = await agyModels(fake.file, env, ["gemini-3.8-flash", "gemini-3.1-pro", "claude-sonnet-4-6", "gpt-oss-120b-medium"]);
  assert.deepEqual(after.models.map((m) => [m.id, m.efforts?.map((e) => e.id).join("/") ?? ""]), [["gemini-3.8-flash", "low/high"], ["gemini-3.1-pro", "high"], ["claude-sonnet-4-6", ""], ["gpt-oss-120b-medium", ""]]);
  // A key it was told to use and doesn't have (V: logs/signin-h3.json).
  const f2 = fakeAgy();
  writeFileSync(f2.file, readFileSync(f2.file, "utf8").replace('if (env.FAKE_MODELS === "broken")', 'if (env.FAKE_MODELS === "nokey") { process.stderr.write("Error: the GEMINI_API_KEY environment variable is not set\\n"); process.exit(1); }\n  if (env.FAKE_MODELS === "broken")'));
  assert.equal((await agyModels(f2.file, envOf(f2, { FAKE_MODELS: "nokey" }))).signedIn, false);
});

test("effort: a level the model doesn't take becomes the nearest it has, its default where two are as near", () => {
  const pro = [{ id: "low" }, { id: "high" }];
  assert.equal(nearestEffort("max", pro, "low"), "high");
  assert.equal(nearestEffort("xhigh", pro, "low"), "high");
  assert.equal(nearestEffort("medium", pro, "low"), "low", "as near: its default");
  assert.equal(nearestEffort("medium", pro, "high"), "high");
  assert.equal(nearestEffort("minimal", pro, "high"), "low");
  assert.equal(nearestEffort("high", pro, "low"), "high", "one it has stays");
  assert.equal(nearestEffort("ultracode", pro, "low"), "low", "not a level: its default");
  assert.equal(nearestEffort("max", [], "low"), "max", "a model with no levels");
});

test("antigravity: a Liner Code tool's input agy showed cut to its end says so on its row", async () => {
  const fake = fakeAgy();
  const update = { sessionUpdate: "tool_call", toolCallId: "f1", name: "mcp_liner_design_frame", title: "Run mcp_liner_design_frame", kind: "other", status: "completed", rawInput: { name: "Phone", html: "[Earlier output truncated]\n\n</body></html>", toolSummary: "Frame" } };
  const s = antigravity.open(opts(envOf(fake, { FAKE_PROMPT: JSON.stringify([update]) }), { mcp: { command: "/usr/bin/true", args: [], env: {} } }));
  const r = recorder();
  let input = "";
  r.sink.tool = (u) => void (u.key === "f1" && (input = u.input ?? ""));
  await s.turn("hi", r.sink, new AbortController().signal);
  s.close();
  assert.match(input, /^\(agy showed only the end of this, its last 8,000 characters; the tool had it whole\.\)/);
  assert.doesNotMatch(input, /toolSummary/);
});

test("antigravity: the level note tells the model what each level refuses; the standing note, that nothing outlives a turn and why", () => {
  assert.match(levelNote("read", "liner_ab12cd"), /Read only.*tools of servers other than liner_ab12cd are refused.*ends your turn/);
  for (const a of ACCESS) assert.match(levelNote(a), /^Access level now: /);
  const note = standingNote("agy", "liner_ab12cd");
  assert.match(note, /scheduled tasks \(schedule\), swarms, subagents.*daemons/);
  assert.match(note, /the person can only see, and stop, what happens inside a turn/);
  assert.match(note, /mcp_liner_ab12cd_server_start/);
});

test("antigravity: a turn Google refused ends as a normal one with only agy's error words: the timeline says what it most likely is", async () => {
  const fake = fakeAgy();
  const said = { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "\n⚠ Agent execution terminated due to error.\n" } };
  const s = antigravity.open(opts(envOf(fake, { FAKE_PROMPT: JSON.stringify([said]) })));
  const r = recorder();
  await s.turn("hi", r.sink, new AbortController().signal);
  s.close();
  assert.ok(r.notices.some((n) => /^Antigravity stopped on an error from Google that it didn't name: most often a used-up quota or a rate limit/.test(n)), r.notices.join(" | "));
});

// ————— Round Q2 —————

test("antigravity: Liner Code's server goes to agy under a name of its own, and only that name is Liner Code's: a server of the person's called liner gets a card like any other", async () => {
  const fake = fakeAgy();
  const options = [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }];
  const call = (toolCall: Record<string, unknown>) => ({ method: "session/request_permission", params: { sessionId: "agy-1", options, toolCall: { toolCallId: "c1", status: "pending", ...toolCall } } });
  const mcp = { command: "/usr/bin/true", args: [], env: {} };
  // Opened with no name given (as a test or a caller might), it makes one: liner_<6 hex>, handed over in session/new.
  const s = antigravity.open(opts(envOf(fake), { mcp, mcpName: undefined }));
  await s.turn("hi", recorder().sink, new AbortController().signal);
  s.close();
  const servers = (fake.read().find((m) => m.method === "session/new")!.params!.mcpServers as { name: string }[]).map((x) => x.name);
  assert.match(servers[0], /^liner_[0-9a-f]{6}$/);
  assert.ok(!servers.includes("liner"));
  const ask = async (toolCall: Record<string, unknown>, access: Access) => {
    const f = fakeAgy();
    const t = antigravity.open(opts(envOf(f, { FAKE_ASK: JSON.stringify(call(toolCall)) }), { access, mcp, mcpName: "liner_ab12cd" }));
    const r = recorder();
    const rows: string[] = [];
    r.sink.tool = (u) => void rows.push(u.tool);
    await t.turn("go", r.sink, new AbortController().signal);
    t.close();
    return { card: r.cards.length > 0, picked: f.read().find((m) => m.id === 900 && !m.method)?.result?.outcome?.optionId, rows };
  };
  // Ours, by its own name: no card, Liner Code's row.
  assert.deepEqual(await ask({ kind: "other", title: "Run mcp_liner_ab12cd_design_files", name: "mcp_liner_ab12cd_design_files", rawInput: { toolSummary: "Files" } }, "ask"), { card: false, picked: "yes", rows: [] });
  assert.deepEqual((await ask({ kind: "execute", title: "MCP Tool design_files", name: "call_mcp_tool", rawInput: { ServerName: "liner_ab12cd", ToolName: "design_files", Arguments: {} } }, "ask")).card, false);
  // The person's own `liner`, eager or through call_mcp_tool: a card at Ask, refused at Read only, never Liner Code's.
  for (const shape of [{ kind: "other", title: "Run mcp_liner_design_files", name: "mcp_liner_design_files", rawInput: { toolSummary: "Files" } }, { kind: "execute", title: "MCP Tool design_files", name: "call_mcp_tool", rawInput: { ServerName: "liner", ToolName: "design_files", Arguments: {} } }, { kind: "execute", title: "MCP Tool ping", name: "call_mcp_tool", rawInput: { ServerName: "liner", ToolName: "ping", Arguments: {} } }]) {
    assert.equal((await ask(shape, "ask")).card, true, JSON.stringify(shape));
    assert.deepEqual(await ask(shape, "read"), { card: false, picked: "no", rows: [] }, `read: ${JSON.stringify(shape)}`);
  }
  // Recognised only by that name; the plain one stays the generic reading for other agents.
  assert.deepEqual(linerCall("mcp_liner_ab12cd_design_tree", { frame: "a", toolSummary: "x" }, "liner_ab12cd"), { name: "design_tree", input: { frame: "a" } });
  for (const t of ["mcp_liner_design_tree", "mcp_liner_ab12cd_not_ours", "mcp_liner_ab12cdx_design_tree", "mcp(liner/design_tree)", "liner/design_tree"]) assert.equal(linerCall(t, {}, "liner_ab12cd"), undefined, t);
  assert.deepEqual(linerCall("mcp(liner_ab12cd/design_tree)", {}, "liner_ab12cd"), { name: "design_tree", input: {} });
  // The model is told the names it's offered.
  const n = linerName("antigravity", "liner_ab12cd");
  assert.equal(n("design_frame"), "mcp_liner_ab12cd_design_frame");
  assert.match(toolsNote(n, "antigravity", "liner_ab12cd"), /the `liner_ab12cd` MCP server.*mcp_liner_ab12cd_design_show shows/s);
});

test("runtime: an Antigravity session's server name is new each time agy starts, kept nowhere, and the model hears it then", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "lc-agy-tag-"));
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-agy-tag-home-")));
  store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
  store.putThread({ id: "t", access: "edits", projectId: "p", title: "T", agent: "@antigravity:default", status: "idle", turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  const tools = { serverFor: () => ({ command: "x", args: [], env: {} }) } as unknown as ConstructorParameters<typeof Runtime>[2];
  const runtime = new Runtime(store, { PATH: "/usr/bin:/bin" }, tools);
  runtime.providerInfo = [{ id: "antigravity", label: "Antigravity CLI", available: true, adapter: true, login: "", models: [{ id: "default", label: "d", description: "" }], supports: { approvals: true, resume: true, effort: false, plan: true } }];
  const saved = providers.antigravity;
  const seen: OpenOptions[] = [];
  providers.antigravity = { id: "antigravity", detect: async () => runtime.providerInfo[0], open: (o) => (seen.push(o), { close() {}, turn: async (_t, sink) => sink.session("agy-1") }) };
  try {
    await runtime.send("t", "one");
  } finally {
    providers.antigravity = saved;
  }
  // The runtime names none (the session makes it), keeps none on the thread, and writes the soul with the tag as a placeholder.
  assert.equal(seen[0].mcpName, undefined);
  assert.ok(!("toolTag" in store.thread("t")));
  assert.match(seen[0].soul, /mcp_liner_<tag>_design_show/);

  // The session itself: a new name in each process, a resume and a reload included, each handed over and said at its first turn.
  const fake = fakeAgy();
  const env = envOf(fake, { FAKE_SYS: "1", FAKE_RESUME: "1" });
  const mcp = { command: "/usr/bin/true", args: [], env: {} };
  const names = () => fake.read().filter((m) => /^session\/(new|resume|load)$/.test(m.method ?? "")).map((m) => (m.params!.mcpServers as { name: string }[])[0].name);
  const prompts = () => fake.read().filter((m) => m.method === "session/prompt").map((m) => String((m.params!.prompt as { text: string }[])[0].text));
  const s = antigravity.open(opts(env, { mcp, mcpName: undefined }));
  await s.turn("first", recorder().sink, new AbortController().signal);
  await s.turn("again", recorder().sink, new AbortController().signal);
  await s.close();
  const u = antigravity.open(opts(env, { mcp, mcpName: undefined, resume: "agy-1" }));
  await u.turn("resumed", recorder().sink, new AbortController().signal);
  await u.close();
  const [a, b] = names();
  assert.match(a, /^liner_[0-9a-f]{6}$/);
  assert.match(b, /^liner_[0-9a-f]{6}$/);
  assert.notEqual(a, b, "a resume gets a name of its own, not the one an earlier process had");
  assert.match(prompts()[0], new RegExp(`\\(Liner Code's tools are on the MCP server ${a} now: call each as mcp_${a}_<tool>`));
  assert.doesNotMatch(prompts()[1], /Liner Code's tools are on/, "said once a process");
  assert.match(prompts()[2], new RegExp(`MCP server ${b} now.*isn't Liner Code's`, "s"));
  // Only the name of the process that runs now is Liner Code's: a call by the earlier one's gets a card at Ask.
  const options = [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }];
  const f2 = fakeAgy();
  const ask = (name: string) => JSON.stringify({ method: "session/request_permission", params: { sessionId: "agy-1", options, toolCall: { toolCallId: "c1", status: "pending", kind: "other", title: `Run ${name}`, name, rawInput: {} } } });
  const v = antigravity.open(opts(envOf(f2), { mcp, mcpName: undefined, access: "ask" }));
  await v.turn("warm", recorder().sink, new AbortController().signal);
  await v.close();
  const was = (f2.read().find((m) => m.method === "session/new")!.params!.mcpServers as { name: string }[])[0].name;
  const w = antigravity.open(opts(envOf(f2, { FAKE_ASK: ask(`mcp_${was}_design_files`) }), { mcp, mcpName: undefined, access: "ask", resume: "agy-1" }));
  const r = recorder();
  await w.turn("go", r.sink, new AbortController().signal);
  await w.close();
  assert.equal(r.cards.length, 1, "the earlier process's name is someone else's now");
});

test("antigravity: what agy leaves running out of its own tree (a backgrounded command, a double fork) is found by its marker and ended with the turn, and with Stop; the next turn hears what was ended", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-agy-bg-"));
  const late = join(dir, "late.txt");
  // A double fork: the shell's child goes on after the shell, and neither is in agy's tree or group by then.
  const fake = fakeAgy();
  const line = join(dir, "spawn.sh");
  writeFileSync(line, `(sleep 1.5; touch ${late}) & (trap '' TERM; sleep 4; touch ${late}.stubborn) &`);
  const env = envOf(fake, { FAKE_SPAWN: line, FAKE_SLOW: "300", FAKE_RESUME: "1" });
  // Its own waits, short: what ignores SIGTERM gets SIGKILL after 300 ms (AcpSpec.killAfterMs), not 2 s.
  const agy = acpProvider("antigravity", { ...ANTIGRAVITY, killAfterMs: 300 });
  const s = agy.open(opts(env, { access: "full" }));
  const r = recorder();
  await s.turn("hi", r.sink, new AbortController().signal);
  assert.ok(r.notices.some((n) => /^agy left “.*sleep 1\.5.*” going after its answer\. Liner Code ended it with the turn/.test(n)), r.notices.join(" | "));
  // Past the first sleep; the one that ignored SIGTERM (and would write at 4 s) had SIGKILL 300 ms after it was asked.
  await tick(1700);
  assert.ok(!existsSync(late), "nothing it started ran on");
  await tick(2500);
  assert.ok(!existsSync(`${late}.stubborn`), "not even what wouldn't end when asked");
  writeFileSync(line, "");
  const r2 = recorder();
  await s.turn("again", r2.sink, new AbortController().signal);
  assert.deepEqual(r2.notices, [], "nothing left this time");
  const last = String((fake.read().filter((m) => m.method === "session/prompt").at(-1)!.params!.prompt as { text: string }[])[0].text);
  assert.match(last, /^\(When your last turn ended, .*sleep 1\.5.* still going, and Liner Code ended (it|them): nothing runs past a turn here\./);
  // A turn that leaves nothing keeps agy as it is.
  const before = initializes(fake);
  await s.turn("and again", recorder().sink, new AbortController().signal);
  assert.equal(initializes(fake), before);
  s.close();
  // Stop: the same, before Stop's turn is handed back.
  writeFileSync(line, `(sleep 1.5; touch ${late}.stop) &`);
  const t = agy.open(opts({ ...env, FAKE_SLOW: "5000" }, { access: "full" }));
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 400);
  await t.turn("stop me", recorder().sink, stop.signal);
  t.close();
  await tick(1300);
  assert.ok(!existsSync(`${late}.stop`), "Stop ended it");
});

test("antigravity: schedule and swarm are no longer refused (agy asks nothing for them): only a daemon is", async () => {
  const options = [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }];
  for (const [toolCall, picked] of [[{ kind: "other", title: "Run schedule", name: "schedule", rawInput: { Prompt: "x" } }, "yes"], [{ kind: "execute", title: "sleep 9", name: "run_command", rawInput: { CommandLine: "sleep 9", IsDaemon: true } }, "no"]] as const) {
    const f = fakeAgy();
    const ask = { method: "session/request_permission", params: { sessionId: "agy-1", options, toolCall: { toolCallId: "c1", status: "pending", ...toolCall } } };
    const t = antigravity.open(opts(envOf(f, { FAKE_ASK: JSON.stringify(ask) }), { access: "full" }));
    await t.turn("go", recorder().sink, new AbortController().signal);
    t.close();
    assert.equal(f.read().find((m) => m.id === 900 && !m.method)?.result?.outcome?.optionId, picked, toolCall.name);
  }
});

test("antigravity: the gate's answer is kept by the file's change time too, so a swap with its size and mtime put back is checked again", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-agy-gate-"));
  const file = join(dir, "agy");
  const runs = join(dir, "runs");
  const script = (v: string) => `#!/bin/sh\necho x >> ${runs}\necho ${v}\n`;
  writeFileSync(file, script("1.5.6"), { mode: 0o755 });
  const { mtime } = statSync(file);
  assert.equal((await checkGate(file, { PATH: "/usr/bin:/bin" }, "1.5.0", "Antigravity CLI", "agy")).why, undefined);
  await checkGate(file, { PATH: "/usr/bin:/bin" }, "1.5.0", "Antigravity CLI", "agy");
  assert.equal(readFileSync(runs, "utf8").split("\n").filter(Boolean).length, 1, "kept while the file is as it was");
  await tick(20);
  // Same size, same inode (written in place), its modification time set back.
  writeFileSync(file, script("1.4.5"));
  utimesSync(file, mtime, mtime);
  assert.match(String((await checkGate(file, { PATH: "/usr/bin:/bin" }, "1.5.0", "Antigravity CLI", "agy")).why), /1\.4\.5 has no ACP/);
});

test("antigravity: a minute with nothing new but agy's retry lines says so once, with Stop beside it; both waits come from the spec, and a dev run can shorten them", async () => {
  const fake = fakeAgy();
  const retry = { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "\n⚠ API error (attempt 1): Error 429, Message: Resource has been exhausted, Status: RESOURCE_EXHAUSTED\n" } };
  const p = acpProvider("acp.hint", { label: "Hint", cmd: [fake.file, "acp"], login: "", hintMs: 300, quietMs: 60_000, endsWork: true });
  const s = p.open(opts(envOf(fake, { FAKE_PROMPT: JSON.stringify([retry]), FAKE_SLOW: "1200" })));
  const seen: { text: string; stop?: boolean }[] = [];
  const r = recorder();
  r.sink.notice = (text: string, _key?: string, o?: { stop?: boolean }) => void seen.push({ text, stop: o?.stop });
  await s.turn("hi", r.sink, new AbortController().signal);
  s.close();
  const hint = seen.filter((n) => /hasn't said anything new for a second: it may be retrying a busy or used-up API/.test(n.text));
  assert.equal(hint.length, 1, JSON.stringify(seen));
  assert.equal(hint[0].stop, true);
  // A dev run's variables, for every tool whose spec has the waits.
  devWaits({ LINER_DEV_HINT_MS: "200", LINER_DEV_QUIET_MS: "400" });
  try {
    const f2 = fakeAgy();
    const q = acpProvider("acp.dev", { label: "Dev", cmd: [f2.file, "acp"], login: "", hintMs: 60_000, quietMs: 15 * 60_000, endsWork: true }).open(opts(envOf(f2, { FAKE_SLOW: "60000" })));
    const r2 = recorder();
    const errors: string[] = [];
    r2.sink.error = (m: string) => void errors.push(m);
    const t0 = Date.now();
    await q.turn("hi", r2.sink, new AbortController().signal);
    q.close();
    assert.ok(Date.now() - t0 < 30_000, "the dev wait, not 15 minutes");
    assert.match(errors.join(" "), /said nothing for a second/);
  } finally {
    devWaits({});
  }
});

test("read only through the ACP path (OpenCode, Hermes, any agent added): an edit ask and a command ask are refused by the runtime with no card; at Ask they are cards", async () => {
  const options = [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }];
  const asks = [
    { method: "session/request_permission", params: { sessionId: "agy-1", options, toolCall: { toolCallId: "e1", kind: "edit", title: "Edit src/a.ts", locations: [{ path: "src/a.ts" }], rawInput: { filePath: "src/a.ts" } } } },
    { method: "session/request_permission", params: { sessionId: "agy-1", options, toolCall: { toolCallId: "x1", kind: "execute", title: "touch made.txt", rawInput: { command: "touch made.txt" } } } },
  ];
  for (const access of ["read", "ask"] as Access[]) {
    const fake = fakeAgy();
    const cwd = mkdtempSync(join(tmpdir(), "lc-acp-ro-"));
    const store = new Store(mkdtempSync(join(tmpdir(), "lc-acp-ro-home-")));
    store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
    store.putThread({ id: "t", access, projectId: "p", title: "T", agent: "@hermes:default", status: "idle", turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
    const runtime = new Runtime(store, envOf(fake, { FAKE_ASK: JSON.stringify(asks) }));
    runtime.providerInfo = [{ id: "hermes", label: "Hermes", available: true, adapter: true, login: "", models: [{ id: "default", label: "d", description: "" }], supports: { approvals: true, resume: true, effort: false, plan: true } }];
    const saved = providers.hermes;
    providers.hermes = acpProvider("hermes", { label: "Hermes", cmd: [fake.file, "acp"], login: "" });
    try {
      const sent = runtime.send("t", "go");
      if (access === "ask") {
        for (let n = 0; n < 2; n++) {
          let card: { id: string } | undefined;
          for (let i = 0; i < 300 && !(card = store.timeline("t").find((x) => x.kind === "approval" && x.state === "asking")); i++) await tick();
          assert.ok(card, `card ${n + 1}`);
          runtime.answer("t", card!.id, false);
        }
      }
      await sent;
    } finally {
      providers.hermes = saved;
      runtime.shutdown();
    }
    const answered = fake.read().filter((m) => typeof m.id === "number" && m.id >= 900 && !m.method).map((m) => m.result?.outcome?.optionId);
    assert.deepEqual(answered, ["no", "no"], access);
    const cards = store.timeline("t").filter((x) => x.kind === "approval");
    if (access === "read") {
      assert.equal(cards.length, 0, "no card at Read only");
      assert.ok(store.timeline("t").some((x) => x.kind === "notice" && /This session is Read only, so Liner Code refused “Edit src\/a\.ts” without asking\./.test(x.text)));
    } else assert.equal(cards.length, 2, "cards at Ask");
    assert.ok(!existsSync(join(cwd, "made.txt")));
  }
});

// ————— Round Q3 —————

/** A runtime on one thread of agy (the fake, its waits short) beside a stand-in for another tool: Claude Code's id, answering at once. */
function agyRuntime(fake: ReturnType<typeof fakeAgy>, more: Record<string, string> = {}, access: Access = "full") {
  const cwd = mkdtempSync(join(tmpdir(), "lc-agy-q3-"));
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-agy-q3-home-")));
  store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
  store.putThread({ id: "t", access, projectId: "p", title: "T", agent: "@antigravity:default", status: "idle", turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  const runtime = new Runtime(store, envOf(fake, more));
  const info = (id: string, label: string, model: string, name = model) => ({ id, label, available: true, adapter: true, login: "", models: [{ id: model, label: name, description: "" }], supports: { approvals: true, resume: true, effort: false, plan: true } });
  runtime.providerInfo = [info("antigravity", "Antigravity CLI", "default"), info("claude", "Claude Code", "claude-opus-5-5", "Opus 5.5")] as typeof runtime.providerInfo;
  const saved = { antigravity: providers.antigravity, claude: providers.claude };
  const closed: string[] = [];
  providers.antigravity = acpProvider("antigravity", { ...ANTIGRAVITY, killAfterMs: 300 });
  providers.claude = { id: "claude", detect: async () => runtime.providerInfo[1], open: () => ({ close: () => void closed.push("claude"), turn: async (_t, sink) => sink.session("c-1") }) };
  const agys = () => descendants().filter((p) => p.command.includes(fake.file));
  const gone = async (ms = 3000) => {
    for (const end = Date.now() + ms; agys().length && Date.now() < end; ) await tick(50);
    return agys();
  };
  const restore = () => Object.assign(providers, saved);
  return { cwd, store, runtime, agys, gone, restore, closed };
}

test("runtime: moving a thread to another tool ends its agy by the one close: at once when idle; mid-turn the turn stops first, says so in one line, and what it left running ends too", async () => {
  const fake = fakeAgy();
  const dir = mkdtempSync(join(tmpdir(), "lc-agy-move-"));
  const line = join(dir, "spawn.sh");
  writeFileSync(line, "");
  const late = join(dir, "late.txt");
  const { store, runtime, agys, gone, restore } = agyRuntime(fake, { FAKE_SPAWN: line, FAKE_SLOW: "2500" });
  try {
    // Idle: agy is up after its turn, and goes as soon as the thread moves, not when it's archived.
    await runtime.send("t", "one");
    assert.equal(agys().length, 1, "agy up after its turn");
    store.patchThread("t", { agent: "@claude:claude-opus-5-5" });
    await runtime.retool("t");
    assert.deepEqual(await gone(), [], "agy ended with the move");
    await runtime.send("t", "on claude");
    // Busy: back on agy, a turn under way that sent a command to the background; the thread moves again mid-turn.
    store.patchThread("t", { agent: "@antigravity:default" });
    await runtime.retool("t");
    writeFileSync(line, `(sleep 1.5; touch ${late}) &`);
    const prompts = () => fake.read().filter((m) => m.method === "session/prompt").length;
    const before = prompts();
    const sent = runtime.send("t", "two");
    for (let i = 0; i < 300 && prompts() === before; i++) await tick();
    await tick(150);
    assert.equal(agys().length, 1, "agy at work");
    store.patchThread("t", { agent: "@claude:claude-opus-5-5" });
    const moved = runtime.retool("t");
    await sent;
    await moved;
    const items = store.timeline("t");
    const turn = items.filter((x) => x.kind === "turn").at(-1) as { status: string };
    const notices = items.filter((x) => x.kind === "notice").map((x) => (x as { text: string }).text);
    assert.ok(notices.some((n) => /^This session moved to Claude Code, Opus 5\.5 while Antigravity CLI worked, so Liner Code stopped its turn and ended Antigravity CLI and what it started\.$/.test(n)), notices.join(" | "));
    assert.ok(!notices.includes("You stopped this turn."), "Liner Code stopped it, not you");
    assert.ok(["stopped", "done"].includes(turn.status), turn.status);
    assert.deepEqual(await gone(), [], "agy ended");
    await tick(1800);
    assert.ok(!existsSync(late), "what it sent to the background never wrote its file");
  } finally {
    restore();
    await runtime.shutdown();
  }
});

test("runtime: a sidekick that changes has its old session ended by the same close; a turn's session that opened the old tool is ended once it winds down", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-side-q3-home-")));
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-side-q3-")), git: false, createdAt: 1 });
  store.putThread({ id: "t", access: "full", projectId: "p", title: "T", agent: "@claude:claude-opus-5-5", sidekick: "antigravity:default", status: "idle", turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  const tools = { serverFor: () => ({ command: "x", args: [], env: {} }) } as unknown as ConstructorParameters<typeof Runtime>[2];
  const runtime = new Runtime(store, { PATH: "/usr/bin:/bin" }, tools);
  const closed: string[] = [];
  const live = (runtime as unknown as { live: Map<string, { session: { close(): void }; provider: string; key: string; links: string; kit: string }> }).live;
  live.set("t:@claude:claude-opus-5-5", { session: { close: () => void closed.push("lead") }, provider: "claude", key: "", links: "", kit: "" });
  live.set("t:@antigravity:default#sidekick", { session: { close: () => void closed.push("sidekick") }, provider: "antigravity", key: "", links: "", kit: "" });
  store.patchThread("t", { sidekick: "codex:gpt-6" });
  await runtime.retool("t");
  assert.deepEqual(closed, ["sidekick"], "the old sidekick ends; the lead, unchanged, stays");
  assert.deepEqual([...live.keys()], ["t:@claude:claude-opus-5-5"]);
  // The lead's model on the same tool under another name moves, as it is, and takes the change as its next turn opens.
  store.patchThread("t", { agent: "@claude:claude-sonnet-5-5" });
  await runtime.retool("t");
  assert.deepEqual(closed, ["sidekick"]);
  assert.deepEqual([...live.keys()], ["t:@claude:claude-sonnet-5-5"]);
});

test("runtime: Stop at the instant a session starts leaves no agy that isn't the thread's own live session, and closing the thread ends that", async () => {
  const fake = fakeAgy();
  const { store, runtime, agys, gone, restore } = agyRuntime(fake, { FAKE_SLOW: "2000" });
  try {
    for (const ms of [0, 5, 20, 60, 150, 400]) {
      const sent = runtime.send("t", `go ${ms}`);
      if (ms) await tick(ms);
      runtime.stop("t");
      await sent;
      await tick(100);
      const up = agys();
      const own = (await runtime.inspect("t")).live;
      assert.ok(up.length <= 1, `stop at ${ms}: ${up.length} agy`);
      if (up.length) assert.ok(own, `stop at ${ms}: the agy up is the thread's live session`);
      assert.ok(!store.timeline("t").some((x) => x.kind === "turn" && (x as { status: string }).status === "running"));
    }
    await runtime.closeThread("t");
    assert.deepEqual(await gone(), [], "closing the thread ends it");
  } finally {
    restore();
    await runtime.shutdown();
  }
});

test("runtime: Stop is decisive from the moment it's pressed: a prompt not yet sent never goes, one already sent is cancelled at once", async () => {
  const fake = fakeAgy();
  const { runtime, restore } = agyRuntime(fake, { FAKE_SLOW: "3000" });
  const sentNow = () => fake.read().filter((m) => m.method === "session/prompt").length;
  const cancels = () => fake.read().filter((m) => m.method === "session/cancel").length;
  try {
    await runtime.send("t", "warm");
    // warm took its 3 s: from here each case is a turn on a running agy.
    const seen = new Set<boolean>();
    for (const ms of [0, 10, 40, 80, 150, 300]) {
      const p0 = sentNow();
      const c0 = cancels();
      const t0 = Date.now();
      const sent = runtime.send("t", `go ${ms}`);
      if (ms) await tick(ms);
      const out = sentNow() > p0;
      seen.add(out);
      runtime.stop("t");
      const pressed = Date.now();
      if (out) {
        for (let i = 0; i < 200 && cancels() === c0; i++) await tick(5);
        assert.ok(cancels() > c0, `stop at ${ms}: cancelled`);
        assert.ok(Date.now() - pressed < 150, `stop at ${ms}: session/cancel ${Date.now() - pressed} ms after Stop`);
      }
      await sent;
      if (!out) assert.equal(sentNow(), p0, `stop at ${ms}: the prompt never went`);
      assert.ok(Date.now() - t0 < 2500, `stop at ${ms}: the turn ended in ${Date.now() - t0} ms, not after the prompt's 3 s`);
    }
    assert.deepEqual([...seen].sort(), [false, true], "both cases met: stopped before the prompt went, and after");
  } finally {
    restore();
    await runtime.shutdown();
  }
});

test("read only through the ACP path: the model can't be told why in the turn (ACP's no carries no words, and OpenCode's ACP drops any), so its next turn starts with it", async () => {
  const options = [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }];
  const asks = [{ method: "session/request_permission", params: { sessionId: "agy-1", options, toolCall: { toolCallId: "x1", kind: "execute", title: "touch made.txt", rawInput: { command: "touch made.txt" } } } }];
  const fake = fakeAgy();
  const cwd = mkdtempSync(join(tmpdir(), "lc-acp-ro2-"));
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-acp-ro2-home-")));
  store.putProject({ id: "p", name: "p", path: cwd, git: false, createdAt: 1 });
  store.putThread({ id: "t", access: "read", projectId: "p", title: "T", agent: "@opencode:default", status: "idle", turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  const runtime = new Runtime(store, envOf(fake, { FAKE_ASK: JSON.stringify(asks) }));
  runtime.providerInfo = [{ id: "opencode", label: "OpenCode", available: true, adapter: true, login: "", models: [{ id: "default", label: "d", description: "" }], supports: { approvals: true, resume: true, effort: false, plan: true } }];
  const saved = providers.opencode;
  // OpenCode's own provider, run on the fake (its command by path): the same ACP session, the same no.
  providers.opencode = acpProvider("opencode", { label: "OpenCode", cmd: [fake.file, "acp"], login: "" });
  try {
    await runtime.send("t", "go");
    await runtime.send("t", "again");
  } finally {
    providers.opencode = saved;
    await runtime.shutdown();
  }
  const prompts = fake.read().filter((m) => m.method === "session/prompt").map((m) => String((m.params!.prompt as { text: string }[])[0].text));
  assert.equal(fake.read().find((m) => m.id === 900 && !m.method)?.result?.outcome?.optionId, "no");
  assert.match(prompts[1], /^\(Last turn Liner Code refused a step: This session is Read only, so Liner Code refused this command without asking anyone\./);
});

test("antigravity: a command that sent something off that its marker can't find (it closed what it was handed and left) is said to be maybe still running, untracked, never ended", async () => {
  const detach = "perl -e 'use POSIX; POSIX::close($_) for 3..255; exit 0 if fork(); POSIX::setsid(); sleep 6' ; sleep 0.3";
  const row = (command: string) => ({ sessionUpdate: "tool_call", toolCallId: "r1", kind: "execute", title: command, status: "completed", rawInput: { command } });
  // Nothing marked is left by it (the fake starts nothing): untracked, said so, and the model hears it next turn.
  const fake = fakeAgy();
  const s = acpProvider("antigravity", { ...ANTIGRAVITY, killAfterMs: 300 }).open(opts(envOf(fake, { FAKE_PROMPT: JSON.stringify([row(detach)]) }), { access: "full" }));
  const r = recorder();
  await s.turn("go", r.sink, new AbortController().signal);
  assert.ok(r.notices.some((n) => /^“perl -e .*” sent something to the background that Liner Code can't find any more, so it may still be running where nobody sees it: Liner Code can't track or end it\./.test(n)), r.notices.join(" | "));
  assert.ok(!r.notices.some((n) => /nothing runs where you can't see it/.test(n)));
  await s.turn("next", recorder().sink, new AbortController().signal);
  await s.close();
  const last = String((fake.read().filter((m) => m.method === "session/prompt").at(-1)!.params!.prompt as { text: string }[])[0].text);
  assert.match(last, /^\(Last turn “perl -e .*” sent something to the background that Liner Code couldn't find to end: it may still be running, unseen\./);
  // One whose background work its marker does find is ended and named, with no such doubt.
  const dir = mkdtempSync(join(tmpdir(), "lc-agy-found-"));
  const line = join(dir, "spawn.sh");
  writeFileSync(line, `(sleep 1.5; touch ${join(dir, "late.txt")}) &`);
  const f2 = fakeAgy();
  const t = acpProvider("antigravity", { ...ANTIGRAVITY, killAfterMs: 300 }).open(opts(envOf(f2, { FAKE_SPAWN: line, FAKE_PROMPT: JSON.stringify([row("(sleep 1.5; touch late.txt) &")]) }), { access: "full" }));
  const r2 = recorder();
  await t.turn("go", r2.sink, new AbortController().signal);
  await t.close();
  assert.ok(r2.notices.some((n) => /Liner Code ended it with the turn, so nothing runs where you can't see it/.test(n)), r2.notices.join(" | "));
  assert.ok(!r2.notices.some((n) => /can't track/.test(n)));
  // A plain command, nothing sent off: nothing said.
  const f3 = fakeAgy();
  const u = acpProvider("antigravity", { ...ANTIGRAVITY, killAfterMs: 300 }).open(opts(envOf(f3, { FAKE_PROMPT: JSON.stringify([row("ls src 2>&1 && echo done")]) }), { access: "full" }));
  const r3 = recorder();
  await u.turn("go", r3.sink, new AbortController().signal);
  await u.close();
  assert.deepEqual(r3.notices, []);
});

test("antigravity: an MCP server agy was handed that it starts late, during a turn (as after a resume), is the session's, not something the turn left: agy is kept", async () => {
  const fake = fakeAgy();
  const dir = mkdtempSync(join(tmpdir(), "lc-agy-late-mcp-"));
  const line = join(dir, "spawn.sh");
  // As agy starts the server it was handed: under itself, by the command line it was given.
  const server = "sleep 30; true # a late liner server";
  writeFileSync(line, server);
  const s = acpProvider("antigravity", { ...ANTIGRAVITY, killAfterMs: 300 }).open(opts(envOf(fake, { FAKE_SPAWN: line }), { access: "full", mcp: { command: "/bin/sh", args: ["-c", server], env: {} } }));
  const r = recorder();
  await s.turn("go", r.sink, new AbortController().signal);
  assert.deepEqual(r.notices, [], "nothing was left by the turn");
  writeFileSync(line, "");
  const before = initializes(fake);
  await s.turn("again", recorder().sink, new AbortController().signal);
  assert.equal(initializes(fake), before, "agy kept, not started again");
  await s.close();
});

test("antigravity: a tool of a server in agy's own settings that runs with no ask below Full (agy does so after a resume, for a name its conversation knew) stops the turn at once, and says so", async () => {
  const mcp = { command: "/usr/bin/true", args: [], env: {} };
  const update = (name: string) => ({ sessionUpdate: "tool_call", toolCallId: "u1", kind: "other", title: `Run ${name}`, name, status: "in_progress", rawInput: { toolSummary: "Step" } });
  const run = async (name: string, access: Access) => {
    const fake = fakeAgy();
    const s = antigravity.open(opts(envOf(fake, { FAKE_PROMPT: JSON.stringify([update(name)]), FAKE_SLOW: "3000" }), { access, mcp, mcpName: "liner_ab12cd" }));
    const errors: string[] = [];
    const r = recorder();
    r.sink.error = (m: string) => void errors.push(m);
    const t0 = Date.now();
    await s.turn("go", r.sink, new AbortController().signal);
    const ms = Date.now() - t0;
    await s.turn("next", recorder().sink, new AbortController().signal);
    await s.close();
    const next = String((fake.read().filter((m) => m.method === "session/prompt").at(-1)!.params!.prompt as { text: string }[])[0].text);
    return { errors, ms, next };
  };
  for (const access of ["read", "ask", "edits"] as Access[]) {
    const r = await run("mcp_liner_5c84a2_design_files", access);
    assert.match(r.errors.join(" | "), /^agy ran “mcp_liner_5c84a2_design_files”, a tool of a server in its own settings, without asking, which .* doesn't let through\. Liner Code can't refuse a step it isn't asked about, so it stopped the turn\.$/, access);
    assert.ok(r.ms < 2500, `${access}: stopped at once, not after the prompt's 3 s (${r.ms} ms)`);
    assert.match(r.next, /\(Last turn you called mcp_liner_5c84a2_design_files, a tool of a server Liner Code didn't give you/);
  }
  // At Full, a connection's tools go without a card anyway; Liner Code's own never stop it.
  assert.deepEqual((await run("mcp_liner_5c84a2_design_files", "full")).errors, []);
  assert.deepEqual((await run("mcp_liner_ab12cd_design_files", "ask")).errors, []);
});

// ————— Round Q3, 2 —————

test("antigravity: after a turn stopped for a foreign liner_<old> call, the next message names Liner Code's server once, as the process now running has it", async () => {
  const fake = fakeAgy();
  const mcp = { command: "/usr/bin/true", args: [], env: {} };
  const foreign = "mcp_liner_5c84a2_design_files";
  const update = { sessionUpdate: "tool_call", toolCallId: "u1", kind: "other", title: `Run ${foreign}`, name: foreign, status: "in_progress", rawInput: {} };
  const s = antigravity.open(opts(envOf(fake, { FAKE_PROMPT: JSON.stringify([update]), FAKE_SLOW: "2000", FAKE_RESUME: "1" }), { access: "ask", mcp, mcpName: undefined }));
  await s.turn("one", recorder().sink, new AbortController().signal);
  await s.turn("two", recorder().sink, new AbortController().signal);
  await s.close();
  const opened = fake.read().filter((m) => /^session\/(new|resume|load)$/.test(m.method ?? "")).map((m) => (m.params!.mcpServers as { name: string }[])[0].name);
  assert.equal(opened.length, 2, "the stop ended agy; the next turn started it again");
  assert.notEqual(opened[0], opened[1]);
  const second = String((fake.read().filter((m) => m.method === "session/prompt").at(-1)!.params!.prompt as { text: string }[])[0].text);
  assert.match(second, /\(Last turn you called mcp_liner_5c84a2_design_files, a tool of a server Liner Code didn't give you/);
  // Every name of Liner Code's server in it (the person's look-alike apart) is the one this process has.
  const ours = new Set((second.match(/liner_[0-9a-f]{6}/g) ?? []).filter((x) => x !== "liner_5c84a2"));
  assert.deepEqual([...ours], [opened[1]], second);
  assert.match(second, new RegExp(`Use Liner Code's tools \\(on ${opened[1]}\\)`));
  assert.doesNotMatch(second, /\u0000/);
});

test("runtime: a session put away while a turn works (Compare's other take kept, archived) says what happened and what was ended, never that you stopped it", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-keep-q3-home-")));
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-keep-q3-")), git: false, createdAt: 1 });
  store.putThread({ id: "t", access: "full", projectId: "p", title: "T", agent: "@claude:claude-opus-5-5", status: "idle", turns: 0, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });
  const runtime = new Runtime(store, { PATH: "/usr/bin:/bin" });
  runtime.providerInfo = [{ id: "claude", label: "Claude Code", available: true, adapter: true, login: "", models: [{ id: "claude-opus-5-5", label: "Opus 5.5", description: "" }], supports: { approvals: true, resume: true, effort: false, plan: true } }];
  const saved = providers.claude;
  let closed = 0;
  providers.claude = { id: "claude", detect: async () => runtime.providerInfo[0], open: () => ({ close: () => void closed++, turn: (_t, _s, signal) => new Promise<void>((r) => (signal.aborted ? r() : signal.addEventListener("abort", () => r(), { once: true }))) }) };
  try {
    const sent = runtime.send("t", "go");
    await tick(100);
    await runtime.closeThread("t", "You kept another take of this comparison (T · Sonnet)");
    await sent;
  } finally {
    providers.claude = saved;
  }
  const notices = store.timeline("t").filter((x) => x.kind === "notice").map((x) => (x as { text: string }).text);
  assert.deepEqual(notices, ["You kept another take of this comparison (T · Sonnet), so Liner Code stopped this turn and ended Claude Code and what it started."]);
  assert.equal(closed, 1);
});

test("sidekick: a brief stopped because the sidekick was replaced tells the lead so, not that the person stopped it", async () => {
  const { sidekickResult } = await import("../src/sidekick.ts");
  const said = sidekickResult({ how: "replaced", who: "Gemini 3.8 Flash", seconds: 4, report: "", files: [] });
  assert.match(said, /^The sidekick changed, so Liner Code stopped the sidekick \(Gemini 3\.8 Flash\) after .* and ended it and what it started\./);
  assert.doesNotMatch(said, /The person stopped/);
});
