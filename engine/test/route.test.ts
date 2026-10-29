/*
  Routed sessions: what the router makes of a message, the rules each level follows, the cast
  it picks from what's ready, and the runtime running a cascade and a critique for real on a
  throwaway repository, with tools that write files and read like judges but call no model.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderId, ProviderInfo, Thread, ThreadRoute } from "../../contracts/src/index.ts";
import { castOf, emptyUsage } from "../../contracts/src/index.ts";
import { decide, hintOf, scoreAsk, weightOf, WARM_MS } from "../src/route.ts";
import { critiquePrompt, repairPrompt, reviewPrompt } from "../src/review.ts";
import { providers, Runtime } from "../src/runtime.ts";
import type { OpenOptions, Provider } from "../src/providers/types.ts";
import { Store } from "../src/store.ts";
import { run } from "../src/exec.ts";

const info = (id: ProviderInfo["id"], models: string[]): ProviderInfo => ({ id, label: id, available: true, adapter: true, login: "", models: models.map((m) => ({ id: m, label: m, description: "" })), supports: { approvals: true, resume: true, effort: true, plan: true } });
const both = [info("claude", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]), info("codex", ["gpt-6-sol", "gpt-6-sol-pro", "gpt-6-luna"])];
const cast = castOf(both)!;
const route = (level: ThreadRoute["level"], p: Partial<ThreadRoute> = {}): ThreadRoute => ({ level, cast, root: cast.everyday, ...p });
const weight = (text: string) => weightOf(scoreAsk(text));

test("route: talk and small changes are light, other changes medium, reasoning and reach heavy", () => {
  for (const t of ["hi", "thanks!", "what does the runtime do when a turn is stopped?", "fix the typo in the README title", "update the changelog for 0.1.3"]) assert.equal(weight(t), "light", t);
  for (const t of ["add a dark mode toggle to settings", "tests are failing after the last change, fix them", "there's a race condition between the queue and steer, find and fix it"]) assert.equal(weight(t), "medium", t);
  // A stack trace says where to look: debugging alone doesn't make a job heavy.
  assert.equal(weight("the app crashes when I open a session:\nTypeError: Cannot read properties of undefined (reading 'path')\n    at cwdOf (engine/src/api.ts:212:31)"), "medium");
  assert.equal(weight("refactor the provider layer so every provider shares one session base class, and migrate codex and acp to it"), "heavy");
  assert.equal(weight("Build the routines page:\n- a list with on/off\n- a run view\n- earlier runs\n- a webhook trigger\nIt should read like the rest of the app."), "heavy");
  assert.equal(scoreAsk("why does the reviewer skip small changes?").talk, true);
  assert.equal(scoreAsk("why does this fail? fix it").talk, false);
});

test("route: each level's rules, first match wins", () => {
  const medium = "add a dark mode toggle to settings";
  const heavy = "refactor the provider layer so every provider shares one session base class, and migrate codex and acp to it";
  // Standard: one model a message, the strong one for hard jobs.
  assert.deepEqual([decide(medium, route("standard")).pattern, decide(medium, route("standard")).writer], ["single", cast.everyday]);
  assert.deepEqual([decide(heavy, route("standard")).pattern, decide(heavy, route("standard")).writer], ["single", cast.strong]);
  // High: small jobs alone, medium ones cascade, hard ones get a critic.
  assert.equal(decide("rename the button label to Save", route("high")).pattern, "single");
  const c = decide(medium, route("high"));
  assert.deepEqual([c.pattern, c.writer, c.judge, c.repair], ["cascade", cast.everyday, cast.judge, cast.strong]);
  assert.deepEqual([decide(heavy, route("high")).pattern, decide(heavy, route("high")).critics.length], ["critique", 1]);
  // Max: even light jobs are checked; the hardest get two critics.
  assert.equal(decide("rename the button label to Save", route("max")).pattern, "cascade");
  assert.deepEqual([decide(heavy, route("max")).writer, decide(heavy, route("max")).critics], [cast.strong, cast.critics]);
  // A question costs one model, a hard one the strong model.
  assert.deepEqual([decide("what does this file do?", route("max")).pattern, decide("what does this file do?", route("max")).writer], ["single", cast.everyday]);
  assert.equal(decide("why is the design of the cache invalidation protocol consistent?", route("high")).writer, cast.strong);
});

test("route: a follow-up keeps the warm model; a cold cache or a new size of job routes again", () => {
  const now = Date.now();
  const repaired = route("high", { root: cast.strong, last: { at: now - 60_000, weight: "medium", pattern: "cascade", escalated: true } });
  // A question goes to whoever is working; more of the same job stays with the model that repaired it.
  assert.deepEqual([decide("what did you change?", repaired, now).writer, decide("what did you change?", repaired, now).reuse], [cast.strong, true]);
  assert.deepEqual([decide("also add it to the menu bar", repaired, now).pattern, decide("also add it to the menu bar", repaired, now).writer], ["single", cast.strong]);
  // Cold, or a heavier job: routed afresh.
  assert.equal(decide("also add it to the menu bar", { ...repaired, last: { ...repaired.last!, at: now - WARM_MS - 1 } }, now).pattern, "cascade");
  assert.equal(decide("refactor every provider onto one base class and migrate the layer", repaired, now).pattern, "critique");
});

test("route: the timeline line says who does what", () => {
  const label = (ref: string) => ({ [cast.everyday]: "GPT-6 Luna", [cast.strong]: "Opus 5.5", [cast.critics[0]]: "GPT-6 Sol" })[ref] ?? ref;
  assert.equal(hintOf(decide("add a dark mode toggle", route("high")), label), "Routed: a medium job. GPT-6 Luna does it, then Opus 5.5 judges the change: it passes, or it repairs it.");
  assert.equal(hintOf(decide("hi", route("high")), label), "Routed: a question, so GPT-6 Luna answers alone.");
  assert.match(hintOf(decide("refactor the provider layer so every provider shares one base class", route("max")), label), /^Routed: the hardest kind of job\. Opus 5\.5 does it, GPT-6 Sol and GPT-6 Luna read it, and Opus 5\.5 revises once/);
});

test("cast: Luna for everyday work, Opus for hard jobs and repairs, judges and critics from the other family", () => {
  assert.deepEqual(cast, { everyday: "codex:gpt-6-luna", strong: "claude:claude-opus-5-5", judge: "claude:claude-opus-5-5", critics: ["codex:gpt-6-sol", "codex:gpt-6-luna"] });
  // Claude alone: Sonnet and Opus, and the only critic is Claude's own.
  assert.deepEqual(castOf([both[0]]), { everyday: "claude:claude-sonnet-5-5", strong: "claude:claude-opus-5-5", judge: "claude:claude-opus-5-5", critics: ["claude:claude-sonnet-5-5"] });
  // A Codex without Sol (a ChatGPT sign-in): Luna is its best, and reads once, not twice.
  assert.deepEqual(castOf([both[0], info("codex", ["gpt-6-luna", "gpt-5.6-terra"])])?.critics, ["codex:gpt-6-luna"]);
  // Your own picks win; nothing ready, no cast.
  assert.equal(castOf(both, { strong: "codex:gpt-6-sol-pro" })?.strong, "codex:gpt-6-sol-pro");
  assert.equal(castOf([]), null);
  assert.equal(castOf([{ ...both[0], available: false }]), null);
});

test("prompts: the judge knows a fail goes to a stronger model; repairs and critiques get every finding", () => {
  assert.match(reviewPrompt("ask", "diff", 1, "judge"), /a stronger model repairs it/);
  assert.match(reviewPrompt("ask", "diff", 1, "critic"), /revises once/);
  assert.doesNotMatch(reviewPrompt("ask", "diff", 1), /stronger model|revises once/);
  const findings = [{ file: "a.ts", line: 3, severity: "note" as const, note: "nicer name" }, { file: "b.ts", line: 9, endLine: 12, severity: "blocking" as const, note: "drops errors" }];
  // Must-fix first.
  assert.match(repairPrompt("Opus 5.5", "GPT-6 Luna", findings), /GPT-6 Luna just made a change[\s\S]*b\.ts:9-12: drops errors[\s\S]*\(a note\) a\.ts:3/);
  assert.match(critiquePrompt(["GPT-6 Sol"], findings), /Must fix, b\.ts:9-12[\s\S]*Note, a\.ts:3/);
});

/* ------------------------- The runtime, on a throwaway repository ------------------------- */

const who = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
type Call = { provider: ProviderId; model: string; read: boolean; text: string };

/**
  Tools that act like Codex and Claude Code: a writing turn writes a file named for its model, a
  read-only one (a judge, a critic) answers with the verdict `verdict` gives it, and each reports
  a cent of cost.
*/
function fakeTools(calls: Call[], verdict: (c: Call, n: number) => string) {
  const make = (id: ProviderId): Provider => ({
    id,
    detect: async () => info(id, []),
    open: (o: OpenOptions) => ({
      turn: async (text, sink) => {
        const c = { provider: id, model: o.model, read: o.access === "read", text };
        calls.push(c);
        // Like the real tools, a conversation has an id it can be resumed by.
        sink.session(`${id}-${o.model}`);
        sink.usage({ inputTokens: 100, outputTokens: 10, costUsd: 0.01 });
        if (c.read) return sink.text(verdict(c, calls.filter((x) => x.read).length));
        writeFileSync(join(o.cwd, `${o.model}.ts`), Array.from({ length: 10 }, (_, i) => `export const line${i} = ${calls.length};`).join("\n") + "\n");
        sink.text("Done.");
      },
      update: async (u) => (Object.assign(o, u), true),
      close() {},
    }),
  });
  const saved = { claude: providers.claude, codex: providers.codex };
  providers.claude = make("claude");
  providers.codex = make("codex");
  return () => Object.assign(providers, saved);
}

async function session(level: ThreadRoute["level"]) {
  const home = mkdtempSync(join(tmpdir(), "lc-route-"));
  const dir = mkdtempSync(join(tmpdir(), "lc-route-repo-"));
  const git = (...args: string[]) => run("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: dir, env: { ...process.env, ...who } });
  await git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "# A project\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "start");
  const store = new Store(home);
  store.putProject({ id: "p", name: "p", path: dir, git: true, createdAt: Date.now() });
  const t: Thread = { id: "t", projectId: "p", title: "New session", agent: `@${cast.everyday}`, status: "idle", access: "edits", route: route(level), turns: 0, usage: emptyUsage(), createdAt: Date.now(), updatedAt: Date.now() };
  store.putThread(t);
  const runtime = new Runtime(store, process.env);
  runtime.providerInfo = both;
  return { store, runtime, home };
}

const fail = (note: string) => `<findings>{"verdict":"fail","summary":"not yet","findings":[{"file":"x.ts","line":1,"severity":"blocking","note":"${note}"}]}</findings>`;
const pass = `<findings>{"verdict":"pass","summary":"fine","findings":[]}</findings>`;

test("runtime: a cascade the judge won't pass goes to Opus to repair, and the judge reads the repair", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, (_, n) => (n === 1 ? fail("drops the error") : pass));
  try {
    const { store, runtime, home } = await session("high");
    await runtime.send("t", "add a dark mode toggle to settings");
    // Luna writes, Opus judges, Opus repairs (taking the conversation over), Opus reads the repair.
    assert.deepEqual(calls.map((c) => `${c.model}${c.read ? " reads" : " writes"}`), ["gpt-6-luna writes", "claude-opus-5-5 reads", "claude-opus-5-5 writes", "claude-opus-5-5 reads"]);
    assert.match(calls[1].text, /a stronger model repairs it/);
    assert.match(calls[2].text, /^You're taking over this conversation[\s\S]*didn't pass it:[\s\S]*drops the error/);
    const items = store.timeline("t");
    assert.match(items.find((x) => x.kind === "notice")?.kind === "notice" ? (items.find((x) => x.kind === "notice") as { text: string }).text : "", /^Routed: a medium job\. gpt-6-luna does it, then claude-opus-5-5 judges/);
    assert.deepEqual(items.flatMap((x) => (x.kind === "review" ? [`${x.round}:${x.status}`] : [])), ["1:blocked", "2:passed"]);
    const t = store.thread("t");
    assert.deepEqual([t.verdict?.state, t.route?.root, t.route?.last?.escalated, t.status], ["verified", cast.strong, true, "done"]);
    // Every leg is counted: two writing turns, two judge reads.
    store.flush();
    const rows = readFileSync(join(home, "usage.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((r) => `${r.agent === "judge" ? "judge" : "writer"}:${r.model}`), ["writer:gpt-6-luna", "judge:claude-opus-5-5", "writer:claude-opus-5-5", "judge:claude-opus-5-5"]);
    assert.ok(Math.abs(t.usage.costUsd - 0.04) < 1e-9);
    // More of the same job while the cache is warm stays with Opus, one follow-up after another.
    calls.length = 0;
    await runtime.send("t", "also add it to the menu bar");
    await runtime.send("t", "and give it a keyboard shortcut");
    assert.deepEqual(calls.map((c) => `${c.model}${c.read ? " reads" : " writes"}`), ["claude-opus-5-5 writes", "claude-opus-5-5 writes"]);
    assert.equal(store.thread("t").route?.last?.escalated, true);
  } finally {
    restore();
  }
});

test("runtime: a cascade the judge passes never calls Opus to write", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, () => pass);
  try {
    const { store, runtime } = await session("high");
    await runtime.send("t", "add a dark mode toggle to settings");
    assert.deepEqual(calls.map((c) => `${c.model}${c.read ? " reads" : " writes"}`), ["gpt-6-luna writes", "claude-opus-5-5 reads"]);
    assert.deepEqual([store.thread("t").verdict?.state, store.thread("t").route?.root], ["verified", cast.everyday]);
  } finally {
    restore();
  }
});

test("runtime: a critique reads side by side, each critic counted once, and the writer revises once", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, (c) => (c.model === "gpt-6-sol" ? fail("misses the acp provider") : pass));
  try {
    const { store, runtime, home } = await session("max");
    await runtime.send("t", "refactor the provider layer so every provider shares one session base class, and migrate codex and acp to it");
    const order = calls.map((c) => `${c.model}${c.read ? " reads" : " writes"}`);
    assert.equal(order[0], "claude-opus-5-5 writes");
    assert.deepEqual(order.slice(1, 3).sort(), ["gpt-6-luna reads", "gpt-6-sol reads"]);
    assert.equal(order[3], "claude-opus-5-5 writes");
    assert.equal(order.length, 4);
    assert.match(calls[3].text, /read your change side by side[\s\S]*Must fix, x\.ts:1: misses the acp provider/);
    const reviews = store.timeline("t").flatMap((x) => (x.kind === "review" ? [`${x.reviewer}:${x.status}`] : []));
    assert.deepEqual(reviews.sort(), ["codex:gpt-6-luna:passed", "codex:gpt-6-sol:blocked"]);
    // The revision isn't read again, so there's no verdict to show.
    assert.equal(store.thread("t").verdict, undefined);
    store.flush();
    const critics = readFileSync(join(home, "usage.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.agent === "critic");
    assert.deepEqual(critics.map((r) => r.costUsd), [0.01, 0.01]);
  } finally {
    restore();
  }
});

test("route: a code change that also touches the README isn't a docs-only small change", () => {
  assert.equal(scoreAsk("Add a `multiply(a, b)` function to math.js, next to `add`, and list it in README.md the way `add` is listed.").small, false);
  assert.equal(scoreAsk("update the README install steps").small, true);
});

test("runtime: a tool's running totals add to what other models used in the thread", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, () => pass);
  // Codex reports totals: 100 in, then 250 in, within one turn.
  const codex = providers.codex;
  providers.codex = { ...codex, open: (o) => ({ ...codex.open(o), turn: async (text, sink) => (sink.session("c"), sink.usage({ inputTokens: 100, outputTokens: 5 }, true), sink.usage({ inputTokens: 250, outputTokens: 20 }, true), writeFileSync(join(o.cwd, "a.ts"), Array.from({ length: 10 }, (_, i) => `export const a${i} = ${text.length};`).join("\n"))) }) };
  try {
    const { store, runtime } = await session("high");
    store.patchThread("t", { usage: { ...emptyUsage(), inputTokens: 1000, costUsd: 0.5 } });
    await runtime.send("t", "add a dark mode toggle to settings");
    // 1000 from before, 250 from Codex's totals, 100 from the judge.
    assert.equal(store.thread("t").usage.inputTokens, 1350);
    assert.ok(Math.abs(store.thread("t").usage.costUsd - 0.51) < 1e-9);
  } finally {
    restore();
  }
});

test("runtime: a quick model that changes nothing is judged on its answer, and Opus takes on what it didn't do", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, (c) => (/changed no files/.test(c.text) ? `<findings>{"verdict":"fail","summary":"multiply was never added","findings":[]}</findings>` : pass));
  // Luna can't get at the files and says so, changing nothing.
  const codex = providers.codex;
  providers.codex = { ...codex, open: (o) => ({ ...codex.open(o), turn: async (text, sink) => (calls.push({ provider: "codex", model: o.model, read: o.access === "read", text }), sink.session("c"), sink.text("I couldn't read the files.")) }) };
  try {
    const { store, runtime } = await session("high");
    await runtime.send("t", "add a dark mode toggle to settings");
    assert.deepEqual(calls.map((c) => `${c.model}${c.read ? " reads" : " writes"}`), ["gpt-6-luna writes", "claude-opus-5-5 reads", "claude-opus-5-5 writes", "claude-opus-5-5 reads"]);
    assert.match(calls[1].text, /changed no files[\s\S]*I couldn't read the files/);
    assert.match(calls[2].text, /didn't get it done\. A judge \(claude-opus-5-5\) says: multiply was never added/);
    assert.deepEqual(store.timeline("t").flatMap((x) => (x.kind === "review" ? [`${x.round}:${x.status}`] : [])), ["1:blocked", "2:passed"]);
    assert.deepEqual([store.thread("t").verdict?.state, store.thread("t").route?.root], ["verified", cast.strong]);
  } finally {
    restore();
  }
});

test("runtime: an answer that does the ask passes the judge, and Opus never writes", async () => {
  const calls: Call[] = [];
  const restore = fakeTools(calls, () => pass);
  const codex = providers.codex;
  providers.codex = { ...codex, open: (o) => ({ ...codex.open(o), turn: async (text, sink) => (calls.push({ provider: "codex", model: o.model, read: o.access === "read", text }), sink.text("Three tests fail, all in api.ts.")) }) };
  try {
    const { runtime } = await session("high");
    await runtime.send("t", "run the tests and tell me what fails");
    assert.deepEqual(calls.map((c) => `${c.model}${c.read ? " reads" : " writes"}`), ["gpt-6-luna writes", "claude-opus-5-5 reads"]);
  } finally {
    restore();
  }
});

test("risk: reading commands, in a login shell or piped, are reads; anything that writes isn't", async () => {
  const { readsOnly } = await import("../src/risk.ts");
  for (const c of ["/bin/zsh -lc pwd", "/bin/zsh -lc 'cat math.js'", "sed -n '1,40p' README.md", "rg -n add src | head -20", "cd app && ls -la", "git diff --stat"]) assert.equal(readsOnly(c), true, c);
  for (const c of ["sed -i '' 's/a/b/' x", "cat a > b", "npm test", "find . -delete", "echo $(rm -rf x)", "git commit -m x", "node -e 1"]) assert.equal(readsOnly(c), false, c);
});
