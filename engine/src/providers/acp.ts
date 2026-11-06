/*
  Any agent that speaks the Agent Client Protocol (JSON-RPC over stdio): Hermes (`hermes acp`),
  OpenCode (`opencode acp`), Cursor (`cursor-agent acp`), Grok Build (`grok agent stdio`), and any
  agent you add from the ACP registry or as a command of your own. The engine is the client: it
  answers the agent's permission requests with the approval card, and reads and writes files for
  it inside the project.
*/
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { ProviderId, ProviderInfo, Question, ToolKind } from "../../../contracts/src/index.ts";
import { closesOnExit, jsonLines, killTree, spawn, versionOf, which } from "../exec.ts";
import { VERSION } from "../version.ts";
import { commandRisk, isDestructive, ruleFor } from "../risk.ts";
import { linerTitle } from "../agent-tools.ts";
import { acpCommands, acpModelRequest, acpModels } from "./models.ts";
import { imageType, readUpTo } from "./attachments.ts";
import { goKeys, goUsage, hermesGoKey } from "./opencode-go.ts";
import { ResumeFailed, scrub, type OpenOptions, type Provider, type ProviderSession, type TurnSink } from "./types.ts";
import type { Connection } from "../addons.ts";

type Json = Record<string, unknown>;
type Msg = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Json; result?: Json; error?: { code: number; message: string } };
/** How much of a tool's output the app gets, its end; the running output reaches it a few times a second (T3 Code: provider-acp runtimeModel.ts bounds it to a tail and coalesces too). */
const OUTPUT_MAX = 20000;
const OUTPUT_EVERY_MS = 250;
/** ACP's auth_required (T3 Code: AcpSessionRuntime.ts). */
const AUTH_REQUIRED = -32000;
type ToolCall = { toolCallId: string; title?: string; kind?: string; status?: string; content?: Json[]; locations?: { path: string }[]; rawInput?: unknown; rawOutput?: unknown };

const KIND: Record<string, ToolKind> = { read: "read", edit: "edit", delete: "edit", move: "edit", search: "search", execute: "exec", think: "think", fetch: "fetch" };

/**
  A path with its links followed, what doesn't exist yet kept as written; null when that can't be
  told, as for a link to nothing, which a write would follow out (T3 Code: provider-acp clientPolicy.ts).
*/
function realPath(path: string) {
  const missing: string[] = [];
  const absent = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
  for (let at = path; ; at = dirname(at)) {
    try {
      return resolve(realpathSync.native(at), ...missing);
    } catch (e) {
      if (!absent(e)) return null;
    }
    try {
      lstatSync(at);
      return null;
    } catch (e) {
      if (!absent(e)) return null;
    }
    if (dirname(at) === at) return null;
    missing.unshift(basename(at));
  }
}

/** Whether a path is really in a folder, once its links are followed. */
export function inFolder(folder: string, path: unknown) {
  const root = realPath(folder);
  const real = realPath(resolve(folder, String(path)));
  if (!root || !real) return false;
  const rel = relative(root, real);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
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
  /** The agent's own modes: its plan-like one Read only puts it in, the one it works in otherwise, and the config option that sets them, if one does. */
  private modes: { read?: string; work?: string; via?: string } = {};
  /** A mode it didn't switch to: tried again before the next prompt. */
  private wanted: string | undefined;
  /** What it said while it started, with no turn to say it in yet. */
  private notes: string[] = [];
  /** Tools' output waiting for its next showing, by call. */
  private later = new Map<string, NodeJS.Timeout>();
  /** When each call's output last reached the app. */
  private shown = new Map<string, number>();
  private stderr = "";
  private o: OpenOptions;
  private cmd: string[];
  /** The command that signs this agent in. */
  private login: string;

  constructor(o: OpenOptions, cmd: string[], login = "") {
    this.o = o;
    this.cmd = cmd;
    this.login = login;
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
    const [bin, ...args] = this.cmd;
    const path = which(bin, this.o.env);
    if (!path) throw new Error(`${bin} isn't installed.`);
    // A process group of its own, so stopping it stops what it started too: an npx or uvx launcher's agent, its
    // commands (T3 Code: AcpSessionRuntime.ts spawns with ownDetachedProcessGroup).
    const child = spawn(path, args, { cwd: this.o.cwd, env: this.o.env, stdio: ["pipe", "pipe", "pipe"], detached: true }) as ChildProcessWithoutNullStreams;
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
    if (process.platform !== "win32") child.on("exit", () => killTree(child));
    closesOnExit(child);
    child.on("close", (code) => {
      fail(new Error(this.said() || unstarted || `${bin} exited with ${code}.`));
      if (this.child !== child && this.child) return;
      this.child = null;
      this.booting = null;
    });
    this.booting = (async () => {
      const init = await this.request("initialize", {
        protocolVersion: 1,
        // Forms: an agent only asks what a client says it can show. OpenCode's question tool is dropped without it
        // (T3 Code: provider-acp adapter.ts).
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false, elicitation: { form: {} } },
        clientInfo: { name: "liner-code", title: "Liner Code", version: VERSION },
      });
      const caps = init.agentCapabilities as Json | undefined;
      this.canLoad = Boolean(caps?.loadSession);
      this.images = Boolean((caps?.promptCapabilities as Json | undefined)?.image);
      this.http = Boolean((caps?.mcpCapabilities as Json | undefined)?.http);
      let s: Json | null = null;
      if (this.o.resume && this.canLoad) {
        s = await this.request("session/load", { sessionId: this.o.resume, cwd: this.o.cwd, mcpServers: this.mcpServers() }).catch(() => null);
        if (s) {
          this.session = this.o.resume;
          this.spent = null;
          // A session it loads already holds its instructions, from the turn that first sent them.
          this.soulSent = true;
          // It couldn't a start ago (the process went), and can now.
          if (this.lost === this.o.resume) this.lost = undefined;
        }
      }
      if (!s) {
        // A session it can't load (or an agent that loads none) starts knowing nothing: the runtime is told,
        // not left to think it resumed (T3 Code: ProviderTurnStartService.ts, its resume fallback).
        if (this.o.resume) this.lost = this.o.resume;
        s = await this.request("session/new", { cwd: this.o.cwd, mcpServers: this.mcpServers() });
        this.session = String(s.sessionId);
        // Started again after its process ended, it loads this session rather than the one it opened with.
        this.o.resume = this.session;
        this.spent = 0;
      }
      // A loaded session gets the model and the mode too: a model you switched to reopens the session to
      // load it, on the model it had (T3 Code: provider-acp adapter.ts sets the model after start or load).
      // A model picked in Liner Code, through whichever way this agent takes one.
      const pick = acpModelRequest(s, this.session!, this.o.model);
      // No turn to say it in yet: the turn says it once the agent is up.
      if (pick) await this.request(pick.method, pick.params).catch(() => void this.notes.push(`${this.cmd[0]} didn't switch to ${this.o.model}; it runs on its own default.`));
      // Read only maps onto a plan-like mode where the agent offers one. The mode it works in otherwise is kept to
      // go back to, and a session loaded in the plan-like mode goes back to it (T3 Code: provider-acp adapter.ts,
      // nativeBuildConfigurationBySessionId).
      const { via, now, ids } = modesOf(s);
      const read = ids.find(readMode);
      this.modes = { read, via, work: typeof now === "string" && now !== read ? now : ids.find((m) => m !== read) };
      const want = this.o.access === "read" || this.o.planning ? read : read && now === read ? this.modes.work : undefined;
      this.wanted = want === now ? undefined : want;
      if (this.wanted) await this.setMode(this.wanted).catch(() => {});
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
    try {
      await this.request(via ? "session/set_config_option" : "session/set_mode", via ? { sessionId: this.session, configId: via, value: id } : { sessionId: this.session, modeId: id });
      if (this.wanted === id) this.wanted = undefined;
    } catch (e) {
      // Wanted only once it's failed: one still on its way needn't be sent again, or waited for.
      this.wanted = id;
      throw e;
    }
  }

  /** Liner Code's own tools and your connections, as ACP takes MCP servers. */
  private mcpServers() {
    return acpMcp(this.o, this.o.connections, this.http);
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
      return this.onUpdate(params.update as Json);
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
      // Ask first holds here too, for an agent that writes without asking; one that asked for this file has its answer.
      if (this.o.access === "ask" && !this.granted.has(abs)) {
        const sink = this.sink;
        const signal = this.signal;
        if (!sink || !signal) throw new Error("Nothing can allow this write now.");
        const fields = [{ label: "File", value: this.rel(abs) }, { label: "Where", value: this.o.cwd }];
        const a = await sink.approve({ tool: "edit", title: `Write ${this.rel(abs)}`, risk: "low", fields, rule: "Edit" }, signal).catch(() => ({ allow: false }));
        if (!a.allow) throw new Error("You didn't allow this write.");
      }
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, String(p.content ?? ""));
      return {};
    }
    if (method === "session/request_permission") {
      const call = { ...(this.calls.get(String((p.toolCall as ToolCall)?.toolCallId)) ?? {}), ...(p.toolCall as ToolCall) };
      const options = (p.options as { optionId: string; kind: string }[]) ?? [];
      const pick = (allow: boolean) => (options.find((o) => o.kind === (allow ? "allow_once" : "reject_once")) ?? options.find((o) => o.kind.startsWith(allow ? "allow" : "reject")))?.optionId;
      const command = commandOf(call);
      const kindNow = KIND[call.kind ?? ""] ?? "other";
      // An edit goes by itself only when every file it names is in the project (T3 Code: provider-acp clientPolicy.ts).
      const files = call.locations ?? [];
      const stray = files.find((l) => !this.inProject(l.path));
      const scoped = files.length > 0 && !stray;
      // Edits go ahead from Edits on its own up; Auto and Reviewer decides hand the rest to Liner Code.
      const free = this.o.access === "full" || ((this.o.access === "edits" || this.o.access === "auto" || this.o.access === "review") && kindNow === "edit" && scoped);
      // Allowed, with no way offered to say so: not a yes with nothing in it.
      if (free && !(this.o.guard && isDestructive(command))) {
        const id = pick(true);
        return id ? { outcome: { outcome: "selected", optionId: id } } : { outcome: { outcome: "cancelled" } };
      }
      const sink = this.sink;
      const signal = this.signal;
      if (!sink || !signal) return { outcome: { outcome: "cancelled" } };
      const kind = KIND[call.kind ?? ""] ?? "other";
      const file = stray ?? files[0];
      const fields = [command && { label: "Command", value: command }, file && { label: "File", value: this.rel(file.path) }, { label: "Where", value: this.o.cwd }].filter(Boolean) as { label: string; value: string }[];
      // An edit outside the project, or of files it doesn't name, is yours each time: high, so Auto and the Reviewer leave it to you, and no rule.
      const loose = kind === "edit" && !scoped;
      // Not "other" either: it's a catch-all, so a rule for it would allow every tool nobody named (T3 Code never turns an unknown request into a grant).
      const rule = loose || kind === "other" ? undefined : kind === "exec" ? ruleFor(command) : kind === "edit" ? "Edit" : call.kind;
      const description = loose ? (stray ? "This file is outside the project." : "The agent didn't say which files this changes.") : undefined;
      const a = await sink.approve({ key: call.toolCallId, tool: call.kind ?? "tool", title: call.title ?? "Use a tool", description, risk: loose ? "high" : kind === "exec" ? commandRisk(command) : "low", fields, rule }, signal).catch(() => ({ allow: false }));
      // Stopped while it asked: a request open when the prompt is cancelled is answered "cancelled", as ACP
      // asks, not as a no (T3 Code: provider-acp adapter.ts).
      if (signal.aborted) return { outcome: { outcome: "cancelled" } };
      if (a.allow) for (const f of files) this.granted.add(resolve(this.o.cwd, f.path));
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
      const answers = await sink.ask(fields.map((f) => f.question), signal).catch(() => null);
      if (signal.aborted) return { action: "cancel" };
      // Skipped: cancelling would end OpenCode's turn, and skipping lets it carry on. Left unanswered, it does.
      if (!answers) return schema?.required?.length ? { action: "decline" } : { action: "accept", content: {} };
      return { action: "accept", content: formContent(fields, answers) };
    }
    throw new Unknown(`Liner Code doesn't handle ${method} yet.`);
  }

  private rel(p: string) {
    return p.startsWith(this.o.cwd + "/") ? p.slice(this.o.cwd.length + 1) : p;
  }

  private onUpdate(u: Json) {
    const sink = this.sink;
    if (!sink || !u) return;
    const kind = u.sessionUpdate;
    // An agent that leaves out messageId (it's optional) gets a new paragraph after each tool call, not one for the whole turn.
    if (kind === "agent_message_chunk") sink.text(blockText(u.content), u.messageId ? String(u.messageId) : undefined);
    else if (kind === "agent_thought_chunk") sink.reasoning(blockText(u.content), u.messageId ? String(u.messageId) : undefined);
    else if (kind === "tool_call" || kind === "tool_call_update") {
      const prev = this.calls.get(String(u.toolCallId));
      const call: ToolCall = { ...prev, ...(u as ToolCall), content: (u.content as Json[] | undefined) ?? prev?.content };
      this.calls.set(call.toolCallId, call);
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
    const status = call.status === "completed" ? "done" : call.status === "failed" ? "failed" : "running";
    const path = call.locations?.[0]?.path ?? ((call.content ?? []).find((c) => c.type === "diff")?.path as string | undefined);
    // Liner Code's own tools, under the name the agent gives them ("liner_design_show"): named and titled as every tool names them.
    const ours = /^(?:mcp__)?liner(?:__|[_.:])([a-z_]+)$/.exec(call.title ?? "")?.[1];
    sink.tool({
      key: call.toolCallId,
      // OpenCode's question tool is the question card, as AskUserQuestion is: not a row of its own as well.
      tool: ours ? `liner.${ours}` : call.title === "question" ? "AskUserQuestion" : (call.kind ?? "tool"),
      toolKind: KIND[call.kind ?? ""] ?? "other",
      title: ours ? linerTitle(ours, call.rawInput) : (call.title ?? "Use a tool"),
      path: path ? this.rel(path) : undefined,
      input: call.rawInput === undefined ? undefined : JSON.stringify(call.rawInput, null, 2),
      output: out.length > OUTPUT_MAX ? `…${out.slice(-OUTPUT_MAX)}` : out || (call.rawOutput === undefined ? undefined : JSON.stringify(call.rawOutput, null, 2).slice(0, OUTPUT_MAX)),
      status,
    });
  }

  async turn(text: string, sink: TurnSink, signal: AbortSignal, files: string[] = []) {
    if (!this.child) this.boot();
    // Stop reaches an agent that's still starting too: one that never answers would hold the turn for good.
    const stopped = new Promise<void>((r) => (signal.aborted ? r() : signal.addEventListener("abort", () => r(), { once: true })));
    await Promise.race([this.booting, stopped]);
    // Stopped while the agent was starting: nothing was asked of it yet. A session it couldn't load is said
    // on the next turn instead, so that one still gets the conversation so far.
    if (signal.aborted) return;
    for (const note of this.notes.splice(0)) sink.notice(note);
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
    // A call is only asked about in its turn.
    this.calls.clear();
    this.shown.clear();
    // An agent that hasn't finished cancelling 15 seconds after Stop is stopped itself, and the turn
    // ends as stopped; the next turn starts it again on the same session (T3 Code: AcpSessionRuntime.ts, defaultCancelTimeout).
    let late: NodeJS.Timeout | undefined;
    let giveUp = () => {};
    const gaveUp = new Promise<null>((r) => (giveUp = () => r(null)));
    const cancel = () => {
      this.send({ method: "session/cancel", params: { sessionId: this.session } });
      late = setTimeout(() => {
        this.close();
        giveUp();
      }, CANCEL_MS);
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      // A mode it didn't switch to goes again, and the agent's own mode is said to be off if it still won't
      // (T3 Code: AcpAdapterV2.test.ts, "reapplies a selection after a switch away from it failed partway").
      if (this.wanted) {
        const mode = this.wanted;
        const missed = await Promise.race([this.setMode(mode).then(() => false, () => true), stopped]);
        if (signal.aborted) return;
        if (missed) sink.notice(mode === this.modes.read ? `${this.cmd[0]} didn't switch to its read-only mode: what it wants to change still comes to you.` : `${this.cmd[0]} didn't leave its read-only mode, so it may only plan.`);
      }
      const said = this.o.soul && !this.soulSent ? `${this.o.soul}\n\n${text}` : text;
      this.soulSent = true;
      // Your images go as they are when the agent takes them; every file is named in the text either way.
      const images = this.images ? files.flatMap((f) => {
        const mimeType = imageType(f);
        const bytes = mimeType ? readUpTo(f, 20 * 1024 * 1024) : null;
        return mimeType && bytes ? [{ type: "image", mimeType, data: bytes.toString("base64") }] : [];
      }) : [];
      const r = await Promise.race([this.request("session/prompt", { sessionId: this.session, prompt: [{ type: "text", text: said }, ...images] }), gaveUp]);
      if (!r) return;
      const usage = r.usage as { totalTokens?: number; inputTokens?: number; outputTokens?: number; thoughtTokens?: number | null; cachedReadTokens?: number | null } | undefined;
      if (usage) {
        // ACP leaves open whether inputTokens counts cache reads: most agents do, OpenCode doesn't (Kun: acp-event-mapper.ts, applyPromptResult).
        // Liner's input is the uncached part, so reads come off it unless the numbers show they were never in it.
        const input = usage.inputTokens ?? 0, output = usage.outputTokens ?? 0, reads = usage.cachedReadTokens ?? 0;
        const total = usage.totalTokens ?? input + output;
        const excludes = reads > input || total >= input + output + (usage.thoughtTokens ?? 0) + reads;
        sink.usage({ inputTokens: excludes ? input : Math.max(0, input - reads), outputTokens: output, cacheReadTokens: reads });
      }
      if (r.stopReason === "refusal") sink.notice("The agent declined this one.");
      if (r.stopReason === "max_tokens") sink.notice("The agent ran out of room in this turn.");
    } finally {
      clearTimeout(late);
      signal.removeEventListener("abort", cancel);
      for (const timer of this.later.values()) clearTimeout(timer);
      this.later.clear();
      this.sink = null;
      this.signal = null;
    }
  }
  private soulSent = false;

  async update(o: Pick<OpenOptions, "model" | "effort" | "access">) {
    const reopen = o.model !== this.o.model;
    // Into Read only or out of it: the agent's own mode goes with it, or it would go on planning (or editing) as it was.
    const mode = this.o.planning || (o.access === "read") === (this.o.access === "read") ? undefined : o.access === "read" ? this.modes.read : this.modes.work;
    Object.assign(this.o, o);
    // Not waited on: it reaches the agent before the next prompt all the same, and one slow to answer doesn't hold that turn.
    if (mode && !reopen && this.child && this.session) void this.setMode(mode).catch(() => {});
    return !reopen;
  }

  close() {
    const child = this.child;
    this.child = null;
    if (!child) return;
    child.stdin.end();
    killTree(child);
  }
}

/**
  `liner` and the connections as ACP's session/new takes them: a command with its environment, or an
  address with its headers, which only an agent whose mcpCapabilities say http takes.
*/
type AcpMcp = { name: string; command: string; args: string[]; env: { name: string; value: string }[] } | { type: "http"; name: string; url: string; headers: { name: string; value: string }[] };
export function acpMcp(o: Pick<OpenOptions, "mcp">, connections: Connection[] = [], http = false): AcpMcp[] {
  const pairs = (r: Record<string, string>) => Object.entries(r).map(([name, value]) => ({ name, value }));
  const m = o.mcp;
  return [
    ...(m ? [{ name: "liner", command: m.command, args: m.args, env: pairs(m.env) }] : []),
    ...connections.flatMap((c): AcpMcp[] => (c.stdio ? [{ name: c.name, command: c.stdio.command, args: c.stdio.args, env: pairs(c.stdio.env) }] : c.http && http ? [{ type: "http", name: c.name, url: c.http.url, headers: pairs(c.http.headers) }] : [])),
  ];
}

/** A request Liner Code has no answer for: JSON-RPC's "method not found", which agents treat apart from a failure. */
class Unknown extends Error {}

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

type AcpSpec = { label: string; cmd: string[]; install?: string; login: string; env?: Record<string, string>; added?: ProviderInfo["added"]; detail?: string };

/** A tool that speaks ACP: found by its command, its models and commands asked of a throwaway session. */
export function acpProvider(id: ProviderId, spec: AcpSpec): Provider {
  const { label, cmd } = spec;
  const envOf = (env: NodeJS.ProcessEnv) => (spec.env ? { ...env, ...spec.env } : env);
  return {
    id,
    async detect(env) {
      const path = which(cmd[0], envOf(env));
      const base = { id, label, adapter: true, login: spec.login, models: [{ id: "default", label: `${label} default`, description: `The model ${label} is set up with` }], modelsFrom: "builtin" as const, added: spec.added, supports: { approvals: true, resume: true, effort: false, plan: true } };
      if (!path) return { ...base, available: false, detail: `${label} isn't installed.`, install: spec.install };
      // A package runner (npx, uvx) reports its own version, not the agent's.
      const runner = /^(npx|uvx|bunx|pnpx)$/.test(cmd[0]);
      return { ...base, available: true, version: runner ? undefined : await versionOf(path, envOf(env)), detail: spec.detail ?? "Talks over the Agent Client Protocol" };
    },
    models: (env, scratch) => acpModels(cmd, label, envOf(env), scratch),
    commands: async (env, cwd) => ({ commands: await acpCommands(cmd, envOf(env), cwd), skills: [] }),
    open: (o) => new AcpSession({ ...o, env: envOf(o.env) }, cmd, spec.login),
  };
}

export const hermes: Provider = {
  ...acpProvider("hermes", { label: "Hermes", cmd: ["hermes", "acp"], install: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash", login: "hermes model" }),
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
