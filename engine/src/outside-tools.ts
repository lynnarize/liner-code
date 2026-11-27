/*
  Liner MCP's tools at work (T3 Code's orchestrator MCP server), for both doors: Claude Code or Codex in a terminal,
  through a small MCP server on stdio (outside.ts), and apps on the internet through the app listener (mcp-http.ts). They
  list your projects and sessions, read one, start one, message it and wait for it, and read pull requests, issues and
  findings. It's off until you turn it on in Settings › Liner MCP; then a key in ~/.liner-code/outside.json, readable only
  by you, lets the stdio server in and nothing else. Which app may call what, and what waits for your Allow, is decided
  before a call gets here (mcp-apps.ts McpGate); here a call is only done, at the access it was handed.
*/
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Access, Item, SecurityFinding, Thread } from "../../contracts/src/index.ts";
import type { IssueItem, PrItem, WorklistResult } from "../../contracts/src/worklists.ts";
import type { McpLevel } from "../../contracts/src/mcp.ts";
import type { McpResult } from "./agent-tools.ts";
import type { Store } from "./store.ts";
import { titleForAgents, titleFrom } from "./memory.ts";

type Api = { call(method: string, params: unknown): Promise<unknown> };

const text = (t: string): McpResult => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): McpResult => ({ content: [{ type: "text", text: t }], isError: true });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A session's last few turns as an outside agent reads them: asks, answers, steps, and what waits on the person. */
export function readout(t: Thread, items: Item[], turns = 3, title = t.title) {
  const from = Math.max(1, t.turns - turns + 1);
  const lines = [`${title} · ${t.status}${t.status === "waiting" ? " (it asks the person something in Liner Code)" : ""} · ${t.turns} ${t.turns === 1 ? "turn" : "turns"}`];
  for (const it of items) {
    if (it.turn < from) continue;
    if (it.kind === "user") lines.push(`\nThe person: ${clip(it.text, 2000)}`);
    else if (it.kind === "text" && it.text.trim()) lines.push(`Agent: ${clip(it.text, 3000)}`);
    else if (it.kind === "tool") lines.push(`- ${it.title}${it.status === "failed" ? " (failed)" : it.status === "running" ? " (running)" : ""}`);
    else if (it.kind === "approval" && it.state === "asking") lines.push(`Waiting on the person: ${it.title}`);
    else if (it.kind === "question" && it.state === "asking") lines.push(`Waiting on the person: ${it.questions[0]?.question ?? "a question"}`);
    else if (it.kind === "proposal" && it.state === "asking") lines.push(`Waiting on the person to approve the plan: ${it.title}`);
    else if (it.kind === "checkpoint") lines.push(`Changed ${it.files.length} ${it.files.length === 1 ? "file" : "files"}: ${it.files.map((f) => `${f.path} +${f.added} −${f.removed}`).join(", ")}`);
    else if (it.kind === "review" && it.status !== "running") lines.push(`Reviewer: ${it.status}${it.findings.length ? `, ${it.findings.map((f) => `${f.file}${f.line ? `:${f.line}` : ""} ${f.note}`).join("; ")}` : ""}`);
    else if (it.kind === "error") lines.push(`Error: ${it.message}`);
    else if (it.kind === "limit") lines.push(`Out of usage: ${it.message}`);
  }
  return lines.join("\n");
}

/**
  How a call is done, from the gate (mcp-apps.ts). `access`: what a session it starts may do (Manual for an app that asks
  first, your default capped below Full for a trusted one). `startedBy`: the app, put on a session it starts. `waitMax`:
  how long liner_wait may hold the call, in seconds (an app on the internet goes through proxies that give up near a minute).
  `allowStart`: asked once the session is made and before its message goes; false takes the session away again.
*/
export type CallCtx = { access?: Access; startedBy?: Thread["startedBy"]; waitMax?: number; gone?: AbortSignal; appId?: string; allowStart?: (t: Thread, message: string) => Promise<boolean> };

/** How many lines a list sends at once: a cloud bot reads a page, then asks for the next with its cursor. */
const PAGE = 20;
function paged(lines: string[], cursor: unknown, empty: string, size = PAGE) {
  const from = Math.max(0, Math.floor(Number(cursor) || 0));
  const page = lines.slice(from, from + size);
  if (!page.length) return text(from ? "No more." : empty);
  const more = from + size < lines.length ? `\nNext cursor: ${from + size} (${lines.length - from - size} more)` : "";
  return text(`${page.join("\n")}${more}`);
}
/** An app's mark on a session once its start was answered: no longer waiting for your Allow. */
const settled = (s: NonNullable<Thread["startedBy"]>) => ({ appId: s.appId, name: s.name, kind: s.kind });
const unread = (r: WorklistResult<unknown>) => (r.unavailable.length ? `\nCouldn't read: ${r.unavailable.map((u) => `${u.project} (${u.why})`).join("; ")}` : "");

export class Outside {
  private key: string | null = null;
  private store: Store;
  private api: Api;
  /** Where the engine listens, set once its server is up. */
  url = "";
  /** Sessions sent a message that hasn't started yet, by the turn they were on: a send returns before its turn begins. */
  private sent = new Map<string, { turns: number; at: number }>();
  /**
    The effort a session an app starts runs at: its tool's usual one for its model (main.ts asks the runtime). Unset, the
    lead's own profile says, which for some (the Demo's Low) is a level its model doesn't have.
  */
  usualEffort?: (t: Thread) => string | undefined;
  /** Starts by an app's own id for them (liner_start clientRequestId), for a day: the same id again is the same session, not a second one. */
  private starts = new Map<string, { id: string; at: number; state: "waiting" | "started" | "refused" }>();

  constructor(store: Store, api: Api) {
    this.store = store;
    this.api = api;
  }

  get file() {
    return join(this.store.home, "outside.json");
  }

  get on() {
    return this.store.settings.outside === true;
  }

  /** What a terminal agent on stdio may do: Trusted unless you chose less (as before levels), never more. */
  get stdioLevel(): McpLevel {
    const l = this.store.settings.mcpStdioLevel;
    return l === "read" || l === "ask" ? l : "trusted";
  }

  /** On: a fresh key, and where the engine is, in outside.json for the MCP server to read. Off: the file goes. Run when it changes, and once the server is up. */
  apply() {
    if (this.on && this.url) {
      this.key = randomBytes(24).toString("hex");
      writeFileSync(this.file, JSON.stringify({ url: `${this.url}/outside`, key: this.key, level: this.stdioLevel }), { mode: 0o600 });
    } else {
      this.key = null;
      if (existsSync(this.file)) rmSync(this.file, { force: true });
    }
  }

  /** The level changed: the file says so without a new key, so a terminal agent already set up lists the right tools. */
  relevel() {
    if (this.on && this.url && this.key) writeFileSync(this.file, JSON.stringify({ url: `${this.url}/outside`, key: this.key, level: this.stdioLevel }), { mode: 0o600 });
  }

  allows(key: string) {
    if (!this.key || !key) return false;
    const a = Buffer.from(key);
    const b = Buffer.from(this.key);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  project(ref: unknown) {
    const s = String(ref ?? "").trim();
    const p = this.store.projects.find((x) => x.id === s || x.path === s || x.name.toLowerCase() === s.toLowerCase());
    if (!p) throw new Error(`No project "${s}". liner_projects lists them.`);
    return p;
  }

  /** The question a session asks the person now, in its own words, if it asks one (for liner_answer's card). */
  question(threadId: string) {
    const q = this.store.timeline(threadId).findLast((x) => x.kind === "question" && x.state === "asking");
    return q?.kind === "question" ? clip(q.questions[0]?.question ?? "", 200) : undefined;
  }

  thread(id: unknown) {
    const t = this.store.threads.find((x) => x.id === String(id ?? ""));
    if (!t) throw new Error(`No session "${String(id ?? "")}". liner_sessions lists them.`);
    return t;
  }

  async call(tool: string, args: Record<string, unknown>, ctx: CallCtx = {}): Promise<McpResult> {
    try {
      switch (tool) {
        case "liner_projects":
          return text(this.store.projects.map((p) => `${p.id} · ${p.name}${p.kind === "design" ? " (design)" : ""} · ${p.path}`).join("\n") || "No projects yet.");
        case "liner_sessions": {
          const p = args.project ? this.project(args.project) : null;
          const list = this.store.threads.filter((t) => !t.archived && !t.sideOf && (!p || t.projectId === p.id)).sort((a, b) => b.updatedAt - a.updatedAt);
          const lines = list.map((t) => `${t.id} · ${titleForAgents(this.store, t)} · ${this.store.projects.find((x) => x.id === t.projectId)?.name ?? "?"} · ${t.status}`);
          return paged(lines, args.cursor, "No sessions.", Math.min(50, Math.max(1, Number(args.limit) || PAGE)));
        }
        case "liner_read": {
          const t = this.thread(args.session);
          return text(readout(t, this.store.timeline(t.id), Math.min(10, Number(args.turns) || 3), titleForAgents(this.store, t)));
        }
        case "liner_pull_requests": {
          const p = args.project ? this.project(args.project) : null;
          const state = (["open", "closed", "merged", "all"] as const).find((x) => x === args.state) ?? "open";
          const r = (await this.api.call("worklists.prs", { ...(p ? { projectId: p.id } : {}), state })) as WorklistResult<PrItem>;
          const lines = r.items.map((x) => `#${x.number} · ${clip(x.title, 120)} · ${x.project} · ${x.state} · by ${x.author}${x.checks ? ` · checks ${x.checks.passed} passed, ${x.checks.failed} failed, ${x.checks.pending} running` : ""}`);
          const page = paged(lines, args.cursor, `No ${state === "all" ? "" : `${state} `}pull requests.`);
          return text(`${(page.content[0] as { text: string }).text}${unread(r)}`);
        }
        case "liner_issues": {
          const p = args.project ? this.project(args.project) : null;
          const state = (["open", "closed", "all"] as const).find((x) => x === args.state) ?? "open";
          const r = (await this.api.call("worklists.issues", { ...(p ? { projectId: p.id } : {}), state })) as WorklistResult<IssueItem>;
          const lines = r.items.map((x) => `${x.key} · ${clip(x.title, 120)} · ${x.project} · ${x.state}${x.labels.length ? ` · ${x.labels.map((l) => l.name).join(", ")}` : ""}`);
          const page = paged(lines, args.cursor, `No ${state === "all" ? "" : `${state} `}issues.`);
          return text(`${(page.content[0] as { text: string }).text}${unread(r)}`);
        }
        case "liner_findings": {
          const p = args.project ? this.project(args.project) : null;
          const all = (await this.api.call("security.findings.list", { ...(p ? { projectId: p.id } : {}), state: "open" })) as SecurityFinding[];
          const pr = args.pr === undefined ? undefined : Number(args.pr);
          const issue = args.issue === undefined ? undefined : String(args.issue).replace(/^#/, "");
          const of = all.filter((f) => (pr === undefined || (f.target?.kind === "pr" && f.target.number === pr)) && (issue === undefined || (f.target?.kind === "issue" && f.target.key.replace(/^#/, "") === issue)));
          const lines = of.map((f) => `${f.severity} · ${clip(f.title, 120)}${f.file ? ` · ${f.file}${f.line ? `:${f.line}` : ""}` : ""} · ${f.id}`);
          return paged(lines, args.cursor, "No open findings.");
        }
        case "liner_scan": {
          const p = this.project(args.project);
          const target = args.pr !== undefined ? { kind: "pr" as const, projectId: p.id, number: Math.floor(Number(args.pr)) } : args.issue !== undefined ? { kind: "issue" as const, projectId: p.id, key: String(args.issue).trim() } : null;
          if (!target || (target.kind === "pr" && !(target.number > 0)) || (target.kind === "issue" && !target.key)) return fail("Name the pull request (pr) or the issue (issue) to scan.");
          // The person's own reader, never one the app picks: a scan is always Read only, and who reads it is theirs to choose.
          const r = (await this.api.call("security.scanTarget", { target })) as { scanId: string; threadId: string };
          const name = target.kind === "pr" ? `#${target.number}` : target.key;
          return text(`Started a read only scan of ${name} in ${p.name} (session ${r.threadId}). liner_wait waits for it; liner_findings reads what it found.`);
        }
        case "liner_start": {
          const p = this.project(args.project);
          const message = String(args.message ?? "").trim();
          if (!message) return fail("Say what the session should do, as message.");
          const rid = typeof args.clientRequestId === "string" && args.clientRequestId ? `${ctx.appId ?? ""}\n${args.clientRequestId.slice(0, 200)}` : "";
          const now = Date.now();
          for (const [k, v] of this.starts) if (now - v.at > 86_400_000) this.starts.delete(k);
          const again = rid ? this.starts.get(rid) : undefined;
          // The same start asked again: said as it stands, waiting for the person's Allow, refused, or started.
          if (again?.state === "waiting") return text(`Still waiting for the person to allow it in Liner Code (session ${again.id}). Call liner_start again with the same clientRequestId to hear how it went.`);
          if (again?.state === "refused") return fail("The person didn't allow that start in Liner Code, so the session wasn't started.");
          if (again && this.store.threads.some((t) => t.id === again.id)) return text(`Already started ${again.id} for that clientRequestId. liner_wait waits for it.`);
          const agent = args.agent ? String(args.agent) : undefined;
          // Titled from its message at once, as a send would title it: while it waits for your Allow, its row says what it's for.
          const t = (await this.api.call("thread.create", { projectId: p.id, title: titleFrom(message), ...(agent ? { agent: agent.includes(":") && !agent.startsWith("@") ? `@${agent}` : agent } : {}), ...(ctx.access ? { access: ctx.access } : {}) })) as Thread;
          const effort = this.usualEffort?.(t);
          if (ctx.startedBy || effort) this.store.patchThread(t.id, { ...(ctx.startedBy ? { startedBy: ctx.startedBy } : {}), ...(effort ? { effort: effort as Thread["effort"] } : {}) });
          if (rid) this.starts.set(rid, { id: t.id, at: now, state: ctx.allowStart ? "waiting" : "started" });
          if (ctx.allowStart && !(await ctx.allowStart(t, message))) {
            // The app hung up while it waited: nobody said no, so the same id asks again next time.
            if (rid && ctx.gone?.aborted) this.starts.delete(rid);
            else if (rid) this.starts.set(rid, { id: t.id, at: now, state: "refused" });
            // Nothing was ever sent in it: it goes, rather than staying as an empty session you didn't ask for.
            const made = this.store.threads.find((x) => x.id === t.id);
            if (made && made.turns === 0) await this.api.call("thread.remove", { id: t.id }).catch(() => {});
            else if (made?.startedBy?.asks) this.store.patchThread(t.id, { startedBy: settled(made.startedBy) });
            return fail("The person didn't allow it in Liner Code, so the session wasn't started.");
          }
          if (rid) this.starts.set(rid, { id: t.id, at: now, state: "started" });
          const was = this.store.threads.find((x) => x.id === t.id);
          if (was?.startedBy?.asks) this.store.patchThread(t.id, { startedBy: settled(was.startedBy) });
          await this.api.call("thread.send", { id: t.id, text: message });
          this.sent.set(t.id, { turns: t.turns, at: Date.now() });
          return text(`Started ${t.id} in ${p.name}. liner_wait waits for it to finish; what it asks waits for the person in Liner Code.`);
        }
        case "liner_send": {
          const t = this.thread(args.session);
          const message = String(args.message ?? "");
          if (!message.trim()) return fail("Say what to tell the session, as message.");
          await this.api.call("thread.send", { id: t.id, text: message, mode: t.status === "running" ? "queue" : undefined });
          if (t.status !== "running" && t.status !== "waiting") this.sent.set(t.id, { turns: t.turns, at: Date.now() });
          return text(t.status === "running" ? "Queued: it goes when the turn that's running ends." : t.status === "waiting" ? "Sent, but the session is waiting on the person in Liner Code, so it may not go until they answer." : "Sent.");
        }
        case "liner_wait": {
          const t = this.thread(args.session);
          // Under 300 seconds on stdio: the outside fetch gives up when no headers come back by then (undici's headersTimeout).
          // An app on the internet gets less (ctx.waitMax): the proxies between give up on a quiet call near a minute.
          const max = ctx.waitMax ?? 240;
          const until = Date.now() + Math.min(max, Math.max(1, Number(args.seconds) || Math.min(120, max))) * 1000;
          // A session it just messaged is working, though its turn may take a moment to begin (a worktree being set up).
          const working = () => {
            const now = this.thread(t.id);
            const sent = this.sent.get(t.id);
            // Two minutes for a slow start: one that never comes (a message that waits in the queue) isn't a turn to wait on.
            return now.status === "running" || (now.status !== "waiting" && sent?.turns === now.turns && Date.now() - sent.at < 120_000);
          };
          while (Date.now() < until && working() && !ctx.gone?.aborted) await new Promise((r) => setTimeout(r, 1000));
          if (!working()) this.sent.delete(t.id);
          else if (ctx.waitMax !== undefined) {
            const now = this.thread(t.id);
            return text(`${titleForAgents(this.store, now)} is still working${now.doing ? ` (${now.doing.text})` : ""}. Call liner_wait again.`);
          }
          return text(readout(this.thread(t.id), this.store.timeline(t.id), 1, titleForAgents(this.store, this.thread(t.id))));
        }
        case "liner_answer": {
          const t = this.thread(args.session);
          const answer = String(args.answer ?? "").trim();
          if (!answer) return fail("Say the answer, as answer.");
          // A question only: an approval (may it run this, edit that) is never an app's to answer.
          const q = this.store.timeline(t.id).findLast((x) => x.kind === "question" && x.state === "asking");
          if (!q || q.kind !== "question") return fail("That session isn't asking a question. What it asks for permission stays the person's to answer in Liner Code.");
          if (q.questions.length !== 1) return fail("It asks several questions at once; the person answers those in Liner Code.");
          await this.api.call("question.answer", { threadId: t.id, itemId: q.id, answers: { [q.questions[0].question]: clip(answer, 4000) } });
          return text("Answered.");
        }
        case "liner_stop": {
          const t = this.thread(args.session);
          if (t.status !== "running") return text("It isn't working, so there was nothing to stop.");
          await this.api.call("thread.stop", { id: t.id });
          return text("Stopped.");
        }
        default:
          return fail(`Liner Code has no tool called ${tool}.`);
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }
}
