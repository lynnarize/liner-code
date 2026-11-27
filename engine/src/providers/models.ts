/*
  Which models each agent tool can run, asked of the tool itself rather than kept as a list here:
  Claude Code through the Agent SDK's supportedModels(), Codex from `codex debug models`, and an
  ACP agent from the session it opens (its model config option, or its model list). Each model
  carries the effort levels that tool accepts for it, named the same way everywhere.
*/
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { CommandInfo, EffortInfo, ModelInfo, SkillInfo } from "../../../contracts/src/index.ts";
import { jsonLines, killTree, run, runBounded, spawn, which } from "../exec.ts";
import { VERSION } from "../version.ts";

const LEVELS: Record<string, { label: string; description: string }> = {
  minimal: { label: "Minimal", description: "Barely thinks, for the smallest asks" },
  low: { label: "Low", description: "Fast, for small asks" },
  medium: { label: "Medium", description: "Thinks it through" },
  high: { label: "High", description: "Slower, checks its work" },
  xhigh: { label: "Extra high", description: "Deeper, for hard problems" },
  max: { label: "Max", description: "As deep as it goes" },
  ultra: { label: "Ultra", description: "The deepest this model offers" },
};

/**
  An effort level by its tool's name for it, with the description the tool gave, if any. A level Liner Code knows gets its label;
  one it has never seen keeps the tool's own word, so what the picker lists is what the tool said.
*/
export function effortOf(id: string, description?: string): EffortInfo {
  const known = LEVELS[id];
  return { id, label: known?.label ?? id, description: description || known?.description };
}

/** Claude Code's extras on top of its effort levels: Liner Code's own, not levels the model reports, so marked `extra`. */
export const ULTRACODE: EffortInfo = { id: "ultracode", label: "Ultracode", description: "Extra high, plus multi-agent workflows", extra: true };
export const ULTRATHINK: EffortInfo = { id: "ultrathink", label: "Ultrathink", description: "Thinks as hard as it can on every turn", extra: true };

/** "Nous Portal · anthropic/claude-opus-5.5" or "OpenCode/Big Pickle": where it comes from, and its name. */
function split(name: string): { group?: string; label: string } {
  const dot = name.indexOf(" · ");
  if (dot > 0) return { group: name.slice(0, dot), label: name.slice(dot + 3) };
  const slash = name.indexOf("/");
  if (slash > 0 && !name.slice(0, slash).includes(" ")) return { group: name.slice(0, slash), label: name.slice(slash + 1) };
  return { label: name };
}

type Json = Record<string, unknown>;

/** Resolves when a probed tool is gone (it may never answer), and keeps its closed pipe from raising an error nobody catches. */
function gone(child: ChildProcessWithoutNullStreams) {
  child.stdin.on("error", () => {});
  return new Promise<null>((r) => {
    child.once("error", () => r(null));
    child.once("close", () => r(null));
  });
}

/**
  Opens a throwaway ACP session in an empty folder and reads the models it offers: a "model"
  config option (OpenCode) or the session's model list (Hermes). The first entry is "default",
  whatever the tool is set to now. `signal` ends it early, the tool's process with it (Check my tools gives it 30 seconds).
*/
export async function acpModels(cmd: string[], label: string, env: NodeJS.ProcessEnv, scratch: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const path = which(cmd[0], env);
  if (!path || signal?.aborted) return [];
  mkdirSync(scratch, { recursive: true });
  // In a process group of its own, so a launcher's agent (npx, uvx) goes when the probe ends.
  const child = spawn(path, cmd.slice(1), { cwd: scratch, env, stdio: ["pipe", "pipe", "pipe"], detached: true }) as ChildProcessWithoutNullStreams;
  const waiting = new Map<number, (m: Json) => void>();
  let seq = 0;
  // The options as the tool last sent them on its own (config_option_update), which a model switch may answer with.
  let updated: unknown;
  jsonLines(child.stdout, (v) => {
    const m = v as { id?: number | string; method?: string; params?: Json; result?: Json; error?: unknown };
    // With a method it's the tool's own request, under an id of its own.
    if (typeof m.id === "number" && waiting.has(m.id) && !m.method) {
      waiting.get(m.id)!(m.error ? {} : (m.result ?? {}));
      waiting.delete(m.id);
    }
    // A tool that asks before a model switch (Hermes on a guarded model) is told no at once, so the switch below never waits on it.
    if (m.method === "session/request_permission" && m.id !== undefined) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { outcome: { outcome: "cancelled" } } })}\n`);
    const u = m.method === "session/update" ? (m.params?.update as Json | undefined) : undefined;
    if (u?.sessionUpdate === "config_option_update" && Array.isArray(u.configOptions)) updated = u.configOptions;
  });
  child.stderr.resume();
  const request = (method: string, params: Json) =>
    new Promise<Json>((resolve) => {
      const id = ++seq;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  let timer: NodeJS.Timeout | undefined;
  let onAbort = () => {};
  const timeout = new Promise<null>((r) => {
    timer = setTimeout(() => r(null), 45000);
    onAbort = () => r(null);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  /**
    The levels the session lists once switched to `model`, or null when that can't be told: no way to switch, a switch it
    refused, or a reply that carries no options (Hermes's older ACP server answers with none).
  */
  const switchedLevels = async (model: string): Promise<EffortInfo[] | null> => {
    const ask = s && typeof s.sessionId === "string" ? acpModelRequest(s, s.sessionId, model) : null;
    if (!ask) return null;
    updated = undefined;
    const r = await request(ask.method, ask.params);
    const said = Array.isArray(r.configOptions) && r.configOptions.length ? r.configOptions : updated;
    if (!Array.isArray(said) || !said.length) return null;
    const on = (said as Json[]).find((c) => c.category === "model" || c.id === "model");
    return on && on.currentValue !== model ? null : thoughtLevels(said);
  };
  let s: Json | null = null;
  try {
    s = await Promise.race([
      (async () => {
        await request("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "liner-code", title: "Liner Code", version: VERSION } });
        return request("session/new", { cwd: scratch, mcpServers: [] });
      })(),
      timeout,
      gone(child),
    ]);
    if (!s) return [];
    const out: ModelInfo[] = [];
    let current = "";
    const option = ((s.configOptions as Json[] | undefined) ?? []).find((c) => c.category === "model" || c.id === "model");
    if (option) {
      current = String(option.currentValue ?? "");
      // Flat, or in groups with options of their own (the ACP schema's SessionConfigSelectGroup).
      type Choice = { value: string; name?: string; description?: string; options?: Choice[] };
      for (const o of ((option.options as Choice[] | undefined) ?? []).flatMap((c) => c.options ?? [c])) out.push({ id: o.value, ...split(o.name ?? o.value), description: o.description ?? "", isDefault: o.value === current });
    } else {
      const state = s.models as { currentModelId?: string; availableModels?: { modelId: string; name?: string; description?: string }[] } | undefined;
      current = state?.currentModelId ?? "";
      for (const m of state?.availableModels ?? []) out.push({ id: m.modelId, ...split(m.name ?? m.modelId), description: (m.description ?? "").replace(/^Provider: [^•]*•?\s*/, "").replace(/^current$/, ""), isDefault: m.modelId === current });
    }
    // The levels the session lists (category thought_level) are for the model it opened on. Some tools list one set whatever
    // the model (Hermes: its reasoning levels), others a set per model (OpenCode 2: GLM has no medium), and ACP doesn't say
    // which: so this throwaway session is switched once to another model and the option read again. The same both times,
    // they are the tool's for every model, and go on its "default" row too, which is how the app knows (toolLevels).
    // Otherwise each of the two keeps its own, and the rest have none until a session on them says.
    const levels = thoughtLevels(s.configOptions);
    const other = current ? out.find((m) => !m.isDefault) : undefined;
    const there = other ? await within(switchedLevels(other.id), timeout, gone(child)) : null;
    const wide = there && there.map((e) => e.id).join(" ") === levels.map((e) => e.id).join(" ") ? levels : undefined;
    for (const m of out) {
      if (wide) m.efforts = wide;
      else if (m.isDefault && (levels.length || there)) m.efforts = levels;
      else if (there && m === other) m.efforts = there;
    }
    const now = out.find((m) => m.isDefault);
    return [{ id: "default", label: `${label} default`, description: now ? `What ${label} is set to: ${now.label}` : `The model ${label} is set up with`, ...(now ? { now: now.label } : {}), ...(wide ? { efforts: wide } : {}) },...out.map((m) => ({ ...m, isDefault: undefined }))];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    killTree(child);
  }
}

/** How long the model switch that tells a tool's levels apart (acpModels) may take, in ms, before it counts as not told. */
export const LEVEL_SWITCH = { ms: 15000 };

/** What `p` gives, or null once `LEVEL_SWITCH.ms` passes or one of `ends` (the listing's own bound, the tool gone) comes first. */
async function within<T>(p: Promise<T>, ...ends: Promise<null>[]): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), LEVEL_SWITCH.ms)));
  try {
    return await Promise.race([p, late, ...ends]);
  } finally {
    clearTimeout(timer);
  }
}

/**
  The effort levels a tool takes for every model, the same whichever it is on, or undefined when they differ by model or it
  hasn't said: an ACP agent's "default" row carries them only when its listing found them the same on two models (acpModels).
  A model id you added, or one a session hasn't run on, takes these; no other tool's levels are shared.
*/
export function toolLevels(models: ModelInfo[]): EffortInfo[] | undefined {
  return models.find((m) => m.id === "default")?.efforts;
}

/** Dollars per million tokens as the picker shows a price: "$4", "$1.40", "$0.145". */
function dollars(n: number): string {
  if (Number.isInteger(n)) return `$${n}`;
  const s = String(n);
  return `$${s.split(".")[1]?.length === 1 ? n.toFixed(2) : s}`;
}

/** A price entry of OpenCode's model list ({ input, output } in dollars per million tokens), or null when it isn't one. */
const costOf = (c: unknown): { input: number; output: number } | null => {
  const x = c as { input?: unknown; output?: unknown } | null;
  return x && typeof x.input === "number" && typeof x.output === "number" && Number.isFinite(x.input) && Number.isFinite(x.output) && x.input >= 0 && x.output >= 0 ? { input: x.input, output: x.output } : null;
};

/**
  OpenCode's models as `opencode api GET /api/model` prints them (its `model.list`, OpenCode 2): `{ data: [model…] }`, each with
  its provider (Zen is "opencode", Go "opencode-go"), its bare id, its name, its `variants` (the effort levels it takes from that
  provider, in OpenCode's order: GLM-5.3 low, high, max; Kimi K3 on Go max alone) and its `cost` (the first entry its base price,
  a later one with a context `tier` the price for long prompts; a free model all zeros, shown "$0"). Ids are "provider/id", as
  its ACP session takes them. Only these fields are read: a model's `headers` and `settings` carry the person's account and are
  never kept. Null when the answer isn't in that shape, so the caller asks the ACP session instead and no level or price is made up.
*/
export function opencodeModelList(stdout: string): ModelInfo[] | null {
  let d: unknown;
  try {
    d = JSON.parse(stdout);
  } catch {
    return null;
  }
  const data = (d as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  const out: ModelInfo[] = [];
  for (const raw of data) {
    const m = raw as { id?: unknown; providerID?: unknown; name?: unknown; enabled?: unknown; variants?: unknown; cost?: unknown } | null;
    if (!m || typeof m.id !== "string" || !m.id || typeof m.providerID !== "string" || !m.providerID) continue;
    // One OpenCode has switched off (its config, or deprecated) it won't run.
    if (m.enabled === false) continue;
    const row: ModelInfo = { id: `${m.providerID}/${m.id}`, label: typeof m.name === "string" && m.name.trim() ? m.name.trim() : m.id, description: "", group: m.providerID };
    // Its list is the whole answer: a model listed with no variants takes no level, said as none ([]) rather than unknown.
    if (Array.isArray(m.variants)) {
      const ids = m.variants.map((v) => (v as { id?: unknown } | null)?.id).filter((id): id is string => typeof id === "string" && Boolean(id));
      row.efforts = [...new Set(ids)].map((id) => effortOf(id));
    }
    const costs = Array.isArray(m.cost) ? m.cost : [];
    const base = costs.find((c) => !(c as { tier?: unknown } | null)?.tier);
    const price = costOf(base);
    if (price) {
      // The long-prompt price goes where Claude Code's does: the note.
      const tier = costs.map((c) => ({ c: costOf(c), t: (c as { tier?: { type?: unknown; size?: unknown } } | null)?.tier })).find((x) => x.c && x.t?.type === "context" && typeof x.t.size === "number");
      const size = tier ? (tier.t!.size as number) : 0;
      const over = size % 1000 === 0 ? `${size / 1000}k` : String(size);
      row.price = { input: dollars(price.input), output: dollars(price.output), ...(tier ? { note: `${dollars(tier.c!.input)}/${dollars(tier.c!.output)} for prompts over ${over}` } : {}) };
    }
    out.push(row);
  }
  return out.length ? out : null;
}

/** How long OpenCode's model listing may take, in ms, before it's ended and the session's list is used (a test shortens it). */
export const OPENCODE_LIST = { ms: 30000 };

/**
  OpenCode's own list with each model's levels and price (opencodeModelList), asked of it standalone in `scratch`; null when it can't say.
  Only OpenCode 2 has `opencode api`: 1.x could read "api" as a folder and start its interface, so `version` (its --version
  line) must say 2 or later, and an unknown one isn't asked. Ended with all it started past OPENCODE_LIST.ms or on `signal`
  (runBounded), so a listing that hangs never holds up the tool list or Check my tools.
*/
export async function opencodeModels(path: string, env: NodeJS.ProcessEnv, scratch: string, version: string | undefined, signal?: AbortSignal, timeout = OPENCODE_LIST.ms): Promise<ModelInfo[] | null> {
  if (!opencodeApiIn(version) || signal?.aborted) return null;
  mkdirSync(scratch, { recursive: true });
  // Standalone: without it `opencode api` starts OpenCode's background service in a session of its own, which outlives
  // this bound and the app, and a second OpenCode home holding its port makes every listing wait and fail.
  const r = await runBounded(path, ["api", "--standalone", "GET", "/api/model"], { cwd: scratch, env, timeout, signal, input: "" });
  return r.code === 0 && !r.cut ? opencodeModelList(r.stdout) : null;
}

/** Whether an OpenCode --version line is version 2 or later, which has `opencode api`. */
export function opencodeApiIn(version: string | undefined): boolean {
  const m = /(\d+)\.\d+\.\d+/.exec(version ?? "");
  return Boolean(m && Number(m[1]) >= 2);
}

/**
  The effort levels an ACP session's thinking option lists (category thought_level, a select) for the model it is on now, in
  the tool's order and words. "default" goes: it is no level but the tool's own choice, which a session given no level keeps.
  Anything not in that shape gives none.
*/
export function thoughtLevels(configOptions: unknown): EffortInfo[] {
  if (!Array.isArray(configOptions)) return [];
  const option = (configOptions as Json[]).find((c) => c && c.category === "thought_level" && (c.type === undefined || c.type === "select"));
  type Choice = { value?: unknown; name?: unknown; description?: unknown; options?: Choice[] };
  const choices = Array.isArray(option?.options) ? (option.options as Choice[]).flatMap((c) => (Array.isArray(c?.options) ? c.options : [c])) : [];
  const out: EffortInfo[] = [];
  for (const c of choices) {
    if (typeof c?.value !== "string" || !c.value || c.value === "default" || out.some((e) => e.id === c.value)) continue;
    const e = effortOf(c.value, typeof c.description === "string" ? c.description : undefined);
    // A level Liner Code doesn't know is shown by the tool's own name for it, when it gave one.
    out.push(e.label === c.value && typeof c.name === "string" && c.name.trim() ? { ...e, label: c.name.trim() } : e);
  }
  return out;
}

/** Thinking levels as a tool may name them in a model's id ("gemini-3.8-flash-high"), lowest first. */
const LEVEL_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"];

/**
  Antigravity's models and its sign-in, from `agy models`, which opens no session (a session would stay in the person's
  Antigravity history, closed or not). Signed in, it lists "<id>\t<label>" lines, each Gemini model once per thinking level
  ("gemini-3.8-flash-high\tGemini 3.8 Flash (High)"), the older form of its ids, which it still takes: those become one model
  whose effort levels they are, as the session's thought_level option takes them. Where a session has listed its base ids
  (`families`, its model option's values), a line goes with the longest of them it starts with, as T3 Code reads those ids
  (apps/server/src/provider/acp/AntigravityAcpSupport.ts, legacyAntigravityFamily, MIT); before any session, two or more
  lines that differ only by a level make one model, and one listed once keeps its whole id ("gpt-oss-120b-medium").
  Signed out, or with a key it was told to use and doesn't have, it says so and exits 1; anything else is unknown.
*/
export async function agyModels(path: string, env: NodeJS.ProcessEnv, families?: string[]): Promise<{ signedIn?: boolean; models: ModelInfo[] }> {
  const r = await run(path, ["models"], { env, timeout: 30000, input: "" });
  const said = `${r.stdout}\n${r.stderr}`;
  if (r.code !== 0) return { signedIn: /sign in|log in|authenticat|api[ _]?key|not set/i.test(said) ? false : undefined, models: [] };
  const rows = r.stdout.split(/\r?\n/).map((l) => l.split("\t")).filter((c) => c.length >= 2 && c[0].trim() && !/\s/.test(c[0].trim())).map(([id, label]) => ({ id: id.trim(), label: label.trim() }));
  const LEVEL = /^(minimal|low|medium|high|xhigh|max)$/;
  // Its base and level: by the session's families where there are some, else by a level at its end.
  const family = (id: string) => (families ?? []).filter((f) => id === f || id.startsWith(`${f}-`)).sort((a, b) => b.length - a.length)[0];
  const split = (id: string): { base: string; level?: string } => {
    const f = family(id);
    if (f) {
      const rest = id.slice(f.length + 1);
      return id === f || !LEVEL.test(rest) ? { base: id } : { base: f, level: rest };
    }
    const m = /^(.*)-(minimal|low|medium|high|xhigh|max)$/.exec(id);
    return m ? { base: m[1], level: m[2] } : { base: id };
  };
  const byBase = new Map<string, { label: string; levels: string[] }>();
  const order: string[] = [];
  for (const row of rows) {
    const { base, level } = split(row.id);
    if (!byBase.has(base)) {
      byBase.set(base, { label: row.label, levels: [] });
      order.push(base);
    }
    if (level) byBase.get(base)!.levels.push(level);
  }
  const out: ModelInfo[] = [];
  for (const base of order) {
    const { label, levels } = byBase.get(base)!;
    // Without a session's families, a level alone at the end of one id is part of its name.
    if (!levels.length || (!family(base) && levels.length < 2)) {
      for (const row of rows.filter((x) => split(x.id).base === base)) out.push({ id: row.id, label: row.label, description: "" });
      continue;
    }
    const efforts = [...new Set(levels)].sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b)).map((l) => effortOf(l));
    // No default: agy doesn't say one in its list, and a session given no level thinks at agy's own (AcpSession.toEffort).
    out.push({ id: base, label: label.replace(/\s*\((minimal|low|medium|high|extra high|xhigh|max)\)\s*$/i, ""), description: "", efforts });
  }
  return { signedIn: true, models: out };
}

/** How to pick one of those models in a session that's already open. */
export function acpModelRequest(session: Json, sessionId: string, model: string): { method: string; params: Json } | null {
  if (!model || model === "default") return null;
  const option = ((session.configOptions as Json[] | undefined) ?? []).find((c) => c.category === "model" || c.id === "model");
  if (option) return option.currentValue === model ? null : { method: "session/set_config_option", params: { sessionId, configId: option.id, value: model } };
  if ((session.models as Json | undefined)?.currentModelId === model) return null;
  if (session.models) return { method: "session/set_model", params: { sessionId, modelId: model } };
  return null;
}

/** Skills as folders with a SKILL.md (name and description in its front matter), under each root. */
export function skillsIn(roots: string[]): SkillInfo[] {
  const out = new Map<string, SkillInfo>();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const n of names) {
      const skill = skillAt(join(root, n, "SKILL.md"));
      if (skill && !out.has(skill.name)) out.set(skill.name, { ...skill, path: join(root, n) });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** One skill.md file's name and description, from its front matter (its folder's name, else the file's, when it has none). */
export function skillAt(file: string): SkillInfo | null {
  if (!existsSync(file)) return null;
  try {
    const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, "utf8").replace(/^﻿/, ""))?.[1] ?? "";
    const stem = basename(file).toLowerCase() === "skill.md" ? basename(dirname(file)) : basename(file).replace(/\.md$/i, "");
    const name = /^name:\s*(.+)$/m.exec(head)?.[1]?.trim().replace(/^["']|["']$/g, "") || stem;
    const description = /^description:\s*(.+)$/m.exec(head)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
    return { name, description, path: file };
  } catch {
    // an unreadable skill
    return null;
  }
}

/** An ACP agent's commands, from the update it sends right after a session opens. */
export async function acpCommands(cmd: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<CommandInfo[]> {
  const path = which(cmd[0], env);
  if (!path) return [];
  const child = spawn(path, cmd.slice(1), { cwd, env, stdio: ["pipe", "pipe", "pipe"], detached: true }) as ChildProcessWithoutNullStreams;
  const waiting = new Map<number, (m: Json) => void>();
  let seq = 0;
  let found: CommandInfo[] | null = null;
  let got: () => void = () => {};
  const arrived = new Promise<void>((r) => (got = r));
  jsonLines(child.stdout, (v) => {
    const m = v as { id?: number; method?: string; params?: Json; result?: Json };
    if (typeof m.id === "number" && waiting.has(m.id) && !m.method) {
      waiting.get(m.id)!(m.result ?? {});
      waiting.delete(m.id);
    }
    const u = m.method === "session/update" ? ((m.params?.update ?? {}) as { sessionUpdate?: string; availableCommands?: { name: string; description?: string; input?: { hint?: string } }[] }) : null;
    if (u?.sessionUpdate === "available_commands_update") {
      found = (u.availableCommands ?? []).map((c) => ({ name: c.name, description: c.description ?? "", hint: c.input?.hint, source: "tool" }));
      got();
    }
  });
  child.stderr.resume();
  const request = (method: string, params: Json) =>
    new Promise<Json>((resolve) => {
      const id = ++seq;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const timers: NodeJS.Timeout[] = [];
  const after = (ms: number) => new Promise((r) => timers.push(setTimeout(r, ms)));
  try {
    await Promise.race([
      (async () => {
        await request("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "liner-code", title: "Liner Code", version: VERSION } });
        await request("session/new", { cwd, mcpServers: [] });
        await Promise.race([arrived, after(2500)]);
      })(),
      after(30000),
      gone(child),
    ]);
    return found ?? [];
  } finally {
    for (const t of timers) clearTimeout(t);
    killTree(child);
  }
}
