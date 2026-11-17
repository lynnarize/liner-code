/*
  Refusals and overloaded providers, and a session's ETA. Each tool's failures are told apart
  (Claude Code by its result and notices, Codex by its error codes, its words only where no code came); neither marks
  the tool as out of usage; an overload offers another family's model, a refusal never offers one and carryOn refuses
  to act on it; a turn's expected length comes from the session's last finished turns, else 30 days of yours, else nothing.
  Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKResultMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { claude as claudeTool, sdk, whyOf } from "../src/providers/claude.ts";
import { codexWhy, isLimit } from "../src/providers/codex-server.ts";
import type { OpenOptions, Provider, ProviderSession, TurnSink } from "../src/providers/types.ts";
import { etaOf, providers, Runtime } from "../src/runtime.ts";
import { Store } from "../src/store.ts";
import { etaWords } from "../../ui/src/app/eta.ts";

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const claude = info("claude", ["claude-opus-5-5"]);
const codex = info("codex", ["gpt-6"]);
const opencode = info("opencode", ["opencode/big-pickle"]);

/** A Claude Code result as its SDK writes one, with the fields a test sets. */
const result = (o: Record<string, unknown>) => ({ type: "result", subtype: "success", duration_ms: 1, duration_api_ms: 1, is_error: false, num_turns: 1, result: "", stop_reason: null, total_cost_usd: 0, usage: {}, modelUsage: {}, permission_denials: [], uuid: "u", session_id: "s", ...o }) as unknown as SDKResultMessage;
// Claude Code's own words for a refusal under the usage policy, as it ends the turn with them.
const REFUSED = "API Error: Claude Code is unable to respond to this request, which appears to violate our Usage Policy (https://www.anthropic.com/legal/aup). Please double press esc to edit your last message or start a new session for Claude Code to assist with a different task.";

test("Claude Code: a refusal, an overload and an ordinary error, from its fields", () => {
  assert.equal(whyOf(result({ is_error: true, stop_reason: "refusal", result: REFUSED })), "refusal", "the result's stop_reason");
  assert.equal(whyOf(result({ stop_reason: "refusal", result: REFUSED })), "refusal", "a refusal that ends as a plain success is still one");
  assert.equal(whyOf(result({ is_error: true, result: REFUSED }), { refused: "Claude declined." }), "refusal", "model_refusal_no_fallback before the result");
  assert.equal(whyOf(result({ is_error: true, api_error_status: 529, terminal_reason: "api_error", result: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' })), "overloaded");
  assert.equal(whyOf(result({ is_error: true, result: "API Error: Repeated 529 Overloaded errors" }), { overloaded: true }), "overloaded", "an assistant error 'overloaded'");
  assert.equal(whyOf(result({ is_error: true, api_error_status: 503, terminal_reason: "api_error", result: "API Error: 503 upstream connect error" })), "overloaded", "a 503: down");
  // A gateway's 503 around a rate limit is a limit, not an overload.
  const gateway = 'API Error: 503 [gw] [429]: {"type":"error","error":{"type":"rate_limit_error","message":"slow down"}} (reset after 2m)';
  assert.equal(whyOf(result({ is_error: true, api_error_status: 503, terminal_reason: "api_error", result: gateway })), undefined);
  assert.equal(whyOf(result({ is_error: true, api_error_status: 500, terminal_reason: "api_error", result: "API Error: 500 Internal server error" })), undefined, "an ordinary error");
  assert.equal(whyOf(result({ subtype: "error_during_execution", is_error: true, errors: ["Tool failed"] })), undefined, "an ordinary error");
  assert.equal(whyOf(result({ result: "All done." })), undefined, "a turn that went well");
  assert.equal(whyOf(result({ stop_reason: "refusal", terminal_reason: "aborted_streaming" })), undefined, "stopped by you");
  assert.equal(whyOf(result({ is_error: true, api_error_status: 529 }), {}), "overloaded");
  // An overload said mid-turn that a retry got past is no failure.
  assert.equal(whyOf(result({ result: "Done after all." }), { overloaded: true }), undefined);
});

test("Codex: a refusal and an overload by code, words only where no code came, the rest ordinary", () => {
  assert.equal(codexWhy({ codexErrorInfo: "cyberPolicy", message: "cyber policy: This request has been flagged for possible cybersecurity risk." }), "refusal");
  assert.equal(codexWhy({ codexErrorInfo: "misalignmentPolicyViolation", message: "This request was blocked due to a misalignment policy violation." }), "refusal");
  assert.equal(codexWhy({ codexErrorInfo: "serverOverloaded", message: "Server overloaded; retry later." }), "overloaded");
  assert.equal(codexWhy({ codexErrorInfo: "flexUnavailable", message: "Flex capacity unavailable." }), "overloaded");
  assert.equal(codexWhy({ codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 529 } }, message: "exceeded retry limit, last status: 529" }), "overloaded");
  assert.equal(codexWhy({ codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 500 } }, message: "stream disconnected" }), undefined);
  assert.equal(codexWhy({ codexErrorInfo: "internalServerError", message: "Internal server error" }), undefined);
  assert.equal(codexWhy({ codexErrorInfo: "contextWindowExceeded", message: "This request has been flagged for possible cybersecurity risk." }), undefined, "a code says what it is; its words don't override it");
  // `codex exec` gives words only.
  assert.equal(codexWhy({ message: "This request has been flagged for possible cybersecurity risk." }), "refusal");
  assert.equal(codexWhy({ message: "This content was flagged for possible biological risk." }), "refusal");
  assert.equal(codexWhy({ message: "Something mentioned a cybersecurity risk in passing" }), undefined, "matched narrowly");
  assert.equal(codexWhy({ message: "stream error: unexpected status 400" }), undefined);
  // A usage limit stays a limit (isLimit), not one of these.
  assert.equal(codexWhy({ codexErrorInfo: "usageLimitExceeded", message: "You've hit your usage limit." }), undefined);
  assert.equal(isLimit({ codexErrorInfo: "usageLimitExceeded" }), true);
});

/** A tool whose every turn runs `work`. */
function fake(work: (sink: TurnSink) => void | Promise<void>, id: "claude" | "codex" = "claude") {
  const p: Provider = { id, detect: async () => info(id, []), open: () => ({ close: () => {}, turn: async (_text: string, sink: TurnSink) => void (await work(sink)) }) as unknown as ProviderSession };
  const saved = providers[id];
  providers[id] = p;
  return () => void (providers[id] = saved);
}
function session(ready: ProviderInfo[], extra: Partial<Thread> = {}) {
  const store = new Store(mkdtempSync(join(tmpdir(), "lc-why-")));
  store.putProject({ id: "p", name: "p", path: mkdtempSync(join(tmpdir(), "lc-why-dir-")), git: false, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "Work", agent: "@claude:claude-opus-5-5", status: "idle", access: "ask", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = ready;
  return { store, runtime };
}

test("a refusal offers no other tool, on any tool, and leaves its own tool usable; carryOn after it is refused", async () => {
  for (const id of ["claude", "codex"] as const) {
    const restore = fake((sink) => sink.error(REFUSED, { why: "refusal" }), id);
    try {
      const { store, runtime } = session([claude, codex, opencode], { agent: id === "claude" ? "@claude:claude-opus-5-5" : "@codex:gpt-6" });
      await runtime.send("t", "write it");
      const err = store.timeline("t").find((x) => x.kind === "error");
      assert.ok(err?.kind === "error");
      assert.equal(err.why, "refusal");
      assert.equal(err.provider, id);
      assert.equal(err.fallback, undefined, `${id}: a refused request isn't offered to another provider`);
      assert.equal(store.thread("t").status, "error", "an error, not limited");
      assert.equal(store.timeline("t").some((x) => x.kind === "limit"), false);
      // Not out of usage: another session could still fall back to it.
      assert.ok(runtime.fallbackFor("opencode", "opencode/big-pickle"));
      const model = store.thread("t").model;
      const sent: string[] = [];
      runtime.send = (async (_id: string, text: string) => void sent.push(text)) as typeof runtime.send;
      await assert.rejects(runtime.carryOn("t", id === "claude" ? "codex:gpt-6" : "claude:claude-opus-5-5"), /refused/, "whatever model it's given");
      await assert.rejects(runtime.carryOn("t"), /refused/);
      assert.equal(sent.length, 0, "nothing went");
      assert.equal(store.thread("t").model, model, "the model is untouched");
    } finally {
      restore();
    }
  }
});

test("an overload offers another family too; an ordinary error offers nothing", async () => {
  const restore = fake((sink) => sink.error("Claude's API is overloaded (529). Try again shortly.", { why: "overloaded" }));
  try {
    const { store, runtime } = session([claude, info("claude.work", ["claude-opus-5-5"]), codex]);
    await runtime.send("t", "go");
    const err = store.timeline("t").find((x) => x.kind === "error");
    assert.ok(err?.kind === "error" && err.why === "overloaded");
    assert.equal(err.fallback, "codex:gpt-6", "another account of Claude asks the same overloaded API");
    // Try again and Carry on both still go, and the notice says it was overloaded.
    const sent: string[] = [];
    runtime.send = (async (_id: string, text: string) => void sent.push(text)) as typeof runtime.send;
    await runtime.tryAgain("t");
    await runtime.carryOn("t", err.fallback);
    assert.equal(sent.length, 2);
    assert.equal(store.thread("t").model, "codex:gpt-6");
    const said = store.timeline("t").findLast((x) => x.kind === "notice");
    assert.ok(said?.kind === "notice" && /is overloaded right now, so .* carries on/.test(said.text), said?.kind === "notice" ? said.text : "no notice");
  } finally {
    restore();
  }
  const plain = fake((sink) => sink.error("Tool failed"));
  try {
    const { store, runtime } = session([claude, codex]);
    await runtime.send("t", "go");
    const err = store.timeline("t").find((x) => x.kind === "error");
    assert.ok(err?.kind === "error" && err.why === undefined && err.fallback === undefined);
  } finally {
    plain();
  }
});

test("ETA: the session's own last turns, else 30 days of yours, else nothing", () => {
  const min = 60_000;
  assert.equal(etaOf([2 * min, 4 * min], []), undefined, "too few turns, and nothing else to go by");
  assert.equal(etaOf([2 * min, 4 * min], [1 * min, 3 * min, 5 * min]), 3 * min, "too few of its own: yours over 30 days");
  assert.equal(etaOf([1 * min, 9 * min, 2 * min], [30 * min, 30 * min, 30 * min]), 2 * min, "enough of its own: their median");
  assert.equal(etaOf([60 * min, 60 * min, 1 * min, 2 * min, 3 * min, 4 * min, 5 * min], []), 3 * min, "only the last five");
  assert.equal(etaOf([1 * min, 2 * min, 3 * min, 4 * min], []), 2.5 * min, "an even count's median");
});

test("ETA words: whole minutes, then under a minute, then longer than usual with no number", () => {
  const from = 1_000_000;
  const at = (s: number) => from + s * 1000;
  const eta = { from, ms: 5 * 60_000 };
  assert.equal(etaWords(eta, at(0)), "about 5 min left");
  assert.equal(etaWords(eta, at(150)), "about 3 min left", "2.5 minutes left rounds to whole minutes");
  assert.equal(etaWords(eta, at(205)), "about 2 min left", "95 seconds left: still minutes");
  assert.equal(etaWords(eta, at(220)), "about a minute left");
  assert.equal(etaWords(eta, at(260)), "under a minute left");
  assert.equal(etaWords(eta, at(300)), "longer than usual", "past the estimate");
  assert.equal(etaWords(eta, at(3600)), "longer than usual");
  assert.equal(etaWords(undefined, at(0)), undefined, "no estimate, no words");
  for (let s = 0; s < 300; s += 7) assert.ok(!/\d+\s*s\b|second/.test(etaWords(eta, at(s)) ?? ""), "never a seconds countdown");
});

test("ETA on the thread: set as a turn starts from its finished turns on the same model, gone when it ends; side chats and fix rounds don't count", async () => {
  const seen: { eta?: Thread["eta"] } = {};
  const restore = fake(() => void (seen.eta = store.thread("t").eta));
  const { store, runtime } = session([claude, codex]);
  try {
    // Two finished turns: too few, and nothing in 30 days: no estimate.
    for (const [i, s] of [60, 120].entries()) store.putItem("t", { kind: "turn", id: `m${i}`, turn: i + 1, at: 1, agent: "@claude:claude-opus-5-5", model: "claude:claude-opus-5-5", status: "done", seconds: s });
    store.patchThread("t", { turns: 2 });
    await runtime.send("t", "go");
    assert.equal(seen.eta, undefined);
    // Three on this model (and a fix round and another model's, which don't count): their median.
    store.putItem("t", { kind: "turn", id: "fix", turn: 3, at: 1, agent: "@claude:claude-opus-5-5", model: "claude:claude-opus-5-5", status: "done", seconds: 9999, part: "fix" });
    store.putItem("t", { kind: "turn", id: "other", turn: 3, at: 1, agent: "@claude:claude-opus-5-5", model: "codex:gpt-6", status: "done", seconds: 9999 });
    await runtime.send("t", "again");
    // The turn that just ran was quick (a few ms): 60, 120 and ~0 seconds.
    const eta = (seen as { eta?: Thread["eta"] }).eta;
    assert.equal(eta?.ms, 60_000, `eta ${JSON.stringify(eta)}`);
    assert.equal(store.thread("t").eta, undefined, "gone once the turn ended");
    // Its finished turns count over 30 days too; a side chat's and a routine's don't.
    const rows = store.usage(0);
    assert.ok(rows.length >= 2 && rows.every((r) => r.worked !== undefined));
    const side = session([claude, codex], { sideOf: "x", sideFrom: 0 });
    await side.runtime.send("t", "a side question");
    assert.equal(side.store.usage(0)[0]?.worked, undefined);
  } finally {
    restore();
  }
});

/** Claude Code's driver against a stand-in for the SDK's query (as drivers.test.ts does): what the turn's sink is told. */
async function claudeTurn(say: (uuid: string) => unknown[]) {
  let emit: (m: unknown) => void = () => {};
  const sent: SDKUserMessage[] = [];
  const saved = sdk.query;
  sdk.query = (({ prompt }: { prompt: AsyncIterable<SDKUserMessage> }) => {
    const out: unknown[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    emit = (m) => (out.push(m), wake?.());
    void (async () => {
      for await (const m of prompt) sent.push(m);
    })();
    return {
      async *[Symbol.asyncIterator]() {
        while (!ended) {
          if (out.length) yield out.shift();
          else await new Promise<void>((r) => (wake = r));
        }
      },
      initializationResult: async () => ({}),
      interrupt: async () => {},
      setModel: async () => {},
      setPermissionMode: async () => {},
      return: async () => ((ended = true), wake?.(), { done: true, value: undefined }),
    };
  }) as unknown as typeof sdk.query;
  const told = { errors: [] as { message: string; why?: string }[], limits: [] as string[], notices: [] as string[], text: "" };
  const sink = { text: (d: string) => void (told.text += d), reasoning: () => {}, tool: () => {}, plan: () => {}, approve: async () => ({ allow: true }), ask: async () => null, propose: async () => ({ approve: true }), usage: () => {}, session: () => {}, notice: (t: string) => void told.notices.push(t), error: (message: string, o?: { why?: string }) => void told.errors.push({ message, why: o?.why }), limited: (m: string) => void told.limits.push(m), heard: () => {} } as unknown as TurnSink;
  const opts: OpenOptions = { cwd: "/tmp", model: "claude-opus-5-5", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: "" } } as OpenOptions;
  try {
    const s = claudeTool.open(opts);
    const turn = s.turn("hello", sink, new AbortController().signal);
    for (let i = 0; i < 300 && !sent.length; i++) await new Promise((r) => setTimeout(r, 10));
    for (const m of say(sent[0].uuid!)) emit(m);
    await turn;
    s.close();
  } finally {
    sdk.query = saved;
  }
  return told;
}
const res = (uuid: string, o: Record<string, unknown>) => ({ type: "result", subtype: "success", is_error: false, result: "", num_turns: 1, duration_ms: 1, duration_api_ms: 1, stop_reason: null, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: {}, permission_denials: [], uuid: "r", session_id: "s", user_message_uuids: [uuid], ...o });

test("Claude Code's driver: a refusal and an overload end the turn as errors that say why; a limit stays a limit", async () => {
  const refused = await claudeTurn((u) => [
    { type: "system", subtype: "model_refusal_no_fallback", original_model: "claude-opus-5-5", request_id: null, content: "Claude declined this request under Anthropic's usage policy.", uuid: "n", session_id: "s" },
    res(u, { is_error: true, stop_reason: "refusal", result: REFUSED }),
  ]);
  assert.deepEqual(refused.errors, [{ message: "Claude declined this request under Anthropic's usage policy.", why: "refusal" }]);
  assert.equal(refused.notices.length, 0, "said once, as the error");
  const quiet = await claudeTurn((u) => [res(u, { stop_reason: "refusal", result: REFUSED })]);
  assert.deepEqual(quiet.errors, [{ message: REFUSED, why: "refusal" }], "a refusal reported as a success");
  assert.equal(quiet.text, "", "not as an answer");
  const busy = await claudeTurn((u) => [res(u, { is_error: true, api_error_status: 529, terminal_reason: "api_error", result: "API Error: 529 Overloaded" })]);
  assert.deepEqual(busy.errors, [{ message: "Claude's API is overloaded (529). Try again shortly.", why: "overloaded" }]);
  const plain = await claudeTurn((u) => [res(u, { is_error: true, api_error_status: 500, terminal_reason: "api_error", result: "API Error: 500 Internal server error" })]);
  assert.equal(plain.errors.length, 1);
  assert.equal(plain.errors[0].why, undefined);
  const limit = await claudeTurn((u) => [res(u, { is_error: true, result: "You've hit your limit · resets 5pm" })]);
  assert.equal(limit.limits.length, 1);
  assert.equal(limit.errors.length, 0);
});

test("Try again after an overload sends the engine's own continue to the same model", async () => {
  const restore = fake(() => {});
  try {
    const { store, runtime } = session([claude, codex]);
    const sent: string[] = [];
    runtime.send = (async (_id: string, text: string) => void sent.push(text)) as typeof runtime.send;
    await runtime.tryAgain("t");
    await runtime.carryOn("t", "codex:gpt-6");
    assert.equal(sent.length, 2);
    assert.equal(sent[0], sent[1], "the same words a carry-on continues with");
    assert.equal(store.thread("t").model, "codex:gpt-6");
  } finally {
    restore();
  }
});

test("Claude Code's driver: a refusal after streamed words doesn't repeat them; an overload the turn went on past isn't how it ended", async () => {
  const streamed = (uuid: string, t: string) => [
    { type: "stream_event", parent_tool_use_id: null, uuid, session_id: "s", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
    { type: "stream_event", parent_tool_use_id: null, uuid, session_id: "s", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } } },
  ];
  const refused = await claudeTurn((u) => [...streamed("a1", "Here is the start of it"), res(u, { stop_reason: "refusal", result: "Here is the start of it" })]);
  assert.equal(refused.text, "Here is the start of it", "the streamed words stay, once");
  assert.deepEqual(refused.errors, [{ message: "Claude declined this request.", why: "refusal" }]);
  const msg = (id: string, o: Record<string, unknown> = {}) => ({ type: "assistant", parent_tool_use_id: null, uuid: id, session_id: "s", message: { id, model: "claude-opus-5-5", role: "assistant", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }, ...o });
  const synthetic = (id: string) => ({ ...msg(id, { error: "overloaded" }), message: { id, model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "API Error: Repeated 529 Overloaded errors" }] } });
  const recovered = await claudeTurn((u) => [synthetic("e1"), msg("m2"), res(u, { subtype: "error_max_turns", is_error: true, errors: ["Reached maximum number of turns (5)"] })]);
  assert.equal(recovered.errors.length, 1);
  assert.equal(recovered.errors[0].why, undefined, "max turns after a recovery is an ordinary error");
  const ended = await claudeTurn((u) => [msg("m1"), synthetic("e2"), res(u, { is_error: true, result: "API Error: Repeated 529 Overloaded errors" })]);
  assert.equal(ended.errors[0]?.why, "overloaded", "the overload it ended on still counts");
});
