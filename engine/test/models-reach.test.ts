/*
  What a model can take, and how a session reaches Liner Code's tools: whether an API endpoint's model takes pictures (the guess, your
  own word, what OpenCode is told, what a tool returns to a model that takes none), Claude Code's Auto through another maker's API
  (it runs as Edits on its own), and Codex keeping Liner Code's tools in the model's first list. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Access, Endpoint, ProviderId, ProviderInfo } from "../../contracts/src/index.ts";
import { PICTURE_GUESS, picturesGuess, picturesOf, takesPictures, toolPicturesKey, VOUCHER } from "../../contracts/src/index.ts";
import { AgentTools, NO_PICTURE, wordsOnly, type McpResult } from "../src/agent-tools.ts";
import { linerCall } from "../src/providers/acp.ts";
import { claude, modeOf, sdk } from "../src/providers/claude.ts";
import { execMcp } from "../src/providers/codex.ts";
import { codexMcp } from "../src/providers/codex-server.ts";
import { endpointOptions, endpointProvider, modelEntry } from "../src/providers/endpoint.ts";
import type { OpenOptions, Provider, ProviderSession, TurnSink } from "../src/providers/types.ts";
import { linerName, toolsNote } from "../src/runtime.ts";

const ep = (protocol: Endpoint["protocol"], models: string[], pictures?: Record<string, boolean>): Endpoint => ({ id: "api-ex", label: "Example", url: "https://api.example.com/v1", protocol, models, ...(pictures ? { pictures } : {}) });

// ---------- 1. Pictures ----------

test("pictures: the guess from a model's name, the same on every protocol where a row knows it", () => {
  const sees = ["claude-sonnet-4-5", "gpt-4o", "gpt-4.1-mini", "gpt-5.5", "o3", "o4-mini", "gemini-2.5-pro", "gemma-3-27b-it", "llama-4-maverick", "qwen2.5-vl-72b-instruct", "glm-4.5v", "llava:13b", "pixtral-large", "grok-4", "kimi-k2.5", "minicpm-v"];
  const text = ["deepseek-chat", "deepseek-reasoner", "deepseek-v3.2", "glm-4.6", "glm-5.1", "minimax-m2.5", "kimi-k2-thinking", "kimi-k2-0905", "qwen3-coder-plus", "gpt-oss-120b", "gpt-4o-transcribe", "o3-mini", "o3-deep-research"];
  for (const p of ["anthropic", "responses", "chat"] as const) {
    for (const m of sees) assert.equal(picturesGuess(p, m), true, `${p} ${m} sees`);
    for (const m of text) assert.equal(picturesGuess(p, m), false, `${p} ${m} is text only`);
  }
  // A name no row knows: no through Chat Completions, yes through the other two.
  assert.equal(picturesGuess("chat", "fake-model"), false);
  assert.equal(picturesGuess("anthropic", "fake-model"), true);
  assert.equal(picturesGuess("responses", "fake-model"), true);
  assert.equal(picturesGuess("chat", "deepseek-v4.1-flash"), false, "a family that's mixed in the catalogue is no row's");
  for (const r of PICTURE_GUESS) assert.ok(r.from.length > 10, "each row says where it comes from");
});

test("pictures: what you set wins over the guess, either way, and an endpoint saved before has none set", () => {
  assert.equal(takesPictures(ep("chat", ["fake-model"]), "fake-model"), false);
  assert.equal(takesPictures(ep("chat", ["fake-model"], { "fake-model": true }), "fake-model"), true);
  assert.equal(takesPictures(ep("anthropic", ["claude-sonnet-4-5"], { "claude-sonnet-4-5": false }), "claude-sonnet-4-5"), false);
  const old = JSON.parse('{"id":"api-ex","label":"Example","url":"https://x/v1","protocol":"chat","models":["gpt-4o"]}') as Endpoint;
  assert.equal(takesPictures(old, "gpt-4o"), true);
  // A session's model: an endpoint's as above ("default" is its first), anything else yes.
  const s = { endpoints: [ep("chat", ["text-one", "gpt-4o"])] };
  assert.equal(picturesOf("opencode.api-ex", "text-one", s), false);
  assert.equal(picturesOf("opencode.api-ex", "default", s), false);
  assert.equal(picturesOf("opencode.api-ex", "gpt-4o", s), true);
  assert.equal(picturesOf("claude.api-ex", "text-one", s), true, "another tool's endpoint of that id isn't this one");
  assert.equal(picturesOf("claude", "claude-opus-5-5", s), true);
  assert.equal(picturesOf("opencode", "default", s), true, "bare OpenCode knows its own models");
  assert.equal(picturesOf(`opencode.${VOUCHER.id}`, VOUCHER.models[0], { voucher: true }), false);
});

test("pictures: OpenCode is told which kind each endpoint model is (its modalities and attachment)", () => {
  const e = ep("chat", ["gpt-4o", "fake-model"], { "fake-model": false });
  assert.deepEqual(modelEntry(e, "gpt-4o"), { name: "gpt-4o", attachment: true, modalities: { input: ["text", "image"], output: ["text"] } });
  assert.deepEqual(modelEntry(e, "fake-model"), { name: "fake-model", attachment: false, modalities: { input: ["text"], output: ["text"] } });
  const cfg = JSON.parse(String(endpointOptions(e, "fake-model", "k", {}).env.OPENCODE_CONFIG_CONTENT)) as { provider: Record<string, { models: Record<string, unknown> }> };
  const models = cfg.provider.liner_api_ex.models;
  assert.deepEqual(Object.keys(models), ["gpt-4o", "fake-model"]);
  assert.deepEqual((models["gpt-4o"] as { modalities: unknown }).modalities, { input: ["text", "image"], output: ["text"] });
  assert.deepEqual((models["fake-model"] as { modalities: unknown }).modalities, { input: ["text"], output: ["text"] });
  const flipped = JSON.parse(String(endpointOptions({ ...e, pictures: { "fake-model": true } }, "fake-model", "k", {}).env.OPENCODE_CONFIG_CONTENT)) as typeof cfg;
  assert.equal((flipped.provider.liner_api_ex.models["fake-model"] as { attachment: boolean }).attachment, true);
});

const look: McpResult = { content: [{ type: "text", text: "The picture is how “Phone” draws. It is 844 px tall. No console errors.\n\nIf the picture doesn't reach you, this is what the frame holds…" }, { type: "image", data: "iVBOR", mimeType: "image/png" }] };

test("pictures: a model that takes none gets the words, the picture out, and what it can do instead", () => {
  const r = wordsOnly(look);
  assert.equal(r.content.length, 2);
  assert.equal(r.content.some((c) => c.type === "image"), false);
  assert.match((r.content[0] as { text: string }).text, /844 px tall/);
  assert.equal((r.content[1] as { text: string }).text, NO_PICTURE);
  assert.match(NO_PICTURE, /doesn't take pictures/);
  assert.match(NO_PICTURE, /ask the person to look/);
  const plain: McpResult = { content: [{ type: "text", text: "Done." }] };
  assert.equal(wordsOnly(plain), plain, "a result with no picture is left as it is");
});

/** AgentTools with a window that answers the Browser, and a host that says which sessions see. */
function toolsWith(sees: (threadId: string, sidekick: boolean) => boolean) {
  let tools: AgentTools;
  const ops: string[] = [];
  const asked: [string, boolean][] = [];
  const store = {
    emit: (e: { id: string; op: string }) => {
      ops.push(e.op);
      setTimeout(() => tools.reply(e.id, true, e.op === "screenshot" ? "iVBORpng" : { url: "/index.html", title: "Tides", text: "High water 14:32", controls: [], errors: ["TypeError: x is undefined"] }), 0);
    },
  };
  tools = new AgentTools(store as never, process.env);
  tools.host = { seesPictures: (t: string, s: boolean) => (asked.push([t, s]), sees(t, s)) } as never;
  return { tools, ops, asked };
}

test("pictures: the Browser's screenshot is a picture for a model that sees, and the page in words for one that doesn't", async () => {
  const { tools, ops, asked } = toolsWith((t) => t !== "th_text");
  const seen = await tools.call("th_sees", "browser_screenshot", {});
  assert.deepEqual(seen.content, [{ type: "image", data: "iVBORpng", mimeType: "image/png" }]);
  const words = await tools.call("th_text", "browser_screenshot", {});
  assert.equal(words.content.length, 1);
  const t = (words.content[0] as { text: string }).text;
  assert.match(t, /^index\.html · Tides[\s\S]*High water 14:32[\s\S]*TypeError: x is undefined/);
  assert.ok(t.endsWith(NO_PICTURE));
  assert.deepEqual(ops, ["screenshot", "read"]);
  // A sidekick's call asks about the sidekick's model, under its own thread.
  await tools.call("th_text#sidekick", "browser_read", {}).catch(() => {});
  assert.deepEqual(asked, [["th_sees", false], ["th_text", false], ["th_text", true]]);
});

test("pictures: every provider's endpoint path asks the same one fact, and a seeing model keeps its picture", () => {
  const s = { endpoints: [ep("anthropic", ["deepseek-chat", "claude-x"]), { ...ep("responses", ["gpt-oss-120b", "gpt-5.5"]), id: "api-r" }, { ...ep("chat", ["fake-model", "gpt-4o"]), id: "api-c" }] };
  assert.equal(picturesOf("claude.api-ex", "deepseek-chat", s), false);
  assert.equal(picturesOf("claude.api-ex", "claude-x", s), true);
  assert.equal(picturesOf("codex.api-r", "gpt-oss-120b", s), false);
  assert.equal(picturesOf("codex.api-r", "gpt-5.5", s), true);
  assert.equal(picturesOf("opencode.api-c", "fake-model", s), false);
  assert.equal(picturesOf("opencode.api-c", "gpt-4o", s), true);
});

// ---------- 2. Claude Code's Auto through another maker's API ----------

test("auto: the permission mode for each level, bare and through an endpoint", () => {
  const levels: Access[] = ["read", "ask", "edits", "auto", "review", "full"];
  const bare = Object.fromEntries(levels.map((a) => [a, modeOf(a)]));
  assert.deepEqual(bare, { read: "plan", ask: "default", edits: "acceptEdits", auto: "auto", review: "acceptEdits", full: "acceptEdits" });
  const endpoint = Object.fromEntries(levels.map((a) => [a, modeOf(a, true)]));
  assert.deepEqual(endpoint, { ...bare, auto: "acceptEdits" }, "only Auto changes: it runs as Edits on its own");
});

type Calls = { modes: unknown[] };
type Stand = { sent: SDKUserMessage[]; emit: (m: unknown) => void; end: () => void; calls: Calls; options: Record<string, unknown> };
function standIn() {
  const made: Stand[] = [];
  const saved = sdk.query;
  sdk.query = (({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Record<string, unknown> }) => {
    const out: unknown[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    const calls: Calls = { modes: [] };
    const s: Stand = { sent: [], emit: (m) => (out.push(m), wake?.()), end: () => ((ended = true), wake?.()), calls, options };
    made.push(s);
    void (async () => {
      for await (const m of prompt) s.sent.push(m);
    })();
    return {
      async *[Symbol.asyncIterator]() {
        while (!ended || out.length) {
          if (out.length) yield out.shift();
          else await new Promise<void>((r) => (wake = r));
        }
      },
      initializationResult: async () => ({}),
      interrupt: async () => {},
      setModel: async () => {},
      setPermissionMode: async (m: unknown) => void calls.modes.push(m),
      applyFlagSettings: async () => {},
      setMcpServers: async () => ({ added: [], removed: [], errors: {} }),
      return: async () => ((ended = true), wake?.(), { done: true, value: undefined }),
    };
  }) as unknown as typeof sdk.query;
  return { made, restore: () => (sdk.query = saved) };
}
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 300 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}
function recorder() {
  const notices: string[] = [];
  const sink: TurnSink = { text: () => {}, reasoning: () => {}, tool: () => {}, plan: () => {}, approve: async () => ({ allow: true }), ask: async () => null, propose: async () => ({ approve: true }), usage: () => {}, session: () => {}, notice: (t) => void notices.push(t), error: () => {}, limited: () => {} };
  return { notices, sink };
}
const opts = (extra: Partial<OpenOptions> = {}): OpenOptions => ({ cwd: "/tmp", model: "deepseek-chat", effort: "medium", access: "auto", soul: "", guard: true, env: { PATH: "" }, ...extra });
const done = (s: Stand) => s.emit({ type: "result", subtype: "success", is_error: false, result: "", num_turns: 1, duration_ms: 1, duration_api_ms: 1, stop_reason: null, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: {}, permission_denials: [], uuid: "r", session_id: "s" });

test("auto: Claude Code through an API endpoint opens at Auto as Edits on its own, changes to Auto the same, and so after a plan is approved", async () => {
  const { made, restore } = standIn();
  try {
    // The endpoint tool hands Claude Code noAuto; the thread keeps its level.
    const s = claude.open(opts({ noAuto: true }));
    const { sink } = recorder();
    const turn = s.turn("go", sink, new AbortController().signal);
    await until(() => made[0]?.sent.length === 1, "the message went");
    assert.equal(made[0].options.permissionMode, "acceptEdits");
    done(made[0]);
    await turn;
    assert.equal(await s.update!({ model: "deepseek-chat", effort: "medium", access: "read" }), true);
    assert.equal(await s.update!({ model: "deepseek-chat", effort: "medium", access: "auto" }), true);
    assert.deepEqual(made[0].calls.modes, ["plan", "acceptEdits"]);
    // A plan approved at Read only goes on at Auto: here, as Edits on its own.
    const t2 = s.turn("plan it", sink, new AbortController().signal);
    await until(() => made[0].sent.length === 2, "the second message went");
    await s.update!({ model: "deepseek-chat", effort: "medium", access: "read" });
    const ask = made[0].options.canUseTool as (n: string, i: Record<string, unknown>, o: Record<string, unknown>) => Promise<{ behavior: string }>;
    const r = await ask("ExitPlanMode", { plan: "1. Do it" }, { signal: new AbortController().signal, toolUseID: "t9" });
    assert.equal(r.behavior, "allow");
    await tick();
    assert.equal(made[0].calls.modes.at(-1), "acceptEdits");
    done(made[0]);
    await t2;
    s.close();
    // Bare Claude Code keeps real Auto, the plan's too.
    const b = claude.open(opts({ model: "claude-opus-5-5" }));
    const t3 = b.turn("go", sink, new AbortController().signal);
    await until(() => made[1]?.sent.length === 1, "bare message went");
    assert.equal(made[1].options.permissionMode, "auto");
    done(made[1]);
    await t3;
    b.close();
  } finally {
    restore();
  }
});

test("auto: when Claude Code says its Auto can't run here, the session goes on as Edits on its own and says so once", async () => {
  const { made, restore } = standIn();
  try {
    const s = claude.open(opts({ model: "claude-opus-5-5" }));
    const { sink, notices } = recorder();
    const turn = s.turn("go", sink, new AbortController().signal);
    await until(() => made[0]?.sent.length === 1, "the message went");
    assert.equal(made[0].options.permissionMode, "auto");
    made[0].emit({ type: "system", subtype: "informational", level: "warning", content: "Auto mode can't check actions in this session. Its safety check runs on the server, and your requests go through 127.0.0.1:48500, which doesn't pass it through.", uuid: "u", session_id: "s" });
    made[0].emit({ type: "assistant", parent_tool_use_id: null, uuid: "a1", session_id: "s", message: { id: "m1", role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "mcp__liner__design_files", input: {} }] } });
    made[0].emit({ type: "user", parent_tool_use_id: null, uuid: "u1", session_id: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", is_error: true, content: "Auto mode is unavailable: its safety check does not run for this session, so mcp__liner__design_files was not run." }] } });
    done(made[0]);
    await turn;
    assert.deepEqual(made[0].calls.modes, ["acceptEdits"], "switched once");
    assert.equal(notices.filter((n) => /Edits on its own/.test(n)).length, 1);
    assert.match(notices.find((n) => /Edits on its own/.test(n))!, /only runs with Anthropic's own models/);
    assert.equal(notices.some((n) => /^Auto mode can't check/.test(n)), false, "Claude Code's own notice gives way to ours");
    // A later change to Auto stays Edits on its own.
    await s.update!({ model: "claude-opus-5-5", effort: "medium", access: "edits" });
    await s.update!({ model: "claude-opus-5-5", effort: "medium", access: "auto" });
    assert.deepEqual(made[0].calls.modes, ["acceptEdits", "acceptEdits", "acceptEdits"]);
    s.close();
  } finally {
    restore();
  }
});

test("auto: an Anthropic-protocol endpoint says Auto runs as Edits there, and opens its sessions so; the other protocols don't", async () => {
  const opened: OpenOptions[] = [];
  const base: Provider = {
    id: "claude",
    detect: async () => ({ id: "claude", label: "Claude Code", available: true, adapter: true, login: "", models: [], supports: { approvals: true, resume: true, effort: true, plan: true } }) as ProviderInfo,
    open: (o) => (opened.push(o), { turn: async () => {}, close: () => {} }) as unknown as ProviderSession,
  };
  const a = endpointProvider(base, ep("anthropic", ["deepseek-chat"]), () => "k");
  assert.equal((await a.detect({})).supports.auto, false);
  a.open(opts());
  assert.equal(opened[0].noAuto, true);
  assert.equal(opened[0].access, "auto", "the level stays Auto");
  const c = endpointProvider({ ...base, id: "opencode" }, { ...ep("chat", ["m"]), id: "api-c" }, () => "k");
  assert.equal((await c.detect({})).supports.auto, undefined);
  c.open(opts());
  assert.equal(opened[1].noAuto, undefined);
});

// ---------- 3. Codex's tool search ----------

test("codex: Liner Code's server asks for its tools in the model's first list, on the app server and on exec", () => {
  const mcp = { command: "node", args: ["mcp.ts"], env: { LINER_SURFACE_KEY: "k" } };
  assert.deepEqual(codexMcp({ mcp })["mcp_servers.liner.omit_tools_from"], ["deferred"]);
  const a = execMcp({ mcp });
  const i = a.indexOf('mcp_servers.liner.omit_tools_from=["deferred"]');
  assert.ok(i > 0 && a[i - 1] === "-c");
  // A connection keeps Codex's own choice.
  const withConn = codexMcp({ mcp }, [{ name: "notes", stdio: { command: "x", args: [], env: {} } } as never]);
  assert.equal(Object.keys(withConn).some((k) => k.startsWith("mcp_servers.notes.omit")), false);
  // An old Codex that still defers: the note says how to find them.
  assert.match(toolsNote(linerName("codex"), "codex"), /find them with tool_search/);
  assert.doesNotMatch(toolsNote(linerName("claude"), "claude"), /tool_search/);
});

// ---------- Hermes, round 2 ----------

test("hermes: a call it titles \"<name>: <what it's about>\" is still Liner Code's tool, and only ours", () => {
  // The exact titles Hermes 0.23.1 sent for design_frame and design_picture.
  const input = { name: "Phone / Fake" };
  assert.deepEqual(linerCall("mcp__editor_liner_8a27b704__design_frame: Phone / Fake", input), { name: "design_frame", input });
  assert.deepEqual(linerCall("mcp__editor_liner_8a27b704__design_picture: A calm harbour at low tide", input), { name: "design_picture", input });
  assert.deepEqual(linerCall("mcp__editor_liner_8a27b704__design_files", input), { name: "design_files", input });
  assert.deepEqual(linerCall("liner_design_frame: Phone / Fake", input), { name: "design_frame", input });
  // Another server whose name merely holds "liner": never ours.
  for (const t of ["mcp__editor_linerx_8a27b704__design_frame: Phone", "mcp__airliner__design_frame: Phone", "mcp__editor_liner_8a27b704_x__design_frame", "mcp__myliner__design_frame", "linerish_design_frame: x"]) assert.equal(linerCall(t, input), undefined, t);
  // A name of ours with no space after its colon isn't a summary.
  assert.equal(linerCall("mcp__editor_liner_8a27b704__design_frame:Phone", input), undefined);
  assert.equal(linerCall("mcp__editor_liner_8a27b704__not_ours: Phone", input), undefined, "by the list");
});

test("pictures: a tool's own model takes pictures unless you say otherwise (toolPictures), and old settings have none", () => {
  assert.equal(toolPicturesKey("hermes", "default"), "hermes:default");
  assert.equal(toolPicturesKey("hermes", undefined), "hermes:default");
  assert.equal(picturesOf("hermes", "default", {}), true);
  assert.equal(picturesOf("hermes", "default", JSON.parse('{"endpoints":[]}')), true, "settings saved before it");
  const s = { toolPictures: { "hermes:default": false, "acp.goose:default": false, "claude:claude-opus-5-5": true } };
  assert.equal(picturesOf("hermes", "default", s), false);
  assert.equal(picturesOf("hermes", undefined, s), false);
  assert.equal(picturesOf("acp.goose", "default", s), false);
  assert.equal(picturesOf("acp.amp", "default", s), true);
  assert.equal(picturesOf("claude", "claude-opus-5-5", s), true);
  // An endpoint's own switch stays the endpoint's: toolPictures doesn't reach it.
  const e = { endpoints: [ep("chat", ["fake-model"])], toolPictures: { "opencode.api-ex:fake-model": true } };
  assert.equal(picturesOf("opencode.api-ex", "fake-model", e), false);
});

test("pictures: a Hermes model marked as taking none gets the words and the sentence, one left alone its picture", async () => {
  const settings = { toolPictures: { "hermes:default": false } };
  const model: Record<string, ProviderId> = { th_h: "hermes", th_c: "claude" };
  const { tools } = toolsWith((t) => picturesOf(model[t] ?? "claude", "default", settings));
  const marked = await tools.call("th_h", "browser_screenshot", {});
  assert.ok((marked.content[0] as { text: string }).text.endsWith(NO_PICTURE));
  const left = await tools.call("th_c", "browser_screenshot", {});
  assert.equal(left.content[0].type, "image");
});
