/*
  Past sessions from Claude Code and Codex, brought in to carry on here. What was asked, said and
  done goes on the timeline (reasoning and tool output stay out), and the session keeps the tool's
  own id, so its next turn resumes that conversation where it left off.
  Claude Code keeps them in <config>/projects/<folder with every other character as ->/<id>.jsonl;
  Codex in <home>/sessions/YYYY/MM/DD/rollout-*.jsonl, each starting with its id and folder.
*/
import { closeSync, constants, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import type { ImportableSession, Item, RecentSession, ToolKind } from "../../contracts/src/index.ts";
import { outside } from "./exec.ts";
import { uid } from "./store.ts";

type Json = Record<string, unknown>;
/** How many of each tool's latest sessions are looked through. */
const LATEST = 60;

const claudeDir = (env: NodeJS.ProcessEnv, cwd: string) => join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
const codexDir = (env: NodeJS.ProcessEnv) => join(env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
/** A folder as the disk has it, links followed and each name in its own case (~/code/app is ~/code/App there), as api.ts's onDisk: the tools name their folders by the path they were started in, which is the disk's. */
const real = (p: string) => {
  try {
    return realpathSync.native(p);
  } catch {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  }
};

/** Fills `buf` from byte `from` on, each byte where it is in the file, as far as the file goes; how much of `buf` is filled. */
function readAt(fd: number, buf: Buffer, from: number) {
  let n = from;
  while (n < buf.length) {
    const got = readSync(fd, buf, n, buf.length - n, n);
    if (!got) break;
    n += got;
  }
  return n;
}

/**
  A file's first bytes, as lines: enough for a title without reading a long session whole. A first
  line longer than that (Codex's session_meta can carry its instructions whole) is read on to its
  end, 1 MB at most, and the same 96 KB after it. A file that can't be read, or is no plain file (a
  folder, a pipe that would never answer), has no lines: one session less, not none at all.
*/
function head(file: string, bytes = 96 * 1024, cap = 1024 * 1024) {
  let fd: number;
  try {
    // Never blocks on a pipe swapped in since the folder was read; one is turned away below, unread.
    fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch {
    return [];
  }
  try {
    if (!fstatSync(fd).isFile()) return [];
    let buf = Buffer.alloc(bytes);
    let n = readAt(fd, buf, 0);
    let end = buf.subarray(0, n).indexOf(10);
    while (end < 0 && n === buf.length && buf.length < cap) {
      const more = Buffer.alloc(Math.min(buf.length * 2, cap));
      buf.copy(more, 0, 0, n);
      buf = more;
      n = readAt(fd, buf, n);
      end = buf.subarray(0, n).indexOf(10);
    }
    if (end >= bytes && end + 1 + bytes > buf.length && n === buf.length) {
      const more = Buffer.alloc(end + 1 + bytes);
      buf.copy(more, 0, 0, n);
      buf = more;
      n = readAt(fd, buf, n);
    }
    return buf.subarray(0, n).toString("utf8").split("\n");
  } catch {
    return [];
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
/** Words you wrote, not the tool's own wrappers (<command-name>, <environment_context>, caveats, Codex's AGENTS.md, interrupt markers). */
const yours = (text: string) => Boolean(text.trim()) && !/^\s*(<[a-z_-]+>|Caveat:|# AGENTS\.md instructions for |\[Request interrupted by user)/i.test(text);
/** Liner Code's own one-off reads (a review, a commit message, a Desk answer), from before they stopped leaving transcripts. */
const linerOwn = (text: string) =>
  /^(You review a change another agent|You check another agent's work|You decide, for a person,|What was asked in the session:|Write the (commit message for these changes|pull request for this branch)|Someone is deciding on a coding session's work)/.test(text.trim());
const titleOf = (text: string) => {
  const line = text.trim().split("\n")[0];
  return line.length > 70 ? `${line.slice(0, 69).trimEnd()}…` : line;
};
type Dated = { f: string; at: number; size: number };
const newest = (files: string[]) =>
  files
    // A file the tool cleared away since the folder was read, a link to nothing, or a folder or pipe that only looks like a session, is one session less, not none at all.
    .flatMap((f): Dated[] => {
      try {
        const st = statSync(f, { throwIfNoEntry: false });
        return st?.isFile() ? [{ f, at: st.mtimeMs, size: st.size }] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, LATEST);

/**
  What a session file's head said, kept by its path while its time and size stay the same: the
  sidebar's Recent asks again each time the window comes back, and a session's first lines (its id,
  folder and first message) don't change once written. Cleared when it grows past HEADS_MAX.
*/
const heads = new Map<string, { at: number; size: number; v: unknown }>();
const HEADS_MAX = 4000;
function cachedHead<T>(d: Dated, read: () => T): T {
  const had = heads.get(d.f);
  if (had && had.at === d.at && had.size === d.size) return had.v as T;
  const v = read();
  if (heads.size >= HEADS_MAX) heads.clear();
  heads.set(d.f, { at: d.at, size: d.size, v });
  return v;
}

function claudeText(m: Json | undefined) {
  const c = m?.content;
  if (typeof c === "string") return c;
  return Array.isArray(c) ? (c as Json[]).flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : [])).join("\n") : "";
}
/**
  Codex's rollouts, as paths under its sessions folder, from a walk that stays inside it: a link
  (to a folder or a file) is never followed, so nothing outside the tree is read. A folder that
  can't be read is passed over.
*/
function rollouts(sessions: string, match: (name: string) => boolean) {
  const out: string[] = [];
  const dirs = [sessions];
  for (let dir = dirs.pop(); dir !== undefined; dir = dirs.pop()) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of entries) {
      if (d.isDirectory()) dirs.push(join(dir, d.name));
      else if (d.isFile() && match(d.name)) out.push(join(dir, d.name));
    }
  }
  return out;
}

/**
  The same walk as rollouts, with its listings and each file's time read off the engine's thread
  (Codex keeps every rollout ever, thousands after months), the newest LATEST plain files.
*/
async function newestRollouts(sessions: string, match: (name: string) => boolean): Promise<Dated[]> {
  const files: string[] = [];
  let dirs = [sessions];
  while (dirs.length) {
    const next: string[] = [];
    await Promise.all(
      dirs.map(async (dir) => {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const d of entries) {
          if (d.isDirectory()) next.push(join(dir, d.name));
          else if (d.isFile() && match(d.name)) files.push(join(dir, d.name));
        }
      }),
    );
    dirs = next;
  }
  const dated: Dated[] = [];
  // In batches, so a tree of thousands doesn't open thousands of requests at once.
  for (let i = 0; i < files.length; i += 256)
    for (const d of await Promise.all(
      files.slice(i, i + 256).map(async (f) => {
        try {
          const st = await stat(f);
          return st.isFile() ? { f, at: st.mtimeMs, size: st.size } : null;
        } catch {
          return null;
        }
      }),
    ))
      if (d) dated.push(d);
  return dated.sort((a, b) => b.at - a.at).slice(0, LATEST);
}

function codexText(p: Json) {
  return Array.isArray(p.content) ? (p.content as Json[]).flatMap((b) => (typeof b.text === "string" ? [b.text] : [])).join("\n") : "";
}

/** Claude Code's sessions for this folder (its real path), newest first, `max` at most, leaving out ones already here. */
function claudeSessions(here: string, env: NodeJS.ProcessEnv, have: Set<string>, max = Infinity): ImportableSession[] {
  const out: ImportableSession[] = [];
  const dir = claudeDir(env, here);
  if (!existsSync(dir)) return out;
  for (const d of newest(readdirSync(dir).filter((n) => n.endsWith(".jsonl")).map((n) => join(dir, n)))) {
    if (out.length >= max) break;
    const { f, at } = d;
    const id = basename(f, ".jsonl");
    if (have.has(`claude:${id}`)) continue;
    const h = cachedHead(d, () => {
      let title = "";
      let first = "";
      for (const o of head(f).map(parse)) {
        if (o?.type === "custom-title" && typeof o.customTitle === "string") title = o.customTitle;
        if (!first && o?.type === "user" && !o.isSidechain && !o.isMeta && !o.isCompactSummary && yours(claudeText(o.message as Json))) first = claudeText(o.message as Json);
      }
      return { title, first };
    });
    const first = h.first;
    let title = h.title;
    if (linerOwn(first)) continue;
    title ||= first && titleOf(first);
    if (title) out.push({ tool: "claude", id, title, at });
  }
  return out;
}

const ROLLOUT = (n: string) => /^rollout-.*\.jsonl$/.test(n);

/** Codex's sessions in any of these folders (real paths), newest first, each with its folder, leaving out ones already here. Its tree is walked once, whatever the number of folders. */
function codexSessions(heres: Set<string>, env: NodeJS.ProcessEnv, have: Set<string>): (ImportableSession & { cwd: string })[] {
  const sessions = codexDir(env);
  if (!heres.size || !existsSync(sessions)) return [];
  return codexOf(newest(rollouts(sessions, ROLLOUT)), heres, have);
}

/** Codex's newest rollouts, read for their id, folder and first message (each head once while it's unchanged). */
function codexOf(files: Dated[], heres: Set<string>, have: Set<string>): (ImportableSession & { cwd: string })[] {
  const out: (ImportableSession & { cwd: string })[] = [];
  // Each folder a rollout names is looked up on disk once, so it compares with the projects' own (real) spelling.
  const seen = new Map<string, string>();
  const onDisk = (p: string) => seen.get(p) ?? seen.set(p, real(p)).get(p)!;
  for (const d of files) {
    const h = cachedHead(d, () => {
      const lines = head(d.f).map(parse);
      const meta = lines.find((o) => o?.type === "session_meta")?.payload as Json | undefined;
      const first = lines.find((o) => (o?.payload as Json | undefined)?.type === "message" && (o?.payload as Json).role === "user" && yours(codexText(o!.payload as Json)));
      return { id: typeof meta?.id === "string" ? meta.id : "", cwd: typeof meta?.cwd === "string" ? meta.cwd : "", first: first ? codexText(first.payload as Json) : "" };
    });
    const cwd = h.cwd ? onDisk(h.cwd) : "";
    if (!h.id || !heres.has(cwd) || have.has(`codex:${h.id}`)) continue;
    if (h.first && !linerOwn(h.first)) out.push({ tool: "codex", id: h.id, title: titleOf(h.first), at: d.at, cwd });
  }
  return out;
}

/** The sessions either tool has for this folder, newest first, leaving out ones already here. */
export function importable(cwd: string, env: NodeJS.ProcessEnv, have: Set<string>): ImportableSession[] {
  const here = real(cwd);
  return [...claudeSessions(here, env, have), ...codexSessions(new Set([here]), env, have).map(({ cwd: _, ...x }) => x)].sort((a, b) => b.at - a.at);
}

/**
  The newest sessions either tool has across these projects, `n` at most, each with its project:
  Claude Code's folder of each project read for its newest `n`, and Codex's tree walked once for
  them all, off the engine's thread (newestRollouts). Ones already here are left out. For the
  sidebar's Recent, which asks again each time the window comes back.
*/
export async function recentSessions(projects: { id: string; path: string }[], env: NodeJS.ProcessEnv, have: Set<string>, n: number): Promise<RecentSession[]> {
  const byPath = new Map<string, string>();
  for (const p of projects) {
    const here = real(p.path);
    if (!byPath.has(here)) byPath.set(here, p.id);
  }
  const out: RecentSession[] = [];
  for (const [here, projectId] of byPath) for (const x of claudeSessions(here, env, have, n)) out.push({ ...x, projectId });
  const sessions = codexDir(env);
  const codex = byPath.size && existsSync(sessions) ? codexOf(await newestRollouts(sessions, ROLLOUT), new Set(byPath.keys()), have) : [];
  for (const { cwd, ...x } of codex) out.push({ ...x, projectId: byPath.get(cwd)! });
  return out.sort((a, b) => b.at - a.at).slice(0, n);
}

/** What a tool call did, in words, from Claude Code's tool and its input. */
function claudeTool(name: string, input: Json, cwd: string): { title: string; kind: ToolKind } {
  // Inside the project, from its root; anywhere else, in full.
  const rel = typeof input.file_path === "string" ? relative(cwd, input.file_path) : "";
  const file = typeof input.file_path === "string" ? (rel && !outside(rel) ? rel : input.file_path) : "";
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
  // A plain session id only: it names a file, and an empty one would match any rollout.
  if (!/^[\w-]{1,128}$/.test(id)) throw new Error("That session isn't there any more.");
  let file = "";
  if (tool === "claude") file = join(claudeDir(env, real(cwd)), `${id}.jsonl`);
  else {
    const sessions = codexDir(env);
    file = rollouts(sessions, (n) => n.endsWith(".jsonl") && n.includes(id))[0] ?? "";
  }
  // A plain file only: a folder can't be read, and a pipe would never answer.
  if (!file || !statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error("That session isn't there any more.");
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
      if (o.isSidechain || o.isMeta || o.isCompactSummary || o.isVisibleInTranscriptOnly) continue;
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
