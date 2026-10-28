/*
  Past sessions from Claude Code and Codex, brought in to carry on here. What was asked, said and
  done goes on the timeline (reasoning and tool output stay out), and the session keeps the tool's
  own id, so its next turn resumes that conversation where it left off.
  Claude Code keeps them in <config>/projects/<folder with every other character as ->/<id>.jsonl;
  Codex in <home>/sessions/YYYY/MM/DD/rollout-*.jsonl, each starting with its id and folder.
*/
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import type { ImportableSession, Item, ToolKind } from "../../contracts/src/index.ts";
import { uid } from "./store.ts";

type Json = Record<string, unknown>;
/** How many of each tool's latest sessions are looked through. */
const LATEST = 60;

const claudeDir = (env: NodeJS.ProcessEnv, cwd: string) => join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
const codexDir = (env: NodeJS.ProcessEnv) => join(env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** A file's first bytes, as lines: enough for a title without reading a long session whole. */
function head(file: string, bytes = 96 * 1024) {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString("utf8").split("\n");
  } finally {
    closeSync(fd);
  }
}
const parse = (line: string): Json | null => {
  try {
    return JSON.parse(line) as Json;
  } catch {
    return null;
  }
};
/** Words you wrote, not the tool's own wrappers (<command-name>, <environment_context>, caveats). */
const yours = (text: string) => Boolean(text.trim()) && !/^\s*(<[a-z_-]+>|Caveat:)/i.test(text);
const titleOf = (text: string) => {
  const line = text.trim().split("\n")[0];
  return line.length > 70 ? `${line.slice(0, 69).trimEnd()}…` : line;
};
const newest = (files: string[]) =>
  files
    .map((f) => ({ f, at: statSync(f).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .slice(0, LATEST);

function claudeText(m: Json | undefined) {
  const c = m?.content;
  if (typeof c === "string") return c;
  return Array.isArray(c) ? (c as Json[]).flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : [])).join("\n") : "";
}
function codexText(p: Json) {
  return Array.isArray(p.content) ? (p.content as Json[]).flatMap((b) => (typeof b.text === "string" ? [b.text] : [])).join("\n") : "";
}

/** The sessions either tool has for this folder, newest first, leaving out ones already here. */
export function importable(cwd: string, env: NodeJS.ProcessEnv, have: Set<string>): ImportableSession[] {
  const out: ImportableSession[] = [];
  const dir = claudeDir(env, real(cwd));
  if (existsSync(dir)) {
    for (const { f, at } of newest(readdirSync(dir).filter((n) => n.endsWith(".jsonl")).map((n) => join(dir, n)))) {
      const id = f.slice(f.lastIndexOf("/") + 1, -".jsonl".length);
      if (have.has(`claude:${id}`)) continue;
      let title = "";
      for (const o of head(f).map(parse)) {
        if (o?.type === "custom-title" && typeof o.customTitle === "string") title = o.customTitle;
        if (!title && o?.type === "user" && !o.isSidechain && !o.isMeta && yours(claudeText(o.message as Json))) title = titleOf(claudeText(o.message as Json));
      }
      if (title) out.push({ tool: "claude", id, title, at });
    }
  }
  const sessions = codexDir(env);
  if (existsSync(sessions)) {
    const files = (readdirSync(sessions, { recursive: true }) as string[]).filter((n) => /rollout-.*\.jsonl$/.test(n)).map((n) => join(sessions, n));
    const here = real(cwd);
    for (const { f, at } of newest(files)) {
      const lines = head(f).map(parse);
      const meta = lines.find((o) => o?.type === "session_meta")?.payload as Json | undefined;
      const id = typeof meta?.id === "string" ? meta.id : "";
      if (!id || typeof meta?.cwd !== "string" || real(meta.cwd) !== here || have.has(`codex:${id}`)) continue;
      const first = lines.find((o) => (o?.payload as Json | undefined)?.type === "message" && (o?.payload as Json).role === "user" && yours(codexText(o!.payload as Json)));
      if (first) out.push({ tool: "codex", id, title: titleOf(codexText(first.payload as Json)), at });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/** What a tool call did, in words, from Claude Code's tool and its input. */
function claudeTool(name: string, input: Json, cwd: string): { title: string; kind: ToolKind } {
  // Inside the project, from its root; anywhere else, in full.
  const rel = typeof input.file_path === "string" ? relative(cwd, input.file_path) : "";
  const file = typeof input.file_path === "string" ? (rel && !rel.startsWith("..") ? rel : input.file_path) : "";
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  switch (name) {
    case "Bash":
      return { title: `Run ${str("command").split("\n")[0].slice(0, 120)}`, kind: "exec" };
    case "Read":
      return { title: `Read ${file}`, kind: "read" };
    case "Edit":
    case "MultiEdit":
      return { title: `Edit ${file}`, kind: "edit" };
    case "Write":
      return { title: `Write ${file}`, kind: "write" };
    case "Grep":
    case "Glob":
      return { title: `Search for ${str("pattern")}`, kind: "search" };
    case "WebFetch":
    case "WebSearch":
      return { title: `${name === "WebFetch" ? "Fetch" : "Search the web for"} ${str("url") || str("query")}`, kind: "web" };
    case "Task":
    case "Agent":
      return { title: `${str("subagent_type") || "Subagent"}: ${str("description")}`, kind: "task" };
    default:
      return { title: name.replace(/^mcp__(\w+)__/, "$1 · "), kind: "other" };
  }
}

/** A session's timeline as Liner Code keeps one, with how many turns it had and its model. */
export function transcript(tool: "claude" | "codex", id: string, cwd: string, env: NodeJS.ProcessEnv) {
  let file = "";
  if (tool === "claude") file = join(claudeDir(env, real(cwd)), `${id}.jsonl`);
  else {
    const sessions = codexDir(env);
    const name = (readdirSync(sessions, { recursive: true }) as string[]).find((n) => n.endsWith(".jsonl") && n.includes(id));
    if (name) file = join(sessions, name);
  }
  if (!file || !existsSync(file)) throw new Error("That session isn't there any more.");
  const items: Item[] = [];
  let turn = 0;
  let model = "";
  let title = "";
  let started = 0;
  let inTurn = false;
  const at = (o: Json) => (typeof o.timestamp === "string" ? Date.parse(o.timestamp) : 0) || started || Date.now();
  const you = (text: string, when: number) => {
    turn++;
    inTurn = false;
    if (!title) title = titleOf(text);
    items.push({ kind: "user", id: uid("it"), turn, at: when, text });
  };
  const agentSays = (when: number) => {
    if (inTurn || !turn) return;
    inTurn = true;
    items.push({ kind: "turn", id: uid("it"), turn, at: when, agent: `@${tool}:${model || "default"}`, model: model || "default", status: "done" });
  };

  for (const o of readFileSync(file, "utf8").split("\n").map(parse)) {
    if (!o) continue;
    if (!started && typeof o.timestamp === "string") started = Date.parse(o.timestamp) || 0;
    if (tool === "claude") {
      if (o.type === "custom-title" && typeof o.customTitle === "string") title = o.customTitle;
      if (o.isSidechain || o.isMeta) continue;
      const m = o.message as Json | undefined;
      if (o.type === "user") {
        const text = claudeText(m);
        if (yours(text)) you(text, at(o));
      } else if (o.type === "assistant" && Array.isArray(m?.content)) {
        if (typeof m.model === "string" && !m.model.startsWith("<")) model = m.model;
        for (const b of m.content as Json[]) {
          if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
            agentSays(at(o));
            items.push({ kind: "text", id: uid("it"), turn, at: at(o), text: b.text, streaming: false });
          } else if (b.type === "tool_use" && typeof b.name === "string") {
            agentSays(at(o));
            const { title: what, kind } = claudeTool(b.name, (b.input as Json) ?? {}, real(cwd));
            items.push({ kind: "tool", id: uid("it"), turn, at: at(o), tool: b.name, toolKind: kind, title: what, status: "done" });
          }
        }
      }
    } else {
      const p = (o.payload as Json | undefined) ?? {};
      if (o.type === "turn_context" && typeof p.model === "string") model = p.model;
      if (o.type !== "response_item") continue;
      if (p.type === "message" && p.role === "user" && yours(codexText(p))) you(codexText(p), at(o));
      else if (p.type === "message" && p.role === "assistant" && codexText(p).trim()) {
        agentSays(at(o));
        items.push({ kind: "text", id: uid("it"), turn, at: at(o), text: codexText(p), streaming: false });
      } else if ((p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call") && turn) {
        agentSays(at(o));
        const args = parse(typeof p.arguments === "string" ? p.arguments : "") ?? ((p.action as Json | undefined) ?? {});
        const cmd = Array.isArray(args.command) ? (args.command as string[]).slice(-1)[0] : typeof args.cmd === "string" ? args.cmd : typeof args.command === "string" ? args.command : "";
        const name = typeof p.name === "string" ? p.name : "shell";
        items.push({ kind: "tool", id: uid("it"), turn, at: at(o), tool: name, toolKind: name === "apply_patch" ? "edit" : cmd ? "exec" : "other", title: name === "apply_patch" ? "Edit files" : cmd ? `Run ${cmd.split("\n")[0].slice(0, 120)}` : name, status: "done" });
      }
    }
  }
  return { items, turns: turn, model, title, started };
}
