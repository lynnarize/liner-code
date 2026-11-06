/*
  Agent tools that stop, die or never answer: a turn fails or ends rather than hangs, Stop keeps a
  lost session to say next turn, and Read only reaches the agent's own mode. The agents are small
  Node scripts speaking ACP or Codex's app server. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acpProvider } from "../src/providers/acp.ts";
import { CodexServerSession, codexAsk } from "../src/providers/codex-server.ts";
import { ResumeFailed, type ApprovalRequest, type OpenOptions, type TurnSink } from "../src/providers/types.ts";
import type { Access, Question } from "../../contracts/src/index.ts";
import { demo } from "../src/providers/demo.ts";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 300 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}
const opts = (extra: Partial<OpenOptions> = {}) => ({ cwd: "/tmp", model: "default", effort: "medium", access: "edits", soul: "", guard: true, env: { PATH: "" }, ...extra }) as OpenOptions;
function recorder() {
  const r = { text: "", errors: [] as string[], sessions: [] as string[] };
  const sink = {
    text: (d: string) => void (r.text += d), reasoning: () => {}, tool: () => {}, plan: () => {},
    approve: async () => ({ allow: true }), ask: async () => null, propose: async () => ({ approve: true }),
    usage: () => {}, session: (id: string) => void r.sessions.push(id), notice: () => {}, error: (m: string) => void r.errors.push(m), limited: () => {},
  } as unknown as TurnSink;
  return { r, sink };
}
function script(name: string, on: string) {
  const dir = mkdtempSync(join(tmpdir(), "lc-verify-"));
  const file = join(dir, name);
  writeFileSync(file, `#!/usr/bin/env node
const fs = require("fs");
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const mode = process.env.FAKE_MODE || "";
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    fs.appendFileSync(process.env.FAKE_LOG, line + "\\n");
    ${on}
  }
});
`, { mode: 0o755 });
  const log = join(dir, "log.jsonl");
  writeFileSync(log, "");
  const read = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { file, log, read };
}

const ACP = `
switch (m.method) {
  case "initialize":
    if (mode === "mute") break;
    send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } }); break;
  case "session/load":
    if (mode === "crash") process.exit(3);
    if (mode === "slowlost") { setTimeout(() => send({ id: m.id, error: { code: -1, message: "session not found" } }), 300); break; }
    send({ id: m.id, error: { code: -1, message: "session not found" } }); break;
  case "session/new": send({ id: m.id, result: { sessionId: "s-new", modes: { currentModeId: "build", availableModes: [{ id: "build" }, { id: "plan" }] } } }); break;
  case "session/prompt": send({ id: m.id, result: { stopReason: "end_turn" } }); break;
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`;

test("acp: an agent that dies loading its session fails the turn, it doesn't hang", async () => {
  const fake = script("agent", ACP);
  const p = acpProvider("acp.fake", { label: "Fake", cmd: [fake.file], login: "" });
  const s = p.open(opts({ resume: "s-old", env: { ...process.env, FAKE_LOG: fake.log, FAKE_MODE: "crash" } }));
  const r = await Promise.race([s.turn("hi", recorder().sink, new AbortController().signal).then(() => "ok", (e: Error) => `rejected: ${e.message}`), tick(3000).then(() => "hung")]);
  s.close();
  assert.match(String(r), /^rejected/);
});

test("acp: Stop ends a turn whose agent never answers as it starts", async () => {
  const fake = script("agent", ACP);
  const p = acpProvider("acp.fake", { label: "Fake", cmd: [fake.file], login: "" });
  const s = p.open(opts({ env: { ...process.env, FAKE_LOG: fake.log, FAKE_MODE: "mute" } }));
  const stop = new AbortController();
  const turn = s.turn("hi", recorder().sink, stop.signal);
  await until(() => fake.read().some((m) => m.method === "initialize"), "it was asked to start");
  stop.abort();
  const r = await Promise.race([turn.then(() => "ok"), tick(2000).then(() => "hung")]);
  s.close();
  assert.equal(r, "ok");
});

test("acp: Stop while starting keeps a lost session to say next turn", async () => {
  const fake = script("agent", ACP);
  const p = acpProvider("acp.fake", { label: "Fake", cmd: [fake.file], login: "" });
  const s = p.open(opts({ resume: "s-old", env: { ...process.env, FAKE_LOG: fake.log, FAKE_MODE: "slowlost" } }));
  const stop = new AbortController();
  const turn = s.turn("hi", recorder().sink, stop.signal);
  await until(() => fake.read().some((m) => m.method === "session/load"), "it loads");
  stop.abort();
  await turn;
  await assert.rejects(s.turn("again", recorder().sink, new AbortController().signal), (e) => e instanceof ResumeFailed);
  await s.turn("again", recorder().sink, new AbortController().signal);
  s.close();
});

test("acp: Read only and back switches the agent's own mode", async () => {
  const fake = script("agent", ACP);
  const p = acpProvider("acp.fake", { label: "Fake", cmd: [fake.file], login: "" });
  const s = p.open(opts({ access: "read", env: { ...process.env, FAKE_LOG: fake.log } }));
  await s.turn("hi", recorder().sink, new AbortController().signal);
  assert.ok(await s.update!({ model: "default", effort: "medium", access: "edits" }));
  assert.ok(await s.update!({ model: "default", effort: "medium", access: "full" }));
  assert.ok(await s.update!({ model: "default", effort: "medium", access: "read" }));
  await tick(200);
  s.close();
  const modes = fake.read().filter((m) => m.method === "session/set_mode").map((m) => m.params.modeId);
  assert.deepEqual(modes, ["plan", "build", "plan"]);
});

const CODEX = `
switch (m.method) {
  case "initialize": if (mode !== "mute") send({ id: m.id, result: {} }); break;
  case "thread/resume": setTimeout(() => send({ id: m.id, error: { code: -1, message: "no rollout found for thread" } }), 300); break;
  case "thread/start": send({ id: m.id, result: { thread: { id: "new-thread" } } }); break;
  case "turn/start": send({ id: m.id, result: { turn: { id: "turn-1" } } }); setTimeout(() => send({ method: "turn/completed", params: { turn: { id: "turn-1", status: "completed" } } }), 10); break;
  default: if (m.id !== undefined) send({ id: m.id, result: {} });
}`;

test("codex: Stop while starting keeps a lost thread to say next turn", async () => {
  const fake = script("codex", CODEX);
  const s = new CodexServerSession(opts({ resume: "t-1", env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log } }));
  const stop = new AbortController();
  const turn = s.turn("hi", recorder().sink, stop.signal);
  await until(() => fake.read().some((m) => m.method === "thread/resume"), "it resumes");
  stop.abort();
  await turn;
  await assert.rejects(s.turn("again", recorder().sink, new AbortController().signal), (e) => e instanceof ResumeFailed);
  await s.turn("again", recorder().sink, new AbortController().signal);
  s.close();
});

test("codex: an ask of an app server that never starts times out", async () => {
  const fake = script("codex", CODEX);
  const at = Date.now();
  await assert.rejects(codexAsk({ ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log, FAKE_MODE: "mute" }, "/tmp", "account/rateLimits/read", {}, 300), /in time/);
  assert.ok(Date.now() - at < 2000);
});

test("demo: Stop on the planner's question ends the turn then", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-demo-"));
  const s = demo.open(opts({ cwd: dir, planning: true }));
  const stop = new AbortController();
  const { r, sink } = recorder();
  sink.ask = (_q, sig) => new Promise((_, no) => { if (sig.aborted) no(new Error("stopped")); sig.addEventListener("abort", () => no(new Error("stopped"))); });
  const turn = s.turn("fix the tide time", sink, stop.signal);
  await tick(2500);
  stop.abort();
  const at = Date.now();
  await turn.catch(() => {});
  assert.ok(Date.now() - at < 500, `ended ${Date.now() - at}ms after Stop`);
  assert.ok(!r.text.includes("<plan"), "no plan written after Stop");
});

test("codex: an app server that dies as it opens fails the turn once, not twice", async () => {
  const fake = script("codex", `if (m.method === "initialize") { process.stderr.write("bad config\\n"); process.exit(1); }`);
  const s = new CodexServerSession(opts({ env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log } }));
  const { r, sink } = recorder();
  await assert.rejects(s.turn("hi", sink, new AbortController().signal), /bad config/);
  s.close();
  assert.deepEqual(r.errors, [], "the turn's own failure says it; the sink isn't told again");
});

/** An agent that sends the client its requests one by one as its prompt starts, and ends the turn on the last reply. */
const ACP_ASKS = `
switch (m.method) {
  case "initialize": send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } }); break;
  case "session/new": send({ id: m.id, result: { sessionId: "s-new" } }); break;
  case "session/prompt":
    global.prompt = m.id;
    global.asks = [].concat(JSON.parse(process.env.FAKE_ASK));
    global.next = 0;
    send({ jsonrpc: "2.0", id: 900, ...global.asks[0] });
    break;
  default:
    if (m.id >= 900) {
      global.next++;
      if (global.next < global.asks.length) send({ jsonrpc: "2.0", id: 900 + global.next, ...global.asks[global.next] });
      else send({ id: global.prompt, result: { stopReason: "end_turn" } });
    } else if (m.id !== undefined) send({ id: m.id, result: {} });
}`;

type Reply = { id: number; result?: { content?: unknown; action?: string; outcome?: { optionId?: string } }; error?: { message: string } };
type Ask = { method: string; params: Record<string, unknown> };
async function acpAsks(asks: Ask[], extra: Partial<OpenOptions>, approve?: TurnSink["approve"], ask?: TurnSink["ask"]) {
  const fake = script("agent", ACP_ASKS);
  const p = acpProvider("acp.fake", { label: "Fake", cmd: [fake.file], login: "" });
  const s = p.open(opts({ ...extra, env: { ...process.env, FAKE_LOG: fake.log, FAKE_ASK: JSON.stringify(asks) } }));
  const { sink } = recorder();
  if (approve) sink.approve = approve;
  if (ask) sink.ask = ask;
  await s.turn("go", sink, new AbortController().signal);
  s.close();
  return fake.read().filter((m) => m.id >= 900 && !m.method) as Reply[];
}
const acpAsk = async (ask: Ask, extra: Partial<OpenOptions>, approve?: TurnSink["approve"], answer?: TurnSink["ask"]) => (await acpAsks([ask], extra, approve, answer))[0];

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lc-acp-root-")));
  const away = realpathSync(mkdtempSync(join(tmpdir(), "lc-acp-away-")));
  writeFileSync(join(away, "secret.txt"), "secret");
  symlinkSync(away, join(root, "link"));
  symlinkSync(join(away, "not-yet.txt"), join(root, "dangling.txt"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "a.ts"), "a");
  writeFileSync(join(root, "..notes"), "kept");
  return { root, away };
}

test("acp: a link that leaves the project is outside it, for reading and for writing", async () => {
  const { root, away } = project();
  const read = (path: string) => acpAsk({ method: "fs/read_text_file", params: { path } }, { cwd: root });
  const write = (path: string) => acpAsk({ method: "fs/write_text_file", params: { path, content: "x" } }, { cwd: root });

  assert.match((await read(join(root, "link", "secret.txt"))).error?.message ?? "", /outside the project/);
  assert.match((await write(join(root, "link", "new.txt"))).error?.message ?? "", /outside the project/);
  assert.match((await write(join(root, "dangling.txt"))).error?.message ?? "", /outside the project/, "a link to nothing yet");
  assert.match((await write(join(root, "link", "new", "deep.txt"))).error?.message ?? "", /outside the project/, "through folders that don't exist yet");
  assert.throws(() => readFileSync(join(away, "not-yet.txt")));
  assert.throws(() => readFileSync(join(away, "new.txt")));

  assert.equal((await read(join(root, "src", "a.ts"))).result?.content, "a");
  assert.equal((await read("..notes")).result?.content, "kept", "a name that starts with two dots is still inside");
  assert.equal((await write("fresh/new.txt")).error, undefined, "a new file in a new folder");
  assert.equal(readFileSync(join(root, "fresh", "new.txt"), "utf8"), "x");
});

/** A form as OpenCode's question tool sends it: a choice, each with a field for an answer of your own. */
const QUESTIONS = {
  method: "elicitation/create",
  params: {
    mode: "form",
    sessionId: "s-new",
    toolCallId: "c1",
    message: "Questions",
    requestedSchema: {
      type: "object",
      required: [],
      properties: {
        q0: { type: "string", title: "Scroll", description: "Which fix first?", oneOf: [{ const: "Lenis", title: "Lenis", description: "Install it (Recommended)" }, { const: "Measure", title: "Measure" }] },
        q0_custom: { type: "string", title: "Scroll (other)", description: "Type your own answer" },
        q1: { type: "array", title: "Areas", description: "Where?", items: { anyOf: [{ const: "Hero", title: "Hero" }, { const: "Footer", title: "Footer" }] } },
        q1_custom: { type: "string", title: "Areas (other)", description: "Add your own answer" },
      },
    },
  },
};

test("acp: an agent's form is the question card, and your answers fill it in", async () => {
  const fake = script("agent", ACP_ASKS);
  const s = acpProvider("acp.fake", { label: "Fake", cmd: [fake.file], login: "" }).open(opts({ env: { ...process.env, FAKE_LOG: fake.log, FAKE_ASK: JSON.stringify(QUESTIONS) } }));
  const { sink } = recorder();
  await s.turn("go", sink, new AbortController().signal);
  s.close();
  assert.deepEqual(fake.read().find((m) => m.method === "initialize").params.clientCapabilities.elicitation, { form: {} }, "it says it can show forms, or OpenCode drops the question");

  let asked: Question[] = [];
  const reply = await acpAsk(QUESTIONS, {}, undefined, async (questions) => ((asked = questions), { "Which fix first?": "Lenis", "Where?": "Hero" }));
  assert.deepEqual(asked.map((q) => q.question), ["Which fix first?", "Where?"], "an answer of your own is the card's Something else, not a question");
  assert.deepEqual(asked[0].options.map((o) => [o.label, o.suggested]), [["Lenis", true], ["Measure", false]]);
  assert.equal(asked[1].multiSelect, true);
  assert.deepEqual(reply.result, { action: "accept", content: { q0: "Lenis", q1: ["Hero"] } });

  const own = await acpAsk(QUESTIONS, {}, undefined, async () => ({ "Which fix first?": "Profile it first", "Where?": "Footer" }));
  assert.deepEqual(own.result, { action: "accept", content: { q0_custom: "Profile it first", q1: ["Footer"] } }, "your own words go in its field");
});

test("acp: skipping a form lets the turn go on; one that needs an answer is declined, and Stop cancels", async () => {
  const skip = async () => null;
  assert.deepEqual((await acpAsk(QUESTIONS, {}, undefined, skip)).result, { action: "accept", content: {} });
  const needed = { ...QUESTIONS, params: { ...QUESTIONS.params, requestedSchema: { ...QUESTIONS.params.requestedSchema, required: ["q0"] } } };
  assert.equal((await acpAsk(needed, {}, undefined, skip)).result?.action, "decline");

  const fake = script("agent", ACP_ASKS);
  const s = acpProvider("acp.fake", { label: "Fake", cmd: [fake.file], login: "" }).open(opts({ env: { ...process.env, FAKE_LOG: fake.log, FAKE_ASK: JSON.stringify(QUESTIONS) } }));
  const { sink } = recorder();
  const stop = new AbortController();
  sink.ask = () => (stop.abort(), Promise.reject(new Error("stopped")));
  await s.turn("go", sink, stop.signal).catch(() => {});
  await until(() => fake.read().some((m) => m.id === 900 && !m.method), "it answers");
  s.close();
  assert.equal(fake.read().find((m) => m.id === 900 && !m.method).result.action, "cancel");
});

test("acp: a form with nothing to fill in is a yes or a no; a link to open isn't asked", async () => {
  const yesOrNo = { method: "elicitation/create", params: { mode: "form", sessionId: "s-new", message: "Use the tool?", requestedSchema: { type: "object", properties: {} } } };
  const cards: ApprovalRequest[] = [];
  const said = async (allow: boolean) => (await acpAsk(yesOrNo, {}, async (req) => (cards.push(req), { allow }))).result;
  assert.deepEqual(await said(true), { action: "accept", content: {} });
  assert.deepEqual(await said(false), { action: "decline" });
  assert.equal(cards[0].title, "Use the tool?");
  assert.deepEqual((await acpAsk(yesOrNo, { access: "full" }, async () => assert.fail("Full access doesn't ask"))).result, { action: "accept", content: {} });
  assert.deepEqual((await acpAsk({ method: "elicitation/create", params: { mode: "url", url: "https://example.com" } }, {})).result, { action: "cancel" });
});

test("acp: edits go ahead by themselves only when every file is in the project; the rest ask, and can't be allowed for good", async () => {
  const { root, away } = project();
  const options = [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }];
  const edit = async (kind: string, locations: { path: string }[] | undefined, access: Access = "edits") => {
    const cards: ApprovalRequest[] = [];
    const reply = await acpAsk(
      { method: "session/request_permission", params: { sessionId: "s-new", options, toolCall: { toolCallId: "c1", kind, title: "Change it", locations } } },
      { cwd: root, access },
      async (req) => (cards.push(req), { allow: false }),
    );
    return { picked: reply.result?.outcome?.optionId, cards };
  };

  assert.deepEqual(await edit("edit", [{ path: "src/a.ts" }, { path: join(root, "src", "new.ts") }]), { picked: "yes", cards: [] });
  for (const access of ["edits", "auto", "review"] as const) {
    const out = await edit("edit", [{ path: "src/a.ts" }, { path: join(away, "secret.txt") }], access);
    assert.equal(out.picked, "no", `${access}: one file outside is enough`);
    assert.equal(out.cards[0].risk, "high", "so Auto and the Reviewer leave it to you");
    assert.equal(out.cards[0].rule, undefined, "Don't ask again can't cover it");
    assert.match(out.cards[0].fields.find((f) => f.label === "File")?.value ?? "", /secret\.txt/, "the card names the file outside");
  }
  for (const kind of ["delete", "move"]) assert.equal((await edit(kind, [{ path: join(away, "secret.txt") }])).picked, "no");
  assert.equal((await edit("edit", [{ path: "link/secret.txt" }])).picked, "no", "through a link");
  assert.equal((await edit("edit", undefined)).picked, "no", "no file named");
  assert.equal((await edit("edit", [{ path: join(away, "secret.txt") }], "full")).picked, "yes", "Full access is all of it");
});

test("acp: an agent that ignores being stopped is ended for good", async () => {
  const fake = script("agent", `
if (m.method === "initialize") { process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); fs.writeFileSync(process.env.FAKE_LOG + ".pid", String(process.pid)); }
${ACP}`);
  const p = acpProvider("acp.fake", { label: "Fake", cmd: [fake.file], login: "" });
  const s = p.open(opts({ env: { ...process.env, FAKE_LOG: fake.log } }));
  await s.turn("hi", recorder().sink, new AbortController().signal);
  const pid = Number(readFileSync(`${fake.log}.pid`, "utf8"));
  s.close();
  await tick(300);
  assert.doesNotThrow(() => process.kill(pid, 0), "SIGTERM alone doesn't end it");
  await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, "it's gone");
});

test("acp: Don't ask again can't cover a tool of no known kind, and a kind it can is kept", async () => {
  const options = [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }];
  const rule = async (kind: string) => {
    const cards: ApprovalRequest[] = [];
    await acpAsk({ method: "session/request_permission", params: { sessionId: "s-new", options, toolCall: { toolCallId: "c1", kind, title: "Do it" } } }, { access: "ask" }, async (req) => (cards.push(req), { allow: true }));
    return cards[0].rule;
  };
  assert.equal(await rule("other"), undefined);
  assert.equal(await rule("fetch"), "fetch");
});

test("acp: in Ask first a write through Liner Code asks too, unless you just allowed that file", async () => {
  const { root } = project();
  const write = (path: string) => ({ method: "fs/write_text_file", params: { path, content: "x" } });
  const options = [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }];
  const cards: ApprovalRequest[] = [];
  const said = (allow: boolean) => async (req: ApprovalRequest) => (cards.push(req), { allow });

  const refused = await acpAsk(write("no.txt"), { cwd: root, access: "ask" }, said(false));
  assert.match(refused.error?.message ?? "", /didn't allow/);
  assert.throws(() => readFileSync(join(root, "no.txt")));
  assert.equal(cards[0].rule, "Edit");
  assert.match(cards[0].fields.find((f) => f.label === "File")?.value ?? "", /no\.txt/);

  cards.length = 0;
  await acpAsk(write("yes.txt"), { cwd: root, access: "ask" }, said(true));
  assert.equal(readFileSync(join(root, "yes.txt"), "utf8"), "x");
  assert.equal(cards.length, 1);

  // The usual way: it asks permission, then writes. One card, not two.
  cards.length = 0;
  const permission = { method: "session/request_permission", params: { sessionId: "s-new", options, toolCall: { toolCallId: "c1", kind: "edit", title: "Edit", locations: [{ path: "both.txt" }] } } };
  await acpAsks([permission, write("both.txt")], { cwd: root, access: "ask" }, said(true));
  assert.equal(readFileSync(join(root, "both.txt"), "utf8"), "x");
  assert.equal(cards.length, 1);

  // Edits doesn't ask.
  cards.length = 0;
  await acpAsk(write("edits.txt"), { cwd: root, access: "edits" }, said(false));
  assert.equal(readFileSync(join(root, "edits.txt"), "utf8"), "x");
  assert.equal(cards.length, 0);
});

test("codex: a permission request that only lists sandbox entries shows them on its card", async () => {
  const entries = [
    { access: "read", path: { type: "path", path: "/w/src" } },
    { access: "write", path: { type: "glob_pattern", pattern: "/w/out/**" } },
    { access: "write", path: { type: "special", value: { kind: "root" } } },
  ];
  const fake = script("codex", `
switch (m.method) {
  case "initialize": send({ id: m.id, result: {} }); break;
  case "thread/start": send({ id: m.id, result: { thread: { id: "new-thread" } } }); break;
  case "turn/start":
    send({ id: m.id, result: { turn: { id: "turn-1" } } });
    send({ id: 700, method: "item/permissions/requestApproval", params: { threadId: "new-thread", turnId: "turn-1", itemId: "i", permissions: { fileSystem: { entries: ${JSON.stringify(entries)} } } } });
    break;
  default:
    if (m.id === 700) send({ method: "turn/completed", params: { threadId: "new-thread", turn: { id: "turn-1", status: "completed" } } });
    else if (m.id !== undefined) send({ id: m.id, result: {} });
}`);
  const s = new CodexServerSession(opts({ env: { ...process.env, LINER_BIN_CODEX: fake.file, FAKE_LOG: fake.log } }));
  const { sink } = recorder();
  const cards: ApprovalRequest[] = [];
  sink.approve = async (req) => (cards.push(req), { allow: false });
  await s.turn("hi", sink, new AbortController().signal);
  s.close();
  assert.deepEqual(cards[0].fields.slice(0, 2), [{ label: "Write access to", value: "/w/out/**" }, { label: "Write access to", value: '{"type":"special","value":{"kind":"root"}}' }]);
  assert.deepEqual(cards[0].fields[2], { label: "Read access to", value: "/w/src" });
});

