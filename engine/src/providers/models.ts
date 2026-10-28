/*
  Which models each agent tool can run, asked of the tool itself rather than kept as a list here:
  Claude Code through the Agent SDK's supportedModels(), Codex from `codex debug models`, and an
  ACP agent from the session it opens (its model config option, or its model list). Each model
  carries the effort levels that tool accepts for it, named the same way everywhere.
*/
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { CommandInfo, EffortInfo, ModelInfo, SkillInfo } from "../../../contracts/src/index.ts";
import { jsonLines, spawn, which } from "../exec.ts";

const LEVELS: Record<string, { label: string; description: string }> = {
  minimal: { label: "Minimal", description: "Barely thinks, for the smallest asks" },
  low: { label: "Low", description: "Fast, for small asks" },
  medium: { label: "Medium", description: "Thinks it through" },
  high: { label: "High", description: "Slower, checks its work" },
  xhigh: { label: "Extra high", description: "Deeper, for hard problems" },
  max: { label: "Max", description: "As deep as it goes" },
  ultra: { label: "Ultra", description: "The deepest this model offers" },
};

/** An effort level by its tool's name for it, with the description the tool gave, if any. */
export function effortOf(id: string, description?: string): EffortInfo {
  const known = LEVELS[id];
  return { id, label: known?.label ?? id.charAt(0).toUpperCase() + id.slice(1), description: description || known?.description };
}

/** Claude Code's extras on top of its effort levels. */
export const ULTRACODE: EffortInfo = { id: "ultracode", label: "Ultracode", description: "Extra high, plus multi-agent workflows" };
export const ULTRATHINK: EffortInfo = { id: "ultrathink", label: "Ultrathink", description: "Thinks as hard as it can on every turn" };

/** "Nous Portal · anthropic/claude-opus-5.5" or "OpenCode/Big Pickle": where it comes from, and its name. */
function split(name: string): { group?: string; label: string } {
  const dot = name.indexOf(" · ");
  if (dot > 0) return { group: name.slice(0, dot), label: name.slice(dot + 3) };
  const slash = name.indexOf("/");
  if (slash > 0 && !name.slice(0, slash).includes(" ")) return { group: name.slice(0, slash), label: name.slice(slash + 1) };
  return { label: name };
}

type Json = Record<string, unknown>;

/**
  Opens a throwaway ACP session in an empty folder and reads the models it offers: a "model"
  config option (OpenCode) or the session's model list (Hermes). The first entry is "default",
  whatever the tool is set to now.
*/
export async function acpModels(cmd: string[], label: string, env: NodeJS.ProcessEnv, scratch: string): Promise<ModelInfo[]> {
  const path = which(cmd[0], env);
  if (!path) return [];
  mkdirSync(scratch, { recursive: true });
  const child = spawn(path, cmd.slice(1), { cwd: scratch, env, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
  const waiting = new Map<number, (m: Json) => void>();
  let seq = 0;
  jsonLines(child.stdout, (v) => {
    const m = v as { id?: number; result?: Json; error?: unknown };
    if (typeof m.id === "number" && waiting.has(m.id)) {
      waiting.get(m.id)!(m.error ? {} : (m.result ?? {}));
      waiting.delete(m.id);
    }
  });
  child.stderr.resume();
  const request = (method: string, params: Json) =>
    new Promise<Json>((resolve) => {
      const id = ++seq;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 45000));
  try {
    const s = await Promise.race([
      (async () => {
        await request("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "liner-code", title: "Liner Code", version: "0.1.0" } });
        return request("session/new", { cwd: scratch, mcpServers: [] });
      })(),
      timeout,
    ]);
    if (!s) return [];
    const out: ModelInfo[] = [];
    let current = "";
    const option = ((s.configOptions as Json[] | undefined) ?? []).find((c) => c.category === "model" || c.id === "model");
    if (option) {
      current = String(option.currentValue ?? "");
      for (const o of (option.options as { value: string; name?: string; description?: string }[] | undefined) ?? []) out.push({ id: o.value, ...split(o.name ?? o.value), description: o.description ?? "", isDefault: o.value === current });
    } else {
      const state = s.models as { currentModelId?: string; availableModels?: { modelId: string; name?: string; description?: string }[] } | undefined;
      current = state?.currentModelId ?? "";
      for (const m of state?.availableModels ?? []) out.push({ id: m.modelId, ...split(m.name ?? m.modelId), description: (m.description ?? "").replace(/^Provider: [^•]*•?\s*/, "").replace(/^current$/, ""), isDefault: m.modelId === current });
    }
    const now = out.find((m) => m.isDefault);
    return [{ id: "default", label: `${label} default`, description: now ? `What ${label} is set to: ${now.label}` : `The model ${label} is set up with` }, ...out.map((m) => ({ ...m, isDefault: undefined }))];
  } finally {
    child.kill();
  }
}

/** How to pick one of those models in a session that's already open. */
export function acpModelRequest(session: Json, sessionId: string, model: string): { method: string; params: Json } | null {
  if (!model || model === "default") return null;
  const option = ((session.configOptions as Json[] | undefined) ?? []).find((c) => c.category === "model" || c.id === "model");
  if (option) return { method: "session/set_config_option", params: { sessionId, configId: option.id, value: model } };
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
      const file = join(root, n, "SKILL.md");
      if (!existsSync(file)) continue;
      try {
        const head = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, "utf8"))?.[1] ?? "";
        const name = /^name:\s*(.+)$/m.exec(head)?.[1]?.trim().replace(/^["']|["']$/g, "") || n;
        const description = /^description:\s*(.+)$/m.exec(head)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
        if (!out.has(name)) out.set(name, { name, description, path: join(root, n) });
      } catch {
        // unreadable skill
      }
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** An ACP agent's commands, from the update it sends right after a session opens. */
export async function acpCommands(cmd: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<CommandInfo[]> {
  const path = which(cmd[0], env);
  if (!path) return [];
  const child = spawn(path, cmd.slice(1), { cwd, env, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
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
  try {
    await Promise.race([
      (async () => {
        await request("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "liner-code", title: "Liner Code", version: "0.1.0" } });
        await request("session/new", { cwd, mcpServers: [] });
        await Promise.race([arrived, new Promise((r) => setTimeout(r, 2500))]);
      })(),
      new Promise((r) => setTimeout(r, 30000)),
    ]);
    return found ?? [];
  } finally {
    child.kill();
  }
}
