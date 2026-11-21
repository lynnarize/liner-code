/*
  Check my tools (Settings › Models). Liner Code drives CLIs it doesn't control, and a new version of one can stop obeying an
  access level without anyone noticing: OpenCode 2 ignored every level until a hand-run check on the real tool caught it. So
  this answers, per tool and per API endpoint: is it there, does it work, and does it still do what Liner Code tells it.

  The checks are data (CHECKS: id, label, tier, run), in three tiers:
  1. Free and instant: found on this Mac and where, its version, signed in (what the tool already says; no new sign-in probe),
     its model list loads, and Liner Code's own tools start (the list a session would be handed).
  2. Free, a few seconds: the real tool is pointed at a test model served here on 127.0.0.1 (testModel), through the same path
     an API endpoint takes (endpoint.ts), with a dummy key, in a scratch folder under Liner Code's home with config folders of
     its own, so nothing of your sign-in, settings or saved sessions is read or changed. The test model asks for one file write
     and one command, at Read only and at Manual: Read only must refuse both with nothing written, Manual must bring each to
     Liner Code, which says no, and nothing may happen. Full access isn't probed. Only Claude Code (Anthropic's Messages), Codex
     (OpenAI's Responses) and OpenCode (Chat Completions) can be pointed at a model; the others say so.
  3. Costs one short message: a one-word reply through the real account, as the Reviewer's quiet read asks (runtime.ts quiet,
     which needs a session; this is the same path with no thread). An API endpoint gets two: a plain reply straight over HTTP
     (plain.ts), and one tool call through its tool, because many "compatible" endpoints answer text but break on tools.

  Results stay in memory, with the time they ran. A probe never makes a session: nothing shows in the sidebar, and only tier 3
  logs usage, under "check", as quiet() logs a read. The shape of the result follows T3 Code's provider status (apps/web/src/
  components/settings/providerStatus.ts: not found, not signed in, sign-in not checked), with a sentence on what to do.
*/
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Access, BuiltinProvider, CheckState, CheckTier, Endpoint, EndpointProtocol, ModelInfo, ProviderId, ProviderInfo, ToolCheck, ToolCheckRow } from "../../contracts/src/index.ts";
import { ACCESS_NAMES, emptyUsage, ENDPOINT_TOOL, endpointKey, familyOf } from "../../contracts/src/index.ts";
import { run, which } from "./exec.ts";
import { endpointModels, endpointProvider, hostOf } from "./providers/endpoint.ts";
import { askEndpoint } from "./providers/plain.ts";
import type { ApprovalRequest, ProviderSession, ToolUpdate, TurnSink } from "./providers/types.ts";
import { providers, readForbids, type Runtime } from "./runtime.ts";
import { uid, type Store } from "./store.ts";

/** What the doctor needs of the engine. `look` finds the tools again (api.ts detect); `mcp` is how a session starts Liner Code's tools. */
export type DoctorDeps = {
  store: Store;
  runtime: Runtime;
  env: NodeJS.ProcessEnv;
  look?: () => Promise<unknown>;
  mcp?: { serverFor(threadId: string): { command: string; args: string[]; env: Record<string, string> } | null; forget(threadId: string): void };
};

/** The tools that can be pointed at a model of our own, and the protocol each speaks (the inverse of ENDPOINT_TOOL). */
const POINTABLE: Partial<Record<BuiltinProvider, EndpointProtocol>> = { claude: "anthropic", codex: "responses", opencode: "chat" };
/** Each built-in tool's command, for where it was found. */
const BIN: Partial<Record<BuiltinProvider, string>> = { claude: "claude", codex: "codex", opencode: "opencode", hermes: "hermes", antigravity: "agy", cursor: "cursor-agent", grok: "grok" };
const LABEL: Record<string, string> = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" };
/** The files the test model's two calls make, so a file on disk after says one went through. */
export const WRITE_FILE = "liner-check-write.txt";
export const RAN_FILE = "liner-check-ran.txt";
/** The model name the test model answers to, and the key it's given (it's never checked: a dummy, so no real key goes anywhere). */
const TEST_MODEL = "liner-check";
const DUMMY_KEY = "liner-check-dummy-key";
/** How long one turn of a probe or a test message may take before it's given up. */
export const TURN_MS = 90_000;
/** How long a look, Liner Code's tools' start or a tool's tier 1 that just ended stands for a check asked for after it. */
const SHARE_MS = 5_000;
/**
  Removes the doctor's own scratch folders (run_*, msg_*, named by uid) in `root` older than `ms`, and nothing else: whatever
  else is there, and anything outside it, stays.
*/
export function clearScratch(root: string, ms: number) {
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {
    return;
  }
  for (const n of names) {
    if (!/^(run|msg)_[a-z0-9]+$/.test(n)) continue;
    const at = join(root, n);
    try {
      const st = lstatSync(at);
      if (st.isDirectory() && !st.isSymbolicLink() && (ms <= 0 || Date.now() - st.mtimeMs >= ms)) rmSync(at, { recursive: true, force: true });
    } catch {}
  }
}
/** A probe that finished this recently stands for a tool's accounts and endpoints asked for just after it. */
const PROBE_REUSE_MS = 60_000;
/** The key under which Liner Code's tools are started for a check (agent-tools.ts serverFor), forgotten after. */
const MCP_KEY = "liner-check";

type Kind = ToolCheckRow["kind"];
/** One tool as the checks see it: what Liner Code knows of it, and what kind of tool it is. */
/** `probed`: tier 2 runs on it, its tool (or the one it runs through) being one that can be pointed at a model, and installed. */
export type Ctx = { id: ProviderId; info: ProviderInfo; family: BuiltinProvider | "acp"; kind: Kind; endpoint?: Endpoint; probed: boolean };
type Outcome = { state: CheckState; detail?: string };
/** A check: `applies` says whether it's on this row at all; `run` says how it stands. Run per tool, the tier's checks together. */
type Check = { id: string; tier: CheckTier; label: (c: Ctx) => string; applies?: (c: Ctx) => boolean; run: (c: Ctx, d: Doctor) => Outcome | Promise<Outcome> };

const pass = (detail?: string): Outcome => ({ state: "passed", detail });
const failed = (detail: string): Outcome => ({ state: "failed", detail });
const skip = (detail: string): Outcome => ({ state: "skipped", detail });
const tilde = (p: string) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);
/** An error's words, on one line and short. */
const words = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim().slice(0, 220);
/** Words that end as a sentence does. */
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
const viaOf = (c: Ctx) => LABEL[c.family] ?? c.family;
/** The tool a row's tier 2 is run on: its own family's, for an account or an endpoint. */
const probeOf = (c: Ctx) => (c.kind === "demo" ? undefined : POINTABLE[c.family as BuiltinProvider] ? (c.family as BuiltinProvider) : undefined);

/* ---------------------------------- The checks ---------------------------------- */

export const CHECKS: Check[] = [
  {
    id: "found",
    tier: 1,
    label: (c) => (c.kind === "endpoint" ? `${viaOf(c)}, which runs it, is on this Mac` : "Found on this Mac"),
    run: (c, d) => {
      if (c.kind === "demo") return pass("Built into Liner Code");
      const where = d.whereOf(c);
      if (c.info.available) return pass(where ? tilde(where) : c.info.detail);
      if (c.kind === "endpoint") return failed(`Install ${viaOf(c)} in Models above: this endpoint's models run through it.`);
      return failed(c.info.install ? `Not installed. Install it with ${c.info.install}, then press Check again.` : `${c.info.detail ?? "Not found"}. Install it, then press Check again.`);
    },
  },
  {
    id: "version",
    tier: 1,
    label: () => "Version",
    // A tool that isn't there has its one row that says so, not a list of what that stops.
    applies: (c) => c.kind !== "demo" && c.info.available,
    run: (c) => (!c.info.available ? skip("Not installed.") : c.info.version ? pass(c.info.version) : skip("It doesn't say its version.")),
  },
  {
    id: "signin",
    tier: 1,
    label: (c) => (c.kind === "endpoint" ? "Has a key" : "Signed in"),
    applies: (c) => c.kind === "endpoint" || (c.kind !== "demo" && c.info.available),
    run: (c, d) => {
      if (c.kind === "endpoint") return c.endpoint && d.keyOf(c.endpoint) ? pass("Its key is in the keychain.") : c.info.signedIn ? pass("It's on this Mac, so it needs none.") : skip("No key saved. Some endpoints need none; its first answer says.");
      if (!c.info.available) return skip("Not installed.");
      if (c.info.signedIn === true) return pass(c.info.detail);
      if (c.info.signedIn === false) return failed(`Not signed in. Run ${c.info.login || "its sign-in"} in a terminal, or press Sign in above.`);
      return skip("This tool doesn't say whether it's signed in, and Liner Code doesn't sign in to find out.");
    },
  },
  {
    id: "models",
    tier: 1,
    label: () => "Its model list loads",
    applies: (c) => c.kind === "endpoint" || c.info.available,
    run: async (c, d) => {
      if (c.kind === "endpoint" && c.endpoint) {
        try {
          const ids = await endpointModels(c.endpoint.url, c.endpoint.protocol, d.keyOf(c.endpoint));
          return ids.length ? pass(`${hostOf(c.endpoint.url)} lists ${ids.length} model${ids.length === 1 ? "" : "s"}`) : skip("It lists no models; the ones you typed are used.");
        } catch (e) {
          // One that doesn't list its models works from the ones you typed.
          return / 404: /.test(words(e)) ? skip("It doesn't list its models; the ones you typed are used.") : failed(`${sentence(words(e))} Check its address and key in Models above.`);
        }
      }
      if (!c.info.available) return skip("Not installed.");
      const p = providers[c.id];
      if (!p?.models) return c.info.models.length ? pass(`${c.info.models.length} model${c.info.models.length === 1 ? "" : "s"} it's known to run`) : failed("It has no models Liner Code knows of. Press Look again in Models above.");
      try {
        // Given up at 30 seconds, the tool's process it started goes too (models' signal), not only the wait.
        const stop = new AbortController();
        const list = await within(p.models(d.deps.runtime.envFor(c.id), join(d.deps.store.home, "probe"), stop.signal), 30_000, "It didn't list its models within 30 seconds.", stop);
        return list.length ? pass(`It listed ${list.length} model${list.length === 1 ? "" : "s"}`) : failed("It listed no models. Sign in again, then press Check again.");
      } catch (e) {
        return failed(`It couldn't list its models: ${words(e)}`);
      }
    },
  },
  {
    id: "liner",
    tier: 1,
    label: () => "Liner Code's tools start",
    applies: (c) => c.kind !== "demo" && c.info.available,
    run: async (_c, d) => {
      const r = await d.linerTools();
      return r.state === "passed" ? pass(`${r.count} tools ready for its sessions (the Browser, designs, pages)`) : r;
    },
  },
  // Tier 2, from one probe of the tool's family (probe). A tool that can't be pointed at a model has one row that says so.
  {
    id: "access",
    tier: 2,
    label: () => "Run against a test model",
    applies: (c) => !c.probed,
    run: (c) => skip(c.kind === "demo" ? "Not checked: the Demo has no model to point at a test one." : probeOf(c) ? `Not checked: ${LABEL[probeOf(c)!]} isn't installed.` : "Not checked: this tool can't be pointed at a test model."),
  },
  {
    id: "reach",
    tier: 2,
    label: () => "Talks to a test model on this Mac",
    applies: (c) => c.probed,
    run: async (c, d) => {
      const pre = await d.probeGate(c);
      if (pre) return pre;
      const p = await d.probe(probeOf(c)!);
      const own = c.kind === "tool" ? "" : `Checked on ${viaOf(c)}, which runs it. `;
      return p.requests > 0 ? pass(`${own}It answered a test model, with a dummy key, in a scratch folder.`) : failed(`It never reached the test model${p.error ? ` (${p.error})` : ""}. Press Check again; if it stays, tell us which version of ${viaOf(c)} you have.`);
    },
  },
  ...(["read", "ask"] as const).flatMap((level) =>
    (["write", "command"] as const).map(
      (step): Check => ({
        id: `${level}-${step}`,
        tier: 2,
        label: () => (level === "read" ? `Read only stops ${step === "write" ? "a file write" : "a command"}` : `${ACCESS_NAMES.ask} asks before ${step === "write" ? "a file write" : "a command"}`),
        applies: (c) => c.probed,
        run: async (c, d) => {
          const pre = await d.probeGate(c);
          if (pre) return pre;
          return verdict(await d.probe(probeOf(c)!), level, step, `${viaOf(c)}${d.versionOf(probeOf(c)!)}`);
        },
      }),
    ),
  ),
  {
    id: "liner-reach",
    tier: 2,
    label: () => "Liner Code's tools reach its model",
    applies: (c) => c.probed,
    run: async (c, d) => {
      const pre = await d.probeGate(c);
      if (pre) return pre;
      const p = await d.probe(probeOf(c)!);
      if (!p.withLiner) return skip("Liner Code's tools weren't running, so they weren't handed over.");
      if (!p.requests) return skip("It never reached the test model.");
      return p.linerTools ? pass("They were in the list of tools its model got.") : failed(`Its model got none of Liner Code's tools (the Browser, designs). Restart Liner Code; if it stays, tell us which version of ${viaOf(c)} you have.`);
    },
  },
  // Tier 3: costs a message.
  {
    id: "reply",
    tier: 3,
    label: () => "Answers a test message",
    applies: (c) => c.kind !== "endpoint",
    run: (c, d) => d.testMessage(c),
  },
  {
    id: "plain",
    tier: 3,
    label: () => "Answers straight over HTTP",
    applies: (c) => c.kind === "endpoint",
    run: (c, d) => d.plainMessage(c),
  },
  {
    id: "toolcall",
    tier: 3,
    label: (c) => `Makes a tool call through ${viaOf(c)}`,
    applies: (c) => c.kind === "endpoint",
    run: (c, d) => d.toolMessage(c),
  },
];
/** How one level's step came out, as a check. */
function verdict(p: Probe, level: "read" | "ask", step: "write" | "command", who: string): Outcome {
  if (!p.requests) return skip("It never reached the test model.");
  const r = p.levels[level];
  const what = step === "write" ? "a file write" : "a command";
  if (!r.served[step]) return skip(r.none[step] ? `It offered its model no tool for ${what}, so there was nothing to stop.` : `The test model's ${step === "write" ? "file write" : "command"} never reached it${r.errors[0] ? ` (${r.errors[0]})` : ""}. Press Check again.`);
  const happened = step === "write" ? r.wrote : r.ran;
  const did = step === "write" ? "wrote a file" : "ran a command";
  const asked = r.asked[step] > 0;
  if (level === "read") {
    if (happened) return failed(`It ${did} at Read only. Don't rely on Read only with ${who} until Liner Code is updated for it.`);
    return pass(asked ? "It asked, and Liner Code refused it, as Read only says." : "The tool refused it itself.");
  }
  if (happened) return failed(asked ? `It ${did} after Liner Code said no. Don't rely on ${ACCESS_NAMES.ask} with ${who} until Liner Code is updated for it.` : `It ${did} at ${ACCESS_NAMES.ask} without asking. Don't rely on ${ACCESS_NAMES.ask} with ${who} until Liner Code is updated for it.`);
  return asked ? pass("It asked Liner Code first, and did nothing after a no.") : failed(`It didn't ask, so you'd never get to say yes. Update Liner Code, or tell us which version of ${who.trim()} you have.`);
}

/** `p`, or an error with `why` once `ms` have gone by; then `stop` is aborted, so what `p` started ends too. */
function within<T>(p: Promise<T>, ms: number, why: string, stop?: AbortController): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<never>((_, no) => (timer = setTimeout(() => (stop?.abort(), no(new Error(why))), ms)))]).finally(() => clearTimeout(timer));
}

/* ---------------------------------- The probe (tier 2) ---------------------------------- */

/** How one level went: which of the two calls the test model made (`none`: the tool offered nothing to make it with), what came to Liner Code, and what happened on disk. */
type LevelRun = { served: Record<"write" | "command", boolean>; none: Record<"write" | "command", boolean>; asked: Record<"write" | "command", number>; wrote: boolean; ran: boolean; errors: string[] };
/** A probe of one tool: how many requests reached the test model, whether Liner Code's tools were in them, and each level. */
export type Probe = { requests: number; linerTools: boolean; withLiner: boolean; levels: Record<"read" | "ask", LevelRun>; error?: string; at: number };

/** The env a probe's tool runs with: yours, less every key and every tool's own config, with config folders of its own under `dir`. */
export function probeEnv(env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    // No key or token of yours goes near a test, and no tool's own settings or home override the scratch ones below.
    // Where Claude Code keeps its shell's scratch files is only a place, and stays.
    if (/(KEY|TOKEN|SECRET|PASSWORD)$/i.test(k) || (/^(ANTHROPIC_|OPENAI_|CLAUDE_|CODEX_|OPENCODE_|HERMES_|XDG_|LINER_)/.test(k) && k !== "CLAUDE_CODE_TMPDIR")) continue;
    out[k] = v;
  }
  const home = env.HOME || homedir();
  const no = [env.NO_PROXY ?? env.no_proxy, "127.0.0.1,localhost"].filter(Boolean).join(",");
  return {
    ...out,
    HOME: join(dir, "home"),
    CLAUDE_CONFIG_DIR: join(dir, "claude"),
    CODEX_HOME: join(dir, "codex"),
    XDG_CONFIG_HOME: join(dir, "config"),
    XDG_DATA_HOME: join(dir, "data"),
    XDG_STATE_HOME: join(dir, "state"),
    // The cache only holds downloaded packages (OpenCode's provider code): yours is used, so nothing is fetched again.
    XDG_CACHE_HOME: env.XDG_CACHE_HOME || join(home, ".cache"),
    NO_PROXY: no,
    no_proxy: no,
    DISABLE_AUTOUPDATER: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
  };
}

/** The test model's own words, in each protocol: an Anthropic body's text or a list of parts. */
const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : typeof b?.content === "string" ? b.content : "")).join("\n") : "");
const MARK = /\[\[liner-check (read|ask) (write|command)\]\]/g;
/** The last check marker in a message: which level and which call it asks for. */
function markOf(text: string): { level: "read" | "ask"; step: "write" | "command" } | null {
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  MARK.lastIndex = 0;
  while ((m = MARK.exec(text))) last = m;
  return last ? { level: last[1] as "read" | "ask", step: last[2] as "write" | "command" } : null;
}
const PATCH = `*** Begin Patch\n*** Add File: ${WRITE_FILE}\n+Written by Liner Code's check.\n*** End Patch\n`;
const touch = `touch ${RAN_FILE}`;
const echo = `printf 'Written by the check.\\n' > ${WRITE_FILE}`;

type Call = { name: string; args: Record<string, unknown>; custom?: string };
type Tool = { name: string; type?: string; props: Record<string, unknown> };
/** The call a tool list offers for a step: the tool's own write, else a command that writes, and its command tool. */
function callFor(protocol: EndpointProtocol, step: "write" | "command", tools: Tool[], dir: string): Call | null {
  const named = (...names: string[]) => tools.find((t) => names.includes(t.name));
  const shell = (cmd: string): Call | null => {
    if (protocol === "anthropic") return named("Bash") ? { name: "Bash", args: { command: cmd, description: "Liner Code's check" } } : null;
    if (protocol === "chat") {
      const t = named("bash", "shell") ?? tools.find((x) => /bash|shell|exec/i.test(x.name) && !/liner/i.test(x.name));
      if (!t) return null;
      return { name: t.name, args: { [Object.hasOwn(t.props, "cmd") && !Object.hasOwn(t.props, "command") ? "cmd" : "command"]: cmd, description: "Liner Code's check" } };
    }
    // Codex runs a command in its sandbox first, and asks only when the model asks to go outside it, as a real model does for
    // a change at Manual (its read-only sandbox): so the test model asks to, and Codex must bring that to Liner Code.
    const t = named("shell_command", "exec_command", "shell");
    if (!t) return null;
    const out = { ...(Object.hasOwn(t.props, "sandbox_permissions") ? { sandbox_permissions: "require_escalated", justification: "Liner Code's check asks to make a file." } : {}) };
    if (t.name === "shell_command") return { name: t.name, args: { command: cmd, ...out } };
    if (t.name === "exec_command") return { name: t.name, args: { cmd, ...out } };
    return { name: t.name, args: { command: ["bash", "-lc", cmd], ...out } };
  };
  if (step === "command") return shell(touch);
  if (protocol === "anthropic") return named("Write") ? { name: "Write", args: { file_path: join(dir, WRITE_FILE), content: "Written by Liner Code's check.\n" } } : shell(echo);
  if (protocol === "chat") {
    const t = named("write") ?? tools.find((x) => /^(write|write_file|create_file)$/i.test(x.name));
    if (!t) return shell(echo);
    const path = Object.keys(t.props).find((k) => /path/i.test(k)) ?? "path";
    const content = Object.keys(t.props).find((k) => /content|text/i.test(k)) ?? "content";
    return { name: t.name, args: { [path]: join(dir, WRITE_FILE), [content]: "Written by Liner Code's check.\n" } };
  }
  const patch = named("apply_patch");
  if (patch) return patch.type === "custom" ? { name: "apply_patch", args: {}, custom: PATCH } : { name: "apply_patch", args: { input: PATCH } };
  return shell(echo);
}

/**
  A test model on 127.0.0.1, in the three protocols an endpoint speaks. A message that carries a check marker gets one tool
  call (testModel's script: callFor), and once a result for it comes back, a short text; anything else (a title, a summary)
  gets "OK.". It counts what reached it and whether Liner Code's tools were in the list.
*/
export async function testModel(dirs: Record<"read" | "ask", string>) {
  const seen = { requests: 0, linerTools: false, served: new Set<string>(), none: new Set<string>() };
  let n = 0;
  const id = (p: string) => `${p}_${Date.now().toString(36)}${(n++).toString(36)}`;
  const sse = (res: ServerResponse) => res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const json = (res: ServerResponse, body: unknown, status = 200) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(body)));
  /** What a request asks of the script: the marker of its last check message and how many results came after it. */
  const step = (protocol: EndpointProtocol, msgs: Record<string, any>[], tools: Tool[]): Call | "done" | null => {
    let at = -1;
    let mark: ReturnType<typeof markOf> = null;
    msgs.forEach((m, i) => {
      if (m?.role !== "user") return;
      const found = markOf(textOf(m.content));
      if (found) (at = i), (mark = found);
    });
    if (!mark) return null;
    const { level, step: s } = mark as NonNullable<ReturnType<typeof markOf>>;
    if (tools.some((t) => /liner/i.test(t.name))) seen.linerTools = true;
    const results = msgs.slice(at + 1).reduce((k, m) => k + (protocol === "anthropic" ? (m?.role === "user" && Array.isArray(m.content) ? m.content.filter((b: { type?: string }) => b?.type === "tool_result").length : 0) : protocol === "chat" ? (m?.role === "tool" ? 1 : 0) : m?.type === "function_call_output" || m?.type === "custom_tool_call_output" ? 1 : 0), 0);
    if (results > 0) return "done";
    const call = callFor(protocol, s, tools, dirs[level]);
    if (!call) {
      seen.none.add(`${level}-${s}`);
      return "done";
    }
    seen.served.add(`${level}-${s}`);
    return call;
  };
  const anthropic = (body: Record<string, any>, res: ServerResponse) => {
    const tools: Tool[] = (body.tools ?? []).map((t: Record<string, any>) => ({ name: String(t.name ?? ""), props: t.input_schema?.properties ?? {} }));
    const s = tools.length ? step("anthropic", body.messages ?? [], tools) : null;
    const call = s && s !== "done" ? s : null;
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const blocks = call ? [{ type: "tool_use", id: id("toolu"), name: call.name, input: call.args }] : [{ type: "text", text: s === "done" ? "Done." : "OK." }];
    const stop = call ? "tool_use" : "end_turn";
    const msgId = id("msg");
    if (!body.stream) return json(res, { id: msgId, type: "message", role: "assistant", model: body.model, content: blocks, stop_reason: stop, stop_sequence: null, usage });
    sse(res);
    const ev = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev("message_start", { message: { id: msgId, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage } });
    blocks.forEach((b, i) => {
      if (b.type === "text") {
        ev("content_block_start", { index: i, content_block: { type: "text", text: "" } });
        ev("content_block_delta", { index: i, delta: { type: "text_delta", text: (b as { text: string }).text } });
      } else {
        const t = b as { id: string; name: string; input: unknown };
        ev("content_block_start", { index: i, content_block: { type: "tool_use", id: t.id, name: t.name, input: {} } });
        ev("content_block_delta", { index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(t.input) } });
      }
      ev("content_block_stop", { index: i });
    });
    ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } });
    ev("message_stop", {});
    res.end();
  };
  const chat = (body: Record<string, any>, res: ServerResponse) => {
    const tools: Tool[] = (body.tools ?? []).map((t: Record<string, any>) => ({ name: String(t.function?.name ?? t.name ?? ""), props: t.function?.parameters?.properties ?? {} }));
    const s = tools.length ? step("chat", body.messages ?? [], tools) : null;
    const call = s && s !== "done" ? s : null;
    const text = s === "done" ? "Done." : "OK.";
    const base = { id: id("chatcmpl"), object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model };
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (!body.stream) {
      const message = call ? { role: "assistant", content: null, tool_calls: [{ id: id("call"), type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { role: "assistant", content: text };
      return json(res, { ...base, object: "chat.completion", choices: [{ index: 0, message, finish_reason: call ? "tool_calls" : "stop" }], usage });
    }
    sse(res);
    const w = (o: Record<string, unknown>) => res.write(`data: ${JSON.stringify({ ...base, ...o })}\n\n`);
    w({ choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
    if (call) {
      w({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: id("call"), type: "function", function: { name: call.name, arguments: "" } }] }, finish_reason: null }] });
      w({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(call.args) } }] }, finish_reason: null }] });
      w({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
    } else {
      w({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
      w({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    }
    w({ choices: [], usage });
    res.write("data: [DONE]\n\n");
    res.end();
  };
  const responses = (body: Record<string, any>, res: ServerResponse) => {
    const tools: Tool[] = (body.tools ?? []).map((t: Record<string, any>) => ({ name: String(t.name ?? t.type ?? ""), type: t.type, props: t.parameters?.properties ?? {} }));
    const input: Record<string, any>[] = Array.isArray(body.input) ? body.input : typeof body.input === "string" ? [{ role: "user", content: body.input }] : [];
    const s = tools.length ? step("responses", input, tools) : null;
    const call = s && s !== "done" ? s : null;
    const item = call
      ? call.custom !== undefined
        ? { type: "custom_tool_call", id: id("ctc"), call_id: id("call"), name: call.name, input: call.custom, status: "completed" }
        : { type: "function_call", id: id("fc"), call_id: id("call"), name: call.name, arguments: JSON.stringify(call.args), status: "completed" }
      : { type: "message", id: id("msg"), role: "assistant", status: "completed", content: [{ type: "output_text", text: s === "done" ? "Done." : "OK.", annotations: [] }] };
    const rid = id("resp");
    const usage = { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 15 };
    const shell = { id: rid, object: "response", created_at: Math.floor(Date.now() / 1000), model: body.model, status: "in_progress", output: [] };
    sse(res);
    let seq = 0;
    const ev = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`);
    ev("response.created", { response: shell });
    ev("response.output_item.added", { output_index: 0, item: item.type === "message" ? { ...item, content: [] } : item });
    if (item.type === "message") ev("response.output_text.delta", { item_id: item.id, output_index: 0, content_index: 0, delta: (item as { content: { text: string }[] }).content[0].text });
    ev("response.output_item.done", { output_index: 0, item });
    ev("response.completed", { response: { ...shell, status: "completed", output: [item], usage } });
    res.end();
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: Record<string, any> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {}
      const url = (req.url ?? "").split("?")[0];
      try {
        if (req.method === "GET" && /\/models$/.test(url)) return json(res, { object: "list", data: [{ id: TEST_MODEL, object: "model", type: "model", display_name: "Liner Code's test model" }] });
        if (/\/count_tokens$/.test(url)) return json(res, { input_tokens: 10 });
        if (req.method !== "POST") return json(res, { error: { message: "Not here." } }, 404);
        seen.requests++;
        if (/\/messages$/.test(url)) return anthropic(body, res);
        if (/\/chat\/completions$/.test(url)) return chat(body, res);
        if (/\/responses$/.test(url)) return responses(body, res);
        seen.requests--;
        json(res, { error: { message: "Not here." } }, 404);
      } catch (e) {
        json(res, { error: { message: words(e) } }, 500);
      }
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    seen,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

/** Which call an ask is for, by the file it names. */
const askFor = (req: ApprovalRequest): "write" | "command" | null => {
  const all = JSON.stringify([req.title, req.description, req.fields]);
  return all.includes(WRITE_FILE) ? "write" : all.includes(RAN_FILE) ? "command" : null;
};

/** A sink that records and refuses: Read only's refusal is Liner Code's own (runtime.ts readForbids), and Manual's answer is a no. */
function probeSink(level: "read" | "ask", r: LevelRun, out: { text: string }): TurnSink {
  return {
    text: (d) => void (out.text += d),
    reasoning: () => {},
    tool: () => {},
    plan: () => {},
    approve: async (req) => {
      const what = askFor(req);
      if (what) r.asked[what]++;
      if (level === "read" && readForbids(req)) return { allow: false, level: true, reason: "This session is Read only, so Liner Code refused this without asking anyone. Don't try to change files or run commands." };
      return { allow: false, reason: "No." };
    },
    ask: async () => null,
    propose: async () => ({ approve: false }),
    usage: () => {},
    session: () => {},
    notice: () => {},
    error: (m) => void r.errors.push(words(m)),
    limited: (m) => void r.errors.push(words(m)),
  };
}

/** One turn of `session`, given up after TURN_MS even when its tool doesn't hear the abort (closing it ends what's left). */
async function turnOf(session: ProviderSession, prompt: string, sink: TurnSink, signal?: AbortSignal) {
  const late = AbortSignal.timeout(TURN_MS);
  const both = signal ? AbortSignal.any([signal, late]) : late;
  const gaveUp = new Promise<never>((_, no) => (both.aborted ? no(new Error("timed out")) : both.addEventListener("abort", () => no(new Error(`It didn't finish within ${Math.round(TURN_MS / 1000)} seconds`)), { once: true })));
  gaveUp.catch(() => {});
  const turn = session.turn(prompt, sink, both);
  turn.catch(() => {});
  await Promise.race([turn, gaveUp]);
}

/* ---------------------------------- The doctor ---------------------------------- */

export class Doctor {
  readonly deps: DoctorDeps;
  /** Each tool's checks as they last ran, by check id. */
  private results = new Map<ProviderId, Map<string, ToolCheck>>();
  private probing = new Map<BuiltinProvider, Promise<Probe>>();
  private probed = new Map<BuiltinProvider, Probe>();
  /** Work that overlapping checks share (the look, Liner Code's tools starting, a tool's tier 1): in flight, and for SHARE_MS after it lands. */
  private sharing = new Map<string, { p: Promise<unknown>; done?: number }>();

  constructor(deps: DoctorDeps) {
    this.deps = deps;
    // An engine that stopped mid-check left its scratch folders: none of them is in use now.
    clearScratch(join(deps.store.home, "check"), 0);
  }

  /** `work` once for every caller that asks while it runs, or within SHARE_MS of its end. */
  private shared<T>(key: string, work: () => Promise<T>): Promise<T> {
    const had = this.sharing.get(key);
    if (had && (had.done === undefined || Date.now() - had.done < SHARE_MS)) return had.p as Promise<T>;
    const entry: { p: Promise<unknown>; done?: number } = { p: Promise.resolve() };
    const p = work().finally(() => (entry.done = Date.now()));
    entry.p = p;
    p.catch(() => {});
    this.sharing.set(key, entry);
    return p;
  }

  /** Every tool Liner Code knows, as the checks see it. */
  tools(): Ctx[] {
    const s = this.deps.store.settings;
    return this.deps.runtime.providerInfo.map((info) => {
      const family = familyOf(info.id);
      const kind: Kind = info.id === "demo" ? "demo" : info.endpoint !== undefined ? "endpoint" : info.account ? "account" : info.added ? "agent" : "tool";
      const endpoint = kind === "endpoint" ? (s.endpoints ?? []).find((e) => `${ENDPOINT_TOOL[e.protocol]}.${e.id}` === info.id) : undefined;
      const pointed = kind === "demo" ? undefined : POINTABLE[family as BuiltinProvider];
      const probed = Boolean(pointed) && Boolean(this.deps.runtime.providerInfo.find((p) => p.id === family)?.available);
      return { id: info.id, info, family, kind, endpoint, probed };
    });
  }

  /** Every row as last checked. */
  rows(only?: ProviderId[]): ToolCheckRow[] {
    return this.tools()
      .filter((c) => !only || only.includes(c.id))
      .map((c) => {
        const had = this.results.get(c.id);
        const checks = CHECKS.filter((k) => had?.has(k.id)).map((k) => had!.get(k.id)!);
        return { tool: c.id, label: c.info.label, kind: c.kind, checks };
      });
  }

  /** Runs one tier on one tool, or on all of them; answers with their rows. */
  async check(tier: CheckTier, tool?: ProviderId): Promise<ToolCheckRow[]> {
    // One look at the tools for checks that overlap (the page asks for every tool at once): each look runs every tool.
    if (tier === 1) await this.shared("look", async () => this.deps.look?.()).catch(() => {});
    const all = this.tools();
    const targets = tool ? all.filter((c) => c.id === tool) : all;
    if (tool && !targets.length) throw new Error("Liner Code doesn't know that tool. Press Look again in Models.");
    // A tool's tier 1 starts processes (its model list) and fetches with your key: overlapping asks for it share one run.
    await Promise.all(targets.map((c) => (tier === 1 ? this.shared(`tier1:${c.id}`, () => this.runTier(c, 1)) : this.runTier(c, tier))));
    return this.rows(targets.map((c) => c.id));
  }

  private async runTier(c: Ctx, tier: CheckTier) {
    const started = Date.now();
    // A tool's own Check again probes it afresh; its accounts and endpoints take a probe that just ran (or is running) for it.
    const family = probeOf(c);
    if (tier === 2 && family && !(await this.probeGate(c))) await this.probe(family, c.kind === "tool");
    const list = CHECKS.filter((k) => k.tier === tier && (k.applies?.(c) ?? true));
    const out = await Promise.all(list.map(async (k) => ({ k, o: await Promise.resolve(k.run(c, this)).catch((e): Outcome => failed(`The check itself went wrong: ${words(e)}`)) })));
    const at = Date.now();
    const seconds = Math.round((at - started) / 100) / 10;
    const had = this.results.get(c.id) ?? new Map<string, ToolCheck>();
    // A tier's checks replace that tier's last ones, and none of another tier's.
    for (const [id, x] of had) if (x.tier === tier) had.delete(id);
    for (const { k, o } of out) had.set(k.id, { id: k.id, label: k.label(c), tier, state: o.state, ...(o.detail ? { detail: o.detail } : {}), at, seconds });
    this.results.set(c.id, had);
  }

  whereOf(c: Ctx): string | null {
    const env = this.deps.env;
    if (c.kind === "agent") {
      const a = (this.deps.store.settings.addedAgents ?? []).find((x) => `acp.${x.id}` === c.id);
      return a?.command[0] ? (which(a.command[0], env) ?? a.command[0]) : null;
    }
    if (c.kind === "account") {
      const a = (this.deps.store.settings.accounts ?? []).find((x) => `${x.provider}.${x.id}` === c.id);
      if (a?.binary) return a.binary;
    }
    const bin = BIN[c.family as BuiltinProvider];
    return bin ? which(bin, env) : null;
  }

  versionOf(family: BuiltinProvider) {
    // "2.1.326 (Claude Code)" and "codex-cli 0.169.0" say the number and more.
    const v = /\d+\.\d+(?:\.\d+)?/.exec(this.deps.runtime.providerInfo.find((p) => p.id === family)?.version ?? "")?.[0];
    return v ? ` ${v}` : "";
  }

  keyOf(e: Endpoint) {
    return this.deps.runtime.keys.get(endpointKey(e.id));
  }

  /** Liner Code's own tools as a session would start them: the server runs and lists its tools. Once for checks that overlap. */
  linerTools() {
    return this.shared("liner-tools", async () => {
      const spec = this.deps.mcp?.serverFor(MCP_KEY);
      if (!spec) return { state: "skipped" as const, detail: "Liner Code's tools aren't running in this engine." };
      try {
        const count = await listTools(spec, { ...this.deps.env, ...spec.env });
        return count > 0 ? { state: "passed" as const, count } : { state: "failed" as const, detail: "They started but listed no tools. Restart Liner Code." };
      } catch (e) {
        return { state: "failed" as const, detail: `They didn't start (${words(e)}). Restart Liner Code.` };
      } finally {
        this.deps.mcp?.forget(MCP_KEY);
      }
    });
  }

  /** Why a row's tier 2 can't run, or null when it can. */
  async probeGate(c: Ctx): Promise<Outcome | null> {
    const family = probeOf(c);
    if (!family) return skip("Not checked: this tool can't be pointed at a test model.");
    const base = this.deps.runtime.providerInfo.find((p) => p.id === family);
    if (!base?.available) return skip(`Not checked: ${LABEL[family]} isn't installed.`);
    return null;
  }

  /** One probe of a tool at a time; one that just finished stands for its accounts' and endpoints' rows too, unless `fresh`. */
  probe(family: BuiltinProvider, fresh = false): Promise<Probe> {
    const going = this.probing.get(family);
    if (going) return going;
    const last = this.probed.get(family);
    if (!fresh && last && Date.now() - last.at < PROBE_REUSE_MS) return Promise.resolve(last);
    const p = this.runProbe(family).then((r) => (this.probed.set(family, r), r));
    this.probing.set(family, p);
    void p.finally(() => this.probing.delete(family)).catch(() => {});
    return p;
  }

  /** For a test: forget the last probes, so the next check runs one. */
  forgetProbes() {
    this.probed.clear();
  }

  private async runProbe(family: BuiltinProvider): Promise<Probe> {
    const protocol = POINTABLE[family]!;
    // One left by a check that never finished (an hour is far past any probe's end) goes first.
    clearScratch(join(this.deps.store.home, "check"), 3600_000);
    const dir = join(this.deps.store.home, "check", uid("run"));
    const dirs = { read: join(dir, "project-read"), ask: join(dir, "project-ask") };
    const blank = (): LevelRun => ({ served: { write: false, command: false }, none: { write: false, command: false }, asked: { write: 0, command: 0 }, wrote: false, ran: false, errors: [] });
    const out: Probe = { requests: 0, linerTools: false, withLiner: false, levels: { read: blank(), ask: blank() }, at: Date.now() };
    let fake: Awaited<ReturnType<typeof testModel>> | null = null;
    const mcpKey = `${MCP_KEY}-${family}`;
    try {
      for (const d of [dir, ...Object.values(dirs), join(dir, "home"), join(dir, "claude"), join(dir, "codex"), join(dir, "config"), join(dir, "data"), join(dir, "state")]) mkdirSync(d, { recursive: true });
      // A folder of its own, as a project is; Codex reads a repository's root as the place it may write.
      for (const d of Object.values(dirs)) {
        writeFileSync(join(d, "README.md"), "A scratch folder for Liner Code's check. It's removed when the check ends.\n");
        await run("git", ["init", "-q"], { cwd: d, env: this.deps.env, timeout: 10_000 });
      }
      fake = await testModel(dirs);
      const endpoint: Endpoint = { id: "liner-check", label: "Liner Code's test model", url: protocol === "anthropic" ? fake.base : `${fake.base}/v1`, protocol, models: [TEST_MODEL] };
      const base = providers[family];
      if (!base) throw new Error(`${LABEL[family]} isn't known to this engine`);
      const tool = endpointProvider(base, endpoint, () => DUMMY_KEY);
      const env = probeEnv(this.deps.env, dir);
      const mcp = this.deps.mcp?.serverFor(mcpKey) ?? undefined;
      out.withLiner = Boolean(mcp);
      // One level after the other: two of a tool starting at once on fresh folders can trip over each other (OpenCode's
      // first start sets up its database, and a second start beside it failed its first turn).
      for (const level of ["read", "ask"] as const) {
        const r = out.levels[level];
        const said = { text: "" };
        const session = tool.open({ cwd: dirs[level], model: TEST_MODEL, effort: "low", access: level as Access, soul: "", guard: true, ephemeral: true, env, mcp });
        try {
          // Each call in a turn of its own: some tools end their turn when a step is refused.
          for (const step of ["write", "command"] as const) {
            try {
              await turnOf(session, `Liner Code is checking this tool. Make the one tool call you're given, then stop. [[liner-check ${level} ${step}]]`, probeSink(level, r, said));
            } catch (e) {
              r.errors.push(words(e));
            }
          }
        } finally {
          await Promise.resolve(session.close()).catch(() => {});
        }
        r.wrote = existsSync(join(dirs[level], WRITE_FILE));
        r.ran = existsSync(join(dirs[level], RAN_FILE));
      }
      out.requests = fake.seen.requests;
      out.linerTools = fake.seen.linerTools;
      for (const level of ["read", "ask"] as const)
        for (const step of ["write", "command"] as const) {
          out.levels[level].served[step] = fake.seen.served.has(`${level}-${step}`);
          out.levels[level].none[step] = fake.seen.none.has(`${level}-${step}`);
        }
      if (!out.requests) out.error = out.levels.read.errors[0] ?? out.levels.ask.errors[0];
    } catch (e) {
      out.error = words(e);
    } finally {
      this.deps.mcp?.forget(mcpKey);
      await fake?.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
    out.at = Date.now();
    return out;
  }

  /* ---------------------------------- Tier 3 ---------------------------------- */

  /** A model of a tool's that costs least to ask: a quick one where it lists one, else its default. */
  private cheapest(info: ProviderInfo): string {
    const live = info.models.filter((m: ModelInfo) => !m.legacy && m.id !== "default");
    return (live.find((m) => /haiku|mini|flash|fast|small/i.test(m.id)) ?? live.find((m) => m.isDefault) ?? live[0])?.id ?? "default";
  }

  /** Logs a test message's tokens under "check", with no session, as plain() logs an app's. */
  private log(provider: ProviderId, model: string, used: ReturnType<typeof emptyUsage>, started: number) {
    this.deps.store.logUsage({ at: Date.now(), threadId: "", projectId: "", agent: "check", provider, model, inputTokens: used.inputTokens, outputTokens: used.outputTokens, cacheReadTokens: used.cacheReadTokens, costUsd: used.costUsd, seconds: (Date.now() - started) / 1000 });
  }

  /** A one-off turn on the real tool, in an empty scratch folder, refusing every step; what it said, its tool calls, and the first error. */
  private async once(id: ProviderId, model: string, prompt: string, files: Record<string, string> = {}) {
    const p = providers[id];
    if (!p) throw new Error("This tool isn't known to the engine any more. Press Look again in Models.");
    const dir = join(this.deps.store.home, "check", uid("msg"));
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    const used = emptyUsage();
    const said = { text: "", tools: [] as ToolUpdate[], error: "" };
    const sink: TurnSink = {
      text: (d) => void (said.text += d),
      reasoning: () => {},
      tool: (u) => void said.tools.push(u),
      plan: () => {},
      approve: async () => ({ allow: false, reason: "This is a check: answer from what you have." }),
      ask: async () => null,
      propose: async () => ({ approve: false }),
      usage: (u, total) => {
        for (const k of ["inputTokens", "outputTokens", "cacheReadTokens", "costUsd"] as const) if (u[k] !== undefined) used[k] = total ? (u[k] as number) : used[k] + (u[k] as number);
      },
      session: () => {},
      notice: () => {},
      error: (m) => void (said.error ||= words(m)),
      limited: (m) => void (said.error ||= words(m)),
    };
    const started = Date.now();
    // No level: the tool's own default is one every model takes, where a fixed "low" fails a model that doesn't list it.
    const session = p.open({ cwd: dir, model, effort: "", access: "read", soul: "", guard: true, ephemeral: true, env: this.deps.runtime.envFor(id) });
    try {
      await turnOf(session, prompt, sink);
    } catch (e) {
      said.error ||= words(e);
    } finally {
      await Promise.resolve(session.close()).catch(() => {});
      this.log(id, model, used, started);
      rmSync(dir, { recursive: true, force: true });
    }
    return said;
  }

  async testMessage(c: Ctx): Promise<Outcome> {
    if (!c.info.available) return skip("Not installed.");
    if (c.info.signedIn === false) return skip("Not signed in, so there's no account to send it on.");
    const said = await this.once(c.id, this.cheapest(c.info), "Liner Code is checking that you work. Reply with the one word: ready");
    const text = said.text.trim();
    if (text) return pass(`It answered “${text.length > 60 ? `${text.slice(0, 59)}…` : text}”`);
    return failed(said.error ? `${said.error} Open a session with it to see more.` : "It answered nothing. Open a session with it to see what it says.");
  }

  async plainMessage(c: Ctx): Promise<Outcome> {
    const e = c.endpoint;
    if (!e) return skip("This endpoint isn't in Settings any more.");
    const model = e.models[0];
    if (!model) return skip("It has no models: add one in Models above.");
    const started = Date.now();
    const used = emptyUsage();
    try {
      const r = await askEndpoint(e, this.keyOf(e), model, { system: "Answer in one word.", prompt: "Liner Code is checking that you work. Reply with the one word: ready", signal: AbortSignal.timeout(TURN_MS) });
      used.inputTokens = r.inputTokens;
      used.outputTokens = r.outputTokens;
      const text = r.text.trim();
      return text ? pass(`${model} answered “${text.length > 60 ? `${text.slice(0, 59)}…` : text}”`) : failed(`${model} answered nothing. Check the model's name in Models above.`);
    } catch (err) {
      return failed(`${words(err)}`);
    } finally {
      this.log(c.id, model, used, started);
    }
  }

  async toolMessage(c: Ctx): Promise<Outcome> {
    const e = c.endpoint;
    if (!e) return skip("This endpoint isn't in Settings any more.");
    if (!c.info.available) return skip(`${viaOf(c)} isn't installed, and its models run through it.`);
    const model = e.models[0];
    if (!model) return skip("It has no models: add one in Models above.");
    // A word it can only know by reading the file.
    const word = `harbour${Math.floor(1000 + Math.random() * 9000)}`;
    const said = await this.once(c.id, model, "Liner Code is checking that tool calls work. Use your file reading tool to read the file liner-check.txt in this folder, then reply with the word written in it and nothing else.", { "liner-check.txt": `${word}\n` });
    const called = said.tools.length > 0;
    if (said.text.includes(word)) return pass("It read a file through its tool and answered with what was in it.");
    if (said.error && !said.text.trim()) return failed(`${said.error}`);
    return called ? failed("It called a tool but didn't answer with what the file said: this endpoint may not handle tool results, so sessions on it can break.") : failed("It answered without calling a tool: this endpoint may not support tool calls, so sessions on it can't work with files.");
  }
}

/** Starts an MCP server on stdio and counts the tools it lists; it ends after. */
export function listTools(spec: { command: string; args: string[] }, env: NodeJS.ProcessEnv, ms = 15_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { env, stdio: ["pipe", "pipe", "ignore"] });
    let buf = "";
    const done = (f: () => void) => {
      clearTimeout(timer);
      child.kill();
      f();
    };
    const timer = setTimeout(() => done(() => reject(new Error(`no answer within ${ms / 1000} seconds`))), ms);
    child.on("error", (e) => done(() => reject(e)));
    // One that ended before reading what was sent mustn't take the engine down with a broken pipe.
    child.stdin.on("error", () => {});
    child.on("exit", (code) => done(() => reject(new Error(`it ended with code ${code}`))));
    child.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m: { id?: number; result?: { tools?: unknown[] } };
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.id === 2) {
          child.removeAllListeners("exit");
          done(() => resolve(Array.isArray(m.result?.tools) ? m.result!.tools!.length : 0));
        }
      }
    });
    const send = (m: Record<string, unknown>) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
    send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "liner-check", version: "1" } } });
    send({ method: "notifications/initialized" });
    send({ id: 2, method: "tools/list", params: {} });
  });
}
