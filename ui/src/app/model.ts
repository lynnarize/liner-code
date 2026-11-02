/*
  What the screens work out from the engine's state: who an agent is, what a model is called,
  which bucket a session sits in, and the one line under its title.
*/
import type { Access, AgentProfile, EffortInfo, FileChange, Item, Mode, ModelInfo, ProviderInfo, RouteLevel, Settings, Thread } from "@contracts";
import { castOf, familyOf, splitModel } from "@contracts";
import type { MarkKind } from "./icons";

type Level = { id: Access; label: string; short: string; note: string };
/** The permissions you pick from: Auto (the default), Manual, Reviewer decides, and Full access last, apart. */
export const ACCESS_LEVELS: Level[] = [
  { id: "auto", label: "Auto", short: "Auto", note: "Lets routine steps through, asks about the rest." },
  { id: "ask", label: "Manual", short: "Manual", note: "Always asks before making changes." },
  { id: "review", label: "Reviewer decides", short: "Reviewer decides", note: "Another model approves routine steps for you." },
  { id: "full", label: "Full access", short: "Full access", note: "Acts without asking. Commands that can't be undone still ask." },
];
/** Levels Liner sets itself: a side chat or a routine's run only reads. */
const OWN_LEVELS: Level[] = [
  { id: "read", label: "Read only", short: "Read only", note: "Reads and answers. Changes nothing." },
  { id: "edits", label: "Edits on its own", short: "Edits on its own", note: "Edits files, asks before commands." },
];
export const accessOf = (a: Access) => ACCESS_LEVELS.find((x) => x.id === a) ?? OWN_LEVELS.find((x) => x.id === a) ?? ACCESS_LEVELS[0];

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
  [/mimo|xiaomi/, "mimo"],
  [/nemotron|nvidia/, "nvidia"],
  [/hermes|nous/, "hermes"],
];
/** Each tool's own logo, for its place on the rail and for a model it runs whose name doesn't say whose it is ("auto", "default"). */
const TOOL_MARK: Partial<Record<ReturnType<typeof familyOf>, MarkKind>> = { claude: "claudecode", codex: "codex", grok: "grok", cursor: "cursor", opencode: "opencode", hermes: "hermes", demo: "demo" };
/** Where a tool's models come from (Hermes's Nous Portal, OpenCode Go, an endpoint's service), by its name. */
const SOURCES: [RegExp, MarkKind][] = [
  [/nous/, "hermes"],
  // OpenCode's two services each have a mark of their own; Zen is OpenCode's own catalogue ("opencode/…").
  [/opencode[\s_-]?go/, "opencodego"],
  [/opencode/, "opencodezen"],
  [/openrouter/, "openrouter"],
  [/ollama/, "ollama"],
  [/anthropic|claude/, "claude"],
  [/openai|chatgpt/, "openai"],
  [/google|gemini|vertex/, "gemini"],
  [/deepseek/, "deepseek"],
  [/moonshot|kimi/, "kimi"],
  [/z\.?ai|zhipu|bigmodel/, "glm"],
  [/qwen|alibaba|dashscope|bailian/, "qwen"],
  [/minimax/, "minimax"],
  [/mistral/, "mistral"],
  [/x\.?ai|grok/, "grok"],
  [/nvidia/, "nvidia"],
];
/**
  A comment on a design tells the agent which part it's about (Design.tsx). What shows is only your
  words (`said`), and the part; `rest` is what goes to the agent after them.
*/
export function designPart(text: string): { said: string; rest: string; title?: string; part?: string } {
  const m = /\n\nThat's about this part of the design “([^”]*)” \(`[^`]*`\): `([^`]*)`[\s\S]*$/.exec(text);
  return m ? { said: text.slice(0, m.index), rest: text.slice(m.index), title: m[1], part: m[2] } : { said: text, rest: "" };
}

/** A source's logo from its name, or "other" when it's none of the ones known. */
export function sourceMarkOf(name: string): MarkKind {
  const n = name.toLowerCase();
  return SOURCES.find(([re]) => re.test(n))?.[1] ?? "other";
}

export function markOf(ref: string): MarkKind {
  const { provider, model } = splitModel(ref);
  const family = familyOf(provider);
  if (family === "demo") return "demo";
  const name = model.toLowerCase();
  for (const [re, kind] of MAKERS) if (re.test(name)) return kind;
  // An ACP agent you added says whose it is in its id ("acp.gemini").
  if (family === "acp") for (const [re, kind] of MAKERS) if (re.test(provider.slice(4))) return kind;
  // An API endpoint isn't the tool it runs through: its service's logo, by its name ("claude.api-deepseek", "codex.api-openrouter").
  if (/\.api-/.test(provider)) return sourceMarkOf(provider.slice(provider.indexOf(".api-") + 5));
  return TOOL_MARK[family] ?? "other";
}

export function providerLabel(ref: string, providers: ProviderInfo[]) {
  const { provider } = splitModel(ref);
  return providers.find((x) => x.id === provider)?.label ?? provider;
}

/**
  An agent by id. "@claude:claude-opus-5-5" is a model on its own, named after the model. One that's
  gone (the engine points its sessions at its model) shows as removed, never as another of yours.
*/
export function agentOf(id: string | undefined, agents: AgentProfile[], providers: ProviderInfo[]): AgentProfile {
  if (id?.startsWith("@")) {
    const ref = id.slice(1);
    return { id, name: modelLabel(ref, providers), role: providerLabel(ref, providers), glyph: "spark", specialty: "custom", model: ref, effort: "medium", soul: "" };
  }
  const found = agents.find((a) => a.id === id);
  if (found) return found;
  if (id && id !== "demo") return { id, name: "A removed agent", role: "", glyph: "spark", specialty: "custom", model: "", effort: "medium", soul: "" };
  return agents[0] ?? { id: "demo", name: "Demo", role: "", glyph: "spark", specialty: "custom", model: "demo:demo", effort: "low", soul: "" };
}
export const isModelAgent = (id?: string) => Boolean(id?.startsWith("@"));

/** How a session (or a new one) runs, from who's in it: a route is Auto, a planner is Plan, the rest Solo. */
export const modeOf = (s: { lead?: string; route?: unknown }): Mode => (s.route ? "auto" : s.lead ? "plan" : "solo");

/**
  Who a new session in a mode starts with, from your two models: Solo on the cheaper one (or with
  Dual frontier the second frontier one), Plan with the frontier model planning and the other
  building, Auto at your level. Plan with one model in both parts would share its session, so
  that's Solo. Null with no model ready.
*/
export function startOf(mode: Mode, settings: Pick<Settings, "picks" | "dual" | "route">, providers: ProviderInfo[], dual = settings.dual ?? false): { agent: string; lead?: string; route?: RouteLevel; dual: boolean } | null {
  const cast = castOf(providers, { dual, picks: settings.picks });
  if (!cast) return null;
  const agent = `@${cast.everyday}`;
  if (mode === "auto") return { agent, lead: undefined, route: settings.route?.level ?? "high", dual };
  if (mode === "plan" && cast.strong !== cast.everyday) return { agent, lead: `@${cast.strong}`, route: undefined, dual };
  return { agent, lead: undefined, route: undefined, dual };
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
  // Files changed and not committed don't wait on you: committing is yours to do or not (T3 Code
  // marks only what asks, fails or hasn't been seen, too).
  const needs = t.status === "waiting" || t.status === "error" || t.status === "limited" || t.unread || t.turns === 0;
  return needs ? "needs" : "open";
}

/** The line under a session's title, like "Forge · 3 files to review". */
export function statusLine(t: Thread, who: string): { text: string; warn?: boolean } {
  if (t.status === "running") return { text: `${who} · working` };
  if (t.status === "waiting") return { text: `${who} · waits for you`, warn: true };
  if (t.status === "error") return { text: `${who} · ran into a problem`, warn: true };
  if (t.status === "limited") return { text: `${who} · limited${t.limit?.until ? ` until ${clock(t.limit.until)}` : ""}`, warn: true };
  if (t.goal?.status === "active") return { text: `${who} · goal, turn ${t.goal.turns}` };
  if (t.turns === 0) return { text: `${who} · not started` };
  if (t.unread) return { text: `${who} · answered`, warn: true };
  // Said quietly: what's left to commit, for whoever commits.
  if ((t.toReview ?? 0) > 0) return { text: `${who} · ${t.toReview} ${t.toReview === 1 ? "file" : "files"} changed` };
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
  if (seconds < 9.95) return `${seconds.toFixed(1)}s`;
  // Rounded once, before it's split, so 119.6 seconds reads "2m 0s", not "1m 60s".
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s}s`;
}

export const money = (n: number) => (n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);
/** 152k, 7.5k, 1M, 1.2M: one decimal where it says something, none where it would be .0. */
export const compact = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `${n}`);

/**
  A thread's timeline, split into turns, in one pass. A turn that carries on the one before it
  (building its plan, finishing its draft, fixing what a check found: the turn item's `part`)
  joins it, so a hand-off reads as one turn; `n` counts the turns you see. Given the turns it made
  last time, a turn none of whose items changed keeps its very list, so its view can skip
  redrawing while another turn streams (T3 Code's useTimelineRows keeps its rows the same way).
*/
export function turnsOf(items: Item[], before?: Map<number, Item[]>) {
  const map = new Map<number, Item[]>();
  for (const it of items) {
    const list = map.get(it.turn);
    if (list) list.push(it);
    else map.set(it.turn, [it]);
  }
  const shown: { turn: number; n: number; items: Item[] }[] = [];
  for (const [turn, list] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
    const mark = list.find((x) => x.kind === "turn");
    const prev = shown[shown.length - 1];
    if (prev && mark?.kind === "turn" && mark.part) prev.items = [...prev.items, ...list];
    else shown.push({ turn, n: shown.length + 1, items: list });
  }
  return shown.map((g) => {
    const was = before?.get(g.turn);
    return { ...g, items: was && was.length === g.items.length && was.every((x, i) => x === g.items[i]) ? was : g.items };
  });
}

/** Files a turn and the turns that carried it on changed, as one list: each file once, its lines added up. */
export function mergeFiles(files: FileChange[]): FileChange[] {
  const by = new Map<string, FileChange>();
  for (const f of files) {
    const had = by.get(f.path);
    by.set(f.path, had ? { ...had, added: had.added + f.added, removed: had.removed + f.removed } : f);
  }
  return [...by.values()];
}

/** Files changed across a thread's turns, by turn. */
export function checkpointsOf(items: Item[]) {
  return items.flatMap((x) => (x.kind === "checkpoint" ? [x] : []));
}

export const sumLines = (files: { added: number; removed: number }[]) => files.reduce((s, f) => ({ added: s.added + f.added, removed: s.removed + f.removed }), { added: 0, removed: 0 });

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
