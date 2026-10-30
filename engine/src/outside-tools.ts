/*
  Liner Code for agents outside it (T3 Code's orchestrator MCP server): Claude Code or Codex in a
  terminal can list your projects and sessions, read one, start one, message it and wait for it,
  through a small MCP server on stdio (outside.ts). It's off until you turn it on in Settings;
  then a key in ~/.liner-code/outside.json, readable only by you, lets that server in and nothing
  else. A session started this way is like any other: what it may do is your default access, and
  what it asks waits for you in Liner Code.
*/
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Item, Thread } from "../../contracts/src/index.ts";
import type { McpResult } from "./agent-tools.ts";
import type { Store } from "./store.ts";

type Api = { call(method: string, params: unknown): Promise<unknown> };

const text = (t: string): McpResult => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): McpResult => ({ content: [{ type: "text", text: t }], isError: true });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A session's last few turns as an outside agent reads them: asks, answers, steps, and what waits on the person. */
export function readout(t: Thread, items: Item[], turns = 3) {
  const from = Math.max(1, t.turns - turns + 1);
  const lines = [`${t.title} · ${t.status}${t.status === "waiting" ? " (it asks the person something in Liner Code)" : ""} · ${t.turns} ${t.turns === 1 ? "turn" : "turns"}`];
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

export class Outside {
  private key: string | null = null;
  private store: Store;
  private api: Api;
  /** Where the engine listens, set once its server is up. */
  url = "";

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

  /** On: a fresh key, and where the engine is, in outside.json for the MCP server to read. Off: the file goes. Run when it changes, and once the server is up. */
  apply() {
    if (this.on && this.url) {
      this.key = randomBytes(24).toString("hex");
      writeFileSync(this.file, JSON.stringify({ url: `${this.url}/outside`, key: this.key }), { mode: 0o600 });
    } else {
      this.key = null;
      if (existsSync(this.file)) rmSync(this.file, { force: true });
    }
  }

  allows(key: string) {
    if (!this.key || !key) return false;
    const a = Buffer.from(key);
    const b = Buffer.from(this.key);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private project(ref: unknown) {
    const s = String(ref ?? "").trim();
    const p = this.store.projects.find((x) => x.id === s || x.path === s || x.name.toLowerCase() === s.toLowerCase());
    if (!p) throw new Error(`No project "${s}". liner_projects lists them.`);
    return p;
  }

  private thread(id: unknown) {
    const t = this.store.threads.find((x) => x.id === String(id ?? ""));
    if (!t) throw new Error(`No session "${String(id ?? "")}". liner_sessions lists them.`);
    return t;
  }

  async call(tool: string, args: Record<string, unknown>): Promise<McpResult> {
    try {
      switch (tool) {
        case "liner_projects":
          return text(this.store.projects.map((p) => `${p.id} · ${p.name} · ${p.path}`).join("\n") || "No projects yet.");
        case "liner_sessions": {
          const p = args.project ? this.project(args.project) : null;
          const list = this.store.threads
            .filter((t) => !t.archived && !t.sideOf && (!p || t.projectId === p.id))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, Math.min(50, Number(args.limit) || 20));
          return text(list.map((t) => `${t.id} · ${t.title} · ${this.store.projects.find((x) => x.id === t.projectId)?.name ?? "?"} · ${t.status}`).join("\n") || "No sessions.");
        }
        case "liner_read": {
          const t = this.thread(args.session);
          return text(readout(t, this.store.timeline(t.id), Math.min(10, Number(args.turns) || 3)));
        }
        case "liner_start": {
          const p = this.project(args.project);
          const message = String(args.message ?? "").trim();
          if (!message) return fail("Say what the session should do, as message.");
          const agent = args.agent ? String(args.agent) : undefined;
          const t = (await this.api.call("thread.create", { projectId: p.id, ...(agent ? { agent: agent.includes(":") && !agent.startsWith("@") ? `@${agent}` : agent } : {}) })) as Thread;
          await this.api.call("thread.send", { id: t.id, text: message });
          return text(`Started ${t.id} in ${p.name}. liner_wait waits for it to finish; what it asks waits for the person in Liner Code.`);
        }
        case "liner_send": {
          const t = this.thread(args.session);
          await this.api.call("thread.send", { id: t.id, text: String(args.message ?? ""), mode: t.status === "running" ? "queue" : undefined });
          return text(t.status === "running" ? "Queued: it goes when the turn that's running ends." : "Sent.");
        }
        case "liner_wait": {
          const t = this.thread(args.session);
          const until = Date.now() + Math.min(600, Math.max(1, Number(args.seconds) || 120)) * 1000;
          while (Date.now() < until && this.thread(t.id).status === "running") await new Promise((r) => setTimeout(r, 1000));
          return text(readout(this.thread(t.id), this.store.timeline(t.id), 1));
        }
        default:
          return fail(`Liner Code has no tool called ${tool}.`);
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }
}
