/*
  Liner Code · Contracts
  Everything that crosses the wire between the engine and the app. The engine owns the state;
  the app renders it and sends commands. Change a shape here and both sides follow.

  Words, kept the same everywhere:
  - provider: the agent runtime the engine drives (Claude Code, Codex, Hermes, OpenCode, Demo).
  - agent: a named profile you open threads with: a provider and model, an effort, a soul.md.
  - project: a folder on this machine.
  - thread: one conversation with an agent in a project, made of turns.
  - turn: one message from you and everything the agent did until it stopped.
  - item: one thing on a thread's timeline: your message, the agent's text, a tool call, a plan,
    an approval it is waiting on, the checkpoint that closed a turn.
*/

/** The tools Liner Code knows by name. */
export type BuiltinProvider = "claude" | "codex" | "hermes" | "opencode" | "cursor" | "grok" | "demo";
/**
  A tool Liner Code drives. Besides the built-in ones: another account of one ("claude.work", its
  own config folder and sign-in) and an ACP agent you added ("acp.gemini"), from the registry or
  as a command of your own.
*/
export type ProviderId = BuiltinProvider | `${BuiltinProvider | "acp"}.${string}`;
/** "claude.work" → "claude": which tool an account is of. Agents you added are "acp". */
export function familyOf(id: ProviderId): BuiltinProvider | "acp" {
  return id.split(".")[0] as BuiltinProvider | "acp";
}

/**
  What a session may do without asking, from least to most:
  read (reads and answers), ask (asks before every command and edit), edits (edits files, asks
  before commands), auto (a reviewer approves routine steps and asks you about the rest),
  full (acts, and tells you; destructive commands still ask while the guard is on).
*/
/**
  What an agent may do on its own. `auto` is the tool's own auto mode (Claude Code's classifier,
  Codex judging when to ask); `review` hands each step it would ask about to the Reviewer, another
  model family, which lets routine ones go ahead and passes the rest to you.
*/
export type Access = "read" | "ask" | "edits" | "auto" | "review" | "full";
export const ACCESS: Access[] = ["read", "ask", "edits", "auto", "review", "full"];
/** How hard it thinks, by the tool's own name for it: low, medium, high, xhigh, max, and Claude Code's ultracode and ultrathink. */
export type Effort = string;
export type EffortInfo = { id: string; label: string; description?: string };

/** A model as its tool reports it. `id` is what the tool takes; `group` is where it comes from inside the tool (an ACP agent's provider). */
export type ModelInfo = {
  id: string;
  label: string;
  description: string;
  /** The effort levels the tool accepts for this model, lowest first. None: it doesn't take one. */
  efforts?: EffortInfo[];
  defaultEffort?: string;
  /** Older models, folded away in the picker. */
  legacy?: boolean;
  group?: string;
  /** What the tool picks when you don't. */
  isDefault?: boolean;
  /** A model id you added that the tool doesn't list. */
  custom?: boolean;
};

/** On a Mac without Apple's command line tools, /usr/bin/git and /usr/bin/python3 are stubs that pop an installer. */
/** What agents need on this Mac. `rg`: ripgrep, which agents search code with; `rgInstall` when it's missing and Homebrew can add it. */
export type SystemCheck = { git: boolean; python: boolean; clt: boolean; install?: string; rg: boolean; rgInstall?: string };

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  /** Installed and runnable on this machine. */
  available: boolean;
  /** Liner Code can drive it. Detected tools without an adapter yet show as coming soon. */
  adapter: boolean;
  /** The command that signs it in, shown on the setup screen. */
  login: string;
  /** What the tool's own status command says (`claude auth status`, `codex login status`); unset when it has none. */
  signedIn?: boolean;
  version?: string;
  /** Why it is unavailable, or how it is signed in. */
  detail?: string;
  /** How to install it, when it is missing. */
  install?: string;
  models: ModelInfo[];
  /** "cli" when the tool itself listed them (then `modelsAt` says when), "builtin" when it couldn't. */
  modelsFrom?: "cli" | "builtin";
  modelsAt?: number;
  supports: { approvals: boolean; resume: boolean; effort: boolean; plan: boolean };
  /** Another account of a tool: its name ("Work"), beside the tool's own label. */
  account?: string;
  /** An ACP agent you added: from the registry, or a command of your own. */
  added?: "registry" | "local";
  /** An API endpoint you added, run through this tool: its address. */
  endpoint?: string;
};

/**
  Another account of a tool: its own config folder (Claude Code's CLAUDE_CONFIG_DIR, Codex's
  CODEX_HOME, Hermes's HERMES_HOME), so it signs in apart, plus any variables it needs (a router's
  base URL) and, when it runs a different copy of the tool, that copy's path.
*/
export const ACCOUNT_HOME: Partial<Record<BuiltinProvider, string>> = { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME", hermes: "HERMES_HOME" };
export type ToolAccount = { id: string; provider: BuiltinProvider; label: string; home?: string; env?: Record<string, string>; binary?: string };
/** An ACP agent you added. `command` runs it; it speaks ACP on stdio. */
export type AddedAgent = { id: string; label: string; command: string[]; env?: Record<string, string>; from: "registry" | "local"; registryId?: string; version?: string; description?: string };
/** A model id a tool takes but doesn't list. */
export type CustomModel = { provider: ProviderId; id: string; label?: string };
/** How an API endpoint is spoken to: Anthropic's Messages, OpenAI's Responses, or OpenAI's Chat Completions. */
export type EndpointProtocol = "anthropic" | "responses" | "chat";
/**
  An API endpoint you added: an Anthropic- or OpenAI-compatible service (DeepSeek, Kimi, GLM,
  OpenRouter, LM Studio, Ollama…) and the models you use from it. Its models run through the tool
  that speaks its protocol (ENDPOINT_TOOL), shown as a tool of its own ("claude.api-deepseek"), so
  they get that tool's files, commands and approvals and Liner Code's own tools. Its key is kept
  in the keychain as endpointKey(id); a local one needs none.
*/
export type Endpoint = { id: string; label: string; url: string; protocol: EndpointProtocol; models: string[] };
export const ENDPOINT_TOOL: Record<EndpointProtocol, BuiltinProvider> = { anthropic: "claude", responses: "codex", chat: "opencode" };
export const endpointKey = (id: string) => `endpoint.${id}`;
/**
  The voucher: a code from Liner Code's site that runs one model, DeepSeek V4.1 Flash, on the site's
  plan (its five hours and its week), through OpenCode. An endpoint Settings doesn't list, named
  only "Promo"; the code is its key, kept like an endpoint's, and the site checks it on each call.
*/
export const VOUCHER: Endpoint = { id: "voucher", label: "Promo", url: "https://linerui.sorafel.com/api/code/v1", protocol: "chat", models: ["deepseek-v4.1-flash"] };
/** What a design's page gets in a frame of Liner Code's (the Design surface, the chat): no scrollbar of its own down its edge; it still scrolls. */
export const DESIGN_FRAME_STYLE = "<style>html{scrollbar-width:none!important}</style>";
/** An agent in the ACP registry, and how Liner Code would run it here. */
export type RegistryAgent = {
  id: string;
  name: string;
  version: string;
  description: string;
  website?: string;
  /** npx and uvx run it from its package; binary is downloaded for this Mac. */
  how: "npx" | "uvx" | "binary";
  /** Runnable here: the package runner is installed, or there's a build for this Mac. */
  runnable: boolean;
  /** Already one of your tools. */
  added?: ProviderId;
};

export type AgentGlyph = "sun" | "leaf" | "moon" | "pen" | "shapes" | "code" | "scope" | "lens" | "spark";
export type Specialty = "designer" | "coder" | "debugger" | "researcher" | "writer" | "custom";

/**
  An agent you made: a model with instructions of its own (its soul, a prompt, skills, context
  files). Optional: sessions run on a bare model ("@claude:claude-opus-5-5") unless you pick one.
  `model` is "<provider>:<model id>", like "claude:claude-opus-5-5".
*/
export type AgentProfile = {
  id: string;
  name: string;
  role: string;
  glyph: AgentGlyph;
  specialty: Specialty;
  model: string;
  effort: Effort;
  /** Appended to the provider's own system prompt. */
  soul: string;
  /** Added to every turn, after the soul. */
  prompt?: string;
  /**
    skill.md files it reads when a task calls for one. An absolute path is one of yours, the same
    in every project; a relative one is looked for in each session's project.
  */
  skills?: string[];
  /** Files read at the start of each session and handed to it: absolute paths, or relative to each project. */
  contextFiles?: string[];
  /** What it may change on its own in a new session; the session can lower it. */
  access?: Access;
  /**
    How it runs (Claude Code only): "helpers" keeps its model and sends reading and tests to
    cheap subagents; "single" is the model alone.
  */
  runMode?: RunMode;
  /** Its subagents' models: the Explorer's and the Test runner's. */
  subagents?: { explorer?: string; tests?: string };
};
/** Older saves may say "escalate", which runs as "helpers" now. */
export type RunMode = "helpers" | "single";

/**
  How a session works. In all three, one model writes at a time.
  solo: one model (or one of your agents) does it all.
  plan: a stronger model reads and plans, you approve, a cheaper one builds; talk and questions
  skip the planner and go to the builder.
  auto: each message gets the least work likely to do it well, from one model alone up to a judge
  or critics (RouteLevel, route.ts).
*/
export type Mode = "solo" | "plan" | "auto";
export const MODES: { id: Mode; label: string; note: string }[] = [
  { id: "solo", label: "Solo", note: "One model does it all, as you allow" },
  { id: "plan", label: "Plan, then build", note: "A stronger model plans, you approve, a cheaper one builds" },
  { id: "auto", label: "Auto", note: "Each message gets the least work likely to do it well" },
];

/**
  Your two models, and everything else follows from them. `frontier` plans, takes the hard jobs
  and refines; `cheaper` builds, answers and does the everyday work (and Solo starts on it). With
  Dual frontier on, `second`, a frontier model from another maker, builds in the cheaper one's
  place. `checker` reads changes, when you'd rather pick it. Any model a tool here runs, Chinese
  ones through OpenCode, Hermes or an API endpoint too; unset is automatic (castOf).
*/
export type ModelPicks = { frontier?: string; cheaper?: string; second?: string; checker?: string };

/** What a turn that carries on yours does (see the turn item's `part`). */
export type TurnPart = "build" | "refine" | "repair" | "fix" | "revise" | "takeover";

/**
  What happens to the writer's change before it's yours. check: another maker reads it and sends
  back what must be fixed. refine: the frontier model takes the cheaper one's draft on and finishes
  it (a Chinese model builds the first pass, Opus fine-tunes it); when the frontier model wrote it,
  it's checked instead. off: it's yours as it is. Auto has its own judge and critics.
*/
export type After = "check" | "refine" | "off";
export const AFTER: { id: After; label: string; note: string }[] = [
  { id: "check", label: "Check", note: "Another maker reads it and sends back what must be fixed" },
  { id: "refine", label: "Refine", note: "The frontier model takes the cheaper one's draft on and finishes it" },
  { id: "off", label: "Off", note: "Yours as it is" },
];

/**
  Who made a model, from its name first ("deepseek-v4-pro" through Claude Code's endpoint is
  DeepSeek's, "nous:openai/gpt-6-astra" through Hermes is OpenAI's), else from the tool it runs
  in. A check reads best from another maker than the writer's, so the two don't share blind spots.
*/
export type Maker = "anthropic" | "openai" | "google" | "xai" | "deepseek" | "zhipu" | "moonshot" | "qwen" | "minimax" | "xiaomi" | "other";
const MAKERS: [Maker, RegExp][] = [
  ["deepseek", /deepseek/i],
  ["zhipu", /glm|z-ai|zhipu/i],
  ["moonshot", /kimi|moonshot/i],
  ["qwen", /qwen|qwq/i],
  ["minimax", /minimax/i],
  ["xiaomi", /mimo/i],
  ["google", /gemini|gemma/i],
  ["xai", /grok/i],
  ["anthropic", /claude|opus|sonnet|haiku|fable/i],
  ["openai", /gpt|openai|astra|\bsol\b|luna|terra|\bo[1-9]\b|codex/i],
];
export function makerOf(ref: string): Maker {
  const { provider, model } = splitModel(ref);
  for (const [maker, re] of MAKERS) if (re.test(model)) return maker;
  const tool = familyOf(provider);
  return tool === "claude" ? "anthropic" : tool === "codex" ? "openai" : tool === "grok" ? "xai" : "other";
}

/**
  Each maker's strongest models (frontier) and its quicker, cheaper ones (everyday), by name, best
  first, so the parts fill from whatever you have: Claude Code or Codex, or only OpenCode, Hermes,
  Gemini or an API endpoint. The makers are in the order they're picked: for frontier work Claude,
  GPT, Gemini, Grok, then DeepSeek, Kimi, Qwen, GLM and MiniMax; for everyday work GPT, Claude,
  Gemini, then DeepSeek, GLM, Qwen, Kimi, MiniMax and Grok.
*/
const FRONTIER: [Maker, RegExp[]][] = [
  ["anthropic", [/opus/i, /fable/i]],
  ["openai", [/astra(?!.*(pro|fast|flex))/i, /astra(?!.*pro)/i, /sol(?!.*pro)/i, /sol/i, /gpt-[\d.]+$/i]],
  ["google", [/gemini.*ultra/i, /gemini.*pro/i]],
  ["xai", [/grok-[\d.]+(?!.*(fast|mini|code))/i]],
  ["deepseek", [/deepseek.*pro/i, /deepseek-[vr][\d.]+(?!.*(flash|lite|mini))/i]],
  ["moonshot", [/kimi.*pro/i, /kimi-k[\d.]+(?!.*(flash|turbo|code|mini))/i]],
  ["qwen", [/qwen.*max/i]],
  ["zhipu", [/glm-[\d.]+(?!.*(flash|air|lite))/i]],
  ["minimax", [/minimax-m[\d.]+(?!.*(flash|lite|mini))/i]],
];
const EVERYDAY: [Maker, RegExp[]][] = [
  ["openai", [/luna(?!.*pro)/i, /terra/i, /luna/i]],
  ["anthropic", [/sonnet/i]],
  ["google", [/gemini.*flash(?!.*lite)/i]],
  ["deepseek", [/deepseek.*flash/i]],
  ["zhipu", [/glm.*(flash|air)/i]],
  ["qwen", [/qwen.*(plus|flash)/i]],
  ["moonshot", [/kimi.*(turbo|flash|code)/i]],
  ["minimax", [/minimax.*(flash|lite)/i]],
  ["xai", [/grok.*(fast|mini)/i]],
];
/** The tool a maker's models run best in: Claude Code for Claude, Codex for GPT. Others that list them come after. */
const HOME: Partial<Record<Maker, BuiltinProvider>> = { anthropic: "claude", openai: "codex" };

const readyOf = (providers: ProviderInfo[]) => providers.filter((p) => p.available && p.adapter && p.id !== "demo" && p.models.length);

/** A maker's frontier or everyday model from what's ready, in its own tool when that lists one. */
function bestOf(ready: ProviderInfo[], maker: Maker, kind: "frontier" | "everyday") {
  const order = [...ready].sort((a, b) => Number(familyOf(b.id) === HOME[maker]) - Number(familyOf(a.id) === HOME[maker]));
  for (const re of (kind === "frontier" ? FRONTIER : EVERYDAY).find(([m]) => m === maker)?.[1] ?? [])
    for (const p of order) for (const m of p.models) if (!m.legacy && re.test(m.id) && makerOf(`${p.id}:${m.id}`) === maker) return `${p.id}:${m.id}`;
  return undefined;
}

/** The first maker in `makers` with a model of that kind ready, and that model. */
function firstOf(ready: ProviderInfo[], kind: "frontier" | "everyday", not?: Maker) {
  for (const [maker] of kind === "frontier" ? FRONTIER : EVERYDAY) {
    if (maker === not) continue;
    const ref = bestOf(ready, maker, kind);
    if (ref) return ref;
  }
  return undefined;
}

/** A model whose tool is ready, or nothing (a pick whose tool went away falls back to automatic). */
const readyRef = (ready: ProviderInfo[], ref?: string) => (ref && ready.some((p) => p.id === splitModel(ref).provider) ? ref : undefined);

/**
  Your frontier model and, for Dual frontier, the second one: your picks while their tools are
  ready, else automatic. The frontier is the first maker's in order (Opus, else GPT Astra or Sol,
  Gemini Pro, DeepSeek V4 Pro…); the second is the best frontier model of another maker (GPT Astra
  next to Opus). `second` is unset while no other maker has one ready.
*/
export function frontiersOf(providers: ProviderInfo[], picks: ModelPicks = {}): { frontier?: string; second?: string } {
  const ready = readyOf(providers);
  const frontier = readyRef(ready, picks.frontier) ?? firstOf(ready, "frontier");
  const mine = readyRef(ready, picks.second);
  const second = mine && mine !== frontier ? mine : frontier ? firstOf(ready, "frontier", makerOf(frontier)) : undefined;
  return { frontier, second };
}

/**
  Who does what, each "<provider>:<model>". In Plan, `strong` plans and `everyday` builds; in Auto
  `everyday` takes most messages, `strong` the hard ones and repairs, `judge` passes a medium job or
  hands it up, and `critics` read the hard ones. Refine is `strong` taking `everyday`'s draft on.
*/
export type RouteCast = { everyday: string; strong: string; judge: string; critics: string[]; checker?: string };

/**
  The cast from your two picks (ModelPicks) and what's ready, from any makers (FRONTIER,
  EVERYDAY). `strong` is your frontier model (automatic: Opus, else GPT Astra or Sol, Gemini Pro,
  DeepSeek V4 Pro…) and `everyday` your cheaper one (automatic: GPT Luna, else Sonnet, Gemini
  Flash, DeepSeek Flash…), or with `dual` the second frontier model when one is ready. The judge
  is your checker, else another maker than the everyday model's; the critics are other makers
  than the strong model's. `checker` is the checker you picked, while its tool is ready.
*/
export function castOf(providers: ProviderInfo[], o: { dual?: boolean; picks?: ModelPicks } = {}): RouteCast | null {
  const ready = readyOf(providers);
  if (!ready.length) return null;
  const picks = o.picks ?? {};
  const first = `${ready[0].id}:${(ready[0].models.find((m) => m.isDefault) ?? ready[0].models[0]).id}`;
  // The best of another maker than this model's: its frontier model, else its everyday one.
  const other = (ref: string) => firstOf(ready, "frontier", makerOf(ref)) ?? firstOf(ready, "everyday", makerOf(ref));
  const cheaper = readyRef(ready, picks.cheaper) ?? firstOf(ready, "everyday") ?? first;
  const { frontier, second } = frontiersOf(providers, picks);
  const strong = frontier ?? cheaper;
  const everyday = o.dual && second ? second : cheaper;
  const mine = readyRef(ready, picks.checker);
  const judge = mine && mine !== everyday ? mine : makerOf(strong) !== makerOf(everyday) ? strong : (other(everyday) ?? strong);
  // Reads from outside the strong model's maker where there is one: its best, and the everyday model when that's another.
  const outside = other(strong);
  const also = makerOf(everyday) !== makerOf(strong) ? everyday : undefined;
  const critics = outside ? [...new Set([outside, also ?? outside])] : [everyday];
  return { everyday, strong, judge, critics, ...(mine ? { checker: mine } : {}) };
}

/**
  Who checks a writer's change (After: Check): the checker you picked, unless it wrote the change
  itself; else from the cast, another maker than the writer's, so the two don't share blind spots;
  else any other model in it; null when there's none.
*/
export function checkerOf(writer: string, cast: RouteCast | null): string | null {
  if (!cast) return null;
  if (cast.checker && cast.checker !== writer) return cast.checker;
  const pool = [cast.judge, cast.strong, ...cast.critics, cast.everyday];
  return pool.find((r) => makerOf(r) !== makerOf(writer)) ?? pool.find((r) => r !== writer) ?? null;
}

/**
  Auto's levels. single: one model does it. cascade: the everyday model does it and a judge from
  another maker reads the change; it passes, or goes with the judge's findings to the strong model
  to repair, and the judge reads the repair once. critique: the strong model does it, critics from
  other makers read it side by side, and it revises once with what they found. The level is how
  far it may go: standard keeps to one model a message (the strong one for hard jobs), high adds
  the cascade for medium jobs and a critic for hard ones, max checks everything and brings two
  critics to the hardest.
*/
export type RouteLevel = "standard" | "high" | "max";
export type RoutePattern = "single" | "cascade" | "critique";
/** How big a job a message looks: light (talk, a small change), medium, heavy. */
export type RouteWeight = "light" | "medium" | "heavy";
/** An Auto session: its level and cast, the model writing now (`root`), and what the last message got. */
export type ThreadRoute = { level: RouteLevel; cast: RouteCast; root: string; last?: { at: number; weight: RouteWeight; pattern: RoutePattern; escalated?: boolean } };
export const ROUTE_LEVELS: { id: RouteLevel; label: string; note: string }[] = [
  { id: "standard", label: "Standard", note: "One model a message: the everyday one, the strong one for hard jobs" },
  { id: "high", label: "High", note: "Medium jobs get a judge that passes them or hands them up; hard ones a critic" },
  { id: "max", label: "Max", note: "Everything is checked; the hardest jobs get two critics" },
];

export type Project = {
  id: string;
  name: string;
  path: string;
  /** Who a new thread in this project starts with. */
  agent?: string;
  /** Runs in each new worktree before its first turn, like "npm install". */
  setup?: string;
  /** Named commands with a run button (a dev server, the tests); some also run in each new worktree. */
  scripts?: ProjectScript[];
  git: boolean;
  /** When the last commit was made, for the project list. */
  lastCommitAt?: number;
  branch?: string;
  /** Its GitHub repository, as "owner/name", when origin points there. */
  remote?: string;
  createdAt: number;
};

/** limited: the tool's plan ran out mid-turn; Resume carries on once it resets. */
export type ThreadStatus = "idle" | "running" | "waiting" | "done" | "error" | "limited";

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  /** Tokens in the context at the end of the last turn, and the window, when the provider says. */
  contextTokens?: number;
  contextWindow?: number;
};

export type Thread = {
  id: string;
  projectId: string;
  title: string;
  /** Who writes: a bare model ("@claude:claude-sonnet-5-5") or one of your agents. In Plan mode, the builder. */
  agent: string;
  /** Plan mode: the model (or agent) that reads and plans first; you approve, then `agent` builds. */
  lead?: string;
  /** Who took the last turn: the planner while it plans and its plan waits on you, then the builder. */
  turnBy?: string;
  /** Dual frontier: a second frontier model builds in the cheaper one's place (ModelPicks). */
  dual?: boolean;
  /** What happens to each change before it's yours (After); unset, it follows Settings. */
  after?: After;
  /**
    When the tool's prompt cache for this thread likely runs out (Claude Code: an hour after the
    last turn on a subscription, five minutes with an API key). Past it, a long thread is read again
    at full price, so the composer offers to compact first.
  */
  cacheUntil?: number;
  status: ThreadStatus;
  access: Access;
  /** Overrides the agent's model for this thread. */
  model?: string;
  effort?: Effort;
  forkOf?: string;
  archived?: boolean;
  /** Where you put a session: Pinned on top, Snoozed until a time, or settled (`done`), out of the way until it's busy again. Only you settle a session, unless you turned on a rule that does. */
  pinned?: boolean;
  snoozedUntil?: number;
  done?: boolean;
  /** Changes from finished turns that you haven't committed or undone yet. */
  toReview?: number;
  /** A turn finished while you were looking elsewhere. */
  unread?: boolean;
  /** Messages you wrote while it worked, sent in order when the turn ends. */
  queue?: QueuedMessage[];
  /** The Reviewer's last word on this session's changes. */
  verdict?: { state: "checking" | "verified" | "blocked"; note?: string; round: number };
  /** Your own sidebar group. */
  group?: string;
  /** Snoozed until something happens rather than a time. */
  wake?: { kind: "checks" | "reply"; pr: number };
  /** One of several models given the same ask, to compare and keep one. */
  compare?: { id: string; base: string };
  /** The pull request this session's branch opened. */
  pr?: { number: number; url: string; state: string };
  /** A routine's run. */
  routine?: { id: string; run: string };
  /** A run of the cost test there used to be, which stays out of your lists. */
  trial?: { id: string; way: string; at: number; finished?: number; failed?: string };
  /** From the setups there used to be: who read the change (null: nobody) and how many rounds it could send back. */
  checks?: { by: string | null; rounds: number };
  /** Auto mode: each message gets its own pattern and models (see ThreadRoute); `agent` is the everyday model. */
  route?: ThreadRoute;
  /**
    How the agent works in it, fixed for the session's life (DeepSeek Harness's agent presets):
    unset is Standard; "creator" is Creator mode, which adds to Liner Code itself (its connections,
    panels and apps) through conversation; "agent:<id>" is a custom mode, one of your named agents'
    instructions laid over whichever model the session runs.
  */
  mode?: SessionMode;
  /**
    Runs in a worktree of its own, on this branch. `path` is where it works; for a project inside
    a bigger repository that is the project's folder within the worktree, whose top is `root`.
    `made`: Liner Code made it for this session (or the one it was forked from), so it may put it
    back when it's gone and remove it with the session; a worktree you picked stays yours.
  */
  worktree?: { path: string; branch: string; root?: string; made?: boolean };
  /** Why it's limited and when the window reopens, while `status` is "limited". */
  limit?: { message: string; until?: number; provider: string };
  /** A goal it keeps working toward across turns (/goal), until it says the goal is met. */
  goal?: { text: string; status: "active" | "met" | "stopped"; turns: number; max: number };
  /** The provider's own session id, for resume. */
  providerSession?: string;
  /** The planner's own provider session, in Plan mode. */
  leadSession?: string;
  /** The provider sessions of others who write here besides `agent` (the frontier model refining), by who they are. */
  sessions?: Record<string, string>;
  /** A fork's first turn: the parent's provider session it continues from. */
  forkSession?: string;
  /**
    A side chat beside the session `sideOf`: a fork of it that only reads and answers, so you can
    ask about the session without stopping it or adding to it. It knows the session up to turn
    `sideFrom`; its own turns come after. It never shows in the sidebar.
  */
  sideOf?: string;
  sideFrom?: number;
  turns: number;
  usage: Usage;
  /** Where the spending cap stops this session now: the cap, plus another cap's worth each time you go on past it. */
  spendLimit?: number;
  createdAt: number;
  updatedAt: number;
};

/** files: what you attached, saved on disk, which go with the message when it's sent. */
export type QueuedMessage = { id: string; text: string; at: number; files?: string[] };
export type Question = { question: string; header?: string; options: { label: string; description?: string; suggested?: boolean }[]; multiSelect?: boolean };

export type ToolKind = "read" | "edit" | "write" | "exec" | "search" | "fetch" | "think" | "task" | "web" | "other";
export type FileChange = { path: string; status: "added" | "modified" | "deleted" | "renamed"; added: number; removed: number; from?: string };
export type PlanEntry = { title: string; status: "pending" | "in_progress" | "completed" };
export type Risk = "low" | "medium" | "high";
/** What a design is drawn for: the frame the Design surface shows it in, and its picture's size. */
export type DesignSize = "desktop" | "tablet" | "phone";
/** A design of a session, as the Design surface lists it: its latest version, and the version you had built, if you did. */
export type DesignInfo = { design: string; title: string; path: string; size: DesignSize; versions: number; built?: { version: number; at: number } };

/*
  Add-ons: what an agent makes for Liner Code, added only on your OK. Two kinds. A connection is an
  MCP server that every agent tool gets (Claude Code, Codex, OpenCode, Hermes): settings, and each
  tool starts the server itself. A panel is a small page of the agent's own (HTML, scripts,
  styles) that opens in the right dock, as a tab beside Chat, or as a page of its own from the
  left sidebar; it runs in a sealed frame in the window and touches only what its manifest lists.
  An agent writes its manifest in the session's folder (.liner/addons/<id>/addon.json, a panel's
  files beside it) and asks with addon_install; you add it on a card, and each install is kept as
  a version in ~/.liner-code/addons/<id>/v<n>/. Nothing an agent writes runs in the engine.
*/
/** How a connection's server is reached: a command on this Mac (stdio), or an address (streamable HTTP). */
export type AddonServer = { stdio: { command: string; args?: string[]; env?: Record<string, string> } } | { http: { url: string; headers?: Record<string, string> } };
/** A key a connection needs, named only: you type it on the install card, and it's sealed in the keychain. */
export type AddonSecret = { name: string; label: string };
/** A connection's manifest, version 1. A secret is never written in: `${NAME}` in env or a header stands for it. */
export type ConnectionManifest = { apiVersion: 1; id: string; kind: "connection"; name: string; description?: string; server: AddonServer; secrets?: AddonSecret[] };
/**
  What a panel may touch: each is nothing unless its manifest says so, and the install card says
  every one. The panel's bridge (apiVersion 1) refuses whatever isn't here.
*/
export type PanelAccess = {
  /** The files of the session's project folder (its worktree, in one), to read. */
  files?: "project";
  /** Sessions: the one it's open beside ("this": its title, changes and commands), or every session's titles and changes ("all"). */
  sessions?: "this" | "all";
  /** It may put text in the composer, for you to send. */
  composer?: boolean;
  /** Its own storage, up to this many KB (1024 at most). */
  storage?: number;
  /** The one host it may reach, over https ("api.github.com"). No network when unset. */
  network?: string;
};
/** Where a panel opens: the right dock beside a session, a tab beside Chat, or a page of its own from the left sidebar. */
export type PanelPlace = "dock" | "tab" | "page";
export const PANEL_ICONS = ["app", "blocks", "list", "notes", "chart", "check", "clock", "globe", "flask", "star", "bolt", "inbox"] as const;
export type PanelIcon = (typeof PANEL_ICONS)[number];
/** A panel's manifest, version 1. `entry` is its HTML file, beside the manifest. */
export type PanelManifest = { apiVersion: 1; id: string; kind: "panel"; name: string; description?: string; place: PanelPlace; entry: string; icon?: PanelIcon; access: PanelAccess };
export type AddonManifest = ConnectionManifest | PanelManifest;
/** A session's mode: Standard ("standard", or unset), Creator mode ("creator"), or a custom one (`agent:<id>`, one of your named agents' instructions). */
export type SessionMode = "standard" | "creator" | `agent:${string}`;
/**
  The modes Liner Code comes with, as Settings › Modes and the new-session picker show them, with
  their guide: an intro, Mode details, and How to use with example tasks (DeepSeek Harness's
  preset guide, ui-agent-preset/guide-locales.ts, its words for Liner Code).
*/
export type ModeGuide = { id: "standard" | "creator"; name: string; blurb: string; intro: string; details: { h: string; p: string }[]; examples: { h: string; ask: string; expect: string }[] };
export const BUILTIN_MODES: ModeGuide[] = [
  {
    id: "standard",
    name: "Standard",
    blurb: "Work with code, files and information. Right for most tasks, with search, editing, terminal commands and Liner Code's own tools as needed.",
    intro: "Choose Standard mode for a new task. Describe what you want done, point to the files that matter, and say how to check the result.",
    details: [
      { h: "How it works", p: "The agent calls its tools directly to read and edit files, search, and run terminal commands, with Liner Code's own beside them: the Browser, the Design surface, pages in the chat, memory and earlier sessions. Solo, Plan or Auto in the composer still decides who works on it." },
      { h: "When to choose it", p: "Start here for everyday coding, file work and research. It can still offer to make an app at the end of a turn, on a card you answer." },
    ],
    examples: [
      { h: "Fix a bug", ask: "Find out why submitting the search form twice makes the results disappear. Fix it and run the relevant tests. Explain the cause and what changed.", expect: "A change, the tests it ran, and the cause in a few lines." },
      { h: "Sort out project notes", ask: "Read the Markdown notes in this project. Sum up the decisions we agreed and the open questions, with links to the files they're in.", expect: "A summary you can check against the notes it links to." },
    ],
  },
  {
    id: "creator",
    name: "Creator mode",
    blurb: "Customize Liner Code through conversation. Let the agent make connections, panels and apps that add features or UI, or combine tools and prompts to make your own mode.",
    intro: "Choose Creator mode for a new task. Describe what you want, where it should appear, and how you'll check it.",
    details: [
      { h: "What you can create", p: "Creator mode has everything in Standard, plus a guide to Liner Code's add-ons that the agent reads a part at a time: what it can make, the panel bridge, the places an app can open, the manifest, the theme's tokens, a starter for each kind, how to check its work, and what's installed now." },
      { h: "Add-ons and modes", p: "An add-on adds to Liner Code: a connection every agent tool gets, a panel in the right dock, an app as a tab beside Chat or a page of its own from the left sidebar. A mode is a set of instructions for whichever model a session runs, which you pick when you start one." },
      { h: "How the result takes effect", p: "Ask it to add and check what it makes, not only to write the files. Nothing goes in without your yes on its card, and it gets only the access it lists. A panel or an app opens at once; a connection reaches agent tools now or from their next turn. A new mode is picked when you start a session. Its folder is the project you picked, or Scratch." },
    ],
    examples: [
      { h: "Add a page", ask: "Make a notes app with a left sidebar entry that opens a full-page editor. Keep my notes between sessions. Add it, and check that the page opens.", expect: "An app under Apps in the left sidebar, its page working, and what it checked." },
      { h: "Add a panel", ask: "Make a panel beside my sessions that lists the TODOs in this project, so I can send one to you. Check it, then ask me to add it.", expect: "A panel in the right dock, tried live as a preview before you add it." },
      { h: "Make my own mode", ask: "Make a “Code review” mode: prioritise likely bugs and missing tests, cite files and lines, and ask before changing anything. Save it as a mode I can pick.", expect: "A mode you pick when you start a session. Its instructions guide the model; Safety still decides what it may do." },
    ],
  },
];
export const modeName = (mode: SessionMode | undefined, agents: { id: string; name: string }[]) => (!mode || mode === "standard" ? "Standard" : mode === "creator" ? "Creator mode" : (agents.find((a) => `agent:${a.id}` === mode)?.name ?? "A custom mode"));

/** Where an offer to make an app stands: offered, being made and added, settled, or replaced by a newer offer. */
export type OfferState = "proposed" | "creating" | "installing" | "installed" | "kept" | "removed" | "dismissed" | "cancelled" | "failed" | "replaced";
/** A panel as Settings and the dock know it. */
export type PanelInfo = { place: PanelPlace; access: PanelAccess; icon?: PanelIcon; entry: string };
/** An add-on you have, as Settings lists it. */
export type AddonInfo = {
  id: string;
  kind: "connection" | "panel";
  name: string;
  description?: string;
  /** The version in use, and every one kept. */
  version: number;
  versions: number[];
  enabled: boolean;
  /** When you removed it: it stays on disk, off, until you restore it. */
  removed?: number;
  /** The one project it's for; every project when unset. */
  project?: string;
  /** Who added it, from which session, and when. */
  by: { agent: string; threadId?: string; title?: string; at: number };
  /** A connection's way in: a command (stdio) or an address (http). */
  transport?: "stdio" | "http";
  /** What it reaches: its address, or the command it runs; a panel's access, in words. */
  reaches: string;
  secrets: AddonSecret[];
  /** A panel's place, access, icon and entry file. */
  panel?: PanelInfo;
  /** Each kept version's date, by version. */
  dates?: Record<number, number>;
};
/** Where a connection's key is kept: the keychain account (`key:` before it) and the engine's name for it. */
export const addonKey = (id: string, secret: string) => `addon.${id}.${secret}`;
/** An agent asking to add an add-on: what the install card shows, and once added, as which version and where. */
export type AddonAsk = ConnectionAsk | PanelAsk;
type AskBase = {
  id: string;
  name: string;
  description?: string;
  /** The draft it was read from, in the session's folder. */
  path: string;
  /** The session's project, which the card offers beside every project. */
  project: { id: string; name: string };
  /** The manifest as checked, for Details. */
  manifest: string;
  /** The version you have now, when this one would replace it. */
  replaces?: number;
  scope?: "all" | "project";
  version?: number;
};
/**
  A panel's card: what it may touch, its files, what addon_check saw of it, and against the version
  in use, what it asks for that that one didn't (`wider`). One that asks for nothing more is put in
  without a card (`same`), and its line says so.
*/
export type PanelAsk = AskBase & { kind: "panel"; place: PanelPlace; access: PanelAccess; icon?: PanelIcon; entry: string; files: { path: string; size: number }[]; checked?: string; wider?: string[]; same?: boolean; next: number };
export type ConnectionAsk = AskBase & {
  kind?: "connection";
  transport: "stdio" | "http";
  /** Its address, or the command line it runs. */
  server: string;
  /** The variables a command gets, by name only (its keys among them), so you OK exactly what it's given. */
  env?: string[];
  /** The agent tools on this Mac it reaches ("Claude Code", "Codex"…). */
  reaches: string[];
  secrets: AddonSecret[];
};

type Base = { id: string; turn: number; at: number };
export type Item =
  | (Base & {
      kind: "turn";
      /** Who worked this turn and on what, for the line above its work. */
      agent: string;
      model: string;
      /** A planner's turn, which ends in a plan rather than in edits. */
      planning?: boolean;
      status: "running" | "done" | "stopped" | "error";
      seconds?: number;
      /**
        A turn that carries on the one you started, by another model or the same one: building the
        plan, finishing a draft, repairing or fixing what a check found, revising after critics,
        taking over. It shows as part of your turn, not a turn of its own.
      */
      part?: TurnPart;
      /** Why this turn went to whom (Auto's choice, a plan for a hard job), said when you ask, not on the timeline. */
      why?: string;
    })
  | (Base & {
      kind: "user";
      text: string;
      files?: string[];
      steer?: boolean;
      /** Asked about lines in the diff: the agent's answer belongs to this place. */
      anchor?: { file: string; line: number; endLine?: number };
    })
  | (Base & {
      kind: "review";
      /** Who reviewed, as "<provider>:<model>". */
      reviewer: string;
      round: number;
      status: "running" | "passed" | "blocked" | "error";
      findings: Finding[];
      summary?: string;
      seconds?: number;
      /** Its findings went to a model working on the change (a fix, a repair, your next message): not sent again. */
      heard?: boolean;
    })
  | (Base & { kind: "text"; text: string; streaming: boolean })
  | (Base & { kind: "reasoning"; text: string; streaming: boolean; seconds?: number })
  | (Base & {
      kind: "tool";
      /** The provider's tool name, in mono: Bash, Edit, mcp__github__create_pr. */
      tool: string;
      toolKind: ToolKind;
      /** What it is doing, in words: "Run npm test", "Edit src/app.ts". */
      title: string;
      input?: string;
      output?: string;
      status: "running" | "done" | "failed";
      seconds?: number;
      path?: string;
    })
  | (Base & { kind: "plan"; entries: PlanEntry[] })
  /** A page the agent showed you: a chart, a table, a mockup. It runs sandboxed, in the app's colours. */
  | (Base & { kind: "page"; title: string; html: string })
  /**
    One version of a design an agent showed in the Design surface: a screen, a page, a prototype.
    `design` is the design's id, the same for all its versions; `path` its HTML file in the
    session's folder. The version itself is kept by the engine (engine/src/designs.ts).
  */
  | (Base & { kind: "design"; design: string; title: string; path: string; version: number; size: DesignSize; note?: string })
  /** You asked for a pull request in the chat: Liner's PR card opens it there. `demo` plays the story on the sample project. */
  | (Base & { kind: "pr"; demo?: boolean })
  | (Base & {
      kind: "approval";
      tool: string;
      title: string;
      description?: string;
      risk: Risk;
      fields: { label: string; value: string }[];
      state: "asking" | "approved" | "denied" | "expired";
      reason?: string;
      /** What "Don't ask again" would allow for the rest of the session, like "pnpm test". */
      rule?: string;
      /** The tool call it was for: once answered, it folds into that call's row. */
      toolId?: string;
      /** The Reviewer's model, when it decided instead of you (Reviewer decides). */
      reviewer?: string;
      /** An add-on to add (addon_install): the install card, then its receipt. */
      addon?: AddonAsk;
    })
  /**
    An agent's offer, at the end of its turn, to make something as an app in Liner Code (DeepSeek
    Harness's creation card): what it would be, where it would go, what it would touch. Create makes
    it in a background session (`child`) and adds it as `addon`; Undo removes it and Restore brings
    it back. A newer offer in the session replaces one not yet started.
  */
  | (Base & {
      kind: "offer";
      name: string;
      brief: string;
      place: PanelPlace;
      access: PanelAccess;
      /** What it starts with, in the person's own items. */
      seed?: string[];
      state: OfferState;
      /** Write your own: where the person wants it, in their words. */
      custom?: string;
      child?: string;
      addon?: string;
      version?: number;
      /** Why it didn't make it, said to the person. */
      error?: string;
    })
  | (Base & { kind: "question"; questions: Question[]; state: "asking" | "answered" | "skipped" | "expired"; answers?: Record<string, string> })
  /** A plan to approve. `auto`: one nobody asked to see, for a hard job, handed straight on to be built. */
  | (Base & { kind: "proposal"; title: string; plan: string; state: "asking" | "approved" | "changed" | "expired"; note?: string; auto?: boolean })
  | (Base & {
      kind: "checkpoint";
      files: FileChange[];
      /** The snapshots before and after the turn (git commits under refs/liner/). */
      from?: string;
      to?: string;
      reverted?: boolean;
      /** The commit these changes went into, once you committed them. */
      committed?: string;
      /** Files from this turn already committed with only some others: `files` keeps the rest, so they're what's left to commit or undo. */
      done?: FileChange[];
      /** Once undone: a snapshot (under refs/liner/) of the files as they were just before, so the undo can be taken back. */
      redo?: string;
      seconds?: number;
    })
  | (Base & { kind: "error"; message: string })
  /** `fallback`: another ready tool's model that can carry on (another account of the same tool first). */
  | (Base & { kind: "limit"; message: string; until?: number; provider: string; fallback?: string })
  | (Base & { kind: "notice"; text: string });

export type ItemKind = Item["kind"];
/** The PR card's own tool: its run of the project's tests on this Mac, and the request to run them. */
export const PR_TEST_TOOL = "liner.test";
export type PrTestResult = { state: "passed" | "failed" | "skipped"; command?: string; summary: string; seconds?: number };
export type Finding = { file: string; line?: number; endLine?: number; severity: "blocking" | "note"; note: string };

/** One file's before and after, for the diff card. */
export type FileDiff = { path: string; before?: string; after?: string; from?: string };

export type Settings = {
  /** You've been through the first run. */
  onboarded: boolean;
  /** How new sessions work: Solo, Plan then build, or Auto. Each session can change it. */
  mode: Mode;
  /** Your frontier and cheaper models (automatic while unset), and Dual frontier, for new sessions. */
  picks?: ModelPicks;
  dual?: boolean;
  /** What happens to each change before it's yours (Check unless set). */
  after?: After;
  /**
    Plan, then build: hold each plan for your OK before it's built. Off, the planner plans only the
    hard jobs and hands the plan straight on; a message that asks for a plan still waits for you.
  */
  approvePlans?: boolean;
  /** How many times the Reviewer sends blocking findings back before it's yours (default 2). */
  reviewRounds?: number;
  /** The Reviewer reads small changes too (SMALL_CHANGE lines or fewer, or only docs), which it otherwise lets through. */
  reviewSmall?: boolean;
  /** Agents outside Liner Code (Claude Code or Codex in a terminal) may list, read, start and message sessions, through its MCP server. */
  outside?: boolean;
  /** When a tool runs out of usage mid-session: wait for it to reset (the default), or carry on with another ready tool. */
  onLimit?: "wait" | "carry";
  /** A session out of usage carries on by itself when its window reopens, if the tool said when (off unless turned on). */
  resumeAtReset?: boolean;
  /** A session Liner Code stopped mid-turn (it quit or crashed) carries on by itself when it starts again (on unless turned off). */
  continueAfterRestart?: boolean;
  /** Auto: the level new sessions start at (high unless set). */
  route?: { level?: RouteLevel };
  /** Claude Code bills to your Claude plan, or to the Anthropic key you added. */
  claudeBilling: "plan" | "key";
  /** Settle sessions that wait on nothing from you after this many days (0: never, the default). */
  settleDays: number;
  /** Where to start from when you add a project. */
  projectsRoot?: string;
  /** Notify when a thread needs you or finishes while the app is in the background. */
  notify: boolean;
  /** Even in Full access, commands that can't be undone come back to you. */
  guardDestructive: boolean;
  /** What a new session may do without asking, until you change it in the session. */
  defaultAccess: Access;
  /** New sessions in a Git project start in a worktree of their own instead of this checkout. */
  worktrees: boolean;
  /** What a new worktree's branch starts with, before the session's id. */
  branchPrefix: string;
  /** The Dock icon counts the sessions that need you. */
  badge: boolean;
  /** A monthly budget in dollars, for the Usage page's pace line (0: none). */
  budgetUsd?: number;
  /** What one session, or one routine run, may spend before it stops and asks, in dollars (0: no cap). Only tools that report cost (Claude Code) can be held to it. */
  capUsd?: number;
  /** Keeps the Mac from sleeping while an agent works (on unless turned off). */
  keepAwake?: boolean;
  /** The menu bar item: what works and what needs you (on unless turned off). */
  menuBar?: boolean;
  /** Settle a session when its pull request merges, or when a routine run handled everything itself. Off unless you turn them on. */
  settleOnMerge?: boolean;
  settleOnRoutine?: boolean;
  /** 2 once settling became yours to do: the old defaults that settled sessions by themselves were switched off once. */
  settleVersion?: number;
  /** 2 once permissions came down to Auto, Manual, Reviewer decides and Full access (`fourLevels`). */
  accessVersion?: number;
  /** Where new worktrees go (default: the Liner Code home's worktrees folder). */
  worktreeRoot?: string;
  /** Keep each project's default-branch checkout pulled (fast-forward only, when it's clean). */
  autoPull?: boolean;
  /** Models you starred, as "<provider>:<model>", first in every model picker. */
  favoriteModels?: string[];
  /** More accounts of a tool, each its own entry in the model picker. */
  accounts?: ToolAccount[];
  /** ACP agents you added. */
  addedAgents?: AddedAgent[];
  /** Model ids you added to a tool's list. */
  customModels?: CustomModel[];
  /** API endpoints you added, each run through the tool that speaks its protocol. */
  endpoints?: Endpoint[];
  /** A voucher was redeemed: its model (VOUCHER) is in the picker. */
  voucher?: boolean;
  /** Your shortcuts, the way VS Code writes keybindings.json: keys for a command in place of its own, "-command" to take its keys away. */
  keybindings?: KeyBinding[];
  /** Liner Code's own releases: downloaded and put in when you quit or restart ("auto", the default), only told about, or not looked for. */
  updateApp?: UpdateMode;
  /** The agent tools' own updaters: run when no session is working on that tool, only told about ("notify", the default), or not looked for. */
  updateTools?: UpdateMode;
  /** The Demo (Demo run, its model, the sample project): hidden until you tap your name in the sidebar six times. */
  showDemo?: boolean;
  /** Agents may offer add-ons, each on a card for your OK ("ask", the default), or never. A read-only session never can. */
  addonOffers?: "ask" | "never";
  /** Panels that reach the internet may ask, held like a push ("ask", the default), or never. */
  addonNetwork?: "ask" | "never";
  /** The mode a new session starts in, unless you pick another (Settings › Modes): Standard when unset. */
  defaultMode?: SessionMode;
};

export type UpdateMode = "auto" | "notify" | "off";

/**
  A project's rules for agents, at its root: CLAUDE.md for Claude Code, AGENTS.md for Codex,
  OpenCode, Cursor and the rest. `linked`: CLAUDE.md only imports AGENTS.md (`@AGENTS.md`), so
  the two say the same.
*/
export type ProjectRules = { claude?: string; agents?: string; linked: boolean };

/** A past Claude Code or Codex session in a project's folder, that can be brought in to carry on here. */
export type ImportableSession = { tool: "claude" | "codex"; id: string; title: string; at: number };

/** One row of what fills a session's context, as its tool counts it. "deferred" rows sit outside the window. */
export type ContextPart = { name: string; tokens: number; kind: "used" | "free" | "buffer" | "deferred" };

/**
  One thing in a session's context, by what it is: the tool's own setup (its prompt and tools),
  your project's (memory files, skills, agents), the conversation, and what its steps brought in
  (files, commands, the web, other tools). detail says more, for a tooltip.
*/
export type ContextSource = { name: string; tokens: number; group: "setup" | "project" | "talk" | "files" | "runs" | "web" | "tools"; detail?: string };

/** What fills a session's context, as its tool counts it: the parts it lists, and where it compacts. */
export type ContextUse = {
  used: number;
  max: number;
  parts: ContextPart[];
  /** What's in it, source by source, when the tool says (Claude Code). */
  sources?: ContextSource[];
  /** Where the tool compacts older turns by itself, and whether it does. */
  compactAt?: number;
  autoCompact?: boolean;
  /** Tool descriptions kept out of the window until they're used. */
  deferred?: number;
};

/** What the Session surface shows from the engine: where a session runs, and what fills its context. */
export type SessionInfo = {
  machine: string;
  project: string;
  /** The folder the agent works in: the project, or the session's worktree. */
  path: string;
  worktree: boolean;
  branch?: string;
  /** The tool (its name and id) and the model the writer runs on. */
  tool: string;
  provider: ProviderId;
  model: string;
  access: Access;
  /** A session is open in the tool, so the context is what it says now. */
  live: boolean;
  /** From the tool now, by part (`measured`), or the last turn's total. None before the first turn. */
  context?: ContextUse & { measured: boolean };
  /** The tool compacts on request: the Compact button sends it `/compact`. */
  compact: boolean;
};

/** A change this many lines or under (added and removed together) is small: the Reviewer lets it through unless `reviewSmall`. */
export const SMALL_CHANGE = 6;

/** A change the Reviewer lets through: a few lines, or only docs. From `git diff --numstat` ("3\t1\tsrc/a.ts" a line; "-" for a binary). */
export function smallChange(numstat: string) {
  const files = numstat.split("\n").filter(Boolean).map((l) => l.split("\t"));
  if (!files.length) return true;
  const docs = files.every((f) => /\.(md|mdx|txt|rst|adoc)$/i.test(f[2] ?? "") || /^docs\//.test(f[2] ?? ""));
  const lines = files.reduce((n, f) => n + (f[0] === "-" ? Infinity : Number(f[0]) + Number(f[1])), 0);
  return docs || lines <= SMALL_CHANGE;
}

/** The update settings as they stand. Liner Code updates itself; the tools are yours, so it only says when one has something new until you choose Automatically. */
export const updateModes = (s: Pick<Settings, "updateApp" | "updateTools">): { app: UpdateMode; tools: UpdateMode } => ({ app: s.updateApp ?? "auto", tools: s.updateTools ?? "notify" });

/** Liner Code against its latest release on GitHub. */
export type AppUpdate = {
  current: string;
  /** "owner/name", where releases come from. None: this copy has no release feed. */
  repo?: string;
  latest?: string;
  /** The release's notes (Markdown) and its page. */
  notes?: string;
  url?: string;
  publishedAt?: number;
  state: "idle" | "current" | "available" | "downloading" | "ready" | "failed";
  /** 0–1 while it downloads, and the download's size in bytes. */
  progress?: number;
  size?: number;
  /**
    Whether this copy can put a new one in its own place: "install"; "source" runs from the repo
    (pull and build instead); "readonly" sits in a folder you can't write to; "translocated" runs
    from where macOS put a downloaded app that wasn't moved to Applications.
  */
  can: "install" | "source" | "readonly" | "translocated";
  error?: string;
  /** "failed" because this version downloaded but couldn't take this copy's place: it comes from the release page, by hand. */
  stuck?: boolean;
};

/** One agent tool: what's here, what's out, and how its update is going. */
export type ToolUpdate = {
  id: BuiltinProvider;
  label: string;
  current?: string;
  latest?: string;
  /** The tool's own updater, as Liner Code runs it ("claude update"). */
  command: string;
  /** waiting: asked for, until the sessions working on it finish (`busy` of them). */
  state: "current" | "available" | "waiting" | "updating" | "updated" | "failed";
  busy?: number;
  /** After an update: the version it came from. */
  from?: string;
  error?: string;
  at?: number;
  /** While updating: how far, 0 to 1, when the updater says (a percentage, or "12 MB / 40 MB"). */
  progress?: number;
  /** While updating: the last line the updater printed, like "Downloading 2.1.312". */
  step?: string;
};

export type Updates = {
  checkedAt?: number;
  checking: boolean;
  app: AppUpdate;
  tools: ToolUpdate[];
  /** What you put away, by "app" or tool id: the version, so a newer one shows again. */
  dismissed: Record<string, string>;
};

/** "mod+shift+b" for "surface.browser"; `when` narrows where it works ("session", "composer && !review"). */
export type KeyBinding = { key: string; command: string; when?: string };

/** A project's command with a run button; `key` runs it from the keyboard in a session ("mod+shift+1"). */
export type ProjectScript = { id: string; name: string; command: string; onWorktree?: boolean; key?: string };
export type SidebarGroup = { id: string; name: string };

/* Routines: work that runs on its own. Models read and report; code in the engine decides. */
export type Trigger =
  | { kind: "schedule"; every: "hour" | "day" | "weekday" | "week"; at?: string; day?: number }
  | { kind: "github"; event: "pr.opened" | "issue.opened"; outside?: boolean }
  | { kind: "webhook"; secret: string }
  | { kind: "manual" };
export type GateRule = { kind: "checks" } | { kind: "reviewer" } | { kind: "maxLines"; n: number } | { kind: "paths"; deny: string[] } | { kind: "knownAuthor" };
export type RoutineStep =
  | { kind: "ai"; role: "read" | "work" | "audit"; agent: string; prompt: string }
  | { kind: "gate"; rules: GateRule[] }
  | { kind: "action"; action: "merge" | "comment" | "label" | "close" | "inbox" | "notify"; arg?: string; when: "pass" | "fail" | "always" };
export type Routine = {
  id: string;
  name: string;
  on: boolean;
  projectId: string;
  trigger: Trigger;
  steps: RoutineStep[];
  /** Each run starts its own session, or adds a turn to one session. */
  runsGo: "own" | "one";
  threadId?: string;
  /** Pause after this many failures in a row (0: never). */
  pauseAfter: number;
  /** Most merges a day, and most tokens a run. */
  limits: { mergesPerDay: number; tokensPerRun: number };
  failures: number;
  lastRun?: number;
  nextRun?: number;
  createdAt: number;
};
export type RunStep = { label: string; detail?: string; model?: string; status: "running" | "done" | "failed" | "skipped"; seconds?: number; at: number };
export type RoutineRun = {
  id: string;
  routineId: string;
  at: number;
  /** What started it, in words: "Oskar opened #140", "Mondays at 9:00". */
  cause: string;
  status: "running" | "merged" | "handed" | "done" | "failed";
  outcome?: string;
  steps: RunStep[];
  threadId?: string;
  /** The pull request or issue it was about. */
  subject?: { kind: "pr" | "issue"; number: number; title: string; author?: string; url?: string };
  rules?: { label: string; ok: boolean; detail?: string }[];
  seconds?: number;
  tokens?: number;
  /** A test: it reads, audits and checks the gate, then says what it would have done. */
  test?: boolean;
};

/* Surfaces beside a session. */
export type PrInfo = {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  head: string;
  base: string;
  additions: number;
  deletions: number;
  author?: string;
  mergeable?: string;
  reviewDecision?: string;
  commits: { sha: string; title: string }[];
  checks: { name: string; state: "pass" | "fail" | "pending" | "skipped"; detail?: string }[];
  reviews: { author: string; state: string; at?: string }[];
  requested: string[];
  threadId?: string;
};
/** What a pull request card draws: your commits over the base, what reached the base since, and where they clash. */
export type PrPicture = {
  branch: string;
  base: string;
  ahead: number;
  behind: number;
  branchCommits: { sha: string; title: string }[];
  baseCommits: { sha: string; title: string; who: string; when: string }[];
  /** One pair of lines per clash: the base's and yours, numbered in your file. */
  conflicts: { id: string; file: string; line: number; base: string; yours: string }[];
  diff: { add: number; del: number };
};
export type Device = { udid: string; name: string; runtime: string; state: string };

export type UsageRecord = { at: number; threadId: string; projectId: string; agent: string; provider: ProviderId; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number; seconds: number };
export type UsageSummary = {
  from: number;
  to: number;
  totals: { costUsd: number; tokens: number; turns: number; cacheShare: number; perTurn: number; priciest?: { costUsd: number; title: string } };
  days: { day: string; costUsd: number; tokens: number; turns: number }[];
  byAgent: { agent: string; costUsd: number; tokens: number; turns: number }[];
  byModel: { model: string; provider: ProviderId; tokens: number; cacheShare: number; costUsd: number }[];
};
/**
  How each mode went in your own sessions, sorted by how each session ran: Solo, Plan then build,
  or Auto. A changed turn is kept when you didn't undo it.
*/
export type WayStats = { way: Mode; sessions: number; turns: number; changed: number; kept: number; costUsd: number; seconds: number; reviewed: number; firstPass: number };

/** A slash command the tool (or Liner Code) understands, and a skill it can use. */
export type CommandInfo = { name: string; description: string; hint?: string; source: "tool" | "liner" };
export type SkillInfo = { name: string; description: string; path?: string };
/** One commit as a list shows it: its short sha, its subject, when, and its added and removed lines. */
export type GitCommit = { sha: string; subject: string; at: number; added?: number; removed?: number };
/** One of a plan's usage windows: which it is (the 5-hour one, the week, the month), how long it runs, how much is used. */
export type LimitWindow = { label: string; usedPercent: number; resetsAt?: number; kind?: "session" | "weekly" | "monthly"; minutes?: number };
/**
  A tool's plan windows, as the tool (or the API behind it) reports them. `models`: the windows
  count only for its models whose id starts so ("opencode-go": OpenCode Go's, not OpenCode Zen's).
*/
export type ToolLimits = { provider: ProviderId; label: string; plan?: string; windows: LimitWindow[]; detail?: string; at: number; models?: string };
export type FoundRepo = { path: string; name: string; branch?: string; lastCommitAt?: number; added: boolean; remote?: string };
/** A repository on GitHub you can reach, and the project it already is here, if any. */
export type GitHubRepo = { fullName: string; description?: string; private: boolean; url: string; pushedAt?: number; projectId?: string };

export type Snapshot = {
  version: string;
  /** The number of the last event the engine sent when this was taken (EngineEvent's `seq`). */
  seq?: number;
  /** Which API keys are set (by provider), never the keys themselves. */
  keys: string[];
  home: string;
  projects: Project[];
  threads: Thread[];
  agents: AgentProfile[];
  providers: ProviderInfo[];
  settings: Settings;
  groups: SidebarGroup[];
  routines: Routine[];
  runs: RoutineRun[];
  updates: Updates;
  /** Each tool's plan windows, as last asked. */
  limits?: ToolLimits[];
  /** Your add-ons, and whether this run started without them (Settings › Add-ons, Start without add-ons). */
  addons?: AddonInfo[];
  addonsOff?: boolean;
};

/** Engine → app, over the event stream. */
export type EngineEvent =
  | { type: "hello"; snapshot: Snapshot }
  | { type: "project"; project: Project }
  | { type: "project.removed"; id: string }
  | { type: "thread"; thread: Thread }
  | { type: "item"; threadId: string; item: Item }
  | { type: "delta"; threadId: string; itemId: string; text: string }
  /** A thread's whole timeline, after a rewind took turns off it. */
  | { type: "timeline"; threadId: string; items: Item[] }
  | { type: "agents"; agents: AgentProfile[] }
  | { type: "providers"; providers: ProviderInfo[] }
  | { type: "settings"; settings: Settings }
  | { type: "notify"; threadId: string; title: string; body: string; kind: "waiting" | "done" | "error" }
  | { type: "keys"; keys: string[] }
  | { type: "groups"; groups: SidebarGroup[] }
  | { type: "routine"; routine: Routine }
  | { type: "routine.removed"; id: string }
  | { type: "run"; run: RoutineRun }
  /** `at`: how many characters the terminal had printed before this, so a Terminal that attached can skip what its backlog already held. */
  | { type: "term"; id: string; data: string; at?: number }
  | { type: "term.exit"; id: string; code: number }
  | { type: "devlog"; udid: string; lines: string[] }
  | { type: "settled"; threadId: string; reason: string }
  | { type: "updates"; updates: Updates }
  /** Every tool's plan windows, after one was asked again (a turn on it ended, you pressed Look again). */
  | { type: "limits"; tools: ToolLimits[] }
  /** An agent uses the session's Browser; the app answers with agent.browser.reply. */
  | { type: "agent.browser"; id: string; threadId: string; op: AgentBrowserOp; args: Record<string, unknown> }
  /** A design's file changed on disk (the agent is editing it): a Design surface showing it draws it again. */
  | { type: "design.changed"; threadId: string; design: string; at: number }
  /** An add-on was added, switched, moved to another version, removed or restored. */
  | { type: "addons"; addons: AddonInfo[]; off: boolean };

/** `shot` isn't the Browser's: the app draws a page of this Mac out of sight and answers with its picture (a design's, for its agent). */
export type AgentBrowserOp = "open" | "read" | "click" | "type" | "press" | "screenshot" | "shot";

/** A terminal of a session's Terminal surface; `exited` once its shell has ended (it stays until its tab is closed). */
export type TermInfo = { id: string; title: string; cwd: string; at: number; command?: string; exited?: number };

/** A server listening on this Mac, as the Browser sees it. */
export type LocalServer = { port: number; process: string; url: string; owner: "session" | "project" | null; web: boolean };

/** App → engine. Each method's params and result. */
export type Rpc = {
  "state.get": [Record<string, never>, Snapshot];
  "providers.refresh": [Record<string, never>, ProviderInfo[]];
  /** The ACP registry's agents (kept for a day), marked with what's runnable here and what you added. */
  "acp.registry": [{ force?: boolean }, { agents: RegistryAgent[]; at: number; error?: string }];
  /** Adds an agent from the registry (a binary one is downloaded and checked first), or a command of your own. */
  "acp.add": [{ registryId: string } | { label: string; command: string }, AddedAgent];
  "acp.remove": [{ id: string }, Settings];
  /** The app's answer to an agent.browser event. */
  "agent.browser.reply": [{ id: string; ok: boolean; value?: unknown; error?: string }, null];
  "project.add": [{ path: string; agent?: string }, Project];
  "project.update": [{ id: string; name?: string; agent?: string; setup?: string; scripts?: ProjectScript[] }, Project];
  /** The project's branches and worktrees, for starting a session from one. */
  "git.branches": [{ projectId: string }, { current?: string; base?: string; branches: { name: string; lastCommitAt?: number }[]; worktrees: { path: string; branch?: string; threadId?: string }[]; npmScripts: string[] }];
  /** Removes worktrees whose sessions are archived or gone. */
  "worktrees.clean": [{ projectId?: string }, { removed: number; kept: number; reasons?: { path: string; reason: string }[] }];
  "project.remove": [{ id: string }, null];
  "thread.create": [{ projectId: string; agent?: string; lead?: string; route?: RouteLevel; dual?: boolean; after?: After; title?: string; forkOf?: string; id?: string; access?: Access; effort?: Effort; model?: string; worktree?: boolean; base?: string; inWorktree?: string; mode?: SessionMode }, Thread];
  "thread.update": [{ id: string; title?: string; archived?: boolean; access?: Access; model?: string; effort?: Effort; agent?: string; lead?: string | null; pinned?: boolean; snoozedUntil?: number | null; done?: boolean; unread?: boolean; route?: RouteLevel | null; dual?: boolean; after?: After | null; group?: string | null; wake?: { kind: "checks" | "reply"; pr: number } | null }, Thread];
  "thread.items": [{ id: string }, Item[]];
  /**
    A thread's timeline, with the number of the last event sent when it was read: events for it with
    a higher number came after it (T3 Code: client-runtime state/threads.ts, snapshotSequence).
  */
  "thread.load": [{ id: string }, { items: Item[]; seq: number }];
  /** Agents outside Liner Code: whether they may in, and the commands that add its MCP server to Claude Code and Codex. */
  "outside.info": [Record<string, never>, { on: boolean; claude: string; codex: string }];
  /** What agents remember about a project (memory_add), oldest first; add, and forget by place. */
  "memory.list": [{ projectId: string }, string[]];
  "memory.add": [{ projectId: string; fact: string }, string[]];
  "memory.forget": [{ projectId: string; index: number }, string[]];
  /** A project's earlier sessions, searched: your messages and the agents' answers. */
  "sessions.search": [{ projectId: string; query: string }, { threadId: string; title: string; at: number; who: "you" | "agent"; snippet: string }[]];
  /** A limited session carries on with another tool's model (`model`, else the one its limit card offers). */
  "thread.carryOn": [{ id: string; model?: string }, null];
  "thread.send": [{ id: string; text: string; files?: { name: string; data: string }[]; mode?: "queue" | "steer"; anchor?: { file: string; line: number; endLine?: number } }, null];
  "thread.queue": [{ id: string; queue: QueuedMessage[] }, Thread];
  /** Rewinds to just before a message you sent: the turns from there come off, and with `files`, so do their changes. */
  "thread.rewind": [{ threadId: string; itemId: string; files: boolean; force?: boolean }, { turn: number; files: number }];
  /** `kept`: why the session's worktree stayed (another session works there, or it holds changes), to say so. */
  "thread.remove": [{ id: string }, { kept?: string } | null];
  /** The session's side chat, started now if it has none; `fresh` starts it again from where the session is. */
  "thread.side": [{ id: string; fresh?: boolean }, Thread];
  "thread.stop": [{ id: string }, null];
  /** `scope`, for an add-on's install card: every project, or only the session's. */
  "approval.answer": [{ threadId: string; itemId: string; allow: boolean; reason?: string; always?: boolean; scope?: "all" | "project" }, null];
  /** Switches an add-on on or off, moves it to a kept version, removes it (it stays on disk) or restores it. */
  "addons.update": [{ id: string; enabled?: boolean; version?: number; removed?: boolean; project?: string | null }, AddonInfo[]];
  /** A connection you add by hand: its manifest, checked as an agent's would be. Its keys go to the keychain first, as on the card. */
  "addons.add": [{ manifest: string; project?: string }, AddonInfo[]];
  /** A panel's files to draw: one in use (or a kept `version`), or the draft on a card that's up (`threadId`, `itemId`), for its preview. */
  "addons.files": [{ id: string; version?: number } | { threadId: string; itemId: string }, { id: string; name: string; place: PanelPlace; entry: string; access: PanelAccess; files: Record<string, string>; version?: number }];
  /**
    A panel's bridge call, passed on by the window for the frame that made it: the panel by id, the
    session it's beside (none on a page), or the card it's a preview on. The engine answers only
    what that panel's access allows.
  */
  "panel.call": [{ addon: string; threadId?: string; preview?: string; method: string; args?: unknown; apiVersion?: number }, unknown];
  /**
    An answer on a "Make it an app" card: Create (where to add it, or in your own words), Not now,
    Cancel while it's being made, and once added Keep, Undo (it's removed, its files kept) or Restore.
  */
  "offer.answer": [{ threadId: string; itemId: string; act: "create" | "dismiss" | "cancel" | "keep" | "undo" | "restore"; place?: PanelPlace; custom?: string }, null];
  /** An add-on's manifest as kept (the version in use unless `version`), and its folder. */
  "addons.read": [{ id: string; version?: number }, { manifest: string; dir: string }];
  /**
    Start without add-ons: none from now on. With `next` (the app is about to open again) the next
    start has none either, and the one after brings them back; without, they're back at the next start.
  */
  "addons.off": [{ next?: boolean }, null];
  "question.answer": [{ threadId: string; itemId: string; answers?: Record<string, string> }, null];
  "proposal.answer": [{ threadId: string; itemId: string; approve: boolean; note?: string; plan?: string }, null];
  "review.run": [{ threadId: string }, null];
  "checkpoint.diff": [{ threadId: string; itemId: string }, FileDiff[]];
  /** Undoes a turn's changes. Refused when a file it changed was changed again after it, unless `force`. */
  "checkpoint.revert": [{ threadId: string; itemId: string; force?: boolean }, Item];
  /** Commits the session's open changes, or only `paths` of them. */
  "git.commit": [{ threadId: string; message?: string; paths?: string[] }, { sha: string; files: number }];
  /** Pushes the session's branch to origin, setting its upstream. */
  "git.push": [{ threadId: string }, { branch: string; remote: string }];
  /**
    What a push would send: the commits its remote hasn't got (before the first push, all since the
    base), newest first; the commit the branch left the base at (main, master, or the remote's
    HEAD); and how many commits ahead of the base it is.
  */
  "git.outgoing": [{ threadId: string }, { branch: string; remote: string | null; commits: GitCommit[]; base?: GitCommit & { branch: string }; ahead: number }];
  /** Switches the session's checkout to a branch, or to a new one made from where it is. */
  "git.switch": [{ threadId: string; branch: string; create?: boolean }, { branch: string }];
  /** The editors and terminals on this Mac that can open a folder, by bundle id. */
  "apps.editors": [Record<string, never>, { id: string; name: string; kind: "editor" | "terminal" }[]];
  /** What Liner Code needs from the Mac itself: Git (snapshots, undo, worktrees) and Python (the Terminal's pty). */
  "system.check": [Record<string, never>, SystemCheck];
  /** Opens a folder in one of them. */
  "apps.open": [{ path: string; app: string }, null];
  /** Pictures for behind the session: the landscapes this Mac keeps, and whether you've added one of your own. */
  "background.list": [Record<string, never>, { pictures: { id: string; name: string }[]; own: boolean }];
  /** One picture as a JPEG (base64), by id: "apple:<name>" or "own"; `dark` picks a dynamic wallpaper's night side. */
  "background.image": [{ id: string; dark?: boolean }, { data: string; type: string } | null];
  /** Keeps an image of your own (base64), made a JPEG. */
  "background.save": [{ data: string; name: string }, null];
  "background.remove": [Record<string, never>, null];
  /** A commit message written from the changes still to commit and what you asked for. */
  "git.message": [{ threadId: string }, { message: string; by: string }];
  /** A pull request title and description, from the branch's changes and the session. */
  "pr.draft": [{ threadId: string }, { title: string; body: string; by: string }];
  /** A question about a session's case on the Desk, answered by a quick model from the session and the case (`context`); the session itself carries on undisturbed. */
  "desk.ask": [{ threadId: string; question: string; context: string }, { answer: string; by: string }];
  /** The Session surface: where a session runs, and what fills its context. */
  "thread.info": [{ id: string }, SessionInfo];
  /** The session as Markdown (asks, plans, answers, findings, diffs), saved in Downloads; where it went. */
  "thread.export": [{ id: string }, { path: string }];
  /** Past Claude Code and Codex sessions in the project's folder, newest first. */
  "sessions.importable": [{ projectId: string }, ImportableSession[]];
  /** Brings one in as a session here: its timeline, and its own id, so the next turn carries it on. */
  "sessions.import": [{ projectId: string; tool: "claude" | "codex"; id: string }, Thread];
  /** A project's rules for agents, as its CLAUDE.md and AGENTS.md say them. */
  "project.rules": [{ id: string }, ProjectRules];
  /** Writes the rules to AGENTS.md and makes CLAUDE.md point to it, so every tool reads the same. */
  "project.rules.save": [{ id: string; text: string }, ProjectRules];
  "projects.scan": [{ roots?: string[] }, FoundRepo[]];
  "project.clone": [{ url: string; into?: string }, Project];
  "github.repos": [Record<string, never>, { gh: "ready" | "missing" | "signed-out"; detail?: string; login?: string; repos: GitHubRepo[] }];
  "usage.summary": [{ days?: number; projectId?: string }, UsageSummary];
  "ways.compare": [{ days?: number }, WayStats[]];
  /** Each signed-in plan's windows: how much is used and when it resets. */
  "usage.limits": [{ fresh?: boolean }, { tools: ToolLimits[] }];
  /** What `/` and `$` offer in the composer, for the tool an agent runs on in a project. */
  "agent.commands": [{ projectId: string; agent: string; threadId?: string }, { commands: CommandInfo[]; skills: SkillInfo[] }];
  /** The skill.md files an agent can be given: yours (Claude Code's and Codex's skills folders) and, with a project, its own. */
  "skills.list": [{ projectId?: string }, { yours: SkillInfo[]; project: SkillInfo[] }];
  "keys.set": [{ provider: string; key: string | null }, string[]];
  /** Checks a voucher with Liner Code's site and, when it's good, turns its model on (VOUCHER); the code is kept as its key. Off with { code: null }. */
  "voucher.redeem": [{ code: string | null }, Settings];
  "machine.info": [Record<string, never>, { name: string; user: string; home: string }];
  "agents.save": [{ agents: AgentProfile[] }, AgentProfile[]];
  "settings.save": [Partial<Settings>, Settings];
  "fs.files": [{ projectId: string; query?: string; limit?: number }, { path: string; size: number }[]];
  "fs.tree": [{ projectId: string; threadId?: string }, TreeEntry[]];
  "fs.read": [{ threadId: string; path: string }, { text: string; size: number; binary: boolean }];
  /** A file's bytes (base64) for the Files preview, an image say: up to 10 MB, only inside the session's folder. */
  "files.raw": [{ threadId: string; path: string }, { data: string; mime: string; size: number }];
  /** A file you attached to a message (base64), for its thumbnail: only from the engine's attachments folder. */
  "attachment.read": [{ path: string }, { data: string; mime: string; size: number }];
  "groups.save": [{ groups: SidebarGroup[] }, SidebarGroup[]];
  "compare.start": [{ projectId: string; text: string; files?: { name: string; data: string }[]; models: string[]; effort?: Effort; access?: Access }, Thread[]];
  "compare.keep": [{ threadId: string }, { files: number }];
  "project.scratch": [Record<string, never>, Project];
  "term.open": [{ threadId: string; cols: number; rows: number; command?: string; title?: string }, { id: string; cwd: string }];
  /** A terminal's backlog (`end`: characters printed so far); its live output follows as `term` events. */
  "term.attach": [{ id: string }, { text: string; end: number; cwd: string; exited?: number }];
  /** A session's terminals, which outlive its Terminal surface: the tabs it shows when it comes back. */
  "term.list": [{ threadId: string }, TermInfo[]];
  "term.write": [{ id: string; data: string }, null];
  "term.resize": [{ id: string; cols: number; rows: number }, null];
  /** Forgets a terminal's backlog, so Clear stays cleared when its Terminal comes back. */
  "term.clear": [{ id: string }, null];
  "term.close": [{ id: string }, null];
  "pr.status": [{ threadId: string }, { pr: PrInfo | null; branch?: string; ahead?: number; gh: "ready" | "missing" | "signed-out" | "no-remote"; detail?: string }];
  "pr.create": [{ threadId: string; title: string; body: string; draft: boolean }, PrInfo];
  "pr.list": [{ projectId: string }, { prs: PrInfo[]; gh: "ready" | "missing" | "signed-out" | "no-remote"; detail?: string }];
  "pr.merge": [{ projectId: string; number: number }, null];
  /** The branch against its base, fetched at most once a minute, for the pull request card. */
  "pr.picture": [{ threadId: string }, PrPicture];
  /** Runs the project's tests on this Mac for the PR card `itemId`, asking first as the session's access says. */
  "pr.test": [{ threadId: string; itemId: string }, PrTestResult];
  /**
    The servers listening on this Mac. With a session: whose each is (`session`: its agent or its
    Terminal started it; `project`: it runs in the session's folder), the session's first, and
    which answer with a page (`web`).
  */
  "ports.list": [{ threadId?: string }, LocalServer[]];
  /** Stops a dev server of the session's (never another app's); answers with the ports it stopped. */
  "ports.stop": [{ threadId: string; port: number }, number[]];
  /** A proxy onto a local port, for the Browser surface: the page reports its console and answers picks. */
  "browser.proxy": [{ port: number }, { url: string }];
  /** The session folder's own files, served for the Browser (no dev server needed): `path` as asked, in the folder, and its HTML pages. */
  "browser.files": [{ threadId: string; path?: string }, { url: string; path: string; pages: string[] }];
  /** The models an API endpoint lists (its /models), to pick from when you add it. */
  "endpoint.models": [{ url: string; protocol: EndpointProtocol; key?: string }, string[]];
  /** A session's designs, newest first. */
  "design.list": [{ threadId: string }, DesignInfo[]];
  /** A design's HTML: a kept version, or (no version) its file as it is now, with where it's served for the Design surface. */
  "design.read": [{ threadId: string; design: string; version?: number }, { html: string; path: string; version: number; url: string }];
  /** A page or HTML of yours as a design (a new version of `design`, when given). */
  "design.save": [{ threadId: string; title: string; html: string; design?: string; size?: DesignSize }, Item];
  /** Puts a kept version back in the design's file, as a new version. */
  "design.restore": [{ threadId: string; design: string; version: number }, Item];
  /** You asked the agent to build this version: remembered, so the surface can say when the design moved on since. */
  "design.built": [{ threadId: string; design: string; version: number }, DesignInfo[]];
  /** While a Design surface is open: tell it when a design's file changes. */
  "design.watch": [{ threadId: string; on: boolean }, null];
  "device.list": [Record<string, never>, { devices: Device[]; ready: boolean; detail?: string }];
  "device.boot": [{ udid: string }, null];
  "device.shot": [{ udid: string }, { png: string }];
  "device.appearance": [{ udid: string; mode: "light" | "dark" }, null];
  "device.log": [{ udid: string; filter?: string; on: boolean }, null];
  "routine.save": [{ routine: Omit<Routine, "id" | "createdAt" | "failures"> & { id?: string } }, Routine];
  "routine.remove": [{ id: string }, null];
  "routine.run": [{ id: string }, RoutineRun];
  "routine.test": [{ id: string; number?: number }, RoutineRun];
  "routine.stop": [{ runId: string }, null];
  "git.status": [{ projectId: string }, { branch?: string; ahead: number; behind: number; changes: FileChange[] }];
  /** Looks for a new Liner Code and new versions of the agent tools now. */
  "updates.check": [Record<string, never>, Updates];
  /** Downloads the new Liner Code and makes it ready for the shell to put in. */
  "updates.download": [Record<string, never>, Updates];
  /** Runs a tool's own updater (all the tools with one waiting, without `id`), once no session is working on it. */
  "updates.tool": [{ id?: BuiltinProvider }, Updates];
  /** Puts an update's notice away until a newer version comes out. */
  "updates.dismiss": [{ key: "app" | BuiltinProvider }, Updates];
};
export type RpcMethod = keyof Rpc;
export type RpcParams<M extends RpcMethod> = Rpc[M][0];
export type RpcResult<M extends RpcMethod> = Rpc[M][1];

export type TreeEntry = { path: string; dir: boolean; children?: TreeEntry[] };

/** Splits "claude:claude-opus-5-5" into its provider and model. */
export function splitModel(ref: string): { provider: ProviderId; model: string } {
  const i = ref.indexOf(":");
  const provider = (i < 0 ? ref : ref.slice(0, i)) as ProviderId;
  return { provider, model: i < 0 ? "" : ref.slice(i + 1) };
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 });

/** a is a later version than b, by their first "x.y.z" ("v0.2.0", "codex-cli 0.164.0"). */
export function newerVersion(a?: string, b?: string) {
  const parts = (s?: string) => /(\d+)\.(\d+)\.(\d+)/.exec(s ?? "")?.slice(1).map(Number);
  const x = parts(a);
  const y = parts(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
export * from "./panel.ts";
