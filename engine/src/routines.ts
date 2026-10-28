/*
  Routines: work that runs on its own. A trigger starts a run (a schedule, a pull request or
  issue someone opened, a webhook, or a press of Run now); AI steps read, work or audit in a
  session of their own; then code decides: the gate checks its rules, and only it may merge.
  Every run lands in the Routines list; whatever is left for you waits in Needs you.

  GitHub triggers poll the GitHub CLI every few minutes, so they work without a public URL.
  Webhooks listen on the engine's own address (this Mac only) until remote access exists.
*/
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Item, Routine, RoutineRun, RoutineStep, RunStep, Thread, Trigger } from "../../contracts/src/index.ts";
import { emptyUsage, splitModel } from "../../contracts/src/index.ts";
import { run } from "./exec.ts";
import { parseFindings, reviewPrompt } from "./review.ts";
import type { Runtime } from "./runtime.ts";
import { uid, type Store } from "./store.ts";

type Subject = NonNullable<RoutineRun["subject"]>;
type Context = { subject?: Subject; body?: unknown; headers?: Record<string, string>; diff?: string; files?: string[]; additions?: number; deletions?: number };

const TICK = 30_000;
const POLL = 5 * 60_000;

/** When a schedule fires next, after `from`. */
export function nextRun(t: Trigger, from = Date.now()): number | undefined {
  if (t.kind !== "schedule") return undefined;
  const d = new Date(from);
  if (t.every === "hour") {
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d.getTime();
  }
  const [h, m] = (t.at ?? "09:00").split(":").map(Number);
  const next = new Date(from);
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= from) next.setDate(next.getDate() + 1);
  const ok = (x: Date) => (t.every === "weekday" ? x.getDay() >= 1 && x.getDay() <= 5 : t.every === "week" ? x.getDay() === (t.day ?? 1) : true);
  for (let i = 0; i < 8 && !ok(next); i++) next.setDate(next.getDate() + 1);
  return next.getTime();
}

/** "Mondays at 9:00", "Every hour", "When an outside pull request opens". */
export function describeTrigger(t: Trigger) {
  const days = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  if (t.kind === "schedule") return t.every === "hour" ? "Every hour" : t.every === "day" ? `Every day at ${t.at ?? "09:00"}` : t.every === "weekday" ? `Weekdays at ${t.at ?? "09:00"}` : `${days[t.day ?? 1]} at ${t.at ?? "09:00"}`;
  if (t.kind === "github") return t.event === "pr.opened" ? (t.outside ? "When someone outside the team opens a pull request" : "When a pull request opens") : "When an issue is opened";
  if (t.kind === "webhook") return "When its webhook is called";
  return "By hand";
}

/** {{body.pull_request.number}} and {{headers.x-github-event}} in a prompt, filled from what started the run. */
export function fill(text: string, ctx: Context) {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, path: string) => {
    const [root, ...rest] = path.split(".");
    let v: unknown = root === "body" ? ctx.body : root === "headers" ? ctx.headers : root === "subject" ? ctx.subject : undefined;
    for (const k of rest) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
    return v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

export class Routines {
  private list: Routine[] = [];
  private runs: RoutineRun[] = [];
  private seen = new Map<string, Set<number>>();
  private polled = new Map<string, number>();
  private aborts = new Map<string, AbortController>();
  private timer: NodeJS.Timeout | null = null;
  private store: Store;
  private runtime: Runtime;
  private env: NodeJS.ProcessEnv;

  constructor(store: Store, runtime: Runtime, env: NodeJS.ProcessEnv) {
    this.store = store;
    this.runtime = runtime;
    this.env = env;
    const file = join(store.home, "routines.json");
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, "utf8")) as { routines?: Routine[]; runs?: RoutineRun[]; seen?: Record<string, number[]> };
      this.list = saved.routines ?? [];
      this.runs = (saved.runs ?? []).map((r) => (r.status === "running" ? { ...r, status: "failed", outcome: "The engine stopped during this run." } : r));
      for (const [k, v] of Object.entries(saved.seen ?? {})) this.seen.set(k, new Set(v));
    }
  }

  get routines() {
    return this.list;
  }
  get recent() {
    return this.runs.slice(-200);
  }

  start() {
    this.timer = setInterval(() => void this.tick(), TICK);
    void this.tick();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const a of this.aborts.values()) a.abort();
  }

  private save() {
    const file = join(this.store.home, "routines.json");
    const seen = Object.fromEntries([...this.seen].map(([k, v]) => [k, [...v].slice(-500)]));
    writeFileSync(`${file}.tmp`, JSON.stringify({ routines: this.list, runs: this.runs.slice(-300), seen }, null, 2));
    renameSync(`${file}.tmp`, file);
  }

  put(input: Omit<Routine, "id" | "createdAt" | "failures"> & { id?: string }) {
    const prev = input.id ? this.list.find((r) => r.id === input.id) : undefined;
    const trigger: Trigger = input.trigger.kind === "webhook" && !input.trigger.secret ? { kind: "webhook", secret: randomBytes(12).toString("hex") } : input.trigger;
    const r: Routine = { ...input, trigger, id: prev?.id ?? uid("rt"), createdAt: prev?.createdAt ?? Date.now(), failures: prev?.failures ?? 0, nextRun: nextRun(trigger) };
    this.list = prev ? this.list.map((x) => (x.id === r.id ? r : x)) : [...this.list, r];
    // A new GitHub trigger starts from what's open now, not from everything ever opened.
    if (!prev && r.trigger.kind === "github") void this.poll(r, true);
    this.save();
    this.store.emit({ type: "routine", routine: r });
    return r;
  }
  remove(id: string) {
    this.list = this.list.filter((r) => r.id !== id);
    this.save();
    this.store.emit({ type: "routine.removed", id });
  }

  private async tick() {
    const now = Date.now();
    for (const r of this.list) {
      if (!r.on) continue;
      if (r.trigger.kind === "schedule" && r.nextRun && r.nextRun <= now) {
        this.patch(r.id, { nextRun: nextRun(r.trigger, now) });
        void this.fire(r.id, describeTrigger(r.trigger));
      }
      if (r.trigger.kind === "github" && now - (this.polled.get(r.id) ?? 0) >= POLL) void this.poll(r);
    }
  }

  /** New pull requests or issues since the last look. `quiet` only notes them, for a fresh trigger. */
  private async poll(r: Routine, quiet = false) {
    if (r.trigger.kind !== "github") return;
    this.polled.set(r.id, Date.now());
    const cwd = this.store.project(r.projectId).path;
    const kind = r.trigger.event === "pr.opened" ? "pr" : "issue";
    const res = await run("gh", [kind, "list", "--state", "open", "--limit", "20", "--json", "number,title,author,url,authorAssociation"], { cwd, env: this.env, timeout: 30000 });
    if (res.code !== 0) return;
    const items = JSON.parse(res.stdout) as { number: number; title: string; url: string; author?: { login: string }; authorAssociation?: string }[];
    const seen = this.seen.get(r.id) ?? new Set<number>();
    for (const it of items.sort((a, b) => a.number - b.number)) {
      if (seen.has(it.number)) continue;
      seen.add(it.number);
      if (quiet) continue;
      const outside = !["OWNER", "MEMBER", "COLLABORATOR"].includes((it.authorAssociation ?? "").toUpperCase());
      if (r.trigger.outside && !outside) continue;
      const who = it.author?.login ?? "Someone";
      void this.fire(r.id, `${who} opened #${it.number}`, { subject: { kind, number: it.number, title: it.title, author: who, url: it.url } });
    }
    this.seen.set(r.id, seen);
    this.save();
  }

  webhook(id: string, secret: string, body: unknown, headers: Record<string, string>) {
    const r = this.list.find((x) => x.id === id);
    if (!r || r.trigger.kind !== "webhook" || r.trigger.secret !== secret) return false;
    if (!r.on) return true;
    void this.fire(id, "Its webhook was called", { body, headers });
    return true;
  }

  private patch(id: string, p: Partial<Routine>) {
    const r = this.list.find((x) => x.id === id);
    if (!r) return;
    Object.assign(r, p);
    this.save();
    this.store.emit({ type: "routine", routine: r });
  }
  private putRun(r: RoutineRun) {
    const i = this.runs.findIndex((x) => x.id === r.id);
    if (i < 0) this.runs.push(r);
    else this.runs[i] = r;
    this.save();
    this.store.emit({ type: "run", run: r });
  }

  stopRun(runId: string) {
    this.aborts.get(runId)?.abort();
    const r = this.runs.find((x) => x.id === runId);
    if (r?.threadId) this.runtime.stop(r.threadId);
  }

  /** A test run, on a pull request or issue you name or on nothing at all. Nothing is merged, posted or edited. */
  async test(id: string, number?: number) {
    const r = this.list.find((x) => x.id === id);
    if (!r) throw new Error("That routine is gone.");
    const ctx: Context = {};
    if (number) {
      const kind = r.trigger.kind === "github" && r.trigger.event === "issue.opened" ? "issue" : "pr";
      const v = await run("gh", [kind, "view", String(number), "--json", "number,title,author,url"], { cwd: this.store.project(r.projectId).path, env: this.env, timeout: 30000 });
      if (v.code !== 0) throw new Error(`Couldn't read #${number}: ${v.stderr.trim().split("\n").pop() ?? "gh failed"}`);
      const it = JSON.parse(v.stdout) as { number: number; title: string; url: string; author?: { login: string } };
      ctx.subject = { kind, number: it.number, title: it.title, author: it.author?.login, url: it.url };
    }
    return this.fire(id, number ? `A test on #${number}` : "A test", ctx, true);
  }

  /** Starts a run. Resolves with the run as it begins; it carries on in the background. */
  async fire(id: string, cause: string, ctx: Context = {}, test = false): Promise<RoutineRun> {
    const r = this.list.find((x) => x.id === id);
    if (!r) throw new Error("That routine is gone.");
    const runRec: RoutineRun = { id: uid("rn"), routineId: id, at: Date.now(), cause, status: "running", steps: [], subject: ctx.subject, ...(test ? { test: true } : {}) };
    this.putRun(runRec);
    void this.execute(r, runRec, ctx).catch((e) => {
      runRec.status = "failed";
      runRec.outcome = e instanceof Error ? e.message : String(e);
      this.putRun(runRec);
    });
    return runRec;
  }

  private async execute(r: Routine, rec: RoutineRun, ctx: Context) {
    const abort = new AbortController();
    this.aborts.set(rec.id, abort);
    const started = Date.now();
    const project = this.store.project(r.projectId);
    const cwd = project.path;
    const step = (label: string, model?: string): RunStep => {
      const s: RunStep = { label, model, status: "running", at: Date.now() };
      rec.steps.push(s);
      this.putRun(rec);
      return s;
    };
    const end = (s: RunStep, status: RunStep["status"], detail?: string) => {
      s.status = status;
      s.detail = detail;
      s.seconds = (Date.now() - s.at) / 1000;
      this.putRun(rec);
    };

    // What it's about: a pull request's diff and files, read once for every step.
    if (ctx.subject?.kind === "pr") {
      const s = step(`GitHub · ${ctx.subject.author ?? "Someone"} opened #${ctx.subject.number}`);
      const [diff, view] = await Promise.all([
        run("gh", ["pr", "diff", String(ctx.subject.number)], { cwd, env: this.env, timeout: 60000 }),
        run("gh", ["pr", "view", String(ctx.subject.number), "--json", "files,additions,deletions,body"], { cwd, env: this.env, timeout: 30000 }),
      ]);
      ctx.diff = diff.stdout;
      try {
        const v = JSON.parse(view.stdout) as { files?: { path: string }[]; additions?: number; deletions?: number };
        ctx.files = (v.files ?? []).map((f) => f.path);
        ctx.additions = v.additions;
        ctx.deletions = v.deletions;
      } catch {
        // gh didn't say; the rules that need it will fail closed
      }
      end(s, "done", `${ctx.files?.length ?? 0} files, +${ctx.additions ?? 0} −${ctx.deletions ?? 0}`);
    }

    // The session the run works in: its own, or the routine's one session.
    const thread = this.threadFor(r, rec, ctx);
    rec.threadId = thread.id;
    this.putRun(rec);

    let verdict: "pass" | "fail" | undefined;
    let notes = "";
    for (const st of r.steps) {
      if (abort.signal.aborted) break;
      if (st.kind !== "ai") continue;
      const who = this.store.agent(st.agent);
      const model = splitModel(who.model);
      const s = step(st.role === "read" ? `${who.name} reads it` : st.role === "audit" ? `${who.name} audits it` : `${who.name} works on it`, who.model);
      const prompt = this.promptFor(st, ctx);
      try {
        if (st.role === "work" && rec.test) end(s, "skipped", "A test doesn't edit anything");
        else if (st.role === "work") {
          this.store.patchThread(thread.id, { agent: st.agent, access: "edits" });
          await this.runtime.send(thread.id, prompt);
          const t = this.store.thread(thread.id);
          end(s, t.status === "error" ? "failed" : "done", t.status === "error" ? "The agent ran into a problem" : `${t.toReview ?? 0} files changed`);
        } else {
          const text = await this.runtime.quiet(thread.id, who.model, cwd, st.role === "audit" ? reviewPrompt(prompt, (ctx.diff ?? "").slice(0, 60000), 1) : prompt, abort.signal);
          this.note(thread, st.agent, `${model.provider}:${model.model}`, st.role === "audit" ? text.replace(/<findings>[\s\S]*<\/findings>/, "").trim() : text);
          if (st.role === "audit") {
            const found = parseFindings(text);
            verdict = found?.verdict ?? "fail";
            notes = (found?.findings ?? []).map((f) => `- ${f.file}${f.line ? `:${f.line}` : ""}: ${f.note}`).join("\n");
            if (found) this.store.putItem(thread.id, { kind: "review", id: uid("it"), turn: this.store.thread(thread.id).turns, at: Date.now(), reviewer: who.model, round: 1, status: found.verdict === "pass" ? "passed" : "blocked", findings: found.findings, summary: found.summary });
            end(s, "done", found ? `${found.findings.length} ${found.findings.length === 1 ? "note" : "notes"}, ${found.verdict === "pass" ? "nothing blocking" : "something blocks"}` : "No verdict");
          } else end(s, "done", text.split("\n").find((l) => l.trim())?.slice(0, 120));
        }
      } catch (e) {
        end(s, "failed", e instanceof Error ? e.message : String(e));
      }
    }

    // The gate: code, not a model, decides.
    const gate = r.steps.find((s) => s.kind === "gate") as Extract<RoutineStep, { kind: "gate" }> | undefined;
    let passed = !abort.signal.aborted && !rec.steps.some((s) => s.status === "failed");
    if (gate) {
      const s = step("The gate checks its rules");
      rec.rules = await this.check(gate, ctx, verdict, cwd);
      passed = passed && rec.rules.every((x) => x.ok);
      end(s, "done", `${rec.rules.filter((x) => x.ok).length} of ${rec.rules.length} rules hold`);
    }

    // Actions, each on its branch of the gate.
    let outcome: RoutineRun["status"] = passed ? "done" : "handed";
    for (const a of r.steps) {
      if (a.kind !== "action" || abort.signal.aborted) continue;
      if (a.when === "pass" && !passed) continue;
      if (a.when === "fail" && passed) continue;
      const s = step(actionLabel(a));
      if (rec.test) {
        end(s, "skipped", "Would run here; tests never act");
        continue;
      }
      try {
        const done = await this.act(a, ctx, notes, cwd, thread.id, r, rec);
        if (a.action === "merge" && done) outcome = "merged";
        if (a.action === "inbox") outcome = "handed";
        end(s, done ? "done" : "skipped", done ? undefined : "Nothing to do");
      } catch (e) {
        end(s, "failed", e instanceof Error ? e.message : String(e));
        outcome = "failed";
      }
    }

    this.aborts.delete(rec.id);
    const t = this.store.thread(thread.id);
    rec.status = abort.signal.aborted ? "failed" : outcome;
    rec.outcome = abort.signal.aborted ? "You stopped this run." : rec.status === "merged" ? "Merged on its own" : rec.status === "handed" ? "Waits for you" : rec.status === "failed" ? "Something failed" : "Done";
    rec.seconds = (Date.now() - started) / 1000;
    const u = t.usage ?? emptyUsage();
    rec.tokens = u.inputTokens + u.outputTokens + u.cacheReadTokens;
    this.putRun(rec);
    if (rec.test) {
      rec.outcome = abort.signal.aborted ? "You stopped this test." : passed ? "Would have taken the pass path" : `Would have taken Otherwise${rec.rules?.find((x) => !x.ok) ? `: ${rec.rules.find((x) => !x.ok)!.label.toLowerCase()} failed` : ""}`;
      this.putRun(rec);
      return;
    }
    const failures = rec.status === "failed" ? r.failures + 1 : 0;
    this.patch(r.id, { lastRun: rec.at, failures, ...(r.pauseAfter && failures >= r.pauseAfter ? { on: false } : {}) });
    if (r.pauseAfter && failures >= r.pauseAfter) this.store.emit({ type: "notify", threadId: thread.id, kind: "error", title: `${r.name} is paused`, body: `It failed ${failures} times in a row.` });
    // A run that handled everything itself settles; one that waits for you stays in Needs you.
    if ((rec.status === "merged" || rec.status === "done") && this.store.settings.settleOnRoutine) this.store.patchThread(thread.id, { done: true, unread: false });
  }

  private threadFor(r: Routine, rec: RoutineRun, ctx: Context): Thread {
    const existing = r.runsGo === "one" && r.threadId ? this.store.threads.find((t) => t.id === r.threadId && !t.archived) : undefined;
    if (existing) {
      this.store.patchThread(existing.id, { routine: { id: r.id, run: rec.id } });
      return existing;
    }
    const first = r.steps.find((s) => s.kind === "ai") as Extract<RoutineStep, { kind: "ai" }> | undefined;
    const now = Date.now();
    const t: Thread = {
      id: uid("th"),
      projectId: r.projectId,
      title: ctx.subject ? `${r.name} · #${ctx.subject.number} ${ctx.subject.title}`.slice(0, 80) : `${r.name} · ${new Date(now).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
      agent: first?.agent ?? this.store.agents[0]?.id ?? "demo",
      status: "idle",
      access: "read",
      turns: 0,
      usage: emptyUsage(),
      routine: { id: r.id, run: rec.id },
      createdAt: now,
      updatedAt: now,
    };
    this.store.putThread(t);
    if (r.runsGo === "one") this.patch(r.id, { threadId: t.id });
    return t;
  }

  /** A read or audit step's report, on the session's timeline. */
  private note(thread: Thread, agent: string, model: string, text: string) {
    const t = this.store.thread(thread.id);
    const turn = t.turns + 1;
    const at = Date.now();
    this.store.patchThread(thread.id, { turns: turn });
    this.store.putItem(thread.id, { kind: "turn", id: uid("it"), turn, at, agent, model, status: "done" });
    if (text.trim()) this.store.putItem(thread.id, { kind: "text", id: uid("it"), turn, at, text: text.trim(), streaming: false } as Item);
  }

  private promptFor(st: Extract<RoutineStep, { kind: "ai" }>, ctx: Context) {
    const parts = [fill(st.prompt, ctx)];
    if (ctx.subject) parts.push(`It's about ${ctx.subject.kind === "pr" ? "pull request" : "issue"} #${ctx.subject.number}: "${ctx.subject.title}" by ${ctx.subject.author ?? "someone"}${ctx.subject.url ? ` (${ctx.subject.url})` : ""}.`);
    if (ctx.files?.length && st.role !== "audit") parts.push(`Files it changes: ${ctx.files.join(", ")}`);
    if (ctx.diff && st.role === "read") parts.push(`The diff:\n<diff>\n${ctx.diff.slice(0, 40000)}\n</diff>`);
    if (ctx.body && !ctx.subject) parts.push(`What the webhook sent:\n${JSON.stringify(ctx.body).slice(0, 8000)}`);
    if (st.role !== "work") parts.push("You only read and report: don't change anything.");
    return parts.join("\n\n");
  }

  private async check(gate: Extract<RoutineStep, { kind: "gate" }>, ctx: Context, verdict: string | undefined, cwd: string) {
    const out: { label: string; ok: boolean; detail?: string }[] = [];
    const n = ctx.subject?.number;
    for (const rule of gate.rules) {
      if (rule.kind === "checks") {
        if (!n) {
          out.push({ label: "Every check passes", ok: false, detail: "No pull request" });
          continue;
        }
        const r = await run("gh", ["pr", "view", String(n), "--json", "statusCheckRollup"], { cwd, env: this.env, timeout: 30000 });
        const checks = (JSON.parse(r.stdout || "{}") as { statusCheckRollup?: { conclusion?: string; state?: string; status?: string }[] }).statusCheckRollup ?? [];
        const bad = checks.filter((c) => !/SUCCESS|NEUTRAL|SKIPPED/.test((c.conclusion || c.state || c.status || "").toUpperCase()));
        out.push({ label: "Every check passes", ok: checks.length > 0 && bad.length === 0, detail: checks.length ? `${checks.length - bad.length} of ${checks.length}` : "No checks ran" });
      } else if (rule.kind === "reviewer") out.push({ label: "The Reviewer finds nothing blocking", ok: verdict === "pass", detail: verdict ? (verdict === "pass" ? "Nothing blocking" : "Something blocks") : "No audit ran" });
      else if (rule.kind === "maxLines") {
        const lines = (ctx.additions ?? Infinity) + (ctx.deletions ?? 0);
        out.push({ label: `Fewer than ${rule.n} changed lines`, ok: lines < rule.n, detail: Number.isFinite(lines) ? String(lines) : "Unknown" });
      } else if (rule.kind === "paths") {
        const hit = (ctx.files ?? []).filter((f) => rule.deny.some((p) => f.startsWith(p) || new RegExp(`(^|/)${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).test(f)));
        out.push({ label: `Leaves ${rule.deny.slice(0, 3).join(", ")} alone`, ok: ctx.files !== undefined && hit.length === 0, detail: hit.length ? hit.slice(0, 3).join(", ") : `${ctx.files?.length ?? 0} files` });
      } else if (rule.kind === "knownAuthor") {
        const who = ctx.subject?.author;
        const r = who ? await run("gh", ["pr", "list", "--state", "merged", "--author", who, "--limit", "1", "--json", "number"], { cwd, env: this.env, timeout: 30000 }) : null;
        const before = r && r.code === 0 ? (JSON.parse(r.stdout || "[]") as { number: number }[]) : [];
        out.push({ label: `${who ?? "The author"} has been merged before`, ok: before.length > 0, detail: before.length ? `#${before[0].number}` : "First pull request" });
      }
    }
    return out;
  }

  private async act(a: Extract<RoutineStep, { kind: "action" }>, ctx: Context, notes: string, cwd: string, threadId: string, r: Routine, rec: RoutineRun) {
    const n = ctx.subject?.number;
    const gh = (args: string[]) => run("gh", args, { cwd, env: this.env, timeout: 120000 }).then((x) => {
      if (x.code !== 0) throw new Error(x.stderr.trim().split("\n").pop() || `gh ${args[0]} failed`);
    });
    if (a.action === "merge") {
      if (!n || ctx.subject?.kind !== "pr") return false;
      const today = new Date().toDateString();
      const merged = this.runs.filter((x) => x.routineId === r.id && x.status === "merged" && new Date(x.at).toDateString() === today).length;
      if (merged >= r.limits.mergesPerDay) throw new Error(`Already merged ${merged} today, the most this routine may`);
      await gh(["pr", "merge", String(n), "--squash"]);
      return true;
    }
    if (a.action === "comment") {
      if (!n) return false;
      const body = a.arg?.trim() || (notes ? `Notes from the audit:\n${notes}` : "Thanks! An automated review found nothing to note.");
      await gh([ctx.subject?.kind === "issue" ? "issue" : "pr", "comment", String(n), "--body", body]);
      return true;
    }
    if (a.action === "label") {
      if (!n || !a.arg) return false;
      await gh([ctx.subject?.kind === "issue" ? "issue" : "pr", "edit", String(n), "--add-label", a.arg]);
      return true;
    }
    if (a.action === "close") {
      if (!n) return false;
      await gh([ctx.subject?.kind === "issue" ? "issue" : "pr", "close", String(n), "--comment", a.arg || "Closed by a routine."]);
      return true;
    }
    if (a.action === "inbox") {
      const why = rec.rules?.filter((x) => !x.ok).map((x) => `${x.label} (${x.detail ?? "no"})`).join("; ");
      const t = this.store.thread(threadId);
      this.store.putItem(threadId, { kind: "notice", id: uid("it"), turn: t.turns, at: Date.now(), text: `${r.name} handed this to you${why ? `: ${why}` : ""}.` });
      this.store.patchThread(threadId, { status: "waiting", unread: true, done: false });
      this.store.emit({ type: "notify", threadId, kind: "waiting", title: `${r.name} waits for you`, body: ctx.subject ? `#${ctx.subject.number} ${ctx.subject.title}` : t.title });
      return true;
    }
    this.store.emit({ type: "notify", threadId, kind: "done", title: r.name, body: a.arg || rec.cause });
    return true;
  }
}

function actionLabel(a: Extract<RoutineStep, { kind: "action" }>) {
  return a.action === "merge" ? "Squash and merge" : a.action === "comment" ? "Post the notes" : a.action === "label" ? `Add the label ${a.arg ?? ""}`.trim() : a.action === "close" ? "Close it" : a.action === "inbox" ? "Hand it to you" : "Tell you";
}
