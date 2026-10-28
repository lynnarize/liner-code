/*
  What the screens work out from the engine's state: who an agent is, what a model is called,
  which bucket a session sits in, and the one line under its title.
*/
import type { Access, AgentProfile, EffortInfo, Item, ModelInfo, ProviderInfo, Setup, Thread } from "@contracts";
import { familyOf, splitModel } from "@contracts";
import type { MarkKind } from "./icons";

export const ACCESS_LEVELS: { id: Access; label: string; short: string; note: string }[] = [
  { id: "read", label: "Read only", short: "Read only", note: "Reads and answers. Changes nothing." },
  { id: "ask", label: "Asks first", short: "Asks before edits", note: "Asks before every command and edit." },
  { id: "edits", label: "Edits on its own", short: "Edits on its own", note: "Edits files, asks before commands." },
  { id: "auto", label: "Reviewer decides", short: "Reviewer decides", note: "A reviewer approves routine steps and asks you about the rest." },
  { id: "full", label: "Full access", short: "Full access", note: "Acts, then tells you. Commands that can't be undone still ask." },
];
export const accessOf = (a: Access) => ACCESS_LEVELS.find((x) => x.id === a) ?? ACCESS_LEVELS[1];

/** For a tool that doesn't say which levels a model takes. */
export const EFFORTS: EffortInfo[] = [
  { id: "low", label: "Low", description: "Fast, for small asks" },
  { id: "medium", label: "Medium", description: "Thinks it through" },
  { id: "high", label: "High", description: "Slower, checks its work" },
];
/** Claude Code's extras sit after the levels, apart from them. */
export const EXTRA_EFFORTS = new Set(["ultracode", "ultrathink"]);

/** A model as its tool reported it. */
export function modelInfo(ref: string, providers: ProviderInfo[]): ModelInfo | undefined {
  const { provider, model } = splitModel(ref);
  return providers.find((p) => p.id === provider)?.models.find((m) => m.id === model);
}

/** The effort levels a model takes, and which it uses when you don't pick. None: it takes no level. */
export function effortsFor(ref: string, providers: ProviderInfo[]): { list: EffortInfo[]; fallback: string | undefined } {
  const { provider } = splitModel(ref);
  const p = providers.find((x) => x.id === provider);
  const m = modelInfo(ref, providers);
  if (m?.efforts) return { list: m.efforts, fallback: m.defaultEffort };
  return p?.supports.effort ? { list: EFFORTS, fallback: "medium" } : { list: [], fallback: undefined };
}

/** "Extra high effort", "Ultracode". */
export function effortName(id: string, ref: string, providers: ProviderInfo[]) {
  const e = effortsFor(ref, providers).list.find((x) => x.id === id) ?? EFFORTS.find((x) => x.id === id);
  const label = e?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
  return EXTRA_EFFORTS.has(id) ? label : `${label} effort`;
}

/** "claude:claude-opus-5-5" → "Opus 5.5". */
export function modelLabel(ref: string, providers: ProviderInfo[]) {
  const { provider, model } = splitModel(ref);
  const p = providers.find((x) => x.id === provider);
  const m = p?.models.find((x) => x.id === model);
  if (m) return m.label;
  if (provider === "demo") return "Demo";
  if (!model || model === "default") return p?.label ?? provider;
  return model;
}

/** A model on Claude Code, on any of its accounts. */
export const onClaude = (ref: string) => familyOf(splitModel(ref).provider) === "claude";

/** Who makes a model, by its name: tools like OpenCode and Hermes carry other makers' models ("anthropic/claude-sonnet-5-5"). */
const MAKERS: [RegExp, MarkKind][] = [
  [/claude|opus|sonnet|haiku|fable|anthropic/, "claude"],
  [/gpt|codex|openai|chatgpt|(^|[/:_-])o[1345](\b|-|$)/, "openai"],
  [/gemini|gemma|google/, "gemini"],
  [/grok|x-?ai\//, "grok"],
  [/deepseek/, "deepseek"],
  [/qwen|qwq|alibaba/, "qwen"],
  [/mistral|mixtral|codestral|devstral|magistral|ministral/, "mistral"],
  [/llama|meta-|meta\//, "meta"],
  [/kimi|moonshot/, "kimi"],
  [/glm|zhipu|z-?ai\//, "glm"],
  [/minimax|abab/, "minimax"],
  [/hermes|nous/, "hermes"],
];
/** Each tool's own models, when the name doesn't say whose they are ("auto", "default"). */
const TOOL_MARK: Partial<Record<ReturnType<typeof familyOf>, MarkKind>> = { claude: "claude", codex: "openai", grok: "grok", cursor: "cursor", opencode: "opencode", hermes: "hermes", demo: "demo" };

export function markOf(ref: string): MarkKind {
  const { provider, model } = splitModel(ref);
  const family = familyOf(provider);
  if (family === "demo") return "demo";
  const name = model.toLowerCase();
  for (const [re, kind] of MAKERS) if (re.test(name)) return kind;
  // An ACP agent you added says whose it is in its id ("acp.gemini").
  if (family === "acp") for (const [re, kind] of MAKERS) if (re.test(provider.slice(4))) return kind;
  return TOOL_MARK[family] ?? "other";
}

export function providerLabel(ref: string, providers: ProviderInfo[]) {
  const { provider } = splitModel(ref);
  return providers.find((x) => x.id === provider)?.label ?? provider;
}

/** An agent by id. "@claude:claude-opus-5-5" is a model on its own, named after the model. */
export function agentOf(id: string | undefined, agents: AgentProfile[], providers: ProviderInfo[]): AgentProfile {
  if (id?.startsWith("@")) {
    const ref = id.slice(1);
    return { id, name: modelLabel(ref, providers), role: providerLabel(ref, providers), glyph: "spark", specialty: "custom", model: ref, effort: "medium", soul: "" };
  }
  return agents.find((a) => a.id === id) ?? agents[0] ?? { id: "demo", name: "Demo", role: "", glyph: "spark", specialty: "custom", model: "demo:demo", effort: "low", soul: "" };
}
export const isModelAgent = (id?: string) => Boolean(id?.startsWith("@"));

/** Your setups as they stand (shared with the engine, which starts sessions from them the same way). */
export { setupOf, setupsOf } from "@contracts";

/** A setup in one line, by what it does: "Helm plans · DeepSeek builds, then Opus 5.5 takes it on · checked". */
export function setupLine(s: Setup, agents: AgentProfile[], providers: ProviderInfo[]) {
  const name = (id: string) => agentOf(id, agents, providers).name;
  return [
    s.lead ? `${name(s.lead)} plans` : "",
    s.stages.map((st, i) => `${name(st.who)} ${i === 0 ? (s.stages.length > 1 || s.lead ? "builds" : "straight to the code") : "takes it on"}`).join(", then "),
    s.crew.length ? `${plural(s.crew.length, "more agent")} on call` : "",
    s.checks.by === null ? "unchecked" : "checked",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The model a thread's agent runs on. */
export const threadModel = (t: Thread, agents: AgentProfile[], providers: ProviderInfo[]) => t.model ?? agentOf(t.agent, agents, providers).model;

/** Every model you can pick, across the providers that are ready. */
export function allModels(providers: ProviderInfo[]) {
  return providers.filter((p) => p.available && p.adapter).flatMap((p) => p.models.map((m) => ({ ref: `${p.id}:${m.id}`, label: m.label, description: m.description, provider: p.label, providerId: p.id, group: m.group, legacy: m.legacy, isDefault: m.isDefault })));
}
export type ModelChoice = ReturnType<typeof allModels>[number];

export type Bucket = "pinned" | "needs" | "working" | "open" | "snoozed" | "settled";

/**
  Where a session sits: Needs you and Working follow the agents; Pinned, Snoozed and Settled are
  yours. A session that needs nothing more from you stays open in its project until you settle
  it (or a rule you turned on does); new work there brings it back.
*/
export function bucketOf(t: Thread, now = Date.now()): Bucket {
  if (t.snoozedUntil && t.snoozedUntil > now) return "snoozed";
  if (t.done) return "settled";
  if (t.pinned) return "pinned";
  if (t.status === "running") return "working";
  const needs = t.status === "waiting" || t.status === "error" || t.status === "limited" || (t.toReview ?? 0) > 0 || t.unread || t.turns === 0;
  return needs ? "needs" : "open";
}

/** The line under a session's title, like "Forge · 3 files to review". */
export function statusLine(t: Thread, who: string): { text: string; warn?: boolean } {
  if (t.status === "running") return { text: `${who} · working` };
  if (t.status === "waiting") return { text: `${who} · waits for you`, warn: true };
  if (t.status === "error") return { text: `${who} · ran into a problem`, warn: true };
  if (t.status === "limited") return { text: `${who} · limited${t.limit?.until ? ` until ${clock(t.limit.until)}` : ""}`, warn: true };
  if (t.goal?.status === "active") return { text: `${who} · goal, turn ${t.goal.turns}` };
  if ((t.toReview ?? 0) > 0) return { text: `${who} · ${t.toReview} ${t.toReview === 1 ? "file" : "files"} to review`, warn: true };
  if (t.turns === 0) return { text: `${who} · not started` };
  if (t.unread) return { text: `${who} · answered`, warn: true };
  return { text: `${who} · done` };
}

/** "16:40" today, "Tue 09:00" this week, "Oct 3, 09:00" after. */
export function clock(at: number, now = Date.now()) {
  const d = new Date(at);
  const t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (new Date(now).toDateString() === d.toDateString()) return t;
  if (at - now < 6 * 86400000 && at > now) return `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${t}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${t}`;
}

/** "now", "2m", "11m", "2h", "Tue", "Oct 3". */
export function ago(at: number, now = Date.now()) {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const d = new Date(at);
  if (s < 6 * 86400) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "2 hours ago", "yesterday", "3 days ago", "2 weeks ago". */
export function since(at: number, now = Date.now()) {
  const h = (now - at) / 3600000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.floor(h)} ${Math.floor(h) === 1 ? "hour" : "hours"} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  return `${Math.floor(d / 30)} months ago`;
}

/** "3m 43s", "1m 12s", "18s", "1.4s". */
export function duration(seconds?: number) {
  if (seconds === undefined) return "";
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s}s`;
}

export const money = (n: number) => (n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);
export const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `${n}`);

/** A thread's timeline, split into turns. */
export function turnsOf(items: Item[]) {
  const map = new Map<number, Item[]>();
  for (const it of items) map.set(it.turn, [...(map.get(it.turn) ?? []), it]);
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([turn, list]) => ({ turn, items: list }));
}

/** Files changed across a thread's turns, by turn. */
export function checkpointsOf(items: Item[]) {
  return items.flatMap((x) => (x.kind === "checkpoint" ? [x] : []));
}

export const sumLines = (files: { added: number; removed: number }[]) => files.reduce((s, f) => ({ added: s.added + f.added, removed: s.removed + f.removed }), { added: 0, removed: 0 });

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
