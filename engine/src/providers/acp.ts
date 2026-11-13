/*
  Any agent that speaks the Agent Client Protocol (JSON-RPC over stdio): Hermes (`hermes acp`),
  OpenCode (`opencode acp`), Cursor (`cursor-agent acp`), Grok Build (`grok agent stdio`), Google's
  Antigravity CLI (`agy acp`), and any agent you add from the ACP registry or as a command of your
  own. The engine is the client: it
  answers the agent's permission requests with the approval card, and reads and writes files for
  it inside the project.
*/
import { existsSync, lstatSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, resolve, sep, win32, type PlatformPath } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Access, CommandInfo, ModelInfo, ProviderId, ProviderInfo, Question, ToolKind } from "../../../contracts/src/index.ts";
import { randomBytes } from "node:crypto";
import { closesOnExit, endAll, jsonLines, killTree, marked, markedPids, markFile, marking, RUN_ENV, run, spawn, THREAD_ENV, threadMark, versionOf, which, type Mark, type Proc } from "../exec.ts";
import { VERSION } from "../version.ts";
import { commandRisk, gitPlace, isDestructive, readsOnly, ruleFor, shellWords, unwrapped } from "../risk.ts";
import { linerTitle } from "../agent-tools.ts";
import { TOOLS } from "../liner-tools.ts";
import { acpCommands, acpModelRequest, acpModels, agyModels } from "./models.ts";
import { imageType, readUpTo } from "./attachments.ts";
import { goKeys, goUsage, hermesGoKey } from "./opencode-go.ts";
import { LINER_WAIT_SEC, ResumeFailed, saysOf, scrub, type OpenOptions, type Provider, type ProviderSession, type ToolUpdate, type TurnSink } from "./types.ts";
import type { Connection } from "../addons.ts";

type Json = Record<string, unknown>;
type Msg = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Json; result?: Json; error?: { code: number; message: string } };
/** How much of a tool's output the app gets, its end; the running output reaches it a few times a second (T3 Code: provider-acp runtimeModel.ts bounds it to a tail and coalesces too). */
const OUTPUT_MAX = 20000;
const OUTPUT_EVERY_MS = 250;
/** ACP's auth_required (T3 Code: AcpSessionRuntime.ts). */
const AUTH_REQUIRED = -32000;
type ToolCall = { toolCallId: string; title?: string; kind?: string; status?: string; content?: Json[]; locations?: { path: string }[]; rawInput?: unknown; rawOutput?: unknown; name?: unknown; _meta?: unknown };
/**
  The tool's own name where the agent gives one beside its title (Antigravity: "mcp_liner_design_frame", titled "Run
  mcp_liner_design_frame"), else its title. A call marked as an MCP call (_meta.is_mcp_tool_call, as Antigravity's ACP server
  marks one, naming its server and tool in its input: T3 Code, packages/provider-acp/src/server/runtimeModel.ts) reads as the wrapper.
*/
const nameOf = (call: ToolCall) => ((call._meta as Json | undefined)?.is_mcp_tool_call === true ? "call_mcp_tool" : typeof call.name === "string" && call.name ? call.name : call.title);

const KIND: Record<string, ToolKind> = { read: "read", edit: "edit", delete: "edit", move: "edit", search: "search", execute: "exec", think: "think", fetch: "fetch" };
/** What OpenCode's own rules keep back from reading by itself: .env files, not their examples. In any case: Windows and a Mac's disk find .ENV all the same. */
const SECRET = /\.env(?:\.(?!example$).*)?$/i;

/**
  OpenCode lets nearly everything through unless it's told otherwise, so it's told to ask, and the
  answer comes from session/request_permission, from the access level as it is by then: changing
  access mid-session holds, which rules fixed when it starts couldn't. "*" takes what nobody named
  here (a connection's tools, a tool it adds later). The names hold against an opencode.json, whose
  rule for a name this replaces whole; only its agents' own rules go on counting. Your allows are
  overridden that way on purpose, whatever they name, since the level decides. Your denies aren't: a deny in an
  opencode.json comes along, at every level, under `name*` for the reason `task*` is written so, a
  whole tool's or a pattern's within one. What only keeps its notes goes by itself, and so do Liner
  Code's tools, as they do in Claude Code: each by its name, since "liner_*" would take in any server
  called liner_something, and with it anything that server does.
  Subagents are off: OpenCode's ACP drops what a subagent's session asks (1.19.5: its permission
  handler knows only the sessions ACP opened, and no update says a running child's id), so one would
  wait for good at its first step, and nothing could hold it to an access level. "task*" says `task`
  where an opencode.json's own `task` couldn't: a name it has stays where it wrote it, ahead of "*",
  whose ask would then win. A command that runs as a subtask gets past it, so /review is brought into
  the main session (OPENCODE_REVIEW) and any other is stopped as it starts (SUBAGENT).
  (T3 Code: provider-opencode adapter.ts, openCodePermissionRules; there reads are allowed, here
  they ask so a link out of the project shows.)
  OpenCode 2 (2.3.0) reads none of OPENCODE_PERMISSION, only the `permission` of its config, which
  is why opencodeEnv puts these in OPENCODE_CONFIG_CONTENT too; it takes the old names for its new
  ones there (bash is shell, task is subagent, write and patch are edit) but not a name with a *,
  so `shell` and `subagent*` are said by their own names, and a deny of yours under either name
  stands under both (RENAMED). Its rules are a list where the last that fits wins, config after
  the agent's own, as `opencode debug agents` shows. Its `execute` (Code Mode: JavaScript that
  calls the other tools and fetches over HTTP) is off, by a deny: the call asks nothing itself, and
  what it does inside comes to session/request_permission as one opaque `execute` with its code,
  never as the tool or address it reaches; a tool of an MCP server, Liner Code's among them, would
  only be called that way. With Code Mode off, OpenCode offers every tool directly, as 1.x does
  (2.3.0: Tool.snapshot). (T3 Code drives OpenCode 2 over its HTTP API with a rule list per session,
  `shell` asked: provider-opencode v2/adapter.ts, sessionRules.)
*/
const OPENCODE_ASK = ["read", "glob", "grep", "edit", "bash", "shell", "external_directory", "webfetch", "websearch", "codesearch", "doom_loop"];
const OPENCODE_NOTES = ["list", "lsp", "question", "skill", "todowrite"];
/**
  OpenCode 2's own tools that change things without asking anything at all (2.3.0, its `opencode` namespace: worktree_create
  ran at Read only with no ask, seen), so an ask rule can't reach them and only a deny, which takes them off its list, can.
  `?` for the namespace's dot or underscore, whichever it matches by.
*/
const OPENCODE_UNASKED = ["opencode?worktree_*", "opencode?session_move", "opencode?schedule_*", "opencode?artifact_*", "opencode?watch_*"];
/** OpenCode 2's names for 1.x's tools, both ways: your deny under either holds under both. */
const RENAMED: Record<string, string> = { bash: "shell", shell: "bash", task: "subagent", subagent: "task" };
/** Liner Code's tools as OpenCode names them, its server's name and the tool's joined with _. */
const OPENCODE_LINER = TOOLS.map((t) => `liner_${t.name}`);
const isRules = (rule: unknown): rule is Json => typeof rule === "object" && rule !== null;
export const opencodeAsks = (yours: Json = {}, linerServer = true) => JSON.stringify(opencodeRules(yours, linerServer));
export function opencodeRules(yours: Json = {}, linerServer = true): Json {
  const named = Object.keys(yours).filter((name) => name !== "*");
  // Everything denied but what you named: that stays so, with what you named coming to the access level.
  const shut = yours["*"] === "deny";
  // Your allows too, by the names you gave them: one for a tool nobody listed here would stand otherwise, after a "*" of yours.
  const allowed = named.filter((name) => yours[name] !== "deny");
  const asked = shut ? allowed : [...OPENCODE_ASK, ...allowed];
  // Only with its server there, which takes the name from any other: without it (a one-off read), `liner_design` in your opencode.json would pass.
  // Liner Code's own tools go without a card. Most only reach this session's Browser, the Simulator, its timeline, or read Liner Design's canvas. Those that write (design_frame, design_node with html, design_built) only write inside .liner/designs/ of this folder, on a canvas the person is watching, with a copy kept each turn to go back to; the engine refuses them in a session that only reads (Read only, a side chat: plan mode and Codex's read-only sandbox are how those run), whatever the tool. design_picture, which spends money, asks on its own card.
  const free = [...(shut ? [] : OPENCODE_NOTES), ...(linerServer ? OPENCODE_LINER : [])];
  // A rule of patterns comes if it denies one, in your order, since the last that fits wins. What it allows is the level's to say,
  // and "*" only brings its denies: it's over every tool, so its "ask" would bury what goes by itself.
  const patterns = (name: string, rule: Json) => {
    const open = free.includes(name) ? "allow" : "ask";
    const each = Object.entries(rule).map(([pattern, action]) => [pattern, action === "allow" ? open : action]);
    return Object.fromEntries(name === "*" ? each.filter(([, action]) => action === "deny") : each);
  };
  const denied = Object.entries(yours).flatMap(([name, rule]): [string, unknown][] => {
    const names = RENAMED[name] ? [name, RENAMED[name]] : [name];
    if (rule === "deny") return name === "*" ? [] : names.map((n) => [`${n}*`, "deny"]);
    return isRules(rule) && Object.values(rule).includes("deny") ? names.map((n) => [`${n}*`, patterns(name, rule)]) : [];
  });
  return {
    "*": shut ? "deny" : "ask",
    ...Object.fromEntries(asked.map((name) => [name, "ask"])),
    ...Object.fromEntries(free.map((name) => [name, "allow"])),
    ...Object.fromEntries(denied),
    "execute*": "deny",
    ...Object.fromEntries(OPENCODE_UNASKED.map((name) => [name, "deny"])),
    "task*": "deny",
    "subagent*": "deny",
  };
}
/**
  /review as a step of the session it's in, which the access level holds: OpenCode's own runs as a
  subtask (see above). A command can't be changed by half, the whole config is refused without its
  template (1.19.5), so this says what OpenCode's review.txt says, with nothing a subagent would do.
*/
const OPENCODE_REVIEW = {
  description: "review changes [commit|branch|pr], defaults to uncommitted",
  subtask: false,
  template: [
    "You are a code reviewer. Review the changes and give actionable feedback. Report only: change nothing.",
    "Input: $ARGUMENTS",
    "With no input, review all uncommitted changes: `git diff`, `git diff --cached`, and `git status --short` for new files. For a commit hash, `git show` it. For a branch name, `git diff` it against HEAD with three dots. For a PR URL or number, `gh pr view` and `gh pr diff`.",
    "A diff alone isn't enough: read each changed file whole, and any conventions file (AGENTS.md, CONVENTIONS.md, .editorconfig).",
    "Look for bugs first: logic errors, missing guards, edge cases, race conditions, security issues, error handling that swallows failures. Then whether the change fits the codebase's patterns, performance only where it's plainly a problem, and any behaviour that changed, above all if it looks unintended.",
    "Review only what changed. Be certain before you call something a bug: investigate first, and don't invent hypothetical problems. What you can't verify, say you're not sure of. Don't flag style unless it clearly breaks the project's conventions.",
    "For each issue say plainly why it's a bug, how severe it is, and what it takes to happen. No flattery.",
  ].join("\n\n"),
};

/** What ends an OpenCode turn when its own rules can't: a subtask, which `task*` doesn't reach and would wait for good at its first step. */
const SUBAGENT = "This OpenCode command runs a subagent, which Liner Code can't hold to your access level, so it was stopped.";

/*
  Hermes sends agents off with its delegate_task tool. Over ACP all it carries of them is its own
  words: the call starts with "Delegating 3 tasks" and each task's goal (and role), and ends with
  "Delegation results", a block per task (Hermes: acp_adapter/tools.py, _start_delegate and
  _format_delegate_result). Each task becomes an agent row from those; its own steps never reach
  ACP, so a row says only the tools it used, once it's done.
*/
/** A delegate_task call that sends agents off (not its list, steer or stop actions). */
export const isDelegation = (title?: string) => /^delegate_task(?::|$)/.test(title ?? "") && !/^delegate_task:\s*(list|steer|stop)\b/i.test(title ?? "");
/** The tasks a delegation starts with: each goal, and its role when it has one. */
export function delegatedTasks(text: string, title?: string): { goal: string; role?: string }[] {
  const many = /^Delegating \d+ tasks/.test(text.trim());
  if (many) {
    const out: { goal: string; role?: string }[] = [];
    for (const line of text.split("\n")) {
      const m = /^\s*\d+\.\s+(.*?)(?:\s+\(([\w][\w -]*)\))?\s*$/.exec(line);
      if (m && m[1]) out.push({ goal: m[1], ...(m[2] ? { role: m[2] } : {}) });
    }
    if (out.length) return out;
  }
  const one = /^Delegating task:?\s*([\s\S]*)$/.exec(text.trim())?.[1]?.trim() || title?.replace(/^delegate_task:?\s*/, "").trim();
  return one ? [{ goal: one }] : [];
}
export type DelegateResult = { index: number; status: string; model?: string; role?: string; seconds?: number; summary?: string; error?: string; tools: string[] };
/** What a delegation sent back, task by task; null when it isn't Hermes's results (it was dispatched to the background, or failed whole). */
export function delegateResults(text: string): DelegateResult[] | null {
  if (!/^Delegation results:/.test(text.trim())) return null;
  const out: DelegateResult[] = [];
  let cur: DelegateResult | null = null;
  for (const line of text.split("\n")) {
    const head = /^\S+\s+Task (\d+|\?): (\w+)(?: \((.*)\))?\s*$/.exec(line);
    if (head) {
      const bits = (head[3] ?? "").split(", ").map((b) => b.trim()).filter(Boolean);
      const role = bits.find((b) => b.startsWith("role="))?.slice(5);
      const secs = bits.find((b) => /^\d+(\.\d+)?s$/.test(b));
      const model = bits.find((b) => b !== secs && !b.startsWith("role="));
      cur = { index: head[1] === "?" ? out.length : Number(head[1]) - 1, status: head[2], tools: [], ...(model ? { model } : {}), ...(role ? { role } : {}), ...(secs ? { seconds: Number.parseFloat(secs) } : {}) };
      out.push(cur);
      continue;
    }
    if (!cur || !line.trim()) continue;
    if (line.startsWith("Tools: ")) cur.tools = line.slice(7).replace(/\s*\(\+\d+\)$/, "").split(", ").filter(Boolean);
    else if (line.startsWith("Error: ")) cur.error = line.slice(7).trim();
    else cur.summary = cur.summary ? `${cur.summary}\n${line}` : line;
  }
  return out;
}
/** "researcher" is "Researcher"; no role, "Subagent". */
const roleName = (role?: string) => (role?.trim() ? role.trim().replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Subagent");
/**
  And a model that won't take no. OpenCode goes on after each refusal (continue_loop_on_deny, below), so
  with nobody there to press Stop one that keeps trying would go on for good, where a refusal used to end it.
*/
const REFUSALS = 10;
const REFUSED = `OpenCode kept trying steps that were refused, ${REFUSALS} in this turn, so Liner Code stopped it.`;

/** JSON as OpenCode's own files may write it, with comments and trailing commas; null when it won't parse. */
function jsonc(text: string) {
  // Strings go first and stay whole, so a // in a URL or a comma before a } in one is left alone.
  const STRING = String.raw`"(?:[^"\\]|\\.)*"`;
  const bare = text.replace(new RegExp(`${STRING}|//[^\\n]*|/\\*[\\s\\S]*?\\*/`, "g"), (m) => (m[0] === '"' ? m : "")).replace(new RegExp(`(${STRING})|,(\\s*[}\\]])`, "g"), (_, kept?: string, end?: string) => kept ?? end ?? "");
  try {
    const value = JSON.parse(bare) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
  } catch {
    return null;
  }
}

/** The folders OpenCode reads settings from for a project, in the order it merges them (1.19.5: ConfigPaths.projectFiles, directories). */
function opencodeFolders(cwd: string, env: NodeJS.ProcessEnv) {
  const home = env.HOME || homedir();
  const walk: string[] = [];
  for (let at = resolve(cwd); ; at = dirname(at)) {
    walk.unshift(at);
    if (existsSync(join(at, ".git")) || dirname(at) === at) break;
  }
  return { global: join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode"), walk, dots: [...walk, home].map((d) => join(d, ".opencode")) };
}

/** Two sets of rules as OpenCode merges its files: a later word for a name stands, and one name's patterns add up, each staying where it first came. */
function overlay(under: Json, over: Json) {
  const out = { ...under };
  for (const [name, rule] of Object.entries(over)) {
    const had = out[name];
    out[name] = isRules(had) && isRules(rule) ? { ...had, ...rule } : rule;
  }
  return out;
}

/**
  What your OpenCode settings say that Liner Code has to keep to: your permission rules, later files
  over earlier, and whether /review is your own. `tools: { x: false }`, the older way to say deny,
  counts too, under whatever `permission` says of the same name. A file that won't parse counts for
  nothing.
*/
function opencodeOwn(cwd: string, env: NodeJS.ProcessEnv, content: Json) {
  const { global, walk, dots } = opencodeFolders(cwd, env);
  const names = ["opencode.json", "opencode.jsonc"];
  const files = [join(global, "config.json"), ...names.map((n) => join(global, n)), ...(env.OPENCODE_CONFIG ? [env.OPENCODE_CONFIG] : []), ...walk.flatMap((d) => names.map((n) => join(d, n))), ...dots.flatMap((d) => names.map((n) => join(d, n)))];
  const read = (path: string) => {
    try {
      return jsonc(readFileSync(path, "utf8"));
    } catch {
      return null;
    }
  };
  const configs = [...files.map(read), content].filter((c) => c !== null);
  // OpenCode 2's own list form, `permissions: [{ action, resource, effect }]`, after `permission` as it reads them: only its denies count here.
  const listed = (c: Json) => (Array.isArray(c.permissions) ? (c.permissions as Json[]) : []).filter((r) => isRules(r) && r.effect === "deny" && typeof r.action === "string").reduce<Json>((out, r) => overlay(out, { [String(r.action)]: (r.resource ?? "*") === "*" ? "deny" : { [String(r.resource)]: "deny" } }), {});
  const rules = (c: Json) => overlay(typeof c.permission === "string" ? { "*": c.permission } : ((c.permission ?? {}) as Json), listed(c));
  const tools = Object.entries(Object.assign({}, ...configs.map((c) => c.tools)) as Json);
  const older = Object.fromEntries(tools.map(([name, on]) => [/^(?:write|edit|patch)$/.test(name) ? "edit" : name, on ? "allow" : "deny"]));
  const review = configs.some((c) => (c.command as Json | undefined)?.review) || [global, ...dots].some((d) => ["command", "commands"].some((f) => existsSync(join(d, f, "review.md"))));
  return { permission: overlay(older, configs.map(rules).reduce(overlay, {})), review };
}

/**
  What OpenCode is told for a session in `cwd`. OPENCODE_CONFIG_CONTENT comes last of its settings and
  may hold an endpoint's already, so it's added to. continue_loop_on_deny: OpenCode ends the whole turn
  on any refusal otherwise, and every step can be refused now: a Reviewer would lose its verdict, a
  routine the rest of its step, and a person's No the agent's chance to adapt. mcp_timeout: OpenCode gives
  up on an MCP call after a minute, and a sidekick's brief runs up to 10; the servers Liner Code hands over
  ACP carry no wait of their own, so this one setting is theirs, and it covers your add-on connections too.
  The rules go both ways: OPENCODE_PERMISSION for OpenCode 1.x, which lays it over everything, and the
  config's `permission` for 2.x, which reads only that (see opencodeRules), with the endpoint's provider
  and model kept beside them. 2.3.0 drops continue_loop_on_deny as an old setting, so there a refusal still
  ends the turn: ACP's reject carries no words it could go on with.
*/
export function opencodeEnv(cwd: string, env: NodeJS.ProcessEnv, linerServer = true) {
  const parsed = jsonc(env.OPENCODE_CONFIG_CONTENT || "{}");
  // One that won't parse: 1.x refused to start on it, but 2.3.0 starts as if it weren't there, with no rules
  // at all. Liner Code's own goes in its place, so the access level holds either way.
  if (!parsed) console.error("[opencode] OPENCODE_CONFIG_CONTENT in your environment isn't JSON, so Liner Code's own settings went in its place");
  const had = parsed ?? {};
  const { permission, review } = opencodeOwn(cwd, env, had);
  const rules = opencodeRules(permission, linerServer);
  const experimental = (had.experimental as Json | undefined) ?? {};
  // A longer wait given before stays: it's in milliseconds.
  const wait = Math.max(Number(experimental.mcp_timeout) || 0, LINER_WAIT_SEC * 1000);
  // 2.x reads a document's `permissions` list after its `permission`, so an allow left in it would win over these asks: only its denies
  // stay (they're in `rules` already, from opencodeOwn). Its `permission` is replaced outright, by rules that carry its denies and bring its allows to the level.
  const { permissions, ...kept } = had;
  const denies = Array.isArray(permissions) ? permissions.filter((r) => isRules(r) && r.effect === "deny") : [];
  const config = { ...kept, ...(denies.length ? { permissions: denies } : {}), permission: rules, experimental: { ...experimental, continue_loop_on_deny: true, mcp_timeout: wait }, ...(review ? {} : { command: { ...(had.command as Json | undefined), review: OPENCODE_REVIEW } }) };
  return { OPENCODE_PERMISSION: JSON.stringify(rules), OPENCODE_CONFIG_CONTENT: JSON.stringify(config) };
}

/** How long a turn's end waits for OpenCode to say what the turn used (opencodeTurnUsage); ~0.3 s warm, a few cold. */
export let OPENCODE_USAGE_MS = 4000;
/** For tests: a shorter wait. */
export const setOpencodeUsageMs = (ms: number) => void (OPENCODE_USAGE_MS = ms);

/** The way each OpenCode command reads a session: 1.x's `export --pure`, or 2.x's `session export --standalone` (opencodeTurnUsage). */
const EXPORTS = new Map<string, "pure" | "session">();
/** 2.x's root help, which it prints for a command it hasn't got (`export`), exiting 0. */
const NO_SUCH_COMMAND = /^USAGE\s*$[\s\S]*\bopencode <subcommand>/m;

/**
  What an OpenCode turn used, step by step from its own store: its ACP prompt result carries only the last step's
  tokens, and a stopped turn's none, so a turn of many steps read 10 to 30 times too low. `opencode export` is its
  documented way to read a session (it only reads; --pure leaves your plugins out, which this needs none of). OpenCode 2
  (2.3.0) has no `export` and prints its help for it: there it's `session export`, with --standalone so it reads the store
  itself rather than starting the background service (it starts no MCP server, ~0.3 s), and each message has its role as
  `type`, its time and tokens at its top. Which way a command takes is learnt once. The turn's steps are its session's
  assistant messages after its prompt (the first user message from `since` on). Input is the uncached part with the
  cache it wrote; output takes the reasoning. Cost isn't here: usage_update says it as it goes. Null when it can't say
  in time or in a form it knows, and the turn keeps ACP's numbers.
*/
export async function opencodeTurnUsage(cmd: string[], session: string | null | undefined, since: number, o: { cwd: string; env?: NodeJS.ProcessEnv }) {
  if (!session) return null;
  const started = Date.now();
  // The command it runs as, without its "acp": `opencode`, or whatever starts it.
  const at = cmd.lastIndexOf("acp");
  const [bin, ...pre] = at > 0 ? cmd.slice(0, at) : cmd.slice(0, 1);
  const key = [bin, ...pre].join("\0");
  // In a group of its own with no input, so one that doesn't exit (or a fake that speaks ACP whatever it's asked) is
  // ended with everything it started at the wait, and the turn ends then whatever its pipes do. Both ways share the wait.
  const read = (way: "pure" | "session") =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
      let stdout = "", stderr = "", over = false;
      let child: ChildProcessWithoutNullStreams;
      const args = way === "pure" ? ["export", "--pure", session] : ["session", "export", "--standalone", session];
      try {
        child = spawn(bin, [...pre, ...args], { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" }) as unknown as ChildProcessWithoutNullStreams;
      } catch (e) {
        return done({ code: null, stdout: "", stderr: e instanceof Error ? e.message : String(e) });
      }
      const end = (code: number | null, why = "") => {
        clearTimeout(timer);
        done({ code, stdout: over ? "" : stdout, stderr: why || stderr });
      };
      const timer = setTimeout(() => (killTree(child), end(null, `no answer in ${OPENCODE_USAGE_MS} ms`)), Math.max(0, OPENCODE_USAGE_MS - (Date.now() - started)));
      child.stdout.on("data", (d: Buffer) => {
        stdout += d;
        // A session too big to read in time isn't read at all.
        if (stdout.length > 128 * 1024 * 1024 && !over) (over = true), killTree(child);
      });
      child.stderr.on("data", (d: Buffer) => void (stderr = (stderr + d).slice(-2000)));
      child.on("error", (e) => end(null, e.message));
      child.on("close", (code) => end(code));
    });
  let way = EXPORTS.get(key) ?? "pure";
  let out = await read(way);
  if (way === "pure" && !out.stdout.includes("{") && NO_SUCH_COMMAND.test(out.stdout + out.stderr)) {
    way = "session";
    out = await read(way);
  }
  type Tokens = { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } };
  type Message = { info?: { role?: string; time?: { created?: number }; tokens?: Tokens }; type?: string; time?: { created?: number }; tokens?: Tokens };
  let messages: Message[] | undefined;
  try {
    const start = out.stdout.indexOf("{");
    const j = start >= 0 ? (JSON.parse(out.stdout.slice(start)) as { info?: { id?: string }; messages?: Message[] }) : null;
    if (j?.info?.id === session && Array.isArray(j.messages)) messages = j.messages;
  } catch {
    // not an export it knows
  }
  if (messages) EXPORTS.set(key, way);
  const role = (m: Message) => m.info?.role ?? m.type;
  // A second of slack: OpenCode stamps the prompt as it takes it, on the same clock.
  const from = messages?.findIndex((m) => role(m) === "user" && ((m.info ?? m).time?.created ?? 0) >= since - 1000) ?? -1;
  if (!messages || from < 0) {
    console.error(`[opencode] couldn't read what the turn used from \`opencode ${way === "pure" ? "export" : "session export"}\` (${out.code !== 0 ? `${out.code === null ? "" : `exit ${out.code}: `}${out.stderr.trim().split("\n").at(-1)?.slice(0, 160) ?? ""}` : "no such turn in it"}, ${Date.now() - started} ms): its last step's count stands`);
    return null;
  }
  const u = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  for (const m of messages.slice(from + 1)) {
    const t = role(m) === "assistant" ? (m.info ?? m).tokens : undefined;
    if (!t) continue;
    u.inputTokens += (t.input ?? 0) + (t.cache?.write ?? 0);
    u.outputTokens += (t.output ?? 0) + (t.reasoning ?? 0);
    u.cacheReadTokens += t.cache?.read ?? 0;
  }
  return u;
}

/**
  Which of Liner Code's tools a call is, by the name the agent gives it, and its own input: liner_design_show (OpenCode), liner.x
  or liner:x, and Hermes's mcp__editor_liner_<8 hex>__x, its name for a server handed over ACP, tagged per session. Hermes
  keeps those in a catalog the model calls through tool_call, so a call that comes wrapped in one is read for the one inside.
  By the list: a name that only looks like one of ours isn't.
  Antigravity (1.5.6) names a server handed over ACP mcp_liner_<tool>, beside its title ("Run mcp_liner_<tool>"), with a
  toolSummary of its own in the input. Its docs say it can also load a server's tools lazily, the model calling one through
  call_mcp_tool with the server and the tool named, so a call that comes that way is read for the one it names, on the server
  called exactly `liner` (its rules name one as mcp(liner/<tool>), which counts too).
*/
export function linerCall(title: string | undefined, raw: unknown, server?: string): { name: string; input: unknown } | undefined {
  // Handed over under a name of its own (Antigravity: liner_<tag>), Liner Code's server is known by that name alone, as agy writes
  // it (mcp_<name>_<tool>, mcp(<name>/<tool>), or call_mcp_tool naming it): a server of the person's called `liner` is theirs.
  if (server) return exactCall(server, title, raw);
  // Hermes titles some calls "<name>: <what it's about>" (mcp__editor_liner_<tag>__design_frame: Phone / Today): the name is what counts.
  const named = /^(?:(?:mcp__?)?liner(?:__|[_.:/])|mcp__editor_liner_[0-9a-f]{8}__)([a-z_]+)(?::\s.*)?$/s.exec(title ?? "")?.[1] ?? /^mcp\(liner\/([a-z_]+)\)$/.exec(title ?? "")?.[1];
  if (named) return TOOLS.some((t) => t.name === named) ? { name: named, input: withoutSummary(named, raw) } : undefined;
  if (isMcpWrap(title)) return fromWrap(raw, "liner");
  const calls = /^tool_call\b/.test(title ?? "") ? (raw as { calls?: { name?: unknown; arguments?: unknown }[] } | undefined)?.calls : undefined;
  // One call inside: several are one row the agent's, which no single tool of ours can stand for.
  if (!Array.isArray(calls) || calls.length !== 1 || typeof calls[0]?.name !== "string") return undefined;
  const inner = linerCall(calls[0].name, calls[0].arguments);
  return inner && /^tool_call\b/.test(calls[0].name) ? undefined : inner;
}

/** linerCall for a server handed over as `server`, by that exact name and no other. */
function exactCall(server: string, title: string | undefined, raw: unknown): { name: string; input: unknown } | undefined {
  const t = title ?? "";
  const rule = /^mcp\(([^()/]+)\/([a-z_]+)\)$/.exec(t) ?? /^([^()/\s]+)\/([a-z_]+)$/.exec(t);
  const named = t.startsWith(`mcp_${server}_`) ? t.slice(server.length + 5) : rule && rule[1] === server ? rule[2] : undefined;
  if (named !== undefined) return /^[a-z_]+$/.test(named) && TOOLS.some((x) => x.name === named) ? { name: named, input: withoutSummary(named, raw) } : undefined;
  return isMcpWrap(title) ? fromWrap(raw, server) : undefined;
}

/** The one tool of ours a call_mcp_tool names, on the server called exactly `server`, with its own input. */
function fromWrap(raw: unknown, server: string): { name: string; input: unknown } | undefined {
  const r = raw as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object" || Array.isArray(r)) return undefined;
  const field = (keys: readonly string[]) => keys.filter((k) => Object.hasOwn(r, k));
  const [named, tool, args] = [field(MCP_WRAP.server), field(MCP_WRAP.tool), field(MCP_WRAP.args)];
  // One of each: a call that names two servers, or two tools, is no one tool of ours.
  if (named.length !== 1 || tool.length !== 1 || args.length > 1 || r[named[0]] !== server) return undefined;
  const name = r[tool[0]];
  let input = args.length ? r[args[0]] : undefined;
  // Arguments as JSON text, as some models write them.
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return undefined;
    }
  }
  return typeof name === "string" && TOOLS.some((t) => t.name === name) ? { name, input: withoutSummary(name, input) } : undefined;
}

/**
  A call's input without the toolSummary Antigravity asks its model to add to every MCP tool's (a few words for its own row),
  which agy keeps for itself: the tool never takes it, so it's no part of what the call does.
*/
function withoutSummary(name: string, raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Object.hasOwn(raw, "toolSummary")) return raw;
  if (Object.hasOwn(TOOLS.find((t) => t.name === name)?.inputSchema.properties ?? {}, "toolSummary")) return raw;
  const { toolSummary: _summary, ...rest } = raw as Record<string, unknown>;
  return rest;
}

/**
  Antigravity's call_mcp_tool, by its title ("call_mcp_tool", or "call_mcp_tool: <what it's about>"), and the fields its input
  may name the server, the tool and the tool's own input by: the only fields an ask through it may carry for it to be ours.
*/
export const isMcpWrap = (title?: string) => /^call_mcp_tool(?::\s.*)?$/s.test(title ?? "");
export const MCP_WRAP = { server: ["server", "serverName", "server_name", "ServerName"], tool: ["tool", "toolName", "tool_name", "name", "ToolName"], args: ["arguments", "args", "input", "parameters", "Arguments"] } as const;
const MCP_WRAP_KEYS: readonly string[] = [...MCP_WRAP.server, ...MCP_WRAP.tool, ...MCP_WRAP.args, "toolSummary"];

/** The scalars of a YAML file by their dotted path ("timeouts.mcp.tool_call"): enough for a settings file, not YAML at large. */
function yamlScalars(text: string) {
  const out = new Map<string, string>();
  const stack: { indent: number; key: string }[] = [];
  for (const line of text.split("\n")) {
    const m = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*$/.exec(line.replace(/\s+#.*$/, ""));
    if (!m || /^\s*#/.test(line)) continue;
    const indent = m[1].length;
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    const path = [...stack.map((s) => s.key), m[2]].join(".");
    if (m[3]) out.set(path, m[3].replace(/^(["'])(.*)\1$/, "$2"));
    else stack.push({ indent, key: m[2] });
  }
  return out;
}

/**
  How long Hermes waits on one call to Liner Code's tools, in ms; null when nothing bounds it. Two limits hold, read from the
  config.yaml in its HERMES_HOME, which Liner Code only reads: the MCP call's own (timeouts.mcp.tool_call, 300 s unset) and
  any one tool's (timeouts.tools.sequential_call, unset the batch's: timeouts.tools.concurrent_batch, else
  HERMES_CONCURRENT_TOOL_TIMEOUT_S, else 420 s). 0 or less is no limit, and what isn't a number is passed over, as Hermes
  does (agent/deadline.py resolve_timeout; tools/mcp_tool_common.py; agent/tool_executor.py). An MCP server's own
  `timeout` doesn't count: the servers come over ACP, which carries none.
*/
export function hermesWait(env: NodeJS.ProcessEnv, read: (path: string) => string = (p) => readFileSync(p, "utf8")): number | null {
  const home = env.HERMES_HOME || join(env.HOME || homedir(), ".hermes");
  let config = new Map<string, string>();
  try {
    config = yamlScalars(read(join(home, "config.yaml")));
  } catch {
    // No config: the defaults hold.
  }
  const num = (v: string | undefined) => (v === undefined || v === "" || /^(true|false|yes|no|on|off)$/i.test(v) || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const batch = num(config.get("timeouts.tools.concurrent_batch")) ?? num(env.HERMES_CONCURRENT_TOOL_TIMEOUT_S) ?? 420;
  const limits = [num(config.get("timeouts.mcp.tool_call")) ?? 300, num(config.get("timeouts.tools.sequential_call")) ?? batch, batch].filter((s) => s > 0);
  return limits.length ? Math.min(...limits) * 1000 : null;
}

/** Where OpenCode saves a long output, for the agent to read back. */
const opencodeOutputs = (env: NodeJS.ProcessEnv) => join(env.XDG_DATA_HOME || join(env.HOME || homedir(), ".local", "share"), "opencode", "tool-output");

/** The file system, as far as telling where a path really goes needs it. A parameter, as the platform is, so Windows's rules can be tried anywhere. */
type Files = { real(path: string): string; lstat(path: string): unknown; exists(path: string): boolean };
const FILES: Files = { real: (path) => realpathSync.native(path), lstat: lstatSync, exists: existsSync };
const pathsOf = (platform: NodeJS.Platform) => (platform === "win32" ? win32 : posix);
/** Whether a path from a folder stays in it. */
const stays = (rel: string, paths: PlatformPath) => rel !== ".." && !rel.startsWith(`..${paths.sep}`) && !paths.isAbsolute(rel);
/** Another machine's, to Windows: \\host\share or //host/share, and its \\?\ and \\.\ forms. */
const remote = (path: string, platform: NodeJS.Platform) => platform === "win32" && /^[\\/]{2}/.test(path);

/**
  A path with its links followed, what doesn't exist yet kept as written; null when that can't be
  told, as for a link to nothing, which a write would follow out (T3 Code: provider-acp clientPolicy.ts).
*/
function realPath(path: string, paths: PlatformPath, files: Files) {
  const missing: string[] = [];
  const absent = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
  for (let at = path; ; at = paths.dirname(at)) {
    try {
      return paths.resolve(files.real(at), ...missing);
    } catch (e) {
      if (!absent(e)) return null;
    }
    try {
      files.lstat(at);
      return null;
    } catch (e) {
      if (!absent(e)) return null;
    }
    if (paths.dirname(at) === at) return null;
    missing.unshift(paths.basename(at));
  }
}

/** Whether a path is really in a folder, once its links are followed. */
export function inFolder(folder: string, path: unknown, platform = process.platform, files = FILES) {
  const paths = pathsOf(platform);
  const target = paths.resolve(folder, String(path));
  // Looking at another machine's path reaches it, and Windows signs in to it as you, all before any ask: it's outside
  // unseen, unless it's where the folder itself is. `\\host` alone doesn't resolve to one, so it's read as it came too.
  if ((remote(String(path), platform) || remote(target, platform)) && !stays(paths.relative(folder, target), paths)) return false;
  const root = realPath(folder, paths, files);
  const real = realPath(target, paths, files);
  if (!root || !real) return false;
  return stays(paths.relative(root, real), paths);
}

/**
  Whether a path lands in git's own folder, or on a file named HEAD (risk.ts, gitPlace), as said from the folder and once
  its links are followed (a link in the project to .git): a hook written there (`.git/hooks/pre-commit`) runs on the next
  `git commit`, which Auto runs. In the project for inFolder, and still never an edit that goes by itself below Full.
*/
export function gitInside(folder: string, path: unknown, platform = process.platform, files = FILES) {
  const paths = pathsOf(platform);
  const target = paths.resolve(folder, String(path));
  if (gitPlace(paths.relative(folder, target))) return true;
  const root = realPath(folder, paths, files);
  const real = realPath(target, paths, files);
  return Boolean(root && real && gitPlace(paths.relative(root, real)));
}

/** A .env file, by a path's last part as this platform splits it. */
export const secretFile = (path: string, platform = process.platform) => SECRET.test(pathsOf(platform).basename(path));

/** A path as a card shows it: from the folder, when it's in it. */
/**
  A title's path that leaves the project, said from the home folder (~/…) as the app says a path outside it, else whole:
  "File ../../../../Users/you/.gemini/brain/plan.md" from /tmp/p is "File ~/.gemini/brain/plan.md". One inside stays as it is.
*/
export function homeTitle(title: string, cwd: string, home: string, platform = process.platform) {
  const paths = pathsOf(platform);
  return title.replace(/(?:\.\.[\\/])+[^\s"'`]*/g, (p) => {
    const full = paths.resolve(cwd, p);
    if (stays(paths.relative(cwd, full), paths)) return p;
    const r = paths.relative(home, full);
    return r && stays(r, paths) ? `~/${r.split(paths.sep).join("/")}` : full;
  });
}

export function fromFolder(folder: string, path: string, platform = process.platform) {
  const paths = pathsOf(platform);
  const rel = paths.relative(folder, paths.resolve(folder, path));
  return rel && stays(rel, paths) ? rel : path;
}

/**
  Whether a word of a command that only reads leaves the project and what's handed to it. `~`, a
  variable and Windows's %VAR% can't be told, so they do. On a Mac a word that names nothing can't
  read anything, and is likely a pattern (`grep /api/`). Windows goes by the word alone: its Git Bash
  has paths of its own, /c/Users for C:\Users, and any other (/etc/hosts, /tmp/x) is in Git Bash's
  folder, not at C:\etc, so whether that exists says nothing.
*/
export function leaves(word: string, cwd: string, dirs: string[] = [], platform = process.platform, files = FILES) {
  const windows = platform === "win32";
  if (/^~|\$/.test(word) || (windows && /%[^%\s]+%/.test(word))) return true;
  const path = windows ? word.replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:/") : word;
  if (windows && /^\/(?![\\/])/.test(path)) return true;
  const full = remote(path, platform) ? path : pathsOf(platform).resolve(cwd, path);
  if ([cwd, ...dirs].some((d) => inFolder(d, full, platform, files))) return false;
  return windows || files.exists(full);
}

/**
  A mode that only reads: one named plan, architect, read(-only) or ask, by its last part (Copilot's ids
  are URLs, T3 Code: provider-acp adapter.ts, isAcpPlanModeId). Not one that says so in passing:
  "dontAsk" skips every question, the opposite of what Read only asks for, and "task" is no question.
*/
const readMode = (id: string) => /^(plan|architect|ask|read)([-_]?only)?(?![a-z])/i.test(id.slice(id.lastIndexOf("#") + 1));

/** The agent's modes, from a `mode` config option (ACP's newer way) or `modes` (T3 Code: provider-acp AcpSessionRuntime.ts, setMode). */
function modesOf(s: Json) {
  const options = (s.configOptions as Json[] | undefined) ?? [];
  const select = (category: string) => options.find((c) => c.category === category && (c.type === undefined || c.type === "select"));
  const option = select("mode") ?? select("collaboration_mode");
  if (option) {
    // A select's choices may come in groups.
    const ids = ((option.options as Json[] | undefined) ?? []).flatMap((c) => (Array.isArray(c.options) ? (c.options as Json[]) : [c])).map((c) => String(c.value));
    return { via: String(option.id), now: option.currentValue, ids };
  }
  const modes = s.modes as { currentModeId?: unknown; availableModes?: { id: string }[] } | undefined;
  return { via: undefined, now: modes?.currentModeId, ids: (modes?.availableModes ?? []).map((m) => m.id) };
}

/** A block of an agent's message as text: what isn't text leaves a mark (T3 Code: provider-acp runtimeModel.ts, acpContentBlockDisplayText). */
function blockText(c: unknown) {
  const b = (c ?? {}) as Json;
  const uri = typeof b.uri === "string" && !/^data:/i.test(b.uri) ? b.uri : "";
  switch (b.type) {
    case "text":
      return String(b.text ?? "");
    case "image":
    case "audio":
      return `[${b.type}${b.mimeType ? ` (${b.mimeType})` : ""}${uri ? `: ${uri}` : ""}]`;
    case "resource_link":
      return `[${b.title || b.name || "resource"}${uri ? `: ${uri}` : ""}]`;
    case "resource": {
      const r = (b.resource ?? {}) as Json;
      return typeof r.text === "string" ? r.text : `[binary resource${r.mimeType ? ` (${r.mimeType})` : ""}${r.uri ? `: ${r.uri}` : ""}]`;
    }
    default:
      return "";
  }
}

/** One field of an agent's form, in the shapes ACP has for a choice: oneOf or enum, items of anyOf or enum for several. */
type FormChoice = { const: string; title?: string; description?: string };
type FormField = { type?: string; title?: string; description?: string; enum?: string[]; oneOf?: FormChoice[]; items?: { enum?: string[]; anyOf?: FormChoice[] } };
type FormSchema = { properties?: Record<string, FormField>; required?: string[] };

/**
  A form an agent wants filled in, as the question card asks it, with what turns each answer back
  into the field's value. OpenCode's question tool comes this way, each question with a "<key>_custom"
  field for an answer of your own, which the card's Something else fills. (T3 Code: provider-acp
  adapter.ts, handleElicitation.)
*/
function formFields(message: string, schema: FormSchema | undefined) {
  const props = schema?.properties ?? {};
  return Object.entries(props)
    .filter(([key]) => !(key.endsWith("_custom") && props[key.slice(0, -"_custom".length)]))
    .map(([key, f]) => {
      const listed = f.oneOf ?? f.items?.anyOf ?? (f.enum ?? f.items?.enum)?.map((v): FormChoice => ({ const: v }));
      const choices: { label: string; value: string | boolean; description?: string }[] =
        f.type === "boolean" ? [{ label: "Yes", value: true }, { label: "No", value: false }] : (listed ?? []).map((c) => ({ label: c.title ?? c.const, value: c.const, description: c.description }));
      const question: Question = {
        question: f.description || f.title || message,
        header: f.title,
        multiSelect: f.type === "array" || undefined,
        options: choices.map(({ label, description }, i) => ({ label, description, suggested: i === 0 && /recommend/i.test(label + (description ?? "")) })),
      };
      return { key, type: f.type, custom: props[`${key}_custom`] ? `${key}_custom` : undefined, choices, question };
    });
}

/** The card's answers, by question, as the form's content. */
function formContent(fields: ReturnType<typeof formFields>, answers: Record<string, string>) {
  const content: Record<string, unknown> = {};
  for (const f of fields) {
    const said = answers[f.question.question];
    if (!said) continue;
    const choice = f.choices.find((c) => c.label === said);
    if (!choice && f.custom) content[f.custom] = said;
    else {
      const value = choice ? choice.value : f.type === "number" || f.type === "integer" ? Number(said) : said;
      content[f.key] = f.type === "array" ? [value] : value;
    }
  }
  return content;
}

class AcpSession implements ProviderSession {
  /** Files you allowed this turn, which a write of them needn't ask about again. */
  private granted = new Set<string>();
  /** Steps you've let go outside the project this turn: the step's own ask needn't say so again. */
  private reached = new Set<string>();
  /** Ends the turn under way and says why, for what OpenCode wouldn't end by itself; only its turns have one. */
  private cut: ((why: string) => void) | null = null;
  /** Steps refused this turn. */
  private refused = 0;
  private child: ChildProcessWithoutNullStreams | null = null;
  private seq = 1;
  /** Each request with the process it went to: one that ends fails only its own, never the next one's. */
  private pending = new Map<number | string, { resolve: (v: Json) => void; reject: (e: Error) => void; child: ChildProcessWithoutNullStreams | null }>();
  private session: string | undefined;
  private booting: Promise<void> | null = null;
  /** The session it was to load and couldn't (or can't load any): said once, so the runtime sends the conversation so far. */
  private lost: string | undefined;
  /** The agent takes images in a prompt (its promptCapabilities say so). */
  private images = false;
  /** The agent takes MCP servers by address too (its mcpCapabilities say http), not only commands. */
  private http = false;
  private sink: TurnSink | null = null;
  private signal: AbortSignal | null = null;
  private calls = new Map<string, ToolCall>();
  private canLoad = false;
  /** The session's cost as the agent last said it; unknown until it says, in a session loaded from before. */
  private spent: number | null = 0;
  /**
    Hermes's prompt result carries its session's counters, not the turn's (acp_adapter/gateway_session_meta.py, turn_usage):
    the last ones, so a turn counts what they grew by. Zero for a session it opened; null for one it loaded, whose
    first turn counts whole, as nothing says how much of that was before.
  */
  private counted: { input: number; output: number; reads: number } | null = { input: 0, output: 0, reads: 0 };
  /** The agent's own modes: its plan-like one Read only puts it in, the one it works in otherwise, and the config option that sets them, if one does. */
  private modes: { read?: string; work?: string; via?: string; ids?: string[] } = {};
  /** The mode it's in, as far as it said, or as it last switched. */
  private current: string | undefined;
  /** Its own mode for each access level, for an agent Liner Code knows (AcpSpec.modes): set at the start and at every change of level. */
  private levels: Partial<Record<Access, string>> | undefined;
  /** It has said this turn that Read only refused a step. */
  private readRefused = false;
  /** What it has said this turn. */
  private spoken = "";
  /** The calls refused this turn as work that would run on after it: they never ran. */
  private kept = new Set<string>();
  /** What Read only refused in the last turn, for the model to hear at the start of the next (agy ends its turn on a no). */
  private refusedLast = "";
  /** The access level the model was last told of in this process's conversation: none yet, after every start, resume or load. */
  private told: Access | undefined;
  /** What Liner Code ended at the end of the last turn, for the model to hear at the start of the next. */
  private endedLast = "";
  /** The marker everything this session's agent starts carries (exec.ts Mark), for an agent whose work outlives its turn. */
  private mark: Mark = { value: randomBytes(9).toString("hex") };
  /** The markers of the processes it started and hasn't closed yet (close ends what holds each, and removes it). */
  private marks: Mark[] = [];
  /** Its own processes as the turn started (its MCP servers, a language server): what is marked besides them at the end is the turn's. */
  private resident = new Set<number>();
  /**
    The name Liner Code's server goes to it under: `liner`, or one of its own (AcpSpec.tagged), which nothing of the person's can
    take: made new each time its process starts (spawnAt), a resume and a reload included, and kept nowhere, so no name a person
    could have read from an earlier session or from Liner Code's state is the one in use. Only this one is Liner Code's (ours).
  */
  private server: string;
  /** Its name was given (OpenOptions.mcpName), not made: kept as it is. */
  private named: boolean;
  /** The server name the model was last told of in this process's conversation (AcpSpec.tagged): none yet after every start. */
  private toldName: string | undefined;
  /** Its instructions go in its system prompt (AcpSpec.systemPrompt, and the agent says it takes them). */
  private system = false;
  /** It resumes a session without playing its history back (sessionCapabilities.resume). */
  private canResume = false;
  /** Starts checked against its gate: one closed while it was being checked doesn't start. */
  private epoch = 0;
  private gating = false;
  /** Its asks (permission, forms) open now: a prompt waiting on you isn't a quiet one. */
  private asking = 0;
  /** When it last said anything. */
  private heard = 0;
  /** It calls a connection's tools without asking (AcpSpec.unasked). */
  private unasked = false;
  /** The connections kept from it that the model was last told of, so a change is said once. */
  private toldHeld = "";
  /** Its thinking level as a config option (Antigravity's thought_level), and the levels it takes now. */
  private thought: { id: string; values: string[]; now?: string } | undefined;
  /** A mode it didn't switch to: tried again before the next prompt. */
  private wanted: string | undefined;
  /** The last mode asked for: how an earlier switch ends no longer matters once this one's on its way. */
  private lastMode: string | undefined;
  /** What it said while it started, with no turn to say it in yet. */
  private notes: string[] = [];
  /** Tools' output waiting for its next showing, by call. */
  private later = new Map<string, NodeJS.Timeout>();
  /** When each call's output last reached the app. */
  private shown = new Map<string, number>();
  /** Hermes's delegations this turn, by call: the tasks each started with, read off its first words. A call is only shown in its turn, so they go with it. */
  private delegations = new Map<string, { goal: string; role?: string }[]>();
  private pid: string;
  private stderr = "";
  private o: OpenOptions;
  private cmd: string[];
  /** The command that signs this agent in. */
  private login: string;
  /** It's OpenCode, whose subagents can't be answered for. */
  private opencode: boolean;

  /** What Liner Code knows of this agent's ways (AcpSpec): none of it for an agent you added. */
  private known: Known;

  constructor(o: OpenOptions, cmd: string[], login = "", opencode = false, pid = "acp", known: Known = {}) {
    this.o = o;
    this.cmd = cmd;
    this.login = login;
    this.opencode = opencode;
    this.pid = pid;
    this.known = known;
    this.levels = known.levels;
    this.unasked = Boolean(known.unasked);
    this.named = Boolean(o.mcpName);
    this.server = o.mcpName ?? (known.tagged ? newServerName() : "liner");
    // A session it loads may have been told before that the connections were kept from it: it hears where they stand now.
    if (this.unasked && o.resume && o.connections?.length) this.toldHeld = "?";
  }

  /**
    The connections this session hands the agent. One that calls a connection's tools without asking (AcpSpec.unasked) gets
    them only where Liner Code would let them run without a card anyway: at Full access, in a session that isn't a side chat
    (Claude Code and OpenCode bring a card for them at every other level, and the Reviewer's look at Auto). Elsewhere they
    stay out, and both you and the model are told.
  */
  private handed(o: Pick<OpenOptions, "access"> = this.o) {
    // One that takes no MCP server by address gets none of those at any level (Antigravity 1.5.6 says no http in its mcpCapabilities).
    const all = (this.o.connections ?? []).filter((c) => !this.unasked || c.stdio || this.http);
    return this.unasked && !(o.access === "full" && !this.o.side && !this.o.plain) ? [] : all;
  }
  /** The connections kept from it here, by name: for its level, and those it can't take at all (by address). */
  private held(o: Pick<OpenOptions, "access"> = this.o) {
    const given = new Set(this.handed(o).map((c) => c.name));
    const out = (this.o.connections ?? []).filter((c) => !given.has(c.name));
    const unreachable = (c: Connection) => this.unasked && !c.stdio && !this.http;
    return { level: out.filter((c) => !unreachable(c)).map((c) => c.name), http: out.filter(unreachable).map((c) => c.name) };
  }
  /** What the person is told of the connections kept from this session, or "". */
  private heldNotice() {
    const { level, http } = this.held();
    const bin = this.cmd[0];
    const one = (names: string[], a: string, b: string) => (names.length === 1 ? a : b);
    return [
      level.length ? `${one(level, "Your connection", "Your connections")} ${level.join(", ")} ${one(level, "isn't", "aren't")} in this session: ${bin} runs a connection's tools without asking, so Liner Code hands them over only at Full access${this.o.side ? ", and never to a side chat" : ""}.` : "",
      http.length ? `${one(http, "Your connection", "Your connections")} ${http.join(", ")} can't reach ${bin} at any level: it takes connections that run as a command on this Mac, not ones at an address.` : "",
    ].filter(Boolean).join(" ");
  }
  /** What the model is told of the same, or "". */
  private heldModelNote() {
    const { level, http } = this.held();
    const all = [...level, ...http];
    if (!all.length) return "";
    return `(Not in this session: ${all.join(", ")}, the person's own ${all.length === 1 ? "connection" : "connections"}.${level.length ? ` You'd call ${level.length === 1 ? "its" : "their"} tools without anyone being asked, so Liner Code hands ${level.length === 1 ? "it" : "them"} over only at Full access.` : ""}${http.length ? ` ${http.join(", ")} ${http.length === 1 ? "is" : "are"} reached at an address, which you don't take.` : ""} If the person asks for ${all.length === 1 ? "it" : "them"}, say so.)`;
  }

  /** The agent's own mode for an access level, where it offers it: none for an agent whose modes Liner Code doesn't know. */
  private levelModes(access: Access) {
    const id = this.levels?.[access];
    return id && (this.modes.ids ?? []).includes(id) ? [id] : [];
  }

  /** Puts the agent in its mode for `access`; false when it didn't take it. */
  private async toLevel(access: Access) {
    for (const id of this.levelModes(access)) {
      // A later change of level has its own switch on the way.
      if (this.o.access !== access) return true;
      if (id === this.current) return true;
      return this.setMode(id).then(() => true, () => false);
    }
    return true;
  }


  private send(m: Omit<Msg, "jsonrpc">) {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  }
  private request(method: string, params: Json): Promise<Json> {
    const id = this.seq++;
    const child = this.child;
    // No process to ask (it ended while starting, or between turns): an answer would never come, and the
    // start or the turn waiting on it would hang for good (as codex-server.ts does).
    if (!child || !child.stdin.writable) return Promise.reject(new Error(this.said() || `${this.cmd[0]} isn't running.`));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, child });
      this.send({ id, method, params });
    });
  }

  /** The end of its stderr, fit to show. */
  private said() {
    return scrub(this.stderr.trim().split("\n").slice(-3).join("\n"), this.o.env);
  }

  private boot() {
    const [bin] = this.cmd;
    if (!this.known.gate) {
      const path = which(bin, this.o.env);
      if (!path) throw new Error(`${bin} isn't installed.`);
      this.booting = this.handshake(this.spawnAt(path));
      return;
    }
    // One whose program Liner Code checks (AcpSpec.min) runs only the file that passed, checked again when it changes: a build
    // too old for ACP, or an editor's launcher of the same name, never starts.
    const epoch = ++this.epoch;
    this.gating = true;
    this.booting = this.known.gate(this.o.env).then(
      (path) => {
        this.gating = false;
        if (epoch !== this.epoch) throw new Error(`${bin} was closed while it started.`);
        return this.handshake(this.spawnAt(path));
      },
      (e) => {
        this.gating = false;
        throw e;
      },
    );
  }

  /** Starts the agent's process at `path`, in a process group of its own. */
  private spawnAt(path: string) {
    const [bin, ...args] = this.cmd;
    // A name of its own for Liner Code's server in each process (AcpSpec.tagged): handed over in session/new, load or resume
    // (mcpServers), and told to the model at the process's first turn (turn).
    if (this.known.tagged && !this.named) this.server = newServerName();
    // A process group of its own, so stopping it stops what it started too: an npx or uvx launcher's agent, its
    // commands (T3 Code: AcpSessionRuntime.ts spawns with ownDetachedProcessGroup).
    // Marked, for an agent whose work outlives its turn: what it starts keeps the marker once it has left its tree (endWork), in
    // its environment and as a file it holds open, handed over after its three pipes and closed here at once (exec.ts marking).
    // Not on Windows (exec.ts marked). A marker of its own for each process, so what a close is still ending can't be taken for
    // the next process's; its file is in this engine's own folder, so an engine that starts after this one died ends what holds it.
    if (this.known.endsWork) this.marks.push((this.mark = { value: randomBytes(9).toString("hex"), file: process.platform === "win32" ? undefined : markFile("run", randomBytes(9).toString("hex")) }));
    const env = this.known.endsWork ? { ...this.o.env, [RUN_ENV]: this.mark.value } : this.o.env;
    // Its session's marker too, for the Browser to know a dev server it starts as the session's (surfaces.ts).
    const thread = this.o.env[THREAD_ENV];
    const { stdio, done } = marking(["pipe", "pipe", "pipe"], [...(this.known.endsWork ? [this.mark] : []), ...(thread ? [threadMark(thread)] : [])]);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(path, args, { cwd: this.o.cwd, env, stdio: stdio as ["pipe", "pipe", "pipe"], detached: true }) as ChildProcessWithoutNullStreams;
    } finally {
      done();
    }
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => (this.stderr = (this.stderr + d).slice(-4000)));
    // A process stopped after Stop's wait can still talk while the next one works: what it says is nobody's now.
    jsonLines(child.stdout, (v) => void (this.child === child && this.onMessage(v as Msg)));
    const fail = (err: Error) => {
      // A process stopped after Stop's wait can end once the next turn has started another: only what was
      // asked of this one fails (T3 Code: AcpSessionRuntime.ts keeps each process's requests its own).
      for (const [id, p] of this.pending)
        if (p.child === child) {
          this.pending.delete(id);
          p.reject(err);
        }
    };
    // It didn't start (a project folder that's gone): without a listener this throws, and "close" never comes.
    let unstarted = "";
    child.on("error", (e) => (unstarted ||= existsSync(this.o.cwd) ? e.message : `${this.o.cwd} isn't there any more.`));
    // An agent that stopped reading never answers what's written to it.
    child.stdin.on("error", (e) => fail(new Error(this.said() || `${bin} stopped reading: ${e.message}`)));
    // What it left behind (an MCP server, a command) goes with it, and lets go of the pipes "close" waits for.
    // Its group only: it has exited itself, so killTree's way for a group that's gone (its bare pid, SIGKILLed 2 s on) could
    // reach another process given that pid meanwhile. A group that's gone too left nothing behind.
    if (process.platform !== "win32")
      child.on("exit", () => {
        const group = child.pid;
        if (!group) return;
        try {
          process.kill(-group, "SIGTERM");
        } catch {
          return;
        }
        // One that ignores it would go on working beside whatever starts next (exec.ts killTree's 2 s).
        setTimeout(() => {
          try {
            process.kill(-group, "SIGKILL");
          } catch {
            // it went when it was asked
          }
        }, 2000).unref();
      });
    closesOnExit(child);
    child.on("close", (code) => {
      fail(new Error(this.said() || unstarted || `${bin} exited with ${code}.`));
      if (this.child !== child && this.child) return;
      this.child = null;
      this.booting = null;
    });
    return child;
  }

  /**
    Liner Code's instructions for this session as Antigravity takes them (AcpSpec.systemPrompt): added to its system prompt
    when a session starts, loads or resumes, and sent again each time, since it keeps none of it from one process to the next
    (T3 Code: apps/server/src/provider/acp/AntigravityAcpSupport.ts, antigravitySessionMeta, MIT). With the soul goes what the
    session's access level lets through, so the model doesn't try what will be refused.
  */
  private sessionMeta() {
    if (!this.system) return {};
    // Only what holds for the session's whole life: agy keeps the system prompt it started with across a resume, so the level
    // and the connections it has, which change, go in the conversation instead (turn), each time the model would be wrong.
    // No server name in it: agy keeps the system prompt a session first had across a resume, and the name is new in each process.
    const append = [this.known.endsWork ? standingNote(this.cmd[0], this.known.tagged ? "liner_<tag>" : this.server) : "", this.o.soul].filter(Boolean).join("\n\n");
    return { _meta: { antigravity: { systemPrompt: { append } } } };
  }

  private handshake(child: ChildProcessWithoutNullStreams) {
    return (async () => {
      const init = await this.request("initialize", {
        protocolVersion: 1,
        // Forms: an agent only asks what a client says it can show. OpenCode's question tool is dropped without it
        // (T3 Code: provider-acp adapter.ts). Writes: an agent told Liner Code writes files for it may send whole files
        // instead of its own edits with their diffs (T3 Code: AntigravityAcpSupport.ts), so Antigravity isn't told so.
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: !this.known.noWrites }, terminal: false, elicitation: { form: {} } },
        clientInfo: { name: "liner-code", title: "Liner Code", version: VERSION },
      });
      const caps = init.agentCapabilities as Json | undefined;
      // A process that starts, resumes or loads hears its level, and its tools' names, again at its first turn: nothing it was
      // told before may stand.
      this.told = undefined;
      this.toldName = undefined;
      this.canLoad = Boolean(caps?.loadSession);
      // Resume opens a session where it was without playing its history back (T3 Code: AntigravityAdapterV2.ts).
      this.canResume = Boolean((caps?.sessionCapabilities as Json | undefined)?.resume);
      this.images = Boolean((caps?.promptCapabilities as Json | undefined)?.image);
      this.http = Boolean((caps?.mcpCapabilities as Json | undefined)?.http);
      const own = ((caps?._meta as Json | undefined)?.antigravity as Json | undefined)?.systemPrompt as Json | undefined;
      this.system = Boolean(this.known.systemPrompt && own?.append);
      let s: Json | null = null;
      if (this.o.resume && (this.canResume || this.canLoad)) {
        const params = { sessionId: this.o.resume, cwd: this.o.cwd, mcpServers: this.mcpServers(), ...this.sessionMeta() };
        s = await this.request(this.canResume ? "session/resume" : "session/load", params).catch(() => null);
        // An agent that says it resumes and won't for this one may still load it.
        if (!s && this.canResume && this.canLoad) s = await this.request("session/load", params).catch(() => null);
        if (s) {
          this.session = this.o.resume;
          this.spent = null;
          this.counted = null;
          // A session it loads already holds its instructions, from the turn that first sent them (or its system prompt, sent again above).
          this.soulSent = true;
          // It couldn't a start ago (the process went), and can now.
          if (this.lost === this.o.resume) this.lost = undefined;
        }
      }
      if (!s) {
        // A session it can't load (or an agent that loads none) starts knowing nothing: the runtime is told,
        // not left to think it resumed (T3 Code: ProviderTurnStartService.ts, its resume fallback).
        if (this.o.resume) this.lost = this.o.resume;
        s = await this.request("session/new", { cwd: this.o.cwd, mcpServers: this.mcpServers(), ...this.sessionMeta() });
        this.session = String(s.sessionId);
        // Started again after its process ended, it loads this session rather than the one it opened with.
        this.o.resume = this.session;
        this.spent = 0;
        this.counted = { input: 0, output: 0, reads: 0 };
        if (this.system) this.soulSent = true;
      }
      // The models it names as bases ("gemini-3.8-flash"), for reading its list of models by them (agyModels).
      const option = ((s.configOptions as Json[] | undefined) ?? []).find((c) => c.category === "model" || c.id === "model");
      if (option) FAMILIES.set(this.pid, ((option.options as Json[] | undefined) ?? []).flatMap((c) => (Array.isArray(c.options) ? (c.options as Json[]) : [c])).map((c) => String(c.value)));
      // A loaded session gets the model and the mode too: a model you switched to reopens the session to
      // load it, on the model it had (T3 Code: provider-acp adapter.ts sets the model after start or load).
      // A model picked in Liner Code, through whichever way this agent takes one.
      const pick = acpModelRequest(s, this.session!, this.o.model);
      // No turn to say it in yet: the turn says it once the agent is up.
      this.readThought(s);
      if (pick) {
        const r = await this.request(pick.method, pick.params).catch(() => void this.notes.push(this.known.noModel?.(this.o.model) ?? `${this.cmd[0]} didn't switch to ${this.o.model}; it runs on its own default.`));
        // The model's own thinking levels, which a switch of model can change.
        if (r) this.readThought(r);
      }
      await this.toEffort(this.o.effort);
      const held = this.heldNotice();
      if (held) this.notes.push(held);
      // Read only maps onto a plan-like mode where the agent offers one. The mode it works in otherwise is kept to
      // go back to, and a session loaded in the plan-like mode goes back to it (T3 Code: provider-acp adapter.ts,
      // nativeBuildConfigurationBySessionId).
      const { via, now, ids } = modesOf(s);
      const read = ids.find(readMode);
      this.modes = { read, via, work: typeof now === "string" && now !== read ? now : ids.find((m) => m !== read), ids };
      this.current = typeof now === "string" ? now : undefined;
      // An agent Liner Code knows the modes of goes into the level's own, whatever its settings start it in.
      if (this.levelModes(this.o.access).length) {
        if (!(await this.toLevel(this.o.access))) this.wanted = this.levelModes(this.o.access)[0];
      } else {
        const want = this.o.access === "read" ? read : read && now === read ? this.modes.work : undefined;
        this.wanted = want === now ? undefined : want;
        if (this.wanted) await this.setMode(this.wanted).catch(() => {});
      }
    })().catch((e) => {
      // Failed with the process up (an agent signed out, say): the next turn starts again, rather than
      // standing on this failure for good (T3 Code: CodexAdapterV2.test.ts, "retries initialize after a failed handshake").
      if (this.child === child) this.close();
      throw e;
    });
  }

  /** Switches the agent's own mode, its way; what fails stays wanted, for the next prompt to try. */
  private async setMode(id: string) {
    const { via } = this.modes;
    this.lastMode = id;
    try {
      await this.request(via ? "session/set_config_option" : "session/set_mode", via ? { sessionId: this.session, configId: via, value: id } : { sessionId: this.session, modeId: id });
      this.current = id;
      // Any mode still wanted is one it has moved on from: a failed switch to read mode mustn't come back in Edits.
      if (this.lastMode === id) this.wanted = undefined;
    } catch (e) {
      // Wanted only once it's failed: one still on its way needn't be sent again, or waited for.
      if (this.lastMode === id) this.wanted = id;
      throw e;
    }
  }

  /** Liner Code's own tools and your connections, as ACP takes MCP servers. */
  private mcpServers() {
    return acpMcp({ ...this.o, mcpName: this.server }, this.handed(), this.http);
  }

  /** The thinking option a session's answer lists (category thought_level), as it is now. */
  private readThought(r: Json | null | undefined) {
    const option = ((r?.configOptions as Json[] | undefined) ?? []).find((c) => c.category === "thought_level" && (c.type === undefined || c.type === "select"));
    if (!option) return;
    const values = ((option.options as Json[] | undefined) ?? []).flatMap((c) => (Array.isArray(c.options) ? (c.options as Json[]) : [c])).map((c) => String(c.value));
    this.thought = { id: String(option.id), values, now: typeof option.currentValue === "string" ? option.currentValue : undefined };
  }

  /** The level it thinks at when it has none like the session's effort (the thread's effortNow), as far as it said; else undefined. */
  private effortGap() {
    const t = this.thought;
    const effort = this.o.effort;
    return t && effort && !t.values.includes(effort) && t.now && t.now !== effort ? t.now : undefined;
  }

  /** Puts its thinking at the session's effort, where it has that level: Liner Code's effort picker is its thinking level. */
  private async toEffort(effort: string | undefined) {
    const t = this.thought;
    if (!t || !effort || !this.session || t.now === effort) return;
    if (!t.values.includes(effort)) {
      this.notes.push(`${this.cmd[0]} has no “${effort}” thinking level for this model, so it thinks at its own (${t.now ?? "its default"}).`);
      return;
    }
    const r = await this.request("session/set_config_option", { sessionId: this.session, configId: t.id, value: effort }).catch(() => null);
    if (r) {
      t.now = effort;
      this.readThought(r);
    } else this.notes.push(`${this.cmd[0]} didn't switch its thinking to ${effort}.`);
  }

  /**
    ACP gives a session its MCP servers as it starts or loads (session/new, session/load) and has no
    way to add one after: a session under way gets new connections by being reopened for its next
    turn, loading where it was. One not started yet just takes them.
  */
  async connect(connections: Connection[]) {
    if (this.child) return false;
    this.o.connections = connections;
    return true;
  }

  private async onMessage(m: Msg) {
    this.heard = Date.now();
    // A reply to something we asked.
    if (m.id !== undefined && !m.method) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.code === AUTH_REQUIRED && this.login ? `${m.error.message} Sign in with \`${this.login}\`, then try again.` : m.error.message));
      else p.resolve((m.result ?? {}) as Json);
      return;
    }
    const params = m.params ?? {};
    if (m.method === "session/update") {
      // History session/load replays, which some agents (Grok Build) send after its answer: it's on the timeline already (T3 Code: provider-acp runtimeModel.ts, sessionUpdateIsReplay).
      if ((params._meta as Json | undefined)?.isReplay === true) return;
      const u = params.update as Json;
      // Its commands as a session it opened for you lists them: what the composer offers for a tool asked no session of its own.
      if (u?.sessionUpdate === "available_commands_update" && Array.isArray(u.availableCommands))
        HEARD.set(this.pid, (u.availableCommands as { name: string; description?: string; input?: { hint?: string } }[]).map((c) => ({ name: c.name, description: c.description ?? "", hint: c.input?.hint, source: "tool" as const })));
      return this.onUpdate(u);
    }
    if (m.id === undefined) return;
    // The agent asks us something.
    try {
      const result = await this.answer(m.method ?? "", params);
      this.send({ id: m.id, result });
    } catch (e) {
      this.send({ id: m.id, error: { code: e instanceof Unknown ? -32601 : -32603, message: e instanceof Error ? e.message : String(e) } });
    }
  }

  /** Whether a path is really in the project, once its links are followed. */
  private inProject(path: unknown) {
    return inFolder(this.o.cwd, path);
  }

  /** Requests from the agent: permission, and file access inside the project. */
  private async answer(method: string, p: Json): Promise<Json> {
    const inside = (path: unknown) => {
      if (!this.inProject(path)) throw new Error("That path is outside the project.");
      return resolve(this.o.cwd, String(path));
    };
    if (method === "fs/read_text_file") {
      const text = await readFile(inside(p.path), "utf8");
      const line = typeof p.line === "number" ? p.line - 1 : 0;
      const limit = typeof p.limit === "number" ? p.limit : undefined;
      return { content: line || limit ? text.split("\n").slice(line, limit ? line + limit : undefined).join("\n") : text };
    }
    if (method === "fs/write_text_file") {
      if (this.o.access === "read") throw new Error("This thread is read only.");
      const abs = inside(p.path);
      // Ask first holds here too, for an agent that writes without asking; one that asked for this file has its answer. A write
      // into git's own folder asks below Full, high and with no rule, as the same edit asked for does (gitInside).
      const git = this.o.access !== "full" && gitInside(this.o.cwd, abs);
      if ((this.o.access === "ask" || git) && !this.granted.has(abs)) {
        const sink = this.sink;
        const signal = this.signal;
        if (!sink || !signal) throw new Error("Nothing can allow this write now.");
        const fields = [{ label: "File", value: this.rel(abs) }, { label: "Where", value: this.o.cwd }];
        const why = git ? { description: "This writes into git's own folder, whose hooks and settings run code.", why: [{ kind: "changes" as const, text: "it writes into git's own folder, whose hooks and settings run code" }] } : {};
        const a = await sink.approve({ tool: "edit", title: `Write ${this.rel(abs)}`, risk: git ? "high" : "low", fields, rule: git ? undefined : "Edit", ...why }, signal).catch(() => ({ allow: false }));
        if (!a.allow) throw new Error("You didn't allow this write.");
      }
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, String(p.content ?? ""));
      return {};
    }
    if (method === "session/request_permission" || method === "elicitation/create") {
      this.asking++;
      try {
        return await this.ask(method, p);
      } finally {
        this.asking--;
        this.heard = Date.now();
      }
    }
    throw new Unknown(`Liner Code doesn't handle ${method} yet.`);
  }

  /** The agent's own asks: a permission, or a form to fill in. */
  private async ask(method: string, p: Json): Promise<Json> {
    if (method === "session/request_permission") {
      const known = this.calls.get(String((p.toolCall as ToolCall)?.toolCallId));
      const call = { ...known, ...(p.toolCall as ToolCall) };
      // OpenCode's ask to read names no file: the call's own update did.
      if (call.kind === "read" && !call.locations?.length) call.locations = known?.locations;
      const options = (p.options as { optionId: string; kind: string }[]) ?? [];
      const pick = (allow: boolean) => (options.find((o) => o.kind === (allow ? "allow_once" : "reject_once")) ?? options.find((o) => o.kind.startsWith(allow ? "allow" : "reject")))?.optionId;
      // A command meant to run on after its turn (a daemon) is refused at every level, Full too: nobody would see it run. agy 1.5.6
      // asks for one (seen); it asks nothing for schedule or swarm, which endWork ends with the turn, and the model is told so up front.
      const raw0 = (call.rawInput ?? {}) as Json;
      if (this.known.endsWork && raw0.IsDaemon === true) {
        const what = `run ${commandOf(call) || "a command"} on its own, past the turn`;
        this.sink?.notice(`Liner Code didn't let ${this.cmd[0]} ${what}: work that goes on after a turn would run where nobody sees it.`);
        this.refusedLast = `Last turn Liner Code refused your request to ${what}: nothing may run on after your turn. Run what you need in the turn itself, and wait for it.`;
        this.kept.add(String(call.toolCallId));
        const id = pick(false);
        return id ? { outcome: { outcome: "selected", optionId: id } } : { outcome: { outcome: "cancelled" } };
      }
      const command = commandOf(call);
      const kind = KIND[call.kind ?? ""] ?? "other";
      // OpenCode's ask to go outside (external_directory) comes ahead of a step's own, under the step's id and as
      // kind "other": it's the step's kind that says what it's going out there to do.
      const raw = (call.rawInput ?? {}) as Json;
      const reaching = kind === "other" && (raw.parentDir !== undefined || raw.directories !== undefined);
      const step = reaching ? (KIND[known?.kind ?? ""] ?? "other") : kind;
      const reader = step === "exec" && readsOnly(command);
      // An edit goes by itself only when every file it names is in the project (T3 Code: provider-acp clientPolicy.ts).
      // What's handed to it to read (your attachments, a long output it saved) is as good as in the project, but only to read.
      // OpenCode 2 names a command's working folder as its place: in the project that says nothing (it isn't a file the command
      // names), outside it, it's where the command runs, and stays.
      const ran = step === "exec" && this.opencode ? resolve(this.o.cwd, String(raw.workdir ?? raw.cwd ?? ".")) : undefined;
      const files = (call.locations ?? []).filter((l) => !(ran && resolve(this.o.cwd, l.path) === ran && this.inProject(l.path)));
      const handed = (path: string) => step !== "edit" && (step !== "exec" || reader) && (this.o.dirs ?? []).some((d) => inFolder(d, resolve(this.o.cwd, path)));
      const stray = files.find((l) => !this.inProject(l.path) && !handed(l.path));
      // An edit into git's own folder (or onto a HEAD) isn't scoped, in the project as it is: it asks below Full (gitInside).
      const gitDir = (kind === "edit" || step === "edit") && files.some((l) => gitInside(this.o.cwd, l.path));
      const scoped = files.length > 0 && !stray && !gitDir;
      // A command that only reads names its own files, and OpenCode asks to go outside for few of them: not for a
      // relative path, nor a link. An ask you've allowed for this step has said so already.
      const words = reader ? commandWords(command) : [];
      const beyond = reaching || this.reached.has(call.toolCallId) ? undefined : words.find((w) => leaves(w, this.o.cwd, this.o.dirs));
      const away = stray?.path ?? beyond;
      const secret = [...files.map((l) => l.path), ...words].some((path) => secretFile(path) && !handed(path));
      // Reading goes by itself at every level (T3 Code: provider-acp clientPolicy.ts), and so does a command that only
      // reads, as in Claude Code. What reaches past the project, as a link can, doesn't, nor do the .env files OpenCode
      // would have asked about itself.
      const reads = (step === "read" ? scoped : (step === "search" || reader) && !away) && !secret;
      // Edits go ahead from Edits on its own up; Auto and Reviewer decides hand the rest to Liner Code.
      // Liner Code's own tools only reach this session's surfaces and go without a card, as in Claude Code. Neither agent should ask
      // for one (OpenCode's rules allow them; Hermes asks only about commands and edits), and a title is the agent's to write, from
      // what the model wrote at times (OpenCode titles its ask to go outside with the model's description): so the name alone isn't
      // enough. The ask has to be an MCP call in every other way too: no command or edit as either agent marks one (its kind, a
      // command, a file it names, a diff, Hermes's perm-check ids for commands), and nothing in its input that tool of ours doesn't
      // take. In doubt, the card.
      const mine = this.o.mcp ? this.ours(call) : undefined;
      const takes = mine ? (TOOLS.find((t) => t.name === mine.name)?.inputSchema.properties ?? {}) : {};
      const fits = (input: unknown) => input === undefined || (typeof input === "object" && input !== null && !Array.isArray(input) && Object.keys(input).every((k) => Object.hasOwn(takes, k)));
      const wrapped = /^tool_call\b/.test(call.title ?? "");
      // Antigravity's wrapper carries its server, its tool and that tool's input, and nothing more. agy 1.5.6 asks for it as
      // kind execute, titled "MCP Tool <tool>": that title is its command as commandOf reads it, and no command of its own.
      const via = isMcpWrap(nameOf(call));
      const asWrap = via && Boolean(mine) && (!command || command === call.title) && /^MCP Tool [\w-]+$|^call_mcp_tool/.test(call.title ?? "call_mcp_tool");
      const liner =
        Boolean(mine) &&
        [(p.toolCall as ToolCall | undefined)?.kind, known?.kind].every((k) => k === undefined || k === "other" || (asWrap && k === "execute")) &&
        (!command || asWrap) &&
        !reaching &&
        !files.length &&
        !(call.content ?? []).some((c) => c.type === "diff") &&
        !String(call.toolCallId ?? "").startsWith("perm-check-") &&
        fits(mine?.input) &&
        (!wrapped || Object.keys((call.rawInput ?? {}) as Json).every((k) => k === "calls")) &&
        (!via || Object.keys((call.rawInput ?? {}) as Json).every((k) => MCP_WRAP_KEYS.includes(k)));
      // Read only holds whatever the agent's mode: Antigravity's plan mode still asks to edit and to run commands, and a card
      // there would let a session that only reads change things. What only reads, and Liner Code's own tools (whose writers
      // refuse in a session that only reads), go on; the rest is a no, said once a turn.
      if (this.levels && this.o.access === "read" && !reads && !liner && !(step === "exec" && reader && !away && !secret)) {
        const what = step === "edit" ? `change ${files[0] ? this.rel(files[0].path) : "files"}` : step === "exec" ? `run ${command || "a command"}` : `use ${this.titled(call.title ?? "a tool")}`;
        // agy offers only allow and deny, and ends its turn on a deny: the timeline says so, and the model hears it next turn.
        if (!this.readRefused) this.sink?.notice(`This session only reads, so ${this.cmd[0]} wasn't let ${what}${this.known.endsWork ? `, and that ended its turn` : ""}.`);
        this.readRefused = true;
        this.refusedLast = `Last turn Liner Code refused your request to ${what}: this session is Read only. Don't try to change anything; say what you would change instead.`;
        const id = pick(false);
        return id ? { outcome: { outcome: "selected", optionId: id } } : { outcome: { outcome: "cancelled" } };
      }
      const free = this.o.access === "full" || reads || liner || ((this.o.access === "edits" || this.o.access === "auto" || this.o.access === "review") && kind === "edit" && scoped);
      // Allowed, with no way offered to say so: not a yes with nothing in it.
      if (free && !(this.o.guard && isDestructive(command))) {
        const id = pick(true);
        return id ? { outcome: { outcome: "selected", optionId: id } } : { outcome: { outcome: "cancelled" } };
      }
      const sink = this.sink;
      const signal = this.signal;
      if (!sink || !signal) return { outcome: { outcome: "cancelled" } };
      const file = away ?? (gitDir ? files.find((l) => gitInside(this.o.cwd, l.path))?.path : undefined) ?? files[0]?.path;
      const fields = [command && { label: "Command", value: command }, file && { label: "File", value: this.rel(file) }, { label: "Where", value: this.o.cwd }].filter(Boolean) as { label: string; value: string }[];
      // What reaches outside the project, an edit of files it doesn't name or into git's own folder, is yours each time: high, so Auto and the Reviewer leave it to you, and no rule.
      // Whatever its kind: OpenCode's first ask to go outside (external_directory) is "other", and only the place it names says so.
      const loose = Boolean(away) || (kind === "edit" && !scoped);
      // "other" is a catch-all, so a rule for it would allow every tool nobody named (T3 Code never turns an unknown request
      // into a grant). A tool that gives a name, as a connection's does, gets a rule for that name alone, worded so no command
      // or kind can share it. Not doom_loop: that's OpenCode asking whether to go on repeating itself, a different thing each time.
      const named = kind === "other" && !reaching && call.title !== "doom_loop" && /^[\w.:-]+$/.test(call.title ?? "");
      // OpenCode 2's Code Mode (opencodeRules turns it off): JavaScript that fetches over HTTP and calls other tools, each of
      // which asks as this one call, with its code and never the address or tool it reaches. A command with the network, so
      // high (Auto and the Reviewer leave it to you), with no rule, since one would let any code through; as tool `execute`, which
      // Read only refuses with no card, as it does a command that changes things (runtime.ts, readForbids).
      const code = this.opencode && kind === "other" && (call.name ?? call.title) === "execute" ? String(raw.code ?? "") : undefined;
      if (code !== undefined) fields.unshift({ label: "Code", value: code.length > 4000 ? `${code.slice(0, 3999)}…` : code });
      const rule = loose || code !== undefined ? undefined : kind === "exec" ? ruleFor(command) : kind === "edit" ? "Edit" : kind !== "other" ? call.kind : named ? `tool ${call.title}` : undefined;
      const description = loose ? (away ? "This is outside the project." : gitDir ? "This writes into git's own folder, whose hooks and settings run code." : "The agent didn't say which files this changes.") : code !== undefined ? "OpenCode runs this JavaScript, which can send and fetch anything over the network and call its other tools." : undefined;
      // Why, from what made it loose: the place it names outside the project, an edit into git's own folder, or one that names no file.
      const home = homedir();
      const at = away ? resolve(this.o.cwd, away) : "";
      const why = loose ? [away ? { kind: "outside" as const, text: `it reaches ${at === home || at.startsWith(home + sep) ? `~${at.slice(home.length)}` : at}, outside the project` } : gitDir ? { kind: "changes" as const, text: "it writes into git's own folder, whose hooks and settings run code" } : { kind: "changes" as const, text: "the agent didn't say which files it changes" }] : undefined;
      // The agent's own words for its command: OpenCode's bash tool takes a `description` beside it.
      const says = kind === "exec" ? saysOf(raw.description) : undefined;
      const a: { allow: boolean; reason?: string; level?: boolean } = await sink.approve({ key: call.toolCallId, tool: code !== undefined ? "execute" : (call.kind ?? "tool"), title: this.titled(call.title ?? "Use a tool"), description, risk: loose || code !== undefined ? "high" : kind === "exec" ? commandRisk(command) : "low", fields, rule, unjudged: true, ...(says ? { says } : {}), ...(why ? { why } : {}) }, signal).catch(() => ({ allow: false }));
      // Refused by the level (Read only), with no card: ACP's answer carries no words, so the model hears why as its next turn starts.
      if (a.level && a.reason) this.refusedLast = `Last turn Liner Code refused a step: ${a.reason}`;
      // Stopped while it asked: a request open when the prompt is cancelled is answered "cancelled", as ACP
      // asks, not as a no (T3 Code: provider-acp adapter.ts).
      if (signal.aborted) return { outcome: { outcome: "cancelled" } };
      if (a.allow) for (const f of files) this.granted.add(resolve(this.o.cwd, f.path));
      if (a.allow && reaching) this.reached.add(call.toolCallId);
      if (!a.allow && ++this.refused >= REFUSALS) this.cut?.(REFUSED);
      const id = pick(a.allow);
      return id ? { outcome: { outcome: "selected", optionId: id } } : { outcome: { outcome: "cancelled" } };
    }
    if (method === "elicitation/create") {
      const sink = this.sink;
      const signal = this.signal;
      if (!sink || !signal || p.mode !== "form") return { action: "cancel" };
      const schema = p.requestedSchema as FormSchema | undefined;
      const fields = formFields(String(p.message ?? ""), schema);
      // Nothing to fill in is a yes or a no, as a tool's approval comes from some agents (T3 Code: clientPolicy.ts).
      if (!fields.length) {
        if (this.o.access === "full") return { action: "accept", content: {} };
        const a = await sink.approve({ key: p.toolCallId ? String(p.toolCallId) : undefined, tool: "tool", title: String(p.message || "Use a tool"), risk: "medium", fields: [] }, signal).catch(() => ({ allow: false }));
        return signal.aborted ? { action: "cancel" } : a.allow ? { action: "accept", content: {} } : { action: "decline" };
      }
      // Optional: a routine has nobody to answer, and an agent left waiting would hold it for good.
      const answers = await sink.ask(fields.map((f) => f.question), signal, { optional: true }).catch(() => null);
      if (signal.aborted) return { action: "cancel" };
      // Skipped: cancelling would end OpenCode's turn, and skipping lets it carry on. Left unanswered, it does.
      if (!answers) return schema?.required?.length ? { action: "decline" } : { action: "accept", content: {} };
      return { action: "accept", content: formContent(fields, answers) };
    }
    throw new Unknown(`Liner Code doesn't handle ${method} yet.`);
  }

  private rel(p: string) {
    return fromFolder(this.o.cwd, p);
  }

  /** A call's tool when it's an MCP server's that Liner Code didn't hand over (mcp_<server>_<tool>, not ours), else undefined. */
  private foreignTool(call: ToolCall) {
    const name = /^(?:Run\s+)?(mcp_[\w-]+)$/.exec(String(nameOf(call) ?? ""))?.[1] ?? /^(?:Run\s+)?(mcp_[\w-]+)$/.exec(String(call.title ?? ""))?.[1];
    return name && !this.ours({ ...call, name }) ? name : undefined;
  }

  /** Which of Liner Code's tools a call is: by the name its server was handed over under, for an agent it has its own name for. */
  private ours(call: ToolCall) {
    return linerCall(nameOf(call), call.rawInput, this.known.tagged ? this.server : undefined);
  }

  /** An agent's title with a path in it that leaves the project ("File ../../../Users/you/.gemini/…/plan.md") as homeTitle says it. */
  private titled(title: string) {
    return homeTitle(title, this.o.cwd, this.o.env.HOME || homedir());
  }

  private onUpdate(u: Json) {
    const sink = this.sink;
    if (!sink || !u) return;
    const kind = u.sessionUpdate;
    // An agent that leaves out messageId (it's optional) gets a new paragraph after each tool call, not one for the whole turn.
    // Anything but agy's lines for a retry is news (a word, a thought, a step); a retry's line, however it comes in pieces, isn't.
    if (kind !== "agent_message_chunk") this.progress = Date.now();
    if (kind === "agent_message_chunk") {
      const said = blockText(u.content);
      const news = (this.spoken + said).replace(RETRY, "").trim().length;
      if (news > this.news) this.progress = Date.now();
      this.news = news;
      this.spoken += said;
      sink.text(said, u.messageId ? String(u.messageId) : undefined);
    }
    else if (kind === "agent_thought_chunk") sink.reasoning(blockText(u.content), u.messageId ? String(u.messageId) : undefined);
    else if (kind === "tool_call" || kind === "tool_call_update") {
      const prev = this.calls.get(String(u.toolCallId));
      const call: ToolCall = { ...prev, ...(u as ToolCall), content: (u.content as Json[] | undefined) ?? prev?.content };
      this.calls.set(call.toolCallId, call);
      // A subagent, with `task` denied: a command marked subtask gets past that, and it would wait for good at its first step.
      // OpenCode 2 calls it `subagent`, by name beside a title of its own.
      if (call.title === "task" || (this.opencode && (call.name === "subagent" || call.title === "subagent"))) this.cut?.(SUBAGENT);
      // A tool of an MCP server Liner Code didn't hand it (one of its own settings), under way with no ask, below Full: agy offers
      // such a server's tools up front, and runs them unasked, when its conversation knew them before (seen on 1.5.7 after a
      // resume, for a server of the person's named as an earlier process's liner_<tag>). Liner Code can't refuse a step it isn't
      // asked about; it stops the turn the moment it sees one, and says so. (An asked one comes as pending, with its ask.)
      const foreign = !prev && this.known.tagged && this.o.access !== "full" && (call.status === "in_progress" || call.status === "completed") ? this.foreignTool(call) : undefined;
      if (foreign) {
        this.refusedLast = `Last turn you called ${foreign}, a tool of a server Liner Code didn't give you, and it ran without anyone being asked, which this session's level (${LEVEL_WORDS[this.o.access]}) doesn't allow, so Liner Code stopped the turn. Use Liner Code's tools (on ${SERVER_NOW}) and your own only.`;
        this.cut?.(`${this.cmd[0]} ran “${foreign}”, a tool of a server in its own settings, without asking, which ${LEVEL_WORDS[this.o.access]} doesn't let through. Liner Code can't refuse a step it isn't asked about, so it stopped the turn.`);
      }
      // Each update brings a running call's whole output again: a long build's would go over and over,
      // so it goes a few times a second, and what ends it goes at once.
      clearTimeout(this.later.get(call.toolCallId));
      this.later.delete(call.toolCallId);
      const last = this.shown.get(call.toolCallId);
      const wait = last === undefined ? 0 : last + OUTPUT_EVERY_MS - Date.now();
      if (call.status !== "completed" && call.status !== "failed" && wait > 0) {
        this.later.set(call.toolCallId, setTimeout(() => this.later.delete(call.toolCallId) && this.sink === sink && this.showCall(call, sink), wait));
        return;
      }
      this.showCall(call, sink);
    } else if (kind === "plan") {
      const entries = (u.entries as { content: string; status: string }[]) ?? [];
      sink.plan(entries.map((e) => ({ title: e.content, status: e.status === "completed" ? "completed" : e.status === "in_progress" ? "in_progress" : "pending" })));
    } else if (kind === "usage_update") {
      // The cost is the session's so far, so a step's is what it grew by. A loaded session's first one holds
      // its earlier turns too: it only sets where counting starts.
      const cost = (u.cost as { amount?: number } | undefined)?.amount;
      const step = cost != null && this.spent != null && cost >= this.spent ? cost - this.spent : undefined;
      if (cost != null) this.spent = cost;
      sink.usage({ contextTokens: Number(u.used) || undefined, contextWindow: Number(u.size) || undefined, ...(step !== undefined ? { costUsd: step } : {}) });
    }
  }

  /** A tool call as its row shows it, with the end of its output. */
  private showCall(call: ToolCall, sink: TurnSink) {
    this.shown.set(call.toolCallId, Date.now());
    const out = (call.content ?? [])
      .map((c) => (c.type === "content" ? blockText(c.content) : c.type === "diff" ? `Edited ${this.rel(String(c.path))}` : ""))
      .filter(Boolean)
      .join("\n");
    const status = call.status === "completed" ? "done" : call.status === "failed" ? "failed" : call.status === "stopped" ? "stopped" : "running";
    if (isDelegation(call.title)) return this.delegated(call, out, status === "stopped" ? "failed" : status, sink);
    const path = call.locations?.[0]?.path ?? ((call.content ?? []).find((c) => c.type === "diff")?.path as string | undefined);
    // Liner Code's own tools, under the name the agent gives them ("liner_design_show"): named and titled as every tool names them.
    // Only with its server there: a name that only looks like one, as a server called liner_notes makes, is that server's.
    const mine = this.o.mcp ? this.ours(call) : undefined;
    const ours = mine?.name;
    const input = mine ? mine.input : call.rawInput;
    sink.tool({
      key: call.toolCallId,
      // OpenCode's question tool is the question card, as AskUserQuestion is: not a row of its own as well.
      tool: ours ? `liner.${ours}` : call.title === "question" ? "AskUserQuestion" : (call.kind ?? "tool"),
      toolKind: ours ? "other" : (KIND[call.kind ?? ""] ?? "other"),
      title: ours ? linerTitle(ours, input) : this.titled(call.title ?? "Use a tool"),
      path: path ? this.rel(path) : undefined,
      input: input === undefined ? undefined : `${ours && JSON.stringify(input).includes(CUT_MARK) ? `(${this.cmd[0]} showed only the end of this, its last 8,000 characters; the tool had it whole.)\n` : ""}${JSON.stringify(input, null, 2)}`,
      output: out.length > OUTPUT_MAX ? `…${out.slice(-OUTPUT_MAX)}` : out || (call.rawOutput === undefined ? undefined : JSON.stringify(call.rawOutput, null, 2).slice(0, OUTPUT_MAX)),
      status,
    });
  }

  /** A delegation's tasks as agent rows: running while the call runs, then each as Hermes says it went. */
  private delegated(call: ToolCall, out: string, status: "running" | "done" | "failed", sink: TurnSink) {
    const id = call.toolCallId;
    // Its tasks are named in its first words; its last words are the results, which name them only by number.
    if (!this.delegations.has(id) || (status === "running" && out)) {
      const tasks = delegatedTasks(out, call.title);
      if (tasks.length || !this.delegations.has(id)) this.delegations.set(id, tasks.length ? tasks : [{ goal: "a task" }]);
    }
    const tasks = this.delegations.get(id)!;
    const results = status === "running" ? null : delegateResults(out);
    tasks.forEach((t, i) => {
      const r = results?.find((x) => x.index === i);
      const name = roleName(r?.role ?? t.role);
      // No taskId: ACP can't stop or steer one task alone.
      const agent: NonNullable<ToolUpdate["agent"]> = { name, task: t.goal.length > 80 ? `${t.goal.slice(0, 79)}…` : t.goal, brief: t.goal, steps: [] };
      let rowStatus = status;
      if (r) {
        if (r.model) agent.model = `${this.pid}:${r.model}`;
        agent.steps = r.tools.map((tool) => ({ title: tool, toolKind: "other", status: "done" }));
        agent.tools = r.tools.length || undefined;
        agent.report = r.summary ?? r.error;
        rowStatus = r.status === "completed" ? "done" : r.status === "interrupted" ? "done" : "failed";
        if (r.status === "interrupted") agent.state = "stopped";
      } else if (status !== "running") {
        // No results to read: it went to the background (Hermes reports back later), or failed whole.
        if (status === "failed") agent.report = out.trim() || undefined;
        else agent.background = true;
      }
      sink.tool({ key: `${id}#${i}`, tool: "delegate_task", toolKind: "task", title: `${name}: ${agent.task}`, input: t.goal, status: rowStatus, agent });
    });
  }

  async turn(text: string, sink: TurnSink, signal: AbortSignal, files: string[] = []) {
    if (!this.child && !this.gating) this.boot();
    // Stop reaches an agent that's still starting too: one that never answers would hold the turn for good.
    const stopped = new Promise<void>((r) => (signal.aborted ? r() : signal.addEventListener("abort", () => r(), { once: true })));
    await Promise.race([this.booting, stopped]);
    // Stopped while the agent was starting: nothing was asked of it yet. A session it couldn't load is said
    // on the next turn instead, so that one still gets the conversation so far.
    if (signal.aborted) return;
    // What it said while it started describes its settings (a model, a thinking level, connections it hasn't): once a session.
    for (const note of this.notes.splice(0)) sink.notice(note, undefined, { once: true });
    sink.effortNow?.(this.effortGap());
    if (!this.session) throw new Error("The agent didn't open a session.");
    sink.session(this.session);
    if (this.lost) {
      const lost = this.lost;
      this.lost = undefined;
      // A new session knows nothing, so the soul goes again with the conversation so far.
      this.soulSent = false;
      throw new ResumeFailed(`${this.cmd[0]} couldn't load its session ${lost}.`);
    }
    this.sink = sink;
    this.signal = signal;
    this.granted.clear();
    this.reached.clear();
    this.refused = 0;
    this.readRefused = false;
    this.kept.clear();
    this.spoken = "";
    // A call is only asked about in its turn.
    this.calls.clear();
    this.shown.clear();
    this.delegations.clear();
    this.heard = Date.now();
    // An agent that hasn't finished cancelling 15 seconds after Stop is stopped itself, and the turn
    // ends as stopped; the next turn starts it again on the same session (T3 Code: AcpSessionRuntime.ts, defaultCancelTimeout).
    let late: NodeJS.Timeout | undefined;
    let answered = false;
    let giveUp = () => {};
    const gaveUp = new Promise<null>((r) => (giveUp = () => r(null)));
    const cancel = () => {
      // Once: a turn already being ended can be stopped by you as well, and a second wait would outlive this turn.
      // Not once its prompt has answered: there's nothing left to cancel, and the wait would close a process that did stop.
      if (late || answered) return;
      this.send({ method: "session/cancel", params: { sessionId: this.session } });
      late = setTimeout(() => {
        this.close();
        giveUp();
      }, CANCEL_MS);
    };
    signal.addEventListener("abort", cancel, { once: true });
    let cut = "";
    if (this.opencode || this.known.endsWork)
      this.cut = (why) => {
        cut ||= why;
        cancel();
      };
    // A prompt that goes quiet, with nothing open that would explain it (AcpSpec.quietMs), ends the turn (T3 Code: AntigravityAdapterV2.ts).
    // Before that, a minute (AcpSpec.hintMs) with no new word, only its retries' lines at most, says so once, with Stop beside it:
    // agy retries a plain 429 for minutes, saying only that it does.
    this.progress = Date.now();
    this.news = 0;
    let hinted = false;
    const { quietMs, hintMs } = this.known;
    const quiet = quietMs || hintMs
      ? setInterval(() => {
          const open = this.asking > 0 || [...this.calls.values()].some((c) => c.status === "pending" || c.status === "in_progress");
          if (hintMs && !hinted && !open && Date.now() - this.progress >= hintMs) {
            hinted = true;
            sink.notice(`${this.cmd[0]} hasn't said anything new for ${spell(hintMs)}: it may be retrying a busy or used-up API, which it can do for minutes. Stop ends the turn.`, undefined, { stop: true });
          }
          if (quietMs && !open && Date.now() - this.heard >= quietMs) this.cut?.(`${this.cmd[0]} said nothing for ${spell(quietMs)} with nothing running, so Liner Code stopped it. Your next message starts it again where it was.`);
        }, Math.min(30_000, Math.max(50, Math.min(quietMs || Infinity, hintMs || Infinity) / 4)))
      : undefined;
    try {
      // A mode it didn't switch to goes again, and the agent's own mode is said to be off if it still won't
      // (T3 Code: AcpAdapterV2.test.ts, "reapplies a selection after a switch away from it failed partway").
      if (this.wanted) {
        const mode = this.wanted;
        const own = this.levelModes(this.o.access).length ? this.levels?.[this.o.access] : undefined;
        const missed = await Promise.race([own ? this.toLevel(this.o.access).then((ok) => !ok) : this.setMode(mode).then(() => false, () => true), stopped]);
        if (signal.aborted) return;
        for (const note of this.notes.splice(0)) sink.notice(note, undefined, { once: true });
        sink.effortNow?.(this.effortGap());
        if (missed)
          sink.notice(
            own && this.o.access !== "read"
              ? `${this.cmd[0]} didn't switch to its “${own}” mode, so its own settings decide what it asks you about.`
              : mode === this.modes.read || this.o.access === "read"
                ? `${this.cmd[0]} didn't switch to its read-only mode: what it wants to change still comes to you.`
                : `${this.cmd[0]} didn't leave its read-only mode, so it may only plan.`,
          );
      }
      // The model is told which of the person's connections it doesn't have, and why, when that changes; with Antigravity's
      // system prompt it heard that, and its level, as the session opened, and hears of a change of either here.
      const heldNow = JSON.stringify(this.held());
      const heldNote = heldNow !== this.toldHeld ? this.heldModelNote() || (this.toldHeld ? "(The person's own connections are in this session now.)" : "") : "";
      this.toldHeld = heldNow;
      // The level, in one line, at the first turn of each process (a start, a resume, a load) and after every change: never in
      // agy's system prompt, which it keeps from the session's first start whatever a resume sends.
      const levelNow = this.system && this.o.access !== this.told ? `(${levelNote(this.o.access, this.server)})` : "";
      this.told = this.o.access;
      // Its tools' names, with the level at the first turn of each process: the name is new in each (AcpSpec.tagged).
      const nameNow = this.known.tagged && this.o.mcp && this.server !== this.toldName ? `(${namesNote(this.server)})` : "";
      this.toldName = this.server;
      // A sentence kept for this turn names Liner Code's server only as SERVER_NOW: the name is the process's now running, put in here.
      const refusedNote = this.refusedLast ? `(${this.refusedLast.replaceAll(SERVER_NOW, this.server)})` : "";
      this.refusedLast = "";
      const endedNote = this.endedLast ? `(${this.endedLast})` : "";
      this.endedLast = "";
      const said = [this.o.soul && !this.soulSent ? this.o.soul : "", heldNote, levelNow, nameNow, refusedNote, endedNote, text].filter(Boolean).join("\n\n");
      this.soulSent = true;
      // Your images go as they are when the agent takes them; every file is named in the text either way.
      const images = this.images ? files.flatMap((f) => {
        const mimeType = imageType(f);
        const bytes = mimeType ? readUpTo(f, 20 * 1024 * 1024) : null;
        return mimeType && bytes ? [{ type: "image", mimeType, data: bytes.toString("base64") }] : [];
      }) : [];
      const session = this.session;
      const since = Date.now();
      // What of its own is already running (its MCP servers, its language server): anything else marked at the end is the turn's.
      if (this.known.endsWork) this.resident = await markedPids(this.mark);
      let r: Json | null = null;
      try {
        // Stopped while the look above ran (or cut): the prompt isn't sent at all. Sent after its session/cancel, the agent
        // would take it as a new turn and work it through, with nobody running it (seen: Stop then waited out the prompt).
        if (signal.aborted || cut) throw new Stopped();
        r = await Promise.race([this.request("session/prompt", { sessionId: this.session, prompt: [{ type: "text", text: said }, ...images] }), gaveUp]).catch((e) => {
          if (cut) return null;
          throw e;
        });
      } catch (e) {
        if (!(e instanceof Stopped)) throw e;
      } finally {
        // The prompt has answered (or was given up on), so the wait for a cancel is over: left running, it closed the process
        // while the turn's end below still read its use (`opencode export`, up to OPENCODE_USAGE_MS) or ended its work, and
        // the next turn had to start it again, with a session it might not load.
        answered = true;
        clearTimeout(late);
        // However the prompt ended (done, stopped, failed), its use is said once, before the turn is handed back.
        // OpenCode's result carries only its last step's tokens, and a stopped one's none: the turn's come from its own store.
        const real = this.opencode ? await opencodeTurnUsage(this.cmd, session, since, { cwd: this.o.cwd, env: this.o.env }) : null;
        if (real) sink.usage(real);
        else {
          const usage = r?.usage as { totalTokens?: number; inputTokens?: number; outputTokens?: number; thoughtTokens?: number | null; cachedReadTokens?: number | null } | undefined;
          if (usage) {
            // ACP leaves open whether inputTokens counts cache reads: most agents do, OpenCode doesn't (Kun: acp-event-mapper.ts, applyPromptResult).
            // Liner's input is the uncached part, so reads come off it unless the numbers show they were never in it.
            const input = usage.inputTokens ?? 0, output = usage.outputTokens ?? 0, reads = usage.cachedReadTokens ?? 0;
            const total = usage.totalTokens ?? input + output;
            const excludes = reads > input || total >= input + output + (usage.thoughtTokens ?? 0) + reads;
            const now = { input: excludes ? input : Math.max(0, input - reads), output, reads };
            if (this.pid === "hermes") {
              const was = this.counted;
              this.counted = { ...now };
              // Counters that went down started again (its gateway did): what they say is all this turn's.
              if (was && now.input >= was.input && now.output >= was.output && now.reads >= was.reads) Object.assign(now, { input: now.input - was.input, output: now.output - was.output, reads: now.reads - was.reads });
            }
            sink.usage({ inputTokens: now.input, outputTokens: now.output, cacheReadTokens: now.reads });
          }
        }
        // What it started that is still at work ends with the turn (AcpSpec.endsWork), so nothing it began goes on unseen.
        if (this.known.endsWork) await this.endWork(sink, signal.aborted || Boolean(cut));
      }
      // An error, not a notice: this turn didn't do what was asked, and a routine's step mustn't read as done.
      if (cut && !signal.aborted) sink.error(cut);
      if (!r) return;
      if (r.stopReason === "refusal") sink.notice(this.known.refusal ?? "The agent declined this one.");
      // agy ends a turn Google refused (a used-up quota, a rate limit: seen for a 429 RESOURCE_EXHAUSTED) as a normal one, with
      // only these words in its answer: said for what it most likely is, without reading its own logs for the reason.
      else if (this.known.failedWords?.test(this.spoken)) sink.notice(this.known.failed ?? "The agent stopped on an error.");
      if (r.stopReason === "max_tokens") sink.notice("The agent ran out of room in this turn.");
    } finally {
      clearTimeout(late);
      clearInterval(quiet);
      signal.removeEventListener("abort", cancel);
      for (const timer of this.later.values()) clearTimeout(timer);
      this.later.clear();
      this.cut = null;
      this.sink = null;
      this.signal = null;
      this.delegations.clear();
    }
  }
  private soulSent = false;
  /** When it last said something new: not only a retry's line (the silence hint). */
  private progress = 0;
  /** How much of what it said this turn isn't its retry lines. */
  private news = 0;

  /**
    The end of a turn of an agent whose background work Liner Code can't see through to its end (Antigravity: a command it sent
    to the background, a daemon, a subagent, a schedule or a swarm go on after its prompt has answered, calling the model or
    writing files with nothing on the timeline). Everything its process started carries this session's marker (RUN_ENV), even
    once it has left the tree (a command agy backgrounds, `nohup … &`, a double fork). Stopped, or with anything of that kind
    started, still open, or marked and new since the turn began, all of it ends here, children first, and is checked to be gone:
    the rows of what was still going say stopped, the timeline says what was ended (or, by command, what is still running), and
    so does the model's next turn, which starts agy again on the same session.
  */
  private async endWork(sink: TurnSink, stopped: boolean) {
    const calls = [...this.calls.values()];
    const open = calls.filter((c) => c.status === "pending" || c.status === "in_progress");
    // What Liner Code refused never ran.
    const background = calls.filter((c) => !this.kept.has(c.toolCallId) && !open.includes(c) && (BACKGROUND.test(nameOf(c) ?? "") || (c.rawInput as Json | undefined)?.IsDaemon === true));
    const pid = this.child?.pid;
    // Commands of the turn's that sent something off on its own (`&`, nohup, setsid, a fork): what of that is found by its marker
    // ends below; what isn't found can't be told from what ended, since one that closed every descriptor it was handed (so the
    // marker too) and left the session can't be found at all. So it's never said to be ended: it may still run, untracked.
    const detached = calls.filter((c) => !this.kept.has(c.toolCallId) && !open.includes(c) && DETACHES.test(commandOf(c)));
    const untracked = (found: Proc[]) => (found.length ? [] : detached.map((c) => short(commandOf(c), 80)));
    const warn = (cmds: string[]) => `${cmds.map((c) => `“${c}”`).join(", ")} sent something to the background that Liner Code can't find any more, so it may still be running where nobody sees it: Liner Code can't track or end it. Check for it yourself if it shouldn't be running.`;
    const heard = (cmds: string[]) => `Last turn ${cmds.map((c) => `“${c}”`).join(", ")} sent something to the background that Liner Code couldn't find to end: it may still be running, unseen. Don't start anything that outlives your turn; run what you need inside it and wait for it.`;
    // The cheap look first: with nothing new and nothing else to end, agy stays as it is.
    const now = await markedPids(this.mark);
    if (!stopped && !open.length && !background.length && [...now].every((p) => p === pid || this.resident.has(p))) {
      const lost = untracked([]);
      if (lost.length) (sink.notice(warn(lost)), (this.endedLast = heard(lost)));
      return;
    }
    const all = await marked(this.mark);
    // What the turn left: marked, not agy itself, not of its own (resident) as the turn began, and not one of the MCP servers it
    // was handed (Liner Code's, your connections) with what runs under it: agy starts those late after a resume, during the turn
    // (seen on 1.5.7), and they're the session's, not the turn's.
    const servers = this.ownServers(all, pid);
    const left = all.filter((p) => p.pid !== pid && !this.resident.has(p.pid) && !servers.has(p.pid));
    if (!stopped && !open.length && !background.length && !left.length) {
      const lost = untracked([]);
      if (lost.length) (sink.notice(warn(lost)), (this.endedLast = heard(lost)));
      return;
    }
    for (const c of [...open, ...background]) this.showCall({ ...c, status: "stopped" }, sink);
    // Each by what it is: a subagent, its schedule or swarm, a command by its command line.
    const said = (c: ToolCall) => {
      const name = nameOf(c) ?? "";
      if (/subagent/.test(name)) return "a subagent";
      if (name === "manage_task") return "";
      if (BACKGROUND.test(name)) return `its ${name}`;
      return commandOf(c) || this.titled(c.title ?? "a step");
    };
    const what = [
      ...background.map(said),
      ...open.map(said),
      ...left.filter((p) => !left.some((q) => q.pid === p.ppid)).map((p) => p.command),
    ].filter(Boolean);
    // A process running a call's own command is that call ("zsh -c sleep 6; touch x" for "sleep 6; touch x"): said once.
    const told = what.filter((w, i) => !what.some((v, j) => j !== i && v !== w && w.includes(v) && j < i)).map((w) => short(w, 80));
    const named = [...new Set(told)].slice(0, 4);
    // Commands in quotes, the rest as words ("a subagent", "its schedule").
    const list = named.length ? named.map((w) => (w === "a subagent" || w.startsWith("its ") ? w : `“${w}”`)).join(", ") : "what it started";
    // All that's marked, agy too, children first, and found again until none is left; then agy's own tree (Windows: taskkill /T,
    // all there is there, since no process's environment can be read).
    const still = await endAll(all, () => marked(this.mark), this.known.killAfterMs);
    this.close();
    const lost = untracked(left);
    const any = open.length + background.length + left.length > 0;
    const running = [...new Set(still.map((p) => short(p.command, 80)))].slice(0, 4).map((c) => `“${c}”`).join(", ");
    const lead = stopped ? "" : `${this.cmd[0]} left ${list} going after its answer. `;
    if (still.length) sink.notice(`${lead}Liner Code ended ${this.cmd[0]} and what it started, but this is still running: ${running}. End it yourself if it shouldn't be.`);
    // Nothing is said to run nowhere when a command sent off what can't be found.
    else if (!stopped) sink.notice(`${lead}Liner Code ended it with the turn${lost.length ? "" : ", so nothing runs where you can't see it"}. Your next message starts ${this.cmd[0]} again where it was.`);
    else if (left.length || background.length) sink.notice(`Liner Code ended ${list} with ${this.cmd[0]}.`);
    if (lost.length) sink.notice(warn(lost));
    if (any || still.length) this.endedLast = `When your last turn ended, ${list} ${named.length > 1 ? "were" : "was"} still going, and Liner Code ended ${named.length > 1 ? "them" : "it"}${still.length ? `, except ${running}, still running` : ""}: nothing runs past a turn here. Run what you need inside the turn and wait for it.`;
    if (lost.length) this.endedLast = [this.endedLast, heard(lost)].filter(Boolean).join(" ");
  }

  /**
    The MCP servers it was handed, as they run under it (agy itself, or what was already its own as the turn began, is the
    parent), with everything under them: by the command line it was handed each one with.
  */
  private ownServers(all: Proc[], agy?: number) {
    const lines = this.mcpServers().flatMap((x) => ("command" in x ? [x.args.length ? x.args.join(" ") : x.command] : []));
    const out = new Set<number>();
    for (const p of all) if ((p.ppid === agy || this.resident.has(p.ppid)) && lines.some((l) => p.command.includes(l))) out.add(p.pid);
    for (let grew = true; grew; ) {
      grew = false;
      for (const p of all) if (!out.has(p.pid) && out.has(p.ppid)) (out.add(p.pid), (grew = true));
    }
    return out;
  }

  async update(o: Pick<OpenOptions, "model" | "effort" | "access">) {
    // A change of level that hands the agent other connections reopens it: ACP gives a session its servers as it starts or loads.
    const reopen = this.owed || o.model !== this.o.model || this.handed(o).length !== this.handed().length;
    const effort = o.effort !== this.o.effort && !reopen;
    const was = this.o.access;
    Object.assign(this.o, o);
    // Waited on for an agent whose modes Liner Code knows: agy takes a prompt sent before a switch has landed at the level, or
    // thinking, it had (seen for both). Not for another: one slow to answer mustn't hold the turn (audit-review.test.ts).
    if (o.access !== was && !reopen && this.child && this.session) {
      const switching = this.toMode(o.access, was);
      if (this.levels) await switching;
    }
    if (effort && this.child && this.session) await this.toEffort(o.effort);
    return !reopen;
  }

  /** Puts the agent's own mode where the level wants it: its own for an agent Liner Code knows, else in or out of its read-only one. */
  private async toMode(access: Access, was: Access) {
    if (this.levelModes(access).length) {
      if (!(await this.toLevel(access))) this.wanted = this.levelModes(access)[0];
      return;
    }
    // Into Read only or out of it: the agent's own mode goes with it, or it would go on planning (or editing) as it was.
    if ((access === "read") === (was === "read")) return;
    const mode = access === "read" ? this.modes.read : this.modes.work;
    if (mode) await this.setMode(mode).catch(() => {});
  }

  /**
    The access level changed while a turn may be under way: Liner Code's own answers read it at once (they read this.o), and the
    agent's mode is switched now, waited on. False where the turn can't be held to it: a level below Full for an agent that runs
    the person's connections without asking, while it has them (the runtime then stops the turn; the next opens without them).
    One that hands it more connections is taken at once and reopens for the next turn (owes).
  */
  async setAccess(access: Access) {
    if (access === this.o.access) return true;
    const had = this.handed().length;
    const will = this.handed({ access }).length;
    const was = this.o.access;
    this.o.access = access;
    if (this.child && this.session) {
      const switching = this.toMode(access, was);
      if (this.levels) await switching;
    }
    if (will < had) return `${this.cmd[0]} was given your connections as this turn started, and runs their tools without asking`;
    if (will > had) this.owed = true;
    return true;
  }
  /** It took a change it can only make whole by reopening: the runtime keeps asking until it does. */
  owes() {
    return this.owed;
  }
  private owed = false;

  /**
    Closing a session ends its agent's process and everything marked as its own (exec.ts Mark), whatever was in flight: a turn,
    a start (a start still at its version gate never spawns, epoch; one past it has its process here, `child`, to end), a
    command it left in the background. The marker is the process's own (spawnAt), so a process started after this close is
    never taken for this one's. The promise is for whoever must wait (the engine quitting): it settles once all of it is gone.
    Every ACP tool shares this; one that marks nothing (AcpSpec.endsWork unset: Hermes, OpenCode, Cursor, Grok, one you added)
    ends with its process group (killTree), which its commands stay in.
  */
  close(): Promise<void> {
    const child = this.child;
    this.child = null;
    // One still being checked before it starts doesn't start.
    this.epoch++;
    if (child) {
      child.stdin.end();
      killTree(child);
    }
    // Every process this session started since it was last closed, one that ended by itself included: each one's marker.
    const marks = this.marks.splice(0);
    this.mark = { value: this.mark.value };
    return Promise.all(
      marks.map((mark) =>
        marked(mark)
          .then((left) => endAll(left, () => marked(mark), this.known.killAfterMs))
          .then(() => undefined, () => undefined)
          // The marker goes with the process that held it, once nothing holds it.
          .finally(() => mark.file && rmSync(mark.file, { force: true })),
      ),
    ).then(() => undefined);
  }
}

/**
  `liner` and the connections as ACP's session/new takes them: a command with its environment, or an
  address with its headers, which only an agent whose mcpCapabilities say http takes.
*/
type AcpMcp = { name: string; command: string; args: string[]; env: { name: string; value: string }[] } | { type: "http"; name: string; url: string; headers: { name: string; value: string }[] };
export function acpMcp(o: Pick<OpenOptions, "mcp" | "mcpName">, connections: Connection[] = [], http = false): AcpMcp[] {
  const pairs = (r: Record<string, string>) => Object.entries(r).map(([name, value]) => ({ name, value }));
  const m = o.mcp;
  return [
    ...(m ? [{ name: o.mcpName ?? "liner", command: m.command, args: m.args, env: pairs(m.env) }] : []),
    ...connections.flatMap((c): AcpMcp[] => {
      // Never in `liner`'s place, whose tools go by themselves (as claude.ts and codex-server.ts keep it), nor where an agent that
      // joins a server's name and a tool's with _ makes one of them: `liner_design`'s `show`. What isn't a letter, digit or - reads as _.
      const name = c.name.replace(/^liner(?![a-zA-Z0-9-])/, "liner-addon");
      return c.stdio ? [{ name, command: c.stdio.command, args: c.stdio.args, env: pairs(c.stdio.env) }] : c.http && http ? [{ type: "http", name, url: c.http.url, headers: pairs(c.http.headers) }] : [];
    }),
  ];
}

/** Each tool's commands, as its last session listed them (an agent that is asked no throwaway session: AcpSpec.quiet). */
const HEARD = new Map<string, CommandInfo[]>();

/** A request Liner Code has no answer for: JSON-RPC's "method not found", which agents treat apart from a failure. */
class Unknown extends Error {}
/** A turn stopped before its prompt went: nothing to wait for. */
class Stopped extends Error {}

/** How long Stop waits for an ACP agent to finish cancelling before its process is stopped. */
export let CANCEL_MS = 15_000;
/** For tests: a shorter wait. */
export const setCancelMs = (ms: number) => void (CANCEL_MS = ms);

function commandOf(call: ToolCall) {
  const raw = call.rawInput as Json | undefined;
  if (raw && typeof raw.command === "string") return raw.command;
  if (raw && Array.isArray(raw.command)) return raw.command.join(" ");
  return call.kind === "execute" ? (call.title ?? "") : "";
}

/**
  The words of a command that only reads, as far as they can be told: all but its flags, a flag's
  value kept, quotes off, as the shell splits them, so a quoted space stays in its path. A $ inside
  single quotes is a character (a grep for "end of line"), so it doesn't count.
*/
export function commandWords(command: string) {
  const bare = shellWords(unwrapped(command)).map((w) => w.replace(/'[^']*'/g, (q) => q.slice(1, -1).replace(/\$/g, "")).replace(/"/g, ""));
  return bare.map((w) => w.replace(/^-[^=]*=/, "")).filter((w) => w && !w.startsWith("-"));
}

/** What Liner Code knows of one agent's ACP, from its AcpSpec: an agent you added gets none of it. */
type Known = {
  levels?: Partial<Record<Access, string>>;
  unasked?: boolean;
  /** Its program, checked before every start (AcpSpec.min): the path to run, or why not, thrown. */
  gate?: (env: NodeJS.ProcessEnv) => Promise<string>;
  systemPrompt?: boolean;
  endsWork?: boolean;
  quietMs?: number;
  hintMs?: number;
  killAfterMs?: number;
  tagged?: boolean;
  noWrites?: boolean;
  refusal?: string;
  /** The words it ends a failed turn with, as if it were done, and what the timeline says then. */
  failedWords?: RegExp;
  failed?: string;
  noModel?: (model: string) => string;
};

/** An access level as the timeline names it. */
const LEVEL_WORDS: Record<Access, string> = { read: "Read only", ask: "Ask", edits: "Edits", auto: "Auto", review: "Reviewer decides", full: "Full access" };
/** agy's line for a call to the model it's trying again ("⚠ API error (attempt 2): Error 429, …"): no news. */
const RETRY = /(?:⚠\s*)?API error \(attempt \d+\)[^\n]*/g;
/** A duration as the timeline says it: "a minute", "15 minutes", "40 seconds". */
const spell = (ms: number) => {
  const [n, unit] = ms >= 60_000 ? [Math.round(ms / 60_000), "minute"] : [Math.max(1, Math.round(ms / 1000)), "second"];
  return n === 1 ? `a ${unit}` : `${n} ${unit}s`;
};
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/**
  A command line that sends something off on its own, past the command: a lone `&` (not `&&`, `2>&1` or `&>`), nohup, setsid,
  disown, a daemon, a fork, a detached child, a detached screen or tmux, at, launchctl, systemd-run. Only a sign: what it sent
  off is ended when its marker finds it (endWork), and said to be untracked when nothing does.
*/
const DETACHES = /(?<![&>|<\d])&(?![&>\d])|\bnohup\b|\bsetsid\b|\bdisown\b|\bdaemon(?:ize)?\b|\bfork\b|detached\s*:\s*true|\.unref\(|\bscreen\s+-[a-zA-Z]*d|\btmux\s+new(?:-session)?\b[^;|&]*\s-d\b|\bstart-stop-daemon\b|\bat\s+now\b|\blaunchctl\s+(?:load|submit|bootstrap)\b|\bsystemd-run\b/;
/** Antigravity's tools whose work goes on after their call: its subagents, a swarm, a schedule, its tasks. */
const BACKGROUND = /^(?:invoke_subagent|define_subagent|manage_subagents|swarm|schedule|manage_task)$/;
/** What Antigravity puts before an argument it shows cut to its end (T3 Code: packages/provider-core/src/server/McpProviderSessions.ts). */
const CUT_MARK = "[Earlier output truncated]";
/** Each agent's base model ids, as its sessions list them ("gemini-3.8-flash"), for reading `agy models` (agyModels). */
const FAMILIES = new Map<string, string[]>();

/**
  What a session's access level lets through, as the model is told it (Antigravity's system prompt, and a line when it
  changes): what will be refused is said up front, since agy ends its turn when Liner Code says no and the model never hears why.
*/
export function levelNote(access: Access, server = "liner") {
  const level = {
    read: `Liner Code holds this session to Read only: read files and answer. Editing or writing a file, a command that changes anything, and tools of servers other than ${server} are refused, and a refusal ends your turn, so don't try them: say what you would change instead.`,
    ask: "Liner Code asks the person before each file edit and each command (Ask). A step they refuse ends your turn.",
    edits: "File edits inside the project go ahead; Liner Code asks the person before commands (Edits).",
    auto: "Liner Code's Reviewer answers routine steps and asks the person about the rest (Auto).",
    review: "Liner Code's Reviewer decides each step you'd ask about (Reviewer decides).",
    full: "File edits and commands go ahead without asking (Full access).",
  }[access];
  return `Access level now: ${level} This holds until you're told of another.`;
}

/** Where a sentence kept for a later turn names Liner Code's server: replaced by the name of the process running then (turn). */
const SERVER_NOW = "\u0000liner-server\u0000";
/** A name for Liner Code's server that no server of the person's has (AcpSpec.tagged): `liner_` and six hex digits, new each time. */
const newServerName = () => `liner_${randomBytes(3).toString("hex")}`;

/**
  The names Liner Code's tools have in this process of the agent's (AcpSpec.tagged), in the conversation at its first turn, as its
  level is: they change each time it starts, and its system prompt, which it keeps across a resume, names none.
*/
export function namesNote(server: string) {
  return `Liner Code's tools are on the MCP server ${server} now: call each as mcp_${server}_<tool>, for example mcp_${server}_design_show and mcp_${server}_server_start. That name is new each time the agent starts; a tool under any other liner_ name, one from before included, isn't Liner Code's.`;
}

/**
  What holds for an agent whose background work Liner Code ends with each turn (AcpSpec.endsWork), for its whole session: in
  its system prompt. agy asks nothing before a schedule or a swarm, so this is where it hears that none outlives a turn.
*/
export function standingNote(bin: string, server = "liner") {
  return [
    `Nothing outlives your turn here. When it ends, Liner Code ends everything ${bin} started: scheduled tasks (schedule), swarms, subagents (invoke_subagent), commands left in the background, and daemons (IsDaemon), so their work would stop unseen and unreported. Liner Code does this because the person can only see, and stop, what happens inside a turn.`,
    `So run what you need inside the turn and wait for it to finish. For a dev server, use ${server}'s server_start (mcp_${server}_server_start${server.includes("<tag>") ? ", <tag> as the conversation last named it" : ""}), which Liner Code keeps running between turns and shows in the person's Browser; don't start one from a command.`,
  ].join(" ");
}

export type AcpSpec = {
  label: string;
  cmd: string[];
  install?: string;
  login: string;
  env?: Record<string, string>;
  added?: ProviderInfo["added"];
  detail?: string;
  /** The agent's own mode for each access level (AcpSession.levelModes), for an agent whose modes Liner Code knows. */
  modes?: Partial<Record<Access, string>>;
  /** The first version whose ACP Liner Code drives: an older one, or another program of the same name, isn't taken for it. */
  min?: string;
  /**
    Its sign-in and models from a command of its own that opens no session (Antigravity: `agy models`). Such an agent is asked
    no throwaway session at all, since each would stay in the person's history: its commands come from its own sessions.
  */
  listed?: (path: string, env: NodeJS.ProcessEnv, families?: string[]) => Promise<{ signedIn?: boolean; models: ModelInfo[] }>;
  /** It calls tools of the MCP servers it's handed without asking (AcpSession.handed): the person's connections come only at Full. */
  unasked?: boolean;
  /** Liner Code's instructions go in its system prompt where it says it takes them (Antigravity's _meta.antigravity.systemPrompt). */
  systemPrompt?: boolean;
  /** What it starts may go on after its prompt answers (AcpSession.endWork): ended with the turn, and with Stop. */
  endsWork?: boolean;
  /** A prompt it leaves this long with nothing open ends the turn. */
  quietMs?: number;
  /** A prompt with nothing new from it this long says so on the timeline, once, with Stop beside it. */
  hintMs?: number;
  /** How long what it started gets to end when asked (SIGTERM) before it's ended for good (SIGKILL): exec.ts endAll's 2 s unless set. */
  killAfterMs?: number;
  /**
    Liner Code's server goes to it under a name of its own, liner_<tag>, made new each time its process starts and kept nowhere
    (AcpSession.server): agy lets an MCP server of the person's own config take the place of one it's handed over ACP by the same
    name, so `liner`, or any name kept from an earlier session, could be theirs.
  */
  tagged?: boolean;
  /** Liner Code doesn't offer to write files for it, so it keeps to its own edits with their diffs. */
  noWrites?: boolean;
  /** What a `refusal` stop means for it, as the timeline says it. */
  refusal?: string;
  /** The words it ends a turn that failed with, as though it were done, and what the timeline says then. */
  failedWords?: RegExp;
  failed?: string;
  /** What's said when the model you picked isn't one it will run. */
  noModel?: (model: string) => string;
};

/**
  Shorter waits for a dev run (--dev) only, so a check can see the quiet watchdog and the silence hint without waiting a quarter of
  an hour: LINER_DEV_QUIET_MS and LINER_DEV_HINT_MS, in milliseconds, for every tool whose spec has them (main.ts reads them).
*/
const DEV_WAITS: { quietMs?: number; hintMs?: number } = {};
export function devWaits(env: NodeJS.ProcessEnv) {
  const ms = (v: string | undefined) => (v && Number(v) > 0 ? Number(v) : undefined);
  DEV_WAITS.quietMs = ms(env.LINER_DEV_QUIET_MS);
  DEV_WAITS.hintMs = ms(env.LINER_DEV_HINT_MS);
}

/** What a program's --version said, by the file as it is now: checked again when it changes (another build put in its place). */
const GATES = new Map<string, { version?: string; why?: string }>();
/**
  toolGate for the file at `path`, kept by the file's identity, size and times: its change time (ctime) too, which a file put in
  its place can't set back the way it can its modification time, so a swap of the same size with its mtime restored is checked
  again. The file isn't hashed: agy is some 230 MB.
*/
export async function checkGate(path: string, env: NodeJS.ProcessEnv, min: string, label: string, bin: string) {
  let key = path;
  try {
    const real = realpathSync(path);
    const st = statSync(real);
    key = `${real}|${st.ino}|${st.size}|${st.mtimeMs}|${st.ctimeMs}`;
  } catch {
    // Unreadable: asked every time.
  }
  const had = GATES.get(key);
  if (had) return had;
  const said = await run(path, ["--version"], { env, timeout: 8000 });
  const gate = toolGate(`${said.stdout}\n${said.stderr}`, said.code, min, label, bin);
  if (key !== path) GATES.set(key, gate);
  return gate;
}

/**
  What a `<bin> --version` says about the tool: its version, or why this isn't one Liner Code drives. An editor's launcher
  (VS Code's way, which the Antigravity editor's `antigravity`, and the `agy` it once made, follow) answers with its version,
  a commit and the architecture, each on a line of its own; a build older than `min` has no ACP to talk over.
*/
export function toolGate(said: string, code: number | null, min: string, label: string, bin: string): { version?: string; why?: string } {
  const lines = said.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => /\d+\.\d+\.\d+/.test(l));
  const version = line?.slice(0, 80);
  if (lines.some((l) => /^[0-9a-f]{40}$/.test(l))) return { version, why: `The ${bin} here is an editor's launcher, not ${label}. Install ${label} to use it here.` };
  const v = /(\d+)\.(\d+)\.(\d+)/.exec(line ?? "");
  if (code !== 0 || !v) return { why: `${bin} didn't say which version it is, so it can't be told apart from another program of that name.` };
  const want = min.split(".").map(Number);
  const has = v.slice(1, 4).map(Number);
  const i = has.findIndex((n, k) => n !== want[k]);
  if (i >= 0 && has[i] < want[i]) return { version, why: `${label} ${v[0]} has no ACP for Liner Code to talk over: it needs ${min} or later. Update it, then look again.` };
  return { version };
}

/** How long what a tool's own list said (its sign-in and models, AcpSpec.listed) is kept: a look and the model ask after it share one. */
const LISTED_MS = 60_000;

/** A tool that speaks ACP: found by its command, its models and commands asked of a throwaway session. */
export function acpProvider(id: ProviderId, spec: AcpSpec): Provider {
  const { label, cmd } = spec;
  // OpenCode however it's started (an agent you added as `npx opencode-ai acp`), and last, so no variable of yours undoes it.
  const isOpenCode = cmd.some((word) => /opencode/i.test(word));
  const own = { ...spec.env, ...(isOpenCode ? { OPENCODE_PERMISSION: opencodeAsks() } : {}) };
  const envOf = (env: NodeJS.ProcessEnv) => ({ ...env, ...own });
  let last: { key: string; at: number; said: Promise<{ signedIn?: boolean; models: ModelInfo[] }> } | undefined;
  const listed = (path: string, env: NodeJS.ProcessEnv) => {
    const key = `${path}|${env.HOME ?? ""}`;
    if (!last || last.key !== key || Date.now() - last.at > LISTED_MS) last = { key, at: Date.now(), said: spec.listed!(path, env, FAMILIES.get(id)).catch(() => ({ models: [] })) };
    return last.said;
  };
  return {
    id,
    async detect(env) {
      const path = which(cmd[0], envOf(env));
      const base = { id, label, adapter: true, login: spec.login, models: [{ id: "default", label: `${label} default`, description: `The model ${label} is set up with` }], modelsFrom: "builtin" as const, added: spec.added, supports: { approvals: true, resume: true, effort: false, plan: true } };
      if (!path) return { ...base, available: false, detail: `${label} isn't installed.`, install: spec.install };
      // A package runner (npx, uvx) reports its own version, not the agent's.
      const runner = /^(npx|uvx|bunx|pnpx)$/.test(cmd[0]);
      const detail = spec.detail ?? "Talks over the Agent Client Protocol";
      if (!spec.min) return { ...base, available: true, version: runner ? undefined : await versionOf(path, envOf(env)), detail };
      const gate = await checkGate(path, envOf(env), spec.min, label, cmd[0]);
      if (gate.why) return { ...base, available: false, version: gate.version, detail: gate.why };
      if (!spec.listed) return { ...base, available: true, version: gate.version, detail };
      // Asked of the tool itself, by a command that opens no session, never read from where it keeps its sign-in.
      const { signedIn, models } = await listed(path, envOf(env));
      const effort = models.some((m) => m.efforts?.length);
      // Its list is the tool's own, asked just now: no older answer kept on disk stands in for it.
      const listedNow = models.length ? { models: [base.models[0], ...models], modelsFrom: "cli" as const, modelsAt: Date.now() } : {};
      return { ...base, ...listedNow, available: true, version: gate.version, signedIn, supports: { ...base.supports, effort }, detail: signedIn === undefined ? `${detail}; it didn't say whether it's signed in` : detail };
    },
    models: async (env, scratch) => {
      if (!spec.listed) return acpModels(cmd, label, envOf(env), scratch);
      const path = which(cmd[0], envOf(env));
      const models = path ? (await listed(path, envOf(env))).models : [];
      return models.length ? [{ id: "default", label: `${label} default`, description: `The model ${label} is set up with` }, ...models] : [];
    },
    // An agent asked no throwaway session lists its commands as its own sessions said them.
    commands: async (env, cwd) => ({ commands: spec.listed ? (HEARD.get(id) ?? []) : await acpCommands(cmd, envOf(env), cwd), skills: [] }),
    open: (o) => {
      const env = envOf(o.env);
      // The program that runs is the one the gate passed, found again and checked again before each start.
      const gate = spec.min
        ? async (e: NodeJS.ProcessEnv) => {
            const path = which(cmd[0], e);
            if (!path) throw new Error(`${label} isn't installed.`);
            const g = await checkGate(path, e, spec.min!, label, cmd[0]);
            if (g.why) throw new Error(g.why);
            return path;
          }
        : undefined;
      const known: Known = { levels: spec.modes, unasked: spec.unasked, gate, systemPrompt: spec.systemPrompt, endsWork: spec.endsWork, quietMs: spec.quietMs && (DEV_WAITS.quietMs ?? spec.quietMs), hintMs: spec.hintMs && (DEV_WAITS.hintMs ?? spec.hintMs), killAfterMs: spec.killAfterMs, tagged: spec.tagged, noWrites: spec.noWrites, refusal: spec.refusal, failedWords: spec.failedWords, failed: spec.failed, noModel: spec.noModel };
      return new AcpSession({ ...o, env: isOpenCode ? { ...env, ...opencodeEnv(o.cwd, env, Boolean(o.mcp)) } : env, dirs: isOpenCode ? [...(o.dirs ?? []), opencodeOutputs(o.env)] : o.dirs }, cmd, spec.login, isOpenCode, id, known);
    },
  };
}

export const hermes: Provider = {
  ...acpProvider("hermes", { label: "Hermes", cmd: ["hermes", "acp"], install: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash", login: "hermes model" }),
  // Its limits are in your own config, which Liner Code doesn't change: a sidekick's brief is cut to fit them instead.
  toolWait: (env) => hermesWait(env),
  // OpenCode Go's windows, when Hermes has a Go key: they count for its opencode-go models only.
  async limits(env) {
    const key = hermesGoKey(env);
    const windows = key ? await goUsage([key]) : null;
    return windows && { plan: "OpenCode Go", windows, models: "opencode-go" };
  },
};
export const opencode: Provider = {
  ...acpProvider("opencode", { label: "OpenCode", cmd: ["opencode", "acp"], install: "npm install -g opencode-ai && opencode auth login", login: "opencode auth login" }),
  // OpenCode Go's windows, when it signed in with a Go key; Zen and the rest have none to show.
  async limits(env) {
    const keys = goKeys(env);
    const windows = keys.length ? await goUsage(keys) : null;
    return windows && { plan: "Go", windows, models: "opencode-go" };
  },
};
export const cursor = acpProvider("cursor", { label: "Cursor", cmd: ["cursor-agent", "acp"], install: "curl https://cursor.com/install -fsS | bash", login: "cursor-agent login" });
// Grok Build asks before each step the same way; Liner Code answers from the session's access.
export const grok = acpProvider("grok", { label: "Grok Build", cmd: ["grok", "agent", "stdio"], install: "npm install -g @xai-official/grok", login: "grok login" });
/**
  Google's Antigravity CLI, whose ACP came in 1.5.0 (`agy acp`). Its own settings may start it in a mode that acts before
  Liner Code is asked, so each level puts it in a mode of its own: Read only plans, and Liner Code refuses what its plan mode
  still asks to do; every other level works in its default mode, which asks before edits and commands, and Liner Code
  answers by the level, its Reviewer at Auto, as for OpenCode (T3 Code does the same: "providers without an equivalent,
  including OpenCode and Antigravity, fall back to asking", docs/user/permission-modes.md). Its own auto mode would act with
  nothing to review: on an account it wrote plans outside the project unasked. It keeps its sign-in in the keychain, so
  whether it has one is asked of it (`agy models`). Liner Code's server goes to it with each session over ACP, as liner_<tag>, new in each process (it names the tools
  mcp_liner_<tag>_<tool>): nothing is written to its own MCP config (~/.gemini/config/mcp_config.json, which the Antigravity app reads
  too). The person's connections go only at Full, and only those that run as a command: it takes none by address. What it
  starts in the background (subagents, a schedule, a daemon) ends with the turn. It updates itself, so Liner Code doesn't.
*/
/** Antigravity as Liner Code drives it, for a test to start from with shorter waits. */
export const ANTIGRAVITY: AcpSpec = {
  label: "Antigravity CLI",
  cmd: ["agy", "acp"],
  install: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
  login: "agy acp --login",
  modes: { read: "plan", ask: "default", edits: "default", auto: "default", review: "default", full: "default" },
  min: "1.5.0",
  listed: agyModels,
  unasked: true,
  systemPrompt: true,
  endsWork: true,
  quietMs: 15 * 60_000,
  hintMs: 60_000,
  tagged: true,
  noWrites: true,
  // It stops a turn this way only when Google says the quota is used up (T3 Code: apps/server/src/provider/acp/AntigravityTurnOutcome.ts).
  refusal: "Antigravity stopped: the quota for this period looks used up (that's how it reports one). See /usage in agy, or try again later.",
  // Seen on 1.5.6 for Google's 429 RESOURCE_EXHAUSTED (QUOTA_EXHAUSTED): an ordinary end, and only this in its answer.
  failedWords: /Agent execution terminated due to error/,
  failed: "Antigravity stopped on an error from Google that it didn't name: most often a used-up quota or a rate limit. See /usage in agy, or try again later.",
  // T3 Code's sentence for it (apps/server/src/provider/acp/AntigravityAcpSupport.ts, applyAntigravityAcpModelSelection, MIT).
  noModel: (model) => `Antigravity model '${model}' is unavailable for this Google account. Select an available model.`,
};
export const antigravity = acpProvider("antigravity", ANTIGRAVITY);
