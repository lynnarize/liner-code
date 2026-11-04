/*
  A model in an app (access.ai): the bridge's rule for it, the manifest's check and words, which of
  your models may answer an app (plainWay: an endpoint's over HTTP, Claude Code's with everything
  off, and no other), the limits on what an app sends, the stand-in a check answers with, and the
  HTTP ask itself in each protocol, streamed, against a server on this Mac. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Endpoint, PanelAccess, ProviderId } from "../../contracts/src/index.ts";
import { plainWay, panelDocument } from "../../contracts/src/index.ts";
import { accessWords, checkManifest, modelHostRefusal, widerAccess } from "../src/addons.ts";
import { modeNote, topicText } from "../src/creator.ts";
import { AI_PROMPT_MAX, panelCall, refusal, type PanelEnv } from "../src/panels.ts";
import { askEndpoint, PLAIN_SOUL } from "../src/providers/plain.ts";

const page = (access: PanelAccess) => ({ apiVersion: 1, id: "writer", kind: "panel", name: "Writer", place: "page", access });

test("bridge: ai.ask, ai.model and ai.pick need access.ai, and a page may have it", () => {
  for (const m of ["ai.ask", "ai.model", "ai.pick"]) {
    assert.match(refusal({ access: {}, place: "page" }, m) ?? "", /access\.ai/, `${m} is refused without it`);
    assert.equal(refusal({ access: { ai: true }, place: "page" }, m), null, `${m} is allowed on a page with it`);
    assert.equal(refusal({ access: { ai: true }, place: "dock", threadId: "t1" }, m), null, `${m} is allowed in the dock with it`);
  }
});

test("manifest: access.ai is true or false, said in its words, and asking for it counts as asking for more", () => {
  const m = checkManifest(page({ ai: true }));
  assert.deepEqual(m.kind === "panel" && m.access, { ai: true });
  assert.deepEqual(checkManifest(page({ ai: false })).kind === "panel" && (checkManifest(page({ ai: false })) as { access: PanelAccess }).access, {});
  assert.throws(() => checkManifest(page({ ai: "yes" as unknown as boolean })), /access\.ai must be true or false/);
  assert.match(accessWords({ ai: true }, "page"), /asks a model you pick/);
  assert.deepEqual(widerAccess({}, { ai: true }), ["Ask a model you pick, billed to its account"]);
  assert.deepEqual(widerAccess({ ai: true }, { ai: true }), []);
  // The frame's bridge has it.
  assert.match(panelDocument({ files: { "index.html": "<p>hi</p>" }, entry: "index.html", access: { ai: true }, theme: {}, place: "page" }), /ai:Object\.freeze\(\{ask,model:/);
});

test("plainWay: an endpoint's model over HTTP, Claude Code's with its tools off, and nothing that brings tools of its own", () => {
  const deepseek: Endpoint = { id: "ds", label: "DeepSeek", url: "https://api.deepseek.com/anthropic", protocol: "anthropic", models: ["deepseek-chat"] };
  const router: Endpoint = { id: "or", label: "OpenRouter", url: "https://openrouter.ai/api/v1", protocol: "chat", models: ["x"] };
  const s = { endpoints: [deepseek, router] };
  assert.deepEqual(plainWay("claude.ds", s), { kind: "http", endpoint: deepseek });
  assert.deepEqual(plainWay("opencode.or", s), { kind: "http", endpoint: router });
  // The same id under a tool that doesn't speak its protocol isn't it.
  assert.equal(plainWay("codex.ds", s), null);
  assert.deepEqual(plainWay("claude", s), { kind: "claude" });
  assert.deepEqual(plainWay("claude.work", s), { kind: "claude" }, "another Claude Code account");
  for (const id of ["codex", "opencode", "hermes", "cursor", "grok", "acp.goose", "codex.work"] as ProviderId[]) assert.equal(plainWay(id, s), null, `${id} brings tools of its own`);
  assert.equal(plainWay("opencode.voucher", {}), null, "the promo only once redeemed");
  assert.equal(plainWay("opencode.voucher", { voucher: true })?.kind, "http");
});

test("bridge: what an app sends a model is checked, and its answer comes from the model it was given", async () => {
  const asked: { prompt: string; system?: string; call?: string; stream?: boolean }[] = [];
  const env = {
    storage: { all: () => ({}), put: () => {} },
    ai: { model: () => ({ name: "Sonnet 5.5" }), pick: () => null, ask: async (o: { prompt: string; system?: string; call?: string; stream?: boolean }) => (asked.push(o), { text: "Better copy", model: "Sonnet 5.5" }) },
  } as unknown as PanelEnv;
  const w = { access: { ai: true }, place: "page" as const };
  await assert.rejects(panelCall(env, w, "ai.ask", { prompt: "  " }), /Say what to ask/);
  await assert.rejects(panelCall(env, w, "ai.ask", { prompt: "x".repeat(AI_PROMPT_MAX + 1) }), /more than an app may send/);
  await assert.rejects(panelCall(env, w, "ai.ask", { prompt: "hi", system: 3 }), /instructions, as a string/);
  assert.deepEqual(await panelCall(env, w, "ai.ask", { prompt: "Rewrite: Sign in", system: "Copy only.", stream: true, call: "c1" }), { text: "Better copy", model: "Sonnet 5.5" });
  assert.deepEqual(asked.at(-1), { prompt: "Rewrite: Sign in", system: "Copy only.", call: "c1", stream: true });
  // No stream asked for: nothing streams, but the call still names it, so a closed frame stops it.
  await panelCall(env, w, "ai.ask", { prompt: "hi", call: "c2" });
  assert.deepEqual(asked.at(-1), { prompt: "hi", system: undefined, call: "c2", stream: false });
  assert.deepEqual(await panelCall(env, w, "ai.model", {}), { name: "Sonnet 5.5" });
  await assert.rejects(panelCall({ storage: env.storage } as PanelEnv, w, "ai.ask", { prompt: "hi" }), /no model to ask here/);
});

/** A model on this Mac, speaking `protocol`, streaming `words`; what it was sent is kept. */
async function fakeModel(protocol: Endpoint["protocol"], words: string[], status = 200) {
  const got: { url?: string; headers?: IncomingMessage["headers"]; body?: any } = {};
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      Object.assign(got, { url: req.url, headers: req.headers, body: JSON.parse(raw || "{}") });
      if (status !== 200) return void res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "bad key" } }));
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (protocol === "anthropic") {
        send({ type: "message_start", message: { usage: { input_tokens: 12 } } });
        for (const w of words) send({ type: "content_block_delta", delta: { type: "text_delta", text: w } });
        send({ type: "message_delta", usage: { output_tokens: 7 } });
      } else if (protocol === "responses") {
        for (const w of words) send({ type: "response.output_text.delta", delta: w });
        send({ type: "response.completed", response: { usage: { input_tokens: 12, output_tokens: 7 } } });
      } else {
        for (const w of words) send({ choices: [{ delta: { content: w } }] });
        send({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } });
        res.write("data: [DONE]\n\n");
      }
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, got, close: () => server.close() };
}

for (const protocol of ["chat", "anthropic", "responses"] as const)
  test(`askEndpoint (${protocol}): streams the answer's pieces, with the app's instructions and the key, and counts its tokens`, async () => {
    const m = await fakeModel(protocol, ["Welcome ", "back"]);
    try {
      const pieces: string[] = [];
      const e: Endpoint = { id: "x", label: "X", url: m.url, protocol, models: ["m1"] };
      const r = await askEndpoint(e, "sk-test", "m1", { system: `${PLAIN_SOUL}\n\nCopy only.`, prompt: "Rewrite: Hello", signal: new AbortController().signal, onText: (t) => pieces.push(t) });
      assert.deepEqual(pieces, ["Welcome ", "back"]);
      assert.equal(r.text, "Welcome back");
      assert.equal(r.inputTokens, 12);
      assert.equal(r.outputTokens, 7);
      assert.equal(m.got.url, protocol === "anthropic" ? "/v1/v1/messages" : protocol === "responses" ? "/v1/responses" : "/v1/chat/completions");
      assert.match(String(m.got.headers?.authorization), /Bearer sk-test/);
      assert.equal(m.got.body.model, "m1");
      assert.equal(m.got.body.stream, true);
      // No tools are ever offered to it.
      assert.equal(m.got.body.tools, undefined);
      const said = JSON.stringify(m.got.body);
      assert.match(said, /Copy only\./);
      assert.match(said, /Rewrite: Hello/);
    } finally {
      m.close();
    }
  });

test("askEndpoint: a refusal says who answered and why, by label, and a refused key by its status alone", async () => {
  const m = await fakeModel("chat", [], 401);
  try {
    await assert.rejects(askEndpoint({ id: "x", label: "X", url: m.url, protocol: "chat", models: ["m1"] }, "nope", "m1", { system: PLAIN_SOUL, prompt: "hi", signal: new AbortController().signal }), (e: Error) => e.message === "X answered 401: check its key in Settings.");
  } finally {
    m.close();
  }
});

test("guidance: every Workshop session hears of access.ai, a page's refusal points to it, and a model's own host is refused", () => {
  const note = modeNote({ mode: "creator", agent: "@claude:x" }, [], "/tmp", (t) => `mcp__liner__${t}`, true);
  assert.match(note, /"ai": true and liner\.ai\.ask/);
  assert.match(note, /Never a prompt to copy into the chat, their API key, or the composer/);
  assert.match(topicText("bridge", { draftRoot: null, n: (t) => t }), /A model in an app \(access\.ai\)/);
  assert.match(topicText("apps", { draftRoot: null, n: (t) => t }), /AI in it, when the person asks for any/);
  assert.throws(() => checkManifest(page({ composer: true })), /For AI on the page, ask for "ai": true/);
  for (const h of ["api.openai.com", "api.anthropic.com", "openrouter.ai", "api.deepseek.com", "generativelanguage.googleapis.com", "opencode.ai"]) assert.match(modelHostRefusal(h) ?? "", /Ask for "ai": true instead/, h);
  for (const h of ["api.github.com", "api.linear.app", undefined]) assert.equal(modelHostRefusal(h), null, String(h));
  // A kept manifest that reaches one still reads, so nothing you have goes.
  assert.equal((checkManifest(page({ network: "api.openai.com" })) as { access: PanelAccess }).access.network, "api.openai.com");
});
