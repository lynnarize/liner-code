/*
  What agents keep between sessions in a project, and what they can look up from earlier ones:
  facts saved once and handed to every new session, and search over what was asked and answered.
  Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { factsOf, forget, memoryNote, remember, searchSessions } from "../src/memory.ts";
import { AgentTools } from "../src/agent-tools.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { OpenOptions, Provider } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";

const thread = (id: string, title: string, projectId = "p"): Thread => ({ id, projectId, title, agent: "forge", status: "done", access: "edits", turns: 1, usage: emptyUsage(), createdAt: 1, updatedAt: 1 });

test("memory: a fact is saved once, one line, and the newest show first to a new session", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-mem-"));
  assert.equal(memoryNote(home, "p"), "");
  assert.equal(remember(home, "p", "Tests run with  npm test -- --run\n").added, true);
  assert.equal(remember(home, "p", "tests run with npm test -- --run").added, false, "the same fact, any case");
  remember(home, "p", "The person wants plain HTML, no build step.");
  assert.deepEqual(factsOf(home, "p"), ["Tests run with npm test -- --run", "The person wants plain HTML, no build step."]);
  assert.match(memoryNote(home, "p"), /saved[\s\S]*\n- The person wants plain HTML, no build step\.\n- Tests run with npm test -- --run$/);
  assert.deepEqual(forget(home, "p", 0), ["The person wants plain HTML, no build step."]);
  assert.deepEqual(factsOf(home, "other"), [], "each project its own");
  assert.throws(() => remember(home, "p", "   "), /sentence/);
});

test("search: earlier sessions in the project, best match first, the session asking left out", () => {
  const home = mkdtempSync(join(tmpdir(), "lc-search-"));
  const store = new Store(home);
  for (const t of [thread("a", "Counter page"), thread("b", "Tides"), thread("c", "Elsewhere", "q"), thread("now", "This one")]) store.putThread(t);
  store.putItem("a", { kind: "user", id: "a1", turn: 1, at: 100, text: "Add a Reset button that sets the count back to 0." });
  store.putItem("a", { kind: "text", id: "a2", turn: 1, at: 200, text: "Reset works: the count goes back to 0 and the Reset button sits next to the counter.", streaming: false });
  store.putItem("b", { kind: "user", id: "b1", turn: 1, at: 300, text: "Fix the tide count for tomorrow." });
  store.putItem("c", { kind: "user", id: "c1", turn: 1, at: 400, text: "Reset button in another project" });
  store.putItem("now", { kind: "user", id: "n1", turn: 1, at: 500, text: "How did we do the reset button?" });
  store.flush();
  // Read back from the logs, as search does for sessions that aren't open.
  const fresh = new Store(home);
  const hits = searchSessions(fresh, "p", "reset button", { skip: "now" });
  assert.deepEqual(hits.map((h) => [h.threadId, h.who]), [["a", "agent"], ["a", "you"]]);
  assert.match(hits[0].snippet, /Reset works/);
  assert.equal(hits[0].title, "Counter page");
  assert.deepEqual(searchSessions(fresh, "p", "ok"), [], "words under three letters aren't searched");
});

test("agent tools: memory_add saves for the project, sessions_search reads its other sessions", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-mtools-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: home, git: false, createdAt: 1 });
  store.putThread(thread("a", "Counter page"));
  store.putThread(thread("now", "This one"));
  store.putItem("a", { kind: "user", id: "a1", turn: 1, at: 100, text: "Serve it with npx serve ." });
  const tools = new AgentTools(store, process.env);
  const saved = await tools.call("now", "memory_add", { fact: "Serve the page with npx serve ." });
  assert.match((saved.content[0] as { text: string }).text, /^Saved\. This project's memory holds 1 fact/);
  assert.deepEqual(factsOf(home, "p"), ["Serve the page with npx serve ."]);
  const found = await tools.call("now", "sessions_search", { query: "serve" });
  assert.match((found.content[0] as { text: string }).text, /^“Counter page”, 1970-01-01, the person asked:\nServe it with npx serve \./);
});

test("memory: a new session starts with what earlier ones saved", async () => {
  const home = mkdtempSync(join(tmpdir(), "lc-msoul-"));
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: home, git: false, createdAt: 1 });
  store.putThread({ ...thread("t", "New session"), status: "idle", turns: 0 });
  remember(home, "p", "The person wants plain HTML, no build step.");
  const souls: string[] = [];
  const fake: Provider = { id: "claude", detect: async () => ({}) as ProviderInfo, open: (o: OpenOptions) => (souls.push(o.soul), { turn: async (_t, sink) => sink.text("ok"), update: async () => false, close() {} }) };
  const saved = providers.claude;
  providers.claude = fake;
  try {
    await new Runtime(store, process.env).send("t", "hi");
    assert.match(souls[0], /What earlier sessions in this project saved[\s\S]*plain HTML, no build step/);
  } finally {
    providers.claude = saved;
  }
});
