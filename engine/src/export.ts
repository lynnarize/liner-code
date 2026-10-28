/*
  A session as Markdown, to keep, share, or paste into a pull request: what you asked, the plans,
  what each agent said and did, the questions and approvals, what the Reviewer found, and each
  turn's diff. Reasoning stays out; so do pages the agent drew (their titles are in).
*/
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Item } from "../../contracts/src/index.ts";
import type { Store } from "./store.ts";

/** A diff bigger than this is cut, so one generated file doesn't swallow the export. */
const DIFF_MAX = 100_000;

/** A fence longer than any run of backticks in the text, so a diff with ``` in it stays fenced. */
const fence = (text: string) => "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));

export async function sessionMarkdown(store: Store, threadId: string, diff: (from: string, to: string) => Promise<string>) {
  const t = store.thread(threadId);
  const project = store.project(t.projectId);
  const name = (id: string) => {
    try {
      return store.agent(id).name;
    } catch {
      return id.replace(/^@/, "");
    }
  };
  const when = new Date(t.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const out: string[] = [`# ${t.title}`, "", `${project.name}${t.worktree ? ` · ${t.worktree.branch}` : ""} · started ${when} · ${t.turns} ${t.turns === 1 ? "turn" : "turns"}`];
  // Bullets (tools, approvals) run together; anything else starts a paragraph of its own.
  let listing = false;
  const para = (...lines: string[]) => {
    out.push("", ...lines);
    listing = false;
  };
  const bullet = (line: string) => {
    if (!listing) out.push("");
    out.push(line);
    listing = true;
  };

  for (const it of store.timeline(threadId) as Item[]) {
    switch (it.kind) {
      case "user":
        para(`## You${it.anchor ? `, on ${it.anchor.file}:${it.anchor.line}${it.anchor.endLine ? `–${it.anchor.endLine}` : ""}` : ""}${it.steer ? " (mid-turn)" : ""}`, "", it.text);
        break;
      case "turn":
        para(`## ${name(it.agent)}${it.model ? ` · ${it.model}` : ""}${it.planning ? " (planning)" : ""}${it.status === "stopped" ? " (stopped)" : ""}`);
        break;
      case "text":
        if (it.text.trim()) para(it.text.trim());
        break;
      case "tool":
        bullet(`- ${it.title}${it.status === "failed" ? " (failed)" : ""}`);
        break;
      case "plan":
        para(...it.entries.map((e) => `- [${e.status === "completed" ? "x" : " "}] ${e.title}`));
        break;
      case "proposal":
        para(`### Plan: ${it.title} (${it.state})`, "", it.plan.trim(), ...(it.note ? ["", `Your note: ${it.note}`] : []));
        break;
      case "question":
        para(...it.questions.map((q) => `**${q.question}** ${it.answers?.[q.question] ?? (it.state === "skipped" ? "(skipped)" : "(no answer)")}`));
        break;
      case "approval":
        bullet(`- Asked to ${it.title}: ${it.state}${it.reason ? ` (${it.reason})` : ""}`);
        break;
      case "review":
        para(`### The Reviewer, round ${it.round}: ${it.status}`, ...(it.summary ? ["", it.summary] : []), ...(it.findings.length ? ["", ...it.findings.map((f) => `- **${f.file}${f.line ? `:${f.line}` : ""}** (${f.severity}) ${f.note}`)] : []));
        break;
      case "checkpoint": {
        const state = it.reverted ? " (undone)" : it.committed ? ` (committed ${it.committed})` : "";
        const files = [...(it.done ?? []), ...it.files];
        para(`### Changes in turn ${it.turn}${state}`, "", ...files.map((f) => `- ${f.status === "renamed" && f.from ? `${f.from} → ${f.path}` : f.path} (${f.status}, +${f.added} −${f.removed})`));
        if (it.from && it.to) {
          let d = await diff(it.from, it.to);
          if (d.length > DIFF_MAX) d = `${d.slice(0, DIFF_MAX)}\n… (the rest of this diff is cut)`;
          if (d.trim()) {
            const f = fence(d);
            para(`${f}diff`, d.trimEnd(), f);
          }
        }
        break;
      }
      case "page":
        bullet(`- Showed a page: ${it.title}`);
        break;
      case "notice":
      case "error":
      case "limit":
        para(`> ${("text" in it ? it.text : it.message).split("\n").join("\n> ")}`);
        break;
    }
  }
  return `${out.join("\n").trim()}\n`;
}

/** Writes it to Downloads under the session's title (with a number when that's taken); the path. */
export function saveToDownloads(title: string, markdown: string) {
  const base = title.replace(/[\\/:*?"<>|\n]+/g, "-").trim().slice(0, 80) || "Liner Code session";
  const dir = join(homedir(), "Downloads");
  let path = join(dir, `${base}.md`);
  for (let n = 2; existsSync(path); n++) path = join(dir, `${base} ${n}.md`);
  writeFileSync(path, markdown);
  return path;
}
