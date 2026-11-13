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
import type { CanvasVersion, FrameOp, FramePlaced, DesignFile, DesignFileInfo, DesignPatch, DesignPresence, DesignSelection, DesignSkill, FrameBuild, Lean, NewFrame, PictureAdd, PictureEndpoint, PictureModel } from "./design.ts";

/** The tools Liner Code knows by name. */
export type BuiltinProvider = "claude" | "codex" | "hermes" | "opencode" | "cursor" | "grok" | "antigravity" | "demo";
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
/**
  Each level by the name the person sees in the composer (ui/src/app/model.ts ACCESS_LEVELS, and the two Liner sets
  itself), for what the engine says about a level: an ask's `why` ("Manual asks before running commands").
*/
export const ACCESS_NAMES: Record<Access, string> = { auto: "Auto", ask: "Manual", review: "Reviewer decides", full: "Full access", read: "Read only", edits: "Edits on its own" };
export const ACCESS: Access[] = ["read", "ask", "edits", "auto", "review", "full"];
/** Effort levels from least to most, as tools name them: how near one is to another. */
const EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"];
/**
  The effort a model runs at when the one asked for isn't one it takes (picked for another model): the nearest it has, by
  that order, the model's default where two are as near, else the lower; its default when the ask isn't one of the order.
*/
export function nearestEffort(asked: string, efforts: { id: string }[], fallback?: string): string {
  if (!efforts.length || efforts.some((e) => e.id === asked)) return asked;
  const at = EFFORT_ORDER.indexOf(asked);
  const ranked = efforts.filter((e) => EFFORT_ORDER.includes(e.id));
  if (at < 0 || !ranked.length) return fallback ?? asked;
  const gap = (id: string) => Math.abs(EFFORT_ORDER.indexOf(id) - at);
  const best = Math.min(...ranked.map((e) => gap(e.id)));
  const near = ranked.filter((e) => gap(e.id) === best).map((e) => e.id);
  return near.includes(fallback ?? "") ? fallback! : near.sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b))[0];
}

/** How much a level lets through, for telling a lower one from a higher: Auto and Reviewer decides stand level with each other. */
export const rank = (a: Access) => ({ read: 0, ask: 1, edits: 2, auto: 3, review: 3, full: 4 })[a];
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
  /** auto: false where the tool's Auto can't run (Claude Code through another maker's API): Auto runs as Edits on its own there, and Liner Code lets routine commands through itself. */
  supports: { approvals: boolean; resume: boolean; effort: boolean; plan: boolean; auto?: boolean };
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
export type Endpoint = {
  id: string;
  label: string;
  url: string;
  protocol: EndpointProtocol;
  models: string[];
  /** Per model id, whether it takes pictures, as you set it in Settings. Unset: guessed from its name (PICTURE_GUESS). */
  pictures?: Record<string, boolean>;
};
export const ENDPOINT_TOOL: Record<EndpointProtocol, BuiltinProvider> = { anthropic: "claude", responses: "codex", chat: "opencode" };
/**
  Whether an endpoint's model takes pictures, guessed from its name: the first row that matches
  answers. Each row says where the fact comes from; checked against the models.dev catalogue
  OpenCode 1.19.5 ships (its input modalities). A wrong "no" only leaves a picture out (its words
  still go); a wrong "yes" may fail the request, so models known to read only text say no on every
  protocol. A name no row knows: no through Chat Completions, yes through the other two.
*/
export const PICTURE_GUESS: { re: RegExp; sees: boolean; from: string }[] = [
  { re: /transcribe|tts|embed|search|deep-research/i, sees: false, from: "audio, embedding and search models (gpt-4o-transcribe, o3-deep-research): text in, by the catalogue" },
  { re: /(^|[^a-z0-9])o[13]-mini/i, sees: false, from: "OpenAI o1-mini and o3-mini: text only, by OpenAI's model pages" },
  { re: /qwen[\d.]*-coder/i, sees: false, from: "Qwen coder models: 0 of 39 take images in the catalogue" },
  { re: /gpt-oss/i, sees: false, from: "gpt-oss: 0 of 74 take images in the catalogue" },
  { re: /deepseek-(chat|reasoner|v3|coder)/i, sees: false, from: "DeepSeek V3, chat and reasoner: text only in the catalogue and DeepSeek's docs" },
  { re: /glm-4(\.\d+)?(?![\d.-]*v)(\b|-|$)|glm-5(\.[0-2])?(?![\d.-]*v)(\b|-|$)/i, sees: false, from: "GLM 4.x and 5.0 to 5.2 without a v: text only in the catalogue (the v models see)" },
  { re: /minimax-m[12]/i, sees: false, from: "MiniMax M1 and M2.x: text only in the catalogue" },
  { re: /kimi-k2(?![.-][5-9])/i, sees: false, from: "Kimi K2 before 2.5 (k2, k2-thinking, k2-0905): text only in the catalogue" },
  { re: /claude/i, sees: true, from: "Claude 3 and later: 314 of 318 in the catalogue" },
  { re: /gpt-?(4o|4\.1|4-turbo|5)/i, sees: true, from: "GPT-4o, 4.1 and 5.x: 236 of 255 in the catalogue" },
  { re: /(^|[^a-z0-9])(o3(?!-mini)|o4-mini)/i, sees: true, from: "OpenAI o3 and o4-mini: OpenAI's model pages" },
  { re: /gemini|gemma-?3|llama-?4/i, sees: true, from: "Gemini, Gemma 3 and Llama 4: 159 of 160, most, and 25 of 25 in the catalogue" },
  { re: /vision|(^|[-_.])vl($|[-_.:])|\dv($|[-_.:])|llava|pixtral|moondream|minicpm-?v/i, sees: true, from: "vision, -VL and -v models, LLaVA, Pixtral, Moondream, MiniCPM-V: 119 of 121 in the catalogue" },
  { re: /mistral-(small|medium)-3|grok-?4|omni|kimi-k2[.-][5-9]/i, sees: true, from: "Mistral Small and Medium 3, Grok 4, Omni models, Kimi K2.5 and later: about nine in ten in the catalogue" },
];
/** The guess for a model with nothing set: a row of PICTURE_GUESS, else no through Chat Completions and yes through the others. */
export function picturesGuess(protocol: EndpointProtocol, model: string): boolean {
  return PICTURE_GUESS.find((r) => r.re.test(model))?.sees ?? protocol !== "chat";
}
/** Whether an endpoint's model takes pictures: what you set, else the guess. */
export const takesPictures = (e: Endpoint, model: string) => e.pictures?.[model] ?? picturesGuess(e.protocol, model);
export const endpointKey = (id: string) => `endpoint.${id}`;
/**
  How a model can answer an app (access.ai) as just a model, with no tools of any kind: an API
  endpoint's (the promo's too), called straight over HTTP; or Claude Code's, with its tools, settings
  and servers all off. A model that only runs through Codex, OpenCode, Hermes or another agent can't:
  those bring tools of their own (a shell, your MCP servers) that an app must never reach. Null then.
*/
export function plainWay(provider: ProviderId, s: { endpoints?: Endpoint[]; voucher?: boolean }): { kind: "http"; endpoint: Endpoint } | { kind: "claude" } | null {
  const [tool, rest] = provider.split(".");
  if (rest) {
    const e = (s.endpoints ?? []).find((x) => x.id === rest && ENDPOINT_TOOL[x.protocol] === tool) ?? (s.voucher && rest === VOUCHER.id && tool === ENDPOINT_TOOL[VOUCHER.protocol] ? VOUCHER : undefined);
    if (e) return { kind: "http", endpoint: e };
  }
  return tool === "claude" ? { kind: "claude" } : null;
}
/**
  Whether a session's model takes pictures: an API endpoint's model as takesPictures says ("default"
  is its first); a tool's own model as you set it in Settings (toolPictures), else yes (the tool knows
  its models: OpenCode's catalogue decides there, Hermes turns a picture into a saved file).
*/
/** A tool's own model as Settings.toolPictures keys it: "hermes:default", "acp.goose:default", "claude:claude-opus-5-5". */
export const toolPicturesKey = (provider: ProviderId, model: string | undefined) => `${provider}:${model || "default"}`;
export function picturesOf(provider: ProviderId, model: string | undefined, s: { endpoints?: Endpoint[]; voucher?: boolean; toolPictures?: Record<string, boolean> }): boolean {
  const way = plainWay(provider, s);
  if (way?.kind !== "http") return s.toolPictures?.[toolPicturesKey(provider, model)] ?? true;
  const e = way.endpoint;
  return takesPictures(e, !model || model === "default" ? (e.models[0] ?? "") : model);
}
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
  Your own picks for the pair and the Reviewer, each "<provider>:<model>": `lead` is who new
  sessions are led by, `sidekick` who it hands work to, `checker` who reads each change. Any model
  a tool here runs, Chinese ones through OpenCode, Hermes or an API endpoint too; unset is
  automatic (castOf, reviewerOf in cast.ts).
*/
export type ModelPicks = { lead?: string; sidekick?: string; checker?: string };

/**
  What a turn that carries on yours does (see the turn item's `part`). The engine writes only
  "fix" now; the others are for timelines from before pairs.
*/
export type TurnPart = "build" | "refine" | "repair" | "fix" | "revise" | "takeover";

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
  /**
    "design": a design on its own (design.new with no project), its folder in the designs home
    (~/Liner Designs/<slug>/, see design.ts DESIGNS_HOME). Never Scratch, never one of the Code
    face's projects or its chooser: the app leaves these out of its project lists. Unset: a project.
  */
  kind?: "design";
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
  /** The lead, who you talk to and who owns each turn: a bare model ("@claude:claude-opus-5-5") or one of your agents. */
  agent: string;
  /**
    A pair: the model ("<provider>:<model>") the lead hands bounded work to through Liner Code's
    `sidekick` tool. Unset, one model works the session alone.
  */
  sidekick?: string;
  /** This session's own word on the Reviewer: true reads each change, false reads none; unset follows Settings.review. */
  review?: boolean;
  /**
    Where the change the Reviewer hasn't read yet starts (a "before" snapshot), when a check was
    skipped because a message you wrote while the turn ran went first. The next check reads from
    here to its own turn's end, then it's cleared.
  */
  reviewSince?: string;
  /** Who took the last turn: the lead, or who led the session before (a session from before pairs). */
  turnBy?: string;
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
  /** The thinking level the tool really runs the model at, when it isn't `effort` (a tool with no such level). */
  effortNow?: string;
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
  /** Agents it sent that still work, also in the background after the turn that sent them: the Wall, the sidebar and quitting read it here, not from the timeline. None once the engine stops. */
  agentsAtWork?: number;
  /** Messages you wrote while it worked, sent in order when the turn ends. */
  queue?: QueuedMessage[];
  /** The Reviewer's last word on this session's changes. */
  verdict?: { state: "checking" | "verified" | "blocked"; note?: string; round: number };
  /** Your own sidebar group. */
  group?: string;
  /** Snoozed until something happens rather than a time. */
  wake?: { kind: "checks" | "reply"; pr: number; seen?: number };
  /** One of several models given the same ask, to compare and keep one. */
  compare?: { id: string; base: string };
  /** The pull request this session's branch opened. */
  pr?: { number: number; url: string; state: string };
  /** A routine's run. */
  routine?: { id: string; run: string };
  /**
    Begun from a design: the design file (its slug in .liner/designs/) this session draws. Every
    session of a design project has it (the engine sets it when thread.create leaves it out).
  */
  design?: { file: string };
  /**
    How the agent works in it, fixed for the session's life (DeepSeek Harness's agent presets):
    unset is Standard; "creator" is Workshop, which adds to Liner Code itself (its connections,
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
  /** The provider sessions of others who work here besides `agent` (the sidekick, as "@<ref>"), by who they are. */
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

/**
  What the person reads of a message Liner wrote for them (Liner Design's "Fix 1 check", "Build 2 frames"): a short line and
  chips for what it is about. Display only: the agent is sent `text` as it is, and this never reaches a provider.
*/
export type ShownChip = { kind: "check" | "frame" | "layer" | "compare" | "build"; label: string };
export type UserShown = { text: string; chips?: ShownChip[] };
/** files: what you attached, saved on disk, which go with the message when it's sent. `shown`: what the person reads of it (UserShown). */
export type QueuedMessage = { id: string; text: string; at: number; files?: string[]; anchor?: { file: string; line: number; endLine?: number }; shown?: UserShown };
export type Question = { question: string; header?: string; options: { label: string; description?: string; suggested?: boolean }[]; multiSelect?: boolean };

export type ToolKind = "read" | "edit" | "write" | "exec" | "search" | "fetch" | "think" | "task" | "web" | "other";
/** One step of an agent's own: what it did, as its row in the timeline would say it. */
export type AgentStep = { title: string; toolKind: ToolKind; status: "running" | "done" | "failed"; path?: string };
/**
  An agent a model sent off to do part of the work (Claude Code's Agent tool), on that call's row:
  who it is, what it was asked, what it does now and what it sent back. The model that sent it
  waits for its report, unless it runs in the background.
*/
export type AgentRun = {
  /** What kind of agent: "Explore", "Test runner", "Subagent". */
  name: string;
  /** What it was sent to do, in a few words. */
  task?: string;
  /** The whole brief it was given. */
  brief?: string;
  /** The model it runs on, as a model ref ("claude:claude-haiku-5-5"), once it's known. */
  model?: string;
  /** The tool's id for its run: what stopping it stops. */
  taskId?: string;
  /** The row of the agent that sent this one, when an agent sent it. */
  parent?: string;
  /** What it's doing now, in words: its own one-line summary, or its last step. */
  now?: string;
  /** Its steps so far, the latest last (the last 40). */
  steps?: AgentStep[];
  tools?: number;
  tokens?: number;
  /** The model that sent it didn't wait for it. */
  background?: boolean;
  /** It takes a word from you while it works (Codex's agents do; Claude Code's don't). */
  steerable?: boolean;
  /**
    How the agent stands, when that isn't its call's: one in the background goes on after its call
    returned, and one stopped ended without failing its call. Unset, it's the row's status.
  */
  state?: "running" | "done" | "failed" | "stopped";
  /** What it sent back. */
  report?: string;
  /** What it changed, as Liner Code measured it (a sidekick's brief), not as it said. */
  files?: FileChange[];
};
/** How an agent stands: its own word, else its call's. */
export const agentState = (it: { status: "running" | "done" | "failed" | "stopped"; agent?: AgentRun }) => it.agent?.state ?? it.status;
/** rel: the paths are already the project's own (every change written since they were), so none is stripped of its folder again. */
export type FileChange = { path: string; status: "added" | "modified" | "deleted" | "renamed"; added: number; removed: number; from?: string; rel?: true };
/** `owner`: who took it on, where the tool says (Claude Code's tasks carry an agent's name). */
export type PlanEntry = { title: string; status: "pending" | "in_progress" | "completed"; owner?: string };
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
/**
  A key a connection needs, named only: you type it on the install card, and it's sealed in the
  keychain. `optional`: its server works without one, and what names it is left out until you type it.
*/
export type AddonSecret = { name: string; label: string; optional?: boolean };
/** A connection's manifest, version 1. A secret is never written in: `${NAME}` in env or a header stands for it. */
export type ConnectionManifest = { apiVersion: 1; id: string; kind: "connection"; name: string; description?: string; summary?: string; server: AddonServer; secrets?: AddonSecret[]; dsh?: undefined };
/**
  A ported DeepSeek Harness plugin that gives tools to an agent and draws nothing: a connection
  whose server is its own program (engine/src/dsh-hosts.ts), which Liner Code serves to every
  agent tool as an MCP server. Only Liner Code writes one, like any `dsh` block.
*/
export type DshConnectionManifest = { apiVersion: 1; id: string; kind: "connection"; name: string; description?: string; summary?: string; dsh: DshToolsPlugin; secrets?: undefined };
/** A connection of either kind: a server it names, or a ported plugin's own program. */
export type AnyConnectionManifest = ConnectionManifest | DshConnectionManifest;
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
  /**
    It may ask a model: text in, text out, with no tools, files or agent. You pick which of your
    models when it first asks (Settings.addonModels), and it's billed to that model's account.
  */
  ai?: boolean;
};
/** Where a panel opens: the right dock beside a session, a tab beside Chat, or a page of its own from the left sidebar. */
export type PanelPlace = "dock" | "tab" | "page";
export const PANEL_ICONS = ["app", "blocks", "list", "notes", "chart", "check", "clock", "globe", "flask", "star", "bolt", "inbox"] as const;
export type PanelIcon = (typeof PANEL_ICONS)[number];
/**
  A DeepSeek Harness plugin, ported (engine/src/dsh.ts): the npm package it came from and its two
  halves. Its browser half is the panel's client.js, run in the sealed frame under a DSH-shaped
  loader (contracts/src/dsh.ts); its Node half, when it has one, runs in a process of its own beside
  the engine, never in it (engine/src/dsh-hosts.ts). Only Liner Code writes this block, from a
  package you chose: an agent's draft or an addon.json that has one is refused.
*/
export type DshPlugin = {
  package: string;
  version: string;
  /** The tarball's sha512, as npm gave it; a folder you chose has none. */
  integrity?: string;
  /** Its Node half: the file in the package that exports its plugin, run with `config`. */
  host?: string;
  config?: Record<string, unknown>;
  /**
    The tools its Node half gives DeepSeek Harness's agent (ctx.tools.register), as read from its
    code before it's added: what the card says it gives your agents, and all its program may give them.
  */
  tools?: DshTool[];
  /**
    What its program tells DSH's agent (ctx.systemPrompt.section), as read from its code before it's
    added: told to every agent with its tools as their MCP server's instructions, and only these
    words. `live`: some of it is worked out as it runs, which the card can't show, and that is told
    too. Only a plugin that gives tools has this.
  */
  instructions?: DshInstructions;
  /** The DSH slot its browser half draws in, which made `place`. */
  slot: DshSlot;
};
/**
  A tool a ported plugin gives your agents: its name, and what it says it does when that's plain text
  in its code. The text read here is what agents are told; a tool without one is described by its
  program as it runs.
*/
export type DshTool = { name: string; description?: string };
/** A ported plugin's words for every agent: each section's text as written in its code, and whether more is worked out as it runs. */
export type DshInstructions = { texts: string[]; live?: boolean };
/** The `dsh` block of a plugin that only gives tools: no slot, a program, and the tools it gives. */
export type DshToolsPlugin = Omit<DshPlugin, "slot" | "host" | "tools"> & { host: string; tools: DshTool[] };
/** The DeepSeek Harness slots a ported plugin can draw in: a sidebar page, a right-pane tab, a conversation view. */
export type DshSlot = "sidebar.panellist" | "sidebar.right.pane.tab" | "conversation.view";
/**
  What a ported plugin's frame needs beside its files: which package and slot to start, its config,
  and `base`, the engine's path for this run that reaches its Node half and its package's pictures
  (/dsh/<token>/), or `error`, why its Node half didn't start. `notice`, why it can't save where it
  would (the folder Liner Code would make for it in your Documents is one of yours already, or holds
  a project): its page says so, since what it then says itself is only "operation not permitted".
*/
export type DshFrame = { package: string; slot: DshSlot; config?: Record<string, unknown>; base?: string; error?: string; notice?: string };
/** A panel's manifest, version 1. `entry` is its HTML file, beside the manifest. */
export type PanelManifest = { apiVersion: 1; id: string; kind: "panel"; name: string; description?: string; summary?: string; place: PanelPlace; entry: string; icon?: PanelIcon; access: PanelAccess; dsh?: DshPlugin };
export type AddonManifest = ConnectionManifest | DshConnectionManifest | PanelManifest;
/** A session's mode: Standard ("standard", or unset), Workshop ("creator", once called Creator mode), or a custom one (`agent:<id>`, one of your named agents' instructions). */
export type SessionMode = "standard" | "creator" | `agent:${string}`;
/**
  The modes Liner Code comes with, as Settings › Modes and the new-session picker show them, with
  their guide: an intro, Mode details, and How to use with example tasks (DeepSeek Harness's
  preset guide, ui-agent-preset/guide-locales.ts, its words for Liner Code).
*/
export type ModeGuide = { id: "standard" | "creator"; name: string; blurb: string; intro: string; details: { h: string; p: string }[]; examples: { h: string; ask: string; expect: string }[] };
/** What Create your add-on writes in a new Workshop task's box, not sent (DeepSeek Harness's own ask, ui-entry-customization). */
export const CREATE_ADDON_ASK = "Create a Liner Code add-on with a left sidebar entry.";
/** Words in an add-on, a page or a list of them that are about the feature, not one to make ("the add-ons page"). */
const ABOUT_ADDONS = /^('s\b|(page|list|menu|settings|api|code|system|manifest|bridge|loader|store|engine|feature|folder|dir|directory|tests?|ui|button|section|sidebar|guide|docs?|install|installer|card|frame|offer|flow|permissions?|versions?)\b)/;
/** Another program's add-ons, which a project of yours may be: named before ("my Firefox add-on") or after it, in the same sentence ("the add-on for Firefox", "make the add-on work in Chrome"). */
const OTHERS = "firefox|chrome|browser|edge|safari|wordpress|blender|anki|excel|word|outlook|office|google|gmail|sheets|workspace|vs ?code|figma|thunderbird|kodi|warcraft|wow|minecraft|godot|unity|unreal|home assistant|obsidian|raycast|alfred";
const OTHERS_ADDONS = new RegExp(`\\b(${OTHERS})$`);
const FOR_OTHERS = new RegExp(`^[^.?!\\n]*?\\b(for|in|into|to|on|inside) (the |my |our |a )?(${OTHERS})\\b`);
/**
  Whether an ask is for an add-on to Liner Code itself (Home no longer switches to Workshop on it:
  Workshop starts only from Create your add-on or the mode picker): an add-on (or addon) of any kind, unless it's about the add-ons feature ("the
  add-ons page"); or something to make in Liner Code: a panel, an app, a page, a tab, a sidebar
  entry, a connection, a plugin, an extension, a widget, an integration. Work on a project's own
  plugins or panels doesn't count: that names no add-on and no Liner. In Liner Code's own source
  (`ownSource`), "add a tab to Liner" is work on the code, so only an add-on by name counts there.
*/
export function asksForAddon(text: string, { ownSource = false } = {}) {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  const liner = /\bliner\b/.test(t);
  for (const m of t.matchAll(/\badd-?ons?\b ?/g)) {
    const after = t.slice(m.index + m[0].length);
    const before = t.slice(0, m.index).trimEnd();
    if (ABOUT_ADDONS.test(after) || OTHERS_ADDONS.test(before) || (!liner && FOR_OTHERS.test(after))) continue;
    // "the add-ons" on its own is the feature; "the add-on I asked for" is one being made.
    if (/\b(the|liner code's|liner's)$/.test(before) && m[0].trim().endsWith("s")) continue;
    return true;
  }
  if (!liner || ownSource) return false;
  // One to make: "a panel", "my own app", or the thing right after the verb ("bikin plugin").
  const verb = "create|make|build|add|write|generate|design|set up|give me|i want|i'd like|i would like|i need|buat|buatkan|bikin|bikinkan|tambah|tambahkan";
  const thing = "panel|app|page|tab|sidebar (?:entry|item|app|link)|connection|plugin|plug-in|extension|widget|integration";
  return new RegExp(`\\b(${verb})\\b`).test(t) && new RegExp(`\\b((a|an|my|new|own|another|one|sebuah|satu)( [\\w-]+){0,2}?|${verb}) (${thing})s?\\b`).test(t);
}
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
    name: "Workshop",
    blurb: "Customize Liner Code through conversation. Let the agent make connections, panels and apps that add features or UI, or combine tools and prompts to make your own mode.",
    intro: "Choose Workshop for a new task. Describe what you want, where it should appear, and how you'll check it.",
    details: [
      { h: "What you can create", p: "Workshop has everything in Standard, plus a guide to Liner Code's add-ons that the agent reads a part at a time: what it can make, the panel bridge, the places an app can open, the manifest, the theme's tokens, a starter for each kind, how to check its work, and what's installed now." },
      { h: "Add-ons and modes", p: "An add-on adds to Liner Code: a connection every agent tool gets, a panel in the right dock, an app as a tab beside Chat or a page of its own from the left sidebar. A mode is a set of instructions for whichever model a session runs, which you pick when you start one." },
      { h: "How the result takes effect", p: "Ask it to add and check what it makes, not only to write the files. Nothing goes in without your yes on its card, and it gets only the access it lists. A panel or an app opens at once; a connection reaches agent tools now or from their next turn. A new mode is picked when you start a session. Its folder is the project you picked, or Scratch." },
    ],
    examples: [
      { h: "Add a page", ask: "Make a notes app with a left sidebar entry that opens a full-page editor. Keep my notes between sessions. Add it, and check that the page opens.", expect: "An app under Add-ons in the left sidebar, its page working, and what it checked." },
      { h: "Add a panel", ask: "Make a panel beside my sessions that lists the TODOs in this project, so I can send one to you. Check it, then ask me to add it.", expect: "A panel in the right dock, tried live as a preview before you add it." },
      { h: "Make my own mode", ask: "Make a “Code review” mode: prioritise likely bugs and missing tests, cite files and lines, and ask before changing anything. Save it as a mode I can pick.", expect: "A mode you pick when you start a session. Its instructions guide the model; Safety still decides what it may do." },
    ],
  },
];
export const modeName = (mode: SessionMode | undefined, agents: { id: string; name: string }[]) => (!mode || mode === "standard" ? "Standard" : mode === "creator" ? "Workshop" : (agents.find((a) => `agent:${a.id}` === mode)?.name ?? "A custom mode"));

/** Where an offer to make an app stands: offered, being made and added, settled, or replaced by a newer offer. */
export type OfferState = "proposed" | "creating" | "installing" | "installed" | "kept" | "removed" | "dismissed" | "cancelled" | "failed" | "replaced";
/** A panel as Settings and the dock know it. */
export type PanelInfo = { place: PanelPlace; access: PanelAccess; icon?: PanelIcon; entry: string; dsh?: DshInfo };
/** A ported DeepSeek Harness plugin as the window knows it: its package, whether it runs a program of its own, and the tools it gives your agents. */
export type DshInfo = { package: string; version: string; host: boolean; tools?: string[] };
/** An add-on you have, as Settings lists it. */
export type AddonInfo = {
  id: string;
  kind: "connection" | "panel";
  name: string;
  description?: string;
  /** One plain sentence of what it does for you, for the Add-ons page (summaryOf has the fallback). */
  summary?: string;
  /** The version in use, and every one kept. */
  version: number;
  versions: number[];
  enabled: boolean;
  /** When you removed it: it stays on disk, off, until you restore it. */
  removed?: number;
  /** The one project it's for; every project when unset. */
  project?: string;
  /** Who added it, from which session, and when; `from`, the GitHub address or folder you added it from yourself. */
  by: { agent: string; threadId?: string; title?: string; from?: string; at: number };
  /** A connection's way in: a command (stdio) or an address (http). */
  transport?: "stdio" | "http";
  /** What it reaches: its address, or the command it runs; a panel's access, in words. */
  reaches: string;
  secrets: AddonSecret[];
  /** A panel's place, access, icon and entry file. */
  panel?: PanelInfo;
  /** A connection that's a ported DeepSeek Harness plugin's own program: its package and tools. */
  dsh?: DshInfo;
  /** Each kept version's date, by version. */
  dates?: Record<number, number>;
};
/** Where a connection's key is kept: the keychain account (`key:` before it) and the engine's name for it. */
export const addonKey = (id: string, secret: string) => `addon.${id}.${secret}`;
/**
  What an add-on does for you, in one plain sentence, as the Add-ons page lists it: its own summary,
  else one from its kind and place. Never a server, a manifest or an access level.
*/
export function summaryOf(a: Pick<AddonInfo, "kind" | "name" | "summary" | "panel">) {
  if (a.summary?.trim()) return a.summary.trim();
  if (a.kind === "connection") return `Lets your agents work with ${a.name}.`;
  if (a.panel?.place === "page") return "A page of its own, opened from the sidebar.";
  if (a.panel?.place === "tab") return "A tab beside Chat in your sessions.";
  return "A panel beside your sessions, in the right dock.";
}
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
export type PanelAsk = AskBase & { kind: "panel"; place: PanelPlace; access: PanelAccess; icon?: PanelIcon; entry: string; files: { path: string; size: number }[]; checked?: string; wider?: string[]; same?: boolean; next: number; dsh?: DshAsk };
/**
  A DeepSeek Harness plugin's card: its package, and when it runs a program of its own, what that
  program may do here (`sandbox`, in words). `left` is what of it Liner Code doesn't have, said plainly.
  `gives`: the tools it gives your agents, with what each says it does (one with no description is
  described by its program as it runs). `instructions`: what it tells every agent with its tools, as
  read from its code (sections apart by a blank line); `instructionsLive`, that its program works
  out more of it as it runs, which can't be shown here. `saves`, on a Mac, for a plugin with a page:
  the folder Liner Code makes for it in your Documents when it first runs (~/Documents/Media Desk),
  the one place there it may save text and save again; with `why`, it gets none (a folder of that
  name is yours already, or holds a project).
*/
export type DshAsk = DshInfo & { sandbox?: string; left: string[]; size: number; gives?: DshTool[]; instructions?: string; instructionsLive?: boolean; saves?: { path: string; why?: string } };
export type ConnectionAsk = AskBase & {
  kind?: "connection";
  transport: "stdio" | "http";
  /** Its address, or the command line it runs. */
  server: string;
  /** Where the version you have points, when this one points elsewhere: a key kept for that one is typed again, not sent here. */
  moved?: string;
  /** The variables a command gets, by name only (its keys among them), so you OK exactly what it's given. */
  env?: string[];
  /** The agent tools on this Mac it reaches ("Claude Code", "Codex"…). */
  reaches: string[];
  secrets: AddonSecret[];
  /** A ported DeepSeek Harness plugin whose own program is the server: its card says what that program gives your agents. */
  dsh?: DshAsk;
};

/**
  Why an ask came to you. `text` completes "… asks because " in lower case with no full stop ("it
  reaches images.unsplash.com"); `level` stands as its own sentence ("Manual asks before every
  command"); `undo` stands after "Can't be undone: " ("deletes files for good").
*/
export type ApprovalWhy = { kind: "undo" | "outside" | "network" | "changes" | "level"; text: string };
/**
  A "don't ask again this session" an ask can offer: `rule` a command (its parts, for a compound
  one), `skill` scripts in an installed skill's folder (Auto).
*/
export type GrantKind = "rule" | "skill";
export type ApprovalGrant = { kind: GrantKind; label: string };

type Base = { id: string; turn: number; at: number };
export type Item =
  | (Base & {
      kind: "turn";
      /** Who worked this turn and on what, for the line above its work. */
      agent: string;
      model: string;
      /** A planner's turn from before pairs, which ended in a plan rather than in edits: old timelines still draw it. */
      planning?: boolean;
      status: "running" | "done" | "stopped" | "error";
      seconds?: number;
      /**
        A turn that carries on the one you started: the lead fixing what the Reviewer found ("fix").
        It shows as part of your turn, not a turn of its own. Older timelines have the other parts.
      */
      part?: TurnPart;
      /** Why this turn went to whom (what the Reviewer found), said when you ask, not on the timeline. */
      why?: string;
      /** Milliseconds this turn spent waiting on you (asks, questions, plans), settled; `seconds` leaves them out. */
      waited?: number;
      /** Set while at least one ask, question or plan of this turn is open: when the wait began. */
      waitingSince?: number;
    })
  | (Base & {
      kind: "user";
      text: string;
      files?: string[];
      steer?: boolean;
      /** Asked about lines in the diff: the agent's answer belongs to this place. */
      anchor?: { file: string; line: number; endLine?: number };
      /** What the person reads of it, when Liner wrote `text` for them (UserShown); `text` is what the agent was told. */
      shown?: UserShown;
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
      /** stopped: you stopped the turn (or it was ended for you) before the call finished. */
      status: "running" | "done" | "failed" | "stopped";
      seconds?: number;
      path?: string;
      /** The agent this call sent off, on a "task" row. */
      agent?: AgentRun;
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
      /** What "Don't ask again" would allow for the rest of the session, like "pnpm test": the `rule` grant's label, for older paths. */
      rule?: string;
      /** The agent's own words for what the command does (one line, at most 140 characters). Never Liner's own text. */
      says?: string;
      /** Why it came to you, read off the ask by the same checks that decided it, most important first. */
      why?: ApprovalWhy[];
      /** What "don't ask again this session" can be offered for, each saying exactly what it allows. None: nothing is offered. */
      grants?: ApprovalGrant[];
      /** What your yes stopped asking about, when it really took a grant: a rule or a skill (its label), or the rest of the turn. */
      granted?: { kind: GrantKind | "turn"; label?: string };
      /** Whether "don't ask again this turn" can be offered: a yes with `grant: "turn"` would be taken. */
      turnGrant?: boolean;
      answeredAt?: number;
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
  | (Base & { kind: "question"; questions: Question[]; state: "asking" | "answered" | "skipped" | "expired"; answers?: Record<string, string>; answeredAt?: number })
  /** A plan to approve (a tool's own plan mode). `auto`: one from before pairs that nobody asked to see, handed straight on. */
  | (Base & { kind: "proposal"; title: string; plan: string; state: "asking" | "approved" | "changed" | "expired"; note?: string; auto?: boolean; answeredAt?: number })
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
  | (Base & { kind: "notice"; text: string; stop?: boolean });

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
  /** Your lead, sidekick and Reviewer for new sessions (each automatic while unset). */
  picks?: ModelPicks;
  /** The Reviewer reads each change before it's yours: on unless false. A session's own `review` comes first. */
  review?: boolean;
  /**
    What a new session starts with: a pair (lead and sidekick), the best model alone, or the fast one
    alone. Unset: a pair when two different models are ready, else one model.
  */
  start?: "pair" | "best" | "fast";
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
  /** 1 once Plan and Auto sessions became pairs and After became the Reviewer's switch (`toPairs`). */
  pairVersion?: number;
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
  /** Per tool model ("<provider>:<model>", toolPicturesKey), whether it takes pictures, as you set it. Unset: it does. API endpoints keep theirs on Endpoint.pictures. */
  toolPictures?: Record<string, boolean>;
  /** Liner Design's picture models (Settings › Models › Pictures), OpenAI-Images-compatible endpoints; their keys are in the keychain (pictureKey). */
  pictures?: PictureEndpoint[];
  /** A voucher was redeemed: its model (VOUCHER) is in the picker. */
  voucher?: boolean;
  /** The model each app that asks for one (access.ai) uses, by the app's id, as "<provider>:<model>": picked in the window when it first asks. */
  addonModels?: Record<string, string>;
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
  /** Liner opens in (Settings › General): the Code face, or the Design face on Design Home. Unset: "code". */
  openIn?: "code" | "design";
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
    from where macOS put a downloaded app that wasn't moved to Applications; "manual" is a packaged
    app that can't swap itself yet (Windows), so the new one comes from the release page.
  */
  can: "install" | "source" | "readonly" | "translocated" | "manual";
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
/**
  Routines are switched off (2026-11-10) while the owner thinks of what replaces them: no schedule,
  webhook or GitHub watch fires, Run now and Test answer that they're off, and the app offers them
  nowhere. Saved routines and past runs stay on disk as they are. True brings all of it back.
*/
export const ROUTINES_ON: boolean = false;
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
  /** A session deleted for good, or a side chat let go; an archived session comes as "thread". */
  | { type: "thread.removed"; id: string }
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
  /** A launch.json server in `root` started, became ready, stopped or ended: Browsers list theirs again. */
  | { type: "launch"; root: string }
  | { type: "settled"; threadId: string; reason: string }
  | { type: "updates"; updates: Updates }
  /** Every tool's plan windows, after one was asked again (a turn on it ended, you pressed Look again). */
  | { type: "limits"; tools: ToolLimits[] }
  /** An agent uses the session's Browser; the app answers with agent.browser.reply. */
  | { type: "agent.browser"; id: string; threadId: string; op: AgentBrowserOp; args: Record<string, unknown> }
  /** A design's file changed on disk (the agent is editing it): a Design surface showing it draws it again. */
  | { type: "design.changed"; threadId: string; design: string; at: number }
  /** An add-on was added, switched, moved to another version, removed or restored. */
  | { type: "addons"; addons: AddonInfo[]; off: boolean }
  /** A piece of a model's answer to an app (liner.ai.ask with onText), for the window to pass to its frame. */
  | { type: "panel.ai"; call: string; text: string }
  /** Liner Design: a design file of a folder changed (a frame, when `frame`), by you in the editor or by an agent. The canvas draws it again, keeping the selection by data-l. */
  | { type: "canvas.changed"; cwd: string; file: string; frame?: string; by: "you" | "agent"; threadId?: string; at: number; /** The frame file's revision now (FrameRev), when it names a frame whose file is there. */ rev?: string; /** While watched: true when the design file itself went (its folder or design.json removed on disk), false when it came back; once per change, never with `frame`. */ gone?: boolean }
  /** An agent is writing a frame (on), or stopped (off): its outline and tag go on the frame, lead and sidekick each in their colour. */
  | ({ type: "canvas.presence" } & DesignPresence)
  /** A picture the picture model is making: `done` of `count`, for the pictures.make call `call`; `error` when it failed. */
  | { type: "pictures.progress"; threadId: string; call: string; done: number; count: number; at: number; error?: string };

/** `shot` isn't the Browser's: the app draws a page of this Mac out of sight and answers with its picture (a design's, for its agent). */
export type AgentBrowserOp = "open" | "read" | "click" | "type" | "press" | "screenshot" | "shot";

/** A terminal of a session's Terminal surface; `exited` once its shell has ended (it stays until its tab is closed). */
export type TermInfo = { id: string; title: string; cwd: string; at: number; command?: string; exited?: number };

/** A server listening on this Mac, as the Browser sees it. */
export type LocalServer = { port: number; process: string; url: string; owner: "session" | "project" | null; web: boolean };

/**
  A dev server of the session folder's .claude/launch.json (Claude Code's file, in its format),
  which the engine runs for the Browser. `port` is the entry's; `at` the port it runs on, or last
  ran on (another, when the entry's was taken). `ended` says why it isn't running; `asleep`, that
  it stopped while no one looked and starts again when a session in its folder is opened.
  `changed`: launch.json's entry isn't what it runs now. `problem`: an entry that can't run here.
  `ask`: what a press of Run or Restart would run, when nobody has said yes to it in this folder as
  the file says it now. In launch.start's and launch.restart's answer it means nothing ran: show it
  and run it only on a yes, by sending `ask.key` back as `allow`.
*/
export type LaunchServer = {
  name: string;
  port: number;
  at?: number;
  status: "stopped" | "starting" | "running";
  startedAt?: number;
  ended?: { reason: string; at: number; failed?: boolean; tail?: string[] };
  asleep?: boolean;
  changed?: boolean;
  problem?: string;
  ask?: LaunchAsk;
};
/**
  A launch.json entry as it would run, for you to see before it does: its command line, folder,
  environment (as written in the file, values and all) and port. `risky` names the variables that
  change what runs (NODE_OPTIONS, PATH, DYLD_*…), which make it high risk. `key` stands for exactly
  this: a yes trusts the entry as shown, and any change to the command, folder, environment or port
  asks again.
*/
export type LaunchAsk = { key: string; command: string; cwd: string; env: Record<string, string>; port: number; risk: Risk; risky?: string[] };

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
  "thread.create": [{ projectId: string; agent?: string; sidekick?: string; review?: boolean; title?: string; forkOf?: string; id?: string; access?: Access; effort?: Effort; model?: string; worktree?: boolean; base?: string; inWorktree?: string; mode?: SessionMode; /** Begun from a design (Thread.design); in a design project it defaults to the project's design file. */ design?: { file: string } }, Thread];
  "thread.update": [{ id: string; title?: string; archived?: boolean; access?: Access; model?: string | null; effort?: Effort; agent?: string; sidekick?: string | null; review?: boolean | null; pinned?: boolean; snoozedUntil?: number | null; done?: boolean; unread?: boolean; group?: string | null; wake?: { kind: "checks" | "reply"; pr: number } | null }, Thread];
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
  "memory.forget": [{ projectId: string; fact: string }, string[]];
  /** A project's earlier sessions, searched: your messages and the agents' answers. */
  "sessions.search": [{ projectId: string; query: string }, { threadId: string; title: string; at: number; who: "you" | "agent"; snippet: string }[]];
  /** A limited session carries on with another tool's model (`model`, else the one its limit card offers). */
  "thread.carryOn": [{ id: string; model?: string }, null];
  "thread.send": [{ id: string; text: string; files?: { name: string; data: string }[]; mode?: "queue" | "steer"; anchor?: { file: string; line: number; endLine?: number }; /** Sent from Liner Design: the design file (its slug) and what is selected, for the turn's "## Design" note (lean.ts designNote). */ design?: { file: string; sel?: DesignSelection }; /** What the person reads of it (UserShown): kept on the item, never sent to the agent. */ shown?: UserShown }, null];
  "thread.queue": [{ id: string; queue: QueuedMessage[] }, Thread];
  /** Rewinds to just before a message you sent: the turns from there come off, and with `files`, so do their changes. */
  "thread.rewind": [{ threadId: string; itemId: string; files: boolean; force?: boolean }, { turn: number; files: number }];
  /** `kept`: why the session's worktree stayed (another session works there, or it holds changes), to say so. */
  "thread.remove": [{ id: string }, { kept?: string } | null];
  /** The session's side chat, started now if it has none; `fresh` starts it again from where the session is. */
  "thread.side": [{ id: string; fresh?: boolean }, Thread];
  "thread.stop": [{ id: string }, null];
  /** Stops one agent a model sent off (`item`: its row), leaving the turn running. False when the tool can't stop it alone. */
  "thread.stopAgent": [{ id: string; item: string }, boolean];
  /** A word for one agent at work, read at its next step without stopping it. False when it couldn't take it (it had ended). */
  "thread.steerAgent": [{ id: string; item: string; text: string }, boolean];
  /** `scope`, for an add-on's install card: every project, or only the session's. */
  /** `always: true` is `grant: "rule"`. `grant: "turn"` lets this turn's ordinary asks go ahead until it ends. */
  "approval.answer": [{ threadId: string; itemId: string; allow: boolean; reason?: string; always?: boolean; grant?: GrantKind | "turn"; scope?: "all" | "project" }, null];
  /** What this session no longer asks about: its grants, and whether this turn goes ahead without asking. */
  "approval.rules": [{ threadId: string }, { grants: ApprovalGrant[]; turn: boolean }];
  /** Takes one grant back (`kind: "turn"` clears the turn's). */
  "approval.forget": [{ threadId: string; kind: GrantKind | "turn"; label: string }, null];
  /** Switches an add-on on or off, moves it to a kept version, removes it (it stays on disk) or restores it. */
  "addons.update": [{ id: string; enabled?: boolean; version?: number; removed?: boolean; project?: string | null }, AddonInfo[]];
  /** A connection you add by hand: its manifest, checked as an agent's would be. Its keys go to the keychain first, as on the card. */
  "addons.add": [{ manifest: string; project?: string }, AddonInfo[]];
  /** A panel's files to draw: one in use (or a kept `version`), or the draft on a card that's up (`threadId`, `itemId`), for its preview. */
  /**
    A panel's files for its frame. A ported DeepSeek Harness plugin also gets `dsh`: its slot, its
    host config, and with a Node half, where the frame reaches it (`base`, a path of the engine's
    made for this run) or why it couldn't start (`error`).
  */
  "addons.files": [{ id: string; version?: number } | { threadId: string; itemId: string }, { id: string; name: string; place: PanelPlace; entry: string; access: PanelAccess; files: Record<string, string>; version?: number; dsh?: DshFrame }];
  /**
    A panel's bridge call, passed on by the window for the frame that made it: the panel by id, the
    session it's beside (none on a page), or the card it's a preview on. The engine answers only
    what that panel's access allows.
  */
  "panel.call": [{ addon: string; threadId?: string; preview?: string; method: string; args?: unknown; apiVersion?: number }, unknown];
  /** Stops a model's answer to an app (its frame closed): `call` is the one the window gave its ai.ask. */
  "panel.cancel": [{ call: string }, null];
  /**
    An answer on a "Make it an app" card: Create (where to add it, or in your own words), Not now,
    Cancel while it's being made, and once added Keep, Undo (it's removed, its files kept) or Restore.
  */
  "offer.answer": [{ threadId: string; itemId: string; act: "create" | "dismiss" | "cancel" | "keep" | "undo" | "restore"; place?: PanelPlace; custom?: string }, null];
  /**
    An add-on someone else made, from a GitHub address (cloned, shallow, into a staging folder), a
    folder on this Mac, or a DeepSeek Harness plugin on npm ("dsh-media-desk", "npm i …"): checked as
    an agent's draft is, and shown on the same card. Nothing is added until addons.adopt;
    addons.drop lets it go.
  */
  "addons.source": [{ source: string }, { token: string; from: string; ask: AddonAsk }];
  "addons.adopt": [{ token: string }, AddonInfo[]];
  "addons.drop": [{ token: string }, null];
  /** Your add-ons as they are now, read again (the Add-ons page's refresh). */
  "addons.list": [Record<string, never>, AddonInfo[]];
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
  /** `files` stops at the first 60; `total` is how many changed. */
  "checkpoint.diff": [{ threadId: string; itemId: string }, { files: FileDiff[]; total: number }];
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
  "fs.files": [{ projectId: string; threadId?: string; query?: string; limit?: number }, { path: string; size: number }[]];
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
  /** The session folder's .claude/launch.json servers, and whether the file is there (`error`: it couldn't be read). */
  "launch.list": [{ threadId: string }, { servers: LaunchServer[]; file: boolean; error?: string }];
  /**
    Runs one (the one that runs already, if it does); answers once it has got past starting up, or
    throws with why it didn't. One nobody has said yes to, or one whose entry changed since, doesn't
    run: the answer carries `ask`, and it runs (and is trusted from then on) only when that ask's
    key comes back as `allow`.
  */
  "launch.start": [{ threadId: string; name: string; allow?: string }, LaunchServer];
  /** Stops one, or (no name) every one in the session's folder; answers with how many stopped. */
  "launch.stop": [{ threadId: string; name?: string }, number];
  /** Stops it and runs the entry as the file says it now: like launch.start, an entry nobody said yes to comes back with `ask`, and the running one is left alone. */
  "launch.restart": [{ threadId: string; name: string; allow?: string }, LaunchServer];
  /** The app shows this session: its folder's servers stay up, and those stopped while no one looked start again. */
  "launch.seen": [{ threadId: string }, null];
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
  /** Liner Design (contracts/src/design.ts). `cwd` is a project's folder or a session's worktree; `file`, a design file's slug in .liner/designs/. */
  "canvas.list": [{ cwd: string }, DesignFileInfo[]];
  /** `base`: where the design's folder is served (the files proxy), for a frame's <base>. */
  "canvas.open": [{ cwd: string; file: string }, { file: DesignFile; base: string; /** Each drawn frame's revision, by id. */ revs: Record<string, string> }];
  /** A new design file; with `size`, it starts with one empty frame of that size. */
  "canvas.create": [{ cwd: string; title: string; size?: DesignSize }, DesignFile];
  "canvas.save": [{ cwd: string; file: string; patch: DesignPatch }, DesignFile];
  /** A new frame, never on top of another: `placed` says where it went (FramePlaced). */
  "canvas.frame.add": [{ cwd: string; file: string; frame: NewFrame; html?: string }, DesignFile & { placed: FramePlaced }];
  /** Takes a frame off the canvas into a trash under Liner Code's home (its entry and its HTML), from which canvas.frame.unremove puts it back. */
  "canvas.frame.remove": [{ cwd: string; file: string; frame: string }, DesignFile];
  /** Puts the frame removed last with this id back, with the same id, place and HTML. */
  "canvas.frame.unremove": [{ cwd: string; file: string; frame: string }, DesignFile];
  /** A copy of a frame beside it (or at x, y), with its HTML. */
  "canvas.frame.copy": [{ cwd: string; file: string; frame: string; x?: number; y?: number }, DesignFile];
  /** A frame's HTML, stamped with data-l ids, and its revision (FrameRev). */
  "canvas.frame.read": [{ cwd: string; file: string; frame: string }, { html: string; rev: string }];
  /**
    One element of a drawn frame as its file has it (by data-l, stamped), and the file's revision:
    the source the Code tab shows and edits and ⌘D copies, never the page as its scripts drew it.
    Refused when the file hasn't got that element (a page's script draws it).
  */
  "canvas.frame.node": [{ cwd: string; file: string; frame: string; id: string }, { html: string; rev: string }];
  /**
    The editor writes a frame whole: stamped, and canvas.changed goes out with by "you". With `base`,
    refused when the file's revision isn't that one any more (an error starting "changed:", FRAME_CHANGED).
    `from`: the revision of the bytes it wrote over ("" when there were none); when they weren't what
    the app was last told of, canvas.changed by "agent" went out for them first.
  */
  "canvas.frame.write": [{ cwd: string; file: string; frame: string; html: string; threadId?: string; base?: string }, { at: number; rev: string; from: string }];
  /**
    Changes to a frame's source, all or nothing, each touching only its element's bytes; refused, as
    canvas.frame.write is, when `base` isn't the file's revision. `undo`: the ops that put it back;
    `ids`: the data-l ids of the elements it added; `from`: the revision it started from, as for write.
  */
  "canvas.frame.apply": [{ cwd: string; file: string; frame: string; ops: FrameOp[]; base?: string; threadId?: string }, { at: number; rev: string; from: string; undo: FrameOp[]; ids: string[] }];
  /** While the canvas shows a design file: tell it when its files change. */
  "canvas.watch": [{ cwd: string; file: string; on: boolean }, null];
  /** A design file's kept states in a session, a copy per turn. */
  "canvas.versions": [{ threadId: string; file: string }, CanvasVersion[]];
  /** A kept copy as it was, to look at: its index and its drawn frames' HTML by id. By `key` (CanvasVersion.key), else by `turn`. Reads the session's copy only; one never kept is refused. */
  "canvas.version.read": [{ threadId: string; file: string; turn?: number; key?: string }, { file: DesignFile; html: Record<string, string> }];
  /** Puts the design file back as that copy (by `key`, else `turn`) has it, after keeping what's there now as a copy of its own ("before"). */
  "canvas.restore": [{ threadId: string; file: string; turn?: number; key?: string }, DesignFile];
  /** What is selected on the canvas now (null: nothing), for the session's design_selection. */
  "canvas.selection": [{ threadId: string; sel: DesignSelection | null }, null];
  /**
    A new design: with `projectId`, a design file in that project (as canvas.create), returning that
    project; without, a design on its own: a folder of its own in the designs home that is a project
    of kind "design", with its design file of the same slug. No session is made. Title defaults to
    "Untitled design"; "desktop+phone" starts with both frames side by side; slugs never collide.
  */
  "design.new": [{ title?: string; size?: DesignSize | "desktop+phone"; projectId?: string }, { project: Project; file: DesignFile }];
  /** Every project that has design files, designs on their own first (always listed, even with none), then the rest; newest first inside each. */
  "design.all": [Record<string, never>, { project: Project; files: DesignFileInfo[] }[]];
  /**
    Build in a project: moves a design on its own (`projectId`, a design project) into a project, an
    existing one or a folder that becomes one as project.add does. Its design files go into the
    target's .liner/designs/ (a slug suffixed on a clash), its sessions become the target's (each
    one's next turn starts from the conversation as text), and the emptied design project goes.
    `file`: its design file as it is in the target now. `moved`: the ids of the sessions that moved.
    `left`: said when the old folder stays because it holds files of its own besides the design.
    Refused with a plain sentence, nothing changed, while a turn runs in it, when the target is a
    design project, or when the move can't complete.
  */
  "design.attach": [{ projectId: string; to: { projectId: string } | { path: string } }, { project: Project; file: DesignFile; moved: string[]; left?: string }];
  /** Renames a design file; for a design on its own the title is the project's name too (its folder keeps its name). */
  "design.rename": [{ projectId: string; file: string; title: string }, { project: Project; file: DesignFile }];
  /**
    Removes a design file. In a project its folder goes to the trash under Liner Code's home (with
    its build copies and picture setting), from which design.unremove puts it back. A design on its
    own goes as project.remove takes a project: the project and its sessions, its folder left on disk.
    Refused while an agent draws in that file.
  */
  "design.remove": [{ projectId: string; file: string }, { ok: true }];
  /** Puts back the design file removed last with this slug in the project, as it was; refused when one of that slug is there again. */
  "design.unremove": [{ projectId: string; file: string }, { project: Project; file: DesignFile }];
  /**
    An untouched design on its own goes whole, its project and its folder: only when no session was
    ever made for it and its folder is exactly as design.new made it (title still "Untitled design").
    Otherwise refused with a plain sentence ("“X” is kept: …"), nothing changed.
  */
  "design.discard": [{ projectId: string }, { ok: true }];
  /** The lean a design file follows (the folder's, without `file`). */
  "lean.read": [{ cwd: string; file?: string }, Lean];
  /** Writes the project's DESIGN.md. */
  /** With `base` (a Lean's `rev`), refused (an error starting FRAME_CHANGED) when the file changed since it was read; nothing written. */
  "lean.write": [{ cwd: string; text: string; base?: string; /** The design file whose lean this is: written where lean.read with it read (Lean.writes). */ file?: string }, Lean];
  /** The design skills there are, each `loaded` or not for `file`. */
  /** With no `cwd` (Design Home, before a design has a folder): only your own skills and the built-in ones, none loaded. */
  "lean.skills": [{ cwd?: string; file?: string }, DesignSkill[]];
  "build.state": [{ cwd: string; file: string }, FrameBuild[]];
  /** Ties a frame to a project file (a path from the folder) as built now. */
  "build.link": [{ cwd: string; file: string; frame: string; path: string }, FrameBuild[]];
  "build.unlink": [{ cwd: string; file: string; frame: string }, FrameBuild[]];
  /** The picture models Settings has. */
  "pictures.models": [Record<string, never>, PictureModel[]];
  /** Asks the picture model for `count` pictures (1 when left out) into the design's assets/: their paths from the design's folder. */
  "pictures.make": [{ threadId: string; cwd: string; file: string; prompt: string; size: { w: number; h: number }; count?: number; model?: string; /** false: the lean's colours are left out of the ask. */ lean?: boolean }, { paths: string[]; cost?: number; ms: number }];
  /** A picture file of the person's own into the design's assets/: its path from the design's folder, as pictures.make's. */
  "pictures.add": [PictureAdd, { path: string }];
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
export * from "./cast.ts";
export * from "./panel.ts";
export * from "./dsh.ts";
export * from "./design.ts";
