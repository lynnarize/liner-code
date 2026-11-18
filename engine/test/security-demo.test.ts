/*
  Liner Security's Demo, end to end through the engine's own API, runtime, agent tools and /surface, on the Demo tool only
  (no other tool can be found on the PATH it runs with, and no account is touched): with the Demo shown and nothing of
  Security's own, the mockup's sample is put in place (three projects, the four findings, the history board A draws); a
  scripted scan reads, asks its three questions with its guesses and waits for the answers, reports two findings
  (lodash, open already, isn't raised again), and ends with the second look as board F draws it. Nothing of the sample
  goes into a project that isn't the Demo's. Run with `npm test -w engine`.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item, ScanChoices, ScanRecord, SecurityFinding, SecurityOverview, SecurityProject, Thread } from "../../contracts/src/index.ts";
import { AgentTools } from "../src/agent-tools.ts";
import { createApi } from "../src/api.ts";
import { Runtime } from "../src/runtime.ts";
import { Security } from "../src/security.ts";
import { demoWanted } from "../src/security-demo.ts";
import { Store } from "../src/store.ts";

const until = async (ok: () => boolean, ms = 30_000, what = "it") => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

async function engine(o: { demo?: boolean; real?: boolean } = {}) {
  // Not resolved: on a Mac the temp folder is reached through a link (/var → /private/var), as a home can be.
  const home = mkdtempSync(join(tmpdir(), "lc-secdemo-"));
  const store = new Store(home);
  if (o.demo !== false) store.setSettings({ showDemo: true });
  // A real project of the person's, which the sample must never touch.
  const mine = realpathSync(mkdtempSync(join(tmpdir(), "lc-secdemo-mine-")));
  store.putProject({ id: "mine", name: "mine", path: mine, git: false, createdAt: 1 });
  const env = { PATH: "/usr/bin:/bin", HOME: home };
  const tools = new AgentTools(store, env);
  const runtime = new Runtime(store, env, tools);
  tools.host = runtime;
  const sec = new Security(store, env);
  tools.security = sec;
  if (o.real) sec.add("mine", { title: "Something real", severity: "low", source: "agent" });
  const api = createApi(store, runtime, env, { routines: { routines: [], recent: [] }, terms: {}, logs: {}, proxies: {}, tools, security: sec } as never);
  // The engine's /surface, as main.ts serves it.
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      const { tool, args } = JSON.parse(body) as { tool: string; args: Record<string, unknown> };
      const threadId = tools.threadOf(String(req.headers["x-liner-surface"]));
      res.end(JSON.stringify(threadId ? { ok: true, result: await tools.call(threadId, tool, args) } : { ok: false, error: "no key" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  tools.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = <T>(m: string, p: unknown) => api.call(m, p) as Promise<T>;
  const close = async () => {
    server.close();
    await runtime.shutdown();
  };
  return { home, store, sec, runtime, call, close, mine };
}

test("security demo: the sample is put in place once, only in the Demo's own folders, as board A reads", async () => {
  const e = await engine();
  try {
    assert.equal(demoWanted(e.sec), true);
    await e.call("security.side", {});
    await until(() => e.sec.projects().length === 4 && e.sec.findings().length === 6 && e.store.threads.some((t) => t.security?.kind === "fix"), 30_000, "the sample");
    const projects = await e.call<SecurityProject[]>("security.projects", {});
    assert.deepEqual(projects.map((p) => p.name).sort(), ["Sample project", "harbour-notes", "liner-site", "mine"]);
    const sample = projects.find((p) => p.name === "Sample project")!;
    assert.equal(sample.open, 4);
    assert.deepEqual(sample.bySeverity, { critical: 0, high: 1, medium: 2, low: 1 });
    assert.deepEqual(sample.threatModel.areas.map((a) => [a.name, a.open]), [["The API", 2], ["Sign-in", 1], ["Saved alerts", 0], ["File uploads", 0]]);
    assert.deepEqual(sample.scans.map((s) => s.title), ["Sample project, in full", "Sample project, this branch", "Sample project, free checks"]);
    assert.equal(projects.find((p) => p.name === "liner-site")!.lastScan?.title, "liner-site, free checks");
    assert.equal(projects.find((p) => p.name === "harbour-notes")!.lastScan, undefined);
    // Nothing of the sample in the person's own project.
    assert.deepEqual(e.sec.findings("mine"), []);
    assert.deepEqual(e.sec.scans("mine"), []);
    const o = await e.call<SecurityOverview>("security.overview", { days: 30 });
    assert.equal(o.open, 4);
    assert.equal(o.openWeekAgo, 1);
    assert.equal(o.found, 6);
    assert.equal(o.scans, 4);
    assert.equal(o.fixed, 1);
    assert.equal(o.dismissed, 1);
    assert.deepEqual(o.dismissReasons, { "accepted-risk": 1 });
    assert.equal(o.beingFixed, 1);
    assert.deepEqual(o.byLook, { confirmed: 2, unconfirmed: 1, none: 1 });
    assert.deepEqual(o.series.map((d) => d.open).slice(-25), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 0, 4]);
    assert.deepEqual(o.worst.map((f) => f.title), ["The station id goes into the database query as text", "The admin page checks your role in the browser only", "lodash 4.17.20 has a known problem", "Error pages show where in the code it failed"].sort((a, b) => o.worst.findIndex((f) => f.title === a) - o.worst.findIndex((f) => f.title === b)));
    assert.equal(o.worst[0].severity, "high");
    assert.equal(o.worst.at(-1)?.severity, "low");
    assert.deepEqual(o.checks.map((c) => [c.check, c.state, c.count]).sort(), [["files", "clean", 0], ["packages", "found", 1], ["secrets", "clean", 0]]);
    // Once only: put in place again would need the marker gone.
    assert.equal(demoWanted(e.sec), false);
  } finally {
    await e.close();
  }
});

test("security demo: not put in place when the Demo is hidden, or when Security has something of its own", async () => {
  for (const o of [{ demo: false }, { real: true }]) {
    const e = await engine(o);
    try {
      assert.equal(demoWanted(e.sec), false);
      await e.call("security.side", {});
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(e.sec.projects().length, 1);
      assert.ok(!existsSync(join(e.home, "Demo projects")));
    } finally {
      await e.close();
    }
  }
});

test("security demo: the scripted scan asks and waits, finds two, leaves lodash alone, and ends with Codex's second look", async () => {
  const e = await engine();
  try {
    await e.call("security.side", {});
    await until(() => e.sec.findings().length === 6 && e.store.threads.some((t) => t.security?.kind === "fix"), 30_000, "the sample");
    const sample = e.sec.projects().find((p) => p.name === "Sample project")!;
    const c = await e.call<ScanChoices>("security.scan.options", { projectId: sample.id });
    assert.deepEqual(c.branch, { name: "fix/tide-midnight", base: "main", files: 6 });
    assert.equal(c.depths[1].cost, "About 3 min");
    assert.deepEqual(c.defaults.reader, { kind: "own", agent: "demo" }, "the Sample project starts with the Demo");
    assert.equal(c.defaults.secondLook, "demo:demo");
    assert.equal(c.defaults.threatModel?.write, false, "SECURITY.md is there");
    const { scan, thread } = await e.call<{ scan: ScanRecord; thread: Thread }>("security.scan.start", { ...c.defaults, depth: "branch", lookFirst: "the new alerts API", stopsAfter: 10 });
    assert.equal(e.store.thread(thread.id).access, "read");
    // It asks its three questions, its guess first, and waits.
    const asking = () => e.store.timeline(thread.id).find((x): x is Extract<Item, { kind: "question" }> => x.kind === "question" && x.state === "asking");
    await until(() => Boolean(asking()), 30_000, "the questions");
    assert.equal(e.sec.scan(scan.id).state, "asking");
    const q = asking()!;
    assert.deepEqual(q.questions.map((x) => [x.question, x.options[0].label, x.options[0].guess]), [
      ["Can anyone sign up, or only people you invite?", "Anyone can sign up", "the sign-up form asks for no invite"],
      ["Should one person ever see another person's alerts?", "No, never", "every alert is saved with its owner"],
      ["May an alert's text hold links or formatting?", "No, plain text only", "the alert form has a plain text box"],
    ]);
    assert.deepEqual(e.sec.scan(scan.id).areasUntouched, ["Sign-in", "File uploads"]);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(e.sec.findings(sample.id).filter((f) => f.scan === scan.id).length, 0, "paused: nothing found while it waits");
    await e.call("question.answer", { threadId: thread.id, itemId: q.id, answers: { "Can anyone sign up, or only people you invite?": "Anyone can sign up", "Should one person ever see another person's alerts?": "No, never" } });
    await until(() => ["done", "stopped", "failed"].includes(e.sec.scan(scan.id).state), 60_000, "the scan's end");
    const done = e.sec.scan(scan.id);
    assert.equal(done.state, "done", done.error);
    assert.deepEqual([done.counts.found, done.counts.fresh, done.counts.already], [3, 2, 1]);
    assert.deepEqual(done.areasRead?.sort(), ["Saved alerts", "The API"]);
    assert.equal(done.summary, "This branch lets anyone who is signed in read another person's alerts.");
    const mine = e.sec.findings(sample.id).filter((f) => f.scan === scan.id).sort((a, b) => a.foundAt - b.foundAt) as SecurityFinding[];
    assert.deepEqual(mine.map((f) => [f.title, f.severity, f.file, f.line, f.look.state, f.look.by]), [
      ["Anyone signed in can read another person's alert", "medium", "src/routes/alerts.js", 27, "confirmed", "demo:demo"],
      ["An alert's text may reach the page as HTML", "low", "src/components/AlertCard.tsx", 19, "unconfirmed", "demo:demo"],
    ]);
    // The chat: the answers saved, three findings (one already open), the second voice, the end.
    const lines = e.store.timeline(thread.id).filter((x): x is Extract<Item, { kind: "security" }> => x.kind === "security").map((x) => x.event);
    assert.deepEqual(lines.map((l) => l.type), ["answers", "finding", "finding", "finding", "look", "done"]);
    const answers = lines[0];
    assert.ok(answers.type === "answers" && answers.answered === 2 && answers.skipped === 1 && answers.saved === "SECURITY.md");
    assert.deepEqual(lines.slice(1, 4).map((l) => l.type === "finding" && l.outcome), ["already-open", "new", "new"]);
    const look = lines[4];
    assert.ok(look.type === "look" && look.state === "done" && look.by === c.defaults.secondLook, "named as Start a scan offered it");
    assert.match(look.type === "look" ? (look.words ?? "") : "", /The first finding holds/);
    const end = lines[5];
    assert.ok(end.type === "done" && end.state === "done" && end.confirmed === 1);
    assert.match(readFileSync(join(sample.path, "SECURITY.md"), "utf8"), /## Answers to the scan's questions\n\n- Can anyone sign up, or only people you invite\? The person answered: Anyone can sign up\.[^\n]*\n- Should one person ever see another person's alerts\? The person answered: No, never\./);
    // The plan ticked off, as board F shows it.
    const plan = e.store.timeline(thread.id).findLast((x) => x.kind === "plan");
    assert.ok(plan?.kind === "plan" && plan.entries.length === 5 && plan.entries.every((x) => x.status === "completed"));
    assert.equal(plan.kind === "plan" && plan.entries[4].title, "Hand what I found to Demo for a second look", "the plan names who really looks again");
    assert.equal(e.store.thread(thread.id).access, "read");
    // Liner's own append to SECURITY.md isn't the scan's change: no checkpoint, nothing to review.
    assert.deepEqual(e.store.timeline(thread.id).filter((x) => x.kind === "checkpoint"), []);
    // A scan changes nothing, so it leaves nothing in the repository it read: no snapshots under refs/liner/.
    assert.equal(execFileSync("git", ["for-each-ref", `refs/liner/${thread.id}`], { cwd: sample.path, encoding: "utf8" }).trim(), "");
    // On the Demo the sample's free checks stay as seeded: nothing ran npm audit on it.
    assert.deepEqual(e.sec.checks(sample.id)?.results.map((r) => [r.check, r.state, r.count, r.note]), [["secrets", "clean", 0, undefined], ["packages", "found", 1, "from npm audit"], ["files", "clean", 0, undefined]]);
    // The stand-ins are marked as the Demo's, for Code's lists to leave out; switched off, Security leaves them out too.
    assert.deepEqual(e.store.projects.filter((p) => p.demoFor).map((p) => p.name).sort(), ["harbour-notes", "liner-site"]);
    // A second scan doesn't ask what SECURITY.md now answers (the two answered; the skipped one is asked again).
    const again = await e.call<{ scan: ScanRecord; thread: Thread }>("security.scan.start", { ...c.defaults, depth: "branch", stopsAfter: 10 });
    const q2 = () => e.store.timeline(again.thread.id).find((x): x is Extract<Item, { kind: "question" }> => x.kind === "question" && x.state === "asking");
    await until(() => Boolean(q2()), 30_000, "the second scan's question");
    assert.deepEqual(q2()!.questions.map((x) => x.question), ["May an alert's text hold links or formatting?"]);
    await e.call("question.answer", { threadId: again.thread.id, itemId: q2()!.id });
    await until(() => ["done", "stopped", "failed"].includes(e.sec.scan(again.scan.id).state), 60_000, "the second scan's end");
    // Switched off, Security leaves the Sample project out too: someone who added it to try the app never sees it there.
    e.store.setSettings({ showDemo: false });
    assert.deepEqual((await e.call<SecurityProject[]>("security.projects", {})).map((p) => p.name).sort(), ["mine"]);
    await assert.rejects(e.call("security.scan.options", { projectId: e.store.projects.find((p) => p.agent === "demo")!.id }), /Sample project/);
  } finally {
    await e.close();
  }
});

test("security demo: a question waits however long you take, and Stop ends it as stopped, never as your skipping it", async () => {
  const e = await engine();
  try {
    await e.call("security.side", {});
    await until(() => e.sec.findings().length === 6, 30_000, "the sample");
    const sample = e.sec.projects().find((p) => p.name === "Sample project")!;
    const c = await e.call<ScanChoices>("security.scan.options", { projectId: sample.id });
    const { scan, thread } = await e.call<{ scan: ScanRecord; thread: Thread }>("security.scan.start", { ...c.defaults, depth: "branch", stopsAfter: 10 });
    const question = () => e.store.timeline(thread.id).find((x): x is Extract<Item, { kind: "question" }> => x.kind === "question");
    await until(() => question()?.state === "asking", 30_000, "the questions");
    // A long idle: no timer anywhere answers or skips it.
    await new Promise((r) => setTimeout(r, 4000));
    assert.equal(question()!.state, "asking");
    assert.equal(e.sec.scan(scan.id).state, "asking");
    const stopped = await e.call<ScanRecord>("security.scan.stop", { id: scan.id });
    assert.equal(stopped.state, "stopped");
    await until(() => question()!.state !== "asking", 5000, "the question to end");
    assert.equal(question()!.state, "expired", "ended, not skipped");
    assert.equal(e.sec.scan(scan.id).state, "stopped");
    assert.equal(e.sec.scan(scan.id).error, "You stopped it.");
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(!e.store.timeline(thread.id).some((x) => x.kind === "security" && x.event.type === "answers"), "no answers line");
  } finally {
    await e.close();
  }
});
