/*
  The Reviewer and the one writer, on a throwaway repository with tools that write files and read
  like the Reviewer but call no model: a change goes to the Reviewer and back to the lead to fix;
  one whose check a queued message went ahead of is read with the next check (reviewSince), after
  the next turn even when it changed nothing; a
  model whose tool is gone fails with a sentence instead of running the Demo; a turn says how it
  ended. Also what the Reviewer said that no model heard yet, and how reads beside a turn are counted.
  Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item, ProviderId, ProviderInfo, Thread } from "../../contracts/src/index.ts";
import { emptyUsage } from "../../contracts/src/index.ts";
import { providers, reviewerWord, Runtime, type TurnEnd } from "../src/runtime.ts";
import type { OpenOptions, Provider } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";
import { run } from "../src/exec.ts";

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const both = [info("claude", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]), info("codex", ["gpt-6-sol", "gpt-6-sol-pro", "gpt-6-luna"])];
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string) {
  for (let i = 0; i < 300 && !ok(); i++) await tick();
  assert.ok(ok(), what);
}

const who = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
type Call = { provider: ProviderId; model: string; read: boolean; text: string };
const lines = (name: string, n: number) => Array.from({ length: 10 }, (_, i) => `export const ${name}${i} = ${n};`).join("\n") + "\n";

/**
  Tools that act like Codex and Claude Code: a writing turn writes a file named by `file` (its
  model's, by default), a read-only one (the Reviewer) answers with the verdict `verdict` gives it,
  and each reports a cent of cost. `wait` holds a writing turn that long first; `writes` false
  makes it a turn that only answers.
*/
function fakeTools(calls: Call[], verdict: (c: Call, n: number) => string, o: { file?: (text: string, model: string) => string; wait?: (text: string) => number; writes?: (text: string) => boolean } = {}) {
  const make = (id: ProviderId): Provider => ({
    id,
    detect: async () => info(id, []),
    open: (opts: OpenOptions) => ({
      turn: async (text, sink, signal) => {
        const c = { provider: id, model: opts.model, read: opts.access === "read", text };
        calls.push(c);
        // Like the real tools, a conversation has an id it can be resumed by.
        sink.session(`${id}-${opts.model}`);
        sink.usage({ inputTokens: 100, outputTokens: 10, costUsd: 0.01 });
        if (c.read) return sink.text(verdict(c, calls.filter((x) => x.read).length));
        const ms = o.wait?.(text) ?? 0;
        for (let t = 0; t < ms && !signal.aborted; t += 10) await tick();
        if (o.writes?.(text) === false) return sink.text("Here's the answer.");
        const name = o.file?.(text, opts.model) ?? opts.model;
        writeFileSync(join(opts.cwd, `${name}.ts`), lines(name.replace(/\W/g, "_"), calls.length));
        sink.text("Done.");
      },
      update: async (u) => (Object.assign(opts, u), true),
      close() {},
    }),
  });
  const saved = { claude: providers.claude, codex: providers.codex };
  providers.claude = make("claude");
  providers.codex = make("codex");
  return () => Object.assign(providers, saved);
}

async function session(extra: Partial<Thread> = {}) {
  const home = mkdtempSync(join(tmpdir(), "lc-reviewer-"));
  const dir = mkdtempSync(join(tmpdir(), "lc-reviewer-repo-"));
  const git = (...args: string[]) => run("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: dir, env: { ...process.env, ...who } });
  await git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "# A project\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "start");
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: true, createdAt: Date.now() });
  store.putThread({ id: "t", projectId: "p", title: "New session", agent: "@claude:claude-sonnet-5-5", status: "idle", access: "edits", turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = both;
  return { store, runtime, home, dir };
}

const fail = (note: string) => `<findings>{"verdict":"fail","summary":"not yet","findings":[{"file":"x.ts","line":1,"severity":"blocking","note":"${note}"}]}</findings>`;
const pass = `<findings>{"verdict":"pass","summary":"fine","findings":[]}</findings>`;
const order = (calls: Call[]) => calls.map((c) => `${c.model}${c.read ? " reads" : " writes"}`);

test("reviewer: a blocked change goes back to the lead to fix, and the fix is read; the lead keeps one session", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, (_, n) => (n === 1 ? fail("drops the error") : pass));
  try {
    const { store, runtime } = await session();
    await runtime.send("t", "add a dark mode toggle to settings");
    assert.deepEqual(order(calls), ["claude-sonnet-5-5 writes", "gpt-6-sol reads", "claude-sonnet-5-5 writes", "gpt-6-sol reads"]);
    assert.match(calls[2].text, /^The Reviewer \(GPT-6-sol\) found problems[\s\S]*drops the error/);
    const items = store.timeline("t");
    assert.deepEqual(items.flatMap((x) => (x.kind === "review" ? [`${x.round}:${x.status}`] : [])), ["1:blocked", "2:passed"]);
    assert.deepEqual(items.flatMap((x) => (x.kind === "turn" ? [x.part ?? "yours"] : [])), ["yours", "fix"]);
    assert.deepEqual([store.thread("t").verdict?.state, store.thread("t").status, store.thread("t").providerSession], ["verified", "done", "claude:claude-claude-sonnet-5-5"]);
    // Each read is logged as the Reviewer's.
    assert.deepEqual(store.usage(0).map((r) => r.agent), ["@claude:claude-sonnet-5-5", "reviewer", "@claude:claude-sonnet-5-5", "reviewer"]);
  } finally {
    restore();
  }
});

test("reviewer: off for the session, nothing reads; a turn you stopped isn't read either", async () => {
  const calls: Call[] = [];
  let stopping: Runtime | undefined;
  const restore = fakeTools(calls, () => pass, { wait: () => (stopping?.stop("t"), 0) });
  try {
    const { runtime, store } = await session({ review: false });
    await runtime.send("t", "add a dark mode toggle");
    assert.deepEqual(order(calls), ["claude-sonnet-5-5 writes"]);
    store.patchThread("t", { review: undefined });
    // You press Stop as the turn ends, its file written.
    stopping = runtime;
    await runtime.send("t", "and a menu item");
    assert.deepEqual(order(calls), ["claude-sonnet-5-5 writes", "claude-sonnet-5-5 writes"], "no read after Stop");
    assert.ok(!store.timeline("t").some((x) => x.kind === "review"));
  } finally {
    restore();
  }
});

test("reviewer: a check a queued message went ahead of is made up by the next one, from where the unread change starts", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, () => pass, { file: (text) => (/first/.test(text) ? "first" : "second"), wait: (text) => (/first/.test(text) ? 60 : 0) });
  try {
    const { store, runtime } = await session();
    const going = runtime.send("t", "first change");
    await until(() => calls.length === 1, "the first turn works");
    await runtime.send("t", "second change");
    await going;
    await until(() => !runtime.isRunning("t") && calls.length === 3, "the second turn and one read");
    assert.deepEqual(order(calls), ["claude-sonnet-5-5 writes", "claude-sonnet-5-5 writes", "gpt-6-sol reads"]);
    // The one read covers both changes: the first one's check was skipped for your message.
    assert.match(calls[2].text, /first\.ts[\s\S]*second\.ts|second\.ts[\s\S]*first\.ts/);
    assert.equal(store.thread("t").reviewSince, undefined, "cleared once read");
    assert.equal(store.timeline("t").filter((x) => x.kind === "review").length, 1);
  } finally {
    restore();
  }
});

test("reviewer: a skipped check is made up after the next turn even when that turn changed nothing", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, () => pass, { file: () => "first", wait: (text) => (/first/.test(text) ? 60 : 0), writes: (text) => !/question/.test(text) });
  try {
    const { store, runtime } = await session();
    const going = runtime.send("t", "first change");
    await until(() => calls.length === 1, "the first turn works");
    await runtime.send("t", "a question about it");
    await going;
    await until(() => !runtime.isRunning("t") && calls.length === 3, "the answer and one read");
    assert.deepEqual(order(calls), ["claude-sonnet-5-5 writes", "claude-sonnet-5-5 writes", "gpt-6-sol reads"]);
    assert.match(calls[2].text, /first\.ts/);
    assert.equal(store.thread("t").reviewSince, undefined, "cleared once read");
    assert.equal(store.timeline("t").filter((x) => x.kind === "checkpoint").length, 1, "the answer changed nothing");
    // A turn that changes nothing, with nothing left unread, isn't read.
    await runtime.send("t", "another question");
    await until(() => !runtime.isRunning("t"), "the answer");
    assert.equal(calls.filter((c) => c.read).length, 1);
  } finally {
    restore();
  }
});

test("reviewer: with the Reviewer off, a skipped check leaves nothing to make up", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, () => pass, { wait: (text) => (/first/.test(text) ? 60 : 0) });
  try {
    const { store, runtime } = await session({ review: false });
    const going = runtime.send("t", "first change");
    await until(() => calls.length === 1, "the first turn works");
    await runtime.send("t", "second change");
    await going;
    await until(() => !runtime.isRunning("t") && calls.length === 2, "the second turn");
    assert.equal(store.thread("t").reviewSince, undefined);
  } finally {
    restore();
  }
});

test("a missing tool: a turn on a model whose tool is gone fails with a sentence that names it, and a read the same; neither runs the Demo", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, () => pass);
  const demo = providers.demo;
  let demoRan = false;
  providers.demo = { ...demo, open: (o) => ((demoRan = true), demo.open(o)) };
  try {
    const { store, runtime, dir } = await session({ agent: "@codex.gone:gpt-6-sol" });
    await runtime.send("t", "add a toggle");
    const error = store.timeline("t").find((x) => x.kind === "error");
    assert.match(error?.kind === "error" ? error.message : "", /^gpt-6-sol runs on a tool that isn't here any more \(an account or an API endpoint that was removed\)\. Pick another model for this session\.$/i);
    assert.equal(store.thread("t").status, "error");
    await assert.rejects(runtime.quiet("t", "codex.gone:gpt-6-sol", dir, "read this", new AbortController().signal), /isn't here any more[\s\S]*Pick another Reviewer/);
    assert.equal(demoRan, false);
    assert.deepEqual(calls, []);
  } finally {
    providers.demo = demo;
    restore();
  }
});

test("a turn says how it ended: done and whether it changed files, stopped, or an error", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, () => pass);
  try {
    const { store, runtime } = await session({ review: false });
    const turn = (text: string) => (runtime as unknown as { turn(id: string, text: string, agent: string): Promise<TurnEnd | null> }).turn("t", text, store.thread("t").agent);
    assert.deepEqual(await turn("add a toggle"), { turn: 1, status: "done", changed: true });
    // Each word below is how the one session's next turn goes.
    const claude = providers.claude;
    let how = "";
    providers.claude = { ...claude, open: (o) => ({ ...claude.open(o), turn: async (_t, sink) => (how === "stop" ? runtime.stop("t") : how === "break" ? sink.error("It broke.") : sink.text("Nothing to do.")) }) };
    runtime.closeThread("t");
    assert.deepEqual(await turn("anything left?"), { turn: 2, status: "done", changed: false });
    how = "stop";
    assert.deepEqual(await turn("go"), { turn: 3, status: "stopped", changed: false });
    how = "break";
    assert.deepEqual(await turn("go again"), { turn: 4, status: "error", changed: false });
    providers.claude = claude;
  } finally {
    restore();
  }
});

test("runtime: a tool's running totals add to what other models used in the thread", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, () => pass);
  // Claude Code reporting totals: 100 in, then 250 in, within one turn.
  const claude = providers.claude;
  providers.claude = { ...claude, open: (o) => ({ ...claude.open(o), turn: async (text, sink) => (sink.session("c"), sink.usage({ inputTokens: 100, outputTokens: 5 }, true), sink.usage({ inputTokens: 250, outputTokens: 20 }, true), writeFileSync(join(o.cwd, "a.ts"), lines("a", text.length))) }) };
  try {
    const { store, runtime } = await session();
    store.patchThread("t", { usage: { ...emptyUsage(), inputTokens: 1000, costUsd: 0.5 } });
    await runtime.send("t", "add a dark mode toggle to settings");
    // 1000 from before, 250 from the lead's totals, 100 from the Reviewer.
    assert.equal(store.thread("t").usage.inputTokens, 1350);
    assert.ok(Math.abs(store.thread("t").usage.costUsd - 0.51) < 1e-9);
  } finally {
    providers.claude = claude;
    restore();
  }
});

test("risk: reading commands, in a login shell or piped, are reads; anything that writes isn't", async () => {
  const { readsOnly } = await import("../src/risk.ts");
  for (const c of ["/bin/zsh -lc pwd", "/bin/zsh -lc 'cat math.js'", "sed -n '1,40p' README.md", "rg -n add src | head -20", "cd app && ls -la", "git diff --stat"]) assert.equal(readsOnly(c), true, c);
  for (const c of ["sed -i '' 's/a/b/' x", "cat a > b", "npm test", "find . -delete", "echo $(rm -rf x)", "git commit -m x", "node -e 1"]) assert.equal(readsOnly(c), false, c);
});

test("reviewer: notes on a change it passed reach the lead with your next message, once", async () => {
  const calls: Call[] = [];
  const noted = `<findings>{"verdict":"pass","summary":"no real bugs","findings":[{"file":"index.html","line":353,"severity":"note","note":"The firefly drops 17px when a run starts."},{"file":"index.html","line":747,"severity":"note","note":"Tapping Best starts a game."}]}</findings>`;
  const restore = fakeTools(calls, (_, n) => (n === 1 ? noted : pass));
  try {
    const { runtime } = await session();
    await runtime.send("t", "redesign the start menu");
    assert.deepEqual(order(calls), ["claude-sonnet-5-5 writes", "gpt-6-sol reads"]);
    // Passed: nothing goes back to Sonnet on its own; the notes wait for what you say next.
    const from = calls.length;
    await runtime.send("t", "fix the notes");
    const sent = calls[from];
    assert.equal(sent.model, "claude-sonnet-5-5");
    assert.match(sent.text, /^The Reviewer \(gpt-6-sol\) read the last change and passed it, with these notes \(no real bugs\):\n- \(a note\) index\.html:353: The firefly drops 17px[\s\S]*index\.html:747: Tapping Best starts a game\.\n\nfix the notes$/);
    // Heard once: the fix's own check passed clean, so the next message goes as it is.
    const next = calls.length;
    await runtime.send("t", "thanks");
    assert.equal(calls[next].text, "thanks");
  } finally {
    restore();
  }
});

test("reviewer: a fix round that changed nothing isn't read again; it's yours, and the note says the fix changed nothing", async () => {
  const calls: Call[] = [];
  // The lead answers the findings without touching a file.
  const restore = fakeTools(calls, () => fail("drops the error"), { writes: (text) => !text.startsWith("The Reviewer") });
  try {
    const { store, runtime } = await session();
    const told: string[] = [];
    store.on((e) => void (e.type === "notify" && told.push(e.title)));
    await runtime.send("t", "add a dark mode toggle");
    assert.deepEqual(order(calls), ["claude-sonnet-5-5 writes", "gpt-6-sol reads", "claude-sonnet-5-5 writes"], "no second read of the same diff");
    assert.equal(store.thread("t").status, "waiting");
    assert.deepEqual(store.thread("t").verdict, { state: "blocked", note: "1 finding still blocking: the fix changed nothing", round: 1 });
    assert.ok(told.includes("The Reviewer needs you"));
  } finally {
    restore();
  }
});

test("reviewer: what's still there after the last round reaches the lead with your next message; what it fixed doesn't", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, (_, n) => fail(n === 1 ? "the score never resets" : "the pipes keep moving"));
  try {
    const { store, runtime } = await session();
    await runtime.send("t", "add a home button");
    // Round 1's blocker went to Sonnet to fix; round 2's is left for you.
    assert.deepEqual(order(calls), ["claude-sonnet-5-5 writes", "gpt-6-sol reads", "claude-sonnet-5-5 writes", "gpt-6-sol reads"]);
    assert.match(calls[2].text, /the score never resets/);
    assert.equal(store.thread("t").status, "waiting");
    const from = calls.length;
    await runtime.send("t", "fix it");
    assert.match(calls[from].text, /^The Reviewer \(gpt-6-sol\) read the last change and didn't pass it, and these are still there after 2 rounds \(not yet\):\n- x\.ts:1: the pipes keep moving\n\nfix it$/);
  } finally {
    restore();
  }
});

test("reviewer: notes on the last change that no model heard yet go with your next message, even after a turn that changed nothing", () => {
  const at = Date.now();
  const items: Item[] = [
    { kind: "checkpoint", id: "c1", turn: 1, at, files: [{ path: "index.html", status: "modified", added: 268, removed: 12 }], from: "a", to: "b" },
    { kind: "review", id: "r1", turn: 1, at: at + 1, reviewer: "claude:claude-opus-5-5", round: 1, status: "passed", summary: "no real bugs", findings: [{ file: "index.html", line: 353, severity: "note", note: "The firefly jumps when a run starts." }] },
    // Your "fix the three notes" before Liner passed notes on: a question back, no change.
    { kind: "turn", id: "t2", turn: 2, at: at + 2, agent: "@claude:claude-sonnet-5-5", model: "claude:claude-sonnet-5-5", status: "done" },
  ];
  const word = reviewerWord(items, (ref) => (ref.endsWith("opus-5-5") ? "Opus 5.5" : ref));
  assert.match(word?.text ?? "", /^The Reviewer \(Opus 5\.5\) read the last change and passed it, with these notes \(no real bugs\):\n- \(a note\) index\.html:353: The firefly jumps/);
  assert.deepEqual(word?.reviews.map((r) => r.id), ["r1"]);
  // Heard, or about a change since undone: nothing to say.
  assert.equal(reviewerWord(items.map((x) => (x.kind === "review" ? { ...x, heard: true } : x)), String), null);
  assert.equal(reviewerWord(items.map((x) => (x.kind === "checkpoint" ? { ...x, reverted: true } : x)), String), null);
});

test("usage: a turn logs its own use once; a read beside it (a step's Reviewer) is logged on its own", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, () => pass);
  const codex = providers.codex;
  let runtime: Runtime | undefined;
  // Mid-turn, a quick read by another model (what Reviewer decides does for a step).
  providers.codex = { ...codex, open: (o) => ({ ...codex.open(o), turn: async (_text, sink, signal) => (sink.usage({ inputTokens: 1000, outputTokens: 50, costUsd: 0.5 }), await runtime!.quiet("t", "claude:claude-haiku-5-5", o.cwd, "read this step", signal), sink.text("Done.")) }) };
  try {
    const s = await session({ agent: "@codex:gpt-6-luna" });
    runtime = s.runtime;
    await runtime.send("t", "what does this do?");
    const log = s.store.usage(0);
    assert.deepEqual(log.map((r) => [r.agent, r.inputTokens, r.costUsd]), [["reviewer", 100, 0.01], ["@codex:gpt-6-luna", 1000, 0.5]]);
    // The thread counts both, once each.
    assert.equal(s.store.thread("t").usage.inputTokens, 1100);
  } finally {
    providers.codex = codex;
    restore();
  }
});

test("a fork while the Reviewer reads the last change takes that turn along: it has ended, only the read goes on", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, () => pass);
  const codex = providers.codex;
  let release = () => {};
  let reading = false;
  // The Reviewer's read waits until it's let go.
  providers.codex = { ...codex, open: (o) => (o.access === "read" ? { ...codex.open(o), turn: async (text, sink, signal) => ((reading = true), await new Promise<void>((r) => (release = r)), codex.open(o).turn(text, sink, signal)) } : codex.open(o)) };
  try {
    const { store, runtime } = await session();
    const { createApi } = await import("../src/api.ts");
    const api = createApi(store, runtime, process.env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {} } as never);
    const working = runtime.send("t", "add a dark mode toggle to settings");
    for (let i = 0; i < 400 && !reading; i++) await tick();
    assert.ok(reading && runtime.isRunning("t"), "the Reviewer reads");
    const fork = (await api.call("thread.create", { projectId: "p", forkOf: "t" })) as Thread;
    assert.equal(fork.turns, 1);
    assert.ok(store.timeline(fork.id).some((x) => x.kind === "checkpoint" && x.turn === 1), "the turn that ended comes along, its change too");
    assert.equal(fork.forkSession, store.thread("t").providerSession);
    release();
    await working;
  } finally {
    providers.codex = codex;
    restore();
  }
});

/** Tools where Sonnet writes as fakeTools' do and the Reviewer (gpt-6-sol, in Codex) never answers, deaf to Stop; `closed` counts its sessions closed. */
function deafReader(calls: Call[]) {
  const restore = fakeTools(calls, () => pass);
  const closed = { n: 0 };
  const writer = providers.claude;
  providers.codex = {
    id: "codex",
    detect: async () => info("codex", []),
    open: (opts: OpenOptions) => ({
      turn: async (text) => {
        calls.push({ provider: "codex", model: opts.model, read: true, text });
        await new Promise(() => {});
      },
      close: () => void closed.n++,
    }),
  };
  return { closed, writer, restore };
}

test("reviewer: a Reviewer that never answers is given up at its limit; the change isn't counted as read, and the next check reads it", async () => {
  const calls: Call[] = [];
  const { closed, restore } = deafReader(calls);
  try {
    const { store, runtime } = await session();
    runtime.reviewMs = 150;
    const t0 = Date.now();
    await runtime.send("t", "add a dark mode toggle");
    assert.ok(Date.now() - t0 < 5000, "not held for good");
    const item = store.timeline("t").findLast((x) => x.kind === "review");
    assert.equal(item?.kind === "review" && item.status, "error");
    assert.equal(item?.kind === "review" && item.summary, "The Reviewer didn't answer in 1 second, so this change wasn't read.");
    assert.deepEqual([store.thread("t").status, store.thread("t").verdict], ["done", undefined]);
    assert.equal(closed.n, 1, "the reader's session is closed");
    const cp = store.timeline("t").find((x) => x.kind === "checkpoint");
    assert.equal(store.thread("t").reviewSince, cp?.kind === "checkpoint" ? cp.from : "?", "still unread, from where the change starts");
    // The next turn changes nothing, and its check reads the change the last one couldn't.
    const before = calls.filter((c) => c.read).length;
    await runtime.send("t", "what did you change?");
    assert.equal(calls.filter((c) => c.read).length, before + 1, "read again with the next check");
  } finally {
    restore();
  }
});

test("reviewer: Stop still ends a read that waits on a Reviewer that never answers", async () => {
  const calls: Call[] = [];
  const { restore } = deafReader(calls);
  try {
    const { store, runtime } = await session();
    const going = runtime.send("t", "add a dark mode toggle");
    await until(() => store.thread("t").verdict?.state === "checking", "the Reviewer reads");
    runtime.stop("t");
    await going;
    const item = store.timeline("t").findLast((x) => x.kind === "review");
    assert.equal(item?.kind === "review" && item.summary, "You stopped the review.");
    assert.equal(store.thread("t").status, "done");
  } finally {
    restore();
  }
});

test("quiet: a one-off read whose model never answers ends at its limit with a sentence, and closes its session", async () => {
  const calls: Call[] = [];
  const { closed, restore } = deafReader(calls);
  try {
    const { runtime, dir } = await session();
    await assert.rejects(runtime.quiet("t", "codex:gpt-6-sol", dir, "write a commit message", new AbortController().signal, "reviewer", 100), /didn't answer in 1 second\. Try again in a moment\./);
    assert.equal(closed.n, 1);
  } finally {
    restore();
  }
});
